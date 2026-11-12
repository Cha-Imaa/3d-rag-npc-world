/**
 * A suggestion to talk to another NPC, shown under the reply that made it.
 * Nothing happens until the visitor presses the button, and pressing it never sends a
 * message, so the visitor stays in control of who they talk to.
 * Input: the suggested NPC's name, the reason for the suggestion, and what to run on press.
 */
export function ReferralCard({
  npcName,
  reason,
  onFollow,
}: {
  npcName: string
  reason: string
  onFollow: () => void
}) {
  return (
    <div className="referral-card">
      <span className="referral-card-heading">Suggested: {npcName}</span>
      {/* Plain text, never HTML, because the reason comes from the model. */}
      <p>{reason}</p>
      <button type="button" onClick={onFollow}>
        Go to {npcName}
      </button>
    </div>
  )
}
