# T-#LEDGER-ENGINE 侦察报告（leng-recon-hy）

仓库：`D:\agentio\dev\agent-io`（软链 → `D:\Projects\ai\agentio\dev\agent-io`）。只读侦察，未改文件、未跑重门。时间：2026-11-17。

---

## 0. 结论速览

1. **docs/todo.md 的真机器消费者只有 2 个**：`scripts/patrol.mjs#ledgerCheck`（读全文切行，报"已了结仍占位"与超长行）与 `scripts/lint-prose-as-structure.mjs` 的 DOC_STRUCTURE_GUARDS 一条（`mustHave` 两个路径串）。src/ 里 44 处 `docs/todo.md` 全是注释，不是读端。`scripts/plan-assertions.mjs` 的 LEDGER 指向 `docs/DESIGN.md`，不是 todo.md。
2. **CLI 没有自己的 action 注册表**：它是 `TOOL_DEFS` 的投影（`cli.ts:36,93`）。新能力要么加进某 lane 的 `*_TOOLS`（同时进 MCP/HTTP/CLI），要么做成既有工具的一个 action（`get_dsl query=ledger` 是最省面的一条）。`---DATA---` 的唯一解析器在 `plumbing.ts:181,184`。
3. **MCP 面棘轮**：加一个新工具 = `tools 40→41` + bytes 增加该工具 wire 条目大小（当前 154034 B / 40 工具 ≈ 3.85 KB/工具；最大 `get_dsl` 13939 B），必须 clean run 后 `node scripts/mcp/mcp_scan.mjs --update`。**建议走 get_dsl 的 action，零增长**，且 get_dsl 已在 minimal face，MCP 侧天然可达。
4. **§A–§I 形态统计（L14–568）**：ID 作首列的表格行 178 条、ID 嵌在其它列的"混合"行 8 条、散文行 6 条，共 192 条带 ID 行；另 §H L500–508 是无 ID 的 PR 链纪律散文，importer 必须保留为节元数据。全文件 624 行，24 行 >1800 字符，最长 7398 字符。
5. **测试**：纯函数层用 node:test + 临时 home（`makeTempHome`/`AGENT_IO_HOME`），仿 `p0_task_write_locked` / `p0_two_phase_claim`；importer/.mjs 调用层仿 `p1_cascade_root`（mkdtemp + 拷依赖闭包 + `closeAllProjectCacheDbs`）。现有夹具**没有**内存 tasks.db 先例，一律临时 home 真文件。
6. **待论证点**：② MD 进 Git（评审面，配 regen+diff 门）· ④ 优先 `get_dsl query=ledger`，新工具为备选 · ⑤ 一次切换 + 一个 verification window 的双读，不做长期双写。

---

## 1. MD 台账的机器读端盘点

### 1.1 真消费者（会打开 docs/todo.md 并按文本处理）

| 消费者 | 位置 | 读法 | 消费什么 | 引擎化迁移 |
|---|---|---|---|---|
| `patrol.mjs#ledgerCheck` | `scripts/patrol.mjs:136` 定义 `LEDGER_REL='docs/todo.md'`；`:170-194` 函数；`:196` 调用；`:198-200` 进 `--json` 的 `ledger` 段；`:224-236` 人读输出 | `readFileSync(abs,'utf8').split(/\r?\n/)`（`:173-174`） | ① `LEDGER_CLOSED=/✅\|已了结\|已收口\|已结案\|已闭合/`（`:139`）＋ `LEDGER_OPEN_WORK`（`:150`）＋ `closedOutsideQuotes()`（`:160-168`）判"整行已了结却仍占位"；② `LEDGER_MAX_ROW=1800`（`:137`）判超长行；③ `rowId()`（`:180-183`）从 `**T-#…**` 或行首格取 ID；分母 = 非空行数 | **改读引擎**：`query(active)` 已默认滤已销账 ⇒ "已了结仍占位"在结构上归零，patrol 这一格变为"视图新鲜度对账"（生成视图 ≡ 引擎 active 集）；超长行判据移到视图生成器（生成时保证行长），patrol 只读生成报告的 `overlong` 计数。保留 `ledger` JSON 段形状（`ok/path/kb/lines/scanned/closed/long`）不破坏下游。 |
| `lint-prose-as-structure.mjs` 的守卫 | `scripts/lint-prose-as-structure.mjs:437-442`（`file:'docs/todo.md'`, `mustHave:['scripts/probe-gate-cov.mjs','scripts/probe-ratio-nesting.mjs']`）；实际 `readFileSync` 在 `:475` 的 `checkDocStructureGuards` | 整篇当字符串做 `text.includes(s)`（`:476-477`） | 两个**文件路径串**，钉"§一 2.5 每个数自带可复算命令" | **读生成视图最小改法**：把 `file` 改成视图路径（如 `docs/todo.generated.md`），守卫语义逐字不变；若 MD 视图保持进 Git（见 §6），这就是零风险迁移。进阶：改为 engine query 断言两条 debt 行的 evidence 字段存在，但那要动守卫 schema，不值当。 |

