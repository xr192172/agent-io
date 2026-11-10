/**
 * rewrite_plan.ts —— **重写计划（画布）** 的读写口：`<proj>/.agent-io/plan/<rel>.plan.json`。
 *
 * ## 它是什么（一段话）
 * 写源码前必须"通读设计指向的区域 → 选定范围 → 写完细节"。那些**选择与细节**就落在这里，
 * 一条 entry = 一处改动。**它替代的是"agent 脑子里的计划"** —— 上下文一压缩就没了的东西。
 *
 * ## 为什么它必须入库、且与底片分家
 * · `design-db/<rel>.calls.json`（**底片**）= 从 `cache.db` 派生的**事实**，整目录被 gitignore；
 * · 本文件的计划是**意图**（人/模型写、算不出来）⇒ 必须进 git，否则换机/clean 就丢。
 *   ⇒ 两个文件、两个家，各自一条判据（`t378` 管同构、`t379` 管这份计划不被生成器吃掉）。
 *
 * ## 纪律
 * · **生成器永不写它**（`gen_design_db` 只读不写）；
 * · 写盘用 `temp + rename`（半份计划比没有计划更坏）；
 * · `status:'stale'` = 锚点在当前代码里对不上（**只标不删**，等人看）；
 * · 空计划 = 没有计划（不是"计划为空"）：闸按"必须有 entries"判。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
// ★★★ 2026-11-02（subagent:canvas-db）：画布住 `tasks.db#plans` —— 与它服务的卡**同一个库**。
//   · 开库/建表的**唯一入口**是 `task_history.ts#openTasksDb`（表结构只写在它的 `TASKS_SCHEMA_SQL`）；
//   · 「一个根下有哪些 feature」只问 `project_registry.ts#featuresOfRoot`（注册表是权威）。
import { getTasksDbFile, openTasksDb } from '../../../infrastructure/task_history.js';
// ★ 三侧面读数（{@link readJudgementFacets}）只**消费**这两个 domain 权威：一行渲染与前/后态都不在本文件重造
//   （本文件只贡献 `strengthOfKind` 那一个侧面 —— 强度分类的唯一实现就在这里）
import { describeExpectation, expectationPhase, type Expectation } from '../../../domain/expectation.js';
import type { Verdict } from '../../../domain/judge_port.js';
import { featuresOfRoot } from '../../../infrastructure/project_registry.js';
import { isSameProject, listDesignSheets } from '../../../infrastructure/storage.js';

/** 一处改动的意图 */
export interface RewritePlanEntry {
  /**
   * 锚点：**只用符号名**（`cache.db` 的 `nodes.name`）。
   * ★ 不用行号：任何一次插入都会让它整体漂移（`sym_hash` 才是"这段变没变"的判据）。
   */
  anchor: { symbol: string };
  /** rewrite = 改现有符号；create = 新建（骨架还没生成）；delete = 删除 */
  kind: 'rewrite' | 'create' | 'delete';
  /** 要改成什么样（一句话，够下一个 agent 接着写） */
  detail: string;
  /** ★ 必填：拿什么验（证/判据引用）。说不出怎么验的细节 = 没写完 */
  judgement_ref: string;
  /** open = 待做；stale = 锚点对不上（只标不删）；done = 源码已到位且判据转绿 */
  status: 'open' | 'stale' | 'done';
  /**
   * ★ 2026-10-28（试点读数 #2）：`judgement_ref` 是 `cert:` 形态时**必填** —— 证里的检查号不登记种类，
   * 不声明就判不出强度。取值必须在已知分类里（`strengthOfKind` 认识的种类），**不许自造**。
   * `decision:` 形态**忽略**它（种类从册里现读，不给人自报的机会）。
   */
  judgement_kind?: string;
  /**
   * ★★★ 2026-10-28（迭代 ⑤）：**这条改动依赖哪些符号先落地**（写的是 `anchor.symbol`）。
   *
   * ## 为什么需要它（用户："设计阶段就了解一个功能的整条路线"）
   * 结构化重写是**有序**的：改签名 → 改调用方 → 改测试。没有这一格，"路线"只能待在模型脑子里，
   * 而脑子会被上下文压缩（今晚实测两次）。有了它，顺序变成**可判**的（见 `planDependencyGaps`）。
   * ★ **不引入 `order` 字段**：拓扑序可由 `depends_on` **派生**（`planTopoOrder`）——
   *   同时存 `order` 与 `depends_on` 就是"两处权威"，必然打架（本仓头号病）。
   */
  depends_on?: string[];
  /** ★ 2026-10-28：落地时刻（`open → done` 自动推进时记；有它才能回看"什么时候做完的"） */
  done_at?: string;
  /** 行号只作注记，**不参与判定** */
  note?: string;
}

/** 一个路径的整份画布 */
export interface RewritePlan {
  /** 源码仓库相对路径（posix），与底片的 `path` 一一对应 */
  path: string;
  /** 冻结时刻（这一刻起本块权威 = 本文件；`gen-db` 只报 drift 不覆盖） */
  frozen_at?: string;
  /** 冻结那一刻的底片指纹（用文件内容哈希，便于判"底片换没换"） */
  base?: { content_hash?: string };
  entries: RewritePlanEntry[];
  /**
   * ★★★ 2026-10-28（用户："模型喜欢补丁式修改，这套流程应该强迫全貌浏览"）：
   * **该文件里"我看过、但不动"的符号** —— 每个符号要么在 `entries`（要改），要么在这里（不动 + 为什么）。
   *
   * ## 为什么要它
   * 只有 `entries` 的话，"计划里只列 1 个符号、也只改这 1 个符号"是**完全合规的补丁式修改** ——
   * 全貌浏览仍然靠自觉。加了这一格，"通读"才有了**可判形态**：漏掉的符号会以"**未表态**"被抓出来。
   * ★ 判据不住这里（这里是形状）：判定在 `planCoverageGaps`。
   */
  untouched?: Array<{ symbol: string; why: string }>;
  /**
   * ★★★ 2026-10-28（真实开发试点读数 #1）：**"其余都不动"的紧凑声明** ——
   * 一个 18 个顶层符号的文件、只改 1 处，逐条写 18 个 `untouched` 手工不现实（我是脚本生成的）。
   *
   * ## 为什么它没有把"通读"变松
   * 用了它就必须同时记 `symbols_at_freeze`（冻结那一刻的符号全集）。**快照之后出现的符号**不在里面
   * ⇒ 判据仍会报"有新符号 ⇒ 重新通读并重新冻结"。⇒ 紧凑只省**打字**，不省**理解**。
   */
  /**
   * ★★★ 2026-10-28（用户："任务卡应该挂在**画布**和**探索后的改集**上"）：
   * **这张画布属于哪张任务卡**。一个任务天然跨文件 ⇒ 一张卡可以有**多份**画布，
   * 卡的改集 = 这些画布**坍缩集的并集**（见 `planChangeSetOfCard`）。
   * ★ 只认这个显式字段来归属 —— **不按目录/文件名猜**（路径前缀判据是本仓头号病根）。
   */
  card?: string;
  untouched_default?: { why: string };
  /** 冻结那一刻的**顶层符号全集**（`untouched_default` 的牙齿：新符号不在其中就会被抓） */
  symbols_at_freeze?: string[];
  /**
   * ★★★ 2026-10-28（用户："设计期按理来说是**权威**，如果设计期设计的有问题才会出现这种情况"）：
   * 冻结那一刻**每个顶层符号的 body_hash**。有了它，"实际改动超出画布"才**算得出来**（而不是一句口号）：
   * 改完之后某符号的 body_hash ≠ 这里的值、又不在 `entries` 里 ⇒ **设计漏了这一处**。
   *
   * ★ 为什么必须记在画布上：设计期权威的前提是**设计期的样子留得住**；
   *   只记名字（`symbols_at_freeze`）只知道"当时有哪些符号"，不知道"当时它们长什么样"。
   */
  fps_at_freeze?: Record<string, string>;
}

/**
 * ★★★ 2026-11-02（subagent:canvas-db）：**盘上那份画布路径已退役** ——
 * `planDir` / `planFileFor` 已删（画布住 `tasks.db#plans`，唯一读写口是本文件上面那几个函数）。
 * 旧路径 `.agent-io/plan/<rel>.plan.json` 已全部迁入库并归档到 `.agent-io/scratch/plan-migrated/`。
 */

/** 某个源码路径的计划文件：`<planDir>/<rel>.plan.json` —— ★ 本函数与 `planDir` 已退役（画布入库，见上） */


/** 一行画布（`plans` 表）。★ 列名即事实：**没有 status 列** —— 卡的活/关由 `live_cards` ∪ `task_history` 决定 */
interface PlanRow {
  feature: string;
  card_id: string;
  file: string;
  entries_json: string;
  untouched_json: string | null;
  untouched_default_json: string | null;
  symbols_at_freeze_json: string | null;
  fps_json: string | null;
  base_hash: string | null;
  frozen_at: string | null;
  created_at: string;
  updated_at: string;
}

const PLAN_COLS =
  'feature, card_id, file, entries_json, untouched_json, untouched_default_json, symbols_at_freeze_json, fps_json, base_hash, frozen_at, created_at, updated_at';

/** 仓库相对口径（与底片 `path` 同一把尺：posix + 去前导斜杠） */
function posixRel(p: string): string {
  return String(p ?? '')
    .split(path.sep)
    .join('/')
    .replace(/^\/+/, '');
}

/** `undefined` 与非 `undefined` 必须分开记：`JSON.stringify(undefined)` 不是字符串 */
function jsonOrNull(v: unknown): string | null {
  return v === undefined ? null : JSON.stringify(v);
}

/** 行 ⇒ 画布（★ 键序固定：旧盘上那份 `JSON.stringify(plan, null, 2)` 可逐字节对账） */
function planOfRow(row: PlanRow): RewritePlan {
  const plan: RewritePlan = { path: row.file, entries: JSON.parse(row.entries_json) as RewritePlanEntry[] };
  if (row.untouched_json) plan.untouched = JSON.parse(row.untouched_json) as RewritePlan['untouched'];
  if (row.card_id) plan.card = row.card_id;
  if (row.untouched_default_json) plan.untouched_default = JSON.parse(row.untouched_default_json) as RewritePlan['untouched_default'];
  if (row.symbols_at_freeze_json) plan.symbols_at_freeze = JSON.parse(row.symbols_at_freeze_json) as string[];
  if (row.fps_json) plan.fps_at_freeze = JSON.parse(row.fps_json) as Record<string, string>;
  if (row.frozen_at) plan.frozen_at = row.frozen_at;
  if (row.base_hash) plan.base = { content_hash: row.base_hash };
  return plan;
}

/**
 * 读端开库（★ 只读、**不建库**、不替谁 `mkdirSync`）。
 * 判据（0.12：读不到 与 没有 必须可区分）：
 * · 库文件不在 / 表还没建 ⇒ `null` = **真的没有画布**（不是读失败）；
 * · 库在但打不开 ⇒ **抛**（坏库、被锁 与「没有画布」同形，静默回 null 就是把闸关掉）。
 */
function openPlansForRead(projectRoot: string): DatabaseSync | null {
  const file = getTasksDbFile(projectRoot);
  if (!fs.existsSync(file)) return null;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (e) {
    throw new Error(
      `画布库打不开（这是「读失败」，不是「没有画布」）：${file}\n  · ${(e as Error).message}\n` +
        `  ⇒ 处置：修复/挪走它后重试（它由 task_history.ts#openTasksDb 用 TASKS_SCHEMA_SQL 建）。`,
    );
  }
  const t = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plans'")
    .get() as { name?: string } | undefined;
  if (!t?.name) {
    db.close();
    return null;
  }
  return db;
}

