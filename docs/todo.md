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
> 7. ★★★ **人机共创的落点只有「设计侧」**（2026-10-09 用户裁定）：
>    *"而且人机共创环节，**共创的也只能是设计图**。不能共创实际，因为实际还得**施工人员**去。"*
>    ⇒ · **设计侧**（设计 DSL / `overlay`）= **意图** ⇒ 人机**共写**，走**共识闸**（`design_intent action=propose` → 人 approve）；
>      · **实际侧**（`live` / 用户源码）= **施工产物** ⇒ **只读、只对拍**；写入必须走**单一可检查通道**（= T49）。
>    ★ 已落一半：`edit_dsl` 拒 `view=live`（`handlers.ts:289`"**实际视图是代码快照，只读，请勿手改**"）。
>    ★ 推论：**别把"共创"性质的产物挂到实际侧**（例：功能标记住 `overlay` ⇒ T100 的落点判据）。

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
        · ★★★★ **2026-10-09 口径再修正：两源 + 权威派生**（`docs/todo.md` 本节的最新读数）：
          **真读数（人群 38；`touched` 两源 = `touchedOf` 函数体 ∪ **手搓 `touched`** 的文件）**：
          `feature 22/37(手搓3) · project_dir 23/37(手搓1) · written_files 8/37 · scope_files 3/37(手搓3) ·`
          `symbols 4/37 · nodes 4/37 · file 2/37`（37 = 有 `touched` 的文件数；**接力键节仍是 [B] 级 ⇒ 见 T95**）。
          ★ **又两处假读数被修掉**：
            ① ★ `scope_files`（`Touched` 的**第 7 个键**）**原先根本不在量具的 `KEYS` 里** ⇒ 零覆盖，
               而"接力键"节还把它印成假 `0 · 0`。根因 = `KEYS` 是**手抄的 6 元数组**，2026-10-09 给 `Touched`
               加键时**没人补这份手抄** ⇒ **"同一判据住两处"的量具版**；已改为**直读 `Touched` 接口的 AST 派生**
               （**灭掉手抄根因**，以后加键自动跟上）。
            ② `symbols` / `nodes` 产物端报 **0** 也是假的（真值 **4 / 4**）。根因 = 旧判据**只扫 `touchedOf` 函数体**，
               而 `handlers.ts` / `index.ts` / `query_feature.ts` 是**手搓 `touched`、没有 `touchedOf`** ⇒ 已加第二源。
               ★ 加第二源时必须**全文件扫 + 花括号配对**：`handlers.ts` 有**两条** return 路径（`:115`/`:219`）
                 相隔 >3000 字符 ⇒ "取首个构造点后一段窗口"会**漏第二条**（同型"判据太窄 ⇒ 假 0"）。
          ★ 遗留：`scope_files` 三个产者**全是手搓**（`handlers.ts:115` / `:219`、`query_feature.ts:778`、`index.ts:568`）
            ⇒ 覆盖率按文件算得 3，接力键按 [B] 算得 1 —— **两节两把尺**（见 **T95**）。
          ★ 另有一条**已知局限**（不是修掉，是写明）：判据**认文本不认代码** —— 把产者那行**注释掉**，
            读数**纹丝不动**（必须真删掉文本才下降）⇒ 往**假阳性**方向错。见 **T96**。
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

      ⇒ ★★★ **2026-10-09 第二次进展（工具面收口 —— 这条最接近"用户要的东西"）**：
        **「下一棒」现在印具体值**。此前回执通道只印**表达式**（`touched.written_files[i] → edit_code.file`），
        调用方得**自己 stringify 一遍 `touched`**、再回忆字段名 —— 而本通道（`server_registry.ts`）
        手上**正好有**刚跑完那个工具的 `r.text`，`touched` 就在它的 `---DATA---` 里。
        ⇒ 现在把它喂进**同一个**渲染（`renderHandoffSection`，与 `capability_map` 的「接续」段**共用一份实现**）
        ⇒ 实测（`rename_symbols` 真跑）：
        ```
        ── 接续（你手上有 `rename_symbols` 的 touched ⇒ 下一步怎么调）──
          ★ 直接可用：2 条
            edit_code.file  ←  touched.written_files[i]  =  src/a.ts
                ★ 下游还要给：op
            edit_code.symbol  ←  touched.symbols[i]  =  Kk4
                ★ 下游还要给：file, op
          ★ 注意：同一对工具之间常有多条边 ⇒ 每条的"还要给"要合起来看
        ```
        ⇒ ★ **调用方零手工**（不必 stringify、不必回忆字段名）—— **"接到工具面"这一跳补上了**。
        ★ 取不到 `touched` 的工具 ⇒ **逐字退回**原表达式版（行为不变）；解析失败**一律退回**（提示非契约，不许连累主回执）。
        ★ 另补一段实测发现的读法：**同一对工具常有多条边**（`rename_symbols → edit_code` 有两条）
          ⇒ 每条的"还要给"**要合起来看**（单看 `symbol` 那条会说"还要给 file"，而 `file` 由另一条边给了）。

      ⇒ ★★★ **2026-10-09 进展：走了「另一条路」，且已验第一条真链 —— ★ 路线分歧需要拍板**

        **做了什么**（`domain/chain_wiring.ts` 新增两个函数；不改任何 `[B]` 的入参名）：
        · `applyChainEdge(touched, edge, {pick?})` —— **执行**接法表里那条边：取 `fromKey` ⇒ 落到 `toPath`。
          ★ 三条纪律：`pick` **必须显式给下标**（不给就报错并**列出候选**，绝不默认取第 0 ——）
          「选」是语义判断，是本文件开头的立论；字段缺/类型错/`single` 给了多元素 ⇒ 一律 `ok:false` + 人话原因，**不静默降级**。
        · `findChainEdges(from, to, opts)` —— 把「**通配边要不要算**」这个判断**收成一处**。
          ★ 起因是实测踩到：`project_dir` / `feature` 是通配边（`from`/`to` = `*`），
            调用方照 `edge.to === 'edit_code'` 去找**永远找不到**，然后报"接法表里没有这条边"——而那两条边**在**。
          ★ 而反面同样有坑：**逐段判定链通不通时通配边必须排除**（否则恒真，见 `verifiedEdgesBetween` 的教训）。
            两个方向相反的结论 ⇒ **更必须各住一个具名函数**，别让读者在调用点猜。

        **真跑验收（一条链，零手写字段名）**：
        `rename_symbols`（真落盘，得 `touched = {project_dir, symbols:["KkFinal"], written_files:["src/a.ts"]}`）
        → 丢给 `applyChainEdge` ×3 → 生成 `edit_code` 的入参 → **真跑 `edit_code`**（写盘成功、并回了自己的 `touched`）：
        ```
        project_dir  ←  touched.project_dir        （通配边）
        file         ←  touched.written_files[i]   = src/a.ts
        symbol       ←  touched.symbols[i]         = KkFinal
        ```
        ⇒ ★ **三个入参没有一个是我手写的** —— 按 T54 自己的规矩「**跑通一条记一条**」，这是**第一条**。

        ⇒ ⚠ **路线分歧（请你定）**：
          · **T54 的原判据 = 字段名逐字相同**（出口 `written_files` 要在入口里逐字找到）⇒ 要**改 N 个 `[B]` 的入参命名**；
            而它自己也写了「该收哪些字段要**逐个人判**（不是一刀切 100%）」。
          · **我做的 = 让"翻译"可执行** ⇒ **零破坏**，且 `CHAIN_EDGES` **本来就已经记了 `toPath`**（就是干这个的）
            —— 所以这条路是**把已写下的设计兑现**，不是另起一套。
          · ★ 我的判断：**后者更对**（改命名是"把两端拧成一样"，而"接法"本来就该是一条**可执行的边**）；
            但它**不满足原判据的字面**，所以**不自行结项**，写在这里等一句。
          ⇒ 若认可这条路 ⇒ 余下 = **再验 2 条真链** + 把 `applyChainEdge` 接到**工具面**（现在只有库里能调，`[B]` 还没用它）。
          ⇒ 若坚持原判据 ⇒ 那就是**另一件大工程**（逐个 `[B]` 改名 + 逐个人判该收哪些）。

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

---

- [ ] **T67 ★★★ 合并形态 S1：`MANIFEST.txt` —— 卷声明，把"三个层"从注释里请出来**
      *(核实：2026-10-08 实测「`overlay 独立保留` / `base 可再生成` 全仓**只在 `src/infrastructure/storage_overlay.ts` 一处**；
       `README` 的 `三个`=0 / `acceptance`=0；`design-canvas-router` 的 `overlay`=0；`design-canvas-mind` 的 `overlay`=0 / `base`=0
       ⇒ **三处引导全不写** ⇒ 用户与我都"不会想到它有三个"。)*
      ⇒ **形状**：一份 10~20 行纯文本，**只有声明、没有数据**（数据仍在原处 ⇒ **不新增真相源**）：
        `#Format-Version: agent-io/volumes-v1`（治"DSL 格式漂了没处看"）·
        `#Volume: id=live|base|overlay|archive|cognition  mode=… regen=… path=…` ·
        `#Quota: F<=200 R<=300 A<=300 S<=600`（治"只有下限没有上限"）·
        `#Admission:` **指向已有的 L1–L4**（`reason_validator.ts`）——★ **声明已有的，不新造一个**。
      ⇒ **判据**：① 生成物与磁盘实况一致（**列出不存在的卷 ⇒ 报错，不静默**）；
        ② 只读它**能答出"谁是真相、谁能改、谁会被重生成"**。
      ⇒ ★ **已定（2026-10-08）**：住 **仓根**（`<project>/MANIFEST.txt`），判据 = **变更频率低**
        （只在"卷布局变了"时变；实测 21 行 ~1.5KB）⇒ **进 Git 可 diff、可评审、走"读文件"这个原生通道**。
        `--in-data-dir` 保留给不想让仓根多文件的场合。
        ★★ **理由（用户追问"我们现在的设计达得到简化 LLM 读取的目的吗"）**：这是「**file 通道 vs tool 通道**」之别 ——
          tool 通道要求 **服务在跑 + 知道工具存在 + 20 个 query 里挑对**；实测 `query=digest` 早就实现且能用，
          `capability_map`/README/router **三处全不点名** ⇒ **连着四轮没人看见**。
      ⇒ ★ **本轮已落**：`scripts/gen_manifest.mjs` + `npm run manifest` / `manifest:check`，
        出生证两方向都验过（磁盘多卷 ⇒ 红；声明谎报 ⇒ 红；还原 ⇒ 绿）。**余下：`capability_map` 顶部点名它。**
      ⇒ 设计：`docs/convergent-product-form.md`。

- [x] **T68 —— 结项（2026-10-09 核实）：`COGNITION.txt` 已经落完了**（★ 我"先查清单"才没去做一件已完成的事）。
      · **落盘** `.agent-io/COGNITION.txt` ✓ · **重生成** `npm run cognition` ✓ · **判过期** `npm run cognition:check` ✓
      · ★ **派生指纹在**（T68 要的那个）：每个 feature 一段 ——
        `===feature wga_syncwarm=== dsl_rev=558 sha256=d7e1d56772148c52` ⇒ **`dsl_rev` + `sha256` 都有** ✓
      · **复验**：`npm run cognition:check` ⇒ **`✅ COGNITION 是最新的`** ✓
      ★ **形状与原文有一处不同（且是有意的）**：原文说"落成**仓根**一份**可进 Git** 的文本"，
        实现落在 **`.agent-io/`（不进 Git）** —— `capability_map` 的"读之前先看哪儿"段明写理由：
        **高 churn ⇒ 不进 Git**（MANIFEST 在仓根低 churn ⇒ 进 Git）。⇒ **按现设计结项**。
      ★ **记账（我的过程失误）**：核实它的判据时 `cognition:check` 先报"**已过期**" —— 而原因是
        **我今晚留下的测试 feature**（`v85_dsl-workbench` / `v85_elv`）**没清** ⇒ 清掉即"一致"。
        ⇒ ★ 教训：**测试 feature 用完当天就清**，否则会污染 `cognition:check` 这类**全仓对账**（看起来像系统坏了）。

- [x] **T89 —— 结项（2026-10-09）：设计意图在 `digest` 里**一眼可见，两个视图都成立**。**
      ★ 用户原话：*"……把那些**注释作为可解析的部分**放到 DSL 里面了，这样的话**哪怕是实际 DSL**
        也能**一眼看出来**其上面标注的一些**设计意图**什么的。"*
      · **格式没另立**：`.agent-io/COGNITION.txt` 早有 `#Format: agent-io/cognition-fras-v1`，
        行形态 `路径[层]: F:职责 | R:关系 | A:契约 | **S:高熵决策**` —— **`S:` 就是意图层**。
      · **上半（设计视图）**：`S:` 原只看 `expected_behavior`/`contract`/`lifecycle`，**不看决策卡** ⇒
        补 **`S:决策=<summary> ; 验收=<acceptance>`**（从 `geometry.nodes[].decision` 取）；
        ★ **只取两个短字段**（`rationale` 太长会撑破"一行一个文件"）。
      · **下半（实际视图）**：`view=live` 时**并读 overlay**（★ 意图的家是 overlay，**与视图无关**）⇒
        把意图"**贴**"到实际视图的对应节点上；★ **节点 id 同源**（都是 `file_<sanitize(rel)>`）⇒ 不需翻译。
      **判据（三条全达成）**：① 设计视图显示 `S:决策=…` ✓；② **实际视图也显示** ✓
        ③ 于是**同一份文本**上"**设计（意图）**"与"**实际（结构 F/R/A）**"**并排一眼可比** ✓
        （实测两视图逐字一致：`src/math.ts[core]: F:核心层 · src — 1 个 API（导入自 0 个模块） |
         S:决策=算术只能有一个来源 ; 验收=add 必须存在`）

