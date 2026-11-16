/**
 * P1 · cascade 的**根注入**判据（审计 D4-9 修复的检测点）
 *
 * ## 它挡的事故
 * `edit_dsl` 落盘成功后 cascade 跑 cognition。改前 `computeSections()` 是**零参**，内部闭包模块级
 * `projectDir`（= `--project` ?? `process.cwd()`），而 cascade 写的是 `path.join(root, '.agent-io/COGNITION.txt')`
 * ——`root` 来自 `dsl.source_root ?? a.code_dir ?? ''`。于是两件事同时错，且都**无声**：
 * · root 非空、但与 cwd 不是同一个项目（长驻 MCP server 下 cwd = 起 server 的目录）⇒ **读 A 项目的册、写 B 项目的文件**；
 * · root 为空串 ⇒ `path.join('')` 就是 cwd ⇒ 拿 cwd 的册**覆盖写 cwd 的 COGNITION.txt**。
 * 另外顶层三个 CLI 分支无条件执行 ⇒ 任何人 `import()` 生成器都顺手写一份快照（导入即写盘）。
 *
 * ## 判据（实现住 scripts/gen_cognition.mjs 的入参化 + cascade 的空根跳过）
 * · R1 `computeSections(projectDir)` 枚举的是**入参**那个项目的 `.agent-io/design/*.dsl.json`
 * · R2 `import` 生成器**不再有顶层写盘副作用**（三个分支进了 main-module 守卫）
 * · R3 `runCascade(root)` 写出的 COGNITION.txt 只含**这个 root** 的 feature 段（digest 失败要响亮）
 * · R4 `runCascade('')` ⇒ cognition 进 `skipped` 且写明原因，**不落 cwd**
 *
 * ## 消融口径（文件头钉死，改坏实现时哪条红）
 * · `computeSections` 复活 cwd 闭包（零参 / 内部读模块级 projectDir）⇒ ① 红
 *   （枚举到仓库册的 feature，而不是夹具的 A/B —— 前提：本用例按 `run-tests.mjs` 的口径以仓为 cwd 跑）
 * · 顶层 `--stdout`/`--check`/写盘三分支跑出 main-module 守卫 ⇒ ② 红
 *   （导入就抛"设计册目录不存在"，或夹具 cwd 侧冒出 `.agent-io/COGNITION.txt`）
 * · cascade 不把 root 传给 computeSections ⇒ ③ 红（文件里是仓库的 feature 段，不是夹具的）
 * · cascade 对空 root 仍走 cognition 分支 ⇒ ④ 红（没有 skipped 原因；且夹具 cwd 侧真被写出 COGNITION.txt）
 *
 * ## 夹具口径
 * · 每个夹具都是 `mkdtemp` 的临时项目；落盘按项目根开 cache.db（进程级缓存）⇒ 删前先
 *   `closeAllProjectCacheDbs()`（Windows 句柄没关 ⇒ rmSync EBUSY）。
 * · ③④ 要**真跑**生成器 ⇒ 把 `scripts/gen_cognition.mjs` **连同它的 import 闭包**（整目录 `scripts/lib/`）
 *   整份拷进夹具（AGENTS.md §四：点名清单漏过依赖时，红在 ERR_MODULE_NOT_FOUND 而不是判据上）。
 * · 夹具里**没有 dist** ⇒ 生成器调 CLI 必然失败 ⇒ 文件内必须出现 ⚠ 段（"取不到" ≠ "没内容"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ★ 夹具项目里没有画布（tasks.db#plans）—— 本文件验的是"根从哪来"，不是画布闸。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { runCascade } = await import('../src/application/design/cascade.js');
// ★ 落盘按项目根开 cache.db（进程级缓存）；Windows 句柄没关 ⇒ 删目录 EBUSY ⇒ 先关再删。
const { closeAllProjectCacheDbs } = await import('../src/infrastructure/index/db.js');

/** 生成器模块的公共面（.mjs 无类型 ⇒ 在这里声明一次，别在用例里到处撒 any） */
type CogModule = {
  computeSections: (projectDir: string) => Array<{
    feature: string;
    rev: number;
    hash: string;
    lines: string[];
    error: string | null;
  }>;
  renderCognition: (sections: unknown) => string;
};

