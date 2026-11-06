import type { NpcListStatus } from '../store'

type NpcListNoticeProps = {
  status: NpcListStatus
  npcCount: number
  onRetry: () => void
}

/**
 * Explains why nobody is in the village while the NPC list is loading, failed, or empty.
 * The visitor can keep walking in all three cases.
 * Input: the list's status and size, and what to run when the visitor asks to try again.
 */
export function NpcListNotice({ status, npcCount, onRetry }: NpcListNoticeProps) {
  if (status === 'loading') {
    return (
      <p className="npc-list-notice" role="status">
        Looking for villagers...
      </p>
    )
  }

  if (status === 'failed') {
    return (
      <div className="npc-list-notice" role="alert">
        <p>The villagers couldn't be loaded, so there is nobody to talk to right now.</p>
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    )
  }

  if (npcCount === 0) {
    return (
      <p className="npc-list-notice" role="status">
        Nobody lives in the village yet.
      </p>
    )
  }

  return null
}