- [x] **T90 —— 结项（2026-10-09）：两个视图各显示「自己那一版决策」⇒ **"设计改了但没实现"一眼可见**。**
      ★ 用户原话：*"实现的话，那里展示的是**最后一次实现的决策**，设计那里展示的是**最后一次设计的决策**"*
        ⇒ **两视图相同 = 已同步**；**不同 = 设计改了但没实现** ✓
      · **上半**：`snapshotBeforeWrite`（**唯一咽喉点**）**内部反查 feature** ⇒ 记 `meta.intents`
        （★ 命中 0 或 >1 ⇒ **不标**，不替人选；★ 零调用点改动）。
      · **下半**：`digest` 的 `view=live` 意图来源 **从 overlay 最新 → 换成本次最后实现的那版**
        （读 `listFileSnapshots(root)` 最近一份含该文件的 `intents`）。
        ★★ **刻意不退回 overlay 最新**：退回就**又重合**了 ⇒ **没实现过就不显示**，
          因为 **"设计有、实际无" 本身就是「未实现」这个信号**。
      **判据（两条全达成 · 真跑）**：
        ① 刚实现完 ⇒ **两视图逐字相同**（`S:决策=v1 已实现的那版`）✓；
        ② ★ 只改设计不动代码 ⇒ **两视图分叉**：
           设计 `S:决策=v2 只改了设计、还没实现 ; 验收=Kk2 必须…` ／ 实际 `S:决策=v1 已实现的那版 ; 验收=Kk 必须存在` ✓
        ⇒ ★★ **两行并排读，一眼就知道"设计已走到 v2、代码还停在 v1"** —— 这正是用户要的那个信号。

      ⇒ ★★★★ **2026-10-09 真跑试用（拿 T82 当"未实现的设计"走完整条链）—— 第 5 步撞到硬前提**
        **链路 1–4 全部通过**：① `import_project` ✓ ② **把设计翻译进 DSL**（决策卡 + `signature-matches` 验收，
        并**用 `evidence` 挂 `docs/todo.md` 当理由** ⇒ **L1–L4 全过，顺带证明 T88 那条路可用**）✓
        ③ **对拍精确报未实现**（`facesOf` 期望去掉 `directNames`、实取还在）✓ ④ **圈范围**圈出
        `[files:…tool_faces.ts] 差异 2 条（**人写的验收 2**）` ✓
        ★★ **第 5 步（重写）之前先探规模 ⇒ 发现"设计的前提没满足"**（实测读数）：
        ```
        手写 direct 共 9 个：
          ✓ 已在链里（3）: get_dsl / rename_symbols / find_references
          ✗ 不在链里（6）: edit_dsl / import_project / design_intent / rename_files / explore_code / capability_map
        ⇒ 去掉手写名单后 composed 只剩: consistency_check, edit_code, find_references, get_dsl,
          impact_analysis, move_symbol, rename_symbols
        ```
        ⇒ ★★★ **会削掉 6 个门，含 `import_project`（建档=第一步）/ `edit_dsl`（写设计=第二步）/
          **`capability_map`（导航它自己！）** ⇒ **"新人第一站"没了**。
        ⇒ ⇒ **"设计"纸面对、一做就撞**：**T81 只把 1 个 design 工具上了链（`get_dsl`）** ⇒ **手写那一半还得留**。
        ★ **所以"重写"这步没做** —— 而理由**是硬的**（做了会削掉入口），**不是"时间不够"**；
          这恰好反证**对拍+圈范围是对的**：它圈出的差异**是真的**，而**实现它需要先补前提**。
      ⇒ ★★★ **下一步的真正形状（给 design 线补对象类锚点 ⇒ 才能上链）**：
        · **`import_project`**：它**已有 `touched={feature, project_dir}`**，但两者都是**作用域边**（**不计入对象边**）
          ⇒ 要产**对象类**锚点（候选：它扫出的**文件集合** = 新键 `scope_files`，与 `get_dsl query=scope` 同族 ✓）；
        · **`edit_dsl`**：它改了 **DSL 的节点** ⇒ 候选锚点 = 它改的 `nodes[]`（★ 而 `Touched.nodes` **已有** ✓）。
        ⇒ 两条边一加，**派生链**里就会出现 `import_project` 与 `edit_dsl` ⇒ **那时去手写才安全** ✓
      ⇒ ★★★★ **2026-10-09 当天就补完了这两条边（真跑读数，不是推断）**：
        **① `import_project` ⇒ 交 `scope_files`**（`ImportProjectResult.scope_files` + 入口层搬进 `touched`）。
          真跑（夹具 `C:/tmp/agentio_t82`，3 个 TS 文件）：`touched.scope_files=["src/core/format.ts","src/core/math.ts","src/util/calc.ts"]`
          ⇒ 取 `[0]` 直喂 `edit_code.file`（`op=range`）⇒ `ok=true` / `written=true` / `written_files=["src/core/format.ts"]` ✓
        **② `edit_dsl` ⇒ 交 `nodes`**（`touchedOf` 原先**只给 `feature`**，是个作用域键 ⇒ 零对象 ⇒ 上不了链）。
          真跑：`edit_dsl {op:move,type:node,id:"file_src_core_format_ts"}` ⇒ `touched.nodes=["file_src_core_format_ts"]`
          ⇒ 取 `[0]` 直喂 `get_dsl.node_id`（`query="node"`）⇒ **真读到该节点** ✓
          ★ 口径：只收 `id` **就是节点 id** 的 op（`node`/`binding`/`status`）；`edge`/`file`/`api` 的 `id` **不是节点**，一个都不收。
          ★★ 只给**落定后仍存在**的 id（`op=delete` 后那个节点已不在 DSL 里）。**出生证（能区分）**：
             同一次调用 `delete dir_src_util` + `move file_src_core_math_ts` ⇒ `nodes=["file_src_core_math_ts"]`
             —— **两个都被点名，只给活着的那个** ✓
        ⇒ **复算面读数**（走真工具 `capability_map`）：派生链 **7→9** 个（新增 `import_project` / `edit_dsl`）、
          `direct` 里**派生链没覆盖的 6→4 个**（剩 `capability_map` / `design_intent` / `explore_code` / `rename_files`）。
        ⇒ ⚠ **我这一行原先写的是「`composed` 9→13 个」—— 那个数是错的，已撤回。**
          ★ 错因（本仓头号病，我自己犯的）：`composed = direct ∪ 派生链`，而 `import_project`/`edit_dsl`
            **本来就在手写 `direct` 里** ⇒ 并集**一个名字都不会多**。我把文档里 **2026-10-06 的陈旧读数「9」**
            （`tool_faces.ts` 头注"`face=composed` 9 工具"）当成了改前基线 ⇒ **拿陈旧读数当基线**。
          ★ 独立复算（`--experimental-strip-types` 直 import 源码 + `HEAD~1` 对照）：`composed` **13 → 13（零变化）**；
            真正变的只有 **`deriveObjectChains()` 链条数 11→13** 与 **链上工具去重数 7→9**。
        ⇒ ★★ **前提只解了一半**：T82 想删的那 3 个门里，`import_project` ✓、`edit_dsl` ✓，**`capability_map` 仍然上不了链**
          —— 而事实调查的结论是它**本来就没有对象可交**（产物是 `lanes`/`domains`/`handoff`，没有"文件/符号/节点"类对象）。
        ⇒ ★★★ **更重要：T82 的方向本身被这一轮否掉了** —— 「删掉手写那一半 / 待用数据替换」**是错的**，理由两条：
          ① **`direct` 不只喂编排面，它还是线视图的数据源**（`capability_map.ts:580` 那行"直接可用（无需导航）"读的就是它）
             ⇒ 删掉派生链已覆盖的名字，**线视图会丢掉那条线的入口**；
          ② 它的依据不是"用量统计"而是**结构性判据**「面无门 ⇒ 该线不可达」（`LANE_META` 各条注释）——
             **换用量数据换不掉它**。
          ⇒ **新处置**：① `Lane.direct` 的旧注释「**高频工具**」已改成「**这条线的门名单**」（"高频"从来没有依据，
             正是"2026-08 手写策展表"这个说法的来源）；② 编排面**不再自称"零手写"**，改成如实报
             「**两份依据（可重叠）**」并印出**重叠数**；③ **判"手写那半变没变"请看 `direct` 本身，别用 `composed`**。
        ⇒ ★★ **顺带撞上 T71 —— 但结论要改**：我原先写"面上成员变了而 `snap:diff` 全绿"，**面上成员没变**（见上）
          ⇒ 那次"坐实"作废；不过实测反倒挖出更硬的一条：**给一个工具补上派生链，会让"它在不在 `direct` 里"不再可观测**
          （把 `import_project` 从 `direct` 拿掉 ⇒ `composed` 一个名字都不变）。详见 T71。
- [x] **T93 ✅（2026-10-09 结项）★★★ `semantic.files` 被拿去装聚合节点 ⇒ 容器名与内容不符（不报错的错）**
      *(来源：2026-10-09 反伪评审实测，夹具 `C:/tmp/rvf_fixture` / `agentio_t93`。)*
      ⇒ **契约**（`src/domain/semantic.ts:62-67`）：`SemanticFile` = **文件**的语义条目，`path` 是"**目标文件相对路径**"（单数）。
      ⇒ **违约的写入者 3 处**（`import_project.ts`）：`buildFromMonolith`、`buildFunctionalLayout`、`design_mode` 目录聚合
        —— 都把**聚合/模块节点**塞进 `semantic.files`，且 `path` 填**成员列表拼接**（`rel.join(', ')` / `rel + '/'`）。
      ⇒ **实测读数（最严重的一条）**：`functional_mode` 下 `semantic.files` **只有 2 条、两条 `geometry.type` 都是 `module`、真文件 0 个**
        —— **不是"个别条目被污染"，是"容器被整个挪用"**：一个叫 `files` 的容器里**一个文件都没有**。
      ⇒ **实害（真跑复现）**：`explore_code action=derive_chain node_id=func_0` → `源文件不存在，无法读取: …\math.ts, src/util/calc.ts`；
        `consistency_check` → `【文件】src/core/math.ts, src/util/calc.ts 状态: ❌ 不存在`（而单成员聚合 `func_1` **侥幸"存在"** —— 这种"偶尔对"最危险）。
      ⇒ **修法（已落地）**：**写入端不挪用** —— 聚合节点**不进 `semantic.files`**，摘要写进对应模块几何节点的 **`title`**
        （`geometry.ts:124-125`：人话主标题／职责摘要，**渲染端优先展示**，label 兜底；`:1349` 本来就在给 file/module 两类都写它 ⇒ 删掉不丢信息）。
        ★ **不选**"在 `scope.ts:243` 里过滤"那条 —— 那是**给消费者加兜底**，把症状藏起来（本仓明令禁止）。
      ⇒ **判据（真跑，三条模式各验）**：`semantic.files` **只出现几何类型为 `file` 的 id**
        （default 3 条真文件；functional/design **0 条**）✓；两条硬失败**变成人话错误**
        （`节点 "func_0" 没有对应源文件（semantic.files 无此 id…）` / `feature "func" 没有 semantic.files…`）✓
        —— ★ 判据**不是**"`func_0` 必须成功"：它是聚合体，**拒绝得清楚才对**；**唯一不可接受的是"再把逗号串当路径去读"** ✓
      ⇒ ★★ **反向证据（定性关键）**：`:1442-1445` 逐字写着「模块节点的 `path` 是 ", " 拼的多个 rel，不是单个文件」**并用 filter 排除之**
        ⇒ 「容器=文件」**从来没被真正贯彻**，早有人知道并**绕开了** ⇒ 搬走是**收敛历史债**，**不是破坏契约**。
      ⇒ ★★ **修复顺带照出一处判据分叉（已一并修掉）**：「**本 feature 有哪些文件**」原先有**两把尺** ——
        `scope_files` 取**扫描出的文件列表**，而**基线事实**（T85/D2 第二份产物）从 `semantic.files` 过滤取
        ⇒ 实测聚合模式下 `baseline/<feature>.facts.json` 锚定 **0 个文件**（default 3 个）⇒ **对拍在聚合模式下没有基准**。
        修法：抽 `const scopeRels = files.map(f => f.rel)` **算一次**，基线事实与 `scope_files` **共用同一份**。
        判据（真跑）：`default` / `functional_mode` / `design_mode` **三种模式都锚 3 个真文件** ✓（改前是 3 / 0 / 0）。
      ⇒ ★ 顺带清掉的死代码：`import_project.ts` 里那个"排除逗号串/目录"的 filter —— **出生证**：默认与聚合两种模式各跑一次，
        **过滤掉 0 条**（判据仍在就留着，只有确证恒不触发才删）。
      ⇒ ★★ **遗留（新记 T97）**：T93 让三处「`semantic.files` 为空就抛」的闸在**聚合模式下新触发**
        —— 见 T97（**同一判断住三处**，且消息不自洽）。
- [x] **T97 ✅（2026-10-09 结项）三处「没有 semantic.files」的拒绝：其一**过度拒绝**（已撤），三处收成一处**
      *(来源：T93 收口时 `grep "没有 semantic.files"` 命中 3 个抛点。)*
      ⇒ **三处**：`status_tools.ts:99`（无法检查**状态**）· `intent/consistency.ts:347`（无法检查**一致性**）·
        `scaffold.ts:684`（无法生成**代码骨架**）。**同一判断住三处**，且 T93 让它们在聚合模式下**新触发**
        （以前 `semantic.files` 里有模块条目，会往下走）—— 属"半修"，必须处置。
      ⇒ ★★★ **第一步判定（先查再改）：`consistency` 的"整体拒"是**过度拒绝、丢了能力**。**
        证据：线 1 = `checkBaselineDrift` → `getBaselineFacts()`（读 `<home>/.agent-io/baseline/<feature>.facts.json`）
        → 只 `Object.entries(baseline.files)` ⇒ **全文对 `semantic.files` 零引用**；而基线事实的锚定源是**扫描出的文件**。
        **真跑**：给 `src/math.ts` 追加 `sub()` 后，`consistency_check`（functional 模式）→
        `线 1 · 有变化：1 个文件 … ＋ sub(a: number, b: number): number`、`baselineDrift.compared = 3` ✓
      ⇒ ★★ **这是本轮的一个真收益**：**对拍（线 1）在聚合模式下第一次真的工作了** ——
        它由两件事合起来带来：① T93 的单一事实源修复（基线事实在聚合模式下也锚 3 个真文件）；
        ② 撤掉这个过度拒绝。（此前聚合模式下要么拿逗号串当路径、要么直接拒。）
      ⇒ **改后行为**：`consistency` **照跑线 1**，线 2 空则**如实报"无内容"**
        （文案已写清：*"不是'没有差异'，是'**没有对手**'"*）—— **报告，不是错误**；
        `status` / `scaffold` **仍然拒**（没有文件节点可检查状态／生成骨架 ⇒ 拒是对的）。
      ⇒ **收敛**：判据 = `domain/semantic.ts` 的 `hasFileEntries(semantic)`（**纯领域事实** + **类型谓词**）；
        说明文本 = `application/design/no_file_entries.ts` 的 `noFileEntriesMessage(feature)`（**唯一住处**，三处共用）。
        消息含三要素：① 这是什么状态 ② 为什么（聚合模式**故意**把文件身份折叠进模块）③ 出路（用默认模式重新 `import_project`）。
      ⇒ **判据（真跑）**：三处消息**逐字相同**（实测长度 440/440/440，`diff` 无差异）✓；
        **default 模式行为不变**（`consistency_check` 比 3 文件 + `✓ 线 2 无待办`、`scaffold` 生成 4 文件）✓；
        `tsc` 0 · `verify` 5/5 ✓。
