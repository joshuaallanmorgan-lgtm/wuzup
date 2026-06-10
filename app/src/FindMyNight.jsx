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
import { DAY, Icon, dayLoose, keyOf, timeOf } from './lib.js'
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

export default function FindMyNight({ events, anchors, onSelect, onClose }) {
  const [step, setStep] = useState(0) // which question is showing (phase 'ask')
  const [phase, setPhase] = useState('ask') // 'ask' | 'think' | 'results'
  const [ans, setAns] = useState({ when: null, who: null, vibe: null })
  const [pageIdx, setPageIdx] = useState(0) // reroll offset (page of five)
  const [gen, setGen] = useState(0) // bump = reshuffle the random tiebreak
  const tRef = useRef(null)
  const reduced = useMemo(() => prefersReduced(), [])
  useEffect(() => () => clearTimeout(tRef.current), [])

  // Q1 window: tonight / weekend / next 14 days — always upcoming-only
  const pool = useMemo(() => {
    if (!ans.when) return []
    const up = events.filter((e) => e._day != null && (e._endDay ?? e._day) >= anchors.todayTs)
    if (ans.when === 'tonight') return up.filter((e) => e._tonight)
    if (ans.when === 'weekend') return up.filter((e) => e._weekend)
    return up.filter((e) => e._day <= anchors.todayTs + 14 * DAY)
  }, [events, anchors, ans.when])

  // per-event random tiebreak; regenerated when gen bumps (reroll wrap = reshuffle)
  const rand = useMemo(() => {
    const m = new Map()
    // deliberate impurity: the random tiebreak is memoized per [pool, gen] generation,
    // so renders within a generation are stable (reroll wrap bumps gen to reshuffle)
    // eslint-disable-next-line react-hooks/purity
    for (const e of pool) m.set(keyOf(e), Math.random())
    return m
  }, [pool, gen]) // eslint-disable-line react-hooks/exhaustive-deps

  // score + rank, then greedily slice into pages of five (max 2 per category each)
  const pages = useMemo(() => {
    if (!ans.who || !ans.vibe) return []
    const vibeSet = VIBE_SETS[ans.vibe]
    const whoSet = WHO_SETS[ans.who]
    const score = (e) =>
      (e.hotScore ?? 30) +
      (vibeSet === null || vibeSet.has(e.category) ? 25 : 0) +
      (whoSet.has(e.category) ? 15 : 0) +
      (e._free ? 5 : 0)
    const ranked = pool
      .map((e) => ({ e, s: score(e) }))
      .sort((a, b) => b.s - a.s || (rand.get(keyOf(a.e)) ?? 0) - (rand.get(keyOf(b.e)) ?? 0))
      .map((x) => x.e)
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
  }, [pool, rand, ans.who, ans.vibe])

  const picks = pages.length ? pages[pageIdx % pages.length] : []

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
              <h2 className="fmn-res-title">{picks.length ? 'I’ve got you 🔥' : 'Tough brief 😅'}</h2>
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
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <div className="fmn-pick-extra">
                        <PriceChip e={e} />
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
