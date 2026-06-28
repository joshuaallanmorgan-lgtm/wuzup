// MySavesPage — PROFILE_PHASE2 polish: filter tabs (All / Upcoming / Past) +
// time-grouped rows (Upcoming · Yesterday · Earlier this week · Saved earlier).
// Reuses saves.js (shelfItems + groupShelfByTime) + GemRow; back → Profile tab.
import { useMemo, useState } from 'react'
import { Icon, keyOf } from './lib.js'
import { useNav, viewIndex } from './nav.jsx'
import { GemRow } from './cards.jsx'
import { shelfItems, groupShelfByTime, useSaves } from './saves.js'
import './profile.css'

const FILTERS = ['All', 'Upcoming', 'Past']

export default function MySavesPage({ events, anchors }) {
  const { closePage: onClose, openDetail: onSelect, goTo } = useNav()
  const { list: savedList } = useSaves()
  const shelf = useMemo(() => shelfItems(savedList, events, anchors), [savedList, events, anchors])
  const [filter, setFilter] = useState('All')

  const filtered = useMemo(() => {
    if (filter === 'Upcoming') return shelf.filter((x) => !x.past)
    if (filter === 'Past') return shelf.filter((x) => x.past)
    return shelf
  }, [shelf, filter])

  const groups = useMemo(() => groupShelfByTime(filtered, anchors), [filtered, anchors])

  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">
          My Saves{shelf.length > 0 && <span className="shelf-count">{shelf.length}</span>}
        </h1>
      </header>

      <div className="ms-tabs" role="tablist" aria-label="Filter saves">
        {FILTERS.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={'ms-tab' + (filter === f ? ' ms-tab-sel' : '')}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="pg-body">
        {groups.length ? (
          groups.map((g) => (
            <div key={g.key} className="ms-group">
              <div className="ms-group-label">{g.label}</div>
              <div className="pf-rows">
                {g.items.map(({ e, past }) => (
                  <div key={keyOf(e)} className={'pf-item' + (past ? ' pf-past' : '')}>
                    {past && <span className="pf-happened">Happened</span>}
                    <GemRow e={e} onSelect={onSelect} />
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="pf-empty">
            {shelf.length === 0
              ? 'No saves yet — tap ♥ on events.'
              : filter === 'Upcoming'
                ? 'No upcoming saves.'
                : 'No past saves.'}
            {shelf.length === 0 && (
              /* B1: a premium way forward when there's nothing saved (DRAFT copy ⚑ Charles) */
              <button className="empty-cta" onClick={() => { onClose(); goTo(viewIndex('hot')) }}>
                Explore events
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