- [ ] **T99 ★★★ 聚类的判决：**它有用，但输给一个更便宜的东西** ⇒ 据此定去留**
      *(来源：2026-10-09 用户提出「那个聚类我觉得也可以废弃了……太机械化了，而且和实际意义不相符，
        只是为了给人看而出现的」⇒ 我没凭感觉删，先做了**可证伪的预测力实验**。)*
      ⇒ **实有 3 个聚合产物**（不是一个）：① `design_mode` 按**目录**聚合；② `functional_mode` 按**调用图社区**；
        ③ `brickify`（`bricks/brickify.ts:19`，**无向连通分量 + 内聚度**）。
      ⇒ ★★ **先纠一处"我读错路径"（本仓第 4 次同型，见 §2.3「判据必须落在正在跑的那条路径上」）**：
        我按源码读了 `communityDetectFiles`（`:669`，**标签传播**）并据此向用户描述算法 —— **错**。
        实际路径：`buildFunctionalLayout`（`:894`）默认 `useSkillPipeline=true` ⇒ **先试 skill 管线 `analyzeMonolith`**（`:908-918`）
        ⇒ 本仓有 `cache.db` ⇒ 走 **`buildFromMonolith`**；`communityDetectFiles` 在 `:921`，**只有回落分支才到**。
        **三条独立证据**：① 节点名是**符号名**（`manageFeature`/`UnionFind`/`brick_bag`），不是 `communityNameOf`(:723) 的"首段目录"名；
        ② 直接调 `analyzeMonolith` 复现出**逐格一致**的 379 社区；③ 拷 `src/` 到无 cache 目录重跑，**工具会自建 cache** ⇒ 仍走不到回落分支。
      ⇒ **读数（真跑，T=1000 次随机、种子 20261009）**：
        · 宇宙 **U=353** 文件（353 > `max_files` 200 ⇒ **200 那个上限没限定功能社区的面**，`analyze_monolith` 自己读整仓）
        · **379** 个社区，其中 **327 个 size=1**，最大 44；★ **重叠**（174 个文件在 ≥2 个社区里）
        · `P(共变)` = **8.95%** · `P(共变 | 同社区)` = **41.61%** · `P(共变 | 不同社区)` = 7.50%
        · **同规模随机切分**：均值 8.79%、范围 [6.19%, 11.40%]、**0/1000 ≥ 观测值** ⇒ p≈0.001、**lift 4.73×**
        · **度匹配零模型**（扣掉"社区偏挑热点文件"）：均值 22.62% ⇒ **lift 1.84×**（p≈0.001）
        ⇒ **结论①：对随机显著 ⇒ 它不是装饰**（这一点与我原先的怀疑相反）。
      ⇒ ★★★ **但真问题是它没赢过平凡基线**：**同"直接父目录"**（87 组）`P(共变)` = **60.46%**、度匹配 **lift 3.41×**，
        **显著高于功能社区的 1.84×**；而 `design_mode` 的**顶层目录**（6 组）lift **仅 1.11×（≈随机）**。
        ⇒ **结论②：调用图社区在预测"一起改"上，不如"同一个文件夹"。**（即用户直觉的"太机械"其实说反了一半：
          机械的那把（目录）**更准**；聪明的那把（社区）**更差**。）
      ⇒ ★ **诚实限定**（别把不可比的两个数并排）：两组形状差别很大（379 个含 327 个单例、**且重叠** vs 87 个），
        **lift 在不同分组粒度间严格来说不可直接比** ⇒ **方向明确，量级不当定论**。要定论需补"把社区粗化到同组数"的对照。
      ⇒ ★★ **顺带查出一个更要紧的缺陷**：**聚合的结果里查不到"成员是谁"** ——
        feature json 里 `semantic.files=[]`，模块节点只带**成员数**（`聚合 44 个文件`）**不带名单**
        ⇒ **聚合不可回查** ⇒ 它连"链的交接物"都算不上（下游拿不到成员就什么都干不了）。
      ⇒ ⇒ **处置建议（待拍板）**：**废弃"把聚合存进 DSL"这条路**（不是"换一种更好的聚类算法"）——
        理由：① 目录树从**路径**算、社区从**边**算，**两者都是投影**（`/proc`），**不该落盘当事实**（`/etc`）；
        ② ★ **这正是我们刚修的 T93 的同一个病**（把投影当事实存进 DSL，于是它冒充"文件清单"）；
        ③ 投影**按需算**即可，且第一版就用**直接父目录**（便宜、还更准），**不用**调用图社区。
        ★ 人写下的**名字/意图**仍住 `overlay`（那是 `/etc`）⇒ 事实与意图各归其位。
      ⇒ **判据**：① `semantic.files` 与几何节点里**只出现文件与真实容器**，没有任何"聚合冒充"；
        ② 任何分组都能**从文件+边当场重算**（即"存不存它"不影响可得性）；
        ③ 若保留任何聚合视图，它必须**能列出成员名单**（不可回查的一律不收）。
      ⇒ **notDetermined**：① 回落分支 `communityDetectFiles` 的预测力（本仓跑不到；成员映射无处可读，
        且用 cache 重建的 deps 只有 228 条 vs 实测 333 ⇒ **拒绝冒充**）；② 出样预测（历史仅 09-08~10-09 一个月）；
        ③ 用"设计意图"而非共变作真值的版本未做。

- [x] **T102 ✅（2026-10-09 结项）移除两个死入参 `functional_mode` / `design_mode` + 整条实现线（8 文件 +176/-685）**
      *(依据：T99 普查 —— 两者**全仓 0 处赋 true**、README **未承诺**、且有害（`func_*` 曾因 id 前缀不在白名单被误判成"人手节点"）。
        用户 2026-10-09 裁定「**可以**」。)*
      ⇒ **先查一个前提决定删多少**（grep 原文在 `.inspect/review/N-remove-modes.md`）：
        · `analyzeMonolith` / `analyze_monolith` **有别的调用者**（`derive_feature_tree.ts:199`）**⇒ 保留**；
          ⇒ ⚠⚠ **2026-10-10 撤回半句**：我在这里写过"**+ 一个独立注册工具**" —— **错，没有那个工具**。
            全仓搜 `analyze_monolith` 只有**注释里提到**（`derive_split.ts` / `derive_mind_map.ts`）。
            ⇒ **真实依据只有一条**：`derive_feature_tree.ts:199`。★ 这条删除依据**仍然成立**（它确有调用者）⇒ 结论不变。
            ★ 错因同 T106 那三条：**下判断时没有把全量拉下来数**（我大概率是从"它像是个 skill"顺手推的）。
        · `buildFromMonolith` **无别的调用者**（私有，唯一调用点就在 `buildFunctionalLayout` 里）⇒ 与
          `buildFunctionalLayout` / `communityDetectFiles` / `communityNameOf` **一并删**（只为 functional_mode 存在）。
      ⇒ **删了什么**：接口两字段 + 整条功能聚合线（380 行）+ `design_mode` 全部分支（layoutDir/accumulate/文件循环/依赖边/directEdges）
        + 连带死函数（`aggregateDirSymbols`/`collectSubtreeFiles`/`topDirNodeId`）；
        ★★ **`SCANNED_ID_PREFIXES` 去掉 `func_`** ⇒ `['file_', 'dir_', 'doc_']`（**加/删前缀只改一处** —— 那个集合立对了）。
      ⇒ ★★★ **验收判据（最强的一条，缺它作废）：默认模式产出「逐字不变」** ——
        删前先在**本仓**（200 文件）抓一份稳定投影指纹（254 节点 / 418 边 / 200 语义 / 4169 行），
        删后用**新 home + 新 feature 名**重导（★ 因为基线事实与设计层是 **write-if-absent**，同名重导会读到冻结的旧产物）
        ⇒ `diff` **无输出** ✓ —— **证明删掉的确实只是死分支**。
      ⇒ 其余：`tsc` 0 · `build` 孤儿 0 · `verify` **5/5** · `grep 'func_${' src` = 0 · 残留的 `functional_mode/design_mode` 命中**全是"移除留证"注释**。
      ⇒ ★★ **顺带得到一个精确的"快照覆盖面"结论**（比"快照有没有用"更准）：
        `npm run snap:diff` 报了 **2/6 不一致**（`tool-surface` 与 `tool-smells`）—— 差异**正好**是
        `import_project.inputKeys[12]="design_mode"→undefined`、`[13]="functional_mode"→undefined`（+ 宽签名名次级联）。
        ⇒ **工具入参面有人盯**（`tool-surface`/`tool-smells` 覆盖它）；
        ⇒ **而面成员（`direct` / 派生链）没人盯**（T71 那次"面变了仍 6/6 全绿"）。
        ⇒ 结论：**不是"快照没用"，是覆盖面有具体边界** —— 用之前先问"**它在看哪几个面**"。
        按快照自己的规矩（有意变更就 `take` 更新并说明）⇒ 已 `snap:take`，复查 **6/6 一致**。
      ⇒ ★ 未动：`.snapshots/behavior.json` **本来就不该提前抹**（要让 `snap:diff` 把这次 schema 变化报出来）——
        这也是刚才那 2/6 能被看见的原因。
- [x] **T101 ✅（2026-10-09 结项）★ `doc_*` 被当成"人手加的节点" ⇒ 重建被误拒（**默认路径上的活缺陷，我自己当天引进的**）**
      *(来源：T99 派单查出 D1-2（`/^(dir|file)_/` 把 `func_*` 误判），我顺着它推出 `doc_*` 也会被误判 ⇒ 真跑复现。)*
      ⇒ **现场（真跑，夹具 `C:/tmp/t_doc`：1 个 ts + `docs/todo.md`）**：
        `include_docs:true` 导入后再 `rebuild_design:true` 重建（不带 `include_docs`）⇒
        `拒绝重建设计 DSL：本次重建会**抹掉 1 个"扫描产不出的"节点**（多半是人手加的）：· doc_docs_todo_md`
        ★ 而 `doc_docs_todo_md` 是 **T88 的 `include_docs` 扫出来的**；那句提示还建议"**先手工把它们记进设计**"
        —— 对一个文档节点**完全不知所云**。
      ⇒ **根因（本仓头号病又一例：同一件事住两处）**：本文件有**四个** id 生成器
        （`file_`/`dir_`/`func_`/`doc_`，另 `impact/diff_impact.ts:158` 也产 `file_`），
        而那道闸用的是 `/^(dir|file)_/` ⇒ **T88 加 `doc_` 时没人改它**。
        ★ 更深一层：那道闸问的是"**这个 id 是不是本次扫描产得出的**"，却**用"是不是目录/文件"去回答** ——
        **两个问题，一个信号**（§2.1 "先问"我数的是判据本身，还是判据的影子"）。
      ⇒ **修法（判据住一处）**：立 `SCANNED_ID_PREFIXES`（四种前缀）+ `isScannedNodeId(id)`，
        闸改调它；四个生成器各加一行"★ 前缀登记在 `SCANNED_ID_PREFIXES`"。
        ★ 留下**可机检的不变式**：源码里所有 `` `<x>_${…}` `` 形式的 id 模板，其前缀 ⊆ 本集合。
      ⇒ **出生证（两个方向都验，能区分）**：
        · `doc_docs_todo_md`（**扫描产出**）⇒ 修后**不再被拒** ✓
        · `my_manual_note`（`edit_dsl` 手工加的）⇒ **仍然被拒、且被列出** ✓（**证明没把闸拆掉**）
      ⇒ **验收**：`tsc` 0 · `npm run build` 孤儿 0 · `npm run verify` **5/5**。
      ⇒ ★ **同族待办**：`functional_mode` 的 `func_*` 也会被旧正则误判（T99 的 D1-2）—— 本条修完后
        `func_` 已在集合里 ⇒ 那个误判**一并消失**（即 D1-2 顺带结了）。

- [x] **T100 ✅（2026-10-09 结项·MVP）「功能」= 人写的归属标记 ⇒ **已能在设计侧打标记、能回查、活得过重建**
      —— 剩余部分（D1 优先 / 集合级对拍）拆到 **T103**。*
      *(来源：2026-10-09 用户：*「能不能把一个功能完整的囊括起来？就像之前那个**积木**的想法一样……
        而且 **DSL 本身也可以打标记**，你可以在这个符号上说它**隶属某功能**。」*)*
      ⇒ ★★ **关键区分（这也把 T99 的判决边界说清了）**：
        · **算出来的**分成一坨（连通分量 / 标签传播 / 目录）= **投影**（`/proc`）⇒ T99 测的是这个，**判决只对它成立**；
        · **写下来的**归属 = **意图**（`/etc`）⇒ 用户说的是这个，**T99 的判决不适用**。
      ⇒ **为什么标记是对的载体（三条，都是判据级的）**：
        ① **跨重构稳定**：文件能改名/搬家/拆开，但"它属于『配置加载』"不变 —— **聚类是"当前形状"，标记是"功能身份"**；
        ② **天然可回查**：标记 = **反向索引**（"『配置加载』的成员是谁"），顺手修掉 T99 查出的
           「聚合只带成员数、**不带名单** ⇒ 不可回查」那个缺陷；
        ③ ★★ **给对拍开出第二条轴** —— 见下。
      ⇒ ★★★ **新的对拍轴：集合级**（今天只有**点级**：一个文件一个文件比 `expected_apis`）。
        **设计说**"这几个文件是一坨"（同一个功能标记）；**实际说**"它们不是一坨"（几乎不 import、git 里从没一起改过）
        ⇒ **这是一个可判定的差异**。两个方向都能算：
        · **出界**：标了 F 的文件，有强 import/共变关系指向**没标 F** 的 ⇒ "你划的范围漏了"；
        · **漏人**（反向）：没标 F、但与 F 内部**强耦合/共变** ⇒ "它该进来，或者 F 该拆"。
        ★ 这两个量**正好用 T99 那个实验已经产出的数据源**（共变矩阵 + import 边）—— **一份数据三个用途**。
      ⇒ **落地形状（4 条，按优先级）**：
        ① **标记是"标签"不是"节点"，且可多重**（一个工具常同时服务三个功能）——
           ★ **不要做成"分区"**（非此即彼），那正是目录/聚类那种机械感的来源；
        ② ★★ **标记必须住 `overlay`（意图），不住 base** —— 否则 `import_project` 一重建就冲掉
           （**这个坑本仓今天已经踩过一次**：T75/T77，人写的决策一重建就丢）；
        ③ **悬空标记必须报出来**（文件被删/改名后标签指向不存在的东西）—— 范式照抄 `allow_design_drop`：
           **默认拒绝破坏性操作并列出受影响项，不静默**；
        ④ **LLM 提、人批**（走已有的 `design_intent action=propose`）—— 因为**人不会主动去标**，
           这是这类工作台最常见的死法。
      ⇒ **T99 的判决随之调整**：**聚类不是"删"，是"降级成提案器"** ——
        **它不该产出"分类"，该产出"提案"**（*"这几个文件平时老一起改，要不要归成一个功能？"*）。
        ⇒ ★ **废弃的是"聚类结果进 DSL"，不是"聚类这个动作"**；`brickify` 的积木（目录种子 + 算出来的）
          与标记（声明出来的）**可以并存，各归其位**：积木当提案器，标记当真身。
      ⇒ **风险**：① 边界模糊（一个符号属三个功能时"它到底是谁的"无唯一答案 ⇒ 接受多标签，可选"主归属"）。
      ⇒ **判据（可判定）**：① 能回答"标签 T 的成员有哪几个"（回查）；
        ② 悬空标记**报出来**（删/改名后不静默）；
        ③ **集合级对拍能算出"出界 / 漏人"两个方向的数**（今天算不出，因为没有标记）。
      ⇒ **下一步**：先普查三条聚合线的真实调用者（谁在把聚合**当分类用**）—— 已派。
      ⇒ ★★★ **2026-10-09 次序更正（读完那 4 处 D1 的现场之后，我推翻了自己上一条的排序）**：
        **① `split_stage` 那条真切文件的路本来就有闸** —— `split_stage.ts:147`/`:196` 都是 `dry_run ?? true`，
          工具入参 `apply` 也写着「省略 = dry-run（**默认**）」⇒ 我上一条说的"活的危险面"**说过头了**。
        **② 更关键：D1 那两处"当事实"没法独立修。** 它们实际干的是：
          · `classify_bricks.ts:171` 先建 `fileToCluster`（来自聚类结果），再算"哪个架构槽跟哪个槽有依赖"；
          · `classify_tools.ts:203` 先建 `moduleIndex`（同上），再算"这个工具由哪个簇实现"。
          ⇒ 两者都是「**拿聚类结果去回答一个关于代码结构的问题**」。
          ⇒ 而"**提案**"的含义是「**它可以被否定**」—— 今天它否定不了，因为**没有第二个来源**。
            先改它们，只是把"唯一答案"改名叫"建议"，**是空的**（§"半修比不修更坏"的同族）。
        ⇒ ⇒ **次序反转**：**先做本条的「标记」最小版**（有了可替代来源），D1 才谈得上"标记优先于聚类"。
      ⇒ ★★★ **本条的 MVP 形状（我拍的，四条都有可判定判据）**：
        ① **标记 = 文件节点上的多值标签**（不造"功能节点" —— 那会变成又一个"聚合节点冒充节点"，正是 T93 刚清掉的病）；
        ② **唯一住处 = `overlay`**（意图），**不住 base**；写走 `edit_dsl`（这样 **L1–L4 原因闸自动适用**：每次打标记都要有理由）；
        ③ **存储只存一个方向**（建议 `function_tags: { [tag]: 成员文件 rel[] }`），另一个方向（"这个文件属哪些功能"）**反查**而得
           —— **绝不两个方向都存**（那是判据分叉）；
        ④ **悬空必须报**：成员文件被改名/删除后，回查时**标出"该成员已失联"**，不静默丢。
      ⇒ **判据（5 条，缺一不可）**：`tsc` 0 · `verify` 5/5 · 能写（走原因闸）· **能回查**（列出某 tag 的成员）·
        ★★ **`import_project` 重建后标记仍在**（这是 T75/T77 那条教训的直接判据 —— 人写的意图一重建就丢，本仓踩过一次）·
        ★ **改名一个成员文件后，回查报出"失联"**（而不是悄悄少一个）。
      ⇒ ★ 符号级（而非文件级）的标记**本版不做**：文件级已足够支撑"出界/漏人"两个方向的对拍；等真需要再加，别先造。
      ⇒ ★ 待定（留给实现时现查）：回查的落点 —— 加 `get_dsl` 的**一个窄 query**（`query=tag` + `tag` 参数，**只加一个参数**，别再把那个 schema 糊大）。
      ⇒ ★★★ **2026-10-09 落地（已提交）**：标记住 `overlay.global.function_tags`（`Record<tag, string[]>`，**只存 tag→成员 rel 单向**，
        反向反查而得）；`applyOverlay` 投影进 `base.meta.function_tags`（与 `goals` 同款）；
        写走 `edit_dsl` 的 `type:'tag'` op（**L1–L4 原因闸自动适用**：实测 reason 未绑定实体时被 L3 挡下）；
        回查 = `get_dsl query=tag`（+`tag` 参数，只加这一个）。
      ⇒ **两处我拍的形状被实现推翻、我接受**（都是它比我更对）：
        · **A 写序反了**：我写"先写 overlay 再 apply 回 base"，实际应为**先改 base、收口时 base→overlay 同步** ——
          因为 `edit_dsl` 是"任一失败全回滚"，而它的回滚**只恢复 base 不碰 overlay** ⇒ 在 op 里直写 overlay 会**留下未回滚的标记、破坏原子性**。
          ★ 而且**这与本仓既有模式一致**（`updateFeature` 收口处本来就这样同步决策卡）⇒ **是我写错了，不是它偏离**。
        · **B 顺手清掉一处既有 `??` 兜底**：原 `syncDecisionsToOverlay(…, getDSL() ?? 空DSL)` —— 该兜底对决策是无害 no-op，
          但**对标记是破坏性的**（空 DSL 缺 `function_tags` 会被读成"已清空"⇒**静默抹掉 overlay 标记**）⇒ 改成"回读一次、读不到就抛"。
      ⇒ **我的独立复算（不采信它的总结）**：
        · #5 ★ **重建后仍在** —— 真跑：`ftB` 重建前 `{tag:"mod",count:2,missing:0}`，`rebuild_design:true` 后**一模一样** ✓
        · #6 ★ **失联可判** —— 真把成员 `src/alpha.ts` 改名后重导 ⇒
          `{"members":["src/alpha.ts","src/gamma.ts"],"found":["src/gamma.ts"],"missing":["src/alpha.ts"]}`
          ⇒ **报失联、且不悄悄削掉成员** ✓
        · `tsc` 0 · `build` 孤儿 0 · `verify` **5/5** ✓
      ⇒ ⚠ **一处我复现不出来的读数（记下来，别当成已验证）**：报告称"给 **ftA** 的 3 个文件打 tag **`core`** ⇒ 命中 3/失联 0"，
        但我在磁盘上查：**`ftA` 零标记，`/c/tmp` 里没有 `core` 的任何踪迹**（唯一有标记的是 `ftB`，tag 是 `mod`）。
        ⇒ 机制我复现了（#5/#6 都过），**但那组具体数字当作未验证** ——
        也提醒：**"它说它跑过"和"证据还在"是两件事**；核验不能只读总结，要**去落盘的产物里找**。
      ⇒ 实现顺手自抓并修掉一个真缺陷：第一版 `delete` 删不掉**失联成员**（判据错用"当前文件节点解析"而非"存储成员串"）⇒ 已修（失联可清、也仍支持传文件 id）。
