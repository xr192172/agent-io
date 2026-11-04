/**
 * P0 · 两道门各自的**假绿**（第五轮独立复核用 %TEMP% 副本实测出来的两条，都发生在当天新加/新改的门上）。
 *
 *   ① `scripts/judge-all.mjs`：把 `src` 弄得比 `dist` 新 ⇒ 整轮判据**判在旧代码上**，
 *      却 exit 0 且零提示（`staleJudgeCaveat` 只在 `unsupported > 0` 时出声 ⇒ "整轮 pass"时根本不取）。
 *   ② `scripts/run-tests.mjs`：把某个 `tests/*.test.ts` **清空内容**（文件在、用例没了）⇒
 *      runner 报「用例 1/1 通过」⇒ 门绿（`tests > 0` 这条守卫被"文件自身算一个用例"骗过）。
 *
 * ★ 两条证都**只造临时目录夹具**：绝不动仓里的 `tests/`、`src/`、`dist/` ——
 *   它们断言的是"**失败**与**真的没有/真的跑过**落在不同的读数上"（AGENTS-RULES 0.12），
 *   而不是"某句文案好看"。
 * ★ 每条都跑**两态**：造出病灶 ⇒ 红；把病灶去掉 ⇒ 另一支读数（证明不是无条件喊狼来了）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const JUDGE_ALL = path.resolve('scripts/judge-all.mjs');
const RUN_TESTS = path.resolve('scripts/run-tests.mjs');

/**
 * 跑一个脚本，回 `{status, out}`（out = stdout+stderr 合并）。
 *
 * ★ 必须摘掉 `NODE_TEST_CONTEXT`：本证自己就跑在 `node --test` 里，那个变量会被子进程继承
 *   ⇒ 子进程的 `node --test` 认为这是**嵌套 run**、直接「skipping running files」
 *   （实测：不摘掉时被 spawn 的 `run-tests` 每个文件都「计数缺失」⇒ 测出来的是噪音，不是被检查的门）。
 */
