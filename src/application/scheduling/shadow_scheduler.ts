/**
 * 只读影子调度器 —— 把**现有事实读端**接成端口，组装证据帧，调用纯策略，输出影子计划。
 *
 * ## 它不执行计划
 * 本模块只产建议。词表里没有写/完成/提交/回滚；`assertReadOnlyPlan()` 在返回前再断一次。
 *
 * ## 零写入的四道闸（DS-1R 收紧后）
 * 1. **不经 `invokeTool`**：那会做自动保鲜（`ensureProjectIndex`）与首触建索引（`scheduleBackfill`）。
 * 2. **索引不存在 ⇒ 报缺口**：不 import、不冷启、不建库。
 * 3. **形状闸**：先只读打开 + `cacheSchemaIsCurrent()`（**同一把尺**）判"版本 + 关键表/列"，
 *    不满足就只报"需重建"，连一次迁移的机会都不给（只看版本号会放过"版本对、形状坏"的库）。
 * 4. **影响面走注入的只读连接**：`impactOfChanged(..., {db})` / `diffImpact({db})` 用同一条
 *    `DatabaseSync(readOnly:true)` 跑同一套算法 —— 不再有"写档打开 + 热 WAL 特判"这条后门。
 *
 * ## 读失败必须可见（DS-1R R-07）
 * `hashProjectFiles` / `scanTestObjects` 的部分失败通过 collector 收上来；`countStaleResolvedRefsEx` /
 * `indexCoversDiskEx` 走双出口；快照读失败用 `unreadable` 区分"没有"与"读不到"。任一路有失败 ⇒
 * 该端口报 `unavailable`，**不许**退回"ok + 空集"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  type CapabilityFacts,
  type IndexFacts,
  type ReadOr,
  type ReadOnlyPorts,
  buildEvidenceFrame,
  portIdentity,
} from './evidence_frame.js';
import { type EvidenceFrame } from '../../domain/scheduling_evidence.js';
import { type ShadowPlan, assertReadOnlyPlan, planShadow } from '../../domain/scheduling_policy.js';

import { cacheSchemaIsCurrent, projectCacheDbPath, SCHEMA_VERSION, type Database } from '../../infrastructure/index/db.js';
import { detectStaleIndex, indexCoversDiskEx } from '../../infrastructure/index/index_freshness.js';
import { countStaleResolvedRefsEx, readRawSchemaVersion } from '../meta/integrity/index_integrity.js';
import {
  hashProjectFiles,
  contentVersion,
  loadVerifiedSnapshot,
  scanTestObjects,
  type ScanSkip,
} from '../design/verified_snapshot.js';
import { adjudicateTestObjects } from '../verify/execution_intents.js';
import { impactOfChanged, type ImpactSet } from '../../infrastructure/analysis/facts/impact_set.js';
import { readDesignSheetsForGate } from '../../infrastructure/storage.js';
import { detectRunner } from '../verify/verify_project.js';
import { parseCapabilityForFile } from '../refactor/parse_capability/parse_capability.js';

/** 端口调用回执：哪一路读失败、为什么。★ 失败必须留痕（读不到 ≠ 没有）。 */
export interface PortReceipt {
  port: string;
  status: 'ok' | 'unavailable';
  reason?: string;
}

export interface ShadowRunInput {
  root: string;
  goal?: { text?: string; judgement_refs?: string[]; scope?: string[] };
  changed?: string[];
  changedTrusted?: boolean;
  changedNote?: string;
  budget?: number;
}

export interface ShadowRunResult {
  frame: EvidenceFrame;
  plan: ShadowPlan;
  receipts: PortReceipt[];
}

