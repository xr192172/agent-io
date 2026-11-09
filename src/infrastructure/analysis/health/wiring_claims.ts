/**
 * **能力声明的自动枚举**（接线账的入口层）。
 *
 * ## 它枚举什么、不枚举什么
 * **只认「机器可读的显式声明」**，四类来源：
 * | 来源 | 权威 | 为什么算"声明" |
 * |---|---|---|
 * | `kind-registry` | `expectation_kinds.ts#KIND_SPECS` | 每种判据 kind 就是一条"我能判 X"的声明 |
 * | `tool-registry` | `capability_map.ts#listToolDefs()` | 注册在工具面上的工具 |
 * | `explicit-declaration` | `structure.domains.json` 的 `role:'capability'` 域 + 本文件的 `EXPLICIT` 表 | 人明确写了"这是一个能力" |
 * | `code-health` | `code_health` 的 `orphan_file`/`unused_export`，**且**该文件在设计册里有节点 | 候选：有声明、但可能没人用 |
 *
 * ★ **不枚举 `decision.summary`**：一段设计散文不是"可执行能力"的声明。
 *   拿它猜能力会把 600 多个节点全变成"能力"，报告立刻失去意义（本轮有反例用例钉这一条）。
 *
 * ## 来源不可用时**不许**给空表
 * `listToolDefs()` 在未注入时**抛错**（`capability_map.ts:381`），那是设计如此 ——
 * 本模块把它如实记为 `status:'unavailable'` + 原因 + 分母 0，**不**静默当成"没有工具"。
 */
import fs from 'node:fs';
import path from 'node:path';

import { KIND_SPECS } from '../../../domain/expectation_kinds.js';

/** 声明来源（四类，与 §13.4 的"自动发现"口径一致） */
export type ClaimSource = 'kind-registry' | 'tool-registry' | 'explicit-declaration' | 'code-health';

/** 处置档：**只有 production 要求完整链**；reserved/experiment 必须显式声明 */
export type CapabilityKind = 'production' | 'reserved' | 'experiment';

/** 最小能力声明（用户本轮给定形状） */
export type CapabilityClaim = {
  subject: string;
  purpose: string;
  source: ClaimSource;
  kind: CapabilityKind;
  /** 四格证据的**引用**（可复核的定位符；`null` = 没有这条引用 ⇒ 该格判不了） */
  evidence_refs: {
    declared: string;
    input: string | null;
    handoff: string | null;
    consumer: string | null;
    execution: string | null;
  };
  /** 处置说明（reserved/experiment 必填理由；production 可为 null） */
  disposition: string | null;
};

export type SourceReport = {
  source: ClaimSource;
  status: 'ok' | 'unavailable';
  claims: number;
  reason?: string;
};

const read = (root: string, rel: string): string => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return '';
  }
};
const count = (s: string, n: string): number => s.split(n).length - 1;

/** 设计册里所有出现过的 path（用于"这个文件有声明"的判定；**只取 path，不读散文**） */
function declaredPaths(root: string): Set<string> {
  const out = new Set<string>();
  const dir = path.join(root, '.agent-io', 'design');
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.dsl.json')) continue;
    try {
      const j = JSON.parse(read(root, path.join('.agent-io', 'design', f))) as { geometry?: { nodes?: Array<{ path?: string }> } };
      for (const n of j.geometry?.nodes ?? []) if (typeof n.path === 'string') out.add(n.path.replace(/\\/g, '/'));
    } catch {
      /* 坏册跳过 —— 不猜 */
    }
  }
  return out;
}

type DomainDecl = { id: string; dir: string; note?: string; role?: string };

function capabilityDomains(root: string): DomainDecl[] {
  try {
    const j = JSON.parse(read(root, 'structure.domains.json')) as { domains?: DomainDecl[] };
    return (j.domains ?? []).filter((d) => d.role === 'capability' && typeof d.dir === 'string');
  } catch {
    return [];
  }
}

/**
 * **本文件显式声明的三个非注册表能力**。
 * 它们不是"从散文猜出来的"：这三条是人（我）在读代码后**明确写下的声明**，且各自带理由。
 * ★ 它们是上一轮的四个对象里除 `runtime` 外的三个；`runtime` 现在由 `kind-registry` 自动发现。
 */