let cacheBust = 0;

function cleanup(proj: string): void {
  closeAllProjectCacheDbs();
  fs.rmSync(proj, { recursive: true, force: true, maxRetries: 6, retryDelay: 60 });
}

function mkProject(files: Record<string, string>): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-cascade-root-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(proj, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return proj;
}

/** 造夹具册：`.agent-io/design/<feature>.dsl.json`（生成器只从它读 rev / 枚举 feature） */
function mkSheet(proj: string, features: string[], rev = 7): void {
  for (const f of features) {
    const abs = path.join(proj, '.agent-io', 'design', `${f}.dsl.json`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify({ rev, meta: { feature: f } }, null, 2), 'utf8');
  }
}

/** 把生成器 + 它的 import 闭包（整目录 scripts/lib/）拷进夹具 */
function copyGenerator(proj: string): void {
  const dst = path.join(proj, 'scripts');
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts', 'gen_cognition.mjs'), path.join(dst, 'gen_cognition.mjs'));
  fs.cpSync(path.join(REPO, 'scripts', 'lib'), path.join(dst, 'lib'), { recursive: true });
}

/** 带 cache-buster 动态 import 一份 .mjs（同进程里多次 import 互不串味） */
async function importGenerator(absFile: string): Promise<CogModule> {
  const url = `${pathToFileURL(absFile).href}?case=${++cacheBust}`;
  return (await import(url)) as CogModule;
}

/** 仓库自己的册有哪些 feature（"不许投影别人册"的对照面；★ 按 REPO 现数，不按 cwd 猜） */
function repoFeatures(): string[] {
  const dir = path.join(REPO, '.agent-io', 'design');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => f.slice(0, -'.dsl.json'.length));
}

test('① computeSections(夹具root) 枚举夹具的册，不是进程 cwd 的册', async () => {
  const proj = mkProject({});
  try {
    mkSheet(proj, ['A', 'B']);
    // ★ 这条要验的是**仓库里那份实现**（审计对象），不是拷贝
    const cog = await importGenerator(path.join(REPO, 'scripts', 'gen_cognition.mjs'));
    const sections = cog.computeSections(proj);
    assert.deepEqual(
      sections.map((s) => s.feature),
      ['A', 'B'],
      '枚举源必须是入参项目根（`<projectDir>/.agent-io/design/*.dsl.json`）',
    );
    // ★ 消融的对照面：仓库册的 feature 一个都不许混进来（零参闭包实现会读到它们）
    const repo = repoFeatures();
    assert.ok(repo.length > 0, `前提：仓库自己的册存在（否则这条消融判不出来）：${path.join(REPO, '.agent-io', 'design')}`);
    for (const f of repo) {
      assert.ok(!sections.some((s) => s.feature === f), `不许把 cwd 侧（仓库）的 feature「${f}」算进来`);
    }
    // ★ rev 也必须读**入参项目**的 design/<f>.dsl.json（同一个 dataDir 入参）
    assert.deepEqual(sections.map((s) => s.rev), [7, 7], 'dslRev 必须读入参项目的册');
  } finally {
    cleanup(proj);
  }
});

