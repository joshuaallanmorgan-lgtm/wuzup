// SettingsPage — Profile → ⚙️ (Sprint P1, slimmed in Q2a/Q2b: display modes
// retired entirely — editorial IS the app — and the 7-screen interview row
// LEFT for the InterestEditor). Shows nothing it can't honestly do: the
// taste tools (read-only summary, Customize interests, primer retake,
// calibration deck, a sober two-step reset), data provenance (the
// immutable generated/source-health metadata + a live source count) and
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
import { CITY, formatCityInstant, Icon } from './lib.js'
import { coverageStats, dayStamp } from './coverage.js'
import { useNav } from './nav.jsx'
import { lsRemove } from './storage.js'
import { resetTaste } from './taste.js'
import Primer from './Primer.jsx'
import './settings.css'

// "Events updated {when}": the shared dayStamp idiom (weekday inside the last
// 6 days, date beyond — coverage.js) with the clock added — settings is where
// precision belongs
const fmtUpdated = (ms) =>
  `${dayStamp(ms)} · ${formatCityInstant(ms, { hour: 'numeric', minute: '2-digit' })}`

export default function SettingsPage({ events, dataMeta, primer, onPrimerDone, locationAllowed, onAllowLocation }) {
  // openAttribution (Stage E ⚑X3): the About row → Data & photo credits page
  // (single-slot REPLACE; its back affordance reopens Settings)
  const { closePage: onClose, openAttribution } = useNav()
  const [retaking, setRetaking] = useState(false)
  const [arming, setArming] = useState(false) // reset's two-step confirm
  const [resetStatus, setResetStatus] = useState(null)

  // events + distinct source FAMILIES in the fetched dataset — the shared
  // coverage.js derivation (one tally, spoken here, on Home's Coverage Card,
  // and on the attribution page's header)
  const { events: evCount, sources: srcCount } = useMemo(() => coverageStats(events), [events])
  const dataAt = dataMeta?.generatedAt ? Date.parse(dataMeta.generatedAt) : null
  const sourceHealth = dataMeta?.sourceHealth?.status

  const doReset = () => {
    const outcomes = [
      resetTaste(), // wipes taste-v1 + the in-memory profile (taste.js owns both)
      lsRemove('fmn-seen-v1'), // Find My Night's no-repeat memory starts over too
      lsRemove('deck-last-v1'), // includes the deck's rated-card memory
    ]
    const persisted = outcomes.every(Boolean)
    setArming(false)
    setResetStatus(persisted ? 'persisted' : 'session-only')
  }

  return (
    <div className="pg st">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Settings &amp; Preferences</h1>
      </header>

      <div className="st-body">
        {/* Phase 3.6 N4: Settings regrouped by INTENT (was a "bunch of weird
            sections", Josh). Five clean groups: identity → tune → reset → data
            → about. Taste transparency + the deck are CANONICAL on Profile now
            (W6 hub); the rows here are demoted/retitled so they don't read as
            verbatim duplicates (⚑W5). ALL COPY DRAFT for Charles. */}

        {/* ===== D7 (A5): the quick primer is the ONLY taste entry in Settings now.
            "Customize interests" + the "Manage your taste in Profile" deep-link are
            removed — taste lives in Profile, and interests is reached from there. ===== */}
        <section className="st-sec">
          <div className="st-over">Customize your feed</div>
          <div className="st-rows">
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
              <button className="st-row st-row-danger" onClick={() => { setResetStatus(null); setArming(true) }}>
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
            {/* WS3 §9: engineered sprout (inherits the sage .st-wiped color), not 🌱 */}
            {resetStatus === 'persisted' && <div className="st-wiped">Wiped. The next tap starts the new you. <Icon.sprout className="meta-ic" aria-hidden /></div>}
            {resetStatus === 'session-only' && (
              <div className="st-reset-error" role="alert">
                Cleared for this visit, but your browser could not save the reset.
                Some preferences may return after you close Wuzup.
              </div>
            )}
          </div>
        </section>

        {/* ===== 4 · YOUR DATA & PRIVACY ===== */}
        <section className="st-sec">
          <div className="st-over">Your data &amp; privacy</div>
          {/* 3.7P-21: location is opt-in HERE (the inline "use my location" gate on
              Spots was retired). Granting it surfaces "Near you" everywhere,
              proximity-sorted; on-device only, the browser asks once. */}
          <div className="st-rows">
            <button
              className="st-row st-row-toggle"
              onClick={() => onAllowLocation(!locationAllowed)}
              aria-pressed={!!locationAllowed}
              aria-label="Allow location"
            >
              <span className="st-row-main">
                <span className="st-row-title">Allow location</span>
                <span className="st-row-sub">
                  Surfaces “Near you” spots, sorted by distance. On-device only — the browser asks once.
                </span>
              </span>
              <span className={'st-switch' + (locationAllowed ? ' on' : '')} aria-hidden>
                <span className="st-switch-knob" />
              </span>
            </button>
          </div>
          <div className="st-card">
            <div className="st-line">
              {evCount} events from {srcCount} local source{srcCount === 1 ? '' : 's'}
            </div>
            {Number.isFinite(dataAt) && <div className="st-line st-dim">Listings generated {fmtUpdated(dataAt)}</div>}
            {sourceHealth === 'healthy' && <div className="st-line st-dim">Source check complete</div>}
            {sourceHealth === 'degraded' && <div className="st-line st-dim">Some sources were unavailable</div>}
            {sourceHealth === 'unknown' && <div className="st-line st-dim">Source check unavailable for this snapshot</div>}
            <div className="st-line st-dim">Everything lives on this phone — no account, nothing leaves it.</div>
          </div>
        </section>

        {/* ===== 5 · ABOUT (Stage E: the ⚑X3 credits page is REAL now — the
            old coming-soon stub line is retired) ===== */}
        <section className="st-sec">
          <div className="st-over">About</div>
          <div className="st-card">
            <div className="st-line">Wuzup · {CITY.name} · early build (v0)</div>
          </div>
          <div className="st-rows">
            <button className="st-row" onClick={openAttribution}>
              <span className="st-row-main">
                <span className="st-row-title">Data &amp; photo credits</span>
                <span className="st-row-sub">Every source and photographer behind the app, disclosed</span>
              </span>
              <span className="st-row-go" aria-hidden>→</span>
            </button>
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
