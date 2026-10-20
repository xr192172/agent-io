# 用法

> 只有现状。`cli.js` = `node dist/src/presentation/cli/cli.js`。工具共 65 个，这里列常用的。
> 门与判据见 `GUIDE-GATE.md`。

## 一、工具

| 工具 | 干什么 | 必填参数 | 例子（一行） |
|---|---|---|---|
| `design_line` | 设计链：`report` 六步读数 / `diff` 设计 vs 实际 / `gen-db` 生成设计 DB / `sync-signatures` 签名回写源码（`rewrite` 为旧名） | `project_dir` | `cli.js design_line project_dir=. action=diff feature=f` |
| `get_dsl` | 只读查 DSL：`dsl` `nodes` `node` `edges` `files` `file` `decisions` `pending` `pool` `scope` `calls` `digest` `diff` … | `query` | `cli.js get_dsl query=node feature=f node_id=file_src_a_ts` |
| `edit_dsl` | 设计侧写：`node` / `edge` / `file` / `api` / `tag` / `decision` / `task` / `todo` | `feature` `reason` `operations` | `cli.js edit_dsl feature=f reason="…" operations='[{"op":"claim","type":"task","id":"n1","data":{"owner":"me"}}]'` |
| `design_intent` | 设计意图（why）：`action=set` 直接落 / `action=propose` 走人工审批 | `feature` | `cli.js design_intent feature=f goals='[{"title":"…"}]'` |
| `edit_code` | 改源码：`replace` / `insert` / `delete` / `range` / `replace_text`；批量 `targets[]` | `project_dir`（单文件另需 `file` `op`） | `cli.js edit_code project_dir=. file=src/a.ts op=replace_text old_text="a" new_text="b"` |
| `rename_symbols` | 标识符改名（跨文件，或 `scope=local` 文件内绑定） | `renames` | `cli.js rename_symbols renames='[{"file":"src/a.ts","symbol":"Kk","to":"Kk2"}]'` |
| `rename_files` | 文件改名/移动 + 全仓 import 改写 | `renames` | `cli.js rename_files renames='[{"from":"src/a.ts","to":"src/b.ts"}]'` |
| `move_symbol` | 符号跨文件迁移 | `file` `symbol` `to_file` | `cli.js move_symbol file=src/a.ts symbol=Kk to_file=src/b.ts` |
| `find_references` | 查引用（候选集含图闭包 + 文本提及） | 无（给 `file`+`symbol` 或 `mode`） | `cli.js find_references project_dir=. file=src/a.ts symbol=Kk` |
| `remove_dead_imports` | 删死 import | `project_dir` `dead` | `cli.js remove_dead_imports project_dir=. dead='[{"source":"lodash","files":["src/a.ts"]}]' verify=true` |
| `annotate_functions` | 给函数补注释（AST 定位） | `project_dir` | `cli.js annotate_functions project_dir=. file=src/a.ts` |
| `import_project` | 重扫实际侧 → `live/` + `cache.db` | `project_dir` `feature` | `cli.js import_project project_dir=. feature=f max_files=10000` |
| `impact_analysis` | 影响面 | `project_dir` | `cli.js impact_analysis project_dir=.` |
| `review_changes` | 审批流：`list` / `show` / `approve` / `reject` | `action` | `cli.js review_changes action=list feature=f` |
| `consistency_check` | 设计 vs 实际对账 | `feature` | `cli.js consistency_check feature=f` |
| `detect_drift` | 漂移巡检 | `feature` | `cli.js detect_drift feature=f` |
| `run_tests` | 跑项目测试 | 无 | `cli.js run_tests project_dir=.` |
| `snapshot` | 快照 `list` / `take` / `diff` | `action` `project_dir` | `cli.js snapshot action=take project_dir=.` |
| `render_design` | 渲染 `mindmap` / `svg` / `markdown` | `feature` | `cli.js render_design feature=f format=markdown` |
| `apply_refactor_plan` | 按 `plan_refactor` 的清单批量落盘（幂等） | `project_dir` `plan` | `cli.js apply_refactor_plan --json '{"project_dir":".","plan":{"plan_id":"…","items":[…]}}'` |

