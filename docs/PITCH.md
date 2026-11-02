# PITCH.md — 卖点合集（活文档）

> **用途**：每开发一个功能，就在这里追加一条。收官时配合 `.workbuddy/memory/` 的任务历史，直接产出"我们的优势"。
>
> **纪律（三条，别破坏）**
> 1. **每条卖点必须挂一张证**（`certs/tNNN-*.mjs`）—— 没证的卖点是广告，不是卖点；
> 2. **每条卖点写清"凭什么"**：一个可复现的读数（数字优先），而不是形容词；
> 3. **有边界的如实标**：`[未核]` / "仅 TS" / "未做大项目评估" 都要写出来 —— **藏起来的限制，最后一定变成事故**。
>
> 维护：新增功能 → 追加一条（表格 + 需要时在下面补小节）；`src/` 变了但卖点没变 ⇒ 只更新读数。

---

## 0. 一句话定位

**agent-io 是一套「设计即权威、判据可执行」的开发管理器 + 实验室**：
先把意图写成可判的设计册（DSL），再让代码、观测、工具面**全部接受同一批判据的裁决**。

不是"又一个 code index"：索引只是底座，**能被判红/判绿**才是产品。

---

## 1. 卖点总表

| # | 卖点 | 一句话 | 凭什么（证 / 读数） | 与常见做法的差异 |
|---|---|---|---|---|
| 1 | **判据 11 种，加一种只改 1 处注册表**（真值由 `node --import tsx scripts/gen-expectation-schema.mjs --check` 打印，别手改） | 判据有注册表，名字/校验/渲染/JSON Schema 全派生 | `t413` 8/0 · `describeExpectation` 里 `case` 分支 **0** 个（原 12 个） | 常见做法是每个 kind 在 6~8 处手抄，加一种必漏一处 |
| 2 | **四态判定：判不了 ≠ 通过** | `pass` / `fail` / `unsupported` / `pending`，`unsupported` 永不冒充绿 | `t409` 9/0 · `t416` 6/0 | 多数"测试通过率"把"没跑到"算成通过 |
| 3 | **自动化测试三层闭合 L1/L2/L3** | 静态（7 种）· 行为（同进程跑函数）· 运行时（真事件） | `t406` 7/0 · `t412` 8/0 · `t420` 7/0 | 一把梭的"单测覆盖率"看不出链路真跑了没 |
| 4 | **L2 与 L3 一次运行同时产出** | 判据 harness 起进程时就顺手采集探针事件 | `t412` 8/0（事件落 `<project>/.agent/observe/`，`target.*` 探针齐） | 通常"跑测试"和"采集观测"是两套、跑两遍 |
| 5 | **零污染插桩（内存改写）** | 源码盘上**逐字节不变**，行为输出**逐字一致** | `t411` 8/0 · `t424` 见 §3 | 常见做法是改盘插桩，靠 git 兜底，脏工作区 |
| 6 | **探针依赖闭包排除** | 只排"探针可达的 import 闭包"，**其余代码可观测** | `t418` 7/0 · 闭包 24 文件、**对 import 封闭** | 朴素做法"排除整个 dist"⇒ 永远观测不到框架自己 |
| 7 | **一次真跑 456 条事件 / 11 个文件** | 框架自己的代码也能被自己观测 | 实测 2.9s，含 `expectations.js` 192 / `judge.js` 62 / `db.js` 56 | 观测工具通常只能观测"用户项目"，看不到自身 |
| 8 | **台账 ≡ 源码实有** | 台账只记**真落进源码**的探针，没落地的进 `unapplied` | `t419` 6/0 · 真仓 7 文件 **0 差异** | 台账记"计划" ⇒ 覆盖率是假的（本仓踩过：台账 101 / 源码 99） |
| 9 | **嵌套表达式体箭头也有探针** | `f(x => g(y => z))` 内外两层都插，且代码可执行 | `t420` 7/0（含"无重复声明"判据） | 拼接模型缺 `template` ⇒ 内层探针被静默丢弃 |
| 10 | **推荐器 → 插桩器一条链** | 算"该在哪打"⇒ 清单 ⇒ **只插这些点**，零命名漂移 | `t421` 7/0 | 推荐器与插桩器各说各话，推荐等于白算 |
| 11 | **律由框架提供，判据只声明适用范围** | `design:silent-error-discard` 等规则是框架的；册里只写"它对本项目生效" | `t416` 6/0 | 每个项目自己重写一遍静态规则，规则越写越散 |
| 12 | **观测数据随项目走，但不进 git、不留无限份** | 事件落 `<project>/.agent/observe/`，保留策略只留最近 N 份 | `t415` 8/0 | 观测产物要么污染仓库，要么散在工具私有目录 |
| 13 | **可复现的 L3：观测入口** | `npm run observe:collect -- <cmd>`，退出码原样透传 | `t417` 9/0 | "运行时验证"常常只在本机绿一次 |
| 14 | **一次参数声明** | `observe` 的 8 个 action 参数只声明一处，双向一致性检查 | `t422` 8/0（当场抓出 2 个真 bug） | 三处手抄 ⇒ 加了参数却"永远传不进来" |
| 15 | **工具面收敛 63 → 44** | `observe` 五合一 + `plan_refactor` 并入 `apply_refactor_plan`（单入口两形态） | `t407` 5/0 · `t408` 6/0 · `t425` 13/0 · `t426` 15/0 · `t427` 9/0 · `t428` 11/0 · `t429` 10/0 · `t430` 12/0 · `t431` 14/0 · `t432` 8/0（合并前先录等价基线；渲染产物逐 sha 相同）· 遗留候选 **0** | 工具越多越好卖？实际是**选择成本**转嫁给调用者 |
| 16 | **域级律：60 域 / 层序倒挂 0** | infrastructure < application < presentation，域级判定而非逐文件 | `t404` 6/0 · 倒挂实测 **0** | 分层检查通常靠人 review，或逐文件 lint 噪音大 |
| 17 | **破坏性操作有证** | 删/并/移都有"必要条件"判据，不是凭感觉 | `t405` 10/0 | 重构靠勇气和 code review |
| 18 | **账实相符纪律** | "读数在中间层蒸发"这类病，修一次立一张证 | `t410` 7/0（改写结果必须交给调用方）· `t419` · `t422` | 同类 bug 反复出现，因为没人把它变成判据 |
| 19 | **死链退役，不留"看起来能用"的假流程** | 无产者/无审阅人的链按"无活跃消费"删掉，并**钉一张"它不在"的证** | `t424` 8/0 · `deprecate_offline` dry-run（1105 文件 → 21 死源 → 1 候选） | 常见做法是把死代码留着"以防万一"，下一个人再花半天查证它是死的 |
| 20 | **零 LLM 回放：整仓 5~8 秒** | `AGENT_IO_REPLAY_ONLY=1` 全量产出可复现，读数才可比 | `t453` 4/0 · 实测 5–8s/轮（当天在它上面跑了 20+ 轮） | 常见做法是"跑一次半小时"，于是没人跑，读数凭记忆 |
| 21 | **双棘轮：错误数 + 空孔数** | tsc 错误数**暴跌**可能等于"函数体退化成空孔"，所以两个数都锁 | `t453` ③（errors 与 holes 同时棘轮）· 实测逮住一次 `431 → 22`（holes 161→188） | 只锁错误数的项目会因"少 409 个错"庆祝，其实是丢了 409 个体 |
| 22 | **双实现一致性变成"分叉账"** | 不要求两条实现逐字相同（那会冻结旧 bug），只要求**未登记的分叉才红、登记后消失也要清账** | `t454` 3/0 · 两边可译 215→327 体 · 已登记 34 条 | 常见"对拍"把参考实现当真理，于是**旧 bug 变成标准** |
| 23 | **写源码三道闸：任务 / 判据 / 计划** | 改源码必须在已领取的卡上、节点有后态判据、且有冻结的重写计划 | 实测 `edit_code` 3 项全成 0 失败；三次拒绝**每次都指出缺什么**（可照做） | 多数"AI 改代码"没有前置约束，全靠人 review 兜 |
| 24 | **判据强度自检** | 计划里的判据若是"存在/结构类"，工具会点明**它永远发现不了逻辑错** | 回执原文：`source-has 是存在/结构类，永远发现不了逻辑错。要发现 bug 得换：behavior-cases / call-exists / edge-absent` | 别处只有"判据绿不绿"，没有"这条判据够不够格"这一维 |
| 25 | **`edit_code` 四段模糊级联 + 唯一性校验** | 逐字 → 空白归一 → 缩进弹性 → 省略号占位；每级必须**全文件恰好 1 处**命中 | 实测同批 3 项：L1-exact 1 项、L3-缩进弹性 2 项，全成；歧义会并列报行号 | 手写脚本替换是**静默 no-op**（当天 12 次，连我自己写的脚本都骗过我） |
| 26 | **四边界各有对拍证** | AST↔轴心 / 轴心↔册子 / 册子↔骨架 / 骨架↔填孔，每条边界一张证 | `t443` `t444` `t447` `t449`（236/236 体往返）`t451`（198 函数）`t452` | 翻译项目通常只测"端到端能跑"，出错时不知道哪条边界丢了信息 |
| 27 | **名词层三层 + 五态不静默** | 语言层（工具自带）/ 项目层（册子）/ 同名直用；**沉默 ≠ 已决定** | `t450` 3/0（lang terms 由适配器导出面派生）· 五态 `lang/none/project/same-name/undecided` | 命名映射散在 prompt 里，模型随手起名，沉默被当默认 |
| 28 | **成本模型诚实到反直觉** | 轴心只在**名词/概念层**把 M×N 降成 M+N；body IR + 双渲染器对单个语言对是**净成本** | `docs/PIVOT-VERDICT.md`（含"什么情况下不要轴心"） | 卖点通常只讲收益；这里把"不该用"的条件也写进文档 |

