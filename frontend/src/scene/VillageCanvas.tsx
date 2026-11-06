import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { PCFShadowMap } from 'three'
import { NpcPlaceholders } from './NpcPlaceholders'
import { Village } from './Village'
import { VillageCamera } from './VillageCamera'
import { VillageLighting } from './VillageLighting'

const SKY_COLOR = '#f6e0c4'

type VillageCanvasProps = {
  selectedCharacter: number | null
  onSelectCharacter: (character: number) => void
  onClearSelection: () => void
  onCameraMove: () => void
}

/**
 * The 3D view of the village.
 * Input: the selected character, plus functions to run when the visitor selects a character,
 * clicks away from all characters, or starts moving the camera.
 */
export function VillageCanvas({
  selectedCharacter,
  onSelectCharacter,
  onClearSelection,
  onCameraMove,
}: VillageCanvasProps) {
  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      // Capping the pixel ratio at 2 keeps high-resolution laptops running smoothly.
      dpr={[1, 2]}
      camera={{ position: [14, 16, 20], fov: 40 }}
      onPointerMissed={onClearSelection}
    >
      <VillageLighting skyColor={SKY_COLOR} />

      {/* The loading overlay outside the canvas shows progress while models download. */}
      <Suspense fallback={null}>
        <Village />
        <NpcPlaceholders
          selectedCharacter={selectedCharacter}
          onSelectCharacter={onSelectCharacter}
        />
      </Suspense>

      <VillageCamera onCameraMove={onCameraMove} />
    </Canvas>
  )
}
