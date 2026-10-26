# agent-io

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)
![MCP](https://img.shields.io/badge/MCP-server-7c3aed.svg)

[中文](README.md) · [English](README.en.md)

**agent-io 是一个面向 AI Agent 的开发底座（MCP server）**：把"先写设计、再写代码、验收机器判"变成一套可执行的机制，而不是一套约定。它不是编排框架，不是模型，也不是 Agent 本身——它是底下那层**记账 + 闸门 + 手术刀**。

> **Evidence-Driven Agent Engineering** — 让"先写设计再写代码"变得**可验证而非可祈祷**。

## 真实案例

一个独立 Agent 通过 agent-io 的完整流程（写设计 → 挂卡 → 领任务 → 施工 → 对拍）交付了一个完整子系统：它写了自相矛盾的验收判据（**被 checker 抓住**）、想没证据就收口（**被闸门拒绝**）、想静默改别人的文件（**被读集冲突拒绝**）——最终 18/18 条机器验证通过。这套机制不是设计文档里的理想，是跑通过的流程。

<!-- FACTS:TOOLS:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->
## 六条能力线（63 个工具，全部证据闸控）

> 工具数与语言矩阵的**唯一事实源**是 [docs/FACTS.json](docs/FACTS.json)（`node --import tsx scripts/gen-facts.mjs` 生成）；本节数字由它回写，**勿手改**。分线：observe 11 / cross 5 / design 9 / meta 16 / refactor 19 / harvest 3。
<!-- FACTS:TOOLS:END -->

### ① 认知 —— 快速且准确地了解项目全貌
- **explore_code**（search / read / facts / arch_layer / **guided_tour**）：agent 三分钟读懂陌生项目
- **feature_line**：功能主链（入口函数 → 调用链）
- **contract_page**：给一个符号名，一次给全六块（定义/成员/调用方/契约/…）
- **impact_analysis**：改前风险闭包——"我要改这里，会炸哪里"
- code_health / structure_gap / detect_drift / diff_views / index_integrity

### ② 设计册 —— 意图与事实分开记账
- **设计册**（`.agent-io/design/`）只记意图：职责、决策、**机器可判的验收判据**——代码事实一律现取现算
- **对账**：盘上每个文件要么被设计、要么被显式排除、要么出现在缺口清单——没有沉默盲区

### ③ 判据闸 —— 灵魂所在
- **九种判据**：symbol-exists / signature-matches / source-has / **behavior-cases**（真跑代码差分对拍）/ run / …
- **四值语义**：pass / fail / **unsupported** / pending——"判不了"永远不冒充"通过"
- **真实战果**：独立 Agent 写出自相矛盾的判据 → 被 consistency_check 当场抓住

### ④ 任务闸 —— 多 Agent 协作的秩序
- **两段式领取**（publish → claim）：判据没补全进不了 claimed
- **读集冲突拒领**：两个 Agent 静默改同一文件？当场点名拒绝
- **完成要证据**：自审只值 0 分，证据带指纹——代码变了证据自动过期

### ⑤ 手术刀 —— 基于 AST 的精确重构
- **edit_code**：符号级语义编辑——**不依赖行号与 old_string 文本匹配**（杜绝改错行/改错函数）
- rename_symbols / rename_files（批量+全仓 import 联动）/ move_symbol / **move_domain**（一次搬一域）
- **plan_refactor → apply_refactor_plan**（先算清单→预览→幂等批量落盘）+ **refactor_pipeline**（失败只回滚到最近绿点）

### ⑥ 翻译 —— 跨语言迁移的双层架构
- **翻译 DSL（映射意图）→ 翻译 DB（对应物投影）→ 往下写翻译代码**——与设计侧同构
- **translate_go_ts**：Go→TS 骨架机械生成 + 验证闸 + **known/unknowns 回执**（事实与推测显式分离）
- **硬依赖账**：不能翻译的依赖带策略字段（npm 等价 / 同位替代 / HTTP 桥接），由 Agent 按图决策

<!-- FACTS:LANG:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->
## 语言支持（诚实版）

- **AST 解析**：33 门已装全量（tree-sitter；名册共注册 55 门，装了才能用——`capability_audit` 一键自检）
- **语义操作**（改名/契约闸/影响面等）：9 门全量，其余覆盖度递减（`capability_audit` 一键出缺口清单）

> 数字由 scripts/gen-facts.mjs 回写自 docs/FACTS.json（roster/installed 随机器与版本变），**勿手改**。
<!-- FACTS:LANG:END -->

## 快速开始

```bash
git clone https://github.com/xr192172/agent-io.git
cd agent-io && npm install && npm run build

# 在你的 MCP 宿主配置里（任何支持 MCP 的 Agent）：
{
  "mcpServers": {
    "agent-io": {
      "command": "node",
      "args": ["/path/to/agent-io/dist/src/presentation/mcp/server.js"],
      "env": { "AGENT_IO_HOME": "/path/to/data-dir" }
    }
  }
}

# 精简工具面（推荐日常用）：
env: { "AGENT_IO_MCP_FACE": "minimal" }   # 高频工具优先，能力不减（atomic_call 可达其余）
```

第一个任务建议：让 Agent 对你的项目跑 `import_project`，然后 `get_dsl query=overview` 看全貌。

## 设计原则

1. **同生态位吸收**：出现更高级的工具 → 吸收旧的，全方面只留一个，最终吸收进设计侧
2. **吸收原则优先于立新席**：新能力优先合并进既有子代理/工具
3. **不许压缩上下文**：任务接力靠交接包（已完成+证据 / 未完成+剩余 / 发现与坑 / 下一步）
4. **自审不能替代验收**：验收对照完成预期逐条判定，证据不足判未完成

## 路线图

- [x] 六线工具面 + 判据闸（本版本）
- [x] 翻译双层（翻译 DSL → 翻译 DB → 翻译代码）
- [ ] 语言包接续文档（"如何为 agent-io 添加一门语言"+ 参考实现）
- [ ] DSH 插件版（完整自进化 Agent：九席 + 记忆库 + review-hub，含可视化——见 agentio-plugin 仓）
- [ ] 纯净版独立分发（npm 包 / SEA 单文件）

## License

MIT
