# 待办清单（★ 唯一一份）

> ## 规则（用户裁定，2026-09-30）
> 1. ★ **只维护这一份**。活台账正文（`architecture-refactor-plan.md`）、收敛文档、各门 fixtures、
>    以及各处的"遗留 / 待办 / 未动"叙述 —— **都只是历史记录，不作为待办**。冲突时以本文件为准。
> 2. ★★ 做完一项 ⇒ **写好回执**（commit message + 项目记忆），**然后把这一行从清单里删掉**。
>    **不留划线、不留"已完成"专区** —— 回执在 commit 历史里，清单只放**还没做的**。
> 3. ★ **全表清空 ⇒ 整个文件删掉**（或移入 `docs/archive/`）。清单是**结页即销毁**的，不是台账。
> 4. ★ **不建门、不建 fixture、不建棘轮基线** —— 那等于再养一个**状态群**，
>    而状态群**会腐、腐了没人知道**（详见文末"为什么这么定"）。
> 5. 新增项**必须已核实**才能写进「待做」，且写清**核实方式**。没核实的进「待核实（不是欠账）」。
> 6. 只做清单上的内容。清单外的事 ⇒ 先讨论要不要上清单，**不要顺手做**。

---

## 待做

- [ ] **T15 ★★ 把 CLI-only 的能力注册为 MCP 工具 ⇒ 「CLI-only」这个类别应当**归零****
      *(用户裁定的洞察 2026-09-30：「**工作台为什么不能注册为 MCP 呢**？就是说**同样同时投影为 MCP 和 CLI**，
      这样的话就**不用保留为 CLI only** 了。」)*
      ⇒ ★ 唯一真相源 = **MCP 注册**（`registry/lanes/*.ts` 的 `ToolDef`）⇒ CLI 是**投影出来的**。
      所以「CLI-only」这个类别**根本不该存在** —— 它只说明**能力被藏在了 MCP 面之外**。
      **要做的事**（两个方向合流）：
      · ① `brickify_cli`（**11 个输出产物的积木工作台**）与 `diagnose_loop_cli`（一键诊断闭环，`--apply` 会改代码）
        ⇒ 注册为 MCP 工具（它们**不是**别的工具的 CLI，是独立能力）
      · ② B 类 10 个 CLI-only（`archify_cli` `capability_cli` `deprecate_offline_cli` `install_package_cli`
        `signal_review_cli` `split_stage_cli` `upgrade_cli` `upgrade_rewrite_cli` `instrument_cli` `translate_cli`）
        **逐项判**：其中 `capability_cli` / `instrument_cli` / `translate_cli` **对应的 MCP 工具已存在**
        （`capability_map` / `observe_instrument` / `translate_go_ts`）⇒ 那三个只需**删 CLI**；
        ★ **2026-09-30 更正（逐项核过，上面那句要打折）**：
        · `instrument_cli` **不是"只需删"** —— 它的 `--ledger`（查看探针台账）在
          `observe_instrument` 的 `action` 枚举里**没有对应项**（枚举只有 `instrument|uninstrument|restore`）
          ⇒ 直接删会**丢掉一个能力**。要么给 MCP 面补 `action=ledger`，要么先确认"台账可由写盘自动产出、不必回看"。
        · `instrument_cli` **不是库**（我上一轮曾据子 Agent 的转述说它"没有 argv 解析" —— **是错的**，
          它第 166 行就是 `runInstrumentCLI(process.argv.slice(2))`）；它已随 ③-4 搬到
          **`src/presentation/cli/instrument_cli.ts`**（§44.2 归属）。
        · `archify_cli` / `install_package_cli` 也是**真 CLI**（有 argv 解析），别按"库"处理。
        其余**注册为 MCP 工具**（或明确判为"一次性运维脚本"，给理由）
      **牵连**（必须同一次做，否则门会红）：
      · `tests/fixtures/tool_set_snapshot.json`（58 个工具）⇒ `UPDATE_TOOL_SNAPSHOT=1` **并记账**（对外契约变更）
      · `README.md` / `AGENTS.md` 要提及新工具名（否则 `readme_tools_gate` 红）
      · `package.json` 里 13 个指向 `dist/src/tools/*_cli.js` 的 scripts ⇒ 改为走投影
      · `tests/server_registry.consistency.test.ts` 的 `INTERNAL_MODULES` 登记表要同步（删文件的 `importedBy`）

