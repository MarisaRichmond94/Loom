'use client'

import Link from 'next/link'
import { LuSettings } from 'react-icons/lu'

export default function SettingsButton() {
  return (
    <Link
      href="/settings"
      title="Settings"
      className="text-ink-faint hover:text-ink transition"
    >
      <LuSettings size={18} />
    </Link>
  )
}
