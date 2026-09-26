import type { NextConfig } from 'next';

const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

function objectStoragePattern() {
  const endpoint = process.env.S3_ENDPOINT;

  if (!endpoint) return null;

  try {
    const url = new URL(endpoint);

    return {
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
      hostname: url.hostname,
      ...(url.port ? { port: url.port } : {}),
      pathname: '/**',
    };
  } catch {
    return null;
  }
}

const storagePattern = objectStoragePattern();

const nextConfig: NextConfig = {
  // These packages use Node APIs that the bundler must not rewrite.
  serverExternalPackages: [
    'postgres',
    'nodemailer',
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
    '@aws-sdk/s3-request-presigner',
    'redis',
    'resend',
  ],
  experimental: {
    serverActions: {
      // File bytes go to the bucket, not through an action. The limit remains
      // above the 50MB file cap so a large action payload is not the surprise.
      bodySizeLimit: '100MB',
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.freepik.com',
      },
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
        pathname: '/**',
      },
      {
        protocol: appUrl.protocol.replace(':', '') as 'http' | 'https',
        hostname: appUrl.hostname,
      },
      ...(storagePattern ? [storagePattern] : []),
    ],
  },
};

export default nextConfig;
