# W5 + W8 — the capstone proposal (premium · Settings · onboarding)

> ⚠️ **SUPERSEDED — HISTORICAL (Gen 4 satellite: ratified into Phase 3.6).** Decisions made; work shipped. Do not execute from this doc.
> Current master plan = [ROADMAP.md](ROADMAP.md) · full doc map = [INDEX.md](INDEX.md) · idea intake = [BACKLOG.md](BACKLOG.md). Retained for history only.
_2026-06-15 · for Josh + Charles to react to. Scouted (workflow whhz90thg) against the real code; every example is a real string at a real file:line._

**How to use this doc:** this is a *proposal*, not a plan-of-record. Strike, rewrite, or redirect anything. The **⚑ DECISIONS** blocks are the choices I need from you two before I build. Copy rewrites are **DRAFT starting points** — Charles owns the final voice; they're here so there's something concrete to react to rather than a blank page.

Nothing here is built. W5 + W8 are the only two Phase 3.5 workstreams left; both were gated on this direction.

---

## W5 — PREMIUM PASS

### A. Why it reads "childish" (Josh's word), precisely

The scout found **three repeating patterns** — it's not condescending, it's **playful**, and playful undercuts premium:

1. **Emoji inside prose sentences** (vs emoji as a UI icon). ~25 spots. The rule that fixes most of it: *emoji may be an ICON (a category chip, a badge, a bubble) but never a word inside a sentence.*
2. **Cutesy empty/error states** — emptiness is treated as a game.
3. **Over-casual word choices** — "your nights", "money mood", "poke around", "you're in".

**The single worst offenders** (highest visibility):
| Where | Current | The problem |
|---|---|---|
| `cards.jsx:364` | "That's everything. Go touch grass 🌴" | tells the user to leave the app |
| `BubblePage.jsx:47` | "🦗 Crickets tonight. Even Tampa naps sometimes." | false personification of an empty supply |
| `SearchPage.jsx:199` | "Nothing for that… yet. 🦗" | cricket emoji on a dead search |
| `ProfileView.jsx:501` | "Everything you peek at lands here. Go poke around 👀" | talks to the user like a kid |
| `Primer.jsx:90` | "Whatever's good · Worth it is worth it" | childish redundancy |
| `BubblePage.jsx:137` | "Couldn't get a fix 🛰️ …" | emoji softening a real error |

**43 DRAFT copy markers** confirm the whole copy layer is provisional — so this is the natural moment for Charles's one pass.

### B. The proposed voice — DRAFT before/after (⚑ Charles)

The rule: **calm, specific, confident; emoji as icons not words; no winking.** Samples to react to:

