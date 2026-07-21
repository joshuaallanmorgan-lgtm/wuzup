// PlaceBubblePage — full-page destination for a tapped Locations bubble
// (Sprint S, the place-side twin of BubblePage). App mounts it inside the
// sliding .subpage overlay. Filters the places store by the bubble's pure
// `match` predicate, then uses the shared objective rank contract without
// changing membership. Image availability never affects the order.
//
// Props: bubble — a PLACE_BUBBLES entry { id, emoji, label, hue, match }.
// Detail-open + close come from useNav() (the shared detail layer; opening a
// place records taste/recents generically).
import { useMemo, useRef, useState } from 'react'
import { CITY, fmtLocale, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { RowFeed } from './cards.jsx'
import LensNav from './LensNav.jsx'
import { useTaste } from './taste.js'
import { useLocationPermission } from './LocationProvider.jsx'
import { usePlaces, PLACE_LENS_BUBBLES, PLACE_CAT_BUBBLES } from './places.js'
import { rankSpots } from './spot-context.js'
import './bubble.css'
import './locations.css'

const TAGLINES = {
  beaches: 'Mapped beaches and shoreline access.',
  parks: 'Mapped parks and trails.',
  courts: 'Mapped courts and recreation facilities.',
  nature: 'Mapped trails and preserves.',
  views: 'Mapped viewpoints and piers.',
  dog: 'Dog parks and places listing dog access.',
  hidden: 'Browse more places.',
  open: 'Places with published hours.',
  free: 'No entry fee listed.',
  // 3.7P-12 activity intents (places.js ACTIVITIES) — DRAFT ⚑ Charles
  'act-beach': 'Mapped beaches and shoreline access.',
  'act-trails': 'Mapped trails and preserves.',
  'act-water': 'Launch, paddle, cast, swim.',
  'act-sports': 'Mapped courts and recreation facilities.',
  'act-family': 'Room to run and play.',
  'act-dog': 'Dog parks and places listing dog access.',
  'act-views': 'Mapped viewpoints, piers, and boardwalks.',
  'act-hidden': 'Browse more places.',
}

export default function PlaceBubblePage({ bubble }) {
  const { openDetail: onSelect, closePage: onClose, openPlaceBubble } = useNav()
  const { places, status, recover, recoverLabel } = usePlaces()
  const taste = useTaste()
  const location = useLocationPermission()
  const [nowMs] = useState(() => Date.now())
  const pgRef = useRef(null)

  const sections = useMemo(() => {
    if (!Array.isArray(places)) return []
    const matched = places.filter(bubble.match)
    const list = rankSpots(matched, {
      nowMs,
      city: CITY,
      taste,
      coords: location.usableCoords,
      activity: bubble,
      attachDistance: Boolean(location.usableCoords),
      mode: 'activity',
      diversityPolicy: { prefix: 20, sourceMax: 6, categoryMax: 8, venueMax: 1, canonicalMax: 1, seriesMax: 1 },
    }).ordered
    return list.length ? [{ label: null, items: list }] : []
  }, [places, bubble, taste, location.usableCoords, nowMs])

  const count = sections.reduce((n, s) => n + s.items.length, 0)

  return (
    <div className="pg" ref={pgRef} style={{ '--bh': bubble.hue }}>
      <header className="pg-band bub-band">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <div className="bub-band-main">
          <h1 className="bub-title">
            <span className="bub-emoji">{bubble.emoji}</span>
            {bubble.label}
          </h1>
          <div className="pg-count">
            {count.toLocaleString(fmtLocale)} place{count === 1 ? '' : 's'} in {CITY.name}
          </div>
          <div className="bub-tag">{TAGLINES[bubble.id] || 'Browse this collection.'}</div>
        </div>
      </header>
      {/* CARD_LOCK: the shared filter-chip bar on results too (place lenses). */}
      <LensNav lenses={PLACE_LENS_BUBBLES} categories={PLACE_CAT_BUBBLES} menuLabel="All spots" onOpen={openPlaceBubble} activeId={bubble.id} />
      <div className="pg-body">
        {count > 0 ? (
          <RowFeed sections={sections} stagger scrollRootRef={pgRef} onSelect={onSelect} />
        ) : (
          <div className="empty">
            {status === 'idle' || status === 'loading'
              ? 'Loading…'
              : status === 'stale'
                ? 'These place listings are too old to show safely.'
                : status === 'offline'
                  ? 'You’re offline. Places weren’t loaded.'
                  : status === 'error'
                    ? "Couldn't verify places right now."
                    : `${bubble.emoji} No ${bubble.label.toLowerCase()} mapped yet.`}
            {['stale', 'offline', 'error'].includes(status) && recover && (
              <button className="empty-cta" onClick={recover}>{recoverLabel}</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
