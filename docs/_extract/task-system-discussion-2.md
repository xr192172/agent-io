# 任务系统 · 多方案讨论（第 2 场）

> 本场目标：给四条**互锁/缺口**定「可判的判据」，并判断它们该**收归成一节**还是各自打补丁。
> 权威顺序：`docs/task-system-plan.dsl.json` 的 `task_plan`（尤其 `service_flow` 七步 · `root_cause_of_the_4_deadlocks` · `task_home` · `two_level_tasks`）> `docs/board.md` > 本文件。
> ★ 本场**不改 src、不改 DSL、不 commit**；本文件是「可并入 DSL 的补丁清单」（§5，`P30–P45`）+ 一节的结构提案（§4）。
> ★ 上一场的 `P01–P29` 不重造：§3 先列出本场要**复用/修订**的 11 条。

---

## 0. 现场读数（每条都能被重跑；`file:line` 是断言的一部分）

| # | 读数 | 位置 | 它意味着什么 |
|---|---|---|---|
| R1 | `valid = true`，`问题数 = 0` | `node certs/.work/probe-validate-plan.mjs`（本场实跑，exit=0） | DSL 形状自洽；本场未改它 |
| R2 | `unsupported > 0` **先于** `failed > 0` 返回 | `task_machine.ts:82-92` | 「判不了」会**盖住**「有红」⇒ 报告只剩一句话，红被吞 |
| R3 | `canClaim` 在 **claim 与 complete 两处都被调** | `task_ops.ts:284`（claim）· `task_ops.ts:382`（complete） | ★★★ 不是"两把同形的尺"，是**同一个函数的两次调用** ⇒ 改一处会把另一处一起改坏 |
| R4 | `canClaim` 只判 `postExpectations` | `task_machine.ts:66`；`expectation.ts:95-102`（`edge-absent ⇒ 'pre'`） | ★★ **卡的一生里没有任何一处判 `edge-absent` 的失败**（patrol 未建）⇒ 有非法依赖的卡可以全绿收口 |
| R5 | `t_void.from === 'candidate'` 唯一 | `task_machine.ts:207-214` | 已领的卡遇到 target 消失 ⇒ 无路 |
| R6 | `t_release`（claimed→candidate，带 by+reason）**已实现** | `task_machine.ts:216-226` · `task_ops.ts:328-355` | ★ 「已领后没有出口」**读数不准**：出口有一个，缺的是另一个（void） |
| R7 | `claimTask` 把 `released_by/reason/at` **置 undefined** | `task_ops.ts:303-306` | ★★ 每领一次就抹一次释放痕迹 ⇒ **「退过几次」今天读不出来** ⇒ 抖动不可判 |
| R8 | `publish` 对 `state !== 'candidate'` 一律拒 | `task_ops.ts:219-226` | claimed 卡停在旧判据上；done 卡也不能被重翻 |
| R9 | 「不要自己验收自己」只是**注释里的建议** | `overlay.ts:120-121`（逐字："建议（不强制，但请当真）"） | ★★★ **双验在代码里不存在** ⇒ 单 agent 不是"done 永远达不成"，是"done 太容易" |
| R10 | 证据闸只校验**形状**，不校验**身份** | `overlay.ts:107-133`；`attestation.by ∈ {human, llm}`（:155） | 没有"谁签的"这个字段 ⇒ `verifier ≠ owner` **判不出来** |
| R11 | 闸：不是任何节点的文件 ⇒ 放行；是节点 ⇒ 必须有 claimed 卡 | `write_gate.ts:673`（`continue`）· `:679` | ★★ 「领 A 卡去改 B 文件」在闸上**走不通**（B 是节点就被拒） |
| R12 | 任务格无 `verifier` / 无 `decision_rev` / 无 `history` | `task_schema.ts:148-178`（逐键核） | §3 的多数判据**今天没有落点** |
| R13 | `saveDSL(applyOverlay(...))` **单参** | `task_ops.ts:135` | 乐观锁 `base_dsl_rev` 从未传入 ⇒ 重入与漂移可能是**丢失更新**，不只是"判据旧" |
| R14 | `frictions.jsonl` = **31 条**，逐行 `JSON.parse` 全过 | `node -e "…split('\n').filter(Boolean).map(JSON.parse)"`（本场实跑：`entries=31 bad=0`） | ★ `wc -l` 报 32（换行符数）—— **同一陷阱在上一场已经踩过一次**（见 §6 滞涩 2） |

---

## 1. 先答「你给的候选哪里错了」

> 这一节放最前，因为四条里有三条的**前提读数**与我的实测不一致；在错读数上讨论方案等于讨论一张不存在的图。

| 议题 | 你的候选/前提 | 判定 | 一句理由（带读数） |
|---|---|---|---|
| 1 | 「`≥1` 条后态判据没过 = 有活干」 | **不够，但方向对** | ① 它把 `unsupported` 与"红不可达"都读成"有活"（R2 的红被吞）；② 它把 `edge-absent` 违约读成"没活"（R4：全仓无人判）；③ 它没说**改哪里** —— `complete` 调的**就是** `canClaim`（R3），只改判据 = 把收口闸一起放行红卡 |
| 1 | 「存在**可动的证据**」 | **不可判（原样）** | "可动"不是证据的属性，是 (主体路径, 卡集, 闸) 的属性（R11）⇒ 除非派生（`movable := 主体路径不属别人的未完成节点`），否则它是一句自述 |
| 1 | 「红全不可达 ⇒ 允许领，领了先去解依赖」 | **不许领（有硬读数）** | 闸只认**该节点**的 claimed 卡（`write_gate.ts:679`）⇒ 领 A 去改 B 的文件会被 B 的闸当场拒；唯一例外是新文件（`:673`）⇒ 领 = 制造半修 |
| 2 | 「双验要求不是做的人 ⇒ 单 agent 时 `done` 永远达不成」 | **前提错** | R9/R10：代码里没有双验，只有注释建议 ⇒ 今天 `done` **只需一条口供**（`attestation.by:'llm'` 就是自己签自己） |
| 2 | (a) 允许"自己验但标 `self_verified`" | **坏（不是降级）** | 没有"不降级"的基准 ⇒ 它不是降级，是**给现状发一张有名字的许可证**；且会让 `degraded` 变成默认值，闸等于没有 |
| 2 | (b) 强制"另一个 agent/人" | **会造出你担心的死锁** | 单 agent 仓里它使 `done` 不可达，直接违反榜单第一条强制（必须有终态）—— 这条代价今天就能读到（3 条 in_progress 挂一天） |
| 3 | 「`t_void` 只许 candidate 转 ⇒ 已领后要退没有出口」 | **一半错** | R6：`t_release`（claimed→candidate，带 reason）**已实现**。真正缺的是 **claimed→void**（对象没了但你正拿着） |
| 3 | (c)「两者都要」 | **对，但不是"两者"** | claimed→candidate 已有；要加的是 void，且它**只能由 `existsTarget` 触发**（不许人工置，见 P19 的纪律） |
| 4 | (a) 卡带 `decision_rev`，比 rev 判 `stale` | **是退步** | 卡已经**逐字拷了** decision（`publishTask` 的实现就是拷贝）⇒ 深等已足够，且**比 rev 准**：decision 改 A→B→A 时 rev 判 stale，深等判 fresh（后者才对）。加 rev = 同一事实存两处 + 违反 invariant |
| 4 | (b) 变了就 supersede 旧卡 + 自动 publish 新卡 | **不可行（结构性）** | 家是**单格** `geometry.nodes[].task` ⇒ 旧卡不让位，新卡**没有住处**；前置是**归档**（P28），不是改个函数 |
| 4 | (c) 只在 claim 时比一次 | **等于现状** | 领后 decision 变了就静默漂移（R8 的直接后果） |

