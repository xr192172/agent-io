/**
 * 证据帧组装 —— 通过**注入的只读端口**把现有权威读数拼成一张帧（本文件不自己开库、不建索引）。
 *
 * ## 为什么是"端口"而不是直接读
 * 影子模式的第一条死线是**零写入**。仓里多数读端是安全的，但 `getProjectCacheDb()` 这一层
 * 会 `mkdirSync` + 设 WAL + 在 schema 落后时迁移（见 `infrastructure/index/db.ts#openDb`）。
 * 把读写进端口，就把"哪一步可能写盘"变成调用方必须显式声明的决策，也让反例能在没有盘的情况下钉住。
 *
 * ## 它不复制任何判据
 * `inherit / rerun / undetermined` 的唯一判据是 `verified_snapshot.ts#planInheritance`；
 * 生命周期与执行资格的唯一判据是 `execution_intents.ts#adjudicateTestObjects`；
 * 影响面的唯一实现是 `impact_set.ts#impactOfChanged`。
 * 本文件只做三件它们不做的事：**逐条证据的版本对齐**、**把分歧保留成冲突**、**把缺口分类**。
 *
 * ## 逐条对齐与权威裁决不一致时
 * 若权威说"可继承"而逐条对齐说"观察面已变"，那本身就是一对**互不相容的读数** ⇒ 记冲突、降级为
 * `conflicting`，不许偏向任何一边；两者一致才落 `fresh`。这条不对称（只能降级、不能升级）是刻意的。
 */
import {
  type EvidenceFrame,
  type EvidenceSignal,
  type FrameGap,
  detectVerdictConflicts,
  identityOf,
  relativeKey,
  resolveSubjectCandidates,
  observesAlignment,
  subjectOfEntryId,
} from '../../domain/scheduling_evidence.js';
import { type ImpactSet } from '../../infrastructure/analysis/facts/impact_set.js';
import {
  type InheritancePlan,
  type SnapshotLoad,
  contentDrift,
  planInheritance,
} from '../design/verified_snapshot.js';
import { type TestObjectEligibility } from '../verify/execution_intents.js';

/** 一条"能读到"或"读不到但说清为什么"的读数。★ 读不到**不许**退化成空集。 */
export type ReadOr<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface ContentFacts {
  version: string;
  files: Record<string, string>;
}

export interface DesignRevisionFact {
  feature: string;
  /** `<feature>#<_dsl_rev>`；null = 册里没有 revision 字段 */
  revision: string | null;
  source_ref: string;
}

export type IndexFacts = EvidenceFrame['index'];
export type CapabilityFacts = EvidenceFrame['capability'];

/**
 * 只读端口：影子模式的**全部**输入面。
 * ★ 每个端口都必须能回答"读不到"，且调用方要把"读不到"变成 `unavailable` 缺口。
 */
export interface ReadOnlyPorts {
  /** 归一身份（展示 + 比较用，不用于判权限） */
  identity(): string;
  content(): ReadOr<ContentFacts>;
  designRevisions(): ReadOr<{ revisions: DesignRevisionFact[]; missingDir: boolean }>;
  indexFacts(): IndexFacts;
  snapshot(): SnapshotLoad;
  /** 磁盘上的测试对象（仓库相对） */
  testObjects(): ReadOr<string[]>;
  eligibility(ids: readonly string[]): TestObjectEligibility;
  /**
   * 判据引用解析（DS-1R）：refs 必须有真实消费者 —— 解析不到/歧义要变成缺口。
   * ★ 本期只解析"存在性与归属"，**不读它的当前 verdict**（那要另一张卡），因此 resolved 也不代表通过。
   */
  judgementRefs(refs: readonly string[]): ReadOr<{
    resolved: Array<{ ref: string; feature: string; node_id: string; index: number }>;
    problems: Array<{ ref: string; kind: 'malformed' | 'missing' | 'out-of-range' | 'ambiguous' | 'unsupported'; detail: string }>;
  }>;
  /** 影响面；索引不可用时应返回 `ok:false`（调用方据此不许当"没影响"） */
  impact(changed: readonly string[]): ReadOr<ImpactSet>;
  capability(paths: readonly string[]): CapabilityFacts;
}

