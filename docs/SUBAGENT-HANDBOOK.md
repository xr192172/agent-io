# 子代理作业手册（agent-io）

> 2026-10-30 起草。**这份文件是给"由子代理驱动本仓"这个用法写的** —— 本仓未来的主要使用者是子代理，
> 而下面每一条都是**当天真撞出来的**（不是道理）。撞一次写一条，写不下就先别加。
>
> 相关但不重复：`AGENTS.md`（动作→工具）、`docs/GUIDE-GATE.md`（门/证/判据四态）、
> `docs/ONE-AUTHORITY.md`（一处权威的设计稿）。

## 0. 环境事实（先确认，别猜）

| 事实 | 怎么看 | 备注 |
|---|---|---|
| 工具跑 **dist/**，不是 src/ | `node dist/src/presentation/cli/cli.js <tool> --schema` | 改了 src 必须 `npm run build` |
| 构建是**全局单例** | `npm run build` 共写 `dist/` | ★ **任何时刻只许一个 build**，并行必炸 |
| 产物目录不在 git | `D:/agentio/dev/agent-memory-ts2/src` | 覆盖即不可回滚；只有 `regen-translate.mjs` 自带 `src.bak-<ts>` |
| 翻译册的家在**语料仓** | `D:/agentio/dev/agent-memory/.agent-io/design/*.translate.json` | 本仓 `.agent-io/design/task-system-plan.translate.json` 是**设计册**（`targets=0`），拿错会"覆盖永不发生" |
| 沙箱 | `whoami /groups` 看 Mandatory Label | Low 完整性 + 目录无 Low 标签 ⇒ `src`/`.agent-io` **写不进**（no-write-up）；需要 `danger-full-access` |

## 1. 调用姿势

```powershell
node dist/src/presentation/cli/cli.js <tool> --schema     # 先看入参，绝不猜
node dist/src/presentation/cli/cli.js <tool> --json '{…}'
npm run tool -- <tool> --json '{…}'                       # 等价

# 只读面（随便用）
get_dsl     query=dsl|nodes|node|file|files|decisions|todo|pool|history|pending|overview|scope
design_line action=report|brief|drift(drift_mode=status)
capability_map · explore_code · find_references · run_tests · code_health · impact_analysis
node scripts/patrol.mjs                                    # 只报告：陈旧租约/claimed 超期/missed_close
```

## 2. 写入 = 设计线九步（顺序不可换）

```
1 判据   edit_dsl {feature, agent, reason, operations:[{op:'expectation.add',type:'decision',id:<node>,data:{expectation}}]}
2 重生成 design_line {project_dir, feature, action:'gen-db'}        # 改判据后必须，否则 verify 红
3 立卡   edit_dsl {op:'publish', type:'task', id:<node>}            # 立卡＝翻该节点决策卡
4 领卡   edit_dsl {op:'claim', type:'task', id:<card>, data:{owner:'subagent:<name>'}}
         判据 0 条 ⇒ 进 preparing（领了不能干）：补判据后 {op:'start', …}
5 画布   design_line {project_dir, action:'plan', file:<repo相对路径>, card:<card id>,
                      entries:[{anchor:{symbol},kind:'rewrite',detail,judgement_ref:'decision:<node>#<i>',status:'open'}],
                      untouched_default:true, untouched_why:'…', apply:true}
6 落盘   edit_code {project_dir, actor:'subagent:<name>', file, op:'replace'|'replace_text'|'insert'|'range', …}
7 自验   design_line {project_dir, action:'judge', feature}
8 收口   edit_dsl {op:'complete', type:'task', id:<card>, data:{evidence:{kind:'reading', command, observed}}}
9 回归   npm run build → 读数 →（必要时）node scripts/regen-translate.mjs --no-fix
```

## 3. 闸门规矩

★ **先查码表，再猜文案**：`node dist/src/presentation/cli/cli.js design_line --json '{"project_dir":".","action":"rules"}'`
→ **65 条码 / 8 族**（`E-PLAN 22 · E-TASK 7 · E-CLAIM 15 · E-CRIT 5 · E-EVD 5 · E-WRITE 3 · E-REASON 6 · E-GENDB 2`），
每条带 `what / why / fix（可粘 JSON）/ doc / where（文件 + 符号，不带行号）`；机器源 = `src/domain/gate_error.ts#GATE_RULES`。
★ **码发布后不许改语义、不许复用号，只许新增**。拒绝时按 `messageStartsWith` 对号。

下面这些是当年**撞出来的**（现在都能在码表里查到对应码）：


1. **`source-has` 不能当 planning entry 的 `judgement_ref`。**
   `planJudgementGaps` 判它"存在类" ⇒ `planGate` 并入 blocking ⇒ `edit_code` 直接被挡。
   它只能当**卡上判据**交给 `judge` 批；entry 的 ref 必须是语义类（`call-exists` / `behavior-cases` / `signature-matches` / `edge-absent`）。
2. **`plan` 必须带 `file`，一次一份画布。** 改 N 个文件 = N 次 `plan`。
   **每次 `edit_code` 之前都要重跑 plan**（改完 body_hash 就变，画布立刻过期）。
3. **`edit_dsl` 的 `reason` 有 L3 实体校验**：路径/符号/数字必须**写进 reason 本身**，
   写"收口判据""按设计补"这类话会被打回；`evidence` 不顶用（那是后两层用的）。
4. **`behavior-cases` 的一个硬限制**（今天撞到的）：
   - ~~`cases[].given` 在 schema 里是纯字符串数组 ⇒ 喂不了对象/表实参~~ **已修 2026-10-30（D4）**：`given` 是 `json[]`（schema 侧只声明 `array`、不写 `items`）⇒ 字符串/数字/布尔/null/对象/数组都能当位置实参，**函数收到真值、不 parse**。★ 新生判据直喂对象，别再写"判据专用桥"（`gateErrorCodesFromJson` / `carriedCodesFromJson` 留待退役卡）；
   - harness 会把目标**单独转译进 tmp 再 import** ⇒ 目标文件必须**零依赖自含**，否则 `目标文件加载失败: Cannot find module …`。
   ⇒ 想给"吃一张表"的函数写行为判据，**仍**得先抽一个零 import 的纯函数文件出来（例：`src/domain/gate_error.ts#gateErrorsOf`）。
5. **修完判据必须 `gen-db`**，否则 `npm run verify` 的"设计 DB 结构"红。
6. **画布的 `card` 填任务卡 id（节点 id 形态）**，不是 `T-#xxx` 标签；`untouched_default` 是 **boolean**；
   `plan` 不认 `cert:` 引用（只能靠证判的改动要人批迁移开关）。
7. **设计 DB 重生成要走全量**：`npm run design:gen-db`（= `scripts/gen-db.mjs`，`features=3 / files=746`），
   **或** `design_line action=gen-db` **不带 `feature`**。★ 带 `feature` 只重生成那一个 feature 的切片，
   `//source` 会与"持有者列表"对不上 ⇒ `npm run verify` 的「设计 DB 结构」门报 **陈旧 361 / 缺 2 / 多 159**。
   `AGENTS.md` 0.2 只写"必须 gen-db"，没写"要全量"，这条是 2026-10-30 撞出来的。

## 4. 读数纪律（本仓最贵的一课）

- 翻译基线只有一个口径：`node scripts/regen-translate.mjs --no-fix`
  ★ `AGENT_IO_TSC_FIX=1` 会把修好的体写回填空缓存 ⇒ 同仓 460~649 抖动，**不可用于读数**。
- **错误数必须配 holes 一起看**：`regen` 自报的 `errors` 不可信（`countErrors` 走 `execFileSync`，
  在受限沙箱里会被吞成 `0`）。**一律用直跑复核**：
  `node node_modules/typescript/bin/tsc -p D:/agentio/dev/agent-memory-ts2/tsconfig.json --noEmit`
  再数 `error TS\d+` / `error TS2304`；holes = 产物里 `TODO(translate)` 计数。
- 语法错会**遮挡**语义检查 ⇒ 报告里 syntax / semantic 必须分开。
- 只读验证优先：能 `node --input-type=module -e` 直接 import dist 的纯函数对语料跑（无 outDir / 无 fill / 无 LLM = 零写入）就别跑 regen。

## 5. 判据怎么选

`behavior-cases`（给输入比输出）> `call-exists` / `signature-matches` / `edge-absent` > `cert`（真跑证）> `source-has`（存在类，只能当辅助 + `mustNot`）。

- `why` 必填且必须带**具体实体与数字**（"49 个跨文件同名 / 101 条 TS2304"）。
- `unsupported` 会**双向拦**（claim 与 complete 都拒）。
- ★ **别写实现字面串进 `must`**：`must:["const pkgDirs = new Set<string>();"]` 这种谁改个传参就假红；
  `mustNot` 才是"防第二份复活"的正解。
- ★★★ **判据不许锚在注释散文上**（2026-10-30 实测）。`source-has` 自 2026-10-30 起**匹配前剥注释**
  （`src/domain/text_strip.ts#stripComments` ← `expectation_kinds.ts#matchSourceHas`；只剥
  `.ts/.tsx/.js/.jsx/.mjs/.cjs`，**`.md` 的 `//source`、`.json` 的 `//` 不是注释** ⇒ 原文匹配）。
  ⇒ 想断言"某条注释里的不变量存在"= **判错了对象**：剥完注释它没有主体，必然恒红。
  实测代价：3 条判据因此翻面（`node_ops#2` 的 `update 也要同步`/`delete 也要同步`、`update_feature#0` 的
  `live_only`/`两层闸`、`task_history#1` 的 `task-history.jsonl`）—— 它们一直在**测注释散文**，不是测代码；
  全部改成锚代码（`call-exists` 锚调用边，或钉**代码字面量**如 `carrier: 'tasks.jsonl'`）。
  ★ 别开"注释豁免口子"（`AGENT_IO_STRIP_SCOPE` 之类）：那是第二处权威，下次又说不清谁算数。

## 6. 会咬人的小事

- **文件行号顺序 ≠ 执行顺序**（本仓连续三次判断错都出在这）。给锚点用 `old_text`，别用行号。
- 模板字符串里禁止裸反引号；脚本 `String.replace` 是**静默 no-op**（改完必须看产物或看数字）。
- `docs/*` 在 `.gitignore` 里 ⇒ 新增文档要 `git add -f`。
- `edit_code` 的 `op=replace_text` 有 4 级模糊级联，回执会明示命中级别（`L1·exact` 才可信）。
- `file.add` 只写 `semantic.files`、**不建几何节点** ⇒ 新建文件的判据挂不上去（见 §8）。

## 7. 交付

- 回执：commit message + `.workbuddy/memory/YYYY-MM-DD.md`（做了什么 / 读数 / 踩了什么 / 怎么回滚）。
- 新增功能 ⇒ `docs/PITCH.md` 一条卖点（挂证 + 可复现读数）；退役能力 ⇒ `docs/RETIRED.md`。
- 完成一项 ⇒ 从 `docs/todo.md` 删掉/勾掉那一行。

## 8. 已知缺陷（未修，别当成能用）

| 缺陷 | 现象 | 影响 |
|---|---|---|
| `file.add` 与几何节点不同步 | `query=files` 能看到新文件，`query=node` 报"不存在节点" | **改用 `node.add`**（`file.add` 报"已存在"）；`node.add` 会自己写 `semantic.files`、判据能挂上（2026-10-30 `gate_error.ts` 实测 6 条判据全挂上）。入册时**别给 `status`**（会撞自洽性闸），evidence 带 `[{type:"node",ref:"<仓库相对路径>"}]` |
| ~~`behavior-cases` 的 `given` 只吃字符串~~ **已修 2026-10-30（D4）** | 曾报 `given/1: must be string`；现在 `given` 是 `json[]`（只声明 `array`、不写 `items`）⇒ 真值直达，`validateDSL(.agent-io/design/agent-io.dsl.json)` 120 错 → 1 错（剩下那条是既有 `anchor_broken`，与 given 无关） | 零依赖仍是硬要求（见上表第二行） |
| `behavior-cases` 要求目标零依赖 | 目标文件 import 了别的模块 ⇒ `目标文件加载失败` | 得先抽纯函数文件 |
| `judge` 里有陈旧红 | `file_src_application_design_db_gen_design_db_ts` 的 `source-has must=".path ?? raw.description"` 与该文件实际不符 | 全批永远不是零红，容易麻痹 |
| ~~判据 `source-has` 纯子串~~ **已修 2026-10-30** | ~~注释里出现也算命中~~ 已改成**匹配前剥注释**（`src/domain/text_strip.ts#stripComments` ← `expectation_kinds.ts#matchSourceHas`，只剥代码扩展名） | 写 `must`/`mustNot` 不用再清注释了；★ 但**别锚注释散文**（见 §5：剥完注释它没有主体） |

## 9. 动手前自查六问（写不出答案就先别写）

1. 这条改动属于**哪张卡**？卡里有没有**当场可判**的语义判据？
2. 改的是**上游事实**还是**产物后处理**？（后者优先怀疑：本仓三次翻车都在这）
3. 数据可用点与消费点的**执行顺序**是什么？（不是行号顺序）
4. 改完**怎么只读验证**？两个读数（errors / holes）预期各是多少？
5. 会不会造出**第二份**同一事实？（第二份必须删或委托）
6. 失败怎么回滚？回滚点是什么（`snapshot` / `src.bak-*`；**不要** `git checkout -- src/`，会连带抹掉别人的未提交改动）。
