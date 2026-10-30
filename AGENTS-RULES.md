## 零、开发纪律（必读 · 违反必回退）

> 本节是**硬纪律**，全部来自实测翻车，不是道理。详细论证：
> `docs/METHOD.md`（六条判据）· `docs/METHOD-DEBUG-BY-SAMPLING.md`（抽查处 → 结构化重写）·
> `docs/FACTS-VS-DESIGN.md`（两层事实 + 事实册↔设计册同构）· `docs/ONE-AUTHORITY.md`（一处权威）。
> 正文源文件：`AGENTS-RULES.md`（本节的唯一住处，生成器自动包含）。

### 0.1 改代码一律走设计线（**不许 `write` 直接改 `src/`**）

```
edit_dsl（给节点写判据）→ design_line action=plan（四条判据全过才冻结）
  → edit_dsl claim（领卡）→ edit_code（落盘：模糊级联 + 语法门 + 原子性）
  → design_line action=judge（框架自验）→ edit_dsl complete（带 evidence）
```

- `evidence` 必须含 `command` + `observed`：**写不出读数就收不了口**；
- 卡已是 `done` 又要改新目标：直接 `claim`（带 `data.reason`），**别再 `publish`**（会被拒）；
- 这条线**实际挡下过**：判据强度不足、语法错（模板字符串里的反引号）、原子性半落盘、`unsupported` 双向拦。

### 0.2 判据的三条硬要求

1. **必须当场可判**：`unsupported` 会**双向拦**（`claim` 与 `complete` 都拒）⇒
   先用 `symbol-exists` 把代码写进去，再把判据升级为 `behavior-cases` / `call-exists`。
2. **强度要够**：`source-has` 属存在类，**永远发现不了逻辑错**（计划闸会点名）。
   能写 `behavior-cases`（给输入比输出）/ `call-exists` / `cert`（跑证）就别用 `source-has`。
3. **改判据后必须全量重生成设计 DB：`npm run design:gen-db`**（或 `design_line action=gen-db` **不带 `feature`**），
   否则 `npm run verify` 的「设计 DB 结构」会红。
   ★ **要全量，理由在读数里**：带 `feature` 只重生成那一个切片的投影，`//source` 与「持有者列表」对不上
   ⇒ `npm run verify` 的同一道门实测报 **陈旧 361 / 缺 2 / 多 159**（2026-10-30 撞到）；全量 = `features=3 / files=746`。

### 0.3 计划（画布）三个坑

- **画布改完即过期**（`symbols_at_freeze` 的 body_hash 变了）⇒ 每轮改完**重新**
  `design_line action=plan --apply:true`，否则下一次 `edit_code` 被拒；
- `plan.card` 要填**任务卡 id**（节点 id 形态），不是 `T-#XXX` 标签；`untouched_default` 是 **boolean**；
- 计划闸不认 `cert:` 引用（判「解不出来」）⇒ 只能靠证判的改动才用迁移开关 `AGENT_IO_REQUIRE_PLAN=0`。

### 0.4 调试方法：**读代码 > 任何统计**

- 先读 2 行错代码（tsc 报错自带行列），再考虑任何读数；
- 量具只用于**事后确认**与**护栏**，**不用来选活**；
- 判据必须用**已知答案**验收 —— 「能数出来」≠「数得对」；
- **脚本 `String.replace` 是静默 no-op**（锚点不符就什么都不做）⇒ 改完必须**看产物或看数字**。

### 0.5 验收：双棘轮 + 已知答案

```
AGENT_IO_REPLAY_ONLY=1 AGENT_IO_TSC_FIX=1 → 全仓 5~8 秒
要求：errors 不升 **且** holes（TODO 空孔）不升
t453 守双棘轮 · t454 守双实现分叉账
```

★ 错误数**暴跌**可能是"函数体退化成空孔"（实测 431→22 是丢了 409 个体）⇒ 永远两个数一起看。

### 0.6 事实分两层（别混）

- **语法层**：tree-sitter，51 语言，**永远可用** ⇒ 翻译前端必须留在这里（要翻的代码常常编译不过）；
- **语义层**：`go/packages` / tsc `Checker`，给绑定、字段选择、类型 ⇒ 只做事实上游；
- 语义层失败 ⇒ 标 `syntax-only`、判据转 `unsupported`，**不许假装精确**。

### 0.7 三条会自动咬人的小事

- `docs/*` 在 `.gitignore` 里 ⇒ 新增文档要 `git add -f`；
- `design_intent.goals` 是**全量替换** ⇒ 一律「读旧 → 合并 → 写全量」，只写增量会**冲掉历史意图**；
- **模板字符串里禁止裸反引号**（`schema.ts` 的 SQL 注释与 `gen_agents.mjs` 的模板都踩过）⇒
  长文本一律放独立 `.md` 由生成器 include，不塞进模板字面量。

### 0.8 重生成翻译产物：**只有一条命令**

```bash
node scripts/regen-translate.mjs          # = npm run regen:translate
```

- 它自己生成（`projectDir` + `outDir` + **`fill:true`** 是唯一能写出**带函数体**产物的路径；
  单文件 `out` 模式会被骨架验证闸拦、不落盘）、
  自己读数（files / holes / errors）、**变差就非零退出**、读数落 `.agent-io/regen-report.json`；
- ★★ **`fill:true` 不是可选项**：`project.ts` 里 **mechBody + 填空缓存**整块都在 `if (opts.fill)` 内。
  不传 ⇒ 那条确定性回放完全不执行 ⇒ 产物全是 TODO 孔（实测：不传 = 617 孔/48 错；传 = **164 孔/22 错**）。
  回放模式（`AGENT_IO_REPLAY_ONLY=1`）下 LLM 部分会被优雅跳过，只做 mechBody + 缓存回放；
- **产物目录不在 git 里** ⇒ 覆盖即不可回滚。脚本先写**同盘临时目录**、再把旧目录改成 `src.bak-<ts>` 备份 ⇒ 手工可回滚
  （2026-10-30 就是因为"猜着跑、无备份"把 188 孔基线毁成 617 且不可恢复）；
- **绝不要**用 `npm run tool -- translate --json ...` 手工拼参数去覆盖产物目录（我踩过两次）。

