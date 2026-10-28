# dsh-ontology-builder

[English](README.md) | 中文

从结构化数据、文档和源码构建可信的本体：一个参照 Palantir 本体理念的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。

> 状态：早期开发（M0）。插件可在 DSH 中加载并提供 `ontology_status` 工具，构建功能从 0.1 起陆续提供。详见[设计文档](docs/DESIGN.md)。

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
