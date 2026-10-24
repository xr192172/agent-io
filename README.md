# agent-io

![CI](https://github.com/xr192172/agent-io/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)
![MCP](https://img.shields.io/badge/MCP-server-7c3aed.svg)

[中文](README.md) · [English](README.en.md)

![dsl-workbench 沙盘视图（真实 DSL 渲染）](assets/demo-workbench.png)

**agent-io 是一个"先设计、后实现"的开发底座**：标准 MCP server + CLI，供 AI Agent（Claude Code / DeepSeek Harness / Pi 等任意 MCP 宿主）使用。它把"**设计说了什么**"与"**代码实际是什么**"分开记账，中间用**机器可判定的验收判据**连接——设计说了、代码没做，**立即变红；红即任务；有人领取；做完可验**。

## 核心机制

### 1. 设计册与设计数据库 —— 意图与事实分开记
- **设计册**（`.agent-io/design/*.dsl.json`）只记**意图**：职责、决策、验收判据——不镜像代码内容，代码**事实**一律现取现算。
- **设计数据库**（`design-db/`）：从设计册生成的逐文件投影（400+ 份），含现状符号、期望符号、反向调用边——"改这里会影响哪里"的一跳查询。
- **覆盖对账**：盘上文件、设计册节点、排除清单三方对齐，任何文件要么被设计、要么被显式排除、要么出现在缺口清单上——**没有沉默的盲区**。

### 2. 验收判据 —— 契约的三层
| 层 | 判据 | 回答的问题 |
|---|---|---|
| 声明契约 | `signature-matches` / `symbol-exists` | 函数**长什么样** |
| 副作用契约 | `call-exists` / `edge-absent` | 函数**悄悄做了什么** |
| 行为契约 | `behavior-cases`（给定输入→断言输出，差分对拍） | 函数**算得对吗** |

判据挂在设计册的决策卡上，求值器对**当前代码**现取现判——四值语义（pass / fail / unsupported / pending）："判不了"永远不冒充"通过"。

### 3. 判据求值 —— 全量常规化 + 三档缓存
- 每次总览读数都**全量求值**（数百条判据）：过时的验收标准当天现形，而不是红了一个月没人知道。
- **一阶内容哈希缓存**：目标文件未变 → 复用上次判定（不再解析）；变了 → 只重算受影响判据。实测：677 条判定两连跑 **577 命中 / 0 不一致**。

### 4. 任务系统 —— 多 Actor 天然支持
- 任务五态（candidate → preparing → claimed → done/void），**两段式领取**（先领后开工，前置判据就位才能 start）。
- **读集冲突检测**：领取时声明要读的符号与文件，与活跃任务的读集相交即拒——并发协作防撞。
- **收口闸**：完成必须通过全部后态判据 + 提交可复跑证据。
- **完成即入史**：已了结任务整卡归档（独立审计库），继任链（`follows`）记录工作的一环扣一环。
- **子代理即另一个 Actor**：底座不内置编排，任何代理以自己的身份领卡干活即可——委派、隔离、对账全部由任务系统承载。

### 5. 唯一写原语 —— 变更必有闸
源码修改只有一个入口 `edit_code`：**写闸**校验"这次修改是否挂在你领取的任务上"，**读集**之外的写入被拒，写后自动同步索引并重算受影响判据。失败即回滚到调用前字节——没有半成功状态。

### 6. 工具面投影 —— 一个注册表，多个视图
61 个原子工具的注册表支持按面暴露：默认 `AGENT_IO_MCP_FACE=all`；`=composed` 只暴露编排面（15 个组合工具）+ 一个原子入口 `atomic_call`（其余能力仍可达）——**工具载荷 -77.5%**，编排面由数据派生（门名单 ∪ 派生链），永不与原子面漂移。

### 7. 读侧三层 —— 从总览到细节
`overview`（跨库总账，KB 级）→ `digest`（逐文件职责与状态）→ 按需下钻（单文件 / 单符号 / 单任务）。每一层都是同一账本的投影。

## 快速开始

```bash
npm install
npm run build                      # 生成 agent 目录 + tsc + 清理 dist
npm run verify                     # 唯一的门（9 项：类型/签名/Go/夹具/语义/结构/领取/证据）
npm start                          # MCP server（stdio）
npm run serve                      # HTTP 引擎
```

接入任意 MCP 宿主：

```json
{
  "mcpServers": {
    "agent-io": {
      "command": "node",
      "args": ["/path/to/agent-io/dist/src/presentation/mcp/server.js"]
    }
  }
}
```

**沙箱建议**：在宿主侧禁用原生文件与 Shell 工具、只保留 agent-io 的工具面——所有文件变更即自动经过判据与闸（"纪律物理化"）。

## 架构

```
presentation/   MCP server · HTTP 引擎 · CLI（同一注册表的三个投影）
application/    用例层：判据求值 · 任务系统 · 设计册读写 · 对拍
domain/         词汇表：判据 · Actor · 状态机（唯一权威，无 IO）
infrastructure/ 存储 · 索引 · 解析器（TS/Go/Java/Python）· 归档库
```

依赖单向向下；domain 的类型与语义被上下两层共同引用。

## 工具

不写死总数。权威清单 = `src/application/tool_registry.ts` 的 `TOOL_DEFS`；人类可读快照 = `capability_map`（由注册表派生）。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/INDEX.md` | 唯一入口：目录 / 工具 / 状态 / 未完成 |
| `docs/GUIDE-GATE.md` | 门、证、判据、写路径规矩 |
| `AGENTS.md` | 开发动作 → 必用工具 |
| `CONTRIBUTING.md` | 加 / 删工具要动哪几处 |

## 相关仓库

- [dsl-workbench](https://github.com/xr192172/dsl-workbench) —— 可视化前端（沙盘视图）

MIT License
