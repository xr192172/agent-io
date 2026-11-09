/**
 * touches: src/application/design/verified_snapshot.ts
 *
 * P1 · **"没有证据" ≠ "没有问题"**（本轮唯一的规则）。
 *
 * 真实事故：`import_project` 默认不吃测试文件（`include_tests=false`）⇒ 基线 0 条证据
 * ⇒ 旧的逐条循环"无条目可判" ⇒ 输出读起来像全绿。**检查对象退出检查范围，检查就自动变绿。**
 *
 * 本文件把四种"看起来都像通过"的情形分开：
 *   no-change（真没改动）· no-work（本来没对象）· no-evidence（有对象无证据）· empty-observes（有证据没观察面）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  SNAPSHOT_SCHEMA,
  contentVersion,
  hashProjectFiles,
  loadVerifiedSnapshot,
  planInheritance,
  writeVerifiedSnapshot,
} from '../src/application/design/verified_snapshot.ts';
import { getProjectCacheDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db.ts';
import { scanTestObjects, testObjectVisibility } from '../src/application/design/verified_snapshot.ts';

type Opts = { tests?: string[]; entries?: Array<{ id: string; observes: string[] }> };

/** 造一个自带索引与基线的小工程 */
function makeProj(opts: Opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noev-'));
  const w = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf-8');
  };
  w('src/a.ts', 'export function a(): number { return 1; }\n');
  w('src/u.ts', 'export const u = 1;\n');
  const tests = opts.tests ?? [];
  for (const t of tests) w(t, "// touches: src/a.ts\nimport { test } from 'node:test';\ntest('x', () => {});\n");

  const db = getProjectCacheDb(dir);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO nodes (id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,params,return_type,body_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  ins.run('nA', 'function', 'a', 'a', 'src/a.ts', 'ts', 1, 1, 'a(): number', '[]', 'number', 'BH_A', 'T0');
  ins.run('nU', 'const', 'u', 'u', 'src/u.ts', 'ts', 1, 1, 'u', '[]', 'number', 'BH_U', 'T0');

  // 基线：entries 可空（= 证据缺失）
  const files = hashProjectFiles(dir);
  writeVerifiedSnapshot(dir, {
    schema: SNAPSHOT_SCHEMA,
    at: new Date().toISOString(),
    content: { version: contentVersion(files), files },
    graph: { version: 'n/a', bytes: 0, available: true },
    entries: (opts.entries ?? []).map((e) => ({
      id: e.id,
      kind: 'test' as const,
      verdict: 'pass' as const,
      command: `run ${e.id}`,
      at: new Date().toISOString(),
      observes: e.observes,
    })),
    scope: { ran: [], inherited: [], undetermined: [], partial: true },
  });

  return {
    dir,
    loaded: loadVerifiedSnapshot(dir),
    dispose: () => {
      closeAllProjectCacheDbs();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 临时目录 */
      }
    },
  };
}

const mkImpact = (files: string[]) => ({
  ok: true as const,
  files: new Set(files),
  symbols: new Set<string>(),
  calls: 1,
  non_code: [] as string[],
});

test('① 对象存在但证据为空（索引未收测试）⇒ no-evidence：不继承、显式扩大、点名"测试未纳入事实"', () => {
  const p = makeProj({ tests: ['tests/a.test.ts', 'tests/b.test.ts'], entries: [] });
  try {
    const plan = planInheritance({
      loaded: p.loaded,
      changed: ['src/a.ts'],
      impact: mkImpact(['src/a.ts']),
      drift: ['src/a.ts'],
      evidence: { objects_on_disk: 2, objects_indexed: 0, label: '测试文件' },
    });
    assert.equal(plan.state, 'no-evidence', `必须是 no-evidence，实得 ${plan.state}`);
    assert.equal(plan.inherit.length, 0, '**一条都不许继承**');
    assert.ok(plan.widen, '必须显式扩大验证');
    assert.equal(plan.undetermined.length, 1);
    assert.match(plan.undetermined[0].reason, /一条证据都没有/);
    assert.match(String(plan.note), /测试未纳入事实/, `note 必须点名测试未纳入事实，实得 ${plan.note}`);
  } finally {
    p.dispose();
  }
});

