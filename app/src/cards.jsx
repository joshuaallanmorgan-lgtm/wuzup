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
import { createContext, memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CATEGORY_EMOJI, CATEGORY_HUES, PLACETYPE_EMOJI, PLACETYPE_HUE } from './categories.js'
import { auroraVars, medallionHue } from './artseed.js'
import { Icon, dayLabelLoose, dayLoose, keyOf, makeAnchors, priceLabel, startLabel, timeOf } from './lib.js'
import { ACTIVITIES } from './places.js'
import { imageMode, photoFirst } from './imageMode.js'
import { daypartOf, DAYPART, fillOrder } from './weekend.js'
import { dayEntryFor, loadDayPlans, saveDayPlans, withSlot } from './dayplan.js'
import { SaveHeart, useSaves } from './saves.js'
import './cards.css'

const PAGE_SIZE = 30

// ===== self-contained card actions: a tiny module-level toast + a one-tap
// "Add to plan" so the UNIVERSAL cards (GemRow / SpotCard) can write the real
// day-plan and confirm WITHOUT a host threading onAdd. One toast at a time,
// rendered into a portal by <CardToastHost/> (mounted once in App). =====
let _cardToastSet = null
export function cardToast(msg) {
  if (_cardToastSet) _cardToastSet(msg)
}
export function CardToastHost() {
  const [msg, setMsg] = useState(null)
  const tRef = useRef(null)
  useEffect(() => {
    _cardToastSet = (m) => {
      setMsg(m)
      clearTimeout(tRef.current)
      tRef.current = setTimeout(() => setMsg(null), 1700)
    }
    return () => {
      _cardToastSet = null
      clearTimeout(tRef.current)
    }
  }, [])
  if (!msg) return null
  return createPortal(<div className="card-toast">{msg}</div>, document.body)
}

// slot an event/place into its day's natural daypart — TODAY for an undated/place
// item — never clobbering a filled slot, and confirm via the module toast. The
// SAME loadDayPlans → withSlot seam DayPage + FeaturedCard use (daypartOf → slot).
function addToPlan(e) {
  const anchors = makeAnchors(new Date())
  const dayTs = Math.max(e._day ?? anchors.todayTs, anchors.todayTs)
  const map = loadDayPlans(anchors)
  const cur = dayEntryFor(map[String(dayTs)])
  const target = fillOrder(e).find((p) => !(cur && cur.slots[p])) // natural daypart first ('any' → morning)
  if (!target) {
    cardToast('That day is full — clear a slot first')
    return false
  }
  saveDayPlans(withSlot(map, dayTs, target, keyOf(e)))
  const when = dayTs === anchors.todayTs ? 'today' : new Date(dayTs).toLocaleDateString('en-US', { weekday: 'long' })
  cardToast(`${DAYPART[target].emoji} Added to ${when} ${DAYPART[target].label.toLowerCase()}`)
  return true // PREMIUM A4: lets the Add button morph to its "✓ Added" confirmation
}

// PREMIUM A4 (motion#7, Josh's gripe): the Add button is a real confirmation — on a
// successful add it morphs to "✓ Added" with a gold slotPop overshoot for ~2s, then
// settles back. The module toast (CardToastHost) still fires in parallel.
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
      <path d="M5 12.5l4 4 10-10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function AddButton({ e, className, label, ariaLabel }) {
  const [added, setAdded] = useState(false)
  const tRef = useRef(null)
  useEffect(() => () => clearTimeout(tRef.current), [])
  const onClick = () => {
    if (addToPlan(e)) {
      setAdded(true)
      clearTimeout(tRef.current)
      tRef.current = setTimeout(() => setAdded(false), 1900)
    }
  }
  return (
    <button className={className + (added ? ' is-added' : '')} onClick={onClick} aria-label={ariaLabel}>
      {added ? (
        <>
          <CheckIcon /> Added
        </>
      ) : (
        <>
          <CalIcon /> {label}
        </>
      )}
    </button>
  )
}

// PREMIUM A4 (motion#8): a first-load skeleton in the GemRow shape — a shimmer
// sweep over placeholder bars so the feed FILLS IN instead of hard-popping (or
// sitting on a bare "Loading…" line). Reduced-motion stills the shimmer.
export function SkeletonRow() {
  return (
    <div className="gem gem-skel" aria-hidden>
      <span className="skel skel-img" />
      <div className="gem-main">
        <span className="skel skel-line skel-title" />
        <span className="skel skel-line skel-w70" />
        <span className="skel skel-line skel-w45" />
        <span className="skel-chips">
          <span className="skel skel-chip" />
          <span className="skel skel-chip" />
        </span>
      </div>
    </div>
  )
}

