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
//   · the morning-after two-beat conversion card (cal-recap, U-d) — unchanged;
//   · a light gentle-ledger line ("N days out in {month}") — a calm RECORD,
//     ZERO IS SILENCE (ban §7 #8); the rich firsts + past-days journal stay in
//     Profile (no duplication — see the report's "kept" note);
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
import { markBeen, snapshotFor, useBeenThere } from './saves.js'
import { fitsDay } from './weekend.js'
import { restDayList, rhythmSummary } from './gamify.js'
import {
  dayEntryFor,
  daysOutInMonth,
  didDays,
  emptyDay,
  hasContent,
  loadConverted,
  loadDayHistory,
  loadDayPlans,
  markDayConverted,
  monthReality,
  morningAfterCandidates,
  PARTS,
  saveDayPlans,
  withClearedSlot,
} from './dayplan.js'
import { usePlaces, isPlaceKey } from './places.js'
import NextDays from './NextDays.jsx'
import './calendar.css'

const wdLong = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })

export default function CalendarView({ events, anchors, wx }) {
  const { openDay, page } = useNav()
  const [selKey, setSelKey] = useState(null) // the TAPPED day (null = none); drives the inline bottom panel
  const [monthOff, setMonthOff] = useState(0)
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

  // ===== the gentle ledger (light version): "N days out in {month}" =====
  // A calm RECORD, never a score: ZERO IS SILENCE (rendered only when n > 0,
  // never "0 📉" — ban §7 #8). The count tracks the DISPLAYED month so it reads
  // as the caption of the grid you're looking at. The RICH ledger (variety
  // firsts + the past-days journal) stays in Profile — surfacing only this one
  // line here makes the tab feel full without duplicating Profile (see report).
  const base = new Date(anchors.todayTs)
  const month = new Date(base.getFullYear(), base.getMonth() + monthOff, 1)
  const monthStartTs = month.getTime()
  const nextMonthStartTs = new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime()
  const daysOut = daysOutInMonth(dids, monthStartTs, nextMonthStartTs)
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
  if (daysOut > 0) rhythmStats.push({ k: 'out', num: String(daysOut), lab: `out in ${monthName}` })
  // plans → reality as a POSITIVE COUNT, never a fraction (review P1): a "1/3" on
  // the most-glanced surface reads as a score/"you only made 1 of 3". Show only
  // the kept count, and SILENT on misses (gate on went, not planned) — the
  // reflective plans-vs-reality lives in Profile's logbook line, not here.
  if (reality.went > 0) rhythmStats.push({ k: 'plans', num: String(reality.went), lab: reality.went === 1 ? 'plan kept' : 'plans kept' })
  if (plannedAhead > 0) rhythmStats.push({ k: 'ahead', num: String(plannedAhead), lab: 'planned ahead' })

  // ===== U-d: the morning-after conversion card (the two-beat RETURN beat) =====
  // A single quiet card for the most-recent PAST PLANNED day not yet answered
  // (loadDayPlans already swept past plans into history; a past REST day is
  // excluded by morningAfterCandidates — a rested day is a record, never
  // asked). Re-derives on the same subpage edge as the grid marks (`page` flip)
  // so answering on the day screen / dismissing here reflects without remount.
  // Subscribing to been-there keeps the card honest when a "went" is answered
  // from ANOTHER surface (Profile's prompts) while Calendar is mounted.
  // A local bump (cardTick) re-derives the card after an answer HERE.
  const [cardTick, setCardTick] = useState(0)
  const card = useMemo(() => {
    void been
    void page
    void cardTick
    const cands = morningAfterCandidates(loadDayHistory(), loadConverted(), anchors)
    return cands[0] ?? null
  }, [anchors, been, page, cardTick])
  // resolve the card's slotted keys to live events for the title + the markBeen
  // snapshot; a vanished event still gets asked (we synthesize a start-bearing
  // snapshot so the day still derives as a did-day on "went"). A slot can hold a
  // PLACE ('p|') key, which is NEVER in `events` — fold the lazily-loaded places
  // into the resolver so a slotted place NAMES itself. The ~1.2MB places fetch
  // fires ONLY when THIS card's slots hold a place key (the DayPage gate).
  // the selected day's entry — read it so places are folded into the resolver
  // only when a slot actually holds a place key (same lazy gate as the card +
  // DayPage; an event-only/empty selection pays no ~1.2MB places fetch).
  const selEntry = selKey != null ? (dayEntryFor(dayPlans[String(selKey)]) ?? emptyDay()) : null
  const hasCardPlaceKey = card ? PARTS.some((p) => isPlaceKey(card.slots[p])) : false
  const hasSelPlaceKey = selEntry ? PARTS.some((p) => isPlaceKey(selEntry.slots[p])) : false
  const { places: placeList } = usePlaces(hasCardPlaceKey || hasSelPlaceKey)
  // key → live event/place, shared by the morning-after card AND the day-peek.
  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of events) m.set(keyOf(e), e)
    if (Array.isArray(placeList)) for (const p of placeList) m.set(p.key, p)
    return m
  }, [events, placeList])
  // [violet beat] moment #6. The PERSISTED one-shot lives in the converted
  // ledger (markDayConverted only lights violet on a first 'went'). The glow
  // must survive the answer: markBeen + markDayConverted both re-derive `card`
  // to null in the SAME batched commit, which would unmount the recap before
  // .lit ever paints. So on a lit 'went' we FREEZE the answered card into
  // litCard and render IT (with .lit) for the glow's duration; the ref-cleared
  // timer then clears it (toast pattern).
  const [litCard, setLitCard] = useState(null)
  const violetTRef = useRef(null)
  useEffect(() => () => clearTimeout(violetTRef.current), [])
  const VIOLET_MS = 900

  const cardSlots = card
    ? PARTS.map((part) => ({ part, key: card.slots[part] })).filter((x) => x.key)
    : []
  const cardPrimary = cardSlots.length ? byKey.get(cardSlots[0].key) : null
  // the day as a local-midnight ISO date — the synthesized snapshot's start, so
  // a vanished-event "went" still lands on the right did-day (didDays derives
  // from snapshot.start). Title degrades honestly when the event is gone.
  const cardDateISO = card
    ? (() => {
        const d = new Date(card.dayTs)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      })()
    : null
  const cardTitle = cardPrimary?.title || null

  const answerCard = (status) => {
    if (!card) return
    if (status === 'went') {
      // mark every slotted entry "went" (idempotent +2 via markBeen) so the
      // day's plan converts to journal entries; a vanished event gets a
      // synthesized start-bearing snapshot so the did-day still derives.
      for (const { key } of cardSlots) {
        const live = byKey.get(key)
        let snap
        if (!live) {
          snap = { title: null, start: cardDateISO, category: null }
        } else if (live.kind === 'place') {
          // a slotted PLACE has a real title/category but NO date of its own —
          // stamp the planned day as start so the did-day still derives.
          snap = { ...snapshotFor(live), start: cardDateISO }
        } else {
          snap = snapshotFor(live)
        }
        markBeen(key, snap, 'went')
      }
    }
    // record the answer (one-shot, persisted) — violet fires ONLY on a first
    // 'went' for this day; 'missed' is silent and the day just goes blank.
    const { violet: lit } = markDayConverted(card.dayTs, status)
    if (lit) {
      setLitCard({ dayTs: card.dayTs, title: cardTitle })
      clearTimeout(violetTRef.current)
      violetTRef.current = setTimeout(() => setLitCard(null), VIOLET_MS)
    }
    setCardTick((t) => t + 1)
  }

  // ===== the month canvas =====
  const monthTitle = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
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
          <h2 className="cal-title">Your days{/* DRAFT for Charles */}</h2>
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

      {/* U-d — the two-beat RETURN beat: a single quiet morning-after card for
          the most-recent past PLANNED day, not yet answered. Went → records the
          attendance (idempotent +2) + the ONE sanctioned violet beat #6; Missed
          → silent, the day just goes blank. A past REST day is never asked.
          The violet glow (litCard) WINS the render while it plays. ALL COPY IS
          DRAFT for Charles. */}
      {litCard ? (
        <div className="cal-recap lit">
          <div className="cal-recap-q">
            {wdLong(litCard.dayTs)} — logged ✓{/* DRAFT for Charles */}
          </div>
          {/* 3.7P-4b: the streak PAYOFF rides the sanctioned violet beat (#6) — no
              new --reward minted. `rhythm` is live, so it reflects the just-logged
              'went'. Gated at 2+; a gap never shows here (the beat only fires on a
              logged day). DRAFT copy. */}
          {rhythm.current >= 2 && (
            <div className="cal-recap-rhythm">
              <span aria-hidden>🔥</span> {rhythm.current}-day rhythm
            </div>
          )}
        </div>
      ) : (
        card && (
          <div className="cal-recap">
            <div className="cal-recap-q">
              {wdLong(card.dayTs)} — did you make it
              {cardTitle ? (
                <>
                  {' '}to <span className="cal-recap-what">{cardTitle}</span>?
                </>
              ) : (
                ' out?'
              )}
            </div>
            <div className="cal-recap-btns">
              <button className="cal-recap-yes" onClick={() => answerCard('went')}>
                I went 🎉
              </button>
              <button className="cal-recap-no" onClick={() => answerCard('missed')}>
                Missed it
              </button>
            </div>
          </div>
        )
      )}

      {/* the month canvas — ONLY the personal layer. No event counts, no heat
          tint, no hot ring. Tapping a today-or-later cell opens the day screen
          (the bridge to fill it); past cells stay browse-only (their record is
          the journal). */}
      <div className="cal-fade" key={'month' + monthOff}>
        <div className="mon-head">
          <h3 className="mon-title">{monthTitle}</h3>
          <div className="mon-navs">
            {/* clamp at the current month: past months hold only past days
                (browse-only records), and the marks still render — but the grid
                stays anchored at "now" forward as the planning surface */}
            <button
              className="mon-nav"
              onClick={() => setMonthOff((o) => Math.max(o - 1, 0))}
              disabled={monthOff === 0}
              aria-label="Previous month"
            >
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button
              className="mon-nav"
              onClick={() => setMonthOff((o) => o + 1)}
              aria-label="Next month"
            >
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
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
                    const when = part === 'day' ? 'Day' : 'Night'
                    return (
                      <div className={'cal-sel-slot' + (e ? ' filled' : '')} key={part} aria-label={`${when}: ${e ? e.title || e.name : 'open'}`}>
                        <span className="cal-sel-when" aria-hidden>{part === 'day' ? '☀️' : '🌙'} {when}</span>
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
