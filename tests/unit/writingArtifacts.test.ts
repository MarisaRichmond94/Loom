import { scriptBookIndex } from '@/lib/writingArtifacts'

// The addressing half of LOOM-157.
//
// The generate scripts take a 1-based index into a hardcoded registry, and the
// only thing standing between a button and the WRONG book's audiobook is this
// title join. It is worth pinning against the real scripts rather than a
// fixture: the registry is five lines of zsh edited by hand each time a book
// ships, and a test over a fixture would keep passing after the next edit.
describe('scriptBookIndex', () => {
  it('resolves each canon book to its position in the script registry', async () => {
    // Reading order, which is what the script's own menu numbers.
    const order = [
      "Nobody's Hero",
      'Faded',
      'The Secrets We Keep',
      'The Secrets We Bury',
      'Split',
    ]
    for (const kind of ['audiobook', 'epub'] as const) {
      for (const [i, title] of order.entries()) {
        await expect(scriptBookIndex(kind, title)).resolves.toBe(i + 1)
      }
    }
  })

  // The live miss. Loom and the script hold these titles independently, and a
  // curly apostrophe on one side resolved to null before the normalisation —
  // which would have disabled the button on exactly one book.
  it('matches across apostrophe and case differences', async () => {
    await expect(scriptBookIndex('audiobook', 'Nobody’s Hero')).resolves.toBe(1)
    await expect(scriptBookIndex('audiobook', "  nobody's hero  ")).resolves.toBe(1)
    await expect(scriptBookIndex('epub', 'SPLIT')).resolves.toBe(5)
  })

  // A book the scripts have never heard of — an alt book, or one added since
  // the registry was last edited. Null, so the menu disables with a reason;
  // never a silent fallback to a neighbouring index.
  it('returns null for a book the script does not know', async () => {
    await expect(scriptBookIndex('audiobook', 'Split (alt ending)')).resolves.toBeNull()
    await expect(scriptBookIndex('epub', 'The Secrets We')).resolves.toBeNull()
  })
})
