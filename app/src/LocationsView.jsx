// LocationsView — the Spots tab. 3.7P-12 (ADDENDUM H) recast it ACTIVITY-FIRST:
// the old placeType browse (a 1,322-park green wall) is replaced by "what you can
// DO" — Beach day · Trails & nature · On the water · Sports & courts · Family &
// play · Dog-friendly · Scenic views · More to explore. Each is a PURE predicate over
// EXISTING fields (places.js ACTIVITIES; no new data), so a single park surfaces
// under its real affordances instead of as "a park." Structure: hero → activity
// intent frame (the quick nav) → Near you (persistent) → Saved places → per-
// activity carousels (the body) → Guides (plans by mood) → Everything (never-hide
// see-all). One shared objective rank keeps quality, context, and taste separate.
//
// Places are a SECOND lazy store (usePlaces): /places.json fetches on first mount
// of this tab, never at boot, never merged into the events feed. DRAFT copy ⚑ Charles.
import { useMemo, useRef, useState } from 'react'
import { CITY, fmtLocale } from './lib.js'
import { dayStamp } from './coverage.js'
import { useNav } from './nav.jsx'
import { SecHead, SpotCard, IntentTile, RowFeed, SkeletonRow } from './cards.jsx'
import { GUIDES } from './guides.js'
import { railReady, useTaste } from './taste.js'
import { usePlaces, ACTIVITIES, PLACE_LENS_BUBBLES, PLACE_CAT_BUBBLES, isPlaceKey, normalizePlace } from './places.js'
import { useSaves } from './saves.js'
import { rankSpots, SPOT_NEAR_RADIUS_MILES } from './spot-context.js'
import LensNav from './LensNav.jsx'
import TasteTuner from './TasteTuner.jsx'
import SearchBarButton from './SearchBarButton.jsx'
import './locations.css'

// SPOTS_GRIND themed sections (ref-spots-full), each over REAL fields so the
// grouping is honest. Coffee & Hang is backed by named cafe records rather than
// a fabricated editorial collection.
const actMatch = (id) => ACTIVITIES.find((a) => a.id === id)?.match || (() => false)
const SPOT_THEMES = [
  { id: 'nature-water', emoji: '🌿', label: 'Nature & Water', hue: 150, sub: 'Trails and places by or on the water.', match: (p) => actMatch('act-trails')(p) || actMatch('act-water')(p) },
  { id: 'coffee-hang', emoji: '☕', label: 'Coffee & Hang', hue: 24, sub: 'Cafes from the current place listings.', match: (p) => p.placeType === 'cafe' },
  { id: 'beaches-views', emoji: '🌅', label: 'Beaches & Views', hue: 25, sub: 'Beaches, piers, and mapped viewpoints.', match: (p) => actMatch('act-views')(p) || actMatch('act-beach')(p) },
  { id: 'quiet-corners', emoji: '🧭', label: 'Preserves & more', hue: 280, sub: 'Nature preserves and additional places.', match: (p) => p.hidden === true || p.placeType === 'preserve' },
]

