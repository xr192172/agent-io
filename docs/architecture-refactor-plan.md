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
| **P1 拆注册表** | `server_registry.ts` 3,586 行 → `registry/lanes/*.ts`，按既有 `LANE_IDS` 一 lane 一文件；`registerAllTools` 汇总；`capability_map` 从 lane 文件聚合 | **工具集快照逐字相同**（G1 ✅ 已就位）；`readme_tools_gate` 仍 67=67；回归全绿 | 低（零行为变化） |
| **P2 拆抽屉** | `tools/` 200 文件按职责分层：`*_cli.ts`(17)→`surfaces/cli`、HTTP(`serve.ts` 等)→`surfaces/http`、库(`ts_kernel`/`ast_parser`/`project_root`/`db`)→`kernel`、工具定义→`features/<lane>/` | 每族搬完：回归全绿 + 无新增层违规（用 P0 修好的量具看） | **中高**（71k 行，必须一族一提交） |
| **P3 抽字符串** | `renderer/scripts.ts` 6,209 + `styles.ts` 3,526 → 真资源文件，**复用既有 `gen_*_bundle.mjs` 机制** | playwright 渲染快照逐块对比无差异 | 中（先建快照基线） |
| **P4 工具收敛** | **按仓内既有 `docs/tool-convergence.md` 走**（5 步核验纪律 + 已落地的 `gateway_provider`/`canvas_notes`/`manage_feature` 样板） | 该文档自身的验收口径 | 中（动对外契约，需你拍板） |
| **P5 防复发门** | `check-single-source.mjs`：同族实现不得有第二份；工具表/内核路径不得手工双写 | 门自身可红（注入一份副本即报错） | 低 |

**为什么 P1 在 P2 前**：P1 产出 lane 划分，正是 P2 的目标目录结构；且 P1 提供"工具集快照门"，
使 P2 搬迁 71k 行时有一个**与文件位置无关**的验收判据。

### P1 的执行顺序（实测摸清后写下，避免"直接按 lane 切线"踩空）

`server_registry.ts` 的 3,586 行**不是**"一堆可以按 lane 切开的工具定义"。实测结构：

| 区段 | 行 | 内容 | 归属 |
|---|---|---|---|
| 基础设施 | 150–442 | STALE BUILD / STALE SOURCE / 陈旧索引 / 首次接触 / 可信度附注 | 留在 `server_registry.ts` |
| `ToolDef` 类型 | 446–468 | 接口 | → `registry/types.ts` |
| 包装器 | 470–507 | `textOut` / `wrap` / `wrapData` | → `registry/plumbing.ts` |
| **共享 handler** | 509–943 | **20 个 `const *Handler = wrap(...)`，约 430 行**，被跨 lane 复用 | → `registry/handlers.ts` |
| `TOOL_DEFS` | 947–3527 | 67 条，其中 **45 条是内联闭包**（`handler: wrapData(async (a) => …)`） | → `registry/lanes/<lane>.ts` |
| 注册 | 3522–3560 | `looseInputSchema` / `registerAllTools` | `looseInputSchema` → plumbing；`registerAllTools` 留下 |

★ **所以不能直接切 lane**：lane 文件要用到那 20 个共享 handler 与三个包装器，而它们此刻都定义在
`server_registry.ts` 里 ⇒ lane 文件 `import` 它就会**循环**（`server_registry` → lane → `server_registry`）。

⇒ 正确顺序（每步一提交、每步过 G1 + 回归）：
1. **P1a**：抽 `registry/types.ts` + `registry/plumbing.ts` + `registry/handlers.ts`，`server_registry.ts` 改为引用。
2. **P1b**：按 `LANE_OF` 切出 `registry/lanes/{design,refactor,observe,harvest,cross,meta}.ts`；
   `TOOL_DEFS = [...design, ...refactor, …]`；`server_registry.ts` 重新导出 `TOOL_DEFS`（对外 API 不变）。
