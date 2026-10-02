import { generateHTML, generateJSON } from '@tiptap/html/server'
import StarterKit from '@tiptap/starter-kit'
import { CharacterMark } from '@/lib/extensions/character'
import { Footnote } from '@/lib/extensions/footnote'

// The character tag has to survive a round trip through HTML (LOOM-159).
//
// It did not. `renderHTML` wrote `data-character-id` / `data-character-name`,
// but neither attribute said where to READ itself from, so TipTap's default
// parser looked for plain `id` / `name` attributes and found nothing. The span
// still matched `span[data-character-id]`, so the mark was re-applied and the
// text still rendered as a character ref — accent-coloured, dotted-underlined
// — while carrying no identity at all.
//
// That phantom is invisible until someone hovers it and no card appears, which
// is the one symptom it has. Two of them reached the live database that way.
const EXT = [StarterKit, CharacterMark, Footnote]

const tagged = (id: string | null, name: string) => ({
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{
      type: 'text',
      text: 'Emma',
      marks: [{ type: 'character', attrs: { id, name } }],
    }],
  }],
})

/** The attrs of the single character mark in a parsed document. */
function markAttrs(html: string) {
  const json = generateJSON(html, EXT) as {
    content?: { content?: { marks?: { type: string; attrs?: Record<string, unknown> }[] }[] }[]
  }
  const marks = json.content?.[0]?.content?.[0]?.marks ?? []
  return marks.find(m => m.type === 'character')?.attrs
}

describe('CharacterMark', () => {
  it('writes both attributes into the rendered span', () => {
    const html = generateHTML(tagged('wc-3fbcbb44', 'Noah Gatlin'), EXT)
    expect(html).toContain('data-character-id="wc-3fbcbb44"')
    expect(html).toContain('data-character-name="Noah Gatlin"')
    expect(html).toContain('class="character-ref"')
  })

  // The regression. Before the fix this came back {id: null, name: ''} — the
  // mark survived, its identity did not.
  it('reads both attributes back out of that span', () => {
    const html = generateHTML(tagged('wc-3fbcbb44', 'Noah Gatlin'), EXT)
    expect(markAttrs(html)).toEqual({ id: 'wc-3fbcbb44', name: 'Noah Gatlin' })
  })

  it('survives repeated HTML round trips', () => {
    let html = generateHTML(tagged('wc-ce386752', 'Emma Mendoza'), EXT)
    for (let i = 0; i < 3; i++) html = generateHTML(generateJSON(html, EXT), EXT)
    expect(markAttrs(html)).toEqual({ id: 'wc-ce386752', name: 'Emma Mendoza' })
  })

  // The name is what the hover card falls back to when a mark predates ids, so
  // it has to round-trip on its own rather than only alongside an id.
  it('keeps the name when the mark has no id', () => {
    const html = generateHTML(tagged(null, 'Emma Mendoza'), EXT)
    expect(markAttrs(html)?.name).toBe('Emma Mendoza')
  })

  // Footnote already did this correctly, which is why footnotes kept working
  // on hover while character tags did not. Pinned so the two cannot drift back
  // apart.
  it('round-trips the way Footnote already did', () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: 'Emma',
          marks: [{ type: 'footnote', attrs: { content: 'Her real name.' } }],
        }],
      }],
    }
    const json = generateJSON(generateHTML(doc, EXT), EXT) as {
      content?: { content?: { marks?: { type: string; attrs?: Record<string, unknown> }[] }[] }[]
    }
    const marks = json.content?.[0]?.content?.[0]?.marks ?? []
    expect(marks.find(m => m.type === 'footnote')?.attrs).toEqual({ content: 'Her real name.' })
  })
})
