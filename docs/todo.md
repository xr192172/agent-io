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

- [ ] **T56 ★★★ `read_files` 是一个「通用袋子」—— 5 个产出方**至少 3 类语义**（2026-10-05 实测）**
      *(核实：逐个读 5 个 `[B]` 的 `touchedOf` 构造点，非推断。)*

      | `[B]` | 它的 `read_files` 装的是 |
      |---|---|
      | `find_references` | **源码文件**（definition + importers + fieldRefs + typeCandidates；自陈"报告出来的子集"） |
      | `extract_contracts` | **源码文件**（`contract_reports[].path`，闭包内逐文件） |
      | ★ `reconcile_effects` | **事件文件**（`events-*.jsonl`）—— ★ **根本不是源码** |
      | ★ `reconcile_chain` | **宿主源文件 + 事件文件**（★ **两类混在一个键里**） |
      | ★ `harvest_decisions` | **注释所在文件 + 文档文件**（`git log` 的 `file_path` 与 doc ref） |

      ⇒ ★★ **至少 3 类语义**（源码 / 观测事件 / 注释与文档）⇒ **不能一概而论**
        —— 用户 2026-10-05 的判断（"不同的工具要的文件其实都不一样"）**实测成立**。
      ⇒ ★★★ **更硬的一条**：`harvest_decisions` 的 `read_files` **连"仓库相对路径"这个口径都不保证**
        （源码注释自陈"路径基准是 `process.cwd()`，**不保证等于仓库相对路径**"），
        而 `b_terms.ts` 的 `read_files` 定义**明文写着"（仓库相对路径，`/` 分隔）"**
        ⇒ ★ **产出方违反词表定义**（判据分叉的又一实例）。
      ⇒ ★★★ **要采纳的判据（用户提的）**：**中间数据的价值 = 它的加工语义** ——
        一旦退化成**通用袋子**，它**就不比 AST 更有信息** ⇒ **那时确实不如直接用 AST**。
        ⇒ 所以：**字段名带"加工语义"**（★ 不是带工具名 —— 那会让名字爆炸），
        **"谁产的 / 谁用的"由 `chain_wiring` 承载**。★ 判据：**同名 ⟺ 同义**（`read_files` 现在违反）。
      ⇒ ★★★★★ **本条的处置已被用户 2026-10-05 的判据推翻 —— 不拆名**（我原打算拆，改判）：
        > 用户原话：「**有可被再利用的价值时，才有被当做『出参』的意义。否则把它当变量、
        > 当剪贴板直接剪贴给下一个。**」+「**通用工具本身可以读所有的文件吧？不管它是事件集还是源码集**」
        > +「**为什么不直接从 AST 里读呢？**」

        **① 判据（采纳，用来分两类数据）**：
        **下游若不用它，是不是得从头重算一遍？**
        · **重算贵**（解析 / 遍历 / LLM） ⇒ **出参**，值得进 `Touched`、值得做接法表；
        · **下游自己轻松能得到** ⇒ **剪贴板**，**原样传下去即可**，不该占"链的接口"这一格。

        **② 按此判据逐个判 `Touched` 六键**：
        | 键 | 下游能自己得到吗 | 判定 |
        |---|---|---|
        | `read_files` | ★★ **能**（下游自己读/扫就行；且**读工具只吃路径，不关心是源码还是事件**） | ★ **剪贴板**（不该在 `Touched` 里） |
        | `nodes` | ★ **不能**（节点 id 是 DSL 内部产生的） | ★ **出参** ✓ |
        | `written_files` | ★ **不能**（"**本次调用**改了哪些"只有本工具知道 —— `dry_run`/回滚的下游看不到） | ★ **出参** ✓ |
        | `symbols` | ⚠️ 半能（`find_references` 查出的符号下游要重查） | ⚠️ **边界**，待定 |
        | `feature` / `project_dir` | ★ **不能**（**作用域只有调用方知道**） | ★ **第三类：作用域声明**（不是剪贴板也不是出参） |

        **③ 所以不拆名的理由（两条，都硬）**：
        · ★ **文件列表是通用数据** —— **消费者（读工具）不区分**它是源码/事件/文档 ⇒ **同名就够**；
        · ★★ **它现在是零代码消费者**（实测）⇒ **没有任何消费者要区分** ⇒
          拆名 = **为想象中的消费者服务** ⇒ 违反本仓"**不为想象中的未来写代码**"。
        ★ 而实测出的"3 类语义"**不是拆名的理由** —— 它**证明了 `read_files` 不该当出参**（见 ④）。

        **④ 真正该做的**（★ 原第 1 步「把 `read_files` 从 `Touched` 撤出」**已落**，见 2026-10-05 回执）：
        1. ★★★ **补"剪贴板 / 变量"这一格** —— 即用户说的「**grep 出的值自动变成变量、直接填进下游**」。
           ★ **那一格今天不存在**（`chain_wiring` 的 `cardinality:'pick'` 只"说了要挑"，
           但**"挑出来的那个值"没有任何实体承载**）⇒ **它才是让"统一"真正生效的东西**。
        ★ 原第 3 步（`harvest_decisions` 的 `read_files` 路径基准不是仓库相对）**随撤出而消失** ——
          该出口已不存在（详见 `docs/tool-chain-contract.md` §8）。

        **⑤ 智能 grep（用户说"灵光一现，不一定实现，你自己判断"）—— 判断：不单独做。**
        ★ 理由：它的语义就是"**把文件名从出参降级为剪贴板**"，**那是"剪贴板"这一格的应用，不是独立机制**。
        ⇒ **做 ④-1 的那一格，智能 grep 自然就有了；单独做一个 grep 工具 = 再造一个通用数据源**（与 AST 同病）。

