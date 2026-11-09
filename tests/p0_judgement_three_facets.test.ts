/**
 * P0 · **判据的三侧面必须在一个回执里同时现形**（2026-11-05，卡 jcard）。
 *
 * ## 病（实测，两个刚干过活的子代理留下的逐字回执）
 * 一条判据有三个侧面 —— **能不能判 / 强不强 / 现不红** —— 而它们分散在**三个门**里，
 * **从没有一处并排显示过**，而且顺序逼你先写最弱的那种：
 * · `claim`（`task_machine#cardStanding`）只在**拒**的时候说一句「N 条判不了」；
 * · `edit_code` 的计划闸（`rewrite_plan#planJudgementGaps`）只说「弱」，且只对**红**的条目说话；
 * · 于是一条 `file-exists` / `symbol-exists` 只要**绿**，在写回执里**一个字都没有** ——
 *   而**弱判据永远绿 ⇒ 永远隐形**（用户逐字：「如果它是设计的部分，那么你对它的重写和改写都需要看到它；
 *   没有看到它就会造成误导」）。
 * 净代价实测 3 次往返：claim 要"可判" ⇒ 逼人写必然可判的**存在类** ⇒ 计划闸再把它打回（E-PLAN-023）。
 *
 * ## 本证锁四件事（都是**真状态机 + 真落盘**，不是文本）
 * · **C1** 绿的存在类判据必须出现在 I1 回执里（改前：它不出现）
 * · **C2** claim 回执必须给「语义类 X · 存在类 Y」分解，`X===0` 时有 ⚠（**只提示，不拒绝**）
 * · **C3/C5** 同一条判据在 claim / I1 / 计划闸三处的「类」**必须相同**（靠 `strengthOfKind` 一处）；
 *   并且 `gate_error` 的 E-PLAN-013 不许再**手抄** kind 名单（那是第二份，会静默过期）
 * · **C4** 消融：摘掉 `facets` ⇒ 同一渲染器不再输出「✓ 绿的」⇒ 证明那一行**来自** facets
 *
 * ## 消融口径（0.25②：有鉴别力）
 * 每条用例都有一个"该红"的对照：
 * · C1 的对照是 C4（不给 facets ⇒ 绿行消失）；
 * · C2 的对照是同一条判据换成语义类（`call-exists`）⇒ ⚠ **不许**出现；
 * · C5 的对照是：把 kind 名单抄回 E-PLAN-013 ⇒ `EXPECTATION_KINDS` 那条循环必红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { updateFeature, renderExpectationsPreview } from '../src/application/design/dsl_ops/update_feature.js';
import { planJudgementGaps, strengthOfKind, type RewritePlan } from '../src/application/design/db/rewrite_plan.js';
import { GATE_RULES } from '../src/domain/gate_error.js';
import { EXPECTATION_KINDS } from '../src/domain/expectation_kinds.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

const OWNER = 'subagent:jcard';
const FEATURE = 'jcard';
const NODE = 'file_src_jf_ts';
const REL = 'src/jf.ts';
/** 夹具源码：`main()` 转调 `helper()` —— 给 `call-exists`（语义类）当锚点 */
const SRC =
  'export function helper(): number {\n  return 1;\n}\nexport function main(): number {\n  return helper();\n}\n';

function writeProject(): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-jcard-proj-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, REL), SRC, 'utf-8');
  return project;
}

/** 设计册：几何节点为空（节点由用例自己 `node.add` 建，走真入口） */
function writeSheet(home: string, project: string): void {
  const dsl: DesignDSL = {
    feature: FEATURE,
    title: FEATURE,
    source_root: project,
    geometry: { nodes: [], edges: [] },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${FEATURE}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

function edit(operations: Array<Record<string, unknown>>, reason: string) {
  return updateFeature({
    feature: FEATURE,
    operations: operations as never,
    agent: OWNER,
    reason,
    weight: 'routine',
  } as never);
}

/** 建节点 + 首版决策卡（判据随 `node.add` 同一批写进 —— E-WRITE 要求新建节点必须自带判据） */
function addNode(expectations: Array<Record<string, unknown>>) {
  return edit(
    [
      {
        op: 'add',
        type: 'node',
        id: NODE,
        data: {
          type: 'file',
          label: 'jf.ts',
          path: REL,
          decision: { summary: `${REL}：三侧面读数的夹具（main() 转调 helper()）。`, expectations },
        },
      },
    ],
    `给 ${REL} 建设计节点 ${NODE} 并写首版判据（三侧面读数夹具）`,
  );
}

/** 一条**绿的存在类**判据（符号已导出 ⇒ pass） */
const SYMBOL_EXISTS = {
  kind: 'symbol-exists',
  path: REL,
  symbol: 'main',
  why: '存在类夹具：main 必须被导出（绿色但它**永远发现不了逻辑错**）',
};

async function withFixture(fn: () => Promise<void>): Promise<void> {
  const home = makeTempHome();
  const project = writeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, project);
    await fn();
  } finally {
    rmRf(home);
    rmRf(project);
  }
}

