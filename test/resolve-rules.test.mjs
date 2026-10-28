import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from '../dist/core/store.js'
import { normalizeKey, similarity, suggestDuplicates } from '../dist/core/resolve.js'

const AUTH = { kind: 'approval', outcome: 'allowed-once', reason: 'test' }
const SCHEMA = {
  questions: [],
  objectTypes: [
    { apiName: 'Person', primaryKey: 'name', properties: [{ apiName: 'name', type: 'string' }, { apiName: 'title', type: 'string' }] },
    { apiName: 'Company', primaryKey: 'name', properties: [{ apiName: 'name', type: 'string' }, { apiName: 'city', type: 'string' }] }
  ],
  linkTypes: [{ apiName: 'employer', inverseApiName: 'employees', from: 'Person', to: 'Company', cardinality: 'many-to-one' }]
}
const A = 'Ada Lovelace is the CTO of Acme Corp in London.\nACME CORP was founded long ago.'
const B = 'Acme Corporation, Paris office. Ada Lovelace leads engineering at Acme Corp.'

function setup() {
  const s = new Store(':memory:')
  const p = s.createProject('demo')
  s.setDraft(p.id, SCHEMA)
  s.publish(p.id, 'no questions in this fixture', AUTH)
  const a = s.addMaterial(p.id, 'a', A).material
  const b = s.addMaterial(p.id, 'b', B).material
  const e = (m, quote, extra = {}) => [{ materialId: m.id, quote, ...extra }]
  return { s, p, a, b, e }
}

test('normalization and similarity', () => {
  assert.equal(normalizeKey('  ＡＣＭＥ   Corp '), 'acme corp')
  assert.ok(similarity('Acme Corp', 'Acme Corporation') >= 0.5)
  assert.ok(similarity('Acme Corp', 'Initech') < 0.3)
  assert.ok(similarity('北京大学', '北京大学医学部') > 0.5)
  const pairs = suggestDuplicates([
    { id: '1', type: 'C', label: 'Acme Corp' }, { id: '2', type: 'C', label: 'Acme Corp.' }, { id: '3', type: 'C', label: 'Initech' }, { id: '4', type: 'P', label: 'Acme Corp' }
  ], 0.8, 10)
  assert.deepEqual(pairs.map(p => [p.a, p.b]), [['1', '2']])
})

test('normalized keys resolve to the same object; differing values become conflicts', () => {
  const { s, p, a, b, e } = setup()
  s.assertCandidates(p.id, 'x', { objects: [{ type: 'Company', properties: { name: 'Acme Corp', city: 'London' }, evidence: e(a, 'Acme Corp in London') }] })
  const r = s.assertCandidates(p.id, 'y', { objects: [
    { type: 'Company', properties: { name: 'ACME CORP' }, evidence: e(a, 'ACME CORP was founded') },
    { type: 'Company', properties: { name: 'acme corp', city: 'Paris' }, evidence: e(b, 'Acme Corp') }
  ] })
  assert.deepEqual(r.objects.map(o => o.outcome), ['merged', 'merged'])
  assert.equal(s.objects(p.id).length, 1)
  const [conflict] = s.conflicts(p.id)
  assert.deepEqual([conflict.field, conflict.kept, conflict.other], ['city', 'London', 'Paris'])
  const id = s.objects(p.id)[0].id
  assert.equal(s.previewConfirm(p.id, [id]).blocked[0].issues[0].code, 'UNRESOLVED_CONFLICT')
  s.resolveConflict(p.id, conflict.id, 'other', AUTH)
  assert.equal(s.objects(p.id)[0].properties.city, 'Paris')
  assert.deepEqual(s.previewConfirm(p.id, [id]).ready, [id])
  assert.throws(() => s.rollbackBatch(p.id, r.batchId), /already resolved/)
})

