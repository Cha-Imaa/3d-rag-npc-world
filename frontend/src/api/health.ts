/**
 * Check whether the backend is reachable.
 *
 * @returns true if the health endpoint answers successfully, otherwise false.
 */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const response = await fetch('/api/health')
    return response.ok
  } catch {
    // A network failure means the backend is offline, so it is not an app error.
    return false
  }
}
