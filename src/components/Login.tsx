import { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (email.trim()) signIn(email.trim())
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #0A2540 0%, #0d1b2e 100%)', WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Window controls — top-right corner */}
      <div style={{
        position: 'fixed', top: 12, right: 12,
        display: 'flex', gap: 6,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}>
        <button
          onClick={() => window.electronAPI?.minimizeWindow?.()}
          title="Minimize"
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.5)',
            fontSize: 16, lineHeight: 1,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >−</button>
        <button
          onClick={() => window.electronAPI?.closeWindow?.()}
          title="Close"
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.5)',
            fontSize: 14, lineHeight: 1,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>
      </div>

      <div className="glass rounded-2xl p-8 w-80 space-y-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Logo */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-700
            mx-auto mb-3 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="text-2xl font-black text-white">A</span>
          </div>
          <h1 className="text-xl font-bold text-white">AstraOffer Assistant</h1>
          <p className="text-xs text-white/40 mt-1">Real-time AI meeting co-pilot</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-white/50 mb-1.5 block">Your Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm
                text-white/90 placeholder-white/20 focus:outline-none focus:border-cyan-500/60 transition"
            />
          </div>

          <button
            type="submit"
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600
              text-sm font-semibold text-white hover:opacity-90 active:scale-[0.98] transition"
          >
            Continue →
          </button>
        </form>

        <p className="text-xs text-white/25 text-center">
          No password needed — this app runs locally on your device.
        </p>
      </div>
    </div>
  )
}
