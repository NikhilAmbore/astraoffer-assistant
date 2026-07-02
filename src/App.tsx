import { useState, useRef, useCallback, useEffect } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { getLocalDocuments, saveLocalDocument, LocalDocument } from './lib/localDocs'
import { streamAnswer, transcribeAudio, buildSystemPrompt, buildCodingSystemPrompt, analyzeScreen, isQuestion, isCodingProblem, generateFollowUps, generateKeyPoints, SessionContext, CODING_LANGS, CodingLang } from './lib/ai'
import { useAudioRecorder } from './hooks/useAudioRecorder'
import DocumentUpload from './components/DocumentUpload'
import Login from './components/Login'

type AppScreen   = 'setup' | 'session' | 'practice'
type ShareMode   = 'overlay-only' | 'full-hidden' | 'off'

const SESSION_KEY = 'ao_session_ctx'

export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>
}

function AppInner() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user)   return <Login />
  return <Main />
}

// ─── Main shell ───────────────────────────────────────────────────────────────
function Main() {
  const { user, signOut } = useAuth()
  const [screen,    setScreen]    = useState<AppScreen>('setup')
  const [minimized, setMinimized] = useState(false)
  const [docs,      setDocs]      = useState<LocalDocument[]>([])
  const [session,   setSession]   = useState<SessionContext>(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') } catch { return {} as SessionContext }
  })

  useEffect(() => {
    if (user?.email) setDocs(getLocalDocuments(user.email))
  }, [user?.email])

  function saveSession(s: SessionContext) {
    setSession(s)
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  }

  // Enforce protection every time the screen changes (setup → session and back)
  useEffect(() => {
    window.electronAPI?.enforceProtection()
  }, [screen])

  // ── Minimized pill ───────────────────────────────────────────────────────────
  if (minimized) {
    return (
      <div style={{ position: 'fixed', top: 20, right: 20 }}>
        <button
          onClick={() => setMinimized(false)}
          style={{
            WebkitAppRegion: 'drag',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 18px', borderRadius: 999,
            background: 'rgba(10,10,10,0.92)',
            border: '1px solid rgba(255,255,255,0.14)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.65)',
            cursor: 'pointer', color: 'rgba(255,255,255,0.82)',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.03em', userSelect: 'none',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: screen === 'session' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.30)',
          }}/>
          AstraOffer ▸
        </button>
      </div>
    )
  }

  // ── Full window ──────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100%', height: '100vh',
      display: 'flex', flexDirection: 'column',
      background: 'rgba(10,10,10,0.83)',
      backdropFilter: 'blur(22px)',
      WebkitBackdropFilter: 'blur(22px)',
      borderRadius: 16,
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
      color: 'rgba(255,255,255,0.88)',
      border: '1px solid rgba(255,255,255,0.07)',
      boxSizing: 'border-box',
    }}>

      {/* ── Header (drag handle) ─────────────────────────────────────────────── */}
      <div style={{
        WebkitAppRegion: 'drag',
        display: 'flex', alignItems: 'center',
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0, userSelect: 'none', cursor: 'grab',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: 'rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800,
          }}>A</div>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.03em' }}>AstraOffer</span>
          {screen === 'session' && session.company && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.32)', marginLeft: 2 }}>
              — {session.company}
            </span>
          )}
        </div>

        <div style={{ flex: 1 }}/>

        <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 5, alignItems: 'center' }}>
          {screen === 'session' && (
            <button onClick={() => setScreen('setup')} style={hBtn} title="Back to setup">←</button>
          )}
          <button onClick={signOut}                    style={hBtn} title="Sign out">↩</button>
          <button onClick={() => setMinimized(true)}   style={{ ...hBtn, paddingInline: 10 }}>−</button>
        </div>
      </div>

      {/* Screen router */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {screen === 'setup'
          ? <SetupView
              docs={docs} session={session}
              onDocsChange={setDocs}
              onSessionChange={saveSession}
              onStart={() => setScreen('session')}
              onPractice={() => setScreen('practice')}
            />
          : screen === 'practice'
          ? <PracticeView docs={docs} session={session} onEnd={() => setScreen('setup')} />
          : <SessionView docs={docs} session={session} />
        }
      </div>
    </div>
  )
}