- [ ] **T103 ★★★ 把「功能」这个词从拓扑分组手里拿回来 —— 一词一义（**用户最初那句抱怨的精确化**）**
      *(★ **原写法「让标记优先于聚类」已作废** —— 派活前读现场发现**前提错**：那 4 处与我做的标记**不在同一个轴上**，见下。)*
      ⇒ **前提错在哪**：`classify_bricks` 的 `taxonomy` 槽是 **`intake`/`parse`/`compute`/`store`/`render`/`observe`/`review`
        = 「**处理流水线解剖**」（**架构角色**轴），而 `ClusterClassification` 本身带 `{slot, confidence, reason, mode:'llm'|'rule'}`
        ⇒ 它**根本不是在"拿聚类当事实定功能"**，我也**不该**把"功能标记"塞进一个架构槽的管线（那是把两个轴混成一个 = §2.2）。
        ⇒ 同理 `classify_tools`（工具→实现簇）、`signal_review`/`split_stage`（按簇拆文件）**都不是功能轴**。
      ⇒ ★★★ **真正的病（轴审计查出，而且它就写在名字里）**：
        · 算法 = **无向连通分量 + 内聚度**（`brickify.ts:414`；纯**拓扑邻近**，不含任何语义）；
        · 但它被叫作「**功能社区**」（`brickify.ts:7/57/105/396/414/573`）与「**功能模块**」（`cluster_narrator.ts:362`），
          工作台标题也叫「**功能社区**」（`render_brickwork.ts:657/662`）；
        · ★★ **最要紧的一处**：`cluster_narrator.ts:389` 的 LLM 提示词说
          「给定项目元信息和它的"**积木**"（**功能模块**）清单，请产出项目总览」—— **拿一个拓扑分组，去让 LLM 写"功能"的散文**。
        ⇒ ⇒ **后果不是"数字错"，是"会写出通顺的、关于并不存在的功能的叙述"** —— 比错数字更坏（§2.3「不报错的错」的语义版）。
        ⇒ ★ 而 `brickify.ts:684` **已经有一句诚实的**：*"功能社区 = 积木间依赖边的无向连通分量 + 内聚度；**启发式，需人确认边界**"*
          —— 但**它埋在一个字符串里**，而"功能"住在**类型注释 / 字段 doc / 提示词 / HTML 标题**里。
          ⇒ **同一件事两个说法、住多处**（本仓头号病），且**误导的那个在显眼处、诚实的那个在角落**。
      ⇒ ★★ **正解 = 一词一义**：
        · **「功能」这个词留给 T100 的标记**（人写的归属 = 意图）；★ 本仓的"功能"只该有这一个意思；
        · **拓扑分组改叫它本来的样子**（例：「**依赖连通簇**」/「结构簇」），并在**面向人与面向 LLM 的地方都写明**
          "**它量的是"挨得近"，不代表功能边界；是启发式，需人确认**"。
      ⇒ ★ **为什么不选"换更好的聚类算法"**：T99 已实测 —— 它的预测力**不如"同一个直接父目录"**（度匹配 lift 1.84× vs 3.41×）。
        问题不在算法好不好，在**它被当成了别的东西**。
      ⇒ **要做（只改"词"与"口径"，不改算法、不改字段名）**：
        ① `cluster_narrator.ts` 的 **LLM 提示词**：不许把分组断言为"功能模块"（改成"结构簇（按依赖连通性聚出，**不代表功能边界**）"）；
        ② 面向人的文案：`brickify.ts` 注释/`cluster_narrator.ts` 的 `ROLE_LABEL`/`desc`、`render_brickwork.ts` 的 HTML 标题；
        ③ 在产出里**显式带上**那句诚实的限定（它今天只在一个字符串里）。
        ★ **保留字段名 `community` / `sub_clusters`**（改字段名会波及代码，不值当）—— 只改**面向人的词**。
      ⇒ **判据（可判定）**：① `grep "功能社区\|功能模块" src` ⇒ 0（或仅剩"**≠功能**"的澄清句）；
        ② 给 LLM 的提示词里**不再把分组断言为"功能"**（贴提示词原文）；
        ③ **不改行为**：`brickify` 产出的 **JSON 结构与字段名逐字不变**（贴改前/改后同一夹具的结构对比）；
        ④ `tsc` 0 · `npm run build` 孤儿 0 · `npm run verify` 5/5。
      ⇒ ★★★ **2026-10-09 落地（已提交）**：「功能社区 / 功能模块」→「**结构簇**」全仓统一
        （`grep "功能社区\|功能模块" src` 改前 30 行 ⇒ **0**）；`cluster_narrator.ts:389` 的 **LLM 提示词**已改为如实描述
        （"按依赖聚出的**结构分组**，**不代表功能边界**，启发式、**需人确认**"），`features` 条目由"功能名"改"定位名"；
        `brickify.ts` 的 `community` **字段 doc 成为"唯一住处"**（写明机制 + 不代表功能边界 + 本仓"功能"只指标记），
        并把原来埋在 `:684` 字符串里的诚实限定**前移**到定义处。
      ⇒ ★★ **不改行为（我核过的硬判据）**：真跑 `brickify`，把字符串叶子抹平后比结构 ⇒ **`STRUCT_IDENTICAL`**，
        整份 JSON 逐行 diff **只有 1 行变**（就是那句文案）⇒ 字段名/数值/结构全同。
        `tsc` 0 · `build` 孤儿 0 · `verify` **5/5**。
      ⇒ ★ **实现纠正了我规格里的一处事实错误**（它比我准）：我写"它**按依赖连通性**聚出"，但 `:389` 喂的是 **bricks（积木）**清单，
        而积木的机制是「**目录做种子 + 依赖边校正**」—— 无向连通分量是 **communities** 的机制。它按**真实机制**描述并报备。
        ⇒ 又一次印证：**规格写出来之后、派出去之前，再去现场看一眼它是不是我以为的那个东西。**
- [ ] **T104 ★★★ 「锚点」从"猜"改成"人给 + 缺省建议" —— 并收掉「功能」这个词的下一层**
      *(来源：T103 实现时报实的 6 条遗留 + 我核出的 `analyze_monolith.ts` 那处**自相矛盾**。)*
      ⇒ ★★★ **最要紧的一条（它把 T100/T103 和最初的愿景接上了）**：`analyze_monolith.ts:10-13` 写着
        **「核心口径（用户愿景，见 `evolution.md` 12.X）：社区锚点是【功能/业务】，不是纯代码结构」**，
        还有一句 **「老项目没有现成锚点 → 从既存结构推导」**。
        ⇒ **这不是"起错名"，是一个未达成的愿景**（实测：它的预测力**没赢过"同一个直接父目录"**，T99）。
        ⇒ ★★ **而那句"没有现成锚点"的前提，今天已经不成立** —— **锚点可以由人给**（`overlay.global.function_tags`，T100）。
        ⇒ ⇒ **正解：锚点优先取标记；无标记处才从结构推导，且推导结果一律标注为"结构建议、不代表功能"**。
          即 **"猜"降级为"缺省建议"**，"人给"升为权威 —— 这正是 T100 存在的意义。
          ★ **不选**"改算法去真的识别功能/业务"：静态拓扑大概率做不到（T99 已给出边界），且那是另一场仗。
        ⇒ **落地**：① `analyze_monolith.ts` 的愿景段落已加**实测更正**（保留原愿景留证 + 写明未达成 + 指向本条）；
          ② 把"锚点从哪来"写成一处口径（标记优先 / 无标记才推导 / 推导结果标注来源）。
      ⇒ **同一把刀的第二刀（T103 只切了一半，这几处仍会误导）**：
        · **「功能簇」（子簇）16 处未动**，且 `cluster_narrator.ts:151`（`N 个内部功能簇`）与 `:384`（`内部功能：…`）
          **仍在把"功能"喂给 LLM** ⇒ **和 T103 修掉的那个是同一个病，只是低一层**；
        · **"积木 = 功能"的等价断言全仓未动**（`brickify.ts:4/:20`、`render_brickwork.ts:266/:492/:658/:793`、
          `brick_bag.ts`、`index.ts:223`、`brickify_cli.ts:93` …）—— 更深的病根；
        · **三层暂不一致**：`cluster_narrator.ts:36/:42` 的 `features` 类型 doc 仍写"功能清单"、`brickify_cli.ts:79/:84` 仍打印"功能 N"。
      ⇒ **`src` 之外**（未动，需逐个判）：`scripts/rebuild_feature.mjs`（**真代码路径，优先看**）、`README.md`、`docs/*.md`。
        ★ `docs/glossary.md` **不许整体重生成**（非纯生成）。
      ⇒ **判据**：① `grep "功能" ` 在**拓扑分组**语境下**没有残留**（逐处判定，留"≠功能"的澄清句可以）；
        ② **喂给 LLM 的每一处都不再把分组断言为"功能"**（贴提示词原文 —— 这是本质判据，因为**它会写出通顺的假叙述**）；
        ③ **不改行为**：`brickify` 产出结构与字段名逐字不变；
        ④ **锚点口径住在**一处（标记优先 / 无标记才推导 / 标注来源）。
      ⇒ ★★★ **2026-10-09 落地（已提交）**：第一刀（"功能社区/功能模块"→**结构簇** + `cluster_narrator.ts:389` 提示词）
        **+ 第二刀（"积木=功能" / "功能簇"→**子簇**）** 都已完成，且都过了同一条硬判据
        （**把产出的字符串叶子抹平后比结构 ⇒ `STRUCT_IDENTICAL`**，只准文案变）。
        三个术语各定一处：**结构簇** `brickify.ts:57` · **积木** `:96` · **子簇** `:68`；「功能」的定义仍在 `:110-116`，别处只引用。
        实测：`grep "功能簇\|内部功能"` = 0 · `grep "积木=功能\|积木(功能)\|功能单元\|积木层=功能层"` = 0。
        ★ 实现者**主动超出清单**修了同一病的另几处（含 `brick_bag.ts:5`、以及 `cluster_narrator.ts:205/:207/:209`
        的 **narrate system prompt** 把簇断言成"同一功能" —— 同属最有害位置）。
        ★ 遗留：`src` 之外（`scripts/*.mjs`、README、`docs/*.md`）未动 ⇒ 见 **T105** 一并处置。
