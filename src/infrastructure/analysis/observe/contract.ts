/**
 * Observe 多语言契约 · TypeScript 判定哨兵（Comparator）
 *
 * 对应 docs/observe-abstract.md §3.4。目的：证明判定逻辑语言无关——TS 侧用同一
 * 份 dsl.json（权威真相源）+ events.jsonl（观测）即可独立产出三类偏差报告，
 * 与 Go 装配层的 Comparator 语义一致。
 *
 * 契约语义对齐（与 Go contract.go SilentErrorDiscard 完全一致）：
 *   - remove/remove-tmp/cleanup：仅显式标记 benign 为良性。
 *   - writefile/save/mkdirall：任何 err 都非良性（数据未持久化）。默认分支。
 */

import fs from 'node:fs';
import type { TSEvent, ExtraFields } from './probe.js';
import { matchChainDecl, type TSChainObs } from './chain.js';
import { observeRulePredicate, type ObserveRuleCtx } from './judge.js';
import { knownSpreadIndex } from './ledger_fold.js';

/** TS 侧 DSL 声明，与 schema definitions.DSLDecl 对齐。 */
export interface TSDLDecl {
  rule: string;
  probe?: string; // 空 = 全局声明
  expect?: string;
  constraint?: string;
  /** 链路契约（P2）：声明的调用序（探针名）。非空时走链路判定——声明的
   * 调用序必须是某条实测链的子序列（未声明的中间帧不算偏差）。 */
  chain?: string[];

  // ── 以下三字段 2026-10-05 补齐（P4 硬前置）────────────────────────────
  // Go 侧 `llm_judge.go:45` 的 `DSLDecl` 有 8 个字段，TS 侧此前只有 5 个，缺这三个。
  // 它们不是"可选的元信息"：`finalizeDecls`（Go `proposal.go:391`）靠 `status`/`verified_by`
  // 记录**每条声明的复核结论**，`HistoryEntry`（`dsl_store.go:37`）靠 `origin` 记录**谁写的**。
  // ⇒ 不补齐，TS 侧一旦接手审批，**门证据无处落**。
  /** 声明来源（如 `runtime-observe` = 运行时观测折叠生成；`manual` = 人工写入）。 */
  origin?: string;
  /** 复核证据串（Go 侧同名字段）；冻结时为 `frozen: <原因>`。 */
  verified_by?: string;
  /** 生命周期：`proposed`（待复核）/ `locked`（已定稿）/ `proposed` + verified_by 含 needs-llm-review。 */
  status?: string;
}

/** TS 侧设计 DSL 文档（dsl.json）。 */
export interface TSDesignDSLDoc {
  version: number;
  updated_at: string;
  decls: TSDLDecl[];
}

/** 偏差类别，与 schema Deviation.kind 对齐（chain-broken 为 P2 链路契约断裂）。 */
export type DeviationKind = 'unobserved' | 'violated' | 'undesigned' | 'chain-broken';

/** TS 侧偏差，与 schema definitions.Deviation 对齐。 */
export interface TSDeviation {
  kind: DeviationKind;
  rule?: string;
  probe?: string;
  /** 链路级偏差：关联的实测链 trace id。 */
  trace_id?: string;
  /** 链路级偏差：实测链调用序列窗口。 */
  window?: string[];
  detail: string;
}

/** TS 侧偏差报告，与 schema definitions.DiffReport 对齐。 */
export interface TSDiffReport {
  generated_at: string;
  event_count: number;
  deviations: TSDeviation[];
  unobserved: number;
  violated: number;
  undesigned: number;
  /** 链路契约断裂数（P2）。 */
  chain_broken: number;
}

/** 单探针观测画像（与 Go ProbeObs 对齐）。 */
export interface TSProbeObs {
  probe: string;
  count: number;
  errs: number;
  benigns: number;
  ops: string[];
  events: TSEvent[];
}

/** TS 判定哨兵：design(权威) vs actual(观测) → 三类偏差。 */
export class TSComparator {
  /**
   * 谓词来源**唯一**：`judge.ts` 的 `OBSERVE_RULE_TABLE`。
   * ★ 2026-10-05 拆掉了这里原本的第二个注册表（`private preds` + `registerPredicate` +
   *   `registerDefaultPredicates`）—— 它只注册 1 条规则、且用的是本文件里第 3 份字面量重复的
   *   `silentErrorDiscardTS`，而 `judge.ts:110` 的判定链注册的是 3 条。**两处注册表各自维护**，
   *   意味着"哪些规则可被规则秒判"在两个文件里有两个答案。
   * ★ 故 `register*` 两个方法一并删除（唯一调用方 `handlers.ts` 已改直构）。
   */

