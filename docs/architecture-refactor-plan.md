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
| **P1c ✅ 已完成** | 删 `capability_map.LANE_OF`（第二份归属清单）→ 归属由 lane 文件派生、`bindLaneOf()` 注入；`WHEN_OVERRIDES` 只留策展文本 | **G1 逐字相同** + 8 门全绿 + 新门 6/6 探针全红 + 回归全绿 | 低 |
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
3. **P1c ✅ 已完成**（2026-09-28）：lane 归属已由**文件路径**表达 ⇒ `capability_map.LANE_OF`（**第二份清单**）
   **删除**；归属改由 `server_registry.LANE_SOURCES` 汇总后 `bindLaneOf()` **注入**，
   本文件只留 `WHEN_OVERRIDES`（纯策展文本，不含 lane）。新门见 §7 的 P1c 条目。

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

- **P1c（本笔）：删掉 `capability_map.LANE_OF` —— 归属单点化，第二份清单消失**
  - **改了什么**：`LANE_OF`（工具 → `{lane, when}`，67 条）→ **`WHEN_OVERRIDES`**（工具 → `when` 字符串，67 条）。
    归属不再住在 `capability_map.ts`：`server_registry` 新增 `LANE_SOURCES`（**唯一**的"lane 文件 → 线 id"映射，
    6 行）→ `laneOfFromSources()` 派生 → `bindLaneOf()` 注入。capability_map 侧新增 `bindLaneOf()` /
    `resetLaneOfForTest()` / `resolveAssign()`。
  - ★ **未注入就抛错，不给空表**（同 P1a 的破环纪律）：空表会让 67 个工具**全部**变成"未归线"，
    而"未归线"在导航里是**正常可见**的一类（设计如此，防新工具静默消失）⇒ "忘了接线"会被伪装成
    "这些工具确实没归线"，静默且难查。抛错把加载期错误变成立刻可见的失败。
  - ★ 顺带新增 `staleWhen`：`WHEN_OVERRIDES` 有、注册表没有的工具 ⇒ `validateLanes` 报
    「陈旧策展文本」（工具删了、说明忘删）—— 这是单点化后**新暴露**的一类漂移。
  - **量化**：`capability_map.ts` 353 → **427** 行（表变长是因为原先部分条目把 `lane` 与 `when` 挤在同一行，
    现在每条独立一行）；`server_registry.ts` 574 → **600** 行（+26：来源表、派生函数、注释）。
    ★ **净效果不是"变短"而是"少一处要同步"** —— 这才是本笔的价值，别用行数衡量。
  - **验收**：G1 工具集快照 **6 项逐字相同**（对外契约零变化）；8 个门文件 **70 项全绿**；
    全量回归 **217 文件通过 / 1 跳过；2256 项通过 / 5 跳过**（与搬迁前逐字相同）；
    `tsc --noEmit` 干净。

- ★★ **本笔最有价值的产出不是改动，是一条被我抓出来的"空门"**（新门 `tests/registry/lane_sources.test.ts`）
  - 新门 7 项，全绿。我按纪律逐个**做出生证**（注入错 → 确认变红 → 还原），结果：

    | 探针 | 期望红 | 实测 |
    |---|---|---|
    | P1 僵尸 lane 文件（`lanes/zz_stray.ts` 没人 import） | ① | ★ 红 |
    | P2 同一工具归两条线 | ② | ★ 红 |
    | P3 注册表里多出一个不在任何 lane 的工具 | ③ | ★ 红 |
    | P4 `LANE_OF` 被写回 capability_map | ⑦ | ★ 红 |
    | P5 **两条线的 id 互换**（design↔cross） | ④ | ★ 红 |
    | P6 线 id 写成不存在的名字 | ① | ★ 红 |
    | **P0（初版）对象同一性断言** | ③ | **✗ 恒真、探针照绿** |

  - ⇒ **我删掉了那条断言**。它写的是"`TOOL_DEFS` 里的 def 就是 lane 数组里那个**同一个对象**"，
    而 `TOOL_DEFS` 正是 `LANE_SOURCES.flatMap(...)` 派生的 ⇒ **同义反复**。
    这正是本项目"兜底代码 = 虚假安全感"的同一病症，只不过发生在**门**里。
  - ⇒ 因此得出一条纪律并写进指南 **§4.11**：**恒真的断言不是门；新门必须逐个做出生证**；
    探针里要**同时放"本门应该抓不到"的对照项**，否则不知道断言在抓什么。
  - ★ 另有一条诚实修正：P5（把 design 与 cross 两个 id 互换）**上一版门抓不到** ——
    id 集合仍是那 6 个、工具数不变、名字集合不变 ⇒ ①②③ 全绿，两条线的成员会**静默对调**。
    补法：用**动态 `import()` 真去加载 `lanes/<id>.js` + 对象同一性**（这一步不恒真，
    因为它把"映射里挂的数组"与"该文件实际导出的数组"对上了）。这是 P1c 之后唯一剩下的
    "人工第二处"（那 6 行映射）的兜底。

- ★ **两个脚本坑（都在同一天撞到，已写进指南 §4.10）**：
  1. **单条正则刮多形态表**：67 条里 66 条是单行形态、1 条多行形态，且文件是 CRLF ⇒ 正则只刮到 1 条。
     改用**逐行状态机**；★ **数量守卫**（`if (n !== 67) throw`）让脚本报错退出、**文件一个字节没坏**。
  2. **按"整文件统一 EOL"拼字符串**：本仓文件是**混合换行符**（CRLF 为主 + 若干 LF 行），
     第一版头注释更新脚本因此只命中 1/6（全 LF 的 `refactor.ts`），其余**静默跳过**。
     改为**逐行替换、保留每行原有行尾**后 6/6。

- ★ 顺手改正一处**陈旧声明**：指南 §4.9 此前写着"`DATA_DIR_NAME_LEGACY` **按设计必须永久保留旧名**，
  处置是写进 `allowFiles`" —— 那个常量**已被用户纠正后整批删除**（§11.1），该条早已与代码不符。
  已改写为真正的教训（**门报红时两问、顺序不能反**：该不该存在 → 为什么我还在为它写豁免）。
  这类"文档描述的状态已不存在"正是本项目一直在抓的东西，出现在自己的指南里更该修。

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
| A1 | **P1c**：`capability_map.LANE_OF.lane` 改为**派生**（lane 归属已由文件路径表达；保留 `when` 等策展文本）+ 加门「lane 文件 ↔ 归属一致」 | G1 逐字相同 + 8 门全绿 + 新门 **6/6 探针全红** + 回归全绿 | 低 | ✅ **本轮**（新门 `tests/registry/lane_sources.test.ts`） |

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
| C4 | **G7 可达性门**（§12.5）：`src/` 下每个文件必须从某个**登记在册的根**可达，口径=棘轮 | 注入一个不可达文件 ⇒ 门红；根从 38 起算 | ⚠️ **前置**：先补全三类隐式边（动态 import / 字符串路径 / 手调 CLI）的扫描，否则门会**误报不可达**、诱导人删错 | ⏳ |
| C5 | **G9 lane 来源门**（P1c 新增）：归属只有一个来源；lane 文件 ↔ 线 id 配对；`LANE_OF` 不许回来 | **6/6 探针全红**（含"两条线 id 互换"这条上一版抓不到的） | 低 | ✅ **本轮**（`tests/registry/lane_sources.test.ts`，出生证见 §7） |

### D P2 拆 `src/tools/`（200 文件 / 71k 行，全仓 65%）—— **一族一提交**

> ★ **顺序（2026-09-28 二次裁定，已消除文档内冲突）**：**§10 品牌改名排在 D 之前** ——
> 理由见 §10.3（改名判据"除品牌串外逐字相同"在文件未移动时最可读；两者都触及几乎每个文件，不许交错）。
> ⇒ 实际执行顺序：**A ✅ → §10 改名 → D（P2）→ 建 G6/G7 → 剪枝收尾**。
> ★ 上一版写的是"A → B/C → §10 改名 → D"，但 §14.7 又写成 P2 在前 —— **两处矛盾已按 §10.3 统一**。
> （另：B/C 是"随做随清"的还债项，不构成 P2 的前置，故不占执行位。）

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
| G2 | `orphan_file` 里哪些是**真死代码** | 已取证并**剪掉 5 个零引用文件 / 387 行**（见 §11）；剩 7 个"只被自己的测试引用"待判；`view_inputs.ts` 是 README 明写的 R5 **文档化契约层**（"不受挂起影响，仍由 CI 守着"）⇒ **不删** | ✅ 部分完成（§11） |
| G3 | 四层规则表（`surfaces/features/kernel/dsl`）**何时切换** | 建议 P2 落地那一刻；现在换会让搬迁中间态全判违规 |
| G4 | B2 的结论（`refs_text` 是复用还是登记为不同维度） | 属工程判断，可直接做，结论记账即可 |
| G5 | **README 里全部工具计数与注册表同源**（§12.9）：现状 4 个口径不一 —— 真实 **67** / 「共注册」声称 **67** ✓ / 表里实际列 **58** / 三个小标题声称之和 **43** | 根因：`readme_tools_gate` **只守了「共注册 N 个」一个数**，其余 4 个数（3 小标题 + 表行数）无门 ⇒ 已漂。属工程判断（可直接做）：把自愈扩展到全部计数 | ⏳ |
| G6 | **根清单显式化 + 三桶输出**（§12.8）：A 被工具需要 235 / B 仅非工具面 66 / C 谁都不需要 16 | 与 G7 同批做；B 桶**必须存在且不剪**，否则会剪掉 CLI 面 | ⏳ |
| **G7** | ★★★ **宣传-实现一致性门**（§14.1/§14.5）：每个 action（`EXPLORE_ACTIONS` 等派发表）的**派发体必须真的调用实现**（非空壳） | 注入空壳 action ⇒ 门红；**当前应能抓出 5 个**（`derive_anim_flow`/`derive_algorithm` 空壳，`derive_split`/`derive_chain`/`check_monolith` 半空壳） | ⏳ **高优先**（这是"对 agent 说谎"） |
| **G8′** | 一致性测试的"工具名↔文件名"口径**须覆盖 camelCase 导出**（§14.4 盲区）；`INTERNAL_MODULES` 与 `tool-convergence.md` 的**陈旧声明**须与实现对齐（§14.3） | 把 `derive_anim_flow` 移出豁免 ⇒ 测试应报"未注册" | ⏳ |

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

### 10.4 ★ 无下游 ⇒ **不做兼容层**（2026-09-28 用户纠正，已采纳）

我起初的设计是"新名 + 旧名仍生效 + 弃用提示"（数据目录回退、环境变量回退）。**用户否掉了，理由成立**：

> "我们又没有下游，没有别人依赖我们，除了 DSH brain 通过 MCP 和桥接。"
> "已经失去了旧名，而且没有任何引用…没有引用的直接全都剪枝不就好了。留下这些东西干嘛。"

**核实结论：兼容层是为不存在的下游写脚手架。**
- 本仓**没有外部用户**；唯一的下游是 `dsh-brain`（走 MCP + 桥接），且用户已定"改完再重新桥"。
- 实测我预留的那批兼容代码（`DATA_DIR_NAME_LEGACY` / `DATA_DIR_NAMES` / 4 个 helper）
  **引用数全为 0** —— **出生即死代码**。已全部剪掉，`data_dir.ts` 现在只剩一个常量。

⇒ **改名 = 干净全量改**：

| 类别 | 改法 |
|---|---|
| 数据目录 `.design-canvas/` | 直接改常量值；**本地已有数据由使用者自己迁移或丢弃**（不是代码的责任） |
| 环境变量（`DC_*` / `DESIGN_CANVAS_*`） | 直接改名；不留旧名回退 |
| MCP server key / bin / 包名 / git remote | 直接改名 + 重桥 |
| `.design-canvas.json`（保护清单文件名） | 一并改名（属同族，之前"刻意不动"改为**一起改**） |

★ 提炼成纪律（与 playbook §8.1 呼应）：**兼容层必须有下游才配存在。**
判断"有没有下游"要**取证**（谁在用、怎么用），不是习惯性地留一手 ——
留一手的代价是**永久多背一份代码 + 一条永远没人走的路径**。

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
3. **给 `rename_symbols` 开"显式字面量对"入口**（§10.1）—— ⏳ **本轮未做，且我判断它不该挡在改名前面**。
   ⚠️ 这会**改到 inputSchema** ⇒ G1 会红，属**有意的契约变更**。
   ★ 理由：那是给**用户**的能力补齐（让工具能改用户自己项目里的品牌串），而本次改名是我们对**自己仓库**的开发者操作。
   脚本里用**显式排除表**（`allowFiles` / 生成物 / 门自身）复刻了 `decideLiteral` 那套判断（contract=人审 / history=保留 / 生成物跳过）。
   ⇒ 该能力补齐仍留在 §9 清单，但**与本次改名解耦**。
4. ~~**跑清单**，逐类决策~~ ✅（**10.8**：自写 `brand_inventory.mjs` 出全量清单，逐类显式决策）
5. ~~**改产物与契约**~~ ✅（**10.8**：package.json / README / AGENTS / MCP server key / `scripts/*.mjs` / 两个 go.mod / `.gitignore`）
6. ~~**不做兼容层**~~ ✅（`DATA_DIR_NAME` 直接改新值；环境变量直接改名；**无任何回退路径**）
7. **重桥**（用户已授权）—— ⏳ **下一笔**（属 ops 层，含 `dsh-brain` 配置 + 其数据目录迁移）
8. ~~验证~~ ✅（**10.8**：tsc / 8 门 73 项 / 全量回归 218 文件 2264 项 / Go build+test / 残留门 frozen 归 **0**）

> ⚠️ **`mcp__design-canvas__*` 的前缀**来自 client 配置的 **server key**，不是工具名 ⇒ 改它属于"配置层改名"，
> **与 P4-F1（改工具名）是两件事**；本节的改名**不动任何工具名**，工具集快照 G1 逐字保持。

---

### 10.8 ★★ 改名执行记录（2026-09-28）—— 代码层已完成，ops 层剩两步

**① 做法：有序映射 + 边界规则 + 生成物重算**（`brand_inventory.mjs` 先量 → `rename_brand.mjs` 执行）

| 旧形态 | 新名 | 命中 | 备注 |
|---|---|---|---|
| `design-canvas` | `agent-io` | 503 | 主体；`.design-canvas`→`.agent-io`、`design-canvas.json`→`agent-io.json` 由它**覆盖**（不另设 pattern） |
| `DESIGN_CANVAS` | `AGENT_IO` | 42 | 环境变量长形态（`DESIGN_CANVAS_HOME`→`AGENT_IO_HOME`） |
| `design_canvas` | `agent_io` | 5 | snake |
| `DesignCanvas` | `AgentIO` | 3 | Pascal |
| `DC_`（**独立前缀**） | `AGENT_IO_` | 64 | ★ **统一成一个**环境变量前缀（原先是 `DC_` 与 `DESIGN_CANVAS_` 两套） |

⇒ 合计 **176 文件 / 617 处**（553 品牌 + 64 环境变量），全部归 **0**。

- `DC_` 用**负向后视** `(?<![A-Za-z0-9_])DC_`：实测 11 个 `DC_*` 全是环境变量，但裸替会误伤 `SOME_DC_X`
  ⇒ 登记表新增 `regexPatterns` 字段（**需要边界的形态走正则**，不硬塞进 `patterns`）。
  ★ 出生证含**反向对照**：注入 `SOME_DC_X` ⇒ 门**应绿**（实测绿）——否则就是假阳。
- **生成物不手改**：`AGENTS.md` / `src/renderer/i18n_bundle.gen.ts` / `schema/endpoints.schema.json` /
  `package-lock.json` 四处**排除在替换之外**，改**生成器源码**后重算（`npm run build` / `npm run gen:schema` /
  `npm install --package-lock-only`）。★ 重算后残留 0 ⇒ 证明生成链完整。
- G1/G8 两份基线**恰好也被替换带到新名** ⇒ 我**另行用官方重算命令**（`UPDATE_TOOL_SNAPSHOT=1` /
  `UPDATE_TOOL_BEHAVIOR=1`）重算，**md5 与替换结果逐字相同** ⇒ 证明"文本替换 == 正规重算"。

**② ★★★ 一个改名时才暴露的「门盲区」（比改名本身更值钱的产出）**

本门原先只扫一张**扩展名白名单**（`TEXT_EXTS`）。实测有 **3 个文件既没被改名、门也照样绿**：

| 文件 | 为什么逃掉 |
|---|---|
| `.gitignore` | **没有扩展名** |
| `go-observe/go.mod` | `.mod` 不在白名单里 |
| `go-slim/go.mod` | 同上（**而且它的 `module` 行就是品牌**：`module design-canvas/go-slim`） |

⇒ 已改为**内容嗅探**（前 8KB 无 NUL ⇒ 当文本）。教训：**"手抄的清单"代替"可判定的规则"
—— 这就是本项目的病根，它连门自己都没放过。** 出生证 4/4（含反向对照）。

**③ ★★★ 对 §10.4「无下游」前提的实质修正**（这是本轮最重要的判断修正）

我在 §10.4 写"**本项目没有外部用户**，唯一的下游是 dsh-brain" —— **不准确**。实测 `D:\project_develop` 下：

| 下游 | 耦合方式 | 改名后是否需要动作 |
|---|---|---|
| `dsh-brain` | MCP 桥接（client 配置里的 **server key**）+ 它自己工程根下的 `.design-canvas/` 数据 + `scripts/probe-dc-*.mjs` | ★ **必须重桥**；其旧数据留在 `.design-canvas/`（迁移或丢弃，由使用者定） |
| `dsl-workbench` | HTTP 拉本仓 `/api/*`；`gen:schema` 的**镜像目标**；README/文案引用品牌 | 路径与端口不变 ⇒ 仅文案/文档层面的品牌同步 |
| `elv` | ★ `incremental_fill.js` **按路径 import 本仓 dist**（`../design-canvas/dist/src/translate/*.js`） | **目录名不变 ⇒ 不断**；无品牌串逻辑 |
| `ai-config/skills/design-canvas-mind` | 一个**技能包**（目录名 + SKILL.md 引用品牌） | 要改名需重命名该 skill 目录 |
| `_*`/`ai-base` 等 | 实验副本 / arena 快照 | 不受影响 |

⇒ **但结论"不做兼容层"仍然成立**（§10.4 的判断对，理由要换）：没有下游**依赖旧名继续可用** ——
四个使用方都是**自家工程**，可以一次性同步过去。**兼容层是为"无法同时升级的外部方"准备的，这里没有那种方。**
★ 教训：我把"**不需要兼容层**"直接写成了"**没有下游**"两步合一，而这两步的取证强度完全不同。

**④ 有意不改的三处（写进登记表 `note`，不是遗漏）**
- **`dc-` 小写短形态**：它已不是品牌契约，而是三种东西 —— `os.tmpdir()` 前缀（`dc-beh-*` 等，~30 处）、
  renderer 的 CSS 类与 localStorage 键（`dc-tab`/`dc-lang`/`dc-view`）、以及**别的仓库**里的 `probe-dc-*.mjs` 文件名。
  ⇒ 改它零功能收益，且会把文档指向**不存在的文件**。
- **`docs/` 里引用 dsh-brain 侧 `probe-dc-*.mjs` 的行文**（同上理由）。
- **本地目录名 `D:\project_develop\design-canvas` 与 GitHub 仓库 `xr192172/design-canvas`** ⇒ **ops 层**，
  不在代码改名范围（改本目录会立刻断掉会话路径与 DSH 桥接；改远端仓库名需要 GitHub 凭据 —— `gh` token 当前**已失效**）。
  ⚠️ 因此 `package.json` 的 `repository`/`bugs`/`homepage` **已指向 `xr192172/agent-io`**，该 URL **在远端仓库改名之前是 404**
  —— 这是**有意的中间态**，登记在此。

**⑤ ★ 一个副作用值得记：改名会 un-hide 被旧 ignore 规则遮住的东西**
`.gitignore` 里 `.design-canvas/` 与 `design-canvas.json` 是**无路径前缀**的规则（匹配任意层级）。
改名后规则变成 `.agent-io/` / `agent-io.json` ⇒ 原先被遮住的两处**立刻出现在 `git status`**：
- 根 `design-canvas.json` = **本仓自己的活态 DSL**（`getLiveDslPath()`）⇒ 已 `mv` 成 `agent-io.json`（数据迁移）；
- `src/.design-canvas/cache.db`（163KB，今早某次把 `src/` 当目标项目的运行留下的**游离缓存**）⇒ 已删。
⇒ 提醒：**任何"重命名被 ignore 的产物名"都会改变工作树的可见面**，改名收尾时要专门看一眼 `git status` 的 untracked。

