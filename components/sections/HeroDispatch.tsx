import { CheckIcon, MapPinIcon, ShieldIcon } from '@/components/icons';

/**
 * The hero's right-hand column: a stylised live-dispatch card.
 *
 * This is the site's only piece of decorative-adjacent motion, and it earns its
 * place by carrying the pitch — the route draws itself in about the time it
 * takes to read "30 minutes". It is pure CSS and SVG (no image, no library,
 * ~1 KB of markup), shown from the lg breakpoint up (hidden on phones, where it
 * read as cramped), and it stops dead under `prefers-reduced-motion` via the
 * global rule in globals.css.
 *
 * Deliberately not a mascot: the product being sold here is trust.
 */

/* One shared path string, so the drawn line and the travelling dot cannot drift. */
const ROUTE =
  'M 24 148 C 70 148 66 96 108 96 S 150 44 196 44 C 232 44 244 62 262 62';

const steps = [
  { icon: CheckIcon, label: 'Booking confirmed', tone: 'done' as const },
  { icon: ShieldIcon, label: 'Verified driver assigned', tone: 'done' as const },
  { icon: MapPinIcon, label: 'Arriving in 28 minutes', tone: 'live' as const },
];

export function HeroDispatch() {
  return (
    <div
      aria-hidden="true"
      className="border-ink-border bg-ink-soft/80 shadow-lg relative overflow-hidden rounded-2xl border p-6"
    >
      {/* faint amber wash, top-right — echoes the OG card. Kept small on phones
          so it stays a wash and not a blob on the narrower card. */}
      <div
        className="from-accent/10 pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-radial to-transparent sm:-top-24 sm:-right-24 sm:size-64"
      />

      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-white/60 uppercase">
          <span className="relative flex size-2">
            <span className="bg-success motion-safe:animate-ping-soft absolute inset-0 rounded-full" />
            <span className="bg-success relative size-2 rounded-full" />
          </span>
          Live dispatch
        </span>
        <span className="tabular text-xs font-semibold text-white/40">24 / 7</span>
      </div>

      {/* route */}
      <svg
        viewBox="0 0 286 176"
        className="mt-5 w-full"
        role="presentation"
        focusable="false"
      >
        {/* grid, suggesting a street map without pretending to be one */}
        <g stroke="currentColor" className="text-white/[0.1]" strokeWidth="1">
          <path d="M0 44h286M0 96h286M0 148h286M60 0v176M132 0v176M204 0v176" />
        </g>

        {/* the road, dimmed — the full track the amber line traces over */}
        <path d={ROUTE} fill="none" stroke="currentColor" className="text-white/20" strokeWidth="3" strokeLinecap="round" />

        {/* the road, drawn in amber */}
        <path
          d={ROUTE}
          fill="none"
          stroke="currentColor"
          className="text-accent motion-safe:animate-route-draw"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="320"
        />

        {/* origin */}
        <circle cx="24" cy="148" r="5" fill="currentColor" className="text-white/70" />

        {/* destination */}
        <g className="text-accent">
          <circle cx="262" cy="62" r="9" fill="currentColor" fillOpacity="0.18" />
          <circle cx="262" cy="62" r="4.5" fill="currentColor" />
        </g>

        {/* the car, travelling the path */}
        <circle
          r="4"
          fill="currentColor"
          className="text-white motion-safe:animate-route-dot"
          style={{ offsetPath: `path("${ROUTE}")`, offsetRotate: '0deg' }}
        />
      </svg>

      <ul className="relative mt-5 flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3 text-sm">
            <span
              className={
                step.tone === 'live'
                  ? 'bg-accent text-ink flex size-7 shrink-0 items-center justify-center rounded-full'
                  : 'bg-success/15 text-success flex size-7 shrink-0 items-center justify-center rounded-full'
              }
            >
              <step.icon className="size-4" />
            </span>
            <span className={step.tone === 'live' ? 'font-semibold text-white' : 'text-white/60'}>
              {step.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
