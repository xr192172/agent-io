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
import type { DiagramStatus, NodeDecision, DecisionHistoryEntry } from './geometry.js';
import type { Annotation } from './annotation.js';
import type { ThemeId, UserNode } from './types.js';
import type { ExpectedApi, Symbol, FileLifecycle } from './semantic.js';
// ★★★ 2026-10-17（task_home）：有 task 的节点，进度是**派生值**（`task.state ⇒ 三轴`）。
//   ★ 只取这一个纯函数（task_schema 对 overlay 只有 `import type` ⇒ 不成运行期环）。
import { progressOf } from './task_schema.js';

/**
 * ★★★ **锚点"有内容"的唯一判据**（T182，2026-10-11）。
 *
 * ## 为什么必须抽出来（★ 这是本仓头号病的一次现场拦截）
 * 该判据用于"**清空壳**"（prune 掉只剩 `path`/`kind`、没有任何意图的锚点）。
 * 它原本**内联在 `mergeDecisionsIntoOverlay` 里** —— ★ 我在 T182 又写了一份几乎一样的
 * ⇒ ★ **同一判据住两处**。而**后果不是风格问题**：两份清单一旦漂移，就会出现
 *   **"A 函数认为这个锚点是空的、于是删掉它"** 而 B 函数刚往里放了东西
 *   ⇒ ★ **静默丢字段**（`lifecycle` 差点就这么被决策同步 prune 掉）。
 * ⇒ ⇒ 判据只许住一处：**加任何新意图字段时，只改这一个函数**。
 */
export function hasAnchorPayload(a: OverlayAnchor): boolean {
  return !!(
    a.decision ||
    a.decision_history ||
    a.attributes ||
    a.lifecycle ||
    a.progress ||
    a.progress_evidence ||
    a.signature ||
    a.stale ||
    a.orphaned ||
    (a.annotations?.length ?? 0) > 0
  );
}

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

/**
 * ★★★ **置 `progress='done'` 时必须附的证据**（T328，2026-10-15）—— 「不许默默勾上」的机制化。
 *
 * ## 为什么必须有它（本仓已证过的一类腐坏）
 * md todo 侧的历史读数：**26 勾 vs 77 未勾**，而"勾了"≠"做了" —— 说明
 * **一个能被随手写上去的 `done` 没有任何判断力**。⇒ 所以 `done` 不许是"默认可写枚举"，
 * 必须**带一条能被复核的证据**（`docs/replan-2026-10-15.md` §9.3 / §10.3 定死**只许三档**）。
 *
 * ## 三档（`kind` 判别；★ 不许第四种，也**不许降级为"默认下沉"**）
 * · `expectations` —— **机器判**：该锚点/决策卡的 `expectations` 全绿。
 *   ★ 形状里钉死 `all_green: true` 与 `unsupported: 0`：`unsupported` 不为 0 就是"判不了"，
 *   而"判不了"**不是**"通过"（本仓头号病：把"没判"读成"通过"）。
 * · `reading` —— **半自动**：附一条**可复跑的读数**（跑什么命令、看到什么、什么时候）。
 * · `attestation` —— **诚实兜底**：**显式人工确认**（谁说的 `by` + 什么时候 `at` + 为什么算完成 `why`）。
 *
 * ## 它住哪
 * 与 `progress` 同层、挂在**锚点**上（`OverlayAnchor.progress_evidence`），落盘进
 * `<feature>.overlay.json` ⇒ 与进度**同生共死**：`rebuild_design=true` 重建时一起保留。
 * ★ 不落 base：它跟的是"人/工具的那句判断"，而 base 可再生成（与 `progress` 同理）。
 */
