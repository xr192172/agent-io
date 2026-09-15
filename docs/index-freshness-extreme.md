# 索引层做到极致：**不撒谎**是唯一目标

> 2026-09-14 ｜ 用户问题（原话）：
> 「把这一方面做到极致吧，把这个所有的痛点难点。……这个前面的自动化的、解析整个项目的这部分，
> **目标是为了让 LLM 使用良好**。你觉得怎样做能做到极致？」
>
> 本文回答三件事：① 什么叫"极致"（可验收的定义）② 痛点全清单与解法分层 ③ 还差什么。

---

## 0. 一句话不变量（整个索引层只服务它）

> **任何时刻，LLM 通过工具读到的索引内容，要么与磁盘一致，要么明确标注它可能旧/不全。**

换成人的话：**绝不撒谎**。

为什么这是"让 LLM 使用良好"的**充分必要**核心 —— 索引的价值 100% 来自"LLM 敢用它"。
而信任是非线性的：**一次静默的旧数据就足以摧毁它**。因为 LLM 不会怀疑工具的输出，
它会拿旧索引去做下一轮编辑决策（改错文件、覆盖别人的改动、给已经不存在的符号写补丁）。

所以"极致"不是"更快/更全"，而是：**把"读到错东西却不知道"这件事的概率压到零**。

两个必须区分的失败模式：

| 失败模式 | 表现 | 危险度 |
|---|---|---|
| **报错 / 说不知道** | 工具明确说"没索引""不确定" | 低 —— LLM 会换策略 |
| **静默给旧答案** | 工具自信地返回 102 条引用，而那个符号已改名 | **高** —— LLM 无从察觉 |

一切设计都优先消灭第二种。

---

## 1. 六层保障（从便宜到贵，前一层失效才用后一层）

| 层 | 机制 | 覆盖谁 | 本层代价 | 状态 |
|---|---|---|---|---|
| **L0 首次接触建索引** | `registerAllTools` 唯一入口：带 `project_root` 的调用若该项目**还没有索引** ⇒ 顺手 `scheduleBackfill`（后台分小批、不阻塞本次调用）+ **诚实标注**"在建 ⇒ 结果可能不全" | **建索引的起点**：从"第一次读"提前到"第一次任何调用"（"工作区创建"没有钩子，这就是能拿到的最早信号） | 本次调用 0 阻塞（后台跑）；标注一行 | ✅ 2026-09-15 落地（kill-switch `DC_AUTO_BACKFILL=0`；幻觉路径不建库；`noAutoFresh` 工具不触发） |
| **L1a 写穿** | `write_gate.writeSourceFiles()`：写前快照 → 真写 → `syncFile` + `reopenRefsTo` + scoped resolve | **我们自己改的**（async 工具） | 185ms/次（实测，单文件改名） | ✅ 已落地（`rename_symbols` 已接） |
| **L1b 自写登记** | `write_gate.recordSelfWrite()` 落 `.design-canvas/self-writes.json`；读路径**优先消费** | **我们自己改的**（**同步签名**工具，await 不了异步 `syncFile`） | 写 ~0ms，读时一次性 | ✅ 已落地（`remove_dead_imports` 已接） |
| **L2 watch** | `watch_project.flushBatch`：fs.watch + debounce + 增量 resolve | **别人改的**（git pull / 编辑器 / 另一个 agent） | 单批 ~100ms | ✅ 已落地（含拼图边界闸 `scopeToIndex`） |
| **L3 读前自证**（两条路） | ① **自动保鲜**：`registerAllTools` 唯一入口，调 handler 前若 `hasLiveIndex` 且**后台续建没在建**（`isIndexIncomplete`）就 `ensureProjectIndex({bootstrap:false})`（**精确**；在建时跳过 —— 后台循环本来就在持续同步，逐调用保鲜只会重复全盘走查 + 触发 `MAX_ADDS_PER_REFRESH` 噪音）<br>② **通用陈旧告警** `staleIndexWarning()`：注入**每一个**工具响应（**保守、同步、只 stat**） | ① **全部 60 个工具**（结构保证，新增工具不用记得）<br>② 同左，兜底标注 | ① ready 态 ~35ms/次<br>② 抽 ≤400 次 stat，5s 缓存 | ✅ 两条都落地 |
| **L4 全量兜底** | `reconcileProject`：低频扫盘 | 目录级删除等 L2 看不见的 | O(文件数) stat | ✅ 已落地 |

