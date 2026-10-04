/**
 * detect_drift：活文档↔代码漂移检测
 *
 * 目标：补「活文档」的闭环缺口——代码变更后，判断设计 DSL 是否过时 / 是否欠实现，
 * 产出可行动的过时判定并持久化漂移台账，让「代码变了 → 提示 DSL 需同步」成为可反复
 * 触发的状态，而不是每次重算的无状态报告。
 *
 * 复用 checkConsistency 引擎（expected_apis vs 实际代码 + 跨文件不变式），在此基础上叠加三层：
 *   1. git 变更作用域：scope=changed（默认）只看工作区改动 / 自 since_ref 起的变更，
 *      把「这次改动引发了哪些漂移」从全量历史噪音里圈出来；
 *   2. 过时判定：把 unexpected/mismatched 归为「设计过时（代码先走了）」，missing 归为
 *      「实现欠账（设计先立了契约）」，合成单一 status；
 *   3. 漂移台账：持久化 <storageRoot>/drift/<feature>.drift.json，mode=status 可只读最近一次。
 *
 * 只读不写 DSL；写设计/回填仍走 edit_dsl / import_project（带 reason+evidence 门禁）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getDSL, getStorageRoot } from '../../../infrastructure/storage.js';
import { gitRootOf } from '../../../infrastructure/analysis/project_root/index.js';
import { checkConsistency } from './consistency.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

export interface DetectDriftInput {
  /** feature 名 */
  feature: string;
  /** 代码根目录（默认 DSL source_root，手工 DSL 回退 <cwd>/scaffold/<feature>） */
  code_dir?: string;
  /** 检查范围：changed=仅 git 变更文件（默认）；all=全量对账 */
  scope?: 'changed' | 'all';
  /** changed 模式下 git 参照版本，默认 HEAD（即只看未提交改动） */
  since_ref?: string;
  /**
   * 精确变更文件集（相对 code_dir）。传入时优先用它作为 changed 作用域（watcher 的
   * fs 变更集比 git 更准——含新/未跟踪/跨根文件），忽略 git diff；scope=all 时忽略。
   * 与 since_ref 互斥用途，二者给其一即可。
   */
  changed_files?: string[];
  /** check=重新计算（默认）；status=只读最近一次漂移台账 */
  mode?: 'check' | 'status';
}

export type DriftStatus = 'clean' | 'design_stale' | 'missing_impl' | 'design_stale_and_missing_impl';

export interface DriftData {
  feature: string;
  status: DriftStatus;
  drifted: boolean;
  scope: { mode: 'changed' | 'all'; since_ref: string | null; changed_files: number };
  summary: {
    checked_files: number;
    matched: number;
    missing: number;
    mismatched: number;
    unexpected: number;
    invariant_passed: number;
    invariant_failed: number;
  };
  /** 设计相对代码过时的文件（该文件有代码新增/签名偏离设计） */
  stale_files: string[];
  /** 契约有待实现的文件（设计 expected 但代码没有） */
  missing_files: string[];
  suggestions: string[];
  checked_at: string | null;
  persisted: boolean;
}

function driftFile(feature: string): string {
  // 与 getFeatureFile 同规则防穿越；feature 名非法时 getDSL 也不会读到，提前抛
  if (!/^[a-zA-Z0-9_-]+$/.test(feature)) {
    throw new Error(`非法 feature 名: "${feature}"，必须匹配 ^[a-zA-Z0-9_-]+$`);
  }
  return path.join(getStorageRoot(), 'drift', `${feature}.drift.json`);
}

/** 返回 git 工作区相对根目录的变更文件（相对路径）。getRoot 为 null 时视为非 git 仓库。 */
function gitChangedFiles(root: string, ref: string): string[] {
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, { cwd: root, encoding: 'utf-8', stdio: 'pipe', timeout: 15_000 }).toString();
    } catch {
      return '';
    }
  };
  const tracked = run(`git diff --name-only ${ref}`);
  const untracked = run('git ls-files --others --exclude-standard');
  const merged = [...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)]
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(merged)];
}

const norm = (p: string): string => path.resolve(p).toLowerCase();

