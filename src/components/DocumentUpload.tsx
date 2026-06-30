import { useState, useRef } from 'react'
import { extractPdfText, validateFile } from '../lib/pdf'
import { saveLocalDocument, deleteLocalDocument, LocalDocument } from '../lib/localDocs'
import { useAuth } from '../lib/auth'

interface Props {
  docs: LocalDocument[]
  onDocsChange: (docs: LocalDocument[]) => void
  label?: string
}

function fmt(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function DocumentUpload({ docs, onDocsChange, label }: Props) {
  const { user } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || !user) return
    setUploading(true)

    for (const file of Array.from(files)) {
      const err = validateFile(file)
      if (err) { setStatus(`⚠ ${err}`); continue }

      setStatus(`Reading ${file.name}…`)
      try {
        const text = await extractPdfText(file)
        const doc = saveLocalDocument({
          user_email: user.email,
          name: file.name,
          size: file.size,
          text_content: text,
        })
        onDocsChange([doc, ...docs])
        setStatus(`✓ ${file.name} added`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('PDF extraction error:', e)
        setStatus(`❌ ${msg}`)
      }
    }

    setUploading(false)
    setTimeout(() => setStatus(''), 8000)
  }

  function remove(id: string) {
    deleteLocalDocument(id)
    onDocsChange(docs.filter(d => d.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
          Knowledge Base
        </h2>
        <span className="text-xs text-white/30">{docs.length} file{docs.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Drop zone */}
      <div
        className="border-2 border-dashed border-cyan-500/30 rounded-xl p-5 text-center
          hover:border-cyan-400/60 hover:bg-cyan-500/5 transition cursor-pointer group"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
      >
        <div className="text-2xl mb-1.5">📄</div>
        <p className="text-sm text-white/60 group-hover:text-white/80 transition">
          {uploading ? status : (label ?? 'Drop PDF here or click to upload')}
        </p>
        <p className="text-xs text-white/30 mt-1">PDF files only · max 20 MB</p>
        {uploading && (
          <div className="mt-3 w-32 h-1 bg-white/10 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-cyan-400 rounded-full animate-pulse w-2/3" />
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />

      {status && !uploading && (
        <p className="text-xs text-cyan-300">{status}</p>
      )}

      {/* Uploaded docs */}
      {docs.length > 0 ? (
        <div className="space-y-2">
          {docs.map(doc => (
            <div
              key={doc.id}
              className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2.5 group"
            >
              <span className="text-lg">📄</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/90 truncate font-medium">{doc.name}</p>
                <p className="text-xs text-white/40">
                  {fmt(doc.size)} · {doc.text_content.length.toLocaleString()} chars extracted
                </p>
              </div>
              <button
                onClick={() => remove(doc.id)}
                className="opacity-0 group-hover:opacity-100 text-red-400
                  hover:text-red-300 transition text-xs px-2 py-1 rounded"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-white/30 text-center pt-2">
          No documents yet. Upload your resume to get started.
        </p>
      )}
    </div>
  )
}
