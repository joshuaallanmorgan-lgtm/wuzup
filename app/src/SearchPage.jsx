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
import { fmtLocale, Icon, milesBetween } from './lib.js'
import { useNav } from './nav.jsx'
import { IntentTile, RowFeed, SecHead } from './cards.jsx'
import { CATEGORIES } from './categories.js'
import { GUIDES } from './guides.js'
import { usePlaces } from './places.js'
import { tasteNudge } from './taste.js'
import {
  clearSearchRecents,
  loadSearchRecents,
  parseQuery,
  recordSearchRecent,
  removeSearchRecent,
  resolveSearchScope,
  searchEvents,
  searchGuides,
  searchPlaces,
} from './search.js'
import './bubble.css'

// honest zero-state shortcuts: two date-grammar chips + every real category
// from the canonical registry ('other' is a fallback bucket, not a chip) —
// each is literally the query it runs, no hand-waved "popular" claims.
// 3.7P-41 (§N screen 9): natural-language example prompts FIRST (each is a real
// query the matcher actually runs — free/date tokens + text), then the category
// shortcuts. No aspirational example that returns nothing.
const NL_EXAMPLES = ['free things tonight', 'music this weekend', 'comedy tonight', 'outdoors this weekend']
const SUGGESTIONS = [
  ...NL_EXAMPLES,
  ...CATEGORIES.filter((c) => c.id !== 'other').map((c) => c.label.toLowerCase()),
]

