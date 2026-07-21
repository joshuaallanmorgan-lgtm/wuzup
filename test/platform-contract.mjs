import test from 'node:test';
import assert from 'node:assert/strict';

import {
  platformConfigHash,
  validatePlatformAdapter,
  validatePlatformCityConfig,
  normalizePlatformReceipt,
} from '../finder/platform-contract.mjs';

const adapter = {
  schemaVersion: 1,
  platformId: 'calendar.events@v1',
  kind: 'events',
  sourceFamily: 'City calendar',
  countries: ['US'],
  baseUrl: 'https://calendar.example.test/api',
  publicConfigKeys: ['locale', 'marketCode'],
  requiredConfigKeys: ['locale', 'marketCode'],
  secretEnvKeys: ['apiToken'],
};

function city(overrides = {}) {
  return {
    schemaVersion: 1,
    platformId: 'calendar.events@v1',
    cityId: 'tampa-bay',
    timeZone: 'America/New_York',
    country: 'US',
    market: 'Tampa Bay',
    bbox: { latMin: 27.4, latMax: 28.3, lngMin: -83, lngMax: -82 },
    politeness: { minGapMs: 1000, timeoutMs: 10000, retries: 2 },
    cacheMaxAgeMs: 3600000,
    config: { locale: 'en-US', marketCode: 'tpa' },
    secretEnv: { apiToken: 'CALENDAR_API_TOKEN' },
    ...overrides,
  };
}

function receipt(config, outcome, overrides = {}) {
  return {
    platformId: config.platformId,
    cityId: config.cityId,
    timeZone: config.timeZone,
    configHash: platformConfigHash(adapter, config),
    runId: 'run-123',
    checkedAt: '2026-07-20T12:00:00.000Z',
    outcome,
    rowCount: 3,
    ...overrides,
  };
}

test('validates a versioned metadata-only platform adapter and two city configurations', () => {
  const tampa = city();
  const sf = city({ cityId: 'sf-east-bay', timeZone: 'America/Los_Angeles', market: 'SF East Bay', config: { marketCode: 'sfo', locale: 'en-US' } });
  const tampaHash = platformConfigHash(adapter, tampa);
  const sfHash = platformConfigHash(adapter, sf);

  assert.equal(validatePlatformAdapter(adapter).platformId, 'calendar.events@v1');
  assert.equal(validatePlatformCityConfig(adapter, tampa).configHash, tampaHash);
  assert.notEqual(tampaHash, sfHash);
})

test('config hashes are stable across key ordering and omit secret references', () => {
  const first = city();
  const reordered = city({
    config: { marketCode: 'tpa', locale: 'en-US' },
    secretEnv: { apiToken: 'REPLACED_TOKEN_REFERENCE' },
  });
  const hash = platformConfigHash(adapter, first);
  assert.equal(hash, platformConfigHash(adapter, reordered));
  assert.equal(hash.includes('CALENDAR_API_TOKEN'), false);
  assert.equal(JSON.stringify(validatePlatformCityConfig(adapter, first)).includes('CALENDAR_API_TOKEN'), false);
})

test('rejects malformed politeness and direct secret-like configuration', () => {
  assert.throws(() => platformConfigHash(adapter, city({ politeness: { minGapMs: 0, timeoutMs: 1000, retries: 0 } })), /minGapMs/);
  assert.throws(() => platformConfigHash(adapter, city({ politeness: { minGapMs: 1, timeoutMs: 0, retries: 0 } })), /timeoutMs/);
  assert.throws(() => platformConfigHash(adapter, city({ config: { locale: 'en-US', marketCode: 'tpa', apiToken: 'not-allowed' } })), /secretEnv|not declared public/);
  assert.throws(() => platformConfigHash(adapter, city({ config: { locale: 'en-US', marketCode: 'tpa', auth: { apiToken: 'not-allowed' } } })), /secretEnv|not declared public/);
  const nestedAdapter = { ...adapter, publicConfigKeys: [...adapter.publicConfigKeys, 'nested'] }
  for (const key of ['credential', 'cookie', 'session', 'bearer', 'key']) {
    assert.throws(() => platformConfigHash(nestedAdapter, city({ config: { locale: 'en-US', marketCode: 'tpa', nested: { [key]: 'not-allowed' } } })), /secretEnv/);
  }
  assert.throws(() => platformConfigHash(adapter, city({ timeZone: 'Mars/Olympus' })), /timeZone/);
})

