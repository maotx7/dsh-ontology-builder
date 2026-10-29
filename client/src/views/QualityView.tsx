/** Quality report layers, competency-question results, version diff and the audit log. */
import { useState } from 'react'
import type { Issue, Overview, Quality, SchemaDiff } from '../api'
import { useApi } from '../hooks'
import { useT } from '../i18n'
import { Issues, Loading } from '../ui'

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(0)}%`)
const QUESTION_STATUS_KEY = { pass: 'questionPass', fail: 'questionFail', error: 'questionError', 'no-query': 'questionNoQuery' } as const
const DIFF_KEY = { added: 'diffAdded', removed: 'diffRemoved', changed: 'diffChanged' } as const

function Layer({ title, issues }: { title: string; issues: Issue[] }) {
  const t = useT()
  const blocking = issues.filter(i => i.severity === 'blocking').length
  return (
    <details open={blocking > 0}>
      <summary>{title}: {issues.length ? t('issuesCount', { count: issues.length }) + (blocking ? t('blockingSuffix', { count: blocking }) : '') : t('noIssues')}</summary>
      <Issues issues={issues} />
    </details>
  )
}

export function QualityView({ project }: { project: string }) {
  const t = useT()
  const q = useApi<Quality>('quality', { project })
  const overview = useApi<Overview>('overview', { project })
  const versions = overview.data?.versions ?? []
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('draft')
  const diff = useApi<SchemaDiff>('diff', { project, from: from || (versions.at(-1) ? String(versions.at(-1)!.version) : undefined), to })
  const audit = useApi<Array<{ seq: number; at: string; action: string; detail: unknown }>>('audit', { project, limit: '100' })

  return (
    <div className="view columns">
      <section>
        <h2>{t('quality')}</h2>
        <Loading error={q.error} loading={q.loading && !q.data} />
        {q.data && (
          <>
            <p className={q.data.summary.ready ? 'ok' : 'sev-blocking'}>
              {q.data.summary.ready ? t('statusReady') : t('statusNotReady')} · schema v{q.data.schemaVersion} · {t('issuesSummary', { blocking: q.data.summary.blocking, warnings: q.data.summary.warnings, hints: q.data.summary.hints })}
            </p>
            <Layer title={t('layerStructure')} issues={q.data.structure} />
            <Layer title={t('layerLogic')} issues={q.data.logic} />
            <Layer title={t('layerEvidence')} issues={q.data.evidence} />
            <Layer title={t('layerSmells')} issues={q.data.smells} />
            <h3>{t('questionsLayer', { answered: q.data.questions.mustAnswered, total: q.data.questions.mustTotal })}</h3>
            <table>
              <thead><tr><th scope="col">{t('question')}</th><th scope="col">{t('priority')}</th><th scope="col">{t('result')}</th></tr></thead>
              <tbody>
                {q.data.questions.results.map(r => (
                  <tr key={r.questionId}>
                    <td>{r.text}</td>
                    <td>{r.priority}</td>
                    <td className={r.status === 'pass' ? 'ok' : 'sev-blocking'}>
                      {t(QUESTION_STATUS_KEY[r.status as keyof typeof QUESTION_STATUS_KEY])}{r.total !== undefined && ` (${r.total})`}{r.regression && ` · ${t('regression')}`}{r.missing?.length ? ` · ${t('missing', { list: r.missing.join(', ') })}` : ''}{r.error && ` · ${r.error}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Issues issues={q.data.questions.issues} />
            <h3>{t('extractionLayer')}</h3>
            <ul>
              <li>{t('extractionSummary', { confirmed: q.data.extraction.confirmed, candidates: q.data.extraction.candidates, rejected: q.data.extraction.rejected })}</li>
              <li>{t('reviewAcceptance', { pct: pct(q.data.extraction.reviewAcceptance), dropped: q.data.extraction.droppedByValidation })}</li>
              <li>{t('codeLinksSummary', { confirmed: q.data.extraction.codeLinks.confirmed, candidate: q.data.extraction.codeLinks.candidate, stale: q.data.extraction.codeLinks.stale })}</li>
              {q.data.extraction.rules.map(r => <li key={r.id}>{t('ruleSummary', { name: r.name, status: r.status, confirmed: r.confirmed, judged: r.judged, accuracy: pct(r.accuracy) })}</li>)}
            </ul>
            <p className="muted">{q.data.method}</p>
          </>
        )}
      </section>
      <section>
        <h2>{t('versions')}</h2>
        <div className="toolbar">
          <label>{t('from')} <select value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">{t('latestPublished')}</option>
            {versions.map(v => <option key={v.version} value={String(v.version)}>v{v.version}</option>)}
          </select></label>
          <label>{t('to')} <select value={to} onChange={e => setTo(e.target.value)}>
            <option value="draft">{t('draft')}</option>
            {versions.map(v => <option key={v.version} value={String(v.version)}>v{v.version}</option>)}
          </select></label>
        </div>
        {diff.data && (
          <>
            <p>{diff.data.summary}</p>
            {(['objectTypes', 'linkTypes'] as const).map(k => (
              <ul key={k}>
                {(['added', 'removed', 'changed'] as const).flatMap(c => diff.data![k][c].map(n => <li key={k + c + n} className={`diff-${c}`}>{t(DIFF_KEY[c])} {k === 'objectTypes' ? t('typeWord') : t('linkWord')} <code>{n}</code></li>))}
              </ul>
            ))}
          </>
        )}
        <ol className="versions">
          {versions.slice().reverse().map(v => <li key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString()} · <code>{v.hash.slice(0, 12)}</code> {v.note}</li>)}
        </ol>
        <h2>{t('auditLog')}</h2>
        <Loading error={audit.error} loading={audit.loading && !audit.data} />
        <ol className="audit">
          {audit.data?.map(a => (
            <li key={a.seq}>
              <span className="muted">{new Date(a.at).toLocaleString()}</span> <code>{a.action}</code>
              <details><summary className="muted">{t('detail')}</summary><pre>{JSON.stringify(a.detail, null, 2)}</pre></details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
