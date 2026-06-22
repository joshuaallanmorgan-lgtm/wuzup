// HotView — the Hot tab magazine: hero (+ 🔎 search), bubble strip (each bubble
// opens a full BubblePage), alternating sections, Everything feed. Navigation
// (detail/bubble/search/add/weekend openers) comes from useNav() — O6.
// EVENTS_GRIND: Tonight carousel → vertical GemRow "Tonight's best bets" +
// new "This weekend" section (day-grouped GemRow); both gain honest _why lines.
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { BUBBLES, CAT_BUBBLES, LENS_BUBBLES, NON_GEM_RE, dayLabel, hotDesc, keyOf, orderDay, tonightModel } from './lib.js'
import LensNav from './LensNav.jsx'
import { curateFeed } from './curate.js'
import { useNav } from './nav.jsx'
import { CompactRow, GemRow, IntentTile, RowFeed, SecHead, TonightCard, WxContext } from './cards.jsx'
import { GUIDES, useGuides, watchGuideActive, resolveWatchGuide } from './guides.js'
import { shelfItems, useSaves } from './saves.js'
import { railReady, tasteNudge, topCategories, useTaste } from './taste.js'
import { useRecents } from './recents.js'
import { DeckThisButton } from './LensDeck.jsx'
import SearchBarButton from './SearchBarButton.jsx'
import { whyFits } from './weekend.js'
import { dateKey } from './weather.js'

const DAY_MS = 86400000

