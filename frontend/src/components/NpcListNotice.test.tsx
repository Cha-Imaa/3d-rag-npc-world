import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NpcListNotice } from './NpcListNotice'

afterEach(() => {
  cleanup()
})

describe('NpcListNotice', () => {
  it('shows that NPCs are loading', () => {
    render(<NpcListNotice status="loading" npcCount={0} onRetry={vi.fn()} />)

    expect(screen.getByRole('status').textContent).toBe('Looking for villagers...')
  })

  it('offers a retry after a failure', () => {
    const onRetry = vi.fn()
    render(<NpcListNotice status="failed" npcCount={0} onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says so when no NPCs are enabled', () => {
    render(<NpcListNotice status="ready" npcCount={0} onRetry={vi.fn()} />)

    expect(screen.getByRole('status').textContent).toBe('Nobody lives in the village yet.')
  })

  it('shows nothing once NPCs are in the village', () => {
    const { container } = render(<NpcListNotice status="ready" npcCount={3} onRetry={vi.fn()} />)

    expect(container.textContent).toBe('')
  })
})
