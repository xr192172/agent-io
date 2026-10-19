# 使用指南：dc-* 六条流程、命令与 PATH、四条验收

> 2026-10-18，从 17 份 skill 里**只提取操作侧**内容。每条命令都注明出处，未注明出处的都是本文件为编排而做的合并。
> 设计侧（判据怎么写、假信号分档、闸为什么会失效）见 `GUIDE-DESIGN.md`；其余 11 份 skill 的定位见 `SKILLS-AUDIT.md`。
>
> ★ **先读这一条现状**：本仓 2026-10-05 起**测试框架与全部门已整体移除** —— `tests/` 不存在、无 vitest、无 dependency-cruiser、无 `npm run test:main` / `npm run arch`（`dc-add-tool` §一、§五）。下文出现的"跑测试"一律指 skill 原文，若与本仓现状冲突，以"四条验收"为准。

---

## 1. 加一个工具（`dc-add-tool`）

### 1.1 何时用

- 「加个工具」「新增 MCP 工具」「把这个能力暴露成工具」
- 往 `TOOL_DEFS` 加了一条之后
- 改了工具的 inputSchema / 描述 / handler 背后语义（`dc-add-tool` §何时用）

### 1.2 登记面：7 处（不是 8 处）

| # | 位置 | 动作 |
|---|---|---|
| 1 | `src/application/<lane>/index.ts` 的 `*_TOOLS` 数组 | 写 def（`name/title/description/inputSchema/handler`） |
| 2 | `src/application/meta/registry/capability_map.ts` 的 `WHEN_OVERRIDES` | 补策展文本（键数应 == `TOOL_DEFS.length`） |
| 3 | `README.md` **和** `README.en.md` | 加行 + **手改计数**（两个文件都要） |
| 4 | `src/infrastructure/analysis/capability/register_capabilities.ts` | 若要进能力矩阵，加声明块 |
| 5 | `AGENTS.md` **和** `scripts/gen_agents.mjs` | ★★ 两处都要改 |
| 6 | `structure.domains.json` | 新工具落在未登记目录时，加/改域条目 |
| 7 | `src/presentation/mcp/server_registry.ts` | 通常无需改（`LANE_SOURCES` 已接线）；手写的 import 要清 |

（`dc-add-tool` §一）

- ★ **`AGENTS.md` 是生成物**：由 `scripts/gen_agents.mjs` 生成，只改它会 `npm run build` 回滚（build 第一步就是跑它）⇒ 改源头。（`dc-add-tool` §一.5）
- ★ **计数要派生，不要人工抄数字**：`toHaveLength(58)` 这类断言曾有三份副本，加一个工具三处同时红；测试里的工具数只应有一处来源（快照基线）——而快照框架现已移除。（`dc-add-tool` §一.6）

### 1.3 def 写在哪、长什么样

- **汇总点（唯一）**：`src/application/tool_registry.ts` 的 `LANE_SOURCES`（6 条 lane → 数组的映射）；**def 本体**住 `src/application/<lane>/index.ts`；归属由**文件所在**表达。`LANE_OF` 已删除。（`dc-add-tool` §三）
- 字段要点：
  - `name`：snake_case；实现文件最好同名；
  - `description`：中文长描述，写清"干什么 / 关键参数语义 / 安全设计（dry_run 默认值）/ 纪律"——**工具描述是 LLM 唯一的选择依据，别写短**；
  - `dry_run`：`true`（默认）= 只算不写盘。（`dc-add-tool` §三）

### 1.4 `wrap` 还是 `wrapData`（选错会静默丢数据）

| | 返回 | 何时用 |
|---|---|---|
| `wrap` | 只有 `{ text: r.message }` | 结果就是一段人读文本 |
| **`wrapData`** | `message\n---DATA---\n<JSON.stringify(data)>` | **有结构化结论**（计数、清单、判定、diff…） |

**只要构造了 `data` 就必须 `wrapData`**，否则被静默丢掉。（`dc-add-tool` §三）

- `trustAnnotated: true` **只在工具结论依赖符号索引时才标**；`structure_gap` 这种只读配置 + `readdirSync` 的工具标了就是**假告警**。（`dc-add-tool` §三）
- `handler` 里**不要写业务逻辑**：[C] 只转发，判据留在 [B]（infrastructure/application 的实现文件）。（`dc-add-tool` §三）
- `wrap` 会把异常吞成 `{ text, isError: true }`，**不 throw**；断言要查 `r.isError === true`。（`dc-add-tool` §三）

### 1.5 命令（真调，不是"编译过了"）

