/**
 * DriveBuddy alerts robot — Google Apps Script, free, no card needed.
 *
 * Lives inside a Google Sheet ("DriveBuddy Bookings") and runs on Google's
 * servers every minute, even when every laptop and phone is off:
 *
 *   • new booking   → reference number (DB-1042), customer record, timeline entry,
 *                     Telegram message + email
 *   • new driver    → Telegram message + email
 *   • every minute  → the "Bookings" and "Drivers" sheets are brought up to date:
 *                     new rows on top, and status / driver changes made in the
 *                     admin panel copied over — so the Sheet is a live copy you
 *                     can filter, sort and download like Excel
 *   • every 5 min   → a booking still "New" after 10 minutes gets one reminder
 *   • status change → the customer hears about it: a phone notification in the
 *                     DriveBuddy app (confirmed, driver assigned, completed,
 *                     cancelled), and — once WhatsApp is set up — a WhatsApp
 *                     message when a driver is assigned
 *   • trip clock    → when a driver taps Start, Car dropped or Home on his trip
 *                     link, the time is copied to the booking (the customer
 *                     sees it) and Telegram hears about it
 *
 * It reads and writes Firestore through the REST API as the Google account that
 * owns this script, so it must be the account that owns the Firebase project.
 * Every query here is on a single field, so Firestore needs no extra indexes.
 *
 * SETUP: docs/bookings-system.md, "One-time setup". In short: paste this file and
 * appsscript.json into Extensions → Apps Script, add the script properties, send
 * your Telegram bot a message, then run "setup" once.
 *
 * Script properties (Project Settings → Script properties):
 *   TELEGRAM_BOT_TOKEN   from @BotFather                         (required)
 *   ADMIN_EMAILS         Google account(s) for /admin, comma-sep   (default: this account)
 *   FIREBASE_PROJECT_ID  default drive-buddy-acc4c
 *   ALERT_EMAIL          where alert emails go; default: this account; "none" = off
 *   SITE_URL             default https://thedrivebuddy.in
 *   TELEGRAM_CHAT_ID     filled in by setup()
 *   EXPO_ACCESS_TOKEN    optional: only if "enhanced push security" is on in Expo
 *   WHATSAPP_TOKEN       optional: WhatsApp Cloud API access token — automatic
 *   WHATSAPP_PHONE_ID    "driver assigned" messages stay off until both are set
 *                        (docs/whatsapp.md)
 *   WHATSAPP_TEMPLATE    default driver_assigned
 *   WHATSAPP_LANGUAGE    default en (or hi — the language of the approved template)
 *   WHATSAPP_API_VERSION default v23.0
 *   RAILRADAR_API_KEY    optional: RailRadar key (railradar.in/developers) — the
 *                        booking estimate's real trains home. Off until set.
 *   RAIL_MINUTE_LIMIT    calls to RailRadar a minute, default 25 (Developer plan
 *                        allows 30; free sandbox: set 8)
 *   RAIL_DAILY_LIMIT     calls to RailRadar a day, default 900 (Developer plan:
 *                        30,000 a month; free sandbox: set 3)
 *   MC_CUSTOMER_ID       optional: Message Central VerifyNow login — the SMS codes
 *   MC_PASSWORD          for the Driver app. Driver login stays off until set.
 *   FIREBASE_SA_EMAIL    the Firebase service account's client_email and
 *   FIREBASE_SA_KEY      private_key: signs the driver's login (see "driver login")
 *   OTP_PER_PHONE        login codes per number in 24 hours, default 3
 *   OTP_DAILY_LIMIT      login codes a day in all, default 40
 *   AUTO_OFFERS          "off" stops automatic offers of confirmed bookings with a price
 *   AUTO_OFFER_CUTS      DriveBuddy's cut on an automatic offer, step by step while
 *                        nobody takes it, percent, default "30,25,20" (each 20–30)
 *   AUTO_OFFER_STEP_MIN  minutes at each step before the driver pay goes up, default 2
 *   REVIEW_PHONE         optional: a number that logs in to the Driver app with
 *   REVIEW_CODE          this fixed code and no SMS (for the Google Play reviewer)
 *   INSTANT_BOOKINGS     "off" stops the robot confirming simple bookings by itself
 *                        (logged-in 1 hour / 3 hours / 12 hours, or a trip price the customer
 *                        accepted in the app); then every booking waits for a call
 *   RAZORPAY_KEY_ID      optional: Razorpay API key id and secret — a payment link
 *   RAZORPAY_KEY_SECRET  goes to the customer when a job is completed with a bill.
 *                        Off until both are set. Never logged or sent anywhere else.
 *   UPI_ID               optional: DriveBuddy's own UPI ID (e.g. drivebuddy@ybl). Without
 *                        Razorpay keys, a completed job with a bill gets a UPI pay link
 *                        in the customer's app instead (no gateway, no fee); the driver
 *                        taps "Paid by UPI" / "Paid in cash" in the Driver app.
 *   UPI_NAME             the name on that UPI link, default DriveBuddy
 *   DRIVER_RATES         optional, private: what drivers are paid, as JSON
 *                        {"local8h":…,"local12h":…,"localExtraHour":…,"tripDay":…,"returnHour":…}
 *                        (whole rupees). Set only here, never in the code or GitHub. With it,
 *                        automatic full-day and trip offers pay the driver his rate (rateCardPayOf)
 *                        instead of the price minus a % cut. Missing or invalid: the % cut.
 *   CONFIRM_BY_CALL      "off" stops the Telegram that asks the office to call a driver
 *                        who took a job in the app (Confirmed ✓ / Give to someone else);
 *                        his take is then confirmed at once (driverConfirmed by 'auto')
 *   driverConfirmBackfill set to v1 by the robot after its one-time pass that confirms
 *                        jobs already assigned (delete it to run the pass again)
 *
 * Also automatic (see "automation" below): job reminders an hour before, the
 * Driver app's Start / Arrived / Job done taps (tripTaps), the bill and the end
 * of local jobs, the driver's "payment received" tap, a rating request,
 * Monday's driver payouts (what he earned minus the cash he kept) with a
 * Paid ✓ / Settled ✓ button, the cash limit (site-settings.ts
 * payments.cashLimit), a 9 pm report, and nearby drivers when a city has
 * nobody free.
 *
 * Your own columns are safe: the robot finds its columns by their heading, only
 * ever writes those, and leaves any column you add (e.g. "Paid?") alone.
 */

/* =============================================================== settings */

var DEFAULTS = {
  FIREBASE_PROJECT_ID: 'drive-buddy-acc4c',
  SITE_URL: 'https://thedrivebuddy.in',
  WHATSAPP_TEMPLATE: 'driver_assigned',
  WHATSAPP_LANGUAGE: 'en',
  WHATSAPP_API_VERSION: 'v23.0',
  UPI_NAME: 'DriveBuddy',
};

/* ============================================================ web calls
   Apps Script allows a free Gmail account 20,000 UrlFetch calls a day (each
   request inside fetchAll counts). Every call goes through fetch_ /
   fetchAll_, which count them (this run, and today in the fetchBudget
   property) and stop the run at the first "Service invoked too many times". */

var fetchCount_ = 0; // requests in this execution (Apps Script starts every run with fresh globals)
var quotaHit_ = false; // the daily quota answered "too many times": stop the run
var QUOTA_ERROR = /Service invoked too many times|Bandwidth quota exceeded/i;

function fetch_(url, opts) {
  if (quotaHit_) throw new Error('UrlFetch quota reached: stopped');
  fetchCount_++;
  try {
    return UrlFetchApp.fetch(url, opts);
  } catch (err) {
    if (QUOTA_ERROR.test(String((err && err.message) || err))) quotaHit_ = true;
    throw err;
  }
}

function fetchAll_(requests) {
  if (quotaHit_) throw new Error('UrlFetch quota reached: stopped');
  fetchCount_ += requests.length;
  try {
    return UrlFetchApp.fetchAll(requests);
  } catch (err) {
    if (QUOTA_ERROR.test(String((err && err.message) || err))) quotaHit_ = true;
    throw err;
  }
}

function prop_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v && v.trim()) || DEFAULTS[key] || '';
}

/* ======================================================= pure formatting
   No Apps Script services below this line until "Firestore REST" — these
   functions are unit-tested in Node (scripts/alerts-script.test.mjs). */

/**
 * Package ids → short names. Ids are what firestore.rules accepts; names carry
 * no prices, so an old booking never quotes today's rate.
 * scripts/packages.test.mjs keeps this in step with the rules and the website.
 */
var PACKAGE_NAMES = {
  '1-hour-300': '1 hour',
  '3-hours-600': '3 hours',
  'local-full-day': 'Local full day (8 hrs)',
  'local-12-hours': '12 hours in the city',
  outstation: 'Outstation trip',
  'night-driver': 'Night driver (8 PM – 6 AM)',
  'medical-emergency': 'Hospital / emergency',
  'monthly-basic': 'Monthly driver – Basic',
  'monthly-premium': 'Monthly driver – Premium',
  'wedding-event': 'Wedding / event',
  'one-way-drop': 'One-way car drop',
};

/** Same words as the admin panel (lib/bookings.ts), so Sheet filters match what you see there. */
var BOOKING_STATUS_LABELS = {
  new: 'New',
  confirmed: 'Confirmed',
  assigned: 'Driver assigned',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

var DRIVER_STATUS_LABELS = {
  new: 'Applied',
  verified: 'Verified',
  active: 'Active',
  inactive: 'Inactive',
  rejected: 'Rejected',
};

var LICENCE_LABELS = { commercial: 'Commercial', lmv: 'LMV (private car)', both: 'Commercial + LMV' };

function packageName(id) {
  return PACKAGE_NAMES[id] || String(id == null ? '—' : id);
}

/** 2450 → "2,450"; 125000 → "1,25,000" (Indian grouping). */
function inr(n) {
  var d = String(Math.max(0, Math.round(Number(n) || 0)));
  if (d.length <= 3) return d;
  return d.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + d.slice(-3);
}

/**
 * The trip on an outstation booking or one-way drop, in one line:
 * "Raipur → Delhi · one-way drop · ~1214 km · 3 days + 11 h getting home · est. ₹5,550–6,150"
 * The estimate is what the customer was shown on the form; the team quotes the
 * exact price on the call. '' when the booking has no trip.
 */
function tripLine(b) {
  var t = b && b.trip;
  if (!t || typeof t !== 'object' || !t.to) return '';
  var plural = function (n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); };
  // No id: a place from the list of all India (its km from the map), or one typed in (no km: priced on the call).
  var parts = [String(b.city || '?') + ' → ' + String(t.to) + (t.destId ? '' : t.km > 0 ? ' (km from the map)' : ' (not in our list)')];
  parts.push(t.kind === 'round' ? 'round trip' : 'one-way drop');
  if (t.km > 0) parts.push('~' + t.km + ' km');
  // returnHours: one-way, hours from the drop until the driver is home (waiting included).
  parts.push(plural(t.days, 'day') + (t.kind !== 'round' && t.returnHours > 0 ? ' + ' + t.returnHours + ' h getting home' : ''));
  parts.push(t.estFrom > 0
    ? 'est. ₹' + inr(t.estFrom) + (t.estTo > t.estFrom ? '–' + inr(t.estTo) : '')
    : 'quote on the call');
  return parts.join(' · ');
}

/** 42 → "DB-1042" */
function bookingRef(n) {
  return 'DB-' + (1000 + n);
}

/** "9111473929" → "+91 91114 73929" (Telegram makes this tap-to-call) */
function prettyPhone(p) {
  var d = String(p == null ? '' : p).replace(/\D/g, '').slice(-10);
  return d.length === 10 ? '+91 ' + d.slice(0, 5) + ' ' + d.slice(5) : String(p == null ? '' : p);
}

/** "9111473929" → "91114 73929": readable in a cell, and Sheets keeps it as text (no 9.11E+09, no formula). */
function sheetPhone(p) {
  var d = String(p == null ? '' : p).replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : String(p == null ? '' : p);
}

/** Customer text goes into cells as text, never as a formula. */
function sheetText(s) {
  var t = String(s == null ? '' : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The form's "2026-10-08T15:30" is the customer's own (India) clock — read the digits as they are. */
function formatWhen(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return 'As soon as possible';
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return s;
  var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  var day = DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return day + ' ' + d + ' ' + MONTHS[mo - 1] + ', ' + (((h + 11) % 12) + 1) + ':' + ('0' + mi).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM');
}

/** A Date → "Thu 8 Oct, 3:30 PM" in India time, whatever the script's time zone. */
function formatIst(date) {
  if (!date) return '';
  var ist = new Date(date.getTime() + 330 * 60 * 1000);
  var h = ist.getUTCHours(), mi = ist.getUTCMinutes();
  return DAYS[ist.getUTCDay()] + ' ' + ist.getUTCDate() + ' ' + MONTHS[ist.getUTCMonth()] + ', ' + (((h + 11) % 12) + 1) + ':' + ('0' + mi).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM');
}

function waLink(phone, text) {
  var d = String(phone == null ? '' : phone).replace(/\D/g, '').slice(-10);
  return 'https://wa.me/91' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}

/* ------------------------------------------------------------ sheet rows */

/** The robot's columns, by heading. Order here is only the order for a brand-new sheet. */
var BOOKING_COLUMNS = ['Ref', 'Status', 'Booked at', 'Customer', 'Phone', 'City', 'Package', 'Pickup', 'Pickup map', 'Trip time',
  'Driver', 'Driver phone', 'Customer notes', 'Customer type', 'Last update', 'ID'];

var DRIVER_COLUMNS = ['Name', 'Status', 'Phone', 'City', 'Experience (years)', 'Licence', 'Applied at', 'About',
  'Admin note', 'Last update', 'ID'];

/**
 * The customer's pinned pickup spot (website lib/geo.ts, firestore.rules
 * isGeo) as a Google Maps link, or '' when there is none or it is odd.
 */
function pickupMapLink(b) {
  var g = b && b.pickupGeo;
  if (!g || typeof g.lat !== 'number' || typeof g.lng !== 'number') return '';
  if (g.lat < 6 || g.lat > 37 || g.lng < 68 || g.lng > 98) return '';
  return 'https://www.google.com/maps?q=' + g.lat + ',' + g.lng;
}

/** "±15 m" for a GPS fix, "pinned on the map" for a pin placed by hand. */
function pickupMapNote(b) {
  var acc = b && b.pickupGeo && b.pickupGeo.acc;
  return typeof acc === 'number' ? '±' + Math.round(acc) + ' m' : 'pinned on the map';
}

/** A booking document → { heading: cell value }. Dates stay Dates so the Sheet can sort and filter by them. */
function bookingRecord(id, b) {
  var driver = b.assignedDriver || null;
  var notes = b.notes || '';
  var trip = tripLine(b);
  if (trip) notes = 'Trip: ' + trip + (notes ? ' | ' + notes : '');
  if (b.status === 'cancelled' && b.cancelReason) notes = (notes ? notes + ' | ' : '') + 'Cancelled: ' + b.cancelReason;
  return {
    Ref: b.ref || '',
    Status: BOOKING_STATUS_LABELS[b.status] || b.status || 'New',
    'Booked at': b.createdAt || '',
    Customer: sheetText(b.name),
    Phone: sheetPhone(b.phone),
    City: sheetText(b.city),
    Package: packageName(b.package),
    Pickup: sheetText(b.pickup),
    'Pickup map': pickupMapLink(b),
    'Trip time': formatWhen(b.preferredTime),
    Driver: driver ? sheetText(driver.name) : '',
    'Driver phone': driver ? sheetPhone(driver.phone) : '',
    'Customer notes': sheetText(notes),
    'Customer type': (b.isReturning ? 'Returning' : 'New') + (b.customerUid ? ' · logged in' : ''),
    'Last update': b.updatedAt || b.createdAt || '',
    ID: id,
  };
}

function driverRecord(id, d) {
  return {
    Name: sheetText(d.name),
    Status: DRIVER_STATUS_LABELS[d.status] || d.status || 'Applied',
    Phone: sheetPhone(d.phone),
    City: sheetText(d.city),
    'Experience (years)': d.experienceYears == null ? '' : d.experienceYears,
    Licence: LICENCE_LABELS[d.licence] || d.licence || '',
    'Applied at': d.createdAt || '',
    About: sheetText(d.about),
    'Admin note': sheetText(d.adminNote),
    'Last update': d.updatedAt || d.createdAt || '',
    ID: id,
  };
}

/** 1 → "A", 27 → "AA" */
function columnLetter(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ------------------------------------------------------------ messages */

function bookingTelegram(c) {
  var b = c.booking;
  var urgent = b.package === 'medical-emergency';
  var lines = [
    (urgent ? '🚨 <b>PRIORITY – hospital / emergency</b>\n' : '') + '🚗 <b>New booking ' + escapeHtml(c.ref) + '</b>',
    '',
    '<b>Name:</b> ' + escapeHtml(b.name),
    '<b>Phone:</b> ' + escapeHtml(prettyPhone(b.phone)),
    '<b>City:</b> ' + escapeHtml(b.city),
    '<b>Package:</b> ' + escapeHtml(packageName(b.package)),
    '<b>Pickup:</b> ' + escapeHtml(b.pickup),
  ];
  var map = pickupMapLink(b);
  if (map) lines.push('📍 <b>Pickup on the map:</b> <a href="' + escapeHtml(map) + '">Open in Google Maps</a> (' + escapeHtml(pickupMapNote(b)) + ')');
  lines.push('<b>When:</b> ' + escapeHtml(formatWhen(b.preferredTime)));
  var trip = tripLine(b);
  if (trip) lines.push('<b>Trip:</b> ' + escapeHtml(trip));
  if (b.notes) lines.push('<b>Notes:</b> ' + escapeHtml(b.notes));
  lines.push('', c.previousBookings > 0
    ? '🔁 Returning customer (' + c.previousBookings + ' earlier booking' + (c.previousBookings === 1 ? '' : 's') + ')'
    : '🆕 New customer');
  if (b.source === 'app') lines.push('📱 Booked in the DriveBuddy app');
  if (b.customerUid) lines.push('👤 Booked while logged in');
  if (c.autoConfirm) lines.push('⚡ <b>Auto-confirmed</b> — instant booking, no call needed. It goes to drivers now.');
  var greeting = 'Hi ' + b.name + ', this is DriveBuddy about your booking ' + c.ref + '. ';
  return {
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: (map ? [[{ text: '📍 Pickup on Google Maps', url: map }]] : []).concat([
        [{ text: 'Open in admin panel', url: c.siteUrl + '/admin/?b=' + encodeURIComponent(c.id) }],
        [{ text: 'WhatsApp customer', url: waLink(b.phone, greeting) }],
      ]),
    },
  };
}

function bookingEmail(c) {
  var b = c.booking;
  var urgent = b.package === 'medical-emergency';
  var rows = [
    ['Reference', c.ref],
    ['Name', b.name],
    ['Phone', prettyPhone(b.phone)],
    ['City', b.city],
    ['Package', packageName(b.package)],
    ['Pickup', b.pickup],
  ];
  if (pickupMapLink(b)) rows.push(['Pickup on the map', pickupMapLink(b) + ' (' + pickupMapNote(b) + ')']);
  rows.push(['When', formatWhen(b.preferredTime)]);
  var trip = tripLine(b);
  if (trip) rows.push(['Trip', trip]);
  rows.push(
    ['Notes', b.notes || '—'],
    ['Customer', c.previousBookings > 0 ? 'Returning (' + c.previousBookings + ' earlier)' : 'New customer']
  );
  var adminUrl = c.siteUrl + '/admin/?b=' + encodeURIComponent(c.id);
  return {
    subject: (urgent ? '[PRIORITY] ' : '') + 'New booking ' + c.ref + ' – ' + b.name + ', ' + b.city + ' (' + packageName(b.package) + ')',
    body: rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') + '\n\nOpen in admin panel: ' + adminUrl,
    htmlBody:
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><h2 style="margin:0 0 12px">' +
      (urgent ? 'PRIORITY – ' : '') + 'New booking ' + escapeHtml(c.ref) + '</h2><table cellpadding="6" style="border-collapse:collapse">' +
      rows.map(function (r) {
        return '<tr><td style="color:#666;vertical-align:top">' + escapeHtml(r[0]) + '</td><td><b>' + escapeHtml(r[1]) + '</b></td></tr>';
      }).join('') +
      '</table><p style="margin-top:16px"><a href="tel:+91' + escapeHtml(String(b.phone).slice(-10)) + '">Call customer</a> · ' +
      '<a href="' + escapeHtml(waLink(b.phone)) + '">WhatsApp</a> · <a href="' + escapeHtml(adminUrl) + '">Open in admin panel</a></p></div>',
  };
}

function driverTelegram(c) {
  var d = c.driver;
  return {
    text: [
      '🧑‍✈️ <b>New driver application</b>',
      '',
      '<b>Name:</b> ' + escapeHtml(d.name),
      '<b>Phone:</b> ' + escapeHtml(prettyPhone(d.phone)),
      '<b>City:</b> ' + escapeHtml(d.city),
      '<b>Experience:</b> ' + escapeHtml(d.experienceYears) + ' years',
      '<b>Licence:</b> ' + escapeHtml(LICENCE_LABELS[d.licence] || d.licence),
    ].concat(d.about ? ['<b>About:</b> ' + escapeHtml(d.about)] : []).join('\n'),
    reply_markup: { inline_keyboard: [[{ text: 'Open drivers in admin panel', url: c.siteUrl + '/admin/?tab=drivers' }]] },
  };
}

function reminderTelegram(c) {
  return {
    text: '⏰ <b>Not handled yet: ' + escapeHtml(c.booking.ref || c.id) + '</b>\n' + escapeHtml(c.booking.name) + ', ' +
      escapeHtml(prettyPhone(c.booking.phone)) + ' – waiting ' + c.minutes + ' min.\nCall the customer, then mark it Confirmed in the admin panel.',
    reply_markup: { inline_keyboard: [[{ text: 'Open in admin panel', url: c.siteUrl + '/admin/?b=' + encodeURIComponent(c.id) }]] },
  };
}

/* ----------------------------------------------------------- trip clock */

var TRIP_STEPS = ['start', 'drop', 'home'];

/** The times on a trip link → the booking's clock: { startAt, dropAt, homeAt }, only those there. */
function tripClockOf(link) {
  var c = {};
  TRIP_STEPS.forEach(function (s) { if (link[s + 'At']) c[s + 'At'] = link[s + 'At']; });
  return c;
}

/** The steps the new clock has that the booking's did not, in order. */
function tripClockNews(had, now) {
  had = had || {};
  return TRIP_STEPS.filter(function (s) { return now[s + 'At'] && !had[s + 'At']; });
}

function sameClock(a, b) {
  a = a || {};
  b = b || {};
  return TRIP_STEPS.every(function (s) {
    var x = a[s + 'At'], y = b[s + 'At'];
    return (!x && !y) || (x && y && x.getTime() === y.getTime());
  });
}

/** 104100000 ms → "28 h 55 m". */
function hoursText(ms) {
  var m = Math.max(0, Math.floor(ms / 60000));
  var h = Math.floor(m / 60);
  return h + ' h ' + (m - h * 60) + ' m';
}

function tripTelegram(c) {
  var l = c.link;
  var ref = escapeHtml((c.booking && c.booking.ref) || l.ref || c.id);
  var who = escapeHtml(l.driverName || 'The driver');
  var at = formatIst(l[c.step + 'At']);
  var text;
  if (c.step === 'start') {
    text = '🚗 <b>' + ref + ': trip started</b>\n' + who + ' left for ' + escapeHtml(l.to) + ' – ' + at;
  } else if (c.step === 'drop') {
    text = '📍 <b>' + ref + ': car dropped in ' + escapeHtml(l.to) + '</b>\n' + at +
      (l.startAt ? ' – ' + hoursText(l.dropAt.getTime() - l.startAt.getTime()) + ' after the start' : '') +
      '. ' + who + ' is on his way home.';
  } else {
    text = (l.kind === 'round' ? '🏁 <b>' + ref + ': trip over – ' + who + ' is back</b>' : '🏠 <b>' + ref + ': ' + who + ' is home</b>') +
      '\n' + at + '. The final bill is ready to check in the admin panel.';
  }
  return {
    text: text,
    reply_markup: { inline_keyboard: [[{ text: 'Open in admin panel', url: c.siteUrl + '/admin/?b=' + encodeURIComponent(c.id) }]] },
  };
}

/* ------------------------------------------------------ customer updates */

/**
 * What each status change has told the customer, e.g. "assigned:drv7". A new
 * driver on the same booking is a new key, so the customer hears about it.
 */
function updateKey(b) {
  var d = b.assignedDriver;
  return String(b.status || '') + (b.status === 'assigned' && d ? ':' + (d.id || d.phone || d.name) : '');
}

var PUSH_TEXT = {
  en: {
    confirmed: function (c) { return { title: 'Booking confirmed', body: c.ref + ': we are choosing your driver. You will get their name and number here.' }; },
    assigned: function (c) { return { title: 'Driver assigned', body: c.driver + ' will drive for ' + c.ref + '. Tap to see the details and call.' }; },
    completed: function (c) { return { title: 'Trip completed', body: 'Thank you for choosing DriveBuddy. We hope to drive for you again soon.' }; },
    cancelled: function (c) { return { title: 'Booking cancelled', body: c.ref + ' was cancelled. Need a driver? Book again any time.' }; },
  },
  hi: {
    confirmed: function (c) { return { title: 'बुकिंग कन्फ़र्म', body: c.ref + ': हम आपका ड्राइवर चुन रहे हैं। उनका नाम और नंबर यहीं मिलेगा।' }; },
    assigned: function (c) { return { title: 'ड्राइवर तय हो गया', body: c.ref + ' के लिए ' + c.driver + ' आएँगे। जानकारी और कॉल के लिए टैप करें।' }; },
    completed: function (c) { return { title: 'ट्रिप पूरी हुई', body: 'DriveBuddy चुनने के लिए धन्यवाद। फिर सेवा का मौका दीजिए।' }; },
    cancelled: function (c) { return { title: 'बुकिंग रद्द', body: c.ref + ' रद्द कर दी गई। ड्राइवर चाहिए तो कभी भी फिर बुक करें।' }; },
  },
};

/**
 * The phone notification for a booking's current status, in the language the
 * customer uses in the app — or null when this status sends none ('new' is
 * what they just did themselves).
 */
function customerPush(c) {
  var b = c.booking;
  var texts = PUSH_TEXT[c.language] || PUSH_TEXT.en;
  var make = texts[b.status];
  if (!make || (b.status === 'assigned' && !b.assignedDriver)) return null;
  var msg = make({ ref: b.ref || 'Your booking', driver: b.assignedDriver ? b.assignedDriver.name : '' });
  return {
    to: c.token,
    title: msg.title,
    body: msg.body,
    data: { bookingId: c.id },
    sound: 'default',
    priority: 'high',
    channelId: 'bookings',
  };
}

/** First name for a greeting; WhatsApp template values may not hold line breaks. */
function firstName(name) {
  return String(name == null ? '' : name).trim().split(/\s+/)[0] || 'there';
}

function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() || '—';
}

/**
 * WhatsApp Cloud API request for the approved "driver assigned" template
 * (docs/whatsapp.md has its text). Values, in order: customer's first name,
 * booking number, driver's name, driver's mobile, trip time.
 */
function whatsappAssigned(c) {
  var b = c.booking;
  var d = String(b.phone == null ? '' : b.phone).replace(/\D/g, '').slice(-10);
  var text = function (v) { return { type: 'text', text: oneLine(v) }; };
  return {
    messaging_product: 'whatsapp',
    to: '91' + d,
    type: 'template',
    template: {
      name: c.template,
      language: { code: c.language },
      components: [{
        type: 'body',
        parameters: [
          text(firstName(b.name)),
          text(c.ref),
          text(b.assignedDriver.name),
          text(prettyPhone(b.assignedDriver.phone)),
          text(formatWhen(b.preferredTime)),
        ],
      }],
    },
  };
}

/* ========================================================== Firestore REST
   Typed-value conversion is pure (tested); the HTTP calls use UrlFetchApp with
   this account's own OAuth token, which is why the security rules — meant for
   browsers — do not apply here. */

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Object.prototype.toString.call(v) === '[object Date]') return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  var fields = {};
  Object.keys(v).forEach(function (k) { fields[k] = toValue(v[k]); });
  return { mapValue: { fields: fields } };
}

function fromValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}

function fromFields(fields) {
  var out = {};
  Object.keys(fields || {}).forEach(function (k) { out[k] = fromValue(fields[k]); });
  return out;
}

function toFields(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { out[k] = toValue(obj[k]); });
  return out;
}

function fsBase_() {
  return 'https://firestore.googleapis.com/v1/projects/' + prop_('FIREBASE_PROJECT_ID') + '/databases/(default)/documents';
}

function docName_(path) {
  return 'projects/' + prop_('FIREBASE_PROJECT_ID') + '/databases/(default)/documents/' + path;
}

function fsFetch_(url, payload) {
  var res = fetch_(url, {
    method: payload ? 'post' : 'get',
    contentType: 'application/json',
    payload: payload ? JSON.stringify(payload) : undefined,
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      // Bill API usage to the Firebase project (where Firestore is switched on),
      // not to the hidden Cloud project Apps Script creates for this script.
      'X-Goog-User-Project': prop_('FIREBASE_PROJECT_ID'),
    },
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}

function fsGet_(path) {
  var doc = fsFetch_(fsBase_() + '/' + path);
  return doc ? fromFields(doc.fields) : null;
}

/** Every document directly in a (small) collection, e.g. users/{uid}/devices → [{ id, data }]. */
function fsList_(path) {
  var res = fsFetch_(fsBase_() + '/' + path + '?pageSize=50');
  return ((res && res.documents) || []).map(function (d) {
    return { id: d.name.split('/').pop(), data: fromFields(d.fields) };
  });
}

/**
 * runQuery on one collection → [{ id, data }]. Filters and ordering always use
 * the same single field, which Firestore indexes automatically.
 */
function fsQuery_(collection, where, orderDir, limit, orderField) {
  var rows = fsFetch_(fsBase_() + ':runQuery', { structuredQuery: structuredQuery_(collection, where, orderDir, limit, orderField) }) || [];
  return queryRows_(rows);
}

function structuredQuery_(collection, where, orderDir, limit, orderField) {
  var query = {
    from: [{ collectionId: collection }],
    orderBy: [{ field: { fieldPath: orderField || 'createdAt' }, direction: orderDir }],
    limit: limit,
  };
  if (where) query.where = where;
  return query;
}

function queryRows_(rows) {
  return (rows || []).filter(function (r) { return r.document; }).map(function (r) {
    return { id: r.document.name.split('/').pop(), data: fromFields(r.document.fields) };
  });
}

/**
 * Several queries at once (UrlFetchApp.fetchAll runs them side by side), so
 * the robot's "anything new?" checks cost one round trip of the minute's run
 * time, not one each — the 90 minutes a day of trigger time is the tight limit.
 * qs: [{ collection, where, dir, limit, field }] → [{ rows } | { error }], same order.
 */
function fsQueryAll_(qs) {
  if (!qs.length) return [];
  var headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': prop_('FIREBASE_PROJECT_ID') };
  var url = fsBase_() + ':runQuery';
  var responses = fetchAll_(qs.map(function (q) {
    return {
      url: url,
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ structuredQuery: structuredQuery_(q.collection, q.where, q.dir || 'ASCENDING', q.limit || 200, q.field) }),
      headers: headers,
      muteHttpExceptions: true,
    };
  }));
  return responses.map(function (res) {
    var code = res.getResponseCode();
    if (code >= 300) return { error: new Error('Firestore ' + code + ': ' + res.getContentText().slice(0, 300)) };
    return { rows: queryRows_(JSON.parse(res.getContentText() || '[]')) };
  });
}

/** A value inside a document by its dotted path ("acceptedPrice.at"). */
function fieldAt_(data, path) {
  return String(path).split('.').reduce(function (v, k) { return v && typeof v === 'object' ? v[k] : undefined; }, data);
}

function fsCommit_(writes) {
  // A booking change the later steps of this run must see (its updatedAt moved): the shared query is read again.
  if (writes.some(function (w) {
    return w.update && /\/documents\/bookings\/[^/]+$/.test(w.update.name) &&
      ((w.updateMask && w.updateMask.fieldPaths.indexOf('updatedAt') >= 0) || (!w.updateMask && w.update.fields && w.update.fields.updatedAt));
  })) bookingsWritten_ = true;
  return fsFetch_(fsBase_() + ':commit', { writes: writes });
}

/** Many documents in one request (Firestore batchGet, up to 100 a call) → { path: data } for the ones that exist. */
function fsBatchGet_(paths) {
  var out = {};
  for (var i = 0; i < paths.length; i += 100) {
    var res = fsFetch_(fsBase_() + ':batchGet', { documents: paths.slice(i, i + 100).map(docName_) }) || [];
    res.forEach(function (r) {
      if (r.found) out[r.found.name.split('/documents/')[1]] = fromFields(r.found.fields);
    });
  }
  return out;
}

function fieldFilter_(path, op, value) {
  return { fieldFilter: { field: { fieldPath: path }, op: op, value: toValue(value) } };
}

/* =============================================================== senders */

var lastTelegramError_ = '';

function sendTelegram_(msg) {
  var token = prop_('TELEGRAM_BOT_TOKEN');
  var chats = prop_('TELEGRAM_CHAT_ID').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!token || !chats.length) return 'off';
  var sent = 0;
  chats.forEach(function (chatId) {
    var res = fetch_('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: msg.text, parse_mode: 'HTML', reply_markup: msg.reply_markup, disable_web_page_preview: true }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      lastTelegramError_ = res.getContentText().slice(0, 200);
      console.error('Telegram ' + res.getResponseCode() + ': ' + lastTelegramError_);
    }
    if (res.getResponseCode() === 200) sent++;
  });
  return sent ? 'sent' : 'failed';
}

function sendEmail_(msg) {
  var to = prop_('ALERT_EMAIL') || Session.getEffectiveUser().getEmail();
  if (to === 'none') return 'off';
  try {
    MailApp.sendEmail({ to: to, subject: msg.subject, body: msg.body, htmlBody: msg.htmlBody, name: 'DriveBuddy Alerts' });
    return 'sent';
  } catch (err) {
    console.error('Email failed: ' + err);
    return 'failed';
  }
}

/* ================================================================ sheets */

/** Open (or create) a tab and make sure every robot column has a heading. */
/**
 * Phone notifications through Expo's push service (the app registers an Expo
 * push token per phone). Returns one ticket per message, same order:
 * { status: 'ok' } or { status: 'error', details: { error: 'DeviceNotRegistered' } }.
 */
function sendPush_(messages) {
  if (!messages.length) return [];
  var headers = { Accept: 'application/json' };
  var expoToken = prop_('EXPO_ACCESS_TOKEN');
  if (expoToken) headers.Authorization = 'Bearer ' + expoToken;
  var res = fetch_('https://exp.host/--/api/v2/push/send', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(messages),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    console.warn('Expo push ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    return messages.map(function () { return { status: 'error', details: { error: 'RequestFailed' } }; });
  }
  return JSON.parse(res.getContentText()).data || [];
}

/** True once the WhatsApp Cloud API is set up (docs/whatsapp.md). Until then the free one-tap button in /admin is the way. */
function whatsappReady_() {
  return Boolean(prop_('WHATSAPP_TOKEN') && prop_('WHATSAPP_PHONE_ID'));
}

function sendWhatsapp_(payload) {
  var url = 'https://graph.facebook.com/' + prop_('WHATSAPP_API_VERSION') + '/' + prop_('WHATSAPP_PHONE_ID') + '/messages';
  var res = fetch_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('WHATSAPP_TOKEN') },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 200) return 'sent';
  console.warn('WhatsApp ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return 'failed';
}

function table_(name, columns, sortBy) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, columns.length).setValues([columns]);
  var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  columns.forEach(function (c) {
    if (header.indexOf(c) < 0) {
      header.push(c);
      sh.getRange(1, header.length).setValue(c);
    }
  });
  return { sh: sh, header: header, columns: columns, sortBy: sortBy };
}

/**
 * Insert or update rows by their ID column, column by column (about 30 calls
 * however many rows). Only the robot's own columns are written. New rows go to
 * the bottom, then the sheet is sorted newest first.
 */
function upsertRows_(t, records) {
  if (!records.length) return { added: 0, updated: 0 };
  var sh = t.sh;
  var idCol = t.header.indexOf('ID') + 1;
  var n = Math.max(sh.getLastRow() - 1, 0);
  var ids = n ? sh.getRange(2, idCol, n, 1).getValues() : [];
  var pos = {};
  ids.forEach(function (r, i) { if (r[0] !== '') pos[String(r[0])] = i; });

  var total = n;
  var changes = []; // [row index (0 = sheet row 2), record]
  var added = 0;
  records.forEach(function (rec) {
    var i = pos[rec.ID];
    if (i === undefined) {
      i = pos[rec.ID] = total++;
      added++;
    }
    changes.push([i, rec]);
  });

  var need = total + 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);

  t.columns.forEach(function (name) {
    var c = t.header.indexOf(name) + 1;
    var col = n ? sh.getRange(2, c, n, 1).getValues() : [];
    while (col.length < total) col.push(['']);
    changes.forEach(function (ch) { col[ch[0]] = [ch[1][name] === undefined ? '' : ch[1][name]]; });
    sh.getRange(2, c, total, 1).setValues(col);
  });

  if (added && t.sortBy && total > 1) {
    sh.getRange(2, 1, total, Math.max(sh.getLastColumn(), t.header.length))
      .sort({ column: t.header.indexOf(t.sortBy) + 1, ascending: false });
  }
  return { added: added, updated: records.length - added };
}

function bookingsTable_() {
  return table_('Bookings', BOOKING_COLUMNS, 'Booked at');
}

function driversTable_() {
  return table_('Drivers', DRIVER_COLUMNS, 'Applied at');
}

/* ============================================================ the robot */

/* ------------------------------------------------------------- schedule
   What runs when, so a normal day stays far below the 20,000 web calls Google
   allows (each line is about one call; an idle minute costs at most 4):
     every minute    new bookings (processBookings_) — the alert within a minute
     even minutes    what changed in the apps and the admin panel: bookings
                     (one query shared by the instant confirmations, the Sheet,
                     the customers' notifications and the automatic offers) and
                     the drivers' taps on their current jobs (one batch read);
                     prices accepted and jobs given back, each every 4 minutes
     at once         all of that again when the minute numbered a new booking,
                     and on the website's / apps' doorbell (ping_)
     open offers     dispatch every minute while there are any (dispatchOn),
                     else a look every 10 minutes
     minute x1       driver applications, the Drivers sheet, trip links (every
                     10 minutes; the website's driver form rings the doorbell)
     minutes x3, x9  unhandled-booking nudge, trip reminders, payment links,
                     ratings, cash limits
     Telegram        button presses while something waits, every 2 minutes
                     (payouts older than 2 days: every 30 minutes)
   Past FETCH_SLOW_ABOVE calls in a day (India date): slow mode — new bookings
   every minute, everything else every 10 minutes — and Telegram hears once. */

var FETCH_SLOW_ABOVE = 14000;
var QUOTA_PAUSE_MS = 30 * 60 * 1000;

/** The time the schedule uses (a function, so the tests can set the minute). */
function nowDate_() {
  return new Date();
}

/** Today's web calls (India date): { day, n, slowSent }, a fresh count each day. */
function fetchBudget_() {
  var today = istDay(nowDate_().getTime());
  var b = null;
  try {
    b = JSON.parse(PropertiesService.getScriptProperties().getProperty('fetchBudget') || 'null');
  } catch (err) {
    b = null;
  }
  return b && b.day === today ? b : { day: today, n: 0, slowSent: false };
}

function saveFetchBudget_(b) {
  PropertiesService.getScriptProperties().setProperty('fetchBudget', JSON.stringify(b));
}

/** Adds this run's calls to today's count. */
function addFetches_(n) {
  if (!(n > 0)) return;
  var b = fetchBudget_();
  b.n += n;
  saveFetchBudget_(b);
}

function addFetchesSafe_(n) {
  try { addFetches_(n); } catch (err) { /* the count must never break an answer */ }
}

/** A step that runs only when `test()` says so at its turn (it sees what the steps before it did). */
function onlyIf_(test, fn) {
  var step = function () { if (test()) return fn(); };
  step.stepName = fn.name;
  return step;
}

/** New bookings numbered in this run (processBookings_): the app steps then run in the same minute. */
var bookingsNumbered_ = 0;

/** The steps that read what changed in the apps and /admin (the shared bookings query and the taps). */
function appSteps_() {
  return [watchChanges_, syncBookingsSheet_, notifyCustomers_, autoOffers_];
}

/** Dispatch while there are open offers (dispatchOn), else every 10 minutes in case one came without a doorbell. */
function dispatchDue_(m) {
  return PropertiesService.getScriptProperties().getProperty('dispatchOn') === '1' || m % 10 === 5;
}

/** Telegram's button presses: while something waits, every 2 minutes; only old payouts waiting: every 30 minutes. */
function telegramDue_(m) {
  var props = PropertiesService.getScriptProperties();
  var confirms = Object.keys(confirmsPending_()).length > 0;
  var payouts = JSON.parse(props.getProperty('payoutsPending') || '{}');
  var keys = Object.keys(payouts);
  if (!confirms && !keys.length) return false;
  var now = nowDate_().getTime();
  var fresh = confirms || keys.some(function (k) { return now - (payouts[k].at || 0) < 2 * 86400000; });
  return fresh ? m % 2 === 0 : m % 30 === 0;
}

/** Runs every minute (set up by setup()): the safety net behind the instant ping below. See "schedule". */
function tick() {
  var m = nowDate_().getMinutes();
  var budget = fetchBudget_();
  if (budget.n > FETCH_SLOW_ABOVE) {
    runSteps_([slowModeNotice_, processBookings_].concat(m % 10 === 0
      ? appSteps_().concat([dispatchOffers_, processDrivers_, syncDriversSheet_, telegramCallbacks_]) : []), 5000);
    return;
  }
  var steps = [processBookings_];
  appSteps_().forEach(function (fn) { steps.push(onlyIf_(function () { return m % 2 === 0 || bookingsNumbered_ > 0; }, fn)); });
  steps.push(onlyIf_(function () { return dispatchDue_(m); }, dispatchOffers_));
  if (m % 10 === 1) steps.push(processDrivers_, syncDriversSheet_, syncTripClocks_);
  if (m % 10 === 3 || m % 10 === 9) steps.push(remindUnhandled_, tripReminders_, pollPayments_, processRatingsStep_, cashLimits_);
  steps.push(confirmBackfill_, onlyIf_(function () { return telegramDue_(m); }, telegramCallbacks_), ensureRailTrigger_, ensureTimeTriggers_);
  runSteps_(steps, 5000);
}

/** Slow mode's one Telegram a day. */
function slowModeNotice_() {
  var b = fetchBudget_();
  if (b.slowSent) return;
  b.slowSent = true;
  saveFetchBudget_(b);
  telegramLine_('⚠️ The robot has made ' + b.n + ' web calls today (Google allows 20,000 a day). Slow mode until midnight: new bookings still alert within a minute; app taps, offers and the Sheet every 10 minutes.');
}

/**
 * The minute's work on a doorbell (ping_) — what the website or an app may
 * have just changed: new bookings and driver applications, the apps'
 * changes, then the offers (a doorbell often means one was posted, taken or
 * given back).
 */
function robotSteps_() {
  return [processBookings_, processDrivers_].concat(appSteps_()).concat([dispatchOffers_]);
}

/**
 * Runs the steps under the script lock. One failing step never stops the
 * others — except the daily UrlFetch quota: then the run stops at once (and
 * runs pause for half an hour), logged once.
 */
function runSteps_(steps, waitMs) {
  var props = PropertiesService.getScriptProperties();
  var hitAt = Number(props.getProperty('quotaHitAt') || 0);
  if (hitAt && Date.now() - hitAt < QUOTA_PAUSE_MS) return false;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) return false; // another run is going; it or the next one picks this up
  var before = fetchCount_;
  quotaHit_ = false; // (a fresh execution in Apps Script; here after the pause)
  bookingsNumbered_ = 0;
  stream_ = null;
  inRun_ = true;
  try {
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      try {
        step();
      } catch (err) {
        if (quotaHit_) break;
        console.error((step.stepName || step.name) + ': ' + (err && err.stack || err));
      }
      if (quotaHit_) break;
    }
    if (quotaHit_) {
      props.setProperty('quotaHitAt', String(Date.now()));
      console.warn('UrlFetch daily quota reached: run stopped; the robot pauses ' + QUOTA_PAUSE_MS / 60000 + ' minutes between tries.');
    }
  } finally {
    inRun_ = false;
    addFetchesSafe_(fetchCount_ - before);
    lock.releaseLock();
  }
  return true;
}

/**
 * The instant doorbell. Deployed as a web app; the website calls its URL the
 * moment a booking or driver application is saved, so Telegram and email go
 * out in seconds instead of at the next minute. It takes no data and returns
 * nothing private: a call only makes the robot look now. Calls closer than
 * 3 seconds apart are merged (a burst of bookings is handled in one run).
 */
function doPost(e) {
  var body = null;
  try {
    body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : null;
  } catch (err) {
    body = null; // the website's doorbell sends no JSON
  }
  if (body && (body.action === 'driver-otp' || body.action === 'driver-verify')) {
    var before = fetchCount_;
    try {
      return jsonOut_(body.action === 'driver-otp' ? driverOtp_(body, Date.now()) : driverVerify_(body, Date.now()));
    } catch (err) {
      console.warn('driver login: ' + (err && err.stack || err));
      return jsonOut_({ ok: false, error: 'unavailable' });
    } finally {
      addFetchesSafe_(fetchCount_ - before);
    }
  }
  return ping_();
}

/** GET: the doorbell, or (action=trains) the train lookup for the booking estimate. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'trains') {
    var before = fetchCount_;
    try {
      return jsonOut_(trainsLookup_(p, Date.now()));
    } catch (err) {
      // Never an error page: the website and the app read a failed search and try again.
      console.warn('trainsLookup_: ' + (err && err.stack || err));
      return jsonOut_({ ok: false, error: 'unavailable' });
    } finally {
      addFetchesSafe_(fetchCount_ - before);
    }
  }
  return ping_();
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================ driver login
   The DriveBuddy Driver app logs a driver in with his mobile number and a
   one-time code by SMS (Nihal51/drivebuddy-mobile, apps/driver).

     POST { action: 'driver-otp', phone }            → { ok, session }
     POST { action: 'driver-verify', session, code } → { ok, token, name }

   Only a number on a driver record that is Verified or Active in /admin gets a
   code, so nobody else can spend the SMS credit. Message Central VerifyNow
   sends and checks the code; its login stays in the Script Properties
   (MC_CUSTOMER_ID, MC_PASSWORD), never in the app or in GitHub. Limits:
   OTP_PER_PHONE codes per number in 24 hours (default 3) and OTP_DAILY_LIMIT
   codes a day in all (default 40; Telegram hears once when it is reached).
   A wrong code can be tried 5 times.

   Once the code is right, the robot signs a Firebase custom token for
   uid "driver-<number>" with the claims { role: 'driver', driverPhone,
   driverId }. firestore.rules lets that login read only the bookings assigned
   to his number and share his location on them. Signing needs the Firebase
   service account (Firebase console → Project settings → Service accounts →
   Generate new private key): paste its client_email into FIREBASE_SA_EMAIL
   and its private_key into FIREBASE_SA_KEY. Nobody else needs to see it.

   REVIEW_PHONE and REVIEW_CODE (optional): a number that logs in with a fixed
   code and sends no SMS, for the Google Play reviewer. */

var OTP_DEFAULTS = { perPhone: 3, daily: 40, tries: 5, sessionSeconds: 600 };
var MC_API = 'https://cpaas.messagecentral.com';
var DRIVER_LOGIN_STATUSES = ['active', 'verified'];

/** "+91 98765-43210", "098765 43210" → "9876543210"; anything else → ''. */
function driverPhone(raw) {
  var d = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (d.length === 12 && d.slice(0, 2) === '91') d = d.slice(2);
  if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? d : '';
}

/**
 * The codes sent to one number in the last 24 hours (epoch ms) → may one more
 * go now? { allowed, times (pruned, plus now when allowed), retryAt }.
 */
function otpWindow(times, now, perPhone) {
  var day = 24 * 3600 * 1000;
  var kept = (times || []).filter(function (t) { return typeof t === 'number' && t > now - day && t <= now; }).sort(function (a, b) { return a - b; });
  if (kept.length >= perPhone) return { allowed: false, times: kept, retryAt: kept[kept.length - perPhone] + day };
  return { allowed: true, times: kept.concat([now]), retryAt: 0 };
}

/** The driver record a code may go to: Active first, then Verified; null when none. */
function loginDriver(rows) {
  var best = null;
  (rows || []).forEach(function (r) {
    var rank = DRIVER_LOGIN_STATUSES.indexOf(r.data && r.data.status);
    if (rank < 0) return;
    if (!best || rank < best.rank) best = { rank: rank, id: r.id, name: r.data.name || '' };
  });
  return best && { id: best.id, name: best.name };
}

/** The header and payload of a Firebase custom token (signed by customToken_). */
function customTokenParts(saEmail, phone, driverId, nowMs) {
  var iat = Math.floor(nowMs / 1000);
  return {
    header: { alg: 'RS256', typ: 'JWT' },
    payload: {
      iss: saEmail,
      sub: saEmail,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: iat,
      exp: iat + 3600,
      uid: 'driver-' + phone,
      claims: { role: 'driver', driverPhone: phone, driverId: driverId },
    },
  };
}

/** Message Central's answer to validateOtp → 'ok' | 'wrong-code' | 'expired' | 'failed'. */
function mcVerdict(code, body) {
  var data = (body && body.data) || {};
  if (code === 200 && data.verificationStatus === 'VERIFICATION_COMPLETED') return 'ok';
  var rc = Number(data.responseCode || (body && body.responseCode));
  if (rc === 702) return 'wrong-code';
  if (rc === 705 || rc === 703) return 'expired';
  return 'failed';
}

function otpSetting_(key, fallback) {
  var n = Number(prop_(key));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function base64Url_(bytesOrText) {
  return Utilities.base64EncodeWebSafe(bytesOrText).replace(/=+$/, '');
}

function customToken_(phone, driverId, nowMs) {
  var email = prop_('FIREBASE_SA_EMAIL');
  var key = prop_('FIREBASE_SA_KEY').replace(/\\n/g, '\n');
  if (!email || key.indexOf('PRIVATE KEY') < 0) throw new Error('FIREBASE_SA_EMAIL / FIREBASE_SA_KEY not set');
  var parts = customTokenParts(email, phone, driverId, nowMs);
  var unsigned = base64Url_(JSON.stringify(parts.header)) + '.' + base64Url_(JSON.stringify(parts.payload));
  return unsigned + '.' + base64Url_(Utilities.computeRsaSha256Signature(unsigned, key));
}

/** Message Central's login, kept for an hour. */
function mcToken_(fresh) {
  var cache = CacheService.getScriptCache();
  var had = !fresh && cache.get('mc-token');
  if (had) return had;
  var res = fetch_(MC_API + '/auth/v1/authentication/token?customerId=' + encodeURIComponent(prop_('MC_CUSTOMER_ID')) +
    '&key=' + encodeURIComponent(Utilities.base64Encode(prop_('MC_PASSWORD'))) + '&scope=NEW&country=91', {
    method: 'get', headers: { accept: '*/*' }, muteHttpExceptions: true,
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !body.token) throw new Error('Message Central login ' + res.getResponseCode());
  cache.put('mc-token', body.token, 3600);
  return body.token;
}

/** A call to Message Central with its login; logs in again once if it has run out. */
function mcFetch_(method, path) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var res = fetch_(MC_API + path, { method: method, headers: { authToken: mcToken_(attempt > 0) }, muteHttpExceptions: true });
    var code = res.getResponseCode();
    if ((code === 401 || code === 403) && attempt === 0) continue;
    var body = {};
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (err) { body = {}; }
    return { code: code, body: body };
  }
}

function otpAlert_(html) {
  var props = PropertiesService.getScriptProperties();
  var day = istDay(Date.now());
  if (props.getProperty('otpAlert') === day) return;
  props.setProperty('otpAlert', day);
  try { sendTelegram_({ text: html }); } catch (err) { console.warn('otpAlert: ' + err); }
}

function driverOtp_(body, now) {
  var phone = driverPhone(body.phone);
  if (!phone) return { ok: false, error: 'bad-phone' };
  var review = prop_('REVIEW_PHONE') && driverPhone(prop_('REVIEW_PHONE')) === phone && prop_('REVIEW_CODE');
  var driver = review ? { id: 'review', name: 'Play reviewer' }
    : loginDriver(fsQuery_('drivers', fieldFilter_('phone', 'EQUAL', phone), 'ASCENDING', 10, 'phone'));
  if (!driver) return { ok: false, error: 'not-a-driver' };
  if (!review && !(prop_('MC_CUSTOMER_ID') && prop_('MC_PASSWORD'))) return { ok: false, error: 'not-configured' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    var props = PropertiesService.getScriptProperties();
    var keyName = 'otp:' + phone;
    var win = otpWindow(JSON.parse(props.getProperty(keyName) || '[]'), now, otpSetting_('OTP_PER_PHONE', OTP_DEFAULTS.perPhone));
    if (!win.allowed && !review) return { ok: false, error: 'limit', retryAt: win.retryAt };
    var dayKey = 'otpDay:' + istDay(now);
    var today = Number(props.getProperty(dayKey) || 0);
    var daily = otpSetting_('OTP_DAILY_LIMIT', OTP_DEFAULTS.daily);
    if (!review && today >= daily) {
      otpAlert_('⚠️ Driver app: ' + daily + ' login codes sent today — the daily limit (OTP_DAILY_LIMIT). No more codes until midnight.');
      return { ok: false, error: 'busy' };
    }

    var verificationId = 'review';
    if (!review) {
      var sent = mcFetch_('post', '/verification/v3/send?countryCode=91&flowType=SMS&otpLength=6&mobileNumber=' + phone);
      verificationId = sent.body && sent.body.data && sent.body.data.verificationId;
      if (sent.code !== 200 || !verificationId) {
        console.warn('Message Central send ' + sent.code + ': ' + JSON.stringify(sent.body).slice(0, 200));
        return { ok: false, error: 'sms-failed' };
      }
      props.setProperty(dayKey, String(today + 1));
    }
    if (!review) props.setProperty(keyName, JSON.stringify(win.times));

    var session = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    CacheService.getScriptCache().put('otps:' + session, JSON.stringify({
      phone: phone, vid: String(verificationId), driverId: driver.id, name: driver.name, tries: 0, review: !!review,
    }), OTP_DEFAULTS.sessionSeconds);
    return { ok: true, session: session, left: Math.max(0, otpSetting_('OTP_PER_PHONE', OTP_DEFAULTS.perPhone) - win.times.length) };
  } finally {
    lock.releaseLock();
  }
}

