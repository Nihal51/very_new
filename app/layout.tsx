import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { JsonLd } from '@/components/JsonLd';
import { MobileCTABar } from '@/components/MobileCTABar';
import { localBusinessSchema } from '@/lib/schema';
import { site } from '@/lib/site';

/**
 * Fonts are downloaded at build time and served from our own origin, so there is
 * no blocking request to fonts.googleapis.com and no layout shift on first paint.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500', '600', '700'],
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
  weight: ['600', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — Verified Drivers On Demand in Raipur, Bhilai, Durg & Bilaspur`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  authors: [{ name: site.legalName }],
  creator: site.legalName,
  publisher: site.legalName,
  keywords: [
    'driver on call',
    'driver on demand',
    'hire driver Raipur',
    'driver service Bhilai',
    'night driver Chhattisgarh',
    'personal driver Durg',
    'call driver Bilaspur',
  ],
  category: 'Transportation',
  formatDetection: { telephone: true, address: false, email: true },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  alternates: { canonical: '/' },
  icons: {
    icon: [{ url: '/assets/logo.png', type: 'image/png' }],
    apple: [{ url: '/assets/logo.png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${jakarta.variable}`}>
      <body>
        <a href="#main" className="sr-only-focusable bg-accent text-ink top-3 left-3 z-50 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-md">
          Skip to content
        </a>

        <Header />

        <main id="main">{children}</main>

        <Footer />

        <MobileCTABar />
        {/* Reserves room so the sticky mobile bar never covers the footer's last row. */}
        <div aria-hidden="true" className="h-[4.25rem] lg:hidden" />

        {/* Site-wide business entity; page-level schema references it by @id. */}
        <JsonLd data={localBusinessSchema()} />
      </body>
    </html>
  );
}
