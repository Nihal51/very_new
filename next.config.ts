import type { NextConfig } from 'next';

/**
 * When the site is served from a sub-path rather than a domain root — which is
 * what GitHub Pages does for a project repo, e.g. `nihal51.github.io/very_new/`
 * — every asset URL has to carry that prefix or the CSS and JS 404 and the page
 * renders unstyled. The deploy workflow sets this automatically; it stays empty
 * once a custom domain is configured, because then the site *is* at the root.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  // Emits a fully static site into ./out — deployable on any host.
  output: 'export',
  // Static export has no image optimisation server; assets are pre-compressed instead.
  images: { unoptimized: true },
  // Directory-style URLs (/pricing/index.html) so plain static hosts serve them cleanly.
  trailingSlash: true,
  basePath,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