function driverVerify_(body, now) {
  var session = String(body.session || '');
  var code = String(body.code || '').replace(/\D/g, '');
  if (!/^[0-9a-f]{32,64}$/.test(session) || code.length < 4 || code.length > 8) return { ok: false, error: 'bad-request' };
  var cache = CacheService.getScriptCache();
  var raw = cache.get('otps:' + session);
  if (!raw) return { ok: false, error: 'expired' };
  var s = JSON.parse(raw);
  if (s.tries >= OTP_DEFAULTS.tries) return { ok: false, error: 'too-many-tries' };
  s.tries++;
  cache.put('otps:' + session, JSON.stringify(s), OTP_DEFAULTS.sessionSeconds);

  var verdict;
  if (s.review) {
    verdict = code === prop_('REVIEW_CODE') ? 'ok' : 'wrong-code';
  } else {
    var res = mcFetch_('get', '/verification/v3/validateOtp?flowType=SMS&verificationId=' + encodeURIComponent(s.vid) + '&code=' + code);
    verdict = mcVerdict(res.code, res.body);
  }
  if (verdict !== 'ok') return { ok: false, error: verdict, triesLeft: OTP_DEFAULTS.tries - s.tries };

  cache.remove ? cache.remove('otps:' + session) : cache.put('otps:' + session, '', 1);
  return { ok: true, token: customToken_(s.phone, s.driverId, now), name: s.name, phone: s.phone };
}

/* ========================================================== job dispatch
   Job offers (firestore.rules, offers/{bookingId}) reach the drivers' phones:

   • Automatic offers: a booking with a price estimate (estimateOf: the price
     agreed on the call, the trip price the customer accepted, else the site's
     own pricing from SITE_URL/app-config.json — 1 hour, 3 hours, full day,
     night, or the trip estimate) is offered to its zone's drivers by itself
     once it is confirmed (status "confirmed", no driver yet). Others
     (emergency, monthly, wedding, a trip without an estimate) are offered by
     hand from /admin. AUTO_OFFERS = off stops it.
   • Driver pay that rises: an automatic offer starts with DriveBuddy's cut at
     30%; with no taker after AUTO_OFFER_STEP_MIN minutes it drops to 25%, then
     to 20% (AUTO_OFFER_CUTS) — the driver earns more each time, and every
     online driver hears "pay raised". An offer an admin posted by hand keeps
     the cut he chose.
   • Nearest first: every open offer, automatic or by hand, is sent as a push
     notification to the 3 nearest drivers who are Online in the Driver app
     (availability/{driverId}, a spot from the last 10 minutes), then to every
     other online driver of the city a minute later. If nobody has taken it 4
     minutes after that (and, for an automatic offer, once its pay has reached
     the top), Telegram hears about it once.

   Its own bookkeeping lives in offerAlerts/{bookingId} (no browser can read or
   write it), so the offer document keeps exactly the shape the rules check. */

var DISPATCH = { firstWave: 3, wideAfterMs: 60 * 1000, alarmAfterMs: 4 * 60 * 1000, freshMs: 10 * 60 * 1000 };
var AUTO_CUTS = [30, 25, 20];
var AUTO_STEP_MIN = 2;

