import { generateJSON, generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'

// Why OutlineCardModal keeps a `pristineRef` (LOOM-97).
//
// The outline summary is HTML in WriteAI's store, and it is edited here with
// TipTap. TipTap does not round-trip that HTML byte-for-byte: it parses to its
// own document model and re-serialises, so escaped entities come back as
// literal characters even when the writer typed nothing.
//
// That would be cosmetic, except WriteAI decides whether a summary is still
// machine-written by comparing `writer_summary` to `summary_source` EXACTLY
// (`server/routers/plan.py`: `ws == (card.get("summary_source") or "").strip()`).
// A card merely OPENED and closed would come back looking hand-edited, and
// WriteAI would stop refreshing it — silently, permanently, and for every card
// the writer ever glanced at.
//
// So the modal sends the ORIGINAL string back when nothing changed, and these
// tests pin the reason. If TipTap ever becomes lossless here, the first test
// fails and the guard can go.

const roundTrip = (html: string) => generateHTML(generateJSON(html, [StarterKit]), [StarterKit])

// A real summary from the live store, entities and all.
const STORED =
  '<p>On Halloween afternoon, Jared Gatlin awakens hungover and faces his ' +
  'father, who beats him over his drinking. Jared&#x27;s father is a CEO.</p>'

describe('TipTap does not round-trip the stored summary', () => {
  it('changes the string even with no edit at all', () => {
    // The assertion that justifies the guard. If this ever starts passing as
    // equal, delete pristineRef — do not leave a workaround for a fixed bug.
    expect(roundTrip(STORED)).not.toBe(STORED)
  })

  it('unescapes entities, which is the specific difference', () => {
    expect(STORED).toContain('&#x27;')
    expect(roundTrip(STORED)).toContain("Jared's father")
  })

  it('preserves the text itself, so the difference really is only encoding', () => {
    const text = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'")
    expect(text(roundTrip(STORED))).toBe(text(STORED))
  })

  it('is stable once round-tripped — the drift is one-time, not cumulative', () => {
    const once = roundTrip(STORED)
    expect(roundTrip(once)).toBe(once)
  })
})

// The rule the modal implements, stated as a test so it survives a rewrite of
// the component: an untouched summary goes back byte-identical.
describe('the guard the modal applies', () => {
  function summaryToSave(stored: string, pristine: string, current: string) {
    return current === pristine ? stored : current
  }

  it('sends the stored string back when the writer changed nothing', () => {
    const pristine = roundTrip(STORED)
    expect(summaryToSave(STORED, pristine, pristine)).toBe(STORED)
  })

  it('sends the editor’s own HTML once the writer has actually edited', () => {
    const pristine = roundTrip(STORED)
    const edited = pristine.replace('hungover', 'hungover and late')
    expect(summaryToSave(STORED, pristine, edited)).toBe(edited)
  })
})
