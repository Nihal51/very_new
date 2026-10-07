import {
  cities,
  faqs,
  monthlyComparison,
  monthlyPlans,
  monthlyTerms,
  plans,
  services,
} from '@/lib/content';
import { cityHi } from '@/lib/content-hi';
import { formatPhone, site } from '@/lib/site';

/**
 * /llms.txt — a plain-text map of the site for AI assistants and agents
 * (https://llmstxt.org). Honest expectations: Google has said it does not use
 * this file, and no AI search engine has said it ranks by it; what gets a site
 * cited is being indexed (Google, and Bing for ChatGPT) and being mentioned
 * elsewhere. It is here because it costs nothing, is generated from the same
 * content as the pages so it can never go stale, and gives an agent that does
 * read it the facts in one request.
 */
export const dynamic = 'force-static';

const url = (path: string) => `${site.url}${path}`;

function body(): string {
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);
  const cityNames = cities.map((c) => c.name).join(', ');

  push(
    `# ${site.name}`,
    '',
    `> ${site.name} is a driver-on-demand service in ${site.region}, India. It sends police-verified, professionally trained drivers to drive the customer's own car — by the hour, the day or the month — in ${cityNames}, 24 hours a day. ${site.name} supplies the driver only, not a vehicle.`,
    '',
    `- Founded: ${site.foundingYear}, in ${site.foundingCity}, by ${site.founder}`,
    `- Phone and WhatsApp: ${formatPhone(site.phone)} (alternate ${formatPhone(site.phoneAlt)})`,
    `- Email: ${site.email}`,
    `- Languages: English, Hindi`,
    '',
    '## Prices (driver only; customer provides the car and fuel)',
    '',
    ...plans.map((p) => `- ${p.name}: ${p.price} ${p.unit}`),
    '- Night driver, 8 PM to 6 AM: from ₹500',
    ...monthlyPlans.map(
      (p) =>
        `- Monthly driver, ${p.name} plan: ${p.price} a month${p.joiningFee ? ` + ${p.joiningFee.toLowerCase()}` : ', no joining fee'}`,
    ),
    `- Monthly driver, both plans: ${monthlyTerms.hoursPerDay} hours a day, ${monthlyTerms.daysOffPerMonth} days off a month, ₹${monthlyTerms.overtimePerHour} per extra hour; outstation trips extra`,
    ...monthlyComparison
      .filter((r) => r.basic !== r.premium && r.label !== 'Monthly charge' && !r.label.startsWith('Joining'))
      .map((r) => `- Monthly driver, ${r.label.toLowerCase()}: Basic — ${r.basic}; Premium — ${r.premium}`),
    `- ${services
      .filter((s) => s.quote)
      .map((s) => s.title)
      .join(', ')}: quoted on the call`,
    '',
    '## Services',
    '',
    ...services.map((s) => `- [${s.title}](${url(`/services/${s.slug}/`)}): ${s.short}`),
    '',
    '## Cities',
    '',
    ...cities.map(
      (c) =>
        `- [Drivers in ${c.name}](${url(`/cities/${c.slug}/`)}) — Hindi: [${cityHi(c.slug).name} में ड्राइवर](${url(`/hi/cities/${c.slug}/`)})`,
    ),
    '',
    '## Key pages',
    '',
    `- [Book a driver](${url('/book/')})`,
    `- [Pricing](${url('/pricing/')})`,
    `- [About ${site.name}](${url('/about/')})`,
    `- [Frequently asked questions](${url('/faq/')})`,
    `- [Contact](${url('/contact/')})`,
    `- [Driver jobs](${url('/drivers/')})`,
    `- [हिंदी में (Hindi home page)](${url('/hi/')})`,
    '',
    '## Frequently asked questions',
    '',
  );
  for (const f of faqs) push(`### ${f.q}`, '', f.a, '');
  return lines.join('\n');
}

export function GET() {
  return new Response(body(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
