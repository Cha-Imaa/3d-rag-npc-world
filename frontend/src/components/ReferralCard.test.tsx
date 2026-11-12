import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReferralCard } from './ReferralCard'

const REASON = 'They keep the boat records.'

afterEach(() => {
  cleanup()
})

describe('ReferralCard', () => {
  it('names the suggested NPC and gives the reason', () => {
    render(<ReferralCard npcName="Second NPC" reason={REASON} onFollow={vi.fn()} />)

    expect(screen.getByText('Suggested: Second NPC')).toBeTruthy()
    expect(screen.getByText(REASON)).toBeTruthy()
  })

  it('follows the referral only when the button is pressed', () => {
    const onFollow = vi.fn()
    render(<ReferralCard npcName="Second NPC" reason={REASON} onFollow={onFollow} />)

    expect(onFollow).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Go to Second NPC' }))

    expect(onFollow).toHaveBeenCalledOnce()
  })

  it('shows a reason with markup as plain text', () => {
    render(<ReferralCard npcName="Second NPC" reason="<b>Ask them</b>" onFollow={vi.fn()} />)

    expect(screen.getByText('<b>Ask them</b>')).toBeTruthy()
  })
})
