/**
 * The shape of site-settings.ts, and the checks that run on it at build time.
 *
 * The settings file is meant to be edited by hand in the GitHub web editor, so a
 * mistake there must never reach the live site. Two layers catch it:
 *   1. TypeScript, via `satisfies SiteSettings` — a word where a number belongs,
 *      or a misspelt or missing key, fails `npm run lint` with the line number.
 *   2. `checkSettings` below — values that type-check but make no sense (a
 *      9-digit phone, a range that runs backwards, a ₹0 price) fail the build
 *      with a message that says which setting and what is wrong with it.
 * The deploy workflow publishes only after both pass, so the site that is live
 * stays live until the file is fixed.
 */

type Range = { from: number; to: number };

export type SiteSettings = {
  notice: { show: boolean; text: string };
  contact: { phone: string; phoneAlt: string; whatsapp: string; email: string };
  google: { profile: string; writeReview: string };
  login: { phoneOtp: boolean };
  /** The alerts robot's web-app URL; the website pings it after each booking so alerts go out in seconds. */
  alerts: { pingUrl: string };
  prices: {
    oneHour: number;
    threeHours: number;
    fullDay: Range;
    /** Per day of an outstation trip or one-way drop. */
    outstation: Range;
    nightFrom: number;
  };
  /** Trip rules for the outstation estimate (lib/outstation.ts). */
  outstation: {
    hoursPerDay: number;
    extraHour: number;
    /** Per hour the driver is still travelling home after the paid days. */
    returnHour: number;
    /** The most return hours cost in any 24 hours. */
    returnMaxPerDay: number;
    /** Per day, if the customer does not give the driver his meals. */
    mealAllowance: number;
    kmPerDay: number;
    averageKmh: number;
    busKmh: number;
    stationHours: number;
    localWithinKm: number;
    /** Used only by the /admin quote calculator; not published to the app. */
    minProfitPercent: number;
  };
  monthly: {
    basic: Range;
    joiningFeePercent: number;
    premium: number;
    premiumJoiningFeePercent: number;
    hoursPerDay: number;
    extraHour: number;
    daysOffPerMonth: number;
    standInPerDay: number;
    replacementDays: number;
  };
  /** The DriveBuddy mobile app (Nihal51/drivebuddy-mobile), via /app-config.json. */
  app: {
    /** Installed apps older than this show "Please update". Format 1.0.0. */
    minVersion: string;
    playStoreUrl: string;
    appStoreUrl: string;
  };
  partners: {
    monthlyCustomer: number;
    /** % of each full-day, outstation, wedding or event booking a partner sends. */
    commissionPercent: number;
    joiningDiscount: number;
  };
};

/**
 * @param driverCosts optional, from the DRIVER_COSTS build secret (never in this
 *   public repo): what drivers cost, e.g. "outstation=1000-1100; fullDay=700".
 *   When set, a price that would earn less than outstation.minProfitPercent on
 *   those costs fails the build — a typo like 1150 for 1450 never goes live.
 */
