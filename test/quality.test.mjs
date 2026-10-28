import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../dist/core/store.js'
import { analyze } from '../dist/code/analyze.js'
import { qualityReport } from '../dist/core/quality.js'

const AUTH = { kind: 'approval', outcome: 'allowed-once', reason: 'test' }
const SCHEMA = {
  questions: [
    { id: 'q1', text: 'Which team owns a service?', priority: 'must' },
    { id: 'q2', text: 'What tier is each service?', priority: 'should' }
  ],
  objectTypes: [
    { apiName: 'Team', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }] },
    { apiName: 'Service', primaryKey: 'name', questions: ['q1', 'q2'], properties: [{ apiName: 'name', type: 'string' }, { apiName: 'tier', type: 'integer' }] }
  ],
  linkTypes: [{ apiName: 'owner', inverseApiName: 'services', from: 'Service', to: 'Team', cardinality: 'many-to-one', questions: ['q1'] }]
}
const DOC = 'The billing service (tier 1) is owned by the Payments team.'
const CODE = [{ path: 'src/billing.ts', text: 'export class BillingService {\n  charge() {}\n}\n' }]

async function setup() {
  const s = new Store(':memory:')
  const p = s.createProject('demo')
  s.setDraft(p.id, SCHEMA)
  s.publish(p.id, '', AUTH)
  const m = s.addMaterial(p.id, 'doc', DOC).material
  const e = q => [{ materialId: m.id, quote: q }]
  const r = s.assertCandidates(p.id, 'x', {
    objects: [{ type: 'Service', properties: { name: 'billing', tier: 1 }, evidence: e('billing service (tier 1)') }, { type: 'Team', properties: { name: 'Payments' }, evidence: e('Payments team') }],
    links: [{ linkType: 'owner', from: { type: 'Service', key: 'billing' }, to: { type: 'Team', key: 'Payments' }, evidence: e('owned by the Payments team') }]
  })
  return { s, p, r }
}

test('code snapshots store files as materials and code links cite the declaration', async () => {
  const { s, p, r } = await setup()
  const snap = s.addCodeSnapshot(p.id, '.', CODE, await analyze(CODE))
  assert.deepEqual(snap.stats, { modules: 1, symbols: 2, imports: 0, calls: 0, skipped: 0 })
  assert.ok(s.listMaterials(p.id).some(m => m.name === 'code:src/billing.ts'))
  assert.deepEqual(s.searchCode(p.id, { text: 'Billing', kind: 'class', limit: 10 }).symbols.map(x => x.ref), ['src/billing.ts#BillingService'])

  const billing = r.objects[0].id
  const linked = s.assertCodeLinks(p.id, 'agent', [
    { objectId: billing, codeRef: 'src/billing.ts#BillingService', relation: 'implementedBy' },
    { objectId: billing, codeRef: 'src/billing.ts#Missing', relation: 'implementedBy' },
    { objectId: billing, codeRef: 'src/billing.ts', relation: 'definedIn', quote: 'charge() {}' }
  ])
  assert.deepEqual(linked.results.map(x => x.outcome), ['created', 'failed', 'created'])
  const [cl] = s.codeLinks(p.id)
  assert.deepEqual(s.evidence(p.id, cl.id).map(e => [e.quote, e.role, e.line]), [['export class BillingService {', 'observed', 1]])

  // The object must be confirmed first, or in the same call.
  assert.equal(s.previewConfirm(p.id, [cl.id]).blocked[0].issues[0].code, 'ENDPOINT_NOT_CONFIRMED')
  assert.deepEqual(s.confirm(p.id, [billing, cl.id], AUTH).ready, [billing, cl.id])

  // A new snapshot without the class makes the link stale.
  s.addCodeSnapshot(p.id, '.', [{ path: 'src/billing.ts', text: 'export function charge() {}\n' }], await analyze([{ path: 'src/billing.ts', text: 'export function charge() {}\n' }]))
  assert.equal(s.codeLinks(p.id).find(l => l.id === cl.id).stale, true)
  assert.ok(qualityReport(s, p.id).evidence.some(i => i.code === 'STALE_CODE_LINK'))
})

test('competency questions run as regression tests', async () => {
  const { s, p, r } = await setup()
  assert.throws(() => s.setQuestionQuery(p.id, 'q9', { objectType: 'Team' }, { minResults: 1 }), /not in the published schema/)
  assert.throws(() => s.setQuestionQuery(p.id, 'q1', { objectType: 'Team', traverse: [{ link: 'nope' }] }, { minResults: 1 }), /no link/)
  s.setQuestionQuery(p.id, 'q1', { objectType: 'Team', traverse: [{ link: 'services' }] }, { minResults: 1, includes: ['billing'] })

  let [q1, q2] = s.runQuestions(p.id)
  assert.deepEqual([q1.status, q1.total, q1.missing], ['fail', 0, ['billing']])
  assert.equal(q2.status, 'no-query')

  s.confirm(p.id, [...r.objects.map(o => o.id), r.links[0].id], AUTH)
  ;[q1] = s.runQuestions(p.id)
  assert.equal(q1.status, 'pass')
  assert.equal(q1.regression, false)

  // Spot-check-style demotion: the link goes back to candidate and q1 regresses.
  s.db.prepare("UPDATE links SET status = 'candidate' WHERE id = ?").run(r.links[0].id)
  ;[q1] = s.runQuestions(p.id)
  assert.deepEqual([q1.status, q1.regression], ['fail', true])
})

test('quality report layers and readiness', async () => {
  const { s, p, r } = await setup()
  let report = qualityReport(s, p.id)
  assert.equal(report.summary.ready, false)
  assert.equal(report.questions.mustTotal, 1)
  assert.ok(report.questions.issues.some(i => i.code === 'NO_QUESTION_QUERY' && i.severity === 'blocking'))
  assert.ok(report.smells.some(i => i.code === 'EMPTY_TYPE'))
  assert.equal(report.extraction.candidates, 3)
  assert.match(report.method, /self-reported confidence is not used/)

  s.setQuestionQuery(p.id, 'q1', { objectType: 'Team', traverse: [{ link: 'services' }] }, { minResults: 1 })
  s.confirm(p.id, [...r.objects.map(o => o.id), r.links[0].id], AUTH)
  report = qualityReport(s, p.id)
  assert.deepEqual(report.logic, [])
  assert.equal(report.questions.mustAnswered, 1)
  assert.equal(report.summary.ready, true)
  assert.equal(report.extraction.reviewAcceptance, 1)
  assert.ok(report.evidence.every(i => i.severity === 'hint'))
})