test('② 证据有效 ⇒ 正常判定（相交重验 / 不相交继承），且状态是 plan', () => {
  const p = makeProj({
    tests: ['tests/a.test.ts'],
    entries: [
      { id: 'test:tests/a.test.ts', observes: ['src/a.ts'] },
      { id: 'test:tests/u.test.ts', observes: ['src/u.ts'] },
    ],
  });
  try {
    const plan = planInheritance({
      loaded: p.loaded,
      changed: ['src/a.ts'],
      impact: mkImpact(['src/a.ts']),
      drift: ['src/a.ts'],
      evidence: { objects_on_disk: 2, objects_indexed: 2, label: '测试文件' },
    });
    assert.equal(plan.state, 'plan');
    assert.deepEqual(plan.rerun.map((r) => r.id), ['test:tests/a.test.ts']);
    assert.deepEqual(plan.inherit.map((e) => e.id), ['test:tests/u.test.ts']);
    assert.equal(plan.undetermined.length, 0);
  } finally {
    p.dispose();
  }
});

test('③ 无关改动 + 证据为空 ⇒ 仍然 no-evidence（不许因"没命中"报全绿）', () => {
  const p = makeProj({ tests: ['tests/a.test.ts'], entries: [] });
  try {
    const plan = planInheritance({
      loaded: p.loaded,
      changed: ['src/u.ts'],
      impact: mkImpact(['src/u.ts']),
      drift: ['src/u.ts'],
      evidence: { objects_on_disk: 1, objects_indexed: 1, label: '测试文件' },
    });
    assert.equal(plan.state, 'no-evidence', '无关改动也不能把"无证据"洗成通过');
    assert.equal(plan.inherit.length, 0);
    assert.ok(plan.widen);
  } finally {
    p.dispose();
  }
});

test('④ 证据都在但观察面全空 ⇒ empty-observes：未判定 + 扩大，不继承', () => {
  const p = makeProj({
    tests: ['tests/a.test.ts'],
    entries: [
      { id: 'test:tests/a.test.ts', observes: [] },
      { id: 'test:tests/b.test.ts', observes: [] },
    ],
  });
  try {
    const plan = planInheritance({
      loaded: p.loaded,
      changed: [],
      impact: mkImpact([]),
      drift: [],
      evidence: { objects_on_disk: 2, objects_indexed: 2, label: '测试文件' },
    });
    assert.equal(plan.state, 'empty-observes');
    assert.equal(plan.inherit.length, 0, '观察面全空时一条都不许继承');
    assert.equal(plan.undetermined.length, 2);
    assert.ok(plan.widen);
  } finally {
    p.dispose();
  }
});

test('⑤ 真的没有对象（磁盘 0 个）⇒ no-work：无活可干，与"无证据"分开', () => {
  const p = makeProj({ tests: [], entries: [] });
  try {
    const plan = planInheritance({
      loaded: p.loaded,
      changed: ['src/a.ts'],
      impact: mkImpact(['src/a.ts']),
      drift: ['src/a.ts'],
      evidence: { objects_on_disk: 0, objects_indexed: 0, label: '测试文件' },
    });
    assert.equal(plan.state, 'no-work');
    assert.equal(plan.widen, null, 'no-work 不是"基线不可作数"');
    assert.equal(plan.inherit.length, 0);
    assert.equal(plan.undetermined.length, 0);
    assert.match(String(plan.note), /没活/);
  } finally {
    p.dispose();
  }
});

test('⑥ 真没改动 + 有效基线 ⇒ no-change（唯一允许全继承的态）', () => {
  const p = makeProj({
    tests: ['tests/a.test.ts'],
    entries: [{ id: 'test:tests/a.test.ts', observes: ['src/a.ts'] }],
  });
  try {
    const plan = planInheritance({
      loaded: p.loaded,
      changed: [],
      impact: mkImpact([]),
      drift: [],
      evidence: { objects_on_disk: 1, objects_indexed: 1, label: '测试文件' },
    });
    assert.equal(plan.state, 'no-change');
    assert.equal(plan.widen, null);
    assert.deepEqual(plan.inherit.map((e) => e.id), ['test:tests/a.test.ts']);
  } finally {
    p.dispose();
  }
});

