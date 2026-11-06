/** Keyboard input for walking and talking. */
import { useEffect, useRef, type RefObject } from 'react'

/**
 * Check whether a key press belongs to a text field, such as the chat box.
 * Input: the element that received the key. Output: true if the game should ignore the key.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable === true
  )
}

/**
 * Keep track of which keys are held down.
 * Output: a ref to the held key codes, read on every frame. A ref avoids re-rendering on each key.
 */
export function useHeldKeys(): RefObject<Set<string>> {
  const heldKeys = useRef(new Set<string>())

  useEffect(() => {
    const keys = heldKeys.current

    function handleKeyDown(event: KeyboardEvent) {
      // Shortcuts such as Ctrl+S are for the browser, and their key release can go missing.
      const isShortcut = event.ctrlKey || event.metaKey || event.altKey

      if (!isShortcut && !isTypingTarget(event.target)) {
        keys.add(event.code)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      keys.delete(event.code)
    }

    /** Switching windows hides the key release, so without this the visitor keeps walking. */
    function releaseAllKeys() {
      keys.clear()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseAllKeys)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseAllKeys)
    }
  }, [])

  return heldKeys
}

type TalkingKeysOptions = {
  nearbyNpcId: string | null
  onTalk: (npcId: string) => void
  onStopTalking: () => void
}

/**
 * Start talking with E and stop with Escape.
 * Input: the NPC in talking range, and what to run for each key.
 */
export function useTalkingKeys({ nearbyNpcId, onTalk, onStopTalking }: TalkingKeysOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === 'Escape') {
        onStopTalking()
        return
      }

      const isTalkKey = event.code === 'KeyE' && !event.repeat

      if (isTalkKey && nearbyNpcId !== null && !isTypingTarget(event.target)) {
        // The chat box takes focus straight away, and would otherwise receive this letter e.
        event.preventDefault()
        onTalk(nearbyNpcId)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nearbyNpcId, onTalk, onStopTalking])
}
