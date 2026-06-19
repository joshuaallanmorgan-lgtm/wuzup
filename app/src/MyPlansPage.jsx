// MyPlansPage — the Profile "My plans" drill-in (Stage R Profile rework). The
// old Profile "Your days" + "Been there" content relocated here, intact:
//   · Plans → Reality (this month's planned-vs-went, zero-is-silence)
//   · Past days journal (day-history-v1) — each day TAPPABLE → openDay(ts)
//   · the gentle ledger (days-out this month, rhythm/streak, variety firsts)
//   · "Did you make it?" prompts for passed saves + the self-reported went-list
// All from REAL local stores (dayplan.js / saves.js / gamify.js); every empty
// state is honest. Opened via nav.openMyPlans ({type:'myplans'}); reads fresh on
// mount so counts stay live; each openDay replaces this subpage (single-slot),
// back → the Profile tab. DRAFT copy — ⚑ Charles.
import { useMemo } from 'react'
import { Icon, dayLoose, keyOf, normalize, rawOf } from './lib.js'
import { useNav } from './nav.jsx'
import { GemRow, SponsoredTag } from './cards.jsx'
import { markBeen, shelfItems, useBeenThere, useSaves } from './saves.js'
import { restDayList, rhythmSummary } from './gamify.js'
import {
  PARTS,
  dayEntryFor,
  daysOutInMonth,
  didDays,
  loadDayHistory,
  loadDayPlans,
  monthReality as computeMonthReality,
  varietyFirsts,
} from './dayplan.js'
import { usePlaces, isPlaceKey } from './places.js'
import './profile.css'

