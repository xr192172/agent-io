# 流程卡点清单 #1 —— 用 `task_plan.service_flow` 七步真走一遍 `task_drift`

> 本笔的目的有两个，**同等重要**：① 把 `task_drift` 的 7 红变绿；② 把「这套流程本身哪里不好用」记下来。
> 本文只写 ②。①的读数见回执与对拍。
> 权威：`docs/task-system-plan.dsl.json` 的 `task_plan.service_flow`（1024 行起）。
> 走法：**每一步都用真工具/真命令**，不"应该能过"。

**本批真活**：`docs/task-system-plan.dsl.json` 节点 `file_src_application_patrol_task_drift_ts`（158 行）
的 `decision`（164 行），7 条期望全红（`file-exists` / `call-exists`×5 / `symbol-exists` / `edge-exists`）。

---

## 步 1 · 填表

**★ 顺不顺**：`grep -n '"decision"' docs/task-system-plan.dsl.json` ⇒ 该节点 **164 行就有 `decision`**
（`summary` + `acceptance` + 7 条 `expectations`）。⇒ **不需要 L1 建构任务**，可直接 ②。

**★★ 卡在哪**：
- `decision` 在 `docs/task-system-plan.dsl.json` 里，**而 publish 只认 `features/<f>.json`**
  （`src/infrastructure/storage.ts:110` `getFeaturesDir()` · `:802` `getDSL(feature)`）。
  工具表里**没有**"把一个 `.dsl.json` 装进 feature 存储"的入口（`cli list` 只有
  `get_dsl / edit_dsl / render_design / scaffold / import_project / sync_contracts`）。
- ⇒ 我不得不**手工** `cp docs/task-system-plan.dsl.json .agent-io/features/task-system-plan.json`
  （md5 两侧一致 `f950cec2…`）。**这一步没有任何判据、没有回执、没有"装进去了"的读数。**
- 顺带：`cp` 之后 **两份副本并存**，改 `docs/` 那份不会反映到卡上 —— 这已经是"同一事实两处"。

**★★★ 希望流程怎么改**：
- 加**工具**：`edit_dsl` 增加 `op:'import_feature'`（或独立 `import_dsl {source:'docs/x.dsl.json'}`），
  做三件事：`validateDSL` → 写 `features/<f>.json` → **报 md5 + 覆盖/新建**。
- 加**字段**：`features/<f>.json` 记 `imported_from`（源文件路径 + md5），
  否则"docs 那份"与"features 那份"谁是真源，读端只能猜。

---

## 步 2 · 交表（publish）

**★ 顺不顺**：成功。
`edit_dsl{type:'task',op:'publish',id:'file_src_application_patrol_task_drift_ts'}`
⇒ `---DATA--- {"state":"candidate","summary":"live 重算后对所有非 done 的卡跑 judgeExpectations ⇒ 抓「漏收口」与「应转失效」","expectations":7,"post_expectations":7,"progress":"draft"}`。
`summary` 逐字等于 `decision.summary`（内容确实来自 decision，不是我编的）。

**★★ 卡在哪**：
- **读数被埋**：一次成功 publish 的 stdout **28 行**，`---DATA---` 在**第 22 行**，
  前面 21 行是"下一棒 / 接续 / 全称规则"教学段落（实测 `node … > /tmp/measure352.txt`）。
  机器解析要写 `grep -A1 'DATA---'`，人读要先翻半屏。
- **`NO_PROJECT_ROOT` 每次都报**：`edit_dsl` 的入参里**没有** `project_dir`
  （`src/application/design/index.ts:108` 的 `project_dir` 只属于 `query=calls/functions`）
  ⇒ 工具自己承认"未做索引保鲜 / 未做陈旧检查"。**而这正是第 7 步翻车的根**（见步 7）。
- **publish 不告诉你"卡在哪上架"**：回执只有 `touched.nodes`，没有 pool/board 的位置或 id 段。
  第 3 步要读什么、按什么键读，全靠调用方记得。