export default function LocationsView({ coords }) {
  const { openDetail: onSelect, openPlaceBubble, openGuide, openSearch, openDeck } = useNav()
  // FB-03 (3.7P-7): the Spots page shows SPOTS + MIXED guides (Beach day, Free
  // outdoor reset) — the place-domain guides.
  const spotGuides = GUIDES.filter((g) => g.domain === 'spots' || g.domain === 'mixed')
  const { places, status, recover, recoverLabel, meta: placeMeta } = usePlaces()
  const placeDataAt = placeMeta?.generatedAt ? Date.parse(placeMeta.generatedAt) : null
  const placeHealth = placeMeta?.sourceHealth?.status
  const saves = useSaves()
  const taste = useTaste()
  const [nowMs] = useState(() => Date.now())
  // Lead-shelf See all scrolls to the complete, count-preserving master order.
  const scrollRef = useRef(null)
  const evRef = useRef(null)
  const scrollToEverything = () => {
    const sc = scrollRef.current
    if (sc && evRef.current) sc.scrollTo({ top: Math.max(evRef.current.offsetTop - 64, 0), behavior: 'smooth' })
  }

  // One shared objective rank owns every Spots shelf. Image availability is not
  // an input, and the complete master order preserves catalog reachability.
  const allRanking = useMemo(
    () => rankSpots(Array.isArray(places) ? places : [], {
      nowMs,
      city: CITY,
      taste,
      coords,
      attachDistance: Boolean(coords),
      mode: 'browse',
      diversityPolicy: { prefix: 20, sourceMax: 6, categoryMax: 8, venueMax: 1, canonicalMax: 1, seriesMax: 1 },
    }),
    [places, nowMs, taste, coords]
  )
  const all = allRanking.ordered
  const hasLocationFix = allRanking.contextInspection.hasLocationFix
  // TINDER P3: two REAL top-ranked spots for the Tune-your-taste preview cards.
  const tuneSamples = useMemo(() => all.slice(0, 2), [all])
  const nearbyRanking = useMemo(
    () => rankSpots(all, {
      nowMs,
      city: CITY,
      taste,
      coords,
      radiusMiles: SPOT_NEAR_RADIUS_MILES,
      attachDistance: hasLocationFix,
      mode: 'nearby',
      diversityPolicy: { prefix: 12, sourceMax: 4, categoryMax: 5, venueMax: 1, canonicalMax: 1, seriesMax: 1 },
    }),
    [all, nowMs, taste, coords, hasLocationFix]
  )
  // A Near shelf requires an in-market location fix and an explicit radius.
  // Without a fix, the broad evidence-ranked lead remains honestly unlabeled.
  const nearSpots = useMemo(
    () => hasLocationFix ? nearbyRanking.withinRadius.slice(0, 3) : all.slice(0, 3),
    [nearbyRanking.withinRadius, all, hasLocationFix]
  )

  const additionalRanking = useMemo(() => {
    const nearKeys = new Set(nearSpots.map((p) => p.key))
    return rankSpots(all.filter((p) => !nearKeys.has(p.key)), {
      nowMs,
      city: CITY,
      taste,
      coords,
      attachDistance: hasLocationFix,
      mode: 'additional',
      diversityPolicy: { prefix: 12, sourceMax: 4, categoryMax: 5, venueMax: 1, canonicalMax: 1, seriesMax: 1 },
    })
  }, [all, nearSpots, nowMs, taste, coords, hasLocationFix])
  const moreSpots = additionalRanking.ordered.slice(0, 3)

  // Each real theme predicate is followed by the same objective contract. See
  // all opens the full matched set; photos never determine membership or order.
  const themeSections = useMemo(
    () =>
      SPOT_THEMES.map((t) => {
        const matched = all.filter(t.match)
        const ordered = rankSpots(matched, {
          nowMs,
          city: CITY,
          taste,
          coords,
          activity: t,
          attachDistance: hasLocationFix,
          mode: 'theme',
          diversityPolicy: { prefix: 8, sourceMax: 3, categoryMax: 4, venueMax: 1, canonicalMax: 1, seriesMax: 1 },
        }).ordered
        const items = ordered.slice(0, 3)
        return { t, items, total: matched.length }
      }).filter((s) => s.total >= 3 && s.items.length > 0),
    [all, nowMs, taste, coords, hasLocationFix]
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

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="hot-scroll">
        <header className="loc-head">
          <h1 className="loc-head-title">Spots</h1>
          <div className="loc-head-sub">Loading the bay's places…</div>
        </header>
        {/* PREMIUM A4 (motion#8): skeleton rows fill in instead of a bare line */}
        <div className="home-picks" style={{ marginTop: 14 }}>
          {[0, 1, 2].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    )
  }
  if (['stale', 'offline', 'error'].includes(status) || all.length === 0) {
    return (
      <div className="hot-scroll">
        <header className="loc-head">
          <h1 className="loc-head-title">Spots</h1>
        </header>
        <div className="empty">
          {status === 'stale'
            ? 'These place listings are too old to show safely.'
            : status === 'offline'
              ? 'You’re offline. Places weren’t loaded.'
              : status === 'error'
                ? "Couldn't verify places right now."
                : 'No places are available here yet.'}
          {Number.isFinite(placeDataAt) && (
            <div className="loc-data-note">Last verified snapshot: {dayStamp(placeDataAt)}</div>
          )}
          {status !== 'empty' && all.length === 0 && recover && (
            <button className="empty-cta" onClick={recover}>{recoverLabel}</button>
          )}
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
        <div className="loc-data-note">
          {Number.isFinite(placeDataAt) && <>Data from {dayStamp(placeDataAt)}</>}
          {placeHealth === 'healthy' && <> · source check complete</>}
          {placeHealth === 'degraded' && <> · some sources unavailable</>}
          {placeHealth === 'unknown' && <> · source check unavailable</>}
        </div>
        <SearchBarButton placeholder="Search spots — beaches, trails, dog parks…" onClick={openSearch} ariaLabel="Search spots" />
      </header>

      {/* Phase 3.6 N1: quiet top nav — quality lenses (Free/Hidden/Dog) + an
          All-spots menu of the place types (same destinations). */}
      <LensNav
        lenses={PLACE_LENS_BUBBLES}
        categories={PLACE_CAT_BUBBLES}
        menuLabel="All spots"
        onOpen={openPlaceBubble}
      />

      <div className="hot-body">
        {/* TINDER P3: "Tune your taste" — the light doorway into the SPOTS swipe
            deck, between the chips and the first section (tinder.png). */}
        <TasteTuner kind="places" samples={tuneSamples} onTune={openDeck} />

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

        {/* The lead is objective quality plus bounded context. Distance appears
            only for a real location fix; image availability never affects order. */}
        {nearSpots.length > 0 && (
          <section className="sec">
            {/* Distance language appears only with a real location fix. Without
                one, this is simply a transparent entry into the current catalog. */}
            <SecHead
              overline={hasLocationFix ? 'Near your location' : 'Start exploring'}
              title={hasLocationFix ? 'Nearby places to explore' : 'Places to explore'}
              sub={hasLocationFix
                ? `Within ${SPOT_NEAR_RADIUS_MILES} miles; useful details and fit come before distance`
                : railReady(taste) ? 'Ordered using what you have tapped' : 'A starting point from the current catalog'}
              onSeeAll={scrollToEverything}
            />
            <div className="home-picks">
              {nearSpots.map((p) => (
                <SpotCard key={p.key} p={p} row onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {moreSpots.length >= 2 && (
          <section className="sec">
            {/* This is the next unused batch, not evidence of trip-worthiness. */}
            <SecHead
              overline="Keep browsing"
              title="More places to explore"
              sub={hasLocationFix ? 'Useful details and fit come before distance.' : 'More from the current catalog.'}
              onSeeAll={scrollToEverything}
            />
            <div className="home-picks">
              {moreSpots.map((p) => (
                <SpotCard key={p.key} p={p} row onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* 3.7P-12: Saved places — your own shelf, mirroring Events */}
        {savedPlaces.length > 0 && (
          <section className="sec">
            <SecHead overline="Your places" title="Saved" sub={`${savedPlaces.length} kept`} />
            <div className="carousel carousel-stagger">
              {savedPlaces.map((p) => (
                <SpotCard key={p.key} p={p} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* Themed rows use field-backed predicates and keep each full matched set
            one See-all away. The activity intent grid above stays the quick nav. */}
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
            title={<>Everything <span className="sec-count">· {all.length.toLocaleString(fmtLocale)}</span></>}
            sub="Every place remains available in the shared ranked order"
          />
          {/* CARD_LOCK: the place list now renders the canonical SpotCard rows
              (left-image), the one card across every result feed. */}
          <RowFeed sections={everything} onSelect={onSelect} />
        </section>
      </div>
    </div>
  )
}
