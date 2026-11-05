import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneErrorBoundary } from './SceneErrorBoundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Stands in for a 3D scene that fails while starting. */
function BrokenScene(): never {
  throw new Error('model failed to load')
}

describe('SceneErrorBoundary', () => {
  it('shows its children when nothing fails', () => {
    render(
      <SceneErrorBoundary>
        <p>village</p>
      </SceneErrorBoundary>,
    )

    expect(screen.getByText('village')).toBeTruthy()
  })

  it('shows a plain-language message when the scene fails', () => {
    // React logs caught errors, which would only add noise to the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <SceneErrorBoundary>
        <BrokenScene />
      </SceneErrorBoundary>,
    )

    expect(screen.getByRole('alert').textContent).toContain('The village could not load')
  })
})
