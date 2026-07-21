/* eslint-disable react-refresh/only-export-components --
   the interface contract pins VIEWS / viewIndex / useNav to this file alongside
   the NavProvider component (same precedent as cards.jsx / Primer.jsx — the rule
   only affects dev-time Fast Refresh granularity, not runtime behavior). */
// nav.jsx — the navigation context (Sprint O6). Owns EVERYTHING about "where
// the user is": the active tab + goTo, the subpage union, and the detail
// open/close (View-Transition morph included). App.jsx keeps the DATA (events/norm/anchors/wx/myEvents/coords/
// primer); components reach navigation via useNav() instead of
// 5-deep callback prop-drilling. ZERO behavior change — the logic below moved
// here verbatim from App.jsx; the smoke harness + a hand pass guard it.
//
// Retained detail activity stays inside openDetail so every surface uses the
// same truth-gated personal-signal handoff. Bubble/filter navigation is not a
// durable preference and deliberately records no taste evidence.
//
// Contracts preserved (and load-bearing — do not reorder):
//   · View-Transition morph: openDetail names the tapped card's [data-vt]
//     element 'evt-hero' for the OLD snapshot, clears it inside the transition
//     so only the detail hero owns the name in the NEW one; closeDetail
//     reverses it. Reduced motion / no-VT browsers get the slide-up fallback.
//   · Escape layering: this module's window listener is BUBBLE-phase, so the
//     capture-phase handler in PickerSheet (the day planner's slot picker)
//     always wins first; within here, detail closes before subpage.
//   · openDetail/closeDetail/open*/closePage are useCallback-stable so
//     consumers never re-run on identity.
// NOTE: .jsx, not .js — react-hooks/refs hard-errors the createElement form of
// the provider (a ref callback inside an argument object reads as "ref passed
// to a function during render"); the semantically identical JSX form passes.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useActivity } from './ActivityProvider.jsx'
import { primaryKeyOf } from './identity.js'
import { capturePersonalSignal } from './personal-signals.js'
import {
  ROUTE_STATE_VERSION,
  navIdToRouteTab,
  normalizeRouteState,
  parseRouteQuery,
  routeTabToNavId,
  serializeRouteHref,
  validRouteIdentity,
} from './route-state.js'
import { dayIdAt } from '../../shared/city-time.mjs'

// the tab roster — ids are the stable identity, INDICES ARE DERIVED (audit
// prep #1: nothing may hardcode a position). Sprint O1: four populated tabs.
// 'hot' keeps its internal id (CSS .tab-hot, openers, taste seams all key on
// it) but wears the "Events" label — ⚑O1 placeholder pending Charles.
// Adding the fifth (Locations, Sprint S) = ONE entry here + ONE lazy-mounted
// <section> in App.jsx's pager — everything else (tab bar, lazy mounting,
// pager CSS, dice/🎨 gates, Escape) derives. Icon.locations is
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
// split out of the old Events/hot tab. THE MAP IS PARKED FOR v1 (Stage A5 / D8):
// there is no Map tab and no {type:'map'} sub-view — place locations route out
// to Google Maps via the detail Directions link. Indices stay derived (nothing
// hardcodes a position).
export const VIEWS = [
  { id: 'home', label: 'Home' },
  { id: 'hot', label: 'Events' },
  { id: 'locations', label: 'Spots' },
  { id: 'calendar', label: 'Plan' }, /* ruling 2026-07-01 #4: back to the refs' "Plan"
                                        (reverses S1-C1's Calendar rename); id stays
                                        'calendar' for every seam that keys on it */
  { id: 'profile', label: 'Profile' },
]
export const viewIndex = (id) => VIEWS.findIndex((v) => v.id === id)

const supportsVT = () =>
  typeof document !== 'undefined' &&
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

const NavContext = createContext(null)

const ROUTE_QUERY_KEYS = Object.freeze(['city', 'tab', 'event', 'place', 'guide', 'day', 'shared'])

function tabRoute(cityId, navId = 'home') {
  const tab = navIdToRouteTab(navId) || 'home'
  return normalizeRouteState({ v: ROUTE_STATE_VERSION, cityId, tab, target: null })
}

