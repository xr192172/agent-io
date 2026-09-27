# 架构重构规划书（活文档）

> 本文件是**持续更新**的规划与进度台账。每完成一步就在 §7 追加一行，并把对应阶段的"状态"改掉。
> 起编：2026-09-28　｜　依据：当轮实测（读数见 §2，命令可复现）

---

## 1. 目标与不变量（任何阶段都不许破）

| # | 不变量 | 判据 |
|---|---|---|
| I1 | **对外契约不变**：`mcp__design-canvas__*` 工具名与 inputSchema 不变 | 工具集快照测试（§5-G1） |
| I2 | **运行时依赖不增加**（现 8 个：MCP SDK / ajv / ajv-formats / ignore / tree-sitter×3 / zod） | `package.json` diff |
| I3 | **全量回归全绿**（当前基线：205 文件 / 2137 测试） | `vitest run` |
| I4 | **每步可独立提交**：不搞大爆炸分支；一步一提交，绿了再下一步 | `git log` 可逐条回滚 |
| I5 | **不引 DI / 全栈框架** | 见 §6 |

> I3 是"能安全动 10.9 万行"的唯一理由 —— 237 个测试文件不是包袱，是这次重构的许可。

---

## 2. 病根（实测，不是推测）

> **同一意图有多份实现，而修正只在原地落地、不横向传播。**

**微观（三份复制的相对 import 解析器）**：

| 位置 | 状态 |
|---|---|
| `src/db/symbols.ts:143 resolveImportTarget` | 早已修对（注释逐字"再 strip 扩展名重试"）；**且早已只算 relative 边、且 `import type` 不建边** |
| `src/health/index.ts:475 resolveImportFile` | 漏剥 `.js` ⇒ 解析恒 null（已修，本轮） |
| `src/impact/index.ts:104→149` | 漏剥 `.js` ⇒ **产品漏报跨文件引用**（已修，本轮） |

**量具双向失真（同一输入、同一份 src 的两态对比）**：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `orphan_file` | 284（92% 假阳） | 18 |
| `layer_violation` | 0（空转） | 12 |
| 健康分 | 0 (D) | 0 (D) ← **饱和，无动态范围** |

**宏观形态**：`src/tools/` 200 文件 / 71,088 行 = 全仓 65%（MCP 工具 + 17 个 CLI 壳 + 核心库 + HTTP 服务混住）；
`server_registry.ts` 3,586 行（`TOOL_DEFS` 数组 2,581 行，圈复杂度 337）；`renderer/` 12,173 行字符串 JS/CSS。

**推论**：病根不是"分层不漂亮"，而是**没有单一落点** ⇒ 所以本次重构的每一阶段，验收都要落在
"**这件事从此只有一份实现**"，而不只是"文件搬了位置"。

---

## 3. 脉络（六阶段，顺序即优先级）

| 阶段 | 内容 | 验收判据 | 风险 |
|---|---|---|---|
| **P0 修量具** | ①解析器统一成一份 ②可达根注入（`package.json` 按路径调的入口 + registry 派发表）③`import type` 不计分层违规 ④健康分去饱和 ⑤分层规则重划 | 体检在"已知好/已知坏"双夹具上给出**不同**读数；层违规非空且每条可解释 | 低（只动分析器） |
| **P1 拆注册表** | `server_registry.ts` 3,586 行 → `registry/lanes/*.ts`，按既有 `LANE_IDS` 一 lane 一文件；`registerAllTools` 汇总；`capability_map` 从 lane 文件聚合 | **工具集快照逐字相同**；`readme_tools_gate` 仍 67=67；回归全绿 | 低（零行为变化） |
| **P2 拆抽屉** | `tools/` 200 文件按职责分层：`*_cli.ts`(17)→`surfaces/cli`、HTTP(`serve.ts` 等)→`surfaces/http`、库(`ts_kernel`/`ast_parser`/`project_root`/`db`)→`kernel`、工具定义→`features/<lane>/` | 每族搬完：回归全绿 + 无新增层违规（用 P0 修好的量具看） | **中高**（71k 行，必须一族一提交） |
| **P3 抽字符串** | `renderer/scripts.ts` 6,209 + `styles.ts` 3,526 → 真资源文件，**复用既有 `gen_*_bundle.mjs` 机制** | playwright 渲染快照逐块对比无差异 | 中（先建快照基线） |
| **P4 工具收敛** | **按仓内既有 `docs/tool-convergence.md` 走**（5 步核验纪律 + 已落地的 `gateway_provider`/`canvas_notes`/`manage_feature` 样板） | 该文档自身的验收口径 | 中（动对外契约，需你拍板） |
| **P5 防复发门** | `check-single-source.mjs`：同族实现不得有第二份；工具表/内核路径不得手工双写 | 门自身可红（注入一份副本即报错） | 低 |

