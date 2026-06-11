// WeekendBuilder — Sprint K2 (⚑FLAG-4 approved prototype; self-contained so a
// Charles veto is one import + one button per entry point to cut).
//
// The upcoming weekend (Fri/Sat/Sun — already-finished days drop) as day
// columns, each with two slots: ☀️ Day (start before 17:00) and 🌙 Night
// (17:00+); date-only events count as "anytime" and fit either. Tapping an
// empty slot opens a picker sheet: your saved events that fit first ("From
// your list ❤️"), then up to 8 hot-ranked, taste-nudged suggestions. Slotted
// events render as mini-cards (tap → detail, ✕ → clear). The plan persists to
// 'weekend-plan-v1' (weekend.js owns the shape + window/daypart/picker logic);
// a NEW weekend silently overwrites the old plan. "Share plan" composes an
// emoji-rich text via navigator.share with a clipboard-toast fallback (the
// detail-page share pattern). The one --reward beat: the first moment a plan
// becomes complete (all 6 slots, or ≥3 + "Done planning") — one-shot, persisted
// via plan.done, reduced-motion-safe (weekend.css).
//
// App mounts this inside the sliding .subpage overlay (z 1500, below detail
// 2000). Props contract (same wiring as BubblePage/FindMyNight):
//   events   — normalized events
//   anchors  — { todayTs, tomorrowTs, wkStartTs, wkEndTs }
//   onSelect — (event, cardEl|null) opens the detail (stacks on top)
//   onClose  — slide back out
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, keyOf, timeOf } from './lib.js'
import { CardImg, SponsoredTag } from './cards.jsx'
import { shelfItems, useSaves } from './saves.js'
import { tasteNudge } from './taste.js'
import {
  SLOT_IDS,
  daypartOf,
  filledCount,
  fitsDay,
  loadPlan,
  pickerModel,
  savePlan,
  shareText,
  visibleWeekend,
} from './weekend.js'
import './weekend.css'

