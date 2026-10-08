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

  /* ---------------------------------------------------- driver charges -----
     In rupees. A from/to pair shows as a range, e.g. ₹1,000–1,200. */
  prices: {
    oneHour: 300,
    threeHours: 600,
    fullDay: { from: 1000, to: 1200 }, //     Local Full Day, 8 hours
    outstation: { from: 1200, to: 1500 }, //  per trip
    nightFrom: 500, //                        Night driver, 8 PM – 6 AM, "from ₹500"
  },

  /* ---------------------------------------------------- monthly driver -----
     The Basic and Premium plans on the Monthly Driver page. */
  monthly: {
    basic: { from: 16000, to: 17000 }, //   per month
    joiningFeePercent: 25, //               Basic only, paid once
    premium: 20000, //                      per month, no joining fee
    hoursPerDay: 9,
    extraHour: 100, //                      price for each hour over hoursPerDay
    daysOffPerMonth: 4,
    standInPerDay: 900, //                  Basic only (free on Premium)
    replacementDays: 1, //                  a new driver within this many days
  },
} satisfies SiteSettings;
