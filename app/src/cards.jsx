/* eslint-disable react-refresh/only-export-components --
   the interface contract pins DISPLAY_MODES / DisplayModeContext / useDisplayMode /
   CATEGORY_HUES / hueFor to this file alongside the card components; the rule only
   affects dev-time Fast Refresh granularity, not runtime behavior. */
// cards.jsx — shared card/row building blocks + the display-mode mechanism.
//
// DISPLAY MODE: React context (canonical). App owns the state (persisted to
// localStorage 'display-mode') and wraps the tree in <DisplayModeContext.Provider
// value={{ mode, setMode }}>. Any card component reads the current mode with
// `useDisplayMode()` → 'editorial' | 'poster' | 'cinematic'. <DisplayModeToggle/>
// (the 🎨 pill, mounted by App bottom-left) cycles through DISPLAY_MODES.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { dayLabelLoose, dayLoose, gradFor, keyOf, priceLabel, startLabel, timeOf } from './lib.js'
import { SaveHeart, useSaves } from './saves.js'
import { dateKey } from './weather.js'
import './cards.css'
import './modes.css'

const PAGE_SIZE = 30

// presentational hook only: lib's startLabel may emit "Started 7:00 PM" for
// already-underway events — metas that LEAD with it read quieter (.meta-started)
const startedCls = (m) => (m.startsWith('Started') ? ' meta-started' : '')

export const DISPLAY_MODES = ['editorial', 'poster', 'cinematic']
export const DisplayModeContext = createContext({ mode: 'editorial', setMode: () => {} })
export function useDisplayMode() {
  return useContext(DisplayModeContext).mode
}

// 16-day forecast map { 'YYYY-MM-DD': {emoji,hi,rain} } | null — App owns the
// single getForecast() fetch and provides it here; outdoor rows show a rain hint.
export const WxContext = createContext(null)

// one hue per category — reused by every mode (spine, glow, overline tint)
export const CATEGORY_HUES = {
  music: 265,
  nightlife: 320,
  food: 25,
  market: 45,
  outdoors: 140,
  sports: 210,
  art: 285,
  theatre: 350,
  comedy: 15,
  family: 190,
  community: 170,
  other: 220,
}
export const hueFor = (e) => CATEGORY_HUES[e.category] ?? CATEGORY_HUES.other

// one emoji per category — poster-mode artwork for events without an image
export const CATEGORY_EMOJI = {
  music: '🎵',
  sports: '🏟️',
  art: '🎨',
  theatre: '🎭',
  comedy: '😂',
  food: '🍔',
  market: '🛍️',
  outdoors: '🌳',
  nightlife: '🪩',
  family: '👨‍👩‍👧',
  community: '🤝',
  other: '⭐',
}

// 🎨 pill: cycles editorial → poster → cinematic. key={mode} remounts the label
// so it plays a tiny flash (opacity/transform pop) on every switch.
export function DisplayModeToggle() {
  const { mode, setMode } = useContext(DisplayModeContext)
  const next = DISPLAY_MODES[(DISPLAY_MODES.indexOf(mode) + 1) % DISPLAY_MODES.length]
  return (
    <button className="dm-toggle" onClick={() => setMode(next)} aria-label={`Display mode: ${mode} (tap for ${next})`}>
      🎨{' '}
      <span className="dm-label" key={mode}>
        {mode}
      </span>
    </button>
  )
}

export function PriceChip({ e }) {
  const label = priceLabel(e)
  if (!label) return null
  return <span className={'chip' + (e.isFree === true ? ' chip-free' : '')}>{label}</span>
}

// 🔥 heat badge: buzz >= 2 gets a flame pill; >= 3 shows the number too (hot palette)
export function HeatBadge({ e }) {
  if (typeof e.buzz !== 'number' || e.buzz < 2) return null
  return (
    <span className="heat-badge">
      🔥{e.buzz >= 3 ? <span className="heat-n">{e.buzz}</span> : null}
    </span>
  )
}

// provenance integrity: never hide, always disclose — paid placement
// ("Sponsored", muted) and user-submitted data ("Added by you", accent) share
// this slot, so user-added events are labeled everywhere a sponsored label
// would show (the Add Event invariant)
export function SponsoredTag({ e }) {
  return (
    <>
      {e.sponsored === true && <span className="sp-label">Sponsored</span>}
      {e.tags?.includes('added-by-you') && <span className="sp-label my-label">Added by you</span>}
    </>
  )
}

