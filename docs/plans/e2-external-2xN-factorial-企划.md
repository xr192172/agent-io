# E-2 外部 2×N 因子实验 · 研究简报与固定企划

> **性质**：只读研究 + 企划设计；**本批不施工 harness 代码、不写主仓、不 commit/push**。harness 代码施工待企划冻结后另派单写者。
> 执行人：trackB 只读分析 agent（`s_000V2XnI7EW`）；日期 2026-11-25。
> 衔接：E-1 契约优先可行性消融（内部纵向 delta）→ E-2 外部横向 2 臂对照；为加速度曲线提供外部锚点，为 L3 飞轮提供种子账本。
> 状态：**设计输入，不代裁**；标注「待裁」处须 Main 冻结口径后落地。

---

## 1. 结论先行

1. **实验形态**：{带 AgentIO 工具臂 A, 裸模型臂 B} × N 模型 × 同一任务集，**配对对照**（同一任务实例两臂都跑），同模型 / 同 harness 壳 / 同任务 / 同预算，唯一受控差 = AgentIO 工具集是否可用。
2. **主指标 = complete-delivery（任务级全契约通过）**，口径对齐 SWE-CoWork「Pass rate」：同一轮内该任务**全部** F2P + P2P 测试节点通过；**不以 F2P（部分交付）作主指标**。secondary：F2P 节点通过率、P2P 保持率、节点四态（pass/fail/skip/unsupported）、override/绕判动作计数、自报完成但测试失败数。
3. **裁判 = 基准自带隐藏可执行测试（外部 oracle）**，AgentIO/模型自报完成不计分；测试在隔离容器内由 oracle 侧执行，代理侧不可见、不可改、不可挂钩（防 conftest 式结果注入）。
4. **成本双轴**：token（命中/未命中输入、输出、缓存档分层）+ 时延（墙钟小时、模型调用数、工具调用数、上下文压缩次数）；按冻结日价目重算每完成任务成本。
5. **staging 先小后扩**：smoke（1–2 任务 × 2 臂 × 2 模型）→ 子集（~10–15 任务 × 4 模型：DeepSeek V4 Pro / V4.1 Flash / Kimi K3 / Qwen3.8-Max，Flash 档可选）云主机/CI 并行 → 扩 N。
6. **前提如实登记**：SWE-bench 系任务多 Python/Linux；AgentIO TS 核心跨平台可跑；**Windows 耦合门（Java/Maven 委托链、Go 构建门、本机 Git/PATH 探测、win32 专属命令）排除出 eval 臂**；harness 接 AgentIO 工具投影属集成工作，本批只设计。
7. **关键待裁分歧**：① 基准选 SWE-CoWork 现成数据集 vs SWE-bench Verified 自建子集（license/接入可行性待核）；② Arm A 暴露的 AgentIO 工具面边界（只读查询 vs 写回台账）；③ override 计数的操作化定义。见 §10。

---

## 2. 外部基准机制研究（一手来源）

### 2.1 SWE-CoWork（本实验主参照口径）

来源：arXiv:2611.20218（2026-11-15 预印本，TokenWave AI）；代码 `github.com/TokenWave-AI/swe-cowork-bench`；数据集 HF `Tokenwave-AI/swe-cowork`。

