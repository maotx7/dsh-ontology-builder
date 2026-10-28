# dsh-ontology-builder

[English](README.md) | 中文

从数据、文档和代码构建可信本体 —— 一个对齐 Palantir 本体模型的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。

> 状态：0.4（M4）。文档抽取使用 DSH 中已配置的模型，源代码被分析为代码子本体，能力问题作为回归测试运行；在对话中构建时，可以在浏览器 UI 里同步查看 schema、实例、待审核队列、证据和质量。详见[设计文档](docs/DESIGN.md)。

- **可信**：每个对象和关系都引用原文，引文逐字核对存储的只读原文。模型只能提议，任何内容都要经你批准才会确认：逐条、整批，或通过你批准过的规则。
- **行业无关**：对象类型、属性和关系类型由你定义（Palantir Foundry 的模型），不绑定任何行业。
- **无需额外密钥**：抽取复用你在 DSH 中已配置的模型。

## 快速上手（约 30 分钟）

需要 Node.js ≥ 22.13，以及可用模型的 DSH（`npm i -g @deepseek-ai/dsh`，或在源码目录中用 `pnpm exec dsh`；默认 DeepSeek 模型需要 `DEEPSEEK_API_KEY`）。

**1. 把插件装进 web profile**（2 分钟）

```sh
dsh my-ontology --from-default-profile web --dump-config > /dev/null   # 只需创建一次
dsh plugin --profile my-ontology add dsh-ontology-builder
```

**2. 用示例数据体验 UI**（5 分钟，不需要模型）

```sh
mkdir ontology-work && cd ontology-work
node ~/.dsh/profiles/my-ontology/node_modules/dsh-ontology-builder/examples/demo/seed.mjs
dsh my-ontology
```

示例脚本在当前目录写入 `ontology-builder.db`，DSH 在这里启动时插件用的就是这个文件。DSH 会打开 Web 界面，在对话中输入：

> 打开项目 demo 的本体 UI。

智能体调用 `ontology_ui`，返回类似 `http://127.0.0.1:<端口>/ontology/?project=demo` 的链接，在同一个浏览器中打开即可：

| 视图 | 内容 |
|---|---|
| Schema | 对象类型与关系类型的图（React Flow + dagre），高亮草稿相对上个发布版本的改动 |
| Instances | 对象关系图（Cytoscape.js），候选内容为虚线半透明；双击展开邻居 |
| Review | 按批次和类型分组的候选，显示阻断检查项，并列展示证据 |
| Materials | 原文，所有被引用片段高亮：绿色已确认，黄色候选；点击片段跳到对应条目 |
| Quality & versions | 六层质量报告、能力问题结果、schema 版本对比、审计日志 |

UI 只读。"Ask to confirm" 等按钮会复制一段请求，粘贴到对话中，智能体调用工具时会请你审批。对话改动项目后，各视图会自动刷新。

**3. 构建你自己的本体**（20 分钟）

把文档放进工作目录，然后和智能体对话，例如：

> 创建本体项目 "suppliers"。根据 `contracts.md` 提出能力问题，以及供应商、合同、产品的 schema。先给我看检查结果，我批准后再发布。
>
> 从 `contracts.md` 抽取候选。
>
> 列出可以确认的内容，然后作为一个批次确认。
>
> 为每个 must 问题保存查询，并运行质量报告。

整个过程中开着 UI：新候选以虚线节点出现，确认后变为实线。

处理代码时，让智能体扫描代码仓库（`ontology_code_scan`），并把对象关联到实现它们的符号（`ontology_code_link`）。

插件没加载？确认 `dsh plugin --profile my-ontology ls` 列出了 `dsh-ontology-builder`。`ontology_ui` 返回 `available: false`？说明 DSH 没有以 web 界面启动——profile 必须从 `web` 创建，而不是 `headless` 或 `tui`。

## 工具