/**
 * ★★★ 2026-11-05（R24 · `docs/todo.md`）：「**这一行还是画布吗**」的读端谓词（**唯一住处**）。
 *
 * ## 它治的病（同一家族第八个实例：一枚读数在正常状态下给错信号）
 * `dissolved_at` 记的是「这一段已经落地」⇒ 它**不该再参与下一轮的并发保护**。
 * 而只按 `card_id` 取的 SELECT 若不带这个过滤，已消解的画布照样进「这张卡的改集」⇒ 领卡时与别人
 * **假相交**，唯一出路是 `supersedes` 带异议、逐条重述对端判据（R12①② 实测两次：13 / 7 条）。
 * ⇒ 过滤只许写在**本函数**里（0.20：这个事实的权威住这里），别处不许再拼一份。
 *
 * ## 判据（双向，缺一不算 —— 0.14）
 * · 已消解的行 ⇒ **不再出现**在「这张卡要碰什么」的读集里；
 * · **未消解**的行 ⇒ **照旧出现**（一并滤掉就是**漏判** —— 那比假阻塞更坏）。
 *
 * ## 失效边界（0.9.1③）：老库可能**没有这一列**（`openPlansForRead` 是只读连接，跑不了迁移）
 * ⇒ 列不在时**不过滤**。这是真话（列不在 = 一条都不可能已消解），不是回落成「全未消解」而不吭声
 * —— 与 `orphanPlans` 用 `NULL AS dissolved_at` 是同一把尺。
 *
 * ## 谁**故意**不用它（逐处申报，不是遗漏）
 * · `resolvePlanFeature` / `cardsOfFile`：问的是**归属**（消解后归属照样成立）；
 * · `prunePlans` / `dissolvePlans` / `orphanPlans`：问的是**分母与账**（滤掉连「有几份」都看不见）。
 */
function aliveOnlyClause(db: DatabaseSync): string {
  return hasDissolveColumns(db) ? ' AND dissolved_at IS NULL' : '';
}

/**
 * 这份画布归哪本册（★ 只在写**新行**时问；已有行一律沿用 —— 归属不许每次重算漂移）。
 * 顺序：① 已有行 ② `live_cards.feature`（它就记着这张卡属于哪本册）③ 册里有这张卡 ④ 根只登记了一本册。
 */
function resolvePlanFeature(root: string, db: DatabaseSync, cardId: string, rel: string): string {
  const same = db.prepare('SELECT feature FROM plans WHERE card_id = ? AND file = ? ORDER BY feature').all(cardId, rel) as Array<{
    feature: string;
  }>;
  if (same.length) return same[0].feature;
  if (cardId) {
    const live = db.prepare('SELECT feature FROM live_cards WHERE id = ? ORDER BY feature').all(cardId) as Array<{ feature: string }>;
    if (live.length) return live[0].feature;
    const owned = featuresOwningCard(root, cardId);
    if (owned.length) return owned[0];
  }
  const feats = featuresOfRoot(root);
  if (feats.length) return feats[0];
  return ''; // 这个根还没登记任何 feature ⇒ **未归属**（'' 不等于"随便归给谁"）
}

/** 册里含这张卡（`todos[]` 或 `geometry.nodes[]`）且册住在本项目 ⇒ 它的 feature（排序去重） */
function featuresOwningCard(projectRoot: string, cardId: string): string[] {
  const out: string[] = [];
  try {
    for (const d of listDesignSheets()) {
      if (!isSameProject(d, projectRoot)) continue;
      const shape = d as unknown as { geometry?: { nodes?: Array<{ id?: string }> }; todos?: Array<{ id?: string }> };
      const nodes = shape.geometry?.nodes ?? [];
      const todos = shape.todos ?? [];
      if (todos.some((t) => t?.id === cardId) || nodes.some((n) => n?.id === cardId)) out.push(d.feature);
    }
  } catch (e) {
    // 读册失败 ⇒ 归属判不出：**出声**（不静默），再按"根唯一册"口径继续（读端不按 feature 收口 ⇒ 行为等价）
    process.stderr.write(`[rewrite_plan] 读设计册失败（判画布归属用）：${(e as Error).message} ⇒ 退回"按根唯一册"口径\n`);
  }
  return [...new Set(out)].sort();
}

/**
 * 读计划（没有就 null —— **不造假计划**）。
 * @param cardId 可选：指定"哪张卡的画布"。不给 ⇒ 该文件那份；同文件多卡多份时取**最近被推进**的一份
 *   （`updated_at` 是画布自己记的，不是文件系统 mtime），归属由返回值 `plan.card` 带出 ——
 *   两份都留在库里，**谁也没被覆盖**。
 */
export function readRewritePlan(
  projectRoot: string,
  relPath: string,
  cardId?: string,
  /**
   * ★ 2026-11-05（R24）：`aliveOnly:true` ⇒ **只认仍在册的画布**（已软消解的不算）。
   * ★ 缺省 `false` 是**有意**的：写闸 `planGate` / 出口对账 / `action=plan` 回放都要能看见
   *   「那一份已经落地的画布」（它们问的是「我该怎么写」「当初想干什么」，不是「谁在占位」）。
   * ★ 只有**领卡读集**（`claim_conflict#computeClaimReadSet` 的节点兜底腿）该传 true ——
   *   那里的问题才是「它还算占位吗」。过滤谓词只住 `aliveOnlyClause`，本函数不另写一份。
   */
  opts?: { aliveOnly?: boolean },
): RewritePlan | null {
  const rel = posixRel(relPath);
  if (!rel) return null;
  const db = openPlansForRead(path.resolve(projectRoot));
  if (!db) return null;
  try {
    // ★ R24：只有**明确问「它还占位吗」**的调用方才带 `aliveOnly`（见参数说明）——
    //   缺省不过滤，否则写闸/对账/回放会看不见「已落地的那一份」。
    const alive = opts?.aliveOnly === true ? aliveOnlyClause(db) : '';
    const rows = (
      cardId
        ? db.prepare(`SELECT ${PLAN_COLS} FROM plans WHERE file = ? AND card_id = ?${alive}`).all(rel, cardId)
        : db.prepare(`SELECT ${PLAN_COLS} FROM plans WHERE file = ?${alive}`).all(rel)
    ) as unknown as PlanRow[];
    if (!rows.length) return null;
    if (rows.length === 1) return planOfRow(rows[0]);
    const sorted = [...rows].sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.card_id <= b.card_id ? -1 : 1,
    );
    return planOfRow(sorted[0]);
  } finally {
    db.close();
  }
}

/**
 * 写计划（**upsert**）。
 * ★ 为什么必须 upsert：`write_gate#finishWriteThrough` 每次源码写完都把 `base_hash` / `fps_at_freeze`
 *   挪到写后 ⇒ 同一 (卡,文件) 一次任务里被重写几十次；append 会把它写成几十行。
 */
export function writeRewritePlan(projectRoot: string, plan: RewritePlan): string {
  const root = path.resolve(projectRoot);
  const rel = posixRel(plan.path);
  if (!rel) throw new Error('writeRewritePlan 需要 `plan.path`（源码仓库相对路径）');
  const cardId = (plan.card ?? '').trim();
  const db = openTasksDb(root);
  try {
    const feature = resolvePlanFeature(root, db, cardId, rel);
    const now = new Date().toISOString();
    const prev = db.prepare('SELECT created_at FROM plans WHERE feature = ? AND card_id = ? AND file = ?').get(feature, cardId, rel) as
      | { created_at: string }
      | undefined;
    db.prepare(
      // ★★★ 复活（软消解的**另一半**）：某个 **file** 重新被冻结 ⇒ 它重新成为画布 ⇒ 消解标记必须失效。
      //   语义出自用户模型「被编辑的**那一块**就是画布」⇒ 粒度是 **file**，不是卡：
      //   冲突键本来就是 (feature, card_id, file) ⇒ 同一张卡名下其它文件的画布**一行都不碰**。
      //   ★ 不写成 `UPDATE plans SET dissolved_at = NULL`（那会无条件复活全库）—— 只在**被写的那一行**上清。
      `INSERT INTO plans (${PLAN_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(feature, card_id, file) DO UPDATE SET
         entries_json = excluded.entries_json,
         untouched_json = excluded.untouched_json,
         untouched_default_json = excluded.untouched_default_json,
         symbols_at_freeze_json = excluded.symbols_at_freeze_json,
         fps_json = excluded.fps_json,
         base_hash = excluded.base_hash,
         frozen_at = excluded.frozen_at,
         updated_at = excluded.updated_at,
         dissolved_at = NULL,
         dissolve_reason = NULL`,
    ).run(
      feature,
      cardId,
      rel,
      JSON.stringify(plan.entries ?? []),
      jsonOrNull(plan.untouched),
      jsonOrNull(plan.untouched_default),
      jsonOrNull(plan.symbols_at_freeze),
      jsonOrNull(plan.fps_at_freeze),
      plan.base?.content_hash ?? null,
      plan.frozen_at ?? null,
      prev?.created_at ?? now,
      now,
    );
    return `${getTasksDbFile(root)}#plans[${feature || '(未登记册)'}|${cardId || '(未归属)'}|${rel}]`;
  } finally {
    db.close();
  }
}

/**
 * 计划**是否够格放行写源码**（准入闸的唯一判据；`t379` 就是打它的证）。
 * @returns 不合格的原因（空数组 = 合格）
 */
export function planGaps(plan: RewritePlan | null): string[] {
  // ★ E-PLAN-001 的 `where.messageStartsWith: '没有重写计划'` 依赖本句前缀 —— **逐字不许改**
  if (!plan) return ['没有重写计划（`tasks.db#plans` 里没有这个文件的画布）⇒ 先通读 + 选范围 + 写细节'];
  const gaps: string[] = [];
  if (!plan.entries.length) gaps.push('计划里 0 条改动 ⇒ 先说明要改哪个符号、改成什么');
  for (const e of plan.entries) {
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    if (!e.anchor?.symbol) gaps.push(`${who} —— 缺锚点（只用符号名，别用行号）`);
    if (!e.detail?.trim()) gaps.push(`${who} —— 缺 detail（要改成什么样）`);
    if (!e.judgement_ref?.trim()) gaps.push(`${who} —— 缺 judgement_ref（拿什么验）`);
    if (e.status === 'stale') gaps.push(`${who} —— 锚点已过期（stale）⇒ 先核对再改`);
  }
  return gaps;
}
/**
 * ★★★ 2026-10-28（迭代 ③）：**"通读"的可判形态** —— 该文件的符号是否**逐个表过态**。
 *
 * 判据：文件名里的符号（实际 DB 的 `nodes`，排除 `kind='file'`）**每一个**必须满足其一：
 *   ① 在 `entries[].anchor.symbol` 里（要改）；② 在 `untouched[].symbol` 里（不动 + 有理由）。
 * 两者都没有 ⇒ **未表态** ⇒ 出一条 `E-PLAN-010`。
 *
 * ★ 为什么这是"强迫全貌"的那一格：没有它，模型可以只列 1 个符号改 1 个符号，
 *   全程合规，而**文件里其他 20 个符号它根本没看**。有了它，"没看"会变成一条可见的缺口。
 * ★ 纯函数（符号清单由调用方从实际 DB 取）：这样判据可单测，且不把 `cache.db` 依赖塞进本模块。
 *
 * ★★★ 2026-11-05（R12② · **档位化**）：返回**档位数据**，不再返回文案。
 *
 * ## 它修的是什么（`.includes()` 那个实现）
 * 改前调用方用 `gaps.filter((g) => !covGaps.includes(g))` 把这一族缺口从 blocking 里**按字符串内容**
 * 筛掉（0.18① 违例：结构判据不许用文本比内容）⇒ 改一个标点就静默改档位；实测后果是
 * `E-PLAN-008/009/010` 整族**只进 warnings、从不拦落盘**（注释本意只放行"索引读不到"那一条）。
 * ⇒ 现在档位是**数据**（`tag` + `tier`），文案只是 {@link renderCoverageGap} 的产物；
 *   调用方读 `tier`，**不再读字符串**。
 *
 * ## 档位表（★ 唯一住处 = {@link PLAN_COVERAGE_TIER}；三个读者都从那里读，不许各自再判一遍）
 * | tag | tier | 为什么 |
 * |---|---|---|
 * | `E-PLAN-008`（compact 无快照） | `blocking` | 只有手改库才撞（成本 ≈ 0）；无凭据就判不出"冻结之后新增了哪些符号" |
 * | `E-PLAN-009`（冻结后新符号） | `info` | **每次加顶层函数都会亮**（`symbols_at_freeze` 不随写穿刷新 —— 那是 R12③ 的派生欠账）⇒ 它说的是"画布该重新冻结"，不是"这份计划不成立" |
 * | `E-PLAN-010`（符号没表态） | `blocking` | 真·通读判据：没表态的符号会被悄悄改坏 |
 * | `index-unavailable`（索引读不到） | `info` | **唯一授权例外**：它说的是"A7 这一格这次没生效"，不是"这份计划不合格"（当拦理由 = 任何还没建索引的项目都写不了源码） |
 */
