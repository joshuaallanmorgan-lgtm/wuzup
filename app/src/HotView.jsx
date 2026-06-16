// HotView — the Hot tab magazine: hero (+ 🔎 search), bubble strip (each bubble
// opens a full BubblePage), alternating sections, Everything feed. Navigation
// (detail/bubble/search/add/weekend openers) comes from useNav() — O6.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BUBBLES, CAT_BUBBLES, CITY, LENS_BUBBLES, NON_GEM_RE, dayLabel, hotDesc, keyOf, orderDay, tonightModel } from './lib.js'
import LensNav from './LensNav.jsx'
import NextDays from './NextDays.jsx'
import { curateFeed } from './curate.js'
import { useNav } from './nav.jsx'
import { BigOne, CompactRow, EndCap, GemRow, IntentTile, RowFeed, SecHead, TonightCard } from './cards.jsx'
import { GUIDES, useGuides, watchGuideActive, resolveWatchGuide } from './guides.js'
import { shelfItems, useSaves } from './saves.js'
import { railReady, tasteNudge, topCategories, useTaste } from './taste.js'
import { useRecents } from './recents.js'
import { CONDITION, dateKey } from './weather.js'
import { DeckThisButton } from './LensDeck.jsx'

// 3.7P-23b (§N): a warm time-of-day greeting ("Good morning" / "Good evening")
// replaces the old daypart kicker — the personal top of Home. Pure(now); the
// weather line below carries the day's real forecast.
function heroKicker(now) {
  const h = now.getHours()
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// the emotional lead under the city name — daypart-aware + honest, framed as
// abundance/invitation (never a countdown or guilt; CALENDAR_BRIEF §7 ban-list
// clean — softened from "still time to…" per the 3.72 review). DRAFT — ⚑ Charles.
function heroLine(now, tonightLeft) {
  const h = now.getHours()
  const night = h >= 17 || h < 5
  if (tonightLeft > 0) return night ? 'Lots happening tonight.' : 'Lots happening today.'
  if (h < 5) return 'Tomorrow’s wide open.'
  if (h < 17) return 'A good day to get out.'
  return 'Tomorrow’s wide open.'
}

export default function HotView({ events, anchors, loading, wx }) {
  // onSelect identity note: openDetail is useCallback-stable in nav.js, so the
  // memo'd Rows (M1) keep their referential-stability contract intact.
  const { openDetail: onSelect, openBubble: onOpenBubble, openSearch: onOpenSearch, openAdd: onOpenAdd, openGuide } = useNav()
  const scrollRef = useRef(null)
  const evRef = useRef(null)
  const [entered, setEntered] = useState(false) // entrance animations already played?
  const [heroOk, setHeroOk] = useState(false)

  // hero image: preload + 300ms fade (no pop). onload fires even for cached
  // images because the handler is attached before src is set.
  useEffect(() => {
    const img = new Image()
    img.onload = () => setHeroOk(true)
    img.src = CITY.heroes?.[0]?.url || CITY.hero // preload the SAME image the hero renders
    return () => {
      img.onload = null
    }
  }, [])

  // hero parallax + scrim ramp: one rAF scroll listener writing CSS vars
  useEffect(() => {
    const el = scrollRef.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = el.scrollTop
        el.style.setProperty('--hs', (y * 0.4).toFixed(1) + 'px')
        el.style.setProperty('--scrimo', (0.3 + Math.min(y / 180, 1) * 0.4).toFixed(3))
        ticking = false
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // entrance animations: first data paint only, never again (class drops after the
  // longest entrance — 50ms×5 stagger + 700ms reveal — has finished)
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
  const hasHot = useMemo(() => upcoming.some((e) => e.hotScore != null), [upcoming])
  // Tonight startedness must track the CLOCK, not just the data: anchors only
  // change at midnight/day-rollover, but "7 PM has passed" happens mid-session.
  // Re-seed when the tab returns to view + every 10 min while open.
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
  // { items:[{e,withDate}], late, futureN, tomorrowN } — future first, started
  // sunk (never hidden); late nights fold in tomorrow's early evening (lib.js)
  const tonight = useMemo(() => tonightModel(upcoming, anchors, new Date(nowMs)), [upcoming, anchors, nowMs])
  // 3.75b: timely Watch Guides — only the ones in-window AND with real matches
  // (never advertise an empty one). The guides.json fetch is tiny + lazy.
  const { watchGuides } = useGuides()
  const activeWatch = useMemo(
    () => (watchGuides || []).filter((g) => watchGuideActive(g, anchors.todayTs) && resolveWatchGuide(g, upcoming).length > 0),
    [watchGuides, upcoming, anchors]
  )
  const bigOne = useMemo(() => {
    if (!hasHot) return null // hotScore data absent → skip section gracefully
    const oneOffs = upcoming.filter((e) => e.tags.includes('one-off') && e.hotScore != null)
    const pool = oneOffs.length ? oneOffs : upcoming.filter((e) => e.hotScore != null)
    return pool.reduce((best, e) => (best == null || e.hotScore > best.hotScore ? e : best), null)
  }, [upcoming, hasHot])
  // unsliced — section subs report the real totals; renders slice to 3 / 10.
  // Gems sort by score so the homepage trio is the BEST of the shelf, not
  // whichever three happen soonest.
  // 3.7P-39 (D6 strict label honesty): a job/career fair is not a "hand-scored
  // find" — drop it from the Hidden Gems shelf (it stays in Everything). Guards
  // the current data even before the finder's matching exclusion next re-runs.
  const gems = useMemo(
    () => upcoming.filter((e) => e.tags.includes('hidden-gem') && !NON_GEM_RE.test(e.title || '')).sort(hotDesc),
    [upcoming]
  )
  // 3.7P-10: the "Free this week" carousel was CUT — Free stays reachable via the
  // LensNav "Free" lens + the FREE badge in Everything (never-hide intact), so a
  // dedicated carousel was redundant. (freeWeek derivation removed with it.)
  // ♥ Saved shelf (Sprint C): saved events, live-from-dataset when possible,
  // snapshot otherwise; past saves grey out + drop after 7 days (saves.js).
  // useSaves re-renders this view on any toggle — even one made from the
  // detail page — so the shelf appears/updates live, no remount.
  const { list: savedList } = useSaves()
  const shelf = useMemo(() => shelfItems(savedList, events, anchors), [savedList, events, anchors])
  const shelfOn = shelf.length > 0 // any saved item keeps the shelf — past saves grey out, they don't vanish it
  // "Your kind of night" rail (G4): renders ONLY once the local taste profile
  // has real ORGANIC signal (railReady = 6+ REAL taps, V1b) AND a top category
  // exists — absent silently before that. SEED-ONLY profiles (primer+interview)
  // tilt ordering everywhere but do NOT light this rail: it claims to know your
  // taste, a claim only your own taps can earn (Sprint-P carry-in (b) decision,
  // documented in taste.js railConfidence). Up to 8 upcoming events from the
  // top-2 categories by adjustedScore; items may also appear in other sections
  // (normal magazine behavior). useTaste = live, no remount needed.
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
    return picks.length >= 3 ? picks : null // a 1-card "rail" reads broken, wait for data
  }, [upcoming, taste])
  // H3 "Recently viewed" + H4 session recap — both read the recents store.
  // Rail: persisted keys resolved against the LIVE upcoming set only (vanished
  // or already-ended events silently drop — keys, never snapshots), max 6,
  // shown once ≥2 resolve (a 1-row rail reads broken, same bar as the taste
  // rail). Recap: ≥3 DISTINCT details opened THIS session (in-memory list,
  // resets on reload) upgrades the end-of-Everything message — see `recap`.
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
  // Everything: W3 CURATION (Phase 3.5). curateFeed runs TWO count-preserving
  // passes over the date-asc `upcoming` list: (1) GLOBAL collapse of recurring
  // series — "Baby Time" on 88 days becomes ONE card stamped "+87 more dates"
  // (the library de-spam, ≈half the feed); (2) a front-page quality filter
  // (frontPagePredicate) over the collapsed groups. Both come back day-grouped
  // and diversity-ordered (orderDay — no >2-run of one family/category;
  // count-preserving). `curated` is the DEFAULT feed; `full` is the unfiltered,
  // still-collapsed See-all destination. NEVER-HIDE: curated ⊆ full, and full's
  // groups' _series enumerate every event — "See all" reaches all of them.
  // Taste is read at compute time; the order does NOT reshuffle mid-session.
  const feed = useMemo(
    () =>
      curateFeed(upcoming, {
        dayOf: (e) => e._clamp,
        labelOf: (ts) => ({ label: dayLabel(ts, anchors), dayTs: ts }), // Q2: lens identity for "Deck this"
        order: (items) => orderDay(items, tasteNudge),
      }),
    [upcoming, anchors]
  )
  // See-all toggle: default shows the curated front page; one tap reveals every
  // event (the full, still-collapsed feed). State, not navigation — the escape
  // is right here at the Everything header, never more than one tap from all N.
  const [seeAllEv, setSeeAllEv] = useState(false)
  const evSections = seeAllEv ? feed.full : feed.curated
  // H4 — the gentle stopping cue, feed END only (GPT report). 3+ distinct
  // details opened this session upgrades RowFeed's "that's everything" line to
  // a recap card: count + the last 3 viewed (live-resolved; vanished ones just
  // shorten the list) + a save nudge. Calm, never nagging, never a popup.
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

  // 3.7P-23b: the hero weather line — today's real forecast (emoji · condition ·
  // high), null until the 16-day fetch resolves so the hero never shows a guess.
  const todayWx = wx ? wx[dateKey(anchors.todayTs)] : null
  const wxLine = todayWx
    ? `${todayWx.emoji} ${CONDITION[todayWx.emoji] || 'Forecast'}${todayWx.hi != null ? ' · ' + todayWx.hi + '°' : ''}`
    : null

  const scrollToList = (el) => {
    const sc = scrollRef.current
    if (sc && el) sc.scrollTo({ top: Math.max(el.offsetTop - 64, 0), behavior: 'smooth' })
  }
  // "See all" opens the matching bubble PAGE (round-3: bubbles are destinations)
  const seeAll = (bubbleId) => {
    const b = BUBBLES.find((x) => x.id === bubbleId)
    if (b) onOpenBubble(b)
  }

  return (
    <div className="hot-scroll" ref={scrollRef}>
      <header className="hero">
        {/* 3.7P-6: cinematic hero — a slow Ken-Burns zoom on the real city photo
            (FB-06's "slight zoom in/out"; reduced-motion holds it still). Reads the
            CITY.heroes[] array (swipe-ready: the multi-photo crossfade turns on when
            ≥3 hero-quality images are curated). FB-07: the 🔎 moved out of the hero,
            down beside "Near Me" in the lens row below. */}
        <div className={'hero-img hero-kb' + (heroOk ? ' on' : '')} style={{ backgroundImage: `url(${CITY.heroes?.[0]?.url || CITY.hero})` }} />
        <div className="hero-dim" />
        <div className="hero-grad" />
        <div className="hero-text">
          {/* Sunlit Coastal Pop (3.71): the Wuzup brand lockup on the masthead */}
          <div className="hero-brand">
            <span className="hero-brand-dot" aria-hidden />
            Wuzup
          </div>
          {/* 3.7P-23b (§N): a warm time-of-day greeting + the day's real weather line */}
          <div className="hero-kicker">{heroKicker(new Date(nowMs))}</div>
          <h1 className="hero-city">{CITY.name}</h1>
          {/* weather line when the forecast is loaded (the §N top), else the
              de-counted abundance lead (3.72). The real event total still lives one
              tap away in the Everything "See all N" button. */}
          <div className="hero-sub">{wxLine || heroLine(new Date(nowMs), tonight.futureN)}</div>
        </div>
      </header>

      {/* Phase 3.6 N1: the quiet top nav — lens pills + an All-categories menu —
          replaces the loud 16-bubble strip (same destinations via onOpenBubble).
          Add event lives in the menu now. */}
      <LensNav
        lenses={LENS_BUBBLES}
        categories={CAT_BUBBLES}
        menuLabel="All categories"
        onOpen={onOpenBubble}
        onAdd={onOpenAdd}
        onSearch={onOpenSearch}
      />

      <div className="hot-body">
        {/* 3.7P-23b (§N screen 1): the headline planning stack — your next three
            days at a glance (real forecast + plan-state + a planner CTA). Leads
            the Home feed: discover happens below, but "what about MY days" is first. */}
        <section className="sec">
          <SecHead overline="Plan ahead" title="Your next days" />
          <NextDays anchors={anchors} wx={wx} />
        </section>
        {/* 3.7P-10 → 3.7P-20: Guides as the INTENT FRAME under the hero, now an
            ALL-VISIBLE grid of the SHARED IntentTile (identical format to the
            Spots "What are you up for?" activities). activeWatch = in-window timely
            guides; the evergreen GUIDES (events + mixed, never spots-only) follow.
            Each tile opens its GuidePage. */}
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
            {/* Phase 3.5: the "Full list + weekend plans → Profile" pointer was
                removed (Josh — Profile owns Your-list + plans; the shelf
                carousel here is reminder enough). */}
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
        {tonight.items.length > 0 && (
          <section className={'sec' + ent(0).className} style={ent(0).style}>
            <SecHead
              overline={tonight.late ? 'Still going · up next' : 'Happening today'}
              title={tonight.late ? 'Late tonight + tomorrow' : 'Tonight'}
              sub={
                tonight.late
                  ? `${tonight.futureN} left tonight · ${tonight.tomorrowN} tomorrow`
                  : // both counts, so the sub can't contradict the cards below it:
                    // the carousel includes all-day/date-only events, the kicker
                    // counts clocked showtimes only (DRAFT for Charles)
                    `${tonight.items.length} on today · ${tonight.futureN} with showtimes ahead`
              }
              onSeeAll={() => seeAll('tonight')}
            />
            <div className="carousel">
              {tonight.items.slice(0, 8).map(({ e, withDate }, i) => (
                <TonightCard key={keyOf(e) + i} e={e} onSelect={onSelect} withDate={withDate} />
              ))}
              <EndCap onClick={() => seeAll('tonight')} />
            </div>
          </section>
        )}
        {bigOne && (
          <section className={'sec' + ent(1).className} style={ent(1).style}>
            <BigOne e={bigOne} onSelect={onSelect} animate={animate} />
          </section>
        )}
        {gems.length > 0 && (
          <section className={'sec' + ent(2).className} style={ent(2).style}>
            <SecHead overline="Under the radar" title="Hidden Gems" sub={`${gems.length} hand-scored find${gems.length === 1 ? '' : 's'}`} />
            {/* 3.7P-23: secondary Home sections go to the dense CompactRow (the §N
                reference look); the Everything feed below keeps big Rows (discover
                = visual; the O.1 "Row on Home" contract is the MAIN feed). */}
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
        {/* 3.7P-10: the slim taste rail — railReady-gated (6+ organic taps), ~6
            cards, moved LOW (after the editorial picks, was right after Tonight)
            so it doesn't pre-empt Everything's taste order. DRAFT — ⚑ Charles */}
        {rail && (
          <section className="sec">
            <SecHead overline="For you" title="Your kind of night" sub="Tuned to what you’ve tapped." />
            <div className="carousel">
              {rail.map((e, i) => (
                <TonightCard key={keyOf(e) + i} e={e} onSelect={onSelect} withDate />
              ))}
            </div>
          </section>
        )}
        {recents.length > 0 && (
          <section className="sec">
            {/* H3: placed LOW on purpose — after the taste rail, before Everything
                (3.7P-10 cut the Free carousel that used to sit above it) */}
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
              {/* DRAFT COPY (Charles): honest framing — curated default vs the
                  full collapsed feed. The count is CARDS (recurring already one);
                  the See-all button below quotes the raw EVENT total. */}
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
            {/* See-all / show-less: the never-hide escape, right at the header.
                Default → "See all {N} events" (the REAL event count, fullEventCount,
                not the collapsed card count — honest about how much is one tap away). */}
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
            {/* rows themselves never entrance-animate; endSlot = the H4 recap.
                headerExtra (Q2): every day-header carries its 🃏 "Deck this"
                entry — a finite deck of exactly that day's list */}
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
