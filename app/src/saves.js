// saves.js — localStorage ♥ saves (Sprint C, sanctioned round-2 #4) + the
// "Been there" store (Sprint O4).
//
// STORAGE: 'saved-events-v1' = { [keyOf(e)]: { savedAt, snapshot } }. The
// snapshot keeps just enough of the event (title/start/venue/image/url/
// category/isFree/price) to render a shelf card even after a dataset refresh
// drops the event itself. Every localStorage access is guarded — in private
// mode saves still work for the session, they just don't persist.
//
// BEEN THERE (O4, ⚑FLAG-O2 default mechanic): 'been-there-v1' = an ARRAY of
// { key, snapshot, savedAt?, archivedAt?, status?: 'went'|'missed', statusAt? }.
// Entries arrive two ways: shelf expiry auto-archives them status-less (the
// pre-O archive-before-prune, unchanged shape — old entries stay valid), and
// markBeen() answers the Profile's "Did you make it?" prompt. SELF-REPORTED,
// zero tracking: 'went' feeds taste (+2 category, taste.js) and moves the
// item off the saved list into Been-there; 'missed' just records the answer
// so the prompt never re-asks — no taste signal, nothing else changes.
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
import { Icon, addDayTs, eventLifecycle, keyOf, normalize } from './lib.js'
import { lsGet, lsSet, physicalKey } from './storage.js'
import { recordSignal } from './taste.js'
import './saves.css'

const KEY = 'saved-events-v1' // stored as twh:saved-events-v1 via storage.js
const BEEN_KEY = 'been-there-v1'

function loadMap() {
  try {
    const p = JSON.parse(lsGet(KEY))
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
  lsSet(KEY, JSON.stringify(map)) // guarded in storage.js — in-memory session keeps working
  emit()
}

// ===== the Been-there store (same module-store pattern, own subscriber set
// so save toggles don't re-render been-there consumers and vice versa) =====
const BEEN_CAP = 200
function loadBeen() {
  try {
    const v = JSON.parse(lsGet(BEEN_KEY))
    if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object' && typeof x.key === 'string')
  } catch {
    /* absent, corrupt, or private mode — start empty */
  }
  return []
}
let been = loadBeen()
const beenListeners = new Set()
const emitBeen = () => beenListeners.forEach((l) => l())
function commitBeen(list) {
  been = list.slice(-BEEN_CAP)
  lsSet(BEEN_KEY, JSON.stringify(been)) // guarded in storage.js
  emitBeen()
}

// cross-tab: another tab toggled (prefixed-key match) or cleared storage (key null)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key === physicalKey(KEY) || ev.key === null) {
      store = mk(loadMap())
      emit()
    }
    if (ev.key === physicalKey(BEEN_KEY) || ev.key === null) {
      been = loadBeen()
      emitBeen()
    }
  })
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => store
const subscribeBeen = (l) => {
  beenListeners.add(l)
  return () => beenListeners.delete(l)
}
const getBeen = () => been

// live been-there list for React (ProfileView) — array identity changes on commit
export function useBeenThere() {
  return useSyncExternalStore(subscribeBeen, getBeen)
}

// O4 — answer a "Did you make it?" prompt. Idempotent: an entry that already
// carries a status never re-answers (so the +2 taste signal can't be farmed
// by re-tapping). 'went' also removes the save (the item MOVES to Been-there);
// 'missed' leaves the save alone — it greys out and expires off the shelf on
// its own schedule, and the existing archive dedupe (by key) preserves the
// recorded answer when that expiry lands.
export function markBeen(key, snapshot, status) {
  if (status !== 'went' && status !== 'missed') return
  const idx = been.findIndex((x) => x.key === key)
  if (idx >= 0 && been[idx].status) return
  const snap = (idx >= 0 ? been[idx].snapshot : null) ?? snapshot ?? null
  const now = Date.now()
  const next =
    idx >= 0
      ? been.map((x, i) => (i === idx ? { ...x, snapshot: snap, status, statusAt: now } : x))
      : been.concat({ key, snapshot: snap, archivedAt: now, status, statusAt: now })
  if (status === 'went' && snap) recordSignal('went', snap) // +2 category (taste.js 'went')
  commitBeen(next)
  if (status === 'went' && store.map[key]) {
    const map = { ...store.map }
    delete map[key]
    commit(map)
  }
}

