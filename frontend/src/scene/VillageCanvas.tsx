import { Canvas } from '@react-three/fiber'
import { Suspense, useRef } from 'react'
import { PCFShadowMap } from 'three'
import { NpcPlaceholders } from './NpcPlaceholders'
import { Village } from './Village'
import { VillageCamera } from './VillageCamera'
import { VillageLighting } from './VillageLighting'
import { VisitorCharacter } from './VisitorCharacter'
import { facingAngle, START_CAMERA_POSITION, START_POINT, type VisitorState } from './walking'

const SKY_COLOR = '#f6e0c4'

/** The visitor first looks toward the middle of the island. */
const VILLAGE_CENTER = { x: 0, z: 0 }

/**
 * The 3D view of the village. NPC details come from the shared store.
 * Input: a function to run when the visitor first walks.
 */
export function VillageCanvas({ onFirstWalk }: { onFirstWalk: () => void }) {
  // The live position lives in a ref because it changes on every frame, too often for React state.
  const visitor = useRef<VisitorState>({
    ...START_POINT,
    height: 0,
    facing: facingAngle(START_POINT, VILLAGE_CENTER),
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
        <NpcPlaceholders visitor={visitor} />
        <VisitorCharacter
          visitor={visitor}
          updateVisitor={updateVisitor}
          onFirstWalk={onFirstWalk}
        />
      </Suspense>

      <VillageCamera visitor={visitor} />
    </Canvas>
  )
}
