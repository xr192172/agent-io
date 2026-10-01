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

- [ ] **T20 ★★★ 摘掉"事实镜像"：意图册只放意图；一致性靠"编辑时强制读双份"（用户 2026-10-01 指出）**
      *(核实：2026-10-01 —— `docs/data-ledger.md` **附三**；台账 §44.22。)*
      ⇒ 用户原话：「**意图册有三项东西，但是有一项东西其实本身就是代码的权威吧**。…编辑人都是同一个，
      他当然知道自己编辑的是哪一份了。**你只需要在他编辑的时候，让他强制读完双编**不就可以了吗？」
      ⇒ **定性（已取证）**：`expected_apis` = **意图**（权威在 DSL）；`actual_apis`（`backfill.ts:287` 写）与
      `actual_deps`（`import_project.ts:1856` 写，注释自陈"**语义层持有真实 import 事实**"）= ★★ **代码的权威**，
      却**镜像进意图册** ⇒ **第二份可写副本 = 判据分叉的温床**。
      ⇒ ★ **好消息**：`detect_drift` 跑 `checkConsistency` **直接对代码**（`detect_drift.ts:8`）⇒ **摘镜像不伤对账**。
      ⇒ ★★ **推论**：`scaffold action=backfill` 的**全部存在意义 = 维护这份镜像** ⇒ 镜像去掉它就该**剔除**。
      **施工顺序（不能反）**：
      · (1) ✅ **已落**（2026-10-01）：**建唯一 accessor `src/infrastructure/index/file_facts.ts`**
        （`fileFacts(root, fileRel, feature?) → { apis, deps, source, matched_path }`，读 `cache.db` 的 `nodes` + `edges`），
        并**改掉 5 个读镜像的读者**：`derive_mind_map`（`buildFileIndex`/`isHuskFile`/`fileDesc`）、`overview`（LLM 签名材料）、
        `query_feature`（`actualCount` + "已实现 API"区块）、`opl`（喂 LLM 的上下文）。`archify_semantics` 无需改（消费 `buildFileIndex` 的产物）。
        ★ 事实出处不再新增字段：**DSL 自带 `source_root`**（`import_project.ts:1399`）⇒ 读者按 `source_root` + `f.path` 去取。
        ★★ **本笔过程中 accessor 自己被抓出 3 个真缺陷**（都由执行者或自测逼出，已修）：
        ① **路径前缀不一致** ⇒ 改成 accessor 内单点"先精确、再后缀匹配"；
        ② ★ **后缀匹配会静默给出别处的事实**（查空项目的 `a.ts` 竟命中本仓 fixture）⇒ 收紧为**唯一才用、有歧义就不猜**；
        ③ **自造第二个连接池** ⇒ Windows 删项目目录 **EBUSY** ⇒ 改为**复用 `db.ts` 的 `projectCachePool`**。
        另修：`fileFacts` 抛错遇上 `overview` 的 fire-and-forget 链 ⇒ 补 `.catch`（**失败可见，不让它变 unhandled rejection**）；
        `query_feature` 的"已实现 API"行号注记 ⇒ 用 `start_line` **逐字还原 `line N`**（与 `backfill.ts:97` 同格式）。
        ★ 新增 `tests/tools/file_facts.test.ts`（8 项真行为 + 边界：前缀不一致 / 歧义不猜 / 闭包排除 / 连接复用）。
      · (2) **再摘字段**：`actual_apis` / `actual_deps` 从 `domain/semantic.ts` 与 DSL schema 移除；
      · (3) **最后删产者**：`scaffold action=backfill`；`import_project` 里回填 `actual_deps` 的那段；
      · (4) **加 `edit_dsl` 的"先读后改"门**（本仓已有同款：`explore_code action=read` 是 `edit_code` 的前置，
        `explore_code.ts:312`）⇒ 改 `semantic.files` 前**必须已读该文件的事实**（现取）；
        ★ 复用 `evidence`/L4 那条已有机制，**不另发明**。
      ⇒ ★ **另记一条既有隐患**（本笔发现，未改）：`resolveFunctionCacheDb` 的第三级候选是 **`<cwd>/.agent-io/cache.db`**
        ⇒ 一个**没有自己索引**的项目会读到 **cwd 那个项目**的库。本笔靠"`matched_path` 必须命中"挡了误报，
        但**根上仍是 T19 的"根"问题**，应在 T19 里一并收口。
      ★ 验收：DSL 里不再有"事实"字段；`scaffold` 只剩 `generate`；漂移在**编辑入口**被挡（而不是事后靠 `detect_drift` 发现）。

