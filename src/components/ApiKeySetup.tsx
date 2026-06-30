import { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function ApiKeySetup() {
  const { user, saveApiKeys } = useAuth()
  const [groq,   setGroq]   = useState(user?.groq_key   ?? '')
  const [claude, setClaude] = useState(user?.claude_key ?? '')
  const [saved,  setSaved]  = useState(false)

  function handleSave() {
    saveApiKeys(groq.trim(), claude.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider mb-1">API Keys</h2>
        <p className="text-xs text-white/40">Stored locally on your device — never sent anywhere else.</p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-white/60 mb-1 block">
            Groq Key <span className="text-white/30">(free mic transcription — </span>
            <span className="text-cyan-400">console.groq.com</span>
            <span className="text-white/30">)</span>
          </label>
          <input
            type="password"
            value={groq}
            onChange={e => setGroq(e.target.value)}
            placeholder="gsk_..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm
              text-white/90 placeholder-white/20 focus:outline-none focus:border-cyan-500/60 transition"
          />
        </div>

        <div>
          <label className="text-xs text-white/60 mb-1 block">
            Anthropic Key <span className="text-white/30">(Claude AI answers — </span>
            <span className="text-cyan-400">console.anthropic.com</span>
            <span className="text-white/30">)</span>
          </label>
          <input
            type="password"
            value={claude}
            onChange={e => setClaude(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm
              text-white/90 placeholder-white/20 focus:outline-none focus:border-cyan-500/60 transition"
          />
        </div>

        <button
          onClick={handleSave}
          className="w-full py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600
            text-sm font-semibold text-white hover:opacity-90 active:scale-[0.98] transition"
        >
          {saved ? '✓ Saved' : 'Save Keys'}
        </button>
      </div>

      <div className="bg-white/3 rounded-xl p-3 text-xs text-white/40 space-y-1.5">
        <p className="text-white/60 font-medium">How to get a free Groq key:</p>
        <p>1. Go to <span className="text-cyan-400">console.groq.com</span> → sign up free</p>
        <p>2. API Keys → Create API Key → copy it</p>
        <p>3. Paste above → Save Keys</p>
        <p className="text-white/30 pt-1">Groq transcribes your mic using Whisper — completely free, no credit card.</p>
      </div>
    </div>
  )
}
