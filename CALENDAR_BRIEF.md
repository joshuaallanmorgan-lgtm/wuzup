# CALENDAR_BRIEF — "Your Calendar" design brief (Model C: Logbook + Two-Beat)

_Produced 2026-06-11 by a research workflow (Finch teardown + gamification-patterns survey + codebase mapping -> synthesis). The recommendation and sprint decomposition here are folded into MASTER_PLAN2 Sprint U. Appendices preserve the three scout reports._

---

# Calendar v2 — "Your Calendar" Design Brief
_Design-synthesis for Josh (PM call) + Charles (creative calls). Decision-ready. Grounded in the Finch mechanics report, the gamification-patterns report, and the codebase mapping report; load-bearing claims re-verified against the working tree at `c22bed1` (Sprint P) on branch `autonomous-dev-pt2`: the reward contract at `C:\Users\daonl\Desktop\cj\app\src\index.css:15-21` (+ sanctioned #6 in `deck.css:3`), `weekend.js` store shapes, `saves.js` been-there mechanics, and `MASTER_PLAN2.md` (Q2f at line 55, sequence at line 124) all check out as the scout described._

---

## 0. The verdict in three sentences

Build the **journal/passport model with one Finch-derived mechanic transplanted honestly** — the two-beat plan→did loop — and **no companion creature in v1**. The research is unambiguous that records outlive games in this exact domain (every streak/competition product shipped an apology feature or died; the survivors are Letterboxd, Geocaching, and Swarm's lifelog), and the codebase already contains ~70% of the journal model for free (`been-there-v1` IS the journal; `weekend.js` is a day-plan store wearing a weekend costume). The weakest part of the vision as stated is the **daily plan-or-rest prompt cadence** — both research reports independently flag daily cadence as the one Finch mechanic that does not transfer to a 1–3×/week behavior, and the app has no notification channel until Sprint W anyway — so the prompt unit must be *the day you're looking at*, never *every day*.

---

## 1. Critical read of the vision first (the non-cheerleading section)

**Strong and ratified by the evidence:**
- *Opening a day = an exploring/filling screen.* This is the best idea in the vision. It resolves the calendar/list identity question (`MASTER_PLAN2.md` U1/U2) and it's pre-anticipated by Q2f, which already names calendar day-fill as the third decide-for-me sibling.
- *Honestly mark a do-nothing day.* Rest-as-first-class is the #2-ranked respectful mechanic in the patterns report, and it's the design move that distinguishes this from Untappd-for-FOMO. Correct instinct.
- *Create-your-own lives there.* Nearly free — `AddEvent.jsx` already emits schema-v2 events through the same `normalize()` path; the gap is literally a date-prefill payload on `openAdd` (`nav.jsx:137-141`).

**Weak or premature, said plainly:**
1. **"Prompts you to plan your day" — the daily framing is wrong for this domain and impossible pre-W.** Finch's loop works because its target behavior costs 30 seconds and $0; going out costs money, energy, weather, and safety. Both reports converge: a daily plan-or-rest question guarantees chronic failure for the app's most likely user (the anxious, new-in-town person) and recreates the guilt Finch exists to remove. Also, there are no notifications until the PWA (Sprint W), so "prompts" can only mean in-app affordances — empty-state CTAs, a Profile card, the day screen itself. **Reframe: pull-based prompting on weekends, hot days, and any day the user opens. Never a queue of unanswered days.**
2. **"Gamifies" is the dangerous word.** The honest version of this feature is *a record that happens to feel good*, not *a game that happens to be about your life*. Every mechanic below passes Bogost's test from the patterns report: does it *inform* the user about their own life, or *control* their behavior for our DAU chart?
3. **A companion creature is high-cost, low-fit, and quietly threatens the honesty ethos.** Detail in §2 Model A, but the headline: Finch's bird works because of daily cadence + a live-ops content treadmill (seasonal items, micropets, rotating shops) — the two mechanics the Finch report explicitly lists as non-transferable. A local-only companion with ~12 canned reactions is exhausted in three weeks, and "your companion discovered X about Ybor City" postcards either fabricate facts (banned) or require a content pipeline we don't have.
4. **Invites are 90% parked already and should stay parked.** Anything beyond fire-and-forget share (text + ICS) implies RSVP state, which implies a backend, which breaks "nothing leaves your phone" (`ProfileView.jsx`, planned X5 privacy page). The honest v1 is a one-sprint-fraction payload (§5 U-c).
5. **Supply honesty: a random Tampa Tuesday may have 4 events.** A day-fill deck dealt on a thin weekday is an embarrassment until the Places layer (Sprint R–T) provides evergreen "always there" cards. This argues for sequencing the deck *after* Places, not before (§5).
6. **The 56px-cell channel budget is a real constraint, not a styling detail.** Month cells already carry six visual channels (heat tint, numeral, today/selected rings, saved dot, weather emoji, hot ring — `calendar.css:104-176`), the dot position is contractually reserved for saves (UI_SPEC §4), and heat-coral is contractually supply-only. Personal state is a seventh channel on a tiny square. This is a Charles design problem, flagged below — the default assumption should be that rich state lives on the week-strip/day screen and the grid gets at most one subtle mark.

---

## 2. Three candidate models

### Model A — "The Companion" (Finch-faithful)

**Sketch.** A small creature (Charles designs it — a roseate spoonbill? a manatee?) lives at the top of the Calendar tab. Planning a day feeds it energy; attending (self-reported "I went") sends it "along with you"; it returns next morning with a reaction and a postcard for the collection. A rest day = the creature naps contentedly, animated. On the month grid: filled day = tiny creature glyph, rest = sleeping glyph, ignored = empty. **Accumulates:** postcard collection, creature life stages over months, maybe cosmetic items.

**Honest assessment.** This is the model Josh's "Finch-style" phrasing points at, and it has the strongest week-1 charm — the Finch report is clear the bird *is* why Finch retains. But four problems compound:
- **Content treadmill (fatal).** Finch's long-tail novelty is server-delivered live-ops. We have no drop channel; a static creature's reaction pool exhausts in weeks, and a stale companion is worse than none — it visibly advertises that the app stopped caring.
- **Honesty strain.** Postcards/"discoveries" must either fabricate neighborhood facts (banned outright) or be real sourced content (a whole new pipeline). Creature *emotions* are acceptable fiction, but the line is thin and erodes under iteration pressure.
- **Reward-token pressure.** A creature wants celebration constantly. The 6-moment violet contract (`index.css:15-21`, `deck.css:3`) would be under siege every sprint. The codebase mapping report names this exact erosion risk (#5).
- **Cost.** Art, animation, personality copy, new stores: 2+ sprints before a single calendar mechanic ships, and Charles becomes the bottleneck.

### Model B — "The Logbook" (city passport / journal)

**Sketch.** The calendar becomes a record of your life in Tampa Bay, three layers deep:
- **Future days:** tap any day → day screen (agenda + two plan slots, day/night, reusing `pickerModel` verbatim) → a planned day shows a small teal mark on the grid and a richer pill on the week-strip. Marking "rest day" is an *offer on the day screen*, never a question the calendar asks — a quiet moon glyph in muted ink.
- **Past days:** a day where any `been-there` entry has `status==='went'` (derived from `snapshot.start`, per the scout — never `statusAt`) renders a small check. An unmarked past day is **blank — a quiet page, not a gap**. Nothing is ever red, dimmed-as-failure, or counted against you.
- **Accumulates over weeks:** the been-there journal (already capped at 200, `saves.js:65`), a self-anchored "5 days out in June" line (header or Profile — a derivation, not a new store), variety "firsts" (first food festival, first new neighborhood — *breadth*, never volume), and — once the app is a year old — anniversary resurfacing ("a year ago tonight: Gasparilla"). That last one is a sleeper seam, not a v1 feature; we have no year of data yet.

**Honest assessment.** Highest honesty (records only real self-reported actions — the patterns report's thesis: "a streak is a debt; a journal is an asset"), structurally rest-respecting (gaps are blank pages), nearly free (been-there exists; the day-plan store is a generalization of `weekend.js` whose hard logic — `fitsDay`, `daypartOf`, `pickerModel`, `shareText` — needs zero changes). Its one real weakness: **week-2 retention is slower than a pet.** A journal's pull compounds with time; it doesn't charm on day 3. That's the honest trade.

### Model C — "Logbook + the Two-Beat Loop" (the hybrid: the city is the creature)

**Sketch.** Model B's data model and visuals, unchanged, plus exactly one Finch transplant — the **send-off → return loop, with the fiction removed**:
- **Beat 1 (the send-off):** you fill a day — via the day screen's picker, or the day-fill deck once it lands ("18 things could fill this Saturday"), or by creating your own event onto the day. The planned day wears its teal mark. Filling a day IS the send-off; no energy bar, no creature.
- **Beat 2 (the return):** the next time you open the app after a planned day passes, a quiet card sits at the top of the Calendar tab: *"Saturday — did you make it to the Dunedin night market?"* One tap: **Went** → the plan converts to a journal entry, the day's mark turns into a check, and **this conversion is THE one new sanctioned violet moment** (one-shot per day, persisted like `plan.done`, `weekend.js:54-62`). **Missed it** → recorded silently, zero copy about it, exactly like `markBeen('missed')` today — and the day goes blank, not branded.
- Rest days, prompting, counters, firsts: all as Model B. Finch's warmth lives in *copy and timing* (the morning-after question is the bird checking on you, rewritten honestly), not in a sprite.

**Honest assessment.** This is Model B plus ~0.4 sprints, and that's the point: it captures the genuinely transferable Finch mechanics the report identified (#1 energy-from-actions → per-action value with no memory of gaps; #2 the two-beat story per outing; #3 forgiveness architecture wholesale) while refusing the non-transferable ones (creature, daily cadence, content treadmill). The "return" moment is real — it's your own attendance, not a fake adventure — so it's the only version of the Finch loop that survives the no-fabrication invariant.

---

## 3. Scorecard

| Criterion | A — Companion | B — Logbook | C — Logbook + Two-Beat |
|---|---|---|---|
| **Honesty invariants** (no fabrication, events never hidden) | ⚠️ Weak — postcards/discoveries fabricate or starve; fiction creep | ✅ Strongest — records only real self-reported acts | ✅ Strong — the "return" is a real question about a real day |
| **Rest-respect** | ⚠️ OK if Finch-faithful, but every pet is one iteration away from "sad pet" guilt | ✅ Structural — blank pages, optional moon, nothing decays | ✅ Same as B; "Missed it" is silent by design |
| **Local-first / no backend** | ⚠️ Mechanics local, but needs a content-drop channel to stay alive | ✅ Pure derivations over existing local stores | ✅ Same + one local timestamp comparison |
| **Reward-token discipline** | ❌ Constant pressure; contract erosion near-certain | ✅ Easy — zero required; teal/ink throughout | ✅ Contained — exactly one new moment (#7), flagged |
| **Build cost** (per codebase report) | ❌ 2+ sprints before any calendar mechanic; art bottleneck | ✅ ~1.3–1.5 sprints total (store generalization is the bulk) | ✅ ~1.7–2.0 sprints total |
| **Retention power** | Strong weeks 1–3, then the novelty cliff (Pokémon GO arc) with no live-ops to catch it | Slow start, compounds with time (Letterboxd/Swarm-lifelog evidence) | B's compounding + a concrete reason to reopen the morning after every outing |

---

## 4. Recommendation

**Build Model C.** Reasoning, ranked:

1. **It's the only model where every mechanic survives the honesty audit.** The journal records real things; the two-beat loop asks a real question; the violet moment marks a real achievement (you planned a thing and did it — precisely the class of moment the token exists for, per the Sprint-K sanctioning language in `index.css:17-18`).
2. **It's mostly already built.** `been-there-v1` is the journal. `weekend.js` is the plan store minus a key-shape change. The "Did you make it?" prompt exists in ProfileView and just gains a second surface (riding `markBeen`'s idempotency so taste can't be farmed — `saves.js:120-137` pattern). The deck machinery arrives with Q. We are generalizing, not inventing.
3. **The research's strongest finding is on its side.** Every competitive/streak product in the patterns report shipped a confession feature or died; what survived Foursquare's fire was the lifelog. For an app whose ethos is "no fake anything," the journal is the only mechanic that *is* the ethos.
4. **The companion isn't killed, it's correctly priced.** If Charles falls in love with a creature concept, it can be layered onto C later as pure presentation (the creature narrates the journal). Nothing in C forecloses it; everything in A would have had to be rebuilt on C's data model anyway.

---

## 5. Sprint decomposition + roadmap slotting

Current sequence: Q (in flight) → Q2 → R → S → T → U. **Recommended: pull the store work forward; hold the deck back.** The vision replaces Sprint U's current text and splits across the R–T window as app-side payloads (the finder-side R is pipeline-only, "UI later," so there's no collision).

**U-a — Day-plan store + day states + day screen v1** _(~0.8–1.0 sprint · lands immediately after Q2, before/alongside R)_
- `dayplan.js`: generalize `weekend.js` to `'day-plans-v1'` = `{ [dayTs]: { state:'rest'|null, slots:{day,night}, done, v:1 } }`, per-entry `planFor`-grade validation, archive sweep to `'day-history-v1'` (cap ~120).
- **Kill the fork now (recommended option a):** one-shot migration of `weekend-plan-v1` into day entries; WeekendBuilder becomes a 3-column *view* over the new store (LEGACY_KEYS migration pattern in `storage.js` is precedent). Profile's plan card + HistoryCard re-point. ⚑ Josh ratifies.
- Day screen subpage `{type:'day', ts}` (WB's keyed-mount/midnight-rollover trick, `App.jsx:295-298`): weather line (16-day forecast already flows in), agenda (keeps `dayMap`'s one-day semantics), two plan slots via `pickerModel`, rest toggle.
- Month-grid state glyphs — **minimal mark only**, rich state on the week-strip ⚑ Charles.
- _Why before R: S2's "Make this my plan" bridge then targets the generalized store on first build instead of weekend slots — otherwise that bridge is built twice. This is the strongest sequencing argument in the scout report and I endorse it._

**U-c — Create-from-day + Share-this-day** _(~0.3 sprint · rides alongside R's review cycle)_
- `openAdd({date})` prefill + optional auto-slot on submit (the two-line gap, `nav.jsx:137-141` / `AddEvent.jsx`).
- "Share this day": generalized `shareText` (drop the weekend header) + multi-VEVENT ICS (refactor `DetailPage.jsx:65-99` `icsText` into `vevent(e)` + wrapper) + `navigator.share({files})` with download fallback. **This is the entirety of invites v1.**

**U-b — The day-fill deck** _(~0.3–0.5 sprint · lands with T, not before)_
- Third lens into Q's SwipeDeck (per Q2f): pool = `fitsDay` span semantics (labeled "Ongoing" honestly), diversity-interleaved; right = slot-into-day (`daypartOf` auto-routes; 'any' gets a one-tap choice), left = pass (−1 + fmn-seen, the Q3 contract), up = save. ≤3 candidates → honest fallback to the picker (CalibrationDeck empty-phase pattern). One deck per day per session.
- _Why after Places: weekday supply is too thin pre-T; T4's "always there" place cards are exactly what empty Tuesdays need. U-a's picker carries day-filling in the interim. Shipping the deck early on 4-card Tuesdays would burn trust to gain a demo._

**U-d — The two-beat loop + the gentle ledger** _(~0.4–0.5 sprint · after U-a, can ride S or T's review cycle)_
- Did-day derivation from been-there (`snapshot.start`, never `statusAt`); past *personal* days get their own read path (the `dayMap` clamp drops past days — correct for supply, wrong for history).
- Morning-after conversion card on the Calendar tab; "Went" rides the existing `markBeen` seam (idempotent — the +2 stays unfarmable from a second surface).
- **Violet moment #7: planned-day→did-day conversion**, one-shot per day, persisted ⚑ Josh confirms + the `index.css` contract comment gets amended (the running ledger lives in that comment block).
- "N days out in June" self-anchored counter (zero renders as silence, never "0 📉"); variety firsts v1 (3–5 stamps max, breadth-only).
- No new taste signal for slotting in v1 (the smoke harness asserts the nudge ceiling at exactly 18 — extend the sim math later if planning ever earns signal, never bypass it).
- Forward seam, not code: when Sprint W's PWA lands, `day-plans-v1` becomes the notification source — with the tone contract from §7 pre-ratified.

Net: Sprint U's scope roughly doubles (~2–2.5 sessions total vs the planned 1–2), partially repaid by S2's bridge being built once and by U1/U2's chaptered-navigation goals being absorbed into the day screen.

---

## 6. Owner decisions (⚑ genuine Josh/Charles calls, not engineering calls)

1. **⚑ Companion creature: no in v1 (my recommendation) — Charles owns the final creative call.** If he wants character, the honest cheap version is *voice*: the day screen and morning-after card get personality in copy, not a sprite. A creature later rides on C's data model unchanged.
2. **⚑ Violet moment #7** (planned→did conversion): Josh confirms the budget spend; Charles styles the beat. Also decide: fires on *every* conversion (one-shot per day) or *first-ever* only. Recommendation: every conversion, per-day one-shot — matches the weekend-done precedent.
3. **⚑ Rest-day semantics + copy (Charles).** What the mark says ("Recharged 🌙"? "Day off"?), and the rule that rest is *only ever user-initiated* — the app never asks "rest day?" unprompted. Also: rest on a *future* day means "stop suggesting for this day" (intent); rest on a *past* day is a record. Both valid; copy must distinguish them.
4. **⚑ The grid's seventh channel (Charles, the big visual call).** Heat-coral stays supply-only; saved-dot position is taken. Where does personal state live — subtle grid glyph, week-strip pills, or day-screen-only? My default: week-strip carries state, grid gets one quiet mark at most.
5. **⚑ Weekend Builder's fate (Josh).** Migrate-and-reframe as a view (recommended) vs. one-sprint coexistence. Two stores covering the same Friday is a data-integrity bug waiting to happen.
6. **⚑ Prompting waits for W (Josh).** Pull-based only until the PWA; ratify now that no copy ever promises reminders ("we'll nudge you Friday" would be a lie today), and pre-ratify the W-era notification tone contract (§7, ban #3).
7. **⚑ Planning horizon (Josh).** Recommendation: any day the events supply covers, with the honest caveat shown past day 16 ("forecast reaches 16 days out").
8. **⚑ Weekend pill fate** (`CalendarView.jsx:92-96`): retire vs. "this weekend" shortcut into the day screens.
9. **⚑ Invites scope re-ratification (Josh).** Share-only v1; RSVP/attendance stays PARKED with accounts. Saying it now prevents "invites eventually" from creeping into a backend.

---

## 7. The do-NOT-build list (bans, with reasons)

1. **Streaks, in any costume** — including "X weekends in a row." A streak is a debt; the entire confession literature (Duolingo's four mercy SKUs, watchOS 11 ring-pausing) says the mechanic's own owners don't trust it.
2. **Monetized or scarce mercy** (freezes, repairs, savers) — nothing to freeze if nothing decays; selling relief from manufactured anxiety is the worst pattern in the research.
3. **Guilt-toned notifications / confirmshaming** — when W lands: the app may say "23 things are happening Saturday"; it may never say it missed you, your plan is lonely, or your quiet week was a decline.
4. **Leaderboards or any who-went-out-most comparison** — a leaderboard of nights out is a leaderboard of disposable income, free time, and neurotype; also requires a backend. Double-banned.
5. **Volume badges or volume targets** ("5 events this month!") — going out costs money; volume rewards are spending prompts (Untappd's "Take It Easy" badge is the cautionary tale). Firsts/variety only.
6. **FOMO countdowns / artificial reward scarcity** ("attend tonight for the bonus") — manufactured urgency around real-money decisions.
7. **Anything that decays while the user rests** — levels, titles, flames. Rest must be invisible as loss everywhere in the UI.
8. **Quantified judgment of rest** — a zero week renders as a quiet page, never "0 events 📉." The days-out counter goes silent at zero, not red.
9. **Daily check-in cadence** — Finch's multi-daily loop is the explicitly non-transferable mechanic; a daily plan-or-rest question guarantees chronic failure for a 1–3×/week behavior.
10. **A companion that can suffer, sulk, or be neglected** — any sad-pet state is the guilt mechanic in a costume; if a creature ever ships, it is Finch-grade: it only ever waits warmly.
11. **Fabricated discoveries/postcards/facts** — fiction that asserts facts about real places violates the no-fake-data invariant. Creature *feelings* are fiction; "fun facts" are claims.
12. **Recruitment rewards** — points for dragging friends in. Share-this-day is a gift, not a quota.

---

## 8. Engineering risk register (carry into the sprint docs)

- **Midnight edge:** key the day screen by `dayTs` (WB's remount trick); the archive sweep owns the rest-day-marked-yesterday transition — it must move to history, not vanish.
- **Two fits semantics:** agenda uses `dayMap` (one-day honesty); fill pool uses `fitsDay` (span). Counts will differ — each surface states its rule.
- **Taste farming:** all attendance answers ride `markBeen`'s idempotency; slotting earns no signal in v1; smoke-harness nudge ceiling (18) is the wall.
- **Storage hygiene:** new keys auto-`twh:`-prefixed; `planFor`-grade defensive parsing; day-history cap ~120.
- **Re-scout after Q merges:** bind the U-b spec to SwipeDeck's *landed* props, deal/exclude memory keys, and fatigue-guard mechanism — `SwipeDeck.jsx`/`LensDeck.jsx` do not exist in this tree yet.

**Key files:** `C:\Users\daonl\Desktop\cj\app\src\weekend.js` · `app\src\saves.js` · `app\src\CalendarView.jsx` · `app\src\WeekendBuilder.jsx` · `app\src\AddEvent.jsx` · `app\src\nav.jsx` · `app\src\App.jsx` · `app\src\CalibrationDeck.jsx` · `app\src\DetailPage.jsx` · `app\src\index.css` · `app\src\calendar.css` · `C:\Users\daonl\Desktop\cj\MASTER_PLAN2.md` · `C:\Users\daonl\Desktop\cj\UI_SPEC.md` · `C:\Users\daonl\Desktop\cj\test\smoke.mjs`

---

# APPENDIX A — Finch mechanics report

# Finch (Finch Care) — Mechanic Inventory

Research scout report. Sources: Finch help center, Finch Fandom wiki (via search excerpts; direct fetch 403'd), Jacob Rushfinn's retention teardown, Pratt IXD design critiques, therapist review (CLT Counseling), Android Authority hands-on, Polyglossic review, Calmevo Habitica-vs-Finch comparison, assorted UX teardowns. Reddit r/finch was not directly fetchable; community sentiment is captured secondhand through reviews and the MetaFilter/comparison pieces that quote it.

---

## 1. Core daily loop (check-in → goals → energy → adventure → return)

**What it does:** Three anchor touchpoints per day: a morning check-in ("indicate your outlook for the day ahead"), an afternoon mood check, and an evening reflection. Between them, the user taps off goals (preset easy wins like "drink water," "stretch," plus custom goals organized into a color-coded rainbow of life areas). Every completed goal/check-in adds energy to the bird. When the energy bar is full, an Adventure button appears; the bird leaves for Finchie Forest for ~6 hours of real time (longer for younger birds; completing more goals shortens the remaining time) and returns with a "discovery." The user responds with one of two dialogue choices, which shapes the bird's personality, and can write a reflection about it. Over weeks the bird grows through life stages (egg → baby → kid → teen → adult → elder). Low mood at check-in surfaces a "First Aid" button with recommended lift-you-up tasks.

**Psychological job:** Externalizes self-care as caring *for* something — "turns self-discipline into care." The adventure send-off converts "I did my tasks" into "I earned my bird a good day," and the timed return manufactures a guilt-free reason to reopen the app later ("building an instant habit loop" — Rushfinn). The 2-choice discovery dialogue is deliberately low-stakes: no wrong answers, just personality flavor.

**Backend/notifications:** Mostly local. Check-ins, goals, energy, and adventure timers work offline; the return moment is amplified by an optional push notification but degrades gracefully to "open the app and find out."

## 2. Energy mechanic (the famous one)

**What it does:** Energy is earned **per completed action** — each goal, each check-in, first Good Vibe sent each day (+3 energy). Energy resets daily; a full bar triggers the adventure. Critically, energy has **zero memory of yesterday**. A user returning after a month can fill the bar to 100% on day one and get the full reward, identical to a 300-day veteran.

**Psychological job:** This is the anti-streak. Effort today is always worth full value; there is no compounding debt from absence. Reviews repeatedly note it "validates partial success rather than highlighting your gaps" — even doing 3 of 7 goals visibly moves the bar. It rewards *doing*, not *not-stopping*.

**Backend/notifications:** Fully local. It's a counter and a timer.

## 3. Currency: Rainbow Stones

**What it does:** Soft currency earned from quests, milestone achievements, seasonal event days, goals completed *after* the bird returns from its adventure (overflow effort still pays), first daily vibe (+2), daily free gift of ~65–80 stones just for opening Mr. Prickles' shop, and friend-invite codes. Spent in four shops: clothing (Mr. Prickles), birbhouse furniture/decor (Finkea Furnishings — items sellable back at half price), bird colors (Color Studio), and travel destinations (Travel with Sass). Stones also buy streak repairs.

**Psychological job:** Purely **additive and cosmetic** — stones buy expression, never power or progress, so there's nothing to lose and no pay-to-win anxiety. The daily free-stones drop gives a guaranteed reward for merely showing up, decoupled from performance. Nest decoration converts accumulated effort into a visible, persistent artifact.

**Backend/notifications:** Local-capable for earn/spend; shop catalog refreshes and seasonal items are server-delivered content drops.

## 4. Streak handling — the no-shame architecture

**What it does:** Famously, **the bird never dies, never gets sick, never visibly suffers**. Miss a day, a week, a year: nothing decays, nothing is lost, no red badges, no "you broke your streak" screen. The app "simply asks you the question again and you restart" (therapist review). Finch resisted streaks entirely until **June 2024**, then shipped the softest version on the market: the streak counts on *merely opening the app* (no task required); **Pause Mode** in settings freezes it for planned absences; missed days are repairable with Rainbow Stones; and you earn a **free Streak Repair Saver every 3 adventures** (max 2 banked). Notification copy is inverted — the bird checks on *you* ("how are you?", "You can do this"), never "your bird misses you / is starving."

**Psychological job:** Designed explicitly for users with depression/anxiety/ADHD whose "inner monologue is already dominated by guilt." Absence is met with silence, return is met with warmth — making re-entry cost zero. One documented downside (worth noting): a reviewer admits "having no consequence for restarting has made me fall back a little" — gentleness trades away some accountability.

**Backend/notifications:** Fully local (date math + saved repair tokens). Notifications optional.

## 5. First-session onboarding

**What it does:** Pick an egg color → hatch animation → name the bird, choose its pronouns and a personality trait → (2025 versions) a wellness questionnaire mid-flow → auto-populated "Starter Plan" of easy-win goals → first goal completed and first energy earned within minutes — users "earn points in onboarding so they experience gamification mechanics early" — then the paywall (free-trial framing). Rushfinn: "You have the highest drop-off on your first screen. Engage them fast"; the questionnaire builds tailoring perception and sunk-cost investment before the paywall; auto-populated goals solve the empty-screen cold-start.

**Psychological job:** Identity-first onboarding — you've named and hatched a creature before you've entered a single piece of data about yourself, so the relationship exists before the work begins. Easy-win starter goals guarantee a success experience in session one.

**Backend/notifications:** Local except billing.

## 6. Micro-rewards cadence

**What it does:** Nested reward loops at every timescale: per-tap (goal check → energy + bird animation/sound), per-session (check-in → tailored suggestion), ~6-hourly (adventure return → discovery + dialogue + post-adventure goals now pay stones), daily (free shop stones, first-vibe bonus, daily quests), weekly-ish (micropets hatch as you accumulate adventures, friendship levels rise), seasonal (events with exclusive items), and epochal (bird life-stage growth over weeks).

**Psychological job:** A "dopamine loop that nourishes" (Medium review title) — there is always a next small thing, but every loop is additive; no loop can go negative. The micropet hatching gives long-horizon collection appetite without deadline pressure.

**Backend/notifications:** Per-tap/daily loops are local; seasonal events and micropet content require server content drops.

## 7. Social layer: Tree Town

**What it does:** Friends added by code/link appear as birbs in your Tree Town (8 per page, effectively unlimited). Interactions: send **Good Vibes** (first one daily earns *you* 3 energy + 2 stones; builds a Friendship level), **ask for a hug** (rate-limited; friends see the request and respond), send gifts, and **Goal Buddy** — pair on a single shared goal "without exposing your progress to a social feed. Discreet, pressure-free support" (Polyglossic). There are **no leaderboards, no streak comparison, no follower counts, no feed**, and no way to see a friend's overall stats.

**Psychological job:** Support-only asymmetric sociality. You're rewarded for *giving* encouragement (the daily vibe bonus pays the sender), and asking for help is a first-class mechanic (the hug request). Contrast with Habitica, where missed habits damage your party — Finch makes other people a safety net, never an audience or a scoreboard.

**Backend/notifications:** Fully backend-dependent — accounts, friend graph, message relay, push notifications for hugs/vibes.

## 8. Monetization: free vs Finch Plus

**What it does:** The free tier includes the entire core loop — bird, growth, goals, journaling, mood check-ins, adventures, vibes, seasonal events. **Finch Plus** ($9.99/mo or $69.99/yr; historically trialed at $39.99/yr with a 43% discount paywall) adds: deeper mood/habit insights (weekly reports, extended history, tagging), more customization (goal emojis, area colors, all goal durations), extra rare item slots and daily shop discounts, extra seasonal rewards and earlier event micropets, and more reflection/goal suggestions. Finch reportedly passed **$30M/yr revenue**, driven heavily by paid acquisition (~210 active Meta ads at one count). Recurring user criticism: price feels high relative to the soft benefits ("I would gladly pay €15, but €80 a year is too much").

**Psychological job:** The free tier deliberately never holds the emotional core hostage — paying buys *more*, not *relief*. This protects the trust the whole product depends on; a paywalled bird would re-introduce the coercion the design removes.

**Backend/notifications:** Store billing + server entitlements; insights are computable locally in principle.

---

## Why the design community calls it the gentlest gamification on the market

The consensus across teardowns, therapist reviews, and comparisons converges on seven specific choices:

1. **Care-frame inversion** — you are the caregiver, not the graded party; the app's "judgment" surface is a creature that adores you unconditionally.
2. **Energy-not-streaks as the core engine** — value is per-action with no memory, so lapses carry no compounding debt.
3. **Additive-only economy** — nothing is ever taken away; no decay, no death, no losable resources (vs. Habitica's HP loss and party damage, Duolingo's streak loss and passive-aggressive owl).
4. **Silence on absence, warmth on return** — missed days produce no copy at all; notifications are written as the bird caring about *you*.
5. **Partial credit everywhere** — any subset of goals moves the energy bar; "completing your other goals instead" still earns the adventure.
6. **Support-only social** — no comparison surfaces anywhere in Tree Town; help-seeking (hugs) is a mechanic, not an admission.
7. **A free tier that keeps the emotional core free** — monetization never threatens the relationship.
When Finch finally added streaks (2024), it wrapped them in pause mode + stone repairs + auto-earned free repair savers — even its most conventional mechanic ships pre-forgiven.

---

## Five mechanics most transferable to a one-phone, go-out-and-do-stuff-locally app

1. **Energy-from-actions, never streaks.** Each real-world action (viewing/saving/attending an event, walking somewhere new) fills a companion's energy bar; full bar = send-off. Perfect fit because going out is *inherently intermittent* — a streak engine would punish the normal cadence of real life, while an energy engine pays full value whenever the user shows up. 100% local (counter + date math).
2. **The send-off → timed return → discovery loop.** After a confirmed outing, the companion "goes along" and returns hours later with a postcard/fact/discovery about that neighborhood or venue, plus a 2-choice low-stakes response. Manufactures a guilt-free second app-open and turns each outing into a two-beat story. Local timers + optional local notifications; no server needed.
3. **Forgiveness architecture wholesale.** No decay, no death, silence on missed weekends, pause mode for busy/sick weeks, and if any streak-like counter exists, ship it with auto-earned repairs. This is *more* important for going-out than for self-care: nobody can go out daily, so the entire engagement model must assume gaps as the normal state. Fully local.
4. **Additive cosmetic currency + shop.** Tokens earned from outings buy mascot outfits, map skins, collected postcards, nest/room decor — expression, never power, nothing losable. Gives accumulated outings a persistent visible artifact ("look at everywhere we've been") without leaderboards. Fully local; catalog can ship with the app.
5. **Identity-first onboarding with auto-populated easy wins.** Hatch/name a companion in the first 60 seconds, then hand the user a pre-built "starter weekend" of three trivially achievable local wins (save one event, look at one nearby spot, step outside) so the first reward lands in session one with zero blank-slate friction. Fully local.

## Three Finch mechanics that would NOT transfer well

1. **Tree Town (hugs, Good Vibes, goal buddies).** Requires accounts, a friend graph, message relay, push infrastructure, and moderation — all backend, all off the table for a one-phone app. And its psychological job (real humans witnessing and supporting you) can't be faked locally; a simulated version would be exactly the hollow gesture Finch's design avoids.
2. **The multi-times-daily check-in cadence.** Finch's loop assumes the target behavior (a 30-second self-care act) is doable several times a day, every day. Going out is a 1–3×/week behavior; porting daily goal-completion as the energy source would either trivialize it (energy from taps, not outings) or guarantee chronic failure — recreating the guilt Finch exists to remove. The cadence must be re-based to weekly/event rhythm, which changes the mechanic enough that it's a redesign, not a transfer.
3. **The live-ops content treadmill (seasonal events, micropets, rotating shops, Plus perks).** Finch's long-tail retention leans on a team continuously shipping server-delivered seasonal events, hatchable micropet lines, and rotating shop inventory — and its Plus tier monetizes that treadmill. A local single-phone app has no live-ops pipeline and no content-drop channel; a static imitation would exhaust itself in weeks. Long-horizon novelty has to come from the real world (the city's actual event stream) instead — which, conveniently, is the app's whole premise.

---

## Sources

- [Finch help: Energy vs. Rainbow Stones](https://help.finchcare.com/hc/en-us/articles/37780134479757-Energy-vs-Rainbow-Stones) · [Going on an Adventure](https://help.finchcare.com/hc/en-us/articles/37779979512845-Going-on-an-Adventure) · [Understanding Streaks](https://help.finchcare.com/hc/en-us/articles/37780736136205-Understanding-Streaks) · [Finch Plus Pricing](https://help.finchcare.com/hc/en-us/articles/38755205001869-Finch-Plus-Pricing) · [Benefits of Finch Plus](https://help.finchcare.com/hc/en-us/articles/37780200600589-Benefits-of-Finch-Plus) · [Shops in Finch](https://help.finchcare.com/hc/en-us/articles/37935977276813-Shops-in-Finch-Outfits-Travel-and-More) · [New User Guide](https://help.finchcare.com/hc/en-us/articles/42149821015693-New-User-Guide)
- [Life of a birb — Jacob Rushfinn, Retention.Blog](https://www.retention.blog/p/life-of-a-birb) (onboarding/paywall/revenue teardown)
- Finch Fandom wiki: [Rainbow Stones](https://finch.fandom.com/wiki/Rainbow_Stones) · [Energy](https://finch.fandom.com/wiki/Energy) · [Adventuring](https://finch.fandom.com/wiki/Adventuring) · [Tree Towns](https://finch.fandom.com/wiki/Tree_Towns) · [Good Vibes](https://finch.fandom.com/wiki/Good_Vibes) · [Streaks](https://finch.fandom.com/wiki/Streaks) · [Finkea Furnishings](https://finch.fandom.com/wiki/Finkea_Furnishings) · [Finch Plus](https://finch.fandom.com/wiki/Finch_Plus)
- [Polyglossic: Finch review](https://www.polyglossic.com/finch-tiny-bird-big-habits-review/) · [CLT Counseling therapist review](https://www.cltcounseling.com/all-resources/finch-habit-tracker-app-review) · [Android Authority hands-on](https://www.androidauthority.com/finch-habit-tracker-app-hands-on-3537434/) · [Yoga Journal](https://www.yogajournal.com/lifestyle/finch-self-care-app/) · [aViewFromTheCave deep dive](https://www.aviewfromthecave.com/what-is-finch-app/)
- UX/design: [Deepthi John Alexander UX teardown](https://medium.com/@deepthi.aipm/ux-teardown-finch-self-care-app-18122357fae7) · [Pratt IXD design critique 2025](https://ixd.prattsi.org/2025/09/design-critique-finch-ios-app-2/) · [Pratt IXD 2026](https://ixd.prattsi.org/2026/02/design-critique-finch-self-care-pet-ios-app/) · [Christina Hill onboarding comparison](https://medium.com/design-bootcamp/main-character-energy-how-two-habit-building-apps-build-motivation-in-onboarding-a3d144bd2818) · [Elora Indran, "A Dopamine Loop That Nourishes You"](https://medium.com/illumination/a-dopamine-loop-that-nourishes-you-finch-is-my-favourite-self-care-app-right-now-151c05fefd2b)
- Comparisons/community: [Calmevo Habitica vs Finch](https://calmevo.com/habitica-vs-finch/) · [Calmevo Finch review](https://calmevo.com/finch-app-review/) · [MetaFilter thread](https://www.metafilter.com/207203/Habit-forming-for-good-with-Finch) · [Reset ADHD](https://www.resetadhd.com/adhd-resource-hub/finch-self-care) · [XDA hands-on](https://www.xda-developers.com/finch-productivity-coach/) · [Naavik gamification deep dive](https://naavik.co/deep-dives/deep-dives-new-horizons-in-gamification/) · [Finch official FAQ (Notion)](https://befinch.notion.site/Finch-FAQ-474652d0123d4883ac7a0cd6c8f5aa70)

Caveats: finch.fandom.com, help.finchcare.com article bodies, and metafilter.com blocked direct fetch (HTTP 403); details from those domains come from search-result excerpts and are consistent across multiple independent sources. Reddit r/finch was not directly accessible; community sentiment is secondhand. Adventure duration is reported as ~6 hours by most sources (one teardown says 8 — likely version/age-of-bird variance).

# APPENDIX B — Gamification patterns report

# Gamifying Real-World Activity: What Worked, What Soured, and What to Ban

Research scout report for a city-events discovery app considering gamification of going out. Bottom line up front: **every major real-world gamification product that leaned on competitive/streak mechanics either removed them, softened them, or shipped a "mercy" feature that amounts to a confession the mechanic hurts people.** The survivors (Geocaching, Letterboxd, Finch) are the ones built on collection, journaling, and community rather than obligation.

---

## 1. Per-Product Autopsies

### Pokémon GO (2016–present)

**What worked**
- The strongest real-world-pull evidence in the entire space. A [systematic review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8123321/) found players increased daily steps up to 25% in early months, with significantly more moderate physical activity than non-players, plus improved mood and social interaction.
- **Scheduled communal events beat daily obligation.** Community Days and GO Fest concentrate play into specific shared windows — [GO Fest Sendai attendees averaged 28 km walked](https://sentientbyelysian.com/blogs/pokemon-go-experiential-marketing). The mechanic is "show up to this thing with other people," not "show up every day or lose something." That maps directly onto an events app.
- 3-day retention around 60% vs ~15% industry average ([Loquiz case study](https://loquiz.com/2023/02/27/pokemon-go-gamification-case-study/)).

**What soured**
- Steep novelty decay: 45M MAU at peak July 2016 → 30M by late August ([same source](https://loquiz.com/2023/02/27/pokemon-go-gamification-case-study/)). Collection alone didn't sustain casuals; community and events sustained the core.
- **Geographic inequity.** Rural and disabled players were structurally disadvantaged (fewer stops/gyms); Niantic's 2023 Remote Raid price hike (passes ~doubled, raids capped) made this worse and triggered #HearUsNiantic, a 70,000-signature petition, and a player strike ([Kotaku](https://kotaku.com/pokemon-go-remote-raids-passes-price-increase-niantic-1850287791), [GameRant](https://gamerant.com/pokemon-go-remote-raid-changes-bad-petition-accessibility-rural/)). Serebii's Joe Merrick called it a "repeated erosion of trust" ([TechCrunch](https://techcrunch.com/2023/03/30/pokemon-go-will-raise-the-price-of-remote-raid-passes/)).
- **Real-world externalities are real.** Purdue's "Death by Pokémon GO" study found a 26.5% increase in crashes at intersections within 100m of a PokéStop, extrapolating nationally to ~145,000 accidents and 256 deaths in the first months ([Purdue](https://www.purdue.edu/research/features/stories/pokemon-go-may-have-cost-us-billions-in-damage-purdue-research/), [Gizmodo](https://gizmodo.com/study-estimates-that-pokemon-go-has-caused-more-than-10-1820776908); causality contested but directionally sobering). When your app moves bodies through physical space, the incentive design has safety consequences.

**Lesson for an events app:** event-shaped communal moments (a "Community Day" = a city's First Friday) are the durable mechanic; daily-pressure and pay-gated participation are what burned trust.

### Geocaching (2000–present, the longevity champion)

**What worked**
- 25+ years of sustained engagement with almost no coercive mechanics. [JMIR qualitative research](https://www.jmir.org/2020/6/e15339/) found the primary value is **community**, not competition; motivations are being outdoors, social interaction, physical activity, relaxation. It satisfies autonomy (you pick the cache), competence (difficulty ratings), relatedness (logs, events) without deadlines.
- The find log is a permanent record — a collection/journal, not a streak. Nothing decays if you stop for a year.

**What soured**
- **The numbers game.** [Exergame motivation research](https://pubmed.ncbi.nlm.nih.gov/26594898/) found that while find-counts motivate, they breed competition that "alters the nature of the activity" — count-chasers skip cache descriptions and stop leaving comments, i.e., the quantified layer cannibalizes the experiential layer. Power trails (hundreds of identical roadside caches, [Geocacher's Compass](https://www.geocacherscompass.com/power-trails/)) exist purely to inflate counts — Goodhart's law in hiking boots.

**Lesson:** even a benign counter eventually distorts behavior at the margin. Keep counts descriptive, never the goal.

### Foursquare / Swarm (the canonical burnout arc)

**What worked**
- Mayorships, badges, and points made check-ins fun circa 2009–2012 and crowdsourced a world-class venue database ([NEXT Conference retrospective](https://nextconf.eu/2014/08/the-de-gamification-of-foursquare/)).

**What soured — the full arc, worth internalizing**
1. Competition scaled badly: "defending mayorships became hard work" — fun became a job.
2. Competitors gamed the system: fake venues, check-ins to closed locations — "terrible data, just to win at the game," polluting the core asset ([NEXT Conference](https://nextconf.eu/2014/08/the-de-gamification-of-foursquare/)).
3. 2014: Foursquare **removed** mayorships/badges and split into two apps; users revolted at the de-gamification too ([Foursquare Swarm — Wikipedia](https://en.wikipedia.org/wiki/Foursquare_Swarm)).
4. Swarm re-added mayorships in 2015 — "too little too late, most users already moved on" ([Methodshop](https://methodshop.com/swarm-foursquare-mayorships/), [TechCrunch](https://techcrunch.com/2015/06/22/swarm-brings-back-mayorships/)).
5. Foursquare City Guide was shut down entirely in late 2024 ([maffe.is farewell](https://maffe.is/bits/saying-goodbye-to-foursquare-city-guide)).

**Lesson:** competitive scarcity mechanics (one mayor per venue) generate both burnout AND data fraud; and once users' identity is invested in trophies, removing them is also fatal. Don't build trophies you'd ever need to take away. Notably, modern Swarm's surviving pitch is a **"lifelog" — a searchable diary of everywhere you've been** — i.e., what survived the gamification fire was the record-of-your-life.

### Untappd

**What worked**
- Logging beers as a memory aid and discovery tool; badges as light delight; venue check-ins as social signal. Still alive after 15 years because the **log itself is useful**.

**What soured**
- A [2026 longitudinal ethics analysis (arXiv)](https://arxiv.org/html/2601.04841v1) documents quantity-scaling badges that "nudge users to consume more" — including a badge for checking in 12 beers in a day grimly named "Take It Easy." Streaks + ABV badges + quantity tiers around a health-risking, money-costing substance is the clearest case study of why **volume-rewarding mechanics are dangerous when the activity has real costs** ([Medium critique](https://medium.com/@willgchamberlain/the-dangers-of-gamifying-alcohol-consumption-d548498ecd54)). Going out shares the structure: it costs money, and "more" is not automatically better.

**Lesson:** badge the *variety and novelty* (new styles, new venues), never the *volume*.

### Strava

**What worked**
- Kudos and clubs deliver genuine relatedness; segments deliver competence-feedback; the activity log is a valued training journal.

**What soured**
- A research literature now exists on Strava harm: ["Strava made me do it"](https://www.researchgate.net/publication/400287585_Strava_made_me_do_it_Psychological_effects_of_social_comparison_and_self-surveillance_on_a_social_network_for_athletes) documents psychological effects of social comparison and self-surveillance; risks concentrate in users prone to negative comparison and low self-compassion ([Impact Magazine](https://impactnottingham.com/2025/10/strava-healthy-or-harmful/)).
- Users report training harder than intended, hiding runs that might "look bad," and injured athletes having to quit the app because seeing friends' activity made them anxious ([Triple Threat Life](https://triplethreatlife.substack.com/p/running-for-kudos-the-double-edged), [The Dartmouth](https://www.thedartmouth.com/article/2024/02/local-legends-and-kudos-galore-looking-at-strava-on-campus)). Kudos-chasing shifts commitment from self to audience ([Marathons.com](https://www.marathons.com/en/featured-stories/strava-chasing-kudos-and-social-recognition/)).

**Lesson:** public performance metrics turn an activity into a stage. For going out, visible leaderboards of "who went out most" would punish the injured/broke/depressed user exactly when they're most fragile.

### Duolingo (the streak masterclass — and the confession)

**What worked (it really does retain)**
- Streaks are the most effective retention mechanic ever shipped in consumer software: users at a 7-day streak are 3.6x likelier to finish their course; 7+ day streaks are 2.4x likelier to return next day ([Deconstructor of Fun](https://duolingo.deconstructoroffun.com/mechanics/streaks), [Propel](https://www.trypropel.ai/resources/duolingo-customer-retention-strategy)).

**What soured**
- The mechanic runs on **loss aversion** — losses feel ~2x as painful as gains feel good ([justanotherpm](https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature)). Critics describe guilt-based retention and engagement hooks dressed as pedagogy ([Dr. Rachel Taylor, "Why My Daughter Quit Duolingo"](https://drracheltaylor.substack.com/p/why-my-daughter-quit-duolingo-the); [duoowl](https://duoowl.com/why-duolingo-is-scary/)). Streak Freezes are bought with gems bought with dollars — monetizing the anxiety the company manufactured; "protection" framing drove a reported 200% revenue surge on that SKU ([Medium breakdown](https://medium.com/@salamprem49/duolingo-streak-system-detailed-breakdown-design-flow-886f591c953f)).
- **The streak freeze IS the confession.** Duolingo's own retention team added freezes, Weekend Amulets, and a free "earn back" repair ([Lenny's Podcast, Jackson Shuttleworth](https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team)) because raw streaks churned the very users they hooked. When the mechanic's owner ships four different apology features for it, believe the apology, not the mechanic. Apple made the same confession: watchOS 11 (2024) finally let users **pause Activity rings without losing streaks**, because "a rest day would snap your streak, even if you'd earned it" and streak-loss caused full habit abandonment ([9to5Mac](https://9to5mac.com/2024/07/16/close-your-ringsbut-in-watchos-11-its-okay-if-you-dont/), [AppleInsider](https://appleinsider.com/inside/watchos-11/tips/how-to-pause-activity-rings-in-watchos-11-when-you-need-a-break)).

### Habit apps generally

- The documented failure arc: week 1 motivating → week 2 guilt after a miss → week 3 broken streak, **app abandoned entirely** ([Medium](https://medium.com/the-intentional-life/why-most-habit-trackers-fail-and-what-actually-works-4481602de878)). "Streaks are designed to keep you engaged with the app, not with the habit."
- Streaks harm specific populations: chronic illness, neurodivergence, perfectionists, caregivers, anyone with variable energy ([Work Brighter, "The Habit Streak Paradox"](https://workbrighter.co/habit-streak-paradox/)). Alternatives that work: frequency goals ("4 of 7 days"), total-completion counts ("like building a collection rather than maintaining perfect attendance" — [mostly](https://getmostly.app/)), percentage consistency, points for partial effort.
- **Counter-example worth copying: Finch.** The self-care pet app is beloved precisely because *nothing bad ever happens* — "your bird never dies or disappears regardless of how many days you miss... it simply waits for you" ([Calmevo review](https://calmevo.com/finch-app-review/), [Medium](https://medium.com/illumination/a-dopamine-loop-that-nourishes-you-finch-is-my-favourite-self-care-app-right-now-151c05fefd2b)). All carrot, zero stick, and it works especially well for anxious/depressed users — the population a "go out more" app will inevitably attract.
- **Counter-example #2: Letterboxd.** No streaks, no daily anything — just a diary, lists, and year-end stats. Users describe logging 1,000 films as "tracking my evolution as a moviegoer — and, to some extent, as a human being" ([Medium](https://medium.com/@kieobn/i-logged-1-000-films-in-my-letterboxd-diary-heres-what-they-say-about-me-4ebb2e8cff10), [The Ringer](https://www.theringer.com/2020/09/18/movies/letterboxd-film-discussion-site-streaming-movies)). The closest existing analogue to "a record of your nights out," and it thrives without a single coercive mechanic.

---

## 2. Why Gamifying GOING OUT Is More Dangerous Than Gamifying Push-ups

A Duolingo lesson costs 3 minutes and $0 and can be done sick, broke, and in bed. An event is different on every axis, and each difference weaponizes a guilt mechanic:

1. **It costs money.** A streak/quota mechanic around going out is functionally a *spending* prompt — structurally identical to Untappd's drink-volume badges. Pokémon GO's remote-raid backlash shows what happens when participation gets pay-gated. A guilt loop here doesn't nag, it bills.
2. **It depends on weather, energy, transportation, safety.** Tampa summer thunderstorms, hurricane season, a closed bridge, walking alone at night — all break "consistency" through zero fault of the user. Habit-streak research is explicit that streaks fail people whose blockers are outside their control ([Work Brighter](https://workbrighter.co/habit-streak-paradox/)). Worse, Purdue's data shows incentive pressure on physical movement creates actual safety externalities ([Purdue](https://www.purdue.edu/research/features/stories/pokemon-go-may-have-cost-us-billions-in-damage-purdue-research/)) — you do not want a mechanic that nudges someone toward an event they'd otherwise skip for safety or exhaustion reasons.
3. **It structurally rewards extroversion and punishes its own target user.** The people an events app most wants to help — the lonely, the anxious, the new-in-town — are exactly the populations the Strava literature identifies as most harmed by visible comparison ([Impact Magazine](https://impactnottingham.com/2025/10/strava-healthy-or-harmful/)). A leaderboard of nights out is a leaderboard of disposable income, free time, social battery, and neurotype.
4. **A guilt mechanic punishes rest — and rest is part of a healthy going-out life.** Closing your apartment door on a Friday is often the *correct* choice. Apple conceded this for exercise rings; it is triply true for nightlife, where the failure mode of over-compliance isn't soreness, it's burnout, overspending, and drinking on nights you didn't want to. An app that makes a user feel bad for staying home is not a wellness product; it's Untappd for FOMO.
5. **Supply isn't constant.** Duolingo manufactures infinite lessons; a city does not manufacture infinite Tuesdays worth leaving the house for. A daily mechanic forces users to either break the chain or attend junk events — degrading both the user's life and their trust in your recommendations.

---

## 3. Dark Patterns to Ban (ranked, worst first)

1. **Loss-resetting streaks of going out** — the entire abandonment literature in one mechanic; here it doubles as financial and physical pressure. Banned outright, including any "X weekends in a row" framing.
2. **Monetized mercy** — selling streak freezes/repairs/protection; charging to relieve anxiety the app created ([UX Mag](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame) calls this out as extracting money from users "when they are emotionally vulnerable").
3. **Guilt-toned notifications / confirmshaming** — "Your streak misses you," sad-mascot nudges, "going to give up now?"; Duolingo's owl-as-menace is a meme because the menace is real.
4. **Public output leaderboards** — ranked comparison of who-went-out-most; Strava's documented harm + Foursquare's mayorship arms race (burnout AND fake data).
5. **Volume badges** — rewards for *amount* (events per week, bars per night = Untappd's "12 beers a day" badge). Volume of going out correlates with spending, not wellbeing.
6. **FOMO countdowns / artificial scarcity on rewards** — "attend tonight or lose the 2x bonus"; manufactured urgency around real-money decisions ([dark-pattern taxonomy: temporal/monetary/social-capital manipulation](https://dl.acm.org/doi/full/10.1145/3701571.3701604)).
7. **Decaying status** — anything that erodes while the user rests (decaying levels, lapsing titles, Snapchat-style flame anxiety). Rest must never show up as loss anywhere in the UI.
8. **Social-capital recruitment pressure** — points for dragging friends in, guiltable invite mechanics.
9. **Quantified judgment of rest** — even passive ("0 events this week 📉") framing of a quiet week as decline. A zero week should render as a quiet page, not a red metric.

## 4. Mechanics That Respect "NO" (ranked, best first — rest as first-class)

1. **The journal/collection as the core loop** — every event attended becomes a permanent, never-decaying entry (Letterboxd diary, Geocaching log, Swarm's surviving "lifelog"). Additive-only: gaps are blank pages, not failures.
2. **Rest as a first-class state, not an exemption** — don't bolt on a "freeze" (the apology pattern); design so there's nothing to freeze. If any cadence feature exists, "staying in" is a loggable, equally-valid entry ("quiet weekend — recharged"), like Finch's bird that simply waits.
3. **Frequency windows over chains** — if goals exist at all, user-set and windowed: "2 outings a month," "1 of the next 4 weekends" ([mostly](https://getmostly.app/), [Work Brighter](https://workbrighter.co/habit-streak-paradox/)). Misses roll off; they never reset anything.
4. **Variety/novelty badges over volume badges** — first food festival, five neighborhoods explored, first solo show. Rewards breadth of life, not frequency of spend; mirrors what works in Geocaching before the numbers game corrupts it.
5. **Community-event moments over daily cadence** — Pokémon GO's genuinely great trick: shared, scheduled, optional spikes ("this Saturday the whole city's at the night market") generate relatedness without any daily obligation. An events app gets this almost for free — the city provides the Community Days.
6. **Anniversary/memory resurfacing** — "a year ago tonight you were at the Gasparilla parade." Retention through meaning (the record gets more valuable with time) instead of fear (the streak gets more fragile with time). This is the journal model's native retention engine.
7. **Kudos without ranks** — if social exists: friends can applaud an entry; nobody is ever ranked, and per-SDT relatedness ≠ comparison ([Rigby & Ryan, Glued to Games](https://selfdeterminationtheory.org/glued-games-video-games-draw-us-hold-us-spellbound/)).
8. **Self-anchored reflection stats** — Letterboxd-style year-in-review ("your year in nights out"): only you vs. your own past, opt-in, framed as portrait not performance.
9. **Effort-blind logging** — a free outdoor movie counts exactly as much as a $150 concert. Never let the mechanic correlate virtue with spend.

The SDT frame ties this together: durable motivation comes from autonomy, competence, and relatedness; points/badges/leaderboards are extrinsic substitutes that can actively undermine intrinsic motivation when they control rather than inform ([meta-analysis, Springer](https://link.springer.com/article/10.1007/s11423-023-10337-7); [SDT overview](https://open.ncl.ac.uk/theories/20/self-determination-theory/)). Bogost's harsher version: mechanics-first gamification is ["exploitationware"](https://www.gamedeveloper.com/business/feature-gamification-no-exploitationware) — using games' "easy, certain, boring aspects" (points) instead of their actually-magical ones (meaning, discovery, play). The test for any mechanic: does it *inform* the user about their own life, or *control* their behavior for our DAU chart?

## 5. Thesis: Record-of-Your-Life vs. Streak

**A streak is a debt; a journal is an asset.** The streak model loans the user motivation and charges interest in anxiety: every day the obligation renews, every miss is a default, and the literature shows defaults end in abandonment of both app and habit — which is why Duolingo, Apple, and the entire habit-app industry have all shipped confession features (freezes, pauses, repairs) to soften their own core mechanic. For going out — an activity that costs money, depends on weather and energy, rewards extroversion, and where rest is legitimately the right call much of the time — the streak model's failure modes aren't just churn; they're overspending, unsafe choices, and shame aimed at the user's most vulnerable moments.

The record-of-your-life model inverts every one of those properties. A collection/journal is additive-only: it can grow but never shrink, so rest is structurally invisible as failure — a blank page, not a broken chain. Its value *compounds with time* (the 1,000-film Letterboxd diary, the 10-year geocaching log, Swarm's lifelog — notably the only part of Foursquare's gamification that survived), giving it a retention engine streaks can't match: switching costs born of meaning, plus anniversary resurfacing that pulls users back with warmth instead of threat. It gracefully serves both the every-weekend extrovert and the once-a-month introvert, because it never prescribes a cadence — it reflects one. And it aligns the app's incentives with the user's actual goal: not "go out maximally," but "when I look back at my year in this city, I'm glad I did these things, and I can prove to myself my life happened." For an events app whose stated ethos is finder-first and no fake anything, the journal is the honest mechanic: it records a real life instead of manufacturing a fake obligation.

---

### Key sources
[Pokémon GO systematic review (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8123321/) · [Purdue "Death by Pokémon GO"](https://www.purdue.edu/research/features/stories/pokemon-go-may-have-cost-us-billions-in-damage-purdue-research/) · [Kotaku remote-raid backlash](https://kotaku.com/pokemon-go-remote-raids-passes-price-increase-niantic-1850287791) · [JMIR geocaching study](https://www.jmir.org/2020/6/e15339/) · [Geocaching exergame motivations (PubMed)](https://pubmed.ncbi.nlm.nih.gov/26594898/) · [De-gamification of Foursquare (NEXT)](https://nextconf.eu/2014/08/the-de-gamification-of-foursquare/) · [Foursquare Swarm (Wikipedia)](https://en.wikipedia.org/wiki/Foursquare_Swarm) · [Untappd longitudinal ethics analysis (arXiv)](https://arxiv.org/html/2601.04841v1) · ["Strava made me do it" (ResearchGate)](https://www.researchgate.net/publication/400287585_Strava_made_me_do_it_Psychological_effects_of_social_comparison_and_self-surveillance_on_a_social_network_for_athletes) · [Strava: Healthy or Harmful (Impact)](https://impactnottingham.com/2025/10/strava-healthy-or-harmful/) · [Duolingo streaks (Deconstructor of Fun)](https://duolingo.deconstructoroffun.com/mechanics/streaks) · [Duolingo streak psychology (justanotherpm)](https://www.justanotherpm.com/blog/the-psychology-behind-duolingos-streak-feature) · [Shuttleworth on streak design (Lenny's)](https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team) · [Streaks without shame (UX Mag)](https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame) · [Habit Streak Paradox (Work Brighter)](https://workbrighter.co/habit-streak-paradox/) · [watchOS 11 ring pausing (9to5Mac)](https://9to5mac.com/2024/07/16/close-your-ringsbut-in-watchos-11-its-okay-if-you-dont/) · [Finch review (Calmevo)](https://calmevo.com/finch-app-review/) · [Letterboxd appeal (The Ringer)](https://www.theringer.com/2020/09/18/movies/letterboxd-film-discussion-site-streaming-movies) · [SDT gamification meta-analysis (Springer)](https://link.springer.com/article/10.1007/s11423-023-10337-7) · [Rigby & Ryan, Glued to Games (SDT.org)](https://selfdeterminationtheory.org/glued-games-video-games-draw-us-hold-us-spellbound/) · [Bogost, Exploitationware (Game Developer)](https://www.gamedeveloper.com/business/feature-gamification-no-exploitationware) · [Mobile-game dark pattern taxonomy (ACM)](https://dl.acm.org/doi/full/10.1145/3701571.3701604) · [Dangers of gamifying alcohol (Medium)](https://medium.com/@willgchamberlain/the-dangers-of-gamifying-alcohol-consumption-d548498ecd54)

# APPENDIX C — Codebase mapping report

# Calendar-as-YOUR-calendar — codebase mapping scout report

Scout scope: read-only survey of `C:\Users\daonl\Desktop\cj` (branch `autonomous-dev-pt2`, HEAD `c22bed1` Sprint P). Working tree is clean except `MASTER_PLAN2.md` (modified). **Sprint Q is mid-flight in this tree**: `SwipeDeck.jsx` / `LensDeck.jsx` do not exist yet (Q1 task in_progress) — swipe mechanics were read from the stable reference `app\src\CalibrationDeck.jsx` instead, and everything below that touches deck/nav surfaces should be re-checked against Q's landed interfaces, not this snapshot.

---

## 1. Existing plumbing the vision can stand on

### 1a. The plan model — weekend-plan-v1 is ~70% of a generalized day-plan store
`C:\Users\daonl\Desktop\cj\app\src\weekend.js` is the closest analog, and crucially **most of its logic is already day-granular, not weekend-granular**:

| Capability | Where | Day-general already? |
|---|---|---|
| Daypart classification (day/night/'any') | `weekend.js:36-40` `daypartOf(e)` | ✅ pure function of the event, no weekend coupling |
| Event-fits-day (multi-day span aware) | `weekend.js:44-51` `fitsDay(e, ts)` / `fitsSlot(e, ts, part)` | ✅ takes any day timestamp |
| Picker model (saved-first + ≤8 taste-nudged suggestions, slot dedupe) | `weekend.js:156-167` `pickerModel({ts, part, ...})` | ✅ takes any `ts` |
| Share text composition | `weekend.js:174-189` `shareText(plan, days, resolve)` | ✅ iterates a passed `days` array; only the header line "My Tampa Bay weekend 🌴" is weekend-flavored |
| Validated load (shape + version guard) | `weekend.js:109-132` `planFor` | ⚠️ keyed to ONE `weekendStartTs` |
| Archive-before-overwrite history | `weekend.js:67-78` `archivePlan` → `'weekend-history-v1'` cap 26; `loadHistory` :83-103 | ⚠️ weekend-keyed, but the pattern (validate, dedupe by start ts, cap, never destroy) transplants directly |
| Persistence seam | `weekend.js:134-145` via `storage.js` `lsGet/lsSet` (auto `twh:` prefix) | ✅ |

**What "generalized day-plan store" actually requires:** replace the single `{ weekendStartTs, slots:{fri_day…} }` blob with a map `{ [dayTs]: { state, slots:{day,night}, done, v } }`, port `planFor`'s defensive validation per-entry, and port the archive sweep to "any day that passed" instead of "weekend rolled over." The hard logic (fit, picker, daypart, share) needs **zero changes**. The UI consumer (`WeekendBuilder.jsx`) is the bigger rewrite-or-rebase question — see §3.

The one-shot `--reward` completion beat is also already modeled: `plan.done` persisted so it can never re-fire (`weekend.js:54-62`, `WeekendBuilder.jsx:86-101`, `weekend.css:140-174`).

### 1b. Been-there is already a did-it journal
`C:\Users\daonl\Desktop\cj\app\src\saves.js`:
- Store: `'been-there-v1'` = array of `{ key, snapshot, savedAt?, archivedAt?, status:'went'|'missed', statusAt }`, cap 200 (`saves.js:63-96`).
- `markBeen(key, snapshot, status)` (`saves.js:120-137`): idempotent (a recorded status never re-answers — taste can't be farmed), `'went'` feeds taste +2 (`taste.js:60` INC table) and moves the item off the saved list; `'missed'` records silently.
- Two ingress paths already exist: shelf expiry auto-archives status-less (`saves.js:199-223`, archive-before-prune), and ProfileView's "Did you make it?" prompts (`ProfileView.jsx:148-166, 280-301`).

**For the calendar's "did-something" day state, this is derivable, not new data**: a day is a did-day when any `been` entry with `status==='went'` has a `snapshot.start` landing on that day (`dayTs(snapshot.start)`). Caveat: snapshots store `start`/`end`/`tags` (`saves.js:147-166`), so the day resolution survives dataset refreshes. The only gap: a went-event answered from the archive has `statusAt` (answer time) ≠ event day — always derive from snapshot.start, never statusAt.

### 1c. Create-your-own exists today
`C:\Users\daonl\Desktop\cj\app\src\AddEvent.jsx` already produces full schema-v2 events (title/date/time/venue/address/category/free/price/link/desc → `AddEvent.jsx:90-111`), persisted to `'my-events-v1'` and merged through the **same** `normalize()` path as fetched data (`App.jsx:194`), so they already appear in the calendar's day buckets. Provenance invariant ("Added by you" tag) and a JSON export (the parked submission-pipeline seed, `AddEvent.jsx:117-127`) ride along.

**Gap is two lines wide**: `openAdd` (`nav.jsx:137-141`) takes no payload and `AddEvent` takes no initial date — "create an event ON this day" needs `openAdd({date})` → prefill `f.date`, plus optionally auto-slotting the created event into that day's plan (the `onAdd` seam in `App.jsx:182-189` returns nothing today; the day screen can slot by `keyOf` after submit).

### 1d. Swipe mechanics, finite-deck shape, signal seams
`CalibrationDeck.jsx` is the stable reference: raw pointer gestures with thresholds (`:52-53, 244-278`), always-visible button fallbacks + reduced-motion buttons-only (`:148-149, 357`), the pure rng-injectable sampler `dealDeck` (`:95-146`), finite progress dots, "done early keeps what it learned" (`:229-232`), an empty-phase fallback (`:187, 342-351`), and the one-signal-per-verdict discipline (`:200-224` — save rides the existing save seam so +3 is never double-counted; rejections also push `'fmn-seen-v1'` so siblings don't re-pitch). Sprint Q is extracting this into `SwipeDeck.jsx` + building `LensDeck.jsx` right now — **the day-fill deck should be specced as a third lens entry into that machinery** ("the deck for Saturday Jun 13"), not a fourth deck implementation. MASTER_PLAN2 already names this: Q2f calls calendar day-fill the third decide-for-me sibling, "arrives with U" (`MASTER_PLAN2.md:55`).

Supply-side pieces: per-day pools via `fitsDay` filtering; diversity interleave `orderDay` (`lib.js:77-143`); taste nudge `tasteNudge` (`taste.js:423-432`); day buckets in `CalendarView.jsx:35-47`.

### 1e. Misc plumbing that just works
- **Nav**: day screen = one more subpage union entry `{type:'day', ts}` (`nav.jsx:109-174`); WeekendBuilder's `{type:'weekend'}` + App's keyed mount (`App.jsx:295-298`) is the exact pattern, including the remount-on-rollover trick.
- **Weather**: the 16-day forecast already flows into CalendarView as a prop (`App.jsx:200-209`, `CalendarView.jsx:12-18, 28`) — a day-plan screen gets "☀️ great Saturday" lines for free.
- **Storage**: new keys are born `twh:`-prefixed via `storage.js`; the defensive-parse posture (`planFor`, `loadBeen`, `cleanInterview`) is the house style to copy.
- **Share/ICS** (invite precedents): `DetailPage.jsx:40-100` `icsText` — full RFC 5545, all-day vs timed, folding, deterministic UID; download flow `:267-276`; `navigator.share` → clipboard-toast fallback in both DetailPage (`:285-295`) and WeekendBuilder (`:168-186`).
- **Anchors/midnight**: `App.jsx:144-169` recomputes anchors on visibilitychange + 30s-past-midnight timer; `makeAnchors` (`lib.js:191-196`).

---

## 2. What is genuinely NEW

1. **The day-states model (planned / rest / unplanned / did-something).** No store holds per-day *intent* today. "Rest day" is pure new data; "planned" is derivable from filled slots; "did-something" is derivable from been-there (§1b) and/or a completed past plan. Proposed: `'day-plans-v1'` = `{ [dayTs]: { state:'rest'|null, slots:{day:key|null, night:key|null}, done, v:1 } }` + an archive sweep into a `'day-history-v1'` (or fold completed past days into the same store with a cap). Decisions needed: planning horizon (anything beyond the 16-day forecast loses weather lines; events.json supply itself runs weeks out), and what happens to `weekend-plan-v1` (§3, the WB collision).

2. **The day-fill surface.** Opening a day becomes an exploring/filling screen: current state header (weather + plan slots), the day's agenda (supply), "Fill this day 🃏" → finite deck drawn from `fitsDay(e, ts)` pool, diversity-interleaved. *New semantics on top of SwipeDeck*: swipe-right means "into my day" (slot assignment — `daypartOf` auto-routes day/night; `'any'` events need a default or a one-tap choice), not merely save. Left = pass (−1 + fmn-seen, the Q3 contract). This is the only place in the app where a swipe *commits to a plan*.

3. **Companion/collection visual ("gently gamified").** Nothing exists, and the codebase actively refuses confetti: `--reward` violet is contractually reserved (index.css:15-21 lists five moments; deck finish is sanctioned #6 per `deck.css:3` / `CalibrationDeck.jsx:10`; `profile.css:4` explicitly DENIES been-there a reward moment). The honest local version: month-grid state glyphs (rest moon / planned mark / did-check), a derived "days out this month" counter (Profile or calendar header — it's just a count over been-there + plan history), and at most **one** new sanctioned reward moment (candidate: the first time a planned day converts to a did-day). Each is a ⚑flag-class decision, and the saved-dot reservation (UI_SPEC §4: "dots reserved for saved-event marker only") means day-state needs a *different* visual channel than the dot.

4. **Invite mechanics, backend-free.** Precedents make v1 cheap: "Share this day" = generalized `shareText` (drop the weekend header, take one day) + a **multi-VEVENT ICS**: `icsText` builds exactly one VEVENT inside one VCALENDAR (`DetailPage.jsx:65-99`) — refactor to `vevent(e)` + a wrapper that concatenates several, then `navigator.share({files:[...]})` where supported (mobile Safari/Chrome), download fallback elsewhere. That is the entire honest scope: **RSVP/attendance tracking requires accounts and stays parked** (MASTER_PLAN2 PARKED list). A local-only "who's coming" free-text note on a plan entry is the most that fits the no-backend promise.

5. **The prompt-to-plan loop.** "It prompts you to plan days" can only mean *in-app* affordances until Sprint W (no notifications): empty-day cells/rows that invite ("plan it / rest day?"), the existing CalendarView empty state ("Nothing scheduled. A rare night off 🌙", `CalendarView.jsx:196,210`) literally converts into this CTA, and maybe a Profile card mirroring the Weekend card (`ProfileView.jsx:238-258`). Pull-based only — see risks.

---

## 3. Collision analysis with current CalendarView

**Survives intact:** the month grid mechanics — heat shading at p90 (`CalendarView.jsx:61-72, 161-185`), weather emoji per cell, saved dots, hot-day coral rings, the clamp-to-today bucketing (`:35-47`), month nav clamped at current month. MASTER_PLAN2 U1 explicitly keeps "month grid heat+weather+saved dots." The Apple-pattern "tap day → list below grid" (UI_SPEC §4) also survives as the day screen's agenda section.

**Gets reframed:**
- **The List mode** (date-rail + inline agenda, `:107-132, 200-218`) is the part the vision replaces: "opening a day" stops being *select-a-pill-and-scroll* and becomes a *day screen* (subpage) with plan state + fill affordances + agenda. The date-rail may survive as the week-strip U1 wants, but its selection now opens the day screen rather than swapping an inline list.
- **The grid's semantics fork.** Today every pixel of the grid is *city-supply* information (heat = how much is happening). The personal calendar overlays *my-state* (planned/rest/did) on the same 56px cells. These must read as two channels: heat stays coral (the documented heat-only semantic, `calendar.css:67-70, 139-147`), personal state needs teal/ink glyphs. This is the central design collision and the most flag-worthy visual decision (Charles).
- **The Weekend pill** (`CalendarView.jsx:92-96`, K2 seam) becomes redundant once Fri–Sun are just three days in the day-plan store — it either retires or becomes a "this weekend" shortcut.
- **WeekendBuilder itself is the big structural collision.** Two plan stores ('weekend-plan-v1' + 'day-plans-v1') covering the same Friday is a data-integrity bug waiting to happen (which one does Profile's plan card read? which one archives?). Two honest options: **(a)** day-plans-v1 becomes THE store and WB becomes a 3-column *view* over it (one-shot migration: read weekend-plan-v1 via `planFor`, write its slots into the corresponding day entries, archive the old key — the storage.js LEGACY_KEYS migration pattern is precedent); **(b)** coexist one sprint with WB untouched and a documented "weekend days are owned by WB" exclusion. Option (a) is more work up front but kills the fork before Sprint S's "Make this my plan" bridge (S2) hard-wires *place→weekend-slot*; if day plans land first, S2 should target the generalized store and the bridge gets built once.
- **Profile's "Your plans" section** (`ProfileView.jsx:235-267`) and HistoryCard read weekend.js stores directly — they follow whichever option (a)/(b) picks.
- **MASTER_PLAN2 U1/U2 as written** (`MASTER_PLAN2.md:81-84`) is a *smaller* idea than this vision (chaptered day-browsing vs. personal calendar) — the owner reframe supersedes U1's framing but is compatible with its parts (week-strip, day click-through, grid kept). Q2f (`:55`) already pre-ratifies day-fill as the third deck sibling, so the vision is partially anticipated by the active roadmap.

**Display-bucketing divergence to document:** `dayMap` puts every event on exactly ONE day (in-progress multi-day → today, `CalendarView.jsx:35-46`), while `fitsDay` spans all running days (`weekend.js:44-46` — "a Saturday pick can be a 3-week exhibit"). The day screen's agenda and its fill-deck pool will disagree on counts unless one semantic is chosen per surface (recommendation: agenda keeps dayMap's one-day honesty; the fill pool uses fitsDay's span — and the screen says so).

---

## 4. Sprint-sized decomposition + roadmap slot

Effort unit: one past sprint ≈ one multi-agent session (Sprint P = settings + interview + full deck; Sprint O = nav restructure + Profile tab).

| Sprint | Content | Effort | Hard dependencies |
|---|---|---|---|
| **U-a — day-plan store + day states + day screen v1** | `dayplan.js` (generalize weekend.js: map-of-days store, per-entry validation, archive sweep, rest state), WB rebased as a view or explicit coexistence call (⚑flag), month grid state glyphs (⚑Charles visual), day screen subpage `{type:'day',ts}` with agenda + 2 plan slots + rest toggle, picker reusing `pickerModel` verbatim, Profile plan card reads the new store | **~0.8–1.0 sprint** (the WB rebase is the variance) | none hard; lands cleanest after Q2 (nav/settings churn settles) |
| **U-b — the day-fill deck** | "Fill this day" → finite deck over the `fitsDay` pool via Q's SwipeDeck/LensDeck; right = slot-into-day (daypart auto-route), left = pass (−1, fmn-seen), up = save; honest minimum-supply fallback (≤3 candidates → picker, the CalibrationDeck empty-phase pattern); one-deck-per-day-per-session fatigue guard (Q3 contract) | **~0.3–0.5 sprint** with SwipeDeck landed; ~0.7 without | **Sprint Q must land first** |
| **U-c — create-from-day + share/invite v1** | `openAdd({date})` prefill + auto-slot on submit; "Share this day" (generalized shareText + multi-VEVENT ICS + `navigator.share` files w/ download fallback) | **~0.3 sprint** | U-a |
| **U-d — the gentle loop** | did-day derivation from been-there, "Did you make it?" prompts surfaced on past calendar days (same `markBeen` seam), days-out-this-month stat, THE one candidate reward moment (planned→did conversion) ⚑flag, copy pass inventory for Charles | **~0.4–0.5 sprint** | U-a; benefits from real usage of a/b/c |

**Roadmap slotting.** Current sequence: Q → Q2 → R → S → T → U. Recommended adjustment:
- **U-a after Q2, before/alongside R.** R is finder-side (pipeline only, "UI later" — `MASTER_PLAN2.md:60-66`), so the app-side calendar work doesn't collide with it. The payoff for going early: **S2's "Make this my plan" bridge then targets the generalized day-plan store on its first build** instead of weekend slots — otherwise that bridge is built twice. This is the strongest sequencing argument in either direction.
- **U-b immediately after Q** is technically possible, but note the supply problem: an events-only fill deck for a random Tuesday may deal 4 cards. It works *today* for weekends and hot days; it becomes genuinely good only once **Phase 2 places** exist (an evergreen "always there" card class is exactly what empty weekdays need — the T4 thin-night argument, applied to days). Either ship U-b with the honest small-deck fallback pre-places, or hold the deck until T and let U-a's picker carry day-filling in the interim.
- **U-c/U-d** are independent small payloads that can ride any adjacent sprint's review cycle.
- Net: the vision replaces Sprint U's current text and roughly doubles U's scope (from "~1–2 sessions" Phase 3 to ~2–2.5 sessions total), partially paid back by S2 not needing a second bridge.

---

## 5. Codebase-specific risks

1. **The 56px-cell channel budget (460px frame).** `#root` maxes at 460px (`index.css:51-60`); month cells already carry heat tint + numeral + today/selected rings + saved dot + weather emoji + hot ring (`calendar.css:104-176`). Day-state glyphs are a 7th channel on a ~56px square. Real risk of unreadable mud; the dot position is contractually taken (UI_SPEC §4). Needs a deliberate, Charles-flagged visual language — possibly state moves to the date-rail/week-strip pills (more room) and the grid gets only the subtlest mark.
2. **Local-first promise constrains invites hard.** The app proudly states "nothing leaves your phone" (`ProfileView.jsx:334`, planned X5 privacy page). Invite v1 must be fire-and-forget share (text + ICS); any "did they accept?" implies a backend and breaks the promise. Also: plans don't sync across devices — copy should never imply they do.
3. **No notifications until Sprint W.** "Prompts you to plan days" is in-app-only until the PWA lands; the gamification loop has no re-engagement ping. Design the loop pull-based and never write copy promising reminders ("we'll nudge you Friday" would be a lie). When W lands, the day-plan store becomes the natural notification source — worth a forward note, not forward code.
4. **Midnight-anchor behavior.** Anchors refresh on visibility + 30s-past-midnight (`App.jsx:144-169`); WB handles rollover by remount-key (`App.jsx:297`). A day screen open at midnight must survive its day becoming yesterday (key the subpage by `dayTs`, same trick), and the day-plan archive sweep needs an owner on that edge: a rest day marked yesterday must transition to history, not vanish — `dayMap`'s clamp (`CalendarView.jsx:39-41`) currently drops past days entirely, which is correct for supply but wrong for personal history. Past *personal* days need a separate read path (history/did-view), not the supply buckets.
5. **Reward-token discipline under gamification pressure.** Six sanctioned `--reward` moments exist; this sprint is precisely the kind that erodes the contract. Budget exactly one candidate moment, flag it (⚑ like P1), and keep day-state visuals in teal/ink. `profile.css:4`'s explicit denial for been-there is the precedent to honor.
6. **Concurrent Sprint Q flux.** `nav.jsx`'s subpage union, `HotView` day-headers, and the not-yet-existent `SwipeDeck.jsx`/`LensDeck.jsx` are all being modified in this working tree right now. Any calendar-v2 spec written today should bind to Q's *landed* component contract (props of SwipeDeck, the deal/exclude memory keys like `'deck-last-v1'`, the fatigue-guard mechanism) — re-scout those files after Q merges.
7. **Taste-engine bounds.** If planning/resting earns taste signal (a slotted event is arguably a stronger signal than a save), it must go through `recordSignal`'s INC table (`taste.js:60`) under the documented cap/decay, and `test/smoke.mjs` asserts the nudge ceiling at exactly 18 — any new signal type needs the sim math extended, not bypassed. Cheap honest option: slotting an event simply records the existing `'save'`-equivalent only if not already saved, or no signal at all in v1.
8. **Weekday supply thinness + the two fits semantics.** Pre-places, a weekday fill deck may be nearly empty (deal-size honesty: CalibrationDeck's empty phase is the pattern), and dayMap-vs-fitsDay count divergence (§3) will confuse users unless each surface's rule is stated. Multi-day "Ongoing" exhibits are the main filler for thin days — lean on `fitsDay` for the pool and label them honestly (`dayLoose` → "Ongoing", `lib.js:282-284`).
9. **Storage hygiene.** New keys: born under `twh:` automatically via `storage.js`; match the house defensive-parse style (`planFor`/`cleanInterview`-grade validation), cap archives (weekend history caps at 26; day history needs an equivalent ~90–180), and remember `markBeen`'s idempotency rule when surfacing prompts on calendar days — the +2 must stay unfarmable from a second surface.

**Key files for the implementing agent:** `C:\Users\daonl\Desktop\cj\app\src\weekend.js`, `C:\Users\daonl\Desktop\cj\app\src\WeekendBuilder.jsx`, `C:\Users\daonl\Desktop\cj\app\src\CalendarView.jsx`, `C:\Users\daonl\Desktop\cj\app\src\calendar.css`, `C:\Users\daonl\Desktop\cj\app\src\saves.js`, `C:\Users\daonl\Desktop\cj\app\src\AddEvent.jsx`, `C:\Users\daonl\Desktop\cj\app\src\nav.jsx`, `C:\Users\daonl\Desktop\cj\app\src\App.jsx`, `C:\Users\daonl\Desktop\cj\app\src\CalibrationDeck.jsx`, `C:\Users\daonl\Desktop\cj\app\src\taste.js`, `C:\Users\daonl\Desktop\cj\app\src\lib.js`, `C:\Users\daonl\Desktop\cj\app\src\storage.js`, `C:\Users\daonl\Desktop\cj\app\src\DetailPage.jsx` (icsText), `C:\Users\daonl\Desktop\cj\app\src\ProfileView.jsx`, `C:\Users\daonl\Desktop\cj\MASTER_PLAN2.md`, `C:\Users\daonl\Desktop\cj\UI_SPEC.md`, `C:\Users\daonl\Desktop\cj\app\src\index.css`, `C:\Users\daonl\Desktop\cj\test\smoke.mjs`.