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

- [ ] **T54 ★★★ 补「管道」—— 让「接力键」在**入参端**也能被接住（缺口已量化，2026-10-05 实测）**
      *(核实：2026-10-05 用户提出「哪怕只有一两个积木，框架也应该能把这两个拼在一起跑起来」⇒ 用它自己的判据量了一次。)*
      ★★ **2026-10-05 本轮已落**（回执见 commit 历史）：① 「接力键」已进受控词表（`file`/`symbol`/`node_id` ⇒ `anchor`）；
        ② `Touched.definition_file` **改名 `file`**（1 产者 0 消费者）⇒ `touched.file` → `renames[].file`
        **逐字同名、零字段名翻译**，该边**已真跑并升级 `verified`**（夹具 `$TEMP/agentio_chain_probe`：
        定义 + import + 用法全部改对）；③ ★ **撤掉一条假反例** —— 原写"`get_dsl(files)` 吐 `path`、下游收 `file`
        ⇒ 同义异名"，**错**：`path` 是**事实字段**（被 `schema/design_dsl.schema.json` 的 `required` 钉死）、
        `file` 是**定位器**（注释明文"绝对路径；或相对 project_dir/cwd"）⇒ **两类东西**，硬对齐 = 判据分叉的**反方向**。
      ★★ **2026-10-06：§5 那条链已整条真跑验收**（"剩下"的第 1 条做完）—— `chain_wiring.ts` 的三条
        `pending` 全部出了结论：`rename_symbols.written_files → edit_code.file` ✅、`…symbols → edit_code.symbol`
        ✅ **升级 `verified`**；`edit_code.written_files → run_tests.project_dir` ❌ **证伪撤掉**（**文件 ≠ 根**）
        ⇒ ★ **`CHAIN_EDGES_PENDING` 已清空** ⇒ §5 那条链（`find_references → rename_symbols → edit_code →
        run_tests`）**每一环都验过了**。★ 「**从集合里选一个**」这一格也补上了**明文表达** `touched.<键>[i]`
        （`chainExprOf()` **一处生成**、`renderChainWiring` 直接印出来 ⇒ **新用户第一站看得见**）。
        证据 / 两个"必须先说的前提" / 缺口，见 `docs/tool-chain-contract.md` §9。
      ✅ **2026-10-08 已闭环**：`get_dsl(query='files')` 的机器段改成出
        `file`（仓库相对路径）+ `symbols: string[]`（**实际符号的 `qualified_name`**，取自 `cache.db` 的
        `fileFacts(...).apis`）；两个派生计数（`actualCount` / `symbolCount`）**删掉**（要数就 `.length`）。
        ★ 真跑（夹具 `fx-chain`：`import_project` 建索引 ⇒ `get_dsl(query=files)` ⇒ 拿 `data[0]` **零翻译**喂下游）：
        ```
        data[0] = {"file":"src/lib.ts","symbols":["helper","unusedOne"]}
          ⇒ find_references {project_dir, file:"src/lib.ts", symbol:"helper"}
          ⇒ 定义 src/lib.ts（function），1 个 import 方：src/main.ts 行 1,4        ✓ exit 0
        ```
        唯一手工动作 = 取 `[0]`（= 上面第 1 条那个"**选**"，本就该由调用方给）。
        ★ 与 `SemanticFile.path` 的关系：**不动它** —— 那是 DSL 侧的**事实字段**（`schema` 的 `required`）。
        **事实叫 `path`、定位器叫 `file`**；本投影本来就是一层的**转写**（它早已丢掉 `responsibility_en`
        / `expected_deps`），不是镜像 ⇒ 让转写层说**消费者要学的那个词**，不是把事实字段改名。
      ★ **仍剩（这才是本条的判据）**：原判据是"**能跑通几条真实链**"（见下面的「判据」段）
        ⇒ 现已跑通 **1 条**（`import_project → get_dsl(query=files) → find_references`）
        ⇒ 按原判据**还要再跑通 1–2 条**（例如 `import_project → extract_contracts → find_references`）。
        **跑通一条记一条**；不追求"每个工具都收 `feature`"那种一刀切（那是造兜底）。
      ★ **一条已证伪、别再重写**的接法：`edit_code.written_files → run_tests.project_dir`（文件 ≠ 根）；
        §5 想的那件事（"**只跑本次改动相关的测试**"）缺的是"**源文件 → 对应测试**"的映射
        —— **能力缺口，不是命名问题**，别用改字段名去凑。
      ⇒ **量法**：① 把 56 个工具的**顶层入参名**全列出来（读 schema）；② 真调抽验；
        ③ 跑 `node scripts/measure_b_contract.mjs`（**已被 T55 补上"按字段覆盖率"**）看 `[B]` 两端。
      ⇒ **读数（全部实测）**：

      **工具层（56 个，读 schema + 真调抽验）**

      | 入口键 | 工具数 |
      |---|---|
      | 只认 `project_dir` | ≈**30**（真调证实 `code_health`/`remove_dead_imports` **直接拒绝 `feature`**） |
      | 只认 `feature` | ≈8 |
      | 要 `{file, symbol}` | **5** |
      | ★ **两样都认** | **10**（`import_project` `scaffold` `extract_contracts` `get_dsl` `feature_line` `design_intent` `reconcile_effects` `reconcile_chain` `harvest_closure` `read_project_docs`） |

      **`[B]` 层（37 个，type checker 读数）**

      | 字段 | 产物端 | 入参端 |
      |---|---|---|
      | `touched` | ★ **30/37** | ★ **0/37** |
      | `project_dir` | 6（其余 24 个塞在 `touched` 里） | **17** |
      | `feature` | 13（同上） | **19** |
      | `files` / `symbols` | **0 / 0** | 3 / 1 |
      | `read_files` / `nodes` | ★ **0 / 0** | 0 |

      ⇒ ★★ **缺口的精确形状**：产物端把作用域**塞进 `touched`**，入参端却**只认平铺字段**，
        且**没有一个入参收 `touched`** ⇒ 两端共享的只有"**扁平字段名**"这一层，
        而**连这一层都不齐**（`project_dir` 6↔17、`feature` 13↔19）。
      ⇒ 积木 A 交出 `{project_dir, feature}`，**只有 18% 的工具能接住**；其余要么丢掉 `feature`
        （退到整个项目粒度）、要么要 `{file, symbol}` —— **必须由调用方从 feature 里再挑一次对象**。
        那个"再挑一次"就是**今天的手工拼接**，而**每个下游都要重做一遍**。
      ⇒ **方向（不发明新机制）**：`Touched` 已是**产物端**契约（`src/domain/b_terms.ts` 的 `Touched`，六字段）。缺口是它**没对称到入参端**。
        ⇒ **让入参端接受同一批字段名**（`project_dir` / `feature` / `files` / `symbols` …）就是管道。
      ⇒ ★★★ **2026-10-05 第二轮量测：我第一轮的两个口径都错了（逐个更正）**：
        · **"只有 10/56 接受 `{project_dir, feature}`" —— 错口径。**
          它把"`code_health`/`structure_gap` 这类**全项目**工具本来就不该按 feature 工作"也算成了缺口。
          ★ **正确口径**：先定"**谁按 feature 工作**"（机械判据：**源码里读写 DSL** ⇒ DSL 就是按 feature 组织的），
          再看它们接不接受 feature。**实测：17/17 全部接受 ⇒ `feature` 这一格零缺口。**
        · **"补产物端的对象类字段（`read_files`/`symbols`/`nodes`）" —— 岔路。**
          ★ 实测这三个字段**产物端全是 `0/37`**（定义了、**从来没用过**），
          而**下游要的是"单个对象"**（收单数：`file` 3 个 · `symbol` 2 个 · `node_id` 4 个 = **9 个 [B]**）。
          ⇒ **两端连形态都不同**（上游集合 vs 下游单数）⇒ **补集合字段对链没用**（下游不吃集合）。
        · ★★ **⇒ 缺口的正确形状（这一条才是结论）**：
          **"选出一个对象"这个动作没有统一的表达** ——
          链实验里手工步数 = 2，而那两步都是"**从集合里挑一个**"（挑 file、挑 symbol），
          是**语义选择**，不是数据搬运。
          ★ 而 **Unix 的"万能"同样不包括"自动选"**（`grep` 就是在选）⇒ 选择**永远由调用方给出**。
          ⇒ 所以该做的**不是**"让工具自动接上"，而是：
          **让"选完之后"那一步有统一的名字** —— 即 `Touched` 的**单数对象形态**。
        · ★ `Touched` 现状：**作用域类**（`feature`/`project_dir`）✓ 齐；**对象类**四个全是**集合**
          （`written_files`/`read_files`/`symbols`/`nodes`）⇒ ★ **缺"单数对象"**（`file`/`symbol`/`node_id`）。
      ⇒ ★★★★★ **2026-10-05 第三轮：上面整段**作废** —— 我用的读数有假（用户提示"我们统一过一次出参入参"）**：
        · **根源：量具 `measure_b_contract.mjs` 只量产物**顶层**字段，而 `touched` 是个**对象** ⇒
          它内部六个键**完全量不到**。**于是"`symbols`/`read_files`/`nodes` 产物端 0/37"是假读数。**
        · ★ **真调一眼**：`find_references` 的 `touched` = `{project_dir, symbols:["Kk"], read_files:["com/a/Kk.java"]}`
          ⇒ **`symbols` / `read_files` 一直在产**。
        · ★★ **真读数（源码级，扫 `touchedOf` 函数体；31 个 [B] 有它；★ 2026-10-05 口径已修正）**：
          `feature 19/31 · project_dir 21/31 · written_files 8/31 · symbols 4/31 · nodes 3/31 · file 1/31`
          ⇒ **各键都有人产**。
          ★ 旧读数（`feature 21 · project_dir 22 · written_files 19 · read_files 10 · symbols 8 · nodes 10`）是**影子**：
            旧量具按**裸词**扫函数体（把注释 / 局部变量也算进去，如 `written_files` 报 19 而真实 8）；
            现口径 = 「**字段访问 / 属性键**」。
        · ★★★ **量具已补上这一节**（扫 `touchedOf` 函数体报各键覆盖），并在源码里写下这次误判。
      ⇒ ★★★★★ **链实证（真跑，2026-10-05）**：
        `find_references` → 用它的 `touched` **直接构造** `rename_symbols` 的入参
        （`read_files[0]`→`file`、`symbols[0]`→`symbol`，**零字段名翻译**）→ **跑通**
        （定义 + 2 个 importer 全部改名）✓
      ⇒ ★★★★ **⇒ 结论（第三轮，取代前两轮）**：
        **`Touched` 就是那张"表"（已有、且是活的）；链在**数据上**已经通了。**
        缺的**不是**数据、**不是**形态，而是两样：
        1. **"从集合里选一个"的统一表达** —— 实证里唯一的手工动作就是取 `[0]`；
           ★ 而 **Unix 里那也是 `$1` / `xargs`，选择永远由调用方给** ⇒ 这一格**本来就不该自动**，
           缺的是**把它写成明文的约定**（"上游给 N 个，调用方逐个喂；用 `touched.<key>[i]`"）。
        2. **`docs/tool-chain-contract.md` §5 那条链从来没验过** —— 文档写了
           `find_references → rename_symbols → edit_code → run_tests`，但**没有一条真跑验收**。
           ★ 今天这条实证就是**第一块砖**。
      ⇒ ★★ **判据（★ 2026-10-05 修正：不能是"覆盖率 100%"）**：
        原写成"10/56 → 56/56"，**但"每个工具都收 `feature`"是错的** ——
        `translate_go_ts` 这类与 feature 无关的工具**不该收**（硬塞 = **造兜底**，本仓明令禁止）。
        ⇒ 改成 **"能跑通几条真实链"** 这个**用户自己的判据**：
        **先挑 2–3 条真链（如 `import_project → extract_contracts → find_references`），
        要求"前一步的产物能直接喂后一步、不用调用方翻译"**，跑通一条记一条。
        ★ 而"该收哪些字段"要**逐个人判**（不是一刀切 100%）。

      ⇒ ★★★ **第一手实验（2026-10-05 已跑）**：三环链
        `import_project → get_dsl(query=files) → find_references`，逐环真调：

        | 环 | 产物（机器段） | 下游要的 | 对得上吗 |
        |---|---|---|---|
        | A `import_project` | `{"feature":"jvprobe","files_parsed":3,"symbols_found":1,…}` | `feature` ✓ | ★ **只有计数、没有内容** ⇒ 唯一可传的是 `feature` 这个**句柄** |
        | B `get_dsl(files)` | `[{"id":…,"path":"com/a/Kk.java","apiCount":1,"symbolCount":1,…}]` | A 的 `feature` ✓ | ★ **机器段是结构化的** ⇒ 比预想好 |
        | C `find_references` | —— | `{file, symbol}` | ★ **两个真缺口**（见下） |

        ★★ **两个真缺口** —— ✅ **均已于 2026-10-08 闭合**（回执见本条目上方的「已闭环」段）：
        1. ✅ **同一个东西两个名字**（上游吐 `path`、下游要 `file`）⇒ 投影改出 `file`；
           ★ `SemanticFile.path` **不动**（事实字段 vs 定位器，是两类东西，硬改名才是判据分叉的反方向）。
        2. ✅ **符号名没有结构化出口**（上游只给 `symbolCount: 1`）⇒ 投影改出 `symbols`
           （`apis[].qualified_name`）。★ 典型形态：**丢掉的是投影，不是能力** ——
           `fileFacts` 早就把名字带回来了，只是被 `.length` 收成了一个数。

      ⇒ ★★★ **2026-10-05 侦察（code-explorer 子代理）后修正：不能只改 `get_dsl(files)` 这一处** ——
        ・ `get_dsl(query='files')` 的条目是**报告条目**（`query_feature.ts:621-631`：`id/path/responsibility/
          status/layer/lines/apiCount/actualCount/symbolCount`），**符号与 API 只给计数、不给名字** ⇒
          就算把 `path` 改成 `file`，下游 `find_references.symbol` **仍无从填** ⇒ 链还是接不上（= **半修**）；
        ・ 只改投影会造出**同一工具内同义不同名**：`query='file'` 返回整份 `SemanticFile`，其 `path` 被
          `schema/design_dsl.schema.json:179,185` 的 `required` **钉死**（那是**与前端的对外契约**）⇒
          要两端对齐就绕不开"改类型名 / 改 DSL schema"这个**对外契约决策**；
        ・ `path` **不在受控词表**（`b_terms.ts` 无此词条），而 `file` 是 `anchor`（`:262`）。
        ⇒ **前置件（未做）**：先定"文件路径这个词全仓统一叫什么"（若改 `SemanticFile.path`，牵连 schema + 前端 + fixture），
          再谈 `get_dsl` 投影跟随；**在此之前不动**。

      ⇒ ★★ **所以 T54 的第一步不是改 56 个工具的 schema，而是**把"接力键"登记进受控词表****
        （`src/domain/b_terms.ts` 已经是"**同一个概念只能有一个名字**"的机器判据）：
        现在它只管 `[B]` **产物**的字段名，**不管入参、也不管上游产物的字段名** ⇒
        把 `project_dir` / `feature` / `file` / `symbol` / `files` / `symbols` 收进词表，
        并**让量具查出"同义不同名"**（`path` vs `file` 就是第一个）。
        ★ 判据：**每条真实链的"出口字段名"都能在"入口字段名"里逐字找到**。

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
      · (4) ✅ **已落**（2026-10-05）：**改 `semantic.files` 前必须"现取"该文件的事实**
        —— 落点 `editDslHandler`（`handlers.ts`，`validateReason` **之前**）：
        · **触发面**（**只有两类**，逐条核过 `update_feature.ts` 的 `switch (op.type)`）：
          `type=file`（增/改/删文件条目）· `type=api`（改 `file.expected_apis`）；
        · **免触发**（逐条说清"为什么不算"）：`type=status` / `binding`（**流程态**，不断言代码）、
          `type=snapshot op=rollback`（**整份恢复**，没有"目标文件"可归因）、
          node / edge / annotation / approval / layout / simulation（本就不碰 `semantic.files`）；
        · **判据**：目标文件必须 ① `fileFacts(root, path, feature).matched_path` **非空**（真的现取到事实）
          ② 且在 `evidence` 里有一条 ref 指向它；★ **两档 weight 都适用** —— routine 跳得过 L4 的"为什么改"，
          **跳不过**这条（镜像已摘 ⇒ 事实只能现取）；
        · ★ **不兜底**：DSL **有** `source_root` 却取不到事实 ⇒ **响亮抛**；DSL **没有** `source_root`
          （纯设计 / 新建 feature，代码侧还不存在）⇒ 这条**不适用**（没有权威可读）；
        · ★ 顺带把 L4 的 `resolver.exists` **扩成两类可回溯证据**（运行事件 `trace` / **仓库文件事实 `fileFacts`**）
          —— 否则为满足上面这条而传的文件证据会被 L4 打回，且"有 evidence 却无 resolver"那条分支在
          **无录制事件**时会**误伤整个调用**；边界 = 仅**多接受一类证据**，既有判据一条不放宽；
        · **真调验收**（隔离 `AGENT_IO_HOME` + 2 文件夹具）：无证据改 `file` 断言 ⇒ **被拒**（错文给出下一步）；
          带文件证据 ⇒ **通过并真落盘**；`type=status` 无证据 ⇒ **通过**（边界成立）；
        · 工具描述已同步（`weight` 与 `evidence.type` 两处）。
        · ★★ **未覆盖（2026-10-05 独立核验发现）**：本闸**只管 `edit_dsl` 这一条路**。写 `semantic.files`
          （含 `path`/`responsibility`/`expected_apis`/`layer`/`contract` 等"代码是什么"的断言）**还有别的入口**：
          **6 个 MCP 工具**（`import_project` / `sync_contracts` / `extract_contracts` / `reconcile_effects` /
          `narrate_step` / `archive_node`）+ `explore_code` 的 `arch_layer`·`check_monolith` + **HTTP 写口**。
          ★ 其中**大多数是"代码驱动的产者"**（它们本来就在读代码/事件）⇒ 不覆盖**合理**。
          · ✅ **2026-10-06 已收口一片**：daemon `/api/dsl` 的**「整份 dsl 提交」形态已删**（`server.ts` 的
            `DslWriteRequest` / `daemon.ts` 的 `dslWriteHandler`）。理由：它**零调用方**
            （唯一调用方 `dispatch.ts: postDsl` 只传 `ops`），却是**唯一能直写整份 DSL 的旁路**
            （跳过本闸与 `view=live` 护栏）⇒ 删后该管道只剩 `ops`（必经 `updateFeature`），与 MCP 侧语义一致。
            实测：整份 `dsl` ⇒ **400**（文案说明已删）；`ops` ⇒ 仍受理（409「operations 不能为空」）；空 body ⇒ 400。
          · ★★ **同时更正本条目此前两处记错**（2026-10-06 逐处核实）：
            ① **位置错了**：原文写「`serve.ts:175` 的 `/api/dsl`」—— 实际 `serve.ts:160` 的那个是
               **`POST /api/save`**；真正的 `/api/dsl` 在 **daemon**（`server.ts:130` + `daemon.ts` 的
               `dslWriteHandler`），而它只是 `edit_dsl` 的**下游**（`dispatch.ts:76` 转发），**不是旁路**。
            ② **性质错了**：原文判断「同一个'改设计'动作有两条路、两道不同的闸（判据分叉）」——
               实为**面向不同写主体**：`edit_dsl`（`source='mcp'`，LLM）经 daemon **串行队列**（单写者，
               结构性消除"最后写者胜"）；`/api/save`（`source='browser'`，人）直写 `saveDSL`。
               ★ 要求两者同一道闸**本身就是错的**：人要向自己证明"我读过代码"没有意义。
          · ⚠ **仍未做的两件**：
            (i) **并发保护不对称** ⇒ ★ **2026-10-06 用户裁定后"降级"，不再按原方向修**：
                那份前端（`output/`）**已进入退役名单**（用户："找到了更好的产品形式，后续会重新开发"，
                且"目前没有心力去开发维护"）⇒ **不再为它做契约改造**（rev 必填那类要前端配合的事一概不做）。
                本笔只做"**不静默**"：未带 `_dsl_rev` 时打一行 `console.warn`（零契约变更、零维护成本），
                并把**决定 + 已知缺口 + 给新前端的指引**写进 `handleApiSave` 头注（决定留在代码现场）。
            (ii) T20 闸留在 `editDslHandler`（MCP 面）⇒ 直接 POST daemon `/api/dsl` 带 `ops` **仍能绕过它**。
                要不要下沉到 `updateFeature`（**层问题**：evidence 是 MCP 面的输入契约）**未定**
                —— ★ 且它**与新前端选哪条路强相关**，见 **T63**。
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
        ★ **仍未做**（★★ **2026-10-06 补注：这条后来在下面 ④「删兜底」里做掉了** ——
        `findCacheDb` 的第三级 `<cwd>` **已删**，见本段 ④ 末尾那行；★ 代码为证：`db.ts#findCacheDb`
        的 `candidates` 现在**只有两项**，且该函数上方逐字记着"2026-10-01 **删掉了原来的第三级候选**"）：
        `findCacheDb` 第三级候选仍是 `<cwd>`（**只单点化、没改语义** ——
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
        ★★ **2026-10-06 把这个前提核清了（实测，且它比原话更宽）** —— 「同一个根」的具体形状：
        · **写侧**：`saveLiveFeature(dsl, baseDir?)` / `saveBaselineFeature(...)` 的 `baseDir` **可选**、
          **缺省 = `getDataHome()`**；而 ★ **`watch_project` 监听任意项目时会传 `project_dir`**
          ⇒ live / baseline 落到**被监听项目的根**（`storage.ts` 的 `getLiveDir` / `getBaselineDir`
          注释逐字如此："baseDir 可选：指定写入的项目根（默认 dataHome）… watch_project 监听任意项目时传 project_dir"）。
        · **读侧**：`diff_views.ts` 用的是**入参 `live_dir`**
          （`getLiveFeature(feature, live_dir)` / `getBaselineFeature(feature, live_dir)`，且其注释写着
          "baseline 与 live **同目录归位：baseDir = live_dir**"）。
        ⇒ ★ "写读同根"的判据 = **读侧必须拿到写侧那个 baseDir**：缺省时两侧都落 dataHome（**一致 ✅**），
          而"**watch 过某个项目**"之后 ⇒ **写侧搬去了项目根、读侧还在 dataHome** ⇒ **静默读不到**（这正是要定的事）。
        ⇒ ★★ **且它不只影响 `dsl_live`**：`getBaselineDir` 的注释写着"与 baseDir 归位规则**和 live 一致**"
          ⇒ `dsl_baseline` **同款**。★ 而工序表里 `dsl_baseline.locate` / `produce` 都**只用 `feature`**
          （⇒ 隐含 dataHome）⇒ **工序表的口径与"watch 过项目"的现实不一致**（同一份数据两条线各持一份根）。
        ⇒ ★★ 结论：**"接读者"这一步卡在形状决策上、不是卡在代码量上** —— 先定"baseDir 从哪来、谁传给读侧"
          （候选：(a) 入参透传（现状，靠调用方自觉）· (b) 由 feature 反查 · (c) 收口到 dataHome 一处、
          不再按项目分居），**定了再接**；否则就是原文说的"接一个更快的分叉"。
        ★ 本笔原本**只核清、不动代码**（形状决策）⇒ ★★ **2026-10-06 补：按用户的方法「做几个副本实测」
        做了三个实验，选定 (b) 并落地**：
        · **实验 1（复现）**：写侧落项目根 + 读侧**不传** `baseDir` ⇒ `getLiveFeature(feature)`
          返回 **`null`（静默）**，而 `getLiveFeature(feature, 项目根)` 读得到。
        · **实验 2（(b) 可行性）**：`getDSL(feature).source_root` **正是写侧那个根**（实测取到），
          且 `getDSL` **不依赖 `baseDir`** ⇒ **无循环依赖**。
        · **实验 3（三候选同场景对比）**：**(a)** ⇒ **null** ❌；**(b)** ⇒ **读到** ✅；
          **(c)** ⇒ 也 null（**须把写侧 5 处一起搬**才一致，且会**丢掉**「与该项目的 `cache.db`
          同目录归位」这个**已有设计意图**——`saveLiveFeature` 的注释就是为它写的）。
        · ★ **选 (b)** —— ★★ **但 (b) 那个"二选一"形状随后被实测推翻，已改成「候选链」**（见下「已落」段）：
          顺带查出「根」的口径**至少有 4~5 种**（`import_project` 传 `live_dir` /
          `diff_views` 传 `live_dir` / `stage_registry` feature-only ⇒ dataHome / `design`·`observe`
          handlers 用 `requireProjectRoot` ⇒ **项目根** / `storage.ts` 内部一处 ⇒ dataHome）
          ⇒ **判据分叉的教科书案例**。
        · ✅ **已落（含一次自我修正）**：`storage.ts` 的取根单点从"二选一"改成**候选链** ——
          `viewBaseDirCandidates(feature, explicit)`（`explicit` > `dsl.source_root` > `dataHome`，去重）
          + `getLiveFeatureResolved` / `getBaselineFeatureResolved`（**取第一个「文件存在」的**）。
          ★ 与 `db.ts#findCacheDb`（两级锚、取第一个存在的）、`defaultEventsCandidates`（录制事件候选）
          **同款形状**。★ **为什么要改**：上一版是" `explicit` 否则 `dsl.source_root`"这个**二选一**，
          而写侧**两种模式都真实存在**（未传 `live_dir` ⇒ 落 `dataHome`；传了 ⇒ 落项目根）⇒
          猜一个必然让另一种**静默读不到**：★ **实测本仓 4 个 feature 的 live/baseline 全在 dataHome**，
          而 `dsl.source_root` 指向的仓里没有 ⇒ 上一版把 `getDSLByView(f, live)` 由「读到」变成 **`null`**。
          并据此定清三种语义：**读**=候选链取第一个存在的 · **写**=**不新造落点**（已有就写在它已在的那处，
          都没有才落 `dataHome`；刻意不写 `source_root`，否则给"从没在项目根放过 baseline"的 feature
          **凭空造出第二份**）· **删**=候选链上**每一处都删**。
        · **实测验收**（真跑；夹具在 `$TEMP` + `AGENT_IO_HOME` 隔离，用完即删）：
          ① `diff_views` 不传 `live_dir`（live 写在项目根）⇒ 输出「实际视图: **2 文件**」（改前 0）✅
          ② ★ **真实环境 4 个 feature ⇒ 4/4 读到 ✅**（即修正了上面那个回归）
          ③ 夹具**模式A（live 在 dataHome）/ 模式B（live 在项目根）都读到 ✅**
          ④ `deleteFeature`：live@项目根 与 live@dataHome **两处都删净** ✅；总门五道全 PASS。
        ⇒ ✅ **剩下的也收了（同批）**：
        · `stage_registry` 的 `dsl_baseline.locate` / `produce` 已改用**同一候选链**
          （`locate` 报第一个存在的；`produce` ★ **不新造落点** —— 已有就写在它已在的那处）；
        · ★★ 并挖出**同一个病的第 5 个入口、且是共用入口**：`getDSLByView(feature, 'live')` 原先也
          **裸调** `getLiveFeature(feature)` ⇒ **一处修、四处受益**（`derive_feature_tree` 的 live 语义基准 ·
          `diffFeatures` 的 view_a/view_b · `query_feature` 的 `view` 入参 · `design` handlers）。
          **实测**：`getDSLByView(demo,'live')` 的文件数 **0 → 2**（夹具：live 写在项目根）✅。
        · ✅ **原先「仍未收口」的 `deleteFeature` 也已收口**（同批）：它原先只删
          `getLiveFeatureFile(feature)`（隐含 `dataHome`）⇒ 快照落在项目根时**删不到、留残**；
          现按候选链**逐处删**，且候选链**赶在删 feature 存档之前**算（否则反查不到 `source_root`）。
      · (5) ★★ **补"符号级绑定点"**（用户 2026-10-01 提的"两份数据双向绑定"的真缺口）：
        现在两份数据（DSL=意图 / `cache.db`=事实）**只在文件级配对**（`semantic.files[].path` ⟷ `files.path`，
        且同一条目里 `expected_apis` / `actual_apis` 并存 —— **这已经是现状**）；
        **符号级没有稳定键**（DSL 侧是 `signature` **文本**、解析侧是 `qualified_name`）⇒ 只能近似匹配。
        ★ 这与 ④ 的「符号身份 = (file, name)，不是全局唯一 id」是同一个根问题。
      **★ 账本同时暴露的三件现症（都在这一条的范围内）**：
      · **根的分歧**：`getDataHome()` = `AGENT_IO_HOME ?? getPackageRoot()`（`storage.ts:60`，自省包根、与 cwd 无关）
        ⇒ **"每项目一个数据库"目前只对 `cache.db` 成立**（DSL 三态落**包根**、健康缓存落 **`cwd`**、读侧兜底第三个 `cwd`）。
      · ✅ **两处观测侧功能级断裂已修**（2026-10-06，与"根"同源但单独一笔）：
        (a) ✅ `scripts/setup.mjs` 写 **`.agent/camera`**、对账读 **`.agent-io/observe`** ⇒ **完全不重叠**
            ⇒ 官方流程产的事件，`reconcile_*` **永远发现不了**（改名 `camera→observe` 时 setup 漏改）。
            ★ 实测比原记**更宽**：`camera` 漏改**共 7 处**（`:9` `:23` `:39` `:132` `:160` `:161` `:264`），
            且**两个叶子名都错**（不只 `.agent/` 那半）—— `EVENT_DIRS_TPL` 原为
            `['.agent-io/camera', '.agent/camera']`；★ 还挖出**第三处同类**：`:160-161` 查插桩备份用的是
            `.agent-io/camera-backup`，而真名是 **`.agent-io/observe-backup`**（`instrument.ts:147` 的 `BACKUP_DIR`）
            ⇒ doctor 的「已插桩」判定**恒失败**（插了也说没插）。
            ⇒ 修法：`EVENT_DIRS_TPL = ['.agent-io/observe']`（唯一权威位置）；且 **`--run` 的 sink 落点
            从该常量派生**（`path.join(T, ...EVENT_DIRS_TPL[0].split('/'))`）—— 本脚本当初就是**手抄目录名**
            才漏改的，派生后**下次改名不会再漏**；doctor 的两条文案也一并从常量派生 / 更正。
        (b) ✅ 写端激活 **`OBSERVE_EVENTS_FILE`**（`run_sentinel.ts:26`）vs 读端只认 **`DS_OBSERVE_EVENTS`**
            ⇒ **无桥接**，按文档设了也白设。⇒ 在**唯一候选点** `observe_trace.defaultEventsCandidates`
            收口（`observe_trace` 与 `trace_evidence.loadObservedTraceRecords` 两处都经它 ⇒ **一处改、两处生效**）：
            **两个名字都认、写端优先**（`OBSERVE_EVENTS_FILE` > `DS_OBSERVE_EVENTS` > tmpdir > cwd）；
            MCP 工具描述与两处报错文案同步。
        ★ **实测验收**：(a) `setup --dry-run --run` ⇒ `mkdir <target>\.agent-io\observe` + sink 落同处
          （改前是 `.agent/camera`）；(b) **只设** `OBSERVE_EVENTS_FILE` 调 `observe_trace`
          ⇒ 输出 `录制调用链回放 […\events.jsonl]`（改前报「未发现默认录制文件」），
          而控制组（不设 env）仍报该错 ⇒ **对照干净**（`tmpdir/dsh_events.jsonl` 实测不存在，不干扰）。
      · **`embedding_cache` 无失效无淘汰**（`semantic_search.ts:162`）。
      ★ 门要管的是 **"根的选择"**，**不是**"`.agent-io` 字面量"——实测代码里字面量只有少数几处
      （136 行命中绝大多数是注释）⇒ "字面量被抄多份"不是主要问题。