**★★★ 希望流程怎么改**：
- 改**判据**：`weight:'routine'` 下把"下一棒 / 接续"段关掉（或压成 1 行），
  读数固定为 stdout **最后一块** `---DATA---`；让 `--json` 直接给纯 JSON。
- 加**字段**：`task` op 的回执加 `pool:{feature, node_id, state, since}` —— 这就是第 3 步的入参。

---

## 步 3 · 上架（进 pool / board）

**★ 顺不顺**：**没有读端可读**。只能手工：
`node -e "…JSON.parse('.agent-io/features/task-system-plan.json')…"` ⇒
`node.status = draft`（派生）· `task.state = candidate` · 带卡节点 **1 / 5**。

**★★ 卡在哪**（★ 本步最重要的卡点）：
- **board 读端（T8）不存在**：`grep -rn "candidate" src/application` **只命中** `dsl_ops/task_ops.ts`
  （写端自己）；`cli list | grep -i board` **0 条**。⇒ `service_flow.steps[3].criteria`
  的「卡在 pool 里可见；shown + folded == total」**一条都读不出来**。
- 所谓"上架"实际只等于"`node.task.state === 'candidate'` 落进了 json"。
  **"在办 / 不在办"的可见性 = 我知不知道 feature 名 + 会不会敲 node -e。**
- 换个人（或子代理）来领：它没有入口能列出"现在有哪些卡待接取"，只能被口头告知 ->
  这正是 `board.forces` 里"未上榜单 = 不算在办"想治的病，而现在**榜单本身就是那句口头告知**。

**★★★ 希望流程怎么改**：
- 补**工具**（这是 T8）：`board {feature}` ⇒ `{shown:[{id,summary,standing,age}], folded:n, total:n}`，
  且**必须**满足 `shown + folded == total`（判据自带计数，不是渲染层的礼貌）。
- 补**跨 feature 的池**：`board {all:true}` —— 今天的 `feature` 是必填，而"待接取池"天然跨 feature。

---

## 步 4 · 接取（claim）

**★ 顺不顺**：成功。
`{"state":"claimed","owner":"agent-flowcheck-1","claimed_at":"2026-10-17T07:49:04.466Z","standing":"work","progress":"in_progress"}`。
判据是新的 `cardStanding`（`work/violated` 可领）—— 与我读到的 `standing:"work"` 一致。

**★★ 卡在哪**：
- **错误优先级会带偏排错**：我对同一张已领的卡再发一次 claim，得到的**不是**"已领/不可重复领"，
  而是 `变更原因校验未通过（L3）：原因未绑定具体实体，太泛了`（实测 `/tmp/out352.txt`）。
  ⇒ 读起来像"我 reason 写错了"，实际是"卡已 claimed"。**L3 理由闸排在状态闸前面。**
- **standing 是在陈旧索引上算的**：同一次调用带 `NO_PROJECT_ROOT`（见步 2）。
  这次"恰好对"（`file-exists` 走 `fs.existsSync`），但 `call-exists` / `edge-exists` 只认索引
  ⇒ 同类卡在真仓上会读成 `unknowable` 而**被拒领**（`isClaimable` 不含 `unknowable`）。
- claim **不落"领了要做什么"的摘要**：`TaskSpec` 里没有 `next` / `plan` 字段，
  接取者拿到的只有 `summary`（一行）+ `expectations`（判据）。"怎么做"没地方写，只能在我脑子里。

**★★★ 希望流程怎么改**：
- 改**判据**：`claim` 先判状态（已领/非候选）再判 reason 质量；或把 L3 的拒因**并列**报出。
- 加**字段**：`edit_dsl` 增 `project_dir`（可选）⇒ 让 claim/complete 能触发 `ensureFreshIndex`，
  否则"领取闸"读的是昨天的图。
- 加**字段**：`TaskSpec.next?: string`（接取时写的一句"我打算怎么做"），否则第 6 步的回执
  与第 4 步的意图之间没有可对账的东西。

---

## 步 5 · 做事（过写闸）

