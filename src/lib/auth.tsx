import React, { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'ao_assistant_session'

interface User {
  email: string
  groq_key: string
  claude_key: string
}

interface AuthCtx {
  user: User | null
  loading: boolean
  signIn: (email: string) => void
  signOut: () => void
  saveApiKeys: (groq: string, claude: string) => void
}

const AuthContext = createContext<AuthCtx>({} as AuthCtx)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]     = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ENV_CLAUDE = import.meta.env.VITE_CLAUDE_KEY as string | undefined
    const ENV_GROQ   = import.meta.env.VITE_GROQ_KEY   as string | undefined
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const raw = JSON.parse(saved) as Record<string, string>
        const u: User = {
          email:      raw.email      ?? '',
          groq_key:   raw.groq_key  ?? raw.openai_key ?? '',
          claude_key: raw.claude_key ?? '',
        }
        if (!u.claude_key && ENV_CLAUDE) u.claude_key = ENV_CLAUDE
        if (!u.groq_key   && ENV_GROQ)   u.groq_key   = ENV_GROQ
        localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
        setUser(u)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  function signIn(email: string) {
    const ENV_CLAUDE = import.meta.env.VITE_CLAUDE_KEY as string | undefined
    const ENV_GROQ   = import.meta.env.VITE_GROQ_KEY   as string | undefined
    const existing = localStorage.getItem(STORAGE_KEY)
    const u: User = { email: email.toLowerCase().trim(), groq_key: ENV_GROQ ?? '', claude_key: ENV_CLAUDE ?? '' }
    if (existing) {
      try {
        const prev = JSON.parse(existing) as Record<string, string>
        if (prev.groq_key || prev.openai_key) u.groq_key   = prev.groq_key ?? prev.openai_key ?? ''
        if (prev.claude_key)                   u.claude_key = prev.claude_key
      } catch { /* ignore */ }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  function saveApiKeys(groq: string, claude: string) {
    if (!user) return
    const updated: User = { ...user, groq_key: groq, claude_key: claude }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setUser(updated)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, saveApiKeys }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
