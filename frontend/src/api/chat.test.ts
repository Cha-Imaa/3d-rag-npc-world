import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatError, sendChatMessage } from './chat'
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
