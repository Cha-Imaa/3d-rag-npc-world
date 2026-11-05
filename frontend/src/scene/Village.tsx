import { Clone, useGLTF } from '@react-three/drei'
import {
  buildGroundTiles,
  hexToWorld,
  ISLAND_RADIUS,
  ROAD_TILES,
  VILLAGE_MODELS,
  VILLAGE_PIECES,
  type VillageModel,
  type VillagePiece,
} from './villageLayout'

/** One sixth of a full circle, in radians. */
const ONE_TURN = Math.PI / 3

/** Ground tiles never change, so they are worked out once when this file loads. */
const GROUND_TILES = buildGroundTiles(ISLAND_RADIUS, ROAD_TILES)

/** Return the address of a model file served from the public folder. */
function modelUrl(model: VillageModel): string {
  return `/models/village/${model}.gltf`
}

// Start every download at once, instead of one at a time as each piece first renders.
VILLAGE_MODELS.forEach((model) => useGLTF.preload(modelUrl(model)))

/** Draw one village piece at its place on the grid. */
function VillagePieceModel({ piece }: { piece: VillagePiece }) {
  const { scene } = useGLTF(modelUrl(piece.model))
  const [x, z] = hexToWorld(piece)
  const [offsetX, offsetZ] = piece.offset ?? [0, 0]

  // Clone shares the geometry and materials, so repeated models stay cheap.
  return (
    <Clone
      object={scene}
      castShadow
      receiveShadow
      position={[x + offsetX, piece.height ?? 0, z + offsetZ]}
      rotation={[0, (piece.turns ?? 0) * ONE_TURN, 0]}
    />
  )
}

/** The whole village: ground tiles first, then everything standing on them. */
export function Village() {
  return (
    <group>
      {[...GROUND_TILES, ...VILLAGE_PIECES].map((piece, index) => (
        <VillagePieceModel key={index} piece={piece} />
      ))}
    </group>
  )
}
