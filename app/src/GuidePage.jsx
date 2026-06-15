// GuidePage — the full-page destination for a tapped Guide (Phase 3.7 §4/§5).
// Mirrors BubblePage's machinery (header band → RowFeed) so a guide reads as the
// same "tap a thing → a destination" pattern the app already trusts. App mounts
// it in the sliding .subpage overlay as { type: 'guide', guide }.
//
// A guide is a curated VIEW (resolveGuide shows ALL its matches — never-hide
// holds). Place-based guides ("Beach day", "Free outdoor reset") carry a "Plan a
// day around this" action that seeds the top always-there place into the upcoming
// weekend and opens that DayPage — the Discover→Plan bridge, made a one-tap move.
// Only PLACES are ever pre-seeded (always-there); a date-pinned event is never
// dropped onto an arbitrary day. DRAFT copy — ⚑ Charles.
import { useMemo, useRef } from 'react'
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { RowFeed } from './cards.jsx'
import { usePlaces } from './places.js'
import { resolveGuide } from './guides.js'
import { loadDayPlans, saveDayPlans, withSlot } from './dayplan.js'
import './bubble.css'

export default function GuidePage({ guide, events, anchors }) {
  const { openDetail: onSelect, closePage: onClose, openDay } = useNav()
  const pgRef = useRef(null)
  // load places only for guides that need them (lazy ~1.2MB fetch, like Spots)
  const { places } = usePlaces(!!guide?.needsPlaces)

  const upcoming = useMemo(
    () => events.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs),
    [events, anchors]
  )
  const items = useMemo(
    () => resolveGuide(guide, { events: upcoming, places: Array.isArray(places) ? places : [], anchors }),
    [guide, upcoming, places, anchors]
  )
  const sections = useMemo(() => [{ label: null, items }], [items])

  // "Plan a day around this": seed the top always-there PLACE into the upcoming
  // weekend's day slot, then open it. If the guide has no place (event-only),
  // just open the weekend day to plan — never pre-seed a date-pinned event.
  const planDay = () => {
    const place = items.find((it) => it.kind === 'place')
    if (place) saveDayPlans(withSlot(loadDayPlans(anchors), anchors.wkStartTs, 'day', place.key))
    openDay(anchors.wkStartTs)
  }

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
          <div className="pg-count">
            {items.length} {items.length === 1 ? 'idea' : 'ideas'}
          </div>
          <div className="bub-tag">{guide.pov}</div>
          {guide.plannable && items.length > 0 && (
            <button className="guide-plan-cta" onClick={planDay}>
              ＋ Plan a day around this
            </button>
          )}
        </div>
      </header>
      <div className="pg-body">
        {items.length > 0 ? (
          <RowFeed sections={sections} scrollRootRef={pgRef} onSelect={onSelect} />
        ) : (
          <div className="empty">
            Nothing fits this guide right now — check back soon.
          </div>
        )}
      </div>
    </div>
  )
}
