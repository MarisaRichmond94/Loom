import { Mark, mergeAttributes } from '@tiptap/core'

export const CharacterMark = Mark.create({
  name: 'character',

  addAttributes() {
    return {
      id: { default: null },
      name: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-character-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({
      'data-character-id': HTMLAttributes.id,
      'data-character-name': HTMLAttributes.name,
      class: 'character-ref',
    }), 0]
  },
})