**⑥ 验收**
`tsc --noEmit` 干净 ｜ 8 个门文件 **73 项全绿** ｜ 全量回归 **217 文件通过 / 1 跳过；2259 项通过 / 5 跳过** ｜
品牌残留门 `frozen` 归 **0**（本门自本日起**零容忍**）｜ Go：`go build ./...` ×2 + `go test ./...` 全过 ｜
新门出生证 **4/4**（含反向对照）。

---

## 11. 剪枝：真死代码（2026-09-28，用户授权"没有引用的直接全都剪枝"）

### 11.1 用户纠正了两件我做过头的事

> "那个设计并不是我提出来的，而是你自己说的，你真的觉得这个设计有必要存在？已经失去了旧名，
> 而且没有任何引用，你直接把它全部重命名为同样的，或者是说没有引用的直接全都剪枝不就好了。
> 留下这些东西干嘛，**我们又没有下游**，没有别人依赖我们，除了 DSH brain 通过 MCP 和桥接。"

1. **兼容层是为不存在的下游写的脚手架** ⇒ 已在 §10.4 撤销，并把 `data_dir.ts` 里我预留的
   `DATA_DIR_NAME_LEGACY` / `DATA_DIR_NAMES` / 4 个 helper **全部剪掉**（实测引用数**全为 0** ⇒ 出生即死代码）。
   ⇒ **纪律：兼容层必须有下游才配存在；判断"有没有下游"要取证，不是习惯性留一手。**
2. **该剪的没剪**：`orphan_file` 报了 16–18 个，我此前一直挂着"删除不可逆"没动。经取证后本轮开始剪。

### 11.2 取证方法（★ 我前三轮查错了三次，方法与教训都记下）

判"有没有引用"必须**按模块说明符**查，且**要覆盖后缀变体**：

```bash
# 对每个候选模块 m：
grep -rIn "['\"][^'\"]*/$m\(\.js\)\?['\"]" src tests --include=*.ts --include=*.mjs
```

◾ 踩过的**四个**坑（都会导致误判 ⇒ 我实际误删过一次，见下）：
- **按 basename 裸查** ⇒ 噪声极大（`daemon`/`serve` 这种词到处都是）；
- **只查 `src`** ⇒ 漏掉"只被测试引用"这一类（那同样不是活代码，但是**另一类**）；
- **只查带 `.js` 的说明符** ⇒ 本仓**测试里的 import 有的写 `.js`、有的不写** ⇒ 会漏掉一半引用，**删错就炸**；
- ★★ **barrel（`index.ts`）的引用形式是"目录说明符"** —— `from '../../src/observe'`，
  **说明符里根本不出现 `index`**。按文件名查 barrel ⇒ 必然漏。
  **本条是实测踩到的**：我把 `src/observe/index.ts` 当成零引用删了，全量回归立刻报
  `Failed to load url ../../src/observe`（`tests/observe/observe.test.ts` 收集失败、-9 个测试）。
  ⇒ 判 barrel 死活必须**按目录名**查：`grep -rIn "['\"][^'\"]*/<dir>['\"]" src tests`
  （补查后：`observe` 有引用 ⇒ **已还原**；`java_refactor` 零引用 ⇒ 删除正确）。
- 另：**不要**用 `grep -c "import"` 这种"数含 import 字样的行"当引用数 —— 那是噪声不是证据。

### 11.3 本轮剪掉的（**真零引用**：src、测试、字符串、目录说明符四处都没有）**4 个 / 375 行**

| 文件 | 行数 | 最后改动 |
|---|---|---|
| `src/tools/derive_reasoning.ts` | 285 | 2026-09-08 |
| `src/observe/online_loader/probe_boot.mjs` | 19 | 2026-09-08 |
| `src/observe/online_loader/sink_only.mjs` | 13 | 2026-09-08 |
| `src/java_refactor/index.ts` | 18 | 2026-09-08 |

删后 `tsc --noEmit` **0 错误** —— 这本身就是"它们确实是死代码"的第二个证据。
★ **`src/observe/index.ts`（52 行）曾被我误删，已还原**（根因见 §11.2 第四条坑）。
**这一步的净收益因此从 5 个缩到 4 个 —— 如实记账，不粉饰。**

### 11.3b 顺带发现：目录名**嵌在更长串里**的形态（我漏掉的一类）

`.design-canvas/` 作为**前缀**出现在更长字面量里，我的单点化脚本没覆盖（只换了独立字面量）：

```
src/observe/instrument.ts:130  const BACKUP_DIR = '.design-canvas/observe-backup';
src/observe/instrument.ts:133  const LEDGER_FILE = '.design-canvas/observe-ledger.json';
src/tools/harvest_closure.ts:199  r.path.startsWith('.design-canvas/')
src/tools/reconcile_{brick,chain,effects}.ts  ['.agent/observe', '.design-canvas/observe']
```

- **6 处**，已列入改名待办（品牌残留门仍覆盖它们，不会漏网，只是没享受"改一处"的便利）。
- ★ 附带发现：代码里**已经存在 `.agent/observe` 这个既有变体** —— 与改名目标 `AgentIO` 遥相呼应，
  说明当时的命名已经在往 `.agent` 漂。改名时正好收敛掉。

### 11.4 待判（7 个：**只被自己的测试引用** ⇒ 测试自舔，不是活代码）

`refactor_report.ts`(86) / `run_narrate.ts`(40) / `batch_ops.ts`(103) / `derive_anim_flow.ts`(492) /
`observe_chain_view.ts`(175) / `list_features.ts`(33) / `get_dsl.ts`(32)
—— 每个都只被一个测试文件 import。删它们要**连测试一起删**，属"删测试"的决策，单独一批处理。

### 11.5 ★ 明确**不删**：`src/tools/view_inputs.ts`(140)

它同样只被自己的测试 import，**但** README 第 325 行明写：
> 对外契约（`/api/archify-demo`）与**中性数据层（`view_inputs.ts`）不受挂起影响，仍由 CI 守着**。

⇒ 它是 R5 挂起线的**文档化契约层**，是**有意保留**的表面。
★ **教训：`orphan_file` 只回答"没有 import 边"，它不回答"该不该删"。** 判死代码前必须查
文档/契约里有没有点名保留它 —— 这与 P0-② 的可达根是同一类问题（**静态边看不见的用途**）。

### 11.6 G2 更新

§9-G2 从"待确认"改为**部分完成**：16 个孤儿里已剪 5 个真死的、1 个文档化契约明确保留、
7 个"只被测试引用"另立一批、其余（`daemon.ts`/`serve.ts` 等）其实是**可达根**
（探针没传 `reachableRoots` 才误报 —— 反证 P0-② 生效）。

---

## 12. ★ 剪枝的正确做法：**按入口做可达闭包**（用户提出，实测更优）

用户提议：**"直接统计一下工具，然后一个一个地去每个工具的剪，只剪它的唯一一条链路。
然后只保证这个工具功能完成就可以，就是不退化即可"** —— 并追问"这样剪枝会不会导致整个项目退化，
或者更难管理"。实测结论：**这个方式比我一直在用的 `orphan_file` 更对**，理由与代价都记在这里。

### 12.1 为什么 `orphan_file` 不够：它只报叶子，看不见整棵死子树

`orphan_file` 的定义是"**没有 importer**"——一个**局部**性质。于是：

> A 引用 B，而 A 没人引用 ⇒ **A 被报、B 不被报**，但 **B 也是死的**。

⇒ 按 `orphan_file` 逐条剪 = **割草不除根**。而"从入口做正向可达闭包"是**全局**性质，
闭包外的**整棵子树**一起暴露。

### 12.2 实测数据（同一份 src，两种判据对比）

| 判据 | 候选数 |
|---|---|
| `orphan_file`（去掉可达根后） | 16 个 |
| **可达闭包之外** | **16 个文件 / 2,377 行** |

两者**不是同一个集合**：闭包抓到了 `orphan_file` **没报**的整棵子树 ——
`observe/tiered.ts`(321) / `observe/trace.ts`(217) / `observe/export_incident.ts`(169) /
`version_upgrade/rewrite.ts`(139) / `version_upgrade/gate.ts`(87)（这 5 个有 importer，故不是孤儿，
但它们的 importer 本身不可达）。

**工具统计（从真实注册表读）**：67 个 —— observe 13 / cross 5 / design 12 / meta 9 / refactor 19 / harvest 9。

### 12.3 ★★ 代价：**根清单必须完整**，否则会剪掉真在用的东西（实测踩到）

第一版我**只把 `package.json` 的 bin/scripts 当根**（23 个）⇒ 闭包外虚报 **26** 个，
其中赫然包括 **7 个 `*_cli.ts`**（`health_cli` / `impact_cli` / `behavior_cli` / `hybrid_cli` /
`cross_repo_cli` / `upgrade_cli` / `refactor_judge_cli`）—— 而 `health_cli` **是我这半小时一直在用的量具**
（README 与规划书 §8 都写着 `node dist/src/tools/health_cli.js src`）。
**它们没登记进 package.json，但确实是人手动调用的入口。**

补齐后：根 **23 → 38**，闭包外 **26 → 16**（虚高的 10 个全是真入口）。

⇒ **三类"静态查看不见"的边，根清单必须显式覆盖**：

| # | 类别 | 实例 |
|---|---|---|
| 1 | **动态 `import()`** | 实测 **16 条**（含 2 条模板串假阳：`./${importName}`、`./x`）。AST 的 import 边**看不见**这一类 ⇒ 纯 AST 闭包会**少收**文件 ⇒ 会**多剪** |
| 2 | **字符串路径**（生成脚本按路径读源码） | `scripts/gen_anim_core_bundle.mjs` 读 `src/renderer/dataflow_core.ts` —— 它出现在我的闭包外，说明我的字符串扫描**模式不全**（该脚本大概用 `'../src/...'` 相对写法） |
| 3 | **人手动调用的 CLI** | 上述 7 个 `*_cli.ts`：不在 package.json，但在 README/规划书里 |

### 12.4 回答"会不会退化 / 更难管理"

- **会不会退化？** 保留链路上的代码**一行不动** ⇒ 不动就不退化。
  真正的风险只有一个：**根清单不全 ⇒ 误删**。而它可防：
  ① 根清单**显式登记、可审**；② `tsc` + 全量回归兜底；
  ③ ★ **逐工具验收**（用户提的）：每个工具跑一次 smoke，输出不退化 ⇒ 这条链就没被剪坏。
- **会不会更难管理？** ★ **反而更好管** —— 把"什么还有用"从
  "**人工判 14 个孤儿**（还要逐个回想它有没有被文档点名）"变成
  "**从 38 个根可达**"，后者是一个**可自动判、可加门**的性质。
  代价是**多了一份必须维护的根清单** —— 但它是**显式、可审**的，比隐式依赖好。

### 12.5 建议的新门（G7，待建）

**可达性门**：`src/` 下每个文件必须**从某个登记在册的根可达**，否则报红。
- 根清单 = `package.json` 入口 ∪ `*_cli.ts` ∪ MCP/daemon ∪ 文档点名的契约层 ∪ 生成脚本按路径读的源文件。
- 口径照 G4/品牌门：**棘轮**（现有 16 个冻结，新增即红），随剪枝逐笔收紧到 0。
- 收益：从此**"删干净了没有"是可判的**，而不再依赖一次性人工盘点。
- ⚠️ 前置：先把三类隐式边（§12.3）的扫描补全 —— 否则门会**误报不可达**，
  那比没有门更糟（会诱导人删错东西）。

### 12.6 待判：7 个"只被自己的测试引用"

`derive_anim_flow`(492) / `observe_chain_view`(175) / `batch_ops`(103) / `refactor_report`(86) /
`run_narrate`(40) / `list_features`(33) / `get_dsl`(32) —— 它们在**生产闭包外但在测试里**（测试是另一种根）。
删它们要连测试一起删，属"删测试"决策，单独一批。
★ 注意 `get_dsl.ts` / `list_features.ts` 这类"**工具名还在、文件已废**"的残留（工具 `get_dsl` 的
handler 早已指向 `queryFeature`）—— 这正是"按工具链路"判据的强项：**它不在任何工具链路上**。

### 12.7 顺带回答：注册表重构（除改名外）完成了吗

| 步 | 内容 | 状态 |
|---|---|---|
| P1a | 抽 `registry/{types,plumbing,handlers}.ts`（解除循环依赖） | ✅ `4737f5b` |
| P1b | `TOOL_DEFS` 按 lane 切 `registry/lanes/*.ts`（3,591 → **574** 行） | ✅ `a49e7a5` |
| **P1c** | `capability_map.LANE_OF` 改为**派生** + 「lane 文件 ↔ 归属一致」门 | ✅ **本轮**（`LANE_OF` 已删；新门 6/6 探针全红） |
| P2 | `src/tools/` 200 文件搬迁（族级，一族一提交） | ⏳ 未做 |
| P2-D4 | 工具定义 → `features/<lane>`（与 `registry/lanes` 对齐） | ⏳ 未做 |

⇒ **注册表本体拆完了**（3,591→574 行、lane 化、G1 契约不变），**P1c 也已完成**（归属单点化）；
`src/tools/` 的大搬迁（P2）尚未开始。

### 12.8 逐工具推进的实测（用户要求"逐工具推"）：**根必须分类**，否则会掩盖工具的冗余

用户追问："你直接全闭包算闭包的话是不是还是会算错？但是你直接搜这个工具的整个链路，
那这样的话其实 B 包也不会算错" —— 分两点回答，都对，但要精确：

**（一）集合上两者等价，逐工具的价值在"可解释 + 可验收"，不在"更准"。**
从同一组根出发，**逐工具闭包的并集 == 平铺全闭包**（数学上等价）。
逐工具真正多出来的是：
1. 能说清"这个文件是**哪个工具**需要的"（平铺闭包只告诉你"有人需要"）；
2. ★ 能给出**逐工具验收**（每个工具 smoke 一次，输出不退化）—— 这是平铺闭包给不了的；
3. ★ 能把"根"从混杂的 38 个**收敛成 67 个工具根**，于是"没有任何工具需要它"成为一个**尖锐判据**。

**（二）"B 包也不会算错"——对，但前提是"工具根"解析正确。**
他说的"B 包"（引用链中间的死文件）在逐工具闭包里天然进不来 ✓。
但★ **逐工具最容易错的地方正是 handler 的解析**：实测我第一版把
`handler: wrapData(async (a) => toolFn(a))` 里的 **`wrapData`（包装器）当成了实现** ⇒
**A = 0**、67 个工具全部解析失败。
修正为"取 handler 表达式里**所有**能解析到模块的标识符（lane 内定义 或 lane 的 import 表里有）"后：

| 桶 | 文件数 | 含义 |
|---|---|---|
| **A** | **235** | 被 **≥1 个工具**需要 |
| **B** | **66** | **不被任何工具需要**，但被非工具根需要（CLI / daemon / 生成脚本 / 文档契约） |
| **C** | **16 / 2,377 行** | 谁都不需要 ⇒ **真剪候选** |

★ **关键修正：根必须分类。** 平铺全闭包只回答"可达"，于是 B 类（66 个）会被**混进"可达"里消失** ——
而 B 类恰恰是"工具其实不需要、只是别的表面在用"的那一层：**只看闭包看不出工具的冗余。**
⇒ 输出必须**分三桶报**，而不是一个"闭包外"列表。

**（三）两者共同的前提仍是"根清单完整"**（§12.3 的三类隐式边）。逐工具**同样会错**，
只是错法不同：它会把"只被人手动调用的 CLI 需要的文件"标成"无工具需要" ⇒ 若照此剪，会**剪掉 CLI 面**。
⇒ B 桶必须存在且不剪。

### 12.9 顺带查实：用户指出的"工具数对不上"是真的，但**不是别名**问题

| 口径 | 数 |
|---|---|
| `TOOL_DEFS` 真实注册 | **67** |
| README「共注册 **N 个**」声称 | **67** ✓（门守着，一致） |
| README 工具表里**实际列了** | **58** |
| README 三个小标题**声称之和** | 1（能力导航）+ 8（主工具）+ 34（专项）= **43** |
| `capability_map` 归线 | **67 / 67**（零未归线、零陈旧标注） |

- **不是别名 / 同职责工具没收纳**：`capability_map` 归线 67/67，无未归线、无陈旧标注；
  仓内也没有别名机制（旧别名已于 2026-08-17 全部移除）。
- 真实原因是**同一份 README 内部数字分叉**：67（真实）/ 58（表列）/ 43（小标题声称）。
- ★ **67 − 58 = 9，正好等于 `readme_tools_gate` 报的"零提及"名单那 9 个**（memory_observe /
  memory_targets / translate_go_ts / go_originals / recommend_observe_points / move_symbol /
  list_snapshots / rollback_snapshot / index_integrity）⇒ 两处独立证据吻合。
- ★★ 根因：**`readme_tools_gate` 只守了「共注册 N 个」这**一个**数字**，
  同一份 README 里的另外 4 个工具计数（3 个小标题 + 表行数）**没有任何门在管** ⇒ 早就漂了。
  **这是"门只盯一个数"的典型盲区**，与 §2d 那条纪律同源。

**待办（新增 §9-G5）**：把 `readme_tools_gate` 的"数字自愈"扩展到 README 里**全部**工具计数
（3 个小标题 + 表行数 + 零提及名单），让它们与真实注册表**同源**；否则这几个数会继续漂。

### 12.10 ★ G8 已落地：**逐工具行为快照**（"不退化即可"的机器判据）

用户对重构验收的原话：
> "一个一个地去每个工具的剪，只剪它的唯一一条链路，然后**只保证这个工具功能完成就可以，
>  就是不退化即可"

⇒ 把这条落成 **`tests/tool_behavior_snapshot.test.ts`（G8）**：
66 个工具（排除 `run_tests`——无参会跑整个套件、120s+）用 `{}` 调一次，
**规范化后的输出**必须与基线 `tests/fixtures/tool_behavior_snapshot.json` 逐字相同。

- **可行性已实测**：66 个工具**连调两次，规范化后输出逐字一致（0 处漂移）** ⇒ 基线可当判据。
- 基线规模：66 工具 / 59,334 字符 / 108KB。
- **规范化只抹"本来就会变"的**，每项都写明了理由：绝对路径 / ISO 时间戳 / 耗时 / pid·端口 / 长 hex hash。
  并配"规范化器自身有效"的单测（抹该抹的、**保留工具名·错误信息·计数**）。
- **变了就红（不是棘轮）**：本门守的是**行为等价**，不是"减债"。
  行为变化**要么是 bug（红），要么是有意的改进（显式 `UPDATE_TOOL_BEHAVIOR=1` 并记账）**，没有第三种。
- **出生证已验证**：篡改基线 ⇒ 门红并**指名工具 + 首次分歧偏移**（`get_dsl: 输出在 @22 处分歧`）。
  ★ 第一次出生证**失败**了（我篡改的字符串只在**描述**里、不在该工具的 `{}` 输出里 ⇒ `replace` 是空操作）
  —— 记下来：**"我改了个东西"必须验证"那个东西真的在被观测的范围内"**。

★ 与 G1 的分工：**G1 守对外契约（名字/描述/schema）；G8 守行为（输出）**。剪枝/搬迁/改名都跑两者。

★ 顺带一个发现（与 Serena 对照那条"结果长度上限"呼应）：
`harvest_decisions` 无参调用一次吐 **47,939 字符**，而 66 个工具的输出中位数只有 **62**
（合计 59,334 —— 它一个占 81%）。⇒ 它是 §9 里"结果长度上限"那条的**首选目标**。

### 12.11 当前进度：逐工具的"测绘完成，改造未开始"