test('⑦ 无基线 / 基线损坏 ⇒ 沿用 existing 不可判规则（widen，不继承）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noev2-'));
  try {
    const missing = planInheritance({ loaded: loadVerifiedSnapshot(dir), changed: [], impact: mkImpact([]), drift: [] });
    assert.equal(missing.state, 'widen');
    assert.ok(missing.widen);
    assert.equal(missing.inherit.length, 0);

    fs.mkdirSync(path.join(dir, '.agent-io'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agent-io/verified-snapshot.json'), '{ 坏 JSON', 'utf-8');
    const corrupt = planInheritance({ loaded: loadVerifiedSnapshot(dir), changed: [], impact: mkImpact([]), drift: [] });
    assert.equal(corrupt.state, 'widen');
    assert.match(String(corrupt.widen?.reason), /基线损坏/);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});


test('⑧ 测试放在 spec/ 或 __tests__/ 下：口径不认目录名 ⇒ 仍判 plan，不误判成"测试未纳入事实"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noev3-'));
  try {
    const w = (rel: string): void => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x\n', 'utf-8');
    };
    w('src/a.ts');
    w('spec/a.spec.ts');
    w('pkg/__tests__/b.ts'); // ★ 文件名不带 .test ⇒ 靠 __tests__/ 目录认出来

    const found = scanTestObjects(dir);
    assert.deepEqual(found, ['pkg/__tests__/b.ts', 'spec/a.spec.ts'], `扫到的测试对象：${JSON.stringify(found)}`);

    // 索引里**两者都在** ⇒ objects_indexed = 2 ⇒ 不该判"未纳入事实"
    const vis = testObjectVisibility(dir, [...found, 'src/a.ts']);
    assert.equal(vis.objects_on_disk, 2);
    assert.equal(vis.objects_indexed, 2);
    assert.deepEqual(vis.missing, []);

    // 索引里**都看不到** ⇒ missing 全列，objects_indexed = 0
    const vis2 = testObjectVisibility(dir, ['src/a.ts']);
    assert.equal(vis2.objects_indexed, 0);
    assert.deepEqual(vis2.missing, ['pkg/__tests__/b.ts', 'spec/a.spec.ts']);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});

test('⑨ 同一工程：索引里能看到 spec/ 下的测试 ⇒ state=plan；看不到 ⇒ no-evidence（两种都必须能分辨）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noev4-'));
  try {
    const w = (rel: string, text: string): void => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text, 'utf-8');
    };
    w('src/a.ts', 'export const a = 1;\n');
    w('spec/a.spec.ts', '// touches: src/a.ts\nexport const t = 1;\n');
    const db = getProjectCacheDb(dir);
    const ins = db.prepare(
      'INSERT OR REPLACE INTO nodes (id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,params,return_type,body_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    ins.run('nA', 'const', 'a', 'a', 'src/a.ts', 'ts', 1, 1, 'a', '[]', 'number', 'BH_A', 'T0');

    const files = hashProjectFiles(dir);
    const writeSnap = (observes: string[]): void =>
      writeVerifiedSnapshot(dir, {
        schema: SNAPSHOT_SCHEMA,
        at: new Date().toISOString(),
        content: { version: contentVersion(files), files },
        graph: { version: 'n/a', bytes: 0, available: true },
        entries: [
          { id: 'test:spec/a.spec.ts', kind: 'test', verdict: 'pass', command: 'vitest spec/a.spec.ts', at: new Date().toISOString(), observes },
        ],
        scope: { ran: [], inherited: [], undetermined: [], partial: true },
      });

    // ① 索引**看不到** spec/a.spec.ts
    writeSnap(['src/a.ts']);
    const visNo = testObjectVisibility(dir, ['src/a.ts']);
    const planNo = planInheritance({
      loaded: loadVerifiedSnapshot(dir),
      changed: ['src/a.ts'],
      impact: mkImpact(['src/a.ts']),
      drift: ['src/a.ts'],
      evidence: { objects_on_disk: visNo.objects_on_disk, objects_indexed: visNo.objects_indexed, label: '测试文件' },
    });
    assert.equal(planNo.state, 'plan', '有证据在册时，索引缺测试对象**不该**把结论打成 no-evidence');
    assert.deepEqual(planNo.rerun.map((r) => r.id), ['test:spec/a.spec.ts'], '证据的观察面与波及集合相交 ⇒ 重验');

    // ② 索引**看得到** ⇒ 同样 plan（口径两侧一致）
    ins.run('nT', 'const', 't', 't', 'spec/a.spec.ts', 'ts', 1, 1, 't', '[]', 'number', 'BH_T', 'T0');
    const visYes = testObjectVisibility(dir, ['src/a.ts', 'spec/a.spec.ts']);
    assert.equal(visYes.objects_indexed, 1);
    const planYes = planInheritance({
      loaded: loadVerifiedSnapshot(dir),
      changed: ['src/a.ts'],
      impact: mkImpact(['src/a.ts']),
      drift: ['src/a.ts'],
      evidence: { objects_on_disk: visYes.objects_on_disk, objects_indexed: visYes.objects_indexed, label: '测试文件' },
    });
    assert.equal(planYes.state, 'plan');
  } finally {
    closeAllProjectCacheDbs();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});


