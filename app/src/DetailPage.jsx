// DetailPage — full-page event detail (z 2000, above tabbar/subpages/Leaflet).
// Sprint B "the event's home page": honest when/where rows (end dates, address
// fallback, maps link), trust + identity signals (buzz/sources, category chip,
// gem/staff-pick flags, hero heat badge), 130px non-interactive mini-map
// (tap → Map tab via onFocusMap), event-day weather, utility row (.ics download /
// directions / share), and a More-like-this rail (swaps the detail via onSelect).
// View Transitions open/close logic lives in App.jsx; base detail layout in
// App.css; Sprint-B styles in detail.css. App keys this component by event, so
// a rail swap remounts: scroll resets, the mini-map is destroyed + rebuilt.
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DAY, dayKey, gradFor, hotDesc, keyOf, parseDate, priceLabel, timeOf } from './lib.js'
import { CATEGORY_EMOJI, HeatBadge, SecHead, TonightCard, hueFor } from './cards.jsx'
import { SaveHeart } from './saves.js'
import { whyReasons } from './taste.js'
import { CONDITION, dateKey } from './weather.js'
import './detail.css'

// "7:00 PM" + "10:00 PM" → "7:00–10:00 PM" (collapse a shared meridiem)
function timeRange(start, end) {
  const t1 = timeOf(start)
  const t2 = timeOf(end)
  if (!t1) return t2 || ''
  if (!t2 || t2 === t1) return t1
  // some ICU versions emit a U+202F narrow no-break space before AM/PM (JS \s matches it)
  const m1 = t1.match(/\s(AM|PM)$/)
  const m2 = t2.match(/\s(AM|PM)$/)
  if (m1 && m2 && m1[1] === m2[1]) return t1.slice(0, m1.index) + '–' + t2
  return t1 + '–' + t2
}

// short "Fri, Jun 12" for ranges (long-form dayKey stays on single days)
const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// RFC 5545 VCALENDAR/VEVENT. Date-only events → all-day (VALUE=DATE, exclusive
// DTEND); timed events → local floating wall-clock. Text escaped per RFC
// (backslash, semicolon, comma, newline) and folded at 74 chars.
function icsText(e) {
  const esc = (s) =>
    String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
  const fold = (line) => {
    let s = line
    let out = ''
    // fold at 60 UTF-16 chars: keeps every line under RFC 5545's 75 octets even
    // with multi-byte text, and never lands mid-surrogate-pair in practice
    while (s.length > 60) {
      out += s.slice(0, 60) + '\r\n '
      s = s.slice(60)
    }
    return out + s
  }
  const p = (n) => String(n).padStart(2, '0')
  const dOf = (d) => '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
  const tOf = (d) => dOf(d) + 'T' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  // deterministic UID from url|title+start (same event → same UID → no calendar dupes)
  const idKey = (e.url || e.title || 'event') + '|' + (e.start || '')
  let h = 0
  for (let i = 0; i < idKey.length; i++) h = (h * 31 + idKey.charCodeAt(i)) >>> 0
  const now = new Date()
  const stamp =
    '' + now.getUTCFullYear() + p(now.getUTCMonth() + 1) + p(now.getUTCDate()) +
    'T' + p(now.getUTCHours()) + p(now.getUTCMinutes()) + p(now.getUTCSeconds()) + 'Z'
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Whats Hot Tampa Bay//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + h.toString(36) + '@whats-hot-tampa-bay',
    'DTSTAMP:' + stamp,
  ]
  if (/^\d{4}-\d{2}-\d{2}$/.test(e.start)) {
    const s = parseDate(e.start)
    const last = new Date(e._endDay ?? e._day) // last day the event runs
    const dtend = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) // exclusive
    lines.push('DTSTART;VALUE=DATE:' + dOf(s), 'DTEND;VALUE=DATE:' + dOf(dtend))
  } else {
    const s = parseDate(e.start)
    lines.push('DTSTART:' + tOf(s))
    // timed end → literal; date-only end (timed-start festivals) → midnight
    // after the last day, matching DTSTART's DATE-TIME value type
    const en = e.end
      ? /T\d/.test(e.end)
        ? parseDate(e.end)
        : e._endDay != null && e._endDay > e._day
          ? new Date(new Date(e._endDay).getFullYear(), new Date(e._endDay).getMonth(), new Date(e._endDay).getDate() + 1)
          : null
      : null
    if (en && en.getTime() > s.getTime()) lines.push('DTEND:' + tOf(en))
  }
  lines.push(fold('SUMMARY:' + esc(e.title || 'Event')))
  const loc = [e.venue, e.address].filter(Boolean).join(', ')
  if (loc) lines.push(fold('LOCATION:' + esc(loc)))
  if (e.description) lines.push(fold('DESCRIPTION:' + esc(e.description)))
  if (e.url) lines.push(fold('URL:' + esc(e.url)))
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// tags that say *when* or *where it came from*, not what the event feels like —
// excluded from vibe matching ('added-by-you' is provenance, not a vibe)
const GENERIC_TAGS = new Set(['tonight', 'weekend', 'one-off', 'recurring', 'ongoing', 'added-by-you'])

