// App — shell: data fetch + normalize, anchors, pager + tabbar, subpage mounting
// (BubblePage / SearchPage / FindMyNight), detail open/close (View Transitions),
// geolocation (requestCoords), and display-mode state (localStorage 'display-mode').
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { CITY, Icon, makeAnchors, normalize } from './lib.js'
import { DISPLAY_MODES, DisplayModeContext, DisplayModeToggle } from './cards.jsx'
import HotView from './HotView.jsx'
import MapView from './MapView.jsx'
import CalendarView from './CalendarView.jsx'
import DetailPage from './DetailPage.jsx'
import BubblePage from './BubblePage.jsx'
import SearchPage from './SearchPage.jsx'
import FindMyNight from './FindMyNight.jsx'
import './App.css'

const VIEWS = [
  { id: 'hot', label: 'Hot' },
  { id: 'map', label: 'Map' },
  { id: 'calendar', label: 'Calendar' },
]

function TabBar({ active, onTab }) {
  return (
    <nav className="tabbar">
      {VIEWS.map((v, i) => {
        const I = Icon[v.id]
        return (
          <button
            key={v.id}
            className={'tab' + (active === i ? ' active' : '') + (v.id === 'hot' ? ' tab-hot' : '')}
            onClick={() => onTab(i)}
          >
            <I className="tab-ic" width="24" height="24" />
            <span className="tab-label">{v.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

const supportsVT = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [bootVis, setBootVis] = useState(false) // boot overlay gated 300ms (no flash on fast loads)
  const [active, setActive] = useState(0)
  const [detail, setDetail] = useState(null)
  const [closing, setClosing] = useState(false)
  const [vtOpen, setVtOpen] = useState(false)
  // subpage overlay: null | {type:'bubble',bubble} | {type:'search'} | {type:'night'}
  const [page, setPage] = useState(null)
  const [pageClosing, setPageClosing] = useState(false)
  const [coords, setCoords] = useState(null)
  // display mode: 'editorial' | 'poster' | 'cinematic', persisted to localStorage
  const [displayMode, setDisplayMode] = useState(() => {
    try {
      const v = localStorage.getItem('display-mode')
      return DISPLAY_MODES.includes(v) ? v : 'editorial'
    } catch {
      return 'editorial'
    }
  })
  const pagerRef = useRef(null)
  const morphElRef = useRef(null)
  const pageTRef = useRef(null)
  const coordsRef = useRef(null)

  useEffect(() => {
    fetch('/events.json')
      .then((r) => r.json())
      .then((d) => setEvents(Array.isArray(d) ? d : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setBootVis(true), 300)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('display-mode', displayMode)
    } catch {
      /* private mode etc. — mode still works for the session */
    }
  }, [displayMode])

  // anchors must track the real clock: an app left open past midnight (or
  // resumed from background the next day) would otherwise show yesterday's
  // "Today". Recompute when the tab becomes visible and shortly after each
  // local midnight; only re-set state when the day actually rolled over.
  const [anchors, setAnchors] = useState(() => makeAnchors())
  useEffect(() => {
    const refresh = () => setAnchors((prev) => {
      const next = makeAnchors()
      return next.todayTs === prev.todayTs ? prev : next
    })
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    let timer
    const schedule = () => {
      const now = new Date()
      // 30s past local midnight (cushion for clock skew / timer coalescing)
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30)
      timer = setTimeout(() => {
        refresh()
        schedule()
      }, next.getTime() - now.getTime())
    }
    schedule()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearTimeout(timer)
    }
  }, [])
  const norm = useMemo(() => events.map((e) => normalize(e, anchors)), [events, anchors])
  const displayCtx = useMemo(() => ({ mode: displayMode, setMode: setDisplayMode }), [displayMode])

  const goTo = (i) => {
    setActive(i)
    const p = pagerRef.current
    // instant jump: never slide through intermediate pages (finger-swipe snap unaffected)
    if (p) p.scrollTo({ left: i * p.clientWidth, behavior: 'instant' })
  }
  const onScroll = () => {
    const p = pagerRef.current
    if (!p) return
    const i = Math.round(p.scrollLeft / p.clientWidth)
    if (i !== active) setActive(i)
  }

  // geolocation lifted into App so any page can ask: resolves to coords or null
  // (denied / unsupported). Last fix is cached and also exposed via the coords prop.
  const requestCoords = useCallback(() => {
    return new Promise((resolve) => {
      if (coordsRef.current) return resolve(coordsRef.current)
      if (!navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const c = { lat: p.coords.latitude, lng: p.coords.longitude }
          coordsRef.current = c
          setCoords(c)
          resolve(c)
        },
        () => resolve(null)
      )
    })
  }, [])

  // subpages: slide in over the Hot tab (z 1500, below detail 2000)
  const openBubble = useCallback((bubble) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'bubble', bubble })
  }, [])
  const openSearch = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'search' })
  }, [])
  const openNight = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'night' })
  }, [])
  const closePage = useCallback(() => {
    setPageClosing(true)
    clearTimeout(pageTRef.current)
    pageTRef.current = setTimeout(() => {
      setPage(null)
      setPageClosing(false)
    }, 400)
  }, [])
  useEffect(() => () => clearTimeout(pageTRef.current), [])

  // detail open/close with App-Store morph: View Transitions when available, slide-up otherwise.
  // useCallback: a stable identity so MapView's marker effect never re-runs because of us.
  const openDetail = useCallback((e, cardEl) => {
    setClosing(false)
    const el = cardEl ? cardEl.querySelector('[data-vt]') : null
    if (supportsVT() && el) {
      morphElRef.current = el
      el.style.viewTransitionName = 'evt-hero' // old snapshot: the card image owns the name
      document.startViewTransition(() => {
        el.style.viewTransitionName = '' // new snapshot: only the detail hero owns it
        flushSync(() => {
          setVtOpen(true)
          setDetail(e)
        })
      })
    } else {
      morphElRef.current = null
      setVtOpen(false)
      setDetail(e)
    }
  }, [])
  const closeDetail = useCallback(() => {
    const el = morphElRef.current
    if (vtOpen && supportsVT()) {
      const t = document.startViewTransition(() => {
        flushSync(() => setDetail(null))
        if (el && el.isConnected) el.style.viewTransitionName = 'evt-hero'
      })
      t.finished.finally(() => {
        if (el) el.style.viewTransitionName = ''
        morphElRef.current = null
      })
    } else {
      setClosing(true)
      setTimeout(() => {
        setDetail(null)
        setClosing(false)
      }, 240)
    }
  }, [vtOpen])

  // Escape closes the topmost layer: detail first, then any open subpage
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      if (detail) closeDetail()
      else if (page && !pageClosing) closePage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, page, pageClosing, closeDetail, closePage])

  return (
    <DisplayModeContext.Provider value={displayCtx}>
      <div className="app">
        <div className="pager" ref={pagerRef} onScroll={onScroll}>
          <section className="page page-hot">
            <HotView
              events={norm}
              anchors={anchors}
              loading={loading}
              displayMode={displayMode}
              onSelect={openDetail}
              onOpenBubble={openBubble}
              onOpenSearch={openSearch}
            />
          </section>
          <section className="page page-map">
            <MapView events={norm} anchors={anchors} onSelect={openDetail} active={active === 1} />
          </section>
          <section className="page">
            <CalendarView events={norm} anchors={anchors} onSelect={openDetail} />
          </section>
        </div>
        <TabBar active={active} onTab={goTo} />
        {active === 0 && norm.length > 0 && (
          <button className="dice" onClick={openNight} aria-label="Find my night">
            🎲
          </button>
        )}
        {/* 🎨 pill hides while Find My Night is open — it floats dead over the dark flow */}
        {active === 0 && page?.type !== 'night' && <DisplayModeToggle />}
        {page && (
          <div className={'subpage' + (pageClosing ? ' subpage-closing' : '')}>
            {page.type === 'bubble' && (
              <BubblePage
                bubble={page.bubble}
                events={norm}
                anchors={anchors}
                coords={coords}
                requestCoords={requestCoords}
                onSelect={openDetail}
                onClose={closePage}
              />
            )}
            {page.type === 'search' && (
              <SearchPage events={norm} anchors={anchors} onSelect={openDetail} onClose={closePage} />
            )}
            {page.type === 'night' && (
              <FindMyNight events={norm} anchors={anchors} onSelect={openDetail} onClose={closePage} />
            )}
          </div>
        )}
        {detail && <DetailPage e={detail} closing={closing} vt={vtOpen} onClose={closeDetail} />}
        {loading && bootVis && <div className="boot">Loading {CITY.name}…</div>}
      </div>
    </DisplayModeContext.Provider>
  )
}
