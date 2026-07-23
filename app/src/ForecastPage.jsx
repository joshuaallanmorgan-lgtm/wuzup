// ForecastPage — HOME_PHASE2 + TOUCHUP P2: the full 7-day forecast, reached from
// HomeView's "View full forecast →" link. Renders ONLY real wx data from the
// 16-day daily fetch (wx[dateKey(ts)] = {emoji, hi, lo, rain}): a today hero, a
// 7-day list with hi/lo + rain, and an honest "best day to get outside" callout.
// No hourly strip — the forecast feed is daily-only, and we never fabricate data.
// No forecast at all = honest empty state.
import { useMemo } from 'react'
import { addDayTs, CITY, formatDayTs, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { CONDITION, dateKey } from './weather.js'
import './forecast.css'

const fmtDate = (ts) => formatDayTs(ts, { weekday: 'long', month: 'short', day: 'numeric' })

// outdoor-friendliness rank per condition emoji (higher = better day to be outside)
const OUTDOOR_RANK = { '☀️': 6, '⛅': 5, '☁️': 4, '🌫️': 3, '🌦️': 2, '🌧️': 1, '❄️': 1, '⛈️': 0 }

export default function ForecastPage({ anchors, wx }) {
  const { closePage } = useNav()

  const days = useMemo(() => {
    const out = []
    for (let i = 0; i < 7; i++) {
      const ts = addDayTs(anchors.todayTs, i)
      const w = wx ? wx[dateKey(ts)] : null
      if (!w) continue
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(ts)
      out.push({ ts, label, w, isToday: i === 0 })
    }
    return out
  }, [anchors, wx])

  const today = days.find((day) => day.isToday)?.w || null

  // honest "best day to get outside": the next-7 day with the best outdoor rank,
  // ties broken by lowest rain. Only surfaced when a genuinely nice day exists
  // (rank ≥ 5 = sunny/partly-cloudy AND rain ≤ 40) — never an invented silver lining.
  const bestDay = useMemo(() => {
    let best = null
    for (const d of days) {
      const rank = OUTDOOR_RANK[d.w.emoji] ?? 0
      const rain = d.w.rain ?? 0
      const score = rank * 100 - rain
      if (!best || score > best.score) best = { ...d, score, rank, rain }
    }
    return best && best.rank >= 5 && best.rain <= 40 ? best : null
  }, [days])

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
          <>
            {/* Today hero — high temp + condition side by side, with H/L + precip
                underneath. Daily-fetch data only (no current/feels-like temp). */}
            {today && (
              <>
                <div className="fc-loc">
                  <Icon.locations className="fc-loc-pin" aria-hidden />
                  <span>{CITY.name}</span>
                </div>
                <div className="fc-hero">
                  <span className="fc-hero-emoji" aria-hidden>{today.emoji}</span>
                  <div className="fc-hero-main">
                    <div className="fc-hero-top">
                      <span className="fc-hero-temp">{today.hi != null ? today.hi + '°' : '—'}</span>
                      <span className="fc-hero-cond">{CONDITION[today.emoji] || 'Forecast'}</span>
                    </div>
                    <div className="fc-hero-sub">
                      {today.hi != null && <span>H: {today.hi}°</span>}
                      {today.lo != null && <span>L: {today.lo}°</span>}
                      {today.rain != null && <span>Precip {today.rain}%</span>}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Honest best-day-to-get-outside callout (omitted when no nice day) */}
            {bestDay && (
              <div className="fc-best">
                <span className="fc-best-icon" aria-hidden>🌤️</span>
                <div className="fc-best-txt">
                  <div className="fc-best-title">Best day to get outside</div>
                  <div className="fc-best-sub">
                    {bestDay.label} · {CONDITION[bestDay.w.emoji] || 'Clear'}
                    {bestDay.w.hi != null ? ' · ' + bestDay.w.hi + '°' : ''}
                  </div>
                </div>
              </div>
            )}

            {/* 7-day list */}
            <div className="fc-list-head">7-day forecast</div>
            {days.map(({ ts, label, w, isToday }) => (
              <div key={ts} className={'fc-row' + (isToday ? ' fc-row-today' : '')}>
                <span className="fc-emoji" aria-hidden>{w.emoji}</span>
                <span className="fc-info">
                  <span className="fc-label">{label}</span>
                  <span className="fc-cond">
                    {CONDITION[w.emoji] || ''}
                    {w.rain != null && w.rain >= 20 ? ` · ${w.rain}% rain` : ''}
                  </span>
                </span>
                <span className="fc-temps">
                  {w.hi != null && <span className="fc-hi">{w.hi}°</span>}
                  {w.lo != null && <span className="fc-lo">{w.lo}°</span>}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
