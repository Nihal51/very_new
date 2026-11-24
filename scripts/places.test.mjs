/**
 * Every place in India for the trip forms' place box (lib/places.ts and
 * public/data/india-places.json): the list itself, the search, the km from
 * the map, and that a booking to such a place has the shape firestore.rules
 * (isTrip) accepts — while our own destinations keep their measured km.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { destinations, driveCharge, estimate, findDestination, pickupCities, planTrip, roadKm } from '../lib/outstation.ts';
import {
  NO_ROAD_STATES,
  RENAMED_STATIONS,
  parsePlaces,
  placeIndex,
  placeKm,
  placeLabel,
  placeStation,
  plainText,
  searchPlaces,
} from '../lib/places.ts';
import { checkSettings } from '../lib/settings-schema.ts';
import { settings } from '../site-settings.ts';

const raw = JSON.parse(readFileSync(new URL('../public/data/india-places.json', import.meta.url), 'utf8'));
const places = parsePlaces(raw);
const index = placeIndex(places, destinations);
const names = (q, n = 20) => searchPlaces(index, q, n).map((e) => e.name);
const ROAD = settings.outstation.roadFactor;

/** lib/settings.ts tripRules (which uses the @/ alias Node cannot read). */
const o = settings.outstation;
const rules = {
  dayRate: { ...settings.prices.outstation },
  nearRates: settings.prices.outstationNear,
  nearFromKm: o.nearFromKm,
  dayTopFromKm: o.dayTopFromKm,
  returnHour: o.returnHour,
  returnMaxPerDay: o.returnMaxPerDay,
  returnFullDayAfter: o.returnFullDayAfterHours,
  extraFullDayAfter: o.extraFullDayAfterHours,
  extraHour: o.extraHour,
  hoursPerDay: o.hoursPerDay,
  sameDayMaxHours: o.sameDayMaxHours,
  kmPerDay: o.kmPerDay,
  averageKmh: o.averageKmh,
  busKmh: o.busKmh,
  stationHours: o.stationHours,
  localWithinKm: o.localWithinKm,
  oneWay: { ...o.oneWay },
  drive: { ...o.drive },
};