- [ ] **T54 ★★★ 补「管道」—— 让「接力键」在**入参端**也能被接住（缺口已量化，2026-10-05 实测）**
      *(核实：2026-10-05 用户提出「哪怕只有一两个积木，框架也应该能把这两个拼在一起跑起来」⇒ 用它自己的判据量了一次。)*
      ★★ **2026-10-05 本轮已落**（回执见 commit 历史）：① 「接力键」已进受控词表（`file`/`symbol`/`node_id` ⇒ `anchor`）；
        ② `Touched.definition_file` **改名 `file`**（1 产者 0 消费者）⇒ `touched.file` → `renames[].file`
        **逐字同名、零字段名翻译**，该边**已真跑并升级 `verified`**（夹具 `$TEMP/agentio_chain_probe`：
        定义 + import + 用法全部改对）；③ ★ **撤掉一条假反例** —— 原写"`get_dsl(files)` 吐 `path`、下游收 `file`
        ⇒ 同义异名"，**错**：`path` 是**事实字段**（被 `schema/design_dsl.schema.json` 的 `required` 钉死）、
        `file` 是**定位器**（注释明文"绝对路径；或相对 project_dir/cwd"）⇒ **两类东西**，硬对齐 = 判据分叉的**反方向**。
      ★★ **剩下**：按"能跑通几条真实链"这个判据继续（`rename_symbols → edit_code`、`edit_code → run_tests`…），
        跑通一条记一条。★ 另记一条**能力缺口**（非命名问题）：`get_dsl(query='files')` 的投影**只给计数不给符号名**
        （`apiCount` / `symbolCount`）⇒ 下游 `find_references.symbol` **无从填**；要接得先补"符号名的结构化出口"。
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
      ⇒ **方向（不发明新机制）**：`Touched` 已是**产物端**契约（T18 六字段）。缺口是它**没对称到入参端**。
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

        ★★ **两个真缺口**（这才是"管道"的最小可修形态）：
        1. ★ **同一个东西两个名字**：上游吐 `path`，下游要 `file` ⇒
           **判据分叉的经典形态**（本仓头号病根）⇒ 每次接线都要调用方翻译，**而翻译会错**。
        2. ★ **符号名没有结构化出口**：上游只给 `symbolCount: 1`（**计数**），
           要拿名字得另找路 ⇒ 下游 `find_references.symbol` **无从填起**（只能由人/LLM 从散文里抠）。

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
      · **受控术语表** = `src/domain/b_terms.ts`（`B_TERMS` + `Touched`），文档 `docs/glossary.md`（生成）。
        ★ 机检（`node scripts/measure_b_contract.mjs`）：**共用字段名 42 / 有定义 40 / 未定义 2**；**债务 38 条**。
        （数字 2026-10-05 更新：原记 `58/0/39` 是删族**之前**的读数；[B] 数因删族而减少 ⇒ **这类数字别手抄**。
        ★ 那 2 个未定义的是 `error` / `touched` —— 见 **T45**。）
      · **规范 vs 现状分开**：含义栏是"从此以后要求它是什么"；现状见 `docs/b-field-dictionary.md`。
      · 规则：**出现在 ≥2 个 [B] 的字段名必须有定义**；私有字段（占 80%）不约束。
      **要做的**：
      · ~~(1) 先定 ④-b 的"统一构造点"做法~~ ✅ **④-b 已完成**（`withTouched` 统一构造点；见台账 §44.18）：
        `rename_file` / `rename_files` / `rename_symbol` / `rename_symbols` / `find_references` 五个 [B] 已接上 `Touched`。
        ★ 当年那支出生证测试（`tests/tools/touched_contract.test.ts`）**已随测试框架整体移除**（2026-10-05）
        ⇒ 现在验证靠**真调工具**（`node dist/.../cli.js <tool> --json '{...}'`）。
      · ✅ **(2) ④-c design 族已做（2026-10-05，commit `f4e21c6`）**：7 个 [B] 接上（`deriveAlgorithm` / `deriveSplit`
        / `updateFeature` / `detectDrift` / `setDesignIntent` / `scaffold` / `classifyBricks`）。
        ★★ **本笔最重要的不是那 7 个 [B]，而是抓到并修掉了一个洞**——
        `Touched` 挂在 [B] 产物**顶层**，而 **`wrap` 只回 message、`wrapData` 只序列化 `r.data`**
        ⇒ **产物顶层的 `touched` 会在 [C] 层静默丢掉**（实测 `detect_drift` / `edit_dsl` 用裸 `wrap` ⇒ 压根没输出）。
        已在 `plumbing.ts` 用 `machinePayload()` **两个包装器共用**收口；并补了 `dispatch.ts` 的
        **daemon 路径**（它重建 `{message, feature}` ⇒ 会造出"有没有 daemon 决定 touched 在不在"的分叉）。
        ⇒ **纪律（新）**：**[B] 接了契约 ≠ 交付；还要看 [C] 是否把它透出去。**
        ⇒ **棘轮口径建议收窄**：「新增 [B] 必须给 `touched`」应改为
        「**除非它不产生"本次动了什么"（纯计算/纯数据）—— 那种要在 `B_TERMS` 里显式登记为例外**」，
        否则会逼人造假字段（实例：`wizardSteps` 静态表 / `dagLayout` 纯计算）。
        ⇒ 并记：**`manageFeature` 是 [C] 级分派器，不是 [B]**（入参 `{action,args}` + 产物 `{message,data:unknown}`
        都是 [C] 形态）⇒ **不接 `touched`**。
      · ✅ **(2) ④-d harvest 族已做（`61850ce`）**：`extractContracts` / `harvestClosure` / `harvestDecisions`。
        ★ `extractContracts` 的 `written_to_dsl` 是"**写了 DSL**"、**不等于写过文件** ⇒ 不给 `written_files`。
      · ✅ **(2) 续：④-e 其余三条线（15 个 [B]）已完成（`03bb32e`）** —— **T18 铺满**。
        ★ 只读量具独立复核：**已接 29 / 待接 8，待接的正是判定表里那 8 个"不该给"**。
        ★★ 本笔又抓到「[C] 层丢小票」的**第 2 处**：`diffViewsHandler` 原先 `{message: r.message, data: r.data}`
        **显式重建** ⇒ 丢掉顶层 `touched`（实测 `diff_views` 的 DATA 里确实没有）⇒ 已转发。
        ⇒ 并量清全貌：`handlers.ts` 里**只有 2 个**这种形态（另一个 `observeTraceHandler` 属"不该给"）。

