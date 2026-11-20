import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatError,
  clearConversations,
  loadConversation,
  streamChatMessage,
} from './chat'
import { getVisitorId } from './visitorId'

const fetchMock = vi.fn<typeof fetch>()

/** Build a JSON response the way the server would. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The reply line every successful stream ends with. */
const REPLY = { answer: 'Hello there', citations: [], referral: null }

/**
 * Build a streamed response whose body arrives in the given pieces.
 *
 * @param pieces the body's text, split where each piece ends. Pieces may split a line.
 * @param breakAtEnd when true, the connection breaks after the last piece.
 */
function streamResponse(pieces: (string | Uint8Array)[], breakAtEnd = false): Response {
  const encoder = new TextEncoder()
  const remaining = [...pieces]
  // Hands out one piece per read, like a connection, so a break comes after earlier pieces.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = remaining.shift()
      if (piece !== undefined) {
        controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece)
      } else if (breakAtEnd) {
        controller.error(new TypeError('network error'))
      } else {
        controller.close()
      }
    },
  })

  return new Response(body, { status: 200 })
}

/** Write one line of the stream, the way the server does. */
function line(content: unknown): string {
  return JSON.stringify(content) + '\n'
}

/** Stream a message, keeping each piece of answer text. Output: the pieces and the result. */
async function streamAndCollect(): Promise<{ pieces: string[]; result: unknown }> {
  const pieces: string[] = []
  const result = await streamChatMessage('test-npc', 'Hello', (text) => pieces.push(text)).catch(
    (caught) => caught,
  )

  return { pieces, result }
}

describe('streamChatMessage', () => {
  it('sends the NPC, the message, and the visitor ID to the stream route', async () => {
    fetchMock.mockResolvedValue(streamResponse([line({ type: 'reply', reply: REPLY })]))

    await streamChatMessage('test-npc', 'Hello', () => {})

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/chat/stream')
    expect(options?.method).toBe('POST')
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Visitor-Id': getVisitorId(),
    })
    expect(JSON.parse(String(options?.body))).toEqual({ npc_id: 'test-npc', message: 'Hello' })
  })

  it('reports each piece of the answer in order, then returns the reply', async () => {
    fetchMock.mockResolvedValue(
      streamResponse([
        line({ type: 'answer_text', text: 'Hello' }),
        line({ type: 'answer_text', text: ' there' }),
        line({ type: 'reply', reply: REPLY }),
      ]),
    )

    const { pieces, result } = await streamAndCollect()

    expect(pieces).toEqual(['Hello', ' there'])
    expect(result).toEqual(REPLY)
  })

  it('puts back together lines and letters split between pieces of the body', async () => {
    const firstLine = line({ type: 'answer_text', text: 'Café' })
    const bytes = new TextEncoder().encode(firstLine + line({ type: 'reply', reply: REPLY }))
    // The é takes two bytes. Cut between them, and again part way through the reply line.
    const cutInsideLetter = new TextEncoder().encode(firstLine).indexOf(0xa9)
    const cutInsideReply = bytes.length - 10

    fetchMock.mockResolvedValue(
      streamResponse([
        bytes.slice(0, cutInsideLetter),
        bytes.slice(cutInsideLetter, cutInsideReply),
        bytes.slice(cutInsideReply),
      ]),
    )

    const { pieces, result } = await streamAndCollect()

    expect(pieces).toEqual(['Café'])
    expect(result).toEqual(REPLY)
  })

  it('reads a last line that has no line break after it', async () => {
    fetchMock.mockResolvedValue(streamResponse([JSON.stringify({ type: 'reply', reply: REPLY })]))

    expect((await streamAndCollect()).result).toEqual(REPLY)
  })

  it("passes on the server's error line, after the pieces that came before it", async () => {
    const error = { code: 'llm_unavailable', message: 'The AI service could not be reached.' }
    fetchMock.mockResolvedValue(
      streamResponse([line({ type: 'answer_text', text: 'Hel' }), line({ type: 'error', error })]),
    )

    const { pieces, result } = await streamAndCollect()

    expect(pieces).toEqual(['Hel'])
    expect(result).toBeInstanceOf(ChatError)
    expect((result as ChatError).code).toBe('llm_unavailable')
    expect((result as ChatError).message).toBe('The AI service could not be reached.')
  })

  it('reports a plain error when the stream ends without a reply', async () => {
    fetchMock.mockResolvedValue(streamResponse([line({ type: 'answer_text', text: 'Hel' })]))

    const { result } = await streamAndCollect()

    expect((result as ChatError).code).toBe('server_unreachable')
  })

  it('reports a plain error when the connection breaks part way', async () => {
    fetchMock.mockResolvedValue(streamResponse([line({ type: 'answer_text', text: 'Hel' })], true))

    const { pieces, result } = await streamAndCollect()

    expect(pieces).toEqual(['Hel'])
    expect((result as ChatError).code).toBe('server_unreachable')
  })

  it.each([
    ['reply', line({ type: 'reply', reply: REPLY })],
    ['error', line({ type: 'error', error: { code: 'llm_unavailable', message: 'Down.' } })],
  ])('stops downloading once the %s line arrives, even if the body stays open', async (
    _name,
    lastLine,
  ) => {
    const cancelDownload = vi.fn()
    // A body that sends its line and then never ends, so only cancelling closes it.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lastLine))
      },
      cancel: cancelDownload,
    })
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }))

    await streamAndCollect()

    expect(cancelDownload).toHaveBeenCalledOnce()
  })

  it('reports a plain error when a line is not readable', async () => {
    fetchMock.mockResolvedValue(streamResponse(['not json\n']))

    expect(((await streamAndCollect()).result as ChatError).code).toBe('server_unreachable')
  })

  it("passes on the server's error when the stream can't start", async () => {
    const error = { code: 'knowledge_not_ready', message: "This character's records aren't ready yet." }
    fetchMock.mockResolvedValue(jsonResponse(503, { error }))

    const { pieces, result } = await streamAndCollect()

    expect(pieces).toEqual([])
    expect((result as ChatError).code).toBe('knowledge_not_ready')
  })

  it("reports a plain error when the stream can't start and has no error details", async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    expect(((await streamAndCollect()).result as ChatError).code).toBe('server_unreachable')
  })

  it('reports a plain error when the request never reaches the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const chatError = (await streamAndCollect()).result as ChatError

    expect(chatError.code).toBe('server_unreachable')
    expect(chatError.message).toBe("The village server couldn't be reached. Please try again.")
  })
})

