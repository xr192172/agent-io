/**
 * claim_conflict.ts —— 「**我要碰的东西，是不是已经被别的卡占了**」：**领卡时**的冲突检测。
 *
 * ## 它买的是什么（用户 2026-10-21 的判据，逐字）
 * > 「重点是**交给 LLM 分工**：领了这张卡的同时，别人能领和这张卡**互不影响的卡**去并行做。
 * >  假如它和另一张卡会有干涉，则要**强制它们分开**……**每一次开始领取这个任务的时候，
 * >  都重新算一遍，然后和边上已有的存档的读集进行对照**。」
 *
 * ⇒ 本模块只做一件事：**claim 时**算这张卡的读集（= 它这一轮要碰的东西），
 *   与其他 `state==='claimed'` 的卡逐一比交，**相交就拒领**。
 *
 * ## ★★★ 为什么阻塞（与写前的 `assumption_check` 不是一回事）
 * | 时机 | 问题 | 强度 | 理由 |
 * |---|---|---|---|
 * | **claim**（还没开工） | 要碰的东西被别人占了吗 | **阻塞** | 拒了没损失 —— 换个卡/等一等即可 |
 * | 写前（已经干了一半） | 我读的东西变了吗 | **只报** | 拦住会丢掉已做完的那一半 |
 * ⇒ 两个时机、两种强度，判据各住一处（`read_set.ts#checkAssumptions` 管后者）。
 *   **不许**把它们合并成一个“冲突检查”：合并后要么领卡被报告淹没，要么写前把人拦住。
 *
 * ## ★★★ 用哪套基准（2026-10-30 改成**二元口径**：卡已成立 ⇒ 改集；未成立 ⇒ 读集）
 * 用户原话：「刚开始领任务的时候是读集，但是后面在进行设计之后，就这个任务卡**正式成立**的时候，
 * 受到修改的这些部分会**坍缩为改集**，就不再依赖读集，而是依赖**改集**了。」
 * ⇒ 判定**只住一处**：`src/domain/conflict_basis.ts#selectConflictBasis`（本文件只调它，不另算）。
 * 1. **画布坍缩集非空（卡已成立）** ⇒ **只用它**：`declared` / 判据 / 节点文件**一律不参与**。
 *    ★ 不许取并集：卡已有坍缩集之后，早期随手声明的宽读集若还占位，就会把「只碰那些多余符号」的卡挡住 ——
 *      那是**假阻塞**。而假阻塞比漏判更打击积极性（这句本来就写在本节里，只是当时只防了「画布展开态」那一侧）。
 * 2. **画布为空（卡未成立）** ⇒ 回到读集，按优先级**去重合并**：
 *    a. `declared`（`data.read_set`）：**干活的人自己说**「我要碰这些符号/文件」。最准 ——
 *       因为“这张卡要做什么”只存在于领卡人的意图里，任何机械推导都只是代理量（proxy）。
 *    b. `expectations`：卡上判据里**点名的**符号 —— `symbol-exists` / `signature-matches` / `call-exists`
 *       的 `path+symbol`（这张卡**必须把它做出来** ⇒ 一定会碰它），`file-exists` / `source-has` 的 `path`。
 *       ⇒ 机械可算、不需要调用方诚实，作为“没声明时”的主兜底。
 *    c. `node-path`：节点自己的文件（`path` 优先，与写闸 `byPath` 同一把尺）。
 *       只到文件级 —— 这是 L1 卡（0 条判据）唯一能算出来的东西。
 * ⇒ 本次用的是哪套基准，会写进 claim 回执：`冲突基准 = canvas（改集 3 个符号）` /
 *   `read-set（声明 5 个符号 + 判据 2 个）`（渲染唯一住处 = 本文件的 `claimBasisLine`）。
 *
 * ### ★ 为什么**不**用「节点文件 + imports 兜底」（用户候选 b）—— 实测否掉
 * 在本仓 `task-system-plan`（89 张活卡）上按三种判据各算一遍、两两求交（读数为本笔回执）：
 * | 判据 | 卡片对数 | 相交对数 | 占比 |
 * |---|---|---|---|
 * | b：节点文件 + 1 跳 imports | 3916 | **913** | **23.3%** |
 * | a：判据点名（符号级） | 3916 | 4 | 0.1% |
 * | **本模块 d+a+node-path** | 3916 | 8 | 0.2% |
 * ⇒ b 会让**每四对卡里就有一对互相拒领**：`src/application/plumbing.ts` 这种公共入口被
 *   几十张卡 import ⇒ 谁都和谁“冲突”。那不是并发控制，那是**把并行关掉**。
 *   ★ 而且 b 在语义上答错了题：imports 是「这个文件**已经依赖**什么」（读它不互相影响），
 *     不是「这个任务**要碰**什么」。**依赖被改**属于写前那个时机（`assumption_check` 的
 *     Dependency 层，只报不拦）—— 已经有一个判据在那儿，这里再来一份就是两处权威。
 *
 * ### ★ 判据 a 单独也不够（所以它是第 2 级、不是唯一）
 * 只有 28/89 张卡有判据点名的符号（L1 建构卡 0 条判据）⇒ a 单独会让 61 张卡“读集为空 = 永不冲突”。
 *   本模块用 `node-path` 给它们兜到文件级，并在 `basis` / `note` 里**明示**这一次只到文件级。
 *
 * ### ★ 已知限度（如实写，别在文档里假装没有）
 * · **读集不是写集**：两张卡读同一个符号**不算**冲突（这是有意的，否则又回到 b 的粗粒度）。
 * · **跨项目不比**：只与「册住在本项目 `.agent-io/design/` 下」的 feature 里的卡比（别的仓与本仓并行不冲突）——
 *   判据 = `storage#isSameProject`，**不是**比 `source_root`。
 * · **老卡没有读集** ⇒ 记 `unchecked` 并**在回执里点名**：那是“没比”，不是“不冲突”。
 * · **粒度到符号为止**：同一文件里两个不相交的符号会被判**不冲突**（符号级放行）；
 *   真正的并发写保护仍由写闸 A7（同一文件只认一张卡）与 git 层负责 —— 这里不假装能替代它们。
 */

