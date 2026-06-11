// test/smoke.mjs — the Sprint-M regression smoke harness. Run: npm test
// (root). node:test + node:assert ONLY — zero new dependencies.
//
// What runs, in order (see README-TEST.md for the one-page contract):
//   1. finder fast-mode  — spawns SKIP_RENDER=1 SKIP_EXTRA=1 node finder/finder.mjs,
//      asserts exit 0, parses the benchmark block, ✅-asserts every benchmark
//      that is meaningful without the skipped sources, schema-validates 20
//      random events from the fast output. The three files the finder writes
//      (finder/output/events.json, events.md, app/public/events.json) are
//      backed up in memory first and ALWAYS restored (finally) — a test run
//      must never leave the app pointing at the small fast-mode dataset.
//   2. data invariants    — on the CURRENT full app/public/events.json, captured
//      at module load (i.e. before the finder run can touch it). "Ended" is
//      measured against the GENERATION stamp parsed from events.md (file
//      mtime lies after any byte-identical restore — see generationTime());
//      the invariant is "the finder wrote no already-ended events", not
//      "no event has ended since". Windows note: node --test wall-clock can
//      exceed the runner-reported time (spawned npm shells linger after the
//      summary); exit codes are still correct — CI is slow, not wrong.
//   3. app build          — npm --prefix app run build, exit 0.
//   4. app lint           — npm --prefix app run lint,  exit 0 (runs in
//      parallel with the build; both only read app sources).
//   5. pure-logic units   — imports app/src/lib.js / weekend.js / taste.js
//      directly into Node and asserts the core ordering/window/bounds math.
//
// Failures are LOUD: every assert message carries the offending line, event
// title, or captured process output tail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_EVENTS = path.join(ROOT, 'app', 'public', 'events.json')
const FINDER_JSON = path.join(ROOT, 'finder', 'output', 'events.json')
const FINDER_MD = path.join(ROOT, 'finder', 'output', 'events.md')

// ---------- capture the CURRENT full dataset BEFORE anything can mutate it ----------
assert.ok(existsSync(APP_EVENTS), `missing ${APP_EVENTS} — run "npm run refresh" first; the app has no data`)
const fullRaw = readFileSync(APP_EVENTS, 'utf8')
const fullEvents = JSON.parse(fullRaw)
// "Ended" must be judged against the dataset's GENERATION time. File mtime is
// untrustworthy here — any restore (this harness's own finally-restore, cp,
// git checkout) rewrites identical content with a fresh mtime and would make
// honest-at-write-time events read as "ended". The finder stamps the real
// generation moment into events.md ("_Generated 6/10/2026, 12:21:37 PM · …_"),
// written in the same run as both json files; trust it whenever the app copy
// and the finder output are byte-identical (the normal pipeline state), else
// fall back to mtime and say so in the failure message.
const genRefMs = (() => {
  try {
    if (
      existsSync(FINDER_MD) &&
      existsSync(FINDER_JSON) &&
      readFileSync(FINDER_JSON, 'utf8') === fullRaw
    ) {
      const m = readFileSync(FINDER_MD, 'utf8').match(/_Generated ([^·]+) ·/)
      const t = m ? new Date(m[1].trim()).getTime() : NaN
      if (!Number.isNaN(t)) return { ms: t, src: 'events.md generation stamp' }
    }
  } catch {
    /* unreadable sidecar — fall through to mtime */
  }
  return { ms: statSync(APP_EVENTS).mtimeMs, src: 'file mtime (no matching events.md stamp!)' }
})()

// ---------- helpers ----------
function collect(child) {
  const t0 = Date.now()
  return new Promise((resolve) => {
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code, out, secs: ((Date.now() - t0) / 1000).toFixed(1) }))
  })
}
// node scripts: spawn the current node binary directly — no shell involved
const runNode = (script, env) =>
  collect(spawn(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, env: { ...process.env, ...env } }))
