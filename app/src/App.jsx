// App — the DATA shell: events fetch + normalize, anchors, weather, my-events,
// geolocation (requestCoords) and the primer gate. All
// NAVIGATION state (active tab, subpage union, detail open/close + VT morph,
// map focus) lives in nav.js (Sprint O6) — components reach it via useNav().
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, keyOf, loadMyEvents, makeAnchors, normalize, rawOf, saveMyEvents } from './lib.js'
import { dayStamp } from './coverage.js'
import { NavProvider, VIEWS, useNav } from './nav.jsx'
import Primer, { loadPrimerState } from './Primer.jsx'
import { WxContext, CardToastHost } from './cards.jsx'
import { getForecast } from './weather.js'
import { lsGet, lsSet } from './storage.js'
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

// M2 resilience constants: one retry on a failed boot fetch, and the
// staleness threshold for the quiet "events from {day}" banner. events.json
// ships no generatedAt field (finder-owned schema), so the banner reads the
// HTTP Last-Modified header off the fetch response instead — static hosts and
// vite preview both send it; when the header is absent the banner simply
// never shows (graceful, no fake claims).
const RETRY_MS = 2500
const STALE_MS = 48 * 3600 * 1000
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
    <NavProvider>
      <Shell />
    </NavProvider>
  )
}

