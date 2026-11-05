import { Canvas } from '@react-three/fiber'
import { Suspense } from 'react'
import { PCFShadowMap } from 'three'
import { NpcPlaceholders } from './NpcPlaceholders'
import { Village } from './Village'
import { VillageCamera } from './VillageCamera'
import { VillageLighting } from './VillageLighting'

const SKY_COLOR = '#f6e0c4'

/**
 * The 3D view of the village.
 * Input: onCameraMove runs when the visitor starts moving the camera.
 */
export function VillageCanvas({ onCameraMove }: { onCameraMove: () => void }) {
  return (
    <Canvas
      shadows={{ type: PCFShadowMap }}
      // Capping the pixel ratio at 2 keeps high-resolution laptops running smoothly.
      dpr={[1, 2]}
      camera={{ position: [10, 11, 14], fov: 40 }}
    >
      <VillageLighting skyColor={SKY_COLOR} />

      {/* The loading overlay outside the canvas shows progress while models download. */}
      <Suspense fallback={null}>
        <Village />
        <NpcPlaceholders />
      </Suspense>

      <VillageCamera onCameraMove={onCameraMove} />
    </Canvas>
  )
}
