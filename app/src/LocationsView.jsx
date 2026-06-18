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
import { useMemo } from 'react'
import { useNav } from './nav.jsx'
import { SecHead, SpotCard, EndCap, FeaturedCard, IntentTile, RowFeed, imageMode } from './cards.jsx'
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

export default function LocationsView({ coords }) {
  const { openDetail: onSelect, openPlaceBubble, openGuide, openSearch, openMap } = useNav()
  // FB-03 (3.7P-7): the Spots page shows SPOTS + MIXED guides (Beach day, Free
  // outdoor reset) — the place-domain guides.
  const spotGuides = GUIDES.filter((g) => g.domain === 'spots' || g.domain === 'mixed')
  const { places, status } = usePlaces()
  const saves = useSaves()
  const taste = useTaste()

  const all = useMemo(() => (Array.isArray(places) ? placeOrder(places, taste) : []), [places, taste])
  const near = useMemo(() => nearest(all, coords, 12), [all, coords])
  // 3.7P-24 (§N screen 6): the single "Recommended" featured spot — the closest
  // taste-top place when located, else the taste-top place overall.
  // 1-B (Stage 1): prefer a pick that has a REAL photo so the Recommended hero
  // never falls back to a flat color block; if none in the active pool qualifies,
  // take the top pick anyway (FeaturedCard renders the text-rich no-photo card).
  const spotPool = coords && near.length ? near : all
  const topSpot = spotPool.find((p) => imageMode(p) === 'photo') || spotPool[0] || null

  // 3.7P-12: per-activity taster lists. `all` is taste-ordered, so a plain
  // slice keeps taste order; with a fix, nearest() re-sorts by distance. An
  // activity carousel shows only when ≥3 places match (never a thin/fake row);
  // the full set is always one tap away (See all → PlaceBubblePage, never-hide).
  const activitySections = useMemo(
    () =>
      ACTIVITIES.map((a) => {
        const matched = all.filter(a.match)
        const items = coords ? nearest(matched, coords, 6) : matched.slice(0, 6)
        return { a, items, total: matched.length }
      }).filter((s) => s.total >= 3),
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
    <div className="hot-scroll">
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
        {topSpot && (
          <section className="sec">
            {/* Stage R: honest subtitle (D6) — the pick is nearest when located,
                taste-derived only when the rail has real organic signal, else a
                neutral true claim. Never assert "recent taps" without signal. */}
            <SecHead
              overline="Worth a visit"
              title={coords ? 'Recommended near you' : 'Recommended for you'}
              sub={coords ? 'Closest to you right now' : railReady(taste) ? 'Based on what you have tapped' : 'A local favorite to start with'}
            />
            <FeaturedCard e={topSpot} onSelect={onSelect} />
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

        {/* 3.7P-12: the activity-first body — a taster carousel per activity, each
            with a See-all into the full filtered set (never-hide). Replaces the
            old placeType sections (Beaches/Hidden/Classics/Free); "The classics"
            is dropped (srcCount≥3 = weak signal) and Hidden is now an activity. */}
        {activitySections.map(({ a, items, total }) => (
          <section className="sec" key={a.id}>
            <SecHead
              title={
                <>
                  <span aria-hidden>{a.emoji} </span>
                  {a.label}
                </>
              }
              sub={coords ? 'Nearest first' : `${total.toLocaleString('en-US')} to explore`}
              onSeeAll={() => openPlaceBubble(a)}
            />
            <div className="carousel">
              {items.map((p) => (
                <SpotCard key={p.key} p={p} onSelect={onSelect} />
              ))}
              <EndCap onClick={() => openPlaceBubble(a)} />
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

        <section className="sec sec-ev">
          <SecHead
            title={<>Everything <span className="sec-count">· {all.length.toLocaleString('en-US')}</span></>}
            sub="Every place, by your vibe"
          />
          {/* 3.7P-24: the place list goes COMPACT — dense field-guide rows (name ·
              type · distance · amenity chips), NO green art placeholder for the
              photo-less majority (the green-wall fix; decide = dense). */}
          <RowFeed sections={everything} compact onSelect={onSelect} />
        </section>
      </div>
    </div>
  )
}
