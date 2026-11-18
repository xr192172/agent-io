/**
 * touches: scripts/judge-all.mjs, src/application/design/index.ts, src/application/design/intent/expectations.ts,
 *          src/application/design/intent/behavior_pool.ts
 *
 * P1 · **judge-all 全量提速后的三条不变量**（2026-11-17，P0「三册合一 spawn / 全量 <30s」）。
 *
 * ## 它锁的是什么
 * 改前：`judge-all` 每册 `spawnSync` 一次 CLI（三册三次冷启动），判据全量实测 **104.0s**。
 * 实测分解：`behavior-cases` 一档 **74.6–94.7s**（81 条 × 约 921ms，贵在每条现建一次夹具 + 起子进程），
 * 其余 10 种 kind 合计 < 4s，三次 CLI 冷启约 4s。
 * ⇒ 只把 spawn 并成一次，最多省几秒；**要 <30s 必须让 `behavior-cases` 的执行并发铺开**。
 * 改后：三册在**同一进程**里判（`judgeBookReceipt`），`behavior-cases` 的执行走 worker 池。
 *
 * ## 三条不变量（本文件逐条钉住；破坏了就不是"变快"，是"变绿"）
 * 1. **判定核只有一份**：CLI 的 `design_line action=judge` 回执 ≡ `judgeBookReceipt()` 的回执
 *    （同形、同值）。两处各写一份"判定"是本仓最贵的病（"第二把尺"）。
 * 2. **并行不许改结论**：同一批判据在 `AGENT_IO_JUDGE_CONCURRENCY=1`（串行）与 `=4`（并行）下
 *    逐条 verdict / detail / 顺序**完全相同**。差异只许出现在墙钟上。
 * 3. **结构不许回退**：`judge-all` 里**不再**有"每册一次 `runCli('design_line', …)`"这种调用
 *    （回退了就又是一册一进程 —— 这条断言是给未来的人看的，不是给现在的人看的）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'dist', 'src', 'presentation', 'cli', 'cli.js');

function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `jpar-${tag}-`));
}

/** 一个最小工程：两个可被 behavior-cases 现跑的导出函数 */
function makeTinyProject(): string {
  const dir = tmpDir('proj');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'math.ts'),
    ['export function add(a: number, b: number): number {', '  return a + b;', '}', 'export function mul(a: number, b: number): number {', '  return a * b;', '}', ''].join('\n'),
    'utf8',
  );
  return dir;
}

/** 造一批 `behavior-cases` 判据（同一文件、不同符号/多 case —— 正好是"每条约 0.9s"那一档） */
function behaviorItems(): Array<Record<string, unknown>> {
  return [
    {
      node_id: 'n_add',
      node_label: 'add',
      expectation: {
        kind: 'behavior-cases',
        path: 'src/math.ts',
        symbol: 'add',
        why: '夹具：add 的输入→输出',
        cases: [
          { given: [1, 2], expect: '3' },
          { given: [0, 0], expect: '0' },
        ],
      },
    },
    {
      node_id: 'n_mul',
      node_label: 'mul',
      expectation: {
        kind: 'behavior-cases',
        path: 'src/math.ts',
        symbol: 'mul',
        why: '夹具：mul 的输入→输出',
        cases: [
          { given: [3, 4], expect: '12' },
          { given: [2, 5], expect: '10' },
        ],
      },
    },
    {
      node_id: 'n_missing',
      node_label: 'missing',
      expectation: {
        kind: 'behavior-cases',
        path: 'src/nope.ts',
        symbol: 'nope',
        why: '夹具：文件不存在（fail 口径）',
        cases: [{ given: [1], expect: '1' }],
      },
    },
  ];
}

