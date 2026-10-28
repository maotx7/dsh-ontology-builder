import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'ontology-builder'
export const inject = ['tools']

export interface Config {
  /** SQLite database file for ontology projects. Relative paths resolve against the DSH working directory. */
  databasePath: string
}

export const Config: Schema<Config> = Schema.object({
  databasePath: Schema.string().default('ontology-builder.db').description('SQLite database file for ontology projects.')
})

const VERSION = '0.0.1'

/** Minimal shape of the DSH tool registry used by this plugin. */
interface ToolRegistry {
  register(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: { schema: Record<string, unknown>; render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }> }
    execute(args: unknown): Promise<unknown>
  }): () => void
}

export function apply(ctx: Context, config: Config) {
  const tools = (ctx as unknown as { tools: ToolRegistry }).tools
  ctx.effect(() => tools.register({
    name: 'ontology_status',
    description: 'Report the ontology builder plugin version and configuration.',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    async execute() {
      return { plugin: name, version: VERSION, databasePath: config.databasePath }
    }
  }))
}
