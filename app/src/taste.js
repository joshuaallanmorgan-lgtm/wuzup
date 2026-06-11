// taste.js — the LOCAL taste engine (Sprint G2). No accounts, no network:
// a tiny on-device profile of category affinities + free-preference, built
// from the user's own taps and fully inspectable (inspectTaste / 'taste-v1'
// in localStorage). Taste NEVER filters and NEVER hides — it only nudges
// ordering, bounded hard at +15 (category) +3 (free) points: Charles's
// "slightly tailored, not heavily algorithmic" is the contractual bound.
//
// STORAGE: 'taste-v1' = { catScores: {category: number}, freeAffinity: number,
// n: interactions, explore: number, _interview: object|null, v: 1 }. Every
// localStorage access is guarded — private mode / Node keep an in-memory
// profile for the session. The two Sprint-P fields (v stays 1 — additive;
// load() defaults them for pre-P profiles):
//   explore    — 0..1 "how adventurous" scalar, DEFAULT 0.5. Written ONLY by
//                recordInterview (screen 7) today; future consumers: the
//                calibration deck's sampler spread + FMN's surprise weighting
//                read it later (documented forward contract, MASTER_PLAN2 P2).
//   _interview — the last stated-interests write's APPLIED contribution, kept
//                so a re-write REPLACES it instead of stacking (see
//                recordInterview). Q2c adds answers (the raw answer set) so
//                the InterestEditor reopens showing what was picked.
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
// Plus ONE deliberate-rating seam (Sprint P3/P4): recordCalibration(verdict, e)
//   'yes' +3 / 'no' −1 floored at 0 — the calibration deck's swipe verdicts.
//   The engine's only subtraction; bounds documented at the function.
// Plus ONE batch seed seam (Sprint P2, generalized in Q2c): recordInterview
//   (answers, opts) — the STATED-INTERESTS write, replace-not-stack; math
//   documented there. Caller today: InterestEditor (the manual editor +
//   onboarding answers are ONE store through this seam).
// Plus ONE destructive control (Sprint P1): resetTaste() — settings' "Reset
//   my taste"; wipes store + module profile (callers own the confirm step).
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
import { PREFIX, lsGet, lsRemove, lsSet } from './storage.js'

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

const EXPLORE_DEFAULT = 0.5 // neutral until the interview's screen 7 says otherwise

// declared up here (not with its IV_* siblings below) because cleanInterview
// runs inside load() at module-eval — a later `const` would still be in TDZ
const IV_N = 5 // interactions credited for the whole interview

const empty = () => ({ catScores: {}, freeAffinity: 0, n: 0, explore: EXPLORE_DEFAULT, _interview: null, v: 1 })

const cleanNum = (v, cap) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.min(v, cap) : 0)

// the raw-answers validator (Q2c): _interview.answers is what the
// InterestEditor reads back to show current picks. Same defensive posture as
// everything else here — a corrupt answers blob degrades to null and the
// editor simply opens blank (the deltas bookkeeping above it is untouched, so
// replace-not-stack still removes the right amounts). Pre-Q2 blobs have no
// answers field at all → null, same graceful blank.
function cleanAnswers(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null
  return {
    cats: Array.isArray(a.cats) ? [...new Set(a.cats.filter((c) => typeof c === 'string' && c))] : [],
    indoorOutdoor: a.indoorOutdoor === 'indoor' || a.indoorOutdoor === 'outdoor' ? a.indoorOutdoor : null,
    free: a.free === true ? true : a.free === false ? false : null,
    energy: a.energy === 'chill' || a.energy === 'wild' ? a.energy : null,
    company: a.company === 'solo' || a.company === 'social' ? a.company : null,
    dayparts: typeof a.dayparts === 'string' ? a.dayparts : null,
    explore:
      typeof a.explore === 'number' && isFinite(a.explore) && a.explore >= 0 && a.explore <= 1
        ? a.explore
        : null,
  }
}

// stored-_interview validator (same defensive posture as load's catScores):
// a corrupt blob degrades to null — the next interview simply has nothing to
// subtract, which only ever UNDER-removes (bounded by one interview's size)
function cleanInterview(iv) {
  if (!iv || typeof iv !== 'object' || Array.isArray(iv)) return null
  const deltas = {}
  if (iv.deltas && typeof iv.deltas === 'object' && !Array.isArray(iv.deltas)) {
    for (const k in iv.deltas) {
      const v = cleanNum(iv.deltas[k], CAT_CAP)
      if (v > 0) deltas[k] = v
    }
  }
  return {
    deltas,
    free: cleanNum(iv.free, CAT_CAP),
    // capped at IV_N: a corrupt stored n (say 999) would otherwise floor the
    // whole profile's n to 0 on the next retake's subtraction
    n: typeof iv.n === 'number' && isFinite(iv.n) && iv.n > 0 ? Math.min(Math.floor(iv.n), IV_N) : 0,
    exploreSet: iv.exploreSet === true,
    dayparts: typeof iv.dayparts === 'string' ? iv.dayparts : null,
    answers: cleanAnswers(iv.answers),
  }
}

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
        explore:
          typeof p.explore === 'number' && isFinite(p.explore) && p.explore >= 0 && p.explore <= 1
            ? p.explore
            : EXPLORE_DEFAULT,
        _interview: cleanInterview(p._interview),
        v: 1,
      }
    }
  } catch {
    /* absent, corrupt, or private mode — start neutral */
  }
  return empty()
}

