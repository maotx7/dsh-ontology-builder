/**
 * Schema-guided extraction from document chunks. The model answers through a
 * `submit_extraction` tool call; output is validated (shape, schema, verbatim
 * quotes) and sent back with the errors for a bounded number of retries.
 * Nothing here writes to the store: the caller records the result as candidates.
 */
import { findQuote } from '../core/evidence.js'
import { type OntologySchema, validateProperties } from '../core/schema.js'
import type { EvidenceRole, LinkInput, ObjectInput } from '../core/store.js'
import type { Chunk } from './chunk.js'

export const PROMPT_VERSION = 'extract-v1'

/** One model turn. `call` is the submitted arguments (already JSON-parsed) or undefined if the model did not call the tool. */
export interface ExtractionDiagnostics {
  /** Normalized finish reason from the host: 'stop' | 'tool-calls' | 'max-tokens' | 'aborted' | 'error' | … */
  finishReason?: string
  /** Reasoning (thinking) characters the model streamed before any tool call. */
  reasoningChars?: number
  /** True when the model emitted any tool call, even with the wrong name or unparseable arguments. */
  toolCallAttempted?: boolean
  /** Visible (non-reasoning) text characters. */
  textChars?: number
  /** Provider-reported token usage when the host emits it. */
  outputTokens?: number
  reasoningTokens?: number
}
export interface ModelReply { call?: unknown; text: string; diagnostics?: ExtractionDiagnostics }
export interface Turn { role: 'user' | 'assistant'; text: string }
/** Provided by the host: run one model request with the given system prompt, conversation and single tool. */
export type ModelFn = (request: { system: string; turns: Turn[]; tool: { name: string; description: string; parameters: Record<string, unknown> }; maxTokens?: number; signal?: AbortSignal }) => Promise<ModelReply>

export interface ChunkResult {
  chunk: Chunk
  objects: ObjectInput[]
  links: LinkInput[]
  attempts: number
  /** Problems left in the final attempt; their items were dropped. */
  problems: string[]
  output: unknown
}

const ROLES: EvidenceRole[] = ['specified', 'observed', 'correspondence', 'inferred']

export const SUBMIT_TOOL = {
  name: 'submit_extraction',
  description: 'Submit every object and link found in the text. Submit empty lists if there are none.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['objects', 'links'],
    properties: {
      objects: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['type', 'properties', 'quote'],
          properties: {
            type: { type: 'string', description: 'Object type apiName.' },
            properties: { type: 'object', description: 'Values keyed by property apiName; include the primary key.' },
            quote: { type: 'string', description: 'Exact text from the passage that states this object. Copy it character for character.' },
            role: { type: 'string', enum: ROLES },
            fieldQuotes: { type: 'object', description: 'Optional: property apiName -> exact text supporting that value.' }
          }
        }
      },
      links: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['linkType', 'from', 'to', 'quote'],
          properties: {
            linkType: { type: 'string' },
            from: { type: 'object', required: ['type', 'key'], properties: { type: { type: 'string' }, key: { description: 'Primary key value.' } } },
            to: { type: 'object', required: ['type', 'key'], properties: { type: { type: 'string' }, key: { description: 'Primary key value.' } } },
            quote: { type: 'string', description: 'Exact text from the passage that states this relationship.' },
            role: { type: 'string', enum: ROLES }
          }
        }
      }
    }
  }
} as const

export function systemPrompt(schema: OntologySchema, instructions?: string): string {
  const types = schema.objectTypes.map(t => {
    const props = t.properties.map(p => `    - ${p.apiName}: ${p.type}${p.apiName === t.primaryKey ? ' (primary key)' : ''}${p.required ? ' (required)' : ''}${p.enum ? ` one of ${p.enum.join(' | ')}` : ''}${p.description ? ` — ${p.description}` : ''}`).join('\n')
    return `- ${t.apiName}${t.description ? `: ${t.description}` : ''}\n${props}`
  }).join('\n')
  const links = schema.linkTypes.map(l => `- ${l.apiName}: ${l.from} → ${l.to} (${l.cardinality})${l.description ? ` — ${l.description}` : ''}`).join('\n') || '(none)'
  return [
    'You extract instances of an ontology from a passage of a source document.',
    'Rules:',
    '1. Only extract what the passage itself states. Do not use outside knowledge.',
    '2. Every object and link needs `quote`: text copied exactly from the passage (same characters, no paraphrase, no ellipsis). Keep quotes short — one sentence or less.',
    '3. Use only the object types, properties and link types below. Use the exact apiNames. Omit properties the passage does not state.',
    '4. Use the same primary key value for the same thing every time, written as in the passage.',
    '5. role: "specified" when the passage states it directly; "inferred" when you concluded it from context. Prefer leaving an item out over guessing.',
    '6. A link may only refer to objects you also submit, or that the passage clearly names.',
    '7. Answer only by calling submit_extraction.',
    instructions ? `\nProject guidance:\n${instructions}` : '',
    `\nObject types:\n${types}`,
    `\nLink types:\n${links}`
  ].join('\n')
}

