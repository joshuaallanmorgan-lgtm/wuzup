// AddEvent — "+ Add event" subpage (Sprint C MVP, sanctioned by Josh night 1:
// "a very basic version" proving user-submitted events; the full social pipeline
// stays parked). One Editorial-clean screen → a real schema-v2 event object →
// the city-bound custom-event provider persists it and App merges its projection
// through the SAME normalize() path as fetched data, so it surfaces in the
// feed, bubbles, search and calendar (lat/lng are null → no map pin). Provenance
// invariant: these events always wear the "Added by you" label — never
// confusable with sourced data. Footer exports my-events as JSON — the seed of
// the future submission pipeline (PLAN.md Sprint C).
import { useEffect, useRef, useState } from 'react'
import { BUBBLES, CITY, dayIdOf, dayTs, Icon, MY_SOURCE } from './lib.js'
import { useNav } from './nav.jsx'
import { recordSignal } from './taste.js'
import './addevent.css'

// 12 category chips: the 11 real categories (canonical emoji/label/hue from
// BUBBLES) + an honest "Other" bucket (matches CATEGORY_HUES/EMOJI fallback)
const CATS = [
  ...BUBBLES.filter((b) => b.kind === 'cat').map((b) => ({ value: b.value, label: b.label, emoji: b.emoji, hue: b.hue })),
  { value: 'other', label: 'Other', emoji: '⭐', hue: 220 },
]

const isoDay = (ts) => dayIdOf(ts)
// URL shape if present: scheme optional (https:// assumed), dotted host required
function checkUrl(v) {
  const s = (v || '').trim()
  if (!s) return { ok: true, url: null }
  const withScheme = /^https?:\/\//i.test(s) ? s : 'https://' + s
  try {
    const u = new URL(withScheme)
    return u.hostname.includes('.') ? { ok: true, url: withScheme } : { ok: false, url: null }
  } catch {
    return { ok: false, url: null }
  }
}

