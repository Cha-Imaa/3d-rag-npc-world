import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatError,
  clearConversations,
  loadConversation,
  sendChatMessage,
  type ChatReply,
  type SavedMessage,
} from '../api/chat'
import type { Npc } from '../api/npcs'
import { ChatPanel } from './ChatPanel'

// Keep the real ChatError, so the panel can recognise it, and pretend only the network calls.
vi.mock('../api/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/chat')>()),
  sendChatMessage: vi.fn(),
  loadConversation: vi.fn(),
  clearConversations: vi.fn(),
}))

const NPC: Npc = { id: 'test-npc', display_name: 'Test NPC', scene_position: { q: 0, r: 0 } }

const sendChatMessageMock = vi.mocked(sendChatMessage)
const loadConversationMock = vi.mocked(loadConversation)
const clearConversationsMock = vi.mocked(clearConversations)

const LOADING_NOTE = 'Loading earlier messages…'

/** Render the panel, wait for the saved messages to load, and return its box and button. */
async function renderPanel() {
  render(<ChatPanel npc={NPC} onClose={vi.fn()} />)
  await waitFor(() => expect(screen.queryByText(LOADING_NOTE)).toBeNull())

  return {
    messageBox: screen.getByLabelText<HTMLTextAreaElement>('Your message'),
    sendButton: screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }),
  }
}

/** Type a message into the box. */
function typeMessage(messageBox: HTMLTextAreaElement, text: string) {
  fireEvent.change(messageBox, { target: { value: text } })
}

beforeEach(() => {
  sendChatMessageMock.mockReset()
  sendChatMessageMock.mockResolvedValue({ answer: 'A reply.', citations: [] })
  loadConversationMock.mockReset()
  loadConversationMock.mockResolvedValue([])
  clearConversationsMock.mockReset()
  clearConversationsMock.mockResolvedValue(undefined)
})

/** Open the clear question and confirm it. */
function clearAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Clear my conversations' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
}

afterEach(() => {
  cleanup()
})

