/**
 * P0 · 「派生条目无要求权」门（`AGENTS.md` **0.29⑥**）—— 判据 + **端到端通电**。
 *
 * ## 它钉的是什么（一条会"静默退化"的判据）
 * `expected_apis` 的派生条目（`notes: from:cache.db@<rev>`）**不承载人类意图**。可它的失效形态没有声音：
 * 有人把册改回源码当前值 ⇒ drift 由红转绿 ⇒ 该条目从此与源码永远同源 ⇒ **再也报不出"这里被改过"**。
 * ⇒ 本文件要求：这种改动**必须红**，且红要**点名**（文件 · 符号 · 改前→改后 · 情形）。
 *
 * ## 为什么这层用例必须在 `tests/`（册里的 behavior-cases 覆盖不了的部分）
 * 册里的 `behavior-cases` 只能判**纯函数**（`judgeLine` / `diffDerivedEntries`）。而"门真的会在 git 窗口上红"
 * 涉及 `git` / `cache.db` / 退出码三件 I/O ⇒ 只能在这里跑（`T-#BEHAVIOR-CASES-CANT-EXPRESS-THROW` 同族）。
 *
 * ## 夹具完全自治（不读本仓的册、不读本仓 cache.db、不读本仓 git 历史）
 * 每个用例自建临时项目：`.agent-io/design/*.dsl.json` + 一个**真** `cache.db`（用 `openDb` 建表后插两行：
 * 文件桩 + 一个函数签名）+ 真 `git init` 提交。⇒ 判据不依赖环境态（0.12②）。
 *
 * ## 覆盖矩阵（★ 每条都能单独翻红，别合并）
 * | 用例 | 输入 | 期望 |
 * |---|---|---|
 * | 情形 A | 只改册：条目 → cache.db 当前值，源码不动 | 退出 1 · 点名 `[情形 A]` |
 * | **情形 A（剥 provenance）** | 改册把条目改回当前值 **且把 notes 一并删掉** | 退出 1 · **仍** `[情形 A]`（0.29⑥ 禁形） |
 * | 情形 C | 册与**对应源码文件**同一提交都改 | 退出 0 · 读数含「情形 C 放行 1」 |
 * | 情形 B | 改后签名 ≠ cache.db 且无凭证 | 退出 1 · `[情形 B]` |
 * | 情形 B + 凭证 | 同 B，但有一条指名的 `signature-matches`（同签名） | 退出 0 |
 * | 人写条目 | 两侧都无 provenance | 退出 0 · 读数含「人写或非派生跳过 1」 |
 * | 判不了 | 项目没有 cache.db | 退出 **2**（★ 不折成 0：判不了 ≠ 通过） |
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { judgeLine, diffDerivedEntries } from '../src/domain/req_baseline.js';
import { openDb } from '../src/infrastructure/index/db.js';

const REPO = path.resolve(import.meta.dirname, '..');
const GATE = path.join(REPO, 'scripts', 'req-baseline-gate.mjs');
const REL = 'src/x.ts';
const SYM = 'f';
const ACTUAL = 'f(a)';

/** 一条派生条目的 notes（与 `DERIVED_NOTES_PREFIX` 同形；这里写死是为了"夹具不跟着实现漂"，漂了本用例就红） */
const DERIVED = 'from:cache.db@1';

// ────────────────────────────────────────────────────────────────
// 纯函数层：判定核的向用例（与册里的 behavior-cases 同源，但这里不依赖册/判定器）
// ────────────────────────────────────────────────────────────────
const D = (signature: string) => ({ signature, derived: true });
const H = (signature: string) => ({ signature, derived: false });
const J = (input: Parameters<typeof judgeLine>[0]) => judgeLine(input);

