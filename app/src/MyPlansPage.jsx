// MyPlansPage — the Profile "My plans" drill-in (Stage R Profile rework). The
// old Profile "Your days" + "Been there" content relocated here, intact:
//   · Plans → Reality (this month's planned-vs-went, zero-is-silence)
//   · Past days journal (day-history-v1) — each day TAPPABLE → openDay(ts)
//   · the gentle ledger (days-out this month, rhythm/streak, variety firsts)
//   · "Did you make it?" prompts for passed saves + the self-reported went-list
// All from the reactive atomic planner plus the existing saves/gamify stores;
// every empty state is honest. Opened via nav.openMyPlans ({type:'myplans'});
// each openDay replaces this subpage (single-slot), back → the Profile tab.
import { useMemo, useRef, useState } from 'react'
import { eventLifecycle, Icon, dayLoose, formatDayTs, keyOf, monthStartTs as cityMonthStartTs, normalize, rawOf } from './lib.js'
import { useNav } from './nav.jsx'
import { GemRow, SponsoredTag } from './cards.jsx'
import { DAYPART } from './weekend.js'
import { shelfItems, useBeenThere, useSaves } from './saves.js'
import { useSavedBeen } from './SavedBeenProvider.jsx'
import { recordSignal } from './taste.js'
import { rhythmSummary } from './gamify.js'
import {
  daysOutInMonth,
  didDays,
  monthReality as computeMonthReality,
  varietyFirsts,
} from './dayplan.js'
import { usePlanner } from './PlannerProvider.jsx'
import './profile.css'

const fmtShort = (ts) => formatDayTs(ts, { weekday: 'short', month: 'short', day: 'numeric' })
const slotTitle = (slot) => slot?.item?.title || slot?.item?.name || 'Saved plan'
const slotStatus = (slot) => {
  if (slot?.resolution === 'ambiguous') return 'needs review'
  if (slot?.resolution === 'missing') return 'no longer listed'
  if (slot?.resolution === 'retained') return 'saved copy'
  return null
}
const dayPlanText = (day) => day.slots
  .map((slot) => {
    const status = slotStatus(slot)
    return `${DAYPART[slot.part].emoji} ${slotTitle(slot)}${status ? ` (${status})` : ''}`
  })
  .join(' / ')

