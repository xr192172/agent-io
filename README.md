# AgentIO

**让 AI 干的活变得可托付。**

AgentIO 是一个目标驱动的程序开发引擎：用户给目标，模型做必要的语义判断，引擎负责定位事实、展开设计、约束写入、执行机械改造、验证结果并维护证据。它不是模型，不是 Agent 编排器，也不承诺"结构与设计一致就是设计优秀"。

## 工作循环

```text
理解项目事实 → 写出设计意图与判据 → 展开为有归属的工作项
→ 受控写入 → 重建事实 → 对账并核销
```

- **理解**：从源码、索引、测试和现有设计得到相关上下文。
- **设计**：允许目标结构暂时不同于当前实现，并保存理由和验收方式。
- **改造**：按设计差异逐步重构、新增、退役或翻译。
- **对账**：证明哪些要求已落实、哪些未落实、哪些无法判断。

## 四个核心部件

| 部件 | 作用 |
|---|---|
| 判据 | 把"做完了"写成可验证的独立承诺；`pass/fail/unsupported/pending` 四态中不把"判不了"当通过 |
| 写闸 | 源码写入的唯一受控通道；无卡、计划外、过期计划、读集冲突都拒 |
| 设计册 | 意图、决策、判据、卡和计划的声明式载体；源码事实不复制成第二份可编辑真相 |
| 台账 | append-only 事件流；挂账、批注、销账、裁定留痕，历史不能被静默改写 |

<!-- FACTS:TOOLS:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->
## 六条能力线（41 个工具，全部证据闸控）

> 工具数与语言矩阵的**唯一事实源**是 [docs/FACTS.json](docs/FACTS.json)（`node scripts/gen-facts.mjs` 生成）；本节数字由它回写，**勿手改**。分线：observe 5 / cross 4 / design 6 / meta 11 / refactor 15。
<!-- FACTS:TOOLS:END -->

<!-- FACTS:LANG:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->
## 语言支持（诚实版）

- **AST 解析**：31 门已装全量（tree-sitter；名册共注册 55 门，装了才能用——`capability_audit` 一键自检）
- **语义操作**（改名/契约闸/影响面等）：9 门全量，其余覆盖度递减（`capability_audit` 一键出缺口清单）

> 数字由 scripts/gen-facts.mjs 回写自 docs/FACTS.json（roster/installed 随机器与版本变），**勿手改**。
<!-- FACTS:LANG:END -->

## 快速开始

新机器五步见 [使用与安装指南](docs/GUIDE-USAGE.md)。最短路径：

```bash
git clone https://github.com/xr192172/agent-io.git
cd agent-io
npm install
npm run build
npm run env:check
```

然后在 MCP 宿主中配置 AgentIO server；具体参数、首跑模式和本地数据目录见 `docs/GUIDE-USAGE.md`。

## 诚实现状

- 已在本仓与夹具中运行：设计册、判据、写闸、台账、增量验证、多模型席位协作。
- 毛坯：新手需要理解的概念仍多；diff 审阅和错误提示还在改进。
- 未证明：独立非本仓项目的完整闭环仍需作为下一阶段验收。

## 文档

- [现状与文档入口](docs/INDEX.md)
- [目标、非目标与阶段出口](docs/PROJECT-DESIGN.md)
- [安装、使用与 Tailscale 安全边界](docs/GUIDE-USAGE.md)
- [开发、验证、席制与当前下一卡](docs/DEVELOPMENT.md)
- [门、判据和失败语义](docs/GUIDE-GATE.md)
- [用户愿景原文](docs/VISION-ORIGINAL.md)
- [当前仍有效的否决与回炉条件](docs/RETIRED.md)

MIT License.
