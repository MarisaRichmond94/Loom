import {
  clampDropIndex,
  isPinnedChapter,
  nextChapterTitle,
  planChapterKindChange,
  renumberAfterDrag,
} from '@/lib/chapterNumbering'

// The title rules behind the outline board and the sidebar. The cases worth
// pinning are the ones that would quietly rename chapters nobody touched.

const t = (...titles: string[]) => titles.map(title => ({ title }))
const book = (...titles: string[]) => titles.map((title, i) => ({ id: `c${i}`, title, order: i + 1 }))

describe('renumberAfterDrag', () => {
  it('re-sequences "Chapter N" and leaves the Prologue alone', () => {
    const moved = t('Prologue', 'Chapter 3', 'Chapter 1', 'Chapter 2')
    expect(renumberAfterDrag(moved, 'Chapter 3').map(c => c.title)).toEqual([
      'Prologue', 'Chapter 1', 'Chapter 2', 'Chapter 3',
    ])
  })

  it('touches nothing when the moved chapter has no number', () => {
    const moved = t('Chapter 2', 'Prologue', 'Chapter 1')
    expect(renumberAfterDrag(moved, 'Prologue')).toBe(moved)
  })
})

describe('nextChapterTitle', () => {
  it('is one past the last numbered chapter before the insert point', () => {
    expect(nextChapterTitle(t('Chapter 1', 'Chapter 2', 'Chapter 3'), 2)).toBe('Chapter 3')
    expect(nextChapterTitle(t('Chapter 1', 'Chapter 2'), 2)).toBe('Chapter 3')
  })

  it('starts at 1 in an empty book and straight after the Prologue', () => {
    expect(nextChapterTitle([], 0)).toBe('Chapter 1')
    expect(nextChapterTitle(t('Prologue', 'Chapter 1'), 1)).toBe('Chapter 1')
  })

  it('counts past an Epilogue rather than through it', () => {
    expect(nextChapterTitle(t('Chapter 1', 'Chapter 2', 'Epilogue'), 2)).toBe('Chapter 3')
  })
})

describe('pinned ends', () => {
  const rows = t('Prologue', 'Chapter 1', 'Chapter 2', 'Epilogue')

  it('clamps a drop inside the Prologue and the Epilogue', () => {
    expect(clampDropIndex(rows, 0)).toBe(1)
    expect(clampDropIndex(rows, 3)).toBe(2)
    expect(clampDropIndex(rows, 2)).toBe(2)
  })

  it('leaves an unpinned book unclamped', () => {
    expect(clampDropIndex(t('Chapter 1', 'Chapter 2'), 0)).toBe(0)
    expect(clampDropIndex(t('Chapter 1', 'Chapter 2'), 1)).toBe(1)
  })

  it('pins only a Prologue that is first and an Epilogue that is last', () => {
    expect(isPinnedChapter(rows, 0)).toBe(true)
    expect(isPinnedChapter(rows, 3)).toBe(true)
    expect(isPinnedChapter(rows, 1)).toBe(false)
    // A chapter merely TITLED "Prologue" somewhere in the middle is not pinned.
    expect(isPinnedChapter(t('Chapter 1', 'Prologue', 'Chapter 2'), 1)).toBe(false)
  })
})

describe('planChapterKindChange', () => {
  it('turns Chapter 1 into the Prologue and closes the gap behind it', () => {
    const plan = planChapterKindChange(book('Chapter 1', 'Chapter 2', 'Chapter 3'), 'c0', 'prologue')
    expect(plan).toEqual({
      updates: [
        { id: 'c0', title: 'Prologue', numbered: false },
        { id: 'c1', title: 'Chapter 1' },
        { id: 'c2', title: 'Chapter 2' },
      ],
    })
  })

  it('turns the Prologue back into Chapter 1 and opens the gap again', () => {
    const plan = planChapterKindChange(book('Prologue', 'Chapter 1', 'Chapter 2'), 'c0', 'chapter')
    expect(plan).toEqual({
      updates: [
        { id: 'c0', title: 'Chapter 1', numbered: true },
        { id: 'c1', title: 'Chapter 2' },
        { id: 'c2', title: 'Chapter 3' },
      ],
    })
  })

  it('round-trips: prologue then back restores every title', () => {
    const start = book('Chapter 1', 'Chapter 2', 'Chapter 3')
    const there = planChapterKindChange(start, 'c0', 'prologue')
    if ('error' in there) throw new Error(there.error)
    const after = start.map(c => ({ ...c, ...there.updates.find(u => u.id === c.id) }))
    const back = planChapterKindChange(after, 'c0', 'chapter')
    if ('error' in back) throw new Error(back.error)
    const restored = after.map(c => ({ ...c, ...back.updates.find(u => u.id === c.id) }))
    expect(restored.map(c => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3'])
  })

  it('turns the last chapter into the Epilogue without renaming anything else', () => {
    const plan = planChapterKindChange(book('Prologue', 'Chapter 1', 'Chapter 2'), 'c2', 'epilogue')
    expect(plan).toEqual({ updates: [{ id: 'c2', title: 'Epilogue', numbered: false }] })
  })

  it('numbers an Epilogue turned back after the last numbered chapter', () => {
    const plan = planChapterKindChange(book('Prologue', 'Chapter 1', 'Chapter 2', 'Epilogue'), 'c3', 'chapter')
    expect(plan).toEqual({ updates: [{ id: 'c3', title: 'Chapter 3', numbered: true }] })
  })

  it('never shifts titles with a different prefix', () => {
    const plan = planChapterKindChange(book('Chapter 1', 'Bonus Chapter 1', 'Chapter 2'), 'c0', 'prologue')
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.updates.map(u => u.id)).toEqual(['c0', 'c2'])
  })

  it('refuses a request that no longer matches the book', () => {
    const rows = book('Chapter 1', 'Chapter 2', 'Chapter 3')
    expect(planChapterKindChange(rows, 'c1', 'prologue')).toHaveProperty('error')
    expect(planChapterKindChange(rows, 'c1', 'epilogue')).toHaveProperty('error')
    expect(planChapterKindChange(rows, 'c1', 'chapter')).toHaveProperty('error')
    expect(planChapterKindChange(rows, 'nope', 'prologue')).toHaveProperty('error')
    expect(planChapterKindChange(book('Prologue', 'Chapter 1'), 'c0', 'prologue')).toHaveProperty('error')
  })

  it('plans from the database order, not array order', () => {
    const rows = [
      { id: 'b', title: 'Chapter 2', order: 2 },
      { id: 'a', title: 'Chapter 1', order: 1 },
    ]
    expect(planChapterKindChange(rows, 'a', 'prologue')).toEqual({
      updates: [
        { id: 'a', title: 'Prologue', numbered: false },
        { id: 'b', title: 'Chapter 1' },
      ],
    })
  })
})
