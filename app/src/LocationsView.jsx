// LocationsView — the Spots tab. 3.7P-12 (ADDENDUM H) recast it ACTIVITY-FIRST:
// the old placeType browse (a 1,322-park green wall) is replaced by "what you can
// DO" — Beach day · Trails & nature · On the water · Sports & courts · Family &
// play · Dog-friendly · Scenic views · Hidden gems. Each is a PURE predicate over
// EXISTING fields (places.js ACTIVITIES; no new data), so a single park surfaces
// under its real affordances instead of as "a park." Structure: hero → activity
// intent frame (the quick nav) → Near you (persistent) → Saved places → per-
// activity carousels (the body) → Guides (plans by mood) → Everything (never-hide
// see-all). Taste REORDERS only (count-preserving), nearest-first with a fix.
//
// Places are a SECOND lazy store (usePlaces): /places.json fetches on first mount
// of this tab, never at boot, never merged into the events feed. DRAFT copy ⚑ Charles.
import { useMemo, useRef } from 'react'
import { useNav } from './nav.jsx'
import { SecHead, SpotCard, IntentTile, RowFeed, imageMode } from './cards.jsx'
import { GUIDES } from './guides.js'
import { railReady, tasteNudge, useTaste } from './taste.js'
import { usePlaces, ACTIVITIES, PLACE_LENS_BUBBLES, PLACE_CAT_BUBBLES, nearest, isPlaceKey, normalizePlace } from './places.js'
import { useSaves } from './saves.js'
import LensNav from './LensNav.jsx'
import SearchBarButton from './SearchBarButton.jsx'
import './locations.css'

// count-preserving order: category affinity (S3) desc, then FREE, then
// corroboration (srcCount) desc, then name — taste REORDERS, never hides. 3.7P-12
// adds the free nudge (per spec "nearest → taste → free → srcCount"); still
// count-preserving, so Everything keeps every place.
function placeOrder(list, taste) {
  return [...list].sort(
    (a, b) =>
      tasteNudge(b, taste) - tasteNudge(a, taste) ||
      (b.isFree === true) - (a.isFree === true) ||
      (b.srcCount || 0) - (a.srcCount || 0) ||
      a.name.localeCompare(b.name)
  )
}

// SPOTS_GRIND themed sections (ref-spots-full), each over REAL fields so the
// grouping is honest. Coffee & Hang is now real: the finder cafe source (Phase 2)
// added ~332 named cafes (placeType 'cafe', category 'food'), so it replaces the
// earlier Gardens & Picnics placeholder. Cafes carry the honest art-floor (☕) —
// OSM has no cafe photos — and stay paid (never tagged Free).
const actMatch = (id) => ACTIVITIES.find((a) => a.id === id)?.match || (() => false)
const SPOT_THEMES = [
  { id: 'nature-water', emoji: '🌿', label: 'Nature & Water', hue: 150, sub: 'Trails, springs, and the water’s edge.', match: (p) => actMatch('act-trails')(p) || actMatch('act-water')(p) },
  { id: 'coffee-hang', emoji: '☕', label: 'Coffee & Hang', hue: 24, sub: 'Cafes and cozy spots to linger.', match: (p) => p.placeType === 'cafe' },
  { id: 'sunset-views', emoji: '🌅', label: 'Sunset Views', hue: 25, sub: 'Where the bay puts on a show.', match: (p) => actMatch('act-views')(p) || actMatch('act-beach')(p) },
  { id: 'quiet-corners', emoji: '🤫', label: 'Quiet Corners', hue: 280, sub: 'Hidden gems and calm preserves.', match: (p) => p.hidden === true || p.placeType === 'preserve' },
]

