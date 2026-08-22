import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Section';
import { PhoneIcon, WhatsappIcon } from '@/components/icons';
import { formatPhone, site, telHref, waHref } from '@/lib/site';

/** Closing conversion band. Dark ink so it reads as a full stop on every page. */
export function ClosingCTA({
  title = 'Need a driver right now?',
  lede = 'Call us and a police-verified, sober driver reaches you in about 30 minutes — anywhere in Raipur, Bhilai, Durg or Bilaspur.',
}: {
  title?: string;
  lede?: string;
}) {
  return (
    <section aria-labelledby="closing-cta-heading" className="bg-ink text-fg-inverse">
      <Container className="py-16 sm:py-20 lg:py-24">
        <div className="reveal mx-auto max-w-3xl text-center">
          <h2 id="closing-cta-heading" className="text-display-md">
            {title}
          </h2>
          <p className="text-lede mt-4 text-white/70">{lede}</p>

          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonAnchor href={telHref} size="lg">
              <PhoneIcon className="size-5" />
              <span className="tabular">{formatPhone(site.phone)}</span>
            </ButtonAnchor>
            <ButtonAnchor
              href={waHref(`Hi ${site.name}, I need a driver.`)}
              target="_blank"
              rel="noopener noreferrer"
              variant="onDark"
              size="lg"
            >
              <WhatsappIcon className="size-5" />
              WhatsApp us
            </ButtonAnchor>
            <ButtonLink href="/book/" variant="onDark" size="lg">
              Book online
            </ButtonLink>
          </div>

          <p className="mt-6 text-sm text-white/50">
            Available 24 hours · Alternate line{' '}
            <span className="tabular">{formatPhone(site.phoneAlt)}</span>
          </p>
        </div>
      </Container>
    </section>
  );
}
