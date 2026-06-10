// FindMyNight — guided night-finder opened by the 🎲 FAB.
// Three big-tap questions (when / who / vibe) → a beat of theater → five scored
// picks with Reroll. App mounts it inside the sliding .subpage overlay (z 1500,
// below detail 2000); tapping a pick opens the detail ON TOP — page persists.
//
// Props contract:
//   events   — normalized events
//   anchors  — { todayTs, tomorrowTs, wkStartTs, wkEndTs }
//   onSelect — (event, cardEl|null) opens the detail (stacks on top)
//   onClose  — slide back out to the Hot tab
import { useEffect, useMemo, useRef, useState } from 'react'
import { DAY, Icon, dayLoose, keyOf, milesBetween, timeOf } from './lib.js'
import { CardImg, HeatBadge, PriceChip, SponsoredTag } from './cards.jsx'
import './fmn.css'

const QUESTIONS = [
  {
    id: 'when',
    title: 'When are you going out?',
    options: [
      { v: 'tonight', emoji: '🌙', label: 'Tonight' },
      { v: 'weekend', emoji: '🎉', label: 'This weekend' },
      { v: 'soon', emoji: '🗓️', label: 'Whenever soon', sub: 'Next 14 days' },
    ],
  },
  {
    id: 'who',
    title: 'Who’s coming?',
    options: [
      { v: 'solo', emoji: '🧍', label: 'Just me' },
      { v: 'date', emoji: '❤️', label: 'Date night' },
      { v: 'friends', emoji: '👯', label: 'With friends' },
      { v: 'family', emoji: '👨‍👩‍👧', label: 'Family crew' },
    ],
  },
  {
    id: 'vibe',
    title: 'What’s the vibe?',
    options: [
      { v: 'chill', emoji: '😌', label: 'Chill' },
      { v: 'wild', emoji: '🎉', label: 'Wild' },
      { v: 'outdoors', emoji: '🌳', label: 'Outdoors' },
      { v: 'cultured', emoji: '🎭', label: 'Cultured' },
      { v: 'hungry', emoji: '🍔', label: 'Hungry' },
      { v: 'surprise', emoji: '🎲', label: 'Surprise me' },
    ],
  },
]

// category affinity sets (scoring spec)
const WHO_SETS = {
  date: new Set(['food', 'theatre', 'art', 'nightlife', 'music']),
  friends: new Set(['nightlife', 'music', 'sports', 'comedy', 'market']),
  family: new Set(['family', 'outdoors', 'market', 'community']),
  solo: new Set(['art', 'community', 'outdoors', 'music']),
}
const VIBE_SETS = {
  chill: new Set(['art', 'outdoors', 'market', 'food']),
  wild: new Set(['nightlife', 'music', 'comedy']),
  outdoors: new Set(['outdoors', 'sports', 'market']),
  cultured: new Set(['art', 'theatre', 'community']),
  hungry: new Set(['food', 'market']),
  surprise: null, // matches everything; random tiebreak does the surprising
}

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// --- time-of-day helpers (late-night "Tonight" mode) ---
// minutes since the clocked start (negative = hasn't started); null = date-only
const startedMin = (e, nowMs) =>
  /T\d/.test(e.start || '') ? (nowMs - new Date(e.start).getTime()) / 60000 : null
// over = ongoing / began an earlier day / clocked start more than an hour ago —
// at 10pm a 1pm ballgame is not a plan, no matter how hot its score is
const overBy = (e, nowMs, todayTs) => {
  if (e._ongoing || (e._day != null && e._day < todayTs)) return true
  const m = startedMin(e, nowMs)
  return m != null && m > 60
}
// joinable late = a clocked start that's still ahead (or <1h in) tonight
const joinableLate = (e, nowMs, todayTs) => startedMin(e, nowMs) != null && !overBy(e, nowMs, todayTs)
const lateStart = (e) => /T\d/.test(e.start || '') && new Date(e.start).getHours() >= 20

// --- no-repeat memory: keys shown in recent reveals (FIFO, cap 40) ---
// Seen events are de-prioritized at scoring time, never excluded.
const SEEN_KEY = 'fmn-seen-v1'
const SEEN_CAP = 40
function loadSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY))
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []
  } catch {
    return [] // missing key / corrupt JSON / private mode — memory just starts empty
  }
}
function pushSeen(keys) {
  try {
    const kept = loadSeen().filter((k) => !keys.includes(k))
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept.concat(keys).slice(-SEEN_CAP)))
  } catch {
    /* storage unavailable — fine, memory just doesn't persist */
  }
}

