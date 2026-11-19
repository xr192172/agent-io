/**
 * ledger_staleness.ts —— **销账三层机制的 L1：账本陈旧的三个判据**（纯读；宿主 = `scripts/patrol.mjs`）
 *
 * ## 它回答的三个问题（S1 / S2 / S3 —— 各自独立、各自带分母）
 * | 判据 | 问题 | 「唯一的尺」住哪儿 |
 * |---|---|---|
 * | S1 | 册里那些**声明**（「零调用 / 未接线」）是不是**已经被取代**了？ | 既有 wiring 枚举的判定核 `wiring_enumerate#consumesModule` + 它那条**脚本入口**先例 |
 * | S2 | **终态卡**（done / void）上的证据，相对**此刻的代码**还作数吗？ | `task_schema#evidenceFreshness`（current 用 `covers` 现算，走 `task_ops#codeFingerprintAt`） |
 * | S3 | 做了事**没销账**的欠账还有哪些？ | `DriftReport.missed_close` + `scripts/write-log-audit.mjs` 的对账读数（**同一份**，不重写） |
 * | S4 | **台账行**（`docs/todo.md`）里带 `T-#…` / `R…` id 的那些**声明**，和册卡、和代码事实还对得上吗？ | 行内声明的**符号**用 S1 同一套接线事实；行内点名的**路径**用 import 说明符解析；行内点名的**其它 id** 用台账自身（定义集） |
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
  /** ★ 2026-11-17（T-#PATROL-S4）：台账行 ↔ 册卡 ↔ 代码事实的**三方抽对**（只报不改） */
  s4: S4Report;
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
// S4 · 台账行 ↔ 册卡 ↔ 代码事实（三方抽对）
// ════════════════════════════════════════════════════════════════════

/**
 * 台账的**唯一相对路径**（`patrol` 与本文件都从这里取 —— 不再各写一份字面量）。
 * ★ 本文件**不读**这个路径以外的任何文档：台账是**声明面**，代码事实由 wiring / import 现算。
 */
export const LEDGER_REL = 'docs/todo.md';

/** 台账 id 的文法（★ 与 `patrol.mjs#rowId` 同一套名字面）：`T-#大写下划线短横` / `R` + 1~3 位数字 */
const S4_ID = String.raw`(?:T-#[A-Z0-9][A-Z0-9-]*|R\d{1,3})`;
/** 一行**定义**一个 id：表格首格（`| **R31** | …` / `| T-#X | …`），或行首加粗列表项（`- **T-#X**`） */
const ROW_DEF = new RegExp(`^\\s*\\|?\\s*(?:\\*\\*)?(${S4_ID})(?:\\*\\*)?\\s*[|｜]`);
const ROW_DEF_BOLD = new RegExp(`^\\s*[-*]?\\s*\\*\\*(${S4_ID})\\*\\*`);
/** 行里**点名**一个 id（引用位） */
const ID_TOKEN = new RegExp(`\\b(${S4_ID})\\b`, 'g');

/**
 * **接线级欠账词**（S1 的 `WIRE_CLAIM` 扩表 + 加「零调用者 / 零消费者 / 没有调用者」）。
 *
 * ## ★ 为什么**不**把「未修 / 未实现 / 未落地」收进来（对 lead 裁定的**收窄**，理由实测）
 * 裁定原话是「行内含「未修/未实现/零调用」等欠账词 …… ⇒ 报 superseded」。实测（2026-11-17，
 * `docs/todo.md` 577 行）**放宽到功能级措辞会得到 10 条，逐条看真阳性 0 条**：
 *   · L199「画布层**没实现**」——行里点名 `writeRewritePlan` 只是"该改这里"，它被 import ≠ 画布层实现了；
 *   · L235「③ 产物注册表（**未修**）」——同理，`registerArtifactTo` 被消费 ≠ 注册表修了；
 *   · L313 R9「结构上写不进来**未实现**」——那句话在 `「…」` 引文里（引的是规格原文）；
 *   · L354 R62「**若**它没有消费者」——假设句，不是声明；
 *   · L363 R71「**仍未修**的主缺陷」——该行主语是 `verify:changed` 的闭包，不是被点名的符号。
 * ⇒ 一条"声明过期"的判据若靠**功能级措辞**触发，它的结论永远是错的（0.16：那是永远亮的灯）。
 *   **能证伪的只有接线级声明**：它断的正是"这个符号 / 文件没人消费"，而 wiring 事实**恰好**是这件事。
 *   功能级欠账（未修 / 未实现）没有机器判据能证伪 ⇒ 进 `unjudgeable` 分母，不进结论。
 */