★ **与 §8「验收四条」是同一套命令**（tsc / build / structure:gap / 真调），不再各写一遍 —— 见 §8。
★ 加工具场景额外要做的，只有"无参调一次 ⇒ 应给人话缺参错误"这一条（§8 第 4 条已含）。

- ★ **纪律（2026-10-05 用户裁定）**：**不养门**。判据只有两条 —— 测试通过 + 与契约相符；把"注释里一句话写错"升级成"纪律/新门"是过度工程化。（`dc-add-tool` §五）

### 1.6 加工具的坑

- ★ **`AGENTS.md` 是生成物**：改它会被 `build` 回滚 ⇒ 改源头（见 §1.2 末）。（`dc-add-tool` §一.5）
- ★ **引号 / 编码 / 临时脚本**：见 §7.2（`node -e` 抢插值、`.mjs` 用 LF、临时脚本放仓外）。（`dc-add-tool` §二）

---

## 2. 删一个工具（或一整族）（`dc-remove-tool`）

### 2.1 先做**真 import 判据**（按名字 grep 会骗你）

```bash
# ❌ 错：按名字 grep —— 命中的大多是注释、字符串、术语表、历史快照
grep -rn "harvest_closure" src --include=*.ts

# ✅ 对：grep 真 import 语句（含 .js 后缀，本仓 ESM 风格）
grep -rn "from '.*harvest_closure\.js'" src --include=*.ts
```

（`dc-remove-tool` §一）

| 情况 | 含义 | 动作 |
|---|---|---|
| 引用者**只有** `server_registry.ts` | 纯叶子工具 | 可直接删 |
| 引用者是**别的待删文件** | 链式 | 一起删 |
| 引用者是**要保留的模块** | ★★ 有承重 | 不能删，或先解耦 |

（`dc-remove-tool` §一）

- 删完实现文件后，**还要找它派生的死代码**（它的 importer 全被删了 ⇒ 它自己也没人用了）。（`dc-remove-tool` §一）

### 2.2 删除顺序与工具

1. **叶子先删，承重的最后判**。
2. 用 `git rm`（保留可追溯）；目录 `git rm -r`；**未跟踪文件**才用 `rm` 单文件。
3. ★★ **绝不用 `rm` 循环批量删** —— 宿主管家有删除护栏（阈值 50/会话/turn），第 50 个之后逐个被拦，而前面已经删了 ⇒ 留下"半删"状态。要删一批就**分批 < 50**。
4. 删完 `npm run build` 会让 `clean_dist` 报**孤儿产物**——这是预期的，它会自动清。

（`dc-remove-tool` §二；护栏阈值见 `dc-add-tool` §四）

### 2.3 会**静默失效**的引用面（逐条过）

| # | 位置 | 动作 | 漏了的症状 |
|---|---|---|---|
| 1 | `src/application/<lane>/index.ts` | 删 def | 工具还在，调它报未知实现 |
| 2 | `src/presentation/mcp/server_registry.ts` | 删死 import | tsc 红或留死引用 |
| 3 | `capability_map.ts` | 删 `WHEN_OVERRIDES` 条目；改线描述旧话术 | 导航里还在讲已删能力 |
| 4 | `register_capabilities.ts` | 删能力声明块 | 能力矩阵里留一条不存在的工具 |
| 5 | `README.md` + `README.en.md` | 删行 + 改计数 | 子标题计数无门，只能手改 |
| 6 | `structure.domains.json` | 更新/删除域条目 | `structure:gap` 报 `missing` |
| 7 | `AGENTS.md` + `scripts/gen_agents.mjs` | ★★ 两处都改 | 只改 AGENTS.md 会被 build 回滚 |
| 8 | `src/infrastructure/parse/lang_hint.ts` | 删陈旧节名 | 提示里出现已删工具名 |
| 9 | `src/presentation/mcp/server.ts` | 改 `instructions` 文案 | MCP 端自述挂着已删工具 |
| 10 | `CONTRIBUTING.md` / 其它文档 | 改项目结构速览 | 目录树里留已删目录 |
| 11 | 各处注释/描述 | 更新 | `grep -rn "<toolname>" src` 还剩说明 |
| 12 | `docs/*`（历史文档） | ★ **不要改** | 那是历史记录；改了等于篡改历史 |

（`dc-remove-tool` §三）

- ★ **线描述的陷阱**：`capability_map` / `server.ts` 常把两个以上能力写在一句话里 ⇒ 删掉一个后那句话**仍然读得通**，只是多了个空格子。（`dc-remove-tool` §三）

### 2.4 README 计数的正确核对法（没有门了）