---

## 2. 分项展开（每条：是什么 / 凭什么 / 边界）

### 2.1 设计侧是权威，代码只是被裁决的一方
- **是什么**：意图写成 `.agent-io/design/<f>.dsl.json`（节点 + 边 + `decision.expectations`），代码、观测、工具面都接受同一批判据。
- **凭什么**：判据 11 种（真值见 `gen-expectation-schema --check`）、四态、`edit_dsl` **写入即预判**（当场判红/绿）、计划出口再判一次、`design_line` 读数再判、`patrol` 巡检第四次。
- **差异**：常见"文档 + CI"两套事实，天然漂移；这里**只有一处事实**，且它可执行。
- **边界**：判据覆盖不到的语义仍靠人；`unsupported` 会如实显示"没判"。

### 2.2 零污染插桩：不改你的源码，也看得见你真跑了什么
- **是什么**：`node --import probe_loader` ⇒ 模块加载时**在内存里**改写并注入探针，盘上零改动。
- **凭什么**：`t411` 8/0 —— 源码 sha256 不变、输出逐字一致、`write:true` 与 `write:false` 的改写结果**逐字节相等**（只有一套改写逻辑）。
- **差异**：改盘插桩要么脏工作区、要么要 `uninstrument` 还原；这里不需要还原，因为**没改过**。
- **边界**：v1 只覆盖 `.js/.mjs/.cjs`；`.ts` 需宿主 transpiler；**ESM hooks 不拦 CJS `require`**（这条是实测发现）。