export default function AddEvent({ anchors, myEvents, onAdd, presetTs = null, status = 'durable' }) {
  const { closePage: onClose } = useNav() // slide back out (O6)
  // When opened from a day screen, presetTs only pre-fills the date. Saving a
  // custom event adds it to My Events; planning always requires the separate,
  // visible day/daypart confirmation flow.
  const fromDay = typeof presetTs === 'number' && presetTs >= anchors.todayTs
  const [f, setF] = useState({
    title: '',
    date: fromDay ? isoDay(presetTs) : '',
    time: '',
    venue: '',
    address: '',
    cat: null,
    free: false,
    price: '',
    link: '',
    desc: '',
  })
  const [errors, setErrors] = useState({})
  const [done, setDone] = useState(null)
  const [submitError, setSubmitError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const doneTRef = useRef(null)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(doneTRef.current)
    }
  }, [])
  const catalogReady = status === 'durable' || status === 'session-only'
  const scheduleClose = () => {
    if (!mountedRef.current) return
    clearTimeout(doneTRef.current)
    doneTRef.current = setTimeout(() => {
      if (mountedRef.current) onClose()
    }, 1400)
  }

  // field setter: accepts an input event OR a raw value; touching a field clears its error
  const set = (k) => (ev) => {
    const v = ev && ev.target ? ev.target.value : ev
    setF((p) => ({ ...p, [k]: v }))
    setErrors((p) => {
      if (!(k in p)) return p
      const n = { ...p }
      delete n[k]
      return n
    })
  }

  const submit = async (ev) => {
    ev.preventDefault()
    if (submittingRef.current) return
    const errs = {}
    const title = f.title.trim()
    if (!title) errs.title = 'Give it a title.'
    if (!f.date) errs.date = 'Pick a date.'
    else if ((dayTs(f.date) ?? 0) < anchors.todayTs) errs.date = "That date's already passed."
    const u = checkUrl(f.link)
    if (!u.ok) errs.link = "That doesn't look like a link."
    const priceNum = f.price === '' ? null : Number(f.price)
    if (!f.free && priceNum != null && !(priceNum >= 0)) errs.price = 'Price in dollars, 0 or more.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    // taste seam: creating an event is a strong category signal (+2). Recorded
    // HERE, not in App.addMine — an undo-restore must not double-count.
    // full schema-v2 shape — identical fields to a fetched event, honest values
    const raw = {
      title,
      start: f.time ? f.date + 'T' + f.time + ':00' : f.date, // local floating, like the finder's output
      end: null,
      venue: f.venue.trim() || null,
      address: f.address.trim() || null,
      price: f.free ? 0 : priceNum,
      currency: 'USD',
      isFree: f.free === true,
      lat: null,
      lng: null,
      url: u.url,
      image: null,
      description: f.desc.trim() || null,
      source: MY_SOURCE,
      sources: [MY_SOURCE],
      buzz: 1,
      hotScore: null, // never competes with sourced hot-ness
      tags: f.free ? ['added-by-you', 'free'] : ['added-by-you'],
      category: f.cat || 'other',
      sponsored: false,
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const added = await onAdd(raw)
      if (added?.changed !== true) {
        if (!mountedRef.current) return
        if (typeof added?.code === 'string' && added.code.startsWith('duplicate-')) {
          setDone(added)
          scheduleClose()
          return
        }
        setSubmitError(
          added?.code === 'event-cap-reached'
            ? 'My Events is full. Remove one before adding another.'
            : "Couldn't add that event. Your existing events are unchanged.",
        )
        return
      }
      recordSignal('add', { category: f.cat || 'other' })
      if (!mountedRef.current) return
      setDone(added)
      scheduleClose()
    } catch {
      if (mountedRef.current) {
        setSubmitError("Couldn't add that event. Your existing events are unchanged.")
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  // the seed of the future submission pipeline: download my-events as raw JSON
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(myEvents, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'my-events.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Add Your Own</h1>
      </header>
      <div className="pg-body">
        {!catalogReady ? (
          <div
            className="empty"
            role={status === 'initializing' ? 'status' : 'alert'}
            aria-live={status === 'initializing' ? 'polite' : 'assertive'}
          >
            <div className="ae-done-title">
              {status === 'initializing' ? 'Loading your events…' : 'Adding is unavailable'}
            </div>
            <div className="ae-done-sub">
              {status === 'initializing'
                ? 'The add form will be ready when your saved events finish loading.'
                : status === 'corrupt'
                  ? "Your saved events couldn't be read safely, so the add form is paused."
                  : "Your saved events couldn't be loaded, so the add form is paused."}
            </div>
          </div>
        ) : done ? (
          <div className="ae-done" role="status">
            <div className="ae-done-emoji">🎉</div>
            <div className="ae-done-title">{done?.changed === false ? 'Already added' : 'Added!'}</div>
            <div className="ae-done-sub">
              {done?.changed === false
                ? "It's already in My Events and your feed."
                : done.persisted === false
                  ? "It's here for this visit, but your browser couldn't save it."
                  : "It's saved in My Events and your feed."}
            </div>
          </div>
        ) : (
          <form className="ae-form" noValidate onSubmit={submit} aria-busy={submitting}>
            {/* 3.76c: grouped What / When / Where / Details for a calmer form (DRAFT) */}
            <div className="ae-group">What’s the plan?</div>
            <div className="ae-field">
              <label className="ae-label" htmlFor="ae-title">
                Title *
              </label>
              <input
                id="ae-title"
                className="ae-input"
                type="text"
                maxLength={100}
                placeholder="Backyard vinyl night"
                value={f.title}
                onChange={set('title')}
                aria-invalid={!!errors.title}
                aria-describedby={errors.title ? 'ae-title-err' : undefined}
              />
              {errors.title && <div className="ae-err" id="ae-title-err">{errors.title}</div>}
            </div>
            <div className="ae-group">When</div>
            <div className="ae-2col">
              <div className="ae-field">
                <label className="ae-label" htmlFor="ae-date">
                  Date *
                </label>
                <input
                  id="ae-date"
                  className="ae-input"
                  type="date"
                  min={isoDay(anchors.todayTs)}
                  value={f.date}
                  onChange={set('date')}
                  aria-invalid={!!errors.date}
                  aria-describedby={errors.date ? 'ae-date-err' : undefined}
                />
                {errors.date && <div className="ae-err" id="ae-date-err">{errors.date}</div>}
              </div>
              <div className="ae-field">
                <label className="ae-label" htmlFor="ae-time">
                  Time
                </label>
                <input id="ae-time" className="ae-input" type="time" value={f.time} onChange={set('time')} />
              </div>
            </div>
            <div className="ae-group">Where</div>
            <div className="ae-field">
              <label className="ae-label" htmlFor="ae-venue">
                Venue name
              </label>
              <input
                id="ae-venue"
                className="ae-input"
                type="text"
                maxLength={120}
                placeholder="The Attic, Armature Works…"
                value={f.venue}
                onChange={set('venue')}
              />
            </div>
            <div className="ae-field">
              <label className="ae-label" htmlFor="ae-address">
                Address
              </label>
              <input
                id="ae-address"
                className="ae-input"
                type="text"
                maxLength={160}
                placeholder={`123 Bay St, ${CITY.shortName}`}
                value={f.address}
                onChange={set('address')}
              />
            </div>
            <div className="ae-group">Details</div>
            <div className="ae-field">
              <div className="ae-label">Category</div>
              <div className="ae-cats" role="radiogroup" aria-label="Category">
                {CATS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={f.cat === c.value}
                    className={'ae-cat' + (f.cat === c.value ? ' on' : '')}
                    style={{ '--bh': c.hue }}
                    onClick={() => set('cat')(f.cat === c.value ? null : c.value)}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ae-field ae-free">
              <div>
                <div className="ae-label">Free event?</div>
                <div className="ae-hint">{f.free ? 'No tickets — just turn up.' : 'Toggle on if there’s no cover.'}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={f.free}
                aria-label="Free event"
                className={'ae-switch' + (f.free ? ' on' : '')}
                onClick={() => set('free')(!f.free)}
              >
                <span className="ae-knob" />
              </button>
            </div>
            {!f.free && (
              <div className="ae-field">
                <label className="ae-label" htmlFor="ae-price">
                  Price
                </label>
                <div className="ae-price">
                  <span className="ae-price-sign">$</span>
                  <input
                    id="ae-price"
                    className="ae-input"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0"
                    value={f.price}
                    onChange={set('price')}
                    aria-invalid={!!errors.price}
                    aria-describedby={errors.price ? 'ae-price-err' : undefined}
                  />
                </div>
                {errors.price && <div className="ae-err" id="ae-price-err">{errors.price}</div>}
              </div>
            )}
            <div className="ae-field">
              <label className="ae-label" htmlFor="ae-link">
                Link
              </label>
              <input
                id="ae-link"
                className="ae-input"
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={f.link}
                onChange={set('link')}
                aria-invalid={!!errors.link}
                aria-describedby={errors.link ? 'ae-link-err' : undefined}
              />
              {errors.link && <div className="ae-err" id="ae-link-err">{errors.link}</div>}
            </div>
            <div className="ae-field">
              <label className="ae-label" htmlFor="ae-desc">
                Description
              </label>
              <textarea
                id="ae-desc"
                className="ae-input"
                maxLength={250}
                rows={4}
                placeholder="What should people know?"
                value={f.desc}
                onChange={set('desc')}
              />
              <div className="ae-count">{f.desc.length}/250</div>
            </div>
            {submitError && <div className="ae-err" role="alert">{submitError}</div>}
            <button className="ae-submit" type="submit" disabled={submitting}>
              {submitting ? 'Addingâ€¦' : 'Add event'}
            </button>
            <div className="ae-foot">
              {myEvents.length > 0 && (
                <button type="button" className="ae-export" onClick={exportJson}>
                  Export my events (JSON){myEvents.length > 1 ? ` · ${myEvents.length}` : ''}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