export type PlanCoverageTag = 'E-PLAN-008' | 'E-PLAN-009' | 'E-PLAN-010' | 'index-unavailable';

/** 一条覆盖缺口：**档位是数据**（`tag` + `tier`），文案由 {@link renderCoverageGap} 渲染 */
export interface PlanCoverageGap {
  tag: PlanCoverageTag;
  tier: 'info' | 'blocking';
  /** 冻结之后才出现的符号（`E-PLAN-009` 用；其余为空数组） */
  fresh: string[];
  /** 没表态的符号（`E-PLAN-010` 用；其余为空数组） */
  silent: string[];
  /** 读索引失败的原因（`index-unavailable` 用；其余为空串） */
  reason: string;
}

/** 档位表（★ 唯一住处：`E-PLAN-008` / `E-PLAN-010` 拦落盘，`E-PLAN-009` / `index-unavailable` 只点名） */
export const PLAN_COVERAGE_TIER: Readonly<Record<PlanCoverageTag, 'info' | 'blocking'>> = {
  'index-unavailable': 'info',
  'E-PLAN-008': 'blocking',
  'E-PLAN-009': 'info',
  'E-PLAN-010': 'blocking',
};

/** 造一条缺口（tier 从 {@link PLAN_COVERAGE_TIER} 取 —— 不在这里再写一份档位） */
function coverageGapOf(tag: PlanCoverageTag, extra: Partial<PlanCoverageGap> = {}): PlanCoverageGap {
  return { tag, tier: PLAN_COVERAGE_TIER[tag], fresh: [], silent: [], reason: '', ...extra };
}

/**
 * 覆盖缺口的**分类核**（纯函数：只吃画布 + 符号清单，不读盘、不判"读不到"）。
 * ★ 档位见 {@link PLAN_COVERAGE_TIER}；文案见 {@link renderCoverageGap}。
 */
export function planCoverageGaps(plan: RewritePlan | null, symbolsInFile: readonly string[]): PlanCoverageGap[] {
  if (!plan) return [];
  const planned = new Set(plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s));
  const declared = new Set((plan.untouched ?? []).map((u) => u.symbol).filter(Boolean));

  // ★ 紧凑声明（`untouched_default`）：省打字，不省理解 —— 快照之后**新增的符号**仍要被抓
  if (plan.untouched_default) {
    const frozen = new Set(plan.symbols_at_freeze ?? []);
    if (!frozen.size) return [coverageGapOf('E-PLAN-008')];
    const fresh = [...new Set(symbolsInFile)].filter((s) => !planned.has(s) && !frozen.has(s));
    if (!fresh.length) return [];
    return [coverageGapOf('E-PLAN-009', { fresh })];
  }

  const silent = [...new Set(symbolsInFile)].filter((s) => !planned.has(s) && !declared.has(s));
  if (!silent.length) return [];
  return [coverageGapOf('E-PLAN-010', { silent })];
}

/**
 * 一条缺口的**人读文案**（★ 文案的唯一起处：`src/domain/gate_error.ts#GATE_RULES` 的三条
 * `messageStartsWith`（"用了" / "文件里有" / "该文件有"）钉的就是这里的前几个字 ——
 * 动那几个字必须同步那张码表，否则码按文案定位就对不上了）。
 */
export function renderCoverageGap(g: PlanCoverageGap): string {
  switch (g.tag) {
    case 'E-PLAN-008':
      return '用了 `untouched_default`（"其余都不动"）但**没记 `symbols_at_freeze`** ⇒ 无凭据，判不出那批符号当时是否存在';
    case 'E-PLAN-009':
      return (
        `文件里有 ${g.fresh.length} 个**冻结之后才出现的符号**：${g.fresh.slice(0, 6).join(', ')}（\`untouched_default\` 没覆盖它们）` +
        `\n      ⇒ 重新通读这几处，再重新冻结（\`apply:true\` 会刷新快照）`
      );
    case 'E-PLAN-010':
      return (
        `该文件有 ${g.silent.length} 个符号**没表态**（既不在 \`entries\`、也不在 \`untouched\`）：${g.silent.slice(0, 6).join(', ')}` +
        (g.silent.length > 6 ? ` 等 ${g.silent.length} 个` : '') +
        `\n      ⇒ 要么把它写进 entries（要改），要么写进 untouched（看过、不动，附一句 why）`
      );
    case 'index-unavailable':
      return (
        `**索引读不到**该文件的顶层符号清单（${g.reason || '未知原因'}）` +
        `\n      ⇒ A7「每个顶层符号都要表态」本次**未生效**（这不是"文件没有顶层符号"，也不是"全覆盖"）` +
        `\n      ⇒ 修法：\`import_project\` 重建索引（或解锁/修复 \`cache.db\`）后重跑`
      );
  }
}

/**
 * 该文件**顶层符号清单的取数结果**（★ AGENTS-RULES 0.12：失败必须与「没有」可区分）。
 *
 * ★ 为什么要一个带 `ok` 的形状而不是裸 `string[]`：`cache.db` 不在 / 被锁 / 打不开时，
 *   `symbolsInFileOf` 原来 `catch { return [] }` ⇒ 清单空 ⇒ `planCoverageGaps` 的 `silent`
 *   为空 ⇒ **A7「每个顶层符号都要表态」整格静默失效**（只有 `untouched_default` 那支有 `frozen` 守卫）。
 *   "文件里真的没有顶层符号"与"索引读不到"是两件事，必须能分开读。
 */
export interface SymbolsInFileResult {
  ok: boolean;
  symbols: string[];
  /** `ok:false` 时：为什么读不到（要能原样贴进回执） */
  reason?: string;
}

/**
 * `planCoverageGaps` 的**带取数结果**版本 —— 覆盖判据的**唯一入口**（调用方一律用它，别自己判 `ok`）。
 *
 * 返回**两档**（R12②：档位是数据，不是"这条文案在不在那个数组里"）：
 * · `blocking` ⇒ 该拦落盘（`E-PLAN-008` 无凭据 / `E-PLAN-010` 没表态）；
 * · `info`     ⇒ 只点名、不拦（`E-PLAN-009` 该重冻结 / `index-unavailable` 这一格本次没生效）。
 * ★ 取数失败 ⇒ 一条 `index-unavailable`（落在 `info` 档）：判据说"每个顶层符号都要表态"，
 *   而"有哪些符号"读不到 ⇒ 这条判据**此刻没生效**，不许把它当成"没有符号 ⇒ 全覆盖"。
 */
export function planCoverageGapsOf(
  plan: RewritePlan | null,
  inFile: SymbolsInFileResult,
): { info: string[]; blocking: string[] } {
  const bucket = (gs: PlanCoverageGap[]): { info: string[]; blocking: string[] } => {
    const out: { info: string[]; blocking: string[] } = { info: [], blocking: [] };
    for (const g of gs) out[g.tier].push(renderCoverageGap(g));
    return out;
  };
  if (!inFile.ok) {
    // 没画布时 `planGaps` 已经点名"没有够格的重写计划" ⇒ 这里不再叠一句噪音
    if (!plan) return { info: [], blocking: [] };
    return bucket([coverageGapOf('index-unavailable', { reason: inFile.reason ?? '' })]);
  }
  return bucket(planCoverageGaps(plan, inFile.symbols));
}

/** `untouched` 的每条都要有理由（空理由 = 等于没表态） */
export function planUntouchedGaps(plan: RewritePlan | null): string[] {
  if (!plan?.untouched?.length) return [];
  const bad = plan.untouched.filter((u) => !u.symbol?.trim() || !u.why?.trim());
  if (!bad.length) return [];
  return [`untouched 里有 ${bad.length} 条缺 symbol 或 why（空理由 = 没表态）`];
}
/**
 * ★★★ 2026-10-28（迭代 ④）：**`judgement_ref` 的规范引用** —— 不收敛成可解析形式，就判不出"判据强不强"。
 *
 * ## 为什么要收敛（用户目标："这套流程还能发现逻辑 bug"）
 * 判据能不能发现**逻辑错**，取决于它的**种类**：
 * · **语义类**（能发现）：`behavior-cases`（给定输入⇒期望输出）· `call-exists`（必须调某函数）·
 *   `edge-absent` / `edge-exists`（依赖关系对不对）· `run`（跑一段脚本看输出）；
 * · **存在/结构类**（**永远发现不了逻辑错**）：`file-exists`（文件在不在）· `source-has`（某段文本在不在）·
 *   `symbol-exists` · `signature-matches`（签名对不对）。
 * ⇒ 自由文本（`cert:t383/②`）**机器读不出种类** ⇒ 强度判不了 ⇒ 只能靠人。收敛后才可判。
 *
 * ## 规范形态（只认这三种；其余算 `unparsed`，**点名但不猜**）
 * · `decision:<node_id>#<index>` —— **2 段**：判据住设计册该节点的 `decision.expectations[index]`（**首选**：判据的唯一住处）；
 *   册**不写**，由归属账收窄（两册都有断言 ⇒ 拒绝，不替你挑册序第一份）
 * · `decision:<feature>:<node_id>#<index>` —— **3 段**：**显式册名**，只在该册里找 —— 它是"归属不唯一"那条拒绝的
 *   出路：哪一册由写引用的人说，不由闸猜
 * · `cert:<证文件名>#<检查号>` —— 证里的某一条（种类**不登记** ⇒ 强度按 `unknown` 处理，不假装强）
 *
 * ## 为什么按**段数**分，不"试探哪一段是节点 id"（2026-11-05 · R72）
 * 试探要读册，而本函数是 domain 层的**纯解析**（不读册、不读索引）⇒ 读不到就只能猜；猜的形态就是
 * **把册名吞进 nodeId**：改前 `decision:task-system-plan:file_x_ts#2` 解出 `nodeId='task-system-plan:file_x_ts'`
 * ⇒ **看起来被接受、实际指向一个不存在的节点** ⇒ 下游报"找不到节点"而不是"你这写法是什么意思"
 * （0.9.4 同族：非空 ≠ 有效）。段数判据的向后兼容边界是**实测**的：全仓 `decision:<…>#<i>` 引用 294 处、
 * 中间段带冒号的 **0** 处；640 个节点 id 带冒号的 **0** 个 ⇒ 2 段 / 3 段可分。段数不是 2/3 ⇒ `null`（不猜）。
 */
export type JudgementRef =
  | { kind: 'decision'; nodeId: string; index: number }
  | { kind: 'decision'; feature: string; nodeId: string; index: number }
  | { kind: 'cert'; file: string; check: string };

