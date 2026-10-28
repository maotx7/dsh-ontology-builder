/** Evidence reader: a material's text with every cited span highlighted and linked to its item. */
import { useEffect, useMemo, useRef } from 'react'
import type { Evidence, Material, MaterialSummary } from '../api'
import type { Navigate } from '../App'
import { useApi } from '../hooks'
import { Loading } from '../ui'

/** Cut the text into plain runs and highlighted runs; overlapping spans join the run that starts first. */
function segments(text: string, evidence: Evidence[]) {
  const out: Array<{ text: string; spans: Evidence[] }> = []
  let at = 0
  const sorted = [...evidence].sort((a, b) => a.start - b.start)
  for (let i = 0; i < sorted.length;) {
    const start = Math.max(sorted[i].start, at)
    let end = sorted[i].end
    const spans = [sorted[i]]
    for (i++; i < sorted.length && sorted[i].start < end; i++) {
      end = Math.max(end, sorted[i].end)
      spans.push(sorted[i])
    }
    if (start > at) out.push({ text: text.slice(at, start), spans: [] })
    if (end > start) out.push({ text: text.slice(start, end), spans })
    at = Math.max(at, end)
  }
  if (at < text.length) out.push({ text: text.slice(at), spans: [] })
  return out
}

export function MaterialView({ project, materialId, evidenceId, navigate }: { project: string; materialId?: string; evidenceId?: string; navigate: Navigate }) {
  const list = useApi<MaterialSummary[]>('materials', { project })
  const { data, error, loading } = useApi<{ material: Material; evidence: Evidence[] }>(materialId ? 'material' : undefined, { project, id: materialId })
  const parts = useMemo(() => (data ? segments(data.material.text, data.evidence) : []), [data])
  const focusRef = useRef<HTMLElement>(null)

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' })
    focusRef.current?.focus()
  }, [parts, evidenceId])

  return (
    <div className="view split">
      <aside className="side-col narrow">
        <h2>Materials</h2>
        <Loading {...list} loading={list.loading && !list.data} />
        <ul className="material-list">
          {list.data?.map(m => (
            <li key={m.id}>
              <button type="button" className="link" aria-current={m.id === materialId ? 'true' : undefined} onClick={() => navigate({ tab: 'materials', material: m.id })}>{m.name}</button>
              <span className="muted"> {m.length.toLocaleString()} chars</span>
            </li>
          ))}
        </ul>
      </aside>
      <div className="main-col">
        {!materialId && <p className="muted">Choose a material.</p>}
        {materialId && <Loading error={error} loading={loading && !data} />}
        {data && (
          <>
            <h2>{data.material.name}</h2>
            <p className="muted">sha256 <code>{data.material.sha256.slice(0, 16)}…</code> · {data.evidence.length} cited spans · read-only original</p>
            <pre className="material-text">
              {parts.map((p, n) => p.spans.length
                ? (
                    <mark
                      key={n}
                      ref={p.spans.some(s => s.id === evidenceId) ? focusRef : undefined}
                      tabIndex={0}
                      className={`${p.spans.every(s => s.status === 'confirmed') ? 'confirmed' : 'candidate'}${p.spans.some(s => s.id === evidenceId) ? ' focus' : ''}`}
                      title={p.spans.map(s => `${s.targetId} · ${s.field ?? 'record'} · ${s.role} · ${s.status}`).join('\n')}
                      onClick={() => navigate({ tab: 'review', item: p.spans[0].targetId })}
                      onKeyDown={e => e.key === 'Enter' && navigate({ tab: 'review', item: p.spans[0].targetId })}
                    >{p.text}</mark>
                  )
                : <span key={n}>{p.text}</span>)}
            </pre>
          </>
        )}
      </div>
    </div>
  )
}
