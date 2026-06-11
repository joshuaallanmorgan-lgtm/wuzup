/* eslint-disable react-refresh/only-export-components --
   gestureVerdict (the pure threshold decision) is pinned to this file so the
   commit math is Node-sim-able next to the component that owns it (same
   precedent as CalibrationDeck's dealDeck — dev-time Fast Refresh
   granularity only). */
// SwipeDeck — Sprint Q1: the REUSABLE pointer-gesture card stack, extracted
// verbatim from CalibrationDeck (the adversarially-verified Sprint-P surface).
// Raw pointer events, zero deps, spring-feel transforms within the UI_SPEC
// motion tokens (--dur-fast/--ease-out; swipedeck.css owns the mechanics).
//
// GENERIC BY CONTRACT: this component knows NOTHING about taste, saves, or
// FMN — signals are the CONSUMER's job, fired through the verdict callbacks
// exactly once per committed card. Current consumers: CalibrationDeck (P3,
// classPrefix="deck" keeps its verified class names) and LensDeck (Q2).
//
// Props contract:
//   cards         — the dealt, FINITE array (dealing is the consumer's job)
//   keyFor        — (card) => stable string key (React keys + exit clone)
//   renderCard    — (card) => node: the card face
//   stamps        — optional node rendered inside the TOP card while gestures
//                   are live; opacity wired via --like/--nope/--keep CSS vars
//                   (0..1 with drag travel). Hidden under reduced motion.
//   apiRef        — a useRef the consumer passes in; SwipeDeck writes
//                   { left(), right(), up() } into it (inside an effect —
//                   the react-hooks/refs-clean handoff; nav.jsx precedent for
//                   dodging the createElement/render-prop form). The consumer
//                   renders its OWN button row wired to these — and those
//                   buttons must be ALWAYS VISIBLE regardless of motion
//                   preference: buttons are the primary affordance, swipe is
//                   the enhancement (UI_SPEC reduced-motion rule).
//   onLeft / onRight / onUp — verdict callbacks; each committed card fires
//                   exactly ONE (one-verdict-per-gesture: dragRef nulls before
//                   the commit, and a commit advances idx so a card can never
//                   be re-judged).
//   onUp + upMode — 'commit' (default): up flies the card away and advances
//                   (CalibrationDeck's save). 'peek': up calls onUp but the
//                   card stays — LensDeck's open-the-detail, where peeking at
//                   an event must not cost the user their keep/pass call.
//   onDone        — fired once, after the LAST card commits (420ms so the
//                   final card finishes flying; immediate under reduced
//                   motion). The consumer owns what "done" means — SwipeDeck
//                   never re-deals, never loops.
//   classPrefix   — optional legacy class mirror: prefix 'deck' makes every
//                   element ALSO wear deck-stack/deck-card/deck-top/… so
//                   CalibrationDeck's verified deck.css keeps matching.
//
// GESTURE MATH (unchanged from the verified source): SWIPE_X=80px horizontal
// travel commits left/right; SWIPE_Y=90px upward travel (and more up than
// sideways) commits up. Under threshold = the CSS transition springs the card
// back. Reduced motion: pointer handlers are never attached — buttons only.
import { useEffect, useMemo, useRef, useState } from 'react'
import './swipedeck.css'

const SWIPE_X = 80 // px of horizontal travel that commits a left/right verdict
const SWIPE_Y = 90 // px of upward travel that commits an up verdict

