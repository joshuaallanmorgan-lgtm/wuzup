// HomeView — the Home dashboard tab (Stage R nav restructure, §P.5). Split out
// of the old Events/hot tab: a CLEAN light greeting header (time-of-day + the
// day's real weather), the "Your next days" planning stack, tonight's top picks
// (left-image GemRow cards), and Quick actions (Free/Nature/Markets/Sports bars).
// HOME_GRIND + HOME_PHASE2: bell→notifications, forecast link, GemRow tonight,
// Quick actions grid. DRAFT copy — ⚑ Charles.
import { useEffect, useMemo, useState } from 'react'
import { BUBBLES, CITY, keyOf, tonightModel } from './lib.js'
import NextDays from './NextDays.jsx'
import { useNav } from './nav.jsx'
import { GemRow, IntentTile, SecHead } from './cards.jsx'
import { CONDITION, dateKey } from './weather.js'
import { ACTIVITIES } from './places.js'
import { GUIDES } from './guides.js'

// Module-level lookups (static arrays — safe to resolve once at import time).
const FREE_BUBBLE = BUBBLES.find((b) => b.id === 'free')
const NATURE_ACT = ACTIVITIES.find((a) => a.id === 'act-trails')
const MARKETS_GUIDE = GUIDES.find((g) => g.id === 'markets')
const SPORTS_BARS_GUIDE = GUIDES.find((g) => g.id === 'sports-bars')

export default function HomeView({ events, anchors, wx }) {
  const { openDetail: onSelect, openNotifications, openForecast, openBubble, openPlaceBubble, openGuide } = useNav()

  // re-seed on tab return + every 10 min (tonight-window awareness)
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

  // H-L4: tonight model → top 3 picks for the "Tonight's top picks" section
  const tonight = useMemo(() => tonightModel(upcoming, anchors, new Date(nowMs)), [upcoming, anchors, nowMs])
  const topPicks = useMemo(() => tonight.items.slice(0, 3).map((x) => x.e), [tonight])

  // weather line: city + temp + condition (city always visible; forecast appended on load)
  const todayWx = wx ? wx[dateKey(anchors.todayTs)] : null
  const wxLine = todayWx
    ? `${CITY.name} · ${todayWx.hi != null ? todayWx.hi + '° · ' : ''}${CONDITION[todayWx.emoji] || 'Forecast'}`
    : CITY.name

  return (
    <div className="hot-scroll">
      <header className="home-head">
        {/* H1/H3: the title is the shared .loc-head primitive (32/800), the weather
            line its muted sub — the greeting was retired (no fabricated name). */}
        <h1 className="loc-head-title">Home</h1>
        <div className="loc-head-sub">{wxLine}</div>
        {/* H-L1: bell → notifications (replaces the search disc) */}
        <button className="home-search pressable" onClick={openNotifications} aria-label="Notifications">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
      </header>

      <div className="hot-body">
        <section className="sec">
          <SecHead title="Your next days" />
          <NextDays anchors={anchors} wx={wx} rev={0} />
          {/* H-L2: text link → full forecast page */}
          <button className="home-forecast-link" onClick={openForecast}>
            View full forecast →
          </button>
        </section>

        {/* H-L4: Tonight's top picks — real tonight events as left-image GemRow cards */}
        {topPicks.length > 0 && (
          <section className="sec">
            <SecHead title="Tonight's top picks" />
            <div className="home-picks">
              {topPicks.map((e) => (
                <GemRow key={keyOf(e)} e={e} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* H-L5: Quick actions — 4 intent tiles wired to real bubbles/guides */}
        <section className="sec">
          <SecHead title="Quick actions" />
          <div className="intent-grid">
            {FREE_BUBBLE && (
              <IntentTile emoji="🆓" label="Free tonight" pov="No cover, all fun" hue={145} onClick={() => openBubble(FREE_BUBBLE)} />
            )}
            {NATURE_ACT && (
              <IntentTile emoji="🥾" label="Nature" pov="Outdoor escapes nearby" hue={110} onClick={() => openPlaceBubble(NATURE_ACT)} />
            )}
            {MARKETS_GUIDE && (
              <IntentTile emoji="🛍️" label="Markets" pov="Fresh finds, local makers" hue={45} onClick={() => openGuide(MARKETS_GUIDE)} />
            )}
            {SPORTS_BARS_GUIDE && (
              <IntentTile emoji="📺" label="Sports bars" pov="Catch the game tonight" hue={210} onClick={() => openGuide(SPORTS_BARS_GUIDE)} />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
