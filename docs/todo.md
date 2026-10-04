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
      · (2)(3) ✅ **已落**（2026-10-01，台账 §44.24）：字段从 `domain/semantic.ts` **移除**；
        **剔除产者** —— `scaffold action=backfill` **整条删** + `backfill.ts`（320 行）删 +
        `import_project`/`opl` 的回填删 + `handlers.ts` 的**墓碑壳** `backfillHandler` 删。
        ★★ **删字段 = 让编译器当量具**：`tsc` 立刻报 25 个错，其中 **15 个来自上一轮"读者清单"完全没列到的读者**
        （`diff_views` 12 处 / `narrate_step` 2 / `diff_impact` 1）⇒ **别用 grep 列消费者清单**。
        ★ 新增 `file_facts.mergedApis()`：把 `[expected, ...actual]` 这个 6 文件 20+ 处的形态收成单点。
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
      · (3b) ✅ **已落**（两笔）：①「cache.db 定位」收成**唯一权威**（台账 §44.25）——
        `db.ts` 新增 4 个具名函数（`projectCacheDbPath` / `featureCacheDbPath` / `findCacheDb` / `nearestCacheDb`），
        **20 处副本 → 4 个具名函数**（K1 已知根 10 / K2 导入缓存 5 / K3 候选搜索 3 / K4 向上逐级 2）；
        G4 加两族门（`cache-db-path` / `feature-import-cache-path`，**frozen 均空 = 零容忍**）。
        ② ★★ **给「根」加门**（台账 §44.26）—— **每份数据必须声明 `owner`，且声明要能被证伪**：
        登记表 `tests/fixtures/stage_registry.json`（15 道工序：`owner`/`inputs`/`fresh`/`producer`/`resolver`）
        + 门 `tests/registry/root_declaration.test.ts`（16 项）。★ 核心判据**是行为不是文本**：
        `owner='project'` 的解析器，拿**两个不同的根**跑**结果必须不同** —— 这正是 `health_cache`
        旧 bug（忽略入参、偷用 `cwd`）的形状。另把 4 处内联的"根"提升为**具名导出**（让 owner 可见）。
        ★ 两条实测教训：出生证又抓出**假绿**（白名单做成模块级 ⇒ `db.ts` 里两种根被一起放行）；
        据此立通则「**白名单粒度必须与判据粒度对齐**」（与 §44.25 那条同族）。
        ★ **仍未做**：`findCacheDb` 第三级候选仍是 `<cwd>`（**只单点化、没改语义** ——
        改语义要改的是"没索引的项目该不该读到 cwd 那个项目的库"，属下面的工序溯源范围）。
        · ③ ✅ **门的独立核验**（台账 §44.27）：派**独立子代理**（不给它看账本/登记表）从 `src/` 自己清点
          ⇒ 清出 **≈18 项漏登记 + 3 处"同一份数据两个根"**。我逐条抽验：
          **① `features/<f>.json` 写 dataHome、读 cwd = 真 bug（与结论二同型）⇒ 已修**
          ★ 且 `getFeaturesDir()` 的**注释自己写的就是 `<cwd>`**（与实现不符）⇒ 一并改；
          **② `live`/`baseline` 两个根**、**③ `archive` 写读不对称** ⇒ 坐实，入册为新字段 `rootConflict`（棘轮）。
          ⇒ 门加固：工序 15→18；新增 `rootConflict`（当前 3）与 `notRegisteredYet`（当前 18）两条棘轮。
          ★ **口径**：`noneDebt` 6→8 **不是新增债**，是两笔债**第一次被看见**。
        ★ **仍未做（本笔如实不收口）**：`notRegisteredYet` 那 **18 项**尚未登记 owner；
          `archive` **写侧不传 baseDir** 是实现问题（本笔只入册未改实现 —— 要连"归档跟 design 还是跟 live 走"一起定）。
        · ④ ✅ **删兜底**（用户一句「越兜越多」，台账 §44.28；账本**附五**）：
          ★ 用户那句话是**冲我上一笔的做法**说的，而且说对了 —— 我把三级候选链**固化成"权威"还配门保它**、
          把 `health_cache` 的兜底**从函数里搬到调用点**、又加了 `notRegisteredYet`（"没登记的先记着" = 新兜底）。
          ⇒ 判据（**不按"有没有 `??`"分**）：`?? getDataHome()` = **默认值**（留）；
          `source_root ?? project_dir` = **两个来源一个语义**（留）；`?? process.cwd()` = ★★ **换题**（删）。
          **11 处 `?? process.cwd()` 全删**（没有一处改成另一个兜底）：可选工序⇒skip / 必须的⇒抛 / HTTP⇒400；
          `findCacheDb` **第三级 `<cwd>` 也删了**。新增单点 `storage.ts#requireProjectRoot`。
          ★★ **测试失败是证据**：`monolith` ×3 靠 cwd 兜到了**测试进程自己的目录**；
          ★★★ **G8 行为快照那条 = 基线在替 bug 作证**（旧基线是 `feature_line` 通过 cwd **读到本仓自己的
          `.agent-io/cache.db`** 产生的）⇒ 按 G8 规程更新基线（diff 只动 1 条）+ 记账。
          ★ 边界：**删兜底 ≠ 收口** —— 现在"缺"是响亮的，但**还没人去补**；那是下面的第 (4) 步。
        · ⑤ ✅ **工序表：唯一数据源 + 自行投影**（台账 §44.29；用户："你写这么多夹具其实就是在手工替代编译器"）：
          **删掉** `tests/fixtures/stage_registry.json`(198) + `tests/registry/root_declaration.test.ts`(647)
          + 账本里**手抄的工序清单表**(26) ⇒ 换成 **`src/application/stage_registry.ts`：一张 typed 表 + 自行投影**。
          ★ 关键改动：产者/位置从 `'file#symbol'` **字符串**改成**值引用** ⇒ **编译器接管**「存在性/改名/签名」；
          `inputs` 用 `StageId` 联合类型、`pending/source` 用**判别联合**强制 `why` ⇒ 编译期查；
          ★ 还**删掉了手抄的 `fresh` 分类字段**（由 `isFresh`/`locate` 的有无推论）。
          **消融实测**：注入 `inputs` 打错 / 漏 `why` / 产者改名 ⇒ `tsc` **全抓且带 "Did you mean"**；
          这三样**旧写法下一件都查不出**。门 647 行 → **15 项**，检查反而更强。
          ★ **本次已实现功能**（用户："你实现功能即可…失败了就重试，不要做任何兜底"）：
          `ensureStage(id, ctx)` —— **缺了就重做**（已接 4 道真工序）、**溯源上游**、**失败重试 3 次**、
          仍失败**抛**；`source`/`pending` 缺 ⇒ **响亮抛**，一处不兜底。
      · (4) ★ **抽第一道真工序并接上溯源** —— ★ **部分已落**（上面 ⑤ 已接 4 道真工序并跑通 `ensureStage`）；
        **剩下**：让**现有的读者**在缺时**自动 `ensureStage`**，而不是"拿到 null/404 就完事" ——
        `dsl_baseline` 的读者（`diff_views.ts:239`）、`dsl_live` 的读者（`serve.ts:321`、`diff_views.ts:237`）。
        ★ 注意 `dsl_live` 目前是 **`pending`**（产者要 `import_project`，且带 `baseDir` 可覆盖 ⇒
        接之前必须先定"写读两侧怎么保证同一个根"，否则接上就是接一个**更快的分叉**）。
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

