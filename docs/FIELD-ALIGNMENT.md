# 字段对齐表（FIELD-ALIGNMENT）—— 对拍成立的前提，也是所有工具的**数据地基**

> **为什么有这份文档**（用户 2026-11-04）：
> 「我以前一直没有思考清楚这个问题…… 其实如果这些字段全部成立的话，我们很多工具在后续在这些字段上面建才是正确的吧，
> 而且依托这些字段才能建得更有效，包括什么自动测试自动检测冲突等这些乱七八糟的，现有的这些功能应该依托在这些完整的字段下更可信。」
>
> ⇒ **字段是地基**：工具从同一套字段派生，不许各自重新扫描（0.9.1 在数据层的展开）。
> ⇒ **对拍的前提是两侧字段能对上**；对不上不是精度问题，是**没有对应物**。

---

## 一、设计侧字段全景（`schema/design_dsl.schema.json` 实测）

| 层 | 字段 | 必填 | 说明 |
|---|---|---|---|
| 顶层 | `id` `type` `feature` `version` `title` `status` | `id/type/feature` | 册的身份 |
| `geometry` | `nodes[]` `edges[]` `layout` | `nodes` | 结构与连接 |
| `geometry.nodes[]` | `id` `type` `path` `title` `layer` `arch_layer` `task` `gate` `decision` `intent` `overlay` `sub_dsl` | `id` | 一个节点 = 一个可描述的单元 |
| `geometry.edges[]` | `id` `from` `to` `label` `layer` `intent` | `id/from/to` | 边（调用/依赖/数据流） |
| `semantic.files[]` | `id` `path` `responsibility` `expected_apis[]` `expected_deps[]` `expected_behavior` `layer` `contract` | `id/path/responsibility` | **契约层**（核心） |
| `semantic` | `multi_file_invariants[]` `expected_global_behavior[]` | — | **跨文件不变量 / 全局行为** |
| `contract`(BrickContract) | `role{class,basis,confidence,reasons}` `shapes{exposes,consumes}` `effects{writes,holds,emits,reads_config}` `runtime` `provenance` | 全必填 | 积木契约 |
| `decision`(NodeDecision) | `expectations[]` `rationale` `consequences` `acceptance` | — | 判据与决策理由 |
| `meta` | `goals[]` | — | 结构化目标 |

**★ schema 里没有的字段（真正的“缺字段”）**：错误契约 · 非目标(non-goals) · 性能/资源约束 · 并发语义。

---

## 二、实际侧字段全景（`.agent-io/cache.db` 实测）

| 表 | 行数 | 关键列 |
|---|---|---|
| `files` | 585 | `path` `language` `content_hash` `norm_hash` `node_count` `errors` |
| `nodes` | 9186 | `kind` `name` `qualified_name` `file_path` `signature` `params` `return_type` `type_params` `modifiers` `docstring` `members` `parent` `body_text` `body_hash` `sym_hash` `is_closure` |
| `edges` | 16866 | `source` `target` `kind`(`call`/`type_ref`/`import`) `metadata` `provenance` |
| `imports` | 3108 | — |
| `identifiers` | 311290 | — |
| `unresolved_refs` | **37124** | `reference_name` `reference_kind` `status` `candidates` |
| `symbol_diffs` | 213 | `added` `removed` `changed` `norm_from` `norm_to` |
| `scan_changes` | 645 | `path` `kind` `before_hash` `after_hash` |
| `scan_runs` | 57 | `at` `files_before` `files_after` `added` `changed` `removed` |
| **`contracts`** | **0** | 契约（role/shapes/effects）—— **从未采集** |
| **`fields`** | **0** | 数据形状 —— **从未采集** |
| **`signatures`** | **0** | 独立签名表（但 `nodes.signature` 有 92.7%） |
| **`occurrences`** | **0** | — |

**填充率（nodes，分母 9186）**：
```
id/kind/name/qualified_name/file_path/start_line/end_line/is_closure/updated_at  100%
language 99.0% · signature 92.7% · sym_hash 92.7% · modifiers 89.9% · type_params 71.2%
body_text 49.3% · docstring 46.8% · params 45.9% · return_type 42.2%
members 13.1% · parent 8.1%
```