// npm scripts: npm is npm.cmd on Windows — a single fixed command STRING with
// shell:true resolves it everywhere (no args array → no DEP0190, nothing to escape)
const runNpm = (cmdline) => collect(spawn(cmdline, { cwd: ROOT, shell: true }))
const tail = (s, n = 30) => s.split(/\r?\n/).slice(-n).join('\n')

// mirrors finder.mjs endedAtMs: date-only → exclusive next-midnight; timed
// no-end → start + 3h assumed duration
const ASSUMED_MS = 3 * 3600 * 1000
function endedAtMs(e) {
  const s = String(e.end || e.start || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d + 1).getTime()
  }
  const t = Date.parse(s)
  if (Number.isNaN(t)) return NaN
  return e.end ? t : t + ASSUMED_MS
}
const startHourOf = (s) => {
  const m = String(s || '').match(/T(\d{2}):/)
  return m ? Number(m[1]) : null
}

// schema-v2 validator (types derived from the live dataset: 20 fields, the
// always-present core + the nullable rest). Returns a list of problems.
const NULLABLE = {
  end: 'string',
  venue: 'string',
  address: 'string',
  price: 'number',
  currency: 'string',
  isFree: 'boolean',
  lat: 'number',
  lng: 'number',
  url: 'string',
  image: 'string',
  description: 'string',
}
function schemaProblems(e, i) {
  const p = []
  const id = `event[${i}] "${String(e?.title).slice(0, 60)}"`
  if (!e || typeof e !== 'object') return [`event[${i}] is not an object`]
  if (typeof e.title !== 'string' || !e.title.trim()) p.push(`${id}: title must be a non-empty string`)
  if (typeof e.start !== 'string' || !e.start) p.push(`${id}: start must be a non-empty string`)
  else if (!/^\d{4}-\d{2}-\d{2}/.test(e.start) || Number.isNaN(Date.parse(e.start)))
    p.push(`${id}: start "${e.start}" is not a parseable ISO date`)
  if (typeof e.source !== 'string' || !e.source.trim()) p.push(`${id}: source must be a non-empty string`)
  if (!Array.isArray(e.sources) || e.sources.length < 1 || e.sources.some((s) => typeof s !== 'string'))
    p.push(`${id}: sources must be a non-empty string array`)
  if (!Array.isArray(e.tags) || e.tags.some((t) => typeof t !== 'string')) p.push(`${id}: tags must be a string array`)
  if (typeof e.buzz !== 'number' || e.buzz < 1) p.push(`${id}: buzz must be a number >= 1 (got ${e.buzz})`)
  if (typeof e.hotScore !== 'number') p.push(`${id}: hotScore must be a number (got ${typeof e.hotScore})`)
  if (typeof e.category !== 'string' || !e.category) p.push(`${id}: category must be a non-empty string`)
  if (typeof e.sponsored !== 'boolean')
    p.push(`${id}: sponsored must be boolean — the labeling invariant needs the field to EXIST (got ${typeof e.sponsored})`)
  for (const [k, want] of Object.entries(NULLABLE)) {
    if (!(k in e)) p.push(`${id}: missing field "${k}" (nullable, but must be present)`)
    else if (e[k] !== null && typeof e[k] !== want) p.push(`${id}: ${k} must be ${want}|null (got ${typeof e[k]})`)
  }
  if ((e.lat == null) !== (e.lng == null)) p.push(`${id}: lat/lng must be null together or set together`)
  return p
}

