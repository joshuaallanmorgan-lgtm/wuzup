// GuidePage — the full-page destination for a tapped Guide (Phase 3.7 §4/§5).
// Mirrors BubblePage's machinery (header band → RowFeed) so a guide reads as the
// same "tap a thing → a destination" pattern the app already trusts. App mounts
// it in the sliding .subpage overlay as { type: 'guide', guide }.
//
// A guide is a curated VIEW (resolveGuide shows ALL its matches — never-hide
// holds). Plannable guides carry an explicit doorway to the upcoming weekend's
// DayPage. Opening that day never seeds an item; placement still requires the
// planner's visible day/daypart confirmation. DRAFT copy — ⚑ Charles.
import { useMemo, useRef } from 'react'
import { CITY, Icon, LENS_BUBBLES, CAT_BUBBLES } from './lib.js'
import { useNav } from './nav.jsx'
import { RowFeed } from './cards.jsx'
import { SaveHeart } from './saves.js'
import LensNav from './LensNav.jsx'
import { usePlaces, PLACE_LENS_BUBBLES, PLACE_CAT_BUBBLES } from './places.js'
import { resolveGuide, resolveWatchGuide } from './guides.js'
import { useTaste } from './taste.js'
import { useArtifact } from './artifacts.js'
import { canonicalGuide, guideFreshness, guideReason, guideSnapshot } from './guide-model.js'
import './bubble.css'

function listingSourceFamilies(items) {
  const values = []
  for (const item of items) {
    const rows = Array.isArray(item?.sources) ? item.sources : [item?.source]
    for (const source of rows) {
      const family = typeof source === 'string' ? source : source?.family || source?.name
      if (family && !values.includes(family)) values.push(family)
      if (values.length >= 5) return values
    }
  }
  return values
}

export default function GuidePage({ guide, events, anchors }) {
  const { openDetail: onSelect, closePage: onClose, openDay, openBubble, openPlaceBubble, openEvFilters } = useNav()
  const taste = useTaste()
  const pgRef = useRef(null)
  const model = useMemo(() => canonicalGuide(guide), [guide])
  const savedGuide = useMemo(
    () => guideSnapshot(model),
    [model]
  )
  const isSpots = guide?.domain === 'spots' // a spots guide gets the place lenses
  // load places only for guides that need them (lazy ~1.2MB fetch, like Spots)
  const {
    places,
    status: placeStatus,
    recover: recoverPlaces,
    recoverLabel: recoverPlacesLabel,
    meta: placeMeta,
  } = usePlaces(!!guide?.needsPlaces)
  const eventArtifact = useArtifact('events')
  const placesRequired = Boolean(guide?.needsPlaces)
  const placesPending = placesRequired && (placeStatus === 'idle' || placeStatus === 'loading')
  const placesUnavailable = placesRequired && ['stale', 'offline', 'error'].includes(placeStatus)

  const upcoming = useMemo(
    () => events.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs),
    [events, anchors]
  )
  const items = useMemo(() => {
    const ranking = { nowMs: anchors.nowMs, city: CITY, taste }
    // 3.75b: timely Watch Guides resolve by keyword against live events; evergreen
    // intention guides resolve via their pure selector.
    if (guide?.kind === 'watch') return resolveWatchGuide(guide, upcoming, ranking)
    return resolveGuide(guide, { events: upcoming, places: Array.isArray(places) ? places : [], anchors }, ranking)
  }, [guide, upcoming, places, anchors, taste])
  // FB-03 (3.7P-7): a MIXED guide LABELS each item's domain — split into "Events"
  // + "Spots" sections (RowFeed renders section labels). Single-domain guides stay
  // one unlabeled list. Each section still shows ALL its matches (never-hide).
  const sections = useMemo(() => {
    if (guide?.domain === 'mixed') {
      const evs = items.filter((it) => it.kind !== 'place')
      const sps = items.filter((it) => it.kind === 'place')
      return [
        evs.length ? { label: 'Events', items: evs } : null,
        sps.length ? { label: 'Spots', items: sps } : null,
      ].filter(Boolean)
    }
    return [{ label: null, items }]
  }, [items, guide])
  const freshness = guideFreshness(isSpots ? placeMeta : eventArtifact.meta, anchors.nowMs)
  const methodReason = guideReason(model)
  const sourceFamilies = listingSourceFamilies(items)

  const planDay = () => openDay(Math.max(anchors.todayTs, anchors.wkStartTs))

  return (
    <div className="pg" ref={pgRef} style={{ '--bh': guide.hue ?? 30 }}>
      <header className="pg-band bub-band">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <div className="bub-band-main">
          <h1 className="bub-title">
            <span className="bub-emoji">{guide.emoji}</span>
            {guide.title}
          </h1>
          {savedGuide && <SaveHeart e={savedGuide} big />}
          <div className="pg-count">
            {placesPending
              ? 'Checking spot ideas…'
              : `${items.length} ${placesUnavailable ? 'available ' : ''}${items.length === 1 ? 'idea' : 'ideas'}`}
          </div>
          <div className="bub-tag">{guide.pov}</div>
          {guide.plannable && (
            <button className="guide-plan-cta" onClick={planDay}>
              Plan this day
            </button>
          )}
          {methodReason && <div className="guide-sources">Why these appear: {methodReason}</div>}
          <div className="guide-sources">{freshness.label}</div>
          {sourceFamilies.length > 0 && (
            <div className="guide-sources">Listing sources in this collection: {sourceFamilies.join(' / ')}</div>
          )}
          {/* 3.75b: show the provenance — for a Watch Guide this discloses that the
              list is keyword-matched against live listings, not hand-curated. */}
          {Array.isArray(guide.sources) && guide.sources.length > 0 && (
            <div className="guide-sources">{guide.sources.join(' · ')}</div>
          )}
        </div>
      </header>
      {/* CARD_LOCK: the shared filter-chip bar on results too — lenses by domain. */}
      <LensNav
        lenses={isSpots ? PLACE_LENS_BUBBLES : LENS_BUBBLES}
        categories={isSpots ? PLACE_CAT_BUBBLES : CAT_BUBBLES}
        menuLabel={isSpots ? 'All spots' : 'All categories'}
        onOpen={isSpots ? openPlaceBubble : openBubble}
        onFilter={isSpots ? undefined : openEvFilters}
      />
      <div className="pg-body">
        {items.length > 0 && (
          <RowFeed sections={sections} scrollRootRef={pgRef} onSelect={onSelect} />
        )}
        {placesPending && (
          <div className="empty empty-sm" role="status">Checking spot ideas…</div>
        )}
        {placesUnavailable && (
          <div className="empty empty-sm" role="alert">
            {placeStatus === 'stale'
              ? 'Spot ideas are too old to show.'
              : placeStatus === 'offline'
                ? 'You’re offline. Spot ideas weren’t loaded.'
                : 'Spot ideas couldn’t be verified.'}
            {recoverPlaces && (
              <button className="empty-cta" onClick={recoverPlaces}>{recoverPlacesLabel}</button>
            )}
          </div>
        )}
        {items.length === 0 && !placesPending && !placesUnavailable && (
          <div className="empty">
            Nothing fits this guide right now — check back soon.
          </div>
        )}
      </div>
    </div>
  )
}
