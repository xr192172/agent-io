# 门

> 只有现状。门/判据变了就**改这张表**：不新开文档、不写"为什么"、不记历史。

## 一、`npm run verify` 的门

> 门数**不写在这里**：`kind:'gate'` 的条数就是门数，唯一出处是 `scripts/verify.mjs#GATES`。

| # | 门 | 查什么 | 跑什么 | 红了怎么办 |
|---|---|---|---|---|
| 1 | ts 类型 | 全仓类型 | 本地 `tsc --noEmit`（不走 npx） | 改类型错。报"typescript 未安装" ⇒ `npm install`；**不许改回 `npx tsc`**（typescript 缺失时 npx 会取 npm 上同名占位包并退 0） |
| 2 | MCP 工具签名 | 全部工具的 handler 守卫（直接 import `TOOL_DEFS` 调 `def.handler({})`，绕过 zod） | `node scripts/mcp/mcp_scan.mjs`（需先有 `dist/`） | 补缺参守卫 / 修 schema；改完重建 dist 再跑 |
| 3 | Go 编译 | `observe-lang-go` 全部包 | `go build ./...`（cwd=`observe-lang-go`） | 改 Go 源码；机器没 `go` ⇒ SKIP |
| 4 | Go 静态检查 | 同上 | `go vet ./...`（cwd=`observe-lang-go`） | 按 vet 报的改；没 `go` ⇒ SKIP |
| 5 | 实现夹具 | `cardStanding` 五个行为分支（`satisfied` / `work` / `violated` / `blocked` / `unknowable`） | `node scripts/impl-fixture.mjs` | 改实现；**不改夹具的期望值** |
| 6 | 设计 DB 结构 | `design-db/*.calls.json` 与 `design/*.dsl.json` 的一致性（只读入库文件，不读 `cache.db`）：`//source` 持有者、`requirements`、`requirements_calls` 的调用方与条数、缺/多副本、真冲突 | `node scripts/gen-db-check.mjs` | 重跑 `design_line action=gen-db` 重生成投影；报 `真冲突`（两 feature 对同一文件互斥）⇒ 改设计，重跑修不好 |
| 7 | 设计册判据 | 全部册的节点判据逐条真跑（同一把尺 `judgeExpectations`）；**`unsupported` 与"读不到册"都算红** | `node scripts/judge-all.mjs`（需先 `npm run build`） | 改实现或改判据；**判不了 ≠ 通过**。★ **dist 比 src 旧 ⇒ 本门直接红、一条判据都不跑**（判在旧代码上的读数没有意义） |
| 8 | 判据突变 | 判据**对代码变异有没有反应**：跨册取 `behavior-cases` 样本 + 一个 `call-exists` 结构对照，在 `src/` 做**一处**语义突变后跑该条判据，再逐字节还原；`survived>0`（判据无感）· `unsupported>0`（判不了）· `killed===0`（没验）**都判红** | `node scripts/mutate.mjs`（需先 `npm run build`；会临时改 `src/` 一处 ⇒ **不许与其它作业并行**，`.agent-io/mutate.lock` 拒并行） | 判据太软（存在类）⇒ 升级成 `behavior-cases` / `call-exists`；改完判据先 `npm run design:gen-db` 再跑 |
| 9 | 文档与事实 | `lint:prose`（散文当结构 / 写死计数）· `gen-facts:check`（FACTS 与 README 数字一致）· `manifest:check`（卷表与 `.agent-io/` 一致）· `cognition:check`（`COGNITION.txt` 最新）—— **四个断言式检查此前都不在任何门里** | `node scripts/docs-facts-check.mjs`（子检查走 `npm run <script>` 的唯一定义；**script 缺失也算红**） | 按报的那一条改：改文档 / 重跑 `gen-facts` / 重跑 `gen-manifest`；**别把数字改成新数字，改成"由命令打印"** |
| 10 | 测试 | `tests/*.test.ts` **逐个文件真跑**（`node:test` + `tsx`，读源码不读 `dist`），按 TAP 计数判红：失败>0 · **0 个用例被执行** · **任何 `skip`/`todo`** · 0 个测试文件；★ 另有**源码下限守卫**（不看 TAP）：该文件**没有** `test()`/`it()` 调用 ⇒ 红（文件在、用例没了），TAP 报的条数**少于**源码声明的条数 ⇒ 红（声明的用例没跑出来） | `node scripts/run-tests.mjs`（默认全跑；`--filter` 只给内环） | 修失败的断言或实现。**不许 `skip`/`todo` 把门关掉**（那会把"有测试没裁判"重演一遍）；断言已过时 ⇒ 按 `docs/RETIRED.md` 口径退役那一条 |
| 11 | 结构意图 | 两档：① **文件级**——每个源文件必须「册上有节点 / 已声明 `excluded`（带 reason）/ 命中 `NOISE_FILE_RE`」，三档都不是即缺口（逐个点名）；② **目录级**——`structure.domains.json` vs 磁盘的待搬 / 待定归属 / 待建域 / 声明与位置打架 / 未标 role / 待迁移。读数带分母：`源码 N · 有节点 M · 已声明排除 K · 已登记豁免 X · 新增缺口 G`。判据**不在这里实现**：文件级 = `design_line.ts#silentGapsOf`（与 `design_line action=report` ⑥ 同一函数），目录级 = `structure_gap.ts#structureGap` + `structureGapIsClean` | verify 跑 `node scripts/structure-gate.mjs --allow-structure-gaps`（**基线棘轮**；需先 `npm run build`） | 逐个裁「纳入册 / 显式 `excluded` 带 reason」；补上一条就从 `scripts/structure-gaps-baseline.json` 删掉那条（脚本会列「已补齐，可删」）。★ 默认口径 = 棘轮：带 reason 的存量**免红但逐数打印**，**新增缺口恒红**；读数里必须出现「已登记豁免 X」，不出现即不算通过。★ 严格模式（M2b 收尾「清零」验收）= `npm run structure:gaps:gate`（脚本里带 `--strict`）⇒ 存量全部计入红。`dist/` 不在 ⇒ 本门自报 2（判不了） |
| 12 | 无卡写账 | `write_log` 三本账对账：`card_id IS NULL` 的行 > 0 即红并**逐条点名**（file + at + actor + source）；历史存量走 `scripts/write-log-baseline.json`（键 = `at|file|kind`）**只许不增**。分母闭合 `无卡 + 有卡 = 总写入` 由脚本自检；读到 5000 行上限截断也判红。★ 已声明边界：只覆盖**过写原语的写**（`source_writer` 五动词 + 回滚通道），`Write`/`Edit`/shell 直写磁盘不在账上 | `node scripts/write-log-audit.mjs --gate`（同一脚本的只读版是 `npm run audit:writes`；对账逻辑只有一份） | 给那一行写补卡，或让它走写原语（过闸就会有 `card_id`）；确属已登记的豁免面 ⇒ 补进基线并写 reason（**不许清零骗绿**）。库不存在 ⇒ 本门自报 2 |

