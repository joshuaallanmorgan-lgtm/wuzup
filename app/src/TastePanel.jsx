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

// the unified when-preference reflected back (DRAFT — matches Profile's lines)
const WHEN_LABEL = {
  weeknights: '🌙 Weeknights are your nights',
  weekends: '🎉 Weekends are your nights',
  whenever: '🤷 Out whenever the mood hits',
}

// the three explicit states, in order; the tap cycles boost → neutral → mute
const PREF_LABEL = { boost: 'More', neutral: 'Normal', mute: 'Less' }
const PREF_NEXT = { neutral: 'boost', boost: 'mute', mute: 'neutral' }

export default function TastePanel({ from, primer }) {
  const { closePage, openSettings } = useNav()
  const back = from === 'settings' ? openSettings : closePage
  const taste = useTaste()
  // primerWhen is handed in (primer-v1 is a separate store taste.js doesn't
  // import) so whenPreference's one resolver decides precedence — V1 unify.
  const sum = tasteSummary(taste, { k: 5, primerWhen: primer?.done ? primer.when : null })

  const learning = sum.confidence < 0.4
  const headline =
    sum.n === 0
      ? "Your feed is wide open"
      : learning
        ? 'Still getting to know you'
        : sum.leans.length
          ? sum.leans.slice(0, 3).map((l) => categoryById[l.id]?.label).filter(Boolean).join(' · ')
          : 'Your feed, lightly tuned'
  const trustLine =
    sum.n === 0
      ? 'Nothing learned yet — every ♥, open and bubble teaches this, all on your phone.'
      : learning
        ? `${sum.n} tap${sum.n === 1 ? '' : 's'} in so far. It sharpens the more you use the app.`
        : `Tuned by ${sum.n} taps on this phone. No account, no cloud — and here's exactly what it learned.`

  return (
    <div className="pg tp">
      <header className="pg-head">
        <button className="pg-back" onClick={back} aria-label="Back">
          <Icon.chevron />
        </button>
        {/* S1-ST2: titled "Taste profile" to match sheet-b; the "why" is carried
            by the content below (headline + the never-hide promise + the bars). */}
        <h1 className="pg-head-title">Taste profile</h1>
      </header>

      <div className="tp-body">
        {/* ===== V2: the honest read-out ===== */}
        <section className="tp-sec">
          <div className="tp-headline">{headline}</div>
          <div className="tp-trust">{trustLine}</div>

          {/* the standing promise — a UI constant, not derived. The whole point. */}
          <div className="tp-promise">
            <span aria-hidden>⚖️</span> Taste only nudges the ORDER of your feed. It never hides anything —
            everything still shows up, just sorted toward what you seem to like.
          </div>

          {sum.leans.length > 0 && (
            <div className="tp-leans" role="list" aria-label="What your feed leans toward">
              <div className="tp-over">Leaning toward</div>
              {sum.leans.map((l) => {
                const c = categoryById[l.id]
                if (!c) return null
                return (
                  <div className="tp-lean" role="listitem" key={l.id}>
                    <span className="tp-lean-name">
                      <span aria-hidden>{c.emoji}</span> {c.label}
                    </span>
                    <span className="tp-bar" aria-hidden>
                      {/* relative weight: a fraction of the strongest lean —
                          honest "more than / less than each other", never a raw score */}
                      <span
                        className="tp-bar-fill"
                        style={{ width: Math.max(6, Math.round(l.weight * 100)) + '%', '--ph': c.hue }}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="tp-facts">
            {sum.freeLeaning && (
              <div className="tp-fact">
                <span aria-hidden>🆓</span> You lean toward free events — they get a small bump.
              </div>
            )}
            {sum.when && <div className="tp-fact">{WHEN_LABEL[sum.when]}</div>}
            {!sum.railReady && sum.n > 0 && (
              <div className="tp-fact tp-fact-dim">
                {/* V1b honesty: seeds tilt ordering, but "Your kind of night" waits for real taps */}
                Your “kind of night” rail shows up once you’ve tapped around a bit — {sum.organicN}/{railTarget} so far.
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
