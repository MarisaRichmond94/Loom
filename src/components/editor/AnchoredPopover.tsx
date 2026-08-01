'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { portalHost } from '@/lib/portalHost'

// A dropdown that escapes its dialog (LOOM-32 / LOOM-33).
//
// Extracted from EventModal once the character modal needed the same thing.
// The bug it exists for is subtle and recurring: a modal scrolls its own body,
// and an `overflow` ancestor CLIPS absolutely positioned descendants — so a
// list opening near the bottom of a dialog is cut off rather than overflowing
// it. No z-index fixes that; only leaving the clipping context does.

/** Four rows, then scroll. Matches the row height below (py-1.5 + 11px text). */
export const LIST_MAX_HEIGHT = 4 * 28

/** Close a popover when the pointer goes down outside ALL of the given
 *  elements. Takes several because a portalled dropdown is not a DOM
 *  descendant of the control that opened it. */
export function useClickOutside(
  refs: React.RefObject<HTMLElement | null>[],
  onOutside: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      if (refs.some(r => r.current?.contains(target))) return
      onOutside()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOutside, active])
}

/**
 * A dropdown anchored to a control but rendered at the document root.
 *
 * The dialog scrolls its own body, and an `overflow` ancestor CLIPS absolutely
 * positioned descendants — which is why the location list was being cut off at
 * the modal's edge. Portalling escapes the clip; fixed coordinates taken from
 * the anchor keep it attached.
 *
 * Flips above the anchor when there is not enough room below, so a control near
 * the bottom of the modal still shows its options.
 */
export function AnchoredPopover({
  anchorRef,
  popoverRef,
  children,
  width,
  className = '',
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  popoverRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
  /** Defaults to the anchor's width — right for a full-width field, wrong for
   *  a small button, which wants a readable list instead. */
  width?: number
  className?: string
}) {
  const [style, setStyle] = useState<React.CSSProperties | null>(null)

  useEffect(() => {
    function place() {
      const anchor = anchorRef.current
      if (!anchor) return
      const r = anchor.getBoundingClientRect()
      // Header + list at full height, so the flip decision does not depend on
      // how many results happen to match.
      const needed = LIST_MAX_HEIGHT + 56
      const below = window.innerHeight - r.bottom
      const w = width ?? r.width
      setStyle(
        below < needed && r.top > below
          ? { position: 'fixed', left: r.left, width: w, bottom: window.innerHeight - r.top + 4 }
          : { position: 'fixed', left: r.left, width: w, top: r.bottom + 4 },
      )
    }
    place()
    window.addEventListener('resize', place)
    // Capture phase so the modal's own scroll container is heard too.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef, width])

  if (!style) return null
  return createPortal(
    <div
      ref={popoverRef}
      style={style}
      className={`z-[300] overflow-hidden rounded-md border border-accent/20 bg-surface-raised shadow-lg ${className}`}
    >
      {children}
    </div>,
    portalHost(),
  )
}