export function checkSettings(s: SiteSettings, driverCosts?: string): SiteSettings {
  const problems: string[] = [];
  const mobile = /^[6-9]\d{9}$/;

  const price = (name: string, n: number) => {
    if (!Number.isInteger(n) || n <= 0) problems.push(`${name} must be a whole number above 0 (it is ${n})`);
  };
  const range = (name: string, r: Range) => {
    price(`${name}.from`, r.from);
    price(`${name}.to`, r.to);
    if (r.from > r.to) problems.push(`${name}: "from" (${r.from}) is bigger than "to" (${r.to})`);
  };
  const count = (name: string, n: number, max: number) => {
    if (!Number.isInteger(n) || n < 0 || n > max)
      problems.push(`${name} must be a whole number from 0 to ${max} (it is ${n})`);
  };

  for (const key of ['phone', 'phoneAlt', 'whatsapp'] as const) {
    if (!mobile.test(s.contact[key]))
      problems.push(`contact.${key} must be a 10-digit mobile number without +91 or spaces (it is "${s.contact[key]}")`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contact.email))
    problems.push(`contact.email does not look like an email address ("${s.contact.email}")`);

  /* Only Google's own addresses: these links go out under the business's name to
     customers who trust it, so a typo or a pasted tracking link must not be able to
     send them somewhere else. */
  const googleLink = (name: string, url: string) => {
    try {
      const u = new URL(url);
      const ok =
        u.protocol === 'https:' &&
        ['maps.app.goo.gl', 'g.page', 'goo.gl', 'g.co', 'maps.google.com', 'www.google.com', 'google.com', 'search.google.com'].includes(u.hostname);
      if (!ok) problems.push(`${name} must be an https link on a Google address (it is "${url}")`);
    } catch {
      problems.push(`${name} is not a web link ("${url}")`);
    }
  };
  googleLink('google.profile', s.google.profile);
  if (s.google.writeReview.trim()) googleLink('google.writeReview', s.google.writeReview);

  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s.app.minVersion))
    problems.push(`app.minVersion must look like 1.0.0 (it is "${s.app.minVersion}")`);
  /* Store links only: an "update" button must never send customers anywhere else. */
  const storeLink = (name: string, url: string, host: string) => {
    if (!url.trim()) return;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.hostname !== host)
        problems.push(`${name} must be an https link on ${host} (it is "${url}")`);
    } catch {
      problems.push(`${name} is not a web link ("${url}")`);
    }
  };
  storeLink('app.playStoreUrl', s.app.playStoreUrl, 'play.google.com');
  storeLink('app.appStoreUrl', s.app.appStoreUrl, 'apps.apple.com');

  if (s.notice.show && !s.notice.text.trim()) problems.push('notice.show is true but notice.text is empty');
  if (s.notice.text.length > 160)
    problems.push(`notice.text is ${s.notice.text.length} characters — keep it under 160 so it fits on a phone`);

  price('prices.oneHour', s.prices.oneHour);
  price('prices.threeHours', s.prices.threeHours);
  range('prices.fullDay', s.prices.fullDay);
  range('prices.outstation', s.prices.outstation);
  price('prices.nightFrom', s.prices.nightFrom);

  const o = s.outstation;
  count('outstation.hoursPerDay', o.hoursPerDay, 16);
  if (o.hoursPerDay < 8) problems.push('outstation.hoursPerDay must be at least 8');
  price('outstation.extraHour', o.extraHour);
  price('outstation.returnHour', o.returnHour);
  price('outstation.returnMaxPerDay', o.returnMaxPerDay);
  if (o.returnMaxPerDay < o.returnHour)
    problems.push('outstation.returnMaxPerDay must be at least one returnHour');
  price('outstation.mealAllowance', o.mealAllowance);
  count('outstation.kmPerDay', o.kmPerDay, 800);
  if (o.kmPerDay < 200) problems.push('outstation.kmPerDay must be at least 200');
  count('outstation.averageKmh', o.averageKmh, 80);
  if (o.averageKmh < 20) problems.push('outstation.averageKmh must be at least 20');
  count('outstation.busKmh', o.busKmh, 100);
  if (o.busKmh < 20) problems.push('outstation.busKmh must be at least 20');
  count('outstation.stationHours', o.stationHours, 6);
  count('outstation.localWithinKm', o.localWithinKm, 150);
  count('outstation.minProfitPercent', o.minProfitPercent, 60);
  if (o.extraHour * o.hoursPerDay > s.prices.outstation.to * 2)
    problems.push('outstation.extraHour looks too high for the day price — is a 0 too many?');
  if (o.returnMaxPerDay > s.prices.outstation.to)
    problems.push('outstation.returnMaxPerDay (a day of the driver travelling home) should not cost more than a driving day');

  problems.push(...checkDriverCosts(s, driverCosts));

  range('monthly.basic', s.monthly.basic);
  count('monthly.joiningFeePercent', s.monthly.joiningFeePercent, 100);
  price('monthly.premium', s.monthly.premium);
  count('monthly.premiumJoiningFeePercent', s.monthly.premiumJoiningFeePercent, 100);
  count('monthly.hoursPerDay', s.monthly.hoursPerDay, 24);
  price('monthly.extraHour', s.monthly.extraHour);
  count('monthly.daysOffPerMonth', s.monthly.daysOffPerMonth, 30);
  price('monthly.standInPerDay', s.monthly.standInPerDay);
  count('monthly.replacementDays', s.monthly.replacementDays, 30);
  if (s.monthly.replacementDays < 1) problems.push('monthly.replacementDays must be at least 1');

  price('partners.monthlyCustomer', s.partners.monthlyCustomer);
  count('partners.commissionPercent', s.partners.commissionPercent, 30);
  if (s.partners.commissionPercent < 1) problems.push('partners.commissionPercent must be at least 1');
  price('partners.joiningDiscount', s.partners.joiningDiscount);
  if (s.partners.joiningDiscount >= Math.round((s.monthly.premium * s.monthly.premiumJoiningFeePercent) / 100) && s.monthly.premiumJoiningFeePercent > 0)
    problems.push('partners.joiningDiscount must be smaller than the Premium joining fee');

  if (problems.length) {
    throw new Error(
      `\n\nsite-settings.ts has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nFix the line(s) in site-settings.ts and commit again. The live site has not changed.\n',
    );
  }
  return s;
}

/**
 * The optional profit guard (see checkSettings). Format, one price per part:
 *   outstation=1000-1100; fullDay=700-750; oneHour=200
 * A cost range checks both ends of a price range; a single cost checks the
 * lowest price. Unknown names and bad parts are reported, never ignored.
 *
 * The repo is public and so are its build logs, so the messages never print a
 * cost — only which price is too low.
 */
export function checkDriverCosts(s: SiteSettings, driverCosts?: string): string[] {
  if (!driverCosts?.trim()) return [];
  const problems: string[] = [];
  const keep = 1 - s.outstation.minProfitPercent / 100;
  const prices = s.prices as Record<string, number | Range>;
  const parts = driverCosts.split(/[;,\n]+/).map((p) => p.trim()).filter(Boolean);
  parts.forEach((part, i) => {
    const m = /^([a-zA-Z]+)\s*=\s*(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) {
      problems.push(`DRIVER_COSTS: part ${i + 1} cannot be read — write each part like outstation=1000-1100`);
      return;
    }
    const name = m[1] ?? '';
    const a = m[2] ?? '0';
    const b = m[3];
    const sold = prices[name];
    if (sold === undefined) {
      problems.push(`DRIVER_COSTS: part ${i + 1} names "${name}", which is not one of the prices (${Object.keys(prices).join(', ')})`);
      return;
    }
    const at = typeof sold === 'number' ? { from: sold, to: sold } : sold;
    const low = (price: number, cost: number) => price * keep < cost;
    const pct = `${s.outstation.minProfitPercent}%`;
    if (low(at.from, Number(a)))
      problems.push(`prices.${name}${typeof sold === 'number' ? '' : '.from'} (${at.from}) earns less than ${pct} on what drivers cost (the DRIVER_COSTS secret) — raise it`);
    if (b !== undefined && low(at.to, Number(b)))
      problems.push(`prices.${name}.to (${at.to}) earns less than ${pct} on what drivers cost (the DRIVER_COSTS secret) — raise it`);
  });
  return problems;
}