/** "30,25,20" → [30, 25, 20]: whole percents within 20–30, highest first; anything odd → the default. */
function autoCuts(raw) {
  var list = String(raw || '').split(',').map(function (x) { return Math.round(Number(x)); })
    .filter(function (n) { return n >= 20 && n <= 30; });
  if (!list.length) return AUTO_CUTS.slice();
  return list.sort(function (a, b) { return b - a; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
}

/** The cut an automatic offer should have `ageMs` after it went out: one step down every `stepMs`. */
function autoCutAt(ageMs, cuts, stepMs) {
  var i = Math.max(0, Math.floor(Math.max(0, ageMs) / Math.max(60000, stepMs)));
  return cuts[Math.min(i, cuts.length - 1)];
}

/**
 * The price the customer agreed to: the one saved on the call (quote), else
 * the trip estimate they accepted in the app (acceptedPrice); 0 = none.
 */
function agreedPriceOf(b) {
  var ok = function (n) { return n >= 100 && n <= 500000; };
  var quoted = b.quote && Number(b.quote.amount);
  if (ok(quoted)) return Math.round(quoted);
  var accepted = b.acceptedPrice && Number(b.acceptedPrice.amount);
  if (ok(accepted)) return Math.round(accepted);
  return 0;
}

/**
 * The price a job can go to drivers at by itself, from the site's own
 * pricing (lib/estimate.ts on the website gives the same answer —
 * scripts/automation.test.mjs checks): → { amount, basis }, in this order:
 *   the price agreed on the call (quote) → the trip price the customer
 *   accepted in the app (accepted) → 1 hour / 3 hours / 12 hours: the fixed price
 *   (fixed) → local full day: the top of its range (fullDay) → night
 *   driver: its from-price (night) → outstation / one-way drop: the trip
 *   estimate the customer saw (trip). Anything else — hospital / emergency,
 *   monthly, wedding / event, a trip without an estimate — has none
 *   ({ amount: 0, basis: '' }): the office prices it on the call.
 * Each amount counts only as whole rupees from 100 to 500000; an odd one is
 * passed over for the next.
 */
function estimateOf(b, prices) {
  b = b || {};
  prices = prices || {};
  var whole = function (v) {
    var n = Number(v);
    return Number.isInteger(n) && n >= 100 && n <= 500000 ? n : 0;
  };
  var steps = [
    ['quote', b.quote && b.quote.amount],
    ['accepted', b.acceptedPrice && b.acceptedPrice.amount],
  ];
  var pkg = b.package;
  if (pkg === '1-hour-300') steps.push(['fixed', prices.oneHour]);
  if (pkg === '3-hours-600') steps.push(['fixed', prices.threeHours]);
  if (pkg === 'local-12-hours') steps.push(['fixed', prices.twelveHours]);
  if (pkg === 'local-full-day') steps.push(['fullDay', prices.fullDay && prices.fullDay.to]);
  if (pkg === 'night-driver') steps.push(['night', prices.nightFrom]);
  if (pkg === 'outstation' || pkg === 'one-way-drop') steps.push(['trip', b.trip && b.trip.estTo]);
  for (var i = 0; i < steps.length; i++) {
    var amount = whole(steps[i][1]);
    if (amount) return { amount: amount, basis: steps[i][0] };
  }
  return { amount: 0, basis: '' };
}

/** Does this booking's estimate need the site's prices (a package priced on the site, with no agreed or trip price)? */
function estimateNeedsPrices(b) {
  return !estimateOf(b, {}).amount && ['1-hour-300', '3-hours-600', 'local-12-hours', 'local-full-day', 'night-driver'].indexOf(b && b.package) >= 0;
}

/**
 * One zone: Raipur, Bhilai and Durg are one area for drivers — a driver
 * registered in Bhilai often waits in Raipur. Every offer goes to its whole
 * zone at once (offers `cities`; firestore.rules lets a driver see an offer
 * whose `cities` has his city), nearest drivers first by GPS. Bilaspur is too
 * far: its own zone. lib/offers.ts offerCitiesFor and the rules (isZoneCities)
 * use the same zones.
 */
var ZONES = [['Raipur', 'Bhilai', 'Durg'], ['Bilaspur']];

/** A city's zone, its own city first: "Bhilai" → ["Bhilai", "Raipur", "Durg"]. A city in no zone: only itself. */
function zoneOf(city) {
  var zone = ZONES.filter(function (z) { return z.indexOf(city) >= 0; })[0];
  return [city].concat((zone || []).filter(function (c) { return c !== city; }));
}

/**
 * Nearby cities, from before the zones: an older offer (its own city only)
 * nobody has taken 10 minutes after its pay reached the top goes to these
 * drivers too. A zone offer already has them all, so this changes nothing.
 */
var NEARBY_CITIES = { Raipur: ['Bhilai', 'Durg'], Bhilai: ['Durg', 'Raipur'], Durg: ['Bhilai', 'Raipur'], Bilaspur: [] };
var WIDEN_AFTER_TOP_MS = 10 * 60 * 1000;

/** An offer's cities: its `cities`, or only its own city (older offers have none). */
function offerCities(o) {
  return Array.isArray(o.cities) && o.cities.length ? o.cities.slice() : [o.city];
}

/** A city and its neighbours, own city first. */
function citiesWith(city) {
  return [city].concat(NEARBY_CITIES[city] || []);
}

/** Has this automatic offer waited 10 minutes at the top pay, and not been widened yet? */
function widenDue(o, alert, cuts, stepMs, now) {
  if (!o || o.by !== 'robot' || o.status !== 'open' || !o.createdAt || (alert && alert.widenedAt)) return false;
  var topAt = o.createdAt.getTime() + (cuts.length - 1) * Math.max(60000, stepMs);
  return now - topAt >= WIDEN_AFTER_TOP_MS;
}
var CITY_CENTRES = {
  Raipur: { lat: 21.2514, lng: 81.6296 },
  Bhilai: { lat: 21.1938, lng: 81.3509 },
  Durg: { lat: 21.1904, lng: 81.2849 },
  Bilaspur: { lat: 22.0797, lng: 82.1391 },
};

/** Straight-line km between two spots (good enough to rank drivers in one city). */
function distanceKm(a, b) {
  var R = 6371;
  var rad = function (d) { return d * Math.PI / 180; };
  var dLat = rad(b.lat - a.lat);
  var dLng = rad(b.lng - a.lng);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A driver who goes after the others: rated below 4 by at least 3 customers,
 * or 3 or more jobs given back. Never paused by the robot — that is the
 * office's call (see the low-rating Telegram).
 */
function backSeat(q) {
  q = q || {};
  return (Number(q.ratingCount) >= 3 && Number(q.ratingAvg) < 4) || Number(q.strikes) >= 3;
}

/**
 * Online drivers who can be told about a job at `spot`, nearest first:
 * online, seen in the last 10 minutes, with a push token. Drivers whose
 * phone sent no spot go last; so do (before that) drivers with a poor
 * rating or many jobs given back (`quality`: { driverId: { ratingAvg,
 * ratingCount, strikes, owed } }, the robot's own copy of those fields).
 * A driver holding more of DriveBuddy's cash than `cashLimit` (rupees; 0 =
 * no limit) is left out until he settles (overCashLimit).
 */
function rankDrivers(rows, spot, now, quality, cashLimit) {
  quality = quality || {};
  return (rows || [])
    .filter(function (r) {
      var a = r.data || {};
      return a.online === true && a.pushToken && a.at && now - a.at.getTime() <= DISPATCH.freshMs;
    })
    .filter(function (r) { return !overCashLimit(quality[r.id], cashLimit); })
    .map(function (r) {
      var a = r.data;
      var km = typeof a.lat === 'number' && typeof a.lng === 'number' ? distanceKm(spot, { lat: a.lat, lng: a.lng }) : Infinity;
      return { id: r.id, name: a.name || '', token: a.pushToken, km: km, back: backSeat(quality[r.id]) };
    })
    .sort(function (x, y) { return (x.back - y.back) || (x.km - y.km); });
}

/** Who to alert now, given what was sent: { stage, send: [drivers], alarm }. */
function dispatchStep(alert, ranked, now) {
  var stage = (alert && alert.stage) || 0;
  var sent = (alert && alert.alerted) || [];
  var since = alert && alert.stageAt ? now - alert.stageAt.getTime() : 0;
  var fresh = ranked.filter(function (d) { return sent.indexOf(d.id) < 0; });
  if (stage === 0) return { stage: 1, send: fresh.slice(0, DISPATCH.firstWave), alarm: false };
  if (stage === 1 && since >= DISPATCH.wideAfterMs) return { stage: 2, send: fresh, alarm: false };
  if (stage === 2 && since >= DISPATCH.alarmAfterMs) return { stage: 3, send: fresh, alarm: true };
  // Meanwhile a driver who just went online hears about it too (after the first wave).
  if (stage >= 2 && fresh.length) return { stage: stage, send: fresh, alarm: false, keepTime: true };
  return null;
}

/** The website's area for drivers: the pickup without its first part ("12, Shankar Nagar" → "Shankar Nagar"). */
function offerAreaOf(pickup) {
  var parts = String(pickup || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  return (parts.length > 1 ? parts.slice(1) : parts).join(', ').slice(0, 120);
}

/** What the driver earns: the price minus the cut, rounded down to ₹10 (lib/offers.ts driverPayFor). */
function driverPayOf(price, cutPercent) {
  var cut = Math.min(30, Math.max(20, Math.round(cutPercent)));
  return Math.floor(Math.round(price) * (100 - cut) / 100 / 10) * 10;
}

/* The private rate card (Script Property DRIVER_RATES): what a driver is paid
   for a job, instead of the customer's price minus a % cut. The values live
   only in the Script Properties — never in this file, the website or GitHub. */
var RATE_KEYS = ['local8h', 'local12h', 'localExtraHour', 'tripDay', 'returnHour'];
/** A rate-card offer nobody takes: his pay goes up this much each step (AUTO_OFFER_STEP_MIN), at most `max` in all. */
var RATE_RAISE = { step: 50, max: 150 };

/**
 * The rate card's day rule is for long drives. A same-day drop or trip — up
 * to the site's first nearby tier (prices.outstationNear[0].upToKm, from
 * app-config.json) — stays on the % cut, as its near-tier price is set for
 * that. When the site cannot be read: this many km.
 */
var NEAR_TRIP_KM_DEFAULT = 160;

/** The km up to which a trip is a same-day one (site prices.outstationNear[0].upToKm), else NEAR_TRIP_KM_DEFAULT. */
function nearKmOf(prices) {
  var tier = prices && Array.isArray(prices.outstationNear) ? prices.outstationNear[0] : null;
  var n = Number(tier && tier.upToKm);
  return n > 0 ? n : NEAR_TRIP_KM_DEFAULT;
}

/** nearKmOf from the site's config (cached for an hour); the default when it cannot be read. */
function siteNearKm_() {
  try {
    return nearKmOf(sitePrices_());
  } catch (err) {
    return NEAR_TRIP_KM_DEFAULT;
  }
}

/**
 * How a one-way drive is timed (site-settings.ts outstation.drive, from
 * app-config.json): km/h, a break of breakMinutes after each full
 * breakEveryHours of driving, hours on the road a day. These when the site
 * cannot be read (the site's own values, 24 Nov 2026).
 */
var DRIVE_DEFAULT = { kmh: 55, breakEveryHours: 4, breakMinutes: 35, maxRoadHoursPerDay: 12 };

/** The site's drive settings (outstation.drive), each checked; DRIVE_DEFAULT for anything missing or odd. */
function driveOf(outstation) {
  var d = (outstation && outstation.drive) || {};
  var pick = function (k, lo, hi) {
    var n = Number(d[k]);
    return Number.isFinite(n) && n >= lo && n <= hi ? n : DRIVE_DEFAULT[k];
  };
  return {
    kmh: pick('kmh', 20, 100),
    breakEveryHours: pick('breakEveryHours', 1, 12),
    breakMinutes: pick('breakMinutes', 0, 120),
    maxRoadHoursPerDay: pick('maxRoadHoursPerDay', 6, 16),
  };
}

/** driveOf from the site's config (cached for an hour); DRIVE_DEFAULT when it cannot be read. */
function siteDrive_() {
  try {
    var c = siteConfig_();
    return driveOf(c && c.outstation);
  } catch (err) {
    return driveOf(null);
  }
}

/** The booking asked for day and night driving (lib/bookings.ts NONSTOP_NOTE, at the start of the notes). */
function wantsNonstop(b) {
  return String((b && b.notes) || '').trim().indexOf('Day and night driving (non-stop).') === 0;
}

/**
 * Hours from the start until he drops the car on a one-way drive of `km`
 * (lib/outstation.ts roadTime + dropTime): driving at drive.kmh, a break
 * after each full breakEveryHours of driving; day and night straight
 * through, otherwise maxRoadHoursPerDay on the road and the rest of the 24
 * hours resting — up to an hour more finishes that evening.
 *   616 km: 11.2 h + 2 × 35 min = 12.37 h → 12.37.  1,370 km: 28.41 h → 52.41.
 */
function dropHoursOf(km, drive, nonstop) {
  drive = drive || DRIVE_DEFAULT;
  var h = Math.max(0, Number(km) || 0) / drive.kmh;
  var road = h + (Math.floor(h / drive.breakEveryHours) * drive.breakMinutes) / 60;
  if (nonstop) return road;
  var day = drive.maxRoadHoursPerDay;
  var full = Math.floor(road / day + 1e-9);
  var rest = road - full * day;
  if (full === 0) return road;
  if (rest <= 1e-9) return (full - 1) * 24 + day;
  if (rest <= 1 + 1e-9) return (full - 1) * 24 + day + rest;
  return full * 24 + rest;
}

/**
 * The driver's pay for his WHOLE time of `hours` (lib/outstation.ts
 * wholeTimePay): each full 24 hours his day, each started hour left over
 * his hour, never more than his day for those — and at least one day.
 */
function wholeTimePay(hours, dayPay, hourPay) {
  var m = Math.max(0, Math.round((Number(hours) || 0) * 60));
  var full = Math.floor(m / 1440);
  var left = Math.ceil((m - full * 1440) / 60);
  return Math.max(dayPay, full * dayPay + Math.min(dayPay, left * hourPay));
}

/** DRIVER_RATES → { local8h, local12h, localExtraHour, tripDay, returnHour }, every one a whole number 1–100000; anything else → null (the % cut). */
function driverRatesOf(raw) {
  var r;
  try {
    r = JSON.parse(String(raw == null ? '' : raw));
  } catch (err) {
    return null;
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  var out = {};
  for (var i = 0; i < RATE_KEYS.length; i++) {
    var n = r[RATE_KEYS[i]];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 100000) return null;
    out[RATE_KEYS[i]] = n;
  }
  return out;
}

function driverRates_() {
  return driverRatesOf(PropertiesService.getScriptProperties().getProperty('DRIVER_RATES'));
}

/**
 * What the rate card pays the driver for this booking, or null (= the % cut):
 *   local full day → local8h (the 8-hour package); 12 hours in the city → local12h;
 *   one-way drop (24 Nov 2026) → his WHOLE time T: on the road start → drop
 *     (trip.km at `drive`, its breaks and any night's rest — dropHoursOf,
 *     day and night when the booking asked) plus his way home
 *     (trip.returnHours, the booking's estimate of the wait and the ride):
 *     max(tripDay, floor(T/24) × tripDay + min(tripDay, ceil(T mod 24) × returnHour));
 *   outstation (round trip) → trip.days × tripDay.
 * Trips only when long: farther than `nearKm` (nearKmOf; same-day ones and
 * an unknown distance stay on the % cut). Night driver, 1 hour, 3 hours and
 * everything else → null. `price` is not used here: the caller checks the
 * pay stays below it. `drive`: the site's (siteDrive_), else DRIVE_DEFAULT.
 */
function rateCardPayOf(b, price, rates, nearKm, drive) {
  if (!rates || !b) return null;
  if (b.package === 'local-full-day') return rates.local8h;
  if (b.package === 'local-12-hours') return rates.local12h;
  var t = b.trip;
  if (!t || typeof t !== 'object') return null;
  var km = Number(t.km);
  if (!(km > 0) || km <= (nearKm > 0 ? nearKm : NEAR_TRIP_KM_DEFAULT)) return null;
  var days = Math.max(1, Math.floor(Number(t.days) || 0));
  if (b.package === 'outstation') return days * rates.tripDay;
  if (b.package !== 'one-way-drop') return null;
  var home = Math.max(0, Number(t.returnHours) || 0);
  return wholeTimePay(dropHoursOf(km, drive || DRIVE_DEFAULT, wantsNonstop(b)) + home, rates.tripDay, rates.returnHour);
}

/** DriveBuddy's share of the price, in whole percent, for reference on a rate-card offer. */
function keepPercentOf(price, pay) {
  return Math.round(((price - pay) / price) * 100);
}

/**
 * A rate-card offer nobody has taken, `ageMs` after it went out: his pay
 * goes up RATE_RAISE.step every `stepMs`, at most RATE_RAISE.max in all, and
 * never to the price or above. → { pay, top } (top: it will not rise again).
 */
function rateRaiseAt(ageMs, basePay, price, stepMs) {
  var steps = Math.floor(Math.max(0, ageMs) / Math.max(60000, stepMs));
  var most = 0;
  while ((most + 1) * RATE_RAISE.step <= RATE_RAISE.max && basePay + (most + 1) * RATE_RAISE.step < price) most++;
  var k = Math.min(steps, most);
  return { pay: basePay + k * RATE_RAISE.step, top: k >= most };
}

/** The offer fields that pay by the rate card, or null when the card does not price this booking or its pay is not below the price. */
function rateCardFields(b, price, rates, nearKm, drive) {
  var pay = rateCardPayOf(b, price, rates, nearKm, drive);
  if (pay === null || !(pay < price)) return null;
  return { driverPay: pay, cutPercent: keepPercentOf(price, pay), payBy: 'rates' };
}

/** The automatic offer for a confirmed booking with a price, in the exact shape firestore.rules checks; null if not one. */
function autoOfferFor(id, b, prices, cut, now, rates, nearKm, drive) {
  var price = estimateOf(b, prices).amount;
  if (!price || b.status !== 'confirmed' || b.assignedDriver) return null;
  var area = offerAreaOf(b.pickup);
  if (area.length < 2) area = b.city;
  var offer = {
    bookingId: id, ref: b.ref || '', city: b.city, package: b.package, when: b.preferredTime || '', area: area,
    to: (b.trip && b.trip.to) || '', price: Math.round(price), cutPercent: Math.min(30, Math.max(20, Math.round(cut))),
    driverPay: driverPayOf(price, cut), status: 'open', takenBy: null, takenAt: null, done: false, paid: false,
    paidAt: null, createdAt: now, updatedAt: now, by: 'robot', cities: zoneOf(b.city), payBy: 'cut',
  };
  // The rate card, when it prices this job (autoOffers_ holds a job whose rate is not below its price).
  var card = rateCardFields(b, offer.price, rates, nearKm, drive);
  if (card) Object.keys(card).forEach(function (k) { offer[k] = card[k]; });
  return offer;
}

/** The job alert on a driver's phone (English and Hindi, most drivers read Hindi first). `raised`: the pay went up. */
function offerPush(offer, token, raised) {
  var pay = '₹' + inr(offer.driverPay);
  var what = PACKAGE_NAMES[offer.package] || 'Driver job';
  return {
    to: token,
    title: (raised ? 'Pay raised · कमाई बढ़ी: ' : 'New job · नया काम: ') + what,
    body: 'You earn ' + pay + ' · ' + offer.area + (offer.when ? ' · ' + formatWhen(offer.when) : ' · ASAP') + '. Open the app to accept.',
    data: { offerId: offer.bookingId },
    sound: 'default',
    priority: 'high',
    channelId: 'jobs',
  };
}

/**
 * The website's public settings (SITE_URL/app-config.json, made from
 * site-settings.ts): { prices, google, payments, outstation.drive }, kept for an hour. null when
 * the site cannot be reached.
 */
function siteConfig_() {
  var cache = CacheService.getScriptCache();
  var had = cache.get('siteConfig');
  if (had) return JSON.parse(had);
  var res = fetch_(prop_('SITE_URL') + '/app-config.json', { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  var all = JSON.parse(res.getContentText()) || {};
  if (!all.prices) return null;
  // outstation: the drive timing for a one-way drop's rate-card pay (outstation.drive).
  var keep = { prices: all.prices, google: all.google || {}, payments: all.payments || {}, outstation: { drive: (all.outstation && all.outstation.drive) || null } };
  cache.put('siteConfig', JSON.stringify(keep), 3600);
  return keep;
}

function sitePrices_() {
  var c = siteConfig_();
  return c ? c.prices : null;
}

/**
 * The cash limit in rupees (site-settings.ts payments.cashLimit, the same
 * number the Driver app shows). 0 = none: the site could not be read, or the
 * setting is not there yet — then nobody is left out of job alerts.
 */
function siteCashLimit_() {
  try {
    var c = siteConfig_();
    return cashLimitOf(c && c.payments);
  } catch (err) {
    console.warn('cash limit: the site could not be read: ' + err); // never stops dispatch
    return 0;
  }
}

/** Confirmed bookings with an estimate (estimateOf) → an open offer, once. */
function autoOffers_() {
  if (prop_('AUTO_OFFERS') === 'off') return;
  changedSince_('bookings', 'autoOfferMs', function (rows) {
    var prices = null;
    var rates; // the rate card, read once a run when needed
    var nearKm; // the site's same-day trip limit, likewise
    var drive; // the site's drive timing (one-way pay), likewise
    var cut = autoCuts(prop_('AUTO_OFFER_CUTS'))[0];
    rows.forEach(function (row) {
      var b = row.data;
      if (b.status !== 'confirmed' || b.assignedDriver) return;
      var needsPrices = estimateNeedsPrices(b);
      if (!needsPrices && !estimateOf(b, {}).amount) return; // no price yet: the office prices it on the call
      if (fsGet_('offers/' + row.id)) return; // already offered (by hand or before)
      // The site's prices only when needed (and once a run).
      if (needsPrices && !prices) prices = sitePrices_();
      if (rates === undefined) rates = driverRates_();
      // How long a same-day trip is, from the site — only for a trip with a rate card (cached for an hour).
      if (rates && b.trip && nearKm === undefined) nearKm = siteNearKm_();
      if (rates && b.trip && drive === undefined) drive = siteDrive_();
      var price = estimateOf(b, prices || {}).amount;
      var ratePay = rateCardPayOf(b, price, rates, nearKm, drive);
      if (price && ratePay !== null && ratePay >= price) {
        // The price is below what the driver is paid: never offered at a loss. Telegram once per price.
        var key = price + ':' + ratePay;
        if (bookOf_(row.id).rateWarned !== key) {
          telegramLine_('⚠️ ' + escapeHtml(b.ref || row.id) + ': the price ₹' + inr(price) + ' is below the driver\'s rate ₹' + inr(ratePay) + ' — check the price');
          saveBook_(row.id, { rateWarned: key });
        }
        return;
      }
      var offer = autoOfferFor(row.id, b, prices || {}, cut, new Date(), rates, nearKm, drive);
      if (!offer) return;
      fsCommit_([{ update: { name: docName_('offers/' + row.id), fields: toFields(offer) }, currentDocument: { exists: false } }]);
      dispatchOn_();
    });
  });
}

/** There is an open offer: dispatch every minute until none is left (see "schedule"). */
function dispatchOn_() {
  PropertiesService.getScriptProperties().setProperty('dispatchOn', '1');
}

/** Every open offer: push to the nearest online drivers, then the rest, then Telegram. */
function dispatchOffers_() {
  var offers = fsQuery_('offers', fieldFilter_('status', 'EQUAL', 'open'), 'ASCENDING', 20, 'status');
  // No open offer left: the minute-by-minute dispatch stops (a new offer or a doorbell starts it again).
  PropertiesService.getScriptProperties().setProperty('dispatchOn', offers.length ? '1' : '0');
  if (!offers.length) return;
  var now = Date.now();
  var byCity = {};
  var cuts = autoCuts(prop_('AUTO_OFFER_CUTS'));
  var stepMs = (Number(prop_('AUTO_OFFER_STEP_MIN')) || AUTO_STEP_MIN) * 60000;
  var quality = driverQuality_();
  // The site's cash limit only when somebody holds cash at all (it is cached for an hour anyway).
  var cashLimit = Object.keys(quality).some(function (k) { return Number(quality[k].owed) > 0; }) ? siteCashLimit_() : 0;
  offers.forEach(function (row) {
    var o = row.data;
    var alert = fsGet_('offerAlerts/' + row.id);
    // An automatic offer nobody has taken: the driver earns more each step, and everyone hears again —
    // a rate-card offer by RATE_RAISE.step on his rate (up to RATE_RAISE.max), others a lower cut.
    var raised = false;
    var rateCard = o.payBy === 'rates';
    var basePay = rateCard ? (alert && alert.basePay) || o.driverPay : null;
    var atTop = !rateCard || o.by !== 'robot';
    if (rateCard && o.by === 'robot' && o.createdAt) {
      var up = rateRaiseAt(now - o.createdAt.getTime(), basePay, o.price, stepMs);
      atTop = up.top;
      if (up.pay > o.driverPay) {
        o.driverPay = up.pay;
        o.cutPercent = keepPercentOf(o.price, up.pay);
        fsCommit_([{
          update: { name: docName_('offers/' + row.id), fields: toFields({ cutPercent: o.cutPercent, driverPay: o.driverPay, updatedAt: new Date(now) }) },
          updateMask: { fieldPaths: ['cutPercent', 'driverPay', 'updatedAt'] },
          currentDocument: { exists: true },
        }]);
        raised = true;
        if (alert) alert.alerted = [];
      }
    } else if (o.by === 'robot' && o.createdAt) {
      var want = autoCutAt(now - o.createdAt.getTime(), cuts, stepMs);
      if (want < o.cutPercent) {
        o.cutPercent = want;
        o.driverPay = driverPayOf(o.price, want);
        fsCommit_([{
          update: { name: docName_('offers/' + row.id), fields: toFields({ cutPercent: o.cutPercent, driverPay: o.driverPay, updatedAt: new Date(now) }) },
          updateMask: { fieldPaths: ['cutPercent', 'driverPay', 'updatedAt'] },
          currentDocument: { exists: true },
        }]);
        raised = true;
        if (alert) alert.alerted = []; // everyone hears about the new pay, the first wave included
      }
    }
    var booking = fsGet_('bookings/' + row.id) || {};
    // The robot's notes on this offer that outlive each write below.
    var keep = {
      skipIds: (alert && alert.skipIds) || [], // drivers who gave this job back
      widenedAt: (alert && alert.widenedAt) || null,
      stillPushedAt: (alert && alert.stillPushedAt) || null,
    };
    var cities = offerCities(o);
    var touched = false;
    // Still nobody 10 minutes after the top pay: the neighbouring cities' drivers too, and the customer hears we are on it.
    if (widenDue(o, alert, cuts, stepMs, now)) {
      var wide = citiesWith(o.city);
      wide.forEach(function (c) { if (cities.indexOf(c) < 0) cities.push(c); });
      if (cities.length > offerCities(o).length) {
        fsCommit_([{
          update: { name: docName_('offers/' + row.id), fields: toFields({ cities: cities, updatedAt: new Date(now) }) },
          updateMask: { fieldPaths: ['cities', 'updatedAt'] },
          currentDocument: { exists: true },
        }]);
        try {
          sendTelegram_({ text: '🔎 Nobody in ' + escapeHtml(o.city) + ' has taken ' + escapeHtml(o.ref || 'a job') + ' yet: offered to ' + escapeHtml(cities.slice(1).join(' and ')) + ' drivers too.' });
        } catch (err) { console.warn('widen telegram: ' + err); }
      }
      if (!keep.stillPushedAt && booking.customerUid) {
        pushToCustomer_(booking.customerUid, function (lang, token) { return stillFindingPush(row.id, lang, token); });
      }
      keep.widenedAt = new Date(now);
      keep.stillPushedAt = keep.stillPushedAt || new Date(now);
      touched = true;
    }
    // Online drivers: one query a run for all cities (not one per city), then those of the offer's cities.
    if (!byCity.online) byCity.online = fsQuery_('availability', fieldFilter_('online', 'EQUAL', true), 'ASCENDING', 300, 'online');
    var pool = byCity.online.filter(function (r) { return cities.indexOf(r.data && r.data.city) >= 0; });
    var spot = (booking.pickupGeo && typeof booking.pickupGeo.lat === 'number') ? booking.pickupGeo : (CITY_CENTRES[o.city] || CITY_CENTRES.Raipur);
    var ranked = rankDrivers(pool, spot, now, quality, cashLimit).filter(function (d) { return keep.skipIds.indexOf(d.id) < 0; });
    var step = raised && alert && alert.stage >= 1
      ? { stage: Math.max(2, alert.stage), send: ranked, alarm: false }
      : dispatchStep(alert, ranked, now);
    if (!step && !touched) return;
    if (step) {
      // An automatic offer only rings Telegram once its pay has reached the top.
      var notTopYet = rateCard ? !atTop : o.cutPercent > cuts[cuts.length - 1];
      if (step.alarm && o.by === 'robot' && notTopYet) step = { stage: 2, send: step.send, alarm: false, keepTime: true };
      if (step.send.length) sendPush_(step.send.map(function (d) { return offerPush(o, d.token, raised); }));
      if (step.alarm) {
        try {
          sendTelegram_({ text: '⏰ No driver has taken ' + (o.ref || 'a job') + ' (' + (PACKAGE_NAMES[o.package] || o.package) + ', ' + o.city + ') yet, at ₹' + inr(o.driverPay) + ' for the driver (' + o.cutPercent + '% cut). Call a driver, or change the offer in /admin.' });
        } catch (err) { console.warn('dispatch alarm: ' + err); }
      }
    } else {
      step = { stage: (alert && alert.stage) || 0, send: [], keepTime: true };
    }
    var alerted = ((alert && alert.alerted) || []).concat(step.send.map(function (d) { return d.id; }));
    fsCommit_([{
      update: {
        name: docName_('offerAlerts/' + row.id),
        fields: toFields({
          stage: step.stage, stageAt: step.keepTime && alert && alert.stageAt ? alert.stageAt : new Date(now), alerted: alerted,
          skipIds: keep.skipIds, widenedAt: keep.widenedAt, stillPushedAt: keep.stillPushedAt, basePay: basePay,
        }),
      },
    }]);
  });
}

/* ============================================================ automation
   What used to need a phone call or a tap in /admin, done by the robot:

   • Instant booking: a logged-in customer's 1 hour / 3 hours / 12 hours booking, or a
     trip whose estimate the customer accepted in the app (acceptedPrice), is
     confirmed at once and then offered to drivers as usual. Never a hospital
     / emergency booking: those are always a call. INSTANT_BOOKINGS = off.
   • "Can't make it": a driver may give back a job he took, before he taps
     Start (firestore.rules). The offer goes out again from the first step,
     never to him, and his drivers/{id}.strikes goes up.
   • A driver takes a job in the app: Telegram asks the office to call him
     and confirm (Confirmed ✓ → booking.driverConfirmed; Give to someone
     else → offered again, never to him, no strike), and reminds once after
     15 minutes. He sees the customer's details only once confirmed (rules).
     CONFIRM_BY_CALL = off: confirmed at once. A driver the office assigns
     itself is confirmed by 'office'.
   • An hour before the job: a reminder to the customer and the driver.
   • The Driver app's taps (tripTaps/{bookingId}: Start, Arrived, Job done,
     Reached home): a trip's times go to the booking's clock and Telegram, as
     with the trip link (the office still saves the bill); a local job gets
     its bill (localBill) at Job done and is completed.
   • A completed job with a bill gets a payment link: Razorpay's once its keys
     are set, else a UPI pay link to DriveBuddy's own UPI_ID (no gateway).
     The driver collects it and taps "Paid by UPI" or "Paid in cash" (tripTaps
     paidBy / paidAt) — he is never sent the customer's price (nor
     DriveBuddy's cut); the amount comes from the bill. The booking is then
     paid, and cash he kept is noted on his offer (cashCollected). Then a
     request to rate the driver; the ratings make
     drivers/{id}.ratingAvg and ratingCount, which push poorly rated drivers
     (and those with 3 strikes) to the back of the queue for new jobs.
   • Monday ~9:30: what each driver earned minus the cash he kept — pay him,
     or collect from him — with a Paid ✓ / Settled ✓ button. ~9 pm: the day
     in numbers.
   • Cash limit: a driver holding more of DriveBuddy's cash than
     payments.cashLimit (site-settings.ts) gets no new job alerts until he
     settles; Telegram hears once, he is reminded once a day.
   The robot's own notes per booking live in reminders/{bookingId}, which no
   browser can read or write. */

var INSTANT_PACKAGES = ['1-hour-300', '3-hours-600', 'local-12-hours'];
/** Hours each local package includes; past them each started hour (after LOCAL_GRACE_MIN) is extra. */
var LOCAL_BASE_HOURS = { '1-hour-300': 1, '3-hours-600': 3, 'local-full-day': 8, 'local-12-hours': 12, 'night-driver': 10 };
var LOCAL_GRACE_MIN = 15;
/** Trip packages and their kind, as on the trip link: their taps fill the booking's clock. */
var TRIP_TAP_KINDS = { outstation: 'round', 'one-way-drop': 'one-way' };
var REMIND_BEFORE_MIN = 60;
var RAZORPAY_API = 'https://api.razorpay.com/v1';
/** Telegram asks about a driver whose average falls below this, once he has this many ratings. */
var LOW_RATING = { avg: 3.5, count: 5 };

/* ------------------------------------------------------------ pure parts */

/**
 * May the robot confirm this booking by itself? New, numbered, not an
 * emergency, and either a logged-in customer's 1 hour / 3 hours / 12 hours, or a
 * price the customer accepted. `setting`: INSTANT_BOOKINGS ("off" = never).
 */
function instantConfirmable(b, setting) {
  if (String(setting || '').trim().toLowerCase() === 'off') return false;
  if (!b || b.status !== 'new' || !b.ref || b.package === 'medical-emergency') return false;
  if (b.acceptedPrice && Number(b.acceptedPrice.amount) > 0) return true;
  return Boolean(b.customerUid) && INSTANT_PACKAGES.indexOf(b.package) >= 0;
}

/** Whole hours from `fromMs` to `toMs`, an hour started counting only after `graceMin` minutes (3 h 15 m = 3, 3 h 16 m = 4). */
function usedHours(fromMs, toMs, graceMin) {
  var minutes = Math.floor(Math.max(0, toMs - fromMs) / 60000);
  return Math.max(0, Math.ceil((minutes - graceMin) / 60));
}

/**
 * A local job's base price: the price it went to the driver at, so the bill
 * and his pay always agree — the price agreed on the call (quote), the price
 * the customer accepted, the price of the offer he took (`offerPrice`), else
 * the estimate it would have been offered at (estimateOf); only with none of
 * those, the site's lowest price (full day "from" …).
 */
function localPackagePrice(b, prices, offerPrice) {
  var agreed = agreedPriceOf(b);
  if (agreed) return agreed;
  var offered = Number(offerPrice);
  if (Number.isInteger(offered) && offered >= 100 && offered <= 500000) return offered;
  var est = estimateOf(b, prices).amount;
  if (est) return est;
  prices = prices || {};
  var p = {
    '1-hour-300': prices.oneHour,
    '3-hours-600': prices.threeHours,
    'local-12-hours': prices.twelveHours,
    'local-full-day': prices.fullDay && prices.fullDay.from,
    'night-driver': prices.nightFrom,
  }[b.package];
  p = Number(p);
  return p >= 100 ? Math.round(p) : 0;
}

/**
 * The bill of a local job from the driver's taps: the package's price (the
 * price it was offered to him at — localPackagePrice), plus each hour past
 * the package (Arrived → Job done, after the grace minutes) at
 * prices.localExtraHour. null when it cannot be worked out yet.
 */
function localBillOf(b, taps, prices, now, offerPrice) {
  var base = LOCAL_BASE_HOURS[b && b.package];
  var from = taps && (taps.arrivedAt || taps.leftAt);
  if (!base || !from || !taps.doneAt) return null;
  var price = localPackagePrice(b, prices, offerPrice);
  if (!price) return null;
  var used = usedHours(from.getTime(), taps.doneAt.getTime(), LOCAL_GRACE_MIN);
  var extra = Math.max(0, used - base);
  var rate = Math.max(0, Math.round(Number(prices && prices.localExtraHour) || 0));
  return { amount: price + extra * rate, baseHours: base, usedHours: used, extraHours: extra, extraHourRate: rate, at: now };
}

/** A local job's clock start: his Arrived tap, when the booking has no clock start yet; null otherwise. */
function localClockStart(b, taps) {
  if (!b || !LOCAL_BASE_HOURS[b.package] || !taps || !taps.arrivedAt) return null;
  return b.clock && b.clock.startAt ? null : taps.arrivedAt;
}

/** A trip's taps → the booking's clock (firestore.rules isClock): Start; one-way: Job done = car dropped, Reached home; round: Job done = back home. */
function tapsClockOf(pkg, taps) {
  var kind = TRIP_TAP_KINDS[pkg];
  var c = {};
  if (!kind || !taps) return c;
  if (taps.leftAt) c.startAt = taps.leftAt;
  if (kind === 'one-way') {
    if (taps.doneAt) c.dropAt = taps.doneAt;
    if (taps.homeAt) c.homeAt = taps.homeAt;
  } else if (taps.doneAt) {
    c.homeAt = taps.doneAt;
  }
  return c;
}

/** "2026-10-08T15:30" → "3:30 pm" (the digits are India time, as written). '' if there is no time. */
function clockText(raw) {
  var m = String(raw == null ? '' : raw).match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
  if (!m) return '';
  var h = +m[1];
  return (((h + 11) % 12) + 1) + ':' + m[2] + ' ' + (h < 12 ? 'am' : 'pm');
}

/** epoch ms → India time in the booking form's format, "2026-10-08T15:30". */
function istStamp(ms) {
  return new Date(ms + 330 * 60000).toISOString().slice(0, 16);
}

function pushMsg_(token, text, data, channelId) {
  return { to: token, title: text.title, body: text.body, data: data, sound: 'default', priority: 'high', channelId: channelId || 'bookings' };
}

var AUTO_PUSH_TEXT = {
  en: {
    reminder: function (c) { return { title: 'Your driver is coming', body: 'Your driver ' + c.driver + ' arrives at ' + c.time + '.' }; },
    still: function () { return { title: 'Still finding your driver', body: 'Still finding your driver — we\'ll call you if it takes longer.' }; },
    review: function (c) { return { title: 'How was your driver?', body: 'How was your driver? Rate ' + c.driver + ' — tap to give 1 to 5 stars.' }; },
    thanks: function (c) { return { title: 'Thank you!', body: 'Glad ' + c.driver + ' drove well. Would you say so on Google? Tap to write a review.' }; },
  },
  hi: {
    reminder: function (c) { return { title: 'आपका ड्राइवर आ रहा है', body: 'आपके ड्राइवर ' + c.driver + ' ' + c.time + ' पर पहुँचेंगे।' }; },
    still: function () { return { title: 'ड्राइवर ढूँढ रहे हैं', body: 'अभी भी आपका ड्राइवर ढूँढ रहे हैं — देर हुई तो हम आपको कॉल करेंगे।' }; },
    review: function (c) { return { title: 'ड्राइवर कैसे थे?', body: c.driver + ' को रेटिंग दें — 1 से 5 स्टार, टैप करें।' }; },
    thanks: function (c) { return { title: 'धन्यवाद!', body: 'खुशी है कि ' + c.driver + ' के साथ सफ़र अच्छा रहा। Google पर रिव्यू लिखेंगे? टैप करें।' }; },
  },
};

/** One of the robot's own notifications to a customer, in the phone's language. kind: reminder | still | review | thanks. */
function autoPush(kind, c) {
  var texts = AUTO_PUSH_TEXT[c.language] || AUTO_PUSH_TEXT.en;
  var data = { bookingId: c.id };
  if (kind === 'review') data.action = 'rate';
  if (kind === 'thanks' && c.url) data.url = c.url;
  return pushMsg_(c.token, texts[kind]({ driver: c.driver || 'your driver', time: c.time || '' }), data);
}

function stillFindingPush(id, language, token) {
  return autoPush('still', { id: id, language: language, token: token });
}

/** The driver's reminder an hour before (English and Hindi, as job alerts): "Job at 3:30 pm · Shankar Nagar". */
function driverReminderPush(b, id, token) {
  var area = offerAreaOf(b.pickup) || b.city || '';
  return pushMsg_(token, { title: 'Job reminder · काम की याद', body: 'Job at ' + clockText(b.preferredTime) + ' · ' + area + (b.ref ? ' · ' + b.ref : '') }, { bookingId: id }, 'jobs');
}

/**
 * A given-back offer, open again as a fresh automatic offer: nobody's, from
 * the first step, to its whole zone — at the rate card's pay when it prices
 * the booking `b` (payBy 'rates'), else at the first % cut (payBy 'cut').
 */
function reopenedOffer(o, cut, now, b, rates, nearKm, drive) {
  var fields = {
    status: 'open', takenBy: null, takenAt: null, done: false, cities: zoneOf(o.city), cutPercent: cut,
    driverPay: driverPayOf(o.price, cut), createdAt: now, updatedAt: now, by: 'robot', payBy: 'cut',
  };
  var card = rateCardFields(b, o.price, rates, nearKm, drive);
  if (card) Object.keys(card).forEach(function (k) { fields[k] = card[k]; });
  return fields;
}

/** What a completed job costs the customer, from its bill: the local bill, else the trip's final bill; 0 = none. */
function billAmountOf(b) {
  var n = Number((b.localBill && b.localBill.amount) || (b.bill && b.bill.amount) || 0);
  return n >= 1 && n <= 1000000 ? Math.round(n) : 0;
}

/** The Razorpay Payment Link for a completed job (amount in paise; Razorpay texts the link to the customer). */
function razorpayLinkRequest(b, amount) {
  var phone = String(b.phone == null ? '' : b.phone).replace(/\D/g, '').slice(-10);
  return {
    amount: Math.round(amount) * 100,
    currency: 'INR',
    accept_partial: false,
    reference_id: String(b.ref || '').slice(0, 40),
    description: ('DriveBuddy ' + (b.ref || '') + ' · ' + packageName(b.package)).slice(0, 2048),
    customer: { name: oneLine(b.name).slice(0, 60), contact: '+91' + phone },
    notify: { sms: true, email: false },
    reminder_enable: true,
    notes: { booking: String(b.ref || '') },
  };
}

/* UPI without a gateway: the customer pays DriveBuddy's own UPI ID from the
   link in the app (or the QR the driver shows), and the driver confirms it.
   The same ID shape as a driver's UPI ID in firestore.rules. */
var UPI_ID_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/;

/** The UPI_ID property if it is a UPI ID, else '' (payments by UPI link stay off). */
function upiIdOf(raw) {
  var s = String(raw == null ? '' : raw).trim();
  return UPI_ID_RE.test(s) ? s : '';
}

/**
 * The UPI deep link ("upi://pay?…") every UPI app opens: DriveBuddy's ID and
 * name, the exact amount in rupees and the booking number as the note, so the
 * payment shows up in DriveBuddy's UPI app with its DB-number.
 */
function upiPayUrl(upiId, name, amount, ref) {
  var enc = encodeURIComponent;
  return 'upi://pay?pa=' + enc(upiId) + '&pn=' + enc(name) + '&am=' + Math.round(amount) + '.00&cu=INR&tn=' + enc(ref);
}

/** Which link a completed job gets: Razorpay's when its keys are set, else UPI when UPI_ID is, else none (''). */
function paymentLinkKind(razorpayKeys, upiId) {
  if (razorpayKeys) return 'razorpay';
  return upiId ? 'upi' : '';
}

/** The pending UPI payment on a booking (robot-only field; the customer app shows "Pay ₹750 by UPI"). */
function upiPayment(b, id, amount, upiId, name, now) {
  return { status: 'pending', method: 'upi', amount: amount, url: upiPayUrl(upiId, name || 'DriveBuddy', amount, b.ref || id), at: now };
}

/** What the driver collected: the bill (local bill, else the trip's final bill), else the pending link's; 0 = not known yet. */
function paidAmountOf(b) {
  var n = Number(billAmountOf(b) || (b.payment && b.payment.amount) || 0);
  return n >= 1 && n <= 1000000 ? Math.round(n) : 0;
}

/** The booking's payment once the driver tapped "Paid by UPI" / "Paid in cash"; null when it cannot be told yet. */
function driverPaidPayment(b, taps, now) {
  var method = taps && taps.paidBy;
  var amount = paidAmountOf(b);
  if ((method !== 'upi' && method !== 'cash') || !amount) return null;
  return { status: 'paid', method: method, amount: amount, paidAt: taps.paidAt || now, by: 'driver', at: now };
}

/** "DB-1042: Raju Sahu collected ₹750 by UPI" / "… in cash". */
function paidTelegramLine(ref, driverName, p) {
  return '💰 ' + escapeHtml(ref) + ': ' + escapeHtml(driverName || 'The driver') + ' collected ₹' + inr(p.amount) + (p.method === 'cash' ? ' in cash' : ' by UPI');
}

/** Ratings → { ratingAvg (1 decimal), ratingCount }. Anything but 1–5 whole stars is left out. */
function ratingSummary(list) {
  var stars = (list || []).map(function (r) { return r && r.stars; }).filter(function (n) { return Number.isInteger(n) && n >= 1 && n <= 5; });
  if (!stars.length) return { ratingAvg: 0, ratingCount: 0 };
  var sum = stars.reduce(function (a, n) { return a + n; }, 0);
  return { ratingAvg: Math.round((sum / stars.length) * 10) / 10, ratingCount: stars.length };
}

function lowRatingTelegram(c) {
  return {
    text: '⚠️ ' + escapeHtml(c.name) + '\'s rating is ' + c.ratingAvg + ' (' + c.ratingCount + ' ratings) — pause him in /admin?',
    reply_markup: { inline_keyboard: [[{ text: 'Open drivers in admin panel', url: c.siteUrl + '/admin/?tab=drivers' }]] },
  };
}

/** Cash a driver kept for a job (offers cashCollected, the robot's): whole rupees, 0 when none or odd. */
function cashOf(o) {
  var n = Number(o && o.cashCollected);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Offers to settle: taken, done and not paid yet → one group per driver, by
 * name. amount = what he earned (Σ driverPay), cash = what he kept from
 * customers (Σ cashCollected), net = amount − cash: DriveBuddy pays him net,
 * or (net < 0) collects −net from him.
 */
function payoutGroups(rows) {
  var by = {};
  (rows || []).forEach(function (r) {
    var o = r.data || {};
    if (o.status !== 'taken' || o.done !== true || o.paid === true || !o.takenBy || !o.takenBy.id) return;
    var g = by[o.takenBy.id] || (by[o.takenBy.id] = { driverId: o.takenBy.id, name: o.takenBy.name || '', amount: 0, cash: 0, net: 0, jobs: 0, offerIds: [], refs: [] });
    g.amount += Number(o.driverPay) || 0;
    g.cash += cashOf(o);
    g.net = g.amount - g.cash;
    g.jobs++;
    g.offerIds.push(r.id);
    if (o.ref) g.refs.push(o.ref);
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
}

/** DriveBuddy's cash a driver holds: what he kept beyond what he earned (0 when DriveBuddy owes him). */
function owedOf(g) {
  return Math.max(0, -((g && g.net) || 0));
}

/**
 * The week's settlement for one driver, with one button (callback
 * paid:<driverId>:<week>, which marks those jobs paid):
 *   net > 0  "Pay Raju Sahu ₹450 · UPI raju@okaxis · 3 jobs (earned ₹1,350 − cash he kept ₹900)"  Paid ✓
 *   net < 0  "Raju Sahu owes DriveBuddy ₹300 (cash he kept ₹1,200, earned ₹900) — collect it"      Settled ✓
 *   net = 0  "Raju Sahu: earned ₹900 = cash he kept · nothing to pay"                               Settled ✓
 * Without cash the first is the plain "Pay Raju Sahu ₹1,350 · UPI raju@okaxis · 3 jobs".
 */
function payoutTelegram(g, week) {
  var name = escapeHtml(g.name);
  var cash = g.cash || 0;
  var net = g.amount - cash;
  var jobs = g.jobs + ' job' + (g.jobs === 1 ? '' : 's');
  var line;
  if (net > 0) {
    line = 'Pay ' + name + ' ₹' + inr(net) + ' · ' +
      (g.upi ? 'UPI ' + escapeHtml(g.upi) : 'no UPI ID yet (he adds it in the Driver app, Earnings)') + ' · ' + jobs +
      (cash ? ' (earned ₹' + inr(g.amount) + ' − cash he kept ₹' + inr(cash) + ')' : '');
  } else if (net < 0) {
    line = name + ' owes DriveBuddy ₹' + inr(-net) + ' (cash he kept ₹' + inr(cash) + ', earned ₹' + inr(g.amount) + ') — collect it';
  } else {
    line = name + ': earned ₹' + inr(g.amount) + ' = cash he kept · nothing to pay';
  }
  return {
    text: line + (g.refs.length ? '\n' + escapeHtml(g.refs.join(', ')) : ''),
    reply_markup: { inline_keyboard: [[{ text: net > 0 ? 'Paid ✓' : 'Settled ✓', callback_data: 'paid:' + g.driverId + ':' + week }]] },
  };
}

/** payments.cashLimit from the site's config → whole rupees; 0 = no limit (not set, or odd). */
function cashLimitOf(payments) {
  var n = Math.round(Number(payments && payments.cashLimit));
  return n > 0 ? n : 0;
}

/** Is this driver (the robot's quality copy: { owed }) holding more cash than the limit? Never with no limit. */
function overCashLimit(q, cashLimit) {
  return cashLimit > 0 && Number(q && q.owed) > cashLimit;
}

/** The daily reminder to a driver over the limit (English and Hindi, as job alerts). */
function settlePush(token, owed) {
  var x = '₹' + inr(owed);
  return pushMsg_(token, {
    title: 'Settle your cash · नकद जमा करें',
    body: 'Settle ' + x + ' with DriveBuddy to get new jobs · नए काम के लिए DriveBuddy को ' + x + ' जमा करें',
  }, { action: 'earnings' }, 'jobs');
}

/** Telegram, once, when a driver crosses the cash limit: why he gets no jobs, and his settlement with its Settled ✓ button. */
function cashLimitTelegram(g, limit, day) {
  var msg = payoutTelegram(g, day);
  return {
    text: '💵 <b>' + escapeHtml(g.name) + ' holds ₹' + inr(owedOf(g)) + ' of DriveBuddy\'s cash</b> — over the ₹' + inr(limit) +
      ' limit, so he gets no new job alerts until he settles.\n' + msg.text,
    reply_markup: msg.reply_markup,
  };
}

/** "paid:<driverId>:2026-11-23" → { driverId, week }, or null. */
function parsePaidCallback(data) {
  var m = /^paid:([A-Za-z0-9_-]{1,40}):(\d{4}-\d{2}-\d{2})$/.exec(String(data == null ? '' : data));
  return m ? { driverId: m[1], week: m[2] } : null;
}

/** What the customer paid for a job: the payment, the bill, the agreed price, else the offer's price. */
function amountOf(b, offerPrice) {
  return Number((b.payment && b.payment.amount) || billAmountOf(b) || agreedPriceOf(b) || offerPrice || 0);
}

/**
 * The day in numbers from the report's queries (see sendDailyReport_):
 * created / changed today, offers changed today, open offers, unpaid offers,
 * online drivers.
 */
function dailySummary(q, now) {
  var counts = { new: 0, confirmed: 0, assigned: 0, completed: 0, cancelled: 0 };
  q.created.forEach(function (r) { if (counts[r.data.status] !== undefined) counts[r.data.status]++; });
  var offers = {};
  q.offersToday.forEach(function (r) { offers[r.id] = r.data; });
  var done = q.changed.filter(function (r) { return r.data.status === 'completed'; });
  var revenue = 0;
  var cut = 0;
  done.forEach(function (r) {
    var o = offers[r.id];
    revenue += amountOf(r.data, o && o.price);
    if (o && o.done === true && o.status === 'taken') cut += (Number(o.price) || 0) - (Number(o.driverPay) || 0);
  });
  var payouts = payoutGroups(q.unpaid);
  var toPay = payouts.filter(function (g) { return g.net > 0; });
  var toCollect = payouts.filter(function (g) { return g.net < 0; });
  // Payments taken today (payment.paidAt), by how; completed today and not paid.
  var midnight = Date.parse(istDay(now) + 'T00:00:00+05:30');
  var pay = { upi: { amount: 0, n: 0 }, cash: { amount: 0, n: 0 }, online: { amount: 0, n: 0 }, unpaid: { amount: 0, n: 0 } };
  (q.paidToday || []).forEach(function (r) {
    var p = r.data.payment;
    if (!p || p.status !== 'paid' || !p.paidAt || p.paidAt.getTime() < midnight) return;
    var k = p.method === 'upi' || p.method === 'cash' ? p.method : 'online';
    pay[k].amount += Number(p.amount) || 0;
    pay[k].n++;
  });
  done.forEach(function (r) {
    var p = r.data.payment;
    if (p && p.status === 'paid') return;
    var o = offers[r.id];
    var amount = amountOf(r.data, o && o.price);
    if (!amount) return;
    pay.unpaid.amount += amount;
    pay.unpaid.n++;
  });
  return {
    day: formatIst(new Date(now)).split(',')[0],
    total: q.created.length,
    counts: counts,
    revenue: revenue,
    completedJobs: done.length,
    cut: cut,
    open: q.open.filter(function (r) { return r.data.status === 'open'; }).map(function (r) { return r.data.ref || r.id; }),
    online: q.online.filter(function (r) { return r.data.online === true && r.data.at && now - r.data.at.getTime() <= DISPATCH.freshMs; }).length,
    payments: pay,
    payoutAmount: toPay.reduce(function (a, g) { return a + g.net; }, 0),
    payoutDrivers: toPay.length,
    collectAmount: toCollect.reduce(function (a, g) { return a + owedOf(g); }, 0),
    collectDrivers: toCollect.length,
  };
}

function dailyReportText(s) {
  var c = s.counts;
  var p = s.payments || { upi: { amount: 0, n: 0 }, cash: { amount: 0, n: 0 }, online: { amount: 0, n: 0 }, unpaid: { amount: 0, n: 0 } };
  var part = function (label, x) { return label + ' ₹' + inr(x.amount) + ' (' + x.n + ')'; };
  var plural = function (n) { return n + ' driver' + (n === 1 ? '' : 's'); };
  var payouts = s.payoutDrivers ? '₹' + inr(s.payoutAmount) + ' to ' + plural(s.payoutDrivers) : 'none';
  if (s.collectDrivers) payouts += ' · ₹' + inr(s.collectAmount) + ' to collect from ' + plural(s.collectDrivers);
  return [
    '📊 <b>DriveBuddy today — ' + escapeHtml(s.day) + '</b>',
    '',
    '<b>Bookings:</b> ' + s.total + ' (new ' + c.new + ' · confirmed ' + c.confirmed + ' · with driver ' + c.assigned +
      ' · completed ' + c.completed + ' · cancelled ' + c.cancelled + ')',
    '<b>Revenue:</b> ₹' + inr(s.revenue) + ' from ' + s.completedJobs + ' completed job' + (s.completedJobs === 1 ? '' : 's'),
    '<b>DriveBuddy\'s cut:</b> ₹' + inr(s.cut),
    '<b>Jobs nobody took:</b> ' + (s.open.length ? s.open.length + ' still open — ' + escapeHtml(s.open.join(', ')) : 'none'),
    '<b>Drivers online now:</b> ' + s.online,
    '<b>Payments today:</b> ' + part('UPI', p.upi) + ' · ' + part('cash', p.cash) + (p.online.n ? ' · ' + part('online', p.online) : '') +
      ' · ' + part('unpaid', p.unpaid),
    '<b>Payouts due:</b> ' + payouts,
  ].join('\n');
}

/* --------------------------------------------------------- the robot's notes */

function bookOf_(id) {
  return fsGet_('reminders/' + id) || {};
}

function saveBook_(id, fields) {
  fsCommit_([{ update: { name: docName_('reminders/' + id), fields: toFields(fields) }, updateMask: { fieldPaths: Object.keys(fields) } }]);
}

/** A timeline entry written by the robot. */
function robotEvent_(id, from, to, note, at) {
  return {
    update: {
      name: docName_('bookings/' + id + '/events/' + Utilities.getUuid().replace(/-/g, '')),
      fields: toFields({ type: 'status', from: from, to: to, note: String(note).slice(0, 500), by: 'robot', at: at }),
    },
    currentDocument: { exists: false },
  };
}

/** The robot's copy of each driver's ratingAvg, ratingCount and strikes, for ranking without reading every driver each minute. */
function driverQuality_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('driverQuality') || '{}') || {};
  } catch (err) {
    return {};
  }
}

function saveDriverQuality_(id, patch) {
  var q = driverQuality_();
  q[id] = Object.assign({}, q[id] || {}, patch);
  PropertiesService.getScriptProperties().setProperty('driverQuality', JSON.stringify(q));
}

function telegramLine_(text) {
  try { sendTelegram_({ text: text }); } catch (err) { console.warn('telegram: ' + err); }
}

/* ----------------------------------------------------- what changed, at once */

/**
 * The apps' news since the last look, in one round trip (fsQueryAll_):
 * bookings changed (instant confirmations, completions, takes — the shared
 * query the later steps reuse), prices accepted, jobs given back (every 4
 * minutes and on a doorbell; the Driver app rings it), then the drivers'
 * taps on their current jobs in one batch read (tapsWatch_). Each has its
 * own bookmark, and one that fails never stops the others.
 */
function watchChanges_() {
  confirmedThisRun_ = {};
  // Prices accepted and jobs given back: each every 4 minutes (in turn), and always on a doorbell.
  var m = nowDate_().getMinutes();
  var all = !inRun_ || pingRun_;
  var jobs = [{ spec: bookingStreamSpec_(), mark: 'robotBookingsMs', run: changedBookings_ }];
  if (all || m % 4 === 2) jobs.push({ spec: sinceSpec_('bookings', 'acceptedPriceMs', 'acceptedPrice.at'), run: acceptedPrices_ });
  if (all || m % 4 === 0) jobs.push({ spec: { collection: 'offers', where: fieldFilter_('status', 'EQUAL', 'released'), field: 'status', limit: 20 }, run: releasedOffers_ });
  var results = fsQueryAll_(jobs.map(function (j) { return j.spec; }));
  if (!results[0].error) keepStream_(results[0].rows);
  jobs.forEach(function (j, i) {
    try {
      var r = results[i];
      if (r.error) throw r.error;
      if (j.mark) sinceRun_(sinceSpec_('bookings', j.mark), r.rows, j.run);
      else if (j.spec.bookmark) sinceRun_(j.spec, r.rows, j.run);
      else if (r.rows.length) j.run(r.rows);
    } catch (err) {
      console.error(j.run.name + ': ' + (err && err.stack || err));
    }
  });
  try {
    tapsWatch_();
  } catch (err) {
    console.error('tapsWatch_: ' + (err && err.stack || err));
  }
}

/** A doorbell run (ping_): everything the apps may have just changed is looked at. */
var pingRun_ = false;

/* ----------------------------------------------- the drivers' current jobs
   activeJobs (script property, kept small: a property holds 9 KB):
   { bookingId: { p: his phone's last 4 digits, f: a short hash of his taps
   as last seen, q: 1 once "payment received" was seen, u: until when (epoch
   minutes) a completed job is watched for that tap } }; at most
   ACTIVE_JOBS_MAX, the oldest completed ones dropped first. Kept from the changed bookings (assigned →
   watched; completed → three more days; anything else → dropped), started
   from Firestore the first time, checked again every night. Their taps are
   read in one batch (one call however many jobs), and only a job whose taps
   changed is worked on. */
var TAPS_WATCH_DONE_MS = 3 * 86400000;
var ACTIVE_JOBS_MAX = 90;

function activeJobs_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('activeJobs') || 'null');
  } catch (err) {
    return null;
  }
}

function saveActiveJobs_(jobs) {
  var ids = Object.keys(jobs);
  if (ids.length > ACTIVE_JOBS_MAX) {
    // Too many: the completed ones closest to the end of their watch go first (assigned jobs always stay).
    ids.filter(function (id) { return jobs[id].u; })
      .sort(function (a, b) { return jobs[a].u - jobs[b].u; })
      .slice(0, ids.length - ACTIVE_JOBS_MAX)
      .forEach(function (id) { delete jobs[id]; });
  }
  PropertiesService.getScriptProperties().setProperty('activeJobs', JSON.stringify(jobs));
}

/** The last 4 digits of a phone: enough to see that the job has another driver. */
function phoneTail_(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-4);
}

/** Changed bookings → the jobs to watch (changes `jobs`). */
function noteActiveJobs_(rows, jobs) {
  var changed = false;
  (rows || []).forEach(function (row) {
    var b = row.data || {};
    var d = b.assignedDriver;
    var phone = d && d.phone ? phoneTail_(d.phone) : '';
    var had = jobs[row.id];
    var same = had && had.p === phone;
    if (b.status === 'assigned' && phone) {
      if (!same || had.u) { jobs[row.id] = { p: phone, f: same ? had.f : '', q: same ? had.q || 0 : 0 }; changed = true; }
    } else if (b.status === 'completed' && phone) {
      var until = Math.floor(((b.updatedAt ? b.updatedAt.getTime() : Date.now()) + TAPS_WATCH_DONE_MS) / 60000);
      if (!same || had.u !== until) { jobs[row.id] = { p: phone, f: same ? had.f : '', q: same ? had.q || 0 : 0, u: until }; changed = true; }
    } else if (had) {
      delete jobs[row.id];
      changed = true;
    }
  });
  return changed;
}

/** The first time: every assigned booking, and those completed in the last three days. */
function bootstrapActiveJobs_() {
  var res = fsQueryAll_([
    { collection: 'bookings', where: fieldFilter_('status', 'EQUAL', 'assigned'), field: 'status', limit: 300 },
    { collection: 'bookings', where: fieldFilter_('updatedAt', 'GREATER_THAN_OR_EQUAL', new Date(Date.now() - TAPS_WATCH_DONE_MS)), field: 'updatedAt', limit: 500 },
  ]);
  var jobs = {};
  res.forEach(function (r) {
    if (r.error) throw r.error;
    noteActiveJobs_(r.rows.filter(function (row) { return row.data.status === 'assigned' || row.data.status === 'completed'; }), jobs);
  });
  return jobs;
}

/** Nightly: the assigned jobs from Firestore itself (a missed change never leaves a job unwatched for long). */
function reconcileActiveJobs_(assignedRows) {
  var jobs = activeJobs_() || {};
  Object.keys(jobs).forEach(function (id) { if (!jobs[id].u) delete jobs[id]; });
  noteActiveJobs_(assignedRows, jobs);
  saveActiveJobs_(jobs);
}

function msOf_(d) {
  return d && d.getTime ? d.getTime() : '';
}

/** A taps document as a short hash (8 hex digits), to see whether it changed; '' for none. */
function tapsPrint(t) {
  if (!t) return '';
  var text = [t.driverPhone || '', msOf_(t.leftAt), msOf_(t.arrivedAt), msOf_(t.doneAt), msOf_(t.homeAt), t.paidBy || '', msOf_(t.paidAt)].join('|');
  var h = 5381;
  for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return ('0000000' + h.toString(16)).slice(-8);
}

/**
 * The drivers' taps on their current jobs: one batch read; a job whose taps
 * changed goes to syncTaps_ (Start, Arrived, Job done, Reached home) and, at
 * a new "payment received", to takePayment_. A completed job whose payment
 * the driver has confirmed is no longer watched.
 */
function tapsWatch_() {
  var jobs = activeJobs_();
  var changed = false;
  if (!jobs) {
    jobs = bootstrapActiveJobs_();
    changed = true;
  }
  var nowMin = Date.now() / 60000;
  Object.keys(jobs).forEach(function (id) {
    if (jobs[id].u && jobs[id].u < nowMin) {
      delete jobs[id];
      changed = true;
    }
  });
  var ids = Object.keys(jobs);
  if (ids.length) {
    var docs = fsBatchGet_(ids.map(function (id) { return 'tripTaps/' + id; }));
    ids.forEach(function (id) {
      var e = jobs[id];
      var t = docs['tripTaps/' + id] || null;
      var fp = tapsPrint(t);
      if (fp === (e.f || '')) return;
      try {
        if (t) {
          syncTaps_(id, t);
          if (t.paidBy && !e.q) {
            var b = fsGet_('bookings/' + id);
            takePayment_(id, b, t, true);
            if (b && b.status === 'completed') {
              delete jobs[id];
              changed = true;
              return;
            }
            e.q = 1;
          }
        }
        e.f = fp;
        changed = true;
      } catch (err) {
        console.error('taps of ' + id + ': ' + (err && err.stack || err)); // tried again next time (e.f unchanged)
      }
    });
  }
  if (changed) saveActiveJobs_(jobs);
}

/**
 * Bookings that changed: confirm the simple ones, confirm a new driver (or
 * ask the office to call one who took it in the app), record a payment the driver
 * confirmed before the bill was saved, and take completed ones on (payment
 * link, rating request). All safe to repeat.
 */
function changedBookings_(rows) {
  var jobs = activeJobs_();
  if (jobs && noteActiveJobs_(rows, jobs)) saveActiveJobs_(jobs);
  instantConfirm_(rows);
  confirmAssignments_(rows, false);
  paymentsAwaitingBill_(rows);
  completedBookings_(rows);
}

/* ------------------------------------------------------- instant booking */

function confirmByRobot_(id) {
  var now = new Date();
  fsCommit_([
    {
      update: { name: docName_('bookings/' + id), fields: toFields({ status: 'confirmed', updatedAt: now, updatedBy: 'robot' }) },
      updateMask: { fieldPaths: ['status', 'updatedAt', 'updatedBy'] },
      currentDocument: { exists: true },
    },
    robotEvent_(id, 'new', 'confirmed', 'Confirmed automatically', now),
  ]);
}

/** Bookings this run confirmed (Apps Script starts every run with fresh globals). */
var confirmedThisRun_ = {};

function acceptedLine_(b, id) {
  return '✅ <b>' + escapeHtml(b.ref || id) + ' auto-confirmed</b>: the customer accepted ₹' + inr(b.acceptedPrice.amount) + ' in the app. It goes to drivers now.';
}

/**
 * A logged-in customer's 1 hour / 3 hours (the new-booking alert already said
 * "auto-confirmed"), or a price accepted before the booking was numbered:
 * confirmed now.
 */
function instantConfirm_(rows) {
  var setting = prop_('INSTANT_BOOKINGS');
  rows.forEach(function (row) {
    var b = row.data;
    if (!instantConfirmable(b, setting)) return;
    confirmByRobot_(row.id);
    confirmedThisRun_[row.id] = true;
    b.status = 'confirmed';
    if (b.acceptedPrice) telegramLine_(acceptedLine_(b, row.id));
  });
}

/**
 * The customer tapped "Accept price" in the app. A new booking is confirmed
 * (unless INSTANT_BOOKINGS = off); a confirmed one without a driver is
 * offered to drivers at that price (its updatedAt moves so autoOffers_ sees it).
 */
function acceptedPrices_(rows) {
  var setting = prop_('INSTANT_BOOKINGS');
  rows.forEach(function (row) {
    if (confirmedThisRun_[row.id]) return; // instantConfirm_ just did, and said so
    var b = fsGet_('bookings/' + row.id); // fresh: this minute's other steps may have moved it
    // Not numbered yet: instantConfirm_ takes it once the robot numbers it.
    if (!b || !b.acceptedPrice || !b.ref) return;
    var ref = escapeHtml(b.ref);
    var amount = '₹' + inr(b.acceptedPrice.amount);
    if (b.status === 'new' && instantConfirmable(b, setting)) {
      confirmByRobot_(row.id);
      telegramLine_(acceptedLine_(b, row.id));
    } else if (b.status === 'new') {
      telegramLine_('💬 ' + ref + ': the customer accepted ' + amount + ' in the app. Confirm it in /admin.');
    } else if (b.status === 'confirmed' && !b.assignedDriver) {
      fsCommit_([{
        update: { name: docName_('bookings/' + row.id), fields: toFields({ updatedAt: new Date(), updatedBy: 'robot' }) },
        updateMask: { fieldPaths: ['updatedAt', 'updatedBy'] },
        currentDocument: { exists: true },
      }]);
      telegramLine_('💬 ' + ref + ': the customer accepted ' + amount + ' in the app. Offering it to drivers at that price.');
    }
  });
}

/* ------------------------------------------------------- jobs given back */

/** "Can't make it": open the offer again from the first step (never to him), and count a strike. */
function releasedOffers_(rows) {
  var cut = autoCuts(prop_('AUTO_OFFER_CUTS'))[0];
  rows.forEach(function (row) {
    var o = row.data;
    var who = o.takenBy || {};
    var b = fsGet_('bookings/' + row.id);
    var now = new Date();
    var reopen = Boolean(b && b.status === 'confirmed' && !b.assignedDriver);
    if (reopen) {
      var rates = driverRates_();
      var fields = reopenedOffer(o, cut, now, b, rates, rates && b.trip ? siteNearKm_() : 0, rates && b.trip ? siteDrive_() : null);
      fsCommit_([
        {
          update: { name: docName_('offers/' + row.id), fields: toFields(fields) },
          updateMask: { fieldPaths: Object.keys(fields) },
          currentDocument: { exists: true },
        },
        {
          // His confirmation goes with him (in the mask, not in the fields: removed), so a later take is asked about afresh.
          update: { name: docName_('bookings/' + row.id), fields: {} },
          updateMask: { fieldPaths: ['driverConfirmed'] },
          currentDocument: { exists: true },
        },
        {
          update: {
            name: docName_('offerAlerts/' + row.id),
            fields: toFields({
              stage: 0, stageAt: now, alerted: [], skipIds: who.id ? [who.id] : [], widenedAt: null, stillPushedAt: null,
              basePay: fields.payBy === 'rates' ? fields.driverPay : null,
            }),
          },
        },
      ]);
      dispatchOn_();
    } else {
      // Assigned by hand or cancelled meanwhile: nothing to offer.
      fsCommit_([{
        update: { name: docName_('offers/' + row.id), fields: toFields({ status: 'withdrawn', updatedAt: now }) },
        updateMask: { fieldPaths: ['status', 'updatedAt'] },
        currentDocument: { exists: true },
      }]);
    }
    var strikes = 0;
    if (who.id) {
      var d = fsGet_('drivers/' + who.id);
      if (d) {
        fsCommit_([{
          update: { name: docName_('drivers/' + who.id), fields: {} },
          updateMask: { fieldPaths: [] },
          updateTransforms: [{ fieldPath: 'strikes', increment: { integerValue: '1' } }],
          currentDocument: { exists: true },
        }]);
        strikes = (Number(d.strikes) || 0) + 1;
        saveDriverQuality_(who.id, { strikes: strikes });
      }
    }
    telegramLine_('↩️ <b>' + escapeHtml(who.name || 'A driver') + ' gave back ' + escapeHtml(o.ref || row.id) + '</b> (can\'t make it, before starting)' +
      (strikes ? ' — strike ' + strikes : '') + '. ' +
      (reopen ? 'Offered to drivers again from the start.' : 'The booking had changed, so the offer is closed.'));
  });
}

/* ------------------------------------------------- call to confirm a take */

/** Minutes after a take before Telegram reminds that nobody confirmed the driver by call; and how long a question waits at most. */
var CONFIRM_REMIND_MIN = 15;
var CONFIRM_KEEP_MS = 24 * 3600 * 1000;

/** "conf:<bookingId>" / "redo:<bookingId>" → { action, bookingId }, or null. */
function parseConfirmCallback(data) {
  var m = /^(conf|redo):([A-Za-z0-9_-]{1,59})$/.exec(String(data == null ? '' : data));
  return m ? { action: m[1], bookingId: m[2] } : null;
}

/** "2026-11-22T15:30" → "Sun 3:30 pm" (India time, as written); no time → "ASAP". */
function shortWhen(raw) {
  var m = String(raw == null ? '' : raw).match(/^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}/);
  if (!m) return 'ASAP';
  return DAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] + ' ' + clockText(raw);
}

