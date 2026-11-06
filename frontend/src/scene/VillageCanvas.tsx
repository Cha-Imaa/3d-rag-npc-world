import { Canvas } from '@react-three/fiber'
import { Suspense, useRef } from 'react'
import { PCFShadowMap } from 'three'
import { NpcPlaceholders } from './NpcPlaceholders'
import { Village } from './Village'
import { VillageCamera } from './VillageCamera'
import { VillageLighting } from './VillageLighting'
import { VisitorCharacter } from './VisitorCharacter'
import {
  facingAngle,
  NPC_POINTS,
  START_CAMERA_POSITION,
  START_POINT,
  type VisitorState,
} from './walking'

const SKY_COLOR = '#f6e0c4'

type VillageCanvasProps = {
  nearbyCharacter: number | null
  talkingCharacter: number | null
  onNearbyCharacterChange: (character: number | null) => void
  onTalk: (character: number) => void
  onFirstWalk: () => void
}

/**
 * The 3D view of the village.
 * Input: the NPC in talking range and the NPC being talked to, plus functions to run when
 * the NPC in range changes, the visitor clicks a nearby NPC, or the visitor first walks.
 */
export function VillageCanvas({
  nearbyCharacter,
  talkingCharacter,
  onNearbyCharacterChange,
  onTalk,
  onFirstWalk,
}: VillageCanvasProps) {
  // The live position lives in a ref because it changes on every frame, too often for React state.
  const visitor = useRef<VisitorState>({
    ...START_POINT,
    height: 0,
    facing: facingAngle(START_POINT, NPC_POINTS[0]),
  })

  /** Change the live position. VisitorCharacter calls this on each frame, never during render. */
  function updateVisitor(changes: Partial<VisitorState>) {
    Object.assign(visitor.current, changes)
  }

  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      // Capping the pixel ratio at 2 keeps high-resolution laptops running smoothly.
      dpr={[1, 2]}
      camera={{ position: START_CAMERA_POSITION, fov: 40 }}
    >
      <VillageLighting skyColor={SKY_COLOR} />

      {/* The loading overlay outside the canvas shows progress while models download. */}
      <Suspense fallback={null}>
        <Village />
        <NpcPlaceholders
          visitor={visitor}
          nearbyCharacter={nearbyCharacter}
          talkingCharacter={talkingCharacter}
          onTalk={onTalk}
        />
        <VisitorCharacter
          visitor={visitor}
          updateVisitor={updateVisitor}
          talkingCharacter={talkingCharacter}
          onFirstWalk={onFirstWalk}
          onNearbyCharacterChange={onNearbyCharacterChange}
        />
      </Suspense>

      <VillageCamera visitor={visitor} talkingCharacter={talkingCharacter} />
    </Canvas>
  )
}
