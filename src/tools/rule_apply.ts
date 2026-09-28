/**
 * 规则应用（P1-7）—— apply（改写）/ check（当 lint）/ 棘轮 baseline
 *
 * 三态语义（对齐 Grit 的 todo() 半修，因为真实迁移很少"要么全改要么不动"）：
 *   ① **改了**（applied）  ：命中且唯一 ⇒ 按 replace 改写；
 *   ② **标了 todo**（todo）：命中但**歧义**（>1 处）或无法安全改写 ⇒
 *      在命中处插入 `TODO(rule-id): 原因` 注释，**不失败**；
 *   ③ **没命中**（clean）  ：无命中 ⇒ 该文件对这条规则是干净的。
 *
 * ★ CI 棘轮（对齐 Grit 最聪明的一点：只在"新增命中"上 fail）：
 *   `check` 把结果与 `<root>/.agent-io/rules/baseline.json` 里的存量清单比对：
 *     - 命中数 **未增加** ⇒ 通过（哪怕这条规则当下就有一堆存量命中）；
 *     - 出现**新增**命中 ⇒ 失败（增量修复防回归）。
 *   这样"先启用一条当前就失败的规则"不会炸 CI，而新引入的问题会被立刻拦住。
 *   `--update-baseline` 把当前存量记为基线（修完一批后收紧）。
 *
 * 纪律：
 *   - **唯一才动**：歧义绝不"挑一个改"，而是转 todo（诚实：告诉人这里要手工看）；
 *   - **不改文件就不报成功**：apply 返回逐文件三态计数，回执如实说明。
 */

import { DATA_DIR_NAME } from '../data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_EXTS } from './ts_kernel/index.js';
import { matchRule, instantiateReplace } from './rule_match.js';
import { applyMatch as applyOneMatch } from './rule_match.js';
import { loadRules, baselinePath, rulesDir, type Rule } from './rule_library.js';
import { splitLines, leadingWs } from './rule_tokens.js';

/* ─────────────────── 三态结果 ─────────────────── */

export type ApplyState = 'applied' | 'todo' | 'clean';

export interface FileRuleOutcome {
  file: string;
  ruleId: string;
  state: ApplyState;
  /** 命中数（含歧义时的全部候选） */
  hits: number;
  /** 实际改写的处数（state=applied 时 == 1） */
  applied: number;
  /** todo 原因（state=todo 时） */
  todoReason?: string;
  /** 改前 / 改后全文（供写盘与回执） */
  before?: string;
  after?: string;
}

/* ─────────────────── 单文件应用 ─────────────────── */

/** 用 `//` 还是 `#` 注释（按扩展名粗判） */
export function commentStyleFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (['.py', '.sh', '.bash', '.yaml', '.yml', '.toml', '.rb', '.pl'].includes(ext)) return '#';
  if (['.sql', '.lua'].includes(ext)) return '--';
  return '//';
}

/** 在给定行号处插入 todo 注释（1-based，插在该行**之前**），返回新全文 */
export function insertTodo(content: string, line: number, ruleId: string, reason: string, style: string): string {
  const lines = splitLines(content);
  const idx = Math.min(Math.max(line - 1, 0), lines.length);
  const indent = leadingWs(lines[idx] ?? '');
  lines.splice(idx, 0, `${indent}${style} TODO(${ruleId}): ${reason}`);
  return lines.join('\n');
}

/**
 * 对一份文件内容应用一条规则。
 * 不写盘 —— 返回 before/after，由调用方决定是否落盘（走写闸/快照）。
 */
