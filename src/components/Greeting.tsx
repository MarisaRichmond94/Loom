'use client'

import { useEffect, useState } from 'react'

function buildGreeting(name: string): string {
  const hour = new Date().getHours()
  const period = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  return name ? `Good ${period}, ${name}` : `Good ${period}`
}

export default function Greeting() {
  const [text, setText] = useState('')

  useEffect(() => {
    const update = () => {
      const name = (localStorage.getItem('loom-author-name') ?? '').trim()
      setText(buildGreeting(name))
    }
    update()
    const interval = setInterval(update, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (!text) return null
  return <span className="text-sm text-white whitespace-nowrap mr-2">{text}</span>
}
