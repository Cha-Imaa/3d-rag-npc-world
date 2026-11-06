const FACE_COLOR = '#33291f'

/**
 * A neutral stand-in body, shared by the visitor and the NPCs.
 * The small mark on the front shows which way the character faces.
 * Input: the body color, and the size to draw it at.
 */
export function PlaceholderBody({ color, scale = 1 }: { color: string; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh castShadow position={[0, 0.3, 0]}>
        <capsuleGeometry args={[0.15, 0.3, 4, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>

      {/* Models face along positive z when their rotation is 0 */}
      <mesh position={[0, 0.42, 0.14]}>
        <boxGeometry args={[0.14, 0.05, 0.05]} />
        <meshStandardMaterial color={FACE_COLOR} />
      </mesh>
    </group>
  )
}