// the persisted snapshot — just enough to render a shelf card (and, for a
// place, to fully round-trip back to PlaceDetail) after a dataset refresh
// drops the live record. Extracted so the smoke harness can assert the
// place round-trip without a DOM (saves.js can't import into Node — it pulls
// in CSS — so the test greps this, but keeping it one function documents the
// contract in one place).
export function snapshotFor(e) {
  const snap = {
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
    status: e.status ?? null,
  }
  // Sprint S: a saved PLACE must reopen as PlaceDetail with a correct ♥.
  // Places are NEVER in the events norm, so shelfItems can't re-resolve a
  // 'p|' key from the live dataset — the snapshot is the ONLY source. Carry
  // kind+key (so keyOf returns 'p|slug' again → App routes to PlaceDetail)
  // plus the fields PlaceDetail renders, so the reopened detail is full.
  if (e.kind === 'place') {
    snap.kind = 'place'
    snap.key = e.key
    snap.name = e.name ?? null
    snap.lat = e.lat ?? null
    snap.lng = e.lng ?? null
    snap.placeType = e.placeType ?? null
    snap.classes = Array.isArray(e.classes) ? e.classes : []
    snap.amenities = Array.isArray(e.amenities) ? e.amenities : []
    snap.hours = e.hours ?? null
    snap.fee = e.fee ?? null
    snap.description = e.description ?? null
    snap.sources = Array.isArray(e.sources) ? e.sources : []
    snap.srcCount = e.srcCount ?? null
    snap.hidden = e.hidden ?? null
  }
  return snap
}

export function toggleSave(e) {
  const k = keyOf(e)
  const map = { ...store.map }
  if (map[k]) {
    delete map[k]
  } else {
    recordSignal('save', e) // taste seam: toggle-ON only (un-saving says nothing)
    map[k] = { savedAt: Date.now(), snapshot: snapshotFor(e) }
  }
  commit(map)
}

// → { ids:Set<key>, list:[{key,savedAt,snapshot}], has(e), toggle(e) }
export function useSaves() {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return { ids: s.ids, list: s.list, has: (e) => s.ids.has(keyOf(e)), toggle: toggleSave }
}

// PROFILE_PHASE2: time-group the saved-shelf for MySavesPage.
// Groups (in order): Upcoming · Yesterday · Earlier this week · Saved earlier.
// Based on the event's end day vs todayTs; past saves drop after 7 days (shelfItems
// contract) so the "Saved earlier" bucket is thin by design.
export function groupShelfByTime(shelf, anchors) {
  const now = anchors.todayTs
  const groups = [
    { key: 'upcoming', label: 'Upcoming', items: [] },
    { key: 'unavailable', label: 'No longer available', items: [] },
    { key: 'today', label: 'Earlier today', items: [] },
    { key: 'yesterday', label: 'Yesterday', items: [] },
    { key: 'week', label: 'Earlier this week', items: [] },
    { key: 'older', label: 'Saved earlier', items: [] },
  ]
  for (const item of shelf) {
    if (!item.past) {
      groups[0].items.push(item)
      continue
    }
    if (item.lifecycle?.code !== 'ended') {
      groups[1].items.push(item)
      continue
    }
    const endDay = item.e._endDay ?? item.e._day ?? 0
    if (endDay >= now) groups[2].items.push(item)
    else if (endDay >= addDayTs(now, -1)) groups[3].items.push(item)
    else if (endDay >= addDayTs(now, -6)) groups[4].items.push(item)
    else groups[5].items.push(item)
  }
  return groups.filter((group) => group.items.length > 0)
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
    const lifecycle = eventLifecycle(e)
    const past = e.kind !== 'place' && !lifecycle.actionable
    if (lifecycle.code === 'ended' && endDay != null && endDay < addDayTs(anchors.todayTs, -7)) {
      expired.push(s.key) // storage matches what's shown — no orphaned records
      continue
    }
    out.push({ e, past, lifecycle })
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
        // archive THROUGH the been store (commitBeen) so an open Profile sees
        // the new entries live. Dedupe by key keeps any already-recorded
        // went/missed answer intact — expiry never overwrites an answer.
        const have = new Set(been.map((x) => x.key))
        const add = archived.filter((x) => !have.has(x.key))
        if (add.length) commitBeen(been.concat(add))
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
export function SaveHeart({ e, big, bare }) {
  const { has } = useSaves()
  const on = has(e)
  const [pop, setPop] = useState(false)
  const toggle = (ev) => {
    ev.stopPropagation()
    ev.preventDefault()
    if (!on) setPop(true)
    toggleSave(e)
  }
  // PREMIUM A2: the engineered stroke heart (outline → filled), retiring ♥ ♡.
  // `bare` = the top-right card-body heart (no disc); default = the image-overlay
  // disc (tiles/hero). Resting outline / saved fill both ride currentColor.
  const Glyph = on ? Icon.heartFill : Icon.heart
  return h(
    'span',
    {
      role: 'button',
      tabIndex: 0,
      className: 'save-btn' + (on ? ' on' : '') + (big ? ' save-big' : '') + (bare ? ' save-bare' : ''),
      'aria-pressed': on,
      'aria-label': on ? 'Remove from your list' : 'Save to your list',
      onClick: toggle,
      onKeyDown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') toggle(ev)
      },
      onAnimationEnd: () => setPop(false), // bubbles up from .save-ic
    },
    h('span', { className: 'save-ic' + (on && pop ? ' pop' : ''), 'aria-hidden': true }, Glyph({ className: 'save-svg' }))
  )
}
