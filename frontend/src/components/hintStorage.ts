/** Renamed when walking arrived, so browsers that dismissed the old hint see the new one. */
const HINT_SEEN_KEY = 'loreland.walkingHintSeen'

/**
 * Decide whether to show the first-visit hint.
 * Output: true unless this browser has already dismissed it.
 */
export function shouldShowFirstVisitHint(): boolean {
  try {
    return localStorage.getItem(HINT_SEEN_KEY) === null
  } catch {
    // Storage can be blocked, for example in private windows. Showing the hint is harmless.
    return true
  }
}

/** Remember that the visitor has seen the hint, so later visits skip it. */
export function rememberHintSeen(): void {
  try {
    localStorage.setItem(HINT_SEEN_KEY, 'true')
  } catch {
    // Without storage, the hint simply appears again on the next visit.
  }
}
