import { createHash } from 'node:crypto';

export const PLATFORM_CONTRACT_SCHEMA_VERSION = 1;

const KINDS = new Set(['events', 'places']);
const OUTCOMES = new Set(['live', 'cache', 'fallback', 'failed']);
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const PLATFORM_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*@v[1-9]\d*$/;
const IANA_TIME_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z_+\-]+)+$/;
const COUNTRY = /^[A-Z]{2}$/;
const CONFIG_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ADAPTER_TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'platformId', 'kind', 'sourceFamily', 'countries',
  'endpoint', 'baseUrl', 'publicConfigKeys', 'requiredConfigKeys', 'secretEnvKeys',
]);
const CITY_CONFIG_TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'platformId', 'cityId', 'timeZone', 'country', 'market',
  'bbox', 'politeness', 'cacheMaxAgeMs', 'config', 'secretEnv',
]);
const RECEIPT_BASE_KEYS = [
  'schemaVersion', 'platformId', 'cityId', 'timeZone', 'configHash', 'runId',
  'checkedAt', 'outcome', 'rowCount',
];
const RECEIPT_TOP_LEVEL_KEYS = {
  live: new Set(RECEIPT_BASE_KEYS),
  cache: new Set([...RECEIPT_BASE_KEYS, 'cacheAgeMs']),
  fallback: new Set([...RECEIPT_BASE_KEYS, 'cacheAgeMs', 'fallbackReason']),
  failed: new Set([...RECEIPT_BASE_KEYS, 'error']),
};
const SECRET_KEY_EXACT = new Set([
  'apiKey', 'accessKey', 'auth', 'authorization', 'bearer', 'clientSecret',
  'cookie', 'credential', 'credentials', 'key', 'password', 'passphrase',
  'privateKey', 'secret', 'session', 'token',
].map(key => key.toLowerCase()));
const SECRET_KEY_FRAGMENT = /secret|token|password|passphrase|credential|cookie|session|bearer|private.?key|api.?key|access.?key|client.?secret/i;

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactTopLevelKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    invariant(allowed.has(key), `${label}.${key} is not allowed`);
  }
}

