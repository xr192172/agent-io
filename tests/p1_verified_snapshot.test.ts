/**
 * touches: src/application/design/verified_snapshot.ts, src/infrastructure/analysis/facts/semantic_digest.ts
 *
 * ★ 这一行让**增量验证**能把这支测试归因到被改的文件（没它 ⇒ 只能进"未声明"，永远不会被自动选中）。
 *
 * P1 · **VerifiedSnapshot** 的语义摘要（含**跨文件传递依赖**）。
 *
 * 本轮新增：复用 `diffImpact(direction:'callees')` 的反向闭包口径（**不新建第二套影响图**），
 * 把观察对象的传递依赖（符号签名 / 返回类型 / body_hash）纳入摘要。
 *
 * 验收（用户给定）：
 * 1. A→B→C，只改 C 的相关行为/签名 ⇒ 观察 A 的证据失效并重验；
 * 2. 只重算索引、关系与内容不变 ⇒ 摘要不变，基线继续可用；
 * 3. 改无关模块 ⇒ 不扩大验证范围；
 * 4. 反向闭包缺失 / 索引不可用 ⇒ `null` ⇒ undetermined，不继承；
 * 5. 局部基线仍标 partial。
 *
 * ★ 测试用**仓库现有的缓存池**（`getProjectCacheDb`）建临时工程 ——
 *   与本轮实现同一条驱动路径（踩过双驱动 → `database disk image is malformed`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SNAPSHOT_SCHEMA,
  contentVersion,
  hashProjectFiles,
  loadVerifiedSnapshot,
  planInheritance,
  summarizeScope,
  writeVerifiedSnapshot,
} from '../src/application/design/verified_snapshot.ts';
import { semanticDigest } from '../src/infrastructure/analysis/facts/semantic_digest.ts';
import { getProjectCacheDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ── 临时工程：文件 + 事实库（nodes / edges）──────────────────────────
type Sym = { id: string; name: string; file: string; sig?: string; body?: string };

function project(syms: Sym[], edges: Array<[string, string]> = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsd-'));
  const files = [...new Set(syms.map((s) => s.file))];
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), `// ${f}\n`, 'utf-8');
  // 无关但存在的模块（用于"改无关模块 ⇒ 不扩大"）
  fs.writeFileSync(path.join(dir, 'src/zz_unrelated.ts'), 'export const z = 1;\n', 'utf-8');

  const db = getProjectCacheDb(dir);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO nodes (id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,params,return_type,body_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (const s of syms) {
    ins.run(s.id, 'function', s.name, s.name, s.file, 'ts', 1, 1, s.sig ?? `${s.name}(): number`, '[]', 'number', s.body ?? `BH_${s.id}`, 'T0');
  }
  const e = db.prepare('INSERT INTO edges (source,target,kind) VALUES (?,?,?)');
  for (const [a, b] of edges) e.run(a, b, 'call');
  return dir;
}

function patch(dir: string, sql: string, ...args: unknown[]): void {
  getProjectCacheDb(dir).prepare(sql).run(...args);
}

function cleanup(dir: string): void {
  closeAllProjectCacheDbs();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 上偶尔句柄未释放，忽略（临时目录） */
  }
}

const entry = (over = {}) => ({
  id: 'test:tests/a.test.ts',
  kind: 'test',
  verdict: 'pass',
  command: 'node --import tsx tests/a.test.ts',
  at: '2026-11-08T00:00:00.000Z',
  observes: ['src/a.ts'],
  digest: 'D1',
  ...over,
});
const snapWith = (entries) => ({
  schema: SNAPSHOT_SCHEMA,
  at: '2026-11-08T00:00:00.000Z',
  content: { version: contentVersion({ 'src/a.ts': 'h1' }), files: { 'src/a.ts': 'h1' } },
  graph: { version: 'IGNORED', bytes: 1, available: true },
  entries,
  scope: { ran: [], inherited: [], undetermined: [] },
});
const ok = (s) => ({ status: 'ok', snapshot: s });
const fixed = (d) => () => d;

