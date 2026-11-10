import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatError, clearConversations, loadConversation, sendChatMessage } from './chat'
import { getVisitorId } from './visitorId'

const fetchMock = vi.fn<typeof fetch>()

/** Build a JSON response the way the server would. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Run a send that should fail. Output: the error it threw. */
async function catchChatError(): Promise<ChatError> {
  const error = await sendChatMessage('test-npc', 'Hello').catch((caught) => caught)

  expect(error).toBeInstanceOf(ChatError)
  return error
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sendChatMessage', () => {
  it('sends the NPC, the message, and the visitor ID', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { answer: 'Hello there', citations: [] }))

    await sendChatMessage('test-npc', 'Hello')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/chat')
    expect(options?.method).toBe('POST')
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Visitor-Id': getVisitorId(),
    })
    expect(JSON.parse(String(options?.body))).toEqual({ npc_id: 'test-npc', message: 'Hello' })
  })

  it('returns the reply', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { answer: 'Hello there', citations: [] }))

    expect(await sendChatMessage('test-npc', 'Hello')).toEqual({
      answer: 'Hello there',
      citations: [],
    })
  })

  it("passes on the server's error code and message", async () => {
    const error = { code: 'llm_out_of_credit', message: 'The AI credit has run out.' }
    fetchMock.mockResolvedValue(jsonResponse(503, { error }))

    const chatError = await catchChatError()

    expect(chatError.code).toBe('llm_out_of_credit')
    expect(chatError.message).toBe('The AI credit has run out.')
  })

  it('reports a plain error when the request never reaches the server', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    const chatError = await catchChatError()

    expect(chatError.code).toBe('server_unreachable')
    expect(chatError.message).toBe("The village server couldn't be reached. Please try again.")
  })

  it('reports a plain error when a failed response has no error details', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    expect((await catchChatError()).code).toBe('server_unreachable')
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
      { role: 'visitor', content: 'Hello', citations: [] },
      { role: 'npc', content: 'Welcome.', citations: [] },
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