★★★ **④-e 的判定表（2026-10-05；★ 经两次独立复核修正）**

**不该给 `touched` 的 7 个**（三类）：
- **① [C] 级分派器（3）**：`manageFeature` · `exploreCode` · `queryFeature`
  ⇒ ★★ **判据（比"有没有 switch"锋利）**：**入参 `{action/query + 袋子}`** **并且** **产物 `data: unknown`**。
  （`editCode` 也用 `op` **if 链**分派，但产物是 **`{message; data: EditReceipt}`（有类型）** ⇒ **不是这一类**。）
  ⇒ 正确做法：`touched` 由**被分派到的真 [B]** 携带，分派器**转发**即可，不自己拼。
- **② 纯数据 / 纯计算（2）**：`wizardSteps`（无入参静态表）· `collectFunctions`。
- **③ 根只能靠 `cwd` 兜底（2）**：`observeTrace` · `runTests` —— ★ 本仓**禁 cwd 兜底**（cwd 是"另一个项目"）
  ⇒ 根**算给不出**；且二者无仓库相对的对象。

**该给（30）**。★ **棘轮口径的完整例外**：
「新增 [B] 必须给 `touched`，**除非**它是 **(a) 纯数据/纯计算** 或 **(b) [C] 级分派器** —— 两种都要在 `B_TERMS` 里显式登记」。

★★ **`classifyTools` 曾被误判进"纯数据"（2026-10-05，commit `b8371ad` 修正）**：
`classifyTools(tools, **r: BrickifyResult**, opts)` —— ★ **它和 `classifyBricks` 拿的是同一个 `BrickifyResult`**，
有**一模一样的现成根锚点**（`r.meta.project_dir`）⇒ 一个判"该给"一个判"不该给"**自相矛盾**。
★ **我的病根**：只看量具报的"3 个位置参数 `[tools, r, opts]`"，**没去看 `r` 是什么类型**。
⇒ **教训：位置参数更要把类型看清**（具名参数至少名字带提示）。
★ 且它**只有一个调用方**（`brickify_cli.ts:185`），那条 CLI **不打印 `touched`** ⇒ 是**给未来接链用的**，今天观察不到。

★ **另一条更值钱的（同类，本笔才修）**：`watchProjectTool.declare` **真写** `<projectRoot>/.agent-io/impact/ledger.json`
（**确实在仓库内**），却不给 `written_files`，理由**只写在代码注释里** ⇒
**「判据正在被使用，却没写进契约 ⇒ 下一个人会分叉。」** ⇒ **已把"排除 `.agent-io/**`"明文写进 `b_terms` 的 `written_files` 词条。**

