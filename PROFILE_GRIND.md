# Profile grind — pixel-match to `ref-profile-final.png` (FINAL / MVP)

> **THE target is `reference/ref-profile-final.png`.** This is the locked MVP Profile — match it
> **pixel-for-pixel**: iconography, sizing, fonts, text positioning, spacing. It should be **small edits
> from the current build** (mainly: remove "Recently saved," merge identity+stats into one card, resize).
>
> **Method:** self-loop (build → self-verify vs the ref → iterate to pixel-match → commit; scout
> backstop-verifies live computed values; **no human QA**). Tokens already match — this is structure +
> sizing. Keep onboarding/decks dark. Path-safety intact.
>
> **Overlay setup:** copy `reference/ref-profile-final.png` → `app/public/ref-profile-final.png`.

## 0. Global micro-token (apply first)
- `App.css` `.pg-head-title` font-size **21px → 26px** (the one global change the tokens pass found).

## 1. Canonical order (`ref-profile-final.png`)
**"Profile" title** → **identity CARD** (white rounded card: photo avatar · name · city · orange edit pencil — *and* the stats trio inside it: 47 Plans · 128 Saved · 23 Days out) → **6 menu cards** (tinted icon disc · title · description · chevron) → nav. **No "Recently saved." No footer.**

## 2. Diffs (current build → final)
- **F1 — "Profile" page title.** Big bold ink, top-left (mirror Home's title). *(already added — verify size/position vs ref)*
- **F2 — Identity = ONE white card** (rounded ~18px, hairline border + soft shadow) containing **both** the avatar row **and** the stats row. Remove the `--cta` colored fill entirely (white card; name → `--ink`, city → `--muted`). *(Merges the prior separate identity-block + stats into a single card, per the ref.)*
- **F3 — Avatar:** circular, ~48px, top-left of the card. Render a neutral placeholder / monogram (photo upload stubbed — §4). Match the ref's size/position exactly.
- **F4 — Edit pencil:** small **orange** pencil, top-right of the identity card → `setEditing(true)` (→ `openEditProfile` in Phase 2). Replaces the gear; Settings reached via its menu row.
- **F5 — Stats trio inside the card:** **47 Plans · 128 Saved · 23 Days out** — big number (ink, bold) over a muted label, 3 even columns (subtle dividers per the ref). Label **"Saved"** (not "Saves"). Real counts.
- **F6 — 6 menu CARDS** (not flat rows). Each: a rounded white card (hairline border, small gap between cards) with a **tinted rounded icon disc** on the left (orange tint), **title** (bold ink) + **description** (muted) stacked, **chevron** right. Order + copy:
  1. **My Plans** · "Your day plans and upcoming itineraries" · → plans
  2. **My Saves** · "Spots, events, and guides you saved" · → saves
  3. **Taste profile** · "Tell us what you like and improve your picks" · `openTaste()`
  4. **Customize interests** · "Choose topics you love and get better recs" · `openInterests('profile')`
  5. **Settings & preferences** · "Account, notifications, privacy, and more" · `openSettings()`
  6. **Help & feedback** · "Get help or share your thoughts" · stub
- **F7 — REMOVE "Recently saved" entirely** (MVP wipe — no section, no "See all"). *(Was P7; gone.)*
- **F8 — No footer privacy note.** *(remove `.pf-foot` if still present.)*

Match every size/weight/spacing/icon to `ref-profile-final.png` — this screen is the one we ship.

## 3. Path-safety
Every menu card calls its existing opener (`openTaste` / `openInterests('profile')` / `openSettings` / plans / saves). Only structure/styling/sizing change. No nav opener-signature changes.

## 4. New features stubbed (build later — don't block the visual)
- Photo-avatar upload + the pencil's photo edit (neutral placeholder now — honest, not a fake person).
- Help & feedback destination (Phase 2; row tap = placeholder for now).

## 5. SELF-LOOP (autonomous — do NOT stop at first pass)
1. Build §0 + §2.
2. **Restore your eyes:** before capturing, inject `* { animation: none !important; transition: none !important }` + hide the paper-grain layer — clears the screenshot hang. If it works, compare directly to `reference/ref-profile-final.png`.
3. **Self-verify EVERY §2 item** vs the live render (screenshot if working, else `getComputedStyle` + reading `reference/ref-profile-final.png`): title 26px? identity is ONE white card (no `--cta` fill)? stats inside it, "Saved" not "Saves"? 6 menu CARDS with tinted icon discs + descriptions? Recently-saved GONE? footer gone? sizes/fonts/spacing match?
4. **Each mismatch → fix → re-render → re-verify.**
5. **Iterate until it matches `ref-profile-final.png` pixel-for-pixel** (≤6 rounds).
6. Gate (lint + build + `npm test`), commit, report a self-verification table.

**Backstop (no human QA):** scout independently reads live computed values vs `ref-profile-final.png` → **LOCK** or final nudges.
