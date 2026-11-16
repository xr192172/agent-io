/**
 * ledger_staleness.ts —— **销账三层机制的 L1：账本陈旧的三个判据**（纯读；宿主 = `scripts/patrol.mjs`）
 *
 * ## 它回答的三个问题（S1 / S2 / S3 —— 各自独立、各自带分母）
 * | 判据 | 问题 | 「唯一的尺」住哪儿 |
 * |---|---|---|
 * | S1 | 册里那些**声明**（「零调用 / 未接线」）是不是**已经被取代**了？ | 既有 wiring 枚举的判定核 `wiring_enumerate#consumesModule` + 它那条**脚本入口**先例 |
 * | S2 | **终态卡**（done / void）上的证据，相对**此刻的代码**还作数吗？ | `task_schema#evidenceFreshness`（current 用 `covers` 现算，走 `task_ops#codeFingerprintAt`） |
 * | S3 | 做了事**没销账**的欠账还有哪些？ | `DriftReport.missed_close` + `scripts/write-log-audit.mjs` 的对账读数（**同一份**，不重写） |
 *
 * ## 三条纪律（每条都对应一次实测）
 * ① **只报，不改**：`task_plan` **没有写入口**（`task_ops#task_plan.update` 只认 `state_machine` / `criteria` 等），
 *    ⇒ S1 的产物是「这一行已被取代 + 证据 `file:line`」，**不要求改册**；本文件不开任何写盘路径。
 * ② **判不了 ≠ 绿**：册读不到 / 指纹算不出 / 对账器跑不了 ⇒ 各自记 `unavailable` 并**照常报出来**；
 *    S2 的 `unverifiable` 与 `stale` **分开报**（前者「当年没记」，后者「记了、但已不同」）。
 * ③ **不报数量多**（0.16）：S1 只报**已取代**那几条（真异常候选），其余只给分母；
 *    S3 只点名欠账，不做排行、不给"欠了多少条"的进度条。
 *
 * ## 为什么它不吃 `judgeExpectations`（90–105s 热路径禁入）
 * 三条判据**一条都不重判**：S1 读接线事实（静态消费点），S2 比指纹（`evidenceFreshness`），
 * S3 读**已经算过**的 `DriftReport` 与**既有**对账器。⇒ 整段是本仓内环可接受的秒级开销。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { getDesignSheet, getDesignSheetFile } from '../../infrastructure/storage.js';
import { consumesModule } from '../../infrastructure/analysis/health/wiring_enumerate.js';
import { codeFingerprintAt } from '../design/dsl_ops/task_ops.js';
import { evidenceFreshness, isClosedTaskState, taskOfNode, type TaskSpec } from '../../domain/task_schema.js';
import type { DesignDSL } from '../../domain/types.js';

// ════════════════════════════════════════════════════════════════════
// 形状
// ════════════════════════════════════════════════════════════════════

/** S1 的一条册内声明 */
export interface SheetClaim {
  /** 册里的位置（`task_plan.patrols[0].unjudged`）—— 红的时候必须点名到格 */
  where: string;
  /** 声明原文（**逐字**，不改写；输出时截断） */
  text: string;
}

export type StaleClaimVerdict = 'superseded' | 'still-true' | 'unverifiable';
/** 两档制：落在**近期被改路径**上的才算真异常（利息维度），其余是信息档 */
export type LedgerTier = 'info' | 'anomaly';

export interface StaleClaimRow {
  where: string;
  claim: string;
  symbol: string;
  verdict: StaleClaimVerdict;
  /** `file:line`（`null` = 没找到消费点） */
  evidence: string | null;
  why: string;
  age_ms: number | null;
  tier: LedgerTier;
}

export interface WiringFact {
  symbol: string;
  /** 声明它的模块（仓库相对 posix 路径；空 = src 里找不到这个符号的导出） */
  export_modules: string[];
  wired: boolean;
  /** 消费点 `file:line` */
  evidence: string | null;
  /** 扫了多少个**消费面**文件（分母） */
  scanned: number;
  note: string;
}

