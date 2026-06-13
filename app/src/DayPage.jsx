// DayPage — the day screen (Sprint U-a, CALENDAR_BRIEF Model C: "opening a
// day = an exploring/filling screen"). Mounted by App as subpage
// { type: 'day', ts } and KEYED on ts (the WB midnight-rollover trick from
// the risk register: a new day or a new target = a clean remount).
//
// Top to bottom: date header → weather line (when the 16-day forecast covers
// the day; an honest "too far out" caveat past coverage, ⚑U-HZN default) →
// the two plan slots (☀️ day / 🌙 night, same pickerModel + PickerSheet the
// Weekend Builder uses — ONE store, 'day-plans-v1', two lenses) → the quiet
// rest control → the day's agenda.
//
// REST RULE (U-a decision, documented for the report): rest and slots are
// MUTUALLY EXCLUSIVE. The "Mark it a quiet day 🌙" toggle is only OFFERED
// while both slots are empty; marking rest replaces the slot pickers with a
// calm filled card ("Quiet day") whose single quiet affordance un-rests the
// day and brings the pickers back. dayplan.js enforces the same rule at the
// store level (withSlot clears rest; withRest(on) refuses while slots are
// filled) so no caller can create the contradictory state. Rest renders as a
// CALM FILLED state — never as absence, never as failure, and the app never
// asks for it (ban list §7: user-initiated only, no prompts, no guilt copy).
//
// TWO FITS SEMANTICS (risk register): the AGENDA uses dayMap's one-day
// honesty — an event surfaces on exactly ONE day (its start day, clamped to
// today for in-progress multi-day runs). The PICKER pool uses fitsSlot's
// span semantics — a 3-week exhibit legitimately fills any day it covers.
// Counts therefore differ between the two sections BY DESIGN; the agenda
// header counts the agenda's own rule.
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, keyOf, timeOf } from './lib.js'
import { useNav } from './nav.jsx'
import { CardImg, EventCard, SponsoredTag } from './cards.jsx'
import { shelfItems, useSaves } from './saves.js'
import { tasteNudge } from './taste.js'
import { usePlaces, isPlaceKey } from './places.js'
import { daypartOf, fitsDay, pickerModel } from './weekend.js'
import { eventsIcs, shareDayText } from './share.js'
import { FillDayButton } from './DayFillDeck.jsx'
import {
  dayEntryFor,
  emptyDay,
  loadDayPlans,
  saveDayPlans,
  withClearedSlot,
  withRest,
  withSlot,
} from './dayplan.js'
import { dateKey, wxSummary } from './weather.js'
import PickerSheet from './PickerSheet.jsx'
import './day.css'

const wdLong = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })

