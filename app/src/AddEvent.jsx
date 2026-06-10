// AddEvent — "+ Add event" subpage (Sprint C MVP, sanctioned by Josh night 1:
// "a very basic version" proving user-submitted events; the full social pipeline
// stays parked). One Editorial-clean screen → a real schema-v2 event object →
// App persists it (localStorage 'my-events-v1' via lib.saveMyEvents) and merges
// it through the SAME normalize() path as fetched data, so it surfaces in the
// feed, bubbles, search and calendar (lat/lng are null → no map pin). Provenance
// invariant: these events always wear the "Added by you" label — never
// confusable with sourced data. Footer exports my-events as JSON — the seed of
// the future submission pipeline (PLAN.md Sprint C).
import { useEffect, useRef, useState } from 'react'
import { BUBBLES, dayTs, Icon, MY_SOURCE } from './lib.js'
import { recordSignal } from './taste.js'
import './addevent.css'

// 12 category chips: the 11 real categories (canonical emoji/label/hue from
// BUBBLES) + an honest "Other" bucket (matches CATEGORY_HUES/EMOJI fallback)
const CATS = [
  ...BUBBLES.filter((b) => b.kind === 'cat').map((b) => ({ value: b.value, label: b.label, emoji: b.emoji, hue: b.hue })),
  { value: 'other', label: 'Other', emoji: '⭐', hue: 220 },
]

const pad = (n) => String(n).padStart(2, '0')
const isoDay = (ts) => {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

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

export default function AddEvent({ anchors, myEvents, onAdd, onClose }) {
  const [f, setF] = useState({
    title: '',
    date: '',
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
  const [done, setDone] = useState(false)
  const doneTRef = useRef(null)
  useEffect(() => () => clearTimeout(doneTRef.current), [])

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

  const submit = (ev) => {
    ev.preventDefault()
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
    recordSignal('add', { category: f.cat || 'other' })
    // full schema-v2 shape — identical fields to a fetched event, honest values
    onAdd({
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
    })
    setDone(true)
    doneTRef.current = setTimeout(onClose, 1400) // success beat, then back to Hot
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
        <h1 className="pg-head-title">Add event</h1>
      </header>
      <div className="pg-body">
        {done ? (
          <div className="ae-done" role="status">
            <div className="ae-done-emoji">🎉</div>
            <div className="ae-done-title">Added!</div>
            <div className="ae-done-sub">It's in your feed.</div>
          </div>
        ) : (
          <form className="ae-form" noValidate onSubmit={submit}>
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
              />
              {errors.title && <div className="ae-err">{errors.title}</div>}
            </div>
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
                />
                {errors.date && <div className="ae-err">{errors.date}</div>}
              </div>
              <div className="ae-field">
                <label className="ae-label" htmlFor="ae-time">
                  Time
                </label>
                <input id="ae-time" className="ae-input" type="time" value={f.time} onChange={set('time')} />
              </div>
            </div>
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
                placeholder="123 Bay St, Tampa"
                value={f.address}
                onChange={set('address')}
              />
            </div>
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
                  />
                </div>
                {errors.price && <div className="ae-err">{errors.price}</div>}
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
              />
              {errors.link && <div className="ae-err">{errors.link}</div>}
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
            <button className="ae-submit" type="submit">
              Add event
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