import path from 'node:path';
import { nodePath } from '../domain/overlay.js';
import type { Expectation } from '../domain/expectation.js';
import type {
  TaskReadSet,
  TaskReadSetBasis,
  TaskReadSetFile,
  TaskReadSetSymbol,
  TaskSpec,
} from '../domain/task_schema.js';
import { todosForNode } from '../domain/task_schema.js';
// ★ 2026-10-30（用户：「任务卡正式成立的时候…就不再依赖读集，而是依赖改集」）：基准判定
//   （画布坍缩集 vs 读集）是**零依赖纯函数**，住 domain ⇒ 它自己能被 behavior-cases 直接跑
import { selectConflictBasis, type ConflictSymbol } from '../domain/conflict_basis.js';
// ★ 2026-10-28：读集可来自**画布坍缩集**（判据唯一实现在 rewrite_plan.ts，这里只调用）
import { readRewritePlan, planChangeSet, planChangeSetOfCard } from './design/db/rewrite_plan.js';
import { listDesignSheets, isSameProject } from '../infrastructure/storage.js';
import { toIndexKey } from '../infrastructure/index/symbols.js';
import { loadFileFacts, type FactsCache } from './read_set.js';

/**
 * 一张卡最多存多少条符号（超限 **拒 claim**，不静默截断）。
 * ★ 为什么是“拒”而不是“截断”：截断的读集 = **漏掉的冲突**，而漏掉的冲突正是这个能力要防的事。
 *   拒的时候报文让人「缩小 `data.read_set` 声明或拆卡」—— 一张要碰几百个符号的卡，
 *   本来就不是能与人并行的粒度。
 */
export const MAX_CARD_SYMBOLS = 200;

/** 一张卡最多存多少个文件（同上） */
export const MAX_CARD_FILES = 100;

/** 调用方在 `claim` 时显式声明的读集（`data.read_set`）—— 形状宽松，**校验在这里**（唯一一处） */
export interface DeclaredReadSet {
  /** 要碰的符号：`[{file:'src/x.ts', name:'foo'}]`（`name` 可以是短名，落盘时归一成 qualified_name） */
  symbols?: Array<{ file?: string; name?: string }>;
  /** 要碰的文件（整文件级；仓库相对路径或绝对路径） */
  files?: string[];
}

/**
 * 把 `data.read_set` 的**原始值**解析成 {@link DeclaredReadSet}；形状不对就**抛**（不静默忽略）。
 * ★ 为什么不在这里做 zod：本仓的守卫习惯是“离判据最近的地方抛”，而形状判据只此一处
 *   （`op_data_spec` 只管“认不认这个键”，不管值形状 —— 那是它自己的边界）。
 */
