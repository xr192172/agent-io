# dogfood —— 用本仓工具时，哪里不顺手

> 这里记的是**使用体验**，不是缺陷台账（缺陷进 `docs/todo.md` 或任务卡）。
> 判据：**"我本来想做什么 → 工具让我多做了什么/让我猜了什么"**。
> 每条标：`已修` / `待处理` / `观察中`。

---

## 2026-10-20（一天之内踩到的 13 条）

### A. 判据两份，各持一份（最严重的一类）

**1. `edit_dsl` 的 `op` zod 枚举 vs `OP_SPECS`** — `已修`
- 想做什么：调 `op=void` / `op=reopen`
- 工具让我怎样：报 `类型/取值不符：operations`，**不说哪个 op 不合法**
- 根因：zod 里硬编码 14 个 op，`OP_SPECS` 里有 16 个（`void`/`reopen` 调不通）
- 修法：zod 改 `z.string()`，判据回到 `OP_SPECS` 一处

**2. `edit_dsl` 的 `type` zod 枚举 vs `OP_SPECS`** — `已修`
- 想做什么：`edit_dsl op=add type=todo`（建一条无节点任务）
- 工具让我怎样：同样报"类型/取值不符"，**没说 type 不合法**
- 根因：`type` 枚举里**没有 `todo`** ⇒ **`todos[]` 从来只能手改 JSON**
- ★ 这说明"同一类病会在 24 小时内复发第二次"——上午修 `op`，下午撞 `type`

### B. 报错位置与形状

**3. L3 的 `reason` 太泛被拒** — `观察中`
- 想做什么：`release` 一张卡
- 工具让我怎样：报"原因未绑定具体实体，太泛了"，**但这句话在输出末尾**，前面还有"下一棒"提示 ⇒ 第一眼像"静默失败"
- 建议：`reason` 被拒时，**首行就说**，别让"下一棒"抢在前面

**4. `attestation` 缺 `at` 被拒** — `待处理`
- 想做什么：`complete` 一条 todo（凭口供）
- 工具让我怎样：`kind='attestation' 要求 at 非空` —— 但 `why` / `by` 都是可选的写法，只有 `at` 是硬要求
- 建议：报错里**给出完整形状示例**（现在只说"at 非空"）

### C. 编辑工具

**5. `edit_code` 依赖 `dist`** — `观察中`
- 想做什么：修一个 TS 语法错
- 工具让我怎样：`dist` 里是坏的 `index.js` ⇒ **编辑工具自己加载不起来**（鸡生蛋）
- 缓解：先用 Write 手修源文件、再 `tsc` 重建
- 建议：STALE_SOURCE 警告已经有了，但**dist 语法坏时应该更醒目**

**6. `replace_text` 要求唯一命中** — `观察中`
- 想做什么：改两处**一模一样**的 `return {...}`（async / sync 两个 parseFileFull）
- 工具让我怎样：报歧义（这是对的），但没给"用 range 按行号"的提示
- 建议：歧义时报出**候选行号列表**，让调用方能直接选

**7. `range` 要自己数行号** — `观察中`
- 想做什么：改第 1938 行
- 工具让我怎样：行号要自己 `grep -n` 数，而且**改了前面的会使后面的行号漂移**
- 建议：`range` 支持"锚点 + 偏移"，或者干脆支持多区间一次提交

### D. 索引与数据

**8. `import_project` 的 `max_files` 默认 200** — `观察中`
- 想做什么：清库后全量重建
- 工具让我怎样：只回填 200 个文件，**其余静默没写**（没报"截断"）
- 建议：截断时必须**在回执首行说**

**9. 升 `SCHEMA_VERSION` 不一定清库** — `观察中`
- 想做什么：加列后让存量数据重建
- 工具让我怎样：第一次跑已把新版本写进 `schema_versions`，**再跑就不清了**，人以为"重建过了"
- 建议：文档里明确"升版本只在**第一次**触发清库"

**10. 另一个进程在用旧 dist 写库** — `观察中`
- 想做什么：验证 span 覆盖率
- 工具让我怎样：**查了 20 分钟代码，压根不是代码问题** —— 一个 07:14 启动的 MCP server 内存里是旧 kernel
- 建议：`cache.db` 里加一列"写入者版本"（`kernel_build`），查数据时能一眼看出"这行是谁写的"

### E. 任务系统