// a small calendar glyph for the "Add to plan" pill (matches the day-selector icon)
const CalIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
    <rect x="3" y="5" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M3 9.5h18M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
// PREMIUM A2: stroke-icon wrappers for the result-card meta (retire the 📍🔥★ emoji)
const PinIcon = () => Icon.pin({ className: 'meta-ic', 'aria-hidden': true })
const FlameIcon = () => Icon.hot({ className: 'heat-ic', 'aria-hidden': true })
const SparkleIcon = () => Icon.sparkle({ className: 'bestfor-ic', 'aria-hidden': true })

// presentational hook only: lib's startLabel may emit "Started 7:00 PM" for
// already-underway events — metas that LEAD with it read quieter (.meta-started)
const startedCls = (m) => (m.startsWith('Started') ? ' meta-started' : '')

// 16-day forecast map { 'YYYY-MM-DD': {emoji,hi,rain} } | null — App owns the
// single getForecast() fetch and provides it here; outdoor rows show a rain hint.
export const WxContext = createContext(null)

// one hue per category (spine, glow, overline tint) + one emoji per category
// (imgbox-art watermark for events without an image). Both maps now DERIVE
// from the canonical registry (categories.js, Sprint O audit prep #7) and are
// re-exported here as shims so DetailPage/etc. keep importing from
// cards.jsx unchanged — values verified identical to the old literals.
export { CATEGORY_EMOJI, CATEGORY_HUES } from './categories.js'
// 3.7P-36: re-export the imageMode gate so card consumers (DecisionCard/P42,
// Spots rows/P24) import it from the cards module alongside the components.
// WS4: photoFirst rides along — the count-preserving photos-lead ordering.
export { imageMode, photoFirst }
export const hueFor = (e) => {
  // 3.73a: places are placeType-keyed (beach/trail/pier/dog-park each distinct)
  // — kills the green-on-green wall; everything else stays category-keyed.
  if (e?.kind === 'place' && PLACETYPE_HUE[e.placeType] != null) return PLACETYPE_HUE[e.placeType]
  return CATEGORY_HUES[e.category] ?? CATEGORY_HUES.other
}
// the art-floor identity emoji — placeType-specific for places (a beach reads
// 🏖️, not the generic outdoors 🌳), category emoji otherwise.
export const artEmoji = (e) => {
  if (e?.kind === 'place' && PLACETYPE_EMOJI[e.placeType]) return PLACETYPE_EMOJI[e.placeType]
  return CATEGORY_EMOJI[e.category] ?? CATEGORY_EMOJI.other
}
// Aurora-mesh art floor (deterministic, seeded by the item key): the inline CSS vars
// for an .imgbox-art element. Memoized by key — the seed math is cheap but a long feed
// re-renders many tiles, and the values are deterministic so the cache is safe AND
// keeps the View-Transition morph (card thumb → detail hero) referencing one object.
const _auroraCache = new Map()
export const auroraStyle = (e) => {
  const k = keyOf(e)
  let v = _auroraCache.get(k)
  if (!v) { v = auroraVars(k, hueFor(e)); _auroraCache.set(k, v) }
  return v
}
// the featured place-no-photo medallion hue — same per-place jitter as the field base.
export const medallionVar = (e) => medallionHue(keyOf(e), hueFor(e))

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
      <FlameIcon />{e.buzz >= 3 ? <span className="heat-n">{e.buzz}</span> : null}
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
// holds from the 58px agenda thumb to the full-width feature card), with the existing
// time/emoji foreground on top. Pure CSS + emoji — no assets, no canvas.
// data-vt marks the element that morphs into the detail hero via View Transitions.
// children render on top (heat badges, FREE badge, …).
export function CardImg({ e, className = '', children }) {
  const [ok, setOk] = useState(false)
  const [failed, setFailed] = useState(false)
  const emoji = artEmoji(e)
  // the art-floor foreground is the real event TIME only — strip startLabel's "Started "
  // prefix. Aurora (3.8): the old '★' fallback is GONE — on a place / timeless item it
  // was the loudest thing on every tile (every park read as "star"), competing with the
  // generative field. With no time, the aurora field + corner type-chip carry identity.
  const fall = startLabel(e).replace(/^Started /, '')
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
      style={showArt ? auroraStyle(e) : undefined}
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
          {fall && <span className="imgbox-fall">{fall}</span>}
        </>
      )}
      {/* PREMIUM A2: bottom scrim on REAL photos so on-image time/heat/dist badges
          stay legible (the art floor already carries its own dark gradients). CSS
          shows it only on the badge-bearing card thumbs. */}
      {!showArt && <span className="img-scrim" aria-hidden />}
      {children}
    </span>
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