// ── 纯决策（不碰 DB）────────────────────────────────────────────────
test('① 无改动 ⇒ 全继承', () => {
  const plan = planInheritance({ loaded: ok(snapWith([entry()])), changed: [], digestOf: fixed('D1') });
  assert.equal(plan.widen, null);
  assert.equal(plan.inherit.length, 1);
});

test('② 改被观察的文件 ⇒ 只它重验', () => {
  const plan = planInheritance({
    loaded: ok(snapWith([entry({ id: 'a', observes: ['src/a.ts'], digest: 'DA' }), entry({ id: 'b', observes: ['src/b.ts'], digest: 'DB' })])),
    changed: ['src/b.ts'],
    digestOf: (e) => (e.id === 'a' ? 'DA' : 'DB2'),
  });
  assert.equal(plan.inherit.map((e) => e.id).join(), 'a');
  assert.equal(plan.rerun.map((r) => r.id).join(), 'b');
});

test('③ 改公共底座/验证规则 ⇒ 范围扩大', () => {
  for (const f of ['scripts/verify.mjs', 'scripts/verify-changed.mjs', 'scripts/run-tests.mjs', 'scripts/judge-all.mjs', 'package.json', 'tsconfig.json', 'src/domain/expectation_kinds.ts']) {
    const plan = planInheritance({ loaded: ok(snapWith([entry()])), changed: [f], digestOf: fixed('D1') });
    assert.ok(plan.widen, `${f} 变了必须扩大范围`);
    assert.equal(plan.inherit.length, 0);
  }
});

test('④ 基线损坏 / 缺失 ⇒ 不得继承', () => {
  assert.ok(planInheritance({ loaded: { status: 'corrupt', reason: '指纹不符' }, changed: [], digestOf: fixed('D1') }).widen);
  assert.ok(planInheritance({ loaded: { status: 'missing', reason: '无文件' }, changed: [], digestOf: fixed('D1') }).widen);
});

test('⑤ 上次 fail / unsupported / pending ⇒ 不得继承为 pass', () => {
  const plan = planInheritance({
    loaded: ok(snapWith([entry({ id: 'f', verdict: 'fail' }), entry({ id: 'u', verdict: 'unsupported' }), entry({ id: 'p', verdict: 'pending' })])),
    changed: [],
    digestOf: fixed('D1'),
  });
  assert.equal(plan.inherit.length, 0);
  assert.equal(plan.rerun.length, 3);
});

test('⑥⑦ 观察面为空 / 摘要缺失或算不出 ⇒ undetermined', () => {
  const empty = planInheritance({ loaded: ok(snapWith([entry({ observes: [], symbols: [] })])), changed: ['src/x.ts'], digestOf: fixed('D1') });
  assert.equal(empty.inherit.length, 0);
  const noDigest = planInheritance({ loaded: ok(snapWith([entry({ digest: null })])), changed: [], digestOf: fixed('D1') });
  assert.equal(noDigest.inherit.length, 0);
  const cannot = planInheritance({ loaded: ok(snapWith([entry()])), changed: [], digestOf: () => null });
  assert.match(cannot.undetermined[0].reason, /算不出/);
});

// ── 语义摘要（真临时工程 + 现有缓存池）──────────────────────────────
test('★验收1 A→B→C：只改 C 的行为/签名 ⇒ 观察 A 的摘要必变', () => {
  const dir = project(
    [
      { id: 'nA', name: 'a', file: 'src/a.ts' },
      { id: 'nB', name: 'b', file: 'src/b.ts' },
      { id: 'nC', name: 'c', file: 'src/c.ts' },
    ],
    [['nA', 'nB'], ['nB', 'nC']],
  );
  try {
    const d1 = semanticDigest(dir, { files: ['src/a.ts'] });
    assert.ok(d1, '摘要必须算得出来');

    patch(dir, 'UPDATE nodes SET body_hash=? WHERE id=?', 'BH_C_v2', 'nC'); // 只改 C 的实现
    const d2 = semanticDigest(dir, { files: ['src/a.ts'] });
    assert.notEqual(d2, d1, 'C 的**行为**变了，观察 A 的摘要必须变');

    patch(dir, 'UPDATE nodes SET signature=? WHERE id=?', 'c(x: number): number', 'nC'); // 再改 C 的签名
    const d3 = semanticDigest(dir, { files: ['src/a.ts'] });
    assert.notEqual(d3, d2, 'C 的**签名**变了，观察 A 的摘要必须变');
  } finally {
    cleanup(dir);
  }
});