// every writer clones through here so the Sprint-P fields (explore,
// _interview) survive ordinary signals — a hand-rolled next-object that
// forgets them would silently erase the interview's replace bookkeeping
const clone = (p) => ({
  catScores: { ...p.catScores },
  freeAffinity: p.freeAffinity,
  n: p.n,
  explore: p.explore,
  _interview: p._interview, // replaced wholesale by recordInterview, inert elsewhere
  v: 1,
})

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
  const next = clone(profile)
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
  const next = clone(profile)
  for (const c of list) next.catScores[c] = Math.min((next.catScores[c] || 0) + PRIMER_CAT, CAT_CAP)
  if (freeLeaning === true) next.freeAffinity = Math.min(next.freeAffinity + PRIMER_FREE, CAT_CAP)
  next.n += PRIMER_N
  profile = next
  persist()
  emit()
}

// P3/P4 — THE CALIBRATION-DECK SEAM (the one taste.js entry for Sprint P3;
// the P4 negative-signal support lives here). recordCalibration(verdict, e):
//   'yes' ("into it")   +3 to e.category — a deliberate rating is worth a save.
//   'no'  ("not for me") −1 to e.category, FLOORED AT 0 — the engine's first
//        and only subtraction. THE ADVERSARIAL BOUND, documented: scores live
//        in [0, 25] before AND after every call (the floor guarantees ≥0, the
//        cap guarantees ≤25), so tasteNudge stays in [0, 18] and a hostile
//        swiper (e.g. 15 'no's on one category) can only ZERO that category's
//        contribution — never invert it, never affect any other category, and
//        never filter anything (taste only nudges ordering; orderDay is
//        count-preserving by construction). Sim-verified in the Sprint-P run.
//   Deck SAVES never come here — they ride the existing save seam (saves.js
//   toggleSave → recordSignal('save')) so a save is +3 exactly once.
// Each verdict = one interaction (n += 1); the n≥50 ×0.98 decay applies
// unchanged. freeAffinity moves in NEITHER direction (only real saves of free
// events earn it; a rejection says nothing about money). A zeroed score is
// deleted rather than stored — load() drops ≤0 entries anyway (cleanNum), so
// the in-memory shape always matches what a reload would produce.
const CAL_YES = 3 // matches the save weight — both are deliberate "into it"s
const CAL_NO = 1 // subtracted per "not for me", floored at 0
export function recordCalibration(verdict, e) {
  if ((verdict !== 'yes' && verdict !== 'no') || !e) return
  if (typeof e.category !== 'string' || !e.category) return
  const next = clone(profile)
  if (next.n >= DECAY_AFTER) {
    for (const k in next.catScores) next.catScores[k] *= DECAY
    next.freeAffinity *= DECAY
  }
  if (verdict === 'yes') {
    next.catScores[e.category] = Math.min((next.catScores[e.category] || 0) + CAL_YES, CAT_CAP)
  } else {
    const v = Math.max((next.catScores[e.category] || 0) - CAL_NO, 0)
    if (v > 0) next.catScores[e.category] = v
    else delete next.catScores[e.category]
  }
  next.n += 1
  profile = next
  persist()
  emit()
}

