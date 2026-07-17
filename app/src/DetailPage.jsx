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
import { usePlanner } from './PlannerProvider.jsx'
import { PLANNER_PARTS as PARTS } from './planner-core.js'
import { addDayTs, calendarDayDistance, cityHour, dayKey, eventLifecycle, formatDayTs, hotDesc, Icon, keyOf, priceLabel, timeOf } from './lib.js'
import { eventIcs } from './share.js'
import { CATEGORY_EMOJI, HeatBadge, SecHead, TonightCard, auroraStyle, hueFor } from './cards.jsx'
import { SaveHeart, useSaves } from './saves.js'
import { whyReasons } from './taste.js'
import { daypartOf, DAYPART, wxMood } from './weekend.js'
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
const fmtShort = (ts) => formatDayTs(ts, { weekday: 'short', month: 'short', day: 'numeric' })

// 3.7P-34 — the days an event can be planned onto: each day of its run that is
// today-or-later, capped at two weeks. A single-day event yields exactly its own
// day (never an arbitrary one — that would misrepresent when it happens); a
// multi-day / ongoing run offers each open day so the user picks which to plan.
function eventPlanDays(e, anchors) {
  if (e._actionable !== true || e._day == null) return []
  const start = Math.max(e._day, anchors.todayTs)
  // an OPEN-ENDED ongoing run (tagged ongoing, no real end date so _endDay === _day)
  // is available through the planning horizon like a place; a dated/multi-day run
  // clamps to its actual end so it can never be planned past when it runs.
  const openEnded = e._ongoing && (e._endDay == null || e._endDay <= e._day)
  const end = openEnded ? Infinity : (e._endDay ?? e._day)
  const out = []
  for (let i = 0; i < 14; i++) {
    const ts = addDayTs(start, i)
    if (ts > end) break
    out.push({ ts, label: ts === anchors.todayTs ? 'Today' : ts === anchors.tomorrowTs ? 'Tomorrow' : formatDayTs(ts, { weekday: 'long' }) })
  }
  return out
}

// The RFC 5545 ICS builder now lives in share.js (vevent + wrapIcs), shared
// with the day-plan multi-VEVENT export (Sprint U-c). eventIcs(e) is the
// one-event calendar — byte-identical to the old inline icsText.

// tags that say *when* or *where it came from*, not what the event feels like —
// excluded from vibe matching ('added-by-you' is provenance, not a vibe)
const GENERIC_TAGS = new Set(['tonight', 'weekend', 'one-off', 'recurring', 'ongoing', 'added-by-you'])

