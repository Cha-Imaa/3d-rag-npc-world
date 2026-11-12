/**
 * The rules of walking: where the visitor may stand, how they move, and who they can talk to.
 * Keeping this free of 3D code means every rule can be tested without a canvas.
 * All sizes and speeds are starting values, to be tuned by hand.
 */
import {
  BRIDGE_TILE,
  hexToWorld,
  ISLAND_RADIUS,
  isOnIsland,
  RIVER_TILES,
  worldToHex,
  type HexCoordinate,
  type VillageModel,
  type VillagePiece,
} from './villageLayout'

/** A position on the ground, in scene units. */
export type GroundPoint = {
  x: number
  z: number
}

/** A solid circle on the ground that the visitor cannot enter. */
export type Footprint = GroundPoint & {
  radius: number
}

/** Where the visitor is right now. The scene updates this on every frame. */
export type VisitorState = GroundPoint & {
  /** Height of the visitor's feet above the ground. */
  height: number
  /** The way the visitor faces, in radians. See facingAngle. */
  facing: number
}

/** Where the camera stands, and the point it looks at, as [x, y, z]. */
export type CameraShot = {
  position: [x: number, y: number, z: number]
  target: [x: number, y: number, z: number]
}

export const WALK_SPEED = 2.5
export const TURN_SPEED = 10

/** How far the visitor's body reaches from their center. */
export const CHARACTER_RADIUS = 0.15

/** How far an NPC's body reaches from its center. */
export const NPC_RADIUS = 0.2

/** How close the visitor must stand to talk to an NPC. */
export const TALKING_RANGE = 1.1

/** How far from an NPC's center a referral puts the visitor: clear of it, in talking range. */
const ARRIVAL_DISTANCE = 0.6

/** How many spots around an NPC are tried when looking for somewhere free to arrive. */
const ARRIVAL_DIRECTIONS = 16

/** Half the width of the bridge deck, measured from the model. */
export const BRIDGE_HALF_WIDTH = 0.19

/** Height of the flat middle of the bridge deck, measured from the model. */
const BRIDGE_DECK_HEIGHT = 0.23

/** How far the deck reaches from the bridge's center, and where its flat middle ends. */
const BRIDGE_HALF_LENGTH = 1
const BRIDGE_FLAT_HALF_LENGTH = 0.4

/** Keys that walk in each direction, by physical position so other keyboard layouts work. */
const FORWARD_KEYS = ['KeyW', 'ArrowUp']
const BACK_KEYS = ['KeyS', 'ArrowDown']
const LEFT_KEYS = ['KeyA', 'ArrowLeft']
const RIGHT_KEYS = ['KeyD', 'ArrowRight']

/**
 * How far each model reaches from its center: half the longer side of its measured box.
 * The box's far corners stick out past this circle, because using them instead would
 * leave invisible walls along the flat sides of wide buildings.
 * Clouds, the bridge, sacks, and flags are left out, so they block nothing.
 */
const PIECE_RADII: Partial<Record<VillageModel, number>> = {
  building_home_A_red: 0.47,
  building_home_B_red: 0.56,
  building_tavern_red: 0.7,
  building_market_red: 0.9,
  building_blacksmith_red: 0.67,
  building_church_red: 0.6,
  building_windmill_red: 0.57,
  building_well_red: 0.38,
  building_watermill_red: 0.82,
  building_lumbermill_red: 0.68,
  building_mine_red: 1,
  building_tower_A_red: 0.56,
  building_stage_A: 0.57,
  trees_A_large: 0.98,
  trees_A_medium: 0.94,
  trees_A_small: 0.76,
  trees_B_large: 0.99,
  trees_B_medium: 0.97,
  trees_B_small: 0.69,
  rock_single_A: 0.11,
  rock_single_C: 0.14,
  hills_A_trees: 0.89,
  hills_B_trees: 0.81,
  mountain_A_grass_trees: 0.94,
  mountain_B_grass_trees: 0.94,
  barrel: 0.1,
  crate_A_big: 0.11,
  wheelbarrow: 0.29,
  resource_lumber: 0.34,
  tent: 0.26,
}