- [ ] **T19 ★★★ 数据流水账 → 工序模型（Stage）：剔除重复 + 抽出"每份数据的加工工序"作为真接口**
      *(核实：2026-10-01 —— **`docs/data-ledger.md`**（账本主表 + **附：工序模型** 章节）；台账 §44.19/§44.20。)*
      ⇒ ★★ **用户的纠正（要认账）**：§19 他说"抽接口"，我理解成"抽 [B] 纯函数"，据此得出"实测无事可做 ⇒ 撤销"——
      **抽错了对象**。他要抽的是**每一份数据的加工工序**（他原话："每一个功能就在它上面**加一步**、再加一步"、
      "这个数据没有，就**往上面去溯源上一级的加工工序**"）。
      ⇒ **形状**（写进文档）：每份数据 = 一道 `Stage { id, owner(根), inputs(上游), fresh(), produce() }`；
      读 = `ensureStage(id)`：不新鲜 ⇒ **递归 ensure 上游** ⇒ `produce` 落盘。
      ★ **不是发明新机制**：`ensureProjectIndex → ensureFreshIndex → syncFile` 这道**已经天然长这样**，把它推广到每一份数据即可。
      **已经做完的**：
      · ✅ **第 1 刀：剔死物**——`project_metadata` 死表（`schema.ts` 零读写）、死导出 `getArchiveEntry`/`deleteDSL`、
        `server_registry.ts` 的 5 个死导入、`package.json` dogfood 脚本路径（原指向**陈旧 dist ⇒ 静默跑旧码**）。
      · ✅ 账本：19 个数据项的「谁产/谁消（到 file:line）+ 缺了怎么补 + 何时失效」全表；
        **工序清单**（哪道工序缺 `fresh`/缺"唯一产者"）；**剔除清单**（重复/孤儿）。
      **要做的（一笔一刀）**：
      · ~~(2) 归一 DSL 三份重复~~ ✗ **撤回**（2026-10-01 读代码后更正）：`agent-io.json`(活态) / `features/<f>.json`(存档) /
        `live/<f>.dsl.json`(代码现状快照) **不是重复，是三种语义**，由 `getDSLByView` 的视图分层承载。
        留下的小问题只有：`agent-io.json` 是**全局单文件**（多 feature 只装最后编辑的那个）。
        ★ 教训：**指控"重复"前必须读两侧的语义（视图/生命周期），不能只看"内容像"**（本笔第二次犯）。
      · (3a) ✅ **已落**：`import_cache_<feature>.db` 的**写侧**从 `process.cwd()` 改到 `getStorageRoot()`
        （`serve.ts:392,441`）⇒ 与 3 个读侧（`function_outline.ts:68` / `overview.ts:155` / `derive_mind_map.ts:904`）
        **同根**，修掉"同名两根 ⇒ 写读不碰面"。
      · (3b) 待做：`health_cache` 的根从 `cwd` 改回 **project**（`health_cache.ts:27`）；
        以及**给"根"加门**（每份数据声明 `owner`）。
      · (4) ★ **抽第一道真工序并接上溯源**：让 `dsl_baseline` / `dsl_live` 的**读者**在缺时自动 `ensureStage`
        （现状：只有写侧单点补（`import_project.ts:1479`），读侧拿到 null/404 就完事）；
      · (5) ★★ **补"符号级绑定点"**（用户 2026-10-01 提的"两份数据双向绑定"的真缺口）：
        现在两份数据（DSL=意图 / `cache.db`=事实）**只在文件级配对**（`semantic.files[].path` ⟷ `files.path`，
        且同一条目里 `expected_apis` / `actual_apis` 并存 —— **这已经是现状**）；
        **符号级没有稳定键**（DSL 侧是 `signature` **文本**、解析侧是 `qualified_name`）⇒ 只能近似匹配。
        ★ 这与 ④ 的「符号身份 = (file, name)，不是全局唯一 id」是同一个根问题。
      **★ 账本同时暴露的三件现症（都在这一条的范围内）**：
      · **根的分歧**：`getDataHome()` = `AGENT_IO_HOME ?? getPackageRoot()`（`storage.ts:60`，自省包根、与 cwd 无关）
        ⇒ **"每项目一个数据库"目前只对 `cache.db` 成立**（DSL 三态落**包根**、健康缓存落 **`cwd`**、读侧兜底第三个 `cwd`）。
      · **两处观测侧功能级断裂**（与"根"同源，但要单独修）：
        (a) `scripts/setup.mjs:39,264` 仍写 **`.agent/camera`**，对账读 **`.agent/observe`** ⇒ **完全不重叠**
            ⇒ 官方流程产的事件，`reconcile_*` **永远发现不了**（改名 `camera→observe` 时 setup 漏改）；
        (b) 写端激活 **`OBSERVE_EVENTS_FILE`**（`run_sentinel.ts:26`）vs 读端认 **`DS_OBSERVE_EVENTS`**（`observe_trace.ts:43`）
            ⇒ **无桥接**，按文档设了也白设。
      · **`embedding_cache` 无失效无淘汰**（`semantic_search.ts:162`）。
      ★ 门要管的是 **"根的选择"**，**不是**"`.agent-io` 字面量"——实测代码里字面量只有少数几处
      （136 行命中绝大多数是注释）⇒ "字面量被抄多份"不是主要问题。