3. **P1c**（可选，`capability_map` 的"第二份表"）：lane 归属此时已由**文件路径**表达，
   `capability_map.ts` 的 `LANE_OF.lane` 可改为**派生**（保留 `when` 这类策展覆盖）。
   加一条门：`lane 文件里的工具 ↔ LANE_OF 归属` 必须一致，防两处漂移。

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
| G1 | 工具集快照 | `registerAllTools` 导出的 (name, schema) 列表与基线逐字相同 | ✅ 已在跑（P1 前置，`tests/server_registry.tool_snapshot.test.ts`，基线 `tests/fixtures/tool_set_snapshot.json`，67 工具） |
| G2 | README 工具数 | 既有 `scripts/readme_tools_gate.mjs` ⇒ 67=67 | ✅ 已在跑 |
| G3 | 分层方向 | 依赖只允许向下；`import type` 不计 | 待建（P0；③ 已在 `health` 落地，门未建） |
| G4 | 单一实现 | 同族实现（解析器/工具表/内核路径）不得有第二份 | ✅ 已在跑（棘轮：存量不拦、**新增即红**，`tests/single_source.test.ts` + 登记表 `tests/fixtures/single_source_registry.json`） |
| G5 | 量具有效性 | 同一量具在"已知好"与"已知坏"夹具上给出**不同**读数 | ✅ 已在跑（P0，`tests/health/health-validity.test.ts`，含**反饱和**与**空输入**断言） |
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

- **commit `579d7ad`**　`refactor(kernel)`: P0-① 相对 import 解析统一成一份
  - `src/tools/ts_kernel/import_resolve.ts` 成为唯一实现（`importPathCandidates` / `resolveImportPath`）
  - 三处调用点（db/health/impact）改为委托，**策略留在原地不下沉**（`db.resolveImportTarget`
    还被 `tools/rename_file.ts:295,303` 当通用工具复用，下沉相对性门会静默改其行为）
  - `tests/tools/import_resolve.test.ts`（11 项）锁**候选顺序**；顺带钉住一条兼容性怪癖
  - 验证：tsc 干净；205 文件 / 2137 测试全过（此后基线 206 文件 / 2148 测试）

- **P0-②③④⑤ + G5**（本轮续做，见下条提交）
  - **② 可达根注入**：新增 `detectReachableRoots()`（`src/tools/project_root.ts`），从 `package.json`
    的 `bin` / `main` / `scripts.*` 中 `node <路径>` 形式探测入口，**落盘确认后**返回项目内相对路径；
    `HealthOptions.reachableRoots` 由**调用方显式喂入**（分析器保持纯函数）。
    ⇒ 入口按胶水层算 + 不计孤儿。实测消掉 **2 条假阳**：`daemon/daemon.ts`（`npm run daemon`）、
    `tools/serve.ts`（`npm run serve`）。孤儿 18 → **16**。
  - **③ `import type` 不计分层违规**：对齐 `db/symbols.ts` 既有知识（"运行时擦除——不建 import 边"）。
    ★ 只跳过**违规判定**，**不**跳过 `reverseConsumers` —— 架构违规问运行时依赖方向，
      而 type-only 仍是真实编译期消费者；算成"无人消费"会让 orphan/unused_export 假阳。
    ⇒ 消掉 **9 条**假阳（`dsl/types.ts` 8 条统一再导出 + `adapters/types.ts` 1 条）。
  - **③′ 连带修根因（比 ③ 更根本）**：type-only 判定原先有**两份逐字相同**的实现
    （`ts_kernel/kernel.ts` 与 `rename_symbol.ts:178`），都只写了 `/^\s*import\s+type\b/`
    ⇒ **同一个盲区在两处各存活一次**：`export type { A } from './x'` 同样被运行时擦除却谁都不认
    （`dsl/types.ts:47` 那条假违规就是它）。收敛为内核唯一实现
    `isTypeOnlyModuleStatement()`，两处共用 ⇒ 一改两处生效。
  - **④ 健康分去饱和**：`computeScore()` 改为**密度归一 + 单维封顶的连续映射**
    （`100 − Σ wᵢ·min(1, 密度ᵢ/fullAtᵢ)`，Σwᵢ=100）。实测旧公式两端都饱和：真仓被压成 **0(D)**、
    而**不存在的路径读到 100(A)**。改后真仓 **45(D)**，有动态范围。
    `HealthReport.grade` 增 `'N/A'`（0 个源文件 ⇒ 空输入是**第三种状态**，不是"健康"也不是"极坏"）；
    `health_cli` 对不存在的 root 直接 exit 2。
  - **⑤ 分层规则**：① 去**根依赖** —— `classifyLayer` 先补前导 `/`，修掉"`server.ts` 判 brick、
    `src/server.ts` 判 glue"的读数漂移（同一文件因调用 root 不同而分层不同）；
    ② 新增 `layers.unclassified` —— 积木层同时兼任"正面命中"与"兜底"两个角色，
    实测本仓 **281/281 全未命中** ⇒ 规则退化此前是**沉默**的，现在可读（同款设计见 `capability_map` 的"未归线"段）。
    ⚠️ 四层玩法（surfaces/features/kernel/dsl）**故意留到 P2**：现在换会让 P2 分批搬迁的中间态
    全部判违规，直接毁掉 P0 的验收口径"每条可解释"。
  - **G5 门**：`tests/health/health-validity.test.ts`（15 项）—— 方向 / **反饱和（坏 ≠ 0）** /
    **分辨率（同维更差 ⇒ 分必须更低）** / 单维封顶 / 空输入第三态 / 分层与 root 无关 / 可达根注入确实消假阳。
    新夹具：`codehealth-good-fixture`（已知好，零问题）、`codehealth-roots-fixture`（可达根）。
  - **实测两态（同一份 src）**：

    | 指标 | 改前 | 改后 |
    |---|---|---|
    | `layer_violation` | 12（9 条 type-only 假阳 + 1 条入口假阳） | **2**（两条均可解释，见下） |
    | `orphan_file` | 18（2 条是入口） | **16** |
    | 健康分 | 0 (D)（饱和，改好不动） | **45 (D)**（有动态范围） |
    | 不存在的路径 | 100 (A) | **N/A** + exit 2 |
    | 未分类（兜底层） | 不可见 | **281/281**（规则退化可见） |

  - **改后剩下的 2 条违规**（逐条可解释，且都指向后续阶段）：
    1. `tools/archify_pipeline.ts:14 → tools/archify_cli.ts` —— **库反向依赖自己的 CLI 壳**（真缺陷；R5 挂起线）。
    2. `tools/sync_contracts.ts:18 → server_registry.ts` —— 工具定义依赖注册表
       ⇒ **正是 P1 的目标**：`TOOL_DEFS` 应由 lane 文件聚合，工具不该 import 注册表。
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

