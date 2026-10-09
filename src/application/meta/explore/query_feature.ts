/**
 * query_feature 工具：统一读操作入口
 *
 * 合并原 9 个查询工具（get_dsl / list_features / list_annotations / list_approvals /
 * DSL 快照列举 / list_templates / get_simulation_state / get_approval_history / diff_features），
 * 通过 { query, ...params } 单点调用，减少 LLM 工具选择成本。
 *
 * 细粒度查询（DSL 替代 read/grep/search）：
 *   节点/边/文件级结构化查询，LLM 按需获取 DSL 局部信息，无需全量读取。
 *   - nodes：列出所有节点摘要（id/label/type/layer/status）
 *   - edges：列出所有边摘要（id/from/to/label/type）
 *   - node：获取单个节点详情（需 node_id）
 *   - files：列出所有语义文件摘要（id/path/responsibility/status/lines）
 *   - file：获取单个文件详情（需 file_id，含 expected_apis/actual_apis/deps/symbols）
 *   - digest：每文件一行紧凑认知索引（F:职责 | R:关系 | A:契约 | S:高熵决策）——
 *             语义层的**只读派生视图**，上下文紧张时一遍读完；不落盘、不新增真相源
 *   - calls：查询文件的调用关系（需 file_id + project_dir，显示入/出调用）
 *
 * query 类型与参数映射：
 *   dsl              → get_dsl          { feature }
 *   features         → list_features    {}
 *   nodes            → list_nodes       { feature, layer?, type? }
 *   edges            → list_edges       { feature, layer? }
 *   node             → get_node         { feature, node_id }
 *   files            → list_files       { feature, layer?, status? }
 *   file             → get_file         { feature, file_id }
 *   digest           → 一行式认知索引   { feature }（语义层派生视图，只读）
 *   calls            → get_calls        { feature, file_id, project_dir }
 *   annotations      → list_annotations { feature, node_id?, severity?, unresolved_only? }
 *   approvals        → list_approvals   { feature, status?, assignee? }
 *   approval_history → get_approval_history { feature, annotation_id }
 *   snapshots        → listSnapshots(feature) { feature }
 *   templates        → list_templates   {}
 *   simulation_state → get_simulation_state { feature }
 *   diff             → diff_features    { feature_a, feature_b }
 *   tag              → 功能标记（人给文件节点的"隶属某功能"标签）{ feature, tag? } —— 给 tag=成员+失联；省略=列全部标签
 */

import { getDSLByView, listFeatures as listStoredFeatures } from '../../../infrastructure/storage.js';
// ★ T89：**意图的家是 overlay**（T75/T77 立）—— 与视图无关 ⇒ 实际视图也能"贴"上设计意图
// ★ T90：**「最后实现过的决策」** 来源 = 重写前那份快照的 `intents`（不再是 overlay 最新）
import { listFileSnapshots } from '../../refactor/snapshot/file_snapshot.js';
import type { DSLView } from '../../../infrastructure/storage.js';
import { listAnnotations } from '../../design/dsl_ops/annotation_tools.js';
import { listApprovals, getApprovalHistory } from '../../observe/reconcile/approval.js';
import { listSnapshots } from '../../design/lifecycle/snapshot.js';
import { listTemplates } from '../../design/lifecycle/templates.js';
import { getSimulationState } from '../../design/lifecycle/simulation.js';
import { diffFeatures } from '../../../infrastructure/analysis/impact/diff.js';
import type { Node, Edge } from '../../../domain/geometry.js';
import type { SemanticFile } from '../../../domain/semantic.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import type { Database } from '../../../infrastructure/index/db.js';
import { buildFunctionOutline } from '../../../infrastructure/index/function_outline.js';
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
// ★★ scope（圈定范围）的**文法与解析只在那一处** —— 本文件只调它、并渲染（T72）
import { resolveScopeText, formatScope } from '../../../domain/scope.js';
import type { OverlayGoal } from '../../../domain/overlay.js';
import type { BrickContract } from '../../../domain/contract.js';

export interface QueryFeatureInput {
  /** 查询类型 */
  query:
    | 'dsl'
    | 'features'
    | 'nodes'
    | 'edges'
    | 'node'
    | 'decisions'
    | 'files'
    | 'file'
    | 'digest'
    | 'scope'
    | 'calls'
    | 'functions'
    | 'annotations'
    | 'approvals'
    | 'approval_history'
    | 'snapshots'
    | 'templates'
    | 'simulation_state'
    | 'diff'
    | 'goals'
    | 'edge_intents'
    | 'tag';
  /** feature 名（dsl/nodes/edges/node/decisions/files/file/digest/annotations/approvals/approval_history/snapshots/simulation_state 必填；features/templates 忽略；diff 用 feature_a/feature_b） */
  feature?: string;
  /** node：节点 ID */
  node_id?: string;
  /**
   * ★★ scope：**圈定范围**的一行表达式（2026-10-09，T72）。
   * 文法与解析**唯一落点**在 `src/domain/scope.ts`（这里只转手，**不重写一份语法**）：
   * `all` · `layer:main` · `swimlane:<id>` · `arch_layer:<id>` · `subtree:<node_id>[!]` · `nodes:a,b` · `files:p1,p2`
   */
  scope?: string;
  /** decisions：按功能线过滤（不传=全部，按 thread 分组输出） */
  thread?: string;
  /** decisions：按状态过滤（active/superseded/draft；不传=全部） */
  decision_status?: 'active' | 'superseded' | 'draft';
  /** file：文件 ID（对应 SemanticFile.id = geometry Node.id） */
  file_id?: string;
  /** nodes：按职责分层过滤（main/error/detail） */
  layer?: 'main' | 'error' | 'detail';
  /** nodes：按节点类型过滤（如 service/module/database/api/queue/ui） */
  type?: string;
  /** files：按架构层过滤（如 api/service/data/ui） */
  file_layer?: string;
  /** files：按实现状态过滤 */
  file_status?: 'draft' | 'in_progress' | 'done';
  /** annotations：按节点 ID 过滤 */
  annotation_node_id?: string;
  /** annotations：按严重程度过滤 */
  severity?: 'info' | 'warning' | 'critical';
  /** annotations：只显示未解决的 */
  unresolved_only?: boolean;
  /** approvals：按状态过滤 */
  status?: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'needs_revision';
  /** approvals：按指派人过滤 */
  assignee?: string;
  /** approval_history：标注 ID */
  annotation_id?: string;
  /**
   * ★ tag：**功能标记名**（2026-10-09，人机共创 MVP）。
   * 给则返回该 tag 的**成员文件**与**失联成员**；省略则列出本 feature 现有全部 tag（连同成员数）。
   * ★ 与决策卡上的 `decision.tags`（决策标签）**不是一件事** —— 那是卡自身的分类词，
   *   这里是"文件隶属哪个功能"的**集合级**标记。
   */
  tag?: string;
  /** diff：源 feature */
  feature_a?: string;
  /** diff：目标 feature */
  feature_b?: string;
  /** 视图层级：design（默认，活态文件）/ live（实际代码快照，仅 query=dsl/nodes/edges/node/files/file 生效） */
  view?: DSLView;
  /** diff：feature_b 视图层级，默认跟随 view（design）；对比"设计 vs 代码现状"时传 live 以读取实际快照 */
  view_b?: DSLView;
  /** calls：项目根目录（用于打开 cache.db 查询调用关系） */
  project_dir?: string;
}

export interface QueryFeatureResult {
  message: string;
  /** 原始数据（供 LLM 进一步处理） */
  data?: unknown;
}

