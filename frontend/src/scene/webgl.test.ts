import { afterEach, describe, expect, it, vi } from 'vitest'
import { isWebGLAvailable } from './webgl'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isWebGLAvailable', () => {
  it('returns true when the browser provides a WebGL 2 context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as WebGL2RenderingContext,
    )

    expect(isWebGLAvailable()).toBe(true)
  })

  it('returns false when no context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    expect(isWebGLAvailable()).toBe(false)
  })

  it('returns false when asking for a context throws', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(isWebGLAvailable()).toBe(false)
  })
})
