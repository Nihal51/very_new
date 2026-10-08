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
 *
 * Your own columns are safe: the robot finds its columns by their heading, only
 * ever writes those, and leaves any column you add (e.g. "Paid?") alone.
 */

/* =============================================================== settings */

var DEFAULTS = {
  FIREBASE_PROJECT_ID: 'drive-buddy-acc4c',
  SITE_URL: 'https://thedrivebuddy.in',
};

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
var BOOKING_COLUMNS = ['Ref', 'Status', 'Booked at', 'Customer', 'Phone', 'City', 'Package', 'Pickup', 'Trip time',
  'Driver', 'Driver phone', 'Customer notes', 'Customer type', 'Last update', 'ID'];

var DRIVER_COLUMNS = ['Name', 'Status', 'Phone', 'City', 'Experience (years)', 'Licence', 'Applied at', 'About',
  'Admin note', 'Last update', 'ID'];

/** A booking document → { heading: cell value }. Dates stay Dates so the Sheet can sort and filter by them. */
function bookingRecord(id, b) {
  var driver = b.assignedDriver || null;
  var notes = b.notes || '';
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
    '<b>When:</b> ' + escapeHtml(formatWhen(b.preferredTime)),
  ];
  if (b.notes) lines.push('<b>Notes:</b> ' + escapeHtml(b.notes));
  lines.push('', c.previousBookings > 0
    ? '🔁 Returning customer (' + c.previousBookings + ' earlier booking' + (c.previousBookings === 1 ? '' : 's') + ')'
    : '🆕 New customer');
  if (b.customerUid) lines.push('👤 Booked while logged in');
  var greeting = 'Hi ' + b.name + ', this is DriveBuddy about your booking ' + c.ref + '. ';
  return {
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Open in admin panel', url: c.siteUrl + '/admin/?b=' + encodeURIComponent(c.id) }],
        [{ text: 'WhatsApp customer', url: waLink(b.phone, greeting) }],
      ],
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
    ['When', formatWhen(b.preferredTime)],
    ['Notes', b.notes || '—'],
    ['Customer', c.previousBookings > 0 ? 'Returning (' + c.previousBookings + ' earlier)' : 'New customer'],
  ];
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
  var res = UrlFetchApp.fetch(url, {
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

/**
 * runQuery on one collection → [{ id, data }]. Filters and ordering always use
 * the same single field, which Firestore indexes automatically.
 */
function fsQuery_(collection, where, orderDir, limit, orderField) {
  var query = {
    from: [{ collectionId: collection }],
    orderBy: [{ field: { fieldPath: orderField || 'createdAt' }, direction: orderDir }],
    limit: limit,
  };
  if (where) query.where = where;
  var rows = fsFetch_(fsBase_() + ':runQuery', { structuredQuery: query }) || [];
  return rows.filter(function (r) { return r.document; }).map(function (r) {
    return { id: r.document.name.split('/').pop(), data: fromFields(r.document.fields) };
  });
}

function fsCommit_(writes) {
  return fsFetch_(fsBase_() + ':commit', { writes: writes });
}

function fieldFilter_(path, op, value) {
  return { fieldFilter: { field: { fieldPath: path }, op: op, value: toValue(value) } };
}

/* =============================================================== senders */

function sendTelegram_(msg) {
  var token = prop_('TELEGRAM_BOT_TOKEN');
  var chats = prop_('TELEGRAM_CHAT_ID').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (!token || !chats.length) return 'off';
  var ok = chats.every(function (chatId) {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chatId, text: msg.text, parse_mode: 'HTML', reply_markup: msg.reply_markup, disable_web_page_preview: true }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) console.error('Telegram ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    return res.getResponseCode() === 200;
  });
  return ok ? 'sent' : 'failed';
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

/** Runs every minute (set up by setup()): the safety net behind the instant ping below. */
function tick() {
  var steps = [processBookings_, processDrivers_, syncBookingsSheet_, syncDriversSheet_];
  if (new Date().getMinutes() % 5 === 0) steps.push(remindUnhandled_);
  runSteps_(steps, 5000);
}

/** Runs the steps under the script lock. One failing step never stops the others. */
function runSteps_(steps, waitMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) return false; // another run is going; it or the next one picks this up
  try {
    steps.forEach(function (step) {
      try {
        step();
      } catch (err) {
        console.error(step.name + ': ' + (err && err.stack || err));
      }
    });
  } finally {
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
function doPost() {
  return ping_();
}

function doGet() {
  return ping_();
}

function ping_() {
  var cache = CacheService.getScriptCache();
  if (!cache.get('ping')) {
    cache.put('ping', '1', 3);
    runSteps_([processBookings_, processDrivers_, syncBookingsSheet_, syncDriversSheet_], 25000);
  }
  return ContentService.createTextOutput('ok');
}

function processBookings_() {
  var props = PropertiesService.getScriptProperties();
  var since = new Date(Number(props.getProperty('lastBookingMs') || Date.now() - 15 * 60 * 1000));
  var rows = fsQuery_('bookings', fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', since), 'ASCENDING', 20);
  var siteUrl = prop_('SITE_URL');

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

    var ctx = { booking: b, id: row.id, ref: ref, previousBookings: previous, siteUrl: siteUrl };
    var alerts = { telegram: sendTelegram_(bookingTelegram(ctx)), email: sendEmail_(bookingEmail(ctx)) };

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
          fields: toFields({ type: 'created', from: null, to: 'new', note: 'Booking received from the website', by: 'system', at: now }),
        },
        currentDocument: { exists: false },
      },
    ]);

    props.setProperty('lastBookingMs', String(b.createdAt.getTime()));
  });
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
 * Copy every booking changed since the last run into the Sheet. "Changed" means
 * its updatedAt moved: numbered by the robot, or confirmed / assigned /
 * completed / cancelled in the admin panel.
 */
