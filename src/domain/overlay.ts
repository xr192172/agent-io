/**
 * 设计层 overlay（design intent 增量保留层）
 *
 * 定位：真相 DSL（base）由代码扫描每次可再生，但设计意图（决策卡 / 决策历史 /
 * 设计参数 / 标注 / user_node / 分镜 / 主题）不是扫描能重造的。过去真相一刷新，
 * 设计 DSL 整体被 finalizeDsl 覆盖（saveDSL 直写），意图全丢。
 *
 * 本模块把设计意图抽成独立 overlay，通过「稳定锚点」增量对账，真相刷新时只替换
 * base，overlay 按锚点保留 / 迁移 / 孤儿 / 标过期，绝不整体覆盖。与项目铁律同构：
 * 真相单源 + 单向投影 + 对账（不改 DSL 只报偏差）。
 *
 * 存储：<features>/<feature>.overlay.json（见 storage_overlay.ts）。
 */
import { createHash } from 'node:crypto';
import type { DesignDSL } from './types.js';
import type { NodeDecision, DecisionHistoryEntry } from './geometry.js';
import type { Annotation } from './annotation.js';
import type { ThemeId, UserNode } from './types.js';
import type { ExpectedApi, Symbol } from './semantic.js';

/** 一个极简不可变 sha1 指纹，用于判断「接口签名变化」（过期的信号） */
export function computeFileSignature(
  apis: ExpectedApi[],
  nonFuncSymbols: Symbol[],
  lineCount: number,
): string {
  const parts = [
    ...(apis ?? []).map((a) => a.signature ?? '').sort(),
    ...(nonFuncSymbols ?? []).map((s) => `${s.kind}:${s.name}`).sort(),
    String(lineCount ?? 0),
  ].join('\n');
  return createHash('sha1').update(parts).digest('hex').slice(0, 12);
}

/** overlay 锚点：一份挂在稳定锚点上的设计意图 */
export interface OverlayAnchor {
  /** 相对路径（file=rel 路径；dir/brick=解码后的路径名） */
  path?: string;
  kind?: 'file' | 'dir' | 'brick' | 'symbol' | 'doc';
  /** 接口指纹（仅 file 节点有；dir/brick 无 → 永不判 stale） */
  signature?: string;
  /** 决策卡：结论/理由/替代/后果/验收 */
  decision?: NodeDecision;
  /** 决策卡·版本栈 */
  decision_history?: DecisionHistoryEntry[];
  /** 决策卡·参数表 */
  attributes?: Record<string, string | number | boolean>;
  /** 挂在该节点上的标注 */
  annotations?: Annotation[];
  /** 对账标记：真相面路径在、签名变 → 设计可能过期，需复核（不丢弃） */
  stale?: boolean;
  /** 对账标记：真相面已删除该锚点 → 设计暂存待决（不静默丢） */
  orphaned?: boolean;
  /** 迁移自哪个旧锚点（改名/换 id 时记录，便于审计） */
  _migratedFrom?: string;
}