export interface EvidenceRow {
  card_id: string;
  state: 'done' | 'void';
  /** 那条证据的时刻（ISO 8601，原样） */
  at: string;
  freshness: 'stale' | 'unverifiable';
  covers: string[];
  why: string;
}

export interface UnsettledRow {
  kind: 'missed_close' | 'no_card_write';
  /** 卡 id / `at|file` */
  id: string;
  detail: string;
  age_ms: number | null;
}

/** `scripts/write-log-audit.mjs --json` 的**读数**（本文件只消费，不重写对账逻辑） */
export interface NoCardWriteSummary {
  no_card: number;
  total?: number;
  by_branch?: Record<string, number>;
  rows?: ReadonlyArray<{ at?: string; file?: string; actor?: string; source?: string; branch?: string; gate_branch?: string }>;
  boundary?: string;
}

export interface LedgerStalenessReport {
  feature: string;
  scanned_at: number;
  /** `false` = 有一条判据判不了（★ 不是"全部干净"） */
  ok: boolean;
  unavailable: string | null;
  /** age 口径（写在报告里，别让读端以为它是"声明写入时刻"） */
  age_basis: 'sheet-last-commit';
  sheet_age_ms: number | null;
  last_patrol_age_ms: number | null;
  s1: {
    claims: number;
    superseded: StaleClaimRow[];
    unverifiable: StaleClaimRow[];
    still_true: number;
    scanned_files: number;
    unavailable: string | null;
  };
  s2: {
    closed_cards: number;
    with_evidence: number;
    valid: number;
    stale: EvidenceRow[];
    unverifiable: EvidenceRow[];
    unavailable: string | null;
  };
  s3: {
    missed_close: UnsettledRow[];
    no_card_write: UnsettledRow[];
    no_card_total: number | null;
    by_branch: Record<string, number>;
    unavailable: string | null;
  };
}

// ════════════════════════════════════════════════════════════════════
// S1 · 册内声明 stale（抽符号 → 用既有 wiring 判"是不是其实已接线"）
// ════════════════════════════════════════════════════════════════════

/**
 * 扫描面（★ 默认 = 本仓约定，与 `wiring_enumerate#importersOfDir` 的 3 个目录同口径）：
 * 实现住 `src/`，真实调用点住 `src + tests + scripts`（CLI / 常驻入口都从 `scripts/` 拉起）。
 */
export interface WiringScanDirs {
  exportDirs?: readonly string[];
  consumerDirs?: readonly string[];
}

const DEFAULT_EXPORT_DIRS = ['src'];
const DEFAULT_CONSUMER_DIRS = ['src', 'tests', 'scripts'];
const TS_EXT = /\.ts$/;
const TS_OR_MJS = /\.(ts|mjs|cjs|js)$/;

/**
 * 只扫 `unjudged` 这一格（★ 不是"整册散文"）：`task_plan.patrols[]` 里只有它
 * 是**声明**（"这个 metric 判不了、因为 X"）。
 * ★ 为什么**不**把 `metric` / `note` 也收进来：它们含「算不出来 / 不可实现」这类
 *   **"算不出来"** 的措辞 —— 那是另一件事，拿它去比接线事实会造出满屏假阳（0.16）。
 */
const CLAIM_FIELDS = new Set(['unjudged']);
/** 只有这几种措辞才是「**没接上**」型声明（能被接线事实证伪） */
const WIRE_CLAIM = /零调用|未调用|没人调|无人调用|从未被调用|零\s*import|未接线|没有接线|未接上/;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 证据行号 —— ★ 必须指到**真消费那一行**，不是"注释里第一次提到"。
 * 实测（2026-11-16，真仓）：`scripts/patrol.mjs` 的**文件头注释第 6 行**就写着 `` `patrolDrift` ``，
 * 而真正的调用在 `:40`。只取"首次出现"⇒ 证据指到一段散文上，读端照样得自己找。
 * 优先级：① 同一行既有 import 语义又点了名 → ② `import(` 后 3 行内点名 → ③ 首次出现（兜底，可能是注释）。
 */
