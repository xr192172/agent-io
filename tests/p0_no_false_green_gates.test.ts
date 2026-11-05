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
import { pathToFileURL } from 'node:url';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const JUDGE_ALL = path.resolve('scripts/judge-all.mjs');
const RUN_TESTS = path.resolve('scripts/run-tests.mjs');
/** ⑦ R39 用：MANIFEST 卷表的**唯一住处**是那个脚本自己 —— 本证真跑它，不在这里抄第二份卷表 */
const GEN_MANIFEST = path.resolve('scripts/gen_manifest.mjs');

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

/** `scripts/verify.mjs` 的模块面（只声明本文件用到的；★ `READOUT_ANCHORS` 必须导出，消融才改得到**真表**） */
type VerifyModule = {
  gateReading: (
    root: string,
    idx: number,
    name: string,
    state: string,
    out: string,
  ) => {
    text: string;
    cases: { unit: string; pass: number; total: number; source: string } | null;
    logRel: string | null;
    failures: string[];
    lines: number;
  };
  failureLines: (out: string) => string[];
  GATE_LOG_REL: string;
  READOUT_ANCHORS: Array<{ gate: string; unit?: string; anchor: RegExp; pass?: number; total: number; fail?: number }>;
};

/**
 * 动态 import `scripts/verify.mjs`（计算出来的 URL）：它顶层有 `process.argv` 守卫 ⇒ 被 import 时只导出、不跑门。
 * ★ 必须**同一份模块实例**被 ④⑤⑥ 共用：① 少 import 三次；② ⑥ 的消融改的是这条实例上的 `READOUT_ANCHORS`。
 */
async function loadVerify(): Promise<VerifyModule> {
  return (await import(pathToFileURL(path.join(process.cwd(), 'scripts', 'verify.mjs')).href)) as VerifyModule;
}

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
    // ★★ 2026-11-05：脚本现在 `import { collectTestFiles } from './lib/test_files.mjs'`
    //   （测试清单收集的唯一实现，与 `verify-changed.mjs` 共用 —— 0.9.1）。
    //   ⇒ 拷脚本时必须**连它依赖的 lib/ 一起拷**，否则临时根里模块解析失败、脚本一加载就崩，
    //     本测试就会看到"输出为空"而误判成缺陷没修好（实测：本行就是被这个新依赖弄红的那一条）。
    //   ★ 判据：拷过去的是**真文件**，不是一个桩 —— 桩会让本测试验的东西与真脚本脱钩。
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.resolve('scripts/lib/test_files.mjs'), path.join(root, 'scripts', 'lib', 'test_files.mjs'));

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
// ════════════════════════════════════════════════════════════════════
// ③ R21：**失败门的完整输出必须落盘**（门红时要能定位到哪条红）
//   改前：每道门的输出被硬截断到 4000 字符 ⇒ 只看到「N 道门失败：<门名>」这种摘要，
//   看不到是哪条（0.12 第 4 条的直接违例：**给明细的那道门，自己把明细切了**）。
//   本证三向（缺一不算）：
//     ① 落盘**不截断**：超过 4000 字符的原文逐字节在位；
//     ② 摘要行带「失败 N 条」+ 日志路径，且从该路径能读到**第一条失败的原文**；
//     ③ 反向（0.16 / 0.9.4 第 1 行）：门绿时**不许**出现失败计数；识别不出失败行时**不许报 0**
//        —— 「0 条失败」与「没解析出来」必须是两个不同的值。
// ════════════════════════════════════════════════════════════════════

/**
 * R21 夹具：造一段**必然超过 4000 字符**的门输出，且第一条失败行落在 4000 字符之后。
 * ★ 为什么必须跨过 4000：R21 的病正是「印前 4000 字符」—— 夹具不跨过它，就测不出截断（0.25① 要有鉴别力）。
 */
function r21LongGateOutput(): string {
  const filler = Array.from({ length: 120 }, (_, i) => `    填充行 ${i}：${'x'.repeat(60)}`);
  return [
    '测试门 —— tests/*.test.ts 真跑',
    ...filler,
    '  FAIL  p0_change_set_truth.test.ts                  812ms  用例 5/7',
    '  not ok 42 - 设计册判据 ⑤ p0_change_set_truth 的读集少了 symbols',
    '  ✗ 判据 #7 失败：读集少了 symbols',
  ].join('\n');
}