const WIRE_DEBT =
  /零调用者|零调用|没人调|无人调用|从未被调用|未接线|没有接线|未接上|零消费者|没有消费者|没有使用者|没有调用者|零使用/g;

/** 「带过欠账词」的宽口径 —— ★ 只用于**分母**（判不了要说出来），不参与任何结论 */
const ANY_DEBT =
  /零调用者|零调用|没人调|无人调用|从未被调用|零\s*import|未接线|没有接线|未接上|零消费者|没有消费者|没有使用者|没有调用者|零使用|未实现|还没实现|没实现|未修|还没修|没修|未落地|没有落地|未消费|没有消费|没有入口|没有写入口|未接入/;

/**
 * 结案词 —— ★ **逐字照搬** `scripts/patrol.mjs` 的 `LEDGER_CLOSED`（那一份是台账体检用了半年的尺）。
 * 现在两边都从本文件取（`patrol.mjs` 改成 import），不再各写一份。
 */
const CLOSED_WORD = /✅|已了结|已收口|已结案|已闭合/;

/**
 * 结案词是不是**出现在引文里**（`「…」` / `` `…` ``）—— 引文里的 ✅ 是在**引述别人**，
 * 不是在声明这一行完了（实测三例：R31 引「R8 已了结」· R67 引外审原话「✅ 这条已经对了」·
 * R70 的 ✅ 是**嵌套表格里的一格**）。
 * ★ 判据：取结案词的第一个命中位置，若它之前出现过**奇数个**「 或 `` ` `` ⇒ 落在引文里 ⇒ 不算。
 * ★ 诚实边界：这条规则**不是万能的**（R70 那种嵌套表格抓不到）⇒ 读端必须写"可能有假阳、逐条看"，
 *   并且**永不自动改台账**。
 * ★ 本函数原来住 `scripts/patrol.mjs`（台账体检）；S4 要**同一把尺** ⇒ 搬到判据层，patrol 改成 import。
 */
export function closedOutsideQuotes(s: string): boolean {
  const m = CLOSED_WORD.exec(s);
  if (!m) return false;
  const before = s.slice(0, m.index);
  const open = (before.match(/「/g) ?? []).length;
  const close = (before.match(/」/g) ?? []).length;
  const tick = (before.match(/`/g) ?? []).length;
  return open === close && tick % 2 === 0;
}

/** 某个位置是不是**在引文里**（与 `closedOutsideQuotes` 同一把尺，只是这里判**任意位置**） */
export function inQuotesAt(text: string, at: number): boolean {
  const before = text.slice(0, at);
  const open = (before.match(/「/g) ?? []).length;
  const close = (before.match(/」/g) ?? []).length;
  const tick = (before.match(/`/g) ?? []).length;
  return open !== close || tick % 2 !== 0;
}

/** 台账里的一行（**非空行**；`no` = 1-based 行号 —— 报红必须点得到行，0.12 第 4 条） */
export interface LedgerRow {
  no: number;
  /** 这一行**定义**的 id；不定义 ⇒ `null`（引用别人的行也是合法的台账行） */
  id: string | null;
  text: string;
}

/** 悬空取代读数（T-#LEDGER-CURRENT-PROJECTION）：旧行指向一个完全不存在的 ref。 */
export interface DanglingSupersededRow {
  id: string;
  target: string;
}

/**
 * 悬空 supersede：只认「目标 ref 在全部行里完全不存在」。
 * ★ 目标存在（哪怕 state=done/void）仍是有效历史取代，不误报。
 * ★ 纯函数：patrol 只调用它，不在脚本里另写一份判据（一处权威）。
 */
