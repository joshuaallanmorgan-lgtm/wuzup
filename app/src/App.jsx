// App — the DATA shell: events fetch + normalize, anchors, weather, my-events,
// shared location state, and the primer gate. All
// NAVIGATION state (active tab, subpage union, detail open/close + VT morph,
// map focus) lives in nav.js (Sprint O6) — components reach it via useNav().
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, currentEvents, keyOf, makeAnchors, normalize } from './lib.js'
import { dayStamp } from './coverage.js'
import { useArtifact } from './artifacts.js'
import { NavProvider, VIEWS, useNav } from './nav.jsx'
import { LocationProvider, useLocationPermission } from './LocationProvider.jsx'
import { PlannerProvider } from './PlannerProvider.jsx'
import { CustomEventsProvider, useCustomEvents } from './CustomEventsProvider.jsx'
import Primer, { loadPrimerState } from './Primer.jsx'
import { WxContext, CardToastHost } from './cards.jsx'
import { getForecast } from './weather.js'
import HomeView from './HomeView.jsx'
import HotView from './HotView.jsx'
import LocationsView from './LocationsView.jsx'
import CalendarView from './CalendarView.jsx'
import ProfileView from './ProfileView.jsx'
import MyPlansPage from './MyPlansPage.jsx'
import MySavesPage from './MySavesPage.jsx'
import EditProfilePage from './EditProfilePage.jsx'
import HelpFeedbackPage from './HelpFeedbackPage.jsx'
import ForecastPage from './ForecastPage.jsx'
import NotificationsPage from './NotificationsPage.jsx'
import FiltersSheet from './FiltersSheet.jsx'
import DetailPage from './DetailPage.jsx'
import PlaceDetail from './PlaceDetail.jsx'
import BubblePage from './BubblePage.jsx'
import PlaceBubblePage from './PlaceBubblePage.jsx'
import GuidePage from './GuidePage.jsx'
import SearchPage from './SearchPage.jsx'
import AddEvent from './AddEvent.jsx'
import DayPage from './DayPage.jsx'
import CalendarPickerPage from './CalendarPickerPage.jsx'
import SettingsPage from './SettingsPage.jsx'
import AttributionPage from './AttributionPage.jsx'
import InterestEditor from './InterestEditor.jsx'
import TastePanel from './TastePanel.jsx'
import CalibrationDeck, { PlacesDeck } from './CalibrationDeck.jsx'
import LensDeck from './LensDeck.jsx'
import './App.css'

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
  if (!root || root.contains(document.activeElement)) return
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
  return (
    <CustomEventsProvider>
      <NavProvider>
        <LocationProvider>
          <Shell />
        </LocationProvider>
      </NavProvider>
    </CustomEventsProvider>
  )
}

function Shell() {
  const customEvents = useCustomEvents()
  const location = useLocationPermission()
  const coords = location.usableCoords
  const eventArtifact = useArtifact('events')
  // Subscribe without activating the lazy place artifact. This lets the shell
  // close a retained remote place detail if its verified snapshot expires or
  // fails while open, without adding a places fetch to app boot.
  const placeArtifact = useArtifact('places', false)
  const events = useMemo(
    () => (Array.isArray(eventArtifact.data) ? eventArtifact.data : []),
    [eventArtifact.data]
  )
  const loading = eventArtifact.status === 'idle' || eventArtifact.status === 'loading'
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

  // navigation (nav.js): tab index + pager wiring, visited set (lazy tab
  // mounting, O1), subpage union, detail, map focus
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
  } = useNav()
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
    if (isOpen) {
      frame = requestAnimationFrame(() => {
        if (!document.querySelector('.detail')) focusLayer(pageLayerRef.current)
      })
    } else if (wasOpen) {
      const target = pageReturnFocusRef.current
      pageReturnFocusRef.current = null
      frame = requestAnimationFrame(() => restoreLayerFocus(target, appRef.current))
    }
    return () => cancelAnimationFrame(frame)
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
    if (isOpen) {
      frame = requestAnimationFrame(() => focusLayer(document.querySelector('.detail'), '.detail-back'))
    } else if (wasOpen) {
      const target = detailReturnFocusRef.current
      detailReturnFocusRef.current = null
      frame = requestAnimationFrame(() => restoreLayerFocus(target, pageLayerRef.current || appRef.current))
    }
    return () => cancelAnimationFrame(frame)
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

  // 16-day Tampa forecast, fetched ONCE at App level: DayPage (prop), PlaceDetail
  // (beach-day fit), DetailPage (event-day weather) and outdoor feed rows
  // (WxContext) read the same map. null = no weather, every consumer degrades
  // silently. (FB-11/3.7P-3: the Calendar grid no longer reads it.)
  const [wx, setWx] = useState(null)
  useEffect(() => {
    let on = true
    getForecast().then((m) => {
      if (on && m) setWx(m)
    })
    return () => {
      on = false
    }
  }, [])

  // inert while the primer overlay is up: Tab must not reach (and Enter must
  // not activate) the obscured app behind it — the pager AND the floating
  // chrome (tabbar, 🎲 FAB) gate on this (audit prep #6). The 🎨 pill used to
  // gate here too — retired in P1; display mode now lives in Settings.
  const baseCovered = !primer || Boolean(page) || Boolean(detail)
  const baseInert = baseCovered ? true : undefined

  return (
    <PlannerProvider
      anchors={anchors}
      events={normalized}
      artifactStatus={eventArtifact.status}
      catalogReady={customEvents.ready}
      catalogError={customEvents.error}
    >
      <WxContext.Provider value={wx}>
        <div className="app" ref={appRef} onFocusCapture={rememberTrigger} onPointerDownCapture={rememberTrigger}>
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
            <HomeView events={norm} anchors={anchors} wx={wx} dataMeta={eventArtifact.meta} />
          </section>
          <section className="page page-hot" aria-label={VIEWS[1].label} aria-hidden={active !== 1} inert={active !== 1 ? true : undefined}>
            {/* Events — the browse (search + filter + event sections). Now lazy
                (Home is the boot tab), mounts on first visit to the Events tab. */}
            {visited.has('hot') && <HotView events={norm} retainedEvents={normalized} anchors={anchors} loading={loading} loadError={unavailable} />}
          </section>
          <section className="page" aria-label={VIEWS[2].label} aria-hidden={active !== 2} inert={active !== 2 ? true : undefined}>
            {/* Sprint S: the Spots tab — lazy-mounted; its own /places.json fetch
                (places.js) fires on first visit, never at boot. */}
            {visited.has('locations') && <LocationsView coords={coords} />}
          </section>
          <section className="page" aria-label={VIEWS[3].label} aria-hidden={active !== 3} inert={active !== 3 ? true : undefined}>
            {/* Plan (id 'calendar') */}
            {visited.has('calendar') && <CalendarView events={normalized} anchors={anchors} wx={wx} />}
          </section>
          <section className="page" aria-label={VIEWS[4].label} aria-hidden={active !== 4} inert={active !== 4 ? true : undefined}>
            {visited.has('profile') && <ProfileView />}
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
                presetTs={page.ts}
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
        {loading && bootVis && <div className="boot">Loading Wuzup…</div>}
        </div>
      </WxContext.Provider>
    </PlannerProvider>
  )
}
