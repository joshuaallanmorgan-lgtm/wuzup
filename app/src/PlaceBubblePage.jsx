// PlaceBubblePage — full-page destination for a tapped Locations bubble
// (Sprint S, the place-side twin of BubblePage). App mounts it inside the
// sliding .subpage overlay. Filters the places store by the bubble's pure
// `match` predicate, orders count-preservingly — photo-bearing places first
// (WS4: a screenful reads composed, not lottery), then taste (S3), then
// corroboration then name (never hides) — and renders the shared RowFeed.
//
// Props: bubble — a PLACE_BUBBLES entry { id, emoji, label, hue, match }.
// Detail-open + close come from useNav() (the shared detail layer; opening a
// place records taste/recents generically).
import { useMemo, useRef } from 'react'
import { CITY, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { RowFeed, photoFirst } from './cards.jsx'
import LensNav from './LensNav.jsx'
import { tasteNudge, useTaste } from './taste.js'
import { usePlaces, PLACE_LENS_BUBBLES, PLACE_CAT_BUBBLES } from './places.js'
import './bubble.css'
import './locations.css'

const TAGLINES = {
  beaches: 'Sand, surf, and sunset.',
  parks: 'Green space, found.',
  courts: 'Game on, anytime.',
  nature: 'Boots optional, wonder required.',
  views: 'Worth the look.',
  dog: 'Bring the good boy.',
  hidden: 'Off the tourist track.',
  free: 'Always open, never a cover.',
  // 3.7P-12 activity intents (places.js ACTIVITIES) — DRAFT ⚑ Charles
  'act-beach': 'Sand, surf, and sunset.',
  'act-trails': 'Boots optional, wonder required.',
  'act-water': 'Launch, paddle, cast, swim.',
  'act-sports': 'Game on, anytime.',
  'act-family': 'Room to run and play.',
  'act-dog': 'Bring the good boy.',
  'act-views': 'Worth the look.',
  'act-hidden': 'Off the tourist track.',
}

export default function PlaceBubblePage({ bubble }) {
  const { openDetail: onSelect, closePage: onClose, openPlaceBubble } = useNav()
  const { places, status } = usePlaces()
  const taste = useTaste()
  const pgRef = useRef(null)

  const sections = useMemo(() => {
    if (!Array.isArray(places)) return []
    const list = photoFirst(
      places
        .filter(bubble.match)
        .sort(
          (a, b) =>
            tasteNudge(b, taste) - tasteNudge(a, taste) ||
            (b.srcCount || 0) - (a.srcCount || 0) ||
            a.name.localeCompare(b.name)
        )
    )
    return list.length ? [{ label: null, items: list }] : []
  }, [places, bubble, taste])

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
            {count.toLocaleString('en-US')} place{count === 1 ? '' : 's'} in {CITY.name}
          </div>
          <div className="bub-tag">{TAGLINES[bubble.id] || 'Picked fresh for you.'}</div>
        </div>
      </header>
      {/* CARD_LOCK: the shared filter-chip bar on results too (place lenses). */}
      <LensNav lenses={PLACE_LENS_BUBBLES} categories={PLACE_CAT_BUBBLES} menuLabel="All spots" onOpen={openPlaceBubble} activeId={bubble.id} />
      <div className="pg-body">
        {count > 0 ? (
          <RowFeed sections={sections} stagger scrollRootRef={pgRef} onSelect={onSelect} />
        ) : (
          <div className="empty">
            {status === 'loading'
              ? 'Loading…'
              : `${bubble.emoji} No ${bubble.label.toLowerCase()} mapped yet — the bay keeps growing.`}
          </div>
        )}
      </div>
    </div>
  )
}