export function parseDeclaredReadSet(raw: unknown): DeclaredReadSet | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `claim 被拒（data.read_set 形状）：它必须是对象 \`{ symbols?: [{file,name}], files?: [path] }\`，收到 ${JSON.stringify(raw)}。`,
    );
  }
  const o = raw as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => k !== 'symbols' && k !== 'files');
  if (extra.length) {
    throw new Error(
      `claim 被拒（data.read_set 形状）：不认识的键 ${extra.join(' / ')} —— 只认 \`symbols\`（[{file,name}]）与 \`files\`（[path]）。`,
    );
  }
  const out: DeclaredReadSet = {};
  if (o.symbols !== undefined) {
    if (!Array.isArray(o.symbols)) {
      throw new Error(`claim 被拒（data.read_set.symbols 形状）：必须是数组，收到 ${JSON.stringify(o.symbols)}。`);
    }
    out.symbols = o.symbols.map((s, i) => {
      if (!s || typeof s !== 'object') {
        throw new Error(`claim 被拒（data.read_set.symbols[${i}]）：每项必须是 \`{file,name}\`，收到 ${JSON.stringify(s)}。`);
      }
      const r = s as Record<string, unknown>;
      if (typeof r.file !== 'string' || !r.file.trim() || typeof r.name !== 'string' || !r.name.trim()) {
        throw new Error(
          `claim 被拒（data.read_set.symbols[${i}]）：\`file\` 与 \`name\` 都必须是非空字符串，收到 ${JSON.stringify(s)}。`,
        );
      }
      return { file: r.file, name: r.name };
    });
  }
  if (o.files !== undefined) {
    if (!Array.isArray(o.files) || o.files.some((f) => typeof f !== 'string' || !f.trim())) {
      throw new Error(`claim 被拒（data.read_set.files 形状）：必须是非空字符串数组，收到 ${JSON.stringify(o.files)}。`);
    }
    out.files = o.files as string[];
  }
  return out;
}

/** 算读集要的输入（★ 事实只有两样：项目根、卡挂的那个节点） */
export interface ClaimReadSetInput {
  /** 被分析项目的根（`dsl.source_root`）—— 读集里的路径一律相对它 */
  root: string;
  /** 卡的 id（= 节点 id）；只用于报文与 note */
  cardId: string;
  /**
   * 卡挂的那个节点 —— ★ 判据也在这里现取（`node.decision.expectations`：判据唯一住处，
   * 任务格不自持）；todo 卡没有节点 ⇒ 判据恒 0 条。
   */
  node?: {
    id: string;
    type?: string;
    path?: string;
    decision?: { expectations?: Expectation[] };
  };
  /** 调用方在 claim 时显式声明的读集 */
  declared?: DeclaredReadSet;
}

/** 每一级各贡献了多少（符号 / 文件）—— 回执那行「冲突基准 = …」就用它，不另算一遍 */
export interface ClaimBasisCount {
  symbols: number;
  files: number;
}

/**
 * 这一次 claim 的**基准读数**（结构化；人读文案由 {@link claimBasisLine} 渲染）。
 *
 * ★ 为什么要一个结构化版本：`decidedBy` 是**二元口径**（画布坍缩集 / 读集），
 *   而 `basis` 只说"哪几级出过力"。回执要同时回答「用的是哪套基准」与「凭什么是它」——
 *   只给 `readSet.basis` 时，读者分不清"画布和声明**并列**生效"（旧行为）与"只在画布里"（新行为）。
 */
export interface ClaimBasisReading {
  decidedBy: 'canvas' | 'read-set';
  /** 实际生效的那几级（与 `readSet.basis` 同一份，这里带出来便于回执直接读） */
  basis: TaskReadSetBasis[];
  /** 四级各有多少条目（`nodePath` 只到文件级，所以 symbols 恒 0） */
  counts: {
    canvas: ClaimBasisCount;
    declared: ClaimBasisCount;
    expectations: ClaimBasisCount;
    nodePath: ClaimBasisCount;
  };
}

/** 把某一级的计数渲染成 `声明 5 个符号 · 1 个文件`；**一级都没出力的不出现**（不出 `声明 0`） */
function renderBasisCount(label: string, c: ClaimBasisCount): string {
  const bits: string[] = [];
  if (c.symbols) bits.push(`${c.symbols} 个符号`);
  if (c.files) bits.push(`${c.files} 个文件`);
  return `${label} ${bits.join(' · ')}`;
}

/**
 * 基准读数 → **一行**（claim 回执里那句「冲突基准 = …」的唯一实现；别在调用方再拼一份文案）。
 *
 * 两种口径长这样：
 * · 卡已成立 ⇒ `冲突基准 = canvas（改集 3 个符号 · 2 个文件）`
 * · 卡未成立 ⇒ `冲突基准 = read-set（声明 5 个符号 + 判据 2 个）`
 */
export function claimBasisLine(r: ClaimBasisReading): string {
  let detail: string;
  if (r.decidedBy === 'canvas') {
    detail = renderBasisCount('改集', r.counts.canvas);
  } else {
    const parts: string[] = [];
    if (r.counts.declared.symbols || r.counts.declared.files) parts.push(renderBasisCount('声明', r.counts.declared));
    if (r.counts.expectations.symbols || r.counts.expectations.files) {
      parts.push(renderBasisCount('判据', r.counts.expectations));
    }
    if (r.counts.nodePath.files) parts.push(`节点文件 ${r.counts.nodePath.files} 个`);
    detail = parts.length ? parts.join(' + ') : '空读集';
  }
  return `冲突基准 = ${r.decidedBy}（${detail}）`;
}

