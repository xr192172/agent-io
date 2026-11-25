/**
 * gen_manifest —— 生成 / 校验 `<project>/MANIFEST.txt`（**卷声明**）。
 *
 * ## 为什么要有它（2026-10-08，用户「合并形态 S1」，`docs/todo.md` T67）
 * 实测病：**"这份认知有哪几个卷"这条心智，此前全仓只住在 `src/infrastructure/storage_overlay.ts` 的注释里** ——
 * README / router skill / mind skill **三处都不写**。后果是**用户和我都不会想到它有三个**（他自己都忘了第三个是什么）。
 * ⇒ 解法不是"再写一篇文档"，而是**放一份声明在数据旁边**：环境自己说清"我这里有几卷、谁是真相、谁能改、谁会被重生成"。
 *
 * ## 四条纪律
 * 1. ★ **只声明，不放数据**。数据仍在原处 ⇒ **不新增真相源**。
 * 2. ★★ **不写运行态**（`state=present/absent`）。★ 这条是**2026-10-09 自查改掉的**：
 *    初版把每卷的存在与否写进文件，而**这份文件要进 Git** ⇒ ① **新克隆**跑 `--check` 会全线报"不一致"；
 *    ② 同一份文件在不同机器上合法地不同 ⇒ **不可复现**。
 *    ⇒ 判据同 `COGNITION.txt`：**进 Git 的东西不许带"此刻/此机"的状态**（运行态由 `--check` 现算）。
 * 3. ★★ **声明必须与磁盘一致，且这一条由本脚本自己执行**（`--check`）：两**方向**都报 ——
 *    ① 声明了但卷表里没有（**文件被手改过**）；② `.agent-io/` 下出现了**没声明的条目**（**新增了卷却忘了登记**）。
 *    ★ 这是"声明文件最容易变废纸"的那一步（写着写着就漂了）⇒ **所以它必须能被机器对账**。
 * 4. ★ 卷表**只在本文件写一处**（`VOLUMES`）。别处再抄一份就是第二真相。
 *
 * ## 用法
 *   node scripts/gen_manifest.mjs [--project <dir>] [--in-data-dir] [--stdout] [--check]
 *   · 默认：写出 **`<project>/MANIFEST.txt`（仓根）** —— ★ 见下面"**为什么默认放仓根**"
 *   · `--in-data-dir`：写进 `<project>/.agent-io/MANIFEST.txt`
 *   · `--stdout`：只打印，不写盘；`--check`：**不写盘**，只对账（不一致 ⇒ 退出 1）
 *
 * ## ★★★ 谁该在什么时候跑它
 *   · **`.agent-io/` 的布局变了**（新增/删除一个卷或边车、换了真相所在路径）⇒
 *     `npm run manifest` 重生成 `MANIFEST.txt`，再 `npm run manifest:check` 对账；
 *   · **提交前 / CI** ⇒ `npm run manifest:check`。它对的是"卷表 ⇄ 声明 ⇄ 磁盘"三方，
 *     任一方多了少了都红（★ 2026-10-31 它当场抓出 27 个没登记的条目 —— 那正是它的工作面）。
 *   ★ 它是**声明**不是快照：`MANIFEST.txt` 进 Git（低 churn），运行态由 `--check` 现算。
 *
 * ## ★★ 为什么默认写**仓根**
 * 因为**这份声明存在的唯一理由就是"被看见"**：
 *   · 放 `.agent-io/` ⇒ 那目录在目标仓里是 **gitignore 的** ⇒ **文件在，但等于不在**；
 *   · 放**仓根** ⇒ LLM 读仓时**走它本来就在走的通道**（读文件），**不必先知道"有个工具、该调哪个 query"**。
 * ★ 这就是「**file 通道** vs **tool 通道**」之别：tool 通道要求 **服务在跑 + 知道工具存在 + 20 个 query 里挑对**。
 *   实测代价：`query=digest` **早就实现且能用**，却在 `capability_map` / README / router **三处都不点名**
 *   ⇒ **我自己连着四轮都没看见它**，还提议再造一个同功能的 `query=outline`。**这就是 tool 通道的失败模式。**
 * ★ 它**只有 ~1.7KB / 30 行，且只在"卷的布局变了"时才变**（罕见）⇒ **churn 低 ⇒ 适合进 Git**。
 *   ★ 对照 `COGNITION.txt`：**随每次代码改动而变 ⇒ churn 高 ⇒ 不进 Git**，靠工具现渲染。
 *   ⇒ ★★ **判据 = 变更频率**（不是"重要不重要"）。
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = '.agent-io';
const FORMAT_VERSION = 'agent-io/volumes-v1';
const MANIFEST_NAME = 'MANIFEST.txt';

/**
 * ★ 卷表（**唯一一处**）。`probe` = 该项目根下 `.agent-io/` 里能代表这一卷的条目名。
 * `mode` 语义刻意用不同的词，别混：
 *   · `readonly`        —— 只读，工具不许写；
 *   · `regenerable`     —— **会被重新生成**，人写在里面的东西**可能被覆盖** ⇒ 决策别写这儿；
 *   · `human-authored`  —— **人写的，永不被重生成覆盖**（决策的家）；
 *   · `append-only`     —— 只增不删；
 *   · `derived`         —— 从别的卷**现算**出来，**不是真相**。
 * `secret` ⇒ 该卷**可能含凭据**，声明出来让人知道"这目录里有密钥"。
 */