/** overlay 全局件（不挂在具体节点上） */
export interface OverlayGlobal {
  /** feature 标题（人工修正的主题名） */
  title?: string;
  theme?: ThemeId;
  /** 顶层标注（未归属到单节点的） */
  annotations?: Annotation[];
  /** 人机共笔枝：用户在 AI 生成树上新增的分支 */
  user_nodes?: UserNode[];
  /** 科普分镜 meta.storyboard */
  storyboard?: unknown;
  /** 结构化目标/方向（缺口④）：全局性设计意图，LLM 开发时作为方向信号读 */
  goals?: OverlayGoal[];
  /**
   * ★★★ **功能标记**（人机共创第一块地基，2026-10-09）：人给**文件节点**打的多值标签，
   * 说它**隶属某功能** —— tag → 成员文件的**仓库相对路径**列表。
   *
   * ## 为什么是"一个方向"（判据分叉是本仓头号病）
   * 只存 **tag → 成员** 这一个方向；"**这个文件属哪些功能**"**反查而得**（遍历各 tag 的成员）。
   * ★ **绝不两个方向都存** —— 否则两份数据会漂移，且"谁是权威"无解。
   *
   * ## 为什么住 `overlay.global`（而不是新造"功能节点"，也不住 base）
   * · ❌ **不造功能节点**：那是又一个「聚合节点冒充节点」（本仓 2026-10-09 刚清掉的病，见 T93）；
   * · ❌ **不住 base**：base 可再生成，`import_project` 重建会冲掉人写的标记
   *   （T75/T77 已踩过：人写的决策一重建就丢，而"overlay 独立保留"正是它存在的全部理由）；
   * · ✅ 它是**feature 级**意图（不挂在单个锚点上）⇒ 与 `goals`/`title` 同族，住 `global`。
   *
   * ## 读到哪
   * `applyOverlay` 把它投影进 base 的 `meta.function_tags`（与 `goals → meta.goals` 同款），
   * 让 `get_dsl` 当下即可读到；`mergeTagsIntoOverlay` 在每次改动收口时把 base 的标记同步回来。
   */
  function_tags?: Record<string, string[]>;
}

/** 结构化目标/方向（缺口④）：全局性设计意图，落库进 base meta.goals */
export interface OverlayGoal {
  id: string;
  title: string;
  description?: string;
  /** active=推进中 · done=完成 · parked=暂缓 · dropped=放弃 */
  status?: 'active' | 'done' | 'parked' | 'dropped';
}

/** 边级设计意图（缺口③）：A 为何依赖 B / 边界归属，挂 base 边 id 上 */
export interface OverlayEdgeIntent {
  /** 源节点 id（对账时用 id→(from,to) 重定向） */
  from: string;
  /** 目标节点 id */
  to: string;
  /** A 为何依赖 B（关系级意图） */
  reason?: string;
  /** 边界归属说明（该依赖跨边界的理由/归属） */
  boundary?: string;
  /** 挂在边上的标注 */
  annotations?: Annotation[];
  /** 意图存活状态 */
  status?: 'open' | 'resolved';
  /** 对账标记：真相面已删该边 → 意图暂存待决（不静默丢） */
  orphaned?: boolean;
  /** 迁移自哪个旧边 id（边 id 变更时记录，便于审计） */
  _migratedFrom?: string;
}

/** 设计层 overlay 文档 */
export interface DesignOverlay {
  version: 1;
  feature: string;
  /** key = 写入时的节点锚点 id */
  anchors: Record<string, OverlayAnchor>;
  /** key = base 边的 id；边级意图随 base 再生按 id→(from,to) 对账保留 */
  edges?: Record<string, OverlayEdgeIntent>;
  global?: OverlayGlobal;
}

/** 真相面一个锚点候选（用于把旧 overlay 对齐到新 base） */
export interface AnchorCandidate {
  id: string;
  path: string;
  kind: 'file' | 'dir' | 'brick' | 'symbol' | 'doc';
  /** 接口指纹 */
  signature?: string;
}

/** 对账统计（报告用） */
export interface ReconcileStats {
  retained: number;
  migrated: number;
  orphaned: number;
  stale: number;
}

/** 从节点推导稳定路径（file 用 description=rel；dir/brick 解码 id 前缀）。base 与 seed 共用，保证两次对齐一致 */
export function nodePath(n: { id: string; type?: string; description?: string }): string {
  if (n.type === 'file') return n.description ?? n.id;
  if (n.type === 'module' && n.id.startsWith('dir_')) return decodeDirId(n.id);
  if (n.id.startsWith('brick_')) return n.id.slice('brick_'.length);
  return n.description ?? n.id;
}

function decodeDirId(id: string): string {
  // dir_id 由 sanitize(rel) 生成（非字母数字 → _）。解码丢失点，但 base 侧每次同样解码 → 两侧一致。
  return id.slice('dir_'.length).replace(/_/g, '/');
}

