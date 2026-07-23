const GEM_LABELS = new Set(['yes', 'no', 'insufficient']);
const CASE_TYPES = new Set(['surface-order', 'defect-projection']);

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function validateCandidate(candidate, index) {
  invariant(candidate && typeof candidate === 'object' && !Array.isArray(candidate), `candidates[${index}] must be an object`);
  invariant(typeof candidate.id === 'string' && candidate.id.length > 0, `candidates[${index}].id must be a non-empty string`);

  const { labels, facets = {}, groups = {} } = candidate;
  invariant(labels && typeof labels === 'object' && !Array.isArray(labels), `${candidate.id}.labels must be an object`);
  invariant(Number.isInteger(labels.relevance) && labels.relevance >= 0 && labels.relevance <= 3, `${candidate.id}.labels.relevance must be an integer from 0 to 3`);
  invariant(typeof labels.actionable === 'boolean', `${candidate.id}.labels.actionable must be boolean`);
  invariant(typeof labels.knownBad === 'boolean', `${candidate.id}.labels.knownBad must be boolean`);
  invariant(GEM_LABELS.has(labels.gem), `${candidate.id}.labels.gem must be yes, no, or insufficient`);

  invariant(facets && typeof facets === 'object' && !Array.isArray(facets), `${candidate.id}.facets must be an object`);
  for (const key of ['sourceFamily', 'category', 'venueOrOperator']) {
    invariant(facets[key] == null || (typeof facets[key] === 'string' && facets[key].length > 0), `${candidate.id}.facets.${key} must be null or a non-empty string`);
  }

  invariant(groups && typeof groups === 'object' && !Array.isArray(groups), `${candidate.id}.groups must be an object`);
  for (const key of ['canonicalId', 'seriesId']) {
    invariant(groups[key] == null || (typeof groups[key] === 'string' && groups[key].length > 0), `${candidate.id}.groups.${key} must be null or a non-empty string`);
  }
}

function reachability(candidateIds, rankedIds) {
  const candidates = new Set(candidateIds);
  const counts = new Map();
  const extra = [];

  for (const id of rankedIds) {
    counts.set(id, (counts.get(id) || 0) + 1);
    if (!candidates.has(id) && !extra.includes(id)) extra.push(id);
  }

  const missing = candidateIds.filter(id => !counts.has(id));
  const duplicated = [];
  for (const id of rankedIds) {
    const count = counts.get(id);
    if (count > 1 && !duplicated.some(entry => entry.id === id)) duplicated.push({ id, count });
  }

  return {
    inputCount: candidateIds.length,
    outputCount: rankedIds.length,
    missing,
    extra,
    duplicated,
    exactPermutation:
      candidateIds.length === rankedIds.length &&
      missing.length === 0 &&
      extra.length === 0 &&
      duplicated.length === 0,
  };
}

function dcg(relevances) {
  return relevances.reduce((total, relevance, index) => (
    total + ((2 ** relevance) - 1) / Math.log2(index + 2)
  ), 0);
}

