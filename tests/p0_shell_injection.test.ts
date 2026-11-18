/**
 * P0 命令注入守卫（CWE-78 · command injection via shell interpolation）
 *
 * 缺陷形态（2026-11-05 外部评审 + 本轮按能力清点，全仓 6 个注入面 / 11 个调用点）：
 *   把**不可信输入**（MCP 工具入参 / 被分析仓库里的恶意文件名）**拼进 shell 命令行** ——
 *   `execSync(\`git diff --name-only ${ref}\`)` / `quoteForShell(filter)` + `shell: true` /
 *   `shq()` + `shell: true` / `exec(\`explorer /select,"${abs}"\`)`。
 *   ★ 三种"引号器"（`quoteForShell` / `shq` / `JSON.stringify`）是**同一能力的无名实现**，
 *     而引号在本病上**从来不是解法**：POSIX 双引号内 `$(...)` 与反引号照旧命令替换。
 *
 * 修法（唯一站得住的那一种）：**argv 数组 + 不经 shell**（`execFileSync(cmd, argv)` / `spawnSync(cmd, argv, {shell:false})`）。
 *   ⇒ 元字符没有解释器可解释，它只是字符。
 *   ★ 反向边界：**不是**"一律禁掉子进程" —— `git` / `npm` 本身必须调；
 *     判据是**参数不经 shell 解释**，不是"没有子进程"（CI-0 专门钉这条）。
 *
 * 三条判据（0.14 双向 + 0.25 鉴别力，缺一不算）：
 *   CI-A 注入串**必不执行**：每个入口喂 POSIX / Windows 两套元字符 ⇒ 断言 ① 返回值里没有 PWNED
 *        ② 哨兵文件没被创建。★ 含一条**不经任何白名单**的（`run_tests` 的 filter —— 它的合法性无法枚举）。
 *   CI-B **正常输入仍工作**：`HEAD` / `HEAD~3` / 合法 ref / 合法 filter / 中文+空格文件名。
 *   CI-C **消融**：同一串喂给"改前的形态"（拼命令行 + shell）⇒ 哨兵**必须**真的产生。
 *        ⇒ 证明 CI-A 的绿不是"这些串本来就是死的"。
 *
 * ★ Windows / POSIX 覆盖度（0.22：判合法/非法要实测，不许只推理）：
 *   · Windows（本机实测）：`&` / `&&` / `|` 三个元字符 + 打破双引号的形态，逐入口真跑；
 *   · POSIX（本机有 bash 时**真跑**；没有则显式 skip 并写明"未实测"）：`;` / `$()` / 反引号 / `|` / `&&`，
 *     先走 `bash -c` 证明"在 shell 下它们真的会执行"，再走 argv 证明"不经 shell 就不执行"；
 *   · 结论：**两套都是实测**，不是推演（bash 缺席时该条如实 skip，绝不当绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitCommitFiles, gitCommitAll, gitRestoreFiles, gitStatus } from '../src/infrastructure/git.js';
import { detectDrift } from '../src/application/design/intent/detect_drift.js';
import { runTests } from '../src/application/observe/runtime/run_tests.js';
import { commandAvailable, resolveNoShell } from '../src/infrastructure/exec_guard.js';
import { DESIGN_TOOLS } from '../src/application/design/index.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

/** 哨兵文件名（每个用例一个临时目录，互不干扰） */
const SENTINEL = 'PWNED.txt';

