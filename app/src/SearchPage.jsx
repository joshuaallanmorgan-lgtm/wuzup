// SearchPage — full-page search opened from the 🔎 button in HotView's hero.
// App mounts it inside the sliding .subpage overlay (z 1500, below detail 2000).
//
// Props contract:
//   events   — normalized events
//   anchors  — { todayTs, tomorrowTs, wkStartTs, wkEndTs }
//   coords   — last known { lat, lng } | null (App-held); when present, result
//              rows wear distance pills (same showDist mechanism as BubblePage).
//              Passive: this page never PROMPTS for location.
// Detail-open (stacks on top) + close-slide-out come from useNav() (O6).
//
// Q2e: matching/ranking lives in search.js (pure, Node-simmed) — tokenized
// word-prefix scoring over title/venue/category/address(+description), date
// tokens ("friday", "tonight", "weekend"), "free". Recent searches
// ('search-recents-v1', cap 8) record on a tapped result or a submitted query —
// never per keystroke — and surface in the zero-state next to honest chips
// (registry category names + date shortcuts; every chip is a real query that
// runs visibly in the input).
//
// T2 (cross-layer search): ONE search box, TWO result groups — "Events" (the
// scheduled supply) and "Spots" (the always-there places). The places matcher
// (searchPlaces) is a second pure function over the lazy /places.json store
// (usePlaces) — date-constrained queries return zero places honestly (a place
// has no date). A Spots result opens PlaceDetail through the SAME shared detail
// layer (openDetail branches on kind:'place' in App). Both groups are
// labeled-section RowFeeds; never-hide holds — every matching event and place
// is shown, ordering is taste-neutral.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, milesBetween } from './lib.js'
import { useNav } from './nav.jsx'
import { RowFeed } from './cards.jsx'
import { CATEGORIES } from './categories.js'
import { usePlaces } from './places.js'
import { tasteNudge } from './taste.js'
import {
  clearSearchRecents,
  loadSearchRecents,
  parseQuery,
  recordSearchRecent,
  removeSearchRecent,
  searchEvents,
  searchPlaces,
} from './search.js'
import './bubble.css'

// honest zero-state shortcuts: two date-grammar chips + every real category
// from the canonical registry ('other' is a fallback bucket, not a chip) —
// each is literally the query it runs, no hand-waved "popular" claims.
const SUGGESTIONS = [
  'tonight',
  'free this weekend',
  ...CATEGORIES.filter((c) => c.id !== 'other').map((c) => c.label.toLowerCase()),
]

