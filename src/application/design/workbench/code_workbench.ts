/**
 * code_workbench —— 代码变更审批工作台（P3：把 P1/P2 能力接进可视化界面）
 *
 * 闭环：LLM / 前端提交「变更提案（propose，干跑只算预览）」
 *   → 人看一眼 UI 里的 diff → 通过（approve，真正落盘）或 驳回（reject，丢弃）。
 *
 * 接地层：
 *   - P1 rename_file（文件级智能重命名）：dry_run 只出影响面，不迁移/不改写；
 *      approve 时才真正 `renameFile` 执行迁移 + 全项目改写引用 + 重索引。
 *   - P2 edit_code op:'range'（显式行区间）：dry_run 走语法门不写盘；
 *     approve 时才真正写盘并重建索引。
 *   - dsl_intent（设计意图改写，why 侧）：propose 只算意图 diff 不写盘；
 *     approve 才调 setDesignIntent 把 goals / edge_intents 落进 overlay + base。
 *
 * 安全：
 *   - approve 时重新跑真实操作（非内存假执行），复用 edit_code 的语法门 /
 *     rename_file 的目标冲突阻断，行号漂移会报错上抛而非静默改错。
 *   - 行号漂移 / 目标已存在等执行失败 → 保留原提案并记录 lastError，不吞。
 *   - 变更按（project_dir）隔离存在 `<dataHome>/.agent-io/workbench/` 下。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getStorageRoot, getDSL, saveDSL } from '../../../infrastructure/storage.js';
import { loadOverlay, saveOverlay } from '../../../infrastructure/storage_overlay.js';
import { reconcileOverlay, buildCandidates, buildEdgeCandidates, seedOverlayFromDsl, applyOverlay, type OverlayGoal } from '../../../domain/overlay.js';
import { setDesignIntent, type DesignEdgeIntentWrite } from '../intent/set_design_intent.js';
import { renameFile, type RenameFileInput } from '../../refactor/rename/rename_file.js';
import { editCode, type EditCodeArgs } from '../../refactor/edit/edit_code.js';
// ★ 2026-10-20：闸读数的人读侧（唯一渲染处 = `gate_note.ts`；本文件**不自己拼豁免文案**）
import { gateHumanLines } from '../../refactor/gate_note.js';
import type { DesignDSL } from '../../../domain/types.js';

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export type ChangeKind = 'rename_file' | 'edit_code' | 'dsl_rename' | 'split_plan' | 'dsl_intent';

export interface ChangeOp {
  /** rename_file */
  from?: string;
  to?: string;
  /** edit_code */
  file?: string;
  op?: 'range';
  start?: number;
  end?: number;
  code?: string;
  /** dsl_rename：目标 feature + 数据名（= 产出节点 label）新旧名 + 产出节点 id */
  feature?: string;
  oldName?: string;
  newName?: string;
  producer?: string;
  /** split_plan：体检建议拆出的模块名 + 预估行数（落成文件顶部拆分标记注释） */
  suggested_name?: string;
  est_lines?: number;
  /** dsl_intent：设计意图改写（why 侧）。approve 时才调 setDesignIntent 落进 overlay+base */
  goals?: OverlayGoal[];
  edge_intents?: DesignEdgeIntentWrite[];
}

export type ChangeStatus = 'pending' | 'approved' | 'rejected' | 'executed';

export interface ChangeDiff {
  /** 目标展示文件（rename 为 "a → b"） */
  file: string;
  kind: 'replace' | 'rename';
  /** 变更前内容（行） */
  before: string[];
  /** 变更后内容（行） */
  after: string[];
  /** 影响面说明 / 区间穿透符号告警等 */
  note?: string;
}

/**
 * ★★★ **一条评审意见**（T186，2026-10-12）—— 支撑"**一个 Agent 定不了就开会**"。
 *
 * 规则：PR **不挂在"人的代码审批页面"上**，而是由**下一个接手的 Agent** 去确认；
 * **一个人确认不了就开会**（多个会话各留意见）。接手方打开时会看到"原有的设计之外还有新的 PR"，
 * 由它根据 PR 做新的决策。
 *
 * ⇒ 于是"评审"不再是一个人点一下，而是**一段可累积的意见流**：
 *   各会话各自留意见（`comment`），最后由**做出决定**的那个记下 `approve` / `reject`。
 *   ★ 这样一来"开了会"这件事**有据可查**（谁说支持、谁提了反对、谁拍的板），
 *     而不是只剩一个终态 —— 那正是本仓一贯的"**考古要靠留下的东西**"。
 */
export interface ChangeReview {
  /** ★ 评审者身份（会话 id / Agent 编号 / 系统名 / 用户名 —— 与 observe 侧 `reviewer` 同口径） */
  agent: string;
  /** comment=只留意见（会议中）；approve/reject=做决定 */
  verdict: 'comment' | 'approve' | 'reject';
  /** 意见正文（★ 会议的价值全在这里，别留空） */
  note?: string;
  at: string;
}

