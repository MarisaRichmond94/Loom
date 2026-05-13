'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { LuUser } from 'react-icons/lu'

export default function AvatarButton() {
  const [hasAvatar, setHasAvatar] = useState(false)
  const [avatarTs, setAvatarTs] = useState(0)

  useEffect(() => {
    fetch('/avatar.jpg', { method: 'HEAD' })
      .then(r => { if (r.ok) { setHasAvatar(true); setAvatarTs(Date.now()) } })
      .catch(() => {})
  }, [])

  return (
    <Link
      href="/settings"
      title="Settings"
      className="w-10 h-10 rounded-full overflow-hidden border-2 border-accent/30 hover:border-accent transition flex items-center justify-center bg-surface-raised shrink-0"
    >
      {hasAvatar
        ? <img src={`/avatar.jpg?t=${avatarTs}`} alt="Avatar" className="w-full h-full object-cover" />
        : <LuUser size={20} className="text-ink-faint" />
      }
    </Link>
  )
}
