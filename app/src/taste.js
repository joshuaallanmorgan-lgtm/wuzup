// taste.js — the LOCAL taste engine (Sprint G2, v2 in Sprint V). No accounts,
// no network: a tiny on-device profile of category affinities + free-preference,
// built from the user's own taps and fully inspectable (inspectTaste /
// 'taste-v1' in localStorage). Taste NEVER filters and NEVER hides — it only
// nudges ORDERING, bounded hard at +18 total (15 category + 3 free): Charles's
// "slightly tailored, not heavily algorithmic" is the contractual bound.
//
// ─────────────────────────────────────────────────────────────────────────
// SPRINT V — TASTE ENGINE v2. The math was already documented per-function;
// V unifies the SEED LAYER and adds EXPLICIT control without breaking a single
// invariant. The five hard contracts, restated because V is the most
// invariant-sensitive sprint:
//   1. tasteNudge ∈ [0, 18] for ALL inputs (the fuzz test asserts the ceiling).
//      The V3 mute/boost layer folds in WITHOUT breaching it — re-derived at
//      tasteNudge below.
//   2. Taste NEVER FILTERS, NEVER HIDES — only reorders. A MUTED category's
//      events still appear, just lower; a BOOSTED category's appear higher,
//      bounded. orderDay is count-preserving by construction (lib.js).
//   3. catScores ∈ [0, 25]; freeAffinity ∈ [0, 25]; n is HONEST — an answer
//      that moved no score does not inflate "tuned by N taps" (V1c).
//   4. ONE store. No second taste store; mute/boost lives in this same
//      'taste-v1' blob (the `prefs` field). No new deps.
//   5. The existing tasteNudge fuzz test stays green; V ADDS coverage for
//      mute/boost extremes + the V4 quality benchmark.
// ─────────────────────────────────────────────────────────────────────────
//
// STORAGE: 'taste-v1' = { catScores: {category: number}, freeAffinity: number,
// n: interactions, organicN: interactions from REAL taps only (V1b),
// explore: number, _interview: object|null, _primer: object|null (V1a),
// prefs: {boost:[], mute:[], when: 'weeknights'|'weekends'|'whenever'|null}
// (V1 when-unify + V3), v: 1 }. Every localStorage access is guarded —
// private mode / Node keep an in-memory profile for the session. v stays 1
// (every V field is additive; load() defaults them for pre-V profiles):
//   explore    — 0..1 "how adventurous" scalar, DEFAULT 0.5. Written ONLY by
//                recordInterview (screen 7) today; future consumers: the
//                calibration deck's sampler spread + FMN's surprise weighting
//                read it later (documented forward contract, MASTER_PLAN2 P2).
//   organicN   — interactions from REAL signals only (saves/opens/fmn/bubble/
//                add/went + calibration verdicts), NOT seed writes. The "Your
//                kind of night" rail gates on THIS (V1b): seeds give ordering a
//                head start, but the rail — a surface that claims to know your
//                taste — waits for taps you actually made. confidence() still
//                reads total n (seeds legitimately speed up ordering); only the
//                rail's promise is held to the higher bar.
//   _interview — the last stated-interests write's APPLIED contribution, kept
//                so a re-write REPLACES it instead of stacking (see
//                recordInterview). Q2c adds answers (the raw answer set) so
//                the InterestEditor reopens showing what was picked.
//   _primer    — V1a: the SAME replace-not-stack bookkeeping for recordPrimer.
//                Before V, 5 primer retakes stacked to full confidence; now a
//                retake subtracts the prior primer's applied deltas first.
//   prefs.when — V1 when-preference UNIFICATION (the Q2 carry-in). ONE source
//                of truth for "when do you head out", resolved by
//                whenPreference() below; ProfileView/HotView stop duplicating
//                the primer-vs-dayparts precedence patch.
//   prefs.boost/mute — V3 per-category explicit ordering control: each of the
//                12 categories may be boost / neutral / mute. Folded into
//                tasteNudge as a BOUNDED ordering bump/cut — never a filter.
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
import { lsGet, lsRemove, lsSet, physicalKey } from './storage.js'
import { categoryById } from './categories.js' // registry id set (plain .js, no cycle) — V3 pref validation

