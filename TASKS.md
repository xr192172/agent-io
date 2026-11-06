# TASKS.md — 项目进度台账

> **这份文件是唯一的进度权威。** 我是秘书（项目经理），不是开发。
> 我只做四件事：① 维护这张表 ② 发任务给侦察席 ③ 转交任务给开发子代理 ④ 对账。
> **不自己动手改代码。**

---

## 零、一页纸状态

| 字段 | 值 |
|---|---|
| 在途 | **1 张**（`T-01` 第二轮已放行，等回报） |
| 待发 | **27 张**（`T-05` `T-06` `T-02a` `T-02b` + **`T-04-01`…`T-04-15`**） |
| 最近全门绿 | `6875d7e7` · verify 14/14 · 测试 95 文件 / 535 用例 |
| 未提交 | 3 项（见 §六） |
| 台账行数（`docs/todo.md`） | 55 行（今晚零增长 ✓） |

---

## 一、在途

### `T-01` derive_judgements 收口 —— ⏩ **第二轮已放行，等回报**

| 项 | 内容 |
|---|---|
| 卡 | `file_src_application_design_derive_derive_judgements_ts`（claimed，lease 1） |
| 第一轮回报 | 零落盘已核 · 三条 `expect` 是**实跑出来的**（`runHarness` + 真判定核）：`writes:[]`→`deny` / 非空→`allow` / `null`→`unspecified` · 反证 `行为差异 3/3` 不是恒绿 |
| 我的三个决定 | ① 判据 **3 条含 `call-exists`**（钉接线）② fixture 用合法 `BrickRole` ③ 批准**不加** `derivedKinds` |
| 第二轮计划（已放行） | `edit_dsl decision update`（全量 3 条）→ 五样 + judge → `complete`（evidence 单对象）→ 删探针 |

---

## 二、★ T-04 侦察结论（推翻了"该开闸"的假设）

### 总判

```
16 条「相同」 = **15 个实际合并动作**（capability_map ↔ registry_extract 是同一关系的两向）
  · 该合但没合：**11**
  · 半执行：1（#13 名字投影已派生，包清单仍字面量）
  · 已执行：3（#6 #7 #12）← ★ 这 3 条正是被**逐条修**做掉的（subagent:r6-strip，2026-11-05）
  · 不可能执行：0
★ 而 16 条 status **全是 done** ⇒ **`status: done` 就是那个"静默死去仍显 ✅"的字段**
★ 台账 `criteria` 空缺 10/16；有 criteria 的 6 条**没有一条断言"合并被执行了"**
★ 16/16 **都没有一条会在"副本又长回来"时变红的判据**
```

### 侦察席给的核心判决：**不要新开闸**
```
三道独立证据：
A. 隔壁 T-05 已把答案写好（probe_walkers.mjs + 现算基线），不要发明第二种形态
B. 2026-10-03 用户裁掉的是「普查」，不是「增量判据」。
   "16 条都合并了吗" = 本仓自己编的清单普查，**一条 grep 基本能查** ⇒ 按那条线不该成为门
C. 台账的正确用途不是"每年普查"，是 **0.19④ 点名的「同义腿」**：
   改到 X 时，把 X 的 overlap 行拉进影响闭包
⇒ 推荐：**主 = 台账 + 15 张逐条卡**；**辅 = 验收判据写成 tests/p0_*.test.ts，由已有的「测试」门收走**
   （这是本仓已用过三次的撤门迁回路径）；**不选 = 新开 verify 门**
```

### 判据形态（若写成测试，正负两半缺一即假绿）
```
正半：authority.file 存在 ∧ authority.symbol 在其**定义点**（不是导出点 —— 否则 parse/index.ts 再导出会误报）
负半：副本侧**不再有该事实的定义点**
分母：现读台账，「本次 N / 全量 16 ⇒ 未覆盖 16−N」；读不到 / 0 条 ⇒ **红，绝不绿**
★ 三种"静默死去"死法必须防：① 字面串匹配（改名就绿）② `mustNot` 在文件消失时 vacuous 为真
  ③ 分母写死（新增相同条不进分母）
```

### ★ 最干净的"悬置"标本（侦察席挖到的）
```
body_mech.ts:1100 逐字：「收编完成后本函数与 createTranslator 一并删除（届时 t454 会因找不到它而报错 ⇒ 强制同步清理）」
实测：t454 全仓**没有任何文件载体**；docs/RETIRED.md:104 明写它 2026-10-31 已退役
⇒ **这个"强制同步清理"永远不会触发** —— 不变量写在注释里，由一张已退役的证执行
```

---

## 三、★ T-04 产出：15 张逐条卡（按"最便宜 + 最像已成功先例"排序）

