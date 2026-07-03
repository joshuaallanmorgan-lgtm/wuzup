// DayPage — the day screen (Sprint U-a, CALENDAR_BRIEF Model C: "opening a
// day = an exploring/filling screen"). Mounted by App as subpage
// { type: 'day', ts } and KEYED on ts (the WB midnight-rollover trick from
// the risk register: a new day or a new target = a clean remount).
//
// Top to bottom: date header → weather line (when the 16-day forecast covers
// the day; an honest "too far out" caveat past coverage, ⚑U-HZN default) →
// the three plan slots (☀️ Morning / ☀️ Afternoon / 🌙 Night, same pickerModel +
// PickerSheet the Weekend Builder uses — ONE store, 'day-plans-v1', the ⚑PLAN-P0
// ternary dayparts) → the quiet rest control → the day's agenda.
// (⚑PLAN-P0 note: this is the functional 3-slot data layer; the pixel-match
// "Plan your day" layout — expanded weather, tappable day-selector → calendar
// picker, "Suggestions for you" formatting — lands in Plan Phase 1.)
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
import { fmtLocale, Icon, keyOf, timeOf } from './lib.js'
import { useNav } from './nav.jsx'
import { CardImg, SponsoredTag, featuredChips } from './cards.jsx'
import { shelfItems, useSaves } from './saves.js'
import { tasteNudge, useTaste, railReady } from './taste.js'
import { usePlaces, isPlaceKey } from './places.js'
import { daypartOf, fitsDay, pickerModel, whyFits, wxMood, DAYPART } from './weekend.js'
import { eventsIcs, shareDayText } from './share.js'
import {
  dayEntryFor,
  emptyDay,
  loadDayPlans,
  saveDayPlans,
  withClearedSlot,
  withRest,
  withSlot,
  PARTS,
} from './dayplan.js'
import { dateKey, CONDITION } from './weather.js'
import PickerSheet from './PickerSheet.jsx'
import './day.css'

const wdLong = (ts) => new Date(ts).toLocaleDateString(fmtLocale, { weekday: 'long' })

