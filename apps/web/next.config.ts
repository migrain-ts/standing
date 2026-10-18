import type { NextConfig } from 'next';

const config: NextConfig = {
  agentRules: false,
  transpilePackages: ['@standing/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:4100'}/:path*` }];
  },
};
export default config;