★ 没有一条是"想错了"，四条里有三条是**读数不准**（R3/R4/R6/R9）—— 这正是本仓头号病在讨论层的复现：**判据的住处分散，读它的人各读半截**。

---

## 2. 四个议题（每案一句判据 + 取舍）

骨架固定：**现状读数 → 方案 A/B/C（含 (d) 我加的） → 判据 → 推荐 + 取舍 → 必答问题**。

---

### 议题 1 · ④ 接取的判据（死锁源头）

**现状读数**：R3（`canClaim` 被 claim 与 complete 共用）· R2（unsupported 盖住 failed）· R4（pre 判据无人判）· R11（闸按节点认卡）。

#### 方案

| 方案 | 一句话 | 判据（怎么判它成立） |
|---|---|---|
| **A · 条数派** | `有活 := postRed > 0`（你的候选） | 双向夹具：`f(1红卡)=work ∧ f(全绿卡)=satisfied`。**必要**，可判，但见下三条反例 |
| **B · 归属派** | 按红的**主体路径归谁**分三类：`own`（本节点）/ `foreign`（别人的节点）/ `orphan`（不对应任何节点） | 三个夹具：红的主体=本节点 ⇒ `work`；红的主体=另一未完成节点 ⇒ `blocked`（并点名 dep）；红的主体不对应任何节点 ⇒ `work` 但 `because.kind='orphan_path'` |
| **C · 声明派** | 靠 `blocked_by`（P25）显式声明依赖 | blocked 卡 claim 必拒且列出阻塞卡；悬空 `blocked_by` ⇒ 立卡拒 |
| **(d) · 读数派（我的）** | **一个五值函数 `cardStanding`**：`work / violated / blocked / satisfied / unknowable`，优先级 `unknowable > blocked > violated > work > satisfied`；`blocked` 由 B **派生**，C 只在人显式声明时覆盖派生值 | 见下「五值的判据」；★ 另加一条**结构判据**：`completeTask` 不再调 `canClaim`（`grep` 0），改调 `isSatisfied` |

**五值的判据（逐条可跑；B 的定义用既有纯函数 `expectationSubjectPath`，零新字段）**

```
own(e)     := expectationSubjectPath(e) === node.path
foreign(e) := ∃ n' (n'.id ≠ node.id) : expectationSubjectPath(e) === n'.path
orphan(e)  := ¬own(e) ∧ ¬foreign(e)

unknowable := report.unsupported > 0            （★ 压过一切：判不了就不许说"有活"）
blocked    := postRed > 0 ∧ ¬∃own(postRed) ∧ ∃foreign(postRed) ∧ 该 n' 上无终态卡
violated   := preRed > 0 ∧ postRed === 0        （★ 违约：非法依赖，不是"没活"）
work       := postRed > 0 ∧ ∃own(postRed)        （或全 orphan ⇒ work + reason=orphan_path）
satisfied  := postRed === 0 ∧ preRed === 0
```

#### 必答问题（逐条）

1. **看"红的条数 > 0"还是"存在可动的证据"？**
   ⇒ **都不看**。看的是「红的主体路径**归谁**」。理由：条数会把"等别人"和"自己能干"混成一类（两者处置相反：一个该开依赖卡，一个该开工）；"可动"原样不可判（§1）。归属是**可判且零字段**的：`expectationSubjectPath` 已存在（`expectation.ts:189-191`），节点表在 `geometry.nodes`。
2. **红全部不可达（依赖未做）算不算有活干？该不该允许领？**
   ⇒ **不算"这张卡"有活；不许领这张卡**。判据不是偏好，是 R11：闸只认该节点的 claimed 卡 ⇒ 领了也改不动别人的文件。**"解依赖"这件事照做，但它的载体是依赖节点的卡**（`publish` 从 dep 节点的 decision 翻一张，再 claim）—— 这正是 `two_level_tasks` 已有的机制，不新造。可判：`blocked` 卡 claim 拒，错误里**必须**出现 dep 节点 id；且 dep 卡 publish→claim 后，原卡自动从 `blocked` 变 `work`（一条 e2e）。
3. **红只是一条 `edge-absent`（前态判据，天然成立）算不算有活干？**
   ⇒ **算「违约」，不算「施工」**，且**这一格今天完全不可见**（R4）。这是 `kind⇒phase` 的真正用途：**不是用来算"有没有活"，是用来把红**分派**到三种不同处置**（construct / repair / 不许收口）。判据：一条 `post` 全绿 + `edge-absent` 红的卡 ⇒ `standing=violated`、`claim` 允许、`complete` 拒；且它的 `reason` 与 `post_red` 那条**不是同一个字符串**（P07 的纪律：三条不许共用一句）。
   ★ 顺带修一个**真漏口**：今天这张卡会被 `complete` 收口成功（`canClaim` 只取 post ⇒ 全过）。判据：夹具里它必须被拒。

#### 推荐与取舍

**推荐 (d)，即 A 的"红"作原料 + B 的归属作分类 + C 作人的显式覆盖。**

- 取舍 1：`blocked` 派生要相信一条约定「节点 ≈ 文件」——本仓成立（`geometry.nodes[].path`），但**跨文件的一条活**（一张卡的期望里同时有 own 与 foreign 红）会被判 `work`（因为有 own）⇒ 它开工后仍可能撞闸。代价接受：因为 `touches`（P26）本来就要在 claim 时求交，那里会再拦一次。
- 取舍 2：`violated` 可领，意味着"拆非法依赖"会被当成一次正经施工 ⇒ 卡上必须留 `because.kind='pre_red'`，否则回执里看不出这活是"建"还是"拆"。
- 取舍 3（★ 最大的）：**必须同时把 `canClaim` 一分为二**。同一次改动里：`cardStanding`（五值，claim 用）+ `isSatisfied`（布尔，complete / patrol 的 `missed_close` 用）。只改一处 = 半修且**更坏**（收口闸会放行红卡）。判据：`grep -c "canClaim" src/application/design/dsl_ops/task_ops.ts` == 0（complete 侧改调 `isSatisfied`）。

