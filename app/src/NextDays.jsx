// NextDays — the three-day planning-card stack shared by Home and Calendar.
// Forecast copy comes from the live weather model; plan state comes from the
// reactive V2 planner provider, so returning from a day screen needs no storage
// reread or host revision tick.
import { useMemo } from 'react'
import { addDayTs, formatDayTs, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { usePlanner } from './PlannerProvider.jsx'
import { dateKey, CONDITION, WX_GLYPH } from './weather.js'
import { wxMood } from './weekend.js'
import './nextdays.css'

const weekday = (ts) => formatDayTs(ts, { weekday: 'long' })

export default function NextDays({ anchors, wx }) {
  const { openDay } = useNav()
  const { status, getDay } = usePlanner()
  const plannerReady = status === 'durable' || status === 'session-only'
  const plannerPending = status === 'idle' || status === 'initializing'
  const days = useMemo(() => {
    return [0, 1, 2].map((i) => {
      const ts = addDayTs(anchors.todayTs, i)
      return { ts, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday(ts) }
    })
  }, [anchors.todayTs])

  return (
    <div className="nextdays">
      {days.map((d) => {
        const w = wx ? wx[dateKey(d.ts)] : null
        const day = getDay(d.ts)
        const rest = day.state === 'rest'
        const n = day.slots.length
        const planned = n > 0 && !rest
        const mood = wxMood(w)
        const wxTxt = w ? (CONDITION[w.emoji] || 'Forecast') + (w.hi != null ? ' · ' + w.hi + '°' : '') : null
        const planTxt = !plannerReady
          ? plannerPending ? 'Loading plans' : 'Plans unavailable'
          : rest
            ? 'Quiet day'
            : planned
              ? `${n} planned`
              : mood === 'clear'
                ? 'Good day to get out'
                : mood === 'rainy'
                  ? 'Rainy-day ideas'
                  : 'No plan yet'
        const sub = [wxTxt, planTxt].filter(Boolean).join(' · ')
        const cta = plannerReady && !planned && !rest
          ? (d.label === 'Today' ? 'Build today' : 'Plan ' + d.label)
          : null
        return (
          <button key={d.ts} className="nd-card pressable" onClick={() => openDay(d.ts)}>
            <span className={'nd-wx nd-wx--' + (WX_GLYPH[w?.emoji]?.k || 'none')} aria-hidden>
              {WX_GLYPH[w?.emoji] ? WX_GLYPH[w.emoji].Ic() : <Icon.calendar />}
            </span>
            <span className="nd-main">
              <span className="nd-day">{d.label}</span>
              <span className="nd-sub">{sub}</span>
            </span>
            {cta ? (
              <span className={d.label === 'Today' ? 'nd-cta' : 'nd-cta-outline'}>{cta}</span>
            ) : (
              <span className="nd-chev" aria-hidden>
                <Icon.chevron />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