**任务结构**（GitHub 仓库 README 核验，2026-11-25 可访问）：
- 101 个开发任务，来自 101 个上游真实仓库；11 种编程语言、12 个应用域；语言分布 JS 21 / Python 19 / TS 10 / PHP 10 / Ruby 9 / C# 9 / Java 8 / Go 6 / C++ 4 / Rust 4 / Kotlin 1。
- 需求共 **2,712 条**（同僚持有 2,217、记录持有 495）；每任务 16–32 条，中位 28；82% 需求握在同僚手中。
- 全发布契约：论文 §5.1 记 **2,699 F2P + 562 P2P 节点**；HF 数据集卡记 2,701 F2P + 561 P2P（微小口径差，以运行时 `release/MANIFEST.json` 为准）；每任务中位 32 个验证节点；**221 个摘要钉扎（digest-pinned）容器镜像**，公共 registry 支持匿名拉取。
- HF 数据集已核验公开：`Tokenwave-AI/swe-cowork`，101 行 parquet，552 MB；许可标 `other`（论文 CC BY 4.0；任务资产保留上游开源许可，发布方不授予第三方代码新 blanket license）。
- 代理接口：终端 + **17 个工作场所工具，经单一 MCP 服务器暴露**（board/docs/reviews/artifacts/people/chat/help 七组）；单任务 **8 小时**执行预算。
- 模拟组织：26 名规则化数字同僚（4–6 名持有需求）；工作场所含项目板、版本化文档、评审、工件、历史聊天。代理从 `/task/README.md` 短备忘出发，检索记录、咨询同僚、调和冲突证据、实现并写 `/app/SOLUTION.md`。
- 裁判：**私有可执行测试**，不对代理公开；run 结束后 harness 捕获已提交与未提交改动，**在全新评分容器重放**后跑隐藏测试；同僚由固定模型兜底，保证两臂交互面一致。
- 仓库布局（可复用参照）：`release/`（101 任务 + 钉扎运行时 + `cowork` CLI）；`eval-kit/claude-harness/`、`codex-harness/`（两套 campaign runner）；`eval-kit/common/`+`services/`（共享模块、API 桥、同僚重试代理）；`eval-kit/scoring/`+`analysis/`（计分、补丁重判、轨迹分析、需求-测试映射）；`eval-kit/ops/`（磁盘清理、失败重派、沙箱缓存）；`docs/`。
- 宿主前置：Linux/amd64 + Docker Engine + Python 3.10+ + 同僚模型 Responses API 端点；任务 039/093 另需 root controller / systemd / cgroup v2 / runc。
- 许可：任务资产保留上游开源许可与版权声明；发布方不对第三方代码授予新的 blanket license（接入时须逐任务核对许可与再分发口径）。

**指标公式（论文 §5.1，逐字口径）**：

设任务 i 的 F2P/P2P 通过节点数为 f_i / p_i，总数为 F_i / P_i，N=101：

```
F2P      = 100 · Σf_i / ΣF_i          （跨任务节点池化，部分交付）
P2P      = 100 · Σp_i / ΣP_i          （既有行为保持）
Pass rate= 100/N · Σ 1[f_i=F_i ∧ p_i=P_i]   （任务级全契约通过 = complete-delivery）
```

F2P/P2P 池化按测试节点加权；Pass rate 是任务级二值，要求同一轮内全部节点通过。

**基线参考读数（Table 2，11 模型 CoWork 档，外部锚点用，非本实验成绩）**：

| 模型 | F2P % | P2P % | Pass rate % |
|---|---|---|---|
| Claude-Opus-5.5 | 63.84 | 93.24 | 6.93 |
| GPT-6 Astra | 62.91 | 89.15 | 7.92 |
| Seed Evolving | 39.09 | 94.48 | 0.99 |
| Qwen3.8-Max | 35.70 | 91.80 | 0.00 |
| GLM 5.3 | 31.27 | 87.72 | 0.99 |
| Qwen3.8-Flash | 30.70 | 93.40 | 0.00 |
| DeepSeek V4.1 Flash | 28.20 | 94.30 | 0.00 |
| Kimi K3 | 27.08 | 84.88 | 0.99 |
| GLM 5.2 | 24.40 | 95.20 | 0.00 |
| Seed 2.1 Pro | 21.01 | 81.85 | 0.00 |
| DeepSeek V4 Pro | 13.04 | 90.21 | 0.00 |

**轨迹/成本遥测口径（论文 §5、Appendix G）**：每 run 中位数模型调用数、输入/输出 token、工具调用数、上下文压缩次数、同僚消息数、墙钟小时（上限 8h）；输入 token 含重复处理的留存上下文，不等于探索量。论文另报：31% 被代理自报完成的需求最终测试失败；94 个禁止改既有测试的任务中 15 个提交补丁改动/删除了既有测试源码（约束违例）。

**可信度边界**：预印本未经同行评审；公司方出品；第三方独立复现未确认。本实验只取其**指标口径与任务形态**作参照，不把其绝对分数当 ground truth。

### 2.2 SWE-bench 系（备选基准与工程范式参照）

来源：swebench.com 官方指南/FAQ/API；OpenAI SWE-bench Verified 介绍。

