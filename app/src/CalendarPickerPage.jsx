// CalendarPickerPage — Plan Phase 2 (ref-plan-flows-1 p1-2). The DayPage
// day-selector's destination: a "Pick a date" quick list (Today + the next
// days) and a "Full calendar" month grid. Selecting a date opens that day's
// screen — openDay REPLACES this page (the single-slot subpage union), so the
// picker is a clean one-level-deep hop. Additive + today-or-later only (no
// planning the past, the Calendar rule). The grid math mirrors CalendarView's.
// ALL COPY IS DRAFT for Charles.
import { useMemo, useState } from 'react'
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import './calpicker.css'

const wdShort = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'short' })
const monthDayOf = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// a small calendar glyph for the quick-list rows (matches the day-selector icon)
const CalGlyph = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
    <rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M3 9.5h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

export default function CalendarPickerPage({ ts, anchors }) {
  const { openDay, closePage } = useNav()
  const [showGrid, setShowGrid] = useState(false)
  const [monthOff, setMonthOff] = useState(0)
  const cur = typeof ts === 'number' && Number.isFinite(ts) ? ts : anchors.todayTs

  // quick list: today + the next 6 days, relative labels, today-or-later
  const quick = useMemo(() => {
    const d0 = new Date(anchors.todayTs)
    return [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const t = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime()
      const rel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : wdShort(t)
      return { ts: t, label: `${rel}, ${monthDayOf(t)}` }
    })
  }, [anchors])

  // the displayed month (clamped at the current month — no planning the past)
  const month = useMemo(() => {
    const base = new Date(anchors.todayTs)
    return new Date(base.getFullYear(), base.getMonth() + monthOff, 1)
  }, [anchors, monthOff])
  const cells = useMemo(() => {
    const firstDow = month.getDay()
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const out = []
    for (let i = 0; i < firstDow; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d).getTime())
    return out
  }, [month])
  const monthLabel = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const pick = (t) => {
    if (t >= anchors.todayTs) openDay(t) // openDay replaces this page (single-slot union)
  }

  return (
    <div className="pg calpick">
      <header className="pg-head">
        <button className="pg-back" onClick={closePage} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Pick a date</h1>
      </header>
      <div className="pg-body calpick-body">
        {showGrid && (
          <div className="calpick-grid-wrap">
            <div className="calpick-monthbar">
              <button
                className="calpick-mnav pressable"
                onClick={() => setMonthOff((m) => Math.max(0, m - 1))}
                disabled={monthOff === 0}
                aria-label="Previous month"
              >
                ‹
              </button>
              <span className="calpick-monthlabel">{monthLabel}</span>
              <button className="calpick-mnav pressable" onClick={() => setMonthOff((m) => m + 1)} aria-label="Next month">
                ›
              </button>
            </div>
            <div className="calpick-dow">
              {DOW.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="calpick-grid">
              {cells.map((t, i) =>
                t == null ? (
                  <span className="calpick-cell is-empty" key={'e' + i} />
                ) : (
                  <button
                    key={t}
                    className={
                      'calpick-cell pressable' +
                      (t < anchors.todayTs ? ' is-past' : '') +
                      (t === anchors.todayTs ? ' is-today' : '') +
                      (t === cur ? ' is-cur' : '')
                    }
                    disabled={t < anchors.todayTs}
                    onClick={() => pick(t)}
                    aria-current={t === cur ? 'date' : undefined}
                  >
                    {new Date(t).getDate()}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        <div className="calpick-list">
          {showGrid && <div className="calpick-listhead">Upcoming days</div>}
          {quick.map((d) => (
            <button
              key={d.ts}
              className={'calpick-row pressable' + (d.ts === cur ? ' is-cur' : '')}
              onClick={() => pick(d.ts)}
              aria-current={d.ts === cur ? 'date' : undefined}
            >
              <span className="calpick-row-ic" aria-hidden>
                <CalGlyph />
              </span>
              <span className="calpick-row-label">{d.label}</span>
            </button>
          ))}
          {!showGrid && (
            <button className="calpick-row calpick-full pressable" onClick={() => setShowGrid(true)}>
              <span className="calpick-row-ic" aria-hidden>
                <CalGlyph />
              </span>
              <span className="calpick-row-label">Full calendar</span>
              <span className="calpick-row-chev" aria-hidden>
                <Icon.chevron />
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
