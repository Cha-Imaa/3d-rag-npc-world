/**
 * Confirms which placeholder character the visitor is talking to, until the real chat panel exists.
 * Input: characterNumber is the number to show, and onClose runs when the visitor closes it.
 */
export function SelectedCharacterCard({
  characterNumber,
  onClose,
}: {
  characterNumber: number
  onClose: () => void
}) {
  return (
    <div className="selected-character" role="status">
      <div>
        <h2>Character {characterNumber}</h2>
        <p>Chat isn't available yet.</p>
      </div>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
