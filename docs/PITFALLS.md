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
| **P16** | `source-has` 当**画布** `judgement_ref` 也是硬拦 | `design_line action=plan` 报 E-PLAN-023「判据 `source-has` 是**存在/结构类**，**永远发现不了逻辑错**」 | 换语义类（`behavior-cases` / `call-exists` / `run` / `edge-absent`），或让 `tests/p0_*.test.ts` 承载 | `db/rewrite_plan.ts#planJudgementGaps` |
| **P17** | 写闸的放行支 `basis=files-not-in-design` —— **放行 ≠ 没事** | 文件不在任何 covering feature 里 ⇒ 闸放行，但**记一笔 `card_id=NULL`** ⇒ 「无卡写账」门（`max_no_card`）之后会红 | 要么把该文件补进册的 `excluded`（`edit_dsl {type:'excluded',op:'update'}`，整份替换），要么接受这笔并记录。★ **绝不许抬 `max_no_card` 基线** | `write_gate.ts` · `domain/task_gate_basis.ts:64/104-107` |
| **P18** | 判据**视野与白名单同源** ⇒ 恒绿（假绿） | 判据只扫 `src+tests+scripts` 而白名单恰好也只在这三棵树里 ⇒ **两边同源，等式恒成立** | 判据必须**自证扫描面**（每个根目录都真的贡献了文件）＋**针自校验**（白名单那几行就是正控：针打错一个字 ⇒ 命中 0 ⇒ 红） | 2026-11-06 实测 `p0_ast_parser_retired` ④ |
| **P19** | 拿"旁边那个看起来像检查的东西"当验收，而它**不解析你改的那一格** | `structure.domains.json` 的 `note` 改了，`structure:gap` 能绿 —— 但它**不解析 `note` 散文**（`structure_gap.ts:99` 原文：「读这里，**不解析 `note` 散文**」）⇒ **绿不证明改对** | 改散文类字段，验收方式必须是**读回那份文件断言字样**，不是跑一个"管这目录"的检查 | `analysis/structure/structure_gap.ts:52/99/194` |
| **P20** | 把**带日期的测量流水**"改指"成新对象 = **伪造记录** | 旧断言指向的东西已经不存在了，看起来"改成指新的就好" —— 但那条记录带着日期，改指就把它写成了今天的样子 | 保留日期 + 标「★ 已过时：因为 X，现为 Y」；**不要重指**。要新结论就**新写一条** | 2026-11-06 `docs/todo.md:313/354` |
| **P21** | `task.release` 的 `reason` 要放 **`data`** 里，不是顶层 | 报「`task.release` 需要 `reason`」（顶层给了也不行） | 同 `decision.update` 要 `data.summary`、`complete` 要 `data.evidence` —— **一律看 `OP_SPECS`，别猜在哪一层** | `dsl_ops/op_data_spec.ts` |
| **P22** | **新文件必须先入册再写**，否则记一笔**不可回滚**的 `card_id=NULL` | 「无卡写账」门红，且**事后再补登记也不变绿**（重贴窗口已关、append-only 台账不许改） | **先 `file.add` / `node.add` 登记 → 再写文件**。★ 反直觉（"还没写，怎知道登记什么"），所以门该报「先登记再写」而不是事后记账 | `write_log` · `domain/task_gate_basis.ts` |
| **P23** | ★★ **词表法分不清"禁止这个能力"与"提到这个词"** | 想禁"判据自己写盘" ⇒ 按裸词 `fs.writeFileSync` 拒 ⇒ **误伤**那条 `s.includes('fs.writeFileSync(...)')`（它断的是**别人文件里的字**） | 换**结构法**：注入的 `fs` 改成**只读白名单**，写能力**结构上不存在**（`fs['write'+'FileSync']` 也绕不过）。**"能力不存在" > "词不出现"** | 2026-11-06 `judge_facts.ts#READ_ONLY_FS` |
| **P24** | **`npm run verify` 不跑 `npm run build`** | 只跑 verify ⇒「MCP 工具签名」「设计册判据」报「dist 比 src 旧 ⇒ **一条判据都没跑**」 | **先 `npm run build`** 再 verify。★ `readDesignSheet` / judge 都吃 `dist/` | 2026-11-06 实测 |
| **P25** | 判据**不该有副作用**：判一下就把项目库建出来并锁住临时目录 | `getProjectCacheDb` 给无索引项目**造库** ⇒ 并发下 `EBUSY … cache.db` | 门面 `db` 可 `null` + `projectCacheDbPath(root)` **预检 `existsSync`**。判据只读，不建库 | `judge_facts.ts` · `index/db.ts:129-131` |
| **P26** | ★★ **`decision.update` 的 `expectations` 是"整块替换" —— 没列进去的旧判据静默就没了** | 用 `decision.update` 顺手改一处判据（哪怕只是修个错别字），整条数组被换掉 ⇒ 别的判据**无声消失**，此后 `judge-all` 条数变少、`claim` 读集变小，**没有任何东西说话**（2026-11-06 实测：子代理只能 `git show HEAD` 逐字还原才补回来） | **① 只想删/改一条 ⇒ 用元素级 `op:'expectation.remove'`**（点名 index / symbol，删除动作本身就是声明）；**② 真要整块重写 ⇒ 带 `data.drop_ok` 逐条枚举**被丢掉的判据主体键（如 `behavior-cases:src/a.ts#foo`；集合必须**恰好相等**，**多报也拒**）；③ 被拒时照报文里那段直接粘。★ 硬档只有两档：**清零**（上一版 ≥1 → 本次 0）与**净缩**（`cases` / `must\|mustNot` / `must_not_import` 变短且没新增）；★ **条目级消失不拒，但回执首行必点名**（那形态命中 41.8% 的历史写，拒它会被绕）。★ `run` 无主体 ⇒ 只数得出条数、**认不出是哪一条** | `E-CRIT-007` · `src/domain/expectation.ts#expectationLossOf` · `src/application/design/dsl_ops/node_ops.ts#applyDecisionWrite` · `tests/p0_expectation_drop_gate.test.ts` |