function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agentio-p0-inj-${tag}-`));
}

/**
 * Windows 元字符形态：`&` / `&&` / `|` 会被 cmd.exe 当成命令分隔；
 * 末条是「打破双引号」（`x"; echo …"`）—— 这正是"只加双引号"挡不住的形态。
 */
function winPayloads(sentinel: string): string[] {
  return [
    `x & echo PWNED > ${sentinel}`,
    `x && echo PWNED > ${sentinel}`,
    `x | echo PWNED > ${sentinel}`,
    `x"; echo PWNED > ${sentinel}; "`,
  ];
}

/** POSIX 元字符形态：`;` / `$()` / 反引号 / `|` / `&&`（双引号内 `$()` 与反引号照旧命令替换） */
function posixPayloads(sentinel: string): string[] {
  return [
    `x; echo PWNED > ${sentinel}`,
    `x$(echo PWNED > ${sentinel})`,
    'x`echo PWNED`',
    `x | echo PWNED > ${sentinel}`,
    `x && echo PWNED > ${sentinel}`,
  ];
}

/** 两套都喂（POSIX 形态在 Windows 上无害，跑一遍不亏；反过来也一样） */
function payloadsFor(sentinel: string): string[] {
  return [...winPayloads(sentinel), ...posixPayloads(sentinel)];
}

/**
 * 「真被执行了」的两条证据：
 *   ① 哨兵文件被创建；
 *   ② 输出里出现**单独一行**的 `PWNED`（= `echo PWNED` 的产物）。
 * ★ 为什么不能直接搜 "PWNED" 子串：注入串本身就是一个参数（文件名 / filter / ref），
 *   git / npm 会把参数**原文回显**在报错里 —— 那是“参数到了”的证据，恰恰不是“被执行”的证据。
 *   把它当执行证据会造出**永远红**的假红（本条就是撞出来的：首轮 3 条 CI-A 全因此误红）。
 */
const EXEC_MARKER = /(^|\n)[ \t]*PWNED[ \t]*(\r?\n|$)/;

/** 断言「这一串没被执行」：哨兵不存在 ∧ 输出里没有执行产物（单独一行的 PWNED） */
function assertNotExecuted(sentinel: string, ...observed: unknown[]): void {
  assert.equal(fs.existsSync(sentinel), false, `注入被执行了：哨兵文件被创建 → ${sentinel}`);
  for (const o of observed) {
    const s = String(o ?? '');
    assert.equal(EXEC_MARKER.test(s), false, `注入被执行了：输出里出现单独一行的 PWNED → ${s.slice(0, 300)}`);
  }
}

function writeSheet(home: string, feature: string, sourceRoot: string): void {
  const dsl = {
    feature,
    title: feature,
    source_root: sourceRoot,
    geometry: { nodes: [{ id: 'n1', label: 'n', type: 'service', x: 0, y: 0 }], edges: [] },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

/** 本机有没有可用的 POSIX sh（Windows 上通常没有；有 bash 才算"能实测 POSIX"） */
function posixShell(): string | null {
  for (const sh of ['bash', 'sh']) {
    try {
      const r = spawnSync(sh, ['-c', 'echo ok'], { encoding: 'utf8', timeout: 10_000 });
      // ★ 解码要宽容 WSL bash：它的本地化告警是 UTF-16 输出，按 utf8 解出来是 `b\0a\0s\0h\0…`
      const got = String(r.stdout ?? '').replace(/\u0000/g, '');
      if (r.status === 0 && got.includes('ok')) return sh;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

/** Windows 路径 → WSL 视角路径（只在 posixShell 命中 bash 时用） */
function toPosixPath(p: string): string {
  if (process.platform !== 'win32') return p;
  const m = /^([A-Za-z]):(.*)$/.exec(p);
  return m ? `/mnt/${m[1].toLowerCase()}${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
}

/* ════════════════════════════════════════════════════════════════════════
 * CI-0 · 反向边界：本卡**没有**把子进程禁掉 —— git / npm 仍要能调
 * ════════════════════════════════════════════════════════════════════════ */

test('CI-0 · 反向边界：修法是「参数不经 shell」，不是「不许起子进程」—— git / npm 仍然可调', () => {
  assert.equal(commandAvailable('git'), true, 'git 必须仍被判为可用（否则 CLI 全线降级）');
  const npm = resolveNoShell('npm');
  assert.ok(npm, 'resolveNoShell("npm") 必须解得出（否则 run_tests 无法在无 shell 下跑测试）');
  assert.equal(typeof npm.file, 'string');
  assert.ok(Array.isArray(npm.prefixArgs));
});

/* ═══════════════════════════════════════════════════════════════════════
 * CI-A · 注入串必不执行（逐入口 × 两套元字符）
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * ★ card-git-guard：tmpDir **必须先 git init** —— 否则 gitCommit* 的 cwd 向上走查
 *   会把提交/暂存落进祖先仓（三次实测污染真仓 HEAD 的根因；现在 git.ts 有仓根守卫会
 *   显式拒绝，测试自己 init 才能测到注入串本身）。
 */