★★ **一条全局口径（对账时由另一模型提出、我核实后采纳）**：
**`saveDSL` 落 `<dataHome>/.agent-io/**`（不在仓库里）**，而 `written_files` 口径写死「**仓库相对路径**」
⇒ **凡"只写 DSL/存档/导图 JSON"的 [B]，`written_files` 一律给不出**（塞绝对路径 = **换口径**）。
★ 例外要**按事实判**：`watchProjectTool.declare` 写的 `ledger.json` **确实在项目根下** ⇒ 那条理由**对它不成立**；
  它的 `written_files` 仍判**不给**，理由换成：**那是工具自有的内部数据**（非"本次操作对被操作对象的工作产物"）
  + `rp-*.json` 由**常驻 watcher 异步产生、不在本次调用窗口内** ⇒ **归属不了本次调用**。

★ ★★ **"跨模型对账"抓到了我两处误判**（详见 `.inspect` 与项目记忆）：
`dagLayout` 我当"纯计算"、**实际它 `saveDSL` 回写 DSL**；`editCode` 我当"分派器"、**实际产物有类型**。
      · ✅ **(3) 还债：7/7 全部完成**（commit `c55f607` + `ed4a5b4` + `98618be`）——
        `files`(报告数组) ⇒ `contract_reports` / `reconcile_reports` / `removal_reports`；
        `stats` ⇒ `contract_stats` / `closure_stats` / `reconcile_stats` / `algorithm_stats`；
        `written`(文件表那一义) ⇒ `written_files`；`scaffold.files`(`string[]` **路径表**) ⇒ `written_files`。
        ★ 判据是**类型 + 语义**：**3 处 `files` 是报告数组**（⇒ `<领域>_reports`）而 **`scaffold.files` 是路径表**
        （⇒ `written_files`）—— ★★ **同名不同义，不能套同一个目标名**（我一度怀疑执行者判错，查类型后是我错）。
        ⇒ **只读量具独立复核：全仓 37 个 [B] 零个带旧名** ⇒ 已摘掉 `b_terms.ts` 那三条 `debt: true`
        （**改标"已退役，禁止再新增使用者"** —— 不是删条目，删了后来人就没拦的）。
        ⇒ ★ 顺手补了两个**一直是洞**的词条：`touched`（**14 个 [B] 在用却不在表里**！）与 `error`
        （`runTests` / `watchProjectTool` 同名同型）。机检归零：**42 / 42 / ★未定义 0**。
      · ★★ **(4) 的尾巴（2026-10-05，commit `4ee95dd`）**：`213d316` 给产物加的 `root` 字段**被机检当场抓出**
        —— 受控词表里这个概念的**唯一名字是 `project_dir`** ⇒ **我自己造了一个判据分叉**
        ⇒ 已全部改名为 `project_dir`（4 文件）。
        ★ **这条值得记住**：受控词表**不是文档、是机器判据** —— 我引入分叉 20 分钟后它就把我抓了。
      · (4) ★ **④-b 暴露的同源缺口**（都在"**Core 内部算出的东西没进产物**"这一点上）：
        · `rename_symbols` 的 local 支 / apply_literals 支 ⇒ 给不出仓库相对的完整文件表 ⇒ 只能整项省略；
        · `rename_symbol` / `find_references` ⇒ 入参没给 `project_dir` 时，Core 推导出的根拿不到 ⇒ 只能省略。
        ⇒ 处置：让产物**回传 root / 字面量文件表**（属"产物形态"的改动，单列一笔）。
        ★★ **2026-10-05 已定位到具体落点**（下一步是机械的）：
        - 结果类型：`RenameSymbolResult`（`rename_symbol/parts.ts:105`）· `FindReferencesResult`（`rf-find/find_references.ts:151`）
          · `RenameSymbolsResult`（`rf-rename/rename_symbols.ts:97`）—— 三者**都没有** root 字段。
        - 根**在手里但没回传**：`rename_symbol/core.ts:112-114`（注释自陈"内部会自动定位 root，但那条路径不出现在产物里"）
          · `rename_symbols.ts:164-166`（module 支/local 支各有一个局部 `rootDir`）
          · `find_references.ts:289` 的 `resolvedRoot`（= `symRoot ?? resolveProjectRoot(fileAbs)`）。
        ⇒ **做法**：给三个结果类型各加一个 root 字段并在**原处赋值**，然后 `touchedOf` 改成**优先取产物里的 root**、
          入参给了则仍以入参为准（入参是"调用方声明的根"，产物是"实际定位到的根"—— 两者不一致时**以入参为先**，
          但产物里的要保留，供下游反查）。
        ⇒ 判据：`project_dir` 在"入参没给"时**也能给出**（改前一律省略）；`written_files` 在 local 支也能给出。
        ★★ **✅ 已做（2026-10-05，commit `213d316`）**：三个结果类型各加 `root` 并**在原处赋值**；
          `touchedOf` 改「入参优先 → 否则产物 `r.root`」；`written_files` 在 module（含 apply_literals）与 local 支
          都能给（**实测** local 支真落盘 → `written_files:["src/local.ts"]`）。
          **顺带收口一处既有的判据分叉**：三处对入参的处理原本不一致 —— `rename_symbol`/`find_references`
          一直 `path.resolve`，而 `rename_symbols` **原样透传**（实测传 `"."` 时前者给绝对、后者给 `"."`）⇒
          已统一为**绝对根**（契约明文要求）。
          **仍给不出**的出口 = "在解析根**之前**就 return"的那几个（新名非法/空列表/type 模式…），未上移根解析。
          ★ 另记：**无标记文件的项目里根解析会降级到"文件所在目录"**（`resolveProjectRoot` 既有行为，非本笔引入）。
      **牵连**（每族一笔）：G8 行为快照 `UPDATE_TOOL_BEHAVIOR=1` 并记账；G1 仅当描述/入参 schema 变了才动。
      ★ ④-b 实测：**G8 人群不含这些"重活"工具** ⇒ 加 `touched` 不会动 G8 快照（行为验证改由新测试承担）。
      ★ **已知一条 warn 会随本项消失**：`arch` 报 `no-orphans: src/domain/b_terms.ts`
      （契约尚未被 app 采用 ⇒ **故意不藏**；第一个 [B] 用上 `Touched` 后自动消失）。

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
      3. **`instrument_cli`** —— 先给 `observe_instrument` 补 `action=ledger`（现枚举只有 `instrument|uninstrument|restore`）
      4. **`translate_cli`** —— 先给 `translate_go_ts` 补 `holes` / 单文件 `out` / `batchSize`（zod schema 未暴露）
      5. **`deprecate_offline_cli`** —— ★ **层问题**：核心 `runDeprecateOffline` 住在 **`presentation/cli/`** 里
         ⇒ 注册前得先把它搬到 application/infrastructure（属"修形状"，不是包一层）
      6. `upgrade_cli` / `upgrade_rewrite_cli`（后者会编辑 + 验证 + 提交）、以及
         `signal_review_cli` / `split_stage_cli` 这两个 **CLI 的去留**（能力已归零，CLI 是否留作 argv 便利）
      7. **`install_package_cli` ⇒ 判为一次性运维脚本**（`spawn npm install/uninstall` 改环境 + 联网；
         且 MCP 面 `lang_hint.ts:117,147,149` **主动指引用户去跑它**）⇒ **保留、不注册**
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
    （正例可对照 T18 的 `files`：同名却三种语义）。
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

