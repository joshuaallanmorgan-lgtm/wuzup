// BubblePage — full-page destination for a tapped bubble (round-3: a bubble is
// a meaningful DESTINATION, not a filter chip). App mounts it inside the sliding
// .subpage overlay (z 1500, below detail 2000).
//
// Props contract:
//   bubble        — a BUBBLES entry: { id, emoji, label, kind, value, hue }
//   events        — normalized events (all of them; filtering is this page's job)
//   anchors       — { todayTs, tomorrowTs, wkStartTs, wkEndTs }
//   coords        — last known { lat, lng } | null (App-held)
// Detail-open (stacks on top) + close-slide-out come from useNav() (O6).
//
// Filter semantics: kind 'time' → _tonight/_weekend, 'free' → _free, 'cat' →
// e.category, 'sort' (Near Me) → everything upcoming, with distance as bounded
// context once location is granted (never hide events: no coords ≠ no list).
// Day-grouped (Today/Tomorrow/weekday), then shared-ranked; RowFeed pages ~30
// rows via IntersectionObserver rooted at this page's own .pg scroller.
import { useMemo, useRef } from 'react'
import { CITY, dayLabel, fmtLocale, Icon, milesBetween, LENS_BUBBLES, CAT_BUBBLES } from './lib.js'
import { useLocationPermission } from './LocationProvider.jsx'
import { useNav } from './nav.jsx'
import { RowFeed } from './cards.jsx'
import LensNav from './LensNav.jsx'
import { useTaste } from './taste.js'
import { DeckThisButton } from './LensDeck.jsx'
import { matchesEventFilters } from './eventFilters.js'
import { rankRuntimeItems, runtimeRankingId } from './relevance.js'
import './bubble.css'

// TOUCHUP P2: ref-matched result headers for the time/free/near filters (the
// FiltersSheet + lens-row destinations) — "Tonight" → "Tonight's top picks" etc.
// Categories keep their plain label.
const HEADERS = {
  tonight: "Tonight's events",
  tomorrow: "Tomorrow's events",
  weekend: 'The weekend',
  free: 'Free events',
}

// one-line personality per bubble (Charles: every destination gets a wink)
const TAGLINES = {
  tonight: 'No plans? Not anymore.',
  tomorrow: 'Get a head start on tomorrow.',
  weekend: 'Friday to Sunday, fully loaded.',
  free: 'Your wallet stays home.',
  music: `Turn it up, ${CITY.shortName}.`,
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
}

export default function BubblePage({ bubble, events, anchors, coords }) {
  const { openDetail: onSelect, closePage: onClose, openBubble, openEvFilters } = useNav()
  const location = useLocationPermission()
  const taste = useTaste()
  const pgRef = useRef(null) // the scrolling ancestor — RowFeed's IO root
  const near = bubble.kind === 'sort'

  // this page builds its own upcoming list (normalize doesn't add _clamp)
  const filtered = useMemo(() => {
    const up = events
      .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
      .map((e) => ({ ...e, _clamp: Math.max(e._day, anchors.todayTs) }))
    if (bubble.kind === 'filters') return up.filter((e) => matchesEventFilters(e, bubble.filters, anchors))
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

  // Day-grouped sections use one common objective/taste/diversity order. Near Me
  // contributes a bounded distance score to that contract; it does not replace
  // quality with a distance-only post-sort or change result membership.
  const sections = useMemo(() => {
    const list =
      near && coords
        ? filtered.map((e) => ({
            ...e,
            _dist: e.lat != null && e.lng != null ? milesBetween(coords, e) : null,
          }))
        : filtered
    const byDay = new Map()
    for (const e of list) {
      if (!byDay.has(e._clamp)) byDay.set(e._clamp, [])
      byDay.get(e._clamp).push(e)
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, items]) => {
        const distanceContext = near && coords
          ? {
              itemScores: Object.fromEntries(items.map((event) => {
                const distance = event._dist
                const score = Number.isFinite(distance) ? Math.max(0, 6 - Math.min(distance, 30) / 5) : 0
                return [runtimeRankingId(event), score]
              })),
            }
          : {}
        const ranked = rankRuntimeItems(items, {
          kind: 'events',
          nowMs: anchors.nowMs,
          city: CITY,
          taste,
          context: distanceContext,
          diversityPolicy: {
            prefix: Math.min(20, items.length),
            sourceMax: 2,
            categoryMax: bubble.kind === 'cat' ? Math.max(items.length, 1) : 2,
            venueMax: 1,
            canonicalMax: 1,
            seriesMax: 1,
          },
        }).ordered
        return { label: dayLabel(ts, anchors), items: ranked }
      })
  }, [filtered, near, coords, anchors, taste, bubble.kind])

  const count = filtered.length

  const locate = () => location.status === 'granted'
    ? location.refresh()
    : location.request()
  const locationCopy =
    location.status === 'denied'
      ? 'Location is blocked in your browser — showing the whole area instead.'
      : location.status === 'unavailable'
        ? 'Location is unavailable here — showing the whole area instead.'
      : location.status === 'error'
          ? 'Couldn’t get your location — showing the whole area instead.'
          : location.status === 'granted' && !location.inMarket
            ? `Your current location is outside ${CITY.name} — showing the whole area instead.`
            : `${CITY.name} is big — narrow it to what’s near you.`
  const heading = near
    ? coords ? 'Events by day and distance' : `Events across ${CITY.name}`
    : HEADERS[bubble.id] || bubble.label
  const tagline = near
    ? coords
      ? 'Distance helps order each day. Check the venue before you go.'
      : 'Browse the current listings without a distance claim.'
    : TAGLINES[bubble.id] || 'Browse the current listings.'

  return (
    <div className="pg" ref={pgRef} style={{ '--bh': bubble.hue }}>
      <header className="pg-band bub-band">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <div className="bub-band-main">
          <h1 className="bub-title">
            <span className="bub-emoji">{bubble.emoji}</span>
            {heading}
          </h1>
          <div className="pg-count">
            {count.toLocaleString(fmtLocale)} event{count === 1 ? '' : 's'} in {CITY.name}
          </div>
          <div className="bub-tag">
            {bubble.kind === 'filters'
              ? `Matching ${bubble.filterLabels?.join(' · ') || 'your selected filters'}`
              : tagline}
          </div>
          {/* Q2: this lens, as a finite swipe deck — explicit tap only.
              'sort' (Near Me) is the whole upcoming list: a four-digit
              "deck" is no decision aid, so that one gets no entry. */}
          {count > 0 && bubble.kind !== 'sort' && bubble.kind !== 'filters' && (
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
            <div className="bub-locate-txt" role="status" aria-live="polite">
              {locationCopy}
            </div>
            <button
              className="bub-locate-btn"
              onClick={locate}
              disabled={location.status === 'requesting' || location.status === 'denied'}
            >
              {/* WS3 §9: engineered pin, not the 📍 chrome emoji */}
              {location.status === 'requesting'
                ? 'Locating…'
                : location.status === 'denied'
                  ? 'Location blocked'
                  : location.status === 'granted'
                    ? 'Refresh location'
                    : <><Icon.pin className="btn-ic" aria-hidden /> Use my location</>}
            </button>
          </div>
        )}
        {count > 0 ? (
          <RowFeed sections={sections} stagger scrollRootRef={pgRef} onSelect={onSelect} />
        ) : (
          <div className="empty">
            {bubble.kind === 'filters'
              ? 'No events match every selected filter.'
              : near
                ? `No current events listed across ${CITY.name}.`
                : EMPTIES[bubble.id] || `No ${bubble.label.toLowerCase()} listed right now.`}
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