---

### 议题 2 · ⑦ 验收的「角色」（`verifier_kind`）

**现状读数**：R9（双验只在注释里）· R10（证据无身份）· R12（`TaskSpec` 无 `verifier`）。

#### 方案

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 自验 + 标记** | 允许自己验，标 `self_verified` | 「`self_verified` 卡的 evidence 条数 **严格多于** `verified` 卡」——★ 做不到 ⇒ 它不是降级，是免检 |
| **B · 强制非做者** | `verifier ≠ owner` 硬约束 | 单 agent 下 `done` 不可达 ⇒ 违反"必须有终态"⇒ **可判地失败**（今天已有 3 条 in_progress 的实证） |
| **C · 机器验 + 人抽验** | 常规卡机器验，高风险才要人 | 「高风险」必须可判，否则"抽验"靠人记 ⇒ 本条单独不成立 |
| **(d) · 独立性派（我的）** | 不问"是不是自己"，问"**独立性够不够**"，独立性有三个可判来源：`actor`（不同 id）/ `channel`（另一条可重跑命令）/ `provenance`（独立重算的索引）；高风险卡只能 `actor` | 见下四条纪律 + 风险函数 |

**风险 → 必需独立性（可判，不由人自述）**

```
touchesSource(card) := ∃ e ∈ card.expectations : expectationSubjectPath(e) 以 'src/' 开头
                     ∨ 该路径 ∈ 受保护路径（preflight B.3 的那一批）
requiredIndependence(card) := touchesSource(card) ? 'actor' : ('actor' | 'channel')
```
★ 风险函数**复用闸的那条线**（闸管"能不能写 src"，它管"写完谁能签"）⇒ 一个问句一把尺，不新造第二个"风险"概念。

**四条降级纪律（这是"降级怎么保证不比不降更差"的全部答案）**

| # | 纪律 | 判据 |
|---|---|---|
| D1 | **尺不变**：降级只换"谁跑"，不换"跑哪批判据" | channel 用的 expectations 与 card.expectations 数组**逐条相等**（深等） |
| D2 | **证据更多**：channel 要求 ≥2 条**不同通道**全 pass（actor 只需 1 条） | `evidence.length ≥ 2` ∧ `通道去重 size ≥ 2` ∧ 每条带可重跑命令与 exit code |
| D3 | **`unsupported > 0` 禁止任何降级** | 降级卡的报告里 `unsupported === 0`（元规范"`unsupported>0` 不算绿"的直接推论：判不了不能靠第二个通道变绿） |
| D4 | **留痕 + 比值**：降级必须记 `degraded:true`，patrol 出 `degraded_ratio` | 比值有读数出口；> 阈值 ⇒ 体检红（**不阻断收口**——阻断会立刻造出"永远 done 不了"） |

#### 必答问题（逐条）

1. **降级规则由谁定？**
   ⇒ 由 `requiredIndependence(card)` 这个**可判函数**定，不由人定。人只在**一处**裁：`不可逆操作`（删除 / 改受保护文件 / 改 schema）机器判不了 ⇒ 单列 `OQ17`，在裁之前 `risk` 只认 `src/` 与受保护路径。
2. **降级了怎么保证不比不降更差？**
   ⇒ 形式化：降级后**可重跑证据数**严格增加（1→2，D2），且**禁止出现 unsupported**（D3），且**判据集合不变**（D1）。它唯一更弱的是"独立性"，而独立性由风险闸兜住（高风险根本不许降）。**残余风险**（如实写）：`channel` 的独立性仍来自同一个 agent 的同一双手 —— 它防的是"判据算错"，不防"agent 撒谎"；防撒谎只有 `actor`，所以 `touchesSource` 一经命中就不许降。
3. **`provenance` 这一源今天能不能用？**
   ⇒ **不能，此处缺一维**：它要求"用独立重算的索引复判"，而 `scanRev` 在证据里**没有落点**（`TaskEvidenceRecord` 只有 4 键）。所以本场只承认 `actor` / `channel` 两值，第三值等 `scanRev` 有落点再加。

#### 推荐与取舍

**推荐 (d)，(c) 作为它的高风险子集吸收进来**（"只有高风险才要人"= `requiredIndependence='actor'` 且 actor 只能是人或另一 agent）。

- 取舍 1：多一个 `verifier` 字段（`{id, independence, channel?, at, degraded}`），换来"独立性可判"。★ 不复用 `evidence.by`：它只允许 `human|llm`（R10），那是**角色类型**不是**身份**，两者不能混成一格。
- 取舍 2：高风险的 `actor` 在单 agent 时会挂住 —— 处置是**停在 `claimed` 并报 `awaiting_verifier`**（有终态的要求由"人到位"满足），而不是降级。这条会真实地卡住"改 src 的卡"，**这是有意的**：`src` 是唯一能把仓库改坏的地方。
- 取舍 3：`degraded_ratio` 是**体检指标**不是闸。理由：把它做成闸 ⇒ 每次"无人"都会把系统卡死；做成指标 ⇒ 它会作为一条读数进滞涩台账，人能在它变高时裁。

---

### 议题 3 · ⑤ 的「异常出口」

**现状读数**：R5（void 只从 candidate）· R6（release 已有）· R7（claim 抹痕迹）。

#### 方案

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 允许 `claimed→void`（带理由）** | 做不完/方向错都能退场 | void 卡 `void_reason` 非空 ∧ 两次不同 `scanRev` 的 `existsTarget=false`（复用 P02） |
| **B · 允许 `claimed→candidate`（退回）** | **已有**（`t_release`） | release 事件带 by+reason（已有；缺的是 reason 枚举 P05） |
| **C · 两者都要（你的候选）** | 区别是"这张卡还做不做" | 见下「区别判据」——★ 但"两者"里已经有一个，真正要加的是 **A**，且 A 不许人工触发 |
| **(d) · 出口表派（我的）** | 出口不是两条迁移，是**一张四行的表**，每行 = (可判触发, 还做吗, 事实落哪)，由一个函数 `dispositionOf` 产出 | 四个写端都调它（`call-exists ×4`）；函数体外 `grep existsTarget` == 0 |

**出口表（四出口 + 一个"不是出口"）**

