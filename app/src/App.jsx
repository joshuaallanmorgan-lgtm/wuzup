import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

// Per-city hero art is a future, multi-city feature; hardcoded to Tampa for now.
const CITY = {
  name: 'Tampa Bay',
  hero: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Tampa_Skyline_-_Eric_Statzer.jpg/1920px-Tampa_Skyline_-_Eric_Statzer.jpg',
}
const VIEWS = [
  { id: 'hot', label: 'Hot' },
  { id: 'map', label: 'Map' },
  { id: 'calendar', label: 'Calendar' },
]
const DAY = 86400000
const PAGE_SIZE = 30

// bubble lens strip: every lens transforms the feed IN PLACE (scroll > click)
const BUBBLES = [
  { id: 'tonight', emoji: '🌙', label: 'Tonight', kind: 'time', value: 'tonight', hue: 250 },
  { id: 'weekend', emoji: '🎉', label: 'This Weekend', kind: 'time', value: 'weekend', hue: 35 },
  { id: 'free', emoji: '🆓', label: 'Free', kind: 'free', value: true, hue: 145 },
  { id: 'near', emoji: '📍', label: 'Near Me', kind: 'sort', value: 'near', hue: 200 },
  { id: 'music', emoji: '🎵', label: 'Music', kind: 'cat', value: 'music', hue: 285 },
  { id: 'food', emoji: '🍔', label: 'Food & Drink', kind: 'cat', value: 'food', hue: 15 },
  { id: 'outdoors', emoji: '🌳', label: 'Outdoors', kind: 'cat', value: 'outdoors', hue: 110 },
  { id: 'sports', emoji: '🏟️', label: 'Sports', kind: 'cat', value: 'sports', hue: 220 },
  { id: 'arts', emoji: '🎨', label: 'Arts', kind: 'cat', value: 'art', hue: 330 },
  { id: 'night', emoji: '🪩', label: 'Nightlife', kind: 'cat', value: 'nightlife', hue: 265 },
  { id: 'comedy', emoji: '😂', label: 'Comedy', kind: 'cat', value: 'comedy', hue: 50 },
  { id: 'theatre', emoji: '🎭', label: 'Theatre', kind: 'cat', value: 'theatre', hue: 350 },
  { id: 'markets', emoji: '🛍️', label: 'Markets', kind: 'cat', value: 'market', hue: 80 },
  { id: 'clubs', emoji: '🤝', label: 'Clubs', kind: 'cat', value: 'community', hue: 175 },
]
const sameLens = (a, b) => (a == null && b == null) || (a != null && b != null && a.kind === b.kind && a.value === b.value)
// hotScore desc, nulls last, ties by start time
const hotDesc = (x, y) => (y.hotScore ?? -Infinity) - (x.hotScore ?? -Infinity) || x._t - y._t

