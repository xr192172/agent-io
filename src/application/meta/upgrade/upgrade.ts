/**
 * upgrade —— 版本升级契约差：**检测（只读）** + **局部重写闭环**（应用 → 验证 → 提交/回退）。
 *
 * ★ 归位（2026-10-06，T15）：本能力原先**只活在两个 CLI 里**
 *   （`presentation/cli/upgrade_cli.ts` 的五阶段检测；`upgrade_rewrite_cli.ts` 的 git 验证回退闭环）
 *   ⇒ **能力被藏在 MCP 面之外**。按 T15「『CLI-only』这个类别应当归零」归位到能力层
 *   —— 与 `deprecate_offline` 同笔法：**核心住 application，CLI 退化成"一条命令"的薄壳**。
 *
 * ★ 为什么两个 CLI 收成**一个**入口：它们是**同一操作对象**「项目的版本升级契约差」——
 *   `upgrade_rewrite_cli` 把 `upgrade_cli` 的检测**整段再跑一遍**，只多出"计划 + 应用闭环"
 *   ⇒ 动作互补（读 / 写），按 `docs/tool-convergence.md` §2.0「**按操作对象聚合，不按实现机制**」
 *   合为 1 入口 + action（`scan` / `apply`）。★ 反过来说：若哪天它们要审的是**不同对象**
 *   （如"依赖升级" vs "语言边界"），就该拆开 —— 判据是操作对象，不是"名字像"。
 *
 * ★★ `apply` 路径的两处**如实记**（副作用，未做任何美化）：
 *   ① 前置：`root` 必须是 **git 仓库**（回退依赖 `git restore`）；
 *   ② 它**会提交用户仓库**：先把工作区**原有改动一并基线提交**（`gitCommitAll`，
 *      这是既有行为、不是本笔引入），通过验证后再**精确提交**改动文件；
 *      验证失败 / 项目形态识别不出 ⇒ `gitRestoreFiles` 回退到改写前。
 *   ⇒ 所以 `apply` 不是一个"静默写"的动作：它自带验证与回退，且**把账如实写进产物**。
 *
 * ★ 检测（`scan`）**只报告、不改写**：改写由 `apply` 承载（旧分工不变）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { requireStr, wrapData } from '../../plumbing.js';
import { runContractScan, type ContractScanResult } from '../../../infrastructure/authoring/version_upgrade/detect.js';
import {
  runStaticGates,
  runDynamicGates,
  type StaticGateResult,
  type DynamicGateResult,
} from '../../../infrastructure/authoring/version_upgrade/gate.js';
import { adapterMissHint } from '../../../infrastructure/authoring/version_upgrade/adapters/registry.js';
import type { FeatureHit } from '../../../infrastructure/authoring/version_upgrade/features.js';
import type { RemovedHit } from '../../../infrastructure/authoring/version_upgrade/removed.js';
import { buildRewritePlan, applyEdits, type PlanEdit } from '../../../infrastructure/authoring/version_upgrade/rewrite.js';
import { runVerification, defaultVerifyCommands } from '../../../infrastructure/verify_refactor.js';
import { isGitRepo, gitDirty, gitCommitFiles, gitCommitAll, gitRestoreFiles } from '../../../infrastructure/git.js';

const TOOL_LABEL: Record<string, string> = { java: 'JDK', node: 'Node', go: 'Go', python: 'Python' };

function statusBadge(status: string): string {
  switch (status) {
    case 'ok':
      return '✓ 满足';
    case 'missing':
      return '✗ 缺工具';
    default:
      return '! 版本不足';
  }
}

function renderToolchain(scan: ContractScanResult['scan']): string[] {
  const lines: string[] = [];
  lines.push('【1. 工具链版本盘点】');
  if (scan.declarations.length === 0) {
    lines.push('  （未发现工具链声明）');
    return lines;
  }
  lines.push('  子项目            | 工具   | 声明版本    | 本机版本    | 状态');
  lines.push('  ------------------|--------|-------------|-------------|--------');
  for (const m of scan.matches) {
    const proj = m.projectDir === '.' ? '<root>' : m.projectDir;
    lines.push(
      `  ${proj.padEnd(18)}| ${TOOL_LABEL[m.tool].padEnd(6)}| ${m.declaredVersion.padEnd(11)}| ${(m.localVersion ?? '未安装').padEnd(11)}| ${statusBadge(m.status)}`
    );
  }
  const bad = scan.matches.filter((m) => m.status !== 'ok');
  if (bad.length > 0) {
    lines.push('');
    lines.push(`  ⚠ 需关注 ${bad.length} 项：`);
    for (const m of bad) {
      lines.push(`    - ${m.projectDir === '.' ? '<root>' : m.projectDir}: ${TOOL_LABEL[m.tool]} ${m.declaredVersion} → ${m.note}`);
    }
  }
  return lines;
}

function renderFeatures(res: ContractScanResult): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('【2. 语言特性契约差检测】（以子项目声明版本为边界，超标=需重写）');
  if (res.features.length === 0) {
    lines.push('  （所有子项目源码均在声明版本边界内，无超标特性）');
    return lines;
  }
  for (const { declaration: d, boundary, hits } of res.features) {
    const label = TOOL_LABEL[d.tool];
    lines.push('');
    lines.push(`  ▶ ${d.projectDir === '.' ? '<root>' : d.projectDir}（声明 ${label} ${d.declaredVersion}，边界 ${label} ${boundary}）`);
    for (const h of hits) {
      lines.push(`      ${h.file}:${h.line}  ${h.feature}（需 ${label} ${h.since}）`);
      lines.push(`        → ${h.rewrite}：${h.snippet}`);
    }
  }
  return lines;
}

/** 未覆盖扩展名：扫到却没适配器 ⇒ 这些文件**没被检查**（§2d 少做事必须可见）。
 *  按扩展名去重成一行/种，并把"怎么补"（装什么/照哪份清单/现缺口多少）一次说清。 */
