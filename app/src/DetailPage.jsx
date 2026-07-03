// DetailPage — full-page event detail (z 2000, above tabbar/subpages).
// Sprint B "the event's home page": honest when/where rows (end dates, address
// fallback, maps link), trust + identity signals (buzz/sources, category chip,
// gem/staff-pick flags, hero heat badge), event-day weather, utility row
// (.ics download / directions / share), and a More-like-this rail (swaps the
// detail via onSelect). The map is parked for v1 (D8): no mini-map — location
// rides the Directions link out to Google Maps.
// View Transitions open/close logic lives in nav.js (O6); base detail layout in
// App.css; Sprint-B styles in detail.css. App keys this component by event, so
// a rail swap remounts and scroll resets.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNav } from './nav.jsx'
import { DAY, dayKey, hotDesc, Icon, keyOf, parseDate, priceLabel, timeOf } from './lib.js'
import { eventIcs } from './share.js'
import { CATEGORY_EMOJI, HeatBadge, SecHead, TonightCard, auroraStyle, hueFor } from './cards.jsx'
import { SaveHeart, useSaves } from './saves.js'
import { whyReasons } from './taste.js'
import { daypartOf, DAYPART } from './weekend.js'
import { loadDayPlans, saveDayPlans, withSlot, dayEntryFor, PARTS } from './dayplan.js'
import { CONDITION, dateKey } from './weather.js'
import './detail.css'
import './locations.css' // 3.7P-34: the shared "Add to day" sheet (.loc-plan-*) lives here

// "7:00 PM" + "10:00 PM" → "7:00–10:00 PM" (collapse a shared meridiem)
function timeRange(start, end) {
  const t1 = timeOf(start)
  const t2 = timeOf(end)
  if (!t1) return t2 || ''
  if (!t2 || t2 === t1) return t1
  // some ICU versions emit a U+202F narrow no-break space before AM/PM (JS \s matches it)
  const m1 = t1.match(/\s(AM|PM)$/)
  const m2 = t2.match(/\s(AM|PM)$/)
  if (m1 && m2 && m1[1] === m2[1]) return t1.slice(0, m1.index) + '–' + t2
  return t1 + '–' + t2
}

// short "Fri, Jun 12" for ranges (long-form dayKey stays on single days)
const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// 3.7P-34 — the days an event can be planned onto: each day of its run that is
// today-or-later, capped at two weeks. A single-day event yields exactly its own
// day (never an arbitrary one — that would misrepresent when it happens); a
// multi-day / ongoing run offers each open day so the user picks which to plan.
function eventPlanDays(e, anchors) {
  if (e._day == null) return []
  const start = Math.max(e._day, anchors.todayTs)
  // an OPEN-ENDED ongoing run (tagged ongoing, no real end date so _endDay === _day)
  // is available through the planning horizon like a place; a dated/multi-day run
  // clamps to its actual end so it can never be planned past when it runs.
  const openEnded = e._ongoing && (e._endDay == null || e._endDay <= e._day)
  const end = openEnded ? Infinity : (e._endDay ?? e._day)
  const d0 = new Date(start)
  const out = []
  for (let i = 0; i < 14; i++) {
    const ts = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i).getTime()
    if (ts > end) break
    out.push({ ts, label: ts === anchors.todayTs ? 'Today' : ts === anchors.tomorrowTs ? 'Tomorrow' : new Date(ts).toLocaleDateString('en-US', { weekday: 'long' }) })
  }
  return out
}

// The RFC 5545 ICS builder now lives in share.js (vevent + wrapIcs), shared
// with the day-plan multi-VEVENT export (Sprint U-c). eventIcs(e) is the
// one-event calendar — byte-identical to the old inline icsText.

// tags that say *when* or *where it came from*, not what the event feels like —
// excluded from vibe matching ('added-by-you' is provenance, not a vibe)
const GENERIC_TAGS = new Set(['tonight', 'weekend', 'one-off', 'recurring', 'ongoing', 'added-by-you'])