| 出口 | 可判触发 | 还做吗 | 事实落哪 |
|---|---|---|---|
| `closed`(done) | `standing=satisfied` ∧ 证据过 ∧ 权威过 | 做完了 | evidence + **归档** |
| `released` | 对象在 ∧ 判据未变 ∧ 人主动退（reason） | **还做** | 需 `history`（今天被 R7 抹掉） |
| `voided` | `¬existsTarget`（**两次不同 scanRev**） | 不做（对象没了） | history + 归档 |
| `superseded` | 新卡 `replaces` ∨ 判据指纹变了（旧卡不再代表节点） | 不做这张（由新卡接） | history + 归档 |
| `handoff`（**非出口**） | `owner` 变 ∧ `state` 不变 ∧ `released_*` 不变 | 还做（换人） | history + 新 owner |

#### 必答问题（逐条）

1. **"退回"与"失效"的区别判据是什么？**
   ⇒ 两个读数，**不是 reason 字符串**：
   - `existsTarget(card)` —— 假 ⇒ `voided`（唯一 void 入口，人工不许置）；
   - `fingerprint(card.expectations) === fingerprint(node.decision.expectations) ∧ summary 相等` —— 假 ⇒ **不是退回，是重翻**（`superseded` 的语义，但对 claimed 卡走 `release(stale)` → 重翻，见议题 4）；
   - 两条都真 ⇒ `released`（还做）。
   判据（能自证 reason 不是判据）：**三个夹具的 reason 可以写成同一个字符串**，结局仍必须分别是 released / voided / superseded。
2. **退回的卡会不会被无限领退（抖动）？**
   ⇒ **会，而且今天连计数都不可能**（R7：`claimTask` 抹掉 `released_*`）。所以抖动判据的**前置是事件落点**（复用 P12 的 `history[]`，不新造字段）。
   判据（不设拍脑袋阈值）：**同一个 reason 不许第三次出现** —— 第 2 次出 `churn` 读数；第 3 次 `claim` 拒，并**要求该 reason 落到它该落的字段**：`blocked` ⇒ 必须写 `blocked_by`；`stale` ⇒ 必须重翻；`direction_wrong` ⇒ 必须改 decision 或 void。**拒的不是次数，是"这个理由没有归宿"**（与 P29 的"每条 OQ 必须有消费方"同一条纪律）。
   ★ 诚实边界：若不加 `history`（P12），**抖动判据不成立** —— 此处缺一维（事件落点），不是缺一个阈值。

#### 推荐与取舍

**推荐 (d) = C 的超集**：加 `t_void_from_claimed`（只由 existsTarget 触发）+ `dispositionOf` 单函数 + 出口表 + `t_handoff`。

- 取舍 1：把四个出口收进**一个函数**，代价是四个写端各要改一次调用；换来"退回 vs 失效"不再靠人写 reason 来区分。
- 取舍 2：`handoff` 单列为"非出口" —— 它不是状态迁移，是**执行者变更**；若把它做成 release+claim，中间会出现 candidate 空窗（别人能抢），且会把"谁做过"截成两段（这正是 R7 那条病）。
- 取舍 3：void 不许人工置（P19 已定）⇒ "我觉得这事不该做了"的正确出口是 `wontfix`（池级 disposition），不是 void。两个字混用会让"对象没了"与"人不想做"在同一格里，读端每次都要再分一次。

---

### 议题 4 · ③ 的「重入」（决策卡变了）

**现状读数**：R8（publish 拒 claimed+）· R13（写盘无乐观锁 ⇒ 可能丢失更新）· R12（卡上无版本、无 history）· ★ 家是**单格**（`task_home.where`）。

#### 方案

| 方案 | 一句话 | 判据 |
|---|---|---|
| **A · 卡带 `decision_rev`** | 对拍时比 rev，不一致标 stale | 三夹具：改 A→B→A；只改 `why`；(改 path)。★ rev 在第 1 格判 stale，而**正确结论是 fresh** ⇒ 本条**自己把自己证伪** |
| **B · 变了就 supersede + 自动 publish 新卡** | 旧卡让位、新卡接班 | 前置判据：**旧卡必须已出格**（家单格）⇒ 没有归档则新卡**无住处**，此方案当场不成立 |
| **C · 只在 claim 时比一次** | 领时校验一次 | 领后变更不可见 ⇒ 与现状同（R8） |
| **(d) · 指纹派（我的）** | **不落字段**：`fingerprint = {kind,path|from|to,symbol,target,signature}`（**去掉 `why`**）；`stale := fingerprint 序列不等 ∨ summary 不等`；按**卡态**分处置 | 三夹具：A→B→A ⇒ fresh；只改 `why` ⇒ **fresh**；改 path ⇒ stale。且卡上 `grep decision_rev|rev` == 0 |

**分态处置（"提示还是阻断"的答案：按态分，不是全局二选一）**

| 卡态 + stale | 处置 | 判据 |
|---|---|---|
| `candidate` | **自动重翻**（`publish` 已允许重翻 candidate，`task_ops.ts:219`） | 重翻后 fingerprint 相等；卡 id 不变 |
| `claimed` | **阻断收口，不阻断做事**；唯一出口 = `release(reason=stale)` → 重翻 → 再 claim | `complete` 拒 ∧ 闸仍放行（闸只看 `state==='claimed'`，`write_gate.ts:679`）—— 所以"做到一半"不会被撕成半修 |
| `done` | **不判 stale**（它是历史）；改判据 ⇒ 开 `follows_up` 新卡 | done 卡 state/expectations **一字不变**；新卡 `follows_up=旧id` |

#### 必答问题（逐条）

1. **`stale` 该只"提示"还是"阻断"？**
   ⇒ 都不是（都是全局动作，而 stale 的处置随卡态变）。**candidate：自动修（不提示）；claimed：阻断收口（不阻断做事）；done：不判**。理由：全局阻断会把"正在做的人"变成半修制造者（本仓铁律：半修比不修更坏）；全局提示会静默漂移（现状 R8）。
2. **`done` 的卡被覆盖时，完成的事实怎么保住？**
   ⇒ ★ **不是靠卡上字段，是靠归档**。成因是结构性的：家是**单格**（`geometry.nodes[].task`），`publish` 又拒非 candidate（R8）⇒ 同一节点**接不了第二张卡** ⇒ done 事实与新活**争一格**，只能活一个。这正是"跟着消失"的机制。
   判据（三条同时成立）：① 归档后**按 id 仍可查**（一条查询返回全字段 + 旧 `dsl_rev`）；② 该节点的 `nodes[].task` 里**不再有**旧卡；③ 新卡 `follows_up = 旧 id`。
   ⇒ 所以 **P28（终态卡出 DSL）从"减肥"升级为议题 4 的【前置】**，不是可选项。
3. **card 上的拷贝会不会与 decision 分叉出"两个真相"？**
   ⇒ **不会，前提是拷贝只读**。判据：`card.expectations` 的唯一写者是 `publish`（`call-exists`/写端唯一性），`complete`/`claim` 不许改它；且 `stale` 派生只读 `node.decision`。★ 这也是 A（rev）失败的根因：rev 是**第二份可变的版本信息**，拷贝是**不可变的出生证明**。

