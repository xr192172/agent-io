/**
 * P0 · 静默失败守卫 —— AGENTS-RULES 0.12「失败必须与「没有」可区分」的三条落地证。
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

import { scanContracts, contractGate } from '../src/infrastructure/analysis/contract_gate/index.js';
import { assertSourceWriteRegistered, symbolsInFileOf } from '../src/application/write_gate.js';
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
    // ④ 0.12 ③：读数带分母（改动集 / 验了 / 跳过）
    assert.match(out, /改动集 \d+ 个文件 · 验了 \d+ 项/, `分母缺失：\n${out}`);
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
