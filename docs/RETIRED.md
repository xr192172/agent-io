# RETIRED.md — 删除台账（活文档）

> **为什么单独一份**：删干净的东西**不会自己复发**，但会被人**重新发明**。
> 台账回答的是"这做过吗、为什么砍的、当时凭什么判断"——比"它现在不在"有信息量。
>
> **与证的分工（别混）**
> · **证**（如 `t424`）防的是**意外复活**：旧分支 merge 回来、`git revert`、残留 import、批量恢复。
> · **台账**（本文件）防的是**重新发明**：有人（或模型）又想做同一个能力时，先看到"做过、砍了、因为什么"。
>
> **纪律**
> 1. 退役任何能力（工具 / 文件 / 链路 / action）⇒ 在这里记一条；
> 2. 每条必须写**判据**（凭什么判定"可以删"），不是"觉得没用了"；
> 3. 必须写**替代路径**（现在该用什么）—— 否则下一个人只会再造一遍；
> 4. 有代价就写：删掉之后**丢了什么**。

---

## 台账

| 日期 | 退役对象 | 判据（凭什么删） | 现在用什么 | 代价 / 教训 |
|---|---|---|---|---|
| 2026-10-28 | `code_workbench.ts`（代码变更提案 + `pending-changes`）· `llm_decider.ts`（唯一产者） | **无产者 + 无审阅人**：`canvas_notes` 工具 2026-10-23 已删 ⇒ 提案无处产生；`proposeChange/listChanges/approveChange/rejectChange` **零活动调用方**；工作台「代码审批」页签退役、HTTP **无** `/api/code/*`；`deprecate_offline` dry-run 判为下线候选 | 代码变更直接走 `edit_code` / `rename_files`（写闸 + 快照 + 可回滚）；"判据过就写"的范式见 `opl`（`oplIntegrate`：status=checked + 契约不自源守卫 ⇒ 直接写册，**无人审批**） | 代价：**没有"先出预览、后落盘"的两步式代码变更**了（`proposeChange` 的 dry-run 预览随之消失）。教训：我曾为这条死链写好 `applyChange`（过闸即落）再**全部撤回** —— **给空房子装门就是新脚手架**。也证明「缺审阅人」与「已经死了」是两回事 |
| 2026-10-23 | `canvas_notes` 工具（read/mark/decide）· 批注层 / 审批层（`APPROVAL_STATUSES` + approval ops） | 用户裁定：**前端只是显示屏、人不直接插手** ⇒ 批注与"基于批注的审批"整体退场 | 设计意图走 `design_intent action=set`；提案走 `observe action=proposals` + 四层自动闸 | 代价：少了"人点一下批注"的交互面。教训：**交互层退场时，挂在上面的审批流会一起变成死链** —— 这次没顺手清，导致 `code_workbench` 又活了 5 天才被发现 |
| 2026-10-22 | `design_intent action=propose`（分支） | PR 式退役，改走 publish 立卡 | `action=set` 直接写 overlay；要"先请人批再落"走 `opl` 立卡 / `observe action=proposals` | ★ **代价很大**：删分支但**没删 enum 与描述** ⇒ `action=propose` 被**当成 `set` 直接写盘**（越权），而描述里写着"propose 永不直接落盘"。5 天后才由 `t423` 抓出。教训：**退役要连 enum / 描述 / AGENTS 触发行一起改**，否则"退役"变成"改语义" |
| 2026-10-28 | `observe_log` / `observe_trace` / `observe_judge` / `observe_instrument` / `observe_proposals` 五个独立工具 | 同一生态位收敛：单入口 + `action` 分派；合并前先立**等价性基线证** | `observe`（`action=log/trace/judge/instrument/uninstrument/restore/ledger/proposals`） | 代价：单入口必须自己守住"参数传错要响亮"（`t408` 6/0），否则合并会把 5 个明确报错变成一个含糊报错 |
| （更早） | `harvest` 整条能力线（3 个工具）· `narrate_step` · `review_changes` · `behavior_baseline` | 设计侧已取代（判据 / DSL 能表达同一件事）；`review_changes` 因审批层退场而无审阅人 | 判据生态（`behavior-cases` 等）· `observe action=proposals` | 教训：**被取代的工具拆注册不拆执行核** —— 行为场景改用判据表达，别把执行核也扔了 |

---

## 待观察（还没删，但在排队）

| 对象 | 现状 | 需要什么才能下判断 |
|---|---|---|
| `emit_module_field` 等"生成类"工具（`T-#CERT-1` 里的无证工具） | 无证 ⇒ 不清楚是否还有人用 | 先补证；无证的下一步就是无消费 |
| `approve_gated.ts` 的四层门 | **现行**（`observe action=proposals` 在用），但产者在 daemon 的 `runLoop`，工具面不可达 ⇒ 本仓 0 提案 | 跑 daemon 才有事可审；若长期 0 提案，要问"这条链还需不需要存在" |
