// ProfileView — the Profile tab (Stage R full rework). A clean account-style
// page matching the benchmark: a monogram avatar + an editable on-device display
// name + the active city, a quiet gear → Settings, and a flat 5-row menu. The
// old dashboard sections moved to drill-ins: My plans + My saves subpages, My
// likes → the TastePanel (the vibe chips live there + in Settings), Settings &
// preferences → SettingsPage (the rate-to-sharpen deck + interests stay inside
// it), Help & feedback → an inert "Coming soon" stub. NO Sign Out (no auth).
//
// The display name lives ONLY on this device ('profile-name-v1') and defaults to
// an "Add your name" prompt — never a fabricated name. The city is the app's
// active-city label (CITY.name; one constant for Tampa Bay now, ready to wire to
// the future city selector). DRAFT copy — ⚑ Charles.
import { useState } from 'react'
import { CITY } from './lib.js'
import { useNav } from './nav.jsx'
import { lsGet, lsSet } from './storage.js'
import './profile.css'

const NAME_KEY = 'profile-name-v1'

// the quiet stroke gear (top-right maintenance hatch) — editorial, not loud
const GearIc = () => (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.12-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.12 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
  </svg>
)
// calm mono stroke glyphs (currentColor) for the menu + the empty avatar
const S = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }
const PersonIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="9" r="3.4" /><path d="M5.5 19.5c1-3.3 3.6-5 6.5-5s5.5 1.7 6.5 5" /></svg>)
const PlansIc = () => (<svg {...S} aria-hidden><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 3v4M16 3v4" /></svg>)
const SavesIc = () => (<svg {...S} aria-hidden><path d="M12 20s-7-4.6-7-9.6A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 3.4c0 5-7 9.6-7 9.6Z" /></svg>)
const LikesIc = () => (<svg {...S} aria-hidden><path d="M12 3l1.7 5 5 1.2-5 1.2L12 16l-1.7-5.6-5-1.2 5-1.2L12 3Z" /></svg>)
const PrefsIc = () => (<svg {...S} aria-hidden><path d="M4 7h9M18 7h2M4 17h2M11 17h9" /><circle cx="15.5" cy="7" r="2.2" /><circle cx="8.5" cy="17" r="2.2" /></svg>)
const HelpIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.3 9.3a2.8 2.8 0 0 1 5.3 1c0 1.9-2.6 2.1-2.6 3.7" /><path d="M12 17.4h.01" /></svg>)
const Chev = () => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>)

export default function ProfileView() {
  const { openSettings, openTaste, openMyPlans, openMySaves } = useNav()
  const [name, setName] = useState(() => lsGet(NAME_KEY) || '')
  const [editing, setEditing] = useState(false)
  const save = (v) => {
    const t = (v || '').trim().slice(0, 40)
    setName(t)
    lsSet(NAME_KEY, t)
  }
  const initial = name ? name.trim()[0].toUpperCase() : ''

  // each row CALLS an existing opener (no from/origin arg → My likes/Settings
  // close back to the Profile tab); My plans/My saves are the new single-slot
  // subpages. Help & feedback is an inert stub (no opener, no chevron).
  const rows = [
    { id: 'plans', Ic: PlansIc, label: 'My plans', onClick: openMyPlans },
    { id: 'saves', Ic: SavesIc, label: 'My saves', onClick: openMySaves },
    { id: 'likes', Ic: LikesIc, label: 'My likes', onClick: () => openTaste() },
    { id: 'settings', Ic: PrefsIc, label: 'Settings & preferences', onClick: openSettings },
  ]

  return (
    <div className="pf-scroll">
      <header className="pf-head">
        <button className="pf-gear" onClick={openSettings} aria-label="Settings">
          <GearIc />
        </button>
        <div className="pf-id">
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
        </div>
      </header>

      <nav className="pf-menu" aria-label="Your stuff">
        {rows.map(({ id, Ic, label, onClick }) => (
          <button key={id} className="pf-row pressable" onClick={onClick}>
            <span className="pf-row-ic" aria-hidden>
              <Ic />
            </span>
            <span className="pf-row-label">{label}</span>
            <span className="pf-row-go" aria-hidden>
              <Chev />
            </span>
          </button>
        ))}
        <div className="pf-row pf-row-stub">
          <span className="pf-row-ic" aria-hidden>
            <HelpIc />
          </span>
          <span className="pf-row-label">Help &amp; feedback</span>
          <span className="pf-row-soon">Coming soon</span>
        </div>
      </nav>

      <div className="pf-foot">This whole page lives in your browser — no account, nothing leaves your phone.</div>
    </div>
  )
}
