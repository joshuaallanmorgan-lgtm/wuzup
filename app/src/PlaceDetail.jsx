// PlaceDetail — full-page place detail (Sprint S2), the place-side twin of
// DetailPage. Reuses the detail chrome (hero morph, back, ♥ save, lazy
// mini-map, share, directions) but speaks PLACE semantics instead of event
// ones: no when/tickets/ICS — instead amenities, hours, free/fee, an honest
// weather-fit line, sources, and the place→plan bridge ("Make this my plan").
//
// Opened through the SHARED detail layer (nav.openDetail records the taste +
// recents signal generically via keyOf/category); App renders THIS component
// when detail.kind === 'place'. The hero owns the 'evt-hero' viewTransitionName
// so the card→detail morph works exactly as it does for events.
//
// ALL COPY IS DRAFT for Charles.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getLeaflet } from './leaflet-lazy.js'
import { useNav } from './nav.jsx'
import { Icon, keyOf } from './lib.js'
import { SecHead, TonightCard, artEmoji, hueFor, spotChips } from './cards.jsx'
import { SaveHeart, useSaves } from './saves.js'
import { dateKey } from './weather.js'
import { usePlaces, ACTIVITIES } from './places.js'
import { DAYPART } from './weekend.js'
import { loadDayPlans, saveDayPlans, withSlot, dayEntryFor, PARTS } from './dayplan.js'
import './locations.css'

// normalized amenity vocabulary → human label + emoji (DRAFT for Charles).
// Unknown amenities fall back to a title-cased version of the slug, so a new
// pipeline amenity never renders as a raw token.
const AMENITY_LABELS = {
  'dog-park': ['🐕', 'Dog park'],
  'dog-beach': ['🐕', 'Dog beach'],
  'dogs-allowed': ['🐕', 'Dogs allowed'],
  beach: ['🏖️', 'Beach'],
  hiking: ['🥾', 'Hiking'],
  swimming: ['🏊', 'Swimming'],
  boating: ['⛵', 'Boating'],
  fishing: ['🎣', 'Fishing'],
  'boat-ramp': ['🚤', 'Boat ramp'],
  'canoe-launch': ['🛶', 'Canoe / kayak launch'],
  restrooms: ['🚻', 'Restrooms'],
  playground: ['🛝', 'Playground'],
  ada: ['♿', 'Accessible'],
  tennis: ['🎾', 'Tennis'],
  pickleball: ['🏓', 'Pickleball'],
  basketball: ['🏀', 'Basketball'],
  volleyball: ['🏐', 'Volleyball'],
  racquetball: ['🎾', 'Racquetball'],
  'disc-golf': ['🥏', 'Disc golf'],
  shuffleboard: ['🥌', 'Shuffleboard'],
  'skate-park': ['🛹', 'Skate park'],
  trails: ['🥾', 'Trails'],
  'nature-trails': ['🌿', 'Nature trails'],
  pier: ['🎣', 'Pier'],
  marina: ['⚓', 'Marina'],
  pool: ['🏊', 'Pool'],
  'splash-pad': ['💦', 'Splash pad'],
  grills: ['🔥', 'Grills'],
  shelters: ['⛱️', 'Picnic shelters'],
  picnic: ['🧺', 'Picnic area'],
  golf: ['⛳', 'Golf'],
  gym: ['🏋️', 'Gym'],
  fitness: ['🏋️', 'Fitness'],
  camping: ['🏕️', 'Camping'],
  'community-center': ['🏛️', 'Community center'],
  concessions: ['🍿', 'Concessions'],
  bandshell: ['🎶', 'Bandshell'],
  baseball: ['⚾', 'Ball fields'],
  'autism-friendly': ['🧩', 'Autism-friendly'],
}
const amenityChip = (a) => AMENITY_LABELS[a] || ['•', a.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())]

const wdLong = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'long' })

