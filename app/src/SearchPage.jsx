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
// tokens ("friday", "tonight", "weekend"), "free". Results render as ONE flat
// relevance-ranked feed (text relevance, then hotScore — each row's meta line
// already carries its date, so day headers earn nothing here). Recent searches
// ('search-recents-v1', cap 8) record on a tapped result or a submitted query —
// never per keystroke — and surface in the zero-state next to honest chips
// (registry category names + date shortcuts; every chip is a real query that
// runs visibly in the input).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, milesBetween } from './lib.js'
import { useNav } from './nav.jsx'
import { RowFeed } from './cards.jsx'
import { CATEGORIES } from './categories.js'
import {
  clearSearchRecents,
  loadSearchRecents,
  parseQuery,
  recordSearchRecent,
  searchEvents,
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

  const parsed = useMemo(() => parseQuery(dq, anchors), [dq, anchors])
  const results = useMemo(
    () => (parsed.empty ? [] : searchEvents(pool, anchors, dq)),
    [parsed, pool, anchors, dq]
  )
  const hasQ = !parsed.empty
  const total = results.length
  // one flat section: ranked order IS the content; label:null renders no header
  const sections = useMemo(() => [{ label: null, items: results }], [results])

  // recents record on a tapped result (the query earned its keep) …
  const select = useCallback(
    (e, el) => {
      setRecents(recordSearchRecent(dq))
      openDetail(e, el)
    },
    [dq, openDetail]
  )
  // … or on a submitted query — flush the debounce so what's recorded is what
  // runs; only queries with ≥1 result are kept (a typo is not a shortcut)
  const submit = () => {
    setDq(q)
    if (!parseQuery(q, anchors).empty && searchEvents(pool, anchors, q).length > 0) {
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
            {/* key resets pagination + replays the stagger per query */}
            <RowFeed key={dq.trim()} sections={sections} showDist={!!coords} stagger scrollRootRef={pgRef} onSelect={select} />
          </>
        )}
        {hasQ && total === 0 && (
          <div className="empty">
            Nothing for that… yet. 🦗
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
                    <button key={r} className="srch-sug-btn srch-sug-btn--recent" onClick={() => run(r)}>
                      {r}
                    </button>
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