function Shell() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadCycle, setLoadCycle] = useState(0)
  const [bootVis, setBootVis] = useState(false) // boot overlay gated 300ms (no flash on fast loads)
  const [coords, setCoords] = useState(null)
  // 3.7P-21: location is opt-in via Settings → Data & privacy (no inline gate).
  // The pref persists; on a later boot we re-fetch silently (the browser already
  // remembers the grant) so "Near you" surfaces without re-prompting each visit.
  const [locAllowed, setLocAllowed] = useState(() => lsGet('location-allowed-v1') === '1')
  // H1 mood primer: mounts while no stored state exists (first open only).
  // Primer.jsx owns the primer store + the taste seeding; App only gates the
  // mount and passes the when-preference down for the H2 greeting flavor.
  const [primer, setPrimer] = useState(() => loadPrimerState())
  const coordsRef = useRef(null)
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
    detail,
  } = useNav()

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

  // the snapshot's Last-Modified ms (null when the header is absent) — the
  // stale banner reads it through staleAt; Settings' "Events updated {when}"
  // line reads it directly (P1: lifted to state instead of a second fetch)
  const [dataAt, setDataAt] = useState(null)
  // M2a stale-data banner: Last-Modified ms when the snapshot is > 48h old
  const [staleAt, setStaleAt] = useState(null)
  const [staleHidden, setStaleHidden] = useState(false) // ✕ dismiss (this load only)
  // M2b: one retry with backoff before giving up — a transient blip on a weak
  // network shouldn't cost the whole session. The boot overlay stays up across
  // the backoff (we ARE still trying); after the second failure an explicit
  // error + manual retry takes over — a failed fetch is never presented as an
  // honestly empty city. Non-OK responses throw so a 404/500 retries too.
  const retryEvents = useCallback(() => {
    setLoadError(false)
    setLoading(true)
    setLoadCycle((n) => n + 1)
  }, [])
  useEffect(() => {
    let on = true
    let timer
    const load = (attempt) => {
      // Stage E base-path: BASE_URL-relative, never root-absolute — under a
      // subpath deployment (GitHub Pages /wuzup/) '/events.json' 404s. Vite
      // statically folds this to '/events.json' at the default base (no-op).
      fetch(import.meta.env.BASE_URL + 'events.json')
        .then((r) => {
          if (!r.ok) throw new Error('http ' + r.status)
          const lm = Date.parse(r.headers.get('last-modified') || '')
          return r.json().then((d) => {
            if (!on) return
            if (!Number.isNaN(lm)) setDataAt(lm)
            if (!Number.isNaN(lm) && Date.now() - lm > STALE_MS) setStaleAt(lm)
            setEvents(Array.isArray(d) ? d : [])
            setLoadError(false)
            setLoading(false)
          })
        })
        .catch(() => {
          if (!on) return
          if (attempt === 0) timer = setTimeout(() => load(1), RETRY_MS)
          else {
            setEvents([])
            setLoadError(true)
            setLoading(false)
          }
        })
    }
    load(0)
    return () => {
      on = false
      clearTimeout(timer)
    }
  }, [loadCycle])
  useEffect(() => {
    const t = setTimeout(() => setBootVis(true), 300)
    return () => clearTimeout(t)
  }, [])
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
  // "Added by you" events (Sprint C MVP): raw schema-v2 objects from the
  // AddEvent form, persisted via lib.js (storage.js-backed) and concat'd into
  // norm below — same normalize() path as fetched events, so they surface
  // everywhere list-wise (feed, bubbles, search, calendar; lat/lng null → no
  // map pin). rawOf strips computed _fields when an undo restores a
  // normalized copy, keeping storage pure schema-v2.
  const [myEvents, setMyEvents] = useState(loadMyEvents)
  useEffect(() => {
    saveMyEvents(myEvents)
  }, [myEvents])
  // Re-read storage inside the setters: a stale tab must never clobber another
  // tab's adds. Duplicate adds (same title+date, no URL → same key) are no-ops.
  const addMine = useCallback((raw) => {
    setMyEvents(() => {
      const fresh = loadMyEvents()
      const r = rawOf(raw)
      if (fresh.some((x) => keyOf(x) === keyOf(r))) return fresh
      return [...fresh, r]
    })
  }, [])
  const removeMine = useCallback((e) => {
    const k = keyOf(e)
    setMyEvents(() => loadMyEvents().filter((x) => keyOf(x) !== k))
  }, [])
  const norm = useMemo(() => [...events, ...myEvents].map((e) => normalize(e, anchors)), [events, myEvents, anchors])

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

  // 3.7P-21: on boot, if location was previously allowed, re-fetch silently (the
  // browser remembers the grant → no prompt) so "Near you" is ready everywhere.
  useEffect(() => {
    if (lsGet('location-allowed-v1') === '1') requestCoords()
  }, [requestCoords]) // requestCoords is stable (useCallback []) → runs once on mount
  // the Settings toggle: enabling fetches once (the browser prompt fires here);
  // disabling forgets the cached fix so "Near you" stops surfacing. On-device only.
  const setLocationAllowed = useCallback(
    (on) => {
      setLocAllowed(on)
      lsSet('location-allowed-v1', on ? '1' : '0')
      if (on) requestCoords()
      else {
        coordsRef.current = null
        setCoords(null)
      }
    },
    [requestCoords]
  )

  // inert while the primer overlay is up: Tab must not reach (and Enter must
  // not activate) the obscured app behind it — the pager AND the floating
  // chrome (tabbar, 🎲 FAB) gate on this (audit prep #6). The 🎨 pill used to
  // gate here too — retired in P1; display mode now lives in Settings.
  const baseCovered = !primer || Boolean(page) || Boolean(detail)
  const baseInert = baseCovered ? true : undefined

  return (
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
            {/* dataAt (D-G1): the Coverage Card colophon's "updated" line */}
            <HomeView events={norm} anchors={anchors} wx={wx} dataAt={dataAt} />
          </section>
          <section className="page page-hot" aria-label={VIEWS[1].label} aria-hidden={active !== 1} inert={active !== 1 ? true : undefined}>
            {/* Events — the browse (search + filter + event sections). Now lazy
                (Home is the boot tab), mounts on first visit to the Events tab. */}
            {visited.has('hot') && <HotView events={norm} anchors={anchors} loading={loading} loadError={loadError} />}
          </section>
          <section className="page" aria-label={VIEWS[2].label} aria-hidden={active !== 2} inert={active !== 2 ? true : undefined}>
            {/* Sprint S: the Spots tab — lazy-mounted; its own /places.json fetch
                (places.js) fires on first visit, never at boot. */}
            {visited.has('locations') && <LocationsView coords={coords} />}
          </section>
          <section className="page" aria-label={VIEWS[3].label} aria-hidden={active !== 3} inert={active !== 3 ? true : undefined}>
            {/* Plan (id 'calendar') */}
            {visited.has('calendar') && <CalendarView events={norm} anchors={anchors} wx={wx} />}
          </section>
          <section className="page" aria-label={VIEWS[4].label} aria-hidden={active !== 4} inert={active !== 4 ? true : undefined}>
            {visited.has('profile') && <ProfileView events={norm} anchors={anchors} primer={primer} />}
          </section>
        </div>
        <TabBar active={active} onTab={goTo} inert={baseInert} hidden={baseCovered || undefined} />
        {/* Keep transport failure globally visible above event subpages/detail.
            First-open onboarding stays topmost; the alert appears when it closes. */}
        {loadError && primer && (
          <div className="load-note" role="alert" inert={baseInert} aria-hidden={baseCovered || undefined}>
            <span className="load-txt">Events couldn’t load. Check your connection.</span>
            <button className="load-retry" onClick={retryEvents}>Try again</button>
          </div>
        )}
        {/* M2a: quiet staleness disclosure — one line, dismissible, never blocks
            (z 1200: subpages/detail/primer all render over it) */}
        {staleAt != null && !staleHidden && (
          <div className="stale-note" role="status" inert={baseInert} aria-hidden={baseCovered || undefined}>
            <span className="stale-txt">Events from {dayStamp(staleAt)} — they may have changed</span>
            <button className="stale-x" onClick={() => setStaleHidden(true)} aria-label="Dismiss">
              ✕
            </button>
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
            {page.type === 'bubble' && (
              <BubblePage
                bubble={page.bubble}
                events={norm}
                anchors={anchors}
                coords={coords}
                requestCoords={requestCoords}
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
              <AddEvent anchors={anchors} myEvents={myEvents} onAdd={addMine} presetTs={page.ts} />
            )}
            {page.type === 'day' && (
              /* Sprint U-a day screen — keyed by day ts AND todayTs: opening
                 another day remounts, and a midnight rollover remounts too
                 (page.ts alone never changes at midnight — review LOW-1; the
                 remount re-runs the archive sweep so a now-past day stops
                 offering slots) */
              <DayPage key={page.ts + '-' + anchors.todayTs} ts={page.ts} events={norm} anchors={anchors} wx={wx} />
            )}
            {/* Plan Phase 2: the DayPage day-selector's date picker (quick list +
                Full-calendar grid); selecting a date → openDay (replaces this page) */}
            {page.type === 'calpicker' && <CalendarPickerPage ts={page.ts} anchors={anchors} />}
            {/* Sprint P/Q2c: settings + the taste flows. Single-slot union —
                interests/deck REPLACE the settings page and hand back via
                their `from` origin, so the trio feels stacked without stack
                state (the 7-screen Interview retired into the editor, Q2d) */}
            {page.type === 'settings' && (
              <SettingsPage events={norm} dataAt={dataAt} primer={primer} onPrimerDone={setPrimer} locationAllowed={locAllowed} onAllowLocation={setLocationAllowed} />
            )}
            {/* Stage R (Profile rework): the two new Profile drill-ins, single-slot */}
            {page.type === 'myplans' && <MyPlansPage events={norm} anchors={anchors} />}
            {page.type === 'mysaves' && <MySavesPage events={norm} anchors={anchors} />}
            {/* PROFILE_PHASE2: net-new single-slot Profile drill-ins */}
            {page.type === 'editprofile' && <EditProfilePage />}
            {page.type === 'helpfeedback' && <HelpFeedbackPage />}
            {/* HOME_PHASE2: Forecast + Notifications */}
            {page.type === 'forecast' && <ForecastPage anchors={anchors} wx={wx} />}
            {page.type === 'notifications' && <NotificationsPage events={norm} anchors={anchors} wx={wx} />}
            {/* EVENTS_PHASE2: Filters bottom-sheet */}
            {page.type === 'evfilters' && <FiltersSheet />}
            {/* Stage E (⚑X3): Settings → Data & photo credits — single-slot
                REPLACE; its back affordance reopens Settings. Every credit line
                derives from norm / places.json / the city config at render.
                dataAt (D-G1) feeds the Coverage Card header's "updated" line. */}
            {page.type === 'attribution' && <AttributionPage events={norm} dataAt={dataAt} />}
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
        {detail && detail.kind === 'place' && (
          <PlaceDetail key={keyOf(detail)} e={detail} anchors={anchors} wx={wx} />
        )}
        {detail && detail.kind !== 'place' && (
          <DetailPage
            key={keyOf(detail)}
            e={detail}
            events={norm}
            anchors={anchors}
            wx={wx}
            onRemoveMine={removeMine}
            onRestoreMine={addMine}
          />
        )}
        {loading && bootVis && <div className="boot">Loading Wuzup…</div>}
      </div>
    </WxContext.Provider>
  )
}
