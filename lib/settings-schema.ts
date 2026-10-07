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
  prices: {
    oneHour: number;
    threeHours: number;
    fullDay: Range;
    outstation: Range;
    nightFrom: number;
  };
  monthly: {
    basic: Range;
    joiningFeePercent: number;
    premium: number;
    hoursPerDay: number;
    extraHour: number;
    daysOffPerMonth: number;
    standInPerDay: number;
    replacementDays: number;
  };
};

export function checkSettings(s: SiteSettings): SiteSettings {
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

  if (s.notice.show && !s.notice.text.trim()) problems.push('notice.show is true but notice.text is empty');
  if (s.notice.text.length > 160)
    problems.push(`notice.text is ${s.notice.text.length} characters — keep it under 160 so it fits on a phone`);

  price('prices.oneHour', s.prices.oneHour);
  price('prices.threeHours', s.prices.threeHours);
  range('prices.fullDay', s.prices.fullDay);
  range('prices.outstation', s.prices.outstation);
  price('prices.nightFrom', s.prices.nightFrom);

  range('monthly.basic', s.monthly.basic);
  count('monthly.joiningFeePercent', s.monthly.joiningFeePercent, 100);
  price('monthly.premium', s.monthly.premium);
  count('monthly.hoursPerDay', s.monthly.hoursPerDay, 24);
  price('monthly.extraHour', s.monthly.extraHour);
  count('monthly.daysOffPerMonth', s.monthly.daysOffPerMonth, 30);
  price('monthly.standInPerDay', s.monthly.standInPerDay);
  count('monthly.replacementDays', s.monthly.replacementDays, 30);
  if (s.monthly.replacementDays < 1) problems.push('monthly.replacementDays must be at least 1');

  if (problems.length) {
    throw new Error(
      `\n\nsite-settings.ts has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nFix the line(s) in site-settings.ts and commit again. The live site has not changed.\n',
    );
  }
  return s;
}
