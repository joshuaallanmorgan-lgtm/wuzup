// SettingsPage — Profile → ⚙️ (Sprint P1, slimmed in Q2a/Q2b: display modes
// retired entirely — editorial IS the app — and the 7-screen interview row
// LEFT for the InterestEditor). Shows nothing it can't honestly do: the
// taste tools (read-only summary, Customize interests, primer retake,
// calibration deck, a sober two-step reset), data provenance (the
// Last-Modified stamp App's fetch already carries + a live source count) and
// an about stub Phase 4 will fill. NO email, NO account fields, NO dead
// buttons — every row does the thing it says.
//
// Mounted in App's .subpage slot ({type:'settings'}); the interests and deck
// rows REPLACE the page via their nav openers and hand back via openSettings.
// The primer retake mounts Primer in re-entry mode right here (its fixed
// overlay is contained by the subpage's transform — fills the frame, layers
// over this page, and never touches the first-open gate).
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useMemo, useState } from 'react'
import { Icon, sourceFamily } from './lib.js'
import { useNav } from './nav.jsx'
import { categoryById } from './categories.js'
import { lsRemove } from './storage.js'
import { confidence, resetTaste, topCategories, useTaste } from './taste.js'
import Primer from './Primer.jsx'
import './settings.css'

// "Events updated {when}": weekday + time inside the last 6 days, date + time
// beyond (the stale banner's labeling rule, with the clock added — settings
// is where precision belongs)
const fmtUpdated = (ms) => {
  const day =
    Date.now() - ms <= 6 * 24 * 3600 * 1000
      ? new Date(ms).toLocaleDateString('en-US', { weekday: 'long' })
      : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

export default function SettingsPage({ events, dataAt, primer, onPrimerDone }) {
  const { closePage: onClose, openInterests, openTaste, openDeck } = useNav()
  const taste = useTaste()
  const [retaking, setRetaking] = useState(false)
  const [arming, setArming] = useState(false) // reset's two-step confirm
  const [wiped, setWiped] = useState(false) // honest one-line receipt after a reset

  const conf = confidence(taste)
  const tops = topCategories(taste, 3)
    .map((c) => categoryById[c])
    .filter(Boolean)

  // distinct source FAMILIES in the fetched dataset ("Eventbrite (p2)" and
  // "Eventbrite (Free)" are one voice); added-by-you entries aren't sources
  const srcCount = useMemo(() => {
    const fams = new Set()
    for (const e of events) if (!e.tags?.includes('added-by-you')) fams.add(sourceFamily(e))
    return fams.size
  }, [events])
  const evCount = useMemo(() => events.filter((e) => !e.tags?.includes('added-by-you')).length, [events])

  // the taste summary, confidence-aware (same thresholds the Profile header
  // uses — two surfaces must never disagree about the same number)
  const tasteLine =
    taste.n === 0
      ? 'Blank slate — nothing learned yet.'
      : conf < 0.4
        ? `Still learning you — ${taste.n} tap${taste.n === 1 ? '' : 's'} in.`
        : `Tuned by ${taste.n} taps on this phone.`

  const doReset = () => {
    resetTaste() // wipes taste-v1 + the in-memory profile (taste.js owns both)
    lsRemove('fmn-seen-v1') // Find My Night's no-repeat memory starts over too
    lsRemove('deck-last-v1') // "wipe everything" includes the deck's rated-card memory
    setArming(false)
    setWiped(true)
  }

  return (
    <div className="pg st">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Settings</h1>
      </header>

      <div className="st-body">
        {/* Phase 3.6 N4: Settings regrouped by INTENT (was a "bunch of weird
            sections", Josh). Five clean groups: identity → tune → reset → data
            → about. Taste transparency + the deck are CANONICAL on Profile now
            (W6 hub); the rows here are demoted/retitled so they don't read as
            verbatim duplicates (⚑W5). ALL COPY DRAFT for Charles. */}

        {/* ===== 1 · YOUR TASTE PROFILE (read-only identity) ===== */}
        <section className="st-sec">
          <div className="st-over">Your taste profile</div>
          <div className="st-card">
            <div className="st-taste-line">{tasteLine}</div>
            {tops.length > 0 && (
              <div className="st-chips">
                {tops.map((c) => (
                  <span key={c.id} className="st-chip" style={{ '--ph': c.hue }}>
                    <span aria-hidden>{c.emoji}</span> {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="st-rows">
            {/* demoted from Profile's headline "Why your feed looks like this" —
                Settings is the secondary door to the same panel (⚑W5 dedup) */}
            <button className="st-row" onClick={() => openTaste('settings')}>
              <span className="st-row-main">
                <span className="st-row-title">See your taste details</span>
                <span className="st-row-sub">What it learned + nudge categories up or down</span>
              </span>
              <span className="st-row-go" aria-hidden>→</span>
            </button>
          </div>
        </section>

        {/* ===== 2 · TUNE YOUR FEED (the active controls) ===== */}
        <section className="st-sec">
          <div className="st-over">Tune your feed</div>
          <div className="st-rows">
            <button className="st-row" onClick={() => openInterests('settings')}>
              <span className="st-row-main">
                <span className="st-row-title">Customize interests</span>
                <span className="st-row-sub">Pick categories + the quick ones — live, any time</span>
              </span>
              <span className="st-row-go" aria-hidden>→</span>
            </button>
            {/* retitled from "Calibration deck" so it isn't a verbatim twin of
                Profile's "Rate a few to sharpen it" (⚑W5) */}
            <button className="st-row" onClick={openDeck}>
              <span className="st-row-main">
                <span className="st-row-title">Rate &amp; refine</span>
                <span className="st-row-sub">Rate 15 and we dial you in</span>
              </span>
              <span className="st-row-go" aria-hidden>→</span>
            </button>
            <button className="st-row" onClick={() => setRetaking(true)}>
              <span className="st-row-main">
                {/* honest verb: a skipped first-open never "re"-takes */}
                <span className="st-row-title">{primer?.done ? 'Retake the quick primer' : 'Take the quick primer'}</span>
                <span className="st-row-sub">3 taps — the first-open questions{primer?.done ? ', again' : ''}</span>
              </span>
              <span className="st-row-go" aria-hidden>→</span>
            </button>
          </div>
        </section>

        {/* ===== 3 · RESET (the one destructive action, alone) ===== */}
        <section className="st-sec">
          <div className="st-over">Reset</div>
          <div className="st-rows">
            {!arming ? (
              <button className="st-row st-row-danger" onClick={() => { setWiped(false); setArming(true) }}>
                <span className="st-row-main">
                  <span className="st-row-title">Start fresh</span>
                  <span className="st-row-sub">Wipe what this phone learned — saves &amp; plans stay</span>
                </span>
              </button>
            ) : (
              <div className="st-confirm">
                <div className="st-confirm-q">
                  Wipe everything this phone has learned about your taste? Saves and plans stay. No undo.
                </div>
                <div className="st-confirm-btns">
                  <button className="st-confirm-yes" onClick={doReset}>
                    Yes — wipe it
                  </button>
                  <button className="st-confirm-no" onClick={() => setArming(false)}>
                    Keep it
                  </button>
                </div>
              </div>
            )}
            {wiped && <div className="st-wiped">Wiped. The next tap starts the new you. 🌱</div>}
          </div>
        </section>

        {/* ===== 4 · YOUR DATA & PRIVACY ===== */}
        <section className="st-sec">
          <div className="st-over">Your data &amp; privacy</div>
          <div className="st-card">
            <div className="st-line">
              {evCount} events from {srcCount} local source{srcCount === 1 ? '' : 's'}
            </div>
            {/* Last-Modified is host-dependent; absent header = no claim made.
                Demoted to a quiet line (it's provenance, not a headline). */}
            {dataAt != null && <div className="st-line st-dim">Updated {fmtUpdated(dataAt)}</div>}
            <div className="st-line st-dim">Everything lives on this phone — no account, nothing leaves it.</div>
          </div>
        </section>

        {/* ===== 5 · ABOUT (stub — Phase 4 fills credits + attribution) ===== */}
        <section className="st-sec">
          <div className="st-over">About</div>
          <div className="st-card">
            <div className="st-line">Wuzup · Tampa Bay · early build (v0)</div>
            <div className="st-line st-dim">Credits &amp; source attribution page coming with the public release.</div>
          </div>
        </section>
      </div>

      {/* primer re-entry: overlays this page; an abandoned retake hands back
          null (state untouched) — only a real finish updates App's primer */}
      {retaking && (
        <Primer
          reentry
          onDone={(s) => {
            if (s) onPrimerDone(s)
            setRetaking(false)
          }}
        />
      )}
    </div>
  )
}
