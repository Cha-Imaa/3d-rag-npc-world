import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatError } from '../api/chat'
import { ClearConversationsControl } from './ClearConversationsControl'

const CLEAR_BUTTON = 'Clear my conversations'

/** Render the control with the given clear, and open its question. */
function renderAndAsk(onClear: () => Promise<void>) {
  render(<ClearConversationsControl disabled={false} onClear={onClear} />)
  fireEvent.click(screen.getByRole('button', { name: CLEAR_BUTTON }))
}

afterEach(() => {
  cleanup()
})

describe('ClearConversationsControl', () => {
  it('asks before clearing, with the focus on Cancel', () => {
    const onClear = vi.fn().mockResolvedValue(undefined)
    renderAndAsk(onClear)

    expect(screen.getByText('Delete your saved conversations with every character?')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClear).not.toHaveBeenCalled()
  })

  it('clears nothing when cancelled, and gives the focus back to its button', () => {
    const onClear = vi.fn().mockResolvedValue(undefined)
    renderAndAsk(onClear)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClear).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: CLEAR_BUTTON }))
  })

  it('clears once confirmed and says so', async () => {
    const onClear = vi.fn().mockResolvedValue(undefined)
    renderAndAsk(onClear)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect((await screen.findByRole('status')).textContent).toBe('Your conversations were cleared.')
    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('shows the plain reason when clearing fails, and lets the visitor try again', async () => {
    const onClear = vi
      .fn()
      .mockRejectedValueOnce(new ChatError('server_unreachable', 'Unreachable.'))
      .mockResolvedValueOnce(undefined)
    renderAndAsk(onClear)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Unreachable.')
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: CLEAR_BUTTON }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('still reports a failure that is not a ChatError', async () => {
    renderAndAsk(vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      "Your conversations couldn't be cleared. Please try again.",
    )
  })

  it('turns off both of its buttons while clearing', () => {
    renderAndAsk(() => new Promise(() => {}))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByText('Clearing…')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(true)
  })

  it('cannot be used while it is turned off', () => {
    render(<ClearConversationsControl disabled onClear={vi.fn()} />)

    const clearButton = screen.getByRole<HTMLButtonElement>('button', { name: CLEAR_BUTTON })
    expect(clearButton.disabled).toBe(true)
  })
})