const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function MyPlansPage({ events, anchors }) {
  const { closePage: onClose, openDetail: onSelect, openDay } = useNav()
  const { list: savedList } = useSaves()
  const been = useBeenThere()

  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of events) m.set(keyOf(e), e)
    return m
  }, [events])
  const savedByKey = useMemo(() => new Map(savedList.map((s) => [s.key, s])), [savedList])

  // current plans + past-days journal (read fresh on mount; localStorage isn't
  // reactive but this subpage remounts each open, and openDay replaces it)
  const dayPlans = useMemo(() => loadDayPlans(anchors), [anchors])
  const dayHist = useMemo(() => loadDayHistory().reverse().slice(0, 10), [])
  const shelf = useMemo(() => shelfItems(savedList, events, anchors), [savedList, events, anchors])

  // honest scoped count: distinct days with a filled slot (current + ALL history).
  // Counts the FULL loadDayHistory() — NOT the 10-row `dayHist` slice (which is for
  // rendering only) — so the badge never undercounts a power user's real total.
  const plansCount = useMemo(() => {
    let n = 0
    for (const k of Object.keys(dayPlans)) {
      const e = dayEntryFor(dayPlans[k])
      if (e && (e.slots.day || e.slots.night)) n++
    }
    for (const h of loadDayHistory()) if (h?.slots && (h.slots.day || h.slots.night)) n++
    return n
  }, [dayPlans])

  // a slot can hold a PLACE ('p|') key — fold the lazy places in so the journal
  // resolves their titles (the ~1.2MB fetch fires ONLY when a place key exists)
  const hasPlaceKey = useMemo(() => {
    for (const k of Object.keys(dayPlans)) {
      const e = dayEntryFor(dayPlans[k])
      if (e && PARTS.some((p) => isPlaceKey(e.slots[p]))) return true
    }
    for (const h of dayHist) if (PARTS.some((p) => isPlaceKey(h.slots[p]))) return true
    return false
  }, [dayPlans, dayHist])
  const { places: placeList } = usePlaces(hasPlaceKey)
  const titleByKey = useMemo(() => {
    const m = new Map()
    for (const b of been) if (b.snapshot?.title) m.set(b.key, b.snapshot.title)
    for (const s of savedList) if (s.snapshot?.title) m.set(s.key, s.snapshot.title)
    for (const e of events) m.set(keyOf(e), e.title)
    if (Array.isArray(placeList)) for (const p of placeList) m.set(p.key, p.title)
    return m
  }, [been, savedList, events, placeList])

  // gentle ledger (all derived, never new stores)
  const dids = useMemo(() => didDays(been), [been])
  const monthStart = useMemo(() => {
    const d = new Date(anchors.todayTs)
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }, [anchors.todayTs])
  const nextMonthStart = useMemo(() => {
    const d = new Date(monthStart)
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  }, [monthStart])
  const daysOut = daysOutInMonth(dids, monthStart, nextMonthStart)
  const monthName = new Date(anchors.todayTs).toLocaleDateString('en-US', { month: 'long' })
  const firsts = useMemo(() => varietyFirsts(been), [been])
  const monthReality = useMemo(
    () => computeMonthReality(loadDayHistory(), dids, monthStart, nextMonthStart),
    [monthStart, nextMonthStart, dids]
  )
  const rhythm = useMemo(
    () => rhythmSummary(dids, restDayList(loadDayPlans(anchors), loadDayHistory()), anchors),
    [dids, anchors]
  )

  // Been there: unanswered "did you make it?" prompts + the went-list
  const answered = useMemo(() => new Set(been.filter((b) => b.status).map((b) => b.key)), [been])
  const prompts = useMemo(() => {
    const out = []
    const seen = new Set()
    for (const { e, past } of shelf) {
      if (!past) continue
      const k = keyOf(e)
      if (answered.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push({ key: k, e, snapshot: savedByKey.get(k)?.snapshot ?? rawOf(e) })
    }
    for (const b of been) {
      if (b.status || !b.snapshot || answered.has(b.key) || seen.has(b.key)) continue
      seen.add(b.key)
      out.push({ key: b.key, e: normalize({ ...b.snapshot }, anchors), snapshot: b.snapshot })
    }
    return out
  }, [shelf, been, answered, savedByKey, anchors])
  const wentList = useMemo(
    () =>
      been
        .filter((b) => b.status === 'went')
        .sort((a, b) => (b.statusAt || 0) - (a.statusAt || 0))
        .map((b) => ({ key: b.key, e: byKey.get(b.key) ?? (b.snapshot ? normalize({ ...b.snapshot }, anchors) : null) }))
        .filter((x) => x.e),
    [been, byKey, anchors]
  )

  const hasAnything = plansCount > 0 || dayHist.length > 0 || wentList.length > 0 || prompts.length > 0

  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">
          My plans{plansCount > 0 && <span className="shelf-count">{plansCount}</span>}
        </h1>
      </header>
      <div className="pg-body">
        {!hasAnything && (
          <div className="pf-empty">No plans yet — start one from the Calendar tab.</div>
        )}

        {/* Plans → Reality — this month's planned vs follow-through (zero-is-silence) */}
        {monthReality.planned > 0 && (
          <div className="pf-reality">
            <span className="pf-reality-n">{monthReality.planned}</span> planned in {monthName} ·{' '}
            <span className="pf-reality-n pf-reality-went">{monthReality.went}</span> you made it to
          </div>
        )}

        {/* the gentle ledger: days-out this month, rhythm, variety firsts */}
        {daysOut > 0 && (
          <div className="pf-ledger-line">
            {daysOut === 1 ? `1 day out in ${monthName} so far 🗓️` : `${daysOut} days out in ${monthName} so far 🗓️`}
          </div>
        )}
        {(rhythm.current >= 1 || rhythm.best >= 2) && (
          <div className="pf-rhythm">
            {rhythm.current >= 1 ? (
              <>
                <span aria-hidden>🔥</span> {rhythm.current}-day rhythm
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
                  <span className="pf-dayh-date">🗓️ {fmtShort(h.dayTs)}</span>
                  <span className="pf-dayh-what">
                    {h.state === 'rest'
                      ? 'Rested 🌙'
                      : PARTS.filter((p) => h.slots[p])
                          .map((p) => (p === 'day' ? '☀️ ' : '🌙 ') + (titleByKey.get(h.slots[p]) ?? 'no longer listed'))
                          .join(' · ')}
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
            {prompts.map(({ key, e, snapshot }) => (
              <div key={key} className="pf-ask">
                <div className="pf-ask-main">
                  <div className="pf-ask-q">Did you make it?</div>
                  <div className="pf-ask-title">{e.title}</div>
                  <div className="pf-ask-meta">{[dayLoose(e), e.venue].filter(Boolean).join(' · ')}</div>
                  <SponsoredTag e={e} />
                </div>
                <div className="pf-ask-btns">
                  <button className="pf-ask-yes" onClick={() => markBeen(key, snapshot, 'went')}>
                    I went 🎉
                  </button>
                  <button className="pf-ask-no" onClick={() => markBeen(key, snapshot, 'missed')}>
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
