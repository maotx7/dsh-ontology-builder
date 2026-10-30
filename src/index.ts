import { mkdirSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Store } from './core/store.js'
import { type Llm, type ModelSelection, createModel } from './dsh/model.js'
import { type Approval, type Exec, createTools } from './dsh/tools.js'
import { UI_PATH, createUiHandler } from './web/server.js'

/** Minimal shape of the DSH web server (`@deepseek-ai/dsh-host-webserver`). */
interface WebServer {
  readonly host: string
  readonly port: number
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}

export const name = 'ontology-builder'
export const inject = ['tools', 'approval', 'llm', 'agentDefaultModel']

export interface Config {
  /** SQLite database file for ontology projects. Defaults to a fixed folder under `~/.dsh/ontology-builder` so every DSH session shares one file; `~` is expanded, and a bare relative path still resolves against the DSH working directory. */
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
  databasePath: Schema.string().default(join(homedir(), '.dsh', 'ontology-builder', 'ontology-builder.db')).description('SQLite database file for ontology projects. Defaults to a fixed folder under ~/.dsh/ontology-builder so every DSH session shares one file; ~ is expanded, and a bare relative path still resolves against the DSH working directory.'),
  extraction: Schema.object({
    chunkChars: Schema.natural().min(200).default(4000).description('Characters per chunk sent to the model.'),
    overlapChars: Schema.natural().default(300).description('Characters shared by consecutive chunks.'),
    maxAttempts: Schema.natural().min(1).max(5).default(3).description('Model attempts per chunk, including corrections.'),
    maxChunks: Schema.natural().min(1).default(20).description('Chunks per ontology_extract call.'),
    maxTokens: Schema.natural().min(256).default(16000).description('Output token cap per model call.')
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
  /** One fixed database location regardless of where DSH is started: `~` and `~/…` expand to the home directory, absolute paths are used as-is, and only a bare relative path stays anchored to the DSH working directory. */
  const dbPath = (configured: string) => {
    if (configured === '~') return homedir()
    if (configured.startsWith('~/')) return join(homedir(), configured.slice(2))
    return isAbsolute(configured) ? configured : resolve(workspace, configured)
  }
  // Opened on first use so loading the plugin never touches the disk.
  const open = () => {
    if (!store) {
      const path = dbPath(config.databasePath)
      mkdirSync(dirname(path), { recursive: true })
      store = new Store(path)
    }
    return store
  }
  ctx.effect(() => () => {
    store?.close()
    store = undefined
  })
  // The UI only exists where DSH serves a browser surface (`dsh --profile web`); headless runs skip it.
  let server: WebServer | undefined
  const uiUrl = () => server && `http://${server.host === '0.0.0.0' ? '127.0.0.1' : server.host}:${server.port}${UI_PATH}/`
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    const web = webCtx as unknown as { webServer: WebServer; connection: { requestRejection(req: IncomingMessage): number | undefined } }
    const handler = createUiHandler({ store: open, uiDir: fileURLToPath(new URL('./ui', import.meta.url)), reject: req => web.connection.requestRejection(req) })
    webCtx.effect(() => {
      const dispose = web.webServer.register({ kind: 'prefix', path: UI_PATH, handler })
      server = web.webServer
      return () => {
        dispose()
        server = undefined
      }
    })
  })
  ctx.effect(() => services.tools.register({
    name: 'ontology_ui',
    description: 'Get the address of the read-only ontology UI (schema graph, instance explorer, review queue with evidence, material reader, quality and versions). Only available under the DSH web surface. Changes are still made through the other tools.',
    parameters: { type: 'object', properties: { project: { type: 'string', description: 'Project name or id to open.' } }, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      const base = uiUrl()
      if (!base) return { available: false, hint: 'The UI needs the DSH web surface. Start DSH with `dsh --profile web` (with this plugin installed in that profile) and ask again.' }
      const project = (args as { project?: string }).project
      return {
        available: true,
        url: project ? `${base}?project=${encodeURIComponent(project)}` : base,
        hint: `💡 Open in your browser: ${project ? `${base}?project=${encodeURIComponent(project)}` : base}`,
        note: 'Open it in the browser where the DSH web GUI is already signed in. Without a project parameter, the UI will show the first available project.'
      }
    }
  }))
  const model = createModel(services.llm, () => services.agentDefaultModel.currentSelection(), config.extraction.maxTokens)
  for (const tool of createTools({ store: open, approval: services.approval, model, extraction: config.extraction, workspace })) {
    ctx.effect(() => services.tools.register({
      ...tool,
      output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
    }))
  }
}