// WS2 detail-rebuild — the refs' "Why this fits" prose card: ONE honest sentence
// composed ONLY from already-ratified TRUE signals — whyReasons(e) (taste.js:
// buzz≥2, free, live tonight/weekend anchors-math, gem, staff-pick, taste lean;
// every chip true by construction) plus the same wxMood forecast cue DayPage
// uses, fed the REAL forecast for the event's own day. 'Sponsored placement' is
// deliberately NOT a fit reason — that disclosure renders unconditionally as the
// .detail-sp label up top. Zero fragments → null → NO card rendered at all
// (honesty: a missing reason is never papered over with a fabricated one).
// Max three fragments, one sentence. ALL COPY DRAFT ⚑ Charles.
function whyProse(e, w) {
  const frags = []
  // weather leads (whyFits' own priority): outdoor event + a genuinely clear day
  if (e.category === 'outdoors' && wxMood(w) === 'clear') frags.push('the forecast looks clear that day')
  for (const r of whyReasons(e)) {
    if (r.startsWith('🔥')) frags.push(`${e.buzz} local sources list it`)
    else if (r === 'Free') frags.push("it's free")
    else if (r === 'Tonight') frags.push("it's on tonight")
    else if (r === 'This weekend') frags.push("it's on this weekend")
    else if (r === '💎 Hidden gem') frags.push("it's a hidden gem")
    else if (r === '⭐ Staff pick') frags.push("it's a staff pick")
    else if (r.startsWith('Your taps lean')) frags.push(r.charAt(0).toLowerCase() + r.slice(1))
    // anything else (incl. 'Sponsored placement') is not a fit reason — skipped
  }
  if (!frags.length) return null
  const top = frags.slice(0, 3)
  const s =
    top.length === 1 ? top[0] : top.length === 2 ? `${top[0]} and ${top[1]}` : `${top[0]}, ${top[1]}, and ${top[2]}`
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

export default function DetailPage({ e, events = [], anchors, wx, onRemoveMine, onRestoreMine }) {
  // navigation via useNav (O6): close/swap/map-handoff + the open-state flags
  const { closing, vtOpen: vt, closeDetail: onClose, openDetail: onSelect, openDay } = useNav()
  const {
    status: plannerStatus,
    add,
    getDay,
    isPlanned,
    placement,
  } = usePlanner()
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const lifecycle = eventLifecycle(e)
  // ===== WHEN: end-date honesty (multi-day ranges, same-day time ranges, ongoing) =====
  // whenShort is the SAME honest WHEN in short form ("Fri, Jun 19 · 7:00 PM") for
  // the title-block eyebrow (WS2 detail-rebuild); `when` (long form) stays
  // byte-identical for the When fact row. One branch block so they can't desync.
  let when, whenShort
  // overnight show (ends ≤6 AM the next day) reads as one evening, not a "range"
  const overnight = !!(
    e._time?.ok &&
    e._time.kind === 'timed' &&
    calendarDayDistance(e._day, e._endDay) === 1 &&
    cityHour(e._time.endAt) <= 6
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

  // WS2 detail-rebuild: the official link's REAL hostname, as the link row's
  // subtitle — derived from e.url, never invented (malformed URL → no subtitle)
  let urlHost = null
  if (e.url) {
    try {
      urlHost = new URL(e.url).hostname.replace(/^www\./, '')
    } catch {
      /* a garbled source URL — the row still works, just without the sub */
    }
  }

  // ===== trust + transparency (G3 → WS2 detail-rebuild): the why-signal now
  // renders as the refs' "Why this fits" prose CARD (whyProse above, composed
  // from the same honest whyReasons seam + the real forecast); the bare
  // why-chips fact row retired. Zero reasons → no card at all. `via` stays the
  // quiet provenance footer. =====
  const via = e.sources && e.sources.length ? e.sources.join(' · ') : e.source

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
  // the Why-this-fits sentence — needs the event-day forecast (w) above
  const whyLine = lifecycle.actionable ? whyProse(e, w) : null

  // ===== detail hero image: preload + 300ms fade over the dark placeholder =====
  const [loadedSrc, setLoadedSrc] = useState(null)
  const [failedSrc, setFailedSrc] = useState(null)
  useEffect(() => {
    if (!e.image) return
    const src = e.image
    const img = new Image()
    img.onload = () => setLoadedSrc(src)
    img.onerror = () => setFailedSrc(src) // dead URL → fall back to category-art
    img.src = src
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [e.image])
  const imgOk = loadedSrc === e.image
  // a real photo that loads → image hero; no image OR a broken URL → art hero.
  // failedSrc is compared against the CURRENT image (same derivation as imgOk):
  // a boolean here latched across More-like-this hops — a dead poster on event
  // A forced the art hero onto every event opened after it in this mounted
  // detail (Stage E ship gate — surfaced chasing the VSPC hotlink-block finds).
  const heroArt = !e.image || failedSrc === e.image
  // WS2 detail-rebuild: the hero time badge — GemRow's exact honesty gate (never
  // on an ongoing run, only a real start time; '' renders nothing).
  const heroTime = !e._ongoing ? timeOf(e.start) : ''

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
    const nearTime = (x) => e._day == null || Math.abs(calendarDayDistance(e._day, x._day)) <= 3
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
    if (!mountedRef.current) return
    setToast(msg)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => {
      if (mountedRef.current) setToast(null)
    }, 1600)
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
  const [planPending, setPlanPending] = useState(false)
  const planned = isPlanned(e)
  const plannedPlacement = placement(e)
  const plannerReady = plannerStatus === 'durable' || plannerStatus === 'session-only'
  const plannerUnavailableLabel = plannerStatus === 'idle' || plannerStatus === 'initializing'
    ? 'Loading plans…'
    : 'Plans unavailable'
  // Plan Phase 2 (flows-2 p2): the add-to-day sheet is select-then-confirm — the
  // user picks a daypart, then taps "Add to {day}". selPart holds the pick; null
  // until they choose (the natural free daypart is the rendered default).
  const [selPart, setSelPart] = useState(null)
  const curDay = planDays.some((day) => day.ts === planDayTs)
    ? planDayTs
    : planDays[0]?.ts ?? null
  const planSheetRef = useRef(null)
  const planBtnRef = useRef(null)
  const planPendingRef = useRef(false)
  const filled = useMemo(() => {
    if (curDay == null) return {}
    const day = getDay(curDay)
    const occupied = new Map(day.slots.map((slot) => [slot.part, slot]))
    return {
      ...Object.fromEntries(PARTS.map((part) => [part, occupied.get(part) || null])),
      rest: day.state === 'rest',
    }
  }, [curDay, getDay])
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
        const restoreFocus = () => planBtnRef.current?.focus()
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreFocus)
        else setTimeout(restoreFocus, 0)
      },
      reduced ? 0 : 240
    )
  }
  const addToPlan = async (part) => {
    if (!plannerReady || curDay == null || planPendingRef.current || planClosing) return
    planPendingRef.current = true
    setPlanPending(true)
    try {
      const result = await add(e, { dayTs: curDay, part })
      const code = result?.conflict?.reducerCode || result?.code
      if (code === 'duplicate' || code === 'already-planned') {
        flash('Already in your plan')
        closePlan()
        return
      }
      if (code === 'slot-occupied') {
        flash('That time is already planned')
        return
      }
      if (code === 'rest-conflict') {
        flash("That's a quiet day — clear the rest mark first")
        return
      }
      if (result?.changed && result.durability === 'session-only') {
        flash("Added for this visit, but your browser couldn't save it")
        closePlan()
        return
      }
      if (!result?.changed || result?.persisted !== true) {
        flash(code === 'planner-rebase-conflict'
          ? 'Your plan changed — check this day and try again'
          : "Couldn't add this to your plan")
        return
      }
      const dl = planDays.find((d) => d.ts === curDay)?.label || ''
      flash(`Added to ${dl} ${DAYPART[part].emoji} ✓`)
      closePlan()
    } catch {
      flash("Couldn't add this to your plan")
    } finally {
      planPendingRef.current = false
      setPlanPending(false)
    }
  }
  const viewPlan = () => {
    if (!plannedPlacement) return
    openDay(plannedPlacement.dayTs)
    onClose()
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

  // ===== Remove (added events only): awaited atomic delete + 6s undo.
  // The open detail keeps showing the removed event so Undo can restore it;
  // closing during/after the window simply commits the removal. =====
  const [undoVis, setUndoVis] = useState(false)
  const [undoReceipt, setUndoReceipt] = useState(null)
  const [undoError, setUndoError] = useState(null)
  const [removedMine, setRemovedMine] = useState(false)
  const [removePending, setRemovePending] = useState(false)
  const removePendingRef = useRef(false)
  const undoTRef = useRef(null)
  useEffect(() => () => clearTimeout(undoTRef.current), [])
  const scheduleUndoExpiry = () => {
    clearTimeout(undoTRef.current)
    undoTRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      setUndoVis(false)
      setUndoReceipt(null)
      setUndoError(null)
    }, 6000)
  }
  const keepUndoAfterFailure = () => {
    if (!mountedRef.current) return
    setUndoError("Couldn't restore that event. Try again.")
    setUndoVis(true)
    scheduleUndoExpiry()
  }
  const removeMine = async () => {
    if (!onRemoveMine || removedMine || removePendingRef.current) return
    removePendingRef.current = true
    setRemovePending(true)
    setUndoError(null)
    try {
      const removed = await onRemoveMine(e)
      if (!mountedRef.current) return
      if (removed?.changed !== true || !removed?.item) {
        flash("Couldn't remove that event")
        return
      }
      setRemovedMine(true)
      setUndoReceipt(removed?.item)
      setUndoVis(true)
      scheduleUndoExpiry()
    } catch {
      if (mountedRef.current) flash("Couldn't remove that event")
    } finally {
      removePendingRef.current = false
      if (mountedRef.current) setRemovePending(false)
    }
  }
  const undoRemove = async () => {
    if (!onRestoreMine || !undoReceipt || removePendingRef.current) return
    clearTimeout(undoTRef.current)
    removePendingRef.current = true
    setRemovePending(true)
    setUndoError(null)
    try {
      const restored = await onRestoreMine(undoReceipt)
      if (!mountedRef.current) return
      if (restored?.changed !== true) {
        keepUndoAfterFailure()
        return
      }
      clearTimeout(undoTRef.current)
      setRemovedMine(false)
      setUndoVis(false)
      setUndoReceipt(null)
      setUndoError(null)
      flash('Restored ✓')
    } catch {
      keepUndoAfterFailure()
    } finally {
      removePendingRef.current = false
      if (mountedRef.current) setRemovePending(false)
    }
  }

  return (
    <div className={'detail' + (closing ? ' detail-closing' : '') + (vt ? ' detail-vt' : '')}>
      {/* 3.7P-22: hero + body scroll inside .detail-scroll; the CTA is a flex
          sibling below it (a real bottom bar — never a fixed overlay drifting
          over content, which broke because .detail is transformed). */}
      <div
        className="detail-scroll"
        inert={planning || planClosing ? true : undefined}
        aria-hidden={planning || planClosing || undefined}
      >
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
        {lifecycle.actionable && <HeatBadge e={e} />}
        {/* WS2 detail-rebuild: the refs' TIME BADGE, bottom-left on the hero —
            solid --cta fill + white text (D.0-R compliant, 4.68:1; the refs'
            light-orange fill fails AA with white). Card .imgbadge geometry,
            scaled one step for the hero. */}
        {heroTime && <span className="imgbadge detail-timebadge">{heroTime}</span>}
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
          {!lifecycle.actionable && (
            <div className={'detail-lifecycle detail-lifecycle-' + lifecycle.code} role="status">
              {lifecycle.label}
            </div>
          )}
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
              lives in the page footer (.detail-via) */}
        </div>
        {/* WS2 detail-rebuild: the refs' "✦ Why this fits" titled prose card —
            replaces the bare why-chips fact row. Rendered ONLY when whyProse
            composed a real reason; no reason → no card (never fabricated).
            Copy DRAFT ⚑ Charles. */}
        {whyLine && (
          <div className="detail-why">
            <div className="detail-why-head">
              <Icon.sparkle className="detail-why-ic" aria-hidden />
              Why this fits
            </div>
            <p className="detail-why-text">{whyLine}</p>
          </div>
        )}
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
        {/* D8: map parked for v1 — the mini-map is removed; the Directions link
            row below already routes to Google Maps. */}
        {/* WS2 detail-rebuild: the refs' LINK-OUT ROWS replace the 4-button utility
            strip. Every row is real data or ABSENT: the official page only with
            e.url (3.7P-34 gating kept — when the event can't be planned, the
            bottom bar owns that link; sub = the link's real hostname), Directions
            only with a maps target (distance appended ONLY when a real _dist was
            computed upstream — never fabricated), and the ICS download rides as
            the "Add to calendar" row (my call: the row family beats a stray lone
            button). Share stays in the hero chrome (R-HD2). Copy DRAFT ⚑ Charles. */}
        {((lifecycle.actionable && e.url) || mapsUrl || (lifecycle.actionable && e.start)) && (
          <div className="detail-links">
            {lifecycle.actionable && e.url && (
              <a className="dlink" href={e.url} target="_blank" rel="noreferrer">
                <span className="dlink-ic" aria-hidden><Icon.tag /></span>
                <span className="dlink-main">
                  <span className="dlink-label">{e.isFree === true || !(e.price > 0) ? 'Official event page' : 'Tickets & event page'}</span>
                  {urlHost && <span className="dlink-sub">{urlHost}</span>}
                </span>
                <span className="dlink-go" aria-hidden>↗</span>
              </a>
            )}
            {mapsUrl && (
              <a className="dlink" href={mapsUrl} target="_blank" rel="noreferrer">
                <span className="dlink-ic" aria-hidden><Icon.compass /></span>
                <span className="dlink-main">
                  <span className="dlink-label num">Directions{e._dist != null ? ` · ${e._dist.toFixed(1)} mi` : ''}</span>
                </span>
                <span className="dlink-go" aria-hidden>›</span>
              </a>
            )}
            {lifecycle.actionable && e.start && (
              <button className="dlink" onClick={downloadIcs}>
                <span className="dlink-ic" aria-hidden><Icon.calendar /></span>
                <span className="dlink-main">
                  <span className="dlink-label">Add to calendar</span>
                </span>
                <span className="dlink-go" aria-hidden>›</span>
              </button>
            )}
          </div>
        )}
        {e.description && (
          <div className="detail-about">
            <div className="d-k">About</div>
            <p className="detail-desc">{e.description}</p>
          </div>
        )}
        {mine && onRemoveMine && (
          <button className="d-remove" onClick={removeMine} disabled={removedMine || removePending}>
            {removedMine ? 'Removed from my feed' : removePending ? 'Removing…' : 'Remove from my feed'}
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
      {toast && <div className="detail-toast" role="status" aria-live="polite">{toast}</div>}
      {undoVis && (
        <div
          className="detail-toast undo-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          inert={planning || planClosing ? true : undefined}
          aria-hidden={planning || planClosing || undefined}
        >
          <span>{undoError || 'Removed from your feed'}</span>
          <button className="undo-btn" onClick={undoRemove} disabled={removePending}>
            {removePending ? 'Restoring…' : 'Undo'}
          </button>
        </div>
      )}

      {/* 3.7P-34: Add-to-day sheet — locked to the event's own day(s). Reuses the
          shared .loc-plan-* sheet (PlaceDetail's bridge); a single-day event shows
          its day as a label, a multi-day/ongoing run shows a day picker. */}
      {planning && (
        <div className={'loc-plan-wrap' + (planClosing ? ' closing' : '')}>
          <button className="loc-scrim" onClick={closePlan} aria-label="Close" />
          <div
            className="loc-plan-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Add to a day"
            aria-busy={planPending || undefined}
            tabIndex={-1}
            ref={planSheetRef}
            onKeyDown={planTrap}
          >
            <div className="loc-sheet-head">
              <div className="loc-sheet-title">Add to your day</div>
              <button className="loc-sheet-close" onClick={closePlan} aria-label="Close">✕</button>
            </div>
            {planDays.length > 1 ? (
              <div className="loc-plan-days">
                {planDays.map((d) => (
                  <button
                    key={d.ts}
                    className={'loc-plan-day' + (d.ts === curDay ? ' on' : '')}
                    disabled={planPending}
                    aria-pressed={d.ts === curDay}
                    onClick={() => setPlanDayTs(d.ts)}
                  >
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
                      disabled={planPending || !!filled[part]}
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
                <button
                  className="loc-plan-add"
                  disabled={!sel || planPending || planClosing}
                  aria-busy={planPending || undefined}
                  onClick={() => sel && addToPlan(sel)}
                >
                  {planPending ? 'Adding…' : `Add to ${planDays.find((d) => d.ts === curDay)?.label || 'day'}`}
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
      <div
        className="detail-actionbar"
        inert={planning || planClosing ? true : undefined}
        aria-hidden={planning || planClosing || undefined}
      >
        <button
          className={'detail-save-btn' + (saved ? ' on' : '')}
          onClick={() => toggleSave(e)}
          aria-pressed={saved}
        >
          {saved ? '♥ Saved' : '♡ Save'}
        </button>
        {planned && plannedPlacement ? (
          <button className="loc-plan-cta detail-actionbar-cta" ref={planBtnRef} onClick={viewPlan}>
            View plan
          </button>
        ) : planned ? (
          <button className="loc-plan-cta detail-actionbar-cta" ref={planBtnRef} disabled>In your plan</button>
        ) : canPlan && plannerReady ? (
          <button className="loc-plan-cta detail-actionbar-cta" ref={planBtnRef} onClick={() => setPlanning(true)}>
            ＋ {addLabel}
          </button>
        ) : canPlan ? (
          <button className="loc-plan-cta detail-actionbar-cta" ref={planBtnRef} disabled>
            {plannerUnavailableLabel}
          </button>
        ) : lifecycle.actionable && e.url ? (
            <a className="loc-plan-cta detail-actionbar-cta" ref={planBtnRef} href={e.url} target="_blank" rel="noreferrer">
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
        ) : !lifecycle.actionable ? (
          <button className="loc-plan-cta detail-actionbar-cta" ref={planBtnRef} disabled>{lifecycle.label}</button>
        ) : null}
      </div>
    </div>
  )
}