test('⑩ 基准取**运行器枚举**：运行器不跑的（fixtures 里的 *.test.ts）不算应验证对象，多出来的必须点名', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noev5-'));
  try {
    const w = (rel: string): void => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), 'x\n', 'utf-8');
    };
    w('tests/a.test.ts');
    w('tests/b.test.ts');
    w('tests/fixtures/sample.test.ts'); // ★ 形态像测试，但运行器不跑它

    const scanned = scanTestObjects(dir);
    assert.deepEqual(scanned, ['tests/a.test.ts', 'tests/b.test.ts', 'tests/fixtures/sample.test.ts'], '扫描三个');

    // 运行器只跑前两个 ⇒ 基准 = 2；第三个进 extra
    const vis = testObjectVisibility(dir, ['tests/a.test.ts', 'tests/b.test.ts', 'tests/fixtures/sample.test.ts'], {
      onDisk: ['tests/a.test.ts', 'tests/b.test.ts'],
    });
    assert.equal(vis.basis, 'runner', '给了运行器枚举就必须以它为准');
    assert.equal(vis.objects_on_disk, 2, '应验证对象 = 运行器会跑的那 2 个');
    assert.equal(vis.objects_indexed, 2);
    assert.deepEqual(vis.missing, []);
    assert.deepEqual(vis.extra, ['tests/fixtures/sample.test.ts'], '多出来的必须被点名，不许静默');

    // 没给运行器枚举 ⇒ 退回扫描口径，并且 basis 要说清楚
    const vis2 = testObjectVisibility(dir, []);
    assert.equal(vis2.basis, 'scan');
    assert.equal(vis2.objects_on_disk, 3);
    assert.equal(vis2.objects_indexed, 0);
    assert.equal(vis2.missing.length, 3);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});

test('⑪ 索引只看得到一部分 ⇒ 差额进 missing（读数不许把"部分纳入"读成"全部纳入"）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noev6-'));
  try {
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    for (const f of ['a.test.ts', 'b.test.ts', 'c.test.ts']) fs.writeFileSync(path.join(dir, 'tests', f), 'x\n', 'utf-8');
    const vis = testObjectVisibility(dir, ['tests/a.test.ts'], { onDisk: ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'] });
    assert.equal(vis.objects_on_disk, 3);
    assert.equal(vis.objects_indexed, 1);
    assert.deepEqual(vis.missing, ['tests/b.test.ts', 'tests/c.test.ts']);
    assert.equal(vis.objects_on_disk - vis.objects_indexed, vis.missing.length, '差额必须等于 missing 的长度');
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录 */
    }
  }
});
