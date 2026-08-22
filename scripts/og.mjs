/**
 * Generates public/og.png (1200×630) — the social preview card.
 *
 * Run with:  npm run og
 *
 * Rasterises an SVG with sharp rather than screenshotting a browser, so the
 * output is deterministic, ~40 KB, and needs no dev server. The logo is
 * composited in from public/assets/logo.png at its native aspect ratio.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOGO = path.join(ROOT, 'public', 'assets', 'logo.png');
const OUT = path.join(ROOT, 'public', 'og.png');

const W = 1200;
const H = 630;

/* Palette lifted from app/globals.css so the card cannot drift from the site. */
const INK = '#0c0a09';
const INK_SOFT = '#1c1917';
const AMBER = '#f59e0b';
const WHITE = '#fafaf9';
const MUTED = '#a1a1aa';

/* Windows first, then the Linux/CI fallbacks — whichever fontconfig resolves. */
const SANS = 'Segoe UI, Inter, DejaVu Sans, Liberation Sans, Arial, sans-serif';

const LOGO_H = 88;
const PAD = 88; // left margin, shared by every element
const PLAQUE_PAD = 16;
const PLAQUE_Y = 92;

const svg = (logoW) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${INK}"/>
      <stop offset="1" stop-color="${INK_SOFT}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.88" cy="0.12" r="0.62">
      <stop offset="0" stop-color="${AMBER}" stop-opacity="0.20"/>
      <stop offset="1" stop-color="${AMBER}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- amber rule along the top, matching the site's accent -->
  <rect x="0" y="0" width="${W}" height="8" fill="${AMBER}"/>

  <!-- The logo mark is black-on-amber, so it needs a light plaque to read
       against the ink background. -->
  <rect x="${PAD}" y="${PLAQUE_Y}" width="${logoW + PLAQUE_PAD * 2}"
        height="${LOGO_H + PLAQUE_PAD * 2}" rx="24" fill="${WHITE}"/>

  <!-- wordmark, sitting to the right of the composited logo -->
  <text x="${PAD + logoW + PLAQUE_PAD * 2 + 28}" y="${PLAQUE_Y + (LOGO_H + PLAQUE_PAD * 2) / 2}"
        font-family="${SANS}" font-size="48" font-weight="700" letter-spacing="-1"
        dominant-baseline="middle">
    <tspan fill="${WHITE}">Drive</tspan><tspan fill="${AMBER}">Buddy</tspan>
  </text>

  <text x="${PAD}" y="332" font-family="${SANS}" font-size="72" font-weight="700"
        letter-spacing="-2.6" fill="${WHITE}">Your car. <tspan fill="${AMBER}">Our driver.</tspan></text>

  <text x="${PAD}" y="398" font-family="${SANS}" font-size="31" font-weight="400" fill="${MUTED}">
    Verified, sober, professional drivers at your door in 30 minutes.
  </text>

  <!-- coverage / availability chips -->
  <g font-family="${SANS}" font-size="24" font-weight="600">
    <rect x="${PAD}" y="446" width="478" height="54" rx="27" fill="#ffffff"
          fill-opacity="0.07" stroke="${AMBER}" stroke-opacity="0.45"/>
    <text x="${PAD + 30}" y="474" fill="${WHITE}" dominant-baseline="middle">Raipur · Bhilai · Durg · Bilaspur</text>

    <rect x="${PAD + 478 + 18}" y="446" width="184" height="54" rx="27" fill="${AMBER}"/>
    <text x="${PAD + 478 + 18 + 30}" y="474" fill="${INK}" dominant-baseline="middle">Open 24/7</text>
  </g>

  <text x="${PAD}" y="570" font-family="${SANS}" font-size="27" font-weight="600" fill="${AMBER}">
    +91 91114 73929
  </text>
  <text x="${W - PAD}" y="570" font-family="${SANS}" font-size="24" font-weight="400"
        fill="${MUTED}" text-anchor="end">drivebuddy.in</text>
</svg>`;

const logoMeta = await sharp(LOGO).metadata();
const logoW = Math.round(LOGO_H * ((logoMeta.width ?? 200) / (logoMeta.height ?? 167)));

const logo = await sharp(await readFile(LOGO))
  .resize({ height: LOGO_H, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

// librsvg renders at 96 DPI; sharp's default density is 72, which would scale the
// canvas to 1600×840. Rasterise at 72 so 1 SVG unit === 1 output pixel, then
// resize as a belt-and-braces guard so the composite offsets can never drift.
const canvas = await sharp(Buffer.from(svg(logoW)), { density: 72 })
  .resize(W, H, { fit: 'fill' })
  .png()
  .toBuffer();

const png = await sharp(canvas)
  .composite([{ input: logo, top: PLAQUE_Y + PLAQUE_PAD, left: PAD + PLAQUE_PAD }])
  .png({ compressionLevel: 9, palette: false })
  .toBuffer();

const { width, height } = await sharp(png).metadata();
if (width !== W || height !== H) {
  throw new Error(`og.png came out ${width}×${height}, expected ${W}×${H}`);
}

await writeFile(OUT, png);
console.log(`og.png written — ${width}×${height}, ${Math.round(png.length / 1024)} KB`);

