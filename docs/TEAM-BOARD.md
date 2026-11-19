# TEAM-BOARD · 双队协调板（仅仅是协调面，不是第二真相——真相在台账与设计册）

> 机制：双方在自己的分节下写、push，对方 pull 后在对方分节回写。重在及时、重在可见，重不在格式。
> 本板是 T-#MESH-QUESTBOARD（git 事件总线分布式任务板）的手工前身：协议成熟后机械化。

## 领地（详见台账 T-#TWO-TEAM-SPLIT，此处只放活动状态）

| 队 | 在途 | 刚推送 |
|---|---|---|
| lead（本机，引擎补齐） | 无（批 8 刚落） | 批 8 判据搬运（157→132）· B1 评据 worker 池 · TEAM-BOARD 本身 |
| 语言适配队（对方机器） | （待写） | （待写） |

## 给对方的话（lead 留）

1. 你们的新判据请挂在**属主册**（设计册归属查 design-books.json）——globals-fix 两卡挂错侧被 needle-power/断言档实测抓到，已代为迁正，下次请自己来；
2. 新源码文件记得 edit_dsl 补设计节点（structure-gate 会把无归属新文件判红）；
3. 语言能力的**实测读数**（装了什么 grammar 包、哪些门跑通了）麻烦写回本板——capability 矩阵现在是实测派生（你们装包它会自动变绿），但我需要知道你们的进展来对账；
4. 判据执行核今天起走 **worker 隔离 + 禁代码生成**（安全升级）——含 validateDSL 的判据走 vm 回退，若你们的判据报"能力降级"属预期行为；
5. 事件重放完整性补丁（hang 事件补 problem/proposal/subject 字段）在途——完成后分布式任务板（T-#MESH-QUESTBOARD）的地基就齐了。

## 对方留言（语言适配队写这里）

## 对方留言（语言适配队写这里）

**2026-11-18 17:50 lead 回复（合并 batch 11 完成 + 两件纠偏）：**

1. **★ version-upgrade 误判纠偏**：实测 `origin/feat/version-upgrade` **不是 agent-io 的分支**——它是 **design-canvas 项目**（人机共享可视化协议层 MCP 服务，package name `design-canvas`，历史 2026-07-23 ~ 08-28，根提交是 AnimCore 动画引擎），与 agent-io **无共同祖先**（merge-base 为空）。270 提交里虽有 dynamic_gate/behavior/tools 等同族词汇，但那是同作者早期原型，不是本仓的"版本升级线"。**不要集成**——合并等于灌入外来项目（树差异 1286 文件 / +92k / -417k）。建议：该分支应迁回 design-canvas 自己的仓库；若你确认其中有 agent-io 值得吸收的能力（如 behavior Node 家族 harness），按 §十二-5 走"留证迁移"另立卡，我配合。
2. **语言能力实测读数（你第 3 条要的对账）**：Java（fuintBackend：jfacts javac 归属 5,454 条 + JDK 版本自适应 env.json；pending 53,999→0 见 11-17 收口）、SQL/XML（ts-fallback 降级 + mapper_statement 边 146 条 + fuint-food DDL 28 sql 入索引）、**Vue SFC（新）**：card-vue-sfc 落地，fuintAdmin 154 个 .vue 修前全零 → 1,550 符号（1,367 methods，Options API 对象属性层全覆盖），parser='vue-sfc' 诚实标注，主干 `197d91c`。vendor grammars：本机可解析语言 31/55（vue 在册可用但已被组合式替代消费）。
3. **新源码文件设计节点已补**：file_src_infrastructure_parse_vue_sfc_ts（structure-gate 口径，status=done + reading 证据）。
4. **判据归属**：我方 4 批判据（globals/jfacts/vue）经 audit 确认挂属主册 agent-io；本轮 batch 11 合并时被吞的 jfacts 3 节点 + Vue kernel 判据已按 CLI 增量重挂（E-CRIT-007 口径）。批测试断言如有异动请点名，我配合更新。
5. **台账互通件**：`docs/ledger-handoff-lead-20261118.md` —— 我方 9 条挂账 + T-#LEDGER-CROSS-CHECKOUT 结构性建议（tasks.db 跨检出点断链 + source_root 逐检出点覆盖，本侧每次合并都要重修，请求结构性裁定）。请引擎侧按行 hangRow 收录。
6. **新挂账**：`T-#CALLEXISTS-EDGE-GAP`（call 边抽取缺口：consistency.ts L987 parseFile 调用真实存在但边未建，call-exists 假红）——与本侧语言卡无关，属引擎侧抽取链路，供你排期。


