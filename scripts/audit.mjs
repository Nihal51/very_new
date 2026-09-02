/**
 * Post-build audit of out/ — the checks that a type-checker cannot make.
 *
 * Run with:  npm run audit   (after npm run build)
 *
 * Asserts, for every exported page: exactly one <h1>, a title within Google's
 * display limit, a description in the useful length band, a canonical URL, an
 * absolute OG image, a twitter card, at least one JSON-LD block, that no
 * placeholder or unreplaced token made it into the HTML, and that the page makes
 * no factual claim the business cannot prove. Exits non-zero on failure so it
 * can gate a deploy.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'out');

const TITLE_MAX = 65;
const DESC_MIN = 70;
const DESC_MAX = 162;

/** Strings that must never appear in the readable markup. */
const FORBIDDEN = ['lorem ipsum', 'TODO', 'undefined', 'NaN', '[object Object]'];

/** Strings that must not appear anywhere, scripts included — the old site's
    undeployed Cloudflare Worker and the blocking Google Fonts request. */
const FORBIDDEN_ANYWHERE = ['YOUR-WORKER', 'workers.dev', 'fonts.googleapis.com'];

/**
 * Claims the business cannot currently prove, as patterns.
 *
 * On 2 Sep 2026 the owner confirmed the homepage's "4.9 from 187 reviews" was
 * invented, along with "500+ families served". Deleting those strings fixes
 * today; this guard fixes tomorrow, by making their return a build failure
 * rather than something a reader has to notice. Under the Consumer Protection
 * Act 2019 an invented statistic is a misleading advertisement, and Google's
 * review policy (updated 24 July 2026) treats fabricated review signals as
 * grounds for a manual action.
 *
 * Matched against the page's *text* — tags, `<script>`, `<style>` and React's
 * comment markers stripped, whitespace collapsed — never against raw HTML.
 * React emits `from <!-- -->187<!-- --> reviews`, and a stat block puts "500+"
 * and "Families served" in sibling elements, so a raw-HTML regex silently
 * passes and the guard becomes decoration. Verified to match all three real
 * claims and nothing else across the 21 exported pages.
 *
 * To publish a real rating one day: take the figure from the Google Business
 * Profile, keep it current, attribute it on the page, then delete just the one
 * pattern below and say in the commit message where the number came from. Do
 * not re-add `aggregateRating` or `Review` markup regardless — see lib/schema.ts.
 */
