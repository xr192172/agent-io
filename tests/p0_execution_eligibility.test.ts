/**
 * Stage C · 当前执行资格与历史证据隔离。
 *
 * touches: src/domain/execution_eligibility.ts, src/domain/semantic.ts, src/application/verify/execution_intents.ts, src/application/verify/verify_project.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { judgeExecutionEligibility, type ExecutionClaim } from '../src/domain/execution_eligibility.js';
import { assertLifecycle } from '../src/domain/semantic.js';
import { adjudicateTestObjects } from '../src/application/verify/execution_intents.js';
import { verifyProject } from '../src/application/verify/verify_project.js';
import { loadVerifiedSnapshot, SNAPSHOT_REL } from '../src/application/design/verified_snapshot.js';

const REPO = process.cwd();
const ACTIVE = 'test/active.test.mjs';
const DEPRECATED = 'test/deprecated.test.mjs';
const RETIRED = 'test/retired.test.mjs';

const eligibilityCases: Array<{ name: string; claims: ExecutionClaim[]; status: string; reason: string }> = [
  { name: '未声明默认 active', claims: [], status: 'eligible', reason: 'default-active' },
  { name: 'deprecated 仍执行', claims: [{ source: 'book', lifecycle: 'deprecated' }], status: 'eligible', reason: 'deprecated-still-executable' },
  { name: 'to_delete 仍执行', claims: [{ source: 'book', nodeIntent: 'to_delete' }], status: 'eligible', reason: 'node-to-delete-still-present' },
  { name: 'FileLifecycle retired 退出', claims: [{ source: 'book', lifecycle: 'retired' }], status: 'excluded', reason: 'retired' },
  { name: 'Node retired 退出', claims: [{ source: 'book', nodeIntent: 'retired' }], status: 'excluded', reason: 'node-retired' },
  { name: 'archived 不是持久退休证明', claims: [{ source: 'book', lifecycle: 'archived' }], status: 'unjudgeable', reason: 'archived-is-write-command' },
  { name: '未知生命周期不可判', claims: [{ source: 'book', lifecycle: 'mystery' }], status: 'unjudgeable', reason: 'unknown-lifecycle' },
  { name: 'active 与 retired 冲突不可判', claims: [{ source: 'a', lifecycle: 'active' }, { source: 'b', lifecycle: 'retired' }], status: 'unjudgeable', reason: 'conflicting-lifecycle' },
  { name: 'merged 无明确当前所有者不可判', claims: [{ source: 'book', lifecycle: 'merged' }], status: 'unjudgeable', reason: 'merged-owner-unresolved' },
];
for (const c of eligibilityCases) {
  test(`执行资格 · ${c.name}`, () => {
    assert.deepEqual(judgeExecutionEligibility(c.claims), { status: c.status, reason: c.reason });
  });
}

test('FileLifecycle.retired 必须有理由；archived 仍是写入指令', () => {
  assert.doesNotThrow(() => assertLifecycle({ status: 'retired', retire_reason: '已由新实现取代' }));
  assert.throws(
    () => assertLifecycle({ status: 'retired' }),
    /lifecycle\.status="retired" 必须带 retire_reason/,
    '没有理由的 retired 必须抛，不能静默落成持久态',
  );
  assert.throws(() => assertLifecycle({ status: 'retired', retire_reason: '   ' }), /retired/);
  assert.doesNotThrow(() => assertLifecycle({ status: 'archived', retire_reason: '归档到归档库' }));
  assert.throws(() => assertLifecycle({ status: 'archived' }), /archived/);
});

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-eligibility-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.agent-io\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'execution-eligibility', type: 'module' }));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(root, 'src', 'value.mjs'), 'export const value = 1;\n');
  const prelude = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/value.mjs';\n";
  fs.writeFileSync(path.join(root, ACTIVE), `${prelude}test('active', () => assert.equal(value, 1));\n`);
  fs.writeFileSync(path.join(root, DEPRECATED), `${prelude}test('deprecated', () => assert.equal(value, 1));\n`);
  fs.writeFileSync(
    path.join(root, RETIRED),
    `${prelude}import fs from 'node:fs';\ntest('retired', () => { fs.writeFileSync('retired-ran.txt', 'yes'); assert.equal(value, 1); });\n`,
  );
  return root;
}

function writeLifecycle(root: string): void {
  const dir = path.join(root, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  const file = (p: string, status: string) => ({
    id: `file_${p.replace(/\W/g, '_')}`,
    path: p,
    responsibility: `${status} fixture responsibility`,
    lifecycle: { status, retire_reason: status === 'active' ? undefined : `${status} fixture` },
  });
  fs.writeFileSync(path.join(dir, 'lifecycle.dsl.json'), JSON.stringify({
    version: 1,
    feature: 'lifecycle',
    semantic: { files: [file(ACTIVE, 'active'), file(DEPRECATED, 'deprecated'), file(RETIRED, 'retired')] },
    geometry: { nodes: [], edges: [] },
  }, null, 2));
}

const snapshotIds = (root: string): string[] => {
  const loaded = loadVerifiedSnapshot(root);
  return loaded.status === 'ok' ? loaded.snapshot.entries.map((e) => e.id).sort() : [];
};

test('册读取失败与跨册冲突不得静默变成可执行或零对象', () => {
  const root = mkProject();
  try {
    const dir = path.join(root, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.dsl.json'), '{');
    const broken = adjudicateTestObjects(root, [ACTIVE, RETIRED]);
    assert.deepEqual(broken.eligible, []);
    assert.deepEqual(broken.excluded, []);
    assert.deepEqual(broken.unjudgeable.map((x) => x.id), [ACTIVE, RETIRED]);

    fs.rmSync(dir, { recursive: true, force: true });
    writeLifecycle(root);
    fs.writeFileSync(path.join(dir, 'conflict.dsl.json'), JSON.stringify({
      feature: 'conflict',
      semantic: { files: [{ id: 'file_conflict_retired', path: RETIRED, responsibility: 'conflict fixture', lifecycle: { status: 'active' } }] },
      geometry: { nodes: [{ id: 'retired-node', path: RETIRED, intent: 'live' }] },
    }));
    const conflict = adjudicateTestObjects(root, [RETIRED]);
    assert.equal(conflict.eligible.length, 0);
    assert.equal(conflict.excluded.length, 0);
    assert.equal(conflict.unjudgeable[0]?.reason, 'conflicting-lifecycle');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('无设计册：完全无声明由纯裁判 default-active', () => {
  const root = mkProject();
  try {
    const got = adjudicateTestObjects(root, [ACTIVE, RETIRED]);
    assert.deepEqual(got.eligible, [ACTIVE, RETIRED]);
    assert.deepEqual(got.excluded, []);
    assert.deepEqual(got.unjudgeable, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('正常册适配器对照：retired 只退自己，active/deprecated 可执行', () => {
  const root = mkProject();
  try {
    writeLifecycle(root);
    const got = adjudicateTestObjects(root, [ACTIVE, DEPRECATED, RETIRED]);
    assert.deepEqual(got.eligible, [ACTIVE, DEPRECATED]);
    assert.deepEqual(got.excluded, [{ id: RETIRED, status: 'excluded', reason: 'retired' }]);
    assert.deepEqual(got.unjudgeable, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('原始册 lifecycle.retired 缺理由 ⇒ invalid-lifecycle/unjudgeable；有理由仍 excluded', () => {
  const root = mkProject();
  try {
    const dir = path.join(root, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'raw-retired.dsl.json'), JSON.stringify({
      version: 1,
      feature: 'raw-retired',
      semantic: {
        files: [
          { id: 'file_active_bad', path: ACTIVE, responsibility: 'raw retired without reason', lifecycle: { status: 'retired' } },
          { id: 'file_deprecated_ok', path: DEPRECATED, responsibility: 'raw retired with reason', lifecycle: { status: 'retired', retire_reason: 'valid retire reason' } },
        ],
      },
      geometry: { nodes: [], edges: [] },
    }, null, 2));
    const got = adjudicateTestObjects(root, [ACTIVE, DEPRECATED]);
    assert.deepEqual(got.eligible, []);
    assert.deepEqual(got.excluded.map((x) => [x.id, x.reason]), [[DEPRECATED, 'retired']]);
    assert.equal(got.unjudgeable.length, 1);
    assert.equal(got.unjudgeable[0]?.id, ACTIVE);
    assert.match(got.unjudgeable[0]?.reason ?? '', /^invalid-lifecycle:/);
    assert.match(got.unjudgeable[0]?.reason ?? '', /retire_reason/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('同册 Node.intent=retired 与未声明 lifecycle：不得伪造成 active 冲突', () => {
  const root = mkProject();
  try {
    const dir = path.join(root, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'node-retired.dsl.json'), JSON.stringify({
      version: 1,
      feature: 'node-retired',
      semantic: { files: [{ id: 'file_active_fixture', path: ACTIVE, responsibility: 'active fixture' }] },
      geometry: { nodes: [{ id: 'node_active_fixture', path: ACTIVE, intent: 'retired' }], edges: [] },
    }, null, 2));
    const got = adjudicateTestObjects(root, [ACTIVE]);
    assert.deepEqual(got.eligible, []);
    assert.deepEqual(got.excluded, [{ id: ACTIVE, status: 'excluded', reason: 'node-retired' }]);
    assert.deepEqual(got.unjudgeable, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('几何节点形状：pathless 聚合节点跳过；非对象与 path:123 必须 unjudgeable', () => {
  const root = mkProject();
  try {
    const dir = path.join(root, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });

    // ① 合法聚合节点：没有 path（不可寻址），不得被当成坏册。
    fs.writeFileSync(path.join(dir, 'aggregate.dsl.json'), JSON.stringify({
      feature: 'aggregate',
      geometry: { nodes: [{ id: 'aggregate-node', label: '聚合节点' }], edges: [] },
    }));
    let got = adjudicateTestObjects(root, [ACTIVE]);
    assert.deepEqual(got.eligible, [ACTIVE]);
    assert.deepEqual(got.excluded, []);
    assert.deepEqual(got.unjudgeable, []);

    // ② 非对象节点：形状错 ⇒ 候选不可判。
    fs.rmSync(path.join(dir, 'aggregate.dsl.json'));
    fs.writeFileSync(path.join(dir, 'non-object.dsl.json'), JSON.stringify({
      feature: 'non-object',
      geometry: { nodes: [null], edges: [] },
    }));
    got = adjudicateTestObjects(root, [ACTIVE]);
    assert.deepEqual(got.eligible, []);
    assert.deepEqual(got.excluded, []);
    assert.equal(got.unjudgeable[0]?.id, ACTIVE);
    assert.match(got.unjudgeable[0]?.reason ?? '', /geometry node 形状错误/);

    // ③ path 存在但不是 string：不得跳过，也不得 default-active。
    fs.rmSync(path.join(dir, 'non-object.dsl.json'));
    fs.writeFileSync(path.join(dir, 'bad-path.dsl.json'), JSON.stringify({
      feature: 'bad-path',
      geometry: { nodes: [{ id: 'bad-path-node', path: 123 }], edges: [] },
    }));
    got = adjudicateTestObjects(root, [ACTIVE]);
    assert.deepEqual(got.eligible, []);
    assert.deepEqual(got.excluded, []);
    assert.equal(got.unjudgeable[0]?.id, ACTIVE);
    assert.match(got.unjudgeable[0]?.reason ?? '', /geometry node path 非字符串/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyProject · retired 退出全量、自身变更与旧绿继承，active/deprecated 继续', async () => {
  const root = mkProject();
  const marker = path.join(root, 'retired-ran.txt');
  try {
    const initial = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(initial.ok, true, JSON.stringify(initial.limitations));
    assert.deepEqual(initial.ran.map((x) => x.file).sort(), [ACTIVE, DEPRECATED, RETIRED]);
    assert.equal(fs.existsSync(marker), true, '退休前夹具确实执行过并产生绿证据');
    assert.deepEqual(snapshotIds(root), [`test:${ACTIVE}`, `test:${DEPRECATED}`, `test:${RETIRED}`]);

    fs.rmSync(marker);
    writeLifecycle(root);
    const inherited = await verifyProject({ projectRoot: root, change: ['.agent-io/design/lifecycle.dsl.json'] });
    assert.equal(fs.existsSync(marker), false, '继承旧绿时不得执行 retired');
    assert.equal(inherited.inherited.includes(`test:${RETIRED}`), false, 'retired 旧绿不得进入当前继承面');
    assert.deepEqual(inherited.excluded.map((x) => x.id), [RETIRED]);
    assert.deepEqual(snapshotIds(root), [`test:${ACTIVE}`, `test:${DEPRECATED}`], '当前基线移除 retired 证据，不改写历史事件');

    fs.writeFileSync(path.join(root, RETIRED), `${fs.readFileSync(path.join(root, RETIRED), 'utf8')}\n// retired self-change\n`);
    const selfChanged = await verifyProject({ projectRoot: root, change: [RETIRED] });
    assert.equal(fs.existsSync(marker), false, 'retired 自身变化不得重新激活执行');
    assert.equal(selfChanged.ran.some((x) => x.file === RETIRED), false);
    assert.equal(selfChanged.inherited.includes(`test:${RETIRED}`), false);

    fs.rmSync(path.join(root, SNAPSHOT_REL));
    const full = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(full.ok, true, JSON.stringify(full.limitations));
    assert.deepEqual(full.ran.map((x) => x.file).sort(), [ACTIVE, DEPRECATED], '无基线全量只跑当前可执行对象');
    assert.equal(fs.existsSync(marker), false, '全量重跑不得执行 retired');
    assert.deepEqual(snapshotIds(root), [`test:${ACTIVE}`, `test:${DEPRECATED}`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyProject · 坏册/冲突时不得执行、不得继承且 ok=false', async () => {
  const root = mkProject();
  const marker = path.join(root, 'retired-ran.txt');
  const snap = path.join(root, SNAPSHOT_REL);
  try {
    const initial = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(initial.ok, true, JSON.stringify(initial.limitations));
    const before = fs.readFileSync(snap, 'utf8');
    fs.rmSync(marker);

    const dir = path.join(root, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.dsl.json'), '{');
    const broken = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(broken.ok, false);
    assert.deepEqual(broken.ran, []);
    assert.deepEqual(broken.inherited, []);
    assert.equal(broken.undetermined.length, 3);
    assert.equal(broken.undetermined.every((u) => u.reason.startsWith('design-unreadable:')), true);
    assert.equal(fs.existsSync(marker), false, '坏册时不得执行');
    assert.equal(fs.readFileSync(snap, 'utf8'), before, '坏册时不得改写基线');

    fs.rmSync(path.join(dir, 'broken.dsl.json'));
    writeLifecycle(root);
    fs.writeFileSync(path.join(dir, 'conflict.dsl.json'), JSON.stringify({
      feature: 'conflict',
      semantic: { files: [{ id: 'file_conflict_retired', path: RETIRED, responsibility: 'conflict fixture', lifecycle: { status: 'active' } }] },
      geometry: { nodes: [{ id: 'retired-node', path: RETIRED, intent: 'live' }], edges: [] },
    }));
    const conflict = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(conflict.ok, false);
    assert.deepEqual(conflict.ran, []);
    assert.deepEqual(conflict.inherited, []);
    assert.equal(
      conflict.undetermined.some((u) => u.id === `test:${RETIRED}` && u.reason === 'conflicting-lifecycle'),
      true,
      '冲突对象必须进 undetermined，而不是被默认成可执行或零对象成功',
    );
    assert.equal(fs.existsSync(marker), false, '冲突时不得执行');
    assert.equal(fs.readFileSync(snap, 'utf8'), before, '冲突时不得改写基线');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyProject · 全部 retired 不是零对象成功', async () => {
  const root = mkProject();
  const marker = path.join(root, 'retired-ran.txt');
  try {
    const dir = path.join(root, '.agent-io', 'design');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'all-retired.dsl.json'), JSON.stringify({
      version: 1,
      feature: 'all-retired',
      semantic: {
        files: [ACTIVE, DEPRECATED, RETIRED].map((p) => ({
          id: `file_${p.replace(/\W/g, '_')}`,
          path: p,
          responsibility: 'retired fixture',
          lifecycle: { status: 'retired', retire_reason: 'fixture retired' },
        })),
      },
      geometry: { nodes: [], edges: [] },
    }, null, 2));
    const r = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(r.ok, false);
    assert.deepEqual(r.ran, []);
    assert.deepEqual(r.inherited, []);
    assert.deepEqual(r.excluded.map((x) => x.id).sort(), [ACTIVE, DEPRECATED, RETIRED].sort());
    assert.equal(r.project.unsupported, 'no-executable-test-objects');
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(path.join(root, SNAPSHOT_REL)), false, '全部退休时不得写基线');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyProject · 未索引的 retired 不冒充新对象/missing，也不扩大 active/deprecated 证据计划', async () => {
  const root = mkProject();
  try {
    // 初始只让 active/deprecated 进索引与基线；retired 在索引之后才出现。
    fs.rmSync(path.join(root, RETIRED));
    const initial = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(initial.ok, true, JSON.stringify(initial.limitations));
    assert.deepEqual(initial.ran.map((x) => x.file).sort(), [ACTIVE, DEPRECATED]);
    assert.deepEqual(snapshotIds(root), [`test:${ACTIVE}`, `test:${DEPRECATED}`]);

    fs.copyFileSync(path.join(root, ACTIVE), path.join(root, RETIRED));
    writeLifecycle(root);
    const r = await verifyProject({ projectRoot: root, change: [] });
    assert.equal(r.ok, true, JSON.stringify(r.limitations));
    assert.deepEqual(r.ran, [], '未索引的 retired 不是“新发现”，不得触发重跑');
    assert.deepEqual(r.inherited.sort(), [`test:${ACTIVE}`, `test:${DEPRECATED}`]);
    assert.deepEqual(r.excluded.map((x) => x.id), [RETIRED]);
    assert.equal(r.project.test_objects_on_disk, 3, '公开 on_disk 仍是物理扫描总量（含 retired）');
    assert.equal(r.project.test_objects_indexed, 2, '公开 indexed 仍是物理集合的可见数（retired 未索引）');
    assert.equal(
      r.limitations.some((s) => s.includes('索引里看不到') && s.includes(RETIRED)),
      false,
      '未索引的 retired 不得冒充 missing 噪音',
    );
    assert.deepEqual(snapshotIds(root), [`test:${ACTIVE}`, `test:${DEPRECATED}`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
