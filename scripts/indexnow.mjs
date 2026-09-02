/**
 * Tells Bing and Yandex that the site changed, via the IndexNow protocol.
 *
 * Run with:  npm run indexnow          (after a deploy has gone live)
 *
 * Google is deliberately absent: it retired its sitemap ping endpoint in 2024
 * and has no unauthenticated submission API, so the only way to nudge Google is
 * Search Console. Bing and Yandex accept this, and Bing's index feeds DuckDuckGo
 * and Ecosia too, so it is worth the one call.
 *
 * Ownership is proved by hosting KEY.txt at the site root containing the key —
 * public/<key>.txt in this repo. Read the URL list out of the built sitemap so
 * the two can never disagree.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'out');
const ENDPOINT = 'https://api.indexnow.org/indexnow';

/* The key file lives in public/ so the static export copies it to the site root.
   Finding it by pattern means rotating the key is a file rename, nothing more. */
const keyFile = readdirSync(path.join(ROOT, 'public')).find((f) =>
  /^[a-f0-9]{16,128}\.txt$/i.test(f),
);
if (!keyFile) {
  console.error('No IndexNow key file in public/ — expected <hex>.txt');
  process.exit(1);
}
const key = keyFile.replace(/\.txt$/, '');

let sitemap;
try {
  sitemap = readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
} catch {
  console.error('No out/sitemap.xml — run `npm run build` first.');
  process.exit(1);
}

const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urls.length === 0) {
  console.error('sitemap.xml contains no <loc> entries.');
  process.exit(1);
}

const host = new URL(urls[0]).host;

/* Submitting a URL whose key file is not reachable gets the whole batch
   rejected as 403, so check first and say so in plain language. */
const keyUrl = `https://${host}/${keyFile}`;
const keyCheck = await fetch(keyUrl).catch(() => null);
if (!keyCheck?.ok) {
  console.error(`${keyUrl} is not reachable (${keyCheck?.status ?? 'no response'}).`);
  console.error('Deploy first — the key file has to be live before submitting.');
  process.exit(1);
}
const served = (await keyCheck.text()).trim();
if (served !== key) {
  console.error(`${keyUrl} serves "${served}", expected "${key}".`);
  process.exit(1);
}

console.log(`key   ${keyFile} — live and correct`);
console.log(`host  ${host}`);
console.log(`urls  ${urls.length}`);

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: keyUrl, urlList: urls }),
});

/* 200 accepted, 202 accepted but key still validating — both are successes.
   Anything else is worth printing verbatim rather than interpreting. */
const body = await res.text();
if (res.status === 200 || res.status === 202) {
  console.log(`\nsubmitted — HTTP ${res.status}${res.status === 202 ? ' (key pending validation)' : ''}`);
  console.log('Bing and Yandex will crawl in their own time; there is no queue to watch.');
} else {
  console.error(`\nrejected — HTTP ${res.status}`);
  if (body) console.error(body);
  process.exit(1);
}
