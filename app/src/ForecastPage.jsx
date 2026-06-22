// ForecastPage — HOME_PHASE2: the full 7-day forecast view, reached from
// HomeView's "View full forecast →" link. Shows real wx data from the 16-day
// fetch (wx[dateKey(ts)] = {emoji, hi, rain}). No forecast = honest empty state.
import { useMemo } from 'react'
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { CONDITION, dateKey } from './weather.js'
import './forecast.css'

const DAY_MS = 86400000
const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

export default function ForecastPage({ anchors, wx }) {
  const { closePage } = useNav()

  const days = useMemo(() => {
    const out = []
    for (let i = 0; i < 7; i++) {
      const ts = anchors.todayTs + i * DAY_MS
      const w = wx ? wx[dateKey(ts)] : null
      if (!w) continue
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(ts)
      out.push({ ts, label, w, isToday: i === 0 })
    }
    return out
  }, [anchors, wx])

  return (
    <div className="pg fc-pg">
      <header className="pg-head">
        <button className="pg-back" onClick={closePage} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Forecast</h1>
      </header>
      <div className="pg-body">
        {days.length === 0 ? (
          <div className="pf-empty">No forecast available right now.</div>
        ) : (
          days.map(({ ts, label, w, isToday }) => (
            <div key={ts} className={'fc-row' + (isToday ? ' fc-row-today' : '')}>
              <span className="fc-emoji" aria-hidden>
                {w.emoji}
              </span>
              <span className="fc-info">
                <span className="fc-label">{label}</span>
                <span className="fc-cond">{CONDITION[w.emoji] || ''}</span>
              </span>
              {w.hi != null && <span className="fc-hi">{w.hi}°</span>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
