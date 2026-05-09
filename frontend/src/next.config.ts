import type { NextConfig } from 'next';

const config: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '/edit2me',
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '210mb',
    },
  },
  // PDF binary handling: API routes는 Node 런타임에서만 동작
  serverExternalPackages: [],
  eslint: {
    // ESLint config가 없을 때 빌드를 막지 않도록.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // tsc로 별도 타입체크 단계가 있으므로 next build에서는 skip
    ignoreBuildErrors: false,
  },
};

export default config;
