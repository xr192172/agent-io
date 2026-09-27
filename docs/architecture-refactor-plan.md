# 架构重构规划书（活文档）

> 本文件是**持续更新**的规划与进度台账。每完成一步就在 §7 追加一行，并把对应阶段的"状态"改掉。
> 起编：2026-09-28　｜　依据：当轮实测（读数见 §2，命令可复现）
>
> ★ **本文件说"做什么 / 为什么 / 做到哪了"；[`refactor-playbook.md`](refactor-playbook.md) 说"怎么做"（程序、命令、判据、陷阱）。**
>   剩余工作逐项在 **§9**，每项的判据/风险/状态都写明。

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

### 2b. 为什么"兜底式代码"会增殖成 20 份 —— 根因（2026-09-28 实测）

question：一份就够，为什么会有 20 处静态扩展名清单？以下是查出来的**机制**，不是感叹：

| # | 机制 | 实测证据 |
|---|---|---|
| 1 | **权威答非所问** | 内核已有 `listSupportedExtensions()`，但它回答的是"**我装了哪些 tree-sitter 语言包 ⇒ 我能解析什么**"（动态、随 optionalDependencies 变）。各工具问的是"**这个项目里什么算源码**"。实测内核那份是 `['.ts','.js','.mjs','.cjs','.go','.py','.java','.c','.h','.cs','.rs','.php']` —— **连 `.tsx` 都没有**。⇒ 权威没回答大家的问题，于是各自写一份。 |
| 2 | **缺失是沉默的** | 漏一个扩展名 = 少扫几个文件。**不报错、不告警、不失败**，没有任何反馈把作者推回权威。这是"兜底"增殖的**主因**。 |
| 3 | **局部最优是理性选择** | 每次都是"我就加一个扩展名"。在单点看，抄一行比搞清"别处已有 19 份"便宜得多。 |
| 4 | **没有变更通知** | 新增一门语言要改 20 处，而**没有任何机制告诉你有 20 处**。 |
| 5 | **不同问题被当成同一个** | "扫哪些文件"/"可被 import 指向的"/"补全候选"/"反查键"/"可跑 node 的"是**5 个不同问题**，混在一起就永远合不拢（见 §2c）。 |

**⇒ 解药的顺序**：先把**问题分维度**（§2c），再建**单点权威**，再用**棘轮**挡住第 21 份（G4），
最后把"静默缺失"改成"可见"（§2d）。

### 2c. 分维度：哪些该合并，哪些**不许**合并

"重复的策略 ≠ 重复的实现"。合并前先问"两边回答的是同一个问题吗"。本次实测的分类：

| 维度（问题） | 权威（单点） | 归属 |
|---|---|---|
| TS/JS 家族的 8 个扩展名 | `TS_JS_EXTS` | ✅ 合并 |
| 转译后可交 node 子进程执行的 | `NODE_RUNNABLE_EXTS`（**派生**自上面） | ✅ 合并 |
| 项目内"可被扫描/分析"的源码（多语言并集） | `SOURCE_EXTS` | ✅ 合并 |
| **可被 import 指向的东西**（含 `.json`） | `import_resolve.IMPORT_EXTS` | ❌ 另一维度，**不许合进 SOURCE_EXTS** |
| **同名无扩展名碰撞时的解析优先级** | `import_project.RESOLVE_EXTS` | ❌ 另一维度（顺序即语义） |
| **值得做文本扫描的可读文本**（`.json/.md/.yml/.html/.css`） | `rename_symbols.SCAN_EXTS` | ❌ 不是"源码"，**不许合** |
| 积木 resolve 候选（含 `.json`） | `slim_brick.TS_RESOLVE_EXTS` | ❌ 另一维度 |

### 2d. 「只许成功不许失败」的功能，**不许有兜底**

用户提出的判据，落成可执行的纪律：**当"错了"会静默降级时，禁止用兜底"猜一个"，必须硬失败或显式可见。**

| 功能 | 现状 | 应有行为 |
|---|---|---|
| 对外契约（工具名 / inputSchema） | ✅ 已有 G1 快照门 | 变了就红，**没有"兜底兼容"** |
| 全局配置 / 索引路径 | 曾散在 4 个文件（见 09-27 记忆） | 单点 + 缺失即报 |
| **符号解析 / 引用闭包** | ⚠️ 解析不到**静默返回 null** ⇒ 闭包悄悄漏文件 | 计数并**显式暴露**"本次有 N 条相对 import 未解析"（下一次迭代做） |
| 健康分 / 分层判定 | ✅ 已做：`N/A` 第三态 + `unclassified` 可见 | 保持 |
| 索引保鲜 | ✅ 已有 `staleIndexWarning` 标注 | 保持 |

