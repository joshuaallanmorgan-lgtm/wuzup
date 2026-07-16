// Pure market gate for distance-based product claims. Browser permission and
// a valid coordinate are not sufficient: the fix must also fall inside the
// active city artifact's ratified coverage box.

function coordinatePair(coords) {
  if (!coords || typeof coords !== 'object' || Array.isArray(coords)) return null
  const lat = Number.isFinite(coords.lat ?? coords.latitude)
    ? coords.lat ?? coords.latitude
    : null
  const lng = Number.isFinite(coords.lng ?? coords.longitude)
    ? coords.lng ?? coords.longitude
    : null
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }
  return { lat, lng }
}

function validBbox(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Number.isFinite(value.south)
    && Number.isFinite(value.north)
    && Number.isFinite(value.west)
    && Number.isFinite(value.east)
    && value.south >= -90
    && value.north <= 90
    && value.west >= -180
    && value.east <= 180
    && value.south < value.north
    && value.west < value.east
}

export function coordsInCityMarket(coords, city) {
  const point = coordinatePair(coords)
  const bbox = city?.bbox
  if (!point || !validBbox(bbox)) return false
  return point.lat >= bbox.south
    && point.lat <= bbox.north
    && point.lng >= bbox.west
    && point.lng <= bbox.east
}

export function usableCityCoords(location, city) {
  return location?.enabled === true && coordsInCityMarket(location.coords, city)
    ? location.coords
    : null
}
