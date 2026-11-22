/*
 * =============================================================================
 *  DRIVEBUDDY SITE SETTINGS — prices, phone numbers and the notice bar
 * =============================================================================
 *
 *  This is the ONE file to edit for prices, contact details and the notice at
 *  the top of the site. Every page updates from here: the English and Hindi
 *  pages, the booking form, the FAQ, the monthly plans, and the information
 *  Google and ChatGPT read. Nothing else needs changing.
 *
 *  HOW TO EDIT — from any browser, even your phone:
 *    1. Open this file on github.com and click the pencil icon (Edit).
 *    2. Change only the value after the colon, for example
 *           oneHour: 300,     becomes     oneHour: 350,
 *         - Prices are plain numbers: no ₹ sign and no commas (16000, not 16,000)
 *         - Words stay inside the quotes:  text: 'Like this',
 *         - Keep the comma at the end of each line
 *    3. Click "Commit changes". The live site updates in about 3 minutes.
 *
 *  Typed something wrong? The update stops and your current site stays live.
 *  The Actions tab on GitHub shows a red cross with the reason — fix that line
 *  and commit again.
 *
 *  Edited here on GitHub? Run `git pull` on your laptop before you work there.
 * =============================================================================
 */

import type { SiteSettings } from './lib/settings-schema';