- **P0 待办（①完成后曾列，②③④⑤ 已在下一轮完成，见上）**：
  ②可达根注入／③`import type` 不计分层违规／④健康分去饱和／⑤分层规则重划

- **G1 + G4（本轮续做，P1/P5 的门）**
  - **G1 工具集快照门**（`tests/server_registry.tool_snapshot.test.ts`，6 项）
    - 快照的是**注册时真正传给 SDK 的东西**：用假 server 捕获 `registerTool(name, config, cb)` 的入参，
      `config.inputSchema` 经 **zod v4 原生 `z.toJSONSchema()`** 转 JSON Schema ——
      即 MCP 客户端实际收到的契约（`looseInputSchema` 的包装也已含在内）。**不是重新推导一遍。**
    - 基线 `tests/fixtures/tool_set_snapshot.json`（67 工具 / 150KB）。
      更新方式：`UPDATE_TOOL_SNAPSHOT=1 vitest run tests/server_registry.tool_snapshot.test.ts`。
    - ★ **顺序不是契约**（有意放宽 + 写明理由）：按 name 排序后比较。
      lane 拆分必然改变 `TOOL_DEFS` 数组顺序，而 MCP 工具按名寻址；把顺序当契约会让 P1 变成不可做。
      名字 / 标题 / 描述 / schema 任一变化仍会红。
    - 含**检测器自证**用例（差异检测器本身必须能检出 title/description/schema/增删）。
  - **G4 单一实现门**（`tests/single_source.test.ts`，9 项 + 登记表）
    - ★ 设计成**棘轮**（与仓内 `check_rules` 同款纪律）：**存量不拦、新增即红**。
      不要求先修完 —— 但债务不许增长。收敛进度可以一步步来（本仓 09-28 就是这么走的）。
    - 声明式登记（`tests/fixtures/single_source_registry.json`），**不假装能自动发现重复**：
      自动发现"意图重复"不可判定；可判定的部分（已知家族的副本数）恰好够拦住复发。
    - **只扫非注释行**：第一版按全文裸扫，立刻在自己的注释里命中
      （`rename_symbol.ts:179` 逐字引用了刚修掉的旧正则）—— 而注释里引用旧代码是好实践，不该被惩罚。
    - 已登记 3 家族 / **18 处存量债务**：`type-only-module-statement`（2 文件）、
      `import-candidate-index-list`（1）、`source-extension-static-list`（**15**，权威尚未建立）。
    - 出生证（已实测）：往 `src/` 注入一份副本 ⇒ 两个家族同时报红且指名权威文件；删掉即恢复绿。
  - ★★ **G4 一上线就抓出新东西**：type-only 知识实际有 **5 处**实现，`c694471` 只收敛了 2 处 ——
    - `src/health/index.ts:299`（AST 路径）与 `:460`（正则降级路径）—— **同一条规则的两条路径**，
      必须给同一结论，此前各写各的正则（`/^\s*import\s+type\b/` vs `/^import\s+type\b/`）。
      本轮**收成一份常量 `TYPE_ONLY_IMPORT_RE`**（行为不变，仅去重）——这是安全的机械去重 ✅
    - `src/tools/ts_slim.ts:376` —— **有意保留**：它是"重写 import 语句时保留 `type` 修饰符"，
      与内核那条（回答"依赖边要不要算"）是**不同问题**⇒ 不同判据。已写进注释与登记表 `intent`。
    - ⇒ 教训：**"重复的策略"≠"重复的实现"**。合并之前先问"两边回答的是同一个问题吗"。