- [ ] **T15 ★★ 把 CLI-only 的能力注册为 MCP 工具 ⇒ 「CLI-only」这个类别应当**归零****
      *(用户裁定的洞察 2026-09-30：「**工作台为什么不能注册为 MCP 呢**？就是说**同样同时投影为 MCP 和 CLI**，
      这样的话就**不用保留为 CLI only** 了。」)*
      ⇒ ★ 唯一真相源 = **MCP 注册**（★ **2026-10-05 更正路径**：`src/application/<lane>/index.ts` 的
      `ToolDef` 数组 —— 旧文写的 `registry/lanes/*.ts` **不存在**；`application/tool_registry.ts:43-52`
      汇总，`server_registry.ts:570` 循环注册，`cli.ts` **自动投影全部工具**）⇒ CLI 是**投影出来的**。
      所以「CLI-only」这个类别**根本不该存在** —— 它只说明**能力被藏在了 MCP 面之外**。
      ★★ **2026-10-05 重新盘点（两轮子代理并行侦察，旧文约 60% 失效）**：
      · ✅ 加一个工具**只需往对应 lane 的 `index.ts` 塞一条 `ToolDef`**（汇总/注册/CLI 投影全自动）；
        `capability_map` 的导航策展可选；`mcp_scan` 动态取名单；`structure.domains.json` 只管目录、不管工具。
      · ❌ 旧文的"只需删 CLI"三个**全部不成立**（逐 flag 核对）：`capability_cli`（`capability_map` 是
        **工具导航**、不是语言能力矩阵 —— **名字像 ≠ 同义**）、`instrument_cli`（`--ledger` 无对应 action）、
        `translate_cli`（`--holes` / `--out` / `--batch-size` 无对应）。
      · ❌ `archify_cli` **不是真 CLI**（无 argv，是**库**，被 `archify_pipeline.ts:14` import）。
      · ✅ 真 CLI 共 **11 个**：`brickify_cli` `capability_cli` `deprecate_offline_cli` `diagnose_loop_cli`
        `install_package_cli` `instrument_cli` `signal_review_cli` `split_stage_cli` `translate_cli`
        `upgrade_cli` `upgrade_rewrite_cli`（`cli.ts` 是投影本体，另计）。
      **✅ 已落（2026-10-05 第一片：2 + 1 个工具）—— 工具数 56 → 59**：
      · `signal_review`（拆分链第一棒 / LLM 复核）+ `split_stage`（最后一棒 / 默认 dry-run）⇒ 入 **design** 线；
        `capability_audit`（语言×功能缺口自检）⇒ 入 **meta** 线。
      · **真调通过**（隔离 `AGENT_IO_HOME` + 2 文件夹具）：三个工具都跑通；`signal_review → split_stage`
        **链是通的**（落报告 → 消费报告 → dry-run 输出 0 采纳簇）；手写缺 `clusters` 的报告给了**说得清的错**
        （原先核心抛**裸 TypeError** ⇒ 已补形状守卫）；`capability_audit` 报「已安装 20 门 / 缺口 128 对」。
      · ★ **未验**：`split_stage` 的 `apply=true`（真落盘 + 回滚兜底）—— 因 LLM 撞 **429 限流**、本轮没有"采纳簇"。
      · 同批文档：`README.md`（59 个；子标题 41 → **51**，并声明"表是**精选子集**、权威计数以 `TOOL_DEFS` 为准"
        ⇒ **顺带治了 T32 的漂**）、`README.en.md`（59）、`AGENTS.md` 触发点表补两行（源 = `gen_agents.mjs`）。
      **剩下（按"能真跑验证 + 不夹带未拍板契约"排序）**：
      1. **`brickify_cli`（11 类产物）** —— ★ **先定形状**：新立 `brickify`，还是给 `render_brickwork` 加
         `artifacts` 枚举？（后者符合"复用已有结构"，但两者会重叠 ⇒ **要拍板**）
      2. **`diagnose_loop_cli`** —— ★★ **硬障碍**：默认路径用 `readline` **交互提问**（MCP 无法应答），
         且会 `git commit` 用户仓库、`execSync` 跑测试、大范围改盘 ⇒ **边界必须先定**
         （建议只暴露"诊断 + 补丁 diff 预览"，apply/commit 留给显式授权路径）
      3. ✅ **已落（2026-10-06）**：`instrument_cli --ledger` 已接进 MCP —— 给 `observe_instrument` 补了
         `action='ledger'`（枚举原先只有 `instrument|uninstrument|restore`）。实现在
         `application/observe/handlers.ts` 的**只读分支**（复用 `loadProbeLedger` / `ledgerSummary`，
         **不碰任何写盘 / 备份路径**）；`message` 给人读台账（与 CLI 逐行一致）、`data` 给
         `{root, ledger, summary}`（`ledger:null` = 未找到台账 ⇒ **不抛错**，"没插过桩"是正常状态）。
         实测：`{"action":"ledger"}` ⇒ 明说「未找到台账…」+ 结构化 data；`{"action":"restore"}` **回归正常**。
         ⚠ **那个 CLI 文件本身仍在**（删它要连同 `package.json:51` 的 script 与
         `scripts/setup.mjs:36,253-257` 的**硬依赖**一起改）—— 属下一批。
      4. ✅ **已落（2026-10-06）**：给 `translate_go_ts` 补了 `holes` / 单文件 `out` / `batchSize` 三个入参
         （原先**只在 `translate_cli` 的 argv 里** ⇒ 能力被藏在 MCP 面之外）。★ 三条**逐字照 CLI 的规则**，
         并且照抄了 CLI 的**两条隐性契约**：**`--holes` 只在 `fill=false` 时给**（fill 时那些 prompt 已被消费
         —— 同一名字在两面必须是同一个意思，**不发明第二种口径**）、**`--out` 的防覆盖**（目标已存在且未 fill
         ⇒ 不覆盖，"防止丢弃已填的函数体"）与**闸不过不落盘**（"原子性，避免半成品"）。
         ★ 顺带把 `verify` 的**同名两义**写进描述（**projectDir 模式** = 全工程 tsc 门禁 · **单文件模式** =
         行为对拍）—— 原文只写了后半句，属"判据正在被使用、却没写进契约"。
         **实测六档**：① 空参回归**不变**（仍"需要 file=… 或 projectDir=…"）② `{file}` 基线 5 单元、无 prompts
         ③ `{file,holes:true}` ⇒ `data.hole_prompts` **4 条** + message 一行提示
         ④ ★ **与 CLI `--holes` 对拍：CLI 印 4 个 / MCP 给 4 条 ⇒ 一致** ⑤ `{file,out}` ⇒ **真落盘 560 B** +
         `data.out_path`；**再跑一次 ⇒「未落盘：目标已存在，不覆盖…」且文件未被改** ⑥ `{projectDir,batchSize:3}`
         ⇒「Go 项目翻译：12 个模块」（该档只读：不给 `outDir` ⇒ 不落盘）。
         ★ **未跑（如实记，只按代码核对）**：`holes` 与 `fill:true` **同时给**那一档（需 LLM key 池）；
         以及"骨架过不了验证闸 ⇒ 不落盘"那一支（需一个过不了闸的 Go 样本）。
         ⇒ ★★★ **投影③（CLI 入参按 schema 转型）已补齐（2026-10-06，同批）** —— 这一格原本是
           那批手写 `*_cli` 还活着的**唯一技术原因**：
           · **改法**：`cli <工具> key=value` 的值**按该字段在 `ToolDef.inputSchema` 里声明的类型**转
             （候选：字符串 / 布尔 / 数字 / JSON，**逐个交给该字段自己的 zod 定义判，谁过谁赢**）。
             ★ 判据**不是猜类型**：类型早在 zod schema 里 ⇒ **schema 就是那张表**（这正是 T58 那句
             "不发明第二套类型推断"的正解 —— 推断**根本不需要**）。
           · **实测**：`holes=true` **真出现**「待填孔 prompt：4 条」✅（改前布尔根本不生效）；
             `dry_run=yes` **当场点名**「字段 `dry_run` 的值 `yes` **不符合它在 inputSchema 里声明的类型**
             （已试：字符串）」✅；`project_dir=5` 仍是**字符串**（该字段声明就是 `z.string()` ⇒
             **schema 说了算、不按长相猜**）✅；`'renames=[{…}]'` 解析成**数组**（该被阻断的条目确实被阻断）✅；
             `--json` 逐字不变 ✓；`key=value` 与 `--json` 同时给仍**报歧义** ✓。
           · ★★ **踩坑（值得单独记）**：我第一版按"我以为的"写了 `def.inputSchema.shape[k]` —— 而
             `ToolDef.inputSchema` 的**声明类型是 `Record<string, z.ZodType>`**（**原始 shape 表**，
             不是 `z.object(…)` 实例）⇒ 恒取到 `undefined` ⇒ **整个转型静默退化成"原样字符串"**；
             ★★ 而当时三档读数**看起来还都"通过"**（布尔没生效却不报错、字符串字段本来就该收到字符串）
             —— **"看起来验过了"最危险的地方**。⇒ 教训：**读声明的类型，别按脑里的印象写**；
             且**要设计"不生效就会喊"的验收**（本次靠"布尔该产出的东西有没有出现"才抓住）。
         ⇒ ✅ **已删（2026-10-06，同批）—— 手写 CLI 13 → 7**：`instrument_cli` / `capability_cli` /
           `signal_review_cli` / `split_stage_cli` / `translate_cli` / `deprecate_offline_cli`
           **六个文件 `git rm`**（`dist` 的 12 个孤儿产物随之被 `clean_dist` 清掉）。
           · **前置（先迁调用方，不然删了就坏）**：`package.json` 的 **6 条 script** 与 `scripts/setup.mjs`
             的两处硬依赖（`INSTRUMENT_CLI` / `CAPABILITY_CLI`）全部改走**投影入口** `cli.js <工具名>`。
             ★ 顺带治了 setup.mjs 的"临时文件转一手"：现在加了个 `parseDataSection()` 直接读
             **`---DATA---`** 之后的机器段（那是 `plumbing.ts` 的既有约定，**不是新造的第二份口径**）。
           · **逐 flag 核对（删文件的判据）**：六个 wrapper 的 flag **全部 ⊆ schema**；唯一"没有对应"的是
             `capability_cli --json <file>` —— ★ 那是**输出去向**（数据在 stdout 的机器段里），**不是能力**。
           · **真跑验收**：`capability_audit`（`totalNeed:128` 与旧 CLI 读数**一致**）✓ · `signal_review` /
             `split_stage` 空参给可读「缺参数 "project_dir"」✓ · `translate_go_ts … holes=true` ✓ ·
             `observe_instrument target=<TS 夹具> dry_run=true` ⇒「将注入 2 探针点」**且夹具未被改** ✓ ·
             **`npm run doctor`**（走迁移后的 setup.mjs）⇒「能力矩阵：已装语言下 128 个缺口」✓。
           · ✅ **同批修掉（2026-10-06）**：`observe_instrument` 的 **`target` 用相对路径**时被**按错基准解析**
             —— ★ 根因**不是"拼接写错"**，而是**相对路径原样下传给了 cwd=语言包目录的子进程**：
             `instrumentGoProject` 把 `root` 当**位置参数**交给
             `spawn('go', ['run','./cmd/instrument',root, …], { cwd: goObserveDir() })`
             ⇒ 相对 `root` 被按**语言包目录**解析。**改前实测**：`target=observe-lang-go`（相对）⇒
             `Observe 插桩失败（语言包 go）：instrument: open <repo>\observe-lang-go\observe-lang-go`（**多拼一层**）；
             **绝对的同一目标 ⇒ 正常**（`扫描 12 个源文件 · 将注入 9/34`）—— 这类错**只在相对路径下出现**。
             ⇒ **修法**：在 **handler 入口一处**归一成绝对（`path.resolve(targetArg)`，基准 = **调用方 cwd**，
             与 `project_dir` / `file` 等入参同口径），三个出口（instrument / uninstrument / ledger）共用它；
             ★ 那个**台账分支原先自己又 `path.resolve` 一次** ⇒ 一并去掉（同一件事写两处）；并在
             `go_instrument.instrumentGoProject` 钉住"`root` 必须绝对"这一前置。
             ⇒ **改后实测四档**：**A** 相对 `target=observe-lang-go` ⇒ **通过**（`语言包：go · 扫描 12 个源文件`
             + 将注入 9/34/13）· **B** 绝对同一目标 ⇒ **逐字不变**（回归）✓ · **C** 相对 + `action=ledger`
             ⇒ 正常（报**绝对**台账根 + 「未找到台账」）✓ · **D** 相对 TS 目标 `src/domain`
             ⇒ `语言包：ts_js · 扫描 15 个源文件` ✓（TS 包不受影响）。总门五道全 PASS；dry-run **无落盘残留**已核。
             ★ **如实记**：改后**报表头**对相对入参会打印**绝对**路径（改前原样回显相对串）—— 方向是更准（报的是真目标）。
             ★ 另一处**同类嫌疑已核不成立**：`project_root` **不下传**子进程（只在进程内用）⇒ 无此问题。
             ★ schema 的 `target` 描述补上了口径（"绝对，或相对 cwd"）。
         ⇒ ✅ **`upgrade_cli` / `upgrade_rewrite_cli` 已注册（2026-10-06，本批）—— 工具数 60 → 61、meta 线 10 → 11**：
           两者收成**一个入口** `upgrade`（`action=scan` 只读五阶段 / `action=apply` 闭环）—— ★ 依据
           `docs/tool-convergence.md` §2.0「**按操作对象聚合**」：它们审的是**同一操作对象**「项目的版本升级契约差」
           （后者把前者的检测**整段再跑一遍**，只多"计划 + 应用闭环"）⇒ 动作互补（读 / 写）。
           核心**归位**到 `src/application/meta/upgrade/upgrade.ts`：原先那两段（渲染 + 闭环）住在 presentation
           的 CLI 里，MCP 面若复用就是**下层依赖上层**；且与 `deprecate_offline` 同笔法 ——
           **核心住能力层，CLI 退化成薄壳**（薄壳里只剩"argv → 调用 → 打印"）。
           ★ **实测八档（真跑；夹具全在 `$TEMP`）**：
             ① `scan`（node 夹具 `engines.node=12`）⇒ `toolchains: node12->v22.18.0/ok` + 命中
                `src/a.js:2 可选链 ?.`(since 14) + `src/a.js:3 new Buffer(...)`(deprecated) ✅
             ② **空调用**（签名门口径）⇒ stdout `缺参数 "project_dir"` + **非零退出**（= `mcp_scan` 的"合格 A"）✅
             ③ `apply`（夹具 A：`npm test` 通过）⇒ contract 1/1 · plan 2 条 · **baseline 已提交** ·
                `changed_files:["src/a.js"]` · `verify.status=pass` · **commit.committed=true** · 编辑真落盘 ✅
             ④ `apply`（夹具 B：`npm test` 失败）⇒ `verify.status=fail` · `rollback=true` · **无最终提交**
                （`git log` 只有 baseline+init）· 文件**真回退**（`src/a.js` 干净）✅
                ★ 追查掉一个**假警报**：回退后逐字节比对报"不一致"，实为 **Windows `autocrlf` 的换行归一**
                  （`\n` → `\r\n`）⇒ **内容语义相同**（差点误记成"回退失效"）。
             ⑤ `apply` 缺 `edits` ⇒ 给人话 + 指路 `action=scan` 的 `data.plan` ✅
             ⑥ 非 git 目录上 `apply` ⇒ `refused: not_a_git_repo` + 明确理由 ✅
             ⑦ 薄壳 `upgrade_cli --json` 与 MCP `scan` 的 `data` **逐字同形**（同源实现的直接证据）✅
             ⑧ 薄壳 `upgrade_rewrite_cli` 仅报告模式 ⇒ 正常（含"局部重写建议"与提示行）✅
           ★ **两处如实记的副作用**（已写进工具描述，不美化）：`apply` ① 前置 `project_dir` 须是 **git 仓库**；
             ② **会提交该仓库** —— 基线步骤把工作区**原有改动一并提交**（实测：夹具里那处未提交的 `notes.txt`、
                连同运行期冒出来的 `.agent-io/cache.db*` 都被基线提交了）。⇒ **待拍板候选**（本批不动，属行为/契约决定）：
                要不要给 `apply` 一个"不自动基线提交"的开关？
           ★ **这两个 CLI 随即已删（2026-10-06，同批）**：能力 100% 在 MCP 面，且**无 `package.json` script 牵连**
             ⇒ 直接 `git rm`；argv 面由 `cli.js upgrade` **投影**提供。
             ★★ **同批更正一条写错的口径**（我上一笔把"CLI 去留"写成了**拍板项**，那是**退步**）：仓里早就定了
               「**唯一真相源 = `ToolDef`（MCP 注册），CLI 与 MCP 都是它的投影**」—— 所以
               ① `cli.js <工具名>` **就是** CLI 面（argv 便利由投影给，连 `key=value` 按 schema 转型都是投影③补的）；
               ② 手写 `*_cli.ts` 是**同一入口的第二份副本** ⇒ 该删，`package.json` 的 script 只是**改指投影**
                  （机械迁移，不是"要不要留便利"的裁决 —— 上一批对 6 条 script 正是这么干的）。
               ⇒ 连带清掉这条口径带出来的**悬空引用**：`design/index.ts` 那句"保留 CLI 以留 argv 便利"（写时就错，
                 且那两个 CLI 上一批已删）、`translate_go_ts` 描述里的 `translate_cli`、`detect.ts` /
                 `adapters/registry.ts` / `translate/pairs.ts` / `meta/registry/cli_extract.ts` 里的旧 CLI 名。
         ⇒ ✅ **同批再收一个"错位文件"**：`archify_cli` **根本不是在说 CLI** —— 无 argv、无 `main()`、
           无 `process.exit`，只有导出函数（T15 早先那条"**不是真 CLI，是库**"是对的；后来把它列进
           "能力还没注册"是**列错了**）。它的**唯一消费者**是 `http/archify/archify_pipeline`（域 `archify-r5`）
           ⇒ **归位**到该域并改名 `archify_runner`（与 `deprecate_offline` / `cli/render/` 同笔法）。
           ★ 它的能力面是 **HTTP 端点 `POST /api/archify-demo`**（5 类 showcase 图），**不是 CLI-only**
           ⇒ 不在"待注册"之列；"要不要给它一个 MCP 工具"是**能力决策**（与 `render_brickwork` /
           `render_design` 有重叠），**单列待拍板**。
           ★ 搬深一层顺手补掉一处**脆弱假设**：`vendoredArchifyRoot()` 靠"从自身目录上溯找 `third_party`"，
           原层数 6 在旧位置（`presentation/cli/`）余 1 层，搬深一层后仓根正好落在第 6 次上溯 ⇒ **0 余量**
           （再深一层就静默失效）⇒ 提到 8 并在注释里写明；实测产物态 `resolveArchifyRoot()` 仍返回 `<repo>/third_party`。
         ⇒ ✅ **`brickify_cli` 这一格：侦察后「搁置」**（2026-10-06 用户裁定）—— 读源实测**推翻了清单原来的二选一问法**：
           它**不是"一个能力"，是一条 11 类产物的管线**（每个 flag 一类）；其中 `--out` 那个核心产物 **MCP 已有**
           （`render_brickwork` 的 `buildBrickifyPreview` 与它 **逐字同一对函数**）；**9/11 类产物的消费者不是
           agent**（人读验收 HTML / 前端页物 / 前端窗口B 的对接契约 —— 源注释逐字）⇒ 真"agent 够不着"的只有
           `--json` 的报告。★ 它属于**版本 B**（框架只给插槽、语义由模型填）那条线
           ⇒ **搁置到版本 B 重启时一并裁**。
           ★ **登记处**：`docs/frontier-universal-framework.md` **§6.3**（三档形状 + 代价 + 历史三条裁定 + 牵连清单）。
         ⇒ ★ **剩下的 3 个**：`cli.ts`（**投影本体**）+ **2 个正当例外**（`install_package_cli` 判为一次性运维脚本；
           `diagnose_loop_cli` 要 `readline` 交互 —— **MCP 无法应答**）。手写 CLI 面 **13 → 4**（删 8 个 + 归位 1 个）；
           ★ 至此唯一没定的"能力面"是 `brickify` 那一格 —— **已搁置**，不再是待拍板项。
         ⇒ ★ **`translate_cli` 至此升进 (A) 级**（能力已 100% 在 MCP 面）⇒ 它的**去留**成为与
         `signal_review_cli` / `split_stage_cli` 同类的**待拍板**问题（删它要动 `package.json:55` 的 script）。
      5. ✅ **已落（2026-10-06）**：把核心 `deprecate_offline.ts`（434 行、`runDeprecateOffline` 本体）从
         `src/presentation/cli/` **归位**到 **`src/application/refactor/deprecate_offline/deprecate_offline.ts`**
         （`deprecate_offline_cli.ts` 留在原地 —— 它才是"一条命令"）。
         ★ **判据不是我的直觉，是两处既有声明**：① 它自己 import 的是
         `application/refactor/edit/remove_dead_imports` ⇒ **它本就是 application 层的能力**；
         ② `structure.domains.json` 的 `cli-surface` note 那条平铺规则是"**每个文件 = 一条命令**"
         —— 而它当年是被**明文豁免**写进那条 note 的（"`cli.ts` + 各 `*_cli.ts` + `deprecate_offline.ts`"），
         与 `cli/render/` 当年同型。
         ⇒ **改法**：`git mv`（留历史）+ 4 处 `../../infrastructure/` 深度 +1、跨工具引用改同线相对
         （`../edit/remove_dead_imports.js`）+ 头注写清"为什么它不住 cli/"；并**在域表里新立一个域**
         （`deprecate_offline` · layer=application · role=capability）+ 清掉 `cli-surface` note 里那条豁免（14 → 13）。
         **实测**：搬后真跑 CLI（`--project .` dry-run）⇒「扫描 1770 文件 → 0 个死源…」✓；
         `structure_gap` 复测 **"结构意图与现状一致 ✓"**（`misplaced` / `unlisted` / `missing` 全空 ⇒ 没引入新缺口）；
         总门五道全 PASS。
         ★ **如实记**：`structure_gap` **改前也报"一致 ✓"** —— 因为旧 note **明文认领**了那个文件
         ⇒ **这把尺子看不见"意图本身写错"这种缺口**（它只对账"声明 vs 磁盘"，不对账"声明合不合理"）。
         ⇒ ★★ **已注册为 MCP 工具（2026-10-06，同批）—— 工具数 59 → 60**：
           · `deprecateOffline`（★ **函数名 = 文件名 camelCase** 是**量具的 [B] 判定口径**，不是随手起的名）；
             核心转私有；`touched` 在**唯一构造点** `touchedOf` 里出来：`project_dir`（作用域类 ⇒ 随时可给）
             + `written_files`（对象类 ⇒ **只在真落定时给**）。
           · ★★ **`written_files` 的取数不重写判据**：那条主路径（`removeDeadImportsWithVerify`）**不自带
             `touched`**，但它带着 `removal_reports[].changed` —— 与 `remove_dead_imports.touchedOf` **同一判据**
             ⇒ 把那个判据**抽出来导出**成 `writtenFilesOf()`，**两处共用一把尺**（自己再写一遍过滤器＝造第二份判据）。
           · ★ **净变动只有执行处知道**：`sink` 在"改动**真的留住**"的两处记账（基线黄 / 编译回归已回滚 ⇒ 不记）；
             事后从 `items` 反推会**把回滚的也算成改过 ＝ 撒谎**。
           · 缺省落**安全那侧**：`dry_run` 缺省 true；要真落盘得显式 `dry_run:false`，物理删还要 `remove_file:true`
             （**两道闸**，与 CLI 的 `--apply` / `--remove-file` 一一对应）；[C] 层补了 `requireStr` 守卫。
           · 文档牵连（T15 明列的那两条）：README ×2 计数 **59 → 60**、`gen_agents.mjs` 触发点表 +1 行（build 重建 `AGENTS.md`）。
           **实测四档（真跑 CLI，夹具 `$TEMP/t60a` / `t60b`）**：① 空参 ⇒ `缺参数 "project_dir"`（不是裸 TypeError）
           ② **dry-run（缺省）** ⇒ `touched` 只有 `project_dir`、**夹具一个字节未改**、`data.items` 1 条
           ③ **apply** ⇒ ★ `touched={project_dir, written_files:["src/consumer.ts"]}` + `offlined=1` +
           消费者的死 import **真被删掉** ④ `remove_file:true` ⇒ **模块文件真被物理删除** +
           `written_files` 含被删的 `src/dead.ts` + `status="file_removed"`。
           ★ 量具：**[B] 人群 37 → 38 · 已接 31/38 · 该给未给＝真债 0**（棘轮认了它）。总门五道全 PASS。
         ⇒ ★★★ **同批挖出三条真缺陷（都落在"验证 / 候选识别"层）—— ✅ 当晚已修，见下**：
           · **(a) `resolveConsumerSource` 不认 TS 的 `.js` 说明符**：候选表是 `[base, base+ext…, base/index+ext…]`
             ⇒ `import … from './x.js'`（**本仓全仓的写法**）**resolve 不到 `x.ts`** ⇒ 该 source 被判"非自研"
             ⇒ **静默漏报候选**（★ 我造夹具时踩到的就是这个：`./dead.js` ⇒ 0 候选；改成 `./dead` ⇒ 1 候选）。
           · **(b) `defaultVerifyCommands` 给 `npm test` 硬加 `-- --run`**（**假定 vitest**）⇒ 非 vitest 项目
             **基线恒失败** ⇒ 一切 verify 门下的 apply **都做不了**。★ 且这行是**测试框架整体移除**（2026-10-04）
             之后的**遗留**（本仓 `package.json` 今天已无 `test` script）。
           · **(c) `npx tsc --noEmit` 会假通过**：项目没装 `typescript` 时 npx 解析到 npm 上那个**同名假包**
             （打印 "This is not the tsc command you are looking for"）并**退出 0** ⇒ 基线 tsc 闸**形同没有**
             （实测 detail 就是 `[tsc noEmit] pass` + 那段假包文案）。
             ⇒ 三条都**有原始输出为证**（见对应 commit）。★ (b)(c) 在**同一条函数**里，且 (b) 笼罩**所有** verify 工具。
             ⇒ ✅ **三条已修（同批第二笔）**，判据都是"**别猜：要么有证据，要么把选择交给调用方**"：
               · **(a)** 候选表加"**去掉 `.js`/`.mjs`/`.cjs`/`.jsx` 后再试各源扩展名**"（★ 仍**先按字面试**：真有
                 `x.js` 在场就按 `.js` 命中 —— 不越权改语义）；
               · **(b)** `--run` **只在检出 vitest 时**才加（`deps.vitest` 或本地装了 `vitest`）：加它的本意只是
                 "别让 vitest 进 watch 把验证挂住"，那顾虑**只对 vitest 成立**；其余项目**原样跑 `npm test`**
                 （★ 不替用户改命令）；
               · **(c)** tsc **只在本地真的装了 `typescript` 时**才进命令组（★ 判据用"**装了没**"而不是"声明了没"：
                 声明了却没装（`npm ci` 没跑过）同样会走 npx 的下载/假包那条路）。
                 ★ 副作用（**方向是更安全**）：两样都不成立（没 ts / 没 test）⇒ 命令组**为空** ⇒ 各调用方按
                 "**不可自动验证**"如实降级 —— `deprecate_offline` 会**拒绝物理删文件**，而不是去信任一个假通过的闸。
             **实测（一体式：夹具用 node 建、★ 用 `.js` 说明符 + test 脚本**不认** `--run` + 没装 typescript）**：
               · 命令组：夹具 ⇒ `["npm test :: npm test"]`（**无 tsc、无 `--run`**）✅ · 本仓 ⇒ `["tsc noEmit :: npx tsc --noEmit"]`
                 （**不变**，无回归）✅
               · 夹具基线 `status` **pass** ✅（改前是 `[npm test] exit 9`）
               · **(a)** dry-run ⇒「1 个死源 → **1 个可下线自研积木候选**」✅（改前是 **0**）
               · **端到端 apply** ⇒「1 候选 → 下线 1，回滚 0」+ `written_files:["src/consumer.ts"]` + 死 import **真被删** ✅
               · **端到端 `remove_file`** ⇒ `dead.ts` **真被物理删除** + `written_files` 含它 ✅
      6. ✅ `upgrade_cli` / `upgrade_rewrite_cli` **已注册为 MCP 工具 `upgrade` 并已删除**（2026-10-06，同批；工具数 60 → 61）
         ★★ **并更正一条过期口径**：这段原写「`signal_review_cli` / `split_stage_cli` / `translate_cli` 三个的**去留
         仍待拍板**（删它们要动 `package.json` 的 script）」—— **三处都过期**：那两个 CLI 上一批（`e60e8e7`）**已删**，
         `package.json` 的 script 也早已**改指投影**（`cli.js <工具名>`）。**「CLI 去留」不是拍板项**：
         CLI 面由投影提供，手写 `*_cli.ts` 只是同一入口的第二份副本 ⇒ 一律删；
         唯一真拍板项仍是 **`brickify` 的形状**（新立 `brickify` vs 给 `render_brickwork` 加 `artifacts` 枚举）
      7. **`install_package_cli` ⇒ 判为一次性运维脚本**（`spawn npm install/uninstall` 改环境 + 联网；
         且 MCP 面 `lang_hint.ts:117,147,149` **主动指引用户去跑它**）⇒ **保留、不注册**
      ★★ **第三轮盘点（2026-10-06，独立子代理逐个 flag 复核）—— 结论：上面这张"剩下"清单基本准确，
        本笔只补两件它没写的**：
      · ★ **「删 / 改前必改清单」**（上面第 6 项的"CLI 去留"必须先看这个）：`package.json` 有 **9 条**
        script 指向这些 CLI（`:51` instrument · `:55` translate · `:57` brickify · `:58` signal-review ·
        `:59` split-stage · `:60` deprecate-offline · `:61` capability · `:62` install-package ·
        `:64` diagnose-loop；★ `upgrade_cli` / `upgrade_rewrite_cli` **未登记 script**）；
        ★★ **`scripts/setup.mjs` 是同仓的硬调用者**（`:36` `INSTRUMENT_CLI` · `:37` `CAPABILITY_CLI` ·
        `:176` 跑 `capability_cli --installed --json` · `:253-257` spawn `INSTRUMENT_CLI`）
        ⇒ **这两个 CLI 不能直接删**（删前先让 `setup.mjs` 改走 `cli.js <工具名>`）；
        ★ `README.md` / `README.en.md` 对外宣传了 `diagnose-loop` 等 CLI 名 ⇒ 改要同步文档。
      · ✅ **三个 (A) 级「能力已全在 MCP」再确认**（逐 flag 核对 ⇒ 可据此删 CLI **文件**）：
        `capability_cli`（全在 `capability_audit`：`installed_only` + 结构化 data）·
        `signal_review_cli`（6 个 flag 全对应 `signal_review` 入参）·
        `split_stage_cli`（6 个 flag 全对应 `split_stage`，含 `--no-reexport` = `re_export_extracted:false`）。
        ★ 但仍建议**与上面那份"必改清单"同批做**（否则破坏 script / `setup.mjs`）。
      · ⚠ 另记（第 1 项定形状时要按这个来）：`brickify_cli` 的 11 类产物里**只有 `--out` 有 MCP 对应**
        （`render_brickwork` 的 `output_path`），其余 10 个（`--json` / `--mindmap` / `--workbench` /
        `--sandbox` / `--anatomy` / `--tools-map` / `--wizard` / `--dsl-workbench` / `--workbench-data` /
        `--narrate`）**无任何出口**。
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
      **牵连**（★ 2026-10-05 重盘：**原列四条全部已不存在**，别再照做）：
      · `tests/fixtures/tool_set_snapshot.json` ⇒ `tests/` **整体已移除**（2026-10-04）⇒ **没有**快照门
      · "`readme_tools_gate` 会红" ⇒ 该脚本**已删**（属"门"，2026-10-05 用户裁定「不养门」）⇒ **不会红**
      · `package.json` 指向 `dist/src/tools/*_cli.js` ⇒ 现为 `dist/src/presentation/cli/*_cli.js`
      · `tests/server_registry.consistency.test.ts` 的 `INTERNAL_MODULES` ⇒ 同上，测试框架已整体移除
      ⇒ **真牵连只有两条**（本轮都已做）：**README 计数**（手工维护、无门）与
      **`AGENTS.md` 触发点表**（改源头 `scripts/gen_agents.mjs`，`npm run build` 重建）。


