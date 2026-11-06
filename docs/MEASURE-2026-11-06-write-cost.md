# 测量：写入成本 / 过闸损耗 —— 2026-11-06（**2026-11-07 更正**）

> 这份文件存在的唯一理由：**P29**（`docs/PITFALLS.md`）。
> 「写进卡/目标/commit message 之前先问：这个数在仓里有落点吗？没有就当场落盘。」
>
> ## ★★★ 更正声明（2026-11-07 · T36）
> **本文件 2026-11-06 的原版量错了账本，结论作废。** 原文说「业务拒绝不进任何一本账」——
> 那是**拿一本零条 `via:"mcp"` 的账本**得出的。业务拒绝**有账**，只是住在另一本；真正没账的只有一处
> （`observe` 的执行失败被写进 `ok:true`，见第五节）。
> ★ 原文每个数都**保留在下文「原版错在哪」一节**，不删 —— 删了就没人知道错在哪。
> ★ 本文件所有数都带**复算命令**；不许在别处引用一个这里的数而不指向这里。

---

## 一、错在哪（一句话）

`usage.jsonl` **不是一个文件，是三个落点**，由 `getStorageRoot()` 按环境选：

| # | 落点 | 谁写 | 行数（2026-11-07 实测） | `via` 分布 | `via:"mcp"` |
|---|---|---|---|---|---|
| ① | `<包根>/.agentio-data/dogfood/usage.jsonl` | 没有 `AGENT_IO_HOME` 时（getStorageRoot ③） | 10,667 | mcp 3,746 · cli 5,823 · gate 1,071 · cert 27 | **3,746** |
| ② | `<包根>/.agent-io/dogfood/usage.jsonl` | 设了 `AGENT_IO_HOME=<包根>` 时（②） | 26,211 | gate 21,848 · sweep 2,112 · cli 1,971 · cert 280 | **0** |
| ③ | `<dataHome>/.agent-io/dogfood/usage.jsonl` | 已安装 / 无项目（②/④） | 32,036 | gate 14,248 · cert 12,939 · sweep 2,373 · cli 2,284 · mcp 192 | 192 |

**原版量的是 ②** —— 那本 `via:"mcp"` **一条都没有**，它是「门 + 扫射 + 证 + CLI」的账。
⇒ 原文的「ok=false 共 114 次、真实业务拒绝 = 0」量的是**门和扫射**，不是使用。

★ 根因不是谁写错了路径（`mcp_scan.mjs` 自拼的那条式子与写端在设了 `AGENT_IO_HOME` 时**一致**），
而是 **同一个写端、同一个函数，按环境落到两个不同文件**，而账本里**没有任何字段说自己是哪一本**。
实测（同一条命令、只差一个环境变量）：
```
无 AGENT_IO_HOME      → D:\agentio\dev\agent-io\.agentio-data
AGENT_IO_HOME=本仓根  → D:\agentio\dev\agent-io\.agent-io
```

---

## 二、正确基数（用**真使用**那本重算）

```
.agentio-data/dogfood/usage.jsonl
  行数 10,667 ｜ via：mcp 3,746 · cli 5,823 · gate 1,071 · cert 27
  非探测（排除 via∈{sweep,gate}）        9,596
     其中 ok=false                       1,772   （**18.5%**）
     其中 ok=true                        7,824
```
对照原版：`ok=false 114 / 26,211 = 0.4%`。**两个数都不是错的，它们各自是自己那本账的真话** ——
这正是"拿一本当全部"的形状：一个是 0.4%，一个是 18.5%，差 46 倍。

★ 原文那 114 的**构成逐条核过，全对**（这部分不改）：
```
84 = 坏签名族（**健康探测**：同一秒内每个工具各记一遍 × 数批；子型 paths[0] 66 / The "path" 12 / Cannot read propert 6）
     ★ 此处**不写死批数与工具数**：它们是某一刻的读数，写进散文就会过第二次期。
       要现算就重跑第六节那条 `node scripts/rejection-stats.mjs`（它逐本点名账本路径与行数），再按同一秒分组数一遍。
28 = 2026-11-02T13:37..14:02 一组 cert 夹具（7 轮 × 4：任务闸 14 + 计划闸 7 + 判据不够 7），全部 via:"cert"
 2 = 缺参数（get_dsl locate 缺 text ×1、design_line judge 缺 feature ×1），via:"cli"
```

---

## 三、「业务拒绝」现在有账了：`rejections.jsonl`（sidecar）

`usage.jsonl` 的 `ok` 只回答「这次调用跑通了吗」（`!isError`），回执 payload 的 `ok:false` 回答「世界好不好」；
「该做、但被规则挡下」是**第三件事** ⇒ 单独一本，与 `ok` **正交**。

