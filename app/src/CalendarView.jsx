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
import { dateKey } from './weather.js'
import {
  daysOutInMonth,
  didDays,
  hasContent,
  loadConverted,
  loadDayHistory,
  loadDayPlans,
  markDayConverted,
  morningAfterCandidates,
  PARTS,
} from './dayplan.js'
import { usePlaces, isPlaceKey } from './places.js'
import './calendar.css'

const wdLong = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })

export default function CalendarView({ events, anchors, wx }) {
  const { openDay, page } = useNav()
  const [selKey, setSelKey] = useState(null) // selected day timestamp (the grid caption tracks it)
  const [monthOff, setMonthOff] = useState(0)

  // 16-day Tampa forecast: { 'YYYY-MM-DD': {emoji,hi,rain} } | null. The grid
  // keeps a quiet weather emoji per day — it's about YOUR day (should I plan
  // outdoors?), not supply. App owns the single getForecast() fetch.
  const wxFor = (ts) => (wx ? wx[dateKey(ts)] : null)

  // ===== the personal day-plan store — the grid's quiet marks =====
  // localStorage isn't reactive — plans only change inside the day/WB subpages,
  // so re-reading on every subpage open/close edge (`page` flips null ↔ object)
  // keeps the marks honest; the read is one small JSON parse.
  const dayPlans = useMemo(() => {
    void page // re-read trigger (see above)
    return loadDayPlans(anchors)
  }, [anchors, page])
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
  const hasPlaceKey = card ? PARTS.some((p) => isPlaceKey(card.slots[p])) : false
  const { places: placeList } = usePlaces(hasPlaceKey)
  const cardByKey = useMemo(() => {
    const m = new Map()
    for (const e of events) m.set(keyOf(e), e)
    if (Array.isArray(placeList)) for (const p of placeList) m.set(p.key, p)
    return m
  }, [events, placeList])
  // [violet beat] moment #7. The PERSISTED one-shot lives in the converted
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
  const cardPrimary = cardSlots.length ? cardByKey.get(cardSlots[0].key) : null
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
        const live = cardByKey.get(key)
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
  const selPlanned = plannedDays.has(sel)
  const selRest = restDays.has(sel)
  const selWent = dids.has(sel)
  const selPast = sel < anchors.todayTs
  const selToday = sel === anchors.todayTs
  const selTitle = new Date(sel).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  // the caption: the SELECTED day's personal shape — a logbook line, never an
  // event list (the agenda lives on the day screen). DRAFT for Charles.
  const selCaption = selWent
    ? '✓ You made it out 🎉' // DRAFT
    : selRest
      ? '🌙 A quiet day' // DRAFT
      : selPlanned
        ? '🗓️ You have a plan — tap to open it' // DRAFT
        : selPast
          ? 'A quiet page.' // DRAFT — a blank past day is calm, never a gap
          : 'Open — tap to plan this day' // DRAFT

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
        {/* the light gentle-ledger line — a calm record of the displayed month.
            ZERO IS SILENCE: rendered only when n > 0. DRAFT for Charles. */}
        {daysOut > 0 && (
          <div className="cal-ledger">
            {daysOut === 1 ? `1 day out in ${monthName} ✓` : `${daysOut} days out in ${monthName} ✓`}
          </div>
        )}
      </div>

      {/* U-d — the two-beat RETURN beat: a single quiet morning-after card for
          the most-recent past PLANNED day, not yet answered. Went → records the
          attendance (idempotent +2) + the ONE sanctioned violet beat #7; Missed
          → silent, the day just goes blank. A past REST day is never asked.
          The violet glow (litCard) WINS the render while it plays. ALL COPY IS
          DRAFT for Charles. */}
      {litCard ? (
        <div className="cal-recap lit">
          <div className="cal-recap-q">
            {wdLong(litCard.dayTs)} — logged ✓{/* DRAFT for Charles */}
          </div>
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
            <button className="mon-nav" onClick={() => setMonthOff((o) => o + 1)} aria-label="Next month">
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
            const w = wxFor(ts)
            const went = dids.has(ts)
            const planned = !went && plannedDays.has(ts) // a did-day's check outranks its plan underline
            const restful = !went && restDays.has(ts) // …and outranks a stale rest mark (no ✓ + crescent on one cell)
            return (
              <button
                key={ts}
                className={
                  'mcell' +
                  (ts === sel ? ' sel' : '') +
                  (ts === anchors.todayTs ? ' today' : '') +
                  (went ? ' went' : '')
                }
                onClick={() => {
                  setSelKey(ts) // the caption tracks the tap…
                  // …and today-or-later cells open the day screen (the bridge).
                  // Past cells stay browse-only: a personal past day is the
                  // journal's record, not a planning surface.
                  if (ts >= anchors.todayTs) openDay(ts)
                }}
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
                {w && <span className="mwx">{w.emoji}</span>}
              </button>
            )
          })}
        </div>

        {/* the selected day's caption — a logbook line about YOUR shape for the
            day, not an event list (the agenda lives on the day screen). */}
        <div className="cal-sel">
          <h3 className="day-header cal-day">{selTitle}</h3>
          <button
            className={'cal-sel-line' + (selPast ? ' cal-sel-past' : '')}
            onClick={() => {
              if (sel >= anchors.todayTs) openDay(sel)
            }}
            disabled={selPast}
          >
            <span className="cal-sel-txt">{selCaption}</span>
            {!selPast && <span className="cal-sel-go" aria-hidden>→</span>}
          </button>
          {selToday && !selPlanned && !selRest && !selWent && (
            <div className="cal-sel-hint">Tap any day to plan, rest, or fill it. Blank days are fine too 🌙{/* DRAFT */}</div>
          )}
        </div>
      </div>
    </div>
  )
}
