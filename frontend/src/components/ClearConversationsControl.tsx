import { useState } from 'react'
import { ChatError } from '../api/chat'

/** Shown if clearing fails for an unexpected reason, so a failure is never silent. */
const FALLBACK_ERROR_MESSAGE = "Your conversations couldn't be cleared. Please try again."

/**
 * Lets the visitor delete their saved conversations with every NPC.
 * It asks first, inside the panel, because a browser pop-up would block the whole page.
 * Input: whether clearing is allowed right now, and the clear itself, which deletes the
 * conversations and fails with an error if the server could not.
 */
export function ClearConversationsControl({
  disabled,
  onClear,
}: {
  disabled: boolean
  onClear: () => Promise<void>
}) {
  const [isConfirming, setIsConfirming] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [hasAskedBefore, setHasAskedBefore] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCleared, setIsCleared] = useState(false)

  /** Show the question, and hide the result of any earlier attempt. */
  function askToConfirm() {
    setIsConfirming(true)
    setErrorMessage(null)
    setIsCleared(false)
  }

  /** Go back to the single button. */
  function stopConfirming() {
    setIsConfirming(false)
    // The button comes back after a question, so it should take the focus back.
    setHasAskedBefore(true)
  }

  /** Clear the conversations, then report how it went. */
  async function confirmClear() {
    setIsClearing(true)

    try {
      await onClear()
      setIsCleared(true)
    } catch (error) {
      setErrorMessage(error instanceof ChatError ? error.message : FALLBACK_ERROR_MESSAGE)
    } finally {
      setIsClearing(false)
      stopConfirming()
    }
  }

  return (
    <div className="clear-conversations">
      {/* Saved history is tied to an ID kept in this browser, not to a login, so say so plainly. */}
      <p className="chat-panel-note">
        Conversations are saved in this browser only. This is not a private account.
      </p>

      {isConfirming ? (
        <>
          <p>Delete your saved conversations with every character?</p>
          <div className="clear-conversations-buttons">
            <button type="button" onClick={confirmClear} disabled={isClearing || disabled}>
              Delete
            </button>
            {/* Focus starts on the safe choice, so a stray Enter deletes nothing. */}
            <button type="button" onClick={stopConfirming} disabled={isClearing} autoFocus>
              Cancel
            </button>
          </div>
        </>
      ) : (
        // autoFocus only acts when the button appears, which here is only after a question.
        <button type="button" onClick={askToConfirm} disabled={disabled} autoFocus={hasAskedBefore}>
          Clear my conversations
        </button>
      )}

      {isClearing && <p className="chat-panel-note">Clearing…</p>}
      {isCleared && <p role="status">Your conversations were cleared.</p>}
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </div>
  )
}
