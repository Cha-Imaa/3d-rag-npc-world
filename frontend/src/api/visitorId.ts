/** Where this browser keeps its visitor ID between visits. */
const VISITOR_ID_KEY = 'loreland.visitorId'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Kept for when storage is blocked, so the ID still holds steady until the page reloads. */
let unsavedVisitorId: string | null = null

/** Read the saved ID. Output: the ID, or null if there is no usable one. */
function readSavedVisitorId(): string | null {
  try {
    const savedId = localStorage.getItem(VISITOR_ID_KEY)

    // The server rejects anything but a UUID, so a damaged value would block every message.
    return savedId !== null && UUID_PATTERN.test(savedId) ? savedId : null
  } catch {
    // Storage can be blocked, for example in private windows.
    return null
  }
}

/** Save the ID for later visits. Input: the visitor ID. */
function saveVisitorId(visitorId: string): void {
  try {
    localStorage.setItem(VISITOR_ID_KEY, visitorId)
  } catch {
    // Without storage, the visitor simply gets a new ID on the next visit.
  }
}

/**
 * Get this browser's anonymous visitor ID, creating one on the first visit.
 * This is a convenience for finding saved conversations, not a secure account.
 *
 * @returns a UUID that stays the same between visits when storage is available.
 */
export function getVisitorId(): string {
  const savedId = readSavedVisitorId()
  if (savedId !== null) {
    return savedId
  }

  unsavedVisitorId ??= crypto.randomUUID()
  saveVisitorId(unsavedVisitorId)

  return unsavedVisitorId
}