**11. `done` 的卡不能重翻** — `已修（加 t_reopen）`
- 想做什么：同一节点做第二件事
- 工具让我怎样：`publish` 拒（"覆盖它等于把已完成的判据换掉"），`release` 只能 `claimed→candidate`
- 修法：加 `t_reopen`（done→claimed）+ OQ1 裁定「显式收口」

**12. `decision update` 的 `expectations` 整体替换** — `观察中`
- 想做什么：给卡加一条判据
- 工具让我怎样：只传 2 条 ⇒ **静默冲掉之前 3 条**（零报错）
- 建议：`expectations` 是数组 ⇒ 应该支持"追加/删除"语义，或者**报"从 N 条变 M 条"**

**13. `todo` 的 `add` 即建卡，没有 `publish` 步骤** — `观察中`
- 想做什么：建 todo 后立卡
- 工具让我怎样：`publish` 报"对象是节点，找不到节点"；但 `add` 时卡已经建好了
- 建议：`todo` 的 `add` 回执里**明说"卡已建（state=candidate），无需 publish"**

---

## 怎么用这份文档

派子代理时，**在回报格式里加一条**：

> 6. 用这个工具时，**哪里让你多做了动作 / 让你猜了**？一条也行。

（今天的第 10 条就是这么来的 —— 我查代码 20 分钟，它看进程列表 5 分钟。）

---

## 2026-10-20 追加（侦察「done 卡连续改动」时，子代理报的 7 条）

**14. `reopen` 的回执在教一条错路** — `待处理`
- 回执说「要换判据请先改 decision，再 reopen」，但 `reopenTask` 只做 `{...card}`，**从不重读 decision**
- 照着办 ⇒ 卡上还是旧判据 ⇒ `claim` 被 `satisfied` 拒 ⇒ 才发现还得 release+publish
- **至少白走一轮。** 这条最该先修（改文案，零风险）

**15. 一次意图要填 3 次身份、2 次理由，其中一半被扔掉** — `观察中`
- `reopen(owner, reason)` → `release(reason, 把 owner 清空)` → `claim(owner)`
- 工具在向我要它自己马上会扔掉的数据

**16. 报错指向一条不存在的路** — `待处理`
- `task_ops.ts:317` 写「或走 `replaces/superseded` —— 未实现」
- 但 `superseded` 已于 10-17 删除、`replaces` 是死字段 ⇒ 按提示去试只会撞墙

**17. `publish` 名不副实，破坏性不写在契约里** — `待处理`
- 它同时是「立卡 / 重翻 candidate / L1-done→L2 隐式 done→candidate」
- 还会**静默丢 evidence 和 discussion**；`OP_SPECS` 的 note 只写"立卡=翻决策卡"
- 子代理"读了 971 行才敢确认它会不会毁数据"

**18. ★ 唯一能绕开写闸的办法是"换个工具直写"** — `观察中（结构性）`
- 写闸只装在仓内工具（`edit_code` / `rename_*` / `symbol_move`），**CLI 自带的 Write/Edit 不受管**
- 立 `todo` 代替卡片也不行：写闸只读 `geometry.nodes[].task`
- ⇒ **「无卡改动」是结构性诱因，不只是纪律问题**（今天我自己就犯了两笔）

**19. `dogfood #11` 标「已修」标早了** — `已修正为：部分修`
- `t_reopen` 只修了**状态机**（能迁出 done），没修**工作流**（迁出后仍 5 个动作）
- 拆成 #11a（能重开 ✓）/ #11b（重开后能顺畅换判据 ✗）

**20. `done` 到底是不是终态，两处代码说法不一** — `观察中`
- `TERMINAL_TASK_STATES = ['void']`（`task_schema.ts:55`，**零消费者**）
- `isTerminalTaskState` 仍把 `done` 当终态（`:67-75`），patrol 用的正是后者
- `DESIGN.md` C2 已记，仍未合并

---

## 2026-10-20 追加（堵 reopen 白洞时，子代理报的 8 条）

**21. 任务描述里的行号是错的** — `待处理（约定）`
- 我给的行号 `727-732` 实际是 `completeTask`；`reopenTask` 在 `797-826`
- 子代理只能靠"代码形状"（`{...card, state:'claimed'...}`）反查
- ⇒ **引用代码时带符号名，别只给行号**