**为什么 P1 在 P2 前**：P1 产出 lane 划分，正是 P2 的目标目录结构；且 P1 提供"工具集快照门"，
使 P2 搬迁 71k 行时有一个**与文件位置无关**的验收判据。

---

## 4. 目标分层（P0 重划的分层规则，P2 的落地形态）

| 层 | 职责 | 允许依赖 | 现对应 |
|---|---|---|---|
| `surfaces/` | mcp · cli · http —— **只做转发与外壳** | 向下全部 | `tools/*_cli.ts`(17)、`tools/serve.ts`、`server_registry.ts` |
| `features/` | 用例：一个工具一个文件，导出 `ToolDef` | kernel, dsl | 现 `tools/` 里的工具定义 |
| `kernel/` | 符号 · 解析 · 索引（无 fs 副作用优先） | dsl | `tools/ts_kernel/`、`ast_parser`、`project_root`、`db/`、`impact/`、`health/` |
| `dsl/` | 契约与数据模型（**自洽，不 import 实现**） | — | 现 `dsl/`（但已有 8 条越界，见 §7-P0） |

**规则**：依赖只允许向下；同层内不得横向堆叠成新抽屉。

> ⚠️ 现规则的教训：旧 `contract/brick/glue` 三级**把 283/308 个文件判进默认层** ⇒ 结构性不可能变红。
> 新规则必须保证**每一层都装得下东西、且能装错**。

---

## 5. 判据清单（能自动化的门）

| 编号 | 门 | 判据 | 状态 |
|---|---|---|---|
| G1 | 工具集快照 | `registerAllTools` 导出的 (name, schema) 列表与基线逐字相同 | 待建（P1 前置） |
| G2 | README 工具数 | 既有 `scripts/readme_tools_gate.mjs` ⇒ 67=67 | ✅ 已在跑 |
| G3 | 分层方向 | 依赖只允许向下；`import type` 不计 | 待建（P0） |
| G4 | 单一实现 | 同族实现（解析器/工具表/内核路径）不得有第二份 | 待建（P5） |
| G5 | 量具有效性 | 同一量具在"已知好"与"已知坏"夹具上给出**不同**读数 | 待建（P0，**防饱和**） |
| G6 | 回归 | 205 文件 / 2137 测试全绿 | ✅ 已在跑 |

> G5 是这次最贵的教训：**一个在两种状态下读数相同的指标，不是判据，是常量。**

---

## 6. 明确不做的事（non-goals）

1. **不引 DI / 全栈框架**（NestJS / Inversify 等）—— 8 个运行时依赖、stdio 单进程、无 Web 边界，引它是纯负债。
2. **不引 ORM / 换数据库** —— 现 `node:sqlite` + 自管 schema，够用。
3. **不重写 renderer 为 React/Vue** —— P3 只做"把字符串变成真资源文件"，形态不变。
4. **不一次性重命名 `tools/` 下 200 个文件** —— 会炸掉 import 图与所有测试的相对路径，按 P2 一族一族来。
5. **不改 `mcp__design-canvas__*` 的工具名**（P4 除外，且 P4 需单独拍板）。

**唯一新增的第三方工具**：`dependency-cruiser`（或按现门风格自写 `check-layering.mjs`）—— 二选一，倾向**自写**，与仓内既有门风格一致且零依赖。

---

## 7. 进度日志（活文档区 —— 随做随改）

### 已完成（本轮，2026-09-28）

- **commit `865a388`**　`fix(health,impact)`: 相对 import 解析补剥 JS 家族后缀
  - 实测两态：`orphan_file` 284→18、`layer_violation` 0→12
  - 新增回归门 `tests/fixtures/codehealth-esm-fixture/`（旧夹具用无后缀 import，从未复现生产写法 ⇒ 缺陷在 237 测试下长期存活）
  - 验证：全量回归 205 文件 / 2137 测试全过；`dist` 已重建（`dist/` gitignored）