- [ ] **T32 ★ README 子标题工具计数无门、已漂**（2026-10-04 由 T8 核验升级）。
      *(核实：`README.md:113` 的「共注册 **N**」有 `scripts/readme_tools_gate.mjs` 自愈守着（当前 59=59 ✓），
      但**子标题里的中文计数无门**。实测 `README.md:155`「专项工具（**34 个**）」，而该段表内 `` | `tool` | `` 实为 **44** 行 ⇒ **漂 10**；
      `:143`「主工具（7 个）」= 7 行、`:115`「能力导航（1 个）」= 1 行，当前一致。)*
      ⇒ 方向：把自愈从「共注册」扩到子标题计数，**或**去掉子标题里的数字（只留"精选"语义）。

---

## 待核实（**不是欠账，不许当事实用**）

来源：09-30 一次「扫旧节号里的'遗留/待办'」的梳理。

★★ **2026-10-04 逐条核验（grp-docs，代码级取证）**：原列 **16 条**（注：任务标题写的“11 条”与实际条数不符）。
逐条到代码/门/工具取证后：**14 条已还清或已被既有条目覆盖 ⇒ 删**（逐条证据见核验回执 / commit 历史；
含 `G3/G4 门`、`P-A/P-D/P-G`、`symbol_move`/`project_root`、`refs_text`、`仓库资产索引`、`P2`、`P3`、
`G1 复杂度阈值`、`orphan 7 个`、`explore_code 空壳`），**1 条升级为待做**（`G5 README 计数自愈` ⇒ 见上 T32）。
**剩 1 条决策项**：