function confirmButtons(id) {
  return { inline_keyboard: [[{ text: 'Confirmed ✓', callback_data: 'conf:' + id }, { text: 'Give to someone else', callback_data: 'redo:' + id }]] };
}

/**
 * The office's question when a driver takes a job in the app:
 * "<b>DB-1042</b>: Raju Sahu took it — call him to confirm · 98933 02783 · 3 hours · Sun 3:30 pm · Shankar Nagar",
 * the number a tel: link. plainPhone: the number as "+91 98933 02783"
 * instead (Telegram makes that tap-to-call by itself), for a chat that
 * refuses the link.
 */
function confirmTelegram(b, id, plainPhone) {
  var d = b.assignedDriver || {};
  var digits = String(d.phone == null ? '' : d.phone).replace(/\D/g, '').slice(-10);
  var phone = plainPhone ? escapeHtml(prettyPhone(digits)) : '<a href="tel:+91' + digits + '">' + escapeHtml(sheetPhone(digits)) + '</a>';
  return {
    text: '<b>' + escapeHtml(b.ref || id) + '</b>: ' + escapeHtml(d.name || 'A driver') + ' took it — call him to confirm · ' + phone + ' · ' +
      escapeHtml(packageName(b.package)) + ' · ' + escapeHtml(shortWhen(b.preferredTime)) + ' · ' + escapeHtml(offerAreaOf(b.pickup) || b.city || ''),
    reply_markup: confirmButtons(id),
  };
}

/** Once, 15 minutes after the take, if nobody pressed a button. */
function confirmReminderTelegram(e, id) {
  return {
    text: '⏰ <b>' + escapeHtml(e.ref || id) + '</b>: ' + escapeHtml(e.name || 'the driver') + ' is not confirmed by call yet (' + CONFIRM_REMIND_MIN +
      ' minutes since he took it) · ' + escapeHtml(prettyPhone(e.phone)),
    reply_markup: confirmButtons(id),
  };
}

/** The driver's phone, when the office gave his job to someone else (English and Hindi, as job alerts). */
function givenAwayPush(token, id) {
  return pushMsg_(token, {
    title: 'Job given to another driver · काम दूसरे ड्राइवर को',
    body: 'DriveBuddy gave this job to another driver · यह काम किसी दूसरे ड्राइवर को दिया गया',
  }, { bookingId: id, action: 'given-away' }, 'jobs');
}

function confirmByCallOn_() {
  return String(prop_('CONFIRM_BY_CALL')).trim().toLowerCase() !== 'off';
}

/** Takes waiting for Confirmed ✓ / Give to someone else: { bookingId: { key, driverId, name, phone, ref, at, reminded } }. */
function confirmsPending_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('confirmsPending') || '{}') || {};
  } catch (err) {
    return {};
  }
}

function saveConfirmsPending_(pending) {
  PropertiesService.getScriptProperties().setProperty('confirmsPending', JSON.stringify(pending));
}

/** Has the office (or the robot) confirmed this booking's driver `driverId`? (booking.driverConfirmed) */
function confirmedFor(b, driverId) {
  var c = b && b.driverConfirmed;
  return Boolean(c && driverId && c.driverId === driverId);
}

/** The booking's driverConfirmed (robot-written; the Driver app sees the customer's details only once it is there). */
function writeDriverConfirmed_(id, by, driverId) {
  fsCommit_([{
    update: { name: docName_('bookings/' + id), fields: toFields({ driverConfirmed: { at: new Date(), by: by, driverId: driverId } }) },
    updateMask: { fieldPaths: ['driverConfirmed'] },
    currentDocument: { exists: true },
  }]);
}

/** Was this booking's job taken by this driver in the Driver app (his offer)? */
function takenInApp_(id, b, driverId) {
  if (String(b.updatedBy || '').indexOf('driver-') === 0) return true;
  var o = fsGet_('offers/' + id);
  return Boolean(o && o.status === 'taken' && o.takenBy && o.takenBy.id === driverId);
}

/**
 * Assigned bookings without a confirmed driver. The driver sees the
 * customer's name, number and address only once booking.driverConfirmed is
 * his (firestore.rules), so:
 *   • a driver took it in the app — the take writes the booking as assigned,
 *     updatedBy "driver-<phone>", which the robot's changed-bookings check
 *     sees without reading the offers: Telegram asks the office to call him,
 *     once per take (CONFIRM_BY_CALL = off: confirmed at once, by 'auto');
 *   • the office assigned him itself (/admin normally writes it in the same
 *     batch; this covers older panels): confirmed, by 'office'.
 * backfill: the one-time pass over every assigned booking (confirmBackfill_).
 */
function confirmAssignments_(rows, backfill) {
  var askByCall = confirmByCallOn_();
  var pending = null;
  rows.forEach(function (row) {
    var b = row.data;
    var d = b.assignedDriver;
    if (b.status !== 'assigned' || !d || !d.id || confirmedFor(b, d.id)) return;
    if (!takenInApp_(row.id, b, d.id)) return writeDriverConfirmed_(row.id, 'office', d.id);
    if (!askByCall) return writeDriverConfirmed_(row.id, 'auto', d.id);
    var take = String(b.updatedBy || '').indexOf('driver-') === 0 && b.updatedAt && !backfill;
    var key = d.id + '@' + (take ? b.updatedAt.getTime() : 'seen');
    pending = pending || confirmsPending_();
    var had = pending[row.id];
    // An office edit of a taken job (or the backfill): ask only if he was never asked about.
    if (had && (take ? had.key === key : had.driverId === d.id)) return;
    var asked = String(bookOf_(row.id).confirmAskedFor || '');
    if (take ? asked === key : asked.indexOf(d.id + '@') === 0) return;
    var sent = sendTelegram_(confirmTelegram(b, row.id, false));
    if (sent === 'failed') sent = sendTelegram_(confirmTelegram(b, row.id, true));
    if (sent === 'off') return;
    var at = take ? b.updatedAt.getTime() : Date.now();
    pending[row.id] = { key: key, driverId: d.id, name: d.name || '', phone: String(d.phone || ''), ref: b.ref || '', at: at, reminded: false };
    saveBook_(row.id, { confirmAskedFor: key });
  });
  if (pending) saveConfirmsPending_(pending);
}

/**
 * Once, after this version is pasted (flag: script property
 * driverConfirmBackfill = v1; delete it to run again): every booking assigned
 * now gets its confirmation — office-assigned ones by 'office', so they stay
 * on the drivers' phones under the new rules; ones taken in the app wait for
 * the office's call (the Telegram question, if it was not sent already).
 * Publish the new firestore.rules only after this has run.
 */
function confirmBackfill_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('driverConfirmBackfill') === 'v1') return;
  var rows = fsQuery_('bookings', fieldFilter_('status', 'EQUAL', 'assigned'), 'ASCENDING', 500, 'status');
  confirmAssignments_(rows, true);
  props.setProperty('driverConfirmBackfill', 'v1');
  console.log('driverConfirmed backfill: ' + rows.length + ' assigned bookings checked');
}

/** Is this booking still the job this question is about: assigned to that driver? */
function stillHisJob_(b, e) {
  return Boolean(b && b.status === 'assigned' && b.assignedDriver && b.assignedDriver.id === e.driverId);
}

/** Every minute (with the button presses): one reminder 15 minutes after a take nobody confirmed; questions about changed jobs are dropped. */
function confirmReminders_(pending, now) {
  var changed = false;
  Object.keys(pending).forEach(function (id) {
    var e = pending[id];
    if (now - (e.at || 0) > CONFIRM_KEEP_MS) {
      delete pending[id];
      changed = true;
      return;
    }
    if (e.reminded || now - (e.at || 0) < CONFIRM_REMIND_MIN * 60000) return;
    changed = true;
    var b = fsGet_('bookings/' + id);
    if (!stillHisJob_(b, e) || confirmedFor(b, e.driverId)) {
      delete pending[id]; // confirmed in /admin, given to someone else, cancelled …: nothing to ask
      return;
    }
    e.reminded = true;
    sendTelegramSafe_(confirmReminderTelegram(e, id));
  });
  return changed;
}