- [ ] **T14 ★★ 一致性门对 `export async function` 完全失明 —— 实测 **29 个文件**被整类豁免**
      *(核实：09-30 —— `tests/server_registry.consistency.test.ts:228` 的正则是
      ``new RegExp(`export\\s+function\\s+${camel}\\b`)``。**实测**：`export function X()` 匹配 ✓，
      **`export async function X()` 不匹配 ✗**；而 `src/tools/derive_anim_flow.ts:292` 正是
      `export async function deriveAnimFlow(...)`。*
      *量具：`.inspect/survey_async_export_blindspot.mjs`（含对照项证明脚本不哑）。)*
      ⇒ ★★ **命中 29 个 `src/tools/*.ts`**，含 `edit_code` / `explore_code` / `find_references` /
      `import_project` / `detect_drift` / `derive_mind_map` / `harvest_from_url` / `index_integrity` /
      `rename_*` / `reconcile_*` … —— 它们的 `isToolImpl` 恒 false ⇒ 门**直接 `continue`**
      ⇒ 这些工具**丢了注册也报不出来**。
      ★ 这正是那 7 个死模块能躲过一致性门的原因之一（子 Agent 推断 + **我已独立实测证实**）。
      ⇒ 修法：正则改成认 `async`（`export\s+(?:async\s+)?function\s+`），**并给门做出生证**（注入一个 async 工具不注册 ⇒ 必须红）。

- [ ] **T13 ★ 第 4 / 5 处 import 解析口径：`rename_file` 的「TS/JS 一份 + Python 一份」**
      *(核实：09-30 做 T12 时顺带撞到 —— `src/tools/rename_file.ts:23` 引的是
      **`src/db/symbols.ts:155` 的 `resolveImportTarget(projectRoot, fromRel, source)`**：
      `return resolveImportPath(fromRel, source, (c) => fs.existsSync(path.join(projectRoot, c)))`
      —— ★ 它只是内核 `resolveImportPath` 的**薄包装，且没传 `exts`** ⇒ 走 `IMPORT_EXTS` 默认
      ⇒ **只认 TS/JS 系扩展名**；子目录 import / 点分模块 / 裸名**都不认**。
      而 `rename_file.ts:297,305` 对 Python **另走本地 `resolvePythonTarget`**。)*
      ⇒ ★ 这是 §38 收口那三份（health / impact / import_project）之外的**第四处**，
      且 `rename_file` 同时持 **TS/JS 一份 + Python 一份** ⇒ **第五处**。
      ★ 影响（未量）：`rename_file` 判定"某个字面量是否真的解析到被移动文件"时，这些形态**可能漏改**。
      ⇒ 方向：并进内核 `resolveProjectImport`（传真实 `exts`），但**先量差集**再动（改名是正确性敏感路径）。

- [ ] **T11 ★ P2 的真正前置：`src/tools/` 那 157 个"没有归属"的文件，先做身份普查**
      —— ★ **第一切片已做完（台账 §42）**：194 个顶层文件定性 =
      **49 工具实现**（可机械归属）/ **17 CLI** / **119 内部 helper**（最大块，**还要再分**）/
      **1 入口点**（`serve`）/ ★ **7 死代码候选**（`batch_ops` `derive_anim_flow` `get_dsl`
      `observe_chain_view` `refactor_report` `run_narrate` `view_inputs`）/ **0 无人引用** / **1 需裁决**（`index_freshness`）
      **剩下的三片**：
      · (a) ★ **119 个内部 helper 再分**：算法内核 / 工具间共享 / **旧世代遗留**（`archify_*`、`brickify` 那族像上一代工具）
      · (b) ★ **7 个死代码候选逐个判死**（`get_dsl` 已是强候选：与 `list_features` **同型** —— `handlers` 的 `getDslHandler` 直通 `queryFeature`）
      · (c) `index_freshness` 归 harvest / observe / 下沉 kernel
      *(核实：09-30 `.inspect/survey_tool_identity.mjs`；★ 该量具**被打了三次脸**才可信 —— 详见 §42.2)*

- [ ] **T10 ★ 量具的「分层」表还是已废除的旧三级（`contract/brick/glue`），P2 的验收判据因此判不了**
      *(核实：09-30 实测 —— `src/health/index.ts:39` 的 `Layer` 仍是旧三级；
      30 条 `layer_violation` 里 **21 条是测试文件 import `server_registry`**，而测试压根不在分层里 ⇒ **假读数**。
      代码注释逐字：「`surfaces/features/kernel/dsl` 四层。**故意不在 P0 就换** —— 换表留给 P2 落地那一刻」；
      而台账 §4/P2 的验收写的是「**无新增层违规（用 P0 修好的量具看）**」——
      ★ **两处口径不一致**：P0-⑤ 实际做的是"分层与 root 无关"（判据 `classifyLayer('server.ts')==='glue'`），**不是换表**。)*
      ⇒ ★ 这是 **P2 的前置**：不换表，"搬家没搬坏"就没有机器可判的信号。
      设计要点：新表 + **让"还没搬完的"落进 `unclassified`**（而不是判成违规），这样中间态可测且唯一可收敛。