**L3 的②为什么是"结构性"的**：此前保鲜靠**每个工具自己记得调** `ensureProjectIndex` ——
实测 60 个工具里**有 17 个**直接开 cache.db 却没有任何保鲜入口。逐个补下次加工具还会漏，
所以改成在**响应注入层**兜一次（跟既有的 `staleBuildWarning` / `staleSourceWarning` 同一套做法：
缓存 + 只在状态转变时报一次）。**它只负责"标注"，不负责"修复"** —— 修复让 LLM 去调
`index_integrity({refresh:true})`，响应里直接给了这个可执行下一步。

**分工原则**：*"我们自己写的我们最清楚"* → 走 L1（零延迟、零遗漏）；
*"别人写的只能猜"* → 走 L2（有空窗、会丢事件）；*两者都漏* → L3 每次读都自证。

> 用户直觉（2026-09-14）：「通过了我们这个工具修改了以后的……能不能**监视这些工具**？
> 改了的部分才是改了，就不需要说后台那样做。」
> **判断：方向正确，而且比 fs.watch 更强。** fs.watch 是**猜**（debounce 空窗 + 丢事件 +
> 目录级删除只发一次）；而我们的工具写文件时**本来就知道自己写了哪些**。
> 代价也不高（实测 185ms/次，与改动大小成正比）。

**L3②的诚实边界**（别把它当成"保证"）：

- 有 **5s 探测缓存**（与既有约定一致）⇒ 刚发生的改动最多 5s 内可能还没被标注到。
  它是**标注**而非闸门；真正的保证在 L1a 与 L3①。
- 只比 `size` + `mtime`（毫秒取整）⇒ **等长改写落在同一毫秒**会漏判。要兜住得比内容 hash，
  那是 `syncFile`（异步）的职责 —— 这也是"标注"与"修复"必须分层的原因。

---

## 2. 实测：同一个改动，两个世界（`probe-dc-write-through.mjs`）

靶子：把 `storage.ts#getDSL`（**基线 102 条入边**）改名。三列都是**改完立刻**测的：

| 路径 | ① 未保鲜文件 | ② 旧名入边（= find_references 会给的答案） | ③ 陈旧断言 | 耗时 |
|---|---|---|---|---|
| **A 经写入闸** | **0** | **0** | 0 | 185ms |
| **B 绕过闸直接写盘** | 1 | **102** ❌ | 0 | ~0ms |
| B + L3 读路径保鲜 | 0 | 0 | 0 | 172ms |

**B 的第二列就是"静默撒谎"的样子**：磁盘上 `getDSL` 已经不存在了，但 LLM 问
`find_references("getDSL")` 会拿到"102 处引用"——它会去改一个已经不存在的名字。
注意 B 的 ③（陈旧断言）是 0：因为索引**还没重同步**，旧节点还在，旧引用"连得上"。
所以两件事不能混：

| 指标 | 含义 | 何时出现 |
|---|---|---|
| `not_fresh`（未保鲜文件） | 索引**落后于磁盘** | 任何旁路写、外部改动 |
| `stale_resolved`（陈旧断言） | 索引**自己内部**不一致（声称连上、目标已没） | 重同步删了旧节点但**忘了重开引用**（见 `probe-dc-watch-refresh.mjs`：旧全量口径 0→100） |

---

## 3. 痛点全清单（诚实版）

> 口径：`src/` 下 **47 个文件**会写盘（多数写的是报告/DSL/HTML 产物，不是源码）；
> 其中改**源码**的核心工具 8 个。**17 个工具**直接开 cache.db 却**没有任何保鲜入口**。

| # | 痛点 | 表现（对 LLM 的伤害） | 解法 | 状态 |
|---|---|---|---|---|
| P1 | 读不到：先让我 `import_project` | 第一步就劝退 | 零前置冷启（有界 2000 文件 + 诚实 `truncated`） | ✅ |
| P2 | 读得慢：首查等 12s | LLM 会放弃或超时 | 拼图首读（1.0s）+ 后台续建 | ✅ |
| P3 | **读到旧数据** | 拿旧图做编辑决策 | L0/L1a/L1b/L2/L3①②/L4 六层（本文） | ✅ |
| P4 | 读到一半却不说 | 以为完整，结论偏 | `partial`/`stopReason`/`outOfScope` 诚实标注 + `index_integrity` 自检 | ✅ 标注；🟡 "顺着边界再长"未做（§4） |
| P5 | 不知道自己不知道 | 幻觉选工具 | `capability_map`（由注册表派生，60/60 归线） | ✅ |
| P6 | 改坏了不能退 | 不敢改 | `file_snapshot` + 写前快照（现已随 L1a 一起做） | 🟡 仅 3 个工具接快照 |
| P7 | 改完索引变旧 → 下一次读又是旧数据 | P3 的回环 | L1a 写穿 + 返回 `indexWriteThrough` 让 LLM 知道 | ✅ 核心已通 |
| P8 | 成本不可预期 | 不敢在热路径调 | 时长上限 `maxMs` + 报告里都给 `ms` | ✅ |
| P9 | 多窗口/多进程互相踩 | 索引/快照互相覆盖 | 自写登记用原子 rename；`stale…` 自检可发现 | 🟡 无锁，靠"读前自证"兜 |
| P10 | 某些语言只解析出部分结构 | 把"解析不到"当成"不存在" | 需**按语言的解析能力自述** + 降级说明 | ✅ parse_capability（2026-09-15） |

