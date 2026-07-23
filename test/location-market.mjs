import assert from 'node:assert/strict'
import test from 'node:test'

import { CITIES } from '../app/src/city.js'
import {
  coordsInCityMarket,
  usableCityCoords,
} from '../app/src/location-market.js'
import { bbox as sfFinderBbox } from '../finder/cities/sf-east-bay.mjs'
import { bbox as tampaFinderBbox } from '../finder/cities/tampa-bay.mjs'

const appBox = (bbox) => ({
  south: bbox.latMin,
  north: bbox.latMax,
  west: bbox.lngMin,
  east: bbox.lngMax,
})

test('app market boxes exactly mirror the finder sanity boxes', () => {
  assert.deepEqual(CITIES['tampa-bay'].bbox, appBox(tampaFinderBbox))
  assert.deepEqual(CITIES['sf-east-bay'].bbox, appBox(sfFinderBbox))
})

test('market membership is inclusive at the boundary and rejects other cities', () => {
  const tampa = CITIES['tampa-bay']
  const sf = CITIES['sf-east-bay']
  assert.equal(coordsInCityMarket(tampa.center, tampa), true)
  assert.equal(coordsInCityMarket(sf.center, sf), true)
  assert.equal(coordsInCityMarket({
    lat: tampa.bbox.south,
    lng: tampa.bbox.west,
  }, tampa), true)
  assert.equal(coordsInCityMarket(sf.center, tampa), false)
  assert.equal(coordsInCityMarket(tampa.center, sf), false)
})

test('invalid coordinates and malformed coverage boxes fail closed', () => {
  const tampa = CITIES['tampa-bay']
  for (const coords of [
    null,
    {},
    { lat: Number.NaN, lng: -82 },
    { lat: 91, lng: -82 },
    { latitude: 27.95 },
  ]) {
    assert.equal(coordsInCityMarket(coords, tampa), false)
  }
  assert.equal(coordsInCityMarket(tampa.center, {}), false)
  assert.equal(coordsInCityMarket(tampa.center, {
    bbox: { south: 1, north: 1, west: 2, east: 3 },
  }), false)
})

test('usable coordinates require effective permission and active-market membership', () => {
  const tampa = CITIES['tampa-bay']
  const granted = { enabled: true, coords: tampa.center }
  assert.strictEqual(usableCityCoords(granted, tampa), tampa.center)
  assert.equal(usableCityCoords({ ...granted, enabled: false }, tampa), null)
  assert.equal(usableCityCoords({
    enabled: true,
    coords: CITIES['sf-east-bay'].center,
  }, tampa), null)
})
