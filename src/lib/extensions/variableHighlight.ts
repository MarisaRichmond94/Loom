import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const VAR_PATTERN = /\{\{([a-zA-Z_$][a-zA-Z0-9_$]*)\}\}/g

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
              VAR_PATTERN.lastIndex = 0
              let m: RegExpExecArray | null
              while ((m = VAR_PATTERN.exec(node.text)) !== null) {
                const from = pos + m.index
                const to = from + m[0].length
                const exists = known.has(m[1])
                decorations.push(
                  Decoration.inline(from, to, {
                    class: exists ? 'var-ref-known' : 'var-ref-unknown',
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