### 2.3 一次运行，两层判据
- **是什么**：`behavior-cases`（L2）跑用户函数的同一次 spawn 里，注入 loader 采集（L3）。
- **凭什么**：`t412` 8/0 —— 事件落 `<project>/.agent/observe/`，`target.add.enter/exit` 带 args/ret，且 L2 判据同时判出 pass。
- **差异**：通常"跑测试"和"采集链路"是两个流水线，要跑两遍、时间翻倍。
- **边界**：事件"够不够判"取决于跑的命令触没触到目标函数（`unsupported` 会如实说）。

### 2.4 三条"静默自伤"的坑，都变成了判据
这三条是本仓自己踩出来的，说明**观测工具最难的不是采，是不把宿主弄挂**：
1. **缺 `template`** ⇒ 内层探针被静默丢弃（`t420`）；
2. **排除口径收窄到目录** ⇒ 进程**无输出、exit 0**（探针依赖闭包里有 dist 模块 ⇒ 循环 import）⇒ `t418`；
3. **模板拼错下标** ⇒ 重复 `const` 声明 ⇒ **直接语法错误把宿主跑挂**（`t420` ③ 专钉"无重复声明"）。

### 2.5 工具面：少而准，且"被吸收不丢能力"
- **是什么**：63 → 55，`observe` 单入口 + `action`；`harvest` 线退役、`narrate_step` 删除。
- **凭什么**：等价性证 `t407` 5/0（7 场景基线对比）、可用性守卫 `t408` 6/0（传错参数**点名归属**，不静默生效）。
- **差异**：工具多的产品把"选哪个"的成本转嫁给调用者（人 or 模型）；这里**合并前先立基线证**，合并后能力不丢。
- **边界**：跨语言的观测能力不等价（Go/Python 机制各异，未做）。