### 1.2 只在注释/文档里提到，不是读端（grep 全仓）

- `scripts/`：
  - `gen_manifest.mjs:4`、`gen_cognition.mjs:4`、`history-search.mjs:5`、`audit-tool-certs.mjs:15`、`migrate-decision-history.mjs:13,16`、`probe-ratio-nesting.mjs:5`、`probe-gate-cov.mjs:5`、`write-log-audit.mjs:3`、`verify.mjs:436,458`、`run-tests.mjs:574,668`、`measure_b_contract.mjs:550,557,644`、`new-observe-lang.mjs:191-192` —— 全部是头注/回执文案里引用 `docs/todo.md` 的条目号或纪律，**没有 `readFileSync('docs/todo.md')`**。
  - `scripts/plan-assertions.mjs:29`：`const LEDGER = 'docs/DESIGN.md'`（`:117-119` 做 `ledgerText.includes(debt)`）—— 是"debt 台账"，但对象是 DESIGN.md，不是 todo.md；引擎化时**不受影响**（除非债务账也一并迁，那是另一张卡）。
  - `scripts/rejection-stats.mjs:117-149`、`inventory-sweep.mjs:277-289,528-555` 里的 `ledger` 是各自的 JSON 台账（usage/inventory），与 todo.md 无关。
- `src/`：grep `docs/todo.md` 命中 44 处，**全部是注释/回执文案**（如 `src/application/source_writer.ts:60`、`write_gate.ts:681,1740`、`src/domain/scope.ts:2` 等），0 处 `readFileSync`。
- `.agent-io/scratch/t32/{pre,post}/docs/todo.md` 是历史快照副本，不是活消费端。

⇒ **盘点结论：迁移面很小（2 个消费者），不存在"一堆脚本解析 MD"的隐藏债务。**

---

## 2. `get_dsl` / CLI action 目录与最小挂法

### 2.1 注册链（唯一真相源 → 三个面）

```
src/application/<lane>/index.ts 的 *_TOOLS: ToolDef[]
  → src/application/tool_registry.ts:46-66  LANE_SOURCES + TOOL_DEFS（汇总 + 注解绑定 + 缺键即报）
  → src/presentation/mcp/server_registry.ts:1222-1239  registerAllTools（MCP）
  → src/presentation/cli/cli.ts:36,93,300  CLI（按名 find + invokeTool）
  → src/presentation/http/serve.ts:2540-2606  GET|POST /api/tool/<name>（HTTP）
```

- `ToolDef` 形状（`src/application/types.ts`；实例化样例 `src/application/observe/index.ts:55-78`）：
  `{ name, writes:boolean, title, description, inputSchema:<zod raw shape>, handler: wrap|wrapData(async a=>{...}) , annotations? }`。
- 5 条 lane（`tool_registry.ts:46-52`）：`observe` / `cross` / `design` / `meta` / `refactor`。注释说"6 条"是历史措辞，实际数组 5 个。
- 注解：`src/application/tool_annotations.ts:24` 的 `TOOL_ANNOTATIONS` 必须覆盖全部工具名，`tool_registry.ts:58-64` 缺键即抛。
- **action 不是独立注册表**：是工具 handler 内部的字符串分派，如 `observe` 的 `action=log|trace|judge`（`observe/index.ts:80-99`，`ACTION_SPEC` 在 `:96-98` 注明"handler 认的 action/字段必须在 inputSchema 里能传进来"）、`edit_dsl` 的 `op`、`get_dsl` 的 `query`。`get_dsl` 本身是注册在册的工具（`tool_annotations.ts:34` 标 `readOnlyHint:true`）。

### 2.2 新 action 的最小挂法（三档，按代价排序）

