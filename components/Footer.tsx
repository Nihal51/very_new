import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { MailIcon, PhoneIcon, WhatsappIcon } from '@/components/icons';
import { cities, services } from '@/lib/content';
import { formatPhone, mailHref, site, telHref, telHrefAlt, waHref } from '@/lib/site';

const company = [
  { href: '/services/', label: 'All services' },
  { href: '/pricing/', label: 'Pricing' },
  { href: '/book/', label: 'Book a driver' },
  { href: '/drivers/', label: 'Driver jobs' },
  { href: '/faq/', label: 'FAQ' },
  { href: '/contact/', label: 'Contact' },
];

function ColumnHeading({ children }: { children: string }) {
  return (
    <h2 className="text-eyebrow text-white/45 uppercase">{children}</h2>
  );
}

const linkClass =
  'text-sm text-white/70 transition-colors duration-150 hover:text-accent rounded-lg';

export function Footer() {
  return (
    <footer className="bg-ink text-fg-inverse">
      <div className="container-page py-14 lg:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          {/* Brand + primary contact */}
          <div>
            <Logo tone="dark" showTagline />
            <p className="mt-5 max-w-xs text-sm text-white/60">
              Police-verified, sober, professionally trained drivers for your own car —
              across {site.region}, 24 hours a day.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a
                href={telHref}
                className="text-ink bg-accent hover:bg-accent-hover inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors duration-150"
              >
                <PhoneIcon className="size-4" />
                <span className="tabular">{formatPhone(site.phone)}</span>
              </a>
              <a
                href={waHref('Hi DriveBuddy, I need a driver.')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:border-white/45 hover:bg-white/10"
              >
                <WhatsappIcon className="size-4" />
                WhatsApp
              </a>
            </div>
          </div>

          <nav aria-labelledby="footer-services">
            <ColumnHeading>Services</ColumnHeading>
            <ul id="footer-services" className="mt-4 flex flex-col gap-3">
              {services.map((s) => (
                <li key={s.slug}>
                  <Link href={`/services/#${s.slug}`} className={linkClass}>
                    {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-cities">
            <ColumnHeading>Cities</ColumnHeading>
            <ul id="footer-cities" className="mt-4 flex flex-col gap-3">
              {cities.map((c) => (
                <li key={c.slug}>
                  <Link href={`/cities/${c.slug}/`} className={linkClass}>
                    Drivers in {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <nav aria-labelledby="footer-company">
              <ColumnHeading>Company</ColumnHeading>
              <ul id="footer-company" className="mt-4 grid grid-cols-2 gap-3">
                {company.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={linkClass}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <h2 className="text-eyebrow mt-8 text-white/45 uppercase">Reach us</h2>
            <ul className="mt-4 flex flex-col gap-3">
              <li>
                <a href={telHrefAlt} className={`${linkClass} tabular inline-flex items-center gap-2`}>
                  <PhoneIcon className="size-4 shrink-0" />
                  {formatPhone(site.phoneAlt)}
                </a>
              </li>
              <li>
                <a href={mailHref} className={`${linkClass} inline-flex items-center gap-2 break-all`}>
                  <MailIcon className="size-4 shrink-0" />
                  {site.email}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-white/45">
            © {site.foundingYear}–2026 {site.legalName}. Serving Raipur, Bhilai, Durg and
            Bilaspur.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            <li>
              <Link href="/privacy/" className="text-xs text-white/45 hover:text-white/80">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms/" className="text-xs text-white/45 hover:text-white/80">
                Terms
              </Link>
            </li>
            <li>
              <Link href="/cities/" className="text-xs text-white/45 hover:text-white/80">
                Service area
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
