import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberHintSeen, shouldShowFirstVisitHint } from './hintStorage'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('first-visit hint storage', () => {
  it('shows the hint on a first visit', () => {
    expect(shouldShowFirstVisitHint()).toBe(true)
  })

  it('hides the hint once it has been seen', () => {
    rememberHintSeen()

    expect(shouldShowFirstVisitHint()).toBe(false)
  })

  it('still works when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)

    expect(() => rememberHintSeen()).not.toThrow()
    expect(shouldShowFirstVisitHint()).toBe(true)
  })
})
