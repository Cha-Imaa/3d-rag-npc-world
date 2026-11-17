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

/**
 * A suggestion to talk to another NPC. The server only sends one that names another
 * enabled NPC, so the ID always matches an NPC from GET /api/npcs.
 */
export type Referral = {
  npc_id: string
  /** A short reason, shown on the referral card. */
  reason: string
}

/** An NPC's reply, as sent by POST /api/chat, and at the end of POST /api/chat/stream. */
export type ChatReply = {
  answer: string
  citations: Citation[]
  /** Null when the NPC suggests nobody. */
  referral: Referral | null
}

/** One saved message, as sent by GET /api/conversations/{npc_id}, oldest first. */
export type SavedMessage = {
  role: 'visitor' | 'npc'
  content: string
  /** The sources an NPC's reply showed. Always empty for the visitor's messages. */
  citations: Citation[]
  /** The referral an NPC's reply showed. Always null for the visitor's messages. */
  referral: Referral | null
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
 * Make a request to the server as this visitor, and check that it worked.
 *
 * @param path the API path, such as /api/chat.
 * @param options the method, body, and any extra headers.
 * @returns the successful response.
 * @throws ChatError if the server can't be reached or the request failed.
 */
async function requestAsVisitor(path: string, options: RequestInit = {}): Promise<Response> {
  let response: Response

  try {
    response = await fetch(path, {
      ...options,
      headers: { ...options.headers, 'X-Visitor-Id': getVisitorId() },
    })
  } catch {
    throw new ChatError(UNREACHABLE_CODE, UNREACHABLE_MESSAGE)
  }

  if (!response.ok) {
    throw await readChatError(response)
  }

  return response
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
  const response = await requestAsVisitor('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npc_id: npcId, message }),
  })

  return response.json()
}

/** One line of POST /api/chat/stream. ARCHITECTURE.md describes each type. */
type StreamLine =
  | { type: 'answer_text'; text: string }
  | { type: 'reply'; reply: ChatReply }
  | { type: 'error'; error: { code: string; message: string } }

/**
 * Read a response body one line at a time, as each line arrives.
 *
 * @param body the response body, which may arrive in pieces that split a line, or a letter.
 * @returns each non-blank line, without its line break.
 */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  // With stream: true, a letter split between two pieces is held until it is complete.
  const decoder = new TextDecoder()
  let unfinishedLine = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    unfinishedLine += decoder.decode(value, { stream: true })
    const lines = unfinishedLine.split('\n')
    // The last part has no line break after it yet, so more of it may still come.
    unfinishedLine = lines.pop() ?? ''
    yield* lines.filter((line) => line.trim() !== '')
  }

  unfinishedLine += decoder.decode()
  if (unfinishedLine.trim() !== '') {
    yield unfinishedLine
  }
}

/**
 * Send the visitor's message to an NPC, and receive the answer while it is written.
 *
 * @param npcId the NPC being talked to.
 * @param message the visitor's message.
 * @param onAnswerText called with each new piece of the answer, in order. The server
 *   sends no pieces for an answer it will replace, such as one without valid sources.
 * @returns the checked reply, which is what was saved. It replaces the pieces.
 * @throws ChatError if no reply came back, even after some pieces arrived, so a failure
 *   can never look like an answer.
 */
export async function streamChatMessage(
  npcId: string,
  message: string,
  onAnswerText: (text: string) => void,
): Promise<ChatReply> {
  const response = await requestAsVisitor('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npc_id: npcId, message }),
  })

  if (response.body === null) {
    throw new ChatError(UNREACHABLE_CODE, UNREACHABLE_MESSAGE)
  }

  try {
    for await (const line of readLines(response.body)) {
      const streamLine: StreamLine = JSON.parse(line)

      if (streamLine.type === 'answer_text') {
        onAnswerText(streamLine.text)
      } else if (streamLine.type === 'reply') {
        return streamLine.reply
      } else if (streamLine.type === 'error') {
        throw new ChatError(streamLine.error.code, streamLine.error.message)
      }
    }
  } catch (error) {
    if (error instanceof ChatError) {
      throw error
    }
    // The connection broke part way, or a line couldn't be read.
    throw new ChatError(UNREACHABLE_CODE, UNREACHABLE_MESSAGE)
  }

  // The stream ended without a reply, so the connection was cut before the end.
  throw new ChatError(UNREACHABLE_CODE, UNREACHABLE_MESSAGE)
}

/**
 * Load this visitor's saved conversation with one NPC.
 *
 * @param npcId the NPC whose conversation to load.
 * @returns the saved messages, oldest first. Empty if nothing was said yet.
 * @throws ChatError if the conversation could not be loaded.
 */
export async function loadConversation(npcId: string): Promise<SavedMessage[]> {
  // Encoded so an ID can never change which path is asked for.
  const response = await requestAsVisitor(`/api/conversations/${encodeURIComponent(npcId)}`)
  const { messages } = await response.json()

  return messages
}

/**
 * Delete this visitor's saved conversations with every NPC.
 *
 * @throws ChatError if the conversations could not be deleted, so a failure never looks done.
 */
export async function clearConversations(): Promise<void> {
  await requestAsVisitor('/api/conversations', { method: 'DELETE' })
}
