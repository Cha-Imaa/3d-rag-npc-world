import { afterEach, describe, expect, it, vi } from 'vitest'
import { VILLAGE_MODELS } from './villageLayout'
import { driftedPosition, prefersReducedMotion, SPINNING_PARTS } from './villageMotion'

describe('driftedPosition', () => {
  it('moves at the given speed', () => {
    expect(driftedPosition(2, 0.5, 4, 30)).toBeCloseTo(4)
  })

  it('returns on the far side after passing the limit', () => {
    expect(driftedPosition(29, 1, 2, 30)).toBeCloseTo(-29)
  })

  it('loops the other way for a piece moving left', () => {
    expect(driftedPosition(-29, -1, 2, 30)).toBeCloseTo(29)
  })
})

describe('SPINNING_PARTS', () => {
  it('only refers to models the village uses', () => {
    for (const model of Object.keys(SPINNING_PARTS)) {
      expect(VILLAGE_MODELS).toContain(model)
    }
  })
})

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is true when the device asks for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    expect(prefersReducedMotion()).toBe(true)
  })

  it('is false when the browser cannot answer', () => {
    vi.stubGlobal('matchMedia', undefined)

    expect(prefersReducedMotion()).toBe(false)
  })
})
