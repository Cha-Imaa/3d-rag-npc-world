import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getVisitorId } from './visitorId'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAVED_ID = '6f1c2b1e-3f4a-4c7e-9a51-0d2e8b7c1a90'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('visitor ID', () => {
  it('creates a UUID on the first visit and saves it', () => {
    const visitorId = getVisitorId()

    expect(visitorId).toMatch(UUID_PATTERN)
    expect(localStorage.getItem('loreland.visitorId')).toBe(visitorId)
  })

  it('reuses the saved ID on later visits', () => {
    localStorage.setItem('loreland.visitorId', SAVED_ID)

    expect(getVisitorId()).toBe(SAVED_ID)
  })

  it('replaces a damaged saved value, which the server would reject', () => {
    localStorage.setItem('loreland.visitorId', 'not-a-uuid')

    const visitorId = getVisitorId()

    expect(visitorId).toMatch(UUID_PATTERN)
    expect(localStorage.getItem('loreland.visitorId')).toBe(visitorId)
  })

  it('keeps one ID for the page when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)

    const visitorId = getVisitorId()

    expect(visitorId).toMatch(UUID_PATTERN)
    expect(getVisitorId()).toBe(visitorId)
  })
})
