import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isFilterWord } from '@/lib/chapterStats'

type Options = {
  // Live getter, same shape as SearchHighlight — the eye toggle in the stats
  // popover flips this without recreating the editor.
  getEnabled: () => boolean
}

const WORD_RE = /[A-Za-z']+/g

// Highlights every filter word (was, just, suddenly, -ly adverbs...) when the
// stats popover's eye toggle is on. Scans text nodes directly rather than
// resolved plain text — `isFilterWord` is the exact same check `chapterStats`
// counts with, so the highlighted words and the "Filter words" count never
// disagree. Purple, deliberately distinct from SearchHighlight's yellow: the
// two can be visible at once (a search query that happens to match "really"),
// and identical colours would make them unreadable as separate signals.
export const FilterWordHighlight = Extension.create<Options>({
  name: 'filterWordHighlight',

  addOptions() {
    return { getEnabled: () => false }
  },

  addProseMirrorPlugins() {
    const getEnabled = () => this.options.getEnabled()
    return [
      new Plugin({
        key: new PluginKey('filterWordHighlight'),
        props: {
          decorations(state) {
            if (!getEnabled()) return DecorationSet.empty
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              WORD_RE.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = WORD_RE.exec(node.text))) {
                if (!isFilterWord(match[0])) continue
                const from = pos + match.index
                decorations.push(
                  Decoration.inline(from, from + match[0].length, {
                    nodeName: 'mark',
                    class: 'filter-word-match',
                    style: 'background-color: rgba(168, 85, 247, 0.28); color: inherit; box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.4); border-radius: 2px; padding: 0 1px;',
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
