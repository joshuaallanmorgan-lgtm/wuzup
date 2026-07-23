// saves.js — the compatibility/read-model seam over the atomic city-scoped
// Saved/Been provider. Storage, migration, cross-tab reconciliation and writes
// belong to SavedBeenProvider; this module keeps the small public API consumed
// by existing cards and shelves while making every mutation asynchronous and
// outcome-truthful. Plain .js (no JSX): SaveHeart uses createElement.
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, addDayTs, eventLifecycle, keyOf, normalize } from './lib.js'
import { capturePersonalSignal } from './personal-signals.js'
import { useSavedBeen } from './SavedBeenProvider.jsx'
import { guideSnapshot } from './guide-model.js'
import './saves.css'

const recordKey = (record) => record?.key ?? record?.primary ?? record?.ref?.primary ?? null
const saveKey = (item) => item?.kind === 'guide' && item?.id
  ? `g|${item.id}`
  : keyOf(item || {})

const legacyRecord = (record) => {
  const key = recordKey(record)
  return key && record?.key !== key ? { ...record, key } : record
}

// Preserve the historical array API while sourcing it from the provider's
// immutable projection. Mutations intentionally do not live here.
export function useBeenThere() {
  const { been = [], beenItems = [] } = useSavedBeen()
  return useMemo(() => been.map((record, index) => {
    const base = legacyRecord(record)
    const hydrated = beenItems[index]
    return hydrated?.available && hydrated.item
      ? { ...base, snapshot: hydrated.item, resolution: hydrated.identityStatus, source: hydrated.source }
      : { ...base, resolution: hydrated?.identityStatus, source: hydrated?.source }
  }).filter(Boolean), [been, beenItems])
}

// the persisted snapshot — just enough to render a shelf card (and, for a
// place, to fully round-trip back to PlaceDetail) after a dataset refresh
// drops the live record. Extracted so the smoke harness can assert the
// place round-trip without a DOM (saves.js can't import into Node — it pulls
// in CSS — so the test greps this, but keeping it one function documents the
// contract in one place).
export function snapshotFor(e) {
  const snap = {
    title: e.title ?? null,
    start: e.start ?? null,
    // end + tags must survive: without them a still-running multi-day save
    // would normalize to a one-day event and be falsely marked "Happened"
    end: e.end ?? null,
    tags: Array.isArray(e.tags) ? e.tags : [],
    venue: e.venue ?? null,
    image: e.image ?? null,
    url: e.url ?? null,
    category: e.category ?? null,
    isFree: e.isFree ?? null,
    price: e.price ?? null,
    // the labeling invariant survives a dataset refresh: a vanished
    // sponsored save must still wear its disclosure everywhere
    sponsored: e.sponsored === true,
    status: e.status ?? null,
  }
  // Sprint S: a saved PLACE must reopen as PlaceDetail with a correct ♥.
  // Places are NEVER in the events norm, so shelfItems can't re-resolve a
  // 'p|' key from the live dataset — the snapshot is the ONLY source. Carry
  // kind+key (so keyOf returns 'p|slug' again → App routes to PlaceDetail)
  // plus the fields PlaceDetail renders, so the reopened detail is full.
  if (e.kind === 'place') {
    snap.kind = 'place'
    snap.key = e.key
    snap.name = e.name ?? null
    snap.lat = e.lat ?? null
    snap.lng = e.lng ?? null
    snap.placeType = e.placeType ?? null
    snap.classes = Array.isArray(e.classes) ? e.classes : []
    snap.amenities = Array.isArray(e.amenities) ? e.amenities : []
    snap.hours = e.hours ?? null
    snap.fee = e.fee ?? null
    snap.description = e.description ?? null
    snap.sources = Array.isArray(e.sources) ? e.sources : []
    snap.srcCount = e.srcCount ?? null
    snap.hidden = e.hidden ?? null
  }
  // Guides are retained product objects, not event-shaped rows. Their stable
  // g| identity and point of view must survive a catalog refresh so My Saves
  // can reopen the exact guide rather than dressing it up as an event.
  if (e.kind === 'guide') {
    const retained = guideSnapshot(e)
    if (retained) Object.assign(snap, retained)
  }
  return snap
}

