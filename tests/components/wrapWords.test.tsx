import { wrapWords } from '@/lib/narration/wrapWords'

// Builds a container, wraps it, and returns the ordered list of token strings
// keyed by their data-wi (a token can span multiple spans; join their text).
function wrapAndTokens(html: string): { count: number; tokens: string[]; wiOf: (text: string) => number[] } {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  const next = wrapWords(root, 0)
  const byWi = new Map<number, string>()
  root.querySelectorAll<HTMLElement>('.narration-word').forEach(el => {
    const wi = Number(el.dataset.wi)
    byWi.set(wi, (byWi.get(wi) ?? '') + (el.textContent ?? ''))
  })
  const tokens = [...byWi.keys()].sort((a, b) => a - b).map(k => byWi.get(k)!)
  const wiOf = (text: string) =>
    [...byWi.entries()].filter(([, v]) => v === text).map(([k]) => k)
  document.body.removeChild(root)
  return { count: next, tokens, wiOf }
}

describe('wrapWords tokenization', () => {
  it('keeps paragraph-boundary words as separate tokens', () => {
    // Two <p>s with no whitespace character between them — the reader's real
    // structure. "fell." and "Mara" must NOT merge into one token.
    const { tokens } = wrapAndTokens('<p>The rain fell.</p><p>Mara waited.</p>')
    expect(tokens).toEqual(['The', 'rain', 'fell.', 'Mara', 'waited.'])
  })

  it('joins an inline mark split mid-token (<em>glass</em>.)', () => {
    const { tokens, wiOf } = wrapAndTokens('<p>The <em>glass</em>. broke</p>')
    expect(tokens).toEqual(['The', 'glass.', 'broke'])
    // "glass" and "." live in different DOM nodes but share one index.
    expect(wiOf('glass.')).toHaveLength(1)
  })

  it('separates words across a <br> line break', () => {
    const { tokens } = wrapAndTokens('<p>He crossed<br>the room.</p>')
    expect(tokens).toEqual(['He', 'crossed', 'the', 'room.'])
  })

  it('separates across headings and list items', () => {
    const { tokens } = wrapAndTokens('<h2>Title here</h2><ul><li>one</li><li>two</li></ul>')
    expect(tokens).toEqual(['Title', 'here', 'one', 'two'])
  })

  it('splits em-dash-joined words into separate tokens (dash stays on the left)', () => {
    const { tokens } = wrapAndTokens('<p>still—waiting now shoulder—hard—shaking</p>')
    expect(tokens).toEqual(['still—', 'waiting', 'now', 'shoulder—', 'hard—', 'shaking'])
  })

  it('numbers continuously and reports the next free index', () => {
    const { count, tokens } = wrapAndTokens('<p>a b</p><p>c</p>')
    expect(tokens).toEqual(['a', 'b', 'c'])
    expect(count).toBe(3)
  })

  it('is idempotent — a second wrap does not double-wrap', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>one two</p>'
    document.body.appendChild(root)
    const first = wrapWords(root, 0)
    const again = wrapWords(root, first) // already wrapped → no-op, returns startWi
    expect(first).toBe(2)
    expect(again).toBe(first)
    expect(root.querySelectorAll('.narration-word')).toHaveLength(2)
    document.body.removeChild(root)
  })
})
