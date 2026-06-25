# FLOWS grind — Profile + Home flow screens (decisions + honest-build backlog)

> Scout-audited every flow screen vs `ref-{profile,home}-flows-{1,2}.png` (4 sheets, 16 panels).
> **KEY FINDING: the references are PARTLY ASPIRATIONAL** — they depict an app with data it doesn't
> have (hourly weather, push timestamps, bar venues, richer interests). The "amber" screens are
> largely **honest-correct**; the gap to the refs splits three ways: **§1 global design decisions
> (Josh's call)**, **§2 honestly-buildable features**, **§3 honesty boundaries (DO NOT chase)**.
> Self-loop grind · light theme · real tokens · honesty contract binding throughout.

## Done (shipped on `ui-overnight-grind`)
- **`9d506fe`** — Help & Feedback copy (incl. dropping the false "your account" promise), sports-bars
  subtitle "cold beers"→"great vibes", My Saves group labels → sentence case.
- **`73ab1af`** — Notifications real-photo thumbnails (CardImg art-floor when none), Forecast hero
  reflow (condition beside temp + H/L + Precip) + "Tampa Bay" location subhead, Edit Profile Bio
  field + N/120 counter. All verified live; lint+build+test (85/85) green.

---

## §1 — GLOBAL DESIGN DECISIONS (Josh's call — each drives the rebuild, app-wide not per-screen)
Resolve these FIRST; several also touch Events/Spots, so deciding here unblocks those grinds too.

1. **Header pattern.** App = big left-aligned 26px/800 title (deliberate house style, per PROFILE_GRIND,
   `App.css .pg-head`). Refs = centered ~17px iOS nav bar + a muted **subtitle line** + a right-side
   action (gear/search). Affects EVERY subpage.
   *Rec:* keep the bold-left identity **but add the muted subtitle line** (cheap, high-value, missing
   everywhere) + a right-side action where it earns its place. Don't adopt the full centered iOS bar
   unless you want that look.
2. **Page-title casing.** Refs = Title Case ("My Plans", "Taste Profile"); app = sentence case.
   *Rec:* adopt Title Case for page titles (squarely in "match the text") and apply globally for consistency.
3. **Save icon.** App = heart (`saves.js` SaveHeart, app-wide). Refs = bookmark.
   *Rec:* low priority — keep heart for MVP unless you specifically want the bookmark read. Global swap if changed.
4. **Filter UX.** Refs = an inline, always-visible **filter-chip bar** on destinations/results
   ("Tonight ▾ · Free · Near me · ☰ All filters"). App = a bottom-sheet `FiltersSheet`.
   *Rec:* build the inline chip bar (discoverable, matches refs); keep FiltersSheet behind "All filters".
5. **Result-card layout.** Refs = left-image editorial rows (photo left · time-range · venue · chips ·
   chevron · bookmark). App destinations = right-thumb `CompactRow`. Affects BubblePage/GuidePage/PlaceBubblePage.
   *Rec:* adopt the left-image editorial card for destinations — **the single biggest visual gap.**
6. **BubblePage chrome.** Refs = clean white centered header + search. App = hue-gradient band + emoji
   title + count + tagline + "Deck this".
   *Rec:* move toward the clean white header; relocate "Deck this" below the chip row (keep the real feature).

---

## §2 — HONEST-BUILD BACKLOG (buildable from real data — greenlight per item)
- **Edit Profile:** Planning-radius row (honest selector, or "Soon"); reconcile preference rows
  (ref: Preferred vibe / Plan reminders / Email updates — wire the real ones, "Soon" the rest, drop the
  duplicate "Preferred city"); centered Profile-photo layout + camera badge ("Tap to change — soon"). *(Bio DONE.)*
- **My Plans:** month calendar grid from real `dayplan` slots (`loadDayPlans`/`loadDayHistory`) +
  "Upcoming plans" / "Past highlights" sections with See-all; per-day counts derived from filled slots
  (never seeded titles). Big rebuild — the ref's whole metaphor is calendar-first.
- **My Saves:** filter-axis decision — All/Events/Spots content-type (ref) vs All/Upcoming/Past time (code);
  underline-tab style; move SaveHeart to the row's trailing edge.
- **Taste:** 3-segment Boost/Normal/Mute control + per-row circular icon + descriptor; confidence **ring**
  from real `sum.confidence`. ⚠ **Decision:** keep the intentional "leaning" bars + on-device promise
  (honest transparency you added) or replace with the ref's simpler model?
- **Settings:** single connected card + leading line-icons + chevrons; "Settings & Preferences" title +
  subtitle. Add a Notifications row ONLY if a real settings target exists (else omit — no dead row).
- **Forecast:** per-row rain-% column (real data); best-day two-column reflow + "Best day for outdoors"
  title + templated honest sentence. *(Hero + location DONE.)*
- **Notifications:** date-grouping ONLY where a real time exists (else keep the flat honest list). *(Thumbnails DONE.)*
- **Destinations (Nature/Markets/Sports):** the left-image card (§1.5); Nature page title "Nature"
  (matches the Home tile, vs the activity label "Trails & nature") + a descriptive tagline; the filter-chip row (§1.4).

---

## §3 — HONESTY BOUNDARIES (the refs show these; the app has no real data — DO NOT fabricate)
- **Forecast:** hourly strip, "feels like" (daily fetch only, no apparent-temp field).
- **Notifications:** "6m ago"/Today/Yesterday timestamps (derived items have no received-time); the
  new-market / saved-spot-reopened / plan-updated / sunset-alert TYPES (signals don't exist).
- **Sports bars:** named bar VENUES with street addresses — no venues dataset; honestly shows watch-party
  *events*. **Markets:** recurrence labels ("Saturdays") + per-event tag chips (events carry neither).
- **My Plans:** seeded plan titles ("Sunset + Stadium") + the per-day counts as drawn — derive from real slots only.
- **Edit Profile:** avatar stock person ("Alex"), seeded bio sentence — the monogram/empty floor stays.
- **Interests:** the richer vocab (Travel / Dog-friendly / Date night / Low-key / …) with no backing signals.
- **Tonight's picks:** "Trending" badge — map to the real buzz/`HeatBadge`, never a fake label.
- **Free list:** per-card distance — only honest if the location flow actually runs.
- **"View all {category}" footers:** destination lists are already complete (RowFeed infinite-scroll), so the
  footer is a redundant/dishonest affordance UNLESS it routes to a broader filtered view (an IA decision → §1.4).

---

## Queue / method
Slot **after Plan (P1→P2)**. Resolve §1 first (the save-icon / card-layout / header decisions also affect
Events-full + Spots-full, so settle them once). Each §2 item = self-loop: build → screenshot (anims+grain
disabled) or eval → verify vs the flow ref → iterate ≤6 → gate (lint+build+test) → commit; scout backstop-verifies.
Honesty contract binding — when a ref needs data the app lacks, it's §3, not a bug.
