import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../dist/core/store.js'

const AUTH = { kind: 'approval', outcome: 'allowed-once', reason: 'test' }
const SCHEMA = {
  questions: [{ id: 'q1', text: 'Who works where?', priority: 'must' }],
  objectTypes: [
    { apiName: 'Person', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }, { apiName: 'title', type: 'string' }] },
    { apiName: 'Company', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }, { apiName: 'city', type: 'string', required: true }] }
  ],
  linkTypes: [{ apiName: 'employer', inverseApiName: 'employees', from: 'Person', to: 'Company', cardinality: 'many-to-one', questions: ['q1'] }]
}
const TEXT = 'Ada Lovelace is an engineer at Acme.\nAcme is based in London.\nBob also works at Acme.'

function setup() {
  const store = new Store(':memory:')
  const p = store.createProject('demo')
  store.setDraft(p.id, SCHEMA)
  store.publish(p.id, '', AUTH)
  const mat = store.addMaterial(p.id, 'doc.txt', TEXT).material
  return { store, p, mat }
}
const ev = (mat, quote, extra = {}) => [{ materialId: mat.id, quote, ...extra }]

test('publish requires approval, blocks on errors, and versions are immutable', () => {
  const store = new Store(':memory:')
  const p = store.createProject('demo')
  store.setDraft(p.id, SCHEMA)
  assert.throws(() => store.publish(p.id, '', { kind: 'approval', outcome: 'rejected', reason: 'x' }), /approval/)
  const v1 = store.publish(p.id, '', AUTH)
  assert.equal(v1.version, 1)
  assert.throws(() => store.publish(p.id, '', AUTH), /identical/)
  store.setDraft(p.id, { ...SCHEMA, linkTypes: [{ ...SCHEMA.linkTypes[0], to: 'Nowhere' }] })
  assert.throws(() => store.publish(p.id, '', AUTH), /cannot be published/)
  assert.throws(() => store.db.exec('UPDATE schema_versions SET note = 1'), /immutable/)
  assert.throws(() => store.db.exec('DELETE FROM audit'), /append-only/)
  store.addMaterial(p.id, 'doc.txt', TEXT)
  assert.throws(() => store.db.exec("UPDATE materials SET text = 'x'"), /read-only/)
})

test('warnings need a publish note', () => {
  const store = new Store(':memory:')
  const p = store.createProject('demo')
  const strip = ({ questions, ...rest }) => rest
  store.setDraft(p.id, { questions: [], objectTypes: SCHEMA.objectTypes.map(strip), linkTypes: SCHEMA.linkTypes.map(strip) })
  assert.ok(store.publishCheck(p.id).blocking.some(i => i.code === 'NOTE_REQUIRED'))
  assert.equal(store.publish(p.id, 'questions come later', AUTH).version, 1)
})

test('materials are content-addressed', () => {
  const { store, p, mat } = setup()
  assert.equal(mat.sha256.length, 64)
  const again = store.addMaterial(p.id, 'copy.txt', TEXT)
  assert.equal(again.created, false)
  assert.equal(again.material.id, mat.id)
})

test('candidates need verbatim quotes', () => {
  const { store, p, mat } = setup()
  const r = store.assertCandidates(p.id, 'test', { objects: [
    { type: 'Person', properties: { name: 'Ada Lovelace', title: 'engineer' }, evidence: ev(mat, 'Ada Lovelace is an engineer') },
    { type: 'Person', properties: { name: 'Eve' }, evidence: ev(mat, 'Eve is the CEO') },
    { type: 'Person', properties: { name: 'Nobody' }, evidence: [] },
    { type: 'Robot', properties: { name: 'R2' }, evidence: ev(mat, 'Acme') }
  ] })
  assert.deepEqual(r.objects.map(o => o.outcome), ['created', 'failed', 'failed', 'failed'])
  assert.equal(r.objects[1].issues[0].code, 'QUOTE_NOT_FOUND')
  assert.equal(r.objects[2].issues[0].code, 'NO_EVIDENCE')
  assert.equal(store.objects(p.id).length, 1)
  assert.equal(store.objects(p.id)[0].status, 'candidate')
  assert.equal(store.evidence(p.id, r.objects[0].id)[0].line, 1)
})

test('merging fills gaps and reports conflicts', () => {
  const { store, p, mat } = setup()
  store.assertCandidates(p.id, 'a', { objects: [{ type: 'Company', properties: { name: 'Acme' }, evidence: ev(mat, 'at Acme') }] })
  const r = store.assertCandidates(p.id, 'b', { objects: [{ type: 'Company', properties: { name: 'Acme', city: 'London' }, evidence: ev(mat, 'based in London', { field: 'city' }) }] })
  assert.equal(r.objects[0].outcome, 'merged')
  assert.equal(store.objects(p.id)[0].properties.city, 'London')
  const c = store.assertCandidates(p.id, 'c', { objects: [{ type: 'Company', properties: { name: 'Acme', city: 'Paris' }, evidence: ev(mat, 'Acme') }] })
  assert.equal(c.objects[0].issues[0].code, 'CONFLICTING_VALUE')
  assert.equal(store.objects(p.id)[0].properties.city, 'London')
})