export type ProgressEvidence =
  /** ① 机器判：expectations 全绿且 unsupported==0 */
  | { kind: 'expectations'; all_green: true; unsupported: 0; ref?: string }
  /** ② 半自动：一条可复跑的读数 */
  | { kind: 'reading'; command: string; observed: string; at: string }
  /**
   * ③ 诚实兜底：显式人工确认（署名 + 时间 + 为什么）
   * ★★★ T333（2026-10-15）：`source_node_id` = **来源节点 id，由唯一写端 `updateStatus` 在落盘前自动填**
   *   （填成它正在写的那条锚点键 `ov.anchors[node_id]`）⇒ ★ **调用方不必传、传了也被覆盖（零改动）**。
   *   理由：一条没署名的口供说不清它在给**谁**作证（与 T118「事实要能追溯到来源」同族）；带上节点 id 后，
   *   "节点改名/重挂"时旧口供与节点对不上 ⇒ **自然失效**（不再冒充新节点的完成）。
   */
  | { kind: 'attestation'; by: 'human' | 'llm'; at: string; why: string; source_node_id?: string };

/**
 * ★★★ **"不许默默勾上"的校验器**（T328）—— 判据只住这一处。
 *
 * 规则逐字：`progress === 'done'` 且**没有** `evidence` ⇒ **拒绝**（`ok:false` + 说清理由）。
 * ★ **不静默、不自动补**：本函数**不**替调用方造一条证据，也**不**把 `done` 悄悄降级成
 * `in_progress` —— 拒绝就是拒绝（§2.3「不报错的错」的反面）。
 * ★ `progress !== 'done'` ⇒ 放行（`draft` / `in_progress` 不需要证据）；但**若附了 evidence**，
 * 仍校验其形状 —— 否则会存进一条"看着像证据其实残缺"的记录（同族：宁可拒也不存半条）。
 */
export function validateProgressEvidence(
  progress: DiagramStatus | undefined,
  evidence: ProgressEvidence | undefined,
): { ok: true } | { ok: false; reason: string } {
  const bad = (why: string): { ok: false; reason: string } => ({
    ok: false,
    reason:
      `拒绝：progress='done' 必须带一条 evidence（三档之一），${why}。` +
      `\n  ★ 为什么（不是形式主义）：一个能被随手写上去的 done 是"没有判断力"的（md todo 侧 26 勾 vs 77 未勾，` +
      `"勾了"≠"做了"）。\n  ★ 三档（只许这三档）：` +
      `\n    ① { kind:'expectations', all_green:true, unsupported:0 }  —— 机器判（expectations 全绿）` +
      `\n    ② { kind:'reading', command, observed, at }                —— 一条可复跑的读数` +
      `\n    ③ { kind:'attestation', by:'human'|'llm', at, why }        —— 显式人工确认（署名）` +
      `\n      ★ 建议（不强制，但请当真）：**不要自己验收自己** —— 发布任务后派**子代理**去完成，**自己来验收**；` +
      `\n        验收时要附**你自己跑过的读数**（命令 + 输出），**不要只读对方的总结**（对方报的常与实况不符）。` +
      `\n  ★ 本校验器**不会**替你自动补一条，也不会把 done 降级成 in_progress。`,
  });

  if (progress !== 'done') {
    if (evidence === undefined) return { ok: true };
    return validateEvidenceShape(evidence);
  }
  if (evidence === undefined) {
    return bad('而这次一个 evidence 都没给');
  }
  return validateEvidenceShape(evidence);
}