// ─── Setup view ───────────────────────────────────────────────────────────────
function SetupView({ docs, session, onDocsChange, onSessionChange, onStart, onPractice }: {
  docs: LocalDocument[]
  session: SessionContext
  onDocsChange: (d: LocalDocument[]) => void
  onSessionChange: (s: SessionContext) => void
  onStart: () => void
  onPractice: () => void
}) {
  const { user } = useAuth()
  const [resumeMode, setResumeMode] = useState<'pdf' | 'text'>(
    docs.some(d => d.name === '__resume_text__') ? 'text' : 'pdf'
  )
  const [resumeText, setResumeText] = useState(
    () => docs.find(d => d.name === '__resume_text__')?.text_content ?? ''
  )
  const [jdMode,     setJdMode]     = useState<'text' | 'pdf'>('text')
  const [shareMode,  setShareMode]  = useState<ShareMode>(
    () => (localStorage.getItem('ao_screen_share_mode') as ShareMode) ?? 'full-hidden'
  )
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync stored mode to Electron on first mount (so the window is always in the correct state)
  useEffect(() => {
    const stored = (localStorage.getItem('ao_screen_share_mode') as ShareMode) ?? 'full-hidden'
    window.electronAPI?.setScreenShareMode(stored)
  }, [])

  function field(key: keyof SessionContext, val: string) {
    onSessionChange({ ...session, [key]: val })
  }

  function handleResumeText(text: string) {
    setResumeText(text)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const without = docs.filter(d => d.name !== '__resume_text__')
      if (text.trim().length > 20) {
        const sess = JSON.parse(localStorage.getItem('ao_assistant_session') || '{}')
        const doc  = saveLocalDocument({
          user_email: sess.email || (user?.email ?? 'local'),
          name: '__resume_text__',
          size: text.length,
          text_content: text,
        })
        onDocsChange([doc, ...without])
      } else {
        onDocsChange(without)
      }
    }, 800)
  }

  function applyShareMode(mode: ShareMode) {
    setShareMode(mode)
    localStorage.setItem('ao_screen_share_mode', mode)
    window.electronAPI?.setScreenShareMode(mode)
  }

  const hasResume = resumeMode === 'text'
    ? resumeText.trim().length > 50
    : docs.some(d => d.name !== '__resume_text__')
  const ready   = hasResume && !!session.company && !!session.position
  const pdfDocs = docs.filter(d => d.name !== '__resume_text__')

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 16px' }}>

      {/* Company + Position */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <CompactField label="Company *" value={session.company  || ''} onChange={v => field('company',  v)} placeholder="Google, Stripe…" />
        <CompactField label="Role *"    value={session.position || ''} onChange={v => field('position', v)} placeholder="SWE, PM…" />
      </div>

      {/* Resume */}
      <CardSection
        label="Resume" required
        tabs={[{ id: 'pdf', label: 'PDF' }, { id: 'text', label: 'Paste' }]}
        active={resumeMode} onTab={v => setResumeMode(v as 'pdf' | 'text')}
      >
        {resumeMode === 'pdf' ? (
          <DocumentUpload
            docs={pdfDocs.filter(d => d.name.toLowerCase().includes('resume') || d.name.toLowerCase().includes('cv'))}
            onDocsChange={newDocs => {
              const others  = pdfDocs.filter(d => !d.name.toLowerCase().includes('resume') && !d.name.toLowerCase().includes('cv'))
              const textDoc = docs.find(d => d.name === '__resume_text__')
              onDocsChange([...newDocs, ...others, ...(textDoc ? [textDoc] : [])])
            }}
            label="Drop resume PDF"
          />
        ) : (
          <textarea
            value={resumeText}
            onChange={e => handleResumeText(e.target.value)}
            placeholder="Paste your full resume text…"
            rows={5} style={TA}
          />
        )}
      </CardSection>

      {/* Job Description */}
      <CardSection
        label="Job Description"
        tabs={[{ id: 'text', label: 'Paste' }, { id: 'pdf', label: 'PDF' }]}
        active={jdMode} onTab={v => setJdMode(v as 'text' | 'pdf')}
      >
        {jdMode === 'text' ? (
          <textarea
            value={session.jobDescription || ''}
            onChange={e => field('jobDescription', e.target.value)}
            placeholder="Paste the job description…"
            rows={4} style={TA}
          />
        ) : (
          <DocumentUpload
            docs={pdfDocs.filter(d => d.name.toLowerCase().includes('jd') || d.name.toLowerCase().includes('job') || d.name.toLowerCase().includes('description'))}
            onDocsChange={newDocs => {
              const others  = pdfDocs.filter(d => !d.name.toLowerCase().includes('jd') && !d.name.toLowerCase().includes('job') && !d.name.toLowerCase().includes('description'))
              const textDoc = docs.find(d => d.name === '__resume_text__')
              onDocsChange([...newDocs, ...others, ...(textDoc ? [textDoc] : [])])
            }}
            label="Drop JD PDF"
          />
        )}
      </CardSection>

      {/* Screen Privacy */}
      <div style={{ marginBottom: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 12px', borderRadius: 9,
          background: shareMode !== 'off' ? 'rgba(255,255,255,0.07)' : 'rgba(255,60,60,0.12)',
          border: shareMode !== 'off' ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,60,60,0.30)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14 }}>{shareMode !== 'off' ? '🛡' : '⚠️'}</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: shareMode !== 'off' ? 'rgba(255,255,255,0.88)' : 'rgba(255,120,120,0.95)' }}>
                {shareMode !== 'off' ? 'Screen Protected' : 'Protection OFF — visible to interviewer!'}
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.30)', marginTop: 1 }}>
                {shareMode !== 'off'
                  ? 'Window hidden from Zoom, Teams, Meet, OBS — all capture tools'
                  : 'Do not share your screen while protection is disabled'}
              </div>
            </div>
          </div>
          {shareMode !== 'off' ? (
            <button
              onClick={() => {
                if (window.confirm('Disable screen protection? This window will become VISIBLE to screen sharing tools. Only do this for local testing.')) {
                  applyShareMode('off')
                }
              }}
              style={{
                padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 9,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.30)',
              }}
            >dev off</button>
          ) : (
            <button
              onClick={() => applyShareMode('full-hidden')}
              style={{
                padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.28)',
                color: 'rgba(255,255,255,0.90)',
              }}
            >Enable Protection</button>
          )}
        </div>
      </div>

      {/* Validation hint */}
      {!ready && (
        <p style={{ fontSize: 11, color: 'rgba(255,190,0,0.65)', marginBottom: 8 }}>
          {!session.company  ? '⚠ Add company  ' : ''}
          {!session.position ? '⚠ Add role  '    : ''}
          {!hasResume        ? '⚠ Add resume'     : ''}
        </p>
      )}

      {/* Start */}
      <button onClick={onStart} disabled={!ready} style={{
        width: '100%', padding: '11px 0', borderRadius: 10,
        cursor: ready ? 'pointer' : 'not-allowed',
        background: ready ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.04)',
        border: ready ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.07)',
        color: ready ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.22)',
        fontSize: 13, fontWeight: 700, transition: 'all 0.15s',
      }}>
        Start Interview →
      </button>

      {/* Practice Mode */}
      <button onClick={onPractice} disabled={!ready} style={{
        width: '100%', padding: '8px 0', borderRadius: 10, marginTop: 6,
        cursor: ready ? 'pointer' : 'not-allowed',
        background: 'transparent',
        border: ready ? '1px solid rgba(167,139,250,0.22)' : '1px solid rgba(255,255,255,0.05)',
        color: ready ? 'rgba(167,139,250,0.70)' : 'rgba(255,255,255,0.14)',
        fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
      }}>
        🎭 Practice Run first
      </button>
    </div>
  )
}