```bash
# 子标题声称的数字 vs 该段表内 `| \`tool\` |` 行数
awk '/^### 专项工具/{f=1;next} f&&/^###/{exit} f&&/^\| `/ {c++} END{print c}' README.md

# 再核"没有陈旧行"
awk '/^### 专项工具/{f=1;next} f&&/^###/{exit} f&&/^\| `/ {match($0,/`[a-z_0-9]+`/); print substr($0,RSTART+1,RLENGTH-2)}' README.md | sort > /tmp/a
grep -h "^    name: '" src/application/*/index.ts | sed "s/.*name: '\([^']*\)'.*/\1/" | sort > /tmp/b
comm -23 /tmp/a /tmp/b     # ← 这里应只剩已删工具，其它为空
```

（`dc-remove-tool` §五）

- 实测：README.md「专项工具（31 个）」而表内实为 **41** 行（漂 10）；README.en 标 38 实 **36**。子标题计数是手维护的，**改工具数时必须顺手核**。（`dc-remove-tool` §五）

### 2.5 删完的附加确认

- **已删工具**应报 `未知工具名: <name>`（证明注册表真的少了它）。
- **保留工具**要真跑 happy path（防"删多了"）：临时项目 + `AGENT_IO_HOME=<隔离目录>`。
- 工具**计数**：`grep -h "^    name: '" src/application/*/index.ts | wc -l`，与 README 的"共注册 N"对齐。
- ★ Windows 路径（`/c/tmp` 交给 `path.resolve` ⇒ `C:\c\tmp`，静默得 0 文件）见 §7.3。

（`dc-remove-tool` §四）

---

## 3. 驱动一条链（`dc-drive-chain`）

### 3.1 核心约定：链写成**数据**，值就是 `touched.<键>`

```js
const CHAIN = [
  { tool: 'find_references', args: { project_dir: FX, file: 'src/a.ts', symbol: 'Kk' } },   // 起点：字面量
  { tool: 'rename_symbols',  args: { project_dir: 'touched.project_dir',
                                     renames: [{ file: 'touched.file',          // ★ 逐字同名
                                                 symbol: 'touched.symbols[0]',  // ★ [i] = 调用方选
                                                 to: 'KkRenamed' }] } },
  { tool: 'edit_code',       args: { project_dir: 'touched.project_dir',
                                     file: 'touched.written_files[1]', op: 'replace_text',
                                     old_text: '…', new_text: '…' } },
  { tool: 'run_tests',       args: { project_dir: 'touched.project_dir' } },   // 收尾：下游不要对象
];
```

（`dc-drive-chain` §一）

| 形态 | 含义 |
|---|---|
| `touched.<键>` | 集合**确定只有一个元素** ⇒ 取即确定（如 `find_references.file`） |
| `touched.<键>[i]` | 集合**可能有多个** ⇒ **下标由调用方给**（如 `written_files[1]`） |

（`dc-drive-chain` §一）

- ★ **"选"是调用方唯一的活**：`[i]` 的下标只能人/LLM 给 —— 选择是语义判断，不是数据搬运。别把它自动化掉（那会变成"猜"）。（`dc-drive-chain` §二）

### 3.2 驱动方式：CLI 两种入参形式

```bash
node dist/src/presentation/cli/cli.js list --json                       # 列工具（唯一真相源：application/*/index.ts）
node dist/src/presentation/cli/cli.js <name> key=value key2=value2      # 平铺（按 inputSchema 转类型）
node dist/src/presentation/cli/cli.js <name> --json '{...}'             # ★ 嵌套/结构化入参必须用这个
node dist/src/presentation/cli/cli.js <name> --input args.json
cat args.json | node dist/src/presentation/cli/cli.js <name> -
```

（`dc-drive-chain` §三）

- 三种**不可同时给**（有歧义直接报错）。
- `[C]` 分派器（如 `manage_feature`）的 `action` 要放进 `args` 子对象。
- 产物格式：`人类可读回执` + `\n---DATA---\n` + **一行 JSON**（`touched` 就在这一层）。（`dc-drive-chain` §三）

### 3.3 六个坑

1. **起点要选"有对象锚点"的工具**：`import_project` 住 `src/infrastructure/`，**没有 `touched`** ⇒ 第二步就报错。要么从 `find_references` 这类对象类工具起，要么第一步用字面量。（`dc-drive-chain` §四.1）
2. **解析不出来要大声报错，不许兜底**：表达式引用不到键 ⇒ 抛。反例：`touched.written_files` 在 `dry_run` / 被阻断时**整项省略** ⇒ 那不是"空数组"，是"没发生落盘"。（`dc-drive-chain` §四.2）
3. **末段常常"不要对象"**：`run_tests` 只吃 `project_dir` ⇒ 用通用边接，**不算缺口**，别硬塞符号。（`dc-drive-chain` §四.3）
4. **`rename_*` 的产品给的是新名**（`symbols: ["KkRenamed"]`）⇒ 下游用新名，用旧名会静默接错。（`dc-drive-chain` §四.4）
5. **先跑 `import_project` 建索引**（`find_references` 要吃索引），否则报找不到符号。（`dc-drive-chain` §四.5）
6. **夹具放仓外**（`C:/tmp/<name>/` 或 `.inspect/`），用完删；跑完用**工具入口**清 feature（`manage_feature --json '{"action":"delete","feature":"…"}'`，2026-10-12 T194 起入参扁平），**不要 `rm`** 数据目录。（`dc-drive-chain` §四.6）

### 3.4 怎么判定"真的成了"

| 判据 | 怎么看 |
|---|---|
| **零翻译** | 驱动器打印"解析自上一步的 touched" ⇒ 键名逐字来自上一步 |
| **物理效果** | **读磁盘上的夹具文件**（改名/替换真的落盘了？）—— 回执说 ok ≠ 文件变了 |
| **收尾真的跑过** | `run_tests` 要看到 `success:true` + `exitCode:0`（`ok:true` 只表示这次调用没崩） |

（`dc-drive-chain` §五）

- **跑完把结论回填**：整条链跑通 ⇒ 写进 `src/domain/chain_wiring.ts` 的 `CHAINS`（`evidence:'verified'` + `note` 写清怎么验的）；单条边跑通/证伪 ⇒ 更新 `CHAIN_EDGES` / `CHAIN_EDGES_PENDING`（撤掉的边必须留证）。
- ★ **不许把"预测/推断"写成"实测"。**（`dc-drive-chain` §六）

---

## 4. 索引分诊（`dc-index-triage`）

### 4.1 铁律：先证伪，再优化

**别接"是不是算法的问题"这个前提。** 按出现频率排序：

| 序 | 原因 | 判据/正解 |
|---|---|---|
| 1 | **Windows spawn 不存在的命令 ≈ 5 秒**（不是"立刻失败"） | 先纯 fs 查 PATH，确认存在才 spawn 一次 `--version`，结论每进程记忆化（含否定结论）；新增任何 `execSync` 之前先过闸 |
| 2 | **写放大**（大量行没包事务） | `const ownTx = !inTransaction(db); if (ownTx) db.exec('BEGIN')` + finally/catch ROLLBACK；实测 27.3s → 1.9s |
| 3 | **O(n²) 的无心之失** | `all.filter(...)` 里嵌 `all.includes(...)` ⇒ 改 `Set` |
| 4 | **调用频次**（热路径每次全量干重活） | 收窄触发面 |
| 5 | **召回回归**（候选集被快路径收窄） | 候选集 = 图闭包 ∪ 文本提及（两级索引），并**如实上报召回边界** |
| 6 | **才是算法** | —— |

（`dc-index-triage` 铁律）

- **定位"哪个调用慢"的唯一可靠手段**：逐工具计时 + 边跑边落盘（append 到 jsonl）+ 单工具超时；一把梭全跑，一挂什么都看不到。（`dc-index-triage` 铁律）

### 4.2 两个指标，别混

| 指标 | 含义 | 何时出现 | 查法 |
|---|---|---|---|
| `not_fresh` | 索引**落后于磁盘**（有文件被改过） | 旁路写、外部改动（git pull / 编辑器） | 已索引文件逐个 `stat` 对比 `files.size/modified_at` |
| `stale_resolved` | 索引**自身内部**不一致：声称 `resolved`，但 `reference_name` 已不在 `nodes` | 重同步删了旧节点、却没重开引用 | 下方 SQL |

```sql
SELECT COUNT(*) FROM unresolved_refs u
WHERE u.status = 'resolved'
  AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)
