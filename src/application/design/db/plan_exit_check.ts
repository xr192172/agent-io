/**
 * plan_exit_check.ts —— **出口闭环**：写完之后，源码与画布逐条对得上吗？
 *
 * ## 为什么它是整条链的最后一块（也是最容易缺的一块）
 * 没有它，"设计完成"与"代码正确"是两句话：计划写完了 ≠ 改到位了。三件事必须能判：
 *   ① **该在的在**：`rewrite`/`create` 的锚点符号在文件里真的存在；
 *   ② **该没的没**：`delete` 的锚点真的消失；
 *   ③ **没动的才是问题**：计划说改了、而文件内容自冻结以来**没变过** ⇒ 这条根本没落地。
 *
 * ## 判不了的，明说（不许假装）
 * · **判据转绿**：`judgement_ref` 是自由文本（`cert:t380/②`），本模块**不执行**它 ——
 *   真要判"转绿"得跑那套判据（`judgeExpectations` / 证），这里**只如实标注"需另跑"**；
 * · **意图是否实现**：哈希只能说明"变了"，不能说明"变成了想要的"。⇒ 本模块给的是**必要条件**，
 *   不是充分条件。这一条写死在这儿，免得以后有人拿它当"绝对正确"的证明。
 *
 * ## 判据来源（不引第二份事实）
 * · 符号存在性：`cache.db` 的 `nodes`（实际 DB）；索引不可用 ⇒ 如实报 `index_unavailable`，不猜；
 * · 是否改过：文件内容哈希 vs 画布冻结时记的 `base.content_hash`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectCacheDbPath } from '../../../infrastructure/index/db.js';
import { contentHash } from '../../../infrastructure/index/symbols.js';
import { readRewritePlan, type RewritePlanEntry } from './rewrite_plan.js';

/** 一条 entry 的闭环结论 */
export interface ExitEntryVerdict {
  entry: RewritePlanEntry;
  /** 该在的在 / 该没的没 */
  anchor_ok: boolean;
  /** 文件内容自冻结以来**变过**（null = 没冻结指纹，判不了） */
  changed_since_freeze: boolean | null;
  /** 三步合起来的结论 */
  verdict: 'realized' | 'not_yet' | 'stale_anchor' | 'unjudgeable';
  why: string;
}

export interface ExitCheckResult {
  path: string;
  file_exists: boolean;
  entries: ExitEntryVerdict[];
  /** ★ 计划**之外**的符号（本次改了却没计划 ⇒ 静默风险，必须报出来） */
  unplanned: string[];
  /** 判据是否转绿**不在本模块的能力范围**（如实标注）；调用方要拿 `judgement_ref` 另跑 */
  judgement_ref_runs_needed: string[];
  error?: string;
}

/**
 * 跑一次出口闭环。
 * @param projectRoot 项目根
 * @param relPath 源码仓库相对路径（与画布 `path` 同一口径）
 */
