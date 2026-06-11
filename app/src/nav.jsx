/* eslint-disable react-refresh/only-export-components --
   the interface contract pins VIEWS / viewIndex / useNav to this file alongside
   the NavProvider component (same precedent as cards.jsx / Primer.jsx — the rule
   only affects dev-time Fast Refresh granularity, not runtime behavior). */
// nav.jsx — the navigation context (Sprint O6). Owns EVERYTHING about "where
// the user is": the active tab + goTo, the subpage union, the detail
// open/close (View-Transition morph included) and the detail→Map focus
// handoff. App.jsx keeps the DATA (events/norm/anchors/wx/myEvents/coords/
// primer/displayMode); components reach navigation via useNav() instead of
// 5-deep callback prop-drilling. ZERO behavior change — the logic below moved
// here verbatim from App.jsx; the smoke harness + a hand pass guard it.
//
// The two signal-capture seams stay INSIDE the moved handlers so taste/recents
// recording is single-sourced no matter which surface opens a detail/bubble:
//   openDetail → recordSignal('open') + recordView
//   openBubble → recordSignal('bubble') for category bubbles only
//
// Contracts preserved (and load-bearing — do not reorder):
//   · View-Transition morph: openDetail names the tapped card's [data-vt]
//     element 'evt-hero' for the OLD snapshot, clears it inside the transition
//     so only the detail hero owns the name in the NEW one; closeDetail
//     reverses it. Reduced motion / no-VT browsers get the slide-up fallback.
//   · Escape layering: this module's window listener is BUBBLE-phase, so the
//     capture-phase handlers in MapView (pin sheet) and WeekendBuilder
//     (picker) always win first; within here, detail closes before subpage.
//   · openDetail/closeDetail/open*/closePage are useCallback-stable so
//     consumers (MapView's marker effect especially) never re-run on identity.
// NOTE: .jsx, not .js — react-hooks/refs hard-errors the createElement form of
// the provider (a ref callback inside an argument object reads as "ref passed
// to a function during render"); the semantically identical JSX form passes.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { keyOf } from './lib.js'
import { recordSignal } from './taste.js'
import { recordView } from './recents.js'

// the tab roster — ids are the stable identity, INDICES ARE DERIVED (audit
// prep #1: nothing may hardcode a position). Sprint O1: four populated tabs.
// 'hot' keeps its internal id (CSS .tab-hot, openers, taste seams all key on
// it) but wears the "Events" label — ⚑O1 placeholder pending Charles.
// Adding the fifth (Locations, Sprint S) = ONE entry here + ONE lazy-mounted
// <section> in App.jsx's pager — everything else (tab bar, lazy mounting,
// pager CSS, dice/🎨 gates, Escape, focusMap) derives. Icon.locations is
// already drawn (lib.js) and waiting. DRIVER'S-SEAT CALL: it enters when it
// has content, not as a dead tab (MASTER_PLAN2 §O1).
export const VIEWS = [
  { id: 'hot', label: 'Events' },
  { id: 'map', label: 'Map' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'profile', label: 'Profile' },
]
export const viewIndex = (id) => VIEWS.findIndex((v) => v.id === id)

const supportsVT = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

const NavContext = createContext(null)

export function useNav() {
  return useContext(NavContext)
}

