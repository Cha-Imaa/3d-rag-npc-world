/**
 * A short tip for first-time visitors.
 * Input: onDismiss runs when the visitor presses the button.
 */
export function FirstVisitHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="first-visit-hint" role="status">
      <p>Use WASD or the arrow keys to walk. Drag to look around.</p>
      <button type="button" onClick={onDismiss}>
        Got it
      </button>
    </div>
  )
}