const EXPLICIT: CapabilityClaim[] = [
  {
    subject: 'src/application/design/intent/expectations.ts#includeComments',
    purpose: 'source-has 能断注释里的标记（默认剥注释，includeComments:true 读原文）',
    source: 'explicit-declaration',
    kind: 'production',
    evidence_refs: {
      declared: 'src/domain/expectation.ts 的 `includeComments?: boolean`',
      input: null,
      handoff: '设计册里带 includeComments 的判据条数',
      consumer: 'src/application/design/intent/expectations.ts 把 e.includeComments 传进 sourceHasTextOf',
      execution: '.agent-io/judge-readings.json#by_kind["source-has"].checked',
    },
    disposition: null,
  },
  {
    subject: 'src/application/design/derive/derive_judgements.ts#deriveJudgements',
    purpose: '零件契约 → 判据的机械展开（零人工）',
    source: 'explicit-declaration',
    kind: 'production',
    evidence_refs: {
      declared: 'derive_judgements.ts 的 `export function deriveJudgements`',
      input: '设计册里 contract 实例条数',
      handoff: '写口是否调用 deriveJudgements(',
      consumer: '全仓提到 deriveJudgements 的文件数（排除本账自身）',
      execution: null,
    },
    disposition: '缺输入与写口：先有 contract 实例，再接写口',
  },
  {
    subject: 'src/domain/contract.ts#BrickContract',
    purpose: '零件契约（effects / shapes / runtime 证据）',
    source: 'explicit-declaration',
    kind: 'reserved',
    evidence_refs: {
      declared: 'src/domain/contract.ts 的 `export interface BrickContract`',
      input: null,
      handoff: '设计册里填了 contract 的文件数',
      consumer: '提到 BrickContract 的文件数（排除本账自身）',
      execution: null,
    },
    disposition: '字段注释写明 effects.writes/holds/emits 与 runtime 由 observe 事件流补；静态提取阶段为空是设计如此',
  },
];

/** 枚举四类来源；每个来源都给一条 `SourceReport`（含**不可用**与分母） */
export function enumerateClaims(
  root: string,
  flaggedFiles: readonly string[] = [],
): { claims: CapabilityClaim[]; sources: SourceReport[] } {
  const claims: CapabilityClaim[] = [];
  const sources: SourceReport[] = [];

  // ① kind-registry
  const kindNames = Object.keys(KIND_SPECS ?? {});
  for (const k of kindNames) {
    const spec = (KIND_SPECS as Record<string, { desc?: string; why_not_projected?: string; carrier?: string }>)[k] ?? {};
    claims.push({
      subject: `judgement-kind:${k}`,
      purpose: String(spec.desc ?? spec.carrier ?? spec.why_not_projected ?? `判据 kind ${k}`).slice(0, 160),
      source: 'kind-registry',
      kind: 'production',
      evidence_refs: {
        declared: `src/domain/expectation_kinds.ts#KIND_SPECS.${k}`,
        input: k === 'runtime' ? 'tests/fixtures/observe/events-sample.jsonl（可入库样例）' : null,
        handoff: `设计册里 kind=${k} 的判据条数`,
        consumer: `.agent-io/judge-readings.json#by_kind["${k}"]`,
        execution: `.agent-io/judge-readings.json#by_kind["${k}"].checked`,
      },
      disposition: null,
    });
  }
  sources.push({ source: 'kind-registry', status: 'ok', claims: kindNames.length });

  // ② tool-registry（未注入 ⇒ 抛错 ⇒ 如实记 unavailable，不给空表）
  try {
    // 动态 import：避免把 capability_map 的注入状态变成模块加载期依赖
    const mod = loadToolDefsSync();
    claims.push(...mod.map((t) => ({
      subject: `tool:${t.name}`,
      purpose: String(t.description ?? t.name).slice(0, 160),
      source: 'tool-registry' as const,
      kind: 'production' as const,
      evidence_refs: {
        declared: 'src/presentation/mcp/server_registry.ts 的工具注册',
        input: null,
        handoff: '工具面（ToolDef.description 是唯一权威）',
        consumer: 'MCP 工具面（调用方 = agent）',
        execution: null,
      },
      disposition: null,
    })));
    sources.push({ source: 'tool-registry', status: 'ok', claims: mod.length });
  } catch (e) {
    sources.push({
      source: 'tool-registry',
      status: 'unavailable',
      claims: 0,
      reason: `工具目录未注入 ⇒ 该来源本轮**未判定**（不是"没有工具"）：${(e as Error).message.slice(0, 120)}`,
    });
  }

  // ③ explicit-declaration：36 个 role=capability 域 + 三条显式声明
  const doms = capabilityDomains(root);
  for (const d of doms) {
    claims.push({
      subject: `domain:${d.id}`,
      purpose: String(d.note ?? `能力域 ${d.id}`).slice(0, 160),
      source: 'explicit-declaration',
      kind: 'production',
      evidence_refs: {
        declared: `structure.domains.json 的 domains[].role='capability'（dir=${d.dir}）`,
        input: null,
        handoff: null,
        consumer: `该域目录下被其他文件 import 的文件数`,
        execution: null,
      },
      disposition: null,
    });
  }
  claims.push(...EXPLICIT);
  sources.push({ source: 'explicit-declaration', status: 'ok', claims: doms.length + EXPLICIT.length });

  // ④ code-health 候选：孤儿/未用导出 **且** 设计册里给过节点（= 有声明）
  const paths = declaredPaths(root);
  const cand = codeHealthCandidatesSync(root, paths, new Set(flaggedFiles.map((f) => f.replace(/\\/g, '/'))));
  claims.push(...cand);
  sources.push({
    source: 'code-health',
    status: flaggedFiles.length > 0 ? 'ok' : 'unavailable',
    claims: cand.length,
    ...(flaggedFiles.length > 0
      ? {}
      : { reason: '未注入 code_health 的孤儿/未用导出集合 ⇒ 该来源本轮**未判定**（不是「没有候选」）' }),
  });

  return { claims, sources };
}