// ─────────────────────────────────────────────────────────────
// C1（+ C4 消融）· 绿的存在类判据必须出现在 I1 回执里
test('P0-jcard · C1 绿的存在类判据必须出现在 I1 回执里（改前：一个字都没有）', async () => {
  await withFixture(async () => {
    const r = await addNode([SYMBOL_EXISTS]);
    const msg = r.message;
    // 前提：这条判据确实是**绿**的（否则本证测的是别的分支）
    assert.match(msg, /写入预判（I1）/);
    assert.match(msg, /0 红/, `夹具前提：symbol-exists 指向已导出符号 ⇒ 必须 0 红（实测回执：${msg.slice(0, 400)}）`);
    // ★ C1：绿的也要有一行，且带 kind + 类
    assert.match(msg, /✓ 绿的 1 条/, '绿判据必须有一行（改前：绿的完全隐形）');
    assert.match(msg, /symbol-exists/, '那一行必须点名 kind');
    assert.match(msg, /存在类（永远发现不了逻辑错）/, '强度必须逐字来自 strengthOfKind 的措辞');
    assert.match(msg, /可判性: 可判/, '可判性列必须在场（它这次真判出了 pass）');

    // ★ C4 消融：同一渲染器，**不给 facets** ⇒ 绿行必须消失 ⇒ 证明它来自 facets
    const ablated = renderExpectationsPreview({ judged: 1, failed: [], unsupported: 0 });
    assert.doesNotMatch(ablated, /✓ 绿的/, '消融：facets 一摘，绿行就该消失 —— 若还出现，说明它是别的来源');
    assert.doesNotMatch(ablated, /存在类/, '消融：不给 facets 就不该有强度列');
  });
});

