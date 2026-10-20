# 四模型辨析：`certs/` 怎么解（2026-10-20）

> 同一问题、同一 prompt，四个模型独立作答（`Deepseek-V4.1-Flash` / `GLM-5.3-Flash` / `Space-Bunny` / `Step-5-Preview`）。
> **只读分析，都没改代码。** 下面按「共识 → 分歧 → 裁决」排。

---

## 一、四家一致同意的（4/4）

| # | 共识 | 证据 |
|---|---|---|
| 1 | **`certs/` 该拆** —— 它混了 git 语义相反的东西 | 证只增、要逐行评审；design-db 每次 gen 全量重写 |
| 2 | **证不该立卡**（豁免） | 见下"死循环"一节 |
| 3 | ★ **"路径前缀豁免"是错的** | 判据住进代码 = 本仓头号病根；且新目录要再加一行 |
| 4 | ★ **`docs/gate-principle.md` 不存在** | 四家各自独立发现；被 9~21 处引用 |
| 5 | **`design-db` 不受任务闸** | 它是投影，不是改动 |

★ 第 3 条最值钱：四个模型**都**拒绝了最便宜的那个做法（`if (rel.startsWith('certs/'))`）。
Step-5 的原话：*"目录契约腐烂时有 README + .gitignore + 目录表三处可见；而把某产品节点标成 instrument 是一次**静默的豁免扩张**。"*

---

## 二、分歧（逐条辨析）

### 分歧 1 · 「死循环」到底成不成立？

| 观点 | 谁 | 论证 |
|---|---|---|
| **不成立，是摩擦** | Deepseek | `claim` 走 `edit_dsl` 写 DSL，**不经过** `assertSourceWriteRegistered`（调用点只有 `edit_code.ts:486/939`、`rename_file.ts:526`、`rename_files.ts:140`、`symbol_move.ts:488`）⇒ "先立卡再修证"是通的 |
| **成立，是自指环** | GLM | 修证→立卡→验证立卡流程对不对→靠证 |
| **成立，而且更深** | Space-Bunny | **89/89 个 certs 节点 `decision=null`** ⇒ publish 只能立 **L1（0 条期望）** ⇒ 卡不承载判据 |
| **成立，卡在证上循环** | Step-5 | 证的完成证据只能是"证自己跑绿"，而证坏的时候跑不绿 |

**裁决：操作上不成立（Deepseek 对），但"立卡"确实无意义（Space-Bunny 对）。**

三条合起来才是完整答案：
```
claim 不受闸        ⇒ 不是死锁（Deepseek）
89/89 无 decision   ⇒ 立出来的卡是 L1、0 条期望 ⇒ 仪式（Space-Bunny）
证的证据只能是自己跑绿 ⇒ 而它坏着（Step-5）
⇒ 结论：能立，但立了没用 ⇒ 该豁免
```

### 分歧 2 · 豁免依据住哪？

| 方案 | 谁 | 形态 | 代价 |
|---|---|---|---|
| **feature 角色** | Deepseek | 证归一个 `role:'instrument'` 的 feature | 概念最准，但要动 schema + feature 语义 |
| **节点属性** | GLM / Space-Bunny | `gauge:true` / `gate:'gated'\|'exempt'` | 可逐节点标；要动 `geometry.ts` + `NODE_DATA_KEYS` 白名单 |
| **目录契约** | Step-5 | 闸内一个目录常量 | 最便宜；但"自声明会腐烂" |

**裁决：节点属性，形态取 Space-Bunny 的 `gate: 'gated' | 'exempt'`**，理由三条：

1. **判据住 DSL**（一处）—— 四家共识
2. ★ **默认 `gated`，漏标 = 抛错**（不是静默放行）—— 合"失败就抛"；反过来说，默认豁免会让**新加的产品文件**自动逃闸
3. **可逐节点标**（不用整目录一刀）

★ 但要吸收 Step-5 的警告（"静默的豁免扩张"）：
⇒ **回执必须点名**："本次写入 `certs/t354-*.mjs` 被豁免（节点 `gate=exempt`）"——**豁免必须可查，不许静默**。

### 分歧 3 · `design-db` 挪不挪？

