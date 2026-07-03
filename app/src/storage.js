// storage.js — the ONE localStorage seam (Sprint O audit prep #4).
//
// Every persisted key now lives under the 'twh:' namespace: GitHub Pages
// serves every repo of an account from ONE origin, so unprefixed keys like
// 'taste-v1' would collide with any other app deployed there. All ~12 keys
// route through lsGet/lsSet/lsRemove below; modules keep their own JSON
// parse/validate logic (shapes differ per store), this file only owns the
// prefix + the try/catch guard (private mode / Node import safe — the smoke
// harness imports lib/taste/weekend into Node where localStorage may not
// exist; every access here is caught).
//
// MIGRATION: one-shot, at module-eval time (ES module order guarantees this
// runs before any importer's own module-scope load() call). For each known
// legacy key: copy old → prefixed (only when the prefixed copy doesn't exist
// yet — an already-migrated value never gets clobbered), then remove the old
// key. Idempotent by construction: a second boot finds no legacy keys.
// Plain .js, no React, no JSX — Node-importable by design.

export const PREFIX = 'twh:'

// the full legacy key inventory at migration time (Sprint O). New keys added
// after this point are born prefixed and never need to appear here.
const LEGACY_KEYS = [
  'display-mode',
  'primer-v1',
  'taste-v1',
  'recents-v1',
  'saved-events-v1',
  'my-events-v1',
  'weekend-plan-v1',
  'weekend-history-v1',
  'been-there-v1',
  'fmn-seen-v1',
  // stays listed even though the wx key is city-parameterized now (D4): an
  // ancient unprefixed cache first becomes twh:wx-tampa-v1 here, then
  // weather.js's own one-shot migration renames it to twh:wx-<cityId>-v1.
  'wx-tampa-v1',
]

try {
  for (const k of LEGACY_KEYS) {
    const old = localStorage.getItem(k)
    if (old !== null) {
      if (localStorage.getItem(PREFIX + k) === null) localStorage.setItem(PREFIX + k, old)
      localStorage.removeItem(k)
    }
  }
} catch {
  /* Node (no localStorage) or private mode — nothing to migrate, app still works */
}

// raw string accessors — callers own JSON.{parse,stringify} + shape validation
export function lsGet(key) {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null // private mode / Node — callers already treat null as absent
  }
}

// returns true on a persisted write, false when storage swallowed it (quota /
// private mode) — MOST callers ignore this (session state still works), but
// destructive sequences (write-then-remove-source, e.g. the dayplan migration)
// must check it so a failed write can't silently orphan the source data
export function lsSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value)
    return true
  } catch {
    return false /* quota / private mode — in-memory session state still works */
  }
}

export function lsRemove(key) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* same guard as above */
  }
}