★ 本门表**不抄数字**（门数 / 文件数 / 用例数）：数字由命令自己打印。★ 历史上这里写死过「门数」，而写下的那个数每次都和 `GATES` 对不上（还漏过整整一道门）—— **写死的计数只会撒谎**，要判就 `node scripts/verify.mjs`。

总门三态：

| 退出码 | 含义 |
|---|---|
| 0 | 每道 gate 都真跑过并通过 |
| 1 | 有 FAIL（`kind:'report'` 的 FAIL 也计） |
| 2 | 有 SKIP（缺工具链 / 目录不存在）且无 FAIL |

- 门的计数 = `GATES` 里 `kind:'gate'` 的条数；`kind:'report'` 只在通过时打印正文。
- 加门只改 `scripts/verify.mjs` 的 `GATES`。加之前先答"什么输入会让它红"，答不出就别加。
- **永远绿或永远红的门等于没有门**：先让它能失败，再修它报的东西。
- ts 门用 `process.execPath` + `shell:false`（路径含空格，经 cmd 会被截断）；其余门在 Windows 上 `shell:true`。
- **报账只认总门**：`npm run verify` 才算"跑过"。不许只跑自己挑的几道就说全绿——"没报错"与"没跑"在输出上分不出。
- 实现夹具只钉**行为**（`cardStanding`），不钉 `reason` 文案：文案变异的"存活"是正确信号，不计欠账。

## 二、证（**已整目录退役** 2026-10-31）

`certs/` 这套第三套验证（108 张证）已整体删除，`npm run certs` / `certs:all` 两个 script 一并去掉。

| 现在 | 在哪 |
|---|---|
| 行为断言 | **只住 `tests/*.test.ts`**，由「测试」门（见上表）每轮全跑 |
| 断言红的判据 | TAP 计数（失败>0 / 0 用例 / skip·todo）+ 源码下限守卫（无 `test()`/`it()` 调用 / TAP 少于源码声明条数），口径只在 `scripts/run-tests.mjs` |
| 工具面棘轮 | `scripts/mcp/mcp_scan.mjs`（原 `certs/t326` 的固定开销棘轮已并入） |
| 来龙去脉与代价 | `docs/RETIRED.md`（2026-10-31 两条） |

★ 要加"一个可跑场景"就写在 `tests/` 里 —— **不要再起第三套目录**（同一件事两个住处 = 两份会分叉的真相）。

## 三、判据 11 kind

写在节点 `decision.expectations`，由 `judgeExpectations` 求值；`path` / `from` / `to` 一律仓库相对路径。

| kind | 查什么 | 必填参数 | phase |
|---|---|---|---|
| `file-exists` | 文件在不在 | `path` | post |
| `symbol-exists` | 文件里有没有这个符号（按 AST 判导出） | `path` `symbol` | post |
| `signature-matches` | 符号签名 == 给定签名（比较前压空白） | `path` `symbol` `signature` | post |
| `edge-exists` | **文件级**：`from` 依赖 `to` | `from` `to` | post |
| `edge-absent` | **文件级**：`from` 不许依赖 `to` | `from` `to` | pre |
| `domain-independent` | **域级**：域 `domain` 不许 import 域 `must_not_import[]` 里任何文件（按**域对聚合**，给条数 + 样例边） | `domain` `must_not_import[]`（非空） | pre |
| `call-exists` | `path` 里的 `symbol` 调用了 `target` | `path` `symbol` `target` | post |
| `source-has` | 源码文本必须含 `must[]` / 不许含 `mustNot[]`（只验文本，不懂语义） | `path` + `must[]` 或 `mustNot[]` 至少一个 | post |
| `run` | 给 `input` 跑 `expect` 表达式 | `expect` | post |
| `behavior-cases` | 给 `cases[]`（位置实参，**每个实参可以是任意 JSON 值**）跑函数，逐条比 `expect`（与 `run` 同一执行核） | `path` `symbol` `cases[]`（非空） | post |
| `runtime` | **运行时事件**（L3）：**按框架规则 id 选**（`rule`，如 `design:silent-error-discard`）—— ★ **律由框架提供**（`OBSERVE_RULE_TABLE`），判据只声明"**这条律在本项目生效**"；`probe` 仅作可选过滤（易变名，支持尾部 `*` 前缀）。聚合：`expect=ok` 全 ok / `deviation` **至少一条偏差**（反例用法；全 ok 反而 fail —— 这条判据没在测东西）/ `absent` 一条都不许出现。★ 零配置找 `<root>/.agent/observe/events*.jsonl`；无文件 / 空文件 / **该规则没出现** ⇒ `unsupported` | `rule` 或 `probe` 至少一个（`atLeastOneOf`）+ 可选 `expect` `events` | post |

