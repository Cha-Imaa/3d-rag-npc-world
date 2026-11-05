/**
 * Check whether this browser can draw the 3D scene.
 * Output: true if WebGL 2 is available, which current versions of three.js require.
 */
export function isWebGLAvailable(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}
