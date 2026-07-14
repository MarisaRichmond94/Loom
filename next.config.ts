import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // User uploads are written into public/ at runtime, but `next start` only
  // serves files that existed in public/ when the server booted. These
  // beforeFiles rewrites (checked before the static public lookup) route those
  // URLs to a streaming handler that reads from disk on every request, so
  // newly uploaded audio/art/avatars/covers appear without a server restart.
  // See src/app/api/media/[...path]/route.ts.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/music/:path*', destination: '/api/media/music/:path*' },
        { source: '/narration/:path*', destination: '/api/media/narration/:path*' },
        { source: '/characters/:path*', destination: '/api/media/characters/:path*' },
        { source: '/covers/:path*', destination: '/api/media/covers/:path*' },
        { source: '/avatar.jpg', destination: '/api/media/avatar.jpg' },
        { source: '/pseudonym-avatar.jpg', destination: '/api/media/pseudonym-avatar.jpg' },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
};

export default nextConfig;
