import { Component, type ReactNode } from 'react'
import { SceneFallback } from './SceneFallback'

type SceneErrorBoundaryProps = { children: ReactNode }
type SceneErrorBoundaryState = { hasFailed: boolean }

/**
 * Catch failures while starting the 3D scene, such as a model that will not download,
 * so the visitor sees an explanation instead of a blank page.
 * React only supports this through a class component.
 */
export class SceneErrorBoundary extends Component<
  SceneErrorBoundaryProps,
  SceneErrorBoundaryState
> {
  state: SceneErrorBoundaryState = { hasFailed: false }

  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasFailed: true }
  }

  render() {
    if (this.state.hasFailed) {
      return (
        <SceneFallback
          title="The village could not load"
          message="Something went wrong while loading the 3D scene. Refresh the page to try again."
        />
      )
    }

    return this.props.children
  }
}