1. **最省：挂现有工具的 action** —— 在 `get_dsl` 的 `inputSchema.query` 枚举里加 `'ledger'`，handler 分派里加一支，description 补一句。CLI 无需改一行（`cli get_dsl query=ledger --json '{...}'` 自动可用），MCP 面字节只在 get_dsl 条目内小幅增长（不动工具数），minimal face 已含 get_dsl ⇒ agent 天然可达。
2. **中档：新 ToolDef `ledger` 挂某 lane** —— 在 e.g. `src/application/meta/index.ts:242` 的 `META_TOOLS` 数组里加一条 `{name:'ledger', writes:true/false, ..., inputSchema:{action:z.enum([...]),...}, handler: wrapData(...)}`，再在 `tool_annotations.ts` 加一条注解（否则模块加载即抛）。**同时**进 CLI/MCP/HTTP；CLI 不需要注册代码。
3. **CLI-only（无先例，需破纪律）**：`cli.ts:93` 只从 `TOOL_DEFS` 找名字，没有"CLI-only 工具"概念；`server_registry.ts:1166-1177` 的 `atomic_call` 是**MCP-only 且故意不在 TOOL_DEFS、故意不能经 CLI 调**的反向先例。真正的 CLI-only 只能写成独立脚本 `scripts/ledger.mjs`（不进注册表）或在 `cli.ts` 加特判分支（破坏"CLI 是投影"的头注纪律，不推荐）。

### 2.3 `---DATA---` 输出约定

- 唯一常量与解析器：`src/application/plumbing.ts:181 export const DATA_MARKER='---DATA---'`；`:184+ parseDataBlock`（注释：旧约定 `text.split('---DATA---')[1]` 整段当 JSON，新解析器取头一段，容忍后面追加文本）。
- 统一出口 `wrapData`（`plumbing.ts:171`）：handler 返回 `{message, data}` ⇒ 输出 = 人话 message + `\n---DATA---\n` + 一行 JSON。`wrap` 在 gate 拒绝时也会追加 `---DATA---{errors:[...]}`（`plumbing.ts:245-256`）。
- CLI **不改工具输出**：`cli.ts:305-321` 只在缺参时前置提示（注释 `:303` 明写"末尾留给 `---WARNINGS---`/`---DATA---` 机器块"），然后逐字 `process.stdout.write(outText)`。退出码 `r.isError ? 1 : 0`（`:322`）。
- 其它消费者靠这个约定：`scripts/judge-all.mjs:84,139,172,193`、`scripts/setup.mjs:125-127`、`scripts/gen_cognition.mjs:160`、`tests/budget/payload_budget.test.ts:82-84`。

⇒ ledger action 的回执必须是「人话首行自足 + `---DATA---` 一行 JSON（`{rows:[], total, scanned, unavailable?}`）」，用 `wrapData` 产出，不要自拼分隔符。

---

## 3. MCP 工具面：注册点、棘轮字节口径、只挂 CLI 的取舍

### 3.1 注册点

- 汇总：`src/application/tool_registry.ts:54-66`（`TOOL_DEFS`）。
- 注解必配：`src/application/tool_annotations.ts:24-70`。
- MCP 注册：`src/presentation/mcp/server_registry.ts:1222-1239`，`registerAllTools` 按 `mcpFace()` 决定 exposed：默认 `all` = 全部 TOOL_DEFS（`:1133-1134`）；`composed` = 编排面；`minimal` = `MINIMAL_FACE_TOOLS` 高频 6 工具 + `atomic_call`（`:1152-1164`）。
- 面定义唯一住处：`src/application/meta/registry/tool_faces.ts:65`。

### 3.2 棘轮的字节口径（关键）

- 基线文件：`scripts/mcp/tool-surface-baseline.json`：
  `tools=40, bytes=154034, totalBytes=154119, capturedAt='2026-11-10', isolated=[]`；`top10` = get_dsl 13939 / edit_dsl 7540 / edit_code 7510 / design_line 7466 / refactor_pipeline 6575 / capability_map 6360 / rules 5745 / rename_symbols 5742 / observe 5734 / apply_refactor_plan 4875。
- **口径 = wire 字节，不是字符**：`scripts/mcp/tool_surface.mjs:26-27,40-103` 起真 stdio MCP server → `initialize` → `tools/list` → 对每个工具条目 `Buffer.byteLength(JSON.stringify(entry),'utf8')`；`surfaceSummary`（`:109-121`）求和得 `bytes`（不含 JSON-RPC 信封），`totalBytes` 含信封。基线 note 明写 2026-11-02 从 UTF-16 字符改为 UTF-8 字节（中文一字 3 字节，旧尺低估约 1.6 倍且不含 actor/authorize 注入）。
- 判据（`scripts/mcp/mcp_scan.mjs:293-343`）：
  - ① `surfaceBytes <= base.bytes`（当前 154034 为上限）
  - ② `toolCount <= base.tools`（40 为上限）
  - ③ 基线必须含 ≥5 条 top10 明细
  - ④ dist 新鲜度（`checkStaleBuild` 内容哈希）
  - ⑤ 孤立工具集不许增长（真实调用 0 ∧ 代码引用 0；§14.1）
  - 基线缺失 = **FAIL**，不许自建（`:263-269`）。