function renderUncovered(res: ContractScanResult): string[] {
  if (res.uncoveredExts.length === 0) return [];
  const lines: string[] = ['', '【2b. 未覆盖扩展名】（扫到却没有语言适配器 ⇒ 这些文件**没被检查**，不等于没问题）'];
  for (const { ext, files } of res.uncoveredExts) {
    lines.push(`  ${ext} ×${files} → ${adapterMissHint(ext)}`);
  }
  return lines;
}

function renderRemoved(res: ContractScanResult): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('【3. 废弃/移除 API 检测】（目标版本已移除/废弃该 API，= 契约对不上）');
  if (res.removed.length === 0) {
    lines.push('  （所有子项目源码均未使用目标版本已移除/废弃的 API）');
    return lines;
  }
  for (const { declaration: d, hits } of res.removed) {
    const label = TOOL_LABEL[d.tool];
    lines.push('');
    lines.push(`  ▶ ${d.projectDir === '.' ? '<root>' : d.projectDir}（声明 ${label} ${d.declaredVersion}）`);
    for (const h of hits) {
      const badge = h.kind === 'removed' ? '已移除' : '已废弃';
      lines.push(`      ${h.file}:${h.line}  ${h.api}（${badge}：${label} ${h.since} 起）`);
      lines.push(`        → ${h.rewrite}：${h.snippet}`);
    }
  }
  return lines;
}

function renderGates(gates: StaticGateResult[]): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('【4. 静态闸（编译级契约差）】--gate');
  if (gates.length === 0) {
    lines.push('  （无工具链声明）');
    return lines;
  }
  for (const g of gates) {
    const label = TOOL_LABEL[g.tool] ?? g.label;
    if (!g.available) {
      lines.push(`  ▶ ${g.projectDir === '.' ? '<root>' : g.projectDir}（${label} ${g.declaredVersion}）：本语言无单文件静态闸，改由项目级构建验证`);
      continue;
    }
    const fails = g.items.filter((i) => i.status === 'fail');
    const oks = g.items.filter((i) => i.status === 'ok');
    const skips = g.items.filter((i) => i.status === 'skipped');
    lines.push(
      `  ▶ ${g.projectDir === '.' ? '<root>' : g.projectDir}（${label} ${g.declaredVersion}，边界 ${label} ${g.boundary}）：编译 ${oks.length} · 超标 ${fails.length} · 跳过 ${skips.length}`
    );
    for (const f of fails) {
      lines.push(`      ✗ ${f.file}: ${f.detail ?? '编译失败'}`);
    }
    if (fails.length === 0 && skips.length === 0) lines.push('      ✓ 全部通过（无编译级契约差）');
  }
  return lines;
}