**22. `TaskEvidenceRecord.at` 的注释说"何时"，实际是"收口时刻"** — `待处理`
- `task_ops.ts:723` 是 `complete` 自己 `new Date()`，**不是输入 evidence 的 at**
- ⇒ 这条歧义直接导致一个候选方案（比对时间戳）看起来可行、**实际自毁**
- 建议：字段注释加一句"★ 不是输入 evidence 的 at"

**23. `complete` 的校验链跨三层，找不到"插哪"** — `待处理（设计建议）`
- `task_ops:701` → `task_machine:340 isSatisfied` → `task_machine:192 cardStanding` → `overlay:validateProgressEvidence`
- `completeTask` 本身 120+ 行、3 个 level 分支 ⇒ 为了回答"插前还是插后"读了 4 个文件 500 行
- ⇒ **建议把 `complete` 的闸做成有序表**（像 `RED_DISPOSITION` 那样 `Record<guard, fn>`），
  加一道闸就是加一行

**24. 没有可复用的 task-op 测试脚手架** — `待处理`
- `impl-fixture` 只测 domain 纯函数；测 `edit_dsl` 的 task op 要手抄 `t350` 的 40 行
- 第一次直接 `ENOENT`：**`saveDSL` 不会创建 `<home>/.agent-io/design/`**
- ⇒ 一个 `makeFixtureHome()` helper 能省掉每个新证的一次试错

**25. `edit_dsl` 回执首行是 wrapper，而注释说"只透出首行"** — `待处理`
- 首行是「已对 feature … 应用 1 个操作」，逐 op 消息在第 2 行起
- 而 `task_ops.ts` 里反复写着"回执只透出首行" ⇒ 子代理按注释压首行，**假红一次**
- **实测：handler 返回的 `text` 含全文** ⇒ 那条注释要么过时、要么指另一层

**26. L3 的 reason 闸会拦住夹具** — `观察中`
- 我必须把真路径写进 `reason` 才过（写"夹具"不行）；给 `todo.add` 时 id 还不存在
- ⇒ 夹具场景下的 reason 应该有个可接受的形状

**27. `TaskSpec` 与 `schema/design_dsl.schema.json` 是两份字段清单** — `观察中`
- 加字段必须自己决定"要不要同步 schema"，**没有一处会提醒**
- （与 A 类 #1/#2 同族：又是两份判据）

**28. `complete` 的 doc guard 仍写 `claimed → done`** — `待处理`
- OQ1 之后新增了 `candidate → done`，但文档首句没提
- 子代理按文档写 `publish → claim → complete`，夹具直接红

---

## 2026-10-20 追加（工具链体检时，子代理调了 33 次工具报的）

**29. ★ `design_line` 的 `ok:true` 语义过载（最危险）** — `待处理`
- 四种情况**输出逐字相同**：①做了且复核干净 ②没事可做 ③路径写错 ④这类符号我不管
- 实测：`file=不存在的路径` 与 `file=设计DB未覆盖的文件` 与 `真的没差异` ⇒ 全是
  `✓ 没有可重写的签名差异` + `{"differ":[],"applied":null,"ok":true}`
- ⇒ 缺一个 `did_work:false` + `reason:'no_design_copy' | 'path_not_found' | 'uncomparable_kind'`

**30. `--help` 不可用** — `待处理`
- `design_line --help` 返回「入参未通过 schema 校验…缺必填：project_dir」
- 要读参数得知道 `--schema`（或翻源码）

**31. 必填性靠运行时报错教会调用方** — `待处理`
- schema 里 `feature` 标 `optional`，但 `action=report` 时必填
- 只有跑一次才在正文里告诉你「design_line action=report 需要 feature」

**32. `action=report` 答的不是"哪些文件要重写"** — `观察中`
- 全程没有文件清单、没有判据，只给「344/466=73.8%，未覆盖 129」
- 要看文件级差异必须自己想到 `action=rewrite file=…`

**33. `uncompared` 只报计数，不报"你看不见什么"** — `待处理`
- `const 5 / interface 1` —— 子代理"第一次看到时以为自己传错参数"
- ⇒ 应该明说「这些符号的改动**永远不会被重写发现**」

**34. `feature` 对 rewrite 只影响标题** — `观察中`
- 源码写明"判定本身不看 feature"，但 CLI 描述让人以为 rewrite 是按 feature 分区
- 传 `feature=task-system-plan`，实际扫的是**全量设计 DB**