export interface ClaimReadSetResult {
  readSet: TaskReadSet;
  /** 给人读的退化说明（会进回执）—— 与 `readSet.note` 同源，这里分开只是便于调用方拼报文 */
  notes: string[];
  /**
   * ★ 结构化读数（`decidedBy` + 生效的 basis + 四级条数）。
   *   ★ 这里**只给结构、不给文案**：回执那一行由调用方 `claimBasisLine(basisReading)` 渲染
   *   （渲染唯一住处 = {@link claimBasisLine}）—— 本函数不预渲染一份可能没人用的字符串。
   */
  basisReading: ClaimBasisReading;
}

/**
 * **算一张卡的读集**（判据见文件头「读集怎么算」；★ 唯一实现处）。
 *
 * ★ 这里**不判冲突**、**不写卡** —— 只产出值。冲突判定在 {@link detectClaimConflicts}，
 *   落盘在 `task_ops.ts#claimTask`（写端唯一）。
 *
 * ★★★ 2026-10-30（用户：「任务卡正式成立的时候…就不再依赖读集，而是依赖改集」）：
 *   本函数只做两件事 —— ① **收集**四类原始输入（declared / 画布坍缩集 / 判据点名 / nodePath）；
 *   ② 把「用哪套基准」交给零依赖纯函数 {@link selectConflictBasis} 判，然后**只落它选中的那一份**。
 *   ★ **不许**在这里把几级并起来：并集正是本卡要修的假阻塞（卡已有坍缩集，早期宽声明仍占位）。
 */