function facetDiversity(prefixItems, field) {
  const counts = new Map();
  for (const item of prefixItems) {
    const value = item.facets?.[field] || 'unknown';
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  const orderedCounts = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const maxCount = counts.size === 0 ? 0 : Math.max(...counts.values());
  const dominant = [...counts.entries()]
    .filter(([, count]) => count === maxCount)
    .map(([value]) => value)
    .sort((a, b) => a.localeCompare(b));

  return {
    distinct: counts.size,
    counts: orderedCounts,
    maxCount,
    maxShare: ratio(maxCount, prefixItems.length),
    dominant,
  };
}

function duplication(prefixItems, field) {
  const members = new Map();
  let unknownRows = 0;
  for (const item of prefixItems) {
    const groupId = item.groups?.[field];
    if (!groupId) {
      unknownRows += 1;
      continue;
    }
    if (!members.has(groupId)) members.set(groupId, []);
    members.get(groupId).push(item.id);
  }

  const duplicateGroups = [...members.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([id, memberIds]) => ({ id, memberIds }));
  const duplicateRows = duplicateGroups.reduce((total, group) => total + group.memberIds.length - 1, 0);

  return {
    duplicateRows,
    exposureRateLowerBound: ratio(duplicateRows, prefixItems.length),
    labeledRows: prefixItems.length - unknownRows,
    unknownRows,
    labelCoverage: ratio(prefixItems.length - unknownRows, prefixItems.length),
    duplicateGroups,
  };
}

function gemMetrics(gemClaimIds, byId) {
  if (gemClaimIds.length === 0) return null;

  const counts = { yes: 0, no: 0, insufficient: 0 };
  for (const id of gemClaimIds) counts[byId.get(id).labels.gem] += 1;

  return {
    claimed: gemClaimIds.length,
    counts,
    precision: counts.yes / gemClaimIds.length,
    noRate: counts.no / gemClaimIds.length,
    insufficientRate: counts.insufficient / gemClaimIds.length,
  };
}

/**
 * Evaluate one frozen, context-labeled ranking without reproducing ranking policy.
 * Quality metrics are withheld unless rankedIds is an exact candidate permutation.
 */
export function evaluateRanking({ candidates, rankedIds, prefix, gemClaimIds = [] }) {
  invariant(Array.isArray(candidates) && candidates.length > 0, 'candidates must be a non-empty array');
  invariant(Array.isArray(rankedIds), 'rankedIds must be an array');
  invariant(Array.isArray(gemClaimIds), 'gemClaimIds must be an array');
  invariant(Number.isInteger(prefix) && prefix > 0 && prefix <= candidates.length, 'prefix must be an integer within the candidate set');

  const candidateIds = [];
  const byId = new Map();
  candidates.forEach((candidate, index) => {
    validateCandidate(candidate, index);
    invariant(!byId.has(candidate.id), `duplicate candidate id: ${candidate.id}`);
    candidateIds.push(candidate.id);
    byId.set(candidate.id, candidate);
  });

  for (const [index, id] of rankedIds.entries()) invariant(typeof id === 'string' && id.length > 0, `rankedIds[${index}] must be a non-empty string`);

  const seenClaims = new Set();
  for (const id of gemClaimIds) {
    invariant(typeof id === 'string' && byId.has(id), `unknown gem claim id: ${id}`);
    invariant(!seenClaims.has(id), `duplicate gem claim id: ${id}`);
    seenClaims.add(id);
  }

  const outputReachability = reachability(candidateIds, rankedIds);
  if (!outputReachability.exactPermutation) {
    return { prefix, reachability: outputReachability, metrics: null };
  }

  const prefixItems = rankedIds.slice(0, prefix).map(id => byId.get(id));
  const prefixIds = new Set(prefixItems.map(item => item.id));
  for (const id of gemClaimIds) invariant(prefixIds.has(id), `gem claim outside evaluated prefix: ${id}`);
  const observedRelevance = prefixItems.map(item => item.labels.relevance);
  const idealRelevance = candidates
    .map(item => item.labels.relevance)
    .sort((a, b) => b - a)
    .slice(0, prefix);
  const idealDcg = dcg(idealRelevance);
  const relevantCount = prefixItems.filter(item => item.labels.relevance >= 2).length;
  const knownBadCount = prefixItems.filter(item => item.labels.knownBad).length;
  const nonActionableCount = prefixItems.filter(item => item.labels.actionable !== true).length;

  return {
    prefix,
    reachability: outputReachability,
    metrics: {
      ndcg: idealDcg === 0 ? null : dcg(observedRelevance) / idealDcg,
      precision: relevantCount / prefix,
      knownBadRate: knownBadCount / prefix,
      actionabilityLeakage: nonActionableCount / prefix,
      diversity: {
        source: facetDiversity(prefixItems, 'sourceFamily'),
        category: facetDiversity(prefixItems, 'category'),
        venueOrOperator: facetDiversity(prefixItems, 'venueOrOperator'),
      },
      duplication: {
        canonical: duplication(prefixItems, 'canonicalId'),
        series: duplication(prefixItems, 'seriesId'),
      },
      gems: gemMetrics(gemClaimIds, byId),
    },
  };
}

/** Validate the versioned wrapper around one or more frozen ranking cases. */
export function validateRelevanceFixture(fixture) {
  invariant(fixture && typeof fixture === 'object' && !Array.isArray(fixture), 'fixture must be an object');
  invariant(fixture.schemaVersion === 1, 'fixture.schemaVersion must be 1');
  invariant(typeof fixture.fixtureId === 'string' && fixture.fixtureId.length > 0, 'fixture.fixtureId is required');
  invariant(fixture.judgmentStatus === 'draft-owner-review', 'fixture judgments must remain draft-owner-review in Sprint 1');
  invariant(Array.isArray(fixture.limitations) && fixture.limitations.length > 0, 'fixture limitations are required');

  const { origin } = fixture;
  invariant(origin && typeof origin === 'object' && !Array.isArray(origin), 'fixture.origin is required');
  for (const key of ['cityId', 'timeZone', 'manifestId', 'buildId', 'eventsSha256', 'placesSha256', 'eventsGeneratedAt', 'placesGeneratedAt']) {
    invariant(typeof origin[key] === 'string' && origin[key].length > 0, `fixture.origin.${key} is required`);
  }

  invariant(Array.isArray(fixture.cases) && fixture.cases.length > 0, 'fixture.cases must be non-empty');
  const caseIds = new Set();
  for (const [index, entry] of fixture.cases.entries()) {
    invariant(entry && typeof entry === 'object' && !Array.isArray(entry), `cases[${index}] must be an object`);
    invariant(typeof entry.caseId === 'string' && entry.caseId.length > 0, `cases[${index}].caseId is required`);
    invariant(!caseIds.has(entry.caseId), `duplicate fixture case id: ${entry.caseId}`);
    caseIds.add(entry.caseId);

    const { context, baseline } = entry;
    invariant(context && typeof context === 'object', `${entry.caseId}.context is required`);
    invariant(CASE_TYPES.has(context.caseType), `${entry.caseId}.context.caseType must be surface-order or defect-projection`);
    for (const key of ['surface', 'kind', 'asOf', 'intent']) invariant(typeof context[key] === 'string' && context[key].length > 0, `${entry.caseId}.context.${key} is required`);
    invariant(baseline && typeof baseline === 'object', `${entry.caseId}.baseline is required`);
    for (const key of ['selector', 'projectionOf']) invariant(typeof baseline[key] === 'string' && baseline[key].length > 0, `${entry.caseId}.baseline.${key} is required`);

    for (const candidate of entry.candidates || []) {
      invariant(typeof candidate.display?.title === 'string' && candidate.display.title.length > 0, `${candidate.id || entry.caseId}.display.title is required`);
      invariant(Array.isArray(candidate.evidence) && candidate.evidence.length > 0, `${candidate.id || entry.caseId}.evidence is required`);
    }

    const report = evaluateRanking({
      candidates: entry.candidates,
      rankedIds: baseline.rankedIds,
      prefix: context.prefix,
      gemClaimIds: baseline.gemClaimIds,
    });
    invariant(report.reachability.exactPermutation, `${entry.caseId} baseline must be an exact candidate permutation`);
  }

  return fixture;
}
