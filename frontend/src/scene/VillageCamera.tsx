import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState, type ComponentRef, type RefObject } from 'react'
import { Vector3 } from 'three'
import { prefersReducedMotion } from './villageMotion'
import {
  closeUpShot,
  NPC_POINTS,
  START_POINT,
  type CameraShot,
  type VisitorState,
} from './walking'

/** The camera looks at this height above the visitor's feet. */
const FOCUS_HEIGHT = 0.4

/** How quickly the camera glides. Higher is faster. */
const GLIDE_RATE = 4

/** A glide back counts as finished when the camera is this close. */
const GLIDE_FINISHED_DISTANCE = 0.02

/** Where the camera first looks: the visitor at the start of the road. */
const START_FOCUS: [x: number, y: number, z: number] = [START_POINT.x, FOCUS_HEIGHT, START_POINT.z]

/** What the camera is doing: following the visitor, in close-up, or gliding back from one. */
type CameraMode = 'following' | 'closeUp' | 'returning'

type VillageCameraProps = {
  visitor: RefObject<VisitorState>
  talkingCharacter: number | null
}

/**
 * The third-person camera. Dragging and zooming work through the orbit controls, whose
 * focus point follows the visitor. While talking, the controls pause for a closer view.
 * Input: visitor holds the live position, and talkingCharacter is the NPC being talked to.
 */
export function VillageCamera({ visitor, talkingCharacter }: VillageCameraProps) {
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const [isMotionOn] = useState(() => !prefersReducedMotion())

  const mode = useRef<CameraMode>('following')
  const shot = useRef<CameraShot | null>(null)
  /** The camera's position relative to its focus before a close-up, to return to afterward. */
  const savedOffset = useRef(new Vector3())

  const focus = useRef(new Vector3())
  const goalPosition = useRef(new Vector3())
  const goalTarget = useRef(new Vector3())

  useFrame(({ camera }, seconds) => {
    const controls = controlsRef.current

    if (!controls) {
      return
    }

    const { x, z, height } = visitor.current
    focus.current.set(x, height + FOCUS_HEIGHT, z)

    // Start a close-up, or leave one, when the conversation starts or ends.
    if (talkingCharacter !== null && mode.current !== 'closeUp') {
      // Coming back mid-glide keeps the offset saved earlier, not the half-finished view.
      if (mode.current === 'following') {
        savedOffset.current.copy(camera.position).sub(controls.target)
      }

      const cameraPoint = { x: camera.position.x, z: camera.position.z }
      shot.current = closeUpShot(visitor.current, NPC_POINTS[talkingCharacter], cameraPoint)
      mode.current = 'closeUp'
    } else if (talkingCharacter === null && mode.current === 'closeUp') {
      mode.current = 'returning'
    }

    // Following moves the camera and its focus together, so the view keeps its angle and zoom.
    if (mode.current === 'following') {
      const movement = goalPosition.current.copy(focus.current).sub(controls.target)
      camera.position.add(movement)
      controls.target.copy(focus.current)
      return
    }

    if (mode.current === 'closeUp' && shot.current) {
      goalPosition.current.set(...shot.current.position)
      goalTarget.current.set(...shot.current.target)
    } else {
      goalPosition.current.copy(focus.current).add(savedOffset.current)
      goalTarget.current.copy(focus.current)
    }

    // Reduced motion jumps straight to the goal. Otherwise each frame covers part of the gap.
    const glideAmount = isMotionOn ? 1 - Math.exp(-GLIDE_RATE * seconds) : 1
    camera.position.lerp(goalPosition.current, glideAmount)
    controls.target.lerp(goalTarget.current, glideAmount)
    camera.lookAt(controls.target)

    const isBackInPlace =
      camera.position.distanceTo(goalPosition.current) < GLIDE_FINISHED_DISTANCE
    if (mode.current === 'returning' && isBackInPlace) {
      mode.current = 'following'
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      target={START_FOCUS}
      enabled={talkingCharacter === null}
      enablePan={false}
      minDistance={2.5}
      maxDistance={16}
      minPolarAngle={0.35}
      maxPolarAngle={1.4}
    />
  )
}