function evidenceLineOf(text: string, symbol: string): number {
  const lines = text.split(/\r?\n/);
  const sym = new RegExp(`\\b${esc(symbol)}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (sym.test(lines[i]) && /\bimport\b|\bfrom\s+['"]/.test(lines[i])) return i + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    if (!/import\s*\(/.test(lines[i])) continue;
    for (let j = i; j < Math.min(i + 3, lines.length); j++) if (sym.test(lines[j])) return j + 1;
  }
  for (let i = 0; i < lines.length; i++) if (sym.test(lines[i])) return i + 1;
  return 0;
}
const readText = (root: string, rel: string): string => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8');
  } catch {
    return '';
  }
};
const baseOf = (rel: string): string => path.basename(rel).replace(/\.(ts|mts|cts)$/, '');
const exportsSymbol = (text: string, symbol: string): boolean =>
  new RegExp(
    `(?:^|\\n)\\s*export\\s+(?:declare\\s+)?(?:async\\s+)?(?:default\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${esc(symbol)}\\b`,
  ).test(text);

function walkFiles(root: string, dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  const stack: string[] = [path.join(root, dir)];
  while (stack.length) {
    const abs = stack.pop() as string;
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue; // 目录不存在 ⇒ 该面为空（分母会说清扫了几个文件）
    }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!exts.test(e.name)) continue;
      out.push(path.relative(root, p).replace(/\\/g, '/'));
    }
  }
  return out;
}

/**
 * `package.json` 的 `scripts` 里是否有指向 `scripts/<x>.mjs` 的那一条 —— **照抄**
 * `wiring_enumerate#scriptEntryFor` 的判据（`npm scripts 指向 + 文件在盘上`）。
 *
 * ★ 为什么必须补这一格（不是"多写一遍"）：`scripts/patrol.mjs` 加载 `patrolDrift` 的方式是
 *   `await import(pathToFileURL(path.join(root,'dist',…)).href)` —— **路径被拆成字符串片段**，
 *   `consumesModule` 里那条"动态 import 窄规则"要求 specifier 是**字面量**，因此对它恒 false。
 *   ⇒ 那格先例（"静态看不见 ≠ 没有消费者；可核查的事实是 npm run 指向的那个脚本存在"）
 *     在这里是**唯一**能证明"已接线"的事实。★ 诚实的补法：抄成 3 行，并在自述里交 lead 裁
 *     「把 `scriptEntryFor` 导出后本文件改为调它」。
 */
function npmScriptReferences(root: string, relPosix: string): boolean {
  try {
    const pkg = JSON.parse(readText(root, 'package.json')) as { scripts?: Record<string, string> };
    const referenced = Object.values(pkg.scripts ?? {}).some((v) => typeof v === 'string' && v.includes(relPosix));
    return referenced && fs.existsSync(path.join(root, relPosix.split('/').join(path.sep)));
  } catch {
    return false;
  }
}

/**
 * **符号级**消费判定：既有 `consumesModule`（同名导出场景）+ 补半格（具名绑定 / 字面量动态 import）。
 * ★ 为什么必须补：`consumesModule` 比的是**模块同名导出**（`import { register } from './register.js'`），
 *   而 S1 断的是**符号**（`import { patrolDrift } from '../patrol/task_drift.js'` —— 子句是符号名）。
 */
function consumesSymbolIn(text: string, base: string, symbol: string): boolean {
  if (consumesModule(text, base, false, base)) return true;
  const named = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"][^'"]*\\b${esc(base)}\\.(?:js|mjs|cjs|ts)['"]`,
  ).exec(text);
  if (named) {
    for (const part of named[1].split(',')) {
      const asMatch = part.match(/([\w$]+)\s+as\s+([\w$]+)\s*$/);
      const name = asMatch ? asMatch[2].trim() : part.trim();
      if (name === symbol) return true;
    }
  }
  const dyn = new RegExp(`import\\(\\s*['"][^'"]*\\b${esc(base)}\\.(?:js|mjs|cjs|ts)['"]`);
  return dyn.test(text);
}

/** 一批符号的接线事实（**一遍扫盘**，符号之间不重复读文件） */
export function wiringFactsOf(
  root: string,
  symbols: readonly string[],
  dirs: WiringScanDirs = {},
): Map<string, WiringFact> {
  const exportDirs = dirs.exportDirs ?? DEFAULT_EXPORT_DIRS;
  const consumerDirs = dirs.consumerDirs ?? DEFAULT_CONSUMER_DIRS;
  const facts = new Map<string, WiringFact>(
    symbols.map((s) => [s, { symbol: s, export_modules: [], wired: false, evidence: null, scanned: 0, note: '' }]),
  );

  // ① 找到导出它的模块（找不到 ⇒ 后面判"unverifiable"，不猜）
  for (const rel of [...new Set(exportDirs.flatMap((d) => walkFiles(root, d, TS_EXT)))]) {
    const text = readText(root, rel);
    if (!text) continue;
    for (const f of facts.values()) {
      if (f.export_modules.length === 0 && exportsSymbol(text, f.symbol)) f.export_modules.push(rel);
    }
  }

  // ② 消费面：谁真的调到了它
  for (const rel of [...new Set(consumerDirs.flatMap((d) => walkFiles(root, d, TS_OR_MJS)))]) {
    const text = readText(root, rel);
    if (!text) continue;
    for (const f of facts.values()) {
      if (!f.export_modules.length || f.wired) continue;
      f.scanned += 1;
      if (f.export_modules.includes(rel) || /\.d\.ts$/.test(rel)) continue;
      if (!new RegExp(`\\b${esc(f.symbol)}\\b`).test(text)) continue;
      const consumed = f.export_modules.some((m) => consumesSymbolIn(text, baseOf(m), f.symbol));
      const entry = rel.startsWith('scripts/') && npmScriptReferences(root, rel);
      if (!consumed && !entry) continue;
      f.wired = true;
      f.evidence = `${rel}:${evidenceLineOf(text, f.symbol)}`;
      f.note = consumed
        ? '静态 import 绑定命中（既有 wiring 判定核 / 具名绑定）'
        : '脚本入口先例：npm scripts 指向该 .mjs（动态加载 ⇒ 静态 import 正则看不见）';
    }
  }
  return facts;
}

/** 单个符号的接线事实（薄封装；测试与诊断用） */
export function wiringEvidenceOf(root: string, symbol: string, dirs: WiringScanDirs = {}): WiringFact {
  return wiringFactsOf(root, [symbol], dirs).get(symbol) as WiringFact;
}

/** 册里所有「没接上」型声明（逐格，带位置） */
export function claimsOfSheet(dsl: unknown): SheetClaim[] {
  const tp = (dsl as { task_plan?: { patrols?: unknown } } | null)?.task_plan;
  const out: SheetClaim[] = [];
  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const where = `${at}.${k}`;
      if (typeof v === 'string') {
        if (CLAIM_FIELDS.has(k) && WIRE_CLAIM.test(v)) out.push({ where, text: v });
        continue;
      }
      walk(v, where);
    }
  };
  walk(tp?.patrols, 'task_plan.patrols');
  return out;
}

