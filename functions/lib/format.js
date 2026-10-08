/**
 * Pure formatting for alerts. No Firebase imports, so it is unit-tested directly
 * (functions/test/format.test.js) and the triggers stay thin.
 */

/**
 * Package ids → short names for alerts and the admin panel.
 *
 * The ids are the values firestore.rules accepts and never change when a price
 * does. Names carry no prices on purpose: an alert about a booking made last
 * month must not quote this month's rate. scripts/packages.test.mjs fails the
 * build if this list drifts from firestore.rules or lib/bookings.ts.
 */
export const PACKAGE_NAMES = {
  '1-hour-300': '1 hour',
  '3-hours-600': '3 hours',
  'local-full-day': 'Local full day (8 hrs)',
  outstation: 'Outstation trip',
  'night-driver': 'Night driver (8 PM – 6 AM)',
  'medical-emergency': 'Hospital / emergency',
  'monthly-basic': 'Monthly driver – Basic',
  'monthly-premium': 'Monthly driver – Premium',
  'wedding-event': 'Wedding / event',
  'one-way-drop': 'One-way car drop',
};

export const packageName = (id) => PACKAGE_NAMES[id] ?? String(id ?? '—');

/** 42 → "DB-1042". Four digits from the start, so references sort as text too. */
export const bookingRef = (n) => `DB-${1000 + n}`;