function expiredSavedRecords(list, events, anchors) {
  if (!anchors || !Array.isArray(events)) return []
  const byKey = new Map(events.map((event) => [saveKey(event), event]))
  return list.filter((record) => {
    if (record?.snapshot?.kind === 'guide' || record?.snapshot?.kind === 'place') return false
    const event = byKey.get(record.key) ?? normalize({ ...record.snapshot }, anchors)
    const endDay = event._endDay ?? event._day
    return eventLifecycle(event).code === 'ended'
      && endDay != null
      && endDay < addDayTs(anchors.todayTs, -7)
  })
}

// → { ids, list, has(item), toggle(item), isPending(item), status, ready }.
// Passing {events, anchors} activates effect-owned expiry archiving for shelf
// consumers. More than one mounted shelf may request the same archive; the
// provider command is idempotent and the record token resolves that race.
export function useSaves({ events, anchors } = {}) {
  const {
    status,
    ready,
    error,
    recovery,
    saved = [],
    savedItems = [],
    hasSaved,
    savedToggleResolutionFor,
    toggleSaved,
    removeSaved,
    archiveSaved,
    retryPersistence,
  } = useSavedBeen()
  const list = useMemo(() => saved.map((record, index) => {
    const base = legacyRecord(record)
    const hydrated = savedItems[index]
    return hydrated?.available && hydrated.item
      ? { ...base, snapshot: hydrated.item, resolution: hydrated.identityStatus, source: hydrated.source }
      : { ...base, resolution: hydrated?.identityStatus, source: hydrated?.source }
  }).filter(Boolean), [saved, savedItems])
  const ids = useMemo(() => new Set(list.map((record) => record.key)), [list])
  const pendingRef = useRef(new Set())
  const [pendingKeys, setPendingKeys] = useState(() => new Set())

  const has = useCallback((item) => hasSaved(item), [hasSaved])
  const isPending = useCallback((item) => pendingKeys.has(saveKey(item)), [pendingKeys])
  const isRecordPending = useCallback((record) => pendingKeys.has(recordKey(record)), [pendingKeys])
  const toggleResolution = useCallback(
    (item) => savedToggleResolutionFor(item),
    [savedToggleResolutionFor]
  )
  const identityPending = useCallback((item) => !hasSaved(item)
    && Array.isArray(item?._sessionIdentityAliases)
    && item._sessionIdentityAliases.length > 0
    && !toggleResolution(item)?.beenRecord, [hasSaved, toggleResolution])
  const identityAmbiguous = useCallback(
    (item) => toggleResolution(item)?.status === 'ambiguous',
    [toggleResolution]
  )
  const identityWent = useCallback(
    (item) => toggleResolution(item)?.status === 'went',
    [toggleResolution]
  )
  const canToggle = useCallback((item) => ready
    && toggleResolution(item)?.canToggle === true
    && !isPending(item)
    && !identityPending(item), [identityPending, isPending, ready, toggleResolution])
  const toggle = useCallback(async (item) => {
    const key = saveKey(item)
    const resolution = toggleResolution(item)
    const identitySafe = resolution?.canToggle === true
    if (!ready || !key || !identitySafe || identityPending(item) || pendingRef.current.has(key)) {
      return {
        changed: false,
        code: !ready
          ? 'saved-been-unavailable'
          : resolution?.status === 'went'
            ? 'saved-been-went-conflict'
            : resolution?.status === 'ambiguous'
              ? 'saved-been-identity-ambiguous'
              : identityPending(item)
              ? 'saved-been-identity-pending'
              : !identitySafe
                ? 'saved-been-unavailable'
                : 'save-pending',
      }
    }
    const wasSaved = hasSaved(item)
    pendingRef.current.add(key)
    setPendingKeys(new Set(pendingRef.current))
    try {
      const result = await toggleSaved(item, { savedAt: Date.now() })
      const changed = result?.changed === true || result?.applied === true
      const savedOn = result?.saved === true || result?.code === 'saved'
      if (!wasSaved && changed && savedOn) {
        capturePersonalSignal('save', item, { source: 'saved-been', result })
      }
      return result
    } catch (error) {
      return { changed: false, code: 'save-failed', error }
    } finally {
      pendingRef.current.delete(key)
      setPendingKeys(new Set(pendingRef.current))
    }
  }, [hasSaved, identityPending, ready, toggleResolution, toggleSaved])

  const remove = useCallback(async (record) => {
    const key = recordKey(record)
    if (!ready || !key || pendingRef.current.has(key)) {
      return { changed: false, code: !ready ? 'saved-been-unavailable' : 'save-pending' }
    }
    pendingRef.current.add(key)
    setPendingKeys(new Set(pendingRef.current))
    try {
      return await removeSaved(record)
    } catch (error) {
      return { changed: false, code: 'remove-save-failed', error }
    } finally {
      pendingRef.current.delete(key)
      setPendingKeys(new Set(pendingRef.current))
    }
  }, [ready, removeSaved])

  const canRemove = useCallback((record) => ready
    && Boolean(recordKey(record))
    && !isRecordPending(record), [isRecordPending, ready])

  useEffect(() => {
    if (!ready || typeof archiveSaved !== 'function') return undefined
    const expired = expiredSavedRecords(list, events, anchors)
    if (expired.length === 0) return undefined
    let cancelled = false
    const archivedAt = Date.now()
    void (async () => {
      for (const record of expired) {
        if (cancelled) return
        await archiveSaved(record, { archivedAt })
      }
    })()
    return () => { cancelled = true }
  }, [anchors, archiveSaved, events, list, ready])

  return {
    status,
    ready,
    error,
    recovery,
    retryPersistence,
    ids,
    list,
    has,
    toggle,
    remove,
    canToggle,
    canRemove,
    identityPending,
    identityAmbiguous,
    identityWent,
    isPending,
    isRecordPending,
    pendingKeys,
  }
}

