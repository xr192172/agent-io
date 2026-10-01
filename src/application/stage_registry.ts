/**
 * 工序表（Stage registry）—— ★★ **唯一数据源**
 *
 * ─────────────────────────────────────────────────────────────
 * 这是什么
 * ─────────────────────────────────────────────────────────────
 * 这个仓里"有哪些数据、谁产它、归哪个根、缺了怎么办"——**只在下面这张表里声明一次**。
 * 其余一切**从它投影**，不再另写一份：
 *   · 运行时索引 `getStage()`            ← `STAGES` 投影
 *   · 溯源图检查 `assertAcyclic()`        ← `inputs` 投影
 *   · 待还的债 `pendingStages()` / `weakFreshnessStages()` ← `kind` 投影
 *   · 文档里那张表 `renderStageTable()`    ← 直接渲染（**不再手抄**）
 *
 * ★★ 为什么不要 JSON 夹具 + 字符串引用（2026-10-01，用户："你写这么多夹具其实就是在
 *    手工替代编译器的作用，而且还贴得很歪"）：
 *    前两版把产者/解析器写成 `'src/....ts#symbol'` **字符串**，于是只能再手写一扇 647 行的门
 *    去 `splitRef()` 反解、查导出表 —— **那是在手工重新实现模块解析器**。
 *    现在写的是**值引用**（`ensureProjectIndex` 这个函数本身）⇒ 改名/搬移/删除/签名不符
 *    **编译器当场报错**。★ 已实测（注入三类错、`tsc` 全抓，见台账 §44.29）。
 *
 * ★★ 字段只留"编译器查不了、且推不出来"的：
 *   · `id` / `owner` / `inputs` / `note` —— 声明；`inputs` 受 `StageId` 联合类型约束（打错字即编译错）
 *   · `kind` —— ★ **判别联合**：`derived` 必须给 `produce`；`source`/`pending` **必须给 why**
 *     （以前用 JSON + 一扇门去查"why 是不是够长"；现在**类型系统强制**）
 *   · ★ **没有 `fresh` 分类字段**：新鲜判据由 `isFresh` / `locate` 的**有无**推论出来 ——
 *     手抄的分类 = 又一处会腐的分叉
 *
 * ─────────────────────────────────────────────────────────────
 * 语义（**缺了就重做；失败就重试；绝不兜底**）
 * ─────────────────────────────────────────────────────────────
 *   ensureStage(id, ctx):
 *     derived：已新鲜 ⇒ 返回；否则 ⇒ 先处理每个上游 ⇒ produce ⇒ 抛错则**重试**（3 次）⇒ 仍失败**抛**
 *     source ：外部产生的 ⇒ **只能检查在不在**（有 locate 就查），不在就**抛**
 *     pending：没有产者 ⇒ **抛**
 *
 * ★★ 为什么一处都不兜底：兜底 = 拿一个**错的输入**继续做本该做对的事 ⇒ 会**静默读到别的项目的
 *    答案**，而且会自我繁殖（"反正总有一个能用" ⇒ 没人去保证**正确的那个**存在）。
 *    根不明确时一律 `requireProjectRoot` **响亮抛错**（`infrastructure/storage.ts`）。
 *    ★ 响亮是接上溯源的前提 —— 只有"缺"得响亮，才知道该补哪一道工序。
 *
 * ★ 已知边界（如实声明）：**这张表要人写**。表里没有的数据 = 没被管的；它不假装完整。
 *   "已核实存在但尚未登记"的那些留在账本 `docs/data-ledger.md`（那是**记录**，不是判据）。
 */

import fs from 'node:fs';
import { requireProjectRoot, getDSL, ensureBaseline, getBaselineFeatureFile, getFeatureFile } from '../infrastructure/storage.js';
import { projectCacheDbPath, getProjectCacheDb } from '../infrastructure/index/db.js';
import { ensureProjectIndex } from '../infrastructure/index/index_freshness.js';
import { getProjectView, invalidateProjectView } from '../infrastructure/parse/project_view.js';
import { observePointsFile, recommendObservePoints } from './observe/observe_points.js';

// ─────────────────────────────────────────────────────────────
// 类型：`StageId` 是**字面量联合** ⇒ `inputs` 写错一个 id 就编译不过
// ─────────────────────────────────────────────────────────────

