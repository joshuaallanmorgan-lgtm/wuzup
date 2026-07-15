// HomeView — the Home dashboard tab (Stage R nav restructure, §P.5). Split out
// of the old Events/hot tab: a CLEAN light greeting header (time-of-day + the
// day's real weather), the "Your next days" planning stack, tonight's top picks
// (left-image GemRow cards), and Quick actions (Free/Nature/Markets/Sports bars).
// HOME_GRIND + HOME_PHASE2: bell→notifications, forecast link, GemRow tonight,
// Quick actions grid. DRAFT copy — ⚑ Charles.
import { useEffect, useMemo, useState } from 'react'
import { BUBBLES, cityHour, CITY, keyOf, tonightModel } from './lib.js'
import { coverageStats, isSparse } from './coverage.js'
import CoverageCard from './CoverageCard.jsx'
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

export default function HomeView({ events, anchors, wx, dataMeta }) {
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
  const tonight = useMemo(() => tonightModel(upcoming, anchors, nowMs), [upcoming, anchors, nowMs])
  const topPicks = useMemo(() => tonight.items.slice(0, 3).map((x) => x.e), [tonight])

  // weather line: city + temp + condition (city always visible; forecast appended on load)
  const todayWx = wx ? wx[dateKey(anchors.todayTs)] : null
  const wxLine = todayWx
    ? `${CITY.name} · ${todayWx.hi != null ? todayWx.hi + '° · ' : ''}${CONDITION[todayWx.emoji] || 'Forecast'}`
    : CITY.name

  // Cohesion ruling 2026-07-01 #10 (Josh): the refs' warm greeting returns,
  // NAME-FREE (H3's honesty objection was the fabricated "Alex", not warmth
  // itself — real time-of-day, no invented identity). Tracks nowMs, so it
  // rolls over with the tab-return/10-min tick. Copy DRAFT ⚑ Charles.
  const hour = cityHour(nowMs)
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // D-G1 promotion gate (coverage.js): a sparse week-one city promotes the
  // Coverage Card to the top of Home — the honest floor ("here's what we know
  // so far") instead of a thin feed pretending to be rich. A rich city (Tampa:
  // ~1,665 events, 5× the floor) keeps it as the quiet colophon at the bottom.
  // ONE card either way — the promotion moves it, never duplicates it.
  const sparse = useMemo(() => isSparse(coverageStats(events).events), [events])

  return (
    <div className="hot-scroll">
      <header className="home-head">
        {/* H1: the title stays on the shared .loc-head primitive (32/800), the
            weather line its muted sub. */}
        <h1 className="loc-head-title">{greeting}</h1>
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
        {/* D-G1 promoted form (sparse city only): the card leads Home with the
            one extra honest sentence. Tampa's data must never render this. */}
        {sparse && (
          <section className="sec cov-home">
            <CoverageCard events={events} dataMeta={dataMeta} promoted />
          </section>
        )}
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

        {/* D-G1 compact form (the normal, rich-city state): an honest colophon
            under the last section — what we know, from whom, as of when. */}
        {!sparse && (
          <section className="sec cov-home">
            <CoverageCard events={events} dataMeta={dataMeta} />
          </section>
        )}
      </div>
    </div>
  )
}
