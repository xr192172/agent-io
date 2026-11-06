# 环境坑

> 只有现状。坑变了改这张表；方法论型的坑不进这里。
>
> ★ 本表是「**撞到才需要**」的参考 —— **不进 `AGENTS.md`**（那份有指令预算，只放每次必读）。

| # | 坑 | 症状 | 对策 | 在哪 |
|---|---|---|---|---|
| P1 | `docs/*` 默认被 ignore | `git add docs/新文档.md` 报 `paths are ignored`，`git status` 看不到 | 一次性 `git add -f`；长期在 `.gitignore` 加 `!docs/新文档.md`（已跟踪的文件不受影响） | `.gitignore:125` |
| P2 | MSYS 路径转换 | Git Bash 里 `/d/...` 能跑，`node` 拿到 `D:\...`；路径比对 / `endsWith` 失守 | 用 `path.join` / `process.cwd()`；比对前 `\` → `/`；`git add` 用相对路径 | `normPath` |
| P3 | `grep` 读中文 `\r\n` 报 0 | 中文关键词明明存在却搜不到 | 用 Grep 工具或 `node` 读，不用 `grep` | Git Bash |
| P4 | 配置文件 ≠ 实际行为 | 读配置或注释得出的结论与实际不符 | 先抓 request / header / MCP `initialize` 与 `tools/list` 原文；两者不一致以 request 为准 | MCP 请求 |
| **P5** | **写闸只认 `geometry.nodes[].task` 上的 claimed 卡** | `edit_code` 报「`<节点>`（feature=…，task.state=null）都没有 claimed 的任务卡」—— 而你在 **todo 卡**上明明领了 | **改 N 个文件 = 立 N 张节点卡**（`publish` → `claim` → 补判据 → `start`）。todo 卡带 `node_id` **一律不算** | `write_gate.ts` |
| **P6** | `authorize` 批放行救不了 P5 | 报「scope 覆盖了本批全部 N 个文件，但该 scope 的节点上**没有一张 owner=… 的 claimed 卡**（scope 里没有任何 claimed 卡）」 | 同 P5 —— 先立节点卡，再谈 scope 授权 | `write_gate.ts` |
| **P7** | 存在类判据当 `judgement_ref` 是**硬拦**不是警告 | `edit_code` 直接「拒绝落盘（重写计划闸）… 判据 `symbol-exists` 是存在/结构类，永远发现不了逻辑错」 | 换语义类（`behavior-cases` / `call-exists` / `run` / `domain-independent`）；或在 `tests/p0_*.test.ts` 里断 | `db/rewrite_plan.ts#strengthOfKind` |
| **P8** | 同一文件被**两册**断言时 `judgement_ref` 判不了 | 「`judgement_ref` 不是规范引用」—— 它不知道你指的是哪一册 | 写**显式册名**：`decision:<feature>:<node>#<i>` | `db/rewrite_plan.ts` |
| **P9** | `untouched_default` 在**零符号文件**上报错 | E-PLAN-008「用了 `untouched_default` 但没记 `symbols_at_freeze`」 | 再导出 barrel 这类零符号文件**只给 `entries`**，别用它 | `db/rewrite_plan.ts` |
| **P10** | `symbol-exists` 在**零函数体 barrel** 上结构上永远红 | 现取 0 个符号 ⇒ 断言"这个符号在"永远不成立 | 公开面可达性改用 `tests/p0_*.test.ts`（真的 import 一次） | 同上 |
| **P11** | `gen-db:check` 的「归属重复」真会红（exit=1） | 同一文件的两条断言散在**两册**的同一节点上 | 按「**多者持有**」把撞的那条**原样搬进持有册**（不许两边各留一半） | `scripts/gen-db-check.mjs` |
| **P12** | `complete` 的 `data.evidence` 是**单个对象**不是数组 | 传数组 ⇒ 「`kind` 必须是 `'expectations'` \| `'reading'` \| `'attestation'` 之一（实得 undefined）」 | `{ kind:'reading', command, observed, at }`（★ `kind:'expectations'` **没有** `command`/`observed` 的位置 —— 两档互斥，要贴读数就用 `reading`） | `domain/overlay.ts#validateProgressEvidence` |
| **P13** | `decision.update` 每次都要求 `data.summary` | 只改 `expectations` 会被拒 | 带上 `summary`（`todo.update` 同理，且 `summary` 与现值**逐字相同**也会被拒） | `dsl_ops/op_data_spec.ts` |
| **P14** | `edit_dsl todo.add` 的 `data.decision` **不落** | 回执照旧报「决策卡 summary 空 · 后态判据 0 条」 | **判据只能住节点 decision**；给 todo 卡挂判据这条路不存在 | `dsl_ops/task_ops.ts` |
| **P15** | `source-has` 的针能被 **import 行单独满足** | `must:['parseFile']` —— 删掉真实调用，判据**照样绿** | 写**调用形态** `parseFile(`。★ 抓你这个的是 `p0_source_has_needle_power`，它第一次跑就抓到过写判据的人 | `tests/p0_source_has_needle_power.test.ts` |

## 怎么加新坑

撞到一次就往表里加一行（**P 号只增不复用**）。三条要求：

1. **症状要能搜到** —— 把闸的**原文**抄一句进来，下一个人才能 grep 到这张表。
2. **对策要是动作**，不是"注意一下"。
3. **带出处** —— 哪个文件 / 哪个码。

★ 这 15 条的来源：**没有一条是读文档想出来的**，全部是子代理被闸挡住后**贴原文**留下的抓痕。