export function computeClaimReadSet(input: ClaimReadSetInput): ClaimReadSetResult {
  const root = path.resolve(input.root);
  const notes: string[] = [];
  const cache: FactsCache = new Map();
  /** key = `file#name`（归一成 qualified_name 之后） */
  const symbols = new Map<string, TaskReadSetSymbol>();
  const files = new Map<string, TaskReadSetFile>();
  const basis: TaskReadSetBasis[] = [];
  /** 点名了但**此刻不存在**的符号（★ 聚合后只出一条 note：20 条重复会把卡撑肿、也会淹掉回执） */
  const missingSyms: string[] = [];
  /** 事实**取不到**（索引与磁盘不同源、且解析器未预热）⇒ 符号有名字但没指纹 */
  let noFp = 0;

  // ── ⓪ 收齐四类**原始输入**（这一步只收集，不判定「用哪套基准」）──
  const declaredIn: { symbols: ConflictSymbol[]; files: string[] } = { symbols: [], files: [] };
  const expectationsIn: { symbols: ConflictSymbol[]; files: string[] } = { symbols: [], files: [] };
  const canvasIn: Array<{ file: string; symbol: string }> = [];

  // ① 显式声明（最准：要干活的那个人说的）
  for (const f of input.declared?.files ?? []) declaredIn.files.push(f);
  for (const s of input.declared?.symbols ?? []) {
    if (!s.file || !s.name) continue; // 形状已在 `parseDeclaredReadSet` 拒过；这里只做类型收窄
    declaredIn.symbols.push({ file: s.file, name: s.name });
  }

  // ①' 画布**坍缩集**（用户 2026-10-28：「画布展开时设计完后应该坍缩成被改动的节点」）──
  //   ★ 只用坍缩集（`status !== 'done'` 的符号），**不用展开态**：否则「我只是看过」也会被算成争用。
  //   ★ 2026-10-28（用户："任务卡应该挂在**画布**和**探索后的改集**上"）：
  //     卡的改集 = **它名下所有画布**坍缩集的并集（跨文件）；不再只用"节点 path 那一份"。
  try {
    for (const c of planChangeSetOfCard(root, input.cardId)) canvasIn.push({ file: c.file, symbol: c.symbol });
  } catch {
    // 卡级扫描失败 ⇒ 不拖死 claim（下面还有单文件与判据兜底）
  }
  // 回落：卡没登记任何画布时，仍试**节点自己那份**（兼容"一张卡一个节点一份画布"的旧用法）
  if (!canvasIn.length) {
    const canvasPath = typeof input.node?.path === 'string' ? input.node.path.trim() : '';
    if (canvasPath) {
      try {
        // ★★★ 2026-11-05（R24）：这一腿**也是领卡读集**，必须与 `planChangeSetOfCard` 同一口径。
        //   `planChangeSetOfCard` 过滤后，卡没有在册画布时 `canvasIn` 会变空 ⇒ 走到这条兜底腿；
        //   它若照旧读「这个文件最新那份」（含已消解）⇒ 已软消解的画布被捡回来，**假阻塞换个形态复活**。
        //   `aliveOnly:true` 的语义、以及缺省值为什么保持「不过滤」，见 `rewrite_plan#readRewritePlan` 的参数说明。
        for (const c of planChangeSet(readRewritePlan(root, canvasPath, undefined, { aliveOnly: true }))) {
          canvasIn.push({ file: c.file, symbol: c.symbol });
        }
      } catch {
        // 画布坏了 ⇒ 如实跳过这一级（判据与节点兜底仍在）
      }
    }
  }

  // ② 判据点名（机械可算；判据从节点的 decision 现取 —— 任务格不自持；L1 卡 0 条 ⇒ 这一级什么都不产出）──
  let edgeNotes = 0;
  for (const e of input.node?.decision?.expectations ?? []) {
    if (!e || typeof e !== 'object') continue;
    const kind = (e as { kind?: unknown }).kind;
    const p = (e as { path?: unknown }).path;
    const sym = (e as { symbol?: unknown }).symbol;
    if (kind === 'symbol-exists' || kind === 'signature-matches' || kind === 'call-exists') {
      if (typeof p === 'string' && p && typeof sym === 'string' && sym) expectationsIn.symbols.push({ file: p, name: sym });
      continue;
    }
    if (kind === 'file-exists' || kind === 'source-has') {
      if (typeof p === 'string' && p) expectationsIn.files.push(p);
      continue;
    }
    if (kind === 'edge-exists' || kind === 'edge-absent') edgeNotes++;
  }
  if (edgeNotes) {
    notes.push(
      `${edgeNotes} 条 edge-* 判据的**两端只作读**（判边界要读对方）⇒ 不算占位；` +
        `把对方文件算进来会让所有跨文件任务互相拒（这正是 imports 兜底被否掉的同一个坑）`,
    );
  }

  // ③ 节点自己的文件（最粗的兜底；L1 卡唯一能算出来的东西）──
  const n = input.node;
  let nodePathIn = '';
  if (n) {
    // ★ T-#37：回落 `description` 的分支已删（`Node.description` 不存在）
    nodePathIn = typeof n.path === 'string' ? n.path.trim() : '';
    if (!nodePathIn) notes.push(`节点 ${input.cardId} 没有 \`path\` ⇒ 连文件级兜底都没有`);
  }

  // ── ★★★ ①'' 基准判定（唯一判据 = `domain/conflict_basis.ts#selectConflictBasis`）──
  //   画布坍缩集非空 ⇒ **只用它**（declared / 判据 / 节点文件一律不参与）；为空 ⇒ declared → 判据 → 节点文件。
  const sel = selectConflictBasis({
    declared: declaredIn,
    canvas: canvasIn,
    expectations: expectationsIn,
    nodePath: nodePathIn,
  });
  for (const b of sel.basis) if (!basis.includes(b)) basis.push(b);
  // ★ 卡已成立却还带着一份显式声明 ⇒ 必须说清「声明被忽略了」（否则读回执的人以为自己在占位）
  if (sel.decidedBy === 'canvas' && (declaredIn.symbols.length || declaredIn.files.length)) {
    notes.push(
      `卡已有**画布坍缩集** ⇒ 按「改集」占位：本次**不采用**显式声明的读集` +
        `（声明 ${declaredIn.symbols.length} 个符号 / ${declaredIn.files.length} 个文件被忽略 —— 两套取并集正是假阻塞的来源）`,
    );
  }

  const addFile = (rawPath: string): void => {
    const rel = toIndexKey(root, rawPath);
    if (!rel) {
      notes.push(`\`${rawPath}\` 在项目根外 ⇒ 不进读集（没有索引键，也就无法与别人的读集比）`);
      return;
    }
    if (files.has(rel)) return;
    const facts = loadFileFacts(root, rel, cache);
    files.set(rel, { path: rel, content_hash: facts.file_fp });
  };

  const addSymbol = (rawPath: string, rawName: string): void => {
    const rel = toIndexKey(root, rawPath);
    if (!rel) {
      notes.push(`符号 \`${rawName}\` 所在文件 \`${rawPath}\` 在项目根外 ⇒ 不进读集`);
      return;
    }
    const facts = loadFileFacts(root, rel, cache);
    // ★ 归一：声明可以给短名 ⇒ 落到**索引里的 qualified_name**，否则两张卡会对不上同一个符号
    const hit = facts.symbols.find((s) => s.symbol === rawName) ?? facts.symbols.find((s) => s.name === rawName);
    const name = hit?.symbol ?? rawName;
    const key = `${rel}#${name}`;
    // ★ 要碰一个符号 ⇒ **也占住它所在的文件**（写是文件级的：`edit_code` 整文件重写）
    addFile(rel);
    if (symbols.has(key)) return;
    symbols.set(key, { file: rel, name, fp: hit?.fp ?? '' });
    // ★ 两种“没有指纹”必须分开说（把“解析器没预热”写成“符号不存在”就是假读数）：
    //   · `source==='none'` ⇒ 这个文件的事实**根本没取到**（名字仍参与比对，只是没有 fp）；
    //   · 否则 ⇒ 索引/现解析里确实没有这个符号（这张卡大概要**新建**它）。
    if (!hit) {
      if (facts.source === 'none') noFp++;
      else missingSyms.push(`${rel}#${rawName}`);
    }
  };

  // ★ 最终读集 = 基准选出来的那一份（★ 不许再回去把别的级并进来）
  for (const f of sel.files) addFile(f);
  for (const s of sel.symbols) addSymbol(s.file, s.name);

  if (missingSyms.length) {
    notes.push(
      `${missingSyms.length} 个点名的符号此刻**不存在**（fp 为空 ⇒ 按“要新建它”记）：` +
        `${missingSyms.slice(0, 5).join(' / ')}${missingSyms.length > 5 ? ' …' : ''}`,
    );
  }
  if (noFp) {
    notes.push(
      `${noFp} 个符号的**指纹取不到**（索引与磁盘不同源、且解析器未预热）⇒ fp 留空；` +
        '★ **名字照旧参与冲突比对**（比的是 file#name，不是 fp）',
    );
  }

  if (symbols.size > MAX_CARD_SYMBOLS || files.size > MAX_CARD_FILES) {
    throw new Error(
      `claim 被拒（读集太小不了）：这张卡的读集 **${symbols.size} 个符号 / ${files.size} 个文件**，` +
        `超过上限（${MAX_CARD_SYMBOLS} 符号 / ${MAX_CARD_FILES} 文件）。\n` +
        `★ 为什么不截断：截断的读集 = 漏掉的冲突，而漏冲突正是这个闸要防的事。\n` +
        `★ 怎么办：① 缩小 \`data.read_set\` 声明到**这一轮真的要碰**的符号；② 这张卡粒度太粗 ⇒ 拆卡（并行也才有意义）。`,
    );
  }

  const sortedSymbols = [...symbols.values()].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const sortedFiles = [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!sortedSymbols.length && !sortedFiles.length) {
    notes.push(
      '读集**为空**（卡上没有能定位到文件/符号的判据，节点也没有路径，调用方也没声明）⇒ ' +
        '这次**没有可比的东西**，不代表“与别人不冲突”',
    );
  }

  const basisReading: ClaimBasisReading = {
    decidedBy: sel.decidedBy,
    basis: [...basis],
    counts: {
      // ★ 画布的条数按**原始条目**数（`planChangeSetOfCard` 产出的每一条都带 file+symbol，不会混进空串）
      canvas: { symbols: canvasIn.length, files: new Set(canvasIn.map((c) => c.file)).size },
      declared: { symbols: declaredIn.symbols.length, files: declaredIn.files.length },
      expectations: { symbols: expectationsIn.symbols.length, files: expectationsIn.files.length },
      nodePath: { symbols: 0, files: nodePathIn ? 1 : 0 },
    },
  };

  return {
    readSet: {
      symbols: sortedSymbols,
      files: sortedFiles,
      computed_at: new Date().toISOString(),
      basis,
      ...(notes.length ? { note: notes.join('；') } : {}),
    },
    notes,
    basisReading,
  };
}

