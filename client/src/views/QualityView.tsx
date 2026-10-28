/** Quality report layers, competency-question results, version diff and the audit log. */
import { useState } from 'react'
import type { Issue, Overview, Quality, SchemaDiff } from '../api'
import { useApi } from '../hooks'
import { Issues, Loading } from '../ui'

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(0)}%`)

function Layer({ title, issues }: { title: string; issues: Issue[] }) {
  const blocking = issues.filter(i => i.severity === 'blocking').length
  return (
    <details open={blocking > 0}>
      <summary>{title}: {issues.length ? `${issues.length} issue(s)${blocking ? `, ${blocking} blocking` : ''}` : 'no issues'}</summary>
      <Issues issues={issues} />
    </details>
  )
}

export function QualityView({ project }: { project: string }) {
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
        <h2>Quality</h2>
        <Loading error={q.error} loading={q.loading && !q.data} />
        {q.data && (
          <>
            <p className={q.data.summary.ready ? 'ok' : 'sev-blocking'}>
              {q.data.summary.ready ? 'Ready' : 'Not ready'} · schema v{q.data.schemaVersion} · {q.data.summary.blocking} blocking, {q.data.summary.warnings} warnings, {q.data.summary.hints} hints
            </p>
            <Layer title="1 Structure" issues={q.data.structure} />
            <Layer title="2 Logic" issues={q.data.logic} />
            <Layer title="3 Evidence" issues={q.data.evidence} />
            <Layer title="4 Smells" issues={q.data.smells} />
            <h3>5 Competency questions — must {q.data.questions.mustAnswered}/{q.data.questions.mustTotal}</h3>
            <table>
              <thead><tr><th scope="col">Question</th><th scope="col">Priority</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {q.data.questions.results.map(r => (
                  <tr key={r.questionId}>
                    <td>{r.text}</td>
                    <td>{r.priority}</td>
                    <td className={r.status === 'pass' ? 'ok' : 'sev-blocking'}>
                      {r.status}{r.total !== undefined && ` (${r.total})`}{r.regression && ' · regression'}{r.missing?.length ? ` · missing ${r.missing.join(', ')}` : ''}{r.error && ` · ${r.error}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Issues issues={q.data.questions.issues} />
            <h3>6 Extraction</h3>
            <ul>
              <li>{q.data.extraction.confirmed} confirmed, {q.data.extraction.candidates} candidates, {q.data.extraction.rejected} rejected</li>
              <li>Review acceptance {pct(q.data.extraction.reviewAcceptance)} · dropped by validation {q.data.extraction.droppedByValidation}</li>
              <li>Code links: {q.data.extraction.codeLinks.confirmed} confirmed, {q.data.extraction.codeLinks.candidate} candidates, {q.data.extraction.codeLinks.stale} stale</li>
              {q.data.extraction.rules.map(r => <li key={r.id}>Rule {r.name}: {r.status}, {r.confirmed} confirmed, accuracy {pct(r.accuracy)} over {r.judged} checks</li>)}
            </ul>
            <p className="muted">{q.data.method}</p>
          </>
        )}
      </section>
      <section>
        <h2>Versions</h2>
        <div className="toolbar">
          <label>From <select value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">latest published</option>
            {versions.map(v => <option key={v.version} value={String(v.version)}>v{v.version}</option>)}
          </select></label>
          <label>To <select value={to} onChange={e => setTo(e.target.value)}>
            <option value="draft">draft</option>
            {versions.map(v => <option key={v.version} value={String(v.version)}>v{v.version}</option>)}
          </select></label>
        </div>
        {diff.data && (
          <>
            <p>{diff.data.summary}</p>
            {(['objectTypes', 'linkTypes'] as const).map(k => (
              <ul key={k}>
                {(['added', 'removed', 'changed'] as const).flatMap(c => diff.data![k][c].map(n => <li key={k + c + n} className={`diff-${c}`}>{c} {k === 'objectTypes' ? 'type' : 'link'} <code>{n}</code></li>))}
              </ul>
            ))}
          </>
        )}
        <ol className="versions">
          {versions.slice().reverse().map(v => <li key={v.version}>v{v.version} · {new Date(v.createdAt).toLocaleString()} · <code>{v.hash.slice(0, 12)}</code> {v.note}</li>)}
        </ol>
        <h2>Audit log</h2>
        <Loading error={audit.error} loading={audit.loading && !audit.data} />
        <ol className="audit">
          {audit.data?.map(a => (
            <li key={a.seq}>
              <span className="muted">{new Date(a.at).toLocaleString()}</span> <code>{a.action}</code>
              <details><summary className="muted">detail</summary><pre>{JSON.stringify(a.detail, null, 2)}</pre></details>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
