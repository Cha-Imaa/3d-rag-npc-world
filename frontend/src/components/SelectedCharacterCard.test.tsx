import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectedCharacterCard } from './SelectedCharacterCard'

afterEach(() => {
  cleanup()
})

describe('SelectedCharacterCard', () => {
  it('names the selected character and says chat is not ready', () => {
    render(<SelectedCharacterCard characterNumber={2} onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Character 2' })).toBeTruthy()
    expect(screen.getByText("Chat isn't available yet.")).toBeTruthy()
  })

  it('can be closed', () => {
    const onClose = vi.fn()
    render(<SelectedCharacterCard characterNumber={1} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