/** 一张**活跃卡**（`state==='claimed'`）与它的读集；`card_id` 形如 `feature/node_id`（报文要点名到实体） */
export interface ActiveClaim {
  card_id: string;
  owner: string | null;
  read_set: TaskReadSet;
}

/** 一张活跃卡**没有读集**（本能力上线前领的 / todo 卡）⇒ 这次没比 —— 不是“不冲突” */
export interface UncheckedClaim {
  card_id: string;
  owner: string | null;
}

export interface ClaimConflictHit {
  card_id: string;
  owner: string | null;
  /** 撞上的符号（`fp` 两边都带：不同 ⇒ 说明中间已经有改动落地了） */
  symbols: Array<{ file: string; name: string; fp_mine: string; fp_theirs: string }>;
  /** 撞上的文件（符号级之外，还有整文件级的占位） */
  files: string[];
}

export interface ClaimConflictReport {
  /** 真的比了几张卡（有读集、state=claimed、不同项目根以外的都排除掉了） */
  checked: number;
  /** 同项目根里**活跃但没有读集**的卡（点名；本期没比） */
  unchecked: UncheckedClaim[];
  /** 参与对照的 feature（读数：证明扫了哪些册） */
  features: string[];
  /** 非空的每一项都是**拒领**的理由 */
  conflicts: ClaimConflictHit[];
}

/**
 * 收集**同项目根**下全部 `state==='claimed'` 的卡（排除自己）—— 对照的另一半。
 *
 * ★ 为什么跨 feature 扫（而不是只看本卡所在的那一册）：两份 feature 的 `source_root` 可以指向**同一个项目**
 *   （本仓实测就有两份：`design-canvas` / `task-system-plan`）⇒ 只扫一册会漏掉另一册上的占位。
 * ★ 代价（如实说）：每次 claim 要把所有设计册读一遍（本仓 2 册 ≈ 5.5 MB JSON）。claim 是低频动作
 *   （一卡一次），且写闸本来就在每次写前做同样的事 —— 不额外引入新的热路径。
 */