**当前最大的洞（已补一半）**：原本 **17 个读工具直接开库、不保鲜**（`diff_impact`、`function_outline`、
`overview`、`query_feature`、`analyze_monolith`、`extract_contracts`、`language_concepts`、
`harvest_closure`、`derive_*` 等）。其中 `diff_impact`（算"这次改动影响哪里"）最危险 ——
它给的是**行动建议**，读旧图会直接导致改错。

> ✅ 2026-09-14：已用 **L3② 通用陈旧告警**兜住（注入到每个工具响应，不再是"逐个补"）。
> 但那是**标注**（LLM 会看到"结果可能基于旧图"），不是**精确**：
> 精确仍需要工具自己走 `ensureProjectIndex`。下一步见 §5.1。

---

## 4. 两个用户问过的概念（定义）

### 4.1 `scopeToIndex`（拼图边界闸）

`files` 表里**已收录的路径集合**就是"已建拼图"的**边界**（`index_freshness.indexedRelativeSet`，
`files.path` 是主键 ⇒ O(1)）。

`scopeToIndex: true` 时，watch 只处理**边界内**的文件事件；界外事件计入
`WatchBatchSummary.outOfScope` **如实上报（不静默丢弃）**。

- 为什么可开：避免一次 `git checkout` 把未索引区全量拉进索引（拼图的意义就是**懒**）。
- 为什么**默认关**：`serve` 重建实际 DSL 需要"新文件必须追进来"，收窄会静默少文件。
- 特例：**索引为空**时自动退回全处理 —— 否则「零前置 + watch」会什么都不做。
- ★ **拍板（2026-09-15，L0 落地后）**：MCP `watch_project` 的 `scope_to_index` **默认关（= 展开，
  watch 管整个项目），维持现状不改代码**。理由：① 显式起 watch = 明确意图"给我盯住"，
  LLM 接下来的读都默认可信，收窄会让界外事件出现"要等后台续建/reconcile 才追上"的时间窗；
  ② L0 之后"保护拼图惰性"的理由消失 —— 反正整个项目马上会被后台补齐，"git checkout 把
  未索引区拉进索引"本来就不再是需要防的事；③ 收窄的真实收益只剩"超大仓库 + 只关心一块"，
  保留参数当 opt-in 即可。

一句话：**它是"watch 要不要只对已建拼图负责"的开关**，不是"索引要不要建"的开关。

### 4.2 "边界扩展"到底是什么

拼图是"种子 + N 跳"长出来的一块。块与块之间会留**两种裂缝**，"边界扩展"就是缝它：

1. **新文件落在边界上**。种子周围原本没有 `src/new.ts`，后来出现了。它不在任何已建块里 ⇒
   既不在索引里、也不在 watch 的"已索引区"里 ⇒ **没人管它**，直到某次有人以它为种子读。
   *扩展 = 把它并入相邻块*（信号：它的目录里有已索引的兄弟，或它被已索引文件 import）。
2. **上次扩展被预算截停**。种子 S 的 2 跳闭包撞到 `maxFiles/maxMs` 就停了，被停下的那批是
   `noExpand` 终点。如果 LLM 接着问终点里的符号，**应该从那个终点继续长**，而不是从头再来。

⇒ **"边界扩展" = 让拼图能长大，而不是每次重新长。** 它是「按需及时建立」与「后台续建」之间的桥。
当前靠后台续建 / reconcile 兜（新文件最终会被索引），但**"并入相邻块 + 从终点续长"这个动作还没做**。

---

## 5. 还差的（按性价比排序）