function run(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): { status: number | null; out: string } {
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...base, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 断言失败时报文只截尾部（judge-all / run-tests 全文可能有上千行） */
const tail = (s: string, n = 1600): string => (s.length <= n ? s : `…（截断，仅尾部）\n${s.slice(-n)}`);

// ════════════════════════════════════════════════════════════════════
// ① judge-all：dist 比 src 旧 ⇒ exit 非 0 且点名 stale
//    （改前：整轮判在旧 dist 上，exit 0、零提示）
// ════════════════════════════════════════════════════════════════════
test('① judge-all：dist 比 src 旧 ⇒ exit 非 0 且报文含「dist 比 src 旧」（改前 exit 0 = 判在旧代码上还全绿）', () => {
  const root = makeTempHome();
  try {
    // ── 夹具与真仓同形：dist 里有 CLI、.agent-io/design 里有册（否则走不到"跑判据"那一步）
    const cliDir = path.join(root, 'dist', 'src', 'presentation', 'cli');
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, 'cli.js'), '// 假 CLI：本证只关心"跑判据之前"那道 dist 新鲜度判定\n', 'utf8');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, '.agent-io', 'design'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agent-io', 'design', 'fake-book.dsl.json'), JSON.stringify({ feature: 'fake-book' }, null, 2), 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'foo.ts'), 'export const a = 1;\n', 'utf8');
    fs.writeFileSync(path.join(root, 'dist', 'src', 'foo.js'), 'export const a = 1;\n', 'utf8');

    // ── 钉死 mtime（0.12 ②：输入不许是环境态）—— 产物比源旧 60 秒
    const tBase = Date.now() - 600_000;
    const src = path.join(root, 'src', 'foo.ts');
    const out = path.join(root, 'dist', 'src', 'foo.js');
    fs.utimesSync(src, new Date(tBase + 60_000), new Date(tBase + 60_000));
    fs.utimesSync(out, new Date(tBase), new Date(tBase));

    // ★ 数据根指进临时目录（否则假册的 CLI 会读真数据仓）
    const env = { AGENT_IO_HOME: path.join(root, 'home') };

    // ── 态 A：dist 比 src 旧 ⇒ 红
    const a = run(JUDGE_ALL, [], root, env);
    assert.notEqual(a.status, 0, `dist 比 src 旧时必须非零退出（改前是 0 = 整轮判在旧 dist 上还全绿）\n--- 输出 ---\n${tail(a.out)}`);
    assert.match(a.out, /dist 比 src 旧/, `报文必须点名"dist 比 src 旧"（读者要能区分"判据真过"与"跑在旧代码上"）：\n${tail(a.out)}`);
    assert.match(a.out, /先 npm run build/, '报文必须给出动作（先 npm run build）：\n' + tail(a.out));
    assert.match(a.out, /src\/foo\.ts|src\\foo\.ts/, `要点出是哪个源比产物新：\n${tail(a.out)}`);
    // ★ 关键：不许"喊一句警告然后照旧判完还 exit 0" —— 它必须停在这里（一条判据都没跑）
    assert.doesNotMatch(a.out, /判据 \d+ 条判过/, `stale 时不许继续判（那正是"判在旧代码上"）：\n${tail(a.out)}`);

    // ── 态 B：把产物推到源之后 ⇒ 不再提 stale（证明判据不是无条件喊狼来了）
    const future = new Date(Date.now() + 600_000);
    fs.utimesSync(out, future, future);
    const b = run(JUDGE_ALL, [], root, env);
    assert.doesNotMatch(b.out, /dist 比 src 旧/, `产物比源新时不许再报 stale（否则这条判定无信息量）：\n${tail(b.out)}`);
    // 而且它真的往下跑了（假 CLI 的 DATA 块必然解析不出 ⇒ pass=0 且该册判红；这正是"往下跑"的证据）
    assert.match(b.out, /pass=0/, `产物新鲜时应当继续判据（假 CLI 无 DATA 块 ⇒ pass=0）：\n${tail(b.out)}`);
  } finally {
    rmRf(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② run-tests：空 .test.ts（文件在、用例没了）⇒ exit 非 0 且点名该文件
//    （改前：runner 报「用例 1/1 通过」⇒ 门绿）
// ════════════════════════════════════════════════════════════════════
test('② run-tests：空 .test.ts ⇒ exit 非 0 且点名该文件（改前报「用例 1/1 通过」= 假绿）', () => {
  // ★★ 夹具落在 `.agent-io/gate-fixture-*`（该目录被 `.gitignore` 的 `.agent-io/*` 忽略 ⇒ 不脏工作区）：
  //   必须**在仓内**，因为 run-tests 用 `--import tsx` 起子进程，而 `tsx` 要靠 `node_modules` 逐级上溯解析
  //   （放在系统 temp 里 ⇒ 解析不到 ⇒ 每个文件「计数缺失」，测出来的是环境噪音而不是被检查的那道门）。
  const root = path.resolve('.agent-io', `gate-fixture-${process.pid}-${Date.now()}`);
  try {
    // ★★ 跑法：把**真脚本原样拷进临时根**（`<tmp>/scripts/run-tests.mjs`）——
    //   它用 `import.meta.url` 定 ROOT ⇒ 于是它扫的是 `<tmp>/tests/`，**仓里的 tests/ 一个字节不碰**。
    //   ★ 为什么不是 `--dir=`：这道门不该为测试新增入口（那也是改判定面）；拷脚本是等价且更小的作用面。
    //   ★ 也正因为 `<tmp>/tests/` 里只有下面两个假文件，**不会递归跑到本文件自己**（实测踩过：
    //     让内层 run-tests 扫真 tests/ ⇒ 它跑到本文件 ⇒ 又 spawn 内层 ⇒ 无限递归）。
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    const script = path.join(root, 'scripts', 'run-tests.mjs');
    fs.copyFileSync(RUN_TESTS, script);

    // 病 1：文件在、用例没了（0 字节）
    fs.writeFileSync(path.join(root, 'tests', 'empty.test.ts'), '', 'utf8');
    // 病 2：用例被**注释掉**（"数 test(" 若不做剥注释，这一支会被骗过去）
    fs.writeFileSync(
      path.join(root, 'tests', 'commented.test.ts'),
      "// test('x', () => {});\n/*\nit('y', () => {});\n*/\n",
      'utf8',
    );

    const r = run(script, [], root);

    assert.notEqual(r.status, 0, `空测试文件必须判红（改前 runner 报「用例 1/1 通过」⇒ exit 0）\n--- 输出 ---\n${tail(r.out)}`);
    assert.match(r.out, /empty\.test\.ts/, `必须点名那个文件：\n${tail(r.out)}`);
    assert.match(r.out, /没有任何 test\(\)\/it\(\) 调用/, `必须说清红在哪（文件在、用例没了）：\n${tail(r.out)}`);
    // ★ 注释掉的那一支同样要抓（否则"剥注释"就是假的）
    assert.match(r.out, /commented\.test\.ts/, `注释掉的 test(/it( 不算用例，该文件也要点名：\n${tail(r.out)}`);
    assert.doesNotMatch(r.out, /测试门绿/, `有文件 0 用例时不许打"测试门绿"：\n${tail(r.out)}`);
  } finally {
    rmRf(root);
  }
});

test('凭证类守卫没被删：clean_dist 拒伪造 + AGENTS.md 规则不许被删空（结构性断言）', () => {
  // ★ 2026-10-31（第十二轮复核 R1 的补充）：R1 的实质是"dist 新鲜度凭证没有任何判据守着"。
  //   行为级测试要改真 src 才能造出"源漂移"，成本高且污染工作区 ⇒ 这里守**守卫本身还在**：
  //   删掉守卫 ⇒ 本用例红。（这是结构性断言，如实标注，不冒充行为断言。）
  const REPO = process.cwd();
  const clean = fs.readFileSync(path.join(REPO, 'scripts', 'clean_dist.mjs'), 'utf8');
  assert.match(clean, /--from-build/, 'clean_dist 丢了 --from-build 门');
  assert.match(clean, /拒绝补发构建清单/, 'clean_dist 丢了"拒伪造"守卫（源漂移 + 产物旧 ⇒ 不许补发凭证）');
  assert.match(clean, /不写构建清单/, 'clean_dist 丢了"单独跑不写清单"的拒绝');

  // ② 规则文件本身的守卫（★ 2026-11-04：主体从「生成器」迁到「产物」）
  //    迁移来源 = 设计册 agent-io 节点 file_scripts_gen_agents_mjs 原有的 3 条判据（生成器退役时逐条处置）：
  //      ① source-has gen_agents.mjs must:[readRules, AGENTS-RULES.md] —— 断言的是「生成器会读规则并注入」
  //         ⇒ **随能力一起退役**（不可迁移：主体已不存在），代价记 docs/RETIRED.md
  //      ② source-has AGENTS-RULES.md must:[必须全量重生成设计 DB, npm run design:gen-db]
  //         ⇒ **逐字迁到本守卫**（0.2 第 3 条必须写「全量」）
  //      ③ call-exists gen_agents.mjs#buildAgents → readRules —— 生成器内部调用边 ⇒ 随能力退役
  //    ★ 为什么要搬到测试：原来那条守卫（body.length < 1500 就抛）保护的是**生成器**；
  //      生成器退役后产物自己成了唯一住处，守卫必须换主体，否则「规则被删空」重新变成没人看着的态。
  const agents = fs.readFileSync(path.join(REPO, 'AGENTS.md'), 'utf8');
  // ②-1 0.2 第 3 条必须写成「全量」（原设计册判据 ② 的逐字迁移）
  assert.match(agents, /必须全量重生成设计 DB/, 'AGENTS.md 的 0.2 第 3 条丢了「必须全量」口径');
  assert.match(agents, /npm run design:gen-db/, 'AGENTS.md 的 0.2 第 3 条丢了可执行命令 npm run design:gen-db');
  // ②-2 规则本体不许被删空 / 截断：条数在 + 每条都得有可判内容（不是只剩标题）
  const ruleHeads = [...agents.matchAll(/^### (0\.\d+) /gm)].map((m) => m[1]);
  assert.ok(ruleHeads.length >= 28, `AGENTS.md 只剩 ${ruleHeads.length} 条规则（应 ≥28）⇒ 规则被删空或截断`);
  const bodies = agents.split(/^### 0\.\d+ /m).slice(1);
  const thin = bodies.filter((b) => b.split('\n').filter((l) => l.trim()).length < 4);
  assert.deepEqual(thin, [], `有 ${thin.length} 条规则只剩标题、没有可判内容（判据表 / 硬要求 / 可判条件）`);
  // ②-3 反回归：「动作 → 工具」表是 ToolDef.description 的第二份拷贝（0.9.1）⇒ 不许加回来
  assert.ok(!/^## 一、动作 → 工具/m.test(agents), 'AGENTS.md 又把「动作 → 工具」表加回来了（= ToolDef.description 的第二份拷贝）');
  assert.ok(!/^\| 开发动作 \|/m.test(agents), 'AGENTS.md 里又出现「开发动作 / 必用工具」表头');
});