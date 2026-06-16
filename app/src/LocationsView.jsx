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
import { useEffect, useMemo, useState } from 'react'
import { useNav } from './nav.jsx'
import { CITY } from './lib.js'
import { SecHead, SpotCard, EndCap, GuideCard, RowFeed } from './cards.jsx'
import { GUIDES } from './guides.js'
import { tasteNudge, useTaste } from './taste.js'
import { usePlaces, ACTIVITIES, PLACE_LENS_BUBBLES, PLACE_CAT_BUBBLES, nearest, isPlaceKey, normalizePlace } from './places.js'
import { useSaves } from './saves.js'
import LensNav from './LensNav.jsx'
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

export default function LocationsView({ coords, requestCoords }) {
  const { openDetail: onSelect, openPlaceBubble, openGuide } = useNav()
  // FB-03 (3.7P-7): the Spots page shows SPOTS + MIXED guides (Beach day, Free
  // outdoor reset) — the place-domain guides.
  const spotGuides = GUIDES.filter((g) => g.domain === 'spots' || g.domain === 'mixed')
  const { places, status } = usePlaces()
  const saves = useSaves()
  const taste = useTaste()

  // W4: real Spots hero (Bayshore Blvd). Preload + fade over the teal placeholder.
  const [heroOk, setHeroOk] = useState(false)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setHeroOk(true)
    img.src = CITY.spotsHeroes?.[0]?.url || CITY.spotsHero
    return () => {
      img.onload = null
    }
  }, [])

  const all = useMemo(() => (Array.isArray(places) ? placeOrder(places, taste) : []), [places, taste])
  const near = useMemo(() => nearest(all, coords, 12), [all, coords])

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
        <div className="loc-hero loc-hero-flat">
          <div className="hero-text">
            <h1 className="hero-city">Spots</h1>
            <div className="hero-sub">Loading the bay's places…</div>
          </div>
        </div>
      </div>
    )
  }
  if (status === 'error' || all.length === 0) {
    return (
      <div className="hot-scroll">
        <div className="loc-hero loc-hero-flat">
          <div className="hero-text">
            <h1 className="hero-city">Spots</h1>
          </div>
        </div>
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
      {/* W4 + 3.7P-6: real Spots hero — Bayshore Boulevard, Ken-Burns zoom */}
      <header className="loc-hero">
        <div className={'loc-hero-img hero-kb' + (heroOk ? ' on' : '')} style={{ backgroundImage: `url(${CITY.spotsHeroes?.[0]?.url || CITY.spotsHero})` }} />
        <div className="loc-hero-wash" />
        <div className="hero-text">
          <div className="hero-brand">
            <span className="hero-brand-dot" aria-hidden />
            Wuzup
          </div>
          <div className="hero-kicker">Always here, no schedule</div>
          <h1 className="hero-city">Spots</h1>
          <div className="hero-sub">Parks, beaches, trails and quiet corners.</div>
        </div>
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
        {/* 3.7P-12: ACTIVITY intent frame — the primary Spots nav. Tap an activity
            to see everywhere you can do it (See all → never-hide). This is the
            green-wall fix: you browse by what you can DO, not by placeType. */}
        <section className="sec">
          <SecHead overline="What are you up for?" title="By activity" />
          <div className="act-frame">
            {ACTIVITIES.map((a) => (
              <button
                key={a.id}
                className="act-chip pressable"
                style={{ '--ah': a.hue }}
                onClick={() => openPlaceBubble(a)}
              >
                <span className="act-chip-emoji" aria-hidden>
                  {a.emoji}
                </span>
                <span className="act-chip-label">{a.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Near you — persistent distance scope; honest prompt without a fix */}
        {coords && near.length > 0 ? (
          <section className="sec">
            <SecHead overline="Closest to you" title="Near you" sub={`${near.length} within reach`} />
            <div className="carousel">
              {near.map((p) => (
                <SpotCard key={p.key} p={p} onSelect={onSelect} />
              ))}
            </div>
          </section>
        ) : (
          <section className="sec">
            <SecHead overline="Closest to you" title="Near you" />
            <div className="loc-locate">
              <div className="loc-locate-txt">Tampa Bay's big — find the spots nearest you.</div>
              <button className="loc-locate-btn" onClick={() => requestCoords && requestCoords()}>
                📍 Use my location
              </button>
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

        {/* 3.7P-12: the activity-first body — a taster carousel per activity, each
            with a See-all into the full filtered set (never-hide). Replaces the
            old placeType sections (Beaches/Hidden/Classics/Free); "The classics"
            is dropped (srcCount≥3 = weak signal) and Hidden is now an activity. */}
        {activitySections.map(({ a, items, total }) => (
          <section className="sec" key={a.id}>
            <SecHead
              overline={a.emoji + ' Activity'}
              title={a.label}
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

        {/* FB-03 (3.7P-7): Guides on Spots — the spots + mixed intention guides
            (Beach day, Free outdoor reset), each a POV + a "plan a day" action. */}
        {spotGuides.length > 0 && (
          <section className="sec">
            <SecHead overline="Plans by mood" title="Guides" sub="Collections for getting out there" />
            <div className="carousel">
              {spotGuides.map((g) => (
                <GuideCard key={g.id} guide={g} onOpen={openGuide} />
              ))}
            </div>
          </section>
        )}

        <section className="sec sec-ev">
          <SecHead
            title={<>Everything <span className="sec-count">· {all.length.toLocaleString('en-US')}</span></>}
            sub="Every place, by your vibe"
          />
          <RowFeed sections={everything} onSelect={onSelect} />
        </section>
      </div>
    </div>
  )
}