export function danglingSuperseded(
  rows: readonly { ref_id?: unknown; superseded_by?: unknown }[],
): DanglingSupersededRow[] {
  const all = new Set(rows.map((r) => String(r.ref_id ?? '')));
  return rows
    .filter((r) => r.superseded_by && !all.has(String(r.superseded_by)))
    .map((r) => ({ id: String(r.ref_id ?? ''), target: String(r.superseded_by) }));
}

export type S4Verdict = 'superseded' | 'closed-unverifiable' | 'dangling-ref';
/** 三方里的**册**那一方：这个 id 在册上有没有卡、卡是不是终态 */
export type SheetCardLink = 'card-closed' | 'card-open' | 'no-card' | 'unavailable';
/** 三方里的**代码**那一方 */
export type CodeFactLink = 'wired' | 'file-consumed' | 'file-missing' | 'unavailable';

export interface S4Row {
  verdict: S4Verdict;
  /** 台账行号（1-based） */
  line: number;
  /** 这一行的 id（不定义的引用行 ⇒ 被点名的那一个 id） */
  id: string;
  /** 声明原文（**截断**，不改写） */
  claim: string;
  /** 参与判定的引用（符号 / 路径 / 别的 id） */
  refs: string[];
  /** `file:line` / `file` / `null`（判不了就不编） */
  evidence: string | null;
  /** ★ 三方各自说了什么 —— 缺一方的判据不许下结论，所以它必须出现在读数里 */
  trio: { ledger: 'row'; sheet: SheetCardLink; code: CodeFactLink };
  why: string;
}

export interface S4Report {
  /** 带 id 的台账行（分子/分母的**行**口径） */
  rows: number;
  /** 扫过的非空行（分母） */
  scanned: number;
  /** 台账里**定义**了多少个 id（引用能不能解析的分母） */
  declared_ids: number;
  /** 真被三方对过的声明数（判据这一轮实际动了多少） */
  checked: number;
  /** ★ 带欠账/结案词但这一轮**判不了**的行数（功能级措辞 / 没点名引用）—— 分母，不是结论 */
  unjudgeable: number;
  superseded: S4Row[];
  closed_unverifiable: S4Row[];
  dangling: S4Row[];
  /** 台账读不到 / 空 ⇒ 判不了（★ 不是"台账与代码对得上"） */
  unavailable: string | null;
}

/** 解析台账：非空行 + 每行定义的 id（**只解析，不判断**） */
export function parseLedgerRows(text: string): LedgerRow[] {
  const out: LedgerRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const def = ROW_DEF.exec(l) ?? ROW_DEF_BOLD.exec(l);
    out.push({ no: i + 1, id: def ? def[1] : null, text: l });
  }
  return out;
}

/** 台账里定义的 id 集合（**一次**算完；引用解析只认这一份） */
export function declaredIdsOf(rows: readonly LedgerRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) if (r.id) s.add(r.id);
  return s;
}

/** 行里点名的 id（去重；本行自己定义的那个由调用方剔） */
export function idsMentionedIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ID_TOKEN)) out.push(m[1]);
  return [...new Set(out)];
}

/**
 * 台账行里点名的**仓库相对路径**（反引号里、带 `/`、首段是已知顶层目录的）。
 * ★ 为什么要限首段：行里遍地是 `package.json` / `tsconfig.json` 这种**单文件名**，
 *   拿它们判"产物在不在"等于恒成立（0.16 的反面：永远不亮）。
 */
const PATH_TOP = new Set([
  'src', 'tests', 'scripts', 'docs', 'schema', 'examples', 'dogfood', 'config', 'assets',
  '.agent-io', '.github', '.workbuddy', '.agent', '.inspect', '.fixtures', '.snapshots',
  'observe-lang-go', 'observe-lang-py', 'observe-lang-java', 'vendor', 'next-handoff',
]);
const PATH_TOKEN = /`([A-Za-z0-9_.\-/]+\.[A-Za-z0-9]{1,5})`/g;
const isRepoPath = (p: string): boolean =>
  p.includes('/') && !p.startsWith('/') && !p.startsWith('..') && !p.includes('...') && PATH_TOP.has(p.split('/')[0]);

export function pathsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PATH_TOKEN)) {
    const p = m[1].replace(/\\/g, '/');
    if (!isRepoPath(p)) continue;
    out.push(p);
  }
  return [...new Set(out)];
}

