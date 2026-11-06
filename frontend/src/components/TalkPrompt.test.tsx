import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TalkPrompt } from './TalkPrompt'

afterEach(() => {
  cleanup()
})

describe('TalkPrompt', () => {
  it('names the key to press', () => {
    render(<TalkPrompt />)

    expect(screen.getByRole('status').textContent).toBe('Press E to talk')
  })
})