---

## 三、**对齐矩阵**（本文件的核心）

| 设计侧字段 | 实际侧来源 | 手段 | 现状 | 缺口性质 |
|---|---|---|---|---|
| `path` | `files.path` | 走查 | ✅ 100% | — |
| `responsibility` | **无来源** | 人 | ✅ 100% | 人写（正确） |
| `expected_apis[].signature` | `nodes.signature` | AST | ⚠️ 92.7% | 需投影（设计侧 0%） |
| ↳ 参数/返回类型 | `nodes.params` / `return_type` | **语义层** | ⚠️ 45.9% / 42.2% | 实际侧不全 ⇒ 接语义层 |
| `expected_deps` | `edges(kind=import)` + `imports` | AST | ⚠️ 1489 条 | 需投影（设计侧 0.4%） |
| `contract.role` | `contracts.role` | 契约采集 | ❌ 表 0 行 | **从未跑采集** |
| `contract.shapes` | `fields` + `nodes.members` | 形状采集 + AST | ❌ 表 0 行 / 13.1% | **从未跑采集** |
| `contract.effects` | `contracts.effects` + observe | 采集 + 运行时 | ❌ 表 0 行 | **从未跑采集** |
| `contract.runtime` | observe 事件流 | 运行时插桩 | ❌ 未对全仓跑 | 需运行 |
| `title` | `docstring`(46.8%) | AST + 人 | ⚠️ 3.7% | 半自动（docstring 只有一半） |
| `expected_behavior` | **无来源** | 人 + 判据 | ❌ 0.1% | 人写 |
| `multi_file_invariants` | **无来源** | 人 | ❌ 0 条 | 人写 |
| `expected_global_behavior` | **无来源** | 人 | ❌ 0 条 | 人写 |
| `decision.expectations` | **无来源** | 人 | ⚠️ 19.4%（590 条） | 人写 |
| `decision.rationale/consequences` | **无来源** | 人 | ❌ 5.4% / 1.9% | 人写 |
| 错误契约 · 非目标 · 性能约束 | **无来源** | 人 | ❌ **无字段** | 要先加字段 |
| —（实际侧自缺） | `parent`（嵌套） | AST | ❌ 8.1% | **提取没写全** |
| —（实际侧自缺） | `members`（类成员） | AST | ❌ 13.1% | **提取没写全** |
| —（实际侧自缺） | 跨文件符号绑定 | **语义层(LSP)** | ❌ 37k unresolved | 接语义层 |

**交叠区（两侧都有）只有三样**：`path` ✅ · `signature` ⚠️ · `import 边` ⚠️。
**其余全是“一侧有、另一侧没有”** ⇒ 这就是对拍一直对不上的真因。

---

## 四、缺口分类与补齐手段（决定做什么，不做什么）

| 类别 | 字段 | 手段 | 成本 |
|---|---|---|---|
| **A 投影**（实际侧有，设计侧空） | `expected_apis` · `expected_deps` | 从 `nodes`/`edges` 投影 | **低（机械）** |

