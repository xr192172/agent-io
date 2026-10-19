# HANDOFF —— 交接给下一个窗口

> 生成：2026-10-19 18:00（本窗口 7:43 → 18:00，约 10.3 小时）
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
⑥ 设计 DB → 源码      ★ 入口打通（design-diff --signature）· 管道现成（buildRefactorPlan → applyRefactorPlan）
```

**验收脚本（一条命令看全貌）**
```bash
node scripts/design-line.mjs      # 6 步读数
node scripts/design-diff.mjs      # 节点级 diff（+/-/~）
node scripts/design-diff.mjs --signature   # 符号级 diff（⑥ 的判据）
node scripts/merge.mjs            # 三方合并（base/ours/theirs）
node scripts/rewrite.mjs          # 设计 DB vs 源码（斜差点）
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
| `type`/`interface` 的成员列表 | ❌ **两侧都没有** | 1,170 条"内容不可比"（只能报 `uncompared`） |

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
npm run mutate                                # ④ mutate: 613 通过 / 0 失败
```

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

---

## 8 · ⚠️ 范围纪律（用户明确划过）

```
✅ 只动 src/application/design/（设计线）里"确认是旁路"的
❌ 不碰 src/application/meta/（工具面：explore / upgrade / capability_map / sync_contracts）
❌ 不碰 src/infrastructure/analysis/（重构/诊断的核心）
⇒ ★ 用户原话："我让你删的是设计线的东西，你跑去删别的东西干嘛"
```

---

## 9 · 下一步（⑥ 只剩接三根线）

```bash
# ① 出清单（已有）
node scripts/design-diff.mjs --signature --write-plan
#    ⇒ .agent-io/refactor-plan.json（targets = [{file, old_text, new_text}]）
#    ★ 当前实测：2,378 个 function 签名【全部一致】⇒ 清单为空（正常）
#    ★ 1,870 条 type/interface/const/class 不可比（两侧都没有可比内容）

# ② 校验（现成，要写 10 行胶水）
buildRefactorPlan({ project_dir, targets })     # 语法门 + 幂等 + plan_id
# ③ 落盘（现成）
applyRefactorPlan(plan)
```

★ **写完 ②③ 的胶水（`rewrite.mjs --apply`），⑥ 就闭环了。**

### 其余待办（按优先级）
1. **跨文件 `call` 边**（23,345 条 `obj.method()`）⇒ 要接 `tsc` 的 **LanguageService**（不是手写，是接现成的）
2. **`type`/`interface` 的成员列表**（现在两侧都没有 ⇒ 1,170 条不可比）⇒ 给 `parseFileFull` 加 `members`
3. **`const` 的 `signature` 不再截断**（实际侧 60 字符）
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
node scripts/rewrite.mjs --prefix=src/
node scripts/sync.mjs [--apply]      # ③ 双向
```

---

## 11 · 我这一窗口的关键判断（给下一个窗口的"先验"）

1. **`design/` 的 `decision` 是唯一手写意图源**，`semantic.files` 只是 fork 快照 ⇒ **判据一律只看 `decision` + `geometry.nodes`**
2. **`⑥` 不是"代码生成"**，是"**结构重写**"：设计 DB 没有函数体，能改的只有签名
3. **重写工具链已现成**（`buildRefactorPlan` 幂等 + 篡改检出 + 语法门），**不要新造**
4. **`imports.bindings`（v9）是所有"符号级引用分析"的地基** —— 它之前根本不存在
5. **判据的可信度必须显式分级**（可信 / 有边界 / 失真），**不可信的判据比没有判据更坏**
