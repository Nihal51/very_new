# DriveBuddy

Production website for DriveBuddy — driver-on-demand services in Raipur, Bhilai,
Durg and Bilaspur, Chhattisgarh.

Next.js 16 (App Router) · Tailwind CSS v4 · TypeScript · statically exported to
plain HTML. No server, no database calls at render time, no runtime Node
process. The whole site is a folder of files you can host anywhere.

---

## Before you go live — three things

### 1. Deploy the Firestore rules ⚠️ **do this first**

The site writes bookings straight from the browser to Firestore. Until the rules
in [`firestore.rules`](firestore.rules) are deployed, **anyone can read every
customer's name, phone number and home address** out of the `bookings`
collection — the Firebase API key in the page source is all they need. The key is
a public identifier by design; the rules are the actual security boundary.

```bash
npx firebase-tools deploy --only firestore:rules
```

(If the Firebase CLI is already installed globally, `firebase deploy --only firestore:rules`.
You will be asked to log in the first time. `firebase.json` and `.firebaserc` in
this repo already point at project `drive-buddy-acc4c`.)

What the rules do:

| Operation | Bookings & driver applications |
| --- | --- |
| `create` | Allowed — but only documents matching the exact field shape, types and length limits the two forms produce |
| `read` | **Denied.** Nobody can list or fetch a lead from the browser |
| `update` | **Denied.** A submitted lead is immutable from the client |
| `delete` | **Denied** |

