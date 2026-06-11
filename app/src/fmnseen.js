// fmnseen.js — the shared WRITE-side mirror of FindMyNight's 'fmn-seen-v1'
// no-repeat memory (Sprint Q3 extraction; previously module-private in
// CalibrationDeck). FindMyNight OWNS the read side and its own pushSeen —
// that file's contract forbids exporting from it, so this module mirrors its
// exact FIFO/cap-40 write shape instead. FMN re-reads the key on every 🎲
// open, so deck rejections land on its very next deal.
//
// Writers today: CalibrationDeck (P3) and LensDeck (Q3) — REJECTIONS ONLY.
// The deliberate asymmetry (documented in CalibrationDeck's header): only
// 'no'/pass verdicts join fmn-seen; an "into it" SHOULD stay pitchable —
// de-prioritizing things the user liked would be self-defeat.
//
// Plain .js, no React — Node-importable for sims. Any contract change here
// must be checked against FindMyNight.jsx's loadSeen/pushSeen (SEEN_CAP 40).
import { lsGet, lsSet } from './storage.js'

const FMN_SEEN_KEY = 'fmn-seen-v1' // stored as twh:fmn-seen-v1 via storage.js
const FMN_SEEN_CAP = 40

export function pushFmnSeen(key) {
  let kept = []
  try {
    const v = JSON.parse(lsGet(FMN_SEEN_KEY))
    if (Array.isArray(v)) kept = v.filter((k) => typeof k === 'string' && k !== key)
  } catch {
    /* absent / corrupt / private mode — start empty */
  }
  lsSet(FMN_SEEN_KEY, JSON.stringify(kept.concat(key).slice(-FMN_SEEN_CAP)))
}