- [ ] **T108 ★★★ LLM 上游 / key 池：**同一件事住了两处，名字还不一样** ⇒ 会话线从来没被配上（**已有实害**）**
      *(来源：2026-10-10 用户 —— *"你去找 DSH 里那个 AGNES 的三把 key 组成的 key 池……看它是怎么接的，你接到这个项目里。"*
        ⇒ 一查发现**早就接过，但只接了一半**。)*
      ⇒ **两处（实测，变量名不同、语义还不同）**：
        | 通路 | 读什么 | 支持池 | 默认值 |
        |---|---|---|---|
        | **翻译线** `infrastructure/authoring/translate/llm.ts:123` | **`AGNES_UPSTREAM_BASE`** + `AGNES_KEY_POOL` | ✅ | `https://apihub.agnes-ai.com`（**不含 `/v1`**） |
        | **会话线** `infrastructure/llm_focus.ts:79`（`role_title` / **刚重写的 `harvest_decisions`** 都走它） | **`AGNES_BASE_URL`** + `AGNES_API_KEY` | ❌ **只认单把 key** | `https://apihub.agnes-ai.com/v1`（**含 `/v1`**） |
        | `application/meta/llm/gateway.ts:85` | 同 `AGNES_BASE_URL` 一路 | ❌ | `agnes-2.0-flash` |
        ★★ **两个变量语义不同**：一个含 `/v1`、一个不含 ⇒ **照抄到另一个就拼错路径**。
      ⇒ ★★★ **而 DSH 的装配只给了 `AGNES_UPSTREAM_BASE`**（`~/.dsh/profiles/web/cordis.patch.yml:44-48`，注释逐字写
        「**agent-io translate(translate_go_ts) 的 LLM 池**：指向 dsh key-pool-proxy(3101)，由 dsh 的
        `AGENTSHELL_MAIN_LLM_API_KEYS` 池轮换，**agent-io 不持任何 key**」）⇒ **只覆盖了翻译线**。
        ⇒ ★★★ **会话线从来没被覆盖过** ⇒ **这就是我 `harvest_decisions` 真跑报 429 的真因**
          （走 `AGNES_BASE_URL` 那条，没人配，落到默认上游 + 免费额度）。
        ⇒ **"配上了"和"接上了"不是一回事** —— 又是「同一判据住两处」的实例，**且已有实害**。
      ⇒ **池的状态**：`127.0.0.1:3101` **现在没在跑**（`netstat` 空）；池由 **DSH 装配**拉起，
        key 存在 DSH 凭据库（`~/.dsh/.credentials.yaml` → `AGENTSHELL_MAIN_LLM_API_KEY`）⇒ **池的 key 不在本仓手里**。
        相关脚本（**dsh-brain 侧，不是本仓**）：`scripts/dsh-up.cmd` · `relaunch-switchboard.cmd` ·
        ★ `scripts/pool-key-selftest.mjs`（**现成的池自检**）。
      ⇒ ★ 代理接法（`@dsh-brain/key-pool-proxy`）：`poolEnv`(默认 `AGNES_KEY_POOL`，**逗号分隔多 key**) ·
        `upstreamBase`(默认 `https://apihub.agnes-ai.com`) · `port`(默认 3101)；
        ★★ **它主动替换 `Authorization: Bearer <所选 key>`** ⇒ **incoming 的 key 是占位也行**。
      ⇒ **要做（两个动作分开）**：
        ① **修根（正解）**：把"LLM 上游 + key 从哪来"在 agent-io 内部**收成一处**（一个 `agnesUpstream()` / `agnesKeys()`），
           **同时认** `AGNES_UPSTREAM_BASE`（外部已用）与 `AGNES_BASE_URL`（自己在用）—— **只在这一处认**，并把"含不含 `/v1`"说清。
           ★ 以外部已用的名为准（不改 DSH 的配置 = 不改别人的项目）。
        ② **配上**：让会话线也走池（`AGNES_BASE_URL=http://127.0.0.1:3101/v1`，**注意带 `/v1`**）。
        ③ **顺带**：默认模型名两处不一致（本仓写死 `agnes-2.0-flash`，现役池是 `agnes-2.5-flash`）⇒ 一并收口。
      ⇒ **判据**：① `grep -rnE "AGNES_(BASE_URL|UPSTREAM_BASE)" src` ⇒ **命中全在同一处**（那个住处）；
        ② 真跑 `harvest_decisions` **不再 429、能产出决策**（`notDetermined` 从 T106 那种状态下解除）。
      ⇒ ⚠ **前置**：池要起来（起 DSH 装配）。★ **这是本仓之外的服务，且是共享现役资源**（DSH 的预演 profile 特意用死端口隔离它）
        ⇒ 我**没有擅自起**，等用户一句。（另：预演 profile 的注释值得读 —— 它示范了"**用死端口做结构性隔离**"这种判据。）
      ⇒ ★★★ **2026-10-10 用户授权起 DSH 后的实测结论（三件，都很关键）**：
        · **① DSH 现在起不来 —— 是旧疾，不是我弄坏的**。`3080` 前门在听但**回 502**、后面**没有任何 generation 存活**；
          switchboard 日志逐字：`切换失败 (b-not-ready)` ·
          **`ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis-plugin-group'`** ·
          ★★ **`gen assembly: source=none profile=web poolPort=none patches=0 envKeys=0`** ⇒ **`poolPort=none` = 池根本没被装配**。
          `ls` 确认该包**确实缺**（`package.json` 里没有，但 **`pnpm-lock.yaml` 有 29 处命中** ⇒ **`pnpm install` 应能补上**）。
          ★ **我起了 switchboard（3080 在听、无 generation），没有动 DSH 的 node_modules。**
        · **② 那 3 把 key 找到了**（**池的 key 不在本仓手里，在这**）：
          `/d/project_develop/dsh-brain/.env` ⇒ `AGENTSHELL_MAIN_LLM_API_KEY`（**1 把**）+
          `AGENTSHELL_MAIN_LLM_API_KEYS`（**2 把**，逗号分隔）= **3 把** —— 与用户说的"三把 key"吻合。
          ★ 另有现成的 **`scripts/pool-key-selftest.mjs`**（逐 key 自检 + `--env-file` 支持）。
        · **③ 代理不能独立跑**：`@dsh-brain/key-pool-proxy` 是 **cordis 插件**
          （`private:true` / `peerDependencies: @deepseek-ai/cordis` / `export const name/Config` + `apply` 里才 `http.createServer`）
          ⇒ **必须由 DSH 装配器拉起** ⇒ **要池，就得先修 DSH**。
      ⇒ ★★★ **用户给出战略目标后，这件事的正确解法可能要反过来（重要，待拍板）**：
        用户原话：*"这个未来还是要接进 LLM 里的。你可以把 DSH 提起来没关系。
        因为最后我的希望是把它……因为那个 DSH 它的底层是 **Pi**，就是 **PI 这个工具箱**嘛，
        我希望我们这个 **AgentIO 能够替代 PI 工具箱成为它的底层工具**。"*
        ⇒ ★★ **如果 AgentIO 要当 DSH 的底座，那"key 池"就该归 AgentIO**（它是"给上层供 LLM"的能力），
          **而不是继续做 DSH 的一个插件** —— 否则底座反过来依赖上层，方向是反的。
        ⇒ **两条路（待拍板）**：
          **(甲) 短期过渡**：让步 (i) —— 修 DSH（`pnpm install` 补缺包）⇒ 池起来 ⇒ agent-io 走 `127.0.0.1:3101`。
            ★ 代价：**动另一个项目的 node_modules**（版本可能漂）；且方向仍是"底座依赖上层"。
          **(乙) 正解（合战略）**：把"池"**搬进 AgentIO**（它就是那件能力）——
            ★ 现成的原料：agent-io 的**翻译线已经在读 `AGNES_KEY_POOL`**（`translate/llm.ts` 里池逻辑已有），
              只是**会话线不支持**；把它收成一处（T108 动作①）后，池就是 agent-io 的能力。
            ⇒ 之后 **DSH 反过来指向 AgentIO**（`llm-pi-ai` 那个 provider 的 `baseURL` 指向 agent-io 的口）。
            ★ 这也正是"**替代 Pi**"的字面实现：Pi 现在干的就是"给 DSH 供 LLM 通路"这件事。
        ⇒ ★ 我倾向 **(乙)**（它才是终点），但 **(甲)** 是让 T106 那条 `notDetermined`（"产出质量未验"）
          **今天就能兑现**的最短路径。**两件不冲突**：先 (甲) 验通，再 (乙) 搬家。
      ⇒ ★ **已核实的现状**：DSH 的 `@dsh-brain/agent-io-bridge` **已存在** —— 它把 **67 个 agent-io 工具**以
        `mcp__agent-io__<name>` 命名空间注册进 DSH，并在工作区建立时自动 `import_project` 预热索引。
        ⇒ **"AgentIO 进 DSH"这条路已经通了一半**（工具面通了；LLM 通路还没通）。
- [x] **T110 ✅（2026-10-10 结项）11 处直连全部收进网关 —— 池/轮转住它内部，对外只给一个接口**
      ⇒ ★★★ **架构（选甲）**：**gateway 搬到 `src/infrastructure/llm_gateway.ts`**（它管 key 池 / 用量 / 端点，
        **全是基础设施职责**；而 `callChat` 是 **~18 个调用方共用的出网口**，`infrastructure` 不能 import `application`）。
        另把 AGNES 解析抽成叶子 `src/infrastructure/llm_agnes.ts`，**避免 `llm_focus ↔ llm_gateway` 循环**。
        依赖成一条干净 DAG：`llm_pool / llm_agnes`（叶子）→ `llm_gateway` → `llm_focus`。
        连带改引用 3 处（`serve.ts` · `application/meta/index.ts` · `llm_decider.ts`）；**旧 `application/meta/llm/gateway.ts` 已删**。
      ⇒ **11 处**全部改成 `chatViaGateway(messages, opts)`（调用方**不再拼 baseURL、不再带 key**）。
      ⇒ ★★★ **轮转（按用户口径，真跑探针 PASS）**：**复用 `llm_pool.KeyPool`，无第二份**；删掉网关自持的 `keyCursor`，
        改为**每供应商一个 KeyPool**（Map 缓存、**跨调用保留**）。实测总顺序
        **`k1 → k2 → k3 → k1 → k2 → k3 → k1`** ⇒ **顺序前进 + 转完一圈才回第一把 + 跨调用记住位置** **PASS** ——
        与用户原话（*"第一把断了下次从第二把开始……第三把断了才从第一把开始"*）**逐字相符**。
      ⇒ ★★★ **收口达成**：`grep -rn "chat/completions" src`（去注释）⇒ 只剩
        **`llm_gateway.ts:418`（网关唯一发请求处）** + **`serve.ts:3200`（对外端点路由）**；其余全为注释/描述串。
      ⇒ **验收**：`tsc` **0** · `build` 孤儿 **0** · `verify` **5/5**；
        真跑（真 key，只报指纹）：网关直连 `provider=agnes · model=agnes-2.5-flash · key_fp=054f28ff · 1158ms · usage{295,31}`；
        `harvest_decisions` 小范围 ⇒ 3 条（三要素齐备）· **未遇瞬断**。
      ⇒ ★★ **一处有意为之的行为变更（我裁定：接受）**：网关**只从 AGNES env 播种** ⇒
        只配 `DEEPSEEK_API_KEY` 或 `config.json`（**无 AGNES env**）的路径，`explain`/`dict` 会降级、`callChat` 会抛。
        ★ **接受的理由**：gateway 的自述**本来就写着**"首次启动若检测到 **AGNES** 环境变量…自动种入 agnes 供应商，
        **从'直连 env'无缝过渡到'网关统一管理'**"，且配置的权威是 **`<dataHome>/.agent-io/gateway.json`**（供应商注册）。
        ⇒ 这不是"删功能"，是**配置的家从 env 搬到 gateway.json** —— **正是网关设计好的那条路**。
        ★ 后续若要 DeepSeek：**在 `gateway.json` 里注册供应商**（无需改码）。
      ⇒ ★ 两条**未动**（合理）：`semantic_search.ts:200` 的 `/embeddings`（**不是 chat/completions**，网关无 embeddings 能力）·
        `callChat` 保留 `cfg` 形参（只当"是否配置了 LLM"判据；彻底删要改 ~18 个调用方，**保守正确**）。
      ⇒ ★ **与战略的关系**：至此 AgentIO 有了「**给上层供 LLM 通路的单一入口**」——
        `serve.ts:2791` 那个 `/v1/chat/completions` 端点就是"**替代 Pi**"要交出去的东西。**门修好了，现在真的有人走门了。**

