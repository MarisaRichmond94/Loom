import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConditionSentence from '@/components/editor/ConditionSentence'

// Conditions read as a sentence, and in the banner their variable names are
// click-to-copy (LOOM-122). The name is the search term for finding the thing
// in the manuscript, and retyping didEmmaLearnJaredIsAfraidOfNoahLeaving by
// eye is exactly how a one-character-wrong variable gets written — the failure
// this whole feature exists to catch.

describe('ConditionSentence', () => {
  it('reads a legacy AND condition as a sentence', () => {
    render(<ConditionSentence raw={JSON.stringify({ didNoahGetShot: true })} />)
    expect(screen.getByText(/Shows when/)).toBeInTheDocument()
    expect(screen.getByText('didNoahGetShot')).toBeInTheDocument()
    expect(screen.getByText('true')).toBeInTheDocument()
  })

  it('joins compound clauses with the stored operator', () => {
    render(
      <ConditionSentence
        raw={JSON.stringify({
          op: 'or',
          clauses: [
            { var: 'didNoahGetShot', value: true },
            { var: 'didNoahUseSteroids', value: false },
          ],
        })}
      />,
    )
    // getByText trims, so the rendered " or " matches as "or".
    expect(screen.getByText('or')).toBeInTheDocument()
    expect(screen.getByText('didNoahGetShot')).toBeInTheDocument()
    expect(screen.getByText('didNoahUseSteroids')).toBeInTheDocument()
  })

  it('flips the lead-in for a hide-polarity condition rather than stacking it', () => {
    render(
      <ConditionSentence
        raw={JSON.stringify({
          op: 'and', mode: 'hide',
          clauses: [{ var: 'didNoahGetShot', value: true }],
        })}
      />,
    )
    expect(screen.getByText(/Hidden when/)).toBeInTheDocument()
    expect(screen.queryByText(/Shows when/)).not.toBeInTheDocument()
  })

  it('renders comparison operators in words', () => {
    render(
      <ConditionSentence
        raw={JSON.stringify({
          op: 'and',
          clauses: [{ var: 'emmaTrustScore', value: 3, cmp: '>' }],
        })}
      />,
    )
    expect(screen.getByText(/is above/)).toBeInTheDocument()
  })

  it('is plain text by default — no stray buttons in the ledger', () => {
    render(<ConditionSentence raw={JSON.stringify({ didNoahGetShot: true })} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('copies the variable name when asked to, and says so', async () => {
    const user = userEvent.setup()
    const writeText = jest.fn().mockResolvedValue(undefined)
    // Defined, not assigned: jsdom exposes navigator.clipboard as a getter,
    // and userEvent.setup() installs its own stub that must be replaced after
    // setup rather than before it.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<ConditionSentence raw={JSON.stringify({ isNoahUsingSteroids: true })} copyable />)

    await user.click(screen.getByRole('button', { name: /Copy isNoahUsingSteroids/ }))

    expect(writeText).toHaveBeenCalledWith('isNoahUsingSteroids')
    expect(await screen.findByText('copied')).toBeInTheDocument()
  })

  it('stays quiet when the clipboard is unavailable', async () => {
    const user = userEvent.setup()
    const writeText = jest.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<ConditionSentence raw={JSON.stringify({ didNoahGetShot: true })} copyable />)
    await user.click(screen.getByRole('button', { name: /Copy didNoahGetShot/ }))

    // The name is still shown and selectable; a failed convenience must not
    // turn into an error the writer has to dismiss.
    expect(screen.getByText('didNoahGetShot')).toBeInTheDocument()
  })
})