---

## 待核实（**不是欠账，不许当事实用**）

来源：09-30 一次「扫旧节号里的'遗留/待办'」的梳理。

★★ **2026-10-04 逐条核验（grp-docs，代码级取证）**：原列 **16 条**（注：任务标题写的“11 条”与实际条数不符）。
逐条到代码/门/工具取证后：**14 条已还清或已被既有条目覆盖 ⇒ 删**（逐条证据见核验回执 / commit 历史；
含 `G3/G4 门`、`P-A/P-D/P-G`、`symbol_move`/`project_root`、`refs_text`、`仓库资产索引`、`P2`、`P3`、
`G1 复杂度阈值`、`orphan 7 个`、`explore_code 空壳`），**1 条升级为待做**（`G5 README 计数自愈`
⇒ **2026-10-06 已由"去掉标题里的数字"结构性解决**（那个数字先后写过 34/41/51，都不等于行数）⇒ 条目已销）。
**剩 1 条决策项**：

- `P4 工具名拍板` —— 是否真改 `mcp__design-canvas__*` 工具名（会断 DSH 现有会话与桥接）⇒ **需用户拍板**；
  若真改名，`DELETED_TOOLS` 墓碑（老调用返回 warning 而非 unknown tool）尚需实现。

- **全仓 5 处「语言代号」类型定义，词汇分三类（2026-10-05 由 T28 顺带发现；未判断要不要统一）**
  *(核实：`grep -rn "type Lang\b\|ToolName =" src` —— 逐处读其**含义**，不是只看名字。)*

  | 位置 | 定义 | 实际概念 |
  |---|---|---|
  | `contract_gate/parts.ts:11` | `'go' \| 'ts' \| 'py' \| 'java' \| 'cs' \| 'c'` | **源码语言** |
  | `observe/trace_exec.ts:62` | `'ts' \| 'py' \| 'go'` | **源码语言** |
  | `design/derive/derive_chain.ts:62` | `'go' \| 'ts' \| 'py' \| 'unknown'` | **源码语言** |
  | `design/lifecycle/scaffold.ts:53` | `'go' \| 'ts' \| 'py' \| 'js' \| 'vue' \| 'react' \| 'unknown'` | ★ **项目形态**（含框架，不只是语言） |
  | `version_upgrade/adapters/types.ts:23` | `'java' \| 'node' \| 'go' \| 'python' \| 'csharp' \| 'c'` | ★ **工具链/运行时** |

  ⇒ 前 3 处是**同一个概念的三份定义**（且词汇本就不同：一处含 `java/cs/c`，两处只有 `go/ts/py`）；
    后 2 处**根本不是一个概念**（`vue`/`react` 是框架、`node` 是运行时）
    ⇒ ★★ **不许一把抓去合并** —— 这是本仓「**名字像 ≠ 同义**」那条纪律的**又一实例**
    （正例可对照 `Touched` 里**已退役**的 `files`：同名却三种语义）。
  ⇒ **未判断的**：前 3 处要不要收口成一个共享类型？
    **反对**：分属 3 层，收口引入跨层耦合；每个联合只有 3~6 个字面量、**没有独立的读取器**。
    **赞成**：同类词表分散 ⇒ 加一门语言要改 3 处（与 T28 想解决的"命名漂移"同源）。
    ⇒ **待定，不预设结论，也不动。**

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
| **MCP client 配置**（`.trae/` · `~/.claude.json` · `~/.cursor` · `~/.codex` · `~/.github` · `.vscode` …） | 启动路径 + server 名 | ✅ **2026-10-05 已有判据**（见下） |
| `~/.workbuddy/mcp.json` | 启动路径 | ✅（同族；实测该文件本来就是对的） |
| `~/.workbuddy/skills/dc-*` | 操作手册里的路径 | ✗ |

