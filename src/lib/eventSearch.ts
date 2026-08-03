// Searching, sorting and formatting WriteAI writer-events for the dock's
// Events tab (LOOM-32 / LOOM-36).
//
// Pure on purpose: these are the parts worth testing, and they are the parts
// that depend on WriteAI's storage formats, which Loom does not control.
//
// Those formats, as of 2026-07-31 (144 events):
//   date — "Saturday, January 2nd, 1943". A display string with a weekday
//          prefix and an ordinal suffix. Every event currently has one, but
//          the field is nullable and the modal can clear it.
//   time — "20:00", 24-hour, no seconds. 71 of 144 have none. The UI shows
//          12-hour, so storage and display differ and both live here.

export type WriterEvent = {
  id: string
  title: string
  date: string | null
  time: string | null
  description: string
  characters: string[]
  location: string | null
  /** ISO timestamp of the last create/edit. Passed through unfiltered from
   *  WriteAI (server/routers/writer_events.py); optional here because older
   *  callers/tests construct events without it. */
  updated_at?: string
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/**
 * A comparable integer for a stored date, or null if it cannot be read.
 *
 * Returns yyyymmdd rather than a timestamp, and parses by hand rather than
 * handing the string to `new Date()`. Both deliberate: `Date` would drag in a
 * timezone for values that have none — an event dated 1943 is a story fact, not
 * an instant — and its parsing of "Saturday, January 2nd, 1943" is
 * implementation-defined, so it can silently differ between runtimes.
 */
export function parseEventDate(date: string | null | undefined): number | null {
  if (!date) return null
  // Drop the weekday prefix if present; it carries no ordering information.
  // Matched as "…day," rather than "everything before the first comma" —
  // there is a second comma before the year, so the looser rule ate the month.
  const withoutWeekday = date.replace(/^\s*[A-Za-z]+day,\s*/i, '')
  const m = withoutWeekday
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  const day = Number(m[2])
  if (day < 1 || day > 31) return null
  return Number(m[3]) * 10000 + (month + 1) * 100 + day
}

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

/** 1 → "1st", 12 → "12th", 23 → "23rd". */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

/**
 * A stored date → the value an <input type="date"> wants ("2009-11-16").
 * Empty string when there is no readable date, which is what the element
 * treats as blank.
 */
export function toDateInputValue(date: string | null | undefined): string {
  const n = parseEventDate(date)
  if (n === null) return ''
  const y = Math.floor(n / 10000)
  const m = Math.floor((n % 10000) / 100)
  return `${y}-${String(m).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`
}

/**
 * An <input type="date"> value → the display string WriteAI stores
 * ("Monday, November 16th, 2009").
 *
 * The weekday is DERIVED, not carried through: the picker only yields a
 * calendar date, and a stored weekday that disagrees with it would be a lie
 * that survives into WriteAI's timeline. Computed in UTC so a date never
 * shifts by one across a timezone boundary — these are story dates, not
 * instants, and "November 16th" must stay November 16th everywhere.
 */
export function fromDateInputValue(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const utc = new Date(Date.UTC(y, mo - 1, d))
  // Rejects impossible dates the regex lets through, e.g. 2010-02-31.
  if (utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null
  const monthName = MONTHS[mo - 1]
  return `${WEEKDAYS[utc.getUTCDay()]}, ${monthName[0].toUpperCase()}${monthName.slice(1)} ${ordinal(d)}, ${y}`
}

/** Minutes since midnight for a stored time, or null. Accepts the stored
 *  24-hour form and, defensively, a 12-hour one a future WriteAI might send. */
export function parseEventTime(time: string | null | undefined): number | null {
  if (!time) return null
  const m = time.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?$/i)
  if (!m) return null
  let hours = Number(m[1])
  const minutes = Number(m[2])
  if (minutes > 59) return null
  const meridiem = m[3]?.toLowerCase().replace(/\./g, '')
  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0
  if (hours > 23) return null
  return hours * 60 + minutes
}

/** "20:00" → "8:00 PM". Returns null when there is no readable time, so the
 *  caller can omit the separator rather than printing a dangling "·". */
export function formatEventTime(time: string | null | undefined): string | null {
  const minutes = parseEventTime(time)
  if (minutes === null) return null
  const h24 = Math.floor(minutes / 60)
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(minutes % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

/** The metadata line under an event's title: "November 12th, 2009 · 7:00 PM". */
export function formatEventWhen(event: Pick<WriterEvent, 'date' | 'time'>): string {
  const time = formatEventTime(event.time)
  if (!event.date) return time ?? ''
  return time ? `${event.date} · ${time}` : event.date
}

/**
 * Does this event match a search query?
 *
 * Title and character names only. Description, location and date are
 * deliberately excluded: the description is not shown in the row, so a hit
 * inside it reads as the list returning something arbitrary.
 *
 * Every whitespace-separated term must match somewhere, so "emma hospital"
 * narrows rather than widens — the behaviour people expect from a search box
 * even when they cannot say why.
 */
export function matchesQuery(
  event: WriterEvent,
  query: string,
  /** Resolves a stored `wc-` id to a display name (LOOM-45). Required, not
   *  optional: `characters` holds ids now, and searching them raw would mean
   *  typing a character's name silently matched nothing — a defect no type
   *  checker can see, because ids and names are both `string`. */
  nameOf: (id: string) => string,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${event.title} ${event.characters.map(nameOf).join(' ')}`.toLowerCase()
  return terms.every(term => haystack.includes(term))
}

/**
 * Chronological by in-story date, then time.
 *
 * Events with no date sort LAST in both directions rather than flipping to the
 * front when reversed. An undated event is not "the oldest" — it is unplaced,
 * and having it jump ends when the arrow is clicked reads as a bug. Same for a
 * dated event with no time: it precedes timed events on that day.
 *
 * Ties break on title so the order is total and the list never reshuffles
 * between renders.
 */
export function sortEvents<T extends WriterEvent>(events: T[], direction: 'asc' | 'desc'): T[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...events].sort((a, b) => {
    const da = parseEventDate(a.date)
    const db = parseEventDate(b.date)
    if (da === null && db === null) return a.title.localeCompare(b.title)
    if (da === null) return 1 // undated last, whichever way the arrow points
    if (db === null) return -1
    if (da !== db) return (da - db) * sign
    const ta = parseEventTime(a.time)
    const tb = parseEventTime(b.time)
    if (ta === null && tb === null) return a.title.localeCompare(b.title)
    if (ta === null) return -1 // untimed precedes timed within the same day
    if (tb === null) return 1
    if (ta !== tb) return (ta - tb) * sign
    return a.title.localeCompare(b.title)
  })
}