### 2.6 数据归属：项目的事实随项目走，框架的证不随项目走
- **是什么**：运行时事件 → `<project>/.agent/observe/`（派生物、不入 git、留最近 20 份）；设计册 → `.agent-io/design/`（进 git）；框架自证 → 框架仓。
- **凭什么**：`t415` 8/0（含"保留策略只碰 `events-*.jsonl`"、"清理失败不影响 spawn"）。
- **边界**：**跨版本可比性无机制** —— 事件内容与 `judge.ts` 规则表都会演进，旧事件重判结论可能变。

---

### 机械翻函数体（能确定的不花钱让 LLM 猜）

**是什么**：`translate` 现在对函数体**先试机械翻**（AST 同构改写，零 LLM），翻不动的才给 LLM。
`for range`→`for…of`、`:=`→`const/let`、`if/else`、表达式 `switch`、`int(x)`→`Math.trunc`、
`len(x)`→`.length`、`nil`→`null`、`==`→`===`、复合字面量→数组/对象。

**凭什么**：真仓 624 个有体函数里 **453 个（72.6%）不含任何「硬构造」**
（硬构造 = `defer`×149 / `select`×12 / 通道收发 / `type switch` / `goto`）——
这七成本来就是**同构**的，机械翻是**确定**的，不该花钱让 LLM 猜。

**读数**（`certs/`以外的复现：5 个核心 Go 文件同一夹具）：
```
机械直翻 16 个函数体（零 LLM）· 352s · report = { ok 123, fail 0 }
不翻：                      · 408s · report = { ok 115, fail 8 }
⇒ 失败 8 → 0（机械翻不会「批中缺块」），时间 408s → 352s
```

**边界（`[未核]`）**
- 读数分两层，**别混着报**：**判据通过率 80.1%**；**真实机械翻译成功率 58.0%**（362/624，`defer`→`try/finally` 一把 +119）。差的 22% 是「判据说能翻、但包装节点/类型位置翻不完」；剩余的真该给 LLM：闭包捕获 / 类型断言 / `select` / `chan` / `go`；
  每补一个形态都要**靠对拍验**，不许直接扩白名单；
- 机械翻**翻不平**的语义差：Go `int` 64 位截断 vs TS `number` f64；字符串按字节 vs UTF-16；`nil` 切片 vs `[]`
  ⇒ 必须靠 `translate verify=true`（`verify_behavior` 对拍 Go 与 TS 同批输入）兜；
- 同一夹具下 **LLM 调用数反而 24 → 54**，原因未查清 ⇒ 不许把这条当「成本更低」宣传。

## 3. 还没证 / 还没做（写在这里，别让它们变成事故）

| 项 | 状态 |
|---|---|
| Go / Python 零污染插桩 | 未做（Go 计划用 `build -overlay`；Python 拿不到 args 全貌） |
| `.ts` 目标的内存插桩 | 未做（需宿主 transpiler 配合） |
| 整 dist 插桩的**性能** | 只在小夹具量过（一次真跑 2.9s），**大项目未评估** |
| 规则表版本化 | 无机制（⇒ 跨版本可比性缺失） |
| 三层以上嵌套箭头 | 递归天然支持，但**没有专证** |
| ~~`t424`~~ | ✅ 已完成：死链退役（`code_workbench` + `llm_decider` 删除，证 `t424` 8/0） |

---

## 5. 翻译侧实战记录（2026-10-29/30，真实 Go→TS 仓，624 个函数体）

上表 20–28 条不是设计出来的，是同一个下午+晚上在真实项目上走出来的。三条硬结论：

1. **读数必须可复现且便宜**（回放 5–8s），否则所有"变好了"都是感觉；
2. **验收要锁住"没丢东西"**（holes），否则"错误变少"可以来自"代码变少"；
3. **判据要能发现逻辑错**，否则"判据全绿"与"产物全错"可以同时成立（当天实测过）。

### 当天读数（可复现）

```
AGENT_IO_REPLAY_ONLY=1 AGENT_IO_TSC_FIX=1 → 全仓 tsc 错误数
1010 → 888 → 700 → 546 → 533 → 506 → 477 → 440 → 431 → 384 → 382 → 362 → 361 → 358 → 346
空孔数（TODO）全程 195，未涨
```

### [未核] 边界（照实写）

- 语料只有**一个 Go 仓**（624 体）；没有第二个 Go 仓，也没有 Rust/Python 目标验证；
- `pivot` 覆盖 327/624 体（52%），其余走 legacy 或留空孔；
- 判据强度只有"存在类 / 语义类"两档，没有更细分级；
- 回放模式**不做 LLM 填充**，所以 `holes=195` 是"未填"，不是"填错"。

---

## 6. 待改进（按"我实际被卡住"的顺序，全部带现场证据）