// ============================================================
// 1) FINDER FAST-MODE — the long pole, so it runs first
// ============================================================
test('finder fast-mode: exit 0, benchmarks green, output schema-valid', { timeout: 360_000 }, async (t) => {
  // in-memory backup of everything the finder overwrites
  const backups = [APP_EVENTS, FINDER_JSON, FINDER_MD]
    .filter((f) => existsSync(f))
    .map((f) => [f, readFileSync(f)])
  let res
  try {
    res = await runNode('finder/finder.mjs', { SKIP_RENDER: '1', SKIP_EXTRA: '1' })
    t.diagnostic(`finder fast-mode took ${res.secs}s`)
    assert.equal(res.code, 0, `finder exited ${res.code} — output tail:\n${tail(res.out)}`)

    // --- benchmark block: every line below must be present AND ✅ in fast mode ---
    const mustPass = [
      'free events:',
      'hidden gems:',
      'coords outside Tampa Bay box:',
      'non-nightlife events starting 01:00–05:59:',
      "'other' category:",
      'gov-noise titles',
      'fully-ended events in output:',
    ]
    for (const label of mustPass) {
      const line = res.out.split(/\r?\n/).find((l) => l.includes(label))
      assert.ok(line, `benchmark line "${label}" missing from finder output — did the benchmark block change?`)
      assert.ok(
        line.includes('✅'),
        `benchmark REGRESSED (not ✅): "${line.trim()}" — fix the data path before shipping`
      )
    }
    // buzz>=2 needs the skipped render/extra sources to hit its real threshold
    // (3); in fast mode we assert the line exists and the MERGE still produces
    // at least one cross-source event — 0 means the merge mechanism broke.
    const buzzLine = res.out.split(/\r?\n/).find((l) => l.includes('events with buzz >= 2:'))
    assert.ok(buzzLine, 'buzz >= 2 benchmark line missing from finder output')
    const buzzN = Number(buzzLine.match(/buzz >= 2:\s*(\d+)/)?.[1])
    assert.ok(buzzN >= 1, `cross-source merge produced ${buzzN} buzz>=2 events in fast mode (expected >= 1): "${buzzLine.trim()}"`)
    // sponsored is render-sourced: fast mode prints the ⚠️ offline variant
    assert.ok(
      res.out.includes('sponsored (promoted) cltampa events'),
      'sponsored benchmark line missing (⚠️ render-offline variant expected in fast mode)'
    )
    const totalLine = res.out.split(/\r?\n/).find((l) => l.includes('TOTAL upcoming events:'))
    assert.ok(totalLine, 'TOTAL upcoming events line missing from finder output')
    const totalN = Number(totalLine.match(/TOTAL upcoming events:\s*(\d+)/)?.[1])
    assert.ok(
      totalN >= 150,
      `fast-mode static sources produced only ${totalN} events (expect ~250; >= 150 floor) — sources or caches are failing`
    )
    t.diagnostic(`fast-mode events: ${totalN}, buzz>=2: ${buzzN}`)

    // --- fast output exists and schema-validates: 20 random spot checks ---
    const fast = JSON.parse(readFileSync(FINDER_JSON, 'utf8'))
    assert.ok(Array.isArray(fast) && fast.length > 0, 'finder/output/events.json is not a non-empty array')
    const picked = []
    for (let n = 0; n < Math.min(20, fast.length); n++) picked.push(Math.floor(Math.random() * fast.length))
    t.diagnostic(`schema spot-check indexes: ${picked.join(',')}`)
    const problems = picked.flatMap((i) => schemaProblems(fast[i], i))
    assert.equal(problems.length, 0, `fast-mode output schema problems:\n  ${problems.join('\n  ')}`)
  } finally {
    for (const [f, buf] of backups) writeFileSync(f, buf) // never leave fast-mode data behind
  }
  // restored: the app's copy must be the full dataset again
  assert.equal(
    readFileSync(APP_EVENTS, 'utf8'),
    fullRaw,
    'app/public/events.json was not restored byte-for-byte after the finder run'
  )
})

