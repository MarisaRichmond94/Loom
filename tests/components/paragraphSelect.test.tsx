import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextSelection } from '@tiptap/pm/state'
import { ParagraphSelect } from '@/lib/extensions/paragraphSelect'

// ⌥⇧↑ / ⌥⇧↓ must select from the cursor to the edge of the paragraph it is
// ALREADY IN (Pages semantics), not overshoot into the neighbouring paragraph
// at the same column (Chrome's native semantics). These drive real keydown
// events through ProseMirror's keymap so the binding NAMES are covered too —
// a command that works but is registered under a name prosemirror-keymap
// never matches would pass a direct-invocation test and fail in the app.

let editor: Editor

function mount(html: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: [StarterKit, ParagraphSelect], content: html })
  // jsdom has no layout engine, so every getClientRects() comes back empty and
  // prosemirror-view's coordsAtPos throws. That only matters for the bare ↑/↓
  // bindings: those deliberately return false, so the event travels on to
  // prosemirror-gapcursor, which probes endOfTextblock to decide whether a gap
  // cursor belongs here. Answering "no" is both what a real browser reports for
  // these plain-paragraph fixtures and the only answer jsdom can give.
  editor.view.endOfTextblock = () => false
}

afterEach(() => {
  editor?.destroy()
  document.body.innerHTML = ''
})

/** Inner start/end positions of the nth (0-indexed) top-level paragraph. */
function para(n: number): { start: number; end: number } {
  let i = 0
  let found: { start: number; end: number } | null = null
  editor.state.doc.forEach((node, offset) => {
    if (found) return
    if (i++ === n) found = { start: offset + 1, end: offset + 1 + node.content.size }
  })
  if (!found) throw new Error(`no paragraph ${n}`)
  return found
}

function setCursor(pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
}

function press(key: 'ArrowUp' | 'ArrowDown') {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, altKey: true, shiftKey: true, bubbles: true, cancelable: true })
  )
}

type Arrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/** A bare arrow press. Returns whether the default action was prevented. */
function pressPlain(key: Arrow): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

function select(anchor: number, head: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)))
}

function selection() {
  const { anchor, head } = editor.state.selection
  return { anchor, head }
}

const THREE = '<p>Alpha one</p><p>Beta two</p><p>Gamma three</p>'

describe('ParagraphSelect (⌥⇧↑ / ⌥⇧↓)', () => {
  it('selects from mid-paragraph back to the start of THAT paragraph', () => {
    mount(THREE)
    const p2 = para(1)
    setCursor(p2.start + 4) // "Beta| two"
    press('ArrowUp')
    // The bug being guarded: head landing inside paragraph 1 instead of p2.start
    expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.start })
  })

  it('selects from mid-paragraph forward to the end of THAT paragraph', () => {
    mount(THREE)
    const p2 = para(1)
    setCursor(p2.start + 4)
    press('ArrowDown')
    expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.end })
  })

  it('selects to the paragraph start from the very end of the paragraph', () => {
    mount(THREE)
    const p2 = para(1)
    setCursor(p2.end)
    press('ArrowUp')
    expect(selection()).toEqual({ anchor: p2.end, head: p2.start })
  })

  it('swallows the previous paragraph when already parked at the start', () => {
    mount(THREE)
    const p2 = para(1)
    setCursor(p2.start)
    press('ArrowUp')
    expect(selection()).toEqual({ anchor: p2.start, head: para(0).start })
  })

  it('swallows the next paragraph when already parked at the end', () => {
    mount(THREE)
    const p2 = para(1)
    setCursor(p2.end)
    press('ArrowDown')
    expect(selection()).toEqual({ anchor: p2.end, head: para(2).end })
  })

  it('extends rather than resets across repeated presses', () => {
    mount(THREE)
    const p3 = para(2)
    setCursor(p3.start + 5) // "Gamma| three"
    press('ArrowUp') // → start of p3
    press('ArrowUp') // → start of p2
    press('ArrowUp') // → start of p1
    expect(selection()).toEqual({ anchor: p3.start + 5, head: para(0).start })
  })

  it('is a no-op at the top of the document', () => {
    mount(THREE)
    setCursor(para(0).start)
    press('ArrowUp')
    expect(selection()).toEqual({ anchor: para(0).start, head: para(0).start })
  })

  it('is a no-op at the bottom of the document', () => {
    mount(THREE)
    setCursor(para(2).end)
    press('ArrowDown')
    expect(selection()).toEqual({ anchor: para(2).end, head: para(2).end })
  })

  it('treats a heading as a paragraph for edge-seeking purposes', () => {
    mount('<h2>Chapter One</h2><p>Alpha one</p>')
    const h = para(0)
    setCursor(h.start + 7) // "Chapter| One"
    press('ArrowDown')
    expect(selection()).toEqual({ anchor: h.start + 7, head: h.end })
  })
})