/** 在给定并发度下跑同一批判据（进程内，不 spawn） */
async function judgeAt(root: string, concurrency: number) {
  process.env.AGENT_IO_JUDGE_CONCURRENCY = String(concurrency);
  const mod = await import(pathToFileURL(path.join(ROOT, 'dist/src/application/design/intent/expectations.js')).href);
  const items = behaviorItems() as never[];
  const rep = await mod.judgeExpectations(root, items);
  return rep.items.map((it: { node_id: string; verdict: string; detail: string }) => ({
    node_id: it.node_id,
    verdict: it.verdict,
    detail: it.detail,
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// ① 并行 = 串行（逐条 verdict / detail / 顺序都不许变）
// ══════════════════════════════════════════════════════════════════════════
test('并行① · 同一批 behavior-cases：并发 1 与并发 4 的结论逐条相同（只许墙钟不同）', async () => {
  const root = makeTinyProject();
  const serial = await judgeAt(root, 1);
  const parallel = await judgeAt(root, 4);
  assert.deepEqual(parallel, serial, '并行与串行的 verdict/detail/顺序必须逐条相同 —— 不同就是"并行改了判定"');
  // ★ 反向（0.16）：这批判据里必须**真有** pass 与 fail 两种，否则"相同"可能是"都一样地错"
  assert.ok(serial.some((x) => x.verdict === 'pass'), '夹具里必须有判过的（pass）');
  assert.ok(serial.some((x) => x.verdict === 'fail'), '夹具里必须有判红的（fail）—— 否则这条用例没有鉴别力');
  process.env.AGENT_IO_JUDGE_CONCURRENCY = '';
});

// ══════════════════════════════════════════════════════════════════════════
// ② 池子真的在并行（不是"接上了但永远串行"）
// ══════════════════════════════════════════════════════════════════════════
test('并行② · 池子接上了：并发度 >1 时确实用到了 worker（且可重复提交不串味）', async () => {
  const root = makeTinyProject();
  process.env.AGENT_IO_JUDGE_CONCURRENCY = '4';
  const pool = await import(pathToFileURL(path.join(ROOT, 'dist/src/application/design/intent/behavior_pool.js')).href);
  assert.ok(pool.judgeConcurrency() >= 2, `并发度应 >1，实得 ${pool.judgeConcurrency()}`);
  const spec = {
    project_dir: root,
    file: 'src/math.ts',
    function: 'add',
    cases: [{ name: 'case-1', args: [1, 2] }],
  };
  const [a, b] = await Promise.all([pool.submit({ kind: 'harness', spec }), pool.submit({ kind: 'harness', spec })]);
  assert.equal(a.ok, true, `第一条作业应跑完：${JSON.stringify(a)}`);
  assert.equal(b.ok, true, `第二条作业应跑完：${JSON.stringify(b)}`);
  assert.deepEqual(a.value.run.results, b.value.run.results, '同一 spec 跑两遍结果必须一致（worker 之间不许串味）');
  assert.equal(pool.poolDegradedReason(), '', `池子不该降级：${pool.poolDegradedReason()}`);
  pool.closePool();
  process.env.AGENT_IO_JUDGE_CONCURRENCY = '';
});

// ══════════════════════════════════════════════════════════════════════════
// ③ 判定核只有一份：CLI 回执 ≡ judgeBookReceipt 回执
// ══════════════════════════════════════════════════════════════════════════
test('并行③ · 同一个 `design_line action=judge`：CLI 的 DATA 块与 `judgeBookReceipt()` 同值（一份实现）', () => {
  if (!fs.existsSync(CLI)) return; // 没 build ⇒ 这条不跑（本仓的门会先报 dist 不新鲜）
  // ★ 用**自建数据根**（`AGENT_IO_DATA_ROOT` ⇒ projects.json），不依赖跑测试那台机器上注册了什么册：
  //   本仓既有测试是在 `AGENT_IO_HOME` 被重定向的环境里跑的（实测：直接指名真册会红「feature 不存在」）。
  const home = tmpDir('home');
  const project = tmpDir('twin');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'math.ts'), 'export function add(a: number, b: number): number {\n  return a + b;\n}\n', 'utf8');
  fs.mkdirSync(path.join(project, '.agent-io', 'design'), { recursive: true });
  fs.writeFileSync(
    path.join(project, '.agent-io', 'design', 'p1-twin.dsl.json'),
    JSON.stringify(
      {
        feature: 'p1-twin',
        geometry: {
          nodes: [
            {
              id: 'n_twin',
              label: 'n_twin',
              decision: {
                summary: '夹具：一条 file-exists 判据',
                expectations: [{ kind: 'file-exists', path: 'src/math.ts', why: '夹具判据' }],
              },
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(home, 'projects.json'),
    JSON.stringify({ version: 1, features: { 'p1-twin': { project_root: project.split(path.sep).join('/'), registered_at: new Date().toISOString(), registered_by: 'tests/p1_judge_parallel' } } }, null, 2),
    'utf8',
  );
  const env = { ...process.env, AGENT_IO_DATA_ROOT: home, AGENT_IO_JUDGE_CONCURRENCY: '1' };

  // ── A：CLI 那一侧（`design_line action=judge` 真跑一次）
  const argsFile = path.join(tmpDir('args'), 'args.json');
  fs.writeFileSync(argsFile, JSON.stringify({ project_dir: project, feature: 'p1-twin', action: 'judge' }), 'utf8');
  const r = spawnSync(process.execPath, [CLI, 'design_line', '--input', argsFile], { encoding: 'utf8', cwd: ROOT, env });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  assert.equal(r.status, 0, `CLI 应成功：${out.slice(0, 400)}`);
  const mark = out.indexOf('---DATA---');
  assert.ok(mark >= 0, 'CLI 回执里必须有 `---DATA---` 块');
  const dataBlock = out.slice(mark + '---DATA---'.length);
  const start = dataBlock.search(/[[{]/);
  // ★ 括号配对截取（DATA 块之后可能还有散文警告 ⇒ 不能"取到最后一个 }"）
  const balance = (s: string, from: number): number => {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = from; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}' && --depth === 0) return i;
    }
    return -1;
  };
  const closeIdx = balance(dataBlock, start);
  assert.ok(closeIdx > start, 'DATA 块必须是可配平的 JSON 对象');
  const cliData = JSON.parse(dataBlock.slice(start, closeIdx + 1));

  // ── B：进程内那一侧（judge-all 走的就是这条；同一个数据根、同一个 project_dir）
  const script = path.join(home, 'twin.mjs');
  fs.writeFileSync(
    script,
    [
      `const mod = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'dist/src/application/design/index.js')).href)});`,
      `const r = await mod.judgeBookReceipt({ project_dir: ${JSON.stringify(project)}, feature: 'p1-twin' });`,
      'process.stdout.write(JSON.stringify(r.data));',
      '',
    ].join('\n'),
    'utf8',
  );
  const s = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: ROOT, env });
  assert.equal(s.status, 0, `进程内回执应成功：${`${s.stdout ?? ''}${s.stderr ?? ''}`.slice(0, 400)}`);
  const inProcData = JSON.parse(s.stdout);

  assert.equal(typeof inProcData.feature, 'string', '回执必须有 feature');
  assert.equal(inProcData.feature, cliData.feature);
  assert.equal(inProcData.sheet, cliData.sheet, '册身份必须一致');
  assert.deepEqual(inProcData.tally, cliData.tally, '四态计数必须一致');
  assert.deepEqual(
    inProcData.items.map((x: { node_id: string; verdict: string }) => `${x.node_id}:${x.verdict}`),
    cliData.items.map((x: { node_id: string; verdict: string }) => `${x.node_id}:${x.verdict}`),
    '逐条 verdict 必须一致（否则就是两把尺）',
  );
  // ★ 反向（0.16）：这一册必须**真判出了一条 pass**，否则"两边相同"可能只是"两边都没判"
  assert.ok(
    cliData.items.length > 0 && cliData.items.every((x: { verdict: string }) => x.verdict === 'pass'),
    `夹具判据必须真判过（pass），实得 ${JSON.stringify(cliData.tally)}`,
  );
});

// ══════════════════════════════════════════════════════════════════════════
// ④ 结构不许回退：judge-all 里不再"每册一次 spawn"
// ══════════════════════════════════════════════════════════════════════════
test('并行④ · `judge-all` 判据走 `judgeBookReceipt`（进程内），不再对每册 spawn 一次 CLI', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'judge-all.mjs'), 'utf8');
  assert.match(src, /judgeBookReceipt/, 'judge-all 必须直接调 `judgeBookReceipt`（三册一个进程）');
  assert.equal(
    /runCli\(\s*['"]design_line['"]/.test(src),
    false,
    "judge-all 里不许再有 `runCli('design_line', …)` —— 那是「每册一个 spawnSync」，回退它就又是一册一进程",
  );
});
