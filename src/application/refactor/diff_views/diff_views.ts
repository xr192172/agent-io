/**
 * diff_views：设计视图 vs 实际代码快照（live）的双栏对比 + 三方对比
 *
 * 加载同一 feature 的 baseline / design / live 三个 DSL：
 * - baseline：**实际侧「上次扫描」的快照**（2026-10-22 起：每次 `import_project` 扫成功后
 *   `rebuildBaseline` 重建；此前是"只在首次 fork 写一次、之后绝不移动" ⇒ 基线会陈旧到
 *   回答"4 天前的代码"，而它存在的理由是回答"上次扫描到现在变了什么"）。
 *   ★ 它是**实际侧**的快照，**不是设计侧的回滚点**。Git 语义上的角色仍是「共同祖先」（窗口 = 上次扫描）
 * - design：设计视图（意图）
 * - live：实际代码快照（实现）
 *
 * 逐层比对（baseline 存在时升级为三方对比）：
 * - 文件级：新增/删除/修改/不变
 * - 符号级：新增/删除/修改
 * - API 级：新增/删除/修改
 * - 依赖级：新增/删除
 * - 行数变化
 *
 * 三方对比语义（Git 三路 merge 的 DSL 版）：
 * - baseline → design = 意图增量（intent delta）
 * - baseline → live   = 实现增量（implement delta）
 * - 两侧都改动且结果不一致 = 冲突，交 LLM 读 diff 裁决
 *
 * 输出结构化数据供 LLM 分析 + 可读摘要。
 */

import type { DesignDSL, SemanticFile, Symbol, ExpectedApi, Edge, NodeDecision, DecisionHistoryEntry } from '../../../domain/types.js';
// ★ T86：比两侧 root 是否同源（"事实抵消"的前提）
import path from 'node:path';
import { getDSL, getLiveFeatureResolved, getBaselineFeatureResolved, getArchiveEntryByPath } from '../../../infrastructure/storage.js';
import { mergedApis, diagnoseFactsOffset } from '../../../infrastructure/index/file_facts.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';
// ★★ ①/②/③ 三条**可比性判据**的纯函数住 `domain/diff_scope.ts`（口径归一 / 分母 / 保鲜）：
//   它们是判据（同一输入两次输出逐字相同），不是编排 ⇒ 不塞进本文件（塞进来就只能靠 grep 验）。
import {
  normRelPath,
  rebasePath,
  pathBasisOf,
  pathBasisNote,
  assessFreshness,
  freshnessLine,
  scopeLine,
  type PathBasis,
  type Freshness,
} from '../../../domain/diff_scope.js';
// ★ ③ 保鲜的唯一权威：`_sync.scanRev` 对比**当下** `max(files.indexed_at)`（不读 mtime 这类环境态）。
import { scanRevOf } from '../../../infrastructure/index/scan_rev.js';
// ★ ② `card` 的范围来源：该卡名下所有画布坍缩集的并集（唯一权威，不自己查 plans 表）。
import { planChangeSetOfCard } from '../../design/db/rewrite_plan.js';
// ★ ② `scope` 的解析器（唯一权威，不新造文法）。
import { resolveScopeText } from '../../../domain/scope.js';
// ★ ③「已声明排除」的唯一权威：设计册 `excluded`（`{path,reason}[]`，支持目录前缀）的**全册并集**
//   + 前缀匹配。★ 不许自己写前缀匹配，也不许拿 `structure.domains.json` 当它（那是"结构意图"，不是"不该覆盖"）。
import { excludedPathsOf, isExcludedPath, loadDesignSheetsForGate } from '../../design/db/gen_design_db.js';

// ──────── 输出类型 ────────

export interface DiffViewsInput {
  /** feature 名 */
  feature: string;
  /** live 视图的 baseDir（可选，默认 dataHome），与 import_project 的 live_dir 一致 */
  live_dir?: string;
  /**
   * ★② **圈定范围**（一行 scope 文本，文法唯一住处 = `domain/scope.ts` 头注）：
   * 只对拍这一片（`files:src/x/` / `arch_layer:api` / `subtree:<id>` …）。
   * ★ 与 `card` **二选一**（同给会报错）；都不给 ⇒ 全量，读数里照样打印「全量」与「未覆盖 0」。
   */
  scope?: string;
  /**
   * ★② **按任务卡圈定**：只对拍该卡画布的**坍缩集**（= `planChangeSetOfCard` 并集里的文件）。
   * ★ 卡名下没有任何画布 ⇒ 圈出 0 个文件，读数会明说「这不等于没有差异」。
   */
  card?: string;
}

/** 文件级别变更类型 */
export type FileChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

/** 单个文件的对比结果 */
export interface FileDiff {
  file_id: string;
  path: string;
  change: FileChangeType;
  /** design 侧行数（不存在时为 undefined） */
  design_lines?: number;
  /** live 侧行数（不存在时为 undefined） */
  live_lines?: number;
  /** 符号变更 */
  symbols: SymbolDiff[];
  /** API 变更 */
  apis: ApiDiff[];
  /** design 层标签 */
  design_layer?: string;
  /** live 层标签 */
  live_layer?: string;
}

/** 符号级别变更 */
export interface SymbolDiff {
  name: string;
  kind: string;
  change: 'added' | 'removed' | 'modified';
  /** design 侧行号 */
  design_line?: number;
  /** live 侧行号 */
  live_line?: number;
  /** design 侧签名 */
  design_signature?: string;
  /** live 侧签名 */
  live_signature?: string;
}

/** API 级别变更 */
export interface ApiDiff {
  signature: string;
  change: 'added' | 'removed' | 'modified';
  design_line?: number;
  live_line?: number;
}

/** 依赖边变更（边级 diff：结构塌方可视化） */
export interface EdgeDiff {
  /** 源节点 id（文件） */
  from: string;
  /** 目标节点 id（文件） */
  to: string;
  /** removed=设计有/实际无（结构塌方）；added=实际新增依赖 */
  change: 'added' | 'removed';
}

/**
 * 三方对比中单个文件的状态（Git 三路 merge 语义的 DSL 版）
 * - added：仅设计新增，尚未实现（baseline 无 / design 有 / live 无）
 * - implemented：设计新增且已实现（两侧一致）
 * - removed：设计删除、代码仍在（设计撤销）
 * - deleted_from_live：实现删除、设计仍在（结构塌方）
 * - design_only：仅设计改动（意图增量，待同步到实现）
 * - live_only：仅实现改动（实现增量/fix，待回填设计）；含「实现新增未登记」
 * - conflict：两侧在【同一维度】上都改动且结果不一致 → 需 LLM 读 diff 裁决
 * - both_moved：两侧都动了，但动的是【不同维度】（例：设计改命名、实现改结构）⇒ 两条独立待裁项，
 *   ★ **不是冲突**（2026-10-19：实测 expectation.ts 被误判成 conflict，就是因为把两个维度混成一个布尔）
 * - converged：两侧都改动但结果一致（已收敛，可直接采用）
 * - unchanged：相对基线无变化
 */
export type ThreeWayState =
  | 'added'
  | 'implemented'
  | 'removed'
  | 'deleted_from_live'
  | 'design_only'
  | 'live_only'
  | 'conflict'
  | 'both_moved'
  | 'converged'
  | 'unchanged';

/** 决策卡上下文（供 LLM 裁决 diff 时的一手资料） */
export interface DecisionCardRef {
  /** 结论 */
  summary: string;
  /** 理由 */
  rationale?: string;
  /** 生效状态 */
  status?: string;
  /** 功能线 */
  thread?: string;
  /** 自由标签 */
  tags?: string[];
  /** 版本栈（旧决策） */
  history?: DecisionHistoryEntry[];
}

/** 三方对比中单个文件的详情 */
export interface ThreeWayFile {
  path: string;
  state: ThreeWayState;
  baseline_lines?: number;
  design_lines?: number;
  live_lines?: number;
  /** 意图增量（baseline→design）的符号/API 变更 */
  intent_symbols: SymbolDiff[];
  intent_apis: ApiDiff[];
  /** 实现增量（baseline→live）的符号/API 变更 */
  implement_symbols: SymbolDiff[];
  implement_apis: ApiDiff[];
  /** 决策卡上下文：基线侧=当初为什么这么定；设计侧=现在为什么改（文件级 Node.decision） */
  baseline_decision?: DecisionCardRef;
  design_decision?: DecisionCardRef;
  /** 符号级决策卡（有卡的符号名 → 卡），挂函数/API 上，逐符号对齐 diff */
  symbol_decisions?: Record<string, DecisionCardRef>;
  /** 归档关联（下线库历史研究材料：以前弃用过没 / 合并去向） */
  archive?: { retire_reason?: string; merged_into?: string; archived_at?: string };
}

/** 三方对比统计 */
export interface ThreeWaySummary {
  unchanged: number;
  /** 仅设计新增，尚未实现 */
  added: number;
  /** 设计新增且已实现 */
  implemented: number;
  /** 设计删除、代码仍在 */
  removed: number;
  /** 实现删除、设计仍在（结构塌方） */
  deleted_from_live: number;
  /** 仅设计改动（意图增量） */
  design_only: number;
  /** 仅实现改动（实现增量/fix） */
  live_only: number;
  /** 两侧在【同一维度】都改动且不一致 → 需裁决 */
  conflict: number;
  /** 两侧都动、但动的是【不同维度】→ 两条独立待裁项，不是冲突 */
  both_moved: number;
  /** 两侧都改动但结果一致 */
  converged: number;
}

