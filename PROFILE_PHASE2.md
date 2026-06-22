# Profile — Phase 2: sub-screens (the 8 destinations)

> The 8 screens behind the Profile menu. **Runs after the Profile landing (`PROFILE_GRIND.md`) locks.**
> Each is its own **self-loop grind** (build → restore screenshots [disable anims+grain] → self-verify
> every item vs its flow panel → fix → iterate to ~95% [≤6 rounds] → gate → commit + self-verify table;
> scout backstop-verifies live computed values; **no human QA**).
>
> **References:** `ref-profile-flows-1.png` = My Plans · My Saves · Recently Saved · Edit Profile.
> `ref-profile-flows-2.png` = Taste Profile · Customize Interests · Settings & Preferences · Help & Feedback.
> Light theme · `--cta #bb5719` + white primaries · canonical left-image row card · honesty (real data, no fake).

## Status + build order
| Screen | Status | Panel |
|---|---|---|
| My Saves | ✏️ polish | flows-1 p2 |
| Customize Interests | ✏️ polish | flows-2 p2 |
| ~~Recently Saved~~ | ⛔ DEFERRED (post-MVP) | flows-1 p3 |
| Edit Profile | 🔨 net-new | flows-1 p4 |
| Help & Feedback | 🔨 net-new | flows-2 p4 |
| My Plans · Taste Profile · Settings | ✅ verify-only | flows-1 p1 · flows-2 p1 · flows-2 p3 |

*(The 3 "verify-only" are reported as already-matching from a code read — so the self-loop still confirms them against the flow panel and fixes any drift; don't assume.)*

## Per-screen

### 1. My Saves (polish) — flows-1 p2 · `MySavesPage.jsx` + `saves.js`
Canonical: filter tabs (All / …) at top + saved list **time-grouped** (Upcoming · Yesterday · Earlier this week · Saved earlier), left-image rows + hearts, past greyed + "Happened" tag.
Diffs: add the filter tabs + time-grouping (new exported helper `groupShelfByTime` in `saves.js` — non-breaking); keep GemRow cards.

### 2. Customize Interests (polish) — flows-2 p2 · `InterestEditor.jsx`
Canonical: interest chips grouped under **Lifestyle / Vibes / Practical** section headers + a **"Save & continue"** button.
Diffs: group the existing chips under the 3 section headers; add the Save & continue CTA (`--cta` + white).

### 3. Recently Saved — ⛔ DEFERRED (post-MVP)
The MVP Profile (`ref-profile-final.png`) **wipes the landing's Recently-saved section**, so this screen
has no entry point. **Do not build for MVP.** (If re-added later: additive `{type:'recentlysaved'}` +
`openRecentlySaved`, reuse the saves store + GemRow + `groupShelfByTime`.)

### 4. Edit Profile (NET-NEW) — flows-1 p4 · absorbs the inline name-edit
Canonical: profile **photo** (w/ edit) + **Name** field + **Location** (read-only city) + a taste blurb + **"Profile preferences"** (preferred city · profile visibility) + **"Save changes"** (`--cta`).
Build: additive `{type:'editprofile'}` + `openEditProfile`; the landing **pencil → `openEditProfile`** (replaces the inline `setEditing`). Name → existing `profile-name-v1`. **Stubbed:** photo upload, preferred-city, visibility (future keys) — honest placeholders, no fake person.

### 5. Help & Feedback (NET-NEW) — flows-2 p4 · replaces the stub row
Canonical: "We love hearing from you" + a hero placeholder + rows: **Contact support · Report a problem · Suggest a feature · FAQs / Give feedback**.
Build: additive `{type:'helpfeedback'}` + `openHelpFeedback`; the landing Help row → `openHelpFeedback`. Row actions = `mailto:` stubs for now; hero = rgba placeholder (no image asset needed).

### 6–8. My Plans · Taste Profile · Settings (verify-only)
Self-loop = verify vs the flow panel (My Plans flows-1 p1 · Taste flows-2 p1 · Settings flows-2 p3); fix only drift. (Settings: confirm the row set/labels match flows-2 p3.)

## Path-safety (from the audit — all additive)
- `nav.jsx` gains `openRecentlySaved` / `openEditProfile` / `openHelpFeedback` — **no mutation** of existing opener signatures.
- `App.jsx` adds 3 render blocks (`{type:'recentlysaved'|'editprofile'|'helpfeedback'}`) after the `mysaves` pattern.
- `ProfileView.jsx`: pencil → `openEditProfile` (remove the inline `setEditing`); Help row → `openHelpFeedback`.
- `profile.css` extensions append-only (`.ep-*`, `.pf-filter-tabs`, `.pf-saves-group` namespaces — no rewrites); `saves.js` `groupShelfByTime` exported (non-breaking).
- Isolated localStorage keys; all net-new close via `closePage()` (existing back/Esc). No changes to Detail/Search/other tabs.

## Scope estimate (from audit): ~300 LOC component + ~150 LOC CSS (append-only).