// A bare arrow after the selection is built. The selections here are BACKWARD
// (anchor after head) because that is what ⌥⇧↑ produces and it is the case
// Chrome resolves from anchor/head instead of from document order.
describe('ParagraphSelect (bare arrow collapses to the selection edge)', () => {
  it('collapses to the LEFT edge on ←, not to the anchor', () => {
    mount(THREE)
    const p2 = para(1)
    select(p2.start + 4, p2.start) // ⌥⇧↑ from "Beta| two"
    expect(pressPlain('ArrowLeft')).toBe(true)
    expect(selection()).toEqual({ anchor: p2.start, head: p2.start })
  })

  it('collapses to the RIGHT edge on →, not to the head', () => {
    mount(THREE)
    const p2 = para(1)
    select(p2.start + 4, p2.start)
    expect(pressPlain('ArrowRight')).toBe(true)
    expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.start + 4 })
  })

  it('collapses across a multi-paragraph backward selection', () => {
    mount(THREE)
    const p3 = para(2)
    select(p3.start + 5, para(0).start) // three presses of ⌥⇧↑
    expect(pressPlain('ArrowLeft')).toBe(true)
    expect(selection()).toEqual({ anchor: para(0).start, head: para(0).start })
  })

  it('collapses to the edge on ↑/↓ without moving a line', () => {
    mount(THREE)
    const p2 = para(1)

    select(p2.start + 4, p2.start)
    expect(pressPlain('ArrowUp')).toBe(true)
    expect(selection()).toEqual({ anchor: p2.start, head: p2.start })

    select(p2.start + 4, p2.start)
    expect(pressPlain('ArrowDown')).toBe(true)
    expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.start + 4 })
  })

  it('leaves an already-collapsed caret entirely to the browser', () => {
    mount(THREE)
    const p2 = para(1)
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as Arrow[]) {
      setCursor(p2.start + 4)
      expect(pressPlain(key)).toBe(false)
      expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.start + 4 })
    }
  })

  it('does not intercept modified arrows (⌘←, ⇧→)', () => {
    mount(THREE)
    const p2 = para(1)
    select(p2.start + 4, p2.start)
    for (const mod of [{ metaKey: true }, { shiftKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true, ...mod })
      editor.view.dom.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      // Selection untouched — those keys belong to the browser and to ⇧-extend.
      expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.start })
    }
  })
})

// jsdom has no layout, so a ↑/↓ handler that consulted geometry would silently
// no-op here and these tests would pass without proving anything. Installing a
// synthetic layout — three paragraphs, one line each, 20px tall, one column per
// 10px — makes geometry available, so "the caret did not move a line" becomes a
// real assertion instead of an artefact of the environment. Moving a line was
// the previous behaviour and is the thing being guarded against.
describe('ParagraphSelect (↑/↓ never move a line, even where layout exists)', () => {
  const LINE_H = 20
  const COL_W = 10

  function installLayout() {
    const locate = (pos: number) => {
      let idx = -1
      let off = 0
      let i = 0
      editor.state.doc.forEach((node, offset) => {
        const start = offset + 1
        if (pos >= start && pos <= start + node.content.size) { idx = i; off = pos - start }
        i++
      })
      return { idx, off }
    }
    editor.view.coordsAtPos = (pos: number) => {
      const { idx, off } = locate(pos)
      const top = idx * LINE_H
      return { top, bottom: top + LINE_H, left: off * COL_W, right: off * COL_W + COL_W }
    }
    editor.view.posAtCoords = ({ left, top }: { left: number; top: number }) => {
      const idx = Math.floor(top / LINE_H)
      if (idx < 0 || idx > 2) return null
      const p = para(idx)
      const off = Math.max(0, Math.min(Math.round(left / COL_W), p.end - p.start))
      return { pos: p.start + off, inside: -1 }
    }
  }

  it('parks on the paragraph start on ↑ — does not step up to para 1', () => {
    mount(THREE)
    installLayout()
    const p2 = para(1)
    select(p2.start + 4, p2.start) // backward, as ⌥⇧↑ produces

    expect(pressPlain('ArrowUp')).toBe(true)
    // A line move would have landed somewhere in para(0). It must not.
    expect(selection()).toEqual({ anchor: p2.start, head: p2.start })
  })

  it('parks on the selection end on ↓ — does not step down to para 3', () => {
    mount(THREE)
    installLayout()
    const p2 = para(1)
    select(p2.start + 4, p2.start)

    expect(pressPlain('ArrowDown')).toBe(true)
    expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.start + 4 })
  })

  it('still hands a collapsed caret to the browser for real line movement', () => {
    mount(THREE)
    installLayout()
    const p2 = para(1)
    setCursor(p2.start + 4)

    // No selection to dismiss, so ↑ is ordinary caret movement and stays native.
    expect(pressPlain('ArrowUp')).toBe(false)
    expect(selection()).toEqual({ anchor: p2.start + 4, head: p2.start + 4 })
  })
})