// ============================================================
// 2) DATA INVARIANTS on the CURRENT full events.json
// ============================================================
test(`data invariants: full events.json (${fullEvents.length} events)`, () => {
  assert.ok(Array.isArray(fullEvents) && fullEvents.length > 0, 'app/public/events.json is not a non-empty array')

  // every event has title + start + source (the minimum to render honestly)
  const missing = fullEvents
    .map((e, i) => (!e.title || !e.start || !e.source ? `event[${i}] "${String(e.title).slice(0, 50)}"` : null))
    .filter(Boolean)
  assert.equal(missing.length, 0, `events missing title/start/source:\n  ${missing.slice(0, 10).join('\n  ')}`)

  // zero junk hours: non-nightlife events never start 01:00–05:59 (publisher junk)
  const junk = fullEvents.filter((e) => {
    const h = startHourOf(e.start)
    return e.category !== 'nightlife' && h !== null && h >= 1 && h <= 5
  })
  assert.equal(
    junk.length,
    0,
    `junk-hour events (non-nightlife, 01:00–05:59 start): ${junk.slice(0, 5).map((e) => `"${e.title}" @ ${e.start}`).join('; ')}`
  )

  // zero ended AS OF the dataset's generation time — the finder must never
  // OUTPUT an already-over event; events ending after the snapshot is the
  // stale-data banner's territory, not a data bug
  const ended = fullEvents.filter((e) => !(endedAtMs(e) > genRefMs.ms))
  assert.equal(
    ended.length,
    0,
    `events already ended at generation time (${new Date(genRefMs.ms).toISOString()}, via ${genRefMs.src}): ` +
      ended.slice(0, 5).map((e) => `"${e.title}" start=${e.start} end=${e.end}`).join('; ')
  )

  // sponsored: the field exists (boolean) on EVERY event — labels can only
  // render if the data carries the flag (never-unlabeled invariant)
  const badSp = fullEvents.filter((e) => typeof e.sponsored !== 'boolean')
  assert.equal(badSp.length, 0, `${badSp.length} events without a boolean sponsored field — labeling invariant at risk`)

  // hidden gems: curated shelf stays capped
  const gems = fullEvents.filter((e) => Array.isArray(e.tags) && e.tags.includes('hidden-gem')).length
  assert.ok(gems <= 24, `hidden-gem count ${gems} exceeds the cap of 24 — gem curation regressed`)

  // full-file schema pass (cheap at this size; loud per-event messages)
  const problems = fullEvents.flatMap((e, i) => schemaProblems(e, i))
  assert.equal(problems.length, 0, `schema problems in full events.json:\n  ${problems.slice(0, 12).join('\n  ')}`)
})

// ============================================================
// 2b) PLACES DATA INVARIANTS on the CURRENT app/public/places.json
//     (Sprint R2 — schema v1 asserts, same style as the events block above;
//     the places pipeline is NOT spawned here: it's Overpass-politeness-slow
//     by design, and these invariants hold on whatever it last wrote)
// ============================================================
const APP_PLACES = path.join(ROOT, 'app', 'public', 'places.json')
const TB_BOX = { latMin: 27.3, latMax: 28.6, lngMin: -83.3, lngMax: -81.9 } // == finder TB_BOX
const PLACE_CATEGORIES = new Set(['music', 'sports', 'theatre', 'comedy', 'art', 'market', 'food', 'outdoors', 'nightlife', 'family', 'community', 'other'])
const PLACE_TYPES = new Set(['park', 'preserve', 'beach', 'trail', 'dog_park', 'garden', 'pier', 'boat_ramp', 'playground', 'viewpoint', 'courts'])