- 机制：生成补丁应用到真实仓库快照，在容器化 Docker 环境跑仓库测试；`FAIL_TO_PASS`（修复前失败、修复后通过）+ `PASS_TO_PASS`（前后均通过，防回归）；两集合全过才算 resolved。
- 数据集：SWE-bench 全量 2,294 / Lite 300 / Verified 500（人工标注可解、测试范围适当）；任务以 Python 开源仓库为主，Linux + Docker 镜像（每实例预装 base_commit 与 conda 环境）。
- 裁判隔离：报告产物 `report.json` / `test_output.txt` / `run_instance.log` / `eval.sh` / `patch.diff`；退出分类 resolved/unresolved/empty patch/error/infrastructure failure/ambiguous failure。
- **已知作弊面（harness 必须设防）**：代理与测试同容器时有完整文件权限，可经 `conftest.py` 钩子在 pytest call 阶段改写结果为通过（BenchJack 类攻击）；评测必须把 verifier 测试置于代理不可写/不可挂钩的隔离层，oracle 在代理特权边界外判分。
- 污染风险：基准任务取自公开 GitHub，基座模型可能预训练见过答案；账本须记录模型 cutoff 与任务日期，解读分数时标注。

### 2.3 对照实验方法论参照

- 配对设计 + 任务级 bootstrap 重采样（n=10,000，95% CI）；二值成败对比用 **McNemar 2×2 配对表**；连续成本/时延用 **Wilcoxon 符号秩**（配对差值非正态）。来源：arXiv:2608.17177（spec-driven test generation 实证）。
- harness 效应隔离：同模型跨 harness 配对对照；独立 KVM microVM / 追加只写事件台账；Docker 隔离 oracle；墙钟上限取消的 run 单列（22/81 超时取消 run 实际已产出通过补丁，不可直接计失败）；成本按冻结价目从原始逐轮用量重算。来源：arXiv:2609.11987（Harness or Model?）。
- 小样本纪律：报告效应量 + CI + 最小可检测效应（MDE）；underpowered 的阴性结果不得读作「无差异」。

---

## 3. 实验设计（2×N 因子）

### 3.1 因子与臂定义

| 因子 | 水平 | 说明 |
|---|---|---|
| 因子 1：AgentIO 工具集 | Arm A `agentio`：投影 AgentIO 只读/受控工具集进 harness 工具面；Arm B `bare`：同一 harness 壳，不接 AgentIO 工具 | **唯一受控差** |
| 因子 2：模型 | N ∈ staging 递增：{DeepSeek V4 Pro, DeepSeek V4.1 Flash, Kimi K3, Qwen3.8-Max}，可选 Qwen3.8-Flash；后续扩 | 每模型两臂各跑同一批任务 |
| 配对单元 | (model, task) 对 | 同一任务实例在 A/B 两臂各跑一次；任务快照、备忘、同僚/记录环境两臂一致 |

**Arm A 工具投影面（待裁边界，§10-Q2）**：首期建议只投影**只读查询类**——项目索引/符号查询、契约与判据册查询、历史台账/证据检索、覆盖/边界提示；**不投影写回类**（台账回写、册修订、门执行）到 eval 沙箱，避免臂间混入写面行为差异。AgentIO 自带验证环（契约测试/突变/回放）是否作为工具暴露，列为待裁项。

**Arm B 裸模型**：保留 harness 必需的通用工具（shell/文件编辑/检索/终端），与 Arm A 完全同源；差别仅在于 AgentIO 专属工具集挂载与否。

### 3.2 控变量清单（两臂必须一致）

- 模型版本与推理强度（reasoning_effort / 温度 / 种子策略）；
- harness 壳与 scaffold（同一 CLI/SDK 版本，提示词骨架同源，仅工具表不同）；
- 任务快照（base_commit / 仓库状态 / 备忘 / 同僚与记录环境）；
- 预算上限：墙钟秒数、总 token 上限、工具调用次数上限（两臂同帽；超限取消单列，不直接计失败）；
- 同僚模型（若用 CoWork 组织模拟）固定同一兜底模型；
- 重试策略、并发档、沙箱镜像规格、判据版本与裁判快照；
- 提示词中不得出现「你在用/未用 AgentIO」的臂标签泄漏。