- **还债（本笔）：第 4 份 specifier→文件 解析器并入唯一实现 + 修掉一个产品级缺陷**
  - 合并：`project_root.resolveToFile` 的候选循环删除，改走内核 `resolveExistingPath`；
    新增内核 API `completionCandidates(base, opts)` / `resolveExistingPath(base, exists, opts)` /
    `ResolvePathOptions.bareBaseFirst`（"已拼好的路径，原样命中排第一"）。
    **政策留在调用点**：多语言扩展名/索引清单仍写在 `project_root.ts`（`MULTILANG_EXTS` / `MULTILANG_INDEX`）。
  - 修 bug：旧 `resolveToFile` 的守卫 `if (!path.extname(p))` 使 `./x.js → x.ts` **永不尝试**。
  - ★ **量化影响（同一份 src，新旧实现对比）**：

    | 指标 | 值 |
    |---|---|
    | src 下相对 import 总数 | 967 |
    | 带 JS 家族后缀 | **966（99.9%）** |
    | 旧实现能解析到 | **1（0.1%）** |
    | 新实现能解析到 | **967（100%）** |
    | 本可解析却被漏掉 | **966** |

  - 影响面（不是死代码）：`resolveLangImport` 对**所有语言的相对 import** 统一走 `realResolveImport`；
    `expandClosure` / `expandClosureDetailed` 的**无索引回退**（文件不在 cache.db：跨根兄弟项目、
    watch 新文件、无索引）也走它 ⇒ 盲区使闭包**几乎不沿相对边扩**
    （`rename_symbol` / `find_references` / `symbol_move` 在那些场景下可能漏改）。
    有索引时的快路径走 cache.db 的 edges（那份是对的），所以缺陷只在回退路径上发作 —— 这也是它长期没被发现的原因。
  - 出生证（实测）：`realResolveImport('./a.js')` 旧实现 → `null`；新实现 → `a.ts`。
  - 回归门：`tests/tools/project_root.test.ts` 新增 2 条 —— NodeNext `.js` 引 `.ts`（含"真 js 文件原样命中优先"）、
    多语言补全未回归（`.go` / `__init__.py` / `mod.go`）。旧夹具只测**无后缀** import，
    **与 health 旧夹具犯的是同一个错：夹具不覆盖生产条件**。
  - G4 登记表未变（`project_root` 仍保留那份多语言索引清单 —— 那是**政策**，不是重复的**实现**）。
  - 验证：tsc 干净；回归 **210 文件 / 2210 测试全过**；G1 6 项 / G4 9 项过；量具读数不变（45 / 2 违规 / 16 孤儿）。

