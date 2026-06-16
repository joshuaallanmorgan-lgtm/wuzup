// ProfileView — the Profile tab (Sprint O3/O4/O5 + P1's gear). TASTE-IDENTITY
// FIRST, dating-profile energy: who you are here, not knobs. The knobs now
// have a real home — the quiet gear (top-right of the header) opens the
// Settings subpage (SettingsPage.jsx); it stays deliberately muted because
// the page is the identity, the gear is the maintenance hatch.
//
// Sections, all from REAL local data (every empty state is an invitation):
//   · VIBE HEADER — derived live from taste.js: top-category chips (emoji+hue
//     from the canonical registry), free-leaning badge (the same ≥5 gate
//     tasteNudge uses), the primer's when-you-go-out line, confidence-aware
//     copy. Honest by construction: every claim traces to a stored number.
//   · YOUR LIST (O3) — the full saved list (shelfItems: upcoming first, past
//     greyed), graduated here from the Hot shelf (which keeps a slim pointer).
//   · YOUR PLANS (O5) — the Weekend Builder's PRIMARY entry: a live summary
//     card for the current weekend (tap → WB subpage) + read-only history
//     cards from 'weekend-history-v1'. localStorage isn't reactive, so the
//     plan re-reads whenever a Weekend Builder subpage closes (planRev).
//   · BEEN THERE (O4 ⚑FLAG-O2) — passed saves surface as one-tap "Did you
//     make it?" prompts: "I went 🎉" records +2 category taste and moves the
//     event into the Been-there list; "missed it" only clears the prompt.
//     Self-reported, zero tracking, all local.
//   · RECENTLY VIEWED — recents.js keys resolved against the live dataset.
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { useMemo, useState } from 'react'
import { dayLoose, keyOf, normalize, rawOf } from './lib.js'
import { useNav } from './nav.jsx'
import { categoryById } from './categories.js'
import { GemRow, SecHead, SponsoredTag } from './cards.jsx'
import { markBeen, shelfItems, useBeenThere, useSaves } from './saves.js'
import { restDayList, rhythmSummary } from './gamify.js'
import { confidence, topCategories, useTaste, whenPreference } from './taste.js'
import { useRecents } from './recents.js'
import { DAY_IDS, SLOT_IDS, filledCount, loadHistory, visibleWeekend, weekendDays } from './weekend.js'
import {
  PARTS,
  dayEntryFor,
  daysOutInMonth,
  didDays,
  filledForDays,
  loadDayHistory,
  loadDayPlans,
  monthReality as computeMonthReality,
  varietyFirsts,
} from './dayplan.js'
import { usePlaces, isPlaceKey } from './places.js'
import './profile.css'

const fmtShort = (ts) =>
  new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const fmtRange = (a, b) => fmtShort(a) + ' – ' + fmtShort(b)

// the primer's when-preference, reflected back (only ever shown when the
// primer was actually answered — a skipped primer claims nothing)
const WHEN_LINE = {
  weeknights: '🌙 Weeknights are your nights',
  weekends: '🎉 Weekends are your nights',
  whenever: '🤷 Out whenever the mood hits',
}

// a quiet stroke gear (no emoji color noise — the header stays editorial)
const GearIc = () => (
  <svg
    viewBox="0 0 24 24"
    width="19"
    height="19"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.12-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.12 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
  </svg>
)

