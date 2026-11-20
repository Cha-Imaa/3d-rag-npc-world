import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  ChatError,
  clearConversations,
  loadConversation,
  streamChatMessage,
  type ChatReply,
  type Citation,
  type Referral,
  type SavedMessage,
} from '../api/chat'
import type { Npc } from '../api/npcs'
import { useVillageStore } from '../store'
import { CitationList } from './CitationList'
import { ClearConversationsControl } from './ClearConversationsControl'
import {
  findPendingReply,
  rememberPendingReply,
  waitForAllPendingReplies,
  type FailedReply,
} from './pendingReplies'
import { ReferralCard } from './ReferralCard'

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

/** How asking for a reply ended: with the checked reply, or with the reason it failed. */
type ReplyOutcome = { reply: ChatReply } | { failure: FailedReply }

/**
 * Ask an NPC to reply, and report how it ended instead of throwing.
 * Input: the NPC's ID, the visitor's message, and what to run with each piece of the answer.
 * Output: the checked reply, or the message that failed and the plain reason why.
 */
async function askForReply(
  npcId: string,
  visitorMessage: string,
  onAnswerText: (text: string) => void,
): Promise<ReplyOutcome> {
  try {
    const reply = await streamChatMessage(npcId, visitorMessage, onAnswerText)
    return { reply }
  } catch (error) {
    const reason = error instanceof ChatError ? error.message : FALLBACK_ERROR_MESSAGE
    return { failure: { message: visitorMessage, reason } }
  }
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
 * Input: the NPC being talked to, every NPC in the village (to name a referral's target),
 * what to run when the visitor follows a referral, and what to run when they close the panel.
 */
export function ChatPanel({
  npc,
  npcs,
  onFollowReferral,
  onClose,
}: {
  npc: Npc
  npcs: Npc[]
  onFollowReferral: (npcId: string) => void
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isWaitingForReply, setIsWaitingForReply] = useState(false)
  // The answer so far, while the NPC is still writing it. Empty when nothing has arrived yet.
  const [answerSoFar, setAnswerSoFar] = useState('')
  const [failedSend, setFailedSend] = useState<FailedReply | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [historyFailed, setHistoryFailed] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  // The village shows the NPC as thinking while a reply is on its way.
  const startReplying = useVillageStore((state) => state.startReplying)
  const finishReplying = useVillageStore((state) => state.finishReplying)

  const messageListRef = useRef<HTMLDivElement>(null)
  const messageBoxRef = useRef<HTMLTextAreaElement>(null)
  // False once the panel closes, so a reply that arrives later leaves the village alone.
  const isPanelOpenRef = useRef(true)

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
    // A reply asked for before the chat was last closed, which may still be on its way.
    const unfinishedReply = findPendingReply(npc.id)

    /**
     * Wait for the unfinished reply, if there is one, showing the NPC as thinking meanwhile.
     * Output: the failed message and its reason, or null if it arrived or none was waited for.
     */
    async function waitForUnfinishedReply(): Promise<FailedReply | null> {
      if (!unfinishedReply) {
        return null
      }

      // Send stays off meanwhile, so the visitor can't start a second reply.
      setIsWaitingForReply(true)
      startReplying(npc.id)
      const failure = await unfinishedReply

      // A closed panel already stopped the thinking cue when it closed.
      if (isPanelOpen) {
        setIsWaitingForReply(false)
        finishReplying(npc.id)
      }
      return failure
    }

    /** Show the saved messages, or say they couldn't load. */
    async function showSavedMessages() {
      try {
        const savedMessages = await loadConversation(npc.id)

        if (isPanelOpen) {
          setMessages(savedMessages.map(toPanelMessage))
        }
      } catch {
        if (isPanelOpen) {
          setHistoryFailed(true)
        }
      } finally {
        if (isPanelOpen) {
          setIsLoadingHistory(false)
        }
      }
    }

    /**
     * Show a failed unfinished reply as the panel would have if it had stayed open: the
     * visitor's message, the reason, and Try again. Otherwise the message would vanish.
     */
    function showEarlierFailure(failure: FailedReply) {
      setMessages((currentMessages) => [
        ...currentMessages,
        { speaker: 'visitor', text: failure.message, citations: [], referral: null },
      ])
      setFailedSend(failure)
    }

    /** Open the conversation: wait for any unfinished reply, then show the saved messages. */
    async function openConversation() {
      // The server saves an exchange only once its reply is sent, so loading before then
      // would miss it.
      const earlierFailure = await waitForUnfinishedReply()
      if (!isPanelOpen) {
        return
      }

      await showSavedMessages()

      // A failed reply saved nothing, so it goes after the saved messages.
      if (earlierFailure && isPanelOpen) {
        showEarlierFailure(earlierFailure)
      }
    }

    openConversation()

    return () => {
      isPanelOpen = false
    }
  }, [npc.id, startReplying, finishReplying])

  // When the panel closes mid-reply, stop showing the NPC as thinking straight away,
  // instead of waiting for a reply nobody will see.
  useEffect(() => {
    isPanelOpenRef.current = true

    return () => {
      isPanelOpenRef.current = false
      finishReplying(npc.id)
    }
  }, [npc.id, finishReplying])

  // Keep the newest message, the thinking note, and the growing answer in view.
  useEffect(() => {
    const messageList = messageListRef.current

    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight
    }
  }, [messages, isWaitingForReply, answerSoFar])

  /**
   * Find the NPC a referral suggests, among the NPCs in the village.
   * Input: the referral, or null. Output: the NPC, or null if there is none to send the
   * visitor to, such as a saved referral to an NPC that has since been turned off.
   */
  function findReferredNpc(referral: Referral | null): Npc | null {
    return npcs.find((villageNpc) => villageNpc.id === referral?.npc_id) ?? null
  }

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
    startReplying(npc.id)
    // Clicking Send or Try again moves focus to a button that is turning off or going away,
    // so bring it back.
    messageBoxRef.current?.focus()

    // Closing the panel does not cancel this, on purpose: the server saves the reply only
    // after sending the whole answer, so reading on lets it show when the chat reopens.
    const outcome = askForReply(npc.id, visitorMessage, (text) =>
      setAnswerSoFar((currentAnswer) => currentAnswer + text),
    )
    // Remembered so a chat reopened before the reply settles can wait for it.
    rememberPendingReply(
      npc.id,
      outcome.then((result) => ('failure' in result ? result.failure : null)),
    )
    const result = await outcome

    if ('failure' in result) {
      setFailedSend(result.failure)
    } else {
      // The checked reply replaces the pieces, so what stays on screen is what was saved.
      addMessage('npc', result.reply.answer, result.reply.citations, result.reply.referral)
    }

    // Drop any half-written answer, so a retry starts from nothing instead of old text.
    setAnswerSoFar('')
    setIsWaitingForReply(false)

    // A closed panel already finished its reply. Finishing again could end the thinking
    // of a new chat with the same NPC.
    if (isPanelOpenRef.current) {
      finishReplying(npc.id)
    }
  }

  /**
   * Delete the visitor's saved conversations with every NPC, then empty this panel.
   * Throws if the server could not delete them, so the panel keeps what it shows.
   */
  async function clearAllConversations() {
    setIsClearing(true)

    try {
      // A reply from a chat closed mid-reply would be saved after the clear and bring its
      // conversation back, so let every unfinished reply settle first.
      await waitForAllPendingReplies()
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
        {/* While an unfinished reply is awaited, the thinking note says enough. */}
        {isLoadingHistory && !isWaitingForReply && (
          <p className="chat-panel-note">Loading earlier messages…</p>
        )}
        {historyFailed && <p className="chat-panel-note">{HISTORY_ERROR_MESSAGE}</p>}
        {!isLoadingHistory && !historyFailed && messages.length === 0 && (
          <p className="chat-panel-note">No messages yet.</p>
        )}

        {/* After the saved messages load, messages are only added to the end, so their
            position is a stable key. */}
        {messages.map((chatMessage, index) => {
          const referredNpc = findReferredNpc(chatMessage.referral)

          return (
            <div key={index} className={`chat-message chat-message-${chatMessage.speaker}`}>
              <span className="chat-message-speaker">
                {chatMessage.speaker === 'visitor' ? 'You' : npc.display_name}
              </span>
              <p>{chatMessage.text}</p>
              <CitationList citations={chatMessage.citations} />
              {referredNpc && chatMessage.referral && (
                <ReferralCard
                  npcName={referredNpc.display_name}
                  reason={chatMessage.referral.reason}
                  onFollow={() => onFollowReferral(referredNpc.id)}
                />
              )}
            </div>
          )
        })}

        {/* The thinking note waits for the first words, which then grow in its place. */}
        {isWaitingForReply && answerSoFar === '' && (
          <p className="chat-panel-note">{npc.display_name} is thinking…</p>
        )}
        {/* Hidden from screen readers, which would read out every piece. The finished reply
            joins the list once, so it is announced once. */}
        {isWaitingForReply && answerSoFar !== '' && (
          <div className="chat-message chat-message-npc" aria-hidden="true">
            <span className="chat-message-speaker">{npc.display_name}</span>
            <p>{answerSoFar}</p>
          </div>
        )}
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