- [x] **T110-原派单（已完成，留证）★★★ 真正的收拢：**11 处直连绕过网关** ⇒ 全部收进 Gateway**
      *(来源：2026-10-10 用户质问 —— *"不应该全收进 Gateway 里吗？**这个网关才是当时设计的收拢目标的**，
        为什么收拢到最后还有三处啊。"* + *"AGNES 不应该是上一次第一把断了、下一次就从第二把开始……
        **这个轮转应该是内部做好的，不对外；对外你只需要提供接口即可**。"）*
      ⇒ ★★★ **用户两条都对，而第二条直接指出 T108 那个是"假收口"**：
        T108 收的是「**变量解析**」（env 读点），**不是「通路」** —— 通路仍是 **8 条**。**这是"半修"家族的新成员。**
      ⇒ **gateway 的自述（逐字，它就是为收拢而生的）**：
        「小网关（薄层，可被上层网关再次接入并管理）……① 供应商注册 ② **Key 池：同一供应商多个 API Key 一个池，
          **轮询 + 失败转移** ③ 用量监视 ④ **OpenAI 兼容端点 POST `/v1/chat/completions` —— 上层网关（如 AI base）可把我当 upstream**。
          ★ 首次启动若检测到 AGNES 环境变量…自动种入 agnes 供应商，**从"直连 env"无缝过渡到"网关统一管理"**。」
        ⇒ ★ **池、轮转、失败转移、对外一个接口 —— 四件它本来就有**；而"可把我当 upstream"**就是"替代 Pi"的那个接口**。
      ⇒ **实测（`grep -rn "chat/completions" src`，去注释/描述后）—— 谁在**自己发**：
        | 文件 | 处数 |
        |---|---|
        | `application/meta/view/derive_mind_map.ts` | **4** |
        | `application/meta/view/overview.ts` | **2** |
        | `presentation/http/dict_gen.ts` | **2** |
        | `application/meta/view/explain_gen.ts` | **1** |
        | `infrastructure/authoring/translate/llm.ts` | **1** |
        | `infrastructure/llm_focus.ts`（`callChat` `:323`） | **1** |
        | **小计：6 文件 11 处绕过网关** | |
        | `application/meta/llm/gateway.ts:371`（**网关自己**）· `presentation/http/serve.ts:2791/:3200`（**网关的对外端点**） | 正当 |
        ⇒ ★★★ **"出口修好了，家里人全从窗户翻出去。"**
        ⇒ ★ 而且这**解释了"池行为不一致"**：走门的通天路有池有轮转，翻窗的 11 处**全是单把 key 直连**。
      ⇒ **要做**：
        ① **池的归属**：轮转**住 gateway 内部**（复用 T108 抽出的 `llm_pool.ts`，**别写第二份**）；
           ★ 用户口径：**round-robin 前进**（第 1 把断了 ⇒ 下次从第 2 把起；转完一圈才回第 1 把）——
           不是"同一把重试 N 次"；且**跨调用记住位置**。
        ② **11 处改成走网关**（调用方只传 messages，**不碰 key / 上游 / 池**）。
        ③ ★★ **依赖方向**：`infrastructure/llm_focus.ts` 不能 import `application/meta/llm/gateway.ts`（方向反了）
           ⇒ **gateway 应归 `infrastructure/`**（它自述"薄层"，管 key 池 / 用量 / 端点，**全是基础设施职责**）——
           但它是历史位置（且 `serve.ts` 挂了它的 HTTP 端点）⇒ **搬迁与否由实现者评估后报告，别硬搬**。
      ⇒ **验收**：① **`grep -rn "chat/completions" src --include=*.ts`（去注释）⇒ 只剩
        `gateway.ts` 的实现 + `serve.ts` 的对外端点**；② `tsc` 0 · `verify` 5/5；
        ③ **不改变各调用方的对外行为**（除"现在也走池了"）；④ **轮转按用户口径真跑验一次**（顺序前进 + 跨调用记住）。
      ⇒ ★ **与战略的关系**：这条做完，**AgentIO 就有了"给上层供 LLM 通路"的单一入口** ——
        那正是"替代 Pi"要交出去的东西（`serve.ts` 那个端点就是它）。
- [ ] **T109 ★★★ 「抽奖」机制没被兑现：`votes` 全 = 1/3 —— **抽了 3 次，只用 1 次****
      *(来源：2026-10-10 T108 落地后的真跑读数 —— `votes 53/53 全部 = 1/3`。)*
      ⇒ **现象**：小范围真跑（`comment_files`，**第 6 次重试才成功**）产出 **53 条**（comment 8 · doc 37 · gitlog 8），
        三要素齐备 —— **但 `votes` 53 条全是 `1/3`**。
      ⇒ ★★★ **根因不是"归一化不准"，是「R=3 抽奖事实上没生效」**：
        归一化**按词面**比，而三次采样**措辞微变** ⇒ 三票**永远分进三个桶** ⇒ `pickTop` 只能**任取一条**
        ⇒ ★ **多花 2/3 的钱、丢掉 2/3 的结果（召回下降），而 `votes` 字段不携带任何信息**。
        ⇒ 换句话说：**抽奖机制被实现了，但它的产出被扔了。** 这属于"**看起来做了、其实没做**"那一家。
      ⇒ ★★ **修法（三条，待拍板 —— 这是设计分叉，不是 bug 修法）**：
        · **(甲) 短语化结论**：提示词要求"结论"是**短短语**（≤12 字，如 `配置加载与校验`），
          **详细理由另放 `rationale`**（不参与归一）。⇒ 短短语的字面重合度天然高，**造票才可能**。
          ★ 代价：**改变产出的形状**（结论从一句话变短语）—— 而"结论"的形状正是用户指定的。
        · **(乙) 一次采样出多条**：不再"同一提示词调 3 次"，而是**一次调用出 N 条候选**（温度拉高 + 让它自评）。
          ★ 好处：**更便宜**（1 次调用而非 3 次），且**同一次内可比**；★ 代价：换掉了"独立采样"的语义。
        · **(丙) 取并集 + 票数当置信**：三次的结果**都留**（语义合并），`votes` 只作**置信标注**，不再 `pickTop`。
          ★ 最贴用户原话（*"多次都抽到的 = 高置信"* —— **没说"只留高置信的"**）；
          ★★ 但**前提是先能语义合并**，否则并集 = **噪声 ×3**。
      ⇒ ★ 我倾向 **(甲)+(丙)**：**结论短语化让"同一条"可识别（造票），然后取并集、票数标置信**。
        这样"抽奖"才真的在起作用（`votes>1` 的条目出现），且**召回不降**。
      ⇒ **判据**：真跑后 ⇒ **`votes` 出现 >1 的值**（证明多轮能收敛到同一条）；且**产出条数不比 R=1 时少**（召回不降）。
      ⇒ ★★★ **2026-10-10 已拍板并派出（甲 + 丙′）** —— ★ **我把"丙"修正了一处，因为原写法与既有约束冲突**：
        「取并集」会让**一个文件冒出三条**，而前面定过「**一个文件最多一条决策**」
        （那条是"天然定量"：把输出从**行数级**压到**文件数级**，**不需要任何阈值**）⇒ **冲突**。
        ⇒ **修正后的形状**：**仍然一个文件一条**，但 **分歧不许被藏起来** ——
        · **收敛**（三次归一后同一条）⇒ `votes=3`、`alternatives` 空；
        · **不收敛** ⇒ 仍只出**一条**（票最多者，稳定序破平），但把其余放进 **`alternatives`**（各带票数），`votes` 记最高票。
        ⇒ ★★ **原来的罪不是"归一化不准"，是 `pickTop` 任取一条、假装它是唯一答案** —— 修正的核心是**让不确定性可见**。
      ⇒ **三件要做**：① **结论短语化**（`why` ≤12 字、不带句号；详细理由另放 `rationale` 且**不参与归一**）；
        ② **归一化规则**（去空白 / 去标点 / 去单字连接词 `与和及的` ⇒ **完全相等才算同一条**），
           ★ **判据是它能区分"措辞抖动"与"真分歧"**：`配置加载与校验` ≈ `配置加载校验`（抖）· `配置加载` ≠ `参数校验`（真分歧）；
        ③ **保留分歧**（`alternatives`），**一文件一条**仍成立。
      ⇒ ★ **不动**：R 仍 = 3、仍是**独立采样 3 次**（用户说的"抽奖"就是这个语义 —— 不改"一次调用出多条"）。
      ⇒ ★ **已派实现**（核心验收靠**确定性探针**，不依赖真跑 —— 因为**境外链路当前断了**）。
- [ ] **T107 ★★★ 「意图 / 搬运 / 关联」三层判据 —— 用它审一遍"号称能推断意义"的老组件，判定**留 / 改角色 / 退役****
      *(来源：2026-10-10 用户 —— 在敲定"决策卡 = 人写/授权模型写 > 机器从原文**搬运/关联**"之后，说：*
        *「按照这么设计的话，这些**老东西**我感觉可能大概率是要**退役**了，你可以去**仔细查一下**。」)*
      ⇒ ★★★ **判据（可判定，不是"我觉得"）**：
        · **搬运** = 产出 ⊆ 原文（把已有的话换个地方）⇒ 检验：**多出来的字只是重排/截断/拼接**？
        · **关联** = 产出 = 从**结构**算出的关系 ⇒ 检验：**能否从图/树重算得到同一结果**？
        · **意图** = 产出里有**原文和结构里都没有的东西**（一个判断 / 一个选择 / 一个"为什么"）
          ⇒ 检验：**现场有没有 LLM 或人**？
        · ★★★ **硬判据：没有 LLM、也没有人在场的组件，不可能产生意图。若它自称意图层（"功能""意图""业务""为什么""锚点"），那就是冒充。**
        · ★ **"搬运"本身不是罪**（把注释摘出来是有用的）—— **罪在自称**。所以每一项都要同时给「**实际层**」与「**自称层**」，**差就是问题**。
      ⇒ **要审的候选**（我列的，审计员按证据增删）：`analyze_monolith`（自称"社区锚点=功能/业务"，而 T99 实测其预测力不如同父目录）·
        `brickify` 全族（`classify_bricks`/`cluster_narrator`/`signal_review`/`split_stage`/`brick_bag`/`render_brickwork`/`workbench_data`/`taxonomy`）
        —— ★ 注意**其中确有 LLM 通路**（`annotateByLlm` / `mode:'llm'|'rule'`），要分清**哪一段**有 · `harvest_decisions`（自称"提取设计意图线索"）·
        `derive_feature_tree`（自称"功能树"而策略写"目录优先"）· ★ **`role_title.generateFileRoleTitles`（逐文件问 LLM —— 可能是"意图"层唯一的正牌成员，重点核）** ·
        `meta/view/*` 与 `cli/render/*`（多为**视图** = 关联层）。
      ⇒ **每项必须给**：产出物 · **自称（引原文 + `file:line`）** · 实际层 + 依据 · **现场有没有 LLM/人** ·
        **消费者清单（按 D1 当"意义/事实"用 / D2 当视图用 / D3 只是路过 三档标）** · 判定 · ★ 若判退役则附**代价**（谁被砸到、有无替代）。
      ⇒ ★★ **"冒充"只决定该不该改；"有没有人用"决定能不能退役** —— 两件事分开判（这是 T99/T102 普查的做法）。
      ⇒ ★★ **同一条判据在仓库里会反复用**（"功能社区""积木=功能""功能树"都是它的实例）⇒ **判据只写这一处**，别处引用。
      ⇒ **本条的产出**：一页总表 + **冒充清单（按程度排序）** + **正牌成员** + **退役候选 + 代价** + `notDetermined`。
      ⇒ ★ **去留由我把关**（审计员只交证据与分层判定，不给最终决定）。★ **对应用户预期**：他判断"老东西大概率要退役"——本条就是去把这句话**变成证据**（或推翻它）。
      ⇒ ★★★ **2026-10-10 审计结果（`git diff` 复核 + 逐条带 `file:line`）—— 它推翻了半条预期**：
        **冒充只有 2 处，且都是"一句话/一个名字"，不是组件**：
        · **`analyze_monolith.ts`（高）**：自称「社区锚点是【**功能/业务**】」（`:11`），实际 = **关联**
          （调用图标签传播，**可从 cache.db 逐格重算**；T99 已复现 379 社区）。**整个文件无 LLM、无人在场**；
          所谓"语义命名"其实是标识符**后缀正则** `ROLE_SUFFIX_RE`（`:130-131`）—— **没有任何语义**。
          ★★ **而且是"半修"**：文件头 `:15-22` **已经自认"结构簇"**（T103/T104 那两刀改过），
          **但运行期输出串 `:773` 仍印"社区锚点是功能/业务"** ⇒ **改注释没改输出**，而那句**正落在 D1 路径上**（对用户说）。
        · **`derive_feature_tree.ts`（高）**：自称「项目→**功能**→社区→文件」（`:2`），实际 = **目录分组（关联）**
          —— 归并主键是 `split('/')[0]`（`:128-132`）、`fileMap` 目录优先（`:328-330`），**LLM 只改名字**（`:167`）不动结构。
          ★ 且在 `overview.ts:6` **对用户说"有哪些功能"** ⇒ 与刚统一的「**功能」只指人写的 `function_tags`** 直接冲突。
        · **`harvest_decisions.ts`（低）**：名字带"意图"，实际 = **搬运**（关键词召回 + 原文切片）。
          ★ 但**它正文自知**（自述"线索/候选"、明说不做判断）⇒ **命名偏大，不是冒充**。
      ⇒ ★★★ **正牌成员（自称 = 实际）—— 这才是本次最值钱的发现**：
        · **有 LLM 在场（意图层）**：**`role_title.ts:99`（唯一逐文件问 LLM，产出不可由原文/结构重算 ⇒ 真·意图）** ·
          `classify_bricks.ts:136` · `cluster_narrator.ts:213/:405` · `signal_review.ts:130`；
        · **有"人"在场（意图层）**：`taxonomy.ts`（**人写死 7 个架构槽位** `:41-84`）；
        · **无 LLM 但诚实自认关联**：`brickify.ts`（自称"结构块、**不代表功能边界**" `:20/:111-118`）· `brick_bag` ·
          `render_*` · `workbench_data` · `derive_anim_flow`（调用链 + CFG 可重算）。
      ⇒ ★★★ **`brickify` 同族无一处冒充**（要么自称=实际，要么**自称低于实际**——`cluster_narrator` 自称"翻译"实为 LLM 命名）。
        ⇒ **这推翻了"老东西大概率要退役"的一半**：那一族**恰恰是干净的** —— 而且干净的原因正是 T103/T104 那两刀**已经修过它**。
      ⇒ ★★ **退役候选：无"整文件级"安全目标。** `analyze_monolith` / `derive_feature_tree` **都不可整退**
        （D1 消费者在跑：`derive_feature_tree.ts:199`；`overview`（HTTP 首屏）/`derive_mind_map` 都依赖 feature_tree；
        `check_monolith` 是单文件文本近似，**替代不了跨文件社区**）。
        ⇒ **可退的是"冒充的那句话/那个名字"（零结构风险）**：`analyze_monolith.ts:773` 的输出串 + FeatureTree 的"功能"话术。
        ⇒ 与 T99/T104 的判决**一致**：聚类应**降级为提案器**，**不是删**。
      ⇒ ★ **`notDetermined`（审计员诚实报的）**：① HEAD vs 工作区口径（工作区版 `harvest_decisions` 已含 LLM，见下）；②
        ~~"独立注册工具"~~（**我已撤回，见 T102 那条**）；③ `derive_feature_tree` 的 `gen_names` 默认是否启用未跑端到端；
        ④ `classify_bricks`/`cluster_narrator` 的真实 LLM 命中率（`meta.llm_ok`）未实测；⑤ `classify_tools.ts` 不在清单内。
- [ ] **T106 ★★★ 自查验收（拿本仓当用户使一遍：「把项目文档翻译成决策记录」）⇒ **这条路是断的**，5 条缺陷**
      *(来源：2026-10-09 用户：*「你可以再自己拿自己去用验收一下……我们之前不是让你把项目文档翻译成决策记录，
        就设计 DSL 里面吗？你现在可以去试一下……**如果真的成功了，而且过程中你用得很顺手，也没有什么 bug，我们就成功了。**」*)*
      ⇒ **怎么做的**：`import_project`（本仓 200 文件 + 文档节点）→ `capability_map`（走"第一站"）→ `harvest_decisions`（`doc_dir=docs`）→ 查决策读写端。
      ⇒ ★★★ **D1（阻断级）：决策卡没有写入口。** 采集端有（`harvest_decisions`）、读端有（`get_dsl query=decisions`）、
        形状有（`DecisionCardRef{summary,rationale,status,thread,tags,history}`）——**但写端没有**：
        ★ `decisions_own` 全仓**只出现一次**（`query_feature.ts:540`），**是读端**。
        而 `harvest_decisions` 自述「**不直接写 DSL**……LLM review 后定稿（`status: active`）**再写入 DSL**」
        ⇒ **那句"再写入 DSL"没有对应的工具** ⇒ **路中间断了一节**。
      ⇒ ★★★ **D2（阻断级）：采集端的产出不可用。** 真跑读数：**954 条候选**（`gitlog 1 · doc 953 · comment 0`），
        但逐条读下去，绝大多数**不是决策**：**markdown 表格行**（`| import_nodes | 哪些节点算 import 声明 | … |`）、
        **代码注释**（`// 要 import 边才填（…）`）、**交叉引用**（`> §5.3 三条"诚实的边界"…`）、**引用块**、**半句话**。
        ⇒ **策略是"按关键词筛行"** —— 没有排序、没有去重、**没有一条"这算不算决策"的判据**。
        ⇒ 于是即使 D1 修好，写进 DSL 的也是垃圾 —— ★ 正是 **T93 同款病**（非该物混进该容器）。
      ⇒ **D3（可疑）**：`gitlog` 策略几乎不工作 —— 本仓**几百个提交**（且近期每个提交都在写"为什么"）只采到 **1** 条。
        ⇒ ⚠⚠ **2026-10-10 撤回：这条是错的，我记错了。** 真实读数：`gitlog` **65 条**（`limit:8` 时只显示 1 条 ——
          **我把"限额截断后的可见条数"当成了"策略采到的条数"**）。`gitlog` 策略**在正常工作**。
      ⇒ **D4（摩擦）**：`capability_map` 作为"**新用户第一站**"，**不指向这件事** —— 它讲链/边/61 工具/6 线，
        却没有一句"**决策卡怎么写** / 文档怎么变决策"。而 `harvest_decisions` 住在 `harvest` 线，
        **那条线的 `direct` 是空的** ⇒ **它在编排面上是隐身的**。
        ★★ 这正是 T99 普查里 `harvest: direct: []` 那条，现在有了**用例级证据**（不是"看起来该有"，是"我真的找不到"）。
      ⇒ **D5（摩擦）**：第一站开头让我"先看"的两个文件**都不存在**（`MANIFEST.txt 未生成` / `.agent-io/COGNITION.txt 未生成`）。
      ⇒ **D6（数据污染，会殃及所有读数）**：`package-lock.json` / `package.json` / `schema/*.json` / `examples/branch_test.json`
        **被当源码扫进了 `semantic.files`**（200 条里就有这些）；导入时的"单文件化预警"还把 `package-lock.json`（2166 行）报成"严重"。
        ⇒ **非源码混进了源文件容器** —— 与 T93 同族，而且它会**污染所有下游量具**（★ 含我今天跑的 T99 那个测量）。
      ⇒ **元结论**：D1+D2 是**同一件事的两半** —— **「什么算一条决策」这条判据不存在**。
        没有它，采集端只能按关键词凑数，写端也无从校验"写进来的到底是不是决策"。
        ⇒ **修法形状（待拍板）**：① 先立**一条可判定的"决策卡"判据**（例：必须有"结论 + 理由 + 影响面"三要素，
          且能指到具体实体/文件；表格行/注释/引用块按形状就不合格）；② 靠它把 954 条**筛/排序**；
          ③ 再补**唯一写入口**（`draft → active → 写入`，且走 `edit_dsl` 的原因闸）。
        ★ **不许**先补写入口 —— 那会把 954 条噪声直接灌进设计 DSL。
      ⇒ **期望**：**"文档 → 决策记录 → 设计 DSL"全程可走通，且过程中的摩擦点可枚举**；今天**不满足**（卡在 D1）。
      ⇒ ★★★ **2026-10-10 第 ① 步已做：把判据从"品味"变成"两级测量"**（全量 1022 条，不再靠抽样）：
        · **级 1 · 形状（必要，机器可判）**：排除 **表格行 `|` / 引用块 `>` / 标题 `#` / 纯列表项 / 半句话（以 `：，,（` 结尾）**
          ⇒ **1022 → 587**（砍掉 43%）。★ 现状：`harvest_decisions` **连这一刀都没做**。
          派单前注意：这一刀**还要认代码围栏** —— 实测 `// 要 import 边才填（…否则测试红）` 这种**代码注释**
          靠"含必须/否则"混过了（形状判据只匹配行首，围栏内的 `//` 漏网）。
        · **级 2 · 三要素（判断，机器判不了）**：**结论 + 理由 + 作用对象**（缺一不可）
          ⇒ **587 → 43**（占全量 4.2%）。抽出来的确实像决策：
          「★ 设计决定：相对性判断与包导入回退不下沉到公共模块。理由：`db.resolveImportTarget`」·
          「断言：① 新增命中 ⇒ 红；② `allowFiles` 里的文件必须真实存在；③ 改名完成后 frozen 应为 0」。
        ⇒ ★★ **这两级的分工正好是本仓那条主线**：**机器能判的写成判据（级 1），机器判不了的变成提案（级 2）**。
        ⇒ ★★★ **纠正我自己昨晚一句过头话**：我说"954 条里绝大多数不是决策（噪声率 90%+）"——
          那是**拿 13 个样本当全量**（我抽到的 5 例里有 4 个恰好是表头那批表格行，**样本有偏**）。
          全量实测：**形状不合格 ≈ 26%**，其余 74% 是"**未筛**"，不是"未通过"。
          ⇒ 真实病灶是「**零判别**」（什么都收、无排序、无去重），不是"九成是垃圾"。
        ⇒ **下一步（②③）**：把级 1 落进 `harvest_decisions`（机器能判的别交给人）；级 2 作为**复核判据**进"提案 → 定稿"那一步；
          **最后**才补唯一写入口（D1）。
      ⇒ ★★★ **2026-10-10 级 1 已落地**（`impossibleShapeOf(rawLine, {inFence})`，唯一住处，7 类形状逐条带"为什么不可能承载决策"的注释）：
        **总数 1025 → 630**（doc 960 → 565；**gitlog 65 未动**）；
        七类残留（表格行 / 引用块 / 标题 / 代码注释 / 围栏内 / 半句话 / 纯短列表）**逐类独立探针复算，全 0**；
        训练那句 `// 要 import 边才填（…否则测试红）` **3 次 → 0 次**。
        ★ **围栏口径是实打实踩出来的**：`docs/observe-unification.md:76` **只有一个开栅无闭栅**
          ⇒ 若按"见标记就切换"，会**误吞该文件尾部**（12 条 → 0）；改成**配对才算围栏**后恢复 6 条。**理由写进了注释。**
        ★ 文案同步改成如实的「**决策线索（candidate leads）**」（定稿那步不存在 = D1）。
      ⇒ ★★ **我的「纯列表项 67 条」这个数也是量错的**：那条正则数的是"以列表标记开头"，
        而它们**长度 12–585、带意图词** = 真内容；**真正"纯且短"的改前就已被上游 `clean.length<12` 砍光（=0）**。
        ⇒ 所以"列 200 条长列表项保留"是**对的**（要连长的也砍 = **过度杀伤**）。
      ⇒ ★★ **回答我自己的问题「怎么知道它没砍错」**：**用 `gitlog` 当正对照** —— 提交信息**本身就是决策记录**，
        于是"已知是决策"的语料现成就有。读数：**形状刀对 gitlog 65 → 65，零误杀** ✓
        ⇒ 但**诚实边界**（实现者报的）：**表格行/引用块里确有真决策被一刀切**（doc 侧），
          而那一侧**没有标尺**，所以"误杀多少"**数不出来**。
        ⇒ ⇒ **下一步就是补那把标尺**：**手标一个小样本（决策/非决策）**，再量两级的**准确率/召回**。
          ★ 这一步是为"级 2（三要素）"做准备的 —— 它要进"提案 → 定稿"，得有可量的判据才敢用它。
      ⇒ ★★★ **2026-10-10 用户裁定：上面那条"手标样本"被否，整件事改为「重写」**（原话）：
        *"还是要设计出一个可行的闸，而不是纯靠手动去踩；**把手动去踩的部分混合原先的地方一起去看，然后重新设计，然后重写**。
         标出来这个样本是什么意思，我觉得不是很需要这些东西，**每一次用实际的，比你自己去手写样本可能会更好**。"*
        *"一个项目的可维护性也建立在**补丁尽量少、原生源码尽量多**的情况下。如果你一直靠往一个规则上面打补丁和打护栏，
         那么这只能说明**这个规则本身不完善**，以及你这个护栏会**越打越多、越打越厚**，甚至可能冲突。
         只有你**不断去重写它**才是更合适的。"*
        *（另：*"LLM 现在还是适合**抽奖**。"*）*
      ⇒ ★★★ **根因（已在文件里指名到行）**：`harvest_decisions.ts:70` 自己写着
        `// 设计意图关键词（启发式，【宁多勿漏】；draft 态保证后续复核）`。
        **它判不准（本文件【没有任何 LLM 通路】，全靠关键词匹配）⇒ 于是"宁多勿漏"多收
        ⇒ 于是要靠「draft 态 + 后续复核」兜底 ⇒ 而那个"后续复核"【不存在】（D1）
        ⇒ 于是 1025 条原样交给人 ⇒ 人看到噪声 ⇒ 想再加一条形状规则 ⇒ **打护栏** ⇒ 越厚越列不全（围栏、续行…）。**
        ⇒ **护栏越打越多，是因为这个规则被要求做一件它做不到的事**：判断"这是不是一条决策"。
      ⇒ **重写方案（我的设计，按用户的流程：踩出来的 + 原先的 一起看 → 重新设计 → 重写）**：
        · **① 粒度**：从「**行**」改成「**整篇 / 整节 md**」。★ 这是关键 ——
          **"半句话"不是靠加规则解决的，它是"按行切"这个设计的必然产物**；换粒度它就不存在。
        · **② 判据形态**：从「**筛掉不合格的**」改成「**只产得出合格的**」——
          输出 schema **强制三要素**（结论 / 理由 / 作用对象，缺一不可）。
          ★★ 于是**"形状问题"从"过滤"变成"产不出"**：模型填不出三要素 ⇒ 它就不是一条决策 ⇒ 根本进不了产出。
          ⇒ **过滤器（补丁）变成接口的形状（契约）** —— 这才是"补丁尽量少、原生尽量多"。
        · **③ 抽奖（用户指定）**：**R 次采样 → 按结论归一化去重 → 记 `votes`**（置信 = votes/R）。
          ★ LLM 的随机性**不当缺陷治，当机制用**（多抽几次，取多次都抽到的）。
        · **④ 没有 LLM ⇒ 抛**（**不回落关键词**）—— 本仓铁律"不许兜底，失败就是失败"。
        · **⑤ 删干净（不留墓碑）**：`INTENT_KW` 关键词表 · `clean.length<12` 的该处用法 ·
          `impossibleShapeOf` 7 类 · `fencedLines` 围栏配对（**我昨天现场踩出来的那条**）**全部删**；
          我原打算加的"续行片段"第 8 条 —— **不加**。**五条补丁，一条不留。**
        · **⑥ 复用什么（"原生源码尽量多"）**：LLM 通路**复用本仓既有**（`bricks/classify_bricks.ts` /
          `annotateByLlm` / `toLlmCfg` 的模式），**不要另写一套**。
      ⇒ **验收（不手写样本 —— 用户明确否掉了）**：
        · **客观锚**：`gitlog` 那批（**提交信息本身就是决策记录**）—— 重写后仍必须产出决策；
        · **真实语料**：跑 `docs/` ⇒ **产出条数与"文档里真决策数"同量级**（不再是 1025），
          且**逐条能指出三要素**（读一条就能读懂，不依赖上下文）；
        · ★ **判据要换说法**：原来那条"形状残留为 0"**作废**（因为已没有"按行"这回事）⇒
          改为：**产出里不出现 markdown 片段 / 半句话 / 孤立引用**（这**不是我们的规则在挡，是它根本产不出**）。
      ⇒ ★★★ **2026-10-10 用户把「决策卡」的定义说清了 —— 而且它暴露我昨天跑错了目标**（原话）：
        *"每一个文件它**为什么要存在**这样一个决策，就等于你 git 推送的时候推送的那个**理由**而已……
         给它标定好**这一个文件是为什么存在的**……这个决策就是给 LLM 读**为什么会出现这个**的原因，也可以给人读。
         因为你在 DSL 里面，你不可能去读源文件的注释对吧，那样太繁琐，根本达不到**省**的作用，
         等于是**把注释从文件中提取出来变成决策**。而且是有**历史决策**，历史决策需要主动去翻，我们**只显示最后一次**的决策。"*
        ⇒ ★★ **决策卡 = 「这个文件为什么存在」的一句话理由，按文件挂，有历史，默认只显示最新一条。**
          它的**用途**就是**省**：在 DSL 里一眼看到"为什么会有这个文件"，不必去翻源码注释。
          载体 = **文件节点上的 `decision` 字段**（reader：`query_feature.ts:360` / `:540` 的 `decisions_own`）。
        ⇒★★★ **我昨天跑错了策略（这是本次最要紧的更正）**：用户要的是 **`comment` 策略**
          —— 而它在 `harvest_decisions.ts` 里**自述就写着**：
          `comment：显式指定源码文件，抓 JSDoc 注释块 → 【文件级候选】(ref=文件:行)`。
          **"文件级"三个字就在那儿**。我却跑了 `doc_dir=docs`（markdown 散行）⇒ 才测出 1025 条噪声、
          还把它当成了"这条路的质量"。**目标选错，量出来的当然不是那件事。**
        ⇒ ★★★ **而且 `comment` 一直是 0 —— 因为 `:314` 要求显式传 `comment_files`**：
          `if (input.comment_files?.length) candidates.push(...scanComments(input.comment_files));`
          ⇒ **不传就完全不扫**。这条策略**从来没有被默认打开过**。
        ⇒ **据此改规格（已重派）**：① **单位 = 文件**（不是 md 的节 / 行）——
          ★★ **"按行切"的整个问题类（半句话/表格行/围栏）在这个单位下自动消失**；
          ② `comment` **默认扫该 feature 已索引的源码文件**（不再要求调用方列文件）；
          ③ 三要素契约 = **结论（为什么存在）+ 出处（注释位置）+ 作用对象（该文件）**；
          ④ **有历史、默认只显示最新**；⑤ 其余（删五条护栏 / R=3 抽奖 / LLM-only 抛异常）不变。
        ⇒ ★ **复用原生**：本仓已有**逐文件批量问 LLM** 的通路 `src/infrastructure/analysis/structure/role_title.ts`
          （`generateFileRoleTitles`，batch=20 / 并发 3 / `loadLlmConfig()`）⇒ **复用它那套形状**；
          ★★ 但它 `if (!cfg) return {}` 是**静默降级**，**不许继承**（本工具没 LLM 就抛）。
          ★★★ **派单里要求先读它的提示词**，判它产出的是「**做什么**（职责）」还是「**为什么存在**（理由）」——
          **若其实是同一件事就停下来报告**（同一内容两处 = 本号病）。
      ⇒ ★★★ **2026-10-10 用户再校正（"注释"只是比喻，我按字面实现又错了一次）**（原话）：
        *"这个注释只是我给你打的比方，并不是让你直接用注释。……一个文件里面通常**不会只有一个注释**，
         而是会有**非常多**个注释。而这个决策卡的作用是展示这个文件的**生平**，就是**为什么创建**、
         因为什么而创建、**为什么被废弃**、为什么**更新被重写成什么**，每一次的这个重写都有理由，
         就像是你的 Git 一样，就是 Git 你提交的理由一样。所以**是否需要一个新的注释格式**，
         或者是什么，**外挂到文件外部**，而不是直接用注释。"*
        ⇒ **决策卡 = 「这个文件的生平」**：一条**带理由的变更时间线**（创建 / 每次重写 / 废弃），**像 git log 之于仓库**。
        ⇒ ★ **注释 ≠ 决策**：注释是**局部解释**（一个文件里很多条），生平是**整体理由**（一个文件一条时间线）。**粒度不同。**
      ⇒ ★★★ **实测（拿 `import_project.ts` 当样本，这决定"要不要外挂"）**：
        · **骨架完全可算**：**29 次提交**是它的"生平事件"数；每次都有 subject（= 理由）与日期；
        · ★★ **但理由是"提交级"的，不是"文件级"的** —— 同样 5 次提交分别改了 **9 / 2 / 6 / 5 / 4 个文件**。
          例：`4a8ae4d`「移除两个死入参」对 `import_project.ts` 的意思是"删功能线 380 行"，
          对另一个文件是"删 schema 两个字段" ⇒ **同一条理由，对不同文件是不同的意思**；
        · ★★ **"为什么创建"git 给不出**：`--follow` 追到的最初提交是 `f343cf2`「**搬迁④：tools/ → infrastructure/**」——
          那是**搬迁**的理由，不是"为什么创建"（这文件在 `tools/` 时代就存在）。
      ⇒ ⇒ **外挂的判据（"投影 vs 意图"那把老刀）**：
        · **git 算得出、且稳定的 = 投影 ⇒ 不存**（事件骨架、日期、提交级理由）；
        · **git 算不出 / 人必须改的 = 意图 ⇒ 外挂**：
          ① **「这条理由对这个文件意味着什么」**（提交动多文件时，必须按文件重述 —— ★ **这正是 LLM 该干的活**）；
          ② **"为什么创建"**（当创建发生在搬迁/引入里时，git 只给搬迁理由）；
          ③ **"为什么废弃"**（★ 文件被删后，它**在当前 git 树里已经消失** —— 只有外挂的历史还留着它）。
        ⇒ ★★ **且必须 sparse**：只有"人要改"或"git 说不清"的才落盘 ——
          **不是 450 个文件各一篇长文**，而是**差值**。否则外挂本身又变成一份要维护的副本。
      ⇒ ★ **格式：不需要"新的注释格式"**（因为它**不住源码** ⇒ 见下）；用**已有的形状**
        `DecisionCardRef.history: DecisionHistoryEntry[]`，**外挂在 `overlay`（设计侧）**，按**文件 rel** 索引，
        每条 = { 事件（git hash / 日期）· 为什么 · 来源（llm / 人）· 状态 }。
      ⇒ ★★★ **为什么必须外挂、不能住源码注释（三条理由，与规则 7 同源）**：
        ① **它是"意图"，不是"施工产物"** —— 规则 7：设计侧才住意图，实际侧只读、只对拍；把理由写进源码注释 = 把意图混进施工产物；
        ② **住源码里会被"施工"覆盖/漂移**（改代码的人不该被迫维护一段理由散文）；
        ③ **粒度不同**：注释是**局部**的（一段代码为什么这么写），生平是**整体**的（这个文件为什么存在/为什么被重写）。
      ⇒ ★★ **顺带一个可共用的机制**："**为什么废弃**"要求**文件被删后记录仍在** ⇒ 与 T100 的
        「**悬空必须报**」（功能标记的成员文件失联）**是同一个问题** ⇒ 两处应共用同一套悬空检测，不要各写一份。

- [ ] **T105 ★★★ 第三刀：「功能」的**第三层含义** —— `derive_feature_tree` 线把「目录分组」叫成了「功能」**
      *(来源：T104 第二刀实现者报的"src 之外还有一条线"，**我去现场核了，比前两刀更说明问题**。)*
      ⇒ **现场（`derive_feature_tree.ts`，逐字）**：
        · `:2` 「项目 → **功能** → 社区 → 文件」——「功能」是这棵树里"社区"的**上一层**；
        · `:10` 「本工具把社区**二次归并**成"几大功能"」；
        · `:11` 「文件 → 主导社区 → **功能** 的归属映射（`file_map`）」；
        · `:13` 「归并策略（**目录优先**，结构保真——功能树必须对得上实际项目、符合人类阅读习惯）」；
        · `:14` 「社区按"成员文件**主导目录**"聚成**功能**（domain/infrastructure/presentation/… **各成功能**）」；
        · `:17` 「LLM 只做**命名润色**（**目录分组** → 中文**功能名**）」。
      ⇒ ⇒ **它把"目录分组"重新命名为"功能"，而且是在同一句话里承认的**（`:14`/`:17` 自己写着按目录分组）。
      ⇒ ★★ **而 T99 的实测恰好说明这层分组是"最准的那个"**：
        「**同一个直接父目录**」预测共变的度匹配 lift = **3.41×**，**高于结构簇的 1.84×**。
        ⇒ **仓库里最准的一层分组，顶着一个它不该有的名字。**
      ⇒ **正解：不改算法**（按目录归并既便宜又更准，是对的）—— **只把名字改对**：
        「功能」留给**人写的标记**；这一层叫它本来的样子（例：**目录分组 / 模块组**），
        LLM 产出的是「**中文命名**」而不是「功能名」。
      ⇒ **范围**：`derive_feature_tree.ts` + `feature_map` / `mindmap` / `overview` / `capability_map` 那条线。
        ★★ **注意别误伤**：这条线里有些「功能」指的是 **DSL 的 `feature`（活文档单元）** —— 那是**另一个正当含义**，
        逐处按语义判（**判据：它指"活文档/feature"就留，指"一组文件"就改**）。**不许一刀切替换。**
      ⇒ **判据**：① 逐处判定表（每个「功能」→ 留 / 改成什么 / 依据）；② **不改行为**（同前两刀：结构 `STRUCT_IDENTICAL`）；
        ③ `tsc` 0 · `build` 孤儿 0 · `verify` 5/5；④ **`src` 之外的命中**一并处置或明确留证（`scripts/rebuild_feature.mjs`
        **是真代码路径，优先**；`docs/glossary.md` **不许整体重生成**）。
- [ ] **T103-旧写法（已作废，留证）★ 让「标记」优先于「聚类」**
      *(作废理由：见上 —— 那 4 处不在功能轴上，谈不上"谁优先"；真正的病是**同一个词两个含义**。)*

      *(来源：T99 普查的 D1 清单。★ **次序已反转**：T100 MVP 先落地，正是因为**没有可替代来源时，"提案"是个空词**。)*
      ⇒ **4 处现场**：`classify_bricks.ts:171`（建 `fileToCluster` 再算"哪个架构槽跟哪个槽有依赖"）·
        `classify_tools.ts:203`（建 `moduleIndex` 再算"这个工具由哪个簇实现"）·
        `signal_review`（`mixed_files[].clusters` 当解耦事实）· `split_stage`（吃上述簇做拆分）。
        ⇒ 四者都是「**拿聚类结果去回答一个关于代码结构的问题**」。
      ⇒ ★ **不是"重命名成提案"就算完** —— 判据是「**它可以被否定**」：**人写的标记存在时，必须以标记为准**，
        聚类结果降级为"标记缺失处的缺省建议"（并在回执里**标明这是建议、依据是什么**）。
      ⇒ ★★ **顺带记住两条已实测的边界**（别再当"危险面"喊）：
        · `split_stage` / 拆分路径**本来就有闸**：`split_stage.ts:147`/`:196` 都是 `dry_run ?? true`，工具入参 `apply` 省略即 dry-run ⇒ **默认不落盘**；
        · 聚类的预测力实测**不如"同一个直接父目录"**（T99：度匹配 lift 1.84× vs 3.41×）⇒ 它连"缺省建议"的资格都该排在同目录**之后**。
      ⇒ **判据**：① 有标记的文件，其归属**以标记为准**（聚类不覆盖它）；② 无标记处，产出里**标明来源与依据**；
        ③ 任何"真切文件"的动作**默认不落盘**（今天已满足，别退化）。


- [ ] **T98 ★ `checkStatus` 是孤儿 —— 定义了、却没有任何入口（无 import / 无注册 / 无 CLI）**
      *(来源：2026-10-09 T97 收口时 `grep -rn "checkStatus" src` 只有**定义**一处（`dsl_ops/status_tools.ts:92`）。)*
      ⇒ 后果一：T97 那条"三处共用同一消息"里，**这一处的读数只能靠直接 `require` dist 函数拿到**，**没经 MCP/CLI**。
      ⇒ 后果二：它是"**看起来存在的能力**"—— 与 `update_status`（已注册）只差一个字，很容易被当成能用。
      ⇒ **要定的事**：① **接线**（注册成工具 / 挂到某个 action 下）；还是 ② **移除**（若是被 `update_status` 取代的遗留）。
        ★ 判据：**先说清它想解决什么、而 `update_status` 解决不了** —— 说不出就按 ② 处理（本仓"同义反复不是门即删"的兄弟）。
      ⇒ ★ 关联：`grep` 时顺带值得查一遍**还有没有别的"定义了没入口"的函数**（这是可判定的：有导出、无任何调用点）。

- [ ] **T94 ★★ `glossary.md` 已落后两轮，且**不能**用生成器整体重写**
      *(来源：2026-10-09 评审。`glossary.md` 最后更新 `a2d010d`(2026-10-05)，而 `scope_files` 是 `69d3d2a`(10-09) 引入的。)*
      ⇒ 现状：词表节里 `nodes` 那行仍写「**尚无使用者**」（假的，实有 4 个产者）；`scope_files` 整条缺。
      ⇒ ★★ **纪律**：`glossary.md` **非纯生成**（它自己的 `:4-8` 警告过 `--glossary >` 会**静默冲掉**人工维护的节）
        ⇒ **只替换"## 术语表"那一节**，绝不整体重定向。
- [ ] **T95 ★★ 量具的"[B] 人群"定义，把三类真产者挡在分母外 ⇒ `scope_files` 归不到工具名**
      *(来源：2026-10-09 评审 + 量具工实测。★ **我原先记的"`capability_map` 漏登记进 `B_TOUCHED_EXEMPT`"是错的，已改**。)*
      ⇒ **查明：`capability_map` 不是漏登记，是根本进不了分母。** 人群规则 = 「`application/**` 里**导出函数名 == 文件名 camelCase**」，
        而 `capability_map.ts` 导出的是 `makeCapabilityMapHandler` / `bindToolDefs` / …，**没有** `capabilityMap`
        ⇒ **永远不成行** ⇒ 棘轮（rows 驱动）**从不向它要 `touched`** ⇒ 无需登记。
        ★ 判据区别很硬：**漏登记者会出现在 rows 里**（进分母、算真债）；它**连分母都进不去**。
      ⇒ **但同一个口径造成一个真缺口**：`get_dsl` / `consistency_check`（handler 在 `handlers.ts`，无同名导出）与
        `import_project`（在 `index.ts`，被 `base==='index'` 跳过）**也都不成行**
        ⇒ 量具**结构上无法把 `scope_files` 归到这三个工具名**。
        实测后果：**覆盖节**说 `scope_files` **3/37（文件级，含 `design/index.ts:568`）**，
        而**接力键节**说 `scope_files` **入 0 · 产 1（[B] 级）** ⇒ **同一量具两节、两把尺、互不相等**。
      ⇒ **判据**：本仓头号病是"同一口径住两处各持一份" —— 这里正是它的量具版：
        **要么统一单位（都按文件或都按 [B]），要么在输出里写明两节单位不同、不可互相印证**。
      ⇒ ★ 依赖：`rows` 的构造（`measure_b_contract.mjs` 的人群判定）。
- [ ] **T96 ★★ 量具的判据**认文本不认代码** ⇒ "注释掉的产者"照样被算作产者（假阳性方向）**
      *(来源：2026-10-09 量具工的出生证。)*
      ⇒ **读数**（注入 `query_feature.ts:778`）：**把那一行注释掉 ⇒ `scope_files` 仍报 3/37，纹丝不动**；
        **真的把该行文本删掉 ⇒ 2/37，才下降**。
      ⇒ ⇒ 它是**文本扫描**，不是"这个 [B] 真的产了这个键"。⇒ 往**假阳性**方向错（报"有产者"而实际不产）。
      ⇒ **判据**：**注释掉一个产者，读数必须下降**（今天不下降）。
      ⇒ ★ 这属于 §2.3 的「**判据恒真/装饰**」家族：**一个在"注释掉"与"没注释掉"两种状态下读数相同的指标**，
        在那个维度上不是判据。★ 但**别急着改** —— 先问它服务什么：它服务的是"**哪个 [B] 该接上锚点**"这类
        **普查/维护**用途（人读），不是"这次改动对不对"的**闸**。⇒ 若定位是普查，**写明"按文本计"**即可；
        若定位是闸，才需要真解析。**先定定位，再定改法。**
      ⇒ ★ 已退役词的使用那一节**已经**按"产物侧/入参侧"分开看（写明了理由）⇒ 那是**做得对**的一节，可当样板。
- [ ] **T69 ★★ 合并形态 S3：上限预算 —— 把 L1 扩成双边 + 配额单点**
      *(核实：2026-10-08 实测我们**只有下限**（`MIN_REASON_CHARS = 6`，见 `reason_validator.ts:73`），
       **人写文本无上限**；而 AOCI 是 `#S quota: C9-8≤600 C7-4≤200 C3-1≤50`（上限，且声明为 machine-contract）。)*
      ⇒ **形状**：`#Quota` 的数值**只住一处**；L1 从"≥N"扩成"**N≤x≤M**"（超限**拒绝写入**，不截断、不静默）。
      ⇒ **判据**：① 超上限**拒绝写入**并给出人话错误；② **把配额改一处 ⇒ 两处行为同时变**（证明只有一处）。
      ⇒ ★ 依赖 T67（配额声明住在 MANIFEST）。

- [ ] **T70 ★ 合并形态 S4：认知丢失探针（"LLM 忘了读过"）**
      *(核实：2026-10-08 实测——我们**有同一个病**（上下文一压缩，LLM 就忘了"有三个层"，本轮实证）；
       而 AOCI 有明写判据：`cognition loss measured; declare context_compaction: call aoci_overview with refresh_reasons=[…]`。)*
      ⇒ **形状**：复用既有 `snap:*` 观测，量"读一遍 `COGNITION.txt` 的字节数 vs 阈值"，超阈值即在 `capability_map` 顶部提示。
      ⇒ **判据**：**阈值内不提示、超阈值必提示**（两个状态读数**必须不同** —— 本仓 G5 的教训：
        *"一个在两种状态下读数相同的指标，不是判据，是常量"*）。
      ⇒ ★ 依赖 T68（要有那份产物才量得出大小）。

- [ ] **T71 ★★ 合并形态 S5：面上锁 —— 把 `facesOf()` 的输出记进快照**
      *(核实：2026-10-08 实测「面成员变化**没有任何东西会变红**」——我把 `import_project`/`design_intent`/`capability_map`
       加进 `LANE_META.direct`，编排面 9→12 个，而 `npm run snap:diff` **仍 6/6 全绿**
       （`tool-surface` 观测点量的是 `TOOL_DEFS` 的 61 个契约，**不含面成员**）。)*
      ⇒ ⚠ **2026-10-09「第 2 次坐实」已撤回**：我原先写「派生链 7→9、`composed` **9→13**」——
        **`composed` 是 13→13，一个名字都没变**（独立复算：`--experimental-strip-types` 直 import 源码 + `HEAD~1` 对照）。
        ★ 错因：`import_project`/`edit_dsl` **本来就在手写 `direct` 里** ⇒ 并集不会因为派生链长了而变大；
          我拿的是文档里 2026-10-06 的**陈旧读数「9」**当基线。⇒ **那次"坐实"作废（面没变 ⇒ 什么也没坐实）**。
      ⇒ ★★★ **但同一轮实测挖出一条更硬、更准的**：**给一个工具补上派生链，会让"它在不在 `direct` 里"不再可观测。**
        逐条实测（评审跑的）：
        · 把 `import_project` 从 `direct` 拿掉 ⇒ `composed` **仍是 13、名字一个不少**（它已由本轮新增的那条边供给）
          ⇒ **本来能红的判据，被"补边"这件事弄哑了**；
        · 把 14 条对象边**逐条删**、每次重算 ⇒ **只有 1 条**（`consistency_check.scope_files → edit_code.file`）
          能让 `composed` 变，**13/14 恒等**。
        ⇒ ★ 本仓 T68 那句原话正好套在它自己头上：*"**一个在两种状态下读数相同的指标，不是判据，是常量**"*
          —— `composed`（**并集**）会把两侧的变化**各自吸收掉** ⇒ **它就是那个常量**。
      ⇒ ⇒ **本条判据改为（可判定的版本）**：观测点记 **`direct` 名单本身** + **`deriveObjectChains()` 的链条数/工具集**，
        **不记 `composed`**。于是：
        ① 从 `direct` 拿掉任一名字 ⇒ 读数变 ⇒ **红**（不再被派生链吸收）；
        ② 增/删任一条 `CHAIN_EDGES` ⇒ 链条数或工具集变 ⇒ **红**（14/14 都能红，不再只有 1 条）。
      ⇒ **形状**：快照多一个观测点（`direct` 原文 + 派生链两半，**分列**）。
      ⇒ ★ 注意本仓规则：**不建门、不建 fixture、不建棘轮基线**（`todo.md` 规则 4）—— 本条是**扩观测点**，
        不是建门；**若你判它越界，就撤掉本条**。
      ⇒ ★★ 附：`snap:diff` 报"6/6 全绿"这件事**本身**也被评审查明是**空洞的** —— 那 6 个观测点
        **无一**引用 `touched`/`scope_files`/`chain_wiring`/`CHAIN_EDGES`/`import_project` ⇒
        本轮那两条新边**没有任何机器在看**（改坏它们不会有任何门变红）。