#### 推荐与取舍

**推荐 (d)，并把 B 的"自动接班"降级为"归档后接班"。**

- 取舍 1：指纹去掉 `why` ⇒ 改文案不再使卡失效。代价：`why` 改了而判据没改的"语义漂移"机器看不见 —— 接受，因为 `why` 本来就不参与判定（`judgeExpectations` 不读它）。
- 取舍 2：claimed+stale 不阻断做事 ⇒ 有人可能在旧判据上继续写代码。接受：他必须 `release(stale)` 才能收口，那条事件会进 history，可追溯；相比"做到一半被打断"（半修），这是更小的损失。
- 取舍 3：归档是**新机制**（P28 未落）⇒ 议题 4 的完整解依赖它。在归档落地前，`done + 新活` 只能靠**新建节点**（不推荐，会破坏节点≈文件），或**放弃重入**（接受 done 事实被下次 publish 覆盖）。两条都不好 ⇒ 本条**必须与 P28 一起上**。

---

## 3. 复用上一场的哪几条（不重造）

| 编号 | 原意 | 本场怎么用它 | 需要修订吗 |
|---|---|---|---|
| P01 | 领取闸与收口闸分家 | 本场把它落成 `cardStanding` / `isSatisfied` 两函数（P30） | ★ **是**：P01 只说"另立函数"，没说 `complete` 调的**就是** `canClaim`（R3）⇒ 修订为"同一次改动必须两处都改" |
| P02 | void 从 claimed 也可达 + 双 scanRev | 直接作为议题 3 的 A 的前置 | 否 |
| P03 | superseded 判据 | 出口表里 `superseded` 那一行 | 否 |
| P04 | `follows_up` | done+stale 的唯一出口 | 否 |
| P05 | release reason 枚举 | 抖动判据的输入（reason 是**说明**，不是判据） | ★ 是：本场把 reason 从"判据"降为"标签"，判据交给读数 |
| P07 | 空集/判不了/有活 三分 | 本场扩成**五分**（加 blocked / violated） | ★ 是：三分不够（P07 漏了"红不可达"与"前态违约"） |
| P08 | stale 策略 | 本场改口径：deepEqual → **指纹（去 why）** | ★ 是（否则改文案即全节点 stale ⇒ 判据被噪声淹没） |
| P12 | `history[]` | 抖动与出口追溯的**前置** | 否 |
| P17 | 双签 + 单 agent 降级 | 本场改成"独立性三源 + 风险函数 + 四纪律" | ★ 是：P17 的 `machine_channel` 没有"为何不更差"的约束，本场补 D1–D4 |
| P25 | `blocked_by` | `blocked` 的**显式声明**（派生是兜底） | 否 |
| P28 | 终态卡归档 | ★ **升级为议题 4 的前置**（家单格 ⇒ 不让位就没新卡住处） | ★ 是（从可选变前置） |

---

## 4. ★★★ 那一问：该不该收归成一节「异常与角色」

### 4.1 答案

**该收归成一节 —— 但不是你给的那个形状。**

你给的形状是「每条步骤都有 `normal / retry / abort / transfer` 四种走向 + 一个 `actor` 字段」。
**它不成立，两条理由都可判：**

1. **它对七步里的四步不成立 —— 不是"太多"，是"说错对象"。** `normal / retry / abort / transfer` 描述的是**卡**的走向；而第 1 步（填表）、第 2 步（交表）**此刻还没有卡**（它们正是"造出卡"的动作），第 3 步（上架）是**读端**（`service_flow.steps[3].window` 逐字："系统（读端 = T8）"），第 6 步（交回执）是卡内的一次**写证据**、不改任何状态。⇒ 这四步写"这张卡 retry/abort"是把对象的种类弄错了。剩下三步（接取 / 做事 / 验收）才有卡级走向，而它们的 `retry/abort` 恰好就是**同一张出口表的投影**（released / voided / superseded）⇒ 28 格里真正**新增**的信息是 **0 格**。次生的代价同样可读：下一步的人要维护 28 个格子，每格都得"记得"自己该填什么 —— 这正是 `preflight D.1`（清单应当变短）的反面。
2. **`actor` 是一个标签，不是判据。** 它可以被随手写成任何人；`anti_comment`（"只有文字、无判据钉的承诺"）当场命中。真问题是**独立性**，而独立性可判（谁签的 id / 哪条命令 / 哪次重算），"actor" 不可判。

### 4.2 四条为什么是**一个**东西

`root_cause_of_the_4_deadlocks` 说共同形态是「缺异常/重入分支 + 缺角色」。**再往下挖一层**：

四条问的其实是**同一个读数的四个消费者**：

| 议题 | 它其实是这个读数 | 今天被谁消费 |
|---|---|---|
| ① 接取 | `standing(card) = work` | `canClaim`（`task_ops.ts:284`） |
| ② 验收 | 与 ① **正交**：不是"卡此刻怎样"，是"**谁有资格说它到了终态**" | 只有注释（R9） |
| ③ 异常出口 | `standing` 的两个不同 `because`：`target 没了` / `判据变了` / `都对但没做成` | `t_void` / `t_release` 各判一半 |
| ④ 重入 | `standing.because = decision_changed` —— **不是第五个状态** | 没人判（R8） |

⇒ 所以缺的不是"异常分支"，是 **一个函数（`cardStanding`）+ 一个正交维度（`authority`）+ 一张由前者派生的出口表（`exits`）**。四条各打补丁的必然结果是**四处各判一半**（今天就是这样：`canClaim` / `t_void` / `publish` / `complete` 四个地方，每个都只判一件）。

### 4.3 这一节的结构（字段 + 判据）

**A. `standing` —— 一个纯函数、五值、零新字段**

```
cardStanding(card, node, report) -> { standing, because: {kind, detail, dep?} }
  standing ∈ {work, violated, blocked, satisfied, unknowable}     ★ 优先级同此序（unknowable 最高）
  because.kind ∈ {post_red, pre_red, dep_undone, orphan_path, no_post, all_green, index_mismatch}
  输入三样都是现成的：card（含拷贝的 expectations）· node.decision · judgeExpectations 的报告
```
**判据**：① 五条夹具各得一个不同 `standing`，且 `because.kind` 两两不同（P07 纪律）；② 函数体里不出现 `existsTarget` / 不出现 `deepEqual`（那些是 C 的事）；③ `claim` 判 `standing ∈ {work, violated}`，`complete` 判 `standing === satisfied` —— **两个函数，不是两次调用同一个**。

**B. `authority` —— 一个记录、一个风险函数**