- CLI 入参三种形式**不可同时给**：`k=v` 平铺（按 schema 转类型）/ `--json '{…}'`（嵌套、数组）/ `--input args.json`。
- 查单个工具的入参：`cli.js <tool> --schema`（`--help` 不可用）。
- 产物：人读回执 + `\n---DATA---\n` + 一行 JSON；`touched` 在 JSON 那一层。
- 三种 diff 别混：**节点级** `design_line action=diff` / **符号级** `action=sync-signatures` / **语义级** `judgeExpectations`（判据）。
- **写闸**：改源码须先有 `claimed` 卡（`edit_dsl op=claim`）；`gate:'exempt'` 的节点免闸。写闸只装在本仓写工具上（`edit_code` / `rename_*` / `move_symbol` / `apply_refactor_plan`），`Write` / `Edit` / shell 直写绕过它。

## 二、典型流程

| 想做什么 | 几步 |
|---|---|
| 改一个函数 | `edit_dsl(op:publish)` → `edit_dsl(op:claim, data.owner)` → `edit_code op=symbol` → `edit_dsl(op:complete, data.evidence)` |
| 改一张已完成卡的判据 | `edit_dsl(op:reopen)` → 改 `decision` → `edit_dsl(op:publish, data.reason)`（原地换 `summary` + `expectations`，`evidence` 保留） |
| 改一处文本（不知符号/行号） | `edit_code op=replace_text dry_run=true` → 同参去掉 `dry_run` |
| 加一个新文件 | `design_line action=diff` → `get_dsl query=node` → `edit_code op=insert` → `edit_code op=symbol` → `design_line action=sync-signatures apply=true` |
| 按设计重写一片 | `design_line action=diff` → `get_dsl query=scope scope=<expr>` → 逐节点 claim → `edit_code` → complete |
| 改符号名 | `find_references` 看引用面 → `rename_symbols` 一次传全部 `renames` |
| 改文件名 / 移文件 | `rename_files renames=[{from,to}]`（`from` 必须是文件，目录拒） |
| 跨文件移符号 | `move_symbol` |
| 删死 import | 先算出 `dead` 列表 → `remove_dead_imports` |
| 加一个工具 | 7 处登记（§2.1）→ `npm run verify` |
| 删一个工具 | 11 处引用面（§2.2）→ `npm run verify` |
| 重扫实际侧 | `import_project project_dir=. feature=f max_files=10000` |
| 重生成设计 DB | `design_line action=gen-db`（`check=true` 只比对不写盘） |
| 交活前 | `npm run verify`（6 道门）+ `npm run certs`（见 `GUIDE-GATE.md`） |
| 开并行支线 | `git worktree add`（§2.4） |

- **新建文件的设计（T20）**：必须在**同一批** `node.add` 的 `data.decision.expectations` 里带一条 `file-exists` 指向该路径。闸要的是"依据"不是"现状"——新文件没有现状可读，别造空壳骗闸。`delete` 不参与本闸（它断言"不该存在"，不需要现状）。
- 立卡要早于动手：先做后立卡，判据只剩"注册"能红 ⇒ 卡一出生就 `satisfied`，没有"有活可干"的证据（要改只能 `claim intent=modify` 取写权）。

### 2.1 加一个工具：7 处登记

| # | 位置 | 动作 |
|---|---|---|
| 1 | `src/application/<lane>/index.ts` 的 `*_TOOLS` | 写 def：`name` / `title` / `description` / `inputSchema` / `handler` |
| 2 | `src/application/meta/registry/capability_map.ts` 的 `WHEN_OVERRIDES` | 补策展文本 |
| 3 | `README.md` **和** `README.en.md` | 加行 + 手改计数 |
| 4 | `src/infrastructure/analysis/capability/register_capabilities.ts` | 进能力矩阵时加声明块 |
| 5 | `AGENTS.md` **和** `scripts/gen_agents.mjs` | 两处都改（`AGENTS.md` 是生成物，只改它会被 build 回滚） |
| 6 | `structure.domains.json` | 落在未登记目录时加/改域条目 |
| 7 | `src/presentation/mcp/server_registry.ts` | 通常无需改（`LANE_SOURCES` 已接线）；清手写 import |

