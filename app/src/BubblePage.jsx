// BubblePage — full-page destination for a tapped bubble (round-3: a bubble is
// a meaningful DESTINATION, not a filter chip). App mounts it inside the sliding
// .subpage overlay (z 1500, below detail 2000).
//
// Props contract:
//   bubble        — a BUBBLES entry: { id, emoji, label, kind, value, hue }
//   events        — normalized events (all of them; filtering is this page's job)
//   anchors       — { todayTs, tomorrowTs, wkStartTs, wkEndTs }
//   coords        — last known { lat, lng } | null (App-held)
//   requestCoords — () => Promise<{lat,lng}|null>; asks geolocation via App
//   onSelect      — (event, cardEl|null) opens the detail (stacks on top)
//   onClose       — slide back out to the Hot tab
//
// Lens semantics: kind 'time' → _tonight/_weekend, 'free' → _free, 'cat' →
// e.category, 'sort' (Near Me) → everything upcoming, distance-sorted once the
// user grants location (never hide events: no coords ≠ no list). Day-grouped
// (Today/Tomorrow/weekday), hotScore desc within a day, RowFeed pages ~30 rows
// via IntersectionObserver rooted at this page's own .pg scroller.
import { useMemo, useRef, useState } from 'react'
import { CITY, dayLabel, hotDesc, Icon, milesBetween } from './lib.js'
import { RowFeed } from './cards.jsx'
import './bubble.css'

// one-line personality per bubble (Charles: every destination gets a wink)
const TAGLINES = {
  tonight: 'No plans? Not anymore.',
  weekend: 'Friday to Sunday, fully loaded.',
  free: 'Your wallet stays home.',
  near: 'Good times, walking distance.',
  music: 'Turn it up, Tampa.',
  food: 'Come hungry. Leave happy.',
  outdoors: 'Vitamin D included.',
  sports: 'Game faces on.',
  arts: 'Culture, no dress code.',
  night: 'Sleep is for Sundays.',
  comedy: 'Cheaper than therapy.',
  theatre: 'Drama — the good kind.',
  markets: 'Treasure hunting, sanctioned.',
  clubs: 'Your people are out there.',
}

// charming empty states (rare with 700+ events, but never a dead end)
const EMPTIES = {
  tonight: '🦗 Crickets tonight. Even Tampa naps sometimes.',
  weekend: '🎈 The weekend slate is empty — for now.',
  free: '🪙 No freebies on the books. Capitalism wins this round.',
  near: '🗺️ The map is quiet right now.',
}

export default function BubblePage({ bubble, events, anchors, coords, requestCoords, onSelect, onClose }) {
  const pgRef = useRef(null) // the scrolling ancestor — RowFeed's IO root
  const [locState, setLocState] = useState('idle') // 'idle' | 'asking' | 'denied'
  const near = bubble.kind === 'sort'

  // this page builds its own upcoming list (normalize doesn't add _clamp)
  const filtered = useMemo(() => {
    const up = events
      .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
      .map((e) => ({ ...e, _clamp: Math.max(e._day, anchors.todayTs) }))
    if (bubble.kind === 'time') return up.filter((e) => (bubble.value === 'tonight' ? e._tonight : e._weekend))
    if (bubble.kind === 'free') return up.filter((e) => e._free)
    if (bubble.kind === 'cat') return up.filter((e) => e.category === bubble.value)
    return up // 'sort' (Near Me): all upcoming; ordering handles the rest
  }, [events, anchors, bubble])

  // day-grouped sections; Near Me + coords swaps the within-day order to
  // distance (missing lat/lng sinks to the bottom, ties break by hotness)
  const sections = useMemo(() => {
    const list =
      near && coords
        ? filtered.map((e) => ({
            ...e,
            _dist: e.lat != null && e.lng != null ? milesBetween(coords, e) : null,
          }))
        : filtered
    const cmp =
      near && coords
        ? (x, y) => (x._dist ?? Infinity) - (y._dist ?? Infinity) || hotDesc(x, y)
        : hotDesc
    const byDay = new Map()
    for (const e of list) {
      if (!byDay.has(e._clamp)) byDay.set(e._clamp, [])
      byDay.get(e._clamp).push(e)
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, items]) => ({ label: dayLabel(ts, anchors), items: items.sort(cmp) }))
  }, [filtered, near, coords, anchors])

  const count = filtered.length

  const locate = async () => {
    setLocState('asking')
    const c = await requestCoords() // success flows back in via the coords prop
    if (!c) setLocState('denied')
  }

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
            {count} event{count === 1 ? '' : 's'} in {CITY.name}
          </div>
          <div className="bub-tag">{TAGLINES[bubble.id] || 'Picked fresh for you.'}</div>
        </div>
      </header>
      <div className="pg-body">
        {near && !coords && count > 0 && (
          <div className="bub-locate">
            <div className="bub-locate-txt">
              {locState === 'denied'
                ? "Couldn't get a fix 🛰️ — showing the hottest first instead."
                : "Tampa Bay is big. Let's narrow it to your block."}
            </div>
            <button className="bub-locate-btn" onClick={locate} disabled={locState === 'asking'}>
              {locState === 'asking' ? 'Locating…' : '📍 Use my location'}
            </button>
          </div>
        )}
        {count > 0 ? (
          <RowFeed
            sections={sections}
            showDist={near && !!coords}
            stagger
            scrollRootRef={pgRef}
            onSelect={onSelect}
          />
        ) : (
          <div className="empty">
            {EMPTIES[bubble.id] || `${bubble.emoji} No ${bubble.label.toLowerCase()} on the radar right now.`}
            <br />
            New events land every time the finder runs — check back soon.
          </div>
        )}
      </div>
    </div>
  )
}