/** 解析规范引用；不是规范形态 ⇒ `null`（**不猜**，也不把自由文本当通过） */
export function parseJudgementRef(ref: string | undefined): JudgementRef | null {
  const s = (ref ?? '').trim();
  // ★ 段数在**正则里**就限死成 ≤2 段（`<a>` 或 `<a>:<b>`）：多一段的写法**结构上**匹配不上 ⇒ `null`，
  //   而不是"先匹配上、再把冒号一起塞进 nodeId"。两个字符类都不含冒号，就是本条的全部要点。
  const m1 = /^decision:([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_.-]+))?#(\d+)$/.exec(s);
  if (m1) {
    const index = Number(m1[3]);
    return m1[2] === undefined
      ? { kind: 'decision', nodeId: m1[1], index }
      : { kind: 'decision', feature: m1[1], nodeId: m1[2], index };
  }
  const m2 = /^cert:([A-Za-z0-9_.-]+)#(.+)$/.exec(s);
  if (m2) return { kind: 'cert', file: m2[1], check: m2[2] };
  return null;
}

/** 判据强度：`semantic` 能发现逻辑错 · `existence` 发现不了 · `unknown` 判不出（不假装） */
export type JudgementStrength = 'semantic' | 'existence' | 'unknown';

// ★ 2026-10-28（T-#DOMAIN-2）：`domain-independent` 归**语义类** —— 它发现的是"边界越权"
//   （域 A 的代码 import 了不该依赖的域 B），这是**真错**，不是"存在性"能发现的。
//   为什么不单列第三类（`structure`）：强度判据的用途是"这条判据能不能发现逻辑错"，
//   而边界越权**就是**一种逻辑错（架构层）；多一档只会让下游要多处理一种情况，收益不抵成本。
const SEMANTIC_KINDS = new Set([
  'behavior-cases',
  'journey-cases', // ★ 卡级旅程：出站帧终态投影比对 —— 转交行删掉/拦截摘掉它必红（值语义）
  'call-exists',
  'edge-absent',
  'edge-exists',
  'run',
  'domain-independent',
  'runtime', // ★ L3：真链路/静默吞错/重试 —— 逻辑错最容易在这里现形
]);
const EXISTENCE_KINDS = new Set(['file-exists', 'source-has', 'symbol-exists', 'signature-matches']);

/**
 * ★★ 2026-11-09（正式规则变更 · 接线证据下沉到**画布**）：
 * 判据里的"**接线族**"—— 证明"谁在调它 / 谁在依赖它"的那几种。
 *
 * 为什么必须在**这里**要，而不是在 `claim` 要：
 * · `claim` 发生在画布**之前**，那一刻拿不到"这次改动动没动接线"
 *   （`decision.scope` 实测 0/624 节点填过 ⇒ 不能当风险来源）；
 * · 画布条目自带 `kind`（`create` / `rewrite` / `delete`）= **变更内容**本身。
 * ⇒ 规则：**`create`（新建符号）的条目必须引用接线类判据** —— 新符号还没有任何行为契约能
 *   证明"它在生产路径上被谁用"，只有接线证据能。`rewrite` 不强制（普通行为小修不该被要求补
 *   `call-exists` 来凑数）。
 */
const WIRING_KINDS = new Set(['call-exists', 'edge-exists', 'edge-absent']);

/** 由一个判据的 `kind` 判强度（不认识 ⇒ `unknown`，**不许当成强**） */
export function strengthOfKind(kind: string | undefined): JudgementStrength {
  if (!kind) return 'unknown';
  if (SEMANTIC_KINDS.has(kind)) return 'semantic';
  if (EXISTENCE_KINDS.has(kind)) return 'existence';
  return 'unknown';
}

/**
 * 计划的**判据强度缺口**（本轮唯一新增的判据；`resolveKind` 由调用方注入 —— 本模块不读册、不读索引）。
 *
 * @param plan 画布
 * @param resolveKind 把一条 entry 的判据解成 `kind`（解不出 ⇒ 返回 `undefined`）
 * @returns 缺口描述（空数组 = 全都至少是语义类，或没有条目）
 */
export function planJudgementGaps(
  plan: RewritePlan | null,
  resolveKind: (entry: RewritePlanEntry) => { kind?: string; why_not?: string },
): string[] {
  if (!plan) return [];
  const gaps: string[] = [];
  for (const e of plan.entries) {
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    const parsed = parseJudgementRef(e.judgement_ref);
    if (!parsed) {
      gaps.push(
        `${who} —— \`judgement_ref\` 不是规范引用（\`${String(e.judgement_ref ?? '')}\`）⇒ 判不出它能不能发现逻辑错。` +
          `\n      规范形态：\`decision:<node_id>#<index>\`（判据住册，首选）/ \`decision:<feature>:<node_id>#<index>\`（显式册名，解除"归属不唯一"）/ \`cert:<证文件名>#<检查号>\``,
      );
      continue;
    }
    // ★ 试点读数 #2：`cert:` 形态没有登记 kind ⇒ 允许**显式声明**（`judgement_kind`），
    //   但必须在 `strengthOfKind` 认识的闭集里 —— 自造的种类会被判成 `unknown` 并点名。
    let r = resolveKind(e);
    if (r.why_not && e.judgement_kind) r = { kind: e.judgement_kind };
    if (r.why_not) {
      gaps.push(`${who} —— 判据解不出来：${r.why_not}（**判不出强度 ≠ 强度合格**）`);
      continue;
    }
    const s = strengthOfKind(r.kind);
    if (s === 'existence') {
      gaps.push(
        `${who} —— 判据 \`${r.kind}\` 是**存在/结构类**，**永远发现不了逻辑错**。` +
          `\n      要发现 bug 得换语义类：\`behavior-cases\`（给输入⇒期望输出）/ \`call-exists\` / \`edge-absent\``,
      );
    } else if (s === 'unknown') {
      gaps.push(`${who} —— 判据种类 \`${String(r.kind ?? '?')}\` 不在已知分类里 ⇒ **判不出强度**（不假装强）`);
    } else if (e.kind === 'create' && !WIRING_KINDS.has(String(r.kind ?? ''))) {
      // ★ 2026-11-09：**新建符号**必须用接线证据 —— 它还没有行为契约能证明"被谁用"。
      gaps.push(
        `${who} —— 这是**新建符号**（entry.kind=create），判据 \`${String(r.kind ?? '?')}\` 只能证明它的行为，` +
          `证明不了"生产路径上谁在调它/依赖它"。` +
          `\n      新建符号要接线类判据：\`call-exists\`（谁调用它）/ \`edge-exists\`（依赖边真的建起来了）。`,
      );
    }
  }
  return gaps;
}


// ─────────────────────────────────────────────────────────────
// 判据的**三侧面并排读数**（`claim` 回执 与 `edit_dsl` 的 I1 的**唯一渲染入口**）

/**
 * 一条判据的**三侧面读数**：能不能判 / 强不强 / 现在红不红。
 *
 * ## 为什么要这一层（2026-11-05 实测）
 * 三个侧面各住一个门，**从没有一处并排显示过**：
 * · `claim`（`domain/task_machine.ts#cardStanding`）只在**拒**的时候说一句「N 条判不了」；
 * · 计划闸（{@link planJudgementGaps}）只说「弱」，而且只对**红**的条目说话；
 * · 于是 `file-exists` / `symbol-exists` 只要**绿**，在写回执里**一个字都没有** ——
 *   而**弱判据永远绿 ⇒ 永远隐形**（用户逐字：「如果它是设计的部分，那么你对它的重写和改写都需要看到它」）。
 *
 * ## 不变量（0.9.1 方向 A：**本层不判任何事**，只把现成权威的返回值装在一起）
 * · `what`     ← `domain/expectation.ts#describeExpectation`（一行渲染的唯一实现）
 * · `strength` ← {@link strengthOfKind}（"能不能发现逻辑错"的唯一分类）
 * · `phase`    ← `domain/expectation.ts#expectationPhase`（前/后态的唯一判据）
 * · `verdict` / `detail` ← `judgeExpectations` 的逐条四态（判定器的唯一输出）
 * ★ 渲染函数里**不许出现任何 kind 名单 / kind 分支** —— 一旦出现，它就是第 N 份实现。
 */
export interface JudgementFacets {
  /** 一行渲染（"它判什么"） */
  what: string;
  /** 判据 kind（原样透传，不解释、不分类） */
  kind: string;
  /** 静态强度（唯一实现 = `strengthOfKind`） */
  strength: JudgementStrength;
  /** 前/后态（唯一实现 = `expectationPhase`） */
  phase: 'pre' | 'post';
  /** 判定器这次给的态；`undefined` = **本次没判**（有意跳过，绝不伪造成 pass） */
  verdict?: Verdict;
  /** 判定器给的原文原因（unsupported / pending / fail 时就是它） */
  detail?: string;
}

/**
 * 把「判据清单」与「判定器回执」装成三侧面读数。
 *
 * @param expectations 要列的那批判据（顺序即回执顺序）
 * @param judged 判定器的 `items`（**先按引用匹配**，对不上再按下标；两个都不中 ⇒ 该条记"本次没判"）
 */
export function readJudgementFacets(
  expectations: readonly Expectation[],
  judged?: readonly { expectation: unknown; verdict: Verdict; detail?: string }[],
): JudgementFacets[] {
  return expectations.map((e, i) => {
    const hit = judged?.find((j) => j.expectation === e) ?? judged?.[i];
    const f: JudgementFacets = {
      what: describeExpectation(e),
      kind: String(e.kind),
      strength: strengthOfKind(e.kind),
      phase: expectationPhase(e),
    };
    if (hit) {
      f.verdict = hit.verdict;
      if (hit.detail) f.detail = hit.detail;
    }
    return f;
  });
}

/**
 * 强度标签（**只按 `strength` 取值分档，不按 kind**）——
 * `existence` 那一档的措辞**逐字沿用** `planJudgementGaps` 的原话「**永远发现不了逻辑错**」，
 * 不许换成更温和的说法（温和 = 下一次没人理它）。
 */
const STRENGTH_LABEL: Record<JudgementStrength, string> = {
  semantic: '语义类（能发现逻辑错）',
  existence: '存在类（永远发现不了逻辑错）',
  unknown: '判不出强度（不假装强）',
};

/** 「能不能判」这一列（★ 四态原样来自判定器，本函数只决定措辞） */
function judgeabilityOf(f: JudgementFacets): string {
  if (!f.verdict) return '未判（本次不判）';
  if (f.verdict === 'unsupported') return `判不了（unsupported${f.detail ? `：${f.detail}` : ''}）`;
  if (f.verdict === 'pending') return `判不了（pending 在等前置${f.detail ? `：${f.detail}` : ''}）`;
  return '可判';
}

/** 一条判据**一行**：kind · 它判什么 · 可判性 · 强度 · 现状（前态另标） */
export function renderJudgementFacetsLine(f: JudgementFacets): string {
  return (
    `  · ${f.phase === 'pre' ? '[前态] ' : ''}${f.kind} ${f.what}` +
    ` —— 可判性: ${judgeabilityOf(f)} ｜ 强度: ${STRENGTH_LABEL[f.strength]} ｜ 现状: ${f.verdict ?? '未判'}`
  );
}

/**
 * 强度分解汇总（只数**后态判据** —— 只有它们参与「有没有活 / 收没收口」）。
 *
 * ★ 它是**提示**，不是拒绝：`semantic === 0` 只说明"这批判据防退化、不防逻辑错"，
 *   照样可以领卡、照样可以收口 —— 本仓明令**不许把弱判据变成拒绝**（那会把存量卡一次性锁死）。
 * ★ 替代 kind 名单**从 `SEMANTIC_KINDS` 派生**（不在这里手抄第二个清单）。
 *
 * @param subject 汇总的主语（claim 用「本卡」、I1 用「本批」）
 */
