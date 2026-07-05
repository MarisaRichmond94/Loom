import { Extension } from '@tiptap/core'

// Per-paragraph first-line-indent control. Every paragraph indents by
// default (the editor and reader style `.ProseMirror p` / prose `p` with
// indent-8); setting `indent: false` adds a `no-indent` class that zeroes
// it — used for continuation paragraphs after a centered interruption
// (signs, inscriptions, letters) where a fresh indent would read as a new
// paragraph. ⌥⇧I toggles it on the paragraph under the cursor. The canon
// exporter mirrors the attribute as w:ind firstLine=0 so the manuscript
// matches the editor.
export const ParagraphIndent = Extension.create({
  name: 'paragraphIndent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: true,
            parseHTML: element => !element.classList.contains('no-indent'),
            renderHTML: attributes => attributes.indent === false ? { class: 'no-indent' } : {},
          },
        },
      },
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-i': ({ editor }) => {
        const current = editor.getAttributes('paragraph').indent
        return editor.commands.updateAttributes('paragraph', { indent: current === false })
      },
    }
  },
})
