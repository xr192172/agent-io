/**
 * ★★★ T202（2026-10-12）：**诊断闭环** —— 把 `presentation/cli/diagnose_loop_cli.ts` 的那条链**上工具面**。
 *
 * ## 为什么（★ 目标 `g-cli-only-to-face` 的话）
 * *"`diagnose_loop` 最可惜 —— 它正是「闭环」，而工具面看不见 ⇒ LLM 只能走 CLI"* ✓
 * ★ 而工具面**已有 `diagnose`**（只覆盖**阶段 2**：`{project_dir, symptom, symptom_type, anchor, max_depth}`）
 * ⇒ ★ **缺的是闭环的其余部分**：**出补丁 → 应用 → 验证** ✓
 *
 * ## 与 CLI 的两处【有意不同】（★ 不是没做完）
 * 1. ★★ **不做 git 提交**（CLI 的阶段 5）—— ★ **提交是不可逆的对外动作** ⇒ 工具**做到验证为止**，
 *    在回执里**明说**「提交请你自己做」并给下一步 ✓（★ "可逆的自己做、不可逆的停下来"）。
 * 2. ★★ **默认 `apply=false`** —— ★ **只诊断 + 出补丁 + 给 diff，【不改项目源码】** ✓（★ 符号缓存会写 —— 那是工具自己的索引，不是你的源码）
 *    要真改，得**显式** `apply:true` ✓（★ 本仓对"写"的一贯口径：不写是默认）。
 *
 * ★ 而 CLI 里**必须保留**的一条：**验证失败 ⇒ 回退**（`revertPatches` + `gitRestoreFiles`）✓
 *   —— ★ 否则会**留下半成品**（比不改更坏）。★ 回退是**还原**、不是不可逆动作 ⇒ 工具里照做 ✓。
 *
 * ## 判据全在被复用的实现里（★ 本文件只是**串**，不新造判据）
 * `syncProject` · `runDiagnosis` · `generatePatch` / `applyPatches` / `revertPatches` / `allowedPatchFiles`
 * · `detectKind` · `readTestContract`（★ 从 CLI **搬进 infrastructure**，两边共用，避免判据住两处）
 */
import { execSync } from 'node:child_process';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { walkFiles } from '../../../infrastructure/graph/import_project.js';
import { syncProject } from '../../../infrastructure/index/symbols.js';
import { runDiagnosis, formatDiagnoseText } from '../../../infrastructure/analysis/diagnosis/diagnose.js';
import {
  generatePatch,
  applyPatches,
  revertPatches,
  formatPatchDiff,
  allowedPatchFiles,
} from '../../../infrastructure/analysis/diagnosis/repair.js';
import { detectKind } from '../../../infrastructure/analysis/diagnosis/verifier.js';
import { readTestContract } from '../../../infrastructure/analysis/diagnosis/test_contract.js';
import { gitRestoreFiles } from '../../../infrastructure/git.js';

/** 闭环在**哪一步停下**（★ 回执里要如实说清楚 —— "止步"与"做完了"长得像，是本仓最反对的） */
export type DiagnoseLoopStage = 'cache' | 'diagnose' | 'plan' | 'applied' | 'verified' | 'reverted';

export interface DiagnoseLoopInput {
  project_dir: string;
  symptom: string;
  /** ★ 默认 `false` ⇒ 只到「出补丁 + diff」，**不写盘** */
  apply?: boolean;
  /** ★ 默认 `true`（仅在 `apply=true` 时起作用）：应用后跑项目自己的验证命令 */
  verify?: boolean;
  /** 验证命令超时（秒），默认 300 */
  verify_timeout_sec?: number;
}