test('② 导入生成器没有顶层写盘副作用（cwd 侧 COGNITION.txt 不新增）', async () => {
  // ★ 夹具里**故意不建 .agent-io/**：改前的顶层分支会在导入时用 cwd 的册重算并写盘
  //   （没有册 ⇒ 直接抛 ⇒ import 失败）⇒ 这条用例同时挡住"导入即写盘"与"导入即崩"。
  const proj = mkProject({});
  const prevCwd = process.cwd();
  try {
    copyGenerator(proj);
    process.chdir(proj);
    const cog = await importGenerator(path.join(proj, 'scripts', 'gen_cognition.mjs'));
    assert.equal(typeof cog.computeSections, 'function', '导入仍拿到 computeSections（cascade 要用）');
    assert.equal(typeof cog.renderCognition, 'function', '导入仍拿到 renderCognition（cascade 要用）');
    assert.ok(!fs.existsSync(path.join(proj, '.agent-io', 'COGNITION.txt')), '导入不许写盘（cwd 侧 COGNITION.txt 不新增）');
    assert.ok(!fs.existsSync(path.join(proj, '.agent-io')), '导入连 .agent-io 目录都不许建');
    // ★ 空根 / 非目录 ⇒ **响亮抛错**，不许回落 cwd 猜册
    assert.throws(() => cog.computeSections(''), /项目根/, '空串必须是响亮错误，不是"那就用 cwd"');
    assert.throws(() => cog.computeSections(path.join(proj, 'nope')), /项目根/, '非目录同理（判不了 ≠ 没有）');
  } finally {
    process.chdir(prevCwd);
    cleanup(proj);
  }
});

test('③ runCascade(夹具root) 写出的 COGNITION.txt 只含夹具的 feature 段（digest 失败要响亮）', async () => {
  const proj = mkProject({});
  try {
    mkSheet(proj, ['A', 'B']);
    copyGenerator(proj);
    const r = await runCascade(proj, 'A', []);
    assert.ok(
      r.ran.includes('cognition'),
      `cognition 应当跑过（实际 ran=${JSON.stringify(r.ran)} skipped=${JSON.stringify(r.skipped)} errors=${JSON.stringify(r.errors)}）`,
    );
    const file = path.join(proj, '.agent-io', 'COGNITION.txt');
    assert.ok(fs.existsSync(file), '夹具 root 下必须写出 COGNITION.txt');
    const text = fs.readFileSync(file, 'utf8');
    const features = [...text.matchAll(/^===feature (\S+)===/gm)].map((m) => m[1]);
    assert.deepEqual(features, ['A', 'B'], '只许含夹具 root 的 feature 段（cwd 侧仓库册的 feature 一个都不许进来）');
    // ★ 夹具里没有 dist CLI ⇒ digest 取不到 ⇒ 文件内必须有 ⚠ 段（"取不到"与"没内容"必须可分）
    assert.match(text, /⚠ 生成失败（不静默）/, 'digest 取不到时必须在文件里响亮，不许静默当成"没内容"');
  } finally {
    cleanup(proj);
  }
});

test('④ runCascade("") ⇒ cognition 进 skipped 带原因，且不落 cwd', async () => {
  // ★ 夹具做成**一个完整的项目**（册 + 生成器）：改前 root='' ⇒ `path.join('')` 落到 cwd ⇒
  //   这里会真的被写出 `./.agent-io/COGNITION.txt`（拿 cwd 的册）。现在必须只剩 skipped。
  const watch = mkProject({});
  const prevCwd = process.cwd();
  try {
    mkSheet(watch, ['W']);
    copyGenerator(watch);
    // ★ 空 root 的遥测会 `path.resolve('')` = cwd ⇒ 把 cwd 挪到临时目录，别把真数据仓的
    //   `.agent-io/observe/events.jsonl` 写脏（eventsPath 在 emitTelemetry 里**同步**算好）。
    process.chdir(watch);
    const r = await runCascade('', 'A', []);
    const hit = r.skipped.find((s) => s.startsWith('cognition'));
    assert.ok(hit, `空 root 必须进 skipped（实际 ran=${JSON.stringify(r.ran)} skipped=${JSON.stringify(r.skipped)}）`);
    assert.match(hit, /root 为空/, `skip 必须写明原因（实际：${hit}）`);
    assert.ok(!r.ran.includes('cognition'), '空 root 不许悄悄拿 cwd 的册跑 cognition');
    assert.ok(
      !fs.existsSync(path.join(watch, '.agent-io', 'COGNITION.txt')),
      'root 为空 ⇒ 不许 `path.join("")` 落 cwd 写 COGNITION.txt',
    );
  } finally {
    process.chdir(prevCwd);
    cleanup(watch);
  }
});