/** `listToolDefs()` 的唯一调用点（未注入时它会抛，这里**不吞**：由调用方记 unavailable） */
function loadToolDefsSync(): Array<{ name: string; description?: string }> {
  // 直接读注册表产物：`server_registry` 在汇总时 bindToolDefs；这里用同步 require 语义拿当前绑定
  // ★ 不自己维护第二份工具清单（那正是本仓反复禁止的"第二份权威"）。
  const g = globalThis as unknown as { __AGENT_IO_TOOL_DEFS__?: Array<{ name: string; description?: string }> };
  if (Array.isArray(g.__AGENT_IO_TOOL_DEFS__)) return g.__AGENT_IO_TOOL_DEFS__;
  throw new Error('工具目录未注入 —— tool_registry 应在汇总后调用 bindToolDefs()');
}

/** 由 `server_registry` 在汇总时调用（唯一注入点，避免第二份清单） */
export function bindToolDefsForWiring(defs: readonly { name: string; description?: string }[]): void {
  (globalThis as unknown as { __AGENT_IO_TOOL_DEFS__?: Array<{ name: string; description?: string }> }).__AGENT_IO_TOOL_DEFS__ = [
    ...defs,
  ];
}

/**
 * code_health 的候选：**被 code_health 标记过**（孤儿文件 / 未用导出）**且**在设计册里有节点的文件。
 * ★ 不做"扫目录找候选"：那会把每个已声明文件都变成候选（实测 140 条噪音）。
 * ★ 没注入标记集合 ⇒ 该来源记 `unavailable`（不是"没有候选"）。
 */
function codeHealthCandidatesSync(root: string, declared: ReadonlySet<string>, flagged: ReadonlySet<string>): CapabilityClaim[] {
  const out: CapabilityClaim[] = [];
  for (const rel of [...flagged].sort()) {
    if (!declared.has(rel)) continue; // 没声明 ⇒ 不是能力候选（普通文件不进账）
    out.push({
      subject: `file:${rel}`,
      purpose: '已在册、但被 code_health 报为孤儿/未用导出（候选：可能没有真实消费者）',
      source: 'code-health',
      kind: 'production',
      evidence_refs: {
        declared: rel,
        input: null,
        handoff: null,
        consumer: '该文件的 importer 数（排除测试与本账自身）',
        execution: null,
      },
      disposition: null,
    });
  }
  return out;
}

/** 供测试与报告：把数量汇总成人读的一行（**带分母**，不许只报"扫了多少"） */
export function summarizeSources(sources: readonly SourceReport[]): string {
  const ok = sources.filter((s) => s.status === 'ok');
  const bad = sources.filter((s) => s.status !== 'ok');
  const total = ok.reduce((a, s) => a + s.claims, 0);
  return (
    `来源 ${sources.length}：可用 ${ok.length}（共 ${total} 条声明）· 未判定 ${bad.length}` +
    (bad.length ? `（${bad.map((s) => s.source).join(' / ')}）` : '')
  );
}
