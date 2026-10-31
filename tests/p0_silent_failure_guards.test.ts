/**
 * P0 · 静默失败守卫 —— AGENTS-RULES 0.12「失败必须与「没有」可区分」的六条落地证。
 *
 * 三处 HIGH 是**同一个病**：失败回落到空集 / 0，且不留痕 ⇒ 门/判据给出**假绿**。
 *   ① `scripts/verify-changed.mjs`：git 失败 ⇒ `changed=[]` ⇒ `nothingHit` ⇒ **exit 0**
 *      （"增量门什么都没验"以通过退出；文案写着"这不是绿"，CI 只读退出码）；
 *   ② `contract_gate/core.ts`：源读失败 ⇒ 当成"**零未定义引用**"**且仍计入已扫** ⇒ `ok:true` + 覆盖率虚高；
 *   ③ `write_gate.ts#symbolsInFileOf`：`cache.db` 不在/被锁 ⇒ 符号清单空 ⇒ `planCoverageGaps` 的
 *      `silent` 为空 ⇒ **A7「每个顶层符号都要表态」整格静默失效**。
 *
 * ★ 三条证的形状都是"**同一输入、改前改后必须能分开读**"：不是断言"输出非空"，
 *   而是断言"**失败**"与"**真的没有**"落在**不同的读数**上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { scanContracts, contractGate } from '../src/infrastructure/analysis/contract_gate/index.js';
import { assertSourceWriteRegistered, symbolsInFileOf, symbolFpsOf } from '../src/application/write_gate.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { syncFile } from '../src/infrastructure/index/symbols.js';
import { TOOL_DEFS } from '../src/application/tool_registry.js';
import {
  planCoverageGapsOf,
  readRewritePlan,
  writeRewritePlan,
  type RewritePlan,
} from '../src/application/design/db/rewrite_plan.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

// ════════════════════════════════════════════════════════════════════
// ① verify-changed：git 读不到改动集 ⇒ 非零退出（改前 exit 0）
// ════════════════════════════════════════════════════════════════════
test('① verify-changed：git 读不到改动集 ⇒ 非零退出（改前 exit 0 = 假绿）', () => {
  const tmp = makeTempHome(); // ★ 不是 git 仓库
  try {
    const scriptDir = path.join(tmp, 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    // 脚本要读同级的 `certs/`（空目录即可：本证只关心"改动集取不到"这一条）
    fs.mkdirSync(path.join(tmp, 'certs'), { recursive: true });
    const script = path.join(scriptDir, 'verify-changed.mjs');
    fs.copyFileSync(path.resolve('scripts/verify-changed.mjs'), script);

    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    // ★ 钉住上溯边界：否则 tmp 若恰好落在某个 git 仓库里，git 会"找到"父仓库并成功 ⇒ 这条证失去意义
    env.GIT_CEILING_DIRECTORIES = tmp;

    const r = spawnSync(process.execPath, [script], { cwd: tmp, encoding: 'utf8', env });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

    // ① 退出码必须非零（改前：git 失败 ⇒ changed=[] ⇒ nothingHit ⇒ red=false ⇒ **0**）
    assert.notEqual(r.status, 0, `git 取不到改动集时必须非零退出（改前是 0 = 假绿）\n--- 输出 ---\n${out}`);
    // ② 而且要说清是**哪一种**"没验"（不是"命中 0 条"那一支）
    assert.match(out, /git 读不到改动集/, `结论行必须点名 git 失败，实际输出：\n${out}`);
    assert.match(out, /rev-parse/, '诊断要带出失败的那条 git 命令');
    // ③ 绝不许出现"全绿"
    assert.doesNotMatch(out, /★ 全绿/, 'git 失败时不许打"全绿"');
    // ④ 0.12 ③：读数带分母（改动集 / **覆盖 · 未覆盖** / 验了 / 跳过）
    //   ★ 2026-10-31：分母变宽了（新增「覆盖 / 未覆盖」两格，见 `uncovered` 那一节）——
    //    这里按**新形状**断言而不是放宽：`没算` 是 git 失败时那两格的合法取值（0.12：`null` ≠ 0）。
    assert.match(
      out,
      /改动集 \d+ 个文件 · 覆盖 (\d+|没算) 个 · 未覆盖 (\d+|没算) 个 · 验了 \d+ 项/,
      `分母缺失：\n${out}`,
    );
    assert.match(out, /· 跳过 \d+ 项/, `分母的另一半（跳过）也要给 —— 只给分子等于没验（0.12 ③）：\n${out}`);
  } finally {
    rmRf(tmp);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② contract_gate：源读失败 ⇒ skipped + ok 不为 true（改前"零引用且计入已扫"）
// ════════════════════════════════════════════════════════════════════
test('② contract_gate：源读失败 ⇒ 进 skipped 且 ok 不为 true（改前 undefinedRefs:[] 且计入已扫）', () => {
  const root = makeTempHome();
  try {
    fs.writeFileSync(path.join(root, 'ok.ts'), 'const a = 1;\nexport { a };\n', 'utf-8');
    // ★ 用**目录**冒充源文件：`readFileSync` 必抛（EISDIR），这就是"读不到"的最稳造法
    fs.mkdirSync(path.join(root, 'bad.ts'));
    const opts = { cwd: root, files: ['bad.ts', 'ok.ts'] };

    const scan = scanContracts(opts);

    // ① 读不到的文件**不许**算进"已扫"（改前 files 里有两个 ⇒ 覆盖率虚高）
    assert.deepEqual(
      scan.files.map((f) => f.file),
      ['ok.ts'],
      `读失败的文件不许计入已扫（改前它也在 files 里）实际：${JSON.stringify(scan.files.map((f) => f.file))}`,
    );
    // ② 它必须作为 skipped 出现，**带 kind + 原因**（改前 skipped 里根本没有它）
    const bad = scan.skipped.find((s) => s.file === 'bad.ts');
    assert.ok(bad, `读失败的文件必须进 skipped，实际：${JSON.stringify(scan.skipped)}`);
    assert.equal(bad.kind, 'read-failed');
    assert.match(bad.reason, /读源失败/);

    // ③ 门不许因此为 true（改前 ok:true —— "零失配"里混着"没看"）
    const gate = contractGate(opts);
    assert.equal(gate.ok, false, '读失败时契约门不许 ok:true');
    assert.match(String(gate.detail), /没验全/);
    // ④ 0.12 ③：分母（扫了 N / 跳过 M）同时给
    assert.match(String(gate.detail), /扫了 1 个 \/ 跳过 1 个/, `分母缺失：${gate.detail}`);

    // ⑤ 反向：**真的没有**失配时仍是绿的（守卫不许把正常路径也染红）
    const clean = contractGate({ cwd: root, files: ['ok.ts'] });
    assert.equal(clean.ok, true);
    assert.match(String(clean.detail), /扫了 1 个 \/ 跳过 0 个/);
  } finally {
    rmRf(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ write_gate A7：索引读不到 ⇒ ok:false + 覆盖判据出缺口（改前整格静默失效）
// ════════════════════════════════════════════════════════════════════
/** 落一份**判据解得出种类**的设计册（`resolveJudgementKind` 要靠它，否则判据强度那格会先报红） */
function writeSemanticSheet(home: string, feature: string, nodeId: string): void {
  const dsl = {
    feature,
    title: feature,
    geometry: {
      nodes: [
        {
          id: nodeId,
          label: nodeId,
          type: 'service',
          x: 0,
          y: 0,
          decision: {
            summary: '静默失败守卫的判据宿主',
            expectations: [
              { kind: 'call-exists', path: 'src/a.ts', symbol: 'f', target: 'g', why: '这条只为"判据强度"那一格能解出语义类' },
            ],
          },
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  };
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

test('③ write_gate A7：索引读不到 ⇒ symbolsInFileOf 带 ok:false，覆盖判据出缺口并出声（不静默）', () => {
  const root = makeTempHome();
  const home = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  const prevPlan = process.env.AGENT_IO_REQUIRE_PLAN;
  process.env.AGENT_IO_HOME = home;
  process.env.AGENT_IO_REQUIRE_PLAN = '1'; // 严格档（默认就是开；显式钉住，别受外层影响）
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      'export function f() { return 1; }\nexport function g() { return 2; }\n',
      'utf-8',
    );
    writeSemanticSheet(home, 'silent-guard-fixture', 'n1');
    // 画布只表态了 `f`（`g` 没表态）—— 索引能读时该抓到 g；索引读不到时**也必须**抓
    writeRewritePlan(root, {
      path: 'src/a.ts',
      entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: '改成返回 2', judgement_ref: 'decision:n1#0', status: 'open' }],
    } as RewritePlan);

    // ── (a) 没有索引 ⇒ **取数失败**，而不是"文件没有符号"
    const none = symbolsInFileOf(root, 'src/a.ts');
    assert.equal(none.ok, false, '索引不在时 ok 必须为 false（改前回 [] ⇒ 与"没有符号"同形）');
    assert.deepEqual(none.symbols, []);
    assert.match(String(none.reason), /索引不存在/);

    // ── (b) 与"真的没有顶层符号"**可区分**：`ok:true` + 空清单才是那个意思
    const plan = readRewritePlan(root, 'src/a.ts');
    assert.deepEqual(
      planCoverageGapsOf(plan, { ok: true, symbols: [] }),
      [],
      'ok:true + 空清单 = 文件确实没有顶层符号 ⇒ 不报缺口（别把正常路径染红）',
    );

    // ── (c) 取数失败 ⇒ 覆盖判据必须出缺口（改前回 [] ⇒ A7 整格静默失效）
    const gaps = planCoverageGapsOf(plan, none);
    assert.equal(gaps.length, 1, `索引读不到时必须出一条缺口，实际：${JSON.stringify(gaps)}`);
    assert.match(gaps[0], /索引读不到/);
    assert.match(gaps[0], /A7/, '缺口必须点名"哪条判据没生效"');

    // ── (d) 坏索引（存在但打不开）同样不许静默
    fs.mkdirSync(path.join(root, '.agent-io'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agent-io', 'cache.db'), 'this is not a sqlite database', 'utf-8');
    const corrupt = symbolsInFileOf(root, 'src/a.ts');
    assert.equal(corrupt.ok, false, '坏索引也必须 ok:false');
    assert.match(String(corrupt.reason), /读索引失败/);

    // ── (e) 端到端：这次写**放行但出声** —— 回执里必须点名"索引读不到 ⇒ A7 未生效"（改前这里一句话都没有）
    const outcome = assertSourceWriteRegistered(root, ['src/a.ts'], { actor: 'subagent:p0-silent' });
    const warns = (outcome.warnings ?? []).join('\n');
    assert.match(warns, /索引读不到/, `回执必须点名索引读不到，实际 warnings：\n${warns}`);
    assert.match(warns, /A7/, '回执必须说清"哪条判据没生效"');
    // ★ `（1 处）` 保证这是**唯一**的缺口：别的缺口混进来会把这条读数掩盖掉
    assert.match(warns, /（1 处）/, `索引读不到应是唯一缺口，实际：\n${warns}`);
    // ★ 反方向：它**只点名、不拦**（拦了 = 任何还没建索引的项目都写不了源码 ⇒ 那是改语义）
    assert.deepEqual(outcome.warnings.filter((w) => /索引读不到/.test(w)).length, 1);
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    if (prevPlan === undefined) delete process.env.AGENT_IO_REQUIRE_PLAN;
    else process.env.AGENT_IO_REQUIRE_PLAN = prevPlan;
    rmRf(root);
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ contract_gate 目录枚举：`readdirSync` 失败 ⇒ skipped{walk-failed} + 分母剔除
//    （改前 `catch { continue }` —— 那个目录下**一个文件都没扫**，而报告照样说"扫了 N 个"）
// ════════════════════════════════════════════════════════════════════
test('④ contract_gate：目录读不到 ⇒ 进 skipped{walk-failed}，且门不绿、分母把"没扫到的目录"单独给', () => {
  const root = makeTempHome();
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function f() { return 1; }\n', 'utf-8');
    // ★ 最稳造法：目录根本不存在（ENOENT）。它下面**本可能有源码** ⇒ 不记账就是"静默少扫"
    const opts = { cwd: root, dirs: ['src', 'no-such-dir'] };

    const scan = scanContracts(opts);

    // ① 读不到的目录必须**留痕**，且带原因（改前：skipped 里一个字都没有）
    const bad = scan.skipped.find((s) => s.kind === 'walk-failed');
    assert.ok(bad, `读目录失败必须进 skipped(walk-failed)，实际 skipped：${JSON.stringify(scan.skipped)}`);
    assert.equal(bad.file, 'no-such-dir', '记的必须是那个**目录**（相对 cwd 的 POSIX 路径）');
    assert.match(String(bad.reason), /读目录失败/);

    // ② 它**不许**被算成"本闸不管这门语言"（两件事：一个要修环境，一个要扩语言分支）
    assert.equal(
      scan.skipped.filter((s) => s.kind === 'no-adapter' && s.file === 'no-such-dir').length,
      0,
      '目录读失败 ≠ 没有语言适配器',
    );

    // ③ 门不许绿（改前：只扫到 src/a.ts ⇒ 零失配 ⇒ ok:true，而 no-such-dir 里的文件**根本没看**）
    const gate = contractGate(opts);
    assert.equal(gate.ok, false, '有目录读不到时契约门不许 ok:true');
    assert.match(String(gate.detail), /没验全/);
    // ④ 0.12 ③ 分母：扫了 N / 跳过 M / **读不到目录 K**（只给分子等于没验）
    assert.match(
      String(gate.detail),
      /扫了 1 个 \/ 跳过 0 个 \/ 读不到目录 1 个/,
      `分母必须把"没扫到的目录"单独给出来，实际：${gate.detail}`,
    );

    // ⑤ 反方向：目录都读得到时仍是绿的（守卫不许把正常路径也染红）
    const clean = contractGate({ cwd: root, dirs: ['src'] });
    assert.equal(clean.ok, true, `目录可读时必须绿，实际：${clean.detail}`);
    assert.match(String(clean.detail), /扫了 1 个 \/ 跳过 0 个/);
    assert.doesNotMatch(String(clean.detail), /读不到目录/);
  } finally {
    rmRf(root);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ write_gate#symbolFpsOf：指纹**算不出** ⇒ ok:false + reason
//    （改前 `catch { return {} }` ⇒ 画布写进 `fps_at_freeze:{}` ⇒ "改了却没计划"这条守卫静默失效）
// ════════════════════════════════════════════════════════════════════
test('⑤ write_gate#symbolFpsOf：指纹算不出 ⇒ ok:false + 原因（改前回 {}，与"文件没有符号"同形）', async () => {
  const root = makeTempHome();
  const corruptRoot = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = makeTempHome(); // 别把夹具登记写进真数据仓
  try {
    const SRC_A = 'export function f() { return 1; }\nexport function g() { return 2; }\n';
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), SRC_A, 'utf-8');

    // ── (a) 没有索引 ⇒ **算不出**，不是"文件没有顶层符号"
    const none = symbolFpsOf(root, 'src/a.ts');
    assert.equal(none.ok, false, '没有索引时 ok 必须是 false（改前回 {} ⇒ 与"没有符号"同形）');
    assert.deepEqual(none.fps, {});
    assert.match(String(none.reason), /索引不存在/);

    // ── (b) 有索引 ⇒ ok:true + 每个顶层符号一个 body_hash（这条守卫才有东西可判）
    const db = getProjectCacheDb(root);
    await syncFile(db, root, path.join(root, 'src', 'a.ts'));
    const got = symbolFpsOf(root, 'src/a.ts');
    assert.equal(got.ok, true, `有索引时必须 ok:true，实际：${got.reason}`);
    assert.deepEqual(Object.keys(got.fps).sort(), ['f', 'g'], `顶层符号指纹集合不对：${JSON.stringify(got.fps)}`);
    for (const [k, v] of Object.entries(got.fps)) assert.match(v, /\w+/, `符号 ${k} 的 body_hash 为空`);

    // ── (c) 坏索引（存在但打不开）同样不许静默 —— 且与 (a) 的原因**可区分**
    fs.mkdirSync(path.join(corruptRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(corruptRoot, 'src', 'a.ts'), SRC_A, 'utf-8');
    fs.mkdirSync(path.join(corruptRoot, '.agent-io'), { recursive: true });
    fs.writeFileSync(path.join(corruptRoot, '.agent-io', 'cache.db'), 'this is not a sqlite database', 'utf-8');
    const corrupt = symbolFpsOf(corruptRoot, 'src/a.ts');
    assert.equal(corrupt.ok, false, '坏索引也必须 ok:false');
    assert.match(String(corrupt.reason), /读索引失败/);
    assert.notEqual(String(corrupt.reason), String(none.reason), '"索引不在"与"索引坏了"是两种病，原因不许合并');
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    rmRf(root);
    rmRf(corruptRoot);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑥ observe 参数声明**只有一处**：`ACTION_SPEC` 认的每个字段/动作都必须在 zod 契约里
//    （改前 `max_steps` 与 `action='line'` 都是幽灵 ⇒ 按文档传必被 zod 拒，且没人报错）
// ════════════════════════════════════════════════════════════════════
test('⑥ observe：ACTION_SPEC 的每个字段/动作都在 zod 契约里（幽灵声明 = 参数永远传不进来）', () => {
  const def = TOOL_DEFS.find((t) => t.name === 'observe');
  assert.ok(def, 'observe 必须在工具册里');
  const schemaKeys = Object.keys(def.inputSchema ?? {});

  // ★ 通用断言（不是只钉 line）：从源码里取 ACTION_SPEC 的 action 名与字段名，逐个对 zod 契约
  const SRC = fs.readFileSync(path.resolve('src/application/observe/index.ts'), 'utf8');
  const specBlock = SRC.slice(SRC.indexOf('const ACTION_SPEC'), SRC.indexOf('const SPEC: Record<string, string[]>'));
  assert.ok(specBlock.length > 0, '没解析到 ACTION_SPEC 块（源码结构变了就同步本断言）');
  const specActions: string[] = [];
  const specFields = new Set<string>();
  for (const seg of specBlock.split(/^\s{8}(?=[a-z_]+: \{)/m).slice(1)) {
    const name = seg.match(/^([a-z_]+): \{/)?.[1];
    if (!name) continue;
    specActions.push(name);
    const f = seg.match(/fields: \[([\s\S]*?)\]/);
    for (const m of (f?.[1] ?? '').matchAll(/'([^']+)'/g)) specFields.add(m[1]);
  }
  assert.ok(specActions.length >= 8, `ACTION_SPEC 解析出 ${specActions.length} 个 action（太少 ⇒ 解析失效）`);

  const ghosts = [...specFields].filter((k) => !schemaKeys.includes(k) && k !== 'agent');
  assert.deepEqual(ghosts, [], `这些字段 ACTION_SPEC 认、zod 契约里没有 ⇒ 用户按文档传会被拒：${ghosts.join(', ')}`);

  // ★ 动作同理：zod 的 `action` enum 里没有的 action ⇒ 整条不可达
  const schema = z.object(def.inputSchema as z.ZodRawShape);
  const actionField = def.inputSchema.action as unknown as {
    options?: string[];
    _def?: { entries?: Record<string, string>; values?: string[] };
  };
  const enumVals: string[] = actionField.options ?? actionField._def?.values ?? Object.values(actionField._def?.entries ?? {});
  assert.ok(enumVals.length > 0, '没从 zod 的 action 字段里取出 enum 取值（写法变了就同步本断言）');
  const ghostActions = specActions.filter((a) => !enumVals.includes(a));
  assert.deepEqual(ghostActions, [], `这些 action ACTION_SPEC 认、zod enum 里没有 ⇒ 整条不可达：${ghostActions.join(', ')}`);

  // ★ 行为面：按文档传 `action=line` + `max_steps` 必须被契约接受（改前这里被 zod 拒）
  const parsed = schema.safeParse({ action: 'line', feature: 'demo', max_steps: 3 });
  assert.equal(
    parsed.success,
    true,
    `按文档传 action=line + max_steps 必须被接受，实际 issues：${JSON.stringify((parsed as { error?: { issues: unknown } }).error?.issues ?? [])}`,
  );
});