// ─────────────────────────────────────────────────────────────
// C2 · claim 回执必须给分解，X===0 时打 ⚠（且**不许**变成拒绝）
test('P0-jcard · C2 claim 拒领时回执仍给「语义类 X · 存在类 Y」分解，X===0 打 ⚠（门更严，读数更清楚）', async () => {
  await withFixture(async () => {
    await addNode([SYMBOL_EXISTS]);
    await edit([{ op: 'publish', type: 'task', id: NODE }], `给节点 ${NODE}（${REL}）立卡`);

    const c = await edit(
      [{ op: 'claim', type: 'task', id: NODE, data: { owner: OWNER, intent: 'modify' } }],
      `领取节点 ${NODE} 的卡（${REL}）：只有存在类 ⇒ 按证据族门槛必须拒领`,
    );
    // ★ 2026-11-09 迁移（门槛 = 证据族）：原来这里断言"放行（绝不拒绝）"——
    //   那是**旧规则**（存在类也算数）。新规则下存在类不满足任何族 ⇒ 必须**拒领**。
    //   但 B-3 的**显示保证**不变：拒领回执仍要逐条给三侧面分解 + ⚠ 原话。
    const msg = c.message;
    assert.match(msg, /未领取/, 'C2 的前提：这是**拒领**回执（新规则：存在类不满足证据族）');
    assert.match(msg, /没有行为族证据/, '拒领必须点名缺的那一族');
    assert.match(msg, /语义类 0 · 存在类 1/, `回执必须有强度分解（实测：${msg.slice(0, 400)}）`);
    assert.match(msg, /有 0 条能发现逻辑错/, '必须给出"能发现逻辑错的条数"');
    assert.match(msg, /只有存在类/, 'X===0 必须显著标出');
    assert.match(msg, /永远发现不了逻辑错/, '★ B-3：必须复述 strengthOfKind 的原话，不许换温和说法');
    // ③ 明细进机器通道（散文首行只有汇总）
    const data = (c as { data?: { judgement_facets?: Array<Record<string, unknown>> } }).data;
    const facets = data?.judgement_facets;
    if (facets) {
      assert.equal(facets.length, 1, 'data.judgement_facets 必须逐条带出');
      assert.equal(facets[0].kind, 'symbol-exists');
      assert.equal(facets[0].strength, 'existence');
      assert.equal(facets[0].phase, 'post');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// C3 + C5 · 三处「类」必须同源；gate_error 不许手抄 kind 名单
test('P0-jcard · C3 同一条判据在 claim / I1 / 计划闸三处的「类」必须相同', async () => {
  await withFixture(async () => {
    // ── 存在类：三处都必须说"存在类" ─────────────────────────────
    const i1 = await addNode([SYMBOL_EXISTS]);
    assert.match(i1.message, /存在类（永远发现不了逻辑错）/);

    await edit([{ op: 'publish', type: 'task', id: NODE }], `给节点 ${NODE}（${REL}）立卡`);
    const c = await edit(
      [{ op: 'claim', type: 'task', id: NODE, data: { owner: OWNER, intent: 'modify' } }],
      `领取节点 ${NODE} 的卡（${REL}）：只有存在类 ⇒ 按证据族门槛拒领，回执仍须说清"存在类"`,
    );
    // ★ 2026-11-09 迁移：claim 现在**拒领**（旧规则放行），但三处对同一条判据的"类"必须一致这条**不变**。
    assert.match(c.message, /未领取/);
    assert.match(c.message, /存在类 1/, '拒领回执同样必须把这条判据说成"存在类"（与 I1 / 计划闸同一口径）');

    const plan = (ref: string): RewritePlan =>
      ({
        path: REL,
        card: NODE,
        entries: [
          { anchor: { symbol: 'main' }, kind: 'rewrite', detail: '夹具', judgement_ref: ref, status: 'open' },
        ],
      }) as unknown as RewritePlan;

    const existGaps = planJudgementGaps(plan(`decision:${NODE}#0`), () => ({ kind: 'symbol-exists' }));
    assert.equal(existGaps.length, 1, '存在类必须被计划闸点名（它永远发现不了逻辑错）');
    assert.match(existGaps[0], /存在\/结构类/, '计划闸也必须用"存在类"这套口径');
    assert.match(existGaps[0], /永远发现不了逻辑错/, '★ 三处的措辞必须同源（都来自 strengthOfKind 那一档）');

    // ── 语义类：计划闸**不点名**，且 ⚠ 不许出现 ────────────────
    assert.equal(strengthOfKind('call-exists'), 'semantic', '前提：call-exists 是语义类（唯一实现 = strengthOfKind）');
    const semGaps = planJudgementGaps(plan(`decision:${NODE}#0`), () => ({ kind: 'call-exists' }));
    assert.deepEqual(semGaps, [], '语义类不许被计划闸点名');

    const semOnly = renderExpectationsPreview({
      judged: 1,
      failed: [],
      unsupported: 0,
      facets: [
        { what: 'call-exists  main() → helper()', kind: 'call-exists', strength: 'semantic', phase: 'post', verdict: 'pass' },
      ],
    });
    assert.doesNotMatch(semOnly, /只有存在类/, '语义类判据不许触发"只有存在类"那条 ⚠（这就是 C2 的鉴别力）');
    assert.match(semOnly, /✓ 绿的 1 条/, '语义类绿的同样要有一行');
  });
});

test('P0-jcard · C5 gate_error 的 E-PLAN-013 不许手抄 kind 名单（必须指向 strengthOfKind）', () => {
  const rule = GATE_RULES.find((r) => r.code === 'E-PLAN-013');
  assert.ok(rule, 'E-PLAN-013 必须还在（本证不负责它的去留，只负责"它不许有第二份 kind 名单"）');
  const txt = `${rule.what}\n${rule.fix}`;
  // ★ 消融：把任何一条 kind 名抄回 what/fix ⇒ 本循环立刻红
  for (const k of EXPECTATION_KINDS) {
    assert.ok(
      !txt.includes(k),
      `E-PLAN-013 又手抄了 kind 名单（命中 "${k}"）⇒ 它是 SEMANTIC_KINDS 的第二份，改了那边这边会静默过期（0.9.1）`,
    );
  }
  assert.match(txt, /strengthOfKind/, '去重的方式是**指路**：必须点名唯一判定入口 strengthOfKind');
});
