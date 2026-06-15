// DayFillDeck — Sprint U-b: the THIRD decide-for-me lens (Q2f), a finite deck
// dealt onto ONE day from the DayPage "🃏 Fill this day" button. It rides the
// SAME SwipeDeck machinery as LensDeck/CalibrationDeck, but its right-swipe
// verdict is the day-screen action it serves: SLOT THIS INTO THE DAY.
//
// POOL (dayfill.js): events that fitsDay the target day's span (an earlier-
// started run rides as an honest "Ongoing" card) PLUS the always-there PLACES
// that fit any day — the evergreen cards that keep a thin weekday from being a
// 4-card embarrassment (the whole reason U-b waited for Places supply).
//
// VERDICTS (Q3 contract, each fired exactly once per committed card):
//   right / ✓  SLOT  → withSlot into this day, daypartOf auto-routes ☀️/🌙
//              (a place / date-only event = 'any' → day-first), NEVER clobbers
//              a filled slot (falls to the other; if both full, the card is
//              counted "slotted-skipped" with an honest toast, nothing
//              overwritten). Slotting earns NO taste signal in v1 (CALENDAR_BRIEF
//              §5 U-d: the nudge ceiling 18 is the wall — slotting must not farm).
//   left  / ✕  pass  → recordCalibration('no') (−1 category, floored at 0) AND
//              pushFmnSeen so FMN rerolls respect the rejection. Ordering only.
//   up    / ♥  save  → saves.js toggle (the seam records +3). Already-saved
//              stays saved. up = COMMIT here (save and advance) — unlike
//              LensDeck's peek, because the day-fill flow's "looking closer"
//              affordance is the slot itself.
//
// FATIGUE GUARD: one deck per DAY per session (dealtThisSession, module-level,
// in-memory — "this session" is the honest scope). ≤3 candidates → this
// component is never mounted: DayPage falls back to the picker (the spec's
// no-thin-3-card-deck rule). The deck deals ONCE per mount (App rebuilds norm
// identities; a re-deal mid-swipe would reshuffle under the thumb).
//
// CALENDAR_BRIEF §7 BAN LIST binds this surface: NO streaks, NO guilt, NO
// "you've planned N days" nagging, NO --reward (the end card is a stopping cue,
// not a sanctioned moment). ALL COPY IS DRAFT for Charles.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, dayLabel, keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { useSaves } from './saves.js'
import { recordCalibration, tasteNudge } from './taste.js'
import { pushFmnSeen } from './fmnseen.js'
import { usePlaces } from './places.js'
import { daypartOf } from './weekend.js'
import { dealDayFill, dayFillIdOf } from './dayfill.js'
import {
  dayEntryFor,
  loadDayPlans,
  saveDayPlans,
  withSlot,
} from './dayplan.js'
import SwipeDeck from './SwipeDeck.jsx'
import { DeckFace } from './CalibrationDeck.jsx'
import './lensdeck.css'
import './dayfill.css'

// the session fatigue guard — one fill-deck per day per session (mirrors
// LensDeck's dealtThisSession; deliberately NOT localStorage)
const dealtThisSession = new Set()

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// the day-fill face: events reuse the verified DeckFace; a PLACE gets a sibling
// face with NO time (a place has no date — never fabricate one) + the honest
// "always here · no schedule" line. Both share the deck-img/-info chrome.
function FillFace({ e }) {
  // W4: a place can now carry a real photo. A dead URL must fall back to the 📍
  // placeholder, never the browser's broken-image glyph (the trust contract).
  const [imgFailed, setImgFailed] = useState(false)
  if (e.kind !== 'place') return <DeckFace e={e} />
  return (
    <>
      <div className="deck-img dfk-place-img" data-vt="">
        {e.image && !imgFailed ? (
          <img src={e.image} alt="" loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          <span className="dfk-place-emoji" aria-hidden>📍</span>
        )}
      </div>
      <div className="deck-info">
        <span className="deck-cat dfk-place-cat">📍 Always here · no schedule</span>
        <div className="deck-title">{e.title}</div>
        {e.venue && <div className="deck-meta">{e.venue}</div>}
        <div className="deck-extra">
          {e.isFree === true && <span className="dfk-place-free">Free</span>}
        </div>
      </div>
    </>
  )
}