### 3.3 指标体系

**主指标（complete-delivery）**：
- `complete_delivery` ∈ {0,1}：任务级二值，同一轮内全部 F2P + P2P 节点通过（对齐 CoWork Pass rate 公式）。
- 汇总：Arm A/B 各模型 complete-delivery 率；配对任务差值（A 胜 / B 胜 / 平）；任务级 bootstrap 95% CI。

**secondary 指标**：
- `f2p_rate` / `p2p_rate`：节点池化通过率（部分交付面，辅助归因，不替代主指标）；
- **节点四态**：每测试节点 `pass / fail / skip / unsupported`（口径沿用 AgentIO 三态退出码 + unsupported 单列；skip 不计通过）；
- `override_count`：代理尝试绕判/覆盖验收/自标完成/改写判据的动作次数（操作化定义待裁，§10-Q3；轨迹日志编码）；
- `self_reported_complete`（交接文档自报完成）与 `self_report_fail_count`（自报完成但 oracle 失败的需求/节点数）——对应论文 31% 假完成现象；
- `constraint_violations`：改动既有测试源码、删除/注释断言等违例计数（对应论文 15/94）；
- 轨迹侧（归因用，不计主分）：同僚消息数、首次编辑前检索量、跟进率、未读披露数、上下文压缩次数。

**成本双轴**：
- Token：输入未命中 / 输入命中（缓存档）/ 输出，分层记录；
- 时延：墙钟小时、模型调用数、工具调用数、首编辑延迟；
- 金额：按**冻结日价目表**重算 `estimated_cost_usd`，并列「每完成任务成本」（成本/complete-delivery 任务数），避免只看成功率。

### 3.4 外部隐藏测试裁判接入

1. 裁判测试随任务快照预置在沙箱**代理不可写层**；代理工作副本与测试副本分离（或测试目录只读 + 挂载后置入）。
2. oracle 在代理 run 结束后（或超时）独立执行测试，解析输出得到四态节点表；代理进程无权触发/修改 oracle 执行。
3. 判分只认 oracle 节点表；代理交接文档、AgentIO 自报 verdict 一律不进分子。
4. 裁判版本快照（基准数据集版本 / eval.sh / 解析器版本）入账本，保证可复现。
5. 防注入核查：提交补丁 diff 扫描测试目录改动、`conftest.py`/钩子文件新增、断言改写；违例单列，不计通过。

---

## 4. 可复现 harness 设计（设计稿，不施工）

### 4.1 架构分层

```
┌─ 编排层 (orchestrator)：任务派发 / 并发档 / 预算帽 / 重试 / 台账落盘 / 账本汇总
├─ 代理层 (agent loop)：模型客户端 + harness 壳 + 工具表（A 臂挂 AgentIO 投影，B 臂不挂）
├─ 沙箱层 (sandbox)：每任务独立容器/微VM；仓库快照只读基层 + 可写工作层；测试只读层
├─ 裁判层 (oracle)：测试执行 + 节点四态解析 + 判分；特权边界外，追加只写日志
└─ 证据层 (ledger)：per-(model, arm, task) 账本 JSONL + 补丁/交接/轨迹/裁判报告归档
```

**投影接缝**：参照 CoWork 单 MCP 服务器挂 17 个工作场所工具的形态，Arm A 的 AgentIO 工具经同一 MCP/工具适配层挂载；Arm B 仅卸除 AgentIO 投影适配器，工作场所工具与终端两臂同源。裁判重放参照其「捕获改动 → 全新评分容器重放 → 跑隐藏测试」流程。

### 4.2 Arm 工具接线

- **Arm A**：AgentIO 工具经投影适配器接入 harness 工具表；首期只读（§3.1）；工具调用全部进轨迹台账，可回放。
- **Arm B**：工具表 = 通用 shell/编辑/检索；AgentIO 投影适配器不加载。
- 两臂共用同一模型客户端封装与预算计量中间件，成本/时延埋点位置一致。

### 4.3 账本 schema（per-(model, arm, task)，JSONL 一条一 run）