- def 本体住 `src/application/<lane>/index.ts`，归属由文件所在表达；汇总点唯一 = `src/application/tool_registry.ts` 的 `LANE_SOURCES`。
- 字段：`name` snake_case · `description` 写清"干什么 / 关键参数语义 / 安全设计（`dry_run` 的默认值）/ 纪律"。
- 有结构化结论（计数 / 清单 / 判定 / diff）必须 `wrapData`，否则 `data` 被静默丢掉；`wrap` 把异常吞成 `{text, isError:true}` 而不 throw。
- `trustAnnotated: true` 只在结论依赖符号索引时才标。
- `handler` 只转发，业务逻辑留在实现文件。

### 2.2 删一个工具：11 处引用面

| # | 位置 | 漏了的症状 |
|---|---|---|
| 1 | `src/application/<lane>/index.ts` | 工具还在，调它报未知实现 |
| 2 | `src/presentation/mcp/server_registry.ts` | tsc 红或留死 import |
| 3 | `capability_map.ts`（`WHEN_OVERRIDES` + 线描述） | 导航里还在讲已删能力 |
| 4 | `register_capabilities.ts` | 能力矩阵留一条不存在的工具 |
| 5 | `README.md` + `README.en.md` | 计数与行数对不上 |
| 6 | `structure.domains.json` | `structure_gap` 报 `missing` |
| 7 | `AGENTS.md` + `scripts/gen_agents.mjs` | 只改前者会被 build 回滚 |
| 8 | `src/infrastructure/parse/lang_hint.ts` | 提示里出现已删工具名 |
| 9 | `src/presentation/mcp/server.ts` 的 `instructions` | MCP 端自述挂着已删工具 |
| 10 | `CONTRIBUTING.md` / 其它文档的结构速览 | 目录树里留已删目录 |
| 11 | 各处注释 / 描述 | `grep` 还剩说明 |

- 判"还有没有人用"要 grep **真 import 语句**（`from '.*<name>\.js'`），不按名字 grep（命中的多是注释、字符串、术语表）。
- 引用者只有 `server_registry.ts` ⇒ 可直删；引用者是别的待删文件 ⇒ 一起删；引用者是要保留的模块 ⇒ 先解耦。
- 删完看派生死代码（importer 全删了 ⇒ 它自己也没人用了）。
- 用 `git rm`（保留可追溯）；**不用 `rm` 循环批量删**（宿主删除护栏 50/turn，超了会留"半删"状态）。
- `docs/*` 的历史文档不改。

### 2.3 渐进式重写（设计 → 实现）

设计侧只有结构与意图（符号 / 签名 / 成员 / 引用 / import span），没有函数体 ⇒ 实现由 LLM 写，工具负责定位、约束、验证。

| 步 | 动作 | 命令 / 判据 |
|---|---|---|
| 1 | 看缺什么 | `design_line action=diff`：**"只在设计侧"就是待实现清单**；"只在实际侧"是设计漏了（走 sync，不写代码） |
| 2 | 看节点该长什么样 | `get_dsl query=node node_id=<id>`：拿 `scope`（要建哪些文件）、`decision`（判据）、相连的边 |
| 3 | 建骨架 | `edit_code op=insert code="…"`（先建目录再落盘） |
| 4 | 写实现 | `edit_code op=symbol`（按符号整块替换）或 `op=replace_text` |
| 5 | 签名对齐（收尾，可选） | `design_line action=sync-signatures apply=true`：只把源码签名改回设计签名，**不生成实现** |

- 能算的：缺哪些节点（`diff`）、签名差在哪（`sync-signatures`，只 function；const/type/interface 落 `uncompared`）、节点意图（`get_dsl`）、建文件 + 落实现（`edit_code`）、语法门、索引重建。
- 不能算的：按设计生成实现（DSL 无函数体）、"新文件里该有哪些符号"（只有 `scope` 与边，没有必含符号清单）、一键重写整份文件。
- `edit_code` 落盘后自动 `syncFile`；语法坏了不落盘；回执给命中级别（`L1·exact` / 空白归一 / 缩进弹性 / 省略号占位）+ 行号 + diff。

