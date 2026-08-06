import { walkBook, defaultStoryState } from '@/lib/manuscript/walk'

// The canon walk must honour ContentBlock.condition.
//
// It did not: `loadManuscriptBook` dropped the field and `BlockIn` had no slot
// for it, so every gated block was included unconditionally. The reader has
// always honoured these gates, so the reader and the canon export disagreed
// about what canon is — and the export is what reaches ~/Writing and WriteAI.
//
// Pure fixtures: walkBook takes plain data, so none of this needs a database.

type Block = Parameters<typeof walkBook>[0][number]['blocks'][number]

const text = (id: string, order: number, body: string, condition?: string): Block => ({
  id, order, type: 'text', content: body, prompt: null, condition: condition ?? null,
  choices: [], overrides: [],
} as unknown as Block)

const choicePoint = (
  id: string, order: number, prompt: string,
  choices: Array<{ id: string; label: string; sets: Record<string, unknown> }>,
  condition?: string,
): Block => ({
  id, order, type: 'choice_point', content: null, prompt, condition: condition ?? null,
  choices: choices.map((c, i) => ({
    id: c.id, order: i + 1, label: c.label, setsVariables: JSON.stringify(c.sets),
    targetChapterId: null, endingMessage: null, isBadEnding: false, endsChapter: false,
  })),
  overrides: [],
} as unknown as Block)

const chapter = (id: string, order: number, blocks: Block[]) =>
  ({ id, title: `Chapter ${order}`, order, pov: null, date: null, condition: null, numbered: true, blocks })

const VARS = [
  { name: 'jaredKilled', type: 'boolean', defaultValue: 'true' },
  { name: 'noahShot', type: 'boolean', defaultValue: 'false' },
  { name: 'flagB', type: 'boolean', defaultValue: 'false' },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const walk = (chapters: any[]) => walkBook(chapters, VARS, defaultStoryState(VARS), {})

describe('walkBook honours block-level conditions', () => {
  it('skips a block whose condition does not match the story state', () => {
    const result = walk([chapter('c1', 1, [
      text('b1', 1, 'always here'),
      text('b2', 2, 'only when jaredKilled is false', JSON.stringify({ jaredKilled: false })),
    ])])
    expect(result.chapters[0].contents).toEqual(['always here'])
  })

  it('keeps a block whose condition matches', () => {
    const result = walk([chapter('c1', 1, [
      text('b1', 1, 'gated in', JSON.stringify({ jaredKilled: true })),
    ])])
    expect(result.chapters[0].contents).toEqual(['gated in'])
  })

  it('fails OPEN on an absent or unparseable condition, matching isChapterVisible', () => {
    // Dropping prose we cannot evaluate is worse than showing prose we should
    // have gated — the author can see the latter and never sees the former.
    const result = walk([chapter('c1', 1, [
      text('b1', 1, 'no condition'),
      text('b2', 2, 'broken condition', '{not json'),
    ])])
    expect(result.chapters[0].contents).toEqual(['no condition', 'broken condition'])
  })

  it('honours compound or-conditions rather than treating them as false', () => {
    // The Secrets We Keep ch10 gates a choice point on {op:'or', clauses:[…]}.
    // A naive equality check would silently evaluate this as false and drop it.
    const cond = JSON.stringify({ op: 'or', clauses: [
      { var: 'jaredKilled', value: true },
      { var: 'flagB', value: true },
    ] })
    const result = walk([chapter('c1', 1, [text('b1', 1, 'or matched', cond)])])
    expect(result.chapters[0].contents).toEqual(['or matched'])
  })

  it('gates a choice point out, so its branch never applies to canon state', () => {
    const result = walk([chapter('c1', 1, [
      choicePoint('cp', 1, 'gated away', [
        { id: 'yes', label: 'Yes', sets: { noahShot: true } },
      ], JSON.stringify({ jaredKilled: false })),
    ])])
    expect(result.choicePoints).toHaveLength(0)
  })

  // The regression that started this: Nobody's Hero ch24 asks whether JARED
  // pulls the trigger, then asks whether NOAH does — the second gated on the
  // first having gone the other way. Both fired, producing a canon in which
  // both of them shot the grandfather, and the contradiction leaked into ch30
  // prose through an or-condition six chapters later.
  it('evaluates a gate against state set by an EARLIER block in the same chapter', () => {
    const result = walk([chapter('c1', 1, [
      choicePoint('cp-jared', 1, 'Does Jared pull the trigger?', [
        { id: 'j-yes', label: 'Yes', sets: { jaredKilled: true } },
        { id: 'j-no', label: 'No', sets: { jaredKilled: false } },
      ]),
      choicePoint('cp-noah', 2, 'Does Noah pull the trigger?', [
        { id: 'n-yes', label: 'Yes', sets: { noahShot: true } },
      ], JSON.stringify({ jaredKilled: false })),
    ])])

    // Jared's point resolves to "Yes" (the "No" branch contradicts the
    // default), which sets jaredKilled=true and must close Noah's point.
    expect(result.choicePoints.map(p => p.choicePointId)).toEqual(['cp-jared'])
    expect(result.choicePoints[0].resolvedChoiceId).toBe('j-yes')
  })

  it('still gates correctly when the earlier choice opens the gate', () => {
    const result = walk([chapter('c1', 1, [
      choicePoint('cp-jared', 1, 'Does Jared pull the trigger?', [
        { id: 'j-no', label: 'No', sets: { jaredKilled: false } },
      ]),
      choicePoint('cp-noah', 2, 'Does Noah pull the trigger?', [
        { id: 'n-yes', label: 'Yes', sets: { noahShot: true } },
      ], JSON.stringify({ jaredKilled: false })),
    ])])
    expect(result.choicePoints.map(p => p.choicePointId)).toEqual(['cp-jared', 'cp-noah'])
  })
})