test('merging moves evidence and links, and leaves an alias', () => {
  const { s, p, a, b, e } = setup()
  const r = s.assertCandidates(p.id, 'x', {
    objects: [
      { type: 'Person', properties: { name: 'Ada Lovelace', title: 'CTO' }, evidence: e(a, 'Ada Lovelace is the CTO') },
      { type: 'Company', properties: { name: 'Acme Corp' }, evidence: e(a, 'Acme Corp') },
      { type: 'Company', properties: { name: 'Acme Corporation', city: 'Paris' }, evidence: e(b, 'Acme Corporation, Paris') }
    ],
    links: [
      { linkType: 'employer', from: { type: 'Person', key: 'Ada Lovelace' }, to: { type: 'Company', key: 'Acme Corp' }, evidence: e(a, 'CTO of Acme Corp') },
      { linkType: 'employer', from: { type: 'Person', key: 'Ada Lovelace' }, to: { type: 'Company', key: 'Acme Corporation' }, evidence: e(b, 'engineering at Acme Corp') }
    ]
  })
  const [, acme, acmeCorp] = r.objects.map(o => o.id)
  const suggested = s.duplicates(p.id, { threshold: 0.5, limit: 10 })
  assert.deepEqual([suggested[0].a, suggested[0].b].sort(), [acme, acmeCorp].sort())
  assert.throws(() => s.mergeObjects(p.id, acme, acmeCorp, { kind: 'rule' }), /approval/)
  const m = s.mergeObjects(p.id, acme, acmeCorp, AUTH)
  assert.equal(m.droppedLinks, 1)
  assert.equal(s.objects(p.id, { type: 'Company' }).length, 1)
  assert.equal(s.objects(p.id, { type: 'Company' })[0].properties.city, 'Paris')
  assert.equal(s.links(p.id).length, 1)
  assert.equal(s.evidence(p.id, acme).length, 2)
  assert.equal(s.evidence(p.id, s.links(p.id)[0].id).length, 2)
  const later = s.assertCandidates(p.id, 'z', { objects: [{ type: 'Company', properties: { name: 'acme corporation' }, evidence: e(b, 'Acme Corporation') }] })
  assert.equal(later.objects[0].id, acme)
  assert.equal(later.objects[0].issues[0].code, 'MATCHED_EXISTING')
  assert.throws(() => s.rollbackBatch(p.id, r.batchId), /merged/)
  s.markDistinct(p.id, acme, r.objects[0].id)
  assert.equal(s.duplicates(p.id, { threshold: 0.5, limit: 10 }).length, 0)
})

test('rules confirm only what qualifies, sample, and disable themselves', () => {
  const { s, p, a, b, e } = setup()
  const r = s.assertCandidates(p.id, 'llm:x', { objects: [
    { type: 'Person', properties: { name: 'Ada Lovelace' }, evidence: [...e(a, 'Ada Lovelace'), ...e(b, 'Ada Lovelace leads')] },
    { type: 'Company', properties: { name: 'Acme Corp' }, evidence: e(a, 'Acme Corp') },
    { type: 'Company', properties: { name: 'Acme Corporation' }, evidence: e(b, 'Acme Corporation', { role: 'inferred' }) }
  ] })
  const rule = { name: 'corroborated', objectType: 'Person', roles: ['specified'], minEvidence: 2, minSources: 2, sampleRate: 0.01, minAccuracy: 0.9, minSamples: 1 }
  assert.throws(() => s.addRule(p.id, { ...rule, roles: ['inferred'] }, AUTH), /Inferred/)
  assert.throws(() => s.addRule(p.id, { ...rule, sampleRate: 0 }, AUTH), /sampleRate/)
  assert.throws(() => s.addRule(p.id, rule, { kind: 'approval', outcome: 'rejected', reason: '' }), /approval/)
  assert.deepEqual(s.matchDefinition(p.id, rule).ready, [r.objects[0].id])
  const company = { ...rule, name: 'any company', objectType: 'Company', minEvidence: 1, minSources: 1, roles: ['specified', 'observed'] }
  assert.deepEqual(s.matchDefinition(p.id, company).ready, [r.objects[1].id])
  assert.deepEqual(s.matchDefinition(p.id, { ...company, extractors: ['someone-else'] }).ready, [])

  const added = s.addRule(p.id, rule, AUTH)
  const applied = s.applyRule(p.id, added.id)
  assert.deepEqual(applied.confirmed, [r.objects[0].id])
  assert.deepEqual(applied.sampled, [r.objects[0].id])
  const ada = s.objects(p.id, { status: ['confirmed'] })[0]
  assert.equal(ada.id, r.objects[0].id)
  assert.equal(s.ruleStats(added.id).confirmed, 1)
  assert.deepEqual(s.pendingSamples(p.id), [{ ruleId: added.id, targetId: ada.id }])

  const judged = s.judgeSample(p.id, added.id, ada.id, 'wrong', 'not this Ada', AUTH)
  assert.equal(judged.disabled, true)
  assert.equal(s.rule(p.id, added.id).status, 'disabled')
  assert.equal(s.objects(p.id, { status: ['candidate'] }).find(o => o.id === ada.id).id, ada.id)
  assert.throws(() => s.applyRule(p.id, added.id), /disabled/)
  const actions = s.auditLog(p.id).map(x => x.action)
  for (const action of ['rule.add', 'rule.confirm', 'rule.judge', 'rule.disable']) assert.ok(actions.includes(action), action)
})