### 2.4 开并行支线

```bash
git worktree add /d/project_develop/<仓名>-<线名> -b feat/<线名>
git worktree list && git -C D:/project_develop/<仓名>-<线名> status -sb
```

- 用 worktree，不用 fork / 克隆副本（历史、remote、判据各只有一份）。
- 支线没有 `node_modules` / `dist` / `.agent-io` ⇒ 先 `npm ci` + `npm run build`。
- **支线上不跑 `npm run mcp:install`**（它写用户级 `~/.claude.json` / `~/.cursor/mcp.json` / `~/.github/copilot-mcp.json`，会把全局 MCP 指向支线）；只能 `--dry-run`。
- 一条线 = 一个分支 = 一个 worktree；定期 `git merge main`；不留墓碑（`git worktree remove` + `git branch -D`）。
- 提交信息用 `git commit -F <文件>`，不用 `-m`（反引号会被 shell 当命令替换执行）。并行执行者只 `git add` 自己改过的具体文件。

## 三、派子代理

### 3.1 派活前让它先读

```
1. docs/INDEX.md   —— 入口
2. docs/VISION.md  —— 这个功能"应该是什么"
3. docs/DESIGN.md  —— 实现"现在是什么"（要改的东西可能已在缺陷台账里）
```

### 3.2 硬约束（原样写进 prompt）

| 必须用 | 不许用 |
|---|---|
| `edit_code`（`replace_text` / `range` / `symbol` / `insert`） | `Write` 工具 |
| `design_line action=sync-signatures` | `Edit` 工具 |
| `apply_refactor_plan` | `sed -i` / shell 重定向写文件 |
| `remove_dead_imports` | Python / Node 脚本写文件 |

唯一例外：仓外实验区 `_design-canvas-labs/`。

三条区别：`edit_code` 落盘后**重建索引**（`Write` 不会）；**写闸只装在本仓工具上**（`Write` / `Edit` 完全绕过）；**只有走仓内工具才有回执**。

### 3.3 侦察 / 实现两阶段

一次派活只做一件事：

- **侦察**：只读，产出"问题在哪 + 修法候选 + 代价"，不许改代码。
- **实现**：输入是侦察结论（精确到 `文件:符号`），产出是改动 + 验收数字。

修法完全明确（1–2 行）时可一次派完。

### 3.4 回报五栏

1. 目标达成情况（做了什么 + 验收数字）
2. 工具调用清单（逐条：命令 + 结果一句话）
3. **工具摩擦**：哪里让你多做了动作 / 让你猜了 / 让你重试了
4. 有没有违规用过 `Write` / `Edit`（如实说）
5. 有没有还原不了的残留（改坏了 `git checkout --` 还原）

### 3.5 验收三条

1. 正面 + 反面都要（修好 X 的同时 Y 不能被堵死）。
2. 断言要能红（故意改坏一处，看断言是否变红）。
3. 跑出来的**数字**才算验收；`source-has` 只证明"代码里有这个词"。

## 四、参数与行为注意

