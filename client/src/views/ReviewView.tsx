/**
 * Review workbench: candidates grouped by batch and type, with the selected
 * item's evidence alongside. Selections become a confirm request for the chat.
 */
import { useMemo, useState } from 'react'
import type { Review, ReviewItem } from '../api'
import type { Navigate } from '../App'
import { useApi } from '../hooks'
import { AskButton, Loading, formatValue } from '../ui'
import { ItemPanel } from './ItemPanel'

export function ReviewView({ project, selected, navigate }: { project: string; selected?: string; navigate: Navigate }) {
  const { data, error, loading } = useApi<Review>('review', { project })
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'ready' | 'blocked'>('all')

  const groups = useMemo(() => {
    const map = new Map<string, ReviewItem[]>()
    for (const item of data?.items ?? []) {
      if (filter === 'ready' && item.issues.some(i => i.severity === 'blocking')) continue
      if (filter === 'blocked' && !item.issues.some(i => i.severity === 'blocking')) continue
      const key = `${item.batchId} · ${item.kind} · ${item.type}`
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return [...map.entries()]
  }, [data, filter])

  if (!data) return <Loading error={error} loading={loading} />
  const toggle = (ids: string[], on: boolean) => setChecked(prev => {
    const next = new Set(prev)
    for (const id of ids) on ? next.add(id) : next.delete(id)
    return next
  })
  const chosen = [...checked].filter(id => data.items.some(i => i.id === id))
  const blocking = (i: ReviewItem) => i.issues.some(x => x.severity === 'blocking')
  const current = data.items.find(i => i.id === selected)

  return (
    <div className="view split">
      <div className="main-col">
        {!data.published && <p className="error">No published schema yet; candidates cannot be checked or confirmed until one is published.</p>}
        <div className="toolbar">
          <span>{data.items.length} candidates</span>
          <label>
            Show{' '}
            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
              <option value="all">all</option>
              <option value="ready">ready to confirm</option>
              <option value="blocked">blocked</option>
            </select>
          </label>
          <AskButton
            label={`Copy confirm request (${chosen.length})`}
            text={`Preview and then confirm these ${chosen.length} candidates in ontology project ${project} as one batch: ${chosen.join(', ')}`}
          />
          <AskButton label={`Copy reject request (${chosen.length})`} text={`Reject these candidates in ontology project ${project}: ${chosen.join(', ')}. Reason: `} />
        </div>
        <p className="muted">The UI is read-only. Copy a request, paste it into DSH chat, and approve it there — every change is recorded with your approval.</p>
        {!data.items.length && <p className="empty">Nothing to review.</p>}
        {groups.map(([key, items]) => (
          <table key={key} className="review-table">
            <caption>
              <label>
                <input type="checkbox" checked={items.every(i => checked.has(i.id))} onChange={e => toggle(items.map(i => i.id), e.target.checked)} /> {key} ({items.length})
              </label>
            </caption>
            <thead><tr><th scope="col"><span className="sr-only">Select</span></th><th scope="col">Item</th><th scope="col">Checks</th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className={i.id === selected ? 'selected' : undefined}>
                  <td><input type="checkbox" aria-label={`Select ${i.label}`} checked={checked.has(i.id)} onChange={e => toggle([i.id], e.target.checked)} /></td>
                  <td><button type="button" className="link" onClick={() => navigate({ tab: 'review', item: i.id })}>{i.label}</button></td>
                  <td>{blocking(i) ? <span className="sev-blocking">{i.issues.filter(x => x.severity === 'blocking').map(x => x.code).join(', ')}</span> : <span className="ok">ready</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        {data.conflicts.length > 0 && (
          <section>
            <h3>Open conflicts ({data.conflicts.length})</h3>
            <ul>
              {data.conflicts.map(c => (
                <li key={c.id}>
                  <button type="button" className="link" onClick={() => navigate({ tab: 'review', item: c.targetId })}>{c.targetId}</button> <code>{c.field}</code>: {formatValue(c.kept)} vs {formatValue(c.other)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.samples.length > 0 && (
          <section>
            <h3>Rule spot checks waiting ({data.samples.length})</h3>
            <ul>
              {data.samples.map(s => (
                <li key={s.ruleId + s.targetId}>
                  <button type="button" className="link" onClick={() => navigate({ tab: 'review', item: s.targetId })}>{s.targetId}</button> (rule <code>{s.ruleId}</code>){' '}
                  <AskButton label="Copy judge request" text={`Judge rule ${s.ruleId} spot check ${s.targetId} in ontology project ${project} as correct/wrong: `} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.rules.length > 0 && (
          <section>
            <h3>Rules</h3>
            <ul>
              {data.rules.map(r => (
                <li key={r.id}><code>{r.id}</code> {r.definition.name} — {r.status}, {r.stats.confirmed} confirmed, {r.stats.judged} judged{r.stats.accuracy !== null && `, accuracy ${(r.stats.accuracy * 100).toFixed(0)}%`}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className="side-col">
        {selected ? <ItemPanel project={project} id={selected} issues={current?.issues} navigate={navigate} /> : <p className="muted">Select a candidate to see its evidence.</p>}
      </aside>
    </div>
  )
}
