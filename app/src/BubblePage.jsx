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
// Detail-open (stacks on top) + close-slide-out come from useNav() (O6).
//
// Filter semantics: kind 'time' → _tonight/_weekend, 'free' → _free, 'cat' →
// e.category, 'sort' (Near Me) → everything upcoming, distance-sorted once the
// user grants location (never hide events: no coords ≠ no list). Day-grouped
// (Today/Tomorrow/weekday), hotScore desc within a day, RowFeed pages ~30 rows
// via IntersectionObserver rooted at this page's own .pg scroller.
import { useMemo, useRef, useState } from 'react'
import { CITY, dayLabel, hotDesc, Icon, milesBetween, orderDay, LENS_BUBBLES, CAT_BUBBLES } from './lib.js'
import { useNav } from './nav.jsx'
import { RowFeed } from './cards.jsx'
import LensNav from './LensNav.jsx'
import { tasteNudge } from './taste.js'
import { DeckThisButton } from './LensDeck.jsx'
import './bubble.css'

// TOUCHUP P2: ref-matched result headers for the time/free/near filters (the
// FiltersSheet + lens-row destinations) — "Tonight" → "Tonight's top picks" etc.
// Categories keep their plain label.
const HEADERS = {
  tonight: "Tonight's top picks",
  tomorrow: "Tomorrow's events",
  weekend: 'The weekend',
  free: 'Free events',
  near: 'Near you',
}

// one-line personality per bubble (Charles: every destination gets a wink)
const TAGLINES = {
  tonight: 'No plans? Not anymore.',
  tomorrow: 'Get a head start on tomorrow.',
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
  family: 'Fun the whole crew can join.',
  markets: 'Treasure hunting, sanctioned.',
  clubs: 'Your people are out there.',
}

// calm, honest empty states (rare with 700+ events, but never a dead end).
// Premium voice (N3 DRAFT — Charles): plain + warm, no winking, no emoji-in-prose.
const EMPTIES = {
  tonight: 'Nothing listed for tonight yet — check back soon.',
  tomorrow: 'Nothing listed for tomorrow yet — check back soon.',
  weekend: 'Nothing on the weekend yet — check back soon.',
  free: 'No free events listed right now.',
  near: 'Nothing nearby right now.',
}

export default function BubblePage({ bubble, events, anchors, coords, requestCoords }) {
  const { openDetail: onSelect, closePage: onClose, openBubble, openEvFilters } = useNav()
  const pgRef = useRef(null) // the scrolling ancestor — RowFeed's IO root
  const [locState, setLocState] = useState('idle') // 'idle' | 'asking' | 'denied'
  const near = bubble.kind === 'sort'

  // this page builds its own upcoming list (normalize doesn't add _clamp)
  const filtered = useMemo(() => {
    const up = events
      .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
      .map((e) => ({ ...e, _clamp: Math.max(e._day, anchors.todayTs) }))
    if (bubble.kind === 'time') {
      if (bubble.value === 'tonight') return up.filter((e) => e._tonight)
      // TOUCHUP P2: tomorrow = events that START tomorrow (a clean single-day list;
      // multi-day events already in progress live under Today/Tonight, not here)
      if (bubble.value === 'tomorrow') return up.filter((e) => e._day === anchors.tomorrowTs)
      return up.filter((e) => e._weekend)
    }
    if (bubble.kind === 'free') return up.filter((e) => e._free)
    if (bubble.kind === 'cat') return up.filter((e) => e.category === bubble.value)
    return up // 'sort' (Near Me): all upcoming; ordering handles the rest
  }, [events, anchors, bubble])

  // day-grouped sections. Default within-day order = G1 orderDay (diversity-
  // interleaved adjustedScore — on a category page the family constraint still
  // de-floods single-source runs). Near Me + coords keeps the DISTANCE order:
  // the user asked "what's closest", scrambling that for diversity would lie
  // (missing lat/lng sinks to the bottom, ties break by hotness).
  const sections = useMemo(() => {
    const list =
      near && coords
        ? filtered.map((e) => ({
            ...e,
            _dist: e.lat != null && e.lng != null ? milesBetween(coords, e) : null,
          }))
        : filtered
    const byDist = (x, y) => (x._dist ?? Infinity) - (y._dist ?? Infinity) || hotDesc(x, y)
    const byDay = new Map()
    for (const e of list) {
      if (!byDay.has(e._clamp)) byDay.set(e._clamp, [])
      byDay.get(e._clamp).push(e)
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, items]) => ({
        label: dayLabel(ts, anchors),
        items: near && coords ? items.sort(byDist) : orderDay(items, tasteNudge),
      }))
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
            {HEADERS[bubble.id] || bubble.label}
          </h1>
          <div className="pg-count">
            {count.toLocaleString('en-US')} event{count === 1 ? '' : 's'} in {CITY.name}
          </div>
          <div className="bub-tag">{TAGLINES[bubble.id] || 'Picked fresh for you.'}</div>
          {/* Q2: this lens, as a finite swipe deck — explicit tap only.
              'sort' (Near Me) is the whole upcoming list: a four-digit
              "deck" is no decision aid, so that one gets no entry. */}
          {count > 0 && bubble.kind !== 'sort' && (
            <div className="bub-deckthis">
              <DeckThisButton lens={{ kind: 'bubble', bubble }} />
            </div>
          )}
        </div>
      </header>
      {/* CARD_LOCK: the shared filter-chip bar on results too — chips navigate to
          real bubbles (active = this one), "Filter" opens the FiltersSheet. */}
      <LensNav lenses={LENS_BUBBLES} categories={CAT_BUBBLES} onOpen={openBubble} onFilter={openEvFilters} activeId={bubble.id} />
      <div className="pg-body">
        {near && !coords && count > 0 && (
          <div className="bub-locate">
            <div className="bub-locate-txt">
              {locState === 'denied'
                ? /* the denied list is diversity-ordered (orderDay), not hotScore-
                     desc — don't claim "hottest first" (DRAFT for Charles) */
                  "Couldn't find your location — showing the whole bay instead."
                : `${CITY.name} is big — narrow it to what's near you.`}
            </div>
            <button className="bub-locate-btn" onClick={locate} disabled={locState === 'asking'}>
              {locState === 'asking' ? 'Locating…' : '📍 Use my location'}
            </button>
          </div>
        )}
        {count > 0 ? (
          <RowFeed sections={sections} stagger scrollRootRef={pgRef} onSelect={onSelect} />
        ) : (
          <div className="empty">
            {EMPTIES[bubble.id] || `No ${bubble.label.toLowerCase()} listed right now.`}
            <br />
            New events land every time the finder runs — check back soon.
            {/* B1: a premium way back to the full feed (DRAFT copy ⚑ Charles) */}
            <button className="empty-cta" onClick={onClose}>See all events</button>
          </div>
        )}
      </div>
    </div>
  )
}
