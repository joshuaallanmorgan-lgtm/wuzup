const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

export function transferStoreDocument(snapshot) {
  if (!isObject(snapshot?.document)) return null
  return clone(snapshot.document)
}

/**
 * Replace one provider-owned logical document and return only an exact durable
 * readback. The underlying store has already compared the physical bytes after
 * its write; this second logical comparison prevents a provider adapter from
 * claiming a transformed or stale document.
 */
export async function replaceTransferStoreDocument(store, document, options = {}) {
  if (!store || typeof store.replaceDocument !== 'function' || typeof store.getSnapshot !== 'function') {
    return Object.freeze({ ok: false, code: 'transfer-store-unavailable', persisted: false, raw: null })
  }
  let result
  try {
    result = await store.replaceDocument(document, options)
  } catch {
    return Object.freeze({ ok: false, code: 'transfer-store-failed', persisted: false, raw: null })
  }
  const snapshot = store.getSnapshot()
  const landed = transferStoreDocument(snapshot)
  const expectedRaw = JSON.stringify(document)
  const raw = landed === null ? null : JSON.stringify(landed)
  const persisted = result?.persisted === true
    && snapshot?.durability === 'durable'
    && raw === expectedRaw
  return Object.freeze({
    ok: persisted,
    code: persisted ? (result.changed ? 'transfer-replaced' : 'transfer-unchanged') : result?.code || 'transfer-not-durable',
    changed: persisted && result.changed === true,
    persisted,
    raw: persisted ? raw : null,
    document: persisted ? Object.freeze(landed) : null,
  })
}
