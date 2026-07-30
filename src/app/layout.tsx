import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

// Inter for content (KAN-21). next/font self-hosts it — no external request and
// no layout shift. Exposed as a CSS variable so globals.css's @theme can point
// --font-sans at it.
//
// The header deliberately does NOT use this: chrome stays on system-ui via
// font-chrome. See TOKENS.md.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = { title: 'Loom', description: 'Branching narrative editor' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-surface-base text-ink">
        {children}
      </body>
    </html>
  )
}
