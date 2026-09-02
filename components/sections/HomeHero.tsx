import { Badge } from '@/components/ui/Badge';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Section';
import { HeroDispatch } from '@/components/sections/HeroDispatch';
import {
  CertificateIcon,
  ClockIcon,
  NoAlcoholIcon,
  PhoneIcon,
  ShieldIcon,
} from '@/components/icons';
import { formatPhone, site, telHref } from '@/lib/site';

const chips = [
  { icon: ShieldIcon, label: 'Police verified' },
  { icon: NoAlcoholIcon, label: 'Zero alcohol policy' },
  { icon: CertificateIcon, label: 'Professionally trained' },
  { icon: ClockIcon, label: '30-minute arrival' },
];

/**
 * Home hero. Ink band, single H1, two calls to action — call first, because this
 * business converts on the phone — and the trust chips that carry the whole pitch.
 */
export function HomeHero() {
  return (
    <section aria-labelledby="hero-heading" className="bg-ink text-fg-inverse">
      <Container className="py-16 sm:py-20 lg:py-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="onDark">
              <span className="bg-success size-1.5 rounded-full" aria-hidden="true" />
              Available now · 24/7
            </Badge>
            {/* A star rating used to sit here, reading "4.9 from 187 reviews". The
                figure was never real, so it is gone — see the UNSUBSTANTIATED guard
                in scripts/audit.mjs, which now fails the build if it comes back.
                Real stars belong on the Google Business Profile, earned from real
                customers; the trust chips below carry this slot's work meanwhile. */}
          </div>

          {/* Two lines in one H1: the slogan carries the brand and stays visually
              dominant, the second line names the thing we sell and where — which
              is what a "driver service in Chhattisgarh" search is looking for.
              The lede below deliberately no longer repeats the city list. */}
          <h1 id="hero-heading" className="mt-6">
            <span className="text-display-xl block">
              Your car. <span className="text-accent">Our driver.</span>
            </span>
            <span className="text-lede mt-4 block font-semibold text-white/85">
              Driver service in {site.region} — Raipur, Bhilai, Durg &amp; Bilaspur
            </span>
          </h1>

          <p className="text-lede mt-5 max-w-xl text-white/70">
            Police-verified, breath-tested, professionally trained drivers at your doorstep in
            about 30 minutes, 24 hours a day. You keep your own car; we take the wheel.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonAnchor href={telHref} size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
            <ButtonLink href="#book" variant="onDark" size="lg">
              Book online in 30 seconds
            </ButtonLink>
          </div>

          <ul className="mt-11 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:gap-x-9">
            {chips.map((chip) => (
              <li key={chip.label} className="flex items-center gap-2.5 text-sm text-white/80">
                <chip.icon className="text-accent size-5 shrink-0" />
                {chip.label}
              </li>
            ))}
          </ul>
          </div>

          {/* Desktop only: the card fills the hero's right column from lg up.
              On phones it read as cramped stacked under the copy, so it is hidden
              there and the hero stays copy-only — cleaner on a narrow screen. */}
          <div className="hidden lg:block">
            <HeroDispatch />
          </div>
        </div>
      </Container>
    </section>
  );
}