/** Convert a grid position to a ground point. */
export function hexToPoint(hex: HexCoordinate): GroundPoint {
  const [x, z] = hexToWorld(hex)
  return { x, z }
}

/** Turn a coordinate into text, so hexagons can be looked up in a set. */
const hexKey = ({ q, r }: HexCoordinate) => `${q},${r}`

const BRIDGE_CENTER = hexToPoint(BRIDGE_TILE)

/** River tiles block the whole tile. The bridge tile has its own rule, in isSpotOnGround. */
const BLOCKED_WATER_TILES = new Set(
  RIVER_TILES.map(hexKey).filter((key) => key !== hexKey(BRIDGE_TILE)),
)

/** The visitor starts on the road near the west end, with the village ahead of them. */
export const START_POINT: GroundPoint = hexToPoint({ q: -4, r: 0 })

/** The first view is from behind the visitor, facing east along the road. */
export const START_CAMERA_POSITION: [x: number, y: number, z: number] = [
  START_POINT.x - 6,
  4.5,
  START_POINT.z + 2,
]

/**
 * Build the list of solid circles.
 * Input: the village pieces and where NPCs stand. Output: one footprint for each solid thing.
 */
export function buildFootprints(pieces: VillagePiece[], npcPoints: GroundPoint[]): Footprint[] {
  const pieceFootprints: Footprint[] = []

  for (const piece of pieces) {
    const radius = PIECE_RADII[piece.model]

    if (radius !== undefined) {
      const center = hexToPoint(piece)
      const [offsetX, offsetZ] = piece.offset ?? [0, 0]
      pieceFootprints.push({ x: center.x + offsetX, z: center.z + offsetZ, radius })
    }
  }

  const npcFootprints = npcPoints.map((point) => ({ ...point, radius: NPC_RADIUS }))

  return [...pieceFootprints, ...npcFootprints]
}

/** Check that a point is on the island and not on a river tile. */
function isDryLand(point: GroundPoint): boolean {
  const hex = worldToHex(point.x, point.z)

  return isOnIsland(hex, ISLAND_RADIUS) && !BLOCKED_WATER_TILES.has(hexKey(hex))
}

/** List points around the visitor's body, so it stops at an edge instead of hanging over it. */
function pointsAroundBody({ x, z }: GroundPoint): GroundPoint[] {
  const pointCount = 8

  return Array.from({ length: pointCount }, (_, index) => {
    const angle = (index / pointCount) * Math.PI * 2

    return {
      x: x + Math.cos(angle) * CHARACTER_RADIUS,
      z: z + Math.sin(angle) * CHARACTER_RADIUS,
    }
  })
}

/**
 * Check the ground rules: stay on the island, stay out of the river, and stay on the bridge deck.
 * Input: where the visitor's center would be. Output: true if the ground allows it.
 */
function isSpotOnGround(point: GroundPoint): boolean {
  const isOnBridgeTile = hexKey(worldToHex(point.x, point.z)) === hexKey(BRIDGE_TILE)

  // The deck is barely wider than the visitor, so on the bridge only their center is tested.
  // Testing their whole body would leave almost no room to step onto it.
  if (isOnBridgeTile && Math.abs(point.z - BRIDGE_CENTER.z) > BRIDGE_HALF_WIDTH) {
    return false
  }

  return isDryLand(point) && pointsAroundBody(point).every(isDryLand)
}

/** Check that the visitor's body would not overlap a footprint. */
function isClearOfFootprints(point: GroundPoint, footprints: Footprint[]): boolean {
  return footprints.every(
    (footprint) =>
      Math.hypot(point.x - footprint.x, point.z - footprint.z) >=
      footprint.radius + CHARACTER_RADIUS,
  )
}

/**
 * Check whether the visitor may stand somewhere.
 * Input: where their center would be, and the solid circles. Output: true if the spot is free.
 */
export function isSpotFree(point: GroundPoint, footprints: Footprint[]): boolean {
  return isSpotOnGround(point) && isClearOfFootprints(point, footprints)
}

/**
 * Move a point to the edge of any footprint it overlaps.
 * Walking into a circle then becomes walking around it, which is what makes the visitor slide.
 */