describe('loadConversation', () => {
  it("asks for this NPC's conversation as this visitor", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [] }))

    await loadConversation('test-npc')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/conversations/test-npc')
    expect(options?.method).toBeUndefined()
    expect(options?.headers).toEqual({ 'X-Visitor-Id': getVisitorId() })
  })

  it('encodes the NPC ID, so it stays one part of the path', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { messages: [] }))

    await loadConversation('../other')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/conversations/..%2Fother')
  })

  it('returns the saved messages, oldest first', async () => {
    const messages = [
      { role: 'visitor', content: 'Hello', citations: [], referral: null },
      { role: 'npc', content: 'Welcome.', citations: [], referral: null },
    ]
    fetchMock.mockResolvedValue(jsonResponse(200, { messages }))

    expect(await loadConversation('test-npc')).toEqual(messages)
  })

  it("passes on the server's error code and message", async () => {
    const error = { code: 'npc_not_found', message: 'That character is not here.' }
    fetchMock.mockResolvedValue(jsonResponse(404, { error }))

    const chatError = await loadConversation('test-npc').catch((caught) => caught)

    expect(chatError).toBeInstanceOf(ChatError)
    expect(chatError.code).toBe('npc_not_found')
  })

  it('reports a plain error when the request never reaches the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const chatError = await loadConversation('test-npc').catch((caught) => caught)

    expect(chatError).toBeInstanceOf(ChatError)
    expect(chatError.code).toBe('server_unreachable')
  })
})

describe('clearConversations', () => {
  it("deletes this visitor's conversations", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await clearConversations()

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/conversations')
    expect(options?.method).toBe('DELETE')
    expect(options?.headers).toEqual({ 'X-Visitor-Id': getVisitorId() })
  })

  it("passes on the server's error code and message", async () => {
    const error = { code: 'invalid_request', message: "That message couldn't be sent." }
    fetchMock.mockResolvedValue(jsonResponse(422, { error }))

    const chatError = await clearConversations().catch((caught) => caught)

    expect(chatError).toBeInstanceOf(ChatError)
    expect(chatError.code).toBe('invalid_request')
  })

  it('reports a plain error when the request never reaches the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const chatError = await clearConversations().catch((caught) => caught)

    expect(chatError).toBeInstanceOf(ChatError)
    expect(chatError.code).toBe('server_unreachable')
  })
})
