/* eslint-disable react-refresh/only-export-components --
   gestureVerdict (the pure threshold decision) is re-exported from this file
   so every consumer keeps ONE import seam for the commit math (same precedent
   as CalibrationDeck's dealDeck — dev-time Fast Refresh granularity only).
   WS2: the implementation moved to deckgesture.js (pure, Node-importable)
   so smoke.mjs sims flicks/drags/springs without JSX. */
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
//                   (0..1 with drag travel). WS2 #2: ALSO rendered inside the
//                   flying exit clone with the committed verdict's var snapped
//                   to 1, so the stamp rides the flight (gesture AND button
//                   commits). Drag-driven stamps stay detached under reduced
//                   motion (no gestures there), but the exit-clone stamp shows
//                   statically during the crossfade — verdict feedback those
//                   users never had.
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
// GESTURE MATH (WS2 velocity upgrade; distance behavior verified-unchanged):
// SWIPE_X=80px horizontal travel commits left/right; SWIPE_Y=90px upward
// travel (and more up than sideways) commits up — OR a hard flick (sustained
// release velocity ≥ FLICK_V with direction-agreeing travel) commits under
// the distance threshold, so a confident flick never snaps back. Under both
// thresholds = a rAF spring settles the card home (small overshoot, seeded
// with the release velocity — deckgesture.js owns the constants + the pure
// step). Exit flights inherit release momentum (flightMs). Reduced motion:
// pointer handlers are never attached — buttons only, crossfade exits.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ROT_FACTOR,
  SPRING,
  SWIPE_X,
  SWIPE_Y,
  flightMs,
  gestureVerdict,
  grabRotation,
  releaseVelocity,
  springStep,
} from './deckgesture.js'
import './swipedeck.css'