- 每条都要 `why`（非空），否则写入被拒。
- `run` 专属字段：`input` / `input_ref` / `blocked_by`（有值 ⇒ 判 `pending`，不跑 `expect`）/ `mutants_ignore[]`（不参与突变的 input 字段）。`expect` 的求值域只有 `input` / `root` / `validateDSL` / `fs` / `path`，**没有 `import`** ⇒ 调不到项目模块，只能断言 `validateDSL` 或文件文本。要真跑被测函数得加 `target{module,fn}` + `cases[]`（未做，见 `INDEX.md` §四）。
- `run` 只许读 + 判，不许副作用（写盘 / 改状态）。
- ★ `cases[].given` 是 **JSON 值数组**（字符串 / 数字 / 布尔 / null / 对象 / 数组）：schema 侧只声明 `array`、**不写 `items`**；harness 把 `cases` 内联成 JSON 字面量再 `fn(...args)` ⇒ **函数收到的是真值，不 parse**（字符串实参照旧仍是字符串，不做 `JSON.parse`）。
  代价如实说：`undefined / NaN / Infinity / 函数 / BigInt / Date / Map / Set` **写不进来**（`[undefined]` 会变 `[null]`；要传 `undefined` 只能 `given:[]` 省略实参）。⇒ 新生判据**直喂对象**，别再写"判据专用桥"（`gate_error.ts` 的 `gateErrorCodesFromJson` / `carriedCodesFromJson` 是 D4 之前的临时通道，留待退役卡）。
- ★ `expect` 比的是 harness 的**规范化 repr**：先精确相等；对不上时**容器（对象 / 数组）只许精确 repr 相等**（标量才走裸串口径）。
  为什么：旧兜底走 `String(JSON.parse(ret))`，对容器退化成 `"[object Object]"` / `"1,2"` ⇒ `expect:"[object Object]"` 对**任意**对象数组输出都 PASS（2026-10-30 实测后已堵）。
- `signature-matches` 比的是「设计侧存的签名（意图）」与「源码签名（事实）」。设计 DSL 该存签名，不该存从源码抽出来的结构化契约（派生量，会不同步）。
- ★ **静态管形状，运行管"真发生"**：`source-has` / AST 类判据能查"catch 块是空的"；
  `runtime` 查"**错误真的发生且被吞**"。两者互补、**不重复实现**：前者便宜但可能有误报，后者贵但只在真跑时成立。
- ★ `runtime` 的主体是**事件流**（探针写出的 `events*.jsonl`），不是源文件；它对应自动化测试框架的 **L3 层**
  （L1 静态 7 种 · L2 `behavior-cases` 同进程跑函数 · **L3 运行时**：真链路 / 静默吞错 / 重试）。
  ★ 判不了的三态（无文件 / 空文件 / 无该 rule 或 probe）**都不算通过** —— 最容易被读成"没问题"的正是"没跑到"。
- ★ **L3 要先"采一轮"才有料**：事件是**派生物**（`<project>/.agent/observe/`，`.gitignore` 已排除）⇒
  新 clone / CI 上必然 `unsupported`。入口：`npm run observe:collect -- <你要跑的命令>`
  —— 用 loader 起子进程、事件落进项目、**退出码原样透传**（它是"跑测试"的入口，不把失败吞成成功）；
  `AGENT_IO_PROBE_OFF=1` 时退化为直接运行。★ `unsupported` 详情里会提示这一步：**判不了 ≠ 通过，但也不该是死局**。
- ★ `domain-independent` 的主体是**域 id**（`structure.domains.json` 的 `id`，不是层级名、不是路径）：
  域表缺失 / 域 id 不认识 / 索引不可用 ⇒ 判 `unsupported`（**判不了 ≠ 合格**）。它存在的理由：
  本仓有 167 个域对 / 1507 条跨域 import 边，**逐文件枚举不现实**；而分割 / 合并 / 废弃 / 删除的
  必要条件（入度=0 / 双向密度 / 红条数单调下降）都只能在**域级**算。
- `edge-exists` / `edge-absent` 的 `from` / `to` 是**文件路径**（来自 `cache.db` 的 import 依赖）；DSL `edges[].from/to` 是**节点 id**。同名不同义。
- 求值结论四态：`pass` / `fail` / `unsupported`（判不了，单列，不算过也不算不过）/ `pending`。
- 卡的结论五态（`cardStanding`）：`work` / `violated` / `blocked` / `satisfied` / `unknowable`，由 `RED_DISPOSITION` 派生。
- 两道闸方向相反、用同一把尺：`claim` 只认 `work` / `violated`（有活干）；`complete` 只认 `satisfied`（干完了）。
- 只有 `post` 参与"是否已满足"；`pre`（`edge-absent`）在未施工时天然成立，拿它判满足会恒真。
- 依赖事实只为 TS/JS 相对导入生成 ⇒ 其余语言的 `edge-*` 走 `unsupported`。

