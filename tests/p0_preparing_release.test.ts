/**
 * P0 · 两段式领取的**回滚路径**（T-RELEASE-DEADEND，2026-10-30 实测撞点，卡死一个验证流程）。
 *
 * ## 病（改前实测原文）
 * ```
 * publish 出一张 L1 卡（0 条后态判据，挂在一个**没有 decision** 的节点上）
 *   → claim  ⇒ preparing（E-CLAIM-009：领了但还不能开工，快照 expectations=[]）
 *   → release ⇒ 回滚被拒：节点 "n1" 现在**没有 decision**（快照是从 decision 拍的）⇒ 无法把判据写回。
 * ```
 * 根因：`writeTaskAndRestoreSnapshot` 对**所有**快照一律要求 `decision` 存在；
 * 而 **L1 卡本来就可以挂在没有 `decision` 的节点上**（L1 的活就是"去把判据建起来"），
 * 它 claim 进 preparing 时拍的快照 `expectations` 是**空数组** ⇒ **没有可还原的东西**，
 * 却被同一句"不可能状态"守卫拦住 ⇒ **两段式领取没有回滚路径，卡被锁死**（claim 不能重来、release 退不回）。
 *
 * ## 本证锁三条（都是**状态机走不走得通**，不是文本）
 * ① L1 卡 claim ⇒ state=`preparing` + 卡上有 `prepared_snapshot`（快照 0 条）；
 * ② release ⇒ **不抛**、state=`candidate`、快照已清、**节点仍没有 decision**（不许凭空造），
 *    且回执首行说清"空快照无需还原"；
 * ③ 守护分支不放宽：快照**非空** + 节点**无** decision ⇒ 仍抛（报文点名"N 条判据 / 节点没有 decision"）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { claimTask, expireTasks, publishTask, releaseTask } from '../src/application/design/dsl_ops/task_ops.js';
import { makeTempHome, readFeature, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

const OWNER = 'subagent:p0-release';

/** 一个**没有 decision**、也**没有 task** 的节点（L1 卡的真实落点） */
function writeSheet(home: string, feature: string, node: Record<string, unknown>): void {
  const dsl: DesignDSL = {
    feature,
    title: feature,
    geometry: { nodes: [node], edges: [] },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
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

function nodeOf(home: string, feature: string, nodeId: string): Record<string, unknown> {
  const dsl = readFeature(home, feature) as unknown as { geometry: { nodes: Array<Record<string, unknown>> } };
  return dsl.geometry.nodes.find((n) => n.id === nodeId)!;
}

test('P0-release · L1 卡 claim ⇒ preparing（快照 0 条判据）', async () => {
  const home = makeTempHome();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0rel1', { id: 'n1', label: '没有 decision 的节点', type: 'service', x: 0, y: 0 });

    const pub = await publishTask({ feature: 'p0rel1', node_id: 'n1' });
    assert.equal((pub.data as { level?: string }).level, 'L1', '该节点没有 decision ⇒ 必须是 L1 建构卡');

    const r = await claimTask({ feature: 'p0rel1', node_id: 'n1', owner: OWNER });
    const data = r.data as { state?: string; snapshot_expectations?: number };
    assert.equal(data.state, 'preparing');
    assert.equal(data.snapshot_expectations, 0);

    const card = cardOf(home, 'p0rel1', 'n1');
    assert.equal(card.state, 'preparing');
    const snapshot = card.prepared_snapshot as { expectations?: unknown[] } | null;
    assert.ok(snapshot, 'preparing 卡上必须有事务快照（放弃/超时的回滚依据）');
    assert.equal(snapshot!.expectations?.length, 0, '节点没有 decision ⇒ 快照 expectations 必须是空数组');
  } finally {
    rmRf(home);
  }
});

test('P0-release · release ⇒ 不抛、回 candidate、快照清空、节点仍没有 decision（不凭空造）', async () => {
  const home = makeTempHome();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0rel2', { id: 'n1', label: '没有 decision 的节点', type: 'service', x: 0, y: 0 });

    await publishTask({ feature: 'p0rel2', node_id: 'n1' });
    await claimTask({ feature: 'p0rel2', node_id: 'n1', owner: OWNER });

    // ★ 改前这里抛"回滚被拒：节点 n1 现在没有 decision"⇒ 卡锁死在 preparing
    const r = await releaseTask({
      feature: 'p0rel2',
      node_id: 'n1',
      reason: '走错了想放弃',
      agent: OWNER,
    });
    const data = r.data as { state?: string; snapshot_restore?: string };
    assert.equal(data.state, 'candidate');
    assert.equal(data.snapshot_restore, 'noop', '空快照 + 节点无 decision ⇒ 口径必须是 noop（未动节点；不是 restored）');
    // 首行自足：`edit_dsl` 批量回执只印首行
    const head = r.message.split('\n')[0];
    assert.match(head, /已放弃任务 "n1"：preparing → candidate/);
    assert.match(head, /快照 0 条判据：空快照无需还原/);
    assert.match(r.message, /无需还原/);

    const card = cardOf(home, 'p0rel2', 'n1');
    assert.equal(card.state, 'candidate');
    assert.equal(card.owner, null);
    assert.equal(card.claimed_at, null);
    assert.equal(card.prepared_snapshot, null, '快照用掉即删（它不是历史）');

    // ★★ 最重要的一条：**不许为了"还原"给节点凭空造一个 decision**
    const node = nodeOf(home, 'p0rel2', 'n1');
    assert.equal('decision' in node, false, '节点本来没有 decision ⇒ release 后仍必须没有');
    assert.equal(node.decision, undefined);
  } finally {
    rmRf(home);
  }
});

