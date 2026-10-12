/**
 * The one-tap "driver assigned" WhatsApp from /admin, in both languages.
 * Imports the TypeScript file directly (Node strips the types).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { driverAssignedMessage } from '../lib/customer-messages.ts';

const input = {
  customerName: 'Ramesh Kumar Sahu',
  bookingRef: 'DB-1042',
  driverName: 'Suresh Verma',
  driverPhone: '+91 98933 02783',
  when: 'Thu, 8 Oct, 3:30 pm',
  pickup: 'Shankar Nagar, Raipur',
  helpPhone: '+91 91114 73929',
};

test('English: everything the customer needs, nothing more', () => {
  assert.equal(
    driverAssignedMessage(input, 'en'),
    [
      'Hello Ramesh,',
      'Your DriveBuddy driver for booking DB-1042 is confirmed.',
      '',
      'Driver: Suresh Verma',
      'Mobile: +91 98933 02783',
      'Time: Thu, 8 Oct, 3:30 pm',
      'Pickup: Shankar Nagar, Raipur',
      '',
      'Suresh will call you before reaching. Any questions? Call or WhatsApp us on +91 91114 73929.',
      '— DriveBuddy',
    ].join('\n'),
  );
});

test('Hindi carries the same details', () => {
  const text = driverAssignedMessage(input, 'hi');
  for (const part of ['नमस्ते Ramesh,', 'DB-1042', 'Suresh Verma', '+91 98933 02783', 'Thu, 8 Oct, 3:30 pm', 'Shankar Nagar, Raipur', '+91 91114 73929']) {
    assert.ok(text.includes(part), part);
  }
});

test('a booking not numbered yet still reads naturally', () => {
  assert.ok(driverAssignedMessage({ ...input, bookingRef: '' }, 'en').includes('Your DriveBuddy driver is confirmed.'));
});