export interface PendingChange {
  id: string;
  kind: ChangeKind;
  project_dir: string;
  op: ChangeOp;
  label: string;
  summary: string[];
  diffs: ChangeDiff[];
  preview?: string;        // edit_code dry-run 的官方预览文本（带语法门结论）
  status: ChangeStatus;
  lastError?: string;
  result?: string;         // 执行成功后的结果文本
  submitted_at: string;
  decided_at?: string;
  /**
   * ★★★ **提议者身份**（谁提的这个 PR）—— T186 新增。
   *   ★★ 修的是一个**静默丢**：`ProposeInput.submitter` 此前**一直存在、调用方一直在传**
   *     （HTTP 的 `/api/code/propose`、`design_intent`、`llm_decider` 都传），
   *     而 `proposeChange` 组装 `PendingChange` 时**根本没把它写进去** ⇒ **收下就扔**。
   *   ★ 为什么它现在是**承重**的："确认人不能是提议人"这条守卫**要有它才判得了**。
   */
  submitter?: string;
  /** ★ 评审意见栈（会议记录，按时间追加）；最后一条 `approve`/`reject` 即决定 */
  reviews?: ChangeReview[];
  /** ★ 最终确认者身份（谁拍的板）—— 与 `decided_at` **同生共死**（写一个必写另一个） */
  reviewed_by?: string;
}

export interface ProposeInput {
  kind: ChangeKind;
  project_dir: string;
  op: ChangeOp;
  /** ★ 提议者身份（T186 起**真正落盘**；此前被接受后静默丢弃） */
  submitter?: string;
}

// ─────────────────────────────────────────────────────────────
// 存储（按 project_dir 隔离）
// ─────────────────────────────────────────────────────────────

function safeName(project_dir: string): string {
  const base = path.basename(path.resolve(project_dir)) || 'root';
  return base.replace(/[^A-Za-z0-9._-]/g, '_');
}

function storeFile(project_dir: string): string {
  const dir = path.join(getStorageRoot(), 'workbench');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safeName(project_dir)}.json`);
}

function loadChanges(project_dir: string): PendingChange[] {
  const f = storeFile(project_dir);
  if (!fs.existsSync(f)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveChanges(project_dir: string, changes: PendingChange[]): void {
  fs.writeFileSync(storeFile(project_dir), JSON.stringify(changes, null, 2), 'utf-8');
}

function nowIso(): string {
  return new Date().toISOString();
}

function uid(): string {
  return `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─────────────────────────────────────────────────────────────
// 行工具（与 edit_code 对齐：保留行尾、按文件换行风格归一）
// ─────────────────────────────────────────────────────────────

