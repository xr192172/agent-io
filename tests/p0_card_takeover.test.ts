/**
 * P0 · **带异议接管**（`state=claimed` 且办的人不是我 ⇒ 等，或者带异议接管）。
 *
 * ## 病（上一张卡的实测结论）
 * R2「带异议领卡」已落地，但**触发点挂错了**：它挂在"两张卡的**改集相交**"上，而本仓实测**造不出那种情形**
 * （46 份画布的 `card` 全指向自己那个节点）。真实的争用点是**两个 agent 想要同一张卡 / 同一个节点**，
 * 而那条路今天被 `E-CLAIM-004`「卡已经在办」一句挡住。
 * 用户原话：「别人在动的时候你就不动弹……大家是在**同一个设计**上，而不是各做各的」。
 *
 * ## 本证锁三条（都是**状态机走不走得通**，不是文本）
 * ① A 领了这张卡 ⇒ B 直接 `claim` ⇒ **被拒**（E-CLAIM-004 的原文，一个字节都不能变）；
 * ② B 带**合法** `supersedes`（`against` = **这张卡自己**、judgements 覆盖它 5 条判据）⇒ **接管成功**：
 *    `owner` 换成 B、原 owner 进 `reopened_from`、`dissent_reason` 记为什么、**原 evidence 一条不少**；
 * ③ B 的 judgements 只覆盖 3/5 条 ⇒ **被拒**（E-CLAIM-018 且**点名缺的那两条**）—— 卡级接管**不放宽**门 3。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { claimTask, publishTask } from '../src/application/design/dsl_ops/task_ops.js';
import { writeRewritePlan, type RewritePlan } from '../src/application/design/db/rewrite_plan.js';
import { makeTempHome, readFeature, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

const A = 'subagent:card-a';
const B = 'subagent:card-b';

/**
 * 5 条后态判据（A 立的；B 要逐条表态才算"读全了这张卡"）
 *
 * ★ 2026-11-09 迁移（领卡门槛：条数 → **证据族**）：
 *   第 1 条从 `file-exists` 换成 **`behavior-cases`**（行为族）—— 否则 A 现在**领不到卡**
 *   （存在类不满足任何族），本文件三条用例的前置就都塌了。
 *   后 4 条保留 `file-exists`：它们是"逐条表态"的覆盖集（用例 ③ 用 3/5 说话），本就不是强度证据。
 */
const CRITERIA = [
  {
    kind: 'behavior-cases' as const,
    path: 'src/x.ts',
    symbol: 'a',
    phase: 'post' as const,
    cases: [{ given: [], expect: '1' }],
    why: 'A 立的第 1 条：a() 必须返回 1（行为族 —— 领卡要的那一族）',
  },
  { kind: 'file-exists' as const, path: 'src/b.ts', why: 'A 立的第 2 条' },
  { kind: 'file-exists' as const, path: 'src/c.ts', why: 'A 立的第 3 条' },
  { kind: 'file-exists' as const, path: 'src/d.ts', why: 'A 立的第 4 条' },
  { kind: 'file-exists' as const, path: 'src/e.ts', why: 'A 立的第 5 条' },
];

/** 对端判据的全部标识（顺序 = 册上顺序；与 claimTask 现算的同一形状） */
const REFS = CRITERIA.map((_e, i) => `decision:n1#${i}`);