/**
 * Give to someone else: the booking back to confirmed with no driver and the
 * offer out again as a fresh automatic cycle, never to him — like a job he
 * gave back, but no strike (it was the office's call). Not once he has
 * tapped Start. → '' when done, else why not.
 */
function giveToAnother_(id, b, e) {
  var taps = fsGet_('tripTaps/' + id);
  if (taps && taps.leftAt) return 'He has already tapped Start — call him, or change the driver in /admin.';
  var o = fsGet_('offers/' + id);
  if (!o || o.status !== 'taken' || !o.takenBy || o.takenBy.id !== e.driverId) return 'There is no job offer of his to send out again — change the driver in /admin.';
  var alert = fsGet_('offerAlerts/' + id) || {};
  var skip = (alert.skipIds || []).slice();
  if (skip.indexOf(e.driverId) < 0) skip.push(e.driverId);
  var now = new Date();
  var rates = driverRates_();
  var fields = reopenedOffer(o, autoCuts(prop_('AUTO_OFFER_CUTS'))[0], now, b, rates, rates && b.trip ? siteNearKm_() : 0, rates && b.trip ? siteDrive_() : null);
  fsCommit_([
    {
      // driverConfirmed is in the mask but not the fields: removed, it was about him.
      update: { name: docName_('bookings/' + id), fields: toFields({ status: 'confirmed', assignedDriver: null, updatedAt: now, updatedBy: 'robot' }) },
      updateMask: { fieldPaths: ['status', 'assignedDriver', 'updatedAt', 'updatedBy', 'driverConfirmed'] },
      currentDocument: { exists: true },
    },
    robotEvent_(id, 'assigned', 'confirmed', 'Office gave it to another driver', now),
    {
      update: { name: docName_('offers/' + id), fields: toFields(fields) },
      updateMask: { fieldPaths: Object.keys(fields) },
      currentDocument: { exists: true },
    },
    {
      update: {
        name: docName_('offerAlerts/' + id),
        fields: toFields({ stage: 0, stageAt: now, alerted: [], skipIds: skip, widenedAt: null, stillPushedAt: null, basePay: fields.payBy === 'rates' ? fields.driverPay : null }),
      },
    },
  ]);
  dispatchOn_();
  var av = fsGet_('availability/' + e.driverId);
  if (av && av.pushToken) sendPush_([givenAwayPush(av.pushToken, id)]);
  return '';
}

/** A Confirmed ✓ / Give to someone else press from the office's chat. Changes `pending`. */
function confirmPress_(cq, c, pending) {
  var answer = function (text) { telegramApi_('answerCallbackQuery', { callback_query_id: cq.id, text: text }); };
  var e = pending[c.bookingId];
  if (!e) return answer('Already handled.');
  var b = fsGet_('bookings/' + c.bookingId);
  if (!stillHisJob_(b, e)) {
    delete pending[c.bookingId];
    return answer('The job has changed (it is not ' + firstName(e.name) + '\'s any more) — nothing done.');
  }
  var word;
  if (c.action === 'conf') {
    // Confirmed in /admin meanwhile: that stands (and counts as done here).
    if (confirmedFor(b, e.driverId)) {
      word = 'Confirmed ✓ (already' + (b.driverConfirmed.by === 'admin' || b.driverConfirmed.by === 'office' ? ', in /admin' : '') + ')';
    } else {
      writeDriverConfirmed_(c.bookingId, 'telegram', e.driverId);
      word = 'Confirmed ✓';
    }
  } else {
    var why = giveToAnother_(c.bookingId, b, e);
    if (why) return answer(why);
    word = 'Offered again ✓';
  }
  delete pending[c.bookingId];
  answer(word);
  telegramApi_('editMessageText', {
    chat_id: cq.message.chat.id,
    message_id: cq.message.message_id,
    text: String(cq.message.text || '') + '\n\n' + word + ' ' + formatIst(new Date()),
  });
}

/* ------------------------------------------------------- the driver's taps */

/**
 * One booking's taps. A trip: Start / Job done / Reached home become the
 * clock (Telegram hears each step once, as with the trip link). A local job:
 * at Arrived the clock's start (the customer's live meter), at Job done the
 * bill, completed, and the offer done. Safe to repeat.
 */
function syncTaps_(id, taps) {
  var b = fsGet_('bookings/' + id);
  if (!b || b.status === 'cancelled') return;
  // Taps from a driver who no longer has the job (the office gave it to
  // someone else after he tapped Start) are not this trip's.
  if (!b.assignedDriver || String(b.assignedDriver.phone || '') !== String(taps.driverPhone || '')) return;
  if (TRIP_TAP_KINDS[b.package]) {
    var clock = tapsClockOf(b.package, taps);
    if (!clock.startAt) return;
    var news = tripClockNews(b.clock, clock);
    if (!sameClock(b.clock, clock)) {
      fsCommit_([{
        update: { name: docName_('bookings/' + id), fields: toFields({ clock: clock }) },
        updateMask: { fieldPaths: ['clock'] },
        currentDocument: { exists: true },
      }]);
    }
    var link = {
      ref: b.ref, to: (b.trip && b.trip.to) || '?', kind: TRIP_TAP_KINDS[b.package], driverName: (b.assignedDriver && b.assignedDriver.name) || '',
      startAt: clock.startAt, dropAt: clock.dropAt, homeAt: clock.homeAt,
    };
    news.forEach(function (step) {
      sendTelegram_(tripTelegram({ link: link, step: step, booking: b, id: id, siteUrl: prop_('SITE_URL') }));
    });
    return;
  }
  if (!LOCAL_BASE_HOURS[b.package] || b.status !== 'assigned') return;
  // A local job's meter for the customer: it starts when the driver taps Arrived
  // (clock.startAt, once; the bill — localBill — marks the end).
  var startAt = localClockStart(b, taps);
  if (startAt) {
    fsCommit_([{
      update: { name: docName_('bookings/' + id), fields: toFields({ clock: { startAt: startAt } }) },
      updateMask: { fieldPaths: ['clock'] },
      currentDocument: { exists: true },
    }]);
  }
  if (!taps.doneAt || b.localBill) return;
  var prices = sitePrices_();
  if (!prices) throw new Error('the website prices could not be read; trying again next minute');
  var now = new Date();
  // The offer he took (read once: its price is the bill's base, and it is marked done below).
  var offer = fsGet_('offers/' + id);
  var his = Boolean(offer && offer.status === 'taken' && offer.takenBy &&
    (offer.takenBy.id === b.assignedDriver.id || String(offer.takenBy.phone || '') === String(b.assignedDriver.phone || '')));
  var bill = localBillOf(b, taps, prices, now, his ? offer.price : 0);
  if (!bill) {
    console.warn('No price for the bill of ' + (b.ref || id) + ': left for the office.');
    return;
  }
  var from = taps.arrivedAt || taps.leftAt;
  var note = 'Completed automatically: ' + hoursText(taps.doneAt.getTime() - from.getTime()) + ' on the job → ' + bill.usedHours +
    ' h (package ' + bill.baseHours + ' h' + (bill.extraHours ? ' + ' + bill.extraHours + ' extra' : '') + '). Bill ₹' + inr(bill.amount) + '.';
  var writes = [
    {
      update: { name: docName_('bookings/' + id), fields: toFields({ localBill: bill, status: 'completed', updatedAt: now, updatedBy: 'robot' }) },
      updateMask: { fieldPaths: ['localBill', 'status', 'updatedAt', 'updatedBy'] },
      currentDocument: { exists: true },
    },
    robotEvent_(id, 'assigned', 'completed', note, now),
  ];
  if (offer && offer.status === 'taken') {
    writes.push({
      update: { name: docName_('offers/' + id), fields: toFields({ done: true, updatedAt: now }) },
      updateMask: { fieldPaths: ['done', 'updatedAt'] },
      currentDocument: { exists: true },
    });
  }
  fsCommit_(writes);
  telegramLine_('✅ <b>' + escapeHtml(b.ref || id) + ' done</b> — ' + escapeHtml((b.assignedDriver && b.assignedDriver.name) || 'the driver') + ': ' + escapeHtml(note.replace('Completed automatically: ', '')));
}

/* ------------------------------------------------- payment and the rating */

function razorpayReady_() {
  return Boolean(prop_('RAZORPAY_KEY_ID') && prop_('RAZORPAY_KEY_SECRET'));
}

/** Basic auth for Razorpay. Built here only; never logged, stored or returned. */
function razorpayFetch_(method, path, payload) {
  var auth = 'Basic ' + Utilities.base64Encode(prop_('RAZORPAY_KEY_ID') + ':' + prop_('RAZORPAY_KEY_SECRET'));
  var res = fetch_(RAZORPAY_API + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: auth },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });
  var body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (err) { body = {}; }
  return { code: res.getResponseCode(), body: body };
}

/** Razorpay's reason for a refusal, without anything of ours in it. */
function razorpayWhy_(r) {
  return String((r.body && r.body.error && r.body.error.description) || 'HTTP ' + r.code).slice(0, 200);
}

function askReview_(id, b) {
  var driver = (b.assignedDriver && b.assignedDriver.name) || '';
  pushToCustomer_(b.customerUid, function (lang, token) { return autoPush('review', { id: id, language: lang, token: token, driver: driver }); });
}

/**
 * Completed bookings: a payment link for the bill — Razorpay's with its keys,
 * else a UPI link to UPI_ID — and once paid (the driver confirms a UPI or
 * cash payment) — or at once without payments — one request to rate the driver.
 */
function completedBookings_(rows) {
  var upiId = upiIdOf(prop_('UPI_ID'));
  var kind = paymentLinkKind(razorpayReady_(), upiId);
  rows.forEach(function (row) {
    var b = row.data;
    if (b.status !== 'completed') return;
    var amount = billAmountOf(b);
    var waiting = Boolean(b.payment && b.payment.status === 'pending');
    var book = null;
    var notes = {};
    if (kind === 'upi' && amount && !b.payment) {
      // No gateway: the link opens the customer's own UPI app; the driver confirms the payment.
      fsCommit_([{
        update: { name: docName_('bookings/' + row.id), fields: toFields({ payment: upiPayment(b, row.id, amount, upiId, prop_('UPI_NAME'), new Date()) }) },
        updateMask: { fieldPaths: ['payment'] },
        currentDocument: { exists: true },
      }]);
      waiting = true;
    }
    if (kind === 'razorpay' && amount && !b.payment) {
      book = bookOf_(row.id);
      if (!book.paymentTriedAt) {
        notes.paymentTriedAt = new Date();
        var r = razorpayFetch_('post', '/payment_links', razorpayLinkRequest(b, amount));
        if (r.code < 300 && r.body.id && r.body.short_url) {
          var payment = { status: 'pending', method: 'razorpay', amount: amount, url: String(r.body.short_url), linkId: String(r.body.id), at: new Date() };
          fsCommit_([{
            update: { name: docName_('bookings/' + row.id), fields: toFields({ payment: payment }) },
            updateMask: { fieldPaths: ['payment'] },
            currentDocument: { exists: true },
          }]);
          waiting = true;
          telegramLine_('💳 ' + escapeHtml(b.ref || row.id) + ': payment link for ₹' + inr(amount) + ' sent to the customer by SMS.');
        } else {
          console.warn('Razorpay ' + r.code + ': ' + razorpayWhy_(r));
          telegramLine_('⚠️ Could not make the payment link for ' + escapeHtml(b.ref || row.id) + ' (Razorpay: ' + escapeHtml(razorpayWhy_(r)) + '). Collect it the usual way.');
        }
      }
    }
    if (b.customerUid && !waiting) {
      book = book || bookOf_(row.id);
      if (!book.reviewAt) {
        askReview_(row.id, b);
        notes.reviewAt = new Date();
      }
    }
    if (Object.keys(notes).length) saveBook_(row.id, notes);
  });
}

/** Every 5 minutes: has a pending payment link been paid? Then the booking says so, Telegram hears, and the rating request goes. */
function pollPayments_() {
  if (!razorpayReady_()) return;
  var rows = fsQuery_('bookings', fieldFilter_('payment.status', 'EQUAL', 'pending'), 'ASCENDING', 50, 'payment.status');
  rows.forEach(function (row) {
    var b = row.data;
    var p = b.payment;
    if (!p || !p.linkId) return;
    var r = razorpayFetch_('get', '/payment_links/' + encodeURIComponent(p.linkId));
    if (r.code !== 200) {
      console.warn('Razorpay ' + r.code + ' for ' + (b.ref || row.id) + ': ' + razorpayWhy_(r));
      return;
    }
    if (r.body.status !== 'paid') return;
    var now = new Date();
    var paid = Object.assign({}, p, { status: 'paid', paidAt: now });
    fsCommit_([{
      update: { name: docName_('bookings/' + row.id), fields: toFields({ payment: paid }) },
      updateMask: { fieldPaths: ['payment'] },
      currentDocument: { exists: true },
    }]);
    telegramLine_('💰 ' + escapeHtml(b.ref || row.id) + ': ₹' + inr(p.amount) + ' paid online.');
    if (b.customerUid && !bookOf_(row.id).reviewAt) {
      askReview_(row.id, b);
      saveBook_(row.id, { reviewAt: now });
    }
  });
}

/* ------------------------------------------- the driver collects the bill
   The driver is never sent the customer's price or DriveBuddy's cut: his
   taps hold only his own times and "payment received"; the amount of a
   payment comes from the booking's bill. */

/**
 * A booking whose bill is now known (the office saved a trip's final bill)
 * and not paid yet: if the driver already tapped "payment received" before
 * there was an amount, the booking is paid now.
 */
function paymentsAwaitingBill_(rows) {
  rows.forEach(function (row) {
    var b = row.data;
    if ((b.status !== 'assigned' && b.status !== 'completed') || !b.assignedDriver) return;
    if (!billAmountOf(b) || (b.payment && b.payment.status === 'paid')) return;
    var taps = fsGet_('tripTaps/' + row.id);
    if (!taps || String(taps.driverPhone || '') !== String(b.assignedDriver.phone || '')) return;
    if (taps.paidBy) {
      var p = takePayment_(row.id, b, taps, false);
      if (p) b.payment = p; // completedBookings_ (next) sees it paid: no link, and the rating request
    }
  });
}

/**
 * The driver says the customer paid: the booking's payment is "paid" (by UPI
 * or in cash, confirmed by the driver — over a pending UPI link), cash he
 * kept goes on his offer (cashCollected) and into his cash total, Telegram
 * hears, and the customer is asked for a rating. → the payment, or null when
 * nothing was done (not his job any more, already paid, or no amount yet —
 * paymentsAwaitingBill_ comes back to it once the bill is saved).
 */
function takePayment_(id, b, taps, fromTap) {
  if (!b || b.status === 'cancelled' || !b.assignedDriver) return null;
  if (String(b.assignedDriver.phone || '') !== String(taps.driverPhone || '')) return null; // a driver who no longer has the job
  var ref = b.ref || id;
  var name = b.assignedDriver.name || 'The driver';
  if (b.payment && b.payment.status === 'paid') {
    if (fromTap && b.payment.by !== 'driver') {
      telegramLine_('⚠️ ' + escapeHtml(ref) + ': ' + escapeHtml(name) + ' says he was paid ' + (taps.paidBy === 'cash' ? 'in cash' : 'by UPI') +
        ', but it was already paid online. Check with the customer — one of them may need a refund.');
    }
    return null;
  }
  var now = new Date();
  var p = driverPaidPayment(b, taps, now);
  if (!p) return null;
  var writes = [{
    update: { name: docName_('bookings/' + id), fields: toFields({ payment: p }) },
    updateMask: { fieldPaths: ['payment'] },
    currentDocument: { exists: true },
  }];
  var cashBy = null;
  if (p.method === 'cash') {
    var offer = fsGet_('offers/' + id);
    if (offer && offer.status === 'taken' && offer.takenBy && offer.takenBy.id && String(offer.takenBy.phone || '') === String(taps.driverPhone || '')) {
      writes.push({
        update: { name: docName_('offers/' + id), fields: toFields({ cashCollected: p.amount, updatedAt: now }) },
        updateMask: { fieldPaths: ['cashCollected', 'updatedAt'] },
        currentDocument: { exists: true },
      });
      cashBy = offer.takenBy;
    }
  }
  fsCommit_(writes);
  telegramLine_(paidTelegramLine(ref, name, p));
  // The rating request waits for the payment when payments are on; a trip still open gets it when it is completed.
  if (b.customerUid && b.status === 'completed' && !bookOf_(id).reviewAt) {
    askReview_(id, b);
    saveBook_(id, { reviewAt: now });
  }
  if (cashBy) noteDriverCash_(cashBy.id, siteCashLimit_());
  return p;
}

/* ------------------------------------------------------------ cash limit */

/** Settle reminders go out between these India hours, never in the night. */
var SETTLE_PUSH_FROM_HOUR = 9;
var SETTLE_PUSH_TO_HOUR = 21;

/** One driver's unpaid, done jobs → his settlement group (null = none), from his own offers only. */
function driverSettlement_(driverId) {
  var rows = fsQuery_('offers', fieldFilter_('takenBy.id', 'EQUAL', driverId), 'ASCENDING', 500, 'takenBy.id');
  return payoutGroups(rows).filter(function (g) { return g.driverId === driverId; })[0] || null;
}

/** Waiting Paid ✓ / Settled ✓ buttons (telegramCallbacks_ reads the presses). */
function addPendingPayout_(key, entry) {
  var props = PropertiesService.getScriptProperties();
  var pending = JSON.parse(props.getProperty('payoutsPending') || '{}');
  pending[key] = entry;
  props.setProperty('payoutsPending', JSON.stringify(pending));
}

/**
 * The cash fields of a driver's quality copy, from his settlement `g`:
 * owed, and overLimit — Telegram hears once when he crosses the limit (with
 * a Settled ✓ button for those jobs). Without a limit (the site could not be
 * read) the flag stays as it was, so an outage never repeats the message.
 */
function owedFields_(g, prev, limit) {
  prev = prev || {};
  var owed = owedOf(g);
  var over = limit ? overCashLimit({ owed: owed }, limit) : Boolean(prev.overLimit) && owed > 0;
  var f = { owed: owed, overLimit: over };
  if (prev.settlePushDay) f.settlePushDay = prev.settlePushDay;
  if (over && !prev.overLimit && g) {
    var now = Date.now();
    var day = istDay(now);
    sendTelegramSafe_(cashLimitTelegram(g, limit, day));
    addPendingPayout_(g.driverId + ':' + day, { ids: g.offerIds, amount: g.net, at: now, settle: true });
  }
  return f;
}

function sendTelegramSafe_(msg) {
  try { sendTelegram_(msg); } catch (err) { console.warn('telegram: ' + err); }
}

/** His cash changed (a cash payment, a settlement): work his total out again from his own offers. → { owed, over } */
function noteDriverCash_(driverId, limit) {
  var g = driverSettlement_(driverId);
  var f = owedFields_(g, driverQuality_()[driverId], limit);
  saveDriverQuality_(driverId, f);
  return { owed: f.owed, over: f.overLimit };
}

/**
 * Every 5 minutes, only for drivers holding cash over the limit (usually
 * none): his total again from his own offers (the office may have settled in
 * /admin), and once a day a reminder on his phone — "Settle ₹X with
 * DriveBuddy to get new jobs". Settled: he gets job alerts again at once.
 */
function cashLimits_() {
  var quality = driverQuality_();
  var ids = Object.keys(quality).filter(function (id) { return Number(quality[id].owed) > 0 || quality[id].overLimit; });
  if (!ids.length) return;
  var limit = siteCashLimit_();
  if (!limit) return;
  var now = Date.now();
  var day = istDay(now);
  var hour = new Date(now + 330 * 60000).getUTCHours();
  ids.forEach(function (id) {
    if (!overCashLimit(quality[id], limit) && !quality[id].overLimit) return;
    var r = noteDriverCash_(id, limit);
    if (!r.over || quality[id].settlePushDay === day || hour < SETTLE_PUSH_FROM_HOUR || hour >= SETTLE_PUSH_TO_HOUR) return;
    var av = fsGet_('availability/' + id);
    if (!av || !av.pushToken) return;
    sendPush_([settlePush(av.pushToken, r.owed)]);
    saveDriverQuality_(id, { settlePushDay: day });
  });
}

/* ------------------------------------------------------------- ratings */

function processRatingsStep_() {
  return changedSince_('ratings', 'ratingsMs', processRatings_, 'at');
}

/**
 * New ratings: each driver's average and count worked out again from all his
 * ratings (exact, never drifting); Telegram once when a driver falls below
 * LOW_RATING; a 5-star customer gets the Google review link.
 */
function processRatings_(rows) {
  var ids = {};
  rows.forEach(function (r) { if (r.data.driverId) ids[r.data.driverId] = true; });
  var names = {};
  var props = PropertiesService.getScriptProperties();
  var low = JSON.parse(props.getProperty('lowRatingAlerted') || '[]');
  Object.keys(ids).forEach(function (id) {
    var d = fsGet_('drivers/' + id);
    if (!d) return;
    names[id] = d.name || '';
    var all = fsQuery_('ratings', fieldFilter_('driverId', 'EQUAL', id), 'ASCENDING', 1000, 'driverId');
    var sum = ratingSummary(all.map(function (r) { return r.data; }));
    fsCommit_([{
      update: { name: docName_('drivers/' + id), fields: toFields(sum) },
      updateMask: { fieldPaths: ['ratingAvg', 'ratingCount'] },
      currentDocument: { exists: true },
    }]);
    saveDriverQuality_(id, { ratingAvg: sum.ratingAvg, ratingCount: sum.ratingCount, strikes: Number(d.strikes) || 0 });
    var isLow = sum.ratingCount >= LOW_RATING.count && sum.ratingAvg < LOW_RATING.avg;
    if (isLow && low.indexOf(id) < 0) {
      low.push(id);
      try { sendTelegram_(lowRatingTelegram({ name: d.name || 'A driver', ratingAvg: sum.ratingAvg, ratingCount: sum.ratingCount, siteUrl: prop_('SITE_URL') })); } catch (err) { console.warn('low rating: ' + err); }
    } else if (!isLow && low.indexOf(id) >= 0) {
      low.splice(low.indexOf(id), 1); // recovered: a later fall is asked about again
    }
  });
  props.setProperty('lowRatingAlerted', JSON.stringify(low));

  var fives = rows.filter(function (r) { return r.data.stars === 5 && r.data.customerUid; });
  if (!fives.length) return;
  var cfg = siteConfig_();
  var url = cfg && cfg.google && (cfg.google.writeReview || cfg.google.profile);
  if (!url) return;
  fives.forEach(function (r) {
    var driver = names[r.data.driverId] || '';
    pushToCustomer_(r.data.customerUid, function (lang, token) {
      return autoPush('thanks', { id: r.id, language: lang, token: token, driver: driver, url: url });
    });
  });
}

/* ------------------------------------------------------------- reminders */

/**
 * Every 5 minutes: jobs starting within the hour (preferredTime, India time,
 * compared as text — the form writes "2026-10-08T15:30") that have a driver
 * get one reminder to the customer's phones and one to the driver's.
 */
function tripReminders_() {
  var now = Date.now();
  var rows = fsQuery_('bookings', {
    compositeFilter: {
      op: 'AND',
      filters: [
        fieldFilter_('preferredTime', 'GREATER_THAN_OR_EQUAL', istStamp(now)),
        fieldFilter_('preferredTime', 'LESS_THAN_OR_EQUAL', istStamp(now + REMIND_BEFORE_MIN * 60000)),
      ],
    },
  }, 'ASCENDING', 50, 'preferredTime');
  var props = PropertiesService.getScriptProperties();
  var done = JSON.parse(props.getProperty('remindedIds') || '[]');
  rows.forEach(function (row) {
    var b = row.data;
    if (b.status !== 'assigned' || !b.assignedDriver || done.indexOf(row.id) >= 0) return;
    done.push(row.id);
    if (bookOf_(row.id).remindedAt) return;
    var time = clockText(b.preferredTime);
    if (b.customerUid) {
      pushToCustomer_(b.customerUid, function (lang, token) {
        return autoPush('reminder', { id: row.id, language: lang, token: token, driver: b.assignedDriver.name, time: time });
      });
    }
    var av = b.assignedDriver.id ? fsGet_('availability/' + b.assignedDriver.id) : null;
    if (av && av.pushToken) sendPush_([driverReminderPush(b, row.id, av.pushToken)]);
    saveBook_(row.id, { remindedAt: new Date(), preferredTime: b.preferredTime });
  });
  props.setProperty('remindedIds', JSON.stringify(done.slice(-100)));
}

/* ---------------------------------------------------------- weekly payouts */

/**
 * Mondays ~9:30 (a trigger from setup): one Telegram per driver with done,
 * unpaid jobs — what he earned minus the cash he kept: pay him (Paid ✓), or
 * collect from him (Settled ✓).
 */
function weeklyPayouts() {
  runSteps_([sendPayouts_], 60000);
}

function sendPayouts_() {
  var now = Date.now();
  var week = istDay(now);
  var groups = payoutGroups(fsQuery_('offers', fieldFilter_('paid', 'EQUAL', false), 'ASCENDING', 500, 'paid'));
  var props = PropertiesService.getScriptProperties();
  var pending = JSON.parse(props.getProperty('payoutsPending') || '{}');
  // A button nobody pressed for five weeks is dropped (its jobs are in the newer messages).
  Object.keys(pending).forEach(function (k) { if (now - (pending[k].at || 0) > 35 * 86400000) delete pending[k]; });
  if (!groups.length) telegramLine_('💸 No driver payouts due this week.');
  groups.forEach(function (g) {
    var d = fsGet_('drivers/' + g.driverId) || {};
    g.upi = d.upi || '';
    sendTelegram_(payoutTelegram(g, week));
    // settle: he owes DriveBuddy, or nothing is due either way (the button says Settled ✓).
    pending[g.driverId + ':' + week] = { ids: g.offerIds, amount: g.net, at: now, settle: g.net <= 0 };
  });
  props.setProperty('payoutsPending', JSON.stringify(pending));
}