const VOLUMES = [
  // ── 认知卷（DSL 家族）──
  { id: 'live',      mode: 'readonly',       regen: 'scan',         probe: 'live',           path: `${DATA_DIR}/live/<feature>.dsl.json` },
  { id: 'baseline',  mode: 'readonly',       regen: 'snapshot',     probe: 'baseline',       path: `${DATA_DIR}/baseline/<feature>.dsl.json` },
  // ★★★ 2026-10-31（本表此前**指向已退场的路径**，实际目录是 `design/`）：
  //   ① 2026-10-18：设计册唯一位置统一为 `<数据根>/design/<f>.dsl.json`（`stage_registry.ts#S`
  //      原话："agent-io.json 与 features/ 已退场"）⇒ 本表的 `features/` 两条**当时就该跟着改**；
  //   ② 2026-10-23：**overlay 不再是独立文件**（`storage_overlay.ts` 文件头）—— 运行态住设计册的
  //      `nodes[].overlay`、全局件住 `overlay_global`，与设计意图**同一个文件、同一个写手**。
  //   ⇒ 两条仍保留（读者要问"谁是真相 / 谁会被覆盖"），但**指向真文件**、mode 改成如实：
  //      设计册 = 决策的家 ⇒ `human-authored` / `never`（`import_project` 只刷新实际，不碰设计）。
  { id: 'base',      mode: 'human-authored', regen: 'never',        probe: 'design',         path: `${DATA_DIR}/design/<feature>.dsl.json` },
  { id: 'overlay',   mode: 'human-authored', regen: 'never',        probe: 'design',         path: `${DATA_DIR}/design/<feature>.dsl.json（nodes[].overlay + overlay_global，2026-10-23 并入）` },
  { id: 'archive',   mode: 'append-only',    regen: 'never',        probe: 'archive',        path: `${DATA_DIR}/archive/<feature>/` },
  { id: 'cognition', mode: 'derived',        regen: 'base+overlay', probe: 'COGNITION.txt',  path: `${DATA_DIR}/COGNITION.txt` },
  // ── 派生卷 ──
  { id: 'index',     mode: 'derived',        regen: 'scan',         probe: 'cache.db',       path: `${DATA_DIR}/cache.db` },
  { id: 'drcache',   mode: 'derived',        regen: 'on-demand',    probe: 'cache',          path: `${DATA_DIR}/cache/` },
  { id: 'drift',     mode: 'derived',        regen: 'check',        probe: 'drift',          path: `${DATA_DIR}/drift/<feature>.drift.json` },
  { id: 'mindmap',   mode: 'derived',        regen: 'render',       probe: 'mindmap',        path: `${DATA_DIR}/mindmap/` },
  // ★★ 2026-10-13（T67）：**两个快照卷，名字必须分清** ——
  //   盘上同时存在 `code-snapshots/`（**代码**快照：`edit_code`/`rename_*` 的撤回点，目录名带时间戳+随机后缀）
  //   与 `snapshots/<feature>/`（★ **DSL 设计快照**：`snapshot.ts` 写、`get_dsl(query="snapshots")` 读、含"回滚前自动备份"）。
  //   ★ 而本条原先叫 `id=snapshots` 却指着 `code-snapshots/` ⇒ ★★ **读者必然把两者当成一回事** ✗
  //   ⇒ 改成两个名字各自说清（★ `id` 无代码消费，只进 `MANIFEST.txt`，改名安全）✓
  { id: 'code-snapshots', mode: 'append-only', regen: 'never',     probe: 'code-snapshots', path: `${DATA_DIR}/code-snapshots/` },
  { id: 'dsl-snapshots',  mode: 'append-only', regen: 'never',     probe: 'snapshots',      path: `${DATA_DIR}/snapshots/<feature>/` },
  { id: 'dogfood',   mode: 'append-only',    regen: 'never',        probe: 'dogfood',        path: `${DATA_DIR}/dogfood/usage.jsonl` },
  // ── 配置卷（★ 人也写，且可能含凭据）──
  { id: 'gateway',   mode: 'human-authored', regen: 'never',        probe: 'gateway.json',   path: `${DATA_DIR}/gateway.json`, secret: true },
  // ══════════════════════════════════════════════════════════════════════════════
  // ★★★ 2026-10-13（T67）：**下面 7 卷是 `manifest:check` 当场抓出来的** ——
  //   它们住在 `.agent-io/` 却**既不在卷表、也不在 `NON_VOLUME_ENTRIES`** ⇒
  //   对账报 *"要么进卷表、要么进 NON_VOLUME_ENTRIES 加一行理由 —— **不许默默多出来**"* ✓
  //   ★ 逐条判过：**7 条各有独立语义 ⇒ 都是卷**（★ 不是"随某卷生灭的边车"）✓
  // ══════════════════════════════════════════════════════════════════════════════
  // ── 人的内容卷（人写、永不被覆盖）──
  { id: 'docs',      mode: 'human-authored', regen: 'never',        probe: 'docs',           path: `${DATA_DIR}/docs/<feature>/` },
  { id: 'workbench', mode: 'human-authored', regen: 'never',        probe: 'workbench',      path: `${DATA_DIR}/workbench/<feature>.json` },
  // ── 只增卷 ──
  { id: 'observe',   mode: 'append-only',    regen: 'never',        probe: 'observe',        path: `${DATA_DIR}/observe/` },
  // ── 派生卷（现算的，不是真相）──
  { id: 'self-writes',      mode: 'derived', regen: 'scan',         probe: 'self-writes.json',    path: `${DATA_DIR}/self-writes.json` },
  { id: 'observe-points',   mode: 'derived', regen: 'check',        probe: 'observe-points.json', path: `${DATA_DIR}/observe-points.json` },
  { id: 'gateway-stats',    mode: 'derived', regen: 'call',         probe: 'gateway.stats.json',  path: `${DATA_DIR}/gateway.stats.json` },
  // ══════════════════════════════════════════════════════════════════════════════
  // ★★★ 2026-10-31：**下面 4 卷是 `manifest:check` 当场抓出来的**（与 2026-10-13 那批同一种病：
  //   住在 `.agent-io/` 却既不在卷表、也不在 `NON_VOLUME_ENTRIES` ⇒ 读者永远不知道它们是什么）。
  //   逐条判过：**都有独立语义（谁写 / 会不会被覆盖 / 是不是真相），不是谁的边车**：
  //   · `plan/` —— `design_line action=plan` 的重写计划画布（改完即过期，可重算）；
  //   · `tasks.db` —— 任务卡库（**意图数据，丢了不可重建**；文本镜像 `tasks.jsonl` 见 NON_VOLUME 那条）；
  //   · `tools/` —— 下载来的工具二进制（`gofacts.exe`），删了能重下；
  //   · `scratch/` —— 人的草稿区（探针/备份的落脚处，**不参与任何判定**）。
  //   ★★★ 2026-11-02（subagent:canvas-db）：**`plan/` 卷已退役** —— 画布（重写计划）与它服务的卡同库，
  //      住 `tasks.db` 的 `plans` 表（主键 feature+card_id+file）。盘上不再有 `.agent-io/plan/`
  //      ⇒ 卷表里再留一条 `regenerable` 的 plan 行 = **声明一个不存在的目录**（卷表只声明、不放数据）。
  //      旧目录已归档到 `scratch/plan-migrated/`；"它曾经是什么"登记在 NON_VOLUME_ENTRIES。
  // ══════════════════════════════════════════════════════════════════════════════
  { id: 'tasks',     mode: 'human-authored', regen: 'never',        probe: 'tasks.db',       path: `${DATA_DIR}/tasks.db` },
  { id: 'tools',     mode: 'regenerable',    regen: 'download',     probe: 'tools',          path: `${DATA_DIR}/tools/` },
  { id: 'scratch',   mode: 'human-authored', regen: 'never',        probe: 'scratch',        path: `${DATA_DIR}/scratch/` },
];

