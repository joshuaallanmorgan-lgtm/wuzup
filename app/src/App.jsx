// App — the DATA shell: events fetch + normalize, anchors, weather, my-events,
// geolocation (requestCoords), display-mode state and the primer gate. All
// NAVIGATION state (active tab, subpage union, detail open/close + VT morph,
// map focus) lives in nav.js (Sprint O6) — components reach it via useNav().
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CITY, DAY, Icon, keyOf, loadMyEvents, makeAnchors, normalize, rawOf, saveMyEvents } from './lib.js'
import { lsGet, lsSet } from './storage.js'
import { NavProvider, VIEWS, viewIndex, useNav } from './nav.jsx'
import Primer, { loadPrimerState } from './Primer.jsx'
import { DISPLAY_MODES, DisplayModeContext, WxContext } from './cards.jsx'
import { getForecast } from './weather.js'
import HotView from './HotView.jsx'
import MapView from './MapView.jsx'
import CalendarView from './CalendarView.jsx'
import ProfileView from './ProfileView.jsx'
import DetailPage from './DetailPage.jsx'
import BubblePage from './BubblePage.jsx'
import SearchPage from './SearchPage.jsx'
import FindMyNight from './FindMyNight.jsx'
import AddEvent from './AddEvent.jsx'
import WeekendBuilder from './WeekendBuilder.jsx'
import SettingsPage from './SettingsPage.jsx'
import Interview from './Interview.jsx'
import CalibrationDeck from './CalibrationDeck.jsx'
import LensDeck from './LensDeck.jsx'
import './App.css'