export function applyRuleToContent(
  file: string,
  content: string,
  rule: Rule,
  opts: { todo?: boolean } = {},
): FileRuleOutcome {
  const out = matchRule(content, rule.pattern);
  const base: FileRuleOutcome = {
    file,
    ruleId: rule.id,
    state: 'clean',
    hits: out.matches.length,
    applied: 0,
  };

  if (out.matches.length === 0) return base;

  // 唯一 ⇒ 改写
  if (out.matches.length === 1 && !out.ambiguous) {
    const after = applyOneMatch(content, out.matches[0], rule.replace);
    if (after === content) {
      // replace 与命中相同（空替换等）→ 视为 clean，不谎报"已改"
      return { ...base, state: 'clean', applied: 0 };
    }
    return { ...base, state: 'applied', applied: 1, before: content, after };
  }

  // 歧义 ⇒ todo（除非调用方明确不要 todo，那就只如实报告）
  const reason = `命中 ${out.matches.length} 处（${out.matches.map((m) => 'L' + m.startLine).join(', ')}）歧义，需人工确认`;
  if (!opts.todo) return { ...base, state: 'todo', todoReason: reason };
  const after = insertTodo(content, out.matches[0].startLine, rule.id, reason, commentStyleFor(file));
  return { ...base, state: 'todo', todoReason: reason, before: content, after };
}

/* ─────────────────── 目录遍历 ─────────────────── */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', DATA_DIR_NAME, 'coverage', 'third_party']);
/** ★ 来自内核唯一权威 `SOURCE_EXTS`（`ts_kernel/source_exts.ts`）—— 此前这里手写 14 个，
 *  而仓内同一问题另有 5 份不同答案 ⇒ 口径随工具而变；统一后只增不减。 */
const CODE_EXT = new Set<string>(SOURCE_EXTS);

/** 收集待检文件（相对 root），带默认排除（我们自己的派生物目录必须排除） */
export function collectRuleTargets(root: string, opts: { glob?: string; maxFiles?: number } = {}): string[] {
  const absRoot = path.resolve(root);
  const out: string[] = [];
  const maxFiles = opts.maxFiles ?? 5000;
  const filter = opts.glob ? new RegExp(opts.glob) : null;
  const walk = (dir: string): void => {
    if (out.length >= maxFiles) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (out.length >= maxFiles) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(p);
      } else if (e.isFile()) {
        if (!CODE_EXT.has(path.extname(e.name).toLowerCase())) continue;
        const rel = path.relative(absRoot, p).split(path.sep).join('/');
        if (filter && !filter.test(rel)) continue;
        out.push(rel);
      }
    }
  };
  walk(absRoot);
  out.sort();
  return out;
}

/* ─────────────────── 跨文件应用 / 检查 ─────────────────── */

export interface ApplySummary {
  outcomes: FileRuleOutcome[];
  applied: number;
  todo: number;
  clean: number;
  /** 命中总数（棘轮用） */
  totalHits: number;
}

/** 对一批文件应用一批规则（不写盘；只算 before/after） */
export function applyRulesToFiles(
  root: string,
  files: string[],
  rules: Rule[],
  opts: { todo?: boolean; fileContents?: (rel: string) => string | null } = {},
): ApplySummary {
  const outcomes: FileRuleOutcome[] = [];
  for (const rel of files) {
    let content: string | null = null;
    if (opts.fileContents) {
      content = opts.fileContents(rel);
    } else {
      try {
        content = fs.readFileSync(path.join(path.resolve(root), rel), 'utf8');
      } catch {
        content = null;
      }
    }
    if (content === null) continue;
    for (const rule of rules) {
      const o = applyRuleToContent(rel, content, rule, { todo: opts.todo });
      if (o.state === 'clean' && o.hits === 0) continue; // 干净的不入清单（减少噪声）
      outcomes.push(o);
    }
  }
  return {
    outcomes,
    applied: outcomes.filter((o) => o.state === 'applied').length,
    todo: outcomes.filter((o) => o.state === 'todo').length,
    clean: outcomes.filter((o) => o.state === 'clean').length,
    totalHits: outcomes.reduce((n, o) => n + o.hits, 0),
  };
}

/* ─────────────────── 棘轮 baseline ─────────────────── */

/** 一条存量命中（基线键） */
export interface BaselineEntry {
  ruleId: string;
  file: string;
  /** 命中数（同文件同规则聚合） */
  hits: number;
}

export interface Baseline {
  version: 1;
  updatedAt: string;
  entries: BaselineEntry[];
}

const entryKey = (e: BaselineEntry): string => `${e.ruleId}\u0000${e.file}`;

