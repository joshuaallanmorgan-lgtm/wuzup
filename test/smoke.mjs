// test/smoke.mjs — the Sprint-M regression smoke harness. Run: npm test
// (root). node:test + node:assert ONLY — zero new dependencies.
//
// What runs, in order (see README-TEST.md for the one-page contract):
//   1. finder fast-mode  — spawns SKIP_RENDER=1 SKIP_EXTRA=1 node finder/finder.mjs,
//      asserts exit 0, parses the benchmark block, ✅-asserts every benchmark
//      that is meaningful without the skipped sources, schema-validates 20
//      random events from the fast output. The files the finder writes
//      (finder/output/<cityId>/events.json + events.md — D1 multi-tenant) are
//      backed up in memory first and ALWAYS restored (finally) — a test run
//      must never leave the app pointing at the small fast-mode dataset.
//   2. data invariants    — on the CURRENT full app/public/events.json, captured
//      at module load (i.e. before the finder run can touch it). "Ended" is
//      measured against its hash-bound artifact-manifest generation receipt;
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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// city-agnostic: the box + roster anchors come from the active city config, the
// place/category vocab from the canonical taxonomy (categories.js) — so a new city
// doesn't fail the build on hard-coded Tampa values.
import { bbox as CITY_BBOX, rosterBenchmark as CITY_ROSTER, cityId as CITY_ID } from '../finder/cities/index.mjs'
import { verifyArtifactSet } from '../finder/artifact-manifest.mjs'
import { fallbackReasonForStage, fuzzyMerge } from '../finder/finder.mjs'
import { eventTime } from '../shared/city-time.mjs'
import { PLACETYPE_HUE, CATEGORY_HUES } from '../app/src/categories.js'
import * as deckdeal from '../app/src/deckdeal.js'
import * as gesture from '../app/src/deckgesture.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_PUBLIC = path.join(ROOT, 'app', 'public')
const APP_EVENTS = path.join(APP_PUBLIC, 'events.json')
// D1 multi-tenant artifacts: the finder writes finder/output/<cityId>/…
const FINDER_JSON = path.join(ROOT, 'finder', 'output', CITY_ID, 'events.json')
const FINDER_MD = path.join(ROOT, 'finder', 'output', CITY_ID, 'events.md')
const FINDER_MANIFEST = path.join(ROOT, 'finder', 'output', CITY_ID, 'artifact-manifest.json')
const STATIC_SOURCE_NAMES = new Set(
  JSON.parse(readFileSync(path.join(ROOT, 'finder', 'cities', `${CITY_ID}.sources.json`), 'utf8'))
    .map((source) => source.name)
)

// ---------- capture the CURRENT full dataset BEFORE anything can mutate it ----------
assert.ok(existsSync(APP_EVENTS), `missing ${APP_EVENTS} — run "npm run refresh" first; the app has no data`)
const fullRaw = readFileSync(APP_EVENTS, 'utf8')
const fullEvents = JSON.parse(fullRaw)
// "Ended" must be judged against immutable generation provenance bound to
// these exact bytes. Freshness is intentionally not required here: this gate
// asks whether the artifact was honest when written, while stale-data UX and
// deployment gates own whether it is current enough to serve.
const fullArtifactVerification = verifyArtifactSet({
  root: APP_PUBLIC,
  expectedCityId: CITY_ID,
})
assert.ok(
  fullArtifactVerification.ok,
  `app/public artifact verification failed: ${fullArtifactVerification.problems.join(' · ')}`,
)
const fullManifest = fullArtifactVerification.manifest
const fullEventReceipt = fullManifest.artifacts.events
const fullTimeZone = fullManifest.timeZone
const generationMs = Date.parse(fullEventReceipt.generatedAt)
assert.ok(Number.isFinite(generationMs), `invalid events generatedAt '${fullEventReceipt.generatedAt}'`)

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

function staticAcquisitionUnavailable(sources, expectedNames) {
  if (!Array.isArray(sources) || !(expectedNames instanceof Set)) return false
  const receipts = sources.filter((source) => expectedNames.has(source?.name))
  if (receipts.length !== expectedNames.size) return false
  if (new Set(receipts.map((source) => source.name)).size !== expectedNames.size) return false
  return receipts.every((source) => source.cached === true && source.fallbackReason === 'live-error')
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
  // D-G2 stable ids: 16-hex sha256 prefix, minted at finder emit. Absent on a
  // pre-id deployed dataset (the field arrives via deploy-city); when present
  // it must be well-formed. The all-or-nothing + uniqueness pins live in the
  // dataset-level tests (a per-event validator can't see its siblings).
  if (e.id !== undefined && (typeof e.id !== 'string' || !/^[0-9a-f]{16}$/.test(e.id)))
    p.push(`${id}: id must be a 16-hex stable event id (got ${JSON.stringify(e.id)})`)
  return p
}

// ============================================================
// 1) FINDER FAST-MODE — the long pole, so it runs first
// ============================================================
// SF-data REFUTE gap: fast mode runs with SKIP_EXTRA=1, so the per-city module
// LOADER is never exercised by npm test — a vanished finder/sources/<cityId>/
// dir would pass green (the loud-zero warn is console-only). Pin existence +
// the expected roster so the miss is a test failure, not a silent data hole.
test('per-city source-module dirs exist with their full rosters', () => {
  const tampaDir = path.join(ROOT, 'finder', 'sources', 'tampa-bay')
  const sfDir = path.join(ROOT, 'finder', 'sources', 'sf-east-bay')
  assert.ok(existsSync(tampaDir), 'finder/sources/tampa-bay/ must exist (the 12 Tampa modules live there since the isolation fix)')
  const tampaMods = readdirSync(tampaDir).filter((f) => f.endsWith('.mjs'))
  assert.equal(tampaMods.length, 12, `tampa-bay must hold its 12 source modules (found ${tampaMods.length}: ${tampaMods.join(', ')})`)
  assert.ok(existsSync(sfDir), 'finder/sources/sf-east-bay/ must exist')
  const sfMods = readdirSync(sfDir).filter((f) => f.endsWith('.mjs'))
  assert.equal(sfMods.length, 5, `sf-east-bay must hold its 5 source modules (found ${sfMods.length}: ${sfMods.join(', ')})`)
  // the shared helpers stay at the parent (never inside a city dir)
  assert.ok(existsSync(path.join(ROOT, 'finder', 'sources', '_shared.mjs')), '_shared.mjs stays at finder/sources/ root')
})

test('finder fuzzy merge: cross-family consensus is deterministic', () => {
  const fixture = [
    {
      title: 'Fixture Community Concert',
      start: '2030-07-18T19:00:00-04:00',
      venue: 'Fixture Hall',
      source: 'Eventbrite (Tampa)',
    },
    {
      title: 'Fixture Community Concert',
      start: '2030-07-18T19:00:00-04:00',
      venue: 'Fixture Hall',
      source: 'Eventbrite (Free)',
    },
    {
      title: 'Fixture Community Concert',
      start: '2030-07-18T19:00:00-04:00',
      venue: 'Fixture Hall',
      source: 'City of Tampa',
    },
    {
      title: 'Fixture Community Concert',
      start: '2030-07-18T19:00:00-04:00',
      venue: 'Unrelated Pavilion',
      source: 'I Love the Burg',
    },
  ]

  const merged = fuzzyMerge(fixture)
  assert.equal(merged.length, 2, 'same-title events at unrelated venues must remain separate')
  const consensus = merged.find((e) => e.venue === 'Fixture Hall')
  const separate = merged.find((e) => e.venue === 'Unrelated Pavilion')
  assert.ok(consensus && separate, 'fixture must preserve both venue identities')
  assert.equal(consensus.sources.length, 3, 'same-family variants remain attributed after collapsing')
  assert.equal(consensus.buzz, 2, 'buzz counts Eventbrite once plus the independent city source')
  assert.equal(separate.buzz, 1, 'an unrelated-venue listing remains a one-family event')
})

test('finder source fallback causes fail closed outside transport acquisition', () => {
  assert.equal(fallbackReasonForStage('live-fetch'), 'live-error')
  assert.equal(fallbackReasonForStage('source-adapter'), 'source-error')
  assert.equal(fallbackReasonForStage('processing'), 'processing-error')
  assert.throws(() => fallbackReasonForStage('cache-write'), /unknown source stage/)

  const expected = new Set(['A', 'B'])
  const transportFailures = [
    { name: 'A', cached: true, fallbackReason: 'live-error' },
    { name: 'B', cached: true, fallbackReason: 'live-error' },
  ]
  assert.equal(staticAcquisitionUnavailable(transportFailures, expected), true)
  assert.equal(staticAcquisitionUnavailable([
    transportFailures[0],
    { name: 'B', cached: true, fallbackReason: 'processing-error' },
  ], expected), false, 'post-fetch processing errors must keep the count floor active')
  assert.equal(staticAcquisitionUnavailable([
    transportFailures[0],
    { name: 'B', cached: true, fallbackReason: 'live-empty' },
  ], expected), false, 'parse-zero fallbacks must keep the count floor active')
  assert.equal(staticAcquisitionUnavailable([transportFailures[0]], expected), false, 'missing receipts fail closed')
})

test('full city artifacts: unclassified category share stays under 8%', () => {
  for (const cityId of ['tampa-bay', 'sf-east-bay']) {
    const file = path.join(ROOT, 'finder', 'output', cityId, 'events.json')
    const events = JSON.parse(readFileSync(file, 'utf8'))
    const other = events.filter((e) => e.category === 'other').length
    const share = events.length ? other / events.length : 1
    assert.ok(share <= 0.08, `${cityId} 'other' share ${(share * 100).toFixed(2)}% (${other}/${events.length}) exceeds 8%`)
  }
})