export function summariseJudgementFacets(fs: readonly JudgementFacets[], subject = '本卡'): string[] {
  const post = fs.filter((f) => f.phase === 'post');
  const n = post.length;
  if (!n) {
    return [
      `★ ${subject}的后态判据 **0 条**（空集不按「全过」算 ⇒ 判不了「有没有活 / 收没收口」；` +
        `见 task_machine#cardStanding ①）`,
    ];
  }
  const count = (s: JudgementStrength): number => post.filter((f) => f.strength === s).length;
  const semantic = count('semantic');
  const existence = count('existence');
  const unknown = count('unknown');
  const out = [
    `★ ${subject} ${n} 条后态判据：语义类 ${semantic} · 存在类 ${existence}` +
      (unknown ? ` · 判不出强度 ${unknown}` : '') +
      ` ⇒ ★ 有 ${semantic} 条能发现逻辑错`,
  ];
  if (semantic === 0) {
    out.push(
      `⚠ ${subject}的后态判据**只有存在类** —— \`strengthOfKind\` 对它们的原话是「**永远发现不了逻辑错**」` +
        `（防退化，绿了也不代表对）。要不要换一条能发现逻辑错的？能发现逻辑错的 kind 全集 = ` +
        `${[...SEMANTIC_KINDS].join(' / ')}（见 AGENTS 0.2）。★ **只提示，不拒绝**。`,
    );
  }
  return out;
}

/**
 * ★★★ 2026-10-28（迭代 ⑤）：**路线（拓扑序）与顺序判据**。
 *
 * ## 为什么顺序必须可判
 * 结构化重写是有序的：**改签名 → 改调用方 → 改测试**。顺序错了就是编译不过 ——
 * 而"顺序"原来只住在模型脑子里（上下文一压缩就没了）。`depends_on` 把它写下来，
 * 本函数负责两件事：**算出路线**（`planTopoOrder`）与**抓顺序违规**（`planDependencyGaps`）。
 *
 * ## 判据（四条，缺一不可）
 * ① 依赖必须指向**本计划里存在的锚点**（拼错 / 漏写 ⇒ 路线是假的）；
 * ② **不许自依赖**（`f` 依赖 `f`）；
 * ③ **不许成环**（成环 = 路线不成立；报出环上的符号）；
 * ④ **顺序不许被违反**：某条已 `status:'done'`，而它依赖的条目**还没 done** ⇒ 报
 *    （这是"结构化重写"真正落地的那一条 —— 先做的没做完就往下做）。
 */
export function planTopoOrder(plan: RewritePlan | null): string[] | null {
  if (!plan) return null;
  const nodes = plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s);
  const deps = new Map<string, string[]>();
  for (const s of nodes) deps.set(s, []);
  for (const e of plan.entries) {
    const s = e.anchor?.symbol;
    if (!s) continue;
    for (const d of e.depends_on ?? []) if (deps.has(d)) deps.get(s)!.push(d);
  }
  const out: string[] = [];
  const temp = new Set<string>();
  const perm = new Set<string>();
  let cyclic = false;
  const visit = (n: string): void => {
    if (perm.has(n) || cyclic) return;
    if (temp.has(n)) {
      cyclic = true;
      return;
    }
    temp.add(n);
    for (const d of deps.get(n) ?? []) visit(d);
    temp.delete(n);
    perm.add(n);
    out.push(n);
  };
  for (const n of nodes) visit(n);
  return cyclic ? null : out; // null = 成环 ⇒ 没有合法路线（不编一个出来）
}

/** 依赖/顺序的缺口（空数组 = 路线成立且没有被违反） */
export function planDependencyGaps(plan: RewritePlan | null): string[] {
  if (!plan) return [];
  const gaps: string[] = [];
  const anchors = new Set(plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s));
  const statusOf = new Map<string, string>();
  for (const e of plan.entries) if (e.anchor?.symbol) statusOf.set(e.anchor.symbol, e.status);

  for (const e of plan.entries) {
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    for (const d of e.depends_on ?? []) {
      if (d === e.anchor?.symbol) {
        gaps.push(`${who} —— **自依赖**（依赖了自己）`);
        continue;
      }
      if (!anchors.has(d)) {
        gaps.push(
          `${who} —— 依赖 \`${d}\`，但**本计划里没有这个锚点**（拼错？还是它该作为一条 entry / untouched 写进来？）`,
        );
        continue;
      }
      // ④ 顺序被违反：本条目已完成，而依赖还没完成
      if (e.status === 'done' && statusOf.get(d) !== 'done') {
        gaps.push(
          `${who} —— **顺序被违反**：它标了 \`done\`，但它依赖的 \`${d}\` 还是 \`${statusOf.get(d) ?? '(无)'}\`` +
            `\n      ⇒ 结构化重写是有序的（改签名 → 改调用方 → 改测试），先做的那条没完成就往下做，等于赌编译。`,
        );
      }
    }
  }

  if (planTopoOrder(plan) === null) {
    const nodes = plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s);
    gaps.push(
      `依赖**成环**（${nodes.join(', ')}）⇒ 路线不成立（没有拓扑序）。` +
        `\n      ⇒ 环上的每一条都自称"要等对方先做"，这种计划落不了地；先把它拆成单向依赖。`,
    );
  }
  return gaps;
}
/**
 * ★★★ 2026-10-28（真实开发试点）：**`kind` 的前提检查** —— `create` / `delete` 的前提错了，路线就错了。
 *
 * 判据（两条）：
 * · `kind:'create'` 但**文件已存在** ⇒ 该用 `rewrite`（"新建"与"改现有"是两件事，混了就会覆盖别人的活）；
 * · `kind:'delete'` 但**文件不存在** ⇒ 已经是删掉的状态（计划过期或路径写错）。
 * ★ 为什么必须判：这两条错了，后面所有 entry 的锚点都建在错的前提上 —— 而"顺序对、判据强"都救不回来。
 */
export function planKindGaps(plan: RewritePlan | null, fileExists: boolean): string[] {
  if (!plan) return []; // 空计划 = 没有判断对象
  const gaps: string[] = [];
  for (const e of plan.entries) {
    // ★ 2026-10-28（严格档真实误报 · 试点读数 #6）：**已完成的条目不判前提** ——
    //   一条 `create` 做完之后文件当然存在；拿"文件已存在"去骂它，就是把"完成了"当成"前提错了"。
    //   （实测：严格档因此拦了一次本该放行的真实改动 ⇒ 这是判据误伤，不是调用方错。）
    if (e.status === 'done') continue;
    // ★★ 2026-10-28（真实任务狗粮发现 · 我的建模错）：**`kind` 有层级** ——
    //   · 有 `anchor.symbol` ⇒ **符号级**（在已有文件里新建/删除/改一个符号）⇒ 文件在不在**不是它的前提**；
    //   · 没有 `anchor.symbol` ⇒ **文件级**（新建/删除整个文件）⇒ 才适用下面两条前提。
    //   实测教训：给"在 fuzzy_match.ts 里新建 classifyReplaceTextMiss"报"create 但文件已存在"是**纯误报**。
    const sym = e.anchor?.symbol;
    if (sym) continue;
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    if (e.kind === 'create' && fileExists) {
      gaps.push(
        `${who} —— \`create\` 但**文件已存在** ⇒ 该用 \`rewrite\`（"新建"与"改现有"是两件事；混了会覆盖已有的活）`,
      );
    }
    if (e.kind === 'delete' && !fileExists) {
      gaps.push(`${who} —— \`delete\` 但**文件不存在** ⇒ 已经是删掉的状态（计划过期，或路径写错）`);
    }
  }
  return gaps;
}

/**
 * ★★★ 2026-10-28（用户原话：「画布在展开时设计完后应该**坍缩成被改动的节点**」）：
 * **坍缩集** = 画布"设计完"之后的形态 —— 只剩**真要动**的符号（`status !== 'done'`）。
 *
 * ## 为什么并发冲突要的正是这一份
 * 画布的**展开态**是给「通读 + 想清楚」用的（`untouched` / `symbols_at_freeze` / 判据细节）；
 * 而「我要碰什么」只取决于**要改的那几个符号** ⇒ 拿展开态去比冲突，会把「我只是看过」也算成争用，
 * 于是两张卡明明不打架却被判冲突（**假阻塞比漏判更打击积极性**）。
 *
 * @returns `{file, symbol}[]`（只含未完成的 entry；`done` 的不再抢）
 */
export function planChangeSet(plan: RewritePlan | null): Array<{ file: string; symbol: string }> {
  if (!plan) return [];
  const file = plan.path.split(path.sep).join('/');
  const out: Array<{ file: string; symbol: string }> = [];
  for (const e of plan.entries) {
    if (e.status === 'done') continue;
    const sym = e.anchor?.symbol;
    if (!sym) continue;
    out.push({ file, symbol: sym });
  }
  return out;
}

/**
 * ★★★ 2026-10-28（用户："设计完后应该**坍缩成被改动的节点**" → 让它自转）：
 * **按出口闭环的结论推进条目状态** —— 否则坍缩集永远停在"设计时的样子"：
 * 活干完了，`status` 还是 `open` ⇒ 并发闸一直挡着已经做完的符号。
 *
 * ## 判据（严格三条，只推进不倒退）
 * · `realized` 且当前 `open` ⇒ **`done`**（并记 `done_at`）；
 * · `stale_anchor` 且当前 `open` ⇒ **`stale`**（锚点对不上 ⇒ 只标，等人看）；
 * · 其余（`not_yet` / `unjudgeable` / 已 `done`）⇒ **不动**。
 *
 * ★ 为什么"只推进不倒退"：`done` 是**发生了什么**的记录（不是"现在是否满足"的判断）。
 *   回退（`done → open`）会抹掉历史，也会让"改了又改"变成悄悄发生的事。
 *   ⇒ 若一条 `done` 的锚点后来消失，出口闭环会报 `stale_anchor`，**读数里看得见**，但不自动改状态。
 */
export function syncPlanStatuses(
  plan: RewritePlan,
  verdicts: ReadonlyArray<{ index: number; verdict: 'realized' | 'not_yet' | 'stale_anchor' | 'unjudgeable' }>,
  now: string = new Date().toISOString(),
): { plan: RewritePlan; changes: Array<{ symbol: string; from: string; to: string }> } {
  const changes: Array<{ symbol: string; from: string; to: string }> = [];
  const entries = plan.entries.map((e, i) => {
    const v = verdicts.find((x) => x.index === i)?.verdict;
    const sym = e.anchor?.symbol ?? '(缺 anchor)';
    // ★ 2026-10-28（真实任务狗粮）：**`stale` 不许是单向的** —— 它常常是"索引抖了一下"造成的
    //   瞬时判定；一旦卡在 `stale`，出口闭环永远"状态无需推进"，条目永久卡死。
    //   ⇒ `stale` + `realized` ⇒ `done`（stale 是警告，不是进度；"不倒退"只约束 done→open 那一侧）。
    if ((e.status === 'open' || e.status === 'stale') && v === 'realized') {
      changes.push({ symbol: sym, from: 'open', to: 'done' });
      return { ...e, status: 'done' as const, done_at: now };
    }
    if ((e.status === 'open' || e.status === 'stale') && v === 'stale_anchor') {
      changes.push({ symbol: sym, from: 'open', to: 'stale' });
      return { ...e, status: 'stale' as const };
    }
    return e;
  });
  return { plan: { ...plan, entries }, changes };
}

