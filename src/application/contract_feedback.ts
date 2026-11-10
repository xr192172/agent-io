/**
 * contract_feedback —— **第二刀：差异报告自动回传**（用户拍板"引擎化"的核心步）。
 *
 * ## 它做什么
 * 写源码工具成功落盘后，自动跑**受影响契约**（增量 judge）+ 返回人读摘要——
 * 模型改完立刻看到"哪些契约绿了/红了/设计漂了"，不用记得调 verify/judge-all。
 *
 * ## 范围控制（不全量 90s）
 * `planInheritance` 用 `writtenRels` 作为 changed 集 → 证据观察面 ∩ 改动集 ⇒ 只跑受影响子集
 * （全量 ~800 条，改一个文件通常影响 3-5 条 ⇒ 秒级）。
 * · snapshot 不存在 ⇒ 如实报"没有基线"（不造判据、不报全绿）；
 * · snapshot 存在但观察面零交集 ⇒ 如实报"0 条受影响"（改了无关文件不是契约问题）。
 *
 * ## 覆盖面（lead 裁定）
 * edit_code + rename 系 + move 系 + apply_refactor_plan + deprecate_offline + annotate_functions
 * —— 都走 `openSourceWrite`（source_writer 收口）。observe_instrument **不接**（探针注入不是语义改动）。
 *
 * ## 写回（合并三纪律，与 judge-all 写回同源）
 * 撤销旧绿（本次 fail/unsupported 的旧 pass 条目删掉）+ 本次 verdict 写入 + 未跑条目原样保留。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  loadVerifiedSnapshot,
  writeVerifiedSnapshot,
  SNAPSHOT_SCHEMA,
  SNAPSHOT_REL,
  type SnapshotLoad,
} from './design/verified_snapshot.js';
import { planInheritance } from './design/verified_snapshot.js';
import { judgeExpectations } from './design/intent/expectations.js';
import { collectExpectations } from '../domain/expectation.js';
import type { DesignDSL } from '../domain/types.js';

export interface ContractFeedbackResult {
  /** 命中了基线（false = 没有基线 ⇒ 如实报，不造判据） */
  hasBaseline: boolean;
  /** 受影响契约条数（0 = 观察面零交集，改了无关文件） */
  affected: number;
  /** 判定读数 */
  green: Array<{ id: string; detail: string }>;
  red: Array<{ id: string; detail: string }>;
  unsupported: Array<{ id: string; detail: string }>;
  /** 基线是否已写回 */
  baselineWritten: boolean;
  /** 人读摘要（追加到回执尾部） */
  rendered: string;
}

/** 从 expectation 提取观察面（仓库相对路径列表） */
function observesOf(exp: Record<string, unknown>): string[] {
  return [...new Set(
    [exp.path, exp.from, exp.to]
      .filter((x): x is string => typeof x === 'string')
      .map((p) => p.replace(/\\/g, '/')),
  )];
}

/** 从 expectation 提取符号（qualified_name 列表） */
function symbolsOf(exp: Record<string, unknown>): string[] {
  return [exp.symbol, exp.from, exp.to, exp.target].filter((x): x is string => typeof x === 'string');
}

/**
 * **契约反馈**——写源码 handler 的成功路径调用。
 *
 * @param root      项目根（绝对路径）
 * @param written   本次落盘的仓库相对路径列表（posix）
 * @param dsl       当前设计册（用于 collectExpectations）
 * @param feature   feature 名（写回时用）
 */
