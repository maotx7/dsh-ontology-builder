/** Details of one object, link or code link with all of its evidence. */
import type { ItemDetail } from '../api'
import type { Navigate } from '../App'
import { useApi } from '../hooks'
import { useT } from '../i18n'
import { AskButton, Issues, Loading, StatusBadge, formatValue } from '../ui'
import type { Issue } from '../api'

export function ItemPanel({ project, id, issues = [], navigate }: { project: string; id: string; issues?: Issue[]; navigate: Navigate }) {
  const t = useT()
  const { data, error, loading } = useApi<ItemDetail>('item', { project, id })
  if (!data) return <Loading error={error} loading={loading} />
  const r = data.record
  const name = (objectId: string) => {
    const o = data.endpoints.find(e => e.id === objectId)
    return o ? `${o.type} ${o.key}` : objectId
  }
  const title = 'key' in r ? `${r.type} · ${r.key}` : 'linkType' in r ? `${r.linkType}: ${name(r.fromId)} → ${name(r.toId)}` : `${r.relation}: ${name(r.objectId)} → ${r.codeRef}`
  return (
    <section className="panel" aria-label={t('itemDetailsLabel')}>
      <h2>{title} <StatusBadge status={r.status} /></h2>
      <p className="muted"><code>{r.id}</code> · {t('batch')} <code>{r.batchId}</code></p>
      {data.endpoints.length > 0 && (
        <p>
          {data.endpoints.map(o => (
            <button key={o.id} type="button" className="link endpoint" onClick={() => navigate({ tab: 'explore', item: o.id })}>{o.type} {o.key} ({o.status})</button>
          ))}
        </p>
      )}
      <Issues issues={issues} />
      {'properties' in r && (
        <table className="props">
          <tbody>
            {Object.entries(r.properties).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{formatValue(v)}</td></tr>)}
          </tbody>
        </table>
      )}
      {'stale' in r && r.stale && <p className="error">{t('codeNoLongerExists')}</p>}

      <h3>{t('evidenceCount', { count: data.evidence.length })}</h3>
      {!data.evidence.length && <p className="muted">{t('noEvidence')}</p>}
      <ul className="evidence">
        {data.evidence.map(e => (
          <li key={e.id}>
            <blockquote>{e.quote}</blockquote>
            <p className="muted">
              {e.field ?? t('record')} · <span className={`role role-${e.role}`}>{e.role}</span> · line {e.line} · match {e.match}{' '}
              <button type="button" className="link" onClick={() => navigate({ tab: 'materials', material: e.materialId, evidence: e.id })}>{t('openInMaterial')}</button>
            </p>
          </li>
        ))}
      </ul>

      {data.conflicts.length > 0 && (
        <>
          <h3>{t('openConflicts')}</h3>
          <ul>
            {data.conflicts.map(c => (
              <li key={c.id}>
                <code>{c.field}</code>: {t('kept')} <strong>{formatValue(c.kept)}</strong>, {t('otherSourceSays')} <strong>{formatValue(c.other)}</strong>{' '}
                <AskButton label={t('askToResolve')} text={`Resolve ontology conflict ${c.id} in project ${project} (field ${c.field}: kept ${formatValue(c.kept)} vs ${formatValue(c.other)}).`} />
              </li>
            ))}
          </ul>
        </>
      )}

      {data.codeLinks.length > 0 && (
        <>
          <h3>{t('code')}</h3>
          <ul>
            {data.codeLinks.map(c => <li key={c.id}>{c.relation} <code>{c.codeRef}</code> <StatusBadge status={c.status} />{c.stale && <span className="error"> {t('stale')}</span>}</li>)}
          </ul>
        </>
      )}
      {data.code && <p>{t('codeElement', { ref: data.code.ref, kind: data.code.kind, module: data.code.module, line: data.code.line })}</p>}

      <div className="actions">
        {r.status === 'candidate' && <AskButton label={t('askToConfirm')} text={`Preview and confirm ${r.id} in ontology project ${project}.`} />}
        {r.status === 'candidate' && <AskButton label={t('askToReject')} text={`Reject ${r.id} in ontology project ${project}. ${t('reasonPrefix')}`} />}
        {'key' in r && <button type="button" onClick={() => navigate({ tab: 'explore', item: r.id })}>{t('showInGraph')}</button>}
      </div>
    </section>
  )
}
