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
// (inventory in the sprint report). Re-entry/“Tune your taste” is a Charles
// question later — the primer is one-shot by design.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CITY } from './lib.js'
import { recordPrimer } from './taste.js'
import './primer.css'

export const PRIMER_KEY = 'primer-v1'
const WHEN_VALUES = ['weeknights', 'weekends', 'whenever']

// App's mount gate: a valid stored state means the primer already ran (or was
// skipped) — null means first open (or private mode, where the primer simply
// shows again next launch; the in-session state still closes it today).
export function loadPrimerState() {
  try {
    const p = JSON.parse(localStorage.getItem(PRIMER_KEY))
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
  try {
    localStorage.setItem(PRIMER_KEY, JSON.stringify(s))
  } catch {
    /* private mode — the session still remembers via App state */
  }
}

// Step 1 — multi-select up to 3 (values = real dataset categories)
const CATS = [
  { v: 'music', emoji: '🎵', label: 'Music' },
  { v: 'food', emoji: '🍔', label: 'Food & Drink' },
  { v: 'outdoors', emoji: '🌳', label: 'Outdoors' },
  { v: 'sports', emoji: '🏟️', label: 'Sports' },
  { v: 'art', emoji: '🎨', label: 'Arts' },
  { v: 'nightlife', emoji: '🪩', label: 'Nightlife' },
  { v: 'comedy', emoji: '😂', label: 'Comedy' },
  { v: 'theatre', emoji: '🎭', label: 'Theatre' },
  { v: 'market', emoji: '🛍️', label: 'Markets' },
  { v: 'community', emoji: '🤝', label: 'Clubs' },
]
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

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Primer({ onDone }) {
  const [step, setStep] = useState(0)
  const [cats, setCats] = useState([]) // array → preserves pick order, max 3
  const [free, setFree] = useState(null) // null | true | false
  const [when, setWhen] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const tRef = useRef(null)
  const reduced = useMemo(() => prefersReduced(), [])
  useEffect(() => () => clearTimeout(tRef.current), [])

  const toggleCat = (v) => {
    setCats((cur) =>
      cur.includes(v) ? cur.filter((c) => c !== v) : cur.length >= 3 ? cur : [...cur, v]
    )
  }

  // fade out, then unmount via App (reduced motion = instant)
  const close = (state) => {
    if (reduced) return onDone(state)
    setLeaving(true)
    clearTimeout(tRef.current)
    tRef.current = setTimeout(() => onDone(state), 280)
  }

  const skip = () => {
    const s = { skipped: true, v: 1 }
    savePrimerState(s)
    close(s) // NO recordPrimer — skip seeds nothing, ever
  }

  // Escape = skip (one-keystroke parity with the one-tap skip button)
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = (whenV) => {
    recordPrimer({ cats, freeLeaning: free === true })
    const s = { done: true, when: whenV, v: 1 }
    savePrimerState(s)
    close(s)
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

  return (
    <div className={'primer' + (leaving ? ' primer-leaving' : '')} role="dialog" aria-modal="true" aria-label="Quick taste setup">
      <div className="primer-bg" style={{ backgroundImage: `url(${CITY.hero})` }} />
      <div className="primer-scrim" />
      <div className="primer-body">
        <header className="primer-head">
          <div className="primer-kicker">NEW HERE? MAKE IT YOURS</div>
          <div className="primer-note">3 taps, no account, all on your phone.</div>
          <div className="primer-dots" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className={'primer-dot' + (i === step ? ' on' : i < step ? ' done' : '')} />
            ))}
          </div>
        </header>

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
      </div>

      {/* ONE-TAP SKIP — visible on every step, always */}
      <button className="primer-skip" onClick={skip}>
        Skip — just show me everything
      </button>
    </div>
  )
}