test('判定核：三情形 + 两个跳过 + 剥 provenance 仍判 A（每条一个向）', () => {
  // 情形 A
  assert.equal(
    J({ oldEntry: D('f(flag)'), newEntry: D(ACTUAL), actualSignature: ACTUAL, sourceChanged: false, credential: 'none' }),
    'red|A|fail-baseline-reset',
  );
  // 情形 B 无凭证 / 有凭证
  assert.equal(
    J({ oldEntry: D('f(flag)'), newEntry: D('f(renamed)'), actualSignature: ACTUAL, sourceChanged: false, credential: 'none' }),
    'red|B|fail-no-credential',
  );
  assert.equal(
    J({ oldEntry: D('f(flag)'), newEntry: D('f(renamed)'), actualSignature: ACTUAL, sourceChanged: false, credential: 'signature-matches' }),
    'ok|B|pass-credentialed',
  );
  // 情形 C 优先于 A（否则设计线永远亮）
  assert.equal(
    J({ oldEntry: D('f(flag)'), newEntry: D(ACTUAL), actualSignature: ACTUAL, sourceChanged: true, credential: 'none' }),
    'ok|C|pass-source-changed',
  );
  // 人写条目一概不判（含"值恰好等于源码"这一形）
  assert.equal(
    J({ oldEntry: H('f(flag)'), newEntry: H(ACTUAL), actualSignature: ACTUAL, sourceChanged: false, credential: 'none' }),
    'ok|none|pass-not-derived',
  );
  // ★ 剥 provenance：改前是派生、改后把 notes 删了且值等于源码 ⇒ **仍判 A**（0.29⑥ 禁形）
  assert.equal(
    J({ oldEntry: D('f(flag)'), newEntry: H(ACTUAL), actualSignature: ACTUAL, sourceChanged: false, credential: 'none' }),
    'red|A|fail-baseline-reset',
  );
  // 单侧：新增 / 删除不判（"删 + 重派生"是唯一合法基线更新路径）
  assert.equal(
    J({ oldEntry: null, newEntry: D(ACTUAL), actualSignature: ACTUAL, sourceChanged: false, credential: 'none' }),
    'ok|none|skip-added',
  );
  assert.equal(
    J({ oldEntry: D(ACTUAL), newEntry: null, actualSignature: ACTUAL, sourceChanged: false, credential: 'none' }),
    'ok|none|skip-deleted',
  );
  // cache.db 查不到 ⇒ 只严不松（落 B，仍要凭证）
  assert.equal(
    J({ oldEntry: D('f(flag)'), newEntry: D('f(renamed)'), actualSignature: null, sourceChanged: false, credential: 'none' }),
    'red|B|fail-no-credential',
  );
});

test('配对：同键按序、多出算单侧、不跨键配对', () => {
  const e = (p: string, s: string, sig: string, derived = true) => ({ path: p, symbol: s, signature: sig, derived });
  const cases: Array<[label: string, old: ReturnType<typeof e>[], next: ReturnType<typeof e>[], want: number]> = [
    ['没动 ⇒ 空清单', [e(REL, SYM, 'f(a)')], [e(REL, SYM, 'f(a)')], 0],
    ['改签名 ⇒ 1 条 changed', [e(REL, SYM, 'f(a)')], [e(REL, SYM, 'f(b)')], 1],
    ['新增 ⇒ 1 条 added', [], [e(REL, SYM, 'f(a)')], 1],
    ['删除 ⇒ 1 条 deleted', [e(REL, SYM, 'f(a)')], [], 1],
    ['跨键（path 不同）不许配对成 changed ⇒ 一删一增', [e('src/a.ts', SYM, 'f(a)')], [e('src/b.ts', SYM, 'f(a)')], 2],
  ];
  for (const [label, old, next, want] of cases) {
    const got = diffDerivedEntries(old, next);
    assert.equal(got.length, want, label);
  }
  assert.equal(diffDerivedEntries([e(REL, SYM, 'f(a)')], [e(REL, SYM, 'f(b)')])[0].kind, 'changed');
  assert.equal(diffDerivedEntries([e('src/a.ts', SYM, 'f(a)')], [e('src/b.ts', SYM, 'f(a)')])[0].kind, 'deleted');
  // 派生标志翻转（剥 provenance）也算改动 —— 否则删掉 notes 就逃出本门
  assert.equal(diffDerivedEntries([e(REL, SYM, 'f(a)', true)], [e(REL, SYM, 'f(a)', false)])[0].kind, 'changed');
});

// ────────────────────────────────────────────────────────────────
// 端到端夹具：真 cache.db + 真 git
// ────────────────────────────────────────────────────────────────
function tmpRoot(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `req-baseline-${tag}-`));
}

