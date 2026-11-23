/**
 * touches: src/application/design/verifier_proof_pack.ts, scripts/verify-changed.mjs
 *
 * P1 · 第二企划：验证器自证包复活后的**模块直测**（当前仓内为零直测，G5）。
 *
 * 覆盖面（§6 T-P3 / T-P4 + 包核心纯函数面）：
 * · VERIFIER_FILES 自指回路（包本体在名单内，改包定义不能自证自己）；
 * · splitVerifierChange 精确集合判等（verifier / others，路径归一）；
 * · proofPackCoverage 廉检正反例：文件缺 / 用例缺 ⇒ ok=false 且 missing_* 点名到面；
 *   注释命中假阳性由真跑兜底（廉检不剥注释 ⇒ 片段在注释里仍算"在"，必须 runner 红兜底）；
 * · runVerifierProofPack 批注入契约：runBatch(rels) ⇒ Map<rel,{code,out}>；缺条目 fail-closed；
 *   全绿 ok=true、一支红 failed_files 点名 code/tail；
 * · renderProofPack 清单形状；runner 底座（p1_test_runner_jobs）明确排除在包外；
 * · WIDEN 新两条正则重放；verify-changed 静态配对（无 spawnSync、PP 动态 import、批通道接线、判红表达式未动）。
 *
 * ★ 本文件不 spawn runner（真跑回执由聚焦子集批通道跑包清单产出，见回执"包真跑回执"节）；
 *   批注入 Map 由本测试以桩函数构造，验的是包核心的判定与形状，不是 runner 口径。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = await import(pathToFileURL(path.join(ROOT, 'src', 'application', 'design', 'verifier_proof_pack.ts')).href);

const readRepoFile = (rel: string): string | null => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  } catch {
    return null;
  }
};

test('① VERIFIER_FILES 四项 + 包本体自指（改包定义不能自证自己）', () => {
  assert.deepEqual([...PACK.VERIFIER_FILES].sort(), [
    'scripts/verify-changed.mjs',
    'src/application/design/verified_snapshot.ts',
    'src/application/design/verifier_proof_pack.ts',
    'src/application/verify/verify_project.ts',
  ]);
  assert.ok(
    PACK.VERIFIER_FILES.includes('src/application/design/verifier_proof_pack.ts'),
    '包本体必须在 VERIFIER_FILES 内（自指回路双保险之一）',
  );
});

test('② splitVerifierChange：验证器 / 其它精确分堆，路径归一', () => {
  const sv = PACK.splitVerifierChange([
    'scripts/verify-changed.mjs',
    './src/application/design/verified_snapshot.ts',
    'src/application/design/verifier_proof_pack.ts',
    'src/domain/semantic.ts',
    'scripts/run-tests.mjs',
  ]);
  assert.deepEqual(sv.verifier.sort(), [
    'scripts/verify-changed.mjs',
    'src/application/design/verified_snapshot.ts',
    'src/application/design/verifier_proof_pack.ts',
  ]);
  assert.deepEqual(sv.others.sort(), ['scripts/run-tests.mjs', 'src/domain/semantic.ts']);
});

test('③ 廉检正例：真仓盘上证据齐全 ⇒ ok=true，missing 两表为空', () => {
  const cov = PACK.proofPackCoverage(readRepoFile);
  assert.equal(cov.ok, true, `覆盖缺口：${JSON.stringify([...cov.missing_files, ...cov.missing_cases].slice(0, 5))}`);
  assert.equal(cov.missing_files.length, 0);
  assert.equal(cov.missing_cases.length, 0);
  assert.ok(cov.areas > 8, '面数按 F.2 扩展后应多于旧 8 面');
});

test('④ 廉检反例 A：证据文件盘上没有 ⇒ missing_files 点名到面', () => {
  const cov = PACK.proofPackCoverage(() => null);
  assert.equal(cov.ok, false);
  assert.ok(cov.missing_files.length > 0, '文件缺必须进 missing_files');
  for (const m of cov.missing_files) {
    assert.ok(m.area.length > 0 && m.file.startsWith('tests/'), 'missing_files 条目须带面名与文件路径');
  }
});

test('⑤ 廉检反例 B：用例片段被改名/删掉 ⇒ missing_cases 点名到面', () => {
  const cov = PACK.proofPackCoverage((rel) => (rel === 'tests/p0_widen_whitelist.test.ts' ? '// 空文件骨架' : readRepoFile(rel)));
  assert.equal(cov.ok, false);
  assert.ok(cov.missing_cases.some((m) => m.file === 'tests/p0_widen_whitelist.test.ts' && m.case.length > 0), '缺的用例必须点名到面');
});

test('⑥ 双层闸：片段只在注释里（廉检命中假阳性）⇒ 廉检仍绿，真跑红兜底', () => {
  // 廉检不剥注释：用例片段出现在注释/字符串里也算"在" —— 这是已知必要非充分条件。
  const commentOnly = `// 注释里提到：P0-widen-whitelist · ① / P0-widen-whitelist · ②\nexport const x = 1;\n`;
  const cov = PACK.proofPackCoverage((rel) => (rel === 'tests/p0_widen_whitelist.test.ts' ? commentOnly : readRepoFile(rel)));
  assert.equal(cov.ok, true, '廉检对注释命中假阳性不设防（诚实边界①）');
  // 真跑兜底：注入一支"红"回执 ⇒ 包红 ⇒ widen，假阳性被第二层闸关掉。
  const files = [...new Set(PACK.VERIFIER_PROOF_PACK.flatMap((a) => a.tests.map((t) => t.file)))];
  const redBatch = new Map(files.map((f) => [f, { code: f === 'tests/p0_widen_whitelist.test.ts' ? 1 : 0, out: 'tail' }]));
  const run = PACK.runVerifierProofPack(() => redBatch);
  assert.equal(run.ok, false, '真跑红必须把假阳性廉检翻红');
  assert.equal(run.failed_files.length, 1);
  assert.equal(run.failed_files[0].file, 'tests/p0_widen_whitelist.test.ts');
});

test('⑦ runVerifierProofPack 批注入：全绿 Map ⇒ ok；一支红 ⇒ failed_files 带 code/tail；缺条目 fail-closed', () => {
  const files = [...new Set(PACK.VERIFIER_PROOF_PACK.flatMap((a) => a.tests.map((t) => t.file)))];
  const green = new Map(files.map((f) => [f, { code: 0, out: '' }]));
  const okRun = PACK.runVerifierProofPack(() => green);
  assert.equal(okRun.ok, true);
  assert.equal(okRun.files, files.length);
  assert.deepEqual(okRun.failed_files, []);

  const oneRed = new Map(files.map((f) => [f, { code: f === files[0] ? 2 : 0, out: `line1\nline2\n` }]));
  const bad = PACK.runVerifierProofPack(() => oneRed);
  assert.equal(bad.ok, false);
  assert.equal(bad.failed_files.length, 1);
  assert.equal(bad.failed_files[0].code, 2);
  assert.ok(bad.failed_files[0].tail.includes('line2'), 'tail 取输出尾巴');

  // 回执缺条目 ⇒ 不许当绿（fail-closed）
  const missing = new Map<string, { code: number; out: string }>();
  const missingRun = PACK.runVerifierProofPack(() => missing);
  assert.equal(missingRun.ok, false);
  assert.equal(missingRun.failed_files.length, files.length);
  assert.ok(missingRun.failed_files.every((x) => x.code === 1), '缺条目一律 code=1');
});

test('⑧ renderProofPack：清单首行带面数，每面证据行非空', () => {
  const lines = PACK.renderProofPack();
  assert.ok(lines[0].includes(String(PACK.VERIFIER_PROOF_PACK.length)), '首行须报面数');
  const evidence = lines.filter((l) => l.includes('证据:'));
  assert.ok(evidence.length >= PACK.VERIFIER_PROOF_PACK.length, '每个面至少一条证据行');
});

test('⑨ runner 底座面（p1_test_runner_jobs）明确排除在包外', () => {
  const files = PACK.VERIFIER_PROOF_PACK.flatMap((a) => a.tests.map((t) => t.file));
  assert.ok(!files.includes('tests/p1_test_runner_jobs.test.ts'), 'runner --jobs/隔离/护栏是公共底座，永不入包');
});

test('⑩ WIDEN 新两条正则：命中各自文件，不误伤无关路径', async () => {
  const { WIDEN_PATTERNS } = await import(pathToFileURL(path.join(ROOT, 'src', 'application', 'design', 'verified_snapshot.ts')).href);
  const hit = (p: string) => WIDEN_PATTERNS.some((re: RegExp) => re.test(p));
  assert.equal(hit('src/application/verify/verify_project.ts'), true, 'verify_project.ts 在名单内');
  assert.equal(hit('src/application/design/verifier_proof_pack.ts'), true, 'verifier_proof_pack.ts 在名单内');
  assert.equal(hit('src/application/verify/other_helper.ts'), false, '新正则不得误伤 verify 目录其它文件');
  assert.equal(hit('src/application/design/other.ts'), false, '新正则不得误伤 design 目录其它文件');
});

test('⑪ verify-changed 静态配对：无 spawnSync、PP 动态 import 接线、批通道注入、判红表达式未动', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'verify-changed.mjs'), 'utf8');
  assert.ok(!src.includes('spawnSync'), '死块三缺陷之一：spawnSync 已移除（execFileSync 是唯一 child_process 调用）');
  assert.match(src, /await import\('\.\.\/dist\/src\/application\/design\/verifier_proof_pack\.js'\)/, 'PP 必须经 dist 动态 import 接线');
  assert.match(src, /runVerifierProofPack\(\(rels\)/, '包执行改挂 runner 批通道注入（runBatch 闭包）');
  assert.match(src, /runNodeBatch\(proofFiles, jobs\)/, '批通道一次 invocation 跑去重清单');
  // 硬耦合禁区：:1052 判红表达式本批不改（retired 不抬 rc 在 design-check 上游解决）
  assert.match(src, /designCheckRun\.rc !== 0/, '判红表达式仍消费 designCheckRun.rc（语义未改）');
  // 收窄数组单例共用：注入点与镜像引用同一标识符
  const inject = src.includes('widenPatterns: verifierNarrowedPatterns');
  const mirror = src.includes('verifierNarrowedPatterns ?? (VS ? VS.WIDEN_PATTERNS : [])');
  assert.ok(inject && mirror, 'planInheritance 注入与 no-evidence 镜像必须共用同一收窄数组单例');
});

/** 临时仓跑真实 CLI（显式点名验证器文件，不经 git）；dist 以 junction 接到真仓，证据 read 仍指临时根。 */
function runCliE2E(rels: string[], asJson: boolean): { rc: number; text: string; json: Record<string, unknown> | null } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-e2e-'));
  try {
    try { fs.symlinkSync(path.join(ROOT, 'dist'), path.join(dir, 'dist'), 'junction'); } catch { /* 已存在 */ }
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('AGENT_IO_')) delete env[k];
    env.AGENT_IO_VERIFY_CHANGED_ROOT = dir;
    const script = path.join(ROOT, 'scripts', 'verify-changed.mjs');
    let out = '';
    let rc = 0;
    try {
      out = execFileSync(process.execPath, [script, ...rels, '--no-run', ...(asJson ? ['--json'] : [])], {
        cwd: dir, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      rc = typeof (e as { status?: number }).status === 'number' ? (e as { status: number }).status! : -1;
      out = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '');
    }
    let json: Record<string, unknown> | null = null;
    if (asJson) {
      const line = out.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop() ?? '';
      if (line) { try { json = JSON.parse(line) as Record<string, unknown>; } catch { json = null; } }
    }
    return { rc, text: out, json };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录 */ }
  }
}

test('⑫ T-P1 端到端：临时仓点名验证器文件 ⇒ 包证据缺失 ⇒ 覆盖缺口 widen（不跑包）；再带 runner 底座仍全量', () => {
  // 覆盖缺口分支：临时根里没有包证据测试文件 ⇒ 廉检 missing_files 非空 ⇒ widen，note 点名覆盖不足。
  const a = runCliE2E(['src/application/design/verified_snapshot.ts'], true);
  const scopeA = a.json?.verified_scope as { widen: string | null } | undefined;
  assert.ok(scopeA?.widen, '证据缺失 ⇒ 必须扩大选材');
  const aText = runCliE2E(['src/application/design/verified_snapshot.ts'], false);
  assert.match(aText.text, /自证包覆盖不足/, '结论必须点名覆盖缺口（不是静默收窄）');

  // 公共底座（runner）命中 ⇒ 与包结论无关，仍全量。
  const b = runCliE2E(['src/application/design/verified_snapshot.ts', 'scripts/run-tests.mjs'], true);
  const scopeB = b.json?.verified_scope as { widen: string | null } | undefined;
  assert.ok(scopeB?.widen, '验证器 + runner 底座混合改动 ⇒ 仍全量');
});