function syncSheet_(collection, bookmark, table, toRecord) {
  var props = PropertiesService.getScriptProperties();
  var since = Number(props.getProperty(bookmark) || Date.now() - 15 * 60 * 1000);
  // Documents already copied at exactly the bookmark millisecond (Firestore keeps
  // microseconds, so "≥ bookmark" returns them again until something newer comes).
  var seen = (props.getProperty(bookmark + 'Ids') || '').split(',');
  var ms = function (r) { return r.data.updatedAt.getTime(); };
  var rows = fsQuery_(collection, fieldFilter_('updatedAt', 'GREATER_THAN_OR_EQUAL', new Date(since)), 'ASCENDING', 200, 'updatedAt')
    .filter(function (r) { return !(ms(r) === since && seen.indexOf(r.id) >= 0); });
  if (!rows.length) return 0;
  upsertRows_(table(), rows.map(function (r) { return toRecord(r.id, r.data); }));
  var last = ms(rows[rows.length - 1]);
  var atLast = rows.filter(function (r) { return ms(r) === last; }).map(function (r) { return r.id; });
  if (last === since) atLast = atLast.concat(seen.filter(String));
  props.setProperty(bookmark, String(last));
  props.setProperty(bookmark + 'Ids', atLast.join(','));
  return rows.length;
}

function syncBookingsSheet_() {
  return syncSheet_('bookings', 'sheetBookingsMs', bookingsTable_, bookingRecord);
}

function syncDriversSheet_() {
  return syncSheet_('drivers', 'sheetDriversMs', driversTable_, driverRecord);
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
 *   4. starts the every-minute trigger,
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
  var upd = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true }).getContentText());
  if (!upd.ok) throw new Error('Telegram did not accept the bot token (' + (upd.description || 'no reason given') + '). In @BotFather: /mybots → your bot → API Token, copy it, and paste it here again.');
  var chats = {};
  (upd.result || []).forEach(function (u) {
    var chat = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat);
    if (chat) chats[String(chat.id)] = chat.title || [chat.first_name, chat.last_name].filter(String).join(' ');
  });
  var known = prop_('TELEGRAM_CHAT_ID').split(',').filter(String);
  Object.keys(chats).forEach(function (id) { if (known.indexOf(id) < 0) known.push(id); });
  if (!known.length) {
    var me = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe', { muteHttpExceptions: true }).getContentText());
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
  if (!props.getProperty('lastBookingMs')) props.setProperty('lastBookingMs', String(Date.now() - 15 * 60 * 1000));
  if (!props.getProperty('lastDriverMs')) props.setProperty('lastDriverMs', String(Date.now() - 15 * 60 * 1000));
  console.log('✓ Checking for bookings every minute');

  // 5. Sheet
  fillSheet();
  formatSheets_();
  console.log('✓ Sheet ready: Summary, Bookings, Drivers');

  // 6. Test
  sendTelegram_({ text: '✅ DriveBuddy alerts are connected. New bookings will appear here within a minute.' });
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
    packageName: packageName, bookingRef: bookingRef, prettyPhone: prettyPhone, sheetPhone: sheetPhone, sheetText: sheetText,
    escapeHtml: escapeHtml, formatWhen: formatWhen, formatIst: formatIst, bookingTelegram: bookingTelegram,
    bookingEmail: bookingEmail, driverTelegram: driverTelegram, reminderTelegram: reminderTelegram,
    bookingRecord: bookingRecord, driverRecord: driverRecord, columnLetter: columnLetter,
    toValue: toValue, fromValue: fromValue, toFields: toFields, fromFields: fromFields,
  };
}