  /** 读 dsl.json（权威设计 DSL）。文件不存在返回 null。 */
  static loadDesign(path: string): TSDesignDSLDoc | null {
    if (!fs.existsSync(path)) return null;
    return JSON.parse(fs.readFileSync(path, 'utf8')) as TSDesignDSLDoc;
  }

  /** 聚合观测事件为探针画像（与 Go Aggregator 对齐）。 */
  static aggregate(events: TSEvent[]): TSProbeObs[] {
    const byProbe = new Map<string, TSEvent[]>();
    for (const ev of events) {
      const list = byProbe.get(ev.probe) ?? [];
      list.push(ev);
      byProbe.set(ev.probe, list);
    }
    const probes: TSProbeObs[] = [];
    for (const [probe, evs] of [...byProbe.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      let errs = 0;
      let benigns = 0;
      const opSet = new Set<string>();
      for (const ev of evs) {
        if (typeof ev.fields['err'] === 'string' && ev.fields['err'] !== '') errs++;
        if (ev.fields['benign'] === true) benigns++;
        if (typeof ev.fields['op'] === 'string' && ev.fields['op'] !== '') opSet.add(ev.fields['op'] as string);
      }
      probes.push({ probe, count: evs.length, errs, benigns, ops: [...opSet], events: evs });
    }
    return probes;
  }

  /** 对比 design vs actual，产出三类偏差。语义与 Go Comparator 对齐。 */
/** 对比 design vs actual，产出四类偏差（含链路契约）。语义与 Go Comparator 逐段对齐。
   * chains：rebuildChains 重建的实测调用链（链路契约判定用；缺省 [] = 无链可判）。 */
  compare(design: TSDesignDSLDoc, actualObs: TSProbeObs[], chains: TSChainObs[] = []): TSDiffReport {
    const report: TSDiffReport = {
      generated_at: new Date().toISOString(),
      event_count: actualObs.reduce((n, p) => n + p.count, 0),
      deviations: [],
      unobserved: 0,
      violated: 0,
      undesigned: 0,
      chain_broken: 0,
    };

    const obsEvents = new Map<string, TSEvent[]>();
    for (const p of actualObs) obsEvents.set(p.probe, p.events);

    // ★ 判定上下文（2026-10-06，P5）：把 known-spread 声明折叠成"已承认耦合"表，供
    //   `impactUnplannedSpread` 扣减（已承认的越界不该再报计划外扩散）。
    //   在循环外构造一次（纯计算、不落盘 ⇒ 符合"能现取就别存副本"）。
    //   ★ 即便一条 known-spread 声明都没有，这里也是**空 Map**（= 已对账、无已承认耦合），
    //     与"拿不到声明集（undefined）"是两件事（见 `judge.ObserveRuleCtx`）。
    const judgeCtx: ObserveRuleCtx = { acknowledgedSpreads: knownSpreadIndex(design.decls) };

    // 1. 设计声明的覆盖 + 违反检查
    for (const d of design.decls) {
      if (d.chain && d.chain.length > 0) continue; // 链路契约走第 3 段，不参与探针级判定
      const matched: TSEvent[] = [];
      if (!d.probe) {
        for (const evs of obsEvents.values()) matched.push(...evs);
      } else {
        matched.push(...(obsEvents.get(d.probe) ?? []));
      }
      if (matched.length === 0) {
        report.unobserved++;
        report.deviations.push({
          kind: 'unobserved',
          rule: d.rule,
          probe: d.probe,
          detail: '设计声明从未被观测到（该探针未触发/未覆盖）',
        });
        continue;
      }
      const pred = observeRulePredicate(d.rule);
      if (!pred) continue; // 无确定性谓词 → 不臆造违反（交 LLM 复核）
      for (const ev of matched) {
        const { result, reason } = pred(ev, judgeCtx);
        if (result === 'deviation') {
          report.violated++;
          report.deviations.push({ kind: 'violated', rule: d.rule, probe: ev.probe, detail: reason });
        }
      }
    }

    // 2. 未声明探针（链路声明也算覆盖——根探针被声明即非末声明行为）
    //
    // ★ 2026-10-05（P4 收尾）修正：**全局声明（`probe:""`）不再算"覆盖"。**
    //   原判据含 `!d.probe ||` ⇒ 种子的 `silentErrorDiscardDSL()`（probe 为空，本就是全局陈述）
    //   会把**每一个**探针都算作"已覆盖" ⇒ `undesigned` **恒为 0**
    //   ⇒ 连"报告里的『未声明 N』"都是**假话**（明明有未声明的探针），并让 loop 的 6a 分支恒空转
    //   （Go 侧同样如此：`comparator.go:140`、`loop_test.go:20` 的注释都写明了"全局声明会覆盖所有探针"）。
    //
    //   **为什么这次只改这一处、而 pass 1 的全局匹配保留**：
    //     · pass 1（违反/未观测）**需要**全局匹配 —— 种子契约的作用就是"在**任何**会静默丢错的位置"
    //       都能抓到错误；改成必须指名探针会让种子失效。
    //     · pass 2（未声明）问的是另一个问题："这个探针**自己**有没有被设计过？"
    //       一条全局声明没有对任何具体探针做出**可判定的**规定 ⇒ 不该算它被覆盖。
    //   ⇒ 两个 pass 语义不同、判据不同，这是**刻意区分**，不是遗漏。
    for (const p of actualObs) {
      const covered = design.decls.some((d) => d.probe === p.probe || (d.chain && d.chain.includes(p.probe)));
      if (!covered) {
        report.undesigned++;
        report.deviations.push({
          kind: 'undesigned',
          probe: p.probe,
          detail: '观测到行为但没有对应设计声明（设计不完整/新探针）',
        });
      }
    }

    // 3. 链路契约（decl.chain 非空）：声明的调用序必须是某条实测链的子序列。
    //    根探针从未出现在任何链上 → 未观测；出现但序列不满足 → 链路断裂。
    for (const d of design.decls) {
      if (!d.chain || d.chain.length === 0) continue;
      const { satisfied, best } = matchChainDecl(d.chain, chains);
      if (satisfied) continue;
      if (!best) {
        report.unobserved++;
        report.deviations.push({
          kind: 'unobserved',
          rule: d.rule,
          probe: d.chain[0],
          detail: '链路契约的根探针从未在任何调用链上被观测到（该链路无任何调用）',
        });
        continue;
      }
      const missing = d.chain[best.matched];
      report.chain_broken++;
      report.deviations.push({
        kind: 'chain-broken',
        rule: d.rule,
        probe: d.chain[0],
        trace_id: best.chain.trace_id,
        window: best.chain.sequence,
        detail: `链路断裂：声明序 [${d.chain.join(' → ')}] 未被满足，自 "${missing}" 起缺失/乱序（前缀匹配 ${best.matched}/${d.chain.length}）`,
      });
    }

    // 稳定排序：未观测 → 违反/链路断裂 → 未声明（与 Go deviationRank 一致）
    const rank = (k: DeviationKind) => (k === 'unobserved' ? 0 : k === 'undesigned' ? 2 : 1);
    report.deviations.sort((a, b) => rank(a.kind) - rank(b.kind));
    return report;
  }
}

/** 渲染人类可读的偏差报告（与 Go RenderDiffReport 对齐）。 */
/** 渲染人类可读的偏差报告（与 Go RenderDiffReport 对齐，含链路断裂段）。 */
export function renderTSDiffReport(r: TSDiffReport): string {
  const lines: string[] = [
    `TS 哨兵偏差报告（actual vs design）：${r.event_count} 事件`,
    `  未观测 ${r.unobserved} · 违反 ${r.violated} · 未声明 ${r.undesigned} · 链路断裂 ${r.chain_broken}`,
  ];
  if (r.deviations.length === 0) {
    lines.push('  ✓ 设计声明与观测画像一致');
    return lines.join('\n');
  }
  lines.push('');
  lines.push('▎偏差明细');
  for (const d of r.deviations) {
    if (d.kind === 'unobserved') lines.push(`  [未观测]   rule=${d.rule} probe=${d.probe}`);
    else if (d.kind === 'violated') lines.push(`  [违反]     rule=${d.rule} probe=${d.probe}`);
    else if (d.kind === 'chain-broken') lines.push(`  [链路断裂] rule=${d.rule} 根=${d.probe} trace=${d.trace_id}`);
    else lines.push(`  [未声明]   probe=${d.probe}`);
    lines.push(`      ${d.detail}`);
    if (d.kind === 'chain-broken' && d.window && d.window.length > 0) {
      lines.push(`      实测链窗口: ${d.window.join(' → ')}`);
    }
  }
  return lines.join('\n');
}

/** 导出类型别名，方便调用方使用一致的 field 类型。 */
export type { ExtraFields };