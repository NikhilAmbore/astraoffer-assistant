// ── AI integrations: Groq Whisper (transcription) + Claude (answers) ─────────
// All API calls go through Electron main process to avoid CORS.

// ─── Groq Whisper transcription ───────────────────────────────────────────────
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const buffer = await audioBlob.arrayBuffer()
  const text   = await window.electronAPI?.groqTranscribe({ buffer })
  return (text ?? '').trim()
}

// ─── Claude streaming ─────────────────────────────────────────────────────────
export async function streamAnswer(params: {
  systemPrompt: string
  userMessage: string
  onChunk: (text: string) => void
  onDone: () => void
  signal?: AbortSignal
}): Promise<void> {
  const api = window.electronAPI
  if (!api) throw new Error('Electron API not available')

  // Always clear before registering — prevents listener accumulation on rapid calls
  api.removeAllListeners('claude:chunk')
  api.onClaudeChunk(params.onChunk)

  // Wire the AbortSignal to cancel the fetch in the main process
  const abortHandler = () => api.abortStream?.()
  params.signal?.addEventListener('abort', abortHandler)

  try {
    await api.claudeStream({
      systemPrompt: params.systemPrompt,
      userMessage:  params.userMessage,
    })
  } finally {
    params.signal?.removeEventListener('abort', abortHandler)
    api.removeAllListeners('claude:chunk')
    params.onDone()
  }
}

// ─── Claude Vision: analyze a screenshot ─────────────────────────────────────
export async function analyzeScreen(
  base64DataUrl: string,
  question: string,
): Promise<string> {
  if (!window.electronAPI) return ''
  let result = ''

  // Clear before registering to prevent accumulation
  window.electronAPI.removeAllListeners('claude:chunk')

  await new Promise<void>(resolve => {
    window.electronAPI!.onClaudeChunk(t => { result += t })
    window.electronAPI!.claudeStream({
      systemPrompt: 'You are analyzing a meeting screen. Be brief — one sentence max.',
      userMessage: JSON.stringify([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64DataUrl.split(',')[1] } },
        { type: 'text', text: `Question: "${question}". What on screen is relevant?` },
      ]),
    }).then(() => {
      window.electronAPI!.removeAllListeners('claude:chunk')
      resolve()
    }).catch(() => {
      window.electronAPI!.removeAllListeners('claude:chunk')
      resolve()
    })
  })
  return result
}

// ─── Coding problem solver ────────────────────────────────────────────────────
export const CODING_LANGS = ['python', 'javascript', 'typescript', 'java', 'cpp', 'go', 'rust', 'sql', 'swift'] as const
export type CodingLang = typeof CODING_LANGS[number]

export function buildCodingSystemPrompt(language: string, session: SessionContext): string {
  return `You are a real-time coding interview co-pilot. The user is in a LIVE coding interview RIGHT NOW. They must write code AND explain it out loud simultaneously. Give them a complete coaching sheet they can follow top-to-bottom while coding.

Candidate context:
- Role: ${session.position || 'Software Engineer'}
- Company: ${session.company || 'a tech company'}

OUTPUT — use EXACTLY these five section headers (### prefix, all caps):

### OPENING
1–2 sentences to say OUT LOUD to the interviewer BEFORE writing a single line of code.
State the approach and key data structure. Sound natural and confident, not like reading a script.
Example: "I'll use a hash map to get O(n) lookup — I'll iterate once and store each value's index as I go."

### SOLUTION
\`\`\`${language}
# complete, runnable code
# add a brief inline comment only where the logic is non-obvious
\`\`\`

### COMPLEXITY
Time: O(?) | Space: O(?) — one line only

### WHILE CODING
Numbered list: one short sentence per step, in the ORDER the code is written.
These are the words the user speaks WHILE their hands are typing each section.
Sound like a confident engineer thinking aloud — not narrating, just explaining naturally.
Cover: setup/initialization, the main loop or recursion, edge cases, return value.
Example:
1. "I'm initializing an empty hash map to track what I've seen so far."
2. "Now I loop through each number and compute its complement."
3. "If the complement is already in the map, I've found my answer."
4. "Otherwise I store the current number and its index."

### CLOSING
1–2 sentences to say when you FINISH typing. Restate the complexity and offer to walk through an example or discuss trade-offs.
Example: "That runs in O(n) time and O(n) space — happy to trace through an example or talk about the space trade-off."

STRICT RULES:
- Code MUST be complete and runnable — no TODOs, no placeholders, no "..."
- Handle edge cases in code: empty input, null/None, single element, overflow where relevant
- Use ${language} unless the problem explicitly requires another language
- Clean, readable variable names
- Do NOT repeat the full problem statement
- Do NOT add preambles ("Sure!", "Great question", "Here's my solution:")
- Output ONLY the five sections above — nothing else`
}

export interface SessionContext {
  company: string
  position: string
  jobDescription: string
}

