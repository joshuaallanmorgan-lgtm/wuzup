// Retained place evidence is deliberately narrow: this helper is the final
// fail-closed boundary before source detail becomes a shipped place signal.

const OSM_TYPES = new Set(['node', 'way', 'relation']);
const QID = /^Q[1-9]\d*$/;
export const PLACE_PHONE_MAX_LENGTH = 32;
export const PLACE_BRAND_MAX_LENGTH = 96;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validPhone(value) {
  if (!nonEmptyString(value)) return null;
  const phone = value.trim();
  if (phone.length > PLACE_PHONE_MAX_LENGTH) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (!/^\+?[\d().\-\s]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(phone)) return null;
  return phone;
}

function validBrand(value) {
  if (!nonEmptyString(value)) return null;
  const brand = value.trim();
  if (brand.length > PLACE_BRAND_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(brand)) return null;
  return brand;
}

function validOsm(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!OSM_TYPES.has(value.type) || !Number.isSafeInteger(value.id) || value.id <= 0) return null;
  return { type: value.type, id: value.id };
}

/**
 * Return only retained place evidence with independently valid values.
 * Internal merge fields are accepted so the helper can remain the single
 * output boundary while the legacy merge implementation keeps its private
 * working names.
 */
export function retainedPlaceSignals(place) {
  if (!place || typeof place !== 'object' || Array.isArray(place)) return {};
  const evidence = {};
  const phone = validPhone(place.phone);
  const brand = validBrand(place.brand);
  const osm = validOsm(place.osm);
  if (phone) evidence.phone = phone;
  if (osm) {
    evidence.osm = osm;
    const osmTagCount = place.osmTagCount ?? place._osmTags;
    if (Number.isSafeInteger(osmTagCount) && osmTagCount >= 0) evidence.osmTagCount = osmTagCount;
  }
  if (place.hasWiki === true || place._hasWiki === true) evidence.hasWiki = true;
  if (place.governmentBacked === true || place._govBacked === true) evidence.governmentBacked = true;
  if (brand) evidence.brand = brand;
  if (nonEmptyString(place.brandWikidata) && QID.test(place.brandWikidata.trim())) {
    evidence.brandWikidata = place.brandWikidata.trim();
  }
  return evidence;
}