const KEY = 'taste-v1' // stored as twh:taste-v1 via storage.js
const CAT_CAP = 25
const DECAY_AFTER = 50 // signals beyond this each decay all scores…
const DECAY = 0.98 // …by this factor
const CONF_FULL = 15 // confidence = min(n / 15, 1)
const RAIL_CONF = 0.4 // "Your kind of night" rail gate (== HotView's bar)
// the organic-tap count that lights the rail — exported so the TastePanel copy
// ("N/{railTarget} so far") can never drift from the actual gate
export const railTarget = Math.round(RAIL_CONF * CONF_FULL)

// fmn is 1 (not 2): one brief touches up to 7-8 categories at once — at 2 a
// single brief outweighed ~5 real saves and could open the rail gate with
// categories the user never actually touched (adversarial review, Sprint G)
const INC = { save: 3, open: 1, fmn: 1, bubble: 0.5, add: 2, went: 2 }

// H1 primer seed weights (recordPrimer)
const PRIMER_CAT = 4 // per chosen category (≈ 1.3 saves / 4 opens of head start)
const PRIMER_FREE = 6 // freeAffinity when "free-leaning" (crosses the ≥5 gate)
const PRIMER_N = 3 // interactions credited for the whole primer (when it moved a score)

// V3 — PER-CATEGORY MUTE/BOOST (explicit ordering control). These are ORDERING
// points added to / subtracted from tasteNudge, NOT affinity scores — they live
// in prefs, never in catScores, and they NEVER filter (a muted category's
// events still render via orderDay's count-preserving permutation, just lower).
// THE RE-DERIVED BOUND (the invariant proof, kept honest at tasteNudge):
//   · BOOST adds +BOOST_BUMP, but the SUM (learned nudge + boost) is clamped to
//     NUDGE_CEIL (18) — a boost can never push a single event's nudge past the
//     ceiling the fuzz test asserts. On a zero-affinity category a boost still
//     lifts it toward (not past) the ceiling; on a maxed category it's already
//     at 18 and the boost is absorbed by the clamp. Bounded by construction.
//   · MUTE subtracts MUTE_CUT, FLOORED AT 0 — mute can only remove a category's
//     own learned lift, never invert it into a negative (which could only ever
//     reorder, but a floor keeps the contribution a clean [0,18] like every
//     other). A muted category with no learned signal contributes 0 and stays
//     0: still ordered (by hotScore alone in orderDay), never removed.
// So with mute/boost folded, tasteNudge still returns a value in [0, 18] for
// ALL inputs — the fuzz test's ceiling holds, and the V3 extreme cases (boost a
// maxed cat, mute a maxed cat, boost+free) are added to it.
const BOOST_BUMP = 6 // explicit "show me more of this" ordering lift (≈ 2 saves)
const MUTE_CUT = 18 // explicit "show me less" ordering cut — enough to zero even
//                     a maxed category's lift (15 cat + 3 free = 18), so mute
//                     reliably sinks it to the floor WITHOUT ever filtering it.
const NUDGE_CEIL = 18 // the hard ceiling the fuzz test asserts (15 cat + 3 free)

const EXPLORE_DEFAULT = 0.5 // neutral until the interview's screen 7 says otherwise

// the unified when-preference vocabulary (V1 Q2 carry-in). Primer's `when` and
// the editor's `dayparts` both speak this after mapping; whenPreference()
// resolves the single source of truth.
const WHEN_VALUES = new Set(['weeknights', 'weekends', 'whenever'])

// declared up here (not with its IV_* siblings below) because cleanInterview
// runs inside load() at module-eval — a later `const` would still be in TDZ
const IV_N = 5 // interactions credited for the whole interview (when it moved a score)

const emptyPrefs = () => ({ boost: [], mute: [], when: null })
const empty = () => ({
  catScores: {},
  freeAffinity: 0,
  n: 0,
  organicN: 0,
  explore: EXPLORE_DEFAULT,
  _interview: null,
  _primer: null,
  prefs: emptyPrefs(),
  v: 1,
})

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