// image box: dark placeholder + 300ms fade-in on load; gradient fallback when no image.
// data-vt marks the element that morphs into the detail hero via View Transitions.
// children render on top (heat badges, FREE badge, …).
export function CardImg({ e, className = '', children }) {
  const [ok, setOk] = useState(false)
  const mode = useDisplayMode()
  // poster tiles are image-first: a time-as-artwork fallback would just repeat
  // the meta line, so poster mode shows the category emoji instead. Artwork is
  // the TIME, not the status — strip startLabel's "Started " prefix here only.
  const fall =
    mode === 'poster'
      ? CATEGORY_EMOJI[e.category] ?? CATEGORY_EMOJI.other
      : startLabel(e).replace(/^Started /, '') || '★'
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
        <span className="imgbox-fall">{fall}</span>
      )}
      {children}
    </span>
  )
}

// compact 58px card — kept for the Calendar agenda (saved events show their ♥)
export function EventCard({ e, onSelect, index = 0 }) {
  const { has } = useSaves()
  const meta = [startLabel(e), e.venue].filter(Boolean).join(' · ')
  return (
    <button className="card" style={{ animationDelay: Math.min(index, 12) * 22 + 'ms' }} onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="card-thumb" />
      <div className="card-main">
        <div className="card-title">{e.title}</div>
        <div className={'card-meta' + startedCls(meta)}>{meta || 'Tap for details'}</div>
        <SponsoredTag e={e} />
      </div>
      {has(e) && <span className="card-heart" aria-hidden>♥</span>}
      <HeatBadge e={e} />
      <PriceChip e={e} />
    </button>
  )
}

export function SecHead({ overline, title, sub, onSeeAll }) {
  return (
    <div className="sec-head">
      <div className="sec-head-main">
        {overline && <div className="sec-overline">{overline}</div>}
        <h2 className="sec-title">{title}</h2>
        {sub && <div className="sec-sub">{sub}</div>}
      </div>
      {onSeeAll && (
        <button className="sec-seeall pressable" onClick={onSeeAll}>
          See all
        </button>
      )}
    </div>
  )
}

export function TonightCard({ e, onSelect, withDate = false }) {
  // withDate: shelf/cross-day contexts where the DATE is the headline fact
  const meta = [withDate ? dayLabelLoose(e) : null, startLabel(e), e.venue].filter(Boolean).join(' · ')
  return (
    <button className="tcard pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="tcard-img">
        <SaveHeart e={e} />
        <HeatBadge e={e} />
      </CardImg>
      <div className="tcard-title">{e.title}</div>
      <div className={'tcard-meta' + startedCls(meta)}>{meta || 'Details inside'}</div>
      <SponsoredTag e={e} />
    </button>
  )
}