| 项 | 状态 |
|---|---|
| 67 个工具的**链路测绘**（A235 / B66 / C16 三桶） | ✅ 完成 67/67 |
| 逐工具**行为基线**（G8） | ✅ 完成 66/66 |
| 逐工具**改造/剪枝** | ⏳ **0/67**（尚未开始） |
| 注册表结构重构 P1a/P1b/**P1c** | ✅ **三项全完成** |
| P2（`src/tools` 大搬迁）、§10（品牌改名） | ⏳ 未开始 |

⇒ **之前 15 笔提交全在结构层，没有"改过任何一个工具"。** 下一批开始就是真正逐工具推进。

### 12.12 ★★ G8 的第一版**被全量回归打红了**，而两处失败都是**真红**（诚实记账 + 设计修正）

G8 单独跑是绿的，但**并入全量套件后红了 2 个文件**。查清后：两处都不是"抖动"，是**设计错**。

**失败 ①：品牌门报"新增旧名出现处" = 新基线文件自身**
`tests/fixtures/tool_behavior_snapshot.json` 里含 `capability_map` 的输出，而它**列出 67 个工具（含描述）**
—— 描述里有品牌串 ⇒ 它是"新增的旧名出现处"。
处置：**并入棘轮基线**（`UPDATE_BRAND_RESIDUE=1`），与 `tool_set_snapshot.json` 同款处理 ✓（不是白名单，是存量）。

**失败 ②：G8 报 `harvest_decisions` 行为变化 —— 180 → 182 条决策候选**
根因：**它扫 `docs/` 与 git log**，而我**刚往规划书加了 2 节** ⇒ 它多检出 2 条（doc 178 → 180）。
⇒ ★★ **这不是 bug，是它在正确地测量仓库。** 拿字节快照去钉它 = 把"文档不能改"写成契约。

**设计修正：G8 拆成两类**
| 类 | 成员 | 判据 |
|---|---|---|
| **S1 稳定集** | 65 个工具 | **字节快照**（规范化后逐字相同） |
| **S2 测量集** | `harvest_decisions` 等 | **只做结构断言**（能跑通、非空、不抛异常、报告形态在）＋ 显式登记理由 |

★ 提炼成纪律：**一个"随被测对象变化"的读数，不能当"不变"的判据** —— 与 G5 那条
（"两种状态读数相同的指标不是判据"）**互为镜像**：
· G5 治**饱和**（该变却不变）；· 本节治**漂移**（不该变却随对象变）。
两者都要求：**先问"这个读数在什么条件下才该变"**。

★ 另一条过程教训（第一次出生证失败的同源问题）：**"我改了个东西" ≠ "那个东西在被观测范围内"**。
本次是我改的**文档**改了**工具输出**，而我以为改文档跟工具行为无关 —— 两层间接。

**验证**：G8 3 项 / 品牌门 4 项过了，且**并入全量套件后仍全绿**（213 文件 / 2229 测试）。
—— 单独绿不算数，**必须在套件上下文里也绿**（本次失败正是只在套件里出现）。

---

## 13. 剪枝第二批：死子系统（963 行实现 + 219 行测试）—— ★ 并暴露我取证脚本的两个坑

按 §12 的可达闭包做，**从 C 桶逐个取证**。本批净删 **963 行实现 + 219 行测试**。

### 13.1 剪掉什么（附判定依据）

| 文件 | 行数 | 判定依据 |
|---|---|---|
| `src/observe/online_loader/{loader,bootstrap,transform_scope}.mjs` + `_sample/main.mjs` | 263 | 真实 import 图里**零 importer**（含 tests/scripts）；`bootstrap` 的其它命中全是**无关的"冷启 bootstrap"概念**，不是文件引用 |
| `src/observe/{tiered,trace,export_incident}.ts` | 704 | 自称"v2 分级采集 runtime（对齐 `go-observe/probe`）"，但**从未接线**：全仓唯一消费者是 `observe/index.ts` 的再导出（barrel 再导出 ≠ 使用） |
| `tests/observe/observe_v2_runtime.test.ts` | 219 | 它是上面三个的**唯一真实消费者**（直接 import）⇒ 属"只被测试引用的子系统" |

★ **`observe/index.ts` 保留**：它是 TS 侧契约 barrel，`tests/observe/observe.test.ts` 用着它的
`probe` / `contract` 符号（但**没用** tiered/trace/export_incident）⇒ 只摘掉那三条再导出。
★ Go 侧（`go-observe/probe/tiered.go` 等）**仍在用** —— 死的是这份 **TS 移植**，不是那个概念。

### 13.2 ★★ 为什么"可达闭包"比 `orphan_file` 强 —— 本批的实证

`observe` 那三个文件**有 importer**（彼此 + `index.ts`）⇒ `orphan_file` **完全看不见它们**。
它们是一整簇**自洽的死子树**，只有从入口做正向闭包才会整簇暴露。
⇒ 与 §12.1 的推论一致，本批是它的**第一次实战兑现**。

### 13.3 ★★ 我取证脚本的两个坑（都导致误判，都记下来）

**坑 1：verdict 的显示顺序把信息藏了。**
我的脚本判定写的是"有 src importer ⇒ 只显示 src"，于是
`src/observe/{tiered,trace}.ts` 显示成"★ 有 src importer"，**测试的引用被吞掉了**
⇒ 我据此以为"没有测试消费者"，删完才在套件里撞见 `observe_v2_runtime.test.ts`（219 行）。
★ 教训：**取证脚本的"呈现"本身必须保留全部证据**，不能为了可读性做优先级取舍 ——
**被藏起来的那一条，恰好就是决定性的那一条。**

**坑 2：文本模式对短名/通用名完全不适用。**
我用"目录串/裸名"做模式时，`main` 匹配到一堆 `'./main.js'`、`dir-barrel` 匹配到 `'./tools'` 这种
**目录**引用 ⇒ 满屏假阳。第 5 次踩同类坑。
★ 结论：**判"有没有引用"只能用真实 import 图**（解析后的边），**不能用文本模式**。
唯一仍需文本的地方是"**字符串路径**"（如生成脚本按路径读源码），那必须**单独一类、单独确认**。

### 13.4 ★ 根清单补上一个缺口（§12.3 第 2 类的实证）

`src/renderer/dataflow_core.ts`(393) 被列在闭包外，但它**确实是 build 输入**：
`scripts/gen_anim_core_bundle.mjs` 读它生成 `dataflow_core_bundle.gen.ts`。
我的根扫描漏它，是因为脚本里写的是**裸文件名** `'dataflow_core.ts'`（与目录 `join` 后才成路径）——
我的模式只认含 `src/` 的串。
⇒ **`dataflow_core.ts` 补进根清单，不剪。** 这就是 §12.3 "字符串路径"那条的实例。

### 13.5 G8 的测量集扩员（经验分类，不靠猜）

本批删 7 个文件后 G8 又红：**`index_integrity`**（索引自检 ⇒ 量本仓文件集）。
⇒ 我做了一次**扰动实验**（往 `src/` 加临时文件 / 往 `docs/` 加一行，看哪些工具输出变）：
测出 `index_integrity` 随 src 变，但 **docs 扰动太弱**（只加了一行 HTML 注释）**没能**触发
`harvest_decisions`（它是加了两**节**真内容才变的）。
⇒ **测量集 = 两者的并集**，证据来源不同（一个来自扰动实验，一个来自全量套件）；
且**实验能确认成员，不能证明"不在集合里就稳定"** ⇒ 集合必须**经验 + 登记**双轨。
G8 基线因此收为 **64 个工具**（66 − 2）。

### 13.6 验证

tsc **0 错误**（这也是"它们确实是死代码"的第二个证据）；
五门（G1/G4/G5/G8/品牌）**39 项全过**；全量回归见台账末尾。

---

## 14. ★★★★ 用户指出的"中间态工具"—— 推翻了我"无 importer ⇒ 死"的判据（本笔最重要的发现）

用户原话：
> "有没有可能他们是被编排过的工具。**没有被纳入工具注册里面，就是属于是中间态工具**，
>  它们**能完成它们名字上所指示的功能吗**？你存一下，就你翻一下上一版的 Git，然后用一下试一下。"

**做法**：① 把已删的 observe 批从 git 取回存档（会话工作区 `.inspect/prune-archive/`，8 文件）；
② 翻 git / 文档 / 测试；③ **真跑一遍**（工具面 vs 直接调实现）。

### 14.1 ★★★ 铁证：`explore_code` 有 5 个 action 是空壳或半空壳（且**都对 LLM 公开宣传**）

`EXPLORE_ACTIONS` 是 `explore_code` 的 `action` 枚举 ⇒ **它宣传什么，LLM 就能看到什么**。逐个看派发体：

| action | 派发体实际做什么 | 判定 |
|---|---|---|
| `derive_anim_flow` | `const r = { project_dir }` → `return toResult(r, true)` | **空壳**（没调实现） |
| `derive_algorithm` | 同上 | **空壳** |
| `derive_split` | `buildSplitPreviewDsl(project_dir, **[]**, 300, 600)` —— 文件列表**硬编码空数组** | 半空壳 |
| `derive_chain` | `buildCallGraph(**[]**, **[]**)` —— 两个参数都是**空数组** | 半空壳 |
| `check_monolith` | `assessLines(**0**, 300, 600)` —— 行号**硬编码 0** | 半空壳 |
| 其余 10 个（search/read/diff_impact/arch_layer/guided_tour/derive_mind_map/inject_replay/run_simulation/reset_simulation/watch） | 真调实现 ✓ | 正常 |

**实测走工具面的输出**（一字不改）：

```
$ explore_code(action=derive_anim_flow, project_dir=<src>)
异步 action 已完成
---DATA---
{"project_dir":"D:/project_develop/design-canvas/src"}
```

★★★ **它说"异步 action 已完成"，却什么都没做。** 这不是死代码 —— 这是**对 agent 的主动误导**。
（直接调被孤立的实现 `deriveAnimFlow({...})` ⇒ 它**是活的**，会走到业务逻辑并报"feature 不存在，请先 create_feature"。）

⇒ **若按我原来的判据（无 importer ⇒ 删）执行，就会删掉一个"对外宣传过的 action"的唯一实现，把谎言钉死。**
**用户这项质疑救了它。**

### 14.2 ★★ 但要区分三类 —— 不是所有"无 importer"都该留

| 类 | 成员 | 依据 | 处置 |
|---|---|---|---|
| **A 被宣传 + 有实现（接线断了）** | `derive_anim_flow.ts`(492)、`derive_algorithm.ts`(190) | 在 `EXPLORE_ACTIONS` 里；实现活着 | **修接线 或 撤销宣传**（二者择一，**不能删实现**） |
| **B 被取代（功能已迁移）** | `get_dsl.ts`(32)、`list_features.ts`(33) | `query_feature.ts:4` 逐字"合并原 9 个查询工具（get_dsl / list_features / …）"；实测它用的是 `storage.listFeatures`，**不是** `tools/list_features.ts` | 真残留 ⇒ 可删（连同其测试） |
| **C 零宣传零引用** | `batch_ops.ts`(103)、`refactor_report.ts`(86) | 在 `registry/lanes/*`、README、AGENTS、`explore_code` 里**零命中** | 真残留 ⇒ 可删 |
| **D 有设计文档但"从未被采纳"** | `observe/{tiered,trace,export_incident}`、`online_loader/*` | ★ `docs/observe-point-recommender.md:71` 逐字：**"（judge / chain / tiered 已有雏形，但从未被采纳）"**；`observe-line-triage.md` 把"展示/叙事类"列为**建议归档**对象 | 已删（`c416533`）—— **文档依据成立**，且 git + 存档两手都有 |
| **E 同族待判** | `run_narrate.ts`(40)、`observe_chain_view.ts`(175) | 被 `observe-line-triage.md` 列入"展示/叙事类"（建议归档），但**没有工具面宣传** | 倾向删，但需确认无 action 引用 |

### 14.3 ★ 顺带查实两处**陈旧声明**（文档/测试与现实不符）

1. `docs/tool-convergence.md:272` 与 `tests/server_registry.consistency.test.ts:23-24` 都写着
   "**`list_features` 是 `get_dsl` query=features 的实现**"。
   **实测：不成立** —— `query_feature.ts:35` 用 `getDSLByView, listFeatures as listStoredFeatures`
   **from `../storage.js`**；`tools/list_features.ts` 无消费者。
   ⇒ 这条声明是 convergence 之后遗留的**陈旧注释**，**误导了本次判定**（差点让我以为它是活的）。
2. `INTERNAL_MODULES`（同测试的豁免表）里列着 `derive_reasoning` —— 而它**零引用**（已删）。
   ⇒ 豁免表同样陈旧。

### 14.4 ★★ 一致性测试的**盲区**（第 N 次"门看不见某类问题"）

`tests/server_registry.consistency.test.ts` 的漏注册检测口径是：
**`src/tools/{x}.ts` 且 `export function {x}()`**（文件名与函数名**严格同名**）。
⇒ 而 `derive_anim_flow.ts` 导出的是 **`deriveAnimFlow`（camelCase）** ⇒ **不匹配 ⇒ 完全漏检**。
这就是 `derive_anim_flow`/`derive_algorithm` 这类"实现了但没接线"能长期潜伏的机制。

### 14.5 本笔**不删任何东西**（撤回原计划的第三批），并新增两个待办

| # | 事项 | 判据 |
|---|---|---|
| **§9-G7 ★ 宣传-实现一致性门** | 对**每个** action（`EXPLORE_ACTIONS` 等派发表）断言：派发体**真的调用了实现**（非空壳）；且 action 清单里每个名字都有可达实现 | 注入一个空壳 action ⇒ 门红；当前应能抓出 5 个（§14.1） |
| **§9-G8** | 一致性测试的"工具名 ↔ 文件名"口径须**覆盖 camelCase 导出**（现在漏检，见 §14.4）；`INTERNAL_MODULES` 与 `tool-convergence.md` 的陈旧声明要**与实现对齐** | 把 `derive_anim_flow` 移出豁免 ⇒ 测试应报"未注册" |

### 14.6 给用户的判断项（本轮只取证，未动代码）

`derive_anim_flow` / `derive_algorithm` 这两个 action 要**修接线**还是**撤销宣传**？——
这是**产品语义决策**（它们还要不要），不是工程判断：
- 要 ⇒ 把派发体接回实现（约 10 行）+ 补 G7 门；
- 不要 ⇒ 从 `EXPLORE_ACTIONS` 摘掉（**对外契约变更**，G1 会红，属有意变更）+ 实现连带归档。
**默认建议**：先做 **G7 门**（让它可见），再逐个功能决定去留 —— 顺序上先"看得见"再"做决定"。

### 14.7 ★★★ 用户裁定：**先重构，后剪枝**（并给出理由，我采纳）

用户原话：
> "GetDsl 虽然被取代了，但是 QueryFeature 不是没有引用 GetDsl 吗？**它不会是它的元工具吧**。
>  要不你还是**先做重构再去删这些东西**吧，**我怀疑你删不全也删不对**。"

**① "元工具"假设的核查（用证据答）**：

| 检查 | 结果 |
|---|---|
| 是否有**按名拼路径**的动态 import（`import('./tools/' + x + '.js')`） | **无**（grep 命中都是"生成 import 字符串"，不是动态加载） |
| 是否**遍历 `tools/` 目录**后按名 import | **无** |
| `getDsl` 这个**符号**在全仓的引用 | 只有**它自己 + `tests/tools/tools.test.ts`** |
⇒ **找不到任何能调起它的机制 ⇒ 不是元工具。** 但如上，我这一天的取证已错 5 次，
**"找不到机制"≠"不存在机制"**（外部手调、别人的脚本都观测不到）。

**② 顺带查实一件必须保住的东西**：`tests/tools/tools.test.ts` 里有**安全断言** ——
`getDsl({feature_name: '../etc/passwd'})` 必须抛"非法 feature 名"。
⇒ **删文件会连带丢掉这条安全不变量的测试**（守卫本身在 `storage.getDSL`，不会丢；**测试覆盖会丢**）。
⇒ 真删之前必须**先把它移植到新入口**（`query_feature`）—— 这类"删代码连带删测试"必须在删除单元里一并处理。

**③ 裁定：停止剪枝，先做重构。** 理由（我认同且有实据）：
1. **判据还不够硬**：§14.2 的五分类里，A 类（被宣传+有实现）与 B/C 类的界限需要 **G7（宣传-实现一致性）+ G6（可达性）** 这两扇门才能机械判定；
   现在靠人工读派发体 ⇒ 正是我出错的地方。
2. **删除依赖"当前代码状态"，而代码状态正被重构改变** ⇒ 先搬完再剪，只需判一次。
3. ★ **我的当日记录支持这个怀疑**：今天三次误判 —— 误删 barrel（`observe/index.ts`）、
   误判"无测试消费者"（漏掉 219 行测试）、**差点删掉被宣传 action 的唯一实现**。
   ⇒ "删不全也删不对"**是准确的**；**错的是判据，不是执行**。
4. 顺序上还有一条硬理由：**门要先有**。G6/G7 建好后，"该不该删"变成机器回答；
   在那之前每一次删除都是人工判断的赌注。

**④ 因此本计划后续顺序正式改为**（★ 2026-09-28 二次裁定：与 §9-D / §10.3 对齐，消除文档内的顺序冲突）：

```
P1c（LANE_OF 改派生 + 一致性门）        ✅ 本轮完成
  → ★ §10 品牌改名（DesignCanvas → AgentIO）
  → P2（src/tools 200 文件按族搬迁，一族一提交）
  → 建 G6（可达性门）+ G7（宣传-实现一致性门）
  → ★ 最后才做「剪枝收尾」：用 G6/G7 的输出把 §14.2 的五分类逐个机械判定并执行
```

★ **为什么改名排在 P2 之前**（§10.3 的三条理由，逐条都成立）：改名的判据是
"**除品牌串外逐字相同**"，这个 diff 在**文件没被移动过**时最可读；P2 之后再做，
判据会被 200 个 move 淹没（理由①）。两者都触及几乎每个文件（改名动内容、P2 动位置），
**不许交错**（理由②）；改完名再做 P2，新路径/新 import 一次到位（理由③）。
⇒ 我上一版把它排在 P2 之后（理由只写了"剪枝依赖 G6/G7"），**是把两个问题混成一个了** ——
剪枝确实要在 P2 之后，改名却必须在 P2 之前。已按此拆开。

**⑤ 本轮不动任何删除**（§14.2 的五分类表原样留作待办）。

---

## 15. ★★★ 工具面收敛：把「功能」和「工具」的语义分开（2026-09-28 用户澄清）

### 15.1 用户指出的语义漂移（这是本项目的**根性误解**，不是命名问题）

用户原话要点：
> "实际上我们理解的工具不太一样，就是我们的语义是有漂移的。**我的意思是说，把这个功能摊得多而全。**
>  然后把这些功能收纳在一个个的工具里面，一个工具可以通过参数…因为很多工具它是从上一个工具的基础往下顺延的，
>  比如说我要改项目，我首先要看项目，看项目后面我拿到什么数据，再接着往下改，这样子顺序顺延下去。
>  所以说很多工具它是一套的，**很多功能是放在同一个工具里，但实际上做成了每个功能一个工具** ——
>  我的就等于是**我把功能说成了工具**，然后你写的时候也是这样写，造成了现在这个局面。"

★ **这不是"命名不好"，是一个范畴错误（category error）**：把**功能（做什么）**直接登记成了**工具（寻址单位）**。
⇒ 一个功能一个工具 ⇒ 67 个工具 / `src/tools` 200 文件 / 71k 行（全仓 65%）。
⇒ 而且它**解释了 §14 的空壳**：`explore_code` 是唯一按正确形状做的（1 工具 + 11 action），
   却恰恰是唯一有空壳的 —— 因为"聚合"和"接线"是两件事，聚合把 facade 建好了、实现没接。

### 15.2 三个层次（把漂移的语义钉死，之后一律按这个说话）

| 层 | 是什么 | 当前状态 | 正确形态 |
|---|---|---|---|
| **操作对象** | 被操作的东西：项目 / DSL / 符号 / 观测 / 契约 / 跨仓 | 未显式建模 | ★ **聚合口径**（一个对象 = 一个入口） |
| **功能（动作）** | 对对象做的那件事：改名 / 查引用 / 看健康度 / 插桩 | 被登记成了 67 个"工具" | **变成 action 参数** |
| **工具** | MCP 的**寻址单位**（name + schema + handler） | 67 个，功能粒度 | **一个操作对象一个** |
| **链（编排）** | 按顺序顺延的一串步骤，**前一步产物 = 后一步入参** | 只做到 `refactor_pipeline` 一个 | ★ **这才是"工具链"，不是工具** |

⇒ **"工具链"不是"一堆工具"，是"一条有顺序、有产物传递的编排"。** 用户举的例子
（改项目：先看项目 → 拿到数据 → 再改 → 再验）正是 `refactor_pipeline` 的形状（预览→执行→校验闭环）。

### 15.3 ★ 好消息：原则**早就写在仓里了**，只是没执行完

`docs/tool-convergence.md` §2.0 逐字写着（**比本次讨论还准确**）：
> 渐进披露靠「**入口聚合 + action 分派**」模拟层级。
> **判定口径：按「操作对象」聚合，不按「实现机制」。**
> 已落地样板：`gateway_provider` / `canvas_notes` / `manage_feature`。
> **反面教训**：`camera_*` **不聚合** —— 看似同对象，实为**不同抽象层**（基础动作/判定/查询/编排）。

⇒ 所以本节的结论**不是新立一套**，而是：
1. **把已有原则执行完**（别再造新分类）；
2. **写代码的人（含我）按它写** —— 用户点出的正是"你写的时候也是这样写"，所以我也有份；
3. 把"反面教训"作为**合并前的硬闸**（见 15.5）。

### 15.4 聚合的边界：**直接用已有的 6 条 lane，不新造分类**

★ `capability_map` 的 6 条能力线**本身就是按领域（≈操作对象）分出来的**，而且已经有门（G9）守着：

| 线（=操作对象面） | 工具数 | 收敛后 |
|---|---|---|
| refactor（符号/文件） | 19 | 1 入口 + ~19 action |
| observe（运行时） | 13 | ⚠️ **按 `camera_*` 反面教训拆分**（见下） |
| design（DSL/feature） | 12 | 1 入口 + ~12 action |
| meta（元信息/自省） | 9 | 1 入口 + ~9 action |
| harvest（契约/闭包） | 9 | 1 入口 + ~9 action |
| cross（跨仓/健康） | 5 | 1 入口 + ~5 action |

⚠️ **observe 那条不许硬合**：`camera_*` 的反面教训说的是**基础动作 / 判定 / 查询 / 编排是不同抽象层** ——
`observe_instrument`（基础动作）、`observe_judge`（判定）、`observe_log`（查询）、
`feature_line`/`reconcile_chain`（编排）**分属四层**，合并会违背契约。⇒ 这条按层次拆，不按对象合。

### 15.5 ★★ 顺序：**数据准确是"大而全"的前置**（不是并行任务）

**实测证据（本轮，用它自己的工具量的）**：`index_integrity` 自报
**索引 390 文件 / 磁盘 688 文件（未索引 310）⇒ 只覆盖 57%**；`code_health` 的
**313 孤儿 / 632 未分类**都建立在这张 56% 的图上。

⇒ **一个"大而全"的入口，会把 57% 图的不准放大成"所有功能一起不准"，并且更难定位是哪一步错的。**
   换句话说：**facade 越大，数据缺口藏得越深** —— 这与 §14 的教训同源
   （"空壳藏在 action 里比藏在独立工具里更难发现"）。
⇒ 因此顺序**必须**是：

```
① 修数据/量具（索引覆盖 57% → 先查清 310 个未索引文件）
② G7 门（宣传-实现一致性：每个 action 必须真调实现）—— ✅ **已落地**（2026-09-28）
   `tests/tools/explore_action_wiring.test.ts` + `tests/fixtures/explore_action_wiring.json`（4 项，出生证 6/6）
   两档判据：**机械档**（case 块必须真调一个 import 来的实现）+ **声明档**（每个 action 必须声明实现，
   或进 `debt` 并写理由；debt 棘轮上界 5 = §14.1 的 2 纯空壳 + 3 半空壳）。
   ★ 它同时是"堆新工具/新 action"的**准入闸** —— 新增若不声明实现即红。
③ 按「操作对象」聚合（面 = lane；observe 按层次拆）
④ 用 refactor_pipeline 当模板，把"顺延链"做成编排（而不是继续造工具）
⑤ 新增功能的准入门：现有面覆盖不了（举证）+ 归到某条 lane + G7 绿
```

★ 与既有裁定的衔接：原序是 `P2（拆 tools）→ 建 G6/G7 → 剪枝收尾`。
**本节把 G7 提到 P2 之前**，并新增"① 修数据"为最前置 —— 理由就是上面那张 57% 的图。

### 15.6 与 Serena 对照的取舍（用户提到"像它一样编排工具"）

之前对照过（见 `docs/` 外的 serena 分析）：Serena 值得抄的是**编排形态**，不是它的语言服务：
- 可抄：**工具=类 + `apply()`**、**`apply_ex` 中央信封**（横切关注只写一次）、
  **`_deleted_tools` 墓碑**（改名/合并时不断老会话）、**facade 唯一实现 + 多表面**、
  **modes × contexts 可组合配置**。
- ★ 不抄：**别把"58 个工作台"换成"58 个工具"** —— Serena 是"业务在 facade"，
  本仓是"业务在工具层"，这才是 30 倍代码量差的来源（工具数相近：53 vs 67）。
- ⇒ 落地：**聚合后的每个面 = 一个 facade（唯一实现）+ 多表面（MCP 工具 / CLI / 内部调用）**，
  表面都指向同一个 facade（这就让 §2 的病根"同一意图多份实现"在结构上**不可能发生**，比事后加门更根本）。

---

## 16. ★★★ 工具可用性评审（以"agent 是主要用户"为视角）—— 2026-09-28 实测后写的待办

> 来源：本日在**真 MCP** 上跑了 ~40 次调用（含 `edit_code(replace_text)` 批量迁移 7 个文件），
> 下面是**踩到的**与**好用的**。用户要求：不好用的**列进待办清单把它变好用**。

### 16.1 ★★ 头号问题：**成败判定只能靠解析自然语言文本**（我今天因此踩了两次）

回执形态（真实）：
```
✓ replace_text src/observe/instrument.ts L310（1 行 → 1 行，匹配 L1·exact），
  索引已重建（updated｜引用方重算 1 条）（符号 diff: +0 -0 ~3） diff L310 …
```
- 失败①：**干跑回执以 `[干跑]` 开头、不以 `✓` 开头** ⇒ 我的判断 `r.startsWith('✓')` 把
  "干跑成功"判成失败 ⇒ **静默跳过了一次落盘**（`toolchain.ts` 的 spread 还原）。
- 失败②：我的正则 `/from\s*'[^']*source_exts\.js';/` 漏了 `from ` ⇒ 6 个文件全判成"无 import"。
- ⇒ **提议 P-A：回执带稳定字段**，形如
  `{ok, op, file, line, hitLevel:'exact|normalized|indent|ellipsis', written:boolean, indexRebuilt, symbolDiff}`。
  **文本供人读、字段供 agent 判。**
- ★ 这条的重要性：本项目自己的纪律是"**不许靠猜、不许靠文本判断**"（§2d），
  而**一个面向 agent 的工具，却让 agent 靠正则去判成败** —— 这是自相矛盾。
  目前 agent 侧的唯一工作方式是"猜文本"，且**猜错不报错**。

### 16.2 ★ 缺批量入口（7 文件 = 14 次调用）
`edit_code` 是**单文件**的。机械迁移 N 个文件时只能 N 次 dry-run + N 次 apply。
`apply_rules` 存在（Grit 规则 + 三关夹具）但对"一次性机械替换"**太重**。
⇒ **提议 P-B**：`edit_code` 支持 `targets: [{file, old_text, new_text}]`（批量 + **逐项独立回报** +
可选的"全成或全不成"原子性）。

### 16.3 ★ 缺"先算清单 → 预览 → 批量落盘"的编排入口（= 用户说的"工具链"缺的那一环）
本次我只能在 MCP **外面**自己写 driver（fs 读 → 算 old/new → 循环调用）——
而"算清单"恰恰是最该由工具体内完成的部分（它掌握索引与 AST）。
⇒ **提议 P-C**：`plan_refactor`（算清单 + 预览，只读）与 `apply_refactor_plan`（按清单落盘）成对，
与 `refactor_pipeline` 同族；**清单可审、可复跑、可入账**（对应 §15 的"链 ≠ 工具"）。

### 16.4 入参守卫不对称（`find_references`）
`mode=symbol`（默认）缺 `file` ⇒ `ENOENT: …\design-canvas\undefined`；而同一文件里 `mode=type`
有明确 `blocked: ['mode=type 需要 file + symbol…']`。
⇒ **提议 P-D**：统一的**入参前置校验**：缺必需参数时给"缺什么 + 怎么给"，
**绝不把 `undefined` 拼进路径**（那是最难反查的一种错）。

### 16.5 成功口径：**"完成"必须伴随可验证产物**
`explore_code` 空壳返回「异步 action 已完成」（G7 已覆盖那 5 个），但纪律应上升为**工具面通则**：
**报"完成"就必须给出可验证产物**（改动了几行/哪些文件/diff 摘要/新产物 id），否则不算完成。
⇒ **提议 P-E**：写进 `tool-convergence.md` 的工具设计规范。

### 16.6 `⚠️ STALE SOURCE / STALE INDEX` 是**正确设计**，但呈现需收敛
它们每轮附**整段长文本**（我改 src 未 build 期间每次调用都有）。对 agent 是**重复噪音**。
⇒ **提议 P-F**：首次出现给全文，之后给一行摘要；并把它结构化进 `warnings: [{code, summary, detail, fix}]`。

### 16.7 ★ 好用、值得保留的（别只记问题）
- **`edit_code(replace_text)`**：*"每级都要求全文件恰好 1 处命中，歧义即报错**绝不猜**；
  回执明示命中级别；模糊命中时 diff 展示**实际被替换的文件片段**而非输入文本"* ——
  **设计得很好**，比"old_string 模糊匹配"安全得多（不猜、不越界、改了哪段给你看）。
- **`capability_map`**：67 个工具的扁平广播确有选择噪音，线级导航是必要的。
- **`index_integrity`**（本轮修完口径后）：信息密度高，"能不能信这个索引"一问到位。
- **`STALE SOURCE / STALE INDEX` 的存在**：让我能判断"读到的是不是旧图" —— 方向完全对。

### 16.8 待办（可直接认领）
| # | 事项 | 判据 |
|---|---|---|
| P-A | 工具回执加**稳定字段**（文本与字段并存） | 用一个"只读字段不读文本"的消费者验证：能正确判成败**且不依赖任何正则** |
| P-B | `edit_code` 批量 `targets[]` | 一次调用改 7 文件；逐项回报；注入一个必失败项 ⇒ 该项红、其余按原子性策略处理 |
| P-C | `plan_refactor` / `apply_refactor_plan` 成对 | 清单可审、可复跑；重复 apply 幂等 |
| P-D | 入参前置校验统一 | 每个工具缺必需参数 ⇒ 明确报"缺什么"；**全仓 grep 断言不再出现 `undefined` 拼进路径** |
| P-E | "完成 ⇒ 可验证产物"写进工具设计规范 | G7 扩到全部工具（不只 explore_code 的 action） |
| P-F | 警告结构化 + 首次全文/后续摘要 | 结构化 warnings 可被程序判定 |
| P-G | （待验证）`explore_code(action='read')` 是否是稳定的**读文件**入口 | 先实测再登记 —— **不凭印象写** |

> ✅ **P-B 已落地**（2026-09-28）：`edit_code` 增 `targets[]`（批量 `{file,old_text,new_text}`，**逐项独立回报**）
> + `atomic`（可选：任一项失败则整批不落盘）。判据三条均以测试坐实（一次调用改 **7** 文件 / 注入必失败项 ⇒ 该项红且其余按策略处理 / 原子性开-关各一）。
> 批量回执走 `---DATA---`（`items[]` 逐项 + `total/succeeded/failed/atomic` 计数）。因 `inputSchema` 变更，
> **G1 契约基线已按门指引重算**（`UPDATE_TOOL_SNAPSHOT=1`，仍 **67** 工具，仅 `edit_code` 的 description/inputSchema 变）。

---

## 17. ★★★ 关于"要不要用 tree-sitter 重头实现成编译器内核"（2026-09-28 用户提出，我给的判断）

用户主张：「用 tree-sitter 重新按编译器内核方式**重头实现**这些功能，每个功能**对着抄**，用最优解，
而不是像现在这样正则乱堆、**多处正向源**；**完全可以一处数据算出来了之后多处取用**。
它每一次都要重新去算一遍一模一样的数据，是有这个问题吧。」

### 17.1 先给数（不是印象）

| 量 | 实测 |
|---|---|
| **`walkSourceFiles` 调用点** | **15 处** |
| **另外两份"遍历源码文件"** | `feature_map.scanSourceFiles` **6 处**、`observe/instrument.collectTsFiles` **8 处**、`monolith.walkSourceFiles`（同名遮蔽） |
| `parseFileFull` 调用点 | 71 处（**但有 `cache.db` 兜底**：nodes/edges/imports/embedding_cache + 内容哈希保鲜） |
| `expandClosure` 调用点 | 18 处（每次从图现算） |
| `listSupportedExtensions` | 8 处（每次问一遍） |
| memoize / `_cache` 单例 | **0**（`grep` 无命中）⇒ **没有"算一次多处取用"的通用层** |
| 正则字面量 | 138 处；top：`extract_contracts(8)` / `symptom_parser(8)` / `ts_codegen(7)` / `detect_dead_imports(6)` / `layer_detect(5)` |

### 17.2 你说对的部分（实锤）
1. ★ **"每次重新算一遍"是真的 —— 但只在"遍历/派生"层**：
   **符号层有缓存**（`cache.db`），**但"这个项目有哪些源码文件"被 walk 了 29 处、每次重 walk 一遍**；
   `expandClosure` 18 处每次现算；`listSupportedExtensions` 8 处每次现问。
   ⇒ **"一处算出来、多处取用"这一层确实缺，而且它是最该补的一层。**
2. **"多处正向源"是真的**，但**比你以为的已在收敛**：今日已把判据三层单点化
   （扩展名 / 文件名 / **目录**，见 §16 与 `source_exts.ts`），G4 现管 6 个家族。
   ⚠️ **但"遍历器"这一层完全没收口**（4 份实现）。

### 17.3 要修正的部分（别把病灶面放大）
**"正则乱堆"要看性质**：138 处里**有些本质就是文本问题** —— `symptom_parser`（解析报错文本）、
`extract_contracts`（抓注释里的契约）、品牌残留门 —— **这些不该也不用 AST**。
真正"该用 AST 却用正则"的是**在解析结构**的那几处（`detect_dead_imports` / `layer_detect` /
`python_refactor.dead_imports`），**是少数**，不是"乱堆"的全部。

### 17.4 ★ 我的判断：**不做"重头实现"，做"派生层 + 内核化收口 + 对拍"**

四条理由（按分量）：
1. ★★ **重写不会自动消灭病根**。病根是"**知识没有唯一落点**"；一个**干净的重写同样能长出 5 份 walker**
   —— 今天实测的 29 处遍历就是这么长出来的。**治它的是"落点 + 棘轮门"，不是新代码。**
2. ★★ **你已经具备重写的最强前提，但正确用法不是"重头写"**：2269 测试 + G1 契约快照 + G8 行为快照
   = **现成的对拍基线**。重头实现会**丢掉这些测试里沉淀的边界**（`.js` 后缀 / barrier 用例 / CRLF /
   别名 import —— 全是踩出来的）。**重写必须让旧测试原样通过、不许改测试**，否则只是"更干净但漏了 N 个边界"。
3. **代价不对称**：109k 行 / 2269 测试 / 67 工具在跑。重写是**唯一可能把可用系统变成不可用**的选项；
   内核化收口**每步可回滚、每步有门**。
4. **但"一处算出来多处取用"我完全同意，而且它就该现在补** —— 这不是重构，是**加一层**。

### 17.5 落地顺序（替换"重头实现"）
```
① 加"项目视图"层（kernel 的 ProjectView：源文件集 + 依赖图 + 符号表）
     算一次 → 按内容指纹失效 → 多处取用     ← 这就是你说的核心价值，立竿见影
② 收口"遍历器"这一层（4 份 walker → 1）+ G4 登记家族
③ 逐工具改到 ProjectView 上（一次一个；G1 契约 + G8 行为快照守边界）
④ 真需要重写的**单块**单独判（如 `renderer/scripts.ts` 12k 行字符串）—— 那是"重写一块"，不是"重写项目"
```
★ 一句话：**你要的那个"编译器内核"，落地形态是"多一层派生数据 + 一条收口纪律"，不是"重写一遍"。**

---

## 18. ★★★ 「像商业工具那样」：三类沉积 + 一条最该修的（2026-09-28 用户提出）

用户原话要点：
> 「这个项目里面**遍地是你提的这种脚手架**，而且你**上下文一压缩之后，你自己就会忘记这些脚手架**，
>  然后经常会**再做一遍**。…我希望你就把它**奔着像商业工具一样**。…
>  主要是**每一个工具要是干净的一条线**，取用了别的工具的内容就是**启用**别的工具的内容，
>  而不要就这样乱七八糟；**可以继承其他工具，但是不要把其他工具已经写过的内容重写一遍**，
>  除非说有代价；或者两个工具里有重复的部分，就**抽出来作为抽象接口去调**。
>  我的希望是它能够成为一个**类似编辑器的内核**，用这个 **AST 做 LSP 级的解析**，
>  然后成为 **Agent 的底层操作层**。对标 **Pi** —— Pi 就是只有 **read/write/grep/glob 四个工具**的内核。
>  **它做极简内核，那我们做极繁内核**，就是做**功能极致多**的那种内核。」

### 18.1 我的诚实回答："乱"不在结构，在**三类沉积**

结构其实是清楚的（目标四层 + 6 条 lane + 6 个 G4 家族）。乱的是**沉积物**：

| 类 | 实测 | 性质 |
|---|---|---|
| **① 一次性脚本沉积** | 仓库**根下 12 个**：`_probe_tools.mjs` / `_smoke_safe_rename.mjs` / `agent_notes_loop.mjs` / `backfill_stepflow.mjs` / `probe_*.mjs`×6 / `sim_*.mjs`×2 ｜ 我另外在**仓外造了 33 个**（`.inspect/*.mjs`） | ★ **这是"遍地脚手架"的本体** |
| **② 判据副本沉积** | 今天收了 4 类（import 解析 4→1、扩展名 20→1、文件名、目录 9→1+）；**"遍历器"那类还没收**（`walkSourceFiles` 15 处 + `scanSourceFiles` 6 + `collectTsFiles` 8 + `monolith` 同名遮蔽） | 有 G4 棘轮在管，方向对 |
| **③ "已存在什么"没有索引** | ★ `AGENTS.md` 91 行是 **TRIGGER_ROWS 生成的"任务→工具"表**，**完全没说"仓库里已有哪些脚本 / 门 / 登记表 / 探针"** | ★★ **这是"重造一遍"的机制性原因** |

### 18.2 ★★ 最该修的一条：**别靠 agent 的记性，要靠仓库里有索引**

用户说的"上下文一压缩你就忘了、然后又做一遍"——**这是结构性事实，不是我这次记性差**：
新会话（或压缩后的我）进来自动读的是 `AGENTS.md` / `README` / 本规划书 / `refactor-playbook.md`，
**这四处都没有"仓库资产清单"** ⇒ **重造是必然的**。

⇒ **提议（便宜、可验收）**：**扩展已有的生成器** `scripts/gen_agents.mjs`，
在 `AGENTS.md` 里生成一节 **「仓库资产地图」**：
- `scripts/*.mjs` 逐个 + 一行作用（**产品链 vs 一次性**分开列）
- `tests/**/*.test.ts` 里的**门**（名称 + 判据 + **有没有出生证**）
- `tests/fixtures/*.json` 的**登记表**（棘轮基线在哪）
- 根下 `*.mjs` 一次性脚本（**并顺手收进 `scripts/oneoff/` 或删** —— 它们不该住仓库根）
- ★ **"会话脚手架"记账**：仓外一次性脚本**放仓外**（保持），但**在仓内留一行账**
  （如 `docs/agent-scaffolding-log.md`：造过什么、为什么、还在不在）⇒ 压缩后的我能看见"上次造过 `skipdir_plan.mjs`"。

★ 纪律：**agent 会忘是不可修的；能修的是"仓库里有没有索引"。**

### 18.3 "每个工具一条干净线" —— 规则 + 强制
- **规则**：取用别人的能力 = **import 那个实现**；有重复 = **抽到内核做接口**；**不许重写一遍**。
- **强制**：G4 棘轮（现 6 家族）+ **新增"新工具准入门"**：新工具必须声明它**复用了哪些内核 API**，
  或**声明为什么不能复用**（今天已为 action 建了 G7 的同类闸，可扩到工具级）。

### 18.4 ★ "极繁内核"要小心：**别让"面"跟着"核"一起膨胀**
- **Pi = 小面（4 工具）+ 薄核**。它的"极简"体现在**操作面**。
- ★ 但 **"极繁"如果体现在工具数上，就正好走回"67 工具 / `src/tools` 200 文件"的老路** ——
  而那正是本项目诊断出的病（§2、§15）。
- ⇒ **正确的"极繁" = 核极厚、面仍收敛**：内核里可以有 AST + 语义 + 图 + 索引 + 规则 + 跨语言 + 观测…；
  对外暴露的是**面（lane / facade）+ 少数直调高频工具**（`capability_map` 已经在做这件事）。
- ★ 一句话：**Pi 是"小面 + 薄核"；你要的是"小面 + 厚核"。面不要跟着核一起涨。**

### 18.5 ★ "AST 做 LSP 级解析" —— 一条硬事实：**AST 到不了 LSP 级**
- **tree-sitter 给语法，不给语义**（定义/引用/类型）。本项目 `src/` 里 **LSP 命中 0**，解析是 tree-sitter。
- **要到 LSP 级，只有两条路**：
  1. **TS 侧接 `tsserver`**（本机已有 `typescript`）—— 用 `definition` / `references` / `quickinfo`，
     **对 TS 立刻就是真 LSP 级**，成本可控；
  2. **非 TS 语言**：要么一种语言配一个 LSP server（重；Windows 进程管理复杂 —— Serena 花了 ~1,700 行），
     要么**自己在 AST + 索引上建语义层**（= 上面说的"厚核"路线）。
- ⇒ 与之前的 Serena 对照结论一致：**双源** ——
  **tree-sitter 管全量图 / 离线 / 多语言 / 跨仓**；**tsserver 只管"改错代价最高的三处"**
  （`find_references` / `rename_symbols` / `edit_code`），做成**可选后端**。


### 18.6 ★ 撤回"资产地图"提议 + 实际执行（用户质疑后）

用户质疑：**「可以是可以，但这不又重新建了一套东西吗？你确定建了这个之后，你能把那些一次性的脚本全清干净吗？」**
⇒ ★ **质疑成立，提议撤回**：**为了管理乱而再加一层生成物，那不是清乱、是把乱编目** ——
  这与本项目自己批过的"兼容层/脚手架"是同一个动作。**先清干净，再谈要不要索引；能清到 0 就不需要索引。**

**实测（能不能清）**：根下 12 个脚本 **零代码引用** —— 只有 ①符号索引把它们当文件 ②`architecture-refactor-plan.md`
与 `tool-convergence.md`（**历史文档**）提到过；`package.json` / `scripts/` / `tests/` / CI **都没引用**。

**执行**（2026-09-28）：
- 根下 **12 个 → `scripts/oneoff/`**（保留可复现性 —— `tool-convergence.md` 拿它们当实测证据，**不删**）⇒ **仓库根下脚本数 = 0**。
- 真复用的 **2 个 MCP 驱动进仓**（`scripts/mcp/mcp_smoke.mjs` / `mcp_call.mjs`），并**改成路径无关**
  （原来硬编码本仓路径 —— 那本身是坏味道）。仓外原件已删。
- 其余**仓外扫描脚本不搬**：它们**不在仓内**、不影响仓库整洁；搬进来等于**又加 31 个文件**。
  ★ 但要诚实：**它们的知识必须在仓内** —— 迁移方法在 playbook §8.5/8.6，门的出生证在各门文件头，
  判据优先级在项目记忆。**若某条知识只在仓外脚本里，那才是真漏。**
- 替代方案 = **目录约定即索引**（playbook §9）：**目录名本身就是索引，零新机制**。

**仍未做（下一批）**：把"门出生证"抽成**共享 helper**（现在每扇门一个一次性探针 = 同一种活各写一遍），
  `tests/helpers/gate_probe.ts`：注入 → 跑门 → 断言红 → 还原，各门只声明"注什么、期望什么"。

---

## 19. ★★★ 「把中间数据抽成接口、只有最外层是工具」（2026-09-28 用户提出）—— 实测证实 + 落地形态

用户原话要点：
> 「你去把每一个工具的**中间的数据**抽出来，因为每一个工具它实际上就是 **AST 解析数据 → 此工具处理数据 → 此工具返回数据**。
>  然后**处理数据这一步你抽象成一个接口**，所有需要用到这一步处理的就调用这个接口；
>  然后**下一步的这个接口也可以包含这个接口**。就中间过程都做成接口，
>  **只有最后的返回数据包装成工具**，甚至可以把**多个这种包在同一个工具里面**。」

### 19.1 ★★ 实测证实了它（也修正了我前两轮的判断）

| handler 形态 | 数量 | 含义 |
|---|---|---|
| **块体 `async (a) => { … }`** | **41** | ★ **处理逻辑内联在工具定义里**（= 没抽成接口） |
| 直接调用 `async (a) => fn(a)` | **3** | 已抽成接口：`translate_go_ts` / `memory_observe` / `diff_views` |
| 我的正则没覆盖到 | 19 | `textOut` 内联 / 缩进差异 —— ★ **不确定，如实标**（不与前两行相加当结论） |

★★ **修正我 §17 的判断**：我当时说"处理层**已经存在**（`src/tools/*.ts` 的纯函数）" ——
**只说对了一半**：纯函数**有**（`src/tools` 190 个 .ts），**但工具定义没在用它**，而是把处理逻辑内联了。
⇒ **接口存在，但没被当作接口用。** 这就是"每个工具各写一遍"的机制 —— 用户说的"中间过程做成接口"**基本还没做**。

### 19.2 三明治结构（把它定成规范）

```
[A] 解析 / 取中间数据     → 内核（AST、索引、ProjectView）—— 一处算，多处取用
[B] 处理数据（接口）      → 纯函数，**可组合**（B₂ 可以包含 B₁）；有**统一的中间数据形态**
[C] 包装成工具            → 只在 lane 文件里，薄到"入参 → 调 B → 包装回执"
```
- **只有 [C] 暴露给 agent**；[A][B] 是内部接口。
- **"多个包在同一个工具里"** = §15 的面收敛（面 = lane / facade）。

### 19.3 ★ 但有一个反模式必须挡住：**不要做成"一个万能中间层"**
[B] 的粒度**按操作对象切**（= lane：符号/文件 · 运行时 · DSL · 契约 · 跨仓 · 元信息），
**不是按"处理步骤"堆一个**。否则就是把 67 个工具的复杂度**集中到一个新巨型文件**里
—— 本项目已有教训（`serve.ts` 3,151 行、`renderer/scripts.ts` 12k 行字符串）。

### 19.4 ★ 顺序上的硬约束 + 第一步
41 个内联块**不可能一次抽完**（= 41 次重构，每次都要过 G1 契约 + G8 行为快照）。
⇒ **必须按 lane 分批**，且**先抽最上游的那一个**：

| 序 | 抽什么 | 为什么先它 |
|---|---|---|
| **①** | **`ProjectView`（最上游的中间数据）**：源文件集 + 依赖图 + 符号表 | ★ **一次消掉 29 处 walk / 18 处 expandClosure / 8 处 listSupportedExtensions**（§17.1），且后面很多 [B] 都会用到它 |
| ② | 收口"遍历器"（4 份 walker → 1）+ G4 登记 | 它是 `ProjectView` 的 [A] 层 |
| ③ | 按 lane 抽 [B]（refactor → observe → design → harvest → cross → meta） | 一次一个，G1/G8 守边界 |
| ④ | [C] 缩到"薄转发"；面收敛（§15） | 最后做，因为前面不动就没有"接口"可转发 |

### 19.5 判据（抽了就必须可验收）
1. **多次调用只算一次**：`ProjectView` 按内容指纹缓存 ⇒ **可测**（同一进程内重复取，walker 调用计数 == 1）。
2. **新增代码不许再 walk 仓库**：G4 加家族 `repo-walk`（权威 = `ProjectView`），存量冻结、只许减。
3. **边界不破**：2269 测试 + G1 契约快照 + G8 行为快照全绿（**不许改测试**）。
4. **[C] 变薄可量化**：块体 handler 数（现 41）**只许减不许增** —— 与 §18.3 的"新工具准入门"同一条棘轮。

---

## 20. ★★★ 用户裁定「不留墓碑」+ ③′ 实测：**根本不存在共用接口层**

### 20.1 用户裁定（覆盖我上一条"铁律"）
> 「它实际上是对内的，**这所有的项目都是我们的项目，除了我们自己以外没有别人在用**，
>  那么我们就需要把这个做得**最好**即可，**墓碑什么都不要留，全都不要留，这是维护地狱**。」

★ **我收回上一轮"面收敛必须有墓碑机制"的说法。** 该裁定与 §10.4（"无下游 ⇒ 不做兼容层"）**同一条逻辑**，
一致。**不留任何过渡物。**

★ 但代价要改写成**正确的东西**：不留墓碑的代价 **不是"外部用户断"**，而是
「**我们自己的旧会话 / 预设 / 技能包指向不存在的工具名**」—— 那是**可一次性同步**的（重桥 + 改预设），
**不是**必须靠兼容层扛的。
⇒ 因此这次重排**应当走本仓已验证过的「全局串改名 + 残留门」流程**（playbook §8 + 品牌残留门的棘轮），
**不要发明新机制**。

### 20.2 ★★ ③′ 实测：**「一个纯函数 ↔ 一个工具」一一对应，没有共用接口层**

量法：`src/tools/*.ts` 的每个 `export function`，统计它被**六个 lane 文件**引用了几处。

| 结果 | 数 |
|---|---|
| 被 lane 引用的导出函数 | **64** |
| 被 **≥2 处**引用（真·共用接口候选） | **7** |
| **恰被 1 处**引用（= 某个工具的实现细节） | **57** |

被引用最多的 4 个：`renderGranularityNote`(4) / `findReferences`(3) / `getStats`(3) /
`ensureProjectIndex`(3) / `collectRuleTargets`(3) / `applyRulesToFiles`(3) / `loadRules`(2)。

★★★ **结论（三个）**：
1. **用户设想的"处理接口被多个工具共用"目前不存在** —— 57/64 的 [B] **只服务一个工具**。
   ⇒ 所以我 §19 排的"按 lane 抽 [B]"**确实无事可做**（不是偷懒，是没东西可抽）。
2. ★ 于是"面收敛"的形态也清楚了：**每个面 = 把 N 个一一对应的 (B, C) 对收进去变成 action**
   （这正是 §15 说的"功能变 action"）。
3. ★★ **真正的缺口终于被数据指出来了**：不是"重复实现"，是 **`[B]` 之间不互通** ——
   57 个 [B] **各自定义入参、各自返回 `message`** ⇒ **无法组合**（B₂ 接不上 B₁）。
   ⇒ **这正面解释了"用户想要的工具链为什么做不出来"**：
   链要求"**前一步产物 = 后一步入参**"，而当前 [B] 既没有共同的**入参形态**、也没有共同的**产物形态**。
   ⇒ **要做链，必须先统一 [B] 的契约形状**（§19.2 里那句"[B] 要有统一的中间数据形态"，一直没落地）。

### 20.3 修订后的顺序（§19 计划的第二次修订）
```
① ProjectView（最上游中间数据）                    ✅ 64bfcf6
② 遍历器收口（4 份 walker → 1；G4 repo-walk 清零）  ✅ 54338af
③ 按 lane 抽 [B]                                   ✗ **撤销**：实测无事可做（57/64 一对一）
③′ 量 [B] 复用面                                   ✅ 本轮：无共用层 ⇒ 缺的是"互通"
④ ★ 统一 [B] 的契约形状（入参/产物都结构化）        ⏳ ← 真正的下一步（做链的前提）
⑤ 面收敛 + 重排（同一次；**不留墓碑**，全仓串改引用点）  ⏳
⑥ 清过渡物                                         ⏳
```

---

## 21. ★★★ 裁定：**它们是纯函数，被注册成了工具；修剪成纯函数 + 不许降级**（2026-09-28 用户）

用户原话：
> 「那就只能说明我们这个其实**就不是工具，而是纯函数，只是我们把它注册成了工具而已**。
>  把它们**修剪，修剪成纯函数，就是最干净的样子**。**不要掺任何乱七八糟的东西。**
>  也**不要掺兜底，成功就是成功，失败就是失败，不要降级**。」

★ 这与 §2d（"**如果一个兜底的失败模式是「少做一点事而不说话」，它就不该存在**"）**同一条**，
  只是这次落到了**函数形状**上。⇒ 三条**形状**规矩：

| # | 规矩 | 现状（实测） |
|---|---|---|
| 1 | **[B] 收显式参数**，不收 `Record<string, unknown>` 的 args 袋子 | 常见 `editCode(args)` 内部再 `as unknown as {…}` 强转 ⇒ ★ **"工具形状"漏进了纯函数**（强转就是证据） |
| 2 | **[B] 产物是结构化数据**，不是 `message` 字符串 | 多数返回 `{message}` ⇒ **接不上链**（§20.2 结论 ③ 的根因） |
| 3 | ★ **失败就抛**，不许把异常降级成"看起来正常"的返回值 | 见下表 |

### 21.1 「失败降级」盘点（`src/tools`，2026-09-28 实测）

★ **先把指标的噪声说清**：我最初扫了 6 种形态、得到 **771 处 / 142 个文件** —— 但其中
**`?? []`(354) 与 `?? ''`(212) 多数是合法习惯**（可选字段默认），**不是降级**。
⇒ **真候选是更窄的三类**：

| 形态 | 处数 | 为什么是降级 |
|---|---|---|
| `catch { return <默认值> }` | **63** | 把异常变成一个"看起来正常"的返回值 |
| `catch { /* 只有注释 */ }` | **65** | ★ **彻底静默**（最危险：静默失效，G5 治的就是这类） |
| 循环里 `catch { continue }` | **45** | 跳过失败项且**不报告**（"少做了什么不说"） |
| **真候选合计** | **≈173** | |

最多者：`rename_symbol.ts` 13 ｜ `project_root.ts` 12 ｜ `derive_mind_map.ts` 7 ｜ `serve.ts` 4 …

★ **诚实边界**：`?? []` / `?? ''` 那 566 处**必须逐个人读**才能判（"可选字段默认"合法，
"失败兜底"不合法）—— **不许拿总数当结论**（这正是 §21 与 §19.1 同一个教训的反面用法）。

### 21.2 修剪的目标形状（样板级）
```
[B] 形如：  function findRefs(root: string, symbol: string, opts?: {...}): RefResult   // 显式参数 + 结构化产物
            · 拿不到就 throw（不返回 [] / 不返回 '' / 不吞异常）
