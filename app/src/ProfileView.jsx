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
import { confidence, interviewAnswers, topCategories, useTaste } from './taste.js'
import { useRecents } from './recents.js'
import { DAY_IDS, SLOT_IDS, filledCount, loadHistory, loadPlan, visibleWeekend, weekendDays } from './weekend.js'
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
  const { openDetail: onSelect, openWeekend: onOpenWeekend, openSettings, openInterests, page } = useNav()
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
  // best-known title per key for plan summaries/history: live dataset wins,
  // then saved snapshots, then been-there snapshots — never fabricated
  const titleByKey = useMemo(() => {
    const m = new Map()
    for (const b of been) if (b.snapshot?.title) m.set(b.key, b.snapshot.title)
    for (const s of savedList) if (s.snapshot?.title) m.set(s.key, s.snapshot.title)
    for (const e of events) m.set(keyOf(e), e.title)
    return m
  }, [been, savedList, events])

  // ===== vibe header (live taste profile → identity, confidence-aware) =====
  const conf = confidence(taste)
  const chips = topCategories(taste, 3)
    .map((c) => categoryById[c])
    .filter(Boolean)
  const freeLeaning = taste.freeAffinity >= 5 // the same gate tasteNudge's free bonus uses
  // two surfaces answer "when do you head out": the editor's dayparts (newer,
  // re-editable any time) WINS over the primer's first-open answer — otherwise
  // setting Weeknights in the editor leaves Profile asserting an old "Weekends
  // are your nights" and the app reads as not listening (Q2 review LOW-1;
  // 'both' wears the whenever line). Full unification is Sprint V1's job.
  const editedWhen = { weeknights: 'weeknights', weekends: 'weekends', both: 'whenever' }[interviewAnswers(taste)?.dayparts]
  const whenLine = editedWhen ? WHEN_LINE[editedWhen] : primer?.done && primer.when ? WHEN_LINE[primer.when] : null
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

  // ===== Your plans (O5): current weekend summary + read-only history =====
  // loadPlan/loadHistory are plain localStorage reads (not reactive stores);
  // plans only ever change through a Weekend Builder subpage, so re-reading
  // on every WB open/close edge (wbOpen flip) keeps this card honest — the
  // close-edge recompute picks up whatever WB persisted, and the open-edge
  // one is a harmless refresh. (WB's own archive write happens at ITS mount,
  // so the close edge sees fresh history too.)
  const wbOpen = page?.type === 'weekend'
  const plan = useMemo(() => {
    void wbOpen // re-read trigger (see above)
    return loadPlan(anchors.wkStartTs)
  }, [anchors.wkStartTs, wbOpen])
  const history = useMemo(() => {
    void wbOpen
    return loadHistory()
      .filter((p) => p.weekendStartTs !== anchors.wkStartTs) // current weekend renders live above
      .reverse() // most recent past weekend first
  }, [anchors.wkStartTs, wbOpen])
  const days = useMemo(() => visibleWeekend(anchors), [anchors])
  const visibleSlotIds = days.flatMap((d) => ['day', 'night'].map((p) => d.id + '_' + p))
  const filledVis = filledCount(plan, visibleSlotIds)
  const planTitles = visibleSlotIds
    .map((id) => (plan.slots[id] ? titleByKey.get(plan.slots[id]) : null))
    .filter(Boolean)
    .slice(0, 3)
  const range =
    days.length > 1 ? fmtRange(days[0].ts, days[days.length - 1].ts) : fmtShort(days[0].ts)

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
        {whenLine && <div className="pf-when">{whenLine}</div>}
        <div className="pf-note">{vibeNote}</div>
      </header>

      <div className="pf-body">
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
            <div className="pf-empty">Nothing saved yet. Tap the ♡ on anything that looks fun — it lands here.</div>
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
                ? `${filledVis}/${visibleSlotIds.length} slots planned`
                : 'Nothing planned yet — tap to build it 🗓️'}
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
                After a saved event passes, we'll ask if you made it — your went-list builds here. No tracking,
                just your word. 🤙
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
            <div className="pf-empty">Everything you peek at lands here. Go poke around 👀</div>
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