- [ ] **T50 ★ `docs/adding-a-language.md` 的路径大面积过期（≈47 处指向已不存在的路径）**
      *(核实：2026-10-05 —— 逐模式 `grep -c`：`src/tools/` ×15 · `tests/tools/` ×15 ·
       `tools/contract_gate` ×6 · `src/impact/` ×3 · `tools/package_migration` ×3 ·
       `src/behavior/` ×2 · `src/version_upgrade` ×2 · `src/health/` ×1。)*
      ⇒ `src/tools/` 与 `tests/` **这两个目录都已不存在**（前者随目录重排消失、后者随测试框架整体移除）
        ⇒ 这份**活指南**（"怎么加一门语言"）里近半的"去哪儿改"是错的，**而没有人会 grep 散文**。
      ⇒ ★ 与 **T31**（"凡把路径/名字写成表的地方，搬迁一次就静默失效一次"）**同族但载体不同**：
        T31 那 5 例是**代码/配置里的名字表**（机器读、能被门扫到），本条是**散文里的路径**（人读）
        ⇒ **grep 不到、门也管不到**。⇒ 本仓还**缺一条**"搬迁时过一遍活文档"的纪律。
      ⇒ 方向：逐节重写 §2 的"分派位置"列（指向真正的 `infrastructure/analysis/**` / `application/**`）。
        ★ 判据可脚本化（属"扫描类"）：文档里每个 `路径:符号` 都要能 `fs.existsSync` 命中。
      ⇒ ★ 本轮**只改了 T28 所辖的那几处**（`rename_symbol` 的注册表路径 —— 那是**我自己的 T42-D 改搬坏的**）
        与语言包文件名；**整篇刷新是另一笔**。