// upcoming days for the Make-this-my-plan picker: today + the next 13 days
// (two weeks of horizon — the same supply window the day screen plans into).
function planDays(anchors) {
  const out = []
  const d0 = new Date(anchors.todayTs)
  for (let i = 0; i < 14; i++) {
    const ts = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime()
    out.push({ ts, label: ts === anchors.todayTs ? 'Today' : ts === anchors.tomorrowTs ? 'Tomorrow' : wdLong(ts) })
  }
  return out
}

export default function PlaceDetail({ e, anchors, wx }) {
  const { closing, vtOpen: vt, closeDetail: onClose, openDetail: onSelect, focusMap: onFocusMap } = useNav()
  const { places } = usePlaces()
  const { has: hasSave, toggle: toggleSave } = useSaves()
  const saved = hasSave(e)

  // W4: a place with a REAL Wikidata photo gets an image hero (preload + 300ms
  // fade over a dark placeholder, DetailPage's exact pattern); places without a
  // photo keep the category-art hero. e.image is only ever a verified photo OF
  // THIS place (Wikidata P18 → Commons), never a representative stand-in.
  const [loadedSrc, setLoadedSrc] = useState(null)
  const [heroFailed, setHeroFailed] = useState(false)
  useEffect(() => {
    if (!e.image) return
    const src = e.image
    const img = new Image()
    img.onload = () => setLoadedSrc(src)
    img.onerror = () => setHeroFailed(true) // dead URL → fall back to category-art
    img.src = src
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [e.image])
  const imgOk = loadedSrc === e.image
  // a real photo that loads → image hero; no photo OR a broken URL → art hero
  const heroArt = !e.image || heroFailed

  const hasCoords = e.lat != null && e.lng != null
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
    : e.name
      ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([e.name, e.address].filter(Boolean).join(', '))
      : null

  const free = e.isFree === true
  const feeLine = free ? 'Free' : e.fee ? e.fee : null
  const placeTypeLabel = (e.placeType || 'spot').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const distLine = e._dist != null ? e._dist.toFixed(1) + ' mi away' : null
  // 3.7P-24 (§N screen 7 "Best for"): the activity intents this place actually
  // satisfies — derived from the SAME pure ACTIVITIES predicates the Spots tab
  // browses by (real fields, never invented). Up to 4.
  const bestFor = useMemo(() => ACTIVITIES.filter((a) => a.match(e)).slice(0, 4), [e])
  // Stage R (§N spot detail): top-amenity TAG CHIPS under the title — the same
  // honest spotChips the cards use; the FULL list still renders in "What's here".
  const tagChips = useMemo(() => spotChips(e), [e])
  const outdoorish = e.category === 'outdoors' || ['park', 'beach', 'preserve', 'trail', 'viewpoint', 'pier', 'dog_park', 'garden'].includes(e.placeType)

  // weather-fit (S2): honest, derived only from the real 16-day forecast.
  // For an outdoor place, find the soonest CLEAR/PARTLY day in the next week
  // and name it ("Great park day Saturday"). Omitted entirely when no forecast
  // or no good day — never invented.
  const wxFit = useMemo(() => {
    if (!wx) return null
    const outdoorish = ['outdoors'].includes(e.category) || ['park', 'beach', 'preserve', 'trail', 'viewpoint', 'pier', 'dog_park', 'garden'].includes(e.placeType)
    if (!outdoorish) return null
    const noun = e.placeType === 'beach' ? 'beach' : e.placeType === 'trail' || e.placeType === 'preserve' ? 'trail' : 'park'
    const d0 = new Date(anchors.todayTs)
    for (let i = 0; i < 7; i++) {
      const ts = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime()
      const w = wx[dateKey(ts)]
      if (w && (w.emoji === '☀️' || w.emoji === '⛅') && (w.rain == null || w.rain < 40)) {
        const when = ts === anchors.todayTs ? 'today' : ts === anchors.tomorrowTs ? 'tomorrow' : wdLong(ts)
        const hi = w.hi != null ? `, ${w.hi}°` : ''
        return `${w.emoji} Great ${noun} day ${when}${hi}`
      }
    }
    return null
  }, [wx, anchors, e.category, e.placeType])

  // 3.7P-24 (§N screen 7 "Watch out"): HONEST cautions only — never fabricated.
  // A paid gate and a genuinely rainy week (real forecast: no clear day in 7 +
  // today ≥50% rain) are the cautions our data supports; if none apply the
  // section is simply absent (no invented "buggy after rain").
  const cautions = useMemo(() => {
    const out = []
    if (!free) out.push({ icon: '💵', text: e.fee ? 'Paid entry · ' + e.fee : 'Entry isn’t free' })
    if (outdoorish && wx && !wxFit) {
      const w0 = wx[dateKey(anchors.todayTs)]
      if (w0 && w0.rain != null && w0.rain >= 50) out.push({ icon: '🌧', text: 'Rain around this week — check the forecast' })
    }
    return out
  }, [free, e.fee, outdoorish, wx, wxFit, anchors])

  // mini-map: lazy non-interactive Leaflet, destroyed on unmount (DetailPage's
  // exact pattern — the shared lazy loader keeps Leaflet out of the boot chunk)
  const mapElRef = useRef(null)
  useEffect(() => {
    const el = mapElRef.current
    if (e.lat == null || e.lng == null || !el) return
    let cancelled = false
    let m = null
    let t = null
    getLeaflet().then((L) => {
      if (cancelled || !el.isConnected) return
      m = L.map(el, {
        zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
        touchZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false,
      }).setView([e.lat, e.lng], 14)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(m)
      L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2.5, fillColor: '#ff8c42', fillOpacity: 1, interactive: false }).addTo(m)
      t = setTimeout(() => m.invalidateSize(), 280)
    })
    return () => {
      cancelled = true
      clearTimeout(t)
      if (m) m.remove()
    }
  }, [e.lat, e.lng])

  // "More spots like this" — same placeType, nearest by simple coord delta,
  // up to 4 (places only; never crosses into events)
  const similar = useMemo(() => {
    if (!Array.isArray(places)) return []
    const self = e.key
    return places
      .filter((p) => p.key !== self && p.placeType === e.placeType)
      .map((p) => ({ p, d: hasCoords && p.lat != null ? Math.hypot(p.lat - e.lat, p.lng - e.lng) : Infinity }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => x.p)
  }, [places, e, hasCoords])

  // ===== utility row: directions / share-or-copy + toast =====
  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1600)
  }
  const share = async () => {
    const text = [e.name, e.venue, e.hours].filter(Boolean).join(' · ')
    if (navigator.share) {
      try {
        await navigator.share(e.url ? { title: e.name, text: e.name, url: e.url } : { title: e.name, text })
      } catch {
        /* dismissed — not an error */
      }
    } else if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(e.url || text)
        flash('Details copied ✓')
      } catch {
        flash("Couldn't copy")
      }
    } else {
      flash("Sharing isn't available here")
    }
  }

  // ===== Make this my plan — the place→day-plan bridge (S2). A sheet picks a
  // day + daypart; on pick we write the place KEY into that day's slot via the
  // dayplan.js seams (withSlot clears any rest mark). NEVER CLOBBERS: a filled
  // slot is shown taken and is not overwritable. =====
  const [planning, setPlanning] = useState(false)
  const [planDay, setPlanDay] = useState(anchors.todayTs)
  const [plansVersion, setPlansVersion] = useState(0) // bump to re-read filled state after a write
  // Plan Phase 2 (flows-2 p2): select-then-confirm — selPart holds the chosen
  // daypart, then "Add to {day}" commits. A place is 'any' → morning is the default.
  const [selPart, setSelPart] = useState(null)
  const planSheetRef = useRef(null)
  const planCtaRef = useRef(null)
  const days = useMemo(() => planDays(anchors), [anchors])
  const filled = useMemo(() => {
    // read the current entry for the selected day to disable taken slots
    void plansVersion
    const map = loadDayPlans(anchors)
    const entry = dayEntryFor(map[String(planDay)])
    return { ...Object.fromEntries(PARTS.map((p) => [p, entry?.slots[p] || null])), rest: entry?.state === 'rest' }
  }, [planDay, anchors, plansVersion])
  // the effective selected daypart: the user's pick when free, else morning (the
  // 'any' default), else the first free slot
  const sel = selPart && !filled[selPart] ? selPart : !filled.morning ? 'morning' : PARTS.find((p) => !filled[p]) || null
  const closePlanning = () => {
    setPlanning(false)
    setSelPart(null)
    planCtaRef.current?.focus() // WCAG 2.4.3: focus returns to the trigger
  }

  const addToPlan = (part) => {
    const map = loadDayPlans(anchors)
    const entry = dayEntryFor(map[String(planDay)])
    if (entry && entry.slots[part]) return // never clobber a filled slot
    saveDayPlans(withSlot(map, planDay, part, e.key))
    setPlansVersion((v) => v + 1)
    const dlabel = days.find((d) => d.ts === planDay)?.label || ''
    flash(`Added to ${dlabel} ${DAYPART[part].emoji} ✓`)
    closePlanning()
  }
  // 3.7P-34 review: the plan sheet is a focus-managed modal (was role=dialog only —
  // Escape fell through to nav and closed the WHOLE page). Mirrors DetailPage's
  // add-to-day sheet so the shared .loc-plan-* chrome behaves identically.
  useEffect(() => {
    if (!planning) return
    planSheetRef.current?.focus()
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      closePlanning()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [planning])
  const planTrap = (ev) => {
    if (ev.key !== 'Tab') return
    const f = planSheetRef.current?.querySelectorAll('button:not(:disabled)')
    if (!f || !f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={'detail' + (closing ? ' detail-closing' : '') + (vt ? ' detail-vt' : '')}>
      {/* 3.7P-22: shared .detail shell — hero + body scroll inside .detail-scroll
          (PlaceDetail has no bottom CTA, but needs the wrapper since .detail is now
          a flex column with the scroll on the inner element). */}
      <div className="detail-scroll">
      <div
        className={'detail-hero' + (heroArt ? ' imgbox-art' : '')}
        style={
          heroArt
            ? { viewTransitionName: 'evt-hero', '--ch': hueFor(e) }
            : { viewTransitionName: 'evt-hero', background: '#241c15' }
        }
      >
        {!heroArt ? (
          <div className={'detail-hero-img' + (imgOk ? ' on' : '')} style={{ backgroundImage: `url(${e.image})` }} />
        ) : (
          <span className="imgbox-mark" aria-hidden>
            {artEmoji(e)}
          </span>
        )}
        <button className="detail-back" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {/* Stage R: back / share / heart trio over a CLEAN hero photo — the title
            + meta now live BELOW the hero on light (benchmark spot detail). */}
        <button className="detail-share" onClick={share} aria-label="Share">
          <Icon.share />
        </button>
        <SaveHeart e={e} big />
        <div className="detail-hero-grad" />
        {/* 3.7P-2: the CC-BY/BY-SA attribution duty — a real photo of a place
            carries its captured credit (author · license), linked to the Commons
            file + the license deed. Shown only for real photos (art floor needs
            no credit). The honest twin of "no image without a captured credit". */}
        {!heroArt && e.imageCredit && (
          <div className="hero-credit">
            <a href={e.imageCredit.url} target="_blank" rel="noreferrer">
              {/* author byline; when a license needs no byline (author null) fall
                  back to the HOST keyed off the credit source — never hardcode
                  "Wikimedia Commons" (a Mapillary photo would be mis-credited). */}
              Photo: {e.imageCredit.author
                || (e.imageCredit.sourceFamily === 'mapillary-sign' ? 'Mapillary' : 'Wikimedia Commons')}
            </a>
            {' · '}
            {e.imageCredit.licenseUrl ? (
              <a href={e.imageCredit.licenseUrl} target="_blank" rel="noreferrer">{e.imageCredit.license}</a>
            ) : (
              e.imageCredit.license
            )}
          </div>
        )}
      </div>

      <div className="detail-body">
        {/* Stage R (§N spot detail): name + field-guide meta (small line-icons) +
            top-amenity tag chips, all BELOW the clean hero on light. The primary
            action ("Make this my plan") moved to the bottom action bar. */}
        <h1 className="loc-fg-title">{e.name}</h1>
        <div className="loc-fg-meta">
          {distLine && <span className="loc-fg-mi"><Icon.compass />{distLine}</span>}
          {(free || feeLine) && <span className="loc-fg-mi"><Icon.tag />{free ? 'Free' : feeLine}</span>}
          <span className="loc-fg-mi"><Icon.locations />{placeTypeLabel}</span>
        </div>
        {tagChips.length > 0 && (
          <div className="loc-tag-chips">
            {tagChips.map((c, i) => {
              const Glyph = Icon[c.icon]
              return (
                <span className="loc-tag-chip" key={i}>
                  {Glyph && <Glyph className="loc-tag-ic" aria-hidden />}
                  {c.label}
                </span>
              )
            })}
          </div>
        )}

        <div className="detail-rows">
          {e.venue && (
            <a className="d-row" href={mapsUrl} target="_blank" rel="noreferrer">
              <span className="d-ic" aria-hidden><Icon.locations /></span>
              <div>
                <div className="d-k">Where</div>
                <div className="d-v">{e.venue}<span className="d-ext">↗</span></div>
              </div>
            </a>
          )}
          {e.hours && (
            <div className="d-row"><span className="d-ic" aria-hidden><Icon.clock /></span><div><div className="d-k">Hours</div><div className="d-v">{e.hours}</div></div></div>
          )}
          {feeLine && (
            <div className="d-row"><span className="d-ic" aria-hidden><Icon.tag /></span><div><div className="d-k">Entry</div><div className="d-v">{feeLine}</div></div></div>
          )}
          {wxFit && (
            <div className="d-row"><span className="d-ic">{wxFit.slice(0, 2)}</span><div><div className="d-k">Weather</div><div className="d-v">{wxFit.slice(2).trim()}</div></div></div>
          )}
        </div>

        {e.amenities.length > 0 && (
          <div className="loc-amen">
            <div className="d-k">What's here</div>
            <div className="loc-amen-chips">
              {e.amenities.map((a) => {
                const [ic, label] = amenityChip(a)
                return (
                  <span className="loc-amen-chip" key={a}>
                    <span aria-hidden>{ic}</span> {label}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* 3.7P-24 (§N screen 7) "Best for" — the activity intents this place truly
            satisfies (the same pure ACTIVITIES predicates the Spots tab browses by). */}
        {bestFor.length > 0 && (
          <div className="loc-bestfor">
            <div className="d-k">Best for</div>
            <div className="loc-bestfor-row">
              {bestFor.map((a) => (
                <span className="loc-bestfor-item" key={a.id}>
                  <span className="loc-bestfor-ic" aria-hidden>{a.emoji}</span>
                  <span className="loc-bestfor-label">{a.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 3.7P-24 (§N screen 7) "Watch out" — honest cautions only (paid gate /
            rainy week from the real forecast); absent when nothing true applies. */}
        {cautions.length > 0 && (
          <div className="loc-watch">
            <div className="d-k">Watch out</div>
            {cautions.map((c, i) => (
              <div className="loc-watch-item" key={i}>
                <span aria-hidden>{c.icon}</span> {c.text}
              </div>
            ))}
          </div>
        )}

        {hasCoords && (
          <div className="mini-map">
            <div className="mini-map-canvas" ref={mapElRef} />
            <button className="mini-map-tap" onClick={() => onFocusMap(e)} aria-label="Open in the Map tab">
              <span className="mini-map-hint">Open in Map ↗</span>
            </button>
          </div>
        )}

        {e.description && (
          <div className="detail-about">
            <div className="d-k">About</div>
            <p className="detail-desc">{e.description}</p>
          </div>
        )}

        <div className="util-row">
          {mapsUrl && (
            <a className="util-btn" href={mapsUrl} target="_blank" rel="noreferrer"><Icon.compass />Directions</a>
          )}
          <button className="util-btn" onClick={share}><Icon.share />Share</button>
        </div>

        {similar.length > 0 && (
          <div className="detail-rail">
            <SecHead overline="Around the bay" title="More spots like this" />
            <div className="carousel">
              {similar.map((p) => (
                <TonightCard key={keyOf(p)} e={p} onSelect={(e2) => onSelect(e2, null)} />
              ))}
            </div>
          </div>
        )}

        {/* FB-15: provenance footer disclosed but quiet — collapsed by default,
            one tap to reveal (X3 attribution feeds off this; never withheld) */}
        {e.sources.length > 0 && (
          <details className="detail-via">
            <summary className="detail-via-sum">Sources</summary>
            <div className="detail-via-list">Sourced from {e.sources.join(' · ')}</div>
          </details>
        )}
      </div>
      </div>

      {/* Stage R (§N spot detail): the bottom action bar — Save (outline) + the
          primary "Make this my plan" (gold, dark ink). A flex sibling OUTSIDE
          .detail-scroll (the P22 bottom-bar pattern), so it never overlaps the
          scrolling content. planCtaRef stays on the trigger (focus return). */}
      <div className="detail-actionbar">
        <button
          className={'detail-save-btn' + (saved ? ' on' : '')}
          onClick={() => toggleSave(e)}
          aria-pressed={saved}
        >
          {saved ? '♥ Saved' : '♡ Save'}
        </button>
        <button className="loc-plan-cta detail-actionbar-cta" ref={planCtaRef} onClick={() => setPlanning(true)}>
          ＋ Make this my plan
        </button>
      </div>

      {/* Make-this-my-plan sheet */}
      {planning && (
        <div className="loc-plan-wrap">
          <button className="loc-scrim" onClick={closePlanning} aria-label="Close" />
          <div className="loc-plan-sheet" role="dialog" aria-modal="true" aria-label="Add to a day" tabIndex={-1} ref={planSheetRef} onKeyDown={planTrap}>
            <div className="loc-sheet-head">
              <div className="loc-sheet-title">Add {e.name} to a day</div>
              <button className="loc-sheet-close" onClick={closePlanning} aria-label="Close">✕</button>
            </div>
            <div className="loc-plan-days">
              {days.map((d) => (
                <button
                  key={d.ts}
                  className={'loc-plan-day' + (d.ts === planDay ? ' on' : '')}
                  onClick={() => setPlanDay(d.ts)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {filled.rest ? (
              <div className="loc-note">That's a quiet day 🌙 — clear the rest mark on the day screen to plan it.</div>
            ) : (
              <>
                <div className="loc-plan-choose">Choose a time</div>
                <div className="loc-plan-slots">
                  {PARTS.map((part) => (
                    <button
                      key={part}
                      className={'loc-plan-slot' + (part === sel ? ' on' : '')}
                      disabled={!!filled[part]}
                      onClick={() => setSelPart(part)}
                      aria-pressed={part === sel}
                    >
                      <span className="loc-plan-slot-ic">{DAYPART[part].emoji}</span>
                      <span className="loc-plan-slot-label">{DAYPART[part].label}</span>
                      {filled[part] && <span className="loc-plan-slot-taken">taken</span>}
                    </button>
                  ))}
                </div>
                <button className="loc-plan-add" disabled={!sel} onClick={() => sel && addToPlan(sel)}>
                  Add to {days.find((d) => d.ts === planDay)?.label || 'day'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="detail-toast">{toast}</div>}
    </div>
  )
}