/**
 * ★③ **待填充清单**（0.29②）：对拍的产物是「**设计册缺什么**」，不是「分级读数」。
 *
 * 方向**固定写进读数**：`只在实际侧 ⇒ 设计册缺`。★ 不许把它标成「正常 / 预期边界」——
 * 设计册与实际册**本应同构**（脉络一样）；只在实际侧 > 0 就是设计册没写全（缺陷）。
 * ★ 本工具**只读数、不判定**：哪些算缺口由 `excluded` 声明裁（权威 = 设计册 `excluded` 全册并集）；
 *   设计要求是否被满足是 `judge` 的活（本工具不重判 —— 0.9.1）。
 */
export interface BackfillReport {
  /** 方向（防止读数被误读成「正常差异」） */
  direction: 'live_only_means_design_gap';
  /** 待填充总条数 = `files.count + symbols_apis.count + edges.count` */
  total: number;
  /** 文件层：只在实际侧有的文件（逐个点名） */
  files: { count: number; items: string[] };
  /** 符号/API 层：只在实际侧有的符号与 API（分文件计数） */
  symbols_apis: { count: number; by_file: Array<{ file: string; count: number; items: string[] }> };
  /** 边层：只在实际侧存在的依赖边 */
  edges: { count: number; items: Array<{ from: string; to: string }> };
  /** 已声明排除（**不算缺口**）：权威 = `gen_design_db#excludedPathsOf`（全册并集） */
  excluded: {
    count: number;
    /** 至多 50 条（`count` 是全量；逐条可追） */
    items: Array<{ path: string; reason: string }>;
    /** 排除清单**读不到**时的诊断（0.12：读不到 ≠ 没有 —— 那时一律按「缺口」计） */
    error?: string;
  };
  /** 反方向：设计有·实际无 ⇒ **未落地**（不是填充项；判定归 judge，本工具不判） */
  unimplemented: { files: number; symbols_apis: number; edges: number };
  /** 同文件同符号但签名不同 ⇒ **需人判**（回填会覆盖意图层，见 0.29 的分界） */
  mismatched: { count: number; items: Array<{ file: string; item: string }> };
}

/** 对比结果 */
export interface DiffViewsResult {
  /** 可读摘要 */
  message: string;
  /** 结构化数据 */
  data: {
    feature: string;
    /** 设计视图是否存在 */
    design_exists: boolean;
    /** live 视图是否存在 */
    live_exists: boolean;
    /** 基线视图（契约创立时刻的 fork）是否存在 */
    baseline_exists: boolean;
    /**
     * ★★ **T86**：本次比较的「**事实抵消**」前提核对结果。
     *
     * ★★★ **只在"前提不满足"时才有这个键**（正常路径**根本不出现**）——
     *   这是"**防御性判据的成本要匹配它的触发概率**"那条通则的落地：
     *   本节检的是「两侧 `source_root` 不同 / 缺失」，而**正常流程下两侧同源于一次 `import_project`
     *   ⇒ 必然相同**（★ 我试了两种造法**都造不出**这个坏状态：删 `features/<f>.json` 的字段没用
     *   —— `getDSL` 优先读"活态文件"；传不同 `live_dir` 也没用 —— 它不改 `source_root`）。
     *   ⇒ 既然**几乎永远为空**，就**不该占常态输出的位置**（否则每次多一个恒空的字段，还会让人以为"这里有东西看"）。
     * ★ 非空 ⇒ 下面的差异**不能**直接读成「设计变了」或「代码变了」。见 `mergedApis` 的文档。
     */
    notes?: string[];
    /**
     * ★① **路径口径**判定（两侧 `semantic.files[].path` 各自相对自己那份 `source_root` ⇒
     * 两侧 root 不同时必须先重定基，否则同一文件会以两个字符串出现、被算成「一增一删」）。
     */
    path_basis: PathBasis;
    /**
     * ★① 是否**真的**做了逐文件对账。
     * `false` = 两侧 root 不构成包含关系 ⇒ 口径不一致，已**拒绝硬比**；
     * ★ 此时 `files` 为空**不是**「没有差异」（读 `scope.notes` 看诊断）。
     */
    comparable: boolean;
    /** ★③ live 视图新鲜度（`live` 不存在时为 undefined —— 那时已有「实际视图不存在」的警告） */
    freshness?: Freshness & { line: string };
    /** ★② 本次对拍的范围与**分母**（只给分子等于没验：0.19③） */
    scope: {
      /** 范围标签（`全量（未圈定）` / `files:src/x/` / `card:<id>`） */
      label: string;
      /** 两侧路径并集 = 分母 M */
      universe_files: number;
      /** 本次实际对拍 = 分子 N */
      scoped_files: number;
      /** 未覆盖 = M − N */
      uncovered_files: number;
      /** 实际参与对拍的路径（设计口径；供下游接续 / 复核） */
      files: string[];
      /** 范围解析与拒绝硬比的诊断（**不许静默**：空集、口径不一致都在这里） */
      notes: string[];
    };
    /**
     * ★③ **待填充清单**（0.29②）：只在实际侧 ⇒ 设计册缺。
     * ★ 它不是「文件变更统计」的另一个名字 —— 统计只是它的**原始料**，结论看这里。
     */
    backfill: BackfillReport;
    /** 总体统计 */
    summary: {
      /** 设计视图文件数 */
      design_files: number;
      /** live 视图文件数 */
      live_files: number;
      /** 新增文件（仅 design 有） */
      added_files: number;
      /** 删除文件（仅 live 有） */
      removed_files: number;
      /** 修改文件（两边都有但内容不同） */
      modified_files: number;
      /** 未变文件 */
      unchanged_files: number;
      /** ★② 两侧路径并集（= 分母 M） */
      universe_files: number;
      /** ★② 本次实际对拍的文件数（= 分子 N） */
      scoped_files: number;
      /** ★② 未覆盖 = M − N（0 = 全量已覆盖；>0 时下面的符号/API 总数只统计本次范围） */
      uncovered_files: number;
      /** 设计侧总符号数 */
      design_symbols: number;
      /** live 侧总符号数 */
      live_symbols: number;
      /** 设计侧总 API 数 */
      design_apis: number;
      /** live 侧总 API 数 */
      live_apis: number;
      /** 新增依赖边数（仅设计无） */
      added_edges: number;
      /** 删除依赖边数（仅实际无，结构塌方） */
      removed_edges: number;
    };
    /** 文件级对比详情 */
    files: FileDiff[];
    /** 依赖边级对比（两视图共有的文件节点之间的依赖变化） */
    edges: EdgeDiff[];
    /** 三方对比（baseline 存在时）详情 */
    three_way?: {
      /** 基线视图文件数 */
      baseline_files: number;
      summary: ThreeWaySummary;
      files: ThreeWayFile[];
      /**
       * ★ 基线能否前移到 live（2026-10-19）：**实际侧清零**即可，设计的活不阻塞。
       * ★ 本工具**只判不写** —— 前移等于宣布新出发点，必须有决策卡。
       */
      baseline_can_advance: { ok: boolean; blockers: string[]; note: string };
    };
  };
}

// ──────── 核心逻辑 ────────

/**
 * 执行双视图对比（baseline 存在时升级为三方对比）
 */
