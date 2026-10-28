import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../dist/core/store.js'
import { handleApi } from '../dist/web/api.js'
import { UI_PATH, createUiHandler } from '../dist/web/server.js'
import * as plugin from '../dist/index.js'

const AUTH = { kind: 'approval', outcome: 'allowed-once', reason: 'test' }
const SCHEMA = {
  questions: [{ id: 'q1', text: 'Which team owns a service?', priority: 'must' }],
  objectTypes: [
    { apiName: 'Team', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }] },
    { apiName: 'Service', primaryKey: 'name', questions: ['q1'], properties: [{ apiName: 'name', type: 'string' }] }
  ],
  linkTypes: [{ apiName: 'owner', inverseApiName: 'services', from: 'Service', to: 'Team', cardinality: 'many-to-one', questions: ['q1'] }]
}
const DOC = 'The billing service is owned by the Payments team.'

function setup() {
  const s = new Store(':memory:')
  const p = s.createProject('demo')
  s.setDraft(p.id, SCHEMA)
  s.publish(p.id, 'first', AUTH)
  const m = s.addMaterial(p.id, 'doc', DOC).material
  const e = q => [{ materialId: m.id, quote: q }]
  const r = s.assertCandidates(p.id, 'x', {
    objects: [{ type: 'Service', properties: { name: 'billing' }, evidence: e('billing service') }, { type: 'Team', properties: { name: 'Payments' }, evidence: e('Payments team') }],
    links: [{ linkType: 'owner', from: { type: 'Service', key: 'billing' }, to: { type: 'Team', key: 'Payments' }, evidence: e('owned by the Payments team') }]
  })
  return { s, p, m, r }
}
const q = (o = {}) => new URLSearchParams(o)

test('api serves overview, graph, review, material highlights and diffs without changing state', () => {
  const { s, p, m, r } = setup()
  const before = s.auditLog(p.id, 1)[0].seq
  assert.equal(handleApi(s, 'projects', q())[0].name, 'demo')
  assert.deepEqual(handleApi(s, 'overview', q({ project: 'demo' })).objects, { candidate: 2, confirmed: 0, rejected: 0 })

  const graph = handleApi(s, 'graph', q({ project: 'demo' }))
  assert.equal(graph.objects.length, 2)
  assert.equal(graph.links.length, 1)
  assert.equal(handleApi(s, 'graph', q({ project: 'demo', status: 'confirmed' })).objects.length, 0)
  assert.equal(handleApi(s, 'neighbors', q({ project: 'demo', id: r.objects[0].id })).objects.length, 2)
  assert.deepEqual(handleApi(s, 'search', q({ project: 'demo', q: 'pay' })).map(o => o.key), ['Payments'])

  // Review: the link is blocked until its endpoints are confirmed in the same batch or earlier.
  const review = handleApi(s, 'review', q({ project: 'demo' }))
  assert.equal(review.items.length, 3)
  assert.ok(review.items.every(i => Array.isArray(i.issues)))

  const item = handleApi(s, 'item', q({ project: 'demo', id: r.objects[0].id }))
  assert.equal(item.evidence[0].quote, 'billing service')

  const mat = handleApi(s, 'material', q({ project: 'demo', id: m.id }))
  assert.equal(mat.evidence.length, 3)
  assert.ok(mat.evidence.every(e => e.status === 'candidate'))
  assert.deepEqual(mat.evidence.map(e => DOC.slice(e.start, e.end)), ['billing service', 'owned by the Payments team', 'Payments team'])
  s.confirm(p.id, [r.objects[0].id], AUTH)
  assert.equal(handleApi(s, 'material', q({ project: 'demo', id: m.id })).evidence[0].status, 'confirmed')

  s.setDraft(p.id, { ...SCHEMA, objectTypes: [...SCHEMA.objectTypes, { apiName: 'Region', primaryKey: 'name', properties: [{ apiName: 'name', type: 'string' }] }] })
  assert.deepEqual(handleApi(s, 'diff', q({ project: 'demo', from: '1', to: 'draft' })).objectTypes.added, ['Region'])
  assert.equal(handleApi(s, 'schema', q({ project: 'demo', version: '1' })).schema.objectTypes.length, 2)
  assert.equal(handleApi(s, 'quality', q({ project: 'demo' })).schemaVersion, 1)

  // Only the confirm and draft calls above wrote to the audit log; reads never do.
  assert.deepEqual(s.auditLog(p.id, 5).filter(a => a.seq > before).map(a => a.action).sort(), ['review.confirm', 'schema.draft'])
})

