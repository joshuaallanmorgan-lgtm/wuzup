// NextDays — 3.7P-23b: the "Your next days" planning-card stack (§N screen 1, the
// headline Home element). Today + the next two days, each a tappable card showing
// the real forecast, the honest plan-state, and a planner CTA. Tapping opens that
// DayPage (the Discover→Plan bridge). Built from EXISTING signal only — wx (the
// 16-day forecast) + the day-plan store — so every line is true (no fabricated
// "ideas"). Reused on Calendar by P40 later.
import { useMemo } from 'react'
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { loadDayPlans, dayEntryFor, hasContent, emptyDay } from './dayplan.js'
import { dateKey, CONDITION } from './weather.js'
import { wxMood } from './weekend.js'
import './nextdays.css'

const weekday = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })

export default function NextDays({ anchors, wx }) {
  const { openDay, page } = useNav()
  const days = useMemo(() => {
    const d0 = new Date(anchors.todayTs)
    return [0, 1, 2].map((i) => {
      const ts = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime()
      return { ts, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday(ts) }
    })
  }, [anchors])
  // localStorage isn't reactive; re-read on the subpage edge (page flips null↔obj)
  // so a slot planned on a DayPage shows here on return — CalendarView's pattern.
  const plans = useMemo(() => {
    void page
    return loadDayPlans(anchors)
  }, [anchors, page])

  return (
    <div className="nextdays">
      {days.map((d) => {
        const w = wx ? wx[dateKey(d.ts)] : null
        const entry = dayEntryFor(plans[String(d.ts)]) ?? emptyDay() // null for an unplanned day
        const rest = entry.state === 'rest'
        const planned = hasContent(entry) && !rest
        const n = (entry.slots.day ? 1 : 0) + (entry.slots.night ? 1 : 0)
        const mood = wxMood(w)
        // weather phrase (real forecast only) + honest plan-state
        const wxTxt = w ? (CONDITION[w.emoji] || 'Forecast') + (w.hi != null ? ' · ' + w.hi + '°' : '') : null
        const planTxt = rest
          ? 'Quiet day'
          : planned
            ? `${n} planned`
            : mood === 'clear'
              ? 'Good day to get out'
              : mood === 'rainy'
                ? 'Rainy-day ideas'
                : 'No plan yet'
        const sub = [wxTxt, planTxt].filter(Boolean).join(' · ')
        // a gold CTA invites planning an open day; a planned/rest day shows a chevron
        const cta = !planned && !rest ? (d.label === 'Today' ? 'Build today' : 'Plan ' + d.label) : null
        return (
          <button key={d.ts} className="nd-card pressable" onClick={() => openDay(d.ts)}>
            <span className="nd-wx" aria-hidden>{w?.emoji || '🗓️'}</span>
            <span className="nd-main">
              <span className="nd-day">{d.label}</span>
              <span className="nd-sub">{sub}</span>
            </span>
            {cta ? (
              <span className="nd-cta">{cta}</span>
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
