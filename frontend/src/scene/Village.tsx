import { Clone, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type { Group } from 'three'
import {
  buildGroundTiles,
  hexToWorld,
  ISLAND_RADIUS,
  RIVER_TILES,
  ROAD_TILES,
  VILLAGE_MODELS,
  VILLAGE_PIECES,
  type VillageModel,
  type VillagePiece,
} from './villageLayout'
import {
  CLOUD_TRAVEL_LIMIT,
  driftedPosition,
  prefersReducedMotion,
  SPINNING_PARTS,
  type SpinningPart,
} from './villageMotion'

/** One sixth of a full circle, in radians. */
const ONE_TURN = Math.PI / 3

/** Ground tiles never change, so they are worked out once when this file loads. */
const GROUND_TILES = buildGroundTiles(ISLAND_RADIUS, [...ROAD_TILES, ...RIVER_TILES])

/** Return the address of a model file served from the public folder. */
function modelUrl(model: VillageModel): string {
  return `/models/village/${model}.gltf`
}

// Start every download at once, instead of one at a time as each piece first renders.
VILLAGE_MODELS.forEach((model) => useGLTF.preload(modelUrl(model)))

/** Work out where a piece sits in the scene. Output: its position as [x, y, z]. */
function piecePosition(piece: VillagePiece): [x: number, y: number, z: number] {
  const [x, z] = hexToWorld(piece)
  const [offsetX, offsetZ] = piece.offset ?? [0, 0]

  return [x + offsetX, piece.height ?? 0, z + offsetZ]
}

/** Draw one village piece at its place on the grid. */
function StillPiece({ piece, groupRef }: { piece: VillagePiece; groupRef?: React.Ref<Group> }) {
  const { scene } = useGLTF(modelUrl(piece.model))

  // Clone shares the geometry and materials, so repeated models stay cheap.
  return (
    <Clone
      ref={groupRef}
      object={scene}
      castShadow
      receiveShadow
      position={piecePosition(piece)}
      rotation={[0, (piece.turns ?? 0) * ONE_TURN, 0]}
    />
  )
}

/** Draw a piece with one part that turns, such as a windmill's sails. */
function SpinningPiece({ piece, part }: { piece: VillagePiece; part: SpinningPart }) {
  const groupRef = useRef<Group>(null)

  useFrame((_, secondsSinceLastFrame) => {
    const spinningNode = groupRef.current?.getObjectByName(part.nodeName)

    if (spinningNode) {
      spinningNode.rotation[part.axis] += part.radiansPerSecond * secondsSinceLastFrame
    }
  })

  return <StillPiece piece={piece} groupRef={groupRef} />
}

/** Draw a piece that drifts sideways across the sky, such as a cloud. */
function DriftingPiece({ piece, drift }: { piece: VillagePiece; drift: number }) {
  const groupRef = useRef<Group>(null)
  const [startX] = piecePosition(piece)

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.position.x = driftedPosition(
        startX,
        drift,
        clock.elapsedTime,
        CLOUD_TRAVEL_LIMIT,
      )
    }
  })

  return <StillPiece piece={piece} groupRef={groupRef} />
}

/** Choose how to draw a piece, so only pieces that move do work on every frame. */
function VillagePieceModel({ piece, isMotionOn }: { piece: VillagePiece; isMotionOn: boolean }) {
  const spinningPart = SPINNING_PARTS[piece.model]

  if (isMotionOn && spinningPart) {
    return <SpinningPiece piece={piece} part={spinningPart} />
  }

  if (isMotionOn && piece.drift) {
    return <DriftingPiece piece={piece} drift={piece.drift} />
  }

  return <StillPiece piece={piece} />
}

/** The whole village: ground tiles first, then everything standing on them. */
export function Village() {
  // Visitors who ask their device for less motion get a still village.
  const [isMotionOn] = useState(() => !prefersReducedMotion())

  return (
    <group>
      {[...GROUND_TILES, ...VILLAGE_PIECES].map((piece, index) => (
        <VillagePieceModel key={index} piece={piece} isMotionOn={isMotionOn} />
      ))}
    </group>
  )
}