| # | 卡点 | 现场证据 | 建议 |
|---|---|---|---|
| 1 | **L1 卡（节点无 `decision`）立卡后无法 release / void** | `release` →「快照是从 decision 拍的 ⇒ 无法把判据写回」；`void` →「preparing 没有到 void 的可用迁移」⇒ 卡永久停在 preparing | 无 decision 时 `prepared_snapshot` 记 `null` 并允许 release 回 candidate；或允许 `preparing → void` |
| 2 | **判据 `unsupported` 双向拦，但不给原因** | `claim`/`complete` 都报「后态判据里 1 条判不了（unknowable）」；`zeroValueOf` **已导出**仍判不了 | 回执附 `unsupported` 的 `why_not`（符号没索引到？cases 形态不对？） |
| 3 | **改完代码画布即过期，但只有下一次写入才说** | 第二轮 `edit_code` 被拒「没有够格的重写计划」，真因只是 body_hash 变了 | `edit_code` 成功回执主动提示「本文件画布已过期，建议重冻」，或写入后自动重冻 |
| 4 | **改判据后 design DB 投影陈旧 ⇒ verify 红，但不指路** | 「⚠ 陈旧 …go_extractor.calls.json: requirements 与设计的判据不一致（该重跑生成器）」 | verify 失败里直接给可复制命令：`design_line action=gen-db` |
| 5 | **expectation 的 oneOf 报错指错分支** | 传 `cases:[{args,expect}]` 却报「必须含 `cert`/`rule`/`probe`」；真因是字段名应为 `given` | oneOf 失败时给**最接近分支**的差集（缺什么/多什么） |
| 6 | **`plan.card` 的措辞会导致填错** | 描述是"这张画布属于哪张任务卡"，我先填 `T-#IOTA` 标签 ⇒ 闸判"不够格" | 描述给示例值（节点 id 形态），或回执点名"期望节点 id" |
| 7 | **槽位方法表与适配器导出没有一致性检查** | 表里有 `UTC/Sub/String/UnixNano`，`_go_std/time` 没导出 ⇒ 改写**静默跳过**（6 条）；`os.Rename` 同类（9 条） | 加证：`SLOT_METHODS ⊆ adapter exports`，缺了就红 |
| 8 | **"通读"只到符号级** | `untouched_default: true` 一次声明覆盖其余符号，实际可以不看 | 允许声明，但要求 `detail` 里点名"其余符号与本次无关"的分组理由 |

> 1–8 都是当天**被真实卡住**的（不是设想的），其中 1、5 各卡住两轮。

---
## 4. 怎么用这一页

- **对外**：第 1 节表格就是"我们能做什么"；第 2 节是"为什么可信"；第 3 节是"我们的诚实"。
- **对内**：每次改动后跑 `npm run verify` + `npm run gate`（门清单 = `scripts/verify.mjs#GATES`，`gate` 的项清单 = `package.json` 的 `gate` script；**本页不写门数/项数** —— 写死的计数只会撒谎），读数变了就更新本页的**读数**（命令 + 实测值），不必改门数。
- **收官**：`docs/todo.md` 的完成历史 + `.workbuddy/memory/*.md` 的逐日回执 + 本页 = 一份不用回忆的结项材料。

### 29. 字段账：跨语言字段对账（`t457`）

**卖点**：Go 结构体声明的字段 ↔ 生成的 TS 接口成员，**同名逐字段对账**；丢字段 / 凭空多字段当场红。

**读数**（`node certs/t457-field-ledger-cert.mjs`）：
```
Go 结构体 118 · TS 接口 148 · 同名可比 118
字段：缺失 1 · 多余 0     ← 缺失的那一个就是折磨了一整天的嵌入字段 CachedNode.graphNode
```
落盘 `.agent-io/field-ledger.json`（118 结构体逐字段）。**零数据流**，纯 AST 声明对账。

### 30. 语义层事实：occurrences / fields（`t458` + `t459`）