```

（`dc-index-triage` 一致性）

- ★ 踩过的坑：**绕过写闸直接改盘**时 `stale_resolved` 仍是 0（索引还没重同步、旧节点还在）；此时真正的谎言是 `not_fresh`。**别把"没发现陈旧断言"读成"索引是对的"。**（`dc-index-triage` 一致性）

### 4.3 写工具一律接闸

| 层 | 用在哪 | 调用 |
|---|---|---|
| **L1a 写穿** | 本身就是 `async` 的写工具 | `await writeSourceFiles(root, files, () => { …真写… }, {label})` |
| **L1b 自写登记** | **同步签名**的写工具 | `recordSelfWrite(root, files, note)` → 读路径 `ensureFreshIndex` 优先消费 |
| **收尾补重开** | 工具自己 `syncFile` 的（`edit_code` / `rename_file` / `symbol_move`） | `await reopenAndResolveAfterWrite(root, touchedFiles)` + `reopenNote(...)` 拼进结果 |

（`dc-index-triage` 写闸节）

- 写穿内部顺序不能错：`syncFile` → `changedSymbolNames` → `reopenRefsTo` → **用"本批文件 ∪ 被重开的引用方文件"做 scoped resolve**；`reopenRefsTo` 必须返回**引用方文件清单**。
- `hasLiveIndex(root)` 为假时**绝不写穿**（半成品索引比不建更糟）。
- **读侧保鲜是结构性的**：`registerAllTools` 唯一入口，调 handler 前 `hasLiveIndex(root) && !def.noAutoFresh` ⇒ `ensureProjectIndex(root, {bootstrap:false})`；逃生口 `ToolDef.noAutoFresh` 只给自检类/自己全量导入的工具。
- ★ 测试踩坑：连接池持有 `cache.db` 句柄 ⇒ Windows `rmSync` 报 **EBUSY** ⇒ 清理前必须 `closeAllProjectCacheDbs()`。（`dc-index-triage` 写闸节）

### 4.4 探针与 A/B

```bash
node scripts/probe-dc-backfill-profile.mjs            # 后台续建：sync / resolve / 其余 三账 + 轮次
node scripts/probe-dc-cold-start.mjs                  # 冷启 vs 二次调用
node scripts/probe-dc-locality.mjs --flow             # 首读建块 + 后台补齐
node scripts/probe-dc-resolve-cost.mjs                # resolve 单独成本 + 预载占比
node scripts/probe-dc-write-through.mjs               # ★ 写穿 vs 绕过闸（三列指标）
node scripts/probe-dc-watch-refresh.mjs               # 正确性对拍
```

（`dc-index-triage` 步骤 1/2）

- ★ **跑探针前必须重建 dist**（`tsc`），否则探针**静默跑旧代码**；判据是探针里读到的字段是 `undefined`。（`dc-index-triage` 步骤 1）
- ★ 这些探针在 **dsh-brain 仓**的 `scripts/`（前缀 `probe-dc-`），不在本仓。（`dc-index-triage` 相关资产）
- **A/B 要开两份副本**：同一改动不要在同一份 db 上顺序跑两种策略（第一种会污染第二种）。结论要讲成"范围 + 一致性"，不要讲成速度对比 —— 旧的"更快"往往是因为**它漏**。（`dc-index-triage` 步骤 2）

### 4.5 高频坑（挑常用的）

| 坑 | 症状 | 正解 |
|---|---|---|
| 陈旧 dist | 探针跑旧代码，新字段 `undefined` | 跑前 `tsc` 重建 |
| Windows spawn 不存在命令 | 每次白等 ~5.1s，且不报错 | 纯 fs 查 PATH + 记忆化 |
| 循环 import + 模块级别名 | `indexedSet is not a function` | 两个模块间不要建 `const x = importedFn`，直接调用 |
| 扫到自己的派生物 | 命中数虚增、快照被改写 | `SKIP_DIRS` 必须含 `.design-canvas` |
| 嵌套事务 | `BEGIN` 在事务里抛 | 一律 `ownTx = !inTransaction(db)` 条件化 |
| PowerShell `>` 产 UTF-16LE | grep 报 binary、匹配不到 | 用 node 读并探测 BOM |

（`dc-index-triage` 坑）

---

## 5. 工具面盲测（`dc-face-bench`）

### 5.1 铁律：被试必须是**全新上下文的子代理**

造工具的人（= 你）当被试**毫无意义** —— 你"必然"选对，实验只会得到 100%。⇒ 被试 = `Agent`（`general-purpose`），**只给它一个文件路径**，禁止读仓库其它东西。（`dc-face-bench` §一）

### 5.2 五步

| 步 | 做法 |
|---|---|
| 1 | **生成面材料**：从 `TOOL_DEFS` + `facesOf(...)` 导出两个 txt（`name` + **完整 description**）。探针住**仓外** `.inspect/` |
| 2 | **题面只用任务语言**（"把文件改名"/"给函数补注释"），**绝不出现工具名** |
| 3 | **允许答 `NONE`**（"清单里没有能干这个的"）；不写这条 ⇒ 被试会**硬凑** |
| 4 | **输出机器可读**：`任务N: <工具名> \| 置信度: 高/中/低 \| 理由: ≤25字` |
| 5 | **逐条对期望工具判分**，单列三类：选对 / 诚实 `NONE` / **硬凑** |

（`dc-face-bench` §二）

- ★ 材料口径要写明：给被试的是 `name + description`，**不含参数 schema** ⇒ 比真 MCP 载荷小，别混着报。（`dc-face-bench` §二）

### 5.3 题目设计

- **两轮递进**：① 常规任务立基线；② **边界任务**落在两个相似工具的分界上（镜像对最锋利：`rename_files` ↔ `rename_symbols`；`edit_code` ↔ `annotate_functions`）。（`dc-face-bench` §三）
- ★ **镜像对要成对出**（说"文件"和说"符号"各一条）—— 单出一条测不出"混不混"。
- ★ 任务要**真实**（从你自己真做过的事里挑），不要造作。（`dc-face-bench` §三）

### 5.4 怎么读结果（别读成"证明了更好用"）

| 读数 | 它说明什么 |
|---|---|
| 面大的那边**全对** | ★ "列得多就会选错"**没被观察到** —— 不能反过来推断"列多了也没事" |
| 面小的那边出现 `NONE` | ★ 诚实够不着，**不是错**；代价是"多走入口" |
| 面小的那边出现**硬凑** | ★ 这才是"面偏了"的信号；看它自标的置信度 |
| 两边都不选 X | X 这个名字/描述有问题 |

（`dc-face-bench` §四）

- ★ **必须写"未核实清单"**（样本量 / 题面设计者是你 / 被试是子代理 / 置信度是否可信）。
- ★ 首测教训：**任务太容易区分时，两轮都会全对** —— 那不是"面好"，是实验没压力。（`dc-face-bench` §四）
- ★ **不要拿这个读数直接改编排面** —— 它只说明"任务覆盖"，用量层面的证据是另一回事。（`dc-face-bench` §六）

### 5.5 探针

```js
// .inspect/make_bench_faces.mjs （仓外；从 dist 读真注册表）
const { TOOL_DEFS } = await import(`${D}/application/tool_registry.js`);
const { catalogOf, LANE_META } = await import(`${D}/application/meta/registry/capability_map.js`);
const { facesOf } = await import(`${D}/application/meta/registry/tool_faces.js`);
const composed = new Set(facesOf(catalogOf(TOOL_DEFS), LANE_META.flatMap((m) => m.direct))
  .find((f) => f.id === 'composed').names);
