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
// ★ R12①：一致性读数（excluded ∩ nodes）的判定核 + 它的读入口（design_line action=report 的同一函数）
import { excludedNodeConflicts, loadDesignSheetsForGate } from '../src/application/design/db/gen_design_db.js';
import { lineReport } from '../src/application/design/line/design_line.js';

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
    // ★★ 2026-11-05：脚本现在 `import { collectTestFiles } from './lib/test_files.mjs'`
    //   （测试清单收集的唯一实现，与 `run-tests.mjs` 共用 —— 0.9.1）。
    //   ⇒ 拷脚本时必须**连依赖一起拷**，否则临时根里模块解析失败、脚本一加载就崩，
    //     本证会看到"输出为空"（实测就是这么红的，差点被读成"git 失败没被点名"）。
    fs.mkdirSync(path.join(scriptDir, 'lib'), { recursive: true });
    fs.copyFileSync(path.resolve('scripts/lib/test_files.mjs'), path.join(scriptDir, 'lib', 'test_files.mjs'));
    // ★★ 2026-11-24（G-1 · 门11①）：G7 后脚本又接了两处外部依赖 ——
    //   `./lib/changed_set.mjs`（三源并集唯一实现）与 `../dist/src/domain/scheduling_evidence.js`
    //   （编译产物，纯类型/形状判据、自包含无外部 import）。两处都得在临时根就位，否则脚本加载即 ESM
    //   解析失败、输出为空。dist 解析口径与既有 dist 处理一致：相对脚本 `../dist/...` ⇒ `<tmp>/dist/...`。
    //   ★ 只补拷依赖，不改断言。
    fs.copyFileSync(path.resolve('scripts/lib/changed_set.mjs'), path.join(scriptDir, 'lib', 'changed_set.mjs'));
    fs.mkdirSync(path.join(tmp, 'dist', 'src', 'domain'), { recursive: true });
    fs.copyFileSync(
      path.resolve('dist/src/domain/scheduling_evidence.js'),
      path.join(tmp, 'dist', 'src', 'domain', 'scheduling_evidence.js'),
    );

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
      { info: [], blocking: [] },
      'ok:true + 空清单 = 文件确实没有顶层符号 ⇒ 不报缺口（别把正常路径染红）',
    );

    // ── (c) 取数失败 ⇒ 覆盖判据必须出缺口（改前回 [] ⇒ A7 整格静默失效）
    //    ★ R12② 档位化后这条落 `info`：它说的是"A7 这一格本次没生效"，不是"计划不合格" ⇒ 只点名、不拦。
    const gapsT = planCoverageGapsOf(plan, none);
    assert.equal(gapsT.info.length, 1, `索引读不到时必须出一条缺口，实际：${JSON.stringify(gapsT)}`);
    assert.deepEqual(gapsT.blocking, [], `索引读不到**不许**拦落盘（否则没建索引的项目都写不了源码），实际：${JSON.stringify(gapsT.blocking)}`);
    assert.match(gapsT.info[0], /索引读不到/);
    assert.match(gapsT.info[0], /A7/, '缺口必须点名"哪条判据没生效"');

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