const REF_RE = /^decision:(?:([^:#]+):)?([^:#]+)#(\d+)$/;

/**
 * 真实只读端口。每一路失败都写回执并降级成 `unavailable`；任何一路都不许静默返回空集。
 */
export function createReadOnlyPorts(root: string, receipts: PortReceipt[] = []): ReadOnlyPorts & { close: () => void } {
  const note = (port: string, status: 'ok' | 'unavailable', reason?: string): void => {
    receipts.push(reason === undefined ? { port, status } : { port, status, reason });
  };

  /** 只读连接（形状当前才给）：调用方负责 close。 */
  const openReadOnly = (): { db: Database } | { why: string; state: 'missing' | 'unusable' | 'unavailable' } => {
    const file = projectCacheDbPath(root);
    if (!fs.existsSync(file)) return { state: 'missing', why: 'cache.db 不存在（本入口不建索引）' };
    const raw = readRawSchemaVersion(root);
    if (!raw.exists) return { state: 'unavailable', why: 'cache.db 打不开或 schema_versions 不可读' };
    let db: Database | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true }) as unknown as Database;
      // ★ 形状闸：版本对但缺表/缺列的库，进写档打开就会被迁移 ⇒ 这里只判、不开写档。
      if (!cacheSchemaIsCurrent(db)) {
        const cur = raw.version;
        const why = cur === SCHEMA_VERSION
          ? `索引 schema 版本为 v${cur} 但**形状不完整**（关键表/列缺失）⇒ 需重建（本入口不迁移）`
          : `索引 schema 为 ${cur === null ? '未知' : `v${cur}`}，当前要求 v${SCHEMA_VERSION} ⇒ 需重建（本入口不迁移）`;
        try {
          db.close();
        } catch {
          /* 已关闭 */
        }
        return { state: 'unusable', why };
      }
      return { db };
    } catch (e) {
      try {
        db?.close();
      } catch {
        /* 已关闭 */
      }
      return { state: 'unavailable', why: `只读打开 cache.db 失败：${(e as Error).message}` };
    }
  };

  const computeIndexFacts = (): { facts: IndexFacts; db: Database | null } => {
    const opened = openReadOnly();
    if (!('db' in opened)) {
      note('indexFacts', 'unavailable', opened.why);
      return {
        facts: {
          state: opened.state,
          schema_version: null,
          stale_files: null,
          stale_total: null,
          untrusted_refs: null,
          reason: opened.why,
        },
        db: null,
      };
    }
    const db = opened.db;
    /**
     * ★ T-04：打开连接后的**所有**探测/计数/覆盖调用都在这一个 try 里 ——
     * 任一处抛错都必须 (a) 关闭**本次局部连接**（此刻它还没进 cached，外层 finally 看不到它）
     * (b) 返回 unavailable + 诊断，而不是把异常抛出去变成无诊断崩溃。
     */
    try {
      const probe = detectStaleIndex(db, root);
      const untrusted = countStaleResolvedRefsEx(db);
      const covers = indexCoversDiskEx(db, root);
      const failures: string[] = [];
      if (!untrusted.ok) failures.push(untrusted.reason);
      if (!covers.ok) failures.push(String(covers.error));
      if (probe.unreadable.length > 0) failures.push(`${probe.unreadable.length} 个已索引文件读不到（例：${probe.unreadable[0]}）`);
      if (failures.length > 0) note('indexFacts', 'unavailable', failures.join(' · '));
      else note('indexFacts', 'ok');
      return {
        facts: {
          // ★ 任一必要读取失败 ⇒ unavailable（不许 usable/partial："查了一部分"不等于"可判"）
          state: failures.length > 0 ? 'unavailable' : covers.covers ? 'usable' : 'partial',
          schema_version: SCHEMA_VERSION,
          stale_files: probe.stale,
          stale_total: probe.total,
          // ★ 查询失败 ⇒ null（"没测"），不是 0（"测了没有"）
          untrusted_refs: untrusted.ok ? untrusted.count : null,
          ...(failures.length > 0 ? { reason: failures.join(' · ') } : {}),
        },
        db,
      };
    } catch (e) {
      try {
        db.close();
      } catch {
        /* 已关闭 */
      }
      note('indexFacts', 'unavailable', `索引探测抛错：${(e as Error).message}`);
      return {
        facts: {
          state: 'unavailable',
          schema_version: SCHEMA_VERSION,
          stale_files: null,
          stale_total: null,
          untrusted_refs: null,
          reason: `索引探测抛错（连接已关闭）：${(e as Error).message}`,
        },
        db: null,
      };
    }
  };

  // 索引事实只算一次（impact 也要用它的连接），连接在使用后显式 close。
  let cached: { facts: IndexFacts; db: Database | null } | null = null;
  const indexFacts = (): IndexFacts => (cached ??= computeIndexFacts()).facts;

  const withIndexDb = <T,>(fallback: (why: string) => T, use: (db: Database) => T): T => {    indexFacts();
    const db = cached?.db ?? null;
    if (!db) return fallback(String((cached?.facts.reason ?? '索引不可用')));
    return use(db);
  };

  return {
    identity: () => portIdentity(root),

    content: () => {
      const skipped: ScanSkip[] = [];
      try {
        const files = hashProjectFiles(root, skipped);
        if (skipped.length > 0) {
          note('content', 'unavailable', `${skipped.length} 个对象读不到（例：${skipped[0].path} / ${skipped[0].why}）`);
          return { ok: false, reason: `内容指纹不完整：${skipped.length} 个对象读不到（例：${skipped[0].path}）⇒ 版本对齐不可判` };
        }
        note('content', 'ok');
        return { ok: true, value: { version: contentVersion(files), files } };
      } catch (e) {
        note('content', 'unavailable', (e as Error).message);
        return { ok: false, reason: `内容指纹算不出来：${(e as Error).message}` };
      }
    },

    designRevisions: () => {
      try {
        const read = readDesignSheetsForGate(root);
        const revisions = read.sheets.map((s) => {
          const rev = (s as unknown as { _dsl_rev?: unknown })._dsl_rev;
          return {
            feature: s.feature,
            revision: typeof rev === 'number' ? `${s.feature}#${rev}` : null,
            source_ref: `design-sheet:${s.feature}`,
          };
        });
        note('designRevisions', 'ok');
        return { ok: true, value: { revisions, missingDir: read.missingDir } };
      } catch (e) {
        note('designRevisions', 'unavailable', (e as Error).message);
        return { ok: false, reason: `设计册读不出来：${(e as Error).message}` };
      }
    },

    indexFacts,

    snapshot: () => {
      const loaded = loadVerifiedSnapshot(root);
      note(
        'snapshot',
        loaded.status === 'ok' ? 'ok' : 'unavailable',
        loaded.status === 'ok' ? undefined : loaded.reason,
      );
      return loaded;
    },

    testObjects: (): ReadOr<string[]> => {
      const skipped: ScanSkip[] = [];
      try {
        const list = scanTestObjects(root, skipped);
        if (skipped.length > 0) {
          note('testObjects', 'unavailable', `${skipped.length} 个目录读不到（例：${skipped[0].path}）`);
          return { ok: false, reason: `测试对象扫描不完整：${skipped.length} 个目录读不到（例：${skipped[0].path}）` };
        }
        note('testObjects', 'ok');
        return { ok: true, value: list };
      } catch (e) {
        note('testObjects', 'unavailable', (e as Error).message);
        return { ok: false, reason: `测试对象扫不出来：${(e as Error).message}` };
      }
    },

    eligibility: (ids) => {
      const verdict = adjudicateTestObjects(root, ids);
      note(
        'eligibility',
        verdict.unjudgeable.length > 0 ? 'unavailable' : 'ok',
        verdict.unjudgeable.length > 0 ? `${verdict.unjudgeable.length} 个不可判` : undefined,
      );
      return verdict;
    },

    judgementRefs: (refs) => {
      try {
        const read = readDesignSheetsForGate(root);
        const byFeature = new Map(read.sheets.map((s) => [s.feature, s as unknown as {
          feature: string;
          geometry?: { nodes?: Array<{ id?: string; decision?: { expectations?: unknown[] } }> };
        }]));
        const all = [...byFeature.values()];
        const resolved: Array<{ ref: string; feature: string; node_id: string; index: number }> = [];
        const problems: Array<{
          ref: string;
          kind: 'malformed' | 'missing' | 'out-of-range' | 'ambiguous' | 'unsupported';
          detail: string;
        }> = [];
        for (const ref of refs) {
          // ★ U-03（方案 B）：`cert:<证>#<检查号>` 是**判据侧身份**，但本期**没有**真实证书存储/消费者
          //   ⇒ 生产端口显式 `unsupported`（不是 malformed、更不是 resolved）。
          //   理由：模拟端口曾把它标成 resolved，造成"策略接受 / 生产 malformed / 测试模拟成功"三头语义。
          if (/^cert:/i.test(ref)) {
            problems.push({
              ref,
              kind: 'unsupported',
              detail:
                'cert 引用本期**不支持**：没有真实证书存储与消费者 ⇒ 不解析、不生成 run_judgement（后续有真实消费者再接）',
            });
            continue;
          }
          const m = REF_RE.exec(ref);
          if (!m) {
            problems.push({ ref, kind: 'malformed', detail: '形态应为 decision:<feature>:<node>#<i> 或 decision:<node>#<i>' });
            continue;
          }
          const wantFeature = m[1];
          const nodeId = m[2];
          const idx = Number(m[3]);
          const hits: Array<{ feature: string; node: { id?: string; decision?: { expectations?: unknown[] } } }> = [];
          for (const f of all) {
            if (wantFeature && f.feature !== wantFeature) continue;
            for (const n of f.geometry?.nodes ?? []) if (n.id === nodeId) hits.push({ feature: f.feature, node: n });
          }
          if (hits.length === 0) {
            problems.push({ ref, kind: 'missing', detail: `册里找不到节点 ${nodeId}${wantFeature ? `（限定册 ${wantFeature}）` : ''}` });
            continue;
          }
          if (hits.length > 1) {
            problems.push({ ref, kind: 'ambiguous', detail: `节点 ${nodeId} 在 ${hits.length} 册里同名：${hits.map((h) => h.feature).join(' / ')}` });
            continue;
          }
          const n = hits[0].node;
          const count = (n.decision?.expectations ?? []).length;
          if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
            problems.push({ ref, kind: 'out-of-range', detail: `节点 ${nodeId} 只有 ${count} 条判据，#${m[3]} 越界` });
            continue;
          }
          resolved.push({ ref, feature: hits[0].feature, node_id: nodeId, index: idx });
        }
        note('judgementRefs', problems.length > 0 ? 'unavailable' : 'ok', problems.length > 0 ? `${problems.length} 个引用不可用` : undefined);
        return { ok: true, value: { resolved, problems } };
      } catch (e) {
        note('judgementRefs', 'unavailable', (e as Error).message);
        return { ok: false, reason: `判据引用解析失败：${(e as Error).message}` };
      }
    },

    impact: (changed) => {
      const facts = indexFacts();
      if (facts.state !== 'usable' && facts.state !== 'partial') {
        note('impact', 'unavailable', `索引状态 ${facts.state} ⇒ 不计算影响面`);
        return {
          ok: false,
          reason: `索引${facts.state === 'unusable' ? '需重建' : facts.state === 'missing' ? '不存在' : '不可用'} ⇒ 影响面不可判`,
        };
      }
      return withIndexDb<ReadOr<ImpactSet>>(
        (why) => {
          note('impact', 'unavailable', why);
          return { ok: false, reason: `索引不可用 ⇒ 影响面不可判（${why}）` };
        },
        (db) => {
          try {
            // ★ 同一算法、同一份集合语义，只是**注入只读连接**：不建库、不迁移、不设 WAL。
            const out = impactOfChanged(root, changed, { db });
            note('impact', out.ok ? 'ok' : 'unavailable', out.ok ? undefined : out.reason);
            return { ok: true, value: out };
          } catch (e) {
            note('impact', 'unavailable', (e as Error).message);
            return { ok: false, reason: `影响面计算失败：${(e as Error).message}` };
          }
        },
      );
    },

    capability: (paths): CapabilityFacts => {
      try {
        const det = detectRunner(root);
        const tiers = paths.map((p) => ({ path: p, tier: parseCapabilityForFile(p).tier }));
        note('capability', det.runner ? 'ok' : 'unavailable', det.runner ? undefined : det.why);
        return { runner: det.runner ? det.runner.kind : null, tiers, reason: det.why };
      } catch (e) {
        note('capability', 'unavailable', (e as Error).message);
        return { runner: null, tiers: [], reason: `能力探测失败：${(e as Error).message}` };
      }
    },

    /** ★ 释放本进程开的只读连接（不归连接池管，必须自己关）。 */
    close: () => {
      const db = cached?.db ?? null;
      cached = null;
      try {
        db?.close();
      } catch {
        /* 已关闭 */
      }
    },
  };
}

/**
 * 影子调度主入口：读事实 → 组帧 → 纯策略 → 计划。**不执行、不落盘、不缓存**。
 * 只读连接在本函数返回前关闭（`finally`），计划里出现写类动作会当场抛。
 */
export function runShadowScheduler(input: ShadowRunInput): ShadowRunResult {
  const root = path.resolve(input.root);
  const receipts: PortReceipt[] = [];
  const ports = createReadOnlyPorts(root, receipts);
  try {
    const frame = buildEvidenceFrame({
      root,
      goal: input.goal ?? {},
      changed: input.changed,
      changedTrusted: input.changedTrusted,
      changedNote: input.changedNote,
      ports,
    });
    const plan = planShadow(frame, { budget: input.budget });
    assertReadOnlyPlan(plan);
    return { frame, plan, receipts };
  } finally {
    // 端口里缓存的只读连接（若有）必须在返回前释放：它是本进程开的，不归连接池管。
    try {
      ports.close();
    } catch {
      /* 已关闭 */
    }
  }
}
