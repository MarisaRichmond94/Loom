import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import ChromeFlagToggle from '@/components/ChromeFlagToggle'
import { chromeBootScript, chromeDefaultOn } from '@/lib/unifiedChrome'

export const metadata: Metadata = { title: 'Loom', description: 'Branching narrative editor' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* UNIFIED_CHROME (KAN-6) — TEMPORARY, remove when KAN-8 closes.
            beforeInteractive puts this in <head> of the server HTML and runs it
            before any Next.js module, so the palette is settled before first
            paint rather than flashing the old one. The root layout is where
            beforeInteractive must live — a framework requirement, not a
            preference. */}
        <Script id="unified-chrome-boot" strategy="beforeInteractive">
          {chromeBootScript(chromeDefaultOn)}
        </Script>
      </head>
      <body className="min-h-screen bg-surface-base text-ink">
        <ChromeFlagToggle />
        {children}
      </body>
    </html>
  )
}
