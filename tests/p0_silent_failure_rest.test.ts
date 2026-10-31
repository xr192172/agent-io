/**
 * P0 · 静默失败守卫（第二批） —— AGENTS-RULES 0.12「失败必须与「没有」可区分」剩下的四处。
 *
 * 与 `p0_silent_failure_guards.test.ts` 是**同一个病**的不同断面：**"一条都没跑 / 没有可比的东西 /
 * 读不到 / 算不出" 被当成 "没有，且一切正常"**。四处各自的可判真假读数：
 *   ① `scripts/run-invariant-checks.mjs`：`invariant_checks: []` ⇒ `PASS=0 FAIL=0` ⇒ **exit 0「✓ 全部 PASS」**
 *      （0 条判据是合法的，但"一条都没跑"等于"没验"—— 与 `run-tests`「0 个用例算红」、
 *      `judge-all`「判了 0 条算红」同口径）；
 *   ② `scripts/gen-db-check.mjs`：投影为空（设计册在、但没有文件节点）⇒ `bad = 五项和 = 0` ⇒ **exit 0
 *      「设计与投影一致」**（那是"没有可比的东西"，不是"一致"）；
 *   ③ `src/application/observe/runtime/stale_check.ts`：源读不到 ⇒ `catch { continue }`，而 `scanned`
 *      仍把它算进去 ⇒ 输出「✓ N 个手写源均已重建」，**实际只验了 N-1**；
 *   ④ `src/application/read_set.ts#refreshAfterOwnWrite`：指纹算不出的符号被 `.filter` **静默剔除**、
 *      整段失败 `catch { return 0 }` ⇒ 读集悄悄缩小 ⇒ `assumption_check` 少报"你读的东西变了"。
 *
 * ★ 四条证的形状都是「**同一输入、改前改后落在不同的读数上**」：不是断言"非空"，而是断言
 *   "**失败**"与"**真的没有**"可区分。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { checkStaleBuild, formatStaleText } from '../src/application/observe/runtime/stale_check.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 源码 → 统一正斜杠（跨平台断言用） */
const posix = (p: string): string => p.replace(/\\/g, '/');

/**
 * 把「某个源文件读不到」造出来：**只对指定文件名**让 `fs.readFileSync` 抛 EACCES。
 *
 * ★ 为什么必须伪造而不是用一个真权限位：本仓跑在 Windows 上，`chmod` 造不出"文件在、但读不了"
 *   （读权限靠 ACL，改它会把测试变成环境依赖）。而"源文件读不到"这件事的**判据**是
 *   `readFileSync` 抛错 —— 在那一层注入，测的正是 `stale_check` 自己的 `catch` 分支。
 */
function withUnreadableFile(badName: string, fn: () => void): number {
  const real = fs.readFileSync;
  let hits = 0;
  (fs as unknown as { readFileSync: unknown }).readFileSync = ((p: unknown, ...rest: unknown[]) => {
    if (posix(String(p)).endsWith(`/${badName}`)) {
      hits++;
      const e = new Error(`EACCES: permission denied, open '${String(p)}'`) as NodeJS.ErrnoException;
      e.code = 'EACCES';
      throw e;
    }
    return (real as unknown as (...a: unknown[]) => unknown)(p, ...rest);
  }) as unknown;
  try {
    fn();
  } finally {
    (fs as unknown as { readFileSync: unknown }).readFileSync = real;
  }
  return hits;
}