**35. 语法门拦截时脱离标准信封** — `待处理`
- 无 `---DATA---`、无 REWRITE 头、**exit code 0**
- 脚本化调用**无法区分成功/失败**，只能人读中文

**36. `edit_code` 的「写盘成功 + 索引失败」塞进同一行 `✓`** — `待处理`
- 回执：`✓ ... 索引已重建（failed｜⚠️ 引用方重算失败：database is locked）`
- 文件写成功了，但索引没更新 ⇒ **同一行里既有成功又有失败**
- 没有重试、没有可判定状态字段（`written` 只在 `---DATA---` 里）

**37. `edit_code` 对 `certs/design-db/*.json` 说"语法门通过"** — `观察中`
- 它把 JSON 当代码文件做无意义的语法检查 ⇒ 回执会误导人以为"这段 JSON 被验证过"

**38. `remove_dead_imports` 不能按文件调** — `待处理`
- 必填 `dead`（`DeadDepCandidate` 列表）⇒ **必须先有别的工具算出来**
- 对一个 6 import 的小文件做体检，**没有入口**
- 子代理选择"不硬凑假 `dead` 去喂它"（否则就成了"我编造输入证明工具能用"）—— 这个判断是对的

**39. 三个工具三套回执格式** — `观察中`
- `design_line` 自绘表格 + `---DATA---`；`edit_code` 一行 `✓` + diff + `---DATA---`；失败路径**裸中文**
- ⇒ 统一回执（尤其失败）比任何功能都更影响可自动化

**40. ★ 全部工具都把「我什么都没做」渲染成 `✓`** — `待处理`
- 缺一个统一的 `did_work: false`

---

## 2026-10-20 追加（查欠账时撞到的）

**41. ★ `claim` / `void` / `release` 对 `todo` 的定位走的是 `geometry.nodes`** — `待处理（真 bug）`
- 实测：对 `todo_查清-imports-start-index-落库只有-39-ts的原因并修好` 调 `claim`，报
  「节点 "..." 不在 feature "task-system-plan" 的 geometry.nodes 里 —— 任务与节点同居，找不到节点就没有家」
- 但这条 todo **确实在 `todos[]` 里**（`get_dsl` 读得到，`state=candidate`）
- ⇒ `edit_dsl` 的 `type` 已经支持 `todo`（今天加的），但 **`claim` 的实现还在按节点找**
- ★ 而今天之前那几次 todo 的 claim 是**成功的**（`pruneDeletedFiles` / `reopen 白洞`）——
  说明两条路径**有时走对有时走错**，取决于 id 长什么样（带 `-2` 后缀的那条成功了）
- 影响：**陈旧 todo 无法销账**（这条是今天 imports span 那件事的第一版，已被 `-2` 取代）

**42. todo 里有重复条目** — `待处理`
- `todo_查清-imports-start-index-落库只有-39-ts的原因并修好` 与 `...-2` 是**同一件事的两条**
- 起因：我第二次 `add` 时不知道第一条已经建了（`add` 不回显"已有同名"）
- ⇒ `todo` 的 `add` 应该查同名（或至少警告）

---

## 2026-10-20 追加（查 D-actor-entry 时，子代理报的 7 条）

**43. ★★ 写闸「看不见任何 feature」是独立于 actor 的第一层问题** — `待处理`
- `getDSL` 读 `.agent-io/design/`，而 `collectGateCoverage` 走 `listFeatures()` 读 `.agent-io/features/`（`write_gate.ts:599` → `storage.ts:810`）
- `features/` 里只剩 2 个 overlay、**0** 个 `.dsl.json`
- ⇒ `applicable:false, basis:'no-feature-for-root'`，**连"提醒+放行"都没走到**（`:815` 比 `:916` 早 return）
- ★ `DESIGN.md:302` 写着"写闸…都已读 design 侧" —— **这句是假的**
- ⇒ 修 actor 不修这个 = 闸仍然永不触发

**44. `edit_code` 没有 `agent` 字段** — `不是 bug，是我记错`
- 只有 `edit_dsl` 有 `agent`（`design/index.ts:188`）
- 我派活时写"`edit_code` 已有 `agent` 字段" ⇒ 子代理多花一步 grep 纠正
- ⇒ **派活单里的"已有事实"也要能被标 `[未核]`**