/**
 * ★ `.agent-io/` 下**已知但不是卷**的条目（SQLite 边车 / 一次性产物 / 历史遗留）。
 * 判据：它**随某个卷一起生灭**、是**一次性命令产物**、或是**已退役载体的残留** ⇒ 没有独立语义，
 *   声明它只在制造噪音。
 * ★ 新条目按三档判：① 临时件/探针 ⇒ 移到 `.agent-io/scratch/<卡名>/`（**最可能**）② 某工具的一次性产物 ⇒ 改那个工具
 *   ③ 需要长期留的载体 ⇒ 进这里并写清「为什么不能放 scratch」。**不许把临时件登记成合法条目**（那会把这个门变成静音按钮）。
 * ★★ `why` 必须说清"它是什么 + 谁写的 + 为什么不算卷"：只写"临时文件"等于没登记
 *   （下一个人还是不知道该不该删它）。
 */
const NON_VOLUME_ENTRIES = [
  // ★★ 2026-11-08（VerifiedSnapshot）：**已验证状态基线**（`src/application/design/verified_snapshot.ts` 写它）。
  //   为什么不能放 scratch：scratch 按卡清理，而基线要**跨会话、跨卡**存活 —— 放那里等于每次都被清空，
  //   增量验证永远退化成"全跑"（并冒充成"没有基线"）。为什么不是"卷"：它不承载任何设计真相，
  //   只是**本机上一次真实验证的证据副本**（内容 = 文件指纹 + 证据 + 时点），删掉只损失"能省的那点算力"。
  //   ★ 登记它不等于放行：本门管的是"说得清来路"，这条的来路是 `writeVerifiedSnapshot()`，且写入是原子的（tmp → rename）。
  { name: 'verified-snapshot.json', why: 'VerifiedSnapshot 基线（本机证据副本，跨会话存活；删掉只会退化成全跑，不丢真相）' },
  { name: 'cache.db-shm', why: 'SQLite WAL 边车，随 cache.db 生灭' },
  { name: 'cache.db-wal', why: 'SQLite WAL 边车，随 cache.db 生灭' },
  // ★★ 2026-11-18（T-#ENGINE-AUDIT P0-A1）：tasks.db 并发档对齐后同样走 WAL（journal_mode=wal）——
  //   WAL 下**只读连接也会**建 -shm/-wal 边车（live_render.ts:30 本仓同款口径："那不是改数据"）。
  //   与 cache.db 边车同生灭；登记它≠放行，来路 = applyTasksDbConcurrencyProfile()。
  { name: 'tasks.db-shm', why: 'SQLite WAL 边车，随 tasks.db 生灭（A1 并发档对齐：不可重建库也拿崩溃安全）' },
  { name: 'tasks.db-wal', why: 'SQLite WAL 边车，随 tasks.db 生灭（A1 并发档对齐）' },
  // ★ 2026-11-02（subagent:plan-semantics）：**并行闸的锁**。它随一次变异测试生灭（内容 = 持锁进程 pid），
  //   但 `verify` 的「判据突变」门跑的时候它会短暂出现 ⇒ 并发的 `manifest:check` 会把
  //   「.agent-io/ 下有没人认领的条目：mutate.lock」判红（实测：装一个活锁后 manifest:check EXIT=1）。
  //   临时物也必须显式登记 —— 否则一次并行的 mutate 就能让「文档与事实」门假红。
  {
    name: 'mutate.lock',
    why: '★ **已退役的锁名**（R75 2026-11-05 起重活锁统一叫 `heavy.lock`，本文件不再有写者）—— 保留这行只为让磁盘上可能遗留的旧锁不把门判红；新代码不许再写它',
  },
  // ★★ R75（2026-11-05）：**重活排他锁**（`scripts/lib/heavy_lock.mjs`，verify / mutate / judge-all 共用一份）。
  //   与旧的 `mutate.lock` 同样道理：它随一次重活生灭（内容 = 持锁进程 pid + 谁在跑），
  //   但 `verify` 跑的整段时间里它在 ⇒ 并发的 `manifest:check` 会判「没人认领」而假红。
  //   ★ 登记它≠给它发免死牌：本门管的是"`.agent-io/` 下有没有说不清来路的东西"，而它来路明确。
  {
    name: 'heavy.lock',
    why: '`scripts/lib/heavy_lock.mjs` 的**重活排他锁**（内容 = 持锁进程 pid + 哪个脚本在跑），随一次 verify/mutate/judge-all 生灭；不是卷，登记它只为让它在跑着的时候不把 `manifest:check` 判红',
  },
  { name: 'MANIFEST.txt', why: '本声明自己（`--in-data-dir` 时才落这里）' },
  // ── 同一卷的文本镜像 / 已退役载体 ──
  { name: 'tasks.jsonl', why: '`tasks` 卷的**文本镜像**（`roots.ts` 的 `carrier`：二进制 .db 不进 git，可 diff 的那份就是它）—— 与 `tasks.db` 同生共死，不是第二处权威' },
  { name: 'task-history.jsonl', why: '**已退役载体**（`roots.ts`：`task-history.jsonl` 已无写者，历史已并入 `tasks.db` 的 `task_history` 表）；0 字节残留，可删' },
  { name: 'plan', why: '**已退役载体**（`roots.ts`：`plan` 角色已删；重写计划/画布已入 `tasks.db` 的 `plans` 表，主键 feature+card_id+file）；旧目录已归档到 `scratch/plan-migrated/`，`plan/` 本身可删' },
  // ── 一次性命令产物（重跑就重生成，不是真相）──
  { name: 'judge-cache.json', why: '`scripts/judge-all.mjs` 的结果缓存，随其运行生灭' },
  // ★★ 2026-11-05（R74）：工具链完整性检查的**上一次**指纹。
  //   ★ 为什么**不**进 scratch（本门第①条通常会这么建议）：它的全部用途是**与「上次」对比** ——
  //     放 scratch 且 scratch 被清 ⇒ 下次没有基线 ⇒ 比对退化成"只报告不比对"（实测：首次跑就是
  //     「没有上次记录 ⇒ 本次只报告，不比对」）⇒ **检测点静默失效**。
  //   ★ 为什么也**不**进卷表：它不是任何卷的投影；删了只丢"上次长什么样"，不丢任何事实。
  //   ★ 它只供**报告**（只报不判红）；判红的是同一脚本里「关键包能否解析」那条断言，**不依赖这个文件**。
  {
    name: 'toolchain-fingerprint.json',
    why: '`scripts/check-toolchain-intact.mjs --record` 落的**上一次** node_modules 指纹（顶层目录名 + mtime + 符号链接目标）；唯一用途是与"上次"对比 ⇒ 必须跨次存活，不能放 scratch',
  },
  // ★ 2026-11-03（M1a）：判定闸的 **per-kind 读数**（每个 kind 判过多少条 = pass+fail）。
  //   它是 `gen-db-check` 的「judge判过」列的输入 ⇒ 有消费者，但**仍不是卷**：judge-all 每次跑完覆盖写，
  //   删了只是"这一列不可算"（门会把原因印出来），不会丢事实。
  {
    name: 'judge-readings.json',
    why: '`scripts/judge-all.mjs` 落的 per-kind 判定读数（pass+fail / unsupported / pending），随每次运行覆盖写；`scripts/gen-db-check.mjs` 的「judge判过」列读它，缺失或比册旧就印「不可算」而不判红',
  },
  // ★★ 2026-11-25（#92 观察期台账）：cron 周期参考运行的 append-only 记录。
  //   为什么不能放 scratch：观察期窗口（evaluateObservationWindow）要读**全部历史**记录数连续零洞，
  //   scratch 按卡清理会丢积累 ⇒ 观察期退化成"刚起跑"。为什么不是"卷"：它不承载任何设计真相，
  //   只是周期对照读数的历史载体，删掉只损失历史趋势与观察期计数，不丢源码/设计事实。
  //   ★ 跟踪态：沿用 .agent-io/* gitignore（派生不入库），与 judge-readings.json 同为有意跟踪的轻量台账口径；
  //      本门管的是"说得清来路"，登记它≠给它发免死牌。
  {
    name: 'ablation-runs.jsonl',
    why: '`scripts/ablation-cron.mjs` 落的跨 run 观察期台账（append-only：每条 selection/holes/full_red/skipped/影子覆盖读数），`evaluateObservationWindow` 读全部历史数连续零洞；观察期需跨次存活 ⇒ 不能放 scratch；不是卷，删掉只损失历史趋势与观察期计数',
  },
  { name: 'hook', why: 'hook 的**去重状态**目录（`hook-seen-nosession.json`：哪些会话的 hook 已经跑过），随 hook 运行生灭' },
  { name: 'baseline-replay.json', why: '`AGENT_IO_REPLAY_ONLY` 回放的读数，随该轮运行生灭' },
  { name: 'regen-report.json', why: '`scripts/regen-translate.mjs` 的读数（0.8 节：变差就靠它非零退出），随该轮运行生灭' },
  { name: 'contract-audit.json', why: '`npm run contract:calls` 的一次性诊断产物，随该次运行生灭' },
  { name: 'field-ledger.json', why: '字段账探针（`probe:extract` 线）的一次性产物，随该次运行生灭' },
  { name: 'extractor-divergences.json', why: 'extractor 分叉账探针的一次性产物，随该次运行生灭' },
  { name: 'signature-divergences.json', why: '签名分叉账探针的一次性产物，随该次运行生灭' },
  // ── 历史备份 / 日志（**可删**，登记它们是为了让下一个人知道"这不是卷"）──
  { name: 'cache.db.bak-before-retry-failed', why: '重建索引前的**手工备份**（retry-failed 那一轮）；不是卷，删了不影响任何口径' },
  { name: 'cache.db.bak-before-t45', why: '重建索引前的**手工备份**（t45 那一轮）；同上' },
  { name: 'cache.db.bak-before-t45-shm', why: '上面那份备份的 SQLite WAL 边车；同上' },
  { name: 'cache.db.bak-before-t45-wal', why: '上面那份备份的 SQLite WAL 边车；同上' },
  { name: 'certs-after.log', why: '`certs/` 退役（2026-10-31）时那轮跑的命令输出；**一次性日志**，内容已被 `docs/RETIRED.md` 收走' },
  { name: 'certs-before.log', why: '同上（退役前的基线输出）' },
  { name: 'certs-before-snapshot.log', why: '同上（退役前快照的输出）' },
  { name: 'judge-out.txt', why: '某次 `judge-all` 的完整输出（截断前的原文）；一次性日志' },
  { name: 'tsc-product.log', why: '某次全仓 tsc 的输出（双棘轮读数取证用）；一次性日志' },
  { name: 'verify-after.log', why: '某次 `verify` 的输出；一次性日志' },
  { name: 'observe-backup', why: '**一次性备份目录**（装着已退役 `certs/` 的副本）；不是卷，删它不影响任何口径' },
  { name: '.agent-io', why: '**误建的嵌套数据目录**（`AGENT_IO_HOME` 指到 `.agent-io` 本身时生成的）；不是卷，可删' },
];

