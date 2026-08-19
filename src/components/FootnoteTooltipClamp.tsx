'use client'

import { useEffect } from 'react'
import { attachFootnoteTooltipClamp } from '@shared/footnoteTooltip'

/** Mounted once at the root so footnote tooltips stay on screen everywhere
 *  they render (editor, read view, review panel, ...) — see footnoteTooltip.ts. */
export default function FootnoteTooltipClamp() {
  useEffect(() => attachFootnoteTooltipClamp(), [])
  return null
}
