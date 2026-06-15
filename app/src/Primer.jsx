/* eslint-disable react-refresh/only-export-components --
   loadPrimerState is App's 6-line mount gate for this one-shot overlay; a
   separate module for it would be ceremony (same precedent as cards.jsx —
   dev-time Fast Refresh granularity only, no runtime effect). */
// Primer — Sprint H1: the 3-tap mood primer (⚑FLAG-2, approved with defaults).
// FIRST OPEN ONLY: App mounts it while localStorage 'primer-v1' is absent.
// Full-screen overlay (z 1900: above tabbar/FAB/subpages, below detail 2000)
// with the hero-photo ambiance. ONE-TAP SKIP is visible at all times.
//
// On finish: seeds the local taste profile via taste.js recordPrimer
// ({cats, freeLeaning} — the math is documented there) and stores
// { done:true, when, v:1 }. The when-preference flavors the H2 hero greeting
// only, for now. On skip: stores { skipped:true, v:1 } and seeds NOTHING —
// zero profile mutation is the contract.
//
// Fully local, no account, no network. ALL COPY IS DRAFT for Charles's review
// (inventory in the sprint report).
//
// RE-ENTRY MODE (Sprint P1 — Settings' "Retake the quick primer"): the
// `reentry` prop relaxes exactly TWO things and nothing else, so the
// first-open flow stays byte-identical:
//   · skip leaves WITHOUT touching the stored state — a retake abandoned
//     must never clobber a real {done, when} with {skipped} (and it still
//     seeds nothing, the original skip contract);
//   · its Escape handler runs CAPTURE-phase + stopPropagation so nav.jsx's
//     bubble-phase Escape doesn't also close the Settings subpage underneath
//     (the MapView/WeekendBuilder layering precedent).
// Finish in re-entry is the SAME finish: recordPrimer seeds again (the
// documented stacking edge in taste.js — primer weights are small and real
// taps dominate either way) and {done, when} overwrites, which is the point
// of a retake. Header copy swaps to retake phrasing (DRAFT).
//
// THE FINISH SCREEN (Q2d, FIRST-OPEN ONLY — re-entry retakes skip the offer
// and close on the third tap exactly as before): the third tap still seeds
// taste + persists {done, when} immediately (the reward beat), then lands on
// a finish screen instead of closing: a primary "into the app" dismiss plus
// a QUIET optional second act — "Dial it in — rate 15 events" — that closes
// the primer and hands App the saved state through onDeck, which opens the
// calibration deck AFTER the primer is gone. Explicit tap only, never
// autoplayed. Once the state is saved, skip/Escape on the finish screen
// dismiss WITHOUT rewriting (a {skipped} must never clobber the fresh
// {done}) — the doneRef guard below.
import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryById } from './categories.js'
import { CITY } from './lib.js'
import { lsGet, lsSet } from './storage.js'
import { recordPrimer } from './taste.js'
import './primer.css'

export const PRIMER_KEY = 'primer-v1' // stored as twh:primer-v1 via storage.js
const WHEN_VALUES = ['weeknights', 'weekends', 'whenever']

// App's mount gate: a valid stored state means the primer already ran (or was
// skipped) — null means first open (or private mode, where the primer simply
// shows again next launch; the in-session state still closes it today).
export function loadPrimerState() {
  try {
    const p = JSON.parse(lsGet(PRIMER_KEY))
    if (p && typeof p === 'object' && !Array.isArray(p) && p.v === 1 && (p.done === true || p.skipped === true)) {
      return {
        done: p.done === true,
        skipped: p.skipped === true,
        when: WHEN_VALUES.includes(p.when) ? p.when : null,
        v: 1,
      }
    }
  } catch {
    /* absent, corrupt, or private mode — treat as first open */
  }
  return null
}

function savePrimerState(s) {
  lsSet(PRIMER_KEY, JSON.stringify(s)) // guarded in storage.js — the session still remembers via App state
}