function pushOutOfFootprints(point: GroundPoint, footprints: Footprint[]): GroundPoint {
  // The small extra distance stops rounding errors leaving the point just inside the circle.
  const extraDistance = 0.001
  let pushed = point

  for (const footprint of footprints) {
    const awayX = pushed.x - footprint.x
    const awayZ = pushed.z - footprint.z
    const distance = Math.hypot(awayX, awayZ)
    const limit = footprint.radius + CHARACTER_RADIUS

    if (distance < limit && distance > 0) {
      const scale = (limit + extraDistance) / distance
      pushed = { x: footprint.x + awayX * scale, z: footprint.z + awayZ * scale }
    }
  }

  return pushed
}

/**
 * Move the visitor one step, sliding along anything in the way.
 * Footprints push the visitor around them. For straight edges such as the riverbank,
 * the east-west and north-south parts of the step are then tried separately.
 * Input: the start, the step to take, and the solid circles. Output: where the visitor ends up.
 */
export function moveWithSliding(
  from: GroundPoint,
  step: GroundPoint,
  footprints: Footprint[],
): GroundPoint {
  const attempts: GroundPoint[] = [
    { x: from.x + step.x, z: from.z + step.z },
    { x: from.x + step.x, z: from.z },
    { x: from.x, z: from.z + step.z },
  ]

  for (const attempt of attempts) {
    const pushed = pushOutOfFootprints(attempt, footprints)

    if (isSpotFree(pushed, footprints)) {
      return pushed
    }
  }

  return from
}

/**
 * Find how high the ground is at a point. Everything is flat except the bridge deck.
 * Output: 0 on the ground, rising along a smooth curve to the deck's height on the bridge.
 */
export function groundHeight(point: GroundPoint): number {
  const isOnDeck =
    Math.abs(point.x - BRIDGE_CENTER.x) < BRIDGE_HALF_LENGTH &&
    Math.abs(point.z - BRIDGE_CENTER.z) <= BRIDGE_HALF_WIDTH

  if (!isOnDeck) {
    return 0
  }

  const distanceFromEnd = BRIDGE_HALF_LENGTH - Math.abs(point.x - BRIDGE_CENTER.x)
  const rampLength = BRIDGE_HALF_LENGTH - BRIDGE_FLAT_HALF_LENGTH
  const rampProgress = Math.min(distanceFromEnd / rampLength, 1)

  // This smoothstep curve starts and ends gently, like the deck's own shape.
  return BRIDGE_DECK_HEIGHT * rampProgress * rampProgress * (3 - 2 * rampProgress)
}

/** Scale a direction to length 1. */
function toUnitLength({ x, z }: GroundPoint): GroundPoint {
  const length = Math.hypot(x, z)

  return length === 0 ? { x: 0, z: 0 } : { x: x / length, z: z / length }
}

/** Return 1 if any of the keys is held, otherwise 0. */
function heldAmount(heldKeys: ReadonlySet<string>, keys: string[]): number {
  return keys.some((key) => heldKeys.has(key)) ? 1 : 0
}

/**
 * Turn held keys into a walking direction, relative to the way the camera faces.
 * Input: the held key codes, and the camera's direction along the ground.
 * Output: a direction of length 1, or null when the visitor should stand still.
 */
export function walkDirection(
  heldKeys: ReadonlySet<string>,
  cameraForward: GroundPoint,
): GroundPoint | null {
  const forwardAmount = heldAmount(heldKeys, FORWARD_KEYS) - heldAmount(heldKeys, BACK_KEYS)
  const rightAmount = heldAmount(heldKeys, RIGHT_KEYS) - heldAmount(heldKeys, LEFT_KEYS)

  if (forwardAmount === 0 && rightAmount === 0) {
    return null
  }

  const forward = toUnitLength(cameraForward)
  const right = { x: -forward.z, z: forward.x }

  return toUnitLength({
    x: forward.x * forwardAmount + right.x * rightAmount,
    z: forward.z * forwardAmount + right.z * rightAmount,
  })
}

/**
 * Work out the rotation that makes a character at one point face another point.
 * Output: radians around the vertical axis, where 0 faces along positive z.
 */
export function facingAngle(from: GroundPoint, to: GroundPoint): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

/**
 * Turn from one angle toward another, the short way around.
 * Input: both angles, and the largest turn allowed. Output: the new angle.
 */
