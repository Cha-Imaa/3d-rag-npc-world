import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendStatusBadge } from './BackendStatusBadge'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
})