// ════════════════════════════════════════════════════════════════════
// ① run-invariant-checks：0 条判据 ⇒ 非零退出（改前 exit 0「✓ 全部 PASS」）
// ════════════════════════════════════════════════════════════════════
test('① run-invariant-checks：invariant_checks 为空 ⇒ exit 1 且点名"0 条 = 没验"（改前 exit 0 = 假绿）', () => {
  const tmp = makeTempHome();
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
    const script = path.join(tmp, 'scripts', 'run-invariant-checks.mjs');
    fs.copyFileSync(path.resolve('scripts/run-invariant-checks.mjs'), script);
    // ★ 空数组是**合法**形状（0 条判据），所以它走不到"读不出 DSL 就 exit 2"那条路 —— 这正是病根
    const dsl = path.join(tmp, 'empty.dsl.json');
    fs.writeFileSync(dsl, JSON.stringify({ task_plan: { invariant_checks: [] } }, null, 2), 'utf8');

    const r = spawnSync(process.execPath, [script, dsl], { cwd: tmp, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    assert.equal(r.status, 1, `0 条不变量必须判红（exit 1；改前是 0）\n--- 输出 ---\n${out}`);
    assert.match(out, /0 条不变量/, `必须点名"0 条"这件事：\n${out}`);
    assert.match(out, /没验/, `必须说清"这不是通过，是没验"：\n${out}`);
    assert.doesNotMatch(out, /全部 PASS/, `0 条判据时不许打"全部 PASS"：\n${out}`);
    // ★ 口径对齐：与 run-tests（0 个用例算红）/ judge-all（判了 0 条算红）同一句话
    assert.match(out, /run-tests/, `要写明口径与 run-tests 一致：\n${out}`);
  } finally {
    rmRf(tmp);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② gen-db-check：投影为空 ⇒ 非零退出且点名"没有可比的东西"（改前 exit 0「一致」）
// ════════════════════════════════════════════════════════════════════
test('② gen-db-check：投影为空 ⇒ exit 1 且报文含"没有可比的东西"（改前 bad=0 ⇒ exit 0「一致」）', () => {
  const tmp = makeTempHome();
  try {
    // 设计册在（几何节点在），但 **semantic.files 为空** ⇒ plan.items = 0、nodes = 0
    const dir = path.join(tmp, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    const dsl = {
      feature: 'empty-projection',
      title: '空投影夹具',
      geometry: { nodes: [{ id: 'n1', label: 'n1', type: 'service', x: 0, y: 0 }], edges: [] },
      semantic: { files: [] },
      todos: [],
    };
    fs.writeFileSync(path.join(dir, 'empty-projection.dsl.json'), JSON.stringify(dsl, null, 2), 'utf8');

    const r = spawnSync(process.execPath, [path.resolve('scripts/gen-db-check.mjs')], { cwd: tmp, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    assert.equal(r.status, 1, `投影为空必须判红（改前 exit 0 = "一致"）\n--- 输出 ---\n${out}`);
    assert.match(out, /没有可比的东西/, `必须说清"这不是一致，是没有可比的东西"：\n${out}`);
    assert.doesNotMatch(out, /设计与投影一致/, `投影为空时不许说"一致"：\n${out}`);
    // ★ 0.12：判红要带排查提示（否则下一个人只知道红、不知道查什么）
    assert.match(out, /semantic\.files|gen-db/, `判红要给出排查提示：\n${out}`);
  } finally {
    rmRf(tmp);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ stale_check：源读不到 ⇒ 进 skipped 且输出"验了 N / 跳过 M"，不许说"均已重建"
//    （改前 `catch { continue }`，scanned 仍把它算进去）
// ════════════════════════════════════════════════════════════════════
test('③ stale_check：源读不到 ⇒ skipped 计数 + 输出「验了 N / 跳过 M」且不含"均已重建"', () => {
  const root = makeTempHome();
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'dist', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function a() { return 1; }\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export function b() { return 2; }\n', 'utf8');
    fs.writeFileSync(path.join(root, 'dist', 'src', 'a.js'), 'export function a(){return 1;}\n', 'utf8');
    fs.writeFileSync(path.join(root, 'dist', 'src', 'b.js'), 'export function b(){return 2;}\n', 'utf8');
    // 无构建清单 ⇒ 走 mtime 兜底：把产物 mtime 调到源之后 ⇒ 可读的那个判"最新"
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(root, 'dist', 'src', 'a.js'), future, future);
    fs.utimesSync(path.join(root, 'dist', 'src', 'b.js'), future, future);

    let result!: ReturnType<typeof checkStaleBuild>;
    const hits = withUnreadableFile('b.ts', () => {
      result = checkStaleBuild(root);
    });
    assert.ok(hits >= 1, '夹具无效：没有一次读 b.ts 被拦下 ⇒ 注射器没生效');

    // ① 读不到的那个必须**留痕**（改前：entries/skipped 里一个字都没有）
    const skipped = (result as unknown as { skipped?: Array<{ src: string; reason: string }> }).skipped ?? [];
    assert.deepEqual(
      skipped.map((s) => s.src),
      ['src/b.ts'],
      `读不到的源必须进 skipped（改前它被 catch{continue} 吃掉）实际：${JSON.stringify(skipped)}`,
    );
    assert.match(skipped[0].reason, /读不到|EACCES/, `skipped 要带原因，实际：${JSON.stringify(skipped[0])}`);

    // ② 0.12 ③：分母两半同时给
    const text = formatStaleText(result);
    assert.match(text, /验了 1/, `必须给"验了几个"：\n${text}`);
    assert.match(text, /跳过 1/, `必须给"跳过几个"：\n${text}`);
    assert.doesNotMatch(text, /均已重建/, `有 skipped 时不许说"均已重建"（那是在替没验的背书）：\n${text}`);
  } finally {
    rmRf(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ read_set#refreshAfterOwnWrite：指纹算不出 ⇒ 结果里看得见（不许 .filter 掉 / catch 回 0）
// ════════════════════════════════════════════════════════════════════
test('④ refreshAfterOwnWrite：算不出指纹 ⇒ 带出来（改前被 .filter 掉 + catch 回 0）', async () => {
  // ★ 动态 import：本证要断言的导出是**本次新增的** ⇒ 改前它不存在，静态 import 会让整份文件加载失败、
  //   把①②③的红也一起盖掉（那就分不清"哪条证红、红在哪"了）。
  const readSet = (await import('../src/application/read_set.js')) as unknown as {
    recordRead: (i: Record<string, unknown>) => { recorded: boolean };
    refreshAfterOwnWrite: (root: string, actor: string | null, files: readonly string[]) => {
      patched: number;
      fp_unavailable: string[];
      removed: number;
      error?: string;
    };
    ownWriteRefreshLines: (r: {
      patched: number;
      fp_unavailable: string[];
      removed: number;
      error?: string;
    }) => string[];
  };
  assert.equal(typeof readSet.ownWriteRefreshLines, 'function', 'ownWriteRefreshLines 必须导出（读集收缩要有一条人读的话）');

  // ★ 现解析要预热 parser（否则 `loadFileFacts` 只能到文件级、读集里 0 个符号 ⇒ 本证失去意义）
  const { prewarmKernel } = await import('../src/infrastructure/parse/index.js');
  await prewarmKernel();

  const root = makeTempHome();
  const actor = 'subagent:silent-rest';
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const file = path.join(root, 'src', 'a.ts');
    fs.writeFileSync(file, 'export function f() { return 1; }\nexport function g() { return 2; }\n', 'utf8');

    const rec = readSet.recordRead({ projectRoot: root, actor, file: 'src/a.ts', kind: 'read' });
    assert.equal(rec.recorded, true, '夹具无效：读集没记上');

    // ── (a) 真的没有：g 被自己删掉（文件仍可解析）⇒ 只计数，不冒充"算不出"
    fs.writeFileSync(file, 'export function f() { return 1; }\n', 'utf8');
    const removed = readSet.refreshAfterOwnWrite(root, actor, ['src/a.ts']);
    assert.deepEqual(removed.fp_unavailable, [], `符号真被删掉时不许报"算不出"：${JSON.stringify(removed)}`);
    assert.equal(removed.removed, 1, `删掉的符号要计数（g），实际：${JSON.stringify(removed)}`);

    // ── (b) 算不出指纹：文件**读不到** ⇒ 这个文件上读过的符号一个都刷不了（不是"没有"）
    //   ★ 用"读不到"而不是"内容解析不了"造法：tree-sitter 对 `export function f( {` 不报 error
    //     （容错解析 ⇒ `source:'disk'`、符号为空 ⇒ 走的是 gone 那一档）⇒ 测不到本档。
    let bad!: { patched: number; fp_unavailable: string[]; removed: number; error?: string };
    const hits = withUnreadableFile('a.ts', () => {
      bad = readSet.refreshAfterOwnWrite(root, actor, ['src/a.ts']);
    });
    assert.ok(hits >= 1, '夹具无效：没有一次读 a.ts 被拦下 ⇒ 注射器没生效');
    assert.deepEqual(
      bad.fp_unavailable,
      ['src/a.ts#（整文件）'],
      `读不到 ⇒ 算不出指纹，必须带出来（改前被 .filter/continue 掉 ⇒ 读集悄悄缩小）实际：${JSON.stringify(bad)}`,
    );
    const lines = readSet.ownWriteRefreshLines(bad);
    assert.match(lines.join('\n'), /算不出指纹/, `人读的话必须点名"算不出指纹"：\n${lines.join('\n')}`);
    assert.match(lines.join('\n'), /不是「没有」|不是"没有"/, `必须与"没有"可区分：\n${lines.join('\n')}`);

    // ── (c) 整段失败 ⇒ 报 error，不许回 0 冒充"patched 0（没什么可刷）"
    const boom = readSet.refreshAfterOwnWrite(null as unknown as string, actor, ['src/a.ts']);
    assert.ok(boom.error && boom.error.length > 0, `整段失败必须带 error（改前 catch{return 0}）：${JSON.stringify(boom)}`);
    assert.match(readSet.ownWriteRefreshLines(boom).join('\n'), /读集基线刷新.*失败/, '整段失败要有一条人读的话');
  } finally {
    rmRf(root);
  }
});
