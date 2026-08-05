'use client'

import { useEffect, useRef } from 'react'
import { LuMapPin } from 'react-icons/lu'
import { formatEventTime, type WriterEvent } from '@/lib/eventSearch'

// The horizontal chart view (LOOM-102) — a port of WriteAI's WriterChartView
// against a shared spec, not a shared component: the two apps are on different
// React majors, and LOOM-5's contract is shared tokens and specs until Phase B.
//
// Geometry is WriteAI's, unchanged, down to the constants. Colour is Loom's:
// WriteAI's surface-border / surface-card / ink-primary have no meaning here,
// and a literal port would read as a foreign panel bolted into the page. The
// tokens below are the same ones the rest of Loom uses, so the chart follows
// light mode for free — WriteAI hard-coded #334155 fallbacks that would have
// stayed slate-grey on Loom's cream light theme.

const CARD_W = 160
const CARD_GAP = 48
const AXIS_Y = 176
const CHART_H = 340
const CARD_H = 100

/** Loom's accent at 20%, matching the `border-accent/20` used page-wide.
 *  Written as color-mix because SVG attributes cannot take a Tailwind class. */
const RULE = 'color-mix(in srgb, var(--color-accent) 20%, transparent)'

function smoothScrollX(el: HTMLElement, targetLeft: number, duration = 600) {
  const startLeft = el.scrollLeft
  const start = performance.now()
  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
  function step(now: number) {
    const p = Math.min((now - start) / duration, 1)
    el.scrollLeft = startLeft + (targetLeft - startLeft) * easeInOut(p)
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export function TimelineChart({
  events,
  selectedId,
  onSelect,
}: {
  events: WriterEvent[]
  selectedId: string | null
  onSelect: (event: WriterEvent) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroll the selected card into view. Reaching for it by ref rather than
  // scrollIntoView, which would also scroll the PAGE to bring the chart into
  // view — the chart is one tab of a long page, and yanking the whole page
  // because a card was clicked is worse than not scrolling at all.
  useEffect(() => {
    if (!selectedId) return
    const container = containerRef.current
    const card = cardRefs.current.get(selectedId)
    if (!container || !card) return
    const cardLeft =
      card.getBoundingClientRect().left -
      container.getBoundingClientRect().left +
      container.scrollLeft
    smoothScrollX(container, Math.max(0, cardLeft - 16))
  }, [selectedId])

  // Cards fade in as they enter the scroll port. The negative inline margins
  // mean a card is only "in" once it is properly on screen, so the ones
  // clipped at either edge stay faded rather than half-appearing.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          ;(entry.target as HTMLDivElement).style.opacity = entry.isIntersecting ? '1' : '0'
        })
      },
      { root: container, threshold: 0, rootMargin: '0px -160px 0px -160px' },
    )
    cardRefs.current.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [events])

  const totalW = Math.max(events.length * (CARD_W + CARD_GAP) + CARD_GAP, 800)

  return (
    <div ref={containerRef} className="overflow-x-auto overflow-y-hidden" style={{ height: CHART_H }}>
      <svg width={totalW} height={CHART_H} className="select-none">
        <line x1={0} y1={AXIS_Y} x2={totalW} y2={AXIS_Y} stroke={RULE} strokeWidth={1.5} />

        {events.map((event, idx) => {
          const cx = CARD_GAP + idx * (CARD_W + CARD_GAP) + CARD_W / 2
          // Alternating above/below is what lets the cards be readable at all:
          // side by side at this width they would have to be a third as wide.
          const above = idx % 2 === 0
          const cardY = above ? AXIS_Y - 160 : AXIS_Y + 32
          const stemY1 = above ? AXIS_Y - 8 : AXIS_Y + 8
          const stemY2 = above ? cardY + CARD_H : cardY
          const isSelected = selectedId === event.id
          const time = formatEventTime(event.time)

          return (
            <g key={event.id}>
              <line x1={cx} y1={stemY1} x2={cx} y2={stemY2} stroke={RULE} strokeWidth={1} />
              <circle
                cx={cx}
                cy={AXIS_Y}
                r={4}
                fill="var(--color-accent)"
                stroke="var(--color-surface-base)"
                strokeWidth={1.5}
              />
              <foreignObject
                x={cx - CARD_W / 2}
                y={cardY}
                width={CARD_W}
                height={CARD_H}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(event)}
              >
                <div
                  ref={el => {
                    if (el) cardRefs.current.set(event.id, el)
                    else cardRefs.current.delete(event.id)
                  }}
                  className={`flex flex-col gap-1.5 rounded-lg border p-2.5 shadow-sm ${
                    isSelected
                      ? 'border-accent bg-accent/10'
                      : 'border-accent/10 bg-surface-overlay/40 hover:border-accent/60'
                  }`}
                  style={{
                    height: CARD_H,
                    overflow: 'hidden',
                    opacity: 0,
                    transition: 'opacity 0.7s ease, background-color 150ms, border-color 150ms',
                  }}
                >
                  <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-ink">
                    {event.title || <span className="italic text-ink-faint">Untitled</span>}
                  </p>
                  {event.date && (
                    <p className="truncate text-[10px] text-ink-faint">
                      {event.date}
                      {time && ` · ${time}`}
                    </p>
                  )}
                  {event.location && (
                    <p className="flex items-center gap-0.5 truncate text-[10px] text-ink-faint">
                      <LuMapPin size={10} className="shrink-0" />
                      {event.location}
                    </p>
                  )}
                </div>
              </foreignObject>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** The chart's own shape while it loads, rather than a line of text: a wait
 *  that already looks like the answer is a shorter wait than one that reflows
 *  into it. Same reasoning as OutlineBoardSkeleton. */
export function TimelineChartSkeleton({ count = 6 }: { count?: number }) {
  const totalW = count * (CARD_W + CARD_GAP) + CARD_GAP
  return (
    <div className="overflow-x-auto" style={{ height: CHART_H }}>
      <svg width={totalW} height={CHART_H} className="select-none">
        <line x1={0} y1={AXIS_Y} x2={totalW} y2={AXIS_Y} stroke={RULE} strokeWidth={1.5} />
        {[...Array(count)].map((_, idx) => {
          const cx = CARD_GAP + idx * (CARD_W + CARD_GAP) + CARD_W / 2
          const above = idx % 2 === 0
          const cardY = above ? AXIS_Y - 160 : AXIS_Y + 32
          const stemY1 = above ? AXIS_Y - 8 : AXIS_Y + 8
          const stemY2 = above ? cardY + CARD_H : cardY
          return (
            <g key={idx}>
              <line x1={cx} y1={stemY1} x2={cx} y2={stemY2} stroke={RULE} strokeWidth={1} />
              <circle cx={cx} cy={AXIS_Y} r={4} fill={RULE} strokeWidth={1.5} />
              <foreignObject x={cx - CARD_W / 2} y={cardY} width={CARD_W} height={CARD_H}>
                <div className="flex h-full animate-pulse flex-col gap-2 rounded-lg border border-accent/10 bg-surface-overlay/40 p-2.5">
                  <div className="h-2.5 w-full rounded bg-surface-muted" />
                  <div className="h-2.5 w-3/4 rounded bg-surface-muted" />
                </div>
              </foreignObject>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