function initRepo(dir: string): void {
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'p0@example.invalid'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'p0'], { cwd: dir, encoding: 'utf8' });
}

test('CI-A1 · git.ts：恶意**文件名**（gitCommitFiles / gitRestoreFiles）不执行', () => {
  const dir = tmpDir('gitfiles');
  const sentinel = path.join(dir, SENTINEL);
  try {
    initRepo(dir);
    for (const p of payloadsFor(sentinel)) {
      const a = gitCommitFiles(dir, [p], 'p0 注入探针');
      assertNotExecuted(sentinel, a.out);
      const b = gitRestoreFiles(dir, [p]);
      assertNotExecuted(sentinel, b.out);
    }
  } finally {
    rmRf(dir);
  }
});

test('CI-A2 · git.ts：恶意**提交信息**（gitCommitAll）不执行', () => {
  const dir = tmpDir('gitmsg');
  const sentinel = path.join(dir, SENTINEL);
  try {
    initRepo(dir);
    // 让 commit 真有东西可提交（否则 -m 根本不会被 git 吃到，测不到提交信息面）
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed', 'utf-8');
    for (const p of payloadsFor(sentinel)) {
      const r = gitCommitAll(dir, p);
      assertNotExecuted(sentinel, r.out);
    }
  } finally {
    rmRf(dir);
  }
});

test('CI-A6 · card-git-guard 仓根守卫：真仓内的**子目录**必须拒绝（防祖先仓污染）', () => {
  const dir = tmpDir('guard');
  try {
    initRepo(dir);
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed', 'utf-8');
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    // dir 仓库基线提交一次，用来对照「守卫拒绝后没有新增提交」
    const base = gitCommitAll(dir, 'baseline');
    assert.equal(base.committed, true, `基线提交必须成功（dir=仓库根是合法用法）：${base.out}`);
    // 子目录没有自己的 .git ⇒ gitCommitAll(sub) 必须被守卫软拒绝（旧行为：向上走查污染 dir 仓库）
    const r = gitCommitAll(sub, 'x & echo PWNED > sentinel');
    assert.equal(r.committed, false, '守卫必须拒绝非仓库根的 dir（否则 add -A 会打到祖先仓——三次实测污染真仓 HEAD）');
    assert.match(r.out, /不是仓库根/, `拒绝原因必须点名「不是仓库根」：${r.out.slice(0, 200)}`);
    // 守卫拒绝后，真仓（dir）不得新增任何提交
    const count = spawnSync('git', ['rev-list', '--all', '--count'], { cwd: dir, encoding: 'utf8' });
    assert.equal(String(count.stdout).trim(), '1', '守卫拒绝后祖先仓不得新增提交');
  } finally {
    rmRf(dir);
  }
});

test('CI-A3 · detect_drift：MCP 入参 since_ref 的注入串不执行（且该分支真的走到了）', async () => {
  const home = makeTempHome();
  const project = tmpDir('drift');
  const sentinel = path.join(project, SENTINEL);
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0inj', project);
    let reachedChanged = false;
    for (const p of payloadsFor(sentinel)) {
      const r = await detectDrift({ feature: 'p0inj', code_dir: project, scope: 'changed', since_ref: p });
      // ★ 不是"没执行就够"：还要证明**这条分支真的被走到过**（否则绿是空的）
      if (r.scope.mode === 'changed') reachedChanged = true;
      assertNotExecuted(sentinel, r.message);
    }
    assert.equal(reachedChanged, true, 'scope=changed 分支必须真的执行过 —— 否则这条判据是空绿');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('CI-A4 · run_tests：filter 的注入串不执行 —— ★ 该入口没有任何白名单，安全性必须只来自 argv', () => {
  const project = tmpDir('runtests');
  const sentinel = path.join(project, SENTINEL);
  try {
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'p0-inj-probe', version: '1.0.0', private: true, scripts: { test: 'node -p 1' } }, null, 1),
      'utf-8',
    );
    for (const p of payloadsFor(sentinel)) {
      const r = runTests({ project_dir: project, filter: p, timeoutMs: 60_000 });
      // filter 的合法性**无法枚举**（测试过滤串可以是任意文本）⇒ 这里没有、也不该有白名单；
      // 安全只来自「filter 作为一个 argv 元素交给 npm」（npm 自身还会再转义一次，那是第二重，不是本卡的依据）。
      assertNotExecuted(sentinel, r.stdoutTail, r.stderrTail, r.error);
      assert.equal(r.ok, true, `run_tests 必须仍然跑起来（不能为了安全把功能改坏）：${r.error ?? ''}`);
    }
  } finally {
    rmRf(project);
  }
});

