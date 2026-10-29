import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { Store } from './core/store.js';
import { createModel } from './dsh/model.js';
import { createTools } from './dsh/tools.js';
import { UI_PATH, createUiHandler } from './web/server.js';
export const name = 'ontology-builder';
export const inject = ['tools', 'approval', 'llm', 'agentDefaultModel'];
export const Config = Schema.object({
    databasePath: Schema.string().default('ontology-builder.db').description('SQLite database file for ontology projects.'),
    extraction: Schema.object({
        chunkChars: Schema.natural().min(200).default(4000).description('Characters per chunk sent to the model.'),
        overlapChars: Schema.natural().default(300).description('Characters shared by consecutive chunks.'),
        maxAttempts: Schema.natural().min(1).max(5).default(3).description('Model attempts per chunk, including corrections.'),
        maxChunks: Schema.natural().min(1).default(20).description('Chunks per ontology_extract call.'),
        maxTokens: Schema.natural().min(256).default(8192).description('Output token cap per model call.')
    }).default({})
});
export function apply(ctx, config) {
    const services = ctx;
    const workspace = process.cwd();
    let store;
    // Opened on first use so loading the plugin never touches the disk.
    const open = () => {
        if (!store) {
            const path = resolve(workspace, config.databasePath);
            mkdirSync(dirname(path), { recursive: true });
            store = new Store(path);
        }
        return store;
    };
    ctx.effect(() => () => {
        store?.close();
        store = undefined;
    });
    // The UI only exists where DSH serves a browser surface (`dsh --profile web`); headless runs skip it.
    let server;
    const uiUrl = () => server && `http://${server.host === '0.0.0.0' ? '127.0.0.1' : server.host}:${server.port}${UI_PATH}/`;
    ctx.inject(['webServer', 'connection'], (webCtx) => {
        const web = webCtx;
        const handler = createUiHandler({ store: open, uiDir: fileURLToPath(new URL('./ui', import.meta.url)), reject: req => web.connection.requestRejection(req) });
        webCtx.effect(() => {
            const dispose = web.webServer.register({ kind: 'prefix', path: UI_PATH, handler });
            server = web.webServer;
            return () => {
                dispose();
                server = undefined;
            };
        });
    });
    ctx.effect(() => services.tools.register({
        name: 'ontology_ui',
        description: 'Get the address of the read-only ontology UI (schema graph, instance explorer, review queue with evidence, material reader, quality and versions). Only available under the DSH web surface. Changes are still made through the other tools.',
        parameters: { type: 'object', properties: { project: { type: 'string', description: 'Project name or id to open.' } }, additionalProperties: false },
        output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        async execute(args) {
            const base = uiUrl();
            if (!base)
                return { available: false, hint: 'The UI needs the DSH web surface. Start DSH with `dsh --profile web` (with this plugin installed in that profile) and ask again.' };
            const project = args.project;
            return { available: true, url: project ? `${base}?project=${encodeURIComponent(project)}` : base, note: 'Open it in the browser where the DSH web GUI is already signed in.' };
        }
    }));
    const model = createModel(services.llm, () => services.agentDefaultModel.currentSelection(), config.extraction.maxTokens);
    for (const tool of createTools({ store: open, approval: services.approval, model, extraction: config.extraction, workspace })) {
        ctx.effect(() => services.tools.register({
            ...tool,
            output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
        }));
    }
}