export default function HotView({ events, anchors, loading }) {
  const { openDetail: onSelect, openBubble: onOpenBubble, openSearch: onOpenSearch, openAdd: onOpenAdd, openMap: onOpenMap, openGuide, openEvFilters } = useNav()
  const wx = useContext(WxContext) // access weather without prop threading
  const scrollRef = useRef(null)
  const evRef = useRef(null)
  const [entered, setEntered] = useState(false)

  const animate = events.length > 0 && !entered
  useEffect(() => {
    if (!events.length || entered) return
    const t = setTimeout(() => setEntered(true), 1000)
    return () => clearTimeout(t)
  }, [events.length, entered])
  const ent = (i) => (animate ? { className: ' enter', style: { animationDelay: i * 50 + 'ms' } } : { className: '', style: undefined })

  const upcoming = useMemo(() => {
    return events
      .filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
      .map((e) => ({ ...e, _clamp: e._day < anchors.todayTs ? anchors.todayTs : e._day }))
      .sort((x, y) => x._clamp - y._clamp || x._t - y._t)
  }, [events, anchors])

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

  const tonight = useMemo(() => tonightModel(upcoming, anchors, new Date(nowMs)), [upcoming, anchors, nowMs])

  const { watchGuides } = useGuides()
  const activeWatch = useMemo(
    () => (watchGuides || []).filter((g) => watchGuideActive(g, anchors.todayTs) && resolveWatchGuide(g, upcoming).length > 0),
    [watchGuides, upcoming, anchors]
  )

  const gems = useMemo(
    () => upcoming.filter((e) => e.tags.includes('hidden-gem') && !NON_GEM_RE.test(e.title || '')).sort(hotDesc),
    [upcoming]
  )

  const { list: savedList } = useSaves()
  const shelf = useMemo(() => shelfItems(savedList, events, anchors), [savedList, events, anchors])
  const shelfOn = shelf.length > 0

  const taste = useTaste()
  const rail = useMemo(() => {
    if (!railReady(taste)) return null
    const top = topCategories(taste, 2)
    if (!top.length) return null
    const set = new Set(top)
    const picks = upcoming
      .filter((e) => set.has(e.category))
      .map((e) => ({ e, s: (e.hotScore ?? 30) + tasteNudge(e, taste) }))
      .sort((a, b) => b.s - a.s || a.e._t - b.e._t)
      .slice(0, 6)
      .map((x) => x.e)
    return picks.length >= 3 ? picks : null
  }, [upcoming, taste])

  const { keys: recentKeys, session } = useRecents()
  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of upcoming) m.set(keyOf(e), e)
    return m
  }, [upcoming])
  const recents = useMemo(() => {
    const out = recentKeys.map((k) => byKey.get(k)).filter(Boolean).slice(0, 6)
    return out.length >= 2 ? out : []
  }, [recentKeys, byKey])

  const feed = useMemo(
    () =>
      curateFeed(upcoming, {
        dayOf: (e) => e._clamp,
        labelOf: (ts) => ({ label: dayLabel(ts, anchors), dayTs: ts }),
        order: (items) => orderDay(items, tasteNudge),
      }),
    [upcoming, anchors]
  )
  const [seeAllEv, setSeeAllEv] = useState(false)
  const evSections = seeAllEv ? feed.full : feed.curated

  const recapRows = useMemo(
    () => session.slice(0, 3).map((k) => byKey.get(k)).filter(Boolean),
    [session, byKey]
  )
  const daypart = new Date(nowMs).getHours() >= 17 || new Date(nowMs).getHours() < 5 ? 'tonight' : 'today'
  const recap =
    session.length >= 3 ? (
      <div className="recap">
        <div className="recap-over">Before you go</div>
        <div className="recap-title">
          You eyed {session.length} ideas {daypart}
        </div>
        {recapRows.length > 0 && (
          <div className="recap-rows">
            {recapRows.map((e, i) => (
              <GemRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
            ))}
          </div>
        )}
        <div className="recap-nudge">Save the ones you mean ♥</div>
      </div>
    ) : undefined

  // E-L2: tag tonight items with honest _why reasons (weather + free + taste).
  const todayWx = wx ? wx[dateKey(anchors.todayTs)] : null
  const tonightTagged = useMemo(() => {
    const nudge = (ev) => tasteNudge(ev, taste)
    return tonight.items.slice(0, 6).map(({ e }) => ({
      ...e,
      _why: whyFits(e, { w: todayWx, nudge }),
    }))
  }, [tonight.items, todayWx, taste])

  // E-L1/E-L5: "This weekend" — upcoming Fri + Sat events (not today), day-grouped.
  const weekendDays = useMemo(() => {
    const nudge = (ev) => tasteNudge(ev, taste)
    const out = []
    for (let off = 1; off <= 14 && out.length < 2; off++) {
      const ts = anchors.todayTs + off * DAY_MS
      const dow = new Date(ts).getDay()
      if (dow !== 5 && dow !== 6) continue
      const evs = upcoming.filter((e) => e._day === ts)
      if (evs.length === 0) continue
      const wxDay = wx ? wx[dateKey(ts)] : null
      out.push({
        ts,
        label: dow === 5 ? 'Friday' : 'Saturday',
        evs: evs.slice(0, 6).map((e) => ({ ...e, _why: whyFits(e, { w: wxDay, nudge }) })),
      })
    }
    return out
  }, [upcoming, anchors, wx, taste])

  const scrollToList = (el) => {
    const sc = scrollRef.current
    if (sc && el) sc.scrollTo({ top: Math.max(el.offsetTop - 64, 0), behavior: 'smooth' })
  }
  const seeAll = (bubbleId) => {
    const b = BUBBLES.find((x) => x.id === bubbleId)
    if (b) onOpenBubble(b)
  }

  return (
    <div className="hot-scroll" ref={scrollRef}>
      <header className="loc-head">
        <h1 className="loc-head-title">Events</h1>
        <div className="loc-head-sub">Concerts, comedy, markets, games and more.</div>
        <SearchBarButton placeholder="Search events, venues, vibes…" onClick={onOpenSearch} ariaLabel="Search events" />
      </header>

      <LensNav
        lenses={LENS_BUBBLES}
        categories={CAT_BUBBLES}
        menuLabel="All categories"
        onOpen={onOpenBubble}
        onAdd={onOpenAdd}
        onMap={onOpenMap}
        onFilter={openEvFilters}
      />

      <div className="hot-body">
        {/* E-L1/E-L5: "Tonight's best bets" — vertical left-image GemRow cards,
            first section per the ref (was a horizontal carousel). */}
        {tonightTagged.length > 0 && (
          <section className={'sec' + ent(0).className} style={ent(0).style}>
            <SecHead
              title="Tonight's best bets"
              sub={
                tonight.late
                  ? `${tonight.futureN} still going · ${tonight.tomorrowN} tomorrow`
                  : `${tonight.items.length} on for tonight`
              }
              onSeeAll={() => seeAll('tonight')}
            />
            <div className="home-picks">
              {tonightTagged.map((e) => (
                <GemRow key={keyOf(e)} e={e} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* E-L1/E-L5: "This weekend" — day-grouped vertical GemRow cards. */}
        {weekendDays.length > 0 && (
          <section className="sec">
            <SecHead title="This weekend" onSeeAll={() => seeAll('weekend')} />
            {weekendDays.map(({ ts, label, evs }) => (
              <div key={ts} className="weekend-day">
                <div className="weekend-day-label">{label}</div>
                <div className="home-picks">
                  {evs.map((e) => (
                    <GemRow key={keyOf(e)} e={e} onSelect={onSelect} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Guides intent grid */}
        {(activeWatch.length > 0 || GUIDES.some((g) => g.domain !== 'spots')) && (
          <section className="sec">
            <SecHead overline="Plans by mood" title="Guides" sub="Pick a vibe — we'll line up the night." />
            <div className="intent-grid">
              {[...activeWatch, ...GUIDES.filter((g) => g.domain !== 'spots')].map((g) => (
                <IntentTile key={g.id} emoji={g.emoji} label={g.title} pov={g.pov} hue={g.hue} onClick={() => openGuide(g)} />
              ))}
            </div>
          </section>
        )}

        {shelfOn && (
          <section className="sec shelf-sec">
            <SecHead
              overline="Saved for later"
              title={
                <>
                  Your list ❤️<span className="shelf-count">{shelf.length}</span>
                </>
              }
              sub="Your saves, ready when you are."
            />
            <div className="carousel">
              {shelf.map(({ e, past }) => (
                <div key={keyOf(e)} className={'shelf-item' + (past ? ' shelf-past' : '')}>
                  {past && <span className="shelf-happened">Happened</span>}
                  <TonightCard e={e} onSelect={onSelect} withDate />
                </div>
              ))}
            </div>
          </section>
        )}

        {gems.length > 0 && (
          <section className={'sec' + ent(2).className} style={ent(2).style}>
            <SecHead overline="Under the radar" title="Hidden Gems" sub={`${gems.length} hand-scored find${gems.length === 1 ? '' : 's'}`} />
            <div className="feed feed--compact">
              {gems.slice(0, 3).map((e, i) => (
                <CompactRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
              ))}
            </div>
            <button className="gems-more" onClick={() => scrollToList(evRef.current)}>
              Browse everything →
            </button>
          </section>
        )}

        {rail && (
          <section className="sec">
            <SecHead overline="For you" title="Your kind of night" sub="Tuned to what you've tapped." />
            <div className="carousel">
              {rail.map((e, i) => (
                <TonightCard key={keyOf(e) + i} e={e} onSelect={onSelect} withDate />
              ))}
            </div>
          </section>
        )}

        {recents.length > 0 && (
          <section className="sec">
            <SecHead overline="Pick up where you left off" title="Recently viewed" />
            <div className="feed feed--compact">
              {recents.map((e, i) => (
                <CompactRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {upcoming.length > 0 && (
          <section className="sec sec-ev" ref={evRef}>
            <div className={ent(4).className.trim()} style={ent(4).style}>
              <SecHead
                title={
                  <>
                    Everything{' '}
                    <span className="sec-count">
                      · {(seeAllEv ? feed.fullCount : feed.curatedCount).toLocaleString('en-US')}
                    </span>
                  </>
                }
                sub={seeAllEv ? 'Every event, recurring series grouped' : 'The picks — quality first'}
              />
            </div>
            <button
              type="button"
              className="ev-seeall pressable"
              onClick={() => setSeeAllEv((v) => !v)}
              aria-expanded={seeAllEv}
            >
              {seeAllEv
                ? '← Show the picks'
                : `See all ${feed.fullEventCount.toLocaleString('en-US')} events →`}
            </button>
            <RowFeed
              sections={evSections}
              scrollRootRef={scrollRef}
              onSelect={onSelect}
              endSlot={recap}
              headerExtra={(s) => (s.dayTs != null ? <DeckThisButton lens={{ kind: 'day', dayTs: s.dayTs }} /> : null)}
            />
          </section>
        )}
        {!loading && upcoming.length === 0 && (
          <div className="empty">Nothing here right now — check back soon.</div>
        )}
      </div>
    </div>
  )
}
