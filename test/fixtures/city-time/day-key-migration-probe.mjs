const backend = new Map()
const blockedWrites = new Set()
globalThis.localStorage = {
  get length() { return backend.size },
  clear() { backend.clear() },
  getItem(key) { return backend.has(String(key)) ? backend.get(String(key)) : null },
  key(index) { return [...backend.keys()][index] ?? null },
  removeItem(key) { backend.delete(String(key)) },
  setItem(key, value) {
    if (!blockedWrites.has(String(key))) backend.set(String(key), String(value))
  },
}

const storage = await import('../../../app/src/storage.js')
const dayplan = await import('../../../app/src/dayplan.js')
const { CITY } = await import('../../../app/src/city.js')
const { cityMidnightMs } = await import('../../../shared/city-time.mjs')

const sourceTimeZone = process.env.LEGACY_SOURCE_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone
const legacyTs = (dayId) => cityMidnightMs(dayId, sourceTimeZone)
const json = (key) => JSON.parse(storage.lsGet(key))
const entry = (slots) => ({ state: null, slots: { morning: null, afternoon: null, night: null, ...slots }, done: false, v: 1 })
const binaryEntry = (day, night) => ({ state: null, slots: { day, night }, done: false, v: 1 })

const day = '2026-07-15'
const friday = '2026-07-17'
const singleton = '2026-07-18'
const oldDay = legacyTs(day)
const cityDay = cityMidnightMs(day, CITY.tz)
const oldFriday = legacyTs(friday)
const cityFriday = cityMidnightMs(friday, CITY.tz)
const oldSingleton = legacyTs(singleton)
const citySingleton = cityMidnightMs(singleton, CITY.tz)

if (process.env.LEGACY_SOURCE_TZ) {
  storage.lsSet('city-day-keys-basis-v1', JSON.stringify({
    v: 1,
    cityId: CITY.id,
    timeZone: CITY.tz,
    sourceDeviceTimeZone: sourceTimeZone,
  }))
}
storage.lsSet('day-migrated-v1', '1')
storage.lsSet('day-plans-v1', JSON.stringify({
  [String(cityDay)]: binaryEntry('e|canonical', null),
  [String(oldDay)]: binaryEntry(null, 'e|legacy'),
  [String(oldSingleton)]: binaryEntry('e|singleton', null),
}))
storage.lsSet('day-history-v1', JSON.stringify([
  { dayTs: cityDay, ...binaryEntry('e|history-canonical', null) },
  { dayTs: oldDay, ...binaryEntry(null, 'e|history-legacy') },
]))
storage.lsSet('day-converted-v1', JSON.stringify({
  v: 1,
  [String(cityDay)]: 'corrupt',
  [String(oldDay)]: 'went',
}))
storage.lsSet('weekend-plan-v1', JSON.stringify({
  weekendStartTs: oldFriday,
  slots: { fri_day: 'e|friday' },
  done: false,
  v: 1,
}))
storage.lsSet('weekend-done-v1', JSON.stringify({ weekendStartTs: oldFriday, done: true, v: 1 }))

dayplan.loadConverted()
const first = {
  plans: json('day-plans-v1'),
  history: json('day-history-v1'),
  converted: json('day-converted-v1'),
  weekend: json('weekend-plan-v1'),
  weekendDone: json('weekend-done-v1'),
  receipt: json('city-day-keys-v1'),
  basis: json('city-day-keys-basis-v1'),
  canonicalStable: dayplan.rekeyLegacyDayTs(cityDay),
  expectedDay: cityDay,
  expectedFriday: cityFriday,
  expectedSingleton: citySingleton,
}
dayplan.migrateCityDayKeys()
const second = {
  plans: json('day-plans-v1'),
  history: json('day-history-v1'),
  converted: json('day-converted-v1'),
  weekend: json('weekend-plan-v1'),
  weekendDone: json('weekend-done-v1'),
}

const retryDay = '2026-07-16'
const oldRetryDay = legacyTs(retryDay)
const cityRetryDay = cityMidnightMs(retryDay, CITY.tz)
storage.lsRemove('city-day-keys-v1')
storage.lsSet('day-plans-v1', JSON.stringify({ [String(oldRetryDay)]: entry({ night: 'e|retry' }) }))
blockedWrites.add(storage.physicalKey('day-plans-v1'))
dayplan.migrateCityDayKeys()
const afterFailure = {
  plans: json('day-plans-v1'),
  receipt: storage.lsGet('city-day-keys-v1'),
}
blockedWrites.clear()
dayplan.migrateCityDayKeys()
const afterRetry = {
  plans: json('day-plans-v1'),
  receipt: json('city-day-keys-v1'),
}
const freshStorage = storage.createStorageScope({ backend: globalThis.localStorage, cityId: CITY.id })
const freshPlans = JSON.parse(freshStorage.get('day-plans-v1'))

process.stdout.write(JSON.stringify({ first, second, partial: { cityRetryDay, afterFailure, afterRetry, freshPlans } }))