test('CI-A5 · since_ref 的 zod 白名单（纵深防御第二道）：拒注入串、拒参数注入、放行合法 ref', () => {
  const def = DESIGN_TOOLS.find((t) => t.name === 'design_line');
  assert.ok(def, '必须能取到 design_line 的工具声明');
  // inputSchema 在本仓是「zod 字段表」对象（不是 z.object ⇒ 没有 .shape）；两种形态都认
  const schema = def.inputSchema as unknown as Record<string, unknown> & { shape?: Record<string, unknown> };
  const field = (schema['since_ref'] ?? (schema.shape ?? {})['since_ref']) as
    | { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } } }
    | undefined;
  assert.ok(field && typeof field.safeParse === 'function', 'design_line 的 inputSchema 里必须有可解析的 since_ref 字段');

  for (const ok of ['HEAD', 'HEAD~3', 'origin/main', 'v1.2.0', 'refs/heads/main', 'HEAD^']) {
    assert.equal(field.safeParse(ok).success, true, `合法 ref 被白名单拒了：${ok}`);
  }
  const bads = ['HEAD; echo PWNED', '$(id)', '`id`', 'HEAD | echo PWNED', 'HEAD && echo PWNED', 'a b', 'a&calc', '--output=/tmp/x'];
  for (const bad of bads) {
    const r = field.safeParse(bad);
    assert.equal(r.success, false, `白名单漏了这个：${bad}`);
    // 0.12④：拒绝必须可定位 —— 文案里要点名这个字段
    assert.match(r.error!.issues[0].message, /since_ref/, `拒绝文案必须点名字段（可定位）：${r.error!.issues[0].message}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * CI-B · 正常输入仍工作（不许把功能一起改坏）
 * ═══════════════════════════════════════════════════════════════════════ */

test('CI-B1 · git.ts 正常路径仍工作：带空格与中文的文件名能被 add + commit + checkout', () => {
  if (!commandAvailable('git')) {
    assert.ok(true, 'git 不可用 ⇒ 本条无法实测（如实跳过，不冒充绿）');
    return;
  }
  const dir = tmpDir('gitok');
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
    assert.equal(init.status, 0, `git init 失败：${init.stderr}`);
    spawnSync('git', ['config', 'user.email', 'p0@example.invalid'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'p0'], { cwd: dir, encoding: 'utf8' });
    const fname = '中文 文件名.txt';
    fs.writeFileSync(path.join(dir, fname), 'x', 'utf-8');
    const c = gitCommitFiles(dir, [fname], '提交：含空格与中文的文件名');
    assert.equal(c.committed, true, `正常提交必须成功（否则修法把功能改坏了）：${c.out}`);
    const back = gitRestoreFiles(dir, [fname]);
    assert.equal(back.ok, true, `正常 checkout 必须成功：${back.out}`);
    const st = gitStatus(dir);
    assert.ok(Array.isArray(st.modified) && Array.isArray(st.untracked));
  } finally {
    rmRf(dir);
  }
});

test('CI-B2 · detect_drift 正常 ref 仍工作：HEAD / HEAD~3 / 合法 ref 不改变作用域语义', async () => {
  const home = makeTempHome();
  const project = tmpDir('driftok');
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0inj', project);
    for (const ref of ['HEAD', 'HEAD~3', 'origin/main']) {
      const r = await detectDrift({ feature: 'p0inj', code_dir: project, scope: 'changed', since_ref: ref });
      assert.equal(r.scope.mode, 'changed', `正常 ref 不应改变作用域语义：${ref}`);
      assert.equal(r.scope.since_ref, ref);
    }
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('CI-B3 · run_tests 正常 filter 仍工作（中文 / 路径形态 / 带空格）', () => {
  const project = tmpDir('runtestsok');
  try {
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'p0-inj-ok', version: '1.0.0', private: true, scripts: { test: 'node -p 1' } }, null, 1),
      'utf-8',
    );
    for (const f of ['tests/p0_shell_injection.test.ts', '中文 过滤串', 'a b c']) {
      const r = runTests({ project_dir: project, filter: f, timeoutMs: 60_000 });
      assert.equal(r.ok, true, `正常 filter 必须能跑：${f} → ${r.error ?? ''}`);
      assert.equal(r.filter, f);
      assert.equal(r.success, true, `npm 侧应正常退出：${f}`);
    }
  } finally {
    rmRf(project);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
 * CI-C · 消融（鉴别力）：同一串喂给「改前的形态」⇒ 哨兵必须真的产生
 *   ★ 没有这一条，CI-A 的绿可以来自"串本来就是死的"
 * ═══════════════════════════════════════════════════════════════════════ */

test('CI-C1 · 消融（Windows 实测）：`x & echo PWNED > 哨兵` 走 cmd.exe 会执行、走 argv 不会', () => {
  if (process.platform !== 'win32') {
    assert.ok(true, '非 Windows ⇒ 本条不适用（POSIX 由 CI-C2 覆盖）');
    return;
  }
  const dir = tmpDir('ablate-win');
  const sentinel = path.join(dir, SENTINEL);
  const payload = `x & echo PWNED > ${sentinel}`;
  try {
    // 改前的形态：字符串拼命令行 + shell（execSync 恒经 shell）
    execSync(`git diff --name-only ${payload}`, { cwd: dir, stdio: 'ignore' });
    assert.equal(fs.existsSync(sentinel), true, '消融失败：这一串在 shell 下竟然没执行 ⇒ CI-A 的绿没有鉴别力');
    fs.rmSync(sentinel, { force: true });

    // 改后的形态：argv + 不经 shell（同一串只是"一个参数"）
    spawnSync('git', ['diff', '--name-only', payload], { cwd: dir, stdio: 'ignore', shell: false });
    assert.equal(fs.existsSync(sentinel), false, 'argv 形态竟然执行了注入');
  } finally {
    rmRf(dir);
  }
});

test('CI-C2 · 消融 + 实测（POSIX / bash）：`$()` 与反引号在 sh 下真的执行、走 argv 不会', () => {
  const sh = posixShell();
  const dir = tmpDir('ablate-posix');
  const sentinelHost = path.join(dir, SENTINEL);
  const sentinelSh = sh === 'bash' ? toPosixPath(sentinelHost) : sentinelHost;
  try {
    // ★ 本机没有可用 POSIX sh（Windows 上很常见）⇒ shell 侧**未实测**，如实打印、不当绿；
    //   argv 侧仍然实测（它不依赖任何 shell）。不用 t.skip：本仓测试门把 skip 判成红（不许用 skip 关掉门）。
    if (sh) {
      // ① shell 侧：$() 真的做命令替换
      let r = spawnSync(sh, ['-c', `echo HEAD$(echo PWNED > ${sentinelSh})`], { encoding: 'utf8' });
      assert.equal(r.status, 0, `sh 起不来：${r.stderr}`);
      assert.equal(fs.existsSync(sentinelHost), true, '$() 在 sh 下没执行 ⇒ 消融失败');
      fs.rmSync(sentinelHost, { force: true });

      // ② 反引号同族
      r = spawnSync(sh, ['-c', 'echo HEAD`echo PWNED`'], { encoding: 'utf8' });
      assert.equal(String(r.stdout).includes('PWNED'), true, '反引号在 sh 下没执行 ⇒ 消融失败');
    } else {
      console.log('[CI-C2] 本机无可用 POSIX sh（bash/sh 都起不来）⇒ shell 侧未实测；argv 侧照常实测');
    }

    // ③ argv 侧（正是修复后的形态）：同一串作为一个参数原样到达，绝不展开
    const probe = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
    const argvPayload = `HEAD$(echo PWNED > ${sentinelSh})`;
    const argvRun = spawnSync(process.execPath, ['-e', probe, argvPayload], { encoding: 'utf8', shell: false });
    assert.equal(argvRun.status, 0);
    assert.deepEqual(JSON.parse(String(argvRun.stdout)), [argvPayload], '参数必须原样到达子进程（没有解释器去展开它）');
    assert.equal(fs.existsSync(sentinelHost), false, 'argv 形态竟然执行了注入');
  } finally {
    rmRf(dir);
  }
});