**★ 顺不顺**：先红后绿。
- 第 1 次 `npm run build` ⇒ `src/application/patrol/task_drift.ts(152,87): error TS2339: Property 'path' does not exist on type 'Node'`。
- 第 1 次 `npm run verify` ⇒ **1 道门失败**：`src/application/patrol/ 没在任何域里登记`。
- 补 `structure.domains.json` 一条域 + 类型改 cast 后：build ✓ · verify **4/4** ✓。

**★★ 卡在哪**：
- ★★★ **写闸对这张卡是"没看见"，不是"放行"**：
  `assertSourceWriteRegistered('.', ['src/application/patrol/task_drift.ts'])`
  ⇒ `{"applicable":false,"note":"项目根上没有设计 feature 指向它（没有任何 feature 的 source_root 指到这里）⇒ 任务闸不适用（放行）"}`。
  根因：`coveringFeatures` **只认 `node.description`**（`src/application/write_gate.ts:511`），
  而本 feature 的 5 个文件节点 **全部用 `path`、`description` 为 0** ⇒ `byPath` 空 ⇒
  `:517 if (byPath.size)` 把整条 feature 跳过。⇒ **手写 DSL（用 path）的 feature，写闸结构上失效。**
  ★ 我照流程 claim 了卡、也确实写了代码，但**闸有没有认这张卡，我无法从这条读数上证明**。
- **`Node` 类型没有 `path`**（`src/domain/geometry.ts:115-160` 只有 `description` 一类），
  而 `StandingInput` 要 `path` ⇒ 只能 `as { path?: string }` 强转。**同一维度两处形状。**
- **"造一个新模块"隐含要改第二张表**：`structure.domains.json` 是域划分的唯一数据源，
  但设计 DSL 里**没有这张卡** ⇒ 我做了一次**卡外改动**（为了让门变绿）。
  这正是流程自己说的"改源码先有卡"要防的事，而它没覆盖"登记表也算源码"。

**★★★ 希望流程怎么改**：
- 改**判据**：`coveringFeatures` 的 file→node 映射改成 `node.path ?? node.description`
  （`write_gate.ts:511`），否则写闸对"人写的 DSL"是装饰。
- 改**类型**：`Node` 增 `path?: string`（与 `semantic.files[].path` 同名同义），消掉 cast。
- 加**卡**：`structure.domains.json` 的登记本身要有一条决策卡/一条闸 —— 否则"为了让 verify 变绿"
  而改域表是一次无卡施工（本笔就发生了）。

---

## 步 6 · 交回执

**★ 顺不顺**：`node scripts/check-receipt.mjs <file>` ⇒ `✓ 五栏齐`（exit=0）。工具在、判据明确。

**★★ 卡在哪**：
- **回执没有"家"**：五栏只活在对话/文件里，**卡上没有落点**。`TaskSpec` 没有 `receipt` 字段；
  唯一吃证据的是 `complete`（`validateProgressEvidence`），但那是收口动作，不是"交回执"。
  ⇒ 下一棒要读上一棒的回执，只能翻会话记录。
- **自检只判"栏在不在"，不判读数真假**：`scripts/check-receipt.mjs` 的 `COLUMNS` 是纯正则
  （`做了什么[:：]` / `PASS=\d` / `[未核]` / `行为改变` / `滞涩报告[:：]`）。
  我写 `PASS=99` 也能过。⇒ 它防"漏写"，不防"写错"。
- 五栏里的 ③`[未核]` 与 ⑤`滞涩` **没有结构化出口**：`[未核]` 散在正文，`滞涩` 要人再抄进
  `docs/frictions.jsonl`（本笔就是手抄的）。两处文本必然漂移。

**★★★ 希望流程怎么改**：
- 加**字段**：`TaskSpec.receipt?: { what, readings, unverified[], behavior_changes[], frictions[] }`，
  由 `edit_dsl{type:'task',op:'receipt'}` 写。
- 加**工具**：`check-receipt --append-frictions` 把 ⑤ 直接落 `docs/frictions.jsonl`（带 `card_id`），
  消掉"手抄"这一步。