function initialRouteSnapshot({ cityId, search = '', hash = '' }) {
  const params = new URLSearchParams(String(search).replace(/^\?/, ''))
  const ownsQuery = ROUTE_QUERY_KEYS.some((key) => params.has(key))
  if (!ownsQuery) return Object.freeze({ route: tabRoute(cityId), fragment: '', issue: null })
  const parsed = parseRouteQuery(search)
  if (!parsed.ok) {
    return Object.freeze({
      route: tabRoute(cityId),
      fragment: '',
      issue: Object.freeze({ status: 'unavailable', code: parsed.code }),
    })
  }
  if (parsed.route.cityId !== cityId) {
    return Object.freeze({
      route: tabRoute(cityId),
      fragment: '',
      issue: Object.freeze({
        status: 'unavailable',
        code: 'ROUTE_CITY_UNAVAILABLE',
        requestedCityId: parsed.route.cityId,
        activeCityId: cityId,
      }),
    })
  }
  return Object.freeze({
    route: parsed.route,
    fragment: parsed.route.target?.kind === 'shared-plan' ? String(hash || '') : '',
    issue: null,
  })
}

function routeForPage(city, activeNavId, page) {
  const base = tabRoute(city.id, activeNavId)
  if (!base || !page) return base
  let target = null
  if (page.type === 'guide') {
    const raw = typeof page.guide?.id === 'string' ? page.guide.id : ''
    const id = raw.startsWith('g|') ? raw : `g|${raw}`
    if (validRouteIdentity('guide', id)) target = { kind: 'guide', id }
  } else if (page.type === 'day' && Number.isFinite(page.ts)) {
    target = { kind: 'day', day: dayIdAt(page.ts, city.tz) }
  } else if (page.type === 'sharedplan') {
    target = { kind: 'shared-plan' }
  }
  return normalizeRouteState({ ...base, target }) || base
}

function routeForDetail(city, activeNavId, detail) {
  const base = tabRoute(city.id, activeNavId)
  if (!base || !detail) return base
  const kind = detail.kind === 'place' ? 'place' : 'event'
  const id = primaryKeyOf(detail)
  return validRouteIdentity(kind, id)
    ? normalizeRouteState({ ...base, target: { kind, id } })
    : base
}

function sameRoute(left, right) {
  return Boolean(left && right && JSON.stringify(left) === JSON.stringify(right))
}

export function useNav() {
  return useContext(NavContext)
}

