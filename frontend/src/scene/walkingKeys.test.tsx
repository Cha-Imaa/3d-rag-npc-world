import { cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTypingTarget, useHeldKeys, useTalkingKeys } from './walkingKeys'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

/** Add a text box to the page, as the chat panel will. */
function addTextBox(): HTMLInputElement {
  const textBox = document.createElement('input')
  document.body.append(textBox)
  return textBox
}

describe('isTypingTarget', () => {
  it('recognises text fields but not buttons', () => {
    expect(isTypingTarget(addTextBox())).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('useHeldKeys', () => {
  it('tracks a key from press to release', () => {
    const { result } = renderHook(() => useHeldKeys())

    fireEvent.keyDown(window, { code: 'KeyW' })
    expect(result.current.current.has('KeyW')).toBe(true)

    fireEvent.keyUp(window, { code: 'KeyW' })
    expect(result.current.current.has('KeyW')).toBe(false)
  })

  it('ignores keys typed into a text field', () => {
    const { result } = renderHook(() => useHeldKeys())

    fireEvent.keyDown(addTextBox(), { code: 'KeyW' })

    expect(result.current.current.size).toBe(0)
  })

  it('ignores browser shortcuts', () => {
    const { result } = renderHook(() => useHeldKeys())

    fireEvent.keyDown(window, { code: 'KeyS', ctrlKey: true })

    expect(result.current.current.size).toBe(0)
  })

  it('releases every key when the window loses focus', () => {
    const { result } = renderHook(() => useHeldKeys())

    fireEvent.keyDown(window, { code: 'KeyW' })
    fireEvent.blur(window)

    expect(result.current.current.size).toBe(0)
  })
})

describe('useTalkingKeys', () => {
  it('talks to the nearby character when E is pressed', () => {
    const onTalk = vi.fn()
    renderHook(() => useTalkingKeys({ nearbyCharacter: 2, onTalk, onStopTalking: vi.fn() }))

    fireEvent.keyDown(window, { code: 'KeyE' })

    expect(onTalk).toHaveBeenCalledWith(2)
  })

  it('does nothing on E when nobody is nearby', () => {
    const onTalk = vi.fn()
    renderHook(() => useTalkingKeys({ nearbyCharacter: null, onTalk, onStopTalking: vi.fn() }))

    fireEvent.keyDown(window, { code: 'KeyE' })

    expect(onTalk).not.toHaveBeenCalled()
  })

  it('does not treat a typed letter e as talking', () => {
    const onTalk = vi.fn()
    renderHook(() => useTalkingKeys({ nearbyCharacter: 0, onTalk, onStopTalking: vi.fn() }))

    fireEvent.keyDown(addTextBox(), { code: 'KeyE' })

    expect(onTalk).not.toHaveBeenCalled()
  })

  it('stops talking with Escape, even from a text field', () => {
    const onStopTalking = vi.fn()
    renderHook(() => useTalkingKeys({ nearbyCharacter: 0, onTalk: vi.fn(), onStopTalking }))

    fireEvent.keyDown(addTextBox(), { code: 'Escape' })

    expect(onStopTalking).toHaveBeenCalledOnce()
  })
})