- 改**判据**：② 栏从"有 `PASS=\d` 字样"升级为"引用的读数必须能在同一次调用里被重跑"（可选，别一刀切）。

---

## 步 7 · 验收 + 双验

**★ 顺不顺**：**一半顺、一半走不通**。
- 同底重算 root：`cardStanding` ⇒ `satisfied`，`satisfaction {checked:7,passed:7,failed:0,unsupported:0}`。
- **真仓 root**：`cardStanding` ⇒ **`unknowable`**，`{checked:7,passed:2,unsupported:5}`
  （新文件还没进 `cache.db` ⇒ 5 条 call/edge 判不了）。
- 全量跑证（`node certs/run-all-certs.mjs --exclude t189-sweep`，16m02s）：
  **62 张 ⇒ 55 全绿 · 3 红 · 4 崩**（exit=1）。崩的 4 张**单跑全绿**
  （t191 10/0 · t316 34/0 · t348 18/0 · t349 34/0）⇒ 批次环境问题，不是实现问题。
  红的 3 张：`t350`（**本笔改出来的**，已修 → 34/0，见下）· `t197sub` 22/6 · `t198sub` 7/8
  （后两张红在 `annotation.add` 被 validateDSL 自洽闸拒；与本笔改动**无调用关系**，是否既有 **[待核]**）。

**★★ 卡在哪**：
- ★★★ **验收在真仓上走不通**：榜单若按 `board.flow[5]`"复用 judgeExpectations"直接在真仓 root 判，
  读到的是 `unknowable` ⇒ **卡永远收不了口**。要得到 `satisfied` 必须**另造一份重算 root**
  （临时目录 + 独立 `AGENT_IO_HOME` + `importProject`），而这条路径**不属于流程的任何一步**，
  是我为了拿到读数自己搭的（`certs/.work/probe352-side.mjs`）。
- **双验 = 0 行代码**：`grep -rn "双验" src/` **0 命中**。`service_flow.steps[6].window` 写的是
  「榜单 + 非做者」，但**没有 `verifier_kind`、没有"非做者"的判据**。
  ⇒ 我这次是靠"换一个 root 再算一遍 + 手工对两侧读数"自充当双验，**这一步现在完全没有强制**。
- **收口没有入口**：`board` 未建 ⇒ 没有"验收通过 ⇒ 置 done"的读端；`complete` 要
  `validateProgressEvidence`，而验收读数在真仓是 `unknowable`。⇒ 卡停在 `claimed`，
  **正好复现 `board.forces` 要治的"3 条 in_progress 挂一整天"**。
- ★★★ **"验收读数"自己会红**：`t350-publish-task-cert.mjs` 的 claim 链路从前借的是
  **真卡「漂移巡检」**（当时它红 ⇒ `work` ⇒ 可领）。本笔把那张卡做绿之后，它变 `satisfied` ⇒
  `claim` 被拒 ⇒ **证红 6 条**（`④a/④b/⑤c/⑦a/⑦b`）。
  ⇒ 这说明**证的夹具依赖了外部真实待办**：真活干完 ⇒ 证红。
  我改成**自造 work 卡**（盘上不存在的 `src/domain/t350_work_fixture.ts` + 一条 `file-exists`）
  后回到 34/0。★ 只换夹具来源，**没动任何断言**（claim 的"可领/不可领"仍由 t351 覆盖）。