const wd = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })
const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function WeekendBuilder({ events, anchors, onSelect, onClose }) {
  // the columns: Fri/Sat/Sun of the current anchors weekend, today-or-later only
  const days = useMemo(() => visibleWeekend(anchors), [anchors])

  // plan state: loaded once for this weekend, persisted on every change.
  // App keys this component by anchors.wkStartTs, so a midnight rollover into
  // a NEW weekend remounts with that weekend's (empty) plan — the old one is
  // archived by simply being overwritten on the next save.
  const [plan, setPlan] = useState(() => loadPlan(anchors.wkStartTs))
  useEffect(() => {
    savePlan(plan)
  }, [plan])

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
  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of savedEvents) m.set(keyOf(e), e) // snapshots first…
    for (const e of upcoming) m.set(keyOf(e), e) // …live events win
    return m
  }, [upcoming, savedEvents])
  // a slotted event must still FIT its day (a refresh can move dates) — else null
  const resolveSlot = useCallback(
    (k, ts) => {
      const e = k ? byKey.get(k) : null
      return e && fitsDay(e, ts) ? e : null
    },
    [byKey]
  )

  // ===== the one-shot complete beat (--reward, K2 spec) =====
  // `plan.done` persists "this plan already celebrated"; `celebrate` marks the
  // live transition in THIS session so the beat animates exactly once, ever.
  const [celebrate, setCelebrate] = useState(false)
  const commitPlan = (next) => {
    if (!next.done && filledCount(next) === SLOT_IDS.length) {
      next = { ...next, done: true }
      setCelebrate(true)
    }
    setPlan(next)
  }
  const donePlanning = () => {
    if (plan.done) return
    setCelebrate(true)
    setPlan({ ...plan, done: true })
  }

  // ===== picker sheet =====
  const [picker, setPicker] = useState(null) // { ts, id, part } | null
  const [sheetClosing, setSheetClosing] = useState(false)
  const sheetTRef = useRef(null)
  useEffect(() => () => clearTimeout(sheetTRef.current), [])
  const openSheet = (d, part) => {
    clearTimeout(sheetTRef.current)
    setSheetClosing(false)
    setPicker({ ts: d.ts, id: d.id, part })
  }
  const closeSheet = useCallback(() => {
    setSheetClosing(true)
    clearTimeout(sheetTRef.current)
    sheetTRef.current = setTimeout(() => {
      setPicker(null)
      setSheetClosing(false)
    }, 240)
  }, [])
  // Escape closes the sheet BEFORE App's window listener can close the whole
  // page (capture phase runs first; stopPropagation keeps the page up)
  useEffect(() => {
    if (!picker) return
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      closeSheet()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [picker, closeSheet])

  const model = useMemo(() => {
    if (!picker) return null
    // a stale slotted key (event vanished/moved since planning) must not keep
    // blocking its event from every picker — null unresolvable keys first
    const liveSlots = Object.fromEntries(
      Object.entries(plan.slots).map(([id, k]) => [id, k && byKey.has(k) ? k : null])
    )
    return pickerModel({
      ts: picker.ts,
      part: picker.part,
      upcoming,
      saved: savedEvents,
      plan: { ...plan, slots: liveSlots },
      nudge: tasteNudge,
    })
  }, [picker, upcoming, savedEvents, plan, byKey])

  const assign = (e) => {
    if (!picker) return
    commitPlan({ ...plan, slots: { ...plan.slots, [picker.id + '_' + picker.part]: keyOf(e) } })
    closeSheet()
  }
  const clearSlot = (slotId) => setPlan({ ...plan, slots: { ...plan.slots, [slotId]: null } })

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
    const text = shareText(plan, days, resolveSlot)
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
  const visibleSlotIds = days.flatMap((d) => ['day', 'night'].map((p) => d.id + '_' + p))
  const filledVis = filledCount(plan, visibleSlotIds)
  const range =
    days.length > 1 ? fmtShort(days[0].ts) + ' – ' + fmtShort(days[days.length - 1].ts) : fmtShort(days[0].ts)

  const renderSlot = (d, part) => {
    const slotId = d.id + '_' + part
    const e = resolveSlot(plan.slots[slotId], d.ts)
    return (
      <div className="wkb-slot" key={slotId}>
        <div className="wkb-part">{part === 'day' ? '☀️ Day' : '🌙 Night'}</div>
        {e ? (
          <div className="wkb-filled">
            <button className="wkb-card pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
              <CardImg e={e} className="wkb-thumb" />
              <span className="wkb-card-title">{e.title}</span>
              <span className="wkb-card-meta">
                {[daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null, e.venue]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <SponsoredTag e={e} />
            </button>
            <button
              className="wkb-clear"
              onClick={() => clearSlot(slotId)}
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

  const pickRow = (e) => (
    <button key={keyOf(e)} className="wkb-pick pressable" onClick={() => assign(e)}>
      <CardImg e={e} className="wkb-pick-img" />
      <span className="wkb-pick-main">
        <span className="wkb-pick-title">{e.title}</span>
        <span className="wkb-pick-meta">
          {[daypartOf(e) === 'any' ? 'Anytime' : timeOf(e.start) || null, e.venue].filter(Boolean).join(' · ')}
        </span>
        <SponsoredTag e={e} />
      </span>
      <span className="wkb-pick-add" aria-hidden>
        +
      </span>
    </button>
  )

  return (
    <div className="pg wkb">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <div>
          <h1 className="pg-head-title">Build my weekend</h1>
          <div className="pg-count">
            {range} · {filledVis}/{visibleSlotIds.length} planned
          </div>
        </div>
      </header>
      <div className="pg-body wkb-body">
        <div className={'wkb-days wkb-n' + days.length}>
          {days.map((d) => (
            <div className="wkb-col" key={d.id}>
              <div className="wkb-day-head">
                <span className="wkb-dow">{new Date(d.ts).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="wkb-date">
                  {d.ts === anchors.todayTs
                    ? 'Today'
                    : new Date(d.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
              {renderSlot(d, 'day')}
              {renderSlot(d, 'night')}
            </div>
          ))}
        </div>
        {plan.done && filledVis > 0 && (
          <div className={'wkb-done-card' + (celebrate ? ' beat' : '')}>
            <div className="wkb-done-over">Planned ✓</div>
            <div className="wkb-done-title">That's a weekend.</div>
            <div className="wkb-done-sub">Share it with the crew, then go live it.</div>
          </div>
        )}
        {filledVis > 0 && (
          <div className="wkb-actions">
            {filledVis >= Math.min(3, visibleSlotIds.length) && !plan.done && (
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
        <div className={'wkb-sheet-wrap' + (sheetClosing ? ' closing' : '')}>
          <button className="wkb-scrim" onClick={closeSheet} aria-label="Close picker" />
          <div className="wkb-sheet" role="dialog" aria-label="Pick an event">
            <div className="wkb-sheet-head">
              <div className="wkb-sheet-title">
                {(picker.part === 'day' ? '☀️ ' : '🌙 ') +
                  wd(picker.ts) +
                  (picker.part === 'day' ? ' daytime' : ' night')}
              </div>
              <button className="wkb-sheet-close" onClick={closeSheet} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="wkb-sheet-body">
              {model.saved.length > 0 && (
                <>
                  <div className="wkb-group">From your list ❤️</div>
                  {model.saved.map(pickRow)}
                </>
              )}
              {savedList.length === 0 && (
                <div className="wkb-note">♥ save things and they'll show up here first</div>
              )}
              {model.suggestions.length > 0 && (
                <>
                  <div className="wkb-group">Top picks 🔥</div>
                  {model.suggestions.map(pickRow)}
                </>
              )}
              {model.saved.length === 0 && model.suggestions.length === 0 && (
                <div className="wkb-note">Nothing on the books for this one yet 🦗</div>
              )}
            </div>
          </div>
        </div>
      )}
      {toast && <div className="detail-toast wkb-toast">{toast}</div>}
    </div>
  )
}