```json
{
  "run_id": "e2:<bench>:<model>:<arm>:<task>:<trial>",
  "bench": "swe-cowork | swebench-verified",
  "bench_version": "release-contract-2026-11",
  "model": {"name": "deepseek-v4-pro", "version": "DeepSeek-V4-Pro-0813", "cutoff": "YYYY-MM"},
  "arm": "agentio | bare",
  "task": {"task_id": "...", "repo": "...", "base_commit": "...", "language": "...", "domain": "..."},
  "harness": {"scaffold": "...", "scaffold_version": "...", "prompt_skeleton_hash": "...", "seed": 1},
  "colleague_model": {"name": "...", "version": "...", "effort": "high"},
  "budget_cap": {"wall_s": 28800, "token": null, "tool_calls": null},
  "started_at": "ISO8601", "finished_at": "ISO8601",
  "wall_seconds": 0, "status": "completed | error | timeout | empty_patch | infra_failure",
  "outcome": {
    "complete_delivery": 0,
    "f2p": {"passed": 0, "total": 0},
    "p2p": {"passed": 0, "total": 0},
    "node_states": [{"node_id": "...", "state": "pass|fail|skip|unsupported"}],
    "override_count": 0,
    "self_reported_complete": false,
    "self_report_fail_count": 0,
    "constraint_violations": []
  },
  "cost": {
    "input_tokens_miss": 0, "input_tokens_hit": 0, "output_tokens": 0,
    "model_calls": 0, "tool_calls": 0, "compactions": 0,
    "price_snapshot": "2026-11-25-list",
    "estimated_cost_usd": 0,
    "cost_per_completed_task": null
  },
  "environment": {"image_id": "...", "isolate_id": "...", "tests_writable_by_agent": false},
  "evidence": {"patch_diff": "rel/path", "handoff": "rel/path", "trajectory": "rel/path", "judge_report": "rel/path"},
  "judge": {"oracle_version": "...", "eval_sh": "...", "parser_version": "..."},
  "meta": {"retry_of": null, "notes": "", "infra_flag": false}
}
```

汇总视图（派生，不入库原始事实）：按 model×arm 聚合 complete-delivery 率 / F2P / P2P / 成本中位 / 时延中位 / 配对胜负表 / CI。

### 4.4 复现与隔离要求

- 每 run 独立隔离体；快照镜像预构建（仓库 + 依赖 + 测试层），避免运行时现装网络抖动；
- 台账追加只写；原始用量（逐轮 token/调用）保留，金额由冻结价目重算，不接受代理侧自报成本；
- 错误分类对齐 SWE-bench 口径：error / timeout / empty patch / infra failure / ambiguous，infra 失败单列不计入模型成败；
- 同任务可多 trial（待裁次数），账本保留 trial 序号与聚合口径（首过 vs 中位）。

---

## 5. Staging 路线（先小后扩，云主机/CI 并行）

| 阶段 | 范围 | 模型 | 任务数 | 目的 / 出口准则 |
|---|---|---|---|---|
| S0 smoke | 1–2 任务 × 2 臂 × 2 模型 | DeepSeek V4.1 Flash、Kimi K3 | 1–2 | harness 打通：隔离/裁判/账本/成本埋点全链路；产物可回放；出口=账本字段齐套、oracle 判分可复现 |
| S1 子集 | 配对子集（语言/域分层抽，含 Python/TS/Go 等） | DeepSeek V4 Pro、V4.1 Flash、Kimi K3、Qwen3.8-Max | ~10–15 | 首组外部对照读数；Arm A/B 配对差值 + 方向信号；成本双轴初值；出口=每模型两臂子集跑完，CI 可复现 |
| S2 扩 N | 同子集扩模型；视 S1 信号扩任务 | 待裁（可加 Qwen3.8-Flash、GLM、Seed 档） | 扩 | 效应量/CI 收敛；按 MDE 反推所需任务数；发布收据 |
| S3（可选） | 全量基准 | N 模型 | 全量 | 重量级 CI；长窗预算；不占本机 |

并行：云主机/CI 队列按任务×模型×臂派发；并发档与本机轻量档解耦；S0/S1 不跑全量。

---

## 6. 前提登记与排除清单

### 6.1 环境前提

