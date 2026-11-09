import { getVisitorId } from './visitorId'

/**
 * A source the answer relied on. The server only sends citations that match a passage
 * it really retrieved, so each one points back to an indexed document.
 */
export type Citation = {
  id: string
  title: string
  source_file: string
  page: number | null
  section: string | null
  /** The passage's full text, so the visitor can check the answer against it. */
  text: string
}

/** An NPC's reply, as sent by POST /api/chat. Referrals join it later. */
export type ChatReply = {
  answer: string
  citations: Citation[]
}

/** For failures that never reached the server's error handling, such as a stopped backend. */
const UNREACHABLE_CODE = 'server_unreachable'
const UNREACHABLE_MESSAGE = "The village server couldn't be reached. Please try again."

/** A message that got no reply. The message is plain language, ready to show the visitor. */
export class ChatError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ChatError'
    this.code = code
  }
}

/**
 * Turn a failed response into a ChatError, using the server's shared error shape.
 *
 * @param response the response with a failing status.
 * @returns the error to throw.
 */
async function readChatError(response: Response): Promise<ChatError> {
  try {
    const { error } = await response.json()
    return new ChatError(error.code, error.message)
  } catch {
    // A failure outside the app, such as the dev proxy finding no backend, has no such body.
    return new ChatError(UNREACHABLE_CODE, UNREACHABLE_MESSAGE)
  }
}

/**
 * Send the visitor's message to an NPC.
 *
 * @param npcId the NPC being talked to.
 * @param message the visitor's message.
 * @returns the NPC's reply.
 * @throws ChatError if no reply came back, so a failure can never look like an answer.
 */
export async function sendChatMessage(npcId: string, message: string): Promise<ChatReply> {
  let response: Response

  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Visitor-Id': getVisitorId() },
      body: JSON.stringify({ npc_id: npcId, message }),
    })
  } catch {
    throw new ChatError(UNREACHABLE_CODE, UNREACHABLE_MESSAGE)
  }

  if (!response.ok) {
    throw await readChatError(response)
  }

  return response.json()
}