/** 行里的候选**符号**（复用 S1 的 `symbolsIn`；把台账 id 从候选里剔掉 —— 那不是符号） */
export function symbolsInRow(text: string): string[] {
  const idRe = new RegExp(`^${S4_ID}$`);
  return symbolsIn(text).filter((s) => !idRe.test(s));
}

/** 反引号里的符号及其**字符位置**（★ 含 `` `name(` `` 形态 —— 台账里最关键的声明正是 `` `phaseOfKind()` 零调用者 ``） */
function backtickSymbolsAt(text: string): Array<{ name: string; start: number; end: number }> {
  const out: Array<{ name: string; start: number; end: number }> = [];
  for (const m of text.matchAll(/`([^`\n]*)`/g)) {
    const at = m.index ?? 0;
    const id = /^\s*([A-Za-z_$][\w$]*)\s*(?:\(|$|[.:#])/.exec(m[1]);
    if (!id) continue;
    out.push({ name: id[1], start: at, end: at + 1 + id[1].length });
  }
  return out;
}

/** 路径的**带位置**版（只用于就近匹配） */
function pathSitesAt(text: string): Array<{ path: string; start: number; end: number }> {
  const out: Array<{ path: string; start: number; end: number }> = [];
  for (const m of text.matchAll(PATH_TOKEN)) {
    const p = m[1].replace(/\\/g, '/');
    if (!isRepoPath(p)) continue;
    const at = m.index ?? 0;
    out.push({ path: p, start: at, end: at + p.length });
  }
  return out;
}

/**
 * 离某个位置**最近**的引用（符号 / 路径），且**必须 ≤ 40 字符**。
 * ★ 为什么必须"就近"：实测 L199 一行里点名 5 个符号、其中 4 个都被 import ——
 *   随手挑一个"已接线"的符号，就能把"画布层没实现"判成"声明过期"（假阳 100%）。
 *   中文台账的写法是「`X` … 零调用」，所以只有**紧邻**的那一个对得上那句声明。
 */
function nearestRef(
  at: number,
  syms: Array<{ name: string; start: number; end: number }>,
  paths: Array<{ path: string; start: number; end: number }>,
): { kind: 'symbol' | 'path'; name: string; dist: number } | null {
  const all: Array<{ kind: 'symbol' | 'path'; name: string; dist: number }> = [];
  for (const s of syms) all.push({ kind: 'symbol', name: s.name, dist: s.end <= at ? at - s.end : s.start >= at ? s.start - at : 0 });
  for (const p of paths) all.push({ kind: 'path', name: p.path, dist: p.end <= at ? at - p.end : p.start >= at ? p.start - at : 0 });
  all.sort((a, b) => a.dist - b.dist);
  const best = all[0];
  return best && best.dist <= 40 ? best : null;
}

/** 册卡索引：这个 id 在册上有没有卡、卡是不是终态（**册读不到 ⇒ unavailable，不猜**） */
export function sheetCardLinksOf(dsl: unknown): (id: string) => SheetCardLink {
  if (!dsl) return () => 'unavailable';
  const cards = cardsOf(dsl as DesignDSL).map((c) => ({
    id: c.id,
    closed: isClosedTaskState(c.state),
    text: JSON.stringify(c),
  }));
  return (id: string) => {
    const re = new RegExp(`\\b${esc(id)}\\b`);
    const hit = cards.find((c) => c.id === id) ?? cards.find((c) => re.test(c.text));
    return hit ? (hit.closed ? 'card-closed' : 'card-open') : 'no-card';
  };
}

/** import 说明符的位置（`from '…'` / `import('…')` / `require('…')`） */
const SPEC_SITE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const SRC_EXT = /\.(js|mjs|cjs|ts|mts|cts|tsx|jsx)$/;

function specifierSites(text: string): Array<{ spec: string; line: number }> {
  const out: Array<{ spec: string; line: number }> = [];
  let line = 1;
  let pos = 0;
  SPEC_SITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEC_SITE.exec(text))) {
    line += (text.slice(pos, m.index).match(/\n/g) ?? []).length;
    pos = m.index;
    out.push({ spec: m[1], line });
  }
  return out;
}

function resolveSpecifier(ownerRel: string, spec: string): string[] {
  if (!spec.startsWith('.')) return []; // 裸包名 / 别名：解析不了 ⇒ 不猜（判不了就不报）
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(ownerRel), spec)).replace(/\\/g, '/');
  if (base.startsWith('..')) return [];
  const noExt = base.replace(SRC_EXT, '');
  return [`${noExt}.ts`, `${noExt}.mts`, `${noExt}.tsx`, `${noExt}.mjs`, `${noExt}.cjs`, `${noExt}.js`, noExt];
}

/**
 * 「这个文件**被人消费**」的索引（**一遍扫盘**，所有路径共用）。
 * ★ 为什么不用"文件存在"当判据：台账行说"X 未实现"时常常顺手点名**将来**该落地的那个文件
 *   （`src/foo.ts` 往往已经存在）⇒ 拿"存在"去证伪那句声明 = 造满屏假阳。
 *   能证伪的只有**已消费**：别的文件里有指向它的 import 说明符，或 `package.json` scripts 指向它。
 * ★ 诚实边界：动态拼路径（`path.join(root, 'a', 'b')`）与只能靠别名解析的 specifier **看不见**
 *   ⇒ 那类路径拿不到消费证据 ⇒ 只进分母、不报。
 */
export function fileConsumptionIndex(
  root: string,
  dirs: WiringScanDirs = {},
): { consumed: Map<string, string>; scanned: number } {
  const consumerDirs = dirs.consumerDirs ?? DEFAULT_CONSUMER_DIRS;
  const rels = [...new Set(consumerDirs.flatMap((d) => walkFiles(root, d, TS_OR_MJS)))];
  const known = new Set(rels);
  const consumed = new Map<string, string>();
  for (const rel of rels) {
    const text = readText(root, rel);
    if (!text) continue;
    for (const site of specifierSites(text)) {
      for (const cand of resolveSpecifier(rel, site.spec)) {
        if (cand === rel || !known.has(cand)) continue;
        if (!consumed.has(cand)) consumed.set(cand, `${rel}:${site.line}`);
        break;
      }
    }
  }
  // 脚本入口先例（与 S1 同一把尺：`npm scripts` 指向它 ⇒ 它被消费了）
  for (const rel of rels) {
    if (!rel.startsWith('scripts/') || consumed.has(rel)) continue;
    if (npmScriptReferences(root, rel)) consumed.set(rel, 'package.json scripts');
  }
  return { consumed, scanned: rels.length };
}

/**
 * S4 判定：**只报三类，且每类都要三方同时说话**。
 *
 * | 类 | 三方各说了什么 | 结论 |
 * |---|---|---|
 * | (a) `superseded` | 台账行说 `` `X` 零调用 / 未接线 `` · 代码说 `X` **已接线** | 声明**过期**（行在说旧事实） |
 * | (b) `closed-unverifiable` | 台账行说 ✅/已了结 · 代码说**点名的产物一个都不在** | 结案**核不了**（不许当"真做完"） |
 * | (c) `dangling-ref` | 台账行点名了别的 id · 台账自己**没有**这一行 | 引用**悬空**（跟着走的人会找不到） |
 *
 * ## 四条纪律（每条都是 2026-11-17 在真台账 577 行上量出来的）
 * ① **只认接线级声明**（`WIRE_DEBT`）：功能级措辞（未修 / 未实现）没有机器判据能证伪 —— 放宽到它们
 *    得到 10 条、真阳性 0 条 ⇒ 进 `unjudgeable` 分母。
 * ② **就近取值**：那句"零调用"只对它**紧邻**（≤ 40 字符）的那个符号/路径说话（`nearestRef`）。
 * ③ **引文里的词不算声明**（`inQuotesAt`）：那是引述规格原文。
 * ④ **(b) 只报"全都不在"**：点名 3 个产物、2 个还在 ⇒ 判不了"缺的那一个是不是唯一对应物" ⇒ 只进分母。
 */
export function judgeLedgerTrio(opts: {
  /** 台账全文（缺省 = 调用方读好传进来；测试注入） */
  ledgerText?: string | null;
  root: string;
  dsl?: unknown;
  dirs?: WiringScanDirs;
}): S4Report {
  const base: S4Report = {
    rows: 0,
    scanned: 0,
    declared_ids: 0,
    checked: 0,
    unjudgeable: 0,
    superseded: [],
    closed_unverifiable: [],
    dangling: [],
    unavailable: null,
  };
  if (typeof opts.ledgerText !== 'string' || !opts.ledgerText.trim()) {
    return { ...base, unavailable: `${LEDGER_REL} 读不到（或为空）⇒ 判不了（★ 这不是"台账与册与代码都对得上"）` };
  }
  const rows = parseLedgerRows(opts.ledgerText);
  const declared = declaredIdsOf(rows);
  const sheetLink = sheetCardLinksOf(opts.dsl);
  const out: S4Report = {
    ...base,
    rows: rows.filter((r) => r.id !== null || idsMentionedIn(r.text).length > 0).length,
    scanned: rows.length,
    declared_ids: declared.size,
  };

  // ── (c) 悬空引用：只读台账自身（不需要代码，也不需要册） ──
  for (const r of rows) {
    for (const id of idsMentionedIn(r.text)) {
      if (id === r.id) continue; // 本行自己
      if (declared.has(id)) continue;
      out.dangling.push({
        verdict: 'dangling-ref',
        line: r.no,
        id: r.id ?? id,
        claim: r.text.trim().slice(0, 120),
        refs: [id],
        evidence: null,
        trio: { ledger: 'row', sheet: sheetLink(id), code: 'unavailable' },
        why:
          `${LEDGER_REL} 里**没有** \`${id}\` 这一行（本行 L${r.no} 点了它的名）` +
          `⇒ 照编号去翻的人找不到它（行被删了 / 改名了）—— 台账是文档，改它要人拍，本判据只报。`,
      });
    }
  }

  // ── 分拣：(a) 接线级欠账 / (b) 结案；其余带词的进 unjudgeable 分母 ──
  const debtSitesOf = (text: string): Array<{ at: number; word: string }> => {
    const sites: Array<{ at: number; word: string }> = [];
    for (const m of text.matchAll(WIRE_DEBT)) {
      const at = m.index ?? 0;
      if (inQuotesAt(text, at)) continue; // 引文里的词不是本行的声明
      sites.push({ at, word: m[0] });
    }
    return sites;
  };
  const debtRows = rows.filter((r) => debtSitesOf(r.text).length > 0 && !closedOutsideQuotes(r.text));
  const closedRows = rows.filter((r) => closedOutsideQuotes(r.text));

  const picked = new Map<number, { kind: 'symbol' | 'path'; name: string; word: string }>();
  for (const r of debtRows) {
    const syms = backtickSymbolsAt(r.text);
    const paths = pathSitesAt(r.text);
    for (const site of debtSitesOf(r.text)) {
      const near = nearestRef(site.at, syms, paths);
      if (!near) continue;
      picked.set(r.no, { kind: near.kind, name: near.name, word: site.word });
      break; // 一行只取**第一条**能就近落到引用上的声明（一行常挂多个子项，多报会重复计同一行）
    }
  }

  const allSyms = new Set<string>();
  for (const p of picked.values()) if (p.kind === 'symbol') allSyms.add(p.name);
  const facts = allSyms.size ? wiringFactsOf(opts.root, [...allSyms], opts.dirs) : new Map<string, WiringFact>();
  let consumption: Map<string, string> | null = null;
  const consumedOf = (): Map<string, string> => {
    if (!consumption) consumption = fileConsumptionIndex(opts.root, opts.dirs).consumed;
    return consumption;
  };

  // ── (a) 接线级声明 + 代码已消费 ⇒ 声明过期 ──
  for (const r of debtRows) {
    const p = picked.get(r.no);
    if (!p) continue;
    out.checked += 1;
    if (p.kind === 'symbol') {
      const fact = facts.get(p.name);
      if (!fact || !fact.wired) continue; // 找不到导出 / 仍未接线 ⇒ 声明仍成立（只进分母，0.16）
      out.superseded.push({
        verdict: 'superseded',
        line: r.no,
        id: r.id ?? '?',
        claim: r.text.trim().slice(0, 120),
        refs: [p.name],
        evidence: fact.evidence,
        trio: { ledger: 'row', sheet: sheetLink(r.id ?? p.name), code: 'wired' },
        why:
          `这一行说 \`${p.name}\` ${p.word}，而它**已经在被消费**` +
          `（证据 ${fact.evidence} · ${fact.note}）⇒ 那句话是旧事实。`,
      });
      continue;
    }
    const evidence = consumedOf().get(p.name) ?? null;
    if (!evidence) continue; // 拿不到消费证据 ⇒ 判不了（不因此宣布声明成立，也不报）
    out.superseded.push({
      verdict: 'superseded',
      line: r.no,
      id: r.id ?? '?',
      claim: r.text.trim().slice(0, 120),
      refs: [p.name],
      evidence,
      trio: { ledger: 'row', sheet: sheetLink(r.id ?? p.name), code: 'file-consumed' },
      why:
        `这一行说 \`${p.name}\` ${p.word}，而它**已经被人消费**（证据 ${evidence}）` +
        `⇒ 要么活真做完了，要么行里点错了对象 —— 逐条看。`,
    });
  }

  // ── (b) 结案词 + 点名的产物**全都不在** ⇒ 结案核不了 ──
  const adjudicated = new Set<number>(picked.keys());
  for (const r of closedRows) {
    const paths = pathsIn(r.text);
    if (!paths.length) continue; // 没点名产物 ⇒ 判不了（进 unjudgeable 分母）
    adjudicated.add(r.no);
    out.checked += 1;
    const missing = paths.filter((q) => !fs.existsSync(path.join(opts.root, q)));
    if (missing.length !== paths.length) continue; // 还有产物在盘上 ⇒ 判不了"缺的那半"，只进分母
    out.closed_unverifiable.push({
      verdict: 'closed-unverifiable',
      line: r.no,
      id: r.id ?? '?',
      claim: r.text.trim().slice(0, 120),
      refs: missing,
      evidence: null,
      trio: { ledger: 'row', sheet: sheetLink(r.id ?? missing[0]), code: 'file-missing' },
      why:
        `这一行写着"已了结"，而它点名的 ${missing.length} 个产物**一个都不在盘上**` +
        `（${missing.slice(0, 3).join(' · ')}${missing.length > 3 ? ' …' : ''}）` +
        `⇒ 结案**核不了**（删了 / 改名了 / 从来只是计划）—— 不许当"真做完"。`,
    });
  }

  // ── 分母：带过欠账/结案词、但这一轮没被三方对过的行（0.12：判不了要说出来） ──
  out.unjudgeable = rows.filter(
    (r) => (ANY_DEBT.test(r.text) || closedOutsideQuotes(r.text)) && !adjudicated.has(r.no),
  ).length;

  return out;
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
  /**
   * S4：台账全文。**不传**（`undefined`）⇒ 本文件自己读 `<root>/<ledgerRel>`；
   * 传 `null` ⇒ 明说"读不到"（★ 不许回落成再读一次：那会把"调用方读不到"静默成"我这里读到了"）。
   */
  ledgerText?: string | null;
  /** S4：台账相对路径（默认 `docs/todo.md`；patrol 传它自己读的那一份的路径） */
  ledgerRel?: string;
}

/** 读台账（读不到 ⇒ `null`；★ 调用方必须把它当"判不了"，不是"空台账"） */
function readLedgerText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf-8');
  } catch {
    return null;
  }
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
  // ★ S4（T-#PATROL-S4）：台账 ↔ 册卡 ↔ 代码事实。★ 册读不到**不**短路它：
  //   (c) 悬空引用与 (a)(b) 的代码那一半都不需要册 —— 册只贡献 `trio.sheet` 那一格。
  const ledgerRel = opts.ledgerRel ?? LEDGER_REL;
  const ledgerText = opts.ledgerText === undefined ? readLedgerText(opts.root, ledgerRel) : opts.ledgerText;
  const s4 = judgeLedgerTrio({ ledgerText, root: opts.root, dsl: dslTyped ?? undefined, dirs: opts.dirs });

  const ok = !sheetWhy && !s2.unavailable && !s3.unavailable && !s4.unavailable;
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
    s4,
  };
}