/** 建一个**真** cache.db：`files` 一行 + `file` 桩节点 + 一个函数节点（签名 = ACTUAL） */
function makeCacheDb(root: string): void {
  const dir = path.join(root, '.agent-io');
  fs.mkdirSync(dir, { recursive: true });
  const db = openDb(path.join(dir, 'cache.db'));
  try {
    const now = Date.now();
    db.prepare(
      `INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(REL, 'hash', 'typescript', 10, now, now, 2);
    db.prepare(
      `INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, signature, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(REL, 'file', 'x.ts', 'x.ts', REL, 'typescript', 1, 1, null, now);
    db.prepare(
      `INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, signature, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`${REL}#${SYM}`, 'function', SYM, SYM, REL, 'typescript', 1, 1, ACTUAL, now);
  } finally {
    db.close();
  }
}

interface Api {
  signature: string;
  notes?: string;
}
/** 一版设计册（最小可判形状：语义层 expected_apis + 几何层一个文件节点） */
function dslText(apis: Api[], extraExpectations: unknown[] = []): string {
  return JSON.stringify({
    id: 'fx',
    type: 'design',
    feature: 'fx',
    version: 1,
    title: '夹具',
    status: 'draft',
    geometry: {
      nodes: [
        {
          id: 'file_src_x_ts',
          label: 'x.ts',
          type: 'file',
          path: REL,
          decision: { summary: '夹具文件节点', expectations: extraExpectations },
        },
      ],
      edges: [],
    },
    semantic: { files: [{ id: 'file_src_x_ts', path: REL, responsibility: '夹具', expected_apis: apis }] },
  });
}

/** 一个装好 cache.db + git 的临时项目；返回它的根 */
function makeProject(tag: string, baseApis: Api[]): string {
  const root = tmpRoot(tag);
  makeCacheDb(root);
  fs.mkdirSync(path.join(root, '.agent-io', 'design'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'x.ts'), 'export function f(flag: boolean): void {}\n');
  writeDsl(root, baseApis);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}

function writeDsl(root: string, apis: Api[], extraExpectations: unknown[] = []): void {
  fs.writeFileSync(path.join(root, '.agent-io', 'design', 'fx.dsl.json'), dslText(apis, extraExpectations));
}

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} 失败：${r.stderr}`);
}

/** 跑门（`--range` 复现"某一次提交做了什么"，与 verify 用的是同一支脚本） */
function runGate(root: string, args: string[] = ['--range', 'HEAD~1..HEAD']): { code: number; out: string } {
  const r = spawnSync(process.execPath, [GATE, '--project', root, ...args], { encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('情形 A（只改册、源码不动）⇒ 必须红且点名', () => {
  const root = makeProject('a', [{ signature: 'f(flag)', notes: DERIVED }]);
  writeDsl(root, [{ signature: ACTUAL, notes: DERIVED }]); // 只改册
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', '只改册']);
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /\[情形 A\]/);
  assert.match(out, /src\/x\.ts/);
  assert.match(out, /情形 A（手改字面量冒充基线）/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('情形 A 的**禁形**：改回当前值的同时把 notes 删掉 ⇒ 仍必须红', () => {
  const root = makeProject('a-strip', [{ signature: 'f(flag)', notes: DERIVED }]);
  writeDsl(root, [{ signature: ACTUAL }]); // ★ 同时剥掉 provenance
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', '改回 + 删 notes']);
  const { code, out } = runGate(root);
  assert.equal(code, 1, out);
  assert.match(out, /\[情形 A\]/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('情形 C（册与对应源码同一提交都改）⇒ 放行，且读数里看得到', () => {
  const root = makeProject('c', [{ signature: 'f(flag)', notes: DERIVED }]);
  writeDsl(root, [{ signature: ACTUAL, notes: DERIVED }]);
  fs.writeFileSync(path.join(root, 'src', 'x.ts'), 'export function f(a: number): void {}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', '册 + 码']);
  const { code, out } = runGate(root);
  assert.equal(code, 0, out);
  assert.match(out, /情形 C 放行 1/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('情形 B（提升且无凭证）⇒ 红；补一条指名的 signature-matches ⇒ 绿', () => {
  const root = makeProject('b', [{ signature: ACTUAL, notes: DERIVED }]);
  writeDsl(root, [{ signature: 'f(renamed)', notes: DERIVED }]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', '提升无凭证']);
  const red = runGate(root);
  assert.equal(red.code, 1, red.out);
  assert.match(red.out, /\[情形 B\]/);

  // 同一改动 + 一条指名的 signature-matches（签名与改后一致）
  writeDsl(root, [{ signature: ACTUAL, notes: DERIVED }]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', '退回，准备带凭证的提升']);
  writeDsl(root, [{ signature: 'f(renamed)', notes: DERIVED }], [
    { kind: 'signature-matches', path: REL, symbol: SYM, signature: 'f(renamed)', why: '夹具：这条判据指名了该符号' },
  ]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', '提升 + 凭证']);
  const green = runGate(root);
  assert.equal(green.code, 0, green.out);
  assert.match(green.out, /有凭证 1/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('人写条目（两侧都无 provenance）⇒ 一概不判（进读数）', () => {
  const root = makeProject('human', [{ signature: 'f(flag)', notes: '人写的契约' }]);
  writeDsl(root, [{ signature: ACTUAL, notes: '人写的契约' }]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', '人写条目改值']);
  const { code, out } = runGate(root);
  assert.equal(code, 0, out);
  assert.match(out, /人写或非派生跳过 1/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('判不了 ≠ 通过：项目没有 cache.db ⇒ 退出码 2（不折成 0）', () => {
  const root = tmpRoot('nodb');
  fs.mkdirSync(path.join(root, '.agent-io', 'design'), { recursive: true });
  writeDsl(root, [{ signature: ACTUAL, notes: DERIVED }]);
  // ★ 先让它是个真 git 仓库：这样门才会走到"cache.db 缺"那一档（否则先撞 git 那一档）
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  const { code, out } = runGate(root, ['--range', 'HEAD..HEAD']);
  assert.equal(code, 2, out);
  assert.match(out, /cache\.db 不在/);
  fs.rmSync(root, { recursive: true, force: true });
});
