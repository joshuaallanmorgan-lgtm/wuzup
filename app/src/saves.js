// saves.js — localStorage ♥ saves (Sprint C, sanctioned round-2 #4).
//
// STORAGE: 'saved-events-v1' = { [keyOf(e)]: { savedAt, snapshot } }. The
// snapshot keeps just enough of the event (title/start/venue/image/url/
// category/isFree/price) to render a shelf card even after a dataset refresh
// drops the event itself. Every localStorage access is guarded — in private
// mode saves still work for the session, they just don't persist.
//
// SYNC: a module-level store + subscriber set exposed to React through
// useSyncExternalStore. Any toggle() rebuilds the store object and notifies
// every mounted consumer — heart tapped on the detail page → the HotView
// shelf appears, no remount needed. A window 'storage' listener folds in
// toggles made from other tabs (the event never fires in the writing tab).
//
// NOTE: plain .js file (same rule as lib.js) — NO JSX; SaveHeart uses
// createElement.
import { createElement as h, useState, useSyncExternalStore } from 'react'
import { DAY, keyOf, normalize } from './lib.js'
import { recordSignal } from './taste.js'
import './saves.css'

const KEY = 'saved-events-v1'

function loadMap() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY))
    if (p && typeof p === 'object' && !Array.isArray(p)) return p
  } catch {
    /* absent, corrupt, or private mode — start empty */
  }
  return {}
}

// store snapshot: rebuilt (new identity) on every change so React re-renders
const mk = (map) => ({
  map,
  ids: new Set(Object.keys(map)),
  list: Object.entries(map).map(([key, v]) => ({ key, ...v })),
})

let store = mk(loadMap())
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

function commit(map) {
  store = mk(map)
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* private mode / quota — keep the in-memory session working */
  }
  emit()
}

// cross-tab: another tab toggled (key match) or cleared storage (key null)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== KEY && ev.key !== null) return
    store = mk(loadMap())
    emit()
  })
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => store

export function toggleSave(e) {
  const k = keyOf(e)
  const map = { ...store.map }
  if (map[k]) {
    delete map[k]
  } else {
    recordSignal('save', e) // taste seam: toggle-ON only (un-saving says nothing)
    map[k] = {
      savedAt: Date.now(),
      snapshot: {
        title: e.title ?? null,
        start: e.start ?? null,
        // end + tags must survive: without them a still-running multi-day save
        // would normalize to a one-day event and be falsely marked "Happened"
        end: e.end ?? null,
        tags: Array.isArray(e.tags) ? e.tags : [],
        venue: e.venue ?? null,
        image: e.image ?? null,
        url: e.url ?? null,
        category: e.category ?? null,
        isFree: e.isFree ?? null,
        price: e.price ?? null,
        // the labeling invariant survives a dataset refresh: a vanished
        // sponsored save must still wear its disclosure everywhere
        sponsored: e.sponsored === true,
      },
    }
  }
  commit(map)
}

// → { ids:Set<key>, list:[{key,savedAt,snapshot}], has(e), toggle(e) }
export function useSaves() {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return { ids: s.ids, list: s.list, has: (e) => s.ids.has(keyOf(e)), toggle: toggleSave }
}

// Saved-shelf items: the live event when its key still exists in the dataset,
// otherwise the stored snapshot (normalized so cards/detail render it fine).
// Past saves wear past:true (grey + "happened") and drop off the shelf 7 days
// after they happened; upcoming saves never disappear. Order: upcoming
// soonest-first, then past most-recent-first.
export function shelfItems(list, events, anchors) {
  const byKey = new Map()
  for (const e of events) byKey.set(keyOf(e), e)
  const out = []
  const expired = []
  for (const s of list) {
    const e = byKey.get(s.key) ?? normalize({ ...s.snapshot }, anchors)
    const endDay = e._endDay ?? e._day
    const past = e._day != null && endDay < anchors.todayTs
    if (past && endDay < anchors.todayTs - 7 * DAY) {
      expired.push(s.key) // storage matches what's shown — no orphaned records
      continue
    }
    out.push({ e, past })
  }
  if (expired.length) {
    // shelfItems runs during render — defer the prune so the store never
    // mutates (and re-emits) mid-render. One-shot: next run finds nothing.
    // ARCHIVE-BEFORE-PRUNE (pre-Sprint-O audit): expiring saves are the raw
    // material of Profile's "Been there" — move them to 'been-there-v1'
    // instead of erasing them. Archiving is reversible; deletion isn't.
    setTimeout(() => {
      const map = { ...store.map }
      const archived = []
      let changed = false
      for (const k of expired) {
        if (k in map) {
          archived.push({ key: k, savedAt: map[k].savedAt, snapshot: map[k].snapshot, archivedAt: Date.now() })
          delete map[k]
          changed = true
        }
      }
      if (changed) {
        try {
          const prev = JSON.parse(localStorage.getItem('been-there-v1'))
          const list = Array.isArray(prev) ? prev : []
          const have = new Set(list.map((x) => x.key))
          localStorage.setItem(
            'been-there-v1',
            JSON.stringify(list.concat(archived.filter((x) => !have.has(x.key))).slice(-200))
          )
        } catch {
          /* private mode — the shelf prune still proceeds; archive is best-effort */
        }
        commit(map)
      }
    }, 0)
  }
  out.sort((a, b) =>
    a.past !== b.past ? (a.past ? 1 : -1) : a.past ? b.e._t - a.e._t : a.e._t - b.e._t
  )
  return out
}

// ♥ toggle. Rendered INSIDE card <button>s, so it's a span[role=button]
// (a nested <button> is invalid HTML); stopPropagation keeps the card from
// opening. big = detail-hero variant (38px). The pop animation plays only on
// a real local toggle-on — never on mount — and saves.css kills it under
// prefers-reduced-motion. Saving never reorders or hides anything.
export function SaveHeart({ e, big }) {
  const { has } = useSaves()
  const on = has(e)
  const [pop, setPop] = useState(false)
  const toggle = (ev) => {
    ev.stopPropagation()
    ev.preventDefault()
    if (!on) setPop(true)
    toggleSave(e)
  }
  return h(
    'span',
    {
      role: 'button',
      tabIndex: 0,
      className: 'save-btn' + (on ? ' on' : '') + (big ? ' save-big' : ''),
      'aria-pressed': on,
      'aria-label': on ? 'Remove from your list' : 'Save to your list',
      onClick: toggle,
      onKeyDown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') toggle(ev)
      },
      onAnimationEnd: () => setPop(false), // bubbles up from .save-ic
    },
    h('span', { className: 'save-ic' + (on && pop ? ' pop' : ''), 'aria-hidden': true }, on ? '♥' : '♡')
  )
}
