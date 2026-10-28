import test from 'node:test'
import assert from 'node:assert/strict'
import { findQuote, searchLines } from '../dist/core/evidence.js'

const text = 'Title\nAda Lovelace worked   at\nAnalytical Engines Ltd.\n张三\n任职于某某公司。'

test('exact quotes resolve to offsets and line', () => {
  const m = findQuote(text, 'Analytical Engines')
  assert.equal(m.mode, 'exact')
  assert.equal(m.line, 3)
  assert.equal(text.slice(m.start, m.end), 'Analytical Engines')
})

test('whitespace differences are tolerated', () => {
  const m = findQuote(text, 'worked at Analytical')
  assert.equal(m.mode, 'whitespace')
  assert.equal(text.slice(m.start, m.end), 'worked   at\nAnalytical')
})

test('line breaks inside CJK text are tolerated', () => {
  const m = findQuote(text, '张三任职于某某公司')
  assert.equal(m.mode, 'compact')
  assert.equal(m.line, 4)
  assert.equal(text.slice(m.start, m.end), '张三\n任职于某某公司')
})

test('fabricated or empty quotes are rejected', () => {
  assert.equal(findQuote(text, 'Ada Lovelace founded'), undefined)
  assert.equal(findQuote(text, '   '), undefined)
  assert.equal(findQuote(text, 'x'.repeat(3000)), undefined)
})

test('searchLines returns numbered matches', () => {
  assert.deepEqual(searchLines(text, 'ada', 5), [{ line: 2, text: 'Ada Lovelace worked   at' }])
})
