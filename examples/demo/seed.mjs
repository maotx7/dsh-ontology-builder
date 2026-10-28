// Build the demo project without a model, so the UI can be tried in minutes.
// Usage: node examples/demo/seed.mjs [database path]   (default: ./ontology-builder.db)
// In real use the agent does these steps through the ontology_* tools, and
// every confirmation is approved by you in the conversation.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Store } from '../../dist/core/store.js'

const here = new URL('.', import.meta.url)
const db = resolve(process.argv[2] ?? 'ontology-builder.db')
const store = new Store(db)
// The seed script stands in for you here; in DSH this comes from ctx.approval.
const auth = { kind: 'approval', outcome: 'allowed-once', reason: 'demo seed script' }

if (store.listProjects().some(p => p.name === 'demo')) {
  console.log(`Project "demo" already exists in ${db}.`)
  process.exit(0)
}
const project = store.createProject('demo', 'Fictional service catalogue')
store.setDraft(project.id, JSON.parse(readFileSync(new URL('schema.json', here), 'utf8')))
store.publish(project.id, 'initial schema', auth)

const text = readFileSync(new URL('services.md', here), 'utf8')
const material = store.addMaterial(project.id, 'services.md', text).material
const cite = quote => [{ materialId: material.id, quote }]
const service = (name, tier, quote) => ({ type: 'Service', properties: { name, tier }, evidence: cite(quote) })
const team = (name, quote) => ({ type: 'Team', properties: { name }, evidence: cite(quote) })
const link = (linkType, from, to, quote) => ({ linkType, from: { type: 'Service', key: from }, to: { type: to[0], key: to[1] }, evidence: cite(quote) })

// What an extraction batch submits: every fact quotes the material verbatim.
const batch = store.assertCandidates(project.id, 'demo-seed', {
  objects: [
    team('Payments', 'The Payments team'),
    team('Core Finance', 'the Core Finance team'),
    team('Growth', 'The Growth team'),
    service('billing', 1, 'The billing service is tier 1'),
    service('invoice', 2, 'The invoice service is tier 2'),
    service('ledger', 1, 'The ledger service is owned by the Core Finance team and is tier 1'),
    service('referral', 3, 'the referral service, which is tier 3')
  ],
  links: [
    link('owner', 'billing', ['Team', 'Payments'], 'The Payments team owns the billing service'),
    link('owner', 'invoice', ['Team', 'Payments'], 'the invoice service'),
    link('owner', 'ledger', ['Team', 'Core Finance'], 'The ledger service is owned by the Core Finance team'),
    link('owner', 'referral', ['Team', 'Growth'], 'The Growth team owns the referral service'),
    link('dependsOn', 'billing', ['Service', 'ledger'], 'depends on the ledger service'),
    link('dependsOn', 'invoice', ['Service', 'billing'], 'depends on the billing service.'),
    link('dependsOn', 'referral', ['Service', 'billing'], 'The referral service depends on the billing service for payouts')
  ]
})

// Confirm the Payments and Core Finance part; leave Growth as candidates to review in the UI.
const failed = [...batch.objects, ...batch.links].filter(r => r.outcome === 'failed')
if (failed.length) throw new Error(`Seed items failed validation: ${JSON.stringify(failed)}`)
const growth = new Set(['Growth', 'referral'])
const keep = store.objects(project.id, { status: ['candidate'] }).filter(o => !growth.has(o.key))
const keepIds = new Set(keep.map(o => o.id))
const keepLinks = store.links(project.id, { status: ['candidate'] }).filter(l => keepIds.has(l.fromId) && keepIds.has(l.toId))
const preview = store.previewConfirm(project.id, [...keepIds, ...keepLinks.map(l => l.id)])
store.confirm(project.id, preview.ready, auth)

store.setQuestionQuery(project.id, 'q_owner', { objectType: 'Service', traverse: [{ link: 'owner' }] }, { minResults: 1 })
store.setQuestionQuery(project.id, 'q_tier1', { objectType: 'Service', where: { property: 'tier', op: 'eq', value: 1 } }, { minResults: 1, includes: ['billing', 'ledger'] })
store.setQuestionQuery(project.id, 'q_deps', { objectType: 'Service', where: { property: 'name', op: 'eq', value: 'invoice' }, traverse: [{ link: 'dependsOn' }] }, { minResults: 1, includes: ['billing'] })
store.runQuestions(project.id)

// A draft change, to show the version diff.
const draft = store.draft(project.id)
draft.objectTypes.push({ apiName: 'Region', displayName: 'Region', primaryKey: 'code', properties: [{ apiName: 'code', type: 'string', required: true }] })
store.setDraft(project.id, draft)

const count = s => store.objects(project.id, { status: [s] }).length
console.log(`Seeded project "demo" in ${db}: ${count('confirmed')} confirmed and ${count('candidate')} candidate objects.`)
store.close()
