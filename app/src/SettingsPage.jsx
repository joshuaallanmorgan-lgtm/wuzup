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
        {/* Display section RETIRED with the display modes (Q2a) — editorial
            is the app, there's nothing honest left to toggle here */}
        {/* ===== YOUR TASTE ===== */}
        <section className="st-sec">
          <div className="st-over">Your taste</div>
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
            {wiped && <div className="st-wiped">Wiped. The next tap starts the new you. 🌱</div>}
          </div>

          <div className="st-rows">
            {/* Sprint V2/V3: the transparency + control hatch — what the feed
                learned, in plain numbers, plus per-category more/less */}
            <button className="st-row" onClick={() => openTaste('settings')}>
              <span className="st-row-main">
                <span className="st-row-title">Why your feed looks like this</span>
                <span className="st-row-sub">See what it learned + nudge categories up or down</span>
              </span>
              <span className="st-row-go" aria-hidden>→</span>
            </button>
            {/* Q2c: the editor REPLACED the 7-screen interview row — stated
                interests are a page you edit, not a wizard you re-run */}
            <button className="st-row" onClick={() => openInterests('settings')}>
              <span className="st-row-main">
                <span className="st-row-title">Customize interests</span>
                <span className="st-row-sub">Pick categories + the quick ones — live, any time</span>
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
            <button className="st-row" onClick={openDeck}>
              <span className="st-row-main">
                <span className="st-row-title">Calibration deck</span>
                <span className="st-row-sub">Rate 15 — we dial you in</span>
              </span>
              <span className="st-row-go" aria-hidden>→</span>
            </button>
            {!arming ? (
              <button className="st-row st-row-danger" onClick={() => { setWiped(false); setArming(true) }}>
                <span className="st-row-main">
                  <span className="st-row-title">Reset my taste</span>
                  <span className="st-row-sub">Start from zero — clears the local profile</span>
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
          </div>
        </section>

        {/* ===== DATA ===== */}
        <section className="st-sec">
          <div className="st-over">Data</div>
          <div className="st-card">
            {/* Last-Modified is host-dependent; absent header = no claim made */}
            {dataAt != null && <div className="st-line">Events updated {fmtUpdated(dataAt)}</div>}
            <div className="st-line">
              {evCount} events from {srcCount} local source{srcCount === 1 ? '' : 's'}
            </div>
            <div className="st-line st-dim">Everything lives on this phone — no account, nothing leaves it.</div>
          </div>
        </section>

        {/* ===== ABOUT (stub — Phase 4 fills credits + attribution) ===== */}
        <section className="st-sec">
          <div className="st-over">About</div>
          <div className="st-card">
            <div className="st-line">Tampa Bay — What&rsquo;s On · early build (v0)</div>
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