```

（`dc-face-bench` §五）

- ★ `import` 走**绝对 `file://` 路径**（探针在仓外，裸包名解析不到）。
- ★ 面材料要给**入口**（如 `atomic_call`）也在内 —— 那正是被试真实看到的东西。

---

## 6. 开一条并行支线（`dc-open-parallel-line`）

### 6.1 先判形态：**worktree，不是 fork**

| | fork / 克隆副本 | `git worktree` |
|---|---|---|
| 历史 | 两份（会漂） | **一份**（共享 object DB） |
| remote | 两份，各自 push | **一份** |
| "哪份是最新" | 需要人判 | **不存在这个问题** |
| 主线不受影响 | ✅ | ✅ |
| 合回 | 跨仓 merge/rebase | **普通 branch merge** |
| **判据分叉** | ★ **高** | 低 |

（`dc-open-parallel-line` §一）

- ★ **理由**：fork 会造出**第二份判据**（同一件事住在两个地方 ⇒ 生产者与量具口径不一致 ⇒ 量具报假缺陷）。（`dc-open-parallel-line` §一）
- ★ 什么时候才真该 fork：与主线**产品不同 / 运行时不同**（底座不共享）。（同上）

### 6.2 四步

```bash
cd /d/project_develop/design-canvas

# 0) 先看状态
git remote -v && git branch -vv && git worktree list && git status --porcelain

# 1) ★ 先提交手上的文档工作（否则支线从 HEAD 起，缺你这半天的产物）
#    ⚠ docs/* 被 .gitignore 忽略 ⇒ 新增文档必须 -f；已 tracked 的正常 add
git add -f docs/<新文档>.md
git add docs/<已tracked的>.md
git commit -F - <<'MSG'
<type>(<scope>): <一句话>
MSG

# 2) 建 worktree + 分支（从刚提交的 HEAD 起）
git worktree add /d/project_develop/<仓名>-<线名> -b feat/<线名>

# 3) 核验
git worktree list
git -C /d/project_develop/<仓名>-<线名> status -sb
git -C /d/project_develop/<仓名>-<线名> log --oneline -1
```

