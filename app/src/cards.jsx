/* eslint-disable react-refresh/only-export-components --
   the interface contract pins WxContext / CATEGORY_HUES / hueFor to this file
   alongside the card components; the rule only affects dev-time Fast Refresh
   granularity, not runtime behavior. */
// cards.jsx — shared card/row building blocks.
//
// DISPLAY MODES RETIRED (Q2a, Josh 2026-06-11: "editorial main, poster flavor,
// cinematic seasoning"): editorial IS the design — the mode context, the
// settings toggle and the poster/cinematic row treatments are gone. Poster's
// wins live on inside editorial (FREE overlay, hue energy); cinematic survives
// only as bespoke styling on naturally dark surfaces (FMN, Big One) — their
// own CSS, not a mode.
import { createContext, memo, useContext, useEffect, useRef, useState } from 'react'
import { CATEGORY_EMOJI, CATEGORY_HUES, PLACETYPE_EMOJI, PLACETYPE_HUE } from './categories.js'
import { Icon, dayLabelLoose, dayLoose, keyOf, priceLabel, startLabel, timeOf } from './lib.js'
import { imageMode } from './imageMode.js'
import { daypartOf } from './weekend.js'
import { SaveHeart, useSaves } from './saves.js'
import { dateKey } from './weather.js'
import './cards.css'
import './modes.css'

const PAGE_SIZE = 30

// presentational hook only: lib's startLabel may emit "Started 7:00 PM" for
// already-underway events — metas that LEAD with it read quieter (.meta-started)
const startedCls = (m) => (m.startsWith('Started') ? ' meta-started' : '')

// 16-day forecast map { 'YYYY-MM-DD': {emoji,hi,rain} } | null — App owns the
// single getForecast() fetch and provides it here; outdoor rows show a rain hint.
export const WxContext = createContext(null)