| 观点 | 谁 |
|---|---|
| 挪到 `.agent-io/design-db/` | Deepseek |
| 挪到仓根 `design-db/` | GLM / Step-5 |
| **不挪**（收益不抵；落点已两处） | Space-Bunny |

**裁决：挪，但先收常量。** Space-Bunny 的事实是对的 —— `OUT_DIR` 现在写在**两处**（`gen_design_db.ts:83` + `scripts/gen-contracts.mjs:32`），
**不先收成一处就搬，等于用"搬目录"换来"再抄一遍"**。

### 分歧 4 · `hook-task-gate.mjs` 删还是修？

| 观点 | 谁 |
|---|---|
| **★ 必须先删**（第二闸、口径相反、且是 no-op） | Deepseek |
| **修活它**（提醒通道管量具） | Step-5 |
| 没提 | GLM / Space-Bunny |

**裁决：修活，但必须调 `collectGateCoverage`（不许自己判）。**

Deepseek 的事实链是对的（读不存在的文件 ⇒ 静默 `return done('')`；按 `x.path` 匹配而 geometry 里 0 个 `path` ⇒ 恒不命中），
但"删"会丢掉唯一一个**会话级**提醒通道。而"豁免"正需要**留痕**。

⇒ **修活 = 让它成为"量具区账外改动"的提醒器**，判据仍然只住闸里一处。

---

## 三、四家的独门发现（各自只有一个人报的）

| 谁 | 发现 | 为什么重要 |
|---|---|---|
| Deepseek | **两道闸口径相反**（`write_gate` 抛错 vs `hook` 只提醒）；`gate-principle.md` 是**两条闸共同的出处** | 原则同时以两种矛盾形态存在，而据以裁决的文件是空的 |
| GLM | **89 个 `certs/` 文件节点在 DSL 里，其中 12 个是死节点**（文件已不在盘上） | 闸的覆盖面里混着**幽灵** |
| Space-Bunny | **`certs/` 路径字面量散在 502 处**；**`.githooks/pre-commit` 只跑 `gen_agents.mjs`，不跑 verify 也不跑闸** | 拆目录的真实代价；**"写闸能拦"的覆盖面是工具面，不是仓库面** |
| Step-5 | **闸的真实覆盖面**：`design-canvas` 226 节点里 certs 89 / scripts 60 / src 30；`task-system-plan` 625 节点里只有 8 个带 path ⇒ **93% 的 src 改动今天走 `files-not-in-design` 放行** | 「改 src 要先立卡」与事实相反；**被拦得最狠的反而是 `certs/` 和 `scripts/`** |

★ Step-5 还有一句最狠的：

> **闸只拦 MCP 工具路径，bash 直写不拦**（仓内无任何配置引用 hook）
> ⇒ **"立卡"只是堵了老实走工具的人**

---

## 四、裁决（我会照这个做）

```
① 先收常量：design_db 的 OUT_DIR 收成单一导出（现在两处）
② 搬：certs/design-db/ → 仓根 design-db/（git mv 保历史，同笔删旧建新，check=true 对拍）
③ 加字段：geometry.nodes[] 加 gate: 'gated' | 'exempt'，默认 gated，漏标 = 抛
   ⇒ 166 个 certs 节点 + 60 个 scripts 节点标 exempt
   ⇒ 回执必须点名是哪条、依据是什么（不许静默）
④ 修活 hook-task-gate.mjs：改为调 collectGateCoverage，不再自己判
⑤ 补/删 gate-principle.md 的悬空引用（原则写进 GUIDE-GATE.md，引用改指它）
⑥ 顺手清幽灵：12 个指向已删目录的节点 + 3 个 .tmp-* 垃圾节点
```

**不做**：路径前缀豁免、给证立卡、分级（"哪种证豁免"的判据住哪都会变成第二份）。

---

## 五、这一轮最该记住的一句

Step-5：

> 这个仓库把「判据」守得极严（`write_gate.ts` 里连 `ok` 的 `undefined` vs `false` 都专门讨论过），
> 但**它对「判据自己住在哪」几乎不设防** —— 同一个道理可以同时住进代码注释、一个不存在的 md、
> 一份没人读的 hook，以及两条 feature 的重复文件表。

> **你今天问的「证该不该受闸」，本质是这个问题的一个投影：**
> **在你回答它之前，它已经被回答了三次，而且三次不一样。**
