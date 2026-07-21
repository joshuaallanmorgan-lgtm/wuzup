// DayPage — the day screen (Sprint U-a, CALENDAR_BRIEF Model C: "opening a
// day = an exploring/filling screen"). Mounted by App as subpage
// { type: 'day', ts } and KEYED on ts (the WB midnight-rollover trick from
// the risk register: a new day or a new target = a clean remount).
//
// Top to bottom: date header → weather line (when the 16-day forecast covers
// the day; an honest "too far out" caveat past coverage, ⚑U-HZN default) →
// the three plan slots (☀️ Morning / ☀️ Afternoon / 🌙 Night, same pickerModel +
// PickerSheet the Weekend Builder uses, backed by the atomic V2 planner's
// ternary dayparts) → the quiet rest control → the day's agenda.
// (⚑PLAN-P0 note: this is the functional 3-slot data layer; the pixel-match
// "Plan your day" layout — expanded weather, tappable day-selector → calendar
// picker, "Suggestions for you" formatting — lands in Plan Phase 1.)
//
// REST RULE (U-a decision, documented for the report): rest and slots are
// MUTUALLY EXCLUSIVE. The "Mark it a quiet day 🌙" toggle is only OFFERED
// while all slots are empty; marking rest replaces the slot pickers with a
// calm filled card ("Quiet day") whose single quiet affordance un-rests the
// day and brings the pickers back. The planner reducer enforces the same rule,
// so no caller can create the contradictory state. Rest renders as a
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
import { CITY, eventLifecycle, formatDayTs, Icon, keyOf, timeOf } from './lib.js'
import { useNav } from './nav.jsx'
import { usePlanner } from './PlannerProvider.jsx'
import { PLANNER_PARTS as PARTS } from './planner-core.js'
import { CardImg, SponsoredTag, featuredChips } from './cards.jsx'
import { capturePersonalSignal } from './personal-signals.js'
import { shelfItems, useSaves } from './saves.js'
import { useTaste } from './taste.js'
import { usePlaces } from './places.js'
import { useLocationPermission } from './LocationProvider.jsx'
import { daypartOf, pickerModel, wxMood, DAYPART } from './weekend.js'
import { eventsIcs, shareDayText } from './share.js'
import { dateKey, CONDITION } from './weather.js'
import PickerSheet from './PickerSheet.jsx'
import { rankRuntimeItems, runtimeRankingId } from './relevance.js'
import { buildPlanSuggestionPages } from './plan-suggestions.js'
import { createPlanCapsule, planCapsuleFragment } from './plan-capsule.js'
import { dayIdAt } from '../../shared/city-time.mjs'
import './day.css'

const wdLong = (ts) => formatDayTs(ts, { weekday: 'long' })

