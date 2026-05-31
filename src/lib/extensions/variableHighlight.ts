import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findAllTemplateRanges } from '@/lib/templateVars'

type Options = {
  getVariableNames: () => string[]
}

export const VariableHighlight = Extension.create<Options>({
  name: 'variableHighlight',

  addOptions() {
    return { getVariableNames: () => [] }
  },

  addProseMirrorPlugins() {
    const getVariableNames = () => this.options.getVariableNames()
    return [
      new Plugin({
        key: new PluginKey('variableHighlight'),
        props: {
          decorations(state) {
            const known = new Set(getVariableNames())
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              // findAllTemplateRanges yields every {{...}} span — outer
              // and nested — so a typo in an inner template still
              // flags red even when its parent is known.
              for (const r of findAllTemplateRanges(node.text)) {
                if (!r.name) continue
                decorations.push(
                  Decoration.inline(pos + r.start, pos + r.end, {
                    class: known.has(r.name) ? 'var-ref-known' : 'var-ref-unknown',
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