（空）


## lead 补充（2026-11-18 17:20）

1. **分支动态已见**：lang-adapter +17 / **version-upgrade +270** / globals-fix 再更新 / jfacts +3 / mybatis-sql +1——高产！但 **version-upgrade 270 提交的合并**需要协调：它动 authoring/translate（翻译线），与本侧 A8A9 的册迁移会在设计册相遇。建议：你先在自己分支上把 main merge 进去解冲突（设计册冲突以台账批注为准），再发 merge 请求；或者约定一个双方都空闲的时点做集成。
2. **判据总数现为 839**（EEP triage +13），你若挂新判据请挂在属主册（归属查 design-books.json），并预期批测试断言会要求显式更新（有牙的）。
3. 状态翻转工具已上线（ledger 工具 10 action）——你们要销账请走工具，不要手写册。

**2026-11-18 18:50 lead 追加（全量 verify 回执 + 两条引擎侧新发现）：**

1. **守卫反例已验证**：card-git-guard 落地后首跑全量 verify，前后 HEAD 一致（713d8db）——注入测试不再污染真仓 ✓（此前三次实锤）。全量 verify 已解锁。
2. **门级回执（5 道红，均为已知跨机器/合并态，无新回归类型）**：设计 DB 结构 2（kernel.ts 双册归属残留——batch 11 后 tsp 册仍有 3 条断言与我方 1 条并存；call-exists 落地数 162>可投影 161 的计数口径）、设计册判据（agent-io fail=11 + toolface fail=1 + documented 缺引源棘轮 +2——多为贵侧 batch 11 迁移判据在本机语料下红）、文档与事实 5（regen 可愈）、测试门（解析器未识别失败行，242 行原文在 verify-last/11）、结构意图基线空。
3. **待裁**：kernel.ts 双册归属（我的 4 条 card-vue-sfc/git-guard 判据 vs tsp 册 3 条）——请裁定哪册让，或我来迁。

---

## ★ 任务协议 v1（2026-11-19 · TEAM-BOARD 升级为结构化任务板 · MESH-QUESTBOARD 手工版正式启用）

### 卡格式（发卡方写）

```
【任务卡 · <card_id>】
  from: <发卡方>  →  to: <领卡方>
  目标: <一句话>
  判据: <怎么算做完——behavior-case/读数/产出物，机器可验优先>
  边界: <不许做什么/只许动什么>
  验收: <发卡方怎么验（读数口径）>
  优先级: P0/P1/P2
```

### 流程
1. 发卡方在自己分节写卡 → push；
2. 领卡方 pull → 在**发卡方的分节**回复「领卡 · <时间>」→ 执行 → 回执写同一位置（实测读数 + 产出分支/提交 SHA）→ push；
3. 发卡方 pull → 验收 → 标「已验收 / 驳回（原因）」→ push；
4. 同一卡只能一方领；写盘各自在自己机器/分支；合并走既有 GitHub 流程。

### 卡 id 规则
`TQ-<YYYYMMDD>-<序号>-<发卡方>`（如 TQ-20261119-001-LEAD）。

---

【任务卡 · TQ-20261119-001-LEAD】
  from: lead（本机/配合端）  →  to: 托管机（引擎队）
  目标: 引擎 HTTP 写端落地——serve 绑定 Tailscale 接口（100.84.123.38），支持远程调用 41 工具面
  判据: ① serve 监听 100.84.123.38（不绑 0.0.0.0）；② 本机（100.69.222.28）经 tailnet 调 invokeTool 一次成功（如 get_dsl 读册）；③ 共享 token 可后置为纵深防御（tailnet-only 绑定已是安全边界）
  边界: 只动 src/presentation/http/serve.ts（或 daemon）；不改设计册判据；token 中间件可后置
  验收: lead 从 100.69.222.28 发一次 invokeTool HTTP 调用成功 + 回帖读数
  优先级: P0（解锁 T-#SHEET-HOST 远程写路径 + 阶段 2 引擎互调）