test('③ R21：失败门完整输出落盘 + 摘要行带失败计数与日志路径（门绿时不许出现失败计数）', async () => {
  const root = makeTempHome();
  try {
    // ★ 动态 import（见 loadVerify）：verify.mjs 顶层有 `process.argv` 守卫 ⇒ 被 import 时不跑门
    const v = await loadVerify();

    // ── ① 摘要行 + 落盘（不截断）──
    const out = r21LongGateOutput();
    assert.ok(out.length > 4000, `夹具必须超过 4000 字符（现状 ${out.length}）—— 否则测不出截断`);
    const r = v.gateReading(root, 7, '设计册判据', 'FAIL', out);
    // ★ 夹具里有 3 条失败行：`FAIL  <文件>` / `not ok 42` / `✗ 判据 #7` —— 三种标记都要被数到
    //   （少数一种 = 计数不诚实；这正是 0.12③ "统计型输出必须带分母" 的反面）
    assert.match(r.text, /失败 3 条/, `摘要行必须带失败计数，实得：${r.text}`);
    assert.ok(r.logRel, '失败门必须落盘（logRel 为空 = 没有完整输出可读）');
    assert.ok(
      String(r.logRel).startsWith('verify-last') || String(r.logRel).includes('/verify-last/'),
      `日志必须落在 verify-last 目录下，实得：${r.logRel}`,
    );
    assert.ok(String(r.logRel).endsWith('07-设计册判据.log'), `日志名要点名门序号与门名，实得：${r.logRel}`);
    const logged = fs.readFileSync(path.join(root, String(r.logRel)), 'utf8');
    assert.equal(logged, out, '完整输出必须**原样**落盘（"印前 4000 字符"正是 R21 的病）');
    // ★ 从**日志路径**能读到第一条失败的**原文**（夹具里第一条失败行是 `FAIL  <文件>`，它在第 4000 字符之后）
    const fails = v.failureLines(logged);
    assert.match(fails[0], /FAIL\s+p0_change_set_truth\.test\.ts/, `从日志必须能读到第一条失败的原文，实得：${fails[0]}`);
    assert.ok(logged.includes('not ok 42'), '第二条失败（not ok）也必须在位 —— 截断过就会丢');

    // ── ③ 反向一：门绿 ⇒ 不许出现失败计数，且要通过门的 `用例 N/M` ──
    const okReading = v.gateReading(root, 10, '测试', 'PASS', '测试门：文件 82 / 用例 627（源码声明 627）/ 通过 627 / 失败 0 / 跳过 0');
    assert.equal(okReading.logRel, null, '通过的门不落盘（没有明细可给）');
    assert.match(okReading.text, /用例 627\/627/, `通过的门必须保留「用例 N/M」，实得：${okReading.text}`);
    assert.ok(!/失败/.test(okReading.text), `门绿时摘要行不许出现失败计数，实得：${okReading.text}`);

    // ── ③ 反向二：识别不出失败行 ⇒ **不许**报 0 条，且原文照样落盘 ──
    const opaque = v.gateReading(root, 5, '实现夹具', 'FAIL', 'some opaque failure text');
    assert.ok(!/失败 0 条/.test(opaque.text), '识别不出失败行时不许报「失败 0 条」（那是把"没解析出来"说成"没有失败"）');
    assert.match(opaque.text, /未从输出里识别出失败行/, '识别不出时必须如实说「没识别出」');
    assert.ok(opaque.logRel, '识别不出失败行**也要**落盘完整输出（否则原文永远找不回来）');
  } finally {
    rmRf(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④⑤⑥ R38：**通过腿的 `用例 N/M` 只许来自该门自己的【汇总行锚点】**
//   改前：`gateReading` 的通过腿对**整份输出**取第一处 `用例 N/M` ⇒ 测试门印「用例 6/6」，
//   而同一时刻真值是 422/422（本文件第一行的逐文件读数恰好是 6/6）。
//   ★ 比不印更坏：不印 ⇒ 人知道"没读到"；印 6/6 ⇒ 人以为"这门跑了 6 条、全过"。
//   三向（缺一不算检测点：0.25① 可执行 + 0.14 双向）：
//     ④ 正向：真跑 `scripts/run-tests.mjs` ⇒ 印的数必须与**它自己的汇总行逐字一致**（不写死 422）
//     ⑤ 反向：输出里有 `6/6` 但**没有**汇总行 ⇒ 必须「用例 未识别」且 `cases: null`
//     ⑥ 消融：把「测试」的锚点降回"全文首个 N/M" ⇒ ⑤ 立刻变回印 6/6（证明 ⑤ 是锚点判定的功劳）
// ════════════════════════════════════════════════════════════════════

/** 测试门的汇总行（该门唯一机器读的那一行；数字**从输出里现取**，不写死） */
const R38_SUMMARY_RE = /^测试门：文件 (\d+) \/ 用例 (\d+)（源码声明 \d+）\/ 通过 (\d+) \/ 失败 (\d+) \/ 跳过 (\d+)$/m;

/**
 * R38 反向夹具 = **R38 的真实现场**：测试门逐文件打印 `用例 N/M`，而门的读数是那行汇总。
 * ★ 这里**故意不含**汇总行 —— 带了汇总行就不是反例了（那是 ④ 的正例）。
 */
function r38PerFileOnlyOutput(): string {
  return [
    '测试门 —— tests/*.test.ts 真跑  （node:test + tsx；逐文件取 TAP 计数）',
    // ★ 真跑时这里有 82 行逐文件读数；夹具**只留第一行** —— 改前印出的 6/6 就出自它。
    //   只留一处 ⇒ "未识别"的唯一原因就是"锚点不在这里"，不会被"命中多处"那条纪律掩盖（诊断要能定位因）。
    '  PASS  budget/payload_budget.test.ts      22532ms  用例 6/6（源码 6）',
    '',
    '⇒ 测试门绿：82 个文件、422 个用例全部真跑过并通过',
  ].join('\n');
}

test('④ R38 正向：测试门印的 N/M 与该门自己汇总行**逐字一致**（真跑 run-tests，数字现取不写死）', async () => {
  // ★ 夹具落 `.agent-io/gate-fixture-*`（仓内 ⇒ `--import tsx` 能逐级上溯到 node_modules；且被 .gitignore 忽略）
  const root = path.resolve('.agent-io', `gate-fixture-r38-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.copyFileSync(RUN_TESTS, path.join(root, 'scripts', 'run-tests.mjs'));
    // ★★ 2026-11-05：脚本现在依赖 `./lib/test_files.mjs`（测试清单收集的唯一实现，与 verify-changed 共用 —— 0.9.1）
    //   ⇒ 拷脚本必须连依赖一起拷，否则临时根里模块解析失败、脚本一加载就崩 ⇒ 汇总行不打印 ⇒ 本证假红。
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.resolve('scripts/lib/test_files.mjs'), path.join(root, 'scripts', 'lib', 'test_files.mjs'));
    // 病根同形：**逐文件**行里会出现 `用例 2/2`、`用例 3/3`（≠ 汇总的 5）
    fs.writeFileSync(path.join(root, 'tests', 'a.test.ts'), "import { test } from 'node:test';\ntest('a1', () => {});\ntest('a2', () => {});\n", 'utf8');
    fs.writeFileSync(path.join(root, 'tests', 'b.test.ts'), "import { test } from 'node:test';\ntest('b1', () => {});\ntest('b2', () => {});\ntest('b3', () => {});\n", 'utf8');
    // ★ 规模棘轮要一份基线：不写 ⇒ 门按"基线缺失"红，而红之前汇总行已打出 ⇒ 那测的就不是"门绿时的读数"
    fs.writeFileSync(path.join(root, 'scripts', 'test-baseline.json'), JSON.stringify({ files: 2, cases: 5 }), 'utf8');

    const r = run(path.join(root, 'scripts', 'run-tests.mjs'), [], root);
    const sum = R38_SUMMARY_RE.exec(r.out);
    assert.ok(sum, `夹具必须打印汇总行\n${tail(r.out)}`);
    const total = sum[2]; // 用例 M
    const pass = sum[3]; // 通过 P
    // ★ 不断言 `r.status === 0`：夹具里没有真数据册 ⇒ 该门的**产者护栏**会把门判红（与本文件 ② 同一现象）。
    //   这里测的是**通过腿的读数**，而它在产者护栏那一段**之前**就已经打印 ⇒ 只要求"用例全过"这个读数为真。
    assert.equal(pass, total, `正例的用例必须真的全过（否则验的不是通过腿）\n${tail(r.out)}`);
    assert.equal(sum[4], '0', `正例的失败数必须是 0\n${tail(r.out)}`);

    const v = await loadVerify();
    const reading = v.gateReading(root, 10, '测试', 'PASS', r.out);
    assert.equal(reading.text, `用例 ${pass}/${total}`, `必须与汇总行逐字一致（改前会印第一行的 用例 2/2），实得：${reading.text}`);
    assert.ok(reading.cases, '取到数就必须带 cases（含 source）');
    assert.equal(reading.cases.total, Number(total));
    assert.equal(reading.cases.pass, Number(pass));
    assert.match(String(reading.cases.source), /^测试门：文件 \d+ \/ 用例 /, `source 要点明它取自哪一行：${reading.cases.source}`);
  } finally {
    rmRf(root);
  }
});

test('⑤ R38 反向：输出里有 `6/6` 却**没有**汇总行 ⇒ 必须「用例 未识别」+ `cases: null`（不许印 6/6）', async () => {
  const root = makeTempHome();
  try {
    const v = await loadVerify();
    const out = r38PerFileOnlyOutput();
    assert.ok(out.includes('6/6'), '夹具必须含 6/6（不含就测不出"猜数"这个病 —— 0.25② 要有鉴别力）');
    // 两个名字都要过：① 登记过但锚点没命中的门 ② 根本未登记的新门（fail-closed）
    for (const name of ['测试', '未登记的新门']) {
      const r = v.gateReading(root, 3, name, 'PASS', out);
      assert.doesNotMatch(r.text, /6\/6/, `不许印 6/6（那是逐文件行，不是该门汇总行）：${r.text}`);
      assert.match(r.text, /未识别/, `定位不到锚点必须**显式**说"未识别"（不印会让人以为"这门没有读数"）：${r.text}`);
      assert.equal(r.cases, null, '取不到锚点时 cases 必须是 null —— 不是猜出来的数字');
    }
  } finally {
    rmRf(root);
  }
});

test('⑥ R38 消融：把「测试」的锚点降回"全文首个 N/M" ⇒ ⑤ 立刻变回印 6/6（证明 ⑤ 是锚点判定的功劳）', async () => {
  const root = makeTempHome();
  try {
    const v = await loadVerify();
    const entry = v.READOUT_ANCHORS.find((e) => e.gate === '测试');
    // ★ 先证"这条锚点真的存在"：表里没有它 ⇒ ⑤ 就是"永远绿"的假守卫（0.16）
    assert.ok(entry, '锚点表里必须有「测试」这一条');
    const saved = { anchor: entry.anchor, pass: entry.pass, total: entry.total };
    const out = r38PerFileOnlyOutput();
    try {
      // 消融 = 撤掉"必须是该门汇总行"这条纪律（R38 之前的口径：整份输出取第一处 `用例 N/M`）
      entry.anchor = /用例\s*(\d+)\s*\/\s*(\d+)/g;
      entry.pass = 1;
      entry.total = 2;
      const r = v.gateReading(root, 3, '测试', 'PASS', out);
      assert.match(r.text, /6\/6/, `消融后必须复现原病（否则 ⑤ 的"不许印"不是锚点判定的功劳）：${r.text}`);
    } finally {
      Object.assign(entry, saved);
    }
    // ★ 还原自检：复原后结论必须回来（否则这条消融会污染同进程的其余用例）
    assert.match(v.gateReading(root, 3, '测试', 'PASS', out).text, /未识别/, '消融必须能还原');
  } finally {
    rmRf(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑦ R39：**门红时落下的工作产物，不许变成别人门里的红**
//   改前：失败门的完整输出落 `.agent-io/verify-last/`（R21 为了让"门红时能看完整输出"新加的目录）。
//     它 ① 在 `.agent-io/` **顶层**、② 又不在 MANIFEST 卷表 ⇒ 同一轮里排在它后面的「文档与事实」
//     的 `manifest:check` 报「.agent-io/ 下有没人认领的条目：verify-last」
//     ⇒ **一个缺陷亮两盏灯，而第二盏（manifest）指着与元凶无关的地方**（查因方向被带偏一格）。
//   ★ 这条缺陷来自一个通用问句（R39 的纪律）：**新机制落地时先问「它自己会不会变成别人门里的红」**。
//   两向（缺一不算检测点：0.25① 可执行 + 有鉴别力）：
//     正向：造一个失败门 ⇒ 日志落在**已认领**的目录里，且真跑 `scripts/gen_manifest.mjs` 的卷表对账
//           **仍绿**；旧顶层落点（`.agent-io/verify-last`）必须**没有**被建出来（搬回去这条立刻红）。
//           ★ 认领口径不在这里抄第二份：卷表的唯一住处就是那个脚本，本证直接跑它。
//     反向：在 `.agent-io/` 下造一个**未声明**条目 ⇒ 同一份对账 **必须红**
//           （证明治法是"搬落点"，不是"把 manifest 那道门关掉/放宽" —— 0.25 明禁）。
// ════════════════════════════════════════════════════════════════════
test('⑦ R39：失败门日志必须落在**已认领**的目录（manifest:check 仍绿）；未声明条目仍必须红', async () => {
  const root = makeTempHome();
  try {
    // 认领判据 = `gen_manifest.mjs` 的卷表（`probe`）+ `NON_VOLUME_ENTRIES`；先真跑它落 MANIFEST.txt
    fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
    const gen = run(GEN_MANIFEST, ['--project', root], root);
    assert.equal(gen.status, 0, `MANIFEST.txt 必须能按卷表生成\n${tail(gen.out)}`);

    // ── 正向 ①：失败门的日志落在已认领的 scratch 卷下（不是 `.agent-io/` 顶层的新条目）──
    const v = await loadVerify();
    const out = r21LongGateOutput();
    const r = v.gateReading(root, 9, '文档与事实', 'FAIL', out);
    assert.ok(r.logRel, '失败门必须落盘（logRel 为空 = 没有完整输出可读）');
    assert.match(String(r.logRel), /^\.agent-io\/scratch\/verify-last\/09-文档与事实\.log$/, `日志必须落在已认领的 scratch 卷下，实得：${r.logRel}`);
    assert.ok(
      !fs.existsSync(path.join(root, '.agent-io', 'verify-last')),
      '旧的顶层落点 .agent-io/verify-last 不许再被建出来 —— 它就是"让第二盏灯也红"的那一个',
    );
    // ★ R21 能力不许回退：从新落点仍能读到第一条失败的**原文**、且不截断
    const logged = fs.readFileSync(path.join(root, String(r.logRel)), 'utf8');
    assert.equal(logged, out, '完整输出必须原样落盘（R21：不截断）');
    assert.match(
      v.failureLines(logged)[0],
      /FAIL\s+p0_change_set_truth\.test\.ts/,
      `从新落点必须能读到第一条失败的原文（R21 不许回退），实得：${v.failureLines(logged)[0]}`,
    );

    // ── 正向 ②：落盘之后，真跑卷表对账必须**仍绿**（改前这里会红）──
    const okChk = run(GEN_MANIFEST, ['--project', root, '--check'], root);
    assert.equal(okChk.status, 0, `失败门落盘后 manifest:check 必须仍绿（改前报「没人认领的条目：verify-last」）\n${tail(okChk.out)}`);
    assert.match(okChk.out, /MANIFEST 与卷表一致/, `正向必须真对过账：\n${tail(okChk.out)}`);

    // ── 反向：`.agent-io/` 下造一个未声明条目 ⇒ 必须红（不许把这道门放宽成"什么都不管"）──
    fs.writeFileSync(path.join(root, '.agent-io', 'r39-未声明的条目.json'), '{}', 'utf8');
    const badChk = run(GEN_MANIFEST, ['--project', root, '--check'], root);
    assert.notEqual(badChk.status, 0, `.agent-io/ 下的未声明条目必须判红（否则这条治法等于"把 manifest 门关掉"）\n${tail(badChk.out)}`);
    assert.match(badChk.out, /没人认领的条目/, `必须点名"没人认领"：\n${tail(badChk.out)}`);
    assert.match(badChk.out, /r39-未声明的条目/, `必须点名是哪一个条目：\n${tail(badChk.out)}`);
  } finally {
    rmRf(root);
  }
});