export function collectActiveClaims(
  root: string,
  /** ★ 自己 = **(feature, id) 两元组**：两份 feature 可以有同名节点（本仓实测就有）⇒ 只按 id 排自己会漏掉另一册上的同一张卡 */
  self: { feature: string; id: string },
): { claims: ActiveClaim[]; unchecked: UncheckedClaim[]; features: string[] } {
  const absRoot = path.resolve(root);
  const claims: ActiveClaim[] = [];
  const unchecked: UncheckedClaim[] = [];
  const features: string[] = [];
  for (const dsl of listDesignSheets()) {
    // ★★★ 2026-11-01（第二个 P0）：跨项目**不比** —— 只与「册住在本项目 design/ 下」的 feature 里的卡比
    //   （`storage#isSameProject`）。改前比 `path.resolve(dsl.source_root) !== absRoot`：那是写册那台机器的
    //   绝对路径 ⇒ 换机器恒 false ⇒ 对照集恒空 ⇒ 并发冲突检测**静默失效**。
    if (!isSameProject(dsl, absRoot)) continue;
    features.push(dsl.feature);
    // ★★★ 2026-10-22（迁移第②步 · 读端切到 todos[]）：**同一张卡只对照一次**。
    //   第①步把节点卡逐字并进 `todos[]` ⇒ 两处都收会把同一张 claimed 卡报两遍（`card_id` 一样、
    //   冲突项重复），也会让"同一批文件的另一张卡"看起来有两张。
    //   判据与 `pool#listPool` **同一把尺**：`todos[]` 里有卡指向该节点 ⇒ 节点那份是派生投影，跳过。
    const todos = dsl.todos ?? [];
    const cards: Array<{ id: string; task: TaskSpec | undefined }> = [
      ...(dsl.geometry?.nodes ?? [])
        .filter((n) => todosForNode(n.id, todos).length === 0)
        .map((n) => ({ id: n.id, task: n.task })),
      ...todos.map((t) => ({ id: t.id, task: t })),
    ];
    for (const c of cards) {
      const t = c.task;
      if (!t || t.state !== 'claimed') continue;
      // ★ 自己不比（重复 claim 的自我冲突由 CAS 先一步拒掉）；比较身份是 (feature, id)，不是 id
      if (dsl.feature === self.feature && c.id === self.id) continue;
      const rs = t.read_set;
      const usable = !!rs && ((rs.symbols?.length ?? 0) > 0 || (rs.files?.length ?? 0) > 0);
      if (!usable) {
        unchecked.push({ card_id: `${dsl.feature}/${c.id}`, owner: t.owner ?? null });
        continue;
      }
      claims.push({ card_id: `${dsl.feature}/${c.id}`, owner: t.owner ?? null, read_set: rs as TaskReadSet });
    }
  }
  return { claims, unchecked, features };
}

/**
 * **比交**（本模块的唯一判据）：符号交集 或 文件交集 ≠ ∅ ⇒ 冲突。
 *
 * ★ 符号键 = `file#name`（两边都已归一成 qualified_name）；★ 文件键 = 仓库相对路径。
 * ★ 为什么文件也算：写是**文件级**的（`edit_code` 整文件重写）⇒ 同一文件上的两张卡并行 = 丢改动。
 */
export function detectClaimConflicts(
  mine: TaskReadSet,
  claims: readonly ActiveClaim[],
  meta: { unchecked: readonly UncheckedClaim[]; features: readonly string[] },
): ClaimConflictReport {
  const mineSyms = new Map<string, TaskReadSetSymbol>(mine.symbols.map((s) => [`${s.file}#${s.name}`, s]));
  const mineFiles = new Set(mine.files.map((f) => f.path));
  const conflicts: ClaimConflictHit[] = [];
  for (const c of claims) {
    const symbols: ClaimConflictHit['symbols'] = [];
    for (const s of c.read_set.symbols ?? []) {
      const k = `${s.file}#${s.name}`;
      const m = mineSyms.get(k);
      if (m) symbols.push({ file: s.file, name: s.name, fp_mine: m.fp, fp_theirs: s.fp });
    }
    const files: string[] = [];
    for (const f of c.read_set.files ?? []) {
      if (mineFiles.has(f.path)) files.push(f.path);
    }
    if (symbols.length || files.length) conflicts.push({ card_id: c.card_id, owner: c.owner, symbols, files });
  }
  return {
    checked: claims.length,
    unchecked: [...meta.unchecked],
    features: [...meta.features],
    conflicts,
  };
}

/** 指纹缩到 12 位给人读（与 `read_set.ts#shortFp` 同一个显示口径） */
const shortFp = (fp: string): string => (fp ? fp.slice(0, 12) : '（此刻不存在）');

