import { render, screen } from '@testing-library/react'
import SectionTabs from '@/components/SectionTabs'

// Opening the series page on a named tab (LOOM-122).
//
// LOOM-111 made this page always open on its first tab, and that still holds:
// arriving at the series URL should be predictable, and there is deliberately
// no remembered "last tab". `initialId` is the different case — arriving with
// a stated destination, the way the chapter banner's "Show all issues" link
// does — so it is driven by an explicit link and never by history.

const SECTIONS = [
  { id: 'books', label: 'Book(s)', content: <p>book list</p> },
  { id: 'characters', label: 'Character(s)', content: <p>cast list</p> },
  { id: 'paths', label: 'Path(s)', content: <p>reachability ledger</p> },
]

describe('SectionTabs initialId', () => {
  it('opens on the first tab when nothing is asked for', () => {
    render(<SectionTabs sections={SECTIONS} />)
    expect(screen.getByText('book list')).toBeInTheDocument()
    expect(screen.queryByText('reachability ledger')).not.toBeInTheDocument()
  })

  it('opens on the named tab when a link asks for one', () => {
    render(<SectionTabs sections={SECTIONS} initialId="paths" />)
    expect(screen.getByText('reachability ledger')).toBeInTheDocument()
    expect(screen.queryByText('book list')).not.toBeInTheDocument()
  })

  it('falls back to the first tab for an id that matches nothing', () => {
    // A stale or mistyped link must land somewhere real rather than render an
    // empty page with every tab inactive.
    render(<SectionTabs sections={SECTIONS} initialId="nope" />)
    expect(screen.getByText('book list')).toBeInTheDocument()
  })
})