test('P0-release · 守护不放宽：快照非空 + 节点无 decision ⇒ 仍抛（点名判据条数与人工确认）', async () => {
  const home = makeTempHome();
  try {
    process.env.AGENT_IO_HOME = home;
    // 直接构造"不可能状态"：preparing 卡 + 非空快照，而节点没有 decision
    writeSheet(home, 'p0rel3', {
      id: 'n1',
      label: '没有 decision 的节点',
      type: 'service',
      x: 0,
      y: 0,
      task: {
        id: 'n1',
        summary: '构造态',
        state: 'preparing',
        owner: OWNER,
        claimed_at: '2026-10-30T00:00:00.000Z',
        judge_gate: 'strict',
        prepared_snapshot: {
          expectations: [{ kind: 'file-exists', path: 'src/x.ts', why: '这个文件必须在' }],
          at: '2026-10-30T00:00:00.000Z',
          missing: ['构造态'],
        },
      },
    });

    await assert.rejects(
      () => releaseTask({ feature: 'p0rel3', node_id: 'n1', reason: '构造态', agent: OWNER }),
      (err: Error) => {
        assert.match(err.message, /回滚被拒/);
        assert.match(err.message, /1 条判据/, '报文必须点名快照里有几条判据');
        assert.match(err.message, /没有 decision/, '报文必须点名节点现在没有 decision');
        assert.match(err.message, /人工确认/, '报文必须要求人工确认节点是否被删/重建');
        return true;
      },
      '快照非空而节点没有 decision 才是真正的"不可能状态" ⇒ 必须仍抛，不许静默放行',
    );

    // 抛错 ⇒ **一个字节都没落盘**：卡仍是 preparing（不半落盘）
    const card = cardOf(home, 'p0rel3', 'n1');
    assert.equal(card.state, 'preparing');
    assert.ok(card.prepared_snapshot, '抛错时快照必须原样留着（还原依据不能丢）');
  } finally {
    rmRf(home);
  }
});

test('P0-release · 空快照但节点**有** decision ⇒ 照旧清回 0 条（"快照空"≠"没 decision"）', async () => {
  const home = makeTempHome();
  try {
    process.env.AGENT_IO_HOME = home;
    // 节点带一个 summary、判据 0 条的 decision（存量形态）⇒ 快照同样 empty，
    // 但准备期写的判据**必须被清回 0 条**（t360 C3/C8 测的就是这条；不许因为"0 条"就跳过）
    writeSheet(home, 'p0rel5', {
      id: 'n1',
      label: '有 decision 但判据 0 条',
      type: 'service',
      x: 0,
      y: 0,
      decision: { summary: '夹具：判据空', expectations: [] },
    });

    await publishTask({ feature: 'p0rel5', node_id: 'n1' });
    await claimTask({ feature: 'p0rel5', node_id: 'n1', owner: OWNER });

    // 准备期乱写两条判据（模拟"补了一半又发现不该这么做"）
    const file = path.join(home, '.agent-io', 'design', 'p0rel5.dsl.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown as {
      geometry: { nodes: Array<Record<string, any>> };
    };
    raw.geometry.nodes[0].decision.expectations = [
      { kind: 'file-exists', path: 'src/nope.ts', why: '准备期残留 1' },
      { kind: 'source-has', path: 'src/x.ts', must: ['不该留下'], why: '准备期残留 2' },
    ];
    fs.writeFileSync(file, JSON.stringify(raw, null, 2), 'utf-8');

    const r = await releaseTask({ feature: 'p0rel5', node_id: 'n1', reason: '放弃', agent: OWNER });
    assert.equal((r.data as { snapshot_restore?: string }).snapshot_restore, 'restored');
    assert.match(r.message.split('\n')[0], /快照 0 条判据：已按原样还原/);

    const node = nodeOf(home, 'p0rel5', 'n1');
    assert.deepEqual((node.decision as { expectations?: unknown[] }).expectations, [], '必须清回 0 条（零残留）');
  } finally {
    rmRf(home);
  }
});

test('P0-release · expire 走同一个函数 ⇒ 同一口径（空快照的 preparing 卡也能被回收）', async () => {
  const home = makeTempHome();
  try {
    process.env.AGENT_IO_HOME = home;
    // 构造"租约早已过期"的 preparing 卡（30 天前领的；默认 TTL=2h）
    writeSheet(home, 'p0rel4', {
      id: 'n1',
      label: '没有 decision 的节点',
      type: 'service',
      x: 0,
      y: 0,
      task: {
        id: 'n1',
        summary: '构造态',
        state: 'preparing',
        owner: OWNER,
        claimed_at: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(),
        judge_gate: 'strict',
        prepared_snapshot: { expectations: [], at: new Date().toISOString(), missing: [] },
      },
    });

    const r = await expireTasks({ feature: 'p0rel4' });
    assert.match(r.message, /已收回 1 张过期租约/);
    assert.match(r.message, /空快照（0 条判据）无需还原（节点未动）/);

    const card = cardOf(home, 'p0rel4', 'n1');
    assert.equal(card.state, 'candidate');
    assert.equal(card.prepared_snapshot, null);
    assert.equal((card.expired_from as { owner?: string }).owner, OWNER);
    assert.equal('decision' in nodeOf(home, 'p0rel4', 'n1'), false);
  } finally {
    rmRf(home);
  }
});