- [ ] **T18 ★★ ④ [B] 契约形状的落地（术语表已定，按表重构）**
      *(核实：2026-10-01 —— `node scripts/measure_b_contract.mjs --glossary`；台账 §44.15~§44.17。)*
      ⇒ **已定**（不再改口径）：
      · **受控术语表** = `src/domain/b_terms.ts`（`B_TERMS` + `Touched`），文档 `docs/glossary.md`（生成）；
        **机检通过**：共用字段名 **58 个 / 未定义 0**；**债务 39 条**（棘轮只许减）。
      · **规范 vs 现状分开**：含义栏是"从此以后要求它是什么"；现状见 `docs/b-field-dictionary.md`。
      · 规则：**出现在 ≥2 个 [B] 的字段名必须有定义**；私有字段（占 80%）不约束。
      **要做的**：
      · ~~(1) 先定 ④-b 的"统一构造点"做法~~ ✅ **④-b 已完成**（`withTouched` 统一构造点；见台账 §44.18）：
        `rename_file` / `rename_files` / `rename_symbol` / `rename_symbols` / `find_references` 五个 [B] 已接上 `Touched`，
        新增 `tests/tools/touched_contract.test.ts`（6 项真行为验证 + 出生证）。
      · (2) **接着按族推**：④-c design → ④-d harvest（根别名最多）→ ④-e 其余 + **棘轮收紧**
        （新增 [B] 必须给 `touched`）。★ 每族照 ④-b 的办法：**先定形状 → 1 文件 1 个子代理并行 → 我串行核验/验证/提交**。
      · (3) 按各条的 `fix` **还债**，优先三个最刺眼的：`files`（6 义）/ `stats`（5 义）/ `written`（布尔与列表混用）。
      · (4) ★ **④-b 暴露的同源缺口**（都在"**Core 内部算出的东西没进产物**"这一点上）：
        · `rename_symbols` 的 local 支 / apply_literals 支 ⇒ 给不出仓库相对的完整文件表 ⇒ 只能整项省略；
        · `rename_symbol` / `find_references` ⇒ 入参没给 `project_dir` 时，Core 推导出的根拿不到 ⇒ 只能省略。
        ⇒ 处置：让产物**回传 root / 字面量文件表**（属"产物形态"的改动，单列一笔）。
      **牵连**（每族一笔）：G8 行为快照 `UPDATE_TOOL_BEHAVIOR=1` 并记账；G1 仅当描述/入参 schema 变了才动。
      ★ ④-b 实测：**G8 人群不含这些"重活"工具** ⇒ 加 `touched` 不会动 G8 快照（行为验证改由新测试承担）。
      ★ **已知一条 warn 会随本项消失**：`arch` 报 `no-orphans: src/domain/b_terms.ts`
      （契约尚未被 app 采用 ⇒ **故意不藏**；第一个 [B] 用上 `Touched` 后自动消失）。

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

- [ ] **T17 ★ `explore_code` 的 `derive_algorithm` action 是空壳（已核实）**
      *(核实：2026-10-01 做 T14 时顺带读到的 —— `src/application/meta/explore_code.ts` 的
      `case 'derive_algorithm'` 只有 `{ project_dir: requireStr(args,'project_dir') }` 然后 `toResult(r, true)`，
      **从不调用** `deriveAlgorithm`；而 `src/application/design/derive_algorithm.ts` 的主函数
      `deriveAlgorithm` 全仓**只有常量 `KIND_SHAPE` 被 derive_chain 复用**，主函数无调用方。)*
      ⇒ 同族嫌疑（**未核实完，别当事实用**）：`case 'derive_split'` 传 `[]`、`case 'derive_chain'` 传
      `buildCallGraph([],[])` —— 两个入参都是空，形似空壳；`derive_anim_flow` 已于 2026-10-01 接真实现。
      ⇒ 这是 G7（宣传-实现一致性）那一笔：action 宣告了能力却没接实现（对 agent 说谎）。

- [ ] **T10（2026-10-01 重写，原前提已被越过）★ `code_health` 的分层表仍是旧三级，读数已无意义**
      *(原条目写的是"P2 的验收判据因此判不了"—— ★ **该前提已不成立**：P2 早已搬完，
      且架构验收判据**已换成 dependency-cruiser**（`.dependency-cruiser.cjs` 的 `layer-downward-only`），
      不再依赖原来那个 `src/health/` —— 该目录已随 P2 搬成 `src/infrastructure/analysis/health/`。)*
      ⇒ **还成立的**：`src/infrastructure/analysis/health/index.ts:39` 仍是
      `export type Layer = 'contract' | 'brick' | 'glue'`（旧三级），而 `code_health` 是**已注册工具**，
      它的 `layers: {contract,brick,glue,unclassified,violations}` 读数与现在的四层目录**对不上**。
      ⇒ 要么把表换成四层（`presentation/application/infrastructure/domain`），要么把这段读数**摘掉**（别报假数）。

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