function diffViewsCore(input: DiffViewsInput): DiffViewsResult {
  const { feature, live_dir } = input;

  // 1. 加载三个视图（baseline 与 live 同目录归位：baseDir = live_dir）
  // ★★ 2026-10-06（T19 形状决策，三候选实测后选 **(b) 由 feature 反查**）：原先**只用入参
  //   `live_dir`** ⇒ 调用方没传时落 `dataHome`，而 ★ **写侧（`import_project`）会把它写在
  //   被监听项目的根** ⇒ **静默读不到**（隔离实测复现：`getLiveFeature(feature)` 返回 `null`、
  //   而 `getLiveFeature(feature, dsl.source_root)` 读得到）。
  //   ⇒ 改用**候选链** `getLiveFeatureResolved` / `getBaselineFeatureResolved`
  //     （`explicit` > `dsl.source_root` > `dataHome`，**取第一个"文件存在"的**）。
  //   ★★ 2026-10-06 补正：**候选链，不是"二选一"** —— 我上一版写成" `explicit` 否则 `dsl.source_root`"，
  //     实测把**更常见的模式读成了 null**（本仓 4 个 feature 的 live/baseline **都在 dataHome**，
  //     而 `dsl.source_root` 指向的仓里没有）⇒ 猜一个必然让另一种模式静默读不到。
  //   ★ 本笔**只修「根从哪来」**，**不改「拿不到怎么办」**（仍容忍 `null`，与改前同）——
  //     "找不到该响亮还是容忍"是`diff_views` 自己的语义决策，属下一步。
  const design = getDSL(feature);
  const live = getLiveFeatureResolved(feature, live_dir);
  const baseline = getBaselineFeatureResolved(feature, live_dir);

  /**
   * ★★★ **T86：把「事实抵消」的两个前提当场核一遍**（2026-10-09）。
   *
   * ## 背景（见 `mergedApis` 的文档）
   * 本工具比两侧时用的是 `diffApis(mergedApis(design…), mergedApis(live…))` ——
   * **两侧都把"当下的事实"加进去** ⇒ 只要**同根**，事实部分**完全相同 ⇒ 相互抵消**
   * ⇒ 剩下的差异**纯是契约的** ✓ 这是**有意**的。
   *
   * ## 不满足就是**静默出错**（所以必须说出来）
   * · 两侧 root **不同** ⇒ 事实**不抵消** ⇒ 差异里**混进了代码变更**（而这条线本该只报"设计差异"）；
   * · ★ **任一侧拿不到 root** ⇒ `mergedApis` 只返回契约 ⇒ **一侧有事实、另一侧没有**
   *   ⇒ **事实会全被算成"差异"** —— ★ 这与 T85 那个 1281 是**同一种病**：
   *     **该说"判不了"却给了个默认值**。
   * ⇒ 宁可**明说"本次比较里事实未抵消"**，也不给一个看起来精确的数字。
   */
  const dRoot = design?.source_root;
  const lRoot = live?.source_root;
  const factsNotes: string[] = diagnoseFactsOffset(dRoot, lRoot);

  // ──────── ★① 路径口径：两侧 path 各自相对**自己那份** source_root ────────
  // ★ 不归一就比 = 拿两种单位相减：同一文件会以两个字符串出现（设计 `src/…/x.ts` vs 实际裸名 `x.ts`）
  //   ⇒ 逐文件比对把它算成「一增一删」。实测（agent-io-toolface 册）12 条差异全是这么来的。
  // ★ 归不了（两侧 root 不构成包含关系）⇒ **拒绝硬比**，不许把"没对齐"当"全新增"（0.12）。
  const basis = pathBasisOf(dRoot, lRoot);
  const comparable = basis.basis !== 'incomparable';
  const basisNote = pathBasisNote(basis);
  const baselineBasis = pathBasisOf(dRoot, baseline?.source_root);
  const designKey = (p: string): string => rebasePath(p, basis.design_prefix);
  const liveKey = (p: string): string => rebasePath(p, basis.live_prefix);
  const baselineKey = (p: string): string => rebasePath(p, baselineBasis.live_prefix);

  // 构建结果
  const designFiles = design?.semantic?.files ?? [];
  const liveFiles = live?.semantic?.files ?? [];
  const baselineFiles = baseline?.semantic?.files ?? [];

  // 按**归一后**的路径建立索引（键是设计口径；值仍是原对象 ⇒ mergedApis 用的还是各侧自己的 f.path）
  const designByPath = new Map<string, SemanticFile>();
  for (const f of designFiles) designByPath.set(designKey(f.path), f);

  const liveByPath = new Map<string, SemanticFile>();
  for (const f of liveFiles) liveByPath.set(liveKey(f.path), f);

  const baselineByPath = new Map<string, SemanticFile>();
  for (const f of baselineFiles) baselineByPath.set(baselineKey(f.path), f);

  // 全量口径（未圈定）= 分母里的 M
  const universe = new Set<string>();
  for (const f of designFiles) universe.add(designKey(f.path));
  for (const f of liveFiles) universe.add(liveKey(f.path));
  for (const f of baselineFiles) universe.add(baselineKey(f.path));

  // ──────── ★② 范围：card 的坍缩集 / scope 的解析结果（都不给 ⇒ null = 全量） ────────
  const scopeRes = resolveDiffScope(design, input, dRoot);
  const scopedSet = scopeRes.paths === null ? null : new Set(scopeRes.paths.map(normRelPath));
  const scopeNotes = [...scopeRes.notes];
  const allPaths: string[] = !comparable
    ? []
    : scopedSet === null
      ? [...universe]
      : [...universe].filter((p) => scopedSet.has(p));
  if (!comparable) {
    scopeNotes.push(
      `★★ 口径不一致 ⇒ 本次**未逐文件对账**（设计 ${designFiles.length} 文件 / 实际 ${liveFiles.length} 文件）。` +
        '读数里的 0 条差异**不是**「没有差异」。',
    );
  } else if (scopedSet !== null) {
    const outside = [...scopedSet].filter((p) => !universe.has(p));
    if (outside.length) {
      scopeNotes.push(
        `圈定的 ${outside.length} 个路径**两侧视图里都没有**（不进对账）：${outside.slice(0, 5).join(', ')}` +
          `${outside.length > 5 ? ' …' : ''}`,
      );
    }
    if (allPaths.length === 0) {
      scopeNotes.push('★★ 本次范围解析出 **0 个可对拍的文件** ⇒ 读数里的 0 条差异**不是**「没有差异」（范围为空）。');
    }
  }

  // ──────── ★③ 保鲜：live 是 cache.db 的一次投影，投影可能落后于库 ────────
  // ★ 权威 = 册自己记的 `_sync.scanRev`（它复制自哪一代索引）对比**当下** `max(files.indexed_at)`；
  //   不读 mtime / cwd 这类环境态（0.12 第 2 条）。读不到 ⇒ unknown，**不冒充** fresh。
  const liveSync = (live as unknown as { _sync?: Record<string, unknown> } | null)?._sync ?? {};
  const freshInput = {
    live_saved_at: typeof liveSync.saved_at === 'string' ? liveSync.saved_at : null,
    live_scan_rev: typeof liveSync.scanRev === 'number' ? liveSync.scanRev : null,
    current_rev: scanRevOf({ feature, sourceRoot: dRoot ?? lRoot }).rev,
  };
  const fresh: Freshness | null = live ? assessFreshness(freshInput) : null;
  const freshLine = live ? freshnessLine(freshInput) : null;

  // ──────── ★③ 待填充清单的原始料（0.29②：只在实际侧 ⇒ 设计册缺） ────────
  const gapFiles: string[] = [];
  // ★ 按**条目名**去重：同一个符号会同时出现在「符号层」与「API 层」（同一事实两个粒度）
  //   ⇒ 不去重就会把 1 个缺口数成 2 条（分母虚高 = 0.12③ 的反面）。
  const gapSyms = new Map<string, Map<string, string>>();
  const gapEdges: Array<{ from: string; to: string }> = [];
  const excludedHits: Array<{ path: string; reason: string }> = [];
  const unimplemented = { files: 0, symbols_apis: 0, edges: 0 };
  const mismatched: Array<{ file: string; item: string }> = [];
  const addGapItem = (file: string, name: string, label: string): void => {
    const m = gapSyms.get(file) ?? new Map<string, string>();
    if (!m.has(name)) m.set(name, label);
    gapSyms.set(file, m);
  };
  /** 签名 → 符号名（只用于去重键，不参与展示） */
  const apiNameOf = (signature: string): string => {
    const i = signature.indexOf('(');
    return (i > 0 ? signature.slice(0, i) : signature).trim();
  };
  // ★「已声明排除」的唯一权威 = 设计册 `excluded` 的**全册并集**（`excludedPathsOf`）。
  //   读不到 ⇒ **出声**（0.12），且一律按「缺口」计 —— 把未声明的当已排除是反向的静默失败。
  let excludedList: Array<{ path: string; reason: string }> = [];
  let excludedError: string | undefined;
  try {
    const sheetsRoot = dRoot ?? lRoot;
    if (!sheetsRoot) throw new Error('两侧都没有 source_root ⇒ 不知道去读哪个项目的设计册');
    excludedList = excludedPathsOf(loadDesignSheetsForGate(sheetsRoot).sheets);
  } catch (e) {
    excludedError = (e as Error).message;
  }
  const excludedReasonOf = (p: string): string =>
    (excludedList.find((x) => p === x.path || p.startsWith(x.path)) ?? { reason: '' }).reason;
  /** 一条「只在实际侧」的条目落在已声明排除里吗（落不到 ⇒ 它就是待填充项） */
  const isExcluded = (p: string): boolean => isExcludedPath(excludedList, p);
  // ★ 排除条目也**按条目名去重**（与缺口同一把尺）：同一个符号的符号层与 API 层不能算两条。
  const excludedSeen = new Set<string>();
  const addExcluded = (p: string, name: string): void => {
    const k = `${p}#${name}`;
    if (excludedSeen.has(k)) return;
    excludedSeen.add(k);
    excludedHits.push({ path: p, reason: excludedReasonOf(p) });
  };
  /** 文件节点 id → 设计口径路径（边级条目也要按路径判排除） */
  const pathById = new Map<string, string>();
  for (const f of designFiles) pathById.set(f.id, designKey(f.path));
  for (const f of liveFiles) pathById.set(f.id, liveKey(f.path));

  // 统计计数
  let added = 0, removed = 0, modified = 0, unchanged = 0;
  let designSymbols = 0, liveSymbols = 0;
  let designApis = 0, liveApis = 0;
  const fileDiffs: FileDiff[] = [];

  for (const path of allPaths) {
    const df = designByPath.get(path);
    const lf = liveByPath.get(path);

    // 计数
    if (df) {
      designSymbols += df.symbols?.length ?? 0;
      designApis += mergedApis(design?.source_root, df.path, df.expected_apis, feature).length;
    }
    if (lf) {
      liveSymbols += lf.symbols?.length ?? 0;
      liveApis += mergedApis(live?.source_root, lf.path, lf.expected_apis, feature).length;
    }

    if (df && !lf) {
      // 仅设计视图有 → 文件被删除（或设计新增但未实现）
      removed++;
      // ★③ 反方向：设计有·实际无 ⇒ **未落地**（不是填充项；判定归 judge，本工具只计数）
      unimplemented.files += 1;
      unimplemented.symbols_apis += (df.symbols ?? []).length + (df.expected_apis ?? []).length;
      fileDiffs.push({
        file_id: df.id,
        path,
        change: 'removed',
        design_lines: df.lines,
        symbols: (df.symbols ?? []).map((s) => ({
          name: s.name, kind: s.kind,
          change: 'removed' as const,
          design_line: s.line, design_signature: s.signature,
        })),
        apis: (df.expected_apis ?? []).map((a) => ({
          signature: a.signature, change: 'removed' as const,
          design_line: a.line,
        })),
        design_layer: df.layer,
      });
    } else if (!df && lf) {
      // 仅 live 视图有 → **只在实际侧**
      added++;
      // ★③ 设计册缺该文件（或已声明排除）—— 逐个点名，不聚合
      if (isExcluded(path)) {
        addExcluded(path, '');
      } else {
        gapFiles.push(path);
        for (const s of lf.symbols ?? []) addGapItem(path, s.name, `${s.kind}:${s.name}`);
        for (const a of lf.expected_apis ?? []) addGapItem(path, apiNameOf(a.signature), `api:${a.signature}`);
      }
      fileDiffs.push({
        file_id: lf.id,
        path,
        change: 'added',
        live_lines: lf.lines,
        symbols: (lf.symbols ?? []).map((s) => ({
          name: s.name, kind: s.kind,
          change: 'added' as const,
          live_line: s.line, live_signature: s.signature,
        })),
        apis: (lf.expected_apis ?? []).map((a) => ({
          signature: a.signature, change: 'added' as const,
          live_line: a.line,
        })),
        live_layer: lf.layer,
      });
    } else if (df && lf) {
      // 两边都有 → 比较差异
      const symDiffs = diffSymbols(df.symbols ?? [], lf.symbols ?? []);
      const apiDiffs = diffApis(
        mergedApis(design?.source_root, df.path, df.expected_apis, feature),
        mergedApis(live?.source_root, lf.path, lf.expected_apis, feature),
      );

      // ★③ 三向拆分（方向不许混）：live 有·design 无 ⇒ **待填充**；design 有·live 无 ⇒ **未落地**；
      //   同文件同符号但签名不同 ⇒ **需人判**（回填会覆盖意图层）。已声明排除的不计缺口。
      const fileExcluded = isExcluded(path);
      for (const d of symDiffs) {
        const item = `${d.kind}:${d.name}`;
        if (d.change === 'added') {
          if (fileExcluded) addExcluded(path, d.name);
          else addGapItem(path, d.name, item);
        } else if (d.change === 'removed') {
          unimplemented.symbols_apis += 1;
        } else {
          mismatched.push({ file: path, item });
        }
      }
      for (const d of apiDiffs) {
        const item = `api:${d.signature}`;
        if (d.change === 'added') {
          if (fileExcluded) addExcluded(path, apiNameOf(d.signature));
          else addGapItem(path, apiNameOf(d.signature), item);
        } else if (d.change === 'removed') {
          unimplemented.symbols_apis += 1;
        } else {
          mismatched.push({ file: path, item });
        }
      }

      const hasChanges = symDiffs.length > 0 || apiDiffs.length > 0 || (df.lines !== lf.lines) || (df.layer !== lf.layer);

      if (hasChanges) {
        modified++;
        fileDiffs.push({
          file_id: df.id,
          path,
          change: 'modified',
          design_lines: df.lines,
          live_lines: lf.lines,
          symbols: symDiffs,
          apis: apiDiffs,
          design_layer: df.layer,
          live_layer: lf.layer,
        });
      } else {
        unchanged++;
        fileDiffs.push({
          file_id: df.id,
          path,
          change: 'unchanged',
          design_lines: df.lines,
          live_lines: lf.lines,
          symbols: [],
          apis: [],
          design_layer: df.layer,
          live_layer: lf.layer,
        });
      }
    }
  }

  // 2. 三方对比（baseline 存在时）：Git 三路 merge 语义 ——
  //    baseline→design=意图增量，baseline→live=实现增量，两侧都动且不一致=冲突
  const threeWay: ThreeWayFile[] = [];
  const twSummary: ThreeWaySummary = {
    unchanged: 0, added: 0, implemented: 0, removed: 0,
    deleted_from_live: 0, design_only: 0, live_only: 0, conflict: 0, both_moved: 0, converged: 0,
  };
  if (baseline) {
    // 视图整体缺失时的退化语义：
    // - 无设计视图（"没有设计 DSL 的项目"）：退化为「基线→实现」的实现增量
    // - 无实现视图（纯设计 DSL）：退化为「基线→设计」的意图增量
    const designAbsent = !design;
    const liveAbsent = !live;
    for (const path of allPaths) {
      const base = baselineByPath.get(path);
      const des = designByPath.get(path);
      const liv = liveByPath.get(path);

      // ★★★ 2026-10-19：把"谁动了"拆成两个**正交维度**，冲突才有意义。
      //   旧写法只有一个布尔 ⇒「设计改命名」+「实现改行数」= 都 changed ⇒ 直接落 conflict。
      const desMeta = metaChanged(base, des);
      const desStruct = structChanged(base, des, baseline?.source_root, design?.source_root);
      const livMeta = metaChanged(base, liv);
      const livStruct = structChanged(base, liv, baseline?.source_root, live?.source_root);

      const desChanged =
        desMeta ||
        desStruct ||
        fileDecisionChanged(baseline, design, path, base?.id, des?.id) ||
        symbolsDecisionChanged(base, des);
      const livChanged =
        livMeta ||
        livStruct ||
        fileDecisionChanged(baseline, live, path, base?.id, liv?.id) ||
        symbolsDecisionChanged(base, liv);
      // desEqLiv：设计 vs 实现语义一致 → converged 非 conflict。
      // 用 symbolsSemanticallyEqual 替代 fileChanged 的符号比较：行号偏移（快照时刻差异）
      // 不是语义冲突；layer + API 仍用原逻辑保持严格。
      const desEqLiv = symbolsSemanticallyEqual(des?.symbols ?? [], liv?.symbols ?? [])
        && (des?.layer ?? '') === (liv?.layer ?? '')
        && diffApis(
          mergedApis(design?.source_root, des?.path, des?.expected_apis, feature),
          mergedApis(live?.source_root, liv?.path, liv?.expected_apis, feature),
        ).length === 0
        && !symbolsDecisionChanged(des, liv);

      let state: ThreeWayState;
      if (designAbsent) {
        if (!base && !liv) state = 'unchanged'; // 仅基线有
        else if (!base && liv) state = 'live_only'; // 实现新增未登记
        else if (base && !liv) state = 'deleted_from_live'; // 实现删除（结构塌方）
        else state = livChanged ? 'live_only' : 'unchanged';
      } else if (liveAbsent) {
        if (!base && !des) state = 'unchanged'; // 仅基线有
        else if (!base && des) state = 'added'; // 设计新增未实现
        else if (base && !des) state = 'removed'; // 设计删除
        else state = desChanged ? 'design_only' : 'unchanged';
      } else if (base && des && liv) {
        // 三方都有 → 按「谁动了」分类
        if (!desChanged && !livChanged) state = 'unchanged';
        else if (desChanged && !livChanged) state = 'design_only';
        else if (!desChanged && livChanged) state = 'live_only';
        else if (desEqLiv) state = 'converged';
        // ★★★ 2026-10-19：冲突只在【同一维度】两边都改时成立。
        //   不同维度各自改（设计改命名 / 实现改结构）⇒ both_moved：两条独立待裁项，不是冲突。
        //   实测 expectation.ts：design 只改了 label，live 从 206 行涨到 281 行 —— 旧逻辑判 conflict。
        else if ((desMeta && livMeta) || (desStruct && livStruct)) state = 'conflict';
        else state = 'both_moved';
      } else if (!base && des && !liv) {
        state = 'added';
      } else if (!base && des && liv) {
        state = desEqLiv ? 'implemented' : 'conflict';
      } else if (!base && !des && liv) {
        state = 'live_only'; // 实现新增未登记
      } else if (base && !des && liv) {
        state = 'removed'; // 设计删除、代码仍在
      } else if (base && des && !liv) {
        state = 'deleted_from_live'; // 结构塌方
      } else {
        state = 'unchanged'; // 仅基线有 / 全无
      }
      twSummary[state]++;

      const tw: ThreeWayFile = {
        path,
        state,
        baseline_lines: base?.lines,
        design_lines: des?.lines,
        live_lines: liv?.lines,
        intent_symbols: diffSymbols(base?.symbols ?? [], des?.symbols ?? []),
        intent_apis: diffApis(
          mergedApis(baseline?.source_root, base?.path, base?.expected_apis, feature),
          mergedApis(design?.source_root, des?.path, des?.expected_apis, feature),
        ),
        implement_symbols: diffSymbols(base?.symbols ?? [], liv?.symbols ?? []),
        implement_apis: diffApis(
          mergedApis(baseline?.source_root, base?.path, base?.expected_apis, feature),
          mergedApis(live?.source_root, liv?.path, liv?.expected_apis, feature),
        ),
        // 决策卡上下文（LLM 裁决的一手资料）：
        // - 基线卡=当初为什么这么定；设计卡=现在为什么改
        // - 符号卡=挂函数/API 上的决策（基线+设计合并，设计覆盖同名）
        baseline_decision: fileDecisionRef(baseline, path, base?.id),
        design_decision: fileDecisionRef(design, path, des?.id),
        symbol_decisions: (() => {
          const merged = { ...symbolDecisionRefs(baseline, path), ...symbolDecisionRefs(design, path) };
          return Object.keys(merged).length > 0 ? merged : undefined;
        })(),
        // 归档关联：删除类状态时查下线库（以前弃用过没 / 合并去向）
        archive: getArchiveRef(feature, path, state, live_dir),
      };
      threeWay.push(tw);
    }
  }

  // 3. 边级 diff（结构塌方可视化）：仅比较两视图共有的文件节点之间的依赖边，
  //    避免「功能聚合视图 vs 文件视图」或「容器边」等 id 空间不一致造成的噪音。
  // ★② 边级 diff 同样受范围约束：圈了范围却报范围外的边 = 分子分母对不上。
  const scopedForEdges = new Set(allPaths);
  const designFileIds = new Set(designFiles.filter((f) => scopedForEdges.has(designKey(f.path))).map((f) => f.id));
  const liveFileIds = new Set(liveFiles.filter((f) => scopedForEdges.has(liveKey(f.path))).map((f) => f.id));
  const edgeDiffs = diffEdges(
    design?.geometry?.edges ?? [],
    live?.geometry?.edges ?? [],
    designFileIds,
    liveFileIds,
  );
  let addedEdges = 0, removedEdges = 0;
  for (const d of edgeDiffs) {
    if (d.change === 'added') {
      addedEdges++;
      // ★③ 边也分方向：只在实际侧 ⇒ 待填充（两端都落在已声明排除里则不算）
      const fromP = pathById.get(d.from) ?? '';
      const toP = pathById.get(d.to) ?? '';
      if (isExcluded(fromP) || isExcluded(toP)) addExcluded(fromP || toP, `${d.from}->${d.to}`);
      else gapEdges.push({ from: d.from, to: d.to });
    } else {
      removedEdges++;
      unimplemented.edges += 1;
    }
  }

  // ──────── ★③ 待填充清单（对拍的产物） ────────
  const gapByFile = [...gapSyms.entries()]
    .map(([file, m]) => ({ file, count: m.size, items: [...m.values()] }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const gapSymCount = gapByFile.reduce((n, g) => n + g.count, 0);
  const backfill: BackfillReport = {
    direction: 'live_only_means_design_gap',
    total: gapFiles.length + gapSymCount + gapEdges.length,
    files: { count: gapFiles.length, items: [...gapFiles].sort() },
    symbols_apis: { count: gapSymCount, by_file: gapByFile },
    edges: { count: gapEdges.length, items: gapEdges },
    excluded: {
      count: excludedHits.length,
      items: excludedHits.slice(0, 50),
      ...(excludedError ? { error: excludedError } : {}),
    },
    unimplemented,
    mismatched: { count: mismatched.length, items: mismatched.slice(0, 50) },
  };

  // 4. 构建摘要
  const lines: string[] = [
    `══ feature "${feature}" 覆盖体检（设计册 vs 实况）══`,
    '',
    `  ─ 概览 ─`,
    `  设计视图: ${design ? `${designFiles.length} 文件` : '不存在'}`,
    `  实际视图: ${live ? `${liveFiles.length} 文件` : '不存在'}`,
    `  基线视图: ${baseline ? `${baselineFiles.length} 文件（契约创立时刻 fork）` : '不存在（首次导入后自动锚定）'}`,
    '',
    `  ─ 本次对拍范围 ─`,
    `  ${scopeLine(allPaths.length, universe.size, scopeRes.label)}`,
    `  ${basisNote}`,
    ...(freshLine ? [`  ${freshLine}`] : []),
    ...scopeNotes.map((n) => `  ${n}`),
    ...(scopedSet === null ? [] : ['  ★ 下面的符号/API 总数**只统计本次范围**（视图总数看上面概览）']),
    '',
    `  ─ 设计册待填充（覆盖体检 ≠ 核销；核销 = plan_exit_check + judge + complete）─`,
    `  待填充（设计册缺）：${backfill.total} 条`,
    `    · 文件层：${backfill.files.count} 个${backfill.files.count ? '（' + backfill.files.items.slice(0, 8).join(', ') + (backfill.files.count > 8 ? ` … 共 ${backfill.files.count}` : '') + '）' : ''}`,
    `    · 符号/API 层：${backfill.symbols_apis.count} 条${gapByFile.length ? '（分文件：' + gapByFile.slice(0, 6).map((g) => `${g.file} ${g.count}`).join(' · ') + (gapByFile.length > 6 ? ` … 共 ${gapByFile.length} 个文件` : '') + '）' : ''}`,
    `    · 边层：${backfill.edges.count} 条`,
    `  已声明排除（不算缺口）：${backfill.excluded.count} 条${excludedError ? `　★★ 但**读不到排除清单**（${excludedError}）⇒ 上面那些“缺口”里可能混着已声明排除的（读不到 ≠ 没有，不许当 0）` : ''}`,
    `  另：设计有·实际无（**未落地**，不是填充项；判定归 judge）：${unimplemented.files} 文件 / ${unimplemented.symbols_apis} 符号·API / ${unimplemented.edges} 边`,
    `  另：同文件同符号但签名不同（**需人判**：回填会覆盖意图层）：${mismatched.length} 条`,
    '',
    `  ─ 原始 diff 计数（不是结论；结论看上面的待填充清单）─`,
    `  ─ 文件变更 ─`,
    `  新增: ${added} 文件`,
    `  删除: ${removed} 文件`,
    `  修改: ${modified} 文件`,
    `  未变: ${unchanged} 文件`,
    '',
    `  ─ 符号变更 ─`,
    `  设计视图: ${designSymbols} 符号`,
    `  实际视图: ${liveSymbols} 符号`,
    '',
    `  ─ API 变更 ─`,
    `  设计视图: ${designApis} API`,
    `  实际视图: ${liveApis} API`,
    '',
    `  ─ 依赖边变更 ─`,
    `  新增: ${addedEdges} 边`,
    `  删除: ${removedEdges} 边（结构塌方）`,
  ];

  // 三方对比摘要（baseline 存在时）
  if (baseline) {
    const tw = twSummary;
    lines.push(
      '',
      `  ─ 三方对比（基线 → 意图 / 实现）─`,
      `  意图增量（基线→设计）: ${tw.design_only} 文件设计改动 + ${tw.added} 新增未实现`,
      `  实现增量（基线→实现）: ${tw.live_only} 文件实现改动 + ${tw.implemented} 新增已实现`,
      `  冲突待裁决: ${tw.conflict} 文件（同维度都改且不一致）· 另 ${tw.both_moved} 文件两侧动了不同维度（各自待裁，不算冲突）`,
      `  已收敛: ${tw.converged} 文件 · 一致未动: ${tw.unchanged} 文件 · 设计撤销 ${tw.removed} · 实现塌方 ${tw.deleted_from_live}`,
      (() => {
        const bl = baselineAdvanceBlockers(tw);
        return bl.length === 0
          ? '  ★ 基线可前移到 live：实际侧已清零（设计侧的未落地活不阻塞）'
          : `  ★ 基线**不可**前移：${bl.join(' · ')}`;
      })(),
    );
  }

  // 有变更时列出详情
  // 三方对比存在时，conflict 文件会在下方"冲突待裁决"段单独列出符号两侧增量，
  // 此处排除避免同一文件的符号在"变更详情"+"冲突待裁决"重复列举（输出膨胀）。
  const conflictPaths = baseline ? new Set(threeWay.filter((f) => f.state === 'conflict').map((f) => f.path)) : new Set<string>();
  const changedFiles = fileDiffs.filter((f) => f.change !== 'unchanged' && !conflictPaths.has(f.path));
  if (changedFiles.length > 0) {
    lines.push('', `  ─ 变更详情 ─`);
    for (const f of changedFiles) {
      const changeIcon = f.change === 'added' ? '+' : f.change === 'removed' ? '-' : '~';
      const linesInfo = f.design_lines !== undefined || f.live_lines !== undefined
        ? ` (${f.design_lines ?? '—'} → ${f.live_lines ?? '—'} 行)`
        : '';
      const layerInfo = f.design_layer || f.live_layer
        ? ` [${f.design_layer ?? '—'} → ${f.live_layer ?? '—'}]`
        : '';
      lines.push(`    ${changeIcon} ${f.path}${linesInfo}${layerInfo}`);

      // 符号变更
      for (const s of f.symbols) {
        const sIcon = s.change === 'added' ? '+' : s.change === 'removed' ? '-' : '~';
        const sRange = s.design_line !== undefined
          ? `L${s.design_line}`
          : `L${s.live_line}`;
        const sSig = s.design_signature || s.live_signature
          ? ` — ${s.design_signature ?? s.live_signature}`
          : '';
        lines.push(`      ${sIcon} ${s.kind}: ${s.name} (${sRange})${sSig}`);
      }

      // API 变更
      for (const a of f.apis) {
        const aIcon = a.change === 'added' ? '+' : a.change === 'removed' ? '-' : '~';
        const aLine = a.design_line !== undefined ? `L${a.design_line}` : `L${a.live_line}`;
        lines.push(`      ${aIcon} ${a.signature} (${aLine})`);
      }
    }
  }

  // 无变更
  // ★ 口径不一致时**不许**印「完全一致」：那会把「拒绝硬比」说成「没差异」（0.12）。
  if (comparable && changedFiles.length === 0 && edgeDiffs.length === 0 && design && live && twSummary.conflict === 0) {
    lines.push('', '  ✓ 设计视图与实际代码快照完全一致');
  }

  // 边级变更详情（结构塌方高优先级列出）
  if (edgeDiffs.length > 0) {
    lines.push('', `  ─ 依赖边变更 ─`);
    for (const d of edgeDiffs) {
      const icon = d.change === 'added' ? '+' : '-';
      lines.push(`    ${icon} ${d.from} → ${d.to}${d.change === 'removed' ? '（结构塌方）' : ''}`);
    }
  }

  // 三方冲突详情（交 LLM 读 diff 裁决：设计侧 vs 实现侧各自相对基线的增量）
  if (baseline) {
    const conflicts = threeWay.filter((f) => f.state === 'conflict');
    if (conflicts.length > 0) {
      lines.push('', `  ─ 冲突待裁决（两侧都相对基线改动且不一致）─`);
      for (const f of conflicts) {
        const ln = `(基线 ${f.baseline_lines ?? '—'} 行 → 设计 ${f.design_lines ?? '—'} / 实现 ${f.live_lines ?? '—'} 行)`;
        lines.push(`    ~ ${f.path} ${ln}`);
        const emit = (tag: string, syms: SymbolDiff[], apis: ApiDiff[]) => {
          for (const s of syms) {
            const icon = s.change === 'added' ? '+' : s.change === 'removed' ? '-' : '~';
            const sig = s.design_signature || s.live_signature ? ` — ${s.design_signature ?? s.live_signature}` : '';
            lines.push(`        ${tag} ${icon} ${s.kind}: ${s.name}${sig}`);
          }
          for (const a of apis) {
            const icon = a.change === 'added' ? '+' : a.change === 'removed' ? '-' : '~';
            lines.push(`        ${tag} ${icon} ${a.signature}`);
          }
        };
        emit('[设计]', f.intent_symbols, f.intent_apis);
        emit('[实现]', f.implement_symbols, f.implement_apis);
      }
    }
  }

  // 决策卡依据（LLM 裁决的一手资料）：列出三方对比中有决策卡的文件的决策上下文
  if (baseline) {
    const withDecisions = threeWay.filter(
      (f) => f.baseline_decision || f.design_decision || (f.symbol_decisions && Object.keys(f.symbol_decisions).length > 0) || f.archive,
    );
    if (withDecisions.length > 0) {
      lines.push('', `  ─ 决策卡依据（裁决的一手资料：基线卡=当初为何这么定 / 设计卡=现在为何改 / 归档=历史弃用）─`);
      for (const f of withDecisions) {
        lines.push(`    ${f.state} ${f.path}`);
        if (f.baseline_decision) {
          const st = f.baseline_decision.status ? ` (${f.baseline_decision.status})` : '';
          lines.push(`        [基线卡] ${f.baseline_decision.summary}${st} — 当初为何这么定`);
        }
        if (f.design_decision) {
          lines.push(`        [设计卡] ${f.design_decision.summary} — 现在为何改`);
        }
        for (const [sym, card] of Object.entries(f.symbol_decisions ?? {})) {
          lines.push(`        [符号卡] ${sym}: ${card.summary}`);
        }
        if (f.archive) {
          const merged = f.archive.merged_into ? ` → 合并到 ${f.archive.merged_into}` : '';
          const at = f.archive.archived_at ? ` (${f.archive.archived_at.slice(0, 10)})` : '';
          lines.push(`        [归档] 弃用原因: ${f.archive.retire_reason ?? '—'}${merged}${at}`);
        }
      }
    }
  }

  // 某侧缺失
  if (!design) {
    lines.push('', '  ⚠ 设计视图不存在 — 请用 import_project 生成设计 DSL（★ 没有 manage_feature 这个工具，2026-10-30 已删）');
  }
  if (!live) {
    lines.push('', '  ⚠ 实际视图不存在 — 请先运行 import_project(live_only=true) 生成代码快照');
  }

  lines.push('', '  (需要更多细节请使用 query_feature 查询单个文件)');
  // ★ T86：把「事实抵消」的前提核对结果**印出来**（不满足时不静默 —— 否则数字看着精确、其实含义变了）
  if (factsNotes.length) {
    lines.push('', '  ── ⚠ 本次比较的**前提未满足**（影响下面差异的**含义**）──');
    for (const n of factsNotes) lines.push(`    ${n}`);
    lines.push('    ★ 读法：凡"事实未抵消"的情形，本页差异**不能**直接读成「设计变了」或「代码变了」。');
  }

  return {
    message: lines.join('\n'),
    data: {
      feature,
      design_exists: !!design,
      live_exists: !!live,
      baseline_exists: !!baseline,
      // ★ T86：**前提成立时这个键根本不出现**（见类型上的说明 —— 防御成本要匹配触发概率）
      ...(factsNotes.length ? { notes: factsNotes } : {}),
      path_basis: basis,
      comparable,
      ...(fresh && freshLine ? { freshness: { ...fresh, line: freshLine } } : {}),
      scope: {
        label: scopeRes.label,
        universe_files: universe.size,
        scoped_files: allPaths.length,
        uncovered_files: universe.size - allPaths.length,
        files: allPaths,
        notes: scopeNotes,
      },
      backfill,
      summary: {
        design_files: designFiles.length,
        live_files: liveFiles.length,
        added_files: added,
        removed_files: removed,
        modified_files: modified,
        unchanged_files: unchanged,
        universe_files: universe.size,
        scoped_files: allPaths.length,
        uncovered_files: universe.size - allPaths.length,
        design_symbols: designSymbols,
        live_symbols: liveSymbols,
        design_apis: designApis,
        live_apis: liveApis,
        added_edges: addedEdges,
        removed_edges: removedEdges,
      },
      files: fileDiffs,
      edges: edgeDiffs,
      three_way: baseline
        ? {
            baseline_files: baselineFiles.length,
            summary: twSummary,
            files: threeWay,
            /**
             * ★ 基线能否前移到 live：**实际侧清零**即可（设计的活不算阻塞）。
             * ★ 这一步**不做**任何写操作 —— 前移等于"宣布新的出发点"，
             *   必须有理由（决策卡），不能由只读工具代劳。
             */
            baseline_can_advance: {
              ok: baselineAdvanceBlockers(twSummary).length === 0,
              blockers: baselineAdvanceBlockers(twSummary),
              note: 'design_only / added / removed 不阻塞（那是 ⑥ 未落地的活）；前移需决策卡，本工具只判不写。',
            },
          }
        : undefined,
    },
  };
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: DiffViewsInput, scopeFiles?: string[]): Touched {
  // 只给**作用域类** feature：本 [B] 是**只读对比**——它读的是同一 feature 的
  // baseline / design / live 三个 DSL 视图（**存储**，不是源文件）⇒ ★ 对象类字段**给不出**：
  //   · written_files：本次没写源文件（读的是 DSL）；
  //   · symbols / nodes：产物里虽然满是符号/节点 diff，但那是"**两侧差集**"，
  //     不是"本次调用确立下来的对象" ⇒ 塞进 symbols/nodes 会把"差异"错当"锚点"。
  // feature 为必填入参 ⇒ 随时可给（不依赖成败；查不到视图时 data.design_exists=false 也照给）。
  // ★② 圈定了范围就把它写进 `touched.scope_files`（Touched 里现成的字段：
  //   “被框定/被审阅的作用面”，只读工具也成立）⇒ 下游 `next_hop_args` 能直接接着用。
  //   ★ 全量时不填：那是几百条路径，填进去只会淹掉真正的作用面。
  return {
    feature: input.feature,
    ...(scopeFiles && scopeFiles.length ? { scope_files: scopeFiles } : {}),
  };
}

export function diffViews(input: DiffViewsInput): TouchedProduct<DiffViewsResult> {
  const r = diffViewsCore(input);
  // ★ 范围只算一次（core 里算的）⇒ 这里直接取，不再重算一遍（同一事实两处算 = 两份口径）。
  return withTouched(r, touchedOf(input, r.data.scope.files));
}

/** ★② 范围解析的结果：`paths === null` = **不约束**（全量）；`[]` = 圈定了但**一个文件都没有** */
export interface DiffScopeResolution {
  /** 人读的范围标签（`全量（未圈定）` / `files:src/x/` / `card:<id>`） */
  label: string;
  /** 要比较的路径（设计口径，已排序去重）；`null` = 不约束 */
  paths: string[] | null;
  /** 解析诊断（**不许静默**：空集、没设计视图、scope 解析器的 notes 全在这里） */
  notes: string[];
}

/**
 * ★② **范围**：把 `scope` / `card` 解成"要比较哪些文件"。
 *
 * 判据（四条，缺一条就有静默失败）：
 * 1. 两者都**不给** ⇒ `paths: null`（不约束）—— 读数里照样打印「全量」与「未覆盖 0」；
 * 2. 两者**同给** ⇒ **抛错**：都是"圈定范围"，同给等于两种口径打架（拒绝必须可定位）；
 * 3. `scope` ⇒ 复用 `domain/scope.ts#resolveScopeText`（文法唯一住处，不新造解析）；
 * 4. `card` ⇒ 复用 `rewrite_plan.ts#planChangeSetOfCard`（坍缩集的唯一权威，不自己查 plans 表）。
 * ★ 空集**必须**进 `notes`：`0 条差异` 与 `没有差异` 是两件事（0.12）。
 */
export function resolveDiffScope(
  design: DesignDSL | null,
  input: Pick<DiffViewsInput, 'scope' | 'card'>,
  projectRoot: string | undefined,
): DiffScopeResolution {
  const scope = (input.scope ?? '').trim();
  const card = (input.card ?? '').trim();
  if (scope && card) {
    throw new Error(
      `diff_views 的 \`scope\` 与 \`card\` **只能给一个**（收到 scope="${scope}" · card="${card}"）—— ` +
        '两者都是"圈定范围"，同给等于两种口径打架：按卡就只给 card，按语法就只给 scope。',
    );
  }
  if (!scope && !card) return { label: '全量（未圈定）', paths: null, notes: [] };
  if (card) {
    if (!projectRoot) {
      return {
        label: `card:${card}`,
        paths: [],
        notes: ['★ 给了 `card` 但没有设计视图的 `source_root` ⇒ 无法求该卡的坍缩集（本次范围 = 0 个文件）。'],
      };
    }
    const files = planChangeSetOfCard(projectRoot, card).map((c) => c.file);
    if (!files.length) {
      return {
        label: `card:${card}`,
        paths: [],
        notes: [
          `★ 卡 "${card}" 的**坍缩集为空**（它名下没有画布，或画布没登记任何文件）⇒ 本次范围 = 0 个文件；` +
            '★ 这**不等于**"没有差异"。',
        ],
      };
    }
    return { label: `card:${card}`, paths: [...new Set(files.map(normRelPath))].sort(), notes: [] };
  }
  if (!design) {
    throw new Error(`给了 \`scope\` "${scope}" 但没有设计视图 ⇒ 范围无处解析（先 import_project 建册）。`);
  }
  const rs = resolveScopeText(design, scope);
  return { label: scope, paths: rs.paths, notes: [...rs.notes] };
}

// ──────── 辅助函数 ────────

/**
 * 判断两个文件内容是否不同（相对比较用，非严格全等）。
 * 只比较语义相关字段：行数、层级标签、符号、API。两方都不存在视为相同。
 */
/**
 * ★★★ 0.29② 的分类落到「**可比较维度**」上：只有**结构/清单层**参与 design-vs-live / design-vs-baseline
 * 比较；**意图层**字段不参与 —— 因为**实际册与基线不承载意图**（源码不会表达"我为什么存在"）
 * ⇒ 拿它做 design-vs-actual 比较是**范畴错误**：实际侧永远没这个值，比出来必然全是"设计改了命名"。
 *
 * ★ 为什么它必须是**机器判据**而不是一句注释：`metaChanged` 逐维消费本清单（`intentOnly`）——
 *   加一格就真的不比那一格；写散文则下一个人只能靠自觉。
 * ★ 判据（不是"我觉得这几个字段不该比"）：每一格的 `why` 都必须能指回 AGENTS 0.29② 的字段分类。
 */
const INTENT_ONLY_FIELDS: ReadonlyArray<{ field: string; why: string }> = [
  {
    field: 'responsibility',
    why: '意图层（0.29②：人写）—— 实际册/基线不产生意图 ⇒ 比较它恒报"设计改了命名"',
  },
];

/** 这一维是否属**意图层**（⇒ 不参与 design-vs-actual 比较） */
const intentOnly = (field: string): boolean => INTENT_ONLY_FIELDS.some((x) => x.field === field);

/**
 * ★★★ 命名维度：**人改的那一层**（层归属）。
 *
 * ## 为什么要与 `structChanged` 分开（2026-10-19 实测）
 * `fileChanged` 把五样东西混成一个布尔（lines / layer / symbols / apis）。
 * 于是「设计改了命名」+「实现改了行数」= 两边都 changed ⇒ 直接落进 `conflict` 分支。
 * 实测 3 条冲突全是这个形状（`design_lines == baseline_lines` 而 `live_lines` 变了）。
 *
 * ★ 边界：`label` 在 `geometry.nodes` 上、不在 `SemanticFile` 里 ⇒ 本函数比不了 label；
 *   它只比 SemanticFile 自身有的"人能改的字段"，而**意图层字段按 0.29② 不参与**（见 `INTENT_ONLY_FIELDS`）。
 */
function metaChanged(a: SemanticFile | undefined, b: SemanticFile | undefined): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  /** 每一个"人能改的一层"一个格子；`intentOnly` 为真 ⇒ 这一维**不参与**比较 */
  const dimensions: Array<{ field: string; changed: () => boolean }> = [
    { field: 'layer', changed: () => (a.layer ?? '') !== (b.layer ?? '') },
    { field: 'responsibility', changed: () => (a.responsibility ?? '') !== (b.responsibility ?? '') },
  ];
  return dimensions.some((d) => !intentOnly(d.field) && d.changed());
}

/**
 * ★★★ 结构维度：**机器扫的那一层**（行数 / 符号 / API）。
 * 它与 `metaChanged` 正交：一个改"叫什么"，一个改"长什么样"。
 * 冲突只在**同一维度**两边都改时成立 —— 见 `ThreeWayState` 的 `both_moved` 注释。
 */
function structChanged(
  a: SemanticFile | undefined,
  b: SemanticFile | undefined,
  aRoot?: string,
  bRoot?: string,
): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  if (a.lines !== b.lines) return true;
  if (diffSymbols(a.symbols ?? [], b.symbols ?? []).length > 0) return true;
  return diffApis(mergedApis(aRoot, a.path, a.expected_apis), mergedApis(bRoot, b.path, b.expected_apis)).length > 0;
}

