import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirstVisitHint } from './FirstVisitHint'

afterEach(() => {
  cleanup()
})

describe('FirstVisitHint', () => {
  it('explains the controls and can be dismissed', () => {
    const onDismiss = vi.fn()
    render(<FirstVisitHint onDismiss={onDismiss} />)

    expect(screen.getByText('Drag to look around. Click a character to talk.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
