import { render, screen } from '@testing-library/react'
import { ConditionRow } from '@/components/editor/conditionUI'

// A clause naming a variable that does not exist must be VISIBLE (LOOM-122).
//
// ConditionRow builds its rows by filtering the declared variables, so such a
// clause used to render as nothing at all — while still sitting in the stored
// JSON, and still being written back out by every edit. That is how a dead
// override stayed unfindable: the UI could not show the thing making it dead.

jest.mock('@/lib/authorContext', () => ({
  useAuthor: () => ({ knownStringValues: {} }),
}))

const VARIABLES = [
  { id: 'v1', name: 'didNoahUseSteroids', type: 'boolean', defaultValue: 'true' },
]

describe('ConditionRow with an undeclared variable', () => {
  it('renders the ghost clause so it can be seen', () => {
    render(
      <ConditionRow
        condition={JSON.stringify({ didNoahUseSteroids: true, isNoahUsingSteroids: true })}
        variables={VARIABLES}
        onChange={() => {}}
      />,
    )

    // The real clause still renders.
    expect(screen.getByText('didNoahUseSteroids')).toBeInTheDocument()
    // ...and so does the broken one. This is the assertion that was false.
    expect(screen.getByText('isNoahUsingSteroids')).toBeInTheDocument()
  })

  it('removes only the ghost clause when it is dismissed', () => {
    const onChange = jest.fn()
    render(
      <ConditionRow
        condition={JSON.stringify({ didNoahUseSteroids: true, isNoahUsingSteroids: true })}
        variables={VARIABLES}
        onChange={onChange}
      />,
    )

    const ghost = screen.getByText('isNoahUsingSteroids').closest('div')!
    const remove = ghost.querySelector('button')!
    remove.click()

    expect(onChange).toHaveBeenCalledWith(JSON.stringify({ didNoahUseSteroids: true }))
  })

  it('says "always" only when there is genuinely nothing, ghosts included', () => {
    render(
      <ConditionRow
        condition={JSON.stringify({ onlyAGhost: true })}
        variables={VARIABLES}
        onChange={() => {}}
      />,
    )

    expect(screen.queryByText('always')).not.toBeInTheDocument()
    expect(screen.getByText('onlyAGhost')).toBeInTheDocument()
  })
})