- **基准侧**：SWE-bench 任务以 Python/Linux 为主；SWE-CoWork 宿主要求 Linux/amd64 + Docker Engine + Python 3.10+ + 同僚模型 API 端点；容器/微VM 为 Linux 环境；eval 不在 Windows 本机跑。CoWork 任务 039/093 需 root/systemd/cgroup v2/runc，纳入子集时单列环境前提。
- **AgentIO 侧**：TS 核心（索引/台账/契约/裁决 CLI/HTTP 服务）Node 跨平台，Linux 容器可运行；依赖 node 运行时与仓内派生构建。
- **工具链前提**：eval 镜像内按任务语言准备运行时（Python/node/go 等）；模型 API 凭据与网络出站在 CI/云主机配置。

### 6.2 排除出 eval 臂的 Windows / 本机耦合门（只读核对自主仓 src）

| 排除项 | 仓内位置锚点 | 排除原因 |
|---|---|---|
| Java 委托链（javac/java 单文件工具、MyBatis 转储、Maven runner） | `src/infrastructure/java_tools/exec_java_tool.ts`、`src/application/java_tools/mybatis_contracts.ts` | 依赖 JDK/Maven 本机工具链；Linux eval 镜像未预装；属 AgentIO 本机域能力，不计入外部工具增益 |
| Go 构建/测试门 | `src/infrastructure/analysis/contract_gate/index.ts`、`submit_gate/index.ts` 等 go 子进程调用 | 无 Go 工具链时 fail-closed 不可用；任务集 go 语言样本如需此门，另在镜像装 go 后再纳入 |
| 本机 Git/PATH 探测 | `src/infrastructure/git.ts`、`exec_guard.ts` 命令解析 | 依赖宿主 git 与 PATH；eval 快照以 base_commit 为准，不走本机 git 状态 |
| win32 专属命令 | `src/presentation/http/serve.ts` 打开目录分支（explorer/xdg-open） | 平台分支，eval 不触达 |
| 本机夹具/绝对路径假设 | `tests/fixtures/*` 仓内夹具 | eval 用基准任务快照，不复用本机夹具 |

> 排除清单的判据：**该门依赖本机专属工具链或宿主状态，在 Linux eval 镜像内不具备等价前置**；排除后 Arm A 投影的是跨平台 TS 核心能力。被排除门不参与两臂对照，也不在外部账本中计分。

### 6.3 集成工作（待施工批处理，本批不做）

- AgentIO 工具投影适配器（只读查询面 → harness 工具表）；
- 基准数据集接入（CoWork HF 数据集 / 自建 SWE-bench Verified 子集）与快照镜像构建；
- oracle 裁判隔离层与四态解析；
- 账本汇总/统计脚本与发布收据模板。

---

## 7. 与 E-1 的衔接（纵向 delta × 横向 2 臂）

| 维度 | E-1（内部消融） | E-2（外部因子） |
|---|---|---|
| 对照形态 | 逐项移除单个能力，纵向 delta（A/B/C/D 子系统内） | 带/不带整体工具集，横向 2 臂对照 |
| 任务域 | 仓内取形的合成/有界子系统 | 外部真实仓库任务集 |
| 裁判 | 内部契约测试 + 突变 + 回放（作者同源，有同源偏差） | 基准隐藏可执行测试（外部 oracle，不自判） |
| 读数性质 | 内部可行性/瓶颈归属 | 整体工具增益的外部方向与量级 |
| 样本 | n=1/臂，合成最小系统 | 配对任务集，统计 CI 约束 |

**校准关系**：E-1 的内部消融读数（如封闭域 92.3%、新颖域 88.9%、整册前置减少返工）是机制层证据；E-2 外部锚点回答「挂上这套工具后，在外部任务上 complete-delivery 与成本是否改善」。两者互证：E-2 正向而 E-1 无机制解释处，回查盲区；E-1 机制预测而 E-2 未显信号处，查投影面/ harness 损耗。

**与加速度曲线的关系**：内部曲线（七批基线段五指标）是自我开发速度的内部回溯；E-2 账本提供**外部锚点**——按 (model, arm) 记录 complete-delivery 率 + 每完成任务成本，作为曲线起飞后外部对照基线；L3 飞轮种子 = 这套 per-run 账本结构与轨迹遥测，回流到内部台账体系。

