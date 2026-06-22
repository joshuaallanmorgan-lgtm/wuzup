// ProfileView — the Profile tab (PROFILE_GRIND pixel-match to ref-profile.png).
// Canonical order: "Profile" title → a WHITE identity card (avatar · name · city ·
// edit pencil + the stats trio inside it) → a 6-row menu with description lines →
// a "Recently saved" preview → nav. The old colored identity block (Batch 4) is
// reverted to white per the ref. Settings moved off the top-right gear into its
// menu row; an edit pencil on the card now triggers the inline name edit.
//
// The display name lives ONLY on this device ('profile-name-v1') and defaults to
// an "Add your name" prompt — never a fabricated name (the ref's sample name and
// stat counts are mock; we show real counts only). The city is CITY.name.
// Path-safety: every row still CALLS its existing opener (openMyPlans/openMySaves/
// openTaste()/openInterests('profile')/openSettings) — only labels, descriptions,
// one new row, the pencil and structure changed. DRAFT copy — ⚑ Charles.
import { useMemo, useState } from 'react'
import { CITY, keyOf } from './lib.js'
import { useNav } from './nav.jsx'
import { lsGet, lsSet } from './storage.js'
import { useSaves, useBeenThere, shelfItems } from './saves.js'
import { loadDayPlans, loadDayHistory, didDays, dayEntryFor } from './dayplan.js'
import { GemRow } from './cards.jsx'
import './profile.css'

const NAME_KEY = 'profile-name-v1'

