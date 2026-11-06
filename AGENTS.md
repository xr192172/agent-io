# AGENTS.md — 做事的步骤

## 一、改代码

```
edit_dsl（给节点写判据）→ design_line action=plan → edit_dsl claim
  → edit_code（落盘）→ design_line action=judge → edit_dsl complete
```

- `complete` 的 `evidence` 必须有 `command` + `observed`；写不出就收不了口。
- 卡已 `done`、又要改新目标 ⇒ 直接 `claim`（带 `reason`），别再 `publish`。
- 画布改完就过期 ⇒ 每轮改完重跑 `design_line action=plan --apply:true`，否则下一次 `edit_code` 被拒。
- `plan.card` 填任务卡 id（节点 id 形态），不是 `T-#XXX`。`untouched_default` 是 boolean。
- 迁移开关 `AGENT_IO_REQUIRE_PLAN=0` 用一次，就要在 `evidence` 里写两条：关掉的是哪道门 + 谁什么时候修。

## 二、写判据

**写「这个能力通不通过」，不写数字。**

| 写这个 | 不写这个 |
|---|---|
| 这个能力在不在、活的吗、通过吗 | 某处数 == N |
| 它该有的消费者有没有在用它 | 某处提到 N |
| 它该做的事造个反例它还红吗 | 覆盖率 N%、数量 ≥ N |

- 读数不是判据。读数放日志，让人和工具自己去发掘；**判据只回答通过/不通过**。
- 强度：`file-exists` / `symbol-exists` / `signature-matches` **发现不了逻辑错**。能用 `behavior-cases`（给输入比输出）/ `call-exists`（谁在用它）/ `run` / `domain-independent` 就别用它们。
- 改判据后跑 `npm run design:gen-db`（全量，不带 `feature`）。

## 三、改完必跑

```
npm run build
npm run design:gen-db
npm run cognition
node scripts/lint-prose-as-structure.mjs
npm test
```

少一样就是一道红门。`npm test` 要**全量**，不是只跑"相关的那几个"。

## 四、环境坑

- **工具跑 `dist/`**：改了 `src/` 先 `npm run build`，否则工具是旧逻辑。
- **`STALE_BUILD`**：进程在用旧代码回答 ⇒ 重启 MCP（`Stop-Process` 那个 `node …/mcp/server.js`）或改用 CLI。
- **并发**：`verify` / `mutate` / `judge-all` / `npm test` 互斥（`heavy.lock`）。锁被占时跑测试会**假红**。
- **模板串里不许写裸反引号**：会让整个文件解析失败，**该文件里所有用例一条都不跑**。
- **`docs/*` 在 `.gitignore` 里** ⇒ 新增文档要 `git add -f`。
- **不许并行 `npm run build`**（共写 `dist/`）。
- 翻译产物只能 `node scripts/regen-translate.mjs` 生成（必须 `fill:true`），产物目录不在 git 里。

## 五、派子代理

- 卡里写 **「第一轮只回报，然后结束本轮」** —— 子代理没有"等审批"这个动作，它只会一口气做完。第二轮用 `send_message` 放行。
- **把 §三 的必跑清单原样抄进卡里**，别让它自己想。
- 卡里出现的 kind 名 / 命令 / 文件路径 / 匹配串，**先 grep 确认存在再写**。
- 无遗言失败 ⇒ `send_message` 续（上下文还在），**不重派**。
- 临时件落 `.agent-io/scratch/<卡名>/`，收尾按文件名逐个删。
- 子代理**不许 commit**，我自己 commit。
- 长任务拆 ≤3 段，每段跑完立即回报。

## 六、修 bug

- **缺陷必须沉淀检测点**，三条缺一不算：可执行（测试 / 门 / 断言 / lint）· 有鉴别力（造一个「该红」的输入它确实红）· 说得出它在什么情形下会红。
- 新增检测点前先问：现有的哪一条能吸收它？能吸收就扩展那一条，**检测点入口数不增**。
- 动手前先**命名**：这是哪个经典问题的变体 · 标准解法有哪些（≥2）· 选哪个、为什么排除其余。答不出 ⇒ 别动手。
- 断言「这段代码合法/非法」前，**先跑编译器**（`tsc --noEmit` / `go build` / `go vet`）。
- 判「在不在册」查结构化登记处，不要用 grep 命中数代替。
- 判任何事实前，先看仓里有没有现成函数能回答；有就调它，别自己拼 SQL / 正则 / 分类逻辑。

## 七、告警与日志

- 告警必须能**定位失败**：给第一个失败的门 + 明细，不要只说"去看 XX 文件"。
- 一条"永远会亮"的告警等于被关掉的告警：正常状态下它得能绿，否则删掉。
- 统计型输出必须带分母（「验了 N 个 / 跳过 M 个」）—— 但那是**日志**，不是判据。
- 告警要自带 `criterion`（什么情况下会亮）+ `evidence`（凭什么判）。

## 八、只改文案时

只改字符串 / 注释 / 提示文案，可免设计线，四条全满足才行：没有非字符串增删行 · 不改 `export` 签名 · 不改控制流 · 不改常量值语义。
仍要留痕（commit message 写"文案改动，未挂卡"），仍跑全门。

## 九、去哪查

- 工具怎么用 → `ToolDef.description`（唯一权威）· 按能力线 → `capability_map`
- 门 / 判据 / 读数四态 → `docs/GUIDE-GATE.md`
- 字段 ↔ 源码 → `docs/FIELD-ALIGNMENT.md`
- 目录 / 未完 → `docs/INDEX.md` · `docs/todo.md`
- 退役记录 → `docs/RETIRED.md`
