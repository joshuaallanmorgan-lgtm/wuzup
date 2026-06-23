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
import { keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { useBeenThere } from './saves.js'
import { fitsDay, DAYPART } from './weekend.js'
import { restDayList, rhythmSummary } from './gamify.js'
import {
  dayEntryFor,
  didDays,
  emptyDay,
  hasContent,
  loadDayHistory,
  loadDayPlans,
  monthReality,
  PARTS,
  saveDayPlans,
  withClearedSlot,
} from './dayplan.js'
import { usePlaces, isPlaceKey } from './places.js'
import NextDays from './NextDays.jsx'
import './calendar.css'

export default function CalendarView({ events, anchors, wx }) {
  const { openDay, page } = useNav()
  const [selKey, setSelKey] = useState(null) // the TAPPED day (null = none); drives the inline bottom panel
  const [monthOff, setMonthOff] = useState(0)
  // R-C2: month-picker popover state + refs (dropdown focus + focus-return)
  const [pickerOpen, setPickerOpen] = useState(false)
  const monthBtnRef = useRef(null)
  const pickerRef = useRef(null)
  const pickerWasOpen = useRef(false) // R-C2: drives post-commit focus-return
  // 3.7P-17: the day detail is an INLINE bottom panel (replaces the FB-12 popover)
  // — tapping a day swaps the bottom content in place, never blocking the next
  // tap. planTick re-reads the (non-reactive) plan store after an inline remove.
  const [planTick, setPlanTick] = useState(0)

  // FB-11 (3.7P-3): the per-day grid weather emoji was retired — it didn't aid a
  // decision on this surface (the grid answers "what am I doing", not "what's the
  // weather"). Decision-useful weather stays where it helps: the DayPage forecast
  // line, PlaceDetail beach-day fit, and event-day weather in DetailPage.

  // ===== the personal day-plan store — the grid's quiet marks =====
  // localStorage isn't reactive — plans only change inside the day/WB subpages,
  // so re-reading on every subpage open/close edge (`page` flips null ↔ object)
  // keeps the marks honest; the read is one small JSON parse.
  const dayPlans = useMemo(() => {
    void page // re-read trigger (see above)
    void planTick // …and after an inline remove from the peek
    return loadDayPlans(anchors)
  }, [anchors, page, planTick])
  const plannedDays = useMemo(() => {
    const s = new Set()
    for (const [k, e] of Object.entries(dayPlans)) if (hasContent(e) && e.state !== 'rest') s.add(Number(k))
    return s
  }, [dayPlans])
  const restDays = useMemo(() => {
    const s = new Set()
    for (const [k, e] of Object.entries(dayPlans)) if (e.state === 'rest') s.add(Number(k))
    return s
  }, [dayPlans])

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
  const base = new Date(anchors.todayTs)
  const month = new Date(base.getFullYear(), base.getMonth() + monthOff, 1)
  const monthStartTs = month.getTime()
  const nextMonthStartTs = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime()
  const monthName = month.toLocaleDateString('en-US', { month: 'long' })

  // FB-13 (3.7P-3): the calm this-month rhythm strip — a few glanceable FACTS
  // from existing data only. NO streak, NO counting-up juice (that's 3.7P-4); each
  // stat is ZERO-IS-SILENCE, so a new user sees nothing (never "0"). Shares the
  // monthReality derivation with Profile (dayplan.js) so the surfaces can't drift
  // — Calendar shows it as a glanceable stat, Profile as a narrative line.
  const reality = useMemo(() => {
    void page // history is non-reactive — re-read on subpage edges (like the card)
    return monthReality(loadDayHistory(), dids, monthStartTs, nextMonthStartTs)
  }, [page, dids, monthStartTs, nextMonthStartTs])
  const plannedAhead = useMemo(
    () => [...plannedDays].filter((ts) => ts >= anchors.todayTs).length,
    [plannedDays, anchors.todayTs]
  )
  // 3.7P-4: the Finch-kind rhythm — current streak of logged days (did OR rest;
  // graced; never a broken flame). Shares gamify.js with Profile so the two can't
  // drift. The streak is the gamification headline; the juice (the increment beat)
  // lands in 3.7P-4b.
  const rhythm = useMemo(() => {
    void page // history is non-reactive — re-read on subpage edges (like the card/reality)
    return rhythmSummary(dids, restDayList(dayPlans, loadDayHistory()), anchors)
  }, [page, dids, dayPlans, anchors])
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
  const selEntry = selKey != null ? (dayEntryFor(dayPlans[String(selKey)]) ?? emptyDay()) : null
  const hasSelPlaceKey = selEntry ? PARTS.some((p) => isPlaceKey(selEntry.slots[p])) : false
  const { places: placeList } = usePlaces(hasSelPlaceKey)
  // key → live event/place, used by the inline day-peek's slot resolver.
  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of events) m.set(keyOf(e), e)
    if (Array.isArray(placeList)) for (const p of placeList) m.set(p.key, p)
    return m
  }, [events, placeList])

  // ===== the month canvas =====
  const monthTitle = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  // R-C2: the picker offers this month + the next 12 (future-only, matching the
  // prev/next clamp) so a selection can never push monthOff out of grid range.
  const monthOptions = useMemo(() => {
    const b = new Date(anchors.todayTs)
    const out = []
    for (let o = 0; o <= 12; o++) {
      const m = new Date(b.getFullYear(), b.getMonth() + o, 1)
      out.push({ off: o, label: m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) })
    }
    return out
  }, [anchors.todayTs])
  // R-C2: capture-Escape closes the picker before App's global listener (the
  // PickerSheet pattern); focus moves into the list on open. Only setMonthOff is
  // ever called — todayTs/dayPlans untouched.
  useEffect(() => {
    if (!pickerOpen) return
    pickerRef.current?.focus()
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      setPickerOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pickerOpen])
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
  const firstDow = month.getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d).getTime())

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
  const selTitle = new Date(sel).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // ===== 3.7P-17: the inline day panel (selected day → bottom panel) =====
  // resolve a slot key → live event/place (a place fits any day; a date-gated
  // event that no longer falls on this day reads as "open", never a stale key).
  const resolveSelSlot = (key, dayTs) => {
    const e = key ? byKey.get(key) : null
    if (!e) return null
    if (e.kind === 'place') return e
    return fitsDay(e, dayTs) ? e : null
  }
  // clear a single filled slot from the inline panel. withClearedSlot drops it
  // (deleting the day if it empties), persists, and planTick re-reads so the grid
  // marks AND the panel reflect it.
  const clearSlot = (dayTs, part) => {
    saveDayPlans(withClearedSlot(dayPlans, dayTs, part))
    setPlanTick((t) => t + 1)
  }
  // the inline panel appears ONLY once a day in the DISPLAYED month is tapped
  // (default = nothing tapped = blank bottom, no "tap to plan" nag).
  const panelOpen = selKey != null && selInView
  const selSlots = selEntry && panelOpen ? PARTS.map((part) => ({ part, e: resolveSelSlot(selEntry.slots[part], sel) })) : []
  const selFilled = selSlots.some((s) => s.e)

  return (
    <div className="cal-wrap">
      <div className="cal-top">
        <div className="cal-top-row">
          {/* Stage R: the screen name (benchmark top). The dynamic month
              ("June 2025") lives in the month nav below (.mon-title) — kept there
              rather than duplicated here. */}
          <h2 className="cal-title">Calendar</h2>
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
              onClick={() => setPickerOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
            >
              <h3 className="mon-title">{monthTitle}</h3>
              <span className={'mon-caret' + (pickerOpen ? ' open' : '')} aria-hidden>▾</span>
            </button>
            {pickerOpen && (
              <>
                <button className="mon-picker-scrim" aria-label="Close month picker" onClick={() => setPickerOpen(false)} />
                <div className="mon-picker" role="listbox" aria-label="Choose a month" ref={pickerRef} tabIndex={-1}>
                  {monthOptions.map((m) => (
                    <button
                      key={m.off}
                      role="option"
                      aria-selected={m.off === monthOff}
                      className={'mon-opt' + (m.off === monthOff ? ' on' : '')}
                      onClick={() => {
                        setMonthOff(m.off)
                        setPickerOpen(false)
                      }}
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
            }}
          >
            Today
          </button>
        </div>
        <div className="mgrid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div className="mdow" key={d + i}>
              {d}
            </div>
          ))}
          {cells.map((ts, i) => {
            if (ts == null) return <div className="mcell-blank" key={'b' + i} />
            const went = dids.has(ts)
            const planned = !went && plannedDays.has(ts) // a did-day's check outranks its plan underline
            const restful = !went && restDays.has(ts) // …and outranks a stale rest mark (no ✓ + crescent on one cell)
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
                onClick={() => setSelKey(ts)}
              >
                <span className="mnum">{new Date(ts).getDate()}</span>
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
                  {selSlots.map(({ part, e }) => {
                    const when = DAYPART[part].label
                    return (
                      <div className={'cal-sel-slot' + (e ? ' filled' : '')} key={part} aria-label={`${when}: ${e ? e.title || e.name : 'open'}`}>
                        <span className="cal-sel-when" aria-hidden>{DAYPART[part].emoji} {when}</span>
                        {e ? (
                          <>
                            <span className="cal-sel-what" aria-hidden>{e.title || e.name}</span>
                            <button className="cal-sel-x pressable" onClick={() => clearSlot(sel, part)} aria-label={`Clear ${e.title || e.name} from ${when.toLowerCase()}`}>✕</button>
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
            {!selPast && (
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