// PROFILE_PHASE2: time-group the saved-shelf for MySavesPage.
// Groups (in order): Upcoming · Yesterday · Earlier this week · Saved earlier.
// Based on the event's end day vs todayTs; past saves drop after 7 days (shelfItems
// contract) so the "Saved earlier" bucket is thin by design.
export function groupShelfByTime(shelf, anchors) {
  const now = anchors.todayTs
  const groups = [
    { key: 'upcoming', label: 'Upcoming', items: [] },
    { key: 'unavailable', label: 'No longer available', items: [] },
    { key: 'today', label: 'Earlier today', items: [] },
    { key: 'yesterday', label: 'Yesterday', items: [] },
    { key: 'week', label: 'Earlier this week', items: [] },
    { key: 'older', label: 'Saved earlier', items: [] },
  ]
  for (const item of shelf) {
    if (item.unavailable && item.lifecycle?.code !== 'ended') {
      groups[1].items.push(item)
      continue
    }
    if (!item.past) {
      groups[0].items.push(item)
      continue
    }
    const endDay = item.e._endDay ?? item.e._day ?? 0
    if (endDay >= now) groups[2].items.push(item)
    else if (endDay >= addDayTs(now, -1)) groups[3].items.push(item)
    else if (endDay >= addDayTs(now, -6)) groups[4].items.push(item)
    else groups[5].items.push(item)
  }
  return groups.filter((group) => group.items.length > 0)
}
// Saved-shelf items: the live event when its key still exists in the dataset,
// otherwise the stored snapshot (normalized so cards/detail render it fine).
// Past saves wear past:true (grey + "happened") and drop off the shelf 7 days
// after they happened; upcoming saves never disappear. Order: upcoming
// soonest-first, then past most-recent-first.
export function shelfItems(list, events, anchors) {
  const byKey = new Map()
  for (const e of events) byKey.set(saveKey(e), e)
  const out = []
  for (const s of list) {
    const retainedGuide = s.snapshot?.kind === 'guide'
    const retainedPlace = s.snapshot?.kind === 'place'
    const retainedNonTemporal = retainedGuide || retainedPlace
    const e = byKey.get(s.key) ?? (retainedNonTemporal ? { ...s.snapshot } : normalize({ ...s.snapshot }, anchors))
    if (s.resolution === 'missing'
        || s.resolution === 'ambiguous'
        || s.source === 'snapshot' && !retainedNonTemporal) {
      out.push({
        e,
        record: s,
        past: false,
        unavailable: true,
        resolution: s.resolution,
        lifecycle: {
          code: 'unavailable',
          actionable: false,
          label: s.resolution === 'ambiguous' ? 'Needs review' : 'No longer listed',
        },
      })
      continue
    }
    if (retainedNonTemporal) {
      out.push({
        e,
        record: s,
        past: false,
        unavailable: false,
        resolution: s.resolution,
        lifecycle: { code: 'available', actionable: true, label: null },
      })
      continue
    }
    const endDay = e._endDay ?? e._day
    const lifecycle = eventLifecycle(e)
    const past = lifecycle.code === 'ended'
    const unavailable = !lifecycle.actionable
    if (lifecycle.code === 'ended' && endDay != null && endDay < addDayTs(anchors.todayTs, -7)) {
      continue
    }
    out.push({ e, record: s, past, unavailable, resolution: s.resolution, lifecycle })
  }
  out.sort((a, b) =>
    a.past !== b.past
      ? (a.past ? 1 : -1)
      : a.past
        ? (b.e._t ?? 0) - (a.e._t ?? 0)
        : (a.e._t ?? Number.MAX_SAFE_INTEGER) - (b.e._t ?? Number.MAX_SAFE_INTEGER)
  )
  return out
}

