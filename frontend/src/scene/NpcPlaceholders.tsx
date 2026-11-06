import { useCursor } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useRef, useState, type RefObject } from 'react'
import type { Group } from 'three'
import { useVillageStore } from '../store'
import { PlaceholderBody } from './PlaceholderBody'
import { prefersReducedMotion } from './villageMotion'
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
  onTalk: () => void
}

/** One neutral stand-in, which reacts when the visitor comes close or starts talking. */
function NpcPlaceholder({ point, visitor, isInRange, isTalking, onTalk }: NpcPlaceholderProps) {
  const bodyRef = useRef<Group>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [isMotionOn] = useState(() => !prefersReducedMotion())

  // Distant NPCs cannot be clicked, so they must not look clickable.
  useCursor(isHovered && isInRange)

  /** Turn toward the visitor during a conversation. */
  useFrame((_, seconds) => {
    if (isTalking && bodyRef.current) {
      const towardVisitor = facingAngle(point, visitor.current)
      const largestTurn = isMotionOn ? TURN_SPEED * seconds : Math.PI * 2

      bodyRef.current.rotation.y = turnToward(bodyRef.current.rotation.y, towardVisitor, largestTurn)
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
        <mesh position={[0, 0.95, 0]}>
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
          onTalk={() => startTalking(npc.id)}
        />
      ))}
    </group>
  )
}
