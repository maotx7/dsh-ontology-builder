/**
 * Quality report over the latest published version. Layers 1–4 are
 * deterministic checks; 5 runs the saved competency-question queries; 6
 * summarizes extraction quality from human review. No number here comes from
 * the model's own confidence.
 */
import type { Issue } from './schema.js'
import { validateProperties, validateSchema } from './schema.js'
import type { QuestionResult, Store } from './store.js'

export interface QualityReport {
  schemaVersion: number
  generatedAt: string
  summary: { blocking: number; warnings: number; hints: number; ready: boolean }
  structure: Issue[]
  logic: Issue[]
  evidence: Issue[]
  smells: Issue[]
  questions: { issues: Issue[]; results: QuestionResult[]; mustAnswered: number; mustTotal: number; regressions: string[] }
  extraction: {
    candidates: number; confirmed: number; rejected: number
    /** Reviewed share that was confirmed rather than rejected. */
    reviewAcceptance: number | null
    rules: Array<{ id: string; name: string; status: string; confirmed: number; judged: number; accuracy: number | null }>
    /** Items models submitted that failed validation, from the extraction log. */
    droppedByValidation: number
    codeLinks: { candidate: number; confirmed: number; stale: number }
  }
  /** Objects with no active link at all — candidate loose ends to wire up, plus confirmed gaps. */
  orphans: { candidates: number; confirmed: number; byType: Record<string, number> }
  method: string
}

const METHOD = 'Structure, logic, evidence and smell checks are deterministic. Question coverage runs saved ObjectSet queries on confirmed data. Review acceptance = confirmed / (confirmed + rejected) over human and rule decisions; rule accuracy = correct / judged spot checks. Model self-reported confidence is not used.'