- **P0-① 完成：解析器统一成一份**（本文件写作同轮落地）
  - 新模块 `src/tools/ts_kernel/import_resolve.ts` —— **唯一实现**，导出
    `IMPORT_EXTS` / `INDEX_FILES` / `importPathCandidates()` / `resolveImportPath()`，
    并从 `tools/ts_kernel/index.ts` 公开入口再导出
  - 三处调用点改为委托，**各保留自己的策略**：
    | 调用点 | 保留的策略 | 谓词 |
    |---|---|---|
    | `health/index.ts` | `!source.startsWith('.')` 早退（包导入不建边） | `rels.has(c)`（内存集合） |
    | `impact/index.ts` | 同上 + 包路径回退 `resolvePackageImportDir` | `rels.has(c)`（内存集合） |
    | `db/symbols.ts` | **不判相对性**（调用点已用 `imp.kind !== 'relative'` 过滤） | `fs.existsSync(projectRoot/c)` |
  - ★ 设计决定：**相对性判断与包导入回退不下沉到公共模块**。理由：`db.resolveImportTarget`
    还被 `tools/rename_file.ts:295,303` 当"路径字面量 → 项目内文件"的通用工具复用，
    在公共层加门会**静默改变 rename_file 行为**。
  - 顺带清掉 `db/symbols.ts` 的重复常量（`IMPORT_EXTS` / `INDEX_FILES`）与 `health` 因改动而
    变为未使用的 `node:path` 导入
  - 新增契约测试 `tests/tools/import_resolve.test.ts`（11 项）：锁**候选顺序**（顺序变 = 解析结果静默变）
  - ★ 测试写错反而挖出一条**兼容性怪癖并已钉住**：`join(dirname, '../../z')` 会先经
    `normalize` 被**折叠回根**（成为 `z`），故旧守卫 `startsWith('..')` 不触发、照样按项目根解析。
    三份旧实现都是此行为 ⇒ 保留，不"顺手修正"，否则 `resolveImportTarget` 的既有调用方会漂移。
  - 验证：`tsc --noEmit` 干净；全量回归 **205 文件 / 2137 测试全过**；
    新增测试 11 项过；调用方测试 26 项过；产物已重建
  - 单一实现核查（`grep INDEX_FILES|bare + e`）：除新模块外只剩注释引用与入口再导出 ✅

- **P0 待办（下一步）**：
  - ②可达根注入：把 `package.json` 里按路径调的入口（`start`/`serve`/`daemon`/… 共 14 条）与
    registry 派发表作为**可达性根**喂给分析器 ⇒ 否则 `orphan_file` 仍会把入口文件报成孤儿
  - ③`import type` 不计分层违规 —— 与 `db/symbols.ts` 既有实现对齐（注释："运行时擦除"）
  - ④健康分去饱和（当前 `0 (D)` 在两态下读数相同 ⇒ 不承载判断）
  - ⑤分层规则重划（旧 `contract/brick/glue` 把 283/308 文件判进默认层）

### 未做 / 需要你决策

| # | 事项 | 为什么要你拍板 |
|---|---|---|
| 1 | **推送仍缺凭据**（`terminal prompts disabled`） | 需要凭据通道：`gh auth login` / PAT / 你本地推 |
| 2 | P4 是否真动工具名（`mcp__design-canvas__*` 会对 DSH 现有会话与桥接造成断裂） | 改对外契约 |
| 3 | `dsl/types.ts` 那 8 条"越界"是真实倒置还是 `import type` 误计 | 决定 P0-⑤ 的分层规则细节 |
| 4 | `orphan_file` 降到 18 后的真实死代码（如 `version_upgrade/` 整个子系统 ~1,941 行疑似全孤立） | 删除不可逆 |

### 风险台账

| 风险 | 表现 | 缓解 |
|---|---|---|
| P2 搬迁破坏相对 import | 200 文件全在一层，路径深度变化即断链 | 用仓内 `rename_files` 工具（联动全仓 import）+ 一族一提交 |
| 量具再度失真 | 修好的解析器又被复制一份 | G4 单一实现门 |
| 分阶段半途而废 | 出现"一半新一半旧" | 每阶段独立可回滚；不合并进行中的阶段 |

---

## 8. 复现命令（任何人可核）

```bash
cd /d/project_develop/design-canvas

# 量具现状（线上读数，走 dist）
node dist/src/tools/health_cli.js src --top 12

# 工具数门禁
node scripts/readme_tools_gate.mjs

# 全量回归（仓内约定：排除 archify）
./node_modules/.bin/vitest run --exclude 'tests/tools/archify_*.test.ts'

# 相对 import 写法统计（为何 .js 后缀是关键）
grep -rn "from '\.\{1,2\}/[^']*\.js'" src --include=*.ts | wc -l   # 961
grep -rn "from '\.\{1,2\}/[^']*'" src --include=*.ts | grep -v "\.js'" | wc -l  # 10
```
