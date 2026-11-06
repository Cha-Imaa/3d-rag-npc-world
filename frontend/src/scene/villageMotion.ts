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

/**
 * Check whether the visitor has asked their device to reduce motion.
 * Output: true if the village should stay still.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
