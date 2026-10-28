import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Store } from './core/store.js'
import { type Approval, type Exec, createTools } from './dsh/tools.js'

export const name = 'ontology-builder'
export const inject = ['tools', 'approval']

export interface Config {
  /** SQLite database file for ontology projects. Relative paths resolve against the DSH working directory. */
  databasePath: string
}

export const Config: Schema<Config> = Schema.object({
  databasePath: Schema.string().default('ontology-builder.db').description('SQLite database file for ontology projects.')
})

/** Minimal shape of the DSH tool registry used by this plugin. */
interface ToolRegistry {
  register(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }> }
    execute(args: unknown, exec: Exec): Promise<unknown>
  }): () => void
}

export function apply(ctx: Context, config: Config) {
  const services = ctx as unknown as { tools: ToolRegistry; approval: Approval }
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
  for (const tool of createTools({ store: open, approval: services.approval, workspace })) {
    ctx.effect(() => services.tools.register({
      ...tool,
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
    }))
  }
}