// --- date / formatting helpers ---
function parseDate(iso) {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d) // local midnight, NOT UTC
  }
  const d = new Date(iso)
  return isNaN(d) ? null : d
}
function dayTs(iso) {
  const d = parseDate(iso)
  return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null
}
function dayKey(iso) {
  const d = parseDate(iso)
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : null
}
function timeOf(iso) {
  if (!iso || !/T\d/.test(iso)) return ''
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function dayLabel(ts, anchors) {
  if (ts === anchors.todayTs) return 'Today'
  if (ts === anchors.tomorrowTs) return 'Tomorrow'
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function priceLabel(e) {
  if (e.isFree === true) return 'Free'
  if (e.price > 0) return '$' + e.price
  return null
}
// deterministic gradient for events without an image (keeps the UI colorful)
function gradFor(s) {
  let h = 0
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return `linear-gradient(135deg, hsl(${h} 68% 52%), hsl(${(h + 45) % 360} 72% 42%))`
}
function keyOf(e) {
  return (e.url || e.title || '') + '|' + (e.start || '')
}
function milesBetween(a, b) {
  const R = 3958.8
  const toR = (x) => (x * Math.PI) / 180
  const dLat = toR(b.lat - a.lat)
  const dLng = toR(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// --- schema v2 normalization (defensive: fields may be absent in the file on disk) ---
function normalize(raw, anchors) {
  const tags = Array.isArray(raw.tags) ? raw.tags : []
  const sources = Array.isArray(raw.sources) && raw.sources.length ? raw.sources : raw.source ? [raw.source] : []
  const hotScore = typeof raw.hotScore === 'number' ? raw.hotScore : null
  const buzz = typeof raw.buzz === 'number' ? raw.buzz : Math.max(sources.length, 1)
  const category = typeof raw.category === 'string' && raw.category ? raw.category : 'other'
  const sponsored = raw.sponsored === true
  const _ongoing = tags.includes('ongoing')
  const _day = dayTs(raw.start)
  const _endDay = dayTs(raw.end) ?? _day
  const _t = parseDate(raw.start)?.getTime() ?? Number.MAX_SAFE_INTEGER
  const _free = raw.isFree === true || tags.includes('free')
  const _tonight =
    tags.includes('tonight') || (_day != null && anchors.todayTs >= _day && anchors.todayTs <= (_endDay ?? _day))
  const _weekend =
    tags.includes('weekend') || (_day != null && _day <= anchors.wkEndTs && (_endDay ?? _day) >= anchors.wkStartTs)
  return { ...raw, tags, sources, hotScore, buzz, category, sponsored, _day, _endDay, _t, _free, _tonight, _weekend, _ongoing }
}
// 'ongoing' events show "Ongoing" instead of a stale start date/time
function startLabel(e) {
  return e._ongoing ? 'Ongoing' : timeOf(e.start)
}
function dayLoose(e) {
  return e._ongoing ? 'Ongoing' : dayLabelLoose(e)
}

const Icon = {
  hot: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path
        d="M12.6 2.5c.5 3.2-.9 5.1-2.5 6.9C8.6 11 7 12.7 7 15a5.4 5.4 0 0 0 10.8 0c0-2-.9-3.5-2-4.7-.3 1.2-1 2.2-2.2 2.7.7-2.6.3-7-1-10.5Z"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  ),
  map: (p) => (
    <svg viewBox="0 0 24 24" {...p}><path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Zm0 0v15m6-12v15" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" /></svg>
  ),
  calendar: (p) => (
    <svg viewBox="0 0 24 24" {...p}><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.1" /><path d="M3 9.5h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" /></svg>
  ),
}

function PriceChip({ e }) {
  const label = priceLabel(e)
  if (!label) return null
  return <span className={'chip' + (e.isFree === true ? ' chip-free' : '')}>{label}</span>
}

// 🔥 heat badge: buzz >= 2 gets a flame pill; >= 3 shows the number too (hot palette)
function HeatBadge({ e }) {
  if (typeof e.buzz !== 'number' || e.buzz < 2) return null
  return (
    <span className="heat-badge">
      🔥{e.buzz >= 3 ? <span className="heat-n">{e.buzz}</span> : null}
    </span>
  )
}

// sponsored integrity: never hide, always disclose
function SponsoredTag({ e }) {
  return e.sponsored === true ? <span className="sp-label">Sponsored</span> : null
}

// image box: dark placeholder + 300ms fade-in on load; gradient fallback when no image.
// data-vt marks the element that morphs into the detail hero via View Transitions.
// children render on top (heat badges, FREE badge, …).
function CardImg({ e, className = '', children }) {
  const [ok, setOk] = useState(false)
  return (
    <span
      className={'imgbox ' + className}
      data-vt
      style={e.image ? undefined : { background: gradFor(e.title) }}
    >
      {e.image ? (
        <img
          className={'imgbox-img' + (ok ? ' on' : '')}
          src={e.image}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={() => setOk(true)}
        />
      ) : (
        <span className="imgbox-fall">{startLabel(e) || '★'}</span>
      )}
      {children}
    </span>
  )
}

// compact 58px card — kept for the Calendar agenda
function EventCard({ e, onSelect, index = 0 }) {
  return (
    <button className="card" style={{ animationDelay: Math.min(index, 12) * 22 + 'ms' }} onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="card-thumb" />
      <div className="card-main">
        <div className="card-title">{e.title}</div>
        <div className="card-meta">{[startLabel(e), e.venue].filter(Boolean).join(' · ') || 'Tap for details'}</div>
        <SponsoredTag e={e} />
      </div>
      <PriceChip e={e} />
    </button>
  )
}

// ===================== HOT TAB =====================

function SecHead({ overline, title, sub, onSeeAll }) {
  return (
    <div className="sec-head">
      <div className="sec-head-main">
        {overline && <div className="sec-overline">{overline}</div>}
        <h2 className="sec-title">{title}</h2>
        {sub && <div className="sec-sub">{sub}</div>}
      </div>
      {onSeeAll && (
        <button className="sec-seeall" onClick={onSeeAll}>
          See all
        </button>
      )}
    </div>
  )
}

function TonightCard({ e, onSelect }) {
  return (
    <button className="tcard pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="tcard-img">
        <HeatBadge e={e} />
      </CardImg>
      <div className="tcard-title">{e.title}</div>
      <div className="tcard-meta">{[startLabel(e), e.venue].filter(Boolean).join(' · ') || 'Details inside'}</div>
      <SponsoredTag e={e} />
    </button>
  )
}

function BigOne({ e, onSelect, animate }) {
  const meta = e._ongoing
    ? ['Ongoing', e.venue]
    : [dayLabelLoose(e), timeOf(e.start), e.venue]
  return (
    <button className={'bigone pressable' + (animate ? ' bigone-reveal' : '')} onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="bigone-img">
        <HeatBadge e={e} />
      </CardImg>
      <div className="bigone-grad" />
      <div className="bigone-text">
        <div className="bigone-over">The Big One</div>
        <h2 className="bigone-title">{e.title}</h2>
        <div className="bigone-meta">{meta.filter(Boolean).join(' · ')}</div>
        <SponsoredTag e={e} />
      </div>
    </button>
  )
}
function dayLabelLoose(e) {
  return e._day != null ? new Date(e._day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null
}

function GemRow({ e, onSelect }) {
  return (
    <button className="gem pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="gem-img">
        <HeatBadge e={e} />
      </CardImg>
      <div className="gem-main">
        <div className="gem-title">{e.title}</div>
        <div className="gem-meta">{[dayLoose(e), e.venue].filter(Boolean).join(' · ')}</div>
        <SponsoredTag e={e} />
      </div>
    </button>
  )
}

function FreeCard({ e, onSelect }) {
  return (
    <button className="fcard pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <span className="fcard-imgwrap">
        <CardImg e={e} className="fcard-img" />
        <span className="free-badge">FREE</span>
      </span>
      <div className="fcard-title">{e.title}</div>
      <div className="fcard-meta">{dayLoose(e) || ''}</div>
      <SponsoredTag e={e} />
    </button>
  )
}

function Row({ e, dist, style, onSelect }) {
  return (
    <button className="row pressable" style={style} onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="row-img">
        <HeatBadge e={e} />
      </CardImg>
      <div className="row-main">
        <div className="row-title">{e.title}</div>
        <div className="row-meta">{[startLabel(e), e.venue].filter(Boolean).join(' · ') || 'Tap for details'}</div>
        <div className="row-extra">
          {dist != null && <span className="row-dist">{dist.toFixed(1)} mi</span>}
          <PriceChip e={e} />
          <SponsoredTag e={e} />
        </div>
      </div>
    </button>
  )
}

// vertical feed with optional date headers + infinite paging (30 rows/page)
function RowFeed({ sections, showDist, stagger, scrollRootRef, onSelect }) {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const sentRef = useRef(null)
  const total = sections.reduce((n, s) => n + s.items.length, 0)
  useEffect(() => {
    const s = sentRef.current
    if (!s) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setLimit((l) => (l < total ? l + PAGE_SIZE : l))
      },
      { root: scrollRootRef?.current ?? null, rootMargin: '600px 0px' }
    )
    io.observe(s)
    return () => io.disconnect()
  }, [scrollRootRef, total, limit])

  const out = []
  let count = 0
  let rowIdx = 0
  for (const s of sections) {
    if (count >= limit) break
    const items = s.items.slice(0, limit - count)
    if (s.label && items.length) {
      out.push(
        <div className="feed-date" key={'h' + s.label}>
          {s.label}
        </div>
      )
    }
    for (const it of items) {
      out.push(
        <Row
          key={keyOf(it) + rowIdx}
          e={it}
          dist={showDist ? it._dist : null}
          style={stagger ? { animationDelay: Math.min(rowIdx, 5) * 30 + 'ms' } : undefined}
          onSelect={onSelect}
        />
      )
      rowIdx++
    }
    count += items.length
  }
  return (
    <div className="feed">
      {out}
      {limit < total && <div className="feed-sentinel" ref={sentRef} />}
      {total > 0 && limit >= total && <div className="feed-end">That's everything. Go touch grass 🌴</div>}
    </div>
  )
}

function HotView({ events, anchors, onSelect, loading }) {
  const scrollRef = useRef(null)
  const lensSentRef = useRef(null)
  const bodyRef = useRef(null)
  const evRef = useRef(null)
  const targetRef = useRef(null)
  const swapTRef = useRef(null)
  const swapClearRef = useRef(null)
  const [lensPinned, setLensPinned] = useState(false)
  // lens: null = magazine; otherwise {kind:'time'|'cat'|'sort'|'free', value}
  const [target, setTarget] = useState(null)
  const [applied, setApplied] = useState(null)
  const [fading, setFading] = useState(false)
  const [swapping, setSwapping] = useState(false) // .swapin lives only ~400ms after a lens change
  const [coords, setCoords] = useState(null)
  const [geoNote, setGeoNote] = useState(false)
  const [entered, setEntered] = useState(false) // entrance animations already played?
  const [heroOk, setHeroOk] = useState(false)

  // hero image: preload + 300ms fade (no pop). onload fires even for cached
  // images because the handler is attached before src is set.
  useEffect(() => {
    const img = new Image()
    img.onload = () => setHeroOk(true)
    img.src = CITY.hero
    return () => {
      img.onload = null
    }
  }, [])

  // hero parallax + scrim ramp: one rAF scroll listener writing CSS vars
  useEffect(() => {
    const el = scrollRef.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = el.scrollTop
        el.style.setProperty('--hs', (y * 0.4).toFixed(1) + 'px')
        el.style.setProperty('--scrimo', (0.3 + Math.min(y / 180, 1) * 0.4).toFixed(3))
        ticking = false
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // sticky lens-bar pin detection: 1px sentinel above the bar (pinned-blur mechanics).
  // No reset needed when the lens clears: the bar unmounts with it, and the observer's
  // initial async callback corrects the value as soon as a new lens mounts.
  useEffect(() => {
    if (!applied) return
    const root = scrollRef.current
    const s = lensSentRef.current
    if (!root || !s) return
    const io = new IntersectionObserver(([en]) => setLensPinned(!en.isIntersecting), { root })
    io.observe(s)
    return () => io.disconnect()
  }, [applied])

  // entrance animations: first data paint only, never again (class drops after the
  // longest entrance — 50ms×5 stagger + 700ms reveal — has finished)
  const animate = events.length > 0 && !entered
  useEffect(() => {
    if (!events.length || entered) return
    const t = setTimeout(() => setEntered(true), 1000)
    return () => clearTimeout(t)
  }, [events.length, entered])
  const ent = (i) => (animate ? { className: ' enter', style: { animationDelay: i * 50 + 'ms' } } : { className: '', style: undefined })

  const upcoming = useMemo(() => {
    return events
      .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
      .map((e) => ({ ...e, _clamp: e._day < anchors.todayTs ? anchors.todayTs : e._day }))
      .sort((x, y) => x._clamp - y._clamp || x._t - y._t)
  }, [events, anchors])
  const hasHot = useMemo(() => upcoming.some((e) => e.hotScore != null), [upcoming])
  const tonight = useMemo(() => upcoming.filter((e) => e._tonight).sort(hotDesc), [upcoming])
  const bigOne = useMemo(() => {
    if (!hasHot) return null // hotScore data absent → skip section gracefully
    const oneOffs = upcoming.filter((e) => e.tags.includes('one-off') && e.hotScore != null)
    const pool = oneOffs.length ? oneOffs : upcoming.filter((e) => e.hotScore != null)
    return pool.reduce((best, e) => (best == null || e.hotScore > best.hotScore ? e : best), null)
  }, [upcoming, hasHot])
  const gems = useMemo(() => upcoming.filter((e) => e.tags.includes('hidden-gem')).slice(0, 3), [upcoming])
  const freeWeek = useMemo(
    () => upcoming.filter((e) => e._free && e._clamp <= anchors.todayTs + 6 * DAY).slice(0, 10),
    [upcoming, anchors]
  )
  // Everything: grouped by day, WITHIN each day ordered by hotScore desc (nulls last)
  const evSections = useMemo(() => {
    const m = new Map()
    for (const e of upcoming) {
      if (!m.has(e._clamp)) m.set(e._clamp, [])
      m.get(e._clamp).push(e)
    }
    return [...m.entries()].map(([ts, items]) => ({ label: dayLabel(ts, anchors), items: [...items].sort(hotDesc) }))
  }, [upcoming, anchors])

  // lens mode: one filtered/sorted flat list, memoized for the ~10x data volume
  const lensItems = useMemo(() => {
    if (!applied) return []
    let list = upcoming
    if (applied.kind === 'time' && applied.value === 'tonight') list = list.filter((e) => e._tonight)
    else if (applied.kind === 'time' && applied.value === 'weekend') list = list.filter((e) => e._weekend)
    else if (applied.kind === 'free') list = list.filter((e) => e._free)
    else if (applied.kind === 'cat') list = list.filter((e) => e.category === applied.value)
    if (applied.kind === 'sort' && applied.value === 'near' && coords) {
      return list
        .map((e) => ({ ...e, _dist: e.lat != null && e.lng != null ? milesBetween(coords, e) : null }))
        .sort((x, y) => (x._dist ?? 1e9) - (y._dist ?? 1e9))
    }
    if (hasHot) return [...list].sort(hotDesc)
    return list // hotScore absent → date order fallback
  }, [upcoming, applied, coords, hasHot])
  // date-ordered fallback keeps date headers
  const lensGrouped = applied != null && !hasHot && !(applied.kind === 'sort' && applied.value === 'near')
  const lensSections = useMemo(() => {
    if (!lensGrouped) return [{ label: null, items: lensItems }]
    const m = new Map()
    for (const e of lensItems) {
      if (!m.has(e._clamp)) m.set(e._clamp, [])
      m.get(e._clamp).push(e)
    }
    return [...m.entries()].map(([ts, items]) => ({ label: dayLabel(ts, anchors), items }))
  }, [lensItems, lensGrouped, anchors])

  // re-order feedback: 120ms fade-out / +8px, swap, staggered fade-in; the .swapin
  // class is cleared on a ~400ms timer so paged-in rows never re-animate later
  const changeLens = (next) => {
    const cur = targetRef.current
    if (sameLens(cur, next)) return
    setTarget(next)
    targetRef.current = next
    setFading(true)
    clearTimeout(swapTRef.current)
    clearTimeout(swapClearRef.current)
    swapTRef.current = setTimeout(() => {
      setApplied(next)
      setFading(false)
      setSwapping(true)
      swapClearRef.current = setTimeout(() => setSwapping(false), 400)
    }, 120)
  }
  useEffect(
    () => () => {
      clearTimeout(swapTRef.current)
      clearTimeout(swapClearRef.current)
    },
    []
  )

  const scrollToList = (el) => {
    const sc = scrollRef.current
    if (sc && el) sc.scrollTo({ top: Math.max(el.offsetTop - 64, 0), behavior: 'smooth' })
  }
  // "See all" never pushes a screen: it sets the matching lens and scrolls to the list
  const seeAll = (lens) => {
    changeLens(lens)
    setTimeout(() => scrollToList(bodyRef.current), 150)
  }

  const pickNear = () => {
    if (coords) {
      setGeoNote(false)
      changeLens({ kind: 'sort', value: 'near' })
      return
    }
    if (!navigator.geolocation) {
      setGeoNote(true)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeoNote(false)
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude })
        changeLens({ kind: 'sort', value: 'near' })
      },
      () => setGeoNote(true) // denied → stay put, show the notice
    )
  }

  const tapBubble = (b) => {
    const cur = targetRef.current
    if (cur && cur.kind === b.kind && cur.value === b.value) {
      changeLens(null) // tap the active bubble = back to the magazine
      return
    }
    if (b.kind === 'sort' && b.value === 'near') {
      pickNear()
      return
    }
    setGeoNote(false)
    changeLens({ kind: b.kind, value: b.value })
  }

  const isMag = applied == null
  const swapAnim = swapping && !fading
  const lensKey = applied ? `${applied.kind}:${applied.value}` : 'mag'
  const activeB = applied ? BUBBLES.find((b) => b.kind === applied.kind && b.value === applied.value) : null
  const showDist = applied?.kind === 'sort' && applied?.value === 'near'

  return (
    <div className="hot-scroll" ref={scrollRef}>
      <header className="hero">
        <div className={'hero-img' + (heroOk ? ' on' : '')} style={{ backgroundImage: `url(${CITY.hero})` }} />
        <div className="hero-dim" />
        <div className="hero-grad" />
        <div className="hero-text">
          <div className="hero-kicker">WHAT'S HOT · THIS WEEK</div>
          <h1 className="hero-city">{CITY.name}</h1>
          <div className="hero-sub">{events.length} events near you</div>
        </div>
      </header>

      <div className="bubbles">
        {BUBBLES.map((b) => {
          const on = target != null && target.kind === b.kind && target.value === b.value
          return (
            <button key={b.id} className={'bubble' + (on ? ' on' : '')} style={{ '--bh': b.hue }} onClick={() => tapBubble(b)}>
              <span className="bubble-emoji">{b.emoji}</span>
              <span className="bubble-label">{b.label}</span>
            </button>
          )
        })}
      </div>
      {geoNote && <div className="geo-note">Location unavailable — staying put. Allow location access to use Near Me.</div>}

      {applied && <div className="lens-sentinel" ref={lensSentRef} />}
      {applied && activeB && (
        <div className={'lensbar' + (lensPinned ? ' pinned' : '')}>
          <span className="lensbar-emoji">{activeB.emoji}</span>
          <span className="lensbar-label">{activeB.label}</span>
          <span className="lensbar-count">
            {lensItems.length} event{lensItems.length === 1 ? '' : 's'}
          </span>
          <button className="lensbar-x" onClick={() => changeLens(null)} aria-label="Clear filter">
            ✕
          </button>
        </div>
      )}

      <div ref={bodyRef} key={lensKey} className={'hot-body' + (fading ? ' lens-out' : '') + (swapAnim ? ' swapin' : '')}>
        {isMag ? (
          <>
            {tonight.length > 0 && (
              <section className={'sec' + ent(0).className} style={ent(0).style}>
                <SecHead overline="Happening today" title="Tonight" onSeeAll={() => seeAll({ kind: 'time', value: 'tonight' })} />
                <div className="carousel">
                  {tonight.slice(0, 8).map((e, i) => (
                    <TonightCard key={keyOf(e) + i} e={e} onSelect={onSelect} />
                  ))}
                  <button className="endcap pressable" onClick={() => seeAll({ kind: 'time', value: 'tonight' })}>
                    See all →
                  </button>
                </div>
              </section>
            )}
            {bigOne && (
              <section className={'sec' + ent(1).className} style={ent(1).style}>
                <BigOne e={bigOne} onSelect={onSelect} animate={animate} />
              </section>
            )}
            {gems.length > 0 && (
              <section className={'sec' + ent(2).className} style={ent(2).style}>
                <SecHead overline="Under the radar" title="Hidden Gems" />
                <div className="gems">
                  {gems.map((e, i) => (
                    <GemRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
                  ))}
                </div>
                <button className="gems-more" onClick={() => scrollToList(evRef.current)}>
                  More gems →
                </button>
              </section>
            )}
            {freeWeek.length > 0 && (
              <section className={'sec' + ent(3).className} style={ent(3).style}>
                <SecHead overline="$0 well spent" title="Free This Week" onSeeAll={() => seeAll({ kind: 'free', value: true })} />
                <div className="carousel">
                  {freeWeek.map((e, i) => (
                    <FreeCard key={keyOf(e) + i} e={e} onSelect={onSelect} />
                  ))}
                  <button className="endcap endcap-sq pressable" onClick={() => seeAll({ kind: 'free', value: true })}>
                    See all →
                  </button>
                </div>
              </section>
            )}
            {upcoming.length > 0 && (
              <section className="sec sec-ev" ref={evRef}>
                <div className={ent(4).className.trim()} style={ent(4).style}>
                  <SecHead title="Everything" sub="All upcoming, by date" />
                </div>
                {/* rows themselves never entrance-animate */}
                <RowFeed sections={evSections} scrollRootRef={scrollRef} onSelect={onSelect} />
              </section>
            )}
          </>
        ) : (
          <section className="sec sec-lens">
            {lensItems.length > 0 ? (
              <RowFeed
                sections={lensSections}
                showDist={showDist}
                stagger={swapAnim}
                scrollRootRef={scrollRef}
                onSelect={onSelect}
              />
            ) : (
              <div className="empty">
                Nothing matches that vibe yet 🫥
                <br />
                Tap ✕ to head back to the good stuff.
              </div>
            )}
          </section>
        )}
        {!loading && upcoming.length === 0 && isMag && (
          <div className="empty">
            No upcoming events found.
            <br />
            Re-run the finder to refresh.
          </div>
        )}
      </div>
    </div>
  )
}

// ===================== CALENDAR TAB =====================

function CalendarView({ events, anchors, onSelect }) {
  const [mode, setMode] = useState('list')
  const [selKey, setSelKey] = useState(null) // day timestamp; persists across List/Month toggle
  const [monthOff, setMonthOff] = useState(0)

  const dayMap = useMemo(() => {
    const m = new Map()
    for (const e of events) {
      if (e._day == null) continue
      if (!m.has(e._day)) m.set(e._day, [])
      m.get(e._day).push(e)
    }
    for (const list of m.values()) list.sort((a, b) => a._t - b._t)
    return m
  }, [events])
  const days = useMemo(() => [...dayMap.keys()].sort((a, b) => a - b), [dayMap])
  const sel = selKey ?? days.find((d) => d >= anchors.todayTs) ?? days[0] ?? anchors.todayTs
  const selEvents = dayMap.get(sel) || []

  // p90 of per-day counts drives the heat shading scale
  const p90 = useMemo(() => {
    const counts = days.map((d) => dayMap.get(d).length).sort((a, b) => a - b)
    return counts.length ? Math.max(counts[Math.floor(0.9 * (counts.length - 1))], 1) : 1
  }, [days, dayMap])

  const base = new Date(anchors.todayTs)
  const month = new Date(base.getFullYear(), base.getMonth() + monthOff, 1)
  const monthTitle = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const firstDow = month.getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d).getTime())

  const selTitle = new Date(sel).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="cal-wrap">
      <div className="cal-top">
        <div className="cal-top-row">
          <h2 className="cal-title">Calendar</h2>
          <div className="seg">
            <div className={'seg-thumb' + (mode === 'month' ? ' right' : '')} />
            <button className={'seg-btn' + (mode === 'list' ? ' on' : '')} onClick={() => setMode('list')}>
              List
            </button>
            <button className={'seg-btn' + (mode === 'month' ? ' on' : '')} onClick={() => setMode('month')}>
              Month
            </button>
          </div>
        </div>
        {mode === 'list' && (
          <div className="date-rail">
            {days.map((d) => {
              const dd = new Date(d)
              return (
                <button key={d} className={'date-pill' + (d === sel ? ' active' : '')} onClick={() => setSelKey(d)}>
                  <span className="dp-dow">{dd.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                  <span className="dp-num">{dd.getDate()}</span>
                  <span className="dp-count">{dayMap.get(d).length}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {mode === 'month' ? (
        <div className="cal-fade" key="month">
          <div className="mon-head">
            <h3 className="mon-title">{monthTitle}</h3>
            <div className="mon-navs">
              <button className="mon-nav" onClick={() => setMonthOff((o) => o - 1)} aria-label="Previous month">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button className="mon-nav" onClick={() => setMonthOff((o) => o + 1)} aria-label="Next month">
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
          <div className="mgrid">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div className="mdow" key={d + i}>
                {d}
              </div>
            ))}
            {cells.map((ts, i) => {
              if (ts == null) return <div className="mcell-blank" key={'b' + i} />
              const count = dayMap.get(ts)?.length || 0
              // hot tint at min(count/p90,1)*0.20, quantized to 4 buckets (heat stays warm)
              const heat = count ? (Math.ceil(Math.min(count / p90, 1) * 4) / 4) * 0.2 : 0
              return (
                <button
                  key={ts}
                  className={'mcell' + (ts === sel ? ' sel' : '') + (ts === anchors.todayTs ? ' today' : '')}
                  style={{ '--heat': heat }}
                  onClick={() => setSelKey(ts)}
                >
                  <span className="mcell-bg" />
                  <span className="mnum">{new Date(ts).getDate()}</span>
                </button>
              )
            })}
          </div>
          <h3 className="day-header cal-day">
            {selTitle}
            {selEvents.length ? ` · ${selEvents.length} event${selEvents.length > 1 ? 's' : ''}` : ''}
          </h3>
          <div className="cal-list">
            {selEvents.length ? (
              selEvents.map((e, i) => <EventCard key={keyOf(e) + i} e={e} index={i} onSelect={onSelect} />)
            ) : (
              <div className="empty empty-sm">Nothing scheduled. A rare night off 🌙</div>
            )}
          </div>
        </div>
      ) : (
        <div className="cal-fade" key="list">
          {days.length ? (
            <>
              <h3 className="day-header cal-day">{selTitle}</h3>
              <div className="cal-list">
                {selEvents.length ? (
                  selEvents.map((e, i) => <EventCard key={keyOf(e) + i} e={e} index={i} onSelect={onSelect} />)
                ) : (
                  <div className="empty empty-sm">Nothing scheduled. A rare night off 🌙</div>
                )}
              </div>
            </>
          ) : (
            <div className="empty">No upcoming events found.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ===================== MAP TAB =====================

function MapView({ events, onSelect, active }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const didFitRef = useRef(false)
  useEffect(() => {
    onSelectRef.current = onSelect // markers read the latest handler from a ref —
  }) // marker redraw must NOT depend on a per-render callback identity
  const withCoords = useMemo(() => events.filter((e) => e.lat != null && e.lng != null), [events])
  // create the map exactly once
  useEffect(() => {
    if (mapRef.current || !elRef.current) return
    const map = L.map(elRef.current, { zoomControl: false }).setView([27.95, -82.46], 10)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap © CARTO',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
  }, [])
  // (re)draw markers only when the DATA changes; fitBounds only on first non-empty data
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const markers = []
    for (const e of withCoords) {
      const m = L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: '#0d9488', fillOpacity: 1 })
      m.on('click', () => onSelectRef.current(e))
      m.bindTooltip(e.title, { direction: 'top', offset: [0, -6] })
      m.addTo(layer)
      markers.push(m)
    }
    if (markers.length && !didFitRef.current) {
      didFitRef.current = true
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2))
    }
  }, [withCoords])
  useEffect(() => {
    if (active && mapRef.current) setTimeout(() => mapRef.current.invalidateSize(), 80)
  }, [active])
  return (
    <div className="map-wrap">
      <div ref={elRef} className="map" />
      <div className="map-note">{withCoords.length} of {events.length} events on the map</div>
    </div>
  )
}

// ===================== DETAIL =====================

function DetailPage({ e, closing, vt, onClose }) {
  const day = dayKey(e.start) || 'Date TBD'
  const time = timeOf(e.start)
  const endDay = e.end ? dayKey(e.end) : null
  const when = e._ongoing ? 'Ongoing' + (endDay ? ` · through ${endDay}` : '') : day + (time ? ` · ${time}` : '')
  const via = e.sources && e.sources.length ? e.sources.join(' · ') : e.source
  // detail hero image: preload + 300ms fade over the dark placeholder.
  // Loaded state is keyed to the src, so a new event never flashes the old image.
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
        <div className="detail-hero-grad" />
        <div className="detail-hero-text">
          {priceLabel(e) && <span className={'chip detail-chip' + (e.isFree === true ? ' chip-free' : '')}>{priceLabel(e)}</span>}
          <h1 className="detail-title">{e.title}</h1>
        </div>
      </div>
      <div className="detail-body">
        {e.sponsored === true && <div className="sp-label detail-sp">Sponsored</div>}
        <div className="detail-rows">
          <div className="d-row"><span className="d-ic">📅</span><div><div className="d-k">When</div><div className="d-v">{when}</div></div></div>
          {e.venue && <div className="d-row"><span className="d-ic">📍</span><div><div className="d-k">Where</div><div className="d-v">{e.venue}{e.address ? `, ${e.address}` : ''}</div></div></div>}
          <div className="d-row"><span className="d-ic">🎟️</span><div><div className="d-k">Price</div><div className="d-v">{priceLabel(e) || 'See event for pricing'}</div></div></div>
          {via && <div className="d-row"><span className="d-ic">🔎</span><div><div className="d-k">Found via</div><div className="d-v">{via}</div></div></div>}
        </div>
        {e.description && <p className="detail-desc">{e.description}</p>}
      </div>
      {e.url && (
        <a className="detail-cta" href={e.url} target="_blank" rel="noreferrer">
          Get Tickets <span className="cta-arr">→</span>
        </a>
      )}
    </div>
  )
}

function TabBar({ active, onTab }) {
  return (
    <nav className="tabbar">
      {VIEWS.map((v, i) => {
        const I = Icon[v.id]
        return (
          <button
            key={v.id}
            className={'tab' + (active === i ? ' active' : '') + (v.id === 'hot' ? ' tab-hot' : '')}
            onClick={() => onTab(i)}
          >
            <I className="tab-ic" width="24" height="24" />
            <span className="tab-label">{v.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// ===================== APP =====================

const supportsVT = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [bootVis, setBootVis] = useState(false) // boot overlay gated 300ms (no flash on fast loads)
  const [active, setActive] = useState(0)
  const [detail, setDetail] = useState(null)
  const [closing, setClosing] = useState(false)
  const [vtOpen, setVtOpen] = useState(false)
  const [rolling, setRolling] = useState(false)
  const pagerRef = useRef(null)
  const morphElRef = useRef(null)
  const rollTRef = useRef(null)

  useEffect(() => {
    fetch('/events.json')
      .then((r) => r.json())
      .then((d) => setEvents(Array.isArray(d) ? d : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setBootVis(true), 300)
    return () => clearTimeout(t)
  }, [])

  const anchors = useMemo(() => {
    const n = new Date()
    const at = (off) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + off).getTime()
    const dow = n.getDay()
    const friOff = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow // weekend = Fri–Sun window containing or after today
    return { todayTs: at(0), tomorrowTs: at(1), wkStartTs: at(friOff), wkEndTs: at(friOff + 2) }
  }, [])

  const norm = useMemo(() => events.map((e) => normalize(e, anchors)), [events, anchors])

  // surprise-me pool: top-40 upcoming by hotScore (fallback: any upcoming)
  const dicePool = useMemo(() => {
    const up = norm.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
    const scored = up.filter((e) => e.hotScore != null).sort((x, y) => y.hotScore - x.hotScore)
    return (scored.length ? scored : up).slice(0, 40)
  }, [norm, anchors])

  const goTo = (i) => {
    setActive(i)
    const p = pagerRef.current
    // instant jump: never slide through intermediate pages (finger-swipe snap unaffected)
    if (p) p.scrollTo({ left: i * p.clientWidth, behavior: 'instant' })
  }
  const onScroll = () => {
    const p = pagerRef.current
    if (!p) return
    const i = Math.round(p.scrollLeft / p.clientWidth)
    if (i !== active) setActive(i)
  }

  // detail open/close with App-Store morph: View Transitions when available, slide-up otherwise.
  // useCallback: a stable identity so MapView's marker effect never re-runs because of us.
  const openDetail = useCallback((e, cardEl) => {
    setClosing(false)
    const el = cardEl ? cardEl.querySelector('[data-vt]') : null
    if (supportsVT() && el) {
      morphElRef.current = el
      el.style.viewTransitionName = 'evt-hero' // old snapshot: the card image owns the name
      document.startViewTransition(() => {
        el.style.viewTransitionName = '' // new snapshot: only the detail hero owns it
        flushSync(() => {
          setVtOpen(true)
          setDetail(e)
        })
      })
    } else {
      morphElRef.current = null
      setVtOpen(false)
      setDetail(e)
    }
  }, [])
  const closeDetail = () => {
    const el = morphElRef.current
    if (vtOpen && supportsVT()) {
      const t = document.startViewTransition(() => {
        flushSync(() => setDetail(null))
        if (el && el.isConnected) el.style.viewTransitionName = 'evt-hero'
      })
      t.finished.finally(() => {
        if (el) el.style.viewTransitionName = ''
        morphElRef.current = null
      })
    } else {
      setClosing(true)
      setTimeout(() => {
        setDetail(null)
        setClosing(false)
      }, 240)
    }
  }

  // 🎲 surprise me: quick shake, then open a random top-40-hot event
  const rollDice = () => {
    if (rolling || !dicePool.length) return
    const e = dicePool[Math.floor(Math.random() * dicePool.length)]
    setRolling(true)
    clearTimeout(rollTRef.current)
    rollTRef.current = setTimeout(() => {
      setRolling(false)
      openDetail(e, null)
    }, 520)
  }
  useEffect(() => () => clearTimeout(rollTRef.current), [])

  return (
    <div className="app">
      <div className="pager" ref={pagerRef} onScroll={onScroll}>
        <section className="page page-hot">
          <HotView events={norm} anchors={anchors} onSelect={openDetail} loading={loading} />
        </section>
        <section className="page page-map">
          <MapView events={norm} onSelect={openDetail} active={active === 1} />
        </section>
        <section className="page">
          <CalendarView events={norm} anchors={anchors} onSelect={openDetail} />
        </section>
      </div>
      <TabBar active={active} onTab={goTo} />
      {active === 0 && dicePool.length > 0 && (
        <button className={'dice' + (rolling ? ' rolling' : '')} onClick={rollDice} aria-label="Surprise me">
          🎲
        </button>
      )}
      {detail && <DetailPage e={detail} closing={closing} vt={vtOpen} onClose={closeDetail} />}
      {loading && bootVis && <div className="boot">Loading {CITY.name}…</div>}
    </div>
  )
}