function userPrompt(chunk: Chunk, materialName: string): string {
  return `Passage from "${materialName}" (characters ${chunk.start}–${chunk.end}):\n<passage>\n${chunk.text}\n</passage>`
}

/** Check one submission; returns usable items plus problems the model should fix. */
export function checkSubmission(schema: OntologySchema, chunk: Chunk, materialId: string, raw: unknown): { objects: ObjectInput[]; links: LinkInput[]; problems: string[] } {
  const problems: string[] = []
  const objects: ObjectInput[] = []
  const links: LinkInput[] = []
  if (!raw || typeof raw !== 'object') return { objects, links, problems: ['Arguments must be an object with `objects` and `links`.'] }
  const value = raw as { objects?: unknown; links?: unknown }
  const types = new Map(schema.objectTypes.map(t => [t.apiName, t]))
  const linkTypes = new Map(schema.linkTypes.map(l => [l.apiName, l]))
  const quoteOk = (quote: unknown, where: string) => {
    if (typeof quote !== 'string' || !quote.trim()) { problems.push(`${where}: quote is missing.`); return false }
    if (!findQuote(chunk.text, quote)) { problems.push(`${where}: quote ${JSON.stringify(quote.slice(0, 80))} is not in the passage. Copy it exactly or drop the item.`); return false }
    return true
  }
  const role = (r: unknown): EvidenceRole => (ROLES.includes(r as EvidenceRole) ? r as EvidenceRole : 'specified')
  const evidence = (quote: string, r: EvidenceRole, field?: string) => ({ materialId, quote, role: r, near: chunk.start, ...(field ? { field } : {}) })

  const submitted = new Set<string>()
  ;(Array.isArray(value.objects) ? value.objects : []).forEach((item: any, i) => {
    const where = `objects[${i}]`
    const type = types.get(item?.type)
    if (!type) return problems.push(`${where}: unknown type ${JSON.stringify(item?.type)}.`)
    const properties = item.properties && typeof item.properties === 'object' && !Array.isArray(item.properties) ? item.properties : {}
    const errors = validateProperties(type, properties).filter(p => p.severity === 'blocking')
    if (errors.length) return problems.push(`${where} (${type.apiName}): ${errors.map(e => e.message).join(' ')}`)
    if (!quoteOk(item.quote, where)) return
    const ev = [evidence(item.quote, role(item.role))]
    if (item.fieldQuotes && typeof item.fieldQuotes === 'object') {
      for (const [field, quote] of Object.entries(item.fieldQuotes)) {
        if (type.properties.some(p => p.apiName === field) && typeof quote === 'string' && findQuote(chunk.text, quote)) ev.push(evidence(quote, role(item.role), field))
      }
    }
    submitted.add(`${type.apiName}\u0000${properties[type.primaryKey]}`)
    objects.push({ type: type.apiName, properties, evidence: ev })
  })
  ;(Array.isArray(value.links) ? value.links : []).forEach((item: any, i) => {
    const where = `links[${i}]`
    const def = linkTypes.get(item?.linkType)
    if (!def) return problems.push(`${where}: unknown link type ${JSON.stringify(item?.linkType)}.`)
    if (item.from?.type !== def.from || item.to?.type !== def.to) return problems.push(`${where}: ${def.apiName} goes from ${def.from} to ${def.to}.`)
    if (item.from.key === undefined || item.to.key === undefined) return problems.push(`${where}: from.key and to.key are required.`)
    if (!quoteOk(item.quote, where)) return
    links.push({ linkType: def.apiName, from: { type: def.from, key: item.from.key }, to: { type: def.to, key: item.to.key }, evidence: [evidence(item.quote, role(item.role))] })
  })
  return { objects, links, problems }
}

/** Output budgets are raised once by this factor when a call is cut by max-tokens. */
const ESCALATE_FACTOR = 1.5
const MAX_ESCALATED_TOKENS = 32000

/**
 * Classify a failed model reply into an actionable message, and whether retrying
 * with the same setup can help. The two signatures cover the failures that cost
 * the most debugging time: a reasoning-heavy call that never reaches the tool, and
 * a chat template that suppresses tool calls entirely.
 */