test('requires an exact public configuration allowlist and HTTPS metadata', () => {
  assert.throws(() => validatePlatformAdapter({ ...adapter, publicConfigKeys: undefined }), /publicConfigKeys/)
  assert.throws(() => validatePlatformAdapter({ ...adapter, publicConfigKeys: ['locale'], requiredConfigKeys: ['marketCode'] }), /publicConfigKeys|must be public/)
  assert.throws(() => validatePlatformAdapter({ ...adapter, baseUrl: 'http://calendar.example.test/api' }), /https/)
  assert.throws(() => platformConfigHash(adapter, city({ config: { locale: 'en-US', marketCode: 'tpa', unexpected: true } })), /not declared public/)
})

test('rejects undeclared adapter and city top-level keys, including secret-like names', () => {
  for (const key of ['apiKey', 'token', 'auth', 'notes']) {
    assert.throws(() => validatePlatformAdapter({ ...adapter, [key]: 'unexpected' }), new RegExp(`adapter\\.${key} is not allowed`))
    assert.throws(() => platformConfigHash(adapter, city({ [key]: 'unexpected' })), new RegExp(`city config\\.${key} is not allowed`))
  }

  assert.doesNotThrow(() => validatePlatformAdapter(adapter))
  assert.doesNotThrow(() => validatePlatformCityConfig(adapter, city()))
})

test('normalizes complete live, cache, fallback, and failed receipts', () => {
  const config = city();
  assert.equal(normalizePlatformReceipt(adapter, config, receipt(config, 'live')).outcome, 'live');
  assert.deepEqual(normalizePlatformReceipt(adapter, config, receipt(config, 'cache', { cacheAgeMs: 60000 })), {
    ...receipt(config, 'cache', { cacheAgeMs: 60000 }),
    schemaVersion: 1,
  });
  assert.deepEqual(normalizePlatformReceipt(adapter, config, receipt(config, 'fallback', { cacheAgeMs: 60000, fallbackReason: 'LIVE_ERROR' })), {
    ...receipt(config, 'fallback', { cacheAgeMs: 60000, fallbackReason: 'LIVE_ERROR' }),
    schemaVersion: 1,
  });
  assert.deepEqual(normalizePlatformReceipt(adapter, config, receipt(config, 'failed', { rowCount: 0, error: 'UPSTREAM_UNAVAILABLE' })), {
    ...receipt(config, 'failed', { rowCount: 0, error: 'UPSTREAM_UNAVAILABLE' }),
    schemaVersion: 1,
  });
})

test('accepts cache evidence at the configured age edge and rejects stale cache or fallback', () => {
  const config = city({ cacheMaxAgeMs: 60000 })
  assert.equal(normalizePlatformReceipt(adapter, config, receipt(config, 'cache', { cacheAgeMs: 60000 })).cacheAgeMs, 60000)
  assert.equal(normalizePlatformReceipt(adapter, config, receipt(config, 'fallback', { cacheAgeMs: 60000, fallbackReason: 'LIVE_ERROR' })).cacheAgeMs, 60000)
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'cache', { cacheAgeMs: 60001 })), /exceeds city config\.cacheMaxAgeMs/)
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'fallback', { cacheAgeMs: 60001, fallbackReason: 'LIVE_ERROR' })), /exceeds city config\.cacheMaxAgeMs/)
})

test('receipt inputs have an exact outcome-specific top-level schema', () => {
  const config = city()
  assert.doesNotThrow(() => normalizePlatformReceipt(adapter, config, receipt(config, 'live')))
  assert.doesNotThrow(() => normalizePlatformReceipt(adapter, config, { ...receipt(config, 'live'), schemaVersion: 1 }))
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'live', { note: 'unexpected' })), /receipt\.note is not allowed/)
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'live', { token: 'unexpected' })), /receipt\.token is not allowed/)
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'live', { schemaVersion: 2 })), /receipt\.schemaVersion/)
})

test('fallback and failure receipts retain bounded machine codes only', () => {
  const config = city()
  for (const unsafe of ['live-error', 'https://upstream.test/?token=secret', 'upstream unavailable', `A${'B'.repeat(64)}`]) {
    assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'fallback', { cacheAgeMs: 1, fallbackReason: unsafe })), /machine code/)
    assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'failed', { rowCount: 0, error: unsafe })), /machine code/)
  }
})

test('fails closed on city, timezone, hash, and incomplete receipt facts', () => {
  const config = city();
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'live', { cityId: 'sf-east-bay' })), /cityId/);
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'live', { timeZone: 'America/Los_Angeles' })), /timeZone/);
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'cache')), /cacheAgeMs/);
  assert.throws(() => normalizePlatformReceipt(adapter, config, receipt(config, 'failed', { rowCount: 1, error: 'nope' })), /rowCount/);
})
