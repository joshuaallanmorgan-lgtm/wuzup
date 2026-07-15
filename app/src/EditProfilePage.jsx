// EditProfilePage — the Profile pencil's destination (PROFILE_PHASE2 #4; absorbs
// the old inline name-edit). Edits the on-device display name (profile-name-v1) +
// shows the read-only active city. Photo upload, preferred-city and profile
// visibility are HONEST placeholders (stubbed future features — no fake person, no
// fake data). Save/back via closePage → the Profile tab.
import { useState } from 'react'
import { CITY, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import { globalGet, globalSet } from './storage.js'
import './profile.css'

const NAME_KEY = 'profile-name-v1'
const BIO_KEY = 'profile-bio-v1'
const BIO_MAX = 120
const PersonIc = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="9" r="3.4" />
    <path d="M5.5 19.5c1-3.3 3.6-5 6.5-5s5.5 1.7 6.5 5" />
  </svg>
)

export default function EditProfilePage() {
  const { closePage: onClose, openInterests } = useNav()
  const [name, setName] = useState(() => globalGet(NAME_KEY) || '')
  const [bio, setBio] = useState(() => globalGet(BIO_KEY) || '')
  const initial = name ? name.trim()[0].toUpperCase() : ''
  const save = () => {
    globalSet(NAME_KEY, (name || '').trim().slice(0, 40))
    globalSet(BIO_KEY, (bio || '').trim().slice(0, BIO_MAX))
    onClose()
  }

  return (
    <div className="pg ep-pg">
      <header className="pg-head">
        <button className="pg-back" onClick={onClose} aria-label="Back">
          <Icon.chevron />
        </button>
        <h1 className="pg-head-title">Edit Profile</h1>
      </header>
      <div className="pg-body ep-body">
        {/* photo — neutral monogram; upload is a stubbed future feature (no fake person) */}
        <div className="ep-photo-row">
          <div className="ep-photo">{initial || <PersonIc />}</div>
          <button className="ep-photo-edit" type="button" disabled aria-disabled="true">
            Add photo <span className="ep-soon">Soon</span>
          </button>
        </div>

        <label className="ep-field">
          <span className="ep-label">Name</span>
          <input
            className="ep-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add your name"
            maxLength={40}
            aria-label="Your display name"
          />
        </label>

        <label className="ep-field">
          <span className="ep-label">Location</span>
          <input className="ep-input ep-input-ro" value={CITY.name} readOnly aria-label="Your city" />
        </label>

        <label className="ep-field">
          <span className="ep-label ep-label-row">
            <span>Bio <span className="ep-optional">(optional)</span></span>
            <span className="ep-count">{bio.length}/{BIO_MAX}</span>
          </span>
          <textarea
            className="ep-input ep-textarea"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="Tell people what you're into (optional)"
            aria-label="Your bio"
          />
        </label>

        {/* Profile preferences — honest stubs (future keys); shown so the screen
            matches the ref, never faking a saved value. */}
        <div className="ep-sec-label">Profile preferences</div>
        <div className="ep-pref">
          <span>Preferred city</span>
          <span className="ep-pref-v">{CITY.name}</span>
        </div>
        <div className="ep-pref">
          <span>Profile visibility</span>
          <span className="ep-soon">Coming soon</span>
        </div>
        {/* a real destination — the interest editor (matches the ref's Interests row) */}
        <button className="ep-pref ep-pref-link pressable" type="button" onClick={() => openInterests()}>
          <span>Interests</span>
          <span className="ep-pref-go" aria-hidden><Icon.chevron /></span>
        </button>
      </div>

      <button className="ep-save" type="button" onClick={save}>
        Save changes
      </button>
    </div>
  )
}