- **加一个工具涨多少**：
  - `tools` +1（40→41，② 当场红）；
  - `bytes` += 该工具 `tools/list` 条目的 wire 字节。经验标定：均值 ≈154034/40≈3851 B；最小工具约 1–2 KB，带中文 description 的约 3–8 KB（最大值 get_dsl 13939 B）。一个紧凑 ledger 工具（短 description + 6–10 个 zod 字段）合理估计 **+1.5–3 KB**，新基线约 155.5–157 KB。
  - 若它是"只生成自己才读"或没接消费者，⑤ 还会新增孤立工具红 ⇒ 必须先接真实消费者。
- **`--update` 流程**：`node scripts/mcp/mcp_scan.mjs --update`（需先 `npm run build`）。写盘被推迟到本次判完之后（`:271-273,378-412`）：有任何坏签名或棘轮失败 ⇒ 拒绝写；⑤ 的 `isolated` 只保留上一版值、**不许把新孤立工具洗进基线**（`:274-289,401-403`）。更新后必须在 commit message 写理由。

### 3.3 "只挂 CLI 不挂 MCP" 的取舍

| 维度 | 只挂 CLI（独立脚本或 CLI-only 特判） | 进 TOOL_DEFS（CLI+MCP+HTTP 同源） | 挂 get_dsl action（推荐） |
|---|---|---|---|
| MCP 面增长 | 0，棘轮不动 | +1 工具 +约 1.5–3 KB，需 clean `--update` | 仅 get_dsl 条目内小幅 +bytes，`tools` 不变 |
| 孤立工具门 | 不触发 | 需证明有真实消费者（patrol/importer/agent），否则 ⑤ 红 | 不触发 |
| agent 可达性 | 无 —— MCP 客户端（含本会话的 dsh）**看不到**能力 | 默认 all face 可见 | minimal face 已含 get_dsl，天然可达 |
| 与仓库纪律一致 | **不一致**（CLI 头注 `:3-18` 明写"CLI 是投影，不新造机制"；独立脚本则是另一条路） | 一致（标准姿势） | 一致（仓库已有 observe/get_dsl 多 action 先例） |
| 适配卡片"CLI/MCP 双入口" | 违背 | 满足 | 满足 |

**判断**：T-#LEDGER-ENGINE 卡面写的是"CLI/MCP 双入口"，且 §H ⑤ 要求"开工先查账"，这是 agent 侧动作 ⇒ 不能只挂 CLI。**首选 get_dsl 的 `query=ledger` action**：满足双入口、零棘轮动作、minimal face 可达；若后续要独立成一等工具，再走 lane + annotations + `--update` 的完整流程（作为子卡 D 的升级项，而非本期）。

---

## 4. §A–§I MD 行的三类形态统计与 importer 形态学

### 4.1 统计口径与结果（行范围 L14–568 = §A 起至 §I 台账引擎节止）

用 PowerShell 逐行分类：带 ID（`T-#…` / `D-#…` / `T\d{2,4}`）的行按"ID 是否为表格首列"分：

| 形态 | 条数 | 真实样例 |
|---|---|---|
| ① 表格行，ID 即首列（`\| T-#… \|`） | **178** | `docs/todo.md:175`：`\| T-#EXPECTED-DEPS-EMPTY \| ★★ **第三处投影缺失**：... \| .agent-io/design/*.dsl.json · gen_design_db.ts \|`（§A「来源行（原文）」，3 列） |
| ② 散文节 / 散文行 | **6** | `docs/todo.md:50`：`- 来源：\`T-#FILE-NOT-IN-GEOMETRY-UNWRITABLE\` · \`T-#NODE-IN-TWO-BOOKS-UNCLEANABLE\` · ...`（§A）；`docs/todo.md:246`：`最大结构债 \`T-#KILL-LEGACY\`（...）。全部 KEEP...`（§D） |
| ③ 混合：表格行但 ID 在其它列（批次映射/来源列） | **8** | `docs/todo.md:187`：`\| F1 \| write_log 对账接「自动开 candidate 卡」... \| \`T-#NO-CARD-CHANGE-NEEDS-THIRD-LEDGER\` \| 无卡写 ⇒ 卡进 pool... \|`（§B，ID 在第 3 列） |
| 合计 | **192** | — |