You read your leads in the [Firebase console](https://console.firebase.google.com/project/drive-buddy-acc4c/firestore),
which bypasses these rules — as does any backend using the Admin SDK.

**Also recommended: turn on App Check.** In the Firebase console →
_App Check_ → register the web app with reCAPTCHA v3 and enforce it for
Firestore. The rules validate the *shape* of a write; App Check validates that
the write came from your real website rather than a script. That is what stops
someone spamming ten thousand fake bookings into your collection.

### 2. Set the domain

The domain lives in one file: [`CNAME`](CNAME) in the repo root — a single line,
no `https://`, no trailing slash. It currently reads `thedrivebuddy.in`. GitHub
Pages reads that same file for its custom-domain setting, and
[`deploy.yml`](.github/workflows/deploy.yml) reads it to set the canonical
origin, so changing the domain is a one-line edit followed by `npm run og`.

On a host other than GitHub Pages, set a build environment variable instead:

```
NEXT_PUBLIC_SITE_URL=https://your-domain.in
```

Failing both, the fallback literal in [`lib/site.ts`](lib/site.ts) applies.
Everything derives from this origin: canonical tags, `sitemap.xml`, `robots.txt`,
Open Graph and Twitter URLs, and the JSON-LD business identity. No trailing
slash needed — one is stripped if you leave it.

### 3. Set the environment variables on your host

Not needed on GitHub Pages — [`.env.production`](.env.production) is committed
and the workflow uses it. On another host, copy the six values in from
[`.env.local`](.env.local) (Vercel → Settings → Environment Variables, Netlify →
Site configuration → Environment variables, Cloudflare Pages → Settings →
Variables). Without them the booking form still works — it shows the WhatsApp
fallback instead of saving — but you lose the lead record.

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

These are public identifiers, not secrets. They are in env vars for hygiene and
so a staging deploy can point at a separate Firebase project.

---

## Running it

```bash
npm install
npm run dev
```

Then <http://localhost:3000>.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-checks, builds, and writes the static site to `out/` |
| `npm run lint` | `tsc --noEmit` — type errors only, no build |
| `npm run og` | Regenerates `public/og.png` (the social preview card) |

## Deploying from GitHub (free, on your own domain)

Already set up: this repo pushes to
[github.com/Nihal51/very_new](https://github.com/Nihal51/very_new) and publishes
to <https://thedrivebuddy.in> via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every commit to
`main`. To redeploy:

```bash
git push
```

Watch it in the repo's **Actions** tab. It type-checks, builds, runs the SEO
audit, and only publishes if all three pass — so a broken commit cannot take the
site down. There are no repository variables or secrets to set: the Firebase
config is committed in [`.env.production`](.env.production) and the domain in
[`CNAME`](CNAME).

### Setting this up on a fresh repo

**1. Push the code.**

```bash
git init && git add -A && git commit -m "DriveBuddy production site" && git branch -M main
```

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git && git push -u origin main
```

**2. Turn on Pages.** Repo → **Settings → Pages → Build and deployment →
Source: GitHub Actions**. Then set **Custom domain** to the domain in
[`CNAME`](CNAME) and tick **Enforce HTTPS** once the certificate is issued (that
can take up to an hour).

**3. Point your DNS at GitHub.** At your registrar, for the apex domain create
four `A` records — all with host `@`:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

and for `www`, one `CNAME` record pointing at `YOUR-USERNAME.github.io`.

DNS takes anywhere from minutes to a few hours. Delete the `CNAME` file and the
workflow publishes to `https://YOUR-USERNAME.github.io/YOUR-REPO/` instead —
also fully working, with the sub-path handled automatically.

### Other hosts

`npm run build` produces `out/` — a folder of static HTML, CSS, JS and images.
Upload it anywhere, or point a host at the repo:

- **Vercel** — import the repo, no configuration needed. Add the seven env vars.
- **Netlify** — build command `npm run build`, publish directory `out`.
- **Cloudflare Pages** — build command `npm run build`, output directory `out`.
- **Firebase Hosting** — add a `hosting` block to `firebase.json` with
  `"public": "out"`, then `firebase deploy --only hosting`.
- **Any shared host / cPanel** — drag the contents of `out/` into `public_html`.

`trailingSlash: true` is set, so every route is a real `index.html` inside a
directory. That means no host-specific rewrite rules are needed and clean URLs
work on plain Apache/nginx.

---

## How it is put together

```
app/                    routes — one folder per page, App Router
  layout.tsx            fonts, metadata defaults, header/footer, site-wide JSON-LD
  page.tsx              home
  cities/[city]/        the four SEO city pages, generated from lib/content.ts
  sitemap.ts            → /sitemap.xml
  robots.ts             → /robots.txt
  globals.css           the entire design system (Tailwind v4 @theme tokens)
components/
  ui/                   Button, Card, Badge, Alert, Field, Accordion, …
  sections/             composed page sections (hero, pricing, testimonials, …)
  icons.tsx             28 hand-drawn SVG icons — no emoji, no icon font
  BookingForm.tsx       the main lead path
  DriverForm.tsx        driver recruitment
lib/
  site.ts               company details + the domain  ← single source of truth
  content.ts            every word of marketing copy, typed
  schema.ts             JSON-LD builders
  seo.ts                per-page metadata builder
  firebase.ts           lazy-loaded Firestore write, never throws
  validate.ts           form validation rules
scripts/og.mjs          generates public/og.png with sharp
firestore.rules         ⚠️ deploy this
```

### Editing content

Almost all copy lives in [`lib/content.ts`](lib/content.ts) — services, prices,
FAQs, testimonials, city areas and landmarks, driver perks. Change it there and
every page that uses it updates, including the JSON-LD and the city pages.
Adding a fifth city means adding one object to the `cities` array: the page, the
sitemap entry, the nav listing and the structured data all follow.

Phone numbers, email and the domain live in [`lib/site.ts`](lib/site.ts).

### Design system

`app/globals.css` holds every colour, type scale, radius and shadow as a
Tailwind v4 `@theme` token. There is no `tailwind.config.js`.

Contrast is designed in rather than hoped for. Amber `#f59e0b` sits at about
2.1:1 on white, so **it never carries white text**: filled amber buttons use
near-black text (11.4:1) and amber-as-text becomes `--color-accent-text`
(`#b45309`, 4.6:1). The previous site had white on gold at 2.9:1, which failed
WCAG AA. If you add a component, use the tokens and that stays true.

### Performance notes

Deliberate choices worth keeping if you edit this:

- **Fonts are self-hosted** through `next/font`. No request to
  `fonts.googleapis.com`, so no blocking third-party round trip and no layout
  shift when the font swaps in.
- **The Firebase SDK (~100 KB) is `import()`ed inside the submit handler.**
  Someone reading the pricing page never downloads it.
- **The mobile menu is a native `<dialog>`** — the browser supplies the focus
  trap, Escape handling and background inertness, so there is no JS for it.
- **The FAQ accordion is native `<details>`/`<summary>`** — zero JavaScript.
- **Scroll reveals are CSS `animation-timeline: view()`** behind `@supports`,
  and switch off under `prefers-reduced-motion`. No IntersectionObserver.

### Accessibility

Single `<h1>` per page, one visible focus style site-wide (2px amber ring),
44px minimum tap targets, skip link, `aria-current` on the active nav item,
form errors in `role="alert"` and tied to their input with `aria-describedby`,
and focus moved to the confirmation panel after a successful submit.

---

## Things left for you

- **Set the real domain** in `lib/site.ts` (see above).
- **Deploy `firestore.rules`** (see above). This one matters.
- **Have `/privacy` and `/terms` reviewed by a lawyer.** Both pages carry a
  visible notice saying so. They describe accurately what the site does, but
  the liability, insurance and DPDP Act wording needs a professional eye.
- **Verify the aggregate rating.** `lib/site.ts` declares 4.9 from 187 reviews
  in the LocalBusiness structured data, carried over from the old site. Google
  requires review markup to reflect genuine, collectable reviews — if that
  number is not real, remove `rating` from `site` and the `aggregateRating`
  block from `lib/schema.ts`.
- **Submit `sitemap.xml` to Google Search Console** once the domain is live, and
  claim the Google Business Profile for each city.

### Cleaning up the old site

The previous single-file site and its scratch files are still in `C:\git`,
untouched. Nothing here reads them. When you are happy with this build:

```bash
cd /c/git && rm -f "New Text Document.txt" "index (2).html" _original_backup.html _db_clean.html _part*.html _part*.css _b64_*.txt
```

Keep a copy somewhere first if you want the old design for reference.