/** 声明文本里的候选符号（反引号里的优先，其次 CamelCase —— 两个方向都是"名字"，不是散文） */
export function symbolsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/`([A-Za-z_$][\w$]*)`/g)) out.push(m[1]);
  for (const m of text.matchAll(/\b([a-z][A-Za-z0-9$_]*[A-Z][A-Za-z0-9$_]*|[A-Z][A-Za-z0-9$_]*[a-z][A-Za-z0-9$_]*)\b/g)) {
    out.push(m[1]);
  }
  return [...new Set(out)];
}

/**
 * S1 判定（**判据本身不读册**：册由调用方给；扫描面可换）。
 * @param opts.recentlyChanged 近期被改路径（仓库相对 posix）—— ★ 只用于**分档**，不参与判定
 */
export function judgeSheetClaims(opts: {
  dsl: unknown;
  root: string;
  nowMs: number;
  recentlyChanged?: readonly string[];
  /** 声明 age（★ 调用方给：git 没有逐字写入时刻，用册文件最后一次提交当**上界**） */
  claimAgeMs?: number | null;
  dirs?: WiringScanDirs;
}): LedgerStalenessReport['s1'] {
  const claims = claimsOfSheet(opts.dsl);
  if (!claims.length) {
    return { claims: 0, superseded: [], unverifiable: [], still_true: 0, scanned_files: 0, unavailable: null };
  }
  const perClaim = claims.map((c) => ({ ...c, symbols: symbolsIn(c.text) }));
  const symbols = [...new Set(perClaim.flatMap((c) => c.symbols))];
  const facts = wiringFactsOf(opts.root, symbols, opts.dirs);
  const changed = new Set((opts.recentlyChanged ?? []).map((p) => p.replace(/\\/g, '/')));
  const superseded: StaleClaimRow[] = [];
  const unverifiable: StaleClaimRow[] = [];
  let stillTrue = 0;
  let scannedFiles = 0;

  for (const c of perClaim) {
    const fact = c.symbols.map((s) => facts.get(s)).find((f) => f && f.export_modules.length > 0);
    if (!fact) {
      unverifiable.push({
        where: c.where,
        claim: c.text.slice(0, 120),
        symbol: c.symbols[0] ?? '',
        verdict: 'unverifiable',
        evidence: null,
        why: c.symbols.length
          ? `声明里的符号（${c.symbols.join(' / ')}）在 src 里找不到导出 ⇒ **判不了**（可能已改名 / 已退役；别把它读成"声明仍然成立"）`
          : '声明里读不出任何符号名 ⇒ **判不了**（不猜）',
        age_ms: opts.claimAgeMs ?? null,
        tier: 'info',
      });
      continue;
    }
    scannedFiles += fact.scanned;
    if (!fact.wired) {
      stillTrue += 1; // ★ 不报：声明与代码一致 ⇒ 只进分母
      continue;
    }
    const evidenceFile = String(fact.evidence).split(':')[0];
    superseded.push({
      where: c.where,
      claim: c.text.slice(0, 120),
      symbol: fact.symbol,
      verdict: 'superseded',
      evidence: fact.evidence,
      why: `该声明**已被取代**：${fact.symbol} 实际已接线（证据 ${fact.evidence} · ${fact.note}）—— 册里那句"没接上"是在说旧事实`,
      age_ms: opts.claimAgeMs ?? null,
      tier: changed.has(evidenceFile) ? 'anomaly' : 'info',
    });
  }
  return {
    claims: claims.length,
    superseded,
    unverifiable,
    still_true: stillTrue,
    scanned_files: scannedFiles,
    unavailable: null,
  };
}