// one hue per category (spine, glow, overline tint) + one emoji per category
// (imgbox-art watermark for events without an image). Both maps now DERIVE
// from the canonical registry (categories.js, Sprint O audit prep #7) and are
// re-exported here as shims so MapView/DetailPage/etc. keep importing from
// cards.jsx unchanged — values verified identical to the old literals.
export { CATEGORY_EMOJI, CATEGORY_HUES } from './categories.js'
// 3.7P-36: re-export the imageMode gate so card consumers (DecisionCard/P42,
// Spots rows/P24) import it from the cards module alongside the components.
export { imageMode }
export const hueFor = (e) => {
  // 3.73a: places are placeType-keyed (beach/trail/pier/dog-park each distinct)
  // — kills the green-on-green wall; everything else stays category-keyed.
  if (e?.kind === 'place' && PLACETYPE_HUE[e.placeType] != null) return PLACETYPE_HUE[e.placeType]
  return CATEGORY_HUES[e.category] ?? CATEGORY_HUES.other
}
// the art-floor watermark emoji — placeType-specific for places (a beach reads
// 🏖️, not the generic outdoors 🌳), category emoji otherwise.
export const artEmoji = (e) => {
  if (e?.kind === 'place' && PLACETYPE_EMOJI[e.placeType]) return PLACETYPE_EMOJI[e.placeType]
  return CATEGORY_EMOJI[e.category] ?? CATEGORY_EMOJI.other
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

// image box: dark placeholder + 300ms fade-in on load. No-image events get the
// I3 designed composition instead of an empty block: .imgbox-art layers a
// category-hue gradient (via --ch / CATEGORY_HUES) under an oversized rotated
// CATEGORY_EMOJI watermark (.imgbox-mark, cqmin-sized so the SAME composition
// holds from the 58px agenda thumb to the 420px BigOne), with the existing
// time/emoji foreground on top. Pure CSS + emoji — no assets, no canvas.
// data-vt marks the element that morphs into the detail hero via View Transitions.
// children render on top (heat badges, FREE badge, …).
export function CardImg({ e, className = '', children }) {
  const [ok, setOk] = useState(false)
  const [failed, setFailed] = useState(false)
  const emoji = artEmoji(e)
  // artwork is the TIME, not the status — strip startLabel's "Started " prefix here only
  const fall = startLabel(e).replace(/^Started /, '') || '★'
  // W4 trust contract: a dead/broken image URL degrades to the category-art
  // FLOOR (the designed hue + emoji), never the browser's broken-image glyph and
  // never a flat dark box. onError flips to art; a real photo never regresses.
  // (3.7P-36 review: a successfully-LOADED photo is real content and is NEVER
  // swapped for the art floor — the floor is for no-image + onError only. The
  // "poster → small thumb / no green placeholder" win is delivered by the cards
  // that CONSUME imageMode() at layout time, P42's CompactRow, not a CardImg
  // runtime crop that mismatched the cover detail-hero it View-Transitions into.)
  const showArt = !e.image || failed
  return (
    <span
      className={'imgbox ' + className + (showArt ? ' imgbox-art' : '')}
      data-vt
      style={showArt ? { '--ch': hueFor(e) } : undefined}
    >
      {!showArt ? (
        <img
          className={'imgbox-img' + (ok ? ' on' : '')}
          src={e.image}
          alt=""
          loading="lazy"
          draggable={false}
          onLoad={() => setOk(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <span className="imgbox-mark" aria-hidden>
            {emoji}
          </span>
          <span className="imgbox-fall">{fall}</span>
        </>
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
        {/* Stage R (R-H2): bold ink title LEADS; the descriptor sits underneath in
            muted gray. The orange overline-on-top is retired — `sub` is the
            descriptor, `overline` only the fallback when there's no `sub` (so we
            keep the more specific gray subline and drop redundant eyebrows). */}
        <h2 className="sec-title">{title}</h2>
        {(sub || overline) && <div className="sec-sub">{sub || overline}</div>}
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
  // withDate: shelf/cross-day contexts where the DATE is the headline fact.
  // Ongoing events show "Ongoing" (dayLoose), never their weeks-old start date;
  // the uniqueness filter stops it doubling with startLabel's own "Ongoing".
  const meta = [withDate ? dayLoose(e) : null, startLabel(e), e.venue]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(' · ')
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

// 3.7P-23c — FeaturedCard: the §N "Tonight's best bets" featured DecisionCard.
// Image on top, then meta · title · honest tag chips, and INLINE actions — the
// card ACTS (Save toggle + Add-to-day), it doesn't just open detail. The image+
// text are one tap target that opens the detail (the CardImg [data-vt] morph); the
// action buttons are siblings (never nested in the open button). onAdd(e) is the
// planner write, owned by the host (HotView) so the toast + day-plan live there.
function featuredChips(e) {
  const out = []
  if (e.category && e.category !== 'other') out.push(e.category.charAt(0).toUpperCase() + e.category.slice(1))
  if (e._free === true || e.isFree === true) out.push('Free')
  else if (priceLabel(e)) out.push(priceLabel(e))
  if (typeof e.buzz === 'number' && e.buzz >= 2) out.push('Buzzing')
  return out.slice(0, 3)
}
export function FeaturedCard({ e, onSelect, onAdd }) {
  const { has, toggle } = useSaves()
  const saved = has(e)
  const isPlace = e.kind === 'place'
  const free = e._free === true || e.isFree === true
  // kind-aware meta: a PLACE leads activity/utility-first (type · distance · free),
  // an EVENT leads time-first (day · time · venue) — the Decision-Layer thesis.
  const meta = isPlace
    ? [placeTypeLabel(e), distLabel(e), free ? 'Free' : null].filter(Boolean).join(' · ')
    : (e._ongoing ? ['Ongoing', e.venue] : [dayLabelLoose(e), timeOf(e.start), e.venue]).filter(Boolean).join(' · ')
  const chips = isPlace ? spotChips(e).map((c) => c.label) : featuredChips(e)
  // 3.7P-23c review: the label must match the slot the add WRITES to (daypartOf,
  // the clock-time signal) — not _tonight (a day-SPAN flag true for any daytime
  // event today). "tonight" only for a genuinely-evening pick.
  const addLabel = !isPlace && e._tonight && daypartOf(e) === 'night' ? '＋ Add to tonight' : '＋ Add to day'
  return (
    <div className="featc">
      <button className="featc-open pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
        <CardImg e={e} className="featc-img">
          <HeatBadge e={e} />
          {free && <span className="free-badge">FREE</span>}
          {isPlace && e.hidden && <span className="spot-badge" aria-label="Hidden gem">💎</span>}
        </CardImg>
        <span className="featc-body">
          <span className="featc-meta">{meta || (isPlace ? 'Spot' : 'Coming up')}</span>
          <span className="featc-title">{e.title}</span>
          {chips.length > 0 && (
            <span className="featc-chips">
              {chips.map((c, i) => (
                <span className="featc-chip" key={i}>{c}</span>
              ))}
            </span>
          )}
          <SponsoredTag e={e} />
        </span>
      </button>
      <div className="featc-actions">
        <button className={'featc-act featc-save' + (saved ? ' on' : '')} onClick={() => toggle(e)} aria-pressed={saved}>
          {saved ? '♥ Saved' : '♡ Save'}
        </button>
        {/* the inline planner Add (events one-tap; places need a day, so they open
            the detail's "Make this my plan" sheet — the host passes no onAdd) */}
        {onAdd && <button className="featc-act featc-add" onClick={() => onAdd(e)}>{addLabel}</button>}
      </div>
    </div>
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

// SpotCard (3.73b) — the premium PLACE tile. Reuses the placeType-aware art floor
// (3.73a) + SaveHeart, but speaks PLACE: a placeType label, one decision-useful
// differentiator + distance (no vanity counts), and the 💎 hidden-gem badge. Used
// by LocationsView's carousels + sourced guides instead of the event-shaped
// TonightCard, so a spot reads as a discovery, not a database row. DRAFT — ⚑ Charles.
const placeTypeLabel = (p) => {
  const t = (p.placeType || 'spot').replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
// 3.7P-13: decision-useful amenity chips (icon + label), up to 3, drawn from
// fields the place already carries (no new data). Priority-ordered so the most
// useful surface first; Free leads when it applies (the differentiator). Icons
// are the P1 stroke-SVG family (Icon.*) — utility glyphs, not identity emoji.
const has = (p, a) => p.amenities?.includes(a)
const AMENITY_CHIPS = [
  { test: (p) => p.isFree === true, icon: 'tag', label: 'Free' },
  { test: (p) => has(p, 'restrooms'), icon: 'restroom', label: 'Restrooms' },
  { test: (p) => has(p, 'playground') || has(p, 'splash-pad'), icon: 'playground', label: 'Playground' },
  { test: (p) => ['hiking', 'trails', 'nature-trails'].some((a) => has(p, a)), icon: 'trail', label: 'Trails' },
  { test: (p) => ['boat-ramp', 'boating', 'canoe-launch', 'paddling', 'marina'].some((a) => has(p, a)), icon: 'water', label: 'Boat launch' },
  { test: (p) => ['swimming', 'pool'].some((a) => has(p, a)), icon: 'water', label: 'Swimming' },
  // "Sports" covers genuine courts + ball fields honestly; disc-golf and
  // skate-park are NEITHER (3.7P-13 review: labeling them "Courts" asserted
  // something false on 14 places) — they get their own correct chips.
  { test: (p) => ['tennis', 'basketball', 'pickleball', 'volleyball', 'racquetball', 'baseball', 'soccer'].some((a) => has(p, a)), icon: 'sports', label: 'Sports' },
  { test: (p) => has(p, 'disc-golf'), icon: 'sports', label: 'Disc golf' },
  { test: (p) => has(p, 'skate-park'), icon: 'sports', label: 'Skate park' },
  { test: (p) => ['picnic', 'grills', 'shelters'].some((a) => has(p, a)), icon: 'picnic', label: 'Picnic' },
  { test: (p) => ['dog-park', 'dogs-allowed', 'dog-beach'].some((a) => has(p, a)), icon: 'dog', label: 'Dog-friendly' },
]
// exported (Stage R) so PlaceDetail can render the same honest top-amenity tag
// chips up top; the FULL amenity list still appears in "What's here" (never-hide).
export const spotChips = (p) => {
  const out = []
  for (const c of AMENITY_CHIPS) {
    if (c.test(p)) out.push(c)
    if (out.length === 3) break
  }
  return out
}
const distLabel = (p) => (p._dist != null ? p._dist.toFixed(1) + ' mi' : null)
export function SpotCard({ p, onSelect }) {
  const chips = spotChips(p)
  const dist = distLabel(p)
  return (
    <button className="spotcard pressable" onClick={(ev) => onSelect(p, ev.currentTarget)}>
      <CardImg e={p} className="spotcard-img">
        <SaveHeart e={p} />
        {p.hidden && <span className="spot-badge" aria-label="Hidden gem">💎</span>}
      </CardImg>
      <div className="spotcard-type">{placeTypeLabel(p)}</div>
      <div className="spotcard-title">{p.title}</div>
      {chips.length > 0 ? (
        <div className="spotcard-amen">
          {chips.map((c, i) => {
            const Glyph = Icon[c.icon]
            return (
              <span className="spot-amen" key={i}>
                {Glyph && <Glyph className="spot-amen-ic" aria-hidden />}
                {c.label}
              </span>
            )
          })}
          {dist && <span className="spot-amen-dist">{dist}</span>}
        </div>
      ) : (
        <div className="spotcard-meta">{dist || p.venue || 'Tap for details'}</div>
      )}
    </button>
  )
}

// IntentTile (3.7P-20) — the ONE shared "intent" widget for BOTH pages: a hue-
// tinted emoji disc + a label + an optional point-of-view line. Events Guides,
// Spots Activities, and the Spots "Plans by mood" Guides all render through this
// (different content + onClick, identical format), laid out as an ALL-VISIBLE
// grid (.intent-grid), never a horizontal-scroll carousel — the magazine goal.
// Replaces the old divergent guide-pills (Events) + act-chips (Spots) + GuideCard.
export function IntentTile({ emoji, label, pov, hue, onClick }) {
  return (
    <button className="intent-tile pressable" style={{ '--ih': hue ?? 30 }} onClick={onClick}>
      <span className="intent-tile-emoji" aria-hidden>
        {emoji}
      </span>
      <span className="intent-tile-label">{label}</span>
      {pov && <span className="intent-tile-pov">{pov}</span>}
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

// the Everything/feed row, editorial treatment (THE design system): 110px
// image left, category overline + spine in the category hue, FREE overlay on
// the image (poster's best element, folded in), heat badge / price chip
// (priced only) / distance in a right-aligned rail. CardImg keeps [data-vt]
// so the detail morph works.
//
// memo'd (Sprint M1): HotView re-renders on every taste/recents/saves emit —
// i.e. on every detail open — and RowFeed reconciles up to `limit` rows each
// time (1,600+ once the Everything feed is fully paged). All four props are
// referentially stable across those re-renders (e: from the evSections memo;
// onSelect: App's useCallback'd openDetail; dist: null; style: undefined or a
// hoisted STAGGER_STYLES constant), so memo turns ~1,600 row re-renders per
// card tap into ~0. Context reads (weather) bypass memo by design, so
// forecast arrival still repaints every row.
export const Row = memo(function Row({ e, dist, style, onSelect }) {
  // outdoor events on a rainy forecast day carry a tiny honesty hint in the meta
  const wx = useContext(WxContext)
  const wxDay = e.category === 'outdoors' && e._day != null && wx ? wx[dateKey(e._day)] : null
  const rain = wxDay && wxDay.rain != null && wxDay.rain >= 30 ? '🌧 ' + wxDay.rain + '%' : null
  const st = { ...style, '--ch': hueFor(e) }
  const open = (ev) => onSelect(e, ev.currentTarget)
  const mi = dist != null ? dist.toFixed(1) + ' mi' : null
  const free = e._free === true || e.isFree === true

  // W3 collapsed recurring series: a card representing N dates wears an honest
  // "+ N more …" stamp so it never poses as a single occurrence. The noun is
  // honest about WHAT varies — a single-venue repeat is "+N more dates", but a
  // series running across venues (same title, different places) says "dates &
  // venues" so the card never implies one location. Tap → detail's full "All
  // dates & venues" list (the openable instances). DRAFT copy — ⚑ Charles.
  const more = (() => {
    if (typeof e._moreDates !== 'number' || e._moreDates <= 0) return null
    const n = e._moreDates
    const venues = Array.isArray(e._series) ? new Set(e._series.map((x) => x.venue || '').filter(Boolean)) : null
    if (venues && venues.size > 1) return `+${n} more dates & venues`
    return n === 1 ? '+1 more date' : `+${n} more dates`
  })()
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
        {more && <div className="row-series">{more}</div>}
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
})

// the 6 distinct stagger delays as frozen module constants: an inline object
// literal per row would hand memo(Row) a fresh `style` identity every render
// and silently defeat it on the stagger pages (Bubble/Search)
const STAGGER_STYLES = [0, 30, 60, 90, 120, 150].map((ms) => Object.freeze({ animationDelay: ms + 'ms' }))

// 3.7P-42 — CompactRow: the CompactListRow of the DecisionCard system. The dense,
// text-forward decision row for COMPARE/DECIDE surfaces (guide + bubble + see-all
// lists), where Home's big cards are for DISCOVER. Text LEADS; a real photo is a
// supporting 48×48 thumb on the right (imageMode gate) and a photo-less item shows
// NO placeholder (the "green wall" fix) — the title carries the row, so ~8+ fit per
// screen for fast compare. Kind-aware per the Decision-Layer thesis: an EVENT reads
// TIME-first (day · time · venue · dist), a PLACE reads ACTIVITY/UTILITY-first
// (type · dist · amenity chips). Tap → the shared detail (where Save / Add-to-day
// live). memo'd like Row so a 1,000-item bubble list re-renders ~0 rows per open.
export const CompactRow = memo(function CompactRow({ e, dist, style, onSelect }) {
  const wx = useContext(WxContext)
  const isPlace = e.kind === 'place'
  const mode = imageMode(e) // 'photo' → 48px thumb; 'icon'/'text' → text-led, no box
  const open = (ev) => onSelect(e, ev.currentTarget)
  // same dist contract as Row (RowFeed's dist prop only; no silent e._dist fallback)
  const mi = dist != null ? dist.toFixed(1) + ' mi' : null
  const free = e._free === true || e.isFree === true
  // a PAID event must still show its cost on the compare surface (Row parity)
  const priced = !isPlace && !free ? priceLabel(e) : null
  const hot = !isPlace && typeof e.buzz === 'number' && e.buzz >= 2
  // weather honesty hint (outdoor events on a rainy day) — the lightweight "fit" cue
  const wxDay = !isPlace && e.category === 'outdoors' && e._day != null && wx ? wx[dateKey(e._day)] : null
  const rain = wxDay && wxDay.rain != null && wxDay.rain >= 30 ? '🌧 ' + wxDay.rain + '%' : null
  // collapsed-series stamp (events) — honest about WHAT varies (dates vs venues)
  const more = (() => {
    if (isPlace || typeof e._moreDates !== 'number' || e._moreDates <= 0) return null
    const n = e._moreDates
    const venues = Array.isArray(e._series) ? new Set(e._series.map((x) => x.venue || '').filter(Boolean)) : null
    if (venues && venues.size > 1) return `+${n} more dates & venues`
    return n === 1 ? '+1 more date' : `+${n} more dates`
  })()
  const meta = isPlace
    ? [placeTypeLabel(e), mi].filter(Boolean).join(' · ')
    : (e._ongoing ? ['Ongoing', e.venue, mi, rain] : [dayLabelLoose(e), timeOf(e.start), e.venue, mi, rain])
        .filter(Boolean)
        .join(' · ')
  const chips = isPlace ? spotChips(e) : null
  return (
    <button className="crow pressable" style={style} onClick={open}>
      <div className="crow-main">
        <div className="crow-head">
          <span className="crow-title">{e.title}</span>
          {/* events wear an inline Free tag or price; places get Free as their first amenity chip */}
          {!isPlace && free && <span className="crow-free">Free</span>}
          {priced && <span className="crow-price">{priced}</span>}
          {hot && <span className="crow-hot" aria-hidden>🔥{e.buzz >= 3 ? e.buzz : ''}</span>}
          {isPlace && e.hidden && <span className="crow-gem" aria-label="Hidden gem">💎</span>}
        </div>
        <div className="crow-meta">{meta || 'Tap for details'}</div>
        {isPlace && chips && chips.length > 0 && (
          <div className="crow-chips">
            {chips.map((c, i) => {
              const Glyph = Icon[c.icon]
              return (
                <span className="crow-chip" key={i}>
                  {Glyph && <Glyph className="crow-chip-ic" aria-hidden />}
                  {c.label}
                </span>
              )
            })}
          </div>
        )}
        {more && <div className="crow-series">{more}</div>}
        <SponsoredTag e={e} />
      </div>
      {mode === 'photo' && <CardImg e={e} className="crow-thumb" />}
      {/* Stage R: every compare row carries an inline Save (was absent — the row
          had no heart at all). SaveHeart is a span[role=button] (valid inside the
          row button) + stopPropagation; modes.css styles it in-flow at the right. */}
      <SaveHeart e={e} />
    </button>
  )
})

// vertical feed with optional date headers + infinite paging (30 rows/page).
// sections: [{ label: string|null, items: event[] }]. stagger=true plays a one-shot
// staggered rise on the first 6 rows (use when a page swaps its list in).
// endSlot (H4): an optional node that REPLACES the default end-of-feed line
// once the whole list is rendered (HotView's session recap card).
// headerExtra (Q2): optional (section) => node rendered inside the day header
// (HotView's 🃏 "Deck this" entry); when it returns something the header flexes
// via .feed-date-deck — consumers that don't pass it render byte-identically.
// compact (3.7P-42): COMPARE/DECIDE drill-in lists (guides, bubbles, see-all) pass
// it to render the dense text-forward CompactRow instead of the big editorial Row —
// Home discovery keeps the big cards (discover = visual; decide = dense).
export function RowFeed({ sections, showDist, stagger, compact, scrollRootRef, endSlot, headerExtra, onSelect }) {
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
      const extra = headerExtra ? headerExtra(s) : null
      out.push(
        <div className={'feed-date' + (extra ? ' feed-date-deck' : '')} key={'h' + s.label}>
          {s.label}
          {extra}
        </div>
      )
    }
    const RowComp = compact ? CompactRow : Row
    for (const it of items) {
      out.push(
        <RowComp
          key={keyOf(it) + rowIdx}
          e={it}
          dist={showDist ? it._dist : null}
          style={stagger ? STAGGER_STYLES[Math.min(rowIdx, 5)] : undefined}
          onSelect={onSelect}
        />
      )
      rowIdx++
    }
    count += items.length
  }
  const cls = 'feed feed--editorial' + (compact ? ' feed--compact' : '') + (stagger ? ' feed-stagger' : '')
  return (
    <div className={cls}>
      {out}
      {limit < total && <div className="feed-sentinel" ref={sentRef} />}
      {total > 0 && limit >= total && (endSlot ?? <div className="feed-end">You've reached the end of the list.</div>)}
    </div>
  )
}
