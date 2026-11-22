/**
 * 权威输入源登记（Main 约束 3 · 内核级区分，现在建）。
 *
 * ## 两类（+归档）必须在内核区分清楚
 * · `authority-input`：人写权威输入（愿景原话 / 现役否决 / 纪律 / 决策 rationale）。
 *   带 provenance / owner / state，**不可再生**；不得手改生成区，也不得被投影覆盖。
 *   其语义化（入 DSL goals / gate rules / decision nodes）列后续批，走 A 段 model-in-the-loop + 人定裁决；
 *   现在不硬造伪判据。
 * · `projection`：从权威可再生的视图（本核适配器产出的生成块）；可确定性重建。
 * · `archive`：历史 append-only 证据（台账 jsonl 等）；不挂 fresh 门，可追溯不重新采纳。
 *
 * 本登记表是内核级权威地图的一部分；适配器注册表（`registry.ts`）的投影条目在此同源登记。
 */
import type { LifecycleState } from './lifecycle.js';

export type AuthorityKind = 'authority-input' | 'projection' | 'archive';

export interface Provenance {
  /** 外部散文 / 源码注释 / 引擎挂账 / 人写纪律 / 历史证据 */
  source_kind: string;
  /** 仓库相对路径或载体描述 */
  source_ref: string;
  /** 登记时刻（UTC ISO；人写输入可空，以文件为准） */
  captured_at?: string;
  /** 内容指纹（sha16；可空 = 未采集） */
  source_fingerprint?: string;
}

export interface AuthoritySourceEntry {
  id: string;
  kind: AuthorityKind;
  /** 仓库相对路径；DSL/DB 类用载体描述 */
  path: string;
  /** 谁拥有/谁可写（owner）；投影 = 单写者内核 */
  owner: string;
  /** 生命周期态（人写输入按已权威 committed；归档 = archived） */
  state: LifecycleState;
  /** 是否可从权威确定性再生 */
  regenerable: boolean;
  provenance: Provenance;
  note: string;
}

/** 内置人写权威输入（一期保留，不投影、不回读为机器事实；M2 主张级比对远期） */
export const BUILTIN_AUTHORITY_INPUTS: readonly AuthoritySourceEntry[] = [
  {
    id: 'vision-original',
    kind: 'authority-input',
    path: 'docs/VISION-ORIGINAL.md',
    owner: 'human',
    state: 'committed',
    regenerable: false,
    provenance: { source_kind: '人写愿景原话', source_ref: 'docs/VISION-ORIGINAL.md' },
    note: '用户愿景原话；不改写、不投影；语义化入 DSL goals 列后续 A 段裁决。',
  },
  {
    id: 'retired',
    kind: 'authority-input',
    path: 'docs/RETIRED.md',
    owner: 'human',
    state: 'committed',
    regenerable: false,
    provenance: { source_kind: '人写现役否决条件', source_ref: 'docs/RETIRED.md' },
    note: '当前仍有效的否决与回炉条件；退役留痕可追溯。',
  },
  {
    id: 'agents-discipline',
    kind: 'authority-input',
    path: 'AGENTS.md',
    owner: 'human',
    state: 'committed',
    regenerable: false,
    provenance: { source_kind: '人写开发纪律', source_ref: 'AGENTS.md' },
    note: '开发纪律唯一住处；教程/纪律叙述手写，不投影（M8）。',
  },
  {
    id: 'pitfalls',
    kind: 'authority-input',
    path: 'docs/PITFALLS.md',
    owner: 'human',
    state: 'committed',
    regenerable: false,
    provenance: { source_kind: '人写现行处置纪律', source_ref: 'docs/PITFALLS.md' },
    note: '撞门/环境故障现行处置；表内标识符存在性门属后续批（G17）。',
  },
];

/** 内置历史归档（append-only 证据；不挂 fresh 门） */
export const BUILTIN_ARCHIVES: readonly AuthoritySourceEntry[] = [
  {
    id: 'accounting-jsonl',
    kind: 'archive',
    path: 'docs/accounting.jsonl',
    owner: 'engine-ledger',
    state: 'archived',
    regenerable: false,
    provenance: { source_kind: '历史证据', source_ref: 'docs/accounting.jsonl' },
    note: '长文历史台账；append-only，不挂 fresh 门。',
  },
  {
    id: 'frictions-jsonl',
    kind: 'archive',
    path: 'docs/frictions.jsonl',
    owner: 'engine-ledger',
    state: 'archived',
    regenerable: false,
    provenance: { source_kind: '历史证据', source_ref: 'docs/frictions.jsonl' },
    note: '摩擦记录历史；append-only，不挂 fresh 门。',
  },
];

const registry = new Map<string, AuthoritySourceEntry>();

function register(entry: AuthoritySourceEntry): void {
  registry.set(entry.id, entry);
}

for (const e of BUILTIN_AUTHORITY_INPUTS) register(e);
for (const e of BUILTIN_ARCHIVES) register(e);

/** 登记一个投影源（适配器注册时同源落账）；重复 id 覆盖投影条目，不覆盖人写输入 */
export function registerProjectionSource(entry: AuthoritySourceEntry): void {
  const existing = registry.get(entry.id);
  if (existing && existing.kind === 'authority-input') {
    throw new Error(`权威输入源 \`${entry.id}\` 不允许被投影条目覆盖（视图不是源）`);
  }
  register(entry);
}

export function listSources(kind?: AuthorityKind): AuthoritySourceEntry[] {
  const all = [...registry.values()];
  return kind ? all.filter((e) => e.kind === kind) : all;
}

export function getSource(id: string): AuthoritySourceEntry | undefined {
  return registry.get(id);
}
