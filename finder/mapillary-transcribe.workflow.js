// finder/mapillary-transcribe.workflow.js — the name-blind storefront vision pass.
//
// This is a Workflow-tool SCRIPT (run via the Workflow tool with
// `{ scriptPath: 'finder/mapillary-transcribe.workflow.js', args: <N | [rids]> }`),
// NOT a Node module — it uses the agent()/parallel()/phase() globals, has no fs
// access, and its `args` is supplied at invocation. Committed so the manual vision
// gate is reproducible per city (see MULTICITY_IMAGERY_RUNBOOK.md).
//
// It is BOTH passes in one: the initial transcription AND the re-judge — the schema
// carries every field Stage B needs. Run it once per city against the anonymized
// review set (finder/cache/mapillary-crops/_review/rNNN/) that `mapillary-verify.mjs
// --anon` produced. NAME-BLIND by construction: agents see only opaque rNNN dirs, so
// they cannot prime an illegible sign into the expected cafe name.
//
// args: a count N (→ r001..rNNN) OR an explicit array of rids (e.g. ["r004","r006"]).
//   Pass it as an actual JSON value to the Workflow tool, not a stringified one.

export const meta = {
  name: 'mapillary-transcribe',
  description: 'Name-blind storefront-sign transcription + pylon/dominant/quality flags over Mapillary cafe crops',
  phases: [{ title: 'Transcribe', detail: 'one agent per cafe; globs its anon crop dir, reads each, transcribes' }],
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    crops: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          i: { type: 'integer', description: 'the number N in its cN.jpg filename' },
          signsRead: { type: 'array', items: { type: 'string' }, description: 'verbatim text of each distinct storefront business sign legible in the image; [] if none' },
          confidence: { type: 'number', description: '0..1 legibility/certainty of the storefront signage' },
          isCafeStorefront: { type: 'boolean', description: 'true ONLY if this image clearly shows a coffee shop / cafe / espresso bar / roastery storefront' },
          otherBusinessNameOnSign: { type: ['string', 'null'], description: 'name of any SPECIFIC legible business on a permanent sign EXCEPT generic descriptors (COFFEE, CAFE, ESPRESSO, OPEN, BAKERY); null if none' },
          isDirectoryOrPylon: { type: 'boolean', description: 'true if the dominant sign is a MULTI-TENANT DIRECTORY / monument / roadside PYLON that LISTS several businesses, not a storefront facade' },
          cafeIsDominantSubject: { type: 'boolean', description: 'false ONLY if a DIFFERENT non-cafe business clearly dominates the foreground while any cafe is a small/distant/background sign; true if the most prominent OR only business shown is a cafe (even if small/distant)' },
          imageQuality: { type: 'number', description: '0..1 quality as a hero photo: brightness, storefront large+centered+unoccluded, sharpness' },
          sceneNote: { type: 'string', description: '3-8 words: what the photo shows' },
        },
        required: ['i', 'signsRead', 'confidence', 'isCafeStorefront', 'otherBusinessNameOnSign', 'isDirectoryOrPylon', 'cafeIsDominantSubject', 'imageQuality', 'sceneNote'],
      },
    },
  },
  required: ['crops'],
}

const PROMPT = (rid) => `You are transcribing + classifying street-level storefront photos for an automated index. NAME-BLIND: you are NOT told which business this is about.

STEP 1: Glob "finder/cache/mapillary-crops/_review/${rid}/c*.jpg" to list the 1-6 images.
STEP 2: Read each image.
STEP 3: Report one crops[] entry per image (i = the N in cN.jpg).

Per image:
- signsRead: transcribe verbatim (letter-for-letter; keep partial/occluded words, mark unsure chars with ?) the text on any PERMANENT business storefront sign — fascia/awning/blade/window/wall. List each business separately. EXCLUDE traffic/street signs, bare address numbers, A-frame/menu boards, banners/posters, plates, vehicles. NEVER guess or auto-complete a name from a few letters.
- confidence: 0..1 legibility of the storefront signage.
- isCafeStorefront: true ONLY if the image clearly shows a coffee shop / cafe / espresso bar / roastery storefront.
- otherBusinessNameOnSign: the name of any SPECIFIC legible business on a sign EXCEPT generic descriptors (COFFEE, CAFE, ESPRESSO, OPEN, BAKERY); null if none.
- isDirectoryOrPylon: true if the dominant sign is a MULTI-TENANT DIRECTORY / monument / roadside PYLON that LISTS several businesses (a tenant board), rather than a storefront facade. false for a normal single-business storefront or single-business monument sign.
- cafeIsDominantSubject: answer false ONLY when a DIFFERENT, non-cafe business clearly DOMINATES the foreground/hero while any cafe is merely a small/distant/background sign. Answer true when the most prominent — OR the only — business shown is a cafe, EVEN IF it is small, distant, dim, or poorly framed. (Conflict test, NOT a quality test.)
- imageQuality: 0..1 hero quality (brightness, storefront large+centered+unoccluded, in focus).
- sceneNote: 3-8 words on what the photo shows.`

phase('Transcribe')
const a = Array.isArray(args) ? args : (typeof args === 'string' ? JSON.parse(args) : args)
const rids = Array.isArray(a)
  ? a
  : Array.from({ length: Number(a) }, (_, k) => 'r' + String(k + 1).padStart(3, '0'))
const results = await parallel(rids.map((rid) => () =>
  agent(PROMPT(rid), { label: `transcribe:${rid}`, phase: 'Transcribe', schema: SCHEMA })
    .then((r) => ({ rid, crops: (r && r.crops) || [] }))
    .catch(() => ({ rid, crops: [], error: true }))
))
return results