function TabBar({ active, onTab, inert }) {
  return (
    <nav className="tabbar" inert={inert}>
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

// M2 resilience constants: one retry on a failed boot fetch, and the
// staleness threshold for the quiet "events from {day}" banner. events.json
// ships no generatedAt field (finder-owned schema), so the banner reads the
// HTTP Last-Modified header off the fetch response instead — static hosts and
// vite preview both send it; when the header is absent the banner simply
// never shows (graceful, no fake claims).
const RETRY_MS = 2500
const STALE_MS = 48 * 3600 * 1000
const staleDayLabel = (ms) =>
  Date.now() - ms <= 6 * DAY
    ? new Date(ms).toLocaleDateString('en-US', { weekday: 'long' })
    : new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

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
  const [bootVis, setBootVis] = useState(false) // boot overlay gated 300ms (no flash on fast loads)
  const [coords, setCoords] = useState(null)
  // display mode: 'editorial' | 'poster' | 'cinematic', persisted via storage.js
  const [displayMode, setDisplayMode] = useState(() => {
    const v = lsGet('display-mode')
    return DISPLAY_MODES.includes(v) ? v : 'editorial'
  })
  // H1 mood primer: mounts while no stored state exists (first open only).
  // Primer.jsx owns the primer store + the taste seeding; App only gates the
  // mount and passes the when-preference down for the H2 greeting flavor.
  const [primer, setPrimer] = useState(() => loadPrimerState())
  const coordsRef = useRef(null)

  // navigation (nav.js): tab index + pager wiring, visited set (lazy tab
  // mounting, O1), subpage union, detail, map focus
  const { active, goTo, attachPager, onPagerScroll, visited, page, pageClosing, openNight, openSettings, detail } =
    useNav()

  // the snapshot's Last-Modified ms (null when the header is absent) — the
  // stale banner reads it through staleAt; Settings' "Events updated {when}"
  // line reads it directly (P1: lifted to state instead of a second fetch)
  const [dataAt, setDataAt] = useState(null)
  // M2a stale-data banner: Last-Modified ms when the snapshot is > 48h old
  const [staleAt, setStaleAt] = useState(null)
  const [staleHidden, setStaleHidden] = useState(false) // ✕ dismiss (this load only)
  // M2b: one retry with backoff before giving up — a transient blip on a weak
  // network shouldn't cost the whole session. The boot overlay stays up across
  // the backoff (we ARE still trying); after the second failure the existing
  // honest empty state takes over. Non-OK responses throw so a 404/500 retries
  // too (the old .json() would have rejected on the error page anyway).
  useEffect(() => {
    let on = true
    let timer
    const load = (attempt) => {
      fetch('/events.json')
        .then((r) => {
          if (!r.ok) throw new Error('http ' + r.status)
          const lm = Date.parse(r.headers.get('last-modified') || '')
          return r.json().then((d) => {
            if (!on) return
            if (!Number.isNaN(lm)) setDataAt(lm)
            if (!Number.isNaN(lm) && Date.now() - lm > STALE_MS) setStaleAt(lm)
            setEvents(Array.isArray(d) ? d : [])
            setLoading(false)
          })
        })
        .catch(() => {
          if (!on) return
          if (attempt === 0) timer = setTimeout(() => load(1), RETRY_MS)
          else {
            setEvents([])
            setLoading(false)
          }
        })
    }
    load(0)
    return () => {
      on = false
      clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setBootVis(true), 300)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    lsSet('display-mode', displayMode) // guarded inside storage.js — private mode still works for the session
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
  const displayCtx = useMemo(() => ({ mode: displayMode, setMode: setDisplayMode }), [displayMode])

  // 16-day Tampa forecast, fetched ONCE at App level (was CalendarView-local):
  // CalendarView (prop), DetailPage (prop) and outdoor feed rows (WxContext)
  // all read the same map. null = no weather, every consumer degrades silently.
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

  // inert while the primer overlay is up: Tab must not reach (and Enter must
  // not activate) the obscured app behind it — the pager AND the floating
  // chrome (tabbar, 🎲 FAB) gate on this (audit prep #6). The 🎨 pill used to
  // gate here too — retired in P1; display mode now lives in Settings.
  const inertAll = !primer ? true : undefined

  return (
    <DisplayModeContext.Provider value={displayCtx}>
      <WxContext.Provider value={wx}>
      <div className="app">
        {/* O1 lazy mounting: every section SHELL renders (scroll-snap needs all
            N page widths) but children mount on FIRST VISIT only — Events is
            the boot tab (eager); Map/Calendar/Profile mount when first reached
            (tap, swipe, or focusMap). Mounted-once tabs STAY mounted so their
            state (Leaflet map, calendar selection) survives tab hops.
            Adding a tab = one VIEWS entry (nav.jsx) + one section here. */}
        <div className="pager" ref={attachPager} onScroll={onPagerScroll} inert={inertAll}>
          <section className="page page-hot">
            <HotView
              events={norm}
              anchors={anchors}
              loading={loading}
              displayMode={displayMode}
              whenPref={primer?.when ?? null}
            />
          </section>
          <section className="page page-map">
            {visited.has('map') && <MapView events={norm} anchors={anchors} />}
          </section>
          <section className="page">
            {visited.has('calendar') && <CalendarView events={norm} anchors={anchors} wx={wx} />}
          </section>
          <section className="page">
            {visited.has('profile') && <ProfileView events={norm} anchors={anchors} primer={primer} />}
          </section>
        </div>
        <TabBar active={active} onTab={goTo} inert={inertAll} />
        {/* M2a: quiet staleness disclosure — one line, dismissible, never blocks
            (z 1200: subpages/detail/primer all render over it) */}
        {staleAt != null && !staleHidden && (
          <div className="stale-note" role="status" inert={inertAll}>
            <span className="stale-txt">Events from {staleDayLabel(staleAt)} — they may have changed</span>
            <button className="stale-x" onClick={() => setStaleHidden(true)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
        {active === viewIndex('hot') && norm.length > 0 && (
          <button className="dice" onClick={openNight} aria-label="Find my night" inert={inertAll}>
            🎲
          </button>
        )}
        {page && (
          <div className={'subpage' + (pageClosing ? ' subpage-closing' : '')}>
            {page.type === 'bubble' && (
              <BubblePage
                bubble={page.bubble}
                events={norm}
                anchors={anchors}
                coords={coords}
                requestCoords={requestCoords}
              />
            )}
            {page.type === 'search' && <SearchPage events={norm} anchors={anchors} coords={coords} />}
            {page.type === 'night' && <FindMyNight events={norm} anchors={anchors} coords={coords} />}
            {page.type === 'add' && <AddEvent anchors={anchors} myEvents={myEvents} onAdd={addMine} />}
            {page.type === 'weekend' && (
              /* keyed by weekend: a midnight rollover into a new weekend remounts with that weekend's plan */
              <WeekendBuilder key={anchors.wkStartTs} events={norm} anchors={anchors} />
            )}
            {/* Sprint P: settings + the two taste flows it launches. Single-slot
                union — interview/deck REPLACE the settings page and hand back
                via openSettings, so the trio feels stacked without stack state */}
            {page.type === 'settings' && (
              <SettingsPage events={norm} dataAt={dataAt} primer={primer} onPrimerDone={setPrimer} />
            )}
            {page.type === 'interview' && <Interview />}
            {page.type === 'deck' && (
              <CalibrationDeck events={norm} anchors={anchors} onClose={openSettings} />
            )}
            {/* Sprint Q2: the finite "Deck this" mode — opened ONLY by the
                explicit 🃏 entry buttons (HotView day-headers, bubble pages);
                its back/finish affordances return to where the user came from */}
            {page.type === 'lensdeck' && <LensDeck lens={page.lens} events={norm} anchors={anchors} />}
          </div>
        )}
        {/* H1: first open only — Primer persists its own state + seeds taste;
            onDone hands the saved state back so the gate closes for good */}
        {!primer && <Primer onDone={setPrimer} />}
        {/* keyed by event: a More-like-this swap REMOUNTS the detail (scroll resets
            to top, mini-map is destroyed + rebuilt for the new coords) */}
        {detail && (
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
        {loading && bootVis && <div className="boot">Loading {CITY.name}…</div>}
      </div>
      </WxContext.Provider>
    </DisplayModeContext.Provider>
  )
}