/**
 * 冲突 ⇒ **拒领报文**（★ 必须点名到实体：哪张卡、谁领的、撞在哪个符号）。
 * ★ 这个函数只在 `conflicts.length > 0` 时被调用；文案里**不出现**“建议/可选” —— 它是**强制**。
 */
export function claimConflictMessage(report: ClaimConflictReport, mine: TaskReadSet): string {
  const lines: string[] = [
    `claim 被拒（读集冲突 · **强制**）：这张卡要碰的东西已被 ${report.conflicts.length} 张活跃卡占住 ⇒ ` +
      `**两张卡必须分开做**（不是提醒，是拒绝 —— 领卡时拒了没有任何损失）。`,
    '',
  ];
  // ★★★ 2026-11-05（R24 · 主控裁定）：**冲突读数必须自报来路** —— 「这些行是活画布，还是墓碑？」
  //   同一个"相交"在回执里长得**一模一样**，区别只在 `dissolved_at`；而读不出活/墓碑的冲突读数
  //   就无法区分「该做的排队」与「白排队」。⇒ 过滤（`planChangeSetOfCard` 带 `aliveOnlyClause`）
  //   保证进到这里的**只有**在册画布，本行把这条来路**说出来**，让读回执的人不必回头查库。
  lines.push(
    `★ 来路：上面这些相交**全部来自「在册」画布**（\`dissolved_at IS NULL\`）—— ` +
      `已软消解的画布（墓碑）不参与占位，所以这里不该出现"白排队"；` +
      `若你怀疑是假阻塞，先看那行的画布是不是已经落地了（R24）。`,
  );
  for (const c of report.conflicts) {
    lines.push(`  · 卡 \`${c.card_id}\`（owner=${c.owner ?? '（空）'}）`);
    for (const s of c.symbols) {
      const drift =
        s.fp_mine && s.fp_theirs && s.fp_mine !== s.fp_theirs
          ? `；★ 两边记的指纹不同（你 ${shortFp(s.fp_mine)} / 它 ${shortFp(s.fp_theirs)}）⇒ 那张卡领完之后这里**已经改过**`
          : '';
      lines.push(`      撞在**符号**：\`${s.file}#${s.name}\`${drift}`);
    }
    for (const f of c.files) lines.push(`      撞在**文件**：\`${f}\`（整文件占位）`);
  }
  lines.push('');
  lines.push(
    `★ 判据：claim 时把这张卡的读集（本次**现算**，依据=${mine.basis.join(' + ') || '（空）'}；` +
      `${mine.symbols.length} 符号 / ${mine.files.length} 文件）与其他 \`state=claimed\` 的卡逐一比交；` +
      `**符号交集或文件交集 ≠ ∅ ⇒ 拒**。`,
  );
  if (report.unchecked.length) {
    lines.push(
      `★ 另有 ${report.unchecked.length} 张活跃卡**没有读集**（本能力上线前领的）⇒ 这次没能比：` +
        report.unchecked.slice(0, 5).map((u) => `\`${u.card_id}\``).join(' / ') +
        (report.unchecked.length > 5 ? ' …' : '') +
        '（这是“没比”，不是“不冲突”）',
    );
  }
  lines.push('');
  lines.push('★ 怎么办（三选一）：');
  lines.push('  ① 等它 `release` / `complete`（释放后**不再占位**）；');
  lines.push(
    '  ② 若你**确实不碰**那个符号/文件 ⇒ 用 `data.read_set` 精确声明（`{symbols:[{file,name}],files:[path]}`），' +
      '让读集反映真实的施工面（★ 声明不是“绕过闸”：它会被原样落卡、被后面的人对照，说谎会在下一张卡上暴露）；',
  );
  lines.push('  ③ 换一张与它不重叠的卡 —— 这样两张卡才能**并行**。');
  return lines.join('\n');
}

/**
 * 成功领卡时的**一行读数**（★ 必须说清“比了几张 / 有几种没比”）。
 * 没有它，调用方无法区分「比了 0 张」和「谁都没冲突」—— 那是假绿灯。
 */
export function claimConflictLine(report: ClaimConflictReport, mine: TaskReadSet): string {
  const basis = mine.basis.length ? mine.basis.join(' + ') : '（空读集）';
  const head =
    `★ 读集已挂卡：${mine.symbols.length} 符号 / ${mine.files.length} 文件（依据 ${basis}；` +
    `覆盖 feature：${report.features.join(', ') || '（无）'}）—— 与 ${report.checked} 张活跃卡对照，**无相交**。`;
  const tail = report.unchecked.length
    ? `\n★ 另有 ${report.unchecked.length} 张活跃卡**没有读集**（本能力上线前领的）⇒ 这次没能比（“没比”≠“不冲突”）。`
    : '';
  return head + tail;
}