function splitKeepEnds(content: string): string[] {
  const lines = content.split(/(?<=\n)/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function normalizeLines(code: string, eol: string): string[] {
  const normalized = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = normalized.split('\n');
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts.map((l) => l + eol);
}

function detectEol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function absPath(project_dir: string, p: string): string {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(project_dir, p);
}

// ─────────────────────────────────────────────────────────────
// 预览生成
// ─────────────────────────────────────────────────────────────

function buildLabel(kind: ChangeKind, op: ChangeOp): string {
  if (kind === 'rename_file') return `移动/重命名文件 ${op.from ?? ''} → ${op.to ?? ''}`;
  if (kind === 'dsl_rename') return `数据名重命名 ${op.oldName ?? ''} → ${op.newName ?? ''}`;
  if (kind === 'split_plan') return `拆分提案 ${op.file ?? ''} → 拆出「${op.suggested_name ?? ''}」`;
  if (kind === 'dsl_intent') return `设计意图改写 ${op.feature ?? ''}（目标 ${op.goals?.length ?? 0} 条 · 边意图 ${op.edge_intents?.length ?? 0} 条）`;
  return `行区间编辑 ${op.file ?? ''} L${op.start}-L${op.end}`;
}

/** edit_code range：读当前文件，计算 before/after 块 + 调 edit_code dry_run 取官方预览与语法门结论 */
async function previewEditRange(project_dir: string, op: ChangeOp): Promise<{ diffs: ChangeDiff[]; preview: string }> {
  const file = op.file;
  if (!file || op.start == null || op.end == null || op.code == null) {
    throw new Error('edit_code 变更缺 file/start/end/code');
  }
  const abs = absPath(project_dir, file);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  const content = fs.readFileSync(abs, 'utf8');
  const eol = detectEol(content);
  const lines = splitKeepEnds(content);
  const total = lines.length;
  const start = op.start;
  const end = op.end;
  if (start < 1 || end < start || end > total) {
    throw new Error(`行区间越界：L${start}-L${end}/${total}（文件可能已漂移）`);
  }
  const startIdx = start - 1;
  const count = end - start + 1;
  const removed = lines.slice(startIdx, startIdx + count);
  const added = normalizeLines(op.code, eol);
  // 上下文（前 1 行 / 后 1 行）
  const beforeCtx = lines.slice(Math.max(0, startIdx - 1), startIdx);
  const afterCtx = lines.slice(startIdx + count, Math.min(lines.length, startIdx + count + 1));
  const before = [...beforeCtx, ...removed, ...afterCtx];
  const after = [...beforeCtx, ...added, ...afterCtx];
  const diffs: ChangeDiff[] = [
    {
      file: file,
      kind: 'replace',
      before,
      after,
      note: `${count} 行 → ${added.length} 行${startIdx > 0 || afterCtx.length > 0 ? '' : ''}`,
    },
  ];
  // 官方 dry-run（验证语法门 + 取区间穿透告警）
  const { editCode: ec } = await import('../../refactor/edit/edit_code.js');
  const dry = await ec(
    Object.assign({ project_dir, file, op: 'range', start, end, code: op.code, dry_run: true } as EditCodeArgs),
  );
  return { diffs, preview: dry.message };
}

/** split_plan：体检建议拆出 → 在文件顶部插入拆分标记注释（保留原首行），走同一语法门 */
function splitPlanMarker(op: ChangeOp): string {
  return `// SPLIT-PLAN: 建议拆出「${op.suggested_name ?? ''}」（~${op.est_lines ?? 0} 行）· 待人工执行拆分`;
}
async function previewSplitPlan(project_dir: string, op: ChangeOp): Promise<{ diffs: ChangeDiff[]; preview: string }> {
  const file = op.file;
  if (!file || !op.suggested_name) throw new Error('split_plan 变更缺 file/suggested_name');
  const abs = absPath(project_dir, file);
  if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  const content = fs.readFileSync(abs, 'utf8');
  const eol = detectEol(content);
  const lines = splitKeepEnds(content);
  if (!lines.length) throw new Error('空文件无法插入拆分标记');
  const head = lines[0].replace(/\r?\n$/, ''); // 保留原首行内容（去掉行尾，交给 normalizeLines 统一补）
  const code = splitPlanMarker(op) + eol + head;
  const start = 1, end = 1;
  const removed = lines.slice(0, 1);
  const added = normalizeLines(code, eol);
  const before = [...removed, ...lines.slice(1, 2)];
  const after = [...added, ...lines.slice(1, 2)];
  const diffs: ChangeDiff[] = [
    { file, kind: 'replace', before, after, note: `1 行 → ${added.length} 行（顶部插入拆分标记）` },
  ];
  // 官方 dry-run（验证语法门 + 区间穿透告警）
  const { editCode: ec } = await import('../../refactor/edit/edit_code.js');
  const dry = await ec(
    Object.assign({ project_dir, file, op: 'range', start, end, code, dry_run: true } as EditCodeArgs),
  );
  return { diffs, preview: dry.message };
}

/** rename_file：dry_run 取影响面，转成可视化 diff（from→to + 逐引用改写） */
async function previewRename(project_dir: string, op: ChangeOp): Promise<{ diffs: ChangeDiff[]; preview: string }> {
  if (!op.from || !op.to) throw new Error('rename_file 变更缺 from/to');
  const input: RenameFileInput = { project_dir, from: op.from, to: op.to, dry_run: true };
  const r = await renameFile(input);
  if (!r.ok && r.blocked?.length) {
    throw new Error('阻断：' + r.blocked.join('；'));
  }
  const diffs: ChangeDiff[] = [];
  if (r.references.length > 0 || r.pending.length > 0) {
    diffs.push({
      file: `${r.fromRel} → ${r.toRel}`,
      kind: 'rename',
      before: r.references.map((x) => `import ... from "${x.fromSource}"   // ${x.file}`),
      after: r.references.map((x) => `import ... from "${x.toSource}"   // ${x.file}`),
      note:
        `被移动文件 ${r.fromRel}；自动改写 ${r.editCount} 处引用` +
        (r.pending.length ? '；\n需人工复核：\n  - ' + r.pending.join('\n  - ') : ''),
    });
  } else {
    diffs.push({
      file: `${r.fromRel} → ${r.toRel}`,
      kind: 'rename',
      before: ['（无 import 引用被改写——目标为原地改名或包内引用）'],
      after: [],
      note: '仅移动文件本身，无跨文件引用需同步',
    });
  }
  const preview =
    `影响面：${r.editCount} 处引用改写\n` +
    r.references.map((x) => `  ${x.file}: "${x.fromSource}" → "${x.toSource}"`).join('\n') +
    (r.pending.length ? '\n需人工复核：\n  - ' + r.pending.join('\n  - ') : '');
  return { diffs, preview };
}

// ─────────────────────────────────────────────────────────────
// dsl_rename：数据名（= 产出节点 label）全图谱同步重命名
// 干跑只算影响面不写盘；approve 时真实改 DSL 并通过 saveDSL 广播。
// ─────────────────────────────────────────────────────────────

/** 一次重命名命中点 */
export interface DslRenameEdit {
  kind: 'node_label' | 'node_title' | 'edge_label';
  node?: string;
  edge?: string;
  from: string;
  to: string;
}

/**
 * 计算重命名影响面（纯读，不改 dsl）：
 * 1. 产出节点（op.producer 指定 id，或按 label 首匹配）label / title 命中 → 改名
 * 2. 引用该数据名的 flow 边（label === oldName）→ 同步
 */
export function collectDslRenameEdits(dsl: DesignDSL, op: ChangeOp): DslRenameEdit[] {
  const oldName = op.oldName ?? '';
  const newName = op.newName ?? '';
  if (!oldName || !newName || oldName === newName) return [];
  const nodes = dsl.geometry?.nodes ?? [];
  const edges = dsl.geometry?.edges ?? [];
  const edits: DslRenameEdit[] = [];

  // 产出节点：优先按 id，其次按 label 首匹配
  const producer = op.producer
    ? nodes.find((n) => n.id === op.producer)
    : nodes.find((n) => n.label === oldName);
  if (producer) {
    if (producer.label === oldName) edits.push({ kind: 'node_label', node: producer.id, from: oldName, to: newName });
    if (producer.title === oldName) edits.push({ kind: 'node_title', node: producer.id, from: oldName, to: newName });
  }
  // 引用边：凡是 label 承载该数据名的边（via）都同步改名
  for (const e of edges) {
    if (e.label === oldName) edits.push({ kind: 'edge_label', edge: e.id, from: oldName, to: newName });
  }
  return edits;
}

/** 真正把 edits 落到 dsl 对象上（approve 时用） */
export function applyDslRenameEdits(dsl: DesignDSL, edits: DslRenameEdit[]): number {
  let n = 0;
  for (const ed of edits) {
    if (ed.kind === 'node_label') {
      const node = (dsl.geometry?.nodes ?? []).find((x) => x.id === ed.node);
      if (node && node.label === ed.from) { node.label = ed.to; n++; }
    } else if (ed.kind === 'node_title') {
      const node = (dsl.geometry?.nodes ?? []).find((x) => x.id === ed.node);
      if (node && node.title === ed.from) { node.title = ed.to; n++; }
    } else if (ed.kind === 'edge_label') {
      const edge = (dsl.geometry?.edges ?? []).find((x) => x.id === ed.edge);
      if (edge && edge.label === ed.from) { edge.label = ed.to; n++; }
    }
  }
  return n;
}

/** dsl_rename 干跑：定位 DSL → 算影响面 → 转可视化 diff + 预览文本 */
async function previewDslRename(project_dir: string, op: ChangeOp): Promise<{ diffs: ChangeDiff[]; preview: string }> {
  const feature = op.feature;
  if (!feature) throw new Error('dsl_rename 变更缺 feature');
  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`DSL 不存在: feature "${feature}"（请先 import/save 该 feature）`);
  const edits = collectDslRenameEdits(dsl, op);
  if (edits.length === 0) {
    throw new Error(`在 feature "${feature}" 中找不到数据名「${op.oldName}」的产出节点或引用边`);
  }
  const labelEdits = edits.filter((e) => e.kind === 'node_label');
  const titleEdits = edits.filter((e) => e.kind === 'node_title');
  const edgeEdits = edits.filter((e) => e.kind === 'edge_label');
  const lines: string[] = [];
  if (labelEdits.length) lines.push(`产出节点 ${labelEdits[0].node}  label: "${op.oldName}" → "${op.newName}"`);
  if (titleEdits.length) lines.push(`产出节点 title: "${op.oldName}" → "${op.newName}"`);
  if (edgeEdits.length) lines.push(`引用边 ${edgeEdits.length} 条（via label）同步改名`);
  const before = [`数据名「${op.oldName}」定义于节点 ${labelEdits[0]?.node ?? op.producer ?? '（未定位）'}`];
  const after = [...lines];
  const diffs: ChangeDiff[] = [
    {
      file: `DSL · ${feature}`,
      kind: 'rename',
      before,
      after,
      note: `共 ${edits.length} 处同步：${labelEdits.length} 定义 + ${titleEdits.length} 标题 + ${edgeEdits.length} 引用边`,
    },
  ];
  const preview = `数据名「${op.oldName}」→「${op.newName}」\n` + lines.map((l) => '  ' + l).join('\n');
  return { diffs, preview };
}

/** dsl_rename 真改：定位 DSL → 算影响面 → 落盘 + 广播（source=mcp 触发浏览器刷新） */
async function executeDslRename(project_dir: string, op: ChangeOp): Promise<string> {
  const feature = op.feature;
  if (!feature) throw new Error('dsl_rename 变更缺 feature');
  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`DSL 不存在: feature "${feature}"`);
  const edits = collectDslRenameEdits(dsl, op);
  if (edits.length === 0) throw new Error(`找不到数据名「${op.oldName}」的产出节点或引用边`);
  const n = applyDslRenameEdits(dsl, edits);
  saveDSL(dsl, 'mcp');
  return `已重命名「${op.oldName}」→「${op.newName}」，同步 ${n}/${edits.length} 处（节点 label/title + 引用边），feature "${feature}" 已回写`;
}

