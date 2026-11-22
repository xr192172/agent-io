# GUIDE-GATE.md — 门、判据与失败语义

## 1. 权威

- 门清单：`scripts/verify.mjs#GATES`，本文不抄门数。
- 判据 kind 与强度：`src/domain/expectation_kinds.ts#KIND_SPECS`，本文不抄种数。
- 工具输入/输出与错误码：`ToolDef.description` 与 `src/domain/gate_error.ts#GATE_RULES`。
- gate event 与 error 的机器可读码在拒绝文案里；人读码表从这些唯一源现算。

## 2. 四态

| 判据结论 | 含义 | 能否核销 |
|---|---|---|
| `pass` | 独立预期被满足 | 可作为通过证据 |
| `fail` | 有明确反例失败 | 不能 |
| `unsupported` | 缺前置条件 / 判不了 | 不能 |
| `pending` | 等待外部条件 | 不能 |

`unsupported` 与 `pending` 不算违反，也不算通过。读不到、表不存在、索引陈旧、主体缺失，都按判不了处理，不能折成 0 条或 pass。

## 三、判据 kind 表

判据词表的唯一机器权威是 `KIND_SPECS`；下表是当前使用导航，不写固定种数。新增/退役词时先改注册表和本表，再跑对齐测试。

| kind | 回答的问题 | 不能证明什么 | 相位 |
|---|---|---|---|
| `file-exists` | 文件是否存在 | 行为是否正确 | post |
| `symbol-exists` | 符号是否由 AST 识别 | 调用与语义是否正确 | post |
| `signature-matches` | 签名是否符合约定 | 函数体是否正确 | post |
| `edge-exists` | 指定依赖边是否存在 | 是否调用了正确符号 | post |
| `edge-absent` | 禁止的依赖是否不存在 | 新行为是否实现 | pre |
| `call-exists` | 某符号是否调用目标 | 更完整的行为结果 | post |
| `run` | 隔离表达式对当前输入求值的结果 | 不会执行同名 shell 命令 | post |
| `source-has` | 文本约束是否满足 | 逻辑行为是否正确 | post |
| `behavior-cases` | 独立给定输入是否产生独立预期 | 未覆盖场景是否正确 | post |
| `journey-cases` | 多步交付旅程是否达到终态 | 未声明的副作用是否正确 | post |
| `domain-independent` | 域边界是否被违反 | 域内实现是否正确 | pre |
| `runtime` | 运行事件是否满足规则 | 没有事件时不能判通过 | post |

## 3. 判据强度

- 弱判据：`file-exists` / `symbol-exists` / `source-has` / `signature-matches`。只能查存在、形状或注释附近，发现不了逻辑错。
- 强判据：有独立预期的 `behavior-cases` / `call-exists` / `domain-independent` / 真实运行对拍。
- `run` 只在隔离求值器中计算给定表达式，**不会执行文案里写的 shell 命令**；需要命令级证据时必须看真实 `command + observed` 回执，不能拿 `run` 冒充。
- 能用强判据就不用弱判据；弱判据存在类只用于防已退役对象复活。
- 判据必须能回答："造什么坏输入它会红？"说不出来就不是判据。

## 4. 门的规定

当前总门的名称与顺序如下；实现权威是 `scripts/verify.mjs#GATES`。改门时必须同步实现、本表与对应契约测试。

| # | 门 | 验证对象 |
|---|---|---|
| 1 | ts 类型 | TypeScript 类型与编译 |
| 2 | 工具链完整 | 后续门所需工具与依赖是否完整 |
| 3 | MCP 工具签名 | 工具注册与输入输出契约 |
| 4 | Go 编译 | Go 辅助实现可编译 |
| 5 | Go 静态检查 | Go 辅助实现静态约束 |
| 6 | 实现夹具 | 受控实现场景 |
| 7 | 设计 DB 结构 | 设计投影与结构归属 |
| 8 | 设计册判据 | 当前判据真实执行结果 |
| 9 | 判据突变 | 判据遇到反例是否有鉴别力 |
| 10 | 文档与事实 | 文档、事实和生成视图是否一致 |
| 11 | 测试 | 行为与结构回归 |
| 12 | 结构意图 | 文件与目录的结构归属 |
| 13 | 无卡写账 | 写盘是否有责任卡或明确例外 |
| 14 | 派生条目要求权 | 派生事实是否越过设计意图 |
| 15 | 索引可信度 | 索引 verdict 是否 trusted（陈旧断言 / 未同步 / 幽灵行） |
| 16 | 任务镜像对账 | tasks.db 权威行与 tasks.jsonl 投影是否一致 |
| 17 | 结案投影点名 | 册单侧结案投影点名（报告区，一期不判红） |