| 卡 | 动作 | 现状 | 判据（正半 + 负半） |
|---|---|---|---|
| **`T-04-16`** ⭐ 最便宜 | `parse/ast_parser.ts` 下线：`expectations.ts:27` + `consistency.ts:55` 改 import 到 `parse/index.ts` | **改 2 行 import 即可**（台账已点名两文件；它有 **2 个真消费者**，不是零） | 正：`parse/index.ts#parseFile:5` 在 · 负：`ast_parser.ts` 不再是任何文件的 import 目标 |
| **`T-04-03`** | `observe/index.ts:263` + `:271` 的 `\n---DATA---\n` 手抄 → `plumbing.ts:89 DATA_MARKER` | 正好 2 处；相邻的 `server_registry.ts:44` / `serve.ts:50` **已经是对的** | 负：全仓无第二处 `---DATA---` 字面量；正：`DATA_MARKER` 在 `plumbing.ts:89` |
| **`T-04-04`** | `plan_exit_check.ts:96-98` + `:174-176` 那两句 SQL → 下沉到 `infrastructure/index` 共用 | 注释自认「同一把尺」但没合；阻塞原因：`write_gate` 已 import `plan_exit_check`（环） | 负：SQL 字面量只 1 处定义 · 正：`write_gate#symbolsInFileOf:1292` 在 |
| **`T-04-08`** | `contract_gate/languages/java.ts:16 JAVA_GLOBALS` → `parse/globals.ts:167` | 12 项里 11 已在；唯一缺 `ProcessBuilder` 要先并入 | 负：`java.ts` 无 `JAVA_GLOBALS` 定义 · 正：`globals.ts:167` 在且含 `ProcessBuilder` |
| **`T-04-09`** | `py.ts:15 PY_GLOBALS` → `globals.ts:187` | 60 项里 58 已在；剩 `self`/`cls` 是**死项**（已塞进 locals） | 同上形态 |
| **`T-04-10`** ⚠ | `ts.ts:29 TS_GLOBALS` → `globals.ts` | ★ **不是纯副本**：47 项 = 23 已在 + 8 只在 namespaces 档 + **16 全仓没有** ⇒ **必须先并入权威再删，否则立刻误报** | 负同上；**额外**：那 16 个宿主名在 `globals.ts` 某档里可查到 |
| **`T-04-05`** | `design_sheet.ts:257` ↔ `design_diff.ts:101` 两份白名单合一 | ★ 失真已扩散到**两边**：都还写着 2026-10-27 删掉的 `description`（`design_sheet.ts:54` · `design_diff.ts:76`） | 负：节点字段白名单只 1 处 · 正：不含 `description` |
| **`T-04-01/02`** | `registry_extract.ts` 下线（`extractRegistryTools:69` / `extractRegistryToolsFromFile:115` **零消费者**） | ★ 台账前提已失效：`collect_functions.ts:15` import 它的 `RegistryTool` 类型；而 `collectFunctions` **自己也零消费者** ⇒ 真动作 = **先把类型搬进 `capability_map`，再下线这条三层死链** | 正：`capability_map#catalogOf:957` 在 · 负：`registry_extract.ts` 不再被 import |
| **`T-04-11`** ⚠ | `body_pivot#liftGoBody` 收编 `body_mech` legacy（≈719 行） | 主路已换 pivot（`body_mech.ts:1081` 调 `liftGoBody`），legacy 只剩回落；★ **收尾承诺靠已退役的 `t454` ⇒ 永不触发** | 正：`liftGoBody:228` 在 · 负：`translateGoBodyLegacy` 不再被生产路径调用（由 `scripts/audit-mech-parity.mjs` 接管） |
| **`T-04-13`** | `lang_terms.ts:19-23` 手写 32 项 `PKGS` → 从 `go_std` 导出面派生 | **半执行**：名字集合已派生，**包清单仍是字面量**；`32 == 32` 只是今天恰好相等 | 负：`PKGS` 不是字面量数组 · 正：`renderGoStdAdapter:106` 在 |
| **`T-04-14`** | `body_mech.ts:275 tsTypeFromNode`（第三份）→ `ts_codegen.ts:88 renderTsType` | 实调 `body_mech.ts:478` | 负：`tsTypeFromNode` 不再是定义点 · 正：`renderTsType:88` 在（21 处调用） |
| **`T-04-15`** | `ref_rewrite.ts:76 rewriteMethodCalls` 执行器 → `tsc_fix.ts:294` | 台账判"被吞的是执行器"，执行器仍在原处 | 负：执行器只 1 处 · 正：`applyTscDrivenFixes:294` 在 |
| ~~`T-04-06/07/12`~~ | `text_strip` ← `book.ts`/`symbols.ts` · `normalizeGoNumericLiterals` | ✅ **已执行**（转调 + 改名 `fill.ts:99`，4 个出口全走它）—— **唯一真的动了的 3 条** | — |

### ⚠ 台账可能判错（单列，不进 15 张卡 —— 要人先改台账）
```
① parse/ast_node.ts ↔ ast_rename.ts 判「不同」，但 why 自己写「要合并的是那 9 行类型」
   今天更烂：已经是 **3 份**（ast_node.ts:18 N / ast_rename.ts:28 NodeLike / mutants.ts:50 NodeLike ← 台账不知道第三份）
② ast_node.ts ↔ source_exts.ts 判「不同」，but why 写「一处权威违规候选…必须改名」
   今天仍未改名：ast_node.ts:32 TS_EXTS(8 个) vs source_exts.ts:49 TS_EXTS(4 个) —— **同名同层两义**
③ [无法复算] 另外 568 条「不同」里还有多少其实该合（关键词筛命中 87 但多为否定句，不可信）
   ⇒ 真正的"该合"总数**可能 > 15**
```