// ─── Practice view ────────────────────────────────────────────────────────────
function PracticeView({ docs, session, onEnd }: {
  docs: LocalDocument[]
  session: SessionContext
  onEnd: () => void
}) {
  const [question,  setQuestion]  = useState('')
  const [answer,    setAnswer]    = useState('')
  const [keyPts,    setKeyPts]    = useState<string[]>([])
  const [speakSec,  setSpeakSec]  = useState(0)
  const [streaming, setStreaming] = useState(false)
  const [score,     setScore]     = useState({ good: 0, redo: 0 })
  const [rated,     setRated]     = useState<'good' | 'redo' | null>(null)
  const answerRef   = useRef('')
  const abortRef    = useRef<AbortController | null>(null)
  const bodyRef     = useRef<HTMLDivElement>(null)

  function renderMd(text: string) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.10);padding:1px 5px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/^[-•] (.+)$/gm, '<p style="margin:2px 0 2px 10px">• $1</p>')
      .replace(/\n/g, '<br/>')
  }

  async function ask(q: string) {
    if (!q.trim() || streaming) return
    abortRef.current?.abort()
    answerRef.current = ''
    setAnswer('')
    setKeyPts([])
    setSpeakSec(0)
    setRated(null)
    setStreaming(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      await streamAnswer({
        systemPrompt: buildSystemPrompt(docs, '', session),
        userMessage: `TRANSCRIPT (last heard): "${q}"\n\nIdentify the interview question and give a perfect answer. No preamble.`,
        signal: ctrl.signal,
        onChunk: chunk => {
          answerRef.current += chunk
          setAnswer(answerRef.current)
          if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
        },
        onDone: () => {
          setStreaming(false)
          const a = answerRef.current
          if (a) {
            const wc = a.split(/\s+/).filter(Boolean).length
            setSpeakSec(Math.round(wc / 130 * 60))
            generateKeyPoints(a).then(setKeyPts)
          }
        },
      })
    } catch {
      setStreaming(false)
    }
  }

  function rate(r: 'good' | 'redo') {
    setRated(r)
    setScore(s => ({ ...s, [r]: s[r] + 1 }))
    if (r === 'redo') {
      setTimeout(() => ask(question), 300)
    }
  }

  const SAMPLE_QS = [
    'Tell me about yourself.',
    'Describe a time you led through a crisis.',
    'What\'s your greatest weakness?',
    'Why do you want to work here?',
    'Tell me about a conflict with a coworker.',
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(167,139,250,0.80)', flex: 1 }}>
          🎭 Practice Mode
        </span>
        <span style={{ fontSize: 10, color: 'rgba(74,222,128,0.70)', fontWeight: 700 }}>✓ {score.good}</span>
        <span style={{ fontSize: 10, color: 'rgba(248,113,113,0.70)', fontWeight: 700, marginLeft: 6 }}>↺ {score.redo}</span>
        <button onClick={onEnd} style={{
          marginLeft: 8, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 700,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.45)',
        }}>End</button>
      </div>

      {/* Key points flash */}
      {keyPts.length > 0 && (
        <div style={{
          padding: '7px 14px 6px', flexShrink: 0,
          background: 'rgba(124,58,237,0.09)', borderBottom: '1px solid rgba(124,58,237,0.18)',
        }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.09em', color: 'rgba(167,139,250,0.55)', marginBottom: 5 }}>
            KEY POINTS — SCAN THESE FIRST
          </div>
          {keyPts.map((pt, i) => (
            <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 3, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 11, color: 'rgba(167,139,250,0.7)', fontWeight: 800, flexShrink: 0 }}>{['①','②','③'][i]}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,0.90)', lineHeight: 1.35 }}>{pt}</span>
            </div>
          ))}
        </div>
      )}

      {/* Answer area */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', fontSize: 12.5, lineHeight: 1.72, color: 'rgba(255,255,255,0.85)' }}>
        {answer ? (
          <>
            <span dangerouslySetInnerHTML={{ __html: renderMd(answer) }} />
            {streaming && <span style={{ display: 'inline-block', width: 2, height: 13, marginLeft: 3, borderRadius: 2, background: 'rgba(255,255,255,0.7)', verticalAlign: 'middle' }}/>}
            {!streaming && speakSec > 0 && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 2, borderRadius: 2, background: 'rgba(255,255,255,0.07)' }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    width: speakSec <= 45 ? '55%' : speakSec <= 65 ? '75%' : '100%',
                    background: speakSec <= 45 ? 'rgba(74,222,128,0.6)' : speakSec <= 65 ? 'rgba(251,191,36,0.6)' : 'rgba(248,113,113,0.6)',
                  }}/>
                </div>
                <span style={{ fontSize: 9, fontWeight: 700, color: speakSec <= 45 ? 'rgba(74,222,128,0.7)' : speakSec <= 65 ? 'rgba(251,191,36,0.8)' : 'rgba(248,113,113,0.8)', flexShrink: 0 }}>
                  ~{speakSec}s to speak
                </span>
              </div>
            )}
          </>
        ) : (
          <div>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', marginBottom: 12 }}>
              Type a practice question below or tap one to start.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {SAMPLE_QS.map((q, i) => (
                <button key={i} onClick={() => { setQuestion(q); ask(q) }} style={{
                  textAlign: 'left', padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
                  fontSize: 11, color: 'rgba(255,255,255,0.58)', lineHeight: 1.4,
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Rate buttons — shown after answer is done */}
      {answer && !streaming && !rated && (
        <div style={{ display: 'flex', gap: 6, padding: '6px 14px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.28)', alignSelf: 'center', flex: 1 }}>How did that feel?</span>
          <button onClick={() => rate('good')} style={{
            padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
            background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.25)', color: 'rgba(74,222,128,0.85)',
          }}>✓ Good</button>
          <button onClick={() => rate('redo')} style={{
            padding: '5px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700,
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: 'rgba(248,113,113,0.75)',
          }}>↺ Redo</button>
        </div>
      )}
      {rated && (
        <div style={{ padding: '5px 14px', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 10, color: rated === 'good' ? 'rgba(74,222,128,0.70)' : 'rgba(248,113,113,0.70)', fontWeight: 700 }}>
          {rated === 'good' ? '✓ Marked good — next question below' : '↺ Retrying…'}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 14px 10px', flexShrink: 0 }}>
        <input
          type="text" value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') ask(question) }}
          placeholder="Type any interview question…"
          style={{
            flex: 1, padding: '7px 10px', borderRadius: 8, outline: 'none', fontSize: 11,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)',
            color: 'rgba(255,255,255,0.82)',
          }}
        />
        <button onClick={() => ask(question)} disabled={!question.trim() || streaming} style={{
          padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700,
          background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.25)',
          color: 'rgba(167,139,250,0.85)',
        }}>Ask →</button>
      </div>
    </div>
  )
}

// ─── Session view ─────────────────────────────────────────────────────────────
function SessionView({ docs, session }: { docs: LocalDocument[]; session: SessionContext }) {
  const [transcript,       setTranscript]       = useState('')
  const [liveAnswer,       setLiveAnswer]       = useState('')
  const [history,          setHistory]          = useState<string[]>([])
  const [historyIdx,       setHistoryIdx]       = useState(-1)
  const [currentQuestion,  setCurrentQuestion]  = useState('')
  const [generating,       setGenerating]       = useState(false)
  const [screenCtx,        setScreenCtx]        = useState('')
  const [captureActive,    setCaptureActive]    = useState(true)
  const [answerStyle,      setAnswerStyle]      = useState<'normal' | 'short' | 'star'>('normal')
  const [aiError,          setAiError]          = useState('')
  const [manualQ,          setManualQ]          = useState('')
  const [pttActive,        setPttActive]        = useState(false)
  const [pttTranscribing,  setPttTranscribing]  = useState(false)
  const [copied,           setCopied]           = useState(false)
  const [showTranscript,   setShowTranscript]   = useState(true)
  const [shieldActive,     setShieldActive]     = useState(true)
  const [followUps,        setFollowUps]        = useState<string[]>([])
  const [followUpsLoading, setFollowUpsLoading] = useState(false)
  const [qaLog,            setQaLog]            = useState<{q: string; a: string}[]>([])
  const [keyPoints,        setKeyPoints]        = useState<string[]>([])
  const [keyPointsLoading, setKeyPointsLoading] = useState(false)
  const [speakTime,        setSpeakTime]        = useState(0)
  const [autoSwitched,     setAutoSwitched]     = useState<'code' | null>(null)

  // Coding solver state
  const [sessionMode,  setSessionMode]  = useState<'interview' | 'code'>(
    () => (localStorage.getItem('ao_session_mode') as 'interview' | 'code') ?? 'interview'
  )
  const [codingLang,   setCodingLang]   = useState<CodingLang>(
    () => (localStorage.getItem('ao_coding_lang') as CodingLang) ?? 'python'
  )
  const [codeSolving,  setCodeSolving]  = useState(false)
  const [codeRaw,      setCodeRaw]      = useState('')
  const [codeScanning, setCodeScanning] = useState(false)

  const abortRef          = useRef<AbortController | null>(null)
  const codeAbortRef      = useRef<AbortController | null>(null)
  const captureTimer      = useRef<ReturnType<typeof setInterval> | null>(null)
  const answerRef         = useRef('')
  const codeRawRef        = useRef('')
  const transcriptRef     = useRef('')
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pttRef            = useRef<{ recorder: MediaRecorder; chunks: Blob[] } | null>(null)
  const generateAnswerRef  = useRef<(text: string) => void>(() => {})
  const scanAndSolveRef    = useRef<() => void>(() => {})
  const answerBodyRef      = useRef<HTMLDivElement>(null)
  const codeBodyRef        = useRef<HTMLDivElement>(null)
  const sessionModeRef     = useRef<'interview' | 'code'>('interview')
  // Cooldown: don't auto-trigger a new answer for 20s after one starts
  const lastAnswerTimeRef  = useRef(0)
  // Accumulates chunks for the CURRENT question; resets after each answer fires
  const currentQRef        = useRef('')

  const shownAnswer = historyIdx === -1 ? liveAnswer : (history[historyIdx] ?? '')

  // Auto-scroll answer while streaming
  useEffect(() => {
    if (answerBodyRef.current && historyIdx === -1) {
      answerBodyRef.current.scrollTop = answerBodyRef.current.scrollHeight
    }
  }, [liveAnswer, historyIdx])

  // Screen capture every 12s
  useEffect(() => {
    captureTimer.current = setInterval(async () => {
      if (!captureActive) return
      const b64 = await window.electronAPI?.captureScreen()
      if (!b64) return
      const q = transcriptRef.current.slice(-300)
      if (!q) return
      const ctx = await analyzeScreen(b64, q)
      if (ctx) setScreenCtx(ctx)
    }, 12000)
    return () => { if (captureTimer.current) clearInterval(captureTimer.current) }
  }, [captureActive])

  // Enforce protection on session mount + subscribe to status changes
  useEffect(() => {
    window.electronAPI?.enforceProtection()
    window.electronAPI?.getProtectionStatus().then(v => setShieldActive(v ?? true))
    window.electronAPI?.onProtectionStatus(v => setShieldActive(v))
    return () => window.electronAPI?.removeAllListeners('protection-status')
  }, [])

  // Global hotkeys
  useEffect(() => {
    window.electronAPI?.onToggleListening(() => {
      if (recorder.isListening) stopListening()
      else recorder.startListening()
    })
    window.electronAPI?.onGenerateAnswer(() => {
      const q = transcriptRef.current.slice(-600).trim()
      if (q) generateAnswerRef.current(q)
    })
    window.electronAPI?.onCaptureNow(async () => {
      if (sessionModeRef.current === 'code') {
        scanAndSolveRef.current()
      } else {
        const b64 = await window.electronAPI?.captureScreen()
        if (b64 && transcriptRef.current) {
          const ctx = await analyzeScreen(b64, transcriptRef.current.slice(-300))
          if (ctx) setScreenCtx(ctx)
          generateAnswerRef.current(transcriptRef.current.slice(-600))
        }
      }
    })
    return () => {
      window.electronAPI?.removeAllListeners('hotkey:toggle-listening')
      window.electronAPI?.removeAllListeners('hotkey:generate-answer')
      window.electronAPI?.removeAllListeners('hotkey:capture-now')
    }
  }, [])

  // Arrow key history nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape' && historyIdx !== -1) setHistoryIdx(-1)
      if (e.key === 'ArrowLeft')  setHistoryIdx(i => i === -1 ? history.length - 2 : Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setHistoryIdx(i => i === -1 ? -1 : (i + 1 >= history.length ? -1 : i + 1))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [history, historyIdx])

  function stopListening() {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    recorder.stopListening()
  }

  const onTranscriptChunk = useCallback((chunk: string) => {
    // Update rolling transcript (for display + screen context)
    setTranscript(prev => {
      const updated = (prev ? `${prev} ${chunk}` : chunk).slice(-3000)
      transcriptRef.current = updated
      return updated
    })

    // Accumulate chunks for the CURRENT question (resets after each answer fires)
    currentQRef.current = `${currentQRef.current} ${chunk}`.trim().slice(-800)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    const question = currentQRef.current
    const wordCount = question.split(/\s+/).length
    const cooldownElapsed = Date.now() - lastAnswerTimeRef.current > 20_000

    if (!cooldownElapsed) return

    // Auto-switch to code solver if the transcript sounds like a coding problem
    if (sessionModeRef.current === 'interview' && isCodingProblem(question)) {
      setSessionMode('code')
      sessionModeRef.current = 'code'
      localStorage.setItem('ao_session_mode', 'code')
      setAutoSwitched('code')
      setTimeout(() => setAutoSwitched(null), 3500)
    }

    // After each 5s chunk, schedule a trigger with a 1.5s silence window.
    // This lets the interviewer finish their sentence before we answer.
    if (wordCount >= 6 && isQuestion(question)) {
      debounceRef.current = setTimeout(() => {
        const q = currentQRef.current.trim()
        if (q && isQuestion(q) && Date.now() - lastAnswerTimeRef.current > 20_000) {
          currentQRef.current = ''  // reset accumulator for next question
          generateAnswerRef.current(q)
        }
      }, 1500)
    }
  }, [])

  const recorder = useAudioRecorder(onTranscriptChunk)

  async function pttStart() {
    if (pttRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec    = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      const chunks: Blob[] = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      rec.start(100)
      pttRef.current = { recorder: rec, chunks }
      setPttActive(true)
    } catch { /* denied */ }
  }

  async function pttStop() {
    if (!pttRef.current) return
    const { recorder: rec, chunks } = pttRef.current
    pttRef.current = null
    setPttActive(false)
    rec.stop()
    await new Promise<void>(r => rec.addEventListener('stop', () => r(), { once: true }))
    rec.stream.getTracks().forEach(t => t.stop())
    if (!chunks.length) return
    const blob = new Blob(chunks, { type: 'audio/webm' })
    if (blob.size < 3000) return
    setPttTranscribing(true)
    try {
      const text = await transcribeAudio(blob)
      if (text) {
        setTranscript(prev => {
          const updated = (prev ? `${prev} ${text}` : text).slice(-3000)
          transcriptRef.current = updated
          return updated
        })
        generateAnswerRef.current(text)
      }
    } catch (e) {
      setAiError(`Transcription: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPttTranscribing(false)
    }
  }

  function styleInstruction(s: 'normal' | 'short' | 'star') {
    if (s === 'short') return '\n\nIMPORTANT: Keep your answer to 2 sentences max. Ultra concise.'
    if (s === 'star')  return '\n\nIMPORTANT: Make the STAR structure very clear — Situation in sentence 1, Action in sentence 2-3, Result with a number in the final sentence.'
    return ''
  }

  function buildUserMessage(raw: string) {
    const sentences = raw.trim().split(/(?<=[.!?])\s+/)
    const lastFew   = sentences.slice(-4).join(' ')
    return [
      `TRANSCRIPT (last heard): "${lastFew}"`,
      '',
      'Identify the interview question in the transcript above.',
      'Apply the matching format from your instructions.',
      'Give the answer immediately — no preamble, no "Sure!", just the answer.',
    ].join('\n')
  }

  const generateAnswer = useCallback(async (text: string) => {
    setAiError('')
    abortRef.current?.abort()
    answerRef.current = ''
    setLiveAnswer('')
    setHistoryIdx(-1)
    setCurrentQuestion(text.slice(0, 140))
    setGenerating(true)
    lastAnswerTimeRef.current = Date.now()
    currentQRef.current = ''  // reset accumulator so next question starts fresh

    const ctrl = new AbortController()
    abortRef.current   = ctrl
    const systemPrompt = buildSystemPrompt(docs, screenCtx, session) + styleInstruction(answerStyle)

    try {
      await streamAnswer({
        systemPrompt,
        userMessage: buildUserMessage(text),
        signal: ctrl.signal,
        onChunk: chunk => {
          answerRef.current += chunk
          setLiveAnswer(answerRef.current)
        },
        onDone: () => {
          setGenerating(false)
          if (answerRef.current) {
            setHistory(prev => [...prev.slice(-4), answerRef.current])
            const q = text.slice(0, 200)
            const a = answerRef.current
            setQaLog(prev => [...prev, { q, a }])
            // Pace guide: ~130 words/min average speaking rate
            const wordCount = a.split(/\s+/).filter(Boolean).length
            setSpeakTime(Math.round(wordCount / 130 * 60))
            // Key points flash
            setKeyPoints([])
            setKeyPointsLoading(true)
            generateKeyPoints(a)
              .then(pts => setKeyPoints(pts))
              .finally(() => setKeyPointsLoading(false))
            // Follow-up predictions
            setFollowUps([])
            setFollowUpsLoading(true)
            generateFollowUps(q, a, session)
              .then(fus => setFollowUps(fus))
              .finally(() => setFollowUpsLoading(false))
          }
        },
      })
    } catch (e) {
      setGenerating(false)
      if (e instanceof Error && e.name !== 'AbortError') setAiError(e.message)
    }
  }, [docs, screenCtx, session, answerStyle])

  useEffect(() => { generateAnswerRef.current = generateAnswer }, [generateAnswer])
  useEffect(() => { sessionModeRef.current = sessionMode }, [sessionMode])

  // ── Code solver ──────────────────────────────────────────────────────────────
  const generateCodeSolution = useCallback(async (base64: string | null, transcript: string) => {
    setAiError('')
    codeAbortRef.current?.abort()
    codeRawRef.current = ''
    setCodeRaw('')
    setCodeSolving(true)

    const systemPrompt = buildCodingSystemPrompt(codingLang, session)
    const userMessage  = base64
      ? JSON.stringify([
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64.split(',')[1] } },
          { type: 'text',  text: transcript
              ? `The interviewer said: "${transcript.slice(-400)}"\n\nSolve the coding problem shown in the screenshot.`
              : 'Solve the coding problem shown in the screenshot.' },
        ])
      : `Coding problem stated by interviewer: "${transcript.slice(-600)}"\n\nSolve it completely.`

    try {
      await streamAnswer({
        systemPrompt,
        userMessage,
        onChunk: chunk => {
          codeRawRef.current += chunk
          setCodeRaw(codeRawRef.current)
          if (codeBodyRef.current) codeBodyRef.current.scrollTop = codeBodyRef.current.scrollHeight
        },
        onDone: () => setCodeSolving(false),
      })
    } catch (e) {
      setCodeSolving(false)
      if (e instanceof Error && e.name !== 'AbortError') setAiError(e.message)
    }
  }, [codingLang, session])

  const scanAndSolve = useCallback(async () => {
    setCodeScanning(true)
    const b64 = await window.electronAPI?.captureScreen() ?? null
    setCodeScanning(false)
    await generateCodeSolution(b64, transcriptRef.current)
  }, [generateCodeSolution])

  useEffect(() => { scanAndSolveRef.current = scanAndSolve }, [scanAndSolve])

  function parseCodeSections(raw: string) {
    const sec = (name: string) =>
      raw.match(new RegExp(`###\\s*${name}\\s*([\\s\\S]*?)(?=###|$)`, 'i'))?.[1]?.trim() ?? ''
    return {
      opening:     sec('OPENING'),
      solution:    sec('SOLUTION'),
      complexity:  sec('COMPLEXITY'),
      whileCoding: sec('WHILE CODING'),
      closing:     sec('CLOSING'),
    }
  }

  function renderMd(text: string) {
    return text
      .replace(/```(\w*)\n?([\s\S]*?)```/g,
        '<pre style="background:rgba(255,255,255,0.05);border-radius:6px;padding:8px 10px;font-size:11px;overflow-x:auto;margin:6px 0;border:1px solid rgba(255,255,255,0.08)"><code>$2</code></pre>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:rgba(255,255,255,0.96)">$1</strong>')
      .replace(/`([^`]+)`/g,
        '<code style="background:rgba(255,255,255,0.10);padding:1px 5px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/^[-•*] (.+)$/gm, '<p style="margin:2px 0 2px 10px">• $1</p>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>')
  }

  function copyAnswer() {
    if (!shownAnswer) return
    navigator.clipboard.writeText(shownAnswer)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function exportSession() {
    if (!qaLog.length) return
    const header = `AstraOffer Interview Session\n${session.position || 'Interview'} at ${session.company || 'Company'}\n${new Date().toLocaleString()}\n${'═'.repeat(48)}\n\n`
    const body = qaLog.map(({ q, a }, i) =>
      `Q${i + 1}: ${q}\n\n${a}\n\n${'─'.repeat(40)}`
    ).join('\n\n')
    const blob = new Blob([header + body], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const el   = document.createElement('a')
    el.href    = url
    el.download = `interview-${(session.company || 'session').replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.txt`
    el.click()
    URL.revokeObjectURL(url)
  }

  const isLive = recorder.isListening || pttActive || pttTranscribing

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Status row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: isLive ? 'rgba(255,255,255,0.85)' : generating ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.18)',
          boxShadow: isLive ? '0 0 0 3px rgba(255,255,255,0.10)' : 'none',
        }}/>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', flex: 1 }}>
          {pttTranscribing ? 'Transcribing…'
           : pttActive      ? 'Recording…'
           : recorder.isListening ? 'Listening…'
           : generating     ? 'Generating…'
           : 'Ready'}
        </span>
        {/* Shield badge — always visible so user knows protection state */}
        <span
          title={shieldActive ? 'Screen protected — invisible to Zoom/Teams/Meet' : 'Protection OFF — window visible to screen share!'}
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.03em',
            color: shieldActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,80,80,0.90)',
            padding: '2px 6px', borderRadius: 4,
            background: shieldActive ? 'rgba(255,255,255,0.07)' : 'rgba(255,0,0,0.12)',
            border: shieldActive ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(255,0,0,0.25)',
          }}
        >
          {shieldActive ? '🛡' : '⚠️ EXPOSED'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {history.length > 1 && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)', marginRight: 2 }}>
              {historyIdx === -1 ? history.length : historyIdx + 1}/{history.length}
            </span>
          )}
          {history.length > 1 && (
            <>
              <button
                onClick={() => setHistoryIdx(i => i === -1 ? history.length - 2 : Math.max(0, i - 1))}
                disabled={historyIdx === 0}
                style={SB}
              >‹</button>
              <button
                onClick={() => setHistoryIdx(i => i >= history.length - 1 ? -1 : i + 1)}
                disabled={historyIdx === -1}
                style={SB}
              >›</button>
            </>
          )}
          {generating && (
            <button onClick={() => { abortRef.current?.abort(); setGenerating(false) }} style={SB}>⏹</button>
          )}
          <button
            onClick={() => setCaptureActive(v => !v)}
            style={{ ...SB, color: captureActive ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.18)' }}
            title="Screen AI"
          >◉</button>
        </span>
      </div>

      {/* Warning (mic fallback info — amber, not red) */}
      {recorder.warning && !recorder.error && (
        <div style={{
          padding: '5px 14px', fontSize: 11,
          color: 'rgba(255,200,80,0.9)',
          background: 'rgba(255,180,0,0.06)',
          borderBottom: '1px solid rgba(255,180,0,0.10)',
          flexShrink: 0,
        }}>{recorder.warning}</div>
      )}

      {/* Error */}
      {(aiError || recorder.error) && (
        <div style={{
          padding: '5px 14px', fontSize: 11,
          color: 'rgba(255,100,100,0.9)',
          background: 'rgba(255,0,0,0.06)',
          borderBottom: '1px solid rgba(255,0,0,0.10)',
          flexShrink: 0,
        }}>{aiError || recorder.error}</div>
      )}

      {/* Mode tabs */}
      <div style={{
        display: 'flex', gap: 0, flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        {(['interview', 'code'] as const).map(m => (
          <button key={m} onClick={() => { setSessionMode(m); localStorage.setItem('ao_session_mode', m) }} style={{
            flex: 1, padding: '6px 0', cursor: 'pointer', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase', transition: 'all 0.15s',
            background: sessionMode === m ? 'rgba(255,255,255,0.07)' : 'transparent',
            borderBottom: sessionMode === m ? '2px solid rgba(255,255,255,0.55)' : '2px solid transparent',
            border: 'none', borderBottomStyle: 'solid',
            borderBottomWidth: 2,
            borderBottomColor: sessionMode === m ? 'rgba(255,255,255,0.55)' : 'transparent',
            color: sessionMode === m ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.25)',
          }}>
            {m === 'interview' ? '🎤 Interview' : '💻 Code Solver'}
          </button>
        ))}
      </div>

      {/* Auto-switch toast */}
      {autoSwitched && (
        <div style={{
          padding: '5px 14px', fontSize: 10, fontWeight: 700, flexShrink: 0,
          background: 'rgba(124,58,237,0.14)', borderBottom: '1px solid rgba(124,58,237,0.25)',
          color: 'rgba(167,139,250,0.95)', letterSpacing: '0.03em',
        }}>
          ⚡ Coding problem detected — switched to Code Solver
        </div>
      )}

      {/* Transcript strip */}
      <div
        onClick={() => setShowTranscript(v => !v)}
        style={{
          padding: '5px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          flexShrink: 0, cursor: 'pointer',
        }}
      >
        {showTranscript && transcript ? (
          <p style={{
            fontSize: 11, fontStyle: 'italic',
            color: 'rgba(255,255,255,0.30)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', lineHeight: 1.5, margin: 0,
          }}>"{transcript.slice(-300)}"</p>
        ) : (
          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.16)', margin: 0, fontStyle: 'italic' }}>
            {transcript ? `"${transcript.slice(-70)}…"` : 'No transcript yet — tap 🎙 Listen to start'}
          </p>
        )}
      </div>

      {sessionMode === 'interview' ? (<>

        {/* Question label */}
        {currentQuestion && (
          <div style={{
            padding: '4px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            flexShrink: 0, display: 'flex', gap: 6, alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.20)', flexShrink: 0, paddingTop: 1, fontWeight: 700 }}>Q</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)', fontStyle: 'italic', lineHeight: 1.4 }}>
              {currentQuestion}
            </span>
          </div>
        )}

        {/* Key Points Flash — 3 scannable bullets shown while/after streaming */}
        {(keyPointsLoading || keyPoints.length > 0) && historyIdx === -1 && (
          <div style={{
            padding: '7px 14px 6px', flexShrink: 0,
            background: 'rgba(124,58,237,0.08)',
            borderBottom: '1px solid rgba(124,58,237,0.18)',
          }}>
            <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.09em', color: 'rgba(167,139,250,0.55)', marginBottom: 5 }}>
              KEY POINTS — SCAN THESE FIRST
            </div>
            {keyPointsLoading ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {[60, 80, 50].map((w, i) => (
                  <div key={i} style={{ height: 8, width: w, borderRadius: 4, background: 'rgba(167,139,250,0.15)', animation: 'pulse 1.4s ease infinite' }}/>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {keyPoints.map((pt, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                    <span style={{ fontSize: 11, color: 'rgba(167,139,250,0.7)', flexShrink: 0, fontWeight: 800, marginTop: 1 }}>
                      {['①','②','③'][i]}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(255,255,255,0.90)', lineHeight: 1.35 }}>{pt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AI Answer */}
        <div ref={answerBodyRef} style={{
          flex: 1, overflowY: 'auto', padding: '10px 14px',
          fontSize: 12.5, lineHeight: 1.72, color: 'rgba(255,255,255,0.88)',
        }}>
          {shownAnswer ? (
            <>
              <span dangerouslySetInnerHTML={{ __html: renderMd(shownAnswer) }} />
              {generating && historyIdx === -1 && (
                <span style={{
                  display: 'inline-block', width: 2, height: 13, marginLeft: 3,
                  borderRadius: 2, verticalAlign: 'middle',
                  background: 'rgba(255,255,255,0.7)',
                }}/>
              )}
              {/* Pace guide — shown once answer is done streaming */}
              {!generating && speakTime > 0 && historyIdx === -1 && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 2, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2,
                      width: speakTime <= 30 ? '30%' : speakTime <= 45 ? '55%' : speakTime <= 60 ? '75%' : '100%',
                      background: speakTime <= 45 ? 'rgba(74,222,128,0.6)' : speakTime <= 65 ? 'rgba(251,191,36,0.6)' : 'rgba(248,113,113,0.6)',
                    }}/>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', flexShrink: 0,
                    color: speakTime <= 45 ? 'rgba(74,222,128,0.7)' : speakTime <= 65 ? 'rgba(251,191,36,0.8)' : 'rgba(248,113,113,0.8)',
                  }}>
                    ~{speakTime}s to speak
                  </span>
                </div>
              )}
            </>
          ) : (
            <span style={{ color: 'rgba(255,255,255,0.18)', fontStyle: 'italic', fontSize: 12 }}>
              {generating ? 'Generating answer…' : 'AI answer appears here'}
            </span>
          )}
        </div>

        {/* Follow-up predictions */}
        {(followUpsLoading || followUps.length > 0) && historyIdx === -1 && !generating && (
          <div style={{
            padding: '5px 14px 6px', flexShrink: 0,
            borderTop: '1px solid rgba(255,255,255,0.04)',
          }}>
            <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.20)', marginBottom: 4 }}>
              LIKELY FOLLOW-UPS
            </div>
            {followUpsLoading ? (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.20)', fontStyle: 'italic' }}>Predicting…</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {followUps.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => generateAnswer(q)}
                    style={{
                      textAlign: 'left', padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
                      fontSize: 10, color: 'rgba(255,255,255,0.52)', lineHeight: 1.4,
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.09)'
                      ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.80)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
                      ;(e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.52)'
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Style + copy row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '6px 14px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0,
        }}>
          {(['normal','short','star'] as const).map(s => (
            <button key={s} onClick={() => setAnswerStyle(s)} style={{
              padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
              fontSize: 10, fontWeight: 600, transition: 'all 0.15s',
              background: answerStyle === s ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.05)',
              border: answerStyle === s ? '1px solid rgba(255,255,255,0.22)' : '1px solid rgba(255,255,255,0.07)',
              color: answerStyle === s ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.32)',
            }}>
              {s === 'normal' ? 'Normal' : s === 'short' ? 'Short' : 'STAR'}
            </button>
          ))}
          <div style={{ flex: 1 }}/>
          {shownAnswer && (
            <button onClick={() => generateAnswer(transcriptRef.current.slice(-600))} style={IB} title="Regenerate">↺</button>
          )}
          {shownAnswer && (
            <button onClick={copyAnswer} style={{
              ...IB,
              background: copied ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)',
              color: copied ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.38)',
            }}>
              {copied ? '✓' : '⎘'}
            </button>
          )}
          {qaLog.length > 0 && (
            <button onClick={exportSession} style={{ ...IB, fontSize: 9, padding: '0 6px', width: 'auto' }} title="Export session notes">⬇</button>
          )}
          {transcript && (
            <button
              onClick={() => { setTranscript(''); transcriptRef.current = ''; setCurrentQuestion('') }}
              style={{ ...IB, fontSize: 9, padding: '0 6px', width: 'auto' }}
              title="Clear transcript"
            >clr</button>
          )}
        </div>

      </>) : (<>

        {/* ── Code Solver panel ── */}

        {/* Language + Scan row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px', flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          flexWrap: 'wrap',
        }}>
          {(CODING_LANGS as readonly string[]).map(lang => (
            <button key={lang} onClick={() => { setCodingLang(lang as CodingLang); localStorage.setItem('ao_coding_lang', lang) }} style={{
              padding: '2px 7px', borderRadius: 5, cursor: 'pointer',
              fontSize: 9, fontWeight: 700, transition: 'all 0.12s',
              background: codingLang === lang ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)',
              border: codingLang === lang ? '1px solid rgba(255,255,255,0.28)' : '1px solid rgba(255,255,255,0.07)',
              color: codingLang === lang ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.30)',
            }}>
              {lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : lang === 'python' ? 'py' : lang === 'cpp' ? 'c++' : lang === 'rust' ? 'rs' : lang === 'swift' ? 'sw' : lang}
            </button>
          ))}
          <div style={{ flex: 1 }}/>
          <button
            onClick={scanAndSolve}
            disabled={codeSolving || codeScanning}
            style={{
              padding: '4px 12px', borderRadius: 7, cursor: codeSolving || codeScanning ? 'not-allowed' : 'pointer',
              fontSize: 10, fontWeight: 700, transition: 'all 0.15s', flexShrink: 0,
              background: codeSolving || codeScanning ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: codeSolving || codeScanning ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.88)',
            }}
          >
            {codeScanning ? '📸 Scanning…' : codeSolving ? '⟳ Solving…' : '📸 Scan & Solve'}
          </button>
        </div>

        {/* ── Coaching sheet — all sections visible simultaneously ── */}
        <div ref={codeBodyRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 12px 4px' }}>
          {!codeRaw && !codeSolving ? (
            <span style={{ color: 'rgba(255,255,255,0.18)', fontStyle: 'italic', fontSize: 12 }}>
              Tap 📸 Scan &amp; Solve to capture the screen and get a complete coding guide.
              Works with HackerRank, LeetCode, CoderPad, and any shared screen.
            </span>
          ) : (() => {
            const { opening, solution, complexity, whileCoding, closing } = parseCodeSections(codeRaw)

            // Label shared styles
            const labelStyle: React.CSSProperties = {
              fontSize: 8, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase',
              marginBottom: 4, opacity: 0.45,
            }
            const speakBoxStyle: React.CSSProperties = {
              borderRadius: 7, padding: '7px 10px', marginBottom: 10,
              background: 'rgba(100,255,160,0.06)',
              border: '1px solid rgba(100,255,160,0.14)',
            }

            return (
              <div style={{ fontSize: 12, lineHeight: 1.65, color: 'rgba(255,255,255,0.88)' }}>

                {/* ── 1. OPENING — say before typing ── */}
                {(opening || (codeSolving && !solution)) && (
                  <div style={speakBoxStyle}>
                    <div style={{ ...labelStyle, color: 'rgba(100,255,160,0.75)' }}>
                      🗣 Say this FIRST (before you type)
                    </div>
                    {opening
                      ? <span style={{ color: 'rgba(200,255,220,0.90)', fontStyle: 'italic' }}>&ldquo;{opening}&rdquo;</span>
                      : <span style={{ color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>Crafting opening…</span>
                    }
                  </div>
                )}

                {/* ── 2. SOLUTION — code to type ── */}
                {(solution || codeSolving) && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ ...labelStyle, color: 'rgba(255,255,255,0.38)' }}>{ } Code to write</div>
                    {solution
                      ? <span dangerouslySetInnerHTML={{ __html: renderMd(solution) }} />
                      : <span style={{ color: 'rgba(255,255,255,0.28)', fontStyle: 'italic' }}>Writing code…</span>
                    }
                  </div>
                )}

                {/* ── 3. COMPLEXITY ── */}
                {complexity && (
                  <div style={{
                    fontFamily: 'monospace', fontSize: 10,
                    color: 'rgba(255,255,255,0.35)',
                    marginBottom: 10,
                    padding: '4px 8px', borderRadius: 5,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    {complexity}
                  </div>
                )}

                {/* ── 4. WHILE CODING — say as you type each line ── */}
                {(whileCoding || (codeSolving && solution)) && (
                  <div style={{
                    ...speakBoxStyle,
                    background: 'rgba(120,180,255,0.05)',
                    border: '1px solid rgba(120,180,255,0.12)',
                  }}>
                    <div style={{ ...labelStyle, color: 'rgba(120,180,255,0.70)' }}>
                      🗣 Say WHILE typing each part
                    </div>
                    {whileCoding ? (
                      <div style={{ color: 'rgba(190,215,255,0.88)' }}>
                        {/* Render numbered list with individual styling */}
                        {whileCoding.split('\n').filter(l => l.trim()).map((line, i) => (
                          <div key={i} style={{
                            display: 'flex', gap: 7, marginBottom: 4, alignItems: 'flex-start',
                          }}>
                            <span style={{
                              flexShrink: 0, fontFamily: 'monospace', fontSize: 10,
                              color: 'rgba(120,180,255,0.50)', marginTop: 1,
                            }}>
                              {line.match(/^(\d+)[.)]/)?.[1] ?? '•'}
                            </span>
                            <span style={{ fontStyle: 'italic' }}>
                              &ldquo;{line.replace(/^\d+[.)]\s*/, '').replace(/^[-•]\s*/, '')}&rdquo;
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>Building narration…</span>
                    )}
                  </div>
                )}

                {/* ── 5. CLOSING — say when done ── */}
                {closing && (
                  <div style={speakBoxStyle}>
                    <div style={{ ...labelStyle, color: 'rgba(100,255,160,0.75)' }}>
                      🗣 Say when you FINISH typing
                    </div>
                    <span style={{ color: 'rgba(200,255,220,0.90)', fontStyle: 'italic' }}>&ldquo;{closing}&rdquo;</span>
                  </div>
                )}

                {/* Streaming cursor */}
                {codeSolving && (
                  <span style={{
                    display: 'inline-block', width: 2, height: 12, borderRadius: 2,
                    background: 'rgba(255,255,255,0.55)', verticalAlign: 'middle',
                    marginLeft: 3,
                  }}/>
                )}
              </div>
            )
          })()}
        </div>

        {/* Code action row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px',
          borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0,
        }}>
          {codeSolving && (
            <button onClick={() => { codeAbortRef.current?.abort(); setCodeSolving(false) }} style={IB}>⏹</button>
          )}
          <div style={{ flex: 1 }}/>
          {codeRaw && (
            <button onClick={scanAndSolve} disabled={codeSolving || codeScanning} style={IB} title="Re-scan & solve">↺</button>
          )}
          {codeRaw && (
            <button
              onClick={() => {
                const { opening, solution, complexity, whileCoding, closing } = parseCodeSections(codeRaw)
                const text = [
                  opening  && `SAY FIRST:\n"${opening}"`,
                  solution && `CODE:\n${solution}`,
                  complexity,
                  whileCoding && `WHILE CODING:\n${whileCoding}`,
                  closing  && `SAY WHEN DONE:\n"${closing}"`,
                ].filter(Boolean).join('\n\n')
                navigator.clipboard.writeText(text)
                setCopied(true); setTimeout(() => setCopied(false), 2000)
              }}
              style={{ ...IB, background: copied ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)', color: copied ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.38)' }}
            >
              {copied ? '✓' : '⎘'}
            </button>
          )}
          {codeRaw && (
            <button onClick={() => { setCodeRaw(''); codeRawRef.current = '' }}
              style={{ ...IB, fontSize: 9, padding: '0 6px', width: 'auto' }}>clr</button>
          )}
        </div>

      </>)}

      {/* Audio source badge — shown only while listening */}
      {recorder.isListening && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 14px', flexShrink: 0,
          background: recorder.audioSource === 'system'
            ? 'rgba(0,200,100,0.07)'
            : 'rgba(255,140,0,0.08)',
          borderTop: recorder.audioSource === 'system'
            ? '1px solid rgba(0,200,100,0.14)'
            : '1px solid rgba(255,140,0,0.18)',
        }}>
          <span style={{ fontSize: 10 }}>
            {recorder.audioSource === 'system' ? '🔊' : '🎙'}
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
            color: recorder.audioSource === 'system'
              ? 'rgba(80,220,140,0.85)'
              : 'rgba(255,160,60,0.90)',
          }}>
            {recorder.audioSource === 'system'
              ? 'Interviewer audio only — your voice is NOT captured'
              : `Mic fallback${
                  window.electronAPI?.platform === 'darwin'  ? ' — allow Screen Recording in System Settings' :
                  window.electronAPI?.platform === 'linux'   ? ' — set up PulseAudio monitor sink' :
                  ''
                }`}</span>
        </div>
      )}

      {/* Control buttons */}
      <div style={{
        display: 'flex', gap: 6, padding: '6px 14px',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
      }}>
        <button
          onClick={() => recorder.isListening ? stopListening() : recorder.startListening()}
          style={{
            flex: 1, padding: '7px 4px', borderRadius: 8, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
            background: recorder.isListening ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
            border: recorder.isListening ? '1px solid rgba(255,255,255,0.26)' : '1px solid rgba(255,255,255,0.08)',
            color: recorder.isListening ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.42)',
          }}
        >
          {recorder.isListening ? '⏹ Stop' : '🔊 Listen'}
        </button>

        <button
          onMouseDown={pttStart} onMouseUp={pttStop} onMouseLeave={pttStop}
          title="Hold to record your question (uses microphone)"
          style={{
            flex: 1, padding: '7px 4px', borderRadius: 8, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, transition: 'all 0.15s', userSelect: 'none',
            background: pttActive ? 'rgba(255,255,255,0.14)' : pttTranscribing ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)',
            border: pttActive ? '1px solid rgba(255,255,255,0.30)' : '1px solid rgba(255,255,255,0.08)',
            color: pttActive ? 'rgba(255,255,255,0.90)' : pttTranscribing ? 'rgba(255,255,255,0.60)' : 'rgba(255,255,255,0.38)',
          }}
        >
          {pttActive ? '● Rec…' : pttTranscribing ? '⟳ …' : '🎙 Hold'}
        </button>

        <button
          onClick={() => { const q = transcriptRef.current.slice(-600).trim(); if (q) generateAnswer(q) }}
          disabled={!transcript}
          style={{
            flex: 1, padding: '7px 4px', borderRadius: 8,
            cursor: transcript ? 'pointer' : 'not-allowed',
            fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: transcript ? 'rgba(255,255,255,0.52)' : 'rgba(255,255,255,0.18)',
          }}
        >
          ⚡ Now
        </button>
      </div>

      {/* Manual input */}
      <div style={{ display: 'flex', gap: 6, padding: '5px 14px 8px', flexShrink: 0 }}>
        <input
          type="text"
          value={manualQ}
          onChange={e => setManualQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && manualQ.trim()) { generateAnswer(manualQ.trim()); setManualQ('') } }}
          placeholder="Type a question, press Enter…"
          style={{
            flex: 1, padding: '6px 10px', borderRadius: 8, outline: 'none',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.09)',
            color: 'rgba(255,255,255,0.82)', fontSize: 11,
          }}
        />
        <button
          onClick={() => { if (manualQ.trim()) { generateAnswer(manualQ.trim()); setManualQ('') } }}
          disabled={!manualQ.trim()}
          style={{
            padding: '6px 12px', borderRadius: 8,
            cursor: manualQ.trim() ? 'pointer' : 'not-allowed',
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.09)',
            color: 'rgba(255,255,255,0.50)', fontSize: 11,
          }}
        >→</button>
      </div>

      {/* Hotkey hints */}
      <div style={{ display: 'flex', gap: 10, padding: '0 14px 7px', flexShrink: 0, flexWrap: 'wrap' }}>
        {['⌘⇧H Stealth', '⌘⇧S Mic', '⌘G Answer', '⌘⇧C Capture'].map(h => (
          <span key={h} style={{ fontSize: 9, color: 'rgba(255,255,255,0.14)' }}>{h}</span>
        ))}
      </div>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function CompactField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div style={{ flex: 1 }}>
      <label style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.38)', marginBottom: 4, fontWeight: 600 }}>
        {label}
      </label>
      <input
        type="text" value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '7px 10px', borderRadius: 8, outline: 'none',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.09)',
          color: 'rgba(255,255,255,0.88)', fontSize: 12,
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

function CardSection({ label, required, tabs, active, onTab, children }: {
  label: string; required?: boolean
  tabs: { id: string; label: string }[]
  active: string; onTab: (id: string) => void
  children: React.ReactNode
}) {
  return (
    <div style={{
      marginBottom: 10,
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, overflow: 'hidden',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>
          {label}
          {required && <span style={{ color: 'rgba(255,255,255,0.30)', marginLeft: 3 }}>*</span>}
        </span>
        <div style={{ display: 'flex', gap: 3 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => onTab(t.id)} style={{
              padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
              fontSize: 10, fontWeight: 600, transition: 'all 0.12s',
              background:  active === t.id ? 'rgba(255,255,255,0.12)' : 'transparent',
              border:      active === t.id ? '1px solid rgba(255,255,255,0.18)' : '1px solid transparent',
              color:       active === t.id ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.28)',
            }}>{t.label}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  )
}

function Splash() {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10,10,10,0.83)',
      backdropFilter: 'blur(20px)', borderRadius: 16,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'rgba(255,255,255,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 10px', fontSize: 16, fontWeight: 800,
        }}>A</div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>Loading…</p>
      </div>
    </div>
  )
}

// ─── Style constants ──────────────────────────────────────────────────────────
const hBtn: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 6, border: 'none',
  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.42)',
  cursor: 'pointer', fontSize: 13,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const SB: React.CSSProperties = {
  width: 22, height: 20, borderRadius: 4, border: 'none',
  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.38)',
  cursor: 'pointer', fontSize: 13,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const IB: React.CSSProperties = {
  width: 28, height: 26, borderRadius: 6, border: 'none',
  background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.38)',
  cursor: 'pointer', fontSize: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const TA: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 8, outline: 'none',
  resize: 'none', lineHeight: 1.6,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.09)',
  color: 'rgba(255,255,255,0.80)', fontSize: 11.5,
  boxSizing: 'border-box',
}
