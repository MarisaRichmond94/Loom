import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findBlockMatches, type SearchOptions } from '@/lib/searchMatch'

type Options = {
  // Live getters so we don't recreate the extension every time the writer
  // types in the header search bar — TipTap's plugin instance reads the
  // current query and match options on each render.
  getQuery: () => string
  getOptions: () => SearchOptions
}

// Highlights every occurrence of the active series-search query in this
// editor's text nodes. Wraps each match in an inline decoration with the
// `search-match` class; styling lives alongside the variable-highlight
// styles in globals.css.
export const SearchHighlight = Extension.create<Options>({
  name: 'searchHighlight',

  addOptions() {
    return { getQuery: () => '', getOptions: () => ({}) }
  },

  addProseMirrorPlugins() {
    const getQuery = () => this.options.getQuery()
    const getOptions = () => this.options.getOptions()
    return [
      new Plugin({
        key: new PluginKey('searchHighlight'),
        props: {
          decorations(state) {
            const q = getQuery().trim()
            if (!q) return DecorationSet.empty
            // findBlockMatches matches across mark boundaries (italic, bold,
            // character refs, footnotes) — a per-text-node scan would miss
            // any query straddling a styled span. Decoration.inline happily
            // spans multiple text nodes, so the highlight stays continuous.
            const decorations = findBlockMatches(state.doc, q, getOptions()).map(({ from, to }) =>
              Decoration.inline(from, to, {
                // <mark> wrapper picks up the browser's default yellow even
                // if our stylesheet got dropped. The class + inline style
                // stack on top so the same highlight shows under
                // @tailwindcss/typography's prose-invert (which restyles <mark>).
                nodeName: 'mark',
                class: 'search-match',
                style: 'background-color: rgba(250, 204, 21, 0.45); color: inherit; box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.55); border-radius: 2px; padding: 0 1px; text-decoration: underline; text-decoration-color: rgba(250, 204, 21, 0.9); text-decoration-thickness: 2px;',
              }),
            )
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
