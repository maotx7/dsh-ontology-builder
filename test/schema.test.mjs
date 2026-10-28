import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSchema, validateProperties, validateSchema } from '../dist/core/schema.js'

const base = () => ({
  questions: [{ id: 'q1', text: 'Which company employs a person?', priority: 'must' }],
  objectTypes: [
    { apiName: 'Person', primaryKey: 'id', titleProperty: 'name', questions: ['q1'], properties: [
      { apiName: 'id', type: 'string' }, { apiName: 'name', type: 'string', required: true }
    ] },
    { apiName: 'Company', primaryKey: 'id', questions: ['q1'], properties: [
      { apiName: 'id', type: 'string' }, { apiName: 'founded', type: 'date' }
    ] }
  ],
  linkTypes: [{ apiName: 'employer', inverseApiName: 'employees', from: 'Person', to: 'Company', cardinality: 'many-to-one', questions: ['q1'] }]
})
const codes = (schema, severity) => validateSchema(normalizeSchema(schema)).filter(i => !severity || i.severity === severity).map(i => i.code)

test('a well-formed schema has no blocking issues or warnings', () => {
  assert.deepEqual(codes(base(), 'blocking'), [])
  assert.deepEqual(codes(base(), 'warning'), [])
})

test('structural errors are blocking', () => {
  const s = base()
  s.objectTypes.push({ apiName: 'Person', primaryKey: 'id', properties: [{ apiName: 'id', type: 'string' }] })
  s.objectTypes[1].properties.push({ apiName: 'founded', type: 'date' }, { apiName: 'size', type: 'bigint' })
  s.objectTypes[0].primaryKey = 'missing'
  s.linkTypes.push({ apiName: 'owner', inverseApiName: 'owned', from: 'Person', to: 'Nowhere', cardinality: 'lots' })
  s.linkTypes.push({ apiName: 'name', inverseApiName: 'x', from: 'Person', to: 'Company', cardinality: 'one-to-one' })
  const found = codes(s, 'blocking')
  for (const code of ['DUPLICATE_OBJECT_TYPE', 'DUPLICATE_PROPERTY', 'INVALID_PROPERTY_TYPE', 'MISSING_PRIMARY_KEY', 'UNKNOWN_LINK_ENDPOINT', 'INVALID_CARDINALITY', 'DUPLICATE_MEMBER']) {
    assert.ok(found.includes(code), `expected ${code} in ${found}`)
  }
})

test('modelling smells and question coverage are warnings', () => {
  const s = base()
  s.questions.push({ id: 'q2', text: 'Where is a company located?', priority: 'must' })
  s.objectTypes.push({ apiName: 'Thing', primaryKey: 'id', properties: [{ apiName: 'id', type: 'string' }] })
  s.objectTypes[0].questions = ['q9']
  const warnings = codes(s, 'warning')
  assert.ok(warnings.includes('GENERIC_TYPE_NAME'))
  assert.ok(warnings.includes('UNTRACED_TYPE'))
  assert.ok(warnings.includes('UNCOVERED_QUESTION'))
  assert.ok(codes(s, 'blocking').includes('UNKNOWN_QUESTION'))
})

test('normalizeSchema tolerates garbage input', () => {
  assert.deepEqual(normalizeSchema(null), { questions: [], objectTypes: [], linkTypes: [] })
  const issues = validateSchema(normalizeSchema({ objectTypes: [{ apiName: 'A', primaryKey: 'id', properties: 'nope' }] }))
  assert.ok(issues.some(i => i.code === 'MISSING_PRIMARY_KEY'))
})

test('validateProperties checks values against the type', () => {
  const person = normalizeSchema(base()).objectTypes[0]
  assert.deepEqual(validateProperties(person, { id: 'p1', name: 'Ada' }), [])
  const issues = validateProperties(person, { id: 'p1', name: 3, age: 4 })
  assert.deepEqual(issues.map(i => i.code).sort(), ['INVALID_VALUE', 'UNKNOWN_PROPERTY'])
  assert.ok(validateProperties(person, { id: 'p1' }).some(i => i.code === 'MISSING_REQUIRED' && i.severity === 'warning'))
  const company = normalizeSchema(base()).objectTypes[1]
  assert.equal(validateProperties(company, { id: 'c', founded: '2020-13-40' })[0].code, 'INVALID_VALUE')
})
