import { describe, expect, it } from 'vitest'
import { BRIDGE_TILE, hexToWorld, VILLAGE_PIECES, type VillageModel } from './villageLayout'
import {
  BRIDGE_HALF_WIDTH,
  buildFootprints,
  closeUpShot,
  facingAngle,
  groundHeight,
  isSpotFree,
  moveWithSliding,
  nearestNpcInRange,
  NPC_POINTS,
  START_POINT,
  TALKING_RANGE,
  turnToward,
  VILLAGE_FOOTPRINTS,
  walkDirection,
  WALK_SPEED,
  type GroundPoint,
} from './walking'

const [BRIDGE_X, BRIDGE_Z] = hexToWorld(BRIDGE_TILE)

/** Models that are meant to block nothing. */
const MODELS_THAT_BLOCK_NOTHING: VillageModel[] = [
  'cloud_big',
  'cloud_small',
  'building_bridge_A',
  'sack',
  'flag_red',
]

/** Take many small steps in one direction, as the scene does over several frames. */
function walk(from: GroundPoint, direction: GroundPoint, seconds: number): GroundPoint {
  const framesPerSecond = 60
  const step = {
    x: (direction.x * WALK_SPEED) / framesPerSecond,
    z: (direction.z * WALK_SPEED) / framesPerSecond,
  }
  let position = from

  for (let frame = 0; frame < seconds * framesPerSecond; frame += 1) {
    position = moveWithSliding(position, step)
  }

  return position
}

/**
 * Walk the free space outward from the start, in a fine grid.
 * Output: every grid point the visitor can reach.
 */
function findReachablePoints(): GroundPoint[] {
  const gridSpacing = 0.1
  const visited = new Set<string>()
  const reachable: GroundPoint[] = []
  const waiting: [column: number, row: number][] = [[0, 0]]

  const pointAt = (column: number, row: number): GroundPoint => ({
    x: START_POINT.x + column * gridSpacing,
    z: START_POINT.z + row * gridSpacing,
  })

  while (waiting.length > 0) {
    const [column, row] = waiting.pop()!
    const key = `${column},${row}`

    if (!visited.has(key) && isSpotFree(pointAt(column, row))) {
      visited.add(key)
      reachable.push(pointAt(column, row))
      waiting.push([column + 1, row], [column - 1, row], [column, row + 1], [column, row - 1])
    }
  }

  return reachable
}

describe('footprints', () => {
  it('gives every placed model a footprint unless it is meant to block nothing', () => {
    const solidPieces = VILLAGE_PIECES.filter(
      (piece) => !MODELS_THAT_BLOCK_NOTHING.includes(piece.model),
    )

    expect(buildFootprints(VILLAGE_PIECES, [])).toHaveLength(solidPieces.length)
  })

  it('includes each NPC', () => {
    expect(buildFootprints([], NPC_POINTS)).toHaveLength(NPC_POINTS.length)
  })
})

describe('where the visitor may stand', () => {
  it('starts on a free spot', () => {
    expect(isSpotFree(START_POINT)).toBe(true)
  })

  it('blocks buildings, NPCs, the river, and the sea', () => {
    const [tavernX, tavernZ] = hexToWorld({ q: -1, r: -1 })
    const [riverX, riverZ] = hexToWorld({ q: 4, r: -1 })

    expect(isSpotFree({ x: tavernX, z: tavernZ })).toBe(false)
    expect(isSpotFree(NPC_POINTS[0])).toBe(false)
    expect(isSpotFree({ x: riverX, z: riverZ })).toBe(false)
    expect(isSpotFree({ x: -30, z: 0 })).toBe(false)
  })

  it('allows only the deck on the bridge tile', () => {
    expect(isSpotFree({ x: BRIDGE_X, z: BRIDGE_Z })).toBe(true)
    expect(isSpotFree({ x: BRIDGE_X, z: BRIDGE_Z + BRIDGE_HALF_WIDTH + 0.05 })).toBe(false)
  })
})

describe('moveWithSliding', () => {
  it('moves freely on open ground', () => {
    expect(moveWithSliding(START_POINT, { x: 0.1, z: 0 })).toEqual({
      x: START_POINT.x + 0.1,
      z: START_POINT.z,
    })
  })

  it('walks around a circle that is slightly off to one side', () => {
    const obstacle = { x: 0, z: 0, radius: 0.5 }
    const footprints = [obstacle]
    let position = { x: -2, z: 0.1 }

    for (let frame = 0; frame < 100; frame += 1) {
      position = moveWithSliding(position, { x: 0.04, z: 0 }, footprints)
    }

    expect(position.x).toBeGreaterThan(0.5)
  })

  it('slides along the riverbank instead of stopping', () => {
    // The bank runs at an angle here, so walking diagonally into it keeps some movement.
    const start = { x: 6.2, z: -0.5 }
    const end = walk(start, { x: 0.7, z: -0.7 }, 2)

    expect(isSpotFree(start)).toBe(true)
    expect(isSpotFree(end)).toBe(true)
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(0.3)
  })

  it('stops at the riverbank beside the bridge', () => {
    const end = walk({ x: BRIDGE_X - 1.5, z: 0.4 }, { x: 1, z: 0 }, 3)

    expect(end.x).toBeLessThan(BRIDGE_X - 1)
  })

  it('stops at the edge of the island', () => {
    const end = walk(START_POINT, { x: -1, z: 0 }, 5)

    expect(end.x).toBeLessThan(START_POINT.x)
    expect(isSpotFree(end)).toBe(true)
  })

  it('crosses the bridge by walking straight along the road', () => {
    const end = walk({ x: BRIDGE_X - 2, z: 0 }, { x: 1, z: 0 }, 2)

    expect(end.x).toBeGreaterThan(BRIDGE_X + 1)
  })
})

