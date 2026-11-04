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

### A 类核查结果（2026-11-04，主控实测）

| 字段 | 空文件数 | 核查结论 |
|---|---|---|
| `expected_deps` | 177 | ✅ **100% 干净** —— 这 177 个文件的实际 import **全是 0**（真的没有依赖） |
| `expected_apis` | 137 | 73 个：实际侧也 0 个导出函数 ⇒ 正确 · 36 个：在 `excluded` 内 ⇒ 正确 · 28 个不在 excluded ⇒ **逐个查源码后全部正确**（Go 函数名小写未导出 / TS 源码里确实没有 `export`） |

**★ 核查挖出一个真盲区（但数字被代理纠正过两次，见下）**
```
cache.db kind 分布：function 3483 · **const 3403** · interface 1185 · type 299 · method 138 · class 15（全有签名）

**粗筛（错）**：「导出 const 且 signature 含左括号」= 83 条 ⇒ **这不是判据**
  `wrapData(async (a) => {...})` 里既有括号又有箭头 ⇒ 被误算进来。这正是 0.4「能数出来 ≠ 数得对」

**严格判据（对）**：initializer **必须以函数表达式开头** ⇒ **10 条**
  拆解：真函数表达式 **10** · wrapper 调用形态 **16** · 数据常量 **57**
    · 真函数表达式例：`intentMarker = (path, desc): string =>` · `humanOf = (x) =>`
    · wrapper 调用例：`upgradeHandler = wrapData(async (a) => …)` ⇒ **语法证不出返回是不是函数**
    · 数据常量例：`DEFAULT_LANGS = new RefactorLangRegistry()`（**不是函数**）· `OBSERVE_RULE_IDS = ....map(...)` · `goObservePack = {...}`

**★ 真 delta 更小：+2/册（不是 +10）** —— 因为 A 类铁律「只填空值」：
  10 条里 8 条所在文件的 `expected_apis` **本来就非空** ⇒ 整字段跳过
  ⇒ 只有 2 个文件受益：`rename_symbol/languages/cs.ts` · `java.ts`（各 1 条）
```
⇒ 修法：`isExportedSymbol` 加一类 —— kind 为 const ∧ modifiers 含 export ∧ initializer 以函数表达式开头
   **数据常量与调用形态必须不命中**（双向测试钉住；`new Set(...)` / `X.map(fn)` / `X = buildDefaultLangs()` 一律判否）
⇒ **wrapper 那 16 条不收**（0.17③ 挂账）：白名单是"哪些 wrapper 返回函数"的**第二处权威**，新增 wrapper 忘了加就永久漏且无人报 ⇒ 要的是**语义层（D 类）**，不是白名单
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

---

## G 类：4 个缺口字段的裁决（2026-11-04 由两个模型独立作答后合并裁定）

> 依据：Astra 与 DeepSeek-V4.1-Flash 各答一份，**原则采纳 Flash，落点采纳 Astra**（详见文末"为什么这么裁"）。
> 准入流程见 `AGENTS.md` **0.29⑦**（逐项检查表住那里，本文件不复述）。

### 结论表

| 类 | 落点 | kind / 字段 | **今天能判？** | 依据（实测） |
|---|---|---|---|---|
| **错误契约** | `decision.expectations` | `run`（表达式求值） | ✅ | `run` 的求值域含 `validateDSL` ⇒ 可直接写 `validateDSL(input).keys.some(k=>k.startsWith('schema:'))` |
| 错误契约（纯函数） | 同上 | `behavior-cases` | ✅ | 仅当目标文件**零值 import** |
| **非目标 · 禁止依赖** | 同上 | `edge-absent` | ✅ | kind 已存在 |
| **非目标 · 禁止代码形状** | 同上 | `source-has` + `mustNot` | ✅ | 已存在，且匹配前剥注释 |
| 非目标 · 册级散文（"不做多租户"） | **不进册** ⇒ `goals.rationale` / `docs/` | — | ❌ **原理上不可判** | 「什么」的域无穷 ⇒ 无证伪条件 ⇒ 无职位条目 |
| **性能 · 纯函数形态上界** | 同上 | `behavior-cases` | ✅ | 如 `fitWithinBudget(sizes, budget)` |
| 性能 · 耗时 / 内存 | **不进册当要求** ⇒ 挂欠账 | — | ❌ **目前判不了** | 无探针条件；且裸毫秒阈值 = 0.16「永远会亮的灯」 |
| **并发 · 幂等 / 顺序 / 最终态** | **挂欠账** | — | ❌ **实测判不了** | `behavior-cases` 硬门槛**零值 import**（`E-CRIT-006`）⇒ 碰文件写入的一律拒 |
| 并发 · 互斥 | **挂欠账** | — | ❌ | 无并发执行器；"用了锁" ≠ 并发安全（0.29⑦ 第 9 项） |

### 净结果：**新增 0 个字段、0 个 kind**

现有 9 种 kind（`file-exists` / `symbol-exists` / `signature-matches` / `edge-exists` / `edge-absent` /
`call-exists` / `source-has` / `run` / `behavior-cases`）能表达这四类的**可判部分**；
判不了的部分按 **0.17③ 挂欠账**并**显式声明"今天判不了"**，不许伪装成要求。

### 两份提案被否掉的具体方案（留档，防以后有人再提）

| 提案 | 出自 | 否决理由（实测） |
|---|---|---|
| `expected_deps[].polarity: 'require'\|'forbid'` | Flash | `expected_deps` 实测是 **`string[]`**（`{"type":"array","items":{"type":"string"}}`）⇒ 要迁移 594 条存量；改用 `edge-absent` 判据**不动形状** |
| 新 `error_contract[]` 字段 | Flash | 错误契约能用 `run` / `behavior-cases` 表达 ⇒ 命中 0.29⑦ 第 1 项（现有字段能表达 ⇒ 拒绝新增） |
| 新 `concurrency[]` 字段 | Flash | 命中 0.29⑦ 第 7 项（写不出能跑的判据 ⇒ 不是要求）⇒ 应挂 `goals` 欠账，不新增字段 |
| 新 kind `budget` | Flash | 同上；纯函数部分用 `behavior-cases` 已够，耗时段今天判不了 |
| `decision.rationale` 承载"不承诺" | Astra | **采纳**（但"禁止"必须另有判据 —— 两者不能混装一张清单） |

### 为什么"原则用 Flash、落点用 Astra"

```
Flash 给了三条更硬的原则（采纳）：
  ① 「**目前**判不了」的精确陈述可进册并挂欠账；「**原理上**判不了」的不进册 —— 这是 0.17③ 的精确化
  ② `contract` 是**采集来的事实桶**（有 provenance.harvested_at / commit / runtime.call_count）
     ⇒ 把要求写进事实桶 = oracle 问题重演（源码一改，下次采集自动跟上 ⇒ 永远绿）⇒ **错误契约不进 contract**
  ③ 性能**禁裸毫秒**（相对棘轮 / 形态上界）—— 直接对应 0.16「永远会亮的灯」

Astra 给了更可行的落点（采纳）：
  · 零新增字段，全部复用既有 kind ⇒ 今天就能落，不用先改 schema
  · 区分「不承诺」（rationale）与「禁止」（判据）—— 一张 non_goals 清单会混装两种相反的验收语义

实测补的两条（两份都不知道）：
  · `behavior-cases` 的零值 import 门槛 ⇒ 幂等也判不了（两人都高估了今天的执行能力）
  · `expected_deps` 是 string[] ⇒ Flash 的 polarity 要迁移
```
