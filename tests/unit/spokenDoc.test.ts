import { Schema, type Node as PMNode } from '@tiptap/pm/model'
import { buildSpokenDoc, wordRangeAt } from '@/lib/narration/spokenDoc'

// Minimal stand-in for the chapter editor's schema: paragraphs, text, an
// inline mark (marks split text nodes, which is what makes the position map
// non-trivial), and a leaf block for the section-break case.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    horizontalRule: { group: 'block', toDOM: () => ['hr'] },
    text: { group: 'inline' },
  },
  marks: {
    em: { toDOM: () => ['em', 0] },
  },
})

const p = (...inline: unknown[]) => schema.node('paragraph', null, inline as never)
const t = (s: string) => schema.text(s)
const em = (s: string) => schema.text(s, [schema.mark('em')])
const doc = (...blocks: unknown[]) => schema.node('doc', null, blocks as never)

/** The whole document, the way Alt-Shift-R reads from an empty selection. */
const whole = (d: PMNode, state: Record<string, unknown> = {}) =>
  buildSpokenDoc(d, 0, d.content.size, state)

/** Resolve a word by its index in the spoken string, as boundary events do. */
const nthWordRange = (spoken: ReturnType<typeof whole>, word: string) => {
  const idx = spoken.text.indexOf(word)
  expect(idx).toBeGreaterThanOrEqual(0)
  return wordRangeAt(spoken, idx, word.length)
}

describe('buildSpokenDoc — position mapping', () => {
  it('maps every character of a plain paragraph back to its own position', () => {
    const d = doc(p(t('The rain fell.')))
    const spoken = whole(d)
    expect(spoken.text).toBe('The rain fell.')
    // Paragraph content starts at position 1 (0 is before the paragraph).
    expect(spoken.startPos[0]).toBe(1)
    expect(spoken.endPos[0]).toBe(2)
    // Each character advances by exactly one document position.
    for (let i = 0; i < spoken.text.length; i++) {
      expect(spoken.startPos[i]).toBe(1 + i)
    }
  })

  it('separates paragraphs so the boundary stream does not merge words', () => {
    const d = doc(p(t('one two')), p(t('three four')))
    const spoken = whole(d)
    // Without the separator "two" and "three" would speak as one token and
    // every later word would highlight one position early.
    expect(spoken.text).toBe('one two three four')

    const three = nthWordRange(spoken, 'three')
    expect(d.textBetween(three!.from, three!.to)).toBe('three')
    const four = nthWordRange(spoken, 'four')
    expect(d.textBetween(four!.from, four!.to)).toBe('four')
  })

  it('resolves a word that straddles a mark boundary to one range', () => {
    // "glass." is two text nodes: <em>glass</em> then ".".
    const d = doc(p(t('the '), em('glass'), t('. done')))
    const spoken = whole(d)
    expect(spoken.text).toBe('the glass. done')

    const range = nthWordRange(spoken, 'glass.')
    expect(d.textBetween(range!.from, range!.to)).toBe('glass.')
  })

  it('treats a section break as a word boundary', () => {
    const d = doc(p(t('before')), schema.node('horizontalRule'), p(t('after')))
    const spoken = whole(d)
    expect(spoken.text).toBe('before after')
    const after = nthWordRange(spoken, 'after')
    expect(d.textBetween(after!.from, after!.to)).toBe('after')
  })
})

describe('buildSpokenDoc — variable templates', () => {
  it('speaks the resolved value but highlights the whole template source', () => {
    const d = doc(p(t('Hello {{name}}, welcome.')))
    const spoken = whole(d, { name: 'Marisa' })
    expect(spoken.text).toBe('Hello Marisa, welcome.')

    // The substituted word maps onto the `{{name}}` source range...
    const name = nthWordRange(spoken, 'Marisa,')
    expect(d.textBetween(name!.from, name!.to)).toBe('{{name}},')

    // ...and, crucially, text AFTER the template does not drift. "{{name}}"
    // is 8 chars, "Marisa" is 6: a naive offset would land 2 characters off.
    const welcome = nthWordRange(spoken, 'welcome.')
    expect(d.textBetween(welcome!.from, welcome!.to)).toBe('welcome.')
  })

  it('does not drift when the replacement is longer than the source', () => {
    const d = doc(p(t('A {{x}} B')))
    const spoken = whole(d, { x: 'muchlongervalue' })
    expect(spoken.text).toBe('A muchlongervalue B')
    const b = nthWordRange(spoken, 'B')
    expect(d.textBetween(b!.from, b!.to)).toBe('B')
  })

  it('resolves a conditional to the same branch the export takes', () => {
    const d = doc(p(t("She {{brave ? 'stayed' : 'ran'}} home")))
    const spoken = whole(d, { brave: true })
    expect(spoken.text).toBe('She stayed home')
    const home = nthWordRange(spoken, 'home')
    expect(d.textBetween(home!.from, home!.to)).toBe('home')
  })

  it('speaks an unresolvable template literally without breaking the map', () => {
    const d = doc(p(t('X {{unknown}} Y')))
    const spoken = whole(d, {})
    expect(spoken.text).toBe('X {{unknown}} Y')
    const y = nthWordRange(spoken, 'Y')
    expect(d.textBetween(y!.from, y!.to)).toBe('Y')
  })
})

describe('wordRangeAt', () => {
  const d = doc(p(t('alpha beta gamma')))
  const spoken = whole(d)

  it('derives the word end itself when charLength is absent', () => {
    const idx = spoken.text.indexOf('beta')
    const range = wordRangeAt(spoken, idx)
    expect(d.textBetween(range!.from, range!.to)).toBe('beta')
  })

  it('skips forward from a boundary that lands on whitespace', () => {
    const idx = spoken.text.indexOf(' beta')
    const range = wordRangeAt(spoken, idx)
    expect(d.textBetween(range!.from, range!.to)).toBe('beta')
  })

  it('trims a charLength that sweeps in trailing whitespace', () => {
    const idx = spoken.text.indexOf('alpha')
    const range = wordRangeAt(spoken, idx, 'alpha '.length)
    expect(d.textBetween(range!.from, range!.to)).toBe('alpha')
  })

  it('returns null past the end rather than an out-of-range decoration', () => {
    expect(wordRangeAt(spoken, spoken.text.length)).toBeNull()
    expect(wordRangeAt(spoken, -1)).toBeNull()
  })

  it('never returns a range outside the document', () => {
    for (let i = 0; i < spoken.text.length; i++) {
      const r = wordRangeAt(spoken, i)
      if (!r) continue
      expect(r.from).toBeGreaterThanOrEqual(0)
      expect(r.to).toBeLessThanOrEqual(d.content.size)
      expect(r.to).toBeGreaterThan(r.from)
    }
  })
})