```
card.verifier = { id, independence: 'actor'|'channel', channel?, at, degraded: boolean }
requiredIndependence(card) = touchesSource(card) ? 'actor' : ('actor'|'channel')
```
**判据**：D1–D4（§2 议题 2）+ `verifier.id !== card.owner`（`independence='actor'` 时）或 `evidence ≥ 2 条不同通道`（`='channel'` 时）。

**C. `exits` —— 一张四行的表 + 一个函数**

```
dispositionOf(card, node, report) -> { exit: 'closed'|'released'|'voided'|'superseded', cause }
```
**判据**：四个写端各一条 `call-exists`（`publish/claim/release/complete` → `dispositionOf`）；`dispositionOf` 之外没有第二处 `existsTarget` / 指纹比较。

**D. 四种走向是投影，不是字段**

```
normal   = standing ∈ {work, violated}          （开工/修违约）
retry    = exit = released                      （还做，回池）
abort    = exit ∈ {voided, superseded}          （不做了）
transfer = owner 变 ∧ state 不变                （handoff —— ★ 你漏掉的第五种）
```
⇒ 四条走向**全部由 A/B/C 派生**，DSL 里**不写**任何 `per-step` 的 `normal/retry/abort`。
**判据**：`service_flow` 里 `grep normal|retry|abort`（作为字段名）== 0；而上面四条等式各有一条纯函数断言。

**可粘贴的 DSL 片段（并入 `task_plan.service_flow` 用；本场不写入）**

```json
"standing_roles": {
  "note": "★ 四条互锁/缺口的收归处：一个读数 + 一个正交维度 + 一张出口表。四种走向是它们的投影，不是字段。",
  "standing": {
    "fn": "cardStanding",
    "values": ["work", "violated", "blocked", "satisfied", "unknowable"],
    "precedence": "unknowable > blocked > violated > work > satisfied",
    "because": ["post_red", "pre_red", "dep_undone", "orphan_path", "no_post", "all_green", "index_mismatch"],
    "consumers": { "claim": "∈ {work, violated}", "complete": "=== satisfied", "patrol.missed_close": "=== satisfied" },
    "criteria": "五条夹具五个 standing + because 两两不同；函数体内无 existsTarget / 无指纹比较"
  },
  "authority": {
    "field": "card.verifier",
    "shape": "{ id, independence: actor|channel, channel?, at, degraded }",
    "required": "touchesSource(card) ? actor : actor|channel",
    "discipline": ["尺不变", "证据更多(≥2 通道全 pass)", "unsupported>0 禁降", "留痕 + degraded_ratio 体检"],
    "criteria": "done 卡 verifier 必填且满足 required；degraded 卡 evidence≥2 通道；degraded_ratio 有读数"
  },
  "exits": {
    "fn": "dispositionOf",
    "rows": {
      "closed": "satisfied ∧ 证据过 ∧ 权威过",
      "released": "existsTarget ∧ 指纹相等 ∧ 人主动退",
      "voided": "¬existsTarget (两次不同 scanRev)",
      "superseded": "新卡 replaces ∨ 指纹不等",
      "handoff": "★ 非出口：owner 变 ∧ state 不变"
    },
    "criteria": "四写端各 call-exists；existsTarget 只在函数体内出现一次"
  }
}
```

### 4.4 这一节怎么**同时**解掉四条（逐条对账）

| 议题 | 收归前（今天） | 收归后 | 一条判据 |
|---|---|---|---|
| ① 死锁 | 领取闸 = 收口闸（同一函数，R3） | 读五值：`work/violated` 可领，`satisfied` 只可收口，`blocked/unknowable` 都拒且各带原因 | `canClaim(1红)=work ∧ complete(同卡) 拒` |
| ② 角色 | 只有注释（R9） | 独立性二分 + 风险函数 + 四纪律；`src` 卡不许降 | `verifier.id===owner ∧ touchesSource ⇒ 拒` |
| ③ 出口 | void 只从 candidate，reason 是自由串 | 四出口由 `existsTarget` / 指纹派生；reason 降为标签 | 三个夹具同 reason 三结局 |
| ④ 重入 | publish 拒覆盖 ⇒ 静默漂移 | `stale` 不是状态，是 `released` 的一个 cause；按态分处置；done 事实靠归档 | A→B→A 判 fresh；改 path 判 stale |

★ 一句话：**四条之所以看起来是四个问题，是因为今天有四处各自判一半；收归后它们只剩一个读数、一个签署、一张出口表。**

### 4.5 反方（我认真写过，站不住，但记下来）

- 反方 1：**四条各自独立，统一会过度抽象。**
  反驳：它们的输入**完全重合**（card + node.decision + report）——①③④ 用的是同一份报告的同一次判定，只是取不同字段。输入重合 ⇒ 输出应当同住一处。唯一的例外是 ②（权威），所以它被单列成正交的 B，而不是硬塞进 A。
- 反方 2：**`standing` 五值会把状态机变成六态。**
  反驳：不是。`standing` **不是状态**（不可落盘、不是迁移的 from/to），它是**读时现算的读数**（同 `progressOf` / `cardStaleness` 的手法）。判据：卡上 `grep standing` == 0（它是函数返回值，不是字段）。
- 反方 3：**`blocked` 可以靠 `blocked_by` 声明，不必派生。**
  部分成立：声明更准（人能说"我等谁"），派生更真（没声明时也能判）。⇒ 结论取**派生兜底 + 声明覆盖**，两条并存且冲突时以声明为准，并让 patrol 报 `blocked_undeclared`（有派生无声明 ⇒ 提示补 `blocked_by`）。

---

## 5. 可并入 DSL 的补丁清单（16 条：`P30–P45`）

> 每条 4 字段：**放哪 / 加什么 / 为什么 / 判据**。★ 标 **【前置】** = 不做则后续补丁无可判意义；标 **【裁】** = 需用户拍。

### 5.1 `state_machine`（6 条）

**P30 【前置】领取闸与收口闸分家 —— `cardStanding` 五值 + `isSatisfied`**
- **放哪**：`task_plan.state_machine.transitions[t_claim].guard.clauses[1]`（改）· `[t_done_from_claimed].guard.clauses[2]`（改）· 新增 `src/domain/task_standing.ts`
- **加什么**：`cardStanding(card,node,report) → 五值`；`t_claim` 判 `∈ {work, violated}`；`t_done_from_claimed` 判 `=== satisfied`；`task_ops.completeTask` 改调 `isSatisfied`
- **为什么**：R3 —— `complete` 调的**就是** `canClaim`；只改一处会把收口闸放行红卡（比现状更坏）
- **判据**：① 双向夹具 `cardStanding(1红卡)=work ∧ isSatisfied(同卡)=false`；② `grep -c "canClaim" task_ops.ts` == 0；③ 一条夹具证明 `complete` 仍拒红卡