export type StageId =
  | 'source_files'
  | 'symbol_index'
  | 'embedding_cache'
  | 'import_cache'
  | 'dsl_features'
  | 'dsl_live'
  | 'dsl_baseline'
  | 'archive'
  | 'code_snapshots'
  | 'behavior_baseline'
  | 'health_cache'
  | 'observe_events'
  | 'observe_ledger'
  | 'observe_points'
  | 'dogfood'
  | 'self_writes'
  | 'impact_ledger'
  | 'output_registry';

/**
 * 这份数据归哪个根。
 * ★ `derived` 的工序**由行为校验**（拿两个不同的项目根跑 `locate`，结果必须不同）⇒ 声明错了会被门抓住；
 *   `source`/`pending` 没有 `locate`，只能靠声明 —— 这是本表**如实承认**的弱点。
 */
export type StageOwner = 'project' | 'dataHome';

export interface StageCtx {
  /** 被分析项目的根。★ **没有就是没有** —— 绝不兜底到 cwd（见 `storage.ts#requireProjectRoot`） */
  projectRoot?: string;
  feature?: string;
}

interface StageBase {
  readonly id: StageId;
  readonly owner: StageOwner;
  /** 上游工序（溯源图）。`[]` = 源头 */
  readonly inputs: readonly StageId[];
  /** 一句话：这是什么数据 */
  readonly note: string;
  /** 落盘位置。给了它 ⇒ "存在"即算有；内存产物（视图/缓存句柄）没有它。 */
  readonly locate?: (ctx: StageCtx) => string;
}

/** ★ **已接上产者**的工序 ⇒ 缺了能重做 */
export interface DerivedStage extends StageBase {
  readonly kind: 'derived';
  /** 更强的新鲜判据（内容指纹 / TTL / 版本）。给了它就用它，压过 `locate` 的存在性。 */
  readonly isFresh?: (ctx: StageCtx) => boolean;
  /** ★ **唯一产者**。**失败就抛**（重试由 `produceWithRetry` 统一负责）；**不许吞、不许降级**。 */
  readonly produce: (ctx: StageCtx) => Promise<void>;
}

/** ★ **源头数据**：外部（人 / 别的系统 / 运行时探针）产生的，**没有"重做"这回事** ⇒ 只能查在不在 */
export interface SourceStage extends StageBase {
  readonly kind: 'source';
  readonly why: string;
}

/** ★ **欠产者**：本来该能重做，但产者还没接 —— 这是**可数的债**（`pendingStages()` 投影） */
export interface PendingStage extends StageBase {
  readonly kind: 'pending';
  readonly why: string;
}

export type Stage = DerivedStage | SourceStage | PendingStage;

// ─────────────────────────────────────────────────────────────
// ★★ 唯一数据源：一张表
// ─────────────────────────────────────────────────────────────