补充事实：
- 另有 **§H L500–508 的 PR 链纪律**（`> 台账行 = 一条 PR` 及其 ①–⑥ 条）是**无 ID 的指令性散文**，定义批注追加不改写、lead 裁定、开工先查账、跨批次存活。importer 必须把它保存为节元数据（section rules），否则迁移后纪律丢失。
- 同 ID 会在两处出现：§C 映射表引用 `ASSERTION-OWNER-BOOK-IMPLICIT`（`docs/todo.md:211`）与 §A 原文行（`docs/todo.md:176`）；§B 的 F7 与 §B 来源行同 ID（`:194,198`）。⇒ importer 必须 **idempotent upsert**，不能按行盲插。
- 全文件 624 行；24 行超过 patrol 的 `LEDGER_MAX_ROW=1800`，最长 7398 字符 —— 直接支撑"MD 降为派生视图"的动机（长行是给人看的，不该是机器真相）。

### 4.2 importer 解析器形态学（按 section 分别配解析器）

| 节 | 表头 / 列数 | 代表行 | 解析要点 |
|---|---|---|---|
| §A | `:185` 风格 4 列 / `:173` 起"来源行" 3 列 | `:175`（3 列） | ID 首列；★ 等级在描述里；第 3 列是证据路径 |
| §B | `:185` `\| # \| 任务 \| 来源 \| 判据 \|`（4 列）+ `:196` 来源行 3 列 | `:187`（混合）、`:198`（ID 首列） | F1/F2… 是批次号，ID 在"来源"列 ⇒ 抽成 `source_ids[]` |
| §C | `:207` 3 列 | `:209` | 消掉/并入：cell 里是裸名（`CORRUPT-AS-EMPTY-FAMILY`）或 `T-#…`；`~~删除线~~` 表示已消 ⇒ state=void |
| §D | 点名条目 3 列 | `:255` 起 | 36 条原文行；规模口径特殊（"30 条单列不按条数算"） |
| §E | 3 列 | `:296-373` | 治理条目 + "消掉/吸收的账"子节 |
| §F | 裁决留档 1 行 1 条 | `:388-402` | 无表格，是裁定记录 ⇒ 直接进 verdict/annotation 通道，不是 task row |
| §G | `:410` 指针行 4 条 + `:413` KEEP 83 条（3 列） | `:571-592` 历史账区（`D-#*` / `T###`） | "原文存档"，ID 形态最杂（`D-#*`、`T\d+`、裸名如 `KILL-LEGACY`）；ID 正则必须放宽 |
| §H | `:510` 5 列 `\| 编号 \| 任务 \| 当前裁定 \| 待论证点 \| 规模 \|` | `:512-520`, `:567` | **当前裁定/待论证点两栏直接映射** engine 的 `verdict` 与 `open_questions[]`；规模列 → size |
| §I | 4 列 `\| 编号 \| 任务 \| 当前裁定 \| 待论证点 \|` | `:530-537`, `:543-548`, `:554-561`, `:567` | 同上无规模列；P1/新大陆/缺账/引擎四个子节 → `section` 字段 |

⇒ 解析器需要：`section` + `row_shape`（id-key / id-in-source / prose）+ 可变列数 schema + `**bold**` 去壳 + 反引号去壳 + `idempotent upsert` + 保留 §H 纪律为节元数据。`--dry-run` 必须先报三类行数（178/8/6）与重复 ID 数再允许落库。

---

## 5. 测试面设计

### 5.1 现有手法（实证）

| 测试 | 夹具手法 | 可借鉴点 |
|---|---|---|
| `tests/p0_task_write_locked.test.ts:40-51,53-91` | `makeTempHome()`（`tests/helpers/i1_fixture.ts:12` = `fs.mkdtempSync(os.tmpdir())`）→ 运行期设 `process.env.AGENT_IO_HOME`（storage 每次调用都读）→ `inSandbox(fn)` 保存/恢复 env + `rmRf(home)`（`:50-68` 带 EBUSY 重试） | **无内存 DB**：全部经真实 `storage` 写临时 home 下的文件；不传 `baseDir`，避免"写一处读另一处"的假绿（文件头 `:15-18` 明写这个坑） |
| `tests/p0_two_phase_claim.test.ts:122-186` | `before()` 设 `AGENT_IO_HOME` + `saveDSL` 最小册（6 节点夹具）；`after()` rmRf；真跑 `editDslHandler` | 走应用层同一条路（`:71` 注释），不自己发明写盘；`source_root` 指向真仓根只为 file-exists 判据只读 |
| `tests/p1_cascade_root.test.ts:26-31,62-107` | mkdtemp 项目根 + 造册 + **把 `.mjs` 生成器连同 `scripts/lib/` 闭包整份拷进夹具** + 动态 import 带 cache-buster + `closeAllProjectCacheDbs()` 后再删（Windows 句柄 EBUSY） + `AGENT_IO_REQUIRE_PLAN=0` | 测 `.mjs` 脚本（importer / view generator）的标准姿势；依赖闭包必须拷，否则红在 ERR_MODULE_NOT_FOUND 而不是判据上 |
| `tests/p0_change_set_view.test.ts:245-260` | 只读测试用真实项目 `.agent-io/tasks.db` 的 mtime 前后相等 | "引擎只读"类断言的先例 |

