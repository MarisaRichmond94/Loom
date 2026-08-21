import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Selection, TextSelection } from '@tiptap/pm/state'

// ⌥⇧↑ / ⌥⇧↓ — extend the selection to the edge of the paragraph the cursor is
// already in, the way Pages (and every other Cocoa text view) does it.
//
// Chrome's native handling of these keys is subtly different and it's the
// difference that bites: Blink implements "paragraph granularity" as repeated
// LINE movement until the caret crosses a paragraph boundary, carrying the
// caret's horizontal x-position along the way. So from mid-paragraph you don't
// get "everything back to the start of this paragraph" — you get a selection
// that overshoots into the NEIGHBOURING paragraph and stops at whatever column
// you happened to be sitting in. Only the from-the-very-start case looks right,
// which is why this reads as an intermittent bug rather than a flat difference.
//
// Returning true makes ProseMirror preventDefault() the keydown, so Blink's
// version never runs. Holding $anchor still and moving only the head is what
// lets repeated presses extend the selection instead of resetting it.
function extendToParagraphEdge(dir: -1 | 1) {
  return ({ editor }: { editor: Editor }) => {
    const { state, view } = editor
    const { $head, $anchor } = state.selection
    // Node selections (a selected section break) have no paragraph edge to seek
    // — hand those back to the default handler.
    if (!$head.parent.isTextblock) return false

    let target = dir < 0 ? $head.start() : $head.end()

    // Already parked on the edge, so the writer means the paragraph BEYOND it:
    // a second ⌥⇧↑ swallows the previous paragraph whole. Every bail-out below
    // still returns true — the key is ours once it's bound, and falling through
    // to Blink here would produce exactly the overshoot this extension exists
    // to prevent.
    if ($head.pos === target) {
      const probe = dir < 0 ? target - 1 : target + 1
      if (probe < 0 || probe > state.doc.content.size) return true // doc edge
      const near = Selection.near(state.doc.resolve(probe), dir)
      if (!near.$head.parent.isTextblock) return true
      const edge = dir < 0 ? near.$head.start() : near.$head.end()
      if (edge === target) return true // nothing to move to
      target = edge
    }

    view.dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, $anchor.pos, target))
        .scrollIntoView()
    )
    return true
  }
}

// A bare arrow key pressed while a selection is up collapses that selection to
// one of its EDGES and stops there. "Edge" means document order, which is the
// point: ⌥⇧↑ builds a BACKWARD selection (head before anchor), and Chrome
// resolves the arrow from anchor/head plus a cached x-column, so the caret ends
// up a line off from the position the selection was grown from — mid-word in
// the neighbouring paragraph — instead of resting on the edge you selected to.
//
// All four arrows behave the same way here, and none of them move by a line:
// the arrow's entire job in this state is to dismiss the selection and park the
// caret on the end the writer was looking at. ↑ and ← both go to the upper-left
// edge, ↓ and → both to the lower-right one. Vertical movement resumes on the
// NEXT press, when the selection is collapsed and this all falls through to the
// browser untouched.
function collapseToSelectionEdge(dir: -1 | 1) {
  return ({ editor }: { editor: Editor }) => {
    const { state, view } = editor
    // Nothing selected: this is ordinary caret movement, entirely the browser's
    // business. Node selections have no text edge to collapse onto.
    const sel = state.selection
    if (sel.empty || !(sel instanceof TextSelection)) return false

    // sel.from/sel.to are already normalised to min/max by ProseMirror, which
    // is exactly the anchor/head-independent edge we want.
    const edge = dir < 0 ? sel.from : sel.to
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, edge)).scrollIntoView())
    return true
  }
}

export const ParagraphSelect = Extension.create({
  name: 'paragraphSelect',

  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': extendToParagraphEdge(-1),
      'Alt-Shift-ArrowDown': extendToParagraphEdge(1),
      // Bare arrows only — prosemirror-keymap builds the lookup name with every
      // active modifier, so ⌘←, ⇧→ and the ⌥⇧ pair above never reach these.
      ArrowLeft: collapseToSelectionEdge(-1),
      ArrowUp: collapseToSelectionEdge(-1),
      ArrowRight: collapseToSelectionEdge(1),
      ArrowDown: collapseToSelectionEdge(1),
    }
  },
})
