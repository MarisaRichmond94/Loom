import { outlineCardLabels, htmlToParagraphs } from '@/lib/outlineCards'
import type { OutlineCard } from '@/lib/writerOutline'

const card = (over: Partial<OutlineCard>): OutlineCard => ({
  id: 'x',
  book: 1,
  chapter: null,
  position: 1,
  status: 'planned',
  heading: '',
  pov: '',
  date: null,
  writer_summary: '',
  extracted_bullets: [],
  notes: null,
  ...over,
})

const synced = (n: number) => card({ chapter: n, status: 'synced', id: `ch-${n}` })
const planned = (id: string) => card({ chapter: null, status: 'planned', id })

// The rule WriteAI already shipped a bug against: labelling by array index is
// off by one for every book with a prologue, and off by more once a planned
// card sits mid-sequence.
describe('outlineCardLabels', () => {
  it('uses the manuscript number, not the position', () => {
    expect(outlineCardLabels([synced(1), synced(2), synced(3)])).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 3',
    ])
  })

  it('renders chapter 0 as the prologue, never "Chapter 0"', () => {
    expect(outlineCardLabels([synced(0), synced(1)])).toEqual(['Prologue', 'Chapter 1'])
  })

  // The index-based version gets every one of these wrong.
  it('does not let a prologue shift the chapters after it', () => {
    expect(outlineCardLabels([synced(0), synced(1), synced(2)])).toEqual([
      'Prologue',
      'Chapter 1',
      'Chapter 2',
    ])
  })

  it('continues the sequence for a planned card without renumbering written ones', () => {
    expect(outlineCardLabels([synced(12), planned('p1'), synced(13)])).toEqual([
      'Chapter 12',
      'Chapter 13',
      'Chapter 13',
    ])
  })

  it('counts up across a run of planned cards', () => {
    expect(outlineCardLabels([synced(12), planned('p1'), planned('p2'), planned('p3')])).toEqual([
      'Chapter 12',
      'Chapter 13',
      'Chapter 14',
      'Chapter 15',
    ])
  })

  it('starts at 1 when nothing is written yet', () => {
    expect(outlineCardLabels([planned('p1'), planned('p2')])).toEqual(['Chapter 1', 'Chapter 2'])
  })

  it('restarts the planned run after the next written chapter', () => {
    expect(
      outlineCardLabels([synced(0), planned('p1'), synced(1), planned('p2')]),
    ).toEqual(['Prologue', 'Chapter 1', 'Chapter 1', 'Chapter 2'])
  })
})

describe('htmlToParagraphs', () => {
  it('splits paragraphs and drops the markup', () => {
    expect(htmlToParagraphs('<p>One.</p><p>Two.</p>')).toEqual(['One.', 'Two.'])
  })

  // The live store is full of these — every apostrophe in a summary is escaped.
  it('decodes the entities WriteAI emits', () => {
    expect(htmlToParagraphs('<p>Jared&#x27;s father &amp; the &quot;deal&quot;</p>')).toEqual([
      `Jared's father & the "deal"`,
    ])
  })

  it('treats <br> as a break', () => {
    expect(htmlToParagraphs('<p>One.<br>Two.</p>')).toEqual(['One.', 'Two.'])
  })

  it('survives plain text with no markup at all', () => {
    expect(htmlToParagraphs('Just a sentence.')).toEqual(['Just a sentence.'])
  })

  it.each([null, undefined, '', '<p></p>'])('returns nothing for %p', input => {
    expect(htmlToParagraphs(input)).toEqual([])
  })
})
