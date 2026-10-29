import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('client bundle registers an executable DSH client module', () => {
  const source = readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8')
  let registration
  const window = {
    __ModuleLoader__: {
      load(value) { registration = value }
    }
  }

  vm.runInNewContext(source, { window })

  assert.equal(registration?.id, 'dsh-ontology-builder')
  assert.equal(typeof registration?.factory, 'function')
  const client = registration.factory(name => {
    assert.equal(name, 'react')
    return { createElement() {} }
  })
  assert.equal(client.name, 'ontology-builder-client')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale'])
  assert.equal(typeof client.apply, 'function')
})