（`dc-open-parallel-line` §二）

- ★ 用 **`git commit -F - <<'MSG'`**（quoted heredoc，防命令替换）；**消息里不要用反引号**（bash 命令替换会吃掉被包住的词）。（`dc-open-parallel-line` §二）

### 6.3 头号陷阱：不要在支线跑 `npm run mcp:install`

它写的是**用户级 / 全局**配置：

| target | 路径 | 级别 |
|---|---|---|
| claude | `~/.claude.json` | 用户级 |
| cursor | `~/.cursor/mcp.json` | 用户级 |
| copilot | `~/.github/copilot-mcp.json` | 用户级 |
| vscode | `<ROOT>/.vscode/mcp.json` | 仓级（安全） |
| trae | `<ROOT>/.trae/mcp.json` | 仓级（安全） |

（`dc-open-parallel-line` §三）

⇒ 在支线跑默认 CLI = 把你的全局 MCP 指向支线副本（而支线 `dist/` 还没 build）⇒ 主线的 MCP 当场"换源"。**支线上只能用 `--dry-run`。**（同上）

### 6.4 环境差异与管理协议

- 支线**没有** `node_modules` / `dist` / `.agent-io`（都是 gitignored）⇒ 要在支线跑东西：`npm ci` + `npm run build`。（`dc-open-parallel-line` §四）
- 管理协议：
  1. **一条线 = 一个分支 = 一个 worktree**；共享一个 `origin`、一份对象库。
  2. **同步节奏**：支线定期 `git merge main`（或 rebase）；**不要双向改同名文件**（冲突高发区：`docs/todo.md` / `docs/frontier-universal-framework.md`）。
  3. **合回条件**：写死一个**退出判据**。
  4. **不留墓碑**：线不要了 ⇒ `git worktree remove <path>` + `git branch -D <branch>`，不做"新旧并存"。
  5. **上线前判据**：支线该有**自己的验收**，不能只靠"看着对"。（`dc-open-parallel-line` §五）

