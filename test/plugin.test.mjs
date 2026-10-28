import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../dist/index.js'

function fakeContext() {
  const registered = []
  const disposers = []
  return {
    registered,
    disposers,
    tools: { register(definition) { registered.push(definition); return () => {} } },
    effect(fn) { disposers.push(fn()) }
  }
}

test('exports a Cordis plugin shape', () => {
  assert.equal(plugin.name, 'ontology-builder')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.Config({}).databasePath, 'ontology-builder.db')
})

test('registers ontology_status and reports configuration', async () => {
  const ctx = fakeContext()
  plugin.apply(ctx, { databasePath: '/tmp/x.db' })
  assert.deepEqual(ctx.registered.map(tool => tool.name), ['ontology_status'])
  const value = await ctx.registered[0].execute({})
  assert.deepEqual(value, { plugin: 'ontology-builder', version: '0.0.1', databasePath: '/tmp/x.db' })
})
