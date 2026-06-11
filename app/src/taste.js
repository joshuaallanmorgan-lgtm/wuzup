// taste.js — the LOCAL taste engine (Sprint G2). No accounts, no network:
// a tiny on-device profile of category affinities + free-preference, built
// from the user's own taps and fully inspectable (inspectTaste / 'taste-v1'
// in localStorage). Taste NEVER filters and NEVER hides — it only nudges
// ordering, bounded hard at +15 (category) +3 (free) points: Charles's
// "slightly tailored, not heavily algorithmic" is the contractual bound.
//
// STORAGE: 'taste-v1' = { catScores: {category: number}, freeAffinity: number,
// n: interactions, v: 1 }. Every localStorage access is guarded — private
// mode / Node keep an in-memory profile for the session.
//
// SIGNALS (one cheap recordSignal(type, e) call at each seam):
//   'save'   +3 to e.category, +1 freeAffinity when the event is free
//            — saves.js toggleSave, toggle-ON only
//   'open'   +1 to e.category            — App.jsx openDetail
//   'fmn'    +2 to EACH category in e.categories (the union of the chosen
//            who/vibe affinity sets)     — FindMyNight, on brief completion
//   'bubble' +0.5 to e.category          — App.jsx openBubble, 'cat' bubbles only
//   'add'    +2 to e.category            — AddEvent submit
//   'went'   +2 to e.category            — saves.js markBeen, "I went 🎉" only
//            (O4 ⚑FLAG-O2 mechanic: self-reported attendance is the strongest
//            honest signal we have without accounts; "missed it" records nothing)
// Each call = one interaction (n += 1). Beyond n=50 every stored score decays
// ×0.98 per new signal (slow drift, no timestamps needed). Any catScore and
// freeAffinity cap at 25.
//
// SYNC: module store + subscriber set (same pattern as saves.js); useTaste()
// exposes the live profile to React via useSyncExternalStore so the
// "Your kind of night" rail appears without a remount once signal exists.
//
// NOTE: plain .js file (same rule as lib.js) — no JSX. Deliberately imports
// nothing from lib.js so saves.js / lib.js can depend on this file cycle-free.
import { useSyncExternalStore } from 'react'
import { PREFIX, lsGet, lsSet } from './storage.js'

const KEY = 'taste-v1' // stored as twh:taste-v1 via storage.js
const CAT_CAP = 25
const DECAY_AFTER = 50 // signals beyond this each decay all scores…
const DECAY = 0.98 // …by this factor
const CONF_FULL = 15 // confidence = min(n / 15, 1)

// fmn is 1 (not 2): one brief touches up to 7-8 categories at once — at 2 a
// single brief outweighed ~5 real saves and could open the rail gate with
// categories the user never actually touched (adversarial review, Sprint G)
const INC = { save: 3, open: 1, fmn: 1, bubble: 0.5, add: 2, went: 2 }

// H1 primer seed weights (recordPrimer)
const PRIMER_CAT = 4 // per chosen category (≈ 1.3 saves / 4 opens of head start)
const PRIMER_FREE = 6 // freeAffinity when "free-leaning" (crosses the ≥5 gate)
const PRIMER_N = 3 // interactions credited for the whole primer

const empty = () => ({ catScores: {}, freeAffinity: 0, n: 0, v: 1 })

const cleanNum = (v, cap) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.min(v, cap) : 0)

function load() {
  try {
    const p = JSON.parse(lsGet(KEY))
    if (p && typeof p === 'object' && !Array.isArray(p) && p.v === 1) {
      const catScores = {}
      if (p.catScores && typeof p.catScores === 'object' && !Array.isArray(p.catScores)) {
        for (const k in p.catScores) {
          const v = cleanNum(p.catScores[k], CAT_CAP)
          if (v > 0) catScores[k] = v
        }
      }
      return {
        catScores,
        freeAffinity: cleanNum(p.freeAffinity, CAT_CAP),
        n: typeof p.n === 'number' && isFinite(p.n) && p.n > 0 ? Math.floor(p.n) : 0,
        v: 1,
      }
    }
  } catch {
    /* absent, corrupt, or private mode — start neutral */
  }
  return empty()
}

let profile = load()
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function persist() {
  lsSet(KEY, JSON.stringify(profile)) // guarded in storage.js — the session profile still works
}

// cross-tab: a signal recorded in another tab folds in (never fires in the writing tab)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (ev) => {
    if (ev.key !== PREFIX + KEY && ev.key !== null) return
    profile = load()
    emit()
  })
}

export function getProfile() {
  return profile
}

// how much the profile is trusted: 0 → 1 over the first 15 interactions
export function confidence(p = profile) {
  return Math.min(p.n / CONF_FULL, 1)
}

export function recordSignal(type, e) {
  const inc = INC[type]
  if (!inc || !e) return
  const next = { catScores: { ...profile.catScores }, freeAffinity: profile.freeAffinity, n: profile.n, v: 1 }
  if (next.n >= DECAY_AFTER) {
    for (const k in next.catScores) next.catScores[k] *= DECAY
    next.freeAffinity *= DECAY
  }
  const cats =
    type === 'fmn'
      ? Array.isArray(e.categories)
        ? e.categories
        : []
      : typeof e.category === 'string' && e.category
        ? [e.category]
        : []
  for (const c of cats) next.catScores[c] = Math.min((next.catScores[c] || 0) + inc, CAT_CAP)
  if (type === 'save' && (e._free === true || e.isFree === true)) {
    next.freeAffinity = Math.min(next.freeAffinity + 1, CAT_CAP)
  }
  next.n += 1
  profile = next
  persist()
  emit()
}

