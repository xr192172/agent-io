/**
 * 目标③（一处权威）的机器判据：**一个受断言的文件只许一个册持有**。
 *
 * ## 为什么它要有测试（而不是"门红了就行"）
 * 这条检查的**唯一**价值是"下一个人再往第二册写同一文件的判据时会红"。
 * 实测病史：2026-10-31 收口那次读数为 0，此后两条新判据分别写进 `agent-io` 与 `task-system-plan`
 * 的同一批文件 ⇒ 立刻变 3 个双册 path（`write_gate.ts` 2:3 / `expectation.ts` 1:11 / `validator.ts` 1:3），
 * 而**没有任何读数因此变红**。所以这里钉住三件事：
 * ① 归属重复被算出来、且报文点名**是哪两册、各几条**（人能直接照着修）；
 * ② 只被一册断言 ⇒ 不算重复（不把门变成"任何断言都红"）；
 * ③ 归属按判据**自己的** `e.path` 算（缺省回落节点 `path`）—— 这是最容易写错的一格：
 *    节点 `file_src_x_ts` 上完全可以有断言 `src/y.ts` 的判据，按节点 path 统计会**漏数**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkDesignDbStructure, renderOwnership } from '../src/application/design/db/gen_design_db.js';
import { rmRf } from './helpers/i1_fixture.js';

type Exp = Record<string, unknown>;

interface NodeSpec {
  id: string;
  /** 节点自己的 path（缺省 = 没有 path 的节点，如 service / doc） */
  path?: string;
  expectations: Exp[];
}

/** 造一个"项目根"：只有 `.agent-io/design/*.dsl.json`（本检查是纯 DSL 读取，不碰 cache.db） */
function makeProject(books: Record<string, NodeSpec[]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-own-'));
  const dir = path.join(root, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  for (const [feature, nodes] of Object.entries(books)) {
    const dsl = {
      feature,
      title: feature,
      source_root: root,
      geometry: {
        nodes: nodes.map((n) => ({
          id: n.id,
          label: n.id,
          type: 'file',
          x: 0,
          y: 0,
          ...(n.path ? { path: n.path } : {}),
          decision: { summary: `${n.id} 的卡`, expectations: n.expectations },
        })),
        edges: [],
      },
      semantic: { files: [] },
      todos: [],
    };
    fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
  }
  return root;
}

const callExists = (p: string, target: string): Exp => ({ kind: 'call-exists', path: p, symbol: target, target });

test('目标③ · 同一个 path 被两册断言 ⇒ 归属重复 1 条，报文点名两册与条数（正例）', () => {
  const root = makeProject({
    bookA: [{ id: 'n_a', path: 'src/x.ts', expectations: [callExists('src/x.ts', 'fa')] }],
    bookB: [
      {
        id: 'n_b',
        path: 'src/x.ts',
        expectations: [
          callExists('src/x.ts', 'f1'),
          callExists('src/x.ts', 'f2'),
          callExists('src/x.ts', 'f3'),
        ],
      },
    ],
  });
  try {
    const r = checkDesignDbStructure(root);
    assert.equal(r.assertedPaths, 1, '分母：受断言路径 1 个');
    assert.deepEqual(r.ownership, [
      'src/x.ts 被 bookB(3 条) 与 bookA(1 条) 共同断言 ⇒ 只能一册持有（多者持有；平手归 agent-io）',
    ]);
  } finally {
    rmRf(root);
  }
});

test('目标③ · 各册断言各自的文件 ⇒ 归属重复 0（反例：门不许变成"任何断言都红"）', () => {
  const root = makeProject({
    bookA: [{ id: 'n_a', path: 'src/x.ts', expectations: [callExists('src/x.ts', 'fa')] }],
    bookB: [{ id: 'n_b', path: 'src/y.ts', expectations: [callExists('src/y.ts', 'fb')] }],
  });
  try {
    const r = checkDesignDbStructure(root);
    assert.equal(r.assertedPaths, 2);
    assert.deepEqual(r.ownership, []);
  } finally {
    rmRf(root);
  }
});

test('目标③ · 归属按 e.path 算（缺省回落节点 path）：无 path 节点上的判据同样计入 ⇒ 仍算重复', () => {
  const root = makeProject({
    // A 册：一个**没有 path** 的服务节点，判据自己点名 src/z.ts
    bookA: [{ id: 'svc_a', expectations: [callExists('src/z.ts', 'fa')] }],
    // B 册：src/z.ts 的文件节点，判据不写 path（回落节点 path）
    bookB: [{ id: 'n_b', path: 'src/z.ts', expectations: [{ kind: 'file-exists', why: '落盘比对' }] }],
  });
  try {
    const r = checkDesignDbStructure(root);
    assert.equal(r.ownership.length, 1, '按 e.path 归属 ⇒ 两边都在断言 src/z.ts');
    assert.match(r.ownership[0], /^src\/z\.ts 被 bookA\(1 条\) 与 bookB\(1 条\) 共同断言 ⇒ 只能一册持有/);
  } finally {
    rmRf(root);
  }
});

test('目标③ · renderOwnership：条数多者排前，平手按册名 ⇒ 报文先给"该归谁"', () => {
  assert.equal(
    renderOwnership({
      path: 'src/x.ts',
      claims: [
        { feature: 'alpha', count: 2 },
        { feature: 'beta', count: 5 },
        { feature: 'gamma', count: 2 },
      ],
    }),
    'src/x.ts 被 beta(5 条) 与 alpha(2 条) 与 gamma(2 条) 共同断言 ⇒ 只能一册持有（多者持有；平手归 agent-io）',
  );
});