- [ ] **T51 ★★ 「一个文件 = 一门语言」这条目录规则**没有机器判据**（2026-10-05，T28 续时立）**
      *(核实：改前 `rename_symbol/languages/` 的实际形状 —— `cs.ts` 导出工厂给 `java.ts` 用、
       `java.ts` 导出引擎给 `.cs` 的注册项用；两者**互相 import**，`py.ts`/`c.ts` 又
       `import type … from './go.js'`。已全修，规则写进 `registry.ts` 头注 + `docs/adding-a-language.md` §2.2。)*
      ⇒ **为什么值得单列**：★ **现有两把尺都看不见这种形状** ——
        · `code_health` 的 `循环依赖` **不抓**（`java.ts → cs.ts` 是**单向**，不成环）；
        · `code_health` 的 `分层违规` **不抓**（两个文件同在 `infrastructure/`）。
        · dep-cruiser 已在 `7bcc364` **整体移除** ⇒ 没有"8 行框架规则"这条路可走。
      ⇒ 而它**很容易再长回来**：下一个给 `rename_symbol` 加语言的人（或 LLM），
        看到 Java/C# 的算法像，顺手就会让一个文件同时服务两门语言。
      ⇒ ★ **2026-10-05 补记（包对象归位后收窄了一半）**：三张表现在都是「**语言文件自带包对象（含 `exts`）**」
        ⇒ ★★ **"让 A 文件的函数去服务 B 的扩展名"已在结构上不可能**（要改 `exts` 必须进那个语言的文件）
        —— 原条目举的那个最坏后果已经堵住。
        **仍然没有判据的是另一半**：「**语言文件之间互相 import**」（含 `import type`）。
      ⇒ 方向（**按 T25 的判据：扫描类 ⇒ 换成工具，不建门/登记表**）：
        给 `code_health` 加一个维度，判据 = **`application/**` 与 `infrastructure/**` 下
        "同名目录里，文件 A 是否 import 了同目录的另一个语言文件"**（可泛化为更普适的一条：
        **同目录兄弟文件之间的横向 import**）。★ 泛化版更值钱 —— 本仓别处可能也有。

- [ ] **T52 ★ `rename_symbol` 里两个"模块级符号分析"形状近乎重复（T28 续时顺带发现，未判断）**
      *(核实：逐字段对比两处定义 —— `parts.ts: GoModuleAnalysis` vs
       `infrastructure/parse/module_analysis.ts:58 ModuleAnalysis`。)*

      | | `parts.ts: GoModuleAnalysis`（go/py/c/java/cs 用） | `parse/module_analysis.ts: ModuleAnalysis`（TS 家族用） |
      |---|---|---|
      | `rootOffsets` | `Map<string, number>` | 同 |
      | `rootKinds` | `Map<string, string>` | 同 |
      | `imports` | `Array<{alias, path}>` | `ImportEdge[]`（**不同形状**） |
      | 引用 | `refs: Map<string, number[]>` + `selections` | `rootRefs: ModuleRef[]` + `exportRefs` |

      ⇒ ★★ **"名字像"的地方这次是"形状像"**：前两个字段逐字相同、后两个不同
        ⇒ 与 T18 的 `files`（同名不同义）**是同一族的第二个方向**。
      ⇒ **未判断**：该不该合并？（合并要把两种 refs 表示统一 ⇒ **是行为变更**，不是重命名）
        · 反对：两者服务不同家族，且 TS 家族需要 `exportRefs`（re-export）而本形状需要 `selections`（`X.sym`）；
        · 赞成：`rootOffsets/rootKinds` 逐字相同 ⇒ 至少要判断"是不是同一份地基被抄了两遍"。
      ⇒ **待定，不预设结论，也不动。** 已在 `parts.ts` 的 `GoModuleAnalysis` 上方记明这层关系。

- [ ] **T33 ★★ `analyzeModuleSource` 的 `imports` 漏默认导入 —— 与 `parseFileFull` 差 190/323 文件（2026-10-04 实测）**
      *(核实：一次搬迁侦察时用**全仓 323 个文件逐文件对差集**测出，**非读码断言**。
      与 T26 同一轮侦察，但**是两条不同的事**。)*
      ⇒ **190 个文件**的 `imports` 两边不一致，**差异全部是 `analyzeModuleSource` 漏掉「默认导入」**
        （`import fs from 'node:fs'` 这种形态）。
      ⇒ ★★★ **2026-10-05 隔离实测更正（三处，全部推翻/收窄了我原来的说法）**：
        · **source 级不一致 187 → 2**（317 个候选文件；补上默认导入后只剩 2 个 `side-effect` 文件：
          `infrastructure/parse/lang_hint.ts` · `presentation/cli/capability_cli.ts` 各缺一条
          `register_capabilities.js` 副作用边）。
        · ★★ **原写"`project_root` 的闭包计算正是使用者之一" —— 实测不成立**：
          闭包 **0 变化**（10 个种子 × 有索引口径 = 304 文件、4 个种子 × 无索引口径 = 317 文件，**新增 0/减少 0**）。
          **机制**：快路径读 `cache.db` 的 `imports` 表，而**该表由 `parseFileFull` 写**
          ⇒ 本来就带默认导入边；回退全扫的 `included` 恒等于全项目文件集。
          ⇒ **"补默认导入 ⇒ 闭包更全"是错的**。
        · ★★ **真实影响面是 `binding` 级**：**186/317 文件的 `rootOffsets`** 缺导入本地名 ——
          `default` 缺 **348** 个、`namespace` 别名缺 **2** 个（named 缺 0）。
          ⇒ ★ **真正的爆炸半径 = `analyzeModuleSource` 的「直接消费者」**
          （`rename_symbol` / `find_references` / `symbol_move` / `health` 这些**读 `rootOffsets` 的地方**），
          **不是闭包**。⇒ **正在量**（见下）。
        · ★ 另立一条：**`namespace_import` 的 `alias` 字段在本仓 tree-sitter 取空**
          （`childForFieldName('alias')` 拿不到）—— 独立缺陷，见新条目。
        ⇒ ★★★ **"真正的爆炸半径"已量（2026-10-05，我亲自量的）—— 结论是「影响很小」**：
          `analyzeModuleSource` 的**真实调用点只有 4 处**（其余是注释与再导出）：
          `find_references.ts:301,451` · `symbol_move.ts:272,299,356` ·
          `project_root/index.ts:760,983,1221` · `rename_symbol/languages/ts.ts:49,94`。
          而**读 `rootOffsets` 的只有 2 处**，且两处都是「**按名字取一个偏移**」：
          `find_references.ts:318`（`def.rootOffsets.get(symbol!) ?? 0`）·
          `ts.ts:57`（`def.rootOffsets.get(symbol)!`）。
          ⇒ ★★ `symbol` 是**用户指定、要改名的那个符号名**，**它绝不会是"从别处 import 进来的本地名"** ——
          `rename_symbol` 那条路**已有拒绝逻辑**挡着（真调原文：
          「`"foo"` 在 b.ts 中是 **import 绑定而非声明**，请在它的定义文件上发起改名」）。
          ⇒ **缺的那些默认导入本地名（`fs`/`path`/…）走不到这两处**。
        ⇒ **定性（诚实）：binding 级缺口是本仓当前的「理论缺陷」，未观测到任何错误结论。**
          ★ 因此**优先级低于** `side-effect` 那两条（那两条是**真的少一条依赖边**）。
          ★ 若将来有消费者按「这个文件里有没有 `fs` 这个名字」做判断，它就会浮上来 —— **那时再修**，
          别现在为一个没有观测影响的缺口改一个共享解析器的行为（那是**过度改动**）。
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

