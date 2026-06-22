# Events grind — pixel-match to `ref-events.png` (landing)

> **Self-loop grind** (build → restore screenshots [disable anims+grain] → self-verify vs `ref-events.png`
> → iterate to ~95% → commit; scout backstop-verifies; **no human QA**). Runs when we reach Events.
> Light theme · real tokens (`--bg #fcfbf9`, `--card #fefdfb`, `--ink #1a1410`, `--cta #bb5719`+white) ·
> canonical left-image row card · honesty (never-hide, real data).
>
> ⚠️ **NOTABLE CHANGE (confirm):** `ref-events.png` shows "Tonight's best bets" + "This weekend" as
> **vertical left-image cards** with a **"+ Why this fits: …"** reason line. The current HotView uses
> **horizontal carousels** (`TonightCard` 280×210) without "Why this fits." Matching the ref = switch
> those sections to vertical left-image cards + add the honest reason line. (Bigger than Profile/Home —
> it reverses a polished carousel layout. The references are consistent on this: ref-home top-picks are
> vertical left-image cards too. Recommend matching the ref; flag if you'd rather keep carousels.)

## Canonical order (`ref-events.png`)
Header "Events" + "Alex · Tampa, FL" + **search bar** → **filter chips** (Today · Tomorrow · Weekend · Free · Near me) → **"Tonight's best bets"** (vertical left-image cards) → **"This weekend"** (vertical, day-grouped) → *(the extra current sections — Hidden Gems · your-kind-of-night · recently-viewed · "Everything" RowFeed — stay below; theme-fit, never-hide intact).*

## Diffs (current → ref)
- **E-L1 — "Tonight's best bets" + "This weekend" → vertical left-image cards** (image left · time badge · title · venue · category chips · heart), not horizontal carousels. `HotView.jsx` (section render) + `cards.jsx`. *(The "Everything" feed is already vertical — make these match it.)*
- **E-L2 — Add "+ Why this fits: [reason]"** to the event cards. **Honesty-critical:** derive the reason from real signals (taste-category match · free · outdoors · group-friendly) — reuse the detail page's existing why-it-fits logic; **never fabricate.** Omit the line if there's no honest reason. `cards.jsx`.
- **E-L3 — Filter chips** (Today/Tomorrow/Weekend/Free/Near me) match the ref's chip styling. `LensNav.jsx`.
- **E-L4 — Header + search bar** match the ref (likely close — verify sizes/copy). `HotView.jsx` / `App.css` `.loc-head`.
- **E-L5 — Section structure:** lead with Tonight's best bets + This weekend per the ref; keep the extra sections below (theme-fit to the card system). Never-hide / "See all {N}" intact.

## Path-safety
Card-tap → `openDetail` (VT morph), "See all" → bubble, chips → bubble/filter, search → `openSearch` — all existing seams; no opener-signature changes. Card-layout + the why-this-fits line are presentational/derived.

## Honesty
Never-hide (curated ⊆ full, "See all {N}"); "Why this fits" is real-reason-only; free/price honest; sponsored disclosed.

## Self-loop
Build → restore screenshots → self-verify each item vs `ref-events.png` → fix → iterate (≤6) → gate → commit + self-verify table. Scout backstop-verifies. No human QA.