- ★★ **同一批证"单跑绿、批跑崩"**：4 张崩在宿主 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`
  （`certs/t349-task-home-cert.mjs:41` 的 `rmSync` 夹具；`t348` 同因）与并发
  （`t191` / `t316` 单跑 10/0 · 34/0）。⇒ **"全量跑证"的读数不能直接当验收读数**，
  必须先区分"实现坏"与"跑法坏"。
- **判据表达力不够**：`service_flow.steps[6].criteria` 是「红变绿 + unsupported=0」——
  这是**计数等式**，而六种 expectation kind 全是存在性/依赖类
  （`file-exists / symbol-exists / signature-matches / edge-exists / edge-absent / call-exists`）。
  ⇒ **"第 7 步的判据"今天写不进任何一张决策卡**（同理 `shown+folded==total`）。
- ★★ **跑证会写真仓 `.agent-io`**：`certs/t181-reset.mjs` · `t182-cert.mjs` · `t182b` · `t183` ·
  `t184` · `t184b` · `t185` 都用 `FEATURE = 'run82'` 且 **`grep AGENT_IO_HOME` 命中 0**
  （`t182-cert.mjs` 实测 0 命中）⇒ 它们跑的是**真仓**数据。本笔全量跑证期间
  `.agent-io/features/run82.overlay.json` 被反复重写（跑到一半读到 md5 `3c7427be…` / size 89764，
  跑完**已还原**为 `f1e8a6f9…` / 89472，mtime 也回到 `2026-10-13 19:11:20`）⇒
  **"真仓 mtime + md5 逐条贴"在跑证过程中不可复现**；更要紧的是：**验收动作本身会改被验收的数据**。
  ★ 同一批证还留下了一处**没有还原**的：`.agent-io/live/t192flow.dsl.json`
  md5 `6556e130…` → `c4361e75…`（16:04:51）；对应 `features/t192flow.json` md5 未变、只有 mtime 被touch。
  ★ 同一族还有更险的一例：`t190-cert.mjs:55` 把**仓根 `agent-io.json`（活态 DSL）**写成
  `{ 这不是合法 JSON`，靠 `finally`（`certs/t190-cert.mjs:76`）还原。本笔实测：跑到它时 `agent-io.json`
  确实变成 22 字节非法 JSON（16:02），跑完后已还原且可解析（`feature=run82`）。
  ⇒ **进程若被中断/超时杀掉，真仓活态 DSL 就永久坏着**（`finally` 不会跑）。
- ★★★ **"真仓 cache.db 只读"在正常 API 路径上做不到**：判据 `file-exists` 是只读的，
  但 `call-exists` / `edge-exists` 要读索引，而读索引的入口 `getProjectCacheDb`
  （`src/infrastructure/index/db.ts:217`）走 `openDb`（`:161-186`）—— 那里有
  `fs.mkdirSync` · `PRAGMA journal_mode = WAL` · `db.exec(SCHEMA_SQL)` · 5 条 `ALTER TABLE`
  ⇒ **"读"会写库**。实测：真仓 `cache.db` mtime 由 `2026-10-17 12:53` 变为 `15:58:46`。
  ★ 具体是哪一次调用写的 **[待核]**（同一时段还有证套件在跑）；但**机制**是确定的：
  没有任何"只读连接"的分支。⇒ 同一张卡在 15:47 读 `satisfied`、在 16:05 读 `unknowable`，
  两次都没骗人，是**库在中间被换过**。

**★★★ 希望流程怎么改**：
- 加**工具**：`verify_card {feature, node_id, root?}` ⇒ 内部**自己重算**（临时 root + 独立 home），
  返回 `{verdict, satisfaction, unsupported, root_used, scan_rev}`。没有它，第 7 步只能手搭。
- 加**字段**：`TaskSpec.verifier?: {kind:'agent'|'human', id, at, independent_of_owner:boolean}`，
  且 `complete` 判 `verifier.id !== owner`（这才是"非做者"的可判形式）。
- 加**判据 kind**：`counts-equal`（`shown+folded==total`）与 `threshold`（`unsupported==0`）——
  否则 `service_flow` 的 ①②③⑦ 四条 criteria 里有一半**无法被写成 expectations**。

---

## 卡点 → 决策卡（映射）

| # | 卡点（步） | 变成哪张卡（挂哪个节点） | 加什么字段 / 改什么判据 / 补什么工具 | `source.kind` |
|---|---|---|---|---|
| F1 | `docs/*.dsl.json` 装不进 feature（步1） | `file_src_application_design_dsl_ops_task_ops_ts`（publish 侧） | **补工具** `op:'import_feature'`：validateDSL → 写 features → 报 md5；**加字段** `imported_from{path,md5}` | `friction` |
| F2 | 读数埋在 21 行教学之后（步2） | 同上 | **改判据**：`routine` 关掉"下一棒"段；`--json` 输出纯 JSON | `friction` |
| F3 | `edit_dsl` 无 `project_dir` ⇒ `NO_PROJECT_ROOT`（步2/4/7） | `file_src_application_design_dsl_ops_task_ops_ts` | **加字段** `project_dir`；claim/complete/publish 触发 `ensureFreshIndex` | `friction` |
| F4 | board/pool 读端不存在（步3） | 新节点 `board_pool`（T8） | **补工具** `board{feature,all}`；**加判据 kind** `counts-equal`（`shown+folded==total`） | `friction` |
| F5 | L3 理由闸抢在状态闸前（步4） | `task_ops` 节点 | **改判据**：先判状态、再判 reason，或并列报错 | `friction` |
| F6 | 接取没有"打算怎么做"的住处（步4） | `file_src_domain_task_schema_ts` | **加字段** `TaskSpec.next?` | `friction` |
| F7 | 写闸只认 `description`，手写 DSL 用 `path`（步5） | `write_gate` 节点 | **改判据**：`node.path ?? node.description`（`write_gate.ts:511`） | `defect` |
| F8 | `Node` 无 `path` 字段（步5） | `file_src_domain_geometry_ts` | **加字段** `Node.path?: string` | `defect` |
| F9 | 域表登记没有卡（步5） | `structure.domains.json` 对应节点（缺） | **补卡**：域表变更也要过闸 | `friction` |
| F10 | 回执没有家、自检只判"栏在不在"（步6） | `file_src_domain_task_schema_ts` | **加字段** `TaskSpec.receipt`；**补工具** `op:'receipt'` | `friction` |
| F11 | 验收在真仓 root 走不通（步7） | 新节点 `verify_card` | **补工具** `verify_card`（自建重算 root）；**加判据 kind** `threshold`（`unsupported==0`） | `friction` |
| F12 | 双验 0 行代码、无"非做者"判据（步7） | `board` 节点 | **加字段** `verifier{kind,id,independent_of_owner}`；`complete` 判 `verifier.id !== owner` | `friction` |
| F13 | 收口无入口 ⇒ 卡停在 claimed（步7） | `board` 节点 | 与 F12 同卡：`board` 读端 + `complete` 的验收读数来源 | `friction` |
| F14 | 跑证写真仓 `.agent-io`（步7） | `certs/run-all-certs.mjs` 侧（缺卡） | **改判据**：证必须显式声明 home；未声明且 touch `.agent-io` ⇒ 红。或给 `run-all-certs` 强制 `AGENT_IO_HOME=$(mktemp -d)` | `defect` |
| F15 | "cache.db 只读"做不到：读索引 = 写库（步7） | `file_src_infrastructure_index_db_ts` | **补工具**：`openDb({readOnly:true})` 分支，`judgeExpectations` 的 edge/call 查询走它；并在读数里报 `db_mode:'ro'` | `defect` |
| F16 | 证夹具借"真红卡"⇒ 真活做完证就红（步7） | `certs/t350`（缺卡） | **补夹具**：`certs/_fixtures/task.mjs` 的 `seedWork()`（自造必红卡），禁借外部真实待办 | `defect` |
| F17 | 同一批证"单跑绿、批跑崩"（步7） | `certs/run-all-certs.mjs` | **改判据**：崩（exit≠0 且无汇总）与红分开报；`SAFE_DELETE_*` 命中单独归类为"跑法坏"，不给"实现坏" | `friction` |

**判据自检**：卡点 **17 条**（≥3 ✓）。且其中 **7 条**（F1 / F4 / F11 / F12 / F14 / F15 / F16）是"流程缺一步就真走不通"，
不是"体验不好" —— 它们各自都足以让这套流程在**下一棒**卡住。
