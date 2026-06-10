// SearchPage — full-page search opened from the 🔎 button in HotView's hero.
// App mounts it inside the sliding .subpage overlay (z 1500, below detail 2000).
//
// Props contract:
//   events   — normalized events
//   anchors  — { todayTs, tomorrowTs, wkStartTs, wkEndTs }
//   onSelect — (event, cardEl|null) opens the detail (stacks on top)
//   onClose  — slide back out to the Hot tab
//
// Behavior: autofocused round input, ~120ms debounce, case/diacritic-insensitive
// AND-token match across title+venue+description+category. Results group by day
// (Today/Tomorrow/weekday) like BubblePage, hotScore desc within a day; undated
// events that match land in a trailing "Anytime" group (never hide events).
import { useEffect, useMemo, useRef, useState } from 'react'
import { dayLabel, hotDesc, Icon } from './lib.js'
import { RowFeed } from './cards.jsx'
import './bubble.css'

// case + diacritic folding ("José" matches "jose")
const fold = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

const SUGGESTIONS = ['trivia', 'market', 'jazz', 'comedy', 'food truck']

export default function SearchPage({ events, anchors, onSelect, onClose }) {
  const pgRef = useRef(null) // the scrolling ancestor — RowFeed's IO root
  const inputRef = useRef(null)
  const [q, setQ] = useState('') // live input value
  const [dq, setDq] = useState('') // debounced ~120ms — drives the filter
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 120)
    return () => clearTimeout(t)
  }, [q])

  // searchable pool indexed once: upcoming (start clamped to today for grouping)
  // plus undated events (_day null → "Anytime"); haystack folded ahead of time
  const indexed = useMemo(() => {
    return events
      .filter((e) => e._day == null || (e._endDay ?? e._day) >= anchors.todayTs)
      .map((e) => ({
        e: { ...e, _clamp: e._day == null ? null : Math.max(e._day, anchors.todayTs) },
        hay: fold([e.title, e.venue, e.description, e.category].filter(Boolean).join(' ')),
      }))
  }, [events, anchors])

  const tokens = useMemo(() => fold(dq.trim()).split(/\s+/).filter(Boolean), [dq])

  const { sections, total } = useMemo(() => {
    if (!tokens.length) return { sections: [], total: 0 }
    const hits = indexed.filter(({ hay }) => tokens.every((t) => hay.includes(t))).map(({ e }) => e)
    const byDay = new Map()
    const undated = []
    for (const e of hits) {
      if (e._clamp == null) {
        undated.push(e)
        continue
      }
      if (!byDay.has(e._clamp)) byDay.set(e._clamp, [])
      byDay.get(e._clamp).push(e)
    }
    const secs = [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, items]) => ({ label: dayLabel(ts, anchors), items: items.sort(hotDesc) }))
    if (undated.length) secs.push({ label: 'Anytime', items: undated.sort(hotDesc) })
    return { sections: secs, total: hits.length }
  }, [indexed, tokens, anchors])

  const hasQ = tokens.length > 0
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
              {total} result{total === 1 ? '' : 's'} for “{dq.trim()}”
            </div>
            {/* key resets pagination + replays the stagger per query */}
            <RowFeed key={tokens.join(' ')} sections={sections} stagger scrollRootRef={pgRef} onSelect={onSelect} />
          </>
        )}
        {hasQ && total === 0 && (
          <div className="empty">
            Nothing for that… yet. 🦗
            <br />
            Try “trivia” or “market”.
          </div>
        )}
        {!hasQ && (
          <div className="empty">
            {events.length} events. One search bar. 🔎
            <br />
            Try one of these:
            <div className="srch-sug">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="srch-sug-btn"
                  onClick={() => {
                    setQ(s)
                    inputRef.current?.focus()
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