export default function DayPage({ ts, events, availableEvents = events, anchors, wx }) {
  // openCalendarPicker is the Plan Phase 2 date-picker opener; in Phase 1 the
  // tappable day-selector wires to it (guarded `?.` — a no-op until Phase 2 adds
  // it to nav). openDay still drives keyed remounts from the picker once it lands.
  const {
    openDetail: onSelect,
    closePage: onClose,
    openAdd,
    openCalendarPicker,
    durableHrefForSharedPlan,
  } = useNav()
  const taste = useTaste()
  const location = useLocationPermission()
  const {
    status: plannerStatus,
    durability,
    getDay,
    resolve,
    isPlanned,
    activeDays,
    document: plannerDocument,
    add,
    move,
    remove,
    setRest,
  } = usePlanner()

  // PlannerProvider owns migration, rollover, persistence, and subscriptions.
  // This screen is a pure reactive reader plus exact async action client.
  const day = getDay(ts)
  const slotsByPart = new Map(day.slots.map((slot) => [slot.part, slot]))
  const rest = day.state === 'rest'
  const historical = day.source === 'history'
  const plannerReady = plannerStatus === 'durable' || plannerStatus === 'session-only'
  const plannerPending = plannerStatus === 'idle' || plannerStatus === 'initializing'
  const canEdit = plannerReady && !historical && ts >= anchors.todayTs
  const emptySlotLabel = historical || ts < anchors.todayTs
    ? 'Past day'
    : plannerPending
      ? 'Loading your plan'
      : 'Planner unavailable'
  const hasPlaceSlot = day.slots.some((slot) => slot.ref?.kind === 'place')
  usePlaces(hasPlaceSlot)
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
  const monthDay = formatDayTs(ts, { month: 'short', day: 'numeric' })

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
  // The shared rank remains the lossless browse order. Sprint 9 deals only its
  // credible/actionable rows into complementary pages of 3-6; every row remains
  // reachable under the neutral "Browse every listing" disclosure below.
  const wxBonus = useCallback(
    (e) => {
      if (wxMoodToday === 'clear' && e.category === 'outdoors') return 6
      if (wxMoodToday === 'rainy' && e.kind !== 'place' && e.category !== 'outdoors') return 6
      return 0
    },
    [wxMoodToday]
  )
  const agendaRanking = useMemo(() => {
    const list = availableEvents.filter(
      (e) =>
        e._day != null &&
        (e._endDay ?? e._day) >= anchors.todayTs &&
        Math.max(e._day, anchors.todayTs) === ts &&
        !isPlanned(e)
    )
    const context = {
      itemScores: Object.fromEntries(list.map((event) => [runtimeRankingId(event), wxBonus(event)])),
    }
    return rankRuntimeItems(list, {
      kind: 'events',
      nowMs: anchors.nowMs,
      city: CITY,
      taste,
      context,
      diversityPolicy: {
        prefix: Math.min(12, list.length || 1),
        sourceMax: 2,
        categoryMax: 3,
        venueMax: 2,
        canonicalMax: 1,
        seriesMax: 1,
      },
    })
  }, [availableEvents, anchors, ts, taste, wxBonus, isPlanned])
  const agenda = agendaRanking.ordered
  const credibleAgenda = useMemo(
    () => agendaRanking.scored.filter(row => row.leadEligible).map(row => row.item),
    [agendaRanking]
  )
  const preferenceScores = useMemo(
    () => Object.fromEntries(agendaRanking.scored.map(row => [row.id, row.preferenceScore])),
    [agendaRanking]
  )
  const plannedEvidence = activeDays.flatMap(activeDay => PARTS.map(part => {
    const ref = activeDay.slots?.[part]
    if (!ref) return null
    return resolve(ref)?.item || ref
  })).filter(Boolean)
  const trustedWeather = w && (wxMoodToday === 'clear' || wxMoodToday === 'rainy')
    ? {
        state: 'available',
        mood: wxMoodToday,
        fresh: true,
        receipt: 'fresh-app-weather',
      }
    : null
  const trustedLocation = location.status === 'granted'
    && location.permission === 'granted'
    && location.enabled === true
    && location.inMarket === true
    && location.usableCoords
    ? {
        state: 'available',
        permission: 'granted',
        enabled: true,
        inMarket: true,
        receipt: 'provider-granted-in-market',
        lat: location.usableCoords.lat,
        lng: location.usableCoords.lng,
        radiusMiles: 12,
      }
    : null
  const suggestionContext = {
    ...(trustedWeather ? { weather: trustedWeather } : {}),
    ...(trustedLocation ? { location: trustedLocation } : {}),
    preferenceScores,
  }
  // A value key resets the effective run synchronously (without a state-setting
  // effect) when corpus/rank/taste, any active plan, fresh weather, or verified
  // location evidence changes.
  const suggestionKey = [
    ts,
    plannerDocument.rev,
    [w?.emoji, w?.hi, w?.lo, w?.rain].join(':'),
    [
      location.status,
      location.permission,
      location.enabled,
      location.inMarket,
      location.usableCoords?.lat,
      location.usableCoords?.lng,
    ].join(':'),
    agendaRanking.scored.map(row => [
      row.id,
      row.totalScore,
      row.leadEligible,
      row.item?.start,
      row.item?.category,
      row.item?.canonicalId || row.item?.canonicalKey,
      row.item?.seriesId || row.item?.seriesKey,
    ].join(':')).join('\u001f'),
  ].join('\u001e')
  const [suggestionRun, setSuggestionRun] = useState(() => ({ key: suggestionKey, offered: [] }))
  const offeredSuggestions = suggestionRun.key === suggestionKey ? suggestionRun.offered : []
  const suggestionDeal = buildPlanSuggestionPages({
    candidates: credibleAgenda,
    planned: plannedEvidence,
    offered: offeredSuggestions,
    context: suggestionContext,
  })
  const suggestionRecords = suggestionDeal.suggestions
  const suggestionRemaining = suggestionDeal.remainder.length
  const suggestionTotal = offeredSuggestions.length + suggestionRecords.length + suggestionRemaining
  const suggestionShownThrough = offeredSuggestions.length + suggestionRecords.length
  const suggSub = suggestionTotal > 0
    ? `${suggestionShownThrough} of ${suggestionTotal} complementary options`
    : 'No high-confidence options for this day yet'
  const showMoreSuggestions = () => {
    if (suggestionRemaining === 0 || suggestionRecords.length === 0) return
    setSuggestionRun({
      key: suggestionKey,
      offered: [...offeredSuggestions, ...suggestionRecords.map(record => record.item)],
    })
  }

  // ===== slots: the picker's resolution pool (same wiring as WB) =====
  const upcoming = useMemo(
    () => availableEvents.filter((e) =>
      e._day != null && (e._endDay ?? e._day) >= anchors.todayTs && !isPlanned(e)
    ),
    [availableEvents, anchors, isPlanned]
  )
  const { list: savedList } = useSaves({ events, anchors })
  const savedEvents = useMemo(
    () => shelfItems(savedList, events, anchors)
      .filter((x) => !x.unavailable && (x.e.kind === 'place' || x.e._actionable === true) && !isPlanned(x.e))
      .map((x) => x.e),
    [savedList, events, anchors, isPlanned]
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

  const model = (() => {
    if (!picker) return null
    const liveSlots = Object.fromEntries(PARTS.map((part) => [
      part,
      slotsByPart.get(part)?.ref?.primary || null,
    ]))
    const m = pickerModel({
      ts,
      part: picker,
      upcoming,
      saved: savedEvents,
      plan: { slots: liveSlots },
      planned: plannedEvidence,
      ranking: {
        nowMs: anchors.nowMs,
        city: CITY,
        taste,
        context: {
          itemScores: Object.fromEntries(upcoming.map((event) => [runtimeRankingId(event), wxBonus(event)])),
        },
        suggestionContext,
        suggestionResetKey: suggestionKey,
      },
    })
    return m
  })()

  const assign = async (e) => {
    if (!picker || !canEdit) return
    const part = picker
    const result = await add(e, { dayTs: ts, part })
    const code = result?.conflict?.reducerCode || result?.code
    if (!result?.changed) {
      flash(
        code === 'duplicate'
          ? 'Already in your plan'
          : code === 'slot-occupied'
            ? 'That slot is taken'
            : code === 'rest-conflict'
              ? "That's a quiet day — clear the rest mark first"
              : code === 'planner-rebase-conflict'
                ? 'Your plan changed — check this day and try again'
                : "Couldn't add this to your plan"
      )
      return
    }
    capturePersonalSignal('plan', e, {
      source: 'planner',
      result,
      context: { daypart: part },
    })
    setJustFilled(part)
    clearTimeout(fillTRef.current)
    fillTRef.current = setTimeout(() => setJustFilled(null), 460)
    flash(
      result.durability === 'session-only' || (!result.durability && durability === 'session-only')
        ? "Added for this visit, but your browser couldn't save it"
        : `Added to ${DAYPART[part].label.toLowerCase()} ✓`
    )
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
  const shareableEntries = day.slots
      .filter((slot) => slot.resolution === 'live')
      .map((slot) => ({ part: slot.part, e: slot.item, ref: slot.ref }))
      .filter(({ e }) => e?.kind === 'place' || (e && eventLifecycle(e).actionable))
  const canShare = shareableEntries.length > 0
  let sharedPlanUrl = null
  if (canShare) {
    try {
      const capsule = createPlanCapsule({
        cityId: CITY.id,
        timeZone: CITY.tz,
        day: dayIdAt(ts, CITY.tz),
        slots: shareableEntries.map(({ part, e, ref }) => ({
          part,
          kind: ref.kind,
          primary: ref.primary,
          title: e.title || e.name,
          time: e.kind === 'place' ? null : timeOf(e.start) || null,
          venue: e.venue || null,
        })),
      })
      sharedPlanUrl = durableHrefForSharedPlan(planCapsuleFragment(capsule))
    } catch {
      sharedPlanUrl = null
    }
  }

  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1600)
  }
  // Plan Phase 2 (flows-1 p4): move a planned item to another daypart (carry the
  // key over, clear the old slot) — never clobbers a filled target. Remove drops
  // the slot. Both use the atomic planner's expected-primary conflict checks.
  const moveSlot = async (from, to) => {
    const slot = slotsByPart.get(from)
    if (!canEdit || !slot || slotsByPart.has(to)) return
    const result = await move({ ...slot, dayTs: ts }, { dayTs: ts, part: to })
    const code = result?.conflict?.reducerCode || result?.code
    if (!result?.changed) {
      flash(code === 'planner-rebase-conflict' || code === 'item-conflict'
        ? 'Your plan changed — check this day and try again'
        : code === 'slot-occupied'
          ? 'That time is already planned'
          : "Couldn't move this plan")
      return
    }
    setJustFilled(to)
    clearTimeout(fillTRef.current)
    fillTRef.current = setTimeout(() => setJustFilled(null), 460)
    closeMenu()
    flash(
      result.durability === 'session-only' || (!result.durability && durability === 'session-only')
        ? "Moved for this visit, but your browser couldn't save it"
        : `Moved to ${DAYPART[to].label.toLowerCase()} ✓`
    )
  }
  const removeSlot = async (part) => {
    const slot = slotsByPart.get(part)
    if (!canEdit || !slot) return
    const result = await remove({ ...slot, dayTs: ts })
    const code = result?.conflict?.reducerCode || result?.code
    if (!result?.changed) {
      flash(code === 'planner-rebase-conflict' || code === 'item-conflict'
        ? 'Your plan changed — check this day and try again'
        : "Couldn't remove this plan")
      return
    }
    closeMenu()
    flash(
      result.durability === 'session-only' || (!result.durability && durability === 'session-only')
        ? "Removed for this visit, but your browser couldn't save it"
        : 'Removed from your plan'
    )
  }
  const changeRest = async (nextRest) => {
    if (!canEdit) return
    const result = await setRest(ts, nextRest)
    const code = result?.conflict?.reducerCode || result?.code
    if (!result?.changed) {
      flash(code === 'slot-conflict'
        ? 'Clear your plans before marking a quiet day'
        : code === 'planner-rebase-conflict'
          ? 'Your plan changed — check this day and try again'
          : "Couldn't update this day")
      return
    }
    flash(
      result.durability === 'session-only' || (!result.durability && durability === 'session-only')
        ? "Updated for this visit, but your browser couldn't save it"
        : nextRest
          ? 'Marked as a quiet day'
          : 'Ready to plan this day'
    )
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
    const text = shareDayText(ts, shareableEntries)
    if (!text) return
    const portableText = sharedPlanUrl ? `${text}\n${sharedPlanUrl}` : text
    // the .ics: one VEVENT per slotted entry. A PLACE has no date, so it
    // produces no VEVENT (share.js vevent guards it) — a place-only day would
    // otherwise build an EVENTLESS calendar and still flash "calendar saved",
    // which is a small lie. Only build the file when at least one slotted entry
    // is actually dated (an event). navigator.share carries it where supported;
    // the human text (which DOES include the place) is the universal payload.
    const datedEntries = shareableEntries.filter((x) => x.e && x.e.start)
    let file = null
    if (datedEntries.length) {
      try {
        file = new File([eventsIcs(datedEntries.map((x) => x.e))], 'my-plan.ics', { type: 'text/calendar' })
      } catch {
        /* File constructor unavailable (older browsers) — text-only share */
      }
    }
    if (navigator.share) {
      const payload = { title: 'My plan', text: portableText, ...(sharedPlanUrl ? { url: sharedPlanUrl } : {}) }
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
        await navigator.clipboard.writeText(portableText)
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
    const slot = slotsByPart.get(part)
    const e = slot?.item
    const title = e?.title || e?.name || 'Saved plan'
    const openable = slot?.resolution === 'live' && Boolean(e)
    const partLow = DAYPART[part].label.toLowerCase()
    const art = part === 'afternoon' ? 'an' : 'a' // "an afternoon" (vowel sound)
    const chips = e ? featuredChips(e) : []
    const lifecycle = e && slot?.resolution === 'live' ? eventLifecycle(e) : null
    const resolutionLabel = slot?.resolution === 'missing'
      ? 'No longer in the live listings · saved copy'
      : slot?.resolution === 'ambiguous'
        ? 'Needs review · saved copy'
        : slot?.resolution === 'retained'
          ? 'Saved copy'
          : null
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
        {slot ? (
          <div className={'dpg-filled' + (justFilled === part ? ' pop' : '')}>
            <button
              className="dpg-card pressable"
              disabled={!openable}
              onClick={(ev) => openable && onSelect(e, ev.currentTarget)}
            >
              <CardImg e={e} className="dpg-thumb">
                {timeBadge && <span className="dpg-thumb-time">{timeBadge}</span>}
              </CardImg>
              <span className="dpg-card-main">
                <span className="dpg-card-title">{title}</span>
                {e?.venue && <span className="dpg-card-venue"><Icon.pin className="meta-ic" aria-hidden /> {e.venue}</span>}
                {resolutionLabel ? (
                  <span className="dpg-card-meta dpg-card-status">{resolutionLabel}</span>
                ) : lifecycle && !lifecycle.actionable ? (
                  <span className="dpg-card-meta dpg-card-status">{lifecycle.label}</span>
                ) : whenLine ? <span className="dpg-card-meta">{whenLine}</span> : null}
                {chips.length > 0 && (
                  <span className="dpg-card-chips">
                    {chips.map((c, i) => (
                      <span className="dpg-chip" key={i}>{c}</span>
                    ))}
                  </span>
                )}
                {e && <SponsoredTag e={e} />}
              </span>
            </button>
            {/* Plan Phase 2 (flows-1 p4): the ⋯ opens the move/remove menu */}
            {canEdit && (
              <button className="dpg-more" onClick={(ev) => openMenu(part, ev.currentTarget)} aria-haspopup="dialog" aria-expanded={menuPart === part} aria-label={`Options for ${title}`}>
                {/* WS3 §9: engineered kebab, not the ⋯ text glyph */}
                <Icon.dots aria-hidden />
              </button>
            )}
          </div>
        ) : canEdit ? (
          <button className="dpg-empty pressable" onClick={() => openSheet(part)} aria-label={`Add ${art} ${partLow} plan`}>
            <span className="dpg-empty-main">
              <span className="dpg-empty-txt">Add {art} {partLow} plan</span>
              <span className="dpg-empty-sub">Tap to get started</span>
            </span>
            <span className="dpg-empty-plus" aria-hidden>+</span>
          </button>
        ) : (
          <div className="dpg-empty" aria-label={`${DAYPART[part].label}: open`}>
            <span className="dpg-empty-main">
              <span className="dpg-empty-txt">Open</span>
              <span className="dpg-empty-sub">{emptySlotLabel}</span>
            </span>
          </div>
        )}
      </div>
    )
  }

  const slotsEmpty = day.slots.length === 0
  const suggestionCard = (e, why, keyPrefix, index) => {
    const timeBadge = e.kind !== 'place' && daypartOf(e) !== 'any' ? timeOf(e.start) : null
    const meta = [e.venue, timeBadge].filter(Boolean).join(' · ')
    return (
      <div className="dpg-sugg" key={`${keyPrefix}:${keyOf(e)}:${index}`}>
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
      </div>
    )
  }

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
        {!rest && (canEdit || canShare) && (
          <div className="dpg-top-actions">
            {canEdit && <button className="dpg-fold-btn" onClick={() => openAdd(ts)}>+ Add your own</button>}
            {canEdit && slotsEmpty && (
              <button className="dpg-fold-btn" onClick={() => changeRest(true)}>
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
            {canEdit && (
              <button className="dpg-rest-undo" onClick={() => changeRest(false)}>
                Plan this day instead
              </button>
            )}
          </div>
        ) : (
          <div className="dpg-slots">{PARTS.map(renderSlot)}</div>
        )}

        {/* Sprint 9: a bounded, complementary lead. Every visible reason comes
            from the same evidence receipt that influenced the deal. */}
        <h3 className="day-header dpg-sec">Suggestions for you</h3>
        <div className="dpg-sec-sub">{suggSub}</div>
        <div className="dpg-suggs">
          {suggestionRecords.length ? (
            suggestionRecords.map((record, index) => suggestionCard(
              record.item,
              record.primaryReason?.label || null,
              'suggestion',
              index,
            ))
          ) : (
            <div className="empty empty-sm">
              {suggestionDeal.state === 'neutral'
                ? 'Suggestions are unavailable right now. Browse every listing below.'
                : agenda.length
                  ? 'No high-confidence suggestions yet. Browse every listing below.'
                  : 'Nothing listed for this day yet.'}
            </div>
          )}
        </div>
        {suggestionRemaining > 0 && (
          <button className="dpg-more-options pressable" onClick={showMoreSuggestions}>
            More options · {suggestionRemaining} left
          </button>
        )}
        {offeredSuggestions.length > 0 && suggestionRemaining === 0 && (
          <div className="dpg-options-done" role="status">All suggestions shown</div>
        )}
        {agenda.length > 0 && (
          <details className="dpg-browse-all">
            <summary>Browse every listing · {agenda.length}</summary>
            <div className="dpg-suggs dpg-suggs-browse">
              {agenda.map((event, index) => suggestionCard(event, null, 'browse', index))}
            </div>
          </details>
        )}
      </div>

      {canEdit && picker && model && (
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
      {canEdit && menuPart && (
        <div className="dpg-menu-wrap" onClick={dismissMenu}>
          <div className="dpg-menu" role="dialog" aria-modal="true" aria-label="Plan item options" ref={menuRef} tabIndex={-1} onKeyDown={menuTrap} onClick={(ev) => ev.stopPropagation()}>
            {!moveMode ? (
              <>
                <div className="dpg-menu-title">{slotsByPart.get(menuPart)?.item?.title || slotsByPart.get(menuPart)?.item?.name || DAYPART[menuPart].label}</div>
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
                  <button key={p} className="dpg-menu-item" disabled={slotsByPart.has(p)} onClick={() => moveSlot(menuPart, p)}>
                    {DAYPART[p].emoji} {DAYPART[p].label}
                    {slotsByPart.has(p) ? ' · taken' : ''}
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
      {toast && <div className="detail-toast wkb-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  )
}