| 工具 | 用途 |
|---|---|
| `ontology_project` | 创建、列出或查看项目 |
| `ontology_schema` | 读取、起草（带检查）或对比 schema |
| `ontology_schema_publish` | 发布不可变的 schema 版本 —— 需审批 |
| `ontology_material_add` / `ontology_material_read` | 存储只读原文（SHA-256），按行读取以便引用 |
| `ontology_extract` | 用 DSH 模型从材料中抽取候选；引文经过核验，不合格的退回修正 |
| `ontology_assert` | 手动按批次记录候选对象/关系；每条都需要逐字引文 |
| `ontology_review_preview` / `ontology_review_commit` | 带证据展示候选；确认或拒绝 —— 需审批 |
| `ontology_batch_rollback` | 撤销一个抽取批次 |
| `ontology_resolve` | 推荐重复项、合并（需审批；旧键成为别名）或标记为不同 |
| `ontology_conflict` | 列出并解决不同来源不一致的值（需审批） |
| `ontology_rule` | 预览、批准并应用确认规则；抽样复核；准确率过低自动停用 |
| `ontology_query` | ObjectSet 查询：过滤、沿关系遍历、聚合 |
| `ontology_export` | Turtle（OWL + SHACL + PROV）或 JSON-LD |
| `ontology_code_scan` | 分析源代码（TS/JS/Python/Go/Java/Rust，tree-sitter），得到模块、符号、导入和调用；文件成为可引用的材料 |
| `ontology_code_search` | 查找符号、列出导入/调用邻居、列出对象↔代码关联 |
| `ontology_code_link` | 提议对象↔代码关联（如 `implementedBy`），以代码本身为证据 |
| `ontology_question` | 为每个能力问题保存回答它的查询；全部作为回归测试运行 |
| `ontology_quality` | 六层质量报告：结构、逻辑、证据、坏味道、问题覆盖、抽取质量 |
| `ontology_audit` | 只追加的审计日志 |
| `ontology_ui` | 浏览器 UI 地址（仅 web 界面） |

发布、确认、拒绝、合并、解决冲突和批准规则都经过 DSH 的审批服务。无人应答时（headless 运行，或会话审批策略为 `never`），改动会被拒绝。规则只确认通过全部常规检查的候选，从不基于推断证据确认，并且总会排入抽样复核。

## 安装

```sh
dsh plugin --profile <name> add dsh-ontology-builder
```

需要 Node.js ≥ 22.13（使用内置 `node:sqlite`）。代码分析使用可选依赖 `@vscode/tree-sitter-wasm`（MIT，WebAssembly，无需原生编译）；其余功能不依赖它。UI 已预先构建进包内，没有运行时依赖。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `databasePath` | `ontology-builder.db` | 本体项目的 SQLite 数据库文件，相对 DSH 启动目录 |
| `extraction.chunkChars` | `4000` | 每次发给模型的分块字符数 |
| `extraction.overlapChars` | `300` | 相邻分块的重叠字符数 |
| `extraction.maxAttempts` | `3` | 每个分块的模型尝试次数（含修正） |
| `extraction.maxChunks` | `20` | 每次 `ontology_extract` 处理的分块数；其余返回以便续跑 |
| `extraction.maxTokens` | `8192` | 每次模型调用的输出 token 上限 |

## 安全

- 材料文本只发送给你 DSH profile 中配置的模型。
- UI 由 DSH 自己的 Web 服务器在 `/ontology/` 下提供。每个请求都经过 DSH 的 Host/Origin 校验和登录 cookie，与 DSH 界面相同；缺少它们会得到 401/403。只有你配置 DSH 允许时，其他机器才能访问。
- UI 只暴露只读接口，不能确认、拒绝、合并或发布任何内容；这些改动只能作为工具调用、经你审批后执行。

## 开发

```sh
pnpm install
pnpm test        # 构建插件和 UI，然后运行测试
pnpm dev:ui      # UI 的 Vite 开发服务器
```

UI 位于 `client/`（React、React Flow、dagre、Cytoscape.js，均为 MIT），构建到 `dist/ui`。

## 许可证

[Apache-2.0](LICENSE)
