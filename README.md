# agent-io

![CI](https://github.com/xr192172/agent-io/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)
![MCP](https://img.shields.io/badge/MCP-server-7c3aed.svg)

[中文](README.md) · [English](README.en.md)

![dsl-workbench 沙盘视图（真实 DSL 渲染）](assets/demo-workbench.png)

## 是什么

- 标准 MCP server：把设计意图 / 决策 / 契约编码成结构化 DSL JSON（`.agent-io/design/*.dsl.json`）。
- 语义层只记**意图**（职责 / 决策 / 目标）；代码**事实**由 `explore_code` / `consistency_check` 现取现算，对不上就报差异，不回填。
- 代码改造走受控流水线：符号级编辑 `edit_code` → diff 审批 → 运行时对账 → 失败回滚。
- 入口：MCP / bin = `dist/src/presentation/mcp/server.js`；HTTP 引擎 = `dist/src/presentation/http/serve.js`。
- 本仓**没有页面**；可视化前端是独立仓库 [dsl-workbench](https://github.com/xr192172/dsl-workbench)。
- 工具面缺省 `AGENT_IO_MCP_FACE=all`；`=composed` 只注册编排面 + 一个原子入口 `atomic_call`。

## 怎么跑

```bash
npm install
npm run build                      # gen_agents + tsc + clean_dist
npm start                          # MCP server（stdio）
npm run serve                      # HTTP 引擎
npm run verify                     # 唯一的门；三态退出码见 docs/GUIDE-GATE.md
npm run demo                       # 注入示例 + 起引擎（--prepare 只注入，-- 8081 换端口）
npm run hub                        # 只起引擎，不注入示例
npm run doctor                     # 环境体检 + 能力矩阵缺口
npm run tool -- <工具名> --schema   # 看入参
npm run tool -- <工具名> --json '{}' # 真调一个工具
node scripts/install_mcp.mjs       # 写进各 MCP client 配置（--list / --dry-run / --target <平台>）
```

MCP client 配置：

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

## 工具

不写死总数。权威清单 = `src/application/tool_registry.ts` 的 `TOOL_DEFS`；人类可读快照 = `capability_map`（由注册表派生）。

## 文档

| 文件 | 是什么 |
|---|---|
| `docs/INDEX.md` | 唯一入口：目录 / 工具 / 状态 / 未完成 |
| `docs/GUIDE-GATE.md` | 门、证、判据、写门规矩 |
| `AGENTS.md` | 开发动作 → 必用工具 |
| `CONTRIBUTING.md` | 加 / 删工具要动哪几处 |

MIT