★★ **2026-10-05 已收口一个切片（MCP client 配置面）**：`scripts/install_mcp.mjs` 增强为**六态**
（`missing｜present｜configured｜stale｜not-installed｜corrupt`）+ **换名即清旧键**（`LEGACY_KEYS`，JSON/TOML 同）
+ **陈旧条目检出并重写**（逐字段比对，`${workspaceFolder}` 归一）；**入口默认值也修正**（旧值
`dist/src/server.js` **从来不存在** —— 本仓 `.trae/mcp.json` 就是这么坏的）；并落 `package.json` 的
`mcp:install` / `mcp:check`。
**实测**：修好本仓 `.trae/mcp.json`（旧品牌键 `design-canvas` + 不存在的入口），覆盖 5 个已安装 client，
3 个未安装的被 `probe` 拦下（**不再误造目录**）；第二次跑全部 `configured`（**幂等**）。
★ **仍未做**：`dsh-brain` / `dsl-workbench` / `elv` / 技能包 —— 那几面**还是没判据**。

**建议**（未做，**只针对非 MCP 配置的下游**）：写一个 `scripts/check_external_refs.mjs`，读**一份仓内的清单**
（哪些外部路径引用了本仓）⇒ 逐个 `fs.existsSync` + 检查里面出现的本仓路径是否还存在。
★ 难点：清单本身是**仓外的**，所以它必须被**抄进仓内**（这正是"唯一数据源"要付的代价：
要么承认它管不到，要么把它纳入一个有人维护的表）。**别让它继续散在没人看的地方。**
★ ★ **但先看有没有更省的形状**：MCP 这面这次的解法是"**把判据做进写入器本身**"（`install_mcp` 自己检陈旧 +
清旧键），比"另立一张下游清单 + 再写个检测脚本"省得多 ⇒ 其余下游**先判能不能照此办**，再决定要不要那张清单。