export default function DayPage({ ts, events, anchors, wx }) {
  const { openDetail: onSelect, closePage: onClose, openAdd } = useNav()

  // the day-plan map: loaded once on mount (loadDayPlans runs the one-shot
  // WB migration + the past-day archive sweep), persisted on every change —
  // the same write-through pattern as the Weekend Builder view.
  const [plans, setPlans] = useState(() => loadDayPlans(anchors))
  useEffect(() => {
    saveDayPlans(plans)
  }, [plans])
  const entry = dayEntryFor(plans[String(ts)]) ?? emptyDay()
  const rest = entry.state === 'rest'

  // ===== header bits =====
  const title = ts === anchors.todayTs ? 'Today' : ts === anchors.tomorrowTs ? 'Tomorrow' : wdLong(ts)
  const dateLine = new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // weather: the 16-day forecast map (App-owned). No entry for this day +
  // a live map = the day is past coverage → say so honestly instead of
  // rendering silence that reads like a bug (⚑U-HZN default caveat).
  const w = wx ? wx[dateKey(ts)] : null
  const wxLine = wxSummary(w)

  // ===== agenda: dayMap's ONE-DAY semantics (see header comment) =====
  const agenda = useMemo(() => {
    const list = events.filter(
      (e) =>
        e._day != null &&
        (e._endDay ?? e._day) >= anchors.todayTs &&
        Math.max(e._day, anchors.todayTs) === ts
    )
    list.sort((a, b) => a._t - b._t)
    return list
  }, [events, anchors, ts])

  // ===== slots: the picker's resolution pool (same wiring as WB) =====
  const upcoming = useMemo(
    () => events.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs),
    [events, anchors]
  )
  const { list: savedList } = useSaves()
  const savedEvents = useMemo(
    () => shelfItems(savedList, events, anchors).filter((x) => !x.past).map((x) => x.e),
    [savedList, events, anchors]
  )
  // Sprint S: a slot can hold a PLACE (Make-this-my-plan writes a 'p|' key),
  // not just an event. Fold the lazy-loaded places into the resolver map so a
  // slotted place renders instead of silently vanishing. The places fetch
  // (~1.2MB) is triggered ONLY when this day actually holds a place key — an
  // event-only or empty day pays nothing (review HARDENING).
  const hasPlaceSlot = isPlaceKey(entry.slots.day) || isPlaceKey(entry.slots.night)
  const { places: placeList } = usePlaces(hasPlaceSlot)
  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of savedEvents) m.set(keyOf(e), e) // snapshots first…
    for (const e of upcoming) m.set(keyOf(e), e) // …live events win
    if (Array.isArray(placeList)) for (const p of placeList) m.set(p.key, p) // …places too
    return m
  }, [upcoming, savedEvents, placeList])
  const resolveSlot = useCallback(
    (k) => {
      const e = k ? byKey.get(k) : null
      if (!e) return null
      // a place is "always there" — it fits ANY day; only events are date-gated
      if (e.kind === 'place') return e
      return fitsDay(e, ts) ? e : null
    },
    [byKey, ts]
  )

  // ===== picker sheet (the WB open/close machine) =====
  const [picker, setPicker] = useState(null) // 'day' | 'night' | null
  const [sheetClosing, setSheetClosing] = useState(false)
  const sheetTRef = useRef(null)
  useEffect(() => () => clearTimeout(sheetTRef.current), [])
  const openSheet = (part) => {
    clearTimeout(sheetTRef.current)
    setSheetClosing(false)
    setPicker(part)
  }
  const closeSheet = useCallback(() => {
    setSheetClosing(true)
    clearTimeout(sheetTRef.current)
    sheetTRef.current = setTimeout(() => {
      setPicker(null)
      setSheetClosing(false)
    }, 240)
  }, [])

  const model = useMemo(() => {
    if (!picker) return null
    // dedup pool: this day's two slots (stale keys null out so a vanished
    // event can't keep blocking its own re-offer — the WB rule)
    const liveSlots = {
      day: entry.slots.day && byKey.has(entry.slots.day) ? entry.slots.day : null,
      night: entry.slots.night && byKey.has(entry.slots.night) ? entry.slots.night : null,
    }
    return pickerModel({
      ts,
      part: picker,
      upcoming,
      saved: savedEvents,
      plan: { slots: liveSlots },
      nudge: tasteNudge,
    })
  }, [picker, ts, upcoming, savedEvents, entry.slots.day, entry.slots.night, byKey])

  const assign = (e) => {
    if (!picker) return
    setPlans(withSlot(plans, ts, picker, keyOf(e))) // withSlot clears any rest mark
    closeSheet()
  }

  // ===== share this day (U-c): the entirety of invites v1 — a human text + a
  // multi-VEVENT .ics, through navigator.share with the app's copy/download
  // fallback (the DetailPage / WeekendBuilder pattern). Only offered when a
  // slot is filled: an empty or rest day has nothing to share (sharing rest
  // would need copy the ban list forbids), so the affordance simply isn't
  // shown there. shareEntries resolves both slots to live events in ☀️→🌙
  // order, dropping any that no longer fit (a refresh moved them). =====
  const dayKeySlot = entry.slots.day
  const nightKeySlot = entry.slots.night
  const shareEntries = useMemo(
    () =>
      [
        { part: 'day', e: resolveSlot(dayKeySlot) },
        { part: 'night', e: resolveSlot(nightKeySlot) },
      ].filter((x) => x.e),
    [resolveSlot, dayKeySlot, nightKeySlot]
  )
  const canShare = shareEntries.length > 0

  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1600)
  }
  const downloadIcs = (file) => {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const shareDay = async () => {
    if (!canShare) return
    const text = shareDayText(ts, shareEntries)
    if (!text) return
    // the .ics: one VEVENT per slotted entry. A PLACE has no date, so it
    // produces no VEVENT (share.js vevent guards it) — a place-only day would
    // otherwise build an EVENTLESS calendar and still flash "calendar saved",
    // which is a small lie. Only build the file when at least one slotted entry
    // is actually dated (an event). navigator.share carries it where supported;
    // the human text (which DOES include the place) is the universal payload.
    const datedEntries = shareEntries.filter((x) => x.e && x.e.start)
    let file = null
    if (datedEntries.length) {
      try {
        file = new File([eventsIcs(datedEntries.map((x) => x.e))], 'my-plan.ics', { type: 'text/calendar' })
      } catch {
        /* File constructor unavailable (older browsers) — text-only share */
      }
    }
    if (navigator.share) {
      const payload = { title: 'My plan', text }
      // only attach the file when this device's share sheet accepts files
      if (file && navigator.canShare?.({ files: [file] })) payload.files = [file]
      try {
        await navigator.share(payload)
        return
      } catch {
        /* user dismissed the share sheet — not an error, and not a fallback */
        return
      }
    }
    // no Web Share: copy the text, and also drop the .ics so the plan reaches a calendar
    if (file) downloadIcs(file)
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        flash(file ? 'Plan copied + calendar saved ✓' : 'Plan copied ✓')
      } catch {
        flash(file ? 'Calendar saved ✓' : "Couldn't copy the plan")
      }
    } else {
      flash(file ? 'Calendar saved ✓' : "Sharing isn't available here")
    }
  }

  const renderSlot = (part) => {
    const e = resolveSlot(entry.slots[part])
    return (
      <div className="dpg-slot" key={part}>
        <div className="dpg-part">{part === 'day' ? '☀️ Day' : '🌙 Night'}</div>
        {e ? (
          <div className="dpg-filled">
            <button className="dpg-card pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
              <CardImg e={e} className="dpg-thumb" />
              <span className="dpg-card-main">
                <span className="dpg-card-title">{e.title}</span>
                <span className="dpg-card-meta">
                  {[
                    e.kind === 'place' ? 'Always here' : daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null,
                    e.venue,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <SponsoredTag e={e} />
              </span>
            </button>
            <button
              className="wkb-clear dpg-clear"
              onClick={() => setPlans(withClearedSlot(plans, ts, part))}
              aria-label={`Clear ${e.title} from ${part === 'day' ? 'daytime' : 'night'}`}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            className="dpg-empty pressable"
            onClick={() => openSheet(part)}
            aria-label={`Plan the ${part === 'day' ? 'daytime' : 'night'}`}
          >
            <span className="dpg-empty-txt">Open — tap to plan</span>
          </button>
        )}
      </div>
    )
  }

  const slotsEmpty = !entry.slots.day && !entry.slots.night

  return (
    <div className="pg dpg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <div>
          <h1 className="pg-head-title">{title}</h1>
          <div className="pg-count">{dateLine}</div>
        </div>
      </header>
      <div className="pg-body dpg-body">
        {wxLine ? (
          <div className="dpg-wx">{wxLine}</div>
        ) : (
          wx && ts > anchors.todayTs && (
            <div className="dpg-wx dpg-wx-far">Too far out for a forecast — it reaches ~16 days</div>
          )
        )}

        {/* ===== your plan: two slots, or the calm rest card ===== */}
        <h3 className="day-header dpg-sec">Your plan</h3>
        {rest ? (
          <div className="dpg-rest">
            <div className="dpg-rest-title">🌙 Quiet day</div>
            <div className="dpg-rest-sub">Resting is a plan too. Nothing to do here.</div>
            <button className="dpg-rest-undo" onClick={() => setPlans(withRest(plans, ts, false))}>
              Plan this day instead
            </button>
          </div>
        ) : (
          <>
            <div className="dpg-slots">
              {renderSlot('day')}
              {renderSlot('night')}
            </div>
            <div className="dpg-plan-actions">
              {/* day-fill deck (U-b): the THIRD decide-for-me lens — deal the
                  events + always-there spots that could fill this day. Offered
                  while at least one slot is open (a fully-planned day has
                  nothing to fill); the deck itself falls back to the picker on
                  ≤3 candidates. DRAFT */}
              {!(entry.slots.day && entry.slots.night) && <FillDayButton ts={ts} />}
              {/* create-from-day (U-c): opens the existing Add flow with this
                  day pre-filled; submitting auto-slots it back here. DRAFT */}
              <button className="dpg-own-btn" onClick={() => openAdd(ts)}>
                + Add your own
              </button>
              {/* share this day (U-c) — only when a slot is filled */}
              {canShare && (
                <button className="dpg-share-btn" onClick={shareDay}>
                  📤 Share this day
                </button>
              )}
            </div>
            {/* the quiet rest control: ONLY offered while both slots are
                empty (the mutual-exclusivity rule), only ever user-initiated */}
            {slotsEmpty && (
              <button className="dpg-rest-btn" onClick={() => setPlans(withRest(plans, ts, true))}>
                Mark it a quiet day 🌙
              </button>
            )}
          </>
        )}

        {/* ===== the day's agenda (one-day semantics — see header comment;
            the picker above may legitimately offer MORE via span fits) ===== */}
        <h3 className="day-header dpg-sec">
          Happening {ts === anchors.todayTs ? 'today' : 'this day'}
          {agenda.length ? ` · ${agenda.length}` : ''}
        </h3>
        <div className="cal-list">
          {agenda.length ? (
            agenda.map((e, i) => <EventCard key={keyOf(e) + i} e={e} index={i} onSelect={onSelect} />)
          ) : (
            <div className="empty empty-sm">Nothing listed for this day yet.</div>
          )}
        </div>
      </div>

      {picker && model && (
        <PickerSheet
          title={(picker === 'day' ? '☀️ ' : '🌙 ') + wdLong(ts) + (picker === 'day' ? ' daytime' : ' night')}
          model={model}
          noSaves={savedList.length === 0}
          closing={sheetClosing}
          onPick={assign}
          onClose={closeSheet}
        />
      )}
      {toast && <div className="detail-toast wkb-toast">{toast}</div>}
    </div>
  )
}
