import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ChatError, sendChatMessage } from '../api/chat'
import type { Npc } from '../api/npcs'

/** The server refuses longer messages, so the panel stops them before sending. */
const MAX_MESSAGE_CHARACTERS = 2000

/** Shown if something unexpected fails, so a failure is never silent. */
const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Please try again.'

type ChatMessage = {
  speaker: 'visitor' | 'npc'
  text: string
}

/**
 * Count characters the way the server does, so both agree on the limit.
 * Input: the text. Output: its length, counting an emoji as one character.
 */
function countCharacters(text: string): number {
  return Array.from(text).length
}

/**
 * The conversation with one NPC, shown beside the village so it stays visible.
 * Messages live here until conversations are saved, so closing the panel clears them.
 * Input: the NPC being talked to, and what to run when the visitor closes the panel.
 */
export function ChatPanel({ npc, onClose }: { npc: Npc; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isWaitingForReply, setIsWaitingForReply] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const messageListRef = useRef<HTMLDivElement>(null)
  const messageBoxRef = useRef<HTMLTextAreaElement>(null)

  const message = draft.trim()
  const isTooLong = countCharacters(message) > MAX_MESSAGE_CHARACTERS
  const canSend = message !== '' && !isTooLong && !isWaitingForReply

  // Keep the newest message and the thinking note in view.
  useEffect(() => {
    const messageList = messageListRef.current

    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight
    }
  }, [messages, isWaitingForReply])

  /** Add one message to the end of the conversation. */
  function addMessage(speaker: ChatMessage['speaker'], text: string) {
    setMessages((currentMessages) => [...currentMessages, { speaker, text }])
  }

  /** Send the draft, then show the reply, or the reason there isn't one. */
  async function sendDraft() {
    if (!canSend) {
      return
    }

    addMessage('visitor', message)
    setDraft('')
    setSendError(null)
    setIsWaitingForReply(true)
    // Clicking Send moves focus to a button that is about to turn off, so bring it back.
    messageBoxRef.current?.focus()

    try {
      const reply = await sendChatMessage(npc.id, message)
      addMessage('npc', reply.answer)
    } catch (error) {
      setSendError(error instanceof ChatError ? error.message : FALLBACK_ERROR_MESSAGE)
    } finally {
      setIsWaitingForReply(false)
    }
  }

  /** Send from the Send button. */
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    sendDraft()
  }

  /** Send with Enter. Shift+Enter starts a new line, and Enter also confirms accented text. */
  function handleMessageBoxKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      sendDraft()
    }
  }

  return (
    <aside className="chat-panel" aria-label={`Conversation with ${npc.display_name}`}>
      <header className="chat-panel-header">
        <h2>{npc.display_name}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      {/* A log is read out as it grows. The tab stop lets keyboard users scroll it. */}
      <div
        className="chat-panel-messages"
        ref={messageListRef}
        role="log"
        aria-label="Messages"
        tabIndex={0}
      >
        {messages.length === 0 && <p className="chat-panel-note">No messages yet.</p>}

        {/* Messages are only ever added to the end, so their position is a stable key. */}
        {messages.map((chatMessage, index) => (
          <div key={index} className={`chat-message chat-message-${chatMessage.speaker}`}>
            <span className="chat-message-speaker">
              {chatMessage.speaker === 'visitor' ? 'You' : npc.display_name}
            </span>
            <p>{chatMessage.text}</p>
          </div>
        ))}

        {isWaitingForReply && <p className="chat-panel-note">{npc.display_name} is thinking…</p>}
      </div>

      {sendError && (
        <p className="chat-panel-error" role="alert">
          {sendError}
        </p>
      )}

      <form className="chat-panel-form" onSubmit={handleSubmit}>
        <label htmlFor="chat-message">Your message</label>
        {/* Focus starts here, so the visitor can type as soon as the panel opens. */}
        <textarea
          id="chat-message"
          ref={messageBoxRef}
          rows={3}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleMessageBoxKeyDown}
        />
        {isTooLong && (
          <p className="chat-panel-note">
            Messages can be up to {MAX_MESSAGE_CHARACTERS.toLocaleString('en-US')} characters.
          </p>
        )}
        <button type="submit" disabled={!canSend}>
          Send
        </button>
      </form>
    </aside>
  )
}