**45. ★ `agent` 与 `owner` 不是同一条通路** — `待处理`
- `edit_dsl.agent` 只做**署名**（decision.agent / released_by / evidence.agent）
- **`claim` 完全不用 `agent`**（owner 只从 `data.owner` 来）；`publish` 忽略它；写闸只读 `resolveActor()`→env
- `src/application/design/**` 里 `resolveActor` **0 处 import**
- ⇒ 同一语义（身份），三条通路，没有权威

**46. ★ `publish{reason}` 能改别人的卡（今天刚做的功能是个洞）** — `待处理`
- 只判 `state==='claimed'` ∧ 有 `reason`，**不判 owner**（`task_ops.ts:393-445`）
- A7 只守源码写入、不守卡本身 ⇒ "改掉别人的验收标准再让他收口"这条路没堵
- 同族：`complete` / `void` / `reopen` 也都不校验 owner
- ★ `reopen` 更是**合法绕过**：`done→claimed` 直接把人换成 `data.owner`

**47. ★ `write_gate.ts` 自己的卡是 `void`（终态）** — `待处理（死锁）`
- `publish` 从 void 拒、`reopen` 只从 done 走（全表无 `from:'void'`）
- ⇒ **一旦覆盖采集修好，改 `write_gate.ts` 会被"未领任务"拦，而报错给的两条路都走不通**

**48. A7 拦的不是"所有非 owner 写入"** — `观察中`
- 只取**第一个命中的 covering feature** 的 claimed 卡（若那张 owner 为空，即使别处有别人的 claimed 卡也放行）
- `owner` 为空 ⇒ 放行；`actor` 为空 ⇒ 提醒+放行

**49. 「防冒充」在本架构不可达** — `结论`

**50. 「闸生效」的时刻是 `npm run build`，不是「改完 src」** — `已确认`
- `edit_code` 跑的是 `dist/`；改完 `write_gate.ts` 但不 build ⇒ 闸还是旧的（我前几次写盘其实**没受闸**）
- ⇒ 派活单里说"修完就立刻受闸"是对的，但**必须补一句**：受闸的时刻 = 下一次 build 之后；在那之前所有写入都是"旧闸"下的

**51. `saveDSL` 写 `design/` 却不 `mkdir design/`** — `已修（2026-10-20）`
- `saveDSL` 只 `ensureFeaturesDir()`（`storage.ts:599`），而落点是 `design/<f>.dsl.json`
- ⇒ 任何用**全新 `AGENT_IO_HOME`** 的证在 `seed` 就 ENOENT：`t352` / `t353` 崩在这里（**与本次改动无关，10-18 搬家起就坏了**）
- ⇒ 修法：写前 `fs.mkdirSync(getDesignDir(), { recursive: true })`（与 `saveDesignSheet` 同纪律）

**52. ★ 证的夹具也是"第二份可达迁移表"** — `观察中`
- `scripts/impl-fixture.mjs` F7 断言 `applicableTransitions(void) === []`；加 `t_relaunch` 后立刻假红
- ⇒ 说明"迁移表只住一处"这句话**只对生产代码成立**：断言里还抄了一份"谁能走到哪"
- ⇒ 状态机加边的标准动作应是：改 `TRANSITIONS` + `grep` 所有**断言过的可达集**

**53. 写闸把 `certs/*.mjs` 也拦了** — `待裁`
- 证与脚本是 design-canvas 的文件节点 ⇒ 修一张坏证也要先 publish + claim
- 而"证坏了"的场景恰恰是"闸/契约本身坏了" —— 这时开卡依赖的正是坏掉的那条链
- ⇒ 要么给 `certs/` `scripts/` 一条**显式豁免**（写明理由），要么接受"修证也走任务"（但要保证 publish 永远不依赖闸）

**54. `edit_dsl` 的顶层 `reason` 会先吃掉"验收用的拒因"** — `已确认`
- 我要验"relaunch 缺 reason ⇒ 拒"，结果 `edit_dsl` 先用 L3「原因太泛」把我拒了 ⇒ **分不清是谁拒的**
- ⇒ 验收一条"会拒"的行为时，外层 reason 必须写清实体（本次写进节点 id 才过）

