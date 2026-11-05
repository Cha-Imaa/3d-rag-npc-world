import { useEffect, useState } from 'react'
import { isBackendOnline } from '../api/health'

type BackendStatus = 'checking' | 'online' | 'offline'

const STATUS_LABELS: Record<BackendStatus, string> = {
  checking: 'Checking backend...',
  online: 'Backend online',
  offline: 'Backend offline',
}

/** Show whether the frontend can reach the backend. */
export function BackendStatusBadge() {
  const [status, setStatus] = useState<BackendStatus>('checking')

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
  }, [])

  return (
    <p className="status-badge" role="status">
      {STATUS_LABELS[status]}
    </p>
  )
}
