/** Small shared presentational pieces. */
import { useState } from 'react'
import type { Issue, Status } from './api'
import { useT } from './i18n'

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
  const t = useT()
  if (error) return <p className="error" role="alert">{error}</p>
  return loading ? <p className="muted" aria-live="polite">{t('loading')}</p> : null
}

/**
 * The UI never changes data. This button copies a ready-made request for the
 * conversation, where the change runs as a tool call behind user approval.
 */
export function AskButton({ text, label }: { text: string; label?: string }) {
  const t = useT()
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
      {copied ? t('copiedPaste') : (label ?? t('copyRequestDefault'))}
    </button>
  )
}

export const formatValue = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Renders a translated string, turning each `%%token%%` into `<code>token</code>`. */
export function WithCode({ text }: { text: string }) {
  const parts = text.split(/%%(.+?)%%/)
  return <>{parts.map((s, i) => (i % 2 ? <code key={i}>{s}</code> : s))}</>
}