/**
 * ★★★ 2026-10-28（用户："任务卡挂单文件节点是不是不太对，后续应该挂在**画布**和**探索后的改集**上"）：
 * **一张卡可以拥有多份画布** —— 卡的改集 = 这些画布**坍缩集的并集**（跨文件）。
 *
 * ## 为什么这是对的
 * 一个任务天然跨文件（例："加一条判据" = `rewrite_plan.ts` + `write_gate.ts` + 证）。
 * 但现在的卡挂在**一个 DSL 节点**上，节点又是**单文件**的 ⇒ 卡的粒度被文件粒度绑死，
 * 读集只能覆盖"节点指到的那一份"，其余文件既不进并发比对、也不进"看全了吗"的判据。
 *
 * ## 判据（怎么找"这张卡的画布"）
 * 扫 `plan/` 下所有 `*.plan.json`，取 `card === cardId` 的那些。**只认显式归属** ——
 * 不按目录/文件名猜（那正是本仓头号病根"路径前缀判据"）。
 */
export function planFilesForCard(projectRoot: string, cardId: string): string[] {
  // ★ 未归属的画布（card_id=''）**不属于任何卡** ⇒ 不许被当成「某张卡的画布」返回
  if (!cardId) return [];
  const db = openPlansForRead(path.resolve(projectRoot));
  if (!db) return []; // 库/表不在 = 真的没有画布（不是读失败；读失败在 openPlansForRead 里抡）
  try {
    // ★ R24：同一能力同一口径 —— 「这张卡名下有哪些画布」问的也是「它还占位吗」⇒ 已消解的不算。
    const rows = db
      .prepare(`SELECT DISTINCT file FROM plans WHERE card_id = ?${aliveOnlyClause(db)} ORDER BY file`)
      .all(cardId) as Array<{ file: string }>;
    return rows.map((r) => r.file);
  } finally {
    db.close();
  }
}

/**
 * **这张卡的改集**（跨文件）= 它名下所有画布坍缩集的并集。
 * @returns 去重后的 `{file, symbol}[]`；卡没有任何画布 ⇒ 空数组（**如实空**，不猜）
 */