**55. 手拼 args JSON 会被 shell 吃掉反引号/反斜杠** — `已确认`
- 用 `bash heredoc` + `node -e "..."` 造 `--input` JSON 时，模板字符串里的反引号被执行、`\\n` 被折叠
- 实测代价：一次把 `publish` 的拒因写成「要重做请先 （带 reason…）、；」——**代码里少了一句人话**，靠回读才发现
- ⇒ 正确姿势：先把**新文本**写进文件（labs 里），再 `JSON.stringify` 包成 args —— 别在 shell 里拼
- 宿主注入通道：**HTTP 侧有 `sessionId`（`X-WorkBuddy-MCP-Context`），stdio 侧没有**
- 同一会话的子代理**共用一个 server 进程** ⇒ 进程/env 级身份区分不了它们
- ⇒ A7 只能买**协作防撞**，买不到**防冒充**。**别按"安全"去卖它。**

---

## 2026-10-20 追加（我自己踩的，第 2 次）

**56. 在 `node -e "..."` 里写 Markdown 反引号 ⇒ bash 会执行它** — `待处理（约定）`
- 实测：`node -e "…summary:'…用 \`isInstrumentPath\`…'"` ⇒
  `bash: isInstrumentPath: command not found`，**summary 后半截被吃掉**（600+ 字变 430 字）
- 这是 #55（子代理报的同一件事）**我当天就踩了第二次**
- ⇒ **约定**：凡是**含反引号 / 反斜杠 / `$` 的长文本**，一律
  **先用 Write 写成文件**（或 `--input` 读文件），**绝不在 `node -e "…"` 里内联**
- ★ 而 `edit_dsl` 不报错（它拿到的是"合法的被截断 JSON"）⇒ 又一个"看起来成功"

**57. `todo` 的 summary 被截断后没有补救路** — `观察中`
- `edit_dsl` 没有 `update type=todo` ⇒ 想补全只能重 add 一条（然后旧的那条成垃圾）
- ⇒ 配合 #42（add 不查同名），todo 会越来越脏

---

## 2026-10-20 追加（做 gate 豁免时，两个子代理报的）

**58. ★ `verify` 的「实现夹具」会偶发 FAIL，重跑即绿** — `待观察`
- 实测：第 1 次 `npm run verify` ⇒ 实现夹具 FAIL（退出码 1）；**同一命令重跑 ⇒ 5 门全过**
- 直接 `node scripts/impl-fixture.mjs` ⇒ 24/24 全过
- ⇒ **"红"和"偶发红"在报告里长得一样**。这个仓库最怕的不是红，是**不可复现的红**
- ★ 建议：门失败时**自动重跑一次**，两次都红才判 FAIL，并在报告里标注"第 2 次才绿"

**59. `edit_code` 接受空操作（`old_text == new_text`）并回 ✓ 写盘** — `待处理（真 bug）`
- 子代理手滑发了一次，它照写不误，还重建了索引
- ⇒ 空操作应当被拒（否则"我改了什么"永远说不清）

**60. ★★ 改完闸，闸不认自己的新代码** — `待处理（运维缺口）`
- `STALE_SOURCE` 只说"bullseye rebuild 后重启 agent-io MCP server"，但**没说谁在跑、怎么重启、重启会不会断会话**
- 子代理"不敢杀宿主拉起的 PID" ⇒ 所有需要"新闸"的动作只能走 `cli.js` 冷进程
- ⇒ **同一个工具、同一份代码、不同进程** —— 这条路是撞出来的，不是设计出来的
- ★ 建议：`cli doctor` 打印 pid / 谁拉起的 / 当前 dist 的 build 时间 / env 里的 actor

**61. ★★ `edit_code` 把闸的返回值扔了（已修）** — `已解决（本次）`
- `assertSourceWriteRegisteredFor(...)` 的 note：**全仓 1 个生产者、0 个消费者**
- 闸写了整屏"凭什么放行/豁免了谁"，**从来没进过任何回执**
- ⇒ 不是加功能，是接一根断线。同族：`rename_file` / `rename_files` / `symbol_move` 三条写路**仍不带 `task_gate`**（豁免会生效、不点名）—— 同一根线还要再拉三个出口

**62. 给"已经全绿的文件"加字段，必须先造一条会红的判据** — `观察中`
- `geometry.ts` 的决策卡 18 条判据全过 ⇒ publish 出 L2 且 satisfied ⇒ `claim` 被拒「只可收口，不可领」
- 子代理最后是**先给决策卡加一条 `source-has gate?: NodeGate`（现在会红）**，才有活可领
- 方向我认（先写判据、再改码），但**工具描述里没有这条路**，它是被拒了才知道
