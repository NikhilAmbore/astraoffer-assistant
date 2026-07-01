declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag'
    WebkitLineClamp?: number
    WebkitBoxOrient?: 'vertical' | 'horizontal'
  }
}

interface ElectronAPI {
  platform: 'darwin' | 'win32' | 'linux' | string
  captureScreen: () => Promise<string | null>
  extractPdf:    (buffer: ArrayBuffer) => Promise<string>

  enableStealth:  () => void
  disableStealth: () => void
  toggleStealth:  () => void

  /** Immediately re-asserts content protection + window level in the main process */
  enforceProtection: () => void
  /** Returns current protection state */
  getProtectionStatus: () => Promise<boolean>
  /** Pushed from main whenever protection state changes */
  onProtectionStatus: (cb: (enabled: boolean) => void) => void

  onStealthOn:       (cb: () => void) => void
  onStealthOff:      (cb: () => void) => void
  onToggleListening: (cb: () => void) => void
  onCaptureNow:      (cb: () => void) => void
  onGenerateAnswer:  (cb: () => void) => void

  setScreenShareMode: (mode: 'overlay-only' | 'full-hidden' | 'off') => Promise<void>

  claudeStream:   (p: { systemPrompt: string; userMessage: string }) => Promise<string>
  onClaudeChunk:  (cb: (text: string) => void) => void
  groqTranscribe: (p: { buffer: ArrayBuffer }) => Promise<string>

  minimizeWindow?: () => void
  closeWindow?:    () => void

  removeAllListeners: (channel: string) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