---

## 8. 产出形态

1. **可复现 harness 设计**：本文 §4 冻结后，施工批交付编排/代理/沙箱/裁判/证据五层实现 + 配置快照。
2. **per-(model, arm, task) 账本**：§4.3 schema；原始 JSONL 追加只写，汇总视图派生。
3. **外部锚点数据集**：Arm A/B 配对读数进加速度曲线外部锚点节，标注基准版本与样本边界。
4. **发布收据**：每阶段一份——任务集版本、模型/臂/样本量、主指标与 secondary、成本双轴、CI 区间、未决项与复现入口；对齐内部「发布收据」口径（只报可核验读数，无源项标无源）。

---

## 9. 统计口径（S1 起适用）

- 主指标 complete-delivery：任务级二值；**配对 McNemar 检验**（A 胜/B 胜/平 2×2 表）；任务级 bootstrap 10,000 次重采样给 95% CI。
- 连续量（成本、时延、token、调用数）：**Wilcoxon 符号秩**配对差值；报告中位 + IQR。
- 样本量：S1 小样本只报效应方向 + CI + 描述性胜负；不做显著断言；S2 按预设 MDE 反推任务数（80% 功效、双侧 0.05）。
- 阴性结果纪律：CI 跨 0 且 underpowered ⇒ 记「证据不足」，不记「无增益」。
- 多重比较：多模型/多指标对照做 BH-FDR 校正，预登记主指标与 secondary 清单。

---

## 10. 风险与待裁分歧

| # | 待裁项 | 备选 / 现状 | 影响 |
|---|---|---|---|
| Q1 | 基准选择：SWE-CoWork 现成数据集 vs SWE-bench Verified 自建子集 | CoWork 仓库与 HF 数据集均已核验公开（release/CLI、两套 harness、scoring、221 钉扎镜像；HF 101 行 552MB，许可 `other`，任务资产保留上游 OSS 许可）。待核：逐任务上游许可与再分发口径、私有测试在自有 harness 重放流程、同僚模拟离线复现；Verified 工程范式成熟、Python 单语为主作退化备选 | 决定 harness 裁判层与任务快照设计 |
| Q2 | Arm A 工具面边界 | 首期建议只读查询；写回台账/册修订/验证环是否暴露待裁。写面会混入行为差异，需单独因子控制 | 影响臂间受控差纯度 |
| Q3 | override 计数操作化 | 候选定义：轨迹中绕判据/自标完成/改测试/请求豁免的动作序列计数；边界（检索判据算不算 override）待 Main 冻结 | 影响 secondary 口径 |
| Q4 | 多 trial 次数与聚合 | 首过口径 vs 中位口径；S1 建议单 trial 保配对纯度，S2 再定重复 | 影响样本量与成本 |
| Q5 | 模型 API 可用性与凭据 | DeepSeek V4 Pro/Flash、Kimi K3、Qwen3.8-Max/Flash 的接入渠道、并发档、价格冻结日；Flash 档是否入 S1 | 影响 staging 排期 |
| Q6 | 污染与记忆 | 记录模型 cutoff 与任务日期；公开任务可能被记忆；分数解读标注 | 影响结论边界 |
| Q7 | 超时取消 run 口径 | 已产出通过补丁但触顶取消的 run 单列（参照 arXiv:2609.11987 的 22/81 现象），不直接计失败 | 影响主指标分母 |

**重大分歧提示**：若 SWE-CoWork 私有测试/组织环境不可复跑，主参照退化为 SWE-bench Verified 口径（任务级 resolved = F2P+P2P 全过），complete-delivery 定义不变；同僚/需求检索轨迹层在 Verified 上不可得，对应 secondary 标无源。此切换不改变 2×N 臂设计与账本骨架。

---

## 11. 外部一手来源 URL