const UNSUBSTANTIATED = [
  [/\b\d[\d,]*(?:\.\d+)?\s*\+?\s*(?:verified |genuine |google |customer )?reviews?\b/i, 'review count'],
  [/\bfrom\s+\d[\d,]*\s+ratings?\b/i, 'rating count'],
  [/\b\d(?:\.\d)?\s*(?:★|⭐|stars?\b|out of 5\b|\/\s?5\b)/i, 'star rating'],
  [
    /\b(?:\d[\d,]*\s*\+|over\s+\d[\d,]*|more than\s+\d[\d,]*|\d[\d,]*\s*lakh)\s*(?:happy |satisfied |delighted )?(?:families|customers|clients|users|riders|rides|trips|bookings|drivers|people)\b/i,
    'customer volume',
  ],
  [/\b\d{1,3}\s*%\s*(?:satisfaction|satisfied|happy|on[- ]time|success)/i, 'satisfaction rate'],
  [
    /(?:\bno\.?\s*1\b|#1\b|\bnumber one\b|top[- ]rated|highest[- ]rated|most trusted|market leader)/i,
    'superlative ranking',
  ],
];

/** Structured-data properties that must never come back. See lib/schema.ts. */
const FORBIDDEN_MARKUP = ['aggregateRating', '"@type":"Review"'];

/* Titles and descriptions are measured after decoding entities. React escapes
   `&` as `&amp;` in the markup, but Google counts the character a person sees —
   so measuring the raw HTML charges five characters for one ampersand and fails
   a title that actually fits. */
function decode(s) {
  return s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const pages = walk(OUT).sort();
if (pages.length === 0) {
  console.error('No HTML found in out/ — run `npm run build` first.');
  process.exit(1);
}

let failures = 0;
const rows = [];

for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const rel = path.relative(OUT, file).replaceAll('\\', '/');
  const isNotFound = rel.includes('404') || rel.includes('_not-found');

  const first = (re) => html.match(re)?.[1] ?? '';
  const count = (re) => (html.match(re) ?? []).length;

  /* Everything outside <script> — i.e. the markup a person or crawler reads.
     The RSC payload legitimately contains React's "$undefined" Flight markers,
     so scanning raw HTML for placeholder tokens gives false positives. */
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

  const title = decode(first(/<title>([^<]*)<\/title>/));
  const desc = decode(first(/<meta name="description" content="([^"]*)"/));
  const canonical = first(/<link rel="canonical" href="([^"]*)"/);
  const ogImage = first(/<meta property="og:image" content="([^"]*)"/);
  const ogTitle = first(/<meta property="og:title" content="([^"]*)"/);
  const twitter = first(/<meta name="twitter:card" content="([^"]*)"/);
  const jsonLd = count(/application\/ld\+json/g);
  const h1 = count(/<h1[ >]/g);

  const issues = [];

  if (!title) issues.push('no <title>');
  else if (title.length > TITLE_MAX) issues.push(`title ${title.length} chars`);
  if (h1 !== 1) issues.push(`${h1} <h1> tags`);

  if (!isNotFound) {
    if (!desc) issues.push('no description');
    else if (desc.length < DESC_MIN || desc.length > DESC_MAX)
      issues.push(`description ${desc.length} chars`);
    if (!canonical) issues.push('no canonical');
    else if (!canonical.startsWith('https://')) issues.push('relative canonical');
    if (!ogImage) issues.push('no og:image');
    else if (!ogImage.startsWith('https://')) issues.push('relative og:image');
    if (!ogTitle) issues.push('no og:title');
    if (twitter !== 'summary_large_image') issues.push(`twitter:card "${twitter}"`);
    if (jsonLd < 1) issues.push('no JSON-LD');
  }

  for (const token of FORBIDDEN) {
    if (visible.includes(token)) issues.push(`contains "${token}"`);
  }
  // These must not appear anywhere at all, script payloads included.
  for (const token of FORBIDDEN_ANYWHERE) {
    if (html.includes(token)) issues.push(`contains "${token}"`);
  }

  /* What a person actually reads, as one run of plain text. See the comment on
     UNSUBSTANTIATED for why the claim guard cannot run on markup. */
  const readable = visible
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  for (const [pattern, kind] of UNSUBSTANTIATED) {
    const hit = readable.match(pattern);
    if (hit) issues.push(`unprovable ${kind}: "${hit[0].trim()}" — see UNSUBSTANTIATED in scripts/audit.mjs`);
  }
  for (const token of FORBIDDEN_MARKUP) {
    if (html.includes(token)) issues.push(`self-serving review markup "${token}" is back — see lib/schema.ts`);
  }

  // Every JSON-LD block must actually parse.
  for (const [, body] of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  )) {
    try {
      JSON.parse(body.replaceAll('\\u003c', '<'));
    } catch {
      issues.push('malformed JSON-LD');
    }
  }

  if (issues.length) failures++;
  rows.push({ rel, title, desc: desc.length, jsonLd, h1, issues });
}

const width = Math.max(...rows.map((r) => r.rel.length));
for (const r of rows) {
  const flag = r.issues.length ? 'FAIL' : ' ok ';
  const line = `${flag}  ${r.rel.padEnd(width)}  h1:${r.h1}  ld:${String(r.jsonLd).padStart(2)}  desc:${String(r.desc).padStart(3)}  ${r.title}`;
  console.log(line);
  for (const issue of r.issues) console.log(`      ↳ ${issue}`);
}

console.log(
  `\n${pages.length} pages audited — ${failures === 0 ? 'all clean' : `${failures} with issues`}`,
);

/* ---- sitemap / robots sanity ------------------------------------------- */

const sitemap = readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const robots = readFileSync(path.join(OUT, 'robots.txt'), 'utf8');

console.log(`sitemap.xml  — ${urls.length} URLs`);
if (urls.some((u) => !u.startsWith('https://'))) {
  console.log('      ↳ FAIL relative URL in sitemap');
  failures++;
}
if (!robots.includes('Sitemap:')) {
  console.log('robots.txt   — ↳ FAIL no Sitemap line');
  failures++;
} else {
  console.log(`robots.txt   — ok, ${robots.trim().split('\n').length} lines`);
}

/* Every indexable page must be in the sitemap. On a sub-path deployment (GitHub
   Pages project site) every <loc> carries the basePath prefix, so compare
   against prefix + page path rather than the bare path — an exact match, not a
   suffix match, so `/pricing/` can't be satisfied by `/anything/pricing/`. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const indexable = rows
  .filter((r) => !r.rel.includes('404') && !r.rel.includes('_not-found'))
  .map((r) => r.rel.replace(/index\.html$/, ''));
const missing = indexable.filter(
  (rel) => !urls.some((u) => new URL(u).pathname === `${BASE}/${rel}`),
);
if (missing.length) {
  console.log(`      ↳ FAIL not in sitemap: ${missing.join(', ')}`);
  failures++;
}

process.exit(failures === 0 ? 0 : 1);
