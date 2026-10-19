# HANDOFF —— 交接给下一个窗口

> 生成：2026-10-19 18:00（本窗口 7:43 → 18:00，约 10.3 小时）
> ★ **18:20 修订**：⑥ **闭环**（`rewrite.mjs --apply` 落地 + 消融自证）·
>   第四道门命令改对（`npm run design:mutate`，原写 `mutate` 是错的）·
>   §4/§7/§9 已按新读数更新（`sourceOnly` 94 → 0，全是口径假差异）
> 仓库：`D:\project_develop\design-canvas`
> ★ 先读这一份，再读 §1 列出的"必读文档"。**本文件是索引，不是替代。**

---

## 0 · 一句话：这个项目是什么

**把"设计"做成代码的唯一真源**：源码 → 扫描成实际 DB → 投影成实际 DSL → fork 成设计 DSL
→ 人在设计 DSL 上写意图 → 生成设计 DB → 重写回源码。

**核心纪律（用户原话）**：
> *"DSL 只有结构 + 意图，没有实现。"*（所以设计 DB 里没有函数体 ⇒ 只能重写签名/结构，实现永远人写）

---

## 1 · 必读文档（按顺序）

| 路径 | 内容 | 什么时候读 |
|---|---|---|
| `docs/HANDOFF.md` | **本文件**（索引 + 现状 + 坑） | 每次开新窗口 |
| `docs/GOAL.md` | 为什么做（对拍 · 设计即真源） | 想理解动机 |
| `docs/VISION.md` | 该是什么（§6 是"接入重构线"= ⑥ 的上位目标） | 做 ⑥ 之前 |
| `docs/DESIGN.md` | 现在是什么（分层/数据流） | 改架构之前 |
| `docs/GUIDE-GATE.md` | 判据怎么写（`expectations` 7 种 kind） | 写 decision 之前 |
| `docs/GUIDE-USAGE.md` | 怎么用（工具 → 场景） | 找工具 |
| `docs/MERGE.md` | **三方合并**（设计 × 实际的冲突裁决规则） | 做 sync / merge 之前 |
| `docs/PITFALLS.md` | 环境坑（Windows / node / 编码） | 遇到怪问题 |
| `docs/ARBITRATION.md` | 要用户拍的（不自己决定） | 遇到分歧 |
| `docs/todo.md` | 项目待办 | 想知道还差什么 |
| **`docs/DISCUSSION.md`** | **讨论记录**（想清楚了什么：快照 vs 事件 · 三方合并的对应 · 任务系统的死锁 · 畅想） | ★ **开发前先翻这里** |

★ **注意**：`docs/*` 被 `.gitignore` 忽略 ⇒ 新文档要 `git add -f` 或加白名单。

---

## 2 · 数据在哪里（★ 别找第二份）

```
.agent-io/design/<feature>.dsl.json    设计 DSL（唯一手写源，进 git）★ 含 todos[]（无节点任务）
.agent-io/live/<feature>.dsl.json      实际 DSL（扫描产物，不进 git）
.agent-io/baseline/<feature>.dsl.json  三方合并的 base（fork 时写入，★ 永不移动）
.agent-io/cache.db                     符号/调用事实（不进 git）★ 48MB
certs/design-db/*.calls.json           设计 DB（全量，与实际 DB 同构）★ 331 份
certs/design-contracts/*.contract.ts   设计 DB 的 TS 符号
certs/design-contracts/*.calls.json    设计 DB 的调用（7531 条）
```

★ 当前 feature = **`task-system-plan`**（331 文件节点 · 38 decision · 518 判据 · 27 张卡）

---

## 3 · 六步业务链的现状（★ 今天验收过）

```
① 源码 → 实际 DB      ✅ import_project（475 文件 / 8,798 符号 / 7,182 调用边）
② 实际 DB → 实际 DSL  ✅ renderLiveFromDb（631 节点 / 1,128 边）
③ 实际 DSL → 设计 DSL  ✅ fork（一次性）+ ★ sync.mjs（双向：补 + 清）
④ 在设计 DSL 上写意图  ✅ edit_dsl / design_intent（38 decision / 518 判据）
⑤ 设计 DSL → 设计 DB  ✅ gen-design-db（331 份全量 + 9 条 requirements 要求）
⑥ 设计 DB → 源码      ✅ **闭环**（2026-10-19 18:15 消融自证过）：`rewrite.mjs --apply`
                      → buildRefactorPlan（语法门 + plan_id）→ applyRefactorPlan（幂等）
                      ★ 证明：注入 1 条签名差异 ⇒ differ=1 ⇒ 落盘 applied=1 ⇒ 复核 0 ⇒ 重放零写入
```