> ★ 一条通用判据：**如果一个"兜底"的失败模式是"少做一点事而不说话"，它就不该存在。**
> 要么硬失败（吵醒人），要么把"少做了什么"变成可读的数（看得见）。

---

## 3. 脉络（六阶段，顺序即优先级）

| 阶段 | 内容 | 验收判据 | 风险 |
|---|---|---|---|
| **P0 修量具** | ①解析器统一成一份 ②可达根注入（`package.json` 按路径调的入口 + registry 派发表）③`import type` 不计分层违规 ④健康分去饱和 ⑤分层规则重划 | 体检在"已知好/已知坏"双夹具上给出**不同**读数；层违规非空且每条可解释 | 低（只动分析器） |
| **P1 拆注册表** | `server_registry.ts` 3,586 行 → `registry/lanes/*.ts`，按既有 `LANE_IDS` 一 lane 一文件；`registerAllTools` 汇总；`capability_map` 从 lane 文件聚合 | **工具集快照逐字相同**（G1 ✅ 已就位）；`readme_tools_gate` 仍 67=67；回归全绿 | 低（零行为变化） |
| **P1a ✅ 已完成** | 抽 `registry/{types,plumbing,handlers}.ts`（**解除 lane 切分的循环依赖**） | G1 逐字相同 + 67=67 + 回归全绿 —— **三项全过** | 低 |
| **P1b ✅ 已完成** | 按 `LANE_OF` 切 `registry/lanes/*.ts` + `TOOL_DEFS` 汇总 | 同 P1 —— **三项全过**（G1 逐字相同 / 67=67 / 回归全绿） | 低 |
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

- **还债②（本笔）：建「什么算源码」的单点权威，把 20 处静态清单收敛到 1 处 + 4 处有意保留**
  - 新 `src/tools/ts_kernel/source_exts.ts`（唯一权威，按**维度**分而不是硬合成一个大列表）：
    `TS_JS_EXTS`（8 个，同 AST + 同模块语义）/ `OTHER_LANG_EXTS` / `SOURCE_EXTS`（多语言并集，17 个）/
    `NODE_RUNNABLE_EXTS`（**派生**自 TS_JS_EXTS，排除未验证的 `.mts/.cts`）/ `isTsJsExt` / `isSourceExt` / `isNodeRunnableExt`。
  - **迁移 13 处**（`behavior`、`rename_file`、`rename_symbol`×2、`symbol_move`、`version_upgrade/adapters/node`、
    `project_root`×3、`package_migration`×2、`contract_gate`、`deprecate_offline`、`refs_text`、`rule_apply`）。
  - ★ **方向单调安全**：新权威是原先 6 份互不一致清单的**真超集** ⇒ 迁移**只增不减**，
    不存在"某工具反而看不到原本能看到的文件"。实测：**全量回归全绿，5 处扫描面变宽没有破坏任何测试**。
  - 根因与分维度判据写进 §2b / §2c；「只许成功不许失败的功能不许有兜底」判据写进 §2d。
  - G4 棘轮收紧：`source-extension-static-list` 存量 **15 → 4**；新增 `ts-js-family-extension-list`（存量 **0**）。
  - 验证：tsc 干净；回归 **210 文件 / 2211 测试全过**；G1 6 项 / G4 10 项过；`readme_tools_gate` 数字一致（67=67）。

- **P1a（本笔）：抽 `src/registry/` 基础设施 —— 3,591 → 3,112 行，解除 lane 切分的循环依赖**
  - 新三模块：`registry/types.ts`（40 行，`ToolDef`）、`registry/plumbing.ts`（70 行，`textOut`/`wrap`/`wrapData`/`looseInputSchema`）、
    `registry/handlers.ts`（478 行，**20 个跨 lane 复用的主工具 handler**）。
  - `server_registry.ts` 改为 import 之，并保留 `export type { ToolDef }`（公开 API 位置不变）。
  - ★ **为什么必须先做这一步**（写在三个模块的文件头）：lane 文件要用到上面这些东西，
    而它们原先都定义在 `server_registry.ts` **内部** ⇒ lane 一 import 就成环
    （server_registry → lanes → server_registry）。抽出来后依赖变成单向。
  - `handlers.ts` 的 import 清单由脚本**按标识符出现**算出（不是拍脑袋）：
    涉及 `../tools/*` 25 个模块 + `../observe/*` 6 个 + `../daemon/dispatch` + `../storage`，
    外加一条 `import path from 'node:path'`（★ 首轮漏了默认导入 —— 名字匹配只覆盖具名导入，tsc 抓出来的）。
  - **验收三项全过**：G1 工具集快照 6 项（对外契约逐字相同）/ `readme_tools_gate` 67=67 / 全量回归全绿；
    G4 棘轮 10 项（搬迁未引入新副本）、G5 15 项均不变。
  - 顺带确认：`server_registry → registry/handlers → tools/sync_contracts → server_registry` 这个环
    **原先就存在**（不是本笔引入），且 `sync_contracts` 的注释已说明"仅在函数执行期读取，ESM 循环 import 安全"
    —— 测试全绿是该结论的实证。