[C] 形如：  wrapData(async (a) => findRefs(requireStr(a,'project_dir'), requireStr(a,'symbol')))  // 薄转发
            · [C] 负责：解参（缺参=明确报错）→ 调 [B] → 把结构化产物渲染成回执
            · [C] 不负责：任何处理逻辑、任何兜底
★ 不掺的东西：args 袋子 / `as unknown as` 强转 / `?? []` 式失败兜底 / 只注释的 catch / 静默 continue
```

---

## 22. ★ 修剪队列的正确判据（连错两次样板之后的修正）

### 22.1 我连着两次挑错样板 —— 根因是"判据错了"
| 我挑的 | 为什么是错的 |
|---|---|
| `list_snapshots`（最小块体 17 行） | 那 17 行里真逻辑只有 7 行，其余是 description/schema；handler 剩的只是**渲染回执**（[C] 该干的活） |
| `findReferences`（被 3 处引用） | ★ 它的返回类型 **`FindReferencesResult` 本来就是结构化的**、入参也是类型化对象 ⇒ **已经离目标形状很近**，修剪几乎无事可做 |

⇒ **教训：选样板必须按「离目标形状的距离」，不能按"块体行数 / 被引用次数"。**
   （同一类错今天犯两次：**拿一个便于测量的量，替代了真正要问的问题。**）

### 22.2 正确判据（§21 三条规矩的量化）
对 `src/tools/*.ts` 逐个量：
- 规矩①：`Record<string, unknown>`（args 袋子）+ `as unknown as {`（袋子漏进来的强转证据）
- 规矩②：`return { message… }`（产物只有文本）vs `export interface *Result`（已有结构化产物）
- 规矩③：`catch { return 默认 }` + `catch { 只有注释 }` + `catch { continue }`（失败降级）

### 22.3 实测结果
★ **78 / 190 个文件已接近达标**（有结构化 `Result` + 无袋子 + 无强转）
⇒ **[B] 层大体已经是纯函数了** —— 这再次印证 §20.2（不存在"待抽的接口层"）。

**真正的修剪队列（按距离降序）**：

| 分 | 文件 | 袋子 | 强转 | 只有 message | 结构化 | 兜底 |
|---|---|---|---|---|---|---|
| 36 | `archify_mappers.ts` | **18** | 0 | 0 | 0 | 0 |
| 28 | `query_feature.ts` | 0 | 1 | **29** | 1 | 0 |
| 21 | `explore_code.ts` | 7 | 0 | 5 | 0 | 2 |
| 20 | `project_root.ts` | 4 | 0 | 0 | 0 | **12** ← 兜底最密 |
| 20 | `rename_symbol.ts` | 0 | **5** | 0 | 1 | **13** ← 两维都差 |
| 15 | `update_feature.ts` | 2 | 0 | 11 | 0 | 0 |
| 14 | `serve.ts` | 6 | 0 | 0 | 0 | 2 |
| 13 | `edit_code.ts` | 0 | 0 | **13** | 0 | 0 |

### 22.4 下一个样板的裁定（按判据，不按感觉）
★ **选 `project_root.ts`（12 处兜底）**，理由三条：
1. 它是**基础设施**（被许多工具 import）⇒ **修剪它影响面最广**；
2. **只在一个维度上差**（兜底），改动**语义清晰**：把"猜不到就返回默认"改成"猜不到就抛/就明确标注"；
3. 它**没有** args 袋子/强转/文本产物 ⇒ 不用同时动契约形状，**风险最小**。
⚠️ 但它是"根定位"，**抛错会改变行为**（原先静默回退到 `process.cwd()` 那类）⇒ 必须：
   ① 逐处确认"这处兜底是有意的还是偷懒的"（§2c）② 事先查清**谁会因此开始抛错** ③ 全量回归守住。
   ★ 因此它需要**单独一笔、带预算**，不硬塞进已耗尽预算的这一轮。

---

## 23. `project_root.ts` 的 12 处兜底：**逐处判定**（读代码之后，我第三次改判）

### 23.1 ★ 我先纠正自己上一轮的判断（第三次同类失误）
§22.4 我说它「**只差一个维度**（兜底），改动语义清晰、**风险最小**」—— ★ **读了代码之后不成立**：
这 12 处**不是"可逐一改成 throw"的兜底**，而是 **IO 失败路径上的静默兜底**（readdir / readFile /
parse 失败），共同病是 **把「读不了」与「确实没有」混成同一个 `[]` / `false` / `null`**。
⇒ 而 **"全都抛"是错的** —— 它扫的是**整个仓**，一个坏文件就会**炸掉整轮**。

★★ 正解是 §2d 的**第三条出路**：*"要么硬失败（吵醒人），要么把**少做了什么**变成**可读的数**（看得见）"*
—— 但那**要改返回类型**（`T` → `{ value, skipped: [{path, why}] }`），**不是"只动兜底不动形状"**。
⇒ **所以它不是一个"最小样板"。我第三次判断失误，根因还是"没读代码就下判断"。**

### 23.2 逐处判定（12 处）

| 行 | 现场 | 病 | 处置 |
|---|---|---|---|
| 145 | `out = null; // 非 git 仓库` | ★ **不是病**：`git rev-parse` 失败 = **语义答案**（不是 git 仓） | **保留**，但注释写明"这是第三态，不是降级" |
| 192 | readdir 失败 `return;` | 静默 | 改成**记 skipped**（或抛，看调用方语义） |
| 218 | `return false;` | "不知道"与"不是"混成 false | ★ **区分第三态**（如 `boolean \| 'unknown'`） |
| 331 | `return [];` | "扫不到"与"扫不了"混成空数组 | 记 skipped + 返回 |
| 362 | `continue;`（单项读不了就跳） | 跳过且**不报告** | 记 skipped |
| 591 | 配置解析失败 `return null` | "没有配置"与"配置坏了"混成 null | 区分（抛出 or 标注 why） |
| 599 | `/* extends 解析失败不影响自身配置 */` | ★ **有意的，且有理由** | **保留**（§2c：不同维度） |
| 675 | `return false;` | 同 218 | 同 218 |
| 702 | `return undefined;` | 同 591 | 同 591 |
| 735 | `return [];` | 同 331 | 同 331 |
| 886 | `catch { /* ignore */ }` | 静默 | 记 skipped |
| 897 | `catch { return out; }` | ★ **部分成功伪装成成功** | 记 skipped（返回"已收集 + 跳过的"） |
| 899 | `catch { /* ignore */ }`（下面已有 `if (!parsed) return out`） | ★ **不完全是病**：它让 `parsed` 保持 null 以便走下面那条明确分支 | **保留**，但注释写明"此处 catch 是为了走下面那条显式分支" |

⇒ **真实处置：12 处里 3 处保留（有理由）、9 处需要"变可见"**，而其中多数**需要返回类型带上 skipped**。

### 23.3 影响面（改之前必须知道）
`project_root.ts` 被 **10 个文件**、**11 处** import ⇒ 是**基础设施**；改返回类型 = **牵动这些调用点**。
⇒ ★ 因此这一笔的正确形态是：
1. **先只做"变可见"的最小版**：不改既有返回类型，**新增**一条 `skipped` 旁路（如 `__skipped` 或独立的
   `lastScanSkips()`）—— 让"少做了什么"**先可见**，把改契约留到面收敛时一次做；
2. 或者承认它**必须改形状**，那就**按 §19.2 的三明治一次改到位**（[B] 产物结构化），并**连带改这 11 处调用点**。
★ 我的建议：**先做 ①**（可见但不动契约）——理由是**风险与收益的比值**：可见化能立刻消除"静默"，而改形状的收益要等面收敛才兑现。

---

## 24. 「我规划 + DSH 执行 + 我核验」这个分工的**成立条件**（2026-09-28 用户提出）

> 用户：「所以你就直接规划，然后和验收即可，DSH 会帮你做，这样**你也不会漏做，也能批量做任务**对吧？」

★ **对，但"不会漏"不来自分工本身，来自三个具体机制** —— 缺一个就会漏：

| 机制 | 为什么必须有 | 现状 |
|---|---|---|
| ① **任务书自包含** | DSH 看不到我们的对话 ⇒ 事实、路径、判据都必须写进文件 | ✅ `.inspect/dsh-task-project_root.md` |
| ② **判据可机械核** | 否则"核验"只能读它的总结 = 退回信任（而我今天已多次见到"声称与 diff 不符"） | ✅ 任务书 6 条判据（tsc / 2279 基线 / 三处保留未动 / 无第三选择 / 无新兜底 / 写明没验什么） |
| ③ ★★ **进度账本在仓库里** | 我的上下文会压缩、DSH 会话会结束 ⇒ **"做到哪了"只有落在仓内才不丢**（§18.2 同一条：*agent 会忘不可修；能修的是仓库里有没有索引*） | ✅ 就是 §24.1 这张表 |

### 24.1 ★ 批量的真正约束：**同文件必须串行，跨文件才能并行**
★ 我最初想"批量发出去并行做"，但：**`project_root.ts` 的 5 个待修剪函数在同一个文件里** ⇒
**同一文件并行编辑会静默丢改动**（我记忆里就有这条教训）。
⇒ 规则：**并行单位 = 文件，不是任务**。
- 本轮（同文件 5 个函数）：**必须串行**，一次一个函数、一笔一提交。
- 下一批（跨文件，如 `rename_symbol.ts` / `query_feature.ts` / `archify_mappers.ts`）：**才可以并行发**。

### 24.2 ★ 逐函数台账（`project_root.ts`）—— 这是"不会漏"的依据
★ 我用整模块粗扫得到的"12 处兜底"**站不住**；按**导出函数**拆开后是：

| 兜底 | 行数 | 被调用 | 函数 | 状态 |
|---|---|---|---|---|
| **1** | 55 | **1** | ★ `findExternalImporters` ← **第一个样板** | 🔄 DSH 在做 |
| 1 | 10 | 2 | `readPackageName` | ⏳ |
| 1 | 91 | 4 | `expandClosureDetailed` | ⏳ |
| 2 | 60 | 3 | `detectReachableRoots` | ⏳ |
| 2 | 32 | 12 | `loadAliasConfig` | ⏳ |

★ **另外 13 个函数兜底为 0 ⇒ 本轮不许动**：`clearGitRootCache` `manifestRootOf` `isInsideRoot`
`gitRootOf` `isProjectDir` `expandClosure` `resolveLangImport` `realResolveImport` `isLocalSource`
`resolveProjectRoot` `resolveAliasedImport` `walkProjectFiles` `resolveToFile`

★ 文件内 **catch 共 17 个，其中只有 7 个是"真兜底"**，另 10 个不是降级形态
（`145` git 非仓库 / `599` extends 失败不影响自身 / `899` 为走下面显式分支 …）
⇒ **不许一律改 throw**，逐处判定（§23.2）。

### 24.3 ★ 我又犯了第 5 次同类错（记下）
"12 处兜底 / 9 处需改造" 是我**整模块粗扫**得的数，**按函数拆开后真值是 7 处 / 5 个函数**。
⇒ 同一个教训第 5 次：**粗扫的聚合数不能当结论**。**方法上已纠正**：先按函数拆分，再排序挑最小。

---

## 25. 第一笔 DSH 交付**核验通过**（`3bf279d`）+ ★ 修正 §24 的"不会漏"

### 25.1 交付与核验（我独立重跑，不看它的总结）
**`3bf279d` trim: findExternalImporters 静默兜底改三态返回**
- 返回类型 `Promise<string[]>` → **`Promise<ExternalImporterResult>`** = `{ files, skipped: [{dir, why}] }`
- 那处 `catch { return [] }` → **`skipped.push({dir, why})` + 返回**（**无第三选择** ✓）

| 判据 | 实测 |
|---|---|
| `tsc --noEmit` | **exit 0** ✓ |
| 全量回归 | **221 文件 / 2279 通过 / 5 跳过 —— 与基线逐字相同** ✓（只许多不许少） |
| §23.2「保留」的 3 处（145/599/899） | **未被触碰**（4 个 hunk 全在 80-90 与 723-776）✓ |
| 每处兜底 = throw 或 skipped+why | ✓ 无第三选择 |
| 提交写明"没验什么" | ✓（并诚实标出 `skipped` 目前无断言用例） |
⇒ **这一笔收下。**

### 25.2 ★★ 它推翻了我 §24 的一个论断（我核了，属实）
它报告：*"tsc 报出的调用点：src/ 0 处，tests/ 3 处"*，并指出
**`tsconfig.json` 的 `include` 只有 `["src/**/*"]`、`exclude` 含 `"tests"`** ⇒ **tsc 根本不检查 tests**。
我核了 `tsconfig.json:20-21` —— **属实**。

⇒ ★ **修正 §24 的"改类型 ⇒ tsc 枚举 ⇒ 不会漏"**：
- **src 内的调用点**：改类型 ⇒ tsc 逐个枚举 ⇒ 不会漏 ✓
- ★ **tests 内的调用点**：**tsc 看不见** ⇒ 只能靠 **grep + 真的跑测试** 才发现 ⇒ **这里会漏**
⇒ 因此派活要求加一条：**提交信息必须分别列出「src 内 N 处（tsc 枚举）」与「tests 内 M 处（grep 得到）」。**
   ★ 这是用户"你会不会漏"那一问的**更精确答案**：**会——在 tests 范围内。**

### 25.3 台账更新
| 兜底 | 函数 | 状态 |
|---|---|---|
| 1 | `findExternalImporters` | ✅ **`3bf279d` 已核验收下** |
| 1 | `readPackageName` | 🔄 DSH 在做（已派，同一会话） |
| 1 | `expandClosureDetailed` | ⏳ |
| 2 | `detectReachableRoots` | ⏳ |
| 2 | `loadAliasConfig` | ⏳ |

---

## 26. ★★★ 修正「入参袋子」判据 + 重测修剪队列（2026-09-28，**只量不改**）

### 26.1 判据（把 §22.2 规矩①量准）
§22.2 把「袋子」定义为 **文件里 `Record<string, unknown>` 的条数** ⇒ **量错了对象**。
实测 `archify_mappers.ts` 的 18 处**全是函数内部的 IR builder 字典**（`const c: Record<string, unknown> = {…}` 后接可选字段条件赋值），
5 个导出函数的入参**本来就是显式类型化参数**（`(sem: SemanticSurface)`），且全文 **0 处** `as unknown as {`。
⇒ 这是 §22.1「**拿一个便于测量的量，替代了真正要问的问题**」在 §22.2 **自己身上**重犯（用户裁定：A，认下错标）。

**修正后的判据（本节口径）**，一条 `Record<string, unknown>` 才算「入参袋子」当且仅当：

| # | 条件 |
|---|---|
| ① | 出现在**导出函数的参数位置**（`export function f(x: Record<string, unknown>)` / `params: { …; args: Record<string, unknown> }`）**或** |
| ② | 是**导出函数的唯一/主要入参**（典型：`export async function foo(args: Record<string, unknown>)`，体内再 `as unknown as {…}`） |

**明确不算**（必须排除）：
- 函数**内部**的 builder 字典 / Map 字面量 / 局部 `const x: Record<string, unknown>`
- **非导出**函数签名的袋子参数（降级到「疑似漏网」，见 26.4）
- 只作为**工具 SDK 边界**出现（`server_registry` 把 SDK 的 `a` 转发进来）、而该文件**不是工具定义文件**

**量法**：用 TypeScript compiler API 遍历 190 个 `src/tools/*.ts`，**只认参数类型节点**（含内联对象字面量类型里的属性），别处一律不认；
`as unknown as {` 用文本计数（与原口径一致）；兜底用 AST 数 **CatchClause**（三类：块内含 return / 块内空语句＝静默 / 块内含 continue）。
★ **可复现**：§22.3 的「只有 message」列 = **含 `message` 键的 return 对象字面量数**
（用 4 个文件反推验证：query_feature 29、edit_code 13、update_feature 11、explore_code 5 —— **全中**）。
★ 量器是一次性脚本，置于系统 temp，**未在仓内新增任何文件**。

### 26.2 修正后队列（按距离降序，只列 `src/tools/*.ts`）
★ **分 = 真袋子×6 + 非导出袋×2 + 强转×3 + 兜底×1 + message-return×1**（公式显式给出便于复算；
   §22.3 的「分」公式**从表内不可反推**，故不复用）。
★ 「只有 message」= 26.1 的可复现口径；「兜底」= catch 内含 return ＋ catch 空块（静默）＋ catch 含 continue。
★ 「说明」列带 ★ = 该文件含**真入参袋子**（§21 规矩① 的正面目标）。

| 分 | 文件 | 真入参袋子处数 | `as unknown as {` 强转处数 | 只有 message 的 return 处数 | 兜底处数 | 说明 |
|---|---|---|---|---|---|---|
| 33 | `query_feature.ts` | 0 | 1 | 29 | 1 | |
| 28 | `rename_symbol.ts` | 0 | 5 | 0 | 13 | 两维都差 |
| 23 | `explore_code.ts` | **1** | 0 | 5 | 2 | ★ 真袋子；另有 5 处非导出袋（26.4） |
| 22 | `watch_project_tool.ts` | 0 | 0 | 16 | 6 | |
| 17 | `symbol_move.ts` | 0 | 5 | 0 | 2 | ★ **原 §22.3 未列**（与 rename_symbol 同量的 5 处强转） |
| 15 | `derive_mind_map.ts` | 0 | 0 | 5 | 10 | |
| 13 | `edit_code.ts` | 0 | 0 | 13 | 0 | |
| 12 | `project_root.ts` | 0 | 0 | 0 | 12 | ★ 正被**并发**修改，此数为「在途工作区版」 |
| 12 | `update_feature.ts` | 0 | 0 | 11 | 1 | 兜底 1 为原文**漏检**（26.5） |
| 10 | `memory_observe.ts` | **1** | 0 | 3 | 1 | ★ 真袋子（`registry/lanes/observe.ts` 已注册） |
| 10 | `snapshot.ts` | 0 | 0 | 5 | 5 | |
| 9 | `derive_split.ts` | 0 | 0 | 2 | 7 | |
| 9 | `import_project.ts` | 0 | 0 | 1 | 8 | |
| 9 | `index_backfill.ts` | 0 | 2 | 0 | 3 | **原未列** |
| 9 | `serve.ts` | 0 | 0 | 0 | 9 | ★ 本地 HTTP 服务器，**非 §21 语义的工具**（26.5） |
| 9 | `slim_brick.ts` | 0 | 0 | 4 | 5 | |
| 8 | `deprecate_offline.ts` | 0 | 0 | 3 | 5 | |
| 8 | `file_snapshot.ts` | 0 | 0 | 4 | 4 | |
| 8 | `watch_project.ts` | 0 | 0 | 0 | 8 | |
| 7 | `function_outline.ts` | 0 | 0 | 0 | 7 | |
| 7 | `write_gate.ts` | 0 | 0 | 0 | 7 | |
| 6 | `dag_layout.ts` | 0 | 0 | 6 | 0 | |
| 6 | `harvest_from_url.ts` | 0 | 0 | 1 | 5 | |
| 6 | `index_freshness.ts` | 0 | 0 | 0 | 6 | |
| 6 | `manage_feature.ts` | 0 | 0 | 6 | 0 | |

★ 全表 **128 个文件** score>0；其中 **33 个 ≥5**。上表列前 25（score ≥ 6）。
**其余 103 个文件 score 1–5**，几乎全是单点 catch 兜底或个别 message-return，不逐个列表。
★★ **真入参袋子（判据①/②）全库仅 2 处**（`explore_code`、`memory_observe`）；另有 1 处**边界**（`arg_suggest`，见 26.5）。
★ 全库 `Record<string, unknown>` 共 **93 处**，处于**参数位置**的仅 **10 处**（导出 3 ＋ 非导出 7），其余 **83 处**一律为内部字典 ⇒ 判据一改，虚高即刻显形。

### 26.3 ★ 修正前后对比（掉分的＝错标）
只对 **§22.3 原榜单的 8 行**比「袋子」列（其余列口径不同，不可逐格比）。

| 文件 | 原 §22.3 袋子 | 修正后真袋子（导出口径） | 掉分 |
|---|---|---|---|
| `archify_mappers.ts` | **18** | **0** | **−18** |
| `serve.ts` | 6 | 0 | −6 |
| `explore_code.ts` | 7 | 1 | −6 |
| `project_root.ts` | 4 | 0 | −4 |
| `update_feature.ts` | 2 | 0 | −2 |
| `query_feature.ts` | 0 | 0 | 0 |
| `rename_symbol.ts` | 0 | 0 | 0 |
| `edit_code.ts` | 0 | 0 | 0 |
| **合计** | **37** | **1** | **−36** |

★ 若放宽到「**任何**函数参数位」（含非导出）：`explore_code` = 6 ⇒ 合计 6，仍掉 **−31**。
★ **原榜单 8 行里有 5 行的「袋子」整列为虚高**；`archify_mappers` 一行**全错**（18 处全为内部 builder）。
★ 反向错漏：原榜单**漏掉了唯二的真袋子文件 `memory_observe.ts`** 与 5 处强转的 **`symbol_move.ts`**（另有边界件 `arg_suggest.ts`）。

### 26.4 疑似漏网（判据未覆盖、但形似袋子）——**不硬塞进队列**

| 文件:行 | 形态 | 为什么「疑似」 | 我的判定 |
|---|---|---|---|
| `explore_code.ts:58,66,71,76` | `requireStr/str/num/bool(v: Record<string, unknown>, key)` | **非导出**函数参数位 ⇒ 判据①/② 都不覆盖；语义是「从袋子里取键」的解参助手 | **算**：是同一袋子的下游，应随 26.2 的 `explore_code` 一并收敛 |
| `explore_code.ts:300` | `readCode(args: Record<string, unknown>)` | 非导出，但它是**真正的执行体**（导出壳 `exploreCode` 只负责分派） | **算**（同上） |
| `trace_exec.ts:424` | `execPy(codeText, entryName, kwargs: Record<string, unknown>)` | 非导出；`kwargs` 语义是 **Python 函数 kwargs 字典**（`**json.loads(...)`），**不是工具入参袋** | **不算**（语义正确，勿改） |
| `trace_reasoning.ts:97` | `findClassInExports(ns: Record<string, unknown>, …)` | 非导出；`ns` 是**模块命名空间对象** | **不算**（语义正确，勿改） |

⇒ 结论：**真正的「疑似漏网」只有 `explore_code` 的 5 处**（含 `readCode`）；其余 2 处是「任意字典」而非「工具参数袋」。

### 26.5 诚实清单（判不准 / 边界 / 未验）
1. ★ **`arg_suggest.ts:75` 判不准**：`unknownArgHints(args: Record<string, unknown>, known, opts)`
   **命中判据①**（导出 ＋ 参数位），但调用方是 `src/server_registry.ts:572` 的
   `renderArgHints(unknownArgHints(a, knownArgs), knownArgs)` —— `a` 就是 **SDK 边界袋**；
   且该文件**不是工具定义文件**（纯工具函数，被 `server_registry` import）⇒ 按排除条**不计核心**。
   ★ **判据①的正面条件与排除条在此直接打架 ⇒ 我没有硬下结论。**
2. ★ **兜底列的可复现性：8 行里 5 行复现、3 行对不上**（我未强行对齐，如实记录）：
   - 复现：`archify_mappers` 0 ✓、`explore_code` 2 ✓、`project_root` 12 ✓、`rename_symbol` 13 ✓、`edit_code` 0 ✓
   - ★ **原表漏检**：`query_feature` 0→**1**（`query_feature.ts:660 catch { return {message, data:null} }`）、
     `update_feature` 0→**1**（`update_feature.ts:336 catch { /* 快照失败不阻断布局，仅忽略 */ }` —— 正是 §2d 的「只注释的 catch」）
   - ★ **口径不同**：`serve` 2→**9**。它是**本地 HTTP 服务器**（`/api/save`、SSE），
     其 `catch (e) { sendError(res,500,…) }`/`catch { sseClients.delete(client) }` 多为**HTTP 错误路径与清理**，
     **不是 §21/§2d 语义的「少做了一点事而不说话」** ⇒ 该行兜底分**不可直接当降级判**。
3. ★ **`src/registry/` 才是 [C] 层真正的袋子所在**：`plumbing.ts:35` 定义
   `wrapData(fn: (args: Record<string, unknown>) => …)`，注册表用 `wrapData(async (a) => memoryObserveHandler(a))`
   （`registry/lanes/observe.ts:45`），且 **`a` 靠上下文化类型**（不写 `Record`）。⇒ 本节按判据**只量 `src/tools/*.ts`**，
   **registry 层袋子未计入** —— ★ 这是**口径边界，不是漏检**。
4. ★ **`project_root.ts` 的在途改动**：该文件正被**另一执行者并发修改**（工作区 `M`，mtime `21:10:39`）。
   本节数**以「当前工作区版本」为准**，**未核 HEAD**，且我**未触碰**该文件。
5. ★ **未验**：`兜底` 只按 CatchClause 的**语法三形态**计数，**未逐处人读**判「是否真降级」。
   §21.1 已警：形态计数是**候选**不是结论 ⇒ 本节兜底列**同样是候选**，落地前必须逐个人读。
6. ★ **未验**：`只有 message` 口径的反推只在 **4 个文件**上验证（全中），**未全库验证**；若 §22.3 当时用了别的口径，该列可能仍有偏差。
7. ★ **未验**：`symbol_move.ts` / `index_backfill.ts` 等「原榜未列」的文件，我只量了**计数**，**未读代码确认**其强转/兜底是否真属 §21 目标形状。
8. **未做编译与测试**：本节**对 `.ts` 源码零改动**（仅追加本 `.md`）⇒ 无 `tsc`/vitest 影响面，故未跑；`git` 未提交。

---

★ **一句话口令（修正后）**：判「入参袋子」看**参数位置**，不看 `Record<string, unknown>` 的**出现次数**——
`archify_mappers` 那 18 处是**内部 builder**，不是袋子；全库真袋子只有 `explore_code` 与 `memory_observe` 两处。

---

## 27. ★★★ 并行编排实测（3 条线同时跑）+ 我第 4 次误判的纠正（2026-09-28）

### 27.1 本轮并行编排：DSH 1 条 + WorkBuddy 子 Agent 2 条
用户裁定（原话）：
> 「其实有个小问题。这些都是串行嘛，它们不应该是并行任务吗？…**你自己找两个 Deepseek 的子 Agent 发出去**，
>  因为 **DSH 那个铁律是让它自进化做狗食测试用的，你没有必要遵守**，那是另一个绘画的铁律。」

⇒ 由此确定：**串行的真实约束只是「同一个文件」**，跨文件一律并行。

| 线 | 执行者 | 目标文件 | 结果 |
|---|---|---|---|
| 1 | DSH 会话 `session-a02e536e` | `src/tools/project_root.ts`（第 4 笔） | ✅ `a83ebb4` |
| 2 | WorkBuddy 子 Agent（Flash） | `src/tools/query_feature.ts` | ✅ `9c0fc28` |
| 3 | WorkBuddy 子 Agent（Flash） | `src/tools/rename_symbol.ts` | ✅ `e6a96a2` |

**三条线实测结论**：
- ✓ **真并行（有直接证据）**：线 2 中途 tsc 报的错**全部**落在线 3 正在写的 `rename_symbol.ts`
  （未终止的模板串）—— 这是"两个执行者真同时在写"的证据，而非抽样巧合。线 3 修好后全量 tsc 恢复 0。
- ★ **并发下必须约束 git 的写法**：两条支线都被要求「**只 `git add` 自己的具体文件路径**，不许 `git add -A`」。
  事后来看这是**必需**的 —— 线 3 报告"索引里有线 2 staged 的 `query_feature.ts`"；
  若任一方用了 `git add -A` + `git commit`，就会把对方的半成品（乃至 DSH 的在途改动）一起提交。
- ✓ **DSH 的在途改动没被吞**：三笔提交完之后工作区只剩 `.inspect/commit-msg.txt`，
  DSH 第 4 笔的 4 个文件完整落在 `a83ebb4` 里。
- ★ **并发测试要避让**：三条线都只跑**定向** vitest，全量回归由**我独占**跑
  （三方同时跑全量会争 `.agent-io/` 与临时目录）。

### 27.2 三笔的核验（我做，不只信执行者的总结）

| 项 | 判据 | 结果 |
|---|---|---|
| 提交范围 | 各自只含一个文件 | ✅ `9c0fc28`→query_feature(24+/13−)；`e6a96a2`→rename_symbol(138+/89−)；`a83ebb4`→4 文件（实现+3 调用点+测试断言） |
| `tsc --noEmit` | `EXIT=0`（★ 不用 `\| head`，那取的是 head 的退出码） | ✅ |
| **全量回归** | 与基线**逐字相同** | ✅ **221 passed / 1 skipped (222) 文件；2279 passed / 5 skipped (2284) 测试** |
| 禁改区 | `a83ebb4` 的 hunk 不许碰 §23.2 的 145/599/899 | ✅ hunk 只在 93/321/335/365（全在 `detectReachableRoots` 区） |
| 调用点同步 | 改签名的必须同步调用点 | ✅ DSH 同步了 `cross.ts`/`health_cli.ts` + 测试断言；另 1 处 `server_registry.ts:74` 是**死 import**（只 import 不调用）⇒ tsc 不会报错，属存量屎山 |

★ **两笔交付的亮点（值得作为后续样板）**：
- `query_feature.ts`：把原来混在一起的 `if (!ok \|\| functions.length === 0)` **拆成两个语义不同的分支**
  —— `!ok`（数据源不可用）`throw`；`ok && 空`（成功但为空）正常返回。这是 §21 规矩②③的正解。
  且那处强转不是简单内联，而是 **import 了权威类型 `OverlayGoal`**（不再手写重复形状）。
- `rename_symbol.ts`：A1–A5 改成**硬失败**；A6–A14 改成**记 `skipped: [{path, why}]`**；
  并且**透传了 `expandClosureDetailed` 已报出的 `closure.skipped`**（原来被它自己丢掉了）。

### 27.3 ★★ 子 Agent 抓出的判据盲区：`catch` 的**第 4 种形态**
`rename_symbol.ts` 的形态扫描器数出 **13** 处兜底，子 Agent 发现**实际有 14 个 catch 块**：
多出来的那个是 `catch { fmod = null; src = ''; }` —— 块内是**赋值**，
既非 `return`、非空语句、也非 `continue` ⇒ **§21.1 的三形态表漏掉了「赋值形态」**。

★ 我独立复核：改完后该文件剩 **9 个** `catch (err)` 块 = 14 − 5（被判 A 类、改硬失败的 5 处）⇒ **对得上**。
⇒ **判据修正**：兜底的语法形态应扩为**四类**（`return` / 空块 / `continue` / **赋值**）。

### 27.4 子 Agent 提的两个裁定请求 + 我的裁定
1. **候选文件读失败时选 `skipped` 还是 fail-closed（`blocked`）？**
   ⇒ **裁定：保持 `skipped`。** 理由：§2d 明文给了两条出路，"把少做了什么变成可读的数"是合法的一条；
   而"一个不可读文件就拒绝整次改名"会让工具在仓库含 1 个权限异常文件时整体不可用，代价更大。
   ★ **但加一条硬约束（转待办）**：改名是**正确性敏感**操作 ⇒ `skipped` 非空时，
   **[C] 层回执必须显式警告"改名可能不完整"**，不能让它混在普通回执里。
2. **A1–A5 改硬失败后，`find_references.ts:403` 这类没有 try/catch 的调用点会由"静默跳过"变成硬失败。**
   ⇒ **裁定：接受这个行为变化**（这正是 §21 规矩③要的）。子 Agent **没动那 3 个文件是对的**（超范围）。
   ★ **转待办**：`find_references.ts` / `symbol_move.ts` / `project_root.ts` 里消费 analyzer `null` 契约的调用点，
   需在各自那一笔里显式处理。
   ★ **注意耦合**：`symbol_move.ts:319` 自带 try/catch，会把新抛**吸收成它自己的静默 `continue`**
   —— 这是 `symbol_move.ts` 自己的降级问题（它在 §26.2 队列里，分 17）。

### 27.5 ★★★ 我对 `loadAliasConfig` 的判定是**第 4 次误判** —— 纠正后挖出一个**真 bug**
§23.2 对 `project_root.ts` 的 12 处兜底逐处判定时，我判：
> 行 591「配置解析失败 `return null`」⇒ 处置：**改**（"配置坏了"与"没有配置"混成 null）

★ **读了代码之后不成立**（第 4 次同类失误，前 3 次见 §23.1）：
`findConfigFile()` 找的是 **`tsconfig.json` / `jsconfig.json`** —— 而 **tsconfig 是 JSONC**
（允许注释与尾逗号，VS Code 生成的默认 tsconfig 就带注释），`JSON.parse` **不支持** JSONC。
⇒ 那一处 `catch { return null }` **同时承担两个职责**：

| 情形 | 现状 | 对不对 |
|---|---|---|
| 文件是**合法 JSONC** | parse 失败 ⇒ `return null` | ★ **错**：应当正常读出 paths |
| 文件**真的坏了** | parse 失败 ⇒ `return null` | ★ **静默降级**（§2d 说它不该存在） |

★★ **藏在后面的真 bug（比"改形状"重要得多）**：
`return null` ⇒ `find_references` / `expandClosure` 拿不到 alias ⇒ **`@/` 类导入的引用被静默漏掉**。
⇒ **一个带注释 tsconfig 的项目，引用分析会静默漏引用，使用者完全无感。**
本仓 `tsconfig.json` 恰好是纯 JSON（实测 `grep -c "^\s*//"` = **0**），且现有测试**只覆盖纯 JSON** ⇒ 从未暴露。