function validIso(value) {
  if (!nonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function jsonValue(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return plainObject(value) && Object.values(value).every(jsonValue);
}

function validIanaTimeZone(value) {
  if (typeof value !== 'string' || !IANA_TIME_ZONE.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function rejectSecretLikeKeys(value, path = 'city config.config') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretLikeKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!plainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    invariant(!SECRET_KEY_EXACT.has(normalized) && !SECRET_KEY_FRAGMENT.test(key), `${path}.${key} must use secretEnv instead`);
    rejectSecretLikeKeys(entry, `${path}.${key}`);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validatedUrl(value, label) {
  invariant(nonEmptyString(value), `${label} must be a non-empty URL`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be a valid URL`);
  }
  invariant(parsed.protocol === 'https:', `${label} must use https`);
  invariant(!parsed.username && !parsed.password && !parsed.search && !parsed.hash, `${label} cannot contain credentials, query parameters, or fragments`);
  return parsed.toString();
}

function validatedBbox(value) {
  invariant(plainObject(value), 'bbox must be an object');
  for (const key of ['latMin', 'latMax', 'lngMin', 'lngMax']) invariant(Number.isFinite(value[key]), `bbox.${key} must be finite`);
  invariant(value.latMin >= -90 && value.latMax <= 90 && value.latMin < value.latMax, 'bbox latitude bounds are invalid');
  invariant(value.lngMin >= -180 && value.lngMax <= 180 && value.lngMin < value.lngMax, 'bbox longitude bounds are invalid');
  return { latMin: value.latMin, latMax: value.latMax, lngMin: value.lngMin, lngMax: value.lngMax };
}

function validatedPoliteness(value) {
  invariant(plainObject(value), 'politeness must be an object');
  invariant(Number.isInteger(value.minGapMs) && value.minGapMs > 0, 'politeness.minGapMs must be a positive integer');
  invariant(Number.isInteger(value.timeoutMs) && value.timeoutMs > 0, 'politeness.timeoutMs must be a positive integer');
  invariant(Number.isInteger(value.retries) && value.retries >= 0, 'politeness.retries must be a non-negative integer');
  return { minGapMs: value.minGapMs, timeoutMs: value.timeoutMs, retries: value.retries };
}

function validatedRequiredKeys(value) {
  invariant(Array.isArray(value), 'requiredConfigKeys must be an array');
  const keys = [];
  for (const key of value) {
    invariant(typeof key === 'string' && CONFIG_KEY.test(key), 'requiredConfigKeys must contain safe key names');
    invariant(!keys.includes(key), `duplicate required config key '${key}'`);
    keys.push(key);
  }
  return keys.sort();
}

function validatedPublicKeys(value) {
  invariant(Array.isArray(value), 'publicConfigKeys must be an array');
  const keys = [];
  for (const key of value) {
    invariant(typeof key === 'string' && CONFIG_KEY.test(key), 'publicConfigKeys must contain safe key names');
    invariant(!keys.includes(key), `duplicate public config key '${key}'`);
    keys.push(key);
  }
  return keys.sort();
}

function machineCode(value, label) {
  invariant(typeof value === 'string' && MACHINE_CODE.test(value), `${label} must be a bounded machine code`);
  return value;
}

function validatedSecretKeys(value) {
  invariant(value == null || Array.isArray(value), 'secretEnvKeys must be an array when provided');
  return [...new Set(value || [])].map((key) => {
    invariant(typeof key === 'string' && CONFIG_KEY.test(key), 'secretEnvKeys must contain safe key names');
    return key;
  }).sort();
}

/** Validate a platform definition; this is metadata only and never executes it. */
export function validatePlatformAdapter(adapter) {
  invariant(plainObject(adapter), 'adapter must be an object');
  exactTopLevelKeys(adapter, ADAPTER_TOP_LEVEL_KEYS, 'adapter');
  invariant(adapter.schemaVersion === PLATFORM_CONTRACT_SCHEMA_VERSION, `adapter.schemaVersion must be ${PLATFORM_CONTRACT_SCHEMA_VERSION}`);
  invariant(typeof adapter.platformId === 'string' && PLATFORM_ID.test(adapter.platformId), 'adapter.platformId must be versioned (for example, calendar.events@v1)');
  invariant(KINDS.has(adapter.kind), 'adapter.kind must be events or places');
  invariant(nonEmptyString(adapter.sourceFamily), 'adapter.sourceFamily must be a non-empty string');
  invariant(Array.isArray(adapter.countries) && adapter.countries.length > 0, 'adapter.countries must be a non-empty array');
  const countries = [...new Set(adapter.countries)].sort();
  for (const country of countries) invariant(typeof country === 'string' && COUNTRY.test(country), 'adapter.countries must contain uppercase ISO country codes');
  invariant(Boolean(adapter.endpoint) !== Boolean(adapter.baseUrl), 'adapter must define exactly one of endpoint or baseUrl');
  const endpoint = adapter.endpoint ? { endpoint: validatedUrl(adapter.endpoint, 'adapter.endpoint') } : { baseUrl: validatedUrl(adapter.baseUrl, 'adapter.baseUrl') };
  const publicConfigKeys = validatedPublicKeys(adapter.publicConfigKeys);
  const requiredConfigKeys = validatedRequiredKeys(adapter.requiredConfigKeys);
  for (const key of requiredConfigKeys) invariant(publicConfigKeys.includes(key), `required config key '${key}' must be public`);
  return {
    schemaVersion: adapter.schemaVersion,
    platformId: adapter.platformId,
    kind: adapter.kind,
    sourceFamily: adapter.sourceFamily.trim(),
    countries,
    ...endpoint,
    publicConfigKeys,
    requiredConfigKeys,
    secretEnvKeys: validatedSecretKeys(adapter.secretEnvKeys),
  };
}

function secretReferences(adapter, value) {
  invariant(plainObject(value), 'secretEnv must be an object');
  const keys = Object.keys(value).sort();
  invariant(stableStringify(keys) === stableStringify(adapter.secretEnvKeys), 'secretEnv keys must exactly match adapter.secretEnvKeys');
  for (const key of keys) invariant(typeof value[key] === 'string' && ENV_NAME.test(value[key]), `secretEnv.${key} must be an environment-variable name`);
}

function normalizedConfig(adapter, config) {
  invariant(plainObject(config), 'city config must be an object');
  exactTopLevelKeys(config, CITY_CONFIG_TOP_LEVEL_KEYS, 'city config');
  invariant(config.schemaVersion === PLATFORM_CONTRACT_SCHEMA_VERSION, `city config.schemaVersion must be ${PLATFORM_CONTRACT_SCHEMA_VERSION}`);
  invariant(config.platformId === adapter.platformId, 'city config platformId does not match adapter');
  invariant(nonEmptyString(config.cityId), 'city config.cityId must be a non-empty string');
  invariant(validIanaTimeZone(config.timeZone), 'city config.timeZone must be an IANA timezone');
  invariant(typeof config.country === 'string' && adapter.countries.includes(config.country), 'city config.country is not supported by adapter');
  invariant(nonEmptyString(config.market), 'city config.market must be a non-empty string');
  invariant(plainObject(config.config) && jsonValue(config.config), 'city config.config must be a JSON object');
  for (const key of Object.keys(config.config)) invariant(adapter.publicConfigKeys.includes(key), `city config.config.${key} is not declared public`);
  for (const key of adapter.requiredConfigKeys) invariant(Object.hasOwn(config.config, key) && config.config[key] != null && config.config[key] !== '', `city config.config.${key} is required`);
  rejectSecretLikeKeys(config.config);
  secretReferences(adapter, config.secretEnv || {});
  invariant(Number.isInteger(config.cacheMaxAgeMs) && config.cacheMaxAgeMs >= 0, 'city config.cacheMaxAgeMs must be a non-negative integer');
  return {
    schemaVersion: config.schemaVersion,
    platformId: config.platformId,
    cityId: config.cityId,
    timeZone: config.timeZone,
    country: config.country,
    market: config.market.trim(),
    bbox: validatedBbox(config.bbox),
    politeness: validatedPoliteness(config.politeness),
    cacheMaxAgeMs: config.cacheMaxAgeMs,
    config: config.config,
  };
}

/** Return a deterministic, non-secret identity for one adapter city configuration. */
export function platformConfigHash(adapterDefinition, cityConfig) {
  const adapter = validatePlatformAdapter(adapterDefinition);
  const config = normalizedConfig(adapter, cityConfig);
  return `sha256:${createHash('sha256').update(stableStringify({ adapter, config })).digest('hex')}`;
}

/** Validate and normalize a city configuration without returning secret references. */
export function validatePlatformCityConfig(adapterDefinition, cityConfig) {
  const adapter = validatePlatformAdapter(adapterDefinition);
  const config = normalizedConfig(adapter, cityConfig);
  return { adapter, config, configHash: platformConfigHash(adapter, cityConfig) };
}

/**
 * Validate a received adapter execution receipt. It refuses city, timezone,
 * hash, and state-fact mismatches before downstream code can treat it as data.
 */
export function normalizePlatformReceipt(adapterDefinition, cityConfig, receipt) {
  const { adapter, config, configHash } = validatePlatformCityConfig(adapterDefinition, cityConfig);
  invariant(plainObject(receipt), 'receipt must be an object');
  invariant(OUTCOMES.has(receipt.outcome), 'receipt.outcome must be live, cache, fallback, or failed');
  exactTopLevelKeys(receipt, RECEIPT_TOP_LEVEL_KEYS[receipt.outcome], 'receipt');
  if (Object.hasOwn(receipt, 'schemaVersion')) {
    invariant(receipt.schemaVersion === PLATFORM_CONTRACT_SCHEMA_VERSION, `receipt.schemaVersion must be ${PLATFORM_CONTRACT_SCHEMA_VERSION}`);
  }
  invariant(receipt.platformId === adapter.platformId, 'receipt platformId does not match adapter');
  invariant(receipt.cityId === config.cityId, 'receipt cityId does not match city config');
  invariant(receipt.timeZone === config.timeZone, 'receipt timeZone does not match city config');
  invariant(receipt.configHash === configHash, 'receipt configHash does not match city config');
  invariant(nonEmptyString(receipt.runId), 'receipt.runId must be a non-empty string');
  invariant(validIso(receipt.checkedAt), 'receipt.checkedAt must be an ISO timestamp');
  invariant(Number.isInteger(receipt.rowCount) && receipt.rowCount >= 0, 'receipt.rowCount must be a non-negative integer');

  const base = {
    schemaVersion: PLATFORM_CONTRACT_SCHEMA_VERSION,
    platformId: adapter.platformId,
    cityId: config.cityId,
    timeZone: config.timeZone,
    configHash,
    runId: receipt.runId,
    checkedAt: receipt.checkedAt,
    outcome: receipt.outcome,
    rowCount: receipt.rowCount,
  };
  if (receipt.outcome === 'live') {
    invariant(receipt.cacheAgeMs == null && receipt.fallbackReason == null && receipt.error == null, 'live receipt cannot carry cache, fallback, or error facts');
    return base;
  }
  if (receipt.outcome === 'cache') {
    invariant(Number.isInteger(receipt.cacheAgeMs) && receipt.cacheAgeMs >= 0, 'cache receipt.cacheAgeMs must be a non-negative integer');
    invariant(receipt.cacheAgeMs <= config.cacheMaxAgeMs, 'cache receipt.cacheAgeMs exceeds city config.cacheMaxAgeMs');
    invariant(receipt.fallbackReason == null && receipt.error == null, 'cache receipt cannot carry fallback or error facts');
    return { ...base, cacheAgeMs: receipt.cacheAgeMs };
  }
  if (receipt.outcome === 'fallback') {
    invariant(Number.isInteger(receipt.cacheAgeMs) && receipt.cacheAgeMs >= 0, 'fallback receipt.cacheAgeMs must be a non-negative integer');
    invariant(receipt.cacheAgeMs <= config.cacheMaxAgeMs, 'fallback receipt.cacheAgeMs exceeds city config.cacheMaxAgeMs');
    const fallbackReason = machineCode(receipt.fallbackReason, 'fallback receipt.fallbackReason');
    invariant(receipt.error == null, 'fallback receipt cannot carry an error payload');
    return { ...base, cacheAgeMs: receipt.cacheAgeMs, fallbackReason };
  }
  invariant(receipt.rowCount === 0, 'failed receipt.rowCount must be 0');
  const error = machineCode(receipt.error, 'failed receipt.error');
  invariant(receipt.cacheAgeMs == null && receipt.fallbackReason == null, 'failed receipt cannot carry cache or fallback facts');
  return { ...base, error };
}