// Step 1 — multi-select up to 3. Identity (emoji/label) derives from the
// canonical registry (categories.js — audit prep #7); this list owns only the
// primer's curation: WHICH ten categories show, in WHAT order ('family' and
// the 'other' fallback bucket deliberately sit out the first-open ask).
const CATS = ['music', 'food', 'outdoors', 'sports', 'art', 'nightlife', 'comedy', 'theatre', 'market', 'community'].map(
  (id) => {
    const c = categoryById[id]
    return { v: c.id, emoji: c.emoji, label: c.label }
  }
)
// Step 2 — money mood (v = freeLeaning)
const MONEY = [
  { v: true, emoji: '🆓', label: 'Free-leaning', sub: '$0 is the best price' },
  { v: false, emoji: '💳', label: 'Whatever’s good', sub: 'Worth it is worth it' },
]
// Step 3 — when do you go out (stored in primer-v1, H2 greeting flavor only)
const WHEN = [
  { v: 'weeknights', emoji: '🌙', label: 'Weeknights' },
  { v: 'weekends', emoji: '🎉', label: 'Weekends' },
  { v: 'whenever', emoji: '🤷', label: 'Whenever' },
]
// Phase 3.6 N5: the first-open IA tour — teach the five tabs before asking for
// anything, so the app the user lands in isn't a cold mystery (Josh: "what does
// the user think the first time they open it"). Skippable (Continue advances to
// the taste questions; the global Skip exits entirely). Emoji-as-icon, one calm
// line each. DRAFT copy for Charles.
const TOUR = [
  { emoji: '🎉', label: 'Events', line: "What's on — tonight, this weekend, by vibe" },
  { emoji: '📍', label: 'Spots', line: 'Places always here — beaches, parks, courts' },
  { emoji: '🗺️', label: 'Map', line: 'Everything around you, on one map' },
  { emoji: '🗓️', label: 'Calendar', line: 'Build a day; look back on your nights' },
  { emoji: '👤', label: 'Profile', line: 'Your taste, your saves, your plans' },
]

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Primer({ onDone, onDeck, reentry = false }) {
  // first-open opens on the IA tour; a Settings retake jumps straight to the questions
  const [step, setStep] = useState(reentry ? 0 : 'tour')
  const [cats, setCats] = useState([]) // array → preserves pick order, max 3
  const [free, setFree] = useState(null) // null | true | false
  const [when, setWhen] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const tRef = useRef(null)
  // set the moment {done, when} is persisted (first-open finish): from then
  // on every exit path hands THIS state back and writes nothing further
  const doneRef = useRef(null)
  const reduced = useMemo(() => prefersReduced(), [])
  useEffect(() => () => clearTimeout(tRef.current), [])

  const toggleCat = (v) => {
    setCats((cur) =>
      cur.includes(v) ? cur.filter((c) => c !== v) : cur.length >= 3 ? cur : [...cur, v]
    )
  }

  // fade out, then unmount via App (reduced motion = instant). cb defaults to
  // the plain dismiss; the finish screen's deck offer passes onDeck instead —
  // either way the handoff fires only after the fade, so whatever App opens
  // next appears strictly AFTER the primer is gone.
  const close = (state, cb = onDone) => {
    if (reduced) return cb(state)
    setLeaving(true)
    clearTimeout(tRef.current)
    tRef.current = setTimeout(() => cb(state), 280)
  }

  const skip = () => {
    // already finished (the Q2d finish screen is up): state is saved, taste is
    // seeded — Escape here is just a dismiss, never a {skipped} overwrite
    if (doneRef.current) return close(doneRef.current)
    if (reentry) return close(null) // retake abandoned: stored state untouched, nothing seeded
    const s = { skipped: true, v: 1 }
    savePrimerState(s)
    close(s) // NO recordPrimer — skip seeds nothing, ever
  }

  // Escape = skip (one-keystroke parity with the one-tap skip button).
  // Re-entry runs capture-phase + stopPropagation so the Settings subpage
  // behind it doesn't ALSO close (nav.jsx's Escape is bubble-phase by design).
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      if (reentry) ev.stopPropagation()
      skip()
    }
    window.addEventListener('keydown', onKey, reentry)
    return () => window.removeEventListener('keydown', onKey, reentry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = (whenV) => {
    recordPrimer({ cats, freeLeaning: free === true })
    const s = { done: true, when: whenV, v: 1 }
    savePrimerState(s)
    if (reentry) return close(s) // retakes close on the third tap, no offer
    // first-open (Q2d): seeded + saved already — land on the finish screen
    // with the optional deck offer instead of closing
    doneRef.current = s
    setStep(3)
  }

  // money tap: show the highlight for a beat, then slide on (FMN's rhythm)
  const pickMoney = (v) => {
    setFree(v)
    clearTimeout(tRef.current)
    if (reduced) setStep(2)
    else tRef.current = setTimeout(() => setStep(2), 230)
  }
  // when tap: third tap = done
  const pickWhen = (v) => {
    setWhen(v)
    clearTimeout(tRef.current)
    if (reduced) finish(v)
    else tRef.current = setTimeout(() => finish(v), 230)
  }

  const full = cats.length >= 3
  const onQ = typeof step === 'number' && step < 3 // a taste question (dots + note + skip)
  // N5 finish snapshot: reflect the picks back as proof they're APPLIED, not
  // stored — and the honest line (taste reorders, never hides)
  const mixCats = cats.map((v) => categoryById[v]).filter(Boolean).slice(0, 3)
  const whenChip = WHEN.find((w) => w.v === when)
  const hasMix = mixCats.length > 0 || free === true || !!whenChip

  return (
    <div className={'primer' + (leaving ? ' primer-leaving' : '')} role="dialog" aria-modal="true" aria-label="Quick taste setup">
      <div className="primer-bg" style={{ backgroundImage: `url(${CITY.hero})` }} />
      <div className="primer-scrim" />
      <div className="primer-body">
        <header className="primer-head">
          {/* the finish screen (step 3) drops the ask-y framing — "3 taps, no
              account" + progress dots describe a flow that's already over
              (Q2 review INFO-4; DRAFT for Charles like all primer copy) */}
          <div className="primer-kicker">
            {step === 'tour'
              ? 'WELCOME TO TAMPA BAY'
              : step === 3
                ? 'ALL SET'
                : reentry
                  ? 'TUNE YOUR TASTE'
                  : 'NEW HERE? MAKE IT YOURS'}
          </div>
          {onQ && (
            <div className="primer-note">
              {reentry ? '3 taps — a fresh read on you.' : '3 taps, no account, all on your phone.'}
            </div>
          )}
          {onQ && (
            <div className="primer-dots" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className={'primer-dot' + (i === step ? ' on' : i < step ? ' done' : '')} />
              ))}
            </div>
          )}
        </header>

        {step === 'tour' && (
          <div className="primer-step" key="tour">
            <h1 className="primer-q">Five tabs, one bay</h1>
            <div className="primer-sub">Here&rsquo;s what you&rsquo;ll explore — then we&rsquo;ll tune it to you.</div>
            <div className="primer-tour">
              {TOUR.map((t) => (
                <div key={t.label} className="primer-tour-row">
                  <span className="primer-tour-emoji" aria-hidden>{t.emoji}</span>
                  <span className="primer-tour-main">
                    <span className="primer-tour-label">{t.label}</span>
                    <span className="primer-tour-line">{t.line}</span>
                  </span>
                </div>
              ))}
            </div>
            <button className="primer-next" onClick={() => setStep(0)}>
              Continue
            </button>
          </div>
        )}

        {step === 0 && (
          <div className="primer-step" key={0}>
            <h1 className="primer-q">What gets you out?</h1>
            <div className="primer-sub">Pick up to 3 — we’ll lead with them.</div>
            <div className="primer-chips">
              {CATS.map((c) => {
                const sel = cats.includes(c.v)
                return (
                  <button
                    key={c.v}
                    className={'primer-chip' + (sel ? ' sel' : full ? ' dim' : '')}
                    aria-pressed={sel}
                    onClick={() => toggleCat(c.v)}
                  >
                    <span aria-hidden>{c.emoji}</span> {c.label}
                  </button>
                )
              })}
            </div>
            <button className="primer-next" onClick={() => setStep(1)}>
              {cats.length ? 'Next' : 'Nothing grabs me — next'}
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="primer-step" key={1}>
            <h1 className="primer-q">Money mood?</h1>
            <div className="primer-sub">No judgment either way.</div>
            <div className="primer-opts">
              {MONEY.map((o) => (
                <button
                  key={String(o.v)}
                  className={'primer-opt' + (free === o.v ? ' sel' : '')}
                  onClick={() => pickMoney(o.v)}
                >
                  <span className="primer-opt-emoji" aria-hidden>{o.emoji}</span>
                  <span className="primer-opt-label">{o.label}</span>
                  <span className="primer-opt-sub">{o.sub}</span>
                </button>
              ))}
            </div>
            <button className="primer-back" onClick={() => { clearTimeout(tRef.current); setStep(0) }}>← Back</button>
          </div>
        )}

        {step === 2 && (
          /* primer-final: the last tap is the I1 reward-tinted finish beat */
          <div className="primer-step primer-final" key={2}>
            <h1 className="primer-q">When do you usually go out?</h1>
            <div className="primer-sub">Last one — then it’s all yours.</div>
            <div className="primer-opts">
              {WHEN.map((o) => (
                <button
                  key={o.v}
                  className={'primer-opt' + (when === o.v ? ' sel' : '')}
                  onClick={() => pickWhen(o.v)}
                >
                  <span className="primer-opt-emoji" aria-hidden>{o.emoji}</span>
                  <span className="primer-opt-label">{o.label}</span>
                </button>
              ))}
            </div>
            <button className="primer-back" onClick={() => { clearTimeout(tRef.current); setStep(1) }}>← Back</button>
          </div>
        )}

        {step === 3 && (
          /* Q2d FINISH SCREEN (first-open only — finish() never routes
             re-entry here). State is already saved + seeded; both buttons are
             pure exits. The deck offer is the QUIET one by design — the
             default path into the app stays primary. No --reward here: the
             sanctioned beat was the third tap's highlight, not this screen. */
          <div className="primer-step" key={3}>
            <h1 className="primer-q">You’re set.</h1>
            {hasMix ? (
              <>
                <div className="primer-snapshot">
                  {mixCats.map((c) => (
                    <span key={c.id} className="primer-snap" style={{ '--ph': c.hue }}>
                      <span aria-hidden>{c.emoji}</span> {c.label}
                    </span>
                  ))}
                  {free === true && (
                    <span className="primer-snap">
                      <span aria-hidden>🆓</span> Free-leaning
                    </span>
                  )}
                  {whenChip && (
                    <span className="primer-snap">
                      <span aria-hidden>{whenChip.emoji}</span> {whenChip.label}
                    </span>
                  )}
                </div>
                {/* honest: taste reorders, it never filters/hides (taste.js contract) */}
                <div className="primer-sub">We’ll lead your feed with these — and never hide the rest.</div>
              </>
            ) : (
              <div className="primer-sub">Your feed’s wide open — every tap from here shapes it. All on your phone.</div>
            )}
            <button className="primer-next" onClick={() => close(doneRef.current)}>
              Show me what’s on
            </button>
            {typeof onDeck === 'function' && (
              <button className="primer-deckbtn" onClick={() => close(doneRef.current, onDeck)}>
                <span className="primer-deckbtn-main">🃏 See how your taste sharpens</span>
                <span className="primer-deckbtn-sub">Rate a quick set — skippable anytime</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ONE-TAP SKIP — visible on the tour + every asking step (the finish
          screen has its own two explicit exits; Escape still dismisses there).
          The tour is skippable per Josh: Continue advances, Skip exits. */}
      {step !== 3 && (
        <button className="primer-skip" onClick={skip}>
          {reentry ? 'Never mind — back to settings' : 'Skip — just show me everything'}
        </button>
      )}
    </div>
  )
}
