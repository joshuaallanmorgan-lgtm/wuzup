// HomeView — the Home dashboard tab (Stage R nav restructure, §P.5). Split out
// of the old Events/hot tab: a CLEAN light greeting header (time-of-day + the
// day's real weather), the "Your next days" planning stack, and the featured
// "Tonight's top picks" DecisionCard with an inline Add-to-day. The browse
// (search + filter chips + the event sections) lives on the Events tab
// (HotView). Matches the benchmark Home screen. DRAFT copy — ⚑ Charles.
import { useEffect, useMemo, useRef, useState } from 'react'
import { keyOf } from './lib.js'
import NextDays from './NextDays.jsx'
import { useNav } from './nav.jsx'
import { FeaturedCard, SecHead } from './cards.jsx'
import { CONDITION, dateKey } from './weather.js'
import { daypartOf } from './weekend.js'
import { loadDayPlans, saveDayPlans, withSlot, dayEntryFor } from './dayplan.js'

// a warm time-of-day greeting — the personal top of Home (the weather line below
// carries the day's real forecast). Pure(now). (No fabricated name: the
// benchmark's ", Alex" is a mock; we have no name store, so we never invent one.)
function heroKicker(now) {
  const h = now.getHours()
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function HomeView({ events, anchors, wx }) {
  // onSelect identity note: openDetail is useCallback-stable in nav.jsx, so the
  // FeaturedCard's tap target keeps its referential-stability contract.
  const { openDetail: onSelect } = useNav()

  // "tonight" startedness tracks the CLOCK, not just the data — re-seed when the
  // tab returns to view + every 10 min while open (same cadence as the old hero).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNowMs(Date.now())
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    const t = setInterval(tick, 10 * 60000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(t)
    }
  }, [])

  const upcoming = useMemo(
    () =>
      events
        .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
        .map((e) => ({ ...e, _clamp: e._day < anchors.todayTs ? anchors.todayTs : e._day }))
        .sort((x, y) => x._clamp - y._clamp || x._t - y._t),
    [events, anchors]
  )
  const hasHot = useMemo(() => upcoming.some((e) => e.hotScore != null), [upcoming])
  // the featured pick: the highest-hotScore one-off (falls back to any hot event)
  const bigOne = useMemo(() => {
    if (!hasHot) return null
    const oneOffs = upcoming.filter((e) => e.tags.includes('one-off') && e.hotScore != null)
    const pool = oneOffs.length ? oneOffs : upcoming.filter((e) => e.hotScore != null)
    return pool.reduce((best, e) => (best == null || e.hotScore > best.hotScore ? e : best), null)
  }, [upcoming, hasHot])

  // the hero weather line — today's real forecast (emoji · condition · high),
  // null until the 16-day fetch resolves so the greeting never shows a guess.
  const todayWx = wx ? wx[dateKey(anchors.todayTs)] : null
  const wxLine = todayWx
    ? `${todayWx.emoji} ${CONDITION[todayWx.emoji] || 'Forecast'}${todayWx.hi != null ? ' · ' + todayWx.hi + '°' : ''}`
    : null

  // inline planner add (the shared withSlot seam): add the event to its OWN day
  // at its natural daypart; never clobbers a filled slot; bumps planRev so the
  // "Your next days" stack re-reads the non-reactive day-plan store on this screen.
  const [toast, setToast] = useState(null)
  const toastTRef = useRef(null)
  const [planRev, setPlanRev] = useState(0)
  useEffect(() => () => clearTimeout(toastTRef.current), [])
  const flash = (m) => {
    setToast(m)
    clearTimeout(toastTRef.current)
    toastTRef.current = setTimeout(() => setToast(null), 1700)
  }
  const addToPlan = (e) => {
    const dayTs = e._day ?? anchors.todayTs
    const part = daypartOf(e) === 'night' ? 'night' : 'day'
    const map = loadDayPlans(anchors)
    const entry = dayEntryFor(map[String(dayTs)])
    if (entry && entry.slots[part]) {
      flash('That slot is taken — open the day to adjust')
      return
    }
    saveDayPlans(withSlot(map, dayTs, part, keyOf(e)))
    setPlanRev((v) => v + 1)
    // the toast names the slot the write ACTUALLY filled (daypart), not _tonight
    flash(part === 'night' ? 'Added to tonight ✓' : 'Added to your day ✓')
  }
  // the featured header names the real slot: "tonight" only for an evening pick
  // today, "today" for a daytime pick, else "worth planning around".
  const featuredTitle =
    bigOne && bigOne._tonight && daypartOf(bigOne) === 'night'
      ? "Tonight's top picks"
      : bigOne && bigOne._tonight
        ? "Today's top picks"
        : 'Worth planning around'

  return (
    <div className="hot-scroll">
      {/* Stage R: a CLEAN light greeting header (no image hero) — matches the
          benchmark Home. */}
      <header className="home-head">
        <h1 className="home-greet">{heroKicker(new Date(nowMs))}</h1>
        {wxLine && <div className="home-wx">{wxLine}</div>}
      </header>

      <div className="hot-body">
        {/* §N screen 1: the headline planning stack — your next three days at a
            glance (real forecast + plan-state + a planner CTA). */}
        <section className="sec">
          <SecHead title="Your next days" />
          <NextDays anchors={anchors} wx={wx} rev={planRev} />
        </section>
        {/* §N screen 1: the featured DecisionCard — image + title + venue + honest
            tag chips + inline [Save] [Add to tonight/day]. */}
        {bigOne && (
          <section className="sec">
            <SecHead overline="Handpicked for you" title={featuredTitle} />
            <FeaturedCard e={bigOne} onSelect={onSelect} onAdd={addToPlan} />
          </section>
        )}
      </div>
      {toast && <div className="detail-toast">{toast}</div>}
    </div>
  )
}