- `P4 工具名拍板` —— 是否真改 `mcp__design-canvas__*` 工具名（会断 DSH 现有会话与桥接）⇒ **需用户拍板**；
  若真改名，`DELETED_TOOLS` 墓碑（老调用返回 warning 而非 unknown tool）尚需实现。

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

---

## T23 · 仓外引用**没有判据**（"搬迁架空"家族第 7/8 例的根因）

2026-10-02 实测：`~/.workbuddy/mcp.json` 的启动路径与 `~/.workbuddy/skills/dc-add-tool/SKILL.md`
**都指向早已搬走的旧路径**，而且**静默失效很久没人发现**（MCP server 从 T11 起就没起来过）。

根因不是"忘了改"，而是：**仓内 grep 扫不到仓外**。本仓已有的两条防架空机制对这个面**完全无效**：
- G4 单源棘轮 / 品牌残留门 —— 只扫仓内
- `preflight_move`（搬迁预检）—— 只扫仓内（它 walk 的是 `REPO`）

⇒ 想让它可证伪，需要一张**显式的"下游清单"**（谁在用本仓、以什么形式引用）：

| 下游 | 引用形式 | 现在有判据吗 |
|---|---|---|
| `dsh-brain` | MCP 桥接 | ✗ |
| `dsl-workbench` | HTTP + schema 镜像 | ✗ |
| `elv` | 按路径 import 本仓 dist | ✗ |
| `ai-config` 下的「设计画布脑」技能包 | 技能包（目录名含**旧**品牌串，故此处不逐字写） | ✗ |
| `~/.workbuddy/mcp.json` | 启动路径 | ✗（本次手改） |
| `~/.workbuddy/skills/dc-*` | 操作手册里的路径 | ✗（本次手改） |

**建议**（未做）：写一个 `scripts/check_external_refs.mjs`，读**一份仓内的清单**
（哪些外部路径引用了本仓）⇒ 逐个 `fs.existsSync` + 检查里面出现的本仓路径是否还存在。
★ 难点：清单本身是**仓外的**，所以它必须被**抄进仓内**（这正是"唯一数据源"要付的代价：
要么承认它管不到，要么把它纳入一个有人维护的表）。**别让它继续散在没人看的地方。**

- [ ] **T28 ★★ 同一个概念，四套目录名 + 三种文件名（独立结构评审 2026-10-04 指出）**
      *(核实：`ls` 四处语言适配目录 + 逐文件比对。)*
      ⇒ **4 个平行的语言适配表**：3 个叫 `languages/`（`package_migration` / `rename_symbol` /
      `contract_gate`），1 个叫 `adapters/`（`version_upgrade`）。
      **同一门语言多种写法**：Python = `py.ts` vs `python.ts`；C# = `cs.ts` vs `csharp.ts`；
      TS = `ts.ts` vs `typescript.ts`。**注册入口**：三处 `registry.ts`，第四处叫 `refactor_langs.ts`。
      ⇒ 按名字跨模块定位一门语言**做不到** —— 而"加一门语言 = 加一个文件 + 注册一行"本该是这条结构
      的收益（台账 §44.30 参考 serena 时定的）。命名漂移把它吃掉了。
      ★ 另：`application/refactor/` 下 **9 个 `rf-*` 连字符目录名是全仓唯一**的连字符风格
      （其余一律 snake_case），且 `rf-` 前缀在 `refactor/` 内冗余（读作 "refactor-refactor-edit"）。

