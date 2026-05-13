import { Mark, mergeAttributes } from '@tiptap/core'

export const Footnote = Mark.create({
  name: 'footnote',

  addAttributes() {
    return {
      content: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-footnote') ?? '',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-footnote]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-footnote': HTMLAttributes.content, class: 'footnote-ref' }), 0]
  },
})
