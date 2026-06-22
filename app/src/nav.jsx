/* eslint-disable react-refresh/only-export-components --
   the interface contract pins VIEWS / viewIndex / useNav to this file alongside
   the NavProvider component (same precedent as cards.jsx / Primer.jsx — the rule
   only affects dev-time Fast Refresh granularity, not runtime behavior). */
// nav.jsx — the navigation context (Sprint O6). Owns EVERYTHING about "where
// the user is": the active tab + goTo, the subpage union, the detail
// open/close (View-Transition morph included) and the detail→Map focus
// handoff. App.jsx keeps the DATA (events/norm/anchors/wx/myEvents/coords/
// primer); components reach navigation via useNav() instead of
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
//     capture-phase handlers in MapView (pin sheet) and PickerSheet (the day
//     planner's slot picker) always win first; within here, detail closes before subpage.
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
// Sprint S: the fifth tab landed. Locations ('Spots' — ⚑O1 placeholder, Charles
// names it) sits between Events and Map (CONFIRMED DECISIONS #1 order: Events ·
// Locations · Map · Calendar · Profile). Adding it was exactly the promised
// two-line diff — this entry + one lazy <section> in App.jsx; indices stay
// derived so nothing else moved.
// Stage R nav restructure (§P.5): the roster is Home · Events · Spots · Plan ·
// Profile. IDS STAY STABLE for the seams that key on them — 'hot' (Events
// browse), 'locations' (Spots), 'calendar' (now labelled "Plan"), 'profile'.
// 'home' is the NEW dashboard tab (greeting + Your-next-days + featured pick),
// split out of the old Events/hot tab. MAP IS NO LONGER A TAB — it is a sub-view
// (the {type:'map'} subpage) reached from Events/Spots + the detail mini-map
// (focusMap opens the sub-view, not a tab). Indices stay derived (nothing
// hardcodes a position); MapView reads its active state from page.type now.
export const VIEWS = [
  { id: 'home', label: 'Home' },
  { id: 'hot', label: 'Events' },
  { id: 'locations', label: 'Spots' },
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

  // ===== subpage overlay: null | {type:'bubble',bubble} |
  // {type:'placebubble',bubble} (Sprint S) | {type:'search'} |
  // {type:'add',ts} | {type:'day',ts} | {type:'settings'} |
  // {type:'interests',from} | {type:'taste',from} (Sprint V — why-feed +
  // mute/boost) | {type:'deck',from} | {type:'lensdeck',lens} —
  // slides in over the active tab (z 1500, below detail 2000). Sprint P added
  // settings (Profile's gear) and the calibration deck (launched FROM
  // settings — they stack by replacing the page, and their back/finish
  // affordances reopen settings, so "one level deep" stays true in feel while
  // the union stays flat in state). Sprint Q2 added lensdeck (the finite
  // "Deck this" mode) on the same replace-the-page pattern (a bubble-lens
  // deck's back affordance reopens its bubble via the quiet openBubble flag
  // below) and Q2c swapped the retired 7-screen interview for interests (the
  // InterestEditor) — both interests and deck carry a `from` origin so their
  // back affordances return where the user actually came from. =====
  const [page, setPage] = useState(null)
  const [pageClosing, setPageClosing] = useState(false)
  const pageTRef = useRef(null)
  const openBubble = useCallback((bubble, opts) => {
    // taste seam: tapping a CATEGORY bubble is a (weak) interest signal;
    // time/free/near bubbles say nothing about category taste. {quiet:true}
    // skips the signal — LensDeck's back affordance RE-opens the bubble the
    // user already tapped once, and navigation back is not a second interest
    // tap (the exactly-once seam contract, Sprint Q3).
    if (bubble.kind === 'cat' && !opts?.quiet) recordSignal('bubble', { category: bubble.value })
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'bubble', bubble })
  }, [])
  const openSearch = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'search' })
  }, [])
  // Sprint S: a tapped Locations bubble → a full PlaceBubblePage (the place-side
  // twin of openBubble). No taste signal here — a place's interest signal is
  // recorded on detail OPEN (the shared openDetail seam), same as events; the
  // bubble tap is just navigation. `bubble` is a PLACE_BUBBLES entry.
  const openPlaceBubble = useCallback((bubble) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'placebubble', bubble })
  }, [])
  // 3.75: a tapped Guide → its full GuidePage (the Smart-Group destination,
  // {type:'guide',guide}). Pure navigation — a guide's items record their own
  // taste signal on detail open, same as bubbles.
  const openGuide = useCallback((guide) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'guide', guide })
  }, [])
  // Phase 3.5: openNight + the {type:'night'} Find-My-Night subpage retired
  // (Josh: remove the dice). fmnseen.js stays — the Deck + day-fill decks still
  // use it; recordSignal('fmn') in taste.js is now caller-less (left as a seam).
  // Sprint U-c: openAdd takes an optional day timestamp. From the day screen's
  // "+ add your own" path it carries `ts` (a number) so AddEvent pre-fills that
  // date AND auto-slots the new event into that day on submit (daypartOf
  // routes day vs night; never clobbers a filled slot). Every other caller
  // (Hot FAB, etc.) passes nothing — and a stray click-event arg reads as not
  // a number, so the guard keeps the plain Add flow date-free.
  const openAdd = useCallback((ts) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'add', ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : null })
  }, [])
  // Sprint U-a: the day screen — `ts` is the day's local-midnight timestamp.
  // App keys the mount on ts + anchors.todayTs, so opening another day AND
  // crossing midnight both remount cleanly (ts alone wouldn't roll over).
  // Opened from CalendarView's day-rail pills and month-grid cells;
  // non-numeric input is ignored defensively.
  const openDay = useCallback((ts) => {
    if (typeof ts !== 'number' || !Number.isFinite(ts)) return
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'day', ts })
  }, [])
  // Sprint P: settings (Profile gear) + the taste flows it launches.
  // Opening one while another is up REPLACES the page (single-slot union) —
  // the .subpage shell stays mounted, so settings → interests → settings
  // reads as layers without any stack state.
  const openSettings = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'settings' })
  }, [])
  // Stage R (Profile rework): the two new Profile drill-ins — My plans + My saves.
  // Plain single-slot subpages (same pattern as settings/search); back/close via
  // closePage → the Profile tab. No `from`/origin (they always close to the tab).
  const openMyPlans = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'myplans' })
  }, [])
  const openMySaves = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'mysaves' })
  }, [])
  // PROFILE_PHASE2: two net-new plain single-slot Profile drill-ins (same pattern;
  // back/close via closePage → the Profile tab). No `from`/origin.
  const openEditProfile = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'editprofile' })
  }, [])
  const openHelpFeedback = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'helpfeedback' })
  }, [])
  // HOME_PHASE2: two net-new Home drill-ins — full 7-day Forecast + Notifications.
  const openForecast = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'forecast' })
  }, [])
  const openNotifications = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'notifications' })
  }, [])
  // Q2c: the InterestEditor. `from` is honored ONLY as the literal 'settings'
  // (callers pass it through onClick, so a click-event arg must read as "not
  // from settings") — it routes the editor's back affordance: settings row →
  // back to Settings; Profile's vibe chips (or anywhere else) → close to tab.
  const openInterests = useCallback((from) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'interests', from: from === 'settings' ? 'settings' : null })
  }, [])
  // Sprint V2/V3: the taste transparency + mute/boost panel (TastePanel).
  // Same single-slot replace pattern + `from` origin as openInterests, so its
  // back affordance returns to Settings when launched there.
  const openTaste = useCallback((from) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'taste', from: from === 'settings' ? 'settings' : null })
  }, [])
  // Q2d: the deck gained a second door (the primer's finish-screen offer).
  // Same literal-string guard as openInterests: anything but 'primer' —
  // including the click event Settings' row hands over — means the historical
  // settings origin, so the deck's close keeps returning to Settings there.
  const openDeck = useCallback((origin) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    // origin routes the deck's close affordance: 'primer' (onboarding offer) and
    // 'profile' (W6 taste hub) close to the tab; anything else — including the
    // click event Settings' row hands over — is the historical settings origin.
    setPage({ type: 'deck', from: origin === 'primer' ? 'primer' : origin === 'profile' ? 'profile' : 'settings' })
  }, [])
  // Sprint Q2: the finite lens deck ("Deck this" on day-headers + bubble
  // pages). lens = {kind:'day',dayTs} | {kind:'bubble',bubble} — LensDeck
  // owns the dealing; this is ONLY ever called from an explicit tap (the
  // deck never autoplays and is never the default view).
  const openLensDeck = useCallback((lens) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'lensdeck', lens })
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
  // Stage R: Map is a SUB-VIEW now (not a tab). openMap opens it unfocused (the
  // "Map" affordance on Events/Spots).
  const openMap = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setMapFocus(null)
    setPage({ type: 'map' })
  }, [])
  // §O.1 path 5 (REWIRED, Stage R): the detail mini-map tap used to goTo the Map
  // TAB; Map is now a sub-view, so it opens the {type:'map'} subpage instead. It
  // still closes the detail, sets a FRESH focus object (re-runs MapView's focus
  // effect every call), and carries kind so the Spots layer flips for a place.
  const focusMap = useCallback((e) => {
    morphElRef.current = null // card name is already cleared post-open; just drop the ref
    setDetail(null)
    setClosing(false)
    setVtOpen(false)
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setMapFocus({ lat: e.lat, lng: e.lng, key: keyOf(e), kind: e.kind ?? null })
    setPage({ type: 'map' }) // open the Map sub-view (was a Map-TAB jump pre-Stage-R)
  }, [])

  // Escape closes the topmost layer: detail first, then any open subpage
  // (bubble phase — MapView/PickerSheet capture-phase handlers run first)
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
      openPlaceBubble,
      openGuide,
      openSearch,
      openMap,
      openAdd,
      openDay,
      openSettings,
      openMyPlans,
      openMySaves,
      openEditProfile,
      openHelpFeedback,
      openForecast,
      openNotifications,
      openInterests,
      openTaste,
      openDeck,
      openLensDeck,
      closePage,
      // detail
      detail,
      closing,
      vtOpen,
      openDetail,
      closeDetail,
      // detail → map handoff (Map sub-view)
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
      openPlaceBubble,
      openGuide,
      openSearch,
      openMap,
      openAdd,
      openDay,
      openSettings,
      openMyPlans,
      openMySaves,
      openEditProfile,
      openHelpFeedback,
      openForecast,
      openNotifications,
      openInterests,
      openTaste,
      openDeck,
      openLensDeck,
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
