/** Adapt DSH's `ctx.llm.stream` to the extractor's ModelFn, using the model the user already configured. */
import type { ModelFn } from '../extract/extract.js'

export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
type Chunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string; name?: string; arguments?: string; text?: string } }
  | { type: 'usage'; usage: { outputTokens: number; reasoningTokens?: number } }
  | { type: 'finish'; reason: { kind: string; failure?: { message: string; code: string } } }
  | { type: string }
export interface Llm { stream(options: Record<string, unknown>): AsyncIterable<Chunk> }

/**
 * Prior attempts are replayed as user turns rather than synthetic assistant
 * and tool messages: one-shot requests may only carry identity-free user input.
 */
export function createModel(llm: Llm, select: () => ModelSelection, maxTokens: number): ModelFn & { selection: () => ModelSelection } {
  const fn = (async ({ system, turns, tool, maxTokens: budget, signal }) => {
    const { provider, model, reasoningEffort } = select()
    const text = turns.map(t => (t.role === 'assistant' ? `Your previous answer was:\n${t.text}` : t.text)).join('\n\n')
    let reply = ''
    let reasoning = ''
    let finishReason: string | undefined
    let outputTokens: number | undefined
    let reasoningTokens: number | undefined
    const calls = new Map<number, { name?: string; args: string }>()
    for await (const chunk of llm.stream({
      provider, model, ...(reasoningEffort ? { reasoningEffort } : {}),
      system, messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      tools: [tool], temperature: 0, maxTokens: budget ?? maxTokens, signal
    })) {
      if (chunk.type === 'text-delta') reply += (chunk as { text: string }).text
      else if (chunk.type === 'reasoning-delta') reasoning += (chunk as { text: string }).text
      else if (chunk.type === 'tool-call-delta') {
        const c = chunk as { index: number; name?: string; argumentsDelta: string }
        const entry = calls.get(c.index) ?? { args: '' }
        if (c.name) entry.name = c.name
        entry.args += c.argumentsDelta
        calls.set(c.index, entry)
      } else if (chunk.type === 'block-end') {
        const b = (chunk as { index: number; block: { type: string; name?: string; arguments?: string } })
        if (b.block.type === 'tool-call') calls.set(b.index, { name: b.block.name, args: b.block.arguments ?? '' })
      } else if (chunk.type === 'usage') {
        const u = (chunk as { usage: { outputTokens: number; reasoningTokens?: number } }).usage
        outputTokens = u.outputTokens
        reasoningTokens = u.reasoningTokens
      } else if (chunk.type === 'finish') {
        const reason = (chunk as { reason: { kind: string; failure?: { message: string } } }).reason
        finishReason = reason.kind
        if (reason.kind === 'error' || reason.kind === 'aborted') throw new Error(`Model call failed: ${reason.failure?.message ?? reason.kind}`)
      }
    }
    const call = [...calls.values()].find(c => c.name === tool.name)
    const diagnostics = {
      finishReason,
      reasoningChars: reasoning.length,
      toolCallAttempted: calls.size > 0,
      textChars: reply.length,
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {})
    }
    if (!call) return { text: reply, diagnostics }
    try {
      return { call: JSON.parse(call.args || '{}'), text: reply, diagnostics }
    } catch {
      return { text: `${reply}\n(submit_extraction arguments were not valid JSON: ${call.args.slice(0, 200)})`, diagnostics }
    }
  }) as ModelFn & { selection: () => ModelSelection }
  fn.selection = select
  return fn
}