// P2 — STATED INTERESTS (recordInterview), generalized in Q2c: born as the
// full interview's finish-only write, now the InterestEditor's LIVE write —
// every editor change calls this with the COMPLETE current answer set, and
// the replace-not-stack bookkeeping makes each call a clean restatement
// (manual edits and onboarding answers are ONE store, Josh's ask).
//
// THE MATH, documented (every weight a named constant below):
//   · category picks (UNLIMITED since Q2c — the editor's grid is the whole
//     registry; duplicates deduped here): +5 each — ≈ 1.7 saves of head
//     start per pick, each category independently capped at 25. Picking
//     everything just flattens the seed layer (equal nudges everywhere =
//     ordering unchanged relative to itself) — it cannot exceed any bound.
//   · indoor/outdoor: 'outdoor' → outdoors +3, sports +3. 'indoor' maps to
//     NOTHING (no honest positive exists; negative signal is
//     recordCalibration's job, not a lean's). NOTE (Q2d): the InterestEditor
//     does not surface this question (cut with the wizard — fewer
//     questionnaires); the parameter stays honored so the seam needs no
//     breaking change, and an old stored outdoor lean is simply replaced
//     away by the editor's first write.
//   · paid/free (screen 3): free-leaning → freeAffinity +8 (crosses the ≥5
//     gate alone; the free bonus is still ≤3 pts by tasteNudge's own clamp).
//   · chill/wild (screen 4): chill → art +2, food +2; wild → nightlife +2,
//     music +2, comedy +2. NEAR-mirror of FMN's VIBE_SETS: FMN's chill also
//     has outdoors+market, dropped here because screen 2 owns outdoors and
//     market earned no honest seed (Sprint V1 unification: mind this delta).
//   · solo/social (screen 5): +2 to the matching who-set — solo →
//     {art, community, outdoors, music}; social → {nightlife, music, sports,
//     comedy, market} (mirrors FindMyNight's WHO_SETS solo/friends; declared
//     here because taste.js must stay JSX-free and import-light).
//   · dayparts (screen 6): NO score math — stored verbatim in _interview
//     for future consumers (FMN window defaults), an honest preference, not
//     an affinity.
//   · adventurous (screen 7): writes profile.explore (0..1, clamped) — a
//     stored preference, NOT additive signal. recordInterview is its only
//     writer today.
//   · n += 5 → interview alone = confidence 5/15 ≈ 0.33, UNDER the rail gate
//     (0.4): a full interview can't light "Your kind of night" by itself.
//
// BOUNDED, the proof sketch: the single-category ceiling is a pick (+5) +
// wild (+2) + social (+2) = +9 ≈ 3 saves; at n=5 that nudges
// 15 × (9/25) × 0.33 ≈ 1.8 pts of 18 — flavor, not a takeover. Real taps
// still dominate ("a full interview ≈ 8–10 real taps of signal, spread").
//
// REPLACE, NEVER STACK: the profile stores the interview's APPLIED deltas
// (post-cap differences, NOT the nominal weights — capped or overlapping
// additions must never subtract organic signal later) under _interview.
// A re-take first subtracts that stored contribution (floored at 0; n
// floored at 0; explore reverted to 0.5 when the prior interview set it),
// then applies the new answers fresh. Run twice with the same answers ≡ run
// once — sim-asserted in the Sprint-P verification (re-proven for the editor
// flow in Q2c). Known drift, accepted + bounded: post-interview decay
// (n≥50 ×0.98/signal) shrinks the applied scores but not the stored deltas,
// so a much-later re-write can over-subtract by at most the decayed slice of
// ONE write — floors keep it safe, real taps re-accumulate.
//
// Q2c additions, exactly two:
//   · _interview.answers — the raw answer set stored verbatim (validated on
//     load by cleanAnswers) so the editor reopens showing what was picked.
//     Pure bookkeeping: zero score math reads it.
//   · opts.allowClear — the editor's "I un-picked everything" path. All-null
//     answers WITH allowClear subtract the previous contribution and store
//     _interview = null: a clean removal of prior deltas only — organic
//     signal untouched, no n credited for stating nothing. WITHOUT allowClear
//     (the historical default) an all-null write stays a full no-op: never
//     inflate confidence with fake signal, never wipe a previous interview on
//     an answerless walk-through.
const IV_CAT = 5 // per picked category (unlimited picks — each capped at CAT_CAP)
const IV_OUTDOOR = 3 // outdoor lean → outdoors + sports
const IV_FREE = 8 // free lean → freeAffinity
const IV_LEAN = 2 // chill/wild + solo/social set members
// (IV_N — the whole-interview n credit, 5 — lives up top for TDZ reasons)
const IV_ENERGY = { chill: ['art', 'food'], wild: ['nightlife', 'music', 'comedy'] }
const IV_COMPANY = {
  solo: ['art', 'community', 'outdoors', 'music'],
  social: ['nightlife', 'music', 'sports', 'comedy', 'market'],
}