/** evidence 的**形状**校验（三档各自必填字段；★ 与 `validateProgressEvidence` 同属一条判据链） */
function validateEvidenceShape(evidence: ProgressEvidence): { ok: true } | { ok: false; reason: string } {
  const no = (why: string): { ok: false; reason: string } => ({ ok: false, reason: `拒绝：evidence 形状不完整 —— ${why}` });
  const e = evidence as Partial<Record<string, unknown>> & { kind?: unknown };
  switch (e.kind) {
    case 'expectations':
      if (e.all_green !== true) return no(`kind='expectations' 要求 all_green:true（实得 ${JSON.stringify(e.all_green)}）`);
      if (e.unsupported !== 0) {
        return no(
          `kind='expectations' 要求 unsupported:0（实得 ${JSON.stringify(e.unsupported)}）` +
            ` —— unsupported>0 = "还有些没判"，而"没判"不是"通过"`,
        );
      }
      return { ok: true };
    case 'reading':
      if (!nonEmpty(e.command)) return no(`kind='reading' 要求 command 非空（跑什么）`);
      if (!nonEmpty(e.observed)) return no(`kind='reading' 要求 observed 非空（看到什么）`);
      if (!nonEmpty(e.at)) return no(`kind='reading' 要求 at 非空（什么时候跑的）`);
      return { ok: true };
    case 'attestation':
      if (e.by !== 'human' && e.by !== 'llm') return no(`kind='attestation' 要求 by:'human'|'llm'（实得 ${JSON.stringify(e.by)}）`);
      if (!nonEmpty(e.at)) return no(`kind='attestation' 要求 at 非空`);
      if (!nonEmpty(e.why)) return no(`kind='attestation' 要求 why 非空（为什么算完成）`);
      return { ok: true };
    default:
      return no(`kind 必须是 'expectations' | 'reading' | 'attestation' 之一（实得 ${JSON.stringify(e.kind)}）`);
  }
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * ★★★ **读端**：这条 `attestation` 是否**仍适用于**当前节点（T343，缺口②）。
 *
 * ## 为什么必须有它（本仓已证过的一类"只在注释里的承诺"）
 * `attestation.source_node_id` 由**唯一写端** `updateStatus` 在落盘前自动填（`status_tools.ts:73`），
 * 注释里承诺"**节点改名/重挂 ⇒ 旧口供自然失效**"（`overlay.ts` 上面 `ProgressEvidence` 那段）。
 * ★ 但全仓 grep 过：**`source_node_id` 只写不读** —— 那句承诺**没有任何代码**。
 * ⇒ 本条把"比对"补上：口供绑的节点 ≠ 当前节点 ⇒ **不适用** ⇒ 不许再冒充"该节点已完成"。
 *
 * ## 判据为什么是"比 id"（★ 先核清 `node.id` 是**路径派生**的）
 * `node.id` 不是稳定 uid，而是**从路径现算**的：`file_` 节点的 id =
 * `file_${sanitize(rel)}`（`infrastructure/graph/import_project.ts:890`，`sanitize` 把非字母数字换成 `_`）。
 * ★ 实据就在本仓的决策卡上：`src/application/design/derive/opl.ts` 的节点 id 是
 * `file_src_application_design_derive_opl_ts`（= `file_` + `src/application/design/derive/opl.ts` 去符号）。
 * ⇒ **改名 = 换 id** ⇒ `source_node_id`（旧 id）与新节点 id **对不上** ⇒ 本条判"不适用" ✓。
 * （若将来 `node.id` 换成不随改名变的稳定 uid ⇒ 本判据要换成比对 `path`，见 `OverlayAnchor.path`。）
 *
 * ## 缺 `source_node_id` ⇒ `false`（保守）
 * 一条**没有出处**的口供"说不清它在给谁作证"（与 T118「事实要能追溯到来源」同族）⇒ 不许拿它
 * 声称**这个**节点已完成。这与本仓「没判 ≠ 通过」同一条尺：宁可判"不适用"，不判"有效"。
 *
 * ★ 纯函数（不读盘、不改盘）：只做"这条口供 vs 这个节点 id"的判据。
 */
export function attestationAppliesTo(
  att: Extract<ProgressEvidence, { kind: 'attestation' }>,
  currentNodeId: string,
): boolean {
  const bound = att.source_node_id;
  // 无出处 ⇒ 说不清给谁作证 ⇒ 不适用（不是"有效"）
  if (!nonEmpty(bound)) return false;
  return bound === currentNodeId;
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
  /**
   * ★★★ **文件生命周期（T182，2026-10-11）** —— `deprecated`（待删标记）/ `merged` / `archived`。
   *
   * ★ **为什么它必须住 overlay**（规矩 T100/T75 早已立过，本条只是**跟上来**）：
   *   overlay 存在的全部理由是"**base 可再生成、设计意图独立保留**"。
   *   而 `lifecycle` 是**人写的意图**（"这个文件该删了，理由是…"），**扫描产不出**。
   *   ⇒ 此前它**只写在 base** ⇒ ★ `rebuild_design=true` 重建一次**就静默丢掉**
   *     —— ★ 而同一段重建代码**已有**一道 `allow_design_drop` 闸，却只覆盖
   *     "**扫描产不出的节点**"（`file_`/`dir_`/`doc_` 之外的前缀）
   *     ⇒ ★ **"人写的待删标记"恰好标在【扫描产出】的文件节点上** ⇒ **不报、不拦**（§2.3「不报错的错」）。
   *
   * ★ 落点选择：**挂在锚点上**（与 `decision`/`attributes` 同层），因为锚点**已按 `n.id` 对齐**，
   *   而文件节点在 `semantic.files` 与 `geometry.nodes` 里**共用同一个 id**
   *   （`archive_node.ts` 就是靠这个找文件级决策卡的）⇒ 不需要新造索引。
   */
  lifecycle?: FileLifecycle;
  /**
   * ★★★ **实现进度（进度轴收归，2026-10-15）** —— `draft | in_progress | done`（复用 `DiagramStatus`）。
   *
   * ## ★★ 为什么不叫 `status`（两个问句，必须两个名字）—— 核过的实情
   * 本仓**已有的** `status?: 'open' | 'resolved'`（`/** 意图存活状态 *​/`，`overlay.ts:154`）
   * 挂在 **`OverlayEdgeIntent`** 上（**不在 `OverlayAnchor` 上** —— 逐字核过：本接口 60-96 行内无 `status`）；`OverlayGoal.status` 另是一套（`active|done|parked|dropped`）。
   * 它问的是 「**这条意图还需不需要处理**」（存活），本条问的是 「**这个实现做完了没有**」（进度）。
   * ⇒ ★ **同一字段名 = 一个名字两个问句 = 本仓正在治的那个病** ⇒ 进度**必须另起一名**：`progress`。
   *
   * ## 为什么住 overlay（T100/T75 立过、T182 跟上的同一条规矩）
   * 人登记的进度（"我把它做到一半了"）**扫描产不出**、**base 可再生成** ⇒ 只写 base 的话
   * `import_project` 的 `rebuild_design=true` **一重建就丢**。⇒ 与 `lifecycle` 同款：权威住 overlay，
   * `applyOverlay` 把它投影回 base（`geometry.nodes[].status` / `semantic.files[].status`），
   * `seedOverlayFromDsl` 首次迁移时把 base 上已有的进度搬进来。
   */
  progress?: DiagramStatus;
  /**
   * ★★★ **置 `progress='done'` 的证据**（T328，2026-10-15）—— 形状与校验器见上方的
   * `ProgressEvidence` / `validateProgressEvidence`。★ 与 `progress` **同层同生共死**：
   * 一起落 `<feature>.overlay.json`、一起被 `seedOverlayFromDsl` 収下、一起在重建后保留。
   * ★ `progress` 不是 `'done'` 时它一般缺席（`draft`/`in_progress` 不需要证据）。
   */
  progress_evidence?: ProgressEvidence;
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
  /**
   * ★★★ **任务前置（显式声明，T332）** —— 引**节点 id**，语义 = 这些节点须先 `progress === 'done'`，
   * 本边的**源节点 `from` 的源码**才允许被 `write_gate` 落盘（"完成 A 才准开始 B"）。
   *
   * ## ★★ 为什么必须是**显式**字段（本条的成败在此）
   * 本仓的 edge 默认装的是 **import 依赖**（`Edge.intent` / 扫描产出的依赖边）—— ★ 它**不等于任务前置**。
   * ⇒ 若"凡是 edge 就当前置 / 有 import 边就拦"，会把**全仓的 import 依赖误当解锁条件**（replan-log §28.3：最贵的一步）。
   * ⇒ 所以：**只有显式标了 `requires` 的 edge 才产生拦截**；**没标 `requires`（undefined/空数组）一律不拦**。
   *
   * ## 住在 overlay（= 不可再生、权威）
   * 与 `reason`/`boundary` 同族，由 `design_intent` 写、`reconcileOverlay` 随边对账保留、`applyOverlay` 投影回 base。
   */
  requires?: string[];
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

/**
 * 从节点推导稳定路径（file 用 description=rel；dir/brick 解码 id 前缀）。base 与 seed 共用，保证两次对齐一致
 *
 * ★★★ 2026-10-17（`docs/gate-principle.md` §三 · 造节点入口）：**`path` 优先，回落 `description`** ——
 *   与 `application/write_gate.ts#nodeFilePath`（T352）**同一把尺**，不再各定一套。
 *   为什么必须加这一级：`path` 此前不是 `Node` 的字段（只能写 `description`）⇒ 造出的
 *   `path` 型节点在锚点上会**退回 `id`** 当路径（`nodePath` 的 `else` 分支）⇒
 *   设计单/写闸按路径认亲时对不上（一事实两口径）。★ 实测真仓无"两者都给且不同"的节点（both=0）。
 */
export function nodePath(n: { id: string; type?: string; description?: string; path?: string }): string {
  const explicit = typeof n.path === 'string' ? n.path.trim() : '';
  if (explicit) return explicit.split('\\').join('/');
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

  /** ★ node_id → task（文件节点与几何节点**共用 id**，下面 semantic 层也要用同一把尺） */
  const taskById = new Map<string, NonNullable<(typeof base.geometry.nodes)[number]['task']>>();
  for (const n of base.geometry?.nodes ?? []) if (n.task) taskById.set(n.id, n.task);

  const nodes = (base.geometry?.nodes ?? []).map((n) => {
    const a = overlay.anchors[n.id];
    const merged = a
      ? ({
          ...n,
          // ★★★ 2026-10-19（用户裁定"设计只住一处"）：**不再投 decision / decision_history**。
          //   它们只住 `design/<f>.dsl.json`（DESIGN.md:300 的"唯一权威"）。
          //   此处原先回填 ⇒ 造成"同一份 decision 在 design/ 和 overlay 各一份"（37×2，实测一致但因镜像而会漂移）。
          ...(a.attributes ? { attributes: a.attributes } : {}),
        } as typeof n)
      : { ...n };
    // ★★★ 2026-10-17（task_home · 两轴消歧）：**有 task ⇒ 进度是派生值**（`progressOf(task)`），
    //   `overlay.progress` 对这类节点**不再有话语权**（它是交接期的影子副本，第 ④ 步退役）。
    //   ★ `void`/`superseded` ⇒ 派生值 = `undefined` ⇒ **如实无值**（不回落 overlay，也不硬塞 `draft`）。
    if (n.task) {
      const derived = progressOf(n.task);
      if (derived) merged.status = derived;
      else delete merged.status;
      return merged;
    }
    // ★★ 进度轴（2026-10-15）：overlay.progress → `Node.status`（与 tag/决策卡同款"重建时投影回来"）。
    //   ★ overlay 没写 progress 就**原样保留 base**（不抹成 undefined）—— 让扫描侧的值当"读侧默认"。
    return a?.progress ? { ...merged, status: a.progress } : merged;
  });
  out.geometry = { ...base.geometry!, nodes };

  // ★★★ T182：`lifecycle` 挂在 **`semantic.files`** 上，而上面那一遍**只走 `geometry.nodes`**
  //   ⇒ ★ **必须另走一遍 semantic 层**：这是本条唯一**新增**的机制，其余四处（merge/seed/sync/anchor）
  //     都是照抄 T75/T100 已验证的模板。
  //   ★ 为什么用 `f.id` 去查锚点：文件节点在 `semantic.files` 与 `geometry.nodes` 里**共用同一个 id**
  //     （`archive_node.ts` 正是靠这个找文件级决策卡的）⇒ 锚点表两边通用，不必新造索引。
  //   ★ 只覆盖"overlay 里有"的那些：overlay 没写 `lifecycle` 就**原样保留 base**（不抹成 undefined）。
  if (base.semantic) {
    const files = base.semantic.files.map((f) => {
      const a = overlay.anchors[f.id];
      const t = taskById.get(f.id);
      if (!a && !t) return f;
      const merged = {
        ...f,
        ...(a?.lifecycle ? { lifecycle: a.lifecycle } : {}),
      } as (typeof base.semantic.files)[number];
      // ★★★ 2026-10-17（task_home）：文件节点的进度同样**从 task 派生**（几何层与语义层同一把尺）；
      //   没有 task 才走 overlay.progress 投影（与上面 Node.status 同款）。
      if (t) {
        const derived = progressOf(t);
        if (derived) merged.status = derived;
        else delete merged.status;
      } else if (a?.progress) {
        merged.status = a.progress;
      }
      return merged;
    });
    out.semantic = { ...base.semantic, files };
  }

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

  // ★★ T182：文件级 `lifecycle` 的锚点 id = `semantic.files[].id`（与同名几何节点同 id）
  //   ⇒ 先建索引，铺完几何节点后**合并进同一锚点**（不能直接覆盖：决策卡也挂同一个 id）。
  const lifecycleById = new Map<string, FileLifecycle>();
  for (const f of dsl?.semantic?.files ?? []) {
    if (f.lifecycle) lifecycleById.set(f.id, f.lifecycle);
  }

  // ★★ 进度轴（2026-10-15）：实现进度的锚点 id 同样是 `n.id` / `f.id`（几何节点与语义文件**共用 id**）。
  //   来源：几何节点 `status` 优先，其次语义文件 `status`（兜底"只有 semantic、几何层没有"的节点）。
  //   ★★ 它必须并进下面的**跳过条件**：否则"只有进度、没有决策/参数/标注/lifecycle"的节点
  //     会被 `continue` 跳过 ⇒ **首次迁移就漏掉它**
  //     （与 T182 在 `lifecycle` 上踩过的坑**完全同形**：该处注释逐字 "判据加了 lc…否则首次迁移就漏掉它"）。
  const progressById = new Map<string, DiagramStatus>();
  // ★★★ 2026-10-17（task_home）：**有 task 的节点不播种进度** —— 它的进度是 `task.state` 的派生值，
  //   ★ 把派生值写进 overlay 就是把"读时现算"偷偷变成"落盘"（第 ④ 步退役前的自伤）。
  const taskIds = new Set((dsl?.geometry?.nodes ?? []).filter((n) => n.task).map((n) => n.id));
  for (const n of dsl?.geometry?.nodes ?? []) {
    if (n.task) continue;
    if (n.status) progressById.set(n.id, n.status);
  }
  for (const f of dsl?.semantic?.files ?? []) {
    if (taskIds.has(f.id)) continue;
    if (f.status && !progressById.has(f.id)) progressById.set(f.id, f.status);
  }

  for (const n of dsl?.geometry?.nodes ?? []) {
    const anns = annIndex.get(n.id);
    const lc = lifecycleById.get(n.id);
    const pg = progressById.get(n.id);
    // ★ 判据加了 `lc`（T182）与 `pg`（进度轴）：否则"只有 lifecycle / 只有进度、没有决策"的文件
    //   会被 `continue` 跳过 ⇒ 首次迁移就漏掉它。
    if (!n.decision && !n.decision_history && !n.attributes && !anns?.length && !lc && !pg) continue;
    const a: OverlayAnchor = { path: nodePath(n), kind: nodePathKind(n) };
    // ★★★ 2026-10-19（用户裁定「设计只住一处」）：**不再 seed decision**。
    //   decision / decision_history 只住 design/<f>.dsl.json（DESIGN.md:300 的「唯一权威」）；
    //   applyOverlay 也不再回填。overlay 从此只持有【运行时】：status / progress / evidence / attributes。
    //   ★ 需要「决策历史」去 git（design/ 进 git，overlay 不进）。
    if (n.attributes) a.attributes = n.attributes;
    if (anns?.length) a.annotations = anns;
    if (lc) a.lifecycle = lc;
    if (pg) a.progress = pg;
    anchors[n.id] = a as OverlayAnchor;
  }

  // ★ 兜底：`semantic.files` 里有、而几何层没有同名节点的（不该发生，但**不静默丢**）。
  for (const f of dsl?.semantic?.files ?? []) {
    const pg = progressById.get(f.id);
    if (anchors[f.id] || (!f.lifecycle && !pg)) continue;
    anchors[f.id] = {
      path: f.path,
      kind: 'file',
      ...(f.lifecycle ? { lifecycle: f.lifecycle } : {}),
      ...(pg ? { progress: pg } : {}),
    } as OverlayAnchor;
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

  // ③ 清空壳（纪律 3）—— ★ 判据住一处：`hasAnchorPayload`（见其注释：两份清单漂移会静默丢字段）
  let pruned = 0;
  for (const [id, a] of Object.entries(anchors)) {
    if (!hasAnchorPayload(a)) {
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

/**
 * ★★★ 把 **base 上的文件生命周期**（`semantic.files[].lifecycle`）同步进 overlay 锚点
 * （T182，2026-10-11）。
 *
 * ## 为什么必须要有这一步（与 `mergeDecisionsIntoOverlay` / `mergeTagsIntoOverlay` 同款病灶）
 * 「设计侧先标记待删」的写入口在 `edit_dsl`（`type=file op=update` 的 `data.lifecycle`），**只改 base**；
 * 而 `import_project` 的**显式重建**（`rebuild_design=true`）会**整个替换 base**
 * （`:1066` 逐字："真相刷新只替换 base"）⇒ ★ **人写的 `deprecated` 标记一重建就丢**。
 * ⇒ 这正是 T100 立过的规矩：*"标记必须住 `overlay`（意图），不住 base"*。
 *
 * ## 纪律（照抄 `mergeDecisionsIntoOverlay`）
 * 1. ★ **只从 base 往 overlay 搬**，不回写 base（base 上那份是 `applyOverlay` 的应用结果）。
 * 2. ★★ **清除也要同步**：base 上某文件的 `lifecycle` 没了 ⇒ overlay 里那份**必须一起清**
 *    —— 否则下次重建又把它复活（**僵尸标记**）。
 *    ★ 为什么这条路是安全的（不是"静默抹掉"）：`import_project` 走的是
 *    `mergeDesignLayer → applyOverlay`，**会把 overlay 的 `lifecycle` 回填进 base 再落盘**
 *    ⇒ ★ 于是"编辑收口时 base 上没有 `lifecycle`"只可能是**真的没有**（从未设过 / 文件已不在），
 *      而不是"刚被重建冲掉"。
 * 3. ★ **不造空壳**：没有 payload 的锚点 prune 掉（否则 overlay 会越长越胖）。
 * 4. ★★ **清了多少要报**（`notes`）—— 清除是**破坏性**的，不许无声无息。
 *
 * ## ★★ 一条【诚实的边界】—— 请拍板（`docs/todo.md` T182b），本条**刻意不替你选**
 * **场景**：那个被标 `deprecated` 的文件**真的从代码里删掉了**。
 * ⇒ 重建时 `reconcileOverlay` **不会静默丢**它（`:274` 把锚点留成 `orphaned: true`）；
 * 但**下一次 `edit_dsl`** 一跑本函数，`liveIds` 里已没有该文件 ⇒ **标记被清掉**。
 * ★ 两种读法都说得通，而**含义完全不同**：
 *   · **(甲) 清掉是对的** —— 文件没了 ⇒ 三步流的**步骤②已被证明**，该走**步骤③归档**了，
 *     留着 base 侧的标记反而是"该删清单里的一条死链"；
 *   · **(乙) 清掉是错的** —— 用户**还没看到**对拍的结论、**还没**决定归档
 *     ⇒ 标记在他的工作台上**凭空消失**（★ 又是 §2.3「不报错的错」）。
 * ★ 我**不选**（这是你的流程语义，不是工程细节）：T182b 里要定的是
 *   「**文件没了，标记该留成 `orphaned` 墓碑（等人处置），还是该清掉**」。
 * ★ 无论选哪个，**必须先做到"不静默"**：今天 `cleared` 只进 `notes`，而 `updateFeature`
 *   **丢掉了所有 sync 的返回值** ⇒ ★ 这个"清掉了 N 个标记"**没有任何人看得到**。
 *
 * ★ 纯函数（可测、无 IO）；落盘由 `storage_overlay.ts` 的 `syncLifecycleToOverlay` 做。
 */
export function mergeLifecycleIntoOverlay(
  ov: DesignOverlay,
  dsl: DesignDSL,
): { overlay: DesignOverlay; written: number; cleared: number; notes: string[] } {
  const anchors: Record<string, OverlayAnchor> = { ...ov.anchors };
  const notes: string[] = [];
  let written = 0;
  let cleared = 0;

  const files = dsl.semantic?.files ?? [];
  const liveIds = new Set(files.map((f) => f.id));

  // ① 先扫"清除"（纪律 2，防僵尸标记）—— ★★★ **但只清"文件还在 base 里"的那些**。
  //   ★★★ 为什么"文件已不在 base"时**绝不清**（T182b，2026-10-12 —— 本仓最贵的一课：
  //     **"清干净"在这里恰好会毁掉流程自己的信号**）：
  //     三步流的②（`consistency_check`，T184）判据逐字是
  //     「`deprecated` + **实现里也没了** ⇒ ★ **可以走③归档**」
  //     ⇒ ★ 而"实现里没了"在 DSL 里的样子**就是**"文件不在 base 了"
  //     ⇒ ★ 若这里把它当僵尸清掉，**②刚给出的"可归档"信号会在下一次 `edit_dsl` 时被抹掉**
  //       —— 用户**永远看不到**那句"可以走③归档"（步骤③因此永远不会被触发）。
  //   ★ 所以"文件不在 base"的处置权**归 `reconcileOverlay`**（它把锚点留成 `orphaned: true`，
  //     逐字写着"真相已删除该锚点 → 设计**暂存待决**，不静默丢"）—— ★ **一处判据，各管各的**。
  //   ★ 剩下能清的只有一种：**文件还在 base 里、但它的 `lifecycle` 没了**
  //     （正常路径上几乎不会发生 —— `applyOverlay` 会把 overlay 那份回填进 base；
  //       所以本条是给"带外改过 JSON"留的守卫，不是主路）。
  for (const [id, a] of Object.entries(anchors)) {
    if (!a.lifecycle) continue;
    // ★★ 文件已不在 base ⇒ **墓碑**，归 reconcile 管，本函数**不碰**（见上）。
    if (!liveIds.has(id)) continue;
    if (files.find((f) => f.id === id)?.lifecycle) continue;
    const next = { ...a };
    delete next.lifecycle;
    anchors[id] = next;
    cleared++;
  }
  const tombstoned = Object.entries(anchors).filter(([id, a]) => a.lifecycle && !liveIds.has(id)).length;
  if (tombstoned) {
    notes.push(
      `★ 有 ${tombstoned} 个待删标记指向**已不在 base 的文件** ⇒ 按纪律**保留为墓碑**（不清）` +
        `：它们是三步流②的"可归档"信号，清掉就没人能触发③了`,
    );
  }

  // ② 再搬"写入"
  for (const f of files) {
    if (!f.lifecycle) continue;
    const prev = anchors[f.id];
    const next: OverlayAnchor = { ...(prev ?? { path: f.path, kind: 'file' }) };
    next.lifecycle = f.lifecycle;
    anchors[f.id] = next;
    written++;
  }

  // ③ 清空壳（纪律 3）—— ★ 与 `mergeDecisionsIntoOverlay` **共用** `hasAnchorPayload`：
  //   此前我在这里抄了第二份清单 ⇒ ★ **决策同步会先把"只有 lifecycle 的锚点"当空壳删掉**
  //   （写完 lifecycle 又被 prune，字段静默消失）。★ 判据一处，两边同时正确。
  let pruned = 0;
  for (const [id, a] of Object.entries(anchors)) {
    if (!hasAnchorPayload(a)) {
      delete anchors[id];
      pruned++;
    }
  }
  if (pruned) notes.push(`清掉 ${pruned} 个只剩路径、没有内容的空锚点`);
  if (cleared) {
    notes.push(`**同步清除了 ${cleared} 个生命周期标记**（base 上已无 ⇒ overlay 不许留僵尸标记）`);
  }

  return { overlay: { ...ov, anchors }, written, cleared, notes };
}

/** 对账统计的通用人类可读行（供报告 / 测试复用） */export function statsLine(stats: ReconcileStats): string {
  return `设计意图保留：保留 ${stats.retained} / 迁移 ${stats.migrated} / 孤儿 ${
    stats.orphaned
  }（真相已删，暂存待决）/ 过期 ${stats.stale}（签名变化，标需复核）`;
}