**验收脚本（一条命令看全貌）**
```bash
node scripts/design-line.mjs      # 6 步读数
node scripts/design-diff.mjs      # 节点级 diff（+/-/~）
node scripts/design-diff.mjs --signature   # 符号级 diff（⑥ 的判据）
node scripts/merge.mjs            # 三方合并（base/ours/theirs）
node scripts/rewrite.mjs          # ⑥ 设计 DB vs 源码（三种结论）；--apply 才真落盘
node scripts/rewrite.mjs --apply  # ★ ⑥ 执行器（幂等；落盘后自动复核）
node scripts/sync.mjs             # ③ 双向（--apply 才写）
```

---

## 4 · ★★★ 数据可信度表（今天一条条验出来的，**必读**）

| 数据 | 可信吗 | 说明 |
|---|---|---|
| `files` / `nodes`（文件、符号） | ✅ | 扫描产物，准确 |
| `imports`（导入） | ✅ | 相对导入；**包导入 v1 不建边**（已知边界） |
| `type_ref` 边 | ✅ | `resolveCrossFileCalls` 专门补它 |
| **`call` 边** | ⚠️ **只含同文件** | 跨文件调用在 `unresolved_refs`（23,345 条是 `obj.method()`，需类型推断）；`failed` 1,555 条是第三方 |
| **`imports.bindings`** | ✅ **v9 新增** | 2,044/2,373 落库；`readdirSync → node:fs` 能查了 |
| **`design/` 的 `semantic.files`** | ❌ **fork 快照，永不更新** | **任何拿它当"设计当前状态"的比较都会产生假象** |
| `geometry.nodes`（design/live） | ✅ | 节点存在性可靠 ⇒ **diff 只该用这一层** |
| **`nodes.signature`（cache.db）** | ❌ | 被格式化成 `name()`（`CardStanding()`），丢了参数 |
| **`ParsedSymbol.signature`（现场解析）** | ✅ | **完整签名**（`cardStanding(card: TaskSpec, opts: StandingInput): Promise<…>`） |
| **`design-db` 的 `signature`** | ✅ | 也是完整的（从 `parseFileFull` 来的） |
| `type`/`interface` 的成员列表 | ❌ **两侧都没有** | 1,180 条"内容不可比"（= interface 992 + type 178 + class 10，由 `rewrite.mjs` 派生；只能报 `uncompared`） |
| **`sourceOnly`（源码有·设计没有）** | ✅ **已归零** | 原先报 94 条是**假的**：82 条 `method`（设计 DB 只收**顶层**，从不收方法）+ 12 条**函数体内的局部 interface**（`parent≠null`）⇒ 判据已按「口径内 kind + 顶层」过滤 |
| **`symbol-diff.mjs` 的 `sourceOnly` 口径** | ✅ | 判据只在 `scripts/lib/symbol-diff.mjs` 一处；`design-diff --signature` 与 `rewrite` 读数**逐字相同**（已对过） |

**⇒ 判据铁律：先问"这个字段是谁写的、会不会失真"，再拿它当判据。**

---

## 5 · 架构（分层，改之前先看 `docs/DESIGN.md`）

```
src/domain/            纯领域（DSL 类型 / validator / task_machine / overlay）
src/infrastructure/    适配层
  ├─ parse/            ★ 解析内核（tree-sitter + LANG_ADAPTERS 12 个语言适配器）
  ├─ index/            ★ cache.db 写入（symbols.ts / live_render.ts / index_freshness.ts / watch_project.ts）
  ├─ graph/            import_project（全量扫描）
  └─ analysis/         影响面 / 诊断 / 死代码 / 结构
src/application/
  ├─ design/           ★ 设计线
  │   ├─ dsl_ops/      11 文件 · 4,257 行（设计 DSL 的唯一写入口）
  │   ├─ intent/       4 文件 · 2,088 行（判据：expectations / consistency / detect_drift）
  │   ├─ lifecycle/    2 文件 · 573 行（snapshot / simulation）
  │   ├─ workbench/    2 文件（dag_layout 布局 / code_workbench 代码审批）
  │   └─ derive/       4 文件 · 2,885 行（推导，被 explore_code 用）
  ├─ meta/             ★ 工具面（explore / diagnosis / integrity / upgrade / registry）
  └─ refactor/         重构线（edit_code / rename / move / pipeline / refactor_plan / diff_views）
src/presentation/      MCP server（server_registry）/ HTTP（serve）/ CLI
```

