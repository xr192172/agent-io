/**
 * refactor_plan —— 「先算清单 → 预览 → 批量落盘」的 [B] 层（规划书 §16.3 P-C / §19 三明治）
 *
 * 缺口（P-C 原文）：
 *   > 本次我只能在 MCP **外面**自己写 driver（fs 读 → 算 old/new → 循环调用）——
 *   > 而"**算清单**"恰恰是最该由工具体内完成的部分（它掌握索引与 AST）。
 * ⇒ 本模块把「算清单」（`buildRefactorPlan`，只读）与「按清单落盘」（`applyRefactorPlan`）做成**一对**：
 *   清单**可审**（每项 file/old/new/命中级别 + diff 预览 + 汇总）、**可复跑**（plan_id 由内容派生，
 *   不含运行时状态）、**可入账**（结构化 JSON，可落盘/回传）。
 *
 * ★ 不复用就违背本仓纪律（同一件事不许两份实现）——本模块**只做编排**，落地一律复用：
 *   · 定位 + 语法门：`planReplaceText`（`edit_code.ts` 的单文件/批量**共用**实现，P-B 已抽）；
 *   · 落盘 + 快照 + 索引写穿 + 逐项回报：`editCode({ targets })`（P-B 的批量编排**唯一实现**）。
 *
 * ★ 幂等（判据"重复 apply 幂等"）是怎么保证的：
 *   apply 对每一项先问"**现在这一项还该不该改**"，而不是无脑重放 old→new：
 *   ① 该文件当前内容里 `old` 仍唯一命中 ⇒ pending（真改）；
 *   ② `old` 已不在、而 `new` 唯一命中 ⇒ already_applied（**不写盘**，报 already_applied）；
 *   ③ 两者都不成立 ⇒ failed（源已被别处改过，绝不猜）。
 *   ⇒ 第二次 apply 同一份清单：全部落到 ② ⇒ ok=true / written=false / 文件字节不变。
 *
 * ★ 篡改检出：`plan_id` = sha256(canonical{items(file/old/new 按序) + files(file/base_fingerprint)}).
 *   apply 前**重算**并与声明的 plan_id 比对，不符即抛（改 old/new/顺序/base_fingerprint/增删项都会变）。
 *   ★ 诚实边界：diff 预览（`preview`）**不参与** plan_id（它是展示文本，不是执行输入）——
 *     篡改预览不会被本指纹抓到（但预览不影响落盘结果）。
 *
 * ★ 只读：`buildRefactorPlan` 不写任何文件（不写源码、不写清单文件），只读盘 + 返回结构化清单。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { detectEol } from '../../../infrastructure/parse/line_utils.js';
import { locateReplaceText } from '../../../infrastructure/parse/fuzzy_match.js';
import { planReplaceText, editCode, type EditBatchItem } from '../rf-edit/edit_code.js';

/** 一次目标替换：文件内一次**唯一**文本替换（与 `edit_code(targets[])` 同形状） */
export interface RefactorTarget {
  file: string;
  old_text: string;
  new_text: string;
}

/** 命中位置与级别（与 `edit_code` 的 `hit` 同口径） */
export interface PlanHit {
  level: number;
  label: string;
  start_line: number;
  old_lines: number;
  new_lines: number;
}

/** 清单的一项 */
export interface RefactorPlanItem {
  /** 相对 project_dir 的路径（正斜杠，展示/入账口径） */
  file: string;
  /** 规划时的旧文本（= 调用方传入的 old_text；非逐字命中时以预览为准） */
  old: string;
  /** 规划时的新文本 */
  new: string;
  hit: PlanHit;
  /** diff 预览（"-" 侧为实际命中的文件片段）—— 展示用，不参与 plan_id */
  preview: string;
}

/** 规划时的源文件快照指纹（入账/审计用；也参与 plan_id） */
export interface RefactorPlanFile {
  file: string;
  /** 规划时刻文件内容的 sha256（前 16 hex） */
  base_fingerprint: string;
  /**
   * 把**本文件全部清单项都应用后**的内容指纹（前 16 hex）。
   * ★ 幂等快路径：apply 时若当前内容指纹 == post_fingerprint ⇒ 该文件的项**全部已应用**
   *   （即使同一文件有多项链式替换 A→B→C，也能整文件判"已应用"，不靠逐项猜）。
   */
  post_fingerprint: string;
}