test('the list: every state and union territory, each row whole, credited; no island without a road', () => {
  assert.match(raw.source, /GeoNames \(CC BY 4\.0\)/);
  assert.match(raw.source, /datameet/);
  assert.deepEqual(raw.fields, ['name', 'state', 'lat', 'lng', 'population', 'station', 'altName']);
  assert.ok(raw.places.length >= 3400, `${raw.places.length} places`);
  assert.equal(new Set(raw.places.map((r) => r[1])).size, 36, 'all 36 states and union territories');
  const islands = raw.places.filter((r) => NO_ROAD_STATES.includes(r[1])).length;
  assert.equal(places.length, raw.places.length - islands, 'every other row is read');
  assert.equal(new Set(places.map((p) => p.state)).size, 34);
  for (const p of places) {
    assert.match(p.name, /^[A-Za-z0-9 .'-]+$/, p.name);
    assert.ok(p.station === '' || /^[A-Z]{1,5}$/.test(p.station), `${p.name}: ${p.station}`);
  }
  // Odd rows are left out, not trusted.
  assert.deepEqual(parsePlaces({ places: [['X', 'Kerala', 10, 76, 1, '', ''], ['Ok', 'Kerala', 99, 76, 1, '', ''], ['Okay', 'Kerala', 10, 76, 1, 'bad1', '']] }), []);
  assert.deepEqual(parsePlaces(null), []);
});

test('search: old names, today’s names, accents and case; prefix first; ours first', () => {
  assert.equal(names('Allahabad')[0], 'Prayagraj');
  assert.equal(searchPlaces(index, 'allahabad')[0].dest?.id, 'prayagraj', 'Prayagraj is one of ours: its measured km');
  assert.equal(names('Prayāgrāj')[0], 'Prayagraj', 'accents ignored');
  assert.equal(names('kochi')[0], 'Kochi');
  assert.equal(names('COCHIN')[0], 'Kochi');
  assert.equal(names('bangalore')[0], 'Bengaluru');
  assert.equal(names('Mysore')[0], 'Mysuru');
  assert.equal(names('gurgaon')[0], 'Gurugram');
  // Names that begin with it before names it is inside; ours first among them.
  const nag = searchPlaces(index, 'nag');
  assert.equal(nag[0].dest?.id, 'nagpur');
  assert.ok(nag.slice(1).every((e) => !e.dest));
  assert.ok(nag.every((e, i) => i === 0 || e.keys.name.startsWith('nag') || !nag.slice(i).some((x) => x.keys.name.startsWith('nag'))));
  // Typing a state lists its places, biggest first.
  const kerala = searchPlaces(index, 'Kerala');
  assert.equal(kerala.length, 20, 'at most 20');
  assert.ok(kerala.every((e) => e.state === 'Kerala'));
  assert.ok(['Kochi', 'Thiruvananthapuram', 'Kozhikode'].every((n) => kerala.slice(0, 5).some((e) => e.name === n)));
  const cg = searchPlaces(index, 'chhattisgarh');
  assert.ok(cg.slice(0, 8).every((e) => e.dest), 'our Chhattisgarh destinations first');
  // Our places appear once (Raj-Nandgaon in the list is our Rajnandgaon).
  assert.deepEqual(names('rajnand'), ['Rajnandgaon']);
  assert.equal(index.filter((e) => e.dest).length, destinations.length);
  assert.ok(index.filter((e) => e.dest).every((e) => e.state), 'each of ours has its state');
  assert.deepEqual(names('x'), [], 'two letters at least');
  assert.equal(plainText('  Prayag-Rāj  '), 'prayag raj');
});

test('km from the map: the straight line × outstation.roadFactor — Raipur → Ambikapur within 15% of the measured 334 km', () => {
  const raipur = findDestination('raipur');
  const km = (name) => placeKm(raipur, places.find((p) => p.name === name), ROAD);
  assert.equal(ROAD, 1.3);
  const withFactor = (roadFactor) => ({ ...settings, outstation: { ...settings.outstation, roadFactor } });
  assert.doesNotThrow(() => checkSettings(withFactor(1.25)));
  for (const bad of [0.9, 2.5, Number.NaN]) assert.throws(() => checkSettings(withFactor(bad)), /roadFactor/);
  assert.ok(readFileSync(new URL('../app/app-config.json/route.ts', import.meta.url), 'utf8').includes('roadFactor: outstation.roadFactor'));
  const ambikapur = km('Ambikapur');
  assert.equal(ambikapur, 342);
  assert.ok(Math.abs(ambikapur - 334) / 334 < 0.15, `${ambikapur} km`);
  // Others of ours, for scale: Ranchi (measured 616), Prayagraj (578), Bengaluru (1,370).
  for (const [name, measured] of [['Ranchi', 616], ['Prayagraj', 578], ['Bengaluru', 1370], ['Varanasi', findDestination('varanasi').fromRaipur.road]])
    assert.ok(Math.abs(km(name) - measured) / measured < 0.15, `${name}: ${km(name)} vs ${measured}`);
});

/** firestore.rules isTrip (kept in step; tests/rules checks the rules themselves). */
const isTrip = (t, pkg) =>
  typeof t.to === 'string' && t.to.length >= 2 && t.to.length <= 60 &&
  /^[a-z]{0,30}$/.test(t.destId) &&
  ((pkg === 'outstation' && t.kind === 'round') || (pkg === 'one-way-drop' && t.kind === 'one-way')) &&
  Number.isInteger(t.km) && t.km >= 0 && t.km <= 5000 &&
  Number.isInteger(t.days) && t.days >= 1 && t.days <= 60 &&
  Number.isInteger(t.returnHours) && t.returnHours >= 0 && t.returnHours <= 200 && (t.kind === 'one-way' || t.returnHours === 0) &&
  Number.isInteger(t.estFrom) && t.estFrom >= 0 && t.estFrom <= 1000000 &&
  Number.isInteger(t.estTo) && t.estTo >= t.estFrom && t.estTo <= 1000000;

test('a booking to any place in India, from every pickup city, has the shape the rules accept, priced by the km', () => {
  let n = 0;
  for (const city of pickupCities) {
    const from = findDestination(city.toLowerCase());
    for (const p of places) {
      if (index.find((e) => e.place === p) === undefined) continue; // one of ours: as before
      const km = placeKm(from, p, ROAD);
      if (km < settings.outstation.localWithinKm) continue; // the form offers a local package instead
      for (const [pkg, kind] of [['one-way-drop', 'one-way'], ['outstation', 'round']]) {
        // As lib/trip.ts tripFor plans a place from the map: its km, the bus/train average home.
        const plan = planTrip(rules, km, kind, 0, {}, 7, false);
        const est = estimate(rules, plan);
        const t = { to: placeLabel(p), destId: '', kind, km, days: plan.days, returnHours: plan.returnHours, estFrom: est.from, estTo: est.to };
        assert.ok(isTrip(t, pkg), `${city} → ${t.to}: ${JSON.stringify(t)}`);
        if (kind === 'one-way' && km > settings.prices.outstationNear[0].upToKm) {
          assert.ok(est.long, `${t.to}: by the km`);
          assert.equal(est.long.drive, driveCharge(settings.outstation.oneWay, km));
        }
        n++;
      }
    }
  }
  assert.ok(n > 20000, `${n} trips`);
  // An example: Raipur → Gaya, Bihar (not one of ours).
  const gaya = places.find((p) => p.name === 'Gaya' && p.state === 'Bihar');
  const km = placeKm(findDestination('raipur'), gaya, ROAD);
  const est = estimate(rules, planTrip(rules, km, 'one-way', 0, {}, 7, false));
  // 1,500 + 300 × 2.50 + 181 × 3.25 = 2,838.25 for the drive.
  assert.deepEqual([placeLabel(gaya), km, est.long.drive], ['Gaya, Bihar', 681, 2838.25]);
  assert.equal(placeStation(gaya), 'GAYA');
});

test('our destinations keep their measured km; renamed station codes go to the lookup as today’s', () => {
  for (const city of pickupCities)
    for (const d of destinations) {
      const e = index.find((x) => x.dest === d);
      assert.ok(e, d.id);
      assert.equal(roadKm(city, e.dest), roadKm(city, d));
    }
  assert.equal(placeStation({ station: 'ALD' }), 'PRYJ');
  assert.equal(placeStation({ station: 'MGS' }), 'DDU');
  assert.equal(placeStation({ station: 'RNC' }), 'RNC');
  assert.equal(placeStation({ station: '' }), '');
  assert.ok(Object.values(RENAMED_STATIONS).every((c) => /^[A-Z]{1,5}$/.test(c)), 'the robot takes 1–5 capital letters');
  // Labels fit the booking's trip.to (2–60 characters).
  assert.ok(places.every((p) => placeLabel(p).length >= 2 && placeLabel(p).length <= 60));
});

test('the place list is loaded only when asked for: not imported by any page or component', () => {
  for (const f of ['components/PlacePicker.tsx', 'components/BookingForm.tsx', 'components/OneWayPriceChecker.tsx', 'lib/places.ts', 'lib/trip.ts']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/india-places\.json['"]/.test(src.replace(/PLACES_PATH = '\/data\/india-places\.json'/, '')), `${f} imports the list`);
  }
  const picker = readFileSync(new URL('../components/PlacePicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /fetch\(asset\(PLACES_PATH\)\)/, 'fetched at run time');
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /aria-activedescendant/);
  assert.match(picker, /Places: GeoNames \(CC BY 4\.0\) · Stations: datameet \(CC0\)/);
});