| Current | DRAFT premium |
|---|---|
| That's everything. Go touch grass 🌴 | That's the full list. |
| 🦗 Crickets tonight. Even Tampa naps sometimes. | Nothing listed for tonight yet. |
| Nothing for that… yet. 🦗 Try "trivia"… | No matches. Try "trivia" or "free this weekend". |
| Nothing saved yet. Tap the ♡ on anything that looks fun — it lands here. | Nothing saved yet. Tap ♡ on anything to keep it here. |
| Everything you peek at lands here. Go poke around 👀 | Anything you open shows up here. |
| 🎉 Weekends are your nights | You head out on weekends _(the emoji becomes the row's icon, not part of the line)_ |
| Couldn't get a fix 🛰️ — showing the best of the bay instead. | Couldn't find your location — showing the whole bay. |
| MAKE IT YOURS · 3 taps, no account | Set up your feed · Three taps, no account. |

### C. Settings redesign — the "bunch of weird sections"

**Why it reads scattered:** the current "Your taste" heading crams three different *intents* under one bucket — read-only identity (summary + chips), interactive tools (why-feed, customize, primer, deck), and a destructive Reset — and the "Data" section mixes a dev timestamp with a privacy note.

**Proposed intent-grouped structure:**
- **Your taste profile** — the summary line + top-category chips (read-only identity). The "Why your feed looks like this" row **demotes** here (Profile is now its canonical home — the ⚑W5 dedup) retitled to a secondary "See the details".
- **Tune your feed** — Customize interests · Retake the quick primer · Rate & refine _(the calibration deck, retitled so it's not a verbatim copy of Profile's row)_.
- **Reset** — "Start fresh" (the destructive wipe, two-step confirm, alone so it can't be fat-fingered).
- **Your data & privacy** — event count + sources, the "everything's on your phone" line. (Drop the dev "updated {timestamp}" or move it to a quiet footnote.)
- **About** — name/version, credits (X3 fills attribution).

### D. Type / spacing / motion (the cramped feel)

- **Body floor 13.5 → 15px + `line-height: 1.6`** globally (13.5×1.2 ≈ cramped; 15×1.6 breathes). Sites: `ev-seeall`, `st-line`, `pf-empty`, `pf-ask-title`, `detail-desc`.
- **A real spacing scale** (`--sp-xs 8 / --sp-sm 12 / --sp-md 16 / --sp-lg 24`) replacing ad-hoc px; card padding → 16, section margins → 24.
- **Motion**: add `--dur-emphasis 300ms` for featured reveals/modal entrance + tokenize the hero fade; soften press scale 0.97 → 0.98 with an ease-out. (Restraint is already good.)

### ⚑ W5 DECISIONS
1. **Voice direction** — does the DRAFT premium voice (calm, emoji-as-icon-only, no winking) land? Charles owns the rewrite; this is the go/redirect on tone.
2. **Settings structure** — approve the 5-group intent layout (or reshape)?
3. **How far on type/spacing** — ship the body-15/line-height-1.6 + spacing tokens this sprint, or keep it minimal?

---

## W8 — ONBOARDING (ambitious)

### A. Today + the gaps
**Now:** first-open = a 3-tap primer (what gets you out → money → when) → "You're in" → an *optional, buried* "rate 15" deck. Re-entry exists only behind Settings.

**Gaps the scout found:**
- **No IA teaching** — the primer collects data but never shows the user the 5-tab world they're entering.
- **No 2nd/Nth-open story** — a returning user lands on a cold Events tab; there's no pull-based "welcome back / plan your weekend".
- **Inaccurate finish copy** — "gives the feed a head start" frames taste as a *filter*, but taste only ever *reorders* (never hides). The honest promise should match.

### B. Proposed first-open arc (beats — ⚑ shape these)
1. **Welcome** — "Let's find your nights in Tampa Bay" (own the city). One-tap skip always visible.
2. **IA preview (NEW)** — a read-only swipe of the five tabs: *Events · Spots · Map · Calendar · Profile*, one line each on what it **does**. ~30s, primes the post-primer world. _(This is the big "ambitious" addition — see Decision 1.)_
3. **Taste seed** — "What gets you out?" (the current step, premium-voiced, framed as agency: "we'll lead with these").
4. **Money + when** — the two remaining signals, honestly framed.
5. **Taste snapshot (NEW)** — instead of "You're in," show their result: "Your mix: 🎵🌳🍴 · free-leaning · weekends" — proof the data is *applied, not stored*, and it teaches the taste→feed link.
6. **Optional deck, reframed** — "See how your taste sharpens" (educational, not a buried bonus).

### C. Proposed 2nd/Nth-open re-entry (pull-based, ban-list-clean)
- **Pull surfaces, never push:** a Profile "refine your picks" card when taste is thin; a Calendar "planning this weekend?" card → the day planner. No notifications, no daily cadence, no guilt — fully CALENDAR_BRIEF §7 compliant.
- Lands the user back where they started; zero forced cross-sell.

### ⚑ W8 DECISIONS
1. **Teach the IA on first open?** The 5-tab preview is the headline ambition — but it adds a beat (3 taps → ~4–5). Worth it, or keep first-open lean and teach the IA in-context later? **(biggest call)**
2. **Re-entry scope** — Settings-only (today) vs. add the Profile + Calendar pull cards (ambitious)?
3. **Deck in the flow** — keep it a quiet optional finish, or promote it as a narrated "here's how taste works" beat?
4. **Finish framing** — adopt the taste-snapshot screen (and fix the "head start"→reorder honesty)?

---

## How to respond
Mark up the **⚑ DECISIONS** (8 total across W5/W8). The fastest path: tell me the **voice direction** + **Settings structure** for W5, and the **IA-teaching call** for W8 — those three unblock the bulk of the build. Charles can pass the actual copy in parallel (the 43 DRAFT strings + the before/after table). I build once you've steered.
