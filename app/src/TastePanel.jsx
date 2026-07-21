// TastePanel — Sprint V2 + V3: "WHY YOUR FEED LOOKS LIKE THIS" + per-category
// mute/boost. The inspectable promise, made user-facing and calm.
//
//   V2 (read-only transparency): in plain language + honest numbers, what the
//     LOCAL profile currently leans toward — top categories with their RELATIVE
//     weight (proportional bars), the free lean, the when-preference,
//     confidence ("tuned by N taps"), and the standing line: taste only nudges
//     ORDER, it never hides anything. Built entirely on tasteSummary() — a view
//     over the SAME stored numbers the engine ranks with, never a second
//     opinion. No new store.
//
//   V3 (explicit control): each of the 11 real registry categories ('other' is
//     the fallback bucket, excluded) can be set
//     BOOST / NEUTRAL / MUTE. This is EXPLICIT ordering intent that COMPOSES
//     with the learned nudge — boost adds a bounded ordering bump, mute
//     subtracts a bounded amount (floored at 0). It NEVER FILTERS: a muted
//     category's events still render (orderDay is count-preserving), just
//     lower. Persisted in 'taste-v1'.prefs through setCategoryPref — one store.
//
// Mounted in App's .subpage slot ({type:'taste', from}); reached from Settings.
// Reads live via useTaste() so a chip tap reflows the bars immediately.
//
// ALL COPY IS DRAFT for Charles (inventory in the sprint report).
import { CATEGORIES, categoryById } from './categories.js'
import { Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { categoryPref, railTarget, setCategoryPref, tasteSummary, useTaste } from './taste.js'
import './tastepanel.css'

// the grid = the whole registry minus the 'other' fallback bucket (not a taste)
const GRID_CATS = CATEGORIES.filter((c) => c.id !== 'other')

// the three explicit states, in order; the tap cycles boost → neutral → mute
const PREF_LABEL = { boost: 'More', neutral: 'Normal', mute: 'Less' }
const PREF_NEXT = { neutral: 'boost', boost: 'mute', mute: 'neutral' }

export default function TastePanel({ from }) {
  const { closePage, openSettings } = useNav()
  const back = from === 'settings' ? openSettings : closePage
  const taste = useTaste()
  const sum = tasteSummary(taste, { k: 5 })

  const evidenceN = sum.organicN
  const seeded = sum.n > evidenceN
  const learning = evidenceN < railTarget
  const headline =
    evidenceN === 0
      ? seeded ? 'Starting from your setup' : 'Your feed is wide open'
      : learning
        ? 'Still getting to know you'
        : sum.leans.length
          ? sum.leans.slice(0, 3).map((l) => categoryById[l.id]?.label).filter(Boolean).join(' · ')
          : 'Your feed, lightly tuned'
  const trustLine =
    evidenceN === 0
      ? seeded
        ? 'Your setup gives ordering a light starting point. No deliberate activity signals yet.'
        : 'Nothing learned yet. Deliberate saves, opens and deck ratings can adjust ordering on this phone.'
      : learning
        ? `${evidenceN} deliberate signal${evidenceN === 1 ? '' : 's'} so far on this phone.`
        : `Tuned by ${evidenceN} deliberate signals on this phone. No account or cloud profile.`

  return (
    <div className="pg tp">
      <header className="pg-head">
        <button className="pg-back" onClick={back} aria-label="Back">
          <Icon.chevron />
        </button>
        {/* S1-ST2: titled "Taste profile" to match sheet-b; the "why" is carried
            by the content below (headline + the never-hide promise + the bars). */}
        <h1 className="pg-head-title">Taste Profile</h1>
      </header>

      <div className="tp-body">
        {/* ===== V2: the honest read-out ===== */}
        <section className="tp-sec">
          <div className="tp-headline">{headline}</div>
          <div className="tp-trust">{trustLine}</div>
          {/* P1: the standing never-hide promise, re-homed from its callout widget
              into a second trust subheader. This honesty line is load-bearing —
              keep "reorders the order, never hides anything". */}
          <div className="tp-trust">
            Taste only reorders your feed — it never hides anything. Everything still shows up, just sorted toward what you seem to like.
          </div>

          {/* P2: the "Leaning toward" relative-weight bars were retired (Josh's
              taste-sweep). sum.leans still rides the headline; k:5 stays in tasteSummary. */}

          <div className="tp-facts">
            {sum.freeLeaning && (
              <div className="tp-fact">
                <Icon.tag className="meta-ic" aria-hidden /> You lean toward free events — they get a small bump.
              </div>
            )}
            {!sum.railReady && evidenceN > 0 && (
              <div className="tp-fact tp-fact-dim">
                Personalized ordering strengthens after more deliberate choices — {evidenceN}/{railTarget} so far.
              </div>
            )}
          </div>
        </section>

        {/* ===== V3: explicit per-category control ===== */}
        <section className="tp-sec">
          <div className="tp-over">Tune it yourself</div>
          <p className="tp-ctl-note">
            Want more or less of something, no matter what your taps say? Set it here. This only changes
            ORDER — “Less” pushes a category down, never out. Tap to cycle Normal → More → Less.
          </p>
          <div className="tp-ctl-grid">
            {GRID_CATS.map((c) => {
              const pref = categoryPref(c.id, taste)
              return (
                <button
                  key={c.id}
                  className={'tp-ctl tp-ctl-' + pref}
                  style={{ '--ph': c.hue }}
                  onClick={() => setCategoryPref(c.id, PREF_NEXT[pref])}
                  aria-label={`${c.label}: currently ${PREF_LABEL[pref]} — tap to change`}
                >
                  <span className="tp-ctl-cat">
                    <span aria-hidden>{c.emoji}</span> {c.label}
                  </span>
                  <span className={'tp-ctl-state tp-ctl-state-' + pref}>{PREF_LABEL[pref]}</span>
                </button>
              )
            })}
          </div>
          <div className="tp-ctl-foot">
            All of this lives on your phone. {sum.boost.length + sum.mute.length > 0
              ? `${sum.boost.length} boosted, ${sum.mute.length} dialed down.`
              : 'Nothing forced either way yet — your taps lead.'}
          </div>
        </section>
      </div>
    </div>
  )
}