**P31 判据全量判、按 phase 分区（修"前态判据无判定点"的洞）**
- **放哪**：`t_done_from_claimed.guard` 新增一条 + `cardStanding` 实现口径
- **加什么**：`judgeExpectations` 入参 = `card.expectations` **全量**；分区在报告之后（post 供 standing，pre 供 violated）；`preRed > 0 ⇒ 不许 closed`
- **为什么**：R4 —— 卡的一生里没有任何一处判 `edge-absent` 的失败 ⇒ 有非法依赖的卡可以全绿收口
- **判据**：夹具（post 全绿 + `edge-absent` 红）⇒ `standing=violated` ∧ `complete` 拒 ∧ `claim` 允许；且其 reason 与 `post_red` **不是同一字符串**

**P32 `blocked` = 红全落在别人未完成的节点上（派生，不许领）**
- **放哪**：`t_claim.guard` 新增一条 + `cardStanding.blocked` 分支
- **加什么**：`own/foreign/orphan` 三分类（用既有 `expectationSubjectPath`）；`blocked ⇒ because.dep` 必填（节点 id）；解依赖的载体 = dep 节点的卡
- **为什么**：R11 —— 闸只认该节点的 claimed 卡，领 A 去改 B 会被 B 的闸拒 ⇒ "领了先解依赖"在闸上走不通（新文件除外）
- **判据**：blocked 卡 claim 拒且错误里出现 dep 节点 id；dep 卡 publish→claim 后原卡转 `work`（e2e）

**P33 `unknowable` 压过一切（判不了 ≠ 有活 ≠ 没活）**
- **放哪**：`cardStanding` 的优先级 + `t_claim`
- **加什么**：`unsupported > 0 ⇒ unknowable`，但**附 `redSeen` 计数**（榜单要能显示"有 3 条红，另 1 条判不了"）
- **为什么**：R2 现状把红吞掉；而索引陈旧会把红读成 unsupported（`frictions` #28/#30）⇒ 让"有红"凌驾其上会按陈旧索引发活
- **判据**：三条夹具给出 `work` / `unknowable` / `violated` 三种不同 reason（不许共用一句）；`unknowable` 的报告里 `redSeen` 等于实际红数

**P34 【裁】`t_void_from_claimed`（已领卡的对象没了）**
- **放哪**：`state_machine.transitions[]` 新增
- **加什么**：guard = `¬existsTarget` ∧ **两次不同 `scanRev`** 一致 ∧ `voided_by='patrol'`（★ 人工不许置）
- **为什么**：R5 —— 已领的卡遇到 target 消失无路可走；单次读数会把"重算中"误判成"对象没了"
- **判据**：删 target 后单扫 ⇒ void 计数 0（判"暂缓"）；两扫不同 scanRev ⇒ 1

**P35 `t_handoff`（换人不是换态）**
- **放哪**：`state_machine.transitions[]` 新增
- **加什么**：`claimed → claimed`；guard = 新 owner 非空 ∧ 旧 owner 非空 ∧ `released_*` **不变** ∧ 写一条 `handoff` 事件
- **为什么**：做成 release+claim 会出现 candidate 空窗（可被抢），且把"谁做过"截成两段（R7 那条病的同族）
- **判据**：handoff 后 `state` 仍 claimed、`released_at` 仍空、`owner` 已换、旧 owner 的 evidence 保留

### 5.2 `task_home`（5 条）

**P36 `verifier` 字段 + 独立性二值**
- **放哪**：`task_schema.TaskSpec` + `t_done_from_claimed.guard` 新增"权威"一条
- **加什么**：`verifier = { id, independence: 'actor'|'channel', channel?, at, degraded }`；`independence='actor' ⇒ id !== owner`
- **为什么**：R9/R10 —— 双验只在注释里（`overlay.ts:120`"建议（不强制）"），且 `evidence.by` 只允许 `human|llm`（角色类型，不是身份）
- **判据**：done 卡 `verifier` 必填；夹具 `id===owner ∧ independence='actor'` ⇒ 拒；`grep` 显示只有一处消费

**P37 风险 → 必需独立性（降级规则不由人自述）**
- **放哪**：`standing_roles.authority` + 复用 `touchesSource`
- **加什么**：`requiredIndependence(card) = touchesSource(card) ? 'actor' : 'actor'|'channel'`
- **为什么**："这次是低风险"是人话，不可判；而"主体路径以 `src/` 开头"可判，且**复用闸的那条线**（一个问句一把尺）
- **判据**：含 `src/` 主体路径的卡走 channel 必拒；纯文档/派生路径允许

**P38 降级的四条纪律（"不比不降更差"的完整答案）**
- **放哪**：`standing_roles.authority.discipline` + `patrols` 新增 `degraded_ratio`
- **加什么**：D1 尺不变 / D2 证据 ≥2 通道全 pass / D3 `unsupported>0` 禁降 / D4 留痕 + 比值（体检红，不阻断）
- **为什么**：没有这四条，"降级"就是给现状发许可证（元规范"unsupported>0 不算绿"的直接推论）
- **判据**：降级卡 `evidence` 条数 >1 且通道去重 ≥2、无 unsupported；`degraded_ratio` 有读数出口

**P39 `stale` 用指纹（去 `why`），不落字段**
- **放哪**：`task_home.stale_policy`（替 P08 的实现口径）
- **加什么**：`fingerprint = {kind, path|from|to, symbol, target, signature}`；`stale := 序列不等 ∨ summary 不等`
- **为什么**：P08 写的是 deepEqual(**整个** expectation) ⇒ 改一句 `why` 就让全节点卡 stale ⇒ 噪声 ⇒ 人会忽略 stale ⇒ 判据退化；`decision_rev` 更差（快照 + A→B→A 误判）
- **判据**：三夹具 A→B→A ⇒ fresh / 只改 `why` ⇒ fresh / 改 `path` ⇒ stale；卡上 `grep decision_rev|rev` == 0

**P40 `stale` 分态处置（提示/阻断按态分）**
- **放哪**：`t_done_from_claimed.guard` + `publish.guards`
- **加什么**：candidate ⇒ 自动重翻；claimed ⇒ `complete` 拒、做事不拒、出口 `release(stale)`；done ⇒ 不判 stale，触发 `follows_up`
- **为什么**：全局阻断制造半修（铁律：半修比不修更坏）；全局提示静默漂移（R8）
- **判据**：三态三夹具三条不同结局；且 claimed+stale 的卡仍能过闸写源码

### 5.3 新增子段（5 条）

**P41 `dispositionOf` 单函数 + 出口表（四出口 + 一个非出口）**
- **放哪**：`task_plan.service_flow.standing_roles.exits`
- **加什么**：`closed / released / voided / superseded`（+ `handoff` 单列"非出口"），每行 = (可判触发, 还做吗, 事实落哪)
- **为什么**：现状四处各判一半（`canClaim`/`t_void`/`publish`/`complete`）⇒ 同一件事四个半截答案
- **判据**：四个写端各一条 `call-exists` → `dispositionOf`；函数体外 `grep existsTarget` == 0 且无第二处指纹比较