### 6.5 核验清单（做完逐条打勾）

- [ ] `git worktree list` 显示两条，且**主线 HEAD 没被动过**
- [ ] 支线 `git status -sb` 干净、分支名正确
- [ ] 支线 `git log --oneline -1` 与主线一致（若从同一 HEAD 起）
- [ ] 支线目录里**能看到**本轮生成的文档（证明提交先做了）
- [ ] 支线上**没跑过** `mcp:install`（或将要用时只 `--dry-run`）

（`dc-open-parallel-line` §六）

---

## 7. 命令与 PATH

### 7.1 PATH 现状（两份 skill 互相矛盾，按实测选）

- 本仓：**PATH 现在正常**（2026-10-02 实测 `npx` / `tail` / `sed` 都可用）；旧版"PATH 是坏的、要 export 一长串"已过时。若真遇到 `'git' 不是内部或外部命令` ⇒ 那是**环境类失败**，先查 PATH，**别改代码**（会让 `project_root` / `harvest_from_url` 等 3 个文件假失败）。（`dc-add-tool` §二）
- DSH 宿主侧：`dsh-profile-integrity`「环境坑」仍写"Bash 工具 PATH 损坏（`dirname: command not found`）⇒ 每条命令开头 `export PATH="/c/Windows/System32:/c/Windows:/usr/bin:/bin"`"。**这两条至少有一条已过期** —— 本仓操作时先用 `which node git npx` 实测再决定，别照抄。（`dsh-profile-integrity` 环境坑）

### 7.2 引号 / 编码 / 临时文件

- `node -e` 里别放反引号 / `${}` / `(` / 正则 / 花括号，bash 会抢插值 ⇒ 写成 `.mjs` 再跑。（`dc-add-tool` §二；`gate-authoring` §5 边界检查）
- 写 `.mjs` / 生成物**务必 LF**（CRLF 会让旧的 vitest 报 `SyntaxError`）。（`dc-add-tool` §二）
- 临时脚本写到**仓外会话工作区**（`.inspect/`）或系统临时目录；`tests/` 已不存在。（`dc-add-tool` §二）
- 写含反引号的 markdown 时**别用 JS 模板字符串**（反引号会截断字面量）⇒ 用 Write 落文件再 `cat >>`。（`gate-authoring` §5）
- **同文件的两个 Edit 并行发 ⇒ 后者按旧快照覆盖前者，且两边都报成功** ⇒ 同文件编辑必须串行，改完 `grep` 验证关键标记。（`gate-authoring` §5）
- **`node -e` 的正则可能被 CRLF 的 `\r\n` 吃掉** ⇒ 注入没生效却不报错。（`gate-authoring` §5b）

