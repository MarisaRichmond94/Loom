import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  // PIN THE ROOT. Without this Next walks up, finds the Loom repo's lockfile,
  // infers that as the workspace root and compiles Loom's own src/ — the first
  // run picked up Loom's instrumentation.ts and tried to start the backup and
  // narration schedulers inside the reader app. That is precisely the cross-app
  // leak a separate process exists to prevent, so it is pinned rather than left
  // to inference.
  turbopack: { root: __dirname },
  // Published media is HARDLINKED into reader/public by the publish step, after
  // this server has already booted. `next start` only serves files that existed
  // at boot, so these rewrites route the media URLs to a handler that reads
  // from disk per request — the same pattern Loom uses for runtime uploads.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/music/:path*', destination: '/api/media/music/:path*' },
        { source: '/narration/:path*', destination: '/api/media/narration/:path*' },
        { source: '/characters/:path*', destination: '/api/media/characters/:path*' },
        { source: '/covers/:path*', destination: '/api/media/covers/:path*' },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
}

export default nextConfig
