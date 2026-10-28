# dsh-ontology-builder

English | [中文](README.zh.md)

Build trustworthy ontologies from data, documents and code — a Palantir-style ontology builder plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> Status: 0.4 (M4). Documents are extracted with the model configured in DSH, source code is analyzed into a code sub-ontology, competency questions run as regression tests, and a browser UI shows the schema, instances, review queue, evidence and quality while you build in the conversation. See the [design document](docs/DESIGN.md) (Chinese).

- **Trustworthy by construction**: every object and link cites verbatim quotes that are checked against the stored, read-only source. The model only proposes. Nothing becomes confirmed without your approval: per item, per batch, or through a rule you approved.
- **Any domain**: you define the object types, properties and link types (Palantir Foundry's model). Nothing is tied to one industry.
- **No extra keys**: extraction uses the model you already configured in DSH.

## Quick start (about 30 minutes)

You need Node.js ≥ 22.13 and DSH (`npm i -g @deepseek-ai/dsh`, or `pnpm exec dsh` in a checkout) with a working model (`DEEPSEEK_API_KEY` for the default DeepSeek model).

**1. Install the plugin into a web profile** (2 min)

```sh
dsh my-ontology --from-default-profile web --dump-config > /dev/null   # create the profile once
dsh plugin --profile my-ontology add dsh-ontology-builder
```

**2. Try the UI on the demo data** (5 min, no model needed)

```sh
mkdir ontology-work && cd ontology-work
node ~/.dsh/profiles/my-ontology/node_modules/dsh-ontology-builder/examples/demo/seed.mjs
dsh my-ontology
```

The seed script writes `ontology-builder.db` in the current directory — the same file the plugin uses when DSH starts there. DSH opens the web GUI; in the chat, ask:

> Open the ontology UI for project demo.

The agent calls `ontology_ui` and returns a link such as `http://127.0.0.1:<port>/ontology/?project=demo`. Open it in the same browser. You will see:

| View | What it shows |
|---|---|
| Schema | Object types and link types as a diagram (React Flow + dagre); the draft's changes against the last published version are highlighted |
| Instances | The object graph (Cytoscape.js); candidates are dashed and translucent; double-click to expand neighbours |
| Review | Candidates grouped by batch and type, each with its blocking checks and its evidence alongside |
| Materials | The original text with every cited span highlighted — green confirmed, yellow candidate; click a span to jump to its item |
| Quality & versions | Six-layer quality report, competency-question results, schema version diff, audit log |

The UI is read-only. Buttons such as "Ask to confirm" copy a request; paste it in the chat, and the agent runs the tool, which asks for your approval. Every view refreshes by itself as the conversation changes the project.

**3. Build your own** (20 min)

Put a document in the working directory, then talk to the agent, for example:

> Create an ontology project "suppliers". From `contracts.md`, propose competency questions and a schema for suppliers, contracts and products. Show me the checks, then publish it after I approve.
>
> Extract candidates from `contracts.md`.
>
> Show me what is ready to confirm, then confirm it as one batch.
>
> Save a query for each must question and run the quality report.

Keep the UI open while you go: new candidates appear as dashed nodes, and confirming them turns them solid.

For code, ask the agent to scan a repository (`ontology_code_scan`) and link objects to the symbols that implement them (`ontology_code_link`).

Plugin not loading? Check that `dsh plugin --profile my-ontology ls` lists `dsh-ontology-builder`. Is `ontology_ui` reporting `available: false`? Then DSH was started without the web surface — `dsh --profile <name>` must use a profile created from `web`, not `headless` or `tui`.

## Tools

| Tool | Purpose |
|---|---|
| `ontology_project` | Create, list or inspect projects |
| `ontology_schema` | Read, draft (with checks) or diff the schema |
| `ontology_schema_publish` | Publish an immutable schema version — asks for approval |
| `ontology_material_add` / `ontology_material_read` | Store read-only source text (SHA-256), read lines to quote from |
| `ontology_extract` | Extract candidates from materials with the DSH model; quotes are verified, bad ones sent back for correction |
| `ontology_assert` | Record candidate objects/links in a batch by hand; every item needs a verbatim quote |
| `ontology_review_preview` / `ontology_review_commit` | Show candidates with evidence; confirm or reject — asks for approval |
| `ontology_batch_rollback` | Undo one extraction batch |
| `ontology_resolve` | Suggest duplicates, merge them (asks for approval; the old key becomes an alias), or mark pairs distinct |
| `ontology_conflict` | List and resolve values two sources disagree on (asks for approval) |
| `ontology_rule` | Preview, approve and apply confirmation rules; spot-check samples; low accuracy disables a rule |
| `ontology_query` | ObjectSet query: filter, traverse links, aggregate |
| `ontology_export` | Turtle (OWL + SHACL + PROV) or JSON-LD |
| `ontology_code_scan` | Analyze source code (TS/JS/Python/Go/Java/Rust, tree-sitter) into modules, symbols, imports and calls; files become citable materials |
| `ontology_code_search` | Find symbols, list import/call neighbours, list object↔code links |
| `ontology_code_link` | Propose object↔code links (e.g. `implementedBy`), evidenced by the code itself |
| `ontology_question` | Save the query that answers each competency question; run them all as regression tests |
| `ontology_quality` | Six-layer quality report: structure, logic, evidence, smells, question coverage, extraction quality |
| `ontology_audit` | Append-only audit log |
| `ontology_ui` | Address of the browser UI (web surface only) |

Publishing, confirming, rejecting, merging, resolving conflicts and approving rules go through DSH's approval service. If no one can answer (headless runs, or the session's approval policy is `never`), the change is refused. A rule only confirms candidates that pass every normal check, never on inferred evidence, and always queues spot checks.

## Install

```sh
dsh plugin --profile <name> add dsh-ontology-builder
```

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`). Code analysis uses the optional dependency `@vscode/tree-sitter-wasm` (MIT, WebAssembly, no native build); everything else works without it. The UI is prebuilt into the package and has no runtime dependencies.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `databasePath` | `ontology-builder.db` | SQLite database file for ontology projects, relative to the directory DSH starts in |
| `extraction.chunkChars` | `4000` | Characters per chunk sent to the model |
| `extraction.overlapChars` | `300` | Overlap between consecutive chunks |
| `extraction.maxAttempts` | `3` | Model attempts per chunk, including corrections |
| `extraction.maxChunks` | `20` | Chunks per `ontology_extract` call; the rest are returned for resuming |
| `extraction.maxTokens` | `8192` | Output token cap per model call |

## Security

- Material text is sent only to the model configured in your DSH profile.
- The UI is served by DSH's own web server under `/ontology/`. Every request passes DSH's Host/Origin check and its login cookie, the same as the DSH GUI; a request without them gets 401/403. The UI is reachable from other machines only if you configured DSH to allow that.
- The UI exposes read-only endpoints. It cannot confirm, reject, merge or publish anything; those changes run only as tool calls behind your approval.

## Development

```sh
pnpm install
pnpm test        # builds the plugin and the UI, then runs the tests
pnpm dev:ui      # Vite dev server for working on the UI
```

The UI lives in `client/` (React, React Flow, dagre, Cytoscape.js — all MIT) and is built into `dist/ui`.

## License

[Apache-2.0](LICENSE)
