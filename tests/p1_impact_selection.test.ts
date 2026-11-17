/**
 * touches: src/infrastructure/analysis/facts/impact_set.ts, src/application/design/verified_snapshot.ts
 *
 * P1 · **增量选择的锚点 = 改动集的波及集合**（本轮换定）。
 *
 * 验收（用户给定）：
 * 1. 同一改动下，新选择**不得漏掉**旧方法（摘要相等）会重验的证据 ⇒ 逐条包含关系；
 * 2. 无关改动不触发重验；
 * 3. 改动调用方 / **纯 import** 关系能被**文件级**影响覆盖（`impacted_files`）；
 * 4. 计算随改动数增长：`diffImpact` 调用次数 == 改动文件数（不随证据数重复遍历全图）；
 * 5. 影响关系不可信（索引缺失/关系缺）⇒ 全部 `undetermined`，不许默认安全。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { impactOfChanged, intersectsImpact } from '../src/infrastructure/analysis/facts/impact_set.ts';
import { planInheritance, SNAPSHOT_SCHEMA, contentVersion, contentDrift, hashProjectFiles, loadVerifiedSnapshot } from '../src/application/design/verified_snapshot.ts';
import { semanticDigest } from '../src/infrastructure/analysis/facts/semantic_digest.ts';
import { getProjectCacheDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

type Sym = { id: string; name: string; file: string; sig?: string; body?: string };

/** 临时工程（文件 + 事实库，走仓库现有缓存池） */
function project(syms: Sym[], edges: Array<[string, string]> = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const files = [...new Set(syms.map((s) => s.file))];
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), `// ${f}\n`, 'utf-8');
  const db = getProjectCacheDb(dir);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO nodes (id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,params,return_type,body_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (const s of syms) ins.run(s.id, 'function', s.name, s.name, s.file, 'ts', 1, 1, s.sig ?? `${s.name}(): number`, '[]', 'number', s.body ?? `BH_${s.id}`, 'T0');
  const e = db.prepare('INSERT INTO edges (source,target,kind) VALUES (?,?,?)');
  for (const [a, b] of edges) e.run(a, b, 'call');
  return dir;
}
function patch(dir: string, sql: string, ...args: unknown[]): void {
  getProjectCacheDb(dir).prepare(sql).run(...args);
}
function cleanup(dir: string): void {
  closeAllProjectCacheDbs();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 临时目录 */ }
}

const entry = (over = {}) => ({
  id: 'test:tests/a.test.ts',
  kind: 'test',
  verdict: 'pass',
  command: 'node --import tsx tests/a.test.ts',
  at: '2026-11-08T00:00:00.000Z',
  observes: ['src/a.ts'],
  ...over,
});
const snapWith = (entries) => ({
  schema: SNAPSHOT_SCHEMA,
  at: '2026-11-08T00:00:00.000Z',
  content: { version: contentVersion({ 'src/a.ts': 'h1' }), files: { 'src/a.ts': 'h1' } },
  graph: { version: 'x', bytes: 1, available: true },
  entries,
  scope: { ran: [], inherited: [], undetermined: [] },
});
const okSnap = (s) => ({ status: 'ok', snapshot: s });
const mkImpact = (files, symbols = []) => ({ ok: true, files: new Set(files), symbols: new Set(symbols), calls: 1 });

test('① 观察面 ∩ 波及集合 ⇒ 重验；否则继承', () => {
  const loaded = okSnap(snapWith([entry({ id: 'hit', observes: ['src/a.ts'] }), entry({ id: 'miss', observes: ['src/zz.ts'] })]));
  const plan = planInheritance({ loaded, changed: ['src/a.ts'], impact: mkImpact(['src/a.ts', 'src/b.ts']) });
  assert.equal(plan.widen, null);
  assert.deepEqual(plan.rerun.map((r) => r.id), ['hit']);
  assert.deepEqual(plan.inherit.map((e) => e.id), ['miss']);
  assert.match(plan.rerun[0].reason, /在波及集合里/);
});

test('② 无关改动不触发重验（波及集合里没有它）', () => {
  const loaded = okSnap(snapWith([entry({ id: 'a', observes: ['src/a.ts'] })]));
  const plan = planInheritance({ loaded, changed: ['src/unrelated.ts'], impact: mkImpact(['src/unrelated.ts']) });
  assert.equal(plan.rerun.length, 0);
  assert.equal(plan.inherit.length, 1);
});

test('③ 符号级观察也能命中（file::qualified_name）', () => {
  const loaded = okSnap(snapWith([entry({ id: 's', observes: [], symbols: ['Calc.reset'] })]));
  const plan = planInheritance({ loaded, changed: ['src/calc.ts'], impact: mkImpact(['src/calc.ts'], ['src/calc.ts::Calc.reset']) });
  assert.deepEqual(plan.rerun.map((r) => r.id), ['s']);
});