// the pure threshold decision stays exported HERE too — consumers and older
// call sites keep one seam; the implementation (Node-sim-able) lives in
// deckgesture.js. 2-arg calls behave exactly like the verified original.
export { gestureVerdict }

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
  const [exit, setExit] = useState(null) // { card, dir, dx, dy, rot, ms, flyX, flyY } — the flying clone
  const exitTRef = useRef(null)
  const doneTRef = useRef(null)
  const cardRef = useRef(null) // the live top card element (drag transform target)
  const dragRef = useRef(null) // { id, x0, y0, dx, dy, samples } during a pointer drag
  const springRef = useRef(null) // { raf, x, y } while the snap-back spring drives the top card
  useEffect(
    () => () => {
      clearTimeout(exitTRef.current)
      clearTimeout(doneTRef.current)
      if (springRef.current) cancelAnimationFrame(springRef.current.raf)
    },
    []
  )

  // class name helper: generic sd-* always; consumer's legacy names mirrored
  const cls = (n) => 'sd-' + n + (classPrefix ? ' ' + classPrefix + '-' + n : '')

  const cancelSpring = () => {
    if (!springRef.current) return
    cancelAnimationFrame(springRef.current.raf)
    springRef.current = null
  }
  const clearDragStyles = () => {
    cancelSpring()
    const el = cardRef.current
    if (!el) return
    el.classList.remove('grabbed', 'settling')
    el.style.transform = ''
    el.style.removeProperty('transform-origin')
    el.style.removeProperty('will-change') // jank guard is gesture-scoped, never permanent (WS2 #4)
    el.style.removeProperty('--like')
    el.style.removeProperty('--nope')
    el.style.removeProperty('--keep')
  }
  // stamp opacities from live travel — the drag AND the spring share this map
  const setTravelVars = (el, dx, dy) => {
    el.style.setProperty('--like', String(Math.min(Math.max(dx / SWIPE_X, 0), 1)))
    el.style.setProperty('--nope', String(Math.min(Math.max(-dx / SWIPE_X, 0), 1)))
    el.style.setProperty('--keep', String(Math.min(Math.max(-dy / SWIPE_Y, 0), 1)))
  }

  const commit = (dir, { dx = 0, dy = 0, speed = 0, rotF = ROT_FACTOR, origin } = {}) => {
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
    // WS2 #3: the flight inherits release momentum — a hard flick flies out
    // faster (flightMs clamps [240,400]), and the end pose continues the
    // release line (px-clamped so a wild drag can't overshoot the surface).
    // Button commits (speed 0, no travel) keep the shipped 400ms + slight lift.
    const ms = reduced ? 220 : flightMs(speed)
    const flyX = Math.max(-140, Math.min(140, dx * 1.4))
    const flyY = Math.max(-160, Math.min(160, dy * 1.6 - 24))
    // WS2 #4: the exit clone keeps the drag's grab-point pivot + clamped
    // rotation so the live-card → clone handoff is pose-exact (button
    // commits: no travel, no origin — the defaults are a no-op)
    setExit({ card, dir, dx, dy, rot: grabRotation(dx, rotF), ms, flyX, flyY, origin })
    clearTimeout(exitTRef.current)
    exitTRef.current = setTimeout(() => setExit(null), ms + 40)
    const next = idx + 1
    setIdx(next)
    if (next >= cards.length) {
      clearTimeout(doneTRef.current)
      if (reduced) onDone && onDone()
      else doneTRef.current = setTimeout(() => onDone && onDone(), 420) // let the last card finish flying (flights clamp ≤ 400)
    }
  }
  // 'peek' up: the callback fires but the card stays put (springs back) — no
  // exit clone, no advance, no done check. Opening a detail must not be a verdict.
  const peek = () => {
    const card = cards[idx]
    if (card && onUp) onUp(card)
  }
  const up = (opts) => (upMode === 'peek' ? peek() : commit('up', opts))

  // WS2 #3: the under-threshold settle — a real unit-mass spring driven by
  // rAF (deckgesture.SPRING, ζ≈0.73: one small overshoot, ~0.5s), seeded with
  // the release velocity, replacing the old 200ms ease-out tween. The stamps
  // fade back with the live offset; springRef carries {raf,x,y} so a
  // mid-settle grab (onDown) can catch the card exactly where it is.
  const springBack = (d, vx = 0, vy = 0) => {
    const el = cardRef.current
    if (!el) return
    cancelSpring()
    el.classList.remove('grabbed')
    el.classList.add('settling') // transition:none while the spring drives the transform
    let x = d.dx
    let y = d.dy
    let velX = vx * 1000 // px/ms → px/s
    let velY = vy * 1000
    let last = performance.now()
    const tick = (now) => {
      const dt = now - last
      last = now
      const sx = springStep(x, velX, dt)
      x = sx.x
      velX = sx.v
      const sy = springStep(y, velY, dt)
      y = sy.x
      velY = sy.v
      const done =
        Math.abs(x) < SPRING.restDist &&
        Math.abs(y) < SPRING.restDist &&
        Math.abs(velX) < SPRING.restSpeed &&
        Math.abs(velY) < SPRING.restSpeed
      if (done) {
        springRef.current = null
        clearDragStyles()
        return
      }
      el.style.transform = `translate(${x}px, ${y}px) rotate(${grabRotation(x, d.rotF)}deg)`
      setTravelVars(el, x, y)
      springRef.current = { raf: requestAnimationFrame(tick), x, y }
    }
    springRef.current = { raf: requestAnimationFrame(tick), x: d.dx, y: d.dy }
  }

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
    // catch a springing card where it IS: adopt the spring's live offset into
    // the new drag's origin so the card never teleports under the finger
    const s = springRef.current
    const ox = s ? s.x : 0
    const oy = s ? s.y : 0
    cancelSpring()
    const el = cardRef.current
    // WS2 #4: the card pivots around the GRAB POINT — a top-half grab rotates
    // WITH the drag, a bottom-half grab against it (real cards swing around
    // where you hold them); rotation is clamped in grabRotation. The
    // will-change hint is gesture-scoped: set here, removed in
    // clearDragStyles — never a permanent compositing tax on the stack.
    const r = el.getBoundingClientRect()
    const rotF = ev.clientY < r.top + r.height / 2 ? ROT_FACTOR : -ROT_FACTOR
    const origin = `${Math.round(ev.clientX - r.left)}px ${Math.round(ev.clientY - r.top)}px`
    dragRef.current = {
      id: ev.pointerId,
      x0: ev.clientX - ox,
      y0: ev.clientY - oy,
      dx: ox,
      dy: oy,
      rotF,
      origin,
      // trailing pointer history for the release-velocity read (WS2 #3)
      samples: [{ t: ev.timeStamp, x: ev.clientX, y: ev.clientY }],
    }
    el.classList.remove('settling')
    el.classList.add('grabbed')
    el.style.transformOrigin = origin
    el.style.willChange = 'transform'
    if (ox || oy) el.style.transform = `translate(${ox}px, ${oy}px) rotate(${grabRotation(ox, rotF)}deg)`
    ev.currentTarget.setPointerCapture(ev.pointerId)
  }
  const onMove = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    d.dx = ev.clientX - d.x0
    d.dy = ev.clientY - d.y0
    d.samples.push({ t: ev.timeStamp, x: ev.clientX, y: ev.clientY })
    if (d.samples.length > 12) d.samples.splice(0, d.samples.length - 12) // ≥ SAMPLE_WINDOW of history at 120Hz
    const el = cardRef.current
    if (!el) return
    el.style.transform = `translate(${d.dx}px, ${d.dy}px) rotate(${grabRotation(d.dx, d.rotF)}deg)`
    // verdict stamps fade in with travel (consumer CSS reads these vars)
    setTravelVars(el, d.dx, d.dy)
  }
  const onUpPtr = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    dragRef.current = null // one verdict per gesture — nulled BEFORE the commit
    d.samples.push({ t: ev.timeStamp, x: ev.clientX, y: ev.clientY }) // the release point closes the window
    const { vx, vy } = releaseVelocity(d.samples)
    const v = gestureVerdict(d.dx, d.dy, vx, vy)
    const opts = { dx: d.dx, dy: d.dy, speed: Math.hypot(vx, vy), rotF: d.rotF, origin: d.origin }
    if (v === 'up') {
      if (upMode === 'peek') {
        peek() // opening a detail must not cost the card — spring it home
        springBack(d, vx, vy)
      } else commit('up', opts)
    } else if (v) commit(v, opts)
    else springBack(d, vx, vy) // under threshold — the spring settles it back
  }
  const onCancel = (ev) => {
    const d = dragRef.current
    if (!d || d.id !== ev.pointerId) return
    dragRef.current = null
    springBack(d) // a stolen pointer settles home too — never a hard snap
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
          style={{
            transformOrigin: exit.origin, /* grab-point pivot rides the handoff (WS2 #4; undefined = center for button commits) */
            '--dx': exit.dx + 'px',
            '--dy': exit.dy + 'px',
            '--rot': exit.rot + 'deg',
            /* WS2 #3: momentum-inherited flight — duration scales with release
               speed, end pose continues the release line (swipedeck.css reads
               these; reduced motion overrides the whole animation anyway) */
            '--fly-ms': exit.ms + 'ms',
            '--flyx': exit.flyX + 'px',
            '--flyy': exit.flyY + 'px',
            /* WS2 #2: the committed verdict's stamp rides the exit at full
               opacity — the consumer's stamp CSS reads these same vars, so
               snapping the matching one to 1 lights it with zero consumer
               changes. Covers BUTTON commits too (they never showed a stamp),
               and under reduced motion the crossfading clone now carries the
               verdict statically — those users previously got zero feedback. */
            '--like': exit.dir === 'right' ? 1 : 0,
            '--nope': exit.dir === 'left' ? 1 : 0,
            '--keep': exit.dir === 'up' ? 1 : 0,
          }}
          aria-hidden
        >
          {renderCard(exit.card)}
          {stamps}
        </div>
      )}
    </div>
  )
}