export default function SearchPage({ events, anchors, coords }) {
  const { openDetail, closePage: onClose } = useNav()
  const pgRef = useRef(null) // the scrolling ancestor — RowFeed's IO root
  const inputRef = useRef(null)
  const [q, setQ] = useState('') // live input value
  const [dq, setDq] = useState('') // debounced ~120ms — drives the matcher
  const [recents, setRecents] = useState(loadSearchRecents)
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 120)
    return () => clearTimeout(t)
  }, [q])

  // searchable pool: upcoming (span-aware) plus undated events; _dist attached
  // when App already has a location fix (RowFeed's showDist) — passive only
  const pool = useMemo(() => {
    return events
      .filter((e) => e._day == null || (e._endDay ?? e._day) >= anchors.todayTs)
      .map((e) => ({
        ...e,
        _dist: coords && e.lat != null && e.lng != null ? milesBetween(coords, e) : null,
      }))
  }, [events, anchors, coords])

  // T2: the places pool — the SAME lazy /places.json store the Locations tab
  // uses (usePlaces fires the one-shot fetch on first mount of this page).
  // _dist is attached for the distance pill the same way events get it.
  const { places } = usePlaces()
  const placePool = useMemo(() => {
    if (!Array.isArray(places)) return []
    return places.map((p) => ({
      ...p,
      _dist: coords && p.lat != null && p.lng != null ? milesBetween(coords, p) : null,
    }))
  }, [places, coords])

  const parsed = useMemo(() => parseQuery(dq, anchors), [dq, anchors])
  const results = useMemo(
    // Phase 3.5: a date-only browse ("tonight"/"friday") may tilt by taste; a
    // TEXT query stays taste-neutral (searchEvents only applies nudge on the
    // date-only path). taste read at compute time, like the feed.
    () => (parsed.empty ? [] : searchEvents(pool, anchors, dq, tasteNudge)),
    [parsed, pool, anchors, dq]
  )
  const placeResults = useMemo(
    () => (parsed.empty ? [] : searchPlaces(placePool, anchors, dq)),
    [parsed, placePool, anchors, dq]
  )
  const hasQ = !parsed.empty
  const total = results.length + placeResults.length
  // TWO labeled groups: Events first (the question the home tab answers), then
  // Spots. An empty group renders no header (RowFeed skips label-only sections
  // with no items); a date-constrained query naturally yields zero Spots.
  const eventSection = useMemo(() => [{ label: 'Events', items: results }], [results])
  const placeSection = useMemo(() => [{ label: 'Spots', items: placeResults }], [placeResults])

  // recents record on a tapped result (the query earned its keep) — works for
  // both an event and a place (openDetail branches on kind in App) …
  const select = useCallback(
    (e, el) => {
      setRecents(recordSearchRecent(dq))
      openDetail(e, el)
    },
    [dq, openDetail]
  )
  // … or on a submitted query — flush the debounce so what's recorded is what
  // runs; only queries with ≥1 result (event OR place) are kept (a typo is not
  // a shortcut)
  const submit = () => {
    setDq(q)
    if (
      !parseQuery(q, anchors).empty &&
      (searchEvents(pool, anchors, q).length > 0 || searchPlaces(placePool, anchors, q).length > 0)
    ) {
      setRecents(recordSearchRecent(q))
    }
  }

  const run = (s) => {
    setQ(s) // chips run their query visibly in the input
    inputRef.current?.focus()
  }
  const clear = () => {
    setQ('')
    inputRef.current?.focus()
  }

  return (
    <div className="pg" ref={pgRef}>
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <div className="srch-box">
          <span className="srch-ic" aria-hidden="true">
            🔎
          </span>
          <input
            ref={inputRef}
            className="srch-input"
            type="text"
            enterKeyHint="search"
            placeholder="Search events, venues, vibes…"
            aria-label="Search events"
            autoFocus
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            onKeyDown={(ev) => {
              // Escape clears the query first; a second Escape closes the page (App)
              if (ev.key === 'Escape' && q) {
                ev.stopPropagation()
                setQ('')
              }
              if (ev.key === 'Enter') submit()
            }}
          />
          {q && (
            <button className="srch-clear" onClick={clear} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>
      </header>
      <div className="pg-body">
        {hasQ && total > 0 && (
          <>
            <div className="srch-count">
              {total.toLocaleString('en-US')} result{total === 1 ? '' : 's'} for “{dq.trim()}”
            </div>
            {/* T2: ONE RowFeed over BOTH labeled groups (Events, then Spots) so
                pagination + the end-cap span the union; an empty group renders
                no header. A Spots row opens PlaceDetail via the shared select.
                key resets pagination + replays the stagger per query */}
            <RowFeed
              key={dq.trim()}
              sections={[...eventSection, ...placeSection]}
              showDist={!!coords}
              stagger
              compact
              scrollRootRef={pgRef}
              onSelect={select}
            />
          </>
        )}
        {hasQ && total === 0 && (
          <div className="empty">
            No matches.
            <br />
            Try “trivia” or “free this weekend”.
          </div>
        )}
        {!hasQ && (
          <>
            {recents.length > 0 && (
              <div className="srch-recents">
                <div className="srch-recents-head">
                  <span className="srch-recents-title">Recent</span>
                  <button
                    className="srch-recents-clear"
                    onClick={() => setRecents(clearSearchRecents())}
                    aria-label="Clear recent searches"
                  >
                    Clear
                  </button>
                </div>
                <div className="srch-sug srch-sug--recents">
                  {recents.map((r) => (
                    /* Phase 3.5: each recent is its own chip + a ✕ to drop just
                       that one (no need to Clear all). The ✕ stops propagation
                       so it never runs the query. */
                    <span key={r} className="srch-sug-btn srch-sug-btn--recent srch-recent-chip">
                      <button className="srch-recent-run" onClick={() => run(r)}>
                        {r}
                      </button>
                      <button
                        className="srch-recent-x"
                        aria-label={'Remove ' + r + ' from recent searches'}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setRecents(removeSearchRecent(r))
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className={'empty' + (recents.length ? ' empty-sm' : '')}>
              {events.length.toLocaleString('en-US')} events. One search bar. 🔎
              <br />
              Try one of these:
              <div className="srch-sug">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="srch-sug-btn" onClick={() => run(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