**纠正后的处置（已派 DSH 执行，见 §27.7）**：不是"改 throw"，而是
**用 JSONC 解析器区分两者**（项目已依赖 `typescript@^5.4.0`，仓内已有 `import ts from 'typescript'` 用法）：
- 合法 JSONC ⇒ 正常解析（**修 bug**）
- 真的坏了 ⇒ **这时才 `throw`**（含配置绝对路径 + 原始错误）
- ①「无 cfgFile」/④「无 compilerOptions」/⑤「无 paths+baseUrl」三处 `return null` = **合法第三态，保留**
- ③ `extends` catch **保留**（父配置坏了不该拖垮子配置，§23.2 已判）

**★ 教训（第 4 次同类）**：§23.2 我是"读代码之后"写的，仍然判错 ——
因为**我读了那一行，却没有读它上游 `findConfigFile` 找的是什么文件**。
⇒ 判「这是不是降级」时，必须把**这条 catch 实际捕获的是哪一类失败**搞清楚，而不是看它的语法形状。

### 27.6 一句话口令（本轮新增）
- **并行编排**：串行约束**只在"同一个文件"**；并发下 **git 只 add 自己的路径**；全量测试由**一个**执行者独占跑。
- **判兜底**：先问"**它捕获的是哪一类失败**"，再问"这是不是降级" ——
  形状相同的两处 catch，可能一个是病、一个是**必要的容错**（JSONC 那处就是）。
