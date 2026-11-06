import { useCursor } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useState } from 'react'
import { hexToWorld, NPC_SPOTS } from './villageLayout'

/** A press that moves further than this many pixels is a camera drag, not a click. */
const CLICK_MOVEMENT_LIMIT = 4

const BODY_COLOR = '#efe6d8'
const HOVER_COLOR = '#fff6e6'
/** Blue stands out against the yellow-green grass, where warm colors get lost. */
const SELECTED_COLOR = '#2563eb'

type NpcPlaceholderProps = {
  position: [x: number, y: number, z: number]
  isSelected: boolean
  onSelect: () => void
}

/** One neutral stand-in that reacts to the pointer. */
function NpcPlaceholder({ position, isSelected, onSelect }: NpcPlaceholderProps) {
  const [isHovered, setIsHovered] = useState(false)
  useCursor(isHovered)

  /** Select this character, unless the visitor was dragging the camera. */
  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()

    if (event.delta <= CLICK_MOVEMENT_LIMIT) {
      onSelect()
    }
  }

  /** Mark this character as hovered, and stop characters behind it reacting too. */
  function handlePointerOver(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation()
    setIsHovered(true)
  }

  const showRing = isHovered || isSelected

  return (
    <group
      position={position}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={() => setIsHovered(false)}
    >
      {/* An invisible, larger target, because the body is small when zoomed out */}
      <mesh visible={false} position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.5, 0.5, 1]} />
      </mesh>

      <mesh castShadow position={[0, 0.3, 0]} scale={showRing ? 1.15 : 1}>
        <capsuleGeometry args={[0.15, 0.3, 4, 12]} />
        <meshStandardMaterial color={BODY_COLOR} />
      </mesh>

      {showRing && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.4, 32]} />
          <meshBasicMaterial color={isSelected ? SELECTED_COLOR : HOVER_COLOR} />
        </mesh>
      )}

      {/* A marker overhead keeps the selected character easy to find from far away */}
      {isSelected && (
        <mesh position={[0, 0.95, 0]}>
          <octahedronGeometry args={[0.12]} />
          <meshBasicMaterial color={SELECTED_COLOR} />
        </mesh>
      )}
    </group>
  )
}

type NpcPlaceholdersProps = {
  selectedCharacter: number | null
  onSelectCharacter: (character: number) => void
}

/**
 * Neutral stand-ins for NPCs. The final characters and their looks are not decided yet.
 * Input: selectedCharacter is the selected spot's position in NPC_SPOTS, or null for none.
 * onSelectCharacter runs with that position when a character is clicked.
 */
export function NpcPlaceholders({ selectedCharacter, onSelectCharacter }: NpcPlaceholdersProps) {
  return (
    <group>
      {NPC_SPOTS.map((spot, character) => {
        const [x, z] = hexToWorld(spot)

        return (
          <NpcPlaceholder
            key={`${spot.q},${spot.r}`}
            position={[x, 0, z]}
            isSelected={selectedCharacter === character}
            onSelect={() => onSelectCharacter(character)}
          />
        )
      })}
    </group>
  )
}