export function NavProvider({ children, city, baseUrl = '/' }) {
  const { recordView } = useActivity()
  const [initial] = useState(() => initialRouteSnapshot({
    cityId: city.id,
    search: window.location.search,
    hash: window.location.hash,
  }))
  const initialNavId = routeTabToNavId(initial.route.tab) || 'home'
  const initialActive = Math.max(0, viewIndex(initialNavId))
  const [existingDepth] = useState(() => (
    window.history.state?.wzRoute === ROUTE_STATE_VERSION
      && Number.isInteger(window.history.state?.wzDepth)
      && window.history.state.wzDepth >= 0
      ? window.history.state.wzDepth
      : null
  ))
  const [initialDepth] = useState(
    () => existingDepth ?? (initial.issue === null && initial.route.target !== null ? 1 : 0),
  )
  const [initialPage] = useState(() => initial.issue === null
    ? null
    : Object.freeze({
      type: 'route-unavailable',
      outcome: initial.issue,
      requestedRoute: null,
    }))
  const histDepthRef = useRef(initialDepth)
  const detailOpenRef = useRef(false)
  const pageOpenRef = useRef(false)
  const currentRouteRef = useRef(initial.route)
  const routeRequestIdRef = useRef(initial.issue === null && initial.route.target !== null ? 1 : 0)
  const skipPageHistoryRef = useRef(initialPage)
  const skipDetailHistoryRef = useRef(null)
  const [routeIntent, setRouteIntent] = useState(() => (
    initial.issue === null && initial.route.target !== null
      ? Object.freeze({
        id: 1,
        route: initial.route,
        fragment: initial.fragment,
        historyDepth: initialDepth,
        preservePage: false,
      })
      : null
  ))
  // ===== active tab + pager =====
  const [active, setActive] = useState(initialActive)
  // ===== lazy tab mounting (O1): the pager's section SHELLS always render
  // (scroll-snap needs all N widths), but a tab's CHILDREN mount on its FIRST
  // visit only — the boot tab is seeded, so boot renders exactly one tab's
  // tree (strictly less work than the old eager three-tab boot; the smoke
  // harness asserts the gates exist). The set only ever grows: a visited tab
  // stays mounted so its state (map instance, calendar selection) survives
  // tab hops. Visits are recorded INSIDE the two tab-changing handlers (goTo /
  // onPagerScroll) — event-driven, not an effect; a swipe counts the moment
  // the page crosses halfway (Math.round), so it mounts mid-gesture. =====
  const [visited, setVisited] = useState(() => new Set([VIEWS[initialActive].id]))
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
  const hrefForRoute = useCallback((route, fragment = '') => {
    const suffix = route?.target?.kind === 'shared-plan' ? fragment : ''
    return `${serializeRouteHref(route, { baseUrl })}${suffix}`
  }, [baseUrl])
  const writeRoute = useCallback((route, {
    mode = 'push',
    depth = histDepthRef.current,
    fragment = '',
  } = {}) => {
    const normalized = normalizeRouteState(route)
    if (!normalized || normalized.cityId !== city.id) return false
    const href = hrefForRoute(normalized, fragment)
    if (mode === 'replace') {
      window.history.replaceState(
        { wzDepth: depth, wzRoute: ROUTE_STATE_VERSION },
        '',
        href,
      )
    } else {
      window.history.pushState(
        { wzDepth: depth, wzRoute: ROUTE_STATE_VERSION },
        '',
        href,
      )
    }
    currentRouteRef.current = normalized
    return true
  }, [city.id, hrefForRoute])

  // Canonicalize the current static-deployment address once. A first visit to
  // a durable target receives an in-app tab entry underneath it, so Back from
  // a refreshed/shared detail stays inside Wuzup. Reloads retain the marker and
  // replace in place instead of growing the history stack.
  useEffect(() => {
    if (initial.issue !== null) return
    const target = initial.route.target
    if (target !== null && existingDepth === null) {
      const base = normalizeRouteState({ ...initial.route, target: null })
      window.history.replaceState(
        { wzDepth: 0, wzRoute: ROUTE_STATE_VERSION },
        '',
        hrefForRoute(base),
      )
      window.history.pushState(
        { wzDepth: 1, wzRoute: ROUTE_STATE_VERSION },
        '',
        hrefForRoute(initial.route, initial.fragment),
      )
      histDepthRef.current = 1
    } else {
      writeRoute(initial.route, {
        mode: 'replace',
        depth: initialDepth,
        fragment: initial.fragment,
      })
    }
  }, [existingDepth, hrefForRoute, initial, initialDepth, writeRoute])
  const goTo = useCallback(
    (i) => {
      setActive(i)
      visit(i)
      const p = pagerRef.current
      // instant jump: never slide through intermediate pages (finger-swipe snap unaffected)
      if (p) p.scrollTo({ left: i * p.clientWidth, behavior: 'instant' })
      // PREMIUM A4 (motion#10): a fast content settle on TAP nav only (swipe goes
      // through onPagerScroll, which never calls goTo). Reduced-motion stills it
      // via the CSS reset. Reflow restart so re-tapping the same tab replays it.
      const child = p && p.children[i]
      if (child) {
        // N1: reset scroll to top on tab change (incl. an active re-tap) — both
        // container shapes: the .page itself, and a .hot-scroll nested inside it.
        child.scrollTop = 0
        const hs = child.querySelector('.hot-scroll')
        if (hs) hs.scrollTop = 0
        child.classList.remove('tab-settle')
        void child.offsetWidth
        child.classList.add('tab-settle')
      }

      // A tab is the base URL-visible state. Covered layers normally make the
      // tab bar inert; the ref guard also prevents programmatic tab changes
      // from rewriting a still-open page/detail entry.
      if (!pageOpenRef.current && !detailOpenRef.current) {
        const nextRoute = tabRoute(city.id, VIEWS[i]?.id)
        if (nextRoute && !sameRoute(currentRouteRef.current, nextRoute)) {
          histDepthRef.current = 0
          writeRoute(nextRoute, { mode: 'push', depth: 0 })
        }
      }
    },
    [city.id, visit, writeRoute]
  )
  const onPagerScroll = useCallback(() => {
    const p = pagerRef.current
    if (!p) return
    const i = Math.round(p.scrollLeft / p.clientWidth)
    setActive((prev) => (i !== prev ? i : prev))
    visit(i)
    if (!pageOpenRef.current && !detailOpenRef.current) {
      const nextRoute = tabRoute(city.id, VIEWS[i]?.id)
      if (nextRoute && !sameRoute(currentRouteRef.current, nextRoute)) {
        histDepthRef.current = 0
        writeRoute(nextRoute, { mode: 'replace', depth: 0 })
      }
    }
  }, [city.id, visit, writeRoute])

  // ===== subpage overlay: null | {type:'bubble',bubble} |
  // {type:'placebubble',bubble} (Sprint S) | {type:'search'} |
  // {type:'add',ts} | {type:'day',ts} | {type:'settings'} |
  // {type:'interests',from} | {type:'taste',from} (Sprint V — why-feed +
  // mute/boost) | {type:'deck',from} | {type:'lensdeck',lens} |
  // {type:'attribution'} (Stage E ⚑X3 — Settings → Data & photo credits) —
  // slides in over the active tab (z 1500, below detail 2000). Sprint P added
  // settings (Profile's gear) and the calibration deck (launched FROM
  // settings — they stack by replacing the page, and their back/finish
  // affordances reopen settings, so "one level deep" stays true in feel while
  // the union stays flat in state). Sprint Q2 added lensdeck (the finite
  // "Deck this" mode) on the same replace-the-page pattern (a bubble-lens
  // deck's back affordance reopens its bubble without recording navigation as
  // preference) and Q2c swapped the retired 7-screen interview for interests (the
  // InterestEditor) — both interests and deck carry a `from` origin so their
  // back affordances return where the user actually came from. =====
  const [page, setPage] = useState(initialPage)
  const [pageClosing, setPageClosing] = useState(false)
  const pageTRef = useRef(null)
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
  // Sprint S: a tapped Locations bubble → a full PlaceBubblePage (the place-side
  // twin of openBubble). This is navigation only; preference comes from
  // retained save/plan/deck actions. `bubble` is a PLACE_BUBBLES entry.
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
  // (Josh: remove the dice). C5: fmnseen.js deleted too — its writes had no
  // reader; recordSignal('fmn') in taste.js is now caller-less (left as a seam).
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
  // Plan Phase 2: the DayPage day-selector's date picker ({type:'calpicker',ts}).
  // `ts` is the day currently being planned (to highlight); selecting a date in
  // the picker calls openDay, which REPLACES this page (single-slot union — the
  // picker is one level deep, never stacked). Additive subpage, same pattern as
  // openDay/openAdd; a non-numeric ts is ignored (defaults to today inside).
  const openCalendarPicker = useCallback((ts) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'calpicker', ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : null })
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
  // EVENTS_PHASE2: the Events Filters bottom-sheet (When · Price · Category).
  const openEvFilters = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'evfilters' })
  }, [])
  // Stage E (⚑X3): the Data & photo credits page — opened from Settings' About
  // section. Single-slot REPLACE (same pattern as openSettings): its back
  // affordance reopens Settings, so "one level deep" stays true in feel.
  const openAttribution = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'attribution' })
  }, [])
  const openDataTransfer = useCallback(() => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    setPage({ type: 'datatransfer' })
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
  // TINDER: openDeck takes EITHER a legacy origin string (back-compat) OR an object
  // { kind, origin } — the "Tune your taste" modules pass { kind:'places'|'events',
  // origin:'spots'|'events' }. kind defaults to 'events'; a new 'events'/'spots'
  // origin closes to the tab (closePage), Settings stays the historical default.
  const openDeck = useCallback((arg) => {
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    const isObj = typeof arg === 'object' && arg !== null
    const origin = isObj ? arg.origin : arg
    const kind = isObj && arg.kind === 'places' ? 'places' : 'events'
    const from = ['primer', 'profile', 'events', 'spots'].includes(origin) ? origin : 'settings'
    setPage({ type: 'deck', kind, from })
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
  // the REAL page close (animation owner) — flips its open-ref at INITIATION so
  // the history layer (WS2 below) sees the close immediately, not 400ms later.
  const closePageNow = useCallback(() => {
    pageOpenRef.current = false
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
  const openEditEvent = useCallback((event) => {
    if (!event || typeof event !== 'object') return
    const editPage = { type: 'add', ts: null, editEvent: event }
    clearTimeout(pageTRef.current)
    setPageClosing(false)
    if (detailOpenRef.current) {
      detailOpenRef.current = false
      setClosing(false)
      setVtOpen(false)
      setDetail(null)
      skipPageHistoryRef.current = editPage
      writeRoute(routeForPage(city, VIEWS[active]?.id, editPage), {
        mode: 'replace',
        depth: histDepthRef.current,
      })
    }
    setPage(editPage)
  }, [active, city, writeRoute])
  const openDetail = useCallback((e, cardEl) => {
    // The current recap is event-only. Place views stay out of its bounded FIFO
    // until Wuzup ships a kind-correct place-history surface.
    if (e?.kind !== 'place') {
      // Navigation never waits on storage, but taste waits on the exact Activity
      // result: a failed/no-op retained view cannot manufacture a fresh signal.
      void recordView(e)
        .then((result) => capturePersonalSignal('open', e, { source: 'activity', result }))
        .catch(() => {})
    }
    setClosing(false)
    const el = cardEl ? cardEl.querySelector('[data-vt]') : null
    if (supportsVT() && el) {
      morphElRef.current = el
      el.style.viewTransitionName = 'evt-hero' // old snapshot: the card image owns the name
      const t = document.startViewTransition(() => {
        el.style.viewTransitionName = '' // new snapshot: only the detail hero owns it
        flushSync(() => {
          setVtOpen(true)
          setDetail(e)
        })
      })
      // C5: an aborted transition (tab hidden mid-flight, UA skip, a second open
      // interrupting) REJECTS `ready` — unhandled, that's an uncaught exception on
      // real user paths. The morph just skips; the update callback (name handoff +
      // state) runs either way, so swallowing is the complete handling.
      t.ready.catch(() => {})
    } else {
      morphElRef.current = null
      setVtOpen(false)
      setDetail(e)
    }
  }, [recordView])
  // the REAL detail close (animation owner) — see closePageNow's ref note.
  const closeDetailNow = useCallback(() => {
    detailOpenRef.current = false
    const el = morphElRef.current
    if (vtOpen && supportsVT()) {
      const t = document.startViewTransition(() => {
        flushSync(() => setDetail(null))
        if (el && el.isConnected) el.style.viewTransitionName = 'evt-hero'
      })
      t.ready.catch(() => {}) // C5: aborts reject `ready` — expected, never uncaught
      // C5: catch BEFORE finally — a rejected `finished` (update-callback throw)
      // would otherwise re-surface as a second unhandled rejection after cleanup.
      t.finished.catch(() => {}).finally(() => {
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

  // ===== Cohesion WS2 (app-feel): the hardware/browser BACK button =====
  // The app had ZERO history integration — Android/browser back EXITED the app
  // with layers open (the #1 "webpage, not app" tell). Design: one history
  // entry per open LAYER (page z1500, detail z2000), pushed by effects watching
  // the layer states (every open* path covered, no per-callback edits), and
  // ALL closes flow through popstate — the public closeDetail/closePage below
  // are history-consuming PROXIES (history.back() → the popstate handler runs
  // the real close), so the history depth can never desync from the open-layer
  // count, even under rapid UI-close + hardware-back races. pushState carries
  // only a {wzDepth} marker — the URL never changes; deep links / refresh-
  // restore are deliberately out of scope (BACKLOG). A multi-entry jump (back
  // long-press) closes layers down to the landed depth, detail-first — the
  // same order as the Escape ladder. Page REPLACE (the single-slot union's
  // settings→interests hop) keeps its ONE entry: back closes the current page,
  // matching the "one level deep in feel" contract. Known edges, accepted:
  // the first-run Primer is App-level (not a page) so back during it behaves
  // natively; dev-HMR remounts reset the refs while marker entries persist
  // (one extra back press, dev-only). StrictMode double-effects are guarded by
  // the open-ref boundary checks. (The refs themselves are declared above the
  // Now-closers, which flip them at close initiation.)
  useEffect(() => {
    if (page !== null) {
      const restored = skipPageHistoryRef.current === page
      skipPageHistoryRef.current = null
      if (!pageOpenRef.current) {
        pageOpenRef.current = true
        if (!restored) {
          histDepthRef.current++
          writeRoute(routeForPage(city, VIEWS[active]?.id, page), {
            mode: 'push',
            depth: histDepthRef.current,
          })
        }
      } else if (!restored) {
        writeRoute(routeForPage(city, VIEWS[active]?.id, page), {
          mode: 'replace',
          depth: histDepthRef.current,
        })
      }
    } else pageOpenRef.current = false
  }, [active, city, page, writeRoute])
  useEffect(() => {
    if (detail !== null) {
      const restored = skipDetailHistoryRef.current === detail
      skipDetailHistoryRef.current = null
      if (!detailOpenRef.current) {
        detailOpenRef.current = true
        if (!restored) {
          histDepthRef.current++
          writeRoute(routeForDetail(city, VIEWS[active]?.id, detail), {
            mode: 'push',
            depth: histDepthRef.current,
          })
        }
      } else if (!restored) {
        writeRoute(routeForDetail(city, VIEWS[active]?.id, detail), {
          mode: 'replace',
          depth: histDepthRef.current,
        })
      }
    } else detailOpenRef.current = false
  }, [active, city, detail, writeRoute])
  useEffect(() => {
    const onPop = (ev) => {
      const target = typeof ev.state?.wzDepth === 'number' ? Math.max(0, ev.state.wzDepth) : 0
      const snapshot = initialRouteSnapshot({
        cityId: city.id,
        search: window.location.search,
        hash: window.location.hash,
      })
      if (snapshot.issue) {
        const unavailable = Object.freeze({
          type: 'route-unavailable',
          outcome: snapshot.issue,
          requestedRoute: null,
        })
        skipPageHistoryRef.current = unavailable
        skipDetailHistoryRef.current = null
        setPage(unavailable)
        setDetail(null)
        setRouteIntent(null)
        histDepthRef.current = target
        return
      }

      currentRouteRef.current = snapshot.route
      const navId = routeTabToNavId(snapshot.route.tab) || 'home'
      const index = Math.max(0, viewIndex(navId))
      setActive(index)
      visit(index)
      const pager = pagerRef.current
      if (pager) pager.scrollTo({ left: index * pager.clientWidth, behavior: 'instant' })
      let open = (detailOpenRef.current ? 1 : 0) + (pageOpenRef.current ? 1 : 0)
      histDepthRef.current = target
      if (snapshot.route.target !== null) {
        setRouteIntent(Object.freeze({
          id: ++routeRequestIdRef.current,
          route: snapshot.route,
          fragment: snapshot.fragment,
          historyDepth: target,
          preservePage: pageOpenRef.current && target > 1,
        }))
        return
      }
      setRouteIntent(null)
      if (open > target && detailOpenRef.current) {
        closeDetailNow()
        open--
      }
      if (open > target && pageOpenRef.current) closePageNow()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [city.id, closeDetailNow, closePageNow, visit])
  // the public closers every consumer calls — consume our history entry so the
  // real close runs through popstate; fall back to a direct close if the depth
  // ever desyncs (belt-and-braces, e.g. an open landing inside a close window).
  const closeDetail = useCallback(() => {
    if (!detailOpenRef.current) return
    if (histDepthRef.current > 0) window.history.back()
    else {
      writeRoute(tabRoute(city.id, VIEWS[active]?.id), { mode: 'replace', depth: 0 })
      closeDetailNow()
    }
  }, [active, city.id, closeDetailNow, writeRoute])
  const closePage = useCallback(() => {
    if (!pageOpenRef.current) return
    if (histDepthRef.current > 0) window.history.back()
    else {
      writeRoute(tabRoute(city.id, VIEWS[active]?.id), { mode: 'replace', depth: 0 })
      closePageNow()
    }
  }, [active, city.id, closePageNow, writeRoute])

  // App resolves a durable target only after the corresponding verified city
  // catalog is ready. This handoff opens that resolved object without adding a
  // second history entry: the query-string entry already represents the layer.
  const settleRouteIntent = useCallback((requestId, result) => {
    if (!routeIntent || routeIntent.id !== requestId) return false
    const resolved = result?.status === 'resolved'
    if (resolved && result.detail) {
      clearTimeout(pageTRef.current)
      setPageClosing(false)
      if (!routeIntent.preservePage) {
        pageOpenRef.current = false
        setPage(null)
      }
      skipDetailHistoryRef.current = result.detail
      setClosing(false)
      setVtOpen(false)
      setDetail(result.detail)
    } else {
      const nextPage = resolved && result?.page
        ? result.page
        : Object.freeze({
          type: 'route-unavailable',
          outcome: result?.outcome || Object.freeze({
            status: 'unavailable',
            code: 'ROUTE_TARGET_UNAVAILABLE',
          }),
          requestedRoute: routeIntent.route,
        })
      detailOpenRef.current = false
      setDetail(null)
      clearTimeout(pageTRef.current)
      setPageClosing(false)
      skipPageHistoryRef.current = nextPage
      setPage(nextPage)
    }
    setRouteIntent(null)
    return true
  }, [routeIntent])

  const absoluteHref = useCallback((route, fragment = '') => (
    new URL(hrefForRoute(route, fragment), window.location.origin).href
  ), [hrefForRoute])
  const durableHrefForItem = useCallback((item) => {
    const navId = item?.kind === 'place' ? 'locations' : 'hot'
    const route = routeForDetail(city, navId, item)
    return route.target ? absoluteHref(route) : null
  }, [absoluteHref, city])
  const durableHrefForDay = useCallback((dayTs) => {
    if (!Number.isFinite(dayTs)) return absoluteHref(tabRoute(city.id, 'calendar'))
    return absoluteHref(normalizeRouteState({
      ...tabRoute(city.id, 'calendar'),
      target: { kind: 'day', day: dayIdAt(dayTs, city.tz) },
    }))
  }, [absoluteHref, city])
  const durableHrefForSharedPlan = useCallback((fragment) => absoluteHref(
    normalizeRouteState({
      ...tabRoute(city.id, 'calendar'),
      target: { kind: 'shared-plan' },
    }),
    fragment,
  ), [absoluteHref, city.id])

  // D8: openMap / focusMap / the mapFocus handoff (the Map sub-view) are parked for
  // v1 — removed. Place detail routes to Google Maps via its Directions link.

  // Escape closes the topmost layer: detail first, then any open subpage
  // (bubble phase — PickerSheet's capture-phase handler runs first)
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
      openAdd,
      openEditEvent,
      openDay,
      openCalendarPicker,
      openSettings,
      openMyPlans,
      openMySaves,
      openEditProfile,
      openHelpFeedback,
      openForecast,
      openNotifications,
      openEvFilters,
      openAttribution,
      openDataTransfer,
      openInterests,
      openTaste,
      openDeck,
      openLensDeck,
      closePage,
      // durable routes
      routeIntent,
      settleRouteIntent,
      durableHrefForItem,
      durableHrefForDay,
      durableHrefForSharedPlan,
      // detail
      detail,
      closing,
      vtOpen,
      openDetail,
      closeDetail,
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
      openAdd,
      openEditEvent,
      openDay,
      openCalendarPicker,
      openSettings,
      openMyPlans,
      openMySaves,
      openEditProfile,
      openHelpFeedback,
      openForecast,
      openNotifications,
      openEvFilters,
      openAttribution,
      openDataTransfer,
      openInterests,
      openTaste,
      openDeck,
      openLensDeck,
      closePage,
      routeIntent,
      settleRouteIntent,
      durableHrefForItem,
      durableHrefForDay,
      durableHrefForSharedPlan,
      detail,
      closing,
      vtOpen,
      openDetail,
      closeDetail,
    ]
  )

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}
