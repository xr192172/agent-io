# 环境坑

> 只有现状。坑变了改这张表；方法论型的坑不进这里。

| # | 坑 | 症状 | 对策 | 在哪 |
|---|---|---|---|---|
| P1 | `docs/*` 默认被 ignore | `git add docs/新文档.md` 报 `paths are ignored`，`git status` 看不到 | 一次性 `git add -f`；长期在 `.gitignore` 加 `!docs/新文档.md`（已跟踪的文件不受影响） | `.gitignore:125` |
| P2 | MSYS 路径转换 | Git Bash 里 `/d/...` 能跑，`node` 拿到 `D:\...`；路径比对 / `endsWith` 失守 | 用 `path.join` / `process.cwd()`；比对前 `\` → `/`；`git add` 用相对路径 | `normPath` |
| P3 | `grep` 读中文 `\r\n` 报 0 | 中文关键词明明存在却搜不到 | 用 Grep 工具或 `node` 读，不用 `grep` | Git Bash |
| P4 | 配置文件 ≠ 实际行为 | 读配置或注释得出的结论与实际不符 | 先抓 request / header / MCP `initialize` 与 `tools/list` 原文；两者不一致以 request 为准 | MCP 请求 |
