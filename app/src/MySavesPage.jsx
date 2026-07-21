// MySavesPage — PROFILE_PHASE2 polish: filter tabs (All / Upcoming / Past) +
// time-grouped rows (Upcoming · Yesterday · Earlier this week · Saved earlier).
// Reuses saves.js (shelfItems + groupShelfByTime) + GemRow; back → Profile tab.
import { useMemo, useRef, useState } from 'react'
import { Icon, keyOf, tablistArrowKey } from './lib.js'
import { useNav, viewIndex } from './nav.jsx'
import { ResultCard } from './cards.jsx'
import { SaveHeart, shelfItems, groupShelfByTime, useSaves } from './saves.js'
import { GUIDES, useGuides } from './guides.js'
import { rehydrateSavedGuide } from './guide-model.js'
import './profile.css'

const FILTERS = ['All', 'Events', 'Spots', 'Guides']

export default function MySavesPage({ events, anchors }) {
  const { closePage: onClose, openDetail: onSelect, openGuide, goTo } = useNav()
  const {
    status,
    ready,
    error,
    recovery,
    retryPersistence,
    remove,
    canRemove,
    isRecordPending,
    list: savedList,
  } = useSaves({ events, anchors })
  const { watchGuides } = useGuides(true)
  const guideCatalog = useMemo(() => [...GUIDES, ...(watchGuides || [])], [watchGuides])
  const shelf = useMemo(() => shelfItems(savedList, events, anchors).map((row) => {
    if (row.e?.kind !== 'guide') return row
    const resolved = rehydrateSavedGuide(row.e, guideCatalog)
    return resolved.available
      ? { ...row, e: resolved.guide, unavailable: false, lifecycle: { code: 'available', actionable: true, label: null } }
      : { ...row, unavailable: true }
  }), [savedList, events, anchors, guideCatalog])
  const [filter, setFilter] = useState('All')
  const tabRefs = useRef([])

  const filtered = useMemo(() => {
    if (filter === 'Events') return shelf.filter((x) => x.e?.kind !== 'place' && x.e?.kind !== 'guide')
    if (filter === 'Spots') return shelf.filter((x) => x.e?.kind === 'place')
    if (filter === 'Guides') return shelf.filter((x) => x.e?.kind === 'guide')
    return shelf
  }, [shelf, filter])

  const groups = useMemo(() => {
    const eventItems = filtered.filter((x) => x.e?.kind !== 'place' && x.e?.kind !== 'guide')
    const spots = filtered.filter((x) => x.e?.kind === 'place')
    const guides = filtered.filter((x) => x.e?.kind === 'guide')
    return [
      ...groupShelfByTime(eventItems, anchors),
      ...(spots.length ? [{ key: 'spots', label: 'Spots', items: spots }] : []),
      ...(guides.length ? [{ key: 'guides', label: 'Guides', items: guides }] : []),
    ]
  }, [filtered, anchors])

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
        {FILTERS.map((f, i) => (
          <button
            key={f}
            ref={(el) => (tabRefs.current[i] = el)}
            role="tab"
            aria-selected={filter === f}
            tabIndex={filter === f ? 0 : -1}
            className={'ms-tab' + (filter === f ? ' ms-tab-sel' : '')}
            onClick={() => setFilter(f)}
            onKeyDown={(ev) => tablistArrowKey(ev, FILTERS, FILTERS.indexOf(filter), setFilter, tabRefs)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="pg-body">
        {!ready && (status === 'initializing' || status === 'idle') && (
          <div className="pf-empty" role="status">Loading your saves...</div>
        )}
        {!ready && status !== 'initializing' && status !== 'idle' && (
          <div className="pf-empty" role="alert">
            Couldn’t load your saves safely.
            {typeof error?.detail === 'string' && <div>{error.detail}</div>}
            {recovery?.canRetry === true && (
              <button className="empty-cta" onClick={retryPersistence}>Try again</button>
            )}
          </div>
        )}
        {ready && groups.length ? (
          groups.map((g) => (
            <div key={g.key} className="ms-group">
              <div className="ms-group-label">{g.label}</div>
              <div className="pf-rows">
                {g.items.map(({ e, record, unavailable, resolution, lifecycle }) => {
                  const removing = isRecordPending(record)
                  return (
                    <div key={record?.key ?? (e.kind === 'guide' ? `g|${e.id}` : keyOf(e))} className={'pf-item' + (unavailable ? ' pf-past' : '')}>
                      {unavailable && <span className="pf-happened">{lifecycle?.label || 'Unavailable'}</span>}
                      {unavailable ? (
                        <div className="pf-dayh">
                          <span className="pf-dayh-date">{e.kind === 'place' ? 'Spot' : e.kind === 'guide' ? 'Guide' : 'Saved item'}</span>
                          <span className="pf-dayh-what">{e.title || e.name || 'Saved item'}</span>
                          <span className="pf-dayh-what">
                            {resolution === 'ambiguous' ? 'Needs review' : lifecycle?.label || 'No longer listed'}
                          </span>
                          <button
                            className="empty-cta"
                            onClick={async () => { await remove(record) }}
                            disabled={!canRemove(record)}
                            aria-busy={removing || undefined}
                          >
                            {removing ? 'Removing...' : 'Remove from saves'}
                          </button>
                        </div>
                      ) : e.kind === 'guide' ? (
                        <>
                          <button className="pf-dayh pf-dayh-tap" onClick={() => openGuide(e)}>
                            <span className="pf-dayh-date">{e.emoji || '✦'} Guide</span>
                            <span className="pf-dayh-what">{e.title}</span>
                            {e.pov && <span className="pf-dayh-what">{e.pov}</span>}
                          </button>
                          <SaveHeart e={e} bare />
                        </>
                      ) : (
                        <ResultCard e={e} onSelect={onSelect} />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        ) : ready ? (
          <div className="pf-empty">
            {shelf.length === 0
              ? 'No saves yet — keep an event, spot, or guide for later.'
              : `No saved ${filter.toLowerCase()} yet.`}
            {shelf.length === 0 && (
              /* B1: a premium way forward when there's nothing saved (DRAFT copy ⚑ Charles) */
              <button className="empty-cta" onClick={() => { onClose(); goTo(viewIndex('hot')) }}>
                Explore events
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