function renderDynamicGates(gates: DynamicGateResult[]): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push('【5. 动态闸（运行级契约差）】--dynamic');
  if (gates.length === 0) {
    lines.push('  （无工具链声明）');
    return lines;
  }
  for (const g of gates) {
    const label = TOOL_LABEL[g.tool] ?? g.label;
    if (!g.available) {
      lines.push(`  ▶ ${g.projectDir === '.' ? '<root>' : g.projectDir}（${label} ${g.declaredVersion}）：本语言暂无动态闸，运行层契约差暂不可检`);
      continue;
    }
    const fails = g.items.filter((i) => i.status === 'fail');
    const oks = g.items.filter((i) => i.status === 'ok');
    const skips = g.items.filter((i) => i.status === 'skipped');
    lines.push(
      `  ▶ ${g.projectDir === '.' ? '<root>' : g.projectDir}（${label} ${g.declaredVersion}，边界 ${label} ${g.boundary}）：运行通过 ${oks.length} · 运行异常 ${fails.length} · 跳过 ${skips.length}`
    );
    for (const f of fails) {
      lines.push(`      ✗ ${f.file}: ${f.detail ?? '运行时异常'}`);
    }
    if (fails.length === 0 && skips.length === 0) lines.push('      ✓ 全部运行通过（无运行级契约差）');
  }
  return lines;
}

function renderSummary(res: ContractScanResult): string[] {
  const featureCount = res.features.reduce((n, g) => n + g.hits.length, 0);
  const removedCount = res.removed.reduce((n, g) => n + g.hits.length, 0);
  const badMatch = res.scan.matches.filter((m) => m.status !== 'ok').length;
  return [
    '',
    `【汇总】工具链声明 ${res.scan.declarations.length} 项（${badMatch} 项不匹配本机）· 语言特性超标 ${featureCount} 处 · 废弃/移除 API ${removedCount} 处`,
  ];
}

/** 结构化产物（= 旧 `upgrade_cli --json` 的内容，**逐字同形** —— 只把"字符串化"留给调用方）。 */
export function upgradeScanData(
  res: ContractScanResult,
  gates: StaticGateResult[] = [],
  dynamicGates: DynamicGateResult[] = []
): Record<string, unknown> {
  return {
    root: res.root,
    toolchains: res.scan.matches.map((m) => ({
      projectDir: m.projectDir,
      tool: m.tool,
      declaredVersion: m.declaredVersion,
      localVersion: m.localVersion,
      status: m.status,
    })),
    features: res.features.map(({ declaration: d, boundary, hits }) => ({
      projectDir: d.projectDir,
      tool: d.tool,
      declaredVersion: d.declaredVersion,
      boundary,
      hits: hits.map((h: FeatureHit) => ({ file: h.file, line: h.line, feature: h.feature, since: h.since, rewrite: h.rewrite, snippet: h.snippet })),
    })),
    removed: res.removed.map(({ declaration: d, hits }) => ({
      projectDir: d.projectDir,
      tool: d.tool,
      declaredVersion: d.declaredVersion,
      hits: hits.map((h: RemovedHit) => ({ file: h.file, line: h.line, api: h.api, since: h.since, kind: h.kind, rewrite: h.rewrite, snippet: h.snippet })),
    })),
    uncoveredExts: res.uncoveredExts,
    gates: gates.map((g) => ({
      projectDir: g.projectDir,
      tool: g.tool,
      declaredVersion: g.declaredVersion,
      boundary: g.boundary,
      available: g.available,
      items: g.items,
    })),
    dynamicGates: dynamicGates.map((g) => ({
      projectDir: g.projectDir,
      tool: g.tool,
      declaredVersion: g.declaredVersion,
      boundary: g.boundary,
      available: g.available,
      items: g.items,
    })),
  };
}