⇒ **没有 tasks.db 内存态夹具的既有手法**。引擎层的 DB 测试应沿用临时 home 真文件（`AGENT_IO_HOME` 隔离 + `rmRf`），不要新造 `:memory:` 注入口径，除非同时在引擎里开 DB 注入端口（那是额外设计面）。

### 5.2 给 ledger 引擎的测试设计（建议 4 组）

1. **纯函数层（快、可行为化）**：状态机与查询语义做成零依赖纯函数（仿 `src/application/patrol/ledger_staleness.ts` 的"纯读、宿主是脚本"和 `src/domain/task_schema.ts#evidenceFreshness`），放 `tests/` 用 node:test：
   - `close(state, at, evidence)` 必须带证据，缺证据抛；物理删除 API 不存在（`symbol-exists` 反向断言）。
   - `query({include_closed:false})` 默认滤 `done|void|superseded`；`include_closed:true` 能取回墓碑（对应 §网检 Boomslang 的 phantom ambiguity 修正）。
   - `annotate` 只追加不改写：对同一 id 两次 append，原行字节不变。
   - `supersede` 必须写 `superseded_by` 指针（对应 CASRAI tombstone 的 successor link）。
2. **DB 层（真 tasks.db 临时 home）**：仿 `p0_task_write_locked` 的 `inSandbox`：
   - 建表 + 写入 + 关闭后重开读回，断言 append-only（直接 `UPDATE annotation` 被 trigger/闸拒）；
   - 并发两笔销账用乐观锁（仿 task 写端 rev 冲突的手法）断言不覆盖；
   - 关闭所有 DB 句柄后再清理（`closeAllProjectCacheDbs()` + `rmRf` 重试）。
3. **Importer 层（.mjs 手法）**：仿 `p1_cascade_root`：把一小片真实 §A–§I（含三类形态各 1 行 + §H 纪律段）写进 mkdtemp 项目根，跑 importer，断言三类都解析、行数 = 178/8/6 的全量口径或子集口径、**二次导入零重复**、§F 裁定进 annotation 而非 task row。
4. **视图/消费者回归**：生成视图后跑 `lint-prose-as-structure` 守卫（应绿）与 `patrol --json`（`ledger` 段形状不变）；再对生成视图做字节稳定哈希（同输入两次生成逐字相等）。

**消融口径**（写进测试文件头，仿 `p1_cascade_root:18-24`）：把 active 集过滤去掉 ⇒ 测试 1.2 红；把 annotate 改成 UPDATE ⇒ 1.3 红；把 importer 的 idempotent upsert 去掉 ⇒ 3 红；视图生成器加随机排序 ⇒ 4 红。

---

## 6. 最小落地切分（4 张子卡 + 验收判据）与我负责的三个待论证点

### 6.1 子卡切分

**卡 A · 引擎核（schema + 状态机 + 查询）**
- 交付：`tasks.db` 新表（rows / events 或 annotations / verdicts），纯函数层 + DB 适配层；逻辑删除 = `state ∈ {open,done,void,superseded}` + `closed_at` + `evidence`（不物理删）；批注只追加；查询默认滤已销账，支持 `include_closed`。
- 验收：§5 测试组 1+2 全绿；全仓 grep 无 `DELETE FROM <ledger表>`；一次销账后可查回历史行。

**卡 B · importer + 生成视图**
- 交付：解析 §A–§I 三类形态（178/8/6）+ §H 纪律元数据 + §F 裁定；idempotent upsert；视图生成器（稳定排序 + 头部 `GENERATED — edit via engine`）。
- 验收：§5 测试组 3+4 全绿；`--dry-run` 报三类计数与重复 ID；二次导入零新增。