export interface DiagnoseLoopResult {
  message: string;
  data: {
    stopped_at: DiagnoseLoopStage;
    /** ★ 每一步的读数（★ 都不加工，原样给） */
    cache?: { total: number; updated: number; failed: number; ms: number } | { error: string };
    diagnosis?: { engine: string; root_cause: unknown; fix_suggestions: unknown };
    patch?: { rationale: string; allowed_files: string[]; diff: string[]; changed_files: string[] };
    applied?: boolean;
    verify?: { command: string; ok: boolean; output_tail: string } | { skipped: true; reason: string };
    reverted?: boolean;
    /** ★★ 明确告诉调用方「下一步该做什么」（★ 尤其"提交要你自己做"） */
    next: string;
  };
}

export async function diagnoseLoop(input: DiagnoseLoopInput): Promise<DiagnoseLoopResult> {
  const root = input.project_dir;
  const apply = input.apply === true;
  const verify = input.verify !== false;
  const timeoutSec = input.verify_timeout_sec ?? 300;
  const lines: string[] = [];
  const data: DiagnoseLoopResult['data'] = { stopped_at: 'cache', next: '' };

  // ── 阶段 1：符号缓存（诊断依赖 cache.db）─────────────────────────
  // ★ 与 CLI 一致：**失败就降级并如实记**（不假装有符号证据）。
  try {
    const cacheDb = getProjectCacheDb(root);
    const absFiles = walkFiles(root, false);
    const synced = await syncProject(cacheDb, root, absFiles);
    data.cache = { total: synced.total, updated: synced.updated, failed: synced.failed, ms: synced.ms };
    lines.push(`符号缓存：${synced.total} 文件 / ${synced.updated} 更新 / ${synced.failed} 失败（${synced.ms}ms）`);
  } catch (e) {
    data.cache = { error: (e as Error).message };
    lines.push(`⚠ 符号缓存建立失败（本轮诊断降级为无符号证据）：${(e as Error).message}`);
  }

  // ── 阶段 2：诊断 ────────────────────────────────────────────────
  const diag = await runDiagnosis({ project_dir: root, symptom: input.symptom, use_llm: true });
  data.diagnosis = { engine: diag.engine, root_cause: diag.root_cause, fix_suggestions: diag.fix_suggestions };
  data.stopped_at = 'diagnose';
  if (!diag.root_cause) {
    lines.push('✗ 未定位到根因（证据不足），**无法自动修复** —— 闭环止步于诊断。');
    lines.push(formatDiagnoseText(diag));
    return {
      message: lines.join('\n'),
      data: { ...data, next: '★ 补足证据（更多 symptom / anchor）后重试，或手动修复。**没有改动项目源码**（仅有工具自己的缓存）。' },
    };
  }
  lines.push(formatDiagnoseText(diag));

  // ── 阶段 3：出补丁（LLM 补丁 → 校验）────────────────────────────
  const kind = detectKind(root);
  const repairInput = {
    project_dir: root,
    root_cause: diag.root_cause,
    fix_suggestions: diag.fix_suggestions,
    test_contract: readTestContract(root),
  };
  const allowed = allowedPatchFiles(repairInput);
  const plan = await generatePatch(repairInput);
  data.stopped_at = 'plan';
  if (!plan) {
    lines.push('✗ 无法生成自动修复补丁（未配置 LLM，或 LLM 失败）—— 闭环止步于出补丁。');
    return {
      message: lines.join('\n'),
      data: { ...data, next: '★ 手动修复后自己跑项目测试。**没有改动项目源码**（仅有工具自己的缓存）。' },
    };
  }
  const diff = formatPatchDiff(root, plan);
  data.patch = { rationale: plan.rationale, allowed_files: allowed, diff, changed_files: [] };
  lines.push(`待应用补丁（修改白名单：${allowed.join('、')}）`);
  for (const d of diff) lines.push(d);
  lines.push(`补丁说明：${plan.rationale}`);

  // ── ★★ 默认到这里就停：不写盘 ───────────────────────────────────
  if (!apply) {
    lines.push('');
    lines.push('★ 本次 `apply` **未给**（默认 `false`）⇒ **只算不写**：**项目源码一个字节都没动**。');
    lines.push('  ★ 注：符号缓存（`.agent-io/cache.db`）**已建/更新** —— 那是本工具自己的索引，不是你的源码。');
    return {
      message: lines.join('\n'),
      data: {
        ...data,
        stopped_at: 'plan',
        next: '★ 看过 diff 后要真改，重调本工具并给 `apply:true`（★ 应用后会自动跑验证，验证不过会自己回退）。',
      },
    };
  }

  // ── 阶段 4：应用 ────────────────────────────────────────────────
  const { applied, errors } = applyPatches(root, plan, allowed);
  if (errors.length > 0) {
    lines.push('✗ 补丁校验失败，**未改动任何文件**：');
    for (const e of errors) lines.push(`  - ${e.file} → ${e.reason}`);
    return {
      message: lines.join('\n'),
      data: { ...data, next: '★ 按上面的理由调整后重试。**没有改动项目源码**。' },
    };
  }
  const changedFiles = [...new Set(applied.map((a) => a.file))];
  data.applied = true;
  data.stopped_at = 'applied';
  data.patch = { ...(data.patch as NonNullable<typeof data.patch>), changed_files: changedFiles };
  lines.push(`✓ 已应用 ${applied.length} 个补丁，改动文件：${changedFiles.join('、')}`);

  // ── 阶段 5：验证（★ 不过就回退 —— CLI 里那条"不留半成品"必须保留）──
  if (!verify) {
    data.verify = { skipped: true, reason: 'verify=false' };
    lines.push('⚠ 已跳过验证（`verify:false`）—— 改动**留在工作区**，请你自己验。');
    return {
      message: lines.join('\n'),
      data: { ...data, next: '★ **未验证的改动不自动提交** ⇒ 自己跑验证、自己 review、自己提交。' },
    };
  }
  if (!kind) {
    revertPatches(applied);
    gitRestoreFiles(root, changedFiles);
    data.verify = { skipped: true, reason: '项目类型未识别（无法知道该跑什么验证命令）' };
    data.reverted = true;
    data.stopped_at = 'reverted';
    lines.push('✗ 无法识别项目类型 ⇒ 不知道跑什么验证 ⇒ **已回退补丁，项目恢复到修复前状态**。');
    return {
      message: lines.join('\n'),
      data: { ...data, next: '★ 项目没有可识别的验证入口（测试命令）⇒ 这类项目请手动验证后自己改。' },
    };
  }
  let ok = false;
  let output = '';
  lines.push(`运行验证命令：${kind.test}（超时 ${timeoutSec}s）`);
  try {
    output = execSync(kind.test, { cwd: root, encoding: 'utf-8', stdio: 'pipe', timeout: timeoutSec * 1000 });
    ok = true;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    output = err.stdout ?? err.stderr ?? err.message ?? '未知错误';
  }
  const tail = output.split(/\r?\n/).filter(Boolean).slice(-15).join('\n');
  data.verify = { command: kind.test, ok, output_tail: tail };
  if (ok) {
    data.stopped_at = 'verified';
    lines.push('✓ 验证通过');
    lines.push(tail);
    lines.push('');
    lines.push('★★ **本工具到「验证通过」为止 —— 提交是【不可逆的对外动作】，请你自己做。**');
    return {
      message: lines.join('\n'),
      data: {
        ...data,
        next: `★ 改动【保留在工作区】。下一步由你决定：review 后自己 git commit（改动文件：${changedFiles.join('、')}）。`,
      },
    };
  }
  lines.push('✗ 验证失败 ⇒ 正在回退补丁…');
  lines.push(tail);
  revertPatches(applied);
  gitRestoreFiles(root, changedFiles);
  data.reverted = true;
  data.stopped_at = 'reverted';
  lines.push('✓ 已回退，项目恢复到修复前状态（★ **不留半成品**）。');
  return {
    message: lines.join('\n'),
    data: { ...data, next: '★ 验证没过 ⇒ 补丁已被回退。看上面的输出定位原因，再决定下一步。' },
  };
}
