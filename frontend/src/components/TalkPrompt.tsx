/** Tells the visitor they are close enough to start talking to an NPC. */
export function TalkPrompt() {
  return (
    <p className="talk-prompt" role="status">
      Press <kbd>E</kbd> to talk
    </p>
  )
}