### ★ 本轮新发现的同族副本（病根仍在扩散，未清完）
P0-① 只统一了「相对 import 解析」这一族的 3 份。顺着同一把尺子扫全仓，**同族副本远不止 3 份**。
下表为实测（`grep` 可复现），**均未处理**，按价值排序：

| # | 位置 | 同的是什么意图 | 状态 |
|---|---|---|---|
| 1 | `tools/project_root.ts:203 resolveToFile` / `:225 realResolveImport` | specifier → 文件（补扩展名 + 目录索引 + **只认相对导入**） | ✅ **已收敛**（本笔）：候选生成改走内核 `resolveExistingPath`，顺带修掉 `.js` 盲区。**量化**：src 下 967 条相对 import，旧实现只解析到 **1 条（0.1%）**、新实现 **967 条（100%）**，**966 条本可解析却被漏掉**。⚠️ **更正上一轮的误判**：我当时写它"只被自己的测试引用、死代码候选"——**错了**。它在 `project_root.ts` 内部被大量使用：`resolveLangImport` 对**所有语言的相对 import** 统一走它，`expandClosure`/`expandClosureDetailed` 的**无索引回退**也走它 ⇒ 盲区意味着「无索引 / 跨根 / 新文件」场景下闭包**几乎不沿相对边扩**（`rename_symbol` / `find_references` / `symbol_move` 可能漏改）。 |
| 2 | `tools/refs_text.ts:41 specifierCandidates` + `:112/:151` | file → specifier 串（反向）+ 剥 JS 家族后缀 | 与第 1 族共享同一条"后缀知识" |
| 3 | `tools/cli_extract.ts:47` 与 `tools/registry_extract.ts:57` | 同一段 `import {a,b} from './x'` → 符号→模块映射 | **两份逐字相同**（正则、过滤、`.replace(/^\.\//,'').replace(/\.js$/,'')` 全同） |
| 4 | `tools/slim_brick.ts:618 TS_RESOLVE_EXTS` / `:726` | specifier → 文件 | 第 5 份候选表 |
| 5 | `tools/import_project.ts:346 RESOLVE_EXTS` | specifier → 文件 | 第 6 份候选表 |
| 6 | `ts_kernel/import_resolve.ts:25 IMPORT_EXTS` | "什么算源码扩展名" | 第 16 份**静态**清单；权威是内核动态的 `listSupportedExtensions()`（实测 `[.ts,.js,.mjs,.cjs,.go,.py,.java,.c,.h,.cs,.rs,.php]`，**不含 `.tsx`**），二者从未对齐 |

**"什么算源码扩展名"全仓共 15+ 份静态清单，口径互不一致**（实测）：
`project_root.ts:44`（含 `.vue/.mts/.cts`）／`rename_file.ts:29`（无 `.vue`）／`contract_gate.ts:73`（无 `.mts/.cts`）／
`package_migration.ts:35`（无 `.mts/.cts`）／`slim_brick.ts:618`（含 `.json`）／`refs_text.ts:55`（含 `.rs/.php`）／
`behavior/index.ts:41`（只有 JS 家族 6 个）／`deprecate_offline.ts:40`／`rule_apply.ts:108`／`rename_symbols.ts:284`（含 `.json/.md/.yml`）…
⇒ 建议做法与 P0-① 同：**能派生的不手写**，权威唯一（内核），其余按需传参。

### 未做 / 需要你决策

| # | 事项 | 为什么要你拍板 |
|---|---|---|
| 1 | **推送仍缺凭据**（`terminal prompts disabled`） | 需要凭据通道：`gh auth login` / PAT / 你本地推 |
| 2 | P4 是否真动工具名（`mcp__design-canvas__*` 会对 DSH 现有会话与桥接造成断裂） | 改对外契约 |
| 3 | ~~`dsl/types.ts` 那 8 条是真实倒置还是 `import type` 误计~~ | **已答**：9 条全是 type-only（8 条在 `dsl/types.ts` + 1 条在 `adapters/types.ts`）⇒ P0-③ 已消；剩余 2 条是真依赖 |
| 4 | `orphan_file` 降到 16 后的真实死代码（如 `version_upgrade/` 整个子系统 ~1,941 行疑似全孤立、`tools/get_dsl.ts` 等） | 删除不可逆 |
| 5 | **高复杂度阈值 10 是否标定得当**（实测 444 个函数超阈值，占健康分扣分的 25/56） | 若阈值过严 ⇒ 该维永远顶格，"复杂度"实际退化成常数项；若阈值合理 ⇒ 本仓确实有 444 处待拆 |
| 6 | 那 15+ 份静态扩展名清单要不要在 P2 一并收敛（见上表） | 动面广，属 P2 的活儿但影响 P0 量具口径 |