> ★★ **A 类的铁律：只填空值，绝不覆盖非空值**（2026-11-04 与 T85/D1 + T343 冲突后裁定）
>
> **冲突**：本表原把 `expected_apis ← nodes.signature` 列为"低（机械）"，而仓里 2026-10-09 的 **T85/D1** 刻意让
> `import_project` 摘掉 `expected_apis`（`import_project.ts:1734`），**T343** 更用 `opl.ts:170 assertContractNotFromCode()`
> 直接抛错拒绝"把现状签名喂进契约"，原话：「期望侧 = 实现侧 = 自己测自己（**恒真、永远绿**）—— 正是本仓最忌的装饰闸」。
>
> **裁定的区分**（两者都成立，因为说的不是同一件事）：
> | 做法 | 后果 | 裁定 |
> |---|---|---|
> | **派生一次**：字段为空时填（之后冻结） | 成为**基线** ⇒ 代码一改 drift 就显形 | ✅ **允许**（这就是 0.29 第①步） |
> | **每次扫描覆盖**：不管有没有值都写 | 人的编辑被冲掉 ⇒ 期望=实现 ⇒ **恒真** | ❌ **禁止**（T85/D1 真正要防的） |
>
> ⇒ **实现判据**：`if ((existing.expected_apis ?? []).length > 0) skip;` —— 派生过或人编辑过的文件，重跑**一字不动**。
> ⇒ **provenance 必须写**：`notes: from:cache.db@<scanRev>` ⇒ 派生基线与"人写契约"**可 grep 区分**。
> ⇒ **drift 的 `clean` 是 baseline-freeze 语义**（冻结时刻 design==code 是构造出来的），**不是**"我们验证了设计对不对"。
>    这句话必须同时出现在**代码注释**里，否则下一个人会把它当正确性证明。
> ⇒ **必测**：手动给一个文件加一条假 API → 重跑派生 → 确认那条假 API **还在**（没被覆盖）→ 还原。**没有这条测试，A 类就是装饰闸。**
| **B 采集**（两侧都空，有采集器但没跑） | `contract.role/shapes/effects` | 跑 `contracts`/`fields` 采集 | **中** |
| **C 提取补全**（AST 拿得到但没写全） | `parent` · `members` · `docstring` | 补 AST 提取 | **中** |
| **D 语义层**（语法层拿不到） | `return_type` · `params` 精确性 · 跨文件绑定（37k） | 接 tsc Checker / `go/packages` | **高（但是质变）** |
| **E 运行时**（静态拿不到） | `contract.runtime` · 实际调用目标 | observe 插桩 | **中** |
| **F 人工**（无来源） | `responsibility` · `expected_behavior` · `invariants` · `goals` · `rationale` · 错误契约 · 非目标 | 人写 + 判据 | **必须人** |
| **G 无字段**（要先加） | 错误契约 · 非目标 · 性能约束 · 并发语义 | schema 扩展 | 先定 schema |

---

## 五、**工具必须建在这些字段上**（用户裁定的核心）

| 工具/能力 | 应依赖的字段 | 现在依赖什么 | 状态 |
|---|---|---|---|
| 自动测试（`behavior-cases`） | `expected_behavior` + `contract.effects` | 人手写用例 | 字段空 ⇒ 覆盖率低（19.4%） |
| 冲突检测（写闸 / 计划闸） | `expected_apis` + `expected_deps`（谁依赖谁） | 文件级卡占位 | 字段空 ⇒ 只能判"文件被占" |
| 影响面（`impact`） | `edges` + `expected_deps` | `edges`（部分） | 缺 `expected_deps` ⇒ 漏"应该依赖" |
| 漂移检测（`drift`） | `expected_apis` ↔ `nodes.signature` | 同上 | **左侧空 ⇒ 永远 `no_comparison`** |
| 契约门（`contract_gate`） | `contract.*` | 同上 | **表 0 行 ⇒ 无输入** |
| 增量选择（`verify:changed`） | `scan_changes` + `symbol_diffs` | `git` | 字段有，未接（0.19 违例） |
| 对拍（`round-trip`） | `expected_apis` + `contract` + `invariants` | `diff_views`（全量比） | **两侧空洞 ⇒ 必然对不上** |

**判据（可判真假）**：
- 一个工具若**重新扫描源码**去取本表已有的字段 ⇒ 违例（0.9.1 数据层）
- 一个工具若**依赖的字段填充率为 0** ⇒ 它的结论不可信，必须在回执里声明

---

## 六、验收判据（这份文档自己可判）

| # | 条件 |
|---|---|
| ① | 本表列出的**每个设计侧字段**都有明确"来源 / 手段 / 现状"三列，无空缺 |
| ② | 每类缺口（A–G）都有补齐手段与成本估计 |
| ③ | 每个**现有工具**都标注了它应依赖的字段与现状 |
| ④ | 填充率**不写死**：每次核对必须现算（`nodes` 分母 9186、`files` 585、`edges` 16686 等会变） |