1. ~~**把"标注"升级成"精确"**~~ ✅ 2026-09-15 已落地（L3① 自动保鲜）：`registerAllTools` 唯一入口
   `hasLiveIndex ⇒ ensureProjectIndex({bootstrap:false})`，覆盖全部 60 个工具，ready 态 ~35ms/次。
   逃生口 `ToolDef.noAutoFresh`（`index_integrity` / `import_project` 用）。
2. ~~**把可信度接进关键工具的输出**~~ ✅ 2026-09-15 已落地：`ToolDef.trustAnnotated` 标在
   `find_references` / `impact_analysis` / `rename_symbols` / `rename_files` 四个"结论会被拿去行动"的
   工具上，响应自动附 `⚠️ TRUST：N 条陈旧断言（resolved 但目标符号已不在索引）⇒ 结论可能静默漏报`
   + 可执行修复（`index_integrity({refresh:true})`）。与 `staleIndexWarning` 分工：后者管"索引落后于磁盘"
   （stat 可见），本附注管"索引自身内部不一致"（保鲜路径看不见，唯一线索是那批行本身）。
   **刻意不设缓存**：rename_symbols 自己会修陈旧引用，缓存会让附注在修完后还报旧数 —— 宁可每次
   一次纯 SQL 计数（毫秒级），也不要"过期的诚实"。测试：`tests/server_registry.trust_note.test.ts`（5 项）。
3. **边界扩展**（§4.2）：`noExpand` 终点复用 + 新文件并入相邻块（需要持久化拼图边界，设计级改动）。
4. ~~**能力自述**（P10）~~：✅ 已落地（2026-09-15）—— 新模块 `src/tools/parse_capability.ts`：
   按语言三档自述（`call` = LANG_ADAPTERS 有 callNode 的深解析（ts/tsx/js/jsx/go/python/java/rust/c#/
   c/php，能出调用+import 边）；`symbol` = 注册了 symbol_nodes 但无 call 适配器（cpp/kotlin/ruby…）；
   `none` = 解析器未安装/不在支持列表）。`find_references`（3 种模式）/ `impact_analysis` 结果自动附
   "解析粒度"注（非 call 档 ⇒ "零引用/零波及不可全信"）；`index_integrity` 自述 `语言能力自述` 行
   （按档分组计数）。核心不变量：**没有这些边的语言，"零波及"是解析器能力的极限，不是事实**。
   测试：`tests/tools/parse_capability.test.ts`（9 项，含 impact_analysis/index_integrity 集成）。
5. ~~**同步工具的写穿**~~ ✅ 2026-09-15 已落地（⑤ 同步工具直连 L1a）：
   实测 L1a 链路里**唯一的 await** 是 `syncFile → parseFileFull → getParser`（动态 import 语言包）；
   解析本体（parseContent + traverseAndExtract*）与 SQLite 写入**全部同步**。⇒ 三步拆开：
   ① `prewarmKernel()`（`registerAllTools` 开头 fire-and-forget）把全部已装语言包 × 全部扩展名的
   Parser 预热进缓存；② kernel 增加只读缓存的同步孪生 `parseFileFullSync` / `getParserSync` /
   `parserReadyForFile` / `canParseFileSync`（**绝不同步 import**：未命中返回 error，不硬等）；
   ③ symbols.ts 把 syncFile 拆成 `syncFilePrelude`（读盘+hash 短路）+ `applyParsedToIndex`
   （落库主体，两条路径共用一份 ⇒ 不会漂移）+ 薄封装 `syncFileSync`（sync）。
   write_gate 增加 `syncSelfWritesSync`（与 async 版共用 `finishWriteThrough`，②③④ 口径一致），
   带**预热闸：绝不半同步**——本批任何一个存在文件的扩展名 Parser 未预热 ⇒ 整批落回 L1b
   （`recordSelfWrite` + `mode:'deferred'`），绝不出现"一半同步一半没同步"的批次；
   要删的文件（磁盘已不存在）与不支持的扩展名不需要解析器，不受闸影响。
   收编两个同步签名工具：`remove_dead_imports`（两处：写后尝试 `syncSelfWritesSync`，
   `idxSync ?? idxPre` 优先取同步结果；idxPre 登记保留为兜底，按 hash 幂等无害）、
   `scaffold`（`inRoot` 提到写循环外，INVARIANTS 落盘后尝试同步写穿，成功 ⇒ indexNote
   升级为"同步写穿"，失败/未预热 ⇒ 保持"已登记"）。测试：`write_gate_adoption.test.ts`
   新增 3 项（⑦ 未预热 ⇒ deferred+登记；⑥ prewarm ⇒ synced + 引用方重开重解析 + 再写穿
   全 skipped；remove_dead_imports 组合 synced 且 files.hash 已更新），共 8 项。
   残余（已知、可接受）：进程内极早期（预热完成前）的同步写入仍走 L1b，读路径会兜；
   大小写非常规扩展名（如 `.TS`）缓存键不命中 ⇒ 同样落 L1b。
