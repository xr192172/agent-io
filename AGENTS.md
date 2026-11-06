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
- **被闸挡住** ⇒ 先查 `docs/PITFALLS.md`（P5–P15 全是「撞了照这个做」）。**贴原文，不许绕；绕掉的闸就是下次的坑。**

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
npm run verify
```

**一次跑完 14 道门。** 里面含 `npm run design:gen-db` → `npm run cognition` →
`node scripts/lint-prose-as-structure.mjs` → `npm test` 这几样，再加另外 8 道
（设计册判据 / 无卡写账 / 结构意图 / 判据突变 / docs-facts …）。

★ **但它不跑 `npm run build`** —— **必须先单独跑**，否则「MCP 工具签名」「设计册判据」两门会报
「dist 比 src 旧 ⇒ **一条判据都没跑**」（2026-11-06 实测；这句话我写错过一次，是子代理实测打回来的）。

**别只手抄其中几条** —— 手抄的清单必漏。今晚实测：子代理跑"六条"报全绿，而 `verify` 里 **3 道真红**。
`verify` 占 `heavy.lock` ⇒ **一次只许一张卡在跑**。
新增测试后基线会落后 ⇒ `node scripts/run-tests.mjs --update-baseline`（**主控的活**，子代理报给你，不许自己改）。

### ★ 收尾前自问一句（这一问能抓住一半的假绿）

> **「我这轮让哪盏灯变绿了 —— 是修好了，还是它退出了检查范围？」**

2026-11-06 实测：`inventory-sweep --validate-only` 从红变绿**不是指针修好了**，
是那张表单被标 `stale` 后**不再被校验**（`checked` 20→15）。**检查对象退出检查范围 ⇒ 检查自动变绿。**
这一类假绿，只有这一问能抓到 —— 而「我这轮做对了什么」这一类自问抓不到它。

## 四、环境坑

- **工具跑 `dist/`**：改了 `src/` 先 `npm run build`，否则工具是旧逻辑。
- **`STALE_BUILD`**：进程在用旧代码回答 ⇒ 重启 MCP（`Stop-Process` 那个 `node …/mcp/server.js`）或改用 CLI。
- **并发**：`verify` / `mutate` / `judge-all` / `npm test` 互斥（`heavy.lock`）。锁被占时跑测试会**假红**。
- **模板串里不许写裸反引号**：会让整个文件解析失败，**该文件里所有用例一条都不跑**。
- **`docs/*` 在 `.gitignore` 里** ⇒ 新增文档要 `git add -f`。
- **不许并行 `npm run build`**（共写 `dist/`）。
- 翻译产物只能 `node scripts/regen-translate.mjs` 生成（必须 `fill:true`），产物目录不在 git 里。

## 五、派子代理

- ★★ **先质疑任务，再动手。** 第一轮只回报三件事，**不许跳过直接开工**：
  ① 卡里哪几条**与事实不符** —— 自己去核，别照抄（今晚实测：台账说"3 条导出"实为 5 值+1 类型；
     "改 import 到本文件"其实那个文件压根不导出它）
  ② 这道判据**有没有牙** —— 弄坏了会不会红？说不出"什么情形下会红"就不算判据
  ③ 你打算怎么做；做不成的话**卡在哪**（贴闸的原文）
  ★ 理由：**做完了才发现任务本身有错，返工比先核贵一倍。**
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

- 项目目标架构与接续开发顺序 → `docs/PROJECT-DESIGN.md`（目标设计；现状仍以 `docs/INDEX.md` 为准）
- 工具怎么用 → `ToolDef.description`（唯一权威）· 按能力线 → `capability_map`
- 门 / 判据 / 读数四态 → `docs/GUIDE-GATE.md`
- 字段 ↔ 源码 → `docs/FIELD-ALIGNMENT.md`
- 目录 / 未完 → `docs/INDEX.md` · `docs/todo.md`
- 退役记录 → `docs/RETIRED.md`