## 四、写门的硬规矩

### 4.1 三条纪律

1. **只跑真证据**：import 编译产物、真调函数、内省运行时对象；不读源码猜形状。
2. **未实施的级标 `unenforced`**，过门时打印出来；不许计作通过。
3. **两个方向都自证**：坏输入被挡在**正确的级与正确的检查项**上；好输入必须放行。

### 4.2 三种"证明它会红"

| 问法 | 证明什么 |
|---|---|
| 两方向 | 门能**区分**好坏 |
| 消融：逐个撤掉修复 ⇒ 对应断言必须变红 | 门测的**就是那个修复** |
| 出生证：旧逻辑跑这份输入必须坏 | 这份输入**真的会坏** |

- 消融不红 = 假绿。**修完 bug 先问"撤掉它会红吗"，答不出来就还没修完。**
- 出生证要**回读确认注入落盘**；变异体必须就是那个要防的形状。
- 变异体只许两态：**杀死 / 存活**。"编译不过" = 程序起不来 = 被检出 = **杀死**；单列 `broken` 等于把它放过了。

### 4.3 读数只许落四态

| 态 | 含义 | 对调用方 |
|---|---|---|
| `0` / 空 | 量到了，结果是零 | 正常通过 |
| `N/A` | 没有输入可量（空目录、路径打错） | 非 0 退出或显式 N/A，**不许当满分** |
| `unknown` | 有输入但证据拿不到 | 表现像 fatal（fail closed） |
| `pending` | 还不到判的时候（`blocked_by` 有值） | 不计 failed 也不计 passed，写清卡在哪 |

### 4.4 假信号三档

| 档 | 症状 | 坐标 |
|---|---|---|
| ① 假绿 / 空过 | 没跑、或退化成空转，显示成通过 | 无（最坏） |
| ② 无门 | 压根没有，或只管一小块 | 无 |
| ③ 假红 | 判据写错，拦住合法输入 | 有 |

- 单次可定位的假红优于无门；**误报多到操作者不再看这个门，它就退化成 ①**（实测：用"文件 + 1 跳 imports"当冲突判据，89 张卡里 23.3% 的对子互相拒领 —— 那不是管得严，是把并行关掉了）。
- **闸判了、读数被丢 = 第 ① 档的变体，比空过更阴**：它真跑了、真判了，只是回执里没有它（症状：`assertX()` 的返回值没人接）。⇒ **闸的读数必须有一条路能到调用方**。
  - ★ **这条洞已接上（2026-10-30，卡 `err-channel`）**：`src/application/plumbing.ts` 的 `wrap` / `wrapData` 两处 catch
    只在 `gateErrorsOf(e)`（`src/domain/gate_error.ts`，零依赖纯函数）**非空**时，才在 `text` 末尾追加 `---DATA---`
    与一行 `{"errors":[…]}` —— `parseDataBlock(text).errors` 即可机器读码；`GateError` 与鸭子类型 `{data:{errors}}` 都认，
    **普通 `Error` ⇒ 取不到码 ⇒ 回执逐字不变**（连空的 `errors` 字段都不加）。
  - ★ **码只加不改**：`E-*` 码发布后**不许改语义、不许复用号**，只许在族尾追加（机器源 = `src/domain/gate_error.ts#GATE_RULES`，见 §七）。
- 假红两条出口：✅ 修判据；❌ 改被检对象去迎合（放宽阈值 / 加豁免 / 删字段）。
- **先证明判据错了，再动判据；绝不动被检对象。**
- 第 ① 档统一自检句：**"如果这件事坏了，这个读数会变成什么？"** 答不出一个必然不同的读数，就还在 ①。
- **判据写弱 = 恒真**：`must` 串在目标文件里到处都是（`'diff'` 这种词在注释、别的工具名里都有）⇒ 只有"做了才会出现"的标识符才算判据（钉函数名，不钉变量名）。
- **充分条件当必要条件**会挡合法输入：T20 用"库里有这个文件"证明"有依据"，只对改已有文件成立；新建的依据是**期望**（同批 `file-exists`）。

### 4.5 严重度

- `ERROR` ⇒ 非 0；`WARN` ⇒ 退 0，但大声打印 + 计数。
- 每条指名"哪个对象、哪一步"，不出总分。
- 全称成立的断言（通配边、`≥0`、`> 0`）必要但不充分，从判决里移除。

### 4.6 覆盖面

- **扫描面 = 管辖面**。症状：读数恒 0 或恒为某整数。"我声称管的集合"与"实际遍历到的集合"必须相同且能打印。
- **派生物也要有门**：源干净 ≠ 用户碰的那份干净。指纹重算 + 逐字节比对，三态 `PASS/FAIL/SKIP`。
- 门不能把自己数进去；排除用单独常量，不塞进豁免名单。
- **判据 / 规格 / 答案清单不许放进被测对象的读写范围。**
- 文本判据必带作用域（文件？路径参数？读还是写？）；先剥注释；能读结构化字段就不读散文。
- **还原要还原被影响的范围**：变异器还原源文件后必须重编译——`dist` 里会留着最后一个变异体，否则后续测试都在跑被污染的产物。

### 4.7 门的输入

豁免名单、基线快照、allowlist、frozen 计数 = 门的输入，**必须"断言 + 每次复算"**：每条带证据字段（如 `importedBy`）+ `why`。

- 三检查：存在性 / 覆盖性（能被自动判据覆盖的不许留）/ 必要性（"无人使用"由扫描给出 ⇒ 删）。
- 配棘轮：只许减，基线写常量，新增即红。
- 能由判据取代的整表删掉；别为"记欠账"再建一个门。
- 门里不硬编码路径；搬迁前全仓 grep（含 `scripts/`、`.githooks/`、`docs/`）。

