import { tabsFitLabelled } from '@/lib/panelTabs'

// MIN_WIDTH in SidePanel.tsx. Duplicated rather than imported because that
// module pulls in the whole panel tree; if the floor moves, this should fail.
const MIN_WIDTH = 280

describe('tabsFitLabelled', () => {
  it('keeps labels on the current three tabs at the dock floor', () => {
    // Today's behaviour. Collapsing labels at 280px with three tabs would be a
    // regression, not the point of LOOM-41.
    expect(tabsFitLabelled(MIN_WIDTH, 3)).toBe(true)
  })

  it('drops labels for four tabs at the dock floor', () => {
    // This is the case that forced the ticket: Reviews / Events / Notes / Pins.
    expect(tabsFitLabelled(MIN_WIDTH, 4)).toBe(false)
  })

  it('restores labels for four tabs once the dock is dragged wider', () => {
    expect(tabsFitLabelled(420, 4)).toBe(true)
  })

  it('still collapses five tabs at a width where four fit', () => {
    // Characters (LOOM-33) is the fifth. The rule is width-driven, so it keeps
    // working as tabs are added without another ticket.
    expect(tabsFitLabelled(420, 5)).toBe(false)
    expect(tabsFitLabelled(560, 5)).toBe(true)
  })

  it('is monotonic in width', () => {
    for (const count of [3, 4, 5]) {
      const widths = [200, 280, 340, 420, 500, 600, 720]
      const fits = widths.map(w => tabsFitLabelled(w, count))
      // Once true, never false again as the dock grows.
      expect(fits.slice(fits.indexOf(true)).every(Boolean)).toBe(true)
    }
  })

  it('is monotonic in tab count', () => {
    for (const width of [280, 420, 560, 720]) {
      for (const count of [3, 4, 5]) {
        if (!tabsFitLabelled(width, count)) {
          expect(tabsFitLabelled(width, count + 1)).toBe(false)
        }
      }
    }
  })

  it('never fits at implausibly narrow widths', () => {
    expect(tabsFitLabelled(0, 3)).toBe(false)
    expect(tabsFitLabelled(120, 3)).toBe(false)
  })
})