- [ ] **T64 ⚠ 「搬迁时过一遍活文档」这条纪律仍缺（T50 的后继，2026-10-06 由 T50 落地时立）**
      *(T50 的"路径过期"**本身已处理**：`docs/adding-a-language.md` 顶部立了「2026-10-06 现状核对块」
       —— 路径换算表（`src/tools/*` → 四层新位置，13 条）+ 失效命令对照表（`capability_scan.mjs` /
       `npm run test -- tests/…` / `npm run arch`）+ 内容已变处（`hybrid_precheck` 已删 ⇒ 能力数 **12→11**、
       缺口 523 **无法对账**）；并就地删掉了 §0.3 的死命令与它那块"实测输出"、重写了 §5.2 整张失效的测试表、
       给附录 C 的过时数字打了时效标注。)*
      ⇒ 但 T50 指出的**根因**还在：**散文里的路径，grep 不到、门也管不到** ——
        它属"人读的路径"（T31 那 5 例是"机器读的名字表"，是另一族）。
      ⇒ ★★ **本笔明确不做 T50 原文设想的"脚本化判据"**（"文档里每个 `路径:符号` 都要 `fs.existsSync` 命中"）：
        那会是一个**扫文档找路径的新门**，而本仓近期的裁定恰恰是**删掉那一类**
        （`readme_tools_gate` / `capability_scan` 都因"产出只是提示你去看某个文件"被删）
        ⇒ 再立一个同形的门是**逆着裁定走**。
      ⇒ 待定方向（等下次大搬迁再定，**别现在造工具**）：
        · (a) **流程**里加一步"搬迁完过一遍活文档"（不是门）；
        · (b) 让活文档**不写路径字面量**，改指"符号名 + 由工具现查路径"（前提是先有"符号→路径"现查能力）；
        · (c) 接受它会漂，**每次大搬迁后在文首立一个"现状核对块"**（★ 本笔就是这么做的）。
      ⇒ ★ 本笔倾向 (c)：零新工具、零门，且**如实**（不假装活文档不会漂）。




