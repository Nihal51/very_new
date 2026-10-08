/**
 * DriveBuddy alerts robot — Google Apps Script, free, no card needed.
 *
 * Lives inside a Google Sheet ("DriveBuddy Bookings") and runs on Google's
 * servers every minute, even when every laptop and phone is off:
 *
 *   • new booking   → reference number (DB-1042), customer record, timeline entry,
 *                     Telegram message + email, and a row in the "Bookings" sheet
 *   • new driver    → Telegram message + email + a row in the "Drivers" sheet
 *   • every 5 min   → a booking still "New" after 10 minutes gets one reminder
 *
 * It reads and writes Firestore through the REST API as the Google account that
 * owns this script, so it must be the account that owns the Firebase project.
 *
 * SETUP: docs/bookings-system.md, "One-time setup". In short: paste this file and
 * appsscript.json into Extensions → Apps Script, add the script properties, send
 * your Telegram bot a message, then run `setup` once.
 *
 * Script properties (Project Settings → Script properties):
 *   TELEGRAM_BOT_TOKEN   from @BotFather                         (required)
 *   ADMIN_EMAILS         Google account(s) for /admin, comma-sep   (required)
 *   FIREBASE_PROJECT_ID  default drive-buddy-acc4c
 *   ALERT_EMAIL          where alert emails go; default: this account
 *   SITE_URL             default https://thedrivebuddy.in
 *   TELEGRAM_CHAT_ID     filled in by setup()
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
   functions are unit-tested in Node (tests/alerts-script.test.mjs). */

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
      '<b>Licence:</b> ' + escapeHtml(d.licence),
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

/** runQuery on one collection → [{ id, data }] */
function fsQuery_(collection, where, orderDir, limit) {
  var rows = fsFetch_(fsBase_() + ':runQuery', {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: where,
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: orderDir }],
      limit: limit,
    },
  }) || [];
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

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ============================================================ the robot */

/** Runs every minute (set up by setup()). */
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // the previous run is still going
  try {
    processBookings_();
    processDrivers_();
    if (new Date().getMinutes() % 5 === 0) remindUnhandled_();
  } finally {
    lock.releaseLock();
  }
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

    sheet_('Bookings', ['Ref', 'Booked at', 'Name', 'Phone', 'City', 'Package', 'Pickup', 'When', 'Notes', 'Customer', 'Logged in'])
      .appendRow([ref, formatIst(b.createdAt), b.name, prettyPhone(b.phone), b.city, packageName(b.package), b.pickup,
        formatWhen(b.preferredTime), b.notes || '', previous > 0 ? 'Returning (' + previous + ')' : 'New', b.customerUid ? 'Yes' : '']);

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
    fsCommit_([{
      update: { name: docName_('drivers/' + row.id), fields: toFields({ alerts: alerts, alertedAt: new Date() }) },
      updateMask: { fieldPaths: ['alerts', 'alertedAt'] },
      currentDocument: { exists: true },
    }]);
    sheet_('Drivers', ['Applied at', 'Name', 'Phone', 'City', 'Experience (years)', 'Licence', 'About'])
      .appendRow([formatIst(d.createdAt), d.name, prettyPhone(d.phone), d.city, d.experienceYears, d.licence, d.about || '']);
    props.setProperty('lastDriverMs', String(d.createdAt.getTime()));
  });
}

function remindUnhandled_() {
  var now = Date.now();
  var rows = fsQuery_('bookings', {
    compositeFilter: {
      op: 'AND',
      filters: [
        fieldFilter_('status', 'EQUAL', 'new'),
        fieldFilter_('createdAt', 'LESS_THAN_OR_EQUAL', new Date(now - 10 * 60 * 1000)),
        fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', new Date(now - 24 * 60 * 60 * 1000)),
      ],
    },
  }, 'DESCENDING', 20);

  rows.forEach(function (row) {
    if (row.data.reminderSentAt || !row.data.ref) return;
    var minutes = Math.round((now - row.data.createdAt.getTime()) / 60000);
    sendTelegram_(reminderTelegram({ booking: row.data, id: row.id, minutes: minutes, siteUrl: prop_('SITE_URL') }));
    fsCommit_([{
      update: { name: docName_('bookings/' + row.id), fields: toFields({ reminderSentAt: new Date() }) },
      updateMask: { fieldPaths: ['reminderSentAt'] },
      currentDocument: { exists: true },
    }]);
  });
}

/* ================================================================ setup */

/**
 * Run once from the editor (choose "setup" → Run). Safe to run again after
 * changing a property. It:
 *   1. checks it can reach Firestore with this account,
 *   2. finds your Telegram chat (send your bot "hi" first),
 *   3. writes the admin list that /admin checks,
 *   4. starts the every-minute trigger,
 *   5. sends a test message.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = prop_('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Add the TELEGRAM_BOT_TOKEN script property first (Project Settings → Script properties).');

  // 1. Firestore access
  fsQuery_('bookings', fieldFilter_('createdAt', 'GREATER_THAN_OR_EQUAL', new Date()), 'ASCENDING', 1);
  console.log('✓ Firestore reachable for project ' + prop_('FIREBASE_PROJECT_ID'));

  // 2. Telegram chat(s): everyone who has messaged the bot
  var upd = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true }).getContentText());
  if (!upd.ok) throw new Error('Telegram rejected the bot token. Copy it again from @BotFather.');
  var chats = {};
  (upd.result || []).forEach(function (u) {
    var chat = (u.message && u.message.chat) || (u.my_chat_member && u.my_chat_member.chat);
    if (chat) chats[String(chat.id)] = chat.title || [chat.first_name, chat.last_name].filter(String).join(' ');
  });
  var known = prop_('TELEGRAM_CHAT_ID').split(',').filter(String);
  Object.keys(chats).forEach(function (id) { if (known.indexOf(id) < 0) known.push(id); });
  if (!known.length) throw new Error('No Telegram chat found. Open your bot in Telegram, press START, send "hi", then run setup again.');
  props.setProperty('TELEGRAM_CHAT_ID', known.join(','));
  console.log('✓ Telegram chats: ' + known.join(', '));

  // 3. Admins — one document per admin email; firestore.rules checks admins/{email}.
  var admins = prop_('ADMIN_EMAILS').split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(String);
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

  // 5. Test
  sendTelegram_({ text: '✅ DriveBuddy alerts are connected. New bookings will appear here within a minute.' });
  sendEmail_({ subject: 'DriveBuddy alerts are connected', body: 'New bookings will be emailed here and added to the Bookings sheet.', htmlBody: 'New bookings will be emailed here and added to the <b>Bookings</b> sheet.' });
  sheet_('Bookings', ['Ref', 'Booked at', 'Name', 'Phone', 'City', 'Package', 'Pickup', 'When', 'Notes', 'Customer', 'Logged in']);
  sheet_('Drivers', ['Applied at', 'Name', 'Phone', 'City', 'Experience (years)', 'Licence', 'About']);
  console.log('✓ Test message sent. All done.');
}

/* Node test hook — ignored by Apps Script, where `module` does not exist. */
if (typeof module !== 'undefined') {
  module.exports = {
    PACKAGE_NAMES: PACKAGE_NAMES, packageName: packageName, bookingRef: bookingRef, prettyPhone: prettyPhone,
    escapeHtml: escapeHtml, formatWhen: formatWhen, formatIst: formatIst, bookingTelegram: bookingTelegram,
    bookingEmail: bookingEmail, driverTelegram: driverTelegram, reminderTelegram: reminderTelegram,
    toValue: toValue, fromValue: fromValue, toFields: toFields, fromFields: fromFields,
  };
}
