/**
 * 判定引用解析必须落到**持有该 path 的那本册** —— 不是"册序第一份同名节点"。
 *
 * ## 它钉的是什么（改前实测的病）
 * 一个 path 的断言搬到持有册后，另一册里的**同名节点仍在**、只是 0 条断言
 * （本仓实测：`file_src_infrastructure_storage_ts` 在 `agent-io` 0 条、在 `task-system-plan` 9 条；
 * 全仓同类 = 42 个节点）。改前 `resolveJudgementKind` / `expectationOf` 都是「按册序取第一个同名节点」
 * ⇒ 命中 0 条那一册 ⇒ 报文 `expectations[1] 不存在（该节点有 0 条）`，而它读起来和
 * "设计里没这条判据"一模一样 ⇒ 画布的 `judgement_ref` 永远解不出来，代理只能绕过。
 *
 * ## 四条判据（缺一不可）
 * ① **正例**：断言在持有册 ⇒ 解得到**那一条**（不是 null，也不是另一册）；
 * ② **反例（关键）**：两册同名节点都非空 ⇒ **报歧义并全列候选**，不许静默挑册序第一份；
 * ③ **零断言**：同名节点全 0 条 ⇒ 报文带"在哪几册出现过、各几条"（0.12：分母要露出来）；
 * ④ **与归属门同一把尺**：断言"归属 A 但住在 B" ⇒ 本解析**与** `gen-db-check` 的 ⑦ 归属门
 *    **同时**报错（证明是一把尺，不是两把）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkDesignDbStructure,
  loadDesignSheetsForGate,
  resolveDecisionExpectation,
} from '../src/application/design/db/gen_design_db.js';
import { resolveJudgementKind } from '../src/application/write_gate.js';
import { planJudgementGaps, type RewritePlan } from '../src/application/design/db/rewrite_plan.js';
import { rmRf } from './helpers/i1_fixture.js';

type Exp = Record<string, unknown>;

interface NodeSpec {
  id: string;
  /** 节点自己的 path（缺省 = 没有 path 的节点，如 service / doc） */
  path?: string;
  expectations: Exp[];
}

/** 造一个"项目根"：只有 `.agent-io/design/*.dsl.json`（本判据是纯 DSL 读取，不碰 cache.db） */
function makeProject(books: Record<string, NodeSpec[]>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-jref-'));
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

const plan = (ref: string): RewritePlan =>
  ({
    path: 'src/x.ts',
    entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'd', judgement_ref: ref, status: 'open' }],
  }) as RewritePlan;

test('① 正例：断言搬到持有册 ⇒ judgement_ref 解到**持有册那条**（不是 0 断言那册、不是 null）', () => {
  const root = makeProject({
    // 册序在前的那本：同名节点在、但 0 条断言（欠债的形态）
    'agent-io': [{ id: 'file_src_x_ts', path: 'src/x.ts', expectations: [] }],
    // 真正的持有册：断言住这里
    'task-system-plan': [
      {
        id: 'file_src_x_ts',
        path: 'src/x.ts',
        expectations: [
          { kind: 'source-has', path: 'src/x.ts', must: ['export'], why: '导出' },
          callExists('src/x.ts', 'targetOfHoldingSheet'),
        ],
      },
    ],
  });
  try {
    const sheets = loadDesignSheetsForGate(root).sheets;
    assert.equal(sheets.length, 2, '夹具：两册都在');

    const r = resolveDecisionExpectation('file_src_x_ts', 1, sheets);
    assert.equal(r.ok, true, `解析必须成功（改前：按册序命中 agent-io ⇒ 0 条 ⇒ 解不出来）；实得 ${JSON.stringify(r)}`);
    if (r.ok) {
      assert.equal(r.feature, 'task-system-plan', '必须落到持有册，不是册序第一份');
      assert.equal(String((r.exp as { target?: string }).target), 'targetOfHoldingSheet', '拿到的必须是持有册那条断言本体');
      assert.equal(r.assertedPath, 'src/x.ts');
    }

    // 走真实入口（画布 -> 判据种类）：cert 之外只有这一条路
    assert.deepEqual(resolveJudgementKind({ judgement_ref: 'decision:file_src_x_ts#1' }, root), { kind: 'call-exists' });
    // 画布强度关卡也据此判 —— 解不出来就是缺口
    assert.deepEqual(planJudgementGaps(plan('decision:file_src_x_ts#1'), (e) => resolveJudgementKind(e, root)), []);
  } finally {
    rmRf(root);
  }
});