### 风险台账

| 风险 | 表现 | 缓解 |
|---|---|---|
| P2 搬迁破坏相对 import | 200 文件全在一层，路径深度变化即断链 | 用仓内 `rename_files` 工具（联动全仓 import）+ 一族一提交 |
| 量具再度失真 | 修好的解析器 / type-only 判定又被复制一份 | G4 单一实现门（**仍未建**；本轮已现场撞到第 2 例：`rename_symbol.ts:178` 逐字复制了 `kernel.ts` 的 type-only 正则） |
| 分阶段半途而废 | 出现"一半新一半旧" | 每阶段独立可回滚；不合并进行中的阶段 |
| **量具"看不见自己"** | 分层规则退化（281/281 未分类）此前是沉默的 | 已加 `layers.unclassified` 显式暴露；G5 门守住空输入/饱和 |

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

# ── P0-②③④⑤ 的判据（2026-09-28 新增）──────────────────────────────

# 量具有效性门（G5）：方向 / 反饱和 / 分辨率 / 空输入第三态 / 分层与 root 无关 / 可达根
./node_modules/.bin/vitest run tests/health/health-validity.test.ts

# 空输入不得读成"健康"（旧行为是 100(A)；现为 exit 2）
node dist/src/tools/health_cli.js ./no/such/dir ; echo "exit=$?"   # 期望 exit=2

# 同一份代码在两种 root 下分层必须一致（旧实现在此漂移）
node -e "import('./dist/src/health/index.js').then(m=>console.log(m.classifyLayer('server.ts'), m.classifyLayer('src/server.ts')))"
# 期望：glue glue

# 可达根探测（入口不再报孤儿）
node -e "import('./dist/src/tools/project_root.js').then(m=>console.log(m.detectReachableRoots('src').join(',')))"
# 期望含 daemon/daemon.ts 与 tools/serve.ts

# type-only 判定（唯一实现）+ 内核真的标 export type … from
./node_modules/.bin/vitest run tests/tools/type_only_statement.test.ts

# 同族副本扫描（P0-① 只清了 3 份，下表是剩余候选）
grep -rn "js|jsx|mjs|cjs" src --include=*.ts | grep -i "replace"           # 剥后缀：第 3~6 份
grep -rn "'index\.ts'" src --include=*.ts                                  # index 候选：第 2 份
grep -rn "!path.extname" src --include=*.ts                                # project_root 的 .js 盲区
diff <(sed -n '40,50p' src/tools/cli_extract.ts) <(sed -n '50,60p' src/tools/registry_extract.ts)  # 逐字相同的两份

# ── G1 / G4（2026-09-28 新增）────────────────────────────────────

# G1 工具集快照（对外契约不变，P1 的前置判据）
./node_modules/.bin/vitest run tests/server_registry.tool_snapshot.test.ts
# 仅当确认是**故意**的契约变更时才更新基线，并把变更写进本文件台账
UPDATE_TOOL_SNAPSHOT=1 ./node_modules/.bin/vitest run tests/server_registry.tool_snapshot.test.ts

# G4 同族副本棘轮（存量不拦、新增即红）
./node_modules/.bin/vitest run tests/single_source.test.ts
# 债务已还清时收紧基线
UPDATE_SINGLE_SOURCE=1 ./node_modules/.bin/vitest run tests/single_source.test.ts

# G4 出生证（证明它会红）：注入一份副本 → 应报红 → 删除 → 恢复绿
printf 'export const t = /^\\s*import\\s+type\\b/.test(x);\n' > src/__probe.ts
./node_modules/.bin/vitest run tests/single_source.test.ts   # 期望红
rm src/__probe.ts

# ── 推送（凭据：Windows 凭据管理器已有 git:https://github.com → xr192172）──
# `credential.helper=helper-selector` 取不到它，需清空 helper 列表再指定 manager：
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper=manager push origin main
```