test('finder fast-mode: exit 0, benchmarks green, output schema-valid', { timeout: 360_000 }, async (t) => {
  // in-memory backup of everything the finder overwrites — INCLUDING the
  // committed source caches (Cohesion REFUTE finding: the fast-mode run
  // refreshes cache TTL/ordering fields, so a green `npm test` used to leave
  // a dirty tree and contributors smuggled cache churn into commits).
  // D1: caches are per-city dirs (finder/cache/<cityId>/…) — walk recursively so
  // every city's committed caches are protected, not just a flat top level.
  const cacheDir = path.join(ROOT, 'finder', 'cache')
  const walkJson = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name)
    return d.isDirectory() ? walkJson(p) : d.name.endsWith('.json') ? [p] : []
  })
  const cacheFiles = existsSync(cacheDir) ? walkJson(cacheDir) : []
  const backups = [APP_EVENTS, FINDER_JSON, FINDER_MD, FINDER_MANIFEST, ...cacheFiles]
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
    const otherLine = res.out.split(/\r?\n/).find((l) => l.includes("'other' category:"))
    assert.ok(otherLine, "'other' benchmark line missing from finder output")
    t.diagnostic(`fast-mode source-mix diagnostic: ${otherLine.trim()} (full artifacts are ratio-gated)`)
    // Live overlap is a corpus/source-health diagnostic, not a deterministic
    // merge contract: two healthy source sets may simply have no currently
    // overlapping future listings. The pure fixture above pins the mechanism.
    const buzzLine = res.out.split(/\r?\n/).find((l) => l.includes('events with buzz >= 2:'))
    assert.ok(buzzLine, 'buzz >= 2 benchmark line missing from finder output')
    const buzzN = Number(buzzLine.match(/buzz >= 2:\s*(\d+)/)?.[1])
    t.diagnostic(`fast-mode cross-family overlaps: ${buzzN} (corpus diagnostic; merge behavior is fixture-tested)`)
    // sponsored is render-sourced: fast mode prints the ⚠️ offline variant
    assert.ok(
      res.out.includes('sponsored (promoted) cltampa events'),
      'sponsored benchmark line missing (⚠️ render-offline variant expected in fast mode)'
    )
    const totalLine = res.out.split(/\r?\n/).find((l) => l.includes('TOTAL upcoming events:'))
    assert.ok(totalLine, 'TOTAL upcoming events line missing from finder output')
    const totalN = Number(totalLine.match(/TOTAL upcoming events:\s*(\d+)/)?.[1])
    const runManifest = JSON.parse(readFileSync(FINDER_MANIFEST, 'utf8'))
    const sourceReceiptSummary = runManifest.sourceHealth.sources
      .map((source) => `${source.name}=${source.status}/${source.rows}${source.cached ? `/cached/${source.fallbackReason || 'unknown'}` : ''}`)
      .join(', ')
    const sourceAcquisitionSummary = res.out.split(/\r?\n/)
      .filter((line) => line.includes('cached — live'))
      .map((line) => line.trim())
      .join(' | ')
    const staticReceipts = runManifest.sourceHealth.sources
      .filter((source) => STATIC_SOURCE_NAMES.has(source.name))
    assert.equal(
      staticReceipts.length,
      STATIC_SOURCE_NAMES.size,
      `fast-mode manifest is missing static source receipts; got: ${sourceReceiptSummary}`
    )
    assert.equal(
      new Set(staticReceipts.map((source) => source.name)).size,
      STATIC_SOURCE_NAMES.size,
      `fast-mode manifest has duplicate static source receipts; got: ${sourceReceiptSummary}`
    )
    const acquisitionUnavailable = staticAcquisitionUnavailable(
      runManifest.sourceHealth.sources,
      STATIC_SOURCE_NAMES
    )
    if (!acquisitionUnavailable) {
      assert.ok(
        totalN >= 150,
        `fast-mode static sources produced only ${totalN} events (expect ~250; >= 150 floor) — sources or caches are failing; receipts: ${sourceReceiptSummary}; acquisitions: ${sourceAcquisitionSummary}`
      )
    } else {
      t.diagnostic(`LIVE ACQUISITION UNAVAILABLE — all ${staticReceipts.length} static sources used cache after errors; gating the source-count floor (got ${totalN}, expect ~250 from a live pull)`)
    }
    t.diagnostic(`fast-mode events: ${totalN}, buzz>=2: ${buzzN}`)

    // --- fast output exists and schema-validates: 20 random spot checks ---
    const fast = JSON.parse(readFileSync(FINDER_JSON, 'utf8'))
    assert.ok(Array.isArray(fast) && fast.length > 0, `finder/output/${CITY_ID}/events.json is not a non-empty array`)
    const fastReceipt = runManifest.artifacts.events
    const fastGenerationMs = Date.parse(fastReceipt.generatedAt)
    assert.ok(Number.isFinite(fastGenerationMs), `fast manifest has invalid generatedAt '${fastReceipt.generatedAt}'`)
    assert.equal(runManifest.generatedAt, fastReceipt.generatedAt, 'manifest generation aliases must agree')
    assert.equal(fastReceipt.count, fast.length, 'fast manifest count must bind the emitted events array')

    const fastCanonical = fast.map((event) => ({
      event,
      time: eventTime(event, { timeZone: runManifest.timeZone }),
    }))
    const fastInvalid = fastCanonical.filter(({ time }) => !time.ok)
    assert.equal(
      fastInvalid.length,
      0,
      `fresh finder output contains invalid event times: ${fastInvalid.slice(0, 5)
        .map(({ event, time }) => `${event.id} "${event.title}" start=${event.start} end=${event.end} (${time.error})`)
        .join('; ')}`,
    )
    const fastEnded = fastCanonical.filter(({ time }) => time.ok && time.endAt <= fastGenerationMs)
    assert.equal(
      fastEnded.length,
      0,
      `fresh finder output contains events ended at generation: ${fastEnded.slice(0, 5)
        .map(({ event, time }) => `${event.id} "${event.title}" endAt=${new Date(time.endAt).toISOString()}`)
        .join('; ')}`,
    )

    const picked = []
    const count = Math.min(20, fast.length)
    // deterministic, evenly-spaced spot-check indices (was Math.random — flaky: a
    // green run could miss a malformed event a later run happens to catch)
    for (let n = 0; n < count; n++) picked.push(Math.floor(((n + 0.5) * fast.length) / count))
    t.diagnostic(`schema spot-check indexes: ${picked.join(',')}`)
    const problems = picked.flatMap((i) => schemaProblems(fast[i], i))
    assert.equal(problems.length, 0, `fast-mode output schema problems:\n  ${problems.join('\n  ')}`)

    // --- D-G2: EVERY freshly-emitted event carries a stable id, unique across
    // the run — pins the minting LIVE at the emit choke point (the committed-
    // artifact pins can't catch a regression that only bites fresh runs) ---
    const badIds = fast.filter((e) => typeof e.id !== 'string' || !/^[0-9a-f]{16}$/.test(e.id))
    assert.equal(
      badIds.length,
      0,
      `${badIds.length} fast-mode events without a valid stable id: ` +
        badIds.slice(0, 3).map((e) => `"${e.title}" id=${JSON.stringify(e.id)}`).join('; ')
    )
    assert.equal(
      new Set(fast.map((e) => e.id)).size,
      fast.length,
      'fast-mode stable ids must be unique — the collision tiebreaks + truncated-hash check exist for exactly this'
    )
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
test(`data invariants: full events.json (${fullEvents.length} events)`, (t) => {
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

  // Zero valid rows ended AS OF the exact artifact's immutable generation
  // time. Invalid legacy rows are explicit debt, not silently counted as
  // ended; exact equality forces this ratchet to shrink when data is healed
  // and rejects every new invalid row.
  const fullCanonical = fullEvents.map((event) => ({
    event,
    time: eventTime(event, { timeZone: fullTimeZone }),
  }))
  const invalidDebt = fullCanonical
    .filter(({ time }) => !time.ok)
    .map(({ event, time }) => `${event.id}:${time.error}`)
    .sort()
  const expectedInvalidDebt = CITY_ID === 'tampa-bay'
    ? [
        '8be54b345ccd237e:end-before-start',
        'ea7a370fe7fb7a46:end-before-start',
      ].sort()
    : []
  assert.deepEqual(
    invalidDebt,
    expectedInvalidDebt,
    `invalid event-time debt changed: ${invalidDebt.join(', ') || 'none'}`,
  )

  const ended = fullCanonical.filter(({ time }) => time.ok && time.endAt <= generationMs)
  assert.equal(
    ended.length,
    0,
    `events already ended at generation time (${new Date(generationMs).toISOString()}, hash-bound manifest): ` +
      ended.slice(0, 5).map(({ event, time }) =>
        `${event.id} "${event.title}" start=${event.start} end=${event.end} endAt=${new Date(time.endAt).toISOString()}`,
      ).join('; '),
  )

  // sponsored: the field exists (boolean) on EVERY event — labels can only
  // render if the data carries the flag (never-unlabeled invariant)
  const badSp = fullEvents.filter((e) => typeof e.sponsored !== 'boolean')
  assert.equal(badSp.length, 0, `${badSp.length} events without a boolean sponsored field — labeling invariant at risk`)

  // hidden gems: curated shelf stays capped
  const gems = fullEvents.filter((e) => Array.isArray(e.tags) && e.tags.includes('hidden-gem')).length
  assert.ok(gems <= 24, `hidden-gem count ${gems} exceeds the cap of 24 — gem curation regressed`)

  // D-G2: stable ids are all-or-nothing per dataset (mixed presence means a
  // splice of pre- and post-id artifact generations — corruption, not a
  // transition state) and unique when present. Format is schema-validated.
  const withId = fullEvents.filter((e) => e.id !== undefined)
  assert.ok(
    withId.length === 0 || withId.length === fullEvents.length,
    `stable ids are MIXED: ${withId.length}/${fullEvents.length} events carry an id — the dataset splices two artifact generations`
  )
  if (withId.length) {
    assert.equal(new Set(withId.map((e) => e.id)).size, fullEvents.length, 'stable ids must be unique within the dataset')
  }

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
const TB_BOX = CITY_BBOX // active city's sanity box (cities/)
const PLACE_CATEGORIES = new Set(Object.keys(CATEGORY_HUES)) // canonical event-category vocab
const PLACE_TYPES = new Set(Object.keys(PLACETYPE_HUE))      // canonical placeType vocab

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
    for (const k of ['address', 'description', 'hours', 'url', 'phone', 'designation', 'operator', 'fee', 'wikidata', 'image']) {
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
  // the roster is the ACTIVE city's generation anchors (Tampa's live in
  // finder/cities/tampa-bay.mjs). A city with no roster skips them — it brings
  // its own once its sources land.
  if (CITY_ROSTER.length) {
    for (const slug of CITY_ROSTER) {
      assert.ok(keys.has('p|' + slug), `roster benchmark missing from generation: ${slug}`)
    }
  }
  // the two Tampa-LITERAL merge guards are pinned regressions of Tampa's own
  // generation (Fort De Soto dupe-record class, the Weedon o/e-typo split) —
  // scoped to the tampa-bay config id so a rostered city #2 passes npm test
  // without inheriting another city's place names (Stage D D2).
  if (CITY_ID === 'tampa-bay') {
    const fortDeSoto = places.filter((p) => p.key.startsWith('p|fort-de-soto') && p.classes.includes('park'))
    assert.equal(fortDeSoto.length, 1, `Fort De Soto must be exactly ONE park record (got: ${fortDeSoto.map((p) => p.key).join(', ') || 'none'})`)
    assert.ok(!keys.has('p|weedon-island-preserve-2'), 'Weedon Island split into two records — the o/e-typo merge regressed')
  }

  // the finder copy and the app copy must be the same artifact (no drift).
  // D1: the finder copy lives at finder/output/<cityId>/.
  const FINDER_PLACES = path.join(ROOT, 'finder', 'output', CITY_ID, 'places.json')
  assert.ok(existsSync(FINDER_PLACES), `finder/output/${CITY_ID}/places.json missing while the app copy exists`)
  assert.equal(readFileSync(FINDER_PLACES, 'utf8'), readFileSync(APP_PLACES, 'utf8'),
    `finder/output/${CITY_ID}/places.json and app/public/places.json drifted — re-run node finder/places.mjs`)
})

// Phase 3.5 W4 — HONEST IMAGES. A place photo is ONLY ever a verified photo OF
// THAT place (Wikidata P18 → Wikimedia Commons), never a representative
// stand-in; places without a curated photo keep category-art. These invariants
// lock that contract on the real artifact.
test('W4/Phase1 images: place photos are real of-the-place Commons files + every one CREDITED', () => {
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const places = doc.places
  const imaged = places.filter((p) => p.image)
  // a meaningful number resolved. The honest-imagery Phase-1 geosearch ladder lifts
  // this well past the ~65 Q-id places (real of-the-place photos on coords+name-match),
  // so the old "never more than the Q-id set" cap is RETIRED — geosearch legitimately
  // images non-Q-id places. The honesty guard is now name-match (pipeline) + credit.
  assert.ok(imaged.length >= 20, `only ${imaged.length} places imaged — the image pipeline likely regressed`)
  for (const p of imaged) {
    // every image is either a real Wikimedia Commons file (P18 / P373 / geosearch all
    // resolve to upload.wikimedia.org/.../commons/) OR a self-hosted, sign-verified
    // Mapillary cafe crop at /place-img/<slug>.jpg (ladder 3). NO generic stock, no
    // hotlink to a third-party host.
    const isCommons = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(p.image)
    const isLocalCafe = /^\/place-img\/[a-z0-9-]+\.jpg$/.test(p.image)
    assert.ok(isCommons || isLocalCafe, `${p.name}: image is neither a Commons URL nor a /place-img/ local path (${p.image})`)
    // CREDIT-REQUIRED: every shipped photo carries an inline credit (license; author
    // when the license is CC-BY/BY-SA) — the legal duty + the honesty record.
    assert.ok(p.imageCredit && p.imageCredit.license, `${p.name}: has an image but no credit (license) — the credit gate must hold on every source`)
    if (/^\s*cc\s*by/i.test(p.imageCredit.license)) {
      assert.ok(p.imageCredit.author, `${p.name}: a CC-BY image must carry an author byline`)
    }
  }
})

// honest-imagery ladder 3 — Mapillary sign-verified cafe storefronts. Every place
// imaged via a self-hosted /place-img/ crop must: (a) have the local JPEG on disk,
// (b) carry a CC-BY-SA credit with an author + sourceFamily 'mapillary-sign', and
// (c) have a matching `Mapillary:<id>` ledger entry with a NON-EMPTY signTextRead
// (the honesty receipt — the storefront sign text the vision pass actually read).
test('ladder-3 Mapillary cafes: local file + CC-BY-SA credit + signTextRead receipt', () => {
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const cafes = doc.places.filter((p) => typeof p.image === 'string' && p.image.startsWith('/place-img/'))
  const ATTRIB = path.join(ROOT, 'finder', 'cache', CITY_ID, 'attributions.json') // D1: per-city ledger
  const attrib = existsSync(ATTRIB) ? JSON.parse(readFileSync(ATTRIB, 'utf8')) : { byFile: {} }
  for (const p of cafes) {
    const slug = p.image.replace(/^\/place-img\//, '').replace(/\.jpg$/, '')
    assert.match(slug, /^[a-z0-9-]+$/, `${p.name}: unsafe /place-img slug (${p.image})`)
    // (a) the self-hosted JPEG actually exists (enrich self-heals if it doesn't)
    // — BOTH copies: the deployed file the app serves AND the per-city artifact
    // deploy.mjs copies from (D1: the artifact set is the source of truth)
    assert.ok(existsSync(path.join(ROOT, 'app', 'public', 'place-img', `${slug}.jpg`)),
      `${p.name}: /place-img/${slug}.jpg referenced but the deployed file is missing`)
    assert.ok(existsSync(path.join(ROOT, 'finder', 'output', CITY_ID, 'place-img', `${slug}.jpg`)),
      `${p.name}: finder/output/${CITY_ID}/place-img/${slug}.jpg missing — the per-city artifact set drifted from the deployment`)
    // (b) a satisfiable CC-BY-SA credit with an author byline + the source marker
    assert.ok(p.imageCredit && p.imageCredit.license, `${p.name}: Mapillary image without a credit`)
    assert.match(p.imageCredit.license, /cc\s*by/i, `${p.name}: Mapillary credit must be a CC-BY(-SA) license`)
    assert.ok(p.imageCredit.author, `${p.name}: Mapillary (CC-BY-SA) image must carry an author byline`)
    assert.equal(p.imageCredit.sourceFamily, 'mapillary-sign', `${p.name}: Mapillary credit must mark sourceFamily 'mapillary-sign'`)
    // (c) the ledger entry keyed by Mapillary:<id> carries the signTextRead receipt
    const id = (p.imageCredit.url.match(/pKey=(\d+)/) || [])[1]
    assert.ok(id, `${p.name}: Mapillary credit url has no pKey (${p.imageCredit.url})`)
    const led = attrib.byFile[`Mapillary:${id}`]
    assert.ok(led, `${p.name}: no attributions ledger entry for Mapillary:${id}`)
    assert.ok(led.signTextRead && String(led.signTextRead).trim().length > 0,
      `${p.name}: Mapillary ledger entry must carry a non-empty signTextRead receipt`)
  }
  // every Mapillary ledger entry (even if a place dropped) must keep the receipt shape
  for (const [k, v] of Object.entries(attrib.byFile)) {
    if (k.startsWith('Mapillary:')) {
      assert.equal(v.sourceFamily, 'mapillary-sign', `${k}: ledger sourceFamily must be 'mapillary-sign'`)
      assert.ok(v.signTextRead && String(v.signTextRead).trim().length > 0, `${k}: ledger entry missing signTextRead`)
    }
  }
})

// FAIL-CLOSED honesty lock (multi-city): every SHIPPED Mapillary cafe must carry its
// re-judge guard verdict (reVerified: true). The Stage-B guard fails closed — a crop
// with no re-judge signal can't ship — and this asserts that promise survives to the
// committed cache, so a skipped re-judge can never silently re-open the pylon /
// dominant-subject guards (the failure mode behind the 4 Tampa false positives).
test('fail-closed: every shipped Mapillary cafe was re-verified', () => {
  const MAP_CACHE = path.join(ROOT, 'finder', 'cache', CITY_ID, 'place-mapillary-images.json') // D1: per-city
  if (!existsSync(MAP_CACHE)) return // no cafe cache yet (a city before its imagery run)
  const cache = JSON.parse(readFileSync(MAP_CACHE, 'utf8'))
  const entries = Object.entries(cache.byKey || {})
  for (const [key, e] of entries) {
    assert.equal(e.reVerified, true, `${key}: shipped Mapillary cafe lacks its re-judge guard verdict (reVerified !== true) — fail-closed violated`)
  }
  // and every /place-img/ place in the data must have such a (re-verified) cache entry
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  for (const p of doc.places.filter((x) => typeof x.image === 'string' && x.image.startsWith('/place-img/'))) {
    const e = cache.byKey[p.key]
    assert.ok(e && e.reVerified === true, `${p.name}: imaged from Mapillary but no re-verified cache entry`)
  }
})

// Stage D · D1 — the deploy seam. app/public data artifacts are written ONLY by
// finder/deploy.mjs (`npm run deploy-city`), which copies exactly ONE city's set
// from finder/output/<cityId>/. Guards: the deploy step exists, an incomplete
// artifact set is refused LOUDLY, a COMPLETE set deploys whole (proven against a
// scratch DEST — sf-east-bay's set is real now, and a live deploy of it here
// would blank Tampa's deployment mid-test), and the legacy un-namespaced output
// paths stay dead.
test('D1 deploy seam: deploy.mjs exists + refuses an incomplete set + scratch-deploys a complete one + legacy paths gone', { timeout: 60_000 }, async () => {
  assert.ok(existsSync(path.join(ROOT, 'finder', 'deploy.mjs')), 'finder/deploy.mjs must exist (the ONE writer of app/public data artifacts)')
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['deploy-city'], 'node finder/deploy.mjs', 'the deploy-city npm script must run the deploy step')
  const guidesBefore = readFileSync(path.join(ROOT, 'app', 'public', 'guides.json'))
  const scratch = mkdtempSync(path.join(tmpdir(), 'wuzup-deploy-seam-'))
  try {
    // (a) REFUSAL: a city with no artifacts must be refused loudly, touching
    // nothing. Stage D sf-app: BOTH registered cities carry complete sets now,
    // so the probe rides the DEPLOY_SRC verification seam — an empty scratch
    // root IS "no artifacts", same checks, same code path, same loud exit.
    const emptyRoot = path.join(scratch, 'empty-output')
    mkdirSync(emptyRoot, { recursive: true })
    const res = await runNode('finder/deploy.mjs', { CITY: 'sf-east-bay', DEPLOY_SRC: emptyRoot })
    assert.notEqual(res.code, 0, `deploying a city with no artifacts must exit non-zero (got ${res.code}):\n${tail(res.out)}`)
    assert.match(res.out, /REFUSING/, 'the refusal must be loud and name the problem')
    assert.deepEqual(readFileSync(path.join(ROOT, 'app', 'public', 'guides.json')), guidesBefore,
      'a refused deploy must leave the deployed artifacts untouched')
    // (b) SUCCESS: sf-east-bay's real artifact set deploys whole into a scratch
    // DEST — JSON lands byte-identical, the pre-imagery .gitkeep git seed never
    // ships, and the REAL deployment (app/public = Tampa) still hasn't moved.
    const dest = path.join(scratch, 'dest')
    mkdirSync(dest, { recursive: true })
    const ok = await runNode('finder/deploy.mjs', { CITY: 'sf-east-bay', DEPLOY_DEST: dest })
    assert.equal(ok.code, 0, `deploying a complete artifact set must exit 0 (got ${ok.code}):\n${tail(ok.out)}`)
    for (const f of ['events.json', 'places.json', 'guides.json']) {
      assert.equal(readFileSync(path.join(dest, f), 'utf8'), readFileSync(path.join(ROOT, 'finder', 'output', 'sf-east-bay', f), 'utf8'),
        `${f} must land byte-identical in the scratch deploy`)
    }
    assert.ok(existsSync(path.join(dest, 'place-img')) && statSync(path.join(dest, 'place-img')).isDirectory(),
      'the scratch deploy must create place-img/')
    assert.ok(!existsSync(path.join(dest, 'place-img', '.gitkeep')),
      'the .gitkeep empty-dir git seed must never ship into a deployment')
    assert.deepEqual(readFileSync(path.join(ROOT, 'app', 'public', 'guides.json')), guidesBefore,
      'a scratch-DEST deploy must leave the real deployment untouched')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  // the legacy un-namespaced output files must not exist (and no writer recreates
  // them — the finder fast-mode run in test 1 would have, if a write path survived)
  for (const f of ['events.json', 'events.md', 'places.json', 'places.md', 'guides.json', 'place-img']) {
    assert.ok(!existsSync(path.join(ROOT, 'finder', 'output', f)), `legacy un-namespaced finder/output/${f} must not exist (outputs are per-city now)`)
  }
  // the per-city artifact set is COMPLETE for BOTH registered cities (deploy's
  // contract — Stage D sf-app: sf-east-bay is deployable from this commit on)
  for (const city of ['tampa-bay', 'sf-east-bay']) {
    for (const f of ['events.json', 'places.json', 'guides.json', 'artifact-manifest.json', 'place-img']) {
      assert.ok(existsSync(path.join(ROOT, 'finder', 'output', city, f)), `finder/output/${city}/${f} missing — the deployable set is incomplete`)
    }
  }
})

// D1 — the app/public write monopoly. deploy.mjs is the ONLY finder module that
// may construct an app/public path: the finder writing the app directly is exactly
// how a CITY=<other> run damaged the deployed city (stageb's rmSync of
// app/public/place-img was THE Tampa-deleting hazard). Source-grep over every
// finder .mjs/.js (output/ + cache/ data dirs skipped): no quoted 'app','public'
// join and no 'app/public' string literal outside deploy.mjs.
test('D1: only deploy.mjs constructs an app/public path', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (['output', 'cache', 'node_modules'].includes(d.name)) return []
    const p = path.join(dir, d.name)
    return d.isDirectory() ? walk(p) : /\.(mjs|js)$/.test(d.name) ? [p] : []
  })
  const offenders = []
  for (const f of walk(path.join(ROOT, 'finder'))) {
    if (path.basename(f) === 'deploy.mjs') continue
    const src = readFileSync(f, 'utf8')
    if (/['"`]app['"`]\s*,\s*['"`]public['"`]/.test(src) || /['"`]app\/public/.test(src)) offenders.push(path.relative(ROOT, f))
  }
  assert.deepEqual(offenders, [],
    `finder module(s) construct an app/public path — only finder/deploy.mjs may touch the deployed artifacts: ${offenders.join(', ')}`)
})

// W4 wiring — the two heroes are real photos, the place detail renders its photo
// with a category-art fallback, dead URLs never paint a broken glyph, and
// normalizePlace carries `image` through (JSX/CSS can't import into Node).
test('W4 wiring: real heroes + place-detail photo + degrade-to-art + passthrough', async () => {
  // both city heroes are real https photos (Events skyline + Spots waterfront).
  // Stage D4: the CITY object (heroes + credits) moved lib.js → city.js — these
  // source-text pins follow the object; lib.js re-exports CITY so importers held.
  const cityCfg = readFileSync(path.join(ROOT, 'app', 'src', 'city.js'), 'utf8')
  assert.match(cityCfg, /hero:\s*'https:\/\/upload\.wikimedia\.org\//, 'CITY.hero must be a real Commons photo')
  assert.match(cityCfg, /spotsHero:\s*'https:\/\/upload\.wikimedia\.org\//, 'CITY.spotsHero must be a real Commons photo (not a CSS placeholder)')
  // 3.7P-6: hero art is also an array (swipe-ready) — every entry a real Commons
  // photo WITH a recorded license (for the ⚑X3 attribution page).
  assert.match(cityCfg, /heroes:\s*\[/, 'CITY.heroes[] must exist (3.7P-6 swipe-ready hero array)')
  assert.match(cityCfg, /url:\s*'https:\/\/upload\.wikimedia\.org\//, 'CITY.heroes entries must carry a real Commons url')
  assert.match(cityCfg, /license:\s*'(CC |Public domain)/, 'CITY.heroes entries must record a license for the attribution page')
  // Stage R: the Spots tab now uses a CLEAN light header + a search bar (the
  // cinematic image hero was removed to match the benchmark). The Spots hero
  // PHOTO data (CITY.spotsHero) stays in city.js for the attribution page (asserted
  // above); it is simply no longer rendered as a Spots hero.
  const loc = readFileSync(path.join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  assert.match(loc, /loc-head-title/, 'LocationsView uses the clean light header (Stage R: no image hero)')
  // Stage 2 Tier 3: the .loc-search markup moved into the shared <SearchBarButton>
  assert.match(loc, /<SearchBarButton[^>]*onClick=\{openSearch\}/, 'LocationsView surfaces a search bar (shared SearchBarButton) into the global SearchPage')
  // PlaceDetail shows the photo as a hero, gated on heroArt (real photo vs art)
  const pd = readFileSync(path.join(ROOT, 'app', 'src', 'PlaceDetail.jsx'), 'utf8')
  assert.match(pd, /detail-hero-img/, 'PlaceDetail must use the image hero treatment (detail-hero-img)')
  assert.match(pd, /heroArt/, 'PlaceDetail must gate the hero on heroArt (real photo vs category-art fallback)')
  // W4 trust contract: a dead image URL degrades to category-art / placeholder,
  // never the browser broken-image glyph — CardImg + the deck place face wire onError
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.match(cards, /onError/, 'CardImg must handle onError so a dead image degrades to category-art, not a broken glyph')
  // (the old DayFillDeck place-face onError assert died with the component — C5;
  // every surviving deck face renders through CardImg, guarded above)
  // normalizePlace must carry image through (it spreads ...raw — this is a guard).
  // Local import so this test also runs in isolation (--test-name-pattern).
  const placesLocal = await import('../app/src/places.js')
  const place = placesLocal.normalizePlace({ key: 'p|x', name: 'X', lat: 28, lng: -82, image: 'https://upload.wikimedia.org/wikipedia/commons/x.jpg' })
  assert.equal(place.image, 'https://upload.wikimedia.org/wikipedia/commons/x.jpg', 'normalizePlace must pass the image field through to the card/detail seams')
})

// D4 — the app-side city seam (Stage D, D-DEP: one deployment per city, city
// chosen at BUILD time via VITE_CITY). Pins the extraction so it can't drift:
// city.js is THE config, lib.js re-exports it, the app config mirrors the
// finder config's identity WITHOUT importing it (this test IS the sync), the
// hero credits survived the move, and the de-Tampa'd literals stay de-Tampa'd.
test('D4 city seam: city.js config + lib re-export + finder mirror + no stray Tampa/locale/wx literals', async () => {
  // 1. city.js exists and resolves the reference city by default
  const cityMod = await import('../app/src/city.js')
  const libMod = await import('../app/src/lib.js')
  assert.equal(cityMod.CITY.id, 'tampa-bay', 'default (no VITE_CITY) build must resolve the tampa-bay reference config')
  // 2. lib.js re-exports the SAME object — importers and the seam can't fork
  assert.equal(libMod.CITY, cityMod.CITY, 'lib.js must re-export city.js CITY (same object, not a copy)')
  assert.equal(libMod.fmtLocale, cityMod.CITY.locale, 'fmtLocale must BE the config locale')
  // 3. EVERY app registry entry mirrors ITS finder config identity + heroes
  //    (no cross-layer import — the app stays finder-free; this assertion is
  //    the only tie). Stage D sf-app: iterates the full registry, so a second
  //    city can't land with a drifted name/center or dropped hero credits.
  //    The finder city modules import directly by path — index.mjs would only
  //    resolve the CITY-env-selected one.
  const entries = Object.entries(cityMod.CITIES)
  assert.ok(entries.length >= 2, 'CITIES must carry tampa-bay + sf-east-bay (Stage D sf-app)')
  for (const [key, appCity] of entries) {
    const finderCity = await import(`../finder/cities/${key}.mjs`)
    assert.equal(key, appCity.id, `CITIES['${key}'] key must equal its id`)
    assert.equal(appCity.id, finderCity.meta.id, `${key}: app city id must mirror finder meta.id`)
    assert.equal(appCity.name, finderCity.meta.name, `${key}: app city name must mirror finder meta.name`)
    assert.deepEqual(appCity.center, finderCity.meta.center, `${key}: app city center must mirror finder meta.center`)
    assert.equal(appCity.tz, finderCity.tz, `${key}: app city tz must mirror the finder tz (weather/day math)`)
    assert.equal(appCity.region, finderCity.geocode.region, `${key}: app city region must mirror the finder geocode region`)
    // 4. the honesty contract: every hero entry keeps its full credit block; and
    //    where the finder config CARRIES verified hero records (sf-east-bay —
    //    live-verified on Commons, STAGE_D_SF_ENDPOINTS.md §7) the app entry
    //    mirrors them field-for-field. (Tampa's pair was hand-picked in W4 and
    //    lives only in city.js — no finder record to mirror.) The W4 scalar
    //    aliases still mirror entry [0] (the Primer bg + attribution page).
    for (const list of ['heroes', 'spotsHeroes']) {
      if (finderCity[list]) {
        assert.equal(appCity[list].length, finderCity[list].length, `${key}: CITY.${list} must carry the finder config's verified set`)
      }
      appCity[list].forEach((h, i) => {
        for (const field of ['url', 'credit', 'license', 'licenseUrl', 'page']) {
          assert.ok(typeof h[field] === 'string' && h[field], `${key}: CITY.${list}[${i}] must keep its ${field} (credits must not drop)`)
          if (finderCity[list]) {
            assert.equal(h[field], finderCity[list][i][field], `${key}: CITY.${list}[${i}].${field} drifted from the finder config's verified record`)
          }
        }
      })
    }
    assert.equal(appCity.hero, appCity.heroes[0].url, `${key}: CITY.hero alias must mirror heroes[0].url`)
    assert.equal(appCity.spotsHero, appCity.spotsHeroes[0].url, `${key}: CITY.spotsHero alias must mirror spotsHeroes[0].url`)
  }
  // 5. literal sweeps over app/src (flat *.js/*.jsx — assets/ has no code):
  //    - 'wx-tampa-v1' only on the two migration paths (weather.js one-shot,
  //      storage.js LEGACY_KEYS)
  //    - 'en-US' only as city.js's own config value (everything else must ride
  //      the fmtLocale seam)
  const SRC = path.join(ROOT, 'app', 'src')
  const srcFiles = readdirSync(SRC).filter((f) => /\.(js|jsx)$/.test(f))
  for (const f of srcFiles) {
    const text = readFileSync(path.join(SRC, f), 'utf8')
    if (!['weather.js', 'storage.js'].includes(f)) {
      assert.ok(!text.includes('wx-tampa-v1'), `${f}: bare 'wx-tampa-v1' literal outside the migration path (use wx-\${CITY.id}-v1)`)
    }
    if (f !== 'city.js') {
      assert.ok(!text.includes("'en-US'"), `${f}: hardcoded 'en-US' — route it through fmtLocale (lib.js / city.js)`)
    }
  }
  // 6. the copy-swept user-facing surfaces stay Tampa-free (scoped to the swept
  //    files so a code comment elsewhere can't flake this; city.js is the one
  //    place the city's own words live)
  for (const f of ['BubblePage.jsx', 'PlaceBubblePage.jsx', 'AddEvent.jsx', 'guides.js', 'Primer.jsx']) {
    assert.ok(!readFileSync(path.join(SRC, f), 'utf8').includes('Tampa'), `${f}: hardcoded 'Tampa' — interpolate CITY.name / CITY.shortName`)
  }
  // Stage D sf-app: the attribution page spoke a hardcoded state name — caught
  // LIVE on the first SF runtime proof ("Government data is Florida public
  // records" rendered over California data, a false claim on the honesty page
  // itself). It must interpolate CITY.region; no state literal may return.
  const atText = readFileSync(path.join(SRC, 'AttributionPage.jsx'), 'utf8')
  for (const state of ['Florida', 'California']) {
    assert.ok(!atText.includes(state), `AttributionPage.jsx: hardcoded '${state}' — interpolate CITY.region`)
  }
  assert.ok(/\{CITY\.region\}/.test(atText), 'AttributionPage.jsx: the public-records line must interpolate CITY.region')
  const indexHtml = readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8')
  assert.ok(!indexHtml.includes('Tampa'), 'index.html: the title must use the %CITY_NAME% token (cityTitle plugin), not a hardcoded city')
  assert.ok(indexHtml.includes('%CITY_NAME%'), 'index.html: the %CITY_NAME% token must exist for the cityTitle plugin to fill')
})

// HONEST IMAGERY (A3 backout) — place imagery is REAL-OF-THE-PLACE ONLY. The
// rejected A3 curated category-STOCK floor (a generic Pexels photo per placeType)
// is backed out and must NOT return: a generic photo on a specific place reads as
// that venue = soft fabrication. The art-floor is the no-photo state; coverage
// grows only via real of-the-place sources (Wikidata/Commons geosearch/Mapillary).
test('honest imagery: no category-stock floor (A3 backed out) — real-of-the-place only', () => {
  assert.ok(!existsSync(path.join(ROOT, 'finder', 'category-images.json')), 'the category-STOCK manifest must NOT exist (generic stock is soft fabrication)')
  assert.ok(!existsSync(path.join(ROOT, 'app', 'src', 'categoryImages.js')), 'the stock-floor helper must NOT exist')
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.ok(!/pickCategoryImage|categoryImageFor|imgbox-floor|category-images/.test(cards), 'CardImg must carry NO category-stock floor wiring (place.image is real-only; art floor is the no-photo state)')
  const settings = readFileSync(path.join(ROOT, 'app', 'src', 'SettingsPage.jsx'), 'utf8')
  assert.ok(!/STOCK_CREDITS|category-images/.test(settings), 'Settings must carry no stock-credits block')
  const contract = readFileSync(path.join(ROOT, 'finder', 'places-images.mjs'), 'utf8')
  assert.ok(/ONLY ever a/.test(contract) && /NO generic stock/i.test(contract), 'the contract header is real-of-the-place only (explicitly: no generic stock)')
})

// 3.73a — placeType-aware art floor (kills the green-on-green wall). Every
// placeType present in the data must carry a distinct hue + watermark emoji, or a
// place card silently falls back to the generic outdoors green/🌳 it replaces.
test('3.73a: placeType art floor covers every placeType in the data', async () => {
  const { PLACETYPE_HUE, PLACETYPE_EMOJI } = await import('../app/src/categories.js')
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const types = new Set(doc.places.map((p) => p.placeType))
  const missingHue = [...types].filter((t) => PLACETYPE_HUE[t] == null)
  const missingEmoji = [...types].filter((t) => !PLACETYPE_EMOJI[t])
  assert.equal(missingHue.length, 0, `placeType(s) with no art-floor hue (→ green wall): ${missingHue.join(', ')}`)
  assert.equal(missingEmoji.length, 0, `placeType(s) with no watermark emoji (→ 🌳 wall): ${missingEmoji.join(', ')}`)
})

// 3.8 Aurora mesh — the no-photo floor is now a per-PLACE generative field seeded by
// the item key. Invariants that keep it honest + correct: DETERMINISTIC (same key →
// identical field, which the thumb→hero View-Transition morph relies on), VARIED
// (different keys → different fields, killing the "coffee wall"), and IN-BAND (every
// blob hue stays within the place's hue band — a cafe field reads warm, never a
// random rainbow that would drift toward looking like a photo or a different type).
test('3.8 aurora art floor: deterministic, varied, and hue-band-bounded', async () => {
  const { auroraVars, medallionHue } = await import('../app/src/artseed.js')
  // deterministic: same key + hue → byte-identical vars (call twice)
  assert.deepEqual(auroraVars('p|kahwa-south', 24), auroraVars('p|kahwa-south', 24), 'same key must yield an identical field')
  // varied: distinct keys → distinct fields (no two cafes look alike)
  const a = auroraVars('p|kahwa-south', 24), b = auroraVars('p|buddy-brew-coffee', 24)
  assert.notDeepEqual(a, b, 'distinct keys must yield distinct fields (the coffee-wall fix)')
  // in-band: every blob hue within ±34° of the base (base ±12, +22±8, −16±8 → ≤30)
  for (const key of ['p|kahwa-south', 'p|x', 'p|some-long-slug-here', 'evt:title']) {
    const v = auroraVars(key, 140)
    for (const h of ['--ah1', '--ah2', '--ah3']) {
      assert.ok(Math.abs(v[h] - 140) <= 34, `${key} ${h}=${v[h]} drifted out of the hue band (base 140)`)
    }
    // positions/radii are on-frame percentages
    for (const p of ['--ax1', '--ay1', '--ar1', '--ax2', '--ay2', '--ar2', '--ax3', '--ay3', '--ar3']) {
      const n = parseFloat(v[p])
      assert.ok(n >= 0 && n <= 100 && v[p].endsWith('%'), `${key} ${p}=${v[p]} is not an on-frame %`)
    }
  }
  // medallion shares the field's base jitter (deterministic, in-band)
  assert.equal(medallionHue('p|kahwa-south', 24), medallionHue('p|kahwa-south', 24))
  assert.ok(Math.abs(medallionHue('p|kahwa-south', 24) - 24) <= 12, 'medallion hue stays within ±12 of base')
})

// 3.73b — REALITY GUARD: beaches carry no differentiating signal today (every
// beach has srcCount 1 + zero amenities), so the Spots tab ships an honest beach
// BROWSE, not a "best beaches" merit ranking — a "ranked by sources & amenities"
// claim on flat data would be fabricated authority (caught in the 3.73b review).
// This tripwire fires the day beaches gain spread → then a real sourced ranking
// (§6.2) becomes honest and the browse should be upgraded.
test('3.73b reality guard: beaches lack ranking signal (browse, not fake-rank)', () => {
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const beaches = doc.places.filter((p) => p.placeType === 'beach')
  assert.ok(beaches.length >= 3, 'need beaches to reason about')
  const score = (p) => (p.srcCount || 0) * 3 + (Array.isArray(p.amenities) ? p.amenities.length : 0)
  const spread = new Set(beaches.map(score)).size
  assert.equal(spread, 1, `beaches now have ranking-signal spread (${spread} distinct scores) — a real sourced "Best beaches" ranking is now honest; upgrade the browse (§6.2)`)
})

// 3.74 — whyFits: an honest plan-builder "why it fits" reason, composed only from
// real signal (weather > free > taste), never fabricated. Pure — Node-importable.
test('3.74: whyFits composes honest reasons (weather > free > taste > none)', async () => {
  const { whyFits } = await import('../app/src/weekend.js')
  const clear = { emoji: '☀️', rain: 10 }
  const rain = { emoji: '🌧️', rain: 70 }
  assert.match(whyFits({ category: 'outdoors' }, { w: clear }), /Clear/, 'outdoor + clear → clear cue')
  assert.match(whyFits({ category: 'music' }, { w: rain }), /rainy-day/, 'indoor + rainy → rainy-day pick')
  assert.equal(whyFits({ category: 'music', isFree: true }, { w: clear }), 'Free', 'free (no weather hit) → Free')
  assert.equal(whyFits({ category: 'music', isFree: false }, { w: null, nudge: () => 12 }), 'Your kind of thing', 'strong taste → taste cue')
  assert.equal(whyFits({ category: 'music', isFree: false }, { w: null, nudge: () => 0 }), null, 'nothing notable → no chip')
})

// 3.75 — Guides (Smart Groups): the derivable intention selectors are PURE +
// honest (real fields only), and resolveGuide is a curated VIEW that shows ALL
// its matches (never-hide) with no fabrication. Node-importable.
test('3.75: guide selectors are pure, honest, and resolve to real matches', async () => {
  const { GUIDES, resolveGuide, guideById } = await import('../app/src/guides.js')
  assert.ok(Array.isArray(GUIDES) && GUIDES.length >= 3, 'GUIDES must be a non-empty roster')
  for (const g of GUIDES) {
    assert.ok(g.id && g.title && g.pov && typeof g.select === 'function', `guide ${g.id} missing required fields`)
  }
  // beach-day resolves to EXACTLY the beaches in the real data — no fabrication
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const beaches = doc.places.filter((p) => p.placeType === 'beach')
  const got = resolveGuide(guideById['beach-day'], { events: [], places: doc.places, anchors: {} })
  assert.equal(got.length, beaches.length, `beach-day resolved ${got.length}, expected ${beaches.length} real beaches`)
  assert.ok(got.every((p) => p.placeType === 'beach'), 'beach-day returned a non-beach')
  // graceful: a guide with no data resolves to an empty (honest) list, not a throw
  assert.deepEqual(resolveGuide(guideById['rainy-day'], { events: [], places: [], anchors: {} }), [], 'empty ctx → empty guide')
  // canonical taxonomy is `art` (not `arts`): both indoor and evening intentions
  // must include real art listings. This pins the seam against categories.js.
  const art = { title: 'Gallery After Dark', category: 'art', start: '2030-07-18T19:00:00-04:00' }
  const artCtx = { events: [art], places: [], anchors: {} }
  assert.deepEqual(resolveGuide(guideById['rainy-day'], artCtx), [art], 'rainy-day includes canonical art events')
  assert.deepEqual(resolveGuide(guideById['date-night'], artCtx), [art], 'date-night includes canonical art events')
})

// 3.7P-7 (FB-03): each guide declares a `domain` and HONORS it — an events-domain
// guide never resolves a place (and vice-versa), so a spots guide can't leak onto
// the Events page. A 'mixed' guide genuinely blends BOTH (which is why GuidePage
// must label each item's domain). Data-independent: synthetic events + places.
test('3.7P-7: guides honor their declared domain (events↔spots separation)', async () => {
  const { GUIDES, resolveGuide } = await import('../app/src/guides.js')
  const DOMAINS = new Set(['events', 'spots', 'mixed'])
  for (const g of GUIDES) {
    assert.ok(DOMAINS.has(g.domain), `guide ${g.id} has invalid domain ${g.domain}`)
  }
  const ctx = {
    anchors: {},
    events: [
      { title: 'Indoor Show', category: 'music', key: 'e:1' },
      { title: 'Outdoor Free', category: 'outdoors', _free: true, key: 'e:2' },
    ],
    places: [
      { kind: 'place', name: 'Test Beach', placeType: 'beach', key: 'pl:1' },
      { kind: 'place', name: 'Free Park', placeType: 'park', isFree: true, key: 'pl:2' },
    ],
  }
  for (const g of GUIDES) {
    const got = resolveGuide(g, ctx)
    const places = got.filter((it) => it.kind === 'place')
    const evs = got.filter((it) => it.kind !== 'place')
    if (g.domain === 'events') {
      assert.equal(places.length, 0, `events-domain guide ${g.id} leaked ${places.length} place(s)`)
    } else if (g.domain === 'spots') {
      assert.equal(evs.length, 0, `spots-domain guide ${g.id} leaked ${evs.length} event(s)`)
    }
  }
  // a 'mixed' guide really blends both kinds (free-outdoor): proves the label need
  const mixed = resolveGuide(GUIDES.find((g) => g.domain === 'mixed'), ctx)
  assert.ok(mixed.some((it) => it.kind === 'place') && mixed.some((it) => it.kind !== 'place'),
    'a mixed guide must resolve BOTH an event and a place')
})

// 3.75b — Watch Guides (the timely layer): guides.json is valid, the World Cup
// guide resolves to REAL keyword-matched events (no fabricated picks), and the
// window gate is honest (active in-window, inactive outside).
test('3.75b: watch guides resolve to real keyword matches + honor the window', async () => {
  const { resolveWatchGuide, watchGuideActive } = await import('../app/src/guides.js')
  const guidesDoc = JSON.parse(readFileSync(path.join(ROOT, 'app', 'public', 'guides.json'), 'utf8'))
  assert.equal(guidesDoc.schemaVersion, 1, 'guides.json schemaVersion must be 1')
  const wc = (guidesDoc.guides || []).find((g) => g.id === 'world-cup-2026')
  assert.ok(wc && wc.kind === 'watch' && Array.isArray(wc.keywords) && wc.keywords.length, 'world-cup watch guide malformed')
  // every authored watch guide must be well-formed, or it silently no-shows
  for (const g of (guidesDoc.guides || []).filter((x) => x.kind === 'watch')) {
    assert.ok(g.window && Number.isFinite(Date.parse(g.window.start)) && Number.isFinite(Date.parse(g.window.end)), `watch guide ${g.id}: unparseable window`)
    assert.ok(Array.isArray(g.keywords) && g.keywords.length > 0, `watch guide ${g.id}: empty keywords`)
  }
  // Resolver correctness is pinned on a FIXTURE (deterministic — live watch-
  // party listings rotate out of the aggregators as a tournament progresses,
  // so "the shipped data has >= 1 world-cup event" was a data-availability
  // assumption, not a code invariant; it broke on the 2026-07-02 refresh when
  // sources dropped the finished group-stage parties. A 0-match guide
  // no-shows honestly in the app — that behavior is the contract.)
  const fixture = [
    { title: 'World Cup USA Watch Party', start: '2026-07-04', venue: 'Bar X' },
    { title: 'Watch FIFA finals on the lawn', start: '2026-07-05', venue: 'Park' },
    { title: 'Trivia Night', start: '2026-07-04', venue: 'Bar X' },
    { title: 'World Cup USA Watch Party', start: '2026-07-04', venue: 'Bar X' }, // dupe — must dedupe
  ]
  const fHits = resolveWatchGuide(wc, fixture)
  assert.equal(fHits.length, 2, `resolver must match exactly the keyword events (deduped) — got ${fHits.length}`)
  assert.ok(!fHits.some((e) => e.title === 'Trivia Night'), 'resolver matched a non-keyword event (fabricating)')
  // and against the REAL events store: whatever it matches must really carry
  // a keyword — 0 hits is honest when the sources list none.
  const evDoc = JSON.parse(readFileSync(path.join(ROOT, 'app', 'public', 'events.json'), 'utf8'))
  const events = Array.isArray(evDoc) ? evDoc : evDoc.events || []
  const hits = resolveWatchGuide(wc, events)
  assert.ok(
    hits.every((e) => {
      const hay = ((e.title || '') + ' ' + (e.description || '') + ' ' + (e.venue || '')).toLowerCase()
      return wc.keywords.some((k) => hay.includes(k.toLowerCase()))
    }),
    'a matched event contains none of the keywords (resolver is fabricating)'
  )
  // window gate
  assert.equal(watchGuideActive(wc, lib.dayTs('2026-06-20')), true, 'should be active mid-window')
  assert.equal(watchGuideActive(wc, lib.dayTs(wc.window.end)), true, 'inclusive final city day stays active')
  assert.equal(watchGuideActive(wc, lib.addDayTs(lib.dayTs(wc.window.end), 1)), false, 'day after the window is inactive')
  assert.equal(watchGuideActive(wc, lib.dayTs('2027-01-01')), false, 'should be inactive outside its window')
  // Stage D sf-app: the PER-CITY artifact guides (finder/output/<city>/guides.json,
  // what deploy-city ships) obey the same honesty shape — schemaVersion 1 and
  // every watch guide carries a parseable window + non-empty keywords (a
  // malformed guide silently no-shows in the app; keywords are the no-fabrication
  // contract — a watch guide with none could only ever show invented picks).
  for (const city of ['tampa-bay', 'sf-east-bay']) {
    const doc = JSON.parse(readFileSync(path.join(ROOT, 'finder', 'output', city, 'guides.json'), 'utf8'))
    assert.equal(doc.schemaVersion, 1, `${city} artifact guides.json schemaVersion must be 1`)
    for (const g of (doc.guides || []).filter((x) => x.kind === 'watch')) {
      assert.ok(g.window && Number.isFinite(Date.parse(g.window.start)) && Number.isFinite(Date.parse(g.window.end)), `${city} watch guide ${g.id}: unparseable window`)
      assert.ok(Array.isArray(g.keywords) && g.keywords.length > 0, `${city} watch guide ${g.id}: empty keywords`)
    }
  }
})

// Phase 3.5 W7 — DEEPEN REC COVERAGE. New OSM classes (disc golf, skate parks,
// + court density) and real Wikipedia descriptions for wikidata places.
test('W7 deepen: disc golf + skate parks + court density + Wikipedia descriptions', () => {
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const P = doc.places
  const hasAmen = (a) => P.filter((p) => p.amenities && p.amenities.includes(a)).length
  // the headline rec additions are present (disc golf + skate parks)
  assert.ok(hasAmen('disc-golf') >= 3, `expected disc-golf coverage, got ${hasAmen('disc-golf')}`)
  assert.ok(hasAmen('skate-park') >= 8, `expected skate-park coverage, got ${hasAmen('skate-park')}`)
  // court density: the new court sports enrich parks broadly
  assert.ok(hasAmen('shuffleboard') + hasAmen('volleyball') + hasAmen('racquetball') >= 30, 'new court sports must enrich parks (density)')
  // real Wikipedia descriptions enriched the wikidata set (was 92 pre-W7)
  const withDesc = P.filter((p) => p.description).length
  assert.ok(withDesc >= 115, `descriptions ${withDesc} below the W7 floor (~123 expected)`)
  // honest: a description is only ever a real blurb — never a fabricated stub
  for (const p of P) {
    if (p.description) assert.ok(p.description.length > 12, `${p.name}: suspiciously short description`)
  }
})

// W7 wiring: the finder pipeline carries the new OSM sources + the descriptions
// enrichment (Node scripts can't be exercised in the smoke run — grep the contract).
test('W7 wiring: osm rec classes + Wikipedia-descriptions enrichment in the pipeline', () => {
  const osm = readFileSync(path.join(ROOT, 'finder', 'places-sources', 'osm.mjs'), 'utf8')
  assert.ok(/disc_golf_course/.test(osm), 'osm.mjs must query disc golf courses')
  assert.ok(/skateboard/.test(osm), 'osm.mjs must query skate parks (sport=skateboard)')
  assert.ok(/amenityOnNamed/.test(osm), 'osm.mjs must stamp the specific amenity on named new-class places')
  assert.ok(existsSync(path.join(ROOT, 'finder', 'places-descriptions.mjs')), 'the Wikipedia descriptions module must exist')
  const places = readFileSync(path.join(ROOT, 'finder', 'places.mjs'), 'utf8')
  assert.ok(/enrichPlacesWithDescriptions/.test(places), 'places.mjs must wire the descriptions enrichment')
})

// 3.7P-4 gamification — the Finch-kind rhythm engine (gamify.js, pure selectors).
// Asserts the never-punishing contract: graced current, monotonic best (a gap
// never decrements a number), rest counts, honest (only logged did/rest days),
// zero-is-silence for a new user, and DST-safe day stepping.
test('3.7P-4 gamify: rhythm is graced, best is monotonic, rest counts, honest', async () => {
  const G = await import('../app/src/gamify.js')
  const day = (m, d) => new Date(2026, m, d).getTime() // local midnight, DST-safe
  const anchors = { todayTs: day(5, 15) } // June 15, 2026

  // empty → zero-is-silence
  assert.equal(G.streakStatus(new Set(), [], anchors), 'none', 'new user = none (render nothing)')
  assert.equal(G.currentStreak(new Set(), [], anchors), 0)
  assert.equal(G.bestStreak(new Set(), []), 0)

  // did + REST mix ending today → rest counts in the run
  assert.equal(G.currentStreak(new Set([day(5, 13), day(5, 14)]), [day(5, 15)], anchors), 3, 'rest day counts in the streak')
  assert.equal(G.streakStatus(new Set([day(5, 15)]), [], anchors), 'active', 'logged today = active')

  // GRACE: logged yesterday only, not today → still a live streak, status grace
  assert.equal(G.currentStreak(new Set([day(5, 14)]), [], anchors), 1, 'grace: yesterday keeps the streak alive today')
  assert.equal(G.streakStatus(new Set([day(5, 14)]), [], anchors), 'grace')

  // DORMANT: a gap past the grace window → current 0, NEVER a shame state, best intact
  const lapsed = new Set([day(5, 11), day(5, 12), day(5, 13)]) // a 3-run ending the 13th
  assert.equal(G.currentStreak(lapsed, [], anchors), 0, 'past grace → current 0')
  assert.equal(G.streakStatus(lapsed, [], anchors), 'dormant', 'a gap is dormant, never broken-flame')
  assert.equal(G.bestStreak(lapsed, []), 3, 'best survives the gap (monotonic)')

  // gap then act today → current restarts at 1, best is NEVER decremented
  const gapThenToday = new Set([day(5, 1), day(5, 2), day(5, 3), day(5, 15)])
  assert.equal(G.currentStreak(gapThenToday, [], anchors), 1, 'current restarts after a gap')
  assert.equal(G.bestStreak(gapThenToday, []), 3, 'best = the old run, never decremented by the gap')

  // honesty: rhythm days are ONLY did ∪ rest; restDayList takes only state===rest
  assert.equal(G.totalRhythmDays(new Set([day(5, 1)]), [day(5, 2)]), 2, 'total = distinct logged days')
  const rl = G.restDayList(
    { [String(day(5, 20))]: { state: 'rest' }, [String(day(5, 21))]: { state: null, slots: { day: 'k' } } },
    [{ dayTs: day(5, 1), state: 'rest' }, { dayTs: day(5, 2), state: null }]
  ).sort((a, b) => a - b)
  assert.deepEqual(rl, [day(5, 1), day(5, 20)], 'restDayList = only state===rest from plans + history (a plan/missed day is not rest)')

  // DST-SAFE stepping — a run straddling spring-forward (Mar 8 2026) + fall-back
  // (Nov 1 2026) must still chain; ts-86400000 stepping would break on the 23h/25h
  // midnights (this is exactly what prevMidnight's date math protects, and the
  // case the June fixtures above never exercised).
  const springRun = new Set([day(2, 7), day(2, 8), day(2, 9)]) // Mar 7-8-9, across spring-forward
  assert.equal(G.currentStreak(springRun, [], { todayTs: day(2, 9) }), 3, 'streak chains across spring-forward (DST-safe)')
  assert.equal(G.bestStreak(springRun, []), 3, 'best chains across spring-forward')
  assert.equal(G.bestStreak(new Set([day(9, 31), day(10, 1), day(10, 2)]), []), 3, 'best chains across fall-back (Oct 31–Nov 2, DST-safe)')

  // defensive: null / non-array / no-anchors never throw
  assert.equal(G.currentStreak(null, null, null), 0)
  assert.equal(G.bestStreak(undefined, 'not-an-array'), 0)
  assert.equal(G.streakStatus(new Set(), null, anchors), 'none')

  // the bundle reflects its parts
  const sum = G.rhythmSummary(new Set([day(5, 14), day(5, 15)]), [], anchors)
  assert.equal(sum.current, 2, 'bundle current')
  assert.equal(sum.best, 2, 'bundle best')
  assert.equal(sum.total, 2, 'bundle total')
  assert.equal(sum.status, 'active', 'bundle status (logged today)')
})

// Phase 3.6 N1 — the quiet top-nav. The lens/category split MUST partition the
// bubble lists exactly (never-hide: every destination still reachable, just
// presented quieter), and the views must render LensNav, not the old strip.
test('N1 top-nav: lens + category split partitions the bubbles (never-hide)', async () => {
  const L = await import('../app/src/lib.js')
  const P = await import('../app/src/places.js')
  const ids = (arr) => arr.map((b) => b.id).sort()
  // Events: LENS ∪ CAT === BUBBLES, no overlap, no drop
  assert.deepEqual(ids([...L.LENS_BUBBLES, ...L.CAT_BUBBLES]), ids(L.BUBBLES),
    'LENS_BUBBLES ∪ CAT_BUBBLES must equal BUBBLES exactly (nothing dropped or duplicated)')
  assert.ok(L.LENS_BUBBLES.every((b) => b.kind !== 'cat'), 'lenses are the non-category bubbles')
  assert.ok(L.CAT_BUBBLES.every((b) => b.kind === 'cat') && L.CAT_BUBBLES.length >= 8, 'categories are the cat bubbles')
  // Spots: PLACE lens ∪ cat === PLACE_BUBBLES
  assert.deepEqual(ids([...P.PLACE_LENS_BUBBLES, ...P.PLACE_CAT_BUBBLES]), ids(P.PLACE_BUBBLES),
    'PLACE lens ∪ cat must equal PLACE_BUBBLES exactly')
  assert.ok(P.PLACE_LENS_BUBBLES.length >= 1 && P.PLACE_CAT_BUBBLES.length >= 1, 'both Spots groups are non-empty')
})

test('N1 wiring: HotView + LocationsView render LensNav, the loud strip is gone', () => {
  assert.ok(existsSync(path.join(ROOT, 'app', 'src', 'LensNav.jsx')), 'the LensNav component must exist')
  for (const f of ['HotView.jsx', 'LocationsView.jsx']) {
    const src = readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
    assert.ok(/<LensNav/.test(src), `${f} must render LensNav`)
    assert.ok(!/className="bubbles"/.test(src), `the old .bubbles strip must be gone from ${f}`)
  }
  // a11y (N1 review): the menu is a real dialog — modal, state-exposing trigger,
  // focus returns to the trigger on close
  const ln = readFileSync(path.join(ROOT, 'app', 'src', 'LensNav.jsx'), 'utf8')
  assert.ok(/aria-modal="true"/.test(ln), 'the category sheet must be a modal dialog (aria-modal)')
  assert.ok(/aria-haspopup="dialog"/.test(ln) && /aria-expanded=\{open\}/.test(ln), 'the trigger must expose menu open-state')
  assert.ok(/moreRef\.current\?\.focus\(\)/.test(ln), 'focus must return to the trigger on close (WCAG 2.4.3)')
})

// Stage C · C3 — real AA compliance + the missing keyboard/motion affordances.
test('Stage C C3 a11y: contrast fixes, reduced-motion gates, dialog focus, roving tabs, form errors', () => {
  const read = (f) => readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
  // (1) the 3 audited AA contrast failures now use AA-safe warm values.
  //     C4 tokenized the literals — the AA hexes stay PINNED at the token definition
  //     (index.css), and each site must consume the matching var (both halves asserted
  //     so neither the value nor the wiring can silently drift).
  const ic = read('index.css')
  assert.ok(/--accent-ink-strong:\s*#a54d12/.test(ic), 'index.css must pin --accent-ink-strong at #a54d12 — clears AA 4.5:1 on the composited 8% pill fill (--accent-ink was only 4.48:1 there)')
  assert.ok(/--free-fill-strong:\s*#0b8256/.test(ic), 'index.css must pin --free-fill-strong at AA-darkened sage #0b8256')
  assert.ok(/--free-ink:\s*#097045/.test(ic), 'index.css must pin --free-ink at AA-darkened sage #097045')
  assert.ok(/\.deckthis\s*\{[^}]*color:\s*var\(--accent-ink-strong\)/s.test(read('lensdeck.css')), '.deckthis text must consume var(--accent-ink-strong)')
  const cc = read('cards.css')
  assert.ok(/\.free-badge\s*\{[^}]*background:\s*var\(--free-fill-strong\)/s.test(cc), '.free-badge fill must consume var(--free-fill-strong)')
  assert.ok(/\.chip-free\s*\{[^}]*color:\s*var\(--free-ink\)/s.test(cc), '.chip-free text must consume var(--free-ink)')
  // (2) prefers-reduced-motion gates on the two entrance-animation files that lacked them
  for (const f of ['filters.css', 'locations.css']) {
    assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(read(f)), `${f} must gate its entrance animation behind prefers-reduced-motion`)
  }
  // (3) dialog focus management (focus-in + Tab-trap [+ return]) mirrors LensNav/DetailPage
  const dp = read('DayPage.jsx')
  assert.ok(/aria-modal="true"/.test(dp) && /ref=\{menuRef\}/.test(dp) && /onKeyDown=\{menuTrap\}/.test(dp), 'the DayPage ⋯ menu must be a focus-trapped modal dialog')
  assert.ok(/menuBtnRef\.current/.test(dp) && /btn\?\.focus\(\)/.test(dp), 'the DayPage menu must return focus to the ⋯ trigger on dismiss (WCAG 2.4.3)')
  const pr = read('Primer.jsx')
  assert.ok(/ref=\{dialogRef\}/.test(pr) && /onKeyDown=\{trap\}/.test(pr) && /\}, \[step\]\)/.test(pr), 'the Primer modal must trap Tab and move focus in on each step')
  // (4) roving tabindex + arrow-key nav on the two tablists (shared helper, no dup)
  assert.ok(/export function tablistArrowKey/.test(read('lib.js')), 'the shared tablistArrowKey helper must exist in lib.js')
  for (const f of ['MySavesPage.jsx', 'PickerSheet.jsx']) {
    const src = read(f)
    assert.ok(/tablistArrowKey/.test(src) && /tabIndex=\{/.test(src), `${f} tablist must use roving tabindex + tablistArrowKey`)
  }
  // (5) AddEvent field errors are associated with their inputs for screen readers
  const ae = read('AddEvent.jsx')
  for (const id of ['ae-title-err', 'ae-date-err', 'ae-price-err', 'ae-link-err']) {
    assert.ok(new RegExp(`id="${id}"`).test(ae) && new RegExp(`aria-describedby=\\{errors\\.\\w+ \\? '${id}'`).test(ae), `AddEvent must wire aria-describedby -> ${id}`)
  }
})

// Phase 3.6 N5 — ambitious onboarding. First-open teaches the 5-tab IA (skippable)
// and finishes with a taste SNAPSHOT whose copy is honest (taste reorders, never
// hides — the old "head start" line wrongly implied filtering).
test('N5 onboarding: first-open IA tour (skippable) + honest taste snapshot', () => {
  const p = readFileSync(path.join(ROOT, 'app', 'src', 'Primer.jsx'), 'utf8')
  assert.ok(/const TOUR =/.test(p) && /step === 'tour'/.test(p), 'Primer must show the first-open IA tour')
  assert.ok(/reentry \? 0 : 'tour'/.test(p), 'first-open opens on the tour; a Settings retake skips it')
  assert.ok(/step !== 3 &&/.test(p), 'the one-tap Skip must be available on the tour (skippable)')
  assert.ok(/primer-snapshot/.test(p), 'the finish must reflect the picks back as a taste snapshot')
  assert.ok(/never hide the rest/.test(p), 'finish copy must be honest — taste reorders, never hides')
  assert.ok(!/give the feed a head start/.test(p), 'the misleading filter-implying "head start" copy must be gone')
})

// TINDER — the "Tune your taste" swipe-to-calibrate module + a deck parameterized
// by kind (events|places). Locks: the light module lives on BOTH result pages,
// opens the RIGHT deck, and its preview cards are REAL (data-driven samples, never
// fabricated); the deck shares ONE category taste model for events and places.
test('TINDER: the Tune-your-taste module is on both pages, kind-correct, honest', () => {
  const tuner = readFileSync(path.join(ROOT, 'app', 'src', 'TasteTuner.jsx'), 'utf8')
  // honesty: preview cards render REAL passed-in samples (e.title), never a
  // hardcoded fake event — and reuse the shared art-floor + real chip helpers.
  assert.ok(/samples/.test(tuner) && /e\?\.title|e\.title/.test(tuner), 'preview cards must render real passed-in samples (data-driven, not fabricated)')
  assert.ok(/from '\.\/cards\.jsx'/.test(tuner) && /CardImg/.test(tuner), 'preview must reuse CardImg (the real-photo-or-art floor)')
  assert.ok(/featuredChips/.test(tuner) && /spotChips/.test(tuner), 'preview chips must come from the real chip helpers (events vs places)')
  // session fatigue guard: dismiss collapses to a discoverable "tune again"
  assert.ok(/sessionStorage/.test(tuner) && /tune-again/.test(tuner), 'dismiss must use a session guard + collapse to a Tune-again affordance')

  // wired on BOTH result pages, each to its OWN deck kind, via openDeck
  const hot = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  const loc = readFileSync(path.join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  assert.ok(/<TasteTuner[^>]*kind="events"[^>]*onTune=\{openDeck\}/.test(hot), 'HotView must render the events Tune module wired to openDeck')
  assert.ok(/<TasteTuner[^>]*kind="places"[^>]*onTune=\{openDeck\}/.test(loc), 'LocationsView must render the places Tune module wired to openDeck')

  // the deck is parameterized by kind; openDeck routes the {kind, origin} object
  const deck = readFileSync(path.join(ROOT, 'app', 'src', 'CalibrationDeck.jsx'), 'utf8')
  assert.ok(/dealPlaceDeck/.test(deck) && /PlaceDeckFace/.test(deck), 'CalibrationDeck must add the places sampler + place face')
  assert.ok(/recordCalibration/.test(deck), 'verdicts must feed the SAME taste model (recordCalibration) for events + places')
  assert.ok(/placeType/.test(deck), 'the places deck must stratify by placeType (deck variety, not 15 parks)')
  const nav = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  assert.ok(/arg\.kind === 'places'/.test(nav), 'openDeck must route the {kind, origin} object form additively')
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(/PlacesDeck/.test(app) && /page\.kind === 'places'/.test(app), 'App must mount the lazy PlacesDeck for the places kind')
})

// N5b — re-entry pull cards (pull-based, ban-list-clean): a forward "next step"
// only when one exists; never a nag. 3.7P-17 RETIRED the Calendar "Plan your
// weekend" pull (a leftover after P8); the Profile save→plan pull remains.
test('N5b re-entry: Profile save→plan pull (Calendar pull retired in 3.7P-17)', () => {
  const cal = readFileSync(path.join(ROOT, 'app', 'src', 'CalendarView.jsx'), 'utf8')
  assert.ok(!/cal-plan-pull/.test(cal), '3.7P-17: the Calendar "Plan your weekend" pull is retired')
  const pf = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  // Stage R Profile rework: the dashboard sections (incl. the save→plan pull) left
  // the main view; Profile is a clean menu now. The loop survives via My saves.
  assert.ok(!/pf-pull/.test(pf), 'Stage R: the Profile dashboard pull left the clean menu view')
  const saves = readFileSync(path.join(ROOT, 'app', 'src', 'MySavesPage.jsx'), 'utf8')
  assert.ok(/shelfItems/.test(saves) && /openDetail/.test(saves), 'the save→plan loop stays reachable via My saves (tap a save → detail → add to day)')
})

// S1-D4 → C5 — the FillDay swipe deck: first removed from the day screen (S1-D4,
// "logic kept for reuse"), then DELETED outright in Stage C C5 — it sat unreachable
// for 8+ days (no FillDayButton renderer anywhere) and the fmn-seen store it wrote
// had no reader since the dice died in Phase 3.5. Git history preserves the reuse
// option; the tree stays honest about what actually ships.
test('C5: the dead DayFillDeck + fmnseen are fully deleted (no dangling refs)', () => {
  for (const f of ['DayFillDeck.jsx', 'dayfill.js', 'dayfill.css', 'fmnseen.js']) {
    assert.ok(!existsSync(path.join(ROOT, 'app', 'src', f)), `${f} must be deleted (C5)`)
  }
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(!/DayFillDeck|dayfill/.test(app), 'App.jsx carries no day-fill route residue')
  for (const f of ['CalibrationDeck.jsx', 'LensDeck.jsx', 'DayPage.jsx']) {
    const src = readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
    assert.ok(!/pushFmnSeen|fmnseen/.test(src), `${f} must not reference the deleted fmnseen store`)
  }
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

// Stage D sf-app — the SECOND city must BUILD. VITE_CITY=sf-east-bay was
// fail-closed (unknown id → loud registry throw) until its entry landed; this
// holds the door open and pins the two identity surfaces the build stamps:
// the emitted index.html <title> and the manifest name must both carry the SF
// name from the ONE registry. Cheap by measurement (rolldown builds in ~0.2s)
// and isolated — a scratch --outDir, so the default (Tampa) build's app/dist
// is never clobbered. Runs after the Tampa build test (node:test is
// sequential in-file), so the two vite runs never overlap.
test('Stage D sf-app: staged SF bytes build with their exact approved manifest', { timeout: 300_000 }, async (t) => {
  startAppChecks()
  await buildP // never overlap the Tampa build (shared caches, half the machine)
  const scratch = mkdtempSync(path.join(tmpdir(), 'wuzup-sf-build-'))
  const publicDir = path.join(scratch, 'public')
  const outDir = path.join(scratch, 'dist')
  try {
    cpSync(path.join(ROOT, 'app', 'public'), publicDir, { recursive: true })
    const staged = await runNode('finder/deploy.mjs', { CITY: 'sf-east-bay', DEPLOY_DEST: publicDir })
    assert.equal(staged.code, 0, `SF staging failed (exit ${staged.code}):\n${tail(staged.out)}`)
    const r = await collect(
      spawn(`npm --prefix app run build -- --outDir "${outDir}" --emptyOutDir`, {
        cwd: ROOT,
        shell: true,
        env: { ...process.env, VITE_CITY: 'sf-east-bay', WUZUP_PUBLIC_DIR: publicDir },
      })
    )
    t.diagnostic(`sf build took ${r.secs}s`)
    assert.equal(r.code, 0, `VITE_CITY=sf-east-bay build failed (exit ${r.code}):\n${tail(r.out)}`)
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
    assert.ok(html.includes('<title>Wuzup · SF & East Bay</title>'), 'the emitted index.html title must carry the SF name')
    const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.webmanifest'), 'utf8'))
    assert.equal(manifest.name, 'Wuzup · SF & East Bay', 'the emitted manifest name must carry the SF name')
    const approved = JSON.parse(readFileSync(path.join(publicDir, 'artifact-manifest.json'), 'utf8')).manifestId
    const bundle = readdirSync(path.join(outDir, 'assets'))
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(path.join(outDir, 'assets', file), 'utf8'))
      .join('\n')
    assert.ok(bundle.includes(approved), 'the SF browser bundle must embed its staged manifestId')
    const proof = await collect(spawn(
      process.execPath,
      [path.join(ROOT, 'finder', 'verify-app-build.mjs'), outDir],
      { cwd: ROOT, env: { ...process.env, CITY: 'sf-east-bay' } }
    ))
    assert.equal(proof.code, 0, `SF production-byte proof failed (exit ${proof.code}):\n${tail(proof.out)}`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

// Stage E deploy-infra — base-path safety, the SOURCE pin. GitHub Pages serves
// the app under /wuzup/ (Tampa) and /wuzup/sf/ (SF); a root-absolute data
// fetch 404s there. Every runtime data fetch must ride import.meta.env.BASE_URL
// (which vite statically folds back to the identical root-absolute literal at
// the default base — the default build is byte-identical, verified at land).
test('Stage E base-path: no root-absolute fetch literals in app/src — data fetches ride BASE_URL', () => {
  const srcDir = path.join(ROOT, 'app', 'src')
  const files = readdirSync(srcDir).filter((f) => /\.(js|jsx)$/.test(f))
  const offenders = []
  for (const f of files) {
    if (/fetch\(\s*['"`]\//.test(readFileSync(path.join(srcDir, f), 'utf8'))) offenders.push(f)
  }
  assert.deepEqual(offenders, [],
    `root-absolute fetch literal(s) in app/src — these 404 under a subpath deployment: ${offenders.join(', ')}`)
  const artifactSrc = readFileSync(path.join(srcDir, 'artifacts.js'), 'utf8')
  assert.ok(/const BASE = import\.meta\.env\?\.BASE_URL \?\? '\/'/.test(artifactSrc), 'the artifact repository derives its base from Vite')
  assert.ok(/joinUrl\(baseUrl, MANIFEST_FILE\)/.test(artifactSrc) && /joinUrl\(baseUrl, entry\.file\)/.test(artifactSrc), 'manifest, events, and places share the BASE_URL-relative join')
  const guidesSrc = readFileSync(path.join(srcDir, 'guides.js'), 'utf8')
  assert.ok(guidesSrc.includes("+ 'guides.json'") && guidesSrc.includes('import.meta.env'), 'guides remain BASE_URL-relative')
  // the data-embedded /place-img/ crop paths get rebased in normalizePlace —
  // the ONE choke point every consumer (cards/detail/attribution/saved
  // snapshots) flows through
  const placesSrc = readFileSync(path.join(srcDir, 'places.js'), 'utf8')
  assert.ok(placesSrc.includes('p.image = BASE + p.image.slice(1)'),
    'places.js normalizePlace must rebase root-absolute image paths onto BASE (the /place-img/ crops ship root-absolute in the data)')
})

// Stage E deploy-infra — the BASE_PATH build itself. Builds once with
// BASE_PATH=/wuzup/ (exactly what the Pages deploy workflow ships for Tampa) into
// a scratch outDir and pins every base-path surface that has ever escaped:
// index.html links (the plugin-emitted manifest href was vite-invisible), the
// manifest's OWN start_url/scope/icons (raw asset — vite never rewrites its
// internals), the CSS @font-face public URL, and the folded fetch literals in
// the bundle. Cheap by measurement (rolldown builds in ~0.3s).
const DEPLOY_BASE = '/wuzup/'
const DEPLOY_PREFIX = DEPLOY_BASE.slice(0, -1)
test(`Stage E base-path: BASE_PATH=${DEPLOY_BASE} build rebases every runtime surface`, { timeout: 300_000 }, async (t) => {
  startAppChecks()
  await buildP // never overlap another vite run
  const outDir = mkdtempSync(path.join(tmpdir(), 'wuzup-basepath-build-'))
  try {
    const r = await collect(
      spawn(`npm --prefix app run build -- --outDir "${outDir}" --emptyOutDir`, {
        cwd: ROOT,
        shell: true,
        env: { ...process.env, BASE_PATH: DEPLOY_BASE },
      })
    )
    t.diagnostic(`BASE_PATH build took ${r.secs}s`)
    assert.equal(r.code, 0, `BASE_PATH=${DEPLOY_BASE} build failed (exit ${r.code}):\n${tail(r.out)}`)
    // index.html: every ref base-prefixed, none left at the root
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
    for (const ref of [`href="${DEPLOY_PREFIX}/favicon.svg"`, `href="${DEPLOY_PREFIX}/manifest.webmanifest"`, `href="${DEPLOY_PREFIX}/apple-touch-icon.png"`]) {
      assert.ok(html.includes(ref), `index.html must carry ${ref}`)
    }
    assert.ok(!/(href|src)="\/(?!wuzup\/)/.test(html),
      `index.html carries a root-absolute href/src outside ${DEPLOY_BASE} — a base-path escapee`)
    // the manifest's internals (raw asset — vite rewrites nothing inside it)
    const manifest = JSON.parse(readFileSync(path.join(outDir, 'manifest.webmanifest'), 'utf8'))
    assert.equal(manifest.start_url, DEPLOY_BASE, 'manifest start_url must be the base')
    assert.equal(manifest.scope, DEPLOY_BASE, 'manifest scope must be the base')
    for (const icon of manifest.icons) {
      assert.ok(icon.src.startsWith(`${DEPLOY_PREFIX}/icons/`), `manifest icon ${icon.src} must be base-prefixed`)
    }
    // the @font-face public URL in the emitted CSS
    const assets = readdirSync(path.join(outDir, 'assets'))
    const css = readFileSync(path.join(outDir, 'assets', assets.find((f) => f.endsWith('.css'))), 'utf8')
    assert.ok(css.includes(`url(${DEPLOY_PREFIX}/fonts/inter-var-latin.woff2)`), 'the CSS @font-face URL must be base-prefixed')
    assert.ok(!css.includes('url(/fonts/'), 'the CSS still carries a root-absolute /fonts/ URL')
    // the repository folds the base once, then joins manifest-declared files.
    const bundle = assets.filter((f) => f.startsWith('index-') && f.endsWith('.js'))
      .map((f) => readFileSync(path.join(outDir, 'assets', f), 'utf8')).join('\n')
    assert.ok(bundle.includes(DEPLOY_BASE), `bundle must carry the folded ${DEPLOY_BASE} repository base`)
    for (const a of ['artifact-manifest.json', 'events.json', 'places.json', 'guides.json']) {
      const esc = a.replace('.', '\\.')
      assert.ok(bundle.includes(a), `bundle must carry the ${a} runtime member`)
      assert.ok(!new RegExp(`(['"\`])/${esc}\\1`).test(bundle), `bundle still carries root-absolute /${a}`)
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

// ============================================================
// 5) PURE-LOGIC UNITS — app/src modules imported straight into Node
//    (lib/taste/weekend are deliberately JSX-free; localStorage access is
//    guarded, so importing them here is supported by design)
// ============================================================
const lib = await import('../app/src/lib.js')
const cityMs = (iso) => lib.parseDate(iso)?.getTime()
const weekend = await import('../app/src/weekend.js')
const taste = await import('../app/src/taste.js')
const share = await import('../app/src/share.js')
const placesMod = await import('../app/src/places.js')
const searchMod = await import('../app/src/search.js')
const curate = await import('../app/src/curate.js')

// dayplan.js is JSX/CSS-free (its only imports are storage.js + weekend.js,
// both Node-safe). Its U-d conversion ledger (markDayConverted/loadConverted)
// PERSISTS through storage.js, which is a no-op in Node without a localStorage —
// so install a tiny in-memory shim BEFORE importing dayplan, letting the
// one-shot persistence path actually run. The pure derivations
// (morningAfterCandidates / didDays / daysOutInMonth / varietyFirsts) need no
// storage at all. storage.js already module-evaluated (lib imported it) so the
// migration won't re-run; lsGet/lsSet read globalThis.localStorage per call.
globalThis.localStorage = (() => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  }
})()
const dayplan = await import('../app/src/dayplan.js')

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
const AN = lib.makeAnchors(cityMs('2026-06-10T12:00:00')) // Wed Jun 10 2026, city noon

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
  const m1 = lib.tonightModel(up, AN, cityMs('2026-06-10T19:00:00'))
  assert.deepEqual(
    m1.items.map((x) => x.e.title),
    ['future-b', 'dateonly-today', 'future-a', 'started-hot'],
    'tonight 7 PM ordering must be future hot-desc then started (never hidden)'
  )
  assert.equal(m1.futureN, 2, 'futureN counts TIMED not-yet-started events only')
  assert.equal(m1.late, false)
  // 22:30 with <3 timed futures: late mode folds in tomorrow 16–22h, withDate
  const m2 = lib.tonightModel(up, AN, cityMs('2026-06-10T22:30:00'))
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

test('daypartOf: boundary hours (ternary morning/afternoon/night)', () => {
  const at = (hhmm) => weekend.daypartOf({ start: `2026-06-12T${hhmm}:00` })
  assert.equal(weekend.daypartOf({ start: '2026-06-12' }), 'any', 'date-only events are "any" (shown in all three)')
  assert.equal(at('04:59'), 'night', '04:59 is the tail of a night out')
  assert.equal(at('05:00'), 'morning', '05:00 opens the morning window')
  assert.equal(at('12:59'), 'morning', '12:59 is still morning')
  assert.equal(at('13:00'), 'afternoon', '13:00 opens the afternoon window')
  assert.equal(at('16:59'), 'afternoon', '16:59 is still afternoon')
  assert.equal(at('17:00'), 'night', '17:00 opens the night window')
  assert.equal(at('00:30'), 'night', '00:30 is night (small hours)')
})

// Sprint U-c: the generalized share/ICS builders (share.js). The single-event
// path must stay byte-for-byte the old DetailPage output; the day path must
// emit one VEVENT per slotted entry inside ONE VCALENDAR.
test('share.js: eventIcs is a single well-formed VEVENT, eventsIcs is multi', () => {
  const nowMs = Date.parse('2026-07-15T16:00:00Z')
  const timed = N(ev({ title: 'Vinyl Night', start: '2026-06-13T19:00:00', venue: 'The Attic' }), AN)
  const dated = N(ev({ title: 'Art Walk', start: '2026-06-14', venue: 'Riverwalk' }), AN)
  const one = share.eventIcs(timed, { nowMs })
  assert.ok(one.startsWith('BEGIN:VCALENDAR\r\n') && one.endsWith('END:VCALENDAR\r\n'), 'single ICS must be a full VCALENDAR')
  assert.equal((one.match(/BEGIN:VEVENT/g) || []).length, 1, 'eventIcs must contain exactly one VEVENT')
  assert.ok(one.includes('DTSTART;TZID=America/New_York:20260613T190000'), 'timed event must emit a city-zoned DTSTART')
  assert.ok(one.includes('DTEND;TZID=America/New_York:20260613T220000'), 'timed event must emit its canonical end')
  assert.ok(one.includes('DTSTAMP:20260715T160000Z'), 'injected stamp must be deterministic')
  assert.ok(one.includes('SUMMARY:Vinyl Night'), 'SUMMARY must carry the title')
  // multi: two slotted entries → two VEVENTs, one envelope
  const many = share.eventsIcs([timed, dated], { nowMs })
  assert.equal((many.match(/BEGIN:VCALENDAR/g) || []).length, 1, 'eventsIcs must wrap ONE VCALENDAR')
  assert.equal((many.match(/BEGIN:VEVENT/g) || []).length, 2, 'eventsIcs must emit one VEVENT per entry')
  assert.equal((many.match(/END:VEVENT/g) || []).length, 2, 'every VEVENT must be closed')
  assert.ok(many.includes('DTSTART;VALUE=DATE:20260614'), 'date-only entry must be all-day')
  // empty list is still a valid (empty) calendar — never throws
  const none = share.eventsIcs([], { nowMs })
  assert.equal((none.match(/BEGIN:VEVENT/g) || []).length, 0, 'empty plan ICS has no VEVENTs')
})

test('share.js: shareDayText composes ☀️/🌙 lines, null on nothing to share', () => {
  const dayTs = lib.dayTs('2026-06-13')
  const day = N(ev({ title: 'Beach', start: '2026-06-13T10:00:00', venue: 'Fort De Soto' }), AN)
  const night = N(ev({ title: 'Show', start: '2026-06-13T20:00:00', venue: 'Orpheum' }), AN)
  const txt = share.shareDayText(dayTs, [{ part: 'afternoon', e: day }, { part: 'night', e: night }])
  const lines = txt.split('\n')
  assert.ok(lines[0].startsWith('My plan for'), 'first line is the day header')
  assert.ok(lines.some((l) => l.startsWith('☀️ ') && l.includes('Beach')), 'daytime slot rendered with sun')
  assert.ok(lines.some((l) => l.startsWith('🌙 ') && l.includes('Show')), 'night slot rendered with moon')
  // nothing to share → null (empty/rest day gets no share affordance at all)
  assert.equal(share.shareDayText(dayTs, []), null, 'empty day shares nothing')
  assert.equal(share.shareDayText(dayTs, [{ part: 'afternoon', e: null }]), null, 'unresolved slots drop to nothing')
})

// Sprint U-c + 3.7P-8: weekend.js's live plan store retired in U-c (loadPlan/
// savePlan gone); 3.7P-8 (FB-10) retired the Weekend Builder VIEW and dropped
// weekend history — so loadHistory/shareText/filledCount are gone too. The pure
// migration support cast (PLAN_KEY/planFor) + the window selector stay.
test('U-c + 3.7P-8 retirement: builder/history removed, migration cast intact', () => {
  assert.equal(weekend.loadPlan, undefined, 'weekend.loadPlan must be retired (day-plans-v1 is the store)')
  assert.equal(weekend.savePlan, undefined, 'weekend.savePlan must be retired')
  assert.equal(weekend.loadHistory, undefined, '3.7P-8: loadHistory retired — weekend history dropped')
  assert.equal(weekend.shareText, undefined, '3.7P-8: shareText retired with the Weekend Builder view')
  assert.equal(typeof weekend.planFor, 'function', 'planFor stays — the migration plan validator')
  assert.equal(typeof weekend.visibleWeekend, 'function', 'visibleWeekend stays — pure weekend-window selector')
  assert.equal(weekend.PLAN_KEY, 'weekend-plan-v1', 'PLAN_KEY stays — migrateWeekendPlan reads it once')
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

// ============================================================
// Sprint V — TASTE ENGINE v2. The mute/boost layer must stay inside [0,18]
// (the fuzz ceiling, extended), the V1 carry-ins must hold, and the V4
// recommendation-quality metric must keep the feed diverse + on-lean without
// starving it. taste.js + tastequality.js are pure .js — Node-importable.
// ============================================================

// a full V-shape profile factory (defaults match empty(); override as needed)
const tp = (over = {}) => ({
  catScores: {}, freeAffinity: 0, n: 0, organicN: 0, explore: 0.5,
  _interview: null, _primer: null, prefs: { boost: [], mute: [], when: null }, v: 1,
  ...over,
  prefs: { boost: [], mute: [], when: null, ...(over.prefs || {}) },
})

test('V3: tasteNudge stays in [0,18] with mute/boost — extremes + fuzz', () => {
  const cats = ['music', 'food', 'art', 'sports']
  // EXTREME 1: boost a maxed, free-leaning on-category event → still exactly the ceiling
  const maxedBoost = tp({ catScores: { music: 25 }, freeAffinity: 25, n: 100, prefs: { boost: ['music'] } })
  const free = N(ev({ category: 'music', isFree: true, tags: ['free'] }), AN)
  assert.equal(taste.tasteNudge(free, maxedBoost), 18, 'boost on a maxed free on-cat event cannot breach 18')
  // EXTREME 2: mute a maxed category → floored at 0 (sunk, never removed/negative)
  const maxedMute = tp({ catScores: { music: 25 }, freeAffinity: 25, n: 100, prefs: { mute: ['music'] } })
  assert.equal(taste.tasteNudge(free, maxedMute), 0, 'mute on a maxed category floors the nudge at 0 (never negative)')
  // EXTREME 3: boost on a NEUTRAL (n=0) profile still acts (explicit user intent), bounded
  const neutralBoost = tp({ prefs: { boost: ['music'] } })
  const nb = taste.tasteNudge(N(ev({ category: 'music' }), AN), neutralBoost)
  assert.ok(nb > 0 && nb <= 18, `boost on a zero-signal profile lifts ordering within bounds (got ${nb})`)
  // EXTREME 4: mute on a neutral profile = 0 (nothing to cut, never below floor)
  assert.equal(taste.tasteNudge(N(ev({ category: 'music' }), AN), tp({ prefs: { mute: ['music'] } })), 0, 'mute on a zero-signal profile is 0')
  // FUZZ: random scores + random disjoint boost/mute prefs never escape [0,18]
  for (let i = 0; i < 400; i++) {
    const boost = cats.filter(() => Math.random() < 0.4)
    const bset = new Set(boost)
    const mute = cats.filter((c) => !bset.has(c) && Math.random() < 0.4)
    const p = tp({
      catScores: { music: Math.random() * 40, food: Math.random() * 40, art: Math.random() * 40, sports: Math.random() * 40 },
      freeAffinity: Math.random() * 40,
      n: Math.floor(Math.random() * 80),
      prefs: { boost, mute },
    })
    const e = N(ev({ category: cats[Math.floor(Math.random() * 4)], isFree: Math.random() < 0.5 }), AN)
    const nud = taste.tasteNudge(e, p)
    assert.ok(nud >= 0 && nud <= 18, `mute/boost tasteNudge ${nud} escaped [0,18] for prefs=${JSON.stringify({ boost, mute })}`)
  }
})

test('V1a: recordPrimer is replace-not-stack (5 retakes ≠ full confidence)', () => {
  taste.resetTaste()
  for (let i = 0; i < 5; i++) taste.recordPrimer({ cats: ['music', 'food'], freeLeaning: true })
  const p = taste.getProfile()
  assert.equal(p.n, 3, `5 identical primer retakes must credit ONE primer's n (3), got ${p.n} (the pre-V stacking bug)`)
  assert.equal(p.catScores.music, 4, 'a re-applied primer cat score does not stack (stays +4)')
  assert.equal(p.freeAffinity, 6, 'a re-applied primer free does not stack (stays +6)')
  // run-twice ≡ run-once (the byte-identical replace contract)
  taste.resetTaste()
  taste.recordPrimer({ cats: ['art'], freeLeaning: false })
  const once = JSON.stringify(taste.getProfile())
  taste.recordPrimer({ cats: ['art'], freeLeaning: false })
  assert.equal(JSON.stringify(taste.getProfile()), once, 'primer run twice must equal run once')
  // organic signal SURVIVES a primer retake (replace only touches primer deltas)
  taste.resetTaste()
  taste.recordSignal('save', { category: 'music' }) // organic +3
  taste.recordPrimer({ cats: ['music'] }) // +4 → 7
  taste.recordPrimer({ cats: ['music'] }) // retake: subtract 4, re-add 4 → still 7
  assert.equal(taste.getProfile().catScores.music, 7, 'a primer retake must not eat organic signal (3 survives)')
})

test('V1b: the rail gates on ORGANIC signal — seeds alone never light it', () => {
  taste.resetTaste()
  // primer (n+=3) + a full interview (n+=5) = total-n 8 → confidence 0.53,
  // OVER the 0.4 rail bar by total n — but organicN is still 0.
  taste.recordPrimer({ cats: ['music', 'food'], freeLeaning: true })
  taste.recordInterview({ cats: ['music'], company: 'social' })
  const seeded = taste.getProfile()
  assert.ok(taste.confidence(seeded) >= 0.4, 'seeds DO raise ordering confidence (head start is real)')
  assert.equal(seeded.organicN, 0, 'seeds credit zero organic signal')
  assert.equal(taste.railReady(seeded), false, 'a seed-only profile must NOT light "Your kind of night" (V1b decision)')
  // 6 real taps light it (the honest bar — railConfidence over organicN)
  for (let i = 0; i < 6; i++) taste.recordSignal('save', { category: 'music' })
  assert.equal(taste.getProfile().organicN, 6, 'organic taps accrue organicN')
  assert.equal(taste.railReady(), true, 'six real taps light the rail (railConfidence 0.4)')
  // HotView must gate on railReady, not raw confidence (the wiring contract)
  const hotSrc = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  assert.ok(/railReady\(taste\)/.test(hotSrc), 'HotView must gate the rail on railReady (organicN), not confidence(taste)')
})

test('V1c: "Tuned by N" is honest — an answer that moved no score credits no n', () => {
  // an affinity-free interview (dayparts/explore/indoor/paid-no only) writes
  // preferences but no score, so n must not move.
  taste.resetTaste()
  const before = taste.getProfile().n
  taste.recordInterview({ dayparts: 'both', explore: 0.8, indoorOutdoor: 'indoor', free: false }, { allowClear: true })
  assert.equal(taste.getProfile().n, before, 'an affinity-free interview credits ZERO n (no score moved)')
  // …but it DID persist the preference (the dayparts read back through the resolver)
  assert.equal(taste.whenPreference(taste.getProfile()), 'whenever', 'dayparts "both" persists and resolves to whenever')
  // a primer with picks already at cap (no delta lands) also credits no n
  taste.resetTaste()
  taste.recordInterview({ cats: ['music'] }) // music → 5, n → 5
  // re-primer music — but interview already put it at 5; primer wants +4 → capped? no, 5+4=9 < 25, so it DOES land.
  // instead drive music to cap, then a primer that can't move it credits no n.
  for (let i = 0; i < 8; i++) taste.recordSignal('save', { category: 'music' }) // 5 + 24 capped at 25
  const nAtCap = taste.getProfile().n
  taste.recordPrimer({ cats: ['music'] }) // music already 25 → delta 0, free not chosen → nothing lands
  assert.equal(taste.getProfile().n, nAtCap, 'a primer that moves no score (already capped) credits no n (V1c)')
})

test('V1 (Q2 carry-in): whenPreference is the ONE resolver — editor outranks primer', () => {
  taste.resetTaste()
  // primer-only: the passed primerWhen is the answer
  assert.equal(taste.whenPreference(taste.getProfile(), 'weekends'), 'weekends', 'primer when is the fallback source')
  // editor dayparts override the primer
  taste.recordInterview({ cats: ['music'], dayparts: 'weeknights' })
  assert.equal(taste.whenPreference(taste.getProfile(), 'weekends'), 'weeknights', 'editor dayparts outrank the primer when')
  // 'both' → whenever (explicit neutral, not nothing)
  taste.recordInterview({ cats: ['music'], dayparts: 'both' })
  assert.equal(taste.whenPreference(taste.getProfile(), 'weekends'), 'whenever', "dayparts 'both' resolves to whenever")
  // nothing set + skipped primer → null (no claim)
  taste.resetTaste()
  assert.equal(taste.whenPreference(taste.getProfile(), null), null, 'no editor + no primer → null (claims nothing)')
  // The when-preference surfaces through the taste SUMMARY (taste.js's ONE
  // resolver) now — HotView's hero (3.7P-23b) and the Profile header (Stage R
  // rework) both stopped showing it, so no component duplicates the resolver; the
  // single source of truth is the summary.
  const tasteSrc = readFileSync(path.join(ROOT, 'app', 'src', 'taste.js'), 'utf8')
  assert.ok(/when: whenPreference\(/.test(tasteSrc), 'the taste summary is the ONE consumer of the whenPreference resolver (no duplicated patch)')
})

test('V3: setCategoryPref keeps boost/mute disjoint + is ordering-only (no catScores touch)', () => {
  taste.resetTaste()
  taste.recordSignal('save', { category: 'music' }) // give music a learned score
  const scoreBefore = taste.getProfile().catScores.music
  taste.setCategoryPref('music', 'boost')
  assert.equal(taste.categoryPref('music'), 'boost', 'boost is set')
  taste.setCategoryPref('music', 'mute') // switching removes it from boost
  assert.equal(taste.categoryPref('music'), 'mute', 'mute replaces boost')
  assert.ok(!taste.getProfile().prefs.boost.includes('music'), 'a category is in at most one list (disjoint)')
  taste.setCategoryPref('music', 'neutral')
  assert.equal(taste.categoryPref('music'), 'neutral', 'neutral clears both')
  // the learned catScore is UNTOUCHED by any pref change (ordering-only layer)
  assert.equal(taste.getProfile().catScores.music, scoreBefore, 'mute/boost never alters the learned catScore')
})

test('V4: feed-quality metric — diverse top-20, on-lean lift, no starvation', async () => {
  const tq = await import('../app/src/tastequality.js')
  // build the real upcoming feed the HotView way
  const upcoming = fullEvents
    .map((e) => N(e, AN))
    .filter((e) => e._day != null && (e._endDay ?? e._day) >= AN.todayTs)
    .map((e) => ({ ...e, _clamp: e._day < AN.todayTs ? AN.todayTs : e._day }))
    .sort((x, y) => x._clamp - y._clamp || x._t - y._t)
  assert.ok(upcoming.length >= tq.TOP_N, `need ≥ ${tq.TOP_N} upcoming events to measure the top-20 (got ${upcoming.length})`)

  // NEUTRAL profile = the no-taste baseline. Its diversity is a property of the
  // DATA (a date whose first day is standing gallery exhibitions is genuinely
  // art-heavy — not a bug), so we only hold it to the ABSOLUTE monoculture
  // backstop. The relative guard below is what catches taste-induced collapse.
  const neutral = tp({})
  const nq = tq.feedQuality(upcoming, neutral)
  assert.ok(
    nq.diversity >= tq.DIVERSITY_FLOOR,
    `neutral top-20 diversity ${nq.diversity.toFixed(2)} below the absolute floor ${tq.DIVERSITY_FLOOR} — the raw feed is a monoculture (data, not taste)`
  )

  // CLEAR-LEAN profile: pick the most common non-'other' category as the lean
  // so it has real supply to surface (a lean with no events can't lift — that's
  // data, not a taste bug). Drive it to a strong, confident score.
  const counts = {}
  for (const e of upcoming) counts[e.category] = (counts[e.category] || 0) + 1
  const leanCat = Object.entries(counts).filter(([c]) => c !== 'other').sort((a, b) => b[1] - a[1])[0][0]
  const leaned = tp({ catScores: { [leanCat]: 25 }, n: 40, organicN: 40 })
  const lq = tq.feedQuality(upcoming, leaned)

  // 1a) ABSOLUTE — a sharp lean must not create a true monoculture
  assert.ok(
    lq.diversity >= tq.DIVERSITY_FLOOR,
    `lean(${leanCat}) top-20 diversity ${lq.diversity.toFixed(2)} below the absolute floor ${tq.DIVERSITY_FLOOR} — taste made a monoculture`
  )
  // 1b) RELATIVE — taste must not COLLAPSE diversity below the raw baseline
  //     (the regression the spec names). Count-preserving order + the >2-run
  //     de-flood guarantee taste can REORDER but not concentrate worse than raw.
  assert.ok(
    lq.diversity >= nq.diversity - tq.DIVERSITY_DROP_TOL,
    `lean(${leanCat}) dropped top-20 diversity to ${lq.diversity.toFixed(2)} from a neutral ${nq.diversity.toFixed(2)} (> ${tq.DIVERSITY_DROP_TOL} drop) — taste collapsed the feed`
  )
  // 2) ON-LEAN LIFT — taste must surface MORE of the lean than neutral does
  assert.ok(
    lq.matchLift >= tq.MATCH_MIN_LIFT,
    `lean(${leanCat}) added only ${lq.matchLift} on-lean items vs neutral (need ≥ ${tq.MATCH_MIN_LIFT}) — taste isn't doing its job`
  )
  // 3) NO STARVATION — the lean must not own (nearly) the whole top-20
  assert.ok(
    lq.matchRate <= tq.MATCH_MAX,
    `lean(${leanCat}) owns ${(lq.matchRate * 100).toFixed(0)}% of the top-20 (> ${tq.MATCH_MAX * 100}% cap) — the feed starved everything else`
  )
  // a synthetic MONOCULTURE feed (all one category, one family) must trip the
  // absolute floor — proof the metric actually catches a collapse, not just
  // passes on friendly data (a self-test of the guard itself).
  const mono = Array.from({ length: 40 }, (_, i) =>
    N(ev({ title: 'M' + i, source: 'OneSrc', sources: ['OneSrc'], category: 'music', start: '2026-06-11T20:00:00', hotScore: 90 - i }), AN)
  ).map((e) => ({ ...e, _clamp: e._day }))
  const monoQ = tq.feedQuality(mono, neutral)
  assert.ok(monoQ.diversity < tq.DIVERSITY_FLOOR, `a one-category one-source feed MUST score below the floor (got ${monoQ.diversity}) — the guard is real`)
})

// O1 lazy tab mounting — the boot-perf guard. The app can't DOM-render in
// this Node harness, so the assertion is structural: every non-boot tab's
// children must be gated on the nav visited-set (mount on first visit), and
// the set must seed with ONLY the boot tab. Boot therefore renders exactly
// one tab's tree — strictly less than the old eager three-tab boot.
test('O1 lazy mounting: non-boot tabs gate on visited, boot seeds one tab', () => {
  const appSrc = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  // Stage R nav restructure: Home is the boot tab (eager, index 0); Events ('hot')
  // is now lazy too. Map is NO LONGER a tab (it's the {type:'map'} sub-view).
  for (const id of ['hot', 'locations', 'calendar', 'profile']) {
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

// ============================================================
// 3.7P-35 — title normalization (Decision Layer Phase A). Conservative cleanup:
// SHOUTING titles → Title Case, empty parens removed, a trailing venue-dup
// stripped — but a proper/mixed-case title is left EXACTLY as authored (so real
// names like "MacFarlane Park" / intentional intercaps are never mangled).
// ============================================================
test('3.7P-35 normalizeTitle: SHOUTING → Title Case, parens/venue cleanup, mixed-case untouched', () => {
  const nt = lib.normalizeTitle
  // mixed/proper case is sacred — never touched
  assert.equal(nt('MacFarlane Park Social'), 'MacFarlane Park Social', 'mixed-case proper names pass through verbatim')
  assert.equal(nt('A Night at the Opera'), 'A Night at the Opera', 'already-titled text is untouched')
  // fully-uppercase (shouting) gets smart Title Case
  assert.equal(nt('LIVE MUSIC AT THE BAR'), 'Live Music at the Bar', 'ALL-CAPS → Title Case, small words lowercased mid-title')
  assert.equal(nt('DJ NIGHT WITH FRIENDS'), 'DJ Night with Friends', 'known acronyms (DJ) keep caps; small word "with" lowercases mid-title')
  assert.equal(nt('FIFA WORLD CUP 2026'), 'FIFA World Cup 2026', 'allowlisted acronym + numeric token preserved')
  assert.equal(nt('SUNSET 5K RUN'), 'Sunset 5K Run', 'alphanumeric token (5K) preserved')
  // HONESTY (review major): an acronym is NEVER flattened into a wrong word
  assert.equal(nt('USCG STATION'), 'USCG Station', 'allowlisted acronym (USCG) kept verbatim')
  assert.equal(nt('29 RBS'), '29 RBS', 'a no-vowel token (RBS) is treated as an initialism, not Title-cased')
  assert.equal(nt('FUN AT THE YMCA'), 'Fun at the YMCA', 'a vowel-bearing acronym on the allowlist (YMCA) survives de-shouting')
  // ordinals/decades lowercase their suffix; 5K-style units stay
  assert.equal(nt('5TH ANNUAL GALA'), '5th Annual Gala', 'ordinal suffix lowercases (5TH→5th)')
  assert.equal(nt('90S DANCE PARTY'), '90s Dance Party', 'decade suffix lowercases (90S→90s)')
  // inner sub-segments keep their caps (apostrophe / hyphen / dotted forms)
  assert.equal(nt("O'CONNOR PUB"), "O'Connor Pub", "letters after an apostrophe are capitalized, not lowercased")
  assert.equal(nt('ROCK-N-ROLL REVIVAL'), 'Rock-N-Roll Revival', 'each hyphen sub-segment is capitalized')
  // whitespace + empty-paren cleanup (runs on any case) — never blanks a title
  assert.equal(nt('Jazz Night   ()'), 'Jazz Night', 'empty parens + extra whitespace collapsed')
  assert.equal(nt('()'), '()', 'cleanup never blanks a title down to empty (anti-empty guard)')
  // trailing venue duplicate stripped
  assert.equal(nt('Trivia Night - The Bilmar', 'The Bilmar'), 'Trivia Night', 'a trailing " - venue" duplicate is removed')
  assert.equal(nt('Trivia Night @ The Bilmar', 'The Bilmar'), 'Trivia Night', 'a trailing " @ venue" duplicate is removed')
  // a title that IS only the venue must not be emptied
  assert.equal(nt('The Bilmar', 'The Bilmar'), 'The Bilmar', 'venue-strip never empties the whole title')
  // non-strings + blanks survive
  assert.equal(nt(''), '', 'empty string stays empty')
  assert.equal(nt(undefined), undefined, 'non-string passes through')
})

// 3.7P-36 — imageMode quality gate (Decision Layer Phase A). The synchronous
// verdict that lets cards avoid leading with a big green placeholder: a photo
// renders, a photo-less PLACE gets an icon card, a photo-less EVENT goes text-led.
test('3.7P-36 imageMode: photo / icon / text gate (no green placeholder as primary UI)', async () => {
  const { imageMode: im } = await import('../app/src/imageMode.js')
  assert.equal(im({ image: 'https://x/p.jpg' }), 'photo', 'a usable image URL → photo')
  assert.equal(im({ kind: 'place', image: 'https://x/p.jpg' }), 'photo', 'a place WITH a photo still → photo')
  assert.equal(im({ kind: 'place' }), 'icon', 'a place with no photo → icon card (never a big hue block)')
  assert.equal(im({ kind: 'place', image: '' }), 'icon', 'an empty image string is not a photo')
  assert.equal(im({}), 'text', 'an event with no photo → text-led')
  assert.equal(im({ image: null }), 'text', 'a null image → text-led')
  assert.equal(im(undefined), 'text', 'no event object → text-led (defensive)')
})

// WS4 (cohesion/aurora) — the photo-filter tautology fix. imageMode() has only
// ever returned 'photo'|'icon'|'text', so the Spots rails' `!== 'none'` filter
// was ALWAYS TRUE — "closest with real photos first" (SP-L3 / SPOTS P1b) silently
// never happened. photoFirst() is the intended predicate as a count-preserving
// stable partition; this pins the helper AND the call sites so the tautology
// can't creep back.
test('WS4 photoFirst: photos lead, order stable, nothing dropped; the !== none tautology is gone', async () => {
  const { imageMode: im, photoFirst } = await import('../app/src/imageMode.js')
  // the root cause, pinned: 'none' is not a value imageMode can return
  for (const e of [{ image: 'https://x/p.jpg' }, { kind: 'place' }, {}, undefined]) {
    assert.notEqual(im(e), 'none', 'imageMode never returns "none" — consumers must compare against real modes')
  }
  const a = { key: 'a', kind: 'place' }
  const b = { key: 'b', kind: 'place', image: 'https://x/b.jpg' }
  const c = { key: 'c', kind: 'place' }
  const d = { key: 'd', kind: 'place', image: 'https://x/d.jpg' }
  const out = photoFirst([a, b, c, d])
  assert.deepEqual(out.map((x) => x.key), ['b', 'd', 'a', 'c'], 'photo-bearing lead; both partitions keep incoming order (stable)')
  assert.equal(out.length, 4, 'count-preserving: reorder only, never hide')
  assert.deepEqual(photoFirst([a, c]).map((x) => x.key), ['a', 'c'], 'an all-art pool passes through — rails still fill when photo supply is thin')
  assert.deepEqual(photoFirst([]), [], 'empty in, empty out')
  assert.deepEqual(photoFirst(null), [], 'null-safe (lazy store not yet loaded)')
  // call sites: LocationsView orders with the real predicate, not the tautology
  const loc = readFileSync(path.join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  assert.ok(!/!==\s*'none'/.test(loc), "the `imageMode(p) !== 'none'` tautology is gone from LocationsView")
  assert.ok(/photoFirst\(/.test(loc), 'LocationsView orders its rails/sections with photoFirst (photos lead, count-preserving)')
})

// WS4 item 2 — photo-first ordering inside the MIXED place feeds (count-
// preserving; never-hide holds because photoFirst is a stable reorder, not a
// filter). The Spots master order + the See-all destination both lead with
// photo-bearing places so a screenful reads composed, not lottery.
test('WS4 photo-first feeds: Spots master order + PlaceBubblePage results lead with photos (reorder only)', () => {
  const loc = readFileSync(path.join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  assert.ok(/photoFirst\(placeOrder\(/.test(loc), 'the Spots master list is photoFirst(placeOrder(...)) — photos lead, vibe order within')
  const pbp = readFileSync(path.join(ROOT, 'app', 'src', 'PlaceBubblePage.jsx'), 'utf8')
  assert.ok(/photoFirst\(/.test(pbp), 'PlaceBubblePage result feed is photo-first (count-preserving reorder)')
  assert.ok(/\.filter\(bubble\.match\)/.test(pbp), 'PlaceBubblePage still filters ONLY by the bubble predicate (photoFirst reorders, never hides)')
})

// WS4 item 3 — the 'icon' row form imageMode's own spec promised (3.7P-36:
// photo-less place → "a compact icon/text card (NOT a big hue block)", Spots
// rows named as the consumer) but no card ever built. A photo-less place row
// now leads with a compact tinted placeType medallion; the Aurora field stays
// full-bleed only where it reads as a designed surface (detail heroes, deck
// cards, carousel tiles). The D1 uniform-row-height invariant is BINDING.
test('WS4 icon row form: photo-less place rows are compact medallion cards, not big hue blocks', () => {
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.ok(/const iconRow = imageMode\(p\) !== 'photo'/.test(cards), 'the SpotCard row derives its form from the imageMode gate (spec finally consumed)')
  assert.ok(/spotcard--row-icon/.test(cards), 'the icon form is a variant CLASS on the same .spotcard--row box (not a new card)')
  assert.ok(/spotcard-medallion/.test(cards) && /medallionVar\(p\)/.test(cards), 'the medallion tints from the deterministic per-place hue jitter (artseed)')
  const css = readFileSync(path.join(ROOT, 'app', 'src', 'cards.css'), 'utf8')
  // D1 BINDING: one uniform row height for every result row — the box is untouched
  assert.ok(/\.spotcard--row\s*\{[^}]*height:\s*var\(--card-row-h\)/s.test(css), 'the icon form keeps the D1 uniform row height (same .spotcard--row box)')
  assert.ok(/\.spotcard--row \.spotcard-medallion\s*\{[\s\S]*?hsl\(var\(--mh/.test(css), 'the medallion background keys off --mh (per-place, deterministic)')
  // the designed-field surfaces keep the full-bleed aurora (detail heroes + deck)
  const pd = readFileSync(path.join(ROOT, 'app', 'src', 'PlaceDetail.jsx'), 'utf8')
  assert.ok(/imgbox-art/.test(pd), 'PlaceDetail art heroes keep the full-bleed aurora field')
  const deck = readFileSync(path.join(ROOT, 'app', 'src', 'CalibrationDeck.jsx'), 'utf8')
  assert.ok(/<CardImg e=\{e\} className="deck-img"/.test(deck), 'deck cards keep the full-bleed CardImg (aurora reads designed at card scale)')
})

// WS4 item 4 — the photo-less detail hero drops to a designed ~26svh band; a
// REAL-photo hero keeps the full 42svh (a photo earns the space). Both detail
// paths share the .detail-hero.imgbox-art form, so one rule covers events +
// places; the evt-hero View-Transition contract is unchanged.
test('WS4 detail hero: art-floor hero is a ~26svh band, photo hero keeps 42svh, morph contract intact', () => {
  const appCss = readFileSync(path.join(ROOT, 'app', 'src', 'App.css'), 'utf8')
  assert.ok(/\.detail-hero\s*\{[^}]*height:\s*42svh/s.test(appCss), 'the photo hero keeps its full 42svh')
  assert.ok(/\.detail-hero\.imgbox-art\s*\{[^}]*height:\s*26svh/s.test(appCss), 'the photo-less (art-floor) hero drops to the 26svh band')
  // both detail paths reach the rule through the same shared class + keep the
  // same viewTransitionName, so the thumb→hero morph contract is untouched
  for (const f of ['DetailPage.jsx', 'PlaceDetail.jsx']) {
    const src = readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
    assert.ok(/'detail-hero' \+ \(heroArt \? ' imgbox-art' : ''\)/.test(src), `${f} art hero wears the shared .imgbox-art class`)
    assert.ok(/viewTransitionName: 'evt-hero'/.test(src), `${f} hero keeps the evt-hero morph name`)
  }
})

// WS4 item 5 — the aurora recipe stays CALM: every hsl() in the .imgbox-art
// field sits at S ≤ 46% (the old S~50% blobs fought the warm Sunlit Coastal Pop
// palette and pushed the field toward "broken photo"; the refs carry zero
// saturated cool tiles). Hue/taste values are Charles's to retune — this only
// tripwires the saturation creeping back up. Determinism is covered by the 3.8
// aurora test (seed math untouched).
test('WS4 aurora calm: the imgbox-art field saturation stays muted (S <= 46%)', () => {
  const css = readFileSync(path.join(ROOT, 'app', 'src', 'cards.css'), 'utf8')
  const art = css.match(/\.imgbox-art\s*\{[\s\S]*?\n\}/)
  assert.ok(art, 'the .imgbox-art recipe exists')
  const sats = [...art[0].matchAll(/hsl\(var\(--[a-z0-9]+,? ?\d*\)\s+(\d+)%/g)].map((m) => Number(m[1]))
  assert.ok(sats.length >= 5, `found the field's hsl() saturation channels (got ${sats.length})`)
  for (const s of sats) assert.ok(s <= 46, `an aurora hsl() saturation crept up to ${s}% (> 46% reads hot against the warm palette)`)
})

// CARD_LOCK (Phase 0) — the canonical result card. The dense CompactRow + the
// editorial Row are RETIRED; ONE kind-aware ResultCard (GemRow event / SpotCard
// place) renders every vertical result feed via RowFeed.
test('CARD_LOCK: ResultCard is the kind-aware canonical card; CompactRow/Row retired', () => {
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.ok(/export const ResultCard = memo\(/.test(cards), 'cards.jsx exports a memo ResultCard (the canonical result card)')
  assert.ok(/e\.kind === 'place' \? <SpotCard/.test(cards), 'ResultCard renders SpotCard (row form) for a place')
  assert.ok(/: <GemRow e=/.test(cards), 'ResultCard renders GemRow for an event')
  assert.ok(/<ResultCard /.test(cards), 'RowFeed renders the canonical ResultCard')
  // one card, not three: the dense CompactRow + the editorial Row are GONE
  assert.ok(!/export const CompactRow = memo\(/.test(cards), 'the dense CompactRow is retired')
  assert.ok(!/export const Row = memo\(/.test(cards), 'the editorial Row is retired (consolidated into GemRow)')
  assert.ok(!/compact \? CompactRow/.test(cards), 'RowFeed no longer branches on a compact flag')
  // SpotCard gained the left-image ROW form for feeds (the carousel tile stays default)
  assert.ok(/function SpotCard\(\{ p, onSelect, row = false \}\)/.test(cards), 'SpotCard supports the row form for feeds')
  assert.ok(/spotcard--row/.test(cards), 'SpotCard applies the row class for the feed layout')
  // every result/destination feed renders the canonical card — NONE pass `compact`
  for (const f of ['GuidePage.jsx', 'BubblePage.jsx', 'PlaceBubblePage.jsx', 'SearchPage.jsx', 'LocationsView.jsx']) {
    const src = readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
    assert.ok(/<RowFeed/.test(src), `${f} renders the shared RowFeed`)
    assert.ok(!/<RowFeed[^>]*\scompact/s.test(src), `${f} no longer renders RowFeed in compact mode (canonical card)`)
  }
})

// PREMIUM A2 — the card-system rework (D1–D4). The universal GemRow/SpotCard row
// share ONE fixed height; a tall left image; a bare stroke heart top-right; a real
// CTA bottom-right (the rail is gone); engineered stroke icons; one chip primitive.
test('PREMIUM A2: D1 uniform height · tall image · bare heart · real CTA · stroke icons · chip primitive', () => {
  const idx = readFileSync(path.join(ROOT, 'app', 'src', 'index.css'), 'utf8')
  const cardsCss = readFileSync(path.join(ROOT, 'app', 'src', 'cards.css'), 'utf8')
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  const lib = readFileSync(path.join(ROOT, 'app', 'src', 'lib.js'), 'utf8')
  const saves = readFileSync(path.join(ROOT, 'app', 'src', 'saves.js'), 'utf8')

  // D1: ONE shared card height token drives BOTH event + spot rows (no ragged feed)
  assert.ok(/--card-row-h:/.test(idx), 'index.css defines the --card-row-h token (D1: one card height)')
  assert.ok(/\.gem\s*\{[^}]*height:\s*var\(--card-row-h\)/s.test(cardsCss), '.gem height is the shared --card-row-h')
  assert.ok(/\.spotcard--row\s*\{[^}]*height:\s*var\(--card-row-h\)/s.test(cardsCss), '.spotcard--row height is the SAME --card-row-h (uniform with events)')
  // D2: the 1px card border is dropped (lean on the shadow)
  assert.ok(!/\.gem\s*\{[^}]*border:\s*1px solid var\(--line\)/s.test(cardsCss), 'D2: the .gem 1px hairline border is dropped')
  // tall left image (was a ~76/84px square thumb)
  assert.ok(/\.gem-img\s*\{[^}]*flex:\s*0 0 102px/s.test(cardsCss), 'the gem image is a tall 102px left hero')
  // D4: the rail is GONE; a bare stroke heart + a real CTA are absolute siblings
  assert.ok(!/gem-rail|spotcard-rail/.test(cards) && !/gem-rail|spotcard-rail/.test(cardsCss), 'D4: the .gem-rail / .spotcard-rail are removed')
  assert.ok(/<SaveHeart e=\{e\} bare \/>/.test(cards), 'GemRow renders the bare top-right SaveHeart')
  assert.ok(/\.save-btn\.save-bare\s*\{/.test(readFileSync(path.join(ROOT, 'app', 'src', 'saves.css'), 'utf8')), 'the bare card-body heart variant exists')
  assert.ok(/\.gem-add,\s*\.spotcard-add\s*\{[^}]*position:\s*absolute/s.test(cardsCss), 'the Add CTA is a real button pinned (absolute) to the card')
  assert.ok(/--cta-rgb:/.test(idx), 'index.css adds the --cta-rgb token for the CTA tint/border')

  // engineered stroke icons replace the raw ♥ ♡ 🔥 📍 ★ on the result cards
  for (const g of ['heart:', 'heartFill:', 'pin:', 'sparkle:']) {
    assert.ok(new RegExp('\\b' + g).test(lib), `Icon set adds the ${g} stroke glyph`)
  }
  assert.ok(/Icon\.heartFill : Icon\.heart/.test(saves) && !/'♥'|'♡'/.test(saves), 'SaveHeart renders the stroke heart (no ♥/♡ emoji)')
  assert.ok(/<PinIcon \/>/.test(cards) && /<FlameIcon \/>/.test(cards) && /<SparkleIcon \/>/.test(cards), 'the card meta uses the stroke pin/flame/sparkle (not 📍🔥★)')

  // ONE chip primitive (D2) + the card-title token
  assert.ok(/\.chip,\s*\.gem-chip,\s*\.featc-chip,\s*\.spot-amen\s*\{/s.test(cardsCss), 'the four chip treatments collapse into one primitive')
  assert.ok(/--t-card-size:/.test(idx) && /var\(--t-card-size\)/.test(cardsCss), 'the card-title token (--t-card) is defined and applied')
})

// PREMIUM A4 — the depth (elevation scale) + motion systems. Locks: the ranked
// shadow tokens + their assignment, the press-tighten, the shared primary recipe,
// and the motion set (confirmed planner sheet, skeleton, blur-up, carousel stagger, tab settle,
// symmetric sheet close) — every motion reduced-motion-safe.
test('PREMIUM A4: elevation scale + motion (depth tokens, press, confirmed planner sheet, skeleton, blur-up, reduced-motion)', () => {
  const idx = readFileSync(path.join(ROOT, 'app', 'src', 'index.css'), 'utf8')
  const cardsCss = readFileSync(path.join(ROOT, 'app', 'src', 'cards.css'), 'utf8')
  const appCss = readFileSync(path.join(ROOT, 'app', 'src', 'App.css'), 'utf8')
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  const detail = readFileSync(path.join(ROOT, 'app', 'src', 'DetailPage.jsx'), 'utf8')
  const placeDetail = readFileSync(path.join(ROOT, 'app', 'src', 'PlaceDetail.jsx'), 'utf8')
  const day = readFileSync(path.join(ROOT, 'app', 'src', 'DayPage.jsx'), 'utf8')
  const dayCss = readFileSync(path.join(ROOT, 'app', 'src', 'day.css'), 'utf8')
  const saves = readFileSync(path.join(ROOT, 'app', 'src', 'saves.css'), 'utf8')
  const nav = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')

  // DEPTH: the ranked elevation scale + back-compat alias
  for (const t of ['--shadow-1:', '--shadow-2:', '--shadow-3:', '--shadow-sheet:', '--shadow-press:']) {
    assert.ok(idx.includes(t), `index.css defines ${t}`)
  }
  assert.ok(/--shadow-card:\s*var\(--shadow-2\)/.test(idx), '--shadow-card is kept as a var(--shadow-2) alias (existing consumers unchanged)')
  // assigned by importance: result rows → shadow-1, featured → shadow-3
  assert.ok(/\.gem,\s*\.spotcard--row\s*\{[^}]*box-shadow:\s*var\(--shadow-1\)/s.test(cardsCss), 'result cards → --shadow-1 (soft rows)')
  assert.ok(/\.featc\s*\{\s*box-shadow:\s*var\(--shadow-3\)/.test(cardsCss), 'featured card → --shadow-3')
  // press answer: shadow tightens on :active
  assert.ok(/\.gem:active,[\s\S]*?box-shadow:\s*var\(--shadow-press\)/.test(cardsCss), 'cards tighten the shadow on :active (--shadow-press)')
  // shared primary-button recipe — EXPLICIT per-CTA membership (not order-dependent
  // bracketing) so dropping ANY laggard CTA from the recipe selector list fails again
  const recipeBlock = (appCss.match(/\.btn-primary[\s\S]*?box-shadow: 0 4px 14px[^}]*\}/) || [''])[0]
  assert.ok(/inset 0 1px 0 rgba\(255, 255, 255/.test(recipeBlock), 'the shared glow+sheen recipe block exists (inset top-sheen)')
  for (const cls of ['.btn-primary', '.featc-add', '.ep-save', '.pf-ask-yes', '.loc-plan-add', '.flt-submit', '.tune-cta', '.empty-cta', '.ms-tab-sel']) {
    assert.ok(new RegExp(cls.replace('.', '\\.') + '\\s*[,{]').test(recipeBlock), `the premium-button recipe must cover ${cls} (drop it and this fails)`)
  }
  // V1 B1: the shared empty-state CTA joins the recipe (D.0-R-safe --cta fill + the --accent-rgb glow)
  assert.ok(/\.empty-cta,/.test(appCss) && /\.empty-cta \{[\s\S]*?background: var\(--cta\)/.test(appCss), 'V1 B1: the .empty-cta joins the premium recipe with a D.0-R-safe --cta fill')
  // hero vignette gained a radial layer
  assert.ok(/\.detail-hero-grad\s*\{[\s\S]*?radial-gradient/.test(appCss), 'the detail hero scrim layers a radial vignette')

  // MOTION + trust: card CTAs are doorways, then a focus-managed sheet confirms
  // the exact day/daypart. The filled slot owns the gold confirmation beat.
  assert.ok(/function AddButton/.test(cards) && /else openDetail\(e\)/.test(cards), 'an unplanned card opens detail instead of silently writing a slot')
  assert.ok(/planned && plannedPlacement[\s\S]*?openDay\(plannedPlacement\.dayTs\)/.test(cards), 'a planned card becomes a reactive View-plan doorway')
  for (const [name, src] of [['DetailPage', detail], ['PlaceDetail', placeDetail]]) {
    assert.ok(/planClosing/.test(src) && /className=\{'loc-plan-wrap' \+ \(planClosing \? ' closing' : ''\)\}/.test(src), `${name} plays the symmetric sheet close`)
    assert.ok(/reduced \? 0 : 240/.test(src), `${name} makes the sheet close instant under reduced motion`)
    assert.ok(/aria-modal="true"/.test(src) && /aria-busy=\{planPending \|\| undefined\}/.test(src), `${name} exposes modal + pending state during the confirmed write`)
  }
  assert.ok(/setJustFilled\(part\)/.test(day) && /\.dpg-filled\.pop\s*\{\s*animation:\s*slotPop/.test(dayCss), 'a confirmed fill plays slotPop on the destination slot')
  // skeleton + blur-up
  assert.ok(/export function SkeletonRow/.test(cards) && /@keyframes skel/.test(cardsCss), 'first-load skeleton (SkeletonRow + .skel shimmer)')
  assert.ok(/\.imgbox-img\s*\{[\s\S]*?filter:\s*blur\(8px\)/.test(cardsCss), 'image blur-up settle on load')
  // carousel stagger + tab-tap settle
  assert.ok(/\.carousel-stagger\s*>\s*\*/.test(cardsCss), 'carousel first-paint stagger')
  assert.ok(/@keyframes tabSettle/.test(appCss) && /tab-settle/.test(nav), 'tab-TAP content settle (goTo adds .tab-settle)')
  // savePop reward glow survives on the SVG heart (filter, not just text-shadow)
  assert.ok(/@keyframes savePop[\s\S]*?filter:\s*drop-shadow/.test(saves), 'the save reward glow rides filter:drop-shadow (SVG heart)')

  // REDUCED-MOTION: every new motion is reset
  assert.ok(/prefers-reduced-motion:\s*reduce[\s\S]*?\.imgbox-img\s*\{[^}]*filter:\s*none/.test(cardsCss), 'reduced-motion stills the blur-up')
  assert.ok(/prefers-reduced-motion:\s*reduce[\s\S]*?\.carousel-stagger\s*>\s*\*/.test(cardsCss), 'reduced-motion stills the carousel stagger')
  assert.ok(/prefers-reduced-motion:\s*reduce[\s\S]*?\.skel\s*\{[^}]*animation:\s*none/.test(cardsCss), 'reduced-motion stills the skeleton shimmer')
  assert.ok(/prefers-reduced-motion:\s*reduce[\s\S]*?\.page\.tab-settle/.test(appCss), 'reduced-motion stills the tab settle')
})

// 3.7P-34 — event detail goes planner-first: the primary sticky CTA is "Add to
// day" (mirrors PlaceDetail's plan bridge); the official event/ticket link is
// demoted to a secondary util action. A dated event plans onto ITS OWN day.
test('3.7P-34 event-detail: planner-first Add-to-day CTA + demoted event link', () => {
  const dp = readFileSync(path.join(ROOT, 'app', 'src', 'DetailPage.jsx'), 'utf8')
  assert.ok(/usePlanner/.test(dp) && /status: plannerStatus/.test(dp), 'DetailPage reads the reactive atomic planner provider')
  assert.ok(!/\bloadDayPlans\b|\bsaveDayPlans\b|\bplanItem\b|\bdayEntryFor\b/.test(dp), 'DetailPage has no V1 planner reader/writer path')
  assert.ok(/daypartOf/.test(dp), 'uses daypartOf for the natural slot suggestion')
  // Stage R: the primary is now an honest day-specific label (Add to tonight /
  // Add to Friday night) in a two-button action bar (Save + Add). canPlan gates it.
  assert.ok(/＋ \{addLabel\}/.test(dp) && /canPlan \?/.test(dp), 'the primary CTA is the planner Add when the event can be planned')
  assert.ok(/Add to tonight/.test(dp) && /Add to \$\{d0\.label\}/.test(dp), 'the Add label is day-specific + honest (event own day + natural daypart)')
  assert.ok(/detail-actionbar/.test(dp) && /detail-save-btn/.test(dp), 'the bottom bar pairs Save + the primary (two-button)')
  assert.ok(/await add\(e, \{ dayTs: curDay, part \}\)/.test(dp), 'the confirmed action sends the exact selected day and daypart')
  assert.ok(/code === 'duplicate'/.test(dp) && /code === 'slot-occupied'/.test(dp) && /code === 'rest-conflict'/.test(dp), 'addToPlan surfaces duplicate, occupied-slot, and rest conflicts')
  assert.ok(/planned && plannedPlacement/.test(dp) && /openDay\(plannedPlacement\.dayTs\)/.test(dp) && />\s*View plan\s*</.test(dp), 'a planned event routes to its exact stored day instead of offering Add again')
  assert.ok(/plannerReady/.test(dp) && /Loading plans/.test(dp) && /Plans unavailable/.test(dp), 'non-ready planner states cannot expose an enabled false-success CTA')
  assert.ok(/lifecycle\.actionable && e\.url/.test(dp) && /!lifecycle\.actionable \?/.test(dp), 'event and ticket actions disappear when retained inventory is unavailable')
  assert.ok(/function eventPlanDays/.test(dp) && /Math\.max\(e\._day, anchors\.todayTs\)/.test(dp), 'plan days are clamped to the event run (its own day), never arbitrary')
  assert.ok(/aria-modal="true"/.test(dp) && /planSheetRef/.test(dp) && /planBtnRef\.current\?\.focus\(\)/.test(dp), 'the add-to-day sheet is a focus-managed dialog (focus in + return to trigger)')
})

// WS2 detail-rebuild — the event detail ports PlaceDetail's Stage-R light-title
// pattern: eyebrow (honest short WHEN) → title → venue sit BELOW the clean hero
// on light; the over-hero white title + heavy scrim retired; the hero KEEPS the
// 'evt-hero' viewTransitionName (the card→detail morph contract); the title
// wraps unbroken garbage-source strings (live-capture defect #1, display half).
test('WS2 detail-rebuild: light title block below the hero + VT name intact', () => {
  const dp = readFileSync(path.join(ROOT, 'app', 'src', 'DetailPage.jsx'), 'utf8')
  assert.ok(!/detail-hero-text/.test(dp), 'the over-hero title block is retired (title lives below the hero)')
  assert.ok(/detail-eyebrow/.test(dp) && /className="detail-title"/.test(dp) && /detail-venue/.test(dp), 'DetailPage renders eyebrow + title + venue below the hero')
  assert.ok(dp.indexOf('detail-eyebrow') < dp.indexOf('className="detail-title"'), 'the eyebrow sits above the title')
  assert.ok(dp.indexOf('detail-body') < dp.indexOf('detail-eyebrow'), 'the title block lives in the light body, not the hero')
  assert.ok(/viewTransitionName: 'evt-hero'/.test(dp), 'the detail hero still owns the evt-hero VT name (morph contract)')
  const appCss = readFileSync(path.join(ROOT, 'app', 'src', 'App.css'), 'utf8')
  assert.ok(/\.detail-title\s*\{[^}]*overflow-wrap:\s*anywhere/.test(appCss), 'a long unbroken title wraps instead of clipping (defect #1)')
  assert.ok(/\.detail-title\s*\{[^}]*font-weight:\s*800/.test(appCss), 'the title is ink 800 (Stage-R), not the over-hero 900')
  assert.ok(/\.detail-eyebrow\s*\{[^}]*var\(--accent-ink\)/.test(appCss), 'the eyebrow reads --accent-ink (AA accent text)')
  assert.ok(/\.detail-hero-grad-ev/.test(appCss) && /detail-hero-grad detail-hero-grad-ev/.test(dp), 'the event hero wears the chrome-only scrim variant')
  // WS2 2/4 — the hero TIME BADGE: card imgbadge geometry on the sanctioned --cta
  // fill (D.0-R: the one white-text fill), gated exactly like GemRow's badge
  // (a real start time, never an ongoing run — no fabricated times).
  assert.ok(/heroTime = !e\._ongoing \? timeOf\(e\.start\) : ''/.test(dp), 'the hero time badge wears GemRow\'s honesty gate (real start time, not ongoing)')
  assert.ok(/\{heroTime && <span className="imgbadge detail-timebadge">/.test(dp), 'the badge renders only when a time exists (imgbadge geometry reused)')
  const detailCss = readFileSync(path.join(ROOT, 'app', 'src', 'detail.css'), 'utf8')
  assert.ok(/\.detail-timebadge\s*\{[^}]*background:\s*var\(--cta\)/.test(detailCss), 'the badge fill is --cta (the one sanctioned white-text fill, D.0-R)')
  // WS2 3/4 — "Why this fits" is a titled prose CARD composed ONLY from ratified
  // true signals (whyReasons + the real event-day forecast via wxMood); zero
  // reasons → NO card (never fabricated). The bare why-chips fact row retired.
  assert.ok(/function whyProse/.test(dp) && /whyReasons\(e\)/.test(dp) && /wxMood\(w\)/.test(dp), 'whyProse composes from the ratified whyReasons seam + the real forecast')
  assert.ok(/if \(!frags\.length\) return null/.test(dp) && /\{whyLine && \(/.test(dp), 'no real reason → no card (the honest-omission gate)')
  assert.ok(!/className="why-chips"/.test(dp) && !/why-chip\b/.test(dp), 'the bare why-chips fact row is retired (no rendered why-chip)')
  assert.ok(/Why this fits/.test(dp) && /Icon\.sparkle/.test(dp), 'the card carries the refs\' sparkle + title (engineered Icon.sparkle, not a raw glyph)')
  // WS2 4/4 — link-out rows replace the event page's 4-button utility strip.
  // Honesty: every row from real data or absent — hostname sub derived from
  // e.url; Directions distance ONLY from a real upstream _dist; ICS stays
  // reachable as the Add-to-calendar row. (.util-row itself survives — it still
  // serves PlaceDetail.)
  assert.ok(!/className="util-row"/.test(dp), 'the event detail no longer renders the utility strip')
  assert.ok(/detail-links/.test(dp) && /className="dlink"/.test(dp), 'the refs\' link-out rows render instead')
  assert.ok(/e\._dist != null/.test(dp) && /toFixed\(1\)\} mi/.test(dp), 'Directions distance renders ONLY from a real computed _dist (never fabricated)')
  assert.ok(/new URL\(e\.url\)\.hostname/.test(dp), 'the official-page sub is the link\'s REAL hostname (derived, not invented)')
  assert.ok(/Add to calendar/.test(dp) && /downloadIcs/.test(dp), 'the ICS affordance survives as the Add-to-calendar row')
})

// 3.7P-39 — section-label honesty (D6 strict): the "Hidden Gems" shelf must not
// carry a job/career/hiring fair. NON_GEM_RE gates the shelf (UI + finder); the
// event still lives in Everything (curation, never hiding).
test('3.7P-39 section-label honesty: job/career fairs are not Hidden Gems', () => {
  const re = lib.NON_GEM_RE
  assert.ok(re.test('Career Glow Up Job Fair'), 'a job fair is excluded from gems')
  assert.ok(re.test('Job News Tampa Job Fair | Multi-Industry Hiring Event'), 'a hiring event is excluded')
  assert.ok(re.test('Spring Career Fair') && re.test('Tech Recruiting Mixer'), 'career fair / recruiting excluded')
  for (const t of ["Children's Theatre", 'Cigar City: Bringing Industry to Tampa', 'GET FIT: Tai Chi', 'Special Guest DJ Encore at Lower Deck']) {
    assert.ok(!re.test(t), 'a real gem is NOT excluded: ' + t)
  }
  const hot = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  assert.ok(!/NON_GEM_RE/.test(hot) && !/Under the radar/.test(hot), 'V1 S1: HotView carries no gem shelf — no NON_GEM_RE, no "Under the radar" section')
  const finder = readFileSync(path.join(ROOT, 'finder', 'finder.mjs'), 'utf8')
  assert.ok(/NON_GEM_RE/.test(finder), 'finder.mjs carries the synced NON_GEM_RE exclusion (clean future runs)')
})

// 3.7P-23/25/39 review — Phase B wiring + cross-surface honesty.
test('3.7P-23/25 wiring: Home compact sections + clean AA-safe guide tiles', () => {
  const hot = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  // CARD_LOCK: Home's secondary sections (Hidden Gems / Recently viewed) render the
  // canonical cards in .home-picks now — the dense CompactRow + feed--compact retired.
  assert.ok(!/<CompactRow /.test(hot), 'HotView no longer uses the retired CompactRow')
  assert.ok(!/feed feed--compact/.test(hot), 'HotView secondary sections are no longer feed--compact')
  assert.ok(/<GemRow /.test(hot) && /<ResultCard /.test(hot), 'HotView renders canonical GemRow / ResultCard for its sections')
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.css'), 'utf8')
  // S1-SP2/SP3: the warm per-hue wash is retired — the tile is a clean white card
  // + neutral hairline; identity moves to the hue-tinted emoji medallion.
  assert.ok(/\.intent-tile \{[^}]*background: var\(--card\)/s.test(cards), '.intent-tile is a clean white card (S1-SP2)')
  assert.ok(/\.intent-tile \{[^}]*border: 1px solid var\(--line\)/s.test(cards), '.intent-tile uses a neutral hairline (S1-SP3)')
  assert.ok(/\.intent-tile-pov \{[^}]*#5f574e/s.test(cards), '.intent-tile-pov keeps the AA-safe text color (now over white)')
  const loc = readFileSync(path.join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  assert.ok(/By activity"\s+sub=/.test(loc), 'the Spots "By activity" header has a POV sub')
})

test('3.7P-23b §N Home: "Your next days" stack + title header + weather line', () => {
  // Stage R nav restructure: the Home dashboard (title + Your-next-days +
  // featured pick) is its own HomeView component now (split out of HotView).
  // V1 H1/H3 → Cohesion R10: the FABRICATED-NAME greeting + heroKicker stay
  // retired, but ruling 2026-07-01 #10 restored an honest name-free time-of-day
  // greeting on the shared .loc-head-title primitive (+ the weather sub).
  const home = readFileSync(path.join(ROOT, 'app', 'src', 'HomeView.jsx'), 'utf8')
  assert.ok(/<NextDays /.test(home), 'HomeView renders the "Your next days" planning stack')
  assert.ok(/loc-head-title">\{greeting\}</.test(home) && !/heroKicker/.test(home), 'R10: Home title = the honest time-of-day greeting on the shared primitive; heroKicker stays retired')
  assert.ok(/Good morning/.test(home) && !/Good (morning|afternoon|evening)['"`]?\s*\+|Good (morning|afternoon|evening), /.test(home), 'R10: the greeting is name-free — no "Good morning, <name>" form and no name concatenation (the H3 honesty bar holds; comments may cite the history)')
  assert.ok(/nowMs/.test(home) && /tonightModel\(/.test(home), 'V1 H3: nowMs is KEPT — it still feeds tonightModel (not just the retired greeting)')
  assert.ok(/wxLine/.test(home), 'the Home header shows the real weather line when loaded')
  const nd = readFileSync(path.join(ROOT, 'app', 'src', 'NextDays.jsx'), 'utf8')
  assert.ok(/usePlanner/.test(nd) && /const \{[^}]*\bstatus\b[^}]*\bgetDay\b[^}]*\} = usePlanner\(\)/.test(nd), 'NextDays subscribes to planner status and the reactive day model')
  assert.ok(/status === 'durable' \|\| status === 'session-only'/.test(nd), 'NextDays distinguishes ready planner data from loading/unavailable states')
  assert.ok(/const day = getDay\(d\.ts\)/.test(nd) && /const n = day\.slots\.length/.test(nd), 'each card derives its rest/filled state from the provider day model')
  assert.ok(!/\bloadDayPlans\b|\bdayEntryFor\b|\bemptyDay\b/.test(nd), 'NextDays has no stale V1 read or fallback object')
  assert.ok(/wxMood|CONDITION/.test(nd), 'NextDays derives its weather line from the real forecast only')
  assert.ok(/openDay\(/.test(nd), 'a day card opens its DayPage (the Discover→Plan bridge)')
})

test('3.7P-23c §N Home: tonight GemRow picks + Quick actions grid (HOME_GRIND)', () => {
  // FeaturedCard still exists and is used by Spots/LocationsView; no longer on Home.
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.ok(/export function FeaturedCard\(/.test(cards), 'FeaturedCard still exists in cards.jsx')
  assert.ok(/featc-add/.test(cards) && /featc-save/.test(cards), 'FeaturedCard still has Add + Save actions (used by Spots)')
  // HOME_GRIND: Home now shows tonight picks as GemRow cards + Quick actions grid.
  const home = readFileSync(path.join(ROOT, 'app', 'src', 'HomeView.jsx'), 'utf8')
  assert.ok(/tonightModel/.test(home), 'HomeView uses tonightModel for tonight picks')
  assert.ok(/<GemRow/.test(home), 'HomeView renders GemRow cards for tonight\'s top picks')
  assert.ok(/intent-grid/.test(home), 'HomeView has a Quick actions intent-grid')
  assert.ok(/openNotifications/.test(home), 'HomeView bell → openNotifications (H-L1)')
  assert.ok(/openForecast/.test(home), 'HomeView "View full forecast" → openForecast (H-L2)')
  assert.ok(/openBubble/.test(home), 'HomeView quick action wires Free tonight → openBubble')
  assert.ok(/openGuide/.test(home), 'HomeView quick action wires Markets/Sports bars → openGuide')
})

test('3.7P-24 §N Spots: SpotCard carousel sections + compact place Everything (SPOTS_GRIND SP-L1/L3)', () => {
  const loc = readFileSync(path.join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  // SP-L3: Recommended now a SpotCard carousel (not a single FeaturedCard); Worth the drive added
  assert.ok(/nearSpots/.test(loc) && /<SpotCard/.test(loc), 'Spots Recommended = SpotCard carousel (SP-L3)')
  assert.ok(/Worth the drive/.test(loc) && /driveSpots/.test(loc), 'Spots has Worth the drive section (SP-L3)')
  assert.ok(/sections={everything}/.test(loc) && !/sections={everything} compact/.test(loc), 'CARD_LOCK: the place Everything feed renders the canonical SpotCard rows (no compact)')
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.ok(/const isPlace = e\.kind === 'place'/.test(cards) && /spotChips\(e\)\.map/.test(cards), 'FeaturedCard is place-aware (activity-first meta + amenity chips)')
  assert.ok(/\{onAdd && \([\s\S]*?<AddButton[\s\S]*?className="featc-act featc-add"/.test(cards), 'the inline planner doorway only renders when onAdd is provided (places open detail to confirm a day)')
  // SP-L1: SpotCard gains honest bestFor line
  assert.ok(/spotBestFor/.test(cards) && /spotcard-bestfor/.test(cards), 'SpotCard renders SP-L1 bestFor line')
})

test('3.7P-41 §N Search: NL example prompts + result-type tabs', () => {
  const sp = readFileSync(path.join(ROOT, 'app', 'src', 'SearchPage.jsx'), 'utf8')
  assert.ok(/NL_EXAMPLES = \[/.test(sp) && /free things tonight/.test(sp), 'Search offers natural-language example prompts')
  // Stage R: All · Events · Spots · Guides (the 4th scope is honest — guides match
  // on name/pov text and render as real GuidePages; the empty-tab filter keeps a
  // 0-match Guides tab hidden). Events split into "Best matches" / "Other events".
  assert.ok(/srch-tabs/.test(sp) && /id: 'events'/.test(sp) && /id: 'spots'/.test(sp) && /id: 'guides'/.test(sp), 'Search has All/Events/Spots/Guides result tabs')
  assert.ok(/t\.id === 'all' \|\| t\.n > 0/.test(sp), 'a result tab is only offered when it has matches (no dead empty tab)')
  assert.ok(/activeTab === 'all' \|\| activeTab === 'events' \? eventSection/.test(sp), 'the validated active tab scopes which groups render')
  assert.ok(/label: 'Best matches'/.test(sp) && /label: 'Other events'/.test(sp) && /Spots that fit/.test(sp), 'sections are labelled Best matches / Other events / Spots that fit')
  assert.ok(/searchGuides\(GUIDES/.test(sp) && /openGuide\(g\)/.test(sp), 'the Guides scope searches real GUIDES and opens their GuidePage')
  const srch = readFileSync(path.join(ROOT, 'app', 'src', 'search.js'), 'utf8')
  assert.ok(/export function searchGuides/.test(srch) && /!q\.text\.length\) return \[\]/.test(srch), 'searchGuides is text-only (a guide has no date/price) — honest, no fabricated matches')
})

test('S1-P3: the Profile header stats-trio is computed from real stores (re-added)', () => {
  // S1-P3 (resolved decision) RE-ADDS the header stats-trio, computed from the real
  // stores (distinct filled days · saves length · didDays size) — never hardcoded.
  // The drill-ins keep their own counts too.
  const pv = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  assert.ok(/pf-stats/.test(pv), 'the header stats-trio is present (S1-P3)')
  assert.ok(/usePlanner\(\)/.test(pv) && /filledDayCount:\s*planCount/.test(pv), 'the plan stat subscribes to the atomic planner filled-day count')
  assert.ok(/didDays\(/.test(pv) && /useSaves\(/.test(pv), 'the days-out and saves stats still derive from their real stores')
  assert.ok(!/\bloadDayPlans\b|\bdayEntryFor\b/.test(pv), 'Profile has no stale V1 planner read')
  const mp = readFileSync(path.join(ROOT, 'app', 'src', 'MyPlansPage.jsx'), 'utf8')
  assert.ok(/filledDayCount:\s*plansCount/.test(mp), 'My Plans uses the provider count of distinct filled active and historical days')
  const ms = readFileSync(path.join(ROOT, 'app', 'src', 'MySavesPage.jsx'), 'utf8')
  assert.ok(/shelf\.length/.test(ms), 'My saves count = the real saved-shelf length')
  assert.ok(!/\b47\b|>128<|>23</.test(pv), 'no hardcoded stat numbers')
})

test('PROFILE_GRIND (final): title + white identity card + pencil + 6 menu cards (no Recently saved)', () => {
  const pv = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  const css = readFileSync(path.join(ROOT, 'app', 'src', 'profile.css'), 'utf8')
  // P1: the page title
  assert.ok(/loc-head-title/.test(pv) && />Profile</.test(pv), 'P1: a "Profile" page title (V1 H1: on the shared .loc-head-title primitive)')
  // P2/P3: WHITE identity card (the old --cta fill is reverted) + monogram avatar
  assert.ok(/pf-id-card/.test(pv), 'P2: the identity card wrapper is present')
  assert.ok(/pf-avatar/.test(pv) && /pf-name/.test(pv) && /pf-loc/.test(pv), 'header = avatar + editable name + city')
  assert.ok(/\.pf-id-card\s*\{[^}]*background:\s*var\(--card\)/.test(css), 'P2: the identity card is WHITE (var(--card), not --cta)')
  assert.ok(!/\.pf-name-block\s*\{[^}]*background:\s*var\(--cta\)/.test(css), 'P2: the colored --cta identity block is gone')
  // honest name + on-device store; no fabricated person / mock numbers
  assert.ok(/profile-name-v1/.test(pv) && /globalGet\(NAME_KEY\)/.test(pv), 'the display name is read from the intentional cross-city profile scope; the write moved to Edit Profile')
  assert.ok(/Add your name/.test(pv) && !/'Alex'/.test(pv), 'name defaults to "Add your name" — never a fabricated name')
  assert.ok(/\{CITY\.name\}/.test(pv), 'city = the app active-city label (CITY.name)')
  assert.ok(!/\b47\b|>128<|>23</.test(pv), 'no hardcoded mock stat numbers (real counts only)')
  // P4: an edit pencil replaces the gear (Settings reachable via its menu row)
  assert.ok(/pf-edit/.test(pv) && /onClick=\{openEditProfile\}/.test(pv), 'P4: the edit pencil opens Edit Profile (PROFILE_PHASE2 absorbed the inline edit)')
  assert.ok(!/pf-gear/.test(pv), 'P4: the old top-right gear button is gone from the view')
  assert.ok(!/\.pf-gear/.test(css), 'P4: the dead .pf-gear CSS is removed')
  // P5: "Saved" label (was "Saves"); the trio is computed from real stores
  assert.ok(/pf-stats/.test(pv) && /'Saved'/.test(pv), 'P5: the stats trio relabels Saves → Saved')
  // P6: the 6-row menu with descriptions + the right openers (path-safety intact)
  for (const label of ['My Plans', 'My Saves', 'Taste Profile', 'Customize Interests', 'Settings & Preferences', 'Help & Feedback']) {
    assert.ok(pv.includes(label), `P6: Profile menu has the "${label}" row`)
  }
  assert.ok(/pf-row-desc/.test(pv), 'P6: rows carry a description line')
  assert.ok(!/pf-row-stub/.test(pv) && !/Coming soon/.test(pv), 'P6: Help & feedback is a normal row (no "Coming soon" stub)')
  assert.ok(/onClick: openMyPlans/.test(pv) && /onClick: openMySaves/.test(pv), 'My Plans/My Saves open the single-slot subpages')
  assert.ok(/onClick: \(\) => openTaste\(\)/.test(pv), 'Taste profile = openTaste() (no settings origin → back to Profile)')
  assert.ok(/openInterests\('profile'\)/.test(pv), "Customize interests = openInterests('profile') (back to the tab)")
  // F6: the menu is 6 SEPARATE cards with circular icon discs (final ref)
  assert.ok(/\.pf-menu\s*\{[^}]*gap:/.test(css), 'F6: the menu is separated cards (gap), not one connected card')
  assert.ok(/\.pf-row-ic\s*\{[^}]*border-radius:\s*(50%|var\(--r-circle\))/.test(css), 'F6: the row icon is a circular disc')
  assert.ok(/\.pf-row\s*\{[^}]*box-shadow:\s*var\(--shadow-1\)/.test(css), 'F6: each menu row is its own white card (PREMIUM A4: row → --shadow-1)')
  // F7: Recently saved is REMOVED entirely (final MVP ref — no section, no See all)
  assert.ok(!/pf-recent/.test(pv) && !/Recently saved/.test(pv), 'F7: the Recently saved section is gone')
  assert.ok(!/shelfItems/.test(pv) && !/GemRow/.test(pv), 'F7: ProfileView no longer imports shelfItems/GemRow')
  // P8: the footer privacy note is gone (it lives in Settings)
  assert.ok(!/pf-foot/.test(pv), 'P8: the footer privacy note is removed')
  // path-safety: nav openers + App subpage shells unchanged
  const nav = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  assert.ok(/setPage\(\{ type: 'myplans' \}\)/.test(nav) && /setPage\(\{ type: 'mysaves' \}\)/.test(nav), 'the My plans/saves openers are the single-slot subpage pattern')
  assert.ok(/from === 'settings' \? 'settings' : null/.test(nav), 'openInterests/openTaste from-guard unchanged (literal === settings)')
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(/page\.type === 'myplans' && <MyPlansPage/.test(app) && /page\.type === 'mysaves' && <MySavesPage/.test(app), 'App renders the My plans + My saves subpages')
})

test('PROFILE_PHASE2: net-new drill-ins (Edit Profile · Help & Feedback) wired + honest', () => {
  const nav = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  const pv = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  // nav openers follow the single-slot pattern + App renders each subpage
  for (const [opener, type] of [['openEditProfile', 'editprofile'], ['openHelpFeedback', 'helpfeedback']]) {
    assert.ok(new RegExp('const ' + opener + ' = useCallback').test(nav), `nav exposes ${opener}`)
    assert.ok(new RegExp("setPage\\(\\{ type: '" + type + "' \\}\\)").test(nav), `${opener} sets {type:'${type}'}`)
    assert.ok(app.includes("page.type === '" + type + "'"), `App renders the ${type} subpage`)
  }
  assert.ok(/import EditProfilePage/.test(app) && /import HelpFeedbackPage/.test(app), 'App imports the 2 net-new pages')
  // the removed Recently Saved destination is fully gone (final MVP wipe)
  assert.ok(!/recentlysaved/.test(nav) && !/recentlysaved/.test(app), 'the Recently Saved opener/route is removed everywhere')
  // ProfileView rewiring: pencil/name → Edit Profile, Help → Help & Feedback
  assert.ok(/onClick=\{openEditProfile\}/.test(pv), 'pencil + name open Edit Profile')
  assert.ok(/onClick: openHelpFeedback/.test(pv), 'Help & feedback row opens Help & Feedback (no dead stub)')
  assert.ok(!/onClick: \(\) => \{\}/.test(pv), 'no dead no-op onClick remains on the Profile menu')
  // Edit Profile: writes the on-device name; honest stubs (never a fabricated person)
  const ep = readFileSync(path.join(ROOT, 'app', 'src', 'EditProfilePage.jsx'), 'utf8')
  assert.ok(/globalSet\(NAME_KEY/.test(ep) && /profile-name-v1/.test(ep), 'Edit Profile writes the on-device cross-city profile name (profile-name-v1)')
  assert.ok(!/'Alex'/.test(ep) && /(Coming soon|Soon)/.test(ep), 'Edit Profile uses honest placeholders, never a fabricated person')
  // Help & Feedback: real mailto actions, not fake UI
  const hf = readFileSync(path.join(ROOT, 'app', 'src', 'HelpFeedbackPage.jsx'), 'utf8')
  assert.ok(/mailto:/.test(hf) && /Contact support/.test(hf) && /Report a problem/.test(hf), 'Help & Feedback rows are real mailto actions')
})

test('3.7P-40 §N Calendar: Upcoming day-stack (NextDays) + date-state legend', () => {
  const cal = readFileSync(path.join(ROOT, 'app', 'src', 'CalendarView.jsx'), 'utf8')
  assert.ok(/<NextDays /.test(cal), 'Calendar renders the Upcoming "Your next days" stack')
  assert.ok(/cal-legend/.test(cal), 'Calendar shows a clear date-state legend')
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(/<CalendarView[^>]*wx=\{wx\}/.test(app), 'App passes wx to CalendarView (forecast on the upcoming cards)')
})

test('3.7P-24 §N spot detail: Best-for (from activity predicates) + honest Watch-out', () => {
  const pd = readFileSync(path.join(ROOT, 'app', 'src', 'PlaceDetail.jsx'), 'utf8')
  assert.ok(/ACTIVITIES\.filter\(\(a\) => a\.match\(e\)\)/.test(pd), 'Best-for is derived from the real ACTIVITIES predicates (never invented)')
  assert.ok(/loc-bestfor/.test(pd) && /loc-watch/.test(pd), 'PlaceDetail renders Best-for + Watch-out sections')
  assert.ok(/check the forecast/.test(pd), 'Watch-out cautions are honest (paid gate + real rainy forecast), not fabricated')
})

// D8 (Stage A5): the Map feature is PARKED for v1 — MapView (and its in-view decision
// deck) is retired; the file is gone, so its §N test is removed with it.

test('3.7P-39 review: every hidden-gem reader honors NON_GEM_RE (no off-shelf "gem" claim)', () => {
  const taste = readFileSync(path.join(ROOT, 'app', 'src', 'taste.js'), 'utf8')
  assert.ok(/hidden-gem'\) && !NON_GEM_RE\.test/.test(taste), 'whyReasons gates the "Hidden gem" reason chip with NON_GEM_RE')
  const curate = readFileSync(path.join(ROOT, 'app', 'src', 'curate.js'), 'utf8')
  assert.ok(/hidden-gem'\) && !NON_GEM_RE\.test/.test(curate), 'frontPagePredicate gates the gem-by-fiat promotion with NON_GEM_RE')
})

// ============================================================
// Addendum O — SEAM LOCK (§O.4). Source-grep asserts that pin the load-bearing
// nav wiring so the Decision-Layer surface rework cannot silently break one of
// the §O.1 do-not-break flows. These survive refactors of the surfaces above.
// ============================================================
test('Addendum O seam-lock: nav.jsx VT morph + Escape layering + openDetail signal', () => {
  const nav = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  assert.ok(/viewTransitionName = 'evt-hero'/.test(nav), 'card→detail VT morph name is evt-hero')
  assert.ok(/recordSignal\('open', e\)/.test(nav) && /recordView\(e\)/.test(nav), 'openDetail records taste signal + recents view atomically')
  // Escape closes detail BEFORE page (bubble phase; capture-phase sheets run first)
  assert.ok(/if \(detail\) closeDetail\(\)/.test(nav) && /else if \(page && !pageClosing\) closePage\(\)/.test(nav), 'Escape closes detail-before-page')
  assert.ok(nav.indexOf('if (detail) closeDetail') < nav.indexOf('closePage()'), 'detail is closed before page on Escape')
  // D8: the Map sub-view + focusMap are PARKED for v1 — assert they're gone.
  assert.ok(!/const focusMap = useCallback/.test(nav), 'focusMap is removed (map parked, D8)')
  assert.ok(!/setPage\(\{ type: 'map' \}\)/.test(nav), 'nav opens no Map sub-view (map parked, D8)')
})

// Stage R nav restructure (§P.5): the tab roster is Home · Events · Spots · Plan ·
// Profile. D8 (A5): the Map is PARKED for v1 — no longer a tab AND no longer a
// sub-view; MapView.jsx is retired. IDs stay stable for the seams that key on them.
test('Stage R nav: roster is home/hot/locations/calendar/profile, Map is PARKED', () => {
  const nav = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  for (const id of ['home', 'hot', 'locations', 'calendar', 'profile']) {
    assert.ok(new RegExp(`id: '${id}'`).test(nav), `VIEWS must include the '${id}' tab`)
  }
  assert.ok(!/\{ id: 'map'/.test(nav), 'Map must NOT be a tab in VIEWS')
  // Cohesion WS2: hardware/browser back closes layers instead of exiting the app.
  // Both halves pinned: layers PUSH marker entries, and popstate runs the REAL
  // closers (all closes flow through history so depth can never desync).
  assert.ok(/history\.pushState\(\{ wzDepth/.test(nav) && /addEventListener\('popstate'/.test(nav), 'WS2: open layers push history markers + a popstate handler closes them')
  assert.ok(/closeDetailNow\(\)\s*[\s\S]{0,40}open--/.test(nav) && /if \(open > target && pageOpenRef\.current\) closePageNow\(\)/.test(nav), 'WS2: popstate closes detail-first then page (the Escape ladder order)')
  assert.ok(/id: 'calendar', label: 'Plan'/.test(nav), "the 4th tab is labelled 'Plan' (ruling 2026-07-01 #4, reversing S1-C1; id stays 'calendar')")
  // D8: map parked — no opener, no sub-view render, no MapView file.
  assert.ok(!/const openMap = useCallback/.test(nav), 'openMap is removed (map parked, D8)')
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(!/<MapView/.test(app) && !/page\.type === 'map'/.test(app), 'App renders no Map sub-view (map parked, D8)')
  assert.ok(/<HomeView /.test(app), 'App mounts the new Home dashboard tab')
  assert.ok(!existsSync(path.join(ROOT, 'app', 'src', 'MapView.jsx')), 'MapView.jsx is retired (map parked, D8)')
})

test('Addendum O seam-lock: App.jsx detail-after-subpage order + DayPage key + subpage union', () => {
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(/key=\{page\.ts \+ '-' \+ anchors\.todayTs\}/.test(app), 'DayPage key includes anchors.todayTs (midnight remount)')
  assert.ok(/detail && detail\.kind === 'place'/.test(app) && /detail && detail\.kind !== 'place'/.test(app), 'detail renders PlaceDetail for places, DetailPage for events')
  assert.ok(app.lastIndexOf('page.type ===') < app.indexOf('detail && detail.kind'), 'the detail layer renders AFTER the subpage union (z-order + Escape layering)')
  for (const t of ['bubble', 'placebubble', 'guide', 'search', 'add', 'day', 'settings', 'interests', 'taste', 'deck', 'lensdeck']) {
    assert.ok(new RegExp("page\\.type === '" + t + "'").test(app), `subpage route '${t}' is wired`)
  }
})

test('Addendum O seam-lock: PickerSheet Escape is capture-phase (closes the sheet, not the page)', () => {
  const ps = readFileSync(path.join(ROOT, 'app', 'src', 'PickerSheet.jsx'), 'utf8')
  assert.ok(/window\.addEventListener\('keydown', onKey, true\)/.test(ps) && /ev\.stopPropagation\(\)/.test(ps), 'PickerSheet Escape is capture-phase + stopPropagation')
})

test('CARD_LOCK seam-lock: one kind-aware ResultCard feeds every result list', () => {
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.ok(/export const ResultCard = memo\(/.test(cards), 'the canonical ResultCard exists (memo)')
  assert.ok(/<ResultCard /.test(cards), 'RowFeed renders the ResultCard (no Row/CompactRow branch)')
  assert.ok(!/export const CompactRow = memo\(/.test(cards) && !/export const Row = memo\(/.test(cards), 'CompactRow + the editorial Row are retired')
})

// 3.7P-35 review (integration): cleaning the display title must NOT shift an
// event's identity. keyOf for a url-less event keys off the STASHED original, so
// a save/recents/day-plan key written before title-norm still resolves.
test('3.7P-35 keyOf stays stable for a url-less event after title cleanup', () => {
  const AN = lib.makeAnchors(new Date('2026-06-16T12:00:00'))
  const ev = lib.normalize({ title: 'LIVE JAZZ NIGHT', start: '2026-07-01T19:00' }, AN) // no url
  assert.equal(ev.title, 'Live Jazz Night', 'the DISPLAY title is cleaned')
  assert.equal(lib.keyOf(ev), 'LIVE JAZZ NIGHT|2026-07-01T19:00', 'keyOf keys off the ORIGINAL title, not the cleaned one')
  // a raw snapshot (no _keyTitle) falls back to its own raw title → same key
  assert.equal(lib.keyOf({ title: 'LIVE JAZZ NIGHT', start: '2026-07-01T19:00' }), 'LIVE JAZZ NIGHT|2026-07-01T19:00', 'a raw object resolves to the identical key')
  // a url event is unaffected (keys off url)
  const ue = lib.normalize({ title: 'LOUD SHOW', url: 'https://x/y', start: '2026-07-01T20:00' }, AN)
  assert.equal(lib.keyOf(ue), 'https://x/y|2026-07-01T20:00', 'url events key off url regardless of title')
})

// ============================================================
// Sprint S — the LOCATIONS layer: places.js pure logic + the generated
// places.json the tab consumes. Places are a SEPARATE store from events.
// ============================================================
test('places.js: normalizePlace aliases name→title, defaults category, rejects junk', () => {
  const raw = { key: 'p|fort-de-soto-park', kind: 'place', name: 'Fort De Soto Park', placeType: 'park', classes: ['park', 'beach'], category: 'outdoors', lat: 27.63, lng: -82.72, address: '3500 Pinellas Bayway', isFree: true, sources: ['Pinellas Park Points', 'OSM'], srcCount: 2, hiddenScore: 0, hidden: false }
  const p = placesMod.normalizePlace(raw)
  assert.equal(p.title, 'Fort De Soto Park', 'title must alias name (cards.jsx reads e.title)')
  assert.equal(p.venue, '3500 Pinellas Bayway', 'venue must alias address')
  assert.equal(p.kind, 'place')
  assert.equal(p._free, true, 'isFree:true → _free:true (FREE badge + free filter)')
  assert.equal(p.category, 'outdoors')
  // keyOf must honor the place key (the shared save/taste/recents seam)
  assert.equal(lib.keyOf(p), 'p|fort-de-soto-park', 'keyOf must return the p| key for a place')
  // defaults + rejection
  assert.equal(placesMod.normalizePlace({ key: 'p|x', name: 'X', lat: 28, lng: -82 }).category, 'outdoors', 'missing category defaults to outdoors')
  assert.equal(placesMod.normalizePlace({ key: 'p|x', name: '', lat: 28, lng: -82 }), null, 'nameless place → null')
  assert.equal(placesMod.normalizePlace({ name: 'no key', lat: 28, lng: -82 }), null, 'keyless place → null')
  assert.equal(placesMod.normalizePlace({ key: 'p|x', name: 'X', lat: 'nope', lng: -82 }), null, 'non-numeric coords → null')
})

test('places.js: the bubbles partition sensibly + the reconciled filter chips + classics', () => {
  const ids = placesMod.PLACE_BUBBLES.map((b) => b.id)
  assert.equal(ids.length, 10, 'the Locations bubbles incl. the reconciled Easy Walk + Open Now chips')
  const mk = (over) => placesMod.normalizePlace({ key: 'p|t', name: 'T', lat: 28, lng: -82, placeType: 'park', classes: [], amenities: [], srcCount: 1, ...over })
  const find = (id) => placesMod.PLACE_BUBBLES.find((b) => b.id === id)
  assert.ok(find('beaches').match(mk({ placeType: 'beach' })), 'a beach matches Beaches')
  assert.ok(find('dog').match(mk({ classes: ['dog_park'] })), 'a dog_park matches Dog Friendly')
  assert.ok(find('free').match(mk({ isFree: true })), 'a free place matches Free')
  assert.ok(find('hidden').match(mk({ hidden: true })), 'a hidden place matches Hidden')
  assert.ok(!find('hidden').match(mk({ hidden: false })), 'a non-hidden place does NOT match Hidden')
  assert.ok(find('courts').match(mk({ amenities: ['pickleball'] })), 'a pickleball court matches Courts & rec')
  // Spots-full: the reconciled filter chips (ref-spots-full) map to REAL predicates
  assert.equal(find('views').label, 'Water Views', 'the views chip is relabeled "Water Views"')
  assert.ok(find('easywalk').match(mk({ placeType: 'garden' })) && find('easywalk').match(mk({ amenities: ['boardwalk'] })), 'Easy Walk matches gardens / boardwalks')
  assert.equal(typeof placesMod.isOpenNow, 'function', 'isOpenNow is exported (the Open Now predicate)')
  assert.equal(find('open').match, placesMod.isOpenNow, 'the Open Now chip uses isOpenNow')
  assert.equal(placesMod.isOpenNow({ hours: '24/7' }), true, '24/7 reads as open')
  assert.equal(placesMod.isOpenNow({ hours: '' }), false, 'unknown hours are NEVER claimed open (honesty)')
  // classics = corroborated across 3+ sources
  const list = [mk({ srcCount: 3 }), mk({ srcCount: 1 }), mk({ srcCount: 5 })]
  assert.equal(placesMod.classics(list).length, 2, 'classics keeps only srcCount>=3')
})

test('places data: app/public/places.json normalizes whole + every bubble has members', () => {
  const APP_PLACES = path.join(ROOT, 'app', 'public', 'places.json')
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const norm = doc.places.map(placesMod.normalizePlace)
  assert.ok(norm.every(Boolean), 'every place in places.json normalizes (no nulls)')
  assert.ok(norm.every((p) => typeof p.title === 'string' && p.title), 'every normalized place has a title')
  // no empty bubble — an empty Locations bubble is a demo wince (review UX guard)
  for (const b of placesMod.PLACE_BUBBLES) {
    const n = norm.filter(b.match).length
    assert.ok(n >= 1, `Locations bubble "${b.id}" has ${n} members — an empty bubble ships a dead end`)
  }
  // a benchmark place is present + renders (title aliased)
  const honeymoon = norm.find((p) => p.key === 'p|honeymoon-island-state-park')
  assert.ok(honeymoon && honeymoon.title.includes('Honeymoon'), 'Honeymoon Island present + titled')
})

// Sprint S review must-fix: a saved PLACE must round-trip back to PlaceDetail
// with a correct ♥. The save snapshot has to carry kind+key, else the
// reconstructed object loses kind:'place', keyOf returns the wrong key, and the
// shelf reopens the EVENT detail with an unsaved heart. (saves.js can't import
// into Node — it pulls in CSS — so we grep the snapshot builder + prove the
// normalize→keyOf contract the shelf relies on.)
test('places: a saved place round-trips (snapshot carries kind+key → PlaceDetail + right heart)', () => {
  const savesSrc = readFileSync(path.join(ROOT, 'app', 'src', 'saves.js'), 'utf8')
  assert.ok(/snap\.kind = 'place'/.test(savesSrc), 'toggleSave snapshot must persist kind:place for a saved place')
  assert.ok(/snap\.key = e\.key/.test(savesSrc), 'toggleSave snapshot must persist the place key')
  // the contract shelfItems leans on: normalize keeps kind via {...raw}, so a
  // place snapshot reconstructs to a place whose keyOf is the 'p|' key again
  const snapshot = { kind: 'place', key: 'p|test-park', name: 'Test Park', title: 'Test Park', lat: 27.9, lng: -82.5, placeType: 'park', category: 'outdoors' }
  const recon = lib.normalize({ ...snapshot }, AN)
  assert.equal(recon.kind, 'place', 'normalize must preserve kind:place (the App detail-layer routes on it)')
  assert.equal(lib.keyOf(recon), 'p|test-park', 'keyOf of a reconstructed place must be the p| key (SaveHeart + routing depend on it)')
})

test('weekend window: Fri–Sun for 3 different start days', () => {
  const wd = (d) => lib.weekdayIndex(d)
  // Wednesday → upcoming Fri 12 / Sat 13 / Sun 14
  const wed = lib.makeAnchors(cityMs('2026-06-10T12:00:00'))
  assert.deepEqual(weekend.weekendDays(wed).map(wd), [5, 6, 0], 'weekend days must be Fri/Sat/Sun')
  assert.equal(lib.dayNumber(wed.wkStartTs), 12, 'Wed Jun 10 → weekend starts Fri Jun 12')
  assert.equal(weekend.visibleWeekend(wed).length, 3, 'midweek: all 3 weekend days visible')
  // Saturday → the IN-PROGRESS weekend (Fri 13 was yesterday) — Fri column drops
  const sat = lib.makeAnchors(cityMs('2026-06-13T12:00:00'))
  assert.equal(lib.dayNumber(sat.wkStartTs), 12, 'Sat Jun 13 → weekend started Fri Jun 12')
  assert.deepEqual(weekend.visibleWeekend(sat).map((d) => d.id), ['sat', 'sun'], 'on Saturday the spent Friday drops')
  // Sunday → still the in-progress weekend, only Sunday remains
  const sun = lib.makeAnchors(cityMs('2026-06-14T12:00:00'))
  assert.equal(lib.dayNumber(sun.wkStartTs), 12, 'Sun Jun 14 → weekend started Fri Jun 12')
  assert.deepEqual(weekend.visibleWeekend(sun).map((d) => d.id), ['sun'], 'on Sunday only Sunday remains')
  // window math: a Saturday event is _weekend, a Monday event is not
  assert.equal(N(ev({ start: '2026-06-13' }), wed)._weekend, true, 'Saturday event must be _weekend')
  assert.equal(N(ev({ start: '2026-06-15' }), wed)._weekend, false, 'Monday event must not be _weekend')
})

// ============================================================
// Sprint T — CROSS-LAYER integration: the new pure matchers/dealers. All three
// modules are JSX/CSS-free by design, so they import straight into Node.
// ============================================================

// a synthetic normalized PLACE (only the fields the logic reads)
const pl = (over = {}) =>
  placesMod.normalizePlace({
    key: 'p|' + (over.slug || 't'),
    kind: 'place',
    name: over.name || 'Test Park',
    placeType: 'park',
    classes: ['park'],
    category: 'outdoors',
    lat: 27.9,
    lng: -82.5,
    srcCount: 1,
    hidden: false,
    hiddenScore: 0,
    ...over,
  })

test('search.js: searchPlaces matches name/type/amenity, never on a date, honors free', () => {
  const places = [
    pl({ slug: 'dunedin-dog-beach', name: 'Dunedin Dog Beach', placeType: 'beach', classes: ['beach'], amenities: ['dog-beach'], address: 'Dunedin', srcCount: 4 }),
    pl({ slug: 'al-lopez-park', name: 'Al Lopez Park', amenities: ['tennis'], address: 'Tampa', isFree: true, srcCount: 2 }),
    pl({ slug: 'lettuce-lake', name: 'Lettuce Lake Park', placeType: 'preserve', classes: ['preserve'], srcCount: 6 }),
  ]
  // text: "dog" word-prefixes the amenity + the name
  const dog = searchMod.searchPlaces(places, AN, 'dog')
  assert.ok(dog.some((p) => p.key === 'p|dunedin-dog-beach'), 'a "dog" query must find the dog beach')
  // neighborhood via address substring
  const tampa = searchMod.searchPlaces(places, AN, 'tampa')
  assert.ok(tampa.some((p) => p.key === 'p|al-lopez-park'), 'an address token must match the neighborhood')
  // a DATE-constrained query returns ZERO places (places have no date — honest)
  assert.deepEqual(searchMod.searchPlaces(places, AN, 'park friday'), [], 'a date-constrained query yields no places')
  assert.deepEqual(searchMod.searchPlaces(places, AN, 'tonight'), [], 'a date-only query yields no places')
  // "free" filters
  const free = searchMod.searchPlaces(places, AN, 'free park')
  assert.ok(free.every((p) => p.isFree === true), 'free query must only return free places')
  assert.ok(free.some((p) => p.key === 'p|al-lopez-park'), 'the free park is in the free results')
  // taste-neutral ordering: relevance, then srcCount corroboration desc. "park"
  // hits all three on name/type → tie on score, so srcCount breaks it (6 > 4 > 2)
  const parks = searchMod.searchPlaces(places, AN, 'park')
  assert.equal(parks[0].key, 'p|lettuce-lake', 'srcCount corroboration breaks a relevance tie (most-sourced first)')
  // empty query → [] (the page owns the zero-state)
  assert.deepEqual(searchMod.searchPlaces(places, AN, ''), [], 'empty query returns no places')
  // input is never mutated
  const before = JSON.stringify(places)
  searchMod.searchPlaces(places, AN, 'park')
  assert.equal(JSON.stringify(places), before, 'searchPlaces must not mutate its input')
})

test('places.js: placesForBrief matches affinity, no surprise park, never a date', () => {
  const list = [
    pl({ slug: 'a', name: 'A Park', category: 'outdoors', srcCount: 5 }),
    pl({ slug: 'b', name: 'B Garden', category: 'outdoors', srcCount: 2, hiddenScore: 9 }),
    pl({ slug: 'c', name: 'C Hall', category: 'art', srcCount: 9 }),
  ]
  const outdoors = new Set(['outdoors', 'market'])
  const got = placesMod.placesForBrief(list, outdoors, null, 5)
  assert.equal(got.length, 2, 'only the two outdoors places fit an outdoors affinity')
  assert.ok(!got.some((p) => p.category === 'art'), 'an off-affinity place never fits')
  // ordering taste-neutral: srcCount desc (5 > 2) leads despite B's hiddenScore
  assert.equal(got[0].key, 'p|a', 'corroboration (srcCount) leads the place fallback order')
  // no affinity (the "surprise" vibe → null/empty) returns nothing — a surprise
  // brief is served by real events, never a generic park
  assert.deepEqual(placesMod.placesForBrief(list, null, null, 5), [], 'null affinity → no place fallback')
  assert.deepEqual(placesMod.placesForBrief(list, new Set(), null, 5), [], 'empty affinity → no place fallback')
  // a place fallback NEVER carries a fabricated date/time field
  for (const p of got) {
    assert.equal(p._day, undefined, 'a place fallback must have no _day (never a fake date)')
    assert.equal(p.start, undefined, 'a place fallback must have no start time (never a fake time)')
  }
  // honors max
  assert.equal(placesMod.placesForBrief(list, outdoors, null, 1).length, 1, 'max caps the fallback count')
})

// (C5: the two dayfill.js dealer tests died with the deleted dead deck —
//  see the 'C5: the dead DayFillDeck + fmnseen are fully deleted' guard.)

// ============================================================
// Sprint U-d — the TWO-BEAT LOOP + the GENTLE LEDGER (CALENDAR_BRIEF Model C,
// §5 violet #7 + §7 the 12-item ban list). dayplan.js's conversion logic is
// pure (derivations) + storage-backed (the one-shot ledger, via the shim).
// ============================================================

// a Wednesday anchor; "past planned day" tests reference days before it
const UD_AN = lib.makeAnchors(new Date(2026, 5, 17, 12, 0)) // Wed Jun 17 2026
const dts = (y, m, d) => new Date(y, m, d).getTime() // local-midnight ms helper

test('U-d: the conversion one-shot never re-fires (violet #7 is once-per-day)', () => {
  localStorage.clear()
  const day = dts(2026, 5, 13) // a past Saturday
  // first 'went' lights the violet beat AND records the answer
  const first = dayplan.markDayConverted(day, 'went')
  assert.equal(first.firstWrite, true, 'the first answer records')
  assert.equal(first.violet, true, 'the first "went" lights violet moment #7')
  // a SECOND tap (reopen / double-tap) must NOT re-fire — idempotent + silent
  const again = dayplan.markDayConverted(day, 'went')
  assert.equal(again.firstWrite, false, 'an already-answered day never re-writes')
  assert.equal(again.violet, false, 'the violet beat never re-fires on reopen (one-shot, persisted)')
  // a 'missed' answer for a DIFFERENT day records but NEVER lights violet
  const miss = dayplan.markDayConverted(dts(2026, 5, 14), 'missed')
  assert.equal(miss.firstWrite, true, 'a "missed" answer is still recorded (so it is never re-asked)')
  assert.equal(miss.violet, false, 'a "missed" answer never lights the violet beat (ban §7: no guilt, no reward for absence)')
  // the ledger persisted both answers
  const ledger = dayplan.loadConverted()
  assert.equal(ledger[String(day)], 'went', 'the went answer persisted')
  assert.equal(ledger[String(dts(2026, 5, 14))], 'missed', 'the missed answer persisted')
  // a bogus answer is a no-op (defensive)
  assert.equal(dayplan.markDayConverted(day, 'maybe').firstWrite, false, 'an invalid answer records nothing')
})

test('U-d: did-days derive from been-there snapshot.start (never statusAt)', () => {
  // statusAt (WHEN you answered) is deliberately a DIFFERENT day than start —
  // the did-day must key on the event's day, not the answer's day.
  const been = [
    { key: 'a', status: 'went', statusAt: dts(2026, 5, 20), snapshot: { start: '2026-06-13T20:00:00' } },
    { key: 'b', status: 'went', statusAt: dts(2026, 5, 20), snapshot: { start: '2026-06-14' } }, // date-only
    { key: 'c', status: 'missed', snapshot: { start: '2026-06-15T20:00:00' } }, // missed ≠ a did-day
    { key: 'd', status: 'went', snapshot: { start: null } }, // no start → not derivable, skipped
    { key: 'e', snapshot: { start: '2026-06-16' } }, // no status → not a went
  ]
  const dids = dayplan.didDays(been)
  assert.ok(dids.has(dts(2026, 5, 13)), 'a timed "went" derives its did-day from start, not statusAt')
  assert.ok(dids.has(dts(2026, 5, 14)), 'a date-only "went" derives its did-day (local midnight)')
  assert.ok(!dids.has(dts(2026, 5, 15)), 'a "missed" entry is NEVER a did-day')
  assert.ok(!dids.has(dts(2026, 5, 20)), 'statusAt is never the did-day (the answer day is not the outing day)')
  assert.equal(dids.size, 2, 'exactly the two parseable "went" days')
  assert.deepEqual(dayplan.didDays(null), new Set(), 'a missing list derives no did-days')
})

test('U-d: the days-out counter is SILENT at zero (never shame)', () => {
  const monthStart = dts(2026, 5, 1) // June 1
  const nextMonth = dts(2026, 6, 1) // July 1
  // zero did-days in the month → 0 (the caller renders NOTHING at 0, never "0 📉")
  assert.equal(dayplan.daysOutInMonth(new Set(), monthStart, nextMonth), 0, 'no did-days → 0 (silence, not a score)')
  // distinct did-days inside the window count; days in other months do NOT
  const dids = new Set([dts(2026, 5, 13), dts(2026, 5, 14), dts(2026, 4, 30), dts(2026, 6, 2)])
  assert.equal(dayplan.daysOutInMonth(dids, monthStart, nextMonth), 2, 'only June did-days count toward "days out in June"')
  // breadth check: the count is days, not events (the Set is already distinct)
  assert.equal(dayplan.daysOutInMonth(new Set([dts(2026, 5, 13)]), monthStart, nextMonth), 1, 'a single did-day reads as 1')
})

test('U-d: the morning-after card does NOT fire for a past REST day', () => {
  const converted = {} // nothing answered yet
  const history = [
    { dayTs: dts(2026, 5, 13), state: 'rest', slots: { morning: null, afternoon: null, night: null } }, // a past REST day
    { dayTs: dts(2026, 5, 14), state: null, slots: { morning: null, afternoon: 'k1', night: null } }, // a past PLANNED day
    { dayTs: dts(2026, 5, 15), state: null, slots: { morning: null, afternoon: null, night: null } }, // empty (no plan)
  ]
  const cands = dayplan.morningAfterCandidates(history, converted, UD_AN)
  const candDays = cands.map((c) => c.dayTs)
  assert.ok(!candDays.includes(dts(2026, 5, 13)), 'a past REST day is a RECORD, never asked "did you make it" (ban §7 #10)')
  assert.ok(candDays.includes(dts(2026, 5, 14)), 'a past planned day with a filled slot IS a candidate')
  assert.ok(!candDays.includes(dts(2026, 5, 15)), 'an empty past day has no plan to convert')
  // ONE quiet card at a time: most-recent-first ordering (the caller takes [0])
  const two = dayplan.morningAfterCandidates(
    [
      { dayTs: dts(2026, 5, 10), state: null, slots: { morning: null, afternoon: 'a', night: null } },
      { dayTs: dts(2026, 5, 16), state: null, slots: { morning: null, afternoon: 'b', night: null } },
    ],
    {},
    UD_AN
  )
  assert.equal(two[0].dayTs, dts(2026, 5, 16), 'the most-recent past planned day surfaces first')
  // an ANSWERED day (in the ledger) is never a candidate again — the card
  // clears on answer and never re-fires (whether the answer was went OR missed)
  const answered = dayplan.morningAfterCandidates(history, { [String(dts(2026, 5, 14))]: 'missed' }, UD_AN)
  assert.deepEqual(answered, [], 'a missed (or went) day is removed from candidates — never re-asked')
  // a FUTURE planned day is never a morning-after candidate (it has not happened)
  const future = dayplan.morningAfterCandidates(
    [{ dayTs: dts(2026, 5, 25), state: null, slots: { morning: null, afternoon: 'x', night: null } }],
    {},
    UD_AN
  )
  assert.deepEqual(future, [], 'a future planned day is never asked about (it has not happened yet)')
})

test('U-d: variety firsts are breadth stamps, fixed + capped (never a volume badge)', () => {
  // many "went" entries in ONE category earn the ONE first, never a count
  const manyMusic = Array.from({ length: 10 }, (_, i) => ({
    key: 'm' + i,
    status: 'went',
    snapshot: { start: '2026-06-13', category: 'music' },
  }))
  const oneFirst = dayplan.varietyFirsts(manyMusic)
  assert.equal(oneFirst.length, 1, '10 music outings earn exactly ONE "first live music" stamp (breadth, not volume)')
  assert.equal(oneFirst[0].id, 'music', 'the earned stamp is the music first')
  // distinct categories each earn their own first, capped at MAX_FIRSTS
  const variety = [
    { key: '1', status: 'went', snapshot: { category: 'outdoors' } },
    { key: '2', status: 'went', snapshot: { category: 'music' } },
    { key: '3', status: 'went', snapshot: { category: 'food' } },
    { key: '4', status: 'missed', snapshot: { category: 'art' } }, // missed earns nothing
  ]
  const stamps = dayplan.varietyFirsts(variety)
  const ids = stamps.map((s) => s.id)
  assert.ok(ids.includes('outdoors') && ids.includes('music') && ids.includes('food'), 'each distinct went-category earns its first')
  assert.ok(!ids.includes('art'), 'a MISSED outing earns no stamp')
  assert.ok(stamps.length <= dayplan.MAX_FIRSTS, `firsts are capped at MAX_FIRSTS (${dayplan.MAX_FIRSTS}) — a handful, never a tracker`)
  assert.deepEqual(dayplan.varietyFirsts(null), [], 'a missing list earns no firsts')
})

// ⚑PLAN-P0 — the binary {day,night} → ternary {morning,afternoon,night} daypart
// migration. The path-risky prerequisite: day→afternoon, night→night, morning is
// a new empty slot. MUST be idempotent (guarded + remap self-skips), forward-only,
// and lose NO data — across BOTH the active map AND the history archive.
test('⚑PLAN-P0: binary→ternary migration is idempotent, lossless (map + history)', async () => {
  const storage = await import('../app/src/storage.js')
  const setJ = (k, v) => storage.lsSet(k, JSON.stringify(v))
  const getJ = (k) => JSON.parse(storage.lsGet(k))
  const tsA = String(dts(2026, 7, 4))
  const tsB = String(dts(2026, 7, 5))
  const tsR = String(dts(2026, 7, 6))
  const tsH = dts(2026, 4, 20)

  // hermetic setup: clear the guard + both stores, then seed legacy BINARY blobs
  storage.lsRemove('day-migrated-v1')
  setJ('day-plans-v1', {
    [tsA]: { state: null, slots: { day: 'e|a', night: 'e|b' }, done: false, v: 1 }, // both slots
    [tsB]: { state: null, slots: { day: 'e|c', night: null }, done: false, v: 1 }, // day only
    [tsR]: { state: 'rest', slots: { day: null, night: null }, done: false, v: 1 }, // a rest day
  })
  setJ('day-history-v1', [{ dayTs: tsH, state: null, slots: { day: 'e|h', night: null }, done: false, v: 1 }])

  dayplan.migrateBinaryToTernary()

  // guard set; mapping day→afternoon, night→night, morning new+empty; rest intact
  assert.equal(storage.lsGet('day-migrated-v1'), '1', 'the one-shot guard is set after migrating')
  const map1 = getJ('day-plans-v1')
  assert.deepEqual(map1[tsA].slots, { morning: null, afternoon: 'e|a', night: 'e|b' }, 'day→afternoon, night→night')
  assert.deepEqual(map1[tsB].slots, { morning: null, afternoon: 'e|c', night: null }, 'a day-only plan moves to afternoon (no loss)')
  assert.equal(map1[tsR].state, 'rest', 'a rest day stays a rest day')
  assert.deepEqual(map1[tsR].slots, { morning: null, afternoon: null, night: null }, 'rest day slots are ternary + empty')
  // NO legacy 'day' key survives anywhere in either store
  const noLegacy = (slots) => !('day' in slots)
  assert.ok(Object.values(map1).every((e) => noLegacy(e.slots)), 'no legacy day key remains in the active map')
  const hist1 = getJ('day-history-v1')
  assert.deepEqual(hist1[0].slots, { morning: null, afternoon: 'e|h', night: null }, 'history archive migrates too (no archived plan dropped)')
  assert.ok(noLegacy(hist1[0].slots), 'no legacy day key remains in history')
  // the migrated entries round-trip cleanly through dayEntryFor (the read path)
  assert.equal(dayplan.dayEntryFor(map1[tsA]).slots.afternoon, 'e|a', 'a migrated entry reads back through dayEntryFor')

  // IDEMPOTENT #1 — a second call (guard set) is a pure no-op
  const before = storage.lsGet('day-plans-v1')
  const beforeH = storage.lsGet('day-history-v1')
  dayplan.migrateBinaryToTernary()
  assert.equal(storage.lsGet('day-plans-v1'), before, 'guarded re-run leaves the active map byte-identical')
  assert.equal(storage.lsGet('day-history-v1'), beforeH, 'guarded re-run leaves history byte-identical')

  // IDEMPOTENT #2 — even with the guard CLEARED, the remap self-skips ternary data
  storage.lsRemove('day-migrated-v1')
  dayplan.migrateBinaryToTernary()
  assert.equal(storage.lsGet('day-plans-v1'), before, 'unguarded re-run on ternary data still changes nothing (remap self-skips)')
  assert.equal(storage.lsGet('day-history-v1'), beforeH, 'unguarded re-run leaves history unchanged')

  // EMPTY case — a fresh install (no data) never crashes and still sets the guard
  storage.lsRemove('day-migrated-v1')
  storage.lsRemove('day-plans-v1')
  storage.lsRemove('day-history-v1')
  dayplan.migrateBinaryToTernary()
  assert.equal(storage.lsGet('day-migrated-v1'), '1', 'empty install migrates harmlessly and sets the guard')
})

// Sprint U-d — the "went" side rides the EXISTING markBeen seam so the +2 taste
// stays unfarmable, and slotting earns NO taste signal in v1 (the nudge ceiling
// 18 is the wall — asserted above). saves.js can't import into Node (CSS), so
// grep the wiring CalendarView leans on, like the places round-trip test.
test('S1-C2: the morning-after recap is off the Calendar; "went" still rides markBeen (in My plans)', () => {
  // S1-C2 removed the "did you make it?" prompt + violet glow + their machinery
  // from the Calendar (it was a coupled unit; the glow was only reachable via the
  // prompt). The answer flow lives in Profile → My plans now.
  const calSrc = readFileSync(path.join(ROOT, 'app', 'src', 'CalendarView.jsx'), 'utf8')
  assert.ok(!/morningAfterCandidates\(/.test(calSrc), 'CalendarView no longer derives a morning-after card')
  assert.ok(!/markDayConverted\(/.test(calSrc), 'CalendarView no longer writes the conversion ledger')
  assert.ok(!/cal-recap/.test(calSrc), 'the recap markup is removed from the Calendar')
  // the idempotent +2 "went" seam relocated to My plans (still unfarmable)
  const mpSrc = readFileSync(path.join(ROOT, 'app', 'src', 'MyPlansPage.jsx'), 'utf8')
  assert.ok(/markBeen\(key, snapshot, 'went'\)/.test(mpSrc), 'My plans "I went" rides the idempotent markBeen seam (+2 unfarmable)')
  // no taste signal is recorded for slotting anywhere in the day surfaces
  const daySrc = readFileSync(path.join(ROOT, 'app', 'src', 'DayPage.jsx'), 'utf8')
  assert.ok(!/recordSignal\(/.test(daySrc), 'DayPage must record NO taste signal for slotting (only "went" feeds taste, v1)')
})

// Sprint S follow-up — a slotted place must resolve through the provider catalog
// on every planner surface. Calendar may activate the places layer only when its
// selected slot needs one; My Plans can always render the retained slot snapshot
// while the provider subscribes to (but does not boot-fetch) the shared catalog.
test('Sprint S: provider-backed planner surfaces keep place slots named without an eager boot fetch', () => {
  const providerSrc = readFileSync(path.join(ROOT, 'app', 'src', 'PlannerProvider.jsx'), 'utf8')
  assert.ok(/usePlaces\(false\)/.test(providerSrc), 'PlannerProvider subscribes to places without activating the large artifact at boot')
  assert.ok(/places: placeList/.test(providerSrc), 'loaded places are folded into the one planner catalog')

  const calSrc = readFileSync(path.join(ROOT, 'app', 'src', 'CalendarView.jsx'), 'utf8')
  assert.ok(/slot\.ref\?\.kind === 'place'/.test(calSrc), 'Calendar gates place activation from the selected provider slot reference')
  assert.ok(/usePlaces\(hasSelPlaceRef\)/.test(calSrc), 'Calendar activates places only when a selected slot requires them')
  assert.ok(/const e = slot\?\.item/.test(calSrc), 'Calendar renders the provider-resolved live or retained item')

  const mpSrc = readFileSync(path.join(ROOT, 'app', 'src', 'MyPlansPage.jsx'), 'utf8')
  assert.ok(/slot\?\.item\?\.title \|\| slot\?\.item\?\.name/.test(mpSrc), 'My Plans names place slots from the provider item or retained snapshot')
  assert.ok(/resolution === 'missing'/.test(mpSrc) && /resolution === 'ambiguous'/.test(mpSrc), 'unresolved identity is labeled instead of blanking the plan')
  assert.ok(!/usePlaces\(/.test(mpSrc), 'My Plans does not duplicate place loading or resolver ownership')
})

// Sprint U-d — the --reward ledger names the did-day conversion (moment #6).
// 3.7P-4: Addendum E relaxed the six-moment COUNT cap for gamification, but the
// ledger comment must still be the auditable source of truth (discipline holds;
// the retired FMN beat stays gone; the did-day conversion + ⚑U-V7 stay named).
test('U-d/3.7P-4: index.css reward ledger records the cap relaxation + keeps the discipline', () => {
  const idx = readFileSync(path.join(ROOT, 'app', 'src', 'index.css'), 'utf8')
  assert.ok(/Addendum E relaxed the COUNT cap/.test(idx), 'the --reward ledger must record Addendum E relaxing the six-moment cap')
  assert.ok(/standing color \/ badge \/ growing counter/.test(idx), 'the ledger must keep the discipline (transient spark, never a standing badge/counter)')
  assert.ok(!/FMN reveal beat \(fmn\.css\)/.test(idx), 'the retired FMN reveal beat must not be a live ledger entry')
  assert.ok(/did-day conversion/.test(idx), 'the ledger must still name the planned-day → did-day conversion')
  assert.ok(/U-V7/.test(idx), 'the ledger must cite the ⚑U-V7 flag')
})

// ============================================================
// Phase 3.5 W2 — the Calendar tab is now a FULL personal LOGBOOK (Model C
// finally honored: Calendar = DEMAND, cleanly). The SUPPLY half Josh disliked
// is GONE from this tab: no per-day event list, no month-grid event counts, no
// busyness heat tint, no p90 "hot day" coral ring, no "N events" text. The
// agenda still lives on the DAY SCREEN (DayPage) — that bridge is untouched.
// CalendarView can't import into Node (JSX + CSS), so this is a source/CSS grep
// guard, same pattern as the other CalendarView wiring tests.
// ============================================================
test('W2: the Calendar tab is a logbook — NO event list / counts / heat on it', () => {
  const calSrc = readFileSync(path.join(ROOT, 'app', 'src', 'CalendarView.jsx'), 'utf8')
  // the supply half is removed: no per-day event list rendered on the tab…
  assert.ok(!/<EventCard/.test(calSrc), 'the Calendar tab must NOT render EventCard — the agenda lives on the day screen, not here')
  assert.ok(!/selEvents/.test(calSrc), 'the per-day event list (selEvents) must be gone from the Calendar tab')
  // …no month-grid event counts / "N events" text…
  assert.ok(!/\bdayMap\b/.test(calSrc), 'the events->day plumbing (dayMap) used only for counts/heat must be gone')
  assert.ok(!/event\$\{|events?'/.test(calSrc), 'no "N event(s)" count text on the Calendar tab')
  // …no busyness heat tint + no p90 hot-day coral ring (code, not prose — the
  // header comment legitimately documents what was removed) …
  assert.ok(!/--heat/.test(calSrc), 'the busyness heat tint (--heat) must be gone from the Calendar tab')
  assert.ok(!/hotDays\.has\(|const hotDays/.test(calSrc), 'the p90 "hot day" coral-ring plumbing (hotDays) must be gone')
  assert.ok(!/const p90 =/.test(calSrc), 'the p90 percentile heat scale must be gone')
  // coral (--hot-rgb) is supply-only and there is no supply here anymore
  const calCss = readFileSync(path.join(ROOT, 'app', 'src', 'calendar.css'), 'utf8')
  assert.ok(!/--hot-rgb/.test(calCss), 'no coral heat/hot-ring (--hot-rgb) anywhere in the logbook calendar.css')
  assert.ok(!/\.date-rail|\.date-pill|\.dp-count/.test(calCss), 'the supply date-rail + per-day count pill styles must be removed')

  // the PERSONAL layer is the whole tab: the three quiet marks derive correctly
  assert.ok(/plannedDays\.has\(ts\)/.test(calSrc), 'planned days wear the teal underline mark')
  assert.ok(/restDays\.has\(ts\)/.test(calSrc), 'rest days wear the muted crescent mark')
  assert.ok(/dids\.has\(ts\)/.test(calSrc) && /didDays\(been\)/.test(calSrc), 'did-days (been-there \'went\') wear the calm check stamp')
  // 3.7P-17: tapping a day selects it (inline panel); the day screen is reached
  // from the panel's "Open full day" / "Plan this day" action (openDay(sel))
  assert.ok(/openDay\(sel\)/.test(calSrc), 'the inline day panel opens the day screen (openDay(sel)) — the bridge to fill it')
  // W6 (⚑U-WKND): the Weekend pill is RETIRED — planning is per-day now, so the
  // redundant calendar→WeekendBuilder entry is gone (and 3.7P-8/FB-10 later
  // retired the Weekend Builder view entirely — planning lives in the day screens)
  assert.ok(!/cal-wkb/.test(calSrc), 'the Weekend pill (.cal-wkb) must be removed from the Calendar tab (W6)')
  assert.ok(!/openWeekend/.test(calSrc), 'the Calendar tab must not wire openWeekend anymore (W6 retired the pill)')
  // S1-C3: the "N out in {month}" days-out stat is retired from the Calendar strip
  // (the rich ledger lives in Profile → My plans, unduplicated); the strip keeps
  // its zero-is-silence gate via the remaining rhythm/kept/planned-ahead stats.
  assert.ok(!/daysOutInMonth\(/.test(calSrc), 'the days-out stat (daysOutInMonth) is removed from the Calendar (S1-C3)')
  assert.ok(/rhythmStats\.length > 0/.test(calSrc), 'the rhythm strip still renders only when a true stat exists (zero is silence)')
})

// Phase 3.5 W6 — CONNECTIVITY. The buried taste surfaces (TastePanel transparency
// + the calibration deck, both 4 taps deep in Settings) get a first-class Profile
// entry, and the deck's close affordance honors a 'profile' origin so it returns
// to Profile (not Settings).
test('V1 B3: Taste Profile sweep — never-hide line re-homed, promise callout + weight bars retired', () => {
  const tp = readFileSync(path.join(ROOT, 'app', 'src', 'TastePanel.jsx'), 'utf8')
  const css = readFileSync(path.join(ROOT, 'app', 'src', 'tastepanel.css'), 'utf8')
  // P1: the LOAD-BEARING never-hide honesty line survives as a tp-trust subheader
  assert.ok(/never hides anything/.test(tp) && /reorders your feed/.test(tp), 'P1: the never-hide honesty line is preserved (reorders, never hides)')
  assert.ok(!/tp-promise/.test(tp) && !/\.tp-promise\s*\{/.test(css), 'P1: the .tp-promise callout widget + its CSS rule are gone')
  // P2: the "Leaning toward" weight bars are gone; sum.leans still rides the headline
  assert.ok(!/tp-leans/.test(tp) && !/\.tp-leans\s*\{/.test(css) && !/\.tp-bar-fill\s*\{/.test(css), 'P2: the .tp-leans weight-bar block + CSS rules are gone')
  assert.ok(/sum\.leans/.test(tp), 'P2: sum.leans still feeds the headline (the data is kept, only the bars removed)')
})

test('W6 → PROFILE_GRIND: Profile surfaces taste via Taste profile (deck stays in Settings)', () => {
  // The taste hub is the "Taste profile" row → openTaste (the TastePanel, where the
  // vibe chips live). PROFILE_GRIND also adds a "Customize interests" row →
  // openInterests('profile'); the rate-to-sharpen DECK stays inside Settings.
  const pfSrc = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  assert.ok(/openTaste/.test(pfSrc), 'Profile "Taste profile" opens the TastePanel (openTaste)')
  assert.ok(!/openDeck/.test(pfSrc), 'the rate-to-sharpen deck is not on the Profile main view (it lives in Settings)')
  assert.ok(/openSettings/.test(pfSrc), 'Profile has a "Settings & preferences" row → openSettings')
  // the retired Weekend pill class is gone CODEBASE-WIDE (it had a duplicate
  // rule in weekend.css — a stale connection W6 must not leave behind)
  for (const f of ['calendar.css', 'weekend.css']) {
    const css = readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
    assert.ok(!/\.cal-wkb/.test(css), `the retired .cal-wkb pill rule must be gone from ${f} (no orphan CSS)`)
  }
})

// ============================================================
// Phase 3.5 W3 — EVENT CURATION (front page + see-all). curate.js is pure .js
// (imports only lib.js) → Node-importable. The HARD contract is NEVER-HIDE:
// collapse must group every instance (count-preserving, "+N more dates" honest),
// the front-page filter only chooses what LEADS, and curated ⊆ full where full
// reaches every event. Asserted on synthetic shapes AND the real dataset.
// ============================================================
test('W3 curate: collapseSeries is count-preserving + groups recurring by title+family', () => {
  // a recurring program across 5 days/branches (one family) + 2 lone events
  const series = Array.from({ length: 5 }, (_, i) =>
    N(ev({ title: 'Baby Time', start: `2026-06-1${i}T10:00:00`, source: 'Library (Br ' + i + ')', sources: ['Library (Br ' + i + ')'], category: 'family', hotScore: 30 }), AN)
  )
  const lone = [
    N(ev({ title: 'Solo Show', start: '2026-06-12T20:00:00', source: 'Venue', sources: ['Venue'], hotScore: 70 }), AN),
    N(ev({ title: 'Another Thing', start: '2026-06-13T19:00:00', source: 'Venue', sources: ['Venue'], hotScore: 65 }), AN),
  ]
  const groups = curate.collapseSeries([...series, ...lone])
  assert.equal(groups.length, 3, '5-instance series + 2 lone → exactly 3 collapsed cards')
  const baby = groups.find((g) => g.title === 'Baby Time')
  assert.equal(baby._seriesCount, 5, 'the series card carries all 5 instances')
  assert.equal(baby._moreDates, 4, '"+4 more dates" — the count shown is instances-1')
  assert.equal(baby._series.length, 5, '_series holds every instance (nothing dropped)')
  // soonest instance leads (the rep is the next occurrence, not a random one)
  assert.equal(baby.start, '2026-06-10T10:00:00', 'the collapsed rep is the SOONEST instance')
  // lone events are groups of one (never falsely stamped as a series)
  for (const g of groups.filter((g) => g.title !== 'Baby Time')) {
    assert.equal(g._seriesCount, 1, 'a lone event is a group of one')
    assert.equal(g._moreDates, 0, 'a lone event shows no "+N more"')
  }
  // COUNT-PRESERVING: every input instance appears in exactly one group's _series
  const seen = new Set()
  for (const g of groups) for (const inst of g._series) { assert.ok(!seen.has(inst), 'no instance is double-counted'); seen.add(inst) }
  assert.equal(seen.size, series.length + lone.length, 'collapse preserves every event (never hides)')
  // SAME title, DIFFERENT family stays separate (honest — different voice)
  const diffFam = curate.collapseSeries([
    N(ev({ title: 'Open Mic', source: 'A', sources: ['A'] }), AN),
    N(ev({ title: 'Open Mic', source: 'B', sources: ['B'] }), AN),
  ])
  assert.equal(diffFam.length, 2, 'same title across two families does NOT merge')
  // input is never mutated (reps are clones)
  assert.equal(series[0]._series, undefined, 'collapseSeries must not mutate its input events')
})

test('W3 curate: frontPagePredicate bar is buzz/hotScore/staff/gem, tunable', () => {
  assert.equal(curate.frontPagePredicate(N(ev({ buzz: curate.FRONT_BUZZ, hotScore: 10 }), AN)), true, 'cross-source buzz earns the front page outright')
  assert.equal(curate.frontPagePredicate(N(ev({ buzz: 1, hotScore: curate.FRONT_HOT }), AN)), true, 'hotScore at the bar earns the front page')
  assert.equal(curate.frontPagePredicate(N(ev({ buzz: 1, hotScore: curate.FRONT_HOT - 1 }), AN)), false, 'just below the hot bar with no other signal is NOT front page')
  assert.equal(curate.frontPagePredicate(N(ev({ buzz: 1, hotScore: 10, tags: ['hidden-gem'] }), AN)), true, 'a hand-curated hidden-gem is front page by fiat')
  assert.equal(curate.frontPagePredicate(N(ev({ buzz: 1, hotScore: 10, tags: ['staff-pick'] }), AN)), true, 'an editorial staff-pick is front page by fiat')
  assert.equal(curate.frontPagePredicate(null), false, 'a null event is never front page (defensive)')
})

test('W3 curate: curateFeed — curated ⊆ full, See-all reaches EVERY event (never-hide)', () => {
  // a feed with a low-quality recurring flood + a few high-quality lone events
  const flood = Array.from({ length: 8 }, (_, i) =>
    N(ev({ title: 'Story Time', start: `2026-06-1${i}T10:00:00`, source: 'Lib (b' + i + ')', sources: ['Lib (b' + i + ')'], category: 'family', hotScore: 30, buzz: 1 }), AN)
  )
  const picks = [
    N(ev({ title: 'Big Concert', start: '2026-06-12T20:00:00', source: 'V', sources: ['V'], category: 'music', hotScore: 90, buzz: 1 }), AN),
    N(ev({ title: 'Corroborated Fest', start: '2026-06-13T18:00:00', source: 'A', sources: ['A', 'B'], category: 'food', hotScore: 20, buzz: 2 }), AN),
  ]
  const upcoming = [...flood, ...picks]
    .map((e) => ({ ...e, _clamp: Math.max(e._day, AN.todayTs) }))
    .sort((x, y) => x._clamp - y._clamp || x._t - y._t)
  const feed = curate.curateFeed(upcoming, {
    dayOf: (e) => e._clamp,
    labelOf: (ts) => ({ label: lib.dayLabel(ts, AN), dayTs: ts }),
    order: (items) => lib.orderDay(items, null),
  })
  // fullEventCount = the REAL raw total (what the See-all button quotes)
  assert.equal(feed.fullEventCount, upcoming.length, 'fullEventCount must equal the raw event count (honest "See all {N}")')
  // collapse de-spammed: 8 story-times → 1 card, + 2 picks = 3 full cards
  assert.equal(feed.fullCount, 3, '8-instance series + 2 picks → 3 collapsed cards in full')
  // the recurring flood (hotScore 30, buzz 1) is NOT on the front page; both
  // picks ARE (one by hotScore, one by buzz) → curated has only the 2 picks
  assert.equal(feed.curatedCount, 2, 'the low-quality recurring series is de-prioritized; the 2 picks lead')
  // NEVER-HIDE 1 — curated ⊆ full (every curated group is a full group)
  const fullIds = new Set()
  for (const s of feed.full) for (const g of s.items) fullIds.add(g.title + '|' + g._clamp)
  for (const s of feed.curated) for (const g of s.items)
    assert.ok(fullIds.has(g.title + '|' + g._clamp), `curated group "${g.title}" must exist in full (curated ⊆ full)`)
  // NEVER-HIDE 2 — full's _series enumerate EVERY input event, exactly once
  const reached = new Set()
  for (const s of feed.full) for (const g of s.items) for (const inst of g._series) reached.add(inst)
  assert.equal(reached.size, upcoming.length, 'See-all (full) must reach every single event — nothing hidden')
  for (const e of upcoming) assert.ok(reached.has(e), `event "${e.title}" @ ${e.start} is reachable via See-all`)
  // the de-spammed Story Time card honestly carries all 8 dates
  const story = feed.full.flatMap((s) => s.items).find((g) => g.title === 'Story Time')
  assert.equal(story._seriesCount, 8, 'the collapsed Story Time card represents all 8 instances')
})

test('W3 curate: real dataset — feed is shorter, collapse de-spams, See-all complete', () => {
  const upcoming = fullEvents
    .map((e) => N(e, AN))
    .filter((e) => e._day != null && (e._endDay ?? e._day) >= AN.todayTs)
    .map((e) => ({ ...e, _clamp: e._day < AN.todayTs ? AN.todayTs : e._day }))
    .sort((x, y) => x._clamp - y._clamp || x._t - y._t)
  const feed = curate.curateFeed(upcoming, {
    dayOf: (e) => e._clamp,
    labelOf: (ts) => ({ label: lib.dayLabel(ts, AN), dayTs: ts }),
    order: (items) => lib.orderDay(items, null),
  })
  // 1) See-all quotes the REAL total and reaches every event
  assert.equal(feed.fullEventCount, upcoming.length, 'fullEventCount must equal the live upcoming count')
  const reached = new Set()
  for (const s of feed.full) for (const g of s.items) for (const inst of g._series) reached.add(inst)
  assert.equal(reached.size, upcoming.length, 'See-all must reach every live event (never-hide on real data)')
  // 2) collapse de-spams in PROPORTION to what the live window actually contains.
  //    (C5 hardening: the old `fullCount < 0.75 × upcoming` ratio encoded a DATA
  //    property — the share of recurring library programs inside the snapshot
  //    window — and flaked as the snapshot aged. The synthetic W3 test above
  //    already proves the de-spam BEHAVIOR (Story Time 8→1); on real data we
  //    prove the conservation identities that hold on ANY window.)
  const groupCount = feed.full.reduce((n, s) => n + s.items.length, 0)
  assert.equal(feed.fullCount, groupCount, 'fullCount = the number of rendered cards (groups)')
  const instanceCount = feed.full.reduce((n, s) => n + s.items.reduce((m, g) => m + g._series.length, 0), 0)
  assert.equal(instanceCount, upcoming.length, 'every upcoming instance lives in exactly ONE card series (collapse neither drops nor doubles)')
  assert.ok(feed.fullCount <= upcoming.length, 'collapse never inflates the feed')
  // 3) the front page is SHORTER than the full collapsed feed (curation happened)
  //    but not gutted — "plenty" is judged relative to what the window holds
  //    (absolute floors flake as the snapshot ages), capped at the original 100.
  assert.ok(feed.curatedCount < feed.fullCount, `front page (${feed.curatedCount}) must be shorter than full (${feed.fullCount})`)
  const notGuttedFloor = Math.min(100, Math.ceil(feed.fullCount * 0.5))
  assert.ok(feed.curatedCount >= notGuttedFloor, `front page (${feed.curatedCount}) must not be gutted (floor ${notGuttedFloor} on ${feed.fullCount} cards)`)
  // 4) curated ⊆ full on real data
  const fullIds = new Set()
  for (const s of feed.full) for (const g of s.items) fullIds.add(lib.keyOf(g) + '|' + g._clamp)
  for (const s of feed.curated) for (const g of s.items)
    assert.ok(fullIds.has(lib.keyOf(g) + '|' + g._clamp), 'every curated group exists in full (curated ⊆ full)')
})

test('V1 B5 / T1: Events see-all = the deck (primary never-hide door) + in-feed fallback + re-deal loop', () => {
  const hot = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  // the PRIMARY full-width .ev-seeall pill now opens the swipe deck (the find-AND-tune door)
  assert.ok(/className="ev-seeall pressable"[\s\S]{0,200}openDeck\(\{ kind: 'events', origin: 'events' \}\)/.test(hot), 'T1: the primary See-all (.ev-seeall) opens the events deck via openDeck')
  // the in-feed fallback is RETAINED (Josh's call): the seeAllEv expand still reaches feed.full
  assert.ok(/ev-seeall-list/.test(hot) && /setSeeAllEv\(\(v\) => !v\)/.test(hot) && /seeAllEv \? feed\.full : feed\.curated/.test(hot), 'T1: the in-feed "full list" fallback (.ev-seeall-list → seeAllEv → feed.full) is present + reaches the complete set')
  assert.ok(/BINDING NEVER-HIDE PATH/.test(hot), 'the in-feed fallback is marked a BINDING never-hide path (guards against silent removal)')
  // the BLOCKER: the deck done screen has a reachable, non-dead-ending re-deal loop
  const deck = readFileSync(path.join(ROOT, 'app', 'src', 'CalibrationDeck.jsx'), 'utf8')
  assert.ok(/const dealAgain = \(\) =>/.test(deck) && /onClick=\{dealAgain\}/.test(deck), 'BLOCKER: the deck done screen has a reachable "Deal again" re-deal loop')
  assert.ok(/seenRef\.current/.test(deck) && /nextEventsBatch\(events, anchors, seenRef\.current/.test(deck), 'BLOCKER: "Deal again" walks the catalog via the cumulative seen-set (nextEventsBatch), not a FIFO-only top-N re-deal')
})

test('V1 B5 coverage (scout re-sim): the cumulative re-deal loop reaches EVERY event, not a top-N carousel', () => {
  // >45 events across real registry categories — the OLD FIFO(30)-over-hotDesc re-deal
  // cycled only the top ~45, so this assertion would have FAILED on it. This is the
  // sufficiency proof the Batch-5 test was missing (it only checked dealAgain existed).
  const COV_CATS = ['music', 'food', 'outdoors', 'art', 'comedy', 'sports']
  const catalog = Array.from({ length: 60 }, (_, i) =>
    N(
      ev({
        title: 'Cov ' + i,
        start: `2026-06-${String(12 + (i % 16)).padStart(2, '0')}T${String(9 + (i % 12)).padStart(2, '0')}:00:00`,
        source: 'Src' + i,
        sources: ['Src' + i],
        category: COV_CATS[i % COV_CATS.length],
        hotScore: 100 - i,
      }),
      AN
    )
  )
  const seen = new Set()
  const served = new Set()
  const bound = Math.ceil(catalog.length / deckdeal.DECK_SIZE) + 1
  let deals = 0
  while (served.size < catalog.length && deals < 100) {
    const batch = deckdeal.nextEventsBatch(catalog, AN, seen, { rng: () => 0.5 })
    assert.ok(batch.length > 0, 'a re-deal never produces an empty/stuck batch while events remain')
    for (const e of batch) served.add(lib.keyOf(e))
    deals++
  }
  assert.equal(served.size, catalog.length, `the re-deal loop must serve EVERY event (covered ${served.size}/${catalog.length} in ${deals} deals)`)
  assert.ok(deals <= bound, `full coverage within ~ceil(N/15) deals (took ${deals}, bound ${bound}) — proves a forward walk, not a fixed carousel`)
  // WRAPS, never dead-ends: after full coverage the next deal re-serves from the top
  const wrap = deckdeal.nextEventsBatch(catalog, AN, seen, { rng: () => 0.5 })
  assert.ok(wrap.length > 0, 'after full coverage the loop wraps (re-deals from the top), never dead-ends')
  // short-remainder edge: a near-exhausted pool deals the remainder, not an empty deck
  const seen2 = new Set(catalog.slice(0, catalog.length - 4).map((e) => lib.keyOf(e)))
  const rem = deckdeal.nextEventsBatch(catalog, AN, seen2, { rng: () => 0.5 })
  assert.ok(rem.length > 0 && rem.length <= deckdeal.DECK_SIZE, `<15 unseen → deals the short remainder (${rem.length}), never empty/stuck`)
})

// ============================================================
// WS2 DECK PHYSICS (cohesion/deck-physics) — the PURE gesture math, simmed.
// deckgesture.js is the Node seam (SwipeDeck.jsx re-exports gestureVerdict so
// consumers keep one import); these sims prove the velocity upgrade PRESERVED
// every verified distance behavior while fixing the flick-snaps-back tell.
// ============================================================
test('WS2 deck physics: gestureVerdict — distance unchanged, flicks commit, direction agreement, one verdict', () => {
  const g = gesture.gestureVerdict
  // legacy 2-arg calls (the verified Sprint-P behavior) — byte-identical outcomes
  assert.equal(g(85, 0), 'right', 'slow drag past SWIPE_X commits right')
  assert.equal(g(-85, 0), 'left', 'slow drag past -SWIPE_X commits left')
  assert.equal(g(10, -95), 'up', 'upward travel past SWIPE_Y (dominating dx) commits up')
  assert.equal(g(79, 0), null, 'under threshold with no velocity snaps back')
  assert.equal(g(100, -120), 'up', 'up DOMINATES when both would qualify (priority preserved)')
  assert.equal(g(100, -95), 'right', 'up travel that does not dominate dx falls to horizontal')
  // slow drags past distance still commit WITH velocity args present
  assert.equal(g(90, 5, 0.05, 0), 'right', 'slow deliberate drag past distance commits regardless of speed')
  // the WS2 upgrade: a hard flick UNDER the distance threshold commits
  assert.equal(g(40, 2, 0.9, 0), 'right', 'a 0.9 px/ms flick at 40px travel commits (was the #1 cheap tell)')
  assert.equal(g(-40, -2, -0.9, 0.02), 'left', 'flick left commits under distance')
  assert.equal(g(-4, -40, 0.05, -0.9), 'up', 'flick up commits under distance')
  // sub-threshold slow releases still snap back
  assert.equal(g(40, 0, 0.3, 0), null, 'sub-threshold travel + sub-flick speed snaps back')
  assert.equal(g(-30, -40, -0.2, -0.3), null, 'slow diagonal wobble snaps back')
  // direction agreement: velocity one way + net travel the other = wobble, never a verdict
  assert.equal(g(-40, 0, 0.9, 0), null, 'rightward flick velocity with net-LEFT travel must not commit')
  assert.equal(g(10, 0, 2, 0), null, 'micro-travel under FLICK_TRAVEL can never flick-commit')
  // an up-flick must DOMINATE horizontally too — fast diagonals go horizontal
  assert.equal(g(60, -30, 0.9, -0.7), 'right', 'diagonal flick with |vx|>|vy| commits horizontal, not up')
  // ONE verdict per release, across the whole input space (the invariant's pure half;
  // the component half — dragRef nulls before commit — is source-locked below)
  const OUT = [null, 'left', 'right', 'up']
  for (let dx = -200; dx <= 200; dx += 8)
    for (let dy = -200; dy <= 200; dy += 8)
      for (const [vx, vy] of [[0, 0], [0.8, 0], [-0.8, 0], [0, -0.8], [0.5, -0.7]])
        assert.ok(OUT.includes(g(dx, dy, vx, vy)), `verdict domain holds at ${dx},${dy},${vx},${vy}`)
})

test('WS2 deck physics: releaseVelocity — trailing window, hold-then-release stall, noise floor', () => {
  const S = (rows) => rows.map(([t, x, y]) => ({ t, x, y }))
  // a steady 0.75 px/ms rightward flick reads back exactly
  const fl = gesture.releaseVelocity(S([[0, 0, 0], [16, 12, 0], [32, 24, 0], [48, 36, 0], [64, 48, 0]]))
  assert.ok(Math.abs(fl.vx - 0.75) < 0.001 && Math.abs(fl.vy) < 0.001, `steady flick reads 0.75 px/ms (got ${fl.vx})`)
  // only the trailing SAMPLE_WINDOW counts: early slow travel can't dilute a late flick
  const late = gesture.releaseVelocity(S([[0, 0, 0], [200, 10, 0], [216, 26, 0], [232, 42, 0]]))
  assert.ok(late.vx > 0.9, `windowed velocity ignores stale samples (got ${late.vx})`)
  // drag fast then HOLD then release: must read ~0, not the stale flick
  const hold = gesture.releaseVelocity(S([[0, 0, 0], [16, 30, 0], [32, 60, 0], [400, 60, 0]]))
  assert.equal(hold.vx, 0, 'a hold before release kills the stale velocity (no ghost commits)')
  // degenerate inputs never throw, never invent motion
  assert.deepEqual(gesture.releaseVelocity(S([[0, 0, 0]])), { vx: 0, vy: 0 })
  assert.deepEqual(gesture.releaseVelocity([]), { vx: 0, vy: 0 })
  assert.deepEqual(gesture.releaseVelocity(S([[0, 0, 0], [4, 30, 0]])), { vx: 0, vy: 0 }, 'a sub-frame pair is too noisy to trust')
})

test('WS2 deck physics: the snap-back spring settles fast, one small overshoot, never diverges', () => {
  // release just under threshold (79px out), finger still moving OUTWARD at 0.3 px/ms
  let x = 79
  let v = 300
  let overshoot = 0
  let crossings = 0
  let prevSign = 1
  let t = 0
  while (t < 2000) {
    const s = gesture.springStep(x, v, 16.7)
    x = s.x
    v = s.v
    t += 16.7
    const sign = Math.sign(x)
    if (sign !== 0 && sign !== prevSign) {
      crossings++
      prevSign = sign
    }
    if (sign === -1) overshoot = Math.max(overshoot, -x)
    if (Math.abs(x) < gesture.SPRING.restDist && Math.abs(v) < gesture.SPRING.restSpeed) break
  }
  assert.ok(t < 700, `spring settles under 700ms (took ${t.toFixed(0)}ms)`)
  assert.ok(crossings >= 1, 'the settle has a real overshoot (spring feel, not a tween)')
  assert.ok(overshoot > 0.5 && overshoot < 12, `overshoot is visible but small (got ${overshoot.toFixed(1)}px)`)
  // dropped frames can't explode the integration (dt clamps at 32ms inside springStep)
  let x2 = 79
  let v2 = 0
  for (let i = 0; i < 60; i++) {
    const s = gesture.springStep(x2, v2, 200) // pathological 200ms frames
    x2 = s.x
    v2 = s.v
    assert.ok(Math.abs(x2) <= 100, `integration stays bounded on huge frames (|x|=${Math.abs(x2).toFixed(1)})`)
  }
})

test('WS2 deck physics: flights inherit momentum within clamps + the SwipeDeck seam holds', () => {
  assert.equal(gesture.flightMs(0), 400, 'a button commit (speed 0) keeps the shipped 400ms flight')
  assert.equal(gesture.flightMs(3), 240, 'flights floor at 240ms however hard the flick')
  assert.equal(gesture.flightMs(99), 240, 'speed clamps before scaling')
  let prev = gesture.flightMs(0)
  for (let s = 0.2; s <= 3.01; s += 0.2) {
    const ms = gesture.flightMs(s)
    assert.ok(ms <= prev, 'a faster release never yields a slower flight')
    assert.ok(ms >= 240 && ms <= 400, `flight stays inside [240,400]ms (got ${ms})`)
    prev = ms
  }
  // seam-lock: consumers and sims must share ONE math — SwipeDeck re-exports it,
  // and the one-verdict-per-gesture nulling survives the velocity rework
  const sd = readFileSync(path.join(ROOT, 'app', 'src', 'SwipeDeck.jsx'), 'utf8')
  assert.ok(/from '\.\/deckgesture\.js'/.test(sd), 'SwipeDeck imports the pure math (one source of truth)')
  assert.ok(/export \{ gestureVerdict \}/.test(sd), 'SwipeDeck still exports gestureVerdict (consumer seam unchanged)')
  assert.ok(/dragRef\.current = null \/\/ one verdict per gesture/.test(sd), 'one-verdict-per-gesture: dragRef nulls BEFORE the commit')
})

// WS2 #7 — the decks' keyboard gesture path (JSX can't import into Node, so
// grep the contract): both consumers wire ←/→/↑ to the SAME deckApi commit
// paths as the buttons, gated to the rate phase (stale-closure guard) and
// dropping key repeats (no machine-gun verdicts from a held arrow).
test('WS2 deck a11y: arrow-key swipes ride the button commit paths on both decks', () => {
  for (const f of ['CalibrationDeck.jsx', 'LensDeck.jsx']) {
    const src = readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
    assert.ok(/onKeyDown=\{onDeckKey\}/.test(src), `${f} attaches the arrow-key handler to the deck page root`)
    assert.ok(/phase !== 'rate' \|\| ev\.repeat/.test(src), `${f} guards the handler to the rate phase and drops key repeats`)
    for (const [key, api] of [['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['ArrowUp', 'up']])
      assert.ok(new RegExp(`ev\\.key === '${key}'[\\s\\S]{0,80}deckApi\\.current\\.${api}\\(\\)`).test(src), `${f}: ${key} commits via deckApi.${api}() (the button path)`)
  }
})

// W3 wiring — HotView must read curateFeed and ship the See-all escape (the
// view can't import into Node: JSX + CSS), so grep the contract.
test('W3 wiring: HotView curates Everything + keeps a See-all escape to all events', () => {
  const hotSrc = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  assert.ok(/curateFeed\(/.test(hotSrc), 'HotView must build the Everything feed via curateFeed')
  assert.ok(/feed\.curated/.test(hotSrc) && /feed\.full/.test(hotSrc), 'HotView must hold both the curated default and the full See-all feed')
  assert.ok(/setSeeAllEv/.test(hotSrc), 'HotView must have a See-all toggle state (the never-hide escape)')
  assert.ok(/feed\.fullEventCount/.test(hotSrc), 'the See-all label must quote the real event total (fullEventCount), not the collapsed card count')
  // the collapsed-card "+N more dates" must render somewhere (cards.jsx Row)
  const cardsSrc = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.ok(/_moreDates/.test(cardsSrc), 'the row must surface _moreDates ("+N more dates") so a collapsed card is honest')
})

// W3 NEVER-HIDE — the rendered open path for collapsed instances. The data
// proof above (full's _series enumerate every event) is necessary but NOT
// sufficient: a non-rep instance is only truly reachable if some surface
// RENDERS it as openable. The collapsed card opens only its rep, so the
// disclosure must live in DetailPage — it maps rep._series to per-instance
// open controls. Without this, 555/1198 events would exist in data but be
// openable nowhere (the bug this fix closes). Source-grep, since DetailPage is
// JSX+CSS and can't import into Node.
test('W3 never-hide: DetailPage renders rep._series as openable per-instance rows', () => {
  const detailSrc = readFileSync(path.join(ROOT, 'app', 'src', 'DetailPage.jsx'), 'utf8')
  // it must read the series and gate on a real multi-instance group (>1)
  assert.ok(/e\._series/.test(detailSrc), 'DetailPage must read e._series (the collapsed instances)')
  assert.ok(/_series\.length\s*>\s*1/.test(detailSrc), 'DetailPage must only show the list for a genuine series (length > 1)')
  // it must MAP the series to rows, each calling onSelect on that instance —
  // the actual open path (every instance, not just the rep, becomes tappable)
  assert.ok(/_series\.map\(/.test(detailSrc), 'DetailPage must map over _series (one row per instance)')
  assert.ok(/onClick=\{\(\)\s*=>\s*onSelect\(inst/.test(detailSrc), 'each instance row must open THAT instance via onSelect(inst, …)')
})

// ============================================================
// Cohesion type snap — the re-rhythm tripwires. (1) HALF-PIXEL font sizes are
// BANNED: the 58-strong 11.5/12.5/13.5/14.5 sprawl was the measured "different
// hands" tell, and it snapped onto the C4 scale (--t-body/--t-meta/--t-meta-sm/
// --t-micro). A new n.5px font-size re-opens the wobble — fail loud. (2) The
// orphan 650/750 weights stay retired (600/700 are the sanctioned steps; 550 is
// the one deliberate mid-weight, forecast.css). Values only — selectors are free.
// ============================================================
test('Cohesion type snap: no half-pixel font sizes, no 650/750 weights (app CSS)', () => {
  const dir = path.join(ROOT, 'app', 'src')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(path.join(dir, f), 'utf8')
    const halves = css.match(/font-size:\s*\d+\.5px/g) || []
    assert.equal(halves.length, 0, `${f} re-introduces a half-pixel font-size (${halves[0] || ''}) — snap it onto the C4 type scale`)
    const orphans = css.match(/font-weight:\s*[67]50\b/g) || []
    assert.equal(orphans.length, 0, `${f} re-introduces an orphan ${orphans[0] || ''} — use 600/700 (550 is the only sanctioned mid-weight)`)
  }
})

// Stage D data-tail (e): "About this event" is Eventbrite PAGE CHROME, not
// description text — cleanDescription strips it at ingest. Pinned as a unit
// fixture because the fix is invisible to cache-fallback warm runs (module
// caches hold already-normalized events); the shipped Pinellas solid-waste
// tour record heals on the next live refresh.
test('finder ingest: cleanDescription strips leading Eventbrite "About this event" chrome', async () => {
  const { cleanDescription } = await import('../finder/finder.mjs')
  // the shipped artifact, verbatim prefix shape
  assert.equal(
    cleanDescription('About this event There’s no such place as away! Join us to find out what happens to your garbage.'),
    'There’s no such place as away! Join us to find out what happens to your garbage.',
    'the chrome prefix must be stripped at ingest'
  )
  // separator variants glue the heading on with punctuation
  assert.equal(cleanDescription('About this event: Doors at 7.'), 'Doors at 7.')
  // chrome-only description -> no description (null beats an empty husk)
  assert.equal(cleanDescription('About this event'), null)
  // NOT a prefix -> untouched (never rewrite mid-text mentions)
  assert.equal(
    cleanDescription('Curious about this event? Come along.'),
    'Curious about this event? Come along.',
    'mid-text mentions must never be rewritten'
  )
  // the strip runs BEFORE the 200-char cap, so real text fills the blurb
  const long = 'About this event ' + 'x'.repeat(250)
  const out = cleanDescription(long)
  assert.equal(out.length, 200, 'cap applies to the DE-CHROMED text')
  assert.ok(out.startsWith('xxx'), 'recovered characters are real text, not chrome')
})

// ============================================================
// D-G2 — stable event ids (STAGE_D.md grafts; V2_VISION.md §8.6). The id is
// a VERSIONED CONTRACT: sha256("v1|<cityId>|<titleKey>|<startDay>[|<venueKey>
// [|<n>]]") → 16 hex. These units pin the recipe's survival guarantees
// against the measured churn classes from the identity forensics: start
// flips date-only↔timed (mint from the DAY), merged titles flip between
// member variants (fold diacritics + stem), venue strings churn twice (mint
// venue-FREE unless genuinely ambiguous), the emit array re-sorts every run
// (minting must be order-independent).
// ============================================================
test('D-G2 stable ids: the recipe contract — versioned, day-based, folded, venue-free', async () => {
  const { eventIdCanonical } = await import('../finder/finder.mjs')
  const c = (e) => eventIdCanonical(e, 'tampa-bay')
  // the exact canonical form is FROZEN (changing it = bumping the version prefix)
  assert.equal(c({ title: 'Sunset Music Series', start: '2026-07-10' }), 'v1|tampa-bay|music serie sunset|2026-07-10')
  // a date-only event that gains a time keeps its id (day-based minting)
  assert.equal(
    c({ title: 'Sunset Music Series', start: '2026-07-10T19:00:00-04:00' }),
    c({ title: 'Sunset Music Series', start: '2026-07-10' }),
    'date-only ↔ timed start flips must not move the id'
  )
  // diacritics fold for the id even though display titles keep them
  assert.equal(
    c({ title: 'Rosalía Oakland', start: '2026-07-06' }),
    c({ title: 'Rosalia Oakland', start: '2026-07-06' }),
    'Rosalía/Rosalia must mint ONE id (NFD fold)'
  )
  // stemming: the merge may legally pick a different member title run-to-run
  assert.equal(c({ title: 'REALM Exhibition', start: '2026-07-06' }), c({ title: 'REALM Exhibit', start: '2026-07-06' }))
  // token order, punctuation and stopwords never matter
  assert.equal(c({ title: 'The Journey West!', start: '2026-07-07' }), c({ title: 'Journey — West', start: '2026-07-07' }))
  // venue-free base: venue only ever enters as a collision tiebreak
  assert.equal(
    c({ title: 'Baby Time', start: '2026-07-02', venue: 'Brandon Regional Library' }),
    c({ title: 'Baby Time', start: '2026-07-02', venue: 'Port Tampa City Library' })
  )
  // two cities can never share an id input
  assert.notEqual(
    eventIdCanonical({ title: 'Baby Time', start: '2026-07-02' }, 'sf-east-bay'),
    c({ title: 'Baby Time', start: '2026-07-02' })
  )
  assert.match(
    c({ title: 'Night Market', start: '2026-07-15T01:00:00+02:00' }),
    /\|2026-07-15$/,
    'stable id v1 must retain the literal publisher day even when the city day differs',
  )
  assert.equal(
    c({ title: 'Mystery', start: 'July 15, 2026 7:00 PM' }),
    'v1|tampa-bay|mystery|tbd',
    'non-ISO dates must never mint a device-timezone-dependent identity day',
  )
})

test('D-G2 stable ids: minting — order-independent, tiebreaks confined, hard-fail loud', async () => {
  const { mintEventIds } = await import('../finder/finder.mjs')
  const fixture = () => [
    { title: 'Baby Time', start: '2026-07-02T10:15:00', venue: 'Brandon Regional Library', url: 'https://x/1' },
    { title: 'Baby Time', start: '2026-07-02T14:00:00', venue: 'West Tampa Branch Library', url: 'https://x/2' },
    { title: 'Jazz Night', start: '2026-07-02T20:00:00', venue: 'The Attic', url: 'https://x/3' },
    // level-3 pair: same title+day+venue, distinguished only by url (the
    // trolley-tour class — 1 real pair in Tampa, 0 in SF)
    { title: 'Trolley Tour', start: '2026-07-04T09:00:00', venue: 'History Museum', url: 'https://x/4a' },
    { title: 'Trolley Tour', start: '2026-07-04T09:00:00', venue: 'History Museum', url: 'https://x/4b' },
  ]
  const a = fixture()
  const rep = mintEventIds(a, 'tampa-bay')
  for (const e of a) assert.match(e.id, /^[0-9a-f]{16}$/, `"${e.title}" minted id ${JSON.stringify(e.id)}`)
  assert.equal(new Set(a.map((e) => e.id)).size, a.length, 'minted ids must be unique')
  assert.equal(rep.baseGroups, 2, 'two ambiguous title+day groups (Baby Time, Trolley Tour)')
  assert.equal(rep.venueQualified, 2, 'the Baby Time pair resolves at the venue level')
  assert.equal(rep.counterQualified, 2, 'the Trolley pair needs the level-3 counter')
  // order independence: the emit array re-sorts by startMs every run — a
  // reversed multiset must mint the exact same id per event
  const b = fixture().reverse()
  mintEventIds(b, 'tampa-bay')
  const byUrl = new Map(b.map((e) => [e.url, e.id]))
  for (const e of a) assert.equal(byUrl.get(e.url), e.id, `array order leaked into the id of "${e.title}" (${e.url})`)
  // churn survival on an UNambiguous event: a venue rename (venue-free base)
  // AND losing the clock (day-based) both leave the id untouched
  const solo = [{ title: 'Jazz Night', start: '2026-07-02', venue: 'The Attic Rooftop (Renamed)', url: 'https://x/3' }]
  mintEventIds(solo, 'tampa-bay')
  assert.equal(solo[0].id, a[2].id, 'venue rename + date-only start must not move an unambiguous id')
  // indistinguishable twins (every identity fact equal) must FAIL the build,
  // never ship an arbitrary assignment
  const twins = [
    { title: 'Trolley Tour', start: '2026-07-04T09:00:00', venue: 'History Museum', url: 'https://x/same' },
    { title: 'Trolley Tour', start: '2026-07-04T09:00:00', venue: 'History Museum', url: 'https://x/same' },
  ]
  assert.throws(() => mintEventIds(twins, 'tampa-bay'), /HARD COLLISION/, 'indistinguishable twins must fail loudly')
})

// D-G2 artifact pins: BOTH cities' committed finder artifacts carry the ids.
// Bytes captured at module load — the fast-mode finder run overwrites (then
// restores) the active city's artifact mid-suite; same hazard fullRaw dodges.
const CITY_ID_ARTIFACTS = ['tampa-bay', 'sf-east-bay'].map((city) => {
  const p = path.join(ROOT, 'finder', 'output', city, 'events.json')
  return { city, raw: existsSync(p) ? readFileSync(p, 'utf8') : null }
})

test("D-G2 stable ids: both cities' committed artifacts — present, well-formed, unique, recipe-true", async () => {
  const { mintEventIds } = await import('../finder/finder.mjs')
  for (const { city, raw } of CITY_ID_ARTIFACTS) {
    assert.ok(raw, `finder/output/${city}/events.json missing — BOTH cities ship stable ids (D-G2)`)
    const events = JSON.parse(raw)
    assert.ok(Array.isArray(events) && events.length > 0, `${city}: events.json is not a non-empty array`)
    const bad = events.filter((e) => typeof e.id !== 'string' || !/^[0-9a-f]{16}$/.test(e.id))
    assert.equal(
      bad.length,
      0,
      `${city}: ${bad.length} events without a valid 16-hex stable id (first: "${bad[0] && bad[0].title}")`
    )
    assert.equal(new Set(events.map((e) => e.id)).size, events.length, `${city}: duplicate stable ids in the committed artifact`)
    // recipe reproduction: re-minting the same multiset under the CURRENT
    // recipe must reproduce every committed id exactly — a recipe edit
    // without a version bump + artifact regeneration turns this red instead
    // of silently orphaning every id already shipped or shared
    const copy = JSON.parse(raw)
    for (const e of copy) delete e.id
    mintEventIds(copy, city)
    const drift = copy.filter((e, i) => e.id !== events[i].id)
    assert.equal(
      drift.length,
      0,
      `${city}: ${drift.length} committed ids do not reproduce under the current recipe ` +
        `(first: "${drift[0] && drift[0].title}") — bump ID_RECIPE_VERSION and regenerate the artifacts`
    )
  }
})

// ============================================================
// Stage E — the ⚑X3 attribution page (ROADMAP §1: "sources disclosed").
// The page's whole contract is DERIVATION: every credit line must come from
// the loaded data / city config at render time, never a hand-maintained list
// that can drift. These guards pin (1) the wiring (nav union → App slot →
// Settings row), (2) the derivation call sites, (3) the two config-level
// license obligations (OSM ODbL, Open-Meteo), and (4) that no event-source
// NAME is hardcoded in the page (the anti-drift tripwire). JSX can't import
// into Node — source-grep, the Addendum-O precedent.
// ============================================================
test('Stage E attribution: page wired from Settings (nav union + App slot + About row)', () => {
  const nav = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  const st = readFileSync(path.join(ROOT, 'app', 'src', 'SettingsPage.jsx'), 'utf8')
  // nav: the single-slot opener exists and is exported through the context value
  assert.ok(/const openAttribution = useCallback/.test(nav), 'nav exposes openAttribution')
  assert.ok(/setPage\(\{ type: 'attribution' \}\)/.test(nav), "openAttribution sets {type:'attribution'} (single-slot union)")
  assert.ok((nav.match(/openAttribution,/g) || []).length >= 2, 'openAttribution is in the context value AND the memo deps')
  // App: imports the page + renders it in the .subpage slot with the live events
  assert.ok(/import AttributionPage/.test(app), 'App imports AttributionPage')
  assert.ok(/page\.type === 'attribution' && <AttributionPage events=\{norm\}/.test(app), 'App renders the attribution subpage with the LOADED events (derivation input)')
  // Settings: the About row opens it; the old "coming soon" stub is retired
  assert.ok(/openAttribution/.test(st) && /Data &amp; photo credits/.test(st), 'Settings has a real "Data & photo credits" row wired to openAttribution')
  assert.ok(!/coming with the public release/.test(st), 'the old About stub line is retired (the promise is kept, not re-promised)')
})

test('Stage E attribution: every section DERIVES from data/config — nothing hand-listed', () => {
  const at = readFileSync(path.join(ROOT, 'app', 'src', 'AttributionPage.jsx'), 'utf8')
  // (a) event sources: derived via lib.js sourceFamily over the loaded events —
  // and NO real source name is hardcoded in the page (the anti-drift tripwire:
  // a hand-list would rot the moment the finder's source roster changes)
  assert.ok(/sourceFamily/.test(at), 'event source names derive from sourceFamily(e) over the loaded events')
  assert.ok(/added-by-you/.test(at), "the user's own added events are excluded from the source tally (they're not a source)")
  for (const name of ['Hillsborough Libraries', 'Visit Tampa Bay', 'Eventbrite', 'Meetup']) {
    assert.ok(!at.includes(name), `no hardcoded event-source name in the page ("${name}" must come from data)`)
  }
  // (b) place sources: derived from places.json's sources[] via the shared store
  assert.ok(/usePlaces\(/.test(at), 'place data rides the shared places store (the same /places.json the app ships)')
  assert.ok(/p\.sources/.test(at), "place dataset names derive from each place's sources[] field")
  for (const name of ['Pinellas Park Points', 'FWC Boat Ramps', 'Tampa Parks']) {
    assert.ok(!at.includes(name), `no hardcoded place-source name in the page ("${name}" must come from data)`)
  }
  // (c) photos: credits from the real imageCredit fields (author/license/licenseUrl/url),
  // license families derived (Mapillary split via the recorded sourceFamily)
  assert.ok(/imageCredit/.test(at), 'photo credits read the real imageCredit records')
  assert.ok(/mapillary-sign/.test(at), 'the Mapillary family splits on the RECORDED sourceFamily, not a name guess')
  for (const field of ['author', 'licenseUrl']) {
    assert.ok(new RegExp('c\\.' + field).test(at), `the photographer ledger renders the real ${field} field`)
  }
  // the city hero credits come from the config arrays (city.js), never retyped
  assert.ok(/CITY\.heroes/.test(at) && /CITY\.spotsHeroes/.test(at), 'hero credits derive from CITY.heroes/CITY.spotsHeroes')
  for (const field of ['credit', 'license', 'licenseUrl', 'page']) {
    assert.ok(new RegExp('h\\.' + field).test(at), `hero credit rendering reads the config ${field} field`)
  }
  assert.ok(!/Eric Statzer|Ebyabe/.test(at), 'no hero photographer name is hardcoded (config-derived only)')
  // city name interpolates from CITY (per-city by construction)
  assert.ok(/CITY\.name/.test(at), 'the city name interpolates from CITY (a second city needs zero page edits)')
})

test('Stage E attribution: the license obligations render — ODbL, Open-Meteo, the art-floor promise', () => {
  const at = readFileSync(path.join(ROOT, 'app', 'src', 'AttributionPage.jsx'), 'utf8')
  // OSM ODbL is the one REQUIRED attribution (PLACES_SOURCES §6) — pinned verbatim
  assert.ok(/OpenStreetMap contributors/.test(at), 'the ODbL-required "© OpenStreetMap contributors" line renders')
  assert.ok(/openstreetmap\.org\/copyright/.test(at) && /opendatacommons\.org\/licenses\/odbl/.test(at), 'the OSM copyright + ODbL license links are real destinations')
  // Open-Meteo (weather.js) — CC BY 4.0, linked
  assert.ok(/open-meteo\.com/.test(at) && /creativecommons\.org\/licenses\/by\/4\.0/.test(at), 'Open-Meteo is credited with its CC BY 4.0 license link')
  // the app's own floor: the no-stock promise, stated to users (the contract)
  assert.ok(/generated artwork/.test(at) && /stock photo/.test(at), 'the art-floor honesty line renders (photoless places show art, never stock)')
  // the page speaks the app's sub-page language: pg shell + uppercase eyebrows
  assert.ok(/className="pg at"/.test(at) && /pg-head-title/.test(at), 'the page rides the pg/pg-head shell (one designed app)')
  const css = readFileSync(path.join(ROOT, 'app', 'src', 'attribution.css'), 'utf8')
  assert.ok(/--eyebrow-size/.test(css) && /text-transform: uppercase/.test(css), 'section labels ride the WS3 metadata-eyebrow contract')
  assert.ok(/var\(--accent-ink\)/.test(css), 'links use the AA-safe --accent-ink token (no new colors)')
})

// ============================================================================
// Stage E ship-shell — PWA installability + the dark-mode second ladder.
// The dark guards are COMPUTED, not asserted: the test parses the pinned dark
// hexes out of index.css and recomputes the WCAG ratios (wcag-dark.mjs's math,
// inlined) so a future "tune the dark bg one step" edit that silently breaks a
// pair trips HERE, not on a user's phone.
// ============================================================================

test('Stage E ship-shell: installable PWA — manifest plugin, icon set, iOS wiring', () => {
  const vc = readFileSync(path.join(ROOT, 'app', 'vite.config.js'), 'utf8')
  // the manifest is EMITTED from the one city registry — never a second copy
  assert.ok(/name: 'city-manifest'/.test(vc), 'vite.config carries the city-manifest plugin (Stage E)')
  assert.ok(/emitFile\(\{ type: 'asset', fileName: 'manifest\.webmanifest'/.test(vc), 'the plugin emits manifest.webmanifest into the build')
  assert.ok(/configureServer/.test(vc), 'the plugin also serves the manifest in dev (installability signals testable live)')
  assert.ok(vc.includes('`Wuzup · ${CITY.name}`'), 'the manifest name derives from CITY.name (D4: one registry)')
  assert.ok(!/Tampa Bay/.test(vc), 'vite.config must not hardcode a city name — a second city needs zero edits here')
  assert.ok(/display: 'standalone'/.test(vc) && /orientation: 'portrait'/.test(vc), 'standalone + portrait — the installed shell')
  assert.ok(!/serviceWorker|navigator\.serviceWorker/.test(vc), 'NO service worker ships (offline is v2; zero SW = events.json can never be cache-stale)')
  // the icon set exists and is really PNG (magic bytes, not just filenames)
  for (const f of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-192.png', 'icons/icon-maskable-512.png', 'apple-touch-icon.png']) {
    const fp = path.join(ROOT, 'app', 'public', f)
    assert.ok(existsSync(fp), `missing PWA icon app/public/${f}`)
    const head = readFileSync(fp).subarray(0, 8).toString('hex')
    assert.equal(head, '89504e470d0a1a0a', `app/public/${f} is not a real PNG (magic bytes)`)
  }
  const html = readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8')
  assert.ok(/rel="manifest" href="\/manifest\.webmanifest"/.test(html), 'index.html links the manifest')
  assert.ok(/rel="apple-touch-icon"/.test(html), 'index.html links the apple-touch-icon (iOS ignores manifest icons)')
  assert.ok(/name="apple-mobile-web-app-capable"/.test(html) && /name="mobile-web-app-capable"/.test(html), 'both standalone-capable meta spellings present')
})

test('Stage E dark mode: the ladder exists, covers the core tokens, and every pinned pair COMPUTES >= AA', () => {
  const ic = readFileSync(path.join(ROOT, 'app', 'src', 'index.css'), 'utf8')
  // the light seam tokens are minted AT their shipped values (byte-inert swaps)
  assert.ok(/--cta-ink: #bb5719/.test(ic), ':root mints --cta-ink at the shipped --cta hex (light-inert)')
  assert.ok(/--img-ph: #e9e2d9/.test(ic), ':root mints --img-ph at the shipped imgbox placeholder')
  assert.ok(/--prose: #4a423a/.test(ic), ':root mints --prose at the shipped detail-prose ink')
  assert.ok(/--card-rgb: 254, 253, 251/.test(ic) && /--sheet-rgb: 250, 248, 245/.test(ic) && /--bg-rgb: 250, 246, 241/.test(ic), ':root mints the rgb glass companions at shipped values')
  // the dark :root ladder
  const m = ic.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/)
  assert.ok(m, 'index.css carries the dark ladder: @media (prefers-color-scheme: dark) { :root { … } }')
  const d = m[1]
  assert.ok(/color-scheme: dark/.test(d), 'dark ladder flips color-scheme (native controls follow)')
  const pin = (tok) => {
    const mm = d.match(new RegExp('--' + tok + ': (#[0-9a-f]{6})'))
    assert.ok(mm, `dark ladder re-derives --${tok}`)
    return mm[1]
  }
  const BG = pin('bg'), CARD = pin('card'), INK = pin('ink'), MUTED = pin('muted')
  const ACC = pin('accent-ink'), CTA = pin('cta-ink'), FREE = pin('free-ink')
  const DANGER = pin('danger'), PROSE = pin('prose')
  pin('accent-ink-strong'); pin('img-ph'); pin('chip-fill'); pin('skel-lo'); pin('skel-hi')
  assert.ok(/--ink-rgb: 245, 239, 231/.test(d), 'dark --ink-rgb follows the cream ink (glass/tints invert with it)')
  assert.ok(/--line: rgba\(245, 239, 231/.test(d), 'dark --line is low-alpha warm LIGHT (never a gray hairline)')
  assert.ok(/--shadow-1: [^;]*rgba\(0, 0, 0/.test(d), 'dark shadows switch to true black (warm-ink shadows vanish on dark)')
  assert.ok(!/--deck-bg|--deck-card/.test(d), 'the deck-family surface tokens are NOT re-derived (dark by contract, ROADMAP §1.3)')
  assert.ok(!/--cta:|--hot:|--reward:|--accent: /.test(d), 'fills (--cta/--hot/--reward/--accent) are NOT re-derived — white-on-CTA is canvas-independent')
  // COMPUTE the ratios (WCAG relative luminance) — the guard recalculates, never trusts
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05) }
  const atLeast = (fg, bg, min, what) => assert.ok(ratio(fg, bg) >= min, `${what}: ${ratio(fg, bg).toFixed(2)}:1 < ${min}:1 — the dark pair regressed`)
  atLeast(INK, BG, 10, 'dark ink on bg')
  atLeast(INK, CARD, 10, 'dark ink on card')
  atLeast(MUTED, CARD, 4.6, 'dark muted on card')
  atLeast(ACC, CARD, 4.5, 'dark accent-ink (gold) on card')
  atLeast(CTA, CARD, 4.5, 'dark cta-ink on card')
  atLeast(FREE, CARD, 4.5, 'dark free-ink on card')
  atLeast(DANGER, CARD, 4.5, 'dark danger on card')
  atLeast(PROSE, CARD, 4.5, 'dark prose on card')
  atLeast('#ffffff', '#bb5719', 4.5, 'white on --cta (must hold on ANY canvas)')
})

test('post-ship honesty: event fetch failure is distinct from a genuinely empty city', () => {
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  const artifacts = readFileSync(path.join(ROOT, 'app', 'src', 'artifacts.js'), 'utf8')
  const css = readFileSync(path.join(ROOT, 'app', 'src', 'App.css'), 'utf8')
  const hot = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  assert.ok(/useArtifact\('events'\)/.test(app), 'App consumes the verified runtime repository')
  assert.ok(/eventArtifact\.status === 'offline' \|\| eventArtifact\.status === 'error'/.test(app), 'transport/integrity failure remains separate from empty')
  assert.ok(/status: 'empty'/.test(artifacts) && /status: error\.code === 'OFFLINE' \? 'offline' : 'error'/.test(artifacts), 'the repository has distinct empty/offline/error states')
  assert.ok(/transportError && primer && !remotePageBlocked/.test(app) && /className=\{'load-note'/.test(app) && /onClick=\{recoverEvents\}/.test(app), 'the load error is announced after onboarding with a usable recovery action')
  assert.ok(/remotePageBlocked[\s\S]*?<EventUnavailablePage/.test(app), 'event-only subpages replace false empty results with an actionable unavailable state')
  assert.ok(/\.stale-note,[\s\S]*?\.load-note \{[\s\S]*?z-index: 2050;/.test(css), 'the global data alert stays above mixed subpages and detail instead of exposing false empty copy')
  assert.ok(/loadError=\{unavailable\}/.test(app), 'App tells Events when inventory is unavailable rather than genuinely empty')
  assert.ok(/!loading && !loadError && upcoming\.length === 0/.test(hot), 'HotView empty copy is reserved for a successful empty dataset')
})

test('Stage E dark mode: straggler seams hold — no resurrected light literals, ink-on-gold pinned, decks untouched', () => {
  const src = (f) => readFileSync(path.join(ROOT, 'app', 'src', f), 'utf8')
  // the tokenized literals must not come back as raw declarations
  assert.ok(!/background: #e9e2d9/.test(src('cards.css')), 'imgbox placeholder rides var(--img-ph), not the raw light hex')
  assert.ok(!/rgba\(254, 253, 251/.test(src('App.css')), 'tabbar glass rides var(--card-rgb)')
  for (const f of ['topnav.css', 'weekend.css']) assert.ok(!/rgba\(250, 248, 245/.test(src(f)), `${f}: frosted sheet rides var(--sheet-rgb)`)
  for (const f of ['App.css', 'detail.css']) assert.ok(!/color: #4a423a/.test(src(f)), `${f}: prose rides var(--prose)`)
  // accent TEXT/outline sites ride --cta-ink (the fill hex reads 3.55:1 as dark text)
  for (const f of ['day.css', 'nextdays.css', 'calpicker.css', 'calendar.css']) {
    assert.ok(!/color: var\(--cta\)/.test(src(f)), `${f}: no color: var(--cta) text remains — accent text rides --cta-ink`)
  }
  assert.ok((src('day.css').match(/var\(--cta-ink\)/g) || []).length >= 5, 'day.css consumes --cta-ink at its five swapped sites')
  // ink-on-gold pins: the gold fill is mode-invariant, its ink must not flip to cream (2.02:1)
  for (const [f, sel] of [['bubble.css', '\\.srch-tab\\.on'], ['calendar.css', '\\.mon-opt\\.on'], ['calendar.css', '\\.mcell\\.sel \\.mnum'], ['locations.css', '\\.loc-plan-day\\.on']]) {
    const dark = src(f).match(/@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n\}/)
    assert.ok(dark && new RegExp(sel + '[^}]*color: #1a1410').test(dark[1]), `${f}: ${sel} pins #1a1410 in its dark block (ink-on-gold)`)
  }
  // toasts invert with their ink-rgb glass
  assert.ok(/\.stale-note \{ color: var\(--bg\); \}/.test(src('App.css')), 'the stale-note toast text inverts to the canvas color in dark')
  // the dark DECK contract: those surfaces are dark in BOTH modes — no media forks
  for (const f of ['deck.css', 'lensdeck.css', 'primer.css', 'swipedeck.css']) {
    assert.ok(!/prefers-color-scheme/.test(src(f)), `${f} stays mode-invariant (the dark-deck contract, ROADMAP §1.3)`)
  }
  // the browser chrome follows the canvas pair
  const html = readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8')
  assert.ok(/media="\(prefers-color-scheme: light\)" content="#faf6f1"/.test(html), 'theme-color light = the shipped canvas')
  assert.ok(/media="\(prefers-color-scheme: dark\)" content="#1b1611"/.test(html), 'theme-color dark = the dark canvas')
})

// ============================================================================
// Stage D graft D-G1 — the Coverage Card ("what we know here"; STAGE_D.md
// grafts + V2_VISION §8.6 ruling #6). The card's whole contract is the
// attribution page's: every number DERIVES at render time from data the app
// already loads, and an absent input makes a line DISAPPEAR, never a guess.
// These guards pin (1) the wiring + the two Home positions, (2) the
// derivation call sites + the anti-drift tripwire (no hardcoded names/counts),
// (3) the PROMOTION GATE against the REAL shipped snapshot — this city must
// read rich, so the "we're new here" form must never appear on its data —
// plus the isSparse edges (0 = failed fetch, NOT a new city), and (4) the
// tokens-only CSS that lets the Stage E dark ladder carry both schemes with
// zero forks. JSX can't import into Node — source-grep for the component,
// real imports for coverage.js (plain js by design).
// ============================================================================
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('D-G1 coverage: wired — App hands immutable metadata, Home carries both forms, attribution carries the header', () => {
  const app = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(/<HomeView events=\{norm\} anchors=\{anchors\} wx=\{wx\} dataMeta=\{eventArtifact\.meta\}/.test(app), 'App hands manifest metadata to HomeView')
  assert.ok(/<AttributionPage events=\{norm\} dataMeta=\{eventArtifact\.meta\}/.test(app), 'App hands manifest metadata to AttributionPage')
  const home = readFileSync(path.join(ROOT, 'app', 'src', 'HomeView.jsx'), 'utf8')
  assert.ok(/import CoverageCard from '\.\/CoverageCard\.jsx'/.test(home), 'Home imports the card')
  assert.ok(/isSparse\(coverageStats\(events\)\.events\)/.test(home), "Home's placement decision rides coverage.js (one derivation, no local magic number)")
  assert.ok(/\{sparse && \(/.test(home) && /\{!sparse && \(/.test(home), 'ONE card: promoted (sparse) XOR colophon (rich) — never both')
  const promotedAt = home.indexOf('<CoverageCard events={events} dataMeta={dataMeta} promoted />')
  assert.ok(promotedAt !== -1, 'the sparse form renders promoted')
  assert.ok(promotedAt < home.indexOf('title="Your next days"'), 'the promoted form leads Home (above the first section) — the week-one honest floor')
  assert.ok(home.indexOf('title="Quick actions"') < home.indexOf('{!sparse && ('), 'the rich-city colophon sits under the LAST section')
  const at = readFileSync(path.join(ROOT, 'app', 'src', 'AttributionPage.jsx'), 'utf8')
  assert.ok(/<CoverageCard events=\{events\} dataMeta=\{dataMeta\} \/>/.test(at), 'the attribution page mounts the card as its summary header')
  assert.ok(at.indexOf('<CoverageCard') < at.indexOf('Event listings'), 'the header sits above the per-source breakdown sections')
})

test('D-G1 coverage: every number DERIVES — no hardcoded names/counts/city, no boot fetch, the honesty guards hold', () => {
  const cc = readFileSync(path.join(ROOT, 'app', 'src', 'CoverageCard.jsx'), 'utf8')
  const cov = readFileSync(path.join(ROOT, 'app', 'src', 'coverage.js'), 'utf8')
  // derivation call sites
  assert.ok(/sourceFamily/.test(cov), 'the source count derives via lib.js sourceFamily over the loaded events')
  assert.ok(/added-by-you/.test(cov), "the user's own added events are excluded (they're not a source)")
  assert.ok(/p\.image && p\.imageCredit/.test(cov), 'imagery coverage counts REAL credited photos only (the attribution-ledger predicate)')
  assert.ok(/usePlaces\(false\)/.test(cc), 'the card SUBSCRIBES to the places store but never triggers the ~1.2MB fetch (usePlaces(false) — Home pays nothing at boot)')
  // honesty guards
  assert.ok(/dataMeta\?\.generatedAt/.test(cc) && /Number\.isFinite\(dataAt\)/.test(cc), 'the data date renders only from a valid immutable generatedAt')
  assert.ok(/sourceHealth === 'degraded'/.test(cc) && /sourceHealth === 'unknown'/.test(cc), 'source-health limitations are disclosed instead of hidden')
  assert.ok(!/Last-Modified|last-modified/.test(cc), 'host file timestamps never drive coverage freshness')
  assert.ok(/stats\.events === 0\) return null/.test(cc), 'zero loaded events renders NOTHING (a failed fetch is not a sparse city)')
  assert.ok(/CITY\.shortName/.test(cc), 'the sparse sentence interpolates CITY.shortName (per-city by construction)')
  // the anti-drift tripwire (attribution precedent): nothing real is hand-typed
  for (const src of [stripComments(cc), stripComments(cov)]) {
    assert.ok(!/Tampa/.test(src), 'no city name hardcoded in the card/derivation code')
    for (const name of ['Eventbrite', 'Meetup', 'AllEvents', 'Creative Loafing']) {
      assert.ok(!src.includes(name), `no hardcoded event-source name ("${name}" must come from data)`)
    }
    assert.ok(!/1,?665|2,?163|\b139\b/.test(src), 'no snapshot count hardcoded — every number interpolates from the derived stats')
  }
})

test('D-G1 coverage: the promotion gate — the REAL snapshot reads rich (never the "new here" form); isSparse honest at the edges', async () => {
  const covMod = await import('../app/src/coverage.js')
  // the live gate: with this repo's shipped data the promoted form must not exist
  const stats = covMod.coverageStats(fullEvents)
  assert.ok(stats.events >= covMod.SPARSE_EVENTS_FLOOR, `the shipped snapshot (${stats.events} events) must clear SPARSE_EVENTS_FLOOR (${covMod.SPARSE_EVENTS_FLOOR}) — if this trips, either the data collapsed or the floor crept; the promoted form must NEVER appear on this city`)
  assert.equal(covMod.isSparse(stats.events), false, 'the live snapshot is not sparse')
  assert.ok(stats.sources >= 5, `a rich snapshot speaks many voices (got ${stats.sources})`)
  // the edges: 0 = failed/absent fetch, NOT a week-one city; the floor itself is rich
  assert.equal(covMod.isSparse(0), false, '0 events = no data, never "0 events and growing"')
  assert.equal(covMod.isSparse(1), true, '1 event is a sparse (but real) city')
  assert.equal(covMod.isSparse(covMod.SPARSE_EVENTS_FLOOR - 1), true, 'one under the floor promotes')
  assert.equal(covMod.isSparse(covMod.SPARSE_EVENTS_FLOOR), false, 'the floor itself reads rich (strict less-than)')
  // family folding + added-by-you exclusion (the Settings/attribution rule)
  const mk = (src, tags) => ({ sources: [src], tags })
  const s2 = covMod.coverageStats([mk('Eventbrite (p2)'), mk('Eventbrite (Free)'), mk('WMNF 88.5'), mk('Meetup', ['added-by-you'])])
  assert.equal(s2.events, 3, 'added-by-you entries are excluded from the event count')
  assert.equal(s2.sources, 2, 'source FAMILIES fold the parenthetical variants (Eventbrite ×2 = one voice)')
  // photoStats: silent until the layer loads; counts exactly the credited photos — on the REAL data
  assert.equal(covMod.photoStats(null), null, 'places layer not loaded = no claim (null, not zeros)')
  assert.equal(covMod.photoStats([]), null, 'an empty/failed places load claims nothing')
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const ph = covMod.photoStats(doc.places)
  const credited = doc.places.filter((p) => p.image && p.imageCredit).length
  assert.equal(ph.photos, credited, 'photoStats counts exactly the image+imageCredit places')
  assert.ok(ph.photos > 0 && ph.photos < ph.spots, `real data: ${ph.photos}/${ph.spots} credited — a strict subset (a card claiming every spot has a photo would be a lie)`)
  // dayStamp keeps the stale-banner idiom: weekday inside 6 days, date beyond
  assert.equal(covMod.dayStamp(Date.now()), new Date().toLocaleDateString('en-US', { weekday: 'long' }), 'a fresh stamp reads as the weekday')
  assert.match(covMod.dayStamp(Date.now() - 30 * 86400000), /^[A-Z][a-z]{2} \d{1,2}$/, 'an old stamp reads as "Mon D"')
})

test('D-G1 coverage: tokens-only CSS — the dark ladder carries both schemes; eyebrow canon; zero accent spend', () => {
  const css = readFileSync(path.join(ROOT, 'app', 'src', 'coverage.css'), 'utf8')
  const bare = stripComments(css)
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(bare), 'no raw color literals — every color rides a token the dark ladder re-derives (both schemes AA by construction)')
  assert.ok(!/prefers-color-scheme/.test(bare), 'no dark fork needed: tokens only')
  assert.ok(/var\(--card\)/.test(bare) && /var\(--shadow-1\)/.test(bare) && /var\(--r-lg\)/.test(bare), 'the plate speaks the system: --card + --shadow-1 (a colophon, not a feature) + --r-lg')
  assert.ok(/--eyebrow-size/.test(bare) && /text-transform: uppercase/.test(bare) && /var\(--muted\)/.test(bare), 'the WHAT-WE-KNOW eyebrow rides the WS3 metadata contract, muted (A6 accent restraint)')
  assert.ok(!/--accent|--hot|--reward|--cta/.test(bare), 'a passive disclosure spends NO accent/hot/reward/cta')
  const cc = readFileSync(path.join(ROOT, 'app', 'src', 'CoverageCard.jsx'), 'utf8')
  assert.ok(/className="num"/.test(cc), 'counts wear .num tabular numerals (the type canon)')
})