/** DesignDSL 顶层类型未声明 meta（overlay 把结构化目标/功能标记落进 base meta），读取时按显式类型收窄 */
interface DSLWithMeta {
  meta?: { goals?: OverlayGoal[]; function_tags?: Record<string, string[]> };
}

function requireFeature(input: QueryFeatureInput): string {
  const f = input.feature;
  if (!f) throw new Error(`query "${input.query}" 需要 feature 参数`);
  return f;
}

/** 获取 DSL，支持 design/live 视图 */
function loadDSL(input: QueryFeatureInput) {
  const feature = requireFeature(input);
  const dsl = getDSLByView(feature, input.view ?? 'design');
  if (!dsl) throw new Error(`feature "${feature}" 不存在（视图: ${input.view ?? 'design'}）`);
  return dsl;
}

/**
 * 查询 cache.db 中指定文件的调用关系
 *  ★ 2026-10-09（T79）：**导出**给验收判据复用（检查项 `call-exists`）——
 *  调用边的读取逻辑只此一处，别在别处再写一份 SQL。
 *
 *  ★★★ 2026-10-09（T80）**修正 id 约定 —— 这个函数此前一直是查不到东西的**：
 *   它原来用 `${fileId}#` 作前缀，而 `fileId` 是 **DSL 的文件节点 id**（如 `file_src_format_ts`）；
 *   但索引 `nodes` / `edges` 里符号 id 用的是 **仓库相对路径**（实测 `src/format.ts#total`）
 *   ⇒ **前缀永远匹配不上** ⇒ `query=calls` 恒空，而它的提示还把责任推给"索引没建"。
 *   ⇒ 现在统一用 **`relPath`**（与索引同源）。★ 两个 id 空间**不同源**这件事，
 *     正是"两端各自约定 id"那类病的又一例（与 T54「入参端不接」同族）。
 */
export function queryFileCalls(db: Database, relPath: string): { incoming: Array<{ caller: string; callee: string; line: number; cross: boolean }>; outgoing: Array<{ caller: string; callee: string; line: number; cross: boolean }> } {
  // 前缀匹配：符号节点 ID 形如 "<仓库相对路径>#<SymbolName>"（★ 实测，不是 DSL 的文件节点 id）
  const prefix = `${relPath}#`;

  // 入调用：本文件符号被其他文件调用（target 以本文件前缀开头）
  const incoming = db
    .prepare(
      `SELECT e.source, e.target, e.line, e.metadata
       FROM edges e
       WHERE e.kind = 'call' AND e.target LIKE ?`,
    )
    .all(`${prefix}%`) as Array<{ source: string; target: string; line: number; metadata: string | null }>;

  // 出调用：本文件调用其他文件符号（source 以本文件前缀开头）
  const outgoing = db
    .prepare(
      `SELECT e.source, e.target, e.line, e.metadata
       FROM edges e
       WHERE e.kind = 'call' AND e.source LIKE ?`,
    )
    .all(`${prefix}%`) as Array<{ source: string; target: string; line: number; metadata: string | null }>;

  return {
    incoming: incoming.map((e) => ({
      caller: e.source,
      callee: e.target,
      line: e.line,
      cross: e.metadata ? (JSON.parse(e.metadata) as { cross?: boolean }).cross ?? false : false,
    })),
    outgoing: outgoing.map((e) => ({
      caller: e.source,
      callee: e.target,
      line: e.line,
      cross: e.metadata ? (JSON.parse(e.metadata) as { cross?: boolean }).cross ?? false : false,
    })),
  };
}

/** 将符号节点 ID 解析为可读名（"file_rel#SymbolName" → "SymbolName"） */
function symbolNameFromId(nodeId: string): string {
  const hash = nodeId.lastIndexOf('#');
  return hash === -1 ? nodeId : nodeId.slice(hash + 1);
}

/** 将符号节点 ID 解析为来源文件路径（"file_rel#SymbolName" → "rel" 或 "file_rel" → "rel"） */
function filePathFromId(nodeId: string): string {
  const hash = nodeId.lastIndexOf('#');
  const body = hash === -1 ? nodeId : nodeId.slice(0, hash);
  const prefix = 'file_';
  // ★ T80：索引里的符号 id 是 **`<仓库相对路径>#<符号名>`** ⇒ 取 `#` 之前**就是精确路径**，直接用。
  if (!body.startsWith(prefix)) return body;
  // 兼容 DSL 那一侧的旧 id 空间（`file_<sanitize(rel)>`）：★ 反 sanitize **不可逆**（`_` 既可能是
  // 路径分隔符也可能本来就在名字里）⇒ 只能原样展示，别假装能还原。
  return body.slice(prefix.length);
}

