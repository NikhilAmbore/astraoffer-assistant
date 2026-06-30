import { useRef, useState, useCallback } from 'react'
import { transcribeAudio } from '../lib/ai'

export type AudioSource = 'system' | 'mic' | null

interface UseAudioRecorderReturn {
  isListening:     boolean
  transcript:      string
  error:           string | null
  audioSource:     AudioSource
  startListening:  () => Promise<void>
  stopListening:   () => void
  clearTranscript: () => void
}

const CHUNK_MS = 2500
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl:  false,
  sampleRate:       44100,
}

// ─── Platform-aware system audio acquisition ──────────────────────────────────
// Returns a MediaStream containing ONLY system audio (no microphone), or null.
//
// Path A — macOS & Windows
//   getDisplayMedia → Electron main auto-handles the picker (setDisplayMediaRequestHandler)
//   and sets audio:'loopback'. Loopback = WASAPI on Windows, ScreenCaptureKit on macOS 13+.
//   The user's microphone is completely untouched.
//
// Path B — Linux (PulseAudio / PipeWire)
//   Loopback is unsupported in the Chromium display-media stack on Linux.
//   PulseAudio/PipeWire expose each sink's monitor as a regular audioinput device
//   (label contains "monitor", deviceId ends with ".monitor").
//   We request mic permission once to get device labels, find the monitor, then
//   open it as a normal getUserMedia call — no mic data, just system output.
//
// Path C — all platforms
//   Microphone fallback with a warning. Your voice while reading the AI answer
//   will also be transcribed, which can cause double-generation confusion.
async function acquireSystemAudio(): Promise<{ stream: MediaStream; source: AudioSource; warning?: string }> {
  const platform = window.electronAPI?.platform ?? 'unknown'

  // ── Path A: getDisplayMedia with loopback (macOS + Windows) ────────────────
  if (platform !== 'linux') {
    try {
      const raw = await navigator.mediaDevices.getDisplayMedia({
        audio: AUDIO_CONSTRAINTS as MediaTrackConstraints,
        video: true,  // must be true for loopback to work in Electron
      })
      // Drop the video track immediately — we only needed it to unlock audio
      raw.getVideoTracks().forEach(t => t.stop())

      const audioTracks = raw.getAudioTracks()
      if (audioTracks.length > 0) {
        return { stream: new MediaStream(audioTracks), source: 'system' }
      }
      // Got a stream but no audio (e.g. macOS <13 without ScreenCaptureKit)
      raw.getTracks().forEach(t => t.stop())

      const hint = platform === 'darwin'
        ? 'Grant Screen Recording in System Settings → Privacy & Security → Screen Recording, then restart.'
        : 'Restart the app if screen capture permission was just changed.'
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }), source: 'mic', warning: hint }
    } catch {
      // getDisplayMedia can throw if Screen Recording permission is not yet granted (first run)
    }
  }

  // ── Path B: Linux — PulseAudio / PipeWire monitor device ───────────────────
  if (platform === 'linux') {
    try {
      // We need mic permission first so enumerateDevices returns labels
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      probe.getTracks().forEach(t => t.stop())

      const devices = await navigator.mediaDevices.enumerateDevices()
      const monitor = devices.find(d =>
        d.kind === 'audioinput' && (
          d.label.toLowerCase().includes('monitor') ||
          d.deviceId.endsWith('.monitor')
        )
      )

      if (monitor) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...AUDIO_CONSTRAINTS, deviceId: { exact: monitor.deviceId } },
        })
        return { stream, source: 'system' }
      }

      // Monitor not found — guide the user to set one up
      const linuxHint =
        '⚠ No PulseAudio/PipeWire monitor found. ' +
        'Run: pactl load-module module-loopback  — or create a null sink monitor. ' +
        'Using microphone fallback for now.'
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      return { stream, source: 'mic', warning: linuxHint }
    } catch { /* fall through to mic */ }
  }

  // ── Path C: Microphone fallback ────────────────────────────────────────────
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const warning =
    platform === 'darwin'
      ? '⚠ Mic fallback — grant Screen Recording in System Settings → Privacy & Security. Your voice while reading answers will also be transcribed.'
      : platform === 'win32'
      ? '⚠ Mic fallback — allow screen capture when prompted. Your voice while reading answers will also be transcribed.'
      : '⚠ Mic fallback — system audio unavailable. Your voice while reading answers will also be transcribed.'
  return { stream, source: 'mic', warning }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAudioRecorder(
  onTranscriptChunk: (text: string) => void,
  groqKey: string,
): UseAudioRecorderReturn {
  const [isListening, setIsListening] = useState(false)
  const [transcript,  setTranscript]  = useState('')
  const [error,       setError]       = useState<string | null>(null)
  const [audioSource, setAudioSource] = useState<AudioSource>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRef   = useRef(false)

  const processChunk = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') return

    recorder.stop()
    await new Promise<void>(r => recorder.addEventListener('stop', () => r(), { once: true }))

    if (!chunksRef.current.length) { recorder.start(); return }

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    chunksRef.current = []
    recorder.start()

    if (blob.size < 3000) return  // silence / empty chunk

    try {
      const text = await transcribeAudio(blob, groqKey)
      if (text && activeRef.current) {
        setError(null)
        setTranscript(prev => `${prev} ${text}`.slice(-3000).trimStart())
        onTranscriptChunk(text)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [onTranscriptChunk, groqKey])

  const startListening = useCallback(async () => {
    setError(null)

    let stream: MediaStream
    let source: AudioSource
    let warning: string | undefined

    try {
      ;({ stream, source, warning } = await acquireSystemAudio())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Audio capture denied')
      return
    }

    if (warning) setError(warning)

    streamRef.current = stream
    setAudioSource(source)

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder    = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder
    chunksRef.current   = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.start()
    activeRef.current = true
    setIsListening(true)
    setTranscript('')
    intervalRef.current = setInterval(processChunk, CHUNK_MS)
  }, [processChunk])

  const stopListening = useCallback(() => {
    activeRef.current = false
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    setIsListening(false)
    setAudioSource(null)
  }, [])

  const clearTranscript = useCallback(() => setTranscript(''), [])

  return { isListening, transcript, error, audioSource, startListening, stopListening, clearTranscript }
}