export interface UpgradeScanResult {
  res: ContractScanResult;
  gates: StaticGateResult[];
  dynamicGates: DynamicGateResult[];
  /** 人读（等价于旧 CLI 的非 `--json` 输出） */
  lines: string[];
  /** 结构化（等价于旧 CLI 的 `--json` 内容） */
  data: Record<string, unknown>;
}

export interface UpgradeScanOptions {
  /** 附加阶段 D：静态闸（编译级契约差） */
  gate?: boolean;
  /** 附加阶段 E：动态闸（**真跑被测源码**） */
  dynamic?: boolean;
}

/** 五阶段检测（**只读**）：工具链盘点 / 语言特性契约差 / 废弃-移除 API /（可选）静态闸 /（可选）动态闸。
 *  ★ 这是 `scan` 的唯一实现 —— CLI 与 MCP 两面都走它（不再各写一份）。 */
export async function runUpgradeScan(root: string, opts: UpgradeScanOptions = {}): Promise<UpgradeScanResult> {
  const res = runContractScan(root);
  const gates = opts.gate ? runStaticGates(root, res.scan.declarations) : [];
  const dynamicGates = opts.dynamic ? await runDynamicGates(root, res.scan.declarations) : [];
  const lines = [`版本升级契约差检测：${root}`];
  lines.push(...renderToolchain(res.scan));
  lines.push(...renderFeatures(res));
  lines.push(...renderUncovered(res));
  lines.push(...renderRemoved(res));
  if (opts.gate) lines.push(...renderGates(gates));
  if (opts.dynamic) lines.push(...renderDynamicGates(dynamicGates));
  lines.push(...renderSummary(res));
  return { res, gates, dynamicGates, lines, data: upgradeScanData(res, gates, dynamicGates) };
}

export interface UpgradeApplyResult {
  ok: boolean;
  /** 人读（旧 CLI 逐行 `print` 的那些行 —— 顺序逐字保留） */
  lines: string[];
  /** 结构化（旧 CLI `--json` 的内容） */
  report: Record<string, unknown>;
}

/** **局部重写闭环**（旧 `upgrade_rewrite_cli` 的 main 本体，逐字搬入；只把 `print` 换成本地收集）：
 *  差异报告 → 局部重写建议 → 应用编辑（歧义/未命中整批拒绝）→ 改前基线提交 → 验证 → 通过则精确提交 / 失败则回退。
 *  ★ 调用方负责"编辑从哪来"（CLI 从 `--apply <edits.json>` 读、MCP 从入参数组来）—— 本函数只收**已解析**的编辑。 */
/** 目录存在性守卫 —— 旧两个 CLI **各写了一份**同样的检查 ⇒ 收到这里（一处口径）。
 *  返回 null = 正常；否则返回要打印的那一行错。 */
function dirMissingLine(root: string): string | null {
  return !fs.existsSync(root) || !fs.statSync(root).isDirectory() ? `✗ 项目目录不存在: ${root}` : null;
}

/** 阶段 1+2：差异报告 + 局部重写建议（**只读**）。`apply` 闭环与"仅报告模式"共用这一段
 *  —— ★ 旧 `upgrade_rewrite_cli` 在入口先跑一遍、`--apply` 时又跑一遍，**同一段写了两处**。 */