- **判据盲区**：形态计数（语法三/四类）永远只是**候选**，逐处人读之前不许当结论（§21.1 同一条）。

### 27.7 第二批两条线（同样并行）的核验
| 线 | 执行者 | 目标 | 结果 |
|---|---|---|---|
| 4 | 子 Agent（Flash） | `src/tools/explore_code.ts` | ✅ `524cd10`（1 文件，69+/17−） |
| 5 | 子 Agent（Flash） | `src/tools/watch_project_tool.ts` | ✅ `da1922c`（2 文件：实现 + `impact_ledger.test.ts` 断言 3 处改 `rejects.toThrow`） |

- `tsc --noEmit` ⇒ `EXIT=0` ✅
- **全量回归 ⇒ `221 passed / 1 skipped (222)` 文件；`2279 passed / 5 skipped (2284)` 测试 ⇒ 与基线逐字相同** ✅
- 我独立核验：`readCode(root, file, opts: ReadCodeOptions)` 已显式化 ✅；`exploreCode(params: { action; args })` 的 **[C] 分派壳仍在**（符合执行者的判断）✅；
  `watch_project_tool.ts` 新增 3 处 `throw new Error`（另 2 处 A 类是"去掉 try/catch 让异常原样抛"，grep 不到 throw，与它的说明一致）✅