★ **设计线当前 7 个 MCP 工具**：`get_dsl` · `edit_dsl` · `render_design` · `consistency_check` · `detect_drift` · `import_project` · `design_intent`

---

## 6 · 四道门（每次改完必跑，全绿才算完）

```bash
npx tsc --noEmit -p tsconfig.contract.json    # ① contract: 0 错
node scripts/contract-calls.mjs               # ② calls: 9/9 成立
npm run design:check                          # ③ design:check: 10/10 通过
npm run design:mutate                         # ④ mutate: 613 杀死 / 0 存活
```

★ **门的命令名必须和 `package.json` 对齐**：仓库里**没有** `mutate` 这个 script，
第四道门的真名是 **`design:mutate`**（`node scripts/mutate.mjs`）。
交接文档早先写成 `npm run mutate` ⇒ **跑起来是 `Missing script`，会静默地什么都没跑**。
⇒ 纪律：**写完门命令，先跑一次看退出码**，别凭记忆抄。

**当前状态：`contract 0` · `calls 9/9` · `design:check 10/10` · `mutate 613/0`**（全绿）

---

## 7 · ★★★ 今天踩过的坑（**别重犯**）

1. **`sed` 按行号切 TS 代码 = 必坏**（今天切坏 `meta/index.ts` 两次：括号不平衡，`tsc` 只报最后一行）
   ⇒ **用 `edit_code`**（`op='delete'/'replace'`，按 AST 符号边界 + re-parse 语法门）
2. **`cache.db` 的"零调用入边" ≠ 死代码**（今天按它删 84 个"死函数" ⇒ `build` 报 103 错，删了活函数）
   ⇒ **判死代码只能用编译器**：删一批 → `build` → 报错就恢复
3. **`design/` 的 `semantic.files` 是旧快照** ⇒ 拿它比 `live/` 必然全"不一致"（26+24 假象）
   ⇒ **diff 只比 `geometry.nodes` 的存在性 + 符号级 `signature`**
4. **`type`/`interface` 的 `signature` 两侧都是 `Name()`** ⇒ 1,170 条"假一致"
   ⇒ **不可比的要显式报 `uncompared`**（把它算进"一致"是最坏的谎）
5. **`deleteNode` 会被自洽闸拒**（`dangling_edge` / `anchor_broken`）
   ⇒ **三件套顺序：删边 → 删 `semantic.files` → 删节点**（`sync.mjs --apply` 已实现）
6. **`theirs` / `ours` 的配对键不能用 `name`**（`server.ts` 里两处 `const resources`）⇒ 用 `(name, line 最近)`
7. **`imports` 表原先不存 `bindings`** ⇒ `readdirSync` 无法知道来自 `node:fs` ⇒ 2,728 条误判 `failed`
   ⇒ **v9 已修**（`SCHEMA_VERSION = 9`，清库重建）
8. **报告用 apply 前的读数 = 会撒谎**（2026-10-19 实测：`--apply` 屏幕报"0 条签名差异"，
   而源码确实被改写了 ⇒ 数和做的不是一回事，**最难查的一种错**）
   ⇒ **正确做法：落盘后【重算】一次**（`rewrite.mjs` 已改成
   `复核（落盘后重算）：签名不同 0 ← 落盘前 1`，并且复核不为 0 就 `exit 1`）
   ⇒ ★ 通则：**任何"执行了某个动作"的报告，数字必须取自动作【之后】的重新测量**
9. **`sourceOnly` 会数出"假漏"**（2026-10-19 实测：报 94 条"源码有·设计没有"，逐条查**全是口径差**）
   ⇒ 82 条 `method`（设计 DB 只收顶层符号，从来不收方法）
   ⇒ 12 条**函数体内的局部 interface**（`live_render.ts` 的 `DirNode`，其 `parent = renderLiveFromDb`）
   ⇒ **修完归零**。正确判据 = `kind ∈ DESIGN_DB_KINDS` **且** `parent == null`
   ⇒ ★ 通则：**报"少了什么"之前，先问"这个 kind 本来该被收吗、这个符号是不是顶层的"** ——
     否则你报的是"两侧口径不同"，读者会当成"设计漏了 94 个符号"

---

## 8 · ⚠️ 范围纪律（用户明确划过）

```
✅ 只动 src/application/design/（设计线）里"确认是旁路"的
❌ 不碰 src/application/meta/（工具面：explore / upgrade / capability_map / sync_contracts）
❌ 不碰 src/infrastructure/analysis/（重构/诊断的核心）
⇒ ★ 用户原话："我让你删的是设计线的东西，你跑去删别的东西干嘛"
```