export function qualityReport(store: Store, projectId: string): QualityReport {
  const published = store.published(projectId)
  if (!published) throw new Error('No published schema.')
  const schema = published.schema
  const issue = (severity: Issue['severity'], code: string, path: string, message: string): Issue => ({ severity, code, path, message })

  const schemaIssues = validateSchema(schema)
  const smellCodes = new Set(['GENERIC_TYPE_NAME', 'SIMILAR_OBJECT_TYPE', 'NO_DESCRIPTIVE_PROPERTIES', 'UNTRACED_TYPE'])
  const structure = schemaIssues.filter(i => !smellCodes.has(i.code) && i.code !== 'UNCOVERED_QUESTION' && i.code !== 'NO_QUESTIONS')
  const smells = schemaIssues.filter(i => smellCodes.has(i.code))

  const all = store.objects(projectId, { status: ['candidate', 'confirmed', 'rejected'] })
  const confirmed = all.filter(o => o.status === 'confirmed')
  const types = new Map(schema.objectTypes.map(t => [t.apiName, t]))
  const logic: Issue[] = []
  for (const o of confirmed) {
    const type = types.get(o.type)
    if (!type) { logic.push(issue('blocking', 'TYPE_REMOVED', o.id, `Confirmed ${o.type} "${o.key}" has no type in schema v${published.version}.`)); continue }
    for (const i of validateProperties(type, o.properties)) logic.push({ ...i, severity: 'blocking', path: `${o.id}.${i.path}`, message: `${o.type} "${o.key}": ${i.message}` })
  }
  const allLinks = store.links(projectId, { status: ['candidate', 'confirmed', 'rejected'] })
  const confirmedLinks = allLinks.filter(l => l.status === 'confirmed')
  const linkTypes = new Map(schema.linkTypes.map(l => [l.apiName, l]))
  const byId = new Map(all.map(o => [o.id, o]))
  const counts = new Map<string, number>()
  for (const l of confirmedLinks) {
    const def = linkTypes.get(l.linkType)
    if (!def) { logic.push(issue('blocking', 'LINK_TYPE_REMOVED', l.id, `Confirmed link ${l.id} has type ${l.linkType}, which is not in schema v${published.version}.`)); continue }
    for (const end of [l.fromId, l.toId]) if (byId.get(end)?.status !== 'confirmed') logic.push(issue('blocking', 'DANGLING_LINK', l.id, `Confirmed ${l.linkType} link points at ${end}, which is not confirmed.`))
    const single = (def.cardinality === 'one-to-one' || def.cardinality === 'many-to-one') ? `${def.apiName}>${l.fromId}` : undefined
    const inverse = (def.cardinality === 'one-to-one' || def.cardinality === 'one-to-many') ? `${def.apiName}<${l.toId}` : undefined
    for (const k of [single, inverse]) if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (const [k, n] of counts) if (n > 1) logic.push(issue('blocking', 'CARDINALITY', k, `${k.split(/[<>]/)[0]} has ${n} confirmed links where one is allowed.`))

  const evidence: Issue[] = []
  for (const r of [...confirmed, ...confirmedLinks]) {
    const ev = store.evidence(projectId, r.id)
    if (!ev.length) evidence.push(issue('blocking', 'NO_EVIDENCE', r.id, `Confirmed ${r.id} has no evidence.`))
    else if (ev.every(e => e.role === 'inferred')) evidence.push(issue('blocking', 'ONLY_INFERRED', r.id, `Confirmed ${r.id} rests only on inferred evidence.`))
    else if (new Set(ev.map(e => e.materialId)).size === 1 && ev.length === 1) evidence.push(issue('hint', 'SINGLE_SOURCE', r.id, `${r.id} is supported by a single quote.`))
  }
  for (const c of store.conflicts(projectId)) if (byId.get(c.targetId)?.status === 'confirmed') evidence.push(issue('warning', 'CONFLICT_ON_CONFIRMED', c.targetId, `Sources disagree on ${c.field}: ${JSON.stringify(c.kept)} vs ${JSON.stringify(c.other)}.`))
  const codeLinks = store.codeLinks(projectId, { status: ['candidate', 'confirmed'] })
  for (const l of codeLinks) if (l.stale && l.status === 'confirmed') evidence.push(issue('warning', 'STALE_CODE_LINK', l.id, `${l.codeRef} no longer exists in the latest code snapshot.`))

  const instanceCount = new Map<string, number>()
  for (const o of confirmed) instanceCount.set(o.type, (instanceCount.get(o.type) ?? 0) + 1)
  for (const t of schema.objectTypes) if (!instanceCount.get(t.apiName)) smells.push(issue('hint', 'EMPTY_TYPE', t.apiName, `${t.apiName} has no confirmed instances.`))
  for (const t of schema.objectTypes) {
    const linked = schema.linkTypes.some(l => l.from === t.apiName || l.to === t.apiName)
    if (!linked && schema.objectTypes.length > 1) smells.push(issue('hint', 'ISOLATED_TYPE', t.apiName, `${t.apiName} has no link types; it cannot be reached by traversal.`))
  }

  const results = store.runQuestions(projectId)
  const must = schema.questions.filter(q => q.priority === 'must')
  const mustAnswered = results.filter(r => r.priority === 'must' && r.status === 'pass').length
  const questionIssues: Issue[] = results.filter(r => r.status !== 'pass').map(r => issue(
    r.priority === 'must' ? 'blocking' : 'warning',
    r.status === 'no-query' ? 'NO_QUESTION_QUERY' : r.regression ? 'QUESTION_REGRESSION' : 'QUESTION_UNANSWERED', r.questionId,
    r.status === 'no-query' ? `"${r.text}" has no saved query.` : r.status === 'error' ? `"${r.text}": query failed: ${r.error}` : `"${r.text}" returned ${r.total} result(s)${r.missing?.length ? `, missing ${r.missing.join(', ')}` : ''}.`
  ))

  const decided = all.filter(o => o.status !== 'candidate').length + allLinks.filter(l => l.status !== 'candidate').length
  const accepted = confirmed.length + confirmedLinks.length
  const rules = store.rules(projectId).map(r => ({ id: r.id, name: r.definition.name, status: r.status, confirmed: r.stats.confirmed, judged: r.stats.judged, accuracy: r.stats.accuracy }))
  for (const r of rules) if (r.status === 'active' && r.accuracy !== null && r.judged > 0 && r.accuracy < 0.9) evidence.push(issue('warning', 'RULE_ACCURACY', r.id, `Rule "${r.name}" spot-check accuracy is ${(r.accuracy * 100).toFixed(0)}%.`))

  const linkedIds = new Set(allLinks.filter(l => l.status !== 'rejected').flatMap(l => [l.fromId, l.toId]))
  const orphanByType: Record<string, number> = {}
  let orphanConfirmed = 0
  for (const o of all) {
    if (linkedIds.has(o.id)) continue
    if (o.status === 'confirmed') orphanConfirmed++
    else if (o.status === 'candidate') orphanByType[o.type] = (orphanByType[o.type] ?? 0) + 1
  }

  const everything = [...structure, ...logic, ...evidence, ...smells, ...questionIssues]
  const count = (sev: Issue['severity']) => everything.filter(i => i.severity === sev).length
  return {
    schemaVersion: published.version,
    generatedAt: new Date().toISOString(),
    summary: { blocking: count('blocking'), warnings: count('warning'), hints: count('hint'), ready: count('blocking') === 0 },
    structure, logic, evidence, smells,
    questions: { issues: questionIssues, results, mustAnswered, mustTotal: must.length, regressions: results.filter(r => r.regression).map(r => r.questionId) },
    extraction: {
      candidates: all.filter(o => o.status === 'candidate').length + allLinks.filter(l => l.status === 'candidate').length,
      confirmed: accepted,
      rejected: decided - accepted,
      reviewAcceptance: decided ? accepted / decided : null,
      rules,
      droppedByValidation: store.droppedByValidation(projectId),
      codeLinks: { candidate: codeLinks.filter(l => l.status === 'candidate').length, confirmed: codeLinks.filter(l => l.status === 'confirmed').length, stale: codeLinks.filter(l => l.stale).length }
    },
    orphans: { candidates: Object.values(orphanByType).reduce((a, b) => a + b, 0), confirmed: orphanConfirmed, byType: orphanByType },
    method: METHOD
  }
}
