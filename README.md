# dsh-ontology-builder

English | [中文](README.zh.md)

Build trustworthy ontologies from data, documents and code — a Palantir-style ontology builder plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> Status: 0.1 (M1). Manual build loop works end to end: schema drafting and checks, publishing, materials, evidence-backed candidates, approval-gated review, queries and RDF export. LLM-driven extraction lands in 0.2. See the [design document](docs/DESIGN.md) (Chinese).

## Tools (0.1)

| Tool | Purpose |
|---|---|
| `ontology_project` | Create, list or inspect projects |
| `ontology_schema` | Read, draft (with checks) or diff the schema |
| `ontology_schema_publish` | Publish an immutable schema version — asks for approval |
| `ontology_material_add` / `ontology_material_read` | Store read-only source text (SHA-256), read lines to quote from |
| `ontology_assert` | Record candidate objects/links in a batch; every item needs a verbatim quote |
| `ontology_review_preview` / `ontology_review_commit` | Show candidates with evidence; confirm or reject — asks for approval |
| `ontology_batch_rollback` | Undo one extraction batch |
| `ontology_query` | ObjectSet query: filter, traverse links, aggregate |
| `ontology_export` | Turtle (OWL + SHACL + PROV) or JSON-LD |
| `ontology_audit` | Append-only audit log |

Confirmation and publishing go through DSH's approval service. If no one can answer (headless runs, or the session's approval policy is `never`), the change is refused.

## What it will do

- **Build**: start from competency questions, let DSH propose object types, properties and links from your materials, review and publish versioned schemas.
- **Extract**: map structured data, run schema-guided LLM extraction over documents (using the model you already configured in DSH), and parse source code into a code sub-ontology.
- **Trust**: every assertion carries field-level evidence; quotes are verified verbatim against the source; the model can only propose — confirmation requires your approval, either per item, per batch, or through a rule you approved.
- **Use**: query objects, traverse links and run validated actions from the DSH conversation; watch the graph grow as you build.

## Install

```sh
dsh plugin --profile <name> add dsh-ontology-builder
```

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`).

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `databasePath` | `ontology-builder.db` | SQLite database file for ontology projects |

## License

[Apache-2.0](LICENSE)
