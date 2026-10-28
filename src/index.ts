import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Store } from './core/store.js'
import { type Llm, type ModelSelection, createModel } from './dsh/model.js'
import { type Approval, type Exec, createTools } from './dsh/tools.js'

export const name = 'ontology-builder'
export const inject = ['tools', 'approval', 'llm', 'agentDefaultModel']

export interface Config {
  /** SQLite database file for ontology projects. Relative paths resolve against the DSH working directory. */
  databasePath: string
  extraction: {
    /** Characters per chunk sent to the model. */
    chunkChars: number
    /** Characters shared by consecutive chunks so facts on a boundary are not lost. */
    overlapChars: number
    /** Model attempts per chunk, including corrections after validation errors. */
    maxAttempts: number
    /** Chunks processed per ontology_extract call; the rest are reported for resuming. */
    maxChunks: number
    /** Output token cap per model call. */
    maxTokens: number
  }
}

export const Config: Schema<Config> = Schema.object({
  databasePath: Schema.string().default('ontology-builder.db').description('SQLite database file for ontology projects.'),
  extraction: Schema.object({
    chunkChars: Schema.natural().min(200).default(4000).description('Characters per chunk sent to the model.'),
    overlapChars: Schema.natural().default(300).description('Characters shared by consecutive chunks.'),
    maxAttempts: Schema.natural().min(1).max(5).default(3).description('Model attempts per chunk, including corrections.'),
    maxChunks: Schema.natural().min(1).default(20).description('Chunks per ontology_extract call.'),
    maxTokens: Schema.natural().min(256).default(8192).description('Output token cap per model call.')
  }).default({} as Config['extraction'])
})

/** Minimal shape of the DSH tool registry used by this plugin. */
interface ToolRegistry {
  register(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }> }
    execute(args: unknown, exec: Exec): Promise<unknown>
    timeoutMs?: number
  }): () => void
}

export function apply(ctx: Context, config: Config) {
  const services = ctx as unknown as { tools: ToolRegistry; approval: Approval; llm: Llm; agentDefaultModel: { currentSelection(): ModelSelection } }
  const workspace = process.cwd()
  let store: Store | undefined
  // Opened on first use so loading the plugin never touches the disk.
  const open = () => {
    if (!store) {
      const path = resolve(workspace, config.databasePath)
      mkdirSync(dirname(path), { recursive: true })
      store = new Store(path)
    }
    return store
  }
  ctx.effect(() => () => {
    store?.close()
    store = undefined
  })
  const model = createModel(services.llm, () => services.agentDefaultModel.currentSelection(), config.extraction.maxTokens)
  for (const tool of createTools({ store: open, approval: services.approval, model, extraction: config.extraction, workspace })) {
    ctx.effect(() => services.tools.register({
      ...tool,
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
    }))
  }
}
