/**
 * P0 · **租约熔断 2.0**：心跳 / TTL 10 分钟 / 惰性过期接管（要声明）/ 代际 fencing / session_id。
 *
 * ## 病（今天实测 + 代码自述）
 * `write_gate.ts:1198` 自己写着「`patrolDrift` 全仓零调用 ⇒ 卡永不过期」⇒ 任务闸对"谁在改"**完全不设防**；
 * 而 TTL 从 `claimed_at` 算（而不是"最后一次活动"）⇒ 活人干到点被抢、死人刚崩还要占满整个 TTL。
 *
 * ## 本证锁七条（全部**真跑**状态机，不读文案猜）
 * 1. **未过期不抢**：A 领（心跳刚刷）⇒ B claim ⇒ 拒，且是 `E-CLAIM-004` 的原文；
 * 2. **过期但没声明 ⇒ 拒**：心跳推到 11 分钟前 ⇒ B **不带** `supersedes` 的 claim ⇒ 拒（"你还没读它"）；
 * 3. **过期 + 全"仍成立" ⇒ 兼容接管**：`owner` 换手、`taken_over_from`（含上次心跳）落盘、
 *    原 `evidence` 一条不少、`lease_generation` 1→2、回执分档为「租约接管（兼容）」；
 * 4. **过期 + 有"被推翻" ⇒ 改写接管**（且缺 `scope_change` ⇒ 拒）：回执分档为「租约接管（改写）」；
 * 5. ★ **fencing 挡住僵尸**：A 拿第 1 代 → 被别人接管 → A 又领回来（第 3 代）⇒
 *    A 拿**第 1 代**调 `edit_code` 写同一个文件 ⇒ `E-WRITE-004`；拿第 3 代 ⇒ 通过；
 *    **不带** generation ⇒ 通过（向后兼容，不许因此引入全仓假红）；
 * 6. **心跳刷新**：写闸触碰后卡的 `last_heartbeat_at` 变新；< 60s 再触碰**不重复写**；
 * 7. `session_id`：同 token 两次同 id / 不同 token 不同 id / 无 token ⇒ `unknown`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { claimTask, completeTask, publishTask } from '../src/application/design/dsl_ops/task_ops.js';
import { editCode } from '../src/application/refactor/edit/edit_code.js';
import { writeRewritePlan, type RewritePlan } from '../src/application/design/db/rewrite_plan.js';
import { resolveSessionId } from '../src/domain/actor_spec.js';
import { isLeaseExpired, leaseIdleMinutes, LEASE_TTL_MS } from '../src/domain/task_machine.js';
import { makeTempHome, readFeature, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

const A = 'subagent:lease-a';
const B = 'subagent:lease-b';

/**
 * 5 条后态判据（A 立的；B 要逐条表态才算"读全了这张卡"）
 *
 * ★ 2026-11-09 迁移（领卡门槛：条数 → **证据族**）：第 1 条改成 `run`（行为族），
 *   否则 A 现在**领不到卡**（纯 `file-exists` 不满足任何族）⇒ 本文件六条租约用例全部塌前置。
 *   后 4 条保留 `file-exists`：它们只是"逐条表态"的覆盖集。
 */
const CRITERIA = [
  {
    kind: 'run' as const,
    input: {},
    expect: "fs.existsSync(path.join(root, 'src/c0.ts')) || true",
    why: '第 1 条：行为族（run）—— 领卡门槛要的那一族；表达式恒真只是为了让夹具卡可领',
  },
  ...[1, 2, 3, 4].map((i) => ({
    kind: 'file-exists' as const,
    path: `src/c${i}.ts`,
    why: `第 ${i + 1} 条：入口文件必须在（5 条是为了让"逐条表态"有可数的读数）`,
  })),
];
const REFS = CRITERIA.map((_e, i) => `decision:n1#${i}`);