export default function ProfileView({ events, anchors, primer }) {
  const { openDetail: onSelect, openWeekend: onOpenWeekend, openSettings, openInterests, openTaste, openDeck, openDay, page } = useNav()
  const taste = useTaste()
  const { list: savedList } = useSaves()
  const been = useBeenThere()
  const { keys: recentKeys } = useRecents()

  const byKey = useMemo(() => {
    const m = new Map()
    for (const e of events) m.set(keyOf(e), e)
    return m
  }, [events])
  const savedByKey = useMemo(() => new Map(savedList.map((s) => [s.key, s])), [savedList])

  // ===== vibe header (live taste profile → identity, confidence-aware) =====
  const conf = confidence(taste)
  const chips = topCategories(taste, 3)
    .map((c) => categoryById[c])
    .filter(Boolean)
  const freeLeaning = taste.freeAffinity >= 5 // the same gate tasteNudge's free bonus uses
  // Sprint V1: when-preference is ONE resolver now (whenPreference in taste.js).
  // The editor's dayparts outrank the primer's first-open `when` ('both'→
  // whenever); a skipped primer + untouched editor claims nothing. HotView's
  // hero reads the SAME resolver, so the two surfaces can never disagree about
  // the same fact (the Q2 carry-in, finally unified — was a duplicated patch).
  const when = whenPreference(taste, primer?.done ? primer.when : null)
  const whenLine = when ? WHEN_LINE[when] : null
  const learning = conf < 0.4 // the rail gate's own bar: under it, the profile is a sketch
  const vibeTitle =
    taste.n === 0
      ? 'Your vibe starts here'
      : learning
        ? 'Still learning you'
        : chips.length
          ? chips.map((c) => c.label).join(' · ')
          : 'Your vibe'
  const vibeNote =
    taste.n === 0
      ? 'Tap around — every ♥, open and bubble teaches this page. All on your phone, never in a cloud.'
      : learning
        ? `${taste.n} tap${taste.n === 1 ? '' : 's'} in — keep poking around and this page sharpens.`
        : `Built from ${taste.n} taps on this phone. No account, no cloud — and it's inspectable, not a black box.`

  // ===== Your list (O3): the full saved shelf, upcoming first, past greyed =====
  const shelf = useMemo(() => shelfItems(savedList, events, anchors), [savedList, events, anchors])

  // ===== Your plans (O5, re-pointed in U-a): the current weekend summarized
  // FROM THE DAY-PLAN STORE ('day-plans-v1' — the Fri–Sun window derived over
  // day entries via anchors), plus the read-only weekend history. The stores
  // aren't reactive; plans only ever change inside the weekend/day subpages,
  // so re-reading on every such open/close edge keeps the cards honest — the
  // close-edge recompute picks up whatever the subpage persisted. =====
  const planPageUp = page?.type === 'weekend' || page?.type === 'day'
  const dayPlans = useMemo(() => {
    void planPageUp // re-read trigger (see above)
    return loadDayPlans(anchors)
  }, [anchors, planPageUp])
  // past weekends keep reading 'weekend-history-v1' — NOT migrated, by design
  const history = useMemo(() => {
    void planPageUp
    return loadHistory()
      .filter((p) => p.weekendStartTs !== anchors.wkStartTs) // current weekend renders live above
      .reverse() // most recent past weekend first
  }, [anchors.wkStartTs, planPageUp])
  // past DAYS accumulate in 'day-history-v1' going forward (U-d makes the
  // list rich; this is the honest simple version)
  const dayHist = useMemo(() => {
    void planPageUp
    return loadDayHistory().reverse().slice(0, 10) // most recent first
  }, [planPageUp])

  // Sprint S: a slot can hold a PLACE ('p|') key — written by PlaceDetail's
  // "Make this my plan" — which is NEVER in `events` (places are a separate
  // store). A place key can ride a current day plan, a past-days journal row,
  // or (in principle) a past weekend, so fold the lazily-loaded places into
  // titleByKey below — else the journal renders "no longer listed" for a place
  // that's still perfectly listed in places.json. The ~1.2MB places fetch fires
  // ONLY when a place key is actually present here (the DayPage gate pattern);
  // an event-only/empty profile pays nothing.
  const hasPlaceKey = useMemo(() => {
    for (const k of Object.keys(dayPlans)) {
      const e = dayEntryFor(dayPlans[k])
      if (e && PARTS.some((p) => isPlaceKey(e.slots[p]))) return true
    }
    for (const h of dayHist) if (PARTS.some((p) => isPlaceKey(h.slots[p]))) return true
    for (const p of history) if (p.slots && Object.values(p.slots).some(isPlaceKey)) return true
    return false
  }, [dayPlans, dayHist, history])
  const { places: placeList } = usePlaces(hasPlaceKey)
  // best-known title per key for plan summaries/history: live dataset wins,
  // then saved snapshots, then been-there snapshots, then the lazy places —
  // never fabricated
  const titleByKey = useMemo(() => {
    const m = new Map()
    for (const b of been) if (b.snapshot?.title) m.set(b.key, b.snapshot.title)
    for (const s of savedList) if (s.snapshot?.title) m.set(s.key, s.snapshot.title)
    for (const e of events) m.set(keyOf(e), e.title)
    if (Array.isArray(placeList)) for (const p of placeList) m.set(p.key, p.title)
    return m
  }, [been, savedList, events, placeList])

  const days = useMemo(() => visibleWeekend(anchors), [anchors])
  const visibleSlotN = days.length * PARTS.length
  const filledVis = filledForDays(dayPlans, days.map((d) => d.ts))
  const restN = days.filter((d) => dayEntryFor(dayPlans[String(d.ts)])?.state === 'rest').length
  const planTitles = days
    .flatMap((d) => {
      const e = dayEntryFor(dayPlans[String(d.ts)])
      return e ? PARTS.map((p) => e.slots[p]) : []
    })
    .map((k) => (k ? titleByKey.get(k) : null))
    .filter(Boolean)
    .slice(0, 3)
  const range =
    days.length > 1 ? fmtRange(days[0].ts, days[days.length - 1].ts) : fmtShort(days[0].ts)

  // N5b re-entry pull (Discover → Save → PLAN): saves are waiting but nothing's
  // planned ahead → invite turning one into a plan. Forward-framed, shown only
  // when both conditions hold (never a nag), routes to the upcoming weekend day
  // where saved events surface first in the picker.
  const upcomingSaves = useMemo(() => shelf.filter((x) => !x.past).length, [shelf])
  const hasUpcomingPlan = useMemo(
    () =>
      Object.entries(dayPlans).some(([k, e]) => {
        const en = dayEntryFor(e)
        return Number(k) >= anchors.todayTs && en && en.state !== 'rest' && PARTS.some((p) => en.slots[p])
      }),
    [dayPlans, anchors.todayTs]
  )
  const upcomingSat = useMemo(() => {
    const d = new Date(anchors.todayTs)
    const dow = d.getDay() // 0=Sun … 6=Sat
    const add = dow === 6 ? 0 : dow === 0 ? 6 : 6 - dow
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add).getTime()
  }, [anchors.todayTs])
  const showPlanPull = upcomingSaves > 0 && !hasUpcomingPlan

  // ===== Been there (O4): unanswered prompts + the self-reported went-list =====
  const answered = useMemo(
    () => new Set(been.filter((b) => b.status).map((b) => b.key)),
    [been]
  )
  const prompts = useMemo(() => {
    const out = []
    const seen = new Set()
    // passed saves still on the shelf (≤7 days after they happened)…
    for (const { e, past } of shelf) {
      if (!past) continue
      const k = keyOf(e)
      if (answered.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push({ key: k, e, snapshot: savedByKey.get(k)?.snapshot ?? rawOf(e) })
    }
    // …plus archive entries that expired off the shelf before being asked
    for (const b of been) {
      if (b.status || !b.snapshot || answered.has(b.key) || seen.has(b.key)) continue
      seen.add(b.key)
      out.push({ key: b.key, e: normalize({ ...b.snapshot }, anchors), snapshot: b.snapshot })
    }
    return out
  }, [shelf, been, answered, savedByKey, anchors])
  const wentList = useMemo(
    () =>
      been
        .filter((b) => b.status === 'went')
        .sort((a, b) => (b.statusAt || 0) - (a.statusAt || 0))
        .map((b) => ({ key: b.key, e: byKey.get(b.key) ?? (b.snapshot ? normalize({ ...b.snapshot }, anchors) : null) }))
        .filter((x) => x.e),
    [been, byKey, anchors]
  )

  // ===== U-d: the gentle ledger (all derivations, never new stores) =====
  // DID-DAYS — days you actually went out (been-there 'went', by snapshot.start).
  // The journal uses this to distinguish a did-day from a merely-planned past
  // day; a past day with no 'went' stays a quiet record, never a failure.
  const dids = useMemo(() => didDays(been), [been])
  // "N days out in {month}" — ZERO IS SILENCE. Counts distinct did-days in the
  // current calendar month; the line renders ONLY when n > 0 (never "0 📉").
  const monthStart = useMemo(() => {
    const d = new Date(anchors.todayTs)
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }, [anchors.todayTs])
  const nextMonthStart = useMemo(() => {
    const d = new Date(monthStart)
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  }, [monthStart])
  const daysOut = daysOutInMonth(dids, monthStart, nextMonthStart)
  const monthName = new Date(anchors.todayTs).toLocaleDateString('en-US', { month: 'long' })
  // VARIETY FIRSTS — breadth, not volume: a fixed handful of first-time-category
  // stamps earned from the went-list (never "10 events!"). Capped in dayplan.js.
  const firsts = useMemo(() => varietyFirsts(been), [been])
  // 3.76b: Plans → Reality (D-PS2) — this month's PAST planned days vs the ones you
  // made it to. A calm record, ZERO IS SILENCE, positive framing — you can only
  // have "gone" to a past day, so this is purely a fact, never a score or guilt.
  const monthReality = useMemo(() => {
    void planPageUp // re-read on plan-subpage edges (same trigger as dayHist)
    // 3.7P-3 FB-13: shared with the Calendar this-month rhythm strip (dayplan.js)
    return computeMonthReality(loadDayHistory(), dids, monthStart, nextMonthStart)
  }, [planPageUp, monthStart, nextMonthStart, dids])
  // 3.7P-4: the longer-arc rhythm/streak — shares gamify.js with the Calendar chip
  // so the surfaces can't drift. Profile owns the lifetime arc (current + best);
  // Calendar shows the live current. Finch-kind: dormant is never a shame state.
  const rhythm = useMemo(() => {
    void planPageUp
    return rhythmSummary(dids, restDayList(loadDayPlans(anchors), loadDayHistory()), anchors)
  }, [planPageUp, dids, anchors])
  // 3.76b: your ACTUAL rhythm (D-PS2) — when you've really gone out, from the
  // went-list's real event times. Gated at 3+ outings so we never claim a pattern
  // from noise. Shown beside the STATED preference; an honest mirror, never a score.
  const actualWhen = useMemo(() => {
    const went = (been || []).filter((b) => b.status === 'went' && b.snapshot?.start)
    if (went.length < 3) return null
    let weekend = 0
    let night = 0
    for (const b of went) {
      const d = new Date(b.snapshot.start)
      const dow = d.getDay()
      if (dow === 5 || dow === 6 || dow === 0) weekend++
      const h = d.getHours()
      if (h >= 17 || h < 5) night++
    }
    const n = went.length
    const wpart = weekend / n >= 0.6 ? 'weekend ' : weekend / n <= 0.4 ? 'weekday ' : ''
    const tpart = night / n >= 0.6 ? 'nights' : 'afternoons'
    return wpart + tpart
  }, [been])

  // ===== Recently viewed: recents keys resolved against the live dataset =====
  const recents = useMemo(
    () => recentKeys.map((k) => byKey.get(k)).filter(Boolean).slice(0, 6),
    [recentKeys, byKey]
  )

  return (
    <div className="pf-scroll">
      <header className="pf-head">
        <button className="pf-gear" onClick={openSettings} aria-label="Settings">
          <GearIc />
        </button>
        <div className="pf-over">Profile</div>
        <h1 className="pf-title">{vibeTitle}</h1>
        {/* Q2: the vibe chips are TAPPABLE now — the intuitive path from
            where taste is displayed to where it's edited (InterestEditor).
            The trailing ✎ chip makes the affordance visible instead of
            guessable, and doubles as the blank-profile invitation. */}
        <div className="pf-chips">
          {chips.map((c) => (
            <button
              key={c.id}
              className="pf-chip"
              style={{ '--ph': c.hue }}
              onClick={openInterests}
              aria-label={`${c.label} — edit your interests`}
            >
              <span aria-hidden>{c.emoji}</span> {c.label}
            </button>
          ))}
          {freeLeaning && (
            <button
              className="pf-chip pf-chip-free"
              onClick={openInterests}
              aria-label="Free-leaning — edit your interests"
            >
              <span aria-hidden>🆓</span> Free-leaning
            </button>
          )}
          <button className="pf-chip pf-chip-edit" onClick={openInterests} aria-label="Edit your interests">
            <span aria-hidden>✎</span> {chips.length > 0 || freeLeaning ? 'Edit' : 'Pick your interests'}
          </button>
        </div>
        {whenLine && (
          <div className="pf-when">
            {whenLine}
            {actualWhen && <span className="pf-when-actual"> · lately, mostly {actualWhen}</span>}
          </div>
        )}
        <div className="pf-note">{vibeNote}</div>
      </header>

      <div className="pf-body">
        {/* N5b re-entry pull: saves waiting + nothing planned → the next loop
            step (Discover → Save → PLAN). Quiet, forward-framed, never a nag. */}
        {showPlanPull && (
          <button className="pf-pull pressable" onClick={() => openDay(upcomingSat)}>
            <span className="pf-pull-main">
              <span className="pf-pull-title">Turn a save into a plan</span>
              <span className="pf-pull-sub">
                You&rsquo;ve saved {upcomingSaves} — slot one into a day
              </span>
            </span>
            <span className="pf-pull-go" aria-hidden>→</span>
          </button>
        )}

        {/* ===== Your taste (W6 connectivity) — the transparency panel and the
            calibration deck were buried in Settings (4 taps); surfaced here so
            taste is a first-class Profile hub. Interests stay editable via the
            header chips above. Both rows close back to Profile. DRAFT copy.
            ⚑W5/Charles: these two rows are now an INTENTIONAL second door to the
            same surfaces Settings still lists verbatim — W5's Settings redesign
            should make Profile the canonical home and demote/retitle the
            Settings copies so the identical titles don't read as a bug. ===== */}
        <section className="pf-sec">
          <SecHead overline="Tune what you see" title="Your taste" />
          <div className="pf-taste">
            <button className="pf-taste-row pressable" onClick={() => openTaste()}>
              <span className="pf-taste-ic" aria-hidden>🧭</span>
              <span className="pf-taste-main">
                <span className="pf-taste-t">Why your feed looks like this</span>
                <span className="pf-taste-s">The honest read on what we've learned</span>
              </span>
              <span className="pf-taste-go" aria-hidden>→</span>
            </button>
            <button className="pf-taste-row pressable" onClick={() => openDeck('profile')}>
              <span className="pf-taste-ic" aria-hidden>🃏</span>
              <span className="pf-taste-main">
                <span className="pf-taste-t">Rate a few to sharpen it</span>
                <span className="pf-taste-s">A quick deck — swipe what you'd actually go to</span>
              </span>
              <span className="pf-taste-go" aria-hidden>→</span>
            </button>
          </div>
        </section>

        {/* ===== Your list ===== */}
        <section className="pf-sec">
          <SecHead
            overline="Saved for later"
            title={
              <>
                Your list ❤️
                {shelf.length > 0 && <span className="shelf-count">{shelf.length}</span>}
              </>
            }
          />
          {shelf.length ? (
            <div className="pf-rows">
              {shelf.map(({ e, past }) => (
                <div key={keyOf(e)} className={'pf-item' + (past ? ' pf-past' : '')}>
                  {past && <span className="pf-happened">Happened</span>}
                  <GemRow e={e} onSelect={onSelect} />
                </div>
              ))}
            </div>
          ) : (
            <div className="pf-empty">Nothing saved yet. Tap ♡ on anything to keep it here.</div>
          )}
        </section>

        {/* ===== Your plans (the Weekend Builder's primary home) ===== */}
        <section className="pf-sec">
          <SecHead overline="Weekends live here" title="Your plans" />
          <button className="pf-plan pressable" onClick={onOpenWeekend}>
            <span className="pf-plan-over">This weekend</span>
            <span className="pf-plan-range">{range}</span>
            <span className="pf-plan-fill">
              {filledVis > 0
                ? `${filledVis}/${visibleSlotN} slots planned` + (restN > 0 ? ' · a quiet day' : '')
                : restN > 0
                  ? 'A quiet weekend planned'
                  : 'Nothing planned yet — tap to start'}
            </span>
            {planTitles.length > 0 && (
              <span className="pf-plan-picks">
                {planTitles.map((t, i) => (
                  <span key={i} className="pf-plan-pick">
                    · {t}
                  </span>
                ))}
              </span>
            )}
            <span className="pf-plan-go" aria-hidden>
              →
            </span>
          </button>
          {history.length > 0 && (
            <>
              <div className="pf-hist-label">Past weekends</div>
              {history.map((p) => (
                <HistoryCard key={p.weekendStartTs} p={p} byKey={byKey} titleByKey={titleByKey} onSelect={onSelect} />
              ))}
            </>
          )}
          {/* U-d: the past-days JOURNAL from 'day-history-v1'. Three honest
              states, never a gap, never a failure:
                · a did-day (you answered "I went" — derived from been-there) is
                  marked "✓ Went" (DRAFT) — a plan that became a thing you did;
                · a past REST day is "Rested 🌙" (DRAFT — a RECORD, the past
                  tense of the future "Resting 🌙" intent), honored, never asked;
                · a merely-planned past day stays a quiet record of the plan. */}
          {/* 3.76b: Plans → Reality (D-PS2) — this month's plans vs follow-through.
              Zero-is-silence (only with plans), no guilt, positive framing. DRAFT. */}
          {monthReality.planned > 0 && (
            <div className="pf-reality">
              <span className="pf-reality-n">{monthReality.planned}</span> planned in {monthName} ·{' '}
              <span className="pf-reality-n pf-reality-went">{monthReality.went}</span> you made it to
            </div>
          )}
          {dayHist.length > 0 && (
            <>
              <div className="pf-hist-label">Past days</div>
              {dayHist.map((h) => {
                const went = dids.has(h.dayTs)
                return (
                  <div className={'pf-dayh' + (went ? ' pf-dayh-went' : '')} key={h.dayTs}>
                    <span className="pf-dayh-date">🗓️ {fmtShort(h.dayTs)}</span>
                    <span className="pf-dayh-what">
                      {h.state === 'rest'
                        ? 'Rested 🌙'
                        : PARTS.filter((p) => h.slots[p])
                            .map(
                              (p) =>
                                (p === 'day' ? '☀️ ' : '🌙 ') + (titleByKey.get(h.slots[p]) ?? 'no longer listed')
                            )
                            .join(' · ')}
                    </span>
                    {/* the did-day mark — a plan you made became a thing you did */}
                    {went && h.state !== 'rest' && <span className="pf-dayh-went-tag">✓ Went</span>}
                  </div>
                )
              })}
            </>
          )}
        </section>

        {/* ===== Been there ===== */}
        <section className="pf-sec">
          <SecHead
            overline="Self-reported, proudly"
            title={
              <>
                Been there
                {wentList.length > 0 && <span className="shelf-count">{wentList.length}</span>}
              </>
            }
          />
          {/* U-d — the gentle ledger. "N days out in {month}" is a calm RECORD,
              not a score: ZERO IS SILENCE (it simply isn't rendered at 0 — never
              "0 📉", never shame, ban §7 #8). Variety FIRSTS celebrate BREADTH:
              a fixed handful of first-time-category stamps, never a volume count
              (ban §7 #5). ALL COPY IS DRAFT for Charles. */}
          {daysOut > 0 && (
            <div className="pf-ledger-line">
              {daysOut === 1
                ? `1 day out in ${monthName} so far 🗓️`
                : `${daysOut} days out in ${monthName} so far 🗓️`}
            </div>
          )}
          {/* 3.7P-4: the longer-arc rhythm — a calm RECORD, never a "don't break
              the chain" guilt. Dormant reads warm (best run), never a broken flame.
              Shares gamify.js with the Calendar chip. DRAFT copy for Charles. */}
          {(rhythm.current >= 1 || rhythm.best >= 2) && (
            <div className="pf-rhythm">
              {rhythm.current >= 1 ? (
                <>
                  <span aria-hidden>🔥</span> {rhythm.current}-day rhythm
                  {rhythm.best > rhythm.current ? ` · best ${rhythm.best}` : ''}
                </>
              ) : (
                `Best rhythm: ${rhythm.best} days`
              )}
            </div>
          )}
          {firsts.length > 0 && (
            <div className="pf-firsts">
              {firsts.map((f) => (
                <span className="pf-first" key={f.id}>
                  <span aria-hidden>{f.emoji}</span> {f.label}
                </span>
              ))}
            </div>
          )}
          {prompts.length > 0 && (
            <div className="pf-asks">
              {prompts.map(({ key, e, snapshot }) => (
                <div key={key} className="pf-ask">
                  <div className="pf-ask-main">
                    <div className="pf-ask-q">Did you make it?</div>
                    <div className="pf-ask-title">{e.title}</div>
                    <div className="pf-ask-meta">{[dayLoose(e), e.venue].filter(Boolean).join(' · ')}</div>
                    <SponsoredTag e={e} />
                  </div>
                  <div className="pf-ask-btns">
                    <button className="pf-ask-yes" onClick={() => markBeen(key, snapshot, 'went')}>
                      I went 🎉
                    </button>
                    <button className="pf-ask-no" onClick={() => markBeen(key, snapshot, 'missed')}>
                      Missed it
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {wentList.length > 0 ? (
            <div className="pf-rows">
              {wentList.map(({ key, e }) => (
                <div key={key} className="pf-item">
                  <GemRow e={e} onSelect={onSelect} />
                </div>
              ))}
            </div>
          ) : (
            prompts.length === 0 && (
              <div className="pf-empty">
                After a saved event passes, we'll ask if you made it — your been-there list builds here.
                No tracking, just your word.
              </div>
            )
          )}
        </section>

        {/* ===== Recently viewed ===== */}
        <section className="pf-sec">
          <SecHead overline="Pick up where you left off" title="Recently viewed" />
          {recents.length ? (
            <div className="pf-rows">
              {recents.map((e, i) => (
                <GemRow key={keyOf(e) + i} e={e} onSelect={onSelect} />
              ))}
            </div>
          ) : (
            <div className="pf-empty">Anything you open shows up here.</div>
          )}
        </section>

        <div className="pf-foot">This whole page lives in your browser — no account, nothing leaves your phone.</div>
      </div>
    </div>
  )
}

// O5 — one archived weekend, read-only. Collapsed: range + filled count.
// Expanded: the filled slots — events still in the dataset open their detail;
// vanished ones show their archived title (or an honest "no longer listed").
function HistoryCard({ p, byKey, titleByKey, onSelect }) {
  const [open, setOpen] = useState(false)
  const days = weekendDays({ wkStartTs: p.weekendStartTs }) // [fri, sat, sun] timestamps
  const n = filledCount(p)
  const rows = open
    ? SLOT_IDS.filter((id) => p.slots[id]).map((id) => {
        const [dayId, part] = id.split('_')
        const ts = days[DAY_IDS.indexOf(dayId)]
        const k = p.slots[id]
        const live = byKey.get(k) ?? null
        return { id, k, part, live, title: live?.title ?? titleByKey.get(k) ?? null, ts }
      })
    : []
  return (
    <div className={'pf-hist' + (open ? ' open' : '')}>
      <button className="pf-hist-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="pf-hist-range">🗓️ {fmtRange(days[0], days[2])}</span>
        <span className="pf-hist-n">
          {n} planned <span className="pf-hist-chev" aria-hidden>{open ? '▴' : '▾'}</span>
        </span>
      </button>
      {open && (
        <div className="pf-hist-rows">
          {rows.map((r) =>
            r.live ? (
              <button key={r.id} className="pf-hist-row pf-hist-live" onClick={(ev) => onSelect(r.live, ev.currentTarget)}>
                <span className="pf-hist-slot">
                  {new Date(r.ts).toLocaleDateString('en-US', { weekday: 'short' })} {r.part === 'day' ? '☀️' : '🌙'}
                </span>
                <span className="pf-hist-title">{r.title}</span>
                <SponsoredTag e={r.live} />
              </button>
            ) : (
              <div key={r.id} className="pf-hist-row">
                <span className="pf-hist-slot">
                  {new Date(r.ts).toLocaleDateString('en-US', { weekday: 'short' })} {r.part === 'day' ? '☀️' : '🌙'}
                </span>
                <span className={'pf-hist-title' + (r.title ? '' : ' pf-hist-gone')}>
                  {r.title ?? 'no longer listed'}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
