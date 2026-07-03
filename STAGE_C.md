# STAGE_C — Deep Sweep execution plan (plan-of-record)

> **Why this doc exists:** Stages A and B each had a repo execution doc (PREMIUM_PUNCH, V1_PUNCHLIST);
> Stage C's plan lived only in a 2026-06-30 session kickoff prompt and was nearly lost when both agent
> sessions ended. Recovered verbatim 2026-07-01 and committed here. **House rule going forward:
> execution plans live in repo docs, never only in session prompts.**
> Branch: `stage-c/deep-sweep`. Exit: one Stage-C PR to main. Charter: **hardening, not feature
> change** — token/dedup work must be visually/behaviorally inert (verify computed styles at 460×920);
> intentional visual changes belong to the Cohesion Pass ([ROADMAP.md](ROADMAP.md) §CURRENT).

## Status

| Batch | Commit(s) | Status |
|---|---|---|
| C1 — dead-code deletes | `46c54c5` | ✅ committed |
| C2 — free perf wins | `dfe3174` | ✅ committed (Inter deferred → now ruled YES, see C4.5) |
| C3 — a11y (real AA) | `3391483` + fixup `b0dc9ca` | ✅ committed |
| **Scout Checkpoint 1** | — | ✅ **PASSED 2026-07-01T02:13Z** — independent re-derivation of all 3 AA ratios on composited surfaces (4.84 / 5.33 / 4.84), zero dangling refs, byte-identical places.json mirrors, gate 95/95. Verdict: *"Green-lit to continue to C4 + C5."* (The verdict was orphaned in the dead Architect session; recovered + actioned under the takeover.) |
| Step 0 (takeover housekeeping) | `aebc6c9` + doc sync | ✅ landed on this branch |
| C4 — token consolidation | `ba4ed30` | ✅ committed (inert-verified via live computed-style probes) |
| C4.5 — Inter self-host | `4122f5e` | ✅ committed (Josh ruling #1; variable weights live-verified, GF link gone, favicon restored ⚑ Charles) |
| C5 — dedup + fold-ins | `e06ab6e` `6c4cca5` `bf626ad` + tail `647c59b`→`3192d0c` | ✅ committed (BottomSheet scaffold deliberately deferred — too much collateral for an inert pass) |
| **Scout Checkpoint 2** | — | ✅ **PASSED 2026-07-01** (independent REFUTE agent; 3 doc-only findings fixed in `0783f15`) → **PR #6 MERGED 2026-07-02** |

## C4 — Token consolidation (swaps must be inert)

From the recovered kickoff, scoped to *inert*:

- Mint `--cta-rgb` consumers — the ~10 raw `rgba(187,87,25,…)` literals (`App.css:194`, `calpicker.css:38,39,114`, `day.css:106,108,114,236,295`, `locations.css:401`).
- Tokenize the on-dark accent `#ffb066` (×9: deck.css, lensdeck.css, primer.css) as `--accent-on-dark`.
- Cold-slate/cool-relic stragglers that are *pure token swaps at identical values* (e.g. `bubble.css:118` old `--line`).
- New `--danger` — collapse the 3 error reds (`#dc2626`/`#b91c1c` addevent.css, `#b3261e` day.css) onto one value. *(Judgment: pick the warmest of the three; visually near-inert; flag in the commit.)*
- Tokenize the skeleton-shimmer grays (`cards.css:818`) + the slot-verdict green (`dayfill.css` — moot if C5 deletes dayfill first; sequence C5's delete before this item or skip).
- ⏸ Map near-dupe warm-ink shadows onto the `--shadow-1/2/3` scale — **SKIPPED as NOT-inert** (recon showed the 4 literals genuinely differ from the token values; swapping would change pixels → Cohesion Pass).
- ⏸ Eyebrow-token adoption on stragglers — **DEFERRED into Cohesion ruling-7 work** (the casing ruling rewrites the whole eyebrow landscape; adopting twice is churn).
- **Type/spacing: mint-only in C4** ✅ (scale minted `--t-body/meta/meta-sm/micro`). ⏸ The ~60 same-value `--sp`/type swaps **DEFERRED to the Cohesion Pass re-rhythm** — mass same-value swaps today would be churn the re-rhythm rewrites next week. The visible re-rhythm (snapping 33 ad-hoc sizes / half-pixel sizes onto the scale) was always Cohesion Pass work.
- Tokenize the C3 a11y literals as named tokens (`--free-ink #097045`, `--free-fill-strong #0b8256`, keep `.deckthis` `#a54d12` — smoke.mjs pins it and no compliant alternative exists on the composited pill).

## C4.5 — Inter self-host (Josh ruling #1)

Inter **variable** woff2 (latin subset) → `app/public/fonts/`; one `@font-face { font-weight: 100 900; font-display: swap }`; delete the Google Fonts link + preconnects (`app/index.html:7-9`). The variable font is required — the app uses non-standard weights 550/650/750 that static weights can't render. Verify those weights live before committing. Also restores a favicon casualty check from C2 (the app currently ships no favicon — add a minimal one while touching index.html).

## C5 — Dedup / consolidation (most care — some high-risk)

- ✅ `647c59b` chip-lg + chip-dark primitive migrations (DESIGN_SYSTEM §5's own deferred list: `.loc-tag-chip`, `.loc-amen-chip`, `.deck-chip`, `.dpg-chip` + strays `.srch-recent-chip`, `.detail-catchip`).
- ✅ `84f019a` Symmetric slide-down close on the Filters + loc-plan sheets (they slam shut today; motion tokens exist).
- ✅ `dd6c7e1` Promote the inline nbhd-card into a `cards.jsx` component.
- ✅ `efebf0e` Collapse FiltersSheet's 3 chip-group blocks into a map.
- ✅ `e06ab6e` **DELETE the dead DayFillDeck** (`DayFillDeck.jsx` + `dayfill.js` + `dayfill.css` + the `App.jsx:405` route branch + the pinned `dealDayFill` smoke tests + `fmnseen.js` write-only orphan + its 3 write sites). *Supersedes the kickoff's "fold FillFace into PlaceDeckFace" — the whole surface is unreachable (no `FillDayButton` renderer since `a665936`); git history preserves the reuse option.* ~700 lines.
- ⏸ Extract a shared BottomSheet scaffold (scrim + head + close) — **DEFERRED** (assessed during C5: too much collateral for an inert pass; candidates re-open in the Cohesion Pass if the sheet work there wants it).
- ✅ `3192d0c` ⚠️ **HIGH-RISK: deck.css/lensdeck.css dark-chrome dedup** (~81% duplicate declarations, already drifted 25px/24px). Must be behavior-inert; **re-run the deck coverage sim** (the never-hide proof) after.
- ✅ `6c4cca5` `manualChunks` split of the 428 KB boot bundle (decks/subpages are natural seams).
- ✅ `bf626ad` The C1-deferred `.card*` CSS surgical pass (entangled with live `.card-toast` + `--card*` tokens — scout ruled it into C5).
- ✅ `6c4cca5` Harden the pre-existing flaky `W3 curate` smoke test (`smoke.mjs:2510`).
- ✅ `e06ab6e` **Fold-ins from the 2026-07-01 research sweep** (hardening-class, in charter): the unhandled
  view-transition `ready` rejection guard (`nav.jsx:338` capture + `.catch()`; `nav.jsx:354-361` add
  `ready.catch` + chain cleanup via `finished.catch().finally()`); the hardcoded 1920px hero thumbs →
  960px (`lib.js:41-42` — one-token, ~1.1 MB saved at boot).

## Checkpoint 2 → PR

Independent adversarial verify (sub-agent REFUTE pass, not self-review): token swaps inert via
computed-style diff at 460×920 · deck-dedup behavior-inert incl. the coverage sim · gate
(lint + build + `npm test`) green · then one Stage-C PR to main.
