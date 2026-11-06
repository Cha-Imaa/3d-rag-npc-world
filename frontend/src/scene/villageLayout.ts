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
  /** Sideways speed in scene units per second, for pieces that drift, such as clouds. */
  drift?: number
}

/** Every model the village uses. Each name matches a file in public/models/village. */
export const VILLAGE_MODELS = [
  'hex_grass',
  'hex_road_A',
  'hex_river_A',
  'hex_river_crossing_B',
  'building_home_A_red',
  'building_home_B_red',
  'building_tavern_red',
  'building_market_red',
  'building_blacksmith_red',
  'building_church_red',
  'building_windmill_red',
  'building_well_red',
  'building_watermill_red',
  'building_lumbermill_red',
  'building_mine_red',
  'building_tower_A_red',
  'building_stage_A',
  'building_bridge_A',
  'trees_A_large',
  'trees_A_medium',
  'trees_A_small',
  'trees_B_large',
  'trees_B_medium',
  'trees_B_small',
  'rock_single_A',
  'rock_single_C',
  'hills_A_trees',
  'hills_B_trees',
  'mountain_A_grass_trees',
  'mountain_B_grass_trees',
  'cloud_big',
  'cloud_small',
  'barrel',
  'crate_A_big',
  'sack',
  'wheelbarrow',
  'resource_lumber',
  'tent',
  'flag_red',
] as const

export type VillageModel = (typeof VILLAGE_MODELS)[number]

/** How many rings of hexagons surround the center tile. */
export const ISLAND_RADIUS = 5

/** Tiles measure 2 units from one flat side to the opposite flat side. */
const HEX_WIDTH = 2

/** Rows of pointy-top hexagons sit closer together than their width: width * sqrt(3) / 2. */
const HEX_ROW_SPACING = (HEX_WIDTH * Math.sqrt(3)) / 2

/** Road tiles replace the grass on their hexagon. */
export const ROAD_TILES: VillagePiece[] = [
  { model: 'hex_road_A', q: -5, r: 0 },
  { model: 'hex_road_A', q: -4, r: 0 },
  { model: 'hex_road_A', q: -3, r: 0 },
  { model: 'hex_road_A', q: -2, r: 0 },
  { model: 'hex_road_A', q: -1, r: 0 },
  { model: 'hex_road_A', q: 0, r: 0 },
  { model: 'hex_road_A', q: 1, r: 0 },
  { model: 'hex_road_A', q: 2, r: 0 },
  { model: 'hex_road_A', q: 3, r: 0 },
  { model: 'hex_road_A', q: 5, r: 0 },
]