- [ ] **T31 ★★★ 通则：「凡把路径/名字写成表的地方，搬迁一次就静默失效一次」（2026-10-04 立）**
      *(核实：本清单同一族**已 5 例**，逐条见 T21 正文 + 台账 §44.31 / §44.37 / §44.40。)*
      ⇒ **5 例**：
        1. `server_registry.consistency` —— 假设「实现在 `src/tools/<name>.ts`」
        2. `capability_scan` —— 按路径认模块
        3. 架构基线（`.dependency-cruiser-known-violations.json`，**18 条里 8 条过期，44%**）
        4. `derive_feature_tree.ts` 的 `TOOL_DOMAINS` —— 120+ 行的名字表（T21）
        5. ★ **`structure_gap` 自己的 `unlisted` 判据** —— 只扫 `flatDirs` 的子目录（**1 个容器**）
           ⇒ 报 `0` 假绿，真实 **17 个**未登记（2026-10-04 修）
      ⇒ **共同形状**：一张「名字 → 某个判断」的表（或一段把路径写死的前缀判断），
        在**布局没变的当天是对的**，在**第一次搬迁之后静默变成错的** —— 而且**不报错、不变红**。
      ⇒ **通则（要落地成纪律）**：
        · **不写「名字表」**：能从 ① 运行时数据 / ② 结构化 API / ③ AST 拿到的，**不要抄成表**
          （判据优先级见 AGENTS.md 那一节；本仓 L1/L2/L3 已收口一部分，L4 仍散着）
        · **非写名字不可时，配一个"这个名字还在不在"的检查**，且该检查必须**现算**、**不落基线**
        · ★★ **搬迁之后必须重跑所有"按名字认东西"的判据** ——
          这正是「每次搬迁后跑 `structure:gap` + `code_health` + 逐个工具试用」这条纪律的**真正理由**
          （不是为了走形式，是因为**这一类判据会静默失效**，而只有重跑才发现）
      ★ 与之配套的**两条已生效纪律**（在 AGENTS.md）：① **不许留墓碑**（失效的表要删，不是注释掉）；
        ② **「读数为 0」先问「扫描面 = 管辖面吗」**（第 5 例就是扫描面少了 4 个容器）。

- [ ] **T25 ★★★ 6 张手工登记表逐张换载体（判据：**扫描类一律换成框架规则或工具**）**
      *(核实：2026-10-03 —— 见台账 §44.36；已用 `lane_no_io` 做完整小样，净减 247 行 + 1.6 KB。)*

      ★ 判据（本轮定）：**看它保护的判据是"扫描"还是"执行"** ——
      **扫描**（某模式在哪出现几次 / 某路径是否存在 / 某结构是否一致）⇒ ★★ **一律换框架规则或工具**，门与登记表都删；
      **执行**（给输入断言输出）⇒ 工具替不了，留。

      | 登记表 | 大小 | 判据形态 | 替代方案 | 状态 |
      |---|---|---|---|---|
      | `lane_no_io.json` | 1.6K | 扫描（某 import 是否出现） | ✅ **已换** `dep-cruiser` 规则 `lane-must-not-io`（8 行） | ✅ 已做 |
      | `brand_residue_registry.json` | 2.4K | 扫描（文本里有没有旧品牌串） | 一个「扫旧品牌串」的 action（可复用 `explore_code` 的文本扫） | ⏳ |
      | `literal_table_registry.json` | 2.9K | 扫描（同一字面量表出现几次） | 同上 | ⏳ |
      | `explore_action_wiring.json` | 1.9K | 扫描（action → 实现接线） | ★ **本可派生**（从 lane 的 def 表算出来）—— §2b 早就记过"这两件事本来可以是数据" | ⏳ |
      | `tool_completion_receipt.json` | 5.4K | 扫描（handler 是否回 data） | 从 `TOOL_DEFS` 派生（跑一遍 handler 看回执形态） | ⏳ |
      | `single_source_registry.json` | **8.2K** | **半扫描半判断**（"什么算同族"要人判） | ★ 最难的一张：**存量清单必须由工具算**，但"同族"的界定可能仍要留一个**小的**人工白名单 | ⏳ |

      ★ 顺序建议：先做**纯扫描**的（`brand_residue` / `literal_table`）—— 它们**无判断成分**，一次成功率最高；
      **最后**啃 `single_source`。

