# PITFALLS.md —— 环境坑清单（★ 唯一来源）

> ★ **这份是"环境坑"的唯一来源。** 各 skill 里只写「见 `PITFALLS.md#P1`」，**不再各抄一遍**。
> ★ 为什么必须集中（2026-10-18 实测）：**`PATH 正常` 与 `PATH 损坏` 两种说法同时存在于三份 skill**
>   ⇒ 一份过期 ⇒ **三份同时错**。环境坑最会变，所以只许有一处。
> ★ 本文只收「环境坑」（会随机器/工具版本变的东西）。
>   **方法论型的坑**（证据分级 / 未核实清单）**不进这里** —— 它不随环境变，进 `GUIDE-DESIGN.md`。

---

## P1 · `docs/` 被 `.gitignore` 忽略 ⇒ 新建文档要 `git add -f`

**症状**：`git add docs/新文档.md` 报 `The following paths are ignored by one of your .gitignore files`，`git status` 里看不到它。

**为什么**：本仓 `.gitignore` 用 `docs/*` + 白名单（只放 `DESIGN.md` / `VISION.md` / `ARBITRATION.md` 等）。
**新文档默认被忽略** —— 这是有意的（防止随手写的草稿进 git），**不是 bug**。

**怎么避（两条，选一）**：
1. **一次性**：`git add -f docs/新文档.md`
2. **长期**：在 `.gitignore` 的 `!docs/DESIGN.md` 那几行旁**加一条白名单**（`!docs/新文档.md`）

★ **别做的事**：把 `docs/*` 整个放开（那会让所有草稿进 git）。

**原文出处**：`dc-remove-tool` §六 / `dc-open-parallel-line` §二.1 / `git-repo-hygiene` §八（三处都写过 ⇒ 本文件收口）

---

## P2 · MSYS 路径陷阱（Windows 上的 Git Bash）

**症状**：脚本里写 `/d/project/...` 在 **Git Bash 里能跑**，但 **`node` 拿到的是 `D:\project\...`**（或反过来）；
路径比对/`endsWith`/正则全线失守。

**为什么**：Git Bash 的 MSYS 层会做**路径转换**（`/d/` ↔ `D:\`），而 `node` 是原生 Windows 程序，**不吃这套**。

**怎么避**：
1. **脚本里的路径**一律用 `path.join` / `process.cwd()`（不写死 `/d/...`）
2. **比对路径前先归一**：`p.replace(/\\/g, '/')`（本仓 `normPath` 就是干这个的）
3. **`git add` 用相对路径**（`git add src/...`），不用绝对路径

★ **实测过的坑**：`grep -rc "<中文关键词>"` 在 Git Bash 里对 `\r\n` 文件会**报 0**（把 `\r` 也算进匹配）⇒ **中文内容一律用 `Grep` 工具或 `node` 读，别用 `grep`**。

**原文出处**：`dc-remove-tool` §四 / `git-repo-hygiene` §三（两处都写过 ⇒ 本文件收口）

---

## P3 · 调试 MCP/HTTP 时，「request/header 是权威」

**症状**：怀疑"工具没被裁掉 / 配置没生效"，去**读配置文件**或**读代码注释** ⇒ 结论和实际行为对不上。

**为什么**：**配置文件是"意图"，request/header 是"事实"**。
真正决定"这次调用拿到什么工具"的，是**请求里实际带的 header / body**（以及宿主实际发的东西），
不是"配置文件里写了什么"。

**怎么避**：
1. **先抓 request**（`curl -v` / 宿主日志 / MCP 的 `initialize` 与 `tools/list` 原文）
2. **再读配置**（配置只用来解释"为什么会发成这样"）
3. ★ **两者不一致时，以 request 为准** —— 那说明"配置没生效"，而不是"request 错了"

**原文出处**：`prompt-cache-reuse-diagnosis` §1（`dsh-profile-integrity` 也写过，该份已移出本仓）

---

## 附 · 我该加但还没加的（留个记号）

| 坑 | 为什么没加 |
|---|---|
| `node -e '…'` 改中文内容会崩（中文双引号被当字符串结束） | ★ 已在 `MEMORY.md` §9；**它是"操作纪律"不是"环境坑"** |
| 模板字符串里裸反引号 ⇒ TS1005 | 同上（§9） |
| `git add -A` 会扫进别处改动 ⇒ commit message 与实际不符 | 同上（§9，今天真踩过：`8a55fc2`） |