export default function DayFillDeck({ lens, events, anchors, coords }) {
  const { openDetail, openDay } = useNav()
  const { has, toggle } = useSaves()
  const reduced = useMemo(() => prefersReduced(), [])
  const ts = lens.dayTs
  // the fill deck's whole job on a thin day is to offer always-there spots, so
  // places are always enabled — but we must DEAL only AFTER they resolve (a
  // cold open starts places=null; dealing then would silently drop the entire
  // place tail — the very thing the deck exists to add). status drives the wait.
  const { places: placeList, status: placesStatus } = usePlaces(true)

  // DEAL only once places have RESOLVED (ready or honest error) — null while
  // loading (phase 'loading'). A pure useMemo, NOT a setState-in-effect (the
  // store already emits): its deps (events/myEvents-derived norm, anchors, ts,
  // placeList, status) DO NOT change while the user swipes — recordCalibration/
  // toggle/withSlot touch the taste/saves/dayplan stores, never `events` — so
  // the deck is frozen for the session and never reshuffles under the thumb
  // (FMN's late-arrival pattern). The cold-open fix: dealing before places
  // resolve would silently drop the whole place tail, the deck's whole point.
  const [done, setDone] = useState(false)
  const deck = useMemo(
    () =>
      placesStatus === 'ready' || placesStatus === 'error'
        ? dealDayFill(events, placeList, ts, anchors, tasteNudge, coords)
        : null,
    [placesStatus, placeList, events, ts, anchors, coords]
  )
  const [slotted, setSlotted] = useState(0)
  const [passed, setPassed] = useState(0)
  const [saved, setSavedN] = useState(0)
  // phase derives from the deal: 'loading' until places resolve, then
  // empty / thin (≤3 → honest picker fallback, never a 3-card deck) / rate;
  // 'done' once the stack is exhausted.
  const phase = done
    ? 'done'
    : deck == null
      ? 'loading'
      : deck.length === 0
        ? 'empty'
        : deck.length <= 3
          ? 'thin'
          : 'rate'
  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  const deckApi = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  // back ALWAYS returns to the day this deck fills (openLensDeck replaced the
  // day subpage, so closePage would land on the Calendar tab — and the cards
  // just swiped in would be invisible until re-navigating; the "Back to {label}"
  // copy would be a lie). DayPage re-reads the store on mount, so slotted cards
  // show on return.
  const back = () => openDay(ts)

  useEffect(() => {
    dealtThisSession.add(dayFillIdOf(lens))
  }, [lens])

  const label = dayLabel(ts, anchors)
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1500)
  }

  const idx = slotted + passed + saved
  const top = deck ? deck[idx] : null
  const isSaved = top ? has(top) : false

  // ===== the verdicts =====
  // SLOT: route by daypart, never clobber. Slotting earns NO taste signal (v1).
  const slotIt = (e) => {
    const k = keyOf(e)
    const map = loadDayPlans(anchors)
    const cur = dayEntryFor(map[String(ts)])
    const part = daypartOf(e) // 'day' | 'night' | 'any' (places + date-only)
    const order = part === 'night' ? ['night', 'day'] : ['day', 'night'] // 'any' → day first
    const target = order.find((p) => !(cur && cur.slots[p]))
    if (!target) {
      flash('Both slots are full — cleared nothing') // never overwrite silently
    } else {
      saveDayPlans(withSlot(map, ts, target, k)) // withSlot clears any rest mark
      flash((target === 'day' ? '☀️' : '🌙') + ' Added to ' + label)
    }
    setSlotted((n) => n + 1)
  }
  const passIt = (e) => {
    recordCalibration('no', e) // −1 category, floored at 0 — ordering only
    pushFmnSeen(keyOf(e)) // FMN rerolls respect the pass
    setPassed((n) => n + 1)
  }
  const saveIt = (e) => {
    if (!has(e)) toggle(e) // the save seam records the +3; already-saved stays saved
    setSavedN((n) => n + 1)
  }

  // ===== end card — the honest stopping cue (NO --reward, by contract) =====
  if (phase === 'done') {
    return (
      <div className="pg ldk dfk">
        <header className="pg-head ldk-head">
          <button className="pg-back" onClick={back} aria-label="Back">
            <Icon.chevron />
          </button>
          <h1 className="pg-head-title">Fill {label}</h1>
        </header>
        <div className="pg-body ldk-body">
          <div className="ldk-done">
            <div className="ldk-done-emoji" aria-hidden>
              🗓️
            </div>
            <h2 className="ldk-done-title">{slotted > 0 ? `${label} is taking shape.` : 'That’s the whole deck.'}</h2>
            <div className="ldk-done-sub">
              {deck.length} seen — added {slotted} · saved {saved} ♥ · passed {passed}
            </div>
            <button className="ldk-done-btn pressable" onClick={back}>
              Back to {label}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pg ldk dfk">
      <header className="pg-head ldk-head">
        <button className="pg-back" onClick={back} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Fill {label}</h1>
        {phase === 'rate' && (
          <div className="ldk-counthead" aria-label={`Card ${Math.min(idx + 1, deck.length)} of ${deck.length}`}>
            {Math.min(idx + 1, deck.length)}/{deck.length}
          </div>
        )}
      </header>

      <div className="pg-body ldk-body">
        {phase === 'loading' ? (
          <div className="ldk-empty">
            <div className="ldk-empty-emoji" aria-hidden>
              🗓️
            </div>
            <p>Dealing {label}…</p>
          </div>
        ) : phase === 'empty' || phase === 'thin' ? (
          <div className="ldk-empty">
            <div className="ldk-empty-emoji" aria-hidden>
              🗓️
            </div>
            {phase === 'thin' ? (
              <p>
                Only {deck.length} thing{deck.length === 1 ? '' : 's'} for {label} — not enough for a deck.
                <br />
                Tap a slot on the day screen to add {deck.length === 1 ? 'it' : 'one'} directly.
              </p>
            ) : (
              <p>Nothing to deal for this day right now.</p>
            )}
            <button className="ldk-done-btn pressable" onClick={back}>
              Back to {label}
            </button>
          </div>
        ) : (
          <>
            <div className="ldk-kicker">
              <div className="ldk-kicker-title">
                {deck.length} could fill {label}
              </div>
              <div className="ldk-kicker-sub">
                {reduced
                  ? '✓ adds it to the day, ✕ passes, ♥ saves for later.'
                  : 'Swipe or tap: → adds it to the day, ← passes, ↑ saves for later.'}
              </div>
            </div>

            <SwipeDeck
              cards={deck}
              keyFor={keyOf}
              classPrefix="ldk"
              upMode="commit"
              apiRef={deckApi}
              renderCard={(e) => <FillFace e={e} />}
              stamps={
                <>
                  <span className="ldk-stamp ldk-stamp-keep dfk-stamp-slot" aria-hidden>
                    Add ✓
                  </span>
                  <span className="ldk-stamp ldk-stamp-pass" aria-hidden>
                    Pass
                  </span>
                  <span className="ldk-stamp ldk-stamp-open dfk-stamp-save" aria-hidden>
                    Save ♥
                  </span>
                </>
              }
              onLeft={passIt}
              onRight={slotIt}
              onUp={saveIt}
              onDone={() => setDone(true)}
            />

            <div className="ldk-actions">
              <button
                className="ldk-btn ldk-btn-pass pressable"
                onClick={() => deckApi.current?.left()}
                aria-label="Pass"
              >
                ✕
              </button>
              <button
                className={'ldk-btn ldk-btn-keep pressable' + (isSaved ? ' is-saved' : '')}
                onClick={() => deckApi.current?.up()}
                aria-label={isSaved ? 'Already on your list' : 'Save for later'}
              >
                ♥
              </button>
              <button
                className="ldk-btn ldk-btn-slot pressable"
                onClick={() => deckApi.current?.right()}
                aria-label={`Add to ${label}`}
              >
                ✓
              </button>
            </div>

            {/* open the full detail without spending a verdict (a quiet escape) */}
            {top && (
              <button className="dfk-peek" onClick={() => openDetail(top)}>
                See full details →
              </button>
            )}
          </>
        )}
      </div>
      {toast && <div className="detail-toast dfk-toast">{toast}</div>}
    </div>
  )
}