**P42 release 不许抹痕迹（抖动判据的前置）**
- **放哪**：`task_ops.claimTask`（删 `:303-306` 的清空）+ 复用 P12 `history[]`
- **加什么**：claim 只追加事件，不清 `released_*`；卡上 `released_*` 语义改为"**最近一次**"而非"当前"
- **为什么**：R7 —— 每领一次抹一次，"退过几次"读不出 ⇒ 抖动不可判
- **判据**：`claim→release→claim` 后 `history` 的 release 事件仍在（长度不降）

**P43 抖动判据：同一 reason 不许第三次**
- **放哪**：`patrols` 新增 `churn` + `t_claim.guard`
- **加什么**：同卡同 reason 的 release ≥2 ⇒ `churn` 读数；第 3 次同 reason 的 claim 拒，并要求该 reason 落到 `blocked_by` / 重翻 / void
- **为什么**：阈值阻断是拍脑袋；反复退回说明**归宿没被填**（reason 没有消费方）—— 与 P29 同一条纪律
- **判据**：三种 reason 各有落点时 claim 放行（证明拒的不是次数，是"没归宿"）

**P44 done 事实的保住 = 归档（P28 升为议题 4 前置）**
- **放哪**：`task_home.retention`（P28 的落点）+ `two_level_tasks`
- **加什么**：终态卡出格前先归档（append-only，带 id + `dsl_rev` + 全字段快照）；归档后新卡可占格并 `follows_up=旧id`
- **为什么**：家是**单格** ⇒ 旧卡不让位，新卡无住处 ⇒ done 事实与新活**争一格**，只能活一个（这就是"跟着消失"的结构成因）
- **判据**：① 归档后按 id 仍可查（一条查询）；② `nodes[].task` 里不再有旧卡；③ 新卡 `follows_up` 指向旧 id；④ DSL 字节回到基线附近

**P45 【裁】「异常与角色」一节进 DSL + 追加 OQ17–OQ18**
- **放哪**：`task_plan.service_flow.standing_roles`（新子段，见 §4.3 片段）+ `open_questions`
- **加什么**：A/B/C 三段各带一条可判函数；**不写** per-step 的 four-way 字段；OQ17 = "不可逆操作算不算高风险"（机器判不了）；OQ18 = "done 卡归档去哪 / 是否入库"（P28-OQ15 的落地口径，本场只确认它是 P44 前置）
- **为什么**：四条补丁若各落四处，就又是"四处各判一半"
- **判据**：① `service_flow` 里 `grep normal|retry|abort`（作字段名）== 0；② 三条 `call-exists`（claim→cardStanding · complete→isSatisfied · 四写端→dispositionOf）；③ `invariant_checks` 新增一条"**领取闸与收口闸不得同形**"：两条 guard 的 clauses 文本相同 ⇒ 红（`frictions` #30 的 wish ②）

---

## 6. 需用户裁定的（只有 2 条）+ `[未核]`

### 6.1 要你拍的（每条一句话，可直接答）

| # | 问题 | 选 A 的后果 | 选 B 的后果 |
|---|---|---|---|
| 1 | **OQ17**：`不可逆操作`（删除 / 改受保护文件 / 改 schema）算不算"高风险 ⇒ 必须 actor 验"？ | 安全，但这类卡在无人在场时**永久停在 claimed** | 可自动收口，但"删错了"没有第二双眼睛 |
| 2 | **P44/OQ18**：done 卡的归档落在哪（append-only 日志文件 / 还是留在 `nodes[].task` 一直不删）？ | 重入可行、DSL 不膨胀；代价是多一处存储 | 结构简单；代价是**同一节点接不了第二张卡** ⇒ 重入无解 |

★ 其余 14 条补丁不需要裁定（它们是"把已有语义补成判据"或"把已有判据拆到正确的位置"）。

### 6.2 `[未核]`

1. **`unknown` 的判据与索引新鲜度耦合**：`unsupported` 里有多少是"索引陈旧"、多少是"语言不支持"，我只有 `frictions` #28/#30 的记载，**本场没跑**（真仓 `cache.db` 只读，不刷新索引）。⇒ P33 的 `index_mismatch` 分支要等 `probe` 支持显式 root 才能区分。
2. **`own/foreign` 的路径归一**：`expectationSubjectPath` 给的是 `normPath` 后的路径，而 `node.path` 的写法我没逐一核（是否已归一）。⇒ P32 落地前要一条"同一 target 两种写法归一"的夹具（上一场 §6 已挂同一条未核）。
3. **`cardStanding` 的位置**：放 `domain`（纯函数）要 `judgeExpectations` 的结果作入参 —— 这与 OQ9 的层级倒挂同族（domain 不许 import infrastructure）。本场按"入参由 application 传"（OQ9 的裁法）写，但**没验证** `card.expectations` 的全量判定在 `application` 侧能否一次拿全。
4. **`handoff` 是否真被需要**：本仓目前没有多 agent 抢同一张卡的实测；P35 的依据是"release+claim 会造空窗"这条**代码推演**，不是现场读数。

### 6.3 滞涩（已追加进 `docs/frictions.jsonl`）

1. **`file:line` 与"写法"不一致会静默歪讨论**：本场四条议题里三条的前提读数是错的（`canClaim` 是**同一函数两处调用**、双验只在注释里、`release` 已实现）。⇒ **滞涩**：讨论题的题干本身没有"读数钉"，于是它把"我记得的设计"当成了"代码里的事实"。希望：派活/议题模板里的每条现状都带 `file:line`，缺则标 `[读数未附]`。
2. **`wc -l` 又一次不等于条目数**：`docs/frictions.jsonl` `wc -l` = 32，条目 = 31（逐行 `JSON.parse`）。上一场已经踩过一次并写进报告，**本场复发**。⇒ 希望：仓里给一个 `scripts/count-jsonl.mjs`（`split('\n').filter(Boolean).map(JSON.parse).length`），别让每笔自己写这行 `node -e`。
3. **"设计 DSL 里的语义"与"src 里的实现"会分叉，且没有任何哨兵**：`t_claim.guard` 写"全过"、`board.roles.verifier` 写"非做者"、`t_void` 只从 candidate —— 这三条在 src 里分别是"照抄"、"没有实现"、"照抄"。⇒ 缺的是**一条把 DSL 的 guard 与 src 的行为对起来的 invariant**（现只有 `symbol-exists`/`call-exists` 这类"存在性"判据，没有"行为一致"判据）。这正是本场 P45 判据 ③ 想开的第一刀。