6. ~~**写入闸的覆盖面**~~：✅ 全部收编完成（2026-09-15）——
   `edit_code` / `rename_file` / `symbol_move` 接 `reopenAndResolveAfterWrite`；
   `refactor_pipeline` 在每步**终态**（applied 或回滚后）跑一次 `syncSelfWrites`
   （文件集 = 内容改写 ∪ 移动 from/to；回滚分支按 hash 判 skipped 零成本；异常 → `recordSelfWrite`
   L1b 兜底；结果附 `index_note`）；`scaffold` 同步签名走 L1b（`snapshotAndRecordSelfWrite`，
   新增 `project_dir` 入参，生成物在根外/无索引安静跳过）；
   `code_workbench` **无需接闸**（真实写入全委托给已闸的 editCode/renameFile；DSL/提案 store
   非源码）。测试：`tests/tools/write_gate_adoption.test.ts`（5 项）。
7. ~~**`harvest_from_url` 的 git clone 路径格式**~~ ✅ 2026-09-15 已修复：
   Git for Windows 把 `file://` URL 的路径部分当 POSIX 路径（剥掉 `file://` 后剩 `/C:/...`）
   ⇒ clone 必失败。`shallowClone` 现在把 `file:///C:/foo` 先还原成 `C:/foo` 直接克隆
   （本地克隆走硬链接，`--depth` 对本就无效，本地分支不带它）；远程 URL 分支不变。
   测试 11/11 全绿（此前该项是全量套件里最后一个非环境类失败）。

---

## 6. 验收（怎么证明"极致"而不是自说自话）

| 判据 | 工具 | 通过线 |
|---|---|---|
| 写穿生效 | `probe-dc-write-through.mjs` | 经闸后 ①未保鲜 ②旧名入边 ③陈旧断言 **全 0** |
| 引用方不漏 | `probe-dc-watch-refresh.mjs` | 增量口径陈旧断言 **0**（旧全量口径 0→100） |
| 可信度可自检 | `index_integrity` | 人为制造陈旧断言 ⇒ `trustworthy=false`；`refresh:true` 后归零 |
| 陈旧告警注入可见 | `tests/server_registry.stale_index_warning.test.ts`（7 项） | 静默/报一次/防刷屏/恢复后能重报/自写登记也计入 |
| 首次接触即建索引 | `tests/server_registry.first_contact.test.ts`（5 项） | 无索引 + 带根调用 ⇒ 后台起建 + 标注"可能不全"；30 文件后台补完；kill-switch / 幻觉路径 / noAutoFresh 不触发 |
| 行动工具可信度附注 | `tests/server_registry.trust_note.test.ts`（5 项） | 4 工具带 `trustAnnotated`；健康 ⇒ 无注；陈旧断言 ⇒ TRUST 注（静默漏报 + 修复指引）；修完 ⇒ 注消失；无索引不注 |
| 写入闸行为 | `tests/tools/write_gate.test.ts`（9 项） | 无索引不建库；有索引 ⇒ `refsReopened≥1` + 快照 |
| 写闸收编（管线/骨架） | `tests/tools/write_gate_adoption.test.ts`（8 项） | 管线 applied ⇒ 索引随盘 + 引用方重开（旧名 failed）；rolled_back ⇒ 索引零扰动；纯移动 from 移除/to 入索引；scaffold 预热态同步写穿、根外不登记；⑤ 未预热 ⇒ 预热闸整批 L1b（绝不半同步），prewarm ⇒ synced 与 async 版同口径 |
| 语言能力自述（P10） | `tests/tools/parse_capability.test.ts`（9 项） | 按扩展名/语言分档；refs/impact 自动附"解析粒度"注；index_integrity 自述语言能力行 |
| 首读够快 | `probe-dc-locality.mjs --flow` | 首读 < 1.5s（现 1.0s） |
| 补齐成本 | `probe-dc-backfill-profile.mjs` | 与冷启同量级（现 13.4s vs 11.8s，298 文件） |
| 目录与注册表一致 | `capability_map` 测试 | `validateLanes` 无「未归线」 |