test('② 反例：两册同名节点**都非空** ⇒ 报歧义并全列候选（不许静默挑册序第一份）', () => {
  const root = makeProject({
    'agent-io': [
      { id: 'n_x', path: 'src/x.ts', expectations: [{ kind: 'file-exists', path: 'src/a.ts', why: 'A 的说法' }] },
    ],
    'task-system-plan': [
      {
        id: 'n_x',
        path: 'src/x.ts',
        expectations: [
          { kind: 'file-exists', path: 'src/a.ts', why: '占位' },
          { kind: 'file-exists', path: 'src/b.ts', why: 'B 的说法' },
        ],
      },
    ],
  });
  try {
    const sheets = loadDesignSheetsForGate(root).sheets;
    const r = resolveDecisionExpectation('n_x', 0, sheets);
    assert.equal(r.ok, false, '两册都非空 ⇒ 必须报错，不许挑一个');
    const why = r.ok ? '' : r.why_not;
    assert.match(why, /归属不唯一/, `报文要点明"归属不唯一"；实得：${why}`);
    assert.match(why, /agent-io（/, '候选必须列出 agent-io');
    assert.match(why, /task-system-plan（/, '候选必须列出 task-system-plan');

    const kind = resolveJudgementKind({ judgement_ref: 'decision:n_x#0' }, root);
    assert.ok(kind.why_not && /归属不唯一/.test(kind.why_not), '判据种类解析必须同样解不出来');

    // 画布强度关卡：这条不许被静默当成"有判据"
    const gaps = planJudgementGaps(plan('decision:n_x#0'), (e) => resolveJudgementKind(e, root));
    assert.equal(gaps.length, 1);
    assert.match(gaps[0], /归属不唯一/);
  } finally {
    rmRf(root);
  }
});

test('③ 零断言：同名节点全 0 条 ⇒ 报文带"在哪几册出现过、各几条"（分母要露出来）', () => {
  const root = makeProject({
    'agent-io': [{ id: 'file_src_y_ts', path: 'src/y.ts', expectations: [] }],
    'task-system-plan': [{ id: 'file_src_y_ts', path: 'src/y.ts', expectations: [] }],
  });
  try {
    const sheets = loadDesignSheetsForGate(root).sheets;
    const r = resolveDecisionExpectation('file_src_y_ts', 0, sheets);
    assert.equal(r.ok, false);
    const why = r.ok ? '' : r.why_not;
    assert.match(why, /agent-io\(0 条\)/, `报文必须给出每册条数；实得：${why}`);
    assert.match(why, /task-system-plan\(0 条\)/, `报文必须给出每册条数；实得：${why}`);
    assert.match(why, /2 册/, '报文必须给出分母（它在几册里出现过）');
    // 与"节点根本不存在"必须可区分（0.12：两类病不许同一个报文）
    const missing = resolveDecisionExpectation('n_nobody', 0, sheets);
    assert.equal(missing.ok, false);
    assert.match(missing.ok ? '' : missing.why_not, /找不到节点 n_nobody/);
  } finally {
    rmRf(root);
  }
});

test('④ 同一把尺：断言"归属 A 但住在 B" ⇒ 本解析与 gen-db-check 的归属门**同时**报错', () => {
  // A 册：一个**没有 path** 的服务节点，判据自己点名 src/z.ts（= 归属 A）
  // B 册：src/z.ts 的文件节点，判据也断言 src/z.ts（= 住在 B）
  // ⇒ 两册都断言 src/z.ts ⇒ 归属账 size=2
  const root = makeProject({
    'agent-io': [{ id: 'svc_a', expectations: [callExists('src/z.ts', 'fa')] }],
    'task-system-plan': [{ id: 'n_b', path: 'src/z.ts', expectations: [callExists('src/z.ts', 'fb')] }],
  });
  try {
    // 门：归属重复 1 条，且点名 src/z.ts
    const gate = checkDesignDbStructure(root);
    assert.equal(gate.ownership.length, 1, `归属门必须红；实得 ${JSON.stringify(gate.ownership)}`);
    assert.match(gate.ownership[0], /^src\/z\.ts 被 /);

    // 解析：同一个 path、同一条归属账 ⇒ 也必须红，且说得出"归属重复"
    const sheets = loadDesignSheetsForGate(root).sheets;
    const r = resolveDecisionExpectation('n_b', 0, sheets);
    assert.equal(r.ok, false, '解析不许放行"住在 B 但归属 A"的判据');
    const why = r.ok ? '' : r.why_not;
    assert.match(why, /归属重复/, `报文要点明归属重复（与门的 ⑦ 同一条判据）；实得：${why}`);
    assert.match(why, /src\/z\.ts/, '报文必须点名那个受断言的文件');

    // 两者的"谁在断言它"必须一致：同一本归属账
    const claims = (r.ok ? '' : r.why_not).match(/agent-io\(\d+ 条\) 与 task-system-plan\(\d+ 条\)/);
    assert.ok(claims, `解析报文的归属账要与门同口径；实得：${why}`);
  } finally {
    rmRf(root);
  }
});