### 4.8 先问能不能不写门

顺序：**编译器 / 类型系统** → **现成工具**（ESLint `no-restricted-imports`、dependency-cruiser、knip、Nx boundaries、`eslint-plugin-boundaries`）→ 自写。

自写只留给编译器与工具查不了的：文本重复、图的**无环**、**运行期行为**（方向 / 反饱和 / 双向自证）。

### 4.9 判据能自动到哪一层

| 层 | 能自动判吗 | 谁在判 |
|---|---|---|
| 事实在不在（文件 / 符号 / 边） | 能，接近 100% | 文件系统 / AST |
| 判据有没有被写死 | 能 | `design:mutate`（存活 = 假绿） |
| 判据选的「尺」对不对 | **不能** | 只有意图（人 / LLM） |
| 判据实现对不对 | 部分 | 夹具 + 局部变异（逐个补，不是一次点亮） |

- **「等价」有几把尺，选错了就是形式正确、语义错误**：字符串等价 ≠ 身份等价（`workbuddy` 与 `agent:workbuddy` 是同一个人；逐字比会把"自己的卡"判成"别人的活"，把自己的文件锁死）。
- **有一类东西永远算不准，别把近似叫准确**：影响面 / 传递闭包（等价于判"两个程序行为是否一致"，不可判定）；而**读集比对可精确判**（比 hash 就行）。**选能判的那个，不选"看起来更有用"的那个。**

程序判事实、数次数、跑突变；LLM 选尺、复核、宣布完成。**全程可以没有"人"，但每一步都要有主体——责任链没有断点。**

### 4.4 重写计划闸（画布）：**默认开**

写源码前必须先有"画布"（`plan/<rel>.plan.json`）：**这一轮要改哪些符号、改成什么样、拿什么验、顺序如何**。

| 档 | 触发 | 行为 |
|---|---|---|
| **严格（默认）** | `AGENT_IO_REQUIRE_PLAN` **不设**（或 `1`） | 没够格的计划 / 画布过期 ⇒ **拒绝落盘**，错误里给"怎么办" |
| 只报 | `AGENT_IO_REQUIRE_PLAN=0`（`off` / `false` 同） | 只点名，不拦 —— **测试与批量迁移用它** |

**四条判据**（唯一实现 `design/db/rewrite_plan.ts`，全部**必要条件**）：

| 判据 | 问什么 | 不懂会怎样 |
|---|---|---|
| `planGaps` | 每条的锚点 / 细节 / 判据引用都在、锚点没过期 | 计划写不下来的细节 = 还没想清楚 |
| `planCoverageGaps` | 文件里每个顶层符号**二选一表态**（进 `entries` 要改 / 进 `untouched` 不动+理由） | 只列 1 个符号改 1 个符号也"合规" ⇒ 全貌仍靠自觉 |
| `planJudgementGaps` | 判据**强不强**（语义类能发现逻辑错；`file-exists`/`source-has` 永远发现不了） | 拿存在性判据当"验过了" |
| `planDependencyGaps` | 依赖指向存在、不自依赖、不成环、**顺序没被违反** | 顺序错 = 赌编译 |

**出口闭环**（`checkRewriteExit`，回执一行，只在异常时出声）：
`realized` / `not_yet` / `stale_anchor` / `unjudgeable` + 计划外符号 + 待跑的判据引用。
→ 只读模式下 `design_line action=plan` 会按闭环**自动推进**状态（`open→done`，只前进不倒退），
坍缩集随之收缩，并发闸自动放开。

**画布过期**（`base.content_hash` 变了）：严格档（**默认开**；`AGENT_IO_REQUIRE_PLAN=0|off|false` 才降为"只点名"）下**拒写** —— 不再有"默认档点名"这回事 ——
"对着旧内容写的计划"是覆盖率最高的那种错。

**★ 四条全绿 ≠ 正确**：哈希只说明"变了"，判据种类只说明"有可能发现"。这套闸管的是**流程完整性**，不是正确性证明。

## 五、门报绿但你不信：八步

| # | 动作 |
|---|---|
| 1 | 从磁盘复现：拿证据文件 `mtime`、门宣布成功的时刻、进程 exit 码。**`mtime > 门报成功的时刻` ⇒ 门读太早** |
| 2 | 数"这条判据历史上为真过几次"。长期 0 次 = 死代码，不是"没出事" |
| 3 | 把整段产物喂给现有匹配器：**现在能命中 ⇒ 问题是时序，不是判据** |
| 4 | 枚举失败路径上的所有闸：跳过等待的"快路径"就是零观测窗 |
| 5 | 修法 = 有界等待（观测延迟 × 1.75）+ 正向证据 + 三态（`unknown` 对调用方像 fatal）+ 确定性 `exitCode` |
| 6 | 正向信号要有判别力：好运行都含它，坏的运行缺它 |
| 7 | 出生证 + 真产物两态跑（检查时刻原样 / 完整）；反方向也要测（健康段仍须 healthy） |
| 8 | 旧结论是假修复 ⇒ 加一节"假修复 vs 真修复"并标记旧结论，不悄悄改 |

## 六、核验别人交的活

它的结论是**待验假设**。两个方向都防：不轻信指控（可能假红），不轻信"已完成"（可能假绿）。

