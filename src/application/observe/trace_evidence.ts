/**
 * trace_evidence：L4 证据回溯的「真实可复算」校验引擎
 *
 * 目标：把 reason_validator 的 L4 从「带证据就拒」的挡板，升级为「真能验证据」。
 * 核心原则：证据不是让 LLM 交一份说明，而是让程序自己从真实采集的 trace 里复算验证。
 *
 * ★★ 证据源（2026-10-01，「撤 trace_reasoning + 接到更全处」后重接）：
 *   在此之前本模块读的是 `<live_dir>/<feature>.trace.json` —— 而那份文件**全仓只有一个产者**：
 *   `src/tools/trace_reasoning.ts`（一个**从未注册为 MCP 工具**的库：零接触自动插桩，
 *   把静态调用链整条包起来跑一遍）。它写出的 `tokens` 是「函数行数」这个**合成代理值**，不是测量。
 *
 *   ★ 用户裁定撤掉它：它「经常会产生非常过量的数据，而且海量噪音…能不能自动选准点位」；
 *     并指出「observe 线当时是想要接入这个功能的，但它因为上下文的问题，自己重新建了一个」。
 *   ⇒ 观察线**更全的那份**是一条完整链：
 *       `recommend_observe_points`（选点）→ `observe_instrument`（按点注入探针）
 *       → 运行时落 events JSONL → `observe_trace` / `run_trace_replay`（重建成调用树）。
 *   ⇒ 本模块**改读同一份事件**（候选解析与 observe_trace 同源），不再自造格式、不再自造产者。
 *
 *   ★ 口径随之变「实」：声称语法 `@token>N`（合成代理）→ **`@dur>N`（真实测量耗时 ms）**。
 *     语法变更**不是代价**（用户裁定：本项目只有我们自己在用 ⇒ 同「没有下游就不做兼容层」）。
 *     一处**设计属性**值得记住：**证据与 feature 不再绑定**（事件是会话级的），
 *     换来的是"验的是真实跑过的数据"。
 *
 * 证据 ref 约定（type='trace'）：
 *   - `<probe>`              仅存在性：该函数/探针必须真实被执行并记录过（probe 全名或末段短名均可）
 *   - `<probe>@dur>N`        存在性 + 复算声明：程序读取该探针真实测量的耗时（多次调用取**最大**），
 *                            若实际值未超过声称阈值 N，说明证据与实际运行不符 → 打回
 *
 * 纯函数、无副作用（读文件除外），便于单测。
 */

import fs from 'node:fs';
import { defaultEventsCandidates } from './observe_trace.js';
import {
  loadRunTracesFromText,
  type RunTreeNode,
} from '../../infrastructure/analysis/run_trace_replay.js';
import type { ReasonEvidenceRef, ReasonEvidenceResolver } from './reason_validator.js';

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

/**
 * 一条"真实发生过的调用"记录 —— 由**录制事件**派生（不是静态分析产物）。
 * 与 observe 线同一份数据：`probe`/`dur_ms`/缺帧标注全部来自探针落盘的 enter/exit 帧。
 */
export interface TraceRecord {
  /** 本次操作（一条调用链）的 id */
  trace_id: string;
  /** 探针全名（带命名空间，如 "order.Place"）—— 运行时唯一标识 */
  probe: string;
  /** 探针名末段（如 "Place"）—— 便于按短名引用 */
  name: string;
  /** 真实测量耗时（ms，来自 exit 帧 `dur_ms`；缺 exit 帧则为 0 且 `missing_out=true`） */
  duration_ms: number;
  /** 缺 enter 帧（无入参可查）—— 诚实标注，不合成值 */
  missing_in?: boolean;
  /** 缺 exit 帧（耗时不可信）—— 诚实标注，不合成值 */
  missing_out?: boolean;
  /** enter 帧 fields（入参） */
  in?: unknown;
  /** exit 帧 fields（出参） */
  out?: unknown;
}

/** `loadObservedTraceRecords` 的结果：记录 + 它们来自哪个事件文件 */
export interface ObservedTrace {
  records: TraceRecord[];
  /** 事件来源文件；**null = 一个候选都没找到** ⇒ 本次不可回溯 */
  source: string | null;
}

/** 单条证据校验结果 */
export type TraceEvidenceResult =
  | { ok: true; actual?: number; expected?: number }
  | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────
// 事件 → 记录
// ─────────────────────────────────────────────────────────────

/** 把一棵调用树摊平成记录（深度优先，父在子前） */
function flatten(node: RunTreeNode, traceId: string, out: TraceRecord[]): void {
  const dot = node.probe.lastIndexOf('.');
  out.push({
    trace_id: traceId,
    probe: node.probe,
    name: dot >= 0 ? node.probe.slice(dot + 1) : node.probe,
    duration_ms: node.dur_ms,
    ...(node.missingIn ? { missing_in: true } : {}),
    ...(node.missingOut ? { missing_out: true } : {}),
    ...(node.in === undefined ? {} : { in: node.in }),
    ...(node.out === undefined ? {} : { out: node.out }),
  });
  for (const c of node.children) flatten(c, traceId, out);
}

