// Interview — Sprint P2: the primer's grown-up sibling. Seven one-tap screens
// in the primer's exact visual language (it deliberately RIDES primer.css —
// same chips, same option cards, same dots; interview.css carries only the
// deltas), mounted as a subpage ({type:'interview'}) from Settings → "Full
// interview". The .primer overlay's fixed positioning is contained by the
// .subpage transform, so it fills the 460px frame at the subpage's z.
//
// SKIPPABLE TWO WAYS, both honest:
//   · per-screen — "Skip this one" advances with a null answer;
//   · globally — the ✕ (and the pinned bottom button before anything is
//     answered) exits WITHOUT recording: the primer's zero-mutation skip
//     rule, inherited. Once at least one answer exists the pinned button
//     becomes "Finish here — keep my answers" and records early.
// recordInterview (taste.js) is called ON FINISH ONLY — once, with the whole
// answer set; the math (+5 picks, small lean adjustments, explore scalar,
// n += 5) and the replace-not-stack contract are documented at the seam.
// An all-null walk-through is a no-op there, never fake confidence.
//
// Exit and finish both hand BACK to Settings (openSettings) — the interview
// is one level deep from where it was launched. Escape is nav.jsx's normal
// subpage close (hard dismiss to the tab) — also recording nothing.
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES } from './categories.js'
import { CITY } from './lib.js'
import { useNav } from './nav.jsx'
import { recordInterview } from './taste.js'
import './primer.css'
import './interview.css'

const MAX_CATS = 4
// the grown-up ask includes 'family' (the primer's first-open curation left
// it out); 'other' stays out everywhere — a fallback bucket is not a taste
const IV_CATS = CATEGORIES.filter((c) => c.id !== 'other')

