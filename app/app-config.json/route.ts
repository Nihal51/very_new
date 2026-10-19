import { settings } from '@/lib/settings';
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
 * Only public information — the same numbers every page already shows.
 * `schema` changes only if the shape changes in a way old apps cannot read.
 */
export const dynamic = 'force-static';

export function GET() {
  const { contact, notice, prices, monthly, google, alerts, app } = settings;
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
    google: { profile: google.profile, writeReview: google.writeReview },
    alerts: { pingUrl: alerts.pingUrl },
    site: { url: site.url, privacy: `${site.url}/privacy/`, terms: `${site.url}/terms/` },
    app: { minVersion: app.minVersion, playStoreUrl: app.playStoreUrl, appStoreUrl: app.appStoreUrl },
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