// V1a — stored-_primer validator (mirror of cleanInterview, same defensive
// posture). The primer's APPLIED deltas, kept so a RETAKE replaces instead of
// stacking. A corrupt blob → null → the next primer simply has nothing to
// subtract (under-removes by at most one primer's size, floors keep it safe).
function cleanPrimer(pr) {
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) return null
  const deltas = {}
  if (pr.deltas && typeof pr.deltas === 'object' && !Array.isArray(pr.deltas)) {
    for (const k in pr.deltas) {
      const v = cleanNum(pr.deltas[k], CAT_CAP)
      if (v > 0) deltas[k] = v
    }
  }
  return {
    deltas,
    free: cleanNum(pr.free, CAT_CAP),
    // capped at PRIMER_N for the same reason cleanInterview caps at IV_N
    n: typeof pr.n === 'number' && isFinite(pr.n) && pr.n > 0 ? Math.min(Math.floor(pr.n), PRIMER_N) : 0,
  }
}

// V3 + V1-when — prefs validator. boost/mute are deduped string-id arrays; a
// category is in AT MOST ONE list (boost wins if a corrupt blob lists both, so
// the two are always disjoint and setCategoryPref's invariant holds on load).
// `when` degrades to null unless it's one of the three known values. Same
// graceful-blank posture as everything else here.
// only REAL registry category ids survive — a stale/renamed id in a persisted
// blob would never filter or crash (a nonexistent category has no events) but
// WOULD inflate the panel's "N boosted/dialed down" foot-count past the visible
// chips; dropping it keeps the count honest.
const isRealCat = (c) => typeof c === 'string' && c in categoryById
function cleanPrefs(pf) {
  if (!pf || typeof pf !== 'object' || Array.isArray(pf)) return emptyPrefs()
  const boost = Array.isArray(pf.boost) ? [...new Set(pf.boost.filter(isRealCat))] : []
  const bset = new Set(boost)
  const mute = Array.isArray(pf.mute)
    ? [...new Set(pf.mute.filter((c) => isRealCat(c) && !bset.has(c)))]
    : []
  return {
    boost,
    mute,
    when: WHEN_VALUES.has(pf.when) ? pf.when : null,
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
      const n = typeof p.n === 'number' && isFinite(p.n) && p.n > 0 ? Math.floor(p.n) : 0
      return {
        catScores,
        freeAffinity: cleanNum(p.freeAffinity, CAT_CAP),
        n,
        // V1b: organicN — real-tap interactions only. Pre-V profiles have no
        // field; back-fill to 0 so a legacy seed-only profile does NOT light
        // the rail retroactively (the honest read: it never earned organic
        // signal). A real profile re-accrues organicN on its very next tap.
        organicN: typeof p.organicN === 'number' && isFinite(p.organicN) && p.organicN > 0 ? Math.min(Math.floor(p.organicN), n) : 0,
        explore:
          typeof p.explore === 'number' && isFinite(p.explore) && p.explore >= 0 && p.explore <= 1
            ? p.explore
            : EXPLORE_DEFAULT,
        _interview: cleanInterview(p._interview),
        _primer: cleanPrimer(p._primer),
        prefs: cleanPrefs(p.prefs),
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
  organicN: p.organicN, // V1b
  explore: p.explore,
  _interview: p._interview, // replaced wholesale by recordInterview, inert elsewhere
  _primer: p._primer, // V1a: replaced wholesale by recordPrimer, inert elsewhere
  prefs: { boost: [...p.prefs.boost], mute: [...p.prefs.mute], when: p.prefs.when }, // V3 + V1-when
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
    if (ev.key !== physicalKey(KEY) && ev.key !== null) return
    profile = load()
    emit()
  })
}

export function getProfile() {
  return profile
}

// how much the profile is trusted: 0 → 1 over the first 15 interactions.
// Reads TOTAL n (seeds legitimately speed up how fast ordering tightens — a
// primer head-start IS real preference the user stated). The rail's stricter
// promise uses railConfidence below, not this.
export function confidence(p = profile) {
  return Math.min(p.n / CONF_FULL, 1)
}

