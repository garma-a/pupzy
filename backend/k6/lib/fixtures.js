// k6/lib/fixtures.js
// Static test data loader: post IDs, city IDs, governorates, geo centres.
//
// fixtures.json is generated from the test database using the SQL in
// k6/sql/fixtures.sql (or manually via psql).
//
// Expected shape of fixtures.json:
// {
//   "rescuePostIds":   ["uuid-1", ...],   // ≥200 ACTIVE RESCUE posts
//   "adoptionPostIds": ["uuid-1", ...],   // ≥200 ACTIVE ADOPTION posts
//   "productPostIds":  ["uuid-1", ...],   // ≥100 ACTIVE PRODUCT posts
//   "lostPostIds":     ["uuid-1", ...],   // ≥100 ACTIVE LOST posts
//   "cityIds":         ["uuid-1", ...],   // all seeded cities
//   "governorates":    ["Cairo", "Alexandria", "Giza", "Luxor", "Aswan"],
//   "cairoCenter":     { "latitude": 30.0444, "longitude": 31.2357 },
//   "alexCenter":      { "latitude": 31.2001, "longitude": 29.9187 }
// }

import { SharedArray } from 'k6/data';

// SharedArray parses the file once at init time, shared across all VUs.
const _fixtureArray = new SharedArray('fixtures', function () {
  // Wrap in array so SharedArray can hold the object as index 0.
  return [JSON.parse(open('../fixtures.json'))];
});

/** The full fixtures object. Access any key directly: fixtures.rescuePostIds */
export const fixtures = _fixtureArray[0];

// ── Random-picker helpers ─────────────────────────────────────────────────────

/** @returns {string} A random RESCUE post UUID */
export function randomRescuePostId() {
  const arr = fixtures.rescuePostIds;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** @returns {string} A random ADOPTION post UUID */
export function randomAdoptionPostId() {
  const arr = fixtures.adoptionPostIds;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** @returns {string} A random PRODUCT post UUID */
export function randomProductPostId() {
  const arr = fixtures.productPostIds;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** @returns {string} A random LOST post UUID */
export function randomLostPostId() {
  const arr = fixtures.lostPostIds;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** @returns {string} A random city UUID */
export function randomCityId() {
  const arr = fixtures.cityIds;
  return arr[Math.floor(Math.random() * arr.length)];
}

/** @returns {string} A random governorate name */
export function randomGovernorate() {
  const arr = fixtures.governorates;
  return arr[Math.floor(Math.random() * arr.length)];
}