- **P1b（本笔）：`TOOL_DEFS` 按能力线切成 `registry/lanes/*.ts` —— `server_registry.ts` 3,591 → **574** 行**
  - 67 条逐字搬移，按 `LANE_OF` 分配：refactor 19 / observe 13 / design 12 / meta 9 / harvest 9 / cross 5（合计 67 ✓）。
    lane 文件行数：`refactor 1158`（最大，本就是 P2 的重点）、`observe 426`、`design 399`、`meta 380`、`harvest 276`、`cross 192`。
  - `server_registry.ts` 只剩：基础设施（陈旧构建/陈旧索引/首次接触/可信度附注）+ lane 汇总 + `registerAllTools`。
  - ★ **线归属现在由文件路径表达** —— `capability_map.ts` 的那张 `LANE_OF` 表不再承担"哪些工具属于哪条线"
    的唯一职责（P1c 可把它改成派生；`when` 这类策展文本仍留在原处）。
  - ★ 搬迁中撞到两类"路径敏感"问题，都由 `tsc` 抓出（不是靠人眼）：
    ① 导入清单首轮**漏了默认导入**（`import path from 'node:path'`）—— 名字匹配只覆盖具名导入；
    ② 条目里有**动态 import**（`refactor.ts` 的 `await import('./tools/write_gate.js')`）——
       其相对路径原本相对 `src/` 书写，搬到 `lanes/` 后必须退两级。
    ⇒ 这正是 P2 风险台账"搬迁破坏相对 import"那条的实证；**静态 import 可靠生成，动态 import 必须特意处理**。
  - ★ **破环：`capability_map` 与 `TOOL_DEFS` 互相需要**。`capability_map` 的目录必须来自真实注册表
    （不能自己再维护一份清单），但它属于 meta 线，而 `TOOL_DEFS` 是各 lane 汇总出来的 ⇒ 结构上成环。
    破环方式：meta.ts 放一个**延迟引用** + `bindToolDefs()`，由 `server_registry` 在汇总后注入；
    **刻意不给"看起来能用"的空表** —— 未注入时直接抛错，而不是静默列出 0 个工具（§2d 的"不许静默降级"）。
  - **验收三项全过**：G1 工具集快照 **6 项**（顺序变了、**契约逐字不变** —— 这正是 G1 当初把"顺序不算契约"写明的原因）、
    `readme_tools_gate` 67=67、全量回归全绿；`capability_map` 15 项证明破环保住了。

  - ★★ **搬迁把两个 CI 门打红了 —— 这类"门跟着被搬走的代码失效"要记进 P2 风险台账**：
    - `scripts/readme_tools_gate.mjs` 写死读 `src/server_registry.ts` 数工具数 ⇒ 搬到 lanes 后**扫出 0 个**，
      把一次全绿回归打成红的（`tests/scripts/readme_tools_gate.test.ts` 的 dogfood 用例暴露）。
    - `scripts/contract_docs_gate.mjs` 更凶：它对比 `git show HEAD:src/server_registry.ts` 与工作区，
      写死路径后 **`cur` 空而 `prev` 67 个 ⇒ 把 67 个工具全判成"改名残留未清"**（CI 会一片假红）。
    - ⇒ 修法：新建 `scripts/tool_sources.mjs`（**唯一实现**，**扫目录**而不是写死清单：
      `src/server_registry.ts` + `src/registry/lanes/*.ts`），两个门都 import 它；
      `contract_docs_gate` 也改为**逐个工具定义文件**从 HEAD 读（HEAD 里还没有的文件跳过）。
      `tests/tools/_dogfood.test.ts` 的扫描清单同步换到 `lanes/refactor.ts`。
    - ★ 教训：**门的"输入在哪"本身也是一处知识**，写死路径 = 又一份副本。P2 要搬 200 个文件，
      落盘前应先用 `grep -rn "src/" tests scripts | grep readFileSync` 盘一遍同类风险。

