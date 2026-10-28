/** Entity resolution helpers: conservative key normalization and similarity for duplicate suggestions. */

/**
 * Canonical form used for automatic matching. Only differences that cannot
 * change identity are removed: Unicode width/compatibility forms, letter case
 * and whitespace. Anything looser is a suggestion for review, never a merge.
 */
export function normalizeKey(key: string): string {
  return key.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

/** Looser form for similarity only: punctuation dropped too. */
function looseForm(value: string): string {
  return normalizeKey(value).replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/** Latin/digit words, plus character bigrams of CJK runs. */
export function tokens(value: string): Set<string> {
  const out = new Set<string>()
  for (const part of looseForm(value).split(' ')) {
    if (!part) continue
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(part)) {
      const chars = [...part]
      if (chars.length === 1) out.add(part)
      for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1])
    } else out.add(part)
  }
  return out
}

function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** 0..1, the higher of edit-distance ratio and token Jaccard. */
export function similarity(a: string, b: string): number {
  const x = [...looseForm(a)]
  const y = [...looseForm(b)]
  if (!x.length || !y.length) return 0
  const edit = 1 - levenshtein(x, y) / Math.max(x.length, y.length)
  const ta = tokens(a)
  const tb = tokens(b)
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  const jaccard = shared / (ta.size + tb.size - shared || 1)
  return Math.max(edit, jaccard)
}

export interface Named { id: string; type: string; label: string }
export interface DuplicatePair { a: string; b: string; type: string; labels: [string, string]; score: number }

/**
 * Pairs of same-type records whose labels look alike. Only pairs sharing a
 * token are compared (blocking), so cost grows with overlap, not n².
 */
export function suggestDuplicates(items: Named[], threshold: number, limit: number): DuplicatePair[] {
  const pairs: DuplicatePair[] = []
  const byType = new Map<string, Named[]>()
  for (const item of items) {
    if (!byType.has(item.type)) byType.set(item.type, [])
    byType.get(item.type)!.push(item)
  }
  for (const [type, list] of byType) {
    const index = new Map<string, number[]>()
    list.forEach((item, i) => { for (const t of tokens(item.label)) { if (!index.has(t)) index.set(t, []); index.get(t)!.push(i) } })
    const seen = new Set<string>()
    for (const bucket of index.values()) {
      // A token shared by most records says nothing about identity.
      if (bucket.length > 200) continue
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const key = `${bucket[i]}:${bucket[j]}`
          if (seen.has(key)) continue
          seen.add(key)
          const a = list[bucket[i]]
          const b = list[bucket[j]]
          const score = similarity(a.label, b.label)
          if (score >= threshold) pairs.push({ a: a.id, b: b.id, type, labels: [a.label, b.label], score: Math.round(score * 1000) / 1000 })
        }
      }
    }
  }
  return pairs.sort((p, q) => q.score - p.score).slice(0, limit)
}
