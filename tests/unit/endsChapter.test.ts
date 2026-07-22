import { walkBook, defaultStoryState, type ChapterInWalk, type VariableIn } from '@/lib/manuscript/walk'
import { narrationSegments, type NarrationBlock } from '@/lib/narration/text'

// The "end of chapter early" feature: a Choice or a ConditionalOverride can be
// flagged `endsChapter`, which cleanly closes the chapter — every block after
// the marker is dropped — while the reader continues into the next chapter
// (unlike a bad ending, which is a dead end). These tests pin the two surfaces
// that must agree on that truncation: the canon/export walk (walkBook, which
// backs both the interactive export and the ⌥⇧E autosave) and narration.

// --- fixture builders -------------------------------------------------------

function v(name: string, type: string, def: unknown): VariableIn {
  return { name, type, defaultValue: JSON.stringify(def) }
}

type Block = ChapterInWalk['blocks'][number]

function textBlock(id: string, order: number, content: string): Block {
  return { id, order, type: 'text', content, prompt: null, choices: [], overrides: [] }
}

function condBlock(
  id: string,
  order: number,
  overrides: Array<{ condition: Record<string, unknown>; content: string; endingMessage?: string | null; endsChapter?: boolean }>,
): Block {
  return {
    id, order, type: 'conditional_fragment', content: null, prompt: null, choices: [],
    overrides: overrides.map((o, i) => ({
      id: `${id}-o${i}`, order: i, condition: JSON.stringify(o.condition), content: o.content,
      endingMessage: o.endingMessage ?? null, endsChapter: o.endsChapter ?? false,
    })),
  }
}

function choiceBlock(
  id: string,
  order: number,
  choices: Array<{ id: string; label?: string; sets?: Record<string, unknown>; target?: string | null; endingMessage?: string | null; isBadEnding?: boolean; endsChapter?: boolean }>,
): Block {
  return {
    id, order, type: 'choice_point', content: null, prompt: 'Pick', overrides: [],
    choices: choices.map(c => ({
      id: c.id, label: c.label ?? c.id, setsVariables: JSON.stringify(c.sets ?? {}),
      targetChapterId: c.target ?? null, endingMessage: c.endingMessage ?? null,
      isBadEnding: c.isBadEnding ?? false, endsChapter: c.endsChapter ?? false,
    })),
  }
}

function chapter(id: string, order: number, blocks: Block[], opts: { numbered?: boolean; condition?: string | null } = {}): ChapterInWalk {
  return { id, title: id, order, pov: null, date: null, condition: opts.condition ?? null, numbered: opts.numbered ?? true, blocks }
}

// Canon walk: every variable at its default, no explicit choice overrides.
function canon(chapters: ChapterInWalk[], variables: VariableIn[] = [], overrides: Record<string, string> = {}) {
  return walkBook(chapters, variables, defaultStoryState(variables), overrides)
}

// --- canon / export walk ----------------------------------------------------

