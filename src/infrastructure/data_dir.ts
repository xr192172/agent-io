/**
 * data_dir.ts —— 工具数据目录名（在目标项目根下）的【唯一落点】
 *
 * ★ 为什么要有它（2026-09-28，为品牌改名铺路）：
 *   这个目录名此前**硬写在 193 处、散在 130 个文件**里（`storage.ts` / `db.ts` / `daemon.ts` /
 *   `observe/*` / `java_refactor/*` / 一堆 tools …）。品牌改名 AgentIO → AgentIO 要改的正是它
 *   ⇒ 193 处散落意味着**必然漏改**。收成单点后，改名只需改**这一个常量**。
 *
 * ★ 为什么是独立模块而不是塞进 `storage.ts`：它必须**零依赖**。
 *   调用方跨越最低的那几层（`db/`、`daemon/`、`observe/`、`tools/`），塞进 `storage.ts`
 *   会把一个纯字符串常量拖上一条依赖链，容易成环。**一个常量一个零依赖模块，是刻意的取舍。**
 *
 * ★ **刻意不做兼容层**（2026-09-28 用户纠正，采纳）：
 *   我起初在这里预留了 `DATA_DIR_NAME_LEGACY` + 新旧并列的跳过集合 + 回退函数，理由是
 *   "盘上已有项目的数据住在这里"。**那是为不存在的下游写脚手架** —— 本项目没有外部用户，
 *   唯一的下游是 dsh-brain（走 MCP + 桥接，改完重桥即可）。
 *   实测那批预留**出生即死代码**（引用数全为 0）⇒ 已全部剪掉。
 *   ⇒ 纪律：**没有下游就不要兼容层**；改名 = 干净全量改，本地数据由使用者自己迁移/丢弃。
 *
 * ★ 不变量：`DATA_DIR_NAME` 是唯一真相。**任何地方再写一次这个目录名字面量就是副本**
 *   （由品牌串残留门 + G4 登记表共同兜底）。
 */

/** 数据目录名（目标项目根下；改名时**只改这一行**） */
export const DATA_DIR_NAME = '.agent-io';

/**
 * ★★ **设计 DSL 仓库**的数据目录名（★ 2026-10-05 合一化后权威已在本仓 TS 侧，
 *   Go 语言包只负责插桩与进程内采集，不再拥有这份仓库）。
 *
 * ★ 为什么它与 {@link DATA_DIR_NAME} **刻意不同名**（2026-10-05 补声明，此前是 4 处裸字面量）：
 *   两个目录**装的是两样东西、归两个程序所有**，不是同一份数据的两个副本：
 *
 * | 目录 | 归谁 | 装什么 | 谁写 |
 * |---|---|---|---|
 * | `<root>/.agent-io/` | agent-io（TS） | 事件流 `observe/events.jsonl`、影响台账 `impact/ledger.json`、符号索引 `cache.db`、设计存档… | TS 探针 / agent-io 工具 |
 * | `<root>/.agent/observe/` | **本仓 TS 侧**（Go 语言包已不再拥有它） | 设计 DSL `dsl.json`、修订提案 `proposals/`、观测画像 `actual.dsl.json` | `observe-dsl` 子命令 |
 *
 *   权威依据在 Go 侧（**跨语言约定，改这里必须同步改那里**）：
 *   · `observe-lang-go/cmd/observe-dsl/main.go:30,34`（旧 Go CLI，★ 待 P6 删除）— `--project-root` → `filepath.Join(root, ".agent", "observe")`；缺省回退 cwd
 *   · `observe-lang-go/probe/dsl_cli.go:12`（旧 Go CLI，待 P6 删除） —「dataDir 指向设计 DSL 仓库目录（{projectRoot}/.agent/observe）」
 *   · `observe-lang-go/probe/dsl_cli.go:450`（旧 Go CLI，待 P6 删除） — 台账在 `{projectRoot}/.agent-io/impact/`（**从 dataDir 上溯两级**再进 `.agent-io`）
 *     ⇒ 上溯两级正好回到项目根，这行代码本身就证明了两个目录名是**刻意分工**，不是笔误。
 *
 * ★ 因此本仓对这两个名字的纪律是**「各自单点 + 说清分工」**，**不是「收口成一个」**：
 *   把 TS 侧的 `.agent` 改成 `.agent-io` 会让 daemon 读不到 Go 写的 `proposals/` ⇒ **切断 Go 集成**。
 *
 * ★ 为什么此前没人写下这条：2026-09-28 收 `DATA_DIR_NAME` 时，本仓把"再写一次目录名字面量就是副本"
 *   立成不变量，而 `.agent` 恰好是**另一个程序**的目录名 —— 不变量套错了范围，
 *   于是它以"违规"的身份在 4 处裸写了几周，而每个看见的人都在犹豫该不该改。
 */
export const GO_OBSERVE_DIR_NAME = '.agent';

/**
 * 包名（= `package.json` 的 `name`）。
 *
 * ★ 为什么它必须是一个常量、而不是各处写字面量（2026-09-28 改名时发现的**真耦合**）：
 *   `storage.ts` 的 `getPackageRoot()` 靠**自省**找包根 —— 从模块位置向上找最近的
 *   `package.json`、且 `name === <包名>` 的那个目录。这里若与 `package.json` 的 `name` 不一致，
 *   **不报错、不告警**，只会静默退化成 `process.cwd()` ⇒ 把 features 存档与活态 DSL
 *   写到工作区根（`storage.ts` 头注里记的那个"146 条 flows 污染"就是这类）。
 *   ⇒ 改名时这两处**必须同改**；一致性由 `tests/identity.test.ts` 兜（读真实 package.json 比对）。
 */
export const PKG_NAME = 'agent-io';
