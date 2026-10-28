/** Small shared presentational pieces. */
import { useState } from 'react'
import type { Issue, Status } from './api'

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{status}</span>
}

export function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={n} className={`sev-${i.severity}`}>
          <code>{i.code}</code> {i.path && <span className="muted">{i.path}</span>} {i.message}
        </li>
      ))}
    </ul>
  )
}

export function Loading({ error, loading }: { error?: string; loading: boolean }) {
  if (error) return <p className="error" role="alert">{error}</p>
  return loading ? <p className="muted" aria-live="polite">Loading…</p> : null
}

/**
 * The UI never changes data. This button copies a ready-made request for the
 * conversation, where the change runs as a tool call behind user approval.
 */
export function AskButton({ text, label = 'Copy request for chat' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="ask"
      title={text}
      onClick={() => navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })}
    >
      {copied ? 'Copied — paste in DSH chat' : label}
    </button>
  )
}

export const formatValue = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
