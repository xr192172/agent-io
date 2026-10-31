# 目标

> 只有现状。目标或判据变了改这张表；未完成项一律进 `INDEX.md` §四。

**把设计意图变成机器可判、有人守、不自欺的任务：设计 → 对拍变红 → 红即任务 → 有人领 → 做完可验。**
防的病只有一条：**设计说了、代码没做，而没人知道。**

## 一、支撑

| # | 条目 | 判据 | 状态 | 在哪 |
|---|---|---|---|---|
| G1 | 设计可判 | 每条意图写成 `expectations`；对拍红 ⇒ 一张待做的卡 | ✅ 全部册的判据由 `npm run verify` 的「设计册判据」门每轮真跑（决策数与判据条数由 `node scripts/judge-all.mjs` 自己打印，**本表不抄**） | `.agent-io/design/<f>.dsl.json` → `geometry.nodes[].decision` |
| G2 | 闸只提醒不堵 | 不会损坏数据 ⇒ 提醒 + 放行 + 留痕；会 ⇒ 阻断 | ⚠️ 只拦有 claimed 卡的写；拿不到 `actor` 默认放行（`AGENT_IO_ACTOR_STRICT=1` 才拒） | `src/application/write_gate.ts` |
| G3 | 依据不全就补全 | 缺 decision / 判据无归属 / 路径不在盘上 / 上游成环 ⇒ 先补全它 | 手动 | `INDEX.md` §四 |
| G4 | 一处权威 | 同一口径只住一处 | ⚠️ 仍有失效引用 | `INDEX.md` §四、§六 |

## 二、工作方式

| # | 条目 | 判据 | 状态 / 在哪 |
|---|---|---|---|
| W1 | 局部重写，不打补丁 | 加一类情况只加一行；不需要注释解释自身 | 纪律 |
| W2 | 改哪验哪 | 改 1 个文件只跑受影响的断言（不跑全量） | ⚠️ 选择器 = `tests/*.test.ts` 头注的 `touches:`（`certs/` 已整目录退役，旧口径 1/N 张证不再适用）；命中率由 `scripts/verify-changed.mjs` 输出，未声明 `touches:` 的测试不会被选中 |
| W3 | 先看全貌再动手 | 动手前给出 `file:line` 与消费方 | `get_dsl` · `explore_code` · `find_references` |
| W4 | 借独立视角 | 重大改动前派不知情子代理通读 | 派子代理 |
| W5 | 把"怎样对"讲清 | 每个可选值带 `use_when` + `not_when` | ⚠️ 工具 schema 里没有 `not_when` → `src/application/*/index.ts` |
| W6 | 文档只有一份 | 新内容进 `INDEX.md`，不新开 md | ⚠️ 份数由 `Get-ChildItem docs -Filter *.md` 现数（**本表不写**，`docs/` 里已经有第二份重复真相） |