// calm mono stroke glyphs (currentColor) for the avatar + the menu rows
const S = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }
const PersonIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="9" r="3.4" /><path d="M5.5 19.5c1-3.3 3.6-5 6.5-5s5.5 1.7 6.5 5" /></svg>)
const PencilIc = () => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>)
const PlansIc = () => (<svg {...S} aria-hidden><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 3v4M16 3v4" /></svg>)
const BookmarkIc = () => (<svg {...S} aria-hidden><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" /></svg>)
const HeartIc = () => (<svg {...S} aria-hidden><path d="M12 20s-7-4.6-7-9.6A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 3.4c0 5-7 9.6-7 9.6Z" /></svg>)
const SparkleIc = () => (<svg {...S} aria-hidden><path d="M12 3l1.7 5 5 1.2-5 1.2L12 16l-1.7-5.6-5-1.2 5-1.2L12 3Z" /></svg>)
const CogIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="12" r="3.3" /><path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7 17 17M7 7 5.3 5.3" /></svg>)
const HelpIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.3 9.3a2.8 2.8 0 0 1 5.3 1c0 1.9-2.6 2.1-2.6 3.7" /><path d="M12 17.4h.01" /></svg>)
const Chev = () => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>)

export default function ProfileView({ events, anchors }) {
  const { openSettings, openTaste, openInterests, openMyPlans, openMySaves, openDetail, page } = useNav()
  const [name, setName] = useState(() => lsGet(NAME_KEY) || '')
  const [editing, setEditing] = useState(false)

  // S1-P3: honest lifetime stats from the REAL stores — never hardcoded. Saves +
  // days-out are reactive (hooks); plans reads the non-reactive day store, so it
  // recomputes on mount and whenever a subpage closes back to Profile (page flip).
  const { list: savedList } = useSaves()
  const been = useBeenThere()
  const planCount = useMemo(() => {
    void page
    const map = loadDayPlans(anchors)
    const days = new Set()
    for (const k of Object.keys(map)) {
      const e = dayEntryFor(map[k])
      if (e && (e.slots.day || e.slots.night)) days.add(k)
    }
    for (const h of loadDayHistory()) if (h?.slots && (h.slots.day || h.slots.night)) days.add(String(h.dayTs))
    return days.size
  }, [anchors, page])
  const daysOut = didDays(been).size
  // labels stay plural (matches the ref): Plans · Saved · Days out
  const stats = [
    { k: 'plans', n: planCount, lab: 'Plans' },
    { k: 'saves', n: savedList.length, lab: 'Saved' },
    { k: 'days', n: daysOut, lab: 'Days out' },
  ]

  // P7: a "Recently saved" preview — the first 2 of the live saved shelf (upcoming
  // first, past >7d dropped; live-from-dataset, snapshot fallback). Real data only;
  // the whole section hides when nothing is saved (never a barren placeholder).
  const recentSaves = useMemo(
    () => shelfItems(savedList, Array.isArray(events) ? events : [], anchors).slice(0, 2),
    [savedList, events, anchors]
  )

  const save = (v) => {
    const t = (v || '').trim().slice(0, 40)
    setName(t)
    lsSet(NAME_KEY, t)
  }
  const initial = name ? name.trim()[0].toUpperCase() : ''

  // each row CALLS an existing opener (path-safety). My likes → Taste profile via
  // openTaste() with NO 'settings' arg (closes back to the Profile tab); the new
  // Customize interests row → openInterests('profile') (the literal-string guard
  // treats 'profile' as not-settings → back to tab). Help & feedback = a normal
  // row with a placeholder destination (stubbed feature — PROFILE_GRIND §4).
  const rows = [
    { id: 'plans', Ic: PlansIc, label: 'My Plans', desc: 'Your day plans and upcoming itineraries', onClick: openMyPlans },
    { id: 'saves', Ic: BookmarkIc, label: 'My Saves', desc: 'Spots, events, and guides you saved', onClick: openMySaves },
    { id: 'taste', Ic: HeartIc, label: 'Taste profile', desc: 'Tell us what you like and improve your picks', onClick: () => openTaste() },
    { id: 'interests', Ic: SparkleIc, label: 'Customize interests', desc: 'Choose topics you love and get better recs', onClick: () => openInterests('profile') },
    { id: 'settings', Ic: CogIc, label: 'Settings & preferences', desc: 'Account, notifications, privacy, and more', onClick: openSettings },
    { id: 'help', Ic: HelpIc, label: 'Help & feedback', desc: 'Get help or share your thoughts', onClick: () => {} },
  ]

  return (
    <div className="pf-scroll">
      <header className="pf-head">
        {/* P1: the page title — big bold ink, mirrors the app's heading family */}
        <h1 className="pf-title">Profile</h1>

        {/* P2/P3/P4: the WHITE identity card — avatar · editable name · city · an
            edit pencil — with the honest stats trio inside the same card. */}
        <section className="pf-id-card">
          <div className="pf-name-block">
            <div className="pf-avatar">{initial || <PersonIc />}</div>
            <div className="pf-id-main">
              {editing ? (
                <input
                  className="pf-name-input"
                  autoFocus
                  defaultValue={name}
                  placeholder="Your name"
                  maxLength={40}
                  aria-label="Your display name"
                  onBlur={(e) => {
                    save(e.target.value)
                    setEditing(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      save(e.target.value)
                      setEditing(false)
                    }
                    if (e.key === 'Escape') setEditing(false)
                  }}
                />
              ) : (
                <button
                  className={'pf-name' + (name ? '' : ' pf-name-empty')}
                  onClick={() => setEditing(true)}
                  aria-label={name ? 'Edit your name' : 'Add your name'}
                >
                  {name || 'Add your name'}
                </button>
              )}
              <div className="pf-loc">{CITY.name}</div>
            </div>
            <button className="pf-edit" onClick={() => setEditing(true)} aria-label="Edit your profile">
              <PencilIc />
            </button>
          </div>
          {/* P5: the honest lifetime stats trio (Plans · Saved · Days out) */}
          <div className="pf-stats">
            {stats.map((s) => (
              <div className="pf-stat" key={s.k}>
                <span className="pf-stat-num">{s.n}</span>
                <span className="pf-stat-lab">{s.lab}</span>
              </div>
            ))}
          </div>
        </section>
      </header>

      {/* P6: the menu — 6 rows, each an icon tile + label + description + chevron */}
      <nav className="pf-menu" aria-label="Your stuff">
        {rows.map(({ id, Ic, label, desc, onClick }) => (
          <button key={id} className="pf-row" onClick={onClick}>
            <span className="pf-row-ic" aria-hidden>
              <Ic />
            </span>
            <span className="pf-row-text">
              <span className="pf-row-label">{label}</span>
              <span className="pf-row-desc">{desc}</span>
            </span>
            <span className="pf-row-go" aria-hidden>
              <Chev />
            </span>
          </button>
        ))}
      </nav>

      {/* P7: Recently saved — always present (so the section is never "missing");
          shows the 2 most-recent saves via the canonical GemRow, or an honest
          empty state (no fake cards) when nothing is saved yet. */}
      <section className="pf-recent">
        <div className="pf-recent-head">
          <h2 className="pf-recent-title">Recently saved</h2>
          {recentSaves.length > 0 && (
            <button className="pf-seeall" onClick={openMySaves}>See all</button>
          )}
        </div>
        {recentSaves.length > 0 ? (
          <div className="pf-recent-list">
            {recentSaves.map(({ e }) => (
              <GemRow key={keyOf(e)} e={e} onSelect={openDetail} />
            ))}
          </div>
        ) : (
          <div className="pf-empty">Nothing saved yet — tap ♥ on an event or spot to keep it here.</div>
        )}
      </section>
    </div>
  )
}