function telegramApi_(method, payload) {
  var res = fetch_('https://api.telegram.org/bot' + prop_('TELEGRAM_BOT_TOKEN') + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  try { return JSON.parse(res.getContentText() || '{}'); } catch (err) { return null; }
}

/** Marks these offers paid (only his, only those not paid yet) → how many. */
function markPaid_(driverId, ids) {
  var now = new Date();
  var writes = [];
  (ids || []).forEach(function (id) {
    var o = fsGet_('offers/' + id);
    if (!o || o.paid === true || !o.takenBy || o.takenBy.id !== driverId) return;
    writes.push({
      update: { name: docName_('offers/' + id), fields: toFields({ paid: true, paidAt: now, updatedAt: now }) },
      updateMask: { fieldPaths: ['paid', 'paidAt', 'updatedAt'] },
      currentDocument: { exists: true },
    });
  });
  if (writes.length) fsCommit_(writes);
  return writes.length;
}

/**
 * While a payout waits for its Paid ✓ / Settled ✓ press, or a take for its
 * Confirmed ✓ / Give to someone else (confirmsPending; the 15-minute
 * reminder goes from here too): read the bot's updates (getUpdates, from the
 * last update_id seen), and for a press in the office's own chat
 * (TELEGRAM_CHAT_ID; any other chat is ignored) do it, answer the button and
 * add the outcome to the message. Chats that wrote to the bot meanwhile are
 * remembered for setup().
 */
function telegramCallbacks_() {
  var props = PropertiesService.getScriptProperties();
  var pending = JSON.parse(props.getProperty('payoutsPending') || '{}');
  var confirms = confirmsPending_();
  if (Object.keys(confirms).length && confirmReminders_(confirms, Date.now())) saveConfirmsPending_(confirms);
  if ((!Object.keys(pending).length && !Object.keys(confirms).length) || !prop_('TELEGRAM_BOT_TOKEN')) return;
  var last = Number(props.getProperty('telegramUpdateId') || 0);
  var got = telegramApi_('getUpdates', { offset: last ? last + 1 : 0, timeout: 0, allowed_updates: ['message', 'my_chat_member', 'callback_query'] });
  if (!got || !got.ok) return;
  var office = prop_('TELEGRAM_CHAT_ID').split(',').map(function (x) { return x.trim(); }).filter(String);
  var seen = JSON.parse(props.getProperty('telegramSeenChats') || '[]');
  (got.result || []).forEach(function (u) {
    last = Math.max(last, Number(u.update_id) || 0);
    var chat = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat);
    if (chat && seen.indexOf(String(chat.id)) < 0) seen.push(String(chat.id));
    var cq = u.callback_query;
    if (!cq || !cq.message || !cq.message.chat) return;
    if (office.indexOf(String(cq.message.chat.id)) < 0) return; // not the office's chat: never counts
    var c = parseConfirmCallback(cq.data);
    if (c) {
      confirmPress_(cq, c, confirms);
      saveConfirmsPending_(confirms);
      return;
    }
    var p = parsePaidCallback(cq.data);
    if (!p) return;
    var key = p.driverId + ':' + p.week;
    var entry = pending[key];
    if (!entry) {
      telegramApi_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Already marked paid.' });
      return;
    }
    var n = markPaid_(p.driverId, entry.ids);
    delete pending[key];
    props.setProperty('payoutsPending', JSON.stringify(pending));
    var word = entry.settle ? 'Settled ✓' : 'Paid ✓';
    telegramApi_('answerCallbackQuery', { callback_query_id: cq.id, text: 'Marked ' + word.toLowerCase() });
    telegramApi_('editMessageText', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: String(cq.message.text || '') + '\n\n' + word + ' ' + formatIst(new Date()) + (n < entry.ids.length ? ' (' + (entry.ids.length - n) + ' were already paid)' : ''),
    });
    // Settled: a driver kept out for holding cash gets job alerts again now, not at 9 pm.
    var q = driverQuality_()[p.driverId];
    if (q && (Number(q.owed) > 0 || q.overLimit)) {
      try {
        noteDriverCash_(p.driverId, siteCashLimit_());
      } catch (err) {
        console.warn('cash after settling: ' + err);
      }
    }
  });
  props.setProperty('telegramUpdateId', String(last));
  props.setProperty('telegramSeenChats', JSON.stringify(seen.slice(-20)));
}

/* ------------------------------------------------------------ 9 pm report */

/** Every day ~21:00 (a trigger from setup): the day in numbers on Telegram. */
function dailyReport() {
  runSteps_([sendDailyReport_], 60000);
}

function sendDailyReport_() {
  var now = Date.now();
  var midnight = new Date(Date.parse(istDay(now) + 'T00:00:00+05:30'));
  var names = ['created', 'changed', 'offersToday', 'open', 'unpaid', 'online', 'drivers', 'paidToday', 'assigned'];
  var res = fsQueryAll_([
    { collection: 'bookings', where: fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', midnight), field: 'createdAt', limit: 500 },
    { collection: 'bookings', where: fieldFilter_('updatedAt', 'GREATER_THAN_OR_EQUAL', midnight), field: 'updatedAt', limit: 500 },
    { collection: 'offers', where: fieldFilter_('updatedAt', 'GREATER_THAN_OR_EQUAL', midnight), field: 'updatedAt', limit: 500 },
    { collection: 'offers', where: fieldFilter_('status', 'EQUAL', 'open'), field: 'status', limit: 100 },
    { collection: 'offers', where: fieldFilter_('paid', 'EQUAL', false), field: 'paid', limit: 500 },
    { collection: 'availability', where: fieldFilter_('online', 'EQUAL', true), field: 'online', limit: 200 },
    { collection: 'drivers', where: fieldFilter_('status', 'EQUAL', 'active'), field: 'status', limit: 500 },
    { collection: 'bookings', where: fieldFilter_('payment.paidAt', 'GREATER_THAN_OR_EQUAL', midnight), field: 'payment.paidAt', limit: 500 },
    { collection: 'bookings', where: fieldFilter_('status', 'EQUAL', 'assigned'), field: 'status', limit: 300 },
  ]);
  var q = {};
  res.forEach(function (r, i) {
    if (r.error) throw r.error;
    q[names[i]] = r.rows;
  });
  sendTelegram_({ text: dailyReportText(dailySummary(q, now)) });
  reconcileActiveJobs_(q.assigned);
  // Today's web calls, for the record (Google allows 20,000 a day).
  console.log('UrlFetch calls today: ' + fetchBudget_().n);
  // Once a day the ranking's copy of ratings and strikes is made again from the
  // drivers themselves, and the cash each one holds from all unpaid jobs.
  var prev = driverQuality_();
  var quality = {};
  q.drivers.forEach(function (r) {
    var d = r.data;
    if (d.ratingCount || d.strikes) quality[r.id] = { ratingAvg: Number(d.ratingAvg) || 0, ratingCount: Number(d.ratingCount) || 0, strikes: Number(d.strikes) || 0 };
  });
  var groups = payoutGroups(q.unpaid).filter(function (g) { return owedOf(g) > 0; });
  var limit = groups.length ? siteCashLimit_() : 0;
  groups.forEach(function (g) {
    quality[g.driverId] = Object.assign(quality[g.driverId] || {}, owedFields_(g, prev[g.driverId], limit));
  });
  PropertiesService.getScriptProperties().setProperty('driverQuality', JSON.stringify(quality));
}

/** Monday's payouts and the 9 pm report: exactly one trigger each (called by setup and by tick, so nobody has to re-run setup). */
function ensureTimeTriggers_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('timeTriggers') === 'v1') return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'weeklyPayouts' || fn === 'dailyReport') ScriptApp.deleteTrigger(t);
  });
  // The script's time zone is Asia/Kolkata (appsscript.json), so these are India times.
  ScriptApp.newTrigger('weeklyPayouts').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(30).create();
  ScriptApp.newTrigger('dailyReport').timeBased().everyDays(1).atHour(21).nearMinute(0).create();
  props.setProperty('timeTriggers', 'v1');
}

/* ============================================================ train lookup
   The booking estimate's real trains home on the drop date (lib/rail.ts on
   the website). This is the only code that talks to RailRadar: its key stays
   in the Script Properties (RAILRADAR_API_KEY), never on the website or in
   GitHub, and never in an answer. Each search is cached for 6 hours (5
   minutes with live running status), whole timetables are also saved in the
   Sheet (below), and calls to RailRadar are capped per
   minute and per day so a busy day or a prank cannot use up the plan. Only
   RailRadar's documented fields are passed on, unchanged; nothing is
   invented: a search that fails says why. */

var RAIL_API = 'https://api.railradar.in/v1';
var RAIL_MAX_QUERIES = 12;

/** epoch ms → its date in India, "2026-10-31". */
function istDay(ms) {
  return new Date(ms + 330 * 60000).toISOString().slice(0, 10);
}

function dayPlus(day, n) {
  var p = day.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

/**
 * "SBC-R-2026-10-31,NGP-R-2026-11-01" → [{ from, to, date }], or null if any
 * part is not a station code pair and a date from yesterday to 120 days ahead
 * (India time), or there are more than RAIL_MAX_QUERIES. A pair without a
 * date ("SBC-R") is the whole timetable — every train with its running days
 * (date ''): one search answers every date, for every visitor.
 */
function parseTrainQueries(q, now) {
  var parts = String(q == null ? '' : q).split(',').filter(String);
  if (!parts.length || parts.length > RAIL_MAX_QUERIES) return null;
  var first = dayPlus(istDay(now), -1);
  var last = dayPlus(istDay(now), 120);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var m = /^([A-Z]{1,5})-([A-Z]{1,5})(?:-(\d{4}-\d{2}-\d{2}))?$/.exec(parts[i]);
    if (!m || m[1] === m[2]) return null;
    var date = m[3] || '';
    if (date && (date < first || date > last || dayPlus(date, 0) !== date)) return null;
    out.push({ from: m[1], to: m[2], date: date });
  }
  return out;
}

/** "SBC-R-2026-10-31", or "SBC-R" for a whole timetable. */
function railKey_(q) {
  return q.from + '-' + q.to + (q.date ? '-' + q.date : '');
}

/** RailRadar's train (documented fields) → what the website reads; live status only when it was asked for. */
function railTrain(t, live) {
  t = t || {};
  var tr = t.train || {};
  var from = t.from || {};
  var to = t.to || {};
  var out = {
    number: String(tr.number == null ? '' : tr.number),
    name: String(tr.name == null ? '' : tr.name),
    type: tr.type == null ? '' : String(tr.type),
    runDays: Array.isArray(tr.runDays) ? tr.runDays.map(String) : [],
    dep: from.departure == null ? '' : String(from.departure),
    depDay: from.day,
    arr: to.arrival == null ? '' : String(to.arrival),
    arrDay: to.day,
    duration: typeof t.duration === 'number' ? t.duration : null,
    live: null,
  };
  if (live && t.live && typeof t.live.delayMinutes === 'number') out.live = { delayMinutes: t.live.delayMinutes };
  return out;
}

/** One RailRadar answer → a result for the website: ok with the trains, or the reason it failed. */
function railResult(query, code, body, checkedAt, live) {
  var base = { q: railKey_(query) };
  var fail = function (error) { base.ok = false; base.error = error; return base; };
  if (code === 404) return fail('not-found');
  if (code === 429) return fail('rate-limited');
  if (code === 401 || code === 403) return fail('not-configured');
  if (code === 400) return fail('bad-request');
  if (code >= 500) return fail('unavailable');
  if (code !== 200 || !body || body.success !== true || !body.data || !Array.isArray(body.data.trains)) return fail('bad-response');
  var d = body.data;
  return {
    q: base.q,
    ok: true,
    checkedAt: new Date(checkedAt).toISOString(),
    live: Boolean(live),
    timetable: !query.date,
    from: { code: query.from, name: String((d.from && d.from.name) || query.from) },
    to: { code: query.to, name: String((d.to && d.to.name) || query.to) },
    trains: d.trains.map(function (t) { return railTrain(t, live); }),
  };
}

/**
 * How many of `n` new calls to RailRadar may go out now: the per-minute cap
 * (CacheService) and the per-day cap (Script Properties). Counts what it
 * allows. Approximate under heavy load; RailRadar's own 429 is handled too.
 */
function railBudget_(n, now) {
  if (n <= 0) return 0;
  var cache = CacheService.getScriptCache();
  var props = PropertiesService.getScriptProperties();
  var perMinute = Number(prop_('RAIL_MINUTE_LIMIT')) || 25;
  var perDay = Number(prop_('RAIL_DAILY_LIMIT')) || 900;
  var minuteKey = 'railMin:' + Math.floor(now / 60000);
  var usedMinute = Number(cache.get(minuteKey) || 0);
  var day = istDay(now);
  var dayRec = String(props.getProperty('railDay') || '').split(':');
  var usedDay = dayRec[0] === day ? Number(dayRec[1] || 0) : 0;
  var allowed = Math.max(0, Math.min(n, perMinute - usedMinute, perDay - usedDay));
  if (allowed < n && usedDay + allowed >= perDay) {
    railAlert_('daily', '⚠️ <b>Train lookup:</b> today\'s limit of ' + perDay + ' RailRadar calls is used up. Customers see the saved timetables until midnight. If this happens often, raise RAIL_DAILY_LIMIT in the script properties (the Developer plan allows about 1,000 a day).');
  }
  if (allowed > 0) {
    cache.put(minuteKey, String(usedMinute + allowed), 120);
    props.setProperty('railDay', day + ':' + (usedDay + allowed));
  }
  return allowed;
}

/* ------------------------------------------- saved timetables (the Sheet)
   A whole timetable ("SBC-R": every train with its running days) hardly
   changes, so each one is kept in the "Train timetables" tab of this Sheet:
   customers are answered from there, RailRadar is asked only when a saved
   one is a week old (and every night for those older than 3 days), and when
   RailRadar is down, busy or refuses the key, the last saved timetable is
   used — marked "saved" with the day it was checked. The cache in front
   (6 hours) keeps most visits from reading the Sheet at all. */

var RAIL_SHEET = 'Train timetables';
var RAIL_COLUMNS = ['Pair', 'Checked at', 'Trains', 'Data', 'Data 2', 'Data 3', 'Data 4'];
var RAIL_CELL = 45000; //        characters per cell (Sheets allows 50,000)
var RAIL_FRESH_DAYS = 7; //      younger than this, a saved timetable is used without asking RailRadar
var RAIL_REFRESH_DAYS = 3; //    the nightly run refreshes saved timetables older than this
var RAIL_KEEP_DAYS = 60; //      older than this, a saved timetable is not used even when RailRadar fails

/** A timetable answer → its Sheet row, or null if it is too big to save. */
function railRow(r) {
  var text = JSON.stringify(r);
  var parts = [];
  for (var i = 0; i < text.length; i += RAIL_CELL) parts.push(text.slice(i, i + RAIL_CELL));
  if (parts.length > RAIL_COLUMNS.length - 3) return null;
  while (parts.length < RAIL_COLUMNS.length - 3) parts.push('');
  return [r.q, r.checkedAt, r.trains.length].concat(parts);
}

/** A Sheet row → the saved timetable answer, or null if it does not read back whole. */
function railFromRow(row) {
  try {
    var r = JSON.parse(row.slice(3).map(String).join(''));
    return r && r.ok === true && r.timetable === true && r.q === String(row[0]) && Array.isArray(r.trains) ? r : null;
  } catch (err) {
    return null;
  }
}

/** Days since a saved answer was checked. */
function railAgeDays(r, now) {
  var t = Date.parse(r.checkedAt);
  return isNaN(t) ? Infinity : (now - t) / 86400000;
}

/** A saved answer handed out instead of a fresh one: the same trains, marked saved. */
function railStale(r) {
  var out = JSON.parse(JSON.stringify(r));
  out.saved = true;
  return out;
}

function railSheet_() {
  return table_(RAIL_SHEET, RAIL_COLUMNS).sh;
}

/** The saved timetables for these pairs: { pair: { row, result } } (only those that read back). */
function railLoad_(pairs) {
  var out = {};
  if (!pairs.length) return out;
  var sh = railSheet_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return out;
  var keys = sh.getRange(2, 1, n, 1).getValues();
  keys.forEach(function (k, i) {
    var pair = String(k[0]);
    if (pairs.indexOf(pair) < 0 || out[pair]) return;
    var row = sh.getRange(i + 2, 1, 1, RAIL_COLUMNS.length).getValues()[0];
    var r = railFromRow(row);
    if (r) out[pair] = { row: i + 2, result: r };
  });
  return out;
}

/** Saves timetable answers, replacing the old row of each pair. Skipped (not lost) if another save is running. */
function railSave_(results) {
  if (!results.length) return;
  var lock = (LockService.getDocumentLock && LockService.getDocumentLock()) || LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var sh = railSheet_();
    var n = Math.max(sh.getLastRow() - 1, 0);
    var keys = n ? sh.getRange(2, 1, n, 1).getValues().map(function (k) { return String(k[0]); }) : [];
    results.forEach(function (r) {
      var row = railRow(r);
      if (!row) return;
      var at = keys.indexOf(r.q);
      if (at < 0) {
        keys.push(r.q);
        at = keys.length - 1;
        if (at + 2 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 10);
      }
      sh.getRange(at + 2, 1, 1, RAIL_COLUMNS.length).setValues([row]);
    });
  } finally {
    lock.releaseLock();
  }
}

/** Asks RailRadar for these searches (budget already counted): one result each, in order. */
function railFetch_(queries, key, now) {
  if (!queries.length) return [];
  var responses = fetchAll_(queries.map(function (m) {
    return {
      url: RAIL_API + '/trains/between/' + m.q.from + '/' + m.q.to +
        (m.q.date ? '?date=' + m.q.date + (m.live ? '&live=true' : '') : ''),
      method: 'get',
      headers: { Authorization: 'Bearer ' + key },
      muteHttpExceptions: true,
    };
  }));
  return queries.map(function (m, j) {
    var res = responses[j];
    var code = res ? res.getResponseCode() : 0;
    var body = null;
    try { body = JSON.parse(res.getContentText()); } catch (err) { body = null; }
    var r = railResult(m.q, code, body, now, m.live);
    if (!r.ok && r.error !== 'rate-limited' && r.error !== 'unavailable') console.warn('RailRadar ' + code + ' for ' + r.q);
    if (!r.ok && r.error === 'not-configured') railAlert_('key', '⚠️ <b>Train lookup:</b> RailRadar refused the key — the Developer plan may have run out (auto-renew) or the key changed. Customers still see the saved timetables, but they stop updating. Renew the plan at railradar.in; nothing else to change.');
    return r;
  });
}

/** One Telegram warning a day per kind, so a problem is heard about once, not every minute. */
function railAlert_(kind, html) {
  var props = PropertiesService.getScriptProperties();
  var day = istDay(Date.now());
  var keyName = 'railAlert:' + kind;
  if (props.getProperty(keyName) === day) return;
  props.setProperty(keyName, day);
  try { sendTelegram_({ text: html, parse_mode: 'HTML' }); } catch (err) { console.warn('railAlert ' + kind + ': ' + err); }
}

/**
 * The lookup: ?action=trains&q=SBC-R-2026-10-31,…&live=1 (or q=SBC-R,… for
 * whole timetables, which the website and the app filter by running day).
 * Answers { ok, source, results: [one per search, in order] } — every search
 * either ok with its trains (cached and saved ones keep the time they were
 * checked; a saved one handed out because RailRadar could not be asked is
 * marked saved) or failed with a reason ('busy' when a cap was reached).
 */
function trainsLookup_(params, now) {
  var queries = parseTrainQueries(params.q, now);
  if (!queries) return { ok: false, error: 'bad-request' };
  var key = prop_('RAILRADAR_API_KEY');
  if (!key) return { ok: false, error: 'not-configured' };
  var wantLive = String(params.live) === '1';
  var today = istDay(now);
  var yesterday = dayPlus(today, -1);
  var cache = CacheService.getScriptCache();
  var results = [];
  var misses = [];
  queries.forEach(function (q, i) {
    var live = wantLive && Boolean(q.date) && (q.date === today || q.date === yesterday);
    var ck = 'rail1:' + railKey_(q) + (live ? ':live' : '');
    var hit = cache.get(ck);
    if (hit) {
      try { results[i] = JSON.parse(hit); return; } catch (err) { /* refetch */ }
    }
    misses.push({ i: i, q: q, live: live, ck: ck });
  });

  // Whole timetables not in the cache: the Sheet first.
  var pairs = misses.filter(function (m) { return !m.q.date; }).map(function (m) { return railKey_(m.q); });
  var saved = {};
  try { saved = railLoad_(pairs); } catch (err) { console.warn('railLoad_: ' + err); }
  misses = misses.filter(function (m) {
    var s = !m.q.date && saved[railKey_(m.q)];
    if (s && railAgeDays(s.result, now) < RAIL_FRESH_DAYS) {
      results[m.i] = s.result;
      cache.put(m.ck, JSON.stringify(s.result), 21600);
      return false;
    }
    return true;
  });
  /** A saved timetable still good enough when RailRadar cannot be asked. */
  var fallback = function (m) {
    var s = !m.q.date && saved[railKey_(m.q)];
    return s && railAgeDays(s.result, now) < RAIL_KEEP_DAYS ? railStale(s.result) : null;
  };

  var allowed = railBudget_(misses.length, now);
  var go = misses.slice(0, allowed);
  misses.slice(allowed).forEach(function (m) {
    results[m.i] = fallback(m) || { q: railKey_(m.q), ok: false, error: 'busy' };
  });
  var toSave = [];
  var fetched;
  try {
    fetched = railFetch_(go, key, now);
  } catch (err) {
    // UrlFetchApp itself failed (timeout, Google's side): the saved timetables, else 'unavailable'.
    console.warn('railFetch_: ' + err);
    fetched = go.map(function (m) { return { q: railKey_(m.q), ok: false, error: 'unavailable' }; });
  }
  fetched.forEach(function (r, j) {
    var m = go[j];
    if (r.ok) {
      var text = JSON.stringify(r);
      if (text.length < 90000) cache.put(m.ck, text, m.live ? 300 : 21600);
      if (r.timetable) toSave.push(r);
      results[m.i] = r;
    } else {
      results[m.i] = fallback(m) || r;
    }
  });
  try { railSave_(toSave); } catch (err) { console.warn('railSave_: ' + err); }
  return { ok: true, source: 'RailRadar', results: results };
}

/**
 * Nightly (set up by tick): refreshes saved timetables older than
 * RAIL_REFRESH_DAYS, oldest first, within the per-minute cap, for up to about
 * four and a half minutes. Also in the DriveBuddy menu.
 */
function refreshTrainTimetables() {
  var key = prop_('RAILRADAR_API_KEY');
  if (!key) return 0;
  var started = Date.now();
  var sh = railSheet_();
  var n = sh.getLastRow() - 1;
  if (n <= 0) return 0;
  var rows = sh.getRange(2, 1, n, 2).getValues();
  var todo = rows
    .map(function (r) { return { pair: String(r[0]), at: Date.parse(r[1] instanceof Date ? r[1].toISOString() : String(r[1])) || 0 }; })
    .filter(function (r) { return /^[A-Z]{1,5}-[A-Z]{1,5}$/.test(r.pair) && (started - r.at) / 86400000 >= RAIL_REFRESH_DAYS; })
    .sort(function (a, b) { return a.at - b.at; });
  var done = 0;
  while (todo.length && Date.now() - started < 270000) {
    var allowed = railBudget_(Math.min(todo.length, 20), Date.now());
    if (!allowed) {
      if (Date.now() - started > 200000) break;
      Utilities.sleep(61000);
      continue;
    }
    var batch = todo.splice(0, allowed).map(function (r) {
      var p = r.pair.split('-');
      return { q: { from: p[0], to: p[1], date: '' }, live: false };
    });
    var now = Date.now();
    var fresh = railFetch_(batch, key, now).filter(function (r) { return r.ok; });
    var cache = CacheService.getScriptCache();
    fresh.forEach(function (r) {
      var text = JSON.stringify(r);
      if (text.length < 90000) cache.put('rail1:' + r.q, text, 21600);
    });
    railSave_(fresh);
    done += fresh.length;
  }
  console.log('Train timetables refreshed: ' + done);
  return done;
}

/** Makes sure the nightly refresh runs (once; called from tick, so nobody has to re-run setup). */
function ensureRailTrigger_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('railRefreshTrigger') === 'v1' || !prop_('RAILRADAR_API_KEY')) return;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshTrainTimetables') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshTrainTimetables').timeBased().everyDays(1).atHour(3).create();
  props.setProperty('railRefreshTrigger', 'v1');
}

/**
 * The doorbell: one run for a burst of rings (20 seconds; the next tick
 * picks up anything later). A ring often means an offer was posted, taken or
 * given back, so the offers are dispatched while any are open. Slow mode:
 * new bookings only.
 */
function ping_() {
  var cache = CacheService.getScriptCache();
  if (!cache.get('ping')) {
    cache.put('ping', '1', 20);
    if (fetchBudget_().n > FETCH_SLOW_ABOVE) {
      runSteps_([processBookings_], 25000);
    } else {
      PropertiesService.getScriptProperties().setProperty('dispatchOn', '1');
      pingRun_ = true;
      try {
        runSteps_(robotSteps_(), 25000);
      } finally {
        pingRun_ = false;
      }
    }
  }
  return ContentService.createTextOutput('ok');
}

/**
 * Flood guard: more than FLOOD_LIMIT new bookings in one run is not normal
 * traffic (it is a script or a prank). They are all still numbered and copied
 * to the Sheet, but only the first FLOOD_ALERTS get their own Telegram + email;
 * the rest are summed up in one message, at most every 10 minutes. Block the
 * numbers from /admin.
 */
var FLOOD_LIMIT = 8;
var FLOOD_ALERTS = 3;

function floodTelegram(c) {
  return {
    text: '⚠️ <b>' + c.count + ' new bookings at once</b> — that is not normal. Possibly spam.\n' +
      'Only the first ' + c.alerted + ' were sent here one by one; all are in the admin panel and the Sheet.\n' +
      'Spam? Open a booking → <b>Block this number</b>.',
    reply_markup: { inline_keyboard: [[{ text: 'Open admin panel', url: c.siteUrl + '/admin/' }]] },
  };
}