// V1b — the "Your kind of night" RAIL's confidence: same 0→1 curve, but over
// ORGANIC interactions only (real taps, never seed writes). DECISION (the
// Sprint-P review carry-in (b), resolved): primer n=3 + interview n=5 lit the
// rail (conf 0.53) with ZERO taps. That surface SAYS "your kind of night" —
// a claim about behavior, not stated intent — so it must be earned by behavior.
// Seeds still tilt ORDERING everywhere (confidence() over total n); only this
// one rail waits for organic signal. railReady() is the boolean HotView gates
// on; the threshold (0.4 == 6 organic taps) is unchanged from the old bar, just
// measured honestly. A pure-seed profile orders better immediately but the rail
// stays silent until the user has actually tapped around — no false "we know
// you" before they've taught us anything.
export function railConfidence(p = profile) {
  return Math.min(p.organicN / CONF_FULL, 1)
}
export function railReady(p = profile) {
  return railConfidence(p) >= RAIL_CONF
}

// V1 (Q2 carry-in) — WHEN-PREFERENCE: the SINGLE source of truth for "when do
// you head out". Before V this precedence lived duplicated in ProfileView AND
// HotView (the editor's dayparts patched over the primer's first-open answer).
// Now ONE resolver, two callers. PRECEDENCE, documented:
//   1. the editor's dayparts (newest, re-editable any time) wins — mapped:
//      'weeknights'→weeknights, 'weekends'→weekends, 'both'→whenever (an
//      explicit "both" overrides an old primer lean to neutral, not nothing).
//   2. else the primer's first-open `when` (passed in — it lives in primer-v1,
//      a separate store this module deliberately doesn't import; the caller
//      hands it over so taste.js stays the single resolver without a new dep).
//   3. else null — no claim. A skipped primer + untouched editor says nothing.
// prefs.when caches the resolved value for inspectTaste/the why-panel, but the
// LIVE resolution always recomputes from the two sources so it can never go
// stale against an editor edit.
const DAYPART_TO_WHEN = { weeknights: 'weeknights', weekends: 'weekends', both: 'whenever' }
export function whenPreference(p = profile, primerWhen = null) {
  const dp = p._interview?.dayparts
  if (dp && DAYPART_TO_WHEN[dp]) return DAYPART_TO_WHEN[dp]
  return WHEN_VALUES.has(primerWhen) ? primerWhen : null
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
  next.organicN += 1 // V1b: every recordSignal is a REAL tap (save/open/fmn/…)
  profile = next
  persist()
  emit()
}

