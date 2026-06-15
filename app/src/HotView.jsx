// HotView — the Hot tab magazine: hero (+ 🔎 search), bubble strip (each bubble
// opens a full BubblePage), alternating sections, Everything feed. Navigation
// (detail/bubble/search/add/weekend openers) comes from useNav() — O6.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BUBBLES, CAT_BUBBLES, CITY, DAY, LENS_BUBBLES, dayLabel, hotDesc, keyOf, orderDay, tonightModel } from './lib.js'
import LensNav from './LensNav.jsx'
import { curateFeed } from './curate.js'
import { useNav } from './nav.jsx'
import { BigOne, EndCap, FreeCard, GemRow, GuideCard, RowFeed, SecHead, TonightCard } from './cards.jsx'
import { GUIDES, useGuides, watchGuideActive, resolveWatchGuide } from './guides.js'
import { shelfItems, useSaves } from './saves.js'
import { railReady, tasteNudge, topCategories, useTaste, whenPreference } from './taste.js'
import { useRecents } from './recents.js'
import { DeckThisButton } from './LensDeck.jsx'

// H2 — time-aware hero kicker (replaces the static "WHAT'S HOT · THIS WEEK").
// Pure (now, whenPref) → a soft, title-case daypart greeting (e.g. "Friday
// night"); plain text, zero animation. whenPref (from the H1 primer) adds a
// one-word "Your" flavor when the clock matches the stated habit — 'whenever'
// adds nothing (every night being "yours" is noise). 3.72: de-counted +
// de-shouted (no ALL-CAPS, no raw count); the emotional lead moved to heroLine
// below, and the real event total still lives in the "See all N events" button.
// DRAFT copy — ⚑ Charles.
function heroKicker(now, whenPref) {
  const wd = now.toLocaleDateString('en-US', { weekday: 'long' })
  const h = now.getHours()
  const dow = now.getDay()
  const night = h >= 17 || h < 5
  const part = h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'night'
  const prefHit =
    night &&
    (whenPref === 'weekends'
      ? dow === 5 || dow === 6 || dow === 0
      : whenPref === 'weeknights'
        ? dow >= 1 && dow <= 4
        : false)
  return (prefHit ? 'Your ' : '') + wd + ' ' + part
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

export default function HotView({ events, anchors, loading, whenPref }) {
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
    img.src = CITY.hero
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
  const gems = useMemo(() => upcoming.filter((e) => e.tags.includes('hidden-gem')).sort(hotDesc), [upcoming])
  // G1 orderDay here too: raw date-asc order opened the carousel with six
  // identical same-program library cards — diversity-interleave like the
  // Everything feed does (count-preserving; taste read at compute time).
  const freeWeek = useMemo(
    () => orderDay(upcoming.filter((e) => e._free && e._clamp <= anchors.todayTs + 6 * DAY), tasteNudge),
    [upcoming, anchors]
  )
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
      .slice(0, 8)
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
        <div className={'hero-img' + (heroOk ? ' on' : '')} style={{ backgroundImage: `url(${CITY.hero})` }} />
        <div className="hero-dim" />
        <div className="hero-grad" />
        <button className="hero-search" onClick={onOpenSearch} aria-label="Search events">
          🔎
        </button>
        <div className="hero-text">
          {/* Sunlit Coastal Pop (3.71): the Wuzup brand lockup on the masthead */}
          <div className="hero-brand">
            <span className="hero-brand-dot" aria-hidden />
            Wuzup
          </div>
          {/* H2: time-aware greeting (tracks nowMs — re-seeded on visibility + every 10 min) */}
          <div className="hero-kicker">
            {/* Sprint V1: when-preference is ONE resolver now (whenPreference in
                taste.js) — the editor's dayparts outrank the primer's first-open
                `when`, 'both'→whenever. Profile reads the same resolver, so the
                two surfaces can never disagree (the Q2 carry-in, unified). */}
            {heroKicker(new Date(nowMs), whenPreference(taste, whenPref))}
          </div>
          <h1 className="hero-city">{CITY.name}</h1>
          {/* 3.72: de-counted — lead with emotion, not "1,198 events". The real
              total still lives one tap away in the Everything "See all N" button. */}
          <div className="hero-sub">{heroLine(new Date(nowMs), tonight.futureN)}</div>
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
      />

      <div className="hot-body">
        {shelfOn && (
          <section className="sec shelf-sec">
            <SecHead
              overline="Saved for later"
              title={
                <>
                  Your list ❤️<span className="shelf-count">{shelf.length}</span>
                </>
              }
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
        {rail && (
          <section className="sec">
            {/* DRAFT — ⚑ Charles */}
            <SecHead overline="For you" title="Your kind of night" sub="Tuned to what you’ve tapped." />
            <div className="carousel">
              {rail.map((e, i) => (
                <TonightCard key={keyOf(e) + i} e={e} onSelect={onSelect} withDate />
              ))}
            </div>
          </section>
        )}
        {/* 3.75: Guides — derivable intention collections (a moment + a POV), each
            a plannable destination. Evergreen intentions, so always shown. DRAFT. */}
        <section className="sec">
          <SecHead overline="Plans by mood" title="Guides" sub="Collections for whatever you're up for" />
          <div className="carousel">
            {activeWatch.map((g) => (
              <GuideCard key={g.id} guide={g} onOpen={openGuide} />
            ))}
            {GUIDES.map((g) => (
              <GuideCard key={g.id} guide={g} onOpen={openGuide} />
            ))}
          </div>
        </section>
        {bigOne && (
          <section className={'sec' + ent(1).className} style={ent(1).style}>
            <BigOne e={bigOne} onSelect={onSelect} animate={animate} />
          </section>
        )}
        {gems.length > 0 && (
          <section className={'sec' + ent(2).className} style={ent(2).style}>
            <SecHead overline="Under the radar" title="Hidden Gems" sub={`${gems.length} hand-scored finds`} />
            <div className="gems">
              {gems.slice(0, 3).map((e, i) => (
                <GemRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
              ))}
            </div>
            <button className="gems-more" onClick={() => scrollToList(evRef.current)}>
              Browse everything →
            </button>
          </section>
        )}
        {freeWeek.length > 0 && (
          <section className={'sec' + ent(3).className} style={ent(3).style}>
            {/* DRAFT — ⚑ Charles. "Costs nothing" (not "no ticket needed": a free
                event can still require a free RSVP/ticket — _free is admission, not
                ticketless). Sub is a real POV line, not a recount. */}
            <SecHead overline="Costs nothing" title="Free this week" sub="Worth leaving the house for." onSeeAll={() => seeAll('free')} />
            <div className="carousel">
              {freeWeek.slice(0, 10).map((e, i) => (
                <FreeCard key={keyOf(e) + i} e={e} onSelect={onSelect} />
              ))}
              <EndCap square onClick={() => seeAll('free')} />
            </div>
          </section>
        )}
        {recents.length > 0 && (
          <section className="sec">
            {/* H3: placed LOW on purpose — after Free, before Everything */}
            <SecHead overline="Pick up where you left off" title="Recently viewed" />
            <div className="gems">
              {recents.map((e, i) => (
                <GemRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
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
