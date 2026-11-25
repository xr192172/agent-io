# AgentIO 外部审计交接简报（单发审计专用 · 预算≈40–50 次工具调用）

> 读者：外部审计模型（建议 soul）。本简报目的：让你在**一次运行、约 40–50 次调用**内完成高价值审计。
> 仓库：`D:\Projects\ai\agentio\dev\agent-io`，审计基线 HEAD=`ae09b71a`（若已移动，先 `git log -1` 重导锚点）。
> 本简报已预消化架构与证据。**你的调用应花在“验证最高风险论断”，不要花在发现架构、重跑全量、或重裁已冻结决策。**

## 0. 预算纪律（先读，违反=浪费预算）
- 不要重跑全量测试/17 门/突变（证据已在 §4 预计算）。
- 不要重新推导架构（§1–§2 已给）；不要重裁 §3 冻结决策（如要推翻，按 §6 模板单独论证）。
- 按 §5 阅读顺序走（≈15–20 调用），留 ≈20–30 调用做 §4 靶点验证与输出。
- 每次 Read 尽量整文件/大段；用 Grep 定位行号再 Read 区间，避免逐行小读。
- 方向审计（§1.5）与代码审计同等重要；它以判断为主、仅需≈3 次读锚点调用，不得跳过。

## 1. 一句话命题与三能力
AgentIO＝**模型无关·契约中介·证据驱动的确定性项目重写引擎**；统一单元＝“外部项目”（含把自己首版生成当外部）。
三能力：① 得契约；② 契约→源码；③ 证据驱动改源码。模型＝外部语义算力；系统＝确定性执行/权限/证据/恢复/记录。
核心纪律：每类事实**一处权威**、其他入口只是投影；反补丁、按病因做最小但完整的结构性重写；**绿≠完成**（证据收口）。
**愿景与未来发展的完整论证见 §1.5；方向审计与代码审计同等重要，不要只审代码。**

## 1.5 愿景与未来发展（方向审计，与代码审计同等重要）
- **终局愿景**：程序开发操作系统——统一管理程序事实/意图/任务/执行/验证/协作，任意 Agent 接入即可理解项目；终局＝单 Agent 独立开发项目，近期＝多 Agent 快速接管＋可信协作。模型＝外部语义算力；系统＝确定性执行/证据/恢复/记录，凭完整问题表述实现稳定可控自我迭代（RSI）。
- **架构哲学弧**：能力优先黑盒组合(契约/assume-guarantee/refinement)→开盒提取同构→正交算子内核(read/write/derive/verify/commit/schedule)→权威边界(同构仅域内提取、跨域密封靠契约+证书)→三轴(读共享最大化/写验密封)→范畴六律＝可测试 property。
- **独特性/护城河**：承认组件层商品化；护城河＝单一权威下集成＋trust-gated scoped＋meta-gate；唯一真实威胁＝平台集成（MCP 把能力收编）。宣传＝早公开/窄楔子/硬证据（证据>绿）。
- **吸收管线**：老文献五栏复核＋死亡三分类（证明不可能/contingent 成本墙/社会学死亡）；幸存者＝代码源（抄90%换10%）、死者＝愿景源；AgentIO 定位＝最后10%完成机。
- **路线图与节奏**：阶段1收口→P2根因→S线调度→P3最后全量→P4 S-line接线→scoped 信任起飞（内循环几天）→全量退场（观察期 K=2周日历~2-3周）。慢源＝复核/红归因/裁决 round-trip/单写者串行（前置信任投资，非施工）。E-2＝2×N 发布“收据”。
- **方向审计靶点**（判断为主，少量调用）：V1 护城河对 MCP 平台集成是否真 defensible？V2 路线排序是否最优（先信任后起飞 vs 先功能）？V3 “单一权威+trust-gated”是否正确的窄楔子？V4 愿景是否过宽（OS vs 重写引擎边界）？V5 吸收管线能否真产出最后10%？V6 慢源诊断是否成立、有无更便宜的信任建立路径？
- **阅读锚点**（≈3 调用）：企划 §15 统一 thesis＋§9 append-only；审计附件 附录B/C/D.5/D.6/D.7；《AgentIO自我开发加速度曲线-首条回溯》。

## 2. 接管快速链（我们设计的 fast-path，直接用）
顺序：`capability_map` → `index_integrity` → `design_line` → `ledger` → 源码+Git。
- 能力/权威地图：`.agent-io/design/agent-io.dsl.json`（设计册，file/symbol 节点+expected_apis）。
- 索引可信：`.agent-io/cache.db`（派生，不入库）+ `src/infrastructure/index/symbols.ts`。
- 判据/四态：`scripts/judge-all.mjs` + `.agent-io/judge-readings.json`（pass/fail/unsupported/pending）。
- 账本：`.agent-io/{tasks.jsonl,task-history.jsonl,ablation-runs.jsonl}` + `scripts/lib/heavy_lock.mjs`（单写者）。

