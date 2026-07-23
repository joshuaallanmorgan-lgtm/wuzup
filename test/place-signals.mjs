import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACE_BRAND_MAX_LENGTH,
  PLACE_PHONE_MAX_LENGTH,
  retainedPlaceSignals,
} from '../finder/place-signals.mjs';

test('retains complete place evidence without changing its source values', () => {
  const place = {
    phone: ' +1 (813) 555-0123 ',
    osm: { type: 'relation', id: 123456 },
    osmTagCount: 14,
    hasWiki: true,
    governmentBacked: true,
    brand: ' City Parks ',
    brandWikidata: 'Q12345',
  };

  assert.deepEqual(retainedPlaceSignals(place), {
    phone: '+1 (813) 555-0123',
    osm: { type: 'relation', id: 123456 },
    osmTagCount: 14,
    hasWiki: true,
    governmentBacked: true,
    brand: 'City Parks',
    brandWikidata: 'Q12345',
  });
  assert.equal(place.phone, ' +1 (813) 555-0123 ');
})

test('fails closed for malformed OSM, phone, flags, brand, and QID evidence', () => {
  assert.deepEqual(retainedPlaceSignals({
    phone: 'call the parks office',
    osm: { type: 'area', id: 0 },
    osmTagCount: 9,
    hasWiki: 'true',
    governmentBacked: 1,
    brand: '   ',
    brandWikidata: 'q123',
  }), {});

  assert.deepEqual(retainedPlaceSignals({ phone: 'text 8135550123' }), {});

  assert.deepEqual(retainedPlaceSignals({
    osm: { type: 'node', id: Number.MAX_SAFE_INTEGER + 1 },
    osmTagCount: 4,
    brandWikidata: 'Q0',
  }), {});
})

test('does not emit OSM tag counts without valid OSM provenance', () => {
  assert.deepEqual(retainedPlaceSignals({ osmTagCount: 7 }), {});
  assert.deepEqual(retainedPlaceSignals({ osm: { type: 'way', id: 9 }, osmTagCount: -1 }), {
    osm: { type: 'way', id: 9 },
  });
})

test('supports the legacy merge evidence names at the sole output boundary', () => {
  assert.deepEqual(retainedPlaceSignals({
    osm: { type: 'node', id: 1 },
    _osmTags: 3,
    _hasWiki: true,
    _govBacked: true,
  }), {
    osm: { type: 'node', id: 1 },
    osmTagCount: 3,
    hasWiki: true,
    governmentBacked: true,
  });
})

test('retains phone and brand strings at their exact compact limits', () => {
  const basePhone = '+1 (813) 555-0123'
  const suffix = 'x 4'
  const phone = `${basePhone}${' '.repeat(PLACE_PHONE_MAX_LENGTH - basePhone.length - suffix.length)}${suffix}`
  const brand = 'B'.repeat(PLACE_BRAND_MAX_LENGTH)

  assert.equal(phone.length, PLACE_PHONE_MAX_LENGTH)
  assert.deepEqual(retainedPlaceSignals({ phone, brand }), { phone, brand })
})

test('rejects oversize phone and brand strings before emitting evidence', () => {
  const basePhone = '+1 (813) 555-0123'
  const suffix = 'x 4'
  const phone = `${basePhone}${' '.repeat(PLACE_PHONE_MAX_LENGTH - basePhone.length - suffix.length + 1)}${suffix}`
  const brand = 'B'.repeat(PLACE_BRAND_MAX_LENGTH + 1)

  assert.equal(phone.length, PLACE_PHONE_MAX_LENGTH + 1)
  assert.deepEqual(retainedPlaceSignals({ phone, brand }), {})
  assert.deepEqual(retainedPlaceSignals({ brand: 'Valid\nBrand' }), {})
})