/** dsl_intent 干跑：只读 overlay 算出"当前 why vs 将改 why"的可视化 diff + 预览文本，绝不写盘。
 *   approve 时才真正走 setDesignIntent 落进 overlay + base。 */
async function previewDslIntent(project_dir: string, op: ChangeOp): Promise<{ diffs: ChangeDiff[]; preview: string }> {
  const feature = op.feature;
  if (!feature) throw new Error('dsl_intent 变更缺 feature');
  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`DSL 不存在: feature "${feature}"（请先 save 该 feature）`);
  const overlay = loadOverlay(feature) ?? seedOverlayFromDsl(dsl);
  const { overlay: reconciled } = reconcileOverlay(overlay, buildCandidates(dsl), buildEdgeCandidates(dsl));
  const baseEdges = dsl.geometry?.edges ?? [];

  const before: string[] = [];
  const after: string[] = [];

  // 目标（goals）：全量替换
  const beforeGoals = reconciled.global?.goals ?? [];
  const afterGoals = op.goals;
  before.push(beforeGoals.length ? `目标（${beforeGoals.length}）:` : '目标：无');
  for (const g of beforeGoals) before.push(`  - ${g.title ?? '(无标题)'}${g.description ? `：${g.description}` : ''}`);
  if (afterGoals) {
    after.push(`目标（${afterGoals.length}，全量替换）:`);
    for (const g of afterGoals) after.push(`  - ${g.title ?? '(无标题)'}${g.description ? `：${g.description}` : ''}`);
  } else {
    after.push(`目标：不变`);
  }

  // 边意图
  const byId = new Map(baseEdges.map((e) => [e.id, e]));
  const byPair = new Map(baseEdges.map((e) => [`${e.from}\u0000${e.to}`, e]));
  const changed = reconciled.edges ?? {};
  const itents = op.edge_intents ?? [];
  if (itents.length) {
    before.push(`边意图（${itents.length} → 将写）:`);
    after.push(`边意图（${itents.length}）:`);
    for (const it of itents) {
      const edge = it.id ? byId.get(it.id) : it.from && it.to ? byPair.get(`${it.from}\u0000${it.to}`) : undefined;
      if (!edge) {
        before.push(`  - ${it.id ?? `${it.from}->${it.to}`}：未匹配到 base 边（不会写入）`);
        after.push(`  - ${it.id ?? `${it.from}->${it.to}`}：不匹配`);
        continue;
      }
      const prev = changed[edge.id];
      const label = `${it.id ?? `${edge.from}->${edge.to}`}`;
      before.push(`  - ${label}：${prev?.reason ?? '（无）'}${prev?.boundary ? ` ／${prev.boundary}` : ''}`);
      after.push(`  - ${label}：${it.reason ?? prev?.reason ?? '（无）'}${it.boundary ? ` ／${it.boundary}` : ''}`);
    }
  }

  const diffs: ChangeDiff[] = [{ file: `DSL意图 · ${feature}`, kind: 'replace', before, after, note: 'why 层改写（目标+边意图），approve 通过才落盘' }];
  const preview = `设计意图改写 · feature=${feature}\n` + [...before, '↓', ...after].map((l) => l).join('\n');
  return { diffs, preview };
}

