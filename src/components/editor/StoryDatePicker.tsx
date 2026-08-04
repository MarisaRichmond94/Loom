'use client'

import { useState } from 'react'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { DOW_SHORT, MONTHS, formatStoryDate, parseStoryDate } from '@/lib/storyDate'

// Calendar input for a STORY date (LOOM-97), ported from WriteAI.
//
// A calendar as an input method for a string, not a date control: the value it
// produces is "Saturday, October 31st", and the year is optional because the
// manuscript's date lines do not carry one. See src/lib/storyDate.ts.

export default function StoryDatePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const parsed = parseStoryDate(value)
  const today = new Date()

  const [viewMonth, setViewMonth] = useState(parsed.month ?? today.getMonth())
  const [viewYear, setViewYear] = useState(parsed.year ?? today.getFullYear())
  const [selected, setSelected] = useState<{ day: number; month: number; year: number | null } | null>(
    parsed.day != null && parsed.month != null
      ? { day: parsed.day, month: parsed.month, year: parsed.year }
      : null,
  )
  const [editingYear, setEditingYear] = useState(false)
  const [yearInput, setYearInput] = useState(String(viewYear))

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function step(by: 1 | -1) {
    const next = viewMonth + by
    if (next < 0) {
      setViewMonth(11)
      setViewYear(y => y - 1)
    } else if (next > 11) {
      setViewMonth(0)
      setViewYear(y => y + 1)
    } else {
      setViewMonth(next)
    }
  }

  function pick(day: number) {
    setSelected({ day, month: viewMonth, year: viewYear })
    onChange(formatStoryDate(viewYear, viewMonth, day))
  }

  const isSelected = (day: number) =>
    selected?.day === day && selected.month === viewMonth && selected.year === viewYear
  const isToday = (day: number) =>
    day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()

  return (
    <div className="w-56 select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => step(-1)}
          className="rounded p-0.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink-muted"
        >
          <LuChevronLeft size={14} />
        </button>

        <div className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
          <span>{MONTHS[viewMonth]}</span>
          {editingYear ? (
            <input
              autoFocus
              type="number"
              value={yearInput}
              onChange={e => setYearInput(e.target.value)}
              onBlur={() => {
                const y = parseInt(yearInput, 10)
                if (y > 0 && y < 10000) setViewYear(y)
                else setYearInput(String(viewYear))
                setEditingYear(false)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setYearInput(String(viewYear))
                  setEditingYear(false)
                }
              }}
              className="w-14 rounded border border-accent/40 bg-surface-overlay px-1 py-0.5 text-center text-[11px] text-ink focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setYearInput(String(viewYear))
                setEditingYear(true)
              }}
              title="Set a year — story dates usually have none"
              className="rounded px-1 py-0.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink"
            >
              {viewYear}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          className="rounded p-0.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink-muted"
        >
          <LuChevronRight size={14} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {DOW_SHORT.map(d => (
          <div key={d} className="py-0.5 text-center text-[9px] font-medium text-ink-faint/60">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => (
          <div key={i} className="flex items-center justify-center">
            {day ? (
              <button
                type="button"
                onClick={() => pick(day)}
                className={`h-6 w-6 rounded-full text-[11px] transition ${
                  isSelected(day)
                    ? 'bg-accent font-medium text-white'
                    : isToday(day)
                      ? 'border border-accent/40 font-medium text-accent hover:bg-accent/10'
                      : 'text-ink-muted hover:bg-surface-overlay'
                }`}
              >
                {day}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {selected && (
        <div className="mt-2 border-t border-accent/10 pt-2 text-center text-[11px] text-accent/80">
          {formatStoryDate(selected.year, selected.month, selected.day)}
        </div>
      )}
    </div>
  )
}
