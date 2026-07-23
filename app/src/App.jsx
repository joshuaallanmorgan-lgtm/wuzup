// App — the DATA shell: events fetch + normalize, anchors, weather, my-events,
// shared location state, and the primer gate. All
// NAVIGATION state (active tab, subpage union, detail open/close + VT morph,
// map focus) lives in nav.js (Sprint O6) — components reach it via useNav().
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, currentEvents, keyOf, makeAnchors, normalize } from './lib.js'
import { dayStamp } from './coverage.js'
import { useArtifact } from './artifacts.js'
import { NavProvider, VIEWS, useNav } from './nav.jsx'
import { LocationProvider, useLocationPermission } from './LocationProvider.jsx'
import { PlannerProvider } from './PlannerProvider.jsx'
import { CustomEventsProvider, useCustomEvents } from './CustomEventsProvider.jsx'
import { SavedBeenProvider, useSavedBeen } from './SavedBeenProvider.jsx'
import { ActivityProvider, useActivity } from './ActivityProvider.jsx'
import { bindRuntimeCityArtifact } from './runtime-city.js'
import { useRuntimeCity } from './RuntimeCityProvider.jsx'
import { identitySeedsForCity } from './identity-seeds.js'
import { GUIDES } from './guides.js'
import { normalizePlace } from './places.js'
import { resolveRouteState } from './route-resolution.js'
import { parsePlanCapsuleFragment } from './plan-capsule.js'
import { cityMidnightMs } from '../../shared/city-time.mjs'
import Primer, { loadPrimerState } from './Primer.jsx'
import { WxContext, CardToastHost } from './cards.jsx'
import {
  ageForecastState,
  getForecast,
  WEATHER_CACHE_MAX_AGE_MS,
  WEATHER_FRESH_MAX_AGE_MS,
  WEATHER_STATUS,
} from './weather.js'
import HomeView from './HomeView.jsx'
import './App.css'

// Sprint 10: Home stays eager for first value. The other tabs, drill-ins,
// details, and decks load only when opened, while their pager shells remain
// mounted so navigation geometry and retained tab state stay stable.
const HotView = lazy(() => import('./HotView.jsx'))
const LocationsView = lazy(() => import('./LocationsView.jsx'))
const CalendarView = lazy(() => import('./CalendarView.jsx'))
const ProfileView = lazy(() => import('./ProfileView.jsx'))
const MyPlansPage = lazy(() => import('./MyPlansPage.jsx'))
const MySavesPage = lazy(() => import('./MySavesPage.jsx'))
const EditProfilePage = lazy(() => import('./EditProfilePage.jsx'))
const HelpFeedbackPage = lazy(() => import('./HelpFeedbackPage.jsx'))
const ForecastPage = lazy(() => import('./ForecastPage.jsx'))
const NotificationsPage = lazy(() => import('./NotificationsPage.jsx'))
const FiltersSheet = lazy(() => import('./FiltersSheet.jsx'))
const DetailPage = lazy(() => import('./DetailPage.jsx'))
const PlaceDetail = lazy(() => import('./PlaceDetail.jsx'))
const BubblePage = lazy(() => import('./BubblePage.jsx'))
const PlaceBubblePage = lazy(() => import('./PlaceBubblePage.jsx'))
const GuidePage = lazy(() => import('./GuidePage.jsx'))
const SearchPage = lazy(() => import('./SearchPage.jsx'))
const AddEvent = lazy(() => import('./AddEvent.jsx'))
const DayPage = lazy(() => import('./DayPage.jsx'))
const CalendarPickerPage = lazy(() => import('./CalendarPickerPage.jsx'))
const SettingsPage = lazy(() => import('./SettingsPage.jsx'))
const AttributionPage = lazy(() => import('./AttributionPage.jsx'))
const SharedPlanPage = lazy(() => import('./SharedPlanPage.jsx'))
const DataTransferRoute = lazy(() => import('./DataTransferRoute.jsx'))
const InterestEditor = lazy(() => import('./InterestEditor.jsx'))
const TastePanel = lazy(() => import('./TastePanel.jsx'))
const CalibrationDeck = lazy(() => import('./CalibrationDeck.jsx'))
const PlacesDeck = lazy(() => import('./CalibrationDeck.jsx').then(module => ({ default: module.PlacesDeck })))
const LensDeck = lazy(() => import('./LensDeck.jsx'))

function SurfaceLoading({ detail = false }) {
  return (
    <div
      className={detail ? 'detail detail-loading-layer' : 'surface-loading'}
      role="status"
      aria-live="polite"
      aria-label="Loading this view"
      tabIndex={detail ? -1 : undefined}
    >
      <span className="surface-loading-mark" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  )
}