test('confirmation is gated on completeness, evidence role and endpoints', () => {
  const { store, p, mat } = setup()
  const r = store.assertCandidates(p.id, 'x', {
    objects: [
      { type: 'Person', properties: { name: 'Ada Lovelace' }, evidence: ev(mat, 'Ada Lovelace') },
      { type: 'Person', properties: { name: 'Bob' }, evidence: ev(mat, 'Bob', { role: 'inferred' }) },
      { type: 'Company', properties: { name: 'Acme' }, evidence: ev(mat, 'Acme') }
    ],
    links: [{ linkType: 'employer', from: { type: 'Person', key: 'Ada Lovelace' }, to: { type: 'Company', key: 'Acme' }, evidence: ev(mat, 'engineer at Acme') }]
  })
  const [ada, bob, acme] = r.objects.map(o => o.id)
  const link = r.links[0].id
  assert.throws(() => store.confirm(p.id, [ada], { kind: 'rule', reason: 'x' }), /approval/)
  const preview = store.previewConfirm(p.id, [ada, bob, acme, link])
  assert.deepEqual(preview.ready, [ada])
  const codes = Object.fromEntries(preview.blocked.map(b => [b.id, b.issues.map(i => i.code)]))
  assert.deepEqual(codes[bob], ['ONLY_INFERRED'])
  assert.deepEqual(codes[acme], ['MISSING_REQUIRED'])
  assert.deepEqual(codes[link], ['ENDPOINT_NOT_CONFIRMED'])
  store.confirm(p.id, [ada], AUTH)
  assert.deepEqual(store.objects(p.id, { status: ['confirmed'] }).map(o => o.id), [ada])
  assert.equal(store.previewConfirm(p.id, [ada]).blocked[0].issues[0].code, 'NOT_CANDIDATE')
  assert.ok(store.auditLog(p.id).some(a => a.action === 'review.confirm'))
})

test('links respect cardinality among confirmed links', () => {
  const { store, p, mat } = setup()
  const city = { city: 'London' }
  const r = store.assertCandidates(p.id, 'x', {
    objects: [
      { type: 'Person', properties: { name: 'Bob' }, evidence: ev(mat, 'Bob') },
      { type: 'Company', properties: { name: 'Acme', ...city }, evidence: ev(mat, 'Acme is based in London') },
      { type: 'Company', properties: { name: 'London', ...city }, evidence: ev(mat, 'London') }
    ],
    links: [
      { linkType: 'employer', from: { type: 'Person', key: 'Bob' }, to: { type: 'Company', key: 'Acme' }, evidence: ev(mat, 'Bob also works at Acme') },
      { linkType: 'employer', from: { type: 'Person', key: 'Bob' }, to: { type: 'Company', key: 'London' }, evidence: ev(mat, 'London') },
      { linkType: 'employer', from: { type: 'Person', key: 'Nobody' }, to: { type: 'Company', key: 'Acme' }, evidence: ev(mat, 'Acme') }
    ]
  })
  assert.equal(r.links[1].issues[0].code, 'CARDINALITY')
  assert.equal(r.links[2].issues[0].code, 'UNKNOWN_ENDPOINT')
  const ids = [...r.objects.map(o => o.id), r.links[0].id, r.links[1].id]
  const done = store.confirm(p.id, ids, AUTH)
  assert.equal(done.ready.length, 4)
  assert.equal(done.blocked[0].id, r.links[1].id)
})

test('rejected records stay rejected', () => {
  const { store, p, mat } = setup()
  const r = store.assertCandidates(p.id, 'x', { objects: [{ type: 'Person', properties: { name: 'Bob' }, evidence: ev(mat, 'Bob') }] })
  store.reject(p.id, [r.objects[0].id], 'not a person', AUTH)
  const again = store.assertCandidates(p.id, 'y', { objects: [{ type: 'Person', properties: { name: 'Bob' }, evidence: ev(mat, 'Bob') }] })
  assert.equal(again.objects[0].issues[0].code, 'PREVIOUSLY_REJECTED')
})

test('batch rollback restores the previous state', () => {
  const { store, p, mat } = setup()
  const a = store.assertCandidates(p.id, 'a', { objects: [{ type: 'Company', properties: { name: 'Acme' }, evidence: ev(mat, 'Acme') }] })
  const b = store.assertCandidates(p.id, 'b', {
    objects: [{ type: 'Company', properties: { name: 'Acme', city: 'London' }, evidence: ev(mat, 'London') }, { type: 'Person', properties: { name: 'Bob' }, evidence: ev(mat, 'Bob') }],
    links: [{ linkType: 'employer', from: { type: 'Person', key: 'Bob' }, to: { type: 'Company', key: 'Acme' }, evidence: ev(mat, 'Bob also works at Acme') }]
  })
  assert.throws(() => store.rollbackBatch(p.id, a.batchId), /roll that batch back first/)
  assert.deepEqual(store.rollbackBatch(p.id, b.batchId), { objects: 1, links: 1, evidence: 3 })
  const objects = store.objects(p.id)
  assert.equal(objects.length, 1)
  assert.equal(objects[0].properties.city, undefined)
  assert.equal(store.evidence(p.id, objects[0].id).length, 1)
  store.confirm(p.id, [objects[0].id], AUTH)
  // Acme lacks a required city, so it stays a candidate; confirm a fully specified record instead.
  const c = store.assertCandidates(p.id, 'c', { objects: [{ type: 'Person', properties: { name: 'Bob' }, evidence: ev(mat, 'Bob') }] })
  store.confirm(p.id, [c.objects[0].id], AUTH)
  const d = store.assertCandidates(p.id, 'd', { objects: [{ type: 'Person', properties: { name: 'Bob', title: 'staff' }, evidence: ev(mat, 'works') }] })
  assert.throws(() => store.rollbackBatch(p.id, d.batchId), /confirmed/)
})