// the DayPage entry: "🃏 Fill this day". It always opens the deck page; the
// deck itself owns the ≤3 → fallback-to-picker decision (the candidate count
// depends on the lazily-loaded places, so the honest place to gate is after the
// deal, not before). Exposed so DayPage imports ONE thing and the fatigue
// state stays module-local (mirrors LensDeck's DeckThisButton).
// `prominent` (N5c): on an EMPTY day the deck is the LEAD way to build it, so it
// renders as a hero card (icon + title + sub) instead of the small chip used as
// a secondary action once a slot is filled. Same destination either way.
export function FillDayButton({ ts, prominent = false }) {
  const { openLensDeck } = useNav()
  const again = dealtThisSession.has(dayFillIdOf({ dayTs: ts }))
  const open = () => openLensDeck({ kind: 'dayfill', dayTs: ts })
  if (prominent) {
    return (
      <button className="dfk-entry-hero pressable" onClick={open}>
        <span className="dfk-hero-ic" aria-hidden>🃏</span>
        <span className="dfk-hero-main">
          <span className="dfk-hero-title">{again ? 'Deal again' : 'Build this day'}</span>
          <span className="dfk-hero-sub">Swipe a quick deck of what fits — keep what you like</span>
        </span>
        <span className="dfk-hero-go" aria-hidden>→</span>
      </button>
    )
  }
  return (
    <button className="dfk-entry pressable" onClick={open}>
      <span aria-hidden>🃏</span> {again ? 'Deal again' : 'Fill this day'}
    </button>
  )
}