describe('walkBook — conditional override endsChapter', () => {
  // The motivating example: didJaredShootNoah defaults true, a conditional that
  // fires under that context is the real end of the chapter, so the export must
  // not keep walking the (now-unreachable) trailing blocks.
  it('stops the chapter after a matched endsChapter override and drops trailing blocks', () => {
    const vars = [v('didJaredShootNoah', 'boolean', true)]
    const ch1 = chapter('c1', 0, [
      textBlock('t1', 0, 'Intro'),
      condBlock('cf1', 1, [{ condition: { didJaredShootNoah: true }, content: 'Noah is shot.', endsChapter: true }]),
      textBlock('t2', 2, 'Aftermath that only exists if Noah lived'),
      choiceBlock('cp1', 3, [{ id: 'a' }, { id: 'b' }]),
    ])
    const ch2 = chapter('c2', 1, [textBlock('t3', 0, 'Chapter two')])

    const res = canon([ch1, ch2], vars)

    // Chapter one ends at the conditional; the trailing text + choice vanish.
    expect(res.chapters[0].contents).toEqual(['Intro', 'Noah is shot.'])
    // The choice point after the marker never surfaces in the plan.
    expect(res.choicePoints).toHaveLength(0)
    // The walk is chapter-scoped, not walk-scoped: chapter two still renders.
    expect(res.chapters.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(res.chapters[1].contents).toEqual(['Chapter two'])
    // A clean end is not a warning-worthy event (unlike a skipped bad ending).
    expect(res.warnings).toEqual([])
  })

  it('does NOT truncate when the endsChapter override does not match the canon state', () => {
    // Same structure, but the default flips so the override never fires.
    const vars = [v('didJaredShootNoah', 'boolean', false)]
    const ch1 = chapter('c1', 0, [
      textBlock('t1', 0, 'Intro'),
      condBlock('cf1', 1, [{ condition: { didJaredShootNoah: true }, content: 'Noah is shot.', endsChapter: true }]),
      textBlock('t2', 2, 'Aftermath'),
    ])
    const res = canon([ch1], vars)
    // Override skipped (no match) → trailing block renders, chapter runs full.
    expect(res.chapters[0].contents).toEqual(['Intro', 'Aftermath'])
  })

  it('drops every block after the marker, including a later conditional', () => {
    const vars = [v('x', 'boolean', true)]
    const ch1 = chapter('c1', 0, [
      condBlock('cf1', 0, [{ condition: { x: true }, content: 'End', endsChapter: true }]),
      condBlock('cf2', 1, [{ condition: {}, content: 'Always-on fragment, but after the end' }]),
      textBlock('t2', 2, 'trailing'),
    ])
    const res = canon([ch1], vars)
    expect(res.chapters[0].contents).toEqual(['End'])
  })

  it('a matched endsChapter override with empty content still truncates', () => {
    const vars = [v('x', 'boolean', true)]
    const ch1 = chapter('c1', 0, [
      textBlock('t1', 0, 'Intro'),
      condBlock('cf1', 1, [{ condition: { x: true }, content: '', endsChapter: true }]),
      textBlock('t2', 2, 'dropped'),
    ])
    const res = canon([ch1], vars)
    // Empty content isn't pushed, but the chapter still ends here.
    expect(res.chapters[0].contents).toEqual(['Intro'])
  })

  it('bad ending wins over endsChapter on the same override (skipped in canon, no truncation)', () => {
    // Both flags set: the override is a bad ending, which in canon is skipped
    // (bad endings are not canon) rather than treated as a clean chapter end.
    const vars = [v('x', 'boolean', true)]
    const ch1 = chapter('c1', 0, [
      textBlock('t1', 0, 'Intro'),
      condBlock('cf1', 1, [{ condition: { x: true }, content: 'death scene', endingMessage: 'You died', endsChapter: true }]),
      textBlock('t2', 2, 'canon continues'),
    ])
    const res = canon([ch1], vars)
    // Bad-ending content is skipped and the walk keeps going → t2 renders.
    expect(res.chapters[0].contents).toEqual(['Intro', 'canon continues'])
    expect(res.warnings.some(w => /triggers an ending/.test(w))).toBe(true)
  })
})

describe('walkBook — choice endsChapter', () => {
  it('ends the chapter after a resolved endsChapter branch and continues to the next chapter', () => {
    const ch1 = chapter('c1', 0, [
      textBlock('t1', 0, 'Before choice'),
      choiceBlock('cp1', 1, [{ id: 'a' }, { id: 'b', endsChapter: true }]),
      textBlock('t2', 2, 'After the choice — unreachable'),
    ])
    const ch2 = chapter('c2', 1, [textBlock('t3', 0, 'Chapter two')])
    // Force branch b via an explicit override to isolate endsChapter behavior.
    const res = canon([ch1, ch2], [], { cp1: 'b' })

    expect(res.chapters[0].contents).toEqual(['Before choice'])
    expect(res.chapters.map(c => c.id)).toEqual(['c1', 'c2'])
    expect(res.chapters[1].contents).toEqual(['Chapter two'])
  })

  it('renders the branch inline consequence before truncating', () => {
    const ch1 = chapter('c1', 0, [
      textBlock('t1', 0, 'Before'),
      choiceBlock('cp1', 1, [{ id: 'a' }, { id: 'b', endingMessage: 'The door closes.', endsChapter: true }]),
      textBlock('t2', 2, 'dropped'),
    ])
    const res = canon([ch1], [], { cp1: 'b' })
    expect(res.chapters[0].contents).toEqual(['Before', 'The door closes.'])
  })

  it('a targetChapterId jump takes precedence over endsChapter (goes to the target, not the next chapter)', () => {
    const ch1 = chapter('c1', 0, [
      choiceBlock('cp1', 0, [{ id: 'a' }, { id: 'b', endsChapter: true, target: 'c3' }]),
    ])
    const ch2 = chapter('c2', 1, [textBlock('t2', 0, 'skipped middle chapter')])
    const ch3 = chapter('c3', 2, [textBlock('t3', 0, 'jump target')])
    const res = canon([ch1, ch2, ch3], [], { cp1: 'b' })
    // Jumps straight to c3; c2 is never walked.
    expect(res.chapters.map(c => c.id)).toEqual(['c1', 'c3'])
  })

  it('bad ending wins over endsChapter on a choice (whole walk stops)', () => {
    const ch1 = chapter('c1', 0, [
      choiceBlock('cp1', 0, [{ id: 'a' }, { id: 'b', isBadEnding: true, endsChapter: true, endingMessage: 'Dead.' }]),
    ])
    const ch2 = chapter('c2', 1, [textBlock('t2', 0, 'never reached')])
    const res = canon([ch1, ch2], [], { cp1: 'b' })
    // isBadEnding halts the entire manuscript, so chapter two is not walked.
    expect(res.chapters.map(c => c.id)).toEqual(['c1'])
    expect(res.warnings.some(w => /bad ending/.test(w))).toBe(true)
  })

  it('resolves endsChapter through canon auto-resolution (no explicit override)', () => {
    // x defaults true. Branch a agrees with the default (canon), branch b
    // contradicts it — so the walk auto-picks a, which ends the chapter.
    const vars = [v('x', 'boolean', true)]
    const ch1 = chapter('c1', 0, [
      choiceBlock('cp1', 0, [
        { id: 'a', sets: { x: true }, endsChapter: true },
        { id: 'b', sets: { x: false } },
      ]),
      textBlock('t2', 1, 'dropped'),
    ])
    const ch2 = chapter('c2', 1, [textBlock('t3', 0, 'chapter two')])
    const res = canon([ch1, ch2], vars)
    expect(res.choicePoints[0].resolvedChoiceId).toBe('a')
    expect(res.choicePoints[0].ambiguous).toBe(false)
    expect(res.chapters[0].contents).toEqual([])
    expect(res.chapters.map(c => c.id)).toEqual(['c1', 'c2'])
  })
})

// --- narration --------------------------------------------------------------

function doc(text: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
}

describe('narrationSegments — endsChapter truncation', () => {
  it('stops narration after a matched endsChapter override', () => {
    const blocks: NarrationBlock[] = [
      { id: 't1', type: 'text', order: 0, content: doc('Intro') },
      { id: 'cf1', type: 'conditional_fragment', order: 1, overrides: [
        { id: 'o1', order: 0, condition: JSON.stringify({ x: true }), content: doc('Ends here'), endingMessage: null, endsChapter: true },
      ] },
      { id: 't2', type: 'text', order: 2, content: doc('Dropped') },
    ]
    const text = narrationSegments(blocks, { x: true }).segments.map(s => s.text).join(' ')
    expect(text).toContain('Intro')
    expect(text).toContain('Ends here')
    expect(text).not.toContain('Dropped')
  })

  it('stops narration after an answered endsChapter choice, keeping its inline prose', () => {
    const blocks: NarrationBlock[] = [
      { id: 't1', type: 'text', order: 0, content: doc('Before') },
      { id: 'cp1', type: 'choice_point', order: 1, choices: [
        { id: 'a', endingMessage: doc('Chose A'), isBadEnding: false, endsChapter: true },
      ] },
      { id: 't2', type: 'text', order: 2, content: doc('After dropped') },
    ]
    const text = narrationSegments(blocks, {}, { cp1: 'a' }).segments.map(s => s.text).join(' ')
    expect(text).toContain('Before')
    expect(text).toContain('Chose A')
    expect(text).not.toContain('After dropped')
  })

  it('does not truncate when endsChapter is absent', () => {
    const blocks: NarrationBlock[] = [
      { id: 't1', type: 'text', order: 0, content: doc('Intro') },
      { id: 'cf1', type: 'conditional_fragment', order: 1, overrides: [
        { id: 'o1', order: 0, condition: JSON.stringify({ x: true }), content: doc('Middle'), endingMessage: null, endsChapter: false },
      ] },
      { id: 't2', type: 'text', order: 2, content: doc('Ending') },
    ]
    const text = narrationSegments(blocks, { x: true }).segments.map(s => s.text).join(' ')
    expect(text).toContain('Ending')
  })
})