test('places data invariants: schema v1 places.json', () => {
  assert.ok(existsSync(APP_PLACES), `missing ${APP_PLACES} — run "node finder/places.mjs" first; the places layer has no data`)
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  assert.equal(doc.schemaVersion, 1, `places.json schemaVersion must be 1 (got ${doc.schemaVersion})`)
  const places = doc.places
  assert.ok(Array.isArray(places) && places.length > 0, 'places.json .places is not a non-empty array')
  assert.ok(places.length >= 300, `places total ${places.length} below the 300 floor — a source regressed (R DoD)`)

  const problems = []
  const keys = new Set()
  for (let i = 0; i < places.length; i++) {
    const p = places[i]
    const id = `place[${i}] "${String(p?.name).slice(0, 50)}"`
    // required core: key/kind/name/placeType/category/lat/lng/sources
    if (typeof p.key !== 'string' || !p.key.startsWith('p|')) problems.push(`${id}: key must start with 'p|' (got ${p.key})`)
    if (keys.has(p.key)) problems.push(`${id}: duplicate key ${p.key}`)
    keys.add(p.key)
    if (p.kind !== 'place') problems.push(`${id}: kind must be 'place' (got ${p.kind})`)
    if (typeof p.name !== 'string' || !p.name.trim()) problems.push(`${id}: nameless place (need 0)`)
    if (!PLACE_TYPES.has(p.placeType)) problems.push(`${id}: unknown placeType "${p.placeType}"`)
    if (!Array.isArray(p.classes) || !p.classes.length) problems.push(`${id}: classes must be a non-empty array`)
    if (!PLACE_CATEGORIES.has(p.category)) problems.push(`${id}: category "${p.category}" not in the 12-category taxonomy`)
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' ||
        p.lat < TB_BOX.latMin || p.lat > TB_BOX.latMax || p.lng < TB_BOX.lngMin || p.lng > TB_BOX.lngMax)
      problems.push(`${id}: coords (${p.lat},${p.lng}) outside the Tampa Bay box`)
    if (!Array.isArray(p.sources) || p.sources.length < 1 || p.sources.some((s) => typeof s !== 'string'))
      problems.push(`${id}: sources must be a non-empty string array`)
    if (typeof p.srcCount !== 'number' || p.srcCount !== p.sources?.length)
      problems.push(`${id}: srcCount must equal sources.length`)
    // hidden shelf: no hidden without hiddenScore (PLACES_SOURCES.md §2 asserts)
    if (typeof p.hidden !== 'boolean') problems.push(`${id}: hidden must be a boolean`)
    if (typeof p.hiddenScore !== 'number') problems.push(`${id}: hiddenScore must be a number`)
    if (p.hidden === true && !(p.hiddenScore > 0)) problems.push(`${id}: hidden without a positive hiddenScore`)
    // optional fields, type-checked when present (omit-not-null contract)
    if ('amenities' in p && (!Array.isArray(p.amenities) || !p.amenities.length || p.amenities.some((a) => typeof a !== 'string')))
      problems.push(`${id}: amenities, when present, must be a non-empty string array`)
    if ('aliases' in p && (!Array.isArray(p.aliases) || p.aliases.length < 2 || p.aliases.some((a) => typeof a !== 'string')))
      problems.push(`${id}: aliases, when present, must be a string array of 2+ variant spellings`)
    for (const k of ['address', 'description', 'hours', 'url', 'phone', 'designation', 'operator', 'fee', 'wikidata']) {
      if (k in p && (typeof p[k] !== 'string' || !p[k])) problems.push(`${id}: ${k}, when present, must be a non-empty string`)
    }
    if ('isFree' in p && typeof p.isFree !== 'boolean') problems.push(`${id}: isFree, when present, must be boolean`)
  }
  assert.equal(problems.length, 0, `places schema problems (${problems.length}):\n  ${problems.slice(0, 12).join('\n  ')}`)

  // coverage + curation invariants (mirror the pipeline's benchmark block)
  const withHours = places.filter((p) => p.hours).length
  assert.ok(withHours >= 150, `places with hours ${withHours} below the 150 floor`)
  const withAmenities = places.filter((p) => p.amenities && p.amenities.length).length
  assert.ok(withAmenities >= 250, `places with amenities ${withAmenities} below the 250 floor`)
  const hidden = places.filter((p) => p.hidden === true).length
  assert.ok(hidden <= 24, `hidden shelf ${hidden} exceeds the cap of 24 — curation regressed`)

  // ROSTER BENCHMARKS on the artifact (review HARDENING: the pipeline's bench
  // lines are console-only — a generation regression must fail npm test too)
  for (const slug of ['honeymoon-island-state-park', 'caladesi-island-state-park', 'weedon-island-preserve', 'davis-islands-beach']) {
    assert.ok(keys.has('p|' + slug), `roster benchmark missing from generation: ${slug}`)
  }
  const fortDeSoto = places.filter((p) => p.key.startsWith('p|fort-de-soto') && p.classes.includes('park'))
  assert.equal(fortDeSoto.length, 1, `Fort De Soto must be exactly ONE park record (got: ${fortDeSoto.map((p) => p.key).join(', ') || 'none'})`)
  assert.ok(!keys.has('p|weedon-island-preserve-2'), 'Weedon Island split into two records — the o/e-typo merge regressed')

  // the finder copy and the app copy must be the same artifact (no drift)
  const FINDER_PLACES = path.join(ROOT, 'finder', 'output', 'places.json')
  assert.ok(existsSync(FINDER_PLACES), 'finder/output/places.json missing while the app copy exists')
  assert.equal(readFileSync(FINDER_PLACES, 'utf8'), readFileSync(APP_PLACES, 'utf8'),
    'finder/output/places.json and app/public/places.json drifted — re-run node finder/places.mjs')
})