**卡 C · 消费端迁移**
- 交付：`patrol.mjs#ledgerCheck` 改读引擎 active 集/视图报告（保持 JSON 段形状）；`lint-prose-as-structure.mjs:439` 的 `file` 指向生成视图。
- 验收：`patrol --json` 的 `ledger` 段字段不变；`lint:prose` 绿；`grep -r "readFileSync.*docs/todo.md" scripts/` 只剩 importer/生成器。

**卡 D · 入口面**
- 交付：`get_dsl` 加 `query=ledger`（action 方式）→ CLI/MCP/HTTP 同源；`---DATA---` 返回 `{rows,total,scanned,unavailable}`。
- 验收：`cli get_dsl query=ledger --json '{}'` 有数据段；`mcp_scan` ① ② ⑤ 不红（工具数仍 40）；若改走新工具，须 clean run 后 `--update` 且 commit 写理由。

### 6.2 我负责的三个待论证点

**② MD 视图进不进 Git —— 结论：进 Git（作评审面），但配 regen+diff 门；tasks.db 不进 Git。**
- 证据：`gen_manifest.mjs:31,41` 的判据是 churn——MANIFEST（声明、低 churn）进 Git，COGNITION（快照、随每次代码改动变、高 churn）不进（`gen_cognition.mjs:10-11,201`；`.gitignore:163` 明确 `!docs/todo.md` 活资产）。
- 台账行核销是低频事件（§A–§I 192 行跨多批次，历史区 D-#* 原样保留），churn 更像 MANIFEST 不像 COGNITION；且 patrol/lint 已经把 todo.md 当"人读评审面"，Git diff 是 PR 链批注的天然载体（§H ③"追加不改写"逐字对应 git diff 可评审性）。
- 防漂移：加一道 `ledger:view:check`（仿 `gen-db-check` / `cognition:check`）：重生成视图与 Git 版本逐字节比，不一致即红；生成视图头部声明 GENERATED，任何手工编辑在下一轮被门点名。

**④ 入口选择 —— 结论：优先 `get_dsl query=ledger` action；新工具 `ledger` 是升级项。**
- 理由见 §3.3：零 MCP 面增长、minimal face 已含 get_dsl、CLI 投影零改动、满足卡面"CLI/MCP 双入口"。独立脚本/CLI-only 违背 `cli.ts:3-18` 的投影纪律且 agent 不可达。

**⑤ 迁移策略 —— 结论：一次切换 + 一个 verification window 的双读，不做长期双写。**
- importer 一次性迁入 §A–§I，冻结 MD 手工编辑；生成视图后，在一个 patrol/lint 周期内同时用旧 MD 与新引擎各读一次，对齐读数（`ledger` 段字段、lint mustHave 命中），随后把两个消费者钉到引擎/视图。
- 为什么不做长期双写：本仓头号病就是"两处权威"（`tool_registry.ts:4-14`、`plumbing.ts` 多处注释），双写会把刚治好的病换个地方复发；双读窗口是只读对照，不产生第二写端。

---

## 7. 网检（arXiv + Crossref 渠道）

**渠道状态**：arXiv 通道可用（abs/html  fetched）；**Crossref 官方站 `eventdata.crossref.org` 两次 `web_fetch` 均 `TypeError: fetch failed`**，按预案换免费源并在下列条目注明；arXiv PDF 直取返回 `unsupported content type`，改取 abs/html/search 摘要。

### 主题 1：append-only audit log 的数据模型（≥2 来源）