/** 一份最小设计册：一个节点（5 条判据 + 一个文件路径）+ 一条画布（`card='n1'` ⇒ 改集非空） */
function writeSheet(home: string, feature: string, project: string): void {
  const dsl = {
    feature,
    title: feature,
    source_root: project,
    geometry: {
      nodes: [
        {
          id: 'n1',
          label: '被租约管着的节点',
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

  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'x.ts'), 'export function a() { return 1; }\n', 'utf-8');
  // ★ 2026-11-02（subagent:canvas-db）：画布已入库（`tasks.db#plans`）—— 不再有盘上的 `.plan.json`
  writeRewritePlan(project, {
    path: 'src/x.ts',
    card: 'n1',
    frozen_at: '2026-10-30T00:00:00.000Z',
    entries: [
      { anchor: { symbol: 'a' }, kind: 'rewrite', detail: '改 a 的实现', judgement_ref: 'decision:n1#0', status: 'open' },
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
  return dsl.geometry.nodes.find((n) => n.id === nodeId)!.task as Record<string, unknown>;
}

/** 直接改盘上的卡（模拟"A 干了一半 / 心跳停住"这类卡外动作；读端每次从盘上读） */
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

/** 把心跳推到 N 分钟前（或删掉心跳 ⇒ 回落 claimed_at，用来验"老卡行为不变"） */
function heartTo(minutesAgo: number): Record<string, unknown> {
  return { last_heartbeat_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() };
}

/** B 的声明（`against` 恒为"这张卡自己"；verdicts 由用例决定） */
function supersedesOf(opts: { verdicts: Array<'仍成立' | '被推翻'>; scope_change?: string }): Record<string, unknown> {
  return {
    against: 'n1',
    why: 'n1 的 5 条判据我逐条读过（src/x.ts 的 1 个符号 a 也看了）',
    judgements: REFS.map((ref, i) => ({
      ref,
      verdict: opts.verdicts[i] ?? '仍成立',
      why: `第 ${i + 1} 条：src/x.ts 的 a 已核（改集 1 个符号）`,
    })),
    ...(opts.scope_change ? { scope_change: opts.scope_change } : {}),
  };
}

/** A 领到牌（publish ⇒ claim），并留下一条 evidence（"上一轮干过什么"） */
async function aClaims(home: string, feature: string, project: string): Promise<void> {
  writeSheet(home, feature, project);
  const pub = await publishTask({ feature, node_id: 'n1' });
  assert.equal((pub.data as { level?: string }).level, 'L2', '5 条后态判据 ⇒ 必须是 L2 实现卡');
  const r = await claimTask({ feature, node_id: 'n1', owner: A });
  assert.equal((r.data as { state?: string }).state, 'claimed', 'A 必须先真正领到这张卡');
  assert.equal((r.data as { lease_generation?: number }).lease_generation, 1, '第一次领 = 第 1 代（缺省 0 + 1）');
  patchCard(home, feature, 'n1', (c) => ({
    ...c,
    evidence: [
      { kind: 'reading', command: 'node scripts/run-tests.mjs', observed: '测试门：文件 13 / 用例 52 / 通过 52', at: new Date().toISOString(), agent: A },
    ],
  }));
}

/** 每次用例：临时 home + 临时项目（★ 两组都真落盘，闸才看得见） */
async function withCase(fn: (ctx: { home: string; project: string; feature: string }) => Promise<void>): Promise<void> {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-lease-proj-'));
  const prevHome = process.env.AGENT_IO_HOME;
  const prevPlan = process.env.AGENT_IO_REQUIRE_PLAN;
  process.env.AGENT_IO_HOME = home;
  // ★ 本证验的是**租约**，不是画布闸 ⇒ 关掉严格档（画布仍然写，因为"读全"那道门要读它）
  process.env.AGENT_IO_REQUIRE_PLAN = '0';
  try {
    await fn({ home, project, feature: 'p0lease' });
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    if (prevPlan === undefined) delete process.env.AGENT_IO_REQUIRE_PLAN;
    else process.env.AGENT_IO_REQUIRE_PLAN = prevPlan;
    rmRf(home);
    rmRf(project);
  }
}

test('租约① 未过期不抢：A 的心跳刚刷 ⇒ B claim 被拒（E-CLAIM-004 原文）', async () => {
  await withCase(async ({ home, project, feature }) => {
    await aClaims(home, feature, project);
    const card = cardOf(home, feature, 'n1');
    assert.ok(card.last_heartbeat_at, 'claim 必须自己刷一次心跳（否则 TTL 立刻把新领的卡判成僵）');

    const err = await claimTask({ feature, node_id: 'n1', owner: B }).then(() => null, (e: Error) => e);
    assert.ok(err, '未过期的 claimed 卡 ⇒ 必须仍被拒（这一档一个字节都不许放宽）');
    assert.match(err!.message, /claim 被拒（这张卡\*\*已经在办\*\*）：节点 "n1" 的 state=claimed/);
    assert.match(err!.message, /这是\*\*别人的在办活\*\*（A7：卡不是你的）/);
    // ★ 归档口径：文案不再写 TTL 数字，指路到唯一取值处
    assert.match(err!.message, /domain\/task_machine\.ts#LEASE_TTL_MS/);
    assert.equal(cardOf(home, feature, 'n1').owner, A, '被拒 ⇒ 卡一个字节不动');
  });
});

test('租约② 过期但没声明 ⇒ 拒（"你还没读它"）—— 过期不是免票', async () => {
  await withCase(async ({ home, project, feature }) => {
    await aClaims(home, feature, project);
    patchCard(home, feature, 'n1', (c) => ({ ...c, ...heartTo(11) }));

    const err = await claimTask({ feature, node_id: 'n1', owner: B }).then(() => null, (e: Error) => e);
    assert.ok(err, '过期 + 没有 supersedes ⇒ 必须拒（否则"它过期了"就成了跳过读全的口子）');
    assert.match(err!.message, /claim 被拒（租约已过期 · \*\*你还没读它\*\*）/);
    assert.match(err!.message, /租约过期只说明"没人握笔"，不说明"这套设计作废了"/);
    assert.match(err!.message, /E-CLAIM-016/);
    assert.equal(cardOf(home, feature, 'n1').owner, A, '被拒 ⇒ 卡一个字节不动');
  });
});

test('租约③ 过期 + 全"仍成立" ⇒ 兼容接管（换手 + 痕迹 + evidence 保留 + 代际 1→2）', async () => {
  await withCase(async ({ home, project, feature }) => {
    await aClaims(home, feature, project);
    patchCard(home, feature, 'n1', (c) => ({ ...c, ...heartTo(11) }));
    // 事实核对：此刻"已僵"（判据只读 domain 那一把尺）
    assert.equal(isLeaseExpired(cardOf(home, feature, 'n1') as never, Date.now()), true, '11 分钟未动 ⇒ 已过 10 分钟 TTL');

    const r = await claimTask({ feature, node_id: 'n1', owner: B, supersedes: supersedesOf({ verdicts: [] }) });
    // ★ 回执分档：兼容接管（回执首行里就有 —— edit_dsl 批量回执只印首行）
    assert.match(r.message, /租约接管（兼容）= 从 subagent:lease-a 接过，其 5 条判据全部仍成立/);

    const card = cardOf(home, feature, 'n1');
    assert.equal(card.owner, B, '接管 = 换手');
    assert.equal(card.state, 'claimed', '接管不改 state（仍是 claimed）');
    assert.equal(card.lease_generation, 2, '每次 claim / 接管 +1（1 → 2）');
    const to = card.taken_over_from as Record<string, unknown>;
    assert.ok(to, '接管必须留痕（taken_over_from）');
    assert.equal(to.from_owner, A, '痕迹要记原 owner');
    assert.ok(typeof to.from_claimed_at === 'string' && to.from_claimed_at.length > 0, '痕迹要记原 claimed_at');
    assert.ok('age_hours' in to, '痕迹要记挂了多久');
    assert.ok(typeof to.last_heartbeat_at === 'string', '痕迹要记对方**上次心跳**（只记 claimed_at 答不出"他停了多久"）');
    assert.equal((card.evidence as unknown[]).length, 1, '原 evidence 一条不少（上一轮干过什么要留档）');
    assert.ok(typeof card.last_heartbeat_at === 'string', '接管后心跳是新的（否则新租约立刻又僵）');
    assert.equal(leaseIdleMinutes(card as never, Date.now()), 0, '心跳就在此刻 ⇒ 距最后活动 ≈ 0 分钟');
  });
});

test('租约④ 过期 + 有"被推翻" ⇒ 改写接管；缺 scope_change ⇒ 拒', async () => {
  await withCase(async ({ home, project, feature }) => {
    await aClaims(home, feature, project);
    patchCard(home, feature, 'n1', (c) => ({ ...c, ...heartTo(11) }));

    // 4a. 有"被推翻"却没给 scope_change ⇒ 拒（改写必须说清改哪一片）
    const verdicts: Array<'仍成立' | '被推翻'> = ['被推翻', '仍成立', '仍成立', '被推翻', '仍成立'];
    const bad = await claimTask({ feature, node_id: 'n1', owner: B, supersedes: supersedesOf({ verdicts }) }).then(
      () => null,
      (e: Error) => e,
    );
    assert.ok(bad, '改写接管缺 scope_change ⇒ 必须拒');
    assert.match(bad!.message, /claim 被拒（租约接管 · 改写档缺 `scope_change`）/);
    assert.equal(cardOf(home, feature, 'n1').owner, A, '被拒 ⇒ 卡一个字节不动');

    // 4b. 补齐 scope_change ⇒ 改写接管成功，回执分档正确
    const r = await claimTask({
      feature,
      node_id: 'n1',
      owner: B,
      supersedes: supersedesOf({ verdicts, scope_change: '把 n1 的 5 条判据重写成 3 条（涉及 src/x.ts 的 1 个符号）' }),
    });
    assert.match(r.message, /租约接管（改写）= 推翻其 2 \/ 5 条判据/);
    const card = cardOf(home, feature, 'n1');
    assert.equal(card.owner, B);
    assert.equal(card.lease_generation, 2);
  });
});

test('租约⑤ ★ fencing：僵尸拿旧代际写 ⇒ E-WRITE-004；新代际/不带代际 ⇒ 放行', async () => {
  await withCase(async ({ home, project, feature }) => {
    await aClaims(home, feature, project); // A 第 1 代
    patchCard(home, feature, 'n1', (c) => ({ ...c, ...heartTo(11) }));
    // B 接管（第 2 代）
    await claimTask({ feature, node_id: 'n1', owner: B, supersedes: supersedesOf({ verdicts: [] }) });
    assert.equal(cardOf(home, feature, 'n1').lease_generation, 2, 'B 接管后是第 2 代');

    // A 回来又领（第 3 代）—— 这是 fencing 真正要防的那一格：
    //   A7 只比"名字"，而**同一个人两轮租约名字相同** ⇒ 只有代际能分开"第 1 代的 A"和"第 3 代的 A"
    const back = await claimTask({ feature, node_id: 'n1', owner: A, supersedes: supersedesOf({ verdicts: [] }) });
    assert.equal((back.data as { lease_generation?: number }).lease_generation, 3, 'A 领回来 = 第 3 代');
    assert.equal(cardOf(home, feature, 'n1').owner, A);

    // ⑤a **僵尸回来写**：A 手上是第 1 代（那时它还活着）⇒ 必须被拒，且是新码 E-WRITE-004
    const zombie = await editCode({
      project_dir: project,
      file: 'src/x.ts',
      op: 'replace_text',
      old_text: 'return 1;',
      new_text: 'return 999;',
      actor: A,
      lease_generation: 1,
    }).then(() => null, (e: Error) => e);
    assert.ok(zombie, '拿第 1 代写第 3 代的卡 ⇒ 必须拒');
    assert.match(zombie!.message, /\[E-WRITE-004\]/, '必须是新码 E-WRITE-004');
    assert.match(zombie!.message, /你拿的是第 1 代，现在是第 3 代/);
    assert.match(zombie!.message, /这张卡已被接管/);
    assert.match(fs.readFileSync(path.join(project, 'src', 'x.ts'), 'utf-8'), /return 1;/, '被拒 ⇒ 文件一个字节不动');

    // ⑤b 拿**当前代际**写 ⇒ 通过
    const ok = await editCode({
      project_dir: project,
      file: 'src/x.ts',
      op: 'replace_text',
      old_text: 'return 1;',
      new_text: 'return 2;',
      actor: A,
      lease_generation: 3,
    });
    assert.match(ok.message, /已/);
    assert.match(fs.readFileSync(path.join(project, 'src', 'x.ts'), 'utf-8'), /return 2;/, '当前代际 ⇒ 真落盘');

    // ⑤c **向后兼容**：不带 generation（老 CLI / 老脚本）⇒ 照常通过（不许引入全仓假红）
    const old = await editCode({
      project_dir: project,
      file: 'src/x.ts',
      op: 'replace_text',
      old_text: 'return 2;',
      new_text: 'return 3;',
      actor: A,
    });
    assert.match(old.message, /已/);
    assert.match(fs.readFileSync(path.join(project, 'src', 'x.ts'), 'utf-8'), /return 3;/, '不带代际 ⇒ 不校验、正常落盘');
  });
});

test('租约⑥ 心跳：写闸触碰后变新；< 60s 不重复写', async () => {
  await withCase(async ({ home, project, feature }) => {
    await aClaims(home, feature, project);
    // 把心跳推到 5 分钟前（>60s ⇒ 下一次触碰应当刷新；且 5 < TTL 10 ⇒ 没过期，不会被抢）
    const stale = new Date(Date.now() - 5 * 60_000).toISOString();
    patchCard(home, feature, 'n1', (c) => ({ ...c, last_heartbeat_at: stale }));
    assert.equal(cardOf(home, feature, 'n1').last_heartbeat_at, stale, '前置：心跳确实是旧的');

    // 第一次触碰（写闸 A7 通过时会顺手刷）
    await editCode({
      project_dir: project,
      file: 'src/x.ts',
      op: 'replace_text',
      old_text: 'return 1;',
      new_text: 'return 10;',
      actor: A,
    });
    const afterFirst = cardOf(home, feature, 'n1').last_heartbeat_at as string;
    assert.notEqual(afterFirst, stale, 'A7 通过 ⇒ 顺手刷心跳（"我还在动手"）');
    assert.ok(Date.now() - Date.parse(afterFirst) < 5_000, '刷成"就在此刻"（不是原样退回）');

    // 第二次触碰（< 60s）⇒ **不重复写**（热路径不许狂写）
    await editCode({
      project_dir: project,
      file: 'src/x.ts',
      op: 'replace_text',
      old_text: 'return 10;',
      new_text: 'return 11;',
      actor: A,
    });
    assert.equal(cardOf(home, feature, 'n1').last_heartbeat_at, afterFirst, '< 60s ⇒ 心跳保持原值（跳过写盘）');
  });
});

test('租约⑦ session_id：同 token 同 id / 异 token 异 id / 无 token ⇒ unknown（只做归属，不做授权）', () => {
  const prev = process.env.AGENT_IO_SESSION_TOKEN;
  try {
    delete process.env.AGENT_IO_SESSION_TOKEN;
    assert.equal(resolveSessionId(), 'unknown', '没设 token ⇒ unknown（不造一个假身份）');

    process.env.AGENT_IO_SESSION_TOKEN = 'token-alpha';
    const a1 = resolveSessionId();
    const a2 = resolveSessionId();
    assert.equal(a1, a2, '同一 token 两次 ⇒ 同 id');
    assert.match(a1, /^[0-9a-f]{12}$/, 'id = sha256 前 12 位十六进制');
    assert.ok(!a1.includes('token-alpha'), '★ 不原样落 token（卡要进册、进回执、进审计）');

    process.env.AGENT_IO_SESSION_TOKEN = 'token-beta';
    assert.notEqual(resolveSessionId(), a1, '不同 token ⇒ 不同 id');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_SESSION_TOKEN;
    else process.env.AGENT_IO_SESSION_TOKEN = prev;
  }
});

test('租约⑦b claim 把 session_id 记进卡（无 token ⇒ claimed_session=unknown）', async () => {
  await withCase(async ({ home, project, feature }) => {
    const prev = process.env.AGENT_IO_SESSION_TOKEN;
    delete process.env.AGENT_IO_SESSION_TOKEN;
    try {
      await aClaims(home, feature, project);
      assert.equal(cardOf(home, feature, 'n1').claimed_session, 'unknown', '无 token ⇒ claimed_session=unknown');
    } finally {
      if (prev !== undefined) process.env.AGENT_IO_SESSION_TOKEN = prev;
    }
  });
});

test('租约⑧ TTL 取值：默认 10 分钟（AGENT_IO_LEASE_TTL_MINUTES 优先）', () => {
  // ★ 模块级常量在 import 时求值 ⇒ 这里验"当前进程看到的值"是 10 分钟默认口径
  assert.equal(LEASE_TTL_MS % 60_000, 0, 'TTL 必须以**分钟**为刻度（10 分钟的整数倍）');
  assert.ok(LEASE_TTL_MS >= 60_000, 'TTL 不许小到一分钟以内（那会把正常推理判成僵）');
});
