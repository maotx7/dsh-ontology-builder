# dsh-ontology-builder 设计文档

> 状态：草案 v0.1（2026-10-28）。目标 DSH 版本：`0.2.0-rc.2` 及以上。

## 1. 定位

一个独立、开源、与行业无关的 DeepSeek Harness（DSH）插件：从结构化数据、文档和源码中**构建可信的本体**，并让 agent 在对话中**使用**它。安装一个包即可完成"定范围 → 建 schema → 抽实例 → 审核 → 发布 → 使用"全流程。

做成 DSH 插件而不是独立工具，原因是三件只有在 agent 宿主里才自然的事：

- **DSH 指挥构建**：用户用自然语言描述目标，DSH 调用插件工具提议 schema、启动抽取、整理审核批次。
- **用户授权推进**：确认动作走 DSH 原生审批（`ctx.approval`），可以单条、整批、或按用户批准的规则推进到 confirmed。
- **边看边建**：对话、后台抽取和可视化共用同一份数据，改动实时出现在 UI 上。

非目标：不内置任何行业类型；不做通用图数据库；不让 LLM 直接决定什么是"真的"。

## 2. 概念模型（对齐 Palantir Foundry Ontology）

| 概念 | 含义 | 版本 |
|---|---|---|
| ObjectType | 一类实体：`apiName`、主键、标题属性、属性列表 | 0.1 |
| Property / ValueType | 带基础类型的属性；ValueType 加语义约束（正则、枚举、单位） | 0.1 |
| LinkType | 两个类型间的关系：两侧 apiName、基数（1:1 / 1:N / M:N） | 0.1 |
| ActionType | 对本体的事务性修改：参数、规则、提交条件、是否需确认 | 0.2 |
| Interface | 多个类型共享的"形状"，用于多态查询 | 0.3 |
| ObjectSet | 查询：过滤、聚合、沿链接遍历；JSON DSL，不让 LLM 写 SQL | 0.1 |

所有对象、属性值和链接（统称**断言**）都有 `status` 与 `evidence[]`。
插件内置两个与行业无关的系统子本体：**来源**（Source / Chunk / Evidence）和可选的**代码**（Module / Symbol / Calls / Imports）。

## 3. 构建流程

| 阶段 | 内容 | 退出门禁 |
|---|---|---|
| 1 定范围 | 记录能力问题（Competency Questions），分 must / should / could | ≥1 个 must 问题 |
| 2 接材料 | 登记数据、文档、代码；记录 SHA-256 与材料画像 | 每个 must 问题都有候选材料 |
| 3 提 schema | DSH 根据问题和样本提议类型、属性、链接；或导入 OWL / LinkML / YAML | 结构检查无错误 |
| 4 审 schema | 逐项确认或对话修改；发布 schema 版本 | 合理性检查无阻断项 |
| 5 抽实例 | 结构化走映射；文档走受 schema 约束的 LLM 抽取；代码走 tree-sitter | 每条断言都带证据 |
| 6 消歧审核 | 分级消歧；按组批量审核；可沉淀为规则 | 抽样准确率达阈值 |
| 7 验证发布 | 能力问题逐个跑成查询；生成质量报告；发布不可变版本 | must 问题全部有结果 |
| 8 演进 | 记录未命中的问题和被推翻的结论，驱动下一版 | 回归不退化 |

每个类型都要能追溯到它服务的能力问题；追溯不到的标为冗余。

## 4. 可信设计

可信 = 来源可查、过程受控、结果可验证、变更可追溯。每一条都应能被第三方独立验证。

### 4.1 来源

- 材料入库记录 SHA-256 且只读；内容变化即新材料，旧证据不被覆盖。
- 证据精确到字段：`{ sourceId, locator, quote, field, role, extractor, confidence, batchId }`。
- **原文逐字核验**：`quote` 必须能在源文本中找到（允许空白规范化），否则拒收。确定性规则，无例外。
- 证据角色：`specified`（文档规定）、`observed`（源码观察）、`correspondence`（交叉对应）、`inferred`（推断）。`inferred` 永不自动确认。

### 4.2 过程

- 状态机：`candidate → confirmed | rejected`。**工具接口没有让 LLM 直接写 confirmed 的路径**。
- 每次确认都必须引用一个授权记录：一次用户审批（approval），或一条用户批准过的规则。
- 每次 LLM 抽取记录 prompt 模板版本、provider / model、输入块哈希和原始输出，可重放。
- 抽取以批次（batch）为单位，可整批回滚。

### 4.3 结果

六层检查，前四层是确定性的：

1. **结构**：命名唯一、链接端点存在、基数合法、继承无环。
2. **逻辑**：实例违反值类型、必填、基数约束。
3. **证据**：confirmed 断言必须有通过核验的证据。
4. **建模异味**（参考 OOPS! 缺陷目录）：过泛类、同义重复类、实例被建成类、空类、单子类层级。
5. **能力问题覆盖**：每个问题保存为查询，发布前须有结果。
6. **抽取质量**：审核抽样准确率、重复抽取一致性、可选金标准集的精确率 / 召回率。

问题分级：阻断（不能发布）、警告（发布需填写说明）、提示。置信度不采用模型自报，由一致性、证据互证和审核历史计算，并在报告中说明算法。schema 可导出 OWL 2 + SHACL，供外部工具独立校验。

### 4.4 变更

