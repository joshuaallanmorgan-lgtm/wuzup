// CalendarView — List | Month segmented calendar with heat-shaded month grid.
// Detail-open + Weekend-Builder entry come from useNav() (O6). Sprint U-a:
// tapping a day (rail pill or today-or-later month cell) opens the DAY SCREEN
// for it — the day screen carries the agenda, so browse stays whole; the
// selected-day list below the grid still tracks the tap underneath.
import { useMemo, useState } from 'react'
import { keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { EventCard } from './cards.jsx'
import { useSaves } from './saves.js'
import { dateKey, wxSummary } from './weather.js'
import { hasContent, loadDayPlans } from './dayplan.js'
import './calendar.css'

export default function CalendarView({ events, anchors, wx }) {
  const { openDetail: onSelect, openWeekend: onOpenWeekend, openDay, page } = useNav()
  const [mode, setMode] = useState('list')
  const [selKey, setSelKey] = useState(null) // day timestamp; persists across List/Month toggle
  const [monthOff, setMonthOff] = useState(0)

  // 16-day Tampa forecast: { 'YYYY-MM-DD': {emoji,hi,rain} } | null (graceful
  // no-weather). App owns the single getForecast() fetch and passes it down.
  const wxFor = (ts) => (wx ? wx[dateKey(ts)] : null)

  // Day buckets, clamped to today: an in-progress multi-day event surfaces
  // under TODAY (not its stale start day), fully-ended events drop (so the day
  // rail starts at today — no past pills), and every event lands on exactly ONE
  // day (full multi-day spanning = parked owner decision). Month-grid heat and
  // the day lists read these same buckets, so counts stay consistent.
  const dayMap = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      if (e._day == null) continue
      if ((e._endDay ?? e._day) < anchors.todayTs) continue // already over
      const day = Math.max(e._day, anchors.todayTs)
      if (!m.has(day)) m.set(day, [])
      m.get(day).push(e)
    }
    for (const list of m.values()) list.sort((a, b) => a._t - b._t)
    return m
  }, [events, anchors])
  const days = useMemo(() => [...dayMap.keys()].sort((a, b) => a - b), [dayMap])

  // ♥ saves: days containing ≥1 saved event get the reserved 4px dot
  // (UI_SPEC §4 kept dots free for exactly this); live across toggles
  const { ids: savedIds } = useSaves()
  const savedDays = useMemo(() => {
    const s = new Set()
    for (const [d, list] of dayMap) if (list.some((e) => savedIds.has(keyOf(e)))) s.add(d)
    return s
  }, [dayMap, savedIds])

  // U-a (⚑U-GRID): the day-plan store, for the grid's ONE quiet personal
  // mark. localStorage isn't reactive — plans only change inside the day/WB
  // subpages, so re-reading on every subpage open/close edge (`page` flips
  // null ↔ object) keeps the marks honest; the read is one small JSON parse.
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
  const sel = selKey ?? days.find((d) => d >= anchors.todayTs) ?? days[0] ?? anchors.todayTs
  const selEvents = dayMap.get(sel) || []

  // p90 of per-day counts drives the heat shading scale
  const p90 = useMemo(() => {
    const counts = days.map((d) => dayMap.get(d).length).sort((a, b) => a - b)
    return counts.length ? Math.max(counts[Math.floor(0.9 * (counts.length - 1))], 1) : 1
  }, [days, dayMap])
  // K1 "hot day" affordance: days with count >= p90 wear a subtle coral ring
  // (heat semantics — the ONLY coral here besides the grid heat shading).
  // Gated off for tiny/flat datasets where the percentile is meaningless
  // (under 8 days, or p90 of 1 → every day would ring = coral flood).
  const hotDays = useMemo(() => {
    if (days.length < 8 || p90 <= 1) return new Set()
    return new Set(days.filter((d) => dayMap.get(d).length >= p90))
  }, [days, dayMap, p90])

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
          {/* K2 seam: second Weekend Builder entry (covers the no-saves path) */}
          {onOpenWeekend && (
            <button className="cal-wkb" onClick={onOpenWeekend}>
              Weekend 🗓️
            </button>
          )}
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
                <button
                  key={d}
                  className={'date-pill' + (d === sel ? ' active' : '') + (hotDays.has(d) ? ' hot' : '')}
                  onClick={() => {
                    setSelKey(d) // browse state tracks the tap…
                    openDay(d) // …and the day screen opens over it (U-a)
                  }}
                >
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
              {/* clamp at the current month: every past month is all-empty cells
                  (day buckets clamp to today), so navigating back is a dead end */}
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
              const count = dayMap.get(ts)?.length || 0
              // hot tint at min(count/p90,1)*0.20, quantized to 4 buckets (heat stays warm)
              const heat = count ? (Math.ceil(Math.min(count / p90, 1) * 4) / 4) * 0.2 : 0
              const w = wxFor(ts)
              return (
                <button
                  key={ts}
                  className={
                    'mcell' +
                    (ts === sel ? ' sel' : '') +
                    (ts === anchors.todayTs ? ' today' : '') +
                    (hotDays.has(ts) ? ' hot' : '')
                  }
                  style={{ '--heat': heat }}
                  onClick={() => {
                    setSelKey(ts) // browse state tracks the tap…
                    // …and today-or-later cells open the day screen (U-a).
                    // Past cells stay browse-only: personal past days are
                    // Sprint U-d's journal, not a planning surface.
                    if (ts >= anchors.todayTs) openDay(ts)
                  }}
                >
                  <span className="mcell-bg" />
                  {savedDays.has(ts) && <span className="save-dot" />}
                  <span className="mnum">{new Date(ts).getDate()}</span>
                  {/* U-a ⚑U-GRID: the ONE quiet personal mark — a teal
                      underline tucked under the digit for planned days, a
                      muted crescent for rest days. Mutually exclusive by the
                      store's own rule; never rendered on unplanned days. */}
                  {plannedDays.has(ts) && <span className="mday-plan" />}
                  {restDays.has(ts) && <span className="mday-rest" />}
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
