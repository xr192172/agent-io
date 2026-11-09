/**
 * touches: src/infrastructure/analysis/facts/impact_set.ts, src/application/design/verified_snapshot.ts
 *
 * P1 · **增量基线的真实正例**（本轮唯一新增的东西）。
 *
 * 前几轮把"不可信"的边界都补成了反例；这里补**正例现场**：
 * 可信基线 + 干净树 + **一个普通业务文件的单一变更** ⇒
 * 只有该变更**影响闭包内**的测试/契约重验，其余 pass 证据被继承，未判定单列。
 *
 * ★ 全程在**隔离的临时工程**里跑（自带 `cache.db`，不碰当前工作区、不 git、不提交）；
 *   用的都是**真实组件**：`impactOfChanged`（`diffImpact`）、`contentDrift`/`hashProjectFiles`、
 *   `planInheritance`、以及**真实的** `judgeExpectations`（没有第二套判据实现）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { impactOfChanged } from '../src/infrastructure/analysis/facts/impact_set.ts';
import {
  SNAPSHOT_SCHEMA,
  contentDrift,
  contentVersion,
  hashProjectFiles,
  loadVerifiedSnapshot,
  planInheritance,
  writeVerifiedSnapshot,
} from '../src/application/design/verified_snapshot.ts';
import { judgeExpectations } from '../src/application/design/intent/expectations.ts';
import { getProjectCacheDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db.ts';

type Proj = { dir: string; dispose: () => void };

/** 建一个"干净"的小工程：a 调 b；u 无关。 */
function makeProject(): Proj {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/a.ts'), 'import { b } from "./b";\nexport function a(): number { return b(); }\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'src/b.ts'), 'export function b(): number { return 1; }\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'src/u.ts'), 'export const u = 42;\n', 'utf-8');

  const db = getProjectCacheDb(dir);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO nodes (id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,params,return_type,body_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  ins.run('nA', 'function', 'a', 'a', 'src/a.ts', 'ts', 1, 2, 'a(): number', '[]', 'number', 'BH_A', 'T0');
  ins.run('nB', 'function', 'b', 'b', 'src/b.ts', 'ts', 1, 1, 'b(): number', '[]', 'number', 'BH_B', 'T0');
  ins.run('nU', 'const', 'u', 'u', 'src/u.ts', 'ts', 1, 1, 'u', '[]', 'number', 'BH_U', 'T0');
  db.prepare('INSERT INTO edges (source,target,kind) VALUES (?,?,?)').run('nA', 'nB', 'call');

  return {
    dir,
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

/** 记一份可信基线：两条 pass 证据（观察 a / 观察 u），内容指纹取自当前磁盘 */
function recordBaseline(dir: string): void {
  const files = hashProjectFiles(dir);
  writeVerifiedSnapshot(dir, {
    schema: SNAPSHOT_SCHEMA,
    at: new Date().toISOString(),
    content: { version: contentVersion(files), files },
    graph: { version: 'n/a', bytes: 0, available: true },
    entries: [
      { id: 'test:a', kind: 'test', verdict: 'pass', command: 'node --import tsx tests/a.test.ts', at: new Date().toISOString(), observes: ['src/a.ts'] },
      { id: 'test:u', kind: 'test', verdict: 'pass', command: 'node --import tsx tests/u.test.ts', at: new Date().toISOString(), observes: ['src/u.ts'] },
    ],
    scope: { ran: ['test:a', 'test:u'], inherited: [], undetermined: [], partial: true },
  });
}

/** 一步：算 波及 + 漂移 + 继承决策（真实组件，测耗时） */
function step(dir: string, changed: string[]) {
  const loaded = loadVerifiedSnapshot(dir);
  assert.equal(loaded.status, 'ok', '前置：基线必须可用');

  const t0 = Date.now();
  const drift = (() => {
    const d = contentDrift(loaded.snapshot.content.files, hashProjectFiles(dir));
    return [...d.changed, ...d.added, ...d.removed].sort();
  })();
  const impact = impactOfChanged(dir, changed, { max_depth: 6 });
  const tScan = Date.now() - t0;

  const t1 = Date.now();
  const plan = planInheritance({ loaded, changed, impact, drift });
  const tPlan = Date.now() - t1;

  return { plan, drift, impact, ms: { scan: tScan, plan: tPlan, total: tScan + tPlan } };
}


const setNode = (dir: string, id: string, fields: Record<string, string>): void => {
  const db = getProjectCacheDb(dir);
  for (const [k, v] of Object.entries(fields)) db.prepare(`UPDATE nodes SET ${k}=? WHERE id=?`).run(v, id);
};

test('★正例1 干净树 + 单文件变更 ⇒ 只重验闭包内，其余继承；未判定单列', () => {
  const p = makeProject();
  try {
    recordBaseline(p.dir);

    // ① 干净树：改动集空、漂移空 ⇒ 全部继承
    const clean = step(p.dir, []);
    assert.deepEqual(clean.drift, [], '干净树必须零漂移');
    assert.equal(clean.plan.widen, null, '干净树不该扩大');
    assert.deepEqual(clean.plan.inherit.map((e) => e.id).sort(), ['test:a', 'test:u']);
    assert.equal(clean.plan.undetermined.length, 0);

    // ② 单文件变更：改 b.ts（a 的依赖）
    fs.writeFileSync(path.join(p.dir, 'src/b.ts'), 'export function b(): number { return 2; }\n', 'utf-8');
    setNode(p.dir, 'nB', { body_hash: 'BH_B_V2' });

    const one = step(p.dir, ['src/b.ts']);
    // 改动集与指纹必须一致（验收：改动集与文件指纹一致）
    assert.deepEqual(one.drift, ['src/b.ts'], `漂移必须恰好是改动集，实得 ${JSON.stringify(one.drift)}`);
    // 波及集合必须含 a.ts（a 调 b）
    assert.ok(one.impact.ok);
    assert.ok(one.impact.files.has('src/a.ts'), `波及必须含 src/a.ts，实得 ${[...one.impact.files].join(',')}`);

    // 只有闭包内的 test:a 重验；test:u 继承；未判定单列（不消失）
    assert.deepEqual(one.plan.rerun.map((r) => r.id), ['test:a'], '只有观察 a 的那条要重验');
    assert.deepEqual(one.plan.inherit.map((e) => e.id), ['test:u'], '无影响的既有 pass 必须被继承');
    assert.deepEqual(one.plan.undetermined, [], '本例不该有未判定（有的话必须列出而不是消失）');
    assert.ok(one.ms.total >= 0);
    console.log(
      `      [正例] 波及 ${one.impact.files.size} 文件 / ${one.impact.symbols.size} 符号 · diffImpact ${one.impact.calls} 次 · ` +
        `扫描 ${one.ms.scan}ms + 决策 ${one.ms.plan}ms = ${one.ms.total}ms`,
    );

    // ③ 再改**无关**文件 ⇒ 不错误扩大
    //   ★ 必须先把"改过 b.ts"这一态记成新基线，否则 b.ts 相对旧基线仍是改动 ⇒ test:a 当然要重验。
    recordBaseline(p.dir);
    fs.writeFileSync(path.join(p.dir, 'src/u.ts'), 'export const u = 43;\n', 'utf-8');
    setNode(p.dir, 'nU', { body_hash: 'BH_U_V2' });
    const unrelated = step(p.dir, ['src/u.ts']);
    assert.deepEqual(unrelated.drift, ['src/u.ts'], '漂移必须只是这一个');
    assert.deepEqual(unrelated.plan.rerun.map((r) => r.id), ['test:u'], '无关改动只该让观察它的那条重验');
    assert.deepEqual(unrelated.plan.inherit.map((e) => e.id), ['test:a'], 'a 这次完全没被牵连');
    assert.equal(unrelated.plan.undetermined.length, 0);
  } finally {
    p.dispose();
  }
});

test('★正例2 变更行为错误 ⇒ 相关契约必须红；恢复后允许通过', async () => {
  const p = makeProject();
  try {
    const exp = { kind: 'source-has' as const, path: 'src/b.ts', must: ['return 1'], why: 'b 必须返回 1（行为契约）' };
    const asItem = { node_id: 'contract:b-correct', node_label: 'b 的行为契约', expectation: exp as never };

    const before = await judgeExpectations(p.dir, [asItem]);
    assert.equal(before.items[0].verdict, 'pass', `改前必须 pass，实得 ${before.items[0].verdict} / ${before.items[0].detail}`);

    // 改坏
    fs.writeFileSync(path.join(p.dir, 'src/b.ts'), 'export function b(): number { return 999; }\n', 'utf-8');
    const broken = await judgeExpectations(p.dir, [asItem]);
    assert.equal(broken.items[0].verdict, 'fail', `行为改错必须红，实得 ${broken.items[0].verdict} / ${broken.items[0].detail}`);

    // 恢复 ⇒ 允许通过
    fs.writeFileSync(path.join(p.dir, 'src/b.ts'), 'export function b(): number { return 1; }\n', 'utf-8');
    const restored = await judgeExpectations(p.dir, [asItem]);
    assert.equal(restored.items[0].verdict, 'pass', `恢复后必须 pass，实得 ${restored.items[0].verdict}`);
  } finally {
    p.dispose();
  }
});