export default function MyPlansPage({ events, anchors }) {
  const { closePage: onClose, openDetail: onSelect, openDay } = useNav()
  const { list: savedList } = useSaves({ events, anchors })
  const been = useBeenThere()
  const { ready: savedBeenReady, markBeen: markBeenAction } = useSavedBeen()
  const pendingBeenRef = useRef(new Set())
  const [pendingBeenKeys, setPendingBeenKeys] = useState(() => new Set())
  const {
    status: plannerStatus,
    durability: plannerDurability,
    error: plannerError,
    activeDays,
    history: plannerHistory,
    filledDayCount: plansCount,
    getDay,
    retryPersistence,
  } = usePlanner()

  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of events) m.set(keyOf(e), e)
    return m
  }, [events])
  const answerBeen = async (target, key, snapshot, status, statusAt) => {
    if (!savedBeenReady || pendingBeenRef.current.has(key)) return
    pendingBeenRef.current.add(key)
    setPendingBeenKeys(new Set(pendingBeenRef.current))
    try {
      const result = await markBeenAction(target, {
        status,
        statusAt,
        archivedAt: statusAt,
      })
      if (result?.changed !== true) return result
      if (status === 'went' && result.status === 'went' && snapshot) {
        recordSignal('went', snapshot)
      }
      return result
    } catch (error) {
      return { changed: false, code: 'been-answer-failed', error }
    } finally {
      pendingBeenRef.current.delete(key)
      setPendingBeenKeys(new Set(pendingBeenRef.current))
    }
  }

  // The atomic planner owns both current plans and the past-days journal.
  // Provider read models stay reactive across edits and other open tabs.
  const upcomingDays = useMemo(
    () => activeDays
      .filter(({ dayTs }) => dayTs >= anchors.todayTs)
      .map(({ dayTs }) => getDay(dayTs))
      .filter((day) => day.state === 'rest' || day.slots.length > 0),
    [activeDays, anchors.todayTs, getDay]
  )
  const dayHist = useMemo(
    () => plannerHistory
      .slice()
      .sort((left, right) => right.dayTs - left.dayTs)
      .slice(0, 10)
      .map(({ dayTs }) => getDay(dayTs)),
    [plannerHistory, getDay]
  )
  const shelf = useMemo(() => shelfItems(savedList, events, anchors), [savedList, events, anchors])

  // The provider's count covers every filled current or historical day, while
  // this page intentionally renders only the ten most recent past days.
  // gentle ledger (all derived, never new stores)
  const dids = useMemo(() => didDays(been), [been])
  const monthStart = useMemo(() => cityMonthStartTs(anchors.todayTs), [anchors.todayTs])
  const nextMonthStart = useMemo(() => cityMonthStartTs(anchors.todayTs, 1), [anchors.todayTs])
  const daysOut = daysOutInMonth(dids, monthStart, nextMonthStart)
  const monthName = formatDayTs(anchors.todayTs, { month: 'long' })
  const firsts = useMemo(() => varietyFirsts(been), [been])
  const monthReality = useMemo(
    () => computeMonthReality(plannerHistory, dids, monthStart, nextMonthStart),
    [plannerHistory, monthStart, nextMonthStart, dids]
  )
  const restDays = useMemo(
    () => [...activeDays, ...plannerHistory]
      .filter((day) => day.state === 'rest')
      .map((day) => day.dayTs),
    [activeDays, plannerHistory]
  )
  const rhythm = useMemo(
    () => rhythmSummary(dids, restDays, anchors),
    [dids, restDays, anchors]
  )

  // Been there: unanswered "did you make it?" prompts + the went-list
  const answered = useMemo(() => new Set(been.filter((b) => b.status).map((b) => b.key)), [been])
  const prompts = useMemo(() => {
    const out = []
    const seen = new Set()
    for (const { e, lifecycle, record } of shelf) {
      if (lifecycle.code !== 'ended') continue
      const k = record?.key ?? keyOf(e)
      if (answered.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push({ key: k, e, snapshot: record?.snapshot ?? rawOf(e), target: record ?? e })
    }
    for (const b of been) {
      if (b.status || !b.snapshot || answered.has(b.key) || seen.has(b.key)) continue
      const e = normalize({ ...b.snapshot }, anchors)
      if (eventLifecycle(e).code !== 'ended') continue
      seen.add(b.key)
      out.push({ key: b.key, e, snapshot: b.snapshot, target: b })
    }
    return out
  }, [shelf, been, answered, anchors])
  const wentList = useMemo(
    () =>
      been
        .filter((b) => b.status === 'went')
        .sort((a, b) => (b.statusAt || 0) - (a.statusAt || 0))
        .map((b) => ({ key: b.key, e: byKey.get(b.key) ?? (b.snapshot ? normalize({ ...b.snapshot }, anchors) : null) }))
        .filter((x) => x.e),
    [been, byKey, anchors]
  )

  const plannerPending = plannerStatus === 'idle' || plannerStatus === 'initializing'
  const plannerUnavailable = plannerStatus === 'error' || plannerStatus === 'corrupt'
  const hasAnything = upcomingDays.length > 0 || dayHist.length > 0 || wentList.length > 0 || prompts.length > 0

  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">
          My Plans{plansCount > 0 && <span className="shelf-count">{plansCount}</span>}
        </h1>
      </header>
      <div className="pg-body">
        {plannerPending && (
          <div className="pf-empty" role="status">Loading your plans...</div>
        )}
        {plannerUnavailable && (
          <div className="pf-empty" role="alert">
            Your plans could not be opened safely.
            {typeof plannerError?.detail === 'string' && <div>{plannerError.detail}</div>}
            <button className="empty-cta" onClick={retryPersistence}>Try again</button>
          </div>
        )}
        {plannerDurability === 'session-only' && !plannerUnavailable && (
          <div className="pf-reality" role="status">
            Changes are available for this visit, but could not be saved.
            <button className="empty-cta" onClick={retryPersistence}>Try saving again</button>
          </div>
        )}
        {upcomingDays.length > 0 && (
          <>
            <div className="pf-hist-label">Coming up</div>
            {upcomingDays.map((day) => (
              <button
                className="pf-dayh pf-dayh-tap"
                key={day.dayTs}
                onClick={() => openDay(day.dayTs)}
              >
                <span className="pf-dayh-date">
                  <Icon.calendar className="meta-ic" aria-hidden /> {fmtShort(day.dayTs)}
                </span>
                <span className="pf-dayh-what">
                  {day.state === 'rest'
                    ? <>Quiet day <Icon.moon className="meta-ic" aria-hidden /></>
                    : dayPlanText(day)}
                </span>
              </button>
            ))}
          </>
        )}
        {!plannerPending && !plannerUnavailable && !hasAnything && (
          <div className="pf-empty">No plans yet — start one from the Plan tab.</div>
        )}

        {/* Plans → Reality — this month's planned vs follow-through (zero-is-silence) */}
        {monthReality.planned > 0 && (
          <div className="pf-reality">
            <span className="pf-reality-n">{monthReality.planned}</span> planned in {monthName} ·{' '}
            <span className="pf-reality-n pf-reality-went">{monthReality.went}</span> you made it to
          </div>
        )}

        {/* the gentle ledger: days-out this month, rhythm, variety firsts
            (WS3 §9: ledger row icons ride the engineered Icon family now —
            the identity emoji on .pf-first variety stamps stay by contract) */}
        {daysOut > 0 && (
          <div className="pf-ledger-line">
            <Icon.calendar className="meta-ic" aria-hidden />{' '}
            {daysOut === 1 ? `1 day out in ${monthName} so far` : `${daysOut} days out in ${monthName} so far`}
          </div>
        )}
        {(rhythm.current >= 1 || rhythm.best >= 2) && (
          <div className="pf-rhythm">
            {rhythm.current >= 1 ? (
              <>
                <Icon.hot className="meta-ic" aria-hidden /> {rhythm.current}-day rhythm
                {rhythm.best > rhythm.current ? ` · best ${rhythm.best}` : ''}
              </>
            ) : (
              `Best rhythm: ${rhythm.best} days`
            )}
          </div>
        )}
        {firsts.length > 0 && (
          <div className="pf-firsts">
            {firsts.map((f) => (
              <span className="pf-first" key={f.id}>
                <span aria-hidden>{f.emoji}</span> {f.label}
              </span>
            ))}
          </div>
        )}

        {/* Past days journal — each day TAPPABLE → its DayPage */}
        {dayHist.length > 0 && (
          <>
            <div className="pf-hist-label">Past days</div>
            {dayHist.map((h) => {
              const went = dids.has(h.dayTs)
              return (
                <button
                  className={'pf-dayh pf-dayh-tap' + (went ? ' pf-dayh-went' : '')}
                  key={h.dayTs}
                  onClick={() => openDay(h.dayTs)}
                >
                  <span className="pf-dayh-date"><Icon.calendar className="meta-ic" aria-hidden /> {fmtShort(h.dayTs)}</span>
                  <span className="pf-dayh-what">
                    {h.state === 'rest'
                      ? <>Rested <Icon.moon className="meta-ic" aria-hidden /></>
                      : dayPlanText(h)}
                  </span>
                  {went && h.state !== 'rest' && <span className="pf-dayh-went-tag">✓ Went</span>}
                </button>
              )
            })}
          </>
        )}

        {/* "Did you make it?" prompts for passed saves */}
        {prompts.length > 0 && (
          <div className="pf-asks">
            {prompts.map(({ key, e, snapshot, target }) => (
              <div key={key} className="pf-ask">
                <div className="pf-ask-main">
                  <div className="pf-ask-q">Did you make it?</div>
                  <div className="pf-ask-title">{e.title}</div>
                  <div className="pf-ask-meta">{[dayLoose(e), e.venue].filter(Boolean).join(' · ')}</div>
                  <SponsoredTag e={e} />
                </div>
                <div className="pf-ask-btns">
                  <button
                    className="pf-ask-yes"
                    onClick={async () => { await answerBeen(target, key, snapshot, 'went', Date.now()) }}
                    disabled={!savedBeenReady || pendingBeenKeys.has(key)}
                    aria-busy={pendingBeenKeys.has(key) || undefined}
                  >
                    {/* WS3 §9: engineered burst, not 🎉 (white on --cta, D.0-R safe) */}
                    <Icon.burst className="btn-ic" aria-hidden /> I went
                  </button>
                  <button
                    className="pf-ask-no"
                    onClick={async () => { await answerBeen(target, key, snapshot, 'missed', Date.now()) }}
                    disabled={!savedBeenReady || pendingBeenKeys.has(key)}
                    aria-busy={pendingBeenKeys.has(key) || undefined}
                  >
                    Missed it
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* the self-reported went-list */}
        {wentList.length > 0 && (
          <>
            <div className="pf-hist-label">Been there</div>
            <div className="pf-rows">
              {wentList.map(({ key, e }) => (
                <div key={key} className="pf-item">
                  <GemRow e={e} onSelect={onSelect} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