export function loadBaseline(root: string): Baseline | null {
  const p = baselinePath(root);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Baseline;
    if (raw && raw.version === 1 && Array.isArray(raw.entries)) return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeBaseline(root: string, summary: ApplySummary): Baseline {
  const map = new Map<string, BaselineEntry>();
  for (const o of summary.outcomes) {
    if (o.hits === 0) continue;
    const k = entryKey({ ruleId: o.ruleId, file: o.file, hits: 0 });
    const prev = map.get(k);
    if (prev) prev.hits += o.hits;
    else map.set(k, { ruleId: o.ruleId, file: o.file, hits: o.hits });
  }
  const entries = [...map.values()].sort((a, b) =>
    a.ruleId === b.ruleId ? a.file.localeCompare(b.file) : a.ruleId.localeCompare(b.ruleId),
  );
  const bl: Baseline = { version: 1, updatedAt: new Date().toISOString(), entries };
  fs.mkdirSync(rulesDir(root), { recursive: true });
  fs.writeFileSync(baselinePath(root), JSON.stringify(bl, null, 2) + '\n', 'utf8');
  return bl;
}

/** 棘轮判定：新命中 = 当前命中 - 基线允许量（同键取 max(0, 当前 - 基线)） */
export interface RatchetDelta {
  key: string;
  ruleId: string;
  file: string;
  current: number;
  baseline: number;
  added: number;
}

export function ratchetDelta(summary: ApplySummary, baseline: Baseline | null): RatchetDelta[] {
  const baseMap = new Map<string, number>();
  if (baseline) for (const e of baseline.entries) baseMap.set(entryKey(e), e.hits);

  // 聚合当前命中
  const curMap = new Map<string, { ruleId: string; file: string; hits: number }>();
  for (const o of summary.outcomes) {
    if (o.hits === 0) continue;
    const k = entryKey({ ruleId: o.ruleId, file: o.file, hits: 0 });
    const prev = curMap.get(k);
    if (prev) prev.hits += o.hits;
    else curMap.set(k, { ruleId: o.ruleId, file: o.file, hits: o.hits });
  }

  const out: RatchetDelta[] = [];
  for (const [k, cur] of curMap) {
    const b = baseMap.get(k) ?? 0;
    const added = cur.hits - b;
    if (added > 0) out.push({ key: k, ruleId: cur.ruleId, file: cur.file, current: cur.hits, baseline: b, added });
  }
  out.sort((a, b) => (a.ruleId === b.ruleId ? a.file.localeCompare(b.file) : a.ruleId.localeCompare(b.ruleId)));
  return out;
}

/* ─────────────────── 夹具自检（CI 可直接跑） ─────────────────── */

export interface FixtureRunResult {
  ruleId: string;
  passed: boolean;
  failures: string[];
}

/** 跑一条规则的全部夹具（正例须命中且改写一致；反例不得命中） */
export function runFixtures(rule: Rule): FixtureRunResult {
  const failures: string[] = [];
  for (const f of rule.fixtures) {
    if (f.negative !== undefined) {
      const out = matchRule(f.negative, rule.pattern);
      if (out.matches.length > 0) failures.push(`反例「${f.title}」被命中 ${out.matches.length} 处`);
      continue;
    }
    if (f.before === undefined || f.after === undefined) continue;
    const out = matchRule(f.before, rule.pattern);
    if (out.matches.length === 0) {
      failures.push(`正例「${f.title}」未命中`);
      continue;
    }
    if (out.matches.length > 1) {
      failures.push(`正例「${f.title}」命中 ${out.matches.length} 处（须唯一）`);
      continue;
    }
    const got = instantiateReplace(rule.replace, out.matches[0]);
    if (got.trimEnd() !== (f.after ?? '').trimEnd()) {
      failures.push(`正例「${f.title}」改写不符：得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(f.after)}`);
    }
  }
  return { ruleId: rule.id, passed: failures.length === 0, failures };
}

/** 跑规则库全部夹具 */
export function runAllFixtures(root: string): { results: FixtureRunResult[]; total: number; failed: number } {
  const { rules } = loadRules(root);
  const results = rules.map(runFixtures);
  return { results, total: results.length, failed: results.filter((r) => !r.passed).length };
}