/** River tiles also replace the grass. The river crosses the road at q 4, r 0. */
export const RIVER_TILES: VillagePiece[] = [
  { model: 'hex_river_A', q: 4, r: -5, turns: 2 },
  { model: 'hex_river_A', q: 4, r: -4, turns: 2 },
  { model: 'hex_river_A', q: 4, r: -3, turns: 2 },
  { model: 'hex_river_A', q: 4, r: -2, turns: 2 },
  { model: 'hex_river_A', q: 4, r: -1, turns: 2 },
  { model: 'hex_river_crossing_B', q: 4, r: 0, turns: 2 },
  { model: 'hex_river_A', q: 4, r: 1, turns: 2 },
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

  // Outer ring of the old village center
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
  { model: 'trees_B_large', q: 0, r: -3 },
  { model: 'trees_A_large', q: 1, r: -3 },
  { model: 'hills_A_trees', q: 2, r: -3 },
  { model: 'trees_A_medium', q: 3, r: -3 },
  { model: 'trees_A_large', q: -3, r: 3 },
  { model: 'trees_B_large', q: -2, r: 3 },
  { model: 'trees_A_medium', q: -1, r: 3 },
  { model: 'trees_A_large', q: 0, r: 3 },

  // Lumber camp and houses to the west
  { model: 'building_lumbermill_red', q: -4, r: -1 },
  { model: 'resource_lumber', q: -3, r: -1 },
  { model: 'trees_A_small', q: -3, r: -2 },
  { model: 'building_home_B_red', q: -2, r: -2 },
  { model: 'building_tower_A_red', q: -5, r: 1 },
  { model: 'building_home_B_red', q: -4, r: 1, turns: 3 },

  // Mountains and a mine to the north
  { model: 'mountain_A_grass_trees', q: -1, r: -4 },
  { model: 'mountain_B_grass_trees', q: 0, r: -5 },
  { model: 'mountain_A_grass_trees', q: 1, r: -5 },
  { model: 'mountain_B_grass_trees', q: 2, r: -5 },
  { model: 'hills_B_trees', q: 3, r: -5 },
  { model: 'hills_B_trees', q: -2, r: -3 },
  { model: 'trees_B_large', q: -1, r: -3 },
  { model: 'trees_B_medium', q: 0, r: -4 },
  { model: 'building_mine_red', q: 1, r: -4 },
  { model: 'rock_single_C', q: 2, r: -4 },
  { model: 'trees_A_small', q: 3, r: -4 },

  // Far bank of the river
  { model: 'trees_A_large', q: 5, r: -5 },
  { model: 'hills_B_trees', q: 5, r: -4 },
  { model: 'trees_B_medium', q: 5, r: -3 },
  { model: 'trees_B_small', q: 5, r: -2 },
  { model: 'building_tower_A_red', q: 5, r: -1 },

  // Watermill standing in the river, so its wheel reaches the water
  { model: 'building_watermill_red', q: 4, r: -2 },

  // Bridge carrying the road over the river. 1.5 turns is a quarter circle.
  { model: 'building_bridge_A', q: 4, r: 0, turns: 1.5 },

  // Fairground to the south
  { model: 'building_stage_A', q: 1, r: 3, turns: 3 },
  { model: 'tent', q: 2, r: 2 },
  { model: 'tent', q: 2, r: 3 },
  { model: 'tent', q: 1, r: 4 },
  { model: 'building_home_A_red', q: 3, r: 1, turns: 3 },
  { model: 'trees_B_medium', q: 3, r: 2 },

  // Forest to the south-west
  { model: 'trees_A_large', q: -5, r: 2 },
  { model: 'trees_B_large', q: -5, r: 3 },
  { model: 'trees_A_medium', q: -5, r: 4 },
  { model: 'trees_B_medium', q: -5, r: 5 },
  { model: 'trees_B_small', q: -4, r: 2 },
  { model: 'trees_A_large', q: -4, r: 3 },
  { model: 'hills_A_trees', q: -4, r: 4 },
  { model: 'trees_A_medium', q: -4, r: 5 },
  { model: 'trees_B_large', q: -3, r: 4 },
  { model: 'trees_A_large', q: -3, r: 5 },
  { model: 'trees_A_small', q: -2, r: 4 },
  { model: 'trees_B_medium', q: -2, r: 5 },
  { model: 'rock_single_C', q: -1, r: 4 },
  { model: 'trees_B_large', q: -1, r: 5 },
  { model: 'trees_A_medium', q: 0, r: 4 },
  { model: 'trees_B_small', q: 0, r: 5 },

  // Small props beside the buildings, sharing their tiles
  { model: 'barrel', q: -1, r: -1, offset: [0.7, 0.5] },
  { model: 'crate_A_big', q: 1, r: -1, offset: [-0.7, 0.6] },
  { model: 'sack', q: -1, r: 1, offset: [0.7, -0.5] },
  { model: 'wheelbarrow', q: 2, r: 1, offset: [-0.7, -0.5] },
  { model: 'flag_red', q: 1, r: 3, offset: [0.75, 0.3] },

  // Clouds drifting above the island
  { model: 'cloud_big', q: -2, r: -1, height: 5, drift: 0.35 },
  { model: 'cloud_small', q: 3, r: -3, height: 4.5, drift: 0.5 },
  { model: 'cloud_big', q: 4, r: 1, height: 5.5, drift: 0.3 },
  { model: 'cloud_small', q: -4, r: 3, height: 4, drift: 0.45 },
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
 * Build the island's ground: the given road and river tiles, and grass everywhere else.
 * Input: the island radius and the non-grass tiles. Output: one ground tile per hexagon.
 */
export function buildGroundTiles(radius: number, specialTiles: VillagePiece[]): VillagePiece[] {
  const isSpecial = (hex: HexCoordinate) =>
    specialTiles.some((tile) => tile.q === hex.q && tile.r === hex.r)

  const grassTiles = hexesWithinRadius(radius)
    .filter((hex) => !isSpecial(hex))
    .map((hex): VillagePiece => ({ ...hex, model: 'hex_grass' }))

  return [...grassTiles, ...specialTiles]
}