export function NavProvider({ children }) {
  // ===== active tab + pager =====
  const [active, setActive] = useState(0)
  // ===== lazy tab mounting (O1): the pager's section SHELLS always render
  // (scroll-snap needs all N widths), but a tab's CHILDREN mount on its FIRST
  // visit only — the boot tab is seeded, so boot renders exactly one tab's
  // tree (strictly less work than the old eager three-tab boot; the smoke
  // harness asserts the gates exist). The set only ever grows: a visited tab
  // stays mounted so its state (map instance, calendar selection) survives
  // tab hops. Visits are recorded INSIDE the two tab-changing handlers (goTo /
  // onPagerScroll) — event-driven, not an effect; a swipe counts the moment
  // the page crosses halfway (Math.round), so it mounts mid-gesture. =====
  const [visited, setVisited] = useState(() => new Set([VIEWS[0].id]))
  const visit = useCallback((i) => {
    const id = VIEWS[i]?.id
    if (!id) return
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])
  const pagerRef = useRef(null)
  // App attaches the pager element through this ref CALLBACK (not the ref
  // object itself — a raw ref in the context value trips react-hooks/refs,
  // and rightly: nothing should read .current during render)
  const attachPager = useCallback((el) => {
    pagerRef.current = el
  }, [])
  const goTo = useCallback(
    (i) => {
      setActive(i)
      visit(i)
      const p = pagerRef.current
      // instant jump: never slide through intermediate pages (finger-swipe snap unaffected)
      if (p) p.scrollTo({ left: i * p.clientWidth, behavior: 'instant' })
    },
    [visit]
  )
  const onPagerScroll = useCallback(() => {
    const p = pagerRef.current
    if (!p) return
    const i = Math.round(p.scrollLeft / p.clientWidth)
    setActive((prev) => (i !== prev ? i : prev))
    visit(i)
  }, [visit])

  // ===== subpage overlay: null | {type:'bubble',bubble} | {type:'search'} |
  // {type:'night'} | {type:'add'} | {type:'weekend'} | {type:'settings'} |
  // {type:'interview'} | {type:'deck'} — slides in over the active tab
  // (z 1500, below detail 2000). Sprint P added the last three: settings
  // (Profile's gear), the full interview and the calibration deck (both
  // launched FROM settings — they stack by replacing the page, and their
  // back/finish affordances reopen settings, so "one level deep" stays true
  // in feel while the union stays flat in state). =====
  const [page, setPage] = useState(null)
  const [pageClosing, setPageClosing] = useState(false)
  const pageTRef = useRef(null)
  const openBubble = useCallback((bubble) => {
    // taste seam: tapping a CATEGORY bubble is a (weak) interest signal;
    // time/free/near bubbles say nothing about category taste
    if (bubble.kind === 'cat') recordSignal('bubble', { category: bubble.value })
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
  const openAdd = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'add' })
  }, [])
  const openWeekend = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'weekend' })
  }, [])
  // Sprint P: settings (Profile gear) + the two taste flows it launches.
  // Opening one while another is up REPLACES the page (single-slot union) —
  // the .subpage shell stays mounted, so settings → interview → settings
  // reads as layers without any stack state.
  const openSettings = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'settings' })
  }, [])
  const openInterview = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'interview' })
  }, [])
  const openDeck = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'deck' })
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

  // ===== detail open/close with App-Store morph: View Transitions when
  // available, slide-up otherwise =====
  const [detail, setDetail] = useState(null)
  const [closing, setClosing] = useState(false)
  const [vtOpen, setVtOpen] = useState(false)
  const morphElRef = useRef(null)
  const openDetail = useCallback((e, cardEl) => {
    recordSignal('open', e) // taste seam: opening a detail = +1 category interest
    recordView(e) // recents seam (H3): FIFO recents + the in-session list (H4)
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

  // ===== detail mini-map tap → close the detail + any subpage, jump to the
  // Map tab, and hand MapView a focus target ({lat,lng,key}; fresh object
  // every call so re-focusing the same event re-runs MapView's focus effect) =====
  const [mapFocus, setMapFocus] = useState(null)
  const focusMap = useCallback(
    (e) => {
      morphElRef.current = null // card name is already cleared post-open; just drop the ref
      setDetail(null)
      setClosing(false)
      setVtOpen(false)
      clearTimeout(pageTRef.current)
      setPage(null)
      setPageClosing(false)
      setMapFocus({ lat: e.lat, lng: e.lng, key: keyOf(e) })
      goTo(viewIndex('map'))
    },
    [goTo]
  )

  // Escape closes the topmost layer: detail first, then any open subpage
  // (bubble phase — MapView/WeekendBuilder capture-phase handlers run first)
  useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return
      if (detail) closeDetail()
      else if (page && !pageClosing) closePage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, page, pageClosing, closeDetail, closePage])

  const value = useMemo(
    () => ({
      // tab
      active,
      goTo,
      attachPager,
      onPagerScroll,
      visited,
      // subpage union
      page,
      pageClosing,
      openBubble,
      openSearch,
      openNight,
      openAdd,
      openWeekend,
      openSettings,
      openInterview,
      openDeck,
      closePage,
      // detail
      detail,
      closing,
      vtOpen,
      openDetail,
      closeDetail,
      // detail → map handoff
      mapFocus,
      focusMap,
    }),
    [
      active,
      goTo,
      attachPager,
      onPagerScroll,
      visited,
      page,
      pageClosing,
      openBubble,
      openSearch,
      openNight,
      openAdd,
      openWeekend,
      openSettings,
      openInterview,
      openDeck,
      closePage,
      detail,
      closing,
      vtOpen,
      openDetail,
      closeDetail,
      mapFocus,
      focusMap,
    ]
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}