### 7.3 Windows 路径

- Git Bash 的 `/c/tmp/...` 交给 `path.resolve` 会变成 `C:\c\tmp` ⇒ **静默得 0 文件**；用 `C:/tmp/...` 真路径。（`dc-remove-tool` §四）
- `git -C /d/...` 会报 `cannot change to '/d/...': No such file or directory` —— 看起来完全像"目录不存在"，会让人对现状下错结论；一律用 `D:/...`。（`git-repo-hygiene` §三）
- 跨盘 `fs.renameSync` 会 `EXDEV` ⇒ 备份区必须与源同盘。（`dsh-profile-integrity` 环境坑）

### 7.4 删除护栏与 PowerShell

- 宿主对 `fs.rmSync` / `unlinkSync` 有**批量删除护栏**：阈值 **50 / turn**，超过会抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`；跑全量测试时尤其容易被误判成"代码坏了"。收尾改成"先删，删不动就置空"。（`dc-add-tool` §四；`dc-remove-tool` §二.3；`gate-authoring` §5d）
- PowerShell `>` 产 **UTF-16LE** ⇒ `grep` 报 binary；用 node 读并探测 BOM。（`dc-index-triage` 坑）
- PowerShell 5.1 读**无 BOM** 的 `.ps1` 会按 ANSI(GBK) 解码 ⇒ 中文乱码 ⇒ 语法错 ⇒ **`.ps1` 必须带 UTF-8 BOM**；反过来 **json / yaml / 源码必须无 BOM**（BOM 会让 `JSON.parse` 在首字节抛错，整个 gen 起不来）。（`git-repo-hygiene` §五；`dsh-profile-integrity` §3）

---

## 8. 验收四条（加/删工具都跑这一套）

```bash
cd <repo>

# 1) 类型层
npx tsc --noEmit; echo "EXIT=$?"

# 2) 产物层（★ 只有主控能跑；并行的执行者不许 —— 会重写共享 dist）
npm run build; echo "BUILD_EXIT=$?"      # 内含 gen_agents → tsc → clean_dist

# 3) 结构读数（应三态全 0）
npm run structure:gap

# 4) 真调（不能只"编译过了"）
node dist/src/presentation/cli/cli.js <tool> --json '{...}'
#    无参调一次 ⇒ 应给人话缺参错误，不是 Node 原始异常
#    paths[0] / Cannot read propert / The "path" argument 都是不合格
```

（`dc-add-tool` §五；`dc-remove-tool` §四）

| # | 层 | 合格判据 | 谁能跑 |
|---|---|---|---|
| 1 | 类型 | `EXIT=0` | 任何人 |
| 2 | 产物 | `npm run build` 成功，`clean_dist` 报"孤儿 0 个 / dist 与源码一一对应" | **只有主控** |
| 3 | 结构 | `structure:gap` 三态全 0 | 任何人（只读） |
| 4 | 真调 | 无参给人话错误；正常路径回执可读且 `---DATA---` 可解析 | 任何人 |

（判据综合自 `dc-add-tool` §五、`dc-remove-tool` §四）

**删除场景另加三条**（`dc-remove-tool` §四 附加确认）：
- 已删工具报 `未知工具名: <name>`；
- 保留工具真跑 happy path（防删多了）；
- 工具计数 `grep -h "^    name: '" src/application/*/index.ts | wc -l` 与 README 对齐。

**加工具场景另加一条**（`dc-add-tool` §四 历史节的判据，仍值得照搬）：
- 回执是人/LLM 唯一能看到的诚实出口 ⇒ **要看回执本身**（人话段 + `---DATA---` 段），别只看退出码。

---

## 9. 提交注意（只列 skill 里写死的，不代表本任务要提交）

- `docs/` 被 `.gitignore` 忽略 ⇒ 提交文档要 `git add -f docs/<file>`。（`dc-remove-tool` §六；`dc-open-parallel-line` §二.1）
- 一条 `git add` 失败会让后面的 `commit` 静默跳过（`&&` 链）⇒ 回看 `git log -1` / `git status`。（`git-repo-hygiene` §八）
- 提交信息用 `git commit -F <文件>`，**绝不用 `-m`**：`-m` 里的反引号会被 shell 当命令替换执行，那段内容**静默消失而提交照样成功**。（`dsh-delegate-loop` §6.6；`dc-open-parallel-line` §二）
- 并行执行时每个执行者**只 `git add` 自己改过的具体文件路径**，禁 `git add -A` / `git add .`；全量测试只由一个人跑。（`dsh-delegate-loop` §8.2）