```
落点：与 usage.jsonl **同目录**的 rejections.jsonl（AGENT_IO_DOGFOOD_FILE 覆写时跟着走）
写端：infrastructure/dogfood_stats.ts#recordRejection
通道：application/plumbing.ts#runRejectionScope / noteRejectionFromCatch（AsyncLocalStorage）
咽喉：presentation/mcp/server_registry.ts#invokeTool（全仓唯一调用出口）
分类：domain/rejection_kind.ts#classifyRejection（零依赖纯函数 · 五类）
```

**★ 只存事实，不存结论** —— sidecar 每条是
`{ts, tool, via, action, threw, errorName, gateCodes, gateRejection, message, source}`，
**没有 `kind` 字段**，故意的：结论会变、事实不会。分类在**读的时候**现算 ⇒
改了判定，读数一定跟着变（否则"口径可复算"那条判据就退化成"数一个已冻结的 verdict"）。

五类（次序即判据）：
```
C 探测     via ∈ {sweep, gate}        —— 不回答"业务有没有被挡"，**先排除**
D 用错     缺参数 "…" / schema 不过 / 不认识的键
A 业务拒绝 错带闸的来源（gateCodes 非空 / 拒绝落盘前缀）
B 异常     抛了 Error 而一条闸来源都没有
unknown   既无 Error 对象、又没有码 ⇒ **判不了**（不许冒充 A 或 B）
```

---

## 四、当前读数（仪表上线后）

仪表最早一条：`2026-11-06T19:49:39.080Z`。窗口内（演示用：各造一次）：
```
A 业务拒绝 1（edit_code · 拒绝落盘（任务闸））
D 用错     1（edit_code · 缺参数 "file"）
B/unknown  0
守恒式：窗口内 ok=false 2 ｜ A+B+D+unknown 2  ⇒ **平**
```

★★ **历史行没有 A/B 分类** —— 仪表 2026-11-06 才装上，之前 1,772 条失败**只有原文、没有分类**。
下面的数字是**文本启发式估计**，**不是**仪表读数（写在这里是为了给一个量级，不许当依据引用）：
```
A（拒绝落盘 / 拒绝提交 / 自洽性闸 / 变更原因校验 / edit_dsl 批量回滚外层）  1,109
D（缺参 / schema / 未知键）                                                  279
unknown（分不出）                                                            384
B（Node 原始异常）                                                             0
```

---

## 五、真正"没账"的那一处（已修）

`application/observe/handlers.ts` 的插桩 catch 原先写：
`...(isGateRejection(e) ? { isError: true } : {})`
⇒ 只有「被闸拒绝」才升 `isError`，其余执行失败（语言包缺工具链 / 目录不存在）落 `isError:false`
⇒ `usage.jsonl` 记成 **`ok:true`**，而消息写着「Observe 插桩失败」= **失败被记成成功**。
实测账本里就有这一形（`.agent-io` 那本 432 条 `ok:true` 却带抛出异常的消息 —— 那一批还叠了
`mcp_scan.mjs` 自己那套 `ok = 零坏签名` 的第三把尺）。
现改为 `envelopeFor({ threw: true }) === 'isError'`（判据住 `domain/rejection_kind.ts`），
而 `plumbing.ts:155` 那条「**报表**说世界不好 ⇒ 不升 isError」的纪律**一个字没动**。

---

## 六、复算命令（唯一读端）

```
node scripts/rejection-stats.mjs          # 0=平 / 1=守恒式不平 / 2=读不了
```
它做四件事：① 把**所有候选账本**逐个点名（多于一本就响亮报警，不静默合并）；
② 按 via 分桶并**报出 C 排除了多少行**；③ 拿 sidecar 里的**事实**现跑 `classifyRejection`；
④ 打印守恒式 `C + ok + (A+B+D+unknown) == N`，不平就非零退出。

---

## 七、原版错在哪（原文逐字保留）

```
文件：.agent-io/dogfood/usage.jsonl
规模：26,187 行（2026-10-27 .. 2026-11-06）
ok=false 共 114 次（0.4%）
  ├── 84 次 = 固定模式「坏签名[paths[0]]」… = 健康探测，不是真实使用
  └── 30 次 = 看起来像真拒绝 ⇒ 逐条查下来是测试夹具（task-gate 14 / plan-gate 7 / rollback 7 / other 2）
```
★ 错不在算术，错在**分母**：这本账 `via:"mcp"` **0 条**。今日复算：26,211 行（又长了），
114 条 ok=false **全在**，构成与分类**逐条对得上** —— 所以这份"错"是**可复核的错**，
正因如此它才危险：数字都对，对象错了。

---

## 八、与 T-21 那个数的关系（重要，原版保留）

```
会话里曾引用「T-21 量出 立卡:判据1:判据2 = 2:1:1，收尾 = 5 次调用」。
★ 全仓 grep `2:1:1` = 0 命中；`T-21` = 0 命中。
⇒ 那个数没有落点，本文件不采用它，也不复制它。
```
