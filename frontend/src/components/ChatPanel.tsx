import type { Npc } from '../api/npcs'

/**
 * The conversation with one NPC, shown beside the village so it stays visible.
 * Replies need the language model, so sending stays off until that is connected.
 * Input: the NPC being talked to, and what to run when the visitor closes the panel.
 */
export function ChatPanel({ npc, onClose }: { npc: Npc; onClose: () => void }) {
  return (
    <aside className="chat-panel" aria-label={`Conversation with ${npc.display_name}`}>
      <header className="chat-panel-header">
        <h2>{npc.display_name}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <p className="chat-panel-empty">No messages yet.</p>

      <form className="chat-panel-form">
        <label htmlFor="chat-message">Your message</label>
        {/* Focus starts here, so the visitor can type as soon as the panel opens. */}
        <textarea id="chat-message" rows={3} autoFocus />
        <button type="submit" disabled>
          Send
        </button>
        <p className="chat-panel-note">Replies aren't available yet.</p>
      </form>
    </aside>
  )
}
