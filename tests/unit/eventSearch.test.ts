import {
  formatEventTime,
  formatEventWhen,
  matchesQuery,
  parseEventDate,
  parseEventTime,
  sortEvents,
  type WriterEvent,
} from '@/lib/eventSearch'

const ev = (over: Partial<WriterEvent> = {}): WriterEvent => ({
  id: 'we-1',
  title: 'An event',
  date: 'Saturday, January 2nd, 1943',
  time: '20:00',
  description: '',
  characters: [],
  location: null,
  ...over,
})

describe('parseEventDate', () => {
  it('reads the format WriteAI actually stores', () => {
    // Verified against all 144 events on 2026-07-31.
    expect(parseEventDate('Saturday, January 2nd, 1943')).toBe(19430102)
    expect(parseEventDate('Thursday, November 12th, 2009')).toBe(20091112)
    expect(parseEventDate('Monday, July 9th, 1951')).toBe(19510709)
  })

  it('handles every ordinal suffix', () => {
    expect(parseEventDate('Monday, May 1st, 2010')).toBe(20100501)
    expect(parseEventDate('Monday, May 2nd, 2010')).toBe(20100502)
    expect(parseEventDate('Monday, May 3rd, 2010')).toBe(20100503)
    expect(parseEventDate('Monday, May 4th, 2010')).toBe(20100504)
  })

  it('does not need the weekday prefix', () => {
    expect(parseEventDate('January 2nd, 1943')).toBe(19430102)
  })

  it('orders correctly across centuries', () => {
    // The series spans 1943 to 2010, so this is not hypothetical.
    expect(parseEventDate('Saturday, January 2nd, 1943')!).toBeLessThan(
      parseEventDate('Monday, May 10th, 2010')!,
    )
  })

  it('returns null for missing or unreadable dates', () => {
    expect(parseEventDate(null)).toBeNull()
    expect(parseEventDate('')).toBeNull()
    expect(parseEventDate('sometime in the war')).toBeNull()
    expect(parseEventDate('Smarch 4th, 2010')).toBeNull()
    expect(parseEventDate('Monday, May 47th, 2010')).toBeNull()
  })
})

describe('parseEventTime', () => {
  it('reads the stored 24-hour form', () => {
    expect(parseEventTime('20:00')).toBe(20 * 60)
    expect(parseEventTime('00:00')).toBe(0)
    expect(parseEventTime('7:05')).toBe(7 * 60 + 5)
  })

  it('tolerates a 12-hour form defensively', () => {
    expect(parseEventTime('7:00 PM')).toBe(19 * 60)
    expect(parseEventTime('12:00 AM')).toBe(0)
    expect(parseEventTime('12:00 PM')).toBe(12 * 60)
  })

  it('returns null for missing or nonsense times', () => {
    expect(parseEventTime(null)).toBeNull()
    expect(parseEventTime('evening')).toBeNull()
    expect(parseEventTime('25:00')).toBeNull()
    expect(parseEventTime('10:75')).toBeNull()
  })
})

describe('formatEventTime / formatEventWhen', () => {
  it('shows stored 24-hour times as 12-hour', () => {
    expect(formatEventTime('20:00')).toBe('8:00 PM')
    expect(formatEventTime('00:30')).toBe('12:30 AM')
    expect(formatEventTime('12:00')).toBe('12:00 PM')
    expect(formatEventTime('09:05')).toBe('9:05 AM')
  })

  it('omits the separator when there is no time', () => {
    // 71 of 144 events have no time — a dangling "·" would be the common case.
    expect(formatEventWhen({ date: 'Thursday, November 12th, 2009', time: null })).toBe(
      'Thursday, November 12th, 2009',
    )
    expect(formatEventWhen({ date: 'Thursday, November 12th, 2009', time: '19:00' })).toBe(
      'Thursday, November 12th, 2009 · 7:00 PM',
    )
    expect(formatEventWhen({ date: null, time: null })).toBe('')
  })
})

describe('matchesQuery', () => {
  const emma = ev({ title: 'Emma has a miscarriage', characters: ['Emma', 'Jared Gatlin'] })

  it('matches on title', () => {
    expect(matchesQuery(emma, 'miscarriage')).toBe(true)
  })

  it('matches on a character name — the point of widening past title', () => {
    expect(matchesQuery(ev({ title: 'A party', characters: ['Noah Gatlin'] }), 'noah')).toBe(true)
  })

  it('is case-insensitive and matches substrings', () => {
    expect(matchesQuery(emma, 'EMMA')).toBe(true)
    expect(matchesQuery(emma, 'carriage')).toBe(true)
  })

  it('narrows with multiple terms rather than widening', () => {
    expect(matchesQuery(emma, 'emma jared')).toBe(true)
    expect(matchesQuery(emma, 'emma quinn')).toBe(false)
  })

  it('does NOT match description or location', () => {
    // Neither is shown in the row, so a hit there looks arbitrary.
    const e = ev({ title: 'A quiet scene', description: 'at the hospital', location: 'Hospital' })
    expect(matchesQuery(e, 'hospital')).toBe(false)
  })

  it('treats an empty query as matching everything', () => {
    expect(matchesQuery(emma, '')).toBe(true)
    expect(matchesQuery(emma, '   ')).toBe(true)
  })
})

describe('sortEvents', () => {
  const a = ev({ id: 'a', title: 'A', date: 'Monday, May 10th, 2010', time: '09:00' })
  const b = ev({ id: 'b', title: 'B', date: 'Monday, May 10th, 2010', time: '20:00' })
  const c = ev({ id: 'c', title: 'C', date: 'Saturday, January 2nd, 1943', time: null })
  const undated = ev({ id: 'u', title: 'U', date: null, time: null })

  it('orders by date then time ascending', () => {
    expect(sortEvents([b, a, c], 'asc').map(e => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('reverses on descending', () => {
    expect(sortEvents([a, c, b], 'desc').map(e => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('keeps undated events last in BOTH directions', () => {
    // An undated event is unplaced, not oldest. Flipping it to the front when
    // the arrow is clicked reads as a bug.
    expect(sortEvents([undated, a, c], 'asc').map(e => e.id)).toEqual(['c', 'a', 'u'])
    expect(sortEvents([undated, a, c], 'desc').map(e => e.id)).toEqual(['a', 'c', 'u'])
  })

  it('puts an untimed event before timed ones on the same day', () => {
    const untimed = ev({ id: 'x', title: 'X', date: 'Monday, May 10th, 2010', time: null })
    expect(sortEvents([b, untimed, a], 'asc').map(e => e.id)).toEqual(['x', 'a', 'b'])
  })

  it('breaks ties on title so the order is stable', () => {
    const p = ev({ id: 'p', title: 'Zebra', date: 'Monday, May 10th, 2010', time: '09:00' })
    const q = ev({ id: 'q', title: 'Apple', date: 'Monday, May 10th, 2010', time: '09:00' })
    expect(sortEvents([p, q], 'asc').map(e => e.id)).toEqual(['q', 'p'])
    expect(sortEvents([q, p], 'asc').map(e => e.id)).toEqual(['q', 'p'])
  })

  it('does not mutate its input', () => {
    const input = [b, a, c]
    sortEvents(input, 'asc')
    expect(input.map(e => e.id)).toEqual(['b', 'a', 'c'])
  })
})