- [ ] **T66 ⚠ 「入口保鲜」与「陈旧告警」**两道保障都依赖 4 个项目根参数名**（已核：当前无实例，属结构隐患）**
      *(★ 本条**替代 T65** —— T65 的结论「`cross_repo_symbol_index` 拿不到保鲜是真问题」**被自己实测推翻**：
       `compareProjects` → `buildProjectIndex` → `buildImpactGraph`，而后者是**现场全扫 + 全解析**
       （`collectSourceFiles` 读盘 + 逐个 `parseFileFull`，见 `impact/index.ts:132-144`）—— **不读 `cache.db`**
       ⇒ 每次都是新鲜结果、**不需要保鲜**；「两个根都要保鲜」那套修法讨论因此作废。)*
      ⇒ **形状**：`presentation/mcp/server_registry.ts` 的 `invokeTool`（唯一入口）有两道索引保障，
        **都用同一个 `projectRootArg(a)`**（只认 `project_dir` / `project_root` / `root` / `dir`）：
        · `firstContactBackfill(rootArg)`（首次接触后台建索引）—— `null` ⇒ 不建；
        · `staleIndexWarning(rootArg)`（陈旧标注）—— ★ 函数**第一行就是 `if (!rawRoot) return null`**（静默）。
        ⇒ **入参里没有这 4 个名字的工具，两道保障同时失效**（59 个工具里 **18 个**属于此类）。
        ★ 本笔**更正了上一轮我自己写错的半句**（原文说「标注层不依赖参数名 ⇒ 仍生效」—— 错，它同样依赖）。
      ⇒ ★★ **已核实：当前无实例**（这 18 个里没有一个「读 `cache.db` 却又不自己保鲜」）：
        · `explore_code` —— **自己就接**（`case 'diff_impact'` 里 `await ensureProjectIndex(impactRoot)`，
          注释写着「**零前置**」；`observe_points` 的 handler 同款）；
        · `cross_repo_symbol_index` —— **现场全扫**（见上）；
        · `harvest_decisions` —— 从**文档 / git 日志 / 注释**提决策卡、**不读 `cache.db`**
          （`harvest/index.ts` 的 `ensureProjectIndex` 属 `harvest_closure` / `extract_contracts`，那两个有 `project_dir`）；
        · `observe_log` / `observe_trace` —— 读 **events.jsonl**（`observe/index.ts` 的 `ensureProjectIndex`
          属 `recommendObservePoints`）；
        · `consistency_check` / `detect_drift` —— `DSL ↔ 代码`对比（入参 `feature` / `code_dir`）；
        · `design/index.ts` 的 `getProjectCacheDb` —— 只服务 **`import_project`**（那个工具有 `project_dir`）。
      ⇒ ★ **为什么仍留此条**（不是「待核」，是**结构性隐患**）：形状本身没变 —— «保障靠参数名» ⇒
        将来任何**新**的无根工具只要读索引，就会**同时**丢掉保鲜**与**告警（**静默**读到旧图）。
      ⇒ 待定修法（**形状决策**）：
        (a) 扩 `projectRootArg` 认更多名字 ⇒ 治标（越认越多，正是 `storage.ts` 记过的「**越兜越多**」教训）；
        (b) ★ 让**读索引的那一层**（`getProjectCacheDb` / `findCacheDb`）**自己取根并保鲜**
          —— 结构保证，不靠调用方参数名（代价：那一层要知道「谁在调」）；
        (c) 让**工具声明**自己的根参数名（`ToolDef` 加一个字段）⇒ 显式、类型钉死。
      ⇒ ★ 本笔已在 `capability_map` 的「★ 通用前置」③ 里**如实写明**该限制 + workaround
        （显式先调 `index_integrity({project_dir, refresh:true})`）⇒ **不再静默**。

