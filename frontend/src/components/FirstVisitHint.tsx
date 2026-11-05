/**
 * A short tip for first-time visitors.
 * Input: onDismiss runs when the visitor presses the button.
 */
export function FirstVisitHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="first-visit-hint" role="status">
      <p>Drag to look around. Click a character to talk.</p>
      <button type="button" onClick={onDismiss}>
        Got it
      </button>
    </div>
  )
}
