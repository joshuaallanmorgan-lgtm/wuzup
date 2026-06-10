// CalendarView — List | Month segmented calendar with heat-shaded month grid.
import { useMemo, useState } from 'react'
import { keyOf } from './lib.js'
import { EventCard } from './cards.jsx'
import { useSaves } from './saves.js'
import { dateKey, CONDITION } from './weather.js'
import './calendar.css'

// "🌧️ Showers likely · high 93° · 47% rain" — null when no forecast for the day
function wxSummary(w) {
  if (!w) return null
  const parts = [w.emoji + ' ' + (CONDITION[w.emoji] || 'Forecast')]
  if (w.hi != null) parts.push('high ' + w.hi + '°')
  if (w.rain != null) parts.push(w.rain + '% rain')
  return parts.join(' · ')
}

export default function CalendarView({ events, anchors, onSelect, wx }) {
  const [mode, setMode] = useState('list')
  const [selKey, setSelKey] = useState(null) // day timestamp; persists across List/Month toggle
  const [monthOff, setMonthOff] = useState(0)

  // 16-day Tampa forecast: { 'YYYY-MM-DD': {emoji,hi,rain} } | null (graceful
  // no-weather). App owns the single getForecast() fetch and passes it down.
  const wxFor = (ts) => (wx ? wx[dateKey(ts)] : null)

  const dayMap = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      if (e._day == null) continue
      if (!m.has(e._day)) m.set(e._day, [])
      m.get(e._day).push(e)
    }
    for (const list of m.values()) list.sort((a, b) => a._t - b._t)
    return m
  }, [events])
  const days = useMemo(() => [...dayMap.keys()].sort((a, b) => a - b), [dayMap])

  // ♥ saves: days containing ≥1 saved event get the reserved 4px dot
  // (UI_SPEC §4 kept dots free for exactly this); live across toggles
  const { ids: savedIds } = useSaves()
  const savedDays = useMemo(() => {
    const s = new Set()
    for (const [d, list] of dayMap) if (list.some((e) => savedIds.has(keyOf(e)))) s.add(d)
    return s
  }, [dayMap, savedIds])
  const sel = selKey ?? days.find((d) => d >= anchors.todayTs) ?? days[0] ?? anchors.todayTs
  const selEvents = dayMap.get(sel) || []

  // p90 of per-day counts drives the heat shading scale
  const p90 = useMemo(() => {
    const counts = days.map((d) => dayMap.get(d).length).sort((a, b) => a - b)
    return counts.length ? Math.max(counts[Math.floor(0.9 * (counts.length - 1))], 1) : 1
  }, [days, dayMap])

  const base = new Date(anchors.todayTs)
  const month = new Date(base.getFullYear(), base.getMonth() + monthOff, 1)
  const monthTitle = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const firstDow = month.getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d).getTime())

  const selTitle = new Date(sel).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const selWxLine = wxSummary(wxFor(sel)) // null beyond the 16-day forecast → line not rendered

  return (
    <div className="cal-wrap">
      <div className="cal-top">
        <div className="cal-top-row">
          <h2 className="cal-title">Calendar</h2>
          <div className="seg">
            <div className={'seg-thumb' + (mode === 'month' ? ' right' : '')} />
            <button className={'seg-btn' + (mode === 'list' ? ' on' : '')} onClick={() => setMode('list')}>
              List
            </button>
            <button className={'seg-btn' + (mode === 'month' ? ' on' : '')} onClick={() => setMode('month')}>
              Month
            </button>
          </div>
        </div>
        {mode === 'list' && (
          <div className="date-rail">
            {days.map((d) => {
              const dd = new Date(d)
              const w = wxFor(d)
              return (
                <button key={d} className={'date-pill' + (d === sel ? ' active' : '')} onClick={() => setSelKey(d)}>
                  {savedDays.has(d) && <span className="save-dot" />}
                  <span className="dp-dow">{dd.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className="dp-num">{dd.getDate()}</span>
                  {w && (
                    <span className="dp-wx">
                      {w.emoji}
                      {w.rain != null && w.rain >= 30 && <span className="dp-rain">{w.rain}%</span>}
                    </span>
                  )}
                  <span className="dp-count">{dayMap.get(d).length}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {mode === 'month' ? (
        <div className="cal-fade" key="month">
          <div className="mon-head">
            <h3 className="mon-title">{monthTitle}</h3>
            <div className="mon-navs">
              <button className="mon-nav" onClick={() => setMonthOff((o) => o - 1)} aria-label="Previous month">
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
              const count = dayMap.get(ts)?.length || 0
              // hot tint at min(count/p90,1)*0.20, quantized to 4 buckets (heat stays warm)
              const heat = count ? (Math.ceil(Math.min(count / p90, 1) * 4) / 4) * 0.2 : 0
              const w = wxFor(ts)
              return (
                <button
                  key={ts}
                  className={'mcell' + (ts === sel ? ' sel' : '') + (ts === anchors.todayTs ? ' today' : '')}
                  style={{ '--heat': heat }}
                  onClick={() => setSelKey(ts)}
                >
                  <span className="mcell-bg" />
                  {savedDays.has(ts) && <span className="save-dot" />}
                  <span className="mnum">{new Date(ts).getDate()}</span>
                  {w && <span className="mwx">{w.emoji}</span>}
                </button>
              )
            })}
          </div>
          <h3 className="day-header cal-day">
            {selTitle}
            {selEvents.length ? ` · ${selEvents.length} event${selEvents.length > 1 ? 's' : ''}` : ''}
          </h3>
          {selWxLine && <div className="cal-wx">{selWxLine}</div>}
          <div className="cal-list">
            {selEvents.length ? (
              selEvents.map((e, i) => <EventCard key={keyOf(e) + i} e={e} index={i} onSelect={onSelect} />)
            ) : (
              <div className="empty empty-sm">Nothing scheduled. A rare night off 🌙</div>
            )}
          </div>
        </div>
      ) : (
        <div className="cal-fade" key="list">
          {days.length ? (
            <>
              <h3 className="day-header cal-day">{selTitle}</h3>
              {selWxLine && <div className="cal-wx">{selWxLine}</div>}
              <div className="cal-list">
                {selEvents.length ? (
                  selEvents.map((e, i) => <EventCard key={keyOf(e) + i} e={e} index={i} onSelect={onSelect} />)
                ) : (
                  <div className="empty empty-sm">Nothing scheduled. A rare night off 🌙</div>
                )}
              </div>
            </>
          ) : (
            <div className="empty">No upcoming events found.</div>
          )}
        </div>
      )}
    </div>
  )
}