## 3. 单权威地图（fact → authority，直接跳，别全仓扫）
| 事实 | 权威文件 | 关键锚点 |
|---|---|---|
| 符号/跨文件边/增量 | `src/infrastructure/index/symbols.ts` | resolveIncrementalBatch / resolveCrossFileCalls（R4 兜底捞 pending） |
| 验证/车道汇总/继承 | `scripts/verify.mjs` + `scripts/lib/env_contract.mjs` | aggregateLane(~1038) 防稀释护栏；verify_inheritance 键面闭包 |
| 门能力分类 | `scripts/lib/gate_caps.mjs` | reads/writes/side_effect/pool/rank 一处登记 |
| 调度原语 | `scripts/lib/{exec_slots,dag_plan,concurrency_policy,preempt_guard}.mjs` | P-CPU 计数/P-DB-WRITE mutex/acquire 立即 fail/cancel-point |
| 判据/四态 | `scripts/judge-all.mjs` | 唯一执行核，不造第二把尺 |
| 历史侧车/落点 | `src/infrastructure/decision_history.ts` + `storage.ts` | baseDir 透传(86-87/145-183)；storage 408-431 |
| 消融/holes | `src/infrastructure/analysis/facts/incsel_ablation.ts` + `scripts/incsel-audit.mjs` + `run-tests.mjs --audit-ablation` | 索引守卫 trusted=false⇒exit2 |
| 环境契约 | 仓根 `env-contract.json` + `scripts/lib/env_contract.mjs` | 本地+CI 共读，漂移 fail-closed |

## 4. 预计算证据（不重跑，直接引用）
- 基线只升：238 文件；门 8 判据 900（agent-io 893 + toolface 7）；判据闸 Actions 893/0/unsupported=0。
- 突变：各批突变牙红→还原绿；门 9 全局 mutate killed=5/survived=0（阶段1）。
- CI：判据闸绿+门7结构两车道 PASS+MCP 语义42/42；两车道*未全绿*，残留=clean-clone 缺派生缺口族（已归因，非回归）。
- 自我开发加速度曲线：七批基线段（质量地板7/7 PASS），起飞点=S-4+holes=0 后。
- holes 现状：light 抽样 holes=[] 为**平凡空**，非227全量闭合；观察期已起钟（K=2周，最早2026-12-09）。

## 5. 审计靶点（把有限调用花在这，按风险排序）+ 阅读顺序
1. **信任层是否真可信**：holes=0 证据充分性（light 平凡空 vs 227 全量）；verify_inheritance 键面闭包是否漏依赖。读 `incsel_ablation.ts`+`verify.mjs` 继承段。（2–3 调用）
2. **防稀释护栏可绕过否**：aggregateLane 的 offLane 声明能否被滥用把红门洗绿。读 `env_contract.mjs` aggregateLane+`gate_caps.mjs`。（2 调用）
3. **meta-gate 真不可变否**：评估器/harness 在仓内，施工批能否改尺子。读 `judge-all.mjs`+manifest/校验和。（2 调用）
4. **R4 兜底过保守/漏捞否**：resolveIncrementalBatch 全库兜底捞 pending 的边界。读 `symbols.ts`。（2 调用）
5. **投影保结构否（函子律/漂移）**：baseDir 单权威是否消除分叉。读 `decision_history.ts`+`storage.ts`。（2 调用）
6. **同构提取越权威边界否**：内核提取是否熔了借来引擎/评估域。读审计附件 D.5/D.6。（1 调用）
7. **E-2 设计混淆**：污染/裁判/分母/override。读 E-2 企划（若已交付）。（1–2 调用）
先读：企划 §15+§13（1 调用）→ 审计附件（1 调用）→ 加速度曲线（1 调用）。代码靶点 1–7 ≈12–15 调用；方向靶点 V1–V6 以判断为主、读锚点已含在上列 3 调用内。合计≈15–20，余≈20–30 验证+输出。

## 6. 冻结决策（不重裁；要推翻按模板论证）
M2′基线三分／M3′契约边界选点／S-EXEC 9分歧／读共享·写验密封／权威边界(同构域内提取)／borrow-first(借内核非工具)／老文献死亡三分类／范畴六律=可测试property／E-2 2×N(complete-delivery主指标·外部裁判)。

## 7. 输出模板（一次运行必须产出）
按严重度 C/H/M/L 列 finding，每条：`文件:行号` + 问题 + **novel 还是 known**（known 见§4/隔离清单）+ 最小修复建议。
另设三节：① “你会推翻哪条冻结决策、为什么”（证据+代价）；② “预算内未能验证的论断”（诚实边界）；③ **方向审计**：对 V1–V6 逐条给判断（护城河/路线排序/窄楔子/愿景边界/吸收管线/慢源），若认为愿景或路线需调整，给出论证与替代排序。
不要输出架构复述（§1–§3 已有），只输出*增量*判断。

## 8. 模型与预算建议
soul（规划经济性）优于 Astra（防御性/啰嗦浪费调用）于本预算；但**简报质量>模型选择**。若只能跑一次，把本简报+§5 靶点+§7 模板一次性喂入，禁止其自由探索。