// ♥ toggle. This is always a native button; card compositions keep it as a
// sibling of their open-detail button so there are no nested controls. Native
// Enter/Space behavior is intentionally left to the browser. big = detail-hero
// variant (38px). The pop animation plays only on
// a real local toggle-on — never on mount — and saves.css kills it under
// prefers-reduced-motion. Saving never reorders or hides anything.
export function SaveHeart({ e, big, bare }) {
  const { ready, has, toggle, identityPending, identityAmbiguous, identityWent, isPending } = useSaves()
  const on = has(e)
  const pending = isPending(e)
  const identityIsPending = identityPending(e)
  const identityNeedsReview = identityAmbiguous(e)
  const identityCompleted = identityWent(e)
  const identityUnavailable = identityIsPending || identityNeedsReview || identityCompleted
  const [pop, setPop] = useState(false)
  const activate = async (ev) => {
    ev.stopPropagation()
    if (!ready || pending || identityUnavailable) return
    const result = await toggle(e)
    const changed = result?.changed === true || result?.applied === true
    const savedOn = result?.saved === true || result?.code === 'saved'
    if (changed && savedOn) setPop(true)
  }
  // PREMIUM A2: the engineered stroke heart (outline → filled), retiring ♥ ♡.
  // `bare` = the top-right card-body heart (no disc); default = the image-overlay
  // disc (tiles/hero). Resting outline / saved fill both ride currentColor.
  const Glyph = on ? Icon.heartFill : Icon.heart
  return h(
    'button',
    {
      type: 'button',
      className: 'save-btn' + (on ? ' on' : '') + (big ? ' save-big' : '') + (bare ? ' save-bare' : ''),
      'aria-pressed': on,
      'aria-busy': pending || undefined,
      disabled: !ready || pending || identityUnavailable,
      'aria-label': identityUnavailable
        ? identityCompleted
          ? 'Already in your Been history'
          : identityNeedsReview
            ? 'Saved item needs review before it can be changed'
            : 'Save unavailable until this added event can be saved'
        : on
          ? 'Remove from your list'
          : 'Save to your list',
      onClick: activate,
      onAnimationEnd: () => setPop(false), // bubbles up from .save-ic
    },
    h('span', { className: 'save-ic' + (on && pop ? ' pop' : ''), 'aria-hidden': true }, Glyph({ className: 'save-svg' }))
  )
}