export const STAGES: readonly Stage[] = [
  // ── 已接上产者（4 道）────────────────────────────────────────
  {
    id: 'source_files',
    kind: 'derived',
    owner: 'project',
    inputs: [],
    note: '项目有哪些源码文件（内存视图：一处算 → TTL 缓存 → 多处取用）',
    produce: async (ctx) => {
      // 内存产物，没有落盘位置 ⇒ 不写 locate（每次 ensure 都重算一遍视图；一次 walk，可接受）
      const root = requireProjectRoot({ projectRoot: ctx.projectRoot });
      invalidateProjectView(root);
      getProjectView(root);
    },
  },
  {
    id: 'symbol_index',
    kind: 'derived',
    owner: 'project',
    inputs: ['source_files'],
    note: '符号索引 cache.db：nodes / edges / files / imports',
    locate: (ctx) => projectCacheDbPath(requireProjectRoot({ projectRoot: ctx.projectRoot })),
    produce: async (ctx) => {
      await ensureProjectIndex(requireProjectRoot({ projectRoot: ctx.projectRoot }));
    },
  },
  {
    id: 'dsl_baseline',
    kind: 'derived',
    owner: 'dataHome',
    inputs: ['dsl_features'],
    note: '设计基线（共同祖先）快照',
    locate: (ctx) => getBaselineFeatureFile(needFeature(ctx)),
    produce: async (ctx) => {
      const feature = needFeature(ctx);
      const dsl = getDSL(feature);
      // ★ 上游（源）声称在、却取不到内容 ⇒ 抛。**不兜底**：不拿别的 feature 的 DSL 顶替。
      if (!dsl) throw new Error(`工序 dsl_baseline：feature "${feature}" 的设计 DSL 取不到`);
      ensureBaseline(dsl);
    },
  },
  {
    id: 'observe_points',
    kind: 'derived',
    owner: 'project',
    inputs: ['source_files'],
    note: '推荐观测点清单',
    locate: (ctx) => observePointsFile(requireProjectRoot({ projectRoot: ctx.projectRoot })),
    produce: async (ctx) => {
      const root = requireProjectRoot({ projectRoot: ctx.projectRoot });
      await recommendObservePoints(getProjectCacheDb(root), root);
    },
  },

  // ── 欠产者（可数的债）────────────────────────────────────────
  {
    id: 'embedding_cache',
    kind: 'pending',
    owner: 'project',
    inputs: ['symbol_index'],
    note: '符号向量缓存（cache.db 里的一张表）',
    why: '产者是语义搜索的 miss 路径（边查边填），没有"独立做一遍"的入口；且**无 TTL、无淘汰** ⇒ 真要接，得先定失效判据。',
  },
  {
    id: 'import_cache',
    kind: 'pending',
    owner: 'dataHome',
    inputs: ['source_files'],
    note: '按 feature 的导入缓存 import_cache_<feature>.db',
    why: '产者是 import_project 全量导入（重）。接它要先决定"重做"的粒度（全量 or 增量），否则 ensure 一次 = 全项目重扫。',
  },
  {
    id: 'dsl_live',
    kind: 'pending',
    owner: 'dataHome',
    inputs: ['dsl_features'],
    note: '实际（代码现状）DSL 快照 live/<feature>.dsl.json',
    why: '产者同样是 import_project（live_only）。★ 且它带 baseDir 可覆盖（watch 时会落到被监听项目的根）⇒ 接之前必须先定"写读两侧怎么保证同一个根"，否则接上就是接一个**更快的分叉**。',
  },
  {
    id: 'code_snapshots',
    kind: 'pending',
    owner: 'project',
    inputs: [],
    note: '代码文件回滚快照（保留最近 20 份）',
    why: '产者 createFileSnapshot 需要"即将被写的那几个文件的内容"—— 那不是从项目状态推得出来的，得由写侧带给它。',
  },
  {
    id: 'behavior_baseline',
    kind: 'pending',
    owner: 'project',
    inputs: [],
    note: '行为基线（函数级输入输出快照）',
    why: '产者 captureBaseline 要"真跑那个函数"（还要输入样本），不是静态可派生的。',
  },
  {
    id: 'health_cache',
    kind: 'pending',
    owner: 'project',
    inputs: ['source_files'],
    note: '体检报告缓存（按文件指纹失效）',
    why: '它是各体检工具（check_monolith / arch_layer）的**副产物**，产者是那两个工具本身 ⇒ 要么把工具搬进工序，要么承认它是副产品。',
  },
  {
    id: 'output_registry',
    kind: 'pending',
    owner: 'dataHome',
    inputs: [],
    note: '产物目录登记表 .registry.json',
    why: '产者 registerArtifact 是"每次产出时登记一笔"（增量追加），不是"从头算一遍"；且产物删了它不自知（缺失效判据）。',
  },

  // ── 源头（外部产生，不该 derive）─────────────────────────────
  {
    id: 'dsl_features',
    kind: 'source',
    owner: 'dataHome',
    inputs: [],
    note: '设计 DSL（意图册）—— 活态 agent-io.json / 存档 features/<f>.json',
    locate: (ctx) => getFeatureFile(needFeature(ctx)),
    why: '它是**意图**，由人/工具通过 saveDSL 写进来；没有"从别的东西派生出来"的语义 ⇒ 不是工序，是源头。',
  },
  {
    id: 'archive',
    kind: 'source',
    owner: 'dataHome',
    inputs: [],
    note: '下线库归档条目（里程碑）',
    why: '里程碑式产物，append 语义；没有"新鲜度"也没有"重做"。',
  },
  {
    id: 'observe_events',
    kind: 'source',
    owner: 'project',
    inputs: [],
    note: '运行时事件流（探针 append-only）',
    why: '由插桩后的程序在运行时追加；TS 侧只读。★ 全局单 sink 的历史包袱另记（不在本表职责内）。',
  },
  {
    id: 'observe_ledger',
    kind: 'source',
    owner: 'project',
    inputs: ['observe_events'],
    note: '插桩台账（每次插桩产一份，uninstrument 删）',
    why: '运行产物，随插桩动作产生。',
  },
  {
    id: 'dogfood',
    kind: 'source',
    owner: 'dataHome',
    inputs: [],
    note: '用量统计流水（append-only）',
    why: 'append-only 流水，没有"重做"。',
  },
  {
    id: 'self_writes',
    kind: 'source',
    owner: 'project',
    inputs: [],
    note: '自写登记（"我们自己改了哪些文件"的写穿凭证，读侧消费即清）',
    why: '它是**一次写的凭证**，产生它的时刻就是那次写；事后"重做"没有意义（重做也造不出那次写的事实）。',
  },
  {
    id: 'impact_ledger',
    kind: 'source',
    owner: 'project',
    inputs: ['symbol_index'],
    note: '影响台账（申报 → 消费核对，pending 有 24h TTL）',
    why: '由工具在"声明要改哪些文件"时写进来；是**承诺**不是派生。',
  },
];