1. **arXiv:2606.28876** — *MMLA: Memory-Mediated Learning Architecture for Predictive Dual-State Adaptation*（[abs](https://arxiv.org/abs/2606.28876)，v4 2026-09-14）。摘要明确：trusted lifecycle "atomically commit one typed row or exact NULL"，且 "writers, resets, rollback domains, and ledgers remain distinct"。
   - **支持**：权威账（ledger）必须与派生视图、预测态分开存储；每条是 typed row，不是可改写散文。⇒ 卡 A 的 rows/events 表独立于 MD 视图，写入走单一 append 通道。
2. **arXiv:2511.03393** — *Data pipeline 的 SCD Type 2 段*（[PDF](https://browse-export.arxiv.org/pdf/2511.03393)）："existing row for T002 is closed by setting `valid_to`… new row inserted with `valid_from`… `valid_to=NULL`"，并给出时点查询 `valid_from <= t AND (valid_to IS NULL OR valid_to > t)`。
   - **支持 + 修正**：我们原设计只有 `state + closed_at + evidence`；该来源建议**同一行带生效/失效时刻对**（`opened_at` / `closed_at`），使"某时刻台账长什么样"可复算。⇒ 卡 A schema 加 `opened_at`，查询加 `as_of` 可选参数（低成本、高审计价值）。
3. **补充（arXiv:2607.19436）** — *Building Trust in Autonomous Commerce*（[PDF](https://export.arxiv.org/pdf/2607.19436)）：canonical event schema 捕获完整 state transition，tamper-evident timeline + Merkle commitment。
   - **修正**：本期不做 Merkle，但审计级场景应预留 `prev_hash/entry_hash` 字段，否则"永久可审计"只保证不被物理删，不保证不被偷偷改。

### 主题 2：soft delete vs tombstone 的查询语义（≥2 来源）

1. **arXiv:2604.20587** — *Making Transaction Isolation Checking Practical (Boomslang)*（[HTML §2.2/§5.1](https://arxiv.org/html/2604.20587v1)）：明写 "Another assumption is the use of tombstones: instead of modeling physical deletion, checkers assume the system inserts a logical marker. Databases do not implement deletion this way."；并举 phantom ambiguity：range query 没返回 y，无法区分"从未插入"与"插入后删除"。
   - **支持**：tombstone 是查询模型假设，不是存储事实 ⇒ 我们必须在**查询层**显式区分"没有这行"与"有墓碑行"，不能只靠默认过滤。
   - **修正（重要）**：默认 `query(active)` 过滤已销账的同时，必须提供 `include_closed=true` 或 `state=all` 的显式模式，并在回执里报告 `closed_count`；否则 patrol 会重蹈"全部判不了却显示干净"的覆辙（与本仓 `unavailable` 纪律同构）。
2. **CASRAI Dictionary — DOI tombstone**（[免费来源，替代失效的 Crossref 官方站](https://casrai.org/dictionary/term/doi-tombstone/)，v2026.2，2026-09-14）：tombstone "provides withdrawal information and metadata while ensuring the DOI itself continues to resolve"；"preserves original bibliographic metadata… states clearly the resource has been withdrawn… links to any replacement or successor version"；counter-example 明列 "silent, unannounced content swap at the same URL (no withdrawal notice) is not a tombstone — tombstoning requires the state change to be visible"。
   - **支持**：逻辑删除必须带 ① 原内容保留 ② 状态可见 ③ 理由/证据 ④ successor 链接——逐字对应我们卡的 `state + at + evidence`，并补上 `superseded_by`。
   - **修正**：`void` 与 `superseded` 的差别要在 schema 里显式：`superseded` **必填** `superseded_by`，`void` 必填 `reason`；否则三态塌成两态。

（Crossref 官方 Events Data 文档 `https://www.eventdata.crossref.org/guide/data/events/` 本机 fetch 失败；CASRAI 条目本身引用 Crossref/DataCite 指南，作为免费替代并已注明渠道失效。）

---

## 8. 附：关键文件:行索引

- 卡片：`docs/todo.md:567`（T-#LEDGER-ENGINE）
- 机器消费者：`scripts/patrol.mjs:136,139,150,160-194,196,198-200,224-236`；`scripts/lint-prose-as-structure.mjs:437-442,475-477`
- 非消费者（注释）：`scripts/plan-assertions.mjs:29,117-119`（LEDGER=DESIGN.md）
- CLI/工具注册：`src/presentation/cli/cli.ts:3-18,36,74-97,208-238,297-322`；`src/application/tool_registry.ts:46-66,82-92`；`src/application/observe/index.ts:51-99`；`src/application/tool_annotations.ts:23-70`；`src/presentation/mcp/server_registry.ts:1128-1239`
- 数据块约定：`src/application/plumbing.ts:171,181,184,245-256`；`cli.ts:303-305`
- MCP 棘轮：`scripts/mcp/tool-surface-baseline.json`；`scripts/mcp/tool_surface.mjs:26-27,40-103,109-121`；`scripts/mcp/mcp_scan.mjs:66-80,156-219,254-343,377-412`
- 形态样例：`docs/todo.md:175`（表格）、`:187`（混合）、`:50`+`:246`（散文）、`:500-508`（§H 纪律）、`:571-592`（历史账区）
- 测试夹具：`tests/helpers/i1_fixture.ts:12-68`；`tests/p0_task_write_locked.test.ts:40-51`；`tests/p0_two_phase_claim.test.ts:122-186`；`tests/p1_cascade_root.test.ts:26-31,62-107`；`tests/p0_change_set_view.test.ts:245-260`
- Git 判据：`scripts/gen_manifest.mjs:31,41`；`scripts/gen_cognition.mjs:10-11,201`；`.gitignore:163`
