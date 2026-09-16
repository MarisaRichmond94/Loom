import { formatSelectionPercent } from '@/components/editor/useSelectionWordCount'

describe('formatSelectionPercent', () => {
  it('rounds to whole numbers at 10% and above', () => {
    expect(formatSelectionPercent(10)).toBe('10')
    expect(formatSelectionPercent(42.4)).toBe('42')
    expect(formatSelectionPercent(99.6)).toBe('100')
  })

  it('keeps one decimal below 10%, where scene-sized differences live', () => {
    expect(formatSelectionPercent(9.94)).toBe('9.9')
    expect(formatSelectionPercent(4.25)).toBe('4.3')
    expect(formatSelectionPercent(1)).toBe('1.0')
  })

  it('never rounds a real selection away to zero', () => {
    expect(formatSelectionPercent(0.04)).toBe('<0.1')
    expect(formatSelectionPercent(0.06)).toBe('0.1')
  })
})