/** ★ 草案配额（T69 会把它变成单点常量 + L1 双边执行；本轮只**声明**它，不执行）。 */
const QUOTA = 'F<=200 R<=300 A<=300 S<=600';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const projectDir = path.resolve(valOf('--project') ?? process.cwd());
const dataDir = path.join(projectDir, DATA_DIR);
/** ★ 声明文件落点：**默认仓根**（`--in-data-dir` 改回数据目录）。只在这里算一次。 */
const manifestPath = path.join(flag('--in-data-dir') ? dataDir : projectDir, MANIFEST_NAME);

export function renderManifest() {
  const lines = [
    '#AgentIO-MANIFEST: 1',
    `#Format-Version: ${FORMAT_VERSION}`,
    '#',
    '# 本文件**只声明，不放数据**（数据仍在各自路径），也**不记运行态**（哪一卷现在有没有，由 --check 现算）。',
    '# 它回答四个问题：哪几卷 · 谁是真相 · 谁能改（mode） · 谁会被重新生成（regen）',
    '# ★ mode：readonly=只读 | regenerable=**会被重新生成**（别把决策写这儿）',
    '#         human-authored=人写的**永不被覆盖** | append-only=只增 | derived=现算的，不是真相',
    '# ★ secret=该卷可能含凭据（别提交、别外传）',
    '#',
  ];
  for (const v of VOLUMES) {
    lines.push(
      `#Volume: id=${v.id.padEnd(9)} mode=${v.mode.padEnd(14)} regen=${v.regen.padEnd(12)} ` +
        `path=${v.path}${v.secret ? ' secret=true' : ''}`,
    );
  }
  lines.push(
    '#',
    `#Quota: ${QUOTA}`,
    '#Admission: L1-L4（见 src/application/observe/reconcile/reason_validator.ts）—— ★ 我们已有的写入闸，不是新造的',
    '#Derived-From: 本文件由 scripts/gen_manifest.mjs 依卷表生成；`npm run manifest:check` 可对账',
    '',
  );
  return lines.join('\n');
}

