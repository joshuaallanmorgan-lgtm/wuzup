// WeekendBuilder — Sprint K2 prototype, re-founded in Sprint U-a (⚑U-WB,
// default ratified) as a three-column VIEW over the generalized day-plan
// store. There is no weekend-shaped plan anymore: each column reads/writes
// the SAME 'day-plans-v1' entry the day screen (DayPage) uses, so a slot
// filled here shows up there and vice versa — one store, two lenses.
//
// What stayed the K2 original: the Fri/Sat/Sun columns (finished days drop),
// the ☀️/🌙 slot semantics (weekend.js daypartOf/fitsSlot), the saved-first
// picker (pickerModel via the shared PickerSheet), "Share plan" composed
// text, and the ONE --reward beat — the first moment the weekend's plan
// completes. The beat's one-shot memory moved from plan.done (a weekend-plan
// field that no longer exists) to dayplan.js's 'weekend-done-v1' single-slot
// key; the DAY entries' done flag is NOT touched — it belongs to Sprint U-d's
// planned→did conversion and means something else entirely.
//
// Rest days (U-a): a column whose day entry carries state:'rest' renders the
// calm quiet-day card instead of two empty slots — rest and slots are
// mutually exclusive (dayplan.js enforces it; "plan this day instead" clears
// the mark and the slots return). Rest is a filled state, never an absence.
//
// App mounts this inside the sliding .subpage overlay (z 1500, below detail
// 2000), keyed by anchors.wkStartTs (midnight-rollover remount). Props:
//   events   — normalized events
//   anchors  — { todayTs, tomorrowTs, wkStartTs, wkEndTs }
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, keyOf, timeOf } from './lib.js'
import { useNav } from './nav.jsx'
import { CardImg, SponsoredTag } from './cards.jsx'
import { shelfItems, useSaves } from './saves.js'
import { tasteNudge } from './taste.js'
import { usePlaces, isPlaceKey } from './places.js'
import { daypartOf, fitsDay, pickerModel, shareText, visibleWeekend, weekendDays } from './weekend.js'
import {
  PARTS,
  dayEntryFor,
  emptyDay,
  filledForDays,
  loadDayPlans,
  loadWeekendDone,
  markWeekendDone,
  saveDayPlans,
  withClearedSlot,
  withRest,
  withSlot,
} from './dayplan.js'
import PickerSheet from './PickerSheet.jsx'
import './weekend.css'

const wd = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })
const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
// 3 days × 2 parts — the auto-complete threshold (all six, K2's original rule)
const DAY_PARTS_TOTAL = 6

