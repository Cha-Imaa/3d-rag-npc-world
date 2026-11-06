import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatError, sendChatMessage, type ChatReply } from '../api/chat'
import type { Npc } from '../api/npcs'
import { ChatPanel } from './ChatPanel'

// Keep the real ChatError, so the panel can recognise it, and pretend only the network call.
vi.mock('../api/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/chat')>()),
  sendChatMessage: vi.fn(),
}))

const NPC: Npc = { id: 'test-npc', display_name: 'Test NPC', scene_position: { q: 0, r: 0 } }

const sendChatMessageMock = vi.mocked(sendChatMessage)

/** Render the panel and return its message box and Send button. */
function renderPanel() {
  render(<ChatPanel npc={NPC} onClose={vi.fn()} />)

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
  sendChatMessageMock.mockResolvedValue({ answer: 'A reply.' })
})

afterEach(() => {
  cleanup()
})

describe('ChatPanel', () => {
  it('names the NPC from its configuration', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Test NPC' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Conversation with Test NPC' })).toBeTruthy()
  })

  it('shows the empty state before any messages exist', () => {
    renderPanel()

    expect(screen.getByText('No messages yet.')).toBeTruthy()
  })

  it('puts the cursor in the message box', () => {
    const { messageBox } = renderPanel()

    expect(document.activeElement).toBe(messageBox)
  })

  it('can be closed', () => {
    const onClose = vi.fn()
    render(<ChatPanel npc={NPC} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('sends the trimmed message to this NPC and shows both sides of the exchange', async () => {
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, '  Hello there  ')
    fireEvent.click(sendButton)

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(sendChatMessageMock).toHaveBeenCalledExactlyOnceWith('test-npc', 'Hello there')
    expect(screen.getByText('Hello there')).toBeTruthy()
    expect(screen.queryByText('No messages yet.')).toBeNull()
    expect(messageBox.value).toBe('')
  })

  it('shows the thinking note and blocks sending until the reply arrives', async () => {
    let deliverReply: (reply: ChatReply) => void = () => {}
    sendChatMessageMock.mockReturnValue(
      new Promise((resolve) => {
        deliverReply = resolve
      }),
    )
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, 'First')
    fireEvent.click(sendButton)
    typeMessage(messageBox, 'Second')
    fireEvent.keyDown(messageBox, { key: 'Enter' })

    expect(screen.getByText('Test NPC is thinking…')).toBeTruthy()
    expect(sendButton.disabled).toBe(true)
    expect(sendChatMessageMock).toHaveBeenCalledOnce()

    deliverReply({ answer: 'A late reply.' })

    expect(await screen.findByText('A late reply.')).toBeTruthy()
    expect(screen.queryByText('Test NPC is thinking…')).toBeNull()
  })

  it('keeps the cursor in the message box after clicking Send', async () => {
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, 'Hello')
    sendButton.focus()
    fireEvent.click(sendButton)

    await screen.findByText('A reply.')
    expect(document.activeElement).toBe(messageBox)
  })

  it('sends with Enter, and leaves Shift+Enter for a new line', async () => {
    const { messageBox } = renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.keyDown(messageBox, { key: 'Enter', shiftKey: true })
    expect(sendChatMessageMock).not.toHaveBeenCalled()

    fireEvent.keyDown(messageBox, { key: 'Enter' })
    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(sendChatMessageMock).toHaveBeenCalledOnce()
  })

  it('does not send a blank message', () => {
    const { messageBox, sendButton } = renderPanel()

    expect(sendButton.disabled).toBe(true)

    typeMessage(messageBox, '   ')
    fireEvent.keyDown(messageBox, { key: 'Enter' })

    expect(sendButton.disabled).toBe(true)
    expect(sendChatMessageMock).not.toHaveBeenCalled()
  })

  it('stops a message over the limit and says why', () => {
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, 'a'.repeat(2001))
    fireEvent.keyDown(messageBox, { key: 'Enter' })

    expect(sendButton.disabled).toBe(true)
    expect(screen.getByText('Messages can be up to 2,000 characters.')).toBeTruthy()
    expect(sendChatMessageMock).not.toHaveBeenCalled()
  })

  it('allows a message exactly at the limit, counting an emoji as one character', () => {
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, '😀'.repeat(2000))

    expect(sendButton.disabled).toBe(false)
    expect(screen.queryByText('Messages can be up to 2,000 characters.')).toBeNull()
  })

  it('shows the plain reason for a failure, and no reply', async () => {
    sendChatMessageMock.mockRejectedValue(new ChatError('llm_out_of_credit', 'Out of credit.'))
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Out of credit.')
    expect(screen.queryByText('Test NPC is thinking…')).toBeNull()
    expect(screen.queryByText('Test NPC', { selector: '.chat-message-speaker' })).toBeNull()
  })

  it('still reports a failure that is not a ChatError', async () => {
    sendChatMessageMock.mockRejectedValue(new SyntaxError('Unexpected token'))
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, 'Hello')
    fireEvent.click(sendButton)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Something went wrong. Please try again.')
  })

  it('clears an old failure once the next message gets a reply', async () => {
    sendChatMessageMock.mockRejectedValueOnce(new ChatError('llm_timeout', 'Too slow.'))
    const { messageBox, sendButton } = renderPanel()

    typeMessage(messageBox, 'First')
    fireEvent.click(sendButton)
    await screen.findByRole('alert')

    typeMessage(messageBox, 'Second')
    fireEvent.click(sendButton)

    expect(await screen.findByText('A reply.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