- [ ] **T43 ★★ 前沿研究：通用多语言组件框架（若重开 ⇒ 先做三个"最小可证伪实验"）**
      *(核实：2026-10-05 用户裁定"积木线/项目融合线作为万能框架实现不了 ⇒ 删代码、留设计文档"。)*
      ⇒ **文档**：`docs/frontier-universal-framework.md`（原始设想逐字保留 + 六层解剖 + 阵亡记录 +
      三个实验 + 术语检索表 + 证据分级）。**这份文档本身就是这件"研究"的产物，本条只挂它的"下一步"。**
      ⇒ ★★ **2026-10-05 补：文档已加 §5.2「两个版本」** ——
        上面那句"实现不了"只管**版本 A（框架自己懂一切语义）**；
        用户后来描述的**版本 B（框架只给插槽，语义由模型填）不在证伪范围内**，
        而文档 §4.1 第 3 条（"⑤⑥ 的消费者可以不是运行时，而是人 / LLM"）正是它的依据。
        ⇒ **"万能"的判定定义**：`「任何语义都能用同一种方式插进去」+「插进去之后能用同一种方式组合」`；
        ★ 本仓三条腿（接口统一 / 模型填语义 / 判据守门）里，**缺的是第一条腿的另一半 = 入参形状 + 管道**。
      ⇒ 六层解剖的结论：**① 跨语言运行时（WASM Component Model / GraalVM）· ② 绑定生成（SWIG/uniffi）·
      ③ 多语言构建（Bazel）· ④ 依赖统一 都有更强的主人 ⇒ 不自造；⑤"什么算一块积木" 与 ⑥"契约本身"
      才是空格子**（⑥ 在本仓**已有落地**：产物端 `Touched` 契约 + 受控词表 + 量具棘轮，2026-10-06 结案）。
      ⇒ ★ **三个实验（都不必自造框架）**：
        **实验 0（半天，最便宜）** 用 WASM CM 官方教程走通 Rust 组件 + Python 宿主 ⇒ **若卡住则 ① 层死心**；
        **实验 1（现在就能做，用保留下来的 `harvest_closure` + `extract_contracts`）** 对真项目抽 1 个候选积木，
        **量化"人工改判率"**（> 50% ⇒ "从任意项目抽零件"是假命题）；
        **实验 2** 只挑一对一语言（TS↔Python），用 napi-rs / PyO3 做"同一份契约 → 两端绑定"，**判据=不写一行 glue**。
      ⇒ ★ **未核实项**（文档 §10 已列）：WASM CM 的真实成熟度（未查各语言支持矩阵）· uniffi/napi 的许可证
        （若 adopt，按 `oss-prior-art-first` §3.5 必须先看许可）· "⑤ 无通用解"是判断而非查到的结论（**实验 1 可证伪它**）。
      ⇒ ★★ **2026-10-06：文档 §6.3 新增一条「搁置记录」** —— `brickify`（= §1 那句"先积木化"的代码承载）
        的**产物面形状**。触发是 T15 最后那一格；侦察结论：它**不是"一个能力"，是一条 11 类产物的管线**，
        其中 `--out` 那个核心产物 **MCP 已有**（`render_brickwork` 与它**逐字同一对函数**）、
        **9/11 类产物的消费者不是 agent** ⇒ 真"agent 够不着"的只有 `--json` 报告。
        ★ 它属于**版本 B**（框架只给插槽、语义由模型填）那条线 ⇒ **搁置到版本 B 重启时再裁**；
        三档形状 + 代价 + 历史三条裁定（§2 操作面登记 / B 组"判不合并" / §5.5 改名）+ 牵连清单都在 §6.3。
      ⇒ ★★ **2026-10-06（同日第二笔）：文档新增 §11 —— 把用户第二轮「积木框架」设想合并进六层**。
        用户第二轮说法（打包成接口的容器 / 自动解析接口 / 大包套小包 + 哈希查重映射 / 声明依赖版本 /
        schema 当文本或语义化名字 / 统一凭证入口 / 积木一等公民 + 逼 LLM 实现前先查）**逐条对到 §3 表上** ⇒
        **(i) 上半部（打包·接口解析·依赖托管·哈希去重）全部落在 ①–④，仍是有主人的版本 A ⇒ 不做；
        (ii) 真正增量 = ⑤⑥⑦ + 一个本文原表没有的第⑧层（信任/权限/生命周期）⇒ 属版本 B。**
        ⇒ 同时钉住**三处更正**（用户对、助手错）：① "块里有 bug"措辞错 ⇒ 真问题是**契约完备性**（黑盒论证 = §5.2 无知的内核）；
        ② "保谁进市场"在**单信任域下不需要溯源/签名**（仅跨信任域才需要）；③ **内容寻址的积木不可变 ⇒ 不腐**，
        会腐的是**发现元数据**（受控词表/描述），是 `/etc` 病而非积木病。
        ⇒ 残留难点（去掉被更正的三条后）：**组合验证不能预先两两做（组合爆炸 + 未预见组合）** · 契约全函数性 ·
        **语义身份（受控词表，非"起个名字"）** · "倒逼"需要召回层。
        ⇒ ★ 新增最便宜的可证伪实验（替换§7实验1的措辞）：**同一功能写两次，框架能否判出"已有等价积木"并拦住第二个**
        （读数 = 召回率 + 误拦率；召回高且误拦可接受 ⇒ 倒逼成立，否则 marketplace 复用率 0）。
      ⇒ ★★ **2026-10-06（同日第三笔）：用户问"要不要另立项目 / 做企划书" ⇒ 产出 `docs/component-framework-proposal.md`（积木框架企划书）**。
        **结论：不另立项目**（底座 ①–④ 有主人；能自造的 ⑤⑥ 已在现有仓落地 ⇒ 开新仓 = 重做 + 重蹈 §6 覆辙）。
        企划书的核心**不是施工排期，是「决策门」**：
        **G2（现在就能做，且在现有仓）** 把 `find_references → rename_symbols → edit_code → run_tests` **真跑通一条链**（= 补管道，= 本文档 ④ 的下一步）；
        **G1** 同一功能写两次能否判出等价并拦住（召回/误拦两读数）；
        **G0（半天）** WASM CM 教程走通 Rust 组件 + Python 宿主（接口由 WIT 定义）。
        ★ **立项门 = G1 + G2 双通过** ⇒ 里程碑：**M0/M1 在现有项目里长，M2 才谈新仓**。
        ★ Anti-goals 九条（不造运行时/绑定/构建/包管理 · 不承诺自动切积木/自动判定契约/任意两块能拼 · 单域不做签名溯源 · 不把"省运行期实例"当卖点）。



