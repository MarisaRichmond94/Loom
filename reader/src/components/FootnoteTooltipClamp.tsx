'use client'

import { useEffect } from 'react'
import { attachFootnoteTooltipClamp } from '@/shared/footnoteTooltip'

/** Mounted once at the root so footnote tooltips stay on screen — see
 *  shared/footnoteTooltip.ts. */
export default function FootnoteTooltipClamp() {
  useEffect(() => attachFootnoteTooltipClamp(), [])
  return null
}
