// MySavesPage — the Profile "My saves" drill-in (Stage R Profile rework). The
// saved shelf relocated out of the Profile main view: upcoming first, past
// greyed, each tap → the shared detail. Reuses saves.js (shelfItems) + GemRow;
// honest count + empty state. Opened via nav.openMySaves ({type:'mysaves'});
// back → closePage → the Profile tab.
import { useMemo } from 'react'
import { Icon, keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { GemRow } from './cards.jsx'
import { shelfItems, useSaves } from './saves.js'
import './profile.css'

export default function MySavesPage({ events, anchors }) {
  const { closePage: onClose, openDetail: onSelect } = useNav()
  const { list: savedList } = useSaves()
  // shelfItems: live-from-dataset when possible, snapshot otherwise; upcoming
  // first, past greyed + dropped after 7 days (saves.js contract).
  const shelf = useMemo(() => shelfItems(savedList, events, anchors), [savedList, events, anchors])

  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">
          My saves{shelf.length > 0 && <span className="shelf-count">{shelf.length}</span>}
        </h1>
      </header>
      <div className="pg-body">
        {shelf.length ? (
          <div className="pf-rows">
            {shelf.map(({ e, past }) => (
              <div key={keyOf(e)} className={'pf-item' + (past ? ' pf-past' : '')}>
                {past && <span className="pf-happened">Happened</span>}
                <GemRow e={e} onSelect={onSelect} />
              </div>
            ))}
          </div>
        ) : (
          <div className="pf-empty">No saves yet — tap ♥ on events.</div>
        )}
      </div>
    </div>
  )
}
