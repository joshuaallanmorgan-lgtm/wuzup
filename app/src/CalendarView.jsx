// CalendarView — the personal LOGBOOK (Phase 3.5 W2, CALENDAR_BRIEF Model C
// finally honored: Calendar = DEMAND, cleanly). W2 (Josh, ratified): "get rid
// of the events on there and make that the full Finch thing." So this tab no
// longer browses SUPPLY at all — no per-day event list, no month-grid event
// counts, no city-busyness heat tint, no p90 "hot day" coral ring, no
// "N events on {day}" text. Those all moved OUT; the day screen (DayPage) is
// the one bridge that still shows a day's agenda — opening a day from here
// fills it FROM events/places. This tab answers one question: "what am I doing
// with my days?" — your plans, your rest, your did-days, the morning-after beat.
//
// THE PERSONAL LAYER, top to bottom:
//   · a calm this-month rhythm strip (streak / kept / planned-ahead) — ZERO IS
//     SILENCE (ban §7 #8); the rich ledger (days-out, firsts, the past-days
//     journal) + the morning-after "did you make it?" answer flow live in
//     Profile → My plans (S1-C2/S1-C3 retired both from this glanceable tab);
//   · a month grid that shows ONLY YOUR shape per day — planned (teal
//     underline), rest (crescent), did-day (a calm check stamp derived from
//     been-there 'went' / didDays). A blank day is a quiet page, never shamed;
//   · tapping ANY day (today-or-later) opens the day screen — the bridge to
//     fill it. Past days stay browse-only (their record is the journal).
//   · a quiet caption under the grid reflecting the SELECTED day's personal
//     shape (planned / rest / went / nothing-yet) — a logbook line, NOT an
//     event list. The day screen is where the agenda lives.
//
// W6 (⚑U-WKND): the Weekend pill is RETIRED — planning is per-day (tap a day →
// the day screen); WB stays reachable from Profile. ALL NEW COPY IS DRAFT for
// Charles (inventory in the sprint report).
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDayTs,
  calendarDayAriaLabel,
  dayNumber,
  daysInCityMonth,
  eventLifecycle,
  formatDayTs,
  listboxIndexForKey,
  monthStartTs as cityMonthStartTs,
  weekdayIndex,
} from './lib.js'
import { useNav } from './nav.jsx'
import { usePlanner } from './PlannerProvider.jsx'
import { PLANNER_PARTS as PARTS } from './planner-core.js'
import { useBeenThere } from './saves.js'
import { DAYPART } from './weekend.js'
import { rhythmSummary } from './gamify.js'
import {
  didDays,
  monthReality,
} from './dayplan.js'
import { usePlaces } from './places.js'
import NextDays from './NextDays.jsx'
import './calendar.css'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function CalendarView({ anchors, wx }) {
  const { openDay } = useNav()
  const { status: plannerStatus, activeDays, history, getDay, remove, durability } = usePlanner()
  const plannerReady = plannerStatus === 'durable' || plannerStatus === 'session-only'
  const [selKey, setSelKey] = useState(null) // the TAPPED day (null = none); drives the inline bottom panel
  const [monthOff, setMonthOff] = useState(0)
  // R-C2: month-picker popover state + refs (dropdown focus + focus-return)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerActiveIndex, setPickerActiveIndex] = useState(0)
  const monthBtnRef = useRef(null)
  const pickerRef = useRef(null)
  const pickerWasOpen = useRef(false) // R-C2: drives post-commit focus-return
  // 3.7P-17: the day detail is an INLINE bottom panel (replaces the FB-12 popover)
  // — tapping a day swaps the bottom content in place, never blocking the next tap.

  // FB-11 (3.7P-3): the per-day grid weather emoji was retired — it didn't aid a
  // decision on this surface (the grid answers "what am I doing", not "what's the
  // weather"). Decision-useful weather stays where it helps: the DayPage forecast
  // line, PlaceDetail beach-day fit, and event-day weather in DetailPage.

  // ===== the reactive personal planner — the grid's quiet marks =====
  const plannerDays = useMemo(() => [...history, ...activeDays], [activeDays, history])
  const plannedDays = useMemo(() => {
    const s = new Set()
    for (const day of plannerDays) {
      if (day.state !== 'rest' && PARTS.some((part) => day.slots?.[part])) s.add(day.dayTs)
    }
    return s
  }, [plannerDays])
  const restDays = useMemo(() => {
    const s = new Set()
    for (const day of plannerDays) if (day.state === 'rest') s.add(day.dayTs)
    return s
  }, [plannerDays])

  // DID-DAYS — days you actually went out (been-there 'went', keyed by
  // snapshot.start). This is the logbook's quiet check stamp: a plan that
  // became a thing you did. Derived live from the been-there store so a "went"
  // answered on ANY surface (the recap card here, Profile's prompts) lights the
  // day's check without a remount.
  const been = useBeenThere()
  const dids = useMemo(() => didDays(been), [been])

  // the displayed month window (drives the grid + the month-scoped rhythm stats).
  // S1-C3 retired the "N days out in {month}" stat, so daysOut/daysOutInMonth are
  // gone too — the RICH ledger (days-out, variety firsts, past-days journal) lives
  // in Profile → My plans, unduplicated.
  const monthStartTs = cityMonthStartTs(anchors.todayTs, monthOff)
  const nextMonthStartTs = cityMonthStartTs(anchors.todayTs, monthOff + 1)
  const month = monthStartTs
  const monthName = formatDayTs(month, { month: 'long' })

  // FB-13 (3.7P-3): the calm this-month rhythm strip — a few glanceable FACTS
  // from existing data only. NO streak, NO counting-up juice (that's 3.7P-4); each
  // stat is ZERO-IS-SILENCE, so a new user sees nothing (never "0"). Shares the
  // monthReality derivation with Profile (dayplan.js) so the surfaces can't drift
  // — Calendar shows it as a glanceable stat, Profile as a narrative line.
  const reality = useMemo(() => {
    return monthReality(history, dids, monthStartTs, nextMonthStartTs)
  }, [history, dids, monthStartTs, nextMonthStartTs])
  const plannedAhead = useMemo(
    () => [...plannedDays].filter((ts) => ts >= anchors.todayTs).length,
    [plannedDays, anchors.todayTs]
  )
  // 3.7P-4: the Finch-kind rhythm — current streak of logged days (did OR rest;
  // graced; never a broken flame). Shares gamify.js with Profile so the two can't
  // drift. The streak is the gamification headline; the juice (the increment beat)
  // lands in 3.7P-4b.
  const rhythm = useMemo(() => {
    return rhythmSummary(dids, [...restDays], anchors)
  }, [dids, restDays, anchors])
  // up to four calm facts — your rhythm, what you did, follow-through, what's coming.
  // Each pushed ONLY when it's a real positive record. DRAFT copy (Charles).
  const rhythmStats = []
  // the rhythm leads (a streak of 2+; a 1-day "streak" isn't one — stays silent)
  if (rhythm.current >= 2) rhythmStats.push({ k: 'rhythm', num: String(rhythm.current), lab: 'day rhythm', streak: true })
  // S1-C3: the "N out in {month}" days-out stat is retired from the strip; the
  // rhythm + "kept in {month}" + "planned ahead" stats carry it.
  // plans → reality as a POSITIVE COUNT, never a fraction (review P1): a "1/3" on
  // the most-glanced surface reads as a score/"you only made 1 of 3". Show only
  // the kept count, and SILENT on misses (gate on went, not planned) — the
  // reflective plans-vs-reality lives in Profile's logbook line, not here.
  // R-C1: month-scoped stats name the month ("out in June", "kept in June") so
  // they read distinctly from the global ones ("day rhythm", "planned ahead").
  if (reality.went > 0) rhythmStats.push({ k: 'plans', num: String(reality.went), lab: `kept in ${monthName}` })
  if (plannedAhead > 0) rhythmStats.push({ k: 'ahead', num: String(plannedAhead), lab: 'planned ahead' })

  // S1-C2: the morning-after "did you make it?" recap — BOTH the prompt and the
  // violet "logged ✓" glow (litCard) — was removed from the Calendar. The same
  // answer flow lives in Profile → My plans (markBeen). The glow was only ever
  // triggered by this prompt's answer, so it can't be kept lint-clean once the
  // prompt is gone (it would be unreachable dead code with an unused setter). The
  // morning-after machinery (card/answerCard/markDayConverted) went with it.

  // the selected day's entry — read it so places are folded into the resolver only
  // when a slot actually holds a place key (the lazy gate; an event-only or empty
  // selection pays no ~1.2MB places fetch). Drives the inline day panel.
  const selectedDay = selKey != null ? getDay(selKey) : null
  const hasSelPlaceRef = selectedDay?.slots.some((slot) => slot.ref?.kind === 'place') === true
  usePlaces(hasSelPlaceRef)

  // ===== the month canvas =====
  const monthTitle = formatDayTs(month, { month: 'long', year: 'numeric' })
  // R-C2: the picker offers this month + the next 12 (future-only, matching the
  // prev/next clamp) so a selection can never push monthOff out of grid range.
  const monthOptions = useMemo(() => {
    const out = []
    for (let o = 0; o <= 12; o++) {
      const m = cityMonthStartTs(anchors.todayTs, o)
      out.push({ off: o, label: formatDayTs(m, { month: 'long', year: 'numeric' }) })
    }
    return out
  }, [anchors.todayTs])
  const openMonthPicker = () => {
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    const selectedIndex = monthOptions.findIndex((option) => option.off === monthOff)
    setPickerActiveIndex(Math.max(0, selectedIndex))
    setPickerOpen(true)
  }
  const chooseMonth = (option) => {
    if (!option) return
    setMonthOff(option.off)
    setPickerOpen(false)
  }
  const onMonthPickerKeyDown = (ev) => {
    const nextIndex = listboxIndexForKey(pickerActiveIndex, ev.key, monthOptions.length)
    if (nextIndex != null) {
      ev.preventDefault()
      setPickerActiveIndex(nextIndex)
      return
    }
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      chooseMonth(monthOptions[pickerActiveIndex])
      return
    }
    if (ev.key === 'Escape' || ev.key === 'Tab') {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
      }
      setPickerOpen(false)
    }
  }
  // R-C2: capture-Escape closes the picker before App's global listener (the
  // PickerSheet pattern); focus moves into the list on open. Only setMonthOff is
  // ever called — todayTs/dayPlans untouched.
  useEffect(() => {
    if (!pickerOpen) return
    pickerRef.current?.focus()
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      setPickerOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pickerOpen])
  useEffect(() => {
    if (!pickerOpen) return
    pickerRef.current
      ?.querySelector(`[data-month-index="${pickerActiveIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [pickerActiveIndex, pickerOpen])
  // R-C2 (review P2): focus-return runs in a POST-COMMIT effect, not synchronously
  // in the option onClick — selecting a different month bumps the cal-fade key, so
  // the trigger button REMOUNTS; a sync focus() would hit the old (about-to-unmount)
  // node and drop focus to <body>. By the time this effect runs, monthBtnRef points
  // at the fresh node. Covers every close path (select / Escape / scrim); the
  // wasOpen ref prevents stealing focus on the initial mount.
  useEffect(() => {
    if (pickerOpen) pickerWasOpen.current = true
    else if (pickerWasOpen.current) {
      pickerWasOpen.current = false
      monthBtnRef.current?.focus()
    }
  }, [pickerOpen])
  const firstDow = weekdayIndex(month)
  const daysInMonth = daysInCityMonth(month)
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(addDayTs(month, d - 1))

  // the selected day for the caption — defaults to today (in the current month)
  // or the first day of a navigated month, so the caption always has a subject.
  // A selection is honored ONLY while it's in the DISPLAYED month, so paging
  // away drops it (the caption never describes an off-screen day) — a pure
  // derivation, no setState-in-effect (review LOW).
  const selInView = selKey != null && selKey >= monthStartTs && selKey < nextMonthStartTs
  const sel = selInView ? selKey : monthOff === 0 ? anchors.todayTs : monthStartTs
  const selRest = restDays.has(sel)
  const selWent = dids.has(sel)
  const selPast = sel < anchors.todayTs
  const selTitle = formatDayTs(sel, { weekday: 'long', month: 'long', day: 'numeric' })

  // ===== 3.7P-17: the inline day panel (selected day → bottom panel) =====
  const [planNotice, setPlanNotice] = useState(null)
  const clearSlot = async (dayTs, slot) => {
    if (!plannerReady || dayTs < anchors.todayTs || !slot || selectedDay?.source !== 'active') return
    const result = await remove({ ...slot, dayTs })
    const code = result?.conflict?.reducerCode || result?.code
    if (!result?.changed) {
      setPlanNotice(code === 'planner-rebase-conflict' || code === 'item-conflict'
        ? 'Your plan changed — open the day and try again.'
        : "Couldn't update your plan.")
      return
    }
    setPlanNotice(
      result.durability === 'session-only' || (!result.durability && durability === 'session-only')
        ? "Removed for this visit, but your browser couldn't save it."
        : null
    )
  }
  // the inline panel appears ONLY once a day in the DISPLAYED month is tapped
  // (default = nothing tapped = blank bottom, no "tap to plan" nag).
  const panelOpen = selKey != null && selInView
  const selectedByPart = new Map((selectedDay?.slots || []).map((slot) => [slot.part, slot]))
  const selSlots = selectedDay && panelOpen
    ? PARTS.map((part) => ({ part, slot: selectedByPart.get(part) || null }))
    : []
  const selFilled = selectedDay?.slots.length > 0

  return (
    <div className="cal-wrap">
      <div className="cal-top">
        <div className="cal-top-row">
          {/* Stage R: the screen name (benchmark top). The dynamic month
              ("June 2025") lives in the month nav below (.mon-title) — kept there
              rather than duplicated here. */}
          <h2 className="loc-head-title">Plan</h2>
          {/* W6 (⚑U-WKND): the Weekend pill is RETIRED. Planning happens by
              tapping a day (the month grid / day-rail open the richer day
              screen); a redundant calendar entry to the legacy multi-day
              Weekend Builder was the "stale connection" Josh flagged. WB stays
              reachable from Profile → Your plans. */}
        </div>
        {/* FB-13: the calm this-month rhythm strip (was the single ledger line).
            A few glanceable facts — ZERO IS SILENCE, so it's absent until there's
            something true to show. No streak, no juice (3.7P-4). DRAFT for Charles. */}
        {rhythmStats.length > 0 && (
          <div className="cal-rhythm">
            {rhythmStats.map((s) => (
              <div className={'cal-stat' + (s.streak ? ' cal-stat-streak' : '')} key={s.k}>
                <span className="cal-stat-num">
                  {s.streak && (
                    <span className="cal-stat-flame" aria-hidden>
                      🔥
                    </span>
                  )}
                  {s.num}
                </span>
                <span className="cal-stat-lab">{s.lab}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* S1-C2: the morning-after "did you make it?" recap was removed from the
          Calendar (prompt + violet glow). The answer flow lives in Profile → My
          plans; the Calendar stays a calm glance. */}

      {/* the month canvas — ONLY the personal layer. No event counts, no heat
          tint, no hot ring. Tapping a today-or-later cell opens the day screen
          (the bridge to fill it); past cells stay browse-only (their record is
          the journal). */}
      <div className="cal-fade" key={'month' + monthOff}>
        <div className="mon-head">
          {/* R-C2: the month/year label is a tappable popover trigger now — a
              caret opens a month picker (this month + the next 12); the prev/next
              arrows stay as secondary one-step nudges. The picker only ever calls
              setMonthOff (clamped to [0,12]) — it never touches the day stores. */}
          <div className="mon-pickwrap">
            <button
              ref={monthBtnRef}
              className="mon-pick pressable"
              onClick={openMonthPicker}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-controls={pickerOpen ? 'plan-month-listbox' : undefined}
              aria-label={`Choose month, ${monthTitle}`}
            >
              <h3 className="mon-title">{monthTitle}</h3>
              <span className={'mon-caret' + (pickerOpen ? ' open' : '')} aria-hidden>▾</span>
            </button>
            {pickerOpen && (
              <>
                <button className="mon-picker-scrim" tabIndex={-1} aria-hidden="true" onClick={() => setPickerOpen(false)} />
                <div
                  id="plan-month-listbox"
                  className="mon-picker"
                  role="listbox"
                  aria-label="Choose a month"
                  aria-activedescendant={`plan-month-option-${pickerActiveIndex}`}
                  ref={pickerRef}
                  tabIndex={0}
                  onKeyDown={onMonthPickerKeyDown}
                >
                  {monthOptions.map((m, index) => (
                    <button
                      key={m.off}
                      id={`plan-month-option-${index}`}
                      data-month-index={index}
                      role="option"
                      aria-selected={m.off === monthOff}
                      tabIndex={-1}
                      className={
                        'mon-opt' +
                        (m.off === monthOff ? ' on' : '') +
                        (index === pickerActiveIndex ? ' active' : '')
                      }
                      onPointerEnter={() => setPickerActiveIndex(index)}
                      onClick={() => chooseMonth(m)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* S1-C4: the prev/next ‹ › arrows are removed — month navigation happens
              through the picker dropdown (R-C2). "Today" quick-jumps to the current
              month and selects today; it sits far-right (margin-left:auto). */}
          <button
            className="cal-today"
            onClick={() => {
              setMonthOff(0)
              setSelKey(anchors.todayTs)
              setPlanNotice(null)
            }}
          >
            Today
          </button>
        </div>
        <div className="mgrid" role="group" aria-label={`${monthTitle} plan calendar`}>
          {WEEKDAYS.map((day) => (
            <div className="mdow" key={day}>
              <abbr title={day}>{day[0]}</abbr>
            </div>
          ))}
          {cells.map((ts, i) => {
            if (ts == null) return <div className="mcell-blank" key={'b' + i} aria-hidden="true" />
            const went = dids.has(ts)
            const planned = !went && plannedDays.has(ts) // a did-day's check outranks its plan underline
            const restful = !went && restDays.has(ts) // …and outranks a stale rest mark (no ✓ + crescent on one cell)
            const selected = ts === selKey
            return (
              <button
                key={ts}
                className={
                  'mcell' +
                  (ts === selKey ? ' sel' : '') +
                  (ts === anchors.todayTs ? ' today' : '') +
                  (went ? ' went' : '')
                }
                // 3.7P-17: tapping a day just selects it → the inline bottom panel
                // swaps to that day (no popover, never blocks tapping the next day).
                onClick={() => {
                  setSelKey(ts)
                  setPlanNotice(null)
                }}
                aria-label={calendarDayAriaLabel(ts, {
                  todayTs: anchors.todayTs,
                  selected,
                  planned,
                  quiet: restful,
                  went,
                })}
                aria-current={ts === anchors.todayTs ? 'date' : undefined}
                aria-pressed={selected}
              >
                <span className="mnum">{dayNumber(ts)}</span>
                {/* the ONE quiet personal mark, mutually exclusive by rule:
                    a did-day wears a calm check stamp (a plan that became a
                    thing you did), else a planned day wears a teal underline,
                    else a rest day wears a muted crescent; nothing on a blank
                    day (a quiet page, never shamed). */}
                {went && <span className="mday-went" aria-hidden>✓</span>}
                {planned && <span className="mday-plan" />}
                {restful && <span className="mday-rest" />}
              </button>
            )
          })}
        </div>

        {/* 3.7P-40 (§N screen 8): a clear date-state legend so the grid marks read
            unambiguously (today / planned / rest / went). */}
        <div className="cal-legend" aria-hidden>
          <span className="cal-leg"><span className="cal-leg-dot" />Today</span>
          <span className="cal-leg"><span className="cal-leg-bar" />Planned</span>
          <span className="cal-leg">🌙 Rest</span>
          <span className="cal-leg"><span className="cal-leg-chk">✓</span> Went</span>
        </div>

        {/* 3.7P-17: the INLINE day panel — fills the blank space below the grid
            with the tapped day's shape (slots / rest / a went record) + an open
            action. Appears only once a day is tapped; a blank future day shows
            just the title + "Plan this day" (no "tap to plan" nag), a blank PAST
            day shows nothing. Tapping another day swaps this in place. DRAFT. */}
        {panelOpen && (selFilled || selRest || selWent || !selPast) && (
          <div className="cal-sel">
            <div className="cal-sel-head">
              <h3 className="day-header cal-day">{selTitle}</h3>
              {selWent && (
                <span className="cal-sel-went">
                  <span aria-hidden>✓ </span>You made it out<span aria-hidden> 🎉</span>
                </span>
              )}
            </div>
            {selRest ? (
              <div className="cal-sel-rest"><span aria-hidden>🌙 </span>A quiet day</div>
            ) : (
              selFilled && (
                <div className="cal-sel-slots">
                  {selSlots.map(({ part, slot }) => {
                    const e = slot?.item
                    const when = DAYPART[part].label
                    const title = e?.title || e?.name || 'Saved plan'
                    const lifecycleLabel = slot?.resolution === 'missing'
                      ? 'No longer listed · saved copy'
                      : slot?.resolution === 'ambiguous'
                        ? 'Needs review · saved copy'
                        : slot?.resolution === 'retained'
                          ? 'Saved copy'
                          : e && e.kind !== 'place' && e._actionable !== true
                            ? eventLifecycle(e).label
                            : null
                    return (
                      <div className={'cal-sel-slot' + (slot ? ' filled' : '')} key={part} aria-label={`${when}: ${slot ? title : 'open'}`}>
                        <span className="cal-sel-when" aria-hidden>{DAYPART[part].emoji} {when}</span>
                        {slot ? (
                          <>
                            <span className="cal-sel-what" aria-hidden>{title}</span>
                            {lifecycleLabel && <span className="cal-sel-status">{lifecycleLabel}</span>}
                            {plannerReady && !selPast && selectedDay?.source === 'active' && (
                              <button className="cal-sel-x pressable" onClick={() => clearSlot(sel, slot)} aria-label={`Clear ${title} from ${when.toLowerCase()}`}>✕</button>
                            )}
                          </>
                        ) : (
                          <span className="cal-sel-open" aria-hidden>Open</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}
            {planNotice && <div className="cal-sel-status" role="status" aria-live="polite">{planNotice}</div>}
            {!selPast && (selFilled || selRest || plannerReady) && (
              <button className="cal-sel-full pressable" onClick={() => openDay(sel)}>
                {selFilled || selRest ? 'Open full day' : 'Plan this day'} <span aria-hidden>→</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3.7P-40 (§N screen 8): "Upcoming" — the day-first planning-card stack
          (today + the next two days: real forecast + plan-state + a planner CTA).
          The same NextDays component the Home leads with; tap → that DayPage. */}
      <div className="cal-upcoming">
        <h3 className="cal-up-title">Upcoming</h3>
        <NextDays anchors={anchors} wx={wx} />
      </div>
    </div>
  )
}