- `npm run verify:changed` 是日常入口，只验本次改动及影响闭包。
- `npm run verify` 是发布前/公共底座变更/用户明确要求时的总门；一次跑完全部门，语义不变。
- `verify` 不跑 `build`；改 `src/` 后先 `npm run build`，否则工具吃旧 `dist`。
- `verify` / `mutate` / `judge-all` / `npm test` 互斥，锁被占时测试会假红。
- 文档与事实门检查派生视图新鲜度：不要通过删检查对象让门变绿。
- 缓存体消费前必须按当前判据复核，缓存键随判据口径变化；旧规则在缓存里绕过新判据，是假绿。

## 5. 写门

- 改源码必须有已领取的施工卡。
- 重写计划必须点名锚点、判据引用、计划外改动和 untouched 表态。
- 读集冲突、owner ≠ actor、租约代际、前置依赖未完成是真实损坏类闸，不能因首跑模式关闭。
- `gate:'exempt'` 是显式豁免，不是默认放行。

## 6. 假绿清单

出现以下情况，门不算修好：

1. 检查对象被标 stale / excluded / retired，从分母退出。
2. 判据变成恒真，或只证明"词出现过"。
3. 读不到被当 0 条、`unsupported` 被折叠为 pass。
4. 手改生成视图后检查分母变小。
5. 通过删除测试、删判据、改检查范围让绿。

## 7. 判据变更流程

```text
edit_dsl 写判据 → design:gen-db → design_line plan → edit_code
→ design_line judge → edit_dsl complete
```

`complete` 的 evidence 必须有 command 与 observed；写不出就不收口。改判据后跑 `node scripts/judge-all.mjs`，不要把改册当公共底座全量变更。

## 8. 码表：族与码数（机器源 = `src/domain/gate_error.ts` 的 `GATE_RULES`）

| 族 | 覆盖范围 | 码数 |
|---|---|---|
| `E-PLAN` | 画布 / 重写计划 | 23 |
| `E-TASK` | 任务卡 / 领取 / 收口 | 8 |
| `E-CLAIM` | 可领性与租约 | 18 |
| `E-CRIT` | 判据校验 | 7 |
| `E-EVD` | 证据 | 5 |
| `E-WRITE` | 写闸 | 4 |
| `E-REASON` | 变更原因 | 6 |
| `E-GENDB` | 设计 DB | 2 |

码数合计 73。★ 本表与源码逐族相等是**判据**（漂了就红），不是读数誊抄。

<!-- DOC:GEN:guide.gates:BEGIN source=guide.gates@9a17faf7171da909 cmd="npm run doc:render" format=docs-view-v1 generator=docs-view.render@0.1.3 body_sha256=bf4a075236a2ac52 -->
| 门名 | 来源 |
|---|---|
| ts 类型 | `scripts/verify.mjs#GATES` |
| 工具链完整 | `scripts/verify.mjs#GATES` |
| MCP 工具签名 | `scripts/verify.mjs#GATES` |
| Go 编译 | `scripts/verify.mjs#GATES` |
| Go 静态检查 | `scripts/verify.mjs#GATES` |
| 实现夹具 | `scripts/verify.mjs#GATES` |
| 设计 DB 结构 | `scripts/verify.mjs#GATES` |
| 设计册判据 | `scripts/verify.mjs#GATES` |
| 判据突变 | `scripts/verify.mjs#GATES` |
| 文档与事实 | `scripts/verify.mjs#GATES` |
| 测试 | `scripts/verify.mjs#GATES` |
| 结构意图 | `scripts/verify.mjs#GATES` |
| 无卡写账 | `scripts/verify.mjs#GATES` |
| 派生条目要求权 | `scripts/verify.mjs#GATES` |
| 索引可信度 | `scripts/verify.mjs#GATES` |
| 任务镜像对账 | `scripts/verify.mjs#GATES` |
| 结案投影点名 | `scripts/verify.mjs#GATES` |
<!-- DOC:GEN:guide.gates:END body_sha256=bf4a075236a2ac52 -->
