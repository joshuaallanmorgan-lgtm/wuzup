// finder/warm-preload.mjs — the frozen-clock OFFLINE warm re-run harness.
//
// Purpose: byte-identity / composition proofs for finder changes (the Stage D
// house rule: "Tampa output must stay BYTE-IDENTICAL through every refactor").
// Re-runs the events pipeline entirely from the COMMITTED caches, with:
//   • Date frozen at the committed snapshot's generation instant (the
//     "_Generated …_" stamp in finder/output/<cityId>/events.md), so the alive filter,
//     tonight/weekend tags and hot-score recency reproduce exactly;
//   • global fetch KILLED — every live pull fails, so every source takes its
//     per-source cache fallback (finder/cache/<cityId>/*.json) and no cache is
//     rewritten;
//   • timers clamped to 1 ms — the retry/backoff sleeps collapse (nothing can
//     succeed on retry with fetch dead), so the run takes seconds, not minutes.
//
// Run:   node --import ./finder/warm-preload.mjs finder/finder.mjs
// Vars:  WARM_FROZEN_AT=<ISO instant> overrides the frozen clock.
//        SKIP_IMGCHECK is forced (the image audit is console-only + network).
//
// NOTE: the run still writes finder/output/<cityId>/events.{json,md} and may
// rewrite finder/cache/<cityId>/geocode.json (the null-entry purge). Copy the outputs
// aside for comparison, then restore:
//   git checkout -- finder/output finder/cache
//
// (Rebuilt from the WS1 finder-fixes proof method — "offline warm re-run over
// the committed caches, clock frozen at the snapshot date"; see the
// cohesion/finder-fixes commit messages.)

const FROZEN_AT = process.env.WARM_FROZEN_AT || '2026-07-02T04:36:20.000Z';
const FROZEN_MS = Date.parse(FROZEN_AT);
if (Number.isNaN(FROZEN_MS)) {
  throw new Error(`warm-preload: unparseable WARM_FROZEN_AT '${FROZEN_AT}'`);
}

const RealDate = globalThis.Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FROZEN_MS);
    else super(...args);
  }
  static now() {
    return FROZEN_MS;
  }
}
globalThis.Date = FrozenDate;

globalThis.fetch = async () => {
  throw new Error('offline — fetch disabled by warm-preload');
};

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...rest) => realSetTimeout(fn, 1, ...rest);

process.env.SKIP_IMGCHECK = '1';

console.log(`[warm-preload] clock frozen at ${new Date().toISOString()} · fetch dead · timers clamped`);
