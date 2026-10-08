import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bookingEmail,
  bookingRef,
  bookingTelegram,
  escapeHtml,
  formatIst,
  formatWhen,
  packageName,
  prettyPhone,
} from '../lib/format.js';

const booking = {
  name: 'Ramesh <b>Sahu</b>',
  phone: '9111473929',
  city: 'Raipur',
  package: '3-hours-600',
  pickup: 'Shankar Nagar, near Ambuja Mall',
  preferredTime: '2026-10-08T15:30',
  notes: '',
};
const ctx = { booking, id: 'abc123', ref: 'DB-1042', isReturning: false, previousBookings: 0, siteUrl: 'https://thedrivebuddy.in' };

test('booking references start at DB-1001', () => {
  assert.equal(bookingRef(1), 'DB-1001');
  assert.equal(bookingRef(42), 'DB-1042');
});

test('phone numbers print in tap-to-call form', () => {
  assert.equal(prettyPhone('9111473929'), '+91 91114 73929');
  assert.equal(prettyPhone('+919111473929'), '+91 91114 73929');
});

test('preferred time is read as India time, not shifted through UTC', () => {
  assert.equal(formatWhen('2026-10-08T15:30'), 'Thu 8 Oct, 3:30 PM');
  assert.equal(formatWhen('2026-10-09T00:05'), 'Fri 9 Oct, 12:05 AM');
  assert.equal(formatWhen(''), 'As soon as possible');
  assert.equal(formatWhen('tomorrow morning'), 'tomorrow morning');
});

test('server timestamps print in India time', () => {
  // 2026-10-08 10:00 UTC = 3:30 PM IST
  assert.equal(formatIst(Date.UTC(2026, 9, 8, 10, 0)), 'Thu 8 Oct, 3:30 PM');
});

test('customer text cannot inject Telegram or email markup', () => {
  const tg = bookingTelegram(ctx);
  assert.ok(tg.text.includes('Ramesh &lt;b&gt;Sahu&lt;/b&gt;'));
  assert.ok(!tg.text.includes('<b>Sahu</b>'));
  const em = bookingEmail(ctx);
  assert.ok(em.html.includes('Ramesh &lt;b&gt;Sahu&lt;/b&gt;'));
  assert.equal(escapeHtml('"&'), '&quot;&amp;');
});

test('telegram alert carries the essentials and working buttons', () => {
  const tg = bookingTelegram(ctx);
  for (const s of ['DB-1042', '+91 91114 73929', 'Raipur', '3 hours', 'Shankar Nagar', 'Thu 8 Oct, 3:30 PM', 'New customer'])
    assert.ok(tg.text.includes(s), s);
  const [[admin], [wa]] = tg.reply_markup.inline_keyboard;
  assert.equal(admin.url, 'https://thedrivebuddy.in/admin/?b=abc123');
  assert.ok(wa.url.startsWith('https://wa.me/919111473929?text='));
});

test('emergencies are flagged first', () => {
  const urgent = { ...ctx, booking: { ...booking, package: 'medical-emergency' } };
  assert.ok(bookingTelegram(urgent).text.startsWith('🚨'));
  assert.ok(bookingEmail(urgent).subject.startsWith('[PRIORITY]'));
});

test('returning customers are called out', () => {
  const t = bookingTelegram({ ...ctx, isReturning: true, previousBookings: 2 }).text;
  assert.ok(t.includes('Returning customer (2 earlier bookings)'));
});

test('unknown package ids still render', () => {
  assert.equal(packageName('night-driver'), 'Night driver (8 PM – 6 AM)');
  assert.equal(packageName('something-new'), 'something-new');
});
