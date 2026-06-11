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
import { daypartOf, fitsDay, pickerModel } from './weekend.js'
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
  const { openDetail: onSelect, closePage: onClose } = useNav()

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
  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of savedEvents) m.set(keyOf(e), e) // snapshots first…
    for (const e of upcoming) m.set(keyOf(e), e) // …live events win
    return m
  }, [upcoming, savedEvents])
  const resolveSlot = useCallback(
    (k) => {
      const e = k ? byKey.get(k) : null
      return e && fitsDay(e, ts) ? e : null
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
                  {[daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null, e.venue]
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
    </div>
  )
}
