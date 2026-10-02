import { Mark, mergeAttributes } from '@tiptap/core'

export const CharacterMark = Mark.create({
  name: 'character',

  addAttributes() {
    return {
      // Both attributes have to say where to READ themselves from, not just
      // where to write themselves to (LOOM-159).
      //
      // `renderHTML` emits `data-character-id` / `data-character-name`, but
      // TipTap's default parser looks for an HTML attribute matching the
      // attribute's own name — `id` and `name`. So a mark survived JSON
      // round-trips and died on HTML ones: paste prose containing a tag, or
      // re-import it, and the span still matched `span[data-character-id]`
      // (so the mark was re-applied, and still rendered as a character ref)
      // while both attributes came back as their defaults.
      //
      // The result is a phantom tag: accent-coloured, dotted-underlined, and
      // attached to nobody. It cannot ever produce a hover card, because
      // there is no longer anything in it to look a character up by.
      //
      // Footnote has had this since it was written, which is exactly why
      // footnotes kept working on hover while character tags did not.
      id: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-character-id'),
      },
      name: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-character-name') ?? '',
      },
    }
  },

  parseHTML() {
    // Two rules, because a tag can legitimately arrive with only one of the
    // two attributes. `mergeAttributes` omits a null id, so a name-only mark —
    // the shape that predates ids, and the shape the hover card's name
    // fallback exists to serve — rendered a span that the id-only rule did not
    // match, and the mark was dropped entirely on the way back in.
    return [
      { tag: 'span[data-character-id]' },
      { tag: 'span[data-character-name]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({
      'data-character-id': HTMLAttributes.id,
      'data-character-name': HTMLAttributes.name,
      class: 'character-ref',
    }), 0]
  },
})
