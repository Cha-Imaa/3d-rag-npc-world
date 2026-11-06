import { useProgress } from '@react-three/drei'

/** Show download progress until every village model has loaded. */
export function SceneLoadingOverlay() {
  const { active, progress } = useProgress()

  if (!active && progress >= 100) {
    return null
  }

  return (
    <div className="scene-loading" role="status">
      Loading the village… {Math.round(progress)}%
    </div>
  )
}
