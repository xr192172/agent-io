**RETIRED** —— `task-system-plan` 设计册（计划册）已退役。

# `task-system-plan` 已退役（RETIRED）

| 项 | 值 |
|---|---|
| 退役对象 | 设计册 `task-system-plan`（本目录里的那份 `.dsl.json`） |
| 归档件 | `archived/task-system-plan.dsl.json`（= 本目录那份，**逐字节未改**） |
| 归档件 sha256 | `7567f4a37af74a3d8abb292366200a9ec47415d504087e9319f2e9dff22a6491` |
| 退役时刻 | 2026-11-18（`T-#A8A9-CROSS-BOOK` **批 17**，执行席 `a8a9-b17-ds`） |
| 退役起点 HEAD | `63c9bcc1`（批 16 收口） |
| 谁退的 | `T-#A8A9-CROSS-BOOK` 批 17（跨册归属迁移的**终局**） |
| 同名 feature 登记 | **已注销**（`unregisterFeature('task-system-plan', …)`，审计行在 `.agentio-data/projects.unregister.jsonl`） |
| 域表 | `design-books.json#retired[]`（`books[]` 里**不再有**它） |

## 为什么退役（判据，不是感觉）

1. **它不再 owns 任何 path**：`design-books.json` 里 `owns: []`（批 14 收口，2 → 0）。
2. **册上有 path 的文件节点 = 0**（批 15 收口）：`structure-gate` ② 档的 `path` 分母 567 里，
   它贡献 **0**（实测：106 个节点全是 `dir_*` + 1 个 `project_*`，`path` 字段全空）。
3. **判据 = 0 条**（批 13/14 搬进属主册 `agent-io`，逐条 sha256 搬前 = 搬后）。
4. **文件级也归零**：批 1–13 把 414 个「同一 path 两册各一节点」逐批收到 0；批 15 收了 id 漂移。
5. ⇒ 留着它的**唯一**效果是让「册数」这个分母多 1、让 `get_dsl` / `judge-all` / `cognition`
   每次多读一份 437 KB 的空壳。**它是历史工作区，不是活的设计面。**

## 归档不是删除（这里存的是真资产）

⚠ **`task_plan` / `feature_tree` / `history` / `annotations` 一个字没动**（recon §4 的 untouched 表：
这三样是计划册**真正的资产**，任务板时代的记忆）。归档件的用途是：**让它们还能被点名读**。
今天仍在读这份归档件的消费者（**带出处**，不是猜）：

| 消费者 | 读的字段 | 为什么必须读归档件 |
|---|---|---|
| `scripts/run-invariant-checks.mjs` | `task_plan.invariant_checks[]` | 4 条带 `cmd` 的不变量判据**只住这里**；`npm run invariants` 的执行面就是它 |
| `scripts/design-check.mjs` | `task_plan.design_completeness.criteria[]` | D1–D10 十条「设计完整性」判据**只住这里**（两本活册的 `task_plan` 都是 undefined，实测） |
| `scripts/plan-assertions.mjs` | `task_plan.invariants[]` / `provenance` | 判据「有没有执行者」的清点器，判据典在 `task_plan` 里 |
| `scripts/vocabulary.mjs` | `task_plan.provenance.decision_card.source_kinds` · `task_plan.assertion_kinds.kinds` | 词表的**权威**就在这两处 |

## 不许做的事（一票否决，见 `docs/RETIRED.md`）

- **不许**把这本册再 `registerFeature` 回去、也不许把归档件搬回 `.agent-io/design/` 顶层
  —— 搬回去的当刻 `structure-gate` ② 档的「册数」就变回 3，而它仍 owns 0 条 path（= 空壳复活）。
- **不许**为了让某条旧断言变绿而把文件复制成两份（一份归档、一份顶层）。
- **不许**改归档件的内容。它的 sha256 被 `tests/p1_cross_book_batch17.test.ts` 钉住；
  要改 = 改这条判据，且必须在交付书里说清"改了历史记忆的哪一句、为什么"。

## 老路径怎么办

`.agent-io/design/task-system-plan.dsl.json`（退役前的位置）**自本批起不存在**。
源码里大量注释写着「设计出处：`.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.xxx`」——
那是**过往的出处引用**（说"这条实现当初按哪句话写的"），不是运行时依赖；本批**不改写**它们
（改写 300 余行注释既不增加真相、又让 diff 失去可读性），redirect 就住在本文件 + `design-books.json#retired[]`。

**新增代码不许再有新的读者**读那个旧路径：`tests/p1_cross_book_batch17.test.ts` 会逐条点名
`scripts/` 下的消费者，出现一处「还指着退役前路径」的**运行时代码**就红。