export function planChangeSetOfCard(
  projectRoot: string,
  cardId: string,
): Array<{ file: string; symbol: string }> {
  const seen = new Set<string>();
  const out: Array<{ file: string; symbol: string }> = [];
  // ★ 同上：未归属的画布不属于任何卡
  if (!cardId) return out;
  const db = openPlansForRead(path.resolve(projectRoot));
  if (!db) return out;
  try {
    // ★ 一张卡可以有多行（跨文件；也允许同一文件上新旧两张卡各一行）⇒ 逐个算卵缩集再并
    // ★★★ 2026-11-05（R24）：**已软消解的画布不再算「这张卡的改集」** —— 消解 = 这一段已经落地，
    //   它不该再参与下一轮的并发保护（否则就是假阻塞：R12①② 实测两次，代价是两次 supersedes 带异议）。
    //   ★ 反向必须成立：**未消解**的行照旧在（一并滤掉 = 漏判，那比假阻塞更坏）。
    const rows = db
      .prepare(`SELECT ${PLAN_COLS} FROM plans WHERE card_id = ?${aliveOnlyClause(db)} ORDER BY file`)
      .all(cardId) as unknown as PlanRow[];
    for (const row of rows) {
      for (const c of planChangeSet(planOfRow(row))) {
        const key = `${c.file}#${c.symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
      }
    }
  } finally {
    db.close();
  }
  return out;
}

/**
 * 一张卡名下的一行画布（**原样**，含软消解标记）。
 *
 * ★ 为什么要把 `feature` / `dissolved_at` 一起带出来：ChangeSet 视图（§7.1）要回答
 *   「这张卡属于哪本册」「这一段是不是已经落地」—— 两格都在 `plans` 表里，但 `RewritePlan` 结构里没有。
 */
export interface CardPlanRow {
  feature: string;
  plan: RewritePlan;
  dissolved_at: string | null;
  dissolve_reason: string | null;
}

/**
 * ★★★ **这张卡名下的全部画布行**（2026-11-07 · T47）—— 「卡 → 画布」的**不坍缩读端**。
 *
 * ## 为什么必须再开一个读函数（而不是复用 `planChangeSetOfCard`）
 * 两个函数回答的是**两个不同的问题**，口径不同，混用就是本仓头号病（一处口径两处实现）：
 * · `planChangeSetOfCard` = 「**我要碰什么**」= 并发读集。它必须坍缩（`planChangeSet`）：
 *   跳过 `status==='done'`、跳过**没有 `anchor.symbol`** 的条目、滤掉已消解行 ——
 *   这些过滤对"争用判定"是对的（假阻塞比漏判更打击积极性），但对 ChangeSet 是**信息丢失**：
 *   「**新建整个文件**」（`kind:'create'` 且无 `anchor.symbol`）会**整条消失**，
 *   于是"这次要改什么"里少掉一整个文件。
 * · 本函数 = 「**这张卡的计划原样长什么样**」= ChangeSet 视图的取数端。
 *   ⇒ **一行不跳、一条不并**，已消解的行也读出来（只标 `dissolved_at`，由调用方决定怎么呈现）。
 *
 * ## 判据
 * · `card_id = ?` **精确等**（只认显式归属，不按目录/文件名猜 —— 同 `planChangeSetOfCard`）；
 * · 卡没有画布 ⇒ **空数组**（如实空，不猜）；库/表不在 ⇒ 空数组（`openPlansForRead` 已把"读失败"抡出去）；
 * · 老库没有 `dissolved_at` 列 ⇒ `NULL AS dissolved_at`（= "这一列不存在 ⇒ 一条都不可能已消解"，是真话）。
 */
export function plansOfCard(projectRoot: string, cardId: string): CardPlanRow[] {
  // ★ 未归属的画布（card_id=''）**不属于任何卡** ⇒ 不许被当成「某张卡的画布」返回
  if (!cardId) return [];
  const db = openPlansForRead(path.resolve(projectRoot));
  if (!db) return [];
  try {
    const dissolveSchema = hasDissolveColumns(db);
    const dis = dissolveSchema ? 'dissolved_at' : 'NULL AS dissolved_at';
    const dres = dissolveSchema ? 'dissolve_reason' : 'NULL AS dissolve_reason';
    const rows = db
      .prepare(`SELECT ${PLAN_COLS}, ${dis}, ${dres} FROM plans WHERE card_id = ? ORDER BY file`)
      .all(cardId) as unknown as Array<PlanRow & { dissolved_at: string | null; dissolve_reason: string | null }>;
    return rows.map((r) => ({
      feature: r.feature,
      plan: planOfRow(r),
      dissolved_at: r.dissolved_at ?? null,
      dissolve_reason: r.dissolve_reason ?? null,
    }));
  } finally {
    db.close();
  }
}

/**
 * ★★★ 2026-10-28（用户："设计期是权威，设计有问题才会出现偏差"）：
 * 把 **改了却没计划** 的符号**吸收进画布** —— 追加一条缺 `judgement_ref` 的 entry。
 *
 * ★ 为什么不是"留一条警告"：警告会被忽略、也不改变任何判据；吸收成 entry 之后
 *   `planGaps` 会一直点名"缺 judgement_ref"，**闸不会自己变绿**，直到有人把设计补全。
 *
 * @param syms 出口闭环报出的 `changed_unplanned`（已点名的符号）
 */
export function absorbUnplanned(
  plan: RewritePlan,
  syms: readonly string[],
  now: string = new Date().toISOString(),
): { plan: RewritePlan; absorbed: string[] } {
  const known = new Set(plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s));
  const fresh = [...new Set(syms)].filter((s) => !known.has(s));
  if (!fresh.length) return { plan, absorbed: [] };
  return {
    plan: {
      ...plan,
      entries: [
        ...plan.entries,
        ...fresh.map((sym) => ({
          anchor: { symbol: sym },
          kind: 'rewrite' as const,
          detail: '改完发现这个符号也动了 ⇒ **设计漏了**（补：它该改成什么样）',
          judgement_ref: '',
          status: 'open' as const,
          note: `吸收于 ${now}`,
        })),
      ],
    },
    absorbed: fresh,
  };
}

/**
 * ★★★ 2026-11-02（subagent:canvas-db）：**保留策略** —— 活卡画布永不删；已了结卡**默认也不删**。
 *
 * ## 判据（口径只此一处）
 * · 「活 / 关」由 `cardLivesOf` 判（本表**没有 status 列**，画布不自己记状态）；
 * · 裁剪**默认关**：省略 `keepClosedCards` ⇒ 一份都不删。
 *   ★ 为什么默认不删（2026-11-02 口径）：已了结卡的画布是"复核时看当初想干什么"的**唯一记录**，
 *     没有第二处可重建 ⇒ 自动删它换来几十 KB，丢掉的是一张卡的整段叙事。
 *   ⇒ 要按张数裁剪必须**显式**给数字；删了几条**必须进回执**（0.12：给分母）。
 * ★ 为什么是**卡级**而不是文件级：「复核时看当初想干什么」是**一张卡**的叙事，不是一条路径的叙事。
 */
export interface PlansPruneReport {
  total: number;
  /** 活卡名下的行（永不删） */
  live: number;
  closed_rows: number;
  closed_cards: number;
  /** 未归属（`card_id=''`）的行 —— 可能是唯一副本，永不删 */
  unowned_rows: number;
  /** 卡号哪儿都找不到的行（**真孤儿**）—— 同样不自动删，删不删是人的决定 */
  gone_rows: number;
  /** 本次保留策略：`null` = **不裁剪**（默认）；数字 = 已了结卡只留最近 N 张 */
  keep_closed_cards: number | null;
  dropped_cards: number;
  deleted: number;
  deleted_rels: string[];
  basis: string;
}

export function prunePlans(projectRoot: string, opts?: { keepClosedCards?: number }): PlansPruneReport {
  const root = path.resolve(projectRoot);
  const keep = opts?.keepClosedCards;
  const db = openTasksDb(root);
  try {
    const rows = db.prepare('SELECT feature, card_id, file, updated_at FROM plans').all() as unknown as Array<{
      feature: string;
      card_id: string;
      file: string;
      updated_at: string;
    }>;
    // ★ 卡的下落只问 `cardLivesOf`（不再自己查 live_cards / task_history —— 那正是"两把尺"的来源）
    const { lives } = cardLivesOf(root);
    const stateOf = (cardId: string): CardLife => lives.get(cardId) ?? 'gone';
    const closedRows = rows.filter((r) => !!r.card_id && stateOf(r.card_id) === 'closed');
    const unownedRows = rows.filter((r) => !r.card_id);
    const goneRows = rows.filter((r) => !!r.card_id && stateOf(r.card_id) === 'gone');
    const byCard = new Map<string, { latest: string; rows: Array<(typeof closedRows)[number]> }>();
    for (const r of closedRows) {
      const cur = byCard.get(r.card_id) ?? { latest: '', rows: [] as Array<(typeof closedRows)[number]> };
      if (r.updated_at > cur.latest) cur.latest = r.updated_at;
      cur.rows.push(r);
      byCard.set(r.card_id, cur);
    }
    const order = [...byCard.entries()].sort((a, b) => (a[1].latest < b[1].latest ? 1 : -1));
    const dropCards = keep === undefined ? [] : order.slice(Math.max(0, keep));
    const deletedRels: string[] = [];
    if (dropCards.length) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const del = db.prepare('DELETE FROM plans WHERE feature = ? AND card_id = ? AND file = ?');
        for (const [, v] of dropCards) {
          for (const r of v.rows) {
            del.run(r.feature, r.card_id, r.file);
            deletedRels.push(`${r.card_id}:${r.file}`);
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
    return {
      total: rows.length,
      live: rows.length - closedRows.length - unownedRows.length - goneRows.length,
      closed_rows: closedRows.length,
      closed_cards: byCard.size,
      unowned_rows: unownedRows.length,
      gone_rows: goneRows.length,
      keep_closed_cards: keep ?? null,
      dropped_cards: dropCards.length,
      deleted: deletedRels.length,
      deleted_rels: deletedRels,
      basis: PLAN_CARD_BASIS,
    };
  } finally {
    db.close();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 卡的下落（三态）—— 「孤儿报告」与「保留策略」两件事的**唯一口径**
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 一张 `card_id` 现在的下落。★ **三态不许合并成一个「孤儿」数**：
 * · `live`   —— 活卡（candidate / preparing / claimed / in_progress…）；
 * · `closed` —— 已了结（done / void）。**正常**：画布留着是给"复核时看当初想干什么"；
 * · `gone`   —— 哪儿都找不到。**只有这一档该响。**
 *
 * ★ 合并的代价是实测过的：「已了结」占绝大多数，把它算进"孤儿" ⇒ 这条输出天天响、天天假，
 *   人很快学会忽略它 —— 于是真孤儿也一起被忽略（与本仓 `STALE_BUILD` 栽的是同一个坑）。
 */
export type CardLife = 'live' | 'closed' | 'gone';

/**
 * 判据口径（**唯一字符串**：回执里印的就是它，别处不许再手写一份）。
 * 三个来源缺一不可 —— 理由见 `cardLivesOf`。
 */
export const PLAN_CARD_BASIS = 'live_cards ∪ task_history ∪ 设计册 geometry.nodes[].task';

/** `cardLivesOf` 的读数形状（`sheets_ok` 用来把「读失败」与「真没有」分开 —— 0.12） */
export interface CardLives {
  /** card_id → 下落。`live` 优先于 `closed`（任何一处说它是活的，就按活的算） */
  lives: Map<string, CardLife>;
  /**
   * card_id → **判定凭据**（"哪一处说了什么"，如 `live_cards(agent-io)=void + 册(agent-io)=done`）。
   *
   * 不变量：凭据只在 `cardLivesOf` **读那三个来源的同一个循环里**产生，调用方只许**格式化**
   * （拼进 `dissolve_reason` / 回执），不许自己再查一遍那三处 —— 自己查就是第二把尺（0.9.1）：
   * 两边的档一漂移，"为什么判它结案"与落库的理由就对不上，而没有一处会报错。
   * ★ 只收**有观测**的卡：册里有节点但没 task 的卡不在本表（那是 `gone` 的"节点在、卡不在"一档）。
   */
  why: Map<string, string>;
  /** 册里出现过的节点 id（**不管有没有 task**）—— 只用来把 `gone` 的具体原因写清楚 */
  nodeIds: Set<string>;
  /** 册那一层读成功了吗。`false` ⇒ `gone` 这一档**不可信**（不是"真没有"） */
  sheets_ok: boolean;
  /** `sheets_ok=false` 时的原因（原样可贴进回执） */
  sheets_error?: string;
}

/** 一个 task 状态归哪一档（判据**只此一处**；空/没有 task ⇒ `null` = 不是卡） */
export function lifeOfTaskState(state: string | undefined): CardLife | null {
  const s = (state ?? '').trim();
  if (!s) return null;
  return s === 'done' || s === 'void' ? 'closed' : 'live';
}

/**
 * ★★★ 2026-11-02（subagent:plan-semantics）：**一张卡的下落** —— 三态，**三处口径合一**。
 *
 * ## 三处缺一不可（这是本函数存在的全部理由）
 * · `live_cards`（库里的活卡片册：候选 / 预备 / 已领 / 已了结都在）；
 * · `task_history`（**只有 `todo` 卡**会迁到这里 —— `todo.move_to_history`）；
 * · 设计册 `geometry.nodes[].task`（**`task` 卡的 `done` / `void` 留在册里**，从不迁出）。
 *
 * 只查前两处 ⇒ 所有 `done` 的 task 卡集体被判"找不到"（实测 31 行假警告，逐条复算全是真卡）：
 * `task_history` 按设计只收 todo 卡，而 done 的 task 卡留在册里没动过。
 *
 * @returns `{lives, nodeIds, sheets_ok}`；读册失败**出声**且 `sheets_ok=false`（不静默回落成"没有"）
 *
 * @authority 一张任务卡还活着吗（活 / 关 / 找不到）
 * @authority-via design_line
 * @authority-note 口径 = `PLAN_CARD_BASIS`（live_cards ∪ task_history ∪ 设计册 geometry.nodes[].task）；只查前两处会漏掉 done 的 task 卡
 */
export function cardLivesOf(projectRoot: string): CardLives {
  const root = path.resolve(projectRoot);
  const lives = new Map<string, CardLife>();
  const bump = (id: string | undefined, life: CardLife | null): void => {
    if (!id || !life) return;
    const cur = lives.get(id);
    if (cur === 'live') return; // live 最高：任何一处说活，就是活的
    if (life === 'live' || cur === undefined) lives.set(id, life);
  };
  // ★ 凭据与裁决**同源**：在下面读三个来源的同一个循环里顺手记（外面只许格式化，不许重查 —— 0.9.1）
  const whyParts = new Map<string, string[]>();
  const note = (id: string, part: string): void => {
    const arr = whyParts.get(id) ?? [];
    if (!arr.includes(part)) arr.push(part);
    whyParts.set(id, arr);
  };
  const db = openPlansForRead(root);
  if (db) {
    try {
      for (const r of db.prepare('SELECT id, feature, state FROM live_cards').all() as Array<{ id: string; feature: string; state: string }>) {
        bump(r.id, lifeOfTaskState(r.state));
        note(r.id, `live_cards(${r.feature})=${r.state}`);
      }
      // task_history 只收 todo 卡 ⇒ 进了这里一定是已了结
      for (const r of db.prepare('SELECT id, feature FROM task_history').all() as Array<{ id: string; feature: string }>) {
        bump(r.id, 'closed');
        note(r.id, `task_history(${r.feature})`);
      }
    } finally {
      db.close();
    }
  }
  const nodeIds = new Set<string>();
  let sheetsOk = true;
  let sheetsError: string | undefined;
  try {
    for (const d of listDesignSheets()) {
      if (!isSameProject(d, root)) continue;
      for (const n of d.geometry?.nodes ?? []) {
        if (!n?.id) continue;
        nodeIds.add(String(n.id));
        const st = (n as { task?: { state?: string } }).task?.state;
        bump(String(n.id), lifeOfTaskState(st));
        if (st) note(String(n.id), `册(${d.feature})=${st}`);
      }
    }
  } catch (e) {
    // 读册失败 ⇒ **出声**（0.12：读失败不许回落到"没有" ⇒ `gone` 这一档会因为缺了第三处而偏多，必须说清）
    sheetsOk = false;
    sheetsError = (e as Error).message;
    process.stderr.write(
      `[rewrite_plan] cardLivesOf：读设计册失败（${sheetsError}）⇒ 册那一层不作数，"找不到"这一档**不可信**\n`,
    );
  }
  // 凭据压成一句话（**排序** ⇒ 同一组来源永远同一句，落库的 dissolve_reason 才可分组、可对账）
  const why = new Map<string, string>();
  for (const [id, parts] of whyParts) why.set(id, [...parts].sort().join(' + '));
  return { lives, why, nodeIds, sheets_ok: sheetsOk, ...(sheetsError ? { sheets_error: sheetsError } : {}) };
}

/**
 * ★★★ 2026-11-02（subagent:canvas-db）：**软引用待办查询** —— `card_id` 是软引用（画布常先于 publish 存在，
 * 不建 FK），但那一头断了必须**看得见**（0.12：不静默）。
 *
 * 判据：卡的下落按 `cardLivesOf` 的**三态**分别计数并按态列出；未归属的空串单独计。
 * ★ **只有 `items`（= `gone`，真孤儿）非 0 才该响** —— `closed` 是正常状态，不是问题。
 * ★ 只读：不改一行、不清理（清理是 `prunePlans` 与人的决定）。
 */
export interface PlanOrphanHit {
  feature: string;
  card_id: string;
  file: string;
  updated_at: string;
  /** 只在"找不到"那一档给：连节点都没有 / 节点在但没卡 */
  why?: string;
}

export interface PlanOrphanReport {
  /** 表内**全部**行数（分母：消解过的也算） */
  total: number;
  /** 未消解 = `total − dissolved`（下面五档之和） */
  alive: number;
  /** 已软消解（不再参与对拍，但**叙事原样保留**，可复核） */
  dissolved: number;
  /** 已消解那些份里一共有多少条 entry（"含叙事"的量化：只给份数读者不知道丢了多少可复核内容） */
  dissolved_entries: number;
  /** 库里有没有 `dissolved_at` 这一列（`false` ⇒ 本库还没迁移过 ⇒ `dissolved` 这一档必然 0，是"没迁"不是"没消解"） */
  dissolve_schema: boolean;
  /** 有主 = live + closed（"找得到卡"）· 只统计**未消解**的 */
  owned: number;
  live: number;
  closed: number;
  gone: number;
  unowned: number;
  /** ★ 真孤儿（= `gone`）。**只有它非 0 才该响** */
  items: PlanOrphanHit[];
  live_items: PlanOrphanHit[];
  closed_items: PlanOrphanHit[];
  unowned_items: PlanOrphanHit[];
  /** 册那一层读成功了吗（`false` ⇒ `gone` 这档不可信，不是"真没有"） */
  sheets_ok: boolean;
  basis: string;
}

export function orphanPlans(projectRoot: string): PlanOrphanReport {
  const root = path.resolve(projectRoot);
  const empty: PlanOrphanReport = {
    total: 0,
    alive: 0,
    dissolved: 0,
    dissolved_entries: 0,
    dissolve_schema: true,
    owned: 0,
    live: 0,
    closed: 0,
    gone: 0,
    unowned: 0,
    items: [],
    live_items: [],
    closed_items: [],
    unowned_items: [],
    sheets_ok: true,
    basis: PLAN_CARD_BASIS,
  };
  const db = openPlansForRead(root);
  if (!db) return empty; // 库/表不在 = **真的没有画布**（不是读失败；读失败在 openPlansForRead 里抡）
  try {
    // ★ 读端只读 ⇒ 不能靠 `openTasksDb` 的迁移补列：老库没有这两列时**必须**说得清（0.12）。
    //   `NULL AS dissolved_at` = "这一列还不存在 ⇒ 一条都不可能已消解"，是真话，不是回落成 0。
    const dissolveSchema = hasDissolveColumns(db);
    const dis = dissolveSchema ? 'dissolved_at' : 'NULL AS dissolved_at';
    const rows = db
      .prepare(`SELECT feature, card_id, file, updated_at, entries_json, ${dis} FROM plans ORDER BY updated_at DESC`)
      .all() as unknown as Array<PlanOrphanHit & { entries_json: string; dissolved_at: string | null }>;
    const { lives, nodeIds, sheets_ok } = cardLivesOf(root);
    const live: PlanOrphanHit[] = [];
    const closed: PlanOrphanHit[] = [];
    const gone: PlanOrphanHit[] = [];
    const unowned: PlanOrphanHit[] = [];
    let dissolved = 0;
    let dissolvedEntries = 0;
    for (const r of rows) {
      if (r.dissolved_at) {
        // ★ 已消解的**不进三态**：它的卡已经结案、设计性已消失 —— 混进来会让"活卡/已结案/找不到"三栏
        //   变成"包括历史"的一锅，人再也看不出"眼前还有几份画布要对拍"。
        dissolved += 1;
        dissolvedEntries += entriesCountOf(r.entries_json, `${r.feature}|${r.card_id}|${r.file}`);
        continue;
      }
      if (!r.card_id) {
        unowned.push(r);
        continue;
      }
      const life = lives.get(r.card_id);
      if (life === 'live') live.push(r);
      else if (life === 'closed') closed.push(r);
      else
        gone.push({
          ...r,
          why: nodeIds.has(r.card_id)
            ? '设计册里有这个 id 的节点，但它没有 task（卡不存在）'
            : '设计册里连这个 id 的节点都没有，live_cards / task_history 也没有',
        });
    }
    return {
      total: rows.length,
      alive: live.length + closed.length + gone.length + unowned.length,
      dissolved,
      dissolved_entries: dissolvedEntries,
      dissolve_schema: dissolveSchema,
      owned: live.length + closed.length,
      live: live.length,
      closed: closed.length,
      gone: gone.length,
      unowned: unowned.length,
      items: gone,
      live_items: live,
      closed_items: closed,
      unowned_items: unowned,
      sheets_ok,
      basis: PLAN_CARD_BASIS,
    };
  } finally {
    db.close();
  }
}

/** 库里有 `dissolved_at` 这一列吗（**只读**；老库没有就是没有，不许当成"全未消解"而不吭声） */
function hasDissolveColumns(db: DatabaseSync): boolean {
  return (db.prepare('PRAGMA table_info(plans)').all() as Array<{ name?: string }>).some((c) => String(c.name) === 'dissolved_at');
}

/**
 * 一条 entry 计数（★ 解析不了就**抛**：静默按 0 条计 = 把"坏数据"读成"空画布"，0.12）。
 */
function entriesCountOf(entriesJson: string, where: string): number {
  try {
    const parsed = JSON.parse(entriesJson) as unknown;
    if (!Array.isArray(parsed)) throw new Error('entries_json 不是数组');
    return parsed.length;
  } catch (e) {
    throw new Error(`画布条目数算不出来（${where}）：entries_json 坏（${(e as Error).message}）`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 软消解：卡已结案 ⇒ 画布**不再是画布**（不再参与对拍），但一行都不删
// ══════════════════════════════════════════════════════════════════════════════

/** 一份被消解的画布（`reason` 就是落库的 `dissolve_reason`，逐份按依据档写，不是一律一句话） */
export interface PlanDissolveRow {
  feature: string;
  card_id: string;
  file: string;
  entries: number;
  reason: string;
}

export interface PlanDissolveReport {
  /** true = 只算不写 */
  dry_run: boolean;
  /** 表内全部份数（分母） */
  total: number;
  /** 本次**应消解**（dry_run）或**已写**（非 dry_run）的份数 */
  dissolved: number;
  /** 本来就消解过（幂等：同一份库跑第二次，全部落到这里、`dissolved=0`） */
  already: number;
  entries_dissolved: number;
  kept_live: number;
  kept_unowned: number;
  kept_gone: number;
  /** 依据档 → {份, 条}（8 档那种粒度，可当回执直接印） */
  by_reason: Record<string, { rows: number; entries: number }>;
  /** 叙事三列（entries/fps/symbols_at_freeze）逐行比：0 = 一个字节都没动 */
  narrative_drift_rows: number;
  narrative_intact: boolean;
  rows: PlanDissolveRow[];
  /** 册那一层读成功了吗（`false` ⇒ `kept_gone` 这一档不可信，见 `cardLivesOf`） */
  sheets_ok: boolean;
  basis: string;
  /** 库已具备消解列（`openTasksDb` 的幂等迁移跑过）—— `false` 时本函数**抛**，不降级 */
  schema_migrated: boolean;
  /** 落盘后仍未消解的份数（= `total − 已消解`；不给它就没法判断"消到没到位"） */
  alive: number;
}

/** `plans` 一行的原样（消解只读这几列 + 叙事三列**只为证明没动**） */
interface PlanRawRow {
  feature: string;
  card_id: string;
  file: string;
  dissolved_at: string | null;
  entries_json: string;
  fps_json: string | null;
  symbols_at_freeze_json: string | null;
}

/**
 * ★★★ 2026-11-03：**软消解**（`dissolve≠delete`）。
 *
 * ## 判据（口径只此一处）
 * · 卡活不活**只问 `cardLivesOf`**；`dissolve_reason` 的证据文本取它顺带记下的 `why`
 *   （裁决与凭据同源；在本函数里另查那三处表就是第二把尺）。
 * · `closed` ⇒ 打 `dissolved_at` + `dissolve_reason`；`live` / `card_id=''`（未归属）/ `gone`（三处皆无）
 *   **一律不动** —— 后两种根本没有"结案"这个事实可依，硬消解等于替人做决定。
 * · **不删行、不改叙事**：`entries_json` / `fps_json` / `symbols_at_freeze_json` 逐行比，动了就 `narrative_intact=false`。
 *
 * ## 复活是它的另一半，实现住在 `writeRewritePlan`
 * 某个 **file** 重新被冻结 ⇒ 该行的 `dissolved_at` 清空（用户模型：「被编辑的那一块就是画布」）。
 * ★ 粒度是 **file** 不是卡 —— 同卡名下其它文件的画布不受牵连。
 */
export function dissolvePlans(projectRoot: string, opts?: { dryRun?: boolean; now?: string }): PlanDissolveReport {
  const root = path.resolve(projectRoot);
  const dryRun = opts?.dryRun === true;
  const now = opts?.now ?? new Date().toISOString();
  const db = openTasksDb(root); // 写端：顺手把 plans 的后加列补齐（`migratePlansColumns` 幂等）
  try {
    if (!hasDissolveColumns(db)) {
      throw new Error(`dissolvePlans：库 ${getTasksDbFile(root)} 迁移后仍没有 dissolved_at 列 ⇒ 拒绝在不知道形状的库上写消解标记`);
    }
    const sel =
      'SELECT feature, card_id, file, dissolved_at, entries_json, fps_json, symbols_at_freeze_json FROM plans ORDER BY feature, card_id, file';
    const readAll = (): PlanRawRow[] => db.prepare(sel).all() as unknown as PlanRawRow[];
    const keyOf = (r: PlanRawRow): string => `${r.feature}\u0000${r.card_id}\u0000${r.file}`;
    const narrativeOf = (r: PlanRawRow): string => [r.entries_json ?? '', r.fps_json ?? '', r.symbols_at_freeze_json ?? ''].join('\u0000');

    const before = readAll();
    const { lives, why, sheets_ok } = cardLivesOf(root);
    const rows: PlanDissolveRow[] = [];
    let already = 0;
    let keptLive = 0;
    let keptUnowned = 0;
    let keptGone = 0;
    for (const r of before) {
      if (r.dissolved_at) {
        already += 1;
        continue;
      }
      if (!r.card_id) {
        keptUnowned += 1;
        continue;
      }
      const life = lives.get(r.card_id) ?? 'gone';
      if (life === 'live') {
        keptLive += 1;
        continue;
      }
      if (life === 'gone') {
        keptGone += 1;
        continue;
      }
      const evidence = why.get(r.card_id);
      if (!evidence) {
        throw new Error(
          `dissolvePlans：cardLivesOf 判「${r.card_id}」= closed，却没有留下任何凭据（${r.file}）` +
            ' ⇒ 拒绝编造消解理由（0.12：说不清依据就不许落库）',
        );
      }
      rows.push({
        feature: r.feature,
        card_id: r.card_id,
        file: r.file,
        entries: entriesCountOf(r.entries_json, `${r.feature}|${r.card_id}|${r.file}`),
        reason: `卡已结案：${evidence}`,
      });
    }

    if (!dryRun && rows.length) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // ★ 条件里带 `dissolved_at IS NULL`：并发/重跑都不会把已有时间戳覆盖成新时间（时间戳是"何时消解的"证据）
        const up = db.prepare(
          'UPDATE plans SET dissolved_at = ?, dissolve_reason = ? WHERE feature = ? AND card_id = ? AND file = ? AND dissolved_at IS NULL',
        );
        for (const r of rows) up.run(now, r.reason, r.feature, r.card_id, r.file);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }

    const after = readAll();
    const wasNarrative = new Map(before.map((r) => [keyOf(r), narrativeOf(r)]));
    const drifted = after.filter((r) => wasNarrative.get(keyOf(r)) !== narrativeOf(r)).map(keyOf);
    const byReason: Record<string, { rows: number; entries: number }> = {};
    for (const r of rows) {
      const g = byReason[r.reason] ?? { rows: 0, entries: 0 };
      g.rows += 1;
      g.entries += r.entries;
      byReason[r.reason] = g;
    }
    const dissolvedTotal = after.filter((r) => !!r.dissolved_at).length;
    return {
      dry_run: dryRun,
      total: after.length,
      dissolved: rows.length,
      already,
      entries_dissolved: rows.reduce((s, r) => s + r.entries, 0),
      kept_live: keptLive,
      kept_unowned: keptUnowned,
      kept_gone: keptGone,
      by_reason: byReason,
      narrative_drift_rows: drifted.length,
      narrative_intact: drifted.length === 0,
      rows,
      sheets_ok,
      basis: PLAN_CARD_BASIS,
      schema_migrated: true,
      alive: after.length - dissolvedTotal,
    };
  } finally {
    db.close();
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 画布归属：**只在"省略 card"时才算被清空**
// ══════════════════════════════════════════════════════════════════════════════

/** 该文件在库里已有的**全部** card_id（排序去重；拒绝文案要点全，不只点名最新的那张） */
function cardsOfFile(projectRoot: string, relPath: string): string[] {
  const rel = posixRel(relPath);
  if (!rel) return [];
  const db = openPlansForRead(path.resolve(projectRoot));
  if (!db) return []; // 库/表不在 = 真的没有行（读失败在 openPlansForRead 里抡）
  try {
    const rows = db.prepare('SELECT DISTINCT card_id FROM plans WHERE file = ? ORDER BY card_id').all(rel) as Array<{ card_id: string }>;
    return rows.map((r) => String(r.card_id ?? '')).filter(Boolean);
  } finally {
    db.close();
  }
}

/**
 * ★★★ 2026-11-02（subagent:plan-semantics）：**画布归属只在"省略 `card`"时才算被清空** —— 唯一判据。
 *
 * ## 判据（可判真假）
 * · **省略 `card`** 且该文件已有行 ⇒ **拒**，并点名"这个文件已属于卡 X"。
 *   病理很具体：画布是**覆盖式落盘**，`card` 掉了 ⇒ `planChangeSetOfCard` 不再把这个文件算进那张卡的改集
 *   ⇒ 并发闸下一轮看不见它（保护区**静默降级**）。
 * · **给了 `card`（哪怕与已存的不同）⇒ 放行**。两张卡对同一文件各写一份画布是**合法**场景：
 *   主键 `(feature, card_id, file)` 三键就是为它建的；把"换卡"也拒掉 ⇒ **并行写被卡死**。
 *
 * ★ 这条曾经写错过（上一版把"给了不同的卡"也当违规），错法是"照字面要求执行" ——
 *   要求本身没分清两件事：**归属被抹成空**（病）与 **换成另一张卡**（合法）。
 *
 * @returns `null` = 可以落盘；否则是拒绝文案
 */
export function planCardClearGap(projectRoot: string, relPath: string, givenCard: string): string | null {
  const given = (givenCard ?? '').trim();
  if (given) return null; // 给了卡 ⇒ 归属不会被清空（换成另一张卡是合法的一行，不是覆盖）
  const owners = cardsOfFile(projectRoot, relPath);
  if (!owners.length) return null; // 这个文件原本就没有归属 ⇒ 没东西可清空
  const rel = posixRel(relPath);
  return (
    `拒绝落盘（画布归属会被清空）：**这个文件已属于卡 ${owners.join(' · ')}**，而这次没传 card。\n` +
    `  · 文件：${rel}\n` +
    `★ 为什么拒：画布是**覆盖式落盘**，归属一旦掉了，planChangeSetOfCard 就不再把该文件算进那张卡的改集 ——` +
    ` 并发闸下一轮看不见它（保护区静默降级）。\n` +
    `★ 怎么办：补 card:'${owners[0]}' 再落盘。\n` +
    `★ 注意：**给了不同的卡是合法的**（两张卡对同一文件各写一份画布，主键 feature+card_id+file 三键就是为它建的）——` +
    ` 所以这个文件若确实属于另一张卡，直接写那张卡的号即可。`
  );
}
