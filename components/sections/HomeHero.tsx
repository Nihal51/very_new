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
  StarFilledIcon,
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
            <span className="flex items-center gap-1.5 text-sm text-white/70">
              <StarFilledIcon className="text-accent size-4" />
              <span className="tabular font-semibold text-white">{site.rating.value}</span>
              from {site.rating.count} reviews
            </span>
          </div>

          <h1 id="hero-heading" className="text-display-xl mt-6">
            Your car.{' '}
            <span className="text-accent">Our driver.</span>
          </h1>

          <p className="text-lede mt-5 max-w-xl text-white/70">
            Police-verified, breath-tested, professionally trained drivers at your doorstep in
            about 30 minutes — across Raipur, Bhilai, Durg and Bilaspur. You keep your own car;
            we take the wheel.
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