/**
 * ★★★ **基线前移的阻塞项**（2026-10-19）：
 * 规则：「实际侧和基线的差异为零……但是实际侧的修改全都被合并进去了以后，这个基线就应该移动了。」
 *
 * 判据只有一条：**实际侧的改动必须清零**。设计侧未落地的活（`design_only` / `added` / `removed`）
 * **不算阻塞** —— 那是 ⑥ 的工作，不该卡住基线。
 *
 * ★ 为什么它必须是独立纯函数：它是"什么时候可以宣布新出发点"的唯一判据，
 *   散在输出拼接里会变成第二个口径（本仓头号病）。
 */
export function baselineAdvanceBlockers(summary: ThreeWaySummary): string[] {
  const blockers: string[] = [];
  if (summary.live_only > 0) blockers.push(`live_only=${summary.live_only}（实际改了，设计没跟）`);
  if (summary.conflict > 0) blockers.push(`conflict=${summary.conflict}（同维度两边都改）`);
  if (summary.both_moved > 0) blockers.push(`both_moved=${summary.both_moved}（两侧动了不同维度）`);
  if (summary.deleted_from_live > 0) blockers.push(`deleted_from_live=${summary.deleted_from_live}（实际删了，设计还有）`);
  return blockers;
}

function fileChanged(
  a: SemanticFile | undefined,
  b: SemanticFile | undefined,
  // ★ T20：事实（actual_apis）已不在 DSL 里 ⇒ 要把它算进来就必须知道"去哪儿取"（各侧自己的 source_root）
  aRoot?: string,
  bRoot?: string,
): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  if (a.lines !== b.lines || a.layer !== b.layer) return true;
  if (diffSymbols(a.symbols ?? [], b.symbols ?? []).length > 0) return true;
  if (
    diffApis(
      mergedApis(aRoot, a.path, a.expected_apis),
      mergedApis(bRoot, b.path, b.expected_apis),
    ).length > 0
  ) {
    return true;
  }
  return false;
}