// ============================================================
// 3+4) APP BUILD + LINT (started together, asserted separately)
// ============================================================
let buildP = null
let lintP = null
const startAppChecks = () => {
  buildP ??= runNpm('npm --prefix app run build')
  lintP ??= runNpm('npm --prefix app run lint')
}

test('app build: vite build exits 0', { timeout: 300_000 }, async (t) => {
  startAppChecks()
  const r = await buildP
  t.diagnostic(`vite build took ${r.secs}s`)
  assert.equal(r.code, 0, `app build failed (exit ${r.code}):\n${tail(r.out)}`)
})

test('app lint: eslint exits 0', { timeout: 300_000 }, async (t) => {
  startAppChecks()
  const r = await lintP
  t.diagnostic(`eslint took ${r.secs}s`)
  assert.equal(r.code, 0, `app lint failed (exit ${r.code}):\n${tail(r.out)}`)
})

// ============================================================
// 5) PURE-LOGIC UNITS — app/src modules imported straight into Node
//    (lib/taste/weekend are deliberately JSX-free; localStorage access is
//    guarded, so importing them here is supported by design)
// ============================================================
const lib = await import('../app/src/lib.js')
const weekend = await import('../app/src/weekend.js')
const taste = await import('../app/src/taste.js')

// tiny synthetic-event factory (normalized shape, only the fields the logic reads)
const ev = (over = {}) => ({
  title: 't',
  start: '2026-06-12',
  end: null,
  category: 'music',
  source: 'A',
  sources: ['A'],
  tags: [],
  hotScore: 50,
  buzz: 1,
  ...over,
})
const N = (raw, anchors) => lib.normalize(raw, anchors)
const AN = lib.makeAnchors(new Date(2026, 5, 10, 12, 0)) // Wed Jun 10 2026, noon

test('orderDay: count-preserving on 3 synthetic shapes + de-flood property', () => {
  // shape 1 — single-source flood (the library case): same family+category
  const flood = Array.from({ length: 30 }, (_, i) =>
    N(ev({ title: 'L' + i, source: 'Library (Br ' + i + ')', sources: ['Library (Br ' + i + ')'], category: 'community', hotScore: 60 - i }), AN)
  )
  // shape 2 — balanced mix: 5 families x 8, 4 categories
  const cats = ['music', 'food', 'art', 'sports']
  const mixed = []
  for (let f = 0; f < 5; f++)
    for (let i = 0; i < 8; i++)
      mixed.push(N(ev({ title: `F${f}-${i}`, source: 'Fam' + f, sources: ['Fam' + f], category: cats[(f + i) % 4], hotScore: 90 - i - f }), AN))
  // shape 3 — edges: empty / single / pair / missing hotScore + category
  const edges = [
    N(ev({ title: 'only', hotScore: null }), AN),
    N(ev({ title: 'nocat', category: '', hotScore: null }), AN),
  ]
  for (const items of [flood, mixed, edges, [], [edges[0]]]) {
    const out = lib.orderDay(items, null)
    assert.equal(out.length, items.length, `orderDay dropped/added items: ${items.length} in, ${out.length} out`)
    const inSet = new Set(items)
    assert.ok(out.every((x) => inSet.has(x)) && new Set(out).size === out.length,
      'orderDay must be a permutation of its input (never hide, never duplicate)')
  }
  // flood keeps score order (one bucket = nothing to interleave)
  const floodOut = lib.orderDay(flood, null)
  assert.deepEqual(floodOut.map((e) => e.title), flood.map((e) => e.title), 'single-bucket day must stay score-desc')
  // mixed: no run of 3 same-family WHILE ALTERNATIVES EXIST — the contract's
  // own caveat. At the tail, when every remaining item is one family, a run is
  // the documented tiered fallback, not a regression; track remaining families
  // through the walk so only avoidable runs fail.
  const famOut = lib.orderDay(mixed, null).map((e) => lib.sourceFamily(e))
  const remaining = new Map()
  for (const f of famOut) remaining.set(f, (remaining.get(f) || 0) + 1)
  for (let i = 0; i < famOut.length; i++) {
    const f = famOut[i]
    const runOf3 = i >= 2 && f === famOut[i - 1] && f === famOut[i - 2]
    const alternativeExisted = [...remaining.keys()].some((k) => k !== f && remaining.get(k) > 0)
    assert.ok(
      !(runOf3 && alternativeExisted),
      `avoidable family 3-run at ${i - 2}..${i} (${f}) — the de-flood constraint regressed`
    )
    remaining.set(f, remaining.get(f) - 1)
  }
})

