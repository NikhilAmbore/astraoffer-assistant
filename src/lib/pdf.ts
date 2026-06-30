// PDF extraction runs in Electron's main process (Node.js) via IPC.
// This avoids all web-worker, CSP, and Vite bundling issues with pdfjs.

export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const text   = await window.electronAPI?.extractPdf(buffer)
  if (!text) throw new Error('PDF extraction returned no text — check the file is a valid PDF')
  return text.trim()
}

export function validateFile(file: File): string | null {
  if (file.size > 20 * 1024 * 1024) return 'File too large (max 20 MB)'
  if (file.name.split('.').pop()?.toLowerCase() !== 'pdf') return 'Only PDF files are supported'
  return null
}
