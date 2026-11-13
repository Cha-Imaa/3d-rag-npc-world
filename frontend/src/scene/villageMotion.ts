/**
 * The village's gentle movement, described as plain data and small calculations.
 * Keeping this free of 3D code means it can be tested without a canvas.
 */
import type { VillageModel } from './villageLayout'

/** A named part inside a model that turns on the spot. */
export type SpinningPart = {
  /** The part's name inside the model file. */
  nodeName: string
  axis: 'x' | 'y' | 'z'
  radiansPerSecond: number
}

/** Models with a part that turns. Each model file keeps that part separate. */
export const SPINNING_PARTS: Partial<Record<VillageModel, SpinningPart>> = {
  building_windmill_red: {
    nodeName: 'building_windmill_top_fan_red',
    axis: 'z',
    radiansPerSecond: 0.6,
  },
  building_watermill_red: {
    nodeName: 'building_watermill_wheel_red',
    axis: 'z',
    radiansPerSecond: -0.8,
  },
  building_lumbermill_red: {
    nodeName: 'building_lumbermill_saw_red',
    axis: 'x',
    radiansPerSecond: 1.5,
  },
}

/** Clouds leave the view at this distance from the center, then return on the far side. */
export const CLOUD_TRAVEL_LIMIT = 34

/**
 * Work out where a drifting piece is after some time, looping back when it passes the limit.
 * Input: its start position, speed, elapsed seconds, and the limit.
 * Output: a position between -limit and limit.
 */
export function driftedPosition(
  start: number,
  speed: number,
  elapsedSeconds: number,
  limit: number,
): number {
  const fullTrip = limit * 2
  const distanceFromLeftEdge = start + speed * elapsedSeconds + limit

  // The second remainder keeps the answer positive when the piece moves left.
  return (((distanceFromLeftEdge % fullTrip) + fullTrip) % fullTrip) - limit
}

/** How high an idle NPC rises at the top of its bob, in world units. Small, so it reads as breathing. */
export const IDLE_BOB_HEIGHT = 0.03

/** Seconds for one full rise and fall. */
export const IDLE_BOB_SECONDS = 2.4

/**
 * Work out how far an idle NPC is lifted at a moment in time.
 * The lift never goes below zero, so the body never sinks into the ground.
 * Input: elapsed seconds, and an offset in seconds so NPCs need not move together.
 * Output: a lift between 0 and IDLE_BOB_HEIGHT.
 */
export function idleBobLift(elapsedSeconds: number, offsetSeconds = 0): number {
  const angle = ((elapsedSeconds + offsetSeconds) / IDLE_BOB_SECONDS) * Math.PI * 2

  // (1 - cos) / 2 runs smoothly from 0 up to 1 and back, starting at rest.
  return (IDLE_BOB_HEIGHT * (1 - Math.cos(angle))) / 2
}

/**
 * Pick a steady bob offset for an NPC from its ID, so NPCs don't all bob in step.
 * The same ID always gives the same offset, so the motion doesn't jump between visits.
 * Input: the NPC's ID.
 * Output: an offset in seconds, from 0 up to (not including) IDLE_BOB_SECONDS.
 */
export function idleBobOffset(npcId: string): number {
  // A simple string hash. ">>> 0" keeps it a positive whole number.
  let hash = 0
  for (const character of npcId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  // Spread the hash over 1000 steps of one bob.
  return ((hash % 1000) / 1000) * IDLE_BOB_SECONDS
}

/**
 * Check whether the visitor has asked their device to reduce motion.
 * Output: true if the village should stay still.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
