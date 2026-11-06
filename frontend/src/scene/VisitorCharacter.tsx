import { useFrame } from '@react-three/fiber'
import { useRef, useState, type RefObject } from 'react'
import { Vector3, type Group } from 'three'
import { PlaceholderBody } from './PlaceholderBody'
import { prefersReducedMotion } from './villageMotion'
import {
  facingAngle,
  groundHeight,
  moveWithSliding,
  nearestNpcInRange,
  NPC_POINTS,
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
  talkingCharacter: number | null
  onFirstWalk: () => void
  onNearbyCharacterChange: (character: number | null) => void
}

/**
 * The small character the visitor controls.
 * Input: visitor holds the live position, shared with the camera and NPCs, and updateVisitor
 * changes it. talkingCharacter stops walking while set. onFirstWalk runs once, on the first
 * step. onNearbyCharacterChange runs when a different NPC comes into talking range.
 */
export function VisitorCharacter({
  visitor,
  updateVisitor,
  talkingCharacter,
  onFirstWalk,
  onNearbyCharacterChange,
}: VisitorCharacterProps) {
  const groupRef = useRef<Group>(null)
  const heldKeys = useHeldKeys()
  const [isMotionOn] = useState(() => !prefersReducedMotion())

  const hasWalked = useRef(false)
  const lastNearbyCharacter = useRef<number | null>(null)
  const targetFacing = useRef(visitor.current.facing)
  const cameraDirection = useRef(new Vector3())

  /** Take one step in the direction the keys point, if any are held. */
  function walkOneStep(cameraForward: Vector3, seconds: number) {
    const direction = walkDirection(heldKeys.current, { x: cameraForward.x, z: cameraForward.z })

    if (!direction) {
      return
    }

    const distance = WALK_SPEED * seconds
    const step = { x: direction.x * distance, z: direction.z * distance }

    updateVisitor(moveWithSliding(visitor.current, step))
    targetFacing.current = facingAngle({ x: 0, z: 0 }, direction)

    if (!hasWalked.current) {
      hasWalked.current = true
      onFirstWalk()
    }
  }

  /** Tell the app when the NPC in talking range changes. */
  function reportNearbyCharacter() {
    const nearbyCharacter = nearestNpcInRange(visitor.current)

    if (nearbyCharacter !== lastNearbyCharacter.current) {
      lastNearbyCharacter.current = nearbyCharacter
      onNearbyCharacterChange(nearbyCharacter)
    }
  }

  useFrame(({ camera }, frameSeconds) => {
    const seconds = Math.min(frameSeconds, LONGEST_STEP_SECONDS)

    if (talkingCharacter === null) {
      camera.getWorldDirection(cameraDirection.current)
      walkOneStep(cameraDirection.current, seconds)
      reportNearbyCharacter()
    } else {
      targetFacing.current = facingAngle(visitor.current, NPC_POINTS[talkingCharacter])
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
