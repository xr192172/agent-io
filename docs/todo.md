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

- [ ] **T12 ★ 搬迁工具 `renameFiles` 漏改「内联 `import('…')` 类型引用」**
      *(核实：09-30 搬 `src/dsl/` → `src/domain/` 时实测 —— `src/renderer/html_renderer.ts:89` 的
      `function renderContentBlocks(blocks: import('../dsl/types.js').ContentBlock[])`
      **没被改写** ⇒ `tsc` 报 `TS2307: Cannot find module '../dsl/types.js'`。
      · 全仓共 **5 处**这种写法（另 4 处指向 `node:fs` / `../db/db.js` / `./monolith.js` / `./fill.js`，
        当前恰好都还成立 ⇒ **只有 1 处当场炸**）
      · ★★ **这是个定时炸弹**：`derive_feature_tree.ts:33` 的 `import('../db/db.js')` 在我们搬 `db/` 时
        **会同样炸**；`serve.ts:587` / `project.ts:126` 同理。)*
      ⇒ 修法：让 `rename_file` 的 import 改写**同时认 `import('…')` 形式**（它现在只认 `from '…'`）。
      ★ 兜底：`tsc` 是安全网（会报 TS2307），但**每一族搬迁都会踩一次** ⇒ 值得先修工具。

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