/** dsl_intent 真写：approve 时调 setDesignIntent 落 overlay + base + saveDSL */
function executeDslIntent(project_dir: string, op: ChangeOp): string {
  const feature = op.feature;
  if (!feature) throw new Error('dsl_intent 变更缺 feature');
  const r = setDesignIntent({ feature, goals: op.goals, edge_intents: op.edge_intents });
  return r.message;
}

// ─────────────────────────────────────────────────────────────
// 提案 / 列表 / 审批 / 驳回
// ─────────────────────────────────────────────────────────────

export async function proposeChange(input: ProposeInput): Promise<{ change: PendingChange; ok: boolean; error?: string; duplicate?: boolean }> {
  const project_dir = path.resolve(input.project_dir);
  const op = input.op ?? {};
  try {
    let preview = '';
    let diffs: ChangeDiff[] = [];
    let summary: string[] = [];
    if (input.kind === 'edit_code') {
      const p = await previewEditRange(project_dir, op);
      preview = p.preview;
      diffs = p.diffs;
      summary = [`行区间编辑 ${op.file} L${op.start}-L${op.end}`, '语法门通过（干跑预览）'];
    } else if (input.kind === 'rename_file') {
      const p = await previewRename(project_dir, op);
      preview = p.preview;
      diffs = p.diffs;
      summary = [`移动/重命名 ${op.from} → ${op.to}`, `引用改写 ${diffs[0]?.after.length ?? 0} 处`];
    } else if (input.kind === 'dsl_rename') {
      const p = await previewDslRename(project_dir, op);
      preview = p.preview;
      diffs = p.diffs;
      const edgeN = diffs[0]?.note ?? '';
      summary = [`数据名重命名 ${op.oldName} → ${op.newName}`, edgeN, '干跑预览（未写盘）'];
    } else if (input.kind === 'split_plan') {
      // 去重：同一文件 + 同一拆出名 + 仍 pending 的提案已存在 → 直接返回已有（批量生成时避免刷屏/重复）
      const dup = loadChanges(project_dir).find((c) =>
        c.kind === 'split_plan' && c.status === 'pending'
        && c.op.file === op.file && c.op.suggested_name === op.suggested_name);
      if (dup) return { change: dup, ok: true, duplicate: true };
      const p = await previewSplitPlan(project_dir, op);
      preview = p.preview;
      diffs = p.diffs;
      summary = [`拆分提案 ${op.file}：建议拆出「${op.suggested_name ?? ''}」（~${op.est_lines ?? 0} 行）`, '语法门通过（干跑预览）'];
    } else if (input.kind === 'dsl_intent') {
      const p = await previewDslIntent(project_dir, op);
      preview = p.preview;
      diffs = p.diffs;
      summary = [`设计意图改写 ${op.feature ?? ''}`, `目标 ${op.goals?.length ?? 0} 条 · 边意图 ${op.edge_intents?.length ?? 0} 条`, '干跑预览（未写盘，approve 才落）'];
    } else {
      throw new Error(`未知变更类型: ${input.kind}`);
    }
    const change: PendingChange = {
      id: uid(),
      kind: input.kind,
      project_dir,
      op,
      label: buildLabel(input.kind, op),
      summary,
      diffs,
      preview,
      status: 'pending',
      submitted_at: nowIso(),
      // ★ T186：**把 submitter 真正落盘**（此前收下就扔 —— 见 `PendingChange.submitter` 的注释）。
      //   ★ 只有真给了才写键（不给就是"未署名"，**不编一个假身份**）。
      ...(input.submitter ? { submitter: input.submitter } : {}),
    };
    const all = loadChanges(project_dir);
    all.push(change);
    saveChanges(project_dir, all);
    return { change, ok: true };
  } catch (e) {
    return { change: {} as PendingChange, ok: false, error: (e as Error).message };
  }
}