---

## 9 · 下一步（⑥ 已闭环；剩下的是"让它有活干"）

### 9.1 ⑥ 怎么跑
```bash
node scripts/rewrite.mjs                 # 零写入：三种结论（可重写 / 不可生成 / 设计漏了）
node scripts/rewrite.mjs --apply         # ★ 真落盘（幂等 + 落盘后复核）
node scripts/rewrite.mjs --prefix=src/infrastructure/   # 限定范围
node scripts/rewrite.mjs --json          # 结构化（胶水 / CI 用）
```

**判据只有一处**：`scripts/lib/symbol-diff.mjs`。
`design-diff.mjs --signature`（打印）与 `rewrite.mjs`（执行）都消费它 ——
此前是两份实现（`rewrite` 按 `name` 配对 = 坑 #6），**已合并**。

### 9.2 当前读数（2026-10-19 18:20 实测，两入口逐字相同）

| 项 | 数 |
|---|---|
| 签名相同 | 2,378 |
| **签名不同（= ⑥ 的输入）** | **0** |
| 不可比 | 1,964（interface 992 / const 690 / type 178 / method 82 / 局部 interface 12 / class 10） |
| 设计有·源码没有 | 0 |
| 源码有·设计没有 | 0 |

★ **"0 条"不等于"⑥ 没工作"** —— 见 9.3 的消融自证。它只说明**设计 DB 与源码此刻完全对齐**。

### 9.3 ⑥ 的消融自证（可复跑，约 1 分钟）
```bash
# ① 注入一条【设计侧】签名差异（只改 certs/design-db，不动源码）
#    例：application-design-api_signature.calls.json 里 extractFuncName 的
#        "sig: string" → "sig : string"
# ② node scripts/rewrite.mjs --apply
#    期望：签名不同 1 → plan_id 99001e87ea978d2c → applied 1 · written=true → 复核 0
# ③ 再跑一次 --apply
#    期望：清单为空 · 源码 md5 不变（幂等）
# ④ git checkout 还原两个文件
```

### 9.4 其余待办（按优先级）
1. **跨文件 `call` 边**（23,345 条 `obj.method()`）⇒ 要接 `tsc` 的 **LanguageService**（不是手写，是接现成的）
2. **`type`/`interface`/`class` 的成员列表**（1,180 条不可比）⇒ 给 `parseFileFull` 加 `members`
3. **`const` 的 `signature` 不再截断**（实际侧 60 字符 ⇒ 690 条不可比）
4. `coverage` 漏 2（`assertDecisionFieldShapes` / `applyTodoOp` —— 内部函数，可标"已知豁免"）
5. 18 个 `candidate` 预决策还没立案（在 `todos[]` 里）

---

## 10 · 工具与命令速查

```bash
# 构建 / 测试
npm run build                        # tsc（含 dist/）
npm run design:check                 # 判据（10/10）
npm run mutate                       # 变异测试（613/0）

# 设计 DSL 唯一写入口
#   edit_dsl（MCP 工具）→ updateFeature()：node / edge / api / file / decision / task / binding
#   ★ decision 的已知键（18 个）：summary / rationale / consequences / acceptance / thread / tags /
#     votes / evidence_source / note / status / author / alternatives / dissent / expectations / scope…
#   ★ expectation 必填：kind / symbol / path / why（为什么 —— 说不理由的验收项将来没人敢删）

# 数据管线
node scripts/gen-design-db.mjs       # 设计 DSL → 设计 DB
node scripts/design-line.mjs         # 6 步读数
node scripts/merge.mjs               # 三方（base/ours/theirs）
node scripts/design-diff.mjs [--signature] [--detail]
node scripts/rewrite.mjs [--apply] [--prefix=src/]   # ⑥ 三种结论；--apply 才落盘
node scripts/sync.mjs [--apply]      # ③ 双向
```

---

## 11 · 我这一窗口的关键判断（给下一个窗口的"先验"）

1. **`design/` 的 `decision` 是唯一手写意图源**，`semantic.files` 只是 fork 快照 ⇒ **判据一律只看 `decision` + `geometry.nodes`**
2. **`⑥` 不是"代码生成"**，是"**结构重写**"：设计 DB 没有函数体，能改的只有签名
3. **重写工具链已现成**（`buildRefactorPlan` 幂等 + 篡改检出 + 语法门），**不要新造**
4. **`imports.bindings`（v9）是所有"符号级引用分析"的地基** —— 它之前根本不存在
5. **判据的可信度必须显式分级**（可信 / 有边界 / 失真），**不可信的判据比没有判据更坏**