export function BigOne({ e, onSelect, animate }) {
  const meta = e._ongoing
    ? ['Ongoing', e.venue]
    : [dayLabelLoose(e), timeOf(e.start), e.venue]
  return (
    <button className={'bigone pressable' + (animate ? ' bigone-reveal' : '')} onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="bigone-img">
        <SaveHeart e={e} />
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

export function GemRow({ e, onSelect }) {
  return (
    <button className="gem pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="gem-img">
        <SaveHeart e={e} />
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

export function FreeCard({ e, onSelect }) {
  return (
    <button className="fcard pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <span className="fcard-imgwrap">
        <CardImg e={e} className="fcard-img">
          <SaveHeart e={e} />
          <HeatBadge e={e} />
        </CardImg>
        <span className="free-badge">FREE</span>
      </span>
      <div className="fcard-title">{e.title}</div>
      <div className="fcard-meta">{dayLoose(e) || ''}</div>
      <SponsoredTag e={e} />
    </button>
  )
}

// dashed "See all →" end-cap for carousels (square variant for the 160px free cards)
export function EndCap({ square, onClick, children = 'See all →' }) {
  return (
    <button className={'endcap pressable' + (square ? ' endcap-sq' : '')} onClick={onClick}>
      {children}
    </button>
  )
}

// the Everything/feed row — three live-switchable treatments (DisplayModeToggle):
//   editorial — 110px image left, category overline + spine in the category hue,
//               FREE overlay on the image (folded in from poster), heat badge /
//               price chip (priced only) / distance in a right-aligned rail
//   poster    — 2-up image-first grid (1:1, hue glow ring, FREE overlay), scan-fast
//   cinematic — 92px full-width cover card, 0.55 scrim, white text bottom-left
// Same props in every mode; CardImg keeps [data-vt] so the detail morph works.
export function Row({ e, dist, style, onSelect }) {
  const mode = useDisplayMode()
  // outdoor events on a rainy forecast day carry a tiny honesty hint in the meta
  const wx = useContext(WxContext)
  const wxDay = e.category === 'outdoors' && e._day != null && wx ? wx[dateKey(e._day)] : null
  const rain = wxDay && wxDay.rain != null && wxDay.rain >= 30 ? '🌧 ' + wxDay.rain + '%' : null
  const st = { ...style, '--ch': hueFor(e) }
  const open = (ev) => onSelect(e, ev.currentTarget)
  const mi = dist != null ? dist.toFixed(1) + ' mi' : null
  const free = e._free === true || e.isFree === true

  if (mode === 'poster') {
    const meta = [...(e._ongoing ? ['Ongoing'] : [dayLoose(e), timeOf(e.start)]), mi, free ? null : priceLabel(e), rain]
      .filter(Boolean)
      .join(' · ')
    return (
      <button className="row row--poster pressable" style={st} onClick={open}>
        <CardImg e={e} className="row-img">
          <SaveHeart e={e} />
          <HeatBadge e={e} />
          {free && <span className="free-badge">FREE</span>}
        </CardImg>
        <div className="row-title">{e.title}</div>
        <div className="row-meta">{meta || 'Tap for details'}</div>
        <SponsoredTag e={e} />
      </button>
    )
  }

  if (mode === 'cinematic') {
    const meta = [...(e._ongoing ? ['Ongoing'] : [startLabel(e)]), e.venue, mi, priceLabel(e), rain]
      .filter(Boolean)
      .join(' · ')
    return (
      <button className="row row--cinematic pressable" style={st} onClick={open}>
        <CardImg e={e} className="row-img">
          <span className="row-scrim" />
          <SaveHeart e={e} />
          <HeatBadge e={e} />
        </CardImg>
        <div className="row-text">
          <div className="row-title">{e.title}</div>
          <div className={'row-meta' + startedCls(meta)}>{meta || 'Tap for details'}</div>
          <SponsoredTag e={e} />
        </div>
      </button>
    )
  }

  // editorial (default)
  const meta = (e._ongoing ? ['Ongoing', e.venue, rain] : [dayLabelLoose(e), timeOf(e.start), e.venue, rain])
    .filter(Boolean)
    .join(' · ')
  return (
    <button className="row row--editorial pressable" style={st} onClick={open}>
      <CardImg e={e} className="row-img">
        <SaveHeart e={e} />
        {/* poster's best element folded in (tasting verdict): FREE overlay */}
        {free && <span className="free-badge">FREE</span>}
      </CardImg>
      <div className="row-main">
        {/* 'other' is a fallback bucket, not a real category — no overline */}
        {e.category !== 'other' && <div className="row-cat">{e.category}</div>}
        <div className="row-title">{e.title}</div>
        <div className="row-meta">{meta || 'Tap for details'}</div>
        <SponsoredTag e={e} />
      </div>
      <div className="row-side">
        <HeatBadge e={e} />
        {/* free-ness lives on the image badge now — rail chip only for priced */}
        {!free && <PriceChip e={e} />}
        {mi && <span className="row-dist">{mi}</span>}
      </div>
    </button>
  )
}

// vertical feed with optional date headers + infinite paging (30 rows/page).
// sections: [{ label: string|null, items: event[] }]. stagger=true plays a one-shot
// staggered rise on the first 6 rows (use when a page swaps its list in).
// endSlot (H4): an optional node that REPLACES the default end-of-feed line
// once the whole list is rendered (HotView's session recap card).
export function RowFeed({ sections, showDist, stagger, scrollRootRef, endSlot, onSelect }) {
  const mode = useDisplayMode()
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
  // .mode-cinematic scopes the near-black list backdrop (list container only)
  const cls = 'feed feed--' + mode + (mode === 'cinematic' ? ' mode-cinematic' : '') + (stagger ? ' feed-stagger' : '')
  return (
    <div className={cls}>
      {out}
      {limit < total && <div className="feed-sentinel" ref={sentRef} />}
      {total > 0 && limit >= total && (endSlot ?? <div className="feed-end">That's everything. Go touch grass 🌴</div>)}
    </div>
  )
}
