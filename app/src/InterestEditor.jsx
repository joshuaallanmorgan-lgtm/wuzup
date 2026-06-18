// InterestEditor — Sprint Q2c, the connective-tissue centerpiece: your STATED
// interests, visible and editable any time. A directly-tappable chip grid of
// the registry's 11 real categories ('other' is a fallback bucket, not an
// interest) + the interview's surviving questions as always-editable rows
// (money mood, energy, company, dayparts, the explore dial). The 7-screen
// Interview wizard retired into this page — onboarding answers and manual
// edits are ONE store now.
//
// EVERY tap writes LIVE through taste.js recordInterview with the COMPLETE
// current answer set + {allowClear:true}: the replace-not-stack seam
// subtracts the previous stated contribution and re-applies, so edits never
// stack, organic tap-learning underneath is never touched, and un-picking
// everything is a clean removal. No save button — there is nothing to defer.
//
// Reads its initial state from interviewAnswers() (the _interview.answers
// blob; pre-Q2 blobs reconstruct only the honestly derivable parts and open
// otherwise blank — under-showing, never fabricating).
//
// Mounted in App's .subpage slot ({type:'interests', from}). Reached from
// Settings ("Customize interests" — back returns there) and from Profile's
// vibe-header chips (back closes to the tab). HONEST FRAMING by contract:
// picks seed ordering only; real taps still dominate; nothing is ever hidden.
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useRef, useState } from 'react'
import { CATEGORIES } from './categories.js'
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { interviewAnswers, recordInterview } from './taste.js'
import './interests.css'

// the grid = the whole registry minus the 'other' fallback bucket
const GRID_CATS = CATEGORIES.filter((c) => c.id !== 'other')

const EMPTY = {
  cats: [],
  indoorOutdoor: null,
  free: null,
  energy: null,
  company: null,
  dayparts: null,
  explore: null,
}

// the surviving interview questions, now always-editable rows. Values and
// weights live in taste.js (recordInterview) — this file is presentation
// only. Tapping the selected option again CLEARS it (back to "no answer"):
// an honest preference should be as easy to retract as to state.
const QUESTIONS = [
  {
    key: 'free',
    title: 'Spending',
    sub: 'Free-first, or worth paying for — it only tips the order.',
    opts: [
      { v: true, emoji: '🆓', label: 'Free-leaning' },
      { v: false, emoji: '💳', label: 'Whatever’s good' },
    ],
  },
  {
    key: 'energy',
    title: 'Chill nights or big ones',
    sub: null,
    opts: [
      { v: 'chill', emoji: '😌', label: 'Keep it chill' },
      { v: 'wild', emoji: '🎉', label: 'Turn it up' },
    ],
  },
  {
    key: 'company',
    title: 'Who you’re usually out with',
    sub: null,
    opts: [
      { v: 'solo', emoji: '🧍', label: 'Solo missions' },
      { v: 'social', emoji: '👯', label: 'My people' },
    ],
  },
  {
    key: 'dayparts',
    title: 'When you head out',
    sub: null,
    opts: [
      { v: 'weeknights', emoji: '🌙', label: 'Weeknights' },
      { v: 'weekends', emoji: '🎉', label: 'Weekends' },
      { v: 'both', emoji: '🔁', label: 'Both' },
    ],
  },
  {
    key: 'explore',
    title: 'How adventurous',
    sub: 'Tunes how far we reach beyond your picks.',
    opts: [
      { v: 0.2, emoji: '⭐', label: 'My favorites' },
      { v: 0.5, emoji: '⚖️', label: 'Mix it up' },
      { v: 0.8, emoji: '🎲', label: 'Surprise me' },
    ],
  },
]

export default function InterestEditor({ from }) {
  const { closePage, openSettings } = useNav()
  // back mirrors where you came from: Settings row → Settings; Profile chips
  // (or anywhere else) → close to the tab. One level deep either way.
  const back = from === 'settings' ? openSettings : closePage

  // seeded once from the stored answers; every edit below writes straight
  // through the seam, so local state and store can never drift apart. The
  // ref mirrors the latest written answers so two taps inside one tick (or
  // before a re-render lands) both build on the freshest state — a stale
  // render closure must never make a restatement that drops the prior tap.
  // (recordInterview is called from the event handler, NOT inside a setState
  // updater: StrictMode double-invokes updaters and side effects don't
  // belong there — idempotency would mask it, but clean is clean.)
  const [ans, setAns] = useState(() => interviewAnswers() ?? EMPTY)
  const ansRef = useRef(ans)

  const write = (mutate) => {
    const next = mutate(ansRef.current)
    ansRef.current = next
    setAns(next)
    recordInterview(next, { allowClear: true }) // replace-not-stack, live
  }
  const toggleCat = (id) =>
    write((a) => ({
      ...a,
      cats: a.cats.includes(id) ? a.cats.filter((c) => c !== id) : [...a.cats, id],
    }))
  const setOne = (key, v) => write((a) => ({ ...a, [key]: a[key] === v ? null : v }))

  return (
    <div className="pg ie">
      <header className="pg-head">
        <button className="pg-back" onClick={back} aria-label="Back">
          <Icon.chevron />
        </button>
        {/* S1-ST3: titled "Customize interests" to match sheet-b + the Settings
            row that opens it (was "Your interests"). */}
        <h1 className="pg-head-title">Customize interests</h1>
      </header>

      <div className="ie-body">
        {/* the honest framing, up front: seeds nudge ordering, taps rule */}
        <p className="ie-framing">
          Tap what you’re into — picks save instantly and seed what shows first. What you actually
          tap around the app still counts most, and nothing ever gets hidden.
        </p>

        {/* ===== the chip grid: stated interests, directly tappable ===== */}
        <section className="ie-sec">
          <div className="ie-over">Into these</div>
          <div className="ie-grid" role="group" aria-label="Your interest categories">
            {GRID_CATS.map((c) => {
              const sel = ans.cats.includes(c.id)
              return (
                <button
                  key={c.id}
                  className={'ie-chip' + (sel ? ' sel' : '')}
                  style={{ '--ph': c.hue }}
                  aria-pressed={sel}
                  onClick={() => toggleCat(c.id)}
                >
                  <span aria-hidden>{c.emoji}</span> {c.label}
                </button>
              )
            })}
          </div>
          <div className="ie-grid-note">
            {ans.cats.length
              ? `${ans.cats.length} picked — tap any to change your mind.`
              : 'Nothing picked — your feed leans on your taps alone.'}
          </div>
        </section>

        {/* ===== the surviving interview questions, always editable ===== */}
        <section className="ie-sec">
          <div className="ie-over">The quick ones</div>
          <div className="ie-qs">
            {QUESTIONS.map((q) => (
              <div key={q.key} className="ie-q" role="group" aria-label={q.title}>
                <div className="ie-q-title">{q.title}</div>
                {q.sub && <div className="ie-q-sub">{q.sub}</div>}
                <div className="ie-opts">
                  {q.opts.map((o) => {
                    const sel = ans[q.key] === o.v
                    return (
                      <button
                        key={String(o.v)}
                        className={'ie-opt' + (sel ? ' sel' : '')}
                        aria-pressed={sel}
                        onClick={() => setOne(q.key, o.v)}
                      >
                        <span aria-hidden>{o.emoji}</span> {o.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="ie-foot">
            Tap a lit answer to clear it. All of this lives on your phone — change it as often as
            you like.
          </div>
        </section>
      </div>
    </div>
  )
}