### 27.8 ★★ 两个互不通信的执行者**独立发现同一缺口** ⇒ 判据缺口坐实
- 线 3（`rename_symbol.ts`）报告：形态扫描器数出 13 处，**实际 14 个 catch 块**，多出的是 `catch { fmod = null; src = ''; }`（**赋值**形态）。
- 线 5（`watch_project_tool.ts`）**独立**报告：「兜底不止 6 处 —— 第 4 形态"catch 含赋值"实有 **5 处**（§26 三形态口径未计入）」。

⇒ 两个执行者互看不到对方，却各自撞上**同一个**缺口 ⇒ **§21.1 的形态表确实漏了第 4 类（赋值）**，不是抽样巧合。
★ 并且线 5 逐处人读后判**保留**，理由是合理的：那 5 处全在**常驻 watcher 的后台任务**，
抛错只会被 throttler 的二层兜底吞掉（**反而更静默**），且失败已写进 `entry.error` 并经 `status` 播报 ⇒ 已满足 §2d 的"可读"。
它同时援引了 §26.5 的 `serve.ts` 教训（**合法的错误路径/资源清理不是降级**）—— 这是正确的用法。
★ 线 5 留下的**遗留观察（未改）**：`entry.error` 是**单槽**，会被下一次成功清空 ⇒ **背景失败可能丢失**。列入观察项。

### 27.9 ★★★ 执行者推翻 §26.4 的一个判定：「解参助手」不是袋子 —— 判据①会误伤 [C] 层
§26.4 我判过一行：
> `explore_code.ts:58,66,71,76` 的 `requireStr/str/num/bool(v: Record<string, unknown>, key)` ⇒ **算**：是同一袋子的下游，应随 §26.2 的 `explore_code` 一并收敛

线 4 **不同意**（我认为它是对的）：
> 「它们就是 **§21.2 [C] 样板指定的解参工具**；真正的毛病是它们**被 [B] 执行体 `readCode` 内部使用** ——
>  本笔改显式后，它们只在 [C] 边界使用。」

★★ **根因：§26.1 的判据①（"在导出函数的参数位置"）会误伤 [C] 层的工具边界。**
[C] 层的**本质**就是"**收 args 袋子 → 解参 → 调 [B]**" ⇒ 所以"导出壳收袋子"**本来就该如此，不是病**。
§21.2 的 [C] 样板自己就写着 `requireStr(a,'project_dir')`。⇒ 判据应修正为：

| 谁收袋子 | 判定 |
|---|---|
| **[C] 工具边界（导出壳 / 分派器 / `wrapData` 回调）** | ✅ **天经地义**，不是病 |
| **[B] 纯函数** | ❌ **病**（纯函数该收显式参数） |

⇒ **"真袋子"的本质不是"在导出函数参数位"，而是"[B] 收了袋子"。**
★★ **由此推论（待验证，重要）**：§26.2 说"全库真袋子只有 2 处（`explore_code` / `memory_observe`）" ——
其中 `explore_code` 那处**已被证实是 [C] 壳**（不成立）；`memory_observe.ts:183` 也需按新判据复核。
**若它同样是 [C] 壳，则全库"真袋子"可能是 0 处** ⇒ 即「袋子」根本不是本仓的主要病（真正的大头是 §27.8 的**兜底**与 §21 规矩②的 **message**）。

★ 线 4 给的另一条理由也值得记（**门约束反作用于重构形状**的实例）：
> 那个 15-action 分派器**不可拆** —— 拆了就必须在 `src/registry/handlers.ts:210` 的 `wrapData` 壳里构造
> 15 成员 discriminated union（超单文件范围），**且 G7 门要求 case 块内直接调用 import 的实现符号**。

### 27.11 ★★★ §27.9 的判据被执行者**再修正一次**：[C]/[B] 看「是否只负责分派」，不看「谁调用它」
§27.9 我写了一条判 [C] 的**错误判据**：
> 「若它是 registry 通过 `wrapData` 直接调用的入口壳 ⇒ [C]，不是病」

线 6（`memory_observe.ts`）**明确反驳**（成立）：
> ★ **"registry 直接调用"≠[C]**：`registry/handlers.ts:51` 的 `wrap(async (a) => queryFeature(a as never))`
> —— registry **同样直接调用**，而 `queryFeature(input: QueryFeatureInput): QueryFeatureResult` 是
> **收显式类型化入参的 [B]**（正是 §21.2 的达标样板）。

它给的三条独立证据：
| # | 证据 |
|---|---|
| a | §22.3 明文把「[B] 层」等同于 `src/tools/*.ts` 文件 ⇒ 该文件是 [B] 层文件 |
| b | registry 直接调用的对象**既可能是 [C] 也可能是 [B]**（见上）⇒ "谁调用"不是判据 |
| c | ★ §26.4 **自己给的分界**：称 `exploreCode` 为「**导出壳（只负责分派）**」、`readCode(args)` 为「**真正的执行体**」 ⇒ **[C] 的判据是"只负责分派"** |

**裁定后的正确判据（第二次修正）**：

| 判据 | 结论 |
|---|---|
| 函数**只负责分派**（把 `action` 路由到别处的执行体） | → **[C] 工具边界**，收袋子**天经地义** |
| 函数**自己把各 action 的实现内联在体内**（真正干活） | → **[B]**，收袋子 = **病** |

应用：
- `exploreCode(params: { action; args })` —— 15-action **分派器** ⇒ **[C]** ✓（线 4 判"不改"正确）
- `memoryObserveHandler(args)` —— 把 **5 个 action 的实现全部内联在自己身上** ⇒ **[B] ⇒ 真袋子，改**（`faadaf3`）

⇒ ★★ **§27.9 那条推论（"若 memory_observe 也是 [C] 壳 ⇒ 全库真袋子可能 0 处"）不成立。**
**实测结论：全库真袋子 = 1 处（`memory_observe`），已修复**；`explore_code` 那处是 [C] 壳，不算。
（§26.2 原说 2 处 ⇒ **修正为 1 处**。）

### 27.12 ★ 形态表**第三次**被扩：第 5 种形态 = promise 的 `.catch`
线 7（`derive_mind_map.ts`）报告：「兜底 **10** 处」**对不上** —— 实有 **14 个 catch 落点**
（13 个 `try/catch` ＋ **1 个 promise `.catch`**）；三形态只数到 11，形态外 3 处 =
**2 处「赋值形态」** ＋ **1 处 promise `.catch`**。
⇒ 与 §27.8（赋值形态，两条线独立坐实）、§27.3 合起来，形态表已从 3 类扩到 **5 类**：
`return` ／ 空块 ／ `continue` ／ **赋值** ／ **promise `.catch`**。
★ **但结论不变**：形态计数永远只是**候选**（线 7 人读后 14 处判 A 4 / B 9 / C 1）。

### 27.13 本轮两条线的两个待裁定项（执行者主动提出）
1. 线 6：`memory_observe` 的 **track 无基线分支**（`data` 退化为 `{port}`）判 **C（拿不准）**——
   它"说了话"、先例（`explore_code` 空 query）也判 C 保留；改 throw 是产品行为变更。
   ⇒ **裁定：维持 C（不改）**。理由：这是"成功但信息少"，不是"失败被伪装成成功"，
   且 §2d 的两条出路它已满足（说了话 + 有结构化 data）。
2. 线 7：`resolveCanvasNoteTargets` 现对**不存在的 feature 抛错**（原先静默返回空工单）——
   问 `canvas_notes` 的 read 分支是否期望"未知 feature 返空"。
   ⇒ **裁定：接受 throw**。理由：feature 不存在 = 数据源不可用（§21 规矩③），
   静默返回 0 条工单是典型的"少做一点事而不说话"。若上游 read 分支需要"返空"，
   应由 **[C] 层**显式处理，不该由 [B] 猜。

### 27.14 ★★★ 核验 DSH 第 5 笔时抓到一处**明确偏离**（我改掉了）
DSH 交付 `4537a34`，**主目标达成**（合法 JSONC 现在能正常解析 —— 4 条新测试里 3 条有效，端到端也证明别名真的被读出）。
**但有一处明确偏离任务书**：

| 项 | 任务书要求（§2.2） | DSH 实际做法 |
|---|---|---|
| 主配置**真的坏了**（JSONC 也解析不了） | **`throw`**（§21 规矩③ / §2d） | ★ **`catch { return null }`**，并把这个行为**固化进测试断言**（"截断的 tsconfig → 返回 null"） |

★ 它给的理由**两处都错**（写在代码注释与提交信息里）：
1. 「**无论主配置还是 extends 均解析失败**」—— 那个 `try` 只包住了主配置，`extends` 在**下面的独立 try** 里。
2. 「**§23.2 判为保留**」—— §23.2 判"保留"的是 **extends 那处（行 599）**；**主配置这处（行 591）判的是"改"**。它把两处混为一谈。
3. 它还写「不改动契约」—— ★ **站不住**：`throw` **根本不改返回类型**（仍是 `AliasConfig | null`），12 个调用点一个都不用动。

★ **危险的不是这几行代码，而是那句注释**：它会让后来者（包括我）以为"这处已判定保留"，从此**不再检查**。

**我的修正**（`4537a34` 之后）：
- 主配置 catch ⇒ `throw new Error('failed to load tsconfig ${cfgFile}: …')`；注释里写明"§23.2 判保留的是 extends 那处，不是这里"
- 测试 3 改为 `expect(() => loadAliasConfig(dir)).toThrow(/failed to load tsconfig/)`
- 验证：`tsc --noEmit` ⇒ `EXIT=0`；`vitest run tests/tools/project_root.test.ts` ⇒ **37 passed**
- 全量回归 ⇒ 见 §27.15

★ **方法论价值**：这正是"**核验不能只看它说通过了**"的实例 —— 它的 tsc 是 0、定向测试全绿、主目标确实达成，
**唯一的问题在那句错误的注释和一个被固化的错误断言**里。**核验要读 diff、要读它的理由，而不只读它的结论。**

### 27.15 本轮总账（更新）
- **8 笔已核验**：`a83ebb4`(DSH) / `9c0fc28` / `e6a96a2` / `524cd10` / `da1922c` / `4537a34`(DSH) / `faadaf3` / `18527bf`
- **全量回归**：`221 passed / 1 skipped` 文件（**始终不变**）；测试 **2284 passed / 5 skipped**
  （基线 2279 **+5** = DSH 新增的 4 条 JSONC 测试 **＋** 品牌门新增的 1 条自检 —— **不是回归**）
  ★ 中途出现过**一次红**，见 §27.16（与代码改动**无关**）
