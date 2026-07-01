import React, { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'ao_assistant_session'

interface User {
  email: string
}

interface AuthCtx {
  user: User | null
  loading: boolean
  signIn: (email: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthCtx>({} as AuthCtx)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]     = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const raw = JSON.parse(saved) as Record<string, string>
        if (raw.email) setUser({ email: raw.email })
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  function signIn(email: string) {
    const u: User = { email: email.toLowerCase().trim() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    setUser(u)
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
