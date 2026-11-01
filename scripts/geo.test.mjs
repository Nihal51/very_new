/** The exact pickup spot (lib/geo.ts): checked, rounded, and turned into a Google Maps link. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { accuracyText, CITY_CENTRES, mapsLink, readPickupGeo, toPickupGeo } from '../lib/geo.ts';

test('a spot in India is kept, rounded to 6 decimals; its GPS accuracy in whole metres', () => {
  assert.deepEqual(toPickupGeo(21.25138412, 81.62964123, 14.6), { lat: 21.251384, lng: 81.629641, acc: 15 });
  assert.deepEqual(toPickupGeo('21.25', '81.63'), { lat: 21.25, lng: 81.63 }, 'a pin placed by hand: no accuracy');
  assert.equal(toPickupGeo(21.25, 81.63, -3).acc, undefined);
});

test('anything else is no spot at all', () => {
  for (const [lat, lng] of [[51.5, -0.12], [NaN, 81], [21, Infinity], [null, null], ['x', 81]]) assert.equal(toPickupGeo(lat, lng), null, `${lat},${lng}`);
  assert.equal(readPickupGeo(undefined), null);
  assert.equal(readPickupGeo('Shankar Nagar'), null);
  assert.deepEqual(readPickupGeo({ lat: 21.25, lng: 81.63, acc: 20 }), { lat: 21.25, lng: 81.63, acc: 20 });
});

test('the Google Maps link and the accuracy in words', () => {
  assert.equal(mapsLink({ lat: 21.251384, lng: 81.629641 }), 'https://www.google.com/maps?q=21.251384,81.629641');
  assert.equal(accuracyText({ lat: 21, lng: 81, acc: 15 }), '±15 m');
  assert.equal(accuracyText({ lat: 21, lng: 81 }), 'pinned on the map');
  for (const c of ['Raipur', 'Bhilai', 'Durg', 'Bilaspur']) assert.ok(toPickupGeo(CITY_CENTRES[c].lat, CITY_CENTRES[c].lng), c);
});
