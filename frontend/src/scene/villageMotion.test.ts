import { afterEach, describe, expect, it, vi } from 'vitest'
import { VILLAGE_MODELS } from './villageLayout'
import {
  driftedPosition,
  IDLE_BOB_HEIGHT,
  IDLE_BOB_SECONDS,
  idleBobLift,
  idleBobOffset,
  prefersReducedMotion,
  SPINNING_PARTS,
} from './villageMotion'

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

describe('idleBobLift', () => {
  it('starts at rest', () => {
    expect(idleBobLift(0)).toBeCloseTo(0)
  })

  it('is highest halfway through a bob', () => {
    expect(idleBobLift(IDLE_BOB_SECONDS / 2)).toBeCloseTo(IDLE_BOB_HEIGHT)
  })

  it('is back at rest after a full bob', () => {
    expect(idleBobLift(IDLE_BOB_SECONDS)).toBeCloseTo(0)
  })

  it('shifts the bob by the offset', () => {
    expect(idleBobLift(0, IDLE_BOB_SECONDS / 2)).toBeCloseTo(IDLE_BOB_HEIGHT)
  })

  it('never sinks below the ground or rises past the top', () => {
    for (let seconds = 0; seconds < IDLE_BOB_SECONDS * 2; seconds += 0.1) {
      const lift = idleBobLift(seconds, 0.7)

      expect(lift).toBeGreaterThanOrEqual(0)
      expect(lift).toBeLessThanOrEqual(IDLE_BOB_HEIGHT + 1e-9)
    }
  })
})

describe('idleBobOffset', () => {
  it('gives the same offset for the same ID', () => {
    expect(idleBobOffset('npc-one')).toBe(idleBobOffset('npc-one'))
  })

  it('gives different offsets for different IDs', () => {
    expect(idleBobOffset('npc-one')).not.toBe(idleBobOffset('npc-two'))
  })

  it('stays within one bob, even for long or empty IDs', () => {
    for (const npcId of ['', 'a', 'npc-three', 'x'.repeat(500)]) {
      const offset = idleBobOffset(npcId)

      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(IDLE_BOB_SECONDS)
    }
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
