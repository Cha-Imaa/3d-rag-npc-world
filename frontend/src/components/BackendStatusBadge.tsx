import { useEffect, useState } from 'react'
import { isBackendOnline } from '../api/health'

type BackendStatus = 'checking' | 'online' | 'offline'

const STATUS_LABELS: Record<BackendStatus, string> = {
  checking: 'Checking backend...',
  online: 'Backend online',
  offline: 'Backend offline',
}

// How long to wait before asking an offline backend again. The page may open before the
// backend has started, or the backend may restart after a change to .env.
const OFFLINE_RECHECK_MILLISECONDS = 5000

/** Show whether the frontend can reach the backend, and notice when an offline one starts. */
export function BackendStatusBadge() {
  const [status, setStatus] = useState<BackendStatus>('checking')
  // Goes up by one for each new check, which runs the effect below again.
  const [checkNumber, setCheckNumber] = useState(0)

  // Ask the backend once per check.
  useEffect(() => {
    // Ignore a late result if the component has already been removed.
    let isCurrent = true

    isBackendOnline().then((isOnline) => {
      if (isCurrent) {
        setStatus(isOnline ? 'online' : 'offline')
      }
    })

    return () => {
      isCurrent = false
    }
  }, [checkNumber])

  // While offline, start another check after a pause. Once online, stop asking,
  // so the backend's log isn't filled with health checks.
  useEffect(() => {
    if (status !== 'offline') {
      return
    }

    const recheckTimer = setTimeout(
      () => setCheckNumber((number) => number + 1),
      OFFLINE_RECHECK_MILLISECONDS,
    )
    return () => clearTimeout(recheckTimer)
  }, [status, checkNumber])

  return (
    <p className="status-badge" role="status">
      {STATUS_LABELS[status]}
    </p>
  )
}