/**
 * `--check`：**两方向**对账（只报差异，不改盘）。
 *   ① 文件里声明的 id ⊆ 卷表（多出来的 id ⇒ 文件被手改过）；
 *   ② 卷表里的 id ⊆ 文件（漏 ⇒ 加了卷没重新生成）；
 *   ③ `.agent-io/` 下出现的条目，**每条都得有人认领**（是某卷的 probe，或在 `NON_VOLUME_ENTRIES` 里）。
 *      ★ 第 ③ 条是**这条纪律真正的工作面** —— 本轮它当场抓出 4 个未声明条目（含含密钥的 `gateway.json`）。
 */
export function checkManifest() {
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, why: `MANIFEST.txt 不存在（${manifestPath}）⇒ 先跑一次生成`, extra: [], missing: [], unclaimed: [] };
  }
  const onDisk = fs.readFileSync(manifestPath, 'utf8');
  const declared = new Set([...onDisk.matchAll(/^#Volume: id=(\S+)/gm)].map((m) => m[1]));
  const expected = new Set(VOLUMES.map((v) => v.id));
  const extra = [...declared].filter((id) => !expected.has(id));   // ①
  const missing = [...expected].filter((id) => !declared.has(id)); // ②

  const probes = new Set(VOLUMES.map((v) => v.probe));
  const known = new Set(NON_VOLUME_ENTRIES.map((e) => e.name));
  const unclaimed = []; // ③
  if (fs.existsSync(dataDir)) {
    for (const name of fs.readdirSync(dataDir)) {
      if (probes.has(name) || known.has(name)) continue;
      unclaimed.push(name);
    }
  }
  const ok = extra.length + missing.length + unclaimed.length === 0;
  return { ok, why: ok ? '一致' : '声明与磁盘不一致', extra, missing, unclaimed };
}

const rendered = renderManifest();

if (flag('--stdout')) {
  process.stdout.write(rendered);
  process.exit(0);
}

if (flag('--check')) {
  const r = checkManifest();
  console.log(`对账：${r.why}`);
  if (r.extra.length) console.log(`  ★ 文件里声明了、卷表里没有：${r.extra.join(', ')}（文件被手改过？）`);
  if (r.missing.length) console.log(`  ★ 卷表里有、文件里没写：${r.missing.join(', ')}（加了卷没重新生成？）`);
  if (r.unclaimed.length) console.log(`  ★ .agent-io/ 下有没人认领的条目：${r.unclaimed.join(', ')}` +
    `\n      ⇒ 按这个顺序判（**最可能是 ①**）：` +
      `\n         ① 临时件 / 探针 / 中间产物 ⇒ **移到 .agent-io/scratch/<你的卡名>/**（scratch 被 gitignore，不撞门）` +
      `\n         ② 某个工具的一次性产物 ⇒ **改那个工具**让它写进 scratch，不要在这里登记它` +
      `\n         ③ 需要长期留的载体（库 / 文本镜像 / 边车） ⇒ 进 NON_VOLUME_ENTRIES 并写清「为什么不能放 scratch」` +
      `\n      ⇒ **不许默默多出来，也不许把临时件登记成合法条目**（那会把这个门变成静音按钮）`);
  console.log(r.ok ? '✅ MANIFEST 与卷表一致' : '❌ MANIFEST 与卷表不一致（不静默）');
  process.exit(r.ok ? 0 : 1);
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, rendered, 'utf8');
console.log(`已写出 ${manifestPath}（${rendered.length} 字符 / ${rendered.split('\n').length - 1} 行 / ${VOLUMES.length} 卷）`);