function processBookings_() {
  var props = PropertiesService.getScriptProperties();
  var since = new Date(Number(props.getProperty('lastBookingMs') || Date.now() - 15 * 60 * 1000));
  var rows = fsQuery_('bookings', fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', since), 'ASCENDING', 20);
  var siteUrl = prop_('SITE_URL');
  var fresh = rows.filter(function (r) { return !r.data.ref && r.data.createdAt; }).length;
  var flood = fresh > FLOOD_LIMIT;
  var alerted = 0;

  rows.forEach(function (row) {
    var b = row.data;
    if (b.ref || !b.createdAt) {
      // Already numbered: move the bookmark past it so it is not read again every minute.
      if (b.createdAt) props.setProperty('lastBookingMs', String(b.createdAt.getTime()));
      return;
    }

    var counter = fsGet_('meta/counters') || {};
    var n = (counter.bookings || 0) + 1;
    var ref = bookingRef(n);
    var customer = fsGet_('customers/' + b.phone);
    var previous = customer ? customer.bookingsCount || 0 : 0;

    var ctx = {
      booking: b, id: row.id, ref: ref, previousBookings: previous, siteUrl: siteUrl,
      // The next step (watchChanges_) confirms it by itself; the alert says so.
      autoConfirm: instantConfirmable(Object.assign({}, b, { ref: ref }), prop_('INSTANT_BOOKINGS')),
    };
    var alerts;
    if (flood && alerted >= FLOOD_ALERTS) {
      alerts = { telegram: 'held-flood', email: 'held-flood' };
    } else {
      alerts = { telegram: sendTelegram_(bookingTelegram(ctx)), email: sendEmail_(bookingEmail(ctx)) };
      alerted++;
    }

    var now = new Date();
    var customerFields = {
      phone: b.phone, name: b.name, city: b.city, lastBookingAt: b.createdAt, lastBookingId: row.id,
      lastBookingRef: ref, lastPackage: b.package, updatedAt: now,
    };
    if (!customer) customerFields.firstBookingAt = b.createdAt;
    var customerTransforms = [{ fieldPath: 'bookingsCount', increment: { integerValue: '1' } }];
    if (b.customerUid) customerTransforms.push({ fieldPath: 'uids', appendMissingElements: { values: [{ stringValue: b.customerUid }] } });

    // One atomic commit: number, booking, counter, customer and timeline together.
    // updatedAt makes the Sheet sync (next step of this tick) pick the booking up.
    fsCommit_([
      {
        update: { name: docName_('bookings/' + row.id), fields: toFields({ ref: ref, number: n, isReturning: previous > 0, alerts: alerts, alertedAt: now, updatedAt: now }) },
        updateMask: { fieldPaths: ['ref', 'number', 'isReturning', 'alerts', 'alertedAt', 'updatedAt'] },
        currentDocument: { exists: true },
      },
      {
        update: { name: docName_('meta/counters'), fields: toFields({ bookings: n, updatedAt: now }) },
        updateMask: { fieldPaths: ['bookings', 'updatedAt'] },
      },
      {
        update: { name: docName_('customers/' + b.phone), fields: toFields(customerFields) },
        updateMask: { fieldPaths: Object.keys(customerFields) },
        updateTransforms: customerTransforms,
      },
      {
        update: {
          name: docName_('bookings/' + row.id + '/events/' + Utilities.getUuid().replace(/-/g, '')),
          fields: toFields({ type: 'created', from: null, to: 'new', note: 'Booking received from the ' + (b.source === 'app' ? 'app' : 'website'), by: 'system', at: now }),
        },
        currentDocument: { exists: false },
      },
    ]);

    props.setProperty('lastBookingMs', String(b.createdAt.getTime()));
    bookingsNumbered_++;
  });

  var cache = CacheService.getScriptCache();
  if (flood && !cache.get('floodNotified')) {
    cache.put('floodNotified', '1', 600);
    var summary = floodTelegram({ count: fresh, alerted: alerted, siteUrl: siteUrl });
    sendTelegram_(summary);
    sendEmail_({ subject: 'DriveBuddy: ' + fresh + ' bookings at once — possibly spam', body: summary.text.replace(/<[^>]+>/g, ''), htmlBody: summary.text.replace(/\n/g, '<br>') });
  }
}

function processDrivers_() {
  var props = PropertiesService.getScriptProperties();
  var since = new Date(Number(props.getProperty('lastDriverMs') || Date.now() - 15 * 60 * 1000));
  var rows = fsQuery_('drivers', fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', since), 'ASCENDING', 20);

  rows.forEach(function (row) {
    var d = row.data;
    if (d.alerts || !d.createdAt) {
      if (d.createdAt) props.setProperty('lastDriverMs', String(d.createdAt.getTime()));
      return;
    }
    var ctx = { driver: d, siteUrl: prop_('SITE_URL') };
    var tg = driverTelegram(ctx);
    var alerts = {
      telegram: sendTelegram_(tg),
      email: sendEmail_({ subject: 'New driver application – ' + d.name + ', ' + d.city, body: tg.text.replace(/<[^>]+>/g, ''), htmlBody: tg.text.replace(/\n/g, '<br>') }),
    };
    var now = new Date();
    fsCommit_([{
      update: { name: docName_('drivers/' + row.id), fields: toFields({ alerts: alerts, alertedAt: now, updatedAt: now }) },
      updateMask: { fieldPaths: ['alerts', 'alertedAt', 'updatedAt'] },
      currentDocument: { exists: true },
    }]);
    props.setProperty('lastDriverMs', String(d.createdAt.getTime()));
  });
}

/**
 * Hands every document changed since the last run to `handle`, then moves the
 * bookmark. "Changed" means its updatedAt moved: numbered by the robot, or
 * confirmed / assigned / completed / cancelled in the admin panel. Each job
 * (the Sheet copy, customer updates) keeps its own bookmark, so one failing
 * never makes another skip or repeat work.
 */
function changedSince_(collection, bookmark, handle, field) {
  var spec = sinceSpec_(collection, bookmark, field);
  // Changed bookings: one query a run, shared by every step that follows them (bookingStream_).
  var rows = collection === 'bookings' && !field ? bookingStream_() : fsQuery_(spec.collection, spec.where, 'ASCENDING', spec.limit, spec.field);
  return sinceRun_(spec, rows, handle);
}

/* The shared "bookings changed" query. Four steps follow changed bookings,
   each with its own bookmark (the instant confirmations, the Sheet, the
   customers' notifications, the automatic offers): one query from the
   oldest bookmark serves them all, each taking the rows past its own. It is
   read again only when this run itself changed a booking (fsCommit_). */
var stream_ = null; //          this run's rows
var inRun_ = false; //          inside runSteps_ (a step called on its own reads afresh)
var bookingsWritten_ = false; // a booking's updatedAt moved since the rows were read
var BOOKING_BOOKMARKS = ['robotBookingsMs', 'sheetBookingsMs', 'notifyBookingsMs', 'autoOfferMs'];

function bookingStreamSpec_() {
  var props = PropertiesService.getScriptProperties();
  var fallback = Date.now() - 15 * 60 * 1000;
  var marks = BOOKING_BOOKMARKS.filter(function (k) { return k !== 'autoOfferMs' || prop_('AUTO_OFFERS') !== 'off'; });
  var since = Math.min.apply(null, marks.map(function (k) { return Number(props.getProperty(k) || fallback); }));
  return { collection: 'bookings', where: fieldFilter_('updatedAt', 'GREATER_THAN_OR_EQUAL', new Date(since)), field: 'updatedAt', dir: 'ASCENDING', limit: 200 };
}

function keepStream_(rows) {
  bookingsWritten_ = false;
  if (inRun_) stream_ = { rows: rows };
  return rows;
}

function bookingStream_() {
  if (inRun_ && stream_ && !bookingsWritten_) return stream_.rows;
  var spec = bookingStreamSpec_();
  return keepStream_(fsQuery_(spec.collection, spec.where, 'ASCENDING', spec.limit, spec.field));
}

/**
 * The query behind changedSince_, without running it (watchChanges_ runs
 * several at once). `field`: the time that moves, default updatedAt (a tap's
 * own time for tripTaps, which has no updatedAt).
 */
function sinceSpec_(collection, bookmark, field) {
  var props = PropertiesService.getScriptProperties();
  field = field || 'updatedAt';
  var since = Number(props.getProperty(bookmark) || Date.now() - 15 * 60 * 1000);
  return {
    collection: collection, bookmark: bookmark, field: field, since: since, dir: 'ASCENDING', limit: 200,
    // Documents already handled at exactly the bookmark millisecond (Firestore keeps
    // microseconds, so "≥ bookmark" returns them again until something newer comes).
    seen: (props.getProperty(bookmark + 'Ids') || '').split(','),
    where: fieldFilter_(field, 'GREATER_THAN_OR_EQUAL', new Date(since)),
  };
}

/** Hands the new rows to `handle`, then moves the bookmark (not if `handle` throws: the next run tries again). */
function sinceRun_(spec, rows, handle) {
  var props = PropertiesService.getScriptProperties();
  var since = spec.since;
  var seen = spec.seen;
  var ms = function (r) { return fieldAt_(r.data, spec.field).getTime(); };
  // (A shared query may start before this bookmark: only the rows past it.)
  rows = rows.filter(function (r) { return ms(r) >= since && !(ms(r) === since && seen.indexOf(r.id) >= 0); });
  if (!rows.length) return 0;
  handle(rows);
  var last = ms(rows[rows.length - 1]);
  var atLast = rows.filter(function (r) { return ms(r) === last; }).map(function (r) { return r.id; });
  if (last === since) atLast = atLast.concat(seen.filter(String));
  props.setProperty(spec.bookmark, String(last));
  props.setProperty(spec.bookmark + 'Ids', atLast.join(','));
  return rows.length;
}

/** Copy every changed booking or driver into the Sheet. */
function syncSheet_(collection, bookmark, table, toRecord) {
  return changedSince_(collection, bookmark, function (rows) {
    upsertRows_(table(), rows.map(function (r) { return toRecord(r.id, r.data); }));
  });
}

function syncBookingsSheet_() {
  return syncSheet_('bookings', 'sheetBookingsMs', bookingsTable_, bookingRecord);
}

function syncDriversSheet_() {
  return syncSheet_('drivers', 'sheetDriversMs', driversTable_, driverRecord);
}

/**
 * One notification on every phone a customer is logged in on: build(language,
 * token) makes each message (null = none for that phone). Phones that
 * uninstalled the app or logged out offline are forgotten. → how many were sent.
 */
function pushToCustomer_(uid, build) {
  var devices = fsList_('users/' + uid + '/devices').filter(function (d) { return d.data.token; });
  var pairs = devices
    .map(function (d) { return { d: d, m: build(d.data.language, d.data.token) }; })
    .filter(function (p) { return p.m; });
  var tickets = sendPush_(pairs.map(function (p) { return p.m; }));
  var gone = pairs.filter(function (p, i) {
    var t = tickets[i];
    return t && t.status === 'error' && t.details && t.details.error === 'DeviceNotRegistered';
  });
  if (gone.length) fsCommit_(gone.map(function (p) { return { delete: docName_('users/' + uid + '/devices/' + p.d.id) }; }));
  return pairs.length;
}

/**
 * Tell customers what changed on their booking (see customerPush and
 * whatsappAssigned). Each booking remembers what it was last told — pushedKey,
 * whatsappKey — written WITHOUT touching updatedAt, so this never wakes the
 * Sheet copy or itself again, and nothing is ever sent twice.
 */
function notifyCustomers_() {
  return changedSince_('bookings', 'notifyBookingsMs', function (rows) {
    rows.forEach(function (row) { notifyCustomer_(row.id, row.data); });
  });
}

function notifyCustomer_(id, b) {
  var key = updateKey(b);
  var fields = {};

  // App users: a notification on every phone they are logged in on.
  if (b.customerUid && b.pushedKey !== key && customerPush({ booking: b, id: id, language: 'en', token: '' })) {
    pushToCustomer_(b.customerUid, function (lang, token) {
      return customerPush({ booking: b, id: id, language: lang, token: token });
    });
    fields.pushedKey = key;
  }

  // Everyone, once WhatsApp is set up: the driver's name and number on WhatsApp.
  if (b.status === 'assigned' && b.assignedDriver && b.ref && b.whatsappKey !== key && whatsappReady_()) {
    fields.whatsappKey = key;
    fields.whatsappAssigned = sendWhatsapp_(whatsappAssigned({
      booking: b, ref: b.ref, template: prop_('WHATSAPP_TEMPLATE'), language: prop_('WHATSAPP_LANGUAGE'),
    }));
  }

  var keys = Object.keys(fields);
  if (!keys.length) return;
  fsCommit_([{
    update: { name: docName_('bookings/' + id), fields: toFields(fields) },
    updateMask: { fieldPaths: keys },
    currentDocument: { exists: true },
  }]);
}

/**
 * The driver's taps on his trip link (and an admin's corrections): copy the
 * times to the booking, so the customer sees them, and tell Telegram about
 * each new step once. The robot's write leaves updatedAt alone.
 */
function syncTripClocks_() {
  return changedSince_('tripLinks', 'tripClockMs', function (rows) {
    rows.forEach(function (row) { syncTripClock_(row.id, row.data); });
  });
}

function syncTripClock_(key, link) {
  if (!link.bookingId) return;
  var b = fsGet_('bookings/' + link.bookingId);
  if (!b) return;
  var clock = tripClockOf(link);
  var news = tripClockNews(b.clock, clock);
  if (!sameClock(b.clock, clock)) {
    fsCommit_([{
      update: { name: docName_('bookings/' + link.bookingId), fields: toFields({ clock: clock }) },
      updateMask: { fieldPaths: ['clock'] },
      currentDocument: { exists: true },
    }]);
  }
  news.forEach(function (step) {
    sendTelegram_(tripTelegram({ link: link, step: step, booking: b, id: link.bookingId, siteUrl: prop_('SITE_URL') }));
  });
}

/** A booking still New 10 minutes after it came in gets one Telegram nudge. */
function remindUnhandled_() {
  var now = Date.now();
  var rows = fsQuery_('bookings', {
    compositeFilter: {
      op: 'AND',
      filters: [
        fieldFilter_('createdAt', 'LESS_THAN_OR_EQUAL', new Date(now - 10 * 60 * 1000)),
        fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', new Date(now - 24 * 60 * 60 * 1000)),
      ],
    },
  }, 'DESCENDING', 100);

  rows.forEach(function (row) {
    var b = row.data;
    if (b.status !== 'new' || b.reminderSentAt || !b.ref) return;
    var minutes = Math.round((now - b.createdAt.getTime()) / 60000);
    sendTelegram_(reminderTelegram({ booking: b, id: row.id, minutes: minutes, siteUrl: prop_('SITE_URL') }));
    fsCommit_([{
      update: { name: docName_('bookings/' + row.id), fields: toFields({ reminderSentAt: new Date() }) },
      updateMask: { fieldPaths: ['reminderSentAt'] },
      currentDocument: { exists: true },
    }]);
  });
}

/* ================================================================ setup */

/**
 * Copy ALL bookings and drivers into the Sheet (newest 5,000). setup() runs it;
 * run it yourself any time a row looks wrong or you deleted rows by mistake.
 */
function fillSheet() {
  var b = fsQuery_('bookings', null, 'DESCENDING', 5000);
  upsertRows_(bookingsTable_(), b.map(function (r) { return bookingRecord(r.id, r.data); }));
  var d = fsQuery_('drivers', null, 'DESCENDING', 5000);
  upsertRows_(driversTable_(), d.map(function (r) { return driverRecord(r.id, r.data); }));
  var props = PropertiesService.getScriptProperties();
  props.setProperty('sheetBookingsMs', String(Date.now() - 60 * 1000));
  props.setProperty('sheetDriversMs', String(Date.now() - 60 * 1000));
  props.setProperty('sheetBookingsMsIds', '');
  props.setProperty('sheetDriversMsIds', '');
  console.log('✓ Sheet filled: ' + b.length + ' bookings, ' + d.length + ' drivers');
}

var STATUS_COLOURS = {
  Bookings: [['New', '#fff3cd'], ['Confirmed', '#e3edfd'], ['Driver assigned', '#efe6fd'], ['Completed', '#e3f4e8'], ['Cancelled', '#f1f1f1']],
  Drivers: [['Applied', '#fff3cd'], ['Verified', '#e3edfd'], ['Active', '#e3f4e8'], ['Inactive', '#f1f1f1'], ['Rejected', '#fde7e7']],
};

/** Headings, frozen top row, filter buttons, date formats, colour per status. Safe to run again. */
function formatSheets_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone('Asia/Kolkata');

  [bookingsTable_(), driversTable_()].forEach(function (t) {
    var sh = t.sh;
    var width = t.header.length;
    var rows = sh.getMaxRows();
    sh.setFrozenRows(1);
    sh.setFrozenColumns(1);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff').setVerticalAlignment('middle');
    sh.setRowHeight(1, 32);

    ['Booked at', 'Applied at', 'Last update'].forEach(function (name) {
      var c = t.header.indexOf(name) + 1;
      if (c > 0) sh.getRange(2, c, rows - 1, 1).setNumberFormat('ddd d mmm yyyy, h:mm am/pm');
    });
    ['Phone', 'Driver phone'].forEach(function (name) {
      var c = t.header.indexOf(name) + 1;
      if (c > 0) sh.getRange(2, c, rows - 1, 1).setNumberFormat('@');
    });

    var statusCol = columnLetter(t.header.indexOf('Status') + 1);
    var body = sh.getRange(2, 1, rows - 1, width);
    var rules = STATUS_COLOURS[sh.getName()].map(function (pair) {
      var rule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + statusCol + '2="' + pair[0] + '"')
        .setBackground(pair[1])
        .setRanges([body]);
      if (pair[0] === 'Cancelled' || pair[0] === 'Rejected' || pair[0] === 'Inactive') rule.setFontColor('#80868b');
      return rule.build();
    });
    sh.setConditionalFormatRules(rules);

    if (!sh.getFilter()) sh.getRange(1, 1, rows, width).createFilter();
    sh.autoResizeColumns(1, width);
    for (var c = 1; c <= width; c++) {
      var w = sh.getColumnWidth(c);
      if (w > 280) sh.setColumnWidth(c, 280);
      else if (w < 90) sh.setColumnWidth(c, 90);
    }
    var idCol = t.header.indexOf('ID') + 1;
    if (idCol > 0) sh.setColumnWidth(idCol, 60);
  });

  summarySheet_();
  // The empty tab every new spreadsheet starts with.
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  ss.setActiveSheet(ss.getSheetByName('Bookings'));
}

/** A "Summary" tab of live formulas: today, this week, this month, by city, by package, by month. */
function summarySheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Summary') || ss.insertSheet('Summary', 0);
  var bt = bookingsTable_();
  var dt = driversTable_();
  var col = function (t, name) { return columnLetter(t.header.indexOf(name) + 1); };
  var S = 'Bookings!' + col(bt, 'Status') + '2:' + col(bt, 'Status');
  var B = 'Bookings!' + col(bt, 'Booked at') + '2:' + col(bt, 'Booked at');
  var I = 'Bookings!' + col(bt, 'ID') + '2:' + col(bt, 'ID');
  var DS = 'Drivers!' + col(dt, 'Status') + '2:' + col(dt, 'Status');
  var all = 'Bookings!A1:' + columnLetter(bt.header.length);
  var q = function (c) { return 'Col' + (bt.header.indexOf(c) + 1); };

  sh.clear();
  var rows = [
    ['DriveBuddy – summary', ''],
    ['Updates by itself. India time.', ''],
    ['', ''],
    ['Bookings', 'Count'],
    ['New – call now', '=COUNTIF(' + S + ',"New")'],
    ['Needs action (new, confirmed, driver assigned)', '=COUNTIF(' + S + ',"New")+COUNTIF(' + S + ',"Confirmed")+COUNTIF(' + S + ',"Driver assigned")'],
    ['Booked today', '=COUNTIF(' + B + ',">="&TODAY())'],
    ['Last 7 days', '=COUNTIF(' + B + ',">="&(TODAY()-6))'],
    ['This month', '=COUNTIF(' + B + ',">="&(EOMONTH(TODAY(),-1)+1))'],
    ['All time', '=COUNTA(' + I + ')'],
    ['Completed', '=COUNTIF(' + S + ',"Completed")'],
    ['Cancelled', '=COUNTIF(' + S + ',"Cancelled")'],
    ['', ''],
    ['Drivers', 'Count'],
    ['Applications waiting', '=COUNTIF(' + DS + ',"Applied")'],
    ['Active drivers', '=COUNTIF(' + DS + ',"Active")'],
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setFontColor('#80868b');
  [4, 14].forEach(function (r) { sh.getRange(r, 1, 1, 2).setFontWeight('bold').setBackground('#f1f3f4'); });

  var query = function (groupBy, label) {
    return '=QUERY({' + all + '},"select ' + q(groupBy) + ', count(' + q('ID') + ') where ' + q('ID') + " <> '' group by " + q(groupBy) +
      ' order by count(' + q('ID') + ") desc label " + q(groupBy) + " '" + label + "', count(" + q('ID') + ") 'Bookings'\",1)";
  };
  sh.getRange('D4').setFormula(query('City', 'City'));
  sh.getRange('G4').setFormula(query('Package', 'Package'));
  sh.getRange('J4').setFormula(
    '=QUERY({' + all + '},"select year(' + q('Booked at') + '), month(' + q('Booked at') + ')+1, count(' + q('ID') + ') where ' + q('ID') +
      " <> '' group by year(" + q('Booked at') + '), month(' + q('Booked at') + ')+1 order by year(' + q('Booked at') + ') desc, month(' +
      q('Booked at') + ")+1 desc label year(" + q('Booked at') + ") 'Year', month(" + q('Booked at') + ")+1 'Month', count(" + q('ID') + ") 'Bookings'\",1)",
  );
  ['D4:E4', 'G4:H4', 'J4:L4'].forEach(function (a) { sh.getRange(a).setFontWeight('bold').setBackground('#f1f3f4'); });
  sh.setColumnWidth(1, 330);
  sh.setColumnWidth(2, 80);
  sh.setFrozenRows(0);
}

/**
 * Run once from the editor (choose "setup" → Run). Safe to run again after
 * changing a property. It:
 *   1. checks it can reach Firestore with this account,
 *   2. finds your Telegram chat (send your bot "hi" first),
 *   3. writes the admin list that /admin checks,
 *   4. starts the every-minute trigger (and Monday's payouts, the 9 pm report),
 *   5. builds the Sheet (all existing bookings + drivers, colours, Summary tab),
 *   6. sends a test message.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = prop_('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('No Telegram bot token yet. In the Sheet use DriveBuddy → Connect Telegram and start.');

  // 1. Firestore access
  fsQuery_('bookings', fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', new Date()), 'ASCENDING', 1);
  console.log('✓ Firestore reachable for project ' + prop_('FIREBASE_PROJECT_ID'));

  // 2. Telegram chat(s): everyone who has messaged the bot
  var upd = JSON.parse(fetch_('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true }).getContentText());
  if (!upd.ok) throw new Error('Telegram did not accept the bot token (' + (upd.description || 'no reason given') + '). In @BotFather: /mybots → your bot → API Token, copy it, and paste it here again.');
  var chats = {};
  (upd.result || []).forEach(function (u) {
    var chat = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat);
    if (chat) chats[String(chat.id)] = chat.title || [chat.first_name, chat.last_name].filter(String).join(' ');
  });
  // Chats whose "hi" the robot already read while waiting for a Paid ✓ press (telegramCallbacks_).
  JSON.parse(props.getProperty('telegramSeenChats') || '[]').forEach(function (id) {
    if (chats[String(id)] === undefined) chats[String(id)] = '';
  });
  // Keep only chats this bot can actually reach (an old bot's chat gives "chat not found").
  var known = prop_('TELEGRAM_CHAT_ID').split(',').map(function (s) { return s.trim(); }).filter(function (id) {
    if (!id || chats[id] !== undefined) return false;
    var r = JSON.parse(fetch_('https://api.telegram.org/bot' + token + '/getChat?chat_id=' + encodeURIComponent(id), { muteHttpExceptions: true }).getContentText());
    return r.ok;
  });
  Object.keys(chats).forEach(function (id) { if (known.indexOf(id) < 0) known.push(id); });
  if (!known.length) {
    var me = JSON.parse(fetch_('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true }).getContentText());
    var bot = me.ok && me.result && me.result.username ? '@' + me.result.username + ' (t.me/' + me.result.username + ')' : 'your bot';
    throw new Error('No Telegram chat found. Open ' + bot + ' in Telegram, press START, send "hi", then run Connect Telegram and start again.');
  }
  props.setProperty('TELEGRAM_CHAT_ID', known.join(','));
  console.log('✓ Telegram chats: ' + known.join(', '));

  // 3. Admins — one document per admin email; firestore.rules checks admins/{email}.
  var admins = (prop_('ADMIN_EMAILS') || Session.getEffectiveUser().getEmail()).split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(String);
  if (!admins.length) throw new Error('Add the ADMIN_EMAILS script property (the Google account you will use for /admin).');
  fsCommit_(admins.map(function (email) {
    return { update: { name: docName_('admins/' + email), fields: toFields({ email: email, addedAt: new Date() }) } };
  }));
  console.log('✓ Admins: ' + admins.join(', '));

  // 4. Trigger (exactly one)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  // Monday's driver payouts and the 9 pm report (exactly one each).
  props.deleteProperty ? props.deleteProperty('timeTriggers') : props.setProperty('timeTriggers', '');
  ensureTimeTriggers_();
  if (!props.getProperty('lastBookingMs')) props.setProperty('lastBookingMs', String(Date.now() - 15 * 60 * 1000));
  if (!props.getProperty('lastDriverMs')) props.setProperty('lastDriverMs', String(Date.now() - 15 * 60 * 1000));
  console.log('✓ Checking for bookings every minute');

  // 5. Sheet
  fillSheet();
  formatSheets_();
  console.log('✓ Sheet ready: Summary, Bookings, Drivers');

  // 6. Test
  if (sendTelegram_({ text: '✅ DriveBuddy alerts are connected. New bookings will appear here within a minute.' }) !== 'sent') {
    throw new Error('Telegram did not deliver the test message (' + lastTelegramError_ + '). Open your bot in Telegram, press START, send "hi", then run Connect Telegram and start again.');
  }
  sendEmail_({ subject: 'DriveBuddy alerts are connected', body: 'New bookings will be emailed here and added to the Bookings sheet.', htmlBody: 'New bookings will be emailed here and added to the <b>Bookings</b> sheet.' });
  console.log('✓ Test message sent. All done.');
}

/* ============================================================== the menu */

/** A "DriveBuddy" menu in the Sheet, so nobody has to open the script editor. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('DriveBuddy')
    .addItem('Connect Telegram and start', 'connectTelegram')
    .addItem('Refresh the whole sheet', 'fillSheet')
    .addItem('Send a test alert', 'testAlert')
    .addItem('Refresh train timetables now', 'refreshTrainTimetables')
    .addToUi();
}

/** Asks for the bot token in a dialog, saves it, and runs setup. */
function connectTelegram() {
  var ui = SpreadsheetApp.getUi();
  var saved = prop_('TELEGRAM_BOT_TOKEN');
  var res = ui.prompt('Connect Telegram',
    'Paste your bot token from @BotFather (it looks like 123456:ABC-xyz).\nSend your bot "hi" in Telegram first.' +
    (saved ? '\n\nA token is already saved. Leave this empty and press OK to keep it.' : ''), ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var token = res.getResponseText().trim() || saved;
  if (!/^\d+:[\w-]{20,}$/.test(token)) return ui.alert('That does not look like a bot token. Copy it again from @BotFather.');
  // setup() keeps only the saved chats this token's bot can reach, so a new bot or a new key both just work.
  PropertiesService.getScriptProperties().setProperty('TELEGRAM_BOT_TOKEN', token);
  try {
    setup();
    ui.alert('All set ✅\n\nNew bookings now reach Telegram, email and this sheet within a minute, even when your computer is off.');
  } catch (err) {
    ui.alert('Setup stopped: ' + err.message);
  }
}

function testAlert() {
  var r = sendTelegram_({ text: '✅ Test alert from DriveBuddy. Telegram is working.' });
  SpreadsheetApp.getUi().alert(r === 'sent' ? 'Sent ✅ Check Telegram.' : 'Telegram is not connected yet. Use DriveBuddy → Connect Telegram and start.');
}

/* Node test hook — ignored by Apps Script, where "module" does not exist. */
if (typeof module !== 'undefined') {
  module.exports = {
    PACKAGE_NAMES: PACKAGE_NAMES, BOOKING_STATUS_LABELS: BOOKING_STATUS_LABELS, DRIVER_STATUS_LABELS: DRIVER_STATUS_LABELS,
    packageName: packageName, bookingRef: bookingRef, inr: inr, tripLine: tripLine, prettyPhone: prettyPhone, sheetPhone: sheetPhone, sheetText: sheetText,
    escapeHtml: escapeHtml, formatWhen: formatWhen, formatIst: formatIst, bookingTelegram: bookingTelegram,
    bookingEmail: bookingEmail, driverTelegram: driverTelegram, reminderTelegram: reminderTelegram,
    bookingRecord: bookingRecord, driverRecord: driverRecord, columnLetter: columnLetter,
    toValue: toValue, fromValue: fromValue, toFields: toFields, fromFields: fromFields,
    updateKey: updateKey, customerPush: customerPush, whatsappAssigned: whatsappAssigned, floodTelegram: floodTelegram,
    tripClockOf: tripClockOf, tripClockNews: tripClockNews, sameClock: sameClock, hoursText: hoursText, tripTelegram: tripTelegram,
    parseTrainQueries: parseTrainQueries, railTrain: railTrain, railResult: railResult, istDay: istDay, dayPlus: dayPlus,
    estimateOf: estimateOf,
    instantConfirmable: instantConfirmable, localBillOf: localBillOf, LOCAL_BASE_HOURS: LOCAL_BASE_HOURS, NEARBY_CITIES: NEARBY_CITIES,
    tapsPrint: tapsPrint, ZONES: ZONES, zoneOf: zoneOf, LOCAL_GRACE_MIN: LOCAL_GRACE_MIN, usedHours: usedHours, RATE_RAISE: RATE_RAISE, driverRatesOf: driverRatesOf, rateCardPayOf: rateCardPayOf, rateRaiseAt: rateRaiseAt, nearKmOf: nearKmOf, driveOf: driveOf, dropHoursOf: dropHoursOf, wholeTimePay: wholeTimePay, DRIVE_DEFAULT: DRIVE_DEFAULT,
    parseConfirmCallback: parseConfirmCallback, shortWhen: shortWhen, confirmedFor: confirmedFor,
    UPI_ID_RE: UPI_ID_RE, upiIdOf: upiIdOf, upiPayUrl: upiPayUrl, payoutGroups: payoutGroups, cashLimitOf: cashLimitOf, overCashLimit: overCashLimit,
  };
}
