// ProfileView — the Profile tab (FINAL MVP, pixel-match to ref-profile-final.png).
// Canonical order: "Profile" title → ONE white identity card (avatar · name · city ·
// orange edit pencil, with the stats trio inside it) → 6 separate menu CARDS (tinted
// circular icon disc · title · description · chevron) → nav. No saved-items preview
// section, no footer. The pencil + name open Edit Profile (PROFILE_PHASE2); Settings
// is the gear's old job, now its own menu row.
//
// The display name lives ONLY on this device ('profile-name-v1') and defaults to
// an "Add your name" prompt — never a fabricated name (the ref's sample name and
// stat counts are mock; we show real counts only). The city is CITY.name.
// Path-safety: every row CALLS its existing opener (openMyPlans/openMySaves/
// openTaste()/openInterests('profile')/openSettings/openHelpFeedback) — only
// structure/styling changed. DRAFT copy — ⚑ Charles.
import { useMemo } from 'react'
import { CITY } from './lib.js'
import { useNav } from './nav.jsx'
import { lsGet } from './storage.js'
import { useSaves, useBeenThere } from './saves.js'
import { loadDayPlans, loadDayHistory, didDays, dayEntryFor, PARTS } from './dayplan.js'
import './profile.css'

const NAME_KEY = 'profile-name-v1'

// calm mono stroke glyphs (currentColor) for the avatar + the menu rows — clean
// feather-style paths (the prior set read wrong: the "gear" was a sun, the heart
// lopsided). All share the 24-viewbox / 1.9 stroke / round caps voice.
const S = { viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }
const PersonIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="9" r="3.4" /><path d="M5.5 19.5c1-3.3 3.6-5 6.5-5s5.5 1.7 6.5 5" /></svg>)
const PencilIc = () => (<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>)
const PlansIc = () => (<svg {...S} aria-hidden><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" /></svg>)
const BookmarkIc = () => (<svg {...S} aria-hidden><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1z" /></svg>)
const HeartIc = () => (<svg {...S} aria-hidden><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>)
const TuneIc = () => (<svg {...S} aria-hidden><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></svg>)
const CogIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="12" r="3.1" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>)
const HelpIc = () => (<svg {...S} aria-hidden><circle cx="12" cy="12" r="9.5" /><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2-2.6 3.6" /><path d="M12 17.2h.01" /></svg>)
const Chev = () => (<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>)

export default function ProfileView({ anchors }) {
  const { openSettings, openTaste, openInterests, openMyPlans, openMySaves, openEditProfile, openHelpFeedback, page } = useNav()
  // name is read on mount + re-read whenever a subpage closes back here (page flip)
  // — so an edit saved in Edit Profile reflects on return (same seam as planCount).
  const name = useMemo(() => {
    void page
    return lsGet(NAME_KEY) || ''
  }, [page])

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
      if (e && PARTS.some((p) => e.slots[p])) days.add(k)
    }
    for (const h of loadDayHistory()) if (h?.slots && PARTS.some((p) => h.slots[p])) days.add(String(h.dayTs))
    return days.size
  }, [anchors, page])
  const daysOut = didDays(been).size
  // labels stay plural (matches the ref): Plans · Saved · Days out
  const stats = [
    { k: 'plans', n: planCount, lab: 'Plans' },
    { k: 'saves', n: savedList.length, lab: 'Saved' },
    { k: 'days', n: daysOut, lab: 'Days out' },
  ]

  const initial = name ? name.trim()[0].toUpperCase() : ''

  // each row CALLS an existing opener (path-safety). Taste profile → openTaste()
  // and Customize interests → openInterests('profile') (the literal-string guard
  // treats 'profile' as not-settings → back to tab). PROFILE_PHASE2 gives Help &
  // feedback a real destination (openHelpFeedback) — no more dead stub.
  const rows = [
    { id: 'plans', Ic: PlansIc, label: 'My Plans', desc: 'Your day plans and upcoming itineraries', onClick: openMyPlans },
    { id: 'saves', Ic: BookmarkIc, label: 'My Saves', desc: 'Spots, events, and guides you saved', onClick: openMySaves },
    { id: 'taste', Ic: HeartIc, label: 'Taste Profile', desc: 'Tell us what you like and improve your picks', onClick: () => openTaste() },
    { id: 'interests', Ic: TuneIc, label: 'Customize Interests', desc: 'Choose topics you love and get better recs', onClick: () => openInterests('profile') },
    { id: 'settings', Ic: CogIc, label: 'Settings & Preferences', desc: 'Account, notifications, privacy, and more', onClick: openSettings },
    { id: 'help', Ic: HelpIc, label: 'Help & Feedback', desc: 'Get help or share your thoughts', onClick: openHelpFeedback },
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
              {/* name + pencil both open Edit Profile (PROFILE_PHASE2 absorbed the
                  inline edit into that screen) */}
              <button
                className={'pf-name' + (name ? '' : ' pf-name-empty')}
                onClick={openEditProfile}
                aria-label={name ? 'Edit your profile' : 'Add your name'}
              >
                {name || 'Add your name'}
              </button>
              <div className="pf-loc">{CITY.name}</div>
            </div>
            <button className="pf-edit" onClick={openEditProfile} aria-label="Edit profile">
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
    </div>
  )
}
