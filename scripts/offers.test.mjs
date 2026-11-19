/** Job offers (lib/offers.ts): what the driver earns, DriveBuddy's cut, and the area drivers see. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { CUT, clampCut, driverPayFor, offerArea } from '../lib/offers.ts';
import { settings } from '../site-settings.ts';

test("the cut is the quote calculator's band: 25% usually, never outside 20–30%", () => {
  const o = settings.outstation;
  assert.deepEqual({ ...CUT }, { min: o.minProfitPercent, max: o.maxProfitPercent, default: o.targetProfitPercent });
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.ok(rules.includes(`o.cutPercent >= ${CUT.min} && o.cutPercent <= ${CUT.max}`), 'firestore.rules allows the same band');
  assert.equal(clampCut(15), 20);
  assert.equal(clampCut(35), 30);
  assert.equal(clampCut(24.6), 25);
  assert.equal(clampCut(NaN), 25);
});

test('the driver earns the price minus the cut, rounded down to ₹10', () => {
  assert.equal(driverPayFor(600, 25), 450);
  assert.equal(driverPayFor(1000, 20), 800);
  assert.equal(driverPayFor(1350, 30), 940); // 945 → 940: the ₹5 stays with DriveBuddy
  assert.equal(driverPayFor(1350, 50), 940, 'a cut outside the band is clamped');
  for (const price of [100, 333, 1999, 17500]) {
    const pay = driverPayFor(price, 25);
    assert.ok(pay > 0 && pay < price && pay % 10 === 0, `${price} → ${pay}`);
  }
});

test('drivers see the area, never the house number', () => {
  assert.equal(offerArea('12, Shankar Nagar, Raipur'), 'Shankar Nagar, Raipur');
  assert.equal(offerArea('Telibandha'), 'Telibandha');
  assert.equal(offerArea('  Flat 4B ,  VIP Road ,, Raipur '), 'VIP Road, Raipur');
  assert.equal(offerArea('x, ' + 'a'.repeat(200)).length, 120);
});
