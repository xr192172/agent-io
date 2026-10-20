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
