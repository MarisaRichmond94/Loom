import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Loom', description: 'Branching narrative editor' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface-base text-ink">{children}</body>
    </html>
  )
}
