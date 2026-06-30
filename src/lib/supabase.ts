import { createClient } from '@supabase/supabase-js'

// ── Same Supabase project as your website ────────────────────────────────────
// These are the public anon credentials — safe to ship in the app.
const SUPA_URL = 'https://mqonctgrvppdbjcuawue.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xb25jdGdydnBwZGJqY3Vhd3VlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNTUwMzMsImV4cCI6MjA4OTYzMTAzM30.xc47ksXn5lLzF9w70U5BpCI86yzivsjbHUsJCk2ZseU'

export const supabase = createClient(SUPA_URL, SUPA_KEY)

// ── Document storage helpers ──────────────────────────────────────────────────
// SQL to run once in Supabase Dashboard → SQL Editor:
//
//   create table if not exists assistant_documents (
//     id          uuid default gen_random_uuid() primary key,
//     user_email  text not null,
//     name        text not null,
//     size        bigint,
//     storage_path text not null,
//     text_content text,
//     created_at  timestamptz default now()
//   );
//   create index on assistant_documents(user_email);
//
//   -- Storage bucket (run in Supabase Dashboard > Storage > New Bucket)
//   -- Name: assistant-docs, Public: false

export interface AssistantDocument {
  id: string
  user_email: string
  name: string
  size: number
  storage_path: string
  text_content?: string
  created_at: string
}

/** Upload a file to Supabase Storage and save metadata to DB */
export async function uploadDocument(
  userEmail: string,
  file: File,
  textContent: string
): Promise<AssistantDocument | null> {
  const path = `${userEmail}/${Date.now()}_${file.name}`

  // 1. Upload file bytes to Storage
  const { error: storageErr } = await supabase.storage
    .from('assistant-docs')
    .upload(path, file, { upsert: true })

  if (storageErr) {
    console.error('[supabase] storage upload failed:', storageErr)
    return null
  }

  // 2. Save metadata + extracted text to DB
  const { data, error: dbErr } = await supabase
    .from('assistant_documents')
    .insert({
      user_email: userEmail,
      name: file.name,
      size: file.size,
      storage_path: path,
      text_content: textContent.slice(0, 50000), // cap at 50k chars
    })
    .select()
    .single()

  if (dbErr) {
    console.error('[supabase] db insert failed:', dbErr)
    return null
  }

  return data as AssistantDocument
}

/** Fetch all documents for a user */
export async function getUserDocuments(userEmail: string): Promise<AssistantDocument[]> {
  const { data, error } = await supabase
    .from('assistant_documents')
    .select('*')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false })

  if (error) return []
  return (data ?? []) as AssistantDocument[]
}

/** Delete a document from storage and DB */
export async function deleteDocument(doc: AssistantDocument): Promise<void> {
  await supabase.storage.from('assistant-docs').remove([doc.storage_path])
  await supabase.from('assistant_documents').delete().eq('id', doc.id)
}