test('tonightModel: future-first ordering, started sink, late-night fold-in', () => {
  const mk = (title, start, hot) => {
    const e = N(ev({ title, start, hotScore: hot }), AN)
    return { ...e, _clamp: Math.max(e._day, AN.todayTs) }
  }
  const up = [
    mk('started-hot', '2026-06-10T18:00:00', 95),
    mk('future-a', '2026-06-10T20:00:00', 50),
    mk('future-b', '2026-06-10T21:00:00', 80),
    mk('dateonly-today', '2026-06-10', 70),
    mk('tomorrow-early', '2026-06-11T19:00:00', 60),
    mk('tomorrow-late', '2026-06-11T23:00:00', 60),
  ]
  // 7 PM: futures lead hot-desc (date-only today is a future all-day plan),
  // started sinks below despite the highest hotScore, tomorrow excluded
  const m1 = lib.tonightModel(up, AN, new Date(2026, 5, 10, 19, 0))
  assert.deepEqual(
    m1.items.map((x) => x.e.title),
    ['future-b', 'dateonly-today', 'future-a', 'started-hot'],
    'tonight 7 PM ordering must be future hot-desc then started (never hidden)'
  )
  assert.equal(m1.futureN, 2, 'futureN counts TIMED not-yet-started events only')
  assert.equal(m1.late, false)
  // 22:30 with <3 timed futures: late mode folds in tomorrow 16–22h, withDate
  const m2 = lib.tonightModel(up, AN, new Date(2026, 5, 10, 22, 30))
  assert.equal(m2.late, true, 'late mode must trigger after 22:00 with < 3 timed futures')
  assert.deepEqual(
    m2.items.map((x) => x.e.title),
    ['dateonly-today', 'tomorrow-early', 'started-hot', 'future-b', 'future-a'],
    'late mode: tonight-future, then tomorrow early-evening, then started hot-desc'
  )
  const tm = m2.items.find((x) => x.e.title === 'tomorrow-early')
  assert.equal(tm.withDate, true, 'folded-in tomorrow events must carry withDate (date-labeled cards)')
  assert.ok(!m2.items.some((x) => x.e.title === 'tomorrow-late'), 'tomorrow 23:00 start is outside the 16–22h fold-in window')
})

test('daypartOf: boundary hours', () => {
  const at = (hhmm) => weekend.daypartOf({ start: `2026-06-12T${hhmm}:00` })
  assert.equal(weekend.daypartOf({ start: '2026-06-12' }), 'any', 'date-only events are "any" (both pickers)')
  assert.equal(at('04:59'), 'night', '04:59 is the tail of a night out')
  assert.equal(at('05:00'), 'day', '05:00 opens the day window')
  assert.equal(at('16:59'), 'day', '16:59 is still day')
  assert.equal(at('17:00'), 'night', '17:00 opens the night window')
  assert.equal(at('00:30'), 'night', '00:30 is night (small hours)')
})

