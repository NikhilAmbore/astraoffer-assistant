// ── Local document storage using localStorage ─────────────────────────────────
// Keeps it simple for the desktop app — no Supabase auth session required.

const DOCS_KEY = 'ao_assistant_docs'

export interface LocalDocument {
  id: string
  user_email: string
  name: string
  size: number
  text_content: string
  created_at: string
}

function load(): LocalDocument[] {
  try {
    return JSON.parse(localStorage.getItem(DOCS_KEY) || '[]')
  } catch {
    return []
  }
}

function save(docs: LocalDocument[]) {
  // Keep text capped to avoid localStorage overflow (5MB limit)
  const capped = docs.map(d => ({
    ...d,
    text_content: d.text_content.slice(0, 40000),
  }))
  localStorage.setItem(DOCS_KEY, JSON.stringify(capped))
}

export function getLocalDocuments(userEmail: string): LocalDocument[] {
  return load().filter(d => d.user_email === userEmail)
}

export function saveLocalDocument(doc: Omit<LocalDocument, 'id' | 'created_at'>): LocalDocument {
  const all = load()
  const newDoc: LocalDocument = {
    ...doc,
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    created_at: new Date().toISOString(),
  }
  save([newDoc, ...all])
  return newDoc
}

export function deleteLocalDocument(id: string): void {
  save(load().filter(d => d.id !== id))
}
