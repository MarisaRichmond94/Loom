import { formatStoryDate, isSameStoryDay, parseStoryDate, povColorClass } from '@/lib/storyDate'

// Story dates cross the app boundary as STRINGS (LOOM-97).
//
// WriteAI's chronology resolver parses these date lines, and its own picker
// writes this exact shape. A date Loom formats differently is a date the
// resolver stops recognising — silently, since nothing validates the field.
// These tests pin the format against WriteAI's StoryDatePicker.

describe('formatStoryDate', () => {
  it('writes the yearless form the manuscript uses', () => {
    // 2001-10-31 was a Wednesday; the yearless form still needs a weekday, and
    // 2001 is the year WriteAI borrows for it.
    expect(formatStoryDate(null, 9, 31)).toBe('Wednesday, October 31st')
  })

  it('appends the year only when there is one', () => {
    expect(formatStoryDate(2024, 9, 31)).toBe('Thursday, October 31st, 2024')
  })

  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [31, '31st'],
  ])('ordinalises %i as %s', (day, suffix) => {
    expect(formatStoryDate(2024, 0, day)).toContain(`January ${suffix}`)
  })
})

describe('parseStoryDate', () => {
  it('reads back what the manuscript stores', () => {
    expect(parseStoryDate('Saturday, October 31st')).toEqual({ year: null, month: 9, day: 31 })
  })

  it('reads the form with a year', () => {
    expect(parseStoryDate('Thursday, October 31st, 2024')).toEqual({ year: 2024, month: 9, day: 31 })
  })

  it('reads a date with no weekday', () => {
    expect(parseStoryDate('October 31')).toEqual({ year: null, month: 9, day: 31 })
  })

  it.each([null, undefined, '', 'sometime later', 'Octobre 31'])('returns nothing for %p', input => {
    expect(parseStoryDate(input)).toEqual({ year: null, month: null, day: null })
  })
})

// Why isSameStoryDay exists, and why the picker cannot simply reformat.
//
// The manuscript's date lines carry weekdays from the STORY's calendar. A
// yearless date has no real calendar to derive one from, so formatStoryDate
// borrows 2001 — matching WriteAI, and wrong for the story. The round trip
// therefore preserves the DAY but not the WEEKDAY.
describe('the weekday hazard', () => {
  it('does not round-trip a manuscript weekday', () => {
    const stored = 'Friday, December 4th'
    const { year, month, day } = parseStoryDate(stored)
    // Reformatting silently relabels the day of the week.
    expect(formatStoryDate(year, month!, day!)).toBe('Tuesday, December 4th')
    expect(formatStoryDate(year, month!, day!)).not.toBe(stored)
  })

  it.each([
    ['Friday, December 4th', 'Tuesday, December 4th'],
    ['Saturday, October 31st', 'Wednesday, October 31st'],
    ['October 31', 'Wednesday, October 31st'],
  ])('treats %s and %s as the same day', (a, b) => {
    expect(isSameStoryDay(a, b)).toBe(true)
  })

  it.each([
    ['Friday, December 4th', 'Friday, December 5th'],
    ['Friday, December 4th', 'Friday, November 4th'],
    ['Friday, December 4th', 'Friday, December 4th, 2020'],
  ])('treats %s and %s as different days', (a, b) => {
    expect(isSameStoryDay(a, b)).toBe(false)
  })

  it.each([
    [null, 'Friday, December 4th'],
    ['Friday, December 4th', ''],
    ['nonsense', 'Friday, December 4th'],
  ])('is false when either side is not a date (%p, %p)', (a, b) => {
    expect(isSameStoryDay(a, b)).toBe(false)
  })
})

// The colour is a hash, not a position in the list, so a character keeps theirs
// when chapters are inserted, deleted or reordered. Colours that shuffle on
// every edit are worse than no colours at all.
describe('povColorClass', () => {
  it('is stable for a name', () => {
    expect(povColorClass('Jared Gatlin')).toBe(povColorClass('Jared Gatlin'))
  })

  it('gives different names different colours (usually)', () => {
    const names = ['Jared Gatlin', 'Noah Gatlin', 'Emma', 'Mina Choi', 'Joon Choi']
    expect(new Set(names.map(povColorClass)).size).toBeGreaterThan(1)
  })

  it('always returns a usable class pair', () => {
    for (const n of ['A', 'Jared Gatlin', 'x'.repeat(200), '한국어']) {
      expect(povColorClass(n)).toMatch(/^bg-\w+-500\/15 text-\w+-400$/)
    }
  })
})

// The year bug, found while fixing the weekday one in WriteAI (LOOM-97).
//
// The picker always formatted with its VIEW year, which is a real number even
// when the value it was editing had none. So picking a day on a yearless story
// date stamped it with the current real year — turning "Saturday, October 31st"
// into "Saturday, October 31st, 2026" and quietly giving the story a calendar
// it does not have. Both apps had it.
//
// The rule now: the existing value decides, an empty field falls back to the
// caller's convention, and typing in the year field overrides both.
describe('year handling follows the value, not the calendar view', () => {
  function includeYear(value: string, defaultIncludeYear: boolean, yearTouched = false) {
    return yearTouched || (value.trim() ? parseStoryDate(value).year !== null : defaultIncludeYear)
  }

  it('keeps a story date yearless when re-picking a day', () => {
    expect(includeYear('Saturday, October 31st', false)).toBe(false)
  })

  it('keeps a real date’s year', () => {
    // Writer-events are real dates on the real calendar; all 157 carry a year.
    expect(includeYear('Saturday, January 2nd, 1943', true)).toBe(true)
  })

  it('falls back to the caller only for an empty field', () => {
    expect(includeYear('', false)).toBe(false)
    expect(includeYear('', true)).toBe(true)
  })

  it('lets the writer add a year to a story date deliberately', () => {
    expect(includeYear('Saturday, October 31st', false, true)).toBe(true)
  })
})
