// Build or refresh one city's immutable artifact envelope.
//
// Usage: CITY=tampa-bay node finder/build-manifest.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cityId, meta, tz } from './cities/index.mjs';
import { verifyArtifactSet, writeManifest } from './artifact-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(process.env.MANIFEST_ROOT || join(HERE, 'output'), cityId);
const assembledAt = process.env.MANIFEST_ASSEMBLED_AT || new Date().toISOString();

try {
  const manifest = writeManifest({ root, cityId, timeZone: tz, assembledAt });
  const checked = verifyArtifactSet({ root, expectedCityId: cityId, expectedTimeZone: tz });
  if (!checked.ok) throw new Error(checked.problems.join(' · '));
  console.log(`artifact-manifest: ${meta.name} ${manifest.buildId}`);
  console.log(`  events ${manifest.artifacts.events.count.toLocaleString('en-US')} · generated ${manifest.generatedAt}`);
  console.log(`  source health ${manifest.sourceHealth.status} · ${manifest.sourceHealth.total} source receipts`);
} catch (error) {
  console.error(`artifact-manifest: REFUSING '${cityId}' — ${error.message || error}`);
  process.exit(1);
}