test('api errors carry HTTP statuses', () => {
  const { s } = setup()
  const status = fn => { try { fn(); return 200 } catch (e) { return e.status } }
  assert.equal(status(() => handleApi(s, 'graph', q())), 400)
  assert.equal(status(() => handleApi(s, 'graph', q({ project: 'nope' }))), 404)
  assert.equal(status(() => handleApi(s, 'item', q({ project: 'demo', id: 'obj_missing' }))), 404)
  assert.equal(status(() => handleApi(s, 'whatever', q({ project: 'demo' }))), 404)
  const empty = s.createProject('empty')
  assert.equal(status(() => handleApi(s, 'quality', q({ project: empty.name }))), 409)
})

test('ui handler applies the trust fence, serves the app and keeps paths inside the ui dir', async () => {
  const { s } = setup()
  const dir = mkdtempSync(join(tmpdir(), 'ob-ui-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<html>app</html>')
  writeFileSync(join(dir, 'assets', 'a.js'), 'x')
  writeFileSync(join(tmpdir(), 'ob-secret.txt'), 'secret')
  let refuse
  const handler = createUiHandler({ store: () => s, uiDir: dir, reject: () => refuse })
  const server = createServer(handler)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}${UI_PATH}`
  try {
    refuse = 401
    assert.equal((await fetch(`${base}/api/projects`)).status, 401)
    refuse = undefined
    const res = await fetch(`${base}/api/projects`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal((await res.json())[0].name, 'demo')
    assert.equal((await fetch(`${base}/api/graph`)).status, 400)
    assert.equal((await fetch(`${base}/api/projects`, { method: 'POST' })).status, 405)
    assert.equal(await (await fetch(`${base}/`)).text(), '<html>app</html>')
    const asset = await fetch(`${base}/assets/a.js`)
    assert.match(asset.headers.get('cache-control'), /immutable/)
    assert.equal(await (await fetch(`${base}/review`)).text(), '<html>app</html>')
    assert.equal((await fetch(`${base}/..%2f..%2fob-secret.txt`)).status, 404)
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(join(tmpdir(), 'ob-secret.txt'), { force: true })
  }
})

test('plugin registers the UI route only when the web server is present', async () => {
  const registered = new Map()
  const routes = []
  const disposers = []
  let injected
  const ctx = {
    tools: { register(d) { registered.set(d.name, d); return () => registered.delete(d.name) } },
    approval: { async request() { return 'rejected' } },
    llm: { async *stream() {} },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'fake' }) },
    effect(fn) { disposers.push(fn()) },
    inject(deps, fn) { injected = { deps, fn } }
  }
  plugin.apply(ctx, plugin.Config({ databasePath: join(mkdtempSync(join(tmpdir(), 'ob-db-')), 'x.db') }))
  assert.deepEqual(injected.deps, ['webServer', 'connection'])
  const ui = registered.get('ontology_ui')
  assert.equal((await ui.execute({})).available, false)

  const webDisposers = []
  injected.fn({
    webServer: { host: '127.0.0.1', port: 4321, register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1) } },
    connection: { requestRejection: () => undefined },
    effect(fn) { webDisposers.push(fn()) }
  })
  assert.deepEqual(routes.map(r => [r.kind, r.path]), [['prefix', '/ontology']])
  assert.equal((await ui.execute({ project: 'a b' })).url, 'http://127.0.0.1:4321/ontology/?project=a%20b')
  webDisposers.forEach(d => d())
  assert.equal(routes.length, 0)
  assert.equal((await ui.execute({})).available, false)
  disposers.reverse().forEach(d => d?.())
})

test('the demo seed builds a project whose questions all pass', async () => {
  const { execFileSync } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'ob-demo-'))
  const db = join(dir, 'demo.db')
  try {
    execFileSync(process.execPath, ['examples/demo/seed.mjs', db], { stdio: 'pipe' })
    const s = new Store(db)
    const id = s.project('demo').id
    assert.deepEqual(s.runQuestions(id).map(r => [r.questionId, r.status]), [['q_owner', 'pass'], ['q_tier1', 'pass'], ['q_deps', 'pass']])
    assert.deepEqual(handleApi(s, 'review', q({ project: 'demo' })).items.map(i => i.label).sort(), ['Growth', 'Service:referral → Service:billing', 'Service:referral → Team:Growth', 'referral'])
    s.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
