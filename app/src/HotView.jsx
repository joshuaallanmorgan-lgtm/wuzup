// HotView — the Hot tab magazine: hero (+ 🔎 search), bubble strip (each bubble
// opens a full BubblePage), alternating sections, Everything feed. Navigation
// (detail/bubble/search/add/weekend openers) comes from useNav() — O6.
// EVENTS_GRIND: Tonight carousel → vertical GemRow "Tonight's best bets" +
// new "This weekend" section (day-grouped GemRow); both gain honest _why lines.
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { BUBBLES, CAT_BUBBLES, CITY, Icon, LENS_BUBBLES, dayLabel, fmtLocale, hotDesc, keyOf, orderDay, tonightModel } from './lib.js'
import LensNav from './LensNav.jsx'
import TasteTuner from './TasteTuner.jsx'
import { curateFeed, collapseSeries } from './curate.js'
import { useNav, viewIndex } from './nav.jsx'
import { GemRow, IntentTile, NbhdCard, ResultCard, RowFeed, SecHead, SkeletonRow, TonightCard, WxContext } from './cards.jsx'
import { GUIDES, useGuides, watchGuideActive, resolveWatchGuide } from './guides.js'
import { shelfItems, useSaves } from './saves.js'
import { railReady, tasteNudge, topCategories, useTaste } from './taste.js'
import { useRecents } from './recents.js'
import { DeckThisButton } from './LensDeck.jsx'
import SearchBarButton from './SearchBarButton.jsx'
import { whyFits } from './weekend.js'
import { dateKey } from './weather.js'

const DAY_MS = 86400000