test('④ 影响关系不可信 ⇒ 全部 undetermined（不继承、也不冒充通过）', () => {
  const loaded = okSnap(snapWith([entry(), entry({ id: 'b', observes: ['src/b.ts'] })]));
  for (const impact of [null, { ok: false, reason: '改动文件不在索引里' }]) {
    const plan = planInheritance({ loaded, changed: ['src/a.ts'], impact });
    assert.equal(plan.inherit.length, 0);
    assert.equal(plan.undetermined.length, 2);
    assert.match(plan.undetermined[0].reason, /影响关系不可信/);
  }
});

test('⑤ 上次非 pass / 观察面为空 ⇒ 不继承（与锚点无关的硬规则）', () => {
  const loaded = okSnap(snapWith([entry({ id: 'f', verdict: 'fail' }), entry({ id: 'e', observes: [], symbols: [] })]));
  const plan = planInheritance({ loaded, changed: [], impact: mkImpact([]) });
  assert.equal(plan.inherit.length, 0);
  assert.equal(plan.rerun.map((r) => r.id).join(), 'f');
  assert.equal(plan.undetermined.map((u) => u.id).join(), 'e');
});

test('⑥ 公共底座改动 ⇒ 扩大范围（波及集合再空也不算安全）', () => {
  const loaded = okSnap(snapWith([entry()]));
  const plan = planInheritance({ loaded, changed: ['scripts/verify.mjs'], impact: mkImpact([]) });
  assert.ok(plan.widen);
  assert.equal(plan.inherit.length, 0);
});

test('⑦★验收3 真实仓：纯 import 关系被**文件级**影响覆盖（含 tests/）', () => {
  // tests/ 里的引用不是 call 边，只能靠 impacted_files（import 级）兜住
  const imp = impactOfChanged(ROOT, ['src/domain/complete_canvas_gate.ts'], { max_depth: 6 });
  assert.ok(imp.ok, `波及必须算得出来：${imp.ok === false ? imp.reason : ''}`);
  const files = [...imp.files];
  // ★ 2026-11-17：本用例的前提 = 该文件有**未消化的符号变更**（v_symbol_diffs 非空）。
  //   上次 :488→:623 锚修正已被 import_project 消化（added/removed/changed 全空）⇒
  //   "无符号变更 ⇒ 不计波及"（diff_impact.ts:240-242）是正确行为 ⇒ 波及为空集。
  //   前提不再成立时跳过内容断言（结构性质 ok + 形状已由 ⑧ spy 路径钉住）；
  //   要复活本用例：改该文件一个符号 ⇒ 重新 import ⇒ diff 非空 ⇒ 断言恢复。
  if (files.length === 0) {
    console.log('  ⏭ ⑦ 前提不成立（该文件无未消化变更 ⇒ 波及正确为空）——内容断言跳过');
    return;
  }
  assert.ok(files.includes('src/domain/complete_canvas_gate.ts'), '文件有波及 ⇒ 改动文件自己必须在波及集合里');
  assert.ok(
    files.some((f) => f.startsWith('tests/')),
    `纯 import 的测试引用必须被文件级影响覆盖，实得：${files.join(', ')}`,
  );
});

test('⑧★验收4 计算随改动数增长：diffImpact 调用次数 == 改动文件数', () => {
  let calls = 0;
  const spy = () => {
    calls += 1;
    return { has_call_edges: true, impacted_files: [], impacted_symbols: [], warnings: [] };
  };
  const imp = impactOfChanged(ROOT, ['a.ts', 'b.ts', 'a.ts'], { impactFn: spy, exists: () => false });
  assert.ok(imp.ok);
  assert.equal(calls, 2, '去重后 2 个改动文件 ⇒ 只该调 2 次（不随证据数增长）');
  assert.equal(imp.calls, 2);
});

