/**
 * Review workbench: candidates grouped by batch and type, with the selected
 * item's evidence alongside. Selections become a confirm request for the chat.
 */
import { useMemo, useState } from 'react'
import type { Review, ReviewItem } from '../api'
import type { Navigate } from '../App'
import { useApi } from '../hooks'
import { useT } from '../i18n'
import { AskButton, Loading, formatValue } from '../ui'
import { ItemPanel } from './ItemPanel'

export function ReviewView({ project, selected, navigate }: { project: string; selected?: string; navigate: Navigate }) {
  const t = useT()
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
        {!data.published && <p className="error">{t('noPublished')}</p>}
        <div className="toolbar">
          <span>{t('candidatesCount', { count: data.items.length })}</span>
          <label>
            {t('show')}{' '}
            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
              <option value="all">{t('all')}</option>
              <option value="ready">{t('ready')}</option>
              <option value="blocked">{t('blocked')}</option>
            </select>
          </label>
          <AskButton
            label={t('copyConfirmRequest', { count: chosen.length })}
            text={`Preview and then confirm these ${chosen.length} candidates in ontology project ${project} as one batch: ${chosen.join(', ')}`}
          />
          <AskButton label={t('copyRejectRequest', { count: chosen.length })} text={`Reject these candidates in ontology project ${project}: ${chosen.join(', ')}. ${t('reasonPrefix')}`} />
        </div>
        <p className="muted">{t('readOnlyHint')}</p>
        {!data.items.length && <p className="empty">{t('noCandidates')}</p>}
        {groups.map(([key, items]) => (
          <table key={key} className="review-table">
            <caption>
              <label>
                <input type="checkbox" checked={items.every(i => checked.has(i.id))} onChange={e => toggle(items.map(i => i.id), e.target.checked)} /> {key} ({items.length})
              </label>
            </caption>
            <thead><tr><th scope="col"><span className="sr-only">{t('selectLabel')}</span></th><th scope="col">{t('item')}</th><th scope="col">{t('checks')}</th></tr></thead>
            <tbody>
              {items.map(i => (
                <tr key={i.id} className={i.id === selected ? 'selected' : undefined}>
                  <td><input type="checkbox" aria-label={`${t('selectLabel')} ${i.label}`} checked={checked.has(i.id)} onChange={e => toggle([i.id], e.target.checked)} /></td>
                  <td><button type="button" className="link" onClick={() => navigate({ tab: 'review', item: i.id })}>{i.label}</button></td>
                  <td>{blocking(i) ? <span className="sev-blocking">{i.issues.filter(x => x.severity === 'blocking').map(x => x.code).join(', ')}</span> : <span className="ok">{t('readyBadge')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        {data.conflicts.length > 0 && (
          <section>
            <h3>{t('openConflictsCount', { count: data.conflicts.length })}</h3>
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
            <h3>{t('ruleSamplesWaiting', { count: data.samples.length })}</h3>
            <ul>
              {data.samples.map(s => (
                <li key={s.ruleId + s.targetId}>
                  <button type="button" className="link" onClick={() => navigate({ tab: 'review', item: s.targetId })}>{s.targetId}</button> (rule <code>{s.ruleId}</code>){' '}
                  <AskButton label={t('copyJudgeRequest')} text={`Judge rule ${s.ruleId} spot check ${s.targetId} in ontology project ${project} as correct/wrong: `} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {data.rules.length > 0 && (
          <section>
            <h3>{t('rules')}</h3>
            <ul>
              {data.rules.map(r => (
                <li key={r.id}><code>{r.id}</code> {t('ruleSummary', { name: r.definition.name, status: r.status, confirmed: r.stats.confirmed, judged: r.stats.judged, accuracy: r.stats.accuracy === null ? '—' : `${(r.stats.accuracy * 100).toFixed(0)}%` })}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className="side-col">
        {selected ? <ItemPanel project={project} id={selected} issues={current?.issues} navigate={navigate} /> : <p className="muted">{t('selectCandidate')}</p>}
      </aside>
    </div>
  )
}
