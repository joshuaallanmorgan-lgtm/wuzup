// EditProfilePage — the Profile pencil's destination (PROFILE_PHASE2 #4; absorbs
// the old inline name-edit). Edits the on-device display name (profile-name-v1) +
// shows the read-only active city and links to the other verified coverage
// deployment. Save/back via closePage → the Profile tab.
import { useState } from 'react'
import { CITY, Icon } from './lib.js'
import { useNav } from './nav.jsx'
import CityCoverageSelector from './CityCoverageSelector.jsx'
import { readProfileState, writeProfileState } from './profile-state.js'
import './profile.css'

const BIO_MAX = 120

export default function EditProfilePage() {
  const { closePage: onClose, openInterests } = useNav()
  const [initialState] = useState(readProfileState)
  const [name, setName] = useState(initialState.name)
  const [bio, setBio] = useState(initialState.bio)
  const [saveError, setSaveError] = useState(null)
  const save = () => {
    const result = writeProfileState({ version: 1, name, bio })
    if (result.ok) onClose()
    else setSaveError("Couldn't save profile details on this device.")
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
          <span className="ep-label">Current coverage</span>
          <input className="ep-input ep-input-ro" value={CITY.name} readOnly aria-label="Current coverage area" />
        </label>

        <label className="ep-field">
          <span className="ep-label ep-label-row">
            <span>Private note <span className="ep-optional">(optional)</span></span>
            <span className="ep-count">{bio.length}/{BIO_MAX}</span>
          </span>
          <textarea
            className="ep-input ep-textarea"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={BIO_MAX}
            rows={3}
            placeholder="A note about what you like"
            aria-label="Private profile note"
          />
          <span className="ep-optional">Your name and note stay on this device unless you export your data.</span>
        </label>

        {/* Coverage is a real hard-navigation choice; retained state is city-scoped. */}
        <div className="ep-sec-label">Coverage area</div>
        <CityCoverageSelector compact />
        <div className="ep-sec-label">Profile preferences</div>
        {/* a real destination — the interest editor (matches the ref's Interests row) */}
        <button className="ep-pref ep-pref-link pressable" type="button" onClick={() => openInterests()}>
          <span>Interests</span>
          <span className="ep-pref-go" aria-hidden><Icon.chevron /></span>
        </button>
      </div>

      {saveError && <div className="ae-err" role="alert">{saveError}</div>}
      <button className="ep-save" type="button" onClick={save}>
        Save changes
      </button>
    </div>
  )
}