- [ ] **T40 ★★ 三处「隐藏前置」没写进任何工具描述（独立体检 2026-10-05，用户要求"从头逐个测"）**
      *(核实：体检小队用 `AGENT_IO_HOME` 隔离 + 临时项目 `C:/tmp/...` **逐个真调** 59 工具后报告；
       我复核了第 3 条（`server_registry.ts:301` 逐字）。)*
      ⇒ **1. DSL 数据锚定「包安装根」，不是你的项目目录。** 不设 `AGENT_IO_HOME` 时任何 cwd 都在
        读写**同一个**数据目录 ⇒ 多项目互相看见。**最容易被误伤，却不在任何工具描述里。**
      ⇒ **2. 符号索引会被"顺手"自动建。** 第一次 `find_references` 就在被分析项目里生 `.agent-io/cache.db`
        （没先让你 `import_project`）。
        ★ **2026-10-06 更正**：原写"而 `feature_line` 却要求先跑一次带 feature 的 import_project
        ⇒ **三处口径不一样**" —— 核实后**该前提不成立**：`feature_line` 的 `project_dir` 是**可选**，
        描述为"缺省按 feature 的导入缓存"，**未见**"先 import_project"字样；同线的
        `recommend_observe_points` 反而**明写"无需先 import_project"**。
        ⇒ **保留下来的事实只有一条**：索引会被"顺手"自动建（这件事本身仍该写进工具描述）。
      ⇒ **3. 「每次调用前保鲜」只认 4 个参数名**（`project_dir / project_root / root / dir`，
        `server_registry.ts:301` 的 `projectRootArg`）⇒ 用 `project_dir_a`（cross/hybrid）、
        `target`（observe_instrument）、`source_root`（render_brickwork）、`file`（find_references）
        的工具**拿不到自动保鲜**，结果可能悄悄是旧的。
      ⇒ 方向：① 把 `AGENT_IO_HOME` 的语义写进 `capability_map`（新用户第一站）；
      ② 三条索引前置口径收成一句一致的话；③ `projectRootArg` 的判定面与各工具真参数名对齐
      （要么扩它、要么让工具参数名统一）。


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
      才是空格子**（而 ⑥ 就是本仓的 **T18**）。
      ⇒ ★ **三个实验（都不必自造框架）**：
        **实验 0（半天，最便宜）** 用 WASM CM 官方教程走通 Rust 组件 + Python 宿主 ⇒ **若卡住则 ① 层死心**；
        **实验 1（现在就能做，用保留下来的 `harvest_closure` + `extract_contracts`）** 对真项目抽 1 个候选积木，
        **量化"人工改判率"**（> 50% ⇒ "从任意项目抽零件"是假命题）；
        **实验 2** 只挑一对一语言（TS↔Python），用 napi-rs / PyO3 做"同一份契约 → 两端绑定"，**判据=不写一行 glue**。
      ⇒ ★ **未核实项**（文档 §10 已列）：WASM CM 的真实成熟度（未查各语言支持矩阵）· uniffi/napi 的许可证
        （若 adopt，按 `oss-prior-art-first` §3.5 必须先看许可）· "⑤ 无通用解"是判断而非查到的结论（**实验 1 可证伪它**）。

