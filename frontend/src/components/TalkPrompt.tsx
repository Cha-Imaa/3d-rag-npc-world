/** Tells the visitor they are close enough to talk, and to whom. */
export function TalkPrompt({ npcName }: { npcName: string }) {
  return (
    <p className="talk-prompt" role="status">
      Press <kbd>E</kbd> to talk to {npcName}
    </p>
  )
}