- **文档与还债（本笔）：新增操作指南 + §9 剩余工作总清单 + B1**
  - ★ 新增 [`refactor-playbook.md`](refactor-playbook.md)（**操作指南 / SOP**）：与规划书分工明确 ——
    规划书说"做什么/为什么/做到哪了"，指南说"怎么做"。
    含：① **7 道门的一页速查**；② **搬移一块的标准 8 步法**（先量 → 先建门 → 脚本化 → 补依赖 → tsc → 门 → 回归 → 提交）；
    ③ 三类**路径敏感**与盘查命令；④ **破环模式**（延迟注入 + 不给空表）；⑤ **7 条已知陷阱**（每条带现场实例）；
    ⑥ 回滚纪律；⑦ 提交信息模板。**凡标 ★ 的都是踩过的坑，不是设想。**
  - ★ 规划书新增 **§9 剩余工作总清单**（A 收尾 P1 / B 同族副本还债 / C 门补完 / D P2 拆 tools /
    E P3 抽字符串 / F P4 工具收敛 / G 待决策），每项写明**判据、风险、状态** ⇒ 活台账从此可逐项认领。
  - **B1**：`cli_extract.ts` 与 `registry_extract.ts` 里**逐字相同**的函数（正则/过滤/`replace` 全同，
    连注释都同义）收敛为 `ts_kernel/import_text.ts` 的 `parseRelativeNamedImportMap`。
  - ★ **写作过程中发现两件事**（都是"给权威写单测"逼出来的）：
    1. **副本相同 ≠ 副本正确**：我按注释声称的语义写测试（`a as c` 应映射**本地名**），立刻红了 ——
       两份旧实现取的都是 `as` **前面**的远名。仓内已有 **4 处**带别名的相对具名 import
       （`rule_apply.ts:26` 等），只是都不在被反查的位置 ⇒ **潜伏缺陷**。
       已修成"远名与本地名**都收**"（**严格增量**：旧行为保留、新能力补上、零风险）。
    2. **覆盖不对称**：`registry_extract` 有测试、**`cli_extract` 没有** —— 副本能悄悄分叉往往就靠这个
       （已列 §9-B1a）。
  - 新增 G4 家族 `relative-named-import-text-parse`（权威 = `import_text.ts`，存量 **0**）。
  - 验证：tsc 干净；新增 `tests/tools/import_text.test.ts`（10 项，含别名/多行/边界/过滤）；
    G4 **11 项**过；全量回归见下。

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
| 6 | "什么算源码扩展名"静态清单 | 全仓 **20 处**（比初版数的 15 更多），口径互不一致：contract_gate 12 / deprecate_offline 7 / package_migration 8 / refs_text 11 / rule_apply 14 / project_root 15 … | ✅ **已收敛**（本笔）：新建内核唯一权威 `ts_kernel/source_exts.ts`（`TS_JS_EXTS` / `NODE_RUNNABLE_EXTS`(派生) / `SOURCE_EXTS`(并集) / `isTsJsExt` / `isSourceExt`），迁移 **13 处**；G4 存量 **15 → 4**，并新增 `ts-js-family-extension-list` 家族（存量 0）。剩余 4 处**已判定为不同维度、有意保留**（理由写进登记表 `note`；见 §2c）。根因分析见 §2b，分维度判据见 §2c。 |

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
| **★ 门按路径读源码 ⇒ 搬迁即失效** | P1b 实测：`readme_tools_gate` 扫出 0 个工具、`contract_docs_gate` 把 67 个工具全判成"改名残留" | ①`scripts/tool_sources.mjs` 唯一实现 + **扫目录**；②P2 落盘前先盘一遍：`grep -rn "src/" tests scripts \| grep -E "readFileSync\|readdir\|existsSync"`；③**新门一律不许写死工具定义/内核的路径** |

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

# 「什么算源码扩展名」权威的现状（3 个维度 + 谓词）
grep -n "export const\|export function" src/tools/ts_kernel/source_exts.ts
# 还在手写扩展名清单的地方（应只剩已登记的 4 处「不同维度」）
grep -rn "'.ts', '.tsx', '.js'" src --include=*.ts | grep -v "^src/tools/ts_kernel/source_exts.ts"

