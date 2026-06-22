// RecentlySavedPage — the "See all" of the Profile landing's Recently saved
// (PROFILE_PHASE2 #3). The full saved shelf, time-grouped by SAVE recency
// (groupShelfByTime: Today / Yesterday / Earlier this week / Earlier), each a
// canonical GemRow; past items greyed + "Happened". Real data only; honest empty.
// Opened via nav.openRecentlySaved ({type:'recentlysaved'}); back → the Profile tab.
import { Fragment, useMemo } from 'react'
import { Icon, keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { GemRow } from './cards.jsx'
import { groupShelfByTime, useSaves } from './saves.js'
import './profile.css'

export default function RecentlySavedPage({ events, anchors }) {
  const { closePage: onClose, openDetail: onSelect } = useNav()
  const { list: savedList } = useSaves()
  const groups = useMemo(() => groupShelfByTime(savedList, events, anchors), [savedList, events, anchors])
  const total = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">
          Recently saved{total > 0 && <span className="shelf-count">{total}</span>}
        </h1>
      </header>
      <div className="pg-body">
        {total ? (
          groups.map((g) => (
            <Fragment key={g.label}>
              <div className="pf-hist-label">{g.label}</div>
              <div className="pf-rows">
                {g.items.map(({ e, past }) => (
                  <div key={keyOf(e)} className={'pf-item' + (past ? ' pf-past' : '')}>
                    {past && <span className="pf-happened">Happened</span>}
                    <GemRow e={e} onSelect={onSelect} />
                  </div>
                ))}
              </div>
            </Fragment>
          ))
        ) : (
          <div className="pf-empty">Nothing saved yet — tap ♥ on an event or spot to keep it here.</div>
        )}
      </div>
    </div>
  )
}
