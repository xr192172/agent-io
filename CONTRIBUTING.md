# 贡献指南

加 / 删工具要动哪几处。不设单元测试套件，验证 = build + 真调。

## 加一个工具

| # | 动哪里 | 改什么 | 必做 |
|---|---|---|---|
| 1 | `src/application/<线>/handlers.ts`（或该线子目录） | 实现 handler；失败抛出，不静默兜底 | 是 |
| 2 | `src/application/<线>/index.ts` | 在 `<LINE>_TOOLS` 加 `ToolDef`：`name` / `description` / `inputSchema`(zod) / `handler` | 是 |
| 3 | 同上，`description` 首句 | 写清「何时用」——`capability_map` 的 `when` 取首句 | 是 |
| 4 | `src/application/meta/registry/capability_map.ts` 的 `LANE_META[].direct` | 这是该线入口、或该线还没有门时，把名字加进 `direct`（composed 面 = `direct` ∪ 派生链；线无门 ⇒ 编排面上不可达） | 新入口时 |
| 5 | `scripts/gen_agents.mjs` 的 `TRIGGER_ROWS` | 加「开发动作 → 工具 → 一句说明」，再跑 `node scripts/gen_agents.mjs` | 有对应开发动作时 |
| 6 | `README.md` / `README.en.md` 工具表 | 加一行 | 对外可见时 |

- 线归属由 `src/application/tool_registry.ts` 的 `LANE_SOURCES`（`index.ts` → 线 id）表达，加工具时不动它。
- 任何地方都不写死工具总数。

## 删一个工具

| # | 动哪里 | 改什么 |
|---|---|---|
| 1 | `src/application/<线>/index.ts` | 删该 `ToolDef` |
| 2 | `handlers.ts` / 子目录 | 删实现与它独占的模块 |
| 3 | `src/application/meta/registry/capability_map.ts` | 从 `LANE_META[].direct` 删名字 |
| 4 | 全仓旧名 | `rename_symbols report_literals=true` 或 `explore_code action=search` 扫文档 / 错误提示 / 注册名 |
| 5 | 文档 | 删 README 工具表那一行 + `TRIGGER_ROWS` 行，重跑生成器 |

## 提交前

```bash
npm run build                    # gen_agents + tsc + clean_dist
node scripts/mcp/mcp_scan.mjs    # 逐个调 handler 守卫，抓坏签名（需 dist/）
npm run verify                   # 总门，见 docs/GUIDE-GATE.md
npm run tool -- <工具名> --json '{...}'   # 真调
```

- 验证 = build → 真调一遍，哪里坏修哪里；不回头补测试。
- 契约变更（工具名 / 签名 / 对外行为 / MCP 注册名）才同步文档；实现变更不碰文档。
- `AGENTS.md` 是产物：改 `scripts/gen_agents.mjs`，不手改。