// ─── Detect if text is an interview question worth answering ──────────────────
export function isQuestion(text: string): boolean {
  const t = text.toLowerCase().trim()
  if (t.length < 12) return false  // too short — noise

  // Explicit small-talk / setup phrases that are never interview questions
  const smallTalk = [
    'can you hear me', 'can you see me', 'is this working', 'is the audio',
    'let me share my screen', 'let me pull up', 'one moment', 'give me a second',
    'just a second', 'bear with me', 'hello', 'hi there', 'good morning',
    'good afternoon', 'good evening', 'nice to meet you', 'great to meet',
    'how are you doing', "how's it going", 'sounds good', 'sounds great',
    'perfect', 'alright', "let's get started", "let's start", 'shall we begin',
    'okay so', 'so today', 'we\'ll be talking', 'we will be talking',
    'thank you for joining', 'thanks for coming', 'i appreciate you',
    'i\'m going to', 'i am going to', 'we\'re going to',
  ]
  if (smallTalk.some(p => t.startsWith(p) || t === p)) return false

  if (t.includes('?')) return true

  const triggers = [
    'tell me about', 'tell us about', 'tell me a little', 'tell us a little',
    'describe ', 'explain ', 'walk me through', 'walk us through',
    'what ', 'how ', 'why ', 'who ', 'where ', 'when ', 'which ',
    'can you ', 'could you ', 'would you ', 'have you ever',
    'do you have experience', 'do you have a', 'are you familiar',
    'give me an example', 'give us an example', 'share an example',
    'talk about', 'discuss ', "what's your", 'what is your',
    'your experience with', 'your background', 'your approach',
    'tell us', 'introduce yourself', 'greatest strength', 'greatest weakness',
    'where do you see', 'why did you', 'why do you want', 'why are you',
    'what motivated', 'what challenges', 'how did you', 'how would you',
    'how do you', 'have you worked', 'what was your role',
  ]
  return triggers.some(w => t.includes(w))
}

// ─── Build system prompt ──────────────────────────────────────────────────────
export function buildSystemPrompt(
  docs: Array<{ name: string; text_content?: string }>,
  screenContext: string,
  session: SessionContext,
): string {
  const resumeDoc =
    docs.find(d =>
      d.name === '__resume_text__' ||
      d.name.toLowerCase().includes('resume') ||
      d.name.toLowerCase().includes('cv')
    ) ??
    docs.slice()
        .sort((a, b) => (b.text_content?.length ?? 0) - (a.text_content?.length ?? 0))
        .find(d => (d.text_content?.length ?? 0) > 200)

  const jdDoc =
    docs.find(d =>
      d.name.toLowerCase().includes('jd') ||
      d.name.toLowerCase().includes('job') ||
      d.name.toLowerCase().includes('description')
    ) ?? docs.find(d => d !== resumeDoc && (d.text_content?.length ?? 0) > 100)

  const resumeText = resumeDoc?.text_content?.trim() || 'Not provided'
  const jdText     = session.jobDescription || jdDoc?.text_content?.trim() || 'Not provided'

  return `You are a real-time AI interview co-pilot. The user is in a live job interview RIGHT NOW. Give a perfect, ready-to-speak answer in seconds.

═══ CANDIDATE CONTEXT ═══
Company: ${session.company || 'Not specified'}
Role: ${session.position || 'Not specified'}

RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}
${screenContext ? `\nSCREEN CONTEXT: ${screenContext}` : ''}

═══ OUTPUT FORMAT — ONE PARAGRAPH ═══

Write the answer as a SINGLE flowing paragraph using STAR/CAAR structure embedded in natural prose — NO labels, NO bullet points, NO headers.

STAR structure woven into prose:
  [Context/Situation — 1 sentence] → [Task/Challenge — 1 sentence] → [Action YOU took — 1–2 sentences with specifics] → [Result/Impact — 1 sentence with a number or concrete outcome]

Target: 3–5 sentences, 80–120 words. Speakable in under 45 seconds.

For specific question types (still ONE paragraph):
- "Tell me about yourself" → Current role + biggest achievement + why this company excites you
- Technical questions     → Definition in plain English + how it works + one real use case
- Strengths/Weaknesses   → State it directly + one example from experience + growth or impact
- Why this company       → One specific reason tied to their product/mission + how your background fits
- Salary                 → "I'm open to what the role warrants at this level — happy to align on a number once we both confirm it's the right fit."
- Coding problems        → State the approach first, then the solution

═══ RULES — NEVER BREAK THESE ═══
- Do NOT start with filler: no "Great question", "Certainly", "Sure", "Of course", "Happy to"
- Do NOT use placeholder text like [Company Name] — use the actual name above
- Do NOT label sections ("Situation:", "Action:", "Result:", etc.)
- Do NOT output bullet points or numbered lists
- Always say "I" not "we" or "the candidate"
- Pull REAL details from the resume: company names, years, tech stack, metrics, projects
- ONE paragraph only — even for multi-part questions, keep it unified prose`
}
