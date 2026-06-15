// LocationsView — the Locations tab (Sprint S1): Hot's structural twin over
// the PLACES store. Hero → place-bubble strip → magazine sections (Near you /
// Hidden spots / The classics / Free forever) → Everything browse. Reuses the
// shared card/section components (SecHead, TonightCard, EndCap, RowFeed) and
// the .hot-scroll / .hero / .sec / .carousel CSS + LensNav (topnav.css) — a
// place renders through them unchanged because places.js aliases name→title + venue.
//
// Places are a SECOND lazy store (usePlaces): the /places.json fetch fires on
// first mount of this tab, never at boot, never merged into the events feed.
// Taste REORDERS only, never filters (the standing invariant): every list is a
// count-preserving sort by category affinity, then a mild source-corroboration
// tiebreak, then name. DRAFT copy for Charles (⚑S1 hero image: Charles picks).
import { useEffect, useMemo, useState } from 'react'
import { useNav } from './nav.jsx'
import { CITY } from './lib.js'
import { SecHead, TonightCard, EndCap, RowFeed } from './cards.jsx'
import { tasteNudge, useTaste } from './taste.js'
import { usePlaces, PLACE_BUBBLES, PLACE_LENS_BUBBLES, PLACE_CAT_BUBBLES, classics, nearest } from './places.js'
import LensNav from './LensNav.jsx'
import './locations.css'

// count-preserving order: category affinity (S3) desc, then corroboration
// (srcCount) desc, then name — taste reorders, never hides.
function placeOrder(list, taste) {
  return [...list].sort(
    (a, b) =>
      tasteNudge(b, taste) - tasteNudge(a, taste) ||
      (b.srcCount || 0) - (a.srcCount || 0) ||
      a.name.localeCompare(b.name)
  )
}

export default function LocationsView({ coords, requestCoords }) {
  const { openDetail: onSelect, openPlaceBubble } = useNav()
  const { places, status } = usePlaces()
  const taste = useTaste()

  // W4: real Spots hero (Bayshore Blvd — Tampa Bay's waterfront). Preload + fade
  // over the teal placeholder, mirroring the Events hero. ⚑S1: Charles's final pick.
  const [heroOk, setHeroOk] = useState(false)
  useEffect(() => {
    const img = new Image()
    img.onload = () => setHeroOk(true)
    img.src = CITY.spotsHero
    return () => {
      img.onload = null
    }
  }, [])

  const all = useMemo(() => (Array.isArray(places) ? placeOrder(places, taste) : []), [places, taste])
  const near = useMemo(() => nearest(all, coords, 12), [all, coords])
  const hidden = useMemo(() => all.filter((p) => p.hidden), [all])
  const classicsList = useMemo(() => classics(all), [all])
  const freeList = useMemo(() => all.filter((p) => p.isFree === true), [all])
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
            ? "Couldn't load places right now — check back in a moment 🌴"
            : 'No places on the map yet — check back soon 🌴'}
        </div>
      </div>
    )
  }

  return (
    <div className="hot-scroll">
      {/* W4: real Spots hero — Bayshore Boulevard, Tampa Bay's waterfront (a
          verified Wikimedia Commons photo). ⚑S1: Charles may swap the final pick;
          the teal ::before stays as the pre-load placeholder. */}
      <header className="loc-hero">
        <div className={'loc-hero-img' + (heroOk ? ' on' : '')} style={{ backgroundImage: `url(${CITY.spotsHero})` }} />
        <div className="loc-hero-wash" />
        <div className="hero-text">
          <div className="hero-kicker">ALWAYS HERE · NO SCHEDULE</div>
          <h1 className="hero-city">Spots</h1>
          <div className="hero-sub">{all.length.toLocaleString('en-US')} places across Tampa Bay</div>
        </div>
      </header>

      {/* Phase 3.6 N1: quiet top nav — quality lenses (Free/Hidden/Dog) as pills
          + an All-spots menu of the place types (same destinations). */}
      <LensNav
        lenses={PLACE_LENS_BUBBLES}
        categories={PLACE_CAT_BUBBLES}
        menuLabel="All spots"
        onOpen={openPlaceBubble}
      />

      <div className="hot-body">
        {/* Near you — needs a location fix; honest prompt when we don't have one */}
        {coords && near.length > 0 ? (
          <section className="sec">
            <SecHead overline="Closest to you" title="Near you" sub={`${near.length} within reach`} />
            <div className="carousel">
              {near.map((p) => (
                <TonightCard key={p.key} e={p} onSelect={onSelect} />
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

        {hidden.length > 0 && (
          <section className="sec">
            <SecHead overline="Under the radar" title="Hidden spots" sub={`${hidden.length} quiet finds`} />
            <div className="carousel">
              {hidden.map((p) => (
                <TonightCard key={p.key} e={p} onSelect={onSelect} />
              ))}
              <EndCap onClick={() => openPlaceBubble(PLACE_BUBBLES.find((b) => b.id === 'hidden'))} />
            </div>
          </section>
        )}

        {classicsList.length > 0 && (
          <section className="sec">
            <SecHead overline="Everybody knows them" title="The classics" sub={`${classicsList.length} bay staples`} />
            <div className="carousel">
              {classicsList.slice(0, 12).map((p) => (
                <TonightCard key={p.key} e={p} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {freeList.length > 0 && (
          <section className="sec">
            <SecHead
              overline="$0 forever"
              title="Free"
              sub={`${freeList.length} always free`}
              onSeeAll={() => openPlaceBubble(PLACE_BUBBLES.find((b) => b.id === 'free'))}
            />
            <div className="carousel">
              {freeList.slice(0, 12).map((p) => (
                <TonightCard key={p.key} e={p} onSelect={onSelect} />
              ))}
              <EndCap onClick={() => openPlaceBubble(PLACE_BUBBLES.find((b) => b.id === 'free'))} />
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