**卖点**：绑定（def/use/**selection**）、字段账（ordinal/embedded/json_tag）由 `go/packages` 的 type checker 产出，
**不起 LSP 服务也有 LSP 能力**；`import_project` 一次导入即产出，失败可降级 `syntax-only`。

**读数**：`t458` 4/0（表结构：两表列齐、能写能查、既有 5 表不受影响）· 
`t459` 4/0（填充：`occ=32210 · fields=740`，**已知答案** `graphNode` selection 6 条、`CachedNode.graphNode ordinal=0 embedded=1`、幂等 32210→32210）。

### 31. 手写件 vs 编译器的分叉账（`t460`）

**卖点**：不凭"语义库更权威"就删自己的代码 —— 先**对拍**，把分叉记成账（未登记=红，登记了但已消失=**也红**）。

**读数**（`node certs/t460-extractor-parity-cert.mjs`）：
```
可比 (file,structure) 116 对 · 语义字段 740 · 分叉 **0**（missing=0 · extra=0 · type-diff=0）
清零路径：fields 加 file 出处（3 条 build tag 假分叉消失）→ 分组形参语法规范化 → tag 剥除顺序修正（6 → 0）
```
⇒ 每条分叉都有 `why` + `fix` 任务，账不许变成永久豁免。

### 32. 接口契约审计（`t462`）

**卖点**：Go 是**隐式实现**，编译器不会提醒"这个接口没人实现"，也不会提醒"两个接口方法集完全相同"。
这两类病只能靠事实层查，而它们正好对应两条硬原则：**0 实现 = 死契约**、**方法集重复 = 两处权威**。

**读数**（`node certs/t462-interface-contract-cert.mjs`）：
```
接口 16 个 · 问题 3 条（no-impl 2 / duplicate-methodset 1）
· MemorySource       0 实现（源码自述 Phase 5 reserved）
· SessionRepository  0 实现（SetSessionRepository 永远拿到 nil）
· LLMClient ≡ sender 方法集逐字相同（同一行为两处权威）
```
★ 16 这个数与**独立只读盘点**（子代理，不看我们的结论）完全一致 ⇒ 交叉验证。


### 33. 设计意图的**逻辑写口**收进 dit_dsl（design_intent → 	ype=goal / 	ype=edge_intent）

**卖点**：设计册只有一个**物理**写口（saveDSL）不够 —— 还要只有一个**逻辑**写口（谁有权改册里的对象）。
`design_intent` 的 inputSchema **没有 reason / evidence** ⇒ L1–L4 变更原因闸在那条路上**结构上无法执行**
（不是"会被放行"，是"没有输入可判"）。搬进 dit_dsl 后它与别的 type **共用同一道闸**，写核仍只有一处
（`intent/set_design_intent.ts`）。

**读数**（临时 `AGENT_IO_HOME` 沙盒、直调真 handler）：
```
改前：design_intent {goals:[{title:'x'}]}            ⇒ 落盘（盘上 goals=1，无任何理由闸）
      edit_dsl {type:'goal'}                        ⇒ 未知操作类型: goal
改后：edit_dsl op=goal + reason='调整一下'            ⇒ 拒 · 变更原因校验未通过（L1）：有效字符 4 < 6
      edit_dsl op=goal + 长但无实体的 reason          ⇒ 拒 · （L3）：原因未绑定具体实体
      合法 goal + edge_intent                        ⇒ 落盘，回读 meta.goals / edge.intent **同值**
      全量替换：写 2 条 → 只写 1 条                  ⇒ 1 条（不是 3 条）
      形状闸：goals 非数组 / 缺 title / status 非法 / edge_intent 无定位键 ⇒ 4/4 全拒
工具面：wire 162,147 → **162,071 B（−76 B）**（同批删掉 edit_dsl 描述里已漂的两行 op/type 部分枚举）
```

**边界**：`design_intent` 作为**别名**仍生效一个版本 —— 它**仍不跑 L1–L4**（没有 reason 入参），回执首行已逐字写明并指向新家；下一版移除。
`capability_map#WHEN_OVERRIDES['design_intent']` 的策展语**未改写**（属该文件持有卡）[未核]。


## 2026-11-02 · 收逻辑写口 ②：`archive` 的写端并入 `edit_dsl`（`file/lifecycle.status='archived'`）

**卖点**：归档从"一个独立工具"变成"册的唯一写端的一个值" —— 它终于和别的写操作共用同一套形状闸 / 写授权 / 自洽闸 / 乐观锁。

```text
改前：edit_dsl {type:'file',op:'update',data:{lifecycle:{status:'archived'}}}
      ⇒ 拒「lifecycle.status **没有** `"archived"` 这个值」（T183 的专门文案）
改后：不带理由            ⇒ 拒「lifecycle.status="archived" 必须带 retire_reason」（点名缺什么）
      带理由 + merged_into ⇒ 落盘：archive_id=probe_wa__src_x_ts · removed_from_dsl=true
                             get_dsl query=archive ⇒ 1 条（src/x.ts → 合并到 src/y.ts）
                             get_dsl query=files  ⇒ 只剩 y/z（x 已移出 DSL）
                             目标文件 lifecycle.merged_from=['src/x.ts','src/z.ts']（两条路都记到）
别名：archive{action:node} ⇒ 首行「⚠ archive 已并入 edit_dsl（type=file, lifecycle.status='archived'）」+ 转发 updateFeature
      重复归档 ⇒ 「文件 "src/z.ts" 已归档过，勿重复归档」（与改前**逐字一致**）
读端：get_dsl query=archive（新建）· 坏条目分母仍住 storage.listArchiveEntries（扫了 N / 跳过 M + 名单）
工具面：wire 162,071 → **162,299 B（+228 B，已 --update 基线并写明理由）**
```

**边界**：别名仍生效一版且**仍不跑 L1–L4**（它没有 reason 入参，结构上无法执行 —— 与 `design_intent` 同一条）；
`archive_node.ts#listArchive` 仍是唯一渲染器（**没搬家**）；重复归档的外层文案多了 `edit_dsl` 的"操作 1/1 失败…"包装（内层逐字保留）。


## 2026-11-02 · `npm run verify:clean`：让"干净 clone 上的 CI 红"在**本地一条命令**复现

**卖点**：此前**没有任何本地命令**能回答"干净机器上哪几道门红、缺什么" —— 只有推上去等 CI。
现在一条命令造出**等同于 CI checkout 的环境**（`git clone --no-hardlinks` + `npm ci`，并断言
`HEAD` 一致 / 跟踪文件数一致 / 非跟踪条目 0），然后把 `verify` 的 `GATES` 与 `ci.yml` 的 `run:` 步骤
**逐条真跑**，逐门给 红 / 绿 / unsupported + **缺什么**（点名文件或数据类）。

```text
读数（HEAD 88049ea0 · 本机 · 7.0 min）
干净环境 15/19 步可绿（红 4 · unsupported 0）
红① archify vendor 自检   third_party/archify/ 整个目录不在仓里（git 跟踪 0）⇒ MODULE_NOT_FOUND
红② 设计 DB 结构          design-db/ 0 文件被跟踪 ⇒ 384 份投影全缺（verify 不像 gate 那样先 design:gen-db）
红③ 设计册判据            .agentio-data/projects.json 不入 git ⇒ CLI 认 0 册 ⇒ 判据 0 条（exit 2）
红④ 文档与事实            .agent-io/COGNITION.txt 不入 git、本地盘上也没有 ⇒ cognition:check 必红
对照（同一 HEAD、同一台机器）：npm run verify = 10/10 绿 · judge-all 473 条全过
⇒ 差别**全部**来自"盘上有不入库的文件"，不是代码
```

**边界**：它是**诊断工具不是门** —— 不进 `GATES`、退出码不表达红绿、不阻断任何人。
**一次运行 = 一次采样**：`实现夹具` 实测 3 次里 1 次红（冷 `.agent-io/cache.db` 下 `fileFacts().deps` 为空
⇒ `scripts/impl-fixture.mjs:47` 的 `realDep` 是 `undefined` ⇒ `normPath(undefined)` 崩溃；删掉 cache.db 后 **3/3 必崩**，
而 `MCP 工具签名` 会顺手建出 60.7 MB 的它 ⇒ 红绿取决于门序/时序）。
干净环境的落点**不许在系统临时目录下**：实测会让 `p0_registry_read_no_write` ⑥ **假红**
（它断言"本仓根是真项目根、必须保留"，而 `registry_repair` 的判据是"在系统临时目录下 ⇒ 候选"）。
`ci.yml` 的 3 OS 矩阵只在当前平台复放 1 次 [未核：另外两个 OS]。
门名单**只有一处权威**：`scripts/verify.mjs` 导出 `GATES` + `run()`，本工具 import 它们（不另写一份）。

## 2026-11-02 · `get_dsl query=locate`：给"改/加功能"补上第一步（功能 → 册里既有节点）

**是什么**：反向查询。给 `text`（功能描述 / 符号名 / 关键词）⇒ 设计册里最像的 top-N（分数 + 依据 + 权威位置
`design-db/<x>.calls.json` 的 symbols 条目 + 消费者），并**明说**"设计里没有"时搜了什么。
挂 `get_dsl` 的一个 `query` 值（**不新建工具**：工具面正收束）。

**算法**（写清用了哪套，不许假装确定）：VSM —— TF-IDF 加权余弦（feature location 标准基线：
Marcus et al. 2004 的 LSI、VSM-Lucene/LSI-Matlab 在实证比较里最好）+ 字面量通道（符号名/路径/原文包含）；
CJK 用**二元组**（一元组会把"读代码"排成任意含"代码"的文件）。住 `src/domain/locate_score.ts`（零依赖纯函数）。

**凭什么（可复现读数）**：
```bash
node dist/src/presentation/cli/cli.js get_dsl --json '{"query":"locate","text":"rename_symbols","project_dir":"."}'
node dist/src/presentation/cli/cli.js get_dsl --json '{"query":"locate","text":"生成 PDF 报告","project_dir":"."}'
node --import tsx --test tests/locate/locate_score.test.ts      # 5/5（双向：同义必命中 / 异义必不命中）
```
- 语料 3 册 / 1092 个节点（886 文件 + 206 非文件）· 耗时 载入 73~106ms + 建索引 26~63ms + 排序 2~4ms
  ⇒ **<200ms，不需要另建索引**（任务书担心的"384 份 design-db 全 load >3s"没有发生：本实现不读 design-db 全文，
  只为 top-N 读各自的投影）；
- 工具名/符号名查询：`rename_symbols` 1.047（自身 top-1）、`move_symbol` 0.884、`diff_views` 1.016、
  `consumer_tally` 0.744、`payload_budget` 0.696、`syntax_gate` 0.684 —— **全部 top-1 命中自身**；
- 册里确实没有的（`生成 PDF 报告`）：达标 0 条、`pdf` 的 df=0（册里一次没出现）、最高分 0.065 ⇒ 回执明说
  "设计里没有匹配"并列出搜了什么（**不是**空手返回）。

**边界**（如实写，别藏）：
- **只给候选不下判定**：Type-4 语义克隆无完备算法 ⇒ 每条候选带分数+依据，回执固定带免责句，由调用方逐个表态；
- **纯词法抓不到"无语汇重叠"的语义克隆**：`diff_views` 与 `design_line action=drift` 是一对已知重复，但两者
  词汇零重叠 ⇒ 互相**进不了**对方的候选（这正是 Type-4 开放问题的现场读数，不是实现 bug）；
- **自动生成职责的文件上中文描述偏弱**：`检查代码健康度` 0.133、`对拍设计视图` 0.115（都落"弱线索"档）；
  有手写职责的领域文件则 0.21~0.34；
- **`examples/` 之类的同名 fixture 目录会挤占 top 位**（`search` 查询 top-1 是 `examples/search/`）——
  非文件节点已按"容器不实现功能"减半字面量分，但没有从语料里排除任何路径（排除规则会变成第二处权威）；
- 消费者分两侧：代码侧 = `cache.db` 的 `edges kind='import'`（含 tests，未过滤）；设计意图侧 = `expected_deps`
  反查（本仓实测**全 0 条**，如实报 0 而不是"没查"）。

### 清点机制 `npm run inventory`（封闭清单 + 逼逐项填表 ⇒ 未填显形）

**它挡的事故**：语义相似度（VSM/TF-IDF）实测抓不到"同功能不同名"（Type-4 仍是开放问题），而 domain 模块 /
scripts / tests **没有封闭清单** ⇒ 重复件只增不减，且没人知道共有几件。

**机制**：`<dir>/*<ext>` 由命令自己 readdir 枚举成封闭清单 → 逐项填同一张固定表单
（`question` / `authority` / `overlap` / `criteria`，多出任何键拒收；`overlap` 少于 2 个具体候选也拒收）→
未填项进读数并**逐个点名** → 重扫按内容哈希对账（新增 ⇒ 未清点、内容变更 ⇒ 待复核）→
台账落 `dogfood/inventory/*.json`（键序固定、项按路径排序 ⇒ 可 diff）→ `--batch` / `--submit` 分批续跑。

**证**：节点 `file_scripts_inventory-sweep_mjs` 的 4 条 `behavior-cases`（对账四档 / 表单六类拒收 / 读数点名 /
分批切片）经金丝雀 harness 现跑全一致。
**可复现读数**：`npm run inventory` 打印 total / done / pending / stale / missing 与未清点项名单
（条数由命令自己打印，别抄）。

**边界**：① 只给"未填 / 待复核"的**可见性**，不判两个模块该不该合并（判「相同 + merge_into」仍是人的裁）；
② `consumers` 取 `cache.db` 的 imports 边，索引读不到就写 null 并点名原因（读不到 ≠ 没有）；
③ 词汇零重叠的语义克隆不会被候选机制自动发现 —— 只有逐项填表的人能看见。