/** 一份最小设计册：一个节点（带 5 条判据 + 一个文件路径）+ 一条画布（`card='n1'` ⇒ 改集非空） */
function writeSheet(home: string, feature: string, project: string): void {
  const dsl = {
    feature,
    title: feature,
    source_root: project,
    geometry: {
      nodes: [
        {
          id: 'n1',
          label: '被两个人盯上的节点',
          type: 'service',
          x: 0,
          y: 0,
          path: 'src/x.ts',
          decision: { summary: 'A 立的设计', expectations: CRITERIA },
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');

  // 被分析项目根：一个真文件 + 一份画布（★ 画布挂在 `card: 'n1'` 上 ⇒ `planChangeSetOfCard` 能算出改集）
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'x.ts'), 'export function a() { return 1; }\n', 'utf-8');
  // ★ 2026-11-02（subagent:canvas-db）：画布已入库（`tasks.db#plans`）—— 不再有盘上的 `.plan.json`
  writeRewritePlan(project, {
    path: 'src/x.ts',
    card: 'n1',
    frozen_at: '2026-10-30T00:00:00.000Z',
    entries: [
      {
        anchor: { symbol: 'a' },
        kind: 'rewrite',
        detail: '改 a 的实现',
        judgement_ref: 'decision:n1#0',
        status: 'open',
      },
    ],
  } as RewritePlan);
}

function cardOf(home: string, feature: string, nodeId: string): Record<string, unknown> {
  const dsl = readFeature(home, feature) as unknown as {
    geometry: { nodes: Array<Record<string, unknown>> };
    todos?: Array<Record<string, unknown>>;
  };
  const fromTodo = (dsl.todos ?? []).find((t) => t.id === nodeId);
  if (fromTodo) return fromTodo;
  const node = dsl.geometry.nodes.find((n) => n.id === nodeId)!;
  return node.task as Record<string, unknown>;
}

/** 直接改盘上的卡（模拟"A 干了一半、留下证据"这类卡外动作；读端每次从盘上读） */
function patchCard(home: string, feature: string, nodeId: string, patch: (c: Record<string, unknown>) => Record<string, unknown>): void {
  const file = path.join(home, '.agent-io', 'design', `${feature}.dsl.json`);
  const dsl = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown as {
    todos?: Array<Record<string, unknown>>;
    geometry: { nodes: Array<Record<string, unknown>> };
  };
  const idx = (dsl.todos ?? []).findIndex((t) => t.id === nodeId);
  if (idx >= 0) dsl.todos![idx] = patch(dsl.todos![idx]);
  else {
    const n = dsl.geometry.nodes.find((x) => x.id === nodeId)!;
    n.task = patch(n.task as Record<string, unknown>);
  }
  fs.writeFileSync(file, JSON.stringify(dsl, null, 2), 'utf-8');
}

/** B 的异议声明（`against` 由每个用例决定 —— 这正是本卡最容易被搞混的那一格） */
function supersedesOf(against: string, refs: readonly string[]): Record<string, unknown> {
  return {
    against,
    why: 'n1 的 5 条判据我逐条读过（src/a.ts 的入口、src/x.ts 的 1 个符号都看了）',
    judgements: refs.map((ref, i) => ({
      ref,
      verdict: i === 0 ? '被推翻' : '仍成立',
      why: `第 ${i + 1} 条：src/x.ts 的 1 处调用已核（改集 1 个符号）`,
    })),
    scope_change: '把 n1 的设计按我的读法重写',
  };
}

/** A 领到牌（publish ⇒ claim），并留下一条 evidence（"上一轮干过什么"） */
async function aClaims(home: string, feature: string, project: string): Promise<void> {
  writeSheet(home, feature, project);
  const pub = await publishTask({ feature, node_id: 'n1' });
  assert.equal((pub.data as { level?: string }).level, 'L2', '5 条后态判据 ⇒ 必须是 L2 实现卡');
  const r = await claimTask({ feature, node_id: 'n1', owner: A });
  assert.equal((r.data as { state?: string }).state, 'claimed', 'A 必须先真正领到这张卡');
  patchCard(home, feature, 'n1', (c) => ({
    ...c,
    evidence: [
      {
        kind: 'reading',
        command: 'node scripts/run-tests.mjs',
        observed: '测试门：文件 12 / 用例 47 / 通过 47 / 失败 0 / 跳过 0',
        at: new Date().toISOString(),
        agent: A,
      },
    ],
  }));
}

test('P0-takeover · A 领了卡 ⇒ B 直接 claim **被拒**（E-CLAIM-004 原文：卡已经在办）', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-takeover-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    await aClaims(home, 'p0tk1', project);

    const err = await claimTask({ feature: 'p0tk1', node_id: 'n1', owner: B }).then(
      () => null,
      (e: Error) => e,
    );
    assert.ok(err, '没有 supersedes ⇒ 必须仍被拒（这一档一个字节都不许放宽）');
    // ★ E-CLAIM-004 的原文（首句 + 指路）
    assert.match(err!.message, /claim 被拒（这张卡\*\*已经在办\*\*）：节点 "n1" 的 state=claimed/);
    assert.match(err!.message, new RegExp(`owner=${A}`));
    assert.match(err!.message, /这是\*\*别人的在办活\*\*（A7：卡不是你的）/);
    assert.match(err!.message, /claimed → claimed` 本来就不在迁移表里/);

    // 卡一个字节没动：owner 仍是 A、也没有 dissent_reason
    const card = cardOf(home, 'p0tk1', 'n1');
    assert.equal(card.owner, A);
    assert.equal(card.state, 'claimed');
    assert.equal(card.dissent_reason, undefined);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-takeover · B 带**合法** supersedes（against = 这张卡自己）⇒ 接管成功，换手 + 留痕 + evidence 不丢', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-takeover-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    await aClaims(home, 'p0tk2', project);
    const before = cardOf(home, 'p0tk2', 'n1');
    assert.equal((before.evidence as unknown[]).length, 1, '前提：A 已经干了一半（1 条证据）');

    const r = await claimTask({
      feature: 'p0tk2',
      node_id: 'n1',
      owner: B,
      // ★ `against` 填**正在被领的这张卡自己**（卡级接管档的唯一合法形态）
      supersedes: supersedesOf('n1', REFS),
    });

    const data = r.data as {
      state?: string;
      owner?: string;
      dissent_takeover?: { from_owner?: string | null; judgements?: number; files_read?: number };
    };
    assert.equal(data.state, 'claimed', '接管后 state 仍是 claimed（不是 candidate / 不是 done）');
    assert.equal(data.owner, B);
    assert.equal(data.dissent_takeover?.from_owner, A);
    assert.equal(data.dissent_takeover?.judgements, 5);
    assert.equal(data.dissent_takeover?.files_read, 1, '改集 = 这张卡自己的画布 ⇒ 1 个文件（src/x.ts）');

    // ★ 回执那一行（`edit_dsl` 批量回执只印首行 ⇒ 必须在首行里）
    const head = r.message.split('\n')[0];
    assert.match(head, new RegExp(`；异议接管 = 从 ${A} 接过 n1：推翻其 5 条判据（已通读 1 个文件）`));

    // ★ 落盘字段逐条核（这是"接管真的发生了、且账是齐的"的唯一证据）
    const card = cardOf(home, 'p0tk2', 'n1');
    assert.equal(card.state, 'claimed', 'state 不变（只换手）');
    assert.equal(card.owner, B, 'owner 换手给 B');
    assert.equal(card.reopened_from, A, '原 owner 留档');
    assert.match(String(card.dissent_reason ?? ''), /src\/a\.ts/, '理由（逐字 supersedes.why）落卡');
    assert.equal(card.reopened_at, undefined, '接管不是重开 ⇒ 不写 reopened_at（不借道 reopenGate）');
    const ev = card.evidence as Array<Record<string, unknown>>;
    assert.equal(ev.length, 1, '★ 原 owner 的 evidence **不许清**（上一轮干过什么要留档）');
    assert.match(String(ev[0].observed ?? ''), /用例 47/);
    const disputes = card.disputed_by as Array<Record<string, unknown>>;
    assert.equal(disputes?.length, 1, '对称账：这张卡自己被异议过一次');
    assert.equal(disputes[0].by, 'n1', '卡级接管里异议方与对端是同一张卡 ⇒ by = 本卡 id');
    const sup = (card.discussion as { supersedes?: { against?: string; judgements?: unknown[] } })?.supersedes;
    assert.equal(sup?.against, 'n1', '落在自己卡上的 supersedes.against = 这张卡自己');
    assert.equal(sup?.judgements?.length, 5);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-takeover · judgements 只覆盖 3/5 条 ⇒ **被拒**（E-CLAIM-018 且点名缺的两条）', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-takeover-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    await aClaims(home, 'p0tk3', project);

    const err = await claimTask({
      feature: 'p0tk3',
      node_id: 'n1',
      owner: B,
      supersedes: supersedesOf('n1', REFS.slice(0, 3)),
    }).then(
      () => null,
      (e: Error) => e,
    );
    assert.ok(err, '门 3 覆盖不全 ⇒ 必须拒（卡级接管不放宽「逐条表态」）');
    assert.match(err!.message, /E-CLAIM-018/);
    assert.match(err!.message, /未覆盖 2 条对端判据（对端卡共 5 条）：decision:n1#3、decision:n1#4/);
    // ★ 报文必须写清"这一档 against 是本卡自己"（最容易与"改集相交档"搞混的一格）
    assert.match(err!.message, /`against` \*\*必须是正在领的这张卡自己的 id\*\*/);

    // 一个字节都没落盘：owner / state / evidence 全都不变
    const card = cardOf(home, 'p0tk3', 'n1');
    assert.equal(card.owner, A);
    assert.equal(card.state, 'claimed');
    assert.equal((card.evidence as unknown[]).length, 1);
    assert.equal(card.dissent_reason, undefined);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
