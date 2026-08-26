import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Highlights the single word currently being spoken by the chapter page's
// read-aloud (Alt-Shift-R), the editor-side counterpart of the reader's
// `.narration-word.is-active`.
//
// Unlike SearchHighlight / FilterWordHighlight, this one is not derived from
// document content — the active range arrives from the outside (a
// SpeechSynthesisUtterance `boundary` event), so it lives in plugin state and
// is set by a meta transaction.
//
// DATA-INTEGRITY NOTE. These transactions must never read as an edit. They
// carry no steps, so `tr.docChanged` is false, and TipTap only emits `onUpdate`
// when some transaction in the batch changed the doc — so setting, moving, and
// clearing this highlight cannot reach `onChange` and cannot write prose.
// Keep it that way: never attach a step to the transaction below.
export const narrationHighlightKey = new PluginKey<Range | null>('narrationHighlight')

export type Range = { from: number; to: number }

/** Meta payload: a range to highlight, or null to clear. */
export const SET_NARRATION_RANGE = 'setNarrationRange'

export const NarrationHighlight = Extension.create({
  name: 'narrationHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<Range | null>({
        key: narrationHighlightKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(SET_NARRATION_RANGE)
            if (meta !== undefined) return meta as Range | null
            if (!value) return null
            // The writer can keep typing while a block is being read. Map the
            // range through the change so the highlight tracks the word rather
            // than sliding onto whatever text now occupies those offsets.
            const from = tr.mapping.map(value.from, -1)
            const to = tr.mapping.map(value.to, 1)
            return to > from ? { from, to } : null
          },
        },
        props: {
          decorations(state) {
            const range = narrationHighlightKey.getState(state)
            if (!range) return DecorationSet.empty
            // Guard against a range left over from a doc that has since
            // shrunk (block replaced under us) — an out-of-bounds decoration
            // throws inside ProseMirror's view update.
            const size = state.doc.content.size
            if (range.from < 0 || range.to > size || range.to <= range.from) {
              return DecorationSet.empty
            }
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                class: 'narration-speaking',
              }),
            ])
          },
        },
      }),
    ]
  },
})