// ─────────────────────────────────────────────────────────────
// 投影（全部由上面那张表推出来，不再另写一份）
// ─────────────────────────────────────────────────────────────

const BY_ID: ReadonlyMap<StageId, Stage> = new Map(STAGES.map((s) => [s.id, s]));

export function getStage(id: StageId): Stage {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`未登记的工序：${id}`);
  return s;
}

/** 投影：还没接产者的工序（= 可数的债） */
export function pendingStages(): PendingStage[] {
  return STAGES.filter((s): s is PendingStage => s.kind === 'pending');
}

/** 投影：缺"真"新鲜判据的派生工序（只有 `locate` 的存在性，或连位置都没有） */
export function weakFreshnessStages(): DerivedStage[] {
  return STAGES.filter((s): s is DerivedStage => s.kind === 'derived' && !s.isFresh);
}

/**
 * 投影：溯源图必须是 **DAG**。
 * ★ 这是本模块**唯一**必须运行时查的东西（类型系统表达不了"无环"）；其余检查都已交给编译器。
 */
export function assertAcyclic(): void {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<StageId, number>();
  const walk = (id: StageId, trail: StageId[]): void => {
    const c = color.get(id) ?? WHITE;
    if (c === BLACK) return;
    if (c === GRAY) throw new Error(`溯源图成环：${[...trail, id].join(' → ')}（"缺了往上溯源"会永远溯不完）`);
    color.set(id, GRAY);
    for (const up of getStage(id).inputs) walk(up, [...trail, id]);
    color.set(id, BLACK);
  };
  for (const s of STAGES) walk(s.id, []);
}