// H1 — PRIMER SEED (the one taste.js seam for Sprint H). One-shot, called by
// Primer.jsx ONLY on finish (skip calls nothing → zero profile mutation).
// THE MATH, documented:
//   +4 per chosen category (max 3, UI-enforced + clamped here) ≈ 1.3 saves or
//      4 detail opens of head start — never near the 25 cap.
//   +6 freeAffinity when free-leaning — crosses tasteNudge's ≥5 free gate, but
//      the free bonus stays ≤ 3 × (6/25) × conf ≈ 0.3 pts at n=6. Pennies.
//   n += 3 → confidence 3/15 = 0.2. The rail gate (HotView) needs 0.4 = n ≥ 6,
//      so a single primer run can't light the rail: it takes ~3 real taps more
//      (caveat: if 'primer-v1' is lost while 'taste-v1' survives, a re-run
//      stacks — acceptable edge; real taps still dominate either way)
//      ("light the rail soon"). At n=6 a primer-only category nudges
//      15 × (4/25) × 0.4 ≈ 0.96 pts — flavor. An organic 20-signal profile
//      (any saved-up category ≥ 15 → nudge ≥ 9 at full confidence) rolls
//      straight over it ("real taps overtake").
// No-op when nothing was actually chosen — done-with-zero-picks must not
// inflate confidence with fake signal.
export function recordPrimer({ cats = [], freeLeaning = false } = {}) {
  const list = (Array.isArray(cats) ? cats : []).filter((c) => typeof c === 'string' && c).slice(0, 3)
  if (!list.length && freeLeaning !== true) return
  const next = { catScores: { ...profile.catScores }, freeAffinity: profile.freeAffinity, n: profile.n, v: 1 }
  for (const c of list) next.catScores[c] = Math.min((next.catScores[c] || 0) + PRIMER_CAT, CAT_CAP)
  if (freeLeaning === true) next.freeAffinity = Math.min(next.freeAffinity + PRIMER_FREE, CAT_CAP)
  next.n += PRIMER_N
  profile = next
  persist()
  emit()
}

// RANK NUDGE — BOUNDED. In [0, 18] total: 15 × (catScore/25) × confidence,
// plus ≤3 for free events once freeAffinity is high (≥5 free saves). Pure
// given (e, p); the default p reads the live module profile.
export function tasteNudge(e, p = profile) {
  if (!p || p.n <= 0) return 0
  const conf = confidence(p)
  const cat = Math.min(p.catScores[e.category] || 0, CAT_CAP)
  let nudge = 15 * (cat / CAT_CAP) * conf
  if ((e._free === true || e.isFree === true) && p.freeAffinity >= 5) {
    nudge += Math.min(3 * (p.freeAffinity / CAT_CAP) * conf, 3)
  }
  return nudge
}

// top-k real categories by affinity ('other' is a fallback bucket, not a taste)
export function topCategories(p = profile, k = 2) {
  return Object.entries(p.catScores)
    .filter(([c, v]) => v > 0 && c !== 'other')
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([c]) => c)
}

// "Why this is here" (G3) — composes ONLY true reasons for a normalized event.
// Zero reasons → empty array → DetailPage renders no line. The taste reason
// appears ONLY when the nudge actually boosted this event materially (>5 pts).
export function whyReasons(e, p = profile) {
  const r = []
  if (typeof e.buzz === 'number' && e.buzz >= 2) r.push(`🔥 ${e.buzz} local sources`)
  if (e._free === true || e.isFree === true) r.push('Free')
  if (e._tonight) r.push('Tonight')
  else if (e._weekend) r.push('This weekend')
  if (e.tags?.includes('hidden-gem')) r.push('💎 Hidden gem')
  if (e.tags?.includes('staff-pick')) r.push('⭐ Staff pick')
  if (e.sponsored === true) r.push('Sponsored placement') // disclosure doubles down
  // Gate on the CATEGORY component only (the free bonus must not smuggle an
  // event past the threshold), and use signal-neutral wording: catScores blend
  // saves/opens/FMN answers/bubble taps — "your taps" is the only claim the
  // data actually supports ("you open a lot of X" was demonstrably false for
  // FMN-only profiles — adversarial review, Sprint G).
  if (e.category && e.category !== 'other' && p && p.n > 0) {
    const catNudge =
      15 * (Math.min(p.catScores[e.category] || 0, CAT_CAP) / CAT_CAP) * confidence(p)
    if (catNudge > 5) r.push(`Your taps lean ${e.category}`)
  }
  return r
}

// the inspect hatch: a copy of the stored profile + the derived values.
// Exposed as window.__taste in the browser so "inspectable" is real, not a claim.
export function inspectTaste() {
  return {
    ...profile,
    catScores: { ...profile.catScores },
    confidence: confidence(profile),
    topCategories: topCategories(profile),
  }
}

// live profile for React (HotView's "Your kind of night" rail)
export function useTaste() {
  return useSyncExternalStore(subscribe, getProfile)
}

if (typeof window !== 'undefined') {
  window.__taste = inspectTaste
}