| # | 查什么 | 怎么查 |
|---|---|---|
| 1 | 关键数字 | 换**另一种独立方法**重算（分段 ↔ 行级 diff；前后缀 ↔ hunk 计数），两种一致才算坐实 |
| 2 | 方向 vs 量级 | 分开判：接受方向、改数字 |
| 3 | 签名完整性 | 证据文件真在盘上？按它给的规则复算一遍 |
| 4 | 取代型改造 | 回归差集（见下） |
| 5 | 夹具形状 | 同一语义换成真实工程形状再跑 |
| 6 | 它没做什么 | "试了不通"与"没试"必须分栏 |
| 7 | 改动范围 | `git status` / `diff --stat`：顺手改了别处吗？临时脚本留在仓里了吗？ |
| 8 | 同族漏网 | 它修的是"这一类"，自己扫一遍同类 |

**回归差集**（触发：A 换 B / N 份收 1 份 / 删旧实现 / 大搬迁）：旧能新不能 = 回归，新能旧不能 = 新增能力。报"只差第 N 条"以及那一条的性质，**只报总数相同不算证明**。两侧各自现算索引（独立 `AGENT_IO_HOME`），不共用缓存。

**诚实清单 C0 五栏**（机械判据：`scripts/check-receipt.mjs`，缺栏 `exit 1` 并点名）：

| 栏 | 写什么 |
|---|---|
| 做了什么 | 文件 + 动作，能对上 `git diff` |
| 判据读数 | 命令 + **原样输出**，不是"通过了" |
| `[未核]` | 显式列没验证的，并区分"没试" / "试了不通" |
| 行为改变 | 对外可见的变化（契约 / 接口 / 产物） |
| 滞涩报告 | 卡在哪、原样报错 |

核验方回来自己也要写：**各读了多少**（行数 / 是否通读）· 合并了哪几处重复 · 哪里两份冲突按谁写 · 删了什么 · 最终行数。

## 七、闸门规则登记表（错误码 `E-*`）

**机器源 = `src/domain/gate_error.ts#GATE_RULES`**（唯一事实源；零 import，可被判据直接跑）。本表**只登记"族 + 码数"**：
逐条的 `what`（触发条件）/ `why`（为什么要有它）/ `fix`（怎么过）/ `doc` / `where`（实现位置）**只**住 `GATE_RULES` ——
在这里再抄一份 = 第二份事实，必漂。

**怎么用**

| 你要干什么 | 用什么 |
|---|---|
| 被闸拒绝了：这个码什么意思、怎么过 | `gateRuleOf('<code>')` ⇒ `{what, why, fix, doc, where}`（拒绝文案里已经带 code） |
| 开工前一次读完**全部**规矩 | 读本文件 §七（按族分组的全表）+ `src/domain/gate_error.ts#GATE_RULES`（机器源，含 `family` / `what` / `fix` / `doc` / `where`） |
| 按族过滤 / 认族语义 | 每条 `GateRule` 带 `family`；族标签唯一住 `GATE_FAMILY_LABEL` |

★ **`design_line action=rules` 已于 2026-11-02 删除**：它读的是 `GATE_RULES` = **框架自述**，不是项目的事实 ⇒ 占了工具位却不服务项目（详见 `docs/RETIRED.md` 2026-11-02 那条）。码表的机器源仍是 `GATE_RULES`，人读表就是本文件 §七。

**码的稳定性约定（发布即冻结）**

- 码一旦发布 ⇒ **不许改语义、不许复用号**：`E-PLAN-001` 永远指"该文件没有画布"，不会改指别的事；
- 只许 ① **新增码**（追加到族尾，号只增不复用）② **在 `fix` 里追加说明**（不动 `what`）；
- 退役一个码 ⇒ 写 `docs/RETIRED.md`（码 + 现在用什么），**不许**把号让给别人；
- 为什么这么严：码会出现在回执、文档、别人的记忆里 —— 改语义 = 让历史上读到的同一个码指向另一件事。

| 族 | 管什么 | 码数 |
|---|---|---|
| `E-PLAN` | 画布 / 重写计划 | 23 |
| `E-TASK` | 任务闸：A7 身份 / authorize / 前置 | 8 |
| `E-CLAIM` | claim / start / publish / 状态迁移 | 18 |
| `E-CRIT` | 卡站位 / 建构完整 / 可收口 | 6 |
| `E-EVD` | 收口证据 / 重开账本 | 5 |
| `E-WRITE` | 落盘（语法门 / 根外 / 租约代际） | 4 |
| `E-REASON` | reason L1–L4 + 现取事实 | 6 |
| `E-GENDB` | 设计 DB 重生成 | 2 |
| **合计** | 8 族 | **码数合计 72** |

**散文 → 码的反查（过渡方案，2026-10-30）**

- 线上拒绝还都是 `throw new Error(散文)`（60 多个抛点、一处未改）⇒ `plumbing.ts` 的 `wrap` / `wrapData` 两处 catch
  按 **`gateErrorsOf(e)` → 为空回落 `gateRuleByMessage(e.message)` → 再为空才逐字回旧行为** 取码；
- 反查口径（`gate_error.ts#gateRuleByMessage`）：消息**归一化**（去首尾空白 + 连续空白压成一个空格）后与
  `where.messageStartsWith` 比**前缀**；**最长前缀优先**；**最长前缀并列 ≥2 条 ⇒ `undefined`（歧义不猜，宁可不带码也不带错码）**；
  没有 `messageStartsWith` 的码**不参与**反查；
- 抛点改造（`throw new GateError([...])`）是**后续卡**，反查是**过渡方案**，两者**可以并存**：改造成 `GateError` 的优先走
  `GateError`，反查只兜底 —— 改造一处就少一处靠散文猜的地方。

