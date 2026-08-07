import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { assertReaderSafe, CONTENT_DB_PATH } from '@/lib/db'

// Same type treatment as Loom (LOOM-21): Inter for content, self-hosted by
// next/font, exposed as a CSS variable so the shared @theme can point
// --font-sans at it. Chrome stays on system-ui via --font-chrome.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Loom',
  description: 'Read',
  // No indexing. This is only ever served over a private tailnet (LOOM-136),
  // but saying so costs nothing and covers a future mistake.
  robots: { index: false, follow: false },
}

// Boot-time refusal, at module scope so it runs before a single request is
// served. A misconfiguration should stop the app, not quietly serve the
// manuscript to the family.
assertReaderSafe(CONTENT_DB_PATH)

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is REQUIRED here, not a papering-over. The
    // script below deliberately adds `pre-light` to this element before React
    // hydrates, so the live DOM and React's render disagree by design — and
    // React logged that mismatch as an error on EVERY page load, which is both
    // console noise and a real cost (it was driving `logd` hard enough to show
    // up in system load).
    //
    // It applies to THIS element's own attributes only, one level deep. A
    // genuine mismatch anywhere below still reports normally, so this does not
    // blind the app to the class of bug it looks like it is hiding.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Applies the light preference BEFORE first paint. Without it every
            navigation flashes dark: the server cannot know the preference, and
            localStorage is only readable after mount. Inline and synchronous
            on purpose — a deferred script would paint first.
            Chrome stays dark inside it via `chrome-dark`. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('loom-light-mode')==='true')document.documentElement.classList.add('pre-light')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-surface-base text-ink">{children}</body>
    </html>
  )
}
