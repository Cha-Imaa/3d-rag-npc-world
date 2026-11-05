import { describe, expect, it } from 'vitest'
import {
  buildGroundTiles,
  hexesWithinRadius,
  hexToWorld,
  ISLAND_RADIUS,
  NPC_SPOTS,
  ROAD_TILES,
  VILLAGE_PIECES,
  type HexCoordinate,
} from './villageLayout'

/** Turn a coordinate into text, so hexagons can be compared and counted. */
const hexKey = ({ q, r }: HexCoordinate) => `${q},${r}`

describe('hexToWorld', () => {
  it('places the center tile at the origin', () => {
    expect(hexToWorld({ q: 0, r: 0 })).toEqual([0, 0])
  })

  it('places all six neighbors exactly one tile width away', () => {
    const neighbors = [
      { q: 1, r: 0 },
      { q: -1, r: 0 },
      { q: 0, r: 1 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
      { q: -1, r: 1 },
    ]

    for (const neighbor of neighbors) {
      const [x, z] = hexToWorld(neighbor)
      expect(Math.hypot(x, z)).toBeCloseTo(2)
    }
  })
})

describe('hexesWithinRadius', () => {
  it('returns the expected number of unique hexagons', () => {
    const hexes = hexesWithinRadius(3)

    expect(hexes).toHaveLength(37)
    expect(new Set(hexes.map(hexKey)).size).toBe(37)
  })
})

describe('buildGroundTiles', () => {
  it('gives every hexagon exactly one ground tile', () => {
    const tiles = buildGroundTiles(ISLAND_RADIUS, ROAD_TILES)
    const expectedCount = hexesWithinRadius(ISLAND_RADIUS).length

    expect(tiles).toHaveLength(expectedCount)
    expect(new Set(tiles.map(hexKey)).size).toBe(expectedCount)
  })
})

describe('village layout', () => {
  const islandHexes = new Set(hexesWithinRadius(ISLAND_RADIUS).map(hexKey))

  it('keeps every road, piece, and NPC spot on the island', () => {
    for (const hex of [...ROAD_TILES, ...VILLAGE_PIECES, ...NPC_SPOTS]) {
      expect(islandHexes.has(hexKey(hex))).toBe(true)
    }
  })

  it('never places two ground-level pieces in the same spot', () => {
    // Props use an offset and clouds use a height, so they may share a tile.
    const groundPieces = VILLAGE_PIECES.filter((piece) => !piece.offset && !piece.height)

    expect(new Set(groundPieces.map(hexKey)).size).toBe(groundPieces.length)
  })

  it('keeps NPC spots clear of buildings and scenery', () => {
    const occupied = new Set(VILLAGE_PIECES.filter((piece) => !piece.height).map(hexKey))

    for (const spot of NPC_SPOTS) {
      expect(occupied.has(hexKey(spot))).toBe(false)
    }
  })
})
