import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Vector3, type Group } from 'three'
import { selectTalkingNpc, useVillageStore } from '../store'
import { PlaceholderBody } from './PlaceholderBody'
import { VILLAGE_PIECES } from './villageLayout'
import { prefersReducedMotion } from './villageMotion'
import {
  buildFootprints,
  facingAngle,
  groundHeight,
  hexToPoint,
  isWithinTalkingRange,
  moveWithSliding,
  nearestNpcInRange,
  spotBesideNpc,
  TURN_SPEED,
  turnToward,
  walkDirection,
  WALK_SPEED,
  type VisitorState,
} from './walking'
import { useHeldKeys } from './walkingKeys'

const BODY_COLOR = '#5b6b7a'

/** A slow frame counts as this long at most, so a stutter cannot jump the visitor through walls. */
const LONGEST_STEP_SECONDS = 0.05

type VisitorCharacterProps = {
  visitor: RefObject<VisitorState>
  updateVisitor: (changes: Partial<VisitorState>) => void
  onFirstWalk: () => void
}

/**
 * The small character the visitor controls.
 * Input: visitor holds the live position, shared with the camera and NPCs, and updateVisitor
 * changes it. onFirstWalk runs once, on the first step. Walking stops during a conversation,
 * and following a referral moves the visitor beside the suggested NPC.
 */
export function VisitorCharacter({
  visitor,
  updateVisitor,
  onFirstWalk,
}: VisitorCharacterProps) {
  const npcs = useVillageStore((state) => state.npcs)
  const talkingNpc = useVillageStore(selectTalkingNpc)
  const setNearbyNpc = useVillageStore((state) => state.setNearbyNpc)

  // NPCs arrive from the backend after the scene starts, so these are rebuilt when they do.
  const npcPoints = useMemo(() => npcs.map((npc) => hexToPoint(npc.scene_position)), [npcs])
  const footprints = useMemo(() => buildFootprints(VILLAGE_PIECES, npcPoints), [npcPoints])

  const groupRef = useRef<Group>(null)
  const heldKeys = useHeldKeys()
  const [isMotionOn] = useState(() => !prefersReducedMotion())

  const hasWalked = useRef(false)
  const lastNearbyNpcId = useRef<string | null>(null)
  const targetFacing = useRef(visitor.current.facing)
  const cameraDirection = useRef(new Vector3())

  // Put the visitor beside the NPC they are talking to, if they are out of its range.
  // Talking normally starts in range, so this only moves them after following a referral.
  // A layout effect runs before the next frame is drawn, so the camera's close-up already
  // sees the new spot. If every spot around the NPC is blocked, they stay where they are.
  useLayoutEffect(() => {
    if (!talkingNpc) {
      return
    }

    const npcPoint = hexToPoint(talkingNpc.scene_position)

    if (isWithinTalkingRange(visitor.current, npcPoint)) {
      return
    }

    const spot = spotBesideNpc(npcPoint, visitor.current, footprints)

    if (spot) {
      updateVisitor(spot)
    }
  }, [talkingNpc, footprints, visitor, updateVisitor])

  /** Take one step in the direction the keys point, if any are held. */
  function walkOneStep(cameraForward: Vector3, seconds: number) {
    const direction = walkDirection(heldKeys.current, { x: cameraForward.x, z: cameraForward.z })

    if (!direction) {
      return
    }

    const distance = WALK_SPEED * seconds
    const step = { x: direction.x * distance, z: direction.z * distance }

    updateVisitor(moveWithSliding(visitor.current, step, footprints))
    targetFacing.current = facingAngle({ x: 0, z: 0 }, direction)

    if (!hasWalked.current) {
      hasWalked.current = true
      onFirstWalk()
    }
  }

  /** Tell the app when the NPC in talking range changes. */
  function reportNearbyNpc() {
    const nearbyIndex = nearestNpcInRange(visitor.current, npcPoints)
    const nearbyNpcId = nearbyIndex === null ? null : npcs[nearbyIndex].id

    if (nearbyNpcId !== lastNearbyNpcId.current) {
      lastNearbyNpcId.current = nearbyNpcId
      setNearbyNpc(nearbyNpcId)
    }
  }

  useFrame(({ camera }, frameSeconds) => {
    const seconds = Math.min(frameSeconds, LONGEST_STEP_SECONDS)

    if (talkingNpc) {
      targetFacing.current = facingAngle(visitor.current, hexToPoint(talkingNpc.scene_position))
    } else {
      camera.getWorldDirection(cameraDirection.current)
      walkOneStep(cameraDirection.current, seconds)
      reportNearbyNpc()
    }

    updateVisitor({
      height: groundHeight(visitor.current),
      facing: isMotionOn
        ? turnToward(visitor.current.facing, targetFacing.current, TURN_SPEED * seconds)
        : targetFacing.current,
    })

    groupRef.current?.position.set(visitor.current.x, visitor.current.height, visitor.current.z)
    groupRef.current?.rotation.set(0, visitor.current.facing, 0)
  })

  return (
    <group ref={groupRef}>
      <PlaceholderBody color={BODY_COLOR} />
    </group>
  )
}