export default function FindMyNight({ events, anchors, coords, onSelect, onClose }) {
  const [step, setStep] = useState(0) // which question is showing (phase 'ask')
  const [phase, setPhase] = useState('ask') // 'ask' | 'think' | 'results'
  const [ans, setAns] = useState({ when: null, who: null, vibe: null })
  const [pageIdx, setPageIdx] = useState(0) // reroll offset (page of five)
  const [gen, setGen] = useState(0) // bump = reshuffle the random tiebreak
  const tRef = useRef(null)
  const reduced = useMemo(() => prefersReduced(), [])
  useEffect(() => () => clearTimeout(tRef.current), [])

  // clock + memory are one-shot reads at mount: scoring stays stable while the
  // page is up (each 🎲 open remounts, so both stay reasonably fresh)
  const [now] = useState(() => new Date())
  const [seen, setSeen] = useState(() => new Set(loadSeen()))
  const revealedRef = useRef(new Set()) // keys revealed THIS session (absorbed on answer edits)
  const nowMs = now.getTime()
  const lateNight = ans.when === 'tonight' && now.getHours() >= 21

  // Q1 window: tonight / weekend / next 14 days — always upcoming-only.
  // Late at night, a "Tonight" with <5 not-yet-started events honestly widens
  // to tomorrow (fallback flag drives the reveal header) instead of reselling
  // events that already happened.
  const { pool, usedTomorrow } = useMemo(() => {
    if (!ans.when) return { pool: [], usedTomorrow: false }
    const up = events.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
    if (ans.when === 'tonight') {
      const tonight = up.filter((e) => e._tonight)
      if (lateNight && tonight.filter((e) => joinableLate(e, nowMs, anchors.todayTs)).length < 5) {
        const tmrw = up.filter(
          (e) => !e._tonight && e._day <= anchors.tomorrowTs && (e._endDay ?? e._day) >= anchors.tomorrowTs
        )
        return { pool: tonight.concat(tmrw), usedTomorrow: true }
      }
      return { pool: tonight, usedTomorrow: false }
    }
    if (ans.when === 'weekend') return { pool: up.filter((e) => e._weekend), usedTomorrow: false }
    return { pool: up.filter((e) => e._day <= anchors.todayTs + 14 * DAY), usedTomorrow: false }
  }, [events, anchors, ans.when, lateNight, nowMs])

  // per-event jitter (scored AND tiebreak); regenerated when gen bumps (reroll
  // wrap = reshuffle) and when answers change — every brief gets a fresh draw
  const rand = useMemo(() => {
    const m = new Map()
    // deliberate impurity: the jitter is memoized per [pool, gen, answers]
    // generation, so renders within a generation are stable
    // eslint-disable-next-line react-hooks/purity
    for (const e of pool) m.set(keyOf(e), Math.random())
    return m
  }, [pool, gen, ans.who, ans.vibe]) // eslint-disable-line react-hooks/exhaustive-deps

  // SCORING V2: answer matches dominate. hotScore is haircut to 0.45 so its full
  // spread (~35 pts) can never outvote a single vibe hit (40) — a hot Rays game
  // stays out of "date night + wild". Seen-recently sinks; late-night Tonight
  // de-ranks already-started events; per-session jitter varies the tiebreaks.
  // Rank, then greedily slice into pages of five (max 2 per category each).
  const pages = useMemo(() => {
    if (!ans.who || !ans.vibe) return []
    const vibeSet = VIBE_SETS[ans.vibe]
    const whoSet = WHO_SETS[ans.who]
    const vibeHit = (e) => vibeSet === null || vibeSet.has(e.category)
    // clock score. The over-event penalty applies to ANY "tonight" brief — a
    // 1:10 PM ballgame is not a 7 PM plan either (review: it leaked into
    // friends+wild at prime hours). The date-only (-20) and late-start (+15)
    // branches stay late-night-only: before ~9 PM a date-only listing is
    // still a plausible plan.
    const tonightBrief = ans.when === 'tonight'
    const clock = (e) => {
      // -80, not -45: a hotScore-98 over-event keeps ~24 pts at -45 (98*0.45
      // + who-bonus) and still beats live low-score events. Over must mean
      // BELOW everything live; it can still surface when nothing else exists.
      if (tonightBrief && overBy(e, nowMs, anchors.todayTs)) return -80
      if (!lateNight) return 0
      const m = startedMin(e, nowMs)
      if (m == null) return -20
      if (m > 0) return -10
      return lateStart(e) ? 15 : 0
    }
    const score = (e) =>
      (e.hotScore ?? 30) * 0.45 +
      (vibeHit(e) ? 40 : 0) +
      (whoSet.has(e.category) ? 25 : 0) +
      (e._free ? 8 : 0) +
      (seen.has(keyOf(e)) ? -18 : 0) +
      clock(e) +
      (rand.get(keyOf(e)) ?? 0.5) * 6
    let ranked = pool
      .map((e) => ({ e, s: score(e) }))
      .sort((a, b) => b.s - a.s || (rand.get(keyOf(a.e)) ?? 0) - (rand.get(keyOf(b.e)) ?? 0))
      .map((x) => x.e)
    // HARD-PREFER: when ≥5 events in the window are on-vibe, off-vibe events can
    // only fill leftover slots — they queue behind every on-vibe event. Late at
    // night an over event never rides the preference lane, vibe match or not.
    if (vibeSet !== null) {
      // an over event never rides the preference lane on a "tonight" brief
      const pref = (e) => vibeHit(e) && !(tonightBrief && overBy(e, nowMs, anchors.todayTs))
      const hit = ranked.filter(pref)
      if (hit.length >= 5) ranked = hit.concat(ranked.filter((e) => !pref(e)))
    }
    const out = []
    let rest = ranked
    while (rest.length) {
      const page = []
      const counts = {}
      const next = []
      for (const e of rest) {
        if (page.length < 5 && (counts[e.category] || 0) < 2) {
          page.push(e)
          counts[e.category] = (counts[e.category] || 0) + 1
        } else next.push(e)
      }
      if (!page.length) break
      out.push(page)
      rest = next
    }
    return out
  }, [pool, rand, ans.when, ans.who, ans.vibe, seen, lateNight, nowMs, anchors.todayTs])

  const picks = useMemo(() => (pages.length ? pages[pageIdx % pages.length] : []), [pages, pageIdx])

  // WILDCARD HONESTY: a pick that matched neither the vibe-set nor the who-set
  // wears a tag instead of posing as a confident win ("surprise" matches all)
  const isWildcard = (e) => {
    const vs = VIBE_SETS[ans.vibe]
    const ws = WHO_SETS[ans.who]
    return !!vs && !!ws && !vs.has(e.category) && !ws.has(e.category)
  }
  const softReveal = picks.length > 0 && picks.every(isWildcard)

  // record what this reveal showed → the de-prioritize list (localStorage for
  // next session + a ref for this one)
  useEffect(() => {
    if (phase === 'results' && picks.length) {
      const keys = picks.map(keyOf)
      pushSeen(keys)
      for (const k of keys) revealedRef.current.add(k)
    }
  }, [phase, picks])

  // fold this session's reveals into the live seen-set — only called at moments
  // the picks are NOT on screen, so results never reshuffle under the user
  const absorbSeen = () => {
    let dirty = false
    for (const k of revealedRef.current) if (!seen.has(k)) dirty = true
    if (dirty) setSeen(new Set([...seen, ...revealedRef.current]))
  }

  // answering: highlight the tap, then ~250ms slide to the next unanswered
  // question — or the theater beat → results when all three are in.
  const pick = (qid, v) => {
    const next = { ...ans, [qid]: v }
    setAns(next)
    setPageIdx(0)
    clearTimeout(tRef.current)
    const go = () => {
      const missing = QUESTIONS.findIndex((q) => next[q.id] == null)
      if (missing === -1) {
        if (reduced) setPhase('results') // cut the theater to instant
        else {
          setPhase('think')
          tRef.current = setTimeout(() => setPhase('results'), 700)
        }
      } else {
        setStep(missing)
        setPhase('ask')
      }
    }
    if (reduced) go()
    else tRef.current = setTimeout(go, 250)
  }

  // progress dots double as edit buttons: jump back to any answered question
  const editStep = (i) => {
    clearTimeout(tRef.current)
    absorbSeen()
    setPhase('ask')
    setStep(i)
  }

  // Reroll = the NEXT five by score; wrapping past the end reshuffles ties
  const reroll = () => {
    if (!pages.length) return
    if (pageIdx + 1 >= pages.length) {
      setGen((g) => g + 1)
      setPageIdx(0)
    } else setPageIdx((i) => i + 1)
  }
  const startOver = () => {
    clearTimeout(tRef.current)
    absorbSeen()
    setAns({ when: null, who: null, vibe: null })
    setStep(0)
    setPageIdx(0)
    setGen((g) => g + 1)
    setPhase('ask')
  }

  const q = QUESTIONS[step]
  const summary = QUESTIONS.map((qq) => qq.options.find((o) => o.v === ans[qq.id]))
    .filter(Boolean)
    .map((o) => `${o.emoji} ${o.label}`)
    .join('  ·  ')

  return (
    <div className="pg fmn">
      <header className="pg-head fmn-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Find My Night</h1>
        <div className="fmn-dots" aria-label="Your answers — tap to edit">
          {QUESTIONS.map((qq, i) => {
            const a = qq.options.find((o) => o.v === ans[qq.id])
            const active = phase === 'ask' && i === step
            return (
              <button
                key={qq.id}
                className={'fmn-dot' + (active ? ' on' : '') + (a ? ' done' : '')}
                disabled={!a && !active}
                onClick={() => editStep(i)}
                aria-label={qq.title + (a ? ` — ${a.label} (tap to edit)` : '')}
              >
                {a ? a.emoji : ''}
              </button>
            )
          })}
        </div>
      </header>

      <div className="pg-body fmn-body">
        {phase === 'ask' && (
          <div className="fmn-q" key={step}>
            <div className="fmn-qnum">Question {step + 1} of 3</div>
            <h2 className="fmn-qtitle">{q.title}</h2>
            <div className={'fmn-opts' + (q.options.length > 4 ? ' fmn-opts-grid' : '')}>
              {q.options.map((o) => (
                <button
                  key={o.v}
                  className={'fmn-opt pressable' + (ans[q.id] === o.v ? ' sel' : '')}
                  onClick={() => pick(q.id, o.v)}
                >
                  <span className="fmn-opt-emoji">{o.emoji}</span>
                  <span className="fmn-opt-label">{o.label}</span>
                  {o.sub && <span className="fmn-opt-sub">{o.sub}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'think' && (
          <div className="fmn-think" aria-live="polite">
            <div className="fmn-think-line">Okay… I think I’ve got you 🔥</div>
            <div className="fmn-think-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        {phase === 'results' && (
          <div className="fmn-res">
            <div className="fmn-res-head">
              <div className="fmn-res-over">
                {picks.length >= 5 ? 'Your five' : picks.length > 0 ? `Best ${picks.length} I found` : 'Hmm'}
              </div>
              <h2 className="fmn-res-title">
                {!picks.length
                  ? 'Tough brief 😅'
                  : usedTomorrow
                    ? 'Tonight’s thin — here’s tomorrow 🌅'
                    : softReveal
                      ? 'Closest I could find 🤏'
                      : 'I’ve got you 🔥'}
              </h2>
              <div className="fmn-res-sub">{summary}</div>
            </div>
            {picks.length === 0 ? (
              <div className="fmn-empty">
                Nothing’s on in that window.
                <br />
                Try 🗓️ Whenever soon — tap the first dot up top.
              </div>
            ) : (
              <div className="fmn-picks" key={pageIdx + ':' + gen}>
                {picks.map((e, i) => (
                  <button
                    key={keyOf(e)}
                    className="fmn-pick pressable"
                    style={{ animationDelay: i * 70 + 'ms' }}
                    onClick={(ev) => onSelect(e, ev.currentTarget)}
                  >
                    <CardImg e={e} className="fmn-pick-img">
                      <HeatBadge e={e} />
                    </CardImg>
                    <div className="fmn-pick-main">
                      <div className="fmn-pick-title">{e.title}</div>
                      <div className="fmn-pick-meta">
                        {(e._ongoing ? ['Ongoing', e.venue] : [dayLoose(e), timeOf(e.start), e.venue])
                          .concat(
                            coords && e.lat != null && e.lng != null
                              ? milesBetween(coords, e).toFixed(1) + ' mi'
                              : []
                          )
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <div className="fmn-pick-extra">
                        <PriceChip e={e} />
                        {isWildcard(e) && <span className="fmn-wild">Wildcard</span>}
                        <SponsoredTag e={e} />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="fmn-actions">
              {picks.length > 0 && (
                <button className="fmn-btn fmn-btn-hot pressable" onClick={reroll}>
                  🎲 Reroll
                </button>
              )}
              <button className="fmn-btn pressable" onClick={startOver}>
                ↺ Start over
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