---

## 四、待发（非 T-04）

### `T-05` ★ walker 检测器 + 现算基线（防增殖）
```
形态：scripts/probe_walkers.mjs（只报告退 0）+ scripts/walker-baseline.json（= 上次实测读数，不是人定阈值）
挂点：★ 不新开 verify 门 ⇒ 并入已有的「MCP 工具签名」门做子步骤（先例 verify.mjs:169-174）
判据：**只有一条：当前 count ≤ 基线 count**（新增第 N+1 份 ⇒ 红并点名；合并掉一份 ⇒ 绿 + 提示收紧）
防误报：① 主体是【数】不是文件身份 ② 注释行/dist 不计 ③ names 只作提示不判红
★ 已知漏报（写进头注）：净"删一份+加一份" ⇒ count 不变
★ 侦察席已裁：walker 同生态位**至少 17+ 份**（不是 7），检测不能只认已知名字
```

### `T-06` derive_judgements kind 列表测试（T-01 建议，已立）
```
tests/derive_judgements.test.ts · assert.deepEqual(map(e=>e.kind), …)
writes:[]→['run'] · writes:['node:fs']→[] · reads_config:['A']→含'source-has' · undefined→[]
附带：消掉 deriveJudgements 现在的 unused_export
```

### `T-02a / T-02b` code_health 接入设计侧（用户已批）
```
T-02a：取消 score/grade（读数）+ 每个 kind 挂「册里哪一格」，指不到就报"设计册缺口"
T-02b：新增一格「同生态位重复」（**依赖 T-05 的检测器** —— 先有检测器再加维度）
接入表：unused_export→expected_apis · orphan_file→semantic.files
      · high_complexity→contract.expected_behavior · circular_dependency→domain-independent/edge-absent
      · 同生态位→role+responsibility
```

---

## 五、侦察席纠正我的三处（记账，防我再犯）
```
① 我说 ast_parser.ts「零消费者」→ 实测 **2 个**（expectations.ts:27 · consistency.ts:55）
② 16 条清单两处结构错：capability_map↔registry_extract 是**一条两向**；ast_parser 是 **1 条覆盖 3 导出**
③ 我说「七处源码写不要免疫系统」→ 实测 **9 处**（src/ 6 + scripts/ 3）
④ 台账**没有** frozen/allow 字段（上一轮记错）
```

---

## 六、未提交改动

```
M   .agent-io/design/agent-io.dsl.json                 ← 16:19 加的 T-01 节点
??  TASKS.md                                            ← 本台账
??  src/application/design/derive/derive_judgements.ts   ← T-01 的代码（收口后一起提）
```

---

## 七、缺陷台账（不新开行）

| 缺陷 | 归宿 |
|---|---|
| 读数闸（16 种绕过 / 2 条误伤 / why 后门） | 侦察席判"是旗"，已写进注释 + commit message，未修 |
| `file_ops.ts` 没提 `contract` ⇒ BrickContract **无写入口**，936/936 全空 | `T-01` 上游 |
| `analyzeImpact` 两份 | `T-02a` 相关 |
| **17+ 份 walker** | `T-05` |
| **11 条该合没合** | `T-04-01`…`T-04-15` |
| 台账「不同」里可能还有该合的（568 条未逐条读） | 未派（**风险提示**） |
| 循环依赖 4 条（一条 17 文件成环） | 未派 |
| `structureGapIsClean:530` 零调用者 | 未派 |
| ~~垃圾文件 `e[0]+'`~~ | ✅ 已删 |

---

## 八、发卡纪律
```
① 派卡前先量分母，把「分母 + 判据」写进卡里
② 卡里的 kind / 命令 / 路径 / 匹配串 —— 先 grep 确认逐字存在
③ 判据只写【能力型】，不写数量阈值；**正半 + 负半缺一即假绿**
④ 子代理「第一轮只回报」；我第二轮 send_message 放行
⑤ 每张卡原样抄「改完必跑五样」：build · design:gen-db · cognition · lint-prose · npm test
⑥ 子代理不许 commit，我 commit
⑦ 回报后：我验门 → 更新本表 → 再发下一张
⑧ ★ 被闸挡住就贴原文不许绕 —— 绕掉的闸就是下次的坑
⑨ ★ 一次只派一张**开发**卡（会撞 build/test）；侦察卡可并行
```

---

## 九、下一步（一次一张开发）
```
1. ⏩ T-01 第二轮（在跑）
2. T-04-16 开发：ast_parser 改 2 行 import  ← 全场最便宜、台账已点名
3. T-04-03 开发：DATA_MARKER 收 2 处手抄
4. T-05 开发：walker 检测器 + 现算基线
5. T-06 开发：derive_judgements kind 列表测试
6. T-04-08/09/10 开发：三个 *_GLOBALS 并入 parse/globals.ts（★ #10 必须先并 16 个宿主名）
```
