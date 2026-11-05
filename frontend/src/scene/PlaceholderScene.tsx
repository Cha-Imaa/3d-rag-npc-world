import { OrbitControls } from '@react-three/drei'

/** Temporary scene proving 3D rendering works. Milestone 1 replaces it with the village. */
export function PlaceholderScene() {
  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 8, 5]} intensity={2} />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6, 48]} />
        <meshStandardMaterial color="#8fb573" />
      </mesh>

      {/* Stand-in object at the center of the ground */}
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[1.5, 1.5, 1.5]} />
        <meshStandardMaterial color="#d9a066" />
      </mesh>

      {/* Limits keep the camera above the ground and near the scene */}
      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={16}
        maxPolarAngle={Math.PI / 2.2}
      />
    </>
  )
}