// the pure threshold decision (extracted verbatim from the verified onUp
// handler; exported for Node sims): up wins only when the upward travel beats
// both its threshold AND the horizontal magnitude; otherwise horizontal
// commits past SWIPE_X; under-threshold = null (the card springs back).
export function gestureVerdict(dx, dy) {
  if (dy < -SWIPE_Y && -dy > Math.abs(dx)) return 'up'
  if (dx > SWIPE_X) return 'right'
  if (dx < -SWIPE_X) return 'left'
  return null
}

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function SwipeDeck({
  cards,
  keyFor,
  renderCard,
  stamps,
  apiRef,
  onLeft,
  onRight,
  onUp,
  onDone,
  upMode = 'commit',
  classPrefix = '',
}) {
  const reduced = useMemo(() => prefersReduced(), [])
  const [idx, setIdx] = useState(0)
  const [exit, setExit] = useState(null) // { card, dir, dx, dy, rot } — the flying clone
  const exitTRef = useRef(null)
  const doneTRef = useRef(null)
  const cardRef = useRef(null) // the live top card element (drag transform target)
  const dragRef = useRef(null) // { id, x0, y0, dx, dy } during a pointer drag
  useEffect(
    () => () => {
      clearTimeout(exitTRef.current)
      clearTimeout(doneTRef.current)
    },
    []
  )

  // class name helper: generic sd-* always; consumer's legacy names mirrored
  const cls = (n) => 'sd-' + n + (classPrefix ? ' ' + classPrefix + '-' + n : '')

  const clearDragStyles = () => {
    const el = cardRef.current
    if (!el) return
    el.classList.remove('grabbed')
    el.style.transform = ''
    el.style.removeProperty('--like')
    el.style.removeProperty('--nope')
    el.style.removeProperty('--keep')
  }

  const commit = (dir, dx = 0, dy = 0) => {
    const card = cards[idx]
    if (!card) return
    // multi-touch corner: a button-commit mid-drag would advance the deck and
    // let the in-flight pointer's release land a stale-travel verdict on the
    // NEW top card — kill any live drag before this verdict takes effect
    dragRef.current = null
    clearDragStyles()
    // the ONE verdict callback per card — signals live with the consumer
    if (dir === 'left') onLeft && onLeft(card)
    else if (dir === 'right') onRight && onRight(card)
    else if (onUp) onUp(card)
    setExit({ card, dir, dx, dy, rot: dx * 0.05 })
    clearTimeout(exitTRef.current)
    exitTRef.current = setTimeout(() => setExit(null), reduced ? 220 : 400)
    const next = idx + 1
    setIdx(next)
    if (next >= cards.length) {
      clearTimeout(doneTRef.current)
      if (reduced) onDone && onDone()
      else doneTRef.current = setTimeout(() => onDone && onDone(), 420) // let the last card finish flying
    }
  }
  // 'peek' up: the callback fires but the card stays put (springs back) — no
  // exit clone, no advance, no done check. Opening a detail must not be a verdict.
  const peek = () => {
    const card = cards[idx]
    if (card && onUp) onUp(card)
  }
  const up = (dx = 0, dy = 0) => (upMode === 'peek' ? peek() : commit('up', dx, dy))

  // the button-fallback handoff: fresh closures every render (they capture the
  // live idx), written in an effect — never read or written during render
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = { left: () => commit('left'), right: () => commit('right'), up: () => up() }
  })

  // ===== pointer gestures (top card only; reduced motion = buttons only) =====
  // (clearDragStyles lives above commit — both need it)
  const onDown = (ev) => {
    if (dragRef.current || !cardRef.current) return
    dragRef.current = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, dy: 0 }
    cardRef.current.classList.add('grabbed')
    ev.currentTarget.setPointerCapture(ev.pointerId)
  }
  const onMove = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    d.dx = ev.clientX - d.x0
    d.dy = ev.clientY - d.y0
    const el = cardRef.current
    if (!el) return
    el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${d.dx * 0.05}deg)`
    // verdict stamps fade in with travel (consumer CSS reads these vars)
    el.style.setProperty('--like', String(Math.min(Math.max(d.dx / SWIPE_X, 0), 1)))
    el.style.setProperty('--nope', String(Math.min(Math.max(-d.dx / SWIPE_X, 0), 1)))
    el.style.setProperty('--keep', String(Math.min(Math.max(-d.dy / SWIPE_Y, 0), 1)))
  }
  const onUpPtr = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    dragRef.current = null // one verdict per gesture — nulled BEFORE the commit
    clearDragStyles()
    const v = gestureVerdict(d.dx, d.dy)
    if (v === 'up') up(d.dx, d.dy)
    else if (v) commit(v, d.dx, d.dy)
    // else: under threshold — the CSS transition springs the card back
  }
  const onCancel = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    dragRef.current = null
    clearDragStyles()
  }

  const visible = cards.slice(idx, idx + 3)

  return (
    <div className={cls('stack')}>
      {visible.map((c, i) => (
        <div
          key={keyFor(c)}
          ref={i === 0 ? cardRef : undefined}
          className={cls('card') + ' ' + (i === 0 ? cls('top') : i === 1 ? cls('under1') : cls('under2'))}
          onPointerDown={i === 0 && !reduced ? onDown : undefined}
          onPointerMove={i === 0 && !reduced ? onMove : undefined}
          onPointerUp={i === 0 && !reduced ? onUpPtr : undefined}
          onPointerCancel={i === 0 && !reduced ? onCancel : undefined}
        >
          {renderCard(c)}
          {i === 0 && !reduced && stamps}
        </div>
      ))}
      {exit && (
        <div
          className={cls('card') + ' ' + cls('exit') + ' ' + cls('exit-' + exit.dir)}
          style={{ '--dx': exit.dx + 'px', '--dy': exit.dy + 'px', '--rot': exit.rot + 'deg' }}
          aria-hidden
        >
          {renderCard(exit.card)}
        </div>
      )}
    </div>
  )
}
