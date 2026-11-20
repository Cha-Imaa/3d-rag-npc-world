import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendStatusBadge } from './BackendStatusBadge'

// Matches OFFLINE_RECHECK_MILLISECONDS in the component.
const RECHECK_MILLISECONDS = 5000

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Let pending timers and promises run, inside act so React applies the state changes. */
async function waitFor(milliseconds: number) {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds))
}

describe('BackendStatusBadge', () => {
  it('shows online when the health check succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    render(<BackendStatusBadge />)

    expect(await screen.findByText('Backend online')).toBeTruthy()
  })

  it('shows offline when the backend returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    render(<BackendStatusBadge />)

    expect(await screen.findByText('Backend offline')).toBeTruthy()
  })

  it('shows offline when the backend cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')))

    render(<BackendStatusBadge />)

    expect(await screen.findByText('Backend offline')).toBeTruthy()
  })

  it('shows online once a backend that started late answers', async () => {
    vi.useFakeTimers()
    const fetchHealth = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchHealth)

    render(<BackendStatusBadge />)
    await waitFor(0)
    expect(screen.getByText('Backend offline')).toBeTruthy()

    await waitFor(RECHECK_MILLISECONDS)
    expect(screen.getByText('Backend online')).toBeTruthy()
  })

  it('keeps checking while the backend stays offline', async () => {
    vi.useFakeTimers()
    const fetchHealth = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchHealth)

    render(<BackendStatusBadge />)
    await waitFor(0)
    expect(screen.getByText('Backend offline')).toBeTruthy()

    // The second check also fails, so the badge must plan a third one by itself.
    await waitFor(RECHECK_MILLISECONDS)
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Backend offline')).toBeTruthy()

    await waitFor(RECHECK_MILLISECONDS)
    expect(fetchHealth).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Backend online')).toBeTruthy()
  })

  it('stops checking once the backend is online', async () => {
    vi.useFakeTimers()
    const fetchHealth = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchHealth)

    render(<BackendStatusBadge />)
    await waitFor(RECHECK_MILLISECONDS * 3)

    expect(fetchHealth).toHaveBeenCalledTimes(1)
  })

  it('stops checking after the badge is removed', async () => {
    vi.useFakeTimers()
    const fetchHealth = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', fetchHealth)

    const { unmount } = render(<BackendStatusBadge />)
    await waitFor(0)
    unmount()
    await waitFor(RECHECK_MILLISECONDS * 3)

    expect(fetchHealth).toHaveBeenCalledTimes(1)
  })
})