- [ ] **T33 ★★ `analyzeModuleSource` 的 `imports` 漏默认导入 —— 与 `parseFileFull` 差 190/323 文件（2026-10-04 实测）**
      *(核实：一次搬迁侦察时用**全仓 323 个文件逐文件对差集**测出，**非读码断言**。
      与 T26 同一轮侦察，但**是两条不同的事**。)*
      ⇒ **190 个文件**的 `imports` 两边不一致，**差异全部是 `analyzeModuleSource` 漏掉「默认导入」**
        （`import fs from 'node:fs'` 这种形态）。
      ⇒ **影响面**：凡用它的 `imports` 建「导入边 / 依赖闭包」的地方**都可能漏边** ——
        `project_root` 的闭包计算正是使用者之一。
      ⇒ ★ **要不要改是另一笔**，且它**是行为变更**（会**多收**默认导入边 ⇒ 闭包更全）
        ⇒ **必须按「行为变更」单独验收**，不能混进纯重构（改了会让一批闭包结果变化）。
      ⇒ ★ **不要与 T26 合并**：T26 只求「消掉那条环」，本条求「分析器本身对不对」；
        混在一起会把两件事的验收判据搅在一起。
      ★ 取证方式（**值得复用**）：**全仓逐文件对差集** —— 比"读代码断言"强得多。

- [ ] **T34 ★ `explore_code` 的异步 action 外层 message 恒为「异步 action 已完成」（2026-10-04 T17 时发现）**
      *(核实：T17 给 4 个 action 接上真实现后，外层 message 仍是那个固定串；
      真实文本经 `toResult(r, true)` 的 `---DATA---` 通道落在 `data.message` 里。)*
      ⇒ ★★ **先定性，别误当 bug**：它**不构成"说谎"** —— 真实文本**确实到达模型**（走 `---DATA---`）。
        问题只是**外层摘要不具体**（模型若不读 `data`，就只看到"已完成"三个字）。
        ⇒ 属**可读性**问题，**不是一致性**问题（G7 那一族抓的是"宣告了却没实现"，这条**实现了**）。
      ⇒ 改法（若要改）：把真文本提到外层 ⇒ **会动 `toResult(r, true)` 的口径** ⇒
        影响**所有**用它的 action（`diff_impact` / `arch_layer` / `derive_mind_map`，
        加上 T17 新接的 `check_monolith` / `derive_algorithm` / `derive_chain` / `derive_split`）。
      ★ 这是**"要么全改、要么不改"**的那种改动 —— **改一半 = 同一件事两套口径**（本仓头号病根）。

- [ ] **T36 ★ `completionCandidates` 的「是否已带 import 级扩展名」判定不被 `exts` 覆盖（2026-10-04 T13 时发现）**
      *(核实：T13 实测 —— 显式 `import './mod.mts'` / `'./mod.cts'`：**改前 null、改后仍 null**。)*
      ⇒ **根因**：`infrastructure/parse/import_resolve.ts` 的 `completionCandidates` 用**模块级常量
        `IMPORT_EXT_SET`**（= `IMPORT_EXTS`，**不含 `.mts/.cts`**）判断"该说明符是否**已带** import 级扩展名"，
        而这个判断**不被 `exts` 参数覆盖** ⇒ `.mts/.cts` 显式说明符走"无扩展名补全"分支
        ⇒ 生成 `mod.mts.ts` 之类 ⇒ **恒 null**。
      ⇒ **影响面有限**：NodeNext 真实写法是 `import './mod.mjs'`（指向 `.mts`）—— **这条能解析**
        （`.mjs` ∈ `IMPORT_EXT_SET`，剥扩展名后按 `exts` 补全含 `.mts`）。**只有直接写 `.mts/.cts` 才漏。**
      ⇒ ★ **该修**：令 ext 判定集合 = `IMPORT_EXTS ∪ options.exts`。
      ⇒ ★★ **为什么不能"影响面小就算了"**：T13 已让 `exts` 能影响**补全**，
        却**不能影响「是否已带扩展名」的判定** ⇒ **同一个参数只生效一半 = 判据分叉**。
        **半修比不修更坏**（它看起来像修好了）。
      ★ 与 **T13** 同源（同一件事的两个面）：T13 已做（wrapper 收 `exts` + 相对性门），本条是剩下的那一半。