# ── 推送（凭据：Windows 凭据管理器已有 git:https://github.com → xr192172）──
# `credential.helper=helper-selector` 取不到它，需清空 helper 列表再指定 manager：
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper=manager push origin main
```

---

## 9. 剩余工作总清单（每项：判据 / 风险 / 状态）
> 执行程序一律走 [`refactor-playbook.md`](refactor-playbook.md) 的 **8 步法**；
> 其中 §2（路径敏感）与 §4（陷阱）**在 P2 期间每条都会被撞到**。
> 状态标记：✅ 已完成 ｜ 🔄 进行中 ｜ ⏳ 待做 ｜ 🔒 需你拍板

### A 收尾 P1

| # | 事项 | 判据 | 风险 | 状态 |
|---|---|---|---|---|
| A1 | **P1c**：`capability_map.LANE_OF.lane` 改为**派生**（lane 归属已由文件路径表达；保留 `when` 等策展文本）+ 加门「lane 文件里的工具 ↔ LANE_OF 归属一致」 | 门能红（把某工具挪到别的 lane 文件即报）；`capability_map` 15 项过 | 低 | ⏳ 下一轮 |

### B 同族副本还债（来源：§7 的《新发现的同族副本》表）

| # | 事项 | 判据 | 风险 | 状态 |
|---|---|---|---|---|
| B1 | `cli_extract.ts:47` 与 `registry_extract.ts:57` 是**逐字相同**的函数（正则/过滤/`replace` 全同）⇒ 抽一份共享 | 两处都改为引用；G4 新增家族存量 **0** | 低 | ✅ 本轮（`ts_kernel/import_text.ts`） |
| B1a | **新发现**：`cli_extract.ts` **没有任何测试文件**（`registry_extract.ts` 有）—— 副本的**覆盖不对称**正是它们能悄悄分叉的原因 | 补一个端到端小测（现在只覆盖了共享函数本身） | 低 | ⏳ |
| B1b | **新发现（潜伏缺陷）**：`parseRelativeNamedImportMap` 的两份旧实现都取 `as` **前面**的远名，而两个消费者要的是**本地名**。仓内已有 **4 处**带别名的相对具名 import（`rule_apply.ts:26` 等），只是都不在被反查的位置 ⇒ 今天不咬人 | 已修成"远名与本地名**都收**"（严格增量）；单测钉住 | 低 | ✅ 本轮 |
| B2 | `refs_text.ts` 的 `specifierCandidates` + 两处剥 JS 后缀（与内核同一条"后缀知识"） | 评估后：能复用 `SOURCE_EXTS` 就复用；**不能则登记为不同维度** | 中（它是**反向**生成器：file → specifier 串，语义确实不同） | ⏳ |
| B3 | "什么算源码扩展名" 20 处 → 1 权威 + 4 处有意保留 | — | — | ✅ `bbe9c34` |
| B4 | 相对 import 解析 4 份 → 1 | — | — | ✅ `579d7ad`/`a1ff974` |
| B5 | type-only 判定 5 处 → 1 权威 + 1 有意保留 | — | — | ✅ `c694471` |

### C 门补完

| # | 事项 | 判据 | 风险 | 状态 |
|---|---|---|---|---|
| C1 | **G3 分层方向门**：依赖只允许向下、`import type` 不计 —— 目前只在 `health` 里落地，**没有独立门** | 注入一条反向依赖 ⇒ 门红 | 低 | ⏳ |
| C2 | G4 登记表随 B1/B2 的结论更新 | 存量只减不增 | 低 | 🔄 随 B 走 |
| C3 | G1/G4/G5 已在跑 | — | — | ✅ |

### D P2 拆 `src/tools/`（200 文件 / 71k 行，全仓 65%）—— **一族一提交**

> ★ **顺序修正**：**§10 品牌改名排在 D 之前**（两者都触及几乎每个文件，不要交错；且改名自己的判据
> "除品牌串外逐字相同"在文件未被移动时最强）。⇒ 实际执行顺序：**A → B/C → §10 改名 → D**。

| # | 事项 | 判据 | 风险 | 状态 |
|---|---|---|---|---|
| D0 | **落盘前跑路径敏感盘查**（playbook §2 命令） | 列出所有"按路径读 src"的门/测试，逐一确认 | — | ⏳ **必做前置** |
| D1 | 17 个 `*_cli.ts` → `surfaces/cli` | G1 + 67=67 + 回归全绿 | 中 | ⏳ |
| D2 | HTTP 面（`serve.ts` 3,151 行等）→ `surfaces/http` | 同上 | 中高 | ⏳ |
| D3 | 库（`ts_kernel`/`ast_parser`/`project_root`/`db`）→ `kernel` | 同上 | 中 | ⏳ |
| D4 | 工具定义 → `features/<lane>`（与 `registry/lanes` 对齐） | 同上 | 中 | ⏳ |

> ⚠️ D 阶段每搬一族，**迁移脚本都要重算 import**；且必须走 playbook §4.1/§4.2 的编译器复核。

### E P3 抽字符串（`renderer/` 12,173 行 JS/CSS 在模板串里）

| # | 事项 | 判据 | 风险 | 状态 |
|---|---|---|---|---|
| E1 | 先建 **playwright 渲染快照基线** | 快照稳定（跑两次一致） | 低 | ⏳ **必做前置** |
| E2 | `scripts.ts` 6,209 + `styles.ts` 3,526 → 真资源文件（**复用既有 `gen_*_bundle.mjs`**） | 快照逐块对比无差异 | 中 | ⏳ |

### F P4 工具收敛（按仓内 `docs/tool-convergence.md` 的 5 步核验纪律，**不另立方案**）

| # | 事项 | 判据 | 风险 | 状态 |
|---|---|---|---|---|
| F1 | 是否真动工具名（`mcp__design-canvas__*` 会断开 DSH 现有会话与桥接） | — | — | 🔒 **需你拍板** |
| F2 | ★ 加 `DELETED_TOOLS` **墓碑清单**（warning 不 raise，附替代指引）—— 来自 Serena 对照 | 删/改工具名后老调用得到 warning 而非 unknown tool | 低 | ⏳ |
| F3 | 优先**改 description 而非改 name**（名字是对外契约，描述不是） | G1 只报 description 变更 | 低 | ⏳ |

### G 待决策 / 待确认

| # | 事项 | 为什么要你或需实测 |
|---|---|---|
| G1 | **高复杂度阈值 10 是否标定得当**（实测 444 个函数超阈值，占健康分扣分 25/56） | 阈值过严 ⇒ 该维永远顶格、退化成常数项；合理 ⇒ 本仓确实有 444 处待拆 |
| G2 | `orphan_file` 剩 **16** 个里哪些是真死代码（`version_upgrade/` ~1,941 行疑似全孤立、`tools/get_dsl.ts` 等） | 删除不可逆 |
| G3 | 四层规则表（`surfaces/features/kernel/dsl`）**何时切换** | 建议 P2 落地那一刻；现在换会让搬迁中间态全判违规 |
| G4 | B2 的结论（`refs_text` 是复用还是登记为不同维度） | 属工程判断，可直接做，结论记账即可 |

---

## 10. 品牌改名：DesignCanvas → AgentIO（独立一节，**排在 P2 之前**）

### 10.1 结论：**不新增"项目改名工具"** —— 但现有能力的驱动方式不匹配，缺口在别处

用户问："要不要增补一个项目改名工具？其实安全重命名应该就可以做到这件事。"

**实测答案：不用加工具，但也不能直接拿 `rename_symbols` 来跑。** 理由：

| 事实 | 证据 |
|---|---|
| `rename_symbols` **已经有**字面量能力 | `report_literals` / `apply_literals`；`buildLiteralPlan()`（`rename_symbols.ts:356`）会扫"每个旧符号的 snake 变体"在项目文本里的命中 |
| 而且它**已经带了这种改名最需要的判断** | `decideLiteral(kind, frozen, isGen)`：`contract`=需人审 / `history`=保留 / **冻结行跳过** / **生成文件跳过** —— 这套判断才是资产 |
| 但它是**符号驱动**的 | `needles = renames.map(i => camelToSnake(i.symbol))` —— 从**符号名**派生 snake 变体。**品牌串不是符号** ⇒ 不能直接驱动 |

⇒ **做法：复用它的"判断"，不新造工具。** 具体是给品牌改名造一个**符号级锚点**（例如把品牌串声明成一组
"仿符号"的替换对），或在 `rename_symbols` 上开一个"**显式字面量对**"入口（`renames` 已支持 `symbol→to`，
只是 needle 由 `camelToSnake` 派生；显式入口 = 允许直接给 needle）。
★ 这一处是**能力补齐**（同一个工具多一个入参），不是新工具 —— 与 P4「工具收敛」的方向一致。

### 10.2 先量：品牌串实际有 **7 种形态**（实测文件数）

| 形态 | 命中文件数 | 归谁 / 注意 |
|---|---|---|
| `design-canvas` | **116** | 主体（含 `.design-canvas` 的子串） |
| `.design-canvas` | **86** | ★ **运行时契约**：数据目录（`rules/` 住那儿）⇒ 不是纯字符串，见 §10.4 |
| `DC_` | 16 | ★ **有歧义**：可能是品牌缩写，也可能是别的 `DC` ⇒ **需人审**（正是 `contract` 那一类） |
| `dc-` | 16 | ★ 同上，歧义更大（`dc-` 可能是任何东西） |
| `DESIGN_CANVAS` | 6 | 环境变量（`DESIGN_CANVAS_MEMORY_WATCH`）等 |
| `design_canvas` | 2 | snake 形态 |
| `DesignCanvas` | 1 | Pascal 形态 |
| `dsh-brain` | 4 | ★ **桥接耦合**（用户已定："改完再重新桥"）|

产物形态：`package.json` 的 `name`/`bin`(`design-canvas`)/`repository`/`bugs`/`homepage`、
MCP client 配置里的 **server key**（`"design-canvas": {...}` —— `mcp__design-canvas__*` 的前缀来自它）、
git remote、README/AGENTS/skills/文档正文。

### 10.3 排序：**排在 P2 之前**（三个理由）

1. 改名自己的判据可以做得很强：**"除品牌串外逐字相同"** —— 这个 diff 在**文件没被移动过**时最可读；
   P2 会移动 200 个文件，之后再做改名，判据就被淹没在 move 噪音里。
2. 两者都触及**几乎每个文件**（改名动内容、P2 动位置）⇒ **不要交错做**，一次一个。
3. 改完名再做 P2，P2 的新路径/新 import 一次到位，不必二次改。

### 10.4 三类**不是字符串替换**的东西（必须单独处理）

| # | 东西 | 问题 | 处置 |
|---|---|---|---|
| 1 | `.design-canvas/` **数据目录** | 盘上已有项目的数据（`rules/` 等）在这里；纯改名 ⇒ 老项目数据"消失" | **兼容策略**：新名目录 + **迁移期读旧名**（先读新、无则读旧），并在文档里给出迁移命令；**不许**静默改用新名 |
| 2 | **环境变量**（`DC_*` / `DESIGN_CANVAS_*`） | 用户脚本/CI 里已经写死 | 新名 + **旧名仍生效**（读新优先、回退旧），并在日志里**提示已弃用**（不许静默忽略旧名） |
| 3 | **MCP server key / bin / 包名 / git remote** | 对外契约与仓库级 | 单独一步：改配置 + README/AGENTS 同步 + 桥接重连（用户已授权） |

### 10.5 判据：新增「品牌串残留门」（**先建门，再动手**）

形态与 G4 棘轮一致（存量不拦、新增即红），但**多一条 history 允许表**（本仓既有惯例：
历史决策/核验记录保留旧名是**正确原貌**，不算残留 —— 同 `contract_docs_gate` 的 `HISTORY_RE`）：

- `patterns`：`design-canvas` / `DESIGN_CANVAS` / `design_canvas` / `DesignCanvas`（**不含** `DC_`/`dc-`，那两类要人审）
- `allowFiles`：历史文档（`docs/tool-convergence.md` 等）、以及本规划书自身的**历史条目**
- `frozen`：当前各文件的命中数（棘轮基线，**随改名推进逐笔收紧**）
- 断言：① 新增命中 ⇒ 红；② `allowFiles` 里的文件必须真实存在；③ 改名完成后 frozen 应为 **0**（目标态）

**✅ 已建**（`tests/brand_residue.test.ts` + `tests/fixtures/brand_residue_registry.json`）。
实测基线：**211 个文件 / 759 处**（目标态 0）。出生证已验证：注入一行旧名 ⇒ 门红并指名。

★ 两个建门时才发现的问题，都写进门里了：
1. **门必须排除自己**：门自身按定义就要写出那些品牌串（`patterns` 数组、提示语）⇒ 不排除则基线**永不可能归零**。
   用独立的 `SELF_FILES` 常量，**不塞进 `allowFiles`**（后者语义是"历史记录保留旧名是正确的"，两件事别混）。
2. ★★ **品牌改名会让 G1 契约快照合法地变红**：`tests/fixtures/tool_set_snapshot.json` 里有 **28 处**品牌串 ——
   工具**描述**里提到了旧名。⇒ 改名属于**有意的对外契约变更**（描述变了），
   必须走 G1 的 `UPDATE_TOOL_SNAPSHOT=1` 更新基线，并在本台账登记这次变更。
   （工具**名**不变 ⇒ 名字那一层不动；改的只有 title/description。）

★★ 顺带一条对 §9-D（P2）的提醒：**「品牌串残留门」与「G4 同族副本门」的 frozen 都登记了文件路径** ⇒
P2 搬文件会同时打红两扇门。这是**有意的**（逼你在搬迁时同步登记表），但要在 P2 的族提交里预留这一步。

### 10.7 已执行：数据目录名**单点化**（值不变、零行为变化）—— 为改名把 193 处压成 1 处

改名要改的就是数据目录名，而它此前**硬写在 193 处、散在 130 个文件**（`storage.ts` / `db.ts` /
`daemon.ts` / `observe/*` / `java_refactor/*` / 一堆 tools …）⇒ 直接改名**必然漏**，
而且**没法加"旧名回退"的兼容层**（兼容逻辑要判断"新目录不存在而旧目录存在"，散落时无处安放）。

⇒ 按"**先建单点，再改值**"：本轮只做**值不变**的单点化（纯重构，回归全绿即证零行为变化）：

- 新增 `src/data_dir.ts`（唯一落点）：`DATA_DIR_NAME` / `DATA_DIR_NAME_LEGACY`（改名时启用回退）/
  `DATA_DIR_NAMES`（迁移期新名与旧名并存，扫描跳过用）/ `dataDirOf` / `dataDirUnder` /
  `isDataDirName` / `isUnderDataDir`。
- **86 个文件 / 194 处**字面量改为引用常量（`src` + `tests`）。
- 剩余**有意保留**：`scripts/*.mjs`（4 个：`demo` / `install_mcp` / `promote_design_canvas_mcp` / `setup`）
  —— `.mjs` **不能 import TS**，改名那一步直接改这几处（已在残留门覆盖范围内）。
- ★ 注意 `.design-canvas.json` 是**另一个东西**（保护清单文件名，`protect.ts`），与数据目录名无关，
  本轮**刻意没动**；改名时单独决策。

**实测数字**：

| 指标 | 改前 | 改后 |
|---|---|---|
| `src`/`tests` 里独立字面量 `'.design-canvas'` | 193 + 4（反引号） | **2**（只剩 `data_dir.ts` 的两个常量声明） |
| 品牌残留门存量 | 211 文件 / 759 处 | **175 文件 / 571 处** |

★ 门在这一步**抓到一个真问题**（不是假阳）：新模块本身就构成"新增的旧名出现处" ——
`DATA_DIR_NAME_LEGACY` **按设计必须永久保留旧名**（迁移期回退）⇒ 它进 `allowFiles`（写明理由），
**不是**冻进存量、更不是删掉兼容层。
★ 还修了门自己的一个 bug：**把"提示收紧基线"和"失败"混在同一条信息里 ⇒ 任何改善都会把门打红**
（本轮减少 188 处时门就红了）。已改为分别断言 `added`/`grown`，`shrunk`/`cleared` 仅提示。

### 10.6 执行步骤（按 playbook 8 步法）—— 进度

1. ~~**建残留门**~~ ✅（§10.5，`1817617`）
2. ~~**先建单点**：数据目录名单点化（值不变）~~ ✅（§10.7，本轮）
3. **给 `rename_symbols` 开"显式字面量对"入口**（§10.1）—— 复用它的 `decideLiteral` 判断。
   ⚠️ 这会**改到 inputSchema** ⇒ G1 会红，属**有意的契约变更**，要连带更新 G1 基线并在本台账登记。
4. **跑 `report_literals` 出全量清单**，逐类决策：`apply`（机械替换）/ `contract`（**人审**：`DC_`/`dc-`/`.design-canvas.json`/环境变量）/ `history`（保留）。
5. **改产物与契约**：`package.json`（name/bin/repository/bugs/homepage）、README/AGENTS、MCP server key、git remote。
6. **启用兼容**：`DATA_DIR_NAME` 改新名 + `resolveDataDir()` 回退旧名；环境变量读新优先、回退旧、**弃用提示**；
   顺带改 `scripts/*.mjs` 的 4 处。
7. **重桥**（用户已授权；`dsh-brain` 4 处耦合）。
8. 验证：tsc + G1（契约，需**有意更新**） + 67=67 + 全量回归 + 残留门 frozen 收紧到 **0**。

> ⚠️ **`mcp__design-canvas__*` 的前缀**来自 client 配置的 **server key**，不是工具名 ⇒ 改它属于"配置层改名"，
> **与 P4-F1（改工具名）是两件事**；本节的改名**不动任何工具名**，工具集快照 G1 应保持逐字不变。