/** "9111473929" → "+91 91114 73929" */
export function prettyPhone(p) {
  const d = String(p ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : String(p ?? '');
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The form's preferred time is the customer's own clock (India), written as
 * "2026-10-08T15:30" with no zone. Read the digits as they are — converting
 * through a Date in the server's UTC zone would shift every time by 5½ hours.
 */
export function formatWhen(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return 'As soon as possible';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return s;
  const [, y, mo, d, h, mi] = m.map(Number);
  const day = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const hour12 = ((h + 11) % 12) + 1;
  return `${day} ${d} ${MONTHS[mo - 1]}, ${hour12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A Firestore Timestamp, Date or millis → "Wed 8 Oct, 3:30 PM" in India time. */
export function formatIst(value) {
  const ms =
    value && typeof value.toMillis === 'function'
      ? value.toMillis()
      : value instanceof Date
        ? value.getTime()
        : Number(value);
  if (!Number.isFinite(ms)) return '';
  const ist = new Date(ms + 330 * 60 * 1000);
  const h = ist.getUTCHours();
  const mi = ist.getUTCMinutes();
  return `${DAYS[ist.getUTCDay()]} ${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}, ${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function waLink(phone, text) {
  const d = String(phone ?? '').replace(/\D/g, '').slice(-10);
  return `https://wa.me/91${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/**
 * Telegram message for a new booking, in Telegram's HTML mode.
 * The phone number is written in +91 form so Telegram turns it into a tap-to-call link.
 */
export function bookingTelegram({ booking, id, ref, isReturning, previousBookings, siteUrl }) {
  const urgent = booking.package === 'medical-emergency';
  const lines = [
    `${urgent ? '🚨 <b>PRIORITY – hospital / emergency</b>\n' : ''}🚗 <b>New booking ${escapeHtml(ref)}</b>`,
    '',
    `<b>Name:</b> ${escapeHtml(booking.name)}`,
    `<b>Phone:</b> ${escapeHtml(prettyPhone(booking.phone))}`,
    `<b>City:</b> ${escapeHtml(booking.city)}`,
    `<b>Package:</b> ${escapeHtml(packageName(booking.package))}`,
    `<b>Pickup:</b> ${escapeHtml(booking.pickup)}`,
    `<b>When:</b> ${escapeHtml(formatWhen(booking.preferredTime))}`,
  ];
  if (booking.notes) lines.push(`<b>Notes:</b> ${escapeHtml(booking.notes)}`);
  lines.push(
    '',
    isReturning
      ? `🔁 Returning customer (${previousBookings} earlier booking${previousBookings === 1 ? '' : 's'})`
      : '🆕 New customer',
  );
  if (booking.customerUid) lines.push('👤 Booked while logged in');

  const greeting = `Hi ${booking.name}, this is DriveBuddy about your booking ${ref}. `;
  return {
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Open in admin panel', url: `${siteUrl}/admin/?b=${encodeURIComponent(id)}` }],
        [{ text: 'WhatsApp customer', url: waLink(booking.phone, greeting) }],
      ],
    },
  };
}

export function bookingEmail({ booking, id, ref, isReturning, previousBookings, siteUrl }) {
  const rows = [
    ['Reference', ref],
    ['Name', booking.name],
    ['Phone', prettyPhone(booking.phone)],
    ['City', booking.city],
    ['Package', packageName(booking.package)],
    ['Pickup', booking.pickup],
    ['When', formatWhen(booking.preferredTime)],
    ['Notes', booking.notes || '—'],
    ['Customer', isReturning ? `Returning (${previousBookings} earlier)` : 'New customer'],
  ];
  const adminUrl = `${siteUrl}/admin/?b=${encodeURIComponent(id)}`;
  const urgent = booking.package === 'medical-emergency';

  return {
    subject: `${urgent ? '[PRIORITY] ' : ''}New booking ${ref} – ${booking.name}, ${booking.city} (${packageName(booking.package)})`,
    text: [...rows.map(([k, v]) => `${k}: ${v}`), '', `Open in admin panel: ${adminUrl}`].join('\n'),
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">
<h2 style="margin:0 0 12px">${urgent ? 'PRIORITY – ' : ''}New booking ${escapeHtml(ref)}</h2>
<table cellpadding="6" style="border-collapse:collapse">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="color:#666;vertical-align:top">${escapeHtml(k)}</td><td><b>${escapeHtml(v)}</b></td></tr>`,
      )
      .join('')}</table>
<p style="margin-top:16px"><a href="tel:+91${escapeHtml(String(booking.phone).slice(-10))}">Call customer</a> &nbsp;·&nbsp;
<a href="${escapeHtml(waLink(booking.phone))}">WhatsApp</a> &nbsp;·&nbsp;
<a href="${escapeHtml(adminUrl)}">Open in admin panel</a></p></div>`,
  };
}

export function driverTelegram({ driver, siteUrl }) {
  return {
    text: [
      '🧑‍✈️ <b>New driver application</b>',
      '',
      `<b>Name:</b> ${escapeHtml(driver.name)}`,
      `<b>Phone:</b> ${escapeHtml(prettyPhone(driver.phone))}`,
      `<b>City:</b> ${escapeHtml(driver.city)}`,
      `<b>Experience:</b> ${escapeHtml(driver.experienceYears)} years`,
      `<b>Licence:</b> ${escapeHtml(driver.licence)}`,
      driver.about ? `<b>About:</b> ${escapeHtml(driver.about)}` : null,
    ]
      .filter((l) => l !== null)
      .join('\n'),
    reply_markup: {
      inline_keyboard: [[{ text: 'Open drivers in admin panel', url: `${siteUrl}/admin/?tab=drivers` }]],
    },
  };
}

export function driverEmail({ driver, siteUrl }) {
  const text = [
    `Name: ${driver.name}`,
    `Phone: ${prettyPhone(driver.phone)}`,
    `City: ${driver.city}`,
    `Experience: ${driver.experienceYears} years`,
    `Licence: ${driver.licence}`,
    `About: ${driver.about || '—'}`,
    '',
    `Open in admin panel: ${siteUrl}/admin/?tab=drivers`,
  ].join('\n');
  return { subject: `New driver application – ${driver.name}, ${driver.city}`, text };
}

export function reminderTelegram({ booking, id, minutes, siteUrl }) {
  return {
    text: `⏰ <b>Not handled yet: ${escapeHtml(booking.ref ?? id)}</b>\n${escapeHtml(booking.name)}, ${escapeHtml(
      prettyPhone(booking.phone),
    )} – waiting ${minutes} min.\nCall the customer, then mark it Confirmed in the admin panel.`,
    reply_markup: {
      inline_keyboard: [[{ text: 'Open in admin panel', url: `${siteUrl}/admin/?b=${encodeURIComponent(id)}` }]],
    },
  };
}