/**
 * 噪音符号判定：单字母/双字母 const（r/g/b/a/i/id…）——循环计数器、临时变量、
 * 颜色通道分量等，不是 API 表面。它们的行号随快照时刻漂移即触发假阳性"modified"→
 * 假阳性 conflict。从 diff 比较中排除，避免 .cjs 脚本内部变量撑爆冲突清单。
 */
function isDiffNoiseSymbol(s: Symbol): boolean {
  return s.kind === 'const' && s.name.length <= 2;
}

/**
 * 两符号列表是否语义一致（同名+同类+同签名，忽略行号偏移）。
 * 快照时刻不同导致的行号漂移（注释增删、上方代码改动）不是语义冲突；
 * 用于 desEqLiv 判定 → converged 而非 conflict。
 */
function symbolsSemanticallyEqual(a: Symbol[], b: Symbol[]): boolean {
  const fa = a.filter((s) => !isDiffNoiseSymbol(s));
  const fb = b.filter((s) => !isDiffNoiseSymbol(s));
  if (fa.length !== fb.length) return false;
  const key = (s: Symbol) => `${s.name}|${s.kind}|${s.signature ?? ''}`;
  const sa = new Set(fa.map(key));
  for (const s of fb) {
    if (!sa.has(key(s))) return false;
  }
  return true;
}