// 3.7P-23c — FeaturedCard: the §N "Tonight's best bets" featured DecisionCard.
// Image on top, then meta · title · honest tag chips, and INLINE actions — the
// card ACTS (Save toggle + Add-to-day), it doesn't just open detail. The image+
// text are one tap target that opens the detail (the CardImg [data-vt] morph); the
// action buttons are siblings (never nested in the open button). onAdd(e) is the
// planner write, owned by the host (HotView) so the toast + day-plan live there.
export function featuredChips(e) {
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
  // 1-B (Stage 1): a PLACE with no real photo gets a text-rich card — a small
  // placeType medallion + name + amenity chips — NEVER a big flat color hero (the
  // "green wall"). Events keep their category-art hero (the event art floor).
  const placeNoPhoto = isPlace && imageMode(e) !== 'photo'
  return (
    <div className={'featc' + (placeNoPhoto ? ' featc-noimg' : '')}>
      <button className="featc-open pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
        {placeNoPhoto ? (
          <span className="featc-medallion" aria-hidden style={{ '--mh': medallionVar(e) }}>
            {artEmoji(e)}
            {e.hidden && <span className="featc-med-gem" aria-label="Hidden gem">💎</span>}
          </span>
        ) : (
          <CardImg e={e} className="featc-img">
            <HeatBadge e={e} />
            {free && <span className="free-badge">FREE</span>}
            {isPlace && e.hidden && <span className="spot-badge" aria-label="Hidden gem">💎</span>}
          </CardImg>
        )}
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

const startOfTodayMs = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// GemRow — the canonical EVENT card (CARD polish, ref-events-full). A light card
// surface holds: [image (on-image badge) · two-line meta · neutral chips] then a
// right RAIL with the outline SaveHeart over a self-contained "Add to plan" pill
// (writes the real day-plan). The on-image badge stacks DAY-over-TIME for a future
// day (Sat / 7:00 PM); today's events show time only. Real fields only.
export function GemRow({ e, onSelect }) {
  const time = e.kind !== 'place' && !e._ongoing ? timeOf(e.start) : null
  const timeRange =
    e.kind !== 'place' && !e._ongoing ? [timeOf(e.start), e.end ? timeOf(e.end) : null].filter(Boolean).join(' – ') : null
  const dayShort =
    time && e._day != null && e._day !== startOfTodayMs() ? new Date(e._day).toLocaleDateString('en-US', { weekday: 'short' }) : null
  const chips = featuredChips(e)
  const when = [dayLoose(e), timeRange].filter(Boolean).join(' · ')
  // CARD_LOCK: a COLLAPSED recurring series wears its honest "+ N more …" stamp
  // (never poses as a single occurrence). Honest about WHAT varies (dates vs venues).
  const more = (() => {
    if (typeof e._moreDates !== 'number' || e._moreDates <= 0) return null
    const n = e._moreDates
    const venues = Array.isArray(e._series) ? new Set(e._series.map((x) => x.venue || '').filter(Boolean)) : null
    if (venues && venues.size > 1) return `+${n} more dates & venues`
    return n === 1 ? '+1 more date' : `+${n} more dates`
  })()
  return (
    <div className="gem">
      <button className="gem-open pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
        <CardImg e={e} className="gem-img">
          <HeatBadge e={e} />
          {time && (
            <span className={'imgbadge gem-time' + (dayShort ? ' gem-time-stack' : '')}>
              {dayShort && <span className="gem-time-day">{dayShort}</span>}
              {time}
            </span>
          )}
        </CardImg>
        <div className="gem-main">
          <div className="gem-title">{e.title}</div>
          {e.venue && (
            <div className="gem-venue">
              <PinIcon /> {e.venue}
            </div>
          )}
          {when && <div className="gem-when">{when}</div>}
          {chips.length > 0 && (
            <div className="gem-chips">
              {chips.map((c, i) => (
                <span className="gem-chip" key={i}>{c}</span>
              ))}
            </div>
          )}
          {/* ONE reason line (D1/uniform-height budget + "one accent per card"):
              the honest "Why this fits" wins when set, else the series stamp. */}
          {e._why ? (
            <div className="gem-why">Why this fits: {e._why}</div>
          ) : more ? (
            <div className="gem-series">{more}</div>
          ) : null}
          <SponsoredTag e={e} />
        </div>
      </button>
      {/* D4: a bare stroke heart at the card's top-right corner (over the body, not
          the image); D2/CTA: a real "Add to plan" button pinned bottom-right. */}
      <SaveHeart e={e} bare />
      <AddButton e={e} className="gem-add" label="Add to plan" ariaLabel={`Add ${e.title} to your plan`} />
    </div>
  )
}

// NbhdCard — the "Neighborhood Picks" 2-up tile (EVENTS_GRIND; C5: promoted 1:1
// from HotView's inline map body — markup/classes unchanged, pure move). Expects
// e._area, the parsed neighborhood label (HotView only renders the section when
// the areas were confidently readable — the honesty guard lives at the call site).
export function NbhdCard({ e, onSelect }) {
  const chips = featuredChips(e)
  return (
    <button className="nbhd-card pressable" onClick={(ev) => onSelect(e, ev.currentTarget)}>
      <CardImg e={e} className="nbhd-img">
        <SaveHeart e={e} />
      </CardImg>
      <div className="nbhd-area"><PinIcon /> {e._area}</div>
      <div className="nbhd-title">{e.title}</div>
      <div className="nbhd-meta">{[dayLoose(e), e.venue].filter(Boolean).join(' · ')}</div>
      {chips.length > 0 && (
        <div className="nbhd-chips">
          {chips.map((c, i) => (
            <span className="gem-chip" key={i}>{c}</span>
          ))}
        </div>
      )}
    </button>
  )
}

// SpotCard (3.73b) — the premium PLACE tile. Reuses the placeType-aware art floor
// (3.73a) + SaveHeart, but speaks PLACE: a placeType label, one decision-useful
// differentiator + distance (no vanity counts), and the 💎 hidden-gem badge. Used
// by LocationsView's carousels + sourced guides instead of the event-shaped
// TonightCard, so a spot reads as a discovery, not a database row. DRAFT — ⚑ Charles.
export const placeTypeLabel = (p) => {
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
  // cafe amenities (real OSM tags via the finder cafe source) — for Coffee & Hang
  { test: (p) => has(p, 'outdoor-seating'), icon: 'tag', label: 'Outdoor seating' },
  { test: (p) => has(p, 'wifi'), icon: 'tag', label: 'Wifi' },
  { test: (p) => has(p, 'takeaway'), icon: 'tag', label: 'Takeaway' },
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
const spotBestFor = (p) => {
  const match = ACTIVITIES.find((a) => a.match(p))
  return match ? match.label : null
}
const spotAmenChips = (chips) =>
  chips.map((c, i) => {
    const Glyph = Icon[c.icon]
    return (
      <span className="spot-amen" key={i}>
        {Glyph && <Glyph className="spot-amen-ic" aria-hidden />}
        {c.label}
      </span>
    )
  })

// CARD_LOCK: SpotCard is the universal PLACE card. `row` renders the full-width
// LEFT-image RESULT-feed form (CARD polish, ref-spots-full): a light card surface,
// two-line meta (📍location / "12 min · Free · Park" TEXT distance), neutral amenity
// chips, "★ Best for", and a right RAIL with the outline SaveHeart over a
// self-contained "Add to day". The DEFAULT is the 200px top-image carousel TILE
// (LocationsView rails) — left untouched. Real fields only; distance only when known.
export function SpotCard({ p, onSelect, row = false }) {
  const chips = spotChips(p)
  const dist = distLabel(p)
  const bestFor = spotBestFor(p)
  if (row) {
    // Free leads the facts line, so it's dropped from the amenity chips (no dupe)
    const facts = [dist, p.isFree === true ? 'Free' : null, placeTypeLabel(p)].filter(Boolean).join(' · ')
    const amen = chips.filter((c) => c.label !== 'Free')
    // WS4 — the 'icon' row form imageMode PROMISED (3.7P-36: a photo-less place
    // gets "a compact icon/text card (NOT a big hue block)", naming Spots rows as
    // the consumer) but never received: a photo-less place row leads with the
    // compact placeType medallion (the featc-noimg precedent) instead of dressing
    // the Aurora floor in the photo-shaped 102px slot, where at thumbnail density
    // it read as a broken photo. Type/meta/chips take the reclaimed width. The D1
    // uniformity invariant holds — same .spotcard--row box, same --card-row-h;
    // only the internal composition changes. Full-bleed Aurora stays on surfaces
    // where it reads as a designed field (detail heroes, deck cards, carousel
    // tiles). No [data-vt] on the medallion (the FeaturedCard noimg precedent) —
    // a 56px chip blown up to a hero snapshot smears, so these rows open with the
    // standard slide-up instead of the thumb→hero morph.
    const iconRow = imageMode(p) !== 'photo'
    return (
      <div className={'spotcard--row' + (iconRow ? ' spotcard--row-icon' : '')}>
        <button className="spotcard-open pressable" onClick={(ev) => onSelect(p, ev.currentTarget)}>
          {iconRow ? (
            <span className="spotcard-medallion" style={{ '--mh': medallionVar(p) }}>
              <span aria-hidden>{artEmoji(p)}</span>
              {p.hidden && <span className="spotcard-med-gem" aria-label="Hidden gem">💎</span>}
            </span>
          ) : (
            <CardImg e={p} className="spotcard-img">
              {p.hidden && <span className="spot-badge" aria-label="Hidden gem">💎</span>}
            </CardImg>
          )}
          <div className="spotcard-body">
            <div className="spotcard-title">{p.title}</div>
            {p.venue && (
              <div className="spotcard-loc">
                <PinIcon /> {p.venue}
              </div>
            )}
            {facts && <div className="spotcard-facts">{facts}</div>}
            {amen.length > 0 && <div className="spotcard-amen">{spotAmenChips(amen)}</div>}
            {bestFor && (
              <div className="spotcard-bestfor">
                <SparkleIcon /> Best for: {bestFor}
              </div>
            )}
          </div>
        </button>
        {/* D4: bare top-right heart + a real "Add to day" button pinned bottom-right */}
        <SaveHeart e={p} bare />
        <AddButton e={p} className="spotcard-add" label="Add to day" ariaLabel={`Add ${p.title} to your day`} />
      </div>
    )
  }
  // carousel TILE (unchanged) — top-image, on-image heart + distance badge
  return (
    <button className="spotcard pressable" onClick={(ev) => onSelect(p, ev.currentTarget)}>
      <CardImg e={p} className="spotcard-img">
        <SaveHeart e={p} />
        {p.hidden && <span className="spot-badge" aria-label="Hidden gem">💎</span>}
        {dist && <span className="imgbadge spotcard-dist">{dist}</span>}
      </CardImg>
      <div className="spotcard-body">
        <div className="spotcard-type">{placeTypeLabel(p)}</div>
        <div className="spotcard-title">{p.title}</div>
        {chips.length > 0 ? (
          <div className="spotcard-amen">{spotAmenChips(chips)}</div>
        ) : (
          <div className="spotcard-meta">{p.venue || 'Tap for details'}</div>
        )}
        {bestFor && (
          <div className="spotcard-bestfor">
            <SparkleIcon /> Best for: {bestFor}
          </div>
        )}
      </div>
    </button>
  )
}

// CARD_LOCK — the canonical VERTICAL result card, kind-aware: an EVENT renders
// GemRow, a PLACE renders the SpotCard ROW form. ONE swap point for every result
// feed (RowFeed + any direct result list) so a mixed feed (SearchPage) lays each
// item out with the right card. memo'd (Row/CompactRow parity) so a long feed
// re-renders ~0 rows per detail-open when e + onSelect are stable.
export const ResultCard = memo(function ResultCard({ e, onSelect }) {
  return e.kind === 'place' ? <SpotCard p={e} row onSelect={onSelect} /> : <GemRow e={e} onSelect={onSelect} />
})

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

// vertical feed with optional date headers + infinite paging (30 rows/page).
// sections: [{ label: string|null, items: event[] }]. stagger=true plays a one-shot
// staggered rise on the first 6 rows (use when a page swaps its list in).
// endSlot (H4): an optional node that REPLACES the default end-of-feed line
// once the whole list is rendered (HotView's session recap card).
// headerExtra (Q2): optional (section) => node rendered inside the day header
// (HotView's 🃏 "Deck this" entry); when it returns something the header flexes
// via .feed-date-deck — consumers that don't pass it render byte-identically.
// CARD_LOCK: every row is the canonical kind-aware ResultCard now (GemRow event /
// SpotCard place) — the dense CompactRow + the editorial Row are retired; one card.
export function RowFeed({ sections, stagger, scrollRootRef, endSlot, headerExtra, onSelect }) {
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
    for (const it of items) {
      // CARD_LOCK: the canonical kind-aware card (GemRow event / SpotCard place),
      // so a mixed feed (SearchPage) renders each item with the right card.
      out.push(<ResultCard key={keyOf(it) + rowIdx} e={it} onSelect={onSelect} />)
      rowIdx++
    }
    count += items.length
  }
  const cls = 'feed feed--cards' + (stagger ? ' feed-stagger' : '')
  return (
    <div className={cls}>
      {out}
      {limit < total && <div className="feed-sentinel" ref={sentRef} />}
      {total > 0 && limit >= total && (endSlot ?? <div className="feed-end">You've reached the end of the list.</div>)}
    </div>
  )
}