- **两条判据被执行者修正、第三次扩充**：
  · §27.3/27.8/27.12：形态表 **3 类 → 5 类**（`return`／空块／`continue`／**赋值**／**promise `.catch`**）
  · §27.9→27.11：[C]/[B] 判据 **"在导出参数位" → "是否只负责分派"**；真袋子 **2 处 → 1 处**（`memory_observe`，已修）
- **我自己被判错 2 次、被纠正 2 次**：§27.5 的 JSONC、§27.9 的 [C] 判据
- **我自己抓出执行者偏离 1 次**：§27.14（DSH 的 alias 主配置 catch）

### 27.16 ★★ 一次"**门自己变红**"的假红 —— 差点被误判为我的改动引起
**现象**：修完 §27.14 之后跑全量回归，`tests/brand_residue.test.ts` 报「新增旧名出现处 ⇒ 红」——
新增命中**全是** `vitest.config.ts.timestamp-<ms>-<hash>.mjs`（一次连出现 5 个）。
**我最初的怀疑**：「是不是我把主配置 catch 改成 `throw` 引起的？」—— ★ **不是**。

**根因（实测）**：
- vitest 启动时把 `vitest.config.ts` 转译成上述临时文件落在**仓库根**，且**不总清理**；
- 该文件正文含**绝对路径** `file:///D:/project_develop/design-canvas/node_modules/vitest/dist/config.js` ⇒ 命中品牌串 `design-canvas`；
- 品牌门的 `walk` 扫仓库根所有"内容像文本"的文件（含 `.mjs`）⇒ 必然命中。
- ★ 时间戳证明它们正是**我自己连续跑测试**时生成的 ⇒ **不是并发问题**（三个时间点都是我单独跑的）。

★★ **教训**：这类门是「**自己会周期性变红的门**」，比漏报更麻烦 —— **它会训练人忽略它**。
（这其实是 §22.1「拿一个便于测量的量替代真正要问的问题」的另一种形态：
**门量到了不属于仓库的东西**。）

**修复**：品牌门新增 `isToolTempFile(name)` 并在 `walk` 里跳过（**只跳这一种构建产物，不做宽泛忽略**）
＋ 加一条**有效性自检**（断言命中该模式、且**不误跳真配置文件**）＋ `.gitignore` 防误提交。
**证据**：`vitest run tests/brand_residue.test.ts` ⇒ **8 passed**；跑完后临时文件**确实又生了 1 个**，而门**不再红**。

★ **遗留待办**：索引器的噪音过滤（`src/tools/ts_kernel/source_exts.ts` 的 `isNoiseFileName`）**未同步**跳过这类文件 ——
因为它会改变**已冻结的索引口径**，留到索引面收敛时一起做。

---

## 28. 收尾：清理、遗留与「什么是干净」（2026-09-28 晚，用户问"项目干净清爽了吗"）

### 28.1 删掉的东西（逐项附判据）
| 删了什么 | 判据 |
|---|---|
| `scripts/oneoff/`（12 个脚本） | ★ **全仓零引用**（grep 证实）；多数依赖 `dist/` + `.agent-io/` 的**当时状态**（如 `sim_gap.mjs` 读 `.agent-io/mindmap/*.teach.json`）⇒ **现在多半已跑不通**；`probe_mcp_smoke.mjs` 已被 `scripts/mcp/mcp_smoke.mjs` **取代**。§9 当初给它们的定位是"留作可复现证据"，但"**留了却不记得**"正是用户点过的病（"上下文一压缩就会忘，然后重做一遍"）⇒ 按用户"没有引用的直接全都剪枝"删 |
| `PR/`（投递机制 + 1 份提案） | ★ **为不存在的下游建的脚手架**：需求方（`dsh-brain`）与承接方（本仓）**是同一个人**（用户原话"除了我们自己以外没有别人在用"）。机制壳删掉，**内容不丢**——见 §28.3 第 9 条 |
| `.inspect/commit-msg.txt` | 执行者的临时工作区，**曾误提交进仓** ⇒ `git rm --cached`（文件留在盘上，执行者仍可用）+ `.inspect/` 进 `.gitignore` |
| `vitest.config.ts.timestamp-*.mjs` × N | vitest 每次把 config 转译成带时间戳的临时文件落在**仓库根**且不总清理（详见 §27.16）⇒ 清盘 + `.gitignore` + 品牌门跳过 |

### 28.2 收尾后**仍然存在、但已被有意忽略**的本地物（非本次产生，★ 未动）
| 路径 | 状态 | 处置 |
|---|---|---|
| `dsh-brain/design-canvas-dev/`（20M） | 被 `.gitignore` 的 `/design-canvas-dev/` **有意忽略**；mtime 2026-09-15（**落后主仓 13 天**） | ★ **未动**（不是本仓、非本次产生）—— 建议你决定删/留 |
| `dsh-brain/.tmp-probe/`（12M） | 被 `.gitignore` 的 `.tmp-*/` 忽略；mtime 2026-09-27 | ★ 同上 |
| `dsh-brain/expt-kernel/` | 未跟踪；其 README 是**旧名下的 design-canvas README**（前会话的实验复制品）。历史记忆记着"不是我的，未处置" | ★ **未动** |
| `dsh-brain/evals/runs/_mgmt/`、`_evidence/` 新产物 | 未跟踪 | ★ **未动**（那是 dsh-brain 自己的产物跟踪策略；`_evidence/` 部分是**有意跟踪**的） |

### 28.3 遗留待办（汇总；这 9 条就是"债的索引"）
1. ★ **`symbol_move.ts`（§26.2 分 17）与刚改过的 analyzer / `loadAliasConfig` 有耦合** ⇒ 必须**单独一笔**：
   - 它消费各 analyzer 的 `null` 契约（§27.4：A1–A5 改硬失败后，`symbol_move.ts:319` 自带 try/catch
     会**把新抛吸收成它自己的静默 `continue`**）
   - 它的 `loadAliasConfig` 调用点（237/301）现在会**抛**（主配置真坏时，见 §27.14）
2. ★ `project_root.ts` 的 §23.2 里判"**需要变可见**"的 **8 处**（192/218/331/362/675/702/735/886/897）——
   多数要改返回类型带 `skipped`，牵动 11 处调用点 ⇒ 属【面收敛】，不是单点修剪
3. ★ **索引器噪音过滤**未同步跳过 vitest 临时产物（`source_exts.ts` 的 `isNoiseFileName`）——
   会改**已冻结的索引口径**，留到索引面收敛
4. ★ **门的出生证抽成共享 helper**（`tests/helpers/gate_probe.ts` 的 `expectGateGoesRed({mutate, restore, expect})`）—— §9.1 已欠
5. ★ **§16.8 的 P-B/P-C/P-D/P-E/P-F/P-G**（工具可用性：`edit_code` 批量 `targets[]` / `plan_refactor`+`apply_refactor_plan` / 入参前置校验统一 / "完成⇒可验证产物"通则 / 警告结构化）
6. ★ **§19 ④→⑤→⑥**：统一 [B] 契约形状 → 面收敛 + 重排（同一次，不留墓碑）→ 清过渡物
7. ★ **改名场景是否 fail-closed**：§27.4 裁定"保持 `skipped`"，但改名是**正确性敏感**操作 ⇒
   `skipped` 非空时 **[C] 层回执必须显式警告"改名可能不完整"**（未做）
8. ✅ **【已收尾】** dsh-brain 侧的改名收尾：`07d98ba`（R2：bridge 包名 + 席位注释）+ `d168c0d`（R1+R2 脚本，6 个）。
   ★ 走通了 gate-layer 的完整流程：**pre-commit 自动挂票**（`pa-20260928-*`，**不用手写 record**）→
   `approve`（**带封条** `sealedSeq`）→ 提交 ⇒ 门的 post-commit 记账：
   `R1 提交已被封条 approve 覆盖（pa-20260928-7d0c29）⇒ 合法`。
   ★★ **我的流程失误（如实记）**：我**先批了 17 条那批的票**，随后把暂存批次改成 6 条 ⇒
   **旧批准失效、门挂新票**。这正是 skill §7 警告过的「**先改完再批**（批完再改 ⇒ 批次指纹变 ⇒ 旧批准失效）」——
   **我看到了那条警告却没遵守**。补救：**定死批次 → 重批（`sealedSeq=83`）→ 立刻提交、不再动任何东西**。
   ★ **自批声明**：批准者与改动作者**是同一个 agent**（非独立见证者），已按 §6.2 要求**逐字写进提交信息**，台账留痕、用户可回滚。
   ★ **未含**：`scripts/build-experiment-kernel.mjs` —— 它的未提交改动**不是改名**，是 **tsc 路径回退的功能修改**
   （`bin/tsc` → `lib/tsc.js` + `existsSync` 回退，别人的活）⇒ **未擅自提交**。
   ★ dsh-brain 门台账现状：**待批 0** / 封条链一致 ✓（83 条）/ `bypass 0` / `hooks-drift 0` / **门没看见过的提交 0 条** ✓
9. **〔原 PR-001，来自 dsh-brain 2026-09-27；随 `PR/` 撤掉但内容保留于此〕**
   请提供「**检测重复字面量表 + 建议单源化**」的能力。现场：同一个映射表在仓库里被复制了 **6 份**、每份自己的常量名；
   希望接上本仓已有的 `TRIGGER_ROWS → AGENTS.md`（单源生成）思路，推广成"能扫任意仓库、能判红"的检测。
   ★ 它与 **G4（单一实现棘轮）同族但不同**：**G4 管代码重复，这条管字面量数据表重复**。

### 28.4 「干净」的判据（我的答案）
★ **"干净"不等于"没有债"，而等于"每一笔债都有判据、有位置、不会被重做一遍"。**

| 维度 | 现状 |
|---|---|
| 工作区 | ✅ 无未提交改动（除被 ignore 的脚手架文件） |
| 一次性脚本 | ✅ 已清（零引用的 `scripts/oneoff/` 12 个已删） |
| 误提交的临时物 | ✅ 已清（`.inspect/commit-msg.txt` 已 `git rm --cached` + 进 ignore） |
| 「为不存在下游」的机制壳 | ✅ 已清（`PR/` 撤掉，需求转 §28.3 第 9 条） |
| 门假红源 | ✅ 已修（vitest 临时产物，§27.16） |
| **已知债** | ⚠️ **尚有 §28.3 的 8 条**（第 8 条已收尾），但**每条都有判据与位置** —— 这 8 条本身**就是"债的索引"**（不是散落的墓碑） |
| 别人的本地物 | ⚠️ §28.2 的 4 项**未动**（不是本仓/非本次产生）⇒ 由你决定 |
| dsh-brain 侧 | ✅ 改名收尾已提交（`07d98ba` + `d168c0d`），**门台账待批 0 / bypass 0 / 门没看见过的提交 0** |

### 27.10 本轮（2026-09-28 晚）总账
- **5 笔已核验并推送**：`a83ebb4`(DSH) / `9c0fc28` / `e6a96a2` / `524cd10` / `da1922c`（后 4 笔为子 Agent，全部**真并行**）
- **全量回归**：三次跑，每次都是 **221 / 2279 / 5**，与基线逐字相同（零回归）
- **两条判据被修正**（都不是我发现的，是执行者纠正的）：
  · §21.1 形态表 **3 类 → 4 类**（补"赋值形态"）—— 被两个执行者独立坐实（§27.8）
  · §26.1 判据① **会误伤 [C] 边界** ⇒ 真袋子 = "[B] 收了袋子"（§27.9）
- **我自己被纠正 1 次**：`loadAliasConfig` 的 JSONC 判定（§27.5），且**挖出一个真 bug**（带注释 tsconfig ⇒ 引用分析静默漏引用）
- **进行中**：DSH 第 5 笔（`loadAliasConfig` 的 JSONC 修复）

### 27.17 ★ G8 行为基线更新（P-D：`find_references` 缺参报错，2026-09-28 晚）
- **变更**（`find_references` 无参调用，`isError` 仍为 true）：`ENOENT: no such file or directory, open '<ABS>\undefined'` → `缺少必需参数 file：mode=symbol（默认）需要 file（定义符号的文件）。例：{file:'src/tools/find_references.ts', symbol:'findReferences'}`。
- **依据**：按 G8 门指引 `UPDATE_TOOL_BEHAVIOR=1` 重生成 `tests/fixtures/tool_behavior_snapshot.json`；`git diff` 实测**仅该 1 条变化**（其余 63 条逐字不变）。
- **关联**：§16.4 P-D（入参前置校验统一：缺必需参数 ⇒ 报「缺什么 + 怎么给」，绝不把 `undefined` 拼进路径）。执行者：本仓执行者。

---

## 29. §28.3 八条欠账的推进（2026-09-28 深夜）—— 7 条落地 + ★ 四个执行者纠正我 **8 处**

### 29.1 已落地（全部核验 + 全量回归零回归）
| # | 事项 | commit | 结论 |
|---|---|---|---|
| 1 | `symbol_move.ts` 收 2 处耦合 + 兜底改硬失败 | `5111845` | ✅ 耦合①（**把 analyzer 新抛吸收成静默 `continue`**）删 catch → `throw`；耦合②（`loadAliasConfig` 调用点）**上游不需要处理**（只读规划期、落盘在后 ⇒ 天然原子） |
| 2 | `project_root.ts` 兜底"变可见" | `bda28e1` | ✅ ★★ **实际只剩 5 处**（见 §29.2 第 1 条）—— 其余 4 处本轮前面几笔已改掉 |
| 3 | 索引器跳过构建临时产物 | `a041918` | ✅ `NOISE_FILE_RE` 加 `\.timestamp-\d+-\w+\.mjs$`；★ 改前/改后口径对比证实它原来**被算进「本体」**（幻影"真缺陷"） |
| 4 | 门的出生证抽共享 helper | `595dc03` | ✅ `tests/helpers/gate_probe.ts` 的 `expectGateGoesRed`（`finally` 还原 + `process.on('exit')` 兜底）；迁 G4 + 品牌门；★ **证伪实验**证明它是真出生证、不是橡皮图章 |
| 5a | **P-D** 入参前置校验统一 | `01a6bcc` | ✅ ★ **全仓只有 `find_references` 一个真点**；修 3 个 mode 的缺参报错 + 删 4 处 `String()` 强转 + G8 基线记账（§27.17） |
| 5b | **P-F** 告警结构化 + 两级呈现 | `ba85168` | ✅ 三个 stale 告警**首次全文/后续一行摘要** + `warnings:[{code,summary,detail,fix}]`；★ 用新 helper 做出生证，**并当场用它抓出自己一个错假设** |
| 5c | **P-G** 实测 `explore_code(read)` | `01a6bcc` | ✅ **是稳定入口**（入参显式、返回 `wrapData`、四类失败 `isError=true` + 文案可行动）；★ **空文件不抛**（返回"显示 L1-L0"退化区间）—— **如实写不符** |
| 7 | 改名 `skipped` 非空时显式警告 | `a313dc1` | ✅ `[C]` 层加 `skippedWarning()`（正文**靠前** + 逐条 `{path,why}`）；2 条测试（**真场景**：`.mts` 属 `TS_JS_EXTS` 但无解析器声明 ⇒ 真实产生 skipped） |
| 8 | 重复字面量表检测（原 PR-001） | `113bf3c` | ✅ 做成**门**（不新增工具 ⇒ 不动 G1 契约）⇒ 见 §29.3 |

**全量回归**：`226 passed / 1 skipped (227)` 文件、**`2336 passed / 5 skipped`** 测试
（基线 2284 **+52，全是新增测试**）⇒ **零回归**。

### 29.2 ★★★ 四个执行者一共纠正了我 **8 处** —— 这才是本轮最值钱的产出
| # | 我说的 | 实际 | 谁纠正 |
|---|---|---|---|
| 1 | 「`project_root.ts` 有 8–9 处要改」 | ★ **实际只剩 5 处**（192/218/675/886/897）—— 331/362/591/702/735 本轮前面几笔**已经改过** | `bda28e1` |
| 2 | §23.2「12 处」 | 表里 **13 行**；"3 保留 + 9 需变可见"实为 **3 + 10** | 同上 |
| 3 | §23.2 的表是穷尽的 | 原文件 `catch` 实测 **17 个**，表只列 13（漏 4 个） | 同上 |
| 4 | ★ §24.2 与 §23.2 **直接矛盾**：§24.2 把 `walkProjectFiles` 列进「兜底为 0 ⇒ 本轮不许动」，而 §23.2 行 192 **就是它的静默 `catch { return; }`** | 执行者判 §24.2 那个「0」是**扫描器漏计**（正则匹配不到**裸 `return;`**）—— 与 §24.3 自己承认的"聚合数不能当结论"**同因** | 同上 |
| 5 | §23.2 判 886「改」、899「保留」 | 两者**结构逐字同形**（`if (!mod) return out`）⇒ 副作用：**TS 解析失败可见、多语言解析失败静默** | 同上 |
| 6 | §16.8 的判据说「全仓 grep 断言不再出现 `undefined` 拼进路径」 | ★ **无法落成单条 blunt grep** —— required 参数上的 `String()` 与 optional 上的**文本同形**，grep 分不出 ⇒ 改为「blunt grep + 逐条分类 + 精确断言」 | `01a6bcc` |
| 7 | 「`STALE SOURCE/INDEX` 每轮附整段长文本」 | ★ 实际是 **`STALE BUILD` 压根没有状态位**（每轮都发全文）才是典型；`SOURCE/INDEX` 是"报一次就永久静默" | `ba85168` |
| 8 | （`symbol_move` 的 `skipped` 记不出来） | 结论成立，但**根因比我说得具体**：`plumbing.ts:27` 的 **`wrap` 只 `return {text: r.message}` ⇒ 丢 `data`** | `5111845` |

★★ **执行者还独立发现两处我完全没看到的东西**：
1. ★★ **`wrap` 丢 data 是系统性缺口**：lane 里 **18 处用 `wrap`（丢 data）／ 27 处用 `wrapData`（保留）**
   ⇒ **18 个工具的 [B] 结构化产物到不了 agent**。这是 **§21 规矩②在 [C] 层的缺口**，
   也正是 **§19 ④（统一 [B] 契约形状）的现成抓手**。
   ★ 已核实原文：`function wrap` → `return { text: r.message }`；`function wrapData` → 追加 `---DATA---` + `JSON.stringify(r.data)`。
2. ★ **`src/tools/rename_file.ts:33` 有一份同名私有副本 `walkProjectFiles`**，其 `catch { return; }` 同形且**仍静默**
   —— 是「**同一意图多份实现**」的**现成实例**（G4 该登记的家族）。

### 29.3 第 8 条的交付质量（★ 值得单独记）
需求原文说"**同一个映射表被复制了 6 份**" —— 执行者找到了 **3 个真实家族，各 6 份**：

| 家族 | 是什么 |
|---|---|
| `lane-tool-def-table` | **6 条 lane 的 `ToolDef[]` 表形状完全一致**（`description/handler/inputSchema/name/title` 五个公共 key）—— ★ 讽刺的是，**lane 的工具定义表本身就是"同一张表被拆成 6 份"** |
| `removed-feature-rules-table` | 6 个语言适配器的 `REMOVED` 规则表 |
| `feature-rules-table` | 6 个适配器的 `FEATURES` 规则表（C/C#/Go/Java/Node/Python） |

- **判据**：数组元素的**属性 key 并集**作形状指纹（同指纹 ≥ 2 份即报重复组）
- **门的自检完整**：指纹同/异两向 + 多元素并集 + **"注入两份同形状表 ⇒ 门确实变红"（出生证）**
  + "至少找到一组真重复"（反证门不是哑的）
- ★ **编号**：我原台账把 `lane_sources` 叫 **G9**（但它代码里不自称），新门也叫 G9 ⇒
  **我把新门改为 G10**（`tests/duplicate_literal_tables.test.ts` + fixture 的 note）

### 29.4 还剩什么（§28.3 的剩余项）
- **P-B** `edit_code` 批量 `targets[]`
- **P-C** `plan_refactor` / `apply_refactor_plan` 成对（会改 G1 契约 67 → 68/69）
- **P-E** "完成 ⇒ 可验证产物"写进 `docs/tool-convergence.md` + G7 扩到全部工具
- **§19 ④⑤⑥**：统一 [B] 契约形状 → 面收敛 + 重排（不留墓碑）→ 清过渡物
  ★ **抓手已现成**：`wrap` 丢 data 的 18 处（§29.2）+ `rename_file.ts` 的同名副本

