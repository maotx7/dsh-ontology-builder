import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as plugin from '../dist/index.js'

/** Fake ctx.llm: each call pops the next scripted reply ({ call } or { text }). */
export function fakeLlm(replies) {
  const requests = []
  return {
    requests,
    async *stream(options) {
      requests.push(options)
      const reply = replies.shift() ?? { text: 'nothing' }
      if (reply.call) {
        const args = JSON.stringify(reply.call)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: 'tc1', name: 'submit_extraction', argumentsDelta: args.slice(0, 10) }
        yield { type: 'tool-call-delta', index: 0, id: 'tc1', argumentsDelta: args.slice(10) }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'tc1', name: 'submit_extraction', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else if (reply.fail) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: reply.fail, code: 'X' } } }
      } else {
        yield { type: 'text-delta', index: 0, text: reply.text }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
}

function fakeContext(answer = 'allowed-once', replies = []) {
  const registered = new Map()
  const disposers = []
  const asked = []
  return {
    registered,
    asked,
    dispose: () => disposers.reverse().forEach(d => d?.()),
    tools: { register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name) } },
    approval: { async request(req) { asked.push(req); return typeof answer === 'function' ? answer(req) : answer } },
    llm: fakeLlm(replies),
    agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake-1' }) },
    effect(fn) { disposers.push(fn()) },
    // Headless: no web server, so the UI route is never registered.
    inject() {}
  }
}

function withWorkspace(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'obtest-'))
    const cwd = process.cwd()
    process.chdir(dir)
    try { await fn(dir) } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) }
  }
}

const exec = { agent: { id: 'a' }, callId: 'call_1' }
const SCHEMA = {
  questions: [{ id: 'q1', text: 'Which team owns a service?', priority: 'must' }],
  objectTypes: [
    { apiName: 'Team', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }, { apiName: 'lead', type: 'string' }] },
    { apiName: 'Service', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }, { apiName: 'tier', type: 'integer' }] }
  ],
  linkTypes: [{ apiName: 'owner', inverseApiName: 'services', from: 'Service', to: 'Team', cardinality: 'many-to-one', questions: ['q1'] }]
}