**覆盖率的实况（2026-10-30 第二张卡 · `subagent:code-coverage`）**

反查**不是全表可用**：`gateRuleByMessage` 只认写了 `where.messageStartsWith` 的码，而"能不能写前缀"取决于**真实文案开头有没有固定字面量**。

| 读数 | 数 | 含义 |
|---|---|---|
| 表里带 `messageStartsWith` 的码 | **49 / 70** | 只有它们参与反查（没写前缀的码被 `gateRuleByMessage` 直接跳过） |
| 其中前缀**两两互不相同**（自洽） | 49 / 49 | 同长并列 ≥2 条 ⇒ 恒 `undefined`；本卡把 `E-CLAIM-012 / 013` 那对完全相同的前缀**摘掉**了（并列永远是 undefined，留着只让计数虚高） |
| 结构性接不上（没有固定开头 ⇒ 不写前缀） | 21 / 70 | 逐条原因见下面三段；**不是"还没补"**，是原文里没有能占住消息开头的固定字面量 |

逐条为什么接不上（三段，别当成待办）：

1. **计划闸的内层 gap 码 13 条**（`E-PLAN-003/004/005/006/011/012/013/014/015/016/017/019/020`）：
   它们的文案是 `rewrite_plan.ts#plan*Gaps` 返回的**一行 gap**，开头是可变的 `who`（`rewrite:` / `create:` / `delete:` + 符号名），
   且整段永远排在 `拒绝落盘（重写计划闸）：` 表头之后 ⇒ 没有固定字面量能占住消息开头。
   ⇒ 真实拒绝由**外层码 `E-PLAN-023`** 接住（2026-10-30 新增），明细看回执里的「· <rel> 没有够格的重写计划（N 处）」段；
   要让单条 gap 自带码，只能改抛点（`throw new GateError([...])`，另卡）。
2. **开头是可变变量 5 条**：`E-TASK-006`（它是拼进别的拒绝里的一段 `★ 本次带了 authorize=…`，从不在开头）·
   `E-CLAIM-008`（`${action} 被拒：state=…`，action 有 8 个取值）·
   `E-CLAIM-012 / E-CLAIM-013`（`publish 被拒：节点 "<id>" 上…`，两支的分叉落在**变量节点 id 之后**）·
   `E-CRIT-002`（`expectations[<可变下标>].why 必填`）。
   ★ 同类但已解决的三处：`E-CRIT-001` 取 `assertValidExpectations` 的「expectations 必须是数组」这一支（只覆盖这一支，其余分支以可变下标开头）；
   `E-REASON-001 / 002 / 003 / 004` 全部改用**外层层号** `变更原因校验未通过（L1|L2|L3|L4）：` —— 这四条的内层句（`原因过短…` / `原因 "<reason>" 命中套话黑名单` / `原因未绑定具体实体…` / `提供了 evidence 但…`）都排在
   `变更原因校验未通过（L${v.layer}）：${v.error}` 这个表头之后 ⇒ 拿内层句当前缀**端到端恒不命中**（旧表就是这么写的，本卡改掉）。
3. **不是"一句拒绝" 3 条**：`E-WRITE-002`（不抛错，回 `ok:false` + `blocked[]` 结构化回执）·
   `E-WRITE-003`（抛点是**批级聚合** `apply_refactor_plan（targets 形态）：N/M 项无法规划 …`，同一条抛点还含「缺 file / 文件不存在 / 语法错」⇒ 给它前缀会把别的错也染成它）·
   `E-REASON-006`（与 `E-REASON-005` 是**同一句** `改 semantic.files 前必须…`，原文没有分叉）。

**★ 端到端还差一层：`edit_dsl` 的 op 包装（2026-10-30 实测；其中路① 已落地，见本段末）**

上面 45 条回答的是「**文案 → 码**能不能对上」；「**回执里真的看得到码**」还要求那段文案原封不动地到达 `wrap` / `wrapData` 的 catch。
实测（本卡 7 次真拒绝）：`edit_dsl` 的 op 失败会被**统一包装**成
`操作 i/N 失败，已回滚全部 K 个已应用变更` + `失败原因: <原文>`（`update_feature.ts` 的 op 循环 catch）
⇒ **在 op 里抛的码**（`E-CLAIM-*` / `E-CRIT-*` / `E-EVD-*` 这一大类）端到端**取不到码**（`parseDataBlock` 连 DATA 段都没有），
哪怕前缀写得对：本卡的 `E-CLAIM-007 / 011 / 014`、`E-CRIT-001` 就是「前缀正确、被包装层挡住」。
能直接取到码的是**不在 op 循环里抛**的那些：写闸（`E-TASK-*` / `E-PLAN-021` / `E-PLAN-023`）、`edit_dsl` 处理器层的 reason 校验（`E-REASON-*`）、
`edit_code`（`E-WRITE-001`）、`design_line`（`E-PLAN-022`）等 —— 本卡用 `parseDataBlock(text).errors[0].code` 实测 **6 条真拒绝**：`E-TASK-001`（src/domain/text_strip.ts 无卡）·
`E-TASK-004`（authorize=allz）· `E-TASK-005`（authorize=all）· `E-REASON-002`（reason 写成套话）· `E-REASON-004`（evidence 指向不存在的节点）· `E-PLAN-023`（docs/PITFALLS.md 没有画布）。
⇒ 要让 op 内的码上回执，只有两条路：① 包装层别再吃掉码（透传，`update_feature.ts` 的 op 循环 catch）② 抛点改 `throw new GateError([...])`。