export default function LocationsView({ coords }) {
  const { openDetail: onSelect, openPlaceBubble, openGuide, openSearch, openMap } = useNav()
  // FB-03 (3.7P-7): the Spots page shows SPOTS + MIXED guides (Beach day, Free
  // outdoor reset) — the place-domain guides.
  const spotGuides = GUIDES.filter((g) => g.domain === 'spots' || g.domain === 'mixed')
  const { places, status } = usePlaces()
  const saves = useSaves()
  const taste = useTaste()
  // See-all on Recommended / Worth the drive scrolls to the full Everything list
  // (never-hide — there's no derived bubble for "recommended", so the full set is
  // the honest destination).
  const scrollRef = useRef(null)
  const evRef = useRef(null)
  const scrollToEverything = () => {
    const sc = scrollRef.current
    if (sc && evRef.current) sc.scrollTo({ top: Math.max(evRef.current.offsetTop - 64, 0), behavior: 'smooth' })
  }

  const all = useMemo(() => (Array.isArray(places) ? placeOrder(places, taste) : []), [places, taste])
  const near = useMemo(() => nearest(all, coords, 12), [all, coords])
  // 3.7P-24 (§N screen 6): the single "Recommended" featured spot — the closest
  // taste-top place when located, else the taste-top place overall.
  // 1-B (Stage 1): prefer a pick that has a REAL photo so the Recommended hero
  // never falls back to a flat color block; if none in the active pool qualifies,
  // take the top pick anyway (FeaturedCard renders the text-rich no-photo card).
  // SP-L3: "Recommended near you" = carousel of top SpotCards (nearest with photos first).
  // SPOTS_GRIND: "Recommended near you" / "Worth the drive" are now vertical
  // SpotCard ROW lists (ref-spots-full), so a tighter top set.
  const nearSpots = useMemo(() => {
    const pool = coords && near.length ? near : all
    return pool.filter((p) => imageMode(p) !== 'none').slice(0, 4)
  }, [near, all, coords])

  // SP-L3: "Worth the drive" = next batch of spots not already shown in nearSpots.
  const driveSpots = useMemo(() => {
    const nearKeys = new Set(nearSpots.map((p) => p.key))
    return all.filter((p) => !nearKeys.has(p.key) && imageMode(p) !== 'none').slice(0, 4)
  }, [all, nearSpots])

  // SPOTS_GRIND themed sections — each a curated vertical SpotCard-row list, real
  // photos preferred, honestly gated (≥3 members). The FULL set is one tap away
  // (See all → PlaceBubblePage on the theme predicate, never-hide).
  const themeSections = useMemo(
    () =>
      SPOT_THEMES.map((t) => {
        const matched = all.filter(t.match)
        const withPhoto = matched.filter((p) => imageMode(p) !== 'none')
        const pool = withPhoto.length >= 4 ? withPhoto : matched
        const items = coords ? nearest(pool, coords, 4) : pool.slice(0, 4)
        return { t, items, total: matched.length }
      }).filter((s) => s.total >= 3 && s.items.length > 0),
    [all, coords]
  )

  // 3.7P-12: Saved-places shelf (mirrors the Events saved shelf). Resolve saved
  // 'p|' keys against the live store; fall back to the stored snapshot for a
  // place that's left the dataset (never-hide). Places carry no date → no
  // past/expiry logic, just the kept set.
  const savedPlaces = useMemo(() => {
    if (!Array.isArray(places)) return []
    const byKey = new Map(places.map((p) => [p.key, p]))
    return saves.list
      .filter((s) => isPlaceKey(s.key))
      .map((s) => byKey.get(s.key) || (s.snapshot ? normalizePlace({ ...s.snapshot }) : null))
      .filter(Boolean)
  }, [saves.list, places])

  const everything = useMemo(() => [{ label: null, items: all }], [all])

  if (status === 'loading' || places === null) {
    return (
      <div className="hot-scroll">
        <header className="loc-head">
          <h1 className="loc-head-title">Spots</h1>
          <div className="loc-head-sub">Loading the bay's places…</div>
        </header>
      </div>
    )
  }
  if (status === 'error' || all.length === 0) {
    return (
      <div className="hot-scroll">
        <header className="loc-head">
          <h1 className="loc-head-title">Spots</h1>
        </header>
        <div className="empty">
          {status === 'error'
            ? "Couldn't load places right now — check back in a moment."
            : 'No places on the map yet — check back soon.'}
        </div>
      </div>
    )
  }

  return (
    <div className="hot-scroll" ref={scrollRef}>
      {/* Stage R (§N screen 6): a CLEAN light header — title + sub + a prominent
          search bar — replaces the cinematic image hero, matching the benchmark's
          scannable top (title → search → activity grid). The search bar is a
          BUTTON into the existing global SearchPage (which already searches places
          via searchPlaces), not a new matcher — reorganize, not invent. */}
      <header className="loc-head">
        <h1 className="loc-head-title">Spots</h1>
        <div className="loc-head-sub">Parks, beaches, trails and quiet corners.</div>
        <SearchBarButton placeholder="Search spots — beaches, trails, dog parks…" onClick={openSearch} ariaLabel="Search spots" />
      </header>

      {/* Phase 3.6 N1: quiet top nav — quality lenses (Free/Hidden/Dog) + an
          All-spots menu of the place types (same destinations). */}
      <LensNav
        lenses={PLACE_LENS_BUBBLES}
        categories={PLACE_CAT_BUBBLES}
        menuLabel="All spots"
        onOpen={openPlaceBubble}
        onMap={openMap}
      />

      <div className="hot-body">
        {/* 3.7P-12 → 3.7P-20: ACTIVITY intent frame — the primary Spots nav, now
            an ALL-VISIBLE grid of the SHARED IntentTile (identical format to the
            Events "Guides"). Tap an activity → everywhere you can do it (See all →
            never-hide). The green-wall fix: browse by what you can DO. */}
        <section className="sec">
          <SecHead overline="What are you up for?" title="By activity" sub="Pick a move — we'll find the spot." />
          <div className="intent-grid">
            {ACTIVITIES.map((a) => (
              <IntentTile key={a.id} emoji={a.emoji} label={a.label} hue={a.hue} onClick={() => openPlaceBubble(a)} />
            ))}
          </div>
        </section>

        {/* 3.7P-24 (§N screen 6): "Recommended" — ONE featured spot DecisionCard
            (image + name + type · distance · free + amenity chips + inline Save).
            Replaces the old nearby carousel; always present (taste-top spot, closest
            when located). Tap → PlaceDetail (where "Make this my plan" lives). */}
        {nearSpots.length > 0 && (
          <section className="sec">
            {/* SP-L3: "Recommended near you" — carousel of SpotCards, closest with real photos first. */}
            <SecHead
              overline="Worth a visit"
              title="Recommended near you"
              sub={coords ? 'Closest to you right now' : railReady(taste) ? 'Based on what you have tapped' : 'Local favorites to explore'}
              onSeeAll={scrollToEverything}
            />
            <div className="home-picks">
              {nearSpots.map((p) => (
                <SpotCard key={p.key} p={p} row onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {driveSpots.length >= 2 && (
          <section className="sec">
            {/* SP-L3: "Worth the drive" — excellent spots not in the near-you set. */}
            <SecHead
              overline="A bit further out"
              title="Worth the drive"
              sub="Excellent spots a short trip away."
              onSeeAll={scrollToEverything}
            />
            <div className="home-picks">
              {driveSpots.map((p) => (
                <SpotCard key={p.key} p={p} row onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* 3.7P-12: Saved places — your own shelf, mirroring Events */}
        {savedPlaces.length > 0 && (
          <section className="sec">
            <SecHead overline="Your places" title="Saved" sub={`${savedPlaces.length} kept`} />
            <div className="carousel">
              {savedPlaces.map((p) => (
                <SpotCard key={p.key} p={p} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* SPOTS_GRIND: the THEMED body — curated vertical SpotCard-row sections
            (Nature & Water · Gardens & Picnics · Sunset Views · Quiet Corners),
            each a See-all into the full theme (never-hide). Replaces the per-
            activity carousels; the activity intent grid above stays the quick nav. */}
        {themeSections.map(({ t, items }) => (
          <section className="sec" key={t.id}>
            <SecHead
              title={
                <>
                  <span aria-hidden>{t.emoji} </span>
                  {t.label}
                </>
              }
              sub={t.sub}
              onSeeAll={() => openPlaceBubble(t)}
            />
            <div className="home-picks">
              {items.map((p) => (
                <SpotCard key={p.key} p={p} row onSelect={onSelect} />
              ))}
            </div>
          </section>
        ))}

        {/* FB-03 (3.7P-7) → 3.7P-20: Guides on Spots — the spots + mixed intention
            guides (Beach day, Free outdoor reset), now the SHARED IntentTile grid
            (same widget as the activities above + the Events Guides), each a POV +
            a "plan a day" destination. */}
        {spotGuides.length > 0 && (
          <section className="sec">
            <SecHead overline="Plans by mood" title="Guides" sub="Collections for getting out there" />
            <div className="intent-grid">
              {spotGuides.map((g) => (
                <IntentTile key={g.id} emoji={g.emoji} label={g.title} pov={g.pov} hue={g.hue} onClick={() => openGuide(g)} />
              ))}
            </div>
          </section>
        )}

        <section className="sec sec-ev" ref={evRef}>
          <SecHead
            title={<>Everything <span className="sec-count">· {all.length.toLocaleString('en-US')}</span></>}
            sub="Every place, by your vibe"
          />
          {/* CARD_LOCK: the place list now renders the canonical SpotCard rows
              (left-image), the one card across every result feed. */}
          <RowFeed sections={everything} onSelect={onSelect} />
        </section>
      </div>
    </div>
  )
}