// ════════════════════════════════════════════════════════════════════
// S2 · 终态卡证据 stale
// ════════════════════════════════════════════════════════════════════

/** 册里所有卡（节点卡 + todo 卡；★ 同一张卡只取一次，判据只住 `taskOfNode`） */
function cardsOf(dsl: DesignDSL): TaskSpec[] {
  const out: TaskSpec[] = [];
  const seen = new Set<string>();
  const take = (c: TaskSpec | undefined): void => {
    if (!c || !c.id || seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
  };
  for (const n of dsl.geometry?.nodes ?? []) take(taskOfNode(n, dsl.todos));
  for (const t of dsl.todos ?? []) take(t);
  return out;
}

/**
 * S2 判定：**只巡终态卡**（done / void），只看它**最新一条**证据（= 收口那一次的读数，
 * 与 `task_ops#planEvidenceRerun` 同口径 —— 那里也只取 `recs[recs.length - 1]`）。
 *
 * ★ `stale` 与 `unverifiable` **分两桶**（`task_schema.ts:526-564` 的定义）：
 *   前者「记了、但已不同」⇒ 该重跑；后者「当年没记 / 覆盖集未知」⇒ **不许当有效用**（也不许折成绿）。
 * @param opts.fingerprint current 的现算方式（默认 = `task_ops#codeFingerprintAt`：读盘 + `contentHash` + `codeFingerprintOf`）
 */
export function judgeClosedCardEvidence(opts: {
  dsl: DesignDSL | null;
  root: string;
  fingerprint?: (covers: readonly string[]) => { code: string; covers: string[] } | null;
}): LedgerStalenessReport['s2'] {
  const base: LedgerStalenessReport['s2'] = {
    closed_cards: 0,
    with_evidence: 0,
    valid: 0,
    stale: [],
    unverifiable: [],
    unavailable: null,
  };
  if (!opts.dsl) {
    return { ...base, unavailable: '设计册读不到 ⇒ 没有卡可巡（★ 这不是"终态卡证据都新鲜"）' };
  }
  const fp = opts.fingerprint ?? ((covers: readonly string[]) => codeFingerprintAt(opts.root, covers));
  const closed = cardsOf(opts.dsl).filter((c) => isClosedTaskState(c.state));
  const out = { ...base, closed_cards: closed.length };
  for (const card of closed) {
    const recs = card.evidence ?? [];
    if (!recs.length) continue;
    out.with_evidence += 1;
    const rec = recs[recs.length - 1];
    const covers = [...(rec.fingerprint?.covers ?? [])];
    let current: { code: string; covers: readonly string[] } | null = null;
    let fpWhy = '';
    if (!covers.length) fpWhy = '覆盖集未知（当年没记 `covers`）⇒ 复算不了';
    else if (!opts.root) fpWhy = '算不出此刻指纹（册没有 `source_root`）';
    else {
      try {
        const cur = fp(covers);
        if (cur && cur.code) current = cur;
        else fpWhy = '现算指纹返回空 ⇒ 复算不了';
      } catch (e) {
        fpWhy = `现算指纹失败：${(e as Error).message.slice(0, 80)}`;
      }
    }
    const freshness = evidenceFreshness(rec, current);
    if (freshness === 'valid') {
      out.valid += 1;
      continue;
    }
    const state = card.state as 'done' | 'void';
    if (freshness === 'stale') {
      out.stale.push({
        card_id: card.id,
        state,
        at: rec.at,
        freshness: 'stale',
        covers,
        why: `覆盖集 ${covers.length} 个文件的指纹与此刻不同（或判据指纹不同）⇒ 这条证据是**旧代码**的读数`,
      });
    } else {
      out.unverifiable.push({
        card_id: card.id,
        state,
        at: rec.at,
        freshness: 'unverifiable',
        covers,
        why: fpWhy || '没有指纹（指纹上线前的历史证据 —— ★ 不回填，也不许当有效用）',
      });
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// S3 · 做了事没销账
// ════════════════════════════════════════════════════════════════════

/**
 * S3 判定：**只点名，不算总账**。
 * · `missed_close`：`DriftReport` 已经算过（状态机说"可收口"、卡却还在 claimed）⇒ 这里只搬名字；
 *   ★ 卡上没有"该收口的时刻"这一格 ⇒ age 恒 `null`（**不猜**：拿 `claimed_at` 当它会是另一个事实）。
 * · `no_card_write`：**消费** `scripts/write-log-audit.mjs` 的 JSON（同一份对账逻辑，不重写）；
 *   它跑不了 ⇒ `unavailable`（**不是 0 条**）。
 */
export function judgeUnsettled(opts: {
  missedClose?: readonly string[];
  noCardWrites?: NoCardWriteSummary | null;
  noCardWritesUnavailable?: string | null;
  nowMs: number;
}): LedgerStalenessReport['s3'] {
  const missed: UnsettledRow[] = (opts.missedClose ?? []).map((id) => ({
    kind: 'missed_close' as const,
    id,
    detail: '状态机判可收口（claimed 且后态判据全过），卡却还停在 claimed ⇒ 只有 edit_dsl {type:\'task\',op:\'complete\'} 能销账',
    age_ms: null,
  }));
  const nw = opts.noCardWrites ?? null;
  const rows: UnsettledRow[] = (nw?.rows ?? []).map((r) => {
    const at = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
    return {
      kind: 'no_card_write' as const,
      id: `${r.at ?? '?'}|${r.file ?? '?'}`,
      detail: `${r.file ?? '?'} · actor=${r.actor ?? '（空）'} · branch=${r.branch ?? r.gate_branch ?? '（无）'}`,
      age_ms: Number.isFinite(at) ? Math.max(0, opts.nowMs - at) : null,
    };
  });
  return {
    missed_close: missed,
    no_card_write: rows,
    no_card_total: nw ? nw.no_card : null,
    by_branch: nw?.by_branch ?? {},
    unavailable: nw ? null : (opts.noCardWritesUnavailable ?? '无卡写账**没读**（没人把对账器读数交进来）⇒ 判不了'),
  };
}

// ════════════════════════════════════════════════════════════════════
// 编排（patrol 的唯一入口）
// ════════════════════════════════════════════════════════════════════

/** 册文件最后一次提交距今（★ 声明没有逐字时间戳 ⇒ 用它当**上界**；判不了 ⇒ null） */
function sheetLastCommitAgeMs(root: string, rel: string): number | null {
  try {
    // ★ stderr 吞掉：非 git 目录（临时夹具 / 解压出来的树）是**正常情形**，不该在 TAP 里刷 `fatal:` 噪音
    const out = execFileSync('git', ['-C', root, 'log', '-1', '--format=%ct', '--', rel], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const sec = Number(out);
    return Number.isFinite(sec) && sec > 0 ? Math.max(0, Date.now() - sec * 1000) : null;
  } catch {
    return null;
  }
}

export interface LedgerStalenessOptions {
  feature: string;
  root: string;
  nowMs: number;
  recentlyChanged?: readonly string[];
  /** 读册（默认 `storage#getDesignSheet`；测试注入） */
  readSheet?: (feature: string) => unknown;
  /** S3：`DriftReport.missed_close`（★ 由调用方给 —— 本文件不重跑判定器） */
  missedClose?: readonly string[];
  noCardWrites?: NoCardWriteSummary | null;
  noCardWritesUnavailable?: string | null;
  /** 上次巡检距今（默认 null ⇒ 报"判不了"；patrol 从自己的 stamp 读） */
  lastPatrolAgeMs?: number | null;
  dirs?: WiringScanDirs;
}

/**
 * 三判据一起跑（★ 一条判据判不了**不遮蔽**另外两条：各自带自己的 `unavailable`）。
 * ★ feature 不存在 ⇒ 顶层 `unavailable` + `ok:false`，**绝不返回一份"看起来干净"的空报告**。
 */
export function scanLedgerStaleness(opts: LedgerStalenessOptions): LedgerStalenessReport {
  const readSheet = opts.readSheet ?? ((f: string) => getDesignSheet(f));
  let dsl: unknown = null;
  let sheetWhy: string | null = null;
  try {
    dsl = readSheet(opts.feature);
    if (!dsl) sheetWhy = `feature "${opts.feature}" 的设计册读不到 ⇒ 判不了（★ 这不是"没有陈旧"）`;
  } catch (e) {
    sheetWhy = `设计册读不了（${(e as Error).message.slice(0, 160)}）⇒ 判不了`;
  }
  const dslTyped = sheetWhy ? null : (dsl as DesignDSL);
  let sheetAge: number | null = null;
  try {
    const rel = path.relative(opts.root, getDesignSheetFile(opts.feature)).replace(/\\/g, '/');
    sheetAge = sheetLastCommitAgeMs(opts.root, rel);
  } catch {
    sheetAge = null;
  }

  const s1 = sheetWhy
    ? {
        claims: 0,
        superseded: [] as StaleClaimRow[],
        unverifiable: [] as StaleClaimRow[],
        still_true: 0,
        scanned_files: 0,
        unavailable: sheetWhy,
      }
    : judgeSheetClaims({
        dsl,
        root: opts.root,
        nowMs: opts.nowMs,
        recentlyChanged: opts.recentlyChanged,
        claimAgeMs: sheetAge,
        dirs: opts.dirs,
      });
  const s2 = judgeClosedCardEvidence({ dsl: dslTyped, root: opts.root });
  const s3 = judgeUnsettled({
    missedClose: opts.missedClose,
    noCardWrites: opts.noCardWrites,
    noCardWritesUnavailable: opts.noCardWritesUnavailable,
    nowMs: opts.nowMs,
  });

  const ok = !sheetWhy && !s2.unavailable && !s3.unavailable;
  return {
    feature: opts.feature,
    scanned_at: opts.nowMs,
    ok,
    unavailable: sheetWhy,
    age_basis: 'sheet-last-commit',
    sheet_age_ms: sheetAge,
    last_patrol_age_ms: opts.lastPatrolAgeMs ?? null,
    s1,
    s2,
    s3,
  };
}