/** 从一份已落盘的 base DSL 提取锚点候选（签名由 semantic.files 带出） */
export function buildCandidates(dsl: DesignDSL): AnchorCandidate[] {
  const bySem = new Map((dsl.semantic?.files ?? []).map((f) => [f.id, f]));
  return (dsl.geometry?.nodes ?? []).map((n) => {
    const sf = bySem.get(n.id);
    const kind: AnchorCandidate['kind'] =
      n.type === 'module'
        ? 'dir'
        : n.id.startsWith('brick_')
          ? 'brick'
          : n.type === 'file'
            ? 'file'
            : 'symbol';
    let signature: string | undefined;
    if (sf && kind === 'file') {
      signature = computeFileSignature(sf.expected_apis ?? [], sf.symbols ?? [], sf.lines ?? 0);
    }
    return { id: n.id, path: nodePath(n), kind, signature };
  });
}

/** 边级对账用候选：从 base 提取边的稳定身份（id + from→to 端点） */
export interface EdgeCandidate {
  id: string;
  from: string;
  to: string;
}

/** 从一份 base DSL 提取边候选（对旧 overlay.edges 做 id→(from,to) 对账用） */
export function buildEdgeCandidates(base: DesignDSL): EdgeCandidate[] {
  return (base.geometry?.edges ?? []).map((e) => ({ id: e.id, from: e.from, to: e.to }));
}

/** 对账：把旧 overlay 按稳定锚点对齐到新 base 的锚点集 */
export function reconcileOverlay(
  old: DesignOverlay,
  newCandidates: AnchorCandidate[],
  newEdgeCandidates?: EdgeCandidate[],
): { overlay: DesignOverlay; stats: ReconcileStats } {
  const byPath = new Map<string, AnchorCandidate>();
  const bySig = new Map<string, AnchorCandidate[]>();
  for (const c of newCandidates) {
    byPath.set(c.path, c);
    if (c.signature) {
      const arr = bySig.get(c.signature) ?? [];
      arr.push(c);
      bySig.set(c.signature, arr);
    }
  }

  const stats: ReconcileStats = { retained: 0, migrated: 0, orphaned: 0, stale: 0 };
  const anchors: Record<string, OverlayAnchor> = {};

  for (const [oldKey, a] of Object.entries(old.anchors)) {
    // 上轮已判定孤儿的设计：只在首次明示，本轮回收（真相若重现路径会重新长锚点，不再追溯）
    if (a.orphaned) {
      anchors[oldKey] = a;
      continue;
    }

    let target: AnchorCandidate | undefined;

    const byPathHit = a.path ? byPath.get(a.path) : undefined;
    if (byPathHit) {
      target = byPathHit;
    } else if (a.signature) {
      // 路径漂移 → 尝试按接口签名认亲（改名检测）
      target = bySig.get(a.signature)?.[0];
    }

    if (!target) {
      // 真相面已删除该锚点 → 孤儿暂存，不静默丢
      anchors[oldKey] = { ...a, orphaned: true };
      stats.orphaned++;
      continue;
    }

    const migrated = target.id !== oldKey;
    const sigChanged = !!(a.signature && target.signature && a.signature !== target.signature);
    let na: OverlayAnchor;
    if (migrated) {
      // 改名/换 id：以新身份重新挂靠，签名随新路径取（stale 视为新起点，清掉旧标记）
      na = { ...a, path: target.path, kind: target.kind, signature: target.signature ?? a.signature };
      delete na.orphaned;
      delete na.stale;
      na._migratedFrom = oldKey;
      stats.migrated++;
    } else if (sigChanged) {
      // 接口签名变化：保留基线签名 + 标过期。直到签名回到基线才清除，可持续提示复核
      na = { ...a, path: target.path, kind: target.kind };
      delete na.orphaned;
      delete na._migratedFrom;
      na.signature = a.signature; // 保留基线（设计校验时的那份接口指纹）
      na.stale = true;
      stats.stale++;
      stats.retained++; // 设计被保留（仅标过期待复核），计入保留数
    } else {
      // 锚点一致/无基线：采用当前签名作为新基线，清除过期与迁移标记
      na = { ...a, path: target.path, kind: target.kind, signature: target.signature ?? a.signature };
      delete na.orphaned;
      delete na.stale;
      delete na._migratedFrom;
      stats.retained++;
    }
    anchors[target.id] = na;
  }

  // —— 边级意图对账（缺口③）：按 id→(from,to)→孤儿 对齐旧 edges 到新 base 边 ----
  let edges: Record<string, OverlayEdgeIntent> | undefined;
  if (old.edges && Object.keys(old.edges).length > 0) {
    const newById = new Map((newEdgeCandidates ?? []).map((e) => [e.id, e]));
    const newByPair = new Map((newEdgeCandidates ?? []).map((e) => [`${e.from}\u0000${e.to}`, e]));
    const resolved: Record<string, OverlayEdgeIntent> = {};
    for (const [oldEdgeId, intent] of Object.entries(old.edges)) {
      let target = newById.get(oldEdgeId);
      const isOrphaned = intent.orphaned;
      if (!target) {
        if (isOrphaned) { resolved[oldEdgeId] = intent; continue; } // 上轮孤儿：本轮只保留，不再追溯
        // 边 id 变了 → 尝试 (from,to) 认亲（依赖两端稳定则续能识别）
        target = newByPair.get(`${intent.from}\u0000${intent.to}`);
      }
      if (!target) {
        resolved[oldEdgeId] = { ...intent, orphaned: true }; // 真相面该边已删 → 孤儿暂存
        continue;
      }
      resolved[target.id] = target.id === oldEdgeId ? intent : { ...intent, _migratedFrom: oldEdgeId };
    }
    edges = resolved;
  }

  return { overlay: { ...old, anchors, ...(edges ? { edges } : {}) }, stats };
}