export function listChanges(project_dir: string): PendingChange[] {
  const all = loadChanges(project_dir);
  return [...all].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
}

export function getChange(project_dir: string, id: string): PendingChange | undefined {
  return loadChanges(project_dir).find((c) => c.id === id);
}

function findAndUpdate(project_dir: string, id: string, fn: (c: PendingChange) => void): PendingChange | undefined {
  const all = loadChanges(project_dir);
  const c = all.find((x) => x.id === id);
  if (!c) return undefined;
  fn(c);
  saveChanges(project_dir, all);
  return c;
}

export interface ApproveResult {
  ok: boolean;
  status: ChangeStatus;
  result?: string;
  error?: string;
  /**
   * ★★ **不是错误、但必须说出来的话**（T186）—— 目前只有一种：**"不许自批"这条守卫判不了**
   *   （历史提案没记 `submitter`）。
   *   ★ 为什么单列一个字段而不是塞进 `result`：★ **不静默** —— 调用方拿到 `ok:true` 时
   *     若不知道"这条守卫没判成"，就会把"放行"读成"**判过了且通过**"（本仓最忌的假绿灯）。
   */
  warning?: string;
}

/**
 * ★★★ **评审者身份的校验与"不许自批"守卫**（T186）—— **唯一判据**（approve / reject / comment 三处共用）。
 *
 * ## 为什么必须有这一条（★ 这是本仓**记过账**的理由，别丢）
 * `serve.ts:1740-1743` 逐字写着当初**为什么不**把审批做成 MCP 工具：
 *   *"为什么开在 HTTP 而不是 MCP 工具：审批的语义是「**谁**批准了这条声明」……
 *     做成 MCP 工具会退化成「**agent 批准自己的提案**」，语义弱。"*
 * ⇒ ★ 用户 2026-10-12 的方向（**由下一个接手的 Agent 确认**）**恰好解掉这个结**：
 *   确认人**本来就不是提议人** ⇒ ★ 于是那条"语义会退化"的顾虑**变成了一条可判定的守卫**：
 *   **提议人 ≠ 确认人**。⇒ 这条守卫就是"把原来的保护留下来"的形态，**不是新增的障碍**。
 *
 * ## 三条判据（★ 逐条都可判定）
 * 1. ★ **身份必填**（与 observe 侧 `reviewer` 同口径）—— 审计链不能有空。
 * 2. ★★ **不许自批**：`submitter` 已知且**等于** reviewer ⇒ 拒。
 * 3. ★ **提议人未知时不假装判过**：返回里**明写"判不了"**，让调用方看得见
 *    （★ 不许静默放行 —— 那正是本仓"假绿灯"）。
 */
export function checkReviewer(
  c: Pick<PendingChange, 'submitter'>,
  reviewer: string,
): { ok: true; selfReviewUnjudged?: string } | { ok: false; error: string } {
  const who = reviewer.trim();
  if (!who) {
    return {
      ok: false,
      error:
        '缺少 reviewer：评审必须声明身份（会话 id / Agent 编号 / 系统名 / 用户名）。' +
        '★ 审计链不能有空 —— 与 observe 侧 `/api/observe/proposals/approve` 同口径。',
    };
  }
  if (c.submitter) {
    if (c.submitter.trim() === who) {
      return {
        ok: false,
        error:
          `**不许自批**：提议人与确认人都是「${who}」。` +
          '★ 这个 PR 闸门的全部意义就是"**另一个人**来看一遍"（用户 2026-10-12 裁定：由**下一个接手的 Agent** 确认）。' +
          '⇒ 请换一个会话/Agent 来确认；一个 Agent 拿不准就**开会**：' +
          '让别的会话先用 `verdict=comment` 留意见，再由某个会话做决定。',
      };
    }
    return { ok: true };
  }
  // ★ 提议人未知（历史提案 / 调用方没署名）⇒ **判不了自批**，但**必须说出来**
  return {
    ok: true,
    selfReviewUnjudged:
      '★ 本提案**没有记录提议人**（`submitter` 为空 —— 多为 T186 之前落的历史提案）' +
      '⇒ "不许自批"这条守卫**判不了**（不是"判过且通过"）。如果是你提的，请换人/换会话确认。',
  };
}

