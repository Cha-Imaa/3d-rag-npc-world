import { hexToWorld, NPC_SPOTS } from './villageLayout'

/** Neutral stand-ins for NPCs. The final characters and their looks are not decided yet. */
export function NpcPlaceholders() {
  return (
    <group>
      {NPC_SPOTS.map((spot) => {
        const [x, z] = hexToWorld(spot)

        return (
          <mesh key={`${spot.q},${spot.r}`} castShadow position={[x, 0.3, z]}>
            <capsuleGeometry args={[0.15, 0.3, 4, 12]} />
            <meshStandardMaterial color="#efe6d8" />
          </mesh>
        )
      })}
    </group>
  )
}