function TabBar({ active, onTab, inert, hidden }) {
  return (
    <nav className="tabbar" inert={inert} aria-hidden={hidden} aria-label="Primary navigation">
      {VIEWS.map((v, i) => {
        const I = Icon[v.id]
        return (
          <button
            key={v.id}
            className={'tab' + (active === i ? ' active' : '') + (v.id === 'hot' ? ' tab-hot' : '')}
            onClick={() => onTab(i)}
            aria-current={active === i ? 'page' : undefined}
          >
            <I className="tab-ic" width="24" height="24" />
            <span className="tab-label">{v.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// Artifact acquisition, bounded retry, exact-byte verification, and immutable
// freshness live in artifacts.js. App consumes its public state only.
const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusLayer(root, preferred) {
  if (!root) return
  const active = document.activeElement
  // A Suspense fallback may leave focus on the stable layer wrapper itself.
  // That is a staging state, not proof that focus reached resolved content.
  if (active !== root && root.contains(active)) return
  const target =
    (preferred ? root.querySelector(preferred) : null) ||
    root.querySelector('[data-initial-focus]') ||
    root.querySelector('[autofocus]') ||
    root.querySelector(FOCUSABLE) ||
    root
  target.focus?.({ preventScroll: true })
}

function EventUnavailablePage({ status, meta, onBack, recover, recoverLabel }) {
  const generated = meta?.generatedAt ? Date.parse(meta.generatedAt) : null
  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onBack} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Events unavailable</h1>
      </header>
      <div className="empty" role="alert">
        {status === 'stale'
          ? `Listings from ${Number.isFinite(generated) ? dayStamp(generated) : 'the last refresh'} are too old to show.`
          : status === 'offline'
            ? 'You’re offline. Event listings weren’t loaded.'
            : 'Event listings couldn’t be verified right now.'}
        {recover && <button className="empty-cta" onClick={recover}>{recoverLabel}</button>}
      </div>
    </div>
  )
}

function RouteUnavailablePage({ outcome, onBack }) {
  const code = outcome?.code || 'ROUTE_TARGET_UNAVAILABLE'
  const cityMismatch = code === 'ROUTE_CITY_UNAVAILABLE'
  const ambiguous = code === 'ROUTE_ITEM_AMBIGUOUS'
  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onBack} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Link unavailable</h1>
      </header>
      <div className="empty" role="alert">
        {cityMismatch
          ? 'This link belongs to a different Wuzup coverage area.'
          : ambiguous
            ? 'This link matches more than one current listing, so Wuzup did not guess.'
            : 'This saved link no longer matches a current item in this coverage area.'}
      </div>
    </div>
  )
}

function restoreLayerFocus(target, fallbackRoot) {
  const validTarget = target?.isConnected && !target.closest?.('[inert]') ? target : null
  const fallback =
    fallbackRoot?.querySelector?.('[aria-current="page"]') ||
    fallbackRoot?.querySelector?.(FOCUSABLE) ||
    fallbackRoot
  ;(validTarget || fallback)?.focus?.({ preventScroll: true })
}
// the banner's day label (weekday <6d, date beyond) lives in coverage.js now —
// dayStamp — shared with the D-G1 Coverage Card's "updated {day}" line.

export default function App() {
  const runtimeCity = useRuntimeCity()
  const { city } = runtimeCity
  return (
    <CustomEventsProvider city={city}>
      <ActivityProvider city={city}>
        <NavProvider city={city} baseUrl={runtimeCity.baseUrl}>
          <LocationProvider city={city}>
            <Shell />
          </LocationProvider>
        </NavProvider>
      </ActivityProvider>
    </CustomEventsProvider>
  )
}

function noticeStackClass(stackLevel) {
  if (stackLevel > 2) return ' is-triple-stacked'
  if (stackLevel > 1) return ' is-double-stacked'
  if (stackLevel === 1) return ' is-stacked'
  return ''
}

function SavedBeenNotice({ visible, layered, stackLevel = 0 }) {
  const savedBeen = useSavedBeen()
  if (!visible || !['session-only', 'corrupt', 'error'].includes(savedBeen.status)) return null

  return (
    <div
      className={'load-note' + (layered ? ' is-layered' : '') + noticeStackClass(stackLevel)}
      role={savedBeen.status === 'session-only' ? 'status' : 'alert'}
    >
      <span className="load-txt">
        {savedBeen.status === 'session-only'
          ? "Your saves and Been history are here for this visit, but haven't been saved yet."
          : 'Your saves and Been history could not be loaded.'}
      </span>
      {savedBeen.status === 'session-only' && (
        <button className="load-retry" onClick={() => savedBeen.retryPersistence()}>
          Try saving again
        </button>
      )}
    </div>
  )
}

function ActivityNotice({ visible, layered, stackLevel = 0 }) {
  const activity = useActivity()
  const savedBeen = useSavedBeen()
  if (!visible || !['session-only', 'corrupt', 'error'].includes(activity.status)) return null

  const savedVisible = ['session-only', 'corrupt', 'error'].includes(savedBeen.status)
  const retry = activity.retryPersistence || activity.retry
  const canRetry = typeof retry === 'function' && activity.recovery?.canRetry === true
  return (
    <div
      className={'load-note'
        + (layered ? ' is-layered' : '')
        + noticeStackClass(stackLevel + Number(savedVisible))}
      role={activity.status === 'session-only' ? 'status' : 'alert'}
    >
      <span className="load-txt">
        {activity.status === 'session-only'
          ? "Recent views and deck history are here for this visit, but haven't been saved yet."
          : 'Recent views and deck history could not be loaded.'}
      </span>
      {canRetry && (
        <button className="load-retry" onClick={() => retry()}>
          Try saving again
        </button>
      )}
    </div>
  )
}

function Shell() {
  const runtimeCity = useRuntimeCity()
  const city = runtimeCity.city
  const {
    active,
    goTo,
    attachPager,
    onPagerScroll,
    visited,
    page,
    pageClosing,
    openSettings,
    openDeck,
    closePage,
    closeDetail,
    detail,
    routeIntent,
    settleRouteIntent,
  } = useNav()
  const customEvents = useCustomEvents()
  const location = useLocationPermission()
  const coords = location.usableCoords
  const eventArtifact = useArtifact('events')
  // Subscribe without activating the lazy place artifact. This lets the shell
  // close a retained remote place detail if its verified snapshot expires or
  // fails while open, without adding a places fetch to app boot.
  const directPlaceRequested = routeIntent?.route?.target?.kind === 'place'
  const placeArtifact = useArtifact('places', directPlaceRequested)
  const events = useMemo(
    () => (Array.isArray(eventArtifact.data) ? eventArtifact.data : []),
    [eventArtifact.data]
  )
  const places = useMemo(
    () => (Array.isArray(placeArtifact.data?.places)
      ? placeArtifact.data.places.map(normalizePlace).filter(Boolean)
      : []),
    [placeArtifact.data]
  )
  const identitySeeds = useMemo(() => identitySeedsForCity(city.id), [city.id])
  const artifactBinding = useMemo(
    () => bindRuntimeCityArtifact(runtimeCity, eventArtifact.meta),
    [eventArtifact.meta, runtimeCity]
  )
  const loading = eventArtifact.status === 'idle' || eventArtifact.status === 'loading'
  const savedCatalogReady = ['ready', 'empty'].includes(eventArtifact.status) && customEvents.ready
  const savedCatalogError = !loading && !['ready', 'empty'].includes(eventArtifact.status)
    ? (eventArtifact.error || { code: `events-${eventArtifact.status}` })
    : customEvents.status !== 'initializing' && !customEvents.ready
      ? (customEvents.error || { code: `custom-events-${customEvents.status}` })
      : null
  const unavailable = ['stale', 'offline', 'error'].includes(eventArtifact.status)
  const placesUnavailable = ['stale', 'offline', 'error'].includes(placeArtifact.status)
  const transportError = eventArtifact.status === 'offline' || eventArtifact.status === 'error'
  const generatedAt = eventArtifact.meta?.generatedAt
  const dataAt = generatedAt ? Date.parse(generatedAt) : null
  const staleAt = eventArtifact.status === 'stale' && Number.isFinite(dataAt) ? dataAt : null
  const [bootVis, setBootVis] = useState(false) // boot overlay gated 300ms (no flash on fast loads)
  // Location permission, intent, and the session-only coordinate fix come from
  // one city-scoped controller. Only a currently granted fix reaches sorting.
  // H1 mood primer: mounts while no stored state exists (first open only).
  // Primer.jsx owns the primer store + the taste seeding; App only gates the
  // mount and passes the when-preference down for the H2 greeting flavor.
  const [primer, setPrimer] = useState(() => loadPrimerState())
  const appRef = useRef(null)
  const pageLayerRef = useRef(null)
  const pageReturnFocusRef = useRef(null)
  const pageFocusOpenRef = useRef(false)
  const detailReturnFocusRef = useRef(null)
  const detailFocusOpenRef = useRef(false)
  const baseTriggerRef = useRef(null)
  const pageTriggerRef = useRef(null)

  const remotePageBlocked = unavailable && Boolean(page) && (
    page.type === 'bubble'
    || page.type === 'notifications'
    || (page.type === 'guide' && page.guide?.domain === 'events')
    || (page.type === 'deck' && page.kind !== 'places')
    || page.type === 'lensdeck'
  )

  useEffect(() => {
    const remoteEventOpen = detail
      && detail.kind !== 'place'
      && !detail.tags?.includes('added-by-you')
    const remotePlaceOpen = detail?.kind === 'place'
    if ((unavailable && remoteEventOpen) || (placesUnavailable && remotePlaceOpen)) closeDetail()
  }, [closeDetail, detail, placesUnavailable, unavailable])

  // Remember both keyboard focus and pointer launchers. Some browsers do not
  // focus a clicked button, so pointer capture supplies a reliable return
  // target when a subpage or detail layer closes.
  const rememberTrigger = useCallback((ev) => {
    const target = ev.target instanceof Element ? ev.target.closest(FOCUSABLE) : null
    if (!(target instanceof HTMLElement) || target.closest('.detail')) return
    if (target.closest('.subpage')) pageTriggerRef.current = target
    else baseTriggerRef.current = target
  }, [])

  // Full-page overlays replace one another in a single DOM slot. Focus enters
  // each new page, but its original base-page launcher is retained until the
  // overlay actually unmounts after the close animation.
  useEffect(() => {
    const wasOpen = pageFocusOpenRef.current
    const isOpen = Boolean(page)
    if (isOpen && !wasOpen) {
      const active = document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body &&
        !document.activeElement.closest('.subpage')
        ? document.activeElement
        : null
      pageReturnFocusRef.current = baseTriggerRef.current?.isConnected ? baseTriggerRef.current : active
    }
    pageFocusOpenRef.current = isOpen

    let frame
    let observer
    if (isOpen) {
      const focusReadyPage = () => {
        const layer = pageLayerRef.current
        if (!layer || document.querySelector('.detail') || !layer.querySelector(FOCUSABLE)) return false
        focusLayer(layer)
        return true
      }
      frame = requestAnimationFrame(() => {
        if (focusReadyPage()) {
          observer?.disconnect()
        } else if (!document.querySelector('.detail')) {
          focusLayer(pageLayerRef.current)
        }
      })
      // Suspended route chunks first expose a stable page shell. When their
      // actual header/action mounts, complete the same first-focus contract an
      // eager route had without leaving focus stranded on the loading wrapper.
      observer = new MutationObserver(() => {
        if (focusReadyPage()) observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    } else if (wasOpen) {
      const target = pageReturnFocusRef.current
      pageReturnFocusRef.current = null
      frame = requestAnimationFrame(() => restoreLayerFocus(target, appRef.current))
    }
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [page])

  // Details stack above either the active tab or a subpage. Every new detail
  // receives focus at Back; closing restores the exact card/control that opened
  // it whenever that element still exists and is no longer inert.
  useEffect(() => {
    const wasOpen = detailFocusOpenRef.current
    const isOpen = Boolean(detail)
    if (isOpen && !wasOpen) {
      const active = document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body &&
        !document.activeElement.closest('.detail')
        ? document.activeElement
        : null
      const layerTrigger = page ? pageTriggerRef.current : baseTriggerRef.current
      detailReturnFocusRef.current = layerTrigger?.isConnected ? layerTrigger : active
    }
    detailFocusOpenRef.current = isOpen

    let frame
    let observer
    if (isOpen) {
      const focusReadyDetail = () => {
        const layer = document.querySelector('.detail:not(.detail-loading-layer)')
        if (!layer) return false
        focusLayer(layer, '.detail-back')
        return true
      }
      frame = requestAnimationFrame(() => {
        if (focusReadyDetail()) {
          observer?.disconnect()
        } else {
          document.querySelector('.detail-loading-layer')?.focus({ preventScroll: true })
        }
      })
      // A lazy detail may resolve after the first animation frame. Keep focus on
      // the honest loading layer, then move it into the real surface exactly once.
      observer = new MutationObserver(() => {
        if (focusReadyDetail()) observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    } else if (wasOpen) {
      const target = detailReturnFocusRef.current
      detailReturnFocusRef.current = null
      frame = requestAnimationFrame(() => restoreLayerFocus(target, pageLayerRef.current || appRef.current))
    }
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [detail, page])

  const recoverEvents = eventArtifact.recover
  const recoverEventsLabel = eventArtifact.recoverLabel
  useEffect(() => {
    const t = setTimeout(() => setBootVis(true), 300)
    return () => clearTimeout(t)
  }, [])
  // anchors must track the real clock: an app left open past midnight (or
  // resumed from background the next day) would otherwise show yesterday's
  // "Today". Recompute when the tab becomes visible and shortly after each
  // city midnight; event-end boundaries are scheduled separately below.
  const [anchors, setAnchors] = useState(() => makeAnchors())
  useEffect(() => {
    const refresh = () => setAnchors(makeAnchors())
    let midnightTimer
    const scheduleMidnight = () => {
      clearTimeout(midnightTimer)
      const clock = makeAnchors()
      const delay = Math.max(250, clock.nextMidnightMs + 1000 - Date.now())
      midnightTimer = setTimeout(() => {
        refresh()
        scheduleMidnight()
      }, delay)
    }
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      refresh()
      scheduleMidnight()
    }
    document.addEventListener('visibilitychange', onVis)
    refresh()
    scheduleMidnight()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearTimeout(midnightTimer)
    }
  }, [])
  // The city-bound custom-event provider owns migration, concurrency, and
  // durability. Its projected items join remote rows before the one shared
  // normalization path, so every existing event surface sees the same catalog.
  const normalized = useMemo(
    () => [...events, ...customEvents.items].map((event) => normalize(event, anchors)),
    [events, customEvents.items, anchors]
  )
  const norm = useMemo(() => currentEvents(normalized), [normalized])

  // A query route is only turned into UI after its exact, city-bound catalog
  // has reached a terminal state. Item resolution is identity-only: aliases,
  // titles, and nearby rows never substitute for the requested stable id.
  useEffect(() => {
    if (!routeIntent) return
    const target = routeIntent.route.target
    if (!target) return
    if (target.kind === 'event') {
      if (target.id.startsWith('c|')) {
        if (!customEvents.ready && customEvents.status === 'initializing') return
      } else if (['idle', 'loading'].includes(eventArtifact.status)) return
    }
    if (target.kind === 'place' && ['idle', 'loading'].includes(placeArtifact.status)) return

    const parsedCapsule = target.kind === 'shared-plan'
      ? parsePlanCapsuleFragment(routeIntent.fragment, {
        cityId: city.id,
        timeZone: city.tz,
      })
      : null
    const remoteEvents = currentEvents(normalized.slice(0, events.length))
    const routeCustomEvents = currentEvents(normalized.slice(events.length))
    const result = resolveRouteState(routeIntent.route, {
      activeCityId: city.id,
      timeZone: city.tz,
      catalogs: {
        cityId: city.id,
        timeZone: city.tz,
        events: remoteEvents,
        customEvents: routeCustomEvents,
        places,
        guides: GUIDES,
      },
      capsule: parsedCapsule?.ok ? parsedCapsule.capsule : null,
    })

    if (result.status !== 'resolved') {
      settleRouteIntent(routeIntent.id, { status: result.status, outcome: result })
      return
    }
    if (target.kind === 'event' || target.kind === 'place') {
      settleRouteIntent(routeIntent.id, { status: 'resolved', detail: result.item })
      return
    }
    if (target.kind === 'guide') {
      settleRouteIntent(routeIntent.id, {
        status: 'resolved',
        page: { type: 'guide', guide: result.item },
      })
      return
    }
    if (target.kind === 'day') {
      settleRouteIntent(routeIntent.id, {
        status: 'resolved',
        page: { type: 'day', ts: cityMidnightMs(target.day, city.tz) },
      })
      return
    }
    settleRouteIntent(routeIntent.id, {
      status: 'resolved',
      page: { type: 'sharedplan', capsule: result.value.capsule },
    })
  }, [
    city.id,
    city.tz,
    customEvents.items,
    customEvents.ready,
    customEvents.status,
    eventArtifact.status,
    events.length,
    normalized,
    placeArtifact.status,
    places,
    routeIntent,
    settleRouteIntent,
  ])

  useEffect(() => {
    const nowMs = Date.now()
    const nextActionabilityMs = normalized.reduce((next, event) => {
      if (event?._actionable !== true) return next
      const endAt = event?._time?.endAt
      return Number.isFinite(endAt) && endAt < next ? endAt : next
    }, Infinity)
    if (!Number.isFinite(nextActionabilityMs)) return undefined
    const delay = Math.min(2_147_000_000, Math.max(250, nextActionabilityMs + 1000 - nowMs))
    const timer = setTimeout(() => setAnchors(makeAnchors()), delay)
    return () => clearTimeout(timer)
  }, [normalized])

  // Weather has two deliberately separate paths. `wx` below is fresh-only and
  // is the sole value allowed into ranking, recommendation, and weather-fit
  // consumers. weatherState may retain a bounded stale map for Home's visibly
  // labelled display fallback, but that map never enters WxContext or a wx prop.
  const [weatherState, setWeatherState] = useState(() => ({
    status: 'loading',
    data: null,
    fetchedAt: null,
    source: null,
    error: null,
  }))
  const weatherRequestRef = useRef(0)
  const refreshWeather = useCallback(async () => {
    const requestId = ++weatherRequestRef.current
    let next
    try {
      next = await getForecast()
    } catch {
      next = {
        status: WEATHER_STATUS.ERROR,
        data: null,
        fetchedAt: null,
        source: null,
        error: { code: 'WEATHER_UNEXPECTED', message: 'Weather request failed', retryable: true },
      }
    }
    if (weatherRequestRef.current === requestId) setWeatherState(next)
  }, [])
  useEffect(() => {
    refreshWeather()
    return () => {
      weatherRequestRef.current += 1
    }
  }, [refreshWeather])

  // A forecast cannot remain decision-eligible merely because the tab stayed
  // open. At six hours it is demoted before revalidation; at 24 hours even the
  // labelled display fallback is removed.
  useEffect(() => {
    if (!Number.isFinite(weatherState.fetchedAt)) return undefined

    if (weatherState.status === WEATHER_STATUS.FRESH) {
      const delay = Math.max(0, weatherState.fetchedAt + WEATHER_FRESH_MAX_AGE_MS - Date.now())
      const timer = setTimeout(() => {
        setWeatherState((current) => ageForecastState(current, Date.now()))
        refreshWeather()
      }, delay)
      return () => clearTimeout(timer)
    }

    if (weatherState.status === WEATHER_STATUS.STALE) {
      const delay = Math.max(0, weatherState.fetchedAt + WEATHER_CACHE_MAX_AGE_MS - Date.now())
      const timer = setTimeout(() => {
        setWeatherState((current) => ageForecastState(current, Date.now()))
      }, delay)
      return () => clearTimeout(timer)
    }

    return undefined
  }, [refreshWeather, weatherState.fetchedAt, weatherState.status])
  useEffect(() => {
    const revalidateWeather = () => {
      if (document.visibilityState !== 'visible') return
      setWeatherState((current) => ageForecastState(current, Date.now()))
      refreshWeather()
    }
    document.addEventListener('visibilitychange', revalidateWeather)
    window.addEventListener('pageshow', revalidateWeather)
    return () => {
      document.removeEventListener('visibilitychange', revalidateWeather)
      window.removeEventListener('pageshow', revalidateWeather)
    }
  }, [refreshWeather])
  const wx = weatherState.status === WEATHER_STATUS.FRESH ? weatherState.data : null

  // inert while the primer overlay is up: Tab must not reach (and Enter must
  // not activate) the obscured app behind it — the pager AND the floating
  // chrome (tabbar, 🎲 FAB) gate on this (audit prep #6). The 🎨 pill used to
  // gate here too — retired in P1; display mode now lives in Settings.
  const baseCovered = !primer || Boolean(page) || Boolean(detail)
  const baseInert = baseCovered ? true : undefined

  return (
    <SavedBeenProvider
      city={city}
      events={events}
      customEvents={customEvents.items}
      places={places}
      guides={GUIDES}
      seeds={identitySeeds}
      catalogReady={savedCatalogReady}
      catalogError={savedCatalogError}
    >
      <PlannerProvider
        city={city}
        anchors={anchors}
        events={normalized}
        artifactStatus={eventArtifact.status}
        catalogReady={customEvents.ready}
        catalogError={customEvents.error}
      >
      <WxContext.Provider value={wx}>
        <div
          className="app"
          ref={appRef}
          onFocusCapture={rememberTrigger}
          onPointerDownCapture={rememberTrigger}
          data-city-id={city.id}
          data-city-time-zone={city.tz}
          data-city-runtime-status="ready"
          data-artifact-status={eventArtifact.status}
          data-weather-status={weatherState.status}
          data-manifest-id={artifactBinding.ok ? artifactBinding.manifestId : undefined}
          data-build-id={artifactBinding.ok ? artifactBinding.buildId : undefined}
        >
        {/* O1 lazy mounting: every section SHELL renders (scroll-snap needs all
            N page widths) but children mount on FIRST VISIT only — Home is
            the boot tab (eager); the rest mount when first reached (tap or
            swipe). Mounted-once tabs STAY mounted so their state (calendar
            selection, etc.) survives tab hops.
            Adding a tab = one VIEWS entry (nav.jsx) + one section here. */}
        <div className="pager" ref={attachPager} onScroll={onPagerScroll} inert={baseInert} aria-hidden={baseCovered || undefined}>
          {/* Stage R nav restructure (§P.5): Home · Events · Spots · Plan · Profile.
              Home is the boot tab (index 0, eager); the rest mount on first visit.
              The map is parked for v1 (D8) — no Map tab and no {type:'map'} sub-view. */}
          <section className="page page-hot" aria-label={VIEWS[0].label} aria-hidden={active !== 0} inert={active !== 0 ? true : undefined}>
            <HomeView events={norm} anchors={anchors} wx={wx} dataMeta={eventArtifact.meta}
              weatherState={weatherState}
              onRefreshWeather={refreshWeather}
            />
          </section>
          <section className="page page-hot" aria-label={VIEWS[1].label} aria-hidden={active !== 1} inert={active !== 1 ? true : undefined}>
            {/* Events — the browse (search + filter + event sections). Now lazy
                (Home is the boot tab), mounts on first visit to the Events tab. */}
            {visited.has('hot') && (
              <Suspense fallback={<SurfaceLoading />}>
                <HotView events={norm} retainedEvents={normalized} anchors={anchors} loading={loading} loadError={unavailable} />
              </Suspense>
            )}
          </section>
          <section className="page" aria-label={VIEWS[2].label} aria-hidden={active !== 2} inert={active !== 2 ? true : undefined}>
            {/* Sprint S: the Spots tab — lazy-mounted; its own /places.json fetch
                (places.js) fires on first visit, never at boot. */}
            {visited.has('locations') && (
              <Suspense fallback={<SurfaceLoading />}>
                <LocationsView coords={coords} />
              </Suspense>
            )}
          </section>
          <section className="page" aria-label={VIEWS[3].label} aria-hidden={active !== 3} inert={active !== 3 ? true : undefined}>
            {/* Plan (id 'calendar') */}
            {visited.has('calendar') && (
              <Suspense fallback={<SurfaceLoading />}>
                <CalendarView events={normalized} anchors={anchors} wx={wx} />
              </Suspense>
            )}
          </section>
          <section className="page" aria-label={VIEWS[4].label} aria-hidden={active !== 4} inert={active !== 4 ? true : undefined}>
            {visited.has('profile') && (
              <Suspense fallback={<SurfaceLoading />}>
                <ProfileView />
              </Suspense>
            )}
          </section>
        </div>
        <TabBar active={active} onTab={goTo} inert={baseInert} hidden={baseCovered || undefined} />
        {/* Keep transport failure globally visible above event subpages/detail.
            First-open onboarding stays topmost; the alert appears when it closes. */}
        {transportError && primer && !remotePageBlocked && (
          <div className={'load-note' + (page || detail ? ' is-layered' : '')} role="alert">
            <span className="load-txt">
              {eventArtifact.status === 'offline'
                ? 'You’re offline. Events weren’t loaded.'
                : 'Events couldn’t be verified right now.'}
            </span>
            {recoverEvents && (<button className="load-retry" onClick={recoverEvents}>{recoverEventsLabel}</button>)}
          </div>
        )}
        {primer
          && ['session-only', 'corrupt', 'error'].includes(customEvents.status) && (
          <div
            className={'load-note'
              + (page || detail ? ' is-layered' : '')
              + (transportError || staleAt != null ? ' is-stacked' : '')}
            role={customEvents.status === 'session-only' ? 'status' : 'alert'}
          >
            <span className="load-txt">
              {customEvents.status === 'session-only'
                ? "Your added events are here for this visit, but haven't been saved yet."
                : 'Your added events could not be loaded, so planning is paused.'}
            </span>
            {customEvents.status === 'session-only' && (
              <button className="load-retry" onClick={() => customEvents.retryPersistence()}>
                Try saving again
              </button>
            )}
          </div>
        )}
        <SavedBeenNotice
          visible={Boolean(primer)}
          layered={Boolean(page || detail)}
          stackLevel={Number(transportError || staleAt != null)
            + Number(['session-only', 'corrupt', 'error'].includes(customEvents.status))}
        />
        <ActivityNotice
          visible={Boolean(primer)}
          layered={Boolean(page || detail)}
          stackLevel={Number(transportError || staleAt != null)
            + Number(['session-only', 'corrupt', 'error'].includes(customEvents.status))}
        />
        {/* Expired bytes are identified but never rendered as current inventory. */}
        {staleAt != null && primer && !remotePageBlocked && (
          <div className={'stale-note' + (page || detail ? ' is-layered' : '')} role="alert">
            <span className="stale-txt">Event listings were last refreshed {dayStamp(staleAt)} and are too old to show.</span>
            {recoverEvents && (<button className="load-retry" onClick={recoverEvents}>Check again</button>)}
          </div>
        )}
        {/* Phase 3.5: the 🎲 Find-My-Night FAB is retired (Josh: remove the dice
            entirely). The Deck + day-fill deck are the surviving decide-for-me
            surfaces. */}
        {page && (
          <div
            className={'subpage' + (pageClosing ? ' subpage-closing' : '')}
            ref={pageLayerRef}
            tabIndex={-1}
            inert={detail ? true : undefined}
            aria-hidden={detail ? true : undefined}
          >
            <Suspense fallback={<SurfaceLoading />}>
            {remotePageBlocked ? (
              <EventUnavailablePage
                status={eventArtifact.status}
                meta={eventArtifact.meta}
                onBack={closePage}
                recover={recoverEvents}
                recoverLabel={recoverEventsLabel}
              />
            ) : (
              <>
            {page.type === 'bubble' && (
              <BubblePage
                bubble={page.bubble}
                events={norm}
                anchors={anchors}
                coords={coords}
              />
            )}
            {/* Sprint S: a tapped Locations bubble → its filtered place list */}
            {page.type === 'placebubble' && <PlaceBubblePage bubble={page.bubble} />}
            {/* 3.75: a tapped Guide → its GuidePage (derivable intention collection) */}
            {page.type === 'guide' && <GuidePage guide={page.guide} events={norm} anchors={anchors} />}
            {page.type === 'search' && <SearchPage events={norm} anchors={anchors} coords={coords} />}
            {/* D8: the Map sub-view is parked for v1 — removed. Events/Spots no longer
                expose a Map pill; place detail uses the Directions (Google Maps) link. */}
            {page.type === 'add' && (
              <AddEvent
                anchors={anchors}
                myEvents={customEvents.items}
                onAdd={customEvents.add}
                onUpdate={customEvents.update}
                presetTs={page.ts}
                editEvent={page.editEvent ?? null}
                status={customEvents.status}
              />
            )}
            {page.type === 'day' && (
              /* Sprint U-a day screen — keyed by day ts AND todayTs: opening
                 another day remounts, and a midnight rollover remounts too
                 (page.ts alone never changes at midnight — review LOW-1; the
                 remount re-runs the archive sweep so a now-past day stops
                 offering slots) */
              <DayPage key={page.ts + '-' + anchors.todayTs} ts={page.ts} events={normalized} availableEvents={norm} anchors={anchors} wx={wx} />
            )}
            {/* Plan Phase 2: the DayPage day-selector's date picker (quick list +
                Full-calendar grid); selecting a date → openDay (replaces this page) */}
            {page.type === 'calpicker' && <CalendarPickerPage ts={page.ts} anchors={anchors} />}
            {/* Sprint P/Q2c: settings + the taste flows. Single-slot union —
                interests/deck REPLACE the settings page and hand back via
                their `from` origin, so the trio feels stacked without stack
                state (the 7-screen Interview retired into the editor, Q2d) */}
            {page.type === 'settings' && (
              <SettingsPage events={norm} dataMeta={eventArtifact.meta} primer={primer} onPrimerDone={setPrimer} />
            )}
            {/* Stage R (Profile rework): the two new Profile drill-ins, single-slot */}
            {page.type === 'myplans' && <MyPlansPage events={normalized} anchors={anchors} />}
            {page.type === 'mysaves' && <MySavesPage events={normalized} anchors={anchors} />}
            {/* PROFILE_PHASE2: net-new single-slot Profile drill-ins */}
            {page.type === 'editprofile' && <EditProfilePage />}
            {page.type === 'helpfeedback' && <HelpFeedbackPage />}
            {/* HOME_PHASE2: Forecast + Notifications */}
            {page.type === 'forecast' && <ForecastPage anchors={anchors} wx={wx} />}
            {page.type === 'notifications' && <NotificationsPage events={norm} retainedEvents={normalized} anchors={anchors} wx={wx} />}
            {/* EVENTS_PHASE2: Filters bottom-sheet */}
            {page.type === 'evfilters' && <FiltersSheet />}
            {/* Stage E (⚑X3): Settings → Data & photo credits — single-slot
                REPLACE; its back affordance reopens Settings. Every credit line
                derives from norm / places.json / the city config at render.
                immutable artifact metadata feeds the Coverage Card. */}
            {page.type === 'attribution' && <AttributionPage events={norm} dataMeta={eventArtifact.meta} />}
            {page.type === 'sharedplan' && <SharedPlanPage capsule={page.capsule} />}
            {page.type === 'datatransfer' && <DataTransferRoute city={city} />}
            {page.type === 'route-unavailable' && (
              <RouteUnavailablePage outcome={page.outcome} onBack={closePage} />
            )}
            {page.type === 'interests' && <InterestEditor from={page.from} />}
            {/* Sprint V2/V3: the "why your feed looks like this" + mute/boost
                panel — opened from Settings, back returns there (the `from`
                origin). primer is handed in so taste.js's one when-resolver
                decides precedence (primer-v1 is a separate store). */}
            {page.type === 'taste' && <TastePanel from={page.from} primer={primer} />}
            {/* TINDER: the Spots "Tune your taste" deck (kind:'places') — lazy-loads
                places via the PlacesDeck wrapper. Closes to the Spots tab. */}
            {page.type === 'deck' && page.kind === 'places' && (
              <PlacesDeck
                onClose={page.from === 'settings' ? openSettings : closePage}
                closeLabel={page.from === 'settings' ? 'Back to Settings' : 'Done'}
              />
            )}
            {page.type === 'deck' && page.kind !== 'places' && (
              /* primer-origin (the onboarding offer) closes to the tab — a
                 fresh user has no Settings page to "go back" to */
              <CalibrationDeck
                events={norm}
                anchors={anchors}
                onClose={page.from === 'settings' ? openSettings : closePage}
                closeLabel={
                  page.from === 'settings' ? undefined : page.from === 'primer' ? 'Take me to the events' : 'Done'
                }
              />
            )}
            {/* Sprint Q2: the finite "Deck this" mode — opened ONLY by the
                explicit 🃏 entry buttons (HotView day-headers, bubble pages);
                its back/finish affordances return to where the user came from.
                (C5: the Sprint U-b day-fill variant that shared this slot was
                deleted — unreachable since S1-D4 removed its only opener.) */}
            {page.type === 'lensdeck' && (
              <LensDeck lens={page.lens} events={norm} anchors={anchors} />
            )}
              </>
            )}
            </Suspense>
          </div>
        )}
        {/* H1: first open only — Primer persists its own state + seeds taste;
            onDone hands the saved state back so the gate closes for good.
            Q2d: the finish screen's optional "dial it in" offer routes through
            onDeck — primer gate closes and the deck subpage mounts in the
            SAME commit, so the deck only ever appears after the primer is
            gone (explicit tap only; the primer never autoplays anything) */}
        {!primer && (
          <Primer
            onDone={setPrimer}
            onDeck={(s) => {
              setPrimer(s)
              openDeck('primer')
            }}
          />
        )}
        {/* CARD polish: the module toast host for self-contained card actions
            (GemRow "Add to plan" / SpotCard "Add to day") — renders via portal. */}
        <CardToastHost />
        {/* keyed by key: a More-like-this swap REMOUNTS the detail (scroll resets
            to top, mini-map is destroyed + rebuilt for the new coords). Sprint S:
            the shared detail layer serves BOTH kinds — a place (kind:'place')
            opens PlaceDetail, an event opens DetailPage; openDetail's taste +
            recents seams are generic (keyOf/category) so both record correctly. */}
        <Suspense fallback={detail ? <SurfaceLoading detail /> : null}>
          {detail && detail.kind === 'place' && !placesUnavailable && (
            <PlaceDetail key={keyOf(detail)} e={detail} anchors={anchors} wx={wx} />
          )}
          {detail && detail.kind !== 'place' && (
            <DetailPage
              key={keyOf(detail)}
              e={detail}
              events={norm}
              anchors={anchors}
              wx={wx}
              onRemoveMine={customEvents.remove}
              onRestoreMine={customEvents.add}
            />
          )}
        </Suspense>
        {loading && bootVis && <div className="boot">Loading Wuzup…</div>}
        </div>
      </WxContext.Provider>
      </PlannerProvider>
    </SavedBeenProvider>
  )
}
