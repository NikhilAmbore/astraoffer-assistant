// Injected at build time via vite define — values come from .env / CI secrets
declare const __CLAUDE_KEY__: string
declare const __GROQ_KEY__: string

import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  desktopCapturer,
  screen,
  session,
  systemPreferences,
} from 'electron'
import path from 'path'

let appWindow: BrowserWindow | null = null
let tray: Tray | null = null
let stealthMode = false
let protectionEnabled = true
let protectionTimer: ReturnType<typeof setInterval> | null = null

const isDev = !app.isPackaged

app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://localhost:5173')
app.commandLine.appendSwitch('enable-features', 'ElectronSerialChooser')

// ─── Protection enforcement ───────────────────────────────────────────────────
// Called aggressively: on create, show, restore, focus, display change,
// stealth-off, and via IPC from renderer. This is the single source of truth.
function enforceProtection() {
  if (!appWindow || appWindow.isDestroyed()) return

  if (protectionEnabled) {
    // macOS: CGWindowSharingType = kCGWindowSharingNone
    //   → window pixels excluded from CGWindowListCreateImage (Zoom, Teams, OBS)
    //   → window excluded from ScreenCaptureKit SCShareableContent (macOS 12.3+)
    // Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
    //   → window renders as black / excluded in all DWM-based capture (Win10 2004+)
    appWindow.setContentProtection(true)
  }

  // macOS: 'screen-saver' level (NSScreenSaverWindowLevel = 1000) ensures the window
  // sits above Zoom/Teams AND interacts correctly with CGWindowSharingType at the
  // compositor level. Lower levels may fail to apply the sharing-none flag consistently.
  if (process.platform === 'darwin') {
    appWindow.setAlwaysOnTop(true, 'screen-saver', 1)
    // Keep visible on every Space / full-screen app — without this the window
    // can vanish when the user switches to the Space where Zoom is running.
    appWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {
    appWindow.setAlwaysOnTop(true)
  }
}

// Periodic re-assertion every 8 seconds.
// Some macOS compositor updates (display sleep/wake, resolution change) can reset
// window sharing flags. The timer catches these before the next screen share frame.
function startProtectionTimer() {
  if (protectionTimer) clearInterval(protectionTimer)
  protectionTimer = setInterval(enforceProtection, 8_000)
}

// ─── App window ───────────────────────────────────────────────────────────────
function createAppWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width:  420,
    height: 700,
    x: width - 440,
    y: 40,
    frame:       false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable:   true,
    movable:     true,
    hasShadow:   false,  // shadows on transparent windows can bleed into capture buffers
    show:        false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  }

  // macOS only: 'toolbar' creates an NSPanel instead of NSWindow.
  // NSPanel at screen-saver level + NSWindowSharingNone is the most reliable
  // combination for exclusion from all screen capture paths on macOS.
  if (process.platform === 'darwin') {
    (windowOptions as any).type = 'toolbar'
  }

  appWindow = new BrowserWindow(windowOptions)

  // Apply BEFORE the window is ever composited — no frame where it's unprotected.
  enforceProtection()

  appWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )

  if (isDev) {
    appWindow.loadURL('http://localhost:5173')
  } else {
    appWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Re-assert on every visibility change — OS can reset CGWindowSharingType
  // when a window transitions from hidden → visible.
  appWindow.once('ready-to-show', () => { appWindow?.show(); enforceProtection() })
  appWindow.on('show',    enforceProtection)
  appWindow.on('restore', enforceProtection)
  appWindow.on('focus',   enforceProtection)

  appWindow.on('closed', () => {
    appWindow = null
    if (protectionTimer) { clearInterval(protectionTimer); protectionTimer = null }
  })

  startProtectionTimer()
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: stealthMode ? '🔴 Stealth ON' : '⚪ Stealth OFF', enabled: false },
    { type: 'separator' },
    { label: 'Toggle Stealth (⌘⇧H)', click: toggleStealth },
    { label: 'Show Window',           click: () => { appWindow?.show(); appWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
  tray.setToolTip('AstraOffer Assistant')
  tray.on('click', () => {
    if (stealthMode) toggleStealth()
    else { appWindow?.show(); appWindow?.focus() }
  })
}

// ─── Stealth ──────────────────────────────────────────────────────────────────
function enableStealth() {
  stealthMode = true
  appWindow?.hide()
  if (process.platform === 'darwin') app.dock?.hide()
  tray?.setToolTip('AstraOffer — STEALTH (⌘⇧H to show)')
}

function disableStealth() {
  stealthMode = false
  if (process.platform === 'darwin') app.dock?.show()
  appWindow?.show()
  appWindow?.focus()
  enforceProtection()
  tray?.setToolTip('AstraOffer Assistant')
}

function toggleStealth() {
  stealthMode ? disableStealth() : enableStealth()
}

// ─── Hotkeys ──────────────────────────────────────────────────────────────────
function registerHotkeys() {
  globalShortcut.register('CommandOrControl+Shift+H', toggleStealth)
  globalShortcut.register('CommandOrControl+Shift+S', () =>
    appWindow?.webContents.send('hotkey:toggle-listening'))
  globalShortcut.register('CommandOrControl+Shift+C', () =>
    appWindow?.webContents.send('hotkey:capture-now'))
  globalShortcut.register('CommandOrControl+G', () =>
    appWindow?.webContents.send('hotkey:generate-answer'))
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function registerIPC() {
  // Screen capture for AI context
  ipcMain.handle('capture-screen', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    })
    return sources[0]?.thumbnail.toDataURL() ?? null
  })

  // Stealth from renderer
  ipcMain.on('stealth:toggle',  toggleStealth)
  ipcMain.on('stealth:enable',  enableStealth)
  ipcMain.on('stealth:disable', disableStealth)

  // Renderer calls this when entering session mode — immediate re-assert
  ipcMain.on('enforce-protection', () => enforceProtection())

  // Resize window
  ipcMain.on('window:resize', (_e, { width, height }: { width: number; height: number }) => {
    appWindow?.setSize(width, height, true)
  })

  // Screen share mode — 'off' only disables protection; protection is ALWAYS the default.
  // The "off" path should never be reached during a real interview.
  ipcMain.handle('set-screen-share-mode', (_e, mode: 'overlay-only' | 'full-hidden' | 'off') => {
    protectionEnabled = mode !== 'off'
    enforceProtection()
    appWindow?.webContents.send('protection-status', protectionEnabled)
  })

  // Renderer can query current protection status
  ipcMain.handle('get-protection-status', () => protectionEnabled)

  // Claude streaming (no CORS — Node has no origin restrictions)
  ipcMain.handle('claude:stream', async (event, {
    systemPrompt, userMessage,
  }: { systemPrompt: string; userMessage: string }) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': __CLAUDE_KEY__,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        stream: true,
        system: systemPrompt,
        // userMessage can be a plain string OR a JSON-encoded content array (for vision)
        messages: [{
          role: 'user',
          content: (() => {
            try { const p = JSON.parse(userMessage); if (Array.isArray(p)) return p } catch { /* */ }
            return userMessage
          })(),
        }],
      }),
    })

    if (!res.ok || !res.body) throw new Error(`Claude API error: ${await res.text()}`)

    const sender  = event.sender
    const reader  = (res.body as any).getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            sender.send('claude:chunk', parsed.delta.text)
          }
        } catch { /* skip malformed */ }
      }
    }
    return 'done'
  })

  // Groq Whisper transcription (no CORS)
  ipcMain.handle('groq:transcribe', async (_e, {
    buffer,
  }: { buffer: ArrayBuffer }) => {
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: 'audio/webm' }), 'audio.webm')
    form.append('model', 'whisper-large-v3-turbo')
    form.append('language', 'en')
    form.append('response_format', 'json')
    form.append('temperature', '0')
    // Primes Whisper with interview context so technical terms are recognized correctly
    form.append('prompt', 'Technical software engineering interview. Topics: algorithms, data structures, system design, React, TypeScript, JavaScript, Python, Java, APIs, databases, microservices, AWS, Docker, Kubernetes, distributed systems, scalability, object-oriented programming.')

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${__GROQ_KEY__}` },
      body: form,
    })
    if (!res.ok) throw new Error(await res.text())
    const json = await res.json() as { text: string }
    return json.text ?? ''
  })

  // PDF extraction via Node.js
  ipcMain.handle('extract-pdf', async (_e, buffer: ArrayBuffer) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFParser = require('pdf2json')
    return new Promise<string>((resolve, reject) => {
      const parser = new PDFParser(null, 1)
      parser.on('pdfParser_dataReady', (data: any) => {
        const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
        try {
          const text = (data.Pages as any[])
            .map((page: any) =>
              (page.Texts as any[])
                .map((t: any) => (t.R as any[]).map((r: any) => safeDecode(r.T as string)).join(''))
                .join(' ')
            )
            .join('\n\n')
          resolve(text)
        } catch (e) { reject(e) }
      })
      parser.on('pdfParser_dataError', (err: any) => reject(err))
      parser.parseBuffer(Buffer.from(buffer))
    })
  })
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'microphone', 'camera', 'audioCapture', 'desktopCapture', 'display-capture']
    callback(allowed.includes(permission))
  })

  // Auto-handle getDisplayMedia calls — no picker dialog shown to the user.
  //
  // audio: 'loopback' behaviour per platform:
  //   macOS (13+ Ventura/Sonoma/Sequoia) — ScreenCaptureKit loopback; requires Screen
  //     Recording permission in System Settings → Privacy & Security
  //   Windows 10/11 — WASAPI loopback; no extra permission needed; very reliable
  //   Linux — 'loopback' is NOT supported by Chromium/Electron; the renderer falls back
  //     to PulseAudio/PipeWire monitor-device enumeration (see useAudioRecorder.ts)
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      if (!sources[0]) { callback({}); return }

      if (process.platform === 'linux') {
        // On Linux, loopback is unsupported — provide video-only; the renderer
        // will detect 0 audio tracks and switch to monitor-device mode.
        callback({ video: sources[0] })
      } else {
        // macOS + Windows: 'loopback' captures system audio output.
        // The user's microphone is NOT captured.
        callback({ video: sources[0], audio: 'loopback' as any })
      }
    }).catch(() => callback({}))
  })

  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus !== 'granted') await systemPreferences.askForMediaAccess('microphone')
  }

  registerIPC()
  createAppWindow()
  createTray()
  registerHotkeys()

  // Re-enforce on display configuration changes (resolution, sleep/wake, external monitor)
  screen.on('display-metrics-changed', enforceProtection)
  screen.on('display-added',           enforceProtection)
  screen.on('display-removed',         enforceProtection)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createAppWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (protectionTimer) clearInterval(protectionTimer)
})