function mergeById<T extends { id: string }>(list: T[], add: T[]): T[] {
  const seen = new Set(list.map((x) => x.id));
  const out = [...list];
  for (const a of add) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** 把 overlay 的设计意图合回到 base（返回新对象，不改 base 引用） */
export function applyOverlay(base: DesignDSL, overlay: DesignOverlay): DesignDSL {
  const out: DesignDSL = { ...base };

  const nodes = (base.geometry?.nodes ?? []).map((n) => {
    const a = overlay.anchors[n.id];
    if (!a) return n;
    return {
      ...n,
      ...(a.decision ? { decision: a.decision } : {}),
      ...(a.decision_history ? { decision_history: a.decision_history } : {}),
      ...(a.attributes ? { attributes: a.attributes } : {}),
    };
  });
  out.geometry = { ...base.geometry!, nodes };

  // —— 边级意图（缺口③）：把 overlay.edges 的 reason/boundary 写回 base 边（id 已对账对齐）——
  if (overlay.edges && Object.keys(overlay.edges).length > 0) {
    const edges = (base.geometry?.edges ?? []).map((e) => {
      const ei = overlay.edges![e.id];
      if (!ei || ei.orphaned) return e;
      return { ...e, intent: { reason: ei.reason, boundary: ei.boundary } };
    });
    out.geometry = { ...out.geometry, edges };
  }

  // 标注：锚点内 + 全局，按 id 去重合回
  let anns: Annotation[] = out.annotations ?? [];
  for (const a of Object.values(overlay.anchors)) {
    if (a.annotations?.length) anns = mergeById(anns, a.annotations);
  }
  if (overlay.global?.annotations?.length) anns = mergeById(anns, overlay.global.annotations);
  out.annotations = anns;

  const g = overlay.global;
  if (g) {
    if (g.title) out.title = g.title;
    if (g.theme) out.theme = g.theme;
    if (g.user_nodes?.length) out.user_nodes = g.user_nodes;
    if (g.storyboard !== undefined || g.goals !== undefined || g.function_tags !== undefined) {
      const rec = out as unknown as { meta?: Record<string, unknown> };
      rec.meta = {
        ...(rec.meta ?? {}),
        ...(g.storyboard !== undefined ? { storyboard: g.storyboard } : {}),
        // 结构化目标（缺口④）：落进 meta.goals 供 LLM 作方向信号读；overlay 显式给了 goals（含空数组清空）就如实写入
        ...(g.goals !== undefined ? { goals: g.goals } : {}),
        // 功能标记（人机共创）：tag → 成员文件 rel；落进 base.meta.function_tags 让 get_dsl 当下可读
        ...(g.function_tags !== undefined ? { function_tags: g.function_tags } : {}),
      };
    }
  }
  return out;
}

/**
 * 首次迁移：从一份既有设计 DSL 抽出现有设计意图，铺成 overlay（一次性的兼容垫）。
 * 只保留「人类意图字段」（决策/决策历史/参数/标注/user_node/主题/分镜/标题），
 * 不保留可再生的派生字段（LLM 职责标题、layer/host 分层、布局坐标、i18n title_en）。
 */
export function seedOverlayFromDsl(dsl: DesignDSL | null): DesignOverlay {
  const anchors: Record<string, OverlayAnchor> = {};
  const global: OverlayGlobal = {};

  const annIndex = new Map<string, Annotation[]>();
  for (const a of dsl?.annotations ?? []) {
    const key = a.node_id ?? a.target_id;
    if (!key) {
      (global.annotations ??= []).push(a);
      continue;
    }
    const arr = annIndex.get(key) ?? [];
    arr.push(a);
    annIndex.set(key, arr);
  }

  for (const n of dsl?.geometry?.nodes ?? []) {
    const anns = annIndex.get(n.id);
    if (!n.decision && !n.decision_history && !n.attributes && !anns?.length) continue;
    const a: OverlayAnchor = { path: nodePath(n), kind: nodePathKind(n) };
    if (n.decision) a.decision = n.decision;
    if (n.decision_history) a.decision_history = n.decision_history;
    if (n.attributes) a.attributes = n.attributes;
    if (anns?.length) a.annotations = anns;
    anchors[n.id] = a as OverlayAnchor;
  }

  if (dsl?.title) global.title = dsl.title;
  if (dsl?.theme) global.theme = dsl.theme;
  if (dsl?.user_nodes) global.user_nodes = dsl.user_nodes;
  const meta = (dsl as unknown as { meta?: { storyboard?: unknown; goals?: OverlayGoal[]; function_tags?: Record<string, string[]> } } | null)?.meta;
  if (meta?.storyboard) global.storyboard = meta.storyboard;
  if (meta?.goals && meta.goals.length > 0) global.goals = meta.goals;
  // 功能标记：首次迁移把 base 上已有的标记铺回 overlay（此后以 overlay 为权威）
  if (meta?.function_tags && Object.keys(meta.function_tags).length > 0) global.function_tags = meta.function_tags;

  // 边级意图（缺口③）：base 若已带 edge.intent（上一轮 apply 产物）→ 铺回 overlay，保证迁移/回环不掉
  const edges: Record<string, OverlayEdgeIntent> = {};
  for (const e of dsl?.geometry?.edges ?? []) {
    if (!e.intent) continue;
    edges[e.id] = {
      from: e.from,
      to: e.to,
      reason: e.intent.reason,
      boundary: e.intent.boundary,
    };
  }

  return {
    version: 1,
    feature: dsl?.feature ?? '',
    anchors,
    ...(Object.keys(edges).length ? { edges } : {}),
    global: Object.keys(global).length ? global : undefined,
  };
}

function nodePathKind(n: { id: string; type?: string }): OverlayAnchor['kind'] {
  if (n.type === 'module' || n.id.startsWith('dir_')) return 'dir';
  if (n.type === 'file') return 'file';
  // ★★★ T88：**文档是一类节点**（`type: 'doc'`）—— 与源码文件**分开**（★ L1 判据明写
  //   ".md 是**可读文本**，不是源码"，见 `source_exts.ts:27`）⇒ 锚点类型也必须分开，
  //   否则它会被下面的兜底判成 `symbol`（**语义错**，且锚点/对账路径跟着错）。
  if (n.type === 'doc') return 'doc';
  if (n.id.startsWith('brick_')) return 'brick';
  return 'symbol';
}

/**
 * ★★★ 把 **base 上的决策卡**同步进 overlay（2026-10-09，`docs/todo.md` T75）。
 *
 * ## 为什么必须要有这一步（实测的病灶）
 * `edit_dsl` → `updateFeature` 以前**只写 base**（`dsl_ops/update_feature.ts:389` 的 `saveDSL(dsl)`），
 * 而 `import_project` 会**重建 base**（它只"读旧 overlay 再 reconcile 回填"）。
 * ⇒ **旧 overlay 里本来就没有决策** ⇒ **人写的决策卡（含 `acceptance`/`expectations`）一重建就丢**。
 * ★ 这与 overlay 存在的**全部理由**直接矛盾 —— `infrastructure/storage_overlay.ts:4` 原文：
 *   「与 base 分离，**base 可再生成，overlay 独立保留**」。
 *
 * ## 为什么是**纯函数**、且**只搬决策相关字段**
 * · 纯函数：与 `seedOverlayFromDsl` 同族（可测、无 IO）；落盘由调用方做。
 * · **只搬 `decision` / `decision_history`** —— `attributes` / `annotations` / 全局件
 *   各有自己的既有通路（`seedOverlayFromDsl` 初始化时搬过），这里**顺手再搬一遍**才是判据分叉。
 *
 * ## 三条纪律
 * 1. ★ **只有一个"决策的家"**：overlay。base 上的 `decision` 是**应用结果**（`applyOverlay` 回填），
 *    不是独立副本 ⇒ 本函数**只从 base 往 overlay 搬**，不回写 base。
 * 2. ★★ **清除也要同步**：base 上决策被清掉（`decision: null`）时，overlay 里那份**必须一起清** ——
 *    否则 overlay 会拿着一份"已经不存在的决策"，下次重建又把它复活（**僵尸决策**）。
 * 3. ★ **不留空壳**：搬完/清完只剩 `path`/`kind` 的锚点要删掉，免得 overlay 越堆越虚。
 *    ★ 但**有 `signature` 的不能删** —— 那是 rename 认亲用的接口指纹（`reconcileOverlay` 的 `bySig`）。
 */
export function mergeDecisionsIntoOverlay(
  ov: DesignOverlay,
  dsl: DesignDSL,
): { overlay: DesignOverlay; written: number; cleared: number; notes: string[] } {
  type NodeLike = {
    id: string;
    type?: string;
    description?: string;
    decision?: NodeDecision;
    decision_history?: DecisionHistoryEntry[];
  };
  const anchors: Record<string, OverlayAnchor> = { ...ov.anchors };
  const notes: string[] = [];
  let written = 0;
  let cleared = 0;

  const nodes = (dsl.geometry?.nodes ?? []) as unknown as NodeLike[];
  const withDecision: NodeLike[] = [];

  // ① 先扫"清除"：base 上没有、而 overlay 里有的 ⇒ 一起清（纪律 2，防僵尸决策）
  for (const n of nodes) {
    if (n.decision || n.decision_history) {
      withDecision.push(n);
      continue;
    }
    const prev = anchors[n.id];
    if (prev && (prev.decision || prev.decision_history)) {
      const next = { ...prev };
      delete next.decision;
      delete next.decision_history;
      anchors[n.id] = next;
      cleared++;
    }
  }

  // ② 再搬"写入"
  for (const n of withDecision) {
    const prev = anchors[n.id];
    const next: OverlayAnchor = { ...(prev ?? { path: nodePath(n), kind: nodePathKind(n) }) };
    if (n.decision) next.decision = n.decision;
    else delete next.decision;
    if (n.decision_history) next.decision_history = n.decision_history;
    else delete next.decision_history;
    anchors[n.id] = next;
    written++;
  }

  // ③ 清空壳（纪律 3）
  let pruned = 0;
  for (const [id, a] of Object.entries(anchors)) {
    const hasPayload =
      a.decision || a.decision_history || a.attributes || a.signature || a.stale || a.orphaned || (a.annotations?.length ?? 0) > 0;
    if (!hasPayload) {
      delete anchors[id];
      pruned++;
    }
  }
  if (pruned) notes.push(`清掉 ${pruned} 个只剩路径、没有内容的空锚点`);
  if (cleared) notes.push(`**同步清除了 ${cleared} 个决策**（base 上已删，overlay 不许留僵尸决策）`);

  return { overlay: { ...ov, anchors }, written, cleared, notes };
}

/**
 * ★★★ 把 **base 上的功能标记**（`meta.function_tags`）同步进 overlay.global（2026-10-09，功能标记 MVP）。
 *
 * ## 为什么必须要有这一步（与 `mergeDecisionsIntoOverlay` 同款病灶）
 * 功能标记的写入口在 `edit_dsl`（`type:'tag'`），**只改 base**；而 `import_project` 会**重建 base**
 * （它"读旧 overlay 再 reconcile 回填"）⇒ **旧 overlay 里本来就没有标记** ⇒ **人写的标记一重建就丢**。
 * ★ 与 overlay 存在的全部理由直接矛盾（"base 可再生成，overlay 独立保留"）。
 * ⇒ 每次改完 base，**当场把标记同步过去**（`update_feature.ts` 收口处调用）。
 *
 * ## 纪律
 * 1. ★ **只有一个"标记的家"**：overlay。base 上的 `meta.function_tags` 是**应用结果**
 *    （`applyOverlay` 回填），不是独立副本 ⇒ 本函数**只从 base 往 overlay 搬**，不回写 base。
 * 2. ★★ **清除也要同步**：base 上标记被清空（`meta.function_tags` 缺失或空）时，overlay 里那份
 *    **必须一起清** —— 否则 overlay 会拿着"已经不存在的标记"，下次重建又把它复活（**僵尸标记**）。
 * 3. ★ **不造空壳**：base 无标记就不在 overlay 里留一个空对象（`undefined` 才是"没有"）。
 *
 * ★ 纯函数（与 `seedOverlayFromDsl` 同族：可测、无 IO）；落盘由调用方做。
 */
export function mergeTagsIntoOverlay(
  ov: DesignOverlay,
  dsl: DesignDSL,
): { overlay: DesignOverlay; tags: Record<string, string[]> | undefined; written: number; cleared: boolean } {
  const baseTags = (dsl as unknown as { meta?: { function_tags?: Record<string, string[]> } }).meta?.function_tags;
  const nextGlobal: OverlayGlobal = { ...(ov.global ?? {}) };
  const hasTags = !!baseTags && Object.keys(baseTags).length > 0;
  let written = 0;
  let cleared = false;
  if (hasTags) {
    nextGlobal.function_tags = baseTags;
    written = Object.keys(baseTags!).length;
  } else if (nextGlobal.function_tags !== undefined) {
    delete nextGlobal.function_tags;
    cleared = true;
  }
  const global = Object.keys(nextGlobal).length ? nextGlobal : undefined;
  return { overlay: { ...ov, global }, tags: nextGlobal.function_tags, written, cleared };
}

/** 对账统计的通用人类可读行（供报告 / 测试复用） */export function statsLine(stats: ReconcileStats): string {
  return `设计意图保留：保留 ${stats.retained} / 迁移 ${stats.migrated} / 孤儿 ${
    stats.orphaned
  }（真相已删，暂存待决）/ 过期 ${stats.stale}（签名变化，标需复核）`;
}