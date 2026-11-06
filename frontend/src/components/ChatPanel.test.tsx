import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Npc } from '../api/npcs'
import { ChatPanel } from './ChatPanel'

const NPC: Npc = { id: 'test-npc', display_name: 'Test NPC', scene_position: { q: 0, r: 0 } }

afterEach(() => {
  cleanup()
})

describe('ChatPanel', () => {
  it('names the NPC from its configuration', () => {
    render(<ChatPanel npc={NPC} onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Test NPC' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Conversation with Test NPC' })).toBeTruthy()
  })

  it('shows the empty state before any messages exist', () => {
    render(<ChatPanel npc={NPC} onClose={vi.fn()} />)

    expect(screen.getByText('No messages yet.')).toBeTruthy()
  })

  it('puts the cursor in the message box', () => {
    render(<ChatPanel npc={NPC} onClose={vi.fn()} />)

    expect(document.activeElement).toBe(screen.getByLabelText('Your message'))
  })

  it('does not offer sending, and says why, because nothing can reply yet', () => {
    render(<ChatPanel npc={NPC} onClose={vi.fn()} />)

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true)
    expect(screen.getByText("Replies aren't available yet.")).toBeTruthy()
  })

  it('can be closed', () => {
    const onClose = vi.fn()
    render(<ChatPanel npc={NPC} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
