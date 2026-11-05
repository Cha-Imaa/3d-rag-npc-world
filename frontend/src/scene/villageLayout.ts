/**
 * The village described as plain data: which model sits on which hexagon.
 * Keeping this free of 3D code means it can be read in git and tested without a canvas.
 */

/** A position on the hexagon grid. See hexToWorld for how it maps to the 3D scene. */
export type HexCoordinate = {
  q: number
  r: number
}

/** One model placed in the village. */
export type VillagePiece = HexCoordinate & {
  model: VillageModel
  /** Rotation in sixths of a full circle, because a hexagon has six sides. */
  turns?: number
  /** Distance from the hexagon's center in scene units, for pieces that share a tile. */
  offset?: [x: number, z: number]
  /** Height above the ground, for pieces that float, such as clouds. */
  height?: number
}

/** Every model the village uses. Each name matches a file in public/models/village. */
export const VILLAGE_MODELS = [
  'hex_grass',
  'hex_road_A',
  'building_home_A_red',
  'building_home_B_red',
  'building_tavern_red',
  'building_market_red',
  'building_blacksmith_red',
  'building_church_red',
  'building_windmill_red',
  'building_well_red',
  'trees_A_large',
  'trees_A_medium',
  'trees_B_large',
  'trees_B_medium',
  'rock_single_A',
  'hills_A_trees',
  'cloud_big',
  'cloud_small',
  'barrel',
  'crate_A_big',
  'sack',
  'wheelbarrow',
] as const

export type VillageModel = (typeof VILLAGE_MODELS)[number]

/** How many rings of hexagons surround the center tile. */
export const ISLAND_RADIUS = 3

/** Tiles measure 2 units from one flat side to the opposite flat side. */
const HEX_WIDTH = 2

/** Rows of pointy-top hexagons sit closer together than their width: width * sqrt(3) / 2. */
const HEX_ROW_SPACING = (HEX_WIDTH * Math.sqrt(3)) / 2

/** Road tiles replace the grass on their hexagon. */
export const ROAD_TILES: VillagePiece[] = [
  { model: 'hex_road_A', q: -3, r: 0 },
  { model: 'hex_road_A', q: -2, r: 0 },
  { model: 'hex_road_A', q: -1, r: 0 },
  { model: 'hex_road_A', q: 0, r: 0 },
  { model: 'hex_road_A', q: 1, r: 0 },
  { model: 'hex_road_A', q: 2, r: 0 },
  { model: 'hex_road_A', q: 3, r: 0 },
]

/** Buildings, nature, and props. Each sits on top of a ground tile. */
export const VILLAGE_PIECES: VillagePiece[] = [
  // Buildings along the north side of the road
  { model: 'building_home_A_red', q: -2, r: -1 },
  { model: 'building_tavern_red', q: -1, r: -1 },
  { model: 'building_well_red', q: 0, r: -1 },
  { model: 'building_market_red', q: 1, r: -1 },
  { model: 'building_home_B_red', q: 2, r: -1 },

  // Buildings along the south side of the road
  { model: 'building_home_B_red', q: -2, r: 1, turns: 3 },
  { model: 'building_blacksmith_red', q: -1, r: 1, turns: 3 },
  { model: 'building_church_red', q: 1, r: 1, turns: 3 },
  { model: 'building_home_A_red', q: 2, r: 1, turns: 3 },

  // Outer ring of the village
  { model: 'building_windmill_red', q: 1, r: -2 },
  { model: 'building_home_A_red', q: 0, r: 2, turns: 3 },
  { model: 'trees_A_large', q: -1, r: -2 },
  { model: 'trees_B_medium', q: 0, r: -2 },
  { model: 'rock_single_A', q: 2, r: -2 },
  { model: 'trees_B_large', q: 3, r: -2 },
  { model: 'trees_A_medium', q: 3, r: -1 },
  { model: 'trees_B_medium', q: -3, r: 1 },
  { model: 'hills_A_trees', q: -3, r: 2 },
  { model: 'trees_A_medium', q: -2, r: 2 },
  { model: 'rock_single_A', q: -1, r: 2 },
  { model: 'trees_B_medium', q: 1, r: 2 },

  // Forest along the far edges
  { model: 'trees_B_large', q: 0, r: -3 },
  { model: 'trees_A_large', q: 1, r: -3 },
  { model: 'hills_A_trees', q: 2, r: -3 },
  { model: 'trees_A_medium', q: 3, r: -3 },
  { model: 'trees_A_large', q: -3, r: 3 },
  { model: 'trees_B_large', q: -2, r: 3 },
  { model: 'trees_A_medium', q: -1, r: 3 },
  { model: 'trees_A_large', q: 0, r: 3 },

  // Small props beside the buildings, sharing their tiles
  { model: 'barrel', q: -1, r: -1, offset: [0.7, 0.5] },
  { model: 'crate_A_big', q: 1, r: -1, offset: [-0.7, 0.6] },
  { model: 'sack', q: -1, r: 1, offset: [0.7, -0.5] },
  { model: 'wheelbarrow', q: 2, r: 1, offset: [-0.7, -0.5] },

  // Clouds drifting above the island
  { model: 'cloud_big', q: -2, r: -1, height: 4 },
  { model: 'cloud_small', q: 3, r: -3, height: 3.5 },
]

/**
 * Where the neutral NPC placeholders stand. Which NPC uses which spot is not decided,
 * so this list only holds positions and never refers to a specific NPC.
 */
export const NPC_SPOTS: HexCoordinate[] = [
  { q: -2, r: 0 },
  { q: 0, r: 1 },
  { q: 2, r: 0 },
]

/**
 * Convert a grid position to a position in the 3D scene.
 * Input: a hexagon's q and r. Output: its center as [x, z]. The center tile is at [0, 0].
 */
export function hexToWorld({ q, r }: HexCoordinate): [x: number, z: number] {
  return [HEX_WIDTH * (q + r / 2), HEX_ROW_SPACING * r]
}

/**
 * List every hexagon on the island.
 * Input: the number of rings around the center. Output: all coordinates within that distance.
 */
export function hexesWithinRadius(radius: number): HexCoordinate[] {
  const hexes: HexCoordinate[] = []

  for (let q = -radius; q <= radius; q += 1) {
    // Limiting r this way is what produces a hexagon shape instead of a square.
    const firstRow = Math.max(-radius, -q - radius)
    const lastRow = Math.min(radius, -q + radius)

    for (let r = firstRow; r <= lastRow; r += 1) {
      hexes.push({ q, r })
    }
  }

  return hexes
}

/**
 * Build the island's ground: road tiles where roads run, and grass everywhere else.
 * Input: the island radius and the road tiles. Output: one ground tile per hexagon.
 */
export function buildGroundTiles(radius: number, roads: VillagePiece[]): VillagePiece[] {
  const isRoad = (hex: HexCoordinate) =>
    roads.some((road) => road.q === hex.q && road.r === hex.r)

  const grassTiles = hexesWithinRadius(radius)
    .filter((hex) => !isRoad(hex))
    .map((hex): VillagePiece => ({ ...hex, model: 'hex_grass' }))

  return [...grassTiles, ...roads]
}
