import type { NextConfig } from 'next';

const config: NextConfig = {
  agentRules: false,
  // Next's gzip would buffer the /api/.../live SSE stream that its rewrite proxies; a reverse proxy in front compresses instead.
  compress: false,
  transpilePackages: ['@standing/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:4100'}/:path*` }];
  },
};
export default config;