describe('ChatPanel', () => {
  it('names the NPC from its configuration', async () => {
    await renderPanel()

    expect(screen.getByRole('heading', { name: 'Test NPC' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Conversation with Test NPC' })).toBeTruthy()
  })

  it('shows the empty state before any messages exist', async () => {
    await renderPanel()

    expect(screen.getByText('No messages yet.')).toBeTruthy()
  })

  it('shows a loading note, then the saved conversation with its sources', async () => {
    const savedMessages: SavedMessage[] = [
      { role: 'visitor', content: 'How deep is the well?', citations: [] },
      {
        role: 'npc',
        content: 'Forty feet.',
        citations: [
          {
            id: 'almanac.pdf#2',
            title: 'Almanac',
            source_file: 'almanac.pdf',
            page: 2,
            section: null,
            text: 'The old well is forty feet deep.',
          },
        ],
      },
    ]
    loadConversationMock.mockResolvedValue(savedMessages)
    render(<ChatPanel npc={NPC} onClose={vi.fn()} />)

    expect(screen.getByText(LOADING_NOTE)).toBeTruthy()
    expect(await screen.findByText('Forty feet.')).toBeTruthy()
    expect(loadConversationMock).toHaveBeenCalledExactlyOnceWith('test-npc')
    expect(screen.getByText('How deep is the well?')).toBeTruthy()
    expect(screen.getByText('Almanac, page 2')).toBeTruthy()
    expect(screen.queryByText(LOADING_NOTE)).toBeNull()
    expect(screen.queryByText('No messages yet.')).toBeNull()
  })

  it("shows only the opened NPC's saved messages when the visitor moves to another NPC", async () => {
    const OTHER_NPC: Npc = {
      id: 'other-npc',
      display_name: 'Other NPC',
      scene_position: { q: 1, r: 0 },
    }
    // Each NPC has its own saved conversation, as the server keeps them.
    loadConversationMock.mockImplementation(async (npcId) => [
      { role: 'npc', content: `Saved reply from ${npcId}`, citations: [] },
    ])

    // The app gives each NPC its own panel through the key, the same way here.
    const { rerender } = render(<ChatPanel key={NPC.id} npc={NPC} onClose={vi.fn()} />)
    expect(await screen.findByText('Saved reply from test-npc')).toBeTruthy()

    rerender(<ChatPanel key={OTHER_NPC.id} npc={OTHER_NPC} onClose={vi.fn()} />)

    expect(await screen.findByText('Saved reply from other-npc')).toBeTruthy()
    expect(screen.queryByText('Saved reply from test-npc')).toBeNull()
    expect(loadConversationMock).toHaveBeenLastCalledWith('other-npc')
  })

  it('adds new messages after the saved ones', async () => {
    loadConversationMock.mockResolvedValue([
      { role: 'visitor', content: 'Earlier question', citations: [] },
      { role: 'npc', content: 'Earlier answer', citations: [] },
    ])
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'New question')
    fireEvent.click(sendButton)
    await screen.findByText('A reply.')

    const shownTexts = Array.from(document.querySelectorAll('.chat-message p')).map(
      (paragraph) => paragraph.textContent,
    )
    expect(shownTexts).toEqual(['Earlier question', 'Earlier answer', 'New question', 'A reply.'])
  })

  it('waits for the saved messages before sending, and keeps the draft', async () => {
    let deliverSavedMessages: (messages: SavedMessage[]) => void = () => {}
    loadConversationMock.mockReturnValue(
      new Promise((resolve) => {
        deliverSavedMessages = resolve
      }),
    )
    render(<ChatPanel npc={NPC} onClose={vi.fn()} />)
    const messageBox = screen.getByLabelText<HTMLTextAreaElement>('Your message')
    const sendButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })

    typeMessage(messageBox, 'Hello')
    fireEvent.keyDown(messageBox, { key: 'Enter' })

    expect(sendButton.disabled).toBe(true)
    expect(sendChatMessageMock).not.toHaveBeenCalled()
    expect(messageBox.value).toBe('Hello')

    deliverSavedMessages([])

    await waitFor(() => expect(sendButton.disabled).toBe(false))
  })

  it('says when the saved messages could not load, and still lets the visitor chat', async () => {
    loadConversationMock.mockRejectedValue(new ChatError('server_unreachable', 'Unreachable.'))
    const { messageBox, sendButton } = await renderPanel()

    expect(
      screen.getByText(
        "Earlier messages couldn't be loaded. Close and reopen this chat to try again.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText('No messages yet.')).toBeNull()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)

    expect(await screen.findByText('A reply.')).toBeTruthy()
  })

  it('puts the cursor in the message box', async () => {
    const { messageBox } = await renderPanel()

    expect(document.activeElement).toBe(messageBox)
  })

  it('can be closed', async () => {
    const onClose = vi.fn()
    render(<ChatPanel npc={NPC} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('sends the trimmed message to this NPC and shows both sides of the exchange', async () => {
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, '  Hello there  ')
    fireEvent.click(sendButton)

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(sendChatMessageMock).toHaveBeenCalledExactlyOnceWith('test-npc', 'Hello there')
    expect(screen.getByText('Hello there')).toBeTruthy()
    expect(screen.queryByText('No messages yet.')).toBeNull()
    expect(messageBox.value).toBe('')
  })

  it("lists an answer's sources, each opening to show its passage", async () => {
    sendChatMessageMock.mockResolvedValue({
      answer: 'The well is forty feet deep.',
      citations: [
        {
          id: 'almanac.pdf#2',
          title: 'Almanac',
          source_file: 'almanac.pdf',
          page: 2,
          section: null,
          text: 'The old well is forty feet deep.',
        },
        {
          id: 'notes.md#1',
          title: 'Notes',
          source_file: 'notes.md',
          page: null,
          section: 'Wells',
          text: 'Wells are checked each spring.',
        },
      ],
    })
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'How deep is the well?')
    fireEvent.click(sendButton)

    expect(await screen.findByText('Sources')).toBeTruthy()
    expect(screen.getByText('Almanac, page 2')).toBeTruthy()
    expect(screen.getByText('Notes, Wells')).toBeTruthy()
    expect(screen.getByText('The old well is forty feet deep.')).toBeTruthy()
  })

  it('shows no sources heading for an answer without citations', async () => {
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(screen.queryByText('Sources')).toBeNull()
  })

  it('shows the thinking note and blocks sending until the reply arrives', async () => {
    let deliverReply: (reply: ChatReply) => void = () => {}
    sendChatMessageMock.mockReturnValue(
      new Promise((resolve) => {
        deliverReply = resolve
      }),
    )
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'First')
    fireEvent.click(sendButton)
    typeMessage(messageBox, 'Second')
    fireEvent.keyDown(messageBox, { key: 'Enter' })

    expect(screen.getByText('Test NPC is thinking…')).toBeTruthy()
    expect(sendButton.disabled).toBe(true)
    expect(sendChatMessageMock).toHaveBeenCalledOnce()

    deliverReply({ answer: 'A late reply.', citations: [] })

    expect(await screen.findByText('A late reply.')).toBeTruthy()
    expect(screen.queryByText('Test NPC is thinking…')).toBeNull()
  })

  it('keeps the cursor in the message box after clicking Send', async () => {
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    sendButton.focus()
    fireEvent.click(sendButton)

    await screen.findByText('A reply.')
    expect(document.activeElement).toBe(messageBox)
  })

  it('sends with Enter, and leaves Shift+Enter for a new line', async () => {
    const { messageBox } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.keyDown(messageBox, { key: 'Enter', shiftKey: true })
    expect(sendChatMessageMock).not.toHaveBeenCalled()

    fireEvent.keyDown(messageBox, { key: 'Enter' })
    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(sendChatMessageMock).toHaveBeenCalledOnce()
  })

  it('does not send a blank message', async () => {
    const { messageBox, sendButton } = await renderPanel()

    expect(sendButton.disabled).toBe(true)

    typeMessage(messageBox, '   ')
    fireEvent.keyDown(messageBox, { key: 'Enter' })

    expect(sendButton.disabled).toBe(true)
    expect(sendChatMessageMock).not.toHaveBeenCalled()
  })

  it('stops a message over the limit and says why', async () => {
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'a'.repeat(2001))
    fireEvent.keyDown(messageBox, { key: 'Enter' })

    expect(sendButton.disabled).toBe(true)
    expect(screen.getByText('Messages can be up to 2,000 characters.')).toBeTruthy()
    expect(sendChatMessageMock).not.toHaveBeenCalled()
  })

  it('allows a message exactly at the limit, counting an emoji as one character', async () => {
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, '😀'.repeat(2000))

    expect(sendButton.disabled).toBe(false)
    expect(screen.queryByText('Messages can be up to 2,000 characters.')).toBeNull()
  })

  it('shows the plain reason for a failure, and no reply', async () => {
    sendChatMessageMock.mockRejectedValue(new ChatError('llm_out_of_credit', 'Out of credit.'))
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Out of credit.')
    expect(screen.queryByText('Test NPC is thinking…')).toBeNull()
    expect(screen.queryByText('Test NPC', { selector: '.chat-message-speaker' })).toBeNull()
  })

  it('still reports a failure that is not a ChatError', async () => {
    sendChatMessageMock.mockRejectedValue(new SyntaxError('Unexpected token'))
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Something went wrong. Please try again.')
  })

  it('clears an old failure once the next message gets a reply', async () => {
    sendChatMessageMock.mockRejectedValueOnce(new ChatError('llm_timeout', 'Too slow.'))
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'First')
    fireEvent.click(sendButton)
    await screen.findByRole('alert')

    typeMessage(messageBox, 'Second')
    fireEvent.click(sendButton)

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('has no retry button before anything fails', async () => {
    const { messageBox, sendButton } = await renderPanel()

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)
    await screen.findByText('A reply.')

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('retries when credit has run out, without repeating the message', async () => {
    sendChatMessageMock.mockRejectedValueOnce(new ChatError('llm_out_of_credit', 'Out of credit.'))
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(sendChatMessageMock).toHaveBeenCalledTimes(2)
    expect(sendChatMessageMock).toHaveBeenLastCalledWith('test-npc', 'Hello')
    expect(screen.getAllByText('Hello')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('offers the retry again when a retry fails too', async () => {
    sendChatMessageMock.mockRejectedValueOnce(new ChatError('llm_unavailable', 'First failure.'))
    sendChatMessageMock.mockRejectedValueOnce(new ChatError('llm_unavailable', 'Second failure.'))
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Second failure.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(sendChatMessageMock).toHaveBeenCalledTimes(3)
    expect(screen.getAllByText('Hello')).toHaveLength(1)
  })

  it('shows the thinking note in place of the failure while retrying', async () => {
    sendChatMessageMock.mockRejectedValueOnce(new ChatError('llm_unavailable', 'Failed.'))
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)
    const retryButton = await screen.findByRole<HTMLButtonElement>('button', { name: 'Try again' })

    let deliverReply: (reply: ChatReply) => void = () => {}
    sendChatMessageMock.mockReturnValue(
      new Promise((resolve) => {
        deliverReply = resolve
      }),
    )
    retryButton.focus()
    fireEvent.click(retryButton)

    expect(screen.getByText('Test NPC is thinking…')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // The button is gone, so the cursor has to go somewhere useful.
    expect(document.activeElement).toBe(messageBox)

    deliverReply({ answer: 'A late reply.', citations: [] })

    expect(await screen.findByText('A late reply.')).toBeTruthy()
  })

  it('retries the failed message and keeps a new draft in the box', async () => {
    sendChatMessageMock.mockRejectedValueOnce(new ChatError('llm_unavailable', 'Failed.'))
    const { messageBox, sendButton } = await renderPanel()

    typeMessage(messageBox, 'First')
    fireEvent.click(sendButton)
    const retryButton = await screen.findByRole('button', { name: 'Try again' })

    typeMessage(messageBox, 'Half-written next message')
    fireEvent.click(retryButton)

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(sendChatMessageMock).toHaveBeenLastCalledWith('test-npc', 'First')
    expect(messageBox.value).toBe('Half-written next message')
  })

  describe('clearing conversations', () => {
    const SAVED_EXCHANGE: SavedMessage[] = [
      { role: 'visitor', content: 'Earlier question', citations: [] },
      { role: 'npc', content: 'Earlier answer', citations: [] },
    ]

    it('empties the panel once the server has cleared them', async () => {
      loadConversationMock.mockResolvedValue(SAVED_EXCHANGE)
      await renderPanel()

      clearAndConfirm()

      expect(await screen.findByText('Your conversations were cleared.')).toBeTruthy()
      expect(clearConversationsMock).toHaveBeenCalledOnce()
      expect(screen.queryByText('Earlier question')).toBeNull()
      expect(screen.getByText('No messages yet.')).toBeTruthy()
    })

    it('keeps the messages when clearing fails', async () => {
      loadConversationMock.mockResolvedValue(SAVED_EXCHANGE)
      clearConversationsMock.mockRejectedValue(
        new ChatError('server_unreachable', 'Unreachable.'),
      )
      await renderPanel()

      clearAndConfirm()

      expect((await screen.findByRole('alert')).textContent).toBe('Unreachable.')
      expect(screen.getByText('Earlier question')).toBeTruthy()
    })

    it('removes an old failure and its retry, which belonged to the cleared chat', async () => {
      sendChatMessageMock.mockRejectedValue(new ChatError('llm_timeout', 'Too slow.'))
      const { messageBox, sendButton } = await renderPanel()
      typeMessage(messageBox, 'Hello')
      fireEvent.click(sendButton)
      await screen.findByRole('button', { name: 'Try again' })

      clearAndConfirm()

      await screen.findByText('Your conversations were cleared.')
      expect(screen.queryByText('Too slow.')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    })

    it('cannot clear while a reply is on its way, which the server saves afterwards', async () => {
      sendChatMessageMock.mockReturnValue(new Promise(() => {}))
      const { messageBox, sendButton } = await renderPanel()

      typeMessage(messageBox, 'Hello')
      fireEvent.click(sendButton)

      const clearButton = screen.getByRole<HTMLButtonElement>('button', {
        name: 'Clear my conversations',
      })
      expect(clearButton.disabled).toBe(true)
    })

    it('cannot send while clearing, and keeps the draft', async () => {
      clearConversationsMock.mockReturnValue(new Promise(() => {}))
      const { messageBox, sendButton } = await renderPanel()

      clearAndConfirm()
      typeMessage(messageBox, 'Hello')
      fireEvent.keyDown(messageBox, { key: 'Enter' })

      expect(sendButton.disabled).toBe(true)
      expect(sendChatMessageMock).not.toHaveBeenCalled()
      expect(messageBox.value).toBe('Hello')
    })
  })
})