export const settings = {
  /* ------------------------------------------------------- notice bar ------
     A one-line message across the top of every page — a festival notice, a
     holiday closure, a new service. show: true turns it on, false hides it. */
  notice: {
    show: false,
    text: 'Diwali week: drivers available all night. Book a day ahead.',
  },

  /* ---------------------------------------------------------- contact ------
     10-digit Indian mobile numbers, without +91. */
  contact: {
    phone: '9111473929', //        main number: call buttons, FAQ, everywhere
    phoneAlt: '9893302783', //     second number
    whatsapp: '9111473929', //     the number your WhatsApp is on
    email: 'drivebuddyind@gmail.com',
  },

  /* --------------------------------------------------- Google reviews -----
     profile:     your Google Business Profile link (Google Maps → Share → Copy link)
     writeReview: optional — the "Get more reviews" link from your profile, which
                  opens the review box directly (https://g.page/r/…/review).
                  Leave it '' and the review button uses the profile link. */
  google: {
    profile: 'https://maps.app.goo.gl/5yJuHkFUZXmYgVhJ6',
    writeReview: 'https://search.google.com/local/writereview?placeid=ChIJs-jfFPrdKDoRHsazUysqIks',
  },

  /* ------------------------------------------------------- customer login --
     Login on the "My account" page. Google login is free. Login by phone
     number + SMS code costs money per SMS and needs Firebase's paid Blaze
     plan, so keep phoneOtp: false until you have switched to Blaze. */
  login: {
    phoneOtp: false,
  },

  /* ------------------------------------------------------ instant alerts --
     The alerts robot's web-app address (Apps Script → Deploy → Web app URL,
     ends in /exec). The website pings it the moment a booking is saved, so
     Telegram and email arrive in seconds. Leave '' and alerts still come
     within a minute. */
  alerts: {
    pingUrl: 'https://script.google.com/macros/s/AKfycbyJPR141acpum3KirDFgF8BFt79pE7Jf6wUPwbAzF0oyTjLCYuf3KTVdrKsYlIjHyvK/exec',
  },

  /* --------------------------------------- the driver's train home -------
     For one-way drops the estimate looks up the REAL trains home for the
     drop date (RailRadar, through the alerts robot in apps-script/Code.js,
     which keeps the API key in its Script Properties — never here).
     lookupUrl: the robot's web app address (Apps Script → Deploy → Web app,
     ends in /exec). Empty: alerts.pingUrl is used; both empty: no lookup,
     and the estimate uses the typical time home, labelled as such. */
  trains: {
    lookupUrl: 'https://script.google.com/macros/s/AKfycbyJPR141acpum3KirDFgF8BFt79pE7Jf6wUPwbAzF0oyTjLCYuf3KTVdrKsYlIjHyvK/exec',
    transferBufferMinutes: 90, // the least time to change trains (e.g. at Nagpur)
    maxTransferHours: 12, //      a longer wait at the change is not offered as a connection
    directWithinHours: 24, //     no direct train leaving within this long → look for a change
    maxWaitHours: 48, //          trains leaving later than this after he is ready are not offered
    maxOptions: 5, //             how many routes the customer can choose from
  },

  /* ---------------------------------------------------- driver charges -----
     In rupees. A from/to pair shows as a range, e.g. ₹1,000–1,200.
     They are also the drivers' offer estimates: a confirmed booking goes to
     drivers by itself at oneHour, threeHours, fullDay.to or nightFrom (a trip
     at the estimate the customer saw), unless a price was agreed on the call. */
  prices: {
    oneHour: 300,
    threeHours: 600,
    fullDay: { from: 1000, to: 1200 }, //     Local Full Day, 8 hours. "to" is also the price a full-day job goes to drivers at by itself (decide)
    /* Per 24 HOURS of the driver's time on an outstation trip or one-way drop
       (decided 8 Nov 2026). It rises with the distance (one-way road km from
       the pickup city) — see outstation.nearFromKm and dayTopFromKm:
         up to 160 km (he is home the same day): ₹1,050 rising to ₹1,350, for
           the trip — Bilaspur 113 km ₹1,200, Janjgir 160 km ₹1,350;
         farther: ₹1,450 rising to ₹1,750 at 300 km and beyond, for each 24 h —
           Korba ₹1,550, Nagpur ₹1,700, Mumbai ₹1,750. */
    outstation: { from: 1450, to: 1750 }, //  farther than the last nearby tier
    outstationNear: [
      { upToKm: 160, from: 1050, to: 1350 }, //  same-day drops: Bilaspur, Kanker, Janjgir …
    ],
    nightFrom: 500, //                        Night driver, 8 PM – 6 AM, "from ₹500"; also the price a night job goes to drivers at by itself (decide)
    /* Local jobs (1 hour, 3 hours, full day, night) that run longer than the
       package: each started hour over it, after 15 minutes' grace, from the
       driver's Arrived → Job done taps in the Driver app. The bill is
       worked out by itself and shown to the customer. */
    localExtraHour: 150, //                   decide: price of each hour over the package
  },

  /* ---------------------------------------------------------- payments ----
     Customers pay DriveBuddy's UPI ID (set in the alerts robot's Script
     Properties as UPI_ID — not here) or pay the driver in cash. Cash the
     driver keeps is taken off his weekly payout.
     cashLimit: rupees of DriveBuddy's cash a driver may hold (cash he kept
     minus what he earned, over his unpaid jobs) before he stops getting new
     job alerts, until he settles. The Driver app shows him the same limit. */
  payments: {
    cashLimit: 2000, //                       decide: cash a driver may hold before new jobs stop
  },

  /* ------------------------------------- outstation trips & one-way drops --
     How the trip estimate is worked out on the booking form and in the app
     (decided 8 Nov 2026 — one rule, the driver's TIME). One-way: from when he
     leaves until he is home by train or bus — the drive, waiting for his
     train and the ride home — each 24 hours at the day price for the distance
     (prices.outstation…); the hours past those 24-hour blocks extraHour each,
     never more than one more day. Up to 160 km he is home the same day: one
     price for the trip. The waiting and the ride use the route's average from
     the timetables until the customer picks a date and train; then that
     train; the final bill the real times. Round trips: the days, and driving
     beyond hoursPerDay a day extraHour an hour. The customer books his ticket
     home and gives his meals. The team confirms the exact price on the call
     (the quote calculator in /admin works it out from the driver's cost). */
  outstation: {
    nearFromKm: 60, //         the day price starts rising from the first tier's `from` here …
    dayTopFromKm: 300, //      … and reaches prices.outstation.to here (farther: the same)
    hoursPerDay: 12, //        driving hours in one outstation day (about 600 km)
    sameDayMaxHours: 14, //    a round trip with up to this much driving there and back (700 km) is home within the 24 h: ONE day
    extraHour: 130, //         each hour past the 24-hour blocks of a one-way drop, and each driving hour beyond hoursPerDay on a round trip
    extraFullDayAfterHours: 7, // round trips: driving hours left over after the full days: up to this many at extraHour; more = a full day
    /* Quotes and bills from before 8 Nov 2026 only (by the hours): his way home. */
    returnHour: 120, //        each hour of his way home after a one-way drop
    returnMaxPerDay: 1200, //  a full day of the way home (each 24 hours)
    returnFullDayAfterHours: 6, // the hours left over after the full days: up to this many by the hour; more = a full day
    mealAllowance: 300, //     per day, only if the customer does not give the driver his meals
    kmPerDay: 600, //          how far one driver drives in a day (about 12 h at averageKmh)
    averageKmh: 50, //         highway average with stops
    busKmh: 50, //             way home for a place not in the list: bus/train average, with stops
    stationHours: 1, //        from the drop to the bus stand or station (a place without an average wait)
    graceMinutes: 15, //       final bill: minutes of an hour not charged (4 h 15 m = 4 h, 4 h 16 m = 5 h)
    localWithinKm: 60, //      closer than this, the form suggests a local package instead
    targetProfitPercent: 25, // the /admin quote calculator works the price out with this profit …
    minProfitPercent: 20, //   … and warns below this one …
    maxProfitPercent: 30, //   … or above this one
    guardProfitPercent: 15, // the build's profit guard (the DRIVER_COSTS secret): no price on the site may earn less than this
  },

  /* ---------------------------------------------------- monthly driver -----
     The Basic and Premium plans on the Monthly Driver page. */
  monthly: {
    basic: { from: 16000, to: 17000 }, //   per month
    joiningFeePercent: 25, //               Basic: one-time joining fee, % of one month
    premium: 20000, //                      per month
    premiumJoiningFeePercent: 10, //        Premium: one-time joining fee, % of one month (0 = none)
    hoursPerDay: 9,
    extraHour: 100, //                      price for each hour over hoursPerDay
    daysOffPerMonth: 4,
    standInPerDay: 900, //                  Basic only (free on Premium)
    replacementDays: 1, //                  a new driver within this many days
  },
  /* -------------------------------------------------------- mobile app -----
     The DriveBuddy app on customers' phones reads these (with the prices and
     numbers above) from thedrivebuddy.in/app-config.json.
     minVersion: raise it ONLY when old app versions must stop being used — they
     then show "Please update" with a button to the store. Looks like 1.0.0. */
  app: {
    minVersion: '1.0.0',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=in.thedrivebuddy.app',
    appStoreUrl: '', //  the App Store link, once the iPhone app is published
  },

  /* ---------------------------------------------------- partner program ----
     The rewards on the Become a partner page (/partners/). Partners are paid
     only after the customer they sent has paid. */
  partners: {
    monthlyCustomer: 1000, //  to a showroom, hotel or travel agent, per customer who takes a monthly driver
    commissionPercent: 10, //  to a hotel, travel agent, wedding planner or banquet hall: % of every
    //                         full-day, outstation, wedding or event booking they send
    joiningDiscount: 500, //   off the monthly joining fee for families sent by a hospital, clinic or society
  },
} satisfies SiteSettings;
