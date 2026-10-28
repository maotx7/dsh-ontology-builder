import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'

/** Bumped whenever the project's audit log grows, so every view refetches as the conversation builds. */
export const RevisionContext = createContext(0)

/** Poll the audit sequence; returns a number that changes when the project changes. */
export function useRevision(project: string | undefined, intervalMs = 3000): number {
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    if (!project) return
    let alive = true
    const tick = () => api<{ seq: number }>('seq', { project }).then(r => alive && setSeq(r.seq)).catch(() => {})
    tick()
    const timer = setInterval(() => document.visibilityState === 'visible' && tick(), intervalMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [project, intervalMs])
  return seq
}

export interface Loaded<T> { data?: T; error?: string; loading: boolean }

/** Fetch an endpoint, refetching when params or the project revision change. Keeps the last data while reloading. */
export function useApi<T>(endpoint: string | undefined, params: Record<string, string | undefined>): Loaded<T> {
  const revision = useContext(RevisionContext)
  const key = JSON.stringify(params)
  const [state, setState] = useState<Loaded<T>>({ loading: true })
  useEffect(() => {
    if (!endpoint) return
    let alive = true
    setState(s => ({ ...s, loading: true }))
    api<T>(endpoint, params)
      .then(data => alive && setState({ data, loading: false }))
      .catch((e: Error) => alive && setState({ error: e.message, loading: false }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, key, revision])
  return state
}
