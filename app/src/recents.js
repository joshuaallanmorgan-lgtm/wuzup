// recents.js — "Recently viewed" memory (Sprint H3) + the in-session view
// list that powers the end-of-feed recap (H4).
//
// STORAGE: 'recents-v1' = [keyOf, …] — a FIFO of event keys, most-recent
// FIRST, hard cap 12. KEYS ONLY, deliberately no snapshots: entries resolve
// against the live dataset at render time and vanished events are silently
// omitted (saves.js owns the snapshot pattern; a "recently viewed" of a
// no-longer-listed event is noise, not a loss). Re-viewing an event moves its
// key to the front (dedupe), it never appears twice.
//
// SESSION: `session` is the same dedupe-to-front list but IN-MEMORY ONLY —
// it resets on every page load by construction (H4's recap is a tonight
// thing, not a forever counter). Distinct events, not raw open count: re-
// opening the same detail five times is one idea eyed, not five.
//
// SYNC: module store + subscriber set (same pattern as saves.js/taste.js);
// useRecents() exposes { keys, session } via useSyncExternalStore. A window
// 'storage' listener folds in views recorded from other tabs (persisted keys
// only — another tab's session is its own).
//
// NOTE: plain .js file (same rule as lib.js/saves.js) — no JSX.
import { useSyncExternalStore } from 'react'
import { keyOf } from './lib.js'
import { PREFIX, lsGet, lsSet } from './storage.js'

const KEY = 'recents-v1' // stored as twh:recents-v1 via storage.js
const CAP = 12

function load() {
  try {
    const v = JSON.parse(lsGet(KEY))
    if (Array.isArray(v)) return v.filter((k) => typeof k === 'string' && k.length > 1).slice(0, CAP)
  } catch {
    /* absent, corrupt, or private mode — start empty */
  }
  return []
}

let keys = load()
let session = [] // keys opened THIS page-load, most recent first, deduped
let snap = { keys, session }
const rebuild = () => {
  snap = { keys, session }
}
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnap = () => snap

function persist() {
  lsSet(KEY, JSON.stringify(keys)) // guarded in storage.js — the session list still works
}

// cross-tab: a view recorded in another tab folds in (never fires in the writing tab)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== PREFIX + KEY && ev.key !== null) return
    keys = load()
    rebuild()
    emit()
  })
}

// the one seam: App.jsx openDetail, right next to recordSignal('open', e)
export function recordView(e) {
  if (!e) return
  const k = keyOf(e)
  if (!k || k === '|') return // an event with no title/url/start has no usable key
  keys = [k, ...keys.filter((x) => x !== k)].slice(0, CAP)
  session = [k, ...session.filter((x) => x !== k)]
  persist()
  rebuild()
  emit()
}

// live { keys, session } for React (HotView's rail + recap)
export function useRecents() {
  return useSyncExternalStore(subscribe, getSnap)
}