export default function WeekendBuilder({ events, anchors }) {
  const { openDetail: onSelect, closePage: onClose } = useNav()
  // the columns: Fri/Sat/Sun of the current anchors weekend, today-or-later only
  const days = useMemo(() => visibleWeekend(anchors), [anchors])

  // the day-plan map: loaded once on mount (loadDayPlans runs the one-shot
  // weekend-plan-v1 migration + the past-day archive sweep), persisted on
  // every change. App keys this component by anchors.wkStartTs, so a midnight
  // rollover into a NEW weekend remounts onto that weekend's day entries.
  const [plans, setPlans] = useState(() => loadDayPlans(anchors))
  useEffect(() => {
    saveDayPlans(plans)
  }, [plans])
  const entryFor = (ts) => dayEntryFor(plans[String(ts)]) ?? emptyDay()

  // resolution: live dataset events win; saved snapshots cover saves whose
  // event vanished in a refresh; anything else is null → slot renders empty
  // (silent fallback — the stored key is kept, picking again overwrites it).
  const upcoming = useMemo(
    () => events.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs),
    [events, anchors]
  )
  const { list: savedList } = useSaves()
  const savedEvents = useMemo(
    () => shelfItems(savedList, events, anchors).filter((x) => !x.past).map((x) => x.e),
    [savedList, events, anchors]
  )
  // Sprint T3 (mirrors DayPage): a slot can hold a PLACE ('p|' key) from the
  // place→plan bridge — fold the lazy places into the resolver so a slotted
  // place renders instead of silently vanishing. Gate the ~1.2MB /places.json
  // fetch on an ACTUAL place slot anywhere in the visible weekend — an
  // event-only weekend pays nothing.
  const hasPlaceSlot = useMemo(
    () =>
      days.some((d) => {
        const en = dayEntryFor(plans[String(d.ts)])
        return en && (isPlaceKey(en.slots.day) || isPlaceKey(en.slots.night))
      }),
    [days, plans]
  )
  const { places: placeList } = usePlaces(hasPlaceSlot)
  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of savedEvents) m.set(keyOf(e), e) // snapshots first…
    for (const e of upcoming) m.set(keyOf(e), e) // …live events win
    if (Array.isArray(placeList)) for (const p of placeList) m.set(p.key, p) // …places too
    return m
  }, [upcoming, savedEvents, placeList])
  // a slotted EVENT must still FIT its day (a refresh can move dates) — else
  // null; a PLACE is "always there" and fits any day (the DayPage rule)
  const resolveSlot = useCallback(
    (k, ts) => {
      const e = k ? byKey.get(k) : null
      if (!e) return null
      if (e.kind === 'place') return e
      return fitsDay(e, ts) ? e : null
    },
    [byKey]
  )

  // ===== the one-shot complete beat (--reward, K2 spec; memory in
  // 'weekend-done-v1' since U-a — see dayplan.js) =====
  // `done` persists "this weekend already celebrated"; `celebrate` marks the
  // live transition in THIS session so the beat animates exactly once, ever.
  const [done, setDone] = useState(() => loadWeekendDone(anchors.wkStartTs))
  const [celebrate, setCelebrate] = useState(false)
  const wkDayTs = useMemo(() => weekendDays(anchors), [anchors])
  const commitPlans = (next) => {
    // auto-complete = all 6 slots across the FULL weekend (only reachable
    // while all three days are still live — the K2 behavior, preserved)
    if (!done && filledForDays(next, wkDayTs) === DAY_PARTS_TOTAL) {
      markWeekendDone(anchors.wkStartTs)
      setDone(true)
      setCelebrate(true)
    }
    setPlans(next)
  }
  const donePlanning = () => {
    if (done) return
    markWeekendDone(anchors.wkStartTs)
    setCelebrate(true)
    setDone(true)
  }

  // ===== picker sheet =====
  const [picker, setPicker] = useState(null) // { ts, part } | null
  const [sheetClosing, setSheetClosing] = useState(false)
  const sheetTRef = useRef(null)
  useEffect(() => () => clearTimeout(sheetTRef.current), [])
  const openSheet = (d, part) => {
    clearTimeout(sheetTRef.current)
    setSheetClosing(false)
    setPicker({ ts: d.ts, part })
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
    // dedup pool: every slotted key across the weekend's day entries — a
    // stale key (event vanished/moved since planning) must not keep blocking
    // its event from every picker, so unresolvable keys null out first
    const liveSlots = {}
    for (const ts of wkDayTs) {
      const en = dayEntryFor(plans[String(ts)])
      if (!en) continue
      for (const part of PARTS) {
        const k = en.slots[part]
        liveSlots[ts + '_' + part] = k && byKey.has(k) ? k : null
      }
    }
    return pickerModel({
      ts: picker.ts,
      part: picker.part,
      upcoming,
      saved: savedEvents,
      plan: { slots: liveSlots },
      nudge: tasteNudge,
    })
  }, [picker, upcoming, savedEvents, plans, byKey, wkDayTs])

  const assign = (e) => {
    if (!picker) return
    commitPlans(withSlot(plans, picker.ts, picker.part, keyOf(e)))
    closeSheet()
  }
  const clearSlot = (ts, part) => setPlans(withClearedSlot(plans, ts, part))

  // ===== share: composed text via navigator.share, clipboard fallback w/ toast
  // (the detail-page pattern) =====
  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1600)
  }
  const sharePlan = async () => {
    // shareText still speaks weekend-plan shape ({ slots: { fri_day… } }) —
    // adapt the day entries into that shape so the composer stays untouched
    const slots = {}
    for (const d of days) for (const part of PARTS) slots[d.id + '_' + part] = entryFor(d.ts).slots[part]
    const text = shareText({ slots }, days, resolveSlot)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'My weekend plan', text })
      } catch {
        /* user dismissed the share sheet — not an error */
      }
    } else if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        flash('Plan copied ✓')
      } catch {
        flash("Couldn't copy the plan")
      }
    } else {
      flash("Sharing isn't available here")
    }
  }

  // header line: "Fri, Jun 12 – Sun, Jun 14 · 2/6 planned" (visible slots only)
  const filledVis = filledForDays(plans, days.map((d) => d.ts))
  const visibleSlotN = days.length * PARTS.length
  const range =
    days.length > 1 ? fmtShort(days[0].ts) + ' – ' + fmtShort(days[days.length - 1].ts) : fmtShort(days[0].ts)

  const renderSlot = (d, part) => {
    const e = resolveSlot(entryFor(d.ts).slots[part], d.ts)
    return (
      <div className="wkb-slot" key={d.id + '_' + part}>
        <div className="wkb-part">{part === 'day' ? '☀️ Day' : '🌙 Night'}</div>
        {e ? (
          <div className="wkb-filled">
            <button className="wkb-card pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
              <CardImg e={e} className="wkb-thumb" />
              <span className="wkb-card-title">{e.title}</span>
              <span className="wkb-card-meta">
                {[
                  e.kind === 'place' ? 'Always here' : daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null,
                  e.venue,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <SponsoredTag e={e} />
            </button>
            <button
              className="wkb-clear"
              onClick={() => clearSlot(d.ts, part)}
              aria-label={`Clear ${e.title} from ${wd(d.ts)} ${part}`}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            className="wkb-empty pressable"
            onClick={() => openSheet(d, part)}
            aria-label={`Plan ${wd(d.ts)} ${part === 'day' ? 'daytime' : 'night'}`}
          >
            <span className="wkb-empty-txt">Open — tap to plan</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="pg wkb">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <div>
          <h1 className="pg-head-title">Build my weekend</h1>
          <div className="pg-count">
            {range} · {filledVis}/{visibleSlotN} planned
          </div>
        </div>
      </header>
      <div className="pg-body wkb-body">
        <div className={'wkb-days wkb-n' + days.length}>
          {days.map((d) => {
            const rest = entryFor(d.ts).state === 'rest'
            return (
              <div className="wkb-col" key={d.id}>
                <div className="wkb-day-head">
                  <span className="wkb-dow">{new Date(d.ts).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className="wkb-date">
                    {d.ts === anchors.todayTs
                      ? 'Today'
                      : new Date(d.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                {rest ? (
                  /* a rest day marked on the day screen renders here as the
                     same calm filled state — never an empty slot to "fix" */
                  <div className="wkb-rest">
                    <div className="wkb-rest-title">🌙 Quiet day</div>
                    <div className="wkb-rest-sub">Resting is a plan too.</div>
                    <button className="wkb-rest-undo" onClick={() => setPlans(withRest(plans, d.ts, false))}>
                      Plan this day instead
                    </button>
                  </div>
                ) : (
                  <>
                    {renderSlot(d, 'day')}
                    {renderSlot(d, 'night')}
                  </>
                )}
              </div>
            )
          })}
        </div>
        {done && filledVis > 0 && (
          <div className={'wkb-done-card' + (celebrate ? ' beat' : '')}>
            <div className="wkb-done-over">Planned ✓</div>
            <div className="wkb-done-title">That's a weekend.</div>
            <div className="wkb-done-sub">Share it with the crew, then go live it.</div>
          </div>
        )}
        {filledVis > 0 && (
          <div className="wkb-actions">
            {filledVis >= Math.min(3, visibleSlotN) && !done && (
              <button className="wkb-btn wkb-btn-done" onClick={donePlanning}>
                Done planning
              </button>
            )}
            {filledVis > 0 && (
              <button className="wkb-btn wkb-btn-share" onClick={sharePlan}>
                📤 Share plan
              </button>
            )}
          </div>
        )}
      </div>

      {picker && model && (
        <PickerSheet
          title={
            (picker.part === 'day' ? '☀️ ' : '🌙 ') + wd(picker.ts) + (picker.part === 'day' ? ' daytime' : ' night')
          }
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