**SWE-CoWork**
- 论文 PDF：https://arxiv.org/pdf/2611.20218v1.pdf
- 项目页：https://tokenwave-ai.github.io/swe-cowork-page/static/SWE-CoWork.pdf
- 代码：https://github.com/TokenWave-AI/swe-cowork-bench
- 数据集：https://huggingface.co/datasets/Tokenwave-AI/swe-cowork
- 二手报道（非一手，仅交叉参考）：https://i10x.ai/news/coding-agents-swe-cowork-organization-benchmark-study ；https://dev.to/shakeelahmed/ai-coding-agents-ace-benchmarks-but-finish-under-8-of-simulated-workplace-tasks-heres-the-gap-l2f ；https://mlq.ai/news/ai-coding-agents-fully-finish-fewer-than-1-in-10-tasks-in-a-simulated-workplace-test/

**SWE-bench**
- 评测指南：https://www.swebench.com/SWE-bench/guides/evaluation/
- FAQ（数据集/指标/缓存口径）：https://www.swebench.com/SWE-bench/faq/
- Harness API 枚举（ResolvedStatus/TestStatus）：https://www.swebench.com/SWE-bench/api/harness/
- Verified 介绍（OpenAI）：https://www.openai.com/index/introducing-swe-bench-verified/

**方法论**
- 配对统计（bootstrap/McNemar/Wilcoxon）：https://arxiv.org/html/2608.17177
- harness 效应隔离 / 微VM / 成本重算 / 超时取消：https://arxiv.org/html/2609.11987

**模型计费与工具调用特性**
- DeepSeek 价目（缓存命中/未命中、峰谷、并发）：https://api-docs.deepseek.com/quick_start/pricing ；中文页 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
- Kimi K3 价目与上下文缓存/工具调用：https://www.kimi.ai/resources/kimi-k3-pricing ；缓存控制 API：https://platform.kimi.ai/docs/api/responses
- Qwen3.8 价目（Max/Flash，隐式/显式缓存）：https://help.aliyun.com/en/model-studio/qwen3-8-max ；https://www.alibabacloud.com/help/en/model-studio/qwen3-8-flash ；总览 https://help.aliyun.com/en/model-studio/model-pricing

**成本参考摘录（冻结日 2026-11-25，落地前须按官方页复核）**

| 模型 | 输入未命中 /1M | 输入命中 /1M | 输出 /1M | 备注 |
|---|---|---|---|---|
| DeepSeek V4.1 Flash | $0.15（峰 $0.30） | $0.003（峰 $0.006） | $0.60（峰 $1.20） | 1M 上下文；并发 2500 |
| DeepSeek V4 Pro | $0.66（峰 $1.32） | $0.022（峰 $0.044） | $1.98（峰 $3.96） | 1M 上下文；并发 500 |
| Kimi K3 | $3.00 | $0.30 | $15.00 | 1,048,576 上下文；自动缓存 5m/1h；支持工具调用/JSON/结构化输出 |
| Qwen3.8-Max | CNY 12 | CNY 1.5（隐式缓存） | CNY 36 | 显式缓存读 CNY 1；国际档另价 |
| Qwen3.8-Flash | $0.113 | $0.014（隐式缓存） | $0.382 | 显式缓存创建 $0.177 / 读 $0.014 |

> 峰谷/地区/促销价随时变动；账本 `price_snapshot` 必须记录取价日期与渠道，金额可重算。

---

## 12. 内部衔接证据指针

- E-1 合并报告：`artifacts/e1-contract-first-feasibility-abcd.md`（A 92.3% / B 88.9% / C 整册前置 0 修订 vs I 3 修订 / D 杠杆=scoped 验证）
- 加速度曲线证据册：`artifacts/acceleration-curve-baseline-evidence.md`（七批基线段五指标与无源清单）
- 阶段 2 G8 消融台账/报告：`artifacts/phase2-ablation-runs.jsonl`、`phase2-g8-ablation-report.md`（内部 holes/选择口径，外部实验不替代内部覆盖证明）
- 企划冻结版：`C:\Users\admin\DoubaoWork\chats\2026-11-22\new-chat-2\AgentIO增量覆盖证明-M1-M10裁决表与G1-G10闭合企划.md`

## 13. 边界声明

- 本企划未实现任何 harness 代码；未在主仓新增/修改文件；未跑基准任务；未调用模型 API 产生计费。
- 外部分数（CoWork 表）仅作锚点参照；本实验结论以自有配对账本读数为准。
- 待裁项冻结前，Arm A 工具面、override 口径、基准选择不得视为既定设计。