test('exports a Cordis plugin shape', () => {
  assert.equal(plugin.name, 'ontology-builder')
  assert.deepEqual(plugin.inject, ['tools', 'approval', 'llm', 'agentDefaultModel'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.Config({}).databasePath, 'ontology-builder.db')
})

test('end-to-end build through the tools', withWorkspace(async dir => {
  const ctx = fakeContext()
  plugin.apply(ctx, plugin.Config({ databasePath: 'state/onto.db' }))
  const call = (name, args, e = exec) => ctx.registered.get(name).execute(args, e)
  for (const tool of ctx.registered.values()) assert.equal(tool.parameters.type, 'object', tool.name)

  await call('ontology_project', { action: 'create', name: 'platform' })
  const drafted = await call('ontology_schema', { action: 'draft', project: 'platform', schema: SCHEMA })
  assert.deepEqual(drafted.issues.filter(i => i.severity !== 'hint'), [])
  const pub = await call('ontology_schema_publish', { project: 'platform' })
  assert.equal(pub.version, 1)
  assert.match(ctx.asked[0].reason, /Publish schema v1.*object types \+2/)
  assert.equal(ctx.asked[0].callId, 'call_1')

  writeFileSync(join(dir, 'owners.md'), '# Owners\nThe billing service (tier 1) is owned by the Payments team.\nPayments is led by Kim.\n')
  const mat = (await call('ontology_material_add', { project: 'platform', path: 'owners.md' })).material
  assert.equal(mat.lines, 4)
  await assert.rejects(call('ontology_material_add', { project: 'platform', path: '../outside.txt' }), /inside the workspace/)
  const found = await call('ontology_material_read', { project: 'platform', materialId: mat.id, query: 'payments' })
  assert.equal(found.matches.length, 2)

  const e = quote => [{ materialId: mat.id, quote }]
  const batch = await call('ontology_assert', { project: 'platform', extractor: 'test', objects: [
    { type: 'Service', properties: { name: 'billing', tier: 1 }, evidence: e('billing service (tier 1)') },
    { type: 'Team', properties: { name: 'Payments', lead: 'Kim' }, evidence: e('Payments is led by Kim') },
    { type: 'Team', properties: { name: 'Ghost' }, evidence: e('Ghost team') }
  ], links: [{ linkType: 'owner', from: { type: 'Service', key: 'billing' }, to: { type: 'Team', key: 'Payments' }, evidence: e('owned by the Payments team') }] })
  assert.equal(batch.failed, 1)

  const preview = await call('ontology_review_preview', { project: 'platform' })
  assert.equal(preview.total, 3)
  assert.ok(preview.items.every(i => i.ready && i.evidence.length === 1))

  const ids = preview.items.map(i => i.id)
  const done = await call('ontology_review_commit', { project: 'platform', decision: 'confirm', ids })
  assert.equal(done.confirmed.length, 3)
  assert.match(ctx.asked[1].reason, /Confirm 3 candidate\(s\).*Service "billing"/)

  const owners = await call('ontology_query', { project: 'platform', objectType: 'Team', where: { property: 'lead', op: 'eq', value: 'Kim' }, traverse: [{ link: 'services' }] })
  assert.deepEqual(owners.objects.map(o => o.key), ['billing'])

  const out = await call('ontology_export', { project: 'platform', format: 'turtle', path: 'out/platform.ttl', base: 'https://example.org/p/' })
  assert.equal(out.objects, 2)
  assert.match(readFileSync(join(dir, 'out/platform.ttl'), 'utf8'), /<https:\/\/example.org\/p\/Service\/billing> :owner <https:\/\/example.org\/p\/Team\/Payments>/)

  const audit = await call('ontology_audit', { project: 'platform' })
  assert.deepEqual(audit.entries.map(a => a.action).slice(0, 3), ['review.confirm', 'batch.assert', 'material.add'])
  ctx.dispose()
}))

test('ontology_extract runs the configured model and records located candidates', withWorkspace(async () => {
  const doc = 'Service catalogue\n\nThe billing service (tier 1) is owned by the Payments team.\nPayments is led by Kim.\n'
  const replies = [
    // First attempt: one fabricated quote, so the tool must send it back.
    { call: { objects: [
      { type: 'Service', properties: { name: 'billing', tier: 1 }, quote: 'billing service (tier 1)' },
      { type: 'Team', properties: { name: 'Payments', lead: 'Kim' }, quote: 'Payments is managed by Kim' }
    ], links: [] } },
    { call: { objects: [
      { type: 'Service', properties: { name: 'billing', tier: 1 }, quote: 'billing service (tier 1)' },
      { type: 'Team', properties: { name: 'Payments', lead: 'Kim' }, quote: 'Payments is led by Kim', fieldQuotes: { lead: 'led by Kim' } }
    ], links: [{ linkType: 'owner', from: { type: 'Service', key: 'billing' }, to: { type: 'Team', key: 'Payments' }, quote: 'owned by the Payments team' }] } }
  ]
  const ctx = fakeContext('allowed-once', replies)
  plugin.apply(ctx, plugin.Config({ databasePath: 'onto.db' }))
  const call = (name, args, e = exec) => ctx.registered.get(name).execute(args, e)
  assert.equal(ctx.registered.get('ontology_extract').timeoutMs, 30 * 60 * 1000)
  await call('ontology_project', { action: 'create', name: 'p' })
  await call('ontology_schema', { action: 'draft', project: 'p', schema: SCHEMA })
  await call('ontology_schema_publish', { project: 'p' })
  const mat = (await call('ontology_material_add', { project: 'p', text: doc, name: 'catalogue.md' })).material

  const plan = await call('ontology_extract', { project: 'p', materialIds: [mat.id], dryRun: true })
  assert.equal(plan.materials[0].chunks, 1)
  assert.equal(ctx.llm.requests.length, 0)

  const r = await call('ontology_extract', { project: 'p', materialIds: [mat.id] })
  assert.equal(r.model, 'fake/fake-1')
  assert.deepEqual([r.objects.created, r.links.created], [2, 1])
  assert.deepEqual(r.droppedByValidation, [])
  assert.equal(ctx.llm.requests.length, 2)
  const req = ctx.llm.requests[1]
  assert.deepEqual([req.provider, req.model, req.temperature, req.tools[0].name], ['fake', 'fake-1', 0, 'submit_extraction'])
  assert.match(req.messages[0].content[0].text, /not in the passage/)

  const preview = await call('ontology_review_preview', { project: 'p', batchId: r.batchId })
  const team = preview.items.find(i => i.key === 'Payments')
  assert.deepEqual(team.evidence.map(e => [e.line, e.quote, e.field]), [[4, 'Payments is led by Kim', null], [4, 'led by Kim', 'lead']])
  const audit = await call('ontology_audit', { project: 'p' })
  assert.equal(audit.entries[0].action, 'batch.assert')
  assert.equal(audit.entries[0].detail.extractor, 'llm:fake/fake-1')
  ctx.dispose()
}))

test('ontology_extract surfaces model failures', withWorkspace(async () => {
  const ctx = fakeContext('allowed-once', [{ fail: 'invalid api key' }])
  plugin.apply(ctx, plugin.Config({ databasePath: 'onto.db' }))
  const call = (name, args) => ctx.registered.get(name).execute(args, exec)
  await call('ontology_project', { action: 'create', name: 'p' })
  await call('ontology_schema', { action: 'draft', project: 'p', schema: SCHEMA })
  await call('ontology_schema_publish', { project: 'p' })
  const mat = (await call('ontology_material_add', { project: 'p', text: 'The billing service.' })).material
  await assert.rejects(call('ontology_extract', { project: 'p', materialIds: [mat.id] }), /invalid api key/)
  assert.equal((await call('ontology_project', { action: 'get', project: 'p' })).objects.candidate, 0)
  ctx.dispose()
}))

test('changes stop when the user does not approve', withWorkspace(async () => {
  const ctx = fakeContext('rejected')
  plugin.apply(ctx, plugin.Config({ databasePath: 'onto.db' }))
  const call = (name, args, e = exec) => ctx.registered.get(name).execute(args, e)
  await call('ontology_project', { action: 'create', name: 'p' })
  await call('ontology_schema', { action: 'draft', project: 'p', schema: SCHEMA })
  await assert.rejects(call('ontology_schema_publish', { project: 'p' }), /Not approved \(rejected\)/)
  await assert.rejects(call('ontology_schema_publish', { project: 'p' }, {}), /no agent/)
  assert.equal((await call('ontology_project', { action: 'get', project: 'p' })).published, null)
  ctx.dispose()
}))

test('publishing reports blocking issues without asking', withWorkspace(async () => {
  const ctx = fakeContext()
  plugin.apply(ctx, plugin.Config({ databasePath: 'onto.db' }))
  const call = (name, args) => ctx.registered.get(name).execute(args, exec)
  await call('ontology_project', { action: 'create', name: 'p' })
  await call('ontology_schema', { action: 'draft', project: 'p', schema: { objectTypes: [{ apiName: 'A', primaryKey: 'x', properties: [] }] } })
  const result = await call('ontology_schema_publish', { project: 'p' })
  assert.equal(result.published, false)
  assert.ok(result.blocking.some(i => i.code === 'MISSING_PRIMARY_KEY'))
  assert.equal(ctx.asked.length, 0)
  ctx.dispose()
}))