// H1 — PRIMER SEED (the one taste.js seam for Sprint H). One-shot per finish,
// called by Primer.jsx ONLY on finish (skip calls nothing → zero profile
// mutation). V1a made it REPLACE-NOT-STACK (the Sprint-P carry-in (a)): before
// V, five primer retakes stacked to full confidence; now a retake subtracts the
// prior primer's APPLIED contribution (the _primer bookkeeping, exactly the
// _interview pattern) before applying fresh — run twice with the same answers ≡
// run once.
//
// THE MATH, documented:
//   +4 per chosen category (max 3, UI-enforced + clamped here) ≈ 1.3 saves or
//      4 detail opens of head start — never near the 25 cap.
//   +6 freeAffinity when free-leaning — crosses tasteNudge's ≥5 free gate, but
//      the free bonus stays ≤ 3 × (6/25) × conf ≈ 0.3 pts at n=6. Pennies.
//   n += 3 (ONLY when a score actually moved — V1c). The seed credits CONF
//      (total n, so ordering tightens) but NOT organicN, so a primer alone
//      NEVER lights the rail (railReady reads organicN — the (b) decision).
//      At total-n 3 a primer category nudges 15 × (4/25) × 0.2 ≈ 0.48 pts —
//      flavor. An organic 20-signal profile (any saved-up category ≥ 15 →
//      nudge ≥ 9 at full confidence) rolls straight over it.
// V1c HONESTY: if NOTHING landed (e.g. a retake with the same picks already at
// cap, so every applied delta is 0, and free didn't move), credit NO n — a
// primer that moved no score must not inflate "tuned by N". No-op when nothing
// was chosen at all (done-with-zero-picks): same contract as before.
export function recordPrimer({ cats = [], freeLeaning = false } = {}) {
  const list = (Array.isArray(cats) ? cats : []).filter((c) => typeof c === 'string' && c).slice(0, 3)
  if (!list.length && freeLeaning !== true) return
  const next = clone(profile)

  // 1) subtract the previous primer's APPLIED contribution (replace, not stack)
  const prev = next._primer
  if (prev) {
    for (const c in prev.deltas) {
      const left = (next.catScores[c] || 0) - prev.deltas[c]
      if (left > 0) next.catScores[c] = left
      else delete next.catScores[c] // load() drops ≤0 anyway — keep shapes identical
    }
    next.freeAffinity = Math.max(next.freeAffinity - prev.free, 0)
    next.n = Math.max(next.n - prev.n, 0)
  }

  // 2) apply with caps, recording what ACTUALLY landed (post-cap deltas)
  const deltas = {}
  for (const c of list) {
    const before = next.catScores[c] || 0
    const after = Math.min(before + PRIMER_CAT, CAT_CAP)
    if (after > before) {
      next.catScores[c] = after
      deltas[c] = after - before
    }
  }
  let freeDelta = 0
  if (freeLeaning === true) {
    const before = next.freeAffinity
    next.freeAffinity = Math.min(before + PRIMER_FREE, CAT_CAP)
    freeDelta = next.freeAffinity - before
  }
  // V1c: credit n only if a score actually moved; else this primer is signal-free
  const landed = Object.keys(deltas).length > 0 || freeDelta > 0
  const nCredit = landed ? PRIMER_N : 0
  next.n += nCredit
  next._primer = { deltas, free: freeDelta, n: nCredit }
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
  next.organicN += 1 // V1b: a deck verdict is a real deliberate rating, not a seed
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
//     music +2, comedy +2. NEAR-mirror of FMN's VIBE_SETS.chill, which is
//     {art, outdoors, market, food}. THE DELTA, V1d DECISION — BLESSED, not
//     unified: the interview chill set deliberately DROPS outdoors+market.
//     Rationale: (1) the editor's category grid + indoor/outdoor lean already
//     own outdoors as an EXPLICIT pick, so folding it into "chill" too would
//     double-count it — a chill-leaning user who didn't pick outdoors would
//     get an unrequested outdoors seed; (2) "market" has no honest path from
//     "chill" (a chill night isn't a farmers-market signal — that's a who/what
//     pick). FMN keeps the broader set because it's an IN-THE-MOMENT brief
//     (one-shot, lower stakes, +1 each, decays), whereas the interview writes
//     a PERSISTENT seed — so the interview is the more conservative of the two
//     ON PURPOSE. The two seams serve different jobs; the delta is correct,
//     and this comment is the documented call (Sprint V closes the carry-in).
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
//   · n += 5 → interview alone = confidence 5/15 ≈ 0.33 (ordering head-start).
//     But organicN is UNTOUCHED, so the interview NEVER lights "Your kind of
//     night" (railReady reads organicN — V1b). V1c HONESTY: the +5 is credited
//     ONLY when at least one affinity score actually moved (a cat/free delta
//     landed). An affinity-free walk-through — dayparts/indoor/paid-no/explore
//     only, which write preferences but no score — credits ZERO n, so "Tuned by
//     N taps" can never count an answer that moved nothing (the carry-in (c)).
//     indoor maps to nothing and free===false moves nothing, so those alone
//     also credit no n. The stored answers (dayparts/explore) still persist for
//     read-back + the when-resolver; they're preferences, not affinities.
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
  // V1c — credit n ONLY when an affinity score actually moved. An affinity-free
  // interview (dayparts/indoor/paid-no/explore only) writes preferences but no
  // score, so it credits ZERO n — "Tuned by N taps" stays honest. The stored
  // _interview.n MUST match what was credited, or a retake would over-subtract.
  const landed = Object.keys(deltas).length > 0 || freeDelta > 0
  const nCredit = landed ? IV_N : 0
  next.n += nCredit
  next._interview = {
    deltas,
    free: freeDelta,
    n: nCredit,
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

// V3 — PER-CATEGORY MUTE/BOOST (the explicit-control seam). One category at a
// time: pref ∈ {'boost','mute','neutral'}. Stored in prefs.boost/prefs.mute
// (disjoint by construction — setting one removes the category from the other).
// 'neutral' removes it from both. This COMPOSES with the learned nudge but is a
// SEPARATE, user-owned layer (it survives a taste reset only if the caller
// chooses — resetTaste wipes everything, the documented "start from zero").
// NEVER a filter: tasteNudge folds these in as bounded ordering points, and
// orderDay stays count-preserving, so a muted category's events still render.
export function setCategoryPref(category, pref) {
  if (typeof category !== 'string' || !category) return
  if (pref !== 'boost' && pref !== 'mute' && pref !== 'neutral') return
  const next = clone(profile)
  next.prefs.boost = next.prefs.boost.filter((c) => c !== category)
  next.prefs.mute = next.prefs.mute.filter((c) => c !== category)
  if (pref === 'boost') next.prefs.boost.push(category)
  else if (pref === 'mute') next.prefs.mute.push(category)
  profile = next
  persist()
  emit()
}

// the current pref for a category: 'boost' | 'mute' | 'neutral'
export function categoryPref(category, p = profile) {
  const prefs = p.prefs || emptyPrefs() // prefs-less profile guard (parity with tasteNudge)
  if (prefs.boost.includes(category)) return 'boost'
  if (prefs.mute.includes(category)) return 'mute'
  return 'neutral'
}

// V1 (Q2 carry-in) — persist the unified when-preference into prefs. Today the
// LIVE resolver (whenPreference) recomputes from the editor + primer, so this
// cache is read only by inspectTaste/the why-panel for a stable snapshot; it's
// written here so a future "set my when directly" control has a home that the
// resolver already honors (precedence 1.5: an explicit prefs.when would slot
// between dayparts and primer — left for a later sprint, the field exists now).
export function setWhenPref(when) {
  const next = clone(profile)
  next.prefs.when = WHEN_VALUES.has(when) ? when : null
  profile = next
  persist()
  emit()
}

// P1 — settings' "Reset my taste": wipe the stored profile AND the module
// store in one move (an lsRemove alone would leave the in-memory profile
// serving stale nudges until reload). Also the documented reason this exists
// as a taste.js export rather than settings-side storage poking: `profile`
// is module-private by design. The two-step confirm lives with the CALLER
// (SettingsPage) — this function is the already-confirmed wipe.
export function resetTaste() {
  const persisted = lsRemove(KEY)
  profile = empty()
  emit()
  return persisted
}

// RANK NUDGE — BOUNDED. In [0, 18] total: 15 × (catScore/25) × confidence,
// plus ≤3 for free events once freeAffinity is high (≥5 free saves), plus the
// V3 explicit boost/mute fold. Pure given (e, p); the default p reads the live
// module profile.
//
// V3 BOUND PROOF (the invariant the fuzz test guards, re-derived):
//   learned = 15·(cat/25)·conf + freeBonus ∈ [0, 18]  (unchanged — the old law)
//   boosted = learned + BOOST_BUMP, then CLAMPED to NUDGE_CEIL (18)
//   muted   = learned − MUTE_CUT, then FLOORED at 0
//   ⇒ for ALL inputs and ALL prefs, the return is in [0, 18]. A boost can lift
//     a low-affinity category toward the ceiling but never past it; a mute can
//     sink even a maxed (18) category to 0 but never below — so a muted
//     category contributes 0 to ordering (sorted by hotScore alone), STILL
//     present (orderDay is a permutation), never removed. The fuzz test now
//     also throws random boost/mute prefs at it; the ceiling holds.
// A category is in at most one of boost/mute (setCategoryPref keeps them
// disjoint; cleanPrefs enforces it on load), so the two branches never both fire.
export function tasteNudge(e, p = profile) {
  if (!p) return 0
  // clamp BOTH ends: load()/recordCalibration/retake-subtraction never persist a
  // negative score, but a hand-built profile with a negative catScore would
  // otherwise return a negative nudge and invert ordering below neutral — the
  // low half of the [0,18] contract, made defense-in-depth here too.
  const cat = Math.max(0, Math.min(p.catScores[e.category] || 0, CAT_CAP))
  // the explicit pref can act even on a neutral (n=0) profile — it's USER
  // intent, not learned signal — so it must be read before the n<=0 short-out.
  const prefs = p.prefs || emptyPrefs()
  const boosted = e.category && prefs.boost.includes(e.category)
  const muted = e.category && prefs.mute.includes(e.category)

  let learned = 0
  if (p.n > 0) {
    const conf = confidence(p)
    learned = 15 * (cat / CAT_CAP) * conf
    if ((e._free === true || e.isFree === true) && p.freeAffinity >= 5) {
      learned += Math.min(3 * (p.freeAffinity / CAT_CAP) * conf, 3)
    }
  }

  let nudge = learned
  if (boosted) nudge = Math.min(learned + BOOST_BUMP, NUDGE_CEIL)
  else if (muted) nudge = Math.max(learned - MUTE_CUT, 0)
  return Math.max(0, Math.min(nudge, NUDGE_CEIL)) // the [0,18] contract, symmetric + final
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

// V2 — "WHY YOUR FEED LOOKS LIKE THIS": the read-only data the transparency
// panel renders, in plain numbers. Pure given p. Returns the leaning categories
// with their RELATIVE weight (each catScore as a fraction of the strongest, so
// the panel can draw honest proportional bars without exposing raw 0–25), the
// free lean, the unified when-pref, confidence ("tuned by N taps"), and the
// explicit boost/mute lists. NO score math here that the engine doesn't already
// do — this is a view over the same stored numbers, never a second opinion.
//   · `leans` — up to `k` real categories (never 'other'), score-desc, each
//     with { id, score, weight∈(0,1] } where weight = score / topScore. The
//     why-panel shows the bar; the honest claim is "relative to your strongest".
//   · `freeLeaning` — the same ≥5 gate tasteNudge's free bonus uses.
//   · `when` — whenPreference (caller passes primerWhen so the one resolver
//     decides; the panel never re-implements precedence).
//   · `n` / `confidence` / `organicN` / `railReady` — the trust numbers.
//   · `boost` / `mute` — the explicit ordering controls, for the panel to echo.
// EVERYTHING here is ordering-only flavor; the panel's copy says so (taste only
// nudges order, never hides) — that line is a UI constant, not derived.
export function tasteSummary(p = profile, { k = 4, primerWhen = null } = {}) {
  const prefs = p.prefs || emptyPrefs() // prefs-less profile guard (parity with tasteNudge)
  const ranked = Object.entries(p.catScores)
    .filter(([c, v]) => v > 0 && c !== 'other')
    .sort((a, b) => b[1] - a[1])
  const topScore = ranked.length ? ranked[0][1] : 0
  const leans = ranked.slice(0, k).map(([id, score]) => ({
    id,
    score,
    weight: topScore > 0 ? score / topScore : 0,
  }))
  return {
    n: p.n,
    organicN: p.organicN,
    confidence: confidence(p),
    railReady: railReady(p),
    leans,
    freeLeaning: p.freeAffinity >= 5,
    when: whenPreference(p, primerWhen),
    boost: [...prefs.boost],
    mute: [...prefs.mute],
  }
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
    _primer: profile._primer ? { ...profile._primer, deltas: { ...profile._primer.deltas } } : null,
    prefs: { boost: [...profile.prefs.boost], mute: [...profile.prefs.mute], when: profile.prefs.when },
    confidence: confidence(profile),
    railConfidence: railConfidence(profile),
    topCategories: topCategories(profile),
    summary: tasteSummary(profile),
  }
}

// live profile for React (HotView's "Your kind of night" rail)
export function useTaste() {
  return useSyncExternalStore(subscribe, getProfile)
}

if (typeof window !== 'undefined') {
  window.__taste = inspectTaste
}
