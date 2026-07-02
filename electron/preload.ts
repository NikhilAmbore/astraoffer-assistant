import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,  // 'darwin' | 'win32' | 'linux'
  captureScreen: (): Promise<string | null> =>
    ipcRenderer.invoke('capture-screen'),

  extractPdf: (buffer: ArrayBuffer): Promise<string> =>
    ipcRenderer.invoke('extract-pdf', buffer),

  enableStealth:  () => ipcRenderer.send('stealth:enable'),
  disableStealth: () => ipcRenderer.send('stealth:disable'),
  toggleStealth:  () => ipcRenderer.send('stealth:toggle'),

  // Called by the renderer every time it enters session mode.
  // Main process re-asserts content protection + window level immediately.
  enforceProtection: () => ipcRenderer.send('enforce-protection'),

  // Returns whether content protection is currently active
  getProtectionStatus: (): Promise<boolean> =>
    ipcRenderer.invoke('get-protection-status'),

  // Listen for protection status pushed from main (after set-screen-share-mode)
  onProtectionStatus: (cb: (enabled: boolean) => void) =>
    ipcRenderer.on('protection-status', (_e, v) => cb(v)),

  onStealthOn:       (cb: () => void) => ipcRenderer.on('stealth:on',             () => cb()),
  onStealthOff:      (cb: () => void) => ipcRenderer.on('stealth:off',            () => cb()),
  onToggleListening: (cb: () => void) => ipcRenderer.on('hotkey:toggle-listening', () => cb()),
  onCaptureNow:      (cb: () => void) => ipcRenderer.on('hotkey:capture-now',      () => cb()),
  onGenerateAnswer:  (cb: () => void) => ipcRenderer.on('hotkey:generate-answer',  () => cb()),

  setScreenShareMode: (mode: 'overlay-only' | 'full-hidden' | 'off') =>
    ipcRenderer.invoke('set-screen-share-mode', mode),

  claudeStream: (p: { systemPrompt: string; userMessage: string; counted?: boolean }) =>
    ipcRenderer.invoke('claude:stream', p),
  getUsageStatus: (): Promise<{ answersToday: number; limit: number; canAnswer: boolean; plan: string }> =>
    ipcRenderer.invoke('usage:status'),
  claudeComplete: (p: { systemPrompt: string; userMessage: string }): Promise<string> =>
    ipcRenderer.invoke('claude:complete', p),
  onClaudeChunk: (cb: (text: string) => void) =>
    ipcRenderer.on('claude:chunk', (_e, t) => cb(t)),
  groqTranscribe: (p: { buffer: ArrayBuffer }) =>
    ipcRenderer.invoke('groq:transcribe', p),

  abortStream:    () => ipcRenderer.send('claude:abort'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  closeWindow:    () => ipcRenderer.send('window:close'),

  removeAllListeners: (ch: string) =>
    ipcRenderer.removeAllListeners(ch),
})