| **P27** | **用子串/grep 数"可见度" ⇒ 短键被长词吸收 ⇒ 恒绿** | 量 `edit_dsl` 的必填键在 `description` 里可不可见：子串匹配报 **9/20 → 12/20**，词边界报 **8/20**。根因：`to` 被 `todo` 命中、`ids` 被 `node_ids` 命中 ⇒ **怎么说都"可见"**（2026-11-06 三人连续栽在这里：主控 + 两个子代理） | 量"某个词在不在"必须**词边界**（`\bto\b` / 按分隔符切分后再比），**不许 `includes`**。★ 同族手法：`mustNot: ["state: 'preparing',"]` **故意带逗号**，用足够长的相邻字符把"回执里的回声"与"源码里的写入"分开 | 2026-11-06 `op_data_spec.ts` 可见度测量 |
| **P28** | **字节 ≠ 字符**：中文一字 3 字节 | 说「description 2,020 B」实为 **3,600 B**；说「`renderOpSpecs` 11,202 B」实为 **17,656 B** ⇒ **阈值按字符设、判据按字节判，差 1.78 倍**（2026-11-06 同一张卡里连错两处） | 凡"大小 / 上限"一律 `Buffer.byteLength(s,'utf8')`，并在判据里**写明单位**。中文占多数的文件，字符数与字节数不许混 | 2026-11-06 `scripts/mcp/mcp_scan.mjs` 工具面棘轮 = **bytes** |
| **P29** | ★★ **引用"会话内读数"当证据 —— 它在仓里有落点吗？** | 卡里写「T-21 量出 立卡:判据1:判据2 = 2:1:1，收尾 = 5 次调用」⇒ 全仓 grep `2:1:1` **0 命中**、`T-21` **0 命中**；同一晚又写「3 张卡已立」⇒ **T-30 那张根本没进卡池** | **写进卡 / 目标 / commit message 之前先问：这个数在仓里有落点吗？** 没有就**当场落盘**（`docs/` 一条带日期测量记录，或测试里一条断言）；落不了就**不许引用**。★ **会话记忆不算证据 —— 它不能被第二个人复算** | 2026-11-06 一晚犯两次；对照 P20（带日期的测量流水不许改指） |

| **P30** | ★★★ **删掉一个 op（或一段分支）时，它承载的不变量会**一起消失**，而判据不会喊** | T-28 砍掉 `preparing` 与 `op:'start'`，于是「回执说**补 N 条**」这个门槛（原本由 `startTask` 里 `post.length < gap.need` 兜着）**随 start 一起死了**。`claim` 的判据点只剩 `post.length === 0` ⇒ 实测**补 1 条（< need=2）就 claimed**。而同一提交里 `judge` **715 条全绿** —— 因为**没有一条判据覆盖"claim 门槛"这件事**。★ 同时 15 个测试红是**暴露的**（会被人看见），而这个回归是**隐藏的**：它藏在绿里 | **删 op / 删分支前先问三句**：① 这段代码里有哪些**不变量**（不只是它自己的逻辑）？② 那些不变量原来靠谁兜着？③ 兜它的那行被删了之后，**谁接管**？⇒ 答不出就**先补判据，再删**。★ 反直觉：**红会暴露自己，绿不会** —— 所以"全绿"从来不是"没有回归"的证据，只是"回归不在判据视野里" | 2026-11-06 `e8591f19`（T-28）；实测证据 `.agent-io/scratch/t35/probe_claim.mjs` |

## 怎么加新坑

撞到一次就往表里加一行（**P 号只增不复用**）。三条要求：

**P31** `source-has` 的 `mustNot` 是**逐字空白敏感**的 —— 折行就抓不到
- 症状：塞 `CREATE TABLE changesets` **不红**（针是 `CREATE TABLE IF NOT EXISTS changesets`，
  它不含 `IF NOT EXISTS`）；同一句 DDL **折成两行也抓不到**（`hitMustNot: []`）。