export function recordInterview(
  {
    cats = [],
    indoorOutdoor = null,
    free = null,
    energy = null,
    company = null,
    dayparts = null,
    explore = null,
  } = {},
  { allowClear = false } = {}
) {
  const picks = [...new Set((Array.isArray(cats) ? cats : []).filter((c) => typeof c === 'string' && c))]
  const answered =
    picks.length > 0 ||
    indoorOutdoor === 'indoor' ||
    indoorOutdoor === 'outdoor' ||
    free === true ||
    free === false ||
    energy === 'chill' ||
    energy === 'wild' ||
    company === 'solo' ||
    company === 'social' ||
    typeof dayparts === 'string' ||
    (typeof explore === 'number' && isFinite(explore))
  // all-null without allowClear = the historical no-op; with allowClear and
  // nothing stored there is equally nothing to do (a blank restating a blank)
  if (!answered && (!allowClear || !profile._interview)) return

  const next = clone(profile)

  // 1) subtract the previous interview's APPLIED contribution (replace, not stack)
  const prev = next._interview
  if (prev) {
    for (const c in prev.deltas) {
      const left = (next.catScores[c] || 0) - prev.deltas[c]
      if (left > 0) next.catScores[c] = left
      else delete next.catScores[c] // load() drops ≤0 anyway — keep shapes identical
    }
    next.freeAffinity = Math.max(next.freeAffinity - prev.free, 0)
    next.n = Math.max(next.n - prev.n, 0)
    if (prev.exploreSet) next.explore = EXPLORE_DEFAULT
  }

  // allowClear + all-null: the subtraction above WAS the whole job — store no
  // new contribution (and credit no n: stating nothing is not signal)
  if (!answered) {
    next._interview = null
    profile = next
    persist()
    emit()
    return
  }

  // 2) the nominal additions this run wants
  const want = {}
  const bump = (c, by) => (want[c] = (want[c] || 0) + by)
  for (const c of picks) bump(c, IV_CAT)
  if (indoorOutdoor === 'outdoor') for (const c of ['outdoors', 'sports']) bump(c, IV_OUTDOOR)
  if (energy === 'chill' || energy === 'wild') for (const c of IV_ENERGY[energy]) bump(c, IV_LEAN)
  if (company === 'solo' || company === 'social') for (const c of IV_COMPANY[company]) bump(c, IV_LEAN)

  // 3) apply with caps, recording what ACTUALLY landed
  const deltas = {}
  for (const c in want) {
    const before = next.catScores[c] || 0
    const after = Math.min(before + want[c], CAT_CAP)
    if (after > before) {
      next.catScores[c] = after
      deltas[c] = after - before
    }
  }
  let freeDelta = 0
  if (free === true) {
    const before = next.freeAffinity
    next.freeAffinity = Math.min(before + IV_FREE, CAT_CAP)
    freeDelta = next.freeAffinity - before
  }
  let exploreSet = false
  if (typeof explore === 'number' && isFinite(explore)) {
    next.explore = Math.min(Math.max(explore, 0), 1)
    exploreSet = true
  }
  next.n += IV_N
  next._interview = {
    deltas,
    free: freeDelta,
    n: IV_N,
    exploreSet,
    dayparts: typeof dayparts === 'string' ? dayparts : null,
    // the raw answer set, stored canonically (validated values only) so a
    // re-write with identical answers produces a byte-identical store and the
    // editor reopens showing exactly what was picked
    answers: {
      cats: picks,
      indoorOutdoor: indoorOutdoor === 'indoor' || indoorOutdoor === 'outdoor' ? indoorOutdoor : null,
      free: free === true ? true : free === false ? false : null,
      energy: energy === 'chill' || energy === 'wild' ? energy : null,
      company: company === 'solo' || company === 'social' ? company : null,
      dayparts: typeof dayparts === 'string' ? dayparts : null,
      explore: exploreSet ? next.explore : null,
    },
  }
  profile = next
  persist()
  emit()
}

// Q2c — the editor's read-back: the current stated answers, or null when none
// exist. Pre-Q2 _interview blobs carry no answers field; reconstruct ONLY the
// honestly derivable parts (dayparts is stored verbatim; a positive stored
// free delta can only come from free === true; exploreSet means the live
// explore scalar IS the stated preference) and leave the rest blank — the
// first editor write replaces the old contribution wholesale anyway, so a
// blank-opening editor under-shows but never corrupts.
export function interviewAnswers(p = profile) {
  const iv = p._interview
  if (!iv) return null
  if (iv.answers) return { ...iv.answers, cats: [...iv.answers.cats] }
  return {
    cats: [],
    indoorOutdoor: null,
    free: iv.free > 0 ? true : null,
    energy: null,
    company: null,
    dayparts: iv.dayparts,
    explore: iv.exploreSet ? p.explore : null,
  }
}

// P1 — settings' "Reset my taste": wipe the stored profile AND the module
// store in one move (an lsRemove alone would leave the in-memory profile
// serving stale nudges until reload). Also the documented reason this exists
// as a taste.js export rather than settings-side storage poking: `profile`
// is module-private by design. The two-step confirm lives with the CALLER
// (SettingsPage) — this function is the already-confirmed wipe.
export function resetTaste() {
  profile = empty()
  lsRemove(KEY)
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
    _interview: profile._interview
      ? { ...profile._interview, deltas: { ...profile._interview.deltas } }
      : null,
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
