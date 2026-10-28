/** Split material text into overlapping chunks on line boundaries. */

export interface Chunk { index: number; start: number; end: number; text: string }

export function chunkText(text: string, maxChars: number, overlapChars: number): Chunk[] {
  if (maxChars < 200) throw new Error('chunk size must be at least 200 characters.')
  const chunks: Chunk[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars)
    if (end < text.length) {
      // Prefer a paragraph break, then a line break, in the back half of the window.
      const window = text.slice(start + Math.floor(maxChars / 2), end)
      const cut = window.lastIndexOf('\n\n') >= 0 ? window.lastIndexOf('\n\n') + 2 : window.lastIndexOf('\n') + 1
      if (cut > 0) end = start + Math.floor(maxChars / 2) + cut
    }
    chunks.push({ index: chunks.length, start, end, text: text.slice(start, end) })
    if (end >= text.length) break
    // Step back for overlap, aligned to a line start so quotes are not split.
    let next = Math.max(start + 1, end - overlapChars)
    const lineStart = text.lastIndexOf('\n', next - 1) + 1
    if (lineStart > start) next = lineStart
    start = next
  }
  return chunks
}