async function detectDriftCore(input: DetectDriftInput): Promise<DriftData & { message: string }> {
  const { feature, code_dir, mode = 'check' } = input;

  if (mode === 'status') {
    const f = driftFile(feature);
    if (!fs.existsSync(f)) {
      throw new Error(`feature "${feature}" 尚无漂移台账，先用 mode=check 检测一次`);
    }
    const data = JSON.parse(fs.readFileSync(f, 'utf-8')) as DriftData & { verdict?: string };
    const msg = `[detect_drift 台账] ${feature}: ${data.status}（${data.checked_at ?? '未知'}，scope=${data.scope.mode}）。drifted=${data.drifted}`;
    return { message: msg, ...data };
  }

  const dsl = getDSL(feature);
  if (!dsl) throw new Error(`feature "${feature}" 不存在，请先 import_project 或写 DSL`);

  // 1. 确定代码根
  const codeDir = path.resolve(
    code_dir ?? dsl.source_root ?? path.join(process.cwd(), 'scaffold', feature),
  );

  // 2. 跑一致性引擎（全量，拿到 per-file matched/missing/mismatched/unexpected + invariants）
  const r = await checkConsistency({ feature, code_dir: codeDir });

  // 3. 变更作用域：显式 changed_files（watcher 的 fs 变更集）优先；否则 git diff
  const scopeMode = input.scope === 'all' ? ('all' as const) : ('changed' as const);
  let changedAbs = new Set<string>();
  if (scopeMode === 'changed') {
    if (input.changed_files && input.changed_files.length > 0) {
      for (const f of input.changed_files) changedAbs.add(norm(path.resolve(codeDir, f)));
    } else {
      const sinceRef = input.since_ref ?? 'HEAD';
      const gitRoot = gitRootOf(codeDir);
      if (gitRoot) {
        changedAbs = new Set(gitChangedFiles(gitRoot, sinceRef).map((rel) => norm(path.join(gitRoot, rel))));
      }
    }
  }

  // 4. 有的放矢：changed 模式只对「变更波及的文件」下判定；all 用全部
  const scoped = scopeMode === 'changed' && changedAbs.size > 0
    ? r.fileResults.filter((fr) => changedAbs.has(norm(path.join(codeDir, fr.file.path))))
    : r.fileResults;

  let matched = 0, missing = 0, mismatched = 0, unexpected = 0;
  const staleFiles = new Set<string>();
  const missingFiles = new Set<string>();
  for (const fr of scoped) {
    for (const a of fr.apis) {
      matched += a.status === 'matched' ? 1 : 0;
      missing += a.status === 'missing' ? 1 : 0;
      mismatched += a.status === 'mismatched' ? 1 : 0;
      unexpected += a.status === 'unexpected' ? 1 : 0;
      if (a.status === 'unexpected' || a.status === 'mismatched') staleFiles.add(fr.file.path);
      if (a.status === 'missing') missingFiles.add(fr.file.path);
    }
  }

  const staleCount = unexpected + mismatched;
  const missingCount = missing;
  const status: DriftStatus =
    staleCount > 0 && missingCount > 0
      ? 'design_stale_and_missing_impl'
      : staleCount > 0
        ? 'design_stale'
        : missingCount > 0
          ? 'missing_impl'
          : 'clean';
  const drifted = staleCount > 0 || missingCount > 0;

  const suggestions: string[] = [];
  if (staleCount > 0) {
    suggestions.push('设计过时：代码已领先/偏离设计。回填新增或变更的 API 到 DSL 的 expected_apis，用 edit_dsl（带 reason+evidence 门禁）；或 import_project 重建视图后 diff_views 审视。');
  }
  if (missingCount > 0) {
    suggestions.push('实现欠账：设计契约已立但代码未实现 expected_apis，补齐对应实现。');
  }
  if (staleCount === 0 && missingCount === 0) {
    suggestions.push('设计与当前代码对齐，无需同步。');
  }

  const data: DriftData = {
    feature,
    status,
    drifted,
    scope: { mode: scopeMode, since_ref: (scopeMode === 'changed' && !(input.changed_files && input.changed_files.length > 0)) ? (input.since_ref ?? 'HEAD') : null, changed_files: changedAbs.size },
    summary: {
      checked_files: scoped.length,
      matched,
      missing,
      mismatched,
      unexpected,
      invariant_passed: r.invariantResults.filter((v) => v.status === 'passed').length,
      invariant_failed: r.invariantResults.filter((v) => v.status === 'failed').length,
    },
    stale_files: [...staleFiles],
    missing_files: [...missingFiles],
    suggestions,
    checked_at: new Date().toISOString(),
    persisted: false,
  };

  fs.mkdirSync(path.dirname(driftFile(feature)), { recursive: true });
  fs.writeFileSync(driftFile(feature), JSON.stringify({ ...data, message: undefined }, null, 2), 'utf-8');
  data.persisted = true;

  const scopeNote =
    scopeMode === 'changed'
      ? `（仅 ${changedAbs.size} 个相关变更文件${changedAbs.size === 0 ? `，可能相对 ${input.since_ref ?? 'HEAD'} 无改动或未命中；可用 scope=all 全量对标` : ''}）`
      : '（全量文件）';
  const lines = [
    `══ detect_drift [${feature}] ══`,
    `  状态: ${status}${drifted ? '' : '（对齐）'} ${scopeNote}`,
    '',
    `  已检文件: ${data.summary.checked_files}`,
    `  ✅ 满足: ${matched}`,
    `  ❌ 缺实现: ${missing}`,
    `  ⚠️ 签名偏离: ${mismatched}`,
    `  🆕 设计未声明: ${unexpected}`,
    `  不变式: ${data.summary.invariant_passed}/${data.summary.invariant_passed + data.summary.invariant_failed} 通过`,
    '',
  ];
  if (staleFiles.size > 0) lines.push(`  过时文件(${staleFiles.size}): ${[...staleFiles].join(', ')}`);
  if (missingFiles.size > 0) lines.push(`  欠实现文件(${missingFiles.size}): ${[...missingFiles].join(', ')}`);
  lines.push('', '  【建议】');
  for (const s of suggestions) lines.push(`  - ${s}`);
  lines.push('', '  (台账已持久化，可用 mode=status 复读；改代码后再跑一次即可看到新漂移)');

  return { message: lines.join('\n'), ...data };
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: DetectDriftInput): Touched {
  const touched: Touched = {};
  // 作用域类（⇒ 随时可给，不依赖成败）：
  touched.feature = input.feature;
  // project_dir：★ **只认前两项真源** —— 入参 code_dir，或 DSL 的 source_root。
  //   ★ 刻意**不**复刻 Core 的第三项兜底 `path.join(process.cwd(),'scaffold',feature)`：
  //     那是"换了个题"（指向 scaffold 生成目录，不是被分析的项目根），不是"更弱的答案"——
  //     落到它上面时**省略整个字段**，绝不当成根填进去。
  if (input.code_dir) {
    touched.project_dir = path.resolve(input.code_dir);
  } else {
    const dsl = getDSL(input.feature);
    if (dsl?.source_root) touched.project_dir = path.resolve(dsl.source_root);
  }
  return touched;
}

export async function detectDrift(input: DetectDriftInput): Promise<TouchedProduct<DriftData & { message: string }>> {
  const r = await detectDriftCore(input);
  return withTouched(r, touchedOf(input));
}