export interface RefactorPlan {
  schema: 'refactor_plan/1';
  /** 由内容派生的稳定指纹（可复跑：同输入同源 ⇒ 同 plan_id） */
  plan_id: string;
  items: RefactorPlanItem[];
  files: RefactorPlanFile[];
  summary: { items: number; files: number; by_level: Record<string, number> };
}

const SCHEMA = 'refactor_plan/1' as const;

/** 内容指纹（sha256 前 16 hex；与 G8 的 `<HASH>` 归一化口径一致） */
function fingerprint(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

function relOf(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).split(path.sep).join('/');
}

/**
 * plan_id：**只**覆盖"执行输入"——items 的 {file,old,new}（**按序**，同文件多项的顺序会影响结果）
 * 与 files 的 {file,base_fingerprint,post_fingerprint}（按 file 名排序，与列举顺序无关）。
 * ★ 不含 summary/preview（派生/展示），也不含 project_dir（绝对路径 ⇒ 换机器会变，破坏可复跑）。
 */
export function computePlanId(plan: Pick<RefactorPlan, 'schema' | 'items' | 'files'>): string {
  const payload = {
    schema: plan.schema,
    items: plan.items.map((i) => ({ file: i.file, old: i.old, new: i.new })),
    files: [...plan.files]
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((f) => ({ file: f.file, base_fingerprint: f.base_fingerprint, post_fingerprint: f.post_fingerprint })),
  };
  return fingerprint(JSON.stringify(payload));
}

/**
 * [B] 算清单（**只读**，不写任何文件）。
 *
 * 纪律（§21）：收显式参数；产物是结构化数据；**失败就抛**——清单必须是"全部可执行"的，
 * 任一项规划不出来（old_text 不在/歧义/新引入语法错误）⇒ 抛错并把每一项的失败原因列全，
 * **不产出半成品清单**（半成品 apply 时必然失败，等于把错推给下一环）。
 * `targets` 为空 ⇒ 产出一份**显式空清单**（items=[]，不是静默降级：summary.items=0 说得很清楚）。
 */