describe('reachability', () => {
  const reachable = findReachablePoints()

  it.each(NPC_POINTS.map((npc, index) => [index, npc] as const))(
    'can walk within talking range of NPC %i',
    (_, npc) => {
      const canReach = reachable.some(
        (point) => Math.hypot(point.x - npc.x, point.z - npc.z) <= TALKING_RANGE,
      )

      expect(canReach).toBe(true)
    },
  )

  it('can reach the far side of the bridge', () => {
    expect(reachable.some((point) => point.x > BRIDGE_X + 1.2)).toBe(true)
  })

  it('leaves a solid piece reachable only from outside it', () => {
    const insideFootprint = reachable.some((point) =>
      VILLAGE_FOOTPRINTS.some(
        (footprint) => Math.hypot(point.x - footprint.x, point.z - footprint.z) < footprint.radius,
      ),
    )

    expect(insideFootprint).toBe(false)
  })
})

describe('groundHeight', () => {
  it('is flat away from the bridge', () => {
    expect(groundHeight(START_POINT)).toBe(0)
  })

  it('rises from the end of the deck to its middle', () => {
    const atEnd = groundHeight({ x: BRIDGE_X - 1, z: 0 })
    const partWay = groundHeight({ x: BRIDGE_X - 0.7, z: 0 })
    const atMiddle = groundHeight({ x: BRIDGE_X, z: 0 })

    expect(atEnd).toBe(0)
    expect(partWay).toBeGreaterThan(0)
    expect(partWay).toBeLessThan(atMiddle)
    expect(atMiddle).toBeCloseTo(0.23)
  })
})

describe('walkDirection', () => {
  const cameraFacingNorth = { x: 0, z: -1 }

  it('stands still with no keys held', () => {
    expect(walkDirection(new Set(), cameraFacingNorth)).toBeNull()
  })

  it('stands still when opposite keys cancel out', () => {
    expect(walkDirection(new Set(['KeyW', 'KeyS']), cameraFacingNorth)).toBeNull()
  })

  it('walks the way the camera faces', () => {
    const direction = walkDirection(new Set(['KeyW']), { x: 3, z: 4 })

    expect(direction?.x).toBeCloseTo(0.6)
    expect(direction?.z).toBeCloseTo(0.8)
  })

  it('treats arrow keys the same as WASD', () => {
    const fromLetter = walkDirection(new Set(['KeyD']), cameraFacingNorth)
    const fromArrow = walkDirection(new Set(['ArrowRight']), cameraFacingNorth)

    expect(fromArrow).toEqual(fromLetter)
    expect(fromArrow?.x).toBeCloseTo(1)
  })

  it('moves at the same speed diagonally', () => {
    const direction = walkDirection(new Set(['KeyW', 'KeyD']), cameraFacingNorth)

    expect(Math.hypot(direction!.x, direction!.z)).toBeCloseTo(1)
  })
})

describe('turning', () => {
  it('faces along positive z at angle 0', () => {
    expect(facingAngle({ x: 0, z: 0 }, { x: 0, z: 5 })).toBe(0)
  })

  it('stops exactly on the target once close enough', () => {
    expect(turnToward(1, 1.05, 0.1)).toBe(1.05)
  })

  it('takes the short way around the circle', () => {
    const justPastHalfTurn = 3
    const turned = turnToward(justPastHalfTurn, -justPastHalfTurn, 0.1)

    expect(turned).toBeCloseTo(justPastHalfTurn + 0.1)
  })
})

describe('nearestNpcInRange', () => {
  const npcs = [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
  ]

  it('finds nobody when all NPCs are out of range', () => {
    expect(nearestNpcInRange({ x: -5, z: 0 }, npcs)).toBeNull()
  })

  it('picks the closer of two NPCs in range', () => {
    expect(nearestNpcInRange({ x: 1.2, z: 0 }, npcs)).toBe(1)
  })
})

describe('closeUpShot', () => {
  const visitor = { x: 0, z: 0 }
  const npc = { x: 1, z: 0 }

  it('stands behind the visitor and looks between the two characters', () => {
    const shot = closeUpShot(visitor, npc, { x: -5, z: 3 })

    expect(shot.position[0]).toBeLessThan(visitor.x)
    expect(shot.target[0]).toBeCloseTo(0.5)
  })

  it('stays on the side the camera is already on', () => {
    expect(closeUpShot(visitor, npc, { x: -5, z: 3 }).position[2]).toBeGreaterThan(0)
    expect(closeUpShot(visitor, npc, { x: -5, z: -3 }).position[2]).toBeLessThan(0)
  })
})