export default function DetailPage({ e, events = [], anchors, wx, onRemoveMine, onRestoreMine }) {
  // navigation via useNav (O6): close/swap/map-handoff + the open-state flags
  const { closing, vtOpen: vt, closeDetail: onClose, openDetail: onSelect } = useNav()
  // ===== WHEN: end-date honesty (multi-day ranges, same-day time ranges, ongoing) =====
  // whenShort is the SAME honest WHEN in short form ("Fri, Jun 19 · 7:00 PM") for
  // the title-block eyebrow (WS2 detail-rebuild); `when` (long form) stays
  // byte-identical for the When fact row. One branch block so they can't desync.
  let when, whenShort
  const DAY_MS = 86400000
  // overnight show (ends ≤6 AM the next day) reads as one evening, not a "range"
  const overnight = !!(
    e.end && /T\d/.test(e.end) && e._endDay - e._day === DAY_MS && parseDate(e.end)?.getHours() <= 6
  )
  if (e._ongoing) {
    when = 'Ongoing' + (e._endDay != null && e._endDay !== e._day ? ' · through ' + fmtShort(e._endDay) : '')
    whenShort = when
  } else if (e._day == null) {
    when = 'Date TBD'
    whenShort = when
  } else if (overnight) {
    when = dayKey(e.start) + ' · ' + timeRange(e.start, e.end)
    whenShort = fmtShort(e._day) + ' · ' + timeRange(e.start, e.end)
  } else if (e._endDay != null && e._endDay !== e._day) {
    when = fmtShort(e._day) + ' – ' + fmtShort(e._endDay)
    whenShort = when
  } else {
    const sameDayTimedEnd = !!(e.end && /T\d/.test(e.end) && e._endDay === e._day)
    const t = sameDayTimedEnd ? timeRange(e.start, e.end) : timeOf(e.start)
    when = (dayKey(e.start) || fmtShort(e._day)) + (t ? ' · ' + t : '')
    whenShort = fmtShort(e._day) + (t ? ' · ' + t : '')
  }

  // ===== WHERE: venue, address fallback, Google-Maps link =====
  const whereMain = e.venue || e.address || null
  const whereSub = e.venue && e.address ? e.address : null
  const hasCoords = e.lat != null && e.lng != null
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}`
    : whereMain
      ? 'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent([e.venue, e.address].filter(Boolean).join(', '))
      : null

  // ===== trust + transparency (G3): ONE honest block. whyReasons (taste.js)
  // composes only TRUE chips — buzz≥2, free, tonight/this-weekend (live
  // anchors-math, not baked tags), hidden-gem, staff-pick, sponsored
  // disclosure, and "You open a lot of {category}" ONLY when the taste nudge
  // actually boosted this event (>5 pts). The old Buzz/gem/staff rows merge
  // in here rather than duplicating; zero reasons → no why-line at all, just
  // the plain found-via row. =====
  const via = e.sources && e.sources.length ? e.sources.join(' · ') : e.source
  const multiSource = typeof e.buzz === 'number' && e.buzz >= 2
  const why = whyReasons(e)

  // ===== user-added event? (Add Event MVP) — provenance label + Remove =====
  const mine = Array.isArray(e.tags) && e.tags.includes('added-by-you')

  // ===== event-day weather (only within the 16-day forecast window) =====
  const w = wx && e._day != null ? wx[dateKey(e._day)] : null
  const wxLine = w
    ? [
        (CONDITION[w.emoji] || 'Forecast') + ' that day',
        w.hi != null ? `high ${w.hi}°` : null,
        w.rain != null ? `${w.rain}% rain` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

  // ===== detail hero image: preload + 300ms fade over the dark placeholder =====
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
  // a real photo that loads → image hero; no image OR a broken URL → art hero
  const heroArt = !e.image || heroFailed

  // D8: the detail mini-map (lazy Leaflet) is parked for v1 — removed. Coordinates
  // still drive the Directions button (Google Maps), below.

  // ===== More like this: same category first, then nearby-in-time same-vibe; hot first =====
  const similar = useMemo(() => {
    if (!events.length || !anchors) return []
    const self = keyOf(e)
    const seen = new Set([self])
    const upcoming = events.filter(
      (x) => keyOf(x) !== self && x._day != null && (x._endDay ?? x._day) >= anchors.todayTs
    )
    const picks = []
    const take = (list) => {
      for (const x of list) {
        const k = keyOf(x)
        if (seen.has(k)) continue
        seen.add(k)
        picks.push(x)
        if (picks.length >= 4) return true
      }
      return false
    }
    if (e.category && e.category !== 'other') {
      if (take(upcoming.filter((x) => x.category === e.category).sort(hotDesc))) return picks
    }
    const vibes = new Set((e.tags || []).filter((t) => !GENERIC_TAGS.has(t)))
    const nearTime = (x) => e._day == null || Math.abs(x._day - e._day) <= 3 * DAY
    take(
      upcoming
        .filter((x) => nearTime(x) && (vibes.size === 0 || x.tags.some((t) => vibes.has(t))))
        .sort(hotDesc)
    )
    return picks
  }, [events, anchors, e])

  // ===== utility row: .ics download / directions / share-or-copy + toast =====
  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (msg) => {
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1600)
  }

  // ===== 3.7P-34: Add to day — the event→day-plan bridge, the PLANNER-FIRST
  // primary action (mirrors PlaceDetail's "Make this my plan"). A dated event is
  // added to ITS OWN day; a multi-day / ongoing run offers each open day. Never
  // clobbers a filled slot; the natural daypart (by start time) is suggested. =====
  const planDays = useMemo(() => eventPlanDays(e, anchors), [e, anchors])
  const canPlan = planDays.length > 0
  const natural = daypartOf(e) // 'day' | 'night' | 'any'
  // Stage R: the bottom bar pairs Save + the primary (benchmark). An honest
  // day-specific CTA label — the event's first plannable day (the sheet's
  // default) + its natural daypart ("tonight"/"today" when that day is today).
  const { has: hasSave, toggle: toggleSave } = useSaves()
  const saved = hasSave(e)
  const d0 = planDays[0]
  const addLabel = d0
    ? d0.ts === anchors.todayTs
      ? natural === 'night'
        ? 'Add to tonight'
        : 'Add to today'
      : `Add to ${d0.label}${natural === 'night' ? ' night' : ''}`
    : 'Add to day'
  const [planning, setPlanning] = useState(false)
  const [planDayTs, setPlanDayTs] = useState(null)
  const [plansVersion, setPlansVersion] = useState(0)
  // Plan Phase 2 (flows-2 p2): the add-to-day sheet is select-then-confirm — the
  // user picks a daypart, then taps "Add to {day}". selPart holds the pick; null
  // until they choose (the natural free daypart is the rendered default).
  const [selPart, setSelPart] = useState(null)
  const curDay = planDayTs ?? planDays[0]?.ts ?? null
  const planSheetRef = useRef(null)
  const planBtnRef = useRef(null)
  const filled = useMemo(() => {
    void plansVersion
    if (curDay == null) return {}
    const entry = dayEntryFor(loadDayPlans(anchors)[String(curDay)])
    return { ...Object.fromEntries(PARTS.map((p) => [p, entry?.slots[p] || null])), rest: entry?.state === 'rest' }
  }, [curDay, anchors, plansVersion])
  // the effective selected daypart: the user's pick when still free, else the
  // natural daypart, else the first free slot (so "Add to {day}" always targets
  // a real open slot — and stays disabled only when every slot is taken).
  const naturalPart = natural === 'any' ? 'morning' : natural
  const sel = selPart && !filled[selPart] ? selPart : !filled[naturalPart] ? naturalPart : PARTS.find((p) => !filled[p]) || null
  // C5: symmetric close (the tn/wkb .closing mechanism) — play the slide-down
  // (locations.css), then unmount + restore focus; instant under reduced motion.
  const [planClosing, setPlanClosing] = useState(false)
  const planTRef = useRef(null)
  useEffect(() => () => clearTimeout(planTRef.current), [])
  const closePlan = () => {
    setPlanClosing(true)
    clearTimeout(planTRef.current)
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    planTRef.current = setTimeout(
      () => {
        setPlanning(false)
        setPlanClosing(false)
        setSelPart(null)
        planBtnRef.current?.focus() // WCAG 2.4.3: focus returns to the trigger
      },
      reduced ? 0 : 240
    )
  }
  const addToPlan = (part) => {
    if (curDay == null) return
    const map = loadDayPlans(anchors)
    const entry = dayEntryFor(map[String(curDay)])
    if (entry && entry.slots[part]) return // never clobber a filled slot
    saveDayPlans(withSlot(map, curDay, part, keyOf(e)))
    setPlansVersion((v) => v + 1)
    const dl = planDays.find((d) => d.ts === curDay)?.label || ''
    flash(`Added to ${dl} ${DAYPART[part].emoji} ✓`)
    closePlan()
  }
  // dialog a11y (mirrors the map filter sheet): focus in on open, Escape closes,
  // Tab is trapped, focus returns to the trigger on close.
  useEffect(() => {
    if (!planning) return
    planSheetRef.current?.focus()
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      closePlan()
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
  const downloadIcs = () => {
    if (!e.start) return
    const blob = new Blob([eventIcs(e)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const name = (e.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
    a.download = (name || 'event') + '.ics'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const share = async () => {
    // URL-less events (added-by-you etc.) share their facts as TEXT — never
    // window.location.href, which is just this device's app address.
    const url = e.url || null
    const text = [e.title, when, whereMain].filter(Boolean).join(' · ')
    if (navigator.share) {
      try {
        await navigator.share(url ? { title: e.title, text: e.title, url } : { title: e.title, text })
      } catch {
        /* user dismissed the share sheet — not an error */
      }
    } else if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url || text)
        flash(url ? 'Link copied ✓' : 'Details copied ✓')
      } catch {
        flash("Couldn't copy link")
      }
    } else {
      flash("Sharing isn't available here")
    }
  }

  // ===== Remove (added events only): instant delete from my-events + 6s undo.
  // The open detail keeps showing the removed event so Undo can restore it;
  // closing during/after the window simply commits the removal. =====
  const [undoVis, setUndoVis] = useState(false)
  const undoTRef = useRef(null)
  useEffect(() => () => clearTimeout(undoTRef.current), [])
  const removeMine = () => {
    if (!onRemoveMine) return
    onRemoveMine(e)
    setUndoVis(true)
    clearTimeout(undoTRef.current)
    undoTRef.current = setTimeout(() => setUndoVis(false), 6000)
  }
  const undoRemove = () => {
    clearTimeout(undoTRef.current)
    setUndoVis(false)
    if (onRestoreMine) onRestoreMine(e)
    flash('Restored ✓')
  }

  return (
    <div className={'detail' + (closing ? ' detail-closing' : '') + (vt ? ' detail-vt' : '')}>
      {/* 3.7P-22: hero + body scroll inside .detail-scroll; the CTA is a flex
          sibling below it (a real bottom bar — never a fixed overlay drifting
          over content, which broke because .detail is transformed). */}
      <div className="detail-scroll">
      {/* no-image hero shares the I3 .imgbox-art composition (same hue + watermark
          the card showed), so the VT morph lands on matching artwork */}
      <div
        className={'detail-hero' + (heroArt ? ' imgbox-art' : '')}
        style={
          heroArt
            ? { viewTransitionName: 'evt-hero', ...auroraStyle(e) }
            : { viewTransitionName: 'evt-hero', background: '#241c15' }
        }
      >
        {!heroArt ? (
          <div className={'detail-hero-img' + (imgOk ? ' on' : '')} style={{ backgroundImage: `url(${e.image})` }} />
        ) : (
          <span className="imgbox-mark" aria-hidden>
            {CATEGORY_EMOJI[e.category] ?? CATEGORY_EMOJI.other}
          </span>
        )}
        <button className="detail-back" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {/* R-HD2: share lives in the hero header now (reuses the util-row `share`
            handler), so both detail pages cluster the same way — back left ·
            save + share right. The heat badge clears the share disc via detail.css. */}
        <button className="detail-share" onClick={share} aria-label="Share">
          <Icon.share />
        </button>
        {/* ♥ save toggle (saves.js) — heat badge slides left of it via saves.css */}
        <SaveHeart e={e} big />
        <HeatBadge e={e} />
        {/* WS2 detail-rebuild: chrome-only scrim — the title moved below the hero
            (light surface), so the heavy bottom title-wash retired with it */}
        <div className="detail-hero-grad detail-hero-grad-ev" />
      </div>
      <div className="detail-body">
        {e.sponsored === true && <div className="sp-label detail-sp">Sponsored</div>}
        {mine && <div className="sp-label my-label detail-sp">Added by you</div>}
        {/* WS2 detail-rebuild: the PlaceDetail Stage-R light-title pattern, ported —
            eyebrow (the honest short WHEN, accent ink) → title (ink, 800) → venue
            line → identity chips, all BELOW the clean hero. overflow-wrap on the
            title fixes the garbled-source clip (live-capture defect #1, display half). */}
        <div className="detail-head">
          <div className="detail-eyebrow">{whenShort}</div>
          <h1 className="detail-title">{e.title}</h1>
          {whereMain && <div className="detail-venue">{whereMain}</div>}
          {(e.category !== 'other' || priceLabel(e)) && (
            <div className="detail-chips">
              {e.category !== 'other' && (
                <span className="chip detail-catchip" style={{ '--ch': hueFor(e) }}>
                  {CATEGORY_EMOJI[e.category] ?? '⭐'} {e.category}
                </span>
              )}
              {priceLabel(e) && <span className={'chip' + (e.isFree === true ? ' chip-free' : '')}>{priceLabel(e)}</span>}
            </div>
          )}
        </div>
        <div className="detail-rows">
          <div className="d-row"><span className="d-ic" aria-hidden><Icon.calendar /></span><div><div className="d-k">When</div><div className="d-v">{when}</div></div></div>
          {whereMain && (
            <a className="d-row" href={mapsUrl} target="_blank" rel="noreferrer">
              <span className="d-ic" aria-hidden><Icon.locations /></span>
              <div>
                <div className="d-k">Where</div>
                <div className="d-v">{whereMain}<span className="d-ext">↗</span></div>
                {whereSub && <div className="d-sub">{whereSub}</div>}
              </div>
            </a>
          )}
          <div className="d-row"><span className="d-ic" aria-hidden><Icon.tag /></span><div><div className="d-k">Price</div><div className="d-v">{priceLabel(e) || 'See event for pricing'}</div></div></div>
          {wxLine && (
            <div className="d-row"><span className="d-ic">{w.emoji}</span><div><div className="d-k">Weather</div><div className="d-v">{wxLine}</div></div></div>
          )}
          {/* I4: provenance ("Found via …") is internal, not decision info — it
              lives in the page footer now (.detail-via); the why-chips stay */}
          {why.length > 0 && (
            <div className="d-row">
              <span className="d-ic">{multiSource ? '🔥' : '🧭'}</span>
              <div>
                <div className="d-k">Why this is here</div>
                <div className="why-chips">
                  {why.map((r) => (
                    <span className="chip chip-accent why-chip" key={r}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* W3 never-hide: a collapsed recurring card carries every instance in
            _series. THIS is the rendered open path for them — without it the
            non-rep instances (the same program on other days/at other venues)
            would live only in data, openable nowhere. Each row opens that exact
            instance (onSelect with null cardEl = swap in place, no VT morph).
            Per-instance venue is shown, so a cross-venue series reads honestly
            (same title, different places) instead of posing as one location. */}
        {Array.isArray(e._series) && e._series.length > 1 && (
          <div className="detail-dates">
            <div className="d-k">
              All dates &amp; venues <span className="dd-count">{e._series.length}</span>
            </div>
            <div className="dd-list">
              {e._series.map((inst, i) => {
                const cur = keyOf(inst) === keyOf(e)
                const t = timeOf(inst.start)
                return (
                  <button
                    key={keyOf(inst) + '|' + i}
                    type="button"
                    className={'dd-row pressable' + (cur ? ' dd-row-cur' : '')}
                    onClick={() => onSelect(inst, null)}
                  >
                    <span className="dd-when">
                      {inst._day != null ? fmtShort(inst._day) : 'Date TBD'}
                      {t ? ' · ' + t : ''}
                    </span>
                    {inst.venue && <span className="dd-where">{inst.venue}</span>}
                    {cur && <span className="dd-now">Showing</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {/* D8: map parked for v1 — the mini-map is removed; the Directions util
            button below already routes to Google Maps. */}
        {e.description && (
          <div className="detail-about">
            <div className="d-k">About</div>
            <p className="detail-desc">{e.description}</p>
          </div>
        )}
        <div className="util-row">
          {e.start && (
            <button className="util-btn" onClick={downloadIcs}><Icon.calendar />Calendar</button>
          )}
          {mapsUrl && (
            <a className="util-btn" href={mapsUrl} target="_blank" rel="noreferrer"><Icon.compass />Directions</a>
          )}
          <button className="util-btn" onClick={share}><Icon.share />Share</button>
          {/* 3.7P-34: when "Add to day" is the primary CTA, the official event /
              ticket link is demoted here as a secondary action (still one tap). */}
          {canPlan && e.url && (
            <a className="util-btn" href={e.url} target="_blank" rel="noreferrer">
              <Icon.tag />{e.isFree === true || !(e.price > 0) ? 'Event page' : 'Tickets'}
            </a>
          )}
        </div>
        {mine && onRemoveMine && (
          <button className="d-remove" onClick={removeMine} disabled={undoVis}>
            Remove from my feed
          </button>
        )}
        {similar.length > 0 && (
          <div className="detail-rail">
            {/* FB-16: no "Keep the night going" overline — this rail spans the
                whole upcoming window (not just tonight), so the line misled. */}
            <SecHead title="More like this" />
            <div className="carousel">
              {similar.map((x) => (
                /* swap in place: null cardEl skips the VT morph (the detail is already open).
                   withDate: picks span the whole upcoming window — a July event must
                   never read as tonight (the rail carries no "tonight" framing). */
                <TonightCard key={keyOf(x)} e={x} withDate onSelect={(e2) => onSelect(e2, null)} />
              ))}
            </div>
          </div>
        )}
        {/* FB-15: provenance stays FULLY disclosed but quiet — collapsed by
            default, one tap to reveal. Always present (never withheld). */}
        {via && (
          <details className="detail-via">
            <summary className="detail-via-sum">Sources</summary>
            <div className="detail-via-list">Found via {via}</div>
          </details>
        )}
      </div>
      </div>
      {toast && <div className="detail-toast">{toast}</div>}
      {undoVis && (
        <div className="detail-toast undo-toast">
          Removed from your feed
          <button className="undo-btn" onClick={undoRemove}>
            Undo
          </button>
        </div>
      )}

      {/* 3.7P-34: Add-to-day sheet — locked to the event's own day(s). Reuses the
          shared .loc-plan-* sheet (PlaceDetail's bridge); a single-day event shows
          its day as a label, a multi-day/ongoing run shows a day picker. */}
      {planning && (
        <div className={'loc-plan-wrap' + (planClosing ? ' closing' : '')}>
          <button className="loc-scrim" onClick={closePlan} aria-label="Close" />
          <div className="loc-plan-sheet" role="dialog" aria-modal="true" aria-label="Add to a day" tabIndex={-1} ref={planSheetRef} onKeyDown={planTrap}>
            <div className="loc-sheet-head">
              <div className="loc-sheet-title">Add to your day</div>
              <button className="loc-sheet-close" onClick={closePlan} aria-label="Close">✕</button>
            </div>
            {planDays.length > 1 ? (
              <div className="loc-plan-days">
                {planDays.map((d) => (
                  <button key={d.ts} className={'loc-plan-day' + (d.ts === curDay ? ' on' : '')} onClick={() => setPlanDayTs(d.ts)}>
                    {d.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="loc-note">
                {planDays[0]?.label}
                {/* show the time only when the shown day IS the event's start day —
                    a clamped multi-day run's last day must not wear day-1's time */}
                {timeOf(e.start) && curDay === e._day ? ' · ' + timeOf(e.start) : ''}
              </div>
            )}
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
                      {filled[part] ? (
                        <span className="loc-plan-slot-taken">taken</span>
                      ) : (
                        natural === part && <span className="loc-plan-slot-taken">suggested</span>
                      )}
                    </button>
                  ))}
                </div>
                <button className="loc-plan-add" disabled={!sel} onClick={() => sel && addToPlan(sel)}>
                  Add to {planDays.find((d) => d.ts === curDay)?.label || 'day'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stage R (§N event detail): the bottom ACTION BAR — Save (outline, flex:0)
          + the primary (gold, flex:1), side by side (mirrors the spot-detail bar).
          PLANNER-FIRST (3.7P-34): "Add to {day}" leads; the official event/ticket
          link is the fallback primary for a past/undated event (still saveable). */}
      <div className="detail-actionbar">
        <button
          className={'detail-save-btn' + (saved ? ' on' : '')}
          onClick={() => toggleSave(e)}
          aria-pressed={saved}
        >
          {saved ? '♥ Saved' : '♡ Save'}
        </button>
        {canPlan ? (
          <button className="loc-plan-cta detail-actionbar-cta" ref={planBtnRef} onClick={() => setPlanning(true)}>
            ＋ {addLabel}
          </button>
        ) : (
          e.url && (
            <a className="loc-plan-cta detail-actionbar-cta" href={e.url} target="_blank" rel="noreferrer">
              {e.isFree === true || !(e.price > 0) ? (
                <>
                  View event <span className="cta-arr">↗</span>
                </>
              ) : (
                <>
                  Get Tickets <span className="cta-arr">→</span>
                </>
              )}
            </a>
          )
        )}
      </div>
    </div>
  )
}
