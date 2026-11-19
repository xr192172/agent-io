# CONTRIBUTING.md — 加 / 删工具与提交前检查

工具面唯一权威是 `ToolDef.description`；导航用 `capability_map`。任何文档都只是派生说明。

## 加一个工具

1. 在对应线实现 handler，失败抛出，不静默兜底。
2. 在该线 `index.ts` 的 `*_TOOLS` 加 `ToolDef`：`name` / `description` / `inputSchema` / `handler`。
3. `description` 首句必须写清"何时用"；`capability_map` 依赖它。
4. 若是线的新入口，更新 `capability_map.ts` 的 `LANE_META[].direct`。
5. 对外可见时更新根 README 两份，但不写死工具数；数字由 `docs/FACTS.json` / `gen-facts` 生成。
6. 结构化结论必须走统一数据信封；不要把结论只塞进人读文本。

## 删一个工具

1. 从 `*_TOOLS` 删声明。
2. 删独占实现与死模块。
3. 从 `capability_map.ts` 的 `direct` / 策展文本中删名。
4. 扫真实 import 与用户可见字符串（文档、错误提示、MCP instructions、语言提示）。
5. 用 `git rm` 保留可追溯性，不用批量 `rm`。
6. 重生成派生事实；不手抄计数。

## 提交前

```bash
npm run build
node scripts/mcp/mcp_scan.mjs
npm run verify
npm run tool -- <工具名> --json '<args>'
```

契约变更（工具名、签名、对外行为、MCP 注册名）必须同步文档；实现细节变更不制造文档噪音。

## 文档纪律

- 新内容优先进既有文档：INDEX / GUIDE-USAGE / GUIDE-GATE / DEVELOPMENT / FIELD-ALIGNMENT。
- `docs/todo.md` 是生成物，不手改。
- 日期快照、审计过程、陈旧数字不进当前基线；历史由 git 与 ledger 保存。