- [ ] **T40 ★★ 三处「隐藏前置」没写进任何工具描述（独立体检 2026-10-05，用户要求"从头逐个测"）**
      *(核实：体检小队用 `AGENT_IO_HOME` 隔离 + 临时项目 `C:/tmp/...` **逐个真调** 59 工具后报告；
       我复核了第 3 条（`server_registry.ts:301` 逐字）。)*
      ⇒ **1. DSL 数据锚定「包安装根」，不是你的项目目录。** 不设 `AGENT_IO_HOME` 时任何 cwd 都在
        读写**同一个**数据目录 ⇒ 多项目互相看见。**最容易被误伤，却不在任何工具描述里。**
      ⇒ **2. 符号索引会被"顺手"自动建。** 第一次 `find_references` 就在被分析项目里生 `.agent-io/cache.db`
        （没先让你 `import_project`）；而 `feature_line` 却要求"先跑一次带 feature 的 import_project"
        ⇒ **三处口径不一样**。
      ⇒ **3. 「每次调用前保鲜」只认 4 个参数名**（`project_dir / project_root / root / dir`，
        `server_registry.ts:301` 的 `projectRootArg`）⇒ 用 `project_dir_a`（cross/hybrid）、
        `target`（observe_instrument）、`source_root`（render_brickwork）、`file`（find_references）
        的工具**拿不到自动保鲜**，结果可能悄悄是旧的。
      ⇒ 方向：① 把 `AGENT_IO_HOME` 的语义写进 `capability_map`（新用户第一站）；
      ② 三条索引前置口径收成一句一致的话；③ `projectRootArg` 的判定面与各工具真参数名对齐
      （要么扩它、要么让工具参数名统一）。

- [ ] **T41 ★ 四处「报错说了等于没说 / 与描述不符」（独立体检 2026-10-05）**
      *(核实：体检小队逐条真调，报错原文已存 `docs/tool-handbook.md` §7.5/§7.6。)*
      ⇒ `behavior_baseline` / `narrate_step` 报错串里混 `undefined` 占位
        （例 `…/undefined/.agent-io/behavior/undefined__undefined.json`），**看着像 bug**。
      ⇒ `observe_log` 传**不存在**的日志文件 → 静默「（无匹配事件）」⇒ 会让人以为"跑过了、没内容"。
      ⇒ `manage_feature` create/clone/delete 的参数要塞进 **`args` 子对象**，可 schema 里又有个顶层
        `feature`；报错说「缺少 feature」但顶层就有 ⇒ **自相矛盾**。
      ⇒ `harvest_from_url` 描述说默认落盘，实测**默认走 dry-run**（`written:false`）⇒ 口径不一致。

- [ ] **T42 ★★ 结构重排三案（独立结构评审 2026-10-05；"层"这根轴清楚，"层内靠什么切"没有统一口径）**
      *(核实：独立子代理只读目录结构后报告；我复核了 `ls src/presentation/cli/`（22 文件）与行数。)*
      ⇒ **方案 A（推荐先做，代价最小）**：拆 `presentation/cli/` —— 22 文件 / 6525 行混 4 类
        （含 **1175 行 CSS** 在 `workbench_shell_css.ts`）⇒ 拆成 `cli/` + `cli/render/`。
        **只需改 1 个文件 + 移动 8 个文件，外部零影响。**
      ⇒ **方案 B**：`application/refactor/` 同层两套命名 + 单文件 `index.ts` 已 1479 行；
        统一命名（68 处路径引用，靠编译器兜底）。★ 与 **T28** 的 `rf-*` 命名是同一族，**同一次做**。
      ⇒ **方案 C**：`infrastructure/analysis/` 下 15 个子目录名语域重叠、无索引 ⇒ 合并单文件目录 + 补说明。

> ★★ **上面 T37/T38/T39 是 2026-10-05 体检**当场**修掉的三笔**（已进 commit 历史，故不在此列）：
> `f2e9066` cross 线假阳性 + P-D 守卫漏接 · `94987c4` 补齐 18 工具缺参守卫（**59 工具零坏签名**）
> · `25ab56c` `render_brickwork` 默认输出归位 `<agent-io>/docs/`。

