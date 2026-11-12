import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  ChatError,
  clearConversations,
  loadConversation,
  sendChatMessage,
  type Citation,
  type Referral,
  type SavedMessage,
} from '../api/chat'
import type { Npc } from '../api/npcs'
import { CitationList } from './CitationList'
import { ClearConversationsControl } from './ClearConversationsControl'

/** The server refuses longer messages, so the panel stops them before sending. */
const MAX_MESSAGE_CHARACTERS = 2000

/** Shown if something unexpected fails, so a failure is never silent. */
const FALLBACK_ERROR_MESSAGE = 'Something went wrong. Please try again.'

/** Shown when the saved conversation can't be loaded. Chatting still works meanwhile. */
const HISTORY_ERROR_MESSAGE =
  "Earlier messages couldn't be loaded. Close and reopen this chat to try again."

type ChatMessage = {
  speaker: 'visitor' | 'npc'
  text: string
  /** The sources an NPC's answer relied on. Always empty for the visitor's messages. */
  citations: Citation[]
  /** Another NPC the answer suggested. Always null for the visitor's messages. */
  referral: Referral | null
}

/** A message that got no reply, and the plain reason to show the visitor. */
type FailedSend = {
  message: string
  reason: string
}

/**
 * Turn a message saved on the server into the form the panel shows.
 * Input: the saved message. Output: the same message, with the panel's field names.
 */
function toPanelMessage(saved: SavedMessage): ChatMessage {
  return {
    speaker: saved.role,
    text: saved.content,
    citations: saved.citations,
    referral: saved.referral,
  }
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
 * The saved conversation loads when the panel opens, so the visitor can carry on from it.
 * Input: the NPC being talked to, and what to run when the visitor closes the panel.
 */
export function ChatPanel({ npc, onClose }: { npc: Npc; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isWaitingForReply, setIsWaitingForReply] = useState(false)
  const [failedSend, setFailedSend] = useState<FailedSend | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [historyFailed, setHistoryFailed] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const messageListRef = useRef<HTMLDivElement>(null)
  const messageBoxRef = useRef<HTMLTextAreaElement>(null)

  const message = draft.trim()
  const isTooLong = countCharacters(message) > MAX_MESSAGE_CHARACTERS
  // Sending waits for the saved messages, so the restored list can't replace a new message,
  // and for a clear, so a new message can't be deleted while it is still on screen.
  const canSend =
    message !== '' && !isTooLong && !isWaitingForReply && !isLoadingHistory && !isClearing
  // Clearing waits for a reply, which the server would save after the clear.
  const canClear = !isWaitingForReply && !isLoadingHistory

  // Load the saved conversation once, when the panel opens.
  useEffect(() => {
    // Ignore a result that arrives after the panel closed, so it can't update a closed panel.
    let isPanelOpen = true

    loadConversation(npc.id)
      .then((savedMessages) => {
        if (isPanelOpen) {
          setMessages(savedMessages.map(toPanelMessage))
        }
      })
      .catch(() => {
        if (isPanelOpen) {
          setHistoryFailed(true)
        }
      })
      .finally(() => {
        if (isPanelOpen) {
          setIsLoadingHistory(false)
        }
      })

    return () => {
      isPanelOpen = false
    }
  }, [npc.id])

  // Keep the newest message and the thinking note in view.
  useEffect(() => {
    const messageList = messageListRef.current

    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight
    }
  }, [messages, isWaitingForReply])

  /** Add one message, and any sources and referral it has, to the end of the conversation. */
  function addMessage(
    speaker: ChatMessage['speaker'],
    text: string,
    citations: Citation[] = [],
    referral: Referral | null = null,
  ) {
    setMessages((currentMessages) => [...currentMessages, { speaker, text, citations, referral }])
  }

  /**
   * Ask the NPC to reply, then show the reply, or the reason there isn't one.
   * Input: the visitor's message, which is already in the list.
   */
  async function requestReply(visitorMessage: string) {
    setFailedSend(null)
    setIsWaitingForReply(true)
    // Clicking Send or Try again moves focus to a button that is turning off or going away,
    // so bring it back.
    messageBoxRef.current?.focus()

    try {
      const reply = await sendChatMessage(npc.id, visitorMessage)
      addMessage('npc', reply.answer, reply.citations, reply.referral)
    } catch (error) {
      const reason = error instanceof ChatError ? error.message : FALLBACK_ERROR_MESSAGE
      setFailedSend({ message: visitorMessage, reason })
    } finally {
      setIsWaitingForReply(false)
    }
  }

  /**
   * Delete the visitor's saved conversations with every NPC, then empty this panel.
   * Throws if the server could not delete them, so the panel keeps what it shows.
   */
  async function clearAllConversations() {
    setIsClearing(true)

    try {
      await clearConversations()
      setMessages([])
      // A failed message or a failed load belongs to the conversation that is now gone.
      setFailedSend(null)
      setHistoryFailed(false)
    } finally {
      setIsClearing(false)
    }
  }

  /** Add the draft to the conversation and ask for a reply. */
  function sendDraft() {
    if (!canSend) {
      return
    }

    addMessage('visitor', message)
    setDraft('')
    requestReply(message)
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
        {isLoadingHistory && <p className="chat-panel-note">Loading earlier messages…</p>}
        {historyFailed && <p className="chat-panel-note">{HISTORY_ERROR_MESSAGE}</p>}
        {!isLoadingHistory && !historyFailed && messages.length === 0 && (
          <p className="chat-panel-note">No messages yet.</p>
        )}

        {/* After the saved messages load, messages are only added to the end, so their
            position is a stable key. */}
        {messages.map((chatMessage, index) => (
          <div key={index} className={`chat-message chat-message-${chatMessage.speaker}`}>
            <span className="chat-message-speaker">
              {chatMessage.speaker === 'visitor' ? 'You' : npc.display_name}
            </span>
            <p>{chatMessage.text}</p>
            <CitationList citations={chatMessage.citations} />
          </div>
        ))}

        {isWaitingForReply && <p className="chat-panel-note">{npc.display_name} is thinking…</p>}
      </div>

      {/* Retrying leaves the draft alone, so a half-written next message is not lost. */}
      {failedSend && (
        <div className="chat-panel-error">
          <p role="alert">{failedSend.reason}</p>
          <button type="button" onClick={() => requestReply(failedSend.message)}>
            Try again
          </button>
        </div>
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

      <ClearConversationsControl disabled={!canClear} onClear={clearAllConversations} />
    </aside>
  )
}
