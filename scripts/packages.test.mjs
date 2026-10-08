/**
 * The booking package ids live in four places that cannot import each other:
 * the form (lib/content.ts), the security rules, the website's names
 * (lib/bookings.ts) and the alerts robot's names (apps-script/Code.js).
 * If one gains or loses a package, bookings either fail to save or alert as
 * a raw id. This test makes that a build failure instead.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Code.js is a plain Apps Script file; it exports for Node only when `module` exists.
const { PACKAGE_NAMES: SERVER_NAMES } = createRequire(import.meta.url)('../apps-script/Code.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const rulesIds = (() => {
  const block = read('firestore.rules').match(/request\.resource\.data\.package in \[([\s\S]*?)\]/);
  assert.ok(block, 'package list not found in firestore.rules');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
})();

const formIds = (() => {
  const block = read('lib/content.ts').match(/export const bookingPackages = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'bookingPackages not found in lib/content.ts');
  return [...block[1].matchAll(/\{ value: '([^']+)', label:/g)].map((m) => m[1]).sort();
})();

const siteIds = (() => {
  const block = read('lib/bookings.ts').match(/export const PACKAGE_NAMES[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'PACKAGE_NAMES not found in lib/bookings.ts');
  return [...block[1].matchAll(/^\s*'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]).sort();
})();

test('the booking form offers exactly the packages the rules accept', () => {
  assert.deepEqual(formIds, rulesIds);
});

test('the website and the alerts robot name every package', () => {
  assert.deepEqual(siteIds, rulesIds);
  assert.deepEqual(Object.keys(SERVER_NAMES).sort(), rulesIds);
});
