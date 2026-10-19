import { destinationTable } from '@/lib/outstation';
import { settings, tripRules } from '@/lib/settings';
import { site } from '@/lib/site';

/**
 * /app-config.json — prices, phone numbers and the notice bar for the
 * DriveBuddy mobile app (Nihal51/drivebuddy-mobile).
 *
 * Generated from site-settings.ts on every deploy, so a price changed on
 * GitHub reaches the website AND every installed app within minutes, with no
 * app update. The app checks every field (packages/shared/src/config.ts there)
 * and keeps its last good copy if this file is ever missing or malformed.
 *
 * Only public information — the same numbers every page already shows (the
 * minimum profit and driver costs are never published).
 * `schema` changes only if the shape changes in a way old apps cannot read;
 * new fields (like `outstation` and `destinations`) are added alongside.
 */
export const dynamic = 'force-static';

export function GET() {
  const { contact, notice, prices, monthly, google, alerts, app, outstation } = settings;
  const body = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    contact: { phone: contact.phone, phoneAlt: contact.phoneAlt, whatsapp: contact.whatsapp, email: contact.email },
    notice: { show: notice.show, text: notice.text },
    prices: {
      oneHour: prices.oneHour,
      threeHours: prices.threeHours,
      fullDay: { from: prices.fullDay.from, to: prices.fullDay.to },
      outstation: { from: prices.outstation.from, to: prices.outstation.to },
      nightFrom: prices.nightFrom,
    },
    monthly: {
      basic: { from: monthly.basic.from, to: monthly.basic.to },
      joiningFeePercent: monthly.joiningFeePercent,
      premium: monthly.premium,
      premiumJoiningFeePercent: monthly.premiumJoiningFeePercent,
      hoursPerDay: monthly.hoursPerDay,
      extraHour: monthly.extraHour,
      daysOffPerMonth: monthly.daysOffPerMonth,
      standInPerDay: monthly.standInPerDay,
      replacementDays: monthly.replacementDays,
    },
    /* The trip estimate: rules, and for each destination and pickup city the
       one-way km, the fewest days, and the hours the driver is still on his way
       home after them (lib/outstation.ts works them out). The app shows
       days × prices.outstation + those hours × returnHour (at most
       returnMaxPerDay in any 24 h). */
    outstation: {
      hoursPerDay: outstation.hoursPerDay,
      sameDayMaxHours: outstation.sameDayMaxHours,
      extraHour: outstation.extraHour,
      returnHour: outstation.returnHour,
      returnMaxPerDay: outstation.returnMaxPerDay,
      mealAllowance: outstation.mealAllowance,
      kmPerDay: outstation.kmPerDay,
      localWithinKm: outstation.localWithinKm,
    },
    destinations: destinationTable(tripRules),
    google: { profile: google.profile, writeReview: google.writeReview },
    alerts: { pingUrl: alerts.pingUrl },
    site: { url: site.url, privacy: `${site.url}/privacy/`, terms: `${site.url}/terms/` },
    app: { minVersion: app.minVersion, playStoreUrl: app.playStoreUrl, appStoreUrl: app.appStoreUrl },
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