- 已发布版本不可变，内容哈希作为版本指纹。
- schema 变更走 proposal，附影响分析；破坏性变更需显式确认。
- 审计日志只追加：谁、何时、依据哪个授权、改了什么。

### 4.5 插件自身

无遥测；材料只发送给用户在 DSH 中配置的模型；依赖精确锁定；npm 发布附 provenance；CI 做许可证检查。

## 5. 与 DSH 协同

已核实的 DSH 接口（`0.2.0-rc.2`）：

| 能力 | 接口 | 用途 |
|---|---|---|
| 工具 | `ctx.tools.register({ name, parameters, output, execute })` | 暴露全部构建 / 使用能力 |
| 模型 | `ctx.agentDefaultModel.currentSelection()` + `ctx.llm.stream(GenerateOptions)` | 后台批量抽取，复用用户已配置的模型 |
| 审批 | `ctx.approval.request({ agent, toolName, callId, reason })` → `'allowed-once' \| 'rejected' \| …` | 批量确认、规则启用的用户授权；无应答者时默认拒绝 |
| Web | `ctx.webServer.register({ kind: 'prefix', path, handler })` | 可视化 UI 的数据接口 |

`GenerateOptions` 没有 JSON 模式，结构化抽取通过一个 `submit_extraction` 工具让模型以工具调用返回，插件做 schema 校验，不合格带错误重试。

### 5.1 三种确认方式

| 方式 | 流程 |
|---|---|
| 单条 | 用户在对话或 UI 中确认 → 工具调用 → `ctx.approval` 记录 |
| 批量 | DSH 调 `ontology_review_preview` 生成批次摘要 → `ontology_review_commit` 内部发起 `ctx.approval.request` → 用户批准后整批写入；核验不通过的条目自动剔除 |
| 规则 | 用户批准规则（同样经 `ctx.approval`）→ 命中规则的新候选自动确认并按比例抽样复核；规则历史准确率低于阈值自动停用 |

审批策略为 `never`（无人值守 / CI）时所有确认被拒绝：后台可以抽取，但不会有任何内容在用户不知情时被确认。

### 5.2 边看边建

- 后台抽取批次的进度、新增候选通过 Web 接口推送到 UI。
- UI 可暂停 / 中止批次；可把选中的节点、证据或冲突带上下文发回对话。

## 6. 架构

```
src/
  index.ts      Cordis 入口：apply(ctx, config)，注册工具与 Web 接口
  core/         元模型、检查器、存储（node:sqlite）、ObjectSet、导入导出 —— 不引用 DSH
  extract/      材料解析、schema 提议、抽取、核验、消歧 —— 通过参数接收 LLM 调用函数
  dsh/          工具定义、审批与模型适配
  web/          只读 UI 数据接口与静态资源服务（/ontology）
client/         UI 源码（React + React Flow + Cytoscape.js），构建到 dist/ui
```

- 存储：Node 22 内置 `node:sqlite`（含 FTS5），零原生依赖；数据库路径由配置给出。
- 重型可选依赖（web-tree-sitter、mammoth、pdfjs-dist）按需 `import()`，缺失时工具返回明确提示。

## 7. 可视化（0.4）

| 视图 | 用途 | 选型 |
|---|---|---|
| Schema | 类型卡片、属性、基数、自动分层布局 | React Flow + dagre |
| 实例探索 | 从一个对象出发按需展开邻居；按类型 / 状态 / 置信度过滤 | Cytoscape.js |
| 审核工作台 | 分组表格 + 原文证据并排高亮 + 批量操作 | React |
| 证据阅读器 | 打开原文，高亮被抽取片段，点击跳转对象 | React |
| 质量与版本 | 六层检查、能力问题覆盖、版本 diff | React |

未确认内容以虚线 / 半透明显示。所选库均为 MIT。

实现（0.4）：

- 插件在 `webServer` 与 `connection` 服务存在时（`dsh --profile web`）注册 `/ontology` 前缀路由；headless / tui 下不注册，`ontology_ui` 返回不可用提示。
- 每个请求先过 `connection.requestRejection`（Host/Origin 校验 + 登录 cookie），与 DSH 界面同一道防线。
- UI 只读：数据接口只提供查询，不提供任何确认、拒绝、合并、发布入口。UI 上的操作按钮只复制一段请求，用户贴回对话，由工具调用经 `ctx.approval` 执行。这样审批记录只有一个来源，UI 不会成为绕过审批的通道。
- 边看边建：UI 每 3 秒查询审计日志的最新序号，变化时各视图重新拉取。后台批次的暂停 / 中止留待后续版本。
- 前端源码在 `client/`，Vite 构建到 `dist/ui` 随包发布，运行时无新增依赖。

## 8. 里程碑

| 版本 | 内容 | 验收 |
|---|---|---|
| 0.0.x（M0） | 仓库、CI、包骨架，插件能在 DSH 中加载 | DSH 中可见 `ontology_status` |
| 0.1（M1） | 元模型、结构检查、存储、来源与证据、原文核验、ObjectSet、TTL/JSON-LD 导出 | 示例 schema 导入→查询→导出 |
| 0.2（M2） | 文档抽取（`ctx.llm`）、批次、消歧、审批确认、规则 | 示例文档抽出实例，证据可定位到原文 |
| 0.3（M3） | 代码子本体、文档↔代码关联、质量报告、能力问题回归 | 插件能分析自己的仓库 |
| 0.4（M4） | 可视化 UI、文档与示例 | 新用户照 README 30 分钟跑通 |