- 对策：断"某段代码不存在"时，针取**最短且不含可换行位置**的片段（例如只取 `changesets` 这个标识符本身）；
  需要"整句"语义时改用 `behavior-cases` 或结构断言，不要靠文本子串。
- 出处：T-40 round 2 的 J3 消融实测（`docs/CLOSURE-2026-11-07-T39.md` 里 J3 那一行按简写塞是不红的）。
- ★ 衍生风险：**所有**靠 `source-has` 的判据都可能"因为代码排版变了而静默放行"。

**P32** 判据指向**未来符号** ⇒ 卡**领不到**（`unknowable` 连 `intent:modify` 也拒）
- 症状：`claim 被拒（可领性：unknowable）` —— 判据要断的符号还没写出来 ⇒ `unsupported` ⇒
  卡的 `standing=unknowable` ⇒ 「blocked / unknowable 连 modify 也拒」⇒ **写不了代码，死结**。
- 对策（工序，不是降级）：元素级 `expectation.remove` 摘掉那两条 → `claim` → **同内容原样加回** → 再写码。
- 出处：T-40 round 2 撞。

**P33** `edit_dsl` 的 `op` / `type` 必须写在 `data` **之前**
- 症状：`operations[0].op: expected string` —— 把 `op` / `type` 写在 `data` 后面，**整格被丢**。
- 对策：`op` / `type` / `id` **一律写在 `data` 之前**。
- 出处：T-40 连撞 3 次。

**P34** `npm run build` **不会覆盖被手工改过的 dist 文件** ⇒ 用 dist 做消融会**假绿**
- 症状：手改 `dist/.../x.js` 做消融，跑 `npm run build` 之后**那段补丁还在**
  （tsc 增量认为无需重发；`clean_dist` 也不报缺）⇒ 你以为"还原后已重建"，其实没重建。
- 对策：**改 dist 之前/之后都要** `rm node_modules/.cache/tsbuildinfo.json && npm run build`。
  更稳：**别用 dist 做消融**，改用 src + 清 tsbuildinfo + build。
- 出处：T-41 round 2（`clean_dist` 自己点出来的）。
- ★ 衍生：凡是"手改 dist 观察行为"的验证，**都要先证明那份 dist 是这次重建出来的**。

**P35** `edit_dsl` 的汇总**只留每个 op 的 `message` 首行**
- 症状：把"由取法取到"写首行、把**值**放明细行 ⇒ **人读回执里根本看不到值**（只有 `---DATA---` 里有）。
- 对策：凡是"回执必须自足"的措辞，**把关键值放首行**。
- 出处：T-41 round 2（第一版就踩了，改后人的读数才自足）。

**P36** ★★ **空测试集被判「全过」** —— `cases: []` ⇒ `pass`（"0/0 case 一致"）
- 症状：`judgeExpectations`（`src/application/design/intent/expectations.ts:510`）**不做形状校验** ——
  校验只在**写路径**（`assertValidExpectations` 的 `minItems:1`）。所以**在内存里构造** expectation
  再喂核的路径（编译器 / 派生器 / 适配器，它们绕开写路径）会遇到：
  · `cases: []` ⇒ 判 **`pass`**，detail =「**0/0 case 一致**（… 经金丝雀 harness 现跑）」
  · 缺 `cases` 键 ⇒ `unsupported`，但报文是 JS 内部错 `Cannot read properties of undefined (reading 'map')`
- 同一族第二条：`expect: unknown` 与核的 `expect: string` 不兼容且**静默恒假** ——
  `sameBehaviorRet("5", 5) === false`（走 `String(v) === expect`），而写路径**接受** `expect: 5`。
  ⇒ 透传一次数字/布尔/对象期望，就造出一条**永远是红的判据**。
- 对策：任何"内存构造 expectation"的路径，**必须在自己这一层**（交给核之前）校验
  `cases.length >= 1` **且** `expect` 是 string；给了非 string ⇒ **`unsupported` 并点名阶段**，
  不许让它走到核里恒假。
- 出处：T-45 第一轮实测（2026-11-07）。
- ★ 为什么它最坏：**一个空的测试集被判成"全过"** —— 它比恒红更坏，因为**没人会去看一个绿的**。
  而恒红至少会被发现"这条判据坏了"，然后被修或被删。

1. **症状要能搜到** —— 把闸的**原文**抄一句进来，下一个人才能 grep 到这张表。
2. **对策要是动作**，不是"注意一下"。
3. **带出处** —— 哪个文件 / 哪个码。

★ 这张表的来源：**没有一条是读文档想出来的**，全部是子代理被闸挡住后**贴原文**留下的抓痕。
（★ 这里**故意不写条数** —— 原先写的是"这 15 条"，而表里早就是 25 条：写死的计数必然漂。）