/** ★ 追加一条评审意见（会议记录）。**不改变状态** —— 定不定由 `approve`/`reject` 说。 */
export function addReview(
  project_dir: string,
  id: string,
  review: { agent: string; verdict: ChangeReview['verdict']; note?: string },
): { ok: boolean; error?: string; reviews: ChangeReview[] } {
  const dir = path.resolve(project_dir);
  const c = loadChanges(dir).find((x) => x.id === id);
  if (!c) return { ok: false, error: '变更不存在', reviews: [] };
  if (c.status === 'executed' || c.status === 'rejected') {
    return { ok: false, error: `该变更已 ${c.status}，不再接受意见（会议已散）`, reviews: c.reviews ?? [] };
  }
  const who = review.agent.trim();
  if (!who) return { ok: false, error: '缺少 agent：留意见也必须署名', reviews: c.reviews ?? [] };
  const entry: ChangeReview = {
    agent: who,
    verdict: review.verdict,
    ...(review.note ? { note: review.note } : {}),
    at: nowIso(),
  };
  const updated = findAndUpdate(dir, id, (x) => {
    x.reviews = [...(x.reviews ?? []), entry];
  });
  return { ok: true, reviews: updated?.reviews ?? [] };
}

/**
 * ★ **只在意见栈里记一笔**（不改状态、不写 `reviewed_by`）—— 用于"批了，但执行可能被阻断"的场景。
 *   ★★ 为什么与 `reviewed_by` 分开：`reviewed_by` 的语义是"**谁拍的板**"，
 *     它必须与 `decided_at` **同生共死**（决定真落地了才写）。
 *     ★ 若在"刚说要批"时就写上，而执行**被阻断**（变更退回 `pending`）
 *     ⇒ 会留下一个**"有人拍过板、但这条还挂着"的假终态** ⇒ 读端会误判。
 *     ★ 而`reviews[]` 记的是"**意见发生过**"—— 那件事**真的发生了**，不该抹掉。
 */
function pushReview(c: PendingChange, reviewer: string, verdict: ChangeReview['verdict'], note?: string): void {
  c.reviews = [...(c.reviews ?? []), { agent: reviewer, verdict, ...(note ? { note } : {}), at: nowIso() }];
}

/**
 * 审批执行。★ 写闸说明（为什么这里没有索引写穿代码）：
 * 本函数所有真实源码写入都委托给**已接闸**的执行器 —— rename_file→renameFile（自带
 * syncFile+reopenAndResolveAfterWrite）、split_plan/edit_code→editCode（5 处写穿点）；
 * dsl_rename/dsl_intent 只改设计画布 store（.agent-io 下的 DSL/提案 JSON，非源码，
 * 索引不覆盖）。⇒ 索引保鲜由被委托方保证，这里不需要（也不得重复）写穿。
 */
