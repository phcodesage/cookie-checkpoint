import type { NextConfig } from 'next';

const nextConfig: NextConfig =
  process.env.VERCEL === '1' ? { output: 'export' } : {};

export default nextConfig;
