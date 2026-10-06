/**
 * archify_runner —— Archify 官方命令的进程封装（validate / deliver，showcase 质量）
 *
 * ★ 2026-10-06（T15）**归位 + 改名**：原名 `presentation/cli/archify_cli.ts`，但它**不是命令** ——
 *   无 argv、无 `main()`、无 `process.exit`，只有导出函数；而 `cli-surface` 那条域规则是
 *   「**每个文件 = 一条命令**」，它对不上（与 `cli/render/`、`deprecate_offline.ts` 当年同型）。
 *   它的**唯一消费者**是 `archify_pipeline`（同域 `archify-r5`）⇒ 搬到消费者旁边，并去掉误导性的 `_cli`。
 *
 * 这是把 Archify 当内置能力的执行触点：定位 CLI、用官方 validate/deliver 判定 showcase 产出。
 * validate 不达要求只带回诊断，不做几何修补。
 *
 * ★ 装配（2026-09-15）：Archify 已 vendor 进仓（`third_party/archify`，MIT，2.4M 精简版），
 * 因此**默认就在仓内**、随仓库版本固定、CI 可验证 —— 不再依赖机器上的环境变量。
 * 解析优先级（高→低）：
 *   1. 显式入参 explicit（测试/调用方临时指定，仅当含 archify/bin/archify.mjs）；
 *   2. `ARCHIFY_ROOT` 环境变量（**可选覆盖**，保留给指向外部安装的高级用法）；
 *   3. ★ 仓内默认：从本模块回溯到仓库根的 `third_party`（= <repo>/third_party/archify/…）。
 * 返回值语义与既有调用方一致：**指向"含 archify/ 的根目录"**（archifyCliPath 再拼 archify/bin/…）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 本文件所在目录（源码态 `src/presentation/http/archify`，产物态 `dist/src/presentation/http/archify`） */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 仓内 archify 的父目录（即含 archify/ 的根）：
 * 从 HERE 逐级上溯找含 `third_party/archify/bin/archify.mjs` 的目录。找不到 → ''。
 * ★ 层数 8 是**给新位置留的余量**（2026-10-06 归位前它住在 `presentation/cli/`，那时 6 够用且余 1 层；
 *   搬深一层后仓根落在**第 6 次**上溯 ⇒ 0 层余量，再深一层就会**静默**失效）。
 *   实测：产物态下 `resolveArchifyRoot()` 返回 `<repo>/third_party`（该笔提交里的验收读数）。
 */
function vendoredArchifyRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'third_party');
    if (fs.existsSync(path.join(candidate, 'archify', 'bin', 'archify.mjs'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

export function resolveArchifyRoot(explicit?: string): string {
  const e = explicit?.trim();
  if (e) return e.replace(/[\\/]+$/, '');
  const env = process.env.ARCHIFY_ROOT?.trim();
  if (env) return env.replace(/[\\/]+$/, '');
  return vendoredArchifyRoot();
}

export function archifyCliPath(root: string): string {
  return path.join(root, 'archify', 'bin', 'archify.mjs');
}

export interface CliResult { ok: boolean; stdout: string; stderr: string; note?: string }

/** 运行 archify CLI 并返回结果（不抛异常，交给调用方判定） */
function run(root: string, args: string[]): CliResult {
  const cli = archifyCliPath(root);
  const r = spawnSync('node', [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 25000 });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { ok: false, stdout: '', stderr: '', note: 'Archify CLI 调用超时（25s）' };
  }
  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();
  const ok = r.status === 0;
  return { ok, stdout, stderr };
}

/** validate（默认 showcase 质量；可降级 standard）。candidateJson 为绝对路径或原始 JSON 对象。 */
export function validateCandidate(root: string, type: string, candidateJson: unknown, quality: 'showcase' | 'standard', scaffoldDir?: string): CliResult {
  const dump = toFile(candidateJson, scaffoldDir, `${type}-validate.json`);
  const r = run(root, ['validate', type, dump.abspath, '--quality', quality, '--json']);
  return r;
}
/** 兼容别名：showcase 校验 */
export function validateShowcase(root: string, type: string, candidateJson: unknown, scaffoldDir?: string): CliResult {
  return validateCandidate(root, type, candidateJson, 'showcase', scaffoldDir);
}

/** deliver 出官方 HTML（默认 showcase；可降级 standard）。htmlPath 为输出目标绝对路径。 */
export function deliverHtml(root: string, type: string, candidateJson: unknown, htmlPath: string, quality: 'showcase' | 'standard', scaffoldDir?: string): CliResult {
  const dump = toFile(candidateJson, scaffoldDir, `${type}-deliver.json`);
  const r = run(root, ['deliver', type, dump.abspath, htmlPath, '--quality', quality, '--json']);
  return r;
}

/** 把 candidate 写成临时 JSON；若在 scaffoldDir 内写则保持可追溯 */
function toFile(candidateJson: unknown, scaffoldDir: string | undefined, suffix: string): { file: string; abspath: string } {
  if (typeof candidateJson === 'string') return { file: candidateJson, abspath: candidateJson };
  if (scaffoldDir) {
    fs.mkdirSync(scaffoldDir, { recursive: true });
    const rel = `${suffix}`;
    fs.writeFileSync(path.join(scaffoldDir, rel), JSON.stringify(candidateJson, null, 2), 'utf-8');
    return { file: rel, abspath: path.join(scaffoldDir, rel) };
  }
  const f = path.join(os.tmpdir(), `archify-${Date.now()}-${suffix}`);
  fs.writeFileSync(f, JSON.stringify(candidateJson, null, 2), 'utf-8');
  return { file: f, abspath: f };
}