test('★验收2 只重算索引（时间戳/行号变，事实不变）⇒ 摘要不变，基线继续可用', () => {
  const dir = project(
    [
      { id: 'nA', name: 'a', file: 'src/a.ts' },
      { id: 'nB', name: 'b', file: 'src/b.ts' },
    ],
    [['nA', 'nB']],
  );
  try {
    const d1 = semanticDigest(dir, { files: ['src/a.ts'] });
    patch(dir, "UPDATE nodes SET updated_at=? WHERE id IN ('nA','nB')", 'T_REINDEXED');
    patch(dir, "UPDATE nodes SET start_line=99, end_line=120 WHERE id IN ('nA','nB')");
    const d2 = semanticDigest(dir, { files: ['src/a.ts'] });
    assert.equal(d2, d1, '重算索引不得改变语义摘要');

    const plan = planInheritance({
      loaded: ok(snapWith([entry({ observes: ['src/a.ts'], digest: d1 })])),
      changed: [],
      digestOf: () => semanticDigest(dir, { files: ['src/a.ts'] }),
    });
    assert.equal(plan.widen, null);
    assert.equal(plan.inherit.length, 1, '事实没变 ⇒ 基线继续可用');
  } finally {
    cleanup(dir);
  }
});

test('★验收3 改无关模块 ⇒ 摘要不变、不扩大验证范围', () => {
  const dir = project(
    [
      { id: 'nA', name: 'a', file: 'src/a.ts' },
      { id: 'nDep', name: 'dep', file: 'src/dep.ts' },
      { id: 'nU', name: 'zz', file: 'src/zz_unrelated.ts' },
    ],
    // ★ 必须有一条调用边，否则"闭包不可用 ⇒ null"（见验收 4），这里要测的是"无关模块不牵动"
    [['nA', 'nDep']],
  );
  try {
    const d1 = semanticDigest(dir, { files: ['src/a.ts'] });
    patch(dir, 'UPDATE nodes SET body_hash=? WHERE id=?', 'BH_U_v2', 'nU');
    fs.writeFileSync(path.join(dir, 'src/zz_unrelated.ts'), 'export const z = 2;\n', 'utf-8');
    const d2 = semanticDigest(dir, { files: ['src/a.ts'] });
    assert.equal(d2, d1, '无关模块变了，观察 A 的摘要不该动');

    const plan = planInheritance({
      loaded: ok(snapWith([entry({ observes: ['src/a.ts'], digest: d1 })])),
      changed: ['src/zz_unrelated.ts'],
      digestOf: () => semanticDigest(dir, { files: ['src/a.ts'] }),
    });
    assert.equal(plan.widen, null, '无关改动不得扩大');
    assert.equal(plan.inherit.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('★验收4 闭包不可用（无索引 / 无调用边）⇒ 摘要为 null ⇒ undetermined', () => {
  // ① 完全没有 cache.db
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'vsd-bare-'));
  fs.mkdirSync(path.join(bare, 'src'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'src/a.ts'), 'export const a = 1;\n', 'utf-8');
  try {
    assert.equal(semanticDigest(bare, { files: ['src/a.ts'] }), null, '无事实库 ⇒ 算不出摘要');
    const plan = planInheritance({
      loaded: ok(snapWith([entry()])),
      changed: [],
      digestOf: () => semanticDigest(bare, { files: ['src/a.ts'] }),
    });
    assert.equal(plan.inherit.length, 0);
    assert.match(plan.undetermined[0].reason, /算不出/);
  } finally {
    cleanup(bare);
  }

  // ② 有库但没有调用边 ⇒ 传递依赖无从判断 ⇒ null
  const dir = project([{ id: 'nA', name: 'a', file: 'src/a.ts' }], []);
  try {
    assert.equal(semanticDigest(dir, { files: ['src/a.ts'] }), null, '没有调用边 ⇒ 闭包不可用 ⇒ null');
  } finally {
    cleanup(dir);
  }
});

test('★验收5 局部基线仍标 partial，不冒充全仓', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsd-scope-'));
  try {
    const snap = snapWith([entry()]);
    snap.scope = { ran: ['test:tests/a.test.ts'], inherited: [], undetermined: [], partial: true, covered_files: ['src/a.ts'] };
    writeVerifiedSnapshot(dir, snap);
    const back = loadVerifiedSnapshot(dir);
    assert.equal(back.status, 'ok');
    assert.equal(back.snapshot.scope.partial, true);
    assert.match(summarizeScope(back.snapshot.scope), /局部/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('⑧ 真实仓：摘要可用且稳定；**永不饱和的文件如实判 null**', () => {
  // 用一个深度内会饱和的文件（多数文件如此）
  const saturating = 'src/infrastructure/analysis/health/wiring_ledger.ts';
  const d1 = semanticDigest(ROOT, { files: [saturating] });
  const d2 = semanticDigest(ROOT, { files: [saturating] });
  assert.ok(d1, '真实仓里饱和的文件必须算得出摘要');
  assert.equal(d2, d1, '同一状态两次必须逐字相同');

  // ★ 反例：本项目里 semantic_digest.ts 的闭包到 depth 16 仍在长 ⇒ **永远判不了**
  //   （这不是 bug，是"截断不许当完整"的代价；如实返回 null 而不是给一个残缺摘要）
  const neverSaturates = 'src/infrastructure/analysis/facts/semantic_digest.ts';
  assert.equal(
    semanticDigest(ROOT, { files: [neverSaturates] }),
    null,
    '闭包不饱和 ⇒ 必须 null（若这里变成非 null，说明"截断当完整"又被放回来了）',
  );
});

test('⑨ 真实仓：基线四件齐全（内容指纹 / 条目带命令与时点）', () => {
  const files = hashProjectFiles(ROOT);
  assert.ok(Object.keys(files).length > 100);
  assert.equal(contentVersion(files), contentVersion({ ...files }));
  const loaded = loadVerifiedSnapshot(ROOT);
  if (loaded.status === 'ok') {
    assert.ok(loaded.snapshot.entries.length > 0);
    for (const e of loaded.snapshot.entries) {
      assert.ok(e.command.length > 0 && e.at.length > 0);
    }
  } else {
    assert.ok(loaded.reason.length > 0, '没有基线也必须说得出来');
  }
});



// ── 完整性边界（本轮新增：越界与截断都必须是"判不了"，不许当完整）──────
test('★反例A max_symbols 越界 ⇒ null ⇒ undetermined（不把截断当完整）', () => {
  // 造 8 个符号、7 条调用边（闭包 ≥ 7），再把上限压到 3
  const syms = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, name: `f${i}`, file: `src/f${i}.ts` }));
  const edges = [];
  for (let i = 0; i < 7; i++) edges.push([`n${i}`, `n${i + 1}`]);
  const dir = project(syms, edges);
  try {
    // 先把上限放大，证明这个工程本来算得出来（否则下一条断言没有鉴别力）
    const okBig = semanticDigest(dir, { files: ['src/f0.ts'], closure: { max_symbols: 50, max_depth: 10 } });
    assert.ok(okBig, '上限足够时必须算得出来（否则下面的 null 说明不了问题）');

    const overflow = semanticDigest(dir, { files: ['src/f0.ts'], closure: { max_symbols: 3 } });
    assert.equal(overflow, null, '闭包超过 max_symbols ⇒ 必须判 null（不许截断后当完整）');

    const plan = planInheritance({
      loaded: ok(snapWith([entry({ observes: ['src/f0.ts'], digest: okBig })])),
      changed: [],
      digestOf: () => semanticDigest(dir, { files: ['src/f0.ts'], closure: { max_symbols: 3 } }),
    });
    assert.equal(plan.inherit.length, 0, '越界那条不得被继承为 pass');
    assert.match(plan.undetermined[0].reason, /算不出/);
  } finally {
    cleanup(dir);
  }
});

test('★反例B 依赖链超过 max_depth ⇒ null ⇒ 不继承（链尾改了也不许仍 pass）', () => {
  // A→B→C→D（3 跳）
  const dir = project(
    [
      { id: 'nA', name: 'a', file: 'src/a.ts' },
      { id: 'nB', name: 'b', file: 'src/b.ts' },
      { id: 'nC', name: 'c', file: 'src/c.ts' },
      { id: 'nD', name: 'd', file: 'src/d.ts' },
    ],
    [['nA', 'nB'], ['nB', 'nC'], ['nC', 'nD']],
  );
  try {
    // 深度足够 ⇒ 算得出来（链尾在摘要里）
    const deep = semanticDigest(dir, { files: ['src/a.ts'], closure: { max_depth: 10 } });
    assert.ok(deep);

    // 深度只到 2 ⇒ 链尾 D 被切断 ⇒ 必须判 null（不能"没看见就说没变"）
    const shallow = semanticDigest(dir, { files: ['src/a.ts'], closure: { max_depth: 2 } });
    assert.equal(shallow, null, '深度截断 ⇒ 必须 null（不许当完整）');

    // 改链尾 D 的事实：浅闭包仍然 null ⇒ 绝不继承为 pass
    patch(dir, 'UPDATE nodes SET body_hash=? WHERE id=?', 'BH_D_CHANGED', 'nD');
    const afterTail = semanticDigest(dir, { files: ['src/a.ts'], closure: { max_depth: 2 } });
    assert.equal(afterTail, null, '链尾变了也还是判不了（而不是"没变"）');

    const plan = planInheritance({
      loaded: ok(snapWith([entry({ observes: ['src/a.ts'], digest: deep })])),
      changed: [],
      digestOf: () => semanticDigest(dir, { files: ['src/a.ts'], closure: { max_depth: 2 } }),
    });
    assert.equal(plan.inherit.length, 0, '**绝不能**因为"没看见链尾"就继承为 pass');
    assert.ok(plan.undetermined.length > 0);
  } finally {
    cleanup(dir);
  }
});

test('★反例C 深度足够时链尾变了 ⇒ 摘要变 ⇒ 失效重验（与 B 互为对照）', () => {
  const dir = project(
    [
      { id: 'nA', name: 'a', file: 'src/a.ts' },
      { id: 'nB', name: 'b', file: 'src/b.ts' },
      { id: 'nC', name: 'c', file: 'src/c.ts' },
      { id: 'nD', name: 'd', file: 'src/d.ts' },
    ],
    [['nA', 'nB'], ['nB', 'nC'], ['nC', 'nD']],
  );
  try {
    const before = semanticDigest(dir, { files: ['src/a.ts'], closure: { max_depth: 10 } });
    patch(dir, 'UPDATE nodes SET signature=? WHERE id=?', 'd(x: number): void', 'nD');
    const after = semanticDigest(dir, { files: ['src/a.ts'], closure: { max_depth: 10 } });
    assert.ok(before && after);
    assert.notEqual(after, before, '链尾签名变了，观察链首的摘要必须变');

    const plan = planInheritance({
      loaded: ok(snapWith([entry({ observes: ['src/a.ts'], digest: before })])),
      changed: [],
      digestOf: () => semanticDigest(dir, { files: ['src/a.ts'], closure: { max_depth: 10 } }),
    });
    assert.equal(plan.inherit.length, 0);
    assert.match(plan.rerun[0].reason, /语义摘要/);
  } finally {
    cleanup(dir);
  }
});