export default function DayPage({ ts, events, anchors, wx }) {
  // openCalendarPicker is the Plan Phase 2 date-picker opener; in Phase 1 the
  // tappable day-selector wires to it (guarded `?.` — a no-op until Phase 2 adds
  // it to nav). openDay still drives keyed remounts from the picker once it lands.
  const { openDetail: onSelect, closePage: onClose, openAdd, openCalendarPicker, detail } = useNav()
  const taste = useTaste()

  // the day-plan map: loaded once on mount (loadDayPlans runs the one-shot
  // WB migration + the past-day archive sweep), persisted on every change —
  // the same write-through pattern as the Weekend Builder view.
  const [plans, setPlans] = useState(() => loadDayPlans(anchors))
  useEffect(() => {
    saveDayPlans(plans)
  }, [plans])
  // 3.7P-34 review: an event detail can open OVER this (still-mounted) day screen
  // (agenda card → detail → "Add to day"). Re-read the non-reactive localStorage
  // store when the detail layer closes so a slot seeded from there shows without a
  // remount (CalendarView re-derives on the same edge). Syncing an EXTERNAL store
  // on a close edge is a legitimate effect; no loop (deps are [detail, anchors],
  // not plans, and the read is idempotent).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-store sync on layer-close edge
    if (!detail) setPlans(loadDayPlans(anchors))
  }, [detail, anchors])
  const entry = dayEntryFor(plans[String(ts)]) ?? emptyDay()
  const rest = entry.state === 'rest'
  // 3.7P-4b: a satisfying gold pop on the slot you just filled (Recipe A, the
  // savePop curve in --accent — planning earns NO --reward violet per the ban
  // list, so this is brand-gold + scale only). justFilled holds the popped part
  // for one beat, then clears.
  const [justFilled, setJustFilled] = useState(null)
  const fillTRef = useRef(null)
  useEffect(() => () => clearTimeout(fillTRef.current), [])
  // Plan Phase 2: the planned-item "⋯" menu (flows-1 p4) — Move to a different
  // time / Remove from plan. menuPart = the slot whose ⋯ is open; moveMode flips
  // the menu to the daypart chooser.
  const [menuPart, setMenuPart] = useState(null)
  const [moveMode, setMoveMode] = useState(false)
  const menuBtnRef = useRef(null) // the ⋯ trigger that opened the menu — focus returns here
  const menuRef = useRef(null) // the dialog container (focus-in + Tab-trap)
  const openMenu = (part, btn) => {
    menuBtnRef.current = btn || null
    setMenuPart(part)
    setMoveMode(false)
  }
  const closeMenu = () => {
    setMenuPart(null)
    setMoveMode(false)
  }
  // user-dismiss (scrim / Cancel): close AND return focus to the ⋯ trigger (WCAG
  // 2.4.3). Remove/Move keep closeMenu — they destroy/move the slot, so the trigger
  // unmounts and there is nothing to return focus to.
  const dismissMenu = () => {
    const btn = menuBtnRef.current
    closeMenu()
    btn?.focus()
  }
  // focus-in: drop focus onto the first action when the menu opens or swaps modes
  useEffect(() => {
    if (!menuPart) return
    const first = menuRef.current?.querySelector('.dpg-menu-item:not(:disabled)')
    ;(first || menuRef.current)?.focus()
  }, [menuPart, moveMode])
  // Tab-trap inside the open menu (mirrors the LensNav / DetailPage dialogs)
  const menuTrap = (ev) => {
    if (ev.key !== 'Tab') return
    const items = menuRef.current?.querySelectorAll('button:not(:disabled)')
    if (!items || !items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault()
      first.focus()
    }
  }
  // capture-phase Escape closes the menu BEFORE nav's window listener closes the
  // whole DayPage (the PickerSheet pattern); returns focus to the ⋯ trigger
  useEffect(() => {
    if (!menuPart) return
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      const btn = menuBtnRef.current
      setMenuPart(null)
      setMoveMode(false)
      btn?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menuPart])

  // ===== header bits =====
  // The header title is the constant "Plan your day"; this dayLabel (Today /
  // Tomorrow / weekday) + the short date feed the tappable day selector, which
  // opens the date picker (Plan Phase 2). day-plan keys stay ts-keyed.
  const dayLabel = ts === anchors.todayTs ? 'Today' : ts === anchors.tomorrowTs ? 'Tomorrow' : wdLong(ts)
  const monthDay = new Date(ts).toLocaleDateString(fmtLocale, { month: 'short', day: 'numeric' })

  // weather: the 16-day forecast map (App-owned). No entry for this day +
  // a live map = the day is past coverage → say so honestly instead of
  // rendering silence that reads like a bug (⚑U-HZN default caveat).
  const w = wx ? wx[dateKey(ts)] : null
  // 3.74: a gentle, honest decision cue off the real forecast (never pressure) —
  // shares wxMood() with the picker chips so they can't desync (review fix).
  const wxMoodToday = wxMood(w)
  const wxCue =
    wxMoodToday === 'clear'
      ? 'A good day to get outside.'
      : wxMoodToday === 'rainy'
        ? 'Rain likely — indoor plans might be the move.'
        : null
  // Plan Phase 1: the expanded weather module — a temp+condition headline and an
  // honest second line (the decision cue, else a real rain figure). Both come
  // straight from the daily forecast — no fabricated hourly detail.
  const wxTempLine = w ? `${w.hi != null ? w.hi + '° · ' : ''}${CONDITION[w.emoji] || 'Forecast'}` : null
  const wxDetail = wxCue || (w && w.rain != null ? `${w.rain}% chance of rain` : null)
  // the tappable day-selector label: "Today, Jun 24" / "Friday, Jun 20" (relative
  // when near, weekday otherwise) — matches ref-plan.png's comma format.
  const selLabel = `${dayLabel}, ${monthDay}`

  // ===== agenda: dayMap's ONE-DAY semantics (see header comment) =====
  // Plan Phase 1: "Suggestions for you" REORDERS by taste AND the day's real
  // weather (count-preserving; never hides) — so the subline "Based on weather and
  // your likes" is honest. The weather bonus is small + real: on a clear day an
  // outdoor pick lifts; on a rainy day an indoor pick lifts. Time breaks ties.
  const wxBonus = useCallback(
    (e) => {
      if (wxMoodToday === 'clear' && e.category === 'outdoors') return 6
      if (wxMoodToday === 'rainy' && e.kind !== 'place' && e.category !== 'outdoors') return 6
      return 0
    },
    [wxMoodToday]
  )
  const agenda = useMemo(() => {
    const list = events.filter(
      (e) =>
        e._day != null &&
        (e._endDay ?? e._day) >= anchors.todayTs &&
        Math.max(e._day, anchors.todayTs) === ts
    )
    list.sort((a, b) => tasteNudge(b, taste) + wxBonus(b) - (tasteNudge(a, taste) + wxBonus(a)) || a._t - b._t)
    return list
  }, [events, anchors, ts, taste, wxBonus])
  // the honest basis line — only claims a signal that actually informed the order
  const hasTaste = railReady(taste)
  const suggSub = hasTaste && w ? 'Based on weather and your likes' : hasTaste ? 'Based on what you like' : w ? "Based on the day's weather" : 'Everything on for this day'

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
  const hasPlaceSlot = PARTS.some((p) => isPlaceKey(entry.slots[p]))
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
  const [picker, setPicker] = useState(null) // 'morning' | 'afternoon' | 'night' | null
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
    // dedup pool: this day's filled slots (stale keys null out so a vanished
    // event can't keep blocking its own re-offer — the WB rule)
    const liveSlots = Object.fromEntries(
      PARTS.map((p) => [p, entry.slots[p] && byKey.has(entry.slots[p]) ? entry.slots[p] : null])
    )
    const m = pickerModel({
      ts,
      part: picker,
      upcoming,
      saved: savedEvents,
      plan: { slots: liveSlots },
      nudge: tasteNudge,
    })
    // 3.74: attach an honest "why it fits" reason per candidate (weather/free/taste)
    const dw = wx ? wx[dateKey(ts)] : null
    const tag = (e) => ({ ...e, _why: whyFits(e, { w: dw, nudge: tasteNudge }) })
    return { saved: m.saved.map(tag), suggestions: m.suggestions.map(tag) }
    // deps ARE the three primitive slot values (PARTS is exactly these); the memo
    // reads them via the computed entry.slots[p], which exhaustive-deps can't match
    // to the static deps. NOT entry.slots itself — dayEntryFor returns a fresh
    // object every render, so depending on it would defeat the memo. (was clean as
    // entry.slots.day/.night pre-⚑PLAN-P0; the computed read is the only change.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, ts, upcoming, savedEvents, entry.slots.morning, entry.slots.afternoon, entry.slots.night, byKey, wx])

  const assign = (e) => {
    if (!picker) return
    const part = picker
    setPlans(withSlot(plans, ts, part, keyOf(e))) // withSlot clears any rest mark
    setJustFilled(part) // 3.7P-4b: pop the slot that just got a plan
    clearTimeout(fillTRef.current)
    fillTRef.current = setTimeout(() => setJustFilled(null), 460)
    closeSheet()
  }

  // ===== share this day (U-c): the entirety of invites v1 — a human text + a
  // multi-VEVENT .ics, through navigator.share with the app's copy/download
  // fallback (the DetailPage / WeekendBuilder pattern). Only offered when a
  // slot is filled: an empty or rest day has nothing to share (sharing rest
  // would need copy the ban list forbids), so the affordance simply isn't
  // shown there. shareEntries resolves both slots to live events in ☀️→🌙
  // order (morning → afternoon → night), dropping any that no longer fit (a
  // refresh moved them). =====
  const shareEntries = useMemo(
    () => PARTS.map((part) => ({ part, e: resolveSlot(entry.slots[part]) })).filter((x) => x.e),
    // deps = the three primitive slot values (computed entry.slots[part] read; see the model memo above)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolveSlot, entry.slots.morning, entry.slots.afternoon, entry.slots.night]
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
  // S1-D7: a per-suggestion quick-add — slot the event into its natural daypart for
  // THIS day (the shared withSlot seam, same as Home/HotView "Add to day"). A taken
  // slot flashes instead of clobbering; an open slot pops + toasts.
  const addToDay = (e) => {
    const dp = daypartOf(e)
    const part = dp === 'any' ? 'morning' : dp // 'any' (places/date-only) → the day's start
    const label = DAYPART[part].label.toLowerCase()
    if (entry.slots[part]) {
      flash(`Your ${label} slot is taken — clear it first`)
      return
    }
    setPlans(withSlot(plans, ts, part, keyOf(e)))
    setJustFilled(part)
    clearTimeout(fillTRef.current)
    fillTRef.current = setTimeout(() => setJustFilled(null), 460)
    flash(`Added to ${label} ✓`)
  }
  // Plan Phase 2 (flows-1 p4): move a planned item to another daypart (carry the
  // key over, clear the old slot) — never clobbers a filled target. Remove drops
  // the slot. Both ride the param-based withSlot/withClearedSlot seams.
  const moveSlot = (from, to) => {
    const key = entry.slots[from]
    if (!key || entry.slots[to]) return
    setPlans(withClearedSlot(withSlot(plans, ts, to, key), ts, from))
    setJustFilled(to)
    clearTimeout(fillTRef.current)
    fillTRef.current = setTimeout(() => setJustFilled(null), 460)
    closeMenu()
    flash(`Moved to ${DAYPART[to].label.toLowerCase()} ✓`)
  }
  const removeSlot = (part) => {
    setPlans(withClearedSlot(plans, ts, part))
    closeMenu()
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

  // Plan Phase 1 (ref-plan.png): the section label is the plain daypart name; a
  // FILLED slot is a card (thumb + time badge · title · 📍venue · time · chips · ⋯)
  // and an EMPTY slot is the dashed invitation ("Add a … plan" + a circled +).
  const renderSlot = (part) => {
    const e = resolveSlot(entry.slots[part])
    const partLow = DAYPART[part].label.toLowerCase()
    const art = part === 'afternoon' ? 'an' : 'a' // "an afternoon" (vowel sound)
    const chips = e ? featuredChips(e) : []
    const timeBadge = e && e.kind !== 'place' && daypartOf(e) !== 'any' ? timeOf(e.start) : null
    const whenLine = e
      ? e.kind === 'place'
        ? 'Always here · no set time'
        : daypartOf(e) === 'any'
          ? 'Anytime'
          : [timeOf(e.start), e.end ? timeOf(e.end) : null].filter(Boolean).join(' – ')
      : null
    return (
      <div className="dpg-slot" key={part}>
        <div className="dpg-part">{DAYPART[part].label}</div>
        {e ? (
          <div className={'dpg-filled' + (justFilled === part ? ' pop' : '')}>
            <button className="dpg-card pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
              <CardImg e={e} className="dpg-thumb">
                {timeBadge && <span className="dpg-thumb-time">{timeBadge}</span>}
              </CardImg>
              <span className="dpg-card-main">
                <span className="dpg-card-title">{e.title}</span>
                {e.venue && <span className="dpg-card-venue"><Icon.pin className="meta-ic" aria-hidden /> {e.venue}</span>}
                {whenLine && <span className="dpg-card-meta">{whenLine}</span>}
                {chips.length > 0 && (
                  <span className="dpg-card-chips">
                    {chips.map((c, i) => (
                      <span className="dpg-chip" key={i}>{c}</span>
                    ))}
                  </span>
                )}
                <SponsoredTag e={e} />
              </span>
            </button>
            {/* Plan Phase 2 (flows-1 p4): the ⋯ opens the move/remove menu */}
            <button className="dpg-more" onClick={(ev) => openMenu(part, ev.currentTarget)} aria-haspopup="dialog" aria-expanded={menuPart === part} aria-label={`Options for ${e.title}`}>
              {/* WS3 §9: engineered kebab, not the ⋯ text glyph */}
              <Icon.dots aria-hidden />
            </button>
          </div>
        ) : (
          <button className="dpg-empty pressable" onClick={() => openSheet(part)} aria-label={`Add ${art} ${partLow} plan`}>
            <span className="dpg-empty-main">
              <span className="dpg-empty-txt">Add {art} {partLow} plan</span>
              <span className="dpg-empty-sub">Tap to get started</span>
            </span>
            <span className="dpg-empty-plus" aria-hidden>+</span>
          </button>
        )}
      </div>
    )
  }

  const slotsEmpty = !PARTS.some((p) => entry.slots[p])

  return (
    <div className="pg dpg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        {/* S1-D2: constant title; the date moves into the day selector below. */}
        <h1 className="pg-head-title">Plan Your Day</h1>
      </header>
      <div className="pg-body dpg-body">
        {/* Plan Phase 1 (ref-plan.png): the tappable day selector — the label +
            calendar icon open the date picker (openCalendarPicker; the picker PAGE
            lands in Plan Phase 2, so the wiring is guarded until then). */}
        <div className="dpg-daysel">
          <button className="dpg-daysel-label pressable" onClick={() => openCalendarPicker?.(ts)} aria-label={`Change date — ${selLabel}`}>
            {selLabel}
            <svg className="dpg-daysel-caret" viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="dpg-daysel-cal pressable" onClick={() => openCalendarPicker?.(ts)} aria-label="Open calendar">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M3 9.5h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Plan Phase 1: the expanded weather module — emoji + temp/condition, with
            an honest second line (decision cue or a real rain figure). */}
        {wxTempLine ? (
          <div className="dpg-wx">
            <span className="dpg-wx-emoji" aria-hidden>{w.emoji}</span>
            <span className="dpg-wx-text">
              <span className="dpg-wx-temp">{wxTempLine}</span>
              {wxDetail && <span className="dpg-wx-detail">{wxDetail}</span>}
            </span>
          </div>
        ) : (
          wx && ts > anchors.todayTs && (
            <div className="dpg-wx dpg-wx-far">Too far out for a forecast — it reaches ~16 days</div>
          )
        )}

        {/* Plan Phase 1: small folded utility actions near the top. "Mark a quiet
            day" only while every slot is empty (the mutual-exclusivity rule); the
            row hides once resting. */}
        {!rest && (
          <div className="dpg-top-actions">
            <button className="dpg-fold-btn" onClick={() => openAdd(ts)}>+ Add your own</button>
            {slotsEmpty && (
              <button className="dpg-fold-btn" onClick={() => setPlans(withRest(plans, ts, true))}>
                Mark a quiet day
              </button>
            )}
            {canShare && (
              <button className="dpg-fold-btn" onClick={shareDay}>
                Share this day
              </button>
            )}
          </div>
        )}

        {/* ===== your plan: the three daypart slots, or the calm rest card ===== */}
        {rest ? (
          <div className="dpg-rest">
            {/* WS3 §9: the rest crescent joins the engineered family (calendar's
                CSS crescent is the same mark) — was the 🌙 text emoji */}
            <div className="dpg-rest-title"><Icon.moon className="meta-ic" aria-hidden /> Quiet day</div>
            <div className="dpg-rest-sub">Resting is a plan too. Nothing to do here.</div>
            <button className="dpg-rest-undo" onClick={() => setPlans(withRest(plans, ts, false))}>
              Plan this day instead
            </button>
          </div>
        ) : (
          <div className="dpg-slots">{PARTS.map(renderSlot)}</div>
        )}

        {/* ===== Plan Phase 1: "Suggestions for you" — the day's events, reordered
            by taste AND the day's real weather (count-preserving; never hides). The
            subline claims ONLY the signals that actually ordered the list, and each
            row carries an honest weather/taste reason (whyFits). ===== */}
        <h3 className="day-header dpg-sec">Suggestions for you</h3>
        <div className="dpg-sec-sub">{suggSub}</div>
        <div className="dpg-suggs">
          {agenda.length ? (
            agenda.map((e, i) => {
              const why = whyFits(e, { w, nudge: (x) => tasteNudge(x, taste) })
              const timeBadge = e.kind !== 'place' && daypartOf(e) !== 'any' ? timeOf(e.start) : null
              const meta = [e.venue, timeBadge].filter(Boolean).join(' · ') // WS3 §9: pin renders as Icon.pin below, not 📍 in the string
              return (
                <div className="dpg-sugg" key={keyOf(e) + i}>
                  <button className="dpg-sugg-card pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
                    <CardImg e={e} className="dpg-sugg-thumb">
                      {timeBadge && <span className="dpg-thumb-time">{timeBadge}</span>}
                    </CardImg>
                    <span className="dpg-sugg-main">
                      <span className="dpg-sugg-title">{e.title}</span>
                      {meta && <span className="dpg-sugg-meta">{e.venue && <Icon.pin className="meta-ic" aria-hidden />}{meta}</span>}
                      {why && <span className="dpg-sugg-why">{why}</span>}
                    </span>
                  </button>
                  {/* quick-add this suggestion to its natural daypart slot */}
                  <button className="dpg-sugg-add pressable" onClick={() => addToDay(e)} aria-label={`Add ${e.title} to this day`}>
                    +
                  </button>
                </div>
              )
            })
          ) : (
            <div className="empty empty-sm">Nothing listed for this day yet.</div>
          )}
        </div>
      </div>

      {picker && model && (
        <PickerSheet
          part={picker}
          dayLabel={dayLabel}
          model={model}
          noSaves={savedList.length === 0}
          closing={sheetClosing}
          onPick={assign}
          onClose={closeSheet}
        />
      )}
      {/* Plan Phase 2 (flows-1 p4): the planned-item action menu */}
      {menuPart && (
        <div className="dpg-menu-wrap" onClick={dismissMenu}>
          <div className="dpg-menu" role="dialog" aria-modal="true" aria-label="Plan item options" ref={menuRef} tabIndex={-1} onKeyDown={menuTrap} onClick={(ev) => ev.stopPropagation()}>
            {!moveMode ? (
              <>
                <div className="dpg-menu-title">{resolveSlot(entry.slots[menuPart])?.title || DAYPART[menuPart].label}</div>
                <button className="dpg-menu-item" onClick={() => setMoveMode(true)}>
                  Move to a different time
                </button>
                <button className="dpg-menu-item dpg-menu-danger" onClick={() => removeSlot(menuPart)}>
                  Remove from plan
                </button>
              </>
            ) : (
              <>
                <div className="dpg-menu-title">Move to…</div>
                {PARTS.filter((p) => p !== menuPart).map((p) => (
                  <button key={p} className="dpg-menu-item" disabled={!!entry.slots[p]} onClick={() => moveSlot(menuPart, p)}>
                    {DAYPART[p].emoji} {DAYPART[p].label}
                    {entry.slots[p] ? ' · taken' : ''}
                  </button>
                ))}
              </>
            )}
            <button className="dpg-menu-cancel" onClick={dismissMenu}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {toast && <div className="detail-toast wkb-toast">{toast}</div>}
    </div>
  )
}