// screens 2–7: one-tap. Each option writes { [key]: v }; weights live in
// taste.js (recordInterview), NOT here — this file is presentation only.
const ONE_TAPS = [
  {
    key: 'indoorOutdoor',
    q: 'Indoors or outdoors?',
    sub: 'Where do the good nights actually happen?',
    opts: [
      { v: 'indoor', emoji: '🛋️', label: 'Indoors mostly' },
      { v: 'outdoor', emoji: '🌳', label: 'Outside when I can be' },
    ],
  },
  {
    key: 'free',
    q: 'Money mood?',
    sub: 'No judgment either way.',
    opts: [
      { v: true, emoji: '🆓', label: 'Free-leaning', sub: '$0 is the best price' },
      { v: false, emoji: '💳', label: 'Whatever’s good', sub: 'Worth it is worth it' },
    ],
  },
  {
    key: 'energy',
    q: 'Chill nights or big ones?',
    sub: null,
    opts: [
      { v: 'chill', emoji: '😌', label: 'Keep it chill' },
      { v: 'wild', emoji: '🎉', label: 'Turn it up' },
    ],
  },
  {
    key: 'company',
    q: 'Who are you usually out with?',
    sub: null,
    opts: [
      { v: 'solo', emoji: '🧍', label: 'Solo missions' },
      { v: 'social', emoji: '👯', label: 'My people' },
    ],
  },
  {
    key: 'dayparts',
    q: 'When do you head out?',
    sub: null,
    opts: [
      { v: 'weeknights', emoji: '🌙', label: 'Weeknights' },
      { v: 'weekends', emoji: '🎉', label: 'Weekends' },
      { v: 'both', emoji: '🔁', label: 'Both, honestly' },
    ],
  },
  {
    key: 'explore',
    q: 'How adventurous are we talking?',
    sub: 'Last one — this tunes how far we reach.',
    opts: [
      // the 0..1 explore scalar (taste.js): never fully closed, never random
      { v: 0.2, emoji: '⭐', label: 'Stick to my favorites' },
      { v: 0.5, emoji: '⚖️', label: 'Mix it up a little' },
      { v: 0.8, emoji: '🎲', label: 'Surprise me' },
    ],
  },
]
const STEPS = 1 + ONE_TAPS.length // 7

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Interview() {
  const { openSettings } = useNav()
  const [step, setStep] = useState(0)
  const [ans, setAns] = useState({
    cats: [],
    indoorOutdoor: null,
    free: null,
    energy: null,
    company: null,
    dayparts: null,
    explore: null,
  })
  const tRef = useRef(null)
  const reduced = useMemo(() => prefersReduced(), [])
  useEffect(() => () => clearTimeout(tRef.current), [])

  const answered =
    ans.cats.length > 0 ||
    ans.indoorOutdoor != null ||
    ans.free != null ||
    ans.energy != null ||
    ans.company != null ||
    ans.dayparts != null ||
    ans.explore != null

  const toggleCat = (v) => {
    setAns((a) => ({
      ...a,
      cats: a.cats.includes(v) ? a.cats.filter((c) => c !== v) : a.cats.length >= MAX_CATS ? a.cats : [...a.cats, v],
    }))
  }

  // finish = the ONLY recordInterview call; both exits land back on Settings
  const finish = (finalAns) => {
    recordInterview(finalAns)
    openSettings()
  }
  const exit = () => openSettings() // global skip: nothing recorded

  // one-tap pick: show the highlight for a beat, then slide on (primer rhythm)
  const pick = (key, v) => {
    const nextAns = { ...ans, [key]: v }
    setAns(nextAns)
    clearTimeout(tRef.current)
    const go = () => (step >= STEPS - 1 ? finish(nextAns) : setStep(step + 1))
    if (reduced) go()
    else tRef.current = setTimeout(go, 230)
  }
  const skipScreen = () => {
    clearTimeout(tRef.current)
    if (step >= STEPS - 1) finish(ans)
    else setStep(step + 1)
  }
  const back = () => {
    clearTimeout(tRef.current)
    setStep((s) => Math.max(s - 1, 0))
  }

  const screen = step === 0 ? null : ONE_TAPS[step - 1]
  const full = ans.cats.length >= MAX_CATS

  return (
    <div className="primer ivw" role="dialog" aria-modal="true" aria-label="Full taste interview">
      <div className="primer-bg" style={{ backgroundImage: `url(${CITY.hero})` }} />
      <div className="primer-scrim" />
      <button className="ivw-x" onClick={exit} aria-label="Exit — nothing saved">
        ✕
      </button>
      <div className="primer-body">
        <header className="primer-head">
          <div className="primer-kicker">THE FULL INTERVIEW</div>
          <div className="primer-note">7 quick ones — skip anything. Still all on your phone.</div>
          <div className="primer-dots" aria-hidden>
            {Array.from({ length: STEPS }, (_, i) => (
              <span key={i} className={'primer-dot' + (i === step ? ' on' : i < step ? ' done' : '')} />
            ))}
          </div>
        </header>

        {step === 0 && (
          <div className="primer-step" key={0}>
            <h1 className="primer-q">What gets you out?</h1>
            <div className="primer-sub">Up to 4 this time — the whole menu’s on the table.</div>
            <div className="primer-chips">
              {IV_CATS.map((c) => {
                const sel = ans.cats.includes(c.id)
                return (
                  <button
                    key={c.id}
                    className={'primer-chip' + (sel ? ' sel' : full ? ' dim' : '')}
                    aria-pressed={sel}
                    onClick={() => toggleCat(c.id)}
                  >
                    <span aria-hidden>{c.emoji}</span> {c.label}
                  </button>
                )
              })}
            </div>
            <button className="primer-next" onClick={() => setStep(1)}>
              {ans.cats.length ? 'Next' : 'Nothing grabs me — next'}
            </button>
          </div>
        )}

        {screen && (
          <div className="primer-step" key={step}>
            <h1 className="primer-q">{screen.q}</h1>
            {screen.sub && <div className="primer-sub">{screen.sub}</div>}
            <div className="primer-opts">
              {screen.opts.map((o) => (
                <button
                  key={String(o.v)}
                  className={'primer-opt' + (ans[screen.key] === o.v ? ' sel' : '')}
                  onClick={() => pick(screen.key, o.v)}
                >
                  <span className="primer-opt-emoji" aria-hidden>{o.emoji}</span>
                  <span className="primer-opt-label">{o.label}</span>
                  {o.sub && <span className="primer-opt-sub">{o.sub}</span>}
                </button>
              ))}
            </div>
            <div className="ivw-rowbtns">
              <button className="primer-back" onClick={back}>← Back</button>
              <button className="ivw-skip1" onClick={skipScreen}>
                {step >= STEPS - 1 ? 'Skip this one — finish' : 'Skip this one →'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* pinned global control: an exit while blank, a keeper once anything
          is answered — never a dead button, never a silent data write */}
      <button className="primer-skip" onClick={answered ? () => finish(ans) : exit}>
        {answered ? 'Finish here — keep my answers' : 'Never mind — back to settings'}
      </button>
    </div>
  )
}
