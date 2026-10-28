import test from 'node:test'
import assert from 'node:assert/strict'
import { Parser } from 'n3'
import { Store } from '../dist/core/store.js'
import { runQuery } from '../dist/core/query.js'
import { toJsonLd, toTurtle } from '../dist/core/export.js'

const AUTH = { kind: 'approval', outcome: 'allowed-once', reason: 'test' }
const SCHEMA = {
  questions: [{ id: 'q1', text: 'Who works where?', priority: 'must' }],
  objectTypes: [
    { apiName: 'Person', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }, { apiName: 'age', type: 'integer' }] },
    { apiName: 'Company', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }, { apiName: 'city', type: 'string', enum: ['London', 'Paris'] }] }
  ],
  linkTypes: [{ apiName: 'employer', inverseApiName: 'employees', from: 'Person', to: 'Company', cardinality: 'many-to-one', questions: ['q1'] }]
}
const TEXT = 'Ada (36) works at Acme in London. Bob (41) works at Acme. Cy (29) works at Initech in Paris. "Quoted" Dee is new.'

function build() {
  const store = new Store(':memory:')
  const p = store.createProject('demo')
  store.setDraft(p.id, SCHEMA)
  store.publish(p.id, '', AUTH)
  const m = store.addMaterial(p.id, 'doc', TEXT).material
  const e = q => [{ materialId: m.id, quote: q }]
  const person = (name, age) => ({ type: 'Person', properties: { name, age }, evidence: e(`${name} (${age})`) })
  const works = (name, company) => ({ linkType: 'employer', from: { type: 'Person', key: name }, to: { type: 'Company', key: company }, evidence: e(`works at ${company}`) })
  const r = store.assertCandidates(p.id, 't', {
    objects: [person('Ada', 36), person('Bob', 41), person('Cy', 29),
      { type: 'Company', properties: { name: 'Acme', city: 'London' }, evidence: e('Acme in London') },
      { type: 'Company', properties: { name: 'Initech', city: 'Paris' }, evidence: e('Initech in Paris') },
      { type: 'Person', properties: { name: '"Quoted" Dee' }, evidence: e('"Quoted" Dee') }],
    links: [works('Ada', 'Acme'), works('Bob', 'Acme'), works('Cy', 'Initech')]
  })
  // Leave Cy's link as a candidate.
  store.confirm(p.id, [...r.objects.map(o => o.id), r.links[0].id, r.links[1].id], AUTH)
  const data = { schema: store.published(p.id).schema, objects: store.objects(p.id), links: store.links(p.id) }
  return { store, p, data }
}

test('filters, traversal and status visibility', () => {
  const { data } = build()
  const older = runQuery(data, { objectType: 'Person', where: { property: 'age', op: 'gte', value: 36 } })
  assert.deepEqual(older.objects.map(o => o.key), ['Ada', 'Bob'])
  const london = runQuery(data, { objectType: 'Company', where: { property: 'city', op: 'eq', value: 'London' }, traverse: [{ link: 'employees' }] })
  assert.equal(london.objectType, 'Person')
  assert.deepEqual(london.objects.map(o => o.key).sort(), ['Ada', 'Bob'])
  const employers = runQuery(data, { objectType: 'Person', where: { or: [{ property: 'name', op: 'eq', value: 'Cy' }, { property: 'name', op: 'eq', value: 'Ada' }] }, traverse: [{ link: 'employer' }] })
  assert.deepEqual(employers.objects.map(o => o.key), ['Acme'])
  const withDraft = runQuery(data, { objectType: 'Person', where: { property: 'name', op: 'eq', value: 'Cy' }, traverse: [{ link: 'employer' }], status: ['confirmed', 'candidate'] })
  assert.deepEqual(withDraft.objects.map(o => o.key), ['Initech'])
})

test('aggregation and input errors', () => {
  const { data } = build()
  const perCompany = runQuery(data, { objectType: 'Company', traverse: [{ link: 'employees' }], aggregate: { metric: 'avg', property: 'age' } })
  assert.deepEqual(perCompany.groups, [{ key: null, value: 38.5 }])
  const count = runQuery(data, { objectType: 'Company', aggregate: { groupBy: 'city', metric: 'count' } })
  assert.deepEqual(count.groups.map(g => g.key).sort(), ['London', 'Paris'])
  assert.throws(() => runQuery(data, { objectType: 'Robot' }), /Unknown object type/)
  assert.throws(() => runQuery(data, { objectType: 'Person', where: { property: 'salary', op: 'gt', value: 1 } }), /Unknown property/)
  assert.throws(() => runQuery(data, { objectType: 'Person', traverse: [{ link: 'employees' }] }), /no link/)
})

test('turtle output is valid RDF with schema, shapes, instances and provenance', () => {
  const { store, p } = build()
  const data = { base: 'https://example.org/demo/', version: 1, schema: store.published(p.id).schema, objects: store.objects(p.id, { status: ['confirmed'] }), links: store.links(p.id, { status: ['confirmed'] }), evidence: [] }
  data.evidence = data.objects.flatMap(o => store.evidence(p.id, o.id))
  const ttl = toTurtle(data)
  const quads = new Parser({ baseIRI: data.base }).parse(ttl)
  const has = (s, pr, o) => quads.some(q => (!s || q.subject.value === s) && q.predicate.value === pr && (!o || q.object.value === o))
  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
  assert.ok(has('https://example.org/demo/Person', RDF, 'http://www.w3.org/2002/07/owl#Class'))
  assert.ok(has('https://example.org/demo/employer', RDF, 'http://www.w3.org/2002/07/owl#FunctionalProperty'))
  assert.ok(has('https://example.org/demo/Person/Ada', 'https://example.org/demo/employer', 'https://example.org/demo/Company/Acme'))
  assert.ok(has('https://example.org/demo/Person/%22Quoted%22%20Dee', RDF, 'https://example.org/demo/Person'))
  assert.ok(has(null, 'http://www.w3.org/ns/prov#value', 'Ada (36)'))
  assert.ok(has(null, 'http://www.w3.org/ns/shacl#in'))
  assert.ok(!ttl.includes('Initech/Cy'))
})

test('json-ld output links objects and keeps evidence', () => {
  const { store, p } = build()
  const objects = store.objects(p.id, { status: ['confirmed'] })
  const doc = toJsonLd({ base: 'https://example.org/demo/', version: 1, schema: store.published(p.id).schema, objects, links: store.links(p.id, { status: ['confirmed'] }), evidence: objects.flatMap(o => store.evidence(p.id, o.id)) })
  const ada = doc['@graph'].find(n => n['@id'] === 'https://example.org/demo/Person/Ada')
  assert.deepEqual(ada.employer, ['https://example.org/demo/Company/Acme'])
  assert.equal(ada['Person.age'], 36)
  assert.equal(ada['prov:wasDerivedFrom'][0]['prov:value'], 'Ada (36)')
  assert.equal(doc['@context'].employer['@type'], '@id')
})
