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

// Phase 3.5 W4 — HONEST IMAGES. A place photo is ONLY ever a verified photo OF
// THAT place (Wikidata P18 → Wikimedia Commons), never a representative
// stand-in; places without a curated photo keep category-art. These invariants
// lock that contract on the real artifact.
test('W4 images: place photos are real, Wikidata-sourced, never fabricated', () => {
  const doc = JSON.parse(readFileSync(APP_PLACES, 'utf8'))
  const places = doc.places
  const imaged = places.filter((p) => p.image)
  // a meaningful number resolved (the ~24 wikidata places with a P18), but never
  // more than the wikidata-bearing set — the floor guards a silent regression
  assert.ok(imaged.length >= 20, `only ${imaged.length} places imaged — the Wikidata image step likely regressed`)
  const withQid = places.filter((p) => p.wikidata).length
  assert.ok(imaged.length <= withQid, `${imaged.length} images but only ${withQid} wikidata places — an image leaked onto a place with no Q-id`)
  for (const p of imaged) {
    // every image MUST come from Wikimedia Commons (the only honest "of this place" source)
    assert.match(p.image, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//, `${p.name}: image is not a Wikimedia Commons URL (${p.image})`)
    // NEVER a stand-in: an image is only allowed on a place that carries the Q-id it was resolved from
    assert.ok(typeof p.wikidata === 'string' && p.wikidata, `${p.name}: has an image but NO wikidata id — that's a representative stand-in, banned`)
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
  // LocationsView renders the real Spots hero image, not just the teal wash
  const loc = readFileSync(path.join(ROOT, 'app', 'src', 'LocationsView.jsx'), 'utf8')
  assert.match(loc, /loc-hero-img/, 'LocationsView must render a real .loc-hero-img element')
  assert.match(loc, /CITY\.spotsHero/, 'the Spots hero must use CITY.spotsHero')
  // PlaceDetail shows the photo as a hero, gated on heroArt (real photo vs art)
  const pd = readFileSync(path.join(ROOT, 'app', 'src', 'PlaceDetail.jsx'), 'utf8')
  assert.match(pd, /detail-hero-img/, 'PlaceDetail must use the image hero treatment (detail-hero-img)')
  assert.match(pd, /heroArt/, 'PlaceDetail must gate the hero on heroArt (real photo vs category-art fallback)')
  // W4 trust contract: a dead image URL degrades to category-art / placeholder,
  // never the browser broken-image glyph — CardImg + the deck place face wire onError
  const cards = readFileSync(path.join(ROOT, 'app', 'src', 'cards.jsx'), 'utf8')
  assert.match(cards, /onError/, 'CardImg must handle onError so a dead image degrades to category-art, not a broken glyph')
  const dfk = readFileSync(path.join(ROOT, 'app', 'src', 'DayFillDeck.jsx'), 'utf8')
  assert.match(dfk, /onError/, 'the day-fill place face must handle onError (no broken-image glyph)')
  // normalizePlace must carry image through (it spreads ...raw — this is a guard).
  // Local import so this test also runs in isolation (--test-name-pattern).
  const placesLocal = await import('../app/src/places.js')
  const place = placesLocal.normalizePlace({ key: 'p|x', name: 'X', lat: 28, lng: -82, image: 'https://upload.wikimedia.org/wikipedia/commons/x.jpg' })
  assert.equal(place.image, 'https://upload.wikimedia.org/wikipedia/commons/x.jpg', 'normalizePlace must pass the image field through to the card/detail seams')
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
const dayfill = await import('../app/src/dayfill.js')
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

test('daypartOf: boundary hours', () => {
  const at = (hhmm) => weekend.daypartOf({ start: `2026-06-12T${hhmm}:00` })
  assert.equal(weekend.daypartOf({ start: '2026-06-12' }), 'any', 'date-only events are "any" (both pickers)')
  assert.equal(at('04:59'), 'night', '04:59 is the tail of a night out')
  assert.equal(at('05:00'), 'day', '05:00 opens the day window')
  assert.equal(at('16:59'), 'day', '16:59 is still day')
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
  const txt = share.shareDayText(dayTs, [{ part: 'day', e: day }, { part: 'night', e: night }])
  const lines = txt.split('\n')
  assert.ok(lines[0].startsWith('My plan for'), 'first line is the day header')
  assert.ok(lines.some((l) => l.startsWith('☀️ ') && l.includes('Beach')), 'day slot rendered with sun')
  assert.ok(lines.some((l) => l.startsWith('🌙 ') && l.includes('Show')), 'night slot rendered with moon')
  // nothing to share → null (empty/rest day gets no share affordance at all)
  assert.equal(share.shareDayText(dayTs, []), null, 'empty day shares nothing')
  assert.equal(share.shareDayText(dayTs, [{ part: 'day', e: null }]), null, 'unresolved slots drop to nothing')
})

// Sprint U-c: weekend.js's live plan store is retired — loadPlan/savePlan gone,
// but the migration's support cast (PLAN_KEY/planFor/loadHistory) stays.
test('U-c retirement: weekend.loadPlan/savePlan removed, support cast intact', () => {
  assert.equal(weekend.loadPlan, undefined, 'weekend.loadPlan must be retired (day-plans-v1 is the store)')
  assert.equal(weekend.savePlan, undefined, 'weekend.savePlan must be retired')
  assert.equal(typeof weekend.planFor, 'function', 'planFor stays — the migration archive validator')
  assert.equal(typeof weekend.loadHistory, 'function', 'loadHistory stays — Profile past-weekend cards')
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
  // both ProfileView AND HotView must call the ONE resolver (no duplicated patch)
  const profSrc = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  const hotSrc = readFileSync(path.join(ROOT, 'app', 'src', 'HotView.jsx'), 'utf8')
  assert.ok(/whenPreference\(/.test(profSrc), 'ProfileView must use the whenPreference resolver')
  assert.ok(/whenPreference\(/.test(hotSrc), 'HotView must use the whenPreference resolver')
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
test('O1 lazy mounting: non-Events tabs gate on visited, boot seeds one tab', () => {
  const appSrc = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  for (const id of ['locations', 'map', 'calendar', 'profile']) {
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

test('places.js: the eight bubbles partition sensibly + classics filter', () => {
  const ids = placesMod.PLACE_BUBBLES.map((b) => b.id)
  assert.equal(ids.length, 8, 'exactly the eight Locations bubbles')
  const mk = (over) => placesMod.normalizePlace({ key: 'p|t', name: 'T', lat: 28, lng: -82, placeType: 'park', classes: [], amenities: [], srcCount: 1, ...over })
  const find = (id) => placesMod.PLACE_BUBBLES.find((b) => b.id === id)
  assert.ok(find('beaches').match(mk({ placeType: 'beach' })), 'a beach matches Beaches')
  assert.ok(find('dog').match(mk({ classes: ['dog_park'] })), 'a dog_park matches Dog-friendly')
  assert.ok(find('free').match(mk({ isFree: true })), 'a free place matches Free')
  assert.ok(find('hidden').match(mk({ hidden: true })), 'a hidden place matches Hidden')
  assert.ok(!find('hidden').match(mk({ hidden: false })), 'a non-hidden place does NOT match Hidden')
  assert.ok(find('courts').match(mk({ amenities: ['pickleball'] })), 'a pickleball court matches Courts & rec')
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

test('dayfill.js: dealDayFill = fits-day events + places tail, count-preserving, deduped', () => {
  const ts = new Date(2026, 5, 13).getTime() // Sat Jun 13
  const events = [
    N(ev({ title: 'Sat show', start: '2026-06-13T20:00:00', category: 'music', hotScore: 80 }), AN),
    N(ev({ title: 'Exhibit', start: '2026-06-10', end: '2026-06-30', category: 'art', hotScore: 60 }), AN), // span covers Sat
    N(ev({ title: 'Mon thing', start: '2026-06-15', category: 'food', hotScore: 90 }), AN), // does NOT cover Sat
    N(ev({ title: 'Ended', start: '2026-06-01', category: 'music', hotScore: 99 }), AN), // already over
  ]
  const places = [pl({ slug: 'beach', name: 'Beach', srcCount: 3 }), pl({ slug: 'park', name: 'Park', srcCount: 1 })]
  const deck = dayfill.dealDayFill(events, places, ts, AN, null)
  const titles = deck.map((c) => c.title)
  // only the two fits-Saturday events make it, then the two places tail
  assert.ok(titles.includes('Sat show') && titles.includes('Exhibit'), 'fits-day events are in the deck')
  assert.ok(!titles.includes('Mon thing'), 'an event whose span misses the day is excluded')
  assert.ok(!titles.includes('Ended'), 'an already-ended run is excluded')
  // events come BEFORE places (a dated thing for the day outranks an evergreen):
  // once a place appears, every later card is a place too (a clean tail).
  const firstPlaceIdx = deck.findIndex((c) => c.kind === 'place')
  if (firstPlaceIdx !== -1) {
    assert.ok(
      deck.slice(firstPlaceIdx).every((c) => c.kind === 'place'),
      'events lead and places form an unbroken tail'
    )
    assert.ok(
      deck.slice(0, firstPlaceIdx).every((c) => c.kind !== 'place'),
      'no place appears before the tail'
    )
  }
  // the places tail is corroboration-ordered (srcCount 3 > 1)
  const placeCards = deck.filter((c) => c.kind === 'place')
  assert.equal(placeCards.length, 2, 'both places ride the tail')
  assert.equal(placeCards[0].key, 'p|beach', 'places tail is srcCount-desc')
  // events-only path (no places) works and is finite
  const evOnly = dayfill.dealDayFill(events, null, ts, AN, null)
  assert.equal(evOnly.length, 2, 'events-only deck = the 2 fits-day events')
  // dedup: a duplicate event key never doubles
  const dup = dayfill.dealDayFill(events.concat(events[0]), [], ts, AN, null)
  assert.equal(new Set(dup.map(lib.keyOf)).size, dup.length, 'dealDayFill output is key-unique')
  // the lens id keys on the day ts (session fatigue guard + back nav)
  assert.equal(dayfill.dayFillIdOf({ dayTs: ts }), 'fill|' + ts, 'dayFillIdOf keys on the day ts')
})

// Sprint T review must-fix: the day-fill deck is a CURATED SHORTLIST, not the
// whole catalog. dealDayFill caps at DECK_TARGET, places only fill the room
// events leave (a rich day gets no place tail), and the cap holds against a
// huge place list (the prod bug: the entire ~1,830-place DB bolted onto every
// deck). The old test used 2 places and never exercised this.
test('dayfill.js: deck is capped at DECK_TARGET, places only round out a thin day', () => {
  const ts = new Date(2026, 5, 13).getTime() // Sat Jun 13
  const TARGET = dayfill.DECK_TARGET
  assert.ok(typeof TARGET === 'number' && TARGET >= 8 && TARGET <= 30, 'DECK_TARGET is a sane shortlist size')
  // 30 always-there places, ZERO events for the day → deck = exactly TARGET places (the catalog never floods in)
  const manyPlaces = Array.from({ length: 30 }, (_, i) => pl({ slug: 'p' + i, name: 'Place ' + String(i).padStart(2, '0'), srcCount: (i % 3) + 1 }))
  const thinDeck = dayfill.dealDayFill([], manyPlaces, ts, AN, null)
  assert.equal(thinDeck.length, TARGET, `a zero-event day caps the place tail at DECK_TARGET (${TARGET}), got ${thinDeck.length}`)
  assert.ok(thinDeck.every((c) => c.kind === 'place'), 'a zero-event day deck is all places')
  // a RICH event day (>= TARGET fits-day events) gets NO place tail
  const manyEvents = Array.from({ length: TARGET + 5 }, (_, i) =>
    N(ev({ title: 'Ev ' + i, url: 'u' + i, start: '2026-06-13T19:00:00', category: 'music', hotScore: 50 + i }), AN)
  )
  const richDeck = dayfill.dealDayFill(manyEvents, manyPlaces, ts, AN, null)
  assert.equal(richDeck.length, TARGET, `a rich day is capped at DECK_TARGET, got ${richDeck.length}`)
  assert.ok(richDeck.every((c) => c.kind !== 'place'), 'a rich event day gets NO place tail — the catalog never bolts on')
})

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
    { dayTs: dts(2026, 5, 13), state: 'rest', slots: { day: null, night: null } }, // a past REST day
    { dayTs: dts(2026, 5, 14), state: null, slots: { day: 'k1', night: null } }, // a past PLANNED day
    { dayTs: dts(2026, 5, 15), state: null, slots: { day: null, night: null } }, // empty (no plan)
  ]
  const cands = dayplan.morningAfterCandidates(history, converted, UD_AN)
  const candDays = cands.map((c) => c.dayTs)
  assert.ok(!candDays.includes(dts(2026, 5, 13)), 'a past REST day is a RECORD, never asked "did you make it" (ban §7 #10)')
  assert.ok(candDays.includes(dts(2026, 5, 14)), 'a past planned day with a filled slot IS a candidate')
  assert.ok(!candDays.includes(dts(2026, 5, 15)), 'an empty past day has no plan to convert')
  // ONE quiet card at a time: most-recent-first ordering (the caller takes [0])
  const two = dayplan.morningAfterCandidates(
    [
      { dayTs: dts(2026, 5, 10), state: null, slots: { day: 'a', night: null } },
      { dayTs: dts(2026, 5, 16), state: null, slots: { day: 'b', night: null } },
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
    [{ dayTs: dts(2026, 5, 25), state: null, slots: { day: 'x', night: null } }],
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

// Sprint U-d — the "went" side rides the EXISTING markBeen seam so the +2 taste
// stays unfarmable, and slotting earns NO taste signal in v1 (the nudge ceiling
// 18 is the wall — asserted above). saves.js can't import into Node (CSS), so
// grep the wiring CalendarView leans on, like the places round-trip test.
test('U-d: the conversion "went" rides markBeen + lights violet once (CalendarView wiring)', () => {
  const calSrc = readFileSync(path.join(ROOT, 'app', 'src', 'CalendarView.jsx'), 'utf8')
  assert.ok(/markBeen\(key, snap, 'went'\)/.test(calSrc), 'the card\'s "I went" must ride the idempotent markBeen seam (+2 unfarmable)')
  assert.ok(/markDayConverted\(card\.dayTs, status\)/.test(calSrc), 'the answer must persist through the one-shot conversion ledger')
  assert.ok(/morningAfterCandidates\(/.test(calSrc), 'the card must derive from morningAfterCandidates (past planned, rest excluded)')
  // the violet beat is gated on the one-shot's return — never an unconditional pop
  assert.ok(/if \(lit\)/.test(calSrc), 'the violet beat fires ONLY when markDayConverted returns violet (one-shot per day)')
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
  // the fetch is GATED on a place key actually being in the card's slots — an
  // event-only/empty card must never pay the ~1.2MB places fetch
  assert.ok(/isPlaceKey\(card\.slots\[p\]\)/.test(calSrc), 'CalendarView must gate the places fetch on a place key in the card slots')
  assert.ok(/usePlaces\(hasPlaceKey\)/.test(calSrc), 'CalendarView must lazily load places only when the card holds a place key')
  // …and fold them into the card resolver so a slotted place NAMES itself
  assert.ok(/for \(const p of placeList\) m\.set\(p\.key, p\)/.test(calSrc), 'CalendarView must fold places into cardByKey')
  // the "went" snapshot for a place must carry its real title/category AND stamp
  // the planned day as start — else the did-day (didDays keys on snapshot.start)
  // would stop deriving (places have no date of their own): a silent regression
  assert.ok(/live\.kind === 'place'/.test(calSrc), 'CalendarView must special-case a slotted place in the "went" snapshot')
  assert.ok(/\.\.\.snapshotFor\(live\), start: cardDateISO/.test(calSrc), 'a slotted-place "went" must stamp the planned day as snapshot.start so the did-day still derives')

  const pfSrc = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  assert.ok(/isPlaceKey\(/.test(pfSrc), 'ProfileView must gate the places fetch on a place key in a plan/journal/weekend slot')
  assert.ok(/usePlaces\(hasPlaceKey\)/.test(pfSrc), 'ProfileView must lazily load places only when a slotted place is present')
  assert.ok(/for \(const p of placeList\) m\.set\(p\.key, p\.title\)/.test(pfSrc), 'ProfileView must fold place titles into titleByKey (no "no longer listed" for a live place)')
})

// Sprint U-d — index.css ledger comment amended to record violet moment #7.
test('U-d/3.5: index.css reward ledger names the did-day conversion + count is current', () => {
  const idx = readFileSync(path.join(ROOT, 'app', 'src', 'index.css'), 'utf8')
  // Phase 3.5 retired the FMN reveal beat with the dice → ledger dropped 7→6.
  assert.ok(/SIX micro-reward moments/.test(idx), 'the --reward ledger comment must say SIX moments (FMN beat retired in 3.5)')
  assert.ok(!/FMN reveal beat \(fmn\.css\)/.test(idx), 'the retired FMN reveal beat must no longer be a live ledger entry')
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
  // tapping a day still opens the day screen (the bridge to fill it)
  assert.ok(/openDay\(ts\)/.test(calSrc), 'tapping a day must still open the day screen (the supply bridge)')
  // W6 (⚑U-WKND): the Weekend pill is RETIRED — planning is per-day now, so the
  // redundant calendar→WeekendBuilder entry is gone (WB stays reachable from Profile)
  assert.ok(!/cal-wkb/.test(calSrc), 'the Weekend pill (.cal-wkb) must be removed from the Calendar tab (W6)')
  assert.ok(!/openWeekend/.test(calSrc), 'the Calendar tab must not wire openWeekend anymore (W6 retired the pill)')
  // the gentle ledger is surfaced LIGHT here (days-out line), zero is silence
  assert.ok(/daysOutInMonth\(/.test(calSrc), 'the light gentle-ledger line derives from daysOutInMonth')
  assert.ok(/daysOut > 0/.test(calSrc), 'the days-out line is SILENT at zero (ban §7 #8 — never "0 📉")')
})

// Phase 3.5 W6 — CONNECTIVITY. The buried taste surfaces (TastePanel transparency
// + the calibration deck, both 4 taps deep in Settings) get a first-class Profile
// entry, and the deck's close affordance honors a 'profile' origin so it returns
// to Profile (not Settings).
test('W6 connectivity: Profile surfaces the taste hub (TastePanel + calibration deck)', () => {
  const pfSrc = readFileSync(path.join(ROOT, 'app', 'src', 'ProfileView.jsx'), 'utf8')
  assert.ok(/openTaste/.test(pfSrc), 'ProfileView must surface TastePanel (openTaste) — it was buried in Settings')
  assert.ok(/openDeck\('profile'\)/.test(pfSrc), "ProfileView must surface the calibration deck via openDeck('profile')")
  assert.ok(/pf-taste/.test(pfSrc), 'ProfileView must render the Your-taste hub (.pf-taste)')
  // openDeck must accept a 'profile' origin distinct from 'settings'/'primer'
  const navSrc = readFileSync(path.join(ROOT, 'app', 'src', 'nav.jsx'), 'utf8')
  assert.ok(/origin === 'profile'/.test(navSrc), "openDeck must accept a 'profile' origin (close to Profile, not Settings)")
  // the deck closes to Settings ONLY for the settings origin; profile/primer close to the tab
  const appSrc = readFileSync(path.join(ROOT, 'app', 'src', 'App.jsx'), 'utf8')
  assert.ok(/page\.from === 'settings' \? openSettings : closePage/.test(appSrc), "the deck's onClose returns to Settings only for the settings origin")
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
  // 2) collapse materially de-spams (recurring library programs are ~half the
  //    feed): far fewer CARDS than raw events
  assert.ok(feed.fullCount < upcoming.length * 0.75, `collapse must cut the feed meaningfully (cards ${feed.fullCount} vs events ${upcoming.length})`)
  // 3) the front page is SHORTER than the full collapsed feed (curation happened)
  //    but not gutted (a real magazine still has plenty)
  assert.ok(feed.curatedCount < feed.fullCount, `front page (${feed.curatedCount}) must be shorter than full (${feed.fullCount})`)
  assert.ok(feed.curatedCount >= 100, `front page (${feed.curatedCount}) must not be gutted — a magazine still has plenty`)
  // 4) curated ⊆ full on real data
  const fullIds = new Set()
  for (const s of feed.full) for (const g of s.items) fullIds.add(lib.keyOf(g) + '|' + g._clamp)
  for (const s of feed.curated) for (const g of s.items)
    assert.ok(fullIds.has(lib.keyOf(g) + '|' + g._clamp), 'every curated group exists in full (curated ⊆ full)')
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
