// Story dates (LOOM-97).
//
// The outline's `date` is a STORY date — "Saturday, October 31st" — not a
// calendar date. It carries no year by design: the manuscript's date lines
// don't, and `chapter_timeline` parses them on that assumption. So this is a
// string format with a calendar as an input method, not a Date.
//
// Ported from WriteAI's StoryDatePicker so both apps write the same shape. A
// date Loom formats differently is a date WriteAI's chronology resolver stops
// recognising.

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ordinal(n: number): string {
  const v = n % 100
  const s = ['th', 'st', 'nd', 'rd']
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/**
 * "Saturday, October 31st", with the year appended only when there is one.
 *
 * The weekday is computed from a real calendar, which needs SOME year — 2001
 * when the story does not supply one, matching WriteAI. That makes the weekday
 * arbitrary for a yearless date, which is fine: it is the writer's own label,
 * and consistency between the two apps matters more than astronomy.
 */
export function formatStoryDate(year: number | null, month: number, day: number): string {
  const dow = DOW_FULL[new Date(year ?? 2001, month, day).getDay()]
  const base = `${dow}, ${MONTHS[month]} ${ordinal(day)}`
  return year ? `${base}, ${year}` : base
}

/**
 * Do two story dates name the same day?
 *
 * Compares month/day/year and IGNORES the weekday, which is the whole point.
 * The manuscript's date lines carry weekdays from the story's own internal
 * calendar — "Friday, December 4th" — while `formatStoryDate` can only derive
 * one from a real calendar, and for a yearless date that calendar is an
 * arbitrary 2001. Re-picking the day already stored would therefore rewrite
 * "Friday" to "Tuesday" and quietly contradict the prose.
 *
 * So the picker asks this first, and saves nothing when the answer is yes.
 * Same shape of guard as the summary editor's: a control that was opened but
 * not used must not write.
 */
export function isSameStoryDay(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseStoryDate(a)
  const y = parseStoryDate(b)
  if (x.month === null || y.month === null) return false
  return x.month === y.month && x.day === y.day && x.year === y.year
}

/** Pull month/day/year back out of a stored string, for seeding the picker. */
export function parseStoryDate(s: string | null | undefined): {
  year: number | null
  month: number | null
  day: number | null
} {
  const empty = { year: null, month: null, day: null }
  if (!s?.trim()) return empty

  const cleaned = s.replace(/(\d+)(st|nd|rd|th)/gi, '$1')
  const monthIndex = (name: string) =>
    MONTHS.findIndex(m => m.toLowerCase() === name.toLowerCase())

  // "Saturday, October 31" / "Saturday, October 31, 2024"
  const withDow = cleaned.match(/^(\w+),\s+(\w+)\s+(\d+)(?:,\s+(\d{4}))?$/)
  if (withDow) {
    const month = monthIndex(withDow[2])
    return month < 0
      ? empty
      : { month, day: parseInt(withDow[3], 10), year: withDow[4] ? parseInt(withDow[4], 10) : null }
  }

  // "October 31" / "October 31, 2024"
  const withoutDow = cleaned.match(/^(\w+)\s+(\d+)(?:,\s+(\d{4}))?$/)
  if (withoutDow) {
    const month = monthIndex(withoutDow[1])
    return month < 0
      ? empty
      : { month, day: parseInt(withoutDow[2], 10), year: withoutDow[3] ? parseInt(withoutDow[3], 10) : null }
  }

  return empty
}

/**
 * Ten fixed chip colours, chosen by a hash of the name.
 *
 * Stable rather than assigned in order: a character keeps their colour when a
 * chapter is inserted, deleted, or reordered, which is the entire point —
 * colours that shuffle on edit are worse than no colours.
 */
const POV_COLORS = [
  'bg-violet-500/15 text-violet-400',
  'bg-blue-500/15 text-blue-400',
  'bg-emerald-500/15 text-emerald-400',
  'bg-amber-500/15 text-amber-400',
  'bg-rose-500/15 text-rose-400',
  'bg-cyan-500/15 text-cyan-400',
  'bg-orange-500/15 text-orange-400',
  'bg-pink-500/15 text-pink-400',
  'bg-teal-500/15 text-teal-400',
  'bg-indigo-500/15 text-indigo-400',
]

export function povColorClass(pov: string): string {
  let hash = 0
  for (let i = 0; i < pov.length; i++) {
    hash = (hash * 31 + pov.charCodeAt(i)) % POV_COLORS.length
  }
  return POV_COLORS[Math.abs(hash)]
}