export function turnToward(current: number, target: number, largestTurn: number): number {
  const fullCircle = Math.PI * 2
  const rawDifference = (target - current) % fullCircle

  // Wrapping into -pi to pi picks the shorter direction around the circle.
  const difference = ((rawDifference + Math.PI * 3) % fullCircle) - Math.PI

  if (Math.abs(difference) <= largestTurn) {
    return target
  }

  return current + Math.sign(difference) * largestTurn
}

/**
 * Find the NPC the visitor can talk to.
 * Input: the visitor's position, and where NPCs stand.
 * Output: the position in the list of the nearest NPC within talking range, or null for none.
 */
export function nearestNpcInRange(
  visitor: GroundPoint,
  npcPoints: GroundPoint[],
): number | null {
  let nearestNpc: number | null = null
  let nearestDistance = TALKING_RANGE

  npcPoints.forEach((npc, index) => {
    const distance = Math.hypot(visitor.x - npc.x, visitor.z - npc.z)

    if (distance <= nearestDistance) {
      nearestNpc = index
      nearestDistance = distance
    }
  })

  return nearestNpc
}

/**
 * Check whether the visitor stands close enough to talk to one NPC.
 * Input: the visitor's position and the NPC's. Output: true if within talking range.
 */
export function isWithinTalkingRange(visitor: GroundPoint, npc: GroundPoint): boolean {
  return Math.hypot(visitor.x - npc.x, visitor.z - npc.z) <= TALKING_RANGE
}

/**
 * Find where to put a visitor who followed a referral: a free spot beside the NPC.
 * Spots in a ring around the NPC are tried, and the free one nearest the visitor wins,
 * so they arrive on the side they came from. No path is needed, because they jump there.
 * Input: where the NPC stands, where the visitor is now, and the solid circles.
 * Output: the spot, or null if every spot around the NPC is blocked.
 */
export function spotBesideNpc(
  npc: GroundPoint,
  visitor: GroundPoint,
  footprints: Footprint[],
): GroundPoint | null {
  const ring = Array.from({ length: ARRIVAL_DIRECTIONS }, (_, index) => {
    const angle = (index / ARRIVAL_DIRECTIONS) * Math.PI * 2

    return {
      x: npc.x + Math.cos(angle) * ARRIVAL_DISTANCE,
      z: npc.z + Math.sin(angle) * ARRIVAL_DISTANCE,
    }
  })
  const freeSpots = ring.filter((spot) => isSpotFree(spot, footprints))

  let nearestSpot: GroundPoint | null = null
  let nearestDistance = Infinity

  for (const spot of freeSpots) {
    const distance = Math.hypot(spot.x - visitor.x, spot.z - visitor.z)

    if (distance < nearestDistance) {
      nearestSpot = spot
      nearestDistance = distance
    }
  }

  return nearestSpot
}

/**
 * Plan the closer camera view used while talking: over the visitor's shoulder, facing the NPC.
 * Input: the visitor, the NPC, and the camera's current position.
 * Output: where to put the camera and what to look at.
 */
export function closeUpShot(
  visitor: GroundPoint,
  npc: GroundPoint,
  cameraPoint: GroundPoint,
): CameraShot {
  const distanceBehindVisitor = 2.2
  const distanceToTheSide = 1
  const cameraHeight = 1.2
  const lookHeight = 0.4

  const towardNpc = toUnitLength({ x: npc.x - visitor.x, z: npc.z - visitor.z })
  const sideways = { x: -towardNpc.z, z: towardNpc.x }

  // Stay on the side the camera is already on, so it never swings across the characters.
  const cameraSide =
    (cameraPoint.x - visitor.x) * sideways.x + (cameraPoint.z - visitor.z) * sideways.z
  const side = cameraSide >= 0 ? 1 : -1

  return {
    position: [
      visitor.x - towardNpc.x * distanceBehindVisitor + sideways.x * side * distanceToTheSide,
      cameraHeight,
      visitor.z - towardNpc.z * distanceBehindVisitor + sideways.z * side * distanceToTheSide,
    ],
    target: [(visitor.x + npc.x) / 2, lookHeight, (visitor.z + npc.z) / 2],
  }
}
