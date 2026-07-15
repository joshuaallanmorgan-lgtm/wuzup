// NextDays — 3.7P-23b: the "Your next days" planning-card stack (§N screen 1, the
// headline Home element). Today + the next two days, each a tappable card showing
// the real forecast, the honest plan-state, and a planner CTA. Tapping opens that
// DayPage (the Discover→Plan bridge). Built from EXISTING signal only — wx (the
// 16-day forecast) + the day-plan store — so every line is true (no fabricated
// "ideas"). Reused on Calendar by P40 later.
import { useMemo } from 'react'
import { addDayTs, formatDayTs, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { loadDayPlans, dayEntryFor, hasContent, emptyDay, PARTS } from './dayplan.js'
import { dateKey, CONDITION, WX_GLYPH } from './weather.js'
import { wxMood } from './weekend.js'
import './nextdays.css'

const weekday = (ts) => formatDayTs(ts, { weekday: 'long' })

export default function NextDays({ anchors, wx, rev }) {
  const { openDay, page } = useNav()
  const days = useMemo(() => {
    return [0, 1, 2].map((i) => {
      const ts = addDayTs(anchors.todayTs, i)
      return { ts, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday(ts) }
    })
  }, [anchors])
  // localStorage isn't reactive; re-read on the subpage edge (page flips null↔obj)
  // so a slot planned on a DayPage shows here on return — CalendarView's pattern.
  const plans = useMemo(() => {
    void page // re-read on the subpage edge (CalendarView trick)
    void rev // …and when the host bumps after an inline add (FeaturedCard)
    return loadDayPlans(anchors)
  }, [anchors, page, rev])

  return (
    <div className="nextdays">
      {days.map((d) => {
        const w = wx ? wx[dateKey(d.ts)] : null
        const entry = dayEntryFor(plans[String(d.ts)]) ?? emptyDay() // null for an unplanned day
        const rest = entry.state === 'rest'
        const planned = hasContent(entry) && !rest
        const n = PARTS.filter((p) => entry.slots[p]).length
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
            {/* WS3 §9: the tinted condition disc — engineered stroke glyph, not the
                raw emoji (the emoji stays the wx DATA key); no forecast → calendar */}
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
