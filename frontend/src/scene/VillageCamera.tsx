import { OrbitControls } from '@react-three/drei'

/**
 * Orbit and zoom controls. The limits keep the village in view and the camera above ground.
 * Input: onCameraMove runs when the visitor starts dragging or zooming.
 */
export function VillageCamera({ onCameraMove }: { onCameraMove: () => void }) {
  return (
    <OrbitControls
      enablePan={false}
      minDistance={7}
      maxDistance={26}
      minPolarAngle={0.35}
      maxPolarAngle={1.3}
      onStart={onCameraMove}
    />
  )
}
