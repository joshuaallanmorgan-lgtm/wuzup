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
import { lookup as dnsLookup } from 'node:dns/promises'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// city-agnostic: the box + roster anchors come from the active city config, the
// place/category vocab from the canonical taxonomy (categories.js) — so a new city
// doesn't fail the build on hard-coded Tampa values.
import { bbox as CITY_BBOX, rosterBenchmark as CITY_ROSTER } from '../finder/cities/index.mjs'
import { PLACETYPE_HUE, CATEGORY_HUES } from '../app/src/categories.js'
import * as deckdeal from '../app/src/deckdeal.js'

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

// network gate: the finder fast-mode pulls from live sources (Nominatim geocode +
// static feeds). When the box is OFFLINE the yield collapses and the source-count
// + cross-source-merge assertions go falsely red. A quick DNS probe (no HTTP load,
// no rate-limit) lets those hold the line when online and downgrade to a diagnostic
// when not — "gate when offline, never silently delete the assertion".
async function isOnline() {
  for (const host of ['one.one.one.one', 'dns.google']) {
    try {
      await dnsLookup(host)
      return true
    } catch {
      /* try the next probe host */
    }
  }
  return false
}

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
    // buzz (cross-source merge) + the source-count floor below depend on the LIVE
    // sources landing; OFFLINE they collapse. Probe once: hold the line when online
    // (a real merge/source regression must still fail), gate with a diagnostic when not.
    const online = await isOnline()
    if (online) {
      assert.ok(buzzN >= 1, `cross-source merge produced ${buzzN} buzz>=2 events in fast mode (expected >= 1): "${buzzLine.trim()}"`)
    } else {
      t.diagnostic(`OFFLINE — gating the buzz>=2 cross-source-merge assertion (got ${buzzN})`)
    }
    // sponsored is render-sourced: fast mode prints the ⚠️ offline variant
    assert.ok(
      res.out.includes('sponsored (promoted) cltampa events'),
      'sponsored benchmark line missing (⚠️ render-offline variant expected in fast mode)'
    )
    const totalLine = res.out.split(/\r?\n/).find((l) => l.includes('TOTAL upcoming events:'))
    assert.ok(totalLine, 'TOTAL upcoming events line missing from finder output')
    const totalN = Number(totalLine.match(/TOTAL upcoming events:\s*(\d+)/)?.[1])
    if (online) {
      assert.ok(
        totalN >= 150,
        `fast-mode static sources produced only ${totalN} events (expect ~250; >= 150 floor) — sources or caches are failing`
      )
    } else {
      t.diagnostic(`OFFLINE — gating the source-count floor (got ${totalN}, expect ~250 online)`)
    }
    t.diagnostic(`fast-mode events: ${totalN}, buzz>=2: ${buzzN}`)

    // --- fast output exists and schema-validates: 20 random spot checks ---
    const fast = JSON.parse(readFileSync(FINDER_JSON, 'utf8'))
    assert.ok(Array.isArray(fast) && fast.length > 0, 'finder/output/events.json is not a non-empty array')
    const picked = []
    const count = Math.min(20, fast.length)
    // deterministic, evenly-spaced spot-check indices (was Math.random — flaky: a
    // green run could miss a malformed event a later run happens to catch)
    for (let n = 0; n < count; n++) picked.push(Math.floor(((n + 0.5) * fast.length) / count))
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

  // zero ended AS OF the dataset's generation time — the finder must never
  // OUTPUT an already-over event; events ending after the snapshot is the
  // stale-data banner's territory, not a data bug
  // this invariant needs a TRUSTWORTHY generation reference. When the events.md
  // stamp is missing/mismatched we fall back to file mtime, which a byte-identical
  // restore or a git checkout rewrites to ~now (the Windows wall-clock quirk),
  // making honest-at-write events read as already-ended. Hold the assertion when
  // the real stamp is available; gate it (diagnostic, not red) in the degraded state.
  const ended = fullEvents.filter((e) => !(endedAtMs(e) > genRefMs.ms))
  if (genRefMs.src.startsWith('events.md')) {
    assert.equal(
      ended.length,
      0,
      `events already ended at generation time (${new Date(genRefMs.ms).toISOString()}, via ${genRefMs.src}): ` +
        ended.slice(0, 5).map((e) => `"${e.title}" start=${e.start} end=${e.end}`).join('; ')
    )
  } else {
    t.diagnostic(`generation stamp unavailable (using ${genRefMs.src}) — gating the ended-at-generation invariant (${ended.length} would-be-flagged)`)
  }

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
  // the roster + the two specific merge guards below are the ACTIVE city's generation
  // anchors (Tampa's live in finder/cities/tampa-bay.mjs). A city with no roster skips
  // them — it brings its own once its sources land.
  if (CITY_ROSTER.length) {
    for (const slug of CITY_ROSTER) {
      assert.ok(keys.has('p|' + slug), `roster benchmark missing from generation: ${slug}`)
    }
    const fortDeSoto = places.filter((p) => p.key.startsWith('p|fort-de-soto') && p.classes.includes('park'))
    assert.equal(fortDeSoto.length, 1, `Fort De Soto must be exactly ONE park record (got: ${fortDeSoto.map((p) => p.key).join(', ') || 'none'})`)
    assert.ok(!keys.has('p|weedon-island-preserve-2'), 'Weedon Island split into two records — the o/e-typo merge regressed')
  }

  // the finder copy and the app copy must be the same artifact (no drift)
  const FINDER_PLACES = path.join(ROOT, 'finder', 'output', 'places.json')
  assert.ok(existsSync(FINDER_PLACES), 'finder/output/places.json missing while the app copy exists')
  assert.equal(readFileSync(FINDER_PLACES, 'utf8'), readFileSync(APP_PLACES, 'utf8'),
    'finder/output/places.json and app/public/places.json drifted — re-run node finder/places.mjs')
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
  const ATTRIB = path.join(ROOT, 'finder', 'cache', 'attributions.json')
  const attrib = existsSync(ATTRIB) ? JSON.parse(readFileSync(ATTRIB, 'utf8')) : { byFile: {} }
  for (const p of cafes) {
    const slug = p.image.replace(/^\/place-img\//, '').replace(/\.jpg$/, '')
    assert.match(slug, /^[a-z0-9-]+$/, `${p.name}: unsafe /place-img slug (${p.image})`)
    // (a) the self-hosted JPEG actually exists (enrich self-heals if it doesn't)
    assert.ok(existsSync(path.join(ROOT, 'app', 'public', 'place-img', `${slug}.jpg`)),
      `${p.name}: /place-img/${slug}.jpg referenced but the file is missing`)
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
  const MAP_CACHE = path.join(ROOT, 'finder', 'cache', 'place-mapillary-images.json')
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

// W4 wiring — the two heroes are real photos, the place detail renders its photo
// with a category-art fallback, dead URLs never paint a broken glyph, and
// normalizePlace carries `image` through (JSX/CSS can't import into Node).
test('W4 wiring: real heroes + place-detail photo + degrade-to-art + passthrough', async () => {
  // both city heroes are real https photos (Events skyline + Spots waterfront)
  const lib = readFileSync(path.join(ROOT, 'app', 'src', 'lib.js'), 'utf8')
  assert.match(lib, /hero:\s*'https:\/\/upload\.wikimedia\.org\//, 'CITY.hero must be a real Commons photo')
  assert.match(lib, /spotsHero:\s*'https:\/\/upload\.wikimedia\.org\//, 'CITY.spotsHero must be a real Commons photo (not a CSS placeholder)')
  // 3.7P-6: hero art is also an array (swipe-ready) — every entry a real Commons
  // photo WITH a recorded license (for the ⚑X3 attribution page).
  assert.match(lib, /heroes:\s*\[/, 'CITY.heroes[] must exist (3.7P-6 swipe-ready hero array)')
  assert.match(lib, /url:\s*'https:\/\/upload\.wikimedia\.org\//, 'CITY.heroes entries must carry a real Commons url')
  assert.match(lib, /license:\s*'(CC |Public domain)/, 'CITY.heroes entries must record a license for the attribution page')
  // Stage R: the Spots tab now uses a CLEAN light header + a search bar (the
  // cinematic image hero was removed to match the benchmark). The Spots hero
  // PHOTO data (CITY.spotsHero) stays in lib.js for the attribution page (asserted
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
  // resolves against the REAL events store by keyword — honest, real listings only
  const evDoc = JSON.parse(readFileSync(path.join(ROOT, 'app', 'public', 'events.json'), 'utf8'))
  const events = Array.isArray(evDoc) ? evDoc : evDoc.events || []
  const hits = resolveWatchGuide(wc, events)
  assert.ok(hits.length > 0, 'world-cup watch guide matched 0 live events — keyword resolver or the data regressed')
  assert.ok(
    hits.every((e) => {
      const hay = ((e.title || '') + ' ' + (e.description || '') + ' ' + (e.venue || '')).toLowerCase()
      return wc.keywords.some((k) => hay.includes(k.toLowerCase()))
    }),
    'a matched event contains none of the keywords (resolver is fabricating)'
  )
  // window gate
  assert.equal(watchGuideActive(wc, Date.parse('2026-06-20')), true, 'should be active mid-window')
  assert.equal(watchGuideActive(wc, Date.parse('2027-01-01')), false, 'should be inactive outside its window')
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

// ============================================================
// 5) PURE-LOGIC UNITS — app/src modules imported straight into Node
//    (lib/taste/weekend are deliberately JSX-free; localStorage access is
//    guarded, so importing them here is supported by design)
// ============================================================
const lib = await import('../app/src/lib.js')
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
  const timed = N(ev({ title: 'Vinyl Night', start: '2026-06-13T19:00:00', venue: 'The Attic' }), AN)
  const dated = N(ev({ title: 'Art Walk', start: '2026-06-14', venue: 'Riverwalk' }), AN)
  const one = share.eventIcs(timed)
  assert.ok(one.startsWith('BEGIN:VCALENDAR\r\n') && one.endsWith('END:VCALENDAR\r\n'), 'single ICS must be a full VCALENDAR')
  assert.equal((one.match(/BEGIN:VEVENT/g) || []).length, 1, 'eventIcs must contain exactly one VEVENT')
  assert.ok(one.includes('DTSTART:20260613T190000'), 'timed event must emit local floating DTSTART')
  assert.ok(one.includes('SUMMARY:Vinyl Night'), 'SUMMARY must carry the title')
  // multi: two slotted entries → two VEVENTs, one envelope
  const many = share.eventsIcs([timed, dated])
  assert.equal((many.match(/BEGIN:VCALENDAR/g) || []).length, 1, 'eventsIcs must wrap ONE VCALENDAR')
  assert.equal((many.match(/BEGIN:VEVENT/g) || []).length, 2, 'eventsIcs must emit one VEVENT per entry')
  assert.equal((many.match(/END:VEVENT/g) || []).length, 2, 'every VEVENT must be closed')
  assert.ok(many.includes('DTSTART;VALUE=DATE:20260614'), 'date-only entry must be all-day')
  // empty list is still a valid (empty) calendar — never throws
  const none = share.eventsIcs([])
  assert.equal((none.match(/BEGIN:VEVENT/g) || []).length, 0, 'empty plan ICS has no VEVENTs')
})

test('share.js: shareDayText composes ☀️/🌙 lines, null on nothing to share', () => {
  const dayTs = new Date(2026, 5, 13).getTime()
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
// and the motion set (add-morph, skeleton, blur-up, carousel stagger, tab settle,
// symmetric sheet close) — every motion reduced-motion-safe.
test('PREMIUM A4: elevation scale + motion (depth tokens, press, btn-primary, add-morph, skeleton, blur-up, reduced-motion)', () => {
  const idx = readFileSync(path.join(ROOT, 'app', 'src', 'index.css'), 'utf8')
  const cardsCss = readFileSync(path.join(ROOT, 'app', 'src', 'cards.css'), 'utf8')
  const appCss = readFileSync(path.join(ROOT, 'app', 'src', 'App.css'), 'utf8')
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
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

  // MOTION: the add-to-plan confirmation morph
  assert.ok(/function AddButton/.test(cards) && /is-added/.test(cards), 'the Add button morphs (AddButton + is-added)')
  assert.ok(/return true \/\/ PREMIUM A4|return true/.test(cards) && /addToPlan\(e\)\)/.test(cards), 'addToPlan reports success so the button can confirm')
  assert.ok(/@keyframes cardToastIn/.test(cardsCss), 'the card toast has a real entrance')
  assert.ok(/\.is-added\b[\s\S]*?animation:\s*slotPop/.test(cardsCss), 'a successful add plays the gold slotPop')
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
  assert.ok(/from '\.\/dayplan\.js'/.test(dp) && /withSlot/.test(dp) && /dayEntryFor/.test(dp), 'DetailPage imports the day-plan seams')
  assert.ok(/daypartOf/.test(dp), 'uses daypartOf for the natural slot suggestion')
  // Stage R: the primary is now an honest day-specific label (Add to tonight /
  // Add to Friday night) in a two-button action bar (Save + Add). canPlan gates it.
  assert.ok(/＋ \{addLabel\}/.test(dp) && /canPlan \?/.test(dp), 'the primary CTA is the planner Add when the event can be planned')
  assert.ok(/Add to tonight/.test(dp) && /Add to \$\{d0\.label\}/.test(dp), 'the Add label is day-specific + honest (event own day + natural daypart)')
  assert.ok(/detail-actionbar/.test(dp) && /detail-save-btn/.test(dp), 'the bottom bar pairs Save + the primary (two-button)')
  assert.ok(/if \(entry && entry\.slots\[part\]\) return/.test(dp), 'addToPlan never clobbers a filled slot')
  assert.ok(/canPlan \? \(/.test(dp) && /e\.url && \(/.test(dp), 'the official event / ticket link is the fallback primary for a non-plannable event')
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
  // V1 H1/H3: the fabricated-name greeting + heroKicker were retired; the header
  // is the shared .loc-head-title primitive + the weather sub.
  const home = readFileSync(path.join(ROOT, 'app', 'src', 'HomeView.jsx'), 'utf8')
  assert.ok(/<NextDays /.test(home), 'HomeView renders the "Your next days" planning stack')
  assert.ok(/loc-head-title">Home</.test(home) && !/heroKicker/.test(home), 'V1 H1/H3: Home uses the shared .loc-head-title primitive; the greeting + heroKicker are retired')
  assert.ok(/nowMs/.test(home) && /tonightModel\(/.test(home), 'V1 H3: nowMs is KEPT — it still feeds tonightModel (not just the retired greeting)')
  assert.ok(/wxLine/.test(home), 'the Home header shows the real weather line when loaded')
  const nd = readFileSync(path.join(ROOT, 'app', 'src', 'NextDays.jsx'), 'utf8')
  assert.ok(/loadDayPlans/.test(nd) && /dayEntryFor/.test(nd), 'NextDays reads the real day-plan store')
  assert.ok(/wxMood|CONDITION/.test(nd), 'NextDays derives its weather line from the real forecast only')
  assert.ok(/\?\? emptyDay\(\)/.test(nd), 'an unplanned day falls back to emptyDay (no null crash)')
  assert.ok(/openDay\(/.test(nd), 'a day card opens its DayPage (the Discover→Plan bridge)')
  assert.ok(/void page/.test(nd), 'plan-state re-reads on the subpage edge (stays fresh)')
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
  assert.ok(/\{onAdd && <button className="featc-act featc-add"/.test(cards), 'the inline Add only renders when onAdd is provided (places open the detail to pick a day)')
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
  assert.ok(/tab === 'all' \|\| tab === 'events' \? eventSection/.test(sp), 'the active tab scopes which groups render')
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
  assert.ok(/loadDayPlans\(/.test(pv) && /didDays\(/.test(pv) && /useSaves\(/.test(pv), 'the trio is computed from real stores (plans / days-out / saves)')
  const mp = readFileSync(path.join(ROOT, 'app', 'src', 'MyPlansPage.jsx'), 'utf8')
  assert.ok(/plansCount/.test(mp) && /PARTS\.some\(\(p\) => e\.slots\[p\]\)/.test(mp), 'My plans count = distinct filled days across all dayparts (PARTS-iterated; no hardcoded day/night)')
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
  assert.ok(/profile-name-v1/.test(pv) && /lsGet\(NAME_KEY\)/.test(pv), 'the display name is read on-device (profile-name-v1); the write moved to Edit Profile')
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
  assert.ok(/lsSet\(NAME_KEY/.test(ep) && /profile-name-v1/.test(ep), 'Edit Profile writes the on-device name (profile-name-v1)')
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
  assert.ok(/id: 'calendar', label: 'Calendar'/.test(nav), "the calendar tab label is 'Calendar' (S1-C1; id stays 'calendar')")
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

// Sprint S follow-up — a SLOTTED PLACE ('p|' key) must resolve in the U-d
// surfaces, not just on DayPage. CalendarView's morning-after card and
// ProfileView's past-days journal both build their key→title maps from `events`
// only; a place is NEVER in `events`, so each must fold the lazily-loaded
// places in (gated on a place key, the DayPage pattern) or a slotted place
// degrades to the generic "did you make it out?" / "no longer listed". These
// are grep wiring asserts (the views can't import into Node — they pull in JSX
// and CSS), same approach as the CalendarView wiring test above.
test('Sprint S: Calendar + Profile fold lazy places into their slot resolvers (gated)', () => {
  const calSrc = readFileSync(path.join(ROOT, 'app', 'src', 'CalendarView.jsx'), 'utf8')
  // S1-C2: the morning-after card is gone — the inline day panel is the remaining
  // place-slot resolver. The fetch is GATED on a place key in the SELECTED day
  // (never unconditional; an event-only/empty selection pays no ~1.2MB fetch).
  assert.ok(/isPlaceKey\(selEntry\.slots\[p\]\)/.test(calSrc), 'CalendarView gates the places fetch on a place key in the selected day')
  assert.ok(/usePlaces\(hasSelPlaceKey\)/.test(calSrc), 'CalendarView lazily loads places only when the selected day holds a place key')
  // …and folds them into the shared resolver so a slotted place NAMES itself
  assert.ok(/for \(const p of placeList\) m\.set\(p\.key, p\)/.test(calSrc), 'CalendarView must fold places into the byKey resolver')

  // Stage R: the days/journal (with its place-slot resolver) moved to the My plans
  // subpage; the gated lazy-places fold lives there now.
  const mpSrc = readFileSync(path.join(ROOT, 'app', 'src', 'MyPlansPage.jsx'), 'utf8')
  assert.ok(/isPlaceKey\(/.test(mpSrc), 'MyPlansPage must gate the places fetch on a place key in a plan/journal slot')
  assert.ok(/usePlaces\(hasPlaceKey\)/.test(mpSrc), 'MyPlansPage must lazily load places only when a slotted place is present')
  assert.ok(/for \(const p of placeList\) m\.set\(p\.key, p\.title\)/.test(mpSrc), 'MyPlansPage must fold place titles into titleByKey (no "no longer listed" for a live place)')
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