/** 比较两个符号列表，返回变更列表 */
function diffSymbols(design: Symbol[], live: Symbol[]): SymbolDiff[] {
  // 过滤噪音符号（单字母 const 等局部变量）——它们不是 API 表面，
  // 行号/签名微小差异即造成假阳性冲突
  const d = design.filter((s) => !isDiffNoiseSymbol(s));
  const l = live.filter((s) => !isDiffNoiseSymbol(s));

  const result: SymbolDiff[] = [];
  const liveByName = new Map<string, Symbol>();
  for (const s of l) liveByName.set(s.name, s);

  const designByName = new Map<string, Symbol>();
  for (const s of d) designByName.set(s.name, s);

  // 找 design 中有的
  for (const ds of d) {
    const ls = liveByName.get(ds.name);
    if (!ls) {
      result.push({ name: ds.name, kind: ds.kind, change: 'removed', design_line: ds.line, design_signature: ds.signature });
    } else if (
      ds.line !== ls.line ||
      ds.end_line !== ls.end_line ||
      ds.signature !== ls.signature ||
      ds.kind !== ls.kind
    ) {
      result.push({
        name: ds.name, kind: ds.kind, change: 'modified',
        design_line: ds.line, live_line: ls.line,
        design_signature: ds.signature, live_signature: ls.signature,
      });
    }
  }

  // 找 live 中新增的
  for (const ls of l) {
    if (!designByName.has(ls.name)) {
      result.push({ name: ls.name, kind: ls.kind, change: 'added', live_line: ls.line, live_signature: ls.signature });
    }
  }

  // 去重：同一符号名一个输出契约里只应出现一次（keep first）。
  // 上游 DSL 快照（模块聚合 / 多视图残留）可能把同一符号列两份——行号相同、内容相同，
  // 若不去重 diff 输出会"每个符号列两遍"，污染变更详情与冲突清单。
  const seen = new Set<string>();
  return result.filter((r) => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
}

/** 比较两个 API 列表，返回变更列表 */
function diffApis(design: ExpectedApi[], live: ExpectedApi[]): ApiDiff[] {
  const result: ApiDiff[] = [];
  const liveBySig = new Map<string, ExpectedApi>();
  for (const a of live) liveBySig.set(a.signature, a);

  const designBySig = new Map<string, ExpectedApi>();
  for (const a of design) designBySig.set(a.signature, a);

  // 找 design 中有的
  for (const da of design) {
    const la = liveBySig.get(da.signature);
    if (!la) {
      result.push({ signature: da.signature, change: 'removed', design_line: da.line });
    } else if (da.line !== la.line || da.end_line !== la.end_line) {
      result.push({ signature: da.signature, change: 'modified', design_line: da.line, live_line: la.line });
    }
  }

  // 找 live 中新增的
  for (const la of live) {
    if (!designBySig.has(la.signature)) {
      result.push({ signature: la.signature, change: 'added', live_line: la.line });
    }
  }

  // 去重：同一 signature 一个输出契约里只应出现一次（keep first）。
  // 上游 DSL 的 actual_apis 常等于 expected_apis（import_project 落库即如此），
  // 两视图 diff 传入的入参是 [...expected, ...actual] 的【拼接】→ 同一 API 出现两次，
  // 若不按 signature 去重，design 循环会为同一 API 产两条 removed/modified → 输出"每符号两遍"。
  const seen = new Set<string>();
  return result.filter((r) => {
    if (seen.has(r.signature)) return false;
    seen.add(r.signature);
    return true;
  });
}

/**
 * 边级 diff：比较设计视图与 live 视图的依赖边。
 * 只比较「两端都是两视图共有文件节点」的边，避免容器边 / 非文件节点 / 视图层级不一致造成的噪音。
 * - 设计有 / 实际无 → removed（结构塌方）
 * - 实际有 / 设计无 → added（新增依赖）
 */
function diffEdges(
  design: Edge[],
  live: Edge[],
  designFileIds: Set<string>,
  liveFileIds: Set<string>,
): EdgeDiff[] {
  const key = (e: Edge): string => e.from + '\u0000' + e.to;
  const comparable = (e: Edge): boolean =>
    designFileIds.has(e.from) && designFileIds.has(e.to) && liveFileIds.has(e.from) && liveFileIds.has(e.to);

  const liveKeys = new Set<string>();
  for (const e of live) if (comparable(e)) liveKeys.add(key(e));
  const designKeys = new Set<string>();
  for (const e of design) if (comparable(e)) designKeys.add(key(e));

  const result: EdgeDiff[] = [];
  for (const e of design) {
    if (comparable(e) && !liveKeys.has(key(e))) {
      result.push({ from: e.from, to: e.to, change: 'removed' });
    }
  }
  for (const e of live) {
    if (comparable(e) && !designKeys.has(key(e))) {
      result.push({ from: e.from, to: e.to, change: 'added' });
    }
  }
  return result;
}

// ──────── 决策卡上下文辅助 ────────

/** 比较两侧 DSL 某文件的文件级决策卡（node.decision + history）是否变化——决策卡变了就是设计变了 */
function fileDecisionChanged(a: DesignDSL | null, b: DesignDSL | null, path: string, aId?: string, bId?: string): boolean {
  const fa = a?.semantic?.files.find((f) => f.path === path) ?? a?.semantic?.files.find((f) => f.id === aId);
  const fb = b?.semantic?.files.find((f) => f.path === path) ?? b?.semantic?.files.find((f) => f.id === bId);
  if (!fa || !fb) return false; // 存在性由 fileChanged 处理
  const na = a?.geometry?.nodes?.find((n) => n.id === fa.id);
  const nb = b?.geometry?.nodes?.find((n) => n.id === fb.id);
  return (
    JSON.stringify(na?.decision ?? null) !== JSON.stringify(nb?.decision ?? null) ||
    JSON.stringify(na?.decision_history ?? null) !== JSON.stringify(nb?.decision_history ?? null)
  );
}

/** 比较两侧文件符号级决策卡是否变化（挂函数/API 上的卡） */
function symbolsDecisionChanged(fa: SemanticFile | undefined, fb: SemanticFile | undefined): boolean {
  if (!fa || !fb) return false;
  const key = (s: Symbol) => `${s.name}|${JSON.stringify(s.decision ?? null)}`;
  const sa = new Set((fa.symbols ?? []).map(key));
  const sb = new Set((fb.symbols ?? []).map(key));
  if (sa.size !== sb.size) return true;
  for (const k of sa) if (!sb.has(k)) return true;
  return false;
}

/** 取 DSL 中某文件的文件级决策卡（几何层 Node.decision + history，LLM 当初为什么这么定） */
function fileDecisionRef(dsl: DesignDSL | null, filePath: string, fileId?: string): DecisionCardRef | undefined {
  const d = dsl?.semantic?.files.find((f) => f.path === filePath) ?? dsl?.semantic?.files.find((f) => f.id === fileId);
  if (!d) return undefined;
  const node = dsl?.geometry?.nodes?.find((n) => n.id === d.id);
  const dec = node?.decision;
  if (!dec) return undefined;
  return {
    summary: dec.summary,
    rationale: dec.rationale,
    status: dec.status,
    thread: dec.thread,
    tags: dec.tags,
    history: node?.decision_history,
  };
}

/** 收集 DSL 中某文件的符号级决策卡（挂函数/API 上的卡，symbol → 卡） */
function symbolDecisionRefs(dsl: DesignDSL | null, filePath: string): Record<string, DecisionCardRef> {
  const out: Record<string, DecisionCardRef> = {};
  const f = dsl?.semantic?.files.find((x) => x.path === filePath);
  for (const s of f?.symbols ?? []) {
    if (!s.decision) continue;
    out[s.name] = {
      summary: s.decision.summary,
      rationale: s.decision.rationale,
      status: s.decision.status,
      thread: s.decision.thread,
      tags: s.decision.tags,
      history: s.decision_history,
    };
  }
  return out;
}

/** 删除类状态时查下线库归档关联（历史研究材料），无则 undefined */
function getArchiveRef(
  feature: string,
  filePath: string,
  state: ThreeWayState,
  live_dir?: string,
): { retire_reason?: string; merged_into?: string; archived_at?: string } | undefined {
  if (state !== 'removed' && state !== 'deleted_from_live') return undefined;
  const entry = getArchiveEntryByPath(feature, filePath, live_dir);
  if (!entry) return undefined;
  return {
    retire_reason: entry.retire_reason,
    merged_into: entry.merged_into,
    archived_at: entry.archived_at,
  };
}