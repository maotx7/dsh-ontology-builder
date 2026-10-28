# dsh-ontology-builder

English | [中文](README.zh.md)

Build trustworthy ontologies from data, documents and code — a Palantir-style ontology builder plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

> Status: early development (M0). The plugin loads in DSH and exposes `ontology_status`; building features land in 0.1+. See the [design document](docs/DESIGN.md) (Chinese).

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