export default function DetailPage({ e, events = [], anchors, wx, closing, vt, onClose, onSelect, onFocusMap, onRemoveMine, onRestoreMine }) {
  // ===== WHEN: end-date honesty (multi-day ranges, same-day time ranges, ongoing) =====
  let when
  const DAY_MS = 86400000
  // overnight show (ends ≤6 AM the next day) reads as one evening, not a "range"
  const overnight = !!(
    e.end && /T\d/.test(e.end) && e._endDay - e._day === DAY_MS && parseDate(e.end)?.getHours() <= 6
  )
  if (e._ongoing) {
    when = 'Ongoing' + (e._endDay != null && e._endDay !== e._day ? ' · through ' + fmtShort(e._endDay) : '')
  } else if (e._day == null) {
    when = 'Date TBD'
  } else if (overnight) {
    when = dayKey(e.start) + ' · ' + timeRange(e.start, e.end)
  } else if (e._endDay != null && e._endDay !== e._day) {
    when = fmtShort(e._day) + ' – ' + fmtShort(e._endDay)
  } else {
    const sameDayTimedEnd = !!(e.end && /T\d/.test(e.end) && e._endDay === e._day)
    const t = sameDayTimedEnd ? timeRange(e.start, e.end) : timeOf(e.start)
    when = (dayKey(e.start) || fmtShort(e._day)) + (t ? ' · ' + t : '')
  }

  // ===== WHERE: venue, address fallback, Google-Maps link =====
  const whereMain = e.venue || e.address || null
  const whereSub = e.venue && e.address ? e.address : null
  const hasCoords = e.lat != null && e.lng != null
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
    : whereMain
      ? 'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent([e.venue, e.address].filter(Boolean).join(', '))
      : null

  // ===== trust + transparency (G3): ONE honest block. whyReasons (taste.js)
  // composes only TRUE chips — buzz≥2, free, tonight/this-weekend (live
  // anchors-math, not baked tags), hidden-gem, staff-pick, sponsored
  // disclosure, and "You open a lot of {category}" ONLY when the taste nudge
  // actually boosted this event (>5 pts). The old Buzz/gem/staff rows merge
  // in here rather than duplicating; zero reasons → no why-line at all, just
  // the plain found-via row. =====
  const via = e.sources && e.sources.length ? e.sources.join(' · ') : e.source
  const multiSource = typeof e.buzz === 'number' && e.buzz >= 2
  const why = whyReasons(e)

  // ===== user-added event? (Add Event MVP) — provenance label + Remove =====
  const mine = Array.isArray(e.tags) && e.tags.includes('added-by-you')

  // ===== event-day weather (only within the 16-day forecast window) =====
  const w = wx && e._day != null ? wx[dateKey(e._day)] : null
  const wxLine = w
    ? [
        (CONDITION[w.emoji] || 'Forecast') + ' that day',
        w.hi != null ? `high ${w.hi}°` : null,
        w.rain != null ? `${w.rain}% rain` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  // ===== detail hero image: preload + 300ms fade over the dark placeholder =====
  const [loadedSrc, setLoadedSrc] = useState(null)
  useEffect(() => {
    if (!e.image) return
    const src = e.image
    const img = new Image()
    img.onload = () => setLoadedSrc(src)
    img.src = src
    return () => {
      img.onload = null
    }
  }, [e.image])
  const imgOk = loadedSrc === e.image

  // ===== mini-map: lazy non-interactive Leaflet, DESTROYED on unmount =====
  const mapElRef = useRef(null)
  useEffect(() => {
    const el = mapElRef.current
    if (e.lat == null || e.lng == null || !el) return
    const m = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      touchZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    }).setView([e.lat, e.lng], 14)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(m)
    L.circleMarker([e.lat, e.lng], {
      radius: 8,
      color: '#fff',
      weight: 2.5,
      fillColor: '#0d9488',
      fillOpacity: 1,
      interactive: false,
    }).addTo(m)
    // detail mounts mid open-animation; one size sanity pass after it settles
    const t = setTimeout(() => m.invalidateSize(), 280)
    return () => {
      clearTimeout(t)
      m.remove() // tears down panes, layers and ALL listeners — no leaks on close
    }
  }, [e.lat, e.lng])

  // ===== More like this: same category first, then nearby-in-time same-vibe; hot first =====
  const similar = useMemo(() => {
    if (!events.length || !anchors) return []
    const self = keyOf(e)
    const seen = new Set([self])
    const upcoming = events.filter(
      (x) => keyOf(x) !== self && x._day != null && (x._endDay ?? x._day) >= anchors.todayTs
    )
    const picks = []
    const take = (list) => {
      for (const x of list) {
        const k = keyOf(x)
        if (seen.has(k)) continue
        seen.add(k)
        picks.push(x)
        if (picks.length >= 4) return true
      }
      return false
    }
    if (e.category && e.category !== 'other') {
      if (take(upcoming.filter((x) => x.category === e.category).sort(hotDesc))) return picks
    }
    const vibes = new Set((e.tags || []).filter((t) => !GENERIC_TAGS.has(t)))
    const nearTime = (x) => e._day == null || Math.abs(x._day - e._day) <= 3 * DAY
    take(
      upcoming
        .filter((x) => nearTime(x) && (vibes.size === 0 || x.tags.some((t) => vibes.has(t))))
        .sort(hotDesc)
    )
    return picks
  }, [events, anchors, e])

  // ===== utility row: .ics download / directions / share-or-copy + toast =====
  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1600)
  }
  const downloadIcs = () => {
    if (!e.start) return
    const blob = new Blob([icsText(e)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const name = (e.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
    a.download = (name || 'event') + '.ics'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const share = async () => {
    const url = e.url || window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: e.title, text: e.title, url })
      } catch {
        /* user dismissed the share sheet — not an error */
      }
    } else if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url)
        flash('Link copied ✓')
      } catch {
        flash("Couldn't copy link")
      }
    } else {
      flash("Sharing isn't available here")
    }
  }

  // ===== Remove (added events only): instant delete from my-events + 6s undo.
  // The open detail keeps showing the removed event so Undo can restore it;
  // closing during/after the window simply commits the removal. =====
  const [undoVis, setUndoVis] = useState(false)
  const undoTRef = useRef(null)
  useEffect(() => () => clearTimeout(undoTRef.current), [])
  const removeMine = () => {
    if (!onRemoveMine) return
    onRemoveMine(e)
    setUndoVis(true)
    clearTimeout(undoTRef.current)
    undoTRef.current = setTimeout(() => setUndoVis(false), 6000)
  }
  const undoRemove = () => {
    clearTimeout(undoTRef.current)
    setUndoVis(false)
    if (onRestoreMine) onRestoreMine(e)
    flash('Restored ✓')
  }

  return (
    <div className={'detail' + (closing ? ' detail-closing' : '') + (vt ? ' detail-vt' : '')}>
      <div
        className="detail-hero"
        style={{ viewTransitionName: 'evt-hero', background: e.image ? '#1d212a' : gradFor(e.title) }}
      >
        {e.image && (
          <div className={'detail-hero-img' + (imgOk ? ' on' : '')} style={{ backgroundImage: `url(${e.image})` }} />
        )}
        <button className="detail-back" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {/* ♥ save toggle (saves.js) — heat badge slides left of it via saves.css */}
        <SaveHeart e={e} big />
        <HeatBadge e={e} />
        <div className="detail-hero-grad" />
        <div className="detail-hero-text">
          {priceLabel(e) && <span className={'chip detail-chip' + (e.isFree === true ? ' chip-free' : '')}>{priceLabel(e)}</span>}
          {e.category !== 'other' && (
            <span className="chip detail-chip detail-catchip" style={{ '--ch': hueFor(e) }}>
              {CATEGORY_EMOJI[e.category] ?? '⭐'} {e.category}
            </span>
          )}
          <h1 className="detail-title">{e.title}</h1>
        </div>
      </div>
      <div className="detail-body">
        {e.sponsored === true && <div className="sp-label detail-sp">Sponsored</div>}
        {mine && <div className="sp-label my-label detail-sp">Added by you</div>}
        <div className="detail-rows">
          <div className="d-row"><span className="d-ic">📅</span><div><div className="d-k">When</div><div className="d-v">{when}</div></div></div>
          {whereMain && (
            <a className="d-row" href={mapsUrl} target="_blank" rel="noreferrer">
              <span className="d-ic">📍</span>
              <div>
                <div className="d-k">Where</div>
                <div className="d-v">{whereMain}<span className="d-ext">↗</span></div>
                {whereSub && <div className="d-sub">{whereSub}</div>}
              </div>
            </a>
          )}
          <div className="d-row"><span className="d-ic">🎟️</span><div><div className="d-k">Price</div><div className="d-v">{priceLabel(e) || 'See event for pricing'}</div></div></div>
          {wxLine && (
            <div className="d-row"><span className="d-ic">{w.emoji}</span><div><div className="d-k">Weather</div><div className="d-v">{wxLine}</div></div></div>
          )}
          {why.length > 0 ? (
            <div className="d-row">
              <span className="d-ic">{multiSource ? '🔥' : '🧭'}</span>
              <div>
                <div className="d-k">Why this is here</div>
                <div className="why-chips">
                  {why.map((r) => (
                    <span className="why-chip" key={r}>
                      {r}
                    </span>
                  ))}
                </div>
                {via && <div className="d-sub">{multiSource ? via : 'Found via ' + via}</div>}
              </div>
            </div>
          ) : via ? (
            <div className="d-row"><span className="d-ic">🔎</span><div><div className="d-k">Found via</div><div className="d-v">{via}</div></div></div>
          ) : null}
        </div>
        {hasCoords && (
          <div className="mini-map">
            <div className="mini-map-canvas" ref={mapElRef} />
            <button className="mini-map-tap" onClick={() => onFocusMap(e)} aria-label="Open in the Map tab">
              <span className="mini-map-hint">Open in Map ↗</span>
            </button>
          </div>
        )}
        {e.description && (
          <div className="detail-about">
            <div className="d-k">About</div>
            <p className="detail-desc">{e.description}</p>
          </div>
        )}
        <div className="util-row">
          {e.start && (
            <button className="util-btn" onClick={downloadIcs}>📅 Calendar</button>
          )}
          {mapsUrl && (
            <a className="util-btn" href={mapsUrl} target="_blank" rel="noreferrer">🧭 Directions</a>
          )}
          <button className="util-btn" onClick={share}>🔗 Share</button>
        </div>
        {mine && onRemoveMine && (
          <button className="d-remove" onClick={removeMine} disabled={undoVis}>
            Remove from my feed
          </button>
        )}
        {similar.length > 0 && (
          <div className="detail-rail">
            <SecHead overline="Keep the night going" title="More like this" />
            <div className="carousel">
              {similar.map((x) => (
                /* swap in place: null cardEl skips the VT morph (the detail is already open) */
                <TonightCard key={keyOf(x)} e={x} onSelect={(e2) => onSelect(e2, null)} />
              ))}
            </div>
          </div>
        )}
      </div>
      {toast && <div className="detail-toast">{toast}</div>}
      {undoVis && (
        <div className="detail-toast undo-toast">
          Removed from your feed
          <button className="undo-btn" onClick={undoRemove}>
            Undo
          </button>
        </div>
      )}
      {e.url && (
        <a className="detail-cta" href={e.url} target="_blank" rel="noreferrer">
          {/* "Get Tickets" only when there's actually something to buy */}
          {e.isFree === true || !(e.price > 0) ? (
            <>
              View event <span className="cta-arr">↗</span>
            </>
          ) : (
            <>
              Get Tickets <span className="cta-arr">→</span>
            </>
          )}
        </a>
      )}
    </div>
  )
}
