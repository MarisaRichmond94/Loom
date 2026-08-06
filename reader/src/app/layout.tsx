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
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-surface-base text-ink">{children}</body>
    </html>
  )
}
