import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkText } from '../dist/extract/chunk.js'
import { checkSubmission, diagnose, extractChunk, systemPrompt } from '../dist/extract/extract.js'

const SCHEMA = {
  questions: [],
  objectTypes: [
    { apiName: 'Person', primaryKey: 'name', properties: [{ apiName: 'name', type: 'string' }, { apiName: 'role', type: 'string', enum: ['engineer', 'manager'] }] },
    { apiName: 'Company', primaryKey: 'name', properties: [{ apiName: 'name', type: 'string' }] }
  ],
  linkTypes: [{ apiName: 'employer', inverseApiName: 'employees', from: 'Person', to: 'Company', cardinality: 'many-to-one' }]
}
const TEXT = 'Ada is an engineer at Acme.\nBob manages the Acme team.'
const chunk = { index: 0, start: 100, end: 100 + TEXT.length, text: TEXT }

test('chunks cover the text, overlap, and end on line breaks', () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(30)}`).join('\n')
  const chunks = chunkText(text, 1000, 200)
  assert.equal(chunks[0].start, 0)
  assert.equal(chunks.at(-1).end, text.length)
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].start < chunks[i - 1].end, 'overlaps')
    assert.ok(chunks[i].start > chunks[i - 1].start, 'advances')
    assert.equal(text[chunks[i].start - 1], '\n', 'starts on a line')
  }
  for (const c of chunks.slice(0, -1)) assert.equal(text[c.end - 1], '\n')
  assert.deepEqual(chunkText('short', 1000, 100), [{ index: 0, start: 0, end: 5, text: 'short' }])
})

test('prompt lists the schema', () => {
  const p = systemPrompt(SCHEMA, 'Use full names.')
  assert.match(p, /Person\n    - name: string \(primary key\)/)
  assert.match(p, /employer: Person → Company \(many-to-one\)/)
  assert.match(p, /Use full names/)
})

test('submissions are checked against schema and passage', () => {
  const r = checkSubmission(SCHEMA, chunk, 'mat_1', {
    objects: [
      { type: 'Person', properties: { name: 'Ada', role: 'engineer' }, quote: 'Ada is an engineer', fieldQuotes: { role: 'engineer', bogus: 'x' } },
      { type: 'Person', properties: { name: 'Bob', role: 'boss' }, quote: 'Bob manages' },
      { type: 'Person', properties: { name: 'Eve' }, quote: 'Eve is the CEO' },
      { type: 'Robot', properties: { name: 'R2' }, quote: 'Acme' },
      { type: 'Company', properties: { name: 'Acme' }, quote: 'at  Acme.' }
    ],
    links: [
      { linkType: 'employer', from: { type: 'Person', key: 'Ada' }, to: { type: 'Company', key: 'Acme' }, quote: 'engineer at Acme' },
      { linkType: 'employer', from: { type: 'Company', key: 'Acme' }, to: { type: 'Person', key: 'Ada' }, quote: 'Acme' }
    ]
  })
  assert.deepEqual(r.objects.map(o => o.properties.name), ['Ada', 'Acme'])
  assert.equal(r.objects[0].evidence.length, 2)
  assert.deepEqual(r.objects[0].evidence[0], { materialId: 'mat_1', quote: 'Ada is an engineer', role: 'specified', near: 100 })
  assert.equal(r.links.length, 1)
  assert.equal(r.problems.length, 4)
  assert.match(r.problems.join('\n'), /role must be one of/)
  assert.match(r.problems.join('\n'), /not in the passage/)
  assert.match(r.problems.join('\n'), /unknown type "Robot"/)
  assert.match(r.problems.join('\n'), /goes from Person to Company/)
})

test('extraction retries with the problems and keeps the best attempt', async () => {
  const replies = [
    { call: { objects: [{ type: 'Person', properties: { name: 'Ada' }, quote: 'Ada was hired' }], links: [] } },
    { call: { objects: [{ type: 'Person', properties: { name: 'Ada' }, quote: 'Ada is an engineer' }], links: [] } }
  ]
  const seen = []
  const model = async req => { seen.push(req); return replies.shift() ?? { text: '' } }
  const r = await extractChunk({ model, schema: SCHEMA, chunk, materialId: 'm', materialName: 'doc', maxAttempts: 3 })
  assert.equal(r.attempts, 2)
  assert.deepEqual(r.problems, [])
  assert.equal(r.objects.length, 1)
  assert.equal(seen[1].turns.length, 3)
  assert.match(seen[1].turns[2].text, /Ada was hired/)
})

test('extraction stops early when the model chats instead of calling the tool', async () => {
  const model = async () => ({ text: 'I think Ada works at Acme.' })
  const r = await extractChunk({ model, schema: SCHEMA, chunk, materialId: 'm', materialName: 'doc', maxAttempts: 3 })
  assert.equal(r.attempts, 2)
  assert.deepEqual(r.objects, [])
  assert.match(r.problems[0], /hijacked by the template/)
})

test('diagnose flags a reasoning-heavy call cut by max-tokens', () => {
  const d = diagnose({ text: '', diagnostics: { finishReason: 'max-tokens', reasoningChars: 1200, reasoningTokens: 900, toolCallAttempted: false } }, 1, 16000)
  assert.equal(d.fatal, true)
  assert.match(d.problem, /Reasoning\/budget problem/)
  assert.match(d.problem, /reasoningEffort/)
})

test('diagnose flags a hijacked tool call after consecutive text-only turns', () => {
  const d = diagnose({ text: 'here is some prose', diagnostics: { finishReason: 'stop', textChars: 20, toolCallAttempted: false } }, 2, 16000)
  assert.equal(d.fatal, true)
  assert.match(d.problem, /hijacked by the template/)
  assert.match(d.problem, /chat_template/)
})

test('a max-tokens cut retries once with a larger budget', async () => {
  const budgets = []
  const model = async req => {
    budgets.push(req.maxTokens)
    if (budgets.length === 1) return { text: '', diagnostics: { finishReason: 'max-tokens', outputTokens: 16000, toolCallAttempted: false } }
    return { call: { objects: [{ type: 'Person', properties: { name: 'Ada' }, quote: 'Ada is an engineer' }], links: [] } }
  }
  const r = await extractChunk({ model, schema: SCHEMA, chunk, materialId: 'm', materialName: 'doc', maxAttempts: 3, maxTokens: 16000 })
  assert.deepEqual(budgets, [16000, 24000])
  assert.equal(r.attempts, 2)
  assert.equal(r.objects.length, 1)
})