function scanAndPlan(root: string, lines: string[], report: Record<string, unknown>): void {
  lines.push(`版本升级契约差检测：${root}`);
  const res = runContractScan(root);
  const featureCount = res.features.reduce((n, g) => n + g.hits.length, 0);
  const removedCount = res.removed.reduce((n, g) => n + g.hits.length, 0);
  const badMatch = res.scan.matches.filter((m) => m.status !== 'ok').length;
  report.contract = {
    declarations: res.scan.declarations.length,
    mismatched_runtimes: badMatch,
    feature_over_boundary: featureCount,
    removed_deprecated_api: removedCount,
  };
  lines.push(`  工具链声明 ${res.scan.declarations.length} 项（${badMatch} 项不匹配本机）· 语言特性超标 ${featureCount} 处 · 废弃/移除 API ${removedCount} 处`);

  const plan = buildRewritePlan(res.features, res.removed);
  if (plan.length === 0) {
    lines.push('  无可重写的契约差（所有子项目源码均在声明版本边界内且无废弃/移除 API 使用）');
  } else {
    lines.push(`  局部重写建议（${plan.length} 条，按文件/行序）：`);
    for (const it of plan) {
      const tag = it.auto ? '[可自动]' : '[需LLM]';
      lines.push(`    ${tag} ${it.file}:${it.line}  ${it.kind === 'feature' ? '特性' : 'API'}「${it.label}」(since ${it.since})`);
      lines.push(`        → ${it.suggestion}：${it.snippet}`);
    }
  }
  report.plan = plan.map((it) => ({ file: it.file, line: it.line, kind: it.kind, label: it.label, since: it.since, suggestion: it.suggestion, auto: it.auto }));
}

/** **"仅报告模式"**（旧 `upgrade_rewrite_cli` **不带** `--apply` 的那条路）：契约差计数 + 按文件/行序的
 *  重写清单 —— 它的用途是**驱动闭环**，所以只给这两段，不铺五阶段全报告（那是 `scan` 的职责）。 */
export function runUpgradePlanReport(root: string): UpgradeApplyResult {
  const lines: string[] = [];
  const report: Record<string, unknown> = { root };
  const missing = dirMissingLine(root);
  if (missing) {
    lines.push(missing);
    return { ok: false, lines, report };
  }
  scanAndPlan(root, lines, report);
  return { ok: true, lines, report };
}

/** **局部重写闭环**（旧 `upgrade_rewrite_cli` 的 main 本体搬入；只把 `print` 换成本地收集）：
 *  差异报告 → 局部重写建议 → 应用编辑（歧义/未命中整批拒绝）→ 改前基线提交 → 验证 → 通过则精确提交 / 失败则回退。
 *  ★ 调用方负责"编辑从哪来"（CLI 从 `--apply <edits.json>` 读、MCP 从入参数组来）—— 本函数只收**已解析**的编辑。 */