/** 保序去重（派生视图内部折叠重复项；不引入新判据） */
function dedupePreserve(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/** 紧凑列表：超长时截断并**标注省略数**（不静默丢） */
function compactList(xs: string[], cap = 5): string {
  return xs.length <= cap ? xs.join('/') : `${xs.slice(0, cap).join('/')}…+${xs.length - cap}`;
}

/** 积木契约 → 一行紧凑提示（只投影 `contract` 已有字段，缺项不补、不推断） */
function contractHint(c: BrickContract): string {
  const eff = c.effects;
  const parts: string[] = [`role=${c.role?.class ?? '?'}`];
  const writes = (eff?.writes ?? []).map((e) => e.target);
  const holds = (eff?.holds ?? []).map((e) => e.target);
  const emits = eff?.emits ?? [];
  const config = eff?.reads_config ?? [];
  if (writes.length) parts.push(`writes=${compactList(writes)}`);
  if (holds.length) parts.push(`holds=${compactList(holds)}`);
  if (emits.length) parts.push(`emits=${compactList(emits)}`);
  if (config.length) parts.push(`config=${compactList(config)}`);
  return `契约(${parts.join(', ')})`;
}

export function queryFeature(input: QueryFeatureInput): QueryFeatureResult {
  const currentView = input.view ?? 'design';
  const viewTag = `(视图: ${currentView})`;

  switch (input.query) {
    // ── 全量 DSL 摘要：结构化展示，替代原始 JSON 倾倒 ──────────
    case 'dsl': {
      const dsl = loadDSL(input);
      const nodes = dsl.geometry?.nodes ?? [];
      const edges = dsl.geometry?.edges ?? [];
      const files = dsl.semantic?.files ?? [];
      const invariants = dsl.semantic?.multi_file_invariants ?? [];

      const lines: string[] = [
        `══ feature "${dsl.feature}" ${viewTag} ══`,
        `  ID: ${dsl.id} · 状态: ${dsl.status ?? 'draft'}${dsl.version ? ` · 版本: ${dsl.version}` : ''}`,
        '',
        `  ─ 几何层 ─`,
      ];

      // 节点摘要
      if (nodes.length === 0) {
        lines.push('  节点: (无)');
      } else {
        lines.push(`  节点 (${nodes.length}):`);
        nodes.forEach((n) => {
          const layer = n.layer ?? 'main';
          const type = n.type ?? '-';
          const status = n.status ?? '-';
          lines.push(`    [${n.id}] ${n.label ?? n.title ?? n.id} (${type}, ${layer}, ${status})`);
        });
      }

      // 边摘要
      if (edges.length === 0) {
        lines.push('  边: (无)');
      } else {
        lines.push(`  边 (${edges.length}):`);
        edges.forEach((e) => {
          const label = e.label ? ` "${e.label}"` : '';
          lines.push(`    [${e.id}] ${e.from} → ${e.to}${label}`);
        });
      }

      lines.push('', '  ─ 语义层 ─');

      // 文件摘要
      if (files.length === 0) {
        lines.push('  文件: (无)');
      } else {
        lines.push(`  文件 (${files.length}):`);
        files.forEach((f) => {
          const apiCount = f.expected_apis?.length ?? 0;
          const symCount = f.symbols?.length ?? 0;
          const status = f.status ?? '-';
          const layer = f.layer ?? '-';
          lines.push(`    [${f.id}] ${f.path} (${status}, ${layer}, ${apiCount} API, ${symCount} 符号)`);
        });
      }

      // 不变式摘要
      if (invariants.length === 0) {
        lines.push('  不变式: (无)');
      } else {
        lines.push(`  不变式 (${invariants.length}):`);
        invariants.forEach((inv, i) => {
          lines.push(`    ${i + 1}. ${inv}`);
        });
      }

      lines.push('', '  (需要更多细节请使用 nodes/edges/files/file 查询)');

      return {
        message: lines.join('\n'),
        data: dsl,
      };
    }

    case 'features': {
      const dsls = listStoredFeatures();
      if (dsls.length === 0) return { message: '尚无已设计的 feature', data: [] };
      const lines = dsls.map((dsl, i) => {
        const fileCount = dsl.semantic?.files?.length ?? 0;
        const decisionCount = dsl.geometry?.nodes?.filter((n) => n.decision).length ?? 0;
        const invariantCount = dsl.semantic?.multi_file_invariants?.length ?? 0;
        const status = dsl.status ?? 'draft';
        return `${i + 1}. ${dsl.feature} (${status}, ${fileCount} 文件, ${decisionCount} 决策, ${invariantCount} 不变式) [${dsl.id}]`;
      });
      return {
        message: ['已设计的 feature：', ...lines].join('\n'),
        data: dsls.map((d) => ({
          id: d.id,
          feature: d.feature,
          status: d.status,
          decisions: d.geometry?.nodes?.filter((n) => n.decision).length ?? 0,
        })),
      };
    }

    // ── 细粒度查询：节点列表 ──────────────────────────────────
    case 'nodes': {
      const dsl = loadDSL(input);
      const nodes = dsl.geometry?.nodes ?? [];
      let filtered = nodes;
      if (input.layer) filtered = filtered.filter((n) => (n.layer ?? 'main') === input.layer);
      if (input.type) filtered = filtered.filter((n) => n.type === input.type);

      if (filtered.length === 0) {
        return { message: `feature "${dsl.feature}" 无匹配节点 ${viewTag}`, data: [] };
      }

      const lines = filtered.map((n, i) => {
        const layer = n.layer ?? 'main';
        const type = n.type ?? '-';
        const status = n.status ?? '-';
        return `${i + 1}. [${n.id}] ${n.label ?? n.title ?? n.id} (type: ${type}, layer: ${layer}, status: ${status})`;
      });
      const summary = `节点总数: ${nodes.length}，匹配: ${filtered.length}`;
      return {
        message: [`feature "${dsl.feature}" 节点列表 ${viewTag}`, summary, '', ...lines].join('\n'),
        data: filtered.map((n) => ({
          id: n.id,
          label: n.label ?? n.title,
          type: n.type,
          layer: n.layer ?? 'main',
          status: n.status,
          swimlane: n.swimlane,
          arch_layer: n.arch_layer,
        })),
      };
    }

    // ── 细粒度查询：边列表 ────────────────────────────────────
    case 'edges': {
      const dsl = loadDSL(input);
      const edges = dsl.geometry?.edges ?? [];
      let filtered = edges;
      if (input.layer) filtered = filtered.filter((e) => (e.layer ?? 'main') === input.layer);

      if (filtered.length === 0) {
        return { message: `feature "${dsl.feature}" 无边 ${viewTag}`, data: [] };
      }

      const lines = filtered.map((e, i) => {
        const type = e.type ?? 'straight';
        const arrow = e.arrow ?? 'forward';
        const layer = e.layer ?? 'main';
        const label = e.label ? ` "${e.label}"` : '';
        return `${i + 1}. [${e.id}] ${e.from} → ${e.to}${label} (type: ${type}, arrow: ${arrow}, layer: ${layer})`;
      });
      const summary = `边总数: ${edges.length}，匹配: ${filtered.length}`;
      return {
        message: [`feature "${dsl.feature}" 边列表 ${viewTag}`, summary, '', ...lines].join('\n'),
        data: filtered.map((e) => ({
          id: e.id,
          from: e.from,
          to: e.to,
          label: e.label,
          type: e.type ?? 'straight',
          arrow: e.arrow ?? 'forward',
          layer: e.layer ?? 'main',
        })),
      };
    }

    // ── 细粒度查询：单个节点详情 ──────────────────────────────
    case 'node': {
      const dsl = loadDSL(input);
      if (!input.node_id) throw new Error('query "node" 需要 node_id 参数');
      const node = (dsl.geometry?.nodes ?? []).find((n) => n.id === input.node_id);
      if (!node) throw new Error(`feature "${dsl.feature}" 中不存在节点 "${input.node_id}"`);

      const lines: string[] = [
        `节点: [${node.id}]`,
        `  标签: ${node.label ?? '-'}`,
        `  标题: ${node.title ?? '-'}`,
        `  类型: ${node.type ?? '-'}`,
        `  职责分层: ${node.layer ?? 'main'}`,
        `  状态: ${node.status ?? '-'}`,
        `  架构层: ${node.arch_layer ?? '-'}`,
        `  泳道: ${node.swimlane ?? '-'}`,
        node.description ? `  描述: ${node.description}` : '',
        `  位置: (${node.x ?? 'auto'}, ${node.y ?? 'auto'}) ${node.width ?? 'auto'}×${node.height ?? 'auto'}`,
        node.sub_dsl ? `  子图: ${node.sub_dsl.feature ?? '（内联 DSL）'}` : '',
      ].filter(Boolean);

      // 决策卡：参数表 + 决策记录（2026-08-18 设计文档层）
      if (node.attributes && Object.keys(node.attributes).length > 0) {
        lines.push('  ─ 决策卡·参数表 ─');
        for (const [k, v] of Object.entries(node.attributes)) {
          lines.push(`    ${k}: ${v}`);
        }
      }
      if (node.decision) {
        const d = node.decision;
        const status = d.status ?? 'active';
        const meta = [`状态: ${status}`];
        if (d.thread) meta.push(`功能线: ${d.thread}`);
        if (d.tags?.length) meta.push(`标签: ${d.tags.join(', ')}`);
        lines.push('  ─ 决策卡·决策记录 ─');
        lines.push(`    ${meta.join(' · ')}`);
        lines.push(`    结论: ${d.summary}`);
        if (d.rationale) lines.push(`    理由: ${d.rationale}`);
        for (const alt of d.alternatives ?? []) {
          lines.push(`    替代「${alt.option}」被否: ${alt.rejected_because}`);
        }
        if (d.consequences) lines.push(`    后果: ${d.consequences}`);
        if (d.acceptance) lines.push(`    验收: ${d.acceptance}`);
        // 版本史：decision_history 旧→新（当前版在 decision 字段，不入栈）
        if (node.decision_history?.length) {
          lines.push(`  ─ 决策版本史 (${node.decision_history.length} 次修订，旧→新) ─`);
          node.decision_history.forEach((h, i) => {
            const hStatus = h.decision.status ?? 'active';
            lines.push(`    v${i + 1} · ${h.at}${h.note ? ` · ${h.note}` : ''} · [${hStatus}]`);
            lines.push(`      结论: ${h.decision.summary}`);
          });
          lines.push(`    当前版 · [${status}] ${d.summary}`);
        }
      }

      // 如有内容块，展示摘要
      if (node.content) {
        lines.push(`  内容类型: ${node.content.type}`);
        if (node.content.blocks) {
          const blockSummary = node.content.blocks.map((b) => {
            if (b.type === 'text') return `text: ${(b.value ?? '').slice(0, 60)}`;
            if (b.type === 'code') return `code: ${(b.value ?? '').slice(0, 40)}`;
            if (b.type === 'list') return `list (${b.items?.length ?? 0} 项)`;
            return b.type;
          });
          lines.push(`  内容块 (${node.content.blocks.length}): ${blockSummary.join(' | ')}`);
        }
      }

      // 关联的语义文件
      // ★★★ 2026-10-09（T93）：`semantic.files` 现在**只放文件**（契约 `semantic.ts:67`：`path` 是单个文件路径）
      //   ⇒ 聚合/模块节点在这里**查不到**（其摘要住在 `geometry.nodes[].title`，见下）。
      const file = (dsl.semantic?.files ?? []).find((f) => f.id === node.id);
      if (file) lines.push(`  关联文件: ${file.path}`);
      // 摘要：先读节点 `title`（`geometry.ts:124`「人话主标题…渲染端优先展示，label 兜底」），
      // **无 title 再回退**到语义层 `responsibility`（非"补丁"——title 注释写明的优先级）。
      const roleText = node.title?.trim() || file?.responsibility;
      if (roleText) lines.push(`  职责: ${roleText}`);

      // 决策向上并集（易读分层口径）：本节点自有决策 + 全部后代（host/detail 子节点 + sub_dsl 内节点，递归收集）
      // 单点所有于稳定叶子，可读层（L1–L3）只投影并集——不复制。
      const ownDec = node.decision
        ? [{ summary: node.decision.summary, status: node.decision.status ?? 'active', thread: node.decision.thread }]
        : [];
      const descDec: Array<{ id: string; summary: string; status: string; thread?: string }> = [];
      const queue: Array<unknown> = [];
      const pushChildren = (cur: unknown) => {
        const c = cur as { id?: string; sub_dsl?: { geometry?: { nodes?: unknown[] } } };
        const hostChildren = (dsl.geometry?.nodes ?? []).filter((nh) => nh.host && c.id && nh.host === c.id);
        for (const ch of hostChildren) { queue.push(ch); }
        for (const ss of c.sub_dsl?.geometry?.nodes ?? []) { queue.push(ss); }
      };
      pushChildren(node);
      while (queue.length) {
        const cur = queue.shift() as { decision?: { summary: string; status?: string; thread?: string }; host?: string };
        if (cur.decision) {
          descDec.push({ id: (cur as { id?: string }).id ?? '', summary: cur.decision.summary, status: cur.decision.status ?? 'active', thread: cur.decision.thread });
        }
        pushChildren(cur);
      }
      const decisionsUnion = [...ownDec, ...descDec];
      if (decisionsUnion.length) {
        lines.push(`  设计决策·向上并集: 本节点 ${ownDec.length} · 含下层 ${descDec.length}（共 ${decisionsUnion.length}）`);
      }

      return {
        message: [`feature "${dsl.feature}" 节点详情 ${viewTag}`, '', ...lines].join('\n'),
        data: {
          ...node,
          decisions_own: ownDec,
          decisions_descendants: descDec,
          decisions_union: decisionsUnion,
        },
      };
    }

    // ── 决策目录：按功能线分组，支持状态/功能线过滤 ────────────
    case 'decisions': {
      const dsl = loadDSL(input);
      const nodes = dsl.geometry?.nodes ?? [];

      let entries = nodes.filter((n) => n.decision);
      if (input.thread) entries = entries.filter((n) => (n.decision!.thread ?? '') === input.thread);
      if (input.decision_status)
        entries = entries.filter((n) => (n.decision!.status ?? 'active') === input.decision_status);

      if (entries.length === 0) {
        const filters = [
          input.thread ? `功能线="${input.thread}"` : null,
          input.decision_status ? `状态=${input.decision_status}` : null,
        ]
          .filter(Boolean)
          .join(', ');
        return {
          message: `feature "${dsl.feature}" 无匹配决策卡${filters ? `（${filters}）` : ''} ${viewTag}`,
          data: [],
        };
      }

      // 按功能线分组（thread 缺省归"(未分类)"）
      const groups = new Map<string, Node[]>();
      for (const n of entries) {
        const key = n.decision!.thread ?? '(未分类)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(n);
      }

      // 排序：未分类放最后，其余按名称
      const sortedThreads = [...groups.keys()].sort((a, b) => {
        if (a === '(未分类)') return 1;
        if (b === '(未分类)') return -1;
        return a.localeCompare(b);
      });

      const lines: string[] = [
        `feature "${dsl.feature}" 决策目录 ${viewTag}`,
        `决策总数: ${entries.length} · 功能线: ${groups.size}${input.decision_status ? ` · 状态过滤: ${input.decision_status}` : ''}`,
        '',
      ];

      for (const thread of sortedThreads) {
        const group = groups.get(thread)!;
        lines.push(`─ 功能线「${thread}」(${group.length} 决策) ─`);
        for (const n of group) {
          const d = n.decision!;
          const status = d.status ?? 'active';
          const tags = d.tags?.length ? ` [${d.tags.join(', ')}]` : '';
          const verInfo = n.decision_history?.length ? ` · ${n.decision_history.length} 次修订` : '';
          lines.push(`  [${status}] ${n.label ?? n.title ?? n.id}: ${d.summary}${tags}${verInfo}`);
          lines.push(`    节点: ${n.id}`);
        }
        lines.push('');
      }

      lines.push('(查看单卡详情与版本史：query=node + node_id)');

      return {
        message: lines.join('\n'),
        data: entries.map((n) => ({
          node_id: n.id,
          label: n.label ?? n.title,
          thread: n.decision!.thread ?? null,
          status: n.decision!.status ?? 'active',
          summary: n.decision!.summary,
          tags: n.decision!.tags ?? [],
          revisions: n.decision_history?.length ?? 0,
        })),
      };
    }

    // ── 细粒度查询：文件列表 ──────────────────────────────────
    case 'files': {
      const dsl = loadDSL(input);
      const files = dsl.semantic?.files ?? [];
      let filtered = files;
      if (input.file_layer) filtered = filtered.filter((f) => f.layer === input.file_layer);
      if (input.file_status) filtered = filtered.filter((f) => f.status === input.file_status);

      if (filtered.length === 0) {
        return { message: `feature "${dsl.feature}" 无语义文件 ${viewTag}`, data: [] };
      }

      // 已实现的符号 = 事实（cache.db 中非闭包的 function/method）；无 root 时退回旧行为（读 DSL 镜像）
      //
      // ★★ 2026-10-08（T54「符号名没有结构化出口」那一半）：**过去这里只留计数**
      //   （`…apis.length`）⇒ 本工具是 LLM 查代码的**第一站**（见 `mcp/server.ts` 的第 10 条），
      //   而它给出的符号**只有个数、没有名字** ⇒ 下游 `find_references.symbol`
      //   （受控词表里的 `anchor`，值 = `qualified_name`）**无从填起**，只能由人/LLM 从散文行里抠。
      //   `fileFacts` 本来就把名字带回来了（`apis[].qualified_name`）—— **丢掉的是投影，不是能力**。
      //   ⇒ 现在按**受控词表**的名字与类型出：`symbols: string[]`（`b_terms.ts` 里的复数形态）。
      const factsRoot = dsl.source_root ?? input.project_dir;
      const actualSymbols = new Map<string, string[]>();
      for (const f of filtered) {
        actualSymbols.set(
          f.id,
          factsRoot ? fileFacts(factsRoot, f.path, dsl.feature).apis.map((a) => a.qualified_name) : [],
        );
      }

      const lines = filtered.map((f, i) => {
        const apiCount = f.expected_apis?.length ?? 0;
        const actualCount = actualSymbols.get(f.id)?.length ?? 0;
        const status = f.status ?? '-';
        const layer = f.layer ?? '-';
        const linesInfo = f.lines ? ` ${f.lines}行` : '';
        return `${i + 1}. [${f.id}] ${f.path} (${status}, ${layer}, ${apiCount} 预期API/${actualCount} 已实现符号${linesInfo})`;
      });
      const summary = `文件总数: ${files.length}，匹配: ${filtered.length}`;
      return {
        message: [`feature "${dsl.feature}" 文件列表 ${viewTag}`, summary, '', ...lines].join('\n'),
        data: filtered.map((f) => ({
          id: f.id,
          // ★★ `file`，不是 `path`：本投影是给**调用方（LLM）**用的**定位器**面 ——
          //   受控词表里"文件路径"这个词是 `file`（`anchor`），而 `find_references` 正收这个词
          //   ⇒ 同一件事不再需要一次字段名翻译（T54「同一个东西两个名字」那一半）。
          //   ★ 这与**不动** `SemanticFile.path` 不矛盾：那是 DSL 侧的**事实字段**
          //   （`schema/design_dsl.schema.json` 的 `required`）。事实叫 `path`，定位器叫 `file`；
          //   本投影本来就是一层转写（它已经丢掉 `responsibility_en` / `expected_deps` 等）。
          file: f.path,
          responsibility: f.responsibility,
          status: f.status,
          layer: f.layer,
          lines: f.lines,
          apiCount: f.expected_apis?.length ?? 0,
          // ★ 过去这里是 `actualCount` + `symbolCount` **两个派生计数**（都 = `symbols.length`）
          //   ⇒ 删。**派生值不另立字段**（"不留过渡物"；要数就 `.length`）。
          symbols: actualSymbols.get(f.id) ?? [],
        })),
      };
    }

    // ── 细粒度查询：单个文件详情 ──────────────────────────────
    case 'file': {
      const dsl = loadDSL(input);
      if (!input.file_id) throw new Error('query "file" 需要 file_id 参数');
      const file = (dsl.semantic?.files ?? []).find((f) => f.id === input.file_id);
      // ★★★ 2026-10-09（T93）：`semantic.files` 现在**只放文件** ⇒ 聚合/模块节点不在这里。
      //   · 是几何节点但**不是文件**（模块/目录，`geometry.type !== 'file'`）⇒ **人话错误**并指路 `query=node`；
      //   · 绝不把聚合节点的 `title` / 成员串当"文件路径"去读源码（旧实害：「不存在文件」+ 逗号串被当路径）。
      if (!file) {
        const n = (dsl.geometry?.nodes ?? []).find((x) => x.id === input.file_id);
        if (n && n.type !== 'file') {
          throw new Error(
            `"${input.file_id}" 不是文件节点（geometry.type=${n.type ?? '?'}${n.title ? `，职责：${n.title}` : ''}）` +
              `⇒ query "file" 只接受真文件；要看该节点请用 query="node" + node_id="${input.file_id}"。`,
          );
        }
        throw new Error(`feature "${dsl.feature}" 中不存在文件 "${input.file_id}"`);
      }
      // 摘要：先读节点 `title`（`geometry.ts:124`「人话主标题…渲染端优先展示」），无 title 再回退 `responsibility`。
      const node = (dsl.geometry?.nodes ?? []).find((x) => x.id === file.id);

      const lines: string[] = [
        `文件: [${file.id}]`,
        `  路径: ${file.path}`,
        `  职责: ${node?.title?.trim() || file.responsibility}`,
        `  状态: ${file.status ?? '-'}`,
        `  架构层: ${file.layer ?? '-'}`,
        file.lines ? `  行数: ${file.lines}` : '',
        '',
      ];

      // 预期 API
      if (file.expected_apis && file.expected_apis.length > 0) {
        lines.push('  预期 API:');
        file.expected_apis.forEach((api, i) => {
          lines.push(`    ${i + 1}. ${api.signature}${api.notes ? ` — ${api.notes}` : ''}`);
        });
      } else {
        lines.push('  预期 API: (无)');
      }

      // 已实现 API — 事实来源 = cache.db（★ T20：DSL 里已无镜像可退回 ⇒ 取不到就是空）
      const factsRoot = dsl.source_root ?? input.project_dir;
      const implementedApis: Array<{ signature: string; notes?: string }> = factsRoot
        ? fileFacts(factsRoot, file.path, dsl.feature).apis.map((a) => ({ signature: a.signature ?? a.name, notes: `line ${a.start_line}` }))
        : [];
      if (implementedApis.length > 0) {
        lines.push('');
        lines.push('  已实现 API:');
        implementedApis.forEach((api, i) => {
          lines.push(`    ${i + 1}. ${api.signature}${api.notes ? ` — ${api.notes}` : ''}`);
        });
      }

      // 依赖
      if (file.expected_deps && file.expected_deps.length > 0) {
        lines.push('');
        lines.push('  依赖:');
        file.expected_deps.forEach((dep) => lines.push(`    - ${dep}`));
      }

      // 符号表（end_line 可能不存在，做防呆处理）
      if (file.symbols && file.symbols.length > 0) {
        lines.push('');
        lines.push('  符号表:');
        file.symbols.forEach((sym, i) => {
          const range = sym.end_line ? `L${sym.line}-${sym.end_line}` : `L${sym.line}`;
          const sig = sym.signature ? ` — ${sym.signature}` : '';
          lines.push(`    ${i + 1}. ${sym.kind}: ${sym.name} (${range})${sig}`);
        });
      }

      // 行为描述
      if (file.expected_behavior) {
        lines.push('');
        lines.push(`  行为: ${file.expected_behavior}`);
      }

      return {
        message: [`feature "${dsl.feature}" 文件详情 ${viewTag}`, '', ...lines].join('\n'),
        data: file,
      };
    }

    // ── ★★ 圈定范围（T72，2026-10-09）：把 DSL 里已有的四个分组轴
    //    （`layer` / `swimlane` / `arch_layer` / `sub_dsl`）接到**一个统一的 `Scope`** 上，
    //    并解析成**确定的文件集合** —— 这是用户那条"对比现状与设计 ⇒ 分区域重写"工作流的**第一跳**。
    //    ★★ 文法与解析**只在 `src/domain/scope.ts` 一处**；这里只负责**渲染**（别在这儿再写一份语法）。
    //    ★ 空集必须当场说出来 —— "看起来框住了、其实什么也没有"是最危险的那类静默失败。
    case 'scope': {
      if (!input.feature) {
        throw new Error(
          'query "scope"（圈定范围）需要 feature 参数：请传要框的 feature 名，如 ' +
            'get_dsl {query:"scope", feature:"<name>", scope:"layer:main"}。',
        );
      }
      const dsl = loadDSL(input);
      const r = resolveScopeText(dsl, input.scope ?? 'all');
      const body: string[] = [
        `  命中节点 ${r.node_ids.length} 个 · 其中**文件节点** ${r.file_ids.length} 个 · 作用面 ${r.paths.length} 个路径`,
      ];
      if (r.paths.length) {
        body.push('', '  作用面（仓库相对路径，已排序）：');
        for (const p of r.paths) body.push(`    ${p}`);
      }
      if (r.notes.length) {
        body.push('', '  ★ 说明（**不许静默**：没命中 / 被跳过 / 没下钻都在这里）：');
        for (const n of r.notes) body.push(`    · ${n}`);
      }
      body.push(
        '',
        '  ★ 本 scope 由**纯函数**解析（同一输入两次结果**逐字相同**）—— 下游"分区域重写 / 对账"的稳定命名就以它为准。',
      );
      // ★★★ 2026-10-09（T81）：**让只读工具也能交出"对象"**。
      //   实测病灶：design 线 12 个工具**一条对象边都接不上**（`CHAIN_EDGES` 里作上下游各 0），
      //   根因是它们的产物里**没有任何"能交给下游的对象"**（只读工具没有 `written_files`）。
      //   ⇒ 而"我圈定了哪一片"**恰恰是它给出的**（`ResolvedScope.paths` 是确定的文件集合）。
      //   ★ 口径**照抄 `written_files` 立下的规矩**：
      //     · 语义上这是**作用面**（我圈定了/审阅了哪些），**不是**"我改了哪些" ⇒ 用**新键 `scope_files`**；
      //     · ★ **没框到就省略整个键**（不给空数组）—— 空数组会被下游读成"真的没有文件"，
      //       省缺才是"这次没圈到东西"（与 `written_files` 同一条口径）。
      const touched: Record<string, unknown> = { feature: dsl.feature };
      if (r.paths.length) touched.scope_files = r.paths;
      return {
        message: [`══ scope ${formatScope(r.scope)} ${viewTag} ══`, '', ...body].join('\n'),
        data: { ...r, touched },
      };
    }

    // ── 一行式认知索引（AOCI 形状的**派生视图**：只读、不落盘、不新增真相源）──
    //   F:职责  ← 语义层 responsibility
    //   R:关系  ← 已有依赖事实（语义层 expected_deps ∪ cache.db import 事实，走 fileFacts 唯一入口，不新算）
    //   A:契约  ← 语义层 expected_apis 签名（逐条）
    //   S:高熵决策 ← 语义层**非显然**字段（expected_behavior / contract / 非活跃 lifecycle）
    //   标签位 [TAG] ← layer（架构层 id，等价 AOCI 的标签槽；无则不填）
    //   ★ 段缺则省略（宁缺毋造）；权威仍为 cache.db + DSL，本视图随时可重生成。
    case 'digest': {
      if (!input.feature) {
        throw new Error(
          'query "digest"（每文件一行认知索引）需要 feature 参数：请传要投影的语义层 feature 名，' +
            '如 get_dsl {query:"digest", feature:"<name>"}。',
        );
      }
      const dsl = loadDSL(input);
      const files = dsl.semantic?.files ?? [];
      if (files.length === 0) {
        return {
          message: `feature "${dsl.feature}" 的语义层没有文件（semantic.files 为空），无可投影的一行式索引 ${viewTag}`,
          data: [],
        };
      }
      // 依赖事实的根 = DSL 自带的 source_root（import_project 保证写入）；缺则退回显式 project_dir。
      const factsRoot = dsl.source_root ?? input.project_dir;
      const lines: string[] = [
        `══ feature "${dsl.feature}" 一行式认知索引 ${viewTag}（语义层派生视图·只读·不落盘）══`,
        `  ${files.length} 文件 · 由当前 DSL 现渲染（可随时重生成；权威仍为 cache.db + DSL）`,
        '',
      ];
      const cards: Array<Record<string, unknown>> = [];
      // ★ T89：决策卡住在 `geometry.nodes[].decision`（`semantic.files` 上没有）⇒ 建个索引一次，循环里用
      const nodeById = new Map(
        ((dsl.geometry?.nodes ?? []) as Array<{ id: string; decision?: unknown; title?: string }>).map((n) => [n.id, n]),
      );
      /**
       * ★★★ 2026-10-09（T90 下半）：**实际视图显示的是「最后**实现**过的」那一版决策**。
       *
       * ## 用户模型（他提出的）
       * *"实现的话，那里展示的是**最后一次实现的决策**，设计那里展示的是**最后一次设计的决策**。"*
       * ⇒ 于是 **两视图相同 = 设计已实现（同步）**；**不同 = 设计改了但没实现** ✓
       *
       * ## ★ 为什么**不能**退回"overlay 最新"
       * 我 T89 第一版正是从 overlay 读**最新** `decision` ⇒ 两视图**必然逐字相同** ⇒ **重合**（用户当场抓到）。
       * ⇒ **没实现过就不显示**（= 选项 A）：**"设计有、实际无"本身就是"未实现"这个信号** ✓
       *   ★ 退回 overlay 最新 = 选项 B ⇒ **信号消失**（又重合）。
       *
       * ## 来源 = **快照的 `intents`**（T90 上半落的）
       * `snapshotBeforeWrite` 在每个重写工具**写盘前**记下当时各文件的决策 ⇒
       * **那就是"这次实现所依据的意图"**。**取最近一份含该文件的快照**（`listFileSnapshots` 已按新→旧排）。
       */
      const implementedByPath = new Map<string, { summary?: string; acceptance?: string }>();
      if (currentView === 'live' && dsl.source_root) {
        try {
          for (const snap of listFileSnapshots(dsl.source_root)) {
            for (const [rel, it] of Object.entries(snap.intents ?? {})) {
              // ★ **最近优先**（快照已按新→旧）⇒ 先到的不覆盖
              if (!implementedByPath.has(rel)) implementedByPath.set(rel, it);
            }
          }
        } catch {
          // ★ 读不到快照 ⇒ 退化为"实际视图只有结构" —— **但那不是错误**（可能还没实现过任何东西）
          //   ★ 刻意**不报错**也不 fake（与本节"有啥填啥"的口径一致）。
        }
      }
      for (const f of files) {
        const seg: string[] = [];
        // F ← responsibility（无则不填占位）
        // ★★★ 2026-10-09（T93）：先读节点 `title`（`geometry.ts:124`「人话主标题…渲染端优先展示，label 兜底」），
        //   **无 title 再回退**语义层 `responsibility` —— 聚合体摘要已移住 `title`，语义层只放文件。
        const nodeTitle = typeof nodeById.get(f.id)?.title === 'string' ? nodeById.get(f.id)!.title!.trim() : '';
        const resp = nodeTitle || (typeof f.responsibility === 'string' ? f.responsibility.trim() : '');
        if (resp) seg.push(`F:${resp}`);
        // R ← 已有依赖事实：设计意图 expected_deps ∪ cache.db 真实 import 边
        const factsDeps = factsRoot ? fileFacts(factsRoot, f.path, dsl.feature).deps : [];
        const rels = dedupePreserve([...(f.expected_deps ?? []), ...factsDeps]);
        if (rels.length) seg.push(`R:${rels.join(', ')}`);
        // A ← expected_apis 签名（逐条；无则省略）
        const sigs = (f.expected_apis ?? [])
          .map((a) => a.signature)
          .filter((s): s is string => typeof s === 'string' && s.trim() !== '');
        if (sigs.length) seg.push(`A:${sigs.join(' ; ')}`);
        // S ← 语义层非显然字段（有啥填啥，没有就省略）
        const s: string[] = [];
        if (f.expected_behavior?.trim()) s.push(f.expected_behavior.trim());
        if (f.contract) s.push(contractHint(f.contract));
        if (f.lifecycle && f.lifecycle.status !== 'active') {
          s.push(`生命周期=${f.lifecycle.status}${f.lifecycle.merged_into ? `→${f.lifecycle.merged_into}` : ''}`);
        }
        // ★★★ 2026-10-09（T89，用户提案）：**S 里也要有「决策卡」** —— 那才是**人写的设计意图**。
        //   ★ 用户原话：*"哪怕是**实际 DSL** 也能**一眼看出来**其上面标注的一些**设计意图**什么的。"*
        //   ⇒ 决策卡住在 **`geometry.nodes[].decision`**（`semantic.files` 上没有）⇒ 从这里取。
        //   ★ **同一份渲染、实际 DSL 也成立**：决策卡由 `applyOverlay` 回填进 base ⇒
        //     不管这份是"设计"还是"实际"，**挂上去的意图都会显示** ✓
        //   ★ 只取**最高熵的两个短字段**（`summary` / `acceptance`）——
        //     `rationale` 太长会把"一行一个文件"撑破（★ 那正是本节存在的理由：**一眼**）。
        // ★ T90：设计视图取「最新设计」（`nodes[].decision`）；**实际视图取「最后实现过的」**（快照 `intents`）
        const dec =
          ((nodeById.get(f.id) as { decision?: { summary?: string; acceptance?: string } } | undefined)?.decision) ??
          implementedByPath.get(f.path);
        if (dec?.summary?.trim()) s.push(`决策=${dec.summary.trim()}`);
        if (dec?.acceptance?.trim()) s.push(`验收=${dec.acceptance.trim()}`);
        if (s.length) seg.push(`S:${s.join(' ; ')}`);
        const tag = f.layer ? `[${f.layer}]` : '';
        const body = seg.length ? seg.join(' | ') : '(语义层无 F/R/A/S 字段可投影)';
        lines.push(`${f.path}${tag}: ${body}`);
        cards.push({
          id: f.id,
          path: f.path,
          layer: f.layer ?? null,
          responsibility: resp || null,
          deps: rels,
          apis: sigs,
          decisions: s,
        });
      }
      lines.push('', '(需要单文件细节：query=file + file_id；需要实现事实：query=files / query=calls)');
      return { message: lines.join('\n'), data: cards };
    }

    // ── 细粒度查询：调用关系 ──────────────────────────────────
    case 'calls': {
      const dsl = loadDSL(input);
      if (!input.file_id) throw new Error('query "calls" 需要 file_id 参数');
      if (!input.project_dir) throw new Error('query "calls" 需要 project_dir 参数（项目根目录，用于打开 cache.db）');

      const file = (dsl.semantic?.files ?? []).find((f) => f.id === input.file_id);
      if (!file) throw new Error(`feature "${dsl.feature}" 中不存在文件 "${input.file_id}"`);

      // 打开项目 cache.db：打不开 = 数据源不可用 ⇒ 硬失败（不降级成"看起来正常"的返回值）
      let db: Database;
      try {
        db = getProjectCacheDb(input.project_dir);
      } catch (err) {
        throw new Error(
          `无法打开项目 cache.db（project_dir=${input.project_dir}）：${err instanceof Error ? err.message : String(err)}。请先运行 import_project 并传入 cache_db 参数。`,
        );
      }

      const { incoming, outgoing } = queryFileCalls(db, file.path);

      if (incoming.length === 0 && outgoing.length === 0) {
        // ★ T80：**别再把它归因成"索引没建"** —— 索引在不在是另一回事（可用 index_integrity 查）。
        //   这里能负责说清的只有："**在本索引里**，该文件确实没有出/入调用"。
        return {
          message:
            `feature "${dsl.feature}" 文件 "${file.path}" 在本索引里**没有出/入调用记录** ${viewTag}` +
            `（该文件确实不调用项目内符号、也没被项目内符号调用；若你确信不是这样，` +
            `先确认索引与源码一致 —— 跑一次 import_project 保鲜，再用 index_integrity 看覆盖度）`,
          data: { incoming: [], outgoing: [] },
        };
      }

      const lines: string[] = [
        `══ feature "${dsl.feature}" 文件 "${file.path}" 调用关系 ${viewTag} ══`,
        '',
      ];

      if (outgoing.length > 0) {
        lines.push(`  ─ 出调用（本文件调用其他）${outgoing.length} 条 ─`);
        outgoing.forEach((c, i) => {
          const calleeFn = symbolNameFromId(c.callee);
          const callerFn = symbolNameFromId(c.caller);
          const crossTag = c.cross ? ' [跨文件]' : '';
          lines.push(`    ${i + 1}. L${c.line} ${callerFn} → ${calleeFn}${crossTag}`);
        });
      } else {
        lines.push('  出调用: (无)');
      }

      if (incoming.length > 0) {
        lines.push('');
        lines.push(`  ─ 入调用（其他文件调用本文件）${incoming.length} 条 ─`);
        incoming.forEach((c, i) => {
          const callerFn = symbolNameFromId(c.caller);
          const calleeFn = symbolNameFromId(c.callee);
          const callerFile = filePathFromId(c.caller);
          const crossTag = c.cross ? ' [跨文件]' : '';
          lines.push(`    ${i + 1}. L${c.line} ${callerFn} → ${calleeFn} (来自 ${callerFile})${crossTag}`);
        });
      } else {
        lines.push('', '  入调用: (无)');
      }

      return {
        message: lines.join('\n'),
        data: { incoming, outgoing },
      };
    }

    // ── 细粒度查询：函数级大纲（目录 → 文件 → 函数 + 调用/被调用/递归） ──
    case 'functions': {
      const dsl = loadDSL(input);
      const feature = dsl.feature;
      const sourceRoot = dsl.source_root ?? input.project_dir;
      const { ok, outline, note } = buildFunctionOutline(feature, sourceRoot);

      // 找不到 / 打不开函数索引缓存 = 数据源不可用 ⇒ 硬失败（不降级成"空大纲"的正常返回）
      if (!ok) {
        throw new Error(
          `feature "${feature}" 无法读取函数级大纲（source_root=${sourceRoot ?? '(未指定)'}）：${note ?? '未知原因'}`,
        );
      }

      // 缓存可读、但确实没有函数符号 = 成功且为空
      if (outline.functions.length === 0) {
        return {
          message: `feature "${feature}" 暂无函数级大纲 ${viewTag}`,
          data: { functions: [] },
        };
      }

      const total = outline.functions.length;
      const byDir = new Map<string, number>();
      for (const f of outline.functions) byDir.set(f.dir, (byDir.get(f.dir) ?? 0) + 1);
      const dirs = [...byDir.entries()].sort((a, b) => b[1] - a[1]);
      const recursive = outline.functions.filter((f) => f.recursive);

      const lines: string[] = [
        `══ feature "${feature}" 函数级大纲 ${viewTag}（${total} 个函数/方法）══`,
        `  db: ${outline.db_file}`,
        '',
        `  ─ 目录分布（${dirs.length} 个目录）─`,
        ...dirs.map(([d, c]) => `    ${d}  ${c} 个`),
        '',
        `  ─ 递归函数（自调用）${recursive.length} 个 ─`,
        ...(recursive.length ? recursive.slice(0, 20).map((f) => `    ${f.file}:${f.start_line} ${f.qualified_name}`) : ['    (无)']),
        '',
        '  示例函数（前 10）:',
        ...outline.functions.slice(0, 10).map(
          (f) => `    ${f.dir}/${f.name} [${f.kind}] L${f.start_line}-${f.end_line} calls=${f.calls.length} called_by=${f.called_by.length}${f.recursive ? ' 回环' : ''}`,
        ),
      ];

      return {
        message: lines.join('\n'),
        data: outline,
      };
    }

    case 'annotations': {
      const feature = requireFeature(input);
      const r = listAnnotations({
        feature,
        node_id: input.annotation_node_id,
        severity: input.severity,
        unresolved_only: input.unresolved_only,
      });
      return { message: r.message, data: r.annotations };
    }

    case 'approvals': {
      const feature = requireFeature(input);
      const r = listApprovals({ feature, status: input.status, assignee: input.assignee });
      return { message: r.message, data: r.annotations };
    }

    case 'approval_history': {
      const feature = requireFeature(input);
      if (!input.annotation_id) throw new Error('query "approval_history" 需要 annotation_id 参数');
      const r = getApprovalHistory({ feature, annotation_id: input.annotation_id });
      return { message: r.message, data: { current_status: r.current_status, history: r.history } };
    }

    case 'snapshots': {
      const feature = requireFeature(input);
      const r = listSnapshots({ feature });
      return { message: r.message, data: r.snapshots };
    }

    case 'templates': {
      const r = listTemplates();
      return { message: r.message, data: r.templates };
    }

    case 'simulation_state': {
      const feature = requireFeature(input);
      const r = getSimulationState({ feature });
      return { message: r.message, data: { state: r.state, traceCount: r.traceCount } };
    }

    case 'diff': {
      if (!input.feature_a || !input.feature_b) {
        throw new Error('query "diff" 需要 feature_a 和 feature_b 参数');
      }
      const r = diffFeatures({
        feature_a: input.feature_a,
        feature_b: input.feature_b,
        view_a: input.view, // 默认 design
        view_b: input.view_b, // 可选，对比"设计 vs 代码现状"时传 live
      });
      const lines = [
        `diff "${input.feature_a}" → "${input.feature_b}"`,
        `新增 ${r.summary.added} · 删除 ${r.summary.removed} · 修改 ${r.summary.modified}`,
        '',
        ...r.diffs.map((d) => `  [${d.type}] ${d.category} ${d.id}${d.field ? ` (${d.field})` : ''}: ${d.description}`),
      ];
      return { message: lines.join('\n'), data: r };
    }

    // ── 细粒度查询：结构化目标（overlay 全局 goals → base meta.goals）─────
    case 'goals': {
      const dsl = loadDSL(input);
      const goals = (dsl as DSLWithMeta).meta?.goals ?? [];
      if (goals.length === 0) return { message: `feature "${dsl.feature}" 暂无结构化目标`, data: [] };
      const lines = goals.map(
        (g, i) => `${i + 1}. [${g.status ?? 'active'}] ${g.title}${g.description ? ' — ' + g.description : ''}`,
      );
      return { message: [`feature "${dsl.feature}" 结构化目标 ${goals.length} 条`, '', ...lines].join('\n'), data: goals };
    }

    // ── 细粒度查询：边级意图（edge.intent 的 reason/boundary，overlay 缺口③的读端）─────
    case 'edge_intents': {
      const dsl = loadDSL(input);
      const edges = (dsl.geometry?.edges ?? []).filter((e) => e.intent && (e.intent.reason || e.intent.boundary));
      if (edges.length === 0) return { message: `feature "${dsl.feature}" 暂无边级意图`, data: [] };
      const lines = edges.map(
        (e, i) =>
          `${i + 1}. [${e.id}] ${e.from} → ${e.to}: ${e.intent?.reason ?? ''}${e.intent?.boundary ? `（边界: ${e.intent.boundary}）` : ''}`,
      );
      return {
        message: [`feature "${dsl.feature}" 边级意图 ${edges.length} 条`, '', ...lines].join('\n'),
        data: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, reason: e.intent?.reason, boundary: e.intent?.boundary })),
      };
    }

    // ── ★★ 功能标记（人机共创 MVP，2026-10-09）：人给**文件节点**打的「隶属某功能」标签 ──
    //   ★ 存储**只有一个方向**：tag → 成员文件 rel（`overlay.global.function_tags`；
    //     `applyOverlay` 投影进 `base.meta.function_tags` ⇒ 本查询读 base 即可）。
    //   ★ 给 `tag` ⇒ 列出该 tag 的成员 + **失联成员**（成员 rel 在当前 DSL 里找不到任何文件节点）；
    //     不给 ⇒ 列出本 feature 现有**全部** tag（名字 + 成员数 + 失联数）。
    //   ★ 失联**不许静默少一个**：改名一个成员文件后，本读数必须变化（命中减一、失联加一）。
    case 'tag': {
      const dsl = loadDSL(input);
      const tags = (dsl as DSLWithMeta).meta?.function_tags ?? {};
      const names = Object.keys(tags);
      if (names.length === 0) {
        return {
          message:
            `feature "${dsl.feature}" 暂无功能标记 ${viewTag}` +
            `（用 edit_dsl 的 op={op:'add',type:'tag',data:{tag,files}} 给文件节点打标）`,
          data: input.tag ? { tag: input.tag, members: [], found: [], missing: [] } : [],
        };
      }
      // 现存文件节点的 rel 集合（语义层 path ∪ geometry 文件节点 description/id）
      const filePaths = new Set<string>();
      for (const f of dsl.semantic?.files ?? []) if (f.path) filePaths.add(f.path);
      for (const n of dsl.geometry?.nodes ?? []) if (n.type === 'file') filePaths.add(n.description ?? n.id);

      if (!input.tag) {
        // 不给 tag：列出全部标签（名字 + 成员数 + 失联数）—— 便于发现有哪些标记
        const sorted = [...names].sort();
        const lines = sorted.map((t) => {
          const members = tags[t];
          const miss = members.filter((m) => !filePaths.has(m)).length;
          return `  · 「${t}」${members.length} 个成员${miss ? ` · **${miss} 个失联**` : ''}`;
        });
        return {
          message: [`feature "${dsl.feature}" 功能标记 ${names.length} 个 ${viewTag}`, '', ...lines, '', '（查看某标签的成员：加 tag 参数）'].join('\n'),
          data: sorted.map((t) => ({ tag: t, count: tags[t].length, missing: tags[t].filter((m) => !filePaths.has(m)).length })),
        };
      }

      const members = tags[input.tag];
      if (!members) {
        return {
          message: `feature "${dsl.feature}" 无功能标记「${input.tag}」${viewTag}。现有标签：${[...names].sort().join(', ')}`,
          data: { tag: input.tag, members: [], found: [], missing: [] },
        };
      }
      const found = members.filter((m) => filePaths.has(m));
      const missing = members.filter((m) => !filePaths.has(m));
      const lines: string[] = [
        `══ feature "${dsl.feature}" 功能标记 tag="${input.tag}" ${viewTag} ══`,
        '',
        `  成员 ${members.length} 个 · **命中 ${found.length}** · **失联 ${missing.length}**`,
        '',
        '  成员（仓库相对路径）：',
      ];
      for (const m of found) lines.push(`    ✓ ${m}`);
      for (const m of missing) lines.push(`    ✗ ${m}  ← **失联**：未匹配到任何文件节点（该成员可能已改名/删除）`);
      if (missing.length) {
        lines.push(
          '',
          `  ★ 说明（**不许静默**）：上面 ${missing.length} 个成员**不算命中** —— 它们写进标记时的文件路径`,
          '    在**当前 DSL 里找不到任何文件节点**。这要么是文件被改名/删除，要么是标记时写错了路径。',
          '    ★ 本读数**可区分**：改名一个成员文件后，它会从"命中"落到"失联"（成员数不变、命中数减一）。',
        );
      }
      lines.push('', '  ★ 存储只有一个方向（tag → 成员）；"这个文件属哪些功能"由**反查**而得，不另存一份。');
      return {
        message: lines.join('\n'),
        data: { tag: input.tag, members, found, missing },
      };
    }

    default:
      // ★ 无参/错参给人话错误（不吐 `undefined`，也不抛 Node 原始异常）
      throw new Error(
        `未知 query 类型: ${String((input as { query?: unknown }).query ?? '') || '(未传)'}。` +
          `请传 query 参数（常用：dsl / features / nodes / edges / files / file / digest / calls / functions）。`,
      );
  }
}