- [ ] **T4 `unused_export` 对"带 parent 的方法"有盲区**（`symIndex` 只收顶层符号）
      ⇒ 改 `symIndex` 的**收面**。
      ★ 做完这条，`code_health` 纳入 scala/groovy/julia/haskell/elixir 那 5 门的**判据二**才可能达标。
      *(核实：09-29 实测 `Helper.twice(3)` 的被调 `twice` 挂 object 下进不了 symIndex)*

- [ ] **T5 注册表 `typescript` 条目缺 `.mts/.cts`**（现由 `TS_JS_EXTS` 保底不丢，但注册表本身该补）。
      *(核实：09-29 逐扩展名差集)*

- [ ] **T6 `resolveProjectImport` 的 `go-module` 层无任何调用方**
      （health/impact 都不传 `goModules`），且与第 6 层 `package-dir` 有**有意的不对称**
      （前者取目录内首个文件 / 后者要求恰好一个）⇒ **要么接上、要么删层**，别让它悬着。
      *(核实：09-29 全仓 grep 调用点)*

- [ ] **T7 `docs/tool-convergence.md` §8.5 已过时** —— 仍记着「`wrap`/`wrapData` 未收敛，属另一笔」，
      实测已收敛（lanes `wrapData` 42 处 / `wrap` 0 处）。⇒ 改一句指向或删该段。
      *(核实：09-30 实测计数)*

- [ ] **T8 把「待核实」那 11 条逐条核实**：真的逾期 ⇒ 上「待做」；已还清 ⇒ **删掉**。
      *(核实方式：逐条去代码/门里取证，不许只读散文)*

---

## 待核实（**不是欠账，不许当事实用**）

来源：09-30 一次「扫旧节号里的'遗留/待办'」的梳理。★ **该梳理交回 21 条、全标 `open`，
核验后当场证伪 2 条** ⇒ 所以这里只当**线索**：

G3 分层方向门 / G4 可达性门 / G5 README 计数自愈 / P-A 回执稳定字段 / P-D 入参校验统一 /
P-G 实测补齐 / `symbol_move` 1 处 null 契约 / `project_root` 5 处兜底 /
`refs_text` specifierCandidates / `explore_code` 5 个空壳 action / 仓库资产索引 /
P2 四族搬迁 / P3 抽字符串 / P4 工具名拍板 / G1 复杂度阈值标定 / orphan 剩 7 个待判

---

## 为什么这么定（背景，读一次就够）

**状态群** = 一份需要人喂、且**腐了没人知道**的东西（登记表 / 基线 / allowlist / frozen 计数）。
09-30 实测 `tests/fixtures/` 10 个文件，按更新机制分三类：

| 类 | 数量 | 是不是负担 |
|---|---|---|
| 自动重生成（`UPDATE_*=1` 一条命令） | 6 | 否。其中 **G1 对外契约 / G8 行为等价** 有**独立判据**，改基线**必须记账** ⇒ 是「**变化即红**」 |
| 空表（`frozen={0}`） | 1 | 否 |
| ★ **真手维护** | 1（删掉「扫描边界门」的登记表后） | ★★ 是 |

★ 判"是不是自己验自己"，**不是问有没有 `UPDATE_*`**（那只是入口），而是问：
**这份基线的期望值，是不是从当前实现反推出来的？**
有独立判据 ⇒ 靠谱；纯棘轮存量 ⇒ 它冻结的是**当时的读数**，而读数**可能本来就是假账**
—— 09-30 那份 21 条就是活证（2 条是假的，若做成棘轮会被原样冻成"允许的存量"）。

★ 已清出清单的一笔（回执在 commit 历史里，此处不留）：**删掉「扫描边界门」+ 其 43 条手抄登记表**
（`a1a7def`）—— 因为实测那 43 条**无法机械重现**（会多报 51% 且漏 13 条，即它是**判断**不是抄写），
它买到的只是"别再加第 24 个不带 `bounds` 的扫仓库工具"，不值得养 71 条手维护状态。