export async function approveChange(project_dir: string, id: string, reviewer: string): Promise<ApproveResult> {
  project_dir = path.resolve(project_dir);
  const c0 = loadChanges(project_dir).find((x) => x.id === id);
  const c = c0;
  if (!c) return { ok: false, status: 'pending', error: '变更不存在' };
  if (c.status === 'executed') return { ok: false, status: 'executed', error: '该变更已执行，勿重复审批' };
  if (c.status === 'rejected') return { ok: false, status: 'rejected', error: '该变更已驳回' };

  // ★★★ T186：**确认人是谁** + **不许自批**（判据一处 = `checkReviewer`，与 reject/comment 共用）
  const gate = checkReviewer(c, reviewer);
  if (!gate.ok) return { ok: false, status: c.status, error: gate.error };
  const who = reviewer.trim();
  // ★★ T186：**必须被说出来的话**（"自批守卫判不了"）—— ★ 只挂在 `ok:true` 的返回上，
  //   因为只有"放行"才会被误读成"判过了且通过"。（被拒的那条自带更好的解释。）
  const warn: ApproveResult = gate.selfReviewUnjudged
    ? ({ warning: gate.selfReviewUnjudged } as ApproveResult)
    : ({} as ApproveResult);
  // ★ 先记一笔"这个会话批了"（会议记录）—— ★ 即使下面被阻断，这笔也**真实发生过**，不该抹掉
  //   ★★ 注意这里**只记意见、不写 `reviewed_by`**：决定真落地了才写（见 `pushReview` 的注释）。
  findAndUpdate(project_dir, id, (x) => pushReview(x, who, 'approve'));

  try {
    if (c.kind === 'rename_file') {
      const r = await renameFile({ project_dir: c.project_dir, from: c.op.from!, to: c.op.to! });
      const rblocked = r.blocked ?? [];
      if (!r.ok && rblocked.length) {
        findAndUpdate(project_dir, id, (x) => {
          x.lastError = '阻断：' + rblocked.join('；');
          x.status = 'pending';
        });
        return { ok: false, status: 'pending', error: '阻断：' + rblocked.join('；') };
      }
      // ★★★ 2026-10-20：本文件**自己拼 result 字符串**（不是 `wrap()` 转发回执），所以闸的读数必须**显式**拼进来 ——
      //   否则 `renameFile` 回执里的 `task_gate`（含“本次写入 X 被豁免”）就在这一行丢掉。
      const base = `已移动 ${r.fromRel} → ${r.toRel}，改写 ${r.editCount} 处引用，重建索引`;
      const gateLine = gateHumanLines(r.task_gate);
      // ★ 闸读数进**存进台账的** result（`review_changes action=show/approve` 读的就是这一条，不是另拼一份）
      const result = gateLine ? `${base}\n${gateLine}` : base;
      findAndUpdate(project_dir, id, (x) => {
        x.result = result;
        x.lastError = undefined;
        x.status = 'executed';
        x.decided_at = nowIso();
        x.reviewed_by = who;
      });
      return { ...warn, ok: true, status: 'executed', result };
    }

    if (c.kind === 'dsl_rename') {
      const result = await executeDslRename(c.project_dir, c.op);
      findAndUpdate(project_dir, id, (x) => {
        x.result = result;
        x.lastError = undefined;
        x.status = 'executed';
        x.decided_at = nowIso();
        x.reviewed_by = who;
      });
      return { ...warn, ok: true, status: 'executed', result };
    }

    // dsl_intent：approve 才真写设计意图到 overlay + base
    if (c.kind === 'dsl_intent') {
      const result = executeDslIntent(c.project_dir, c.op);
      findAndUpdate(project_dir, id, (x) => {
        x.result = result;
        x.lastError = undefined;
        x.status = 'executed';
        x.decided_at = nowIso();
        x.reviewed_by = who;
      });
      return { ...warn, ok: true, status: 'executed', result };
    }

    // split_plan：approve 时在文件顶部插入拆分标记（保留原首行）
    if (c.kind === 'split_plan') {
      const file = c.op.file!;
      const abs = absPath(c.project_dir, file);
      const content = fs.readFileSync(abs, 'utf8');
      const eol = detectEol(content);
      const lines = splitKeepEnds(content);
      const head = lines[0]?.replace(/\r?\n$/, '') ?? '';
      const code = splitPlanMarker(c.op) + eol + head;
      const res = await editCode({
        project_dir: c.project_dir,
        file,
        op: 'range',
        start: 1,
        end: 1,
        code,
      } as EditCodeArgs);
      findAndUpdate(project_dir, id, (x) => {
        x.result = res.message;
        x.lastError = undefined;
        x.status = 'executed';
        x.decided_at = nowIso();
        x.reviewed_by = who;
      });
      return { ...warn, ok: true, status: 'executed', result: res.message };
    }

    // edit_code range
    const res = await editCode({
      project_dir: c.project_dir,
      file: c.op.file!,
      op: 'range',
      start: c.op.start!,
      end: c.op.end!,
      code: c.op.code!,
    } as EditCodeArgs);
    findAndUpdate(project_dir, id, (x) => {
      x.result = res.message;
      x.lastError = undefined;
      x.status = 'executed';
      x.decided_at = nowIso();
      x.reviewed_by = who;
    });
    return { ...warn, ok: true, status: 'executed', result: res.message };
  } catch (e) {
    findAndUpdate(project_dir, id, (x) => {
      x.lastError = (e as Error).message;
      x.status = 'pending'; // 执行失败，保留提案待改
    });
    return { ok: false, status: 'pending', error: (e as Error).message };
  }
}

export function rejectChange(project_dir: string, id: string, reviewer: string): ApproveResult {
  project_dir = path.resolve(project_dir);
  const c = loadChanges(project_dir).find((x) => x.id === id);
  if (!c) return { ok: false, status: 'pending', error: '变更不存在' };
  if (c.status === 'executed') return { ok: false, status: 'executed', error: '已执行，无法驳回' };

  // ★★★ T186：驳回**同样**要自报身份，且**同样不许自己驳自己**（判据一处 = `checkReviewer`）
  const gate = checkReviewer(c, reviewer);
  if (!gate.ok) return { ok: false, status: c.status, error: gate.error };
  const who = reviewer.trim();
  // ★ 同 `approveChange`：**判不了的话必须说出来**（否则"放行"会被读成"判过了且通过"）
  const warn: ApproveResult = gate.selfReviewUnjudged
    ? ({ warning: gate.selfReviewUnjudged } as ApproveResult)
    : ({} as ApproveResult);

  findAndUpdate(project_dir, id, (x) => {
    pushReview(x, who, 'reject');
    x.status = 'rejected';
    x.decided_at = nowIso();
    x.reviewed_by = who;
  });
  return { ...warn, ok: true, status: 'rejected', result: '已驳回，未写盘' };
}