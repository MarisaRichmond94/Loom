import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  images: {
    // next/image refuses to optimize a local `src` that carries a query
    // string unless its path is explicitly allow-listed — the default is
    // effectively `[{ pathname: '/**', search: '' }]`, and anything else
    // 400s with `"url" parameter is not allowed`.
    //
    // That default silently broke every re-uploaded image: the cover upload
    // route bakes a `?v=<timestamp>` cache-buster into the stored coverPath
    // (see books/[bookId]/cover/route.ts), and character avatars do the same,
    // so any cover replaced after its first upload rendered as a broken image
    // on the home Explore grid, the author modal and both preview pages.
    // Listing the runtime-upload directories without a `search` constraint
    // allows the buster through; everything else in public/ keeps the strict
    // default via the trailing entry.
    localPatterns: [
      { pathname: '/covers/**' },
      { pathname: '/characters/**' },
      { pathname: '/avatar.jpg' },
      { pathname: '/pseudonym-avatar.jpg' },
      { pathname: '/**', search: '' },
    ],
    // 75 is Next's default and what the reader-facing pages use. 90 is for
    // the author-side covers, which sit next to the source art the writer
    // just uploaded — the extra few KB buys "indistinguishable from the
    // original" at a glance. Next 16 requires every quality used to be
    // listed here.
    qualities: [75, 90],
  },
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