**★ 路① 已落地（2026-10-30 · `subagent:op-passthrough`）：`edit_dsl` 的 op 级拒绝也带码（包装层透传），内层码见 `data.errors[].code`。**

op 循环的 catch 改成 `throw withGateCodes(外层两句文案, e)`（`src/domain/gate_error.ts#withGateCodes`）：外层两句文案（`操作 i/N 失败，已回滚全部 K 个已应用变更` / `失败原因: <内层原文>`）**逐字不变**，只把内层码带出去 —— 取码顺序 `gateErrorsOf(e)` → 空则 `gateRuleByMessage` 反查**内层**散文 → 仍空才退回旧的"不带码"行为（宁可没码也不带错码）。实测两次真拒绝（改前两条都**没有** `---DATA---` 段）：`start 被拒…` ⇒ `E-CLAIM-010`、`expectations 必须是数组…` ⇒ `E-CRIT-001`。路②（把每个抛点逐个改成 `GateError`）仍属另卡。

★ 两条 `run` 判据钉住上面两件事：前缀**两两互不相同**（自洽 ⇒ 每条都回自己）· 带前缀的码 **≥ 45**（覆盖率棘轮，删一条就红）。

> 逐条内容只在 `GATE_RULES`；本表的数字由判据 `run` 钉住（文档声明数 == 表里真实码数）——
> **改码表必须同时改这里**，否则 `design_line action=judge` 当场红。

## ★ 已声明边界：dist 新鲜度凭证**防事故、不防恶意**

`dist/.build-manifest.json` 是「dist 已按当前 src 重建」的凭证，消费者是 `checkStaleBuild`（`mcp_scan` ④ 与 `judge-all` 共用同一把尺）。

**它挡得住什么**：改完 src 忘了 build（事故）—— 这是它存在的全部理由。

**它挡不住什么**（2026-10-31 第十三轮复核实测，如实记在这里，不假装）：

1. `writeBuildManifest` 是 `stale_check.ts` 的**导出函数** ⇒ 一条 `node -e` 就能按当前 src 重算清单，让旧 dist "看起来已重建"；
2. 守卫判据里用了 **mtime**（源比产物旧 = tsc 没重跑）⇒ 改内容 + 把源 mtime 倒拨即可绕过。

**为什么不继续加护栏**：本地仓里任何检查都能被**有 shell 的人**伪造 —— 这不是实现缺陷，是"本地凭证"这个概念的上限。
继续加就是 0.9 说的"给护栏再加护栏"（A 加护栏 → 给护栏再加护栏 → …）。

**真正的分界线**：伪造**是否需要改受跟踪的源码**。
`mcp_scan --update` 之所以算"有意识动作"，是因为基线 JSON 进 git ⇒ **改它会出现在评审 diff 里**。
`dist/` 被 gitignore ⇒ 清单改写**没有 diff** ⇒ 这一层可见性缺失是已知的、接受的代价。

**若将来要真防**：把凭证搬到**受跟踪**的位置（清单进 git，每次 build 产生一次 diff），而不是继续在 dist 里加固。
本仓当前**不做**这件事，理由：会让每次构建都产生 git 噪音，代价大于收益。

## ★ 退出码契约：`0 / 1 / 2` 三态（不是二态）

**判据闸（`scripts/judge-all.mjs`）与任何"能判"的门，都必须把「判红了」和「压根没判」分开** —— 这是 0.12 的直接推论：

| 退出码 | 含义 | 下游该怎么处理 |
|---|---|---|
| **0** | 全部册都判过，且 0 红 | 通过 |
| **1** | **判出了红**：某册有 `fail` / `unsupported` / 该册 0 条 / 根不重合 | 去看哪一条红了 |
| **2** | **压根没判**：找不到 `dist` · `dist` 比 src 旧 · 新鲜度没验全 · 找不到册 · 总计 0 条 | **不许当"通过"，也不许当"判红"** —— 先修前提 |

▲ 为什么必须三态：实测过两种死法 ——
① `AGENT_IO_HOME` 指到别的数据根 ⇒ CLI 看到 0 个 feature ⇒ 0 条判据 ⇒ 若只按 `fail>0` 判就会 **exit 0（假绿）**；
② 判据被人删空 ⇒ 同样 0 条。
两种都是"没验"，而二态退出码会让它们和"通过"长得一样。

★ **写新门时的自查**：你这个门的非零退出码，是在说「判出了问题」还是在说「我没跑起来」？
两者混用一个码 ⇒ 下游不可能分开处理，迟早把"没跑"当"通过"。

★ **本仓现状（可复核）**：判据闸在 CI **独立**跑 —— `.github/workflows/judge-gate.yml`（名「判据闸（设计册断言）」）
直接调 `node scripts/judge-all.mjs`，**不经过** `verify` ⇒ 可单独触发（`workflow_dispatch`），读数落 artifact（`judge-report.txt`）。
它用一段 shell 把三态**显式分开**：`0` ⇒ `::notice::` 放行 · `2` ⇒ `exit 2` 并点名「压根没判，先修前提」·
`1` ⇒ `exit 1` 点名「判出红」 · 其它 rc ⇒ 同样 `exit 2`（「没跑起来」≠「判红」）。
取码方式是**先重定向再 `cat`**，不用 `| tee` 的 `PIPESTATUS`：后者会被中间命令重置（实测真值 `2` 能读成 `0` ⇒ 把「没判」报成「通过」）。
★ 门数与判据条数一律以它自己的输出为准 —— 本节**不写死**。
