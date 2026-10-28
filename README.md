# dsh-ontology-builder

English | [中文](README.zh.md)

Build trustworthy ontologies from data, documents and code — a Palantir-style ontology builder plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> Status: 0.3 (M3). Documents are extracted with the model configured in DSH, source code is analyzed into a code sub-ontology and linked to ontology objects, and competency questions run as regression tests in a quality report. The visual UI comes in 0.4. See the [design document](docs/DESIGN.md) (Chinese).

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

Publishing, confirming, rejecting, merging, resolving conflicts and approving rules go through DSH's approval service. If no one can answer (headless runs, or the session's approval policy is `never`), the change is refused. A rule only confirms candidates that pass every normal check, never on inferred evidence, and always queues spot checks.

## What it will do

- **Build**: start from competency questions, let DSH propose object types, properties and links from your materials, review and publish versioned schemas.
- **Extract**: map structured data, run schema-guided LLM extraction over documents (using the model you already configured in DSH), and parse source code into a code sub-ontology.
- **Trust**: every assertion carries field-level evidence; quotes are verified verbatim against the source; the model can only propose — confirmation requires your approval, either per item, per batch, or through a rule you approved.
- **Use**: query objects, traverse links and run validated actions from the DSH conversation; watch the graph grow as you build.

## Install

```sh
dsh plugin --profile <name> add dsh-ontology-builder
```

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`). Code analysis uses the optional dependency `@vscode/tree-sitter-wasm` (MIT, WebAssembly, no native build); everything else works without it.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `databasePath` | `ontology-builder.db` | SQLite database file for ontology projects |
| `extraction.chunkChars` | `4000` | Characters per chunk sent to the model |
| `extraction.overlapChars` | `300` | Overlap between consecutive chunks |
| `extraction.maxAttempts` | `3` | Model attempts per chunk, including corrections |
| `extraction.maxChunks` | `20` | Chunks per `ontology_extract` call; the rest are returned for resuming |
| `extraction.maxTokens` | `8192` | Output token cap per model call |

Material text is sent only to the model configured in your DSH profile.

## License

[Apache-2.0](LICENSE)
