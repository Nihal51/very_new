import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits a fully static site into ./out — deployable on any host.
  output: 'export',
  // Static export has no image optimisation server; assets are pre-compressed instead.
  images: { unoptimized: true },
  // Directory-style URLs (/pricing/index.html) so plain static hosts serve them cleanly.
  trailingSlash: true,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