export function diagnose(reply: ModelReply, noToolCallStreak: number, budget: number): { problem: string; fatal: boolean } {
  const d = reply.diagnostics
  if (d?.finishReason === 'max-tokens') {
    const thinking = (d.reasoningTokens ?? 0) > 0 || (d.reasoningChars ?? 0) > 0
    if (thinking && d.toolCallAttempted !== true) {
      return {
        problem: `Reasoning/budget problem: the model hit finish_reason=max-tokens while still emitting reasoning (reasoningTokens=${d.reasoningTokens ?? 0}, reasoningChars=${d.reasoningChars ?? 0}) and never called submit_extraction. Declare a reasoningEffort for this model (map the "off" setting), or raise extraction.maxTokens (current ${budget}).`,
        fatal: true
      }
    }
    return {
      problem: `Budget problem: output was cut at maxTokens=${budget} (finish_reason=max-tokens), so the tool arguments are incomplete or missing. Raise extraction.maxTokens.`,
      fatal: false
    }
  }
  if (noToolCallStreak >= 2) {
    return {
      problem: `The model's tool call is being hijacked by the template: ${noToolCallStreak} turns produced content but no submit_extraction tool call. Do not disable thinking/tool-calling via chat_template; use the native tool-call channel.`,
      fatal: true
    }
  }
  return { problem: 'Answer by calling submit_extraction, not with text.', fatal: false }
}

/** Extract from one chunk, retrying with the validation errors until clean or out of attempts. */
export async function extractChunk(opts: { model: ModelFn; schema: OntologySchema; chunk: Chunk; materialId: string; materialName: string; instructions?: string; maxAttempts: number; maxTokens?: number; signal?: AbortSignal }): Promise<ChunkResult> {
  const system = systemPrompt(opts.schema, opts.instructions)
  const turns: Turn[] = [{ role: 'user', text: userPrompt(opts.chunk, opts.materialName) }]
  let best: ReturnType<typeof checkSubmission> = { objects: [], links: [], problems: ['The model did not call submit_extraction.'] }
  let output: unknown = null
  let attempts = 0
  let budget = opts.maxTokens ?? 8192
  let escalated = false
  let noToolCallStreak = 0
  while (attempts < opts.maxAttempts) {
    attempts++
    opts.signal?.throwIfAborted()
    const reply = await opts.model({
      system, turns,
      tool: SUBMIT_TOOL as unknown as { name: string; description: string; parameters: Record<string, unknown> },
      ...(opts.maxTokens !== undefined || escalated ? { maxTokens: budget } : {}),
      signal: opts.signal
    })
    output = reply.call ?? reply.text
    const noCall = reply.call === undefined
    const hasContent = !!(reply.text && reply.text.trim()) || (reply.diagnostics?.textChars ?? 0) > 0 || (reply.diagnostics?.reasoningChars ?? 0) > 0
    noToolCallStreak = noCall && reply.diagnostics?.toolCallAttempted !== true ? (hasContent ? noToolCallStreak + 1 : 0) : 0
    const diag = noCall ? diagnose(reply, noToolCallStreak, budget) : undefined
    const checked = noCall ? { objects: [], links: [], problems: [diag!.problem] } : checkSubmission(opts.schema, opts.chunk, opts.materialId, reply.call)
    // Keep the attempt that produced the most usable items.
    if (attempts === 1 || checked.objects.length + checked.links.length >= best.objects.length + best.links.length) best = checked
    if (!checked.problems.length) break
    // A call cut by max-tokens gets one retry with a larger budget before giving up.
    if (diag && reply.diagnostics?.finishReason === 'max-tokens' && !escalated && opts.maxTokens !== undefined && budget < MAX_ESCALATED_TOKENS) {
      budget = Math.min(Math.round(budget * ESCALATE_FACTOR), MAX_ESCALATED_TOKENS)
      escalated = true
      turns.push({ role: 'assistant', text: reply.text })
      turns.push({ role: 'user', text: 'Your previous answer was cut off by the token limit. Continue from where it stopped and call submit_extraction with the complete list.' })
      continue
    }
    if (diag?.fatal) break
    turns.push({ role: 'assistant', text: noCall ? reply.text : `submit_extraction(${JSON.stringify(reply.call)})` })
    turns.push({ role: 'user', text: `Your submission had problems:\n- ${checked.problems.join('\n- ')}\nCall submit_extraction again with the full corrected list. Items you cannot support with an exact quote should be left out.` })
  }
  return { chunk: opts.chunk, objects: best.objects, links: best.links, attempts, problems: best.problems, output }
}