export async function buildRefactorPlan(args: {
  project_dir: string;
  targets: RefactorTarget[];
}): Promise<RefactorPlan> {
  const projectRoot = path.resolve(args.project_dir);
  const targets = args.targets ?? [];

  const items: RefactorPlanItem[] = [];
  const virtual = new Map<string, string>(); // abs → 累积内容（同文件多项按序叠加）
  const baseFp = new Map<string, string>(); // abs → 规划时刻磁盘内容指纹
  const failures: string[] = [];

  for (const [i, t] of targets.entries()) {
    let rel = '';
    try {
      if (!t || typeof t.file !== 'string' || t.file.trim() === '') throw new Error('缺 file');
      const absPath = path.isAbsolute(t.file) ? t.file : path.resolve(projectRoot, t.file);
      rel = relOf(projectRoot, absPath);
      if (typeof t.old_text !== 'string' || t.old_text.length === 0) throw new Error('缺 old_text（要替换的唯一旧文本）');
      if (typeof t.new_text !== 'string') throw new Error('缺 new_text（传空串=删除该文本）');
      if (!fs.existsSync(absPath)) throw new Error(`文件不存在: ${absPath}`);
      if (!baseFp.has(absPath)) baseFp.set(absPath, fingerprint(fs.readFileSync(absPath, 'utf8')));
      const cur = virtual.get(absPath) ?? fs.readFileSync(absPath, 'utf8');
      const plan = await planReplaceText(absPath, cur, detectEol(cur), t.old_text, t.new_text);
      virtual.set(absPath, plan.newContent);
      items.push({ file: rel, old: t.old_text, new: t.new_text, hit: plan.hit, preview: plan.preview });
    } catch (e) {
      failures.push(`  · ${rel || t?.file || `targets[${i}]`}：${(e as Error).message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `plan_refactor：${failures.length}/${targets.length} 项无法规划 ⇒ 不产出清单（清单必须"全部可执行"）：\n` +
        failures.join('\n'),
    );
  }

  const files: RefactorPlanFile[] = [...baseFp.entries()]
    .map(([abs, fp]) => ({
      file: relOf(projectRoot, abs),
      base_fingerprint: fp,
      post_fingerprint: fingerprint(virtual.get(abs) ?? ''),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  const by_level: Record<string, number> = {};
  for (const it of items) {
    const k = String(it.hit.level);
    by_level[k] = (by_level[k] ?? 0) + 1;
  }

  const draft = { schema: SCHEMA, items, files };
  return {
    ...draft,
    plan_id: computePlanId(draft),
    summary: { items: items.length, files: files.length, by_level },
  };
}

export type ApplyItemStatus = 'applied' | 'already_applied' | 'failed';

export interface ApplyPlanItemResult {
  file: string;
  status: ApplyItemStatus;
  hit?: PlanHit;
  symbol_diff?: { added: number; removed: number; changed: number };
  index_synced?: string;
  error?: string;
}

export interface ApplyPlanResult {
  ok: boolean;
  plan_id: string;
  /** 本次是否真有任何文件被写盘（幂等重放 / 空清单 / 全冲突 ⇒ false） */
  written: boolean;
  items: ApplyPlanItemResult[];
  total: number;
  applied: number;
  already_applied: number;
  failed: number;
  atomic: boolean;
}

type Decision =
  | { kind: 'pending'; hit: PlanHit }
  | { kind: 'already_applied' }
  | { kind: 'failed'; error: string };

/**
 * [B] 按清单落盘（幂等；复用 `editCode(targets[])` 的**唯一落地路径**）。
 *
 * 流程：① 校验 plan_id（篡改/缺损 ⇒ 抛）→ ② 逐项决策 pending/already_applied/failed
 *      → ③ 只把 pending 项交给 `editCode` 落盘（写闸/快照/索引写穿/逐项回报全复用）。
 * `atomic=true` 语义与 `edit_code(targets[])` 一致：任一项失败则**整批 pending 不落盘**。
 */
export async function applyRefactorPlan(args: {
  project_dir: string;
  plan: RefactorPlan;
  atomic?: boolean;
}): Promise<ApplyPlanResult> {
  const projectRoot = path.resolve(args.project_dir);
  const plan = args.plan;
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.items) || !Array.isArray(plan.files)) {
    throw new Error('apply_refactor_plan 需要 plan（plan_refactor 的产物：{schema, plan_id, items, files, summary}）');
  }
  if (plan.schema !== SCHEMA) {
    throw new Error(`plan.schema 不支持：${String((plan as { schema?: unknown }).schema)}（期望 ${SCHEMA}）`);
  }
  const expected = computePlanId(plan);
  if (expected !== plan.plan_id) {
    throw new Error(
      `清单指纹不符（plan_id 被篡改或缺损）：声明 ${String(plan.plan_id)}，实算 ${expected}。` +
        '清单必须逐字使用 plan_refactor 的产物（改 old/new/顺序/base_fingerprint 都会变指纹）。',
    );
  }
  const atomic = args.atomic === true;

  // ── ② 逐项决策（不落盘；复用 planReplaceText 的定位 + 语法门）──
  // 先按**文件级指纹**定整文件状态（幂等快路径；同文件链式多项也能整文件判"已应用"）：
  //   当前 == post_fingerprint ⇒ 该文件的项全部已应用；当前 == base_fingerprint ⇒ 全部待改；否则逐项判。
  const fileState = new Map<string, 'applied' | 'untouched' | 'unknown'>();
  for (const f of plan.files) {
    try {
      const cur = fs.readFileSync(path.resolve(projectRoot, f.file), 'utf8');
      const fp = fingerprint(cur);
      fileState.set(f.file, fp === f.post_fingerprint ? 'applied' : fp === f.base_fingerprint ? 'untouched' : 'unknown');
    } catch {
      fileState.set(f.file, 'unknown');
    }
  }

  const virtual = new Map<string, string>();
  const decisions: Decision[] = [];
  for (const it of plan.items) {
    if (fileState.get(it.file) === 'applied') {
      decisions.push({ kind: 'already_applied' });
      continue;
    }
    const absPath = path.resolve(projectRoot, it.file);
    let cur: string;
    try {
      cur = virtual.get(absPath) ?? fs.readFileSync(absPath, 'utf8');
    } catch (e) {
      decisions.push({ kind: 'failed', error: `读取失败: ${(e as Error).message}` });
      continue;
    }
    try {
      const p = await planReplaceText(absPath, cur, detectEol(cur), it.old, it.new);
      virtual.set(absPath, p.newContent); // 同文件后续项基于"本轮已应用"的内容决策
      decisions.push({ kind: 'pending', hit: p.hit });
    } catch (planErr) {
      // 规划不出来：区分"已应用"（old 没了、new 在）与"真冲突"
      const locOld = locateReplaceText(cur, it.old);
      const locNew = locateReplaceText(cur, it.new);
      if (!locOld.match && locNew.match) decisions.push({ kind: 'already_applied' });
      else decisions.push({ kind: 'failed', error: (planErr as Error).message });
    }
  }

  // ── ③ 只把 pending 交给 edit_code 的批量落地（唯一实现）──
  const pendingTargets: RefactorTarget[] = [];
  const pendingAt: number[] = [];
  plan.items.forEach((it, i) => {
    if (decisions[i].kind === 'pending') {
      pendingTargets.push({ file: it.file, old_text: it.old, new_text: it.new });
      pendingAt.push(i);
    }
  });

  let landed: EditBatchItem[] = [];
  let wrote = false;
  // ★ atomic 的"全成或全不成"必须覆盖**决策期**的失败（冲突/读不到）：有这类失败 ⇒ 一件也不落盘。
  const blockedByAtomic = atomic && decisions.some((d) => d.kind === 'failed');
  if (pendingTargets.length > 0 && !blockedByAtomic) {
    // ★ 复用 edit_code 的批量落地路径（唯一实现）。targets 非空时 file/op 被批量分支忽略
    //   （见 EditCodeArgs 的 targets 说明），此处仅为满足类型：给占位值。
    const r = await editCode({
      project_dir: projectRoot,
      file: '',
      op: 'replace_text',
      targets: pendingTargets,
      atomic,
    });
    landed = r.data.items ?? [];
    wrote = r.data.written === true;
  }
  const landedIdxOf = new Map<number, number>();
  pendingAt.forEach((planIdx, k) => landedIdxOf.set(planIdx, k));

  // ── 合并逐项结果（按原清单顺序）──
  const items: ApplyPlanItemResult[] = plan.items.map((it, i) => {
    const d = decisions[i];
    if (d.kind === 'already_applied') return { file: it.file, status: 'already_applied' };
    if (d.kind === 'failed') return { file: it.file, status: 'failed', error: d.error };
    if (blockedByAtomic) {
      return { file: it.file, status: 'failed', error: '因 atomic=true 且有失败项 ⇒ 整批未落盘' };
    }
    const li = landed[landedIdxOf.get(i)!];
    if (!li) return { file: it.file, status: 'failed', error: '未收到落地回报（内部不一致）' };
    if (!li.ok) return { file: it.file, status: 'failed', error: li.error ?? '未知失败' };
    if (!li.written) {
      return { file: it.file, status: 'failed', error: '因 atomic=true 且有失败项 ⇒ 整批未落盘' };
    }
    return {
      file: it.file,
      status: 'applied',
      ...(li.hit ? { hit: li.hit } : {}),
      ...(li.symbol_diff ? { symbol_diff: li.symbol_diff } : {}),
      ...(li.index_synced ? { index_synced: li.index_synced } : {}),
    };
  });

  const applied = items.filter((x) => x.status === 'applied').length;
  const already_applied = items.filter((x) => x.status === 'already_applied').length;
  const failed = items.filter((x) => x.status === 'failed').length;

  return {
    ok: failed === 0,
    plan_id: plan.plan_id,
    written: wrote,
    items,
    total: items.length,
    applied,
    already_applied,
    failed,
    atomic,
  };
}