export interface FrameInput {
  root: string;
  goal: { text?: string; judgement_refs?: string[]; scope?: string[] };
  /** 改动集（调用方注入；★ 本模块不读 git，避免第二份改动集算法） */
  changed?: string[];
  /** 改动集是否可信（`false` = 读不到/来源不全 ⇒ 空交集不许当安全） */
  changedTrusted?: boolean;
  /** 改动集来源的完整性说明（缺哪一路 ⇒ 哪段时间不可见），落成 limitation */
  changedNote?: string;
  ports: ReadOnlyPorts;
}

const CODE_RE = /\.(ts|tsx|js|mjs|cjs|jsx|go|py|java|rs)$/;

/**
 * 作用域条目必须是**仓库相对**路径：绝对路径与 `..` 逃逸一律判 out-of-scope（跨项目/越界）。
 * 返回 `null` = 在仓库内（合法）；否则返回可定位的原因。
 * ★ 导出是**契约**：越界判定是证据帧对外承诺的一部分（也是它唯一可被 `behavior-cases` 真跑的纯函数）。
 */
export function scopeEscape(rel: string): string | null {
  const p = relativeKey(rel);
  if (!p) return '空路径';
  if (/^[A-Za-z]:\//.test(p) || p.startsWith('//')) return `绝对路径（${p}）`;
  if (p.startsWith('/')) return `绝对路径（${p}）`;
  if (p.split('/').includes('..')) return `越界（${p} 含 ..）`;
  return null;
}

const sortById = <T extends { id: string }>(xs: T[]): T[] => xs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * 组装证据帧。
 * 顺序 = 身份 → 目标 → 内容版本 → 设计 revision → 索引 → 快照/继承裁决 → 逐条证据 → 缺口/冲突。
 * 每一步失败都**留痕**（limitations / gaps），不许静默跳过。
 */
export function buildEvidenceFrame(input: FrameInput): EvidenceFrame {
  const root = input.root;
  const ports = input.ports;
  const limitations: string[] = [];
  const gaps: FrameGap[] = [];
  const signals: EvidenceSignal[] = [];

  // ── 0. 身份与目标 ──
  const identity = ports.identity();
  const declaredScope = [...new Set((input.goal.scope ?? []).map(relativeKey).filter(Boolean))].sort();
  const judgementRefs = [...new Set(input.goal.judgement_refs ?? [])].sort();
  const goalText = String(input.goal.text ?? '');
  for (const s of declaredScope) {
    const esc = scopeEscape(s);
    if (esc) {
      gaps.push({
        id: `scope:${s}`,
        kind: 'out-of-scope',
        subject: s,
        reason: `声明范围不是仓库相对路径：${esc} ⇒ 不参与任何"当前事实"的判定`,
        signals: [],
      });
    }
  }
  if (declaredScope.length === 0) limitations.push('目标没有声明范围（scope=[]）：所有相关度判定按"说不清"处理，不按全项目处理');

  // ── 1. 内容版本 ──
  let content: EvidenceFrame['content'] = { version: null, files: null, source_ref: 'content-version' };
  const cf = ports.content();
  if (cf.ok) {
    content = { version: cf.value.version, files: cf.value.files, source_ref: 'content-version:hashProjectFiles' };
  } else {
    content.source_ref = `content-version:unavailable`;
    gaps.push({
      id: 'content:unavailable',
      kind: 'unavailable',
      subject: 'content',
      reason: `当前源码内容版本算不出来（${cf.reason}）⇒ 任何版本对齐都判不了`,
      signals: [],
    });
    limitations.push(`内容版本不可用：${cf.reason}`);
  }

  // ── 2. 设计册 revision ──
  const design_revisions: EvidenceFrame['design_revisions'] = [];
  const dr = ports.designRevisions();
  if (!dr.ok) {
    gaps.push({
      id: 'design:unreadable',
      kind: 'unavailable',
      subject: 'design',
      reason: `设计册读不出来（${dr.reason}）⇒ 生命周期与判据都不许继承`,
      signals: [],
    });
  } else {
    // ★ 没有设计目录 / 没有可归属的册是**合法状态**（还没开垦；外部试点项目通常如此），
    //   不是"读失败"：它只意味着没有设计侧证据，不该抢在索引/测试前面把人叫来。
    if (dr.value.missingDir) {
      limitations.push('没有设计目录（还没开垦）：本次没有设计侧证据，生命周期按既有判据 default-active 处理');
    } else if (dr.value.revisions.length === 0) {
      limitations.push('设计目录在，但没有本项目可归属的册：本次没有设计侧证据');
    }
    for (const r of dr.value.revisions) {
      design_revisions.push(r);
      if (r.revision === null) {
        gaps.push({
          id: `design:revision-missing:${r.feature}`,
          kind: 'unavailable',
          subject: `design:${r.feature}`,
          reason: '册里没有 `_dsl_rev` ⇒ 设计版本未知（未知不是"最新"）',
          signals: [],
        });
      }
    }
  }

  // ── 3. 判据引用（DS-1R R-08）：必须有真实消费者 —— 解析不到就不是"无影响"
  const refRead = judgementRefs.length > 0 ? ports.judgementRefs(judgementRefs) : null;
  if (refRead) {
    if (!refRead.ok) {
      gaps.push({
        id: 'ref:unreadable',
        kind: 'unavailable',
        subject: 'judgement_refs',
        reason: `判据引用读不出来（${refRead.reason}）⇒ 目标与证据的对应关系不可判`,
        signals: [],
      });
    } else {
      for (const p of refRead.value.problems) {
        gaps.push({
          id: `ref:${p.kind}:${p.ref}`,
          // ★ U-03：`unsupported` 是"能力不支持"，不是"读不到"，也不是"歧义" —— 三态不许合并。
          kind: p.kind === 'ambiguous' ? 'ambiguous' : p.kind === 'unsupported' ? 'unsupported' : 'unavailable',
          subject: p.ref,
          reason: `判据引用不可用：${p.detail}`,
          signals: [],
        });
      }
      for (const r of refRead.value.resolved) {
        signals.push({
          id: `design:ref:${r.ref}`,
          kind: 'design',
          subject: { judgement_ref: r.ref },
          source_ref: `design-sheet:${r.feature}`,
          design_revision: design_revisions.find((d) => d.feature === r.feature)?.revision ?? undefined,
          scope: [`design:${r.feature}`],
          verdict: 'unknown', // ★ 本期不读该判据的当前 verdict ⇒ 不许写成 pass
          freshness: 'fresh',
          reason: `引用已解析到 ${r.feature} 的节点 ${r.node_id}#${r.index}（当前 verdict 未读，故本帧不据此宣称通过）`,
        });
        // ★ S-02：**引用存在 ≠ 判据成立** —— 当前 verdict 未读必须是一条未决缺口（会进 open_gaps）。
        gaps.push({
          id: `ref-verdict-pending:${r.ref}`,
          kind: 'pending',
          subject: r.ref,
          reason: `引用已解析（${r.feature} 节点 ${r.node_id}#${r.index}），但当前 verdict 未读 ⇒ 未决`,
          signals: [`design:ref:${r.ref}`],
        });
      }
    }
  }

  // ── 4. 索引事实 ──
  const index = ports.indexFacts();
  if (index.state === 'missing') {
    gaps.push({ id: 'index:missing', kind: 'missing', subject: 'index', reason: index.reason ?? '没有 cache.db', signals: [] });
  } else if (index.state === 'unusable') {
    gaps.push({ id: 'index:unusable', kind: 'unavailable', subject: 'index', reason: index.reason ?? 'schema 落后，需重建', signals: [] });
  } else if (index.state === 'unavailable') {
    gaps.push({ id: 'index:unavailable', kind: 'unavailable', subject: 'index', reason: index.reason ?? '开库失败', signals: [] });
  } else if (index.state === 'partial') {
    gaps.push({ id: 'index:partial', kind: 'missing', subject: 'index', reason: '索引没有覆盖磁盘（不全 ⇒ 看不见 ≠ 不存在）', signals: [] });
  }
  if ((index.stale_files ?? 0) > 0) {
    gaps.push({
      id: 'index:stale',
      kind: 'stale',
      subject: 'index',
      reason: `索引落后于磁盘：${index.stale_files}/${index.stale_total ?? '?'} 个文件不一致`,
      signals: [],
    });
  }
  if ((index.untrusted_refs ?? 0) > 0) {
    gaps.push({
      id: 'index:untrusted-refs',
      kind: 'unavailable',
      subject: 'index',
      reason: `索引内有 ${index.untrusted_refs} 条陈旧断言（声称已解析但目标已不在索引）⇒ 引用/影响结论可能静默漏报`,
      signals: [],
    });
  } else if (index.untrusted_refs === null && index.state !== 'missing') {
    // ★ S-03：`null` 是"**没测**"，不是"测了没有" ⇒ 不许 `?? 0` 吞掉；补一条防御性不可判缺口。
    gaps.push({
      id: 'index:untrusted-unknown',
      kind: 'unavailable',
      subject: 'index',
      reason: '陈旧断言数没测出来（查询失败/未执行）⇒ 索引可信度不可判，不许当 0 处理',
      signals: [],
    });
  }

  // ── 4. 改动集（注入；本模块不读 git） ──
  const rawChanged = (input.changed ?? []).map(relativeKey).filter(Boolean);
  const changed = [...new Set(rawChanged)].sort();
  let changedTrusted = input.changedTrusted !== false;
  for (const c of changed) {
    const esc = scopeEscape(c);
    if (esc) {
      gaps.push({ id: `changed:escaped:${c}`, kind: 'out-of-scope', subject: c, reason: `改动集里出现非仓库相对路径：${esc}`, signals: [] });
      changedTrusted = false;
    }
  }
  const codeChanged = changed.filter((f) => CODE_RE.test(f));
  if (!changedTrusted) {
    gaps.push({
      id: 'changed:untrusted',
      kind: 'unavailable',
      subject: 'changed',
      reason: '改动集不可信（读不到 git 或含越界路径）⇒ 空交集不许当安全',
      signals: [],
    });
    limitations.push('改动集不可信：本次不产生任何"未受影响 ⇒ 可继承"的结论');
  }
  // ★ DS-1R R-06：来源完整性要说清（缺哪一路 ⇒ 哪段时间的改动看不见），不许把"至少一路成功"当完整。
  if (input.changedNote) limitations.push(`改动集来源：${input.changedNote}`);

  // ── 5. 源码信号（逐文件当前指纹） ──
  for (const f of changed) {
    const hash = content.files?.[f];
    signals.push({
      id: `source:${f}`,
      kind: 'source',
      subject: { path: f },
      source_ref: 'content-version:hashProjectFiles',
      ...(hash ? { source_version: hash } : {}),
      scope: [f],
      verdict: 'unknown',
      freshness: hash ? 'fresh' : 'unavailable',
      ...(hash ? {} : { reason: '该文件不在内容指纹范围内（不是 src/tests/scripts/certs/design）⇒ 没有当前版本' }),
    });
  }

  // ── 6. 快照 + 权威继承裁决 ──
  const loaded = ports.snapshot();
  const testsOnDisk = ports.testObjects();
  const onDisk = testsOnDisk.ok ? [...new Set(testsOnDisk.value.map(relativeKey))].sort() : [];
  if (!testsOnDisk.ok) {
    gaps.push({
      id: 'tests:unavailable',
      kind: 'unavailable',
      subject: 'tests',
      reason: `测试对象扫不出来（${testsOnDisk.reason}）`,
      signals: [],
    });
  }

  const eligibility = ports.eligibility(onDisk);
  const excluded = eligibility.excluded.map((e) => ({ id: relativeKey(e.id), reason: e.reason }));
  const undetermined: Array<{ id: string; reason: string }> = eligibility.unjudgeable.map((u) => ({
    id: relativeKey(u.id),
    reason: u.reason,
  }));
  for (const e of eligibility.excluded) {
    signals.push({
      id: `design:excluded:${relativeKey(e.id)}`,
      kind: 'design',
      subject: { path: relativeKey(e.id) },
      source_ref: 'design-sheets:readDesignSheetsForGate',
      scope: [relativeKey(e.id)],
      verdict: 'unsupported',
      freshness: 'fresh',
      reason: 'retired',
    });
  }
  // ★ B8：空 eligible 但 excluded 非空，不是"零对象成功"。
  if (onDisk.length > 0 && eligibility.eligible.length === 0 && eligibility.excluded.length > 0) {
    gaps.push({
      id: 'eligible:empty-by-exclusion',
      kind: 'retired',
      subject: 'tests',
      reason: `全部可执行对象都被设计册判为不执行（excluded ${eligibility.excluded.length} 个）⇒ 不是"没有缺口"，是"没有可验证对象"`,
      signals: eligibility.excluded.map((e) => `design:excluded:${relativeKey(e.id)}`),
    });
  }
  if (undetermined.length > 0) {
    gaps.push({
      id: 'eligibility:unjudgeable',
      kind: 'conflicting',
      subject: 'eligibility',
      reason: `执行资格不可判：${undetermined.slice(0, 3).map((u) => `${u.id}（${u.reason}）`).join('；')}`,
      signals: [],
    });
  }

  // 权威裁决：继承/重跑/不可判唯一判据
  let plan: InheritancePlan | null = null;
  const snapshotMissing = loaded.status !== 'ok';
  if (loaded.status === 'missing') {
    // ★ DS-1R：读不到（EACCES/EISDIR）不是"首次运行" ⇒ 更重的缺口，且不许当基线缺失来"全跑即可"。
    if (loaded.unreadable) {
      gaps.push({
        id: 'snapshot:unreadable',
        kind: 'unavailable',
        subject: 'snapshot',
        reason: loaded.reason,
        signals: [],
      });
    } else {
      gaps.push({ id: 'snapshot:missing', kind: 'missing', subject: 'snapshot', reason: loaded.reason, signals: [] });
    }
  } else if (loaded.status === 'corrupt') {
    gaps.push({ id: 'snapshot:corrupt', kind: 'conflicting', subject: 'snapshot', reason: loaded.reason, signals: [] });
  }

  // ★ DS-1R：根目录代码路径（`a.ts`）会被现有影响面实现的 `includes('/')` 过滤丢掉 ⇒ 不许算成"空影响"。
  const rootLevelCode = codeChanged.filter((f) => !f.includes('/'));
  if (rootLevelCode.length > 0) {
    gaps.push({
      id: 'impact:root-level-path',
      kind: 'impact-untrusted',
      subject: rootLevelCode[0],
      reason: `改动集含仓库根目录代码路径（${rootLevelCode.join(', ')}）：现有影响面实现用 includes('/') 过滤对象 ⇒ 会静默丢成"空影响"`,
      signals: [],
    });
  }

  // ★ DS-1R2：无改动且改动集可信 ⇒ **空成功影响集**（与 verifyProject 一致），不许传 null。
  const noCodeChange = codeChanged.length === 0 && changedTrusted;
  // ★ T-03b：索引不可用时**连影响面端口都不碰**（不是"调了再靠端口自守"）——
  //   边界要在组装处就成立，否则 spy 会看到调用。
  const indexUsableForImpact = index.state === 'usable' || index.state === 'partial';
  const impactOr = codeChanged.length > 0 && rootLevelCode.length === 0 && indexUsableForImpact ? ports.impact(codeChanged) : null;
  // ★ T-03b/T-01：索引不可用时**不调端口**，但"影响面不可判"必须**显式成缺口**（不调 ≠ 没事）。
  if (codeChanged.length > 0 && rootLevelCode.length === 0 && !indexUsableForImpact) {
    gaps.push({
      id: 'impact:untrusted',
      kind: 'impact-untrusted',
      subject: 'impact',
      reason: `索引${index.state === 'missing' ? '不存在' : index.state === 'unusable' ? '需重建' : '不可用'}（${index.reason ?? '未知'}）⇒ 影响面未计算（本入口不碰写档读端）`,
      signals: [],
    });
  }
  let impact: ImpactSet | null = noCodeChange
    ? ({ ok: true, files: new Set<string>(), symbols: new Set<string>(), calls: 0, non_code: [] } as ImpactSet)
    : null;
  if (impactOr) {
    if (impactOr.ok && impactOr.value.ok) impact = impactOr.value;
    else {
      const why = impactOr.ok ? (impactOr.value as { reason: string }).reason : impactOr.reason;
      gaps.push({
        id: 'impact:untrusted',
        kind: 'impact-untrusted',
        subject: 'impact',
        reason: why,
        signals: [],
      });
    }
  }

  if (loaded.status === 'ok' && content.files) {
    const drift = contentDrift(loaded.snapshot.content.files, content.files);
    plan = planInheritance({
      loaded,
      changed: codeChanged,
      impact: impact,
      drift: [...drift.changed, ...drift.added, ...drift.removed],
      evidence: { objects_on_disk: onDisk.length, objects_indexed: loaded.snapshot.entries.length, label: '测试/契约对象' },
    });
    if (plan.state === 'widen' && plan.widen) {
      gaps.push({
        id: 'widen:required',
        kind: 'impact-untrusted',
        subject: 'widen',
        reason: plan.widen.reason,
        signals: [],
      });
    }
    if (plan.state === 'no-evidence' || plan.state === 'empty-observes') {
      // ★ T-01：**集合语义**的缺口 —— 把 subject 写成 'tests' 会让下游把它当成一个测试对象去跑。
      //   这里明确 subject 为空（没有单个对象），由策略走"全量/扩大验证"统一裁决。
      gaps.push({
        id: `snapshot:${plan.state}`,
        kind: 'missing',
        subject: '',
        reason: plan.note ?? `基线状态 ${plan.state}：有对象但没有可用证据（集合语义，不是单个对象）`,
        signals: [],
      });
    }
    for (const u of plan.undetermined) undetermined.push({ id: u.id, reason: u.reason });
  } else if (snapshotMissing) {
    limitations.push('没有可用基线 ⇒ 本次不给任何"可继承"结论（继承的唯一判据在 planInheritance，它没跑）');
  }

  // ── 7. 逐条测试证据：版本对齐（只能降级，不能升级） ──
  const snapshot = loaded.status === 'ok' ? loaded.snapshot : null;
  const authoritativelyInheritable = new Set((plan?.inherit ?? []).map((e) => e.id));
  const rerunIds = new Set((plan?.rerun ?? []).map((r) => r.id));
  const entries = snapshot?.entries ?? [];
  for (const e of entries) {
    const relId = e.id.startsWith('test:') ? relativeKey(e.id.slice('test:'.length)) : relativeKey(e.id);
    const declared = Array.isArray(e.observes) ? e.observes.filter((x): x is string => typeof x === 'string') : [];
    if (!Array.isArray(e.observes)) {
      limitations.push(`证据 ${e.id} 的 observes 形状非法（不是数组）⇒ 按"没声明观察面"处理，不参与交集判定`);
    }
    // ★ DS-1R R-09：测试证据必须把**测试主体自身**纳入观察面 —— 只改测试体、源码没变时旧 pass 必须失效。
    const ownPath = subjectOfEntryId(e.id).kind === 'test' ? subjectOfEntryId(e.id).path : undefined;
    const observes = ownPath ? [ownPath, ...declared.filter((x) => relativeKey(x) !== ownPath)] : declared;
    const align = observesAlignment({
      observes,
      baselineFiles: snapshot?.content.files ?? null,
      currentFiles: content.files,
    });
    let freshness = align.freshness;
    const reason = align.reason;
    const authoritative = authoritativelyInheritable.has(e.id);
    if (authoritative && freshness !== 'fresh') {
      // 权威说可继承、逐条对齐说不是当前 ⇒ 以"不是当前证据"为准（降级，不许升级），并留痕。
      freshness = 'stale';
      limitations.push(
        `证据 ${e.id}：权威裁决"可继承"，但逐条对齐判"${align.reason}" ⇒ 按过期处理（不偏向任何一边地宣称当前）`,
      );
    }
    if (rerunIds.has(e.id) && freshness === 'fresh') {
      // 权威要重跑 ⇒ 这条不是当前证据（保守：不许当 fresh 用）。
      freshness = 'stale';
    }
    signals.push({
      // ★ 快照条目 id 自己就带 `test:` / `contract:` 前缀 ⇒ 原样用作证据 id，
      //   不再加一层（否则会出现 `test:test:tests/…`：同一个对象两种写法，正好是歧义反例的形状）。
      id: e.id,
      kind: 'test',
      subject: { path: relId },
      source_ref: 'verified-snapshot:.agent-io/verified-snapshot.json',
      ...(snapshot?.content.version ? { source_version: snapshot.content.version } : {}),
      observed_at: e.at,
      scope: observes.map(relativeKey),
      verdict: e.verdict,
      freshness,
      reason,
    });
  }

  // 应验证但**自己没有 verdict** 的对象（★ DS-1R R-10：精确对象身份，不许 endsWith / 不许拿别人的 observes 冒充）
  const ownVerdictIds = new Set(
    entries.filter((e) => subjectOfEntryId(e.id).kind === 'test').map((e) => relativeKey(subjectOfEntryId(e.id).path ?? '')),
  );
  for (const id of eligibility.eligible) {
    const rel = relativeKey(id);
    if (ownVerdictIds.has(rel)) continue;
    gaps.push({
      id: `missing-evidence:${rel}`,
      kind: 'missing-evidence',
      subject: rel,
      reason: '对象存在，但基线里没有它**自己**的执行证据（别人的 observes 命中它不算）',
      signals: [],
    });
  }

  // ── 8. 冲突：互不相容的当前读数两边都留 ──
  const conflicts: FrameGap[] = [];
  const found = detectVerdictConflicts(signals);
  found.forEach((c, i) => {
    conflicts.push({
      id: `conflict:${i}:${c.subject}`,
      kind: 'conflicting',
      subject: c.subject,
      reason: c.reason,
      signals: [c.left, c.right].sort(),
    });
  });
  for (const c of conflicts) {
    for (const id of c.signals) {
      const s = signals.find((x) => x.id === id);
      if (s) s.freshness = 'conflicting';
    }
    gaps.push({ ...c });
  }

  // ── 9. 身份歧义：同路径多候选不取第一个 ──
  const amb = resolveSubjectCandidates([...onDisk, ...changed].map((raw) => ({ raw })));
  for (const a of amb.ambiguous) {
    gaps.push({
      id: `ambiguous:${a.key}`,
      kind: 'ambiguous',
      subject: a.key,
      reason: `同一对象有多个稳定身份：${a.ids.join(' | ')}（写法：${a.raws.join(' | ')}）⇒ 保留歧义，不取第一个`,
      signals: [],
    });
  }

  return {
    project: { root, identity },
    goal: { text: goalText, judgement_refs: judgementRefs, scope: declaredScope },
    content,
    design_revisions,
    index,
    capability: ports.capability(codeChanged),
    signals: sortById(signals),
    gaps: sortById(gaps),
    conflicts: sortById(conflicts),
    excluded: excluded.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    undetermined: undetermined.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    limitations: [
      ...limitations,
      'runtime 未接入：本期没有可靠的只读动态输入 ⇒ 不产生 runtime 证据，也不建议 observe',
      '成本模型未知：建议数不等于实际节省（首版不做任何毫秒/节省估计）',
      '`scope=[]` 只表示没声明范围，不代表全项目有效',
    ],
  };
}

/** 便于调用方构造"读不到"的端口实现（显式，而不是静默空集）。 */
export const unavailable = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/** 显式身份工具（供端口实现复用；与 `identityOf` 同一口径）。 */
export const portIdentity = (root: string): string => identityOf(root);
