import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useRef, useState, type RefObject } from 'react'
import type { Group, Mesh } from 'three'
import { useVillageStore } from '../store'
import { PlaceholderBody } from './PlaceholderBody'
import {
  idleBobLift,
  idleBobOffset,
  prefersReducedMotion,
  thinkingPulseScale,
} from './villageMotion'
import {
  facingAngle,
  hexToPoint,
  TURN_SPEED,
  turnToward,
  type GroundPoint,
  type VisitorState,
} from './walking'

/** A press that moves further than this many pixels is a camera drag, not a click. */
const CLICK_MOVEMENT_LIMIT = 4

const BODY_COLOR = '#efe6d8'
const IN_RANGE_COLOR = '#fff6e6'
/** Blue stands out against the yellow-green grass, where warm colors get lost. */
const TALKING_COLOR = '#2563eb'

type NpcPlaceholderProps = {
  point: GroundPoint
  visitor: RefObject<VisitorState>
  isInRange: boolean
  isTalking: boolean
  /** True while this NPC prepares a reply, which makes its marker pulse. */
  isReplying: boolean
  /** Seconds to shift this NPC's idle bob by, so NPCs don't move in step. */
  bobOffsetSeconds: number
  onTalk: () => void
}

/** One neutral stand-in, which reacts when the visitor comes close or starts talking. */
function NpcPlaceholder({
  point,
  visitor,
  isInRange,
  isTalking,
  isReplying,
  bobOffsetSeconds,
  onTalk,
}: NpcPlaceholderProps) {
  const bodyRef = useRef<Group>(null)
  const markerRef = useRef<Mesh>(null)
  // When the current reply began, in scene seconds, so each pulse starts at normal size.
  const replyStartRef = useRef<number | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isMotionOn] = useState(() => !prefersReducedMotion())

  // Distant NPCs cannot be clicked, so they must not look clickable.
  useCursor(isHovered && isInRange)

  /**
   * Bob gently while idle, turn toward the visitor during a conversation, and pulse the
   * marker while a reply is on its way.
   */
  useFrame((state, seconds) => {
    // With reduced motion on, the body stays still on the ground.
    if (isMotionOn && bodyRef.current) {
      bodyRef.current.position.y = idleBobLift(state.clock.elapsedTime, bobOffsetSeconds)
    }

    if (isTalking && bodyRef.current) {
      const towardVisitor = facingAngle(point, visitor.current)
      const largestTurn = isMotionOn ? TURN_SPEED * seconds : Math.PI * 2

      bodyRef.current.rotation.y = turnToward(bodyRef.current.rotation.y, towardVisitor, largestTurn)
    }

    // With reduced motion on, the marker stays still and the chat's thinking note is the cue.
    if (isMotionOn && isReplying && markerRef.current) {
      replyStartRef.current ??= state.clock.elapsedTime
      markerRef.current.scale.setScalar(
        thinkingPulseScale(state.clock.elapsedTime - replyStartRef.current),
      )
    } else if (markerRef.current) {
      replyStartRef.current = null
      markerRef.current.scale.setScalar(1)
    }
  })

  /** Start talking, unless this NPC is out of range or the visitor was dragging the camera. */
  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()

    if (isInRange && event.delta <= CLICK_MOVEMENT_LIMIT) {
      onTalk()
    }
  }

  /** Mark this NPC as hovered, and stop NPCs behind it reacting too. */
  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation()
    setIsHovered(true)
  }

  const showRing = isInRange || isTalking

  return (
    <group
      position={[point.x, 0, point.z]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={() => setIsHovered(false)}
    >
      {/* An invisible, larger target, because the body is small when zoomed out */}
      <mesh visible={false} position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 1]} />
      </mesh>

      <group ref={bodyRef}>
        <PlaceholderBody color={BODY_COLOR} scale={showRing ? 1.15 : 1} />
      </group>

      {showRing && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.4, 32]} />
          <meshBasicMaterial color={isTalking ? TALKING_COLOR : IN_RANGE_COLOR} />
        </mesh>
      )}

      {/* A marker overhead shows who the visitor is talking to */}
      {isTalking && (
        <mesh ref={markerRef} position={[0, 0.95, 0]}>
          <octahedronGeometry args={[0.12]} />
          <meshBasicMaterial color={TALKING_COLOR} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Neutral stand-ins for the NPCs in the shared store. The final looks are not decided yet.
 * Input: visitor holds the live position.
 */
export function NpcPlaceholders({ visitor }: { visitor: RefObject<VisitorState> }) {
  const npcs = useVillageStore((state) => state.npcs)
  const nearbyNpcId = useVillageStore((state) => state.nearbyNpcId)
  const talkingNpcId = useVillageStore((state) => state.talkingNpcId)
  const replyingNpcId = useVillageStore((state) => state.replyingNpcId)
  const startTalking = useVillageStore((state) => state.startTalking)

  return (
    <group>
      {npcs.map((npc) => (
        <NpcPlaceholder
          key={npc.id}
          point={hexToPoint(npc.scene_position)}
          visitor={visitor}
          isInRange={nearbyNpcId === npc.id}
          isTalking={talkingNpcId === npc.id}
          isReplying={replyingNpcId === npc.id}
          bobOffsetSeconds={idleBobOffset(npc.id)}
          onTalk={() => startTalking(npc.id)}
        />
      ))}
    </group>
  )
}