/** 投影：文档表（账本里那张不再手抄，改由它渲染） */
export function renderStageTable(): string {
  const rows = STAGES.map((s) => {
    const who =
      s.kind === 'derived' ? '✅ 已接产者' : s.kind === 'source' ? '— 源头（外部产生）' : `★ 欠产者：${s.why}`;
    const ups = s.inputs.length ? s.inputs.map((i) => `\`${i}\``).join(' ') : '—';
    return `| \`${s.id}\` | ${s.owner} | ${ups} | ${s.kind} | ${s.note} | ${who} |`;
  });
  return ['| 工序 id | 根 | 上游 | 类别 | 这是什么 | 产者 |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

// ─────────────────────────────────────────────────────────────
// 执行：缺了就重做，失败就重试，**不兜底**
// ─────────────────────────────────────────────────────────────

/** 重试次数。★ 重试而不是降级：失败说明"这道工序这次没做出来"，那就再做一次。 */
export const PRODUCE_ATTEMPTS = 3;

export interface EnsureResult {
  id: StageId;
  /** 'fresh' = 本来就在；'produced' = 这次做出来了 */
  action: 'fresh' | 'produced';
}

/**
 * 保证工序 `id` 的产物在。缺 ⇒ 溯源上游 ⇒ 重做 ⇒ 失败重试 ⇒ 仍失败**抛**。
 * ★ `source` ⇒ 只检查在不在（不可"重做"）；`pending` ⇒ **抛**（没有产者，没人能做出来）。
 */
export async function ensureStage(id: StageId, ctx: StageCtx = {}): Promise<EnsureResult> {
  const stage = getStage(id);

  if (stage.kind === 'pending') {
    throw new Error(`工序 "${id}" 没有产者，做不出来：${stage.why}\n★ 这里**故意不兜底**（不拿别处的数据顶替）。`);
  }

  if (stage.kind === 'source') {
    const st = locateState(stage, ctx);
    if (st.kind === 'no-locate' || st.kind === 'present') return { id, action: 'fresh' };
    if (st.kind === 'error') throw new Error(`源头 "${id}" 的位置算不出来：${st.message}`);
    throw new Error(
      `源头 "${id}" 不存在：${st.at}\n` +
        `★ 它是**外部产生**的（${stage.why}），本模块造不出来 —— 先把它准备好。**不兜底**。`,
    );
  }

  if (isFresh(stage, ctx)) return { id, action: 'fresh' };

  // ★ 溯源：先把上游都做出来（用户："这个数据没有，就往上面去溯源上一级的加工工序"）
  for (const upId of stage.inputs) await ensureUpstream(upId, ctx);

  await produceWithRetry(stage, ctx);
  return { id, action: 'produced' };
}

/** 处理一个上游：derived ⇒ 递归 ensure；source ⇒ 查在不在；pending ⇒ 抛 */
async function ensureUpstream(id: StageId, ctx: StageCtx): Promise<void> {
  const up = getStage(id);
  if (up.kind === 'derived') {
    await ensureStage(id, ctx);
    return;
  }
  if (up.kind === 'pending') {
    throw new Error(
      `上游工序 "${id}" 没有产者（${up.why}）⇒ 本工序必然做不出来。★ **不兜底** —— 先把这一道接上。`,
    );
  }
  const st = locateState(up, ctx);
  if (st.kind === 'no-locate' || st.kind === 'present') return;
  if (st.kind === 'error') {
    // ★ 这一条是**诊断的正确性**：算不出位置 ≠ 不存在。把真正的原因（缺 feature / 缺根）原样带出去。
    throw new Error(`上游源头 "${id}" 的位置算不出来：${st.message}`);
  }
  throw new Error(`上游源头 "${id}" 不在：${st.at}\n★ **不兜底** —— 先把 ${id} 准备好。`);
}

/**
 * 位置的三态。
 * ★★ 为什么不写成 `boolean`（2026-10-01 自检逼出来的）：
 *   布尔会**把两件事混成一件** —— "位置**算不出来**"（根/feature 没给齐）与"**算出来了但不存在**"。
 *   合并的后果是**诊断撒谎**：缺 feature 时报"上游源头不在"，把人引向完全错误的方向。
 *   这正是本仓反复栽的那一类（判据分叉 / 量具少看一层 ⇒ 把正常差异报成缺陷）。
 */
type LocateState =
  | { kind: 'no-locate' }
  | { kind: 'present'; at: string }
  | { kind: 'absent'; at: string }
  | { kind: 'error'; message: string };

function locateState(stage: Stage, ctx: StageCtx): LocateState {
  if (!stage.locate) return { kind: 'no-locate' };
  let at: string;
  try {
    at = stage.locate(ctx);
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  return fs.existsSync(at) ? { kind: 'present', at } : { kind: 'absent', at };
}

function isFresh(stage: DerivedStage, ctx: StageCtx): boolean {
  if (stage.isFresh) return stage.isFresh(ctx);
  // 算不出位置 / 不存在 ⇒ 都不算新鲜（去 produce，让它**响亮地**报缺什么）
  return locateState(stage, ctx).kind === 'present';
}

/**
 * ★ **失败就重试**（默认 `PRODUCE_ATTEMPTS` 次），仍失败则**抛**（不降级、不返回半成品）。
 * 导出它：一是 `ensureStage` 用它，二是"重试"这件事本身要被**直接验证**（不必为测试造一个假产者）。
 */
export async function produceWithRetry(stage: DerivedStage, ctx: StageCtx = {}): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= PRODUCE_ATTEMPTS; attempt++) {
    try {
      await stage.produce(ctx);
      return;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    `工序 "${stage.id}" 连续 ${PRODUCE_ATTEMPTS} 次都没做出来：${last instanceof Error ? last.message : String(last)}`,
  );
}

function needFeature(ctx: StageCtx): string {
  if (!ctx.feature?.trim()) {
    throw new Error('这道工序需要 feature（没有就做不出来）。★ 这里**故意不兜底** —— 不拿别的 feature 顶替。');
  }
  return ctx.feature;
}