export async function contractFeedback(
  root: string,
  written: readonly string[],
  dsl: DesignDSL | null,
  feature: string,
): Promise<ContractFeedbackResult> {
  const empty: ContractFeedbackResult = {
    hasBaseline: false, affected: 0, green: [], red: [], unsupported: [], baselineWritten: false,
    rendered: '\n── 契约反馈 ──\n  · 没有基线（verified-snapshot.json 不存在）⇒ 跑一次 verify:changed 建基线后此段自动出现\n',
  };

  // ① 读基线（不存在 ⇒ 如实报，不造判据）
  const loaded: SnapshotLoad = loadVerifiedSnapshot(root);
  if (loaded.status !== 'ok') {
    return empty;
  }

  // ② planInheritance：改动集 = writtenRels ⇒ 影响面 ∩ 证据观察面 ⇒ rerun 清单
  const allItems = collectExpectations(dsl ?? ({} as DesignDSL));
  // 构造 impact：写穿已经更新了索引 ⇒ 直接算"writtenRels 的 import 反闭包"太重，
  // 简化：受影响 = 证据观察面**直接包含** writtenRels 中任一路径的条目。
  // （planInheritance 的 impact 参数是可选的——不给它，只给 changed，它走观察面∩改动集判定。）
  const writtenNorm = written.map((w) => w.replace(/\\/g, '/'));
  const affectedItems = allItems.filter(({ expectation }) => {
    const obs = observesOf(expectation as Record<string, unknown>);
    return obs.some((o) => writtenNorm.some((w) => o === w || o.startsWith(w.replace(/\/$/, '') + '/')));
  });
  if (affectedItems.length === 0) {
    return {
      ...empty,
      hasBaseline: true,
      affected: 0,
      rendered: '\n── 契约反馈 ──\n  · 本次改动不在任何契约的观察面内 ⇒ 0 条受影响\n',
    };
  }

  // ③ 跑受影响子集的 judge
  const judgeItems = affectedItems.map(({ node_id, expectation }) => ({
    node_id,
    node_label: node_id,
    expectation: expectation as never,
  }));
  const rep = await judgeExpectations(root, judgeItems as never);

  // ④ 分类
  const green: ContractFeedbackResult['green'] = [];
  const red: ContractFeedbackResult['red'] = [];
  const unsupported: ContractFeedbackResult['unsupported'] = [];
  const nowIso = new Date().toISOString();
  const prevById = new Map<string, unknown>();
  for (const e of loaded.snapshot.entries) prevById.set(e.id, e);

  const touchedIds = new Set(affectedItems.map(({ node_id, expectation }) => `contract:${node_id}#${expectation.kind}#${String((expectation as Record<string, unknown>).path ?? '')}#${String((expectation as Record<string, unknown>).symbol ?? '')}`));

  for (const it of rep.items) {
    const summary = String(it.detail ?? '').split('\n')[0].slice(0, 120);
    const entry = { id: `${it.node_id}#${(it.expectation as Record<string, unknown>)?.kind}`, detail: summary };
    if (it.verdict === 'pass') green.push(entry);
    else if (it.verdict === 'fail') red.push(entry);
    else unsupported.push(entry);
  }

  // ⑤ 写回基线（合并三纪律：撤销旧绿 + 本次写入 + 未跑保留）
  let baselineWritten = false;
  try {
    const entries = loaded.snapshot.entries.filter((e) => !touchedIds.has(e.id));
    for (const it of rep.items) {
      const kind = it.verdict === 'pass' ? 'pass' : it.verdict === 'fail' ? 'fail' : it.verdict === 'unsupported' ? 'unsupported' : 'pending';
      const exp = it.expectation as Record<string, unknown>;
      entries.push({
        id: `contract:${it.node_id}#${exp.kind}#${exp.path ?? ''}#${exp.symbol ?? ''}`,
        kind: 'contract',
        verdict: kind as never,
        command: `contract-feedback（${it.node_id}）`,
        at: nowIso,
        observes: observesOf(exp),
        symbols: symbolsOf(exp),
      } as never);
    }
    const uniq = new Map(entries.map((e) => [(e as { id: string }).id, e]));
    writeVerifiedSnapshot(root, {
      schema: SNAPSHOT_SCHEMA,
      at: nowIso,
      content: loaded.snapshot.content,
      graph: loaded.snapshot.graph,
      entries: [...uniq.values()] as never,
      scope: {
        ran: [...touchedIds],
        inherited: (loaded.snapshot.scope?.inherited ?? []).filter((id) => !touchedIds.has(id)),
        undetermined: loaded.snapshot.scope?.undetermined ?? [],
        partial: true,
        covered_files: [...new Set(([...uniq.values()] as { observes?: string[] }[]).flatMap((e) => e.observes ?? []))].sort(),
      },
    } as never);
    baselineWritten = true;
  } catch {
    /* 写回失败不阻断（下次 verify 会重跑全部） */
  }

  // ⑥ 人读渲染
  const lines: string[] = [`\n── 契约反馈 ── 受影响 ${affectedItems.length} 条`];
  if (green.length) lines.push(`  ✓ 绿 ${green.length}: ${green.slice(0, 3).map((g) => g.id).join(', ')}${green.length > 3 ? ' …' : ''}`);
  if (red.length) lines.push(`  ✗ 红 ${red.length}: ${red.slice(0, 3).map((r) => `${r.id}（${r.detail}）`).join('; ')}${red.length > 3 ? ' …' : ''}`);
  if (unsupported.length) lines.push(`  ⚠ 判不了 ${unsupported.length}: ${unsupported.slice(0, 3).map((u) => u.id).join(', ')}`);
  if (baselineWritten) lines.push('  · 基线已更新');

  return {
    hasBaseline: true,
    affected: affectedItems.length,
    green, red, unsupported,
    baselineWritten,
    rendered: lines.join('\n'),
  };
}