test('tasteNudge: bounded 0..18, exact ceiling, neutral profile = 0', () => {
  const maxed = { catScores: { music: 25 }, freeAffinity: 25, n: 100, v: 1 }
  const free = N(ev({ isFree: true, tags: ['free'] }), AN)
  const ceiling = taste.tasteNudge(free, maxed)
  assert.equal(ceiling, 18, `maxed profile on a free on-category event must hit exactly 18 (got ${ceiling})`)
  assert.equal(taste.tasteNudge(free, { catScores: {}, freeAffinity: 0, n: 0, v: 1 }), 0, 'n=0 profile must nudge 0')
  // fuzz: random profiles/events never escape [0, 18]
  for (let i = 0; i < 200; i++) {
    const p = {
      catScores: { music: Math.random() * 40, food: Math.random() * 40 }, // even out-of-cap stored values
      freeAffinity: Math.random() * 40,
      n: Math.floor(Math.random() * 80),
      v: 1,
    }
    const e = N(ev({ category: Math.random() < 0.5 ? 'music' : 'food', isFree: Math.random() < 0.5 }), AN)
    const nud = taste.tasteNudge(e, p)
    assert.ok(nud >= 0 && nud <= 18, `tasteNudge ${nud} escaped [0,18] for p=${JSON.stringify(p)}`)
  }
})

// O1 lazy tab mounting — the boot-perf guard. The app can't DOM-render in
// this Node harness, so the assertion is structural: every non-boot tab's
// children must be gated on the nav visited-set (mount on first visit), and
// the set must seed with ONLY the boot tab. Boot therefore renders exactly
// one tab's tree — strictly less than the old eager three-tab boot.
test('O1 lazy mounting: non-Events tabs gate on visited, boot seeds one tab', () => {
  const appSrc = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  for (const id of ['map', 'calendar', 'profile']) {
    assert.ok(
      appSrc.includes(`visited.has('${id}') &&`),
      `App.jsx must gate the '${id}' tab's children on visited.has('${id}') — lazy mounting (O1) regressed`
    )
  }
  const navSrc = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  assert.ok(
    navSrc.includes('new Set([VIEWS[0].id])'),
    'nav.jsx must seed the visited set with the boot tab only — eager mounting crept back in'
  )
})

test('weekend window: Fri–Sun for 3 different start days', () => {
  const wd = (d) => new Date(d).getDay()
  // Wednesday → upcoming Fri 12 / Sat 13 / Sun 14
  const wed = lib.makeAnchors(new Date(2026, 5, 10))
  assert.deepEqual(weekend.weekendDays(wed).map(wd), [5, 6, 0], 'weekend days must be Fri/Sat/Sun')
  assert.equal(new Date(wed.wkStartTs).getDate(), 12, 'Wed Jun 10 → weekend starts Fri Jun 12')
  assert.equal(weekend.visibleWeekend(wed).length, 3, 'midweek: all 3 weekend days visible')
  // Saturday → the IN-PROGRESS weekend (Fri 13 was yesterday) — Fri column drops
  const sat = lib.makeAnchors(new Date(2026, 5, 13))
  assert.equal(new Date(sat.wkStartTs).getDate(), 12, 'Sat Jun 13 → weekend started Fri Jun 12')
  assert.deepEqual(weekend.visibleWeekend(sat).map((d) => d.id), ['sat', 'sun'], 'on Saturday the spent Friday drops')
  // Sunday → still the in-progress weekend, only Sunday remains
  const sun = lib.makeAnchors(new Date(2026, 5, 14))
  assert.equal(new Date(sun.wkStartTs).getDate(), 12, 'Sun Jun 14 → weekend started Fri Jun 12')
  assert.deepEqual(weekend.visibleWeekend(sun).map((d) => d.id), ['sun'], 'on Sunday only Sunday remains')
  // window math: a Saturday event is _weekend, a Monday event is not
  assert.equal(N(ev({ start: '2026-06-13' }), wed)._weekend, true, 'Saturday event must be _weekend')
  assert.equal(N(ev({ start: '2026-06-15' }), wed)._weekend, false, 'Monday event must not be _weekend')
})