- [ ] **T47 ★ 「自定位工具」的 `touched.project_dir` 可能是 cwd（口径待定，2026-10-05）**
      *(核实：`index_integrity --json '{}'` 实测 `"touched":{"project_dir":"D:\\project_develop\\design-canvas"}`
       —— 那是**本仓 cwd**，不是调用方想查的项目。)*
      ⇒ 根因：`index_integrity.ts:168` 的 Core 是 `path.resolve(opts.project_dir)` —— **`undefined` 时 `path.resolve` 会落到 cwd**。
      ⇒ ★ **定性（重要）**：这是它**既有的"自定位"行为**（工具描述里写了"会自定位项目"），**不是本笔引入**。
        但 `touched` 的口径是「**作用域类字段，填解析后的绝对根**」——当那个根是 cwd 时，
        下游拿到 `touched.project_dir` 会以为"这是调用方声明的项目"。
      ⇒ 待定两选一：(a) 让自定位工具**显式标注"根来源"**（自定位 vs 委派）；(b) 给 `Touched` **加一个字段**表达它。
        ★ 按纪律「**跨模块统一形态时不要动既有字段名；要统一就新增语义唯一、类型钉死的东西**」⇒ 倾向 (b)。
      ⇒ 波及面待量：全仓还有哪些 [B] 的根是"可自定位"的（`index_integrity` · `run_tests` · `observe_trace` 已知 3 处）。

- [ ] **T46 ★ `dead_statements.ts` 里还有第 7 种 `files`（还债的尾巴，2026-10-05 由执行者上报）**
      *(核实：`grep -n "files" src/infrastructure/analysis/deadcode/dead_statements.ts` —— 实测 **3 处**。)*
      ⇒ 同一文件里：`files?: string[]`（:199，**路径表**语义待定）· `files: DeadStatementsChange[]`（:258，**报告数组**）
        · `files: DeadStatementReport[]`（:273，**报告数组**）。
      ⇒ 处置：两个报告数组 ⇒ `<领域>_reports`；那个 `string[]` **先查是"读过"还是"写过"的路径**再定
        `read_files` / `written_files`（★ 判据是类型 + 语义，不是名字）。
      ★ 它不在 `application/**` ⇒ **按 `dc-add-tool` 的 [B] 定义它不是 [B]**（是 infrastructure 里的产物类型），
        所以本轮 5 个 [B] 的清单里没有它 —— 但它同样是"被污染的名字"，属同一族债。

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

- [ ] **T59 ⚠ `rename_files` 批量的成本模型没写进描述（已量出，未修）**
      *(2026-10-05 实测 4/8/16/29 四档，隔离 AGENT_IO_HOME + 真跑，每档都 `git status` 复核树状态)*
      ⇒ ★ **成本 ∝ 被改写的引用数，不是条目数**：0 处引用的「搬回」只要 **0.7s**；42 处引用的「搬去」要 **52–178s**。
      ⇒ ★ **有一次性大额固定成本**（首次建索引/保鲜）：4 条 52.1s > 8 条 24.6s —— **非单调**，所以不能用「条目数 × 单条耗时」估算，也不该据此定分片大小。
      ⇒ 描述现在只说「串行 + 如实报告已应用条数」，**没说规模上限、也没说成本取决于引用数** ⇒ 调用方（尤其是 agent）无法预判该不该分片。至少该在描述里写清这两条。

- [ ] **T60 ⚠ 一次不可复现的「apply 无输出」故障 —— 归因已撤回，等复现**
      *(2026-10-05 首次搬 29 个文件时：apply 跑了 545s、输出为空、我的 runner 报 `[ERR] len=0`，而当时 `tsc --noEmit` 是 EXIT=0 ⇒ 树自洽、**看不出停了**，只能靠数盘上文件才发现少了 6 个。因为 runner 没打印 `signal`，我一度归因成「`rename_files` 静默半途」并写进了 commit 与清单。)*
      ⇒ ★ **同一条目 29 个文件重跑：178s / exit 0 / len=41727 —— 故障不复现**（同机器、同隔离 home）⇒「工具会静默半途」这个结论**证据不足，已撤回**。
      ⇒ ★ 真正的教训有两条，都已落地：
        ① **我的 runner 报 `[ERR]` 却不打印 `signal`/`error`** —— `status===null` 是**被信号杀**（Windows 上常见 OOM/强杀），不是「工具回执为空」。不修这个 Instrumentation，就会把「我的测试环境被杀」误判成「产品有 bug」—— ★ 这正是本仓头号病根「判据分叉」在**测试层**的形态。
        ② 同一次实验里，我的**回搬清单**用 `existsSync(原路径)` 过滤，而被搬走的文件在原路径本就不存在 ⇒ 恰恰把它们排除掉了 ⇒ 4 个文件永久留在 `_scale/`（`tsc` 仍 EXIT=0，也是靠 `git status` 才看出来）。
        ⇒ 教训：**「树能编译」不等于「树是对的」**；搬移类实验的收尾必须 `git status` 逐条对，不能只看 tsc。


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