// derive a neighborhood/city from a US address ("…, City, ZIP") — the last
// non-ZIP, non-state, non-street segment. null when not confidently parseable
// (honesty: Neighborhood Picks only labels an area it can actually read).
const cityOf = (addr) => {
  if (typeof addr !== 'string' || !addr) return null
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (/^\d/.test(p)) continue // ZIP, or a street segment leading with a number
    if (/^[A-Z]{2}$/.test(p)) continue // bare state abbreviation
    if (/^[A-Z]{2}\s+\d/.test(p)) continue // "FL 33712"
    if (/\d/.test(p) && /\b(ave|st|rd|blvd|dr|ln|way|pkwy|ct|hwy|ste|suite|unit|bldg|building|floor|#)\b/i.test(p)) continue // street/unit
    return p
  }
  return null
}

export default function HotView({ events, anchors, loading }) {
  const { openDetail: onSelect, openBubble: onOpenBubble, openSearch: onOpenSearch, openAdd: onOpenAdd, openGuide, openEvFilters, openDeck, goTo } = useNav()
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

  // TINDER P3: two REAL hot upcoming events for the Tune-your-taste preview cards
  // (the tags illustrate the swipe control — they assert no verdict on these).
  const tuneSamples = useMemo(() => [...upcoming].sort(hotDesc).slice(0, 2), [upcoming])

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
    return tonight.items.slice(0, 3).map(({ e }) => ({
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
        evs: evs.slice(0, 3).map((e) => ({ ...e, _why: whyFits(e, { w: wxDay, nudge }) })),
      })
    }
    return out
  }, [upcoming, anchors, wx, taste])

  // ===== EVENTS_GRIND new sections — all real-data + honestly gated =====
  // "Worth planning around": the hottest FUTURE events (beyond today) to plan ahead for.
  const worthPlanning = useMemo(() => {
    const nudge = (ev) => tasteNudge(ev, taste)
    return upcoming
      .filter((e) => e._day != null && e._day > anchors.todayTs)
      .sort(hotDesc)
      .slice(0, 3)
      .map((e) => ({ ...e, _why: whyFits(e, { w: wx ? wx[dateKey(e._day)] : null, nudge }) }))
  }, [upcoming, anchors, wx, taste])
  // "Free & Easy": free upcoming events (the section gates off when there are none).
  const freeEasy = useMemo(
    () => upcoming.filter((e) => e._free === true || e.isFree === true).sort(hotDesc).slice(0, 3),
    [upcoming]
  )
  // "Recurring Series": collapsed series carrying ≥1 more date (genuinely recurring),
  // most-recurring first — the honest "+N more dates" stamp rides each card.
  const recurring = useMemo(
    () =>
      collapseSeries(upcoming)
        .filter((g) => (g._moreDates || 0) > 0)
        .sort((a, b) => (b._moreDates || 0) - (a._moreDates || 0) || hotDesc(a, b))
        .slice(0, 3),
    [upcoming]
  )
  // "Neighborhood Picks": the best upcoming pick per DISTINCT area (parsed city),
  // a 2-up spread across the bay. Only areas we can actually read from the address.
  const neighborhoods = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const e of [...upcoming].sort(hotDesc)) {
      const area = cityOf(e.address)
      if (!area) continue
      const key = area.toLowerCase().replace(/[^a-z]/g, '') // "St. Petersburg" === "St Petersburg"
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...e, _area: area })
      if (out.length >= 3) break
    }
    return out
  }, [upcoming])

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
        onFilter={openEvFilters}
      />

      <div className="hot-body">
        {/* PREMIUM A4 (motion#8): skeleton rows while the first feed loads. */}
        {loading && upcoming.length === 0 && (
          <div className="home-picks">
            {[0, 1, 2].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* TINDER P3: "Tune your taste" — a light doorway into the events swipe
            deck, between the chips and the first section (tinder.png). */}
        <TasteTuner kind="events" samples={tuneSamples} onTune={openDeck} />

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

        {/* EVENTS_GRIND: "Worth planning around" — the hottest future events. */}
        {worthPlanning.length >= 2 && (
          <section className="sec">
            <SecHead title="Worth planning around" sub="Big nights worth a spot on the calendar." onSeeAll={() => scrollToList(evRef.current)} />
            <div className="home-picks">
              {worthPlanning.map((e) => (
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
                  {/* WS3 §9: the engineered save-heart (--hot IS the save-heart
                      family per the token ledger), not the raw ❤️ */}
                  Your list <Icon.heartFill className="shelf-heart" aria-hidden />
                  <span className="shelf-count">{shelf.length}</span>
                </>
              }
              sub="Your saves, ready when you are."
            />
            <div className="carousel carousel-stagger">
              {shelf.map(({ e, past }) => (
                <div key={keyOf(e)} className={'shelf-item' + (past ? ' shelf-past' : '')}>
                  {past && <span className="shelf-happened">Happened</span>}
                  <TonightCard e={e} onSelect={onSelect} withDate />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* V1 S1: the dedicated "Hidden Gems" magazine shelf was retired (Josh). The
            gems are NOT hidden — they still surface in Everything + via the gem tag in
            the finder/taste/curate readers; only the standalone shelf is gone. */}

        {/* EVENTS_GRIND: "Free & Easy" — free upcoming events (gated on existence). */}
        {freeEasy.length >= 2 && (
          <section className="sec">
            <SecHead title="Free & Easy" sub="Great out, nothing spent." onSeeAll={() => seeAll('free')} />
            <div className="home-picks">
              {freeEasy.map((e) => (
                <GemRow key={keyOf(e)} e={e} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* EVENTS_GRIND: "Recurring Series" — genuinely recurring events (+N more dates). */}
        {recurring.length >= 2 && (
          <section className="sec">
            <SecHead title="Recurring Series" sub="Reliable weeklies you can count on." onSeeAll={() => scrollToList(evRef.current)} />
            <div className="home-picks">
              {recurring.map((e) => (
                <GemRow key={keyOf(e)} e={e} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {/* EVENTS_GRIND: "Neighborhood Picks" — a 2-up spread across distinct areas. */}
        {neighborhoods.length >= 2 && (
          <section className="sec">
            <SecHead title="Neighborhood Picks" sub="A spread across the bay." onSeeAll={() => scrollToList(evRef.current)} />
            <div className="nbhd-grid">
              {neighborhoods.map((e) => (
                <NbhdCard key={keyOf(e)} e={e} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {rail && (
          <section className="sec">
            <SecHead overline="For you" title="Your kind of night" sub="Tuned to what you've tapped." />
            <div className="carousel carousel-stagger">
              {rail.map((e, i) => (
                <TonightCard key={keyOf(e) + i} e={e} onSelect={onSelect} withDate />
              ))}
            </div>
          </section>
        )}

        {recents.length > 0 && (
          <section className="sec">
            <SecHead overline="Pick up where you left off" title="Recently viewed" />
            <div className="home-picks">
              {recents.map((e, i) => (
                <ResultCard key={keyOf(e) + i} e={e} onSelect={onSelect} />
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
                    More upcoming around {CITY.name}{' '}
                    <span className="sec-count">
                      · {(seeAllEv ? feed.fullCount : feed.curatedCount).toLocaleString(fmtLocale)}
                    </span>
                  </>
                }
                sub={seeAllEv ? 'Every event, recurring series grouped' : 'The picks — quality first'}
              />
            </div>
            {/* T1 (Batch 5): the swipe deck is the primary find-AND-tune door. Its
                CUMULATIVE re-deal walk (deckdeal.js: each "Deal again" excludes everything
                already served and walks FORWARD through the catalog, covering the whole
                pool before wrapping) is what makes "Swipe all N" literally true — not a
                shallow top-N carousel. Copy DRAFT ⚑ Charles. */}
            <button
              type="button"
              className="ev-seeall pressable"
              onClick={() => openDeck({ kind: 'events', origin: 'events' })}
            >
              Swipe all {feed.fullEventCount.toLocaleString(fmtLocale)} events →
            </button>
            {/* BINDING NEVER-HIDE PATH — do NOT remove or gate this (ROADMAP §1.1, Josh's
                call). The in-feed expand is the no-swipe / reduced-motion guarantee: it
                reaches the SAME complete set (seeAllEv → feed.full) unconditionally. */}
            <button
              type="button"
              className="ev-seeall-list pressable"
              onClick={() => setSeeAllEv((v) => !v)}
              aria-expanded={seeAllEv}
            >
              {seeAllEv ? '← Show the picks' : 'Or browse the full list here ↓'}
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
          <div className="empty">
            Nothing here right now — check back soon.
            {/* B1: places are always here — a premium hop to Spots (DRAFT copy ⚑ Charles) */}
            <button className="empty-cta" onClick={() => goTo(viewIndex('locations'))}>Browse spots</button>
          </div>
        )}
      </div>
    </div>
  )
}
