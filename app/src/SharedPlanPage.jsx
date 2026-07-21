import { cityMidnightMs } from '../../shared/city-time.mjs'
import { formatDayTs, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { DAYPART } from './weekend.js'
import './shared-plan.css'

export default function SharedPlanPage({ capsule }) {
  const { closePage } = useNav()
  const dayTs = cityMidnightMs(capsule.day, capsule.timeZone)
  const dayLabel = formatDayTs(dayTs, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="pg shared-plan">
      <header className="pg-head">
        <button className="pg-back" onClick={closePage} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Shared plan</h1>
      </header>
      <div className="pg-body shared-plan-body">
        <div className="shared-plan-intro">
          <div className="shared-plan-kicker">{dayLabel}</div>
          <h2>A day someone made in Wuzup</h2>
          <p>This copy is view-only. Opening it did not change your plans.</p>
        </div>
        <div className="shared-plan-slots">
          {capsule.slots.map((slot) => (
            <article className="shared-plan-slot" key={`${slot.part}:${slot.primary}`}>
              <div className="shared-plan-part">
                <span aria-hidden>{DAYPART[slot.part]?.emoji || '•'}</span>
                {DAYPART[slot.part]?.label || slot.part}
              </div>
              <h3>{slot.title}</h3>
              {(slot.time || slot.venue) && (
                <p>{[slot.time, slot.venue].filter(Boolean).join(' · ')}</p>
              )}
            </article>
          ))}
        </div>
        <div className="shared-plan-note" role="note">
          Shared plans contain display details only. Check current listings before you go.
        </div>
      </div>
    </div>
  )
}