| 现象 | 对策 |
|---|---|
| `design_line --help` 不可用 | 用 `--schema` |
| `get_dsl query=nodes` 忽略 `node_id` | 取单个节点用 `query=node` + `node_id` |
| `design_line action=report` 不列文件 | 要文件级差异用 `action=sync-signatures file=…` |
| `design_line` 的 `ok:true` 语义过载 | 看 `did_work` / `reason` / `differ` / `scanned` |
| `remove_dead_imports` 不能按文件调 | 必填 `dead` 列表，先由上游算出候选 |
| `edit_code` 的「索引失败」混在 `✓` 行 | 看 `---DATA---` 里的 `written` |
| `edit_dsl` 改 `decision` 的 `expectations` 是**整体替换** | 必须传全量；少传 = 静默删掉旧判据 |
| 会改源码的动作默认只看 | `apply` 不传 = 不落盘；落盘后必须复核（`afterDiffer > 0` ⇒ 不算成功） |
| `node.layer` 只认 `main` / `error` / `detail` | `arch_layer` 是分组谓词（`ArchLayer.id`），不是节点键 |
| `file.add` 必须带 `id` | 且与 `node.add` **同批**，否则 `anchor_broken` |
| 改 TS 里的 `\n` | 用 `Edit`，不用脚本拼：python 三引号会把 `\\n` 变成真换行，留下未闭合字符串 |
| `tsc` 报错后 | 不许跑 `import_project`：它会加载坏 `dist`，把索引写成 0 符号。顺序必须是编译绿 → 再重建 |
| 变异 / 还原之后 | 必须重编译；源文件还原 ≠ 产物还原（`dist` 里会留最后一个变异体） |
| `import_project` 的 `max_files` 默认 200 | 全量重建传 `10000` |
| 清库后 `SCHEMA_VERSION` 不二次触发 | 直接 `DELETE FROM nodes/files/...` 再导入 |
| 长进程（MCP server）用旧 dist 写库 | 改完先 `build`，再确认没有旧进程 |
| 行号会漂 | 引用代码带符号名（`reopenTask`），不只给行号 |
| Windows 路径 `/c/tmp` 被 `path.resolve` 成 `C:\c\tmp` | 用 `C:/tmp/...`；`git -C` 也用 `D:/...` |
| 宿主删除护栏 50/turn | 分批 < 50；先删，删不动就置空 |
| 同文件两个 Edit 并行 ⇒ 后者按旧快照覆盖 | 同文件串行改，改完 `grep` 验证 |
| `node -e` 里的反引号 / 正则 / 花括号被 bash 抢插值 | 写 `.mjs`（LF）再跑 |

## 五、索引与性能

| 序 | 原因（按出现频率） | 判据 / 正解 |
|---|---|---|
| 1 | Windows spawn 不存在的命令 ≈ 5 秒 | 纯 fs 查 PATH 再 spawn，结论按进程记忆化 |
| 2 | 写放大（大量行没包事务） | `const ownTx = !inTransaction(db)` + `BEGIN`/`ROLLBACK` |
| 3 | O(n²) 的无心之失 | `filter(...includes(...))` ⇒ `Set` |
| 4 | 调用频次（热路径每次全量干重活） | 收窄触发面 |
| 5 | 召回回归（候选集被快路径收窄） | 候选集 = 图闭包 ∪ 文本提及，并如实上报召回边界 |
| 6 | 才是算法 | —— |

| 指标 | 含义 | 查法 |
|---|---|---|
| `not_fresh` | 索引落后于磁盘 | 已索引文件逐个 `stat` 对比 `files.size / modified_at` |
| `stale_resolved` | 索引内部不一致：声称 `resolved`，`reference_name` 已不在 `nodes` | `SELECT COUNT(*) FROM unresolved_refs u WHERE u.status='resolved' AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name=u.reference_name)` |

- 写工具一律接闸：`async` 写工具走 `writeSourceFiles`；同步签名走 `recordSelfWrite`；自己 `syncFile` 的（`edit_code` / `rename_file` / `symbol_move`）补 `reopenAndResolveAfterWrite`。
- 写穿顺序：`syncFile` → `changedSymbolNames` → `reopenRefsTo` → 用"本批文件 ∪ 被重开的引用方文件"做 scoped resolve。`hasLiveIndex(root)` 为假时绝不写穿。
- 读侧保鲜在 `registerAllTools` 唯一入口：`hasLiveIndex && !def.noAutoFresh` ⇒ `ensureProjectIndex`。
- 定位"哪个调用慢"：逐工具计时 + 边跑边 append 到 jsonl + 单工具超时。
- 跑探针前必须重建 dist，否则静默跑旧代码（判据：读到的字段是 `undefined`）。
- 什么该进 DB：看**消费者数 × 频次**。标识符有 4 个消费者且要全仓扫 ⇒ 进表；运算符只有变异器 1 个 ⇒ 不进。
- AST 树不持久化：`children` 是 getter，JSON 还原不成树；重新 parse 单文件是毫秒级，比读 JSON 重建更快。真正的收益是**一套遍历 API（一致性）**，不是速度。
