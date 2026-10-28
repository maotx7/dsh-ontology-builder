# dsh-ontology-builder

[English](README.md) | 中文

从结构化数据、文档和源码构建可信的本体：一个参照 Palantir 本体理念的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。

> 状态：0.1（M1）。手动构建闭环已可用：schema 起草与检查、发布、材料、带证据的候选、经审批的审核、查询和 RDF 导出。基于模型的自动抽取在 0.2 提供。详见[设计文档](docs/DESIGN.md)。

## 工具（0.1）

| 工具 | 作用 |
|---|---|
| `ontology_project` | 创建、列出、查看项目 |
| `ontology_schema` | 读取、起草（附检查结果）、对比 schema |
| `ontology_schema_publish` | 发布不可变的 schema 版本，需用户审批 |
| `ontology_material_add` / `ontology_material_read` | 存入只读原文（SHA-256），按行读取以便引用 |
| `ontology_assert` | 按批次记录候选对象和链接，每条都要有逐字可查的引文 |
| `ontology_review_preview` / `ontology_review_commit` | 查看候选及证据；确认或驳回，需用户审批 |
| `ontology_batch_rollback` | 整批撤销一次抽取 |
| `ontology_query` | ObjectSet 查询：过滤、沿链接遍历、聚合 |
| `ontology_export` | 导出 Turtle（OWL + SHACL + PROV）或 JSON-LD |
| `ontology_audit` | 只追加的审计日志 |

确认和发布都走 DSH 的审批服务。没有人能应答时（无头运行，或会话审批策略为 `never`），变更会被拒绝。

## 规划能力

- **构建**：从能力问题出发，由 DSH 根据材料提议对象类型、属性和链接，审核后发布带版本的 schema。
- **抽取**：结构化数据走映射；文档用 DSH 中已配置的模型做受 schema 约束的抽取；源码解析为代码子本体。
- **可信**：每条断言都有字段级证据，引用原文逐字核验；模型只能提议，确认必须经你批准（单条、整批或你批准过的规则）。
- **使用**：在 DSH 对话中查询对象、沿链接遍历、执行带校验的动作，边建边看图谱变化。

## 安装

```sh
dsh plugin --profile <name> add dsh-ontology-builder
```

需要 Node.js ≥ 22.13（使用内置 `node:sqlite`）。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `databasePath` | `ontology-builder.db` | 本体项目使用的 SQLite 数据库文件 |

## 许可证

[Apache-2.0](LICENSE)
