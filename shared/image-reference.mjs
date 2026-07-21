const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/i

const nonEmptyString = (value, maximum) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum

function normalizeHosts(hosts) {
  if (hosts instanceof Set) {
    return new Set([...hosts].filter((host) => nonEmptyString(host, 253))
      .map((host) => host.trim().toLowerCase()))
  }
  if (!Array.isArray(hosts)) throw new Error('selfHostedHosts must be an array when provided')
  return new Set(hosts.filter((host) => nonEmptyString(host, 253))
    .map((host) => host.trim().toLowerCase()))
}

function decodedLayers(value) {
  const layers = [value]
  let current = value
  for (let depth = 0; depth < 8; depth++) {
    let decoded
    try {
      decoded = decodeURIComponent(current)
    } catch {
      return null
    }
    if (decoded === current) return layers
    layers.push(decoded)
    current = decoded
  }
  try {
    if (decodeURIComponent(current) !== current) return null
  } catch {
    return null
  }
  return layers
}

function unsafeDecodedReference(value) {
  const layers = decodedLayers(value)
  if (!layers) return true
  return layers.some((layer) => {
    if (CONTROL_CHARACTERS.test(layer) || layer.includes('\\')) return true
    const path = layer.split(/[?#]/, 1)[0]
    return path.split('/').some((segment) => segment === '..')
  })
}

export function validImageSha256(value) {
  return nonEmptyString(value, 71) && SHA256.test(value.trim())
}

/**
 * Validates image delivery syntax only. It does not infer permission, license,
 * attribution, or ownership from a URL or host.
 */
export function validateImageReference(value, {
  selfHostedHosts = [],
  maximumLength = 2048,
} = {}) {
  const hosts = normalizeHosts(selfHostedHosts)
  if (value == null || value === '') return { kind: 'missing', url: null, host: null }
  if (!nonEmptyString(value, maximumLength)) return { kind: 'invalid', url: null, host: null }

  const trimmed = value.trim()
  if (unsafeDecodedReference(trimmed)) return { kind: 'invalid', url: trimmed, host: null }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    let parsed
    try {
      parsed = new URL(trimmed, 'https://self-hosted.invalid')
    } catch {
      return { kind: 'invalid', url: trimmed, host: null }
    }
    if (parsed.origin !== 'https://self-hosted.invalid') {
      return { kind: 'invalid', url: trimmed, host: null }
    }
    return { kind: 'selfHosted', url: trimmed, host: null }
  }

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return { kind: 'invalid', url: trimmed, host: null }
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    return { kind: 'invalid', url: trimmed, host: null }
  }

  const host = parsed.host.toLowerCase()
  return {
    kind: hosts.has(host) ? 'selfHosted' : 'remote',
    url: trimmed,
    host,
  }
}