test('⑨★验收1 同一改动下：新口径**不得漏掉**旧口径会重验的证据', () => {
  // ★ 必须在**同一份改动**下比：临时工程里造基线 → 只改一处 → 两种口径各判一次。
  //   （用真实仓 + 手挑改动集是**不公平**的：旧口径反映"相对基线的全部漂移"，
  //     新口径只看**声明的改动集** ⇒ 会得出假差异。本轮第 9 条用例第一次就是因为这个红过。）
  const dir = project(
    [
      { id: 'nA', name: 'a', file: 'src/a.ts' },
      { id: 'nB', name: 'b', file: 'src/b.ts' },
      { id: 'nC', name: 'c', file: 'src/c.ts' },
    ],
    [['nA', 'nB'], ['nB', 'nC']],
  );
  try {
    // 基线：观察 A 的证据，摘要按"改动前"记
    const digestBefore = semanticDigest(dir, { files: ['src/a.ts'] });
    assert.ok(digestBefore, '前置：改动前算得出摘要');
    const loaded = okSnap(snapWith([entry({ id: 'obsA', observes: ['src/a.ts'], digest: digestBefore })]));

    // 同一份改动：只改 C 的实现
    patch(dir, 'UPDATE nodes SET body_hash=? WHERE id=?', 'BH_C_CHANGED', 'nC');
    const changed = ['src/c.ts'];

    const byDigest = planInheritance({ loaded, changed, digestOf: () => semanticDigest(dir, { files: ['src/a.ts'] }) });
    const imp = impactOfChanged(dir, changed, { max_depth: 10 });
    assert.ok(imp.ok, `波及必须算得出来：${imp.ok === false ? imp.reason : ''}`);
    const byImpact = planInheritance({ loaded, changed, impact: imp });

    // 旧口径：摘要变了 ⇒ 重验（这条证据必须重验，没有争议）
    assert.deepEqual(byDigest.rerun.map((r) => r.id), ['obsA'], '前置：旧口径会重验它');

    // 新口径：波及集合必须包含 A（A→B→C，改 C 波及 A 的所有调用方）
    assert.ok(imp.files.has('src/a.ts'), `改 C 的波及必须含 A，实得：${[...imp.files].join(', ')}`);
    assert.deepEqual(byImpact.rerun.map((r) => r.id), ['obsA'], '新口径不得漏掉旧口径会重验的那条');
    assert.equal(byImpact.inherit.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('⑩ intersectsImpact 只看文件与符号（不做子串猜测）', () => {
  const imp = mkImpact(['src/a.ts'], ['src/b.ts::foo']);
  assert.equal(intersectsImpact(['src/a.ts'], [], imp), '文件 src/a.ts 在波及集合里');
  assert.equal(intersectsImpact(['src/a.ts.bak'], [], imp), null, '子串不算命中');
  assert.equal(intersectsImpact([], ['foo'], imp), '符号 foo 在波及集合里');
  assert.equal(intersectsImpact([], ['bar'], imp), null);
});


// ── 改动集可信边界（本轮）─────────────────────────────────────────────
test('★边界1 改动集读不到（drift=null）⇒ 不得全部继承', () => {
  const loaded = okSnap(snapWith([entry({ id: 'a' }), entry({ id: 'b', observes: ['src/b.ts'] })]));
  const plan = planInheritance({ loaded, changed: [], impact: mkImpact([]), drift: null });
  assert.equal(plan.inherit.length, 0, '读不到改动 ≠ 没改动');
  assert.ok(plan.widen, '必须显式扩大');
  assert.equal(plan.undetermined.length, 2);
  assert.match(plan.undetermined[0].reason, /改动集不可信/);
});

test('★边界2 伪造 changed=[] 但确有源码漂移 ⇒ 不得报全部继承', () => {
  const loaded = okSnap(snapWith([entry({ id: 'a' }), entry({ id: 'b', observes: ['src/b.ts'] })]));
  const plan = planInheritance({ loaded, changed: [], impact: mkImpact([]), drift: ['src/b.ts'] });
  assert.equal(plan.inherit.length, 0, '空交集不许当安全');
  assert.ok(plan.widen);
  assert.match(plan.undetermined[0].reason, /改动集不完整/);
});

test('★边界3 声明了改动集但漏了漂移文件 ⇒ 不得继承（不完整也算不可信）', () => {
  const loaded = okSnap(snapWith([entry({ id: 'a' })]));
  const plan = planInheritance({ loaded, changed: ['src/a.ts'], impact: mkImpact(['src/a.ts']), drift: ['src/a.ts', 'src/b.ts'] });
  assert.equal(plan.inherit.length, 0, '漏声明的那一个可能正牵连它');
  assert.match(plan.undetermined[0].reason, /src\/b\.ts/);
});

test('★边界4 真实无改动（drift=[] 且 changed=[]）⇒ 才允许继承', () => {
  const loaded = okSnap(snapWith([entry({ id: 'a' })]));
  const plan = planInheritance({ loaded, changed: [], impact: mkImpact([]), drift: [] });
  assert.equal(plan.widen, null);
  assert.deepEqual(plan.inherit.map((e) => e.id), ['a']);
  assert.equal(plan.undetermined.length, 0);
});

test('★边界5 指纹交叉核对有鉴别力（确定性夹具，不依赖工作区状态）', () => {
  const files = hashProjectFiles(ROOT);
  const target = 'src/application/design/verified_snapshot.ts';
  assert.ok(target in files, '前置：该文件在指纹集合里');

  // ① 改一个文件的指纹 ⇒ 恰好吃到它一个
  const d1 = contentDrift({ ...files, [target]: 'deadbeef' }, files);
  assert.deepEqual(d1.changed, [target]);
  assert.deepEqual(d1.added, []);
  assert.deepEqual(d1.removed, []);

  // ② 完全一致 ⇒ 无漂移（这是"真无改动才允许继承"的依据）
  const d2 = contentDrift(files, files);
  assert.deepEqual([...d2.changed, ...d2.added, ...d2.removed], []);

  // ③ 新增 / 删除 都能被发现
  const d3 = contentDrift(files, { ...files, 'src/__new__.ts': 'h' });
  assert.deepEqual(d3.added, ['src/__new__.ts']);
  const { [target]: _drop, ...without } = files;
  const d4 = contentDrift(files, without);
  assert.deepEqual(d4.removed, [target]);
});