export default function SearchPage({ events, anchors, coords }) {
  const { openDetail, openGuide, closePage: onClose } = useNav()
  const pgRef = useRef(null) // the scrolling ancestor — RowFeed's IO root
  const inputRef = useRef(null)
  const [q, setQ] = useState('') // live input value
  const [dq, setDq] = useState('') // debounced ~120ms — drives the matcher
  const [recents, setRecents] = useState(loadSearchRecents)
  const [tab, setTab] = useState('all') // 3.7P-41: result-type scope (all/events/spots)
  const updateQuery = useCallback((value) => {
    setQ(value)
  }, [])

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
  const {
    places,
    status: placeStatus,
    recover: recoverPlaces,
    recoverLabel: recoverPlacesLabel,
  } = usePlaces()
  const placesPending = placeStatus === 'idle' || placeStatus === 'loading'
  const placesUnavailable = ['stale', 'offline', 'error'].includes(placeStatus)
  const placePool = useMemo(() => {
    if (!Array.isArray(places)) return []
    return places.map((p) => ({
      ...p,
      _dist: coords && p.lat != null && p.lng != null ? milesBetween(coords, p) : null,
    }))
  }, [places, coords])

  // Debounce the matcher and reconcile the selected scope against the same
  // next-query counts in one timer. A still-valid scope stays selected; only a
  // scope that disappeared resets to All.
  useEffect(() => {
    const t = setTimeout(() => {
      const nextParsed = parseQuery(q, anchors)
      const counts = nextParsed.empty
        ? { events: 0, spots: 0, guides: 0 }
        : {
            events: searchEvents(pool, anchors, q).length,
            spots: searchPlaces(placePool, anchors, q).length,
            guides: searchGuides(GUIDES, q, anchors).length,
          }
      setDq(q)
      setTab((current) => resolveSearchScope(current, counts))
    }, 120)
    return () => clearTimeout(t)
  }, [q, pool, placePool, anchors])

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
  // Stage R: GUIDES are the 4th scope (searchGuides matches name/pov text → real
  // GuidePages). A date/free-only query yields none (a guide has no date/price).
  const guideResults = useMemo(
    () => (parsed.empty ? [] : searchGuides(GUIDES, dq, anchors)),
    [parsed, dq, anchors]
  )
  const hasQ = !parsed.empty
  const total = results.length + placeResults.length + guideResults.length
  const activeTab = resolveSearchScope(tab, {
    events: results.length,
    spots: placeResults.length,
    guides: guideResults.length,
  })
  // Stage R section labels (benchmark): events split into "Best matches" (the
  // top relevance-ranked hits — TRUE because searchEvents sorts by match score on
  // a TEXT query) + "Other events" (the rest). A DATE-ONLY browse isn't relevance-
  // ranked (it is de-flood/taste order), so it stays one honest "Events" group —
  // no "best" claim. Spots → "Spots that fit"; Guides render in their own block.
  const eventSection = useMemo(() => {
    if (!results.length) return []
    // R-S2: only split into Best/Other when there's a REAL remainder (top 3 +
    // more) — don't label a short list "Best matches" with nothing to be best
    // over. Relevance ranking is preserved either way. R-S3: the no-split text
    // label parallels "Spots that fit"; a date-only browse stays a neutral "Events".
    if (parsed.text.length && results.length > 3) {
      return [
        { label: 'Best matches', items: results.slice(0, 3) },
        { label: 'Other events', items: results.slice(3) },
      ]
    }
    return [{ label: parsed.text.length ? 'Events that fit' : 'Events', items: results }]
  }, [results, parsed])
  // R-S1 (honesty): omit the Spots section entirely when there are no place
  // results — never show a "Spots that fit" header over zero spots.
  const placeSection = useMemo(
    () => (placeResults.length ? [{ label: 'Spots that fit', items: placeResults }] : []),
    [placeResults]
  )

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
    updateQuery(s) // chips run their query visibly in the input
    inputRef.current?.focus()
  }
  const clear = () => {
    updateQuery('')
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
            onChange={(ev) => updateQuery(ev.target.value)}
            onKeyDown={(ev) => {
              // Escape clears the query first; a second Escape closes the page (App)
              if (ev.key === 'Escape' && q) {
                ev.stopPropagation()
                updateQuery('')
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
        {hasQ && placesPending && (
          <div className="empty empty-sm" role="status">Checking spot results…</div>
        )}
        {placesUnavailable && (
          <div className="empty empty-sm" role="alert">
            {placeStatus === 'stale'
              ? 'Spot results are too old to show.'
              : placeStatus === 'offline'
                ? 'You’re offline. Spot results weren’t loaded.'
                : 'Spot results couldn’t be verified.'}
            {recoverPlaces && (
              <button className="empty-cta" onClick={recoverPlaces}>{recoverPlacesLabel}</button>
            )}
          </div>
        )}
        {hasQ && total > 0 && (
          <>
            <div className="srch-count">
              {total.toLocaleString(fmtLocale)} verified result{total === 1 ? '' : 's'} for “{dq.trim()}”
            </div>
            {/* 3.7P-41 → Stage R (§N screen 9): result-type tabs scope the union —
                All · Events · Spots · Guides. Only tabs that have results are
                offered (no dead "Guides (0)" tab — honest). */}
            <div className="srch-tabs">
              {[
                { id: 'all', label: 'All', n: total },
                { id: 'events', label: 'Events', n: results.length },
                { id: 'spots', label: 'Spots', n: placeResults.length },
                { id: 'guides', label: 'Guides', n: guideResults.length },
              ]
                .filter((t) => t.id === 'all' || t.n > 0)
                .map((t) => (
                  <button
                    key={t.id}
                    className={'srch-tab' + (activeTab === t.id ? ' on' : '')}
                    onClick={() => setTab(t.id)}
                    aria-pressed={activeTab === t.id}
                  >
                    {t.label} <span className="srch-tab-n">{t.n}</span>
                  </button>
                ))}
            </div>
            {/* events + spots via the shared RowFeed — CARD_LOCK: the kind-aware
                ResultCard renders GemRow per event + SpotCard per place, so this
                mixed feed splits itself per item. Not on the Guides tab (a guide
                isn't a RowFeed item). key resets paging per query+tab. */}
            {activeTab !== 'guides' && (
              <RowFeed
                key={dq.trim() + '|' + activeTab}
                sections={[
                  ...(activeTab === 'all' || activeTab === 'events' ? eventSection : []),
                  ...(activeTab === 'all' || activeTab === 'spots' ? placeSection : []),
                ]}
                stagger
                scrollRootRef={pgRef}
                onSelect={select}
              />
            )}
            {/* Guides — real GuidePages whose name/pov matched the query; shown in
                the All feed (after events/spots) and as the dedicated Guides tab. */}
            {(activeTab === 'all' || activeTab === 'guides') && guideResults.length > 0 && (
              <section className="sec">
                <SecHead overline="Collections" title="Guides" />
                <div className="intent-grid">
                  {guideResults.map((g) => (
                    <IntentTile
                      key={g.id}
                      emoji={g.emoji}
                      label={g.title}
                      pov={g.pov}
                      hue={g.hue}
                      onClick={() => {
                        setRecents(recordSearchRecent(dq))
                        openGuide(g)
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {hasQ && total === 0 && !placesPending && !placesUnavailable && (
          <div className="empty">
            No matches.
            <br />
            Try “trivia” or “free this weekend”.
          </div>
        )}
        {!hasQ && (
          <>
            {/* S1-PS3: a muted, non-interactive preview of the result-scope tabs
                (All · Events · Spots · Guides) — foreshadows the results UI you'll
                get once you search. Decorative (aria-hidden); the real, counted
                tabs render on a live query. */}
            <div className="srch-tabs srch-tabs--preview" aria-hidden>
              {['All', 'Events', 'Spots', 'Guides'].map((l) => (
                <span className="srch-tab" key={l}>
                  {l}
                </span>
              ))}
            </div>
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
              {events.length.toLocaleString(fmtLocale)} events. One search bar. 🔎
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