export function checkRewriteExit(projectRoot: string, relPath: string): ExitCheckResult {
  const root = path.resolve(projectRoot);
  const rel = relPath.split(path.sep).join('/');
  const plan = readRewritePlan(root, rel);
  const abs = path.join(root, rel);
  const out: ExitCheckResult = {
    path: rel,
    file_exists: fs.existsSync(abs),
    entries: [],
    unplanned: [],
    judgement_ref_runs_needed: [],
  };
  if (!plan) {
    out.error = '没有画布（`plan/<rel>.plan.json` 不存在）⇒ 无从对账';
    return out;
  }
  if (!out.file_exists) {
    out.error = '源码文件不存在 ⇒ 只能判 `delete` 类；其余条目按 not_yet';
  }

  // ── 符号现状：只认实际 DB（`cache.db`），不猜 ─────────────
  let names: Set<string> | null = null;
  try {
    const dbFile = projectCacheDbPath(root);
    if (fs.existsSync(dbFile)) {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      // ★ 排除 `kind='file'`（那是"文件节点"本身，名 = 文件名）——它不是符号，别混进"计划外符号"
      // ★ 2026-10-28（真实开发试点读数 #5b）：**只算顶层符号**（`parent IS NULL`）—— 与覆盖判据
      //   （`write_gate#symbolsInFileOf`）和设计 DB 投影**同一把尺**；否则内层 helper（`visit`）会被当成计划外。
      const rows = db
        .prepare("SELECT name FROM nodes WHERE file_path = ? AND kind != 'file' AND parent IS NULL")
        .all(rel) as Array<{ name: string }>;
      db.close();
      names = new Set(rows.map((r) => r.name));
    }
  } catch {
    names = null;
  }
  if (!names) out.error = out.error ?? '索引不可用（`cache.db` 不在或读不了）⇒ 锚点存在性判不了';

  const nowHash = out.file_exists ? contentHash(fs.readFileSync(abs, 'utf-8')) : null;
  const frozenHash = plan.base?.content_hash ?? null;
  const changed = nowHash && frozenHash ? nowHash !== frozenHash : null;

  const planned = new Set<string>();
  // ★ 2026-10-28（真实开发试点读数 #5）：**"计划外符号"必须把"声明过的"扣掉** ——
  //   否则用紧凑声明（`untouched_default`）的计划会被报成"19 个计划外符号"，全是噪声。
  //   判据：`entries`（要改）+ `untouched`（看过不动）+ 紧凑声明覆盖的冻结快照 = **已表态**。
  const declaredElsewhere = new Set<string>((plan.untouched ?? []).map((u) => u.symbol).filter(Boolean));
  const frozenAll = new Set<string>(plan.symbols_at_freeze ?? []);
  for (const e of plan.entries) {
    const sym = e.anchor?.symbol ?? '';
    if (sym) planned.add(sym);
    if (e.judgement_ref?.trim()) out.judgement_ref_runs_needed.push(e.judgement_ref);
    if (names === null) {
      out.entries.push({ entry: e, anchor_ok: false, changed_since_freeze: changed, verdict: 'unjudgeable', why: '索引不可用 ⇒ 判不了锚点' });
      continue;
    }
    const exists = names.has(sym);
    if (e.kind === 'delete') {
      const ok = !exists;
      out.entries.push({
        entry: e,
        anchor_ok: ok,
        changed_since_freeze: changed,
        verdict: ok ? 'realized' : 'not_yet',
        why: ok ? `\`${sym}\` 已从文件里消失（删除到位）` : `\`${sym}\` 还在 ⇒ 删除没做`,
      });
      continue;
    }
    if (!exists) {
      out.entries.push({
        entry: e,
        anchor_ok: false,
        changed_since_freeze: changed,
        verdict: 'stale_anchor',
        why: `\`${sym}\` 在 ${rel} 里找不到（改名/删了/拼错了）⇒ 计划过期，先核对再改`,
      });
      continue;
    }
    const done = changed === null ? null : changed;
    out.entries.push({
      entry: e,
      anchor_ok: true,
      changed_since_freeze: changed,
      verdict: done === true ? 'realized' : done === false ? 'not_yet' : 'unjudgeable',
      why:
        done === true
          ? `\`${sym}\` 在，且文件自冻结以来已改过（哈希变了）`
          : done === false
            ? `\`${sym}\` 在，但文件**自冻结以来没变过** ⇒ 改动没落地`
            : `\`${sym}\` 在；但画布没记冻结指纹（\`base.content_hash\`）⇒ 判不出"改没改"`,
    });
  }

  if (names) {
    for (const n of names) {
      if (planned.has(n) || declaredElsewhere.has(n)) continue; // 已表态（要改 / 看过不动）
      if (plan.untouched_default && frozenAll.has(n)) continue; // 紧凑声明覆盖（冻结时就在的符号）
      out.unplanned.push(n);
    }
  }
  return out;
}

/** 一行摘要（回执用） */
export function renderExitCheck(r: ExitCheckResult): string {
  const t = (v: string): number => r.entries.filter((e) => e.verdict === v).length;
  const head = `出口闭环 ${r.path}：realized ${t('realized')} · not_yet ${t('not_yet')} · stale ${t('stale_anchor')} · 判不了 ${t('unjudgeable')}`;
  const tail = r.unplanned.length ? ` · ★ 计划外符号 ${r.unplanned.length} 个（${r.unplanned.slice(0, 3).join(', ')}…）` : '';
  return head + tail + (r.error ? ` · ⚠ ${r.error}` : '');
}