export async function runUpgradeApplyLoop(
  root: string,
  edits: PlanEdit[],
  skipVerify = false
): Promise<UpgradeApplyResult> {
  const lines: string[] = [];
  const report: Record<string, unknown> = { root };

  const missing = dirMissingLine(root);
  if (missing) {
    lines.push(missing);
    return { ok: false, lines, report };
  }

  // ── 阶段 1+2：差异报告 + 局部重写建议（与"仅报告模式"共用同一段）──
  scanAndPlan(root, lines, report);

  // ── 阶段 3：git 验证回退闭环 ──
  lines.push('');
  lines.push('━━ 闭环：应用 → 验证 → 提交/回退 ━━');

  // 0. 前置：git 仓库（回退依赖）
  if (!isGitRepo(root)) {
    lines.push('✗ root 不是 git 仓库——闭环回退依赖 git，拒绝执行');
    report.refused = 'not_a_git_repo';
    return { ok: false, lines, report };
  }

  // 编辑形状复核（入参可能来自 MCP；CLI 侧还多一道"文件读得到吗"）
  if (!Array.isArray(edits) || edits.some((e) => !e?.file || typeof e?.from !== 'string' || typeof e?.to !== 'string')) {
    lines.push('✗ 编辑结构非法：应为 [{file, from, to}, ...]（未改动任何文件）');
    report.invalid_edits = true;
    return { ok: false, lines, report };
  }
  report.edits = edits;

  // 1. 基线快照（改前自动提交，用户偏好）
  if (gitDirty(root)) {
    const r = gitCommitAll(root, 'chore: baseline before upgrade-rewrite');
    report.baseline = { committed: r.committed, out: r.out };
    lines.push(r.committed ? '✓ 基线已提交（工作区原有改动先落盘）' : `⚠ 基线提交失败（可能无用户配置）: ${r.out}`);
  } else {
    lines.push('✓ 工作区干净，无需基线提交');
  }

  // 2. 应用编辑（先校验后落盘：歧义/未命中 → 拒绝，不改任何文件）
  let changedFiles: string[];
  try {
    const r = applyEdits(root, edits);
    changedFiles = r.changedFiles;
    lines.push(`✓ 已应用编辑 ${r.applied} 处，实际改动文件: ${changedFiles.join('、') || '（无）'}`);
  } catch (e) {
    lines.push(`✗ 编辑校验失败，未改动任何文件: ${(e as Error).message}`);
    report.apply_failed = (e as Error).message;
    return { ok: false, lines, report };
  }
  report.changed_files = changedFiles;

  // 3. 验证
  if (skipVerify) {
    lines.push('⚠ 已跳过验证（skip_verify）。未验证的改动不自动提交。');
    report.verify = { skipped: true };
  } else {
    const commands = defaultVerifyCommands(root);
    if (commands.length === 0) {
      lines.push('✗ 无法识别项目形态（无 go.mod/package.json 等），无法自动验证。已回退改动。');
      gitRestoreFiles(root, changedFiles);
      report.verify = { skipped: true, reverted: true, reason: '项目形态未识别' };
    } else {
      lines.push(`  运行验证: ${commands.map((c) => c.label).join('、')}`);
      const outcome = runVerification({ cwd: root, commands });
      report.verify = { status: outcome.status, detail: outcome.detail };
      if (outcome.status === 'pass') {
        lines.push('✓ 验证通过');
        const msg = 'feat(upgrade): 局部重写版本升级契约差';
        const r = gitCommitFiles(root, changedFiles, msg);
        report.commit = { committed: r.committed, message: msg, out: r.out };
        lines.push(r.committed ? `✓ 已提交: ${r.out.split(/\r?\n/)[0] ?? ''}` : `⚠ 提交失败: ${r.out}`);
      } else {
        lines.push('✗ 验证失败，正在回退…');
        lines.push((outcome.detail ?? '').split(/\r?\n/).filter(Boolean).slice(-15).join('\n'));
        gitRestoreFiles(root, changedFiles);
        lines.push('✓ 已回退，项目恢复改写前状态');
        report.rollback = true;
      }
    }
  }

  return { ok: true, lines, report };
}

/**
 * `upgrade`（meta 线）—— 一个入口两个动作：
 * · `action='scan'`（缺省）：只报告（可选 `gate` / `dynamic` 两道闸）
 * · `action='apply'`：局部重写闭环（需 `edits`，且 `project_dir` 须是 git 仓库）
 * ★ 入口守卫用 `requireStr`：CLI 面**不做 zod 校验**（见 `scripts/mcp/mcp_scan.mjs` 的 note），
 *   缺 `project_dir` 若不守，`path.resolve(undefined)` 会抛**裸 TypeError**。
 */
export const upgradeHandler = wrapData(async (a) => {
  const projectDir = requireStr(a, 'project_dir');
  const root = path.resolve(projectDir);
  const action = (typeof a.action === 'string' && a.action ? a.action : 'scan') as 'scan' | 'apply';

  if (action === 'apply') {
    const edits = Array.isArray(a.edits) ? (a.edits as PlanEdit[]) : [];
    if (edits.length === 0) {
      return {
        message:
          'upgrade 的 action=apply 需要 edits 参数（[{file, from, to}, …]，精确串替换；歧义/未命中会整批拒绝）。\n' +
          '  ⇒ 若只想看"该怎么改"：用 action=scan（缺省），它的 data.plan 段给出按文件/行序的建议清单。',
        data: { ok: false, reason: 'missing_edits' },
      };
    }
    const r = await runUpgradeApplyLoop(root, edits, a.skip_verify === true);
    return { message: r.lines.join('\n'), data: r.report };
  }

  const scanned = await runUpgradeScan(root, { gate: a.gate === true, dynamic: a.dynamic === true });
  return { message: scanned.lines.join('\n'), data: scanned.data };
});
