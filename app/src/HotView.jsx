// HotView — the Hot tab magazine: hero (+ 🔎 search), bubble strip (each bubble
// opens a full BubblePage via onOpenBubble), alternating sections, Everything feed.
import { useEffect, useMemo, useRef, useState } from 'react'
import { BUBBLES, CITY, DAY, dayLabel, hotDesc, keyOf } from './lib.js'
import { BigOne, EndCap, FreeCard, GemRow, RowFeed, SecHead, TonightCard } from './cards.jsx'

export default function HotView({ events, anchors, loading, displayMode, onSelect, onOpenBubble, onOpenSearch }) {
  const scrollRef = useRef(null)
  const evRef = useRef(null)
  const [entered, setEntered] = useState(false) // entrance animations already played?
  const [heroOk, setHeroOk] = useState(false)
  void displayMode // reserved for the display-mode agent (cards also read it via context)

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
  const tonight = useMemo(() => upcoming.filter((e) => e._tonight).sort(hotDesc), [upcoming])
  const bigOne = useMemo(() => {
    if (!hasHot) return null // hotScore data absent → skip section gracefully
    const oneOffs = upcoming.filter((e) => e.tags.includes('one-off') && e.hotScore != null)
    const pool = oneOffs.length ? oneOffs : upcoming.filter((e) => e.hotScore != null)
    return pool.reduce((best, e) => (best == null || e.hotScore > best.hotScore ? e : best), null)
  }, [upcoming, hasHot])
  const gems = useMemo(() => upcoming.filter((e) => e.tags.includes('hidden-gem')).slice(0, 3), [upcoming])
  const freeWeek = useMemo(
    () => upcoming.filter((e) => e._free && e._clamp <= anchors.todayTs + 6 * DAY).slice(0, 10),
    [upcoming, anchors]
  )
  // Everything: grouped by day, WITHIN each day ordered by hotScore desc (nulls last)
  const evSections = useMemo(() => {
    const m = new Map()
    for (const e of upcoming) {
      if (!m.has(e._clamp)) m.set(e._clamp, [])
      m.get(e._clamp).push(e)
    }
    return [...m.entries()].map(([ts, items]) => ({ label: dayLabel(ts, anchors), items: [...items].sort(hotDesc) }))
  }, [upcoming, anchors])

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
          <div className="hero-kicker">WHAT'S HOT · THIS WEEK</div>
          <h1 className="hero-city">{CITY.name}</h1>
          <div className="hero-sub">{events.length} events near you</div>
        </div>
      </header>

      <div className="bubbles">
        {BUBBLES.map((b) => (
          <button key={b.id} className="bubble" style={{ '--bh': b.hue }} onClick={() => onOpenBubble(b)}>
            <span className="bubble-emoji">{b.emoji}</span>
            <span className="bubble-label">{b.label}</span>
          </button>
        ))}
      </div>

      <div className="hot-body">
        {tonight.length > 0 && (
          <section className={'sec' + ent(0).className} style={ent(0).style}>
            <SecHead overline="Happening today" title="Tonight" onSeeAll={() => seeAll('tonight')} />
            <div className="carousel">
              {tonight.slice(0, 8).map((e, i) => (
                <TonightCard key={keyOf(e) + i} e={e} onSelect={onSelect} />
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
            <SecHead overline="Under the radar" title="Hidden Gems" />
            <div className="gems">
              {gems.map((e, i) => (
                <GemRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
              ))}
            </div>
            <button className="gems-more" onClick={() => scrollToList(evRef.current)}>
              More gems →
            </button>
          </section>
        )}
        {freeWeek.length > 0 && (
          <section className={'sec' + ent(3).className} style={ent(3).style}>
            <SecHead overline="$0 well spent" title="Free This Week" onSeeAll={() => seeAll('free')} />
            <div className="carousel">
              {freeWeek.map((e, i) => (
                <FreeCard key={keyOf(e) + i} e={e} onSelect={onSelect} />
              ))}
              <EndCap square onClick={() => seeAll('free')} />
            </div>
          </section>
        )}
        {upcoming.length > 0 && (
          <section className="sec sec-ev" ref={evRef}>
            <div className={ent(4).className.trim()} style={ent(4).style}>
              <SecHead title="Everything" sub="All upcoming, by date" />
            </div>
            {/* rows themselves never entrance-animate */}
            <RowFeed sections={evSections} scrollRootRef={scrollRef} onSelect={onSelect} />
          </section>
        )}
        {!loading && upcoming.length === 0 && (
          <div className="empty">
            No upcoming events found.
            <br />
            Re-run the finder to refresh.
          </div>
        )}
      </div>
    </div>
  )
}
