import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze, resolveImport } from '../dist/code/analyze.js'

const files = [
  { path: 'src/a.ts', text: "import { helper } from './util.js'\nimport * as fs from 'node:fs'\n\nexport class Store {\n  save() { helper(); this.flush() }\n  flush() {}\n}\nexport const run = () => new Store()\n" },
  { path: 'src/util.ts', text: 'export function helper() { return 1 }\nexport function flush() {}\n' },
  { path: 'pkg/__init__.py', text: '' },
  { path: 'pkg/models.py', text: 'from .db import connect\n\nclass User:\n    def save(self):\n        connect()\n' },
  { path: 'pkg/db.py', text: 'def connect():\n    pass\n' },
  { path: 'README.md', text: '# hi' }
]

test('modules, symbols, imports and calls from TypeScript and Python', async () => {
  const g = await analyze(files)
  assert.deepEqual(g.modules.map(m => m.path), ['src/a.ts', 'src/util.ts', 'pkg/__init__.py', 'pkg/models.py', 'pkg/db.py'])
  assert.deepEqual(g.skipped, [{ path: 'README.md', reason: 'unsupported language' }])
  const sym = Object.fromEntries(g.symbols.map(s => [s.qualifiedName, s.kind]))
  assert.deepEqual(sym, {
    'src/a.ts#Store': 'class', 'src/a.ts#Store.save': 'method', 'src/a.ts#Store.flush': 'method', 'src/a.ts#run': 'function',
    'src/util.ts#helper': 'function', 'src/util.ts#flush': 'function',
    'pkg/models.py#User': 'class', 'pkg/models.py#User.save': 'function', 'pkg/db.py#connect': 'function'
  })
  assert.deepEqual(g.imports.map(i => `${i.from}>${i.to}`), ['src/a.ts>src/util.ts', 'pkg/models.py>pkg/db.py'])
  const calls = g.calls.map(c => `${c.from}>${c.to}`).sort()
  // this.flush() resolves to the local method, not util.flush; node:fs is external and ignored.
  assert.deepEqual(calls, ['pkg/models.py#User.save>pkg/db.py#connect', 'src/a.ts#Store.save>src/a.ts#Store.flush', 'src/a.ts#Store.save>src/util.ts#helper', 'src/a.ts#run>src/a.ts#Store'])
  const save = g.symbols.find(s => s.qualifiedName === 'src/a.ts#Store.save')
  assert.equal(files[0].text.slice(save.line.start, save.line.end), 'save() { helper(); this.flush() }')
})

test('nested helper functions belong to their enclosing definition', async () => {
  const g = await analyze([
    { path: 'n.ts', text: 'function outer() {\n  const inner = () => target()\n  inner()\n}\nfunction target() {}\n' }
  ])
  assert.deepEqual(g.symbols.map(s => s.qualifiedName), ['n.ts#outer', 'n.ts#target'])
  assert.deepEqual(g.calls.map(c => `${c.from}>${c.to}`), ['n.ts#outer>n.ts#target'])
})

test('ambiguous calls stay unresolved', async () => {
  const g = await analyze([
    { path: 'x.ts', text: 'function main() { go() }\n' },
    { path: 'y.ts', text: 'export function go() {}\n' },
    { path: 'z.ts', text: 'export function go() {}\n' }
  ])
  assert.deepEqual(g.calls, [])
})

test('import resolution', () => {
  const paths = new Set(['src/a.ts', 'src/lib/index.ts', 'pkg/__init__.py', 'pkg/sub/mod.py'])
  assert.equal(resolveImport('src/b.ts', './a.js', 'typescript', paths), 'src/a.ts')
  assert.equal(resolveImport('src/b.ts', './lib', 'typescript', paths), 'src/lib/index.ts')
  assert.equal(resolveImport('src/b.ts', 'react', 'typescript', paths), undefined)
  assert.equal(resolveImport('pkg/sub/x.py', '.mod', 'python', paths), 'pkg/sub/mod.py')
  assert.equal(resolveImport('pkg/sub/x.py', '..', 'python', paths), 'pkg/__init__.py')
  assert.equal(resolveImport('main.py', 'pkg.sub.mod', 'python', paths), 'pkg/sub/mod.py')
})
