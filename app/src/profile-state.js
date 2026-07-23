import { globalGet, globalReadDurable, globalSet } from './storage.js'

export const PROFILE_STATE_VERSION = 1
export const PROFILE_NAME_KEY = 'profile-name-v1'
export const PROFILE_BIO_KEY = 'profile-bio-v1'

const cleanName = (value) => typeof value === 'string' ? value.trim().slice(0, 40) : ''
const cleanBio = (value) => typeof value === 'string' ? value.trim().slice(0, 120) : ''

export function normalizeProfileState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== PROFILE_STATE_VERSION) return null
  const keys = Object.keys(value)
  if (keys.some((key) => !['version', 'name', 'bio'].includes(key))) return null
  if (typeof value.name !== 'string' || value.name.length > 200
      || typeof value.bio !== 'string' || value.bio.length > 600) return null
  return { version: PROFILE_STATE_VERSION, name: cleanName(value.name), bio: cleanBio(value.bio) }
}

export function readProfileState() {
  return {
    version: PROFILE_STATE_VERSION,
    name: cleanName(globalGet(PROFILE_NAME_KEY) || ''),
    bio: cleanBio(globalGet(PROFILE_BIO_KEY) || ''),
  }
}

export function writeProfileState(value) {
  const normalized = normalizeProfileState(value)
  if (!normalized) return { ok: false, code: 'invalid-profile' }
  const previous = readProfileState()
  const nameSaved = globalSet(PROFILE_NAME_KEY, normalized.name)
  const bioSaved = nameSaved === true && globalSet(PROFILE_BIO_KEY, normalized.bio)
  const persisted = nameSaved === true
    && bioSaved === true
    && globalReadDurable(PROFILE_NAME_KEY) === normalized.name
    && globalReadDurable(PROFILE_BIO_KEY) === normalized.bio
  if (!persisted) {
    const nameRestored = globalSet(PROFILE_NAME_KEY, previous.name)
    const bioRestored = globalSet(PROFILE_BIO_KEY, previous.bio)
    const rolledBack = nameRestored === true && bioRestored === true
    return {
      ok: false,
      code: rolledBack ? 'profile-save-failed' : 'profile-rollback-failed',
      state: readProfileState(),
      rolledBack,
    }
  }
  return { ok: true, code: 'profile-saved', state: normalized, rolledBack: null }
}

export function exportProfileState() {
  return readProfileState()
}

export function importProfileState(value) {
  return writeProfileState(value)
}