> ★★ **上面 T37/T38/T39 是 2026-10-05 体检**当场**修掉的三笔**（已进 commit 历史，故不在此列）：
> `f2e9066` cross 线假阳性 + P-D 守卫漏接 · `94987c4` 补齐 18 工具缺参守卫（**59 工具零坏签名**）
> · `25ab56c` `render_brickwork` 默认输出归位 `<agent-io>/docs/`。


- [ ] **T49 ★ 「写用户源码」没有单一可检查通道（2026-10-05 逐文件扫描发现，待拍板）**
      ⇒ **事实**：`write_gate.writeSourceFiles` / `applyWrites` / `snapshotAndRecordSelfWrite` 覆盖了主干
        （`scaffold` · `rename_symbols` · `rename_local` · `edit_code`→`applyWrites` · `remove_dead_imports` · `refactor_pipeline`），
        但**全仓 64 个文件有直接 `fs.writeFileSync`**。其中大部分写的是**产物/数据**（HTML/JSON/缓存/词典）不是源码 —— 这个区分合理。
        ★ **真正缺的不是"标签"，是一条可检查的不变量**：「任何写用户源码树的路径必须经过 `write_gate`」
        （快照 + 索引写穿 + 自写登记）；产物/数据写 exempt，但要在声明里标明。
      ⇒ ★ **为什么不能做成"每个文件贴 read/write 标签"**：`read`/`write`/`parse` 是**完全可派生的**
        （AST + import 图 + `fs.` 调用点，`cache.db` 里已有 `imports`/`edges`/`symbols`）⇒ 手工维护标签表
        = **又一份可写副本 = 判据分叉**，正是本仓打了两年多的那场病。`b_terms.ts` 就是为不做第二份副本才存在的。
        ⇒ 同理，**不要给 500 个文件贴"操作类型"标记**；该记的只有机器算不出的判断（`role` / 公开面）。
      ⇒ ★ **本条的直接收益**：2026-10-05 实测 `refactor_pipeline({steps:{dead_imports:{enabled:true}}, verify:false})`
        **无 dry-run 档、静默改盘 39 个文件 / 176 条 import**（含 `.inspect/**` 探针目录），已 `git checkout` 还原。
        若"写源码必过 `write_gate`"成立 ⇒ 闸门处即可挂"dry-run 默认"，这类事故**在入口被拦**而不是事后靠回执读出来。




- [ ] **T63 ★★ 新前端接入：走 daemon 串行队列，别再开直写路（2026-10-06 用户告知旧前端待退役）**
      *(用户原话：「那份前端也该退役了，我找到了更好的产品形式，**后续会重新开发**」+
       「目前**没有心力去开发维护**，你改完之后**留个清单**就行」。)*
      ⇒ **本条的用处**：等新前端开工时**先读这一条**，别重蹈覆辙。
      · ★★ **唯一要记住的一句**：新前端的存盘**不要**再直写 `saveDSL`，**复用 daemon 的串行队列** ——
        `POST /api/dsl`（`ops` 形态，见 `daemon/dslWriteHandler`）：单写者 + 依赖区域分桶 + 乐观锁，
        结构性消除"最后写者胜"。旧前端那条 `/api/save` 正是**弱闸通道**（无队列、rev 可选、
        且不带 `_dsl_rev` 时**静默直写**，现已加一行 warn）。
      · **待新前端就位后评估**：删掉 `/api/save` 及其 `source='browser'` 语义。
        删前要确认：**仓外还有没有别的东西在调它** —— 它今天的调用方在**仓内 0 处**，
        而前端是运行时产物（`output/` 被 `.gitignore` 忽略）⇒ 现状**无法证实也删不掉**。
      · ⚠ 若新前端也走 daemon 的 `ops` 路，那 **T20 那条的 (ii) 会更突出**：闸现在只在
        `editDslHandler`（MCP 面）⇒ 直接 POST daemon 带 `ops` 可绕过。届时再决定
        "闸下沉到 `updateFeature`"（层问题：evidence 是 MCP 面输入契约）还是"daemon 侧另加一道"。
      · 相关资料：`handleApiSave` 头注（决定与缺口写在**代码现场**）；`docs/todo.md` 的 T20 条目。