// ════════════════════════════════════════════════════════════════════
// ⑦ R12② 计划闸**档位**：E-PLAN-010 真拦 / E-PLAN-009 只点名
//    （改前 `gaps.filter((g) => !covGaps.includes(g))` 按字符串内容把整族筛掉 ⇒ 010 从未生效）
// ════════════════════════════════════════════════════════════════════
test('⑦ R12② 计划闸档位：漏符号的画布**被拒** / 补齐 untouched 就过 / 009 只点名不拦', async () => {
  const root = makeTempHome();
  const home = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  const prevPlan = process.env.AGENT_IO_REQUIRE_PLAN;
  process.env.AGENT_IO_HOME = home;
  process.env.AGENT_IO_REQUIRE_PLAN = '1';
  try {
    const SRC_A = 'export function f() { return 1; }\nexport function g() { return 2; }\n';
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), SRC_A, 'utf-8');
    writeSemanticSheet(home, 'silent-guard-fixture', 'n1');
    const db = getProjectCacheDb(root);
    await syncFile(db, root, path.join(root, 'src', 'a.ts'));
    const oneEntry = [{ anchor: { symbol: 'f' }, kind: 'rewrite' as const, detail: '改成返回 2', judgement_ref: 'decision:n1#0', status: 'open' as const }];

    // ── (a) 纯函数双向：010 在 blocking、009 在 info（同一份输入只差 compact 与否）
    const cov010 = planCoverageGapsOf({ path: 'src/a.ts', entries: oneEntry } as RewritePlan, { ok: true, symbols: ['f', 'g'] });
    assert.equal(cov010.blocking.length, 1, `漏表态的符号必须进 blocking，实际：${JSON.stringify(cov010)}`);
    assert.match(cov010.blocking[0], /没表态/);
    assert.deepEqual(cov010.info, [], '010 不许同时进 info（一档只有一处）');
    const covDone = planCoverageGapsOf(
      { path: 'src/a.ts', entries: oneEntry, untouched: [{ symbol: 'g', why: '看过、不动' }] } as RewritePlan,
      { ok: true, symbols: ['f', 'g'] },
    );
    assert.deepEqual(covDone, { info: [], blocking: [] }, '补齐 untouched 后必须两档都空（否则这条闸只会永远红）');
    const cov009 = planCoverageGapsOf(
      { path: 'src/a.ts', entries: oneEntry, untouched_default: { why: '其余不动' }, symbols_at_freeze: ['f'] } as RewritePlan,
      { ok: true, symbols: ['f', 'g'] },
    );
    assert.deepEqual(cov009.blocking, [], `009（冻结后新符号）不许拦落盘，实际：${JSON.stringify(cov009.blocking)}`);
    assert.equal(cov009.info.length, 1);
    assert.match(cov009.info[0], /冻结之后才出现的符号/);
    const cov008 = planCoverageGapsOf(
      { path: 'src/a.ts', entries: oneEntry, untouched_default: { why: '其余不动' }, symbols_at_freeze: [] } as RewritePlan,
      { ok: true, symbols: ['f', 'g'] },
    );
    assert.equal(cov008.blocking.length, 1, '008（compact 无快照）在 blocking —— 只有手改库才撞，成本≈0');

    // ── (b) 端到端：画布漏了 g ⇒ 写闸**拒**（改前这一格从不拦）
    writeRewritePlan(root, { path: 'src/a.ts', entries: oneEntry } as RewritePlan);
    assert.throws(
      () => assertSourceWriteRegistered(root, ['src/a.ts'], { actor: 'subagent:p0-silent' }),
      /没表态/,
      '漏表态的符号必须真的拦住落盘（这就是 R12② 要通电的那一格）',
    );

    // ── (c) 补齐 untouched ⇒ 同一份文件**放行**（证明它不是"永远红"）
    writeRewritePlan(root, { path: 'src/a.ts', entries: oneEntry, untouched: [{ symbol: 'g', why: '看过、不动' }] } as RewritePlan);
    const outcome = assertSourceWriteRegistered(root, ['src/a.ts'], { actor: 'subagent:p0-silent' });
    assert.doesNotMatch((outcome.warnings ?? []).join('\n'), /没表态/, '补齐之后不该再报没表态');

    // ── (d) 009 的**档位**：compact 画布 + 冻结之后新出现的符号 ⇒ **只进 warnings、不进拒绝理由**
    //   ★ 这就是 R12② 要通电的那一格：它仍然每次都亮（`symbols_at_freeze` 不随写穿刷新是 R12③ 的活），
    //     但它**不再拦落盘** —— 亮的是"该重新冻结"，不是"这份计划不合格"。
    writeRewritePlan(root, {
      path: 'src/a.ts',
      entries: oneEntry,
      untouched_default: { why: '其余不动' },
      symbols_at_freeze: ['f'], // g 是"冻结之后才出现的符号"
    } as RewritePlan);
    const out009 = assertSourceWriteRegistered(root, ['src/a.ts'], { actor: 'subagent:p0-silent' });
    const warns009 = (out009.warnings ?? []).join('\n');
    assert.match(warns009, /冻结之后才出现的符号/, `009 必须在 warnings 里**被点名**（不许静默），实际：\n${warns009}`);
    assert.match(warns009, /不拦落盘/, '009 那一行必须自报"不拦落盘"（档位是 info）');
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
// ⑧ R12① **声明与节点不许共存**（`excluded ∩ nodes = ∅`）：
//    建一个被声明命中的节点 ⇒ 冲突 +1；删掉 ⇒ 回到原数；读数从 report 读得到
// ════════════════════════════════════════════════════════════════════
test('⑧ R12① excludedNodeConflicts：双向（+1 / 回原数）+ report 读数带三个分母', () => {
  const root = makeTempHome();
  const home = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home; // 别把数据仓里的真册并进来（loadDesignSheetsForGate 会并）
  const sheetFile = path.join(root, '.agent-io', 'design', 'fixture.dsl.json');
  const writeSheet = (nodes: unknown[]): void => {
    fs.mkdirSync(path.dirname(sheetFile), { recursive: true });
    fs.writeFileSync(
      sheetFile,
      JSON.stringify(
        {
          feature: 'fixture',
          title: 'fixture',
          geometry: { nodes, edges: [] },
          excluded: [{ path: 'scripts/', reason: '量具整目录不入册' }],
          semantic: { files: [] },
          todos: [],
        },
        null,
        2,
      ),
      'utf-8',
    );
  };
  const scriptsNode = (n: string): unknown => ({
    id: n,
    label: n,
    type: 'file',
    path: n,
    x: 0,
    y: 0,
    decision: { summary: '量具', expectations: [{ kind: 'call-exists', path: n, symbol: 'a', target: 'b', why: '夹具' }] },
  });
  const plainNode = (n: string, p: string): unknown => ({ id: n, label: n, type: 'file', path: p, x: 0, y: 0 });
  try {
    // 基准：1 个被 `scripts/` 命中的节点 + 1 个不相干的节点
    writeSheet([scriptsNode('scripts/a.mjs'), plainNode('n_src', 'src/a.ts')]);
    const base = excludedNodeConflicts(loadDesignSheetsForGate(root).sheets);
    assert.equal(base.conflict_files, 1, `被声明命中且有节点的文件数，实际：${JSON.stringify(base)}`);
    assert.equal(base.conflict_nodes, 1);
    assert.equal(base.expectations, 1, '冲突的代价是**判据**：那 1 条不进 design-db');
    assert.equal(base.excluded_decls, 1, '分母：excluded 声明条数');
    assert.equal(base.total_nodes, 2, '分母：册里节点数');
    assert.equal(base.conflicts[0].declared, 'fixture:scripts/', '必须点名"哪册哪个前缀"');
    assert.equal(base.conflicts[0].path, 'scripts/a.mjs', '必须点名文件');
    assert.equal(base.conflicts[0].expectations, 1, '必须点名该节点几条判据');

    // 反向 ①：再加一个同为 `scripts/` 的节点 ⇒ 冲突 +1
    writeSheet([scriptsNode('scripts/a.mjs'), plainNode('n_src', 'src/a.ts'), scriptsNode('scripts/b.mjs')]);
    const plus = excludedNodeConflicts(loadDesignSheetsForGate(root).sheets);
    assert.equal(plus.conflict_files, base.conflict_files + 1, '建一个被声明命中的节点 ⇒ 冲突文件 +1');
    assert.equal(plus.conflict_nodes, base.conflict_nodes + 1);

    // 反向 ②：删掉它 ⇒ 回到原数（不是"只增不减"的计数器）
    writeSheet([scriptsNode('scripts/a.mjs'), plainNode('n_src', 'src/a.ts')]);
    const back = excludedNodeConflicts(loadDesignSheetsForGate(root).sheets);
    assert.equal(back.conflict_files, base.conflict_files);
    assert.equal(back.conflict_nodes, base.conflict_nodes);

    // 读入口：design_line action=report 读的就是这一处（`lineReport` 是那个 handler 的核）
    const rep = lineReport(root, 'fixture');
    assert.equal(rep.excluded_node_conflicts.conflict_files, 1);
    assert.equal(rep.excluded_node_conflicts.excluded_decls, 1);
    assert.equal(rep.excluded_node_conflicts.total_nodes, 2);
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    rmRf(root);
    rmRf(home);
  }
});