/** 从录制事件 JSONL 文本派生记录（**纯函数**，无 IO）。 */
export function recordsFromEvents(jsonl: string): TraceRecord[] {
  const out: TraceRecord[] = [];
  for (const t of loadRunTracesFromText(jsonl)) flatten(t.root, t.trace_id, out);
  return out;
}

/**
 * 读事件文件 → 记录。
 * ★ 文件不存在 ⇒ 返回空数组（调用方据此判"本次不可回溯"）。
 * ★ 坏行口径**沿用上游** `parseRunTraces`（它自己 `catch { continue }` 跳过坏行，从不抛）——
 *   本函数**不再包一层 try/catch**：多包一层就是把上游的容忍伪装成本层的行为，且会吞掉 IO 错。
 *   `fs.readFileSync` 的失败（权限/IO）**照常抛**，不静默。
 */
export function loadTraceRecords(file: string): TraceRecord[] {
  if (!fs.existsSync(file)) return [];
  return recordsFromEvents(fs.readFileSync(file, 'utf-8'));
}

/**
 * 按 **observe 线与 `observe_trace` 相同**的候选顺序找录制事件
 * （`DS_OBSERVE_EVENTS` > `os.tmpdir()/dsh_events.jsonl` > `<cwd>/runs.jsonl`）。
 *
 * ★ 找不到就返回 `source: null` 而**不抛**：L4 的"不可回溯"该由 reason_validator 的 L4 前置判
 *   （它会把"带 evidence 却没解析器"当成**编造/空挂**打回，见 reason_validator.ts）。
 */
export function loadObservedTraceRecords(cwd = process.cwd()): ObservedTrace {
  for (const p of defaultEventsCandidates(cwd)) {
    if (fs.existsSync(p)) return { records: loadTraceRecords(p), source: p };
  }
  return { records: [], source: null };
}

// ─────────────────────────────────────────────────────────────
// 核心：单条证据的复算校验
// ─────────────────────────────────────────────────────────────

/**
 * 校验一条 trace 证据：
 *  - 解析 ref（含可选 `@dur>N` 复算声明）
 *  - 在真实记录里定位该探针（`probe` 全名或 `name` 短名匹配）
 *  - 找不到 → 打回（编造 / 未执行）
 *  - 有复算声明 → 用真实测量的耗时与声称阈值比对，未超则打回
 */
export function resolveTraceEvidence(
  records: TraceRecord[],
  ev: ReasonEvidenceRef,
): TraceEvidenceResult {
  if (ev.type !== 'trace') {
    return { ok: false, error: `L4 仅支持 type='trace' 证据，收到 '${ev.type}'` };
  }
  const ref = (ev.ref ?? '').trim();
  if (!ref) return { ok: false, error: 'trace 证据未提供 ref' };

  // 解析声明：`<probe>@dur>N`
  let base = ref;
  let claim: number | null = null;
  const at = ref.lastIndexOf('@');
  if (at > 0) {
    const m = /^dur>(\d+(?:\.\d+)?)$/.exec(ref.slice(at + 1));
    if (m) {
      base = ref.slice(0, at);
      claim = parseFloat(m[1]);
    }
  }

  const hits = records.filter((r) => r.probe === base || r.name === base);
  if (hits.length === 0) {
    return { ok: false, error: `录制事件中无函数 "${base}"（证据编造或函数未被真实执行）` };
  }

  // ★ 同一探针被多次调用 ⇒ 取**最大**耗时：
  //   声称"慢"就该看最慢那次；且取最大保证"未超阈值 ⇒ 打回"的判定不会因挑错样本而**误放行**
  //   （漏放比误拒危险得多：漏放会让编造的证据进库）。
  const actual = Math.max(...hits.map((r) => r.duration_ms));

  if (claim !== null) {
    if (Number.isFinite(actual) && actual <= claim) {
      return {
        ok: false,
        error: `复算失败：函数 "${base}" 实际 dur_ms=${actual}，未超声称阈值 ${claim}，证据与实际运行不符`,
      };
    }
    return { ok: true, actual, expected: claim };
  }
  return { ok: true, actual };
}

// ─────────────────────────────────────────────────────────────
// 组装 L4 resolver
// ─────────────────────────────────────────────────────────────

/**
 * 由真实记录构造 L4 resolver：
 *  - traceRefs：真实执行过的**探针全名**集合（L3 实体绑定也可命中）
 *  - exists：逐条复算校验证据
 */
export function buildTraceResolver(records: TraceRecord[]): Pick<
  ReasonEvidenceResolver,
  'exists' | 'traceRefs'
> {
  const refs = Array.from(new Set(records.map((r) => r.probe).filter(Boolean)));
  return {
    traceRefs: refs,
    exists: (ev) => resolveTraceEvidence(records, ev).ok,
  };
}
