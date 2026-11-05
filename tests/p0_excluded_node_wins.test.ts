/**
 * P0 · **R49：`excluded` 声明只豁免「没有任何册给它建节点」的路径**（node wins）。
 *
 * ## 它治哪个洞（一句话）
 * 一个册的 `excluded` 声明，不该管住**另一个册**的节点。改前 `planDesignDb` 按**全册并集**跳过 ⇒
 * `task-system-plan` 的一句 `scripts/` 把 `agent-io` 的 69 个脚本节点（含 24 条判据）全挡在
 * design-db 之外 —— **立卡写判据的是 A 册，一句话把它们静音的是 B 册，而 B 册对它们没有发言权**。
 *
 * ## 命名（0.28）
 * `scope-declaration ownership gap`（跨租户作用域泄漏；K8s 叫 cross-namespace selector bleed）。
 * 标准解法：① 严格 per-sheet（A 册声明只管 A 册节点）· ② 删掉冲突节点 · ③ **判据落在「节点存在性」上**。
 * 选 ③：磁盘上的一个文件**不属于任何册**、而结构门是**磁盘驱动**的 ⇒ ① 在这一侧没有干净的归属概念；
 * ② 治症状且会销毁证据（R50：0 判据 ≠ 可删）。
 *
 * ## 判据（0.14 双向 + 0.25① 有鉴别力）
 * ① **同义必命中**：A 册声明 `x/`、B 册在 `x/` 下有节点 ⇒ 该文件归 `with_node`、B 册节点**进 design-db**、
 *    且**不算冲突债务**（`excludedNodeConflicts` 只把它当信息档报出来）。
 * ② **异义必不命中**：A 册声明 `x/`、**任何册都没有** `x/` 下的节点 ⇒ 该文件**仍是 `excluded`**（声明照常生效）。
 * ③ **消融**：把「有节点优先」那一行摘掉（= 复刻旧判序）⇒ ① 必须红（`assertSilentGapClosed` 当场抛）。
 * ④ **不变式**：`source_files === with_node + excluded + conflict + gaps` 仍成立，且修后 `conflict === 0`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  excludedAppliesTo,
  excludedNodeConflicts,
  loadDesignSheetsForGate,
  planDesignDb,
} from '../src/application/design/db/gen_design_db.js';
import { assertSilentGapClosed, silentGapOf } from '../src/application/design/line/design_line.js';

interface Fixture {
  home: string;
  project: string;
  prevHome: string | undefined;
}

/** 一份最小设计册（`nodes` 只给 `{id, path}`；`excluded` 是管辖范围声明） */
function sheetOf(feature: string, nodes: Array<{ id: string; path: string }>, excluded?: Array<{ path: string; reason: string }>) {
  return {
    feature,
    title: feature,
    geometry: {
      nodes: nodes.map((n) => ({
        ...n,
        label: n.path,
        type: 'file',
        x: 0,
        y: 0,
        decision: {
          summary: `夹具：${n.path} 的设计对象`,
          expectations: [{ kind: 'file-exists', path: n.path, why: '夹具：证明这条判据在册里（是否进 design-db 由本卡判）' }],
        },
      })),
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
    ...(excluded ? { excluded } : {}),
  };
}

/**
 * 夹具：两个临时目录（数据家 + 项目根）。
 * ★ `AGENT_IO_HOME` 指到**空**的临时数据家 —— 否则 `loadDesignSheetsForGate` 会把本仓那几册并进来
 *   （那时测的就不是我以为的那份册了）。
 */
function makeFixture(): Fixture {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-r49-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-r49-proj-'));
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  return { home, project, prevHome };
}

function writeSheet(project: string, feature: string, sheet: ReturnType<typeof sheetOf>): void {
  const dir = path.join(project, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(sheet, null, 2), 'utf-8');
}

function dropFixture(f: Fixture): void {
  if (f.prevHome === undefined) delete process.env.AGENT_IO_HOME;
  else process.env.AGENT_IO_HOME = f.prevHome;
  fs.rmSync(f.home, { recursive: true, force: true });
  fs.rmSync(f.project, { recursive: true, force: true });
}

/** 把项目根上那批册读成 `silentGapOf` 的输入形状（不读盘：本证只判「判序」这一件事） */
function gapOfProject(project: string, sourceFiles: string[], conflictPaths: string[]) {
  const sheets = loadDesignSheetsForGate(project).sheets;
  const nodePaths: string[] = [];
  for (const s of sheets) for (const n of s.geometry?.nodes ?? []) if (n.path) nodePaths.push(n.path);
  const excluded: Array<{ path: string; reason: string }> = [];
  for (const s of sheets) for (const x of s.excluded ?? []) excluded.push({ path: String(x.path ?? ''), reason: String(x.reason ?? '') });
  return silentGapOf({ source_files: sourceFiles, node_paths: nodePaths, excluded, conflict_paths: conflictPaths });
}

// ════════════════════════════════════════════════════════════════════
// ① 同义必命中（node wins：别的册声明了也一样入册）
// ════════════════════════════════════════════════════════════════════
test('① node wins：A 册声明 `x/`、B 册在 `x/` 下有节点 ⇒ 归 with_node · **进 design-db** · 不算冲突债务', () => {
  const f = makeFixture();
  try {
    writeSheet(f.project, 'sheet-a', sheetOf('sheet-a', [], [{ path: 'x/', reason: 'A 册：这个目录不进册' }]));
    writeSheet(f.project, 'sheet-b', sheetOf('sheet-b', [{ id: 'nb', path: 'x/f.ts' }]));

    // ①a 投影（design-db）必须**收下** B 册那个节点 —— 这是"声明不再管住别册节点"的正面判据
    const plan = planDesignDb(f.project);
    const item = plan.items.get('x/f.ts');
    assert.ok(item, `B 册的节点必须进投影（改前它被 A 册的一句 x/ 挡在外面）：拿到 ${[...plan.items.keys()].join(',') || '（空）'}`);
    assert.deepEqual(item?.holders, ['sheet-b'], `该路径的持有者应是 B 册：${JSON.stringify(item?.holders)}`);
    assert.equal(item?.expectations.length, 1, `它的判据也必须跟着进投影（改前那一整批判据消失）：${JSON.stringify(item?.expectations)}`);

    // ①b 四桶：它归 with_node，不落 conflict
    const reading = gapOfProject(f.project, ['x/f.ts'], ['x/f.ts']);
    assert.equal(reading.with_node, 1, 'node wins ⇒ 有节点就算入册（声明对该路径不适用）');
    assert.equal(reading.excluded, 0, '不许再落进「已声明排除」');
    assert.equal(reading.conflict, 0, '「声明 ∧ 节点」不再是债务桶（R49 之后按构造为 0）');
    assert.deepEqual(reading.gaps, [], '更不许变成缺口');

    // ①c 信息档仍然报出来（不红 ≠ 不报）：N 处声明被节点覆盖
    const info = excludedNodeConflicts(loadDesignSheetsForGate(f.project).sheets);
    assert.equal(info.conflict_files, 1, `信息档必须报出这一处覆盖：${JSON.stringify(info.conflicts)}`);
    assert.equal(info.conflicts[0]?.declared, 'sheet-a:x/', '要点名"哪册哪个前缀"（不然读端不知道该找谁）');
    assert.equal(info.expectations, 1, '信息档要量得出"覆掉了几条判据"');
  } finally {
    dropFixture(f);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② 异义必不命中（没有任何册给它建节点 ⇒ 声明照常生效）
// ════════════════════════════════════════════════════════════════════
test('② 声明照常生效：A 册声明 `x/`、**任何册都没有** `x/` 下的节点 ⇒ 该文件仍是 excluded', () => {
  const f = makeFixture();
  try {
    writeSheet(f.project, 'sheet-a', sheetOf('sheet-a', [], [{ path: 'x/', reason: 'A 册：这个目录不进册' }]));
    writeSheet(f.project, 'sheet-b', sheetOf('sheet-b', [{ id: 'nb', path: 'y/f.ts' }]));

    // ②a 判据函数本身（唯一语句）：声明 ⇒ 生效；有节点的路径 ⇒ 不生效
    const decls = [{ path: 'x/' }];
    const nodePaths = new Set(['y/f.ts']);
    assert.equal(excludedAppliesTo(decls, nodePaths, 'x/f.ts'), true, '没有节点的路径 ⇒ 声明照常生效（否则 R49 会把声明全废掉）');
    assert.equal(excludedAppliesTo(decls, new Set(['x/f.ts']), 'x/f.ts'), false, '有节点的路径 ⇒ 声明不适用');
    assert.equal(excludedAppliesTo(decls, nodePaths, 'x/f.ts'), true, '前缀形态与逐文件形态走同一把尺');

    // ②b 四桶：它落 excluded，不落 with_node / gaps
    const reading = gapOfProject(f.project, ['x/f.ts'], []);
    assert.equal(reading.excluded, 1, '声明照样生效 ⇒ 该文件是"已声明排除"');
    assert.equal(reading.with_node, 0, '没有任何册给它建节点');
    assert.deepEqual(reading.gaps, [], '被声明排除的文件不是缺口');

    // ②c 投影：没有节点 ⇒ 不进 design-db（这一半改前改后都对，这里钉住它没被 R49 弄坏）
    const plan = planDesignDb(f.project);
    assert.equal(plan.items.has('x/f.ts'), false, `没有被建节点的路径不该出现在投影里：${[...plan.items.keys()].join(',')}`);

    // ②d 信息档：没有覆盖关系 ⇒ 0 处（守卫不许把正常路径染红）
    const info = excludedNodeConflicts(loadDesignSheetsForGate(f.project).sheets);
    assert.equal(info.conflict_files, 0, `没有覆盖关系就不许报：${JSON.stringify(info.conflicts)}`);
  } finally {
    dropFixture(f);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ 消融：把「有节点优先」摘掉 ⇒ ① 必须红
// ════════════════════════════════════════════════════════════════════
test('③ 消融（可判的鉴别力）：旧判序的那份读数（conflict=1）**必须被断言打红**', () => {
  // 旧判序（改前）= 「有节点 ∧ 被声明 ⇒ conflict」：它把同一份输入读成 conflict 1 / with_node 0。
  // ★ 这里不复制实现，只复制**它会产生的那份读数** —— 于是"这一行被摘掉会不会红"变成可执行的问句。
  const oldShaped = { source_files: 1, with_node: 0, excluded: 0, conflict: 1, conflict_list: ['x/f.ts'], gaps: [] as string[] };
  assert.throws(
    () => assertSilentGapClosed(oldShaped),
    /冲突桶非空/,
    '旧判序的读数必须被断言打红 —— 否则"有节点优先"这一行删掉了也没人知道（这条判据就没鉴别力）',
  );

  // 反向（同一份输入、新判序）：不许抛，且 conflict 必须为 0 —— 证明红不是"一律抛"
  assert.doesNotThrow(() =>
    assertSilentGapClosed({ source_files: 1, with_node: 1, excluded: 0, conflict: 0, conflict_list: [], gaps: [] }),
  );

  // 端到端：同一份夹具在新判序下**不抛**，且读数就是 ① 里那一份
  const f = makeFixture();
  try {
    writeSheet(f.project, 'sheet-a', sheetOf('sheet-a', [], [{ path: 'x/', reason: 'A 册：这个目录不进册' }]));
    writeSheet(f.project, 'sheet-b', sheetOf('sheet-b', [{ id: 'nb', path: 'x/f.ts' }]));
    assert.doesNotThrow(() => gapOfProject(f.project, ['x/f.ts'], ['x/f.ts']), '新判序下同一份夹具必须通过闭合断言');
  } finally {
    dropFixture(f);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ 不变式：四桶和 === 源码数，且修后 conflict === 0
// ════════════════════════════════════════════════════════════════════
test('④ 不变式：`source_files === with_node + excluded + conflict + gaps` 成立，且 conflict 为 0', () => {
  const f = makeFixture();
  try {
    // 混合夹具：一个被覆盖的（x/f.ts）· 一个只被声明的（x/g.ts）· 一个干净的（y/h.ts）· 一个缺口（z/i.ts）
    writeSheet(f.project, 'sheet-a', sheetOf('sheet-a', [], [{ path: 'x/', reason: 'A 册：这个目录不进册' }]));
    writeSheet(f.project, 'sheet-b', sheetOf('sheet-b', [{ id: 'nb', path: 'x/f.ts' }, { id: 'nh', path: 'y/h.ts' }]));
    const sourceFiles = ['x/f.ts', 'x/g.ts', 'y/h.ts', 'z/i.ts'];
    const reading = gapOfProject(f.project, sourceFiles, ['x/f.ts']);
    assert.equal(
      reading.with_node + reading.excluded + reading.conflict + reading.gaps.length,
      reading.source_files,
      `四桶必须互斥穷尽：${JSON.stringify(reading)}`,
    );
    assert.deepEqual(
      { with_node: reading.with_node, excluded: reading.excluded, conflict: reading.conflict, gaps: reading.gaps },
      { with_node: 2, excluded: 1, conflict: 0, gaps: ['z/i.ts'] },
      `读数必须逐项对得上（conflict 必须 0）：${JSON.stringify(reading)}`,
    );
  } finally {
    dropFixture(f);
  }
});
