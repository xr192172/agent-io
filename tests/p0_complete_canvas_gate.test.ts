// touches: src/domain/complete_canvas_gate.ts, src/application/design/dsl_ops/task_ops.ts, src/application/design/db/plan_exit_check.ts
/**
 * P0 · **画布停止条件**（`docs/PROJECT-DESIGN.md:488` §7.3 四件输入里的**前两件**）。
 *
 * ## 病（这条链上缺什么 —— 上一张卡实测出来的）
 * §7.3 早就要求 `complete` 的输入含「`checkRewriteExit` 的结构与计划外改动」+「每个 `judgement_ref` 的真实判定」，
 * 而 `completeTask` 此前**从未读过画布**、也**从未调过** `checkRewriteExit` ⇒
 * 「节点判据红 ⇒ 不能交」成立 ✓，「**画布的停止条件没满足 ⇒ 不能交**」✗（没有执行者）。
 *
 * ## 每条用例「什么输入会让它红」（★ 说不出这个就不算判据）
 *   ① **J**：`judgement_ref` 现判 `fail` 而收口照样写 done ⇒ 红。★ 同族三态各自单独断言：
 *      `unsupported` / `pending` / `unresolved` —— 只要判定式写成 `=== 'fail'`，这三条立刻红（**机械消融**，
 *      不用改源码）。
 *   ② **E1（fps 判别式，两侧都要有牙）**：`fps_at_freeze` 里**有**该符号的 `stale_anchor` ⇒ 必须拒；
 *      `fps_at_freeze` 里**没有**它（标签锚，如 `write-log-baseline.json#rows`）⇒ **不许拒**。
 *      ★ 后一半护的是「不让一张正在 claimed 的卡被自己的闸**永远关在外面**」（2026-11-07 实测：45 条 stale
 *      里 44 条是标签锚）。**E2**：`delete` 未 `realized` ⇒ 拒。**E3**：`changed_unplanned` 非空 ⇒ 拒且点名。
 *   ③ **不许误伤（两侧牙）**：正常卡（判据全 pass + 全部 `not_yet` + 有 `unplanned` + 索引不可用 + **无画布**）
 *      ⇒ `refusals` 必须为空；★ 反证方向 —— **两行画布、第一行全绿第二行有 fail** ⇒ 必须拒
 *      （把循环写成 `rows[0]` 就红）；**一条 entry 第一条绿第二条 stale** ⇒ 同理。
 *   ④ **既有五道闸一处没放宽**：静态读法（见下面 ⑩ 的诚实清单）—— `completeTask` 里 owner / L1·L2·todo /
 *      证据闸 / 合并后整册读数 / 重开账 **六处**调用仍在，且**画布闸在 `writeTask` 之前**（顺序断言）。
 *
 * ## 诚实清单（★ 别把静态读法当行为证明）
 *   · ①②③ 全是**纯函数喂输入比输出**（`evaluateCompleteCanvasGate`，零 IO）⇒ 不需要夹具项目、不写盘。
 *   · ④ 与「画布闸真的接上了」是**静态读法**（读 `task_ops.ts` 源码断言调用点与顺序）——
 *     它证明「接线在源码里成立」，**不证明**「跑一遍真的拒了」。行为侧的反例在
 *     `tests/p0_two_phase_claim.test.ts`（`N_DUNNO`：后态只有 pending ⇒ `unknowable` ⇒ complete 仍拒）。
 *   · 本文件**不写仓内任何文件**，只读 `src/` 与真册常量。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COMPLETE_CANVAS_GATE_SCOPE,
  evaluateCompleteCanvasGate,
  renderCanvasGate,
  type CanvasGateRowFact,
} from '../src/domain/complete_canvas_gate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 一条画布行的"全绿"底座（各用例只覆盖自己关心的那一格 —— ★ 这是夹具，不是判据） */
function row(patch: Partial<CanvasGateRowFact> & { exit?: any; judgements?: any } = {}): CanvasGateRowFact {
  const base: CanvasGateRowFact = {
    file: 'src/example.ts',
    judgements: [{ symbol: 'alpha', judgement_ref: 'decision:agent-io:node_a#0', verdict: 'pass', detail: 'ok' }],
    exit: {
      file: 'src/example.ts',
      error: null,
      entries: [{ kind: 'rewrite', symbol: 'alpha', verdict: 'not_yet' }],
      changed_unplanned: [],
      unplanned: [],
      fps_at_freeze: { alpha: 'hash-of-alpha-at-freeze' },
    },
  };
  return { ...base, ...patch } as CanvasGateRowFact;
}

/** 收口结论的一句话（断言失败时能直接看出"拒了什么 / 报白为什么"） */
const why = (v: ReturnType<typeof evaluateCompleteCanvasGate>): string =>
  `refusals=${JSON.stringify(v.refusals)} notes=${JSON.stringify(v.notes)} checked=${JSON.stringify(v.checked)}`;

// ════════════════════════════════════════════════════════════════════
// ① J：judgement_ref 的**真实判定**（四态 + 没有执行核）
// ════════════════════════════════════════════════════════════════════
test('①-A 判据现判 fail ⇒ 必须拒，且点名到 文件#符号 [verdict] ref —— detail', () => {
  const v = evaluateCompleteCanvasGate([
    row({
      judgements: [
        { symbol: 'alpha', judgement_ref: 'decision:agent-io:node_a#0', verdict: 'fail', detail: 'alpha(3) 期望 6，实得 3' },
      ],
    }),
  ]);
  assert.equal(v.refusals.length, 1, `fail 必须拒（${why(v)}）`);
  const r = v.refusals[0];
  assert.ok(r.includes('src/example.ts#alpha'), `拒的理由必须点名文件#符号：${r}`);
  assert.ok(r.includes('[fail]'), `拒的理由必须带 verdict：${r}`);
  assert.ok(r.includes('decision:agent-io:node_a#0'), `拒的理由必须点名 judgement_ref：${r}`);
  assert.ok(r.includes('alpha(3) 期望 6'), `拒的理由必须带判据器的明细（P35 回执自足）：${r}`);
});

test('①-B 反证（★ 机械消融）：unsupported / pending / unresolved 三态各自也必须拒 —— 判定式写成 === "fail" 就红', () => {
  for (const verdict of ['unsupported', 'pending', 'unresolved']) {
    const v = evaluateCompleteCanvasGate([
      row({ judgements: [{ symbol: 'alpha', judgement_ref: 'decision:agent-io:node_a#0', verdict, detail: 'x' }] }),
    ]);
    assert.equal(v.refusals.length, 1, `§7.3「含 fail/unsupported/pending ⇒ 不可核销」，${verdict} 也必须拒（${why(v)}）`);
    assert.ok(v.refusals[0].includes(`[${verdict}]`), `拒的理由必须带 ${verdict}：${v.refusals[0]}`);
  }
});

test('①-C 判据全 pass ⇒ 不拒（这一格不许自己变红，否则整闸只会拒）', () => {
  const v = evaluateCompleteCanvasGate([row()]);
  assert.deepEqual(v.refusals, [], `全绿不许拒（${why(v)}）`);
  assert.equal(v.checked.judgements, 1, `必须真的数过 1 条 judgement_ref（${why(v)}）`);
});

// ════════════════════════════════════════════════════════════════════
// ② E：出口闭环（结构与计划外）—— 三支 + fps 判别式的两侧
// ════════════════════════════════════════════════════════════════════
test('②-A E1 正侧：fps_at_freeze 里**有**该符号的 stale_anchor ⇒ 必须拒（那才是"计划过期"）', () => {
  const v = evaluateCompleteCanvasGate([
    row({
      exit: {
        file: 'src/example.ts',
        error: null,
        entries: [{ kind: 'rewrite', symbol: 'alpha', verdict: 'stale_anchor' }],
        changed_unplanned: [],
        unplanned: [],
        fps_at_freeze: { alpha: 'hash-of-alpha-at-freeze' },
      },
    }),
  ]);
  assert.equal(v.refusals.length, 1, `冻结时真是符号、现在没了 ⇒ 拒（${why(v)}）`);
  assert.ok(v.refusals[0].includes('[stale_anchor]'), `拒的理由必须带 verdict：${v.refusals[0]}`);
});

test('②-B ★ E1 反侧（护判据③）：fps_at_freeze 里**没有**它的 stale_anchor（标签锚）⇒ 不许拒，且要在报白里点名理由', () => {
  const v = evaluateCompleteCanvasGate([
    row({
      exit: {
        file: 'scripts/write-log-baseline.json',
        error: null,
        entries: [{ kind: 'rewrite', symbol: 'rows', verdict: 'stale_anchor' }],
        changed_unplanned: [],
        unplanned: [],
        // ★ 冻结时 `rows` 根本不是顶层符号（JSON 键）
        fps_at_freeze: {},
      },
    }),
  ]);
  assert.deepEqual(v.refusals, [], `标签锚不许拒 —— 否则一张正在 claimed 的卡会被永久关在外面（${why(v)}）`);
  assert.ok(
    v.notes.some((n) => n.includes('标签锚') && n.includes('rows')),
    `必须报白点名"标签锚"（不静默放行）：${JSON.stringify(v.notes)}`,
  );
});

test('②-C E2：delete 未落地 ⇒ 拒；已落地 ⇒ 不拒', () => {
  const bad = evaluateCompleteCanvasGate([
    row({
      exit: {
        file: 'src/example.ts',
        error: null,
        entries: [{ kind: 'delete', symbol: 'beta', verdict: 'not_yet' }],
        changed_unplanned: [],
        unplanned: [],
        fps_at_freeze: { beta: 'h' },
      },
    }),
  ]);
  assert.equal(bad.refusals.length, 1, `计划要删的符号还在 ⇒ 拒（${why(bad)}）`);
  assert.ok(bad.refusals[0].includes('delete 未落地'), `拒的理由必须点明是哪一种不过：${bad.refusals[0]}`);

  const good = evaluateCompleteCanvasGate([
    row({
      exit: {
        file: 'src/example.ts',
        error: null,
        entries: [{ kind: 'delete', symbol: 'beta', verdict: 'realized' }],
        changed_unplanned: [],
        unplanned: [],
        fps_at_freeze: { beta: 'h' },
      },
    }),
  ]);
  assert.deepEqual(good.refusals, [], `删除到位 ⇒ 不拒（${why(good)}）`);
});

test('②-D E3：changed_unplanned 非空 ⇒ 拒，且逐符号点名（§7.3「有本次计划外改动未解释」）', () => {
  const v = evaluateCompleteCanvasGate([
    row({
      exit: {
        file: 'src/example.ts',
        error: null,
        entries: [{ kind: 'rewrite', symbol: 'alpha', verdict: 'not_yet' }],
        changed_unplanned: ['gamma', 'delta'],
        unplanned: [],
        fps_at_freeze: { alpha: 'h' },
      },
    }),
  ]);
  assert.equal(v.refusals.length, 1, `计划外改动必须拒（${why(v)}）`);
  assert.ok(v.refusals[0].includes('gamma') && v.refusals[0].includes('delta'), `必须逐符号点名：${v.refusals[0]}`);
});

test('②-E 取数阶段炸了（collect_error）⇒ 拒，并带「判不了（≠ 通过）」', () => {
  const v = evaluateCompleteCanvasGate([row({ collect_error: '册读不了：EACCES' })]);
  assert.equal(v.refusals.length, 1, `判不了不许静默放行（${why(v)}）`);
  assert.ok(v.refusals[0].includes('判不了（≠ 通过）'), `拒的理由必须写明"判不了 ≠ 通过"：${v.refusals[0]}`);
});

// ════════════════════════════════════════════════════════════════════
// ③ ★ 不许误伤（两侧都要有牙）
// ════════════════════════════════════════════════════════════════════
test('③-A 正常卡 / 无画布卡 / 各种「已知判不了」⇒ refusals 必须为空（每一条都是实测出来的误伤形态）', () => {
  const cases: Array<[string, CanvasGateRowFact[]]> = [
    ['无画布（本仓 86 张活卡里 72 张是这样）', []],
    [
      '全部 not_yet（写穿把基线挪到写后 ⇒ 全库 366/491 条是它）',
      [row({ exit: { ...row().exit, entries: [{ kind: 'rewrite', symbol: 'alpha', verdict: 'not_yet' }] } })],
    ],
    [
      'unplanned 非空（"没表态"，52/240 份画布有它）',
      [row({ exit: { ...row().exit, unplanned: ['zeta', 'eta'] } })],
    ],
    ['索引不可用（夹具工程 / 没建过 cache.db 的项目）', [row({ exit: { ...row().exit, error: '索引不可用（`cache.db` 不在或读不了）⇒ 锚点存在性判不了' } })]],
    ['unjudgeable（判不了）', [row({ exit: { ...row().exit, entries: [{ kind: 'rewrite', symbol: 'alpha', verdict: 'unjudgeable' }] } })]],
    [
      '源码文件不存在但条目全是 delete',
      [row({ exit: { file: 'src/example.ts', error: '源码文件不存在 ⇒ 只能判 `delete` 类；其余条目按 not_yet', entries: [{ kind: 'delete', symbol: 'alpha', verdict: 'realized' }], changed_unplanned: [], unplanned: [], fps_at_freeze: { alpha: 'h' } } })],
    ],
  ];
  for (const [label, rows] of cases) {
    const v = evaluateCompleteCanvasGate(rows);
    assert.deepEqual(v.refusals, [], `【${label}】不许拒 —— 这是误伤（${why(v)}）`);
  }
});

test('③-B ★ 反证：两行画布、第一行全绿第二行有 fail ⇒ 必须拒（把循环写成 rows[0] 就红）', () => {
  const v = evaluateCompleteCanvasGate([
    row(),
    row({
      file: 'src/second.ts',
      judgements: [{ symbol: 'beta', judgement_ref: 'decision:agent-io:node_b#1', verdict: 'fail', detail: '红' }],
    }),
  ]);
  assert.ok(v.refusals.length >= 1, `第二行的红必须被看见（${why(v)}）`);
  assert.ok(v.refusals.some((r) => r.includes('src/second.ts#beta')), `必须点名第二行的那一条：${JSON.stringify(v.refusals)}`);
  assert.equal(v.checked.rows, 2, `两行都要算进分母（${why(v)}）`);
});

test('③-C ★ 反证：一条画布的 entries 里第一条绿、第二条 stale（fps 内有）⇒ 必须拒（只判首条就红）', () => {
  const v = evaluateCompleteCanvasGate([
    row({
      exit: {
        file: 'src/example.ts',
        error: null,
        entries: [
          { kind: 'rewrite', symbol: 'alpha', verdict: 'not_yet' },
          { kind: 'rewrite', symbol: 'beta', verdict: 'stale_anchor' },
        ],
        changed_unplanned: [],
        unplanned: [],
        fps_at_freeze: { alpha: 'h', beta: 'h2' },
      },
    }),
  ]);
  assert.equal(v.refusals.length, 1, `第二条 entry 的红必须被看见（${why(v)}）`);
  assert.ok(v.refusals[0].includes('#beta'), `必须点名 beta：${v.refusals[0]}`);
});

test('③-D 已软消解的画布行 ⇒ 跳过、不判、但计入分母（不静默丢）', () => {
  const v = evaluateCompleteCanvasGate([
    row({
      dissolved_at: '2026-11-03T03:48:17.438Z',
      judgements: [{ symbol: 'alpha', judgement_ref: 'decision:agent-io:node_a#0', verdict: 'fail', detail: '已落地的那一段' }],
    }),
  ]);
  assert.deepEqual(v.refusals, [], `已消解 = 这一段已落地，不判（${why(v)}）`);
  assert.equal(v.checked.dissolved, 1, `跳过数必须报出来（${why(v)}）`);
  assert.equal(v.checked.rows, 0, `已消解不计入参与判定的行数（${why(v)}）`);
});

// ════════════════════════════════════════════════════════════════════
// ④ 既有五道闸没放宽（静态读法）+ §7.3 的 2/4 自白常量
// ════════════════════════════════════════════════════════════════════
test('④-A 现有收口闸一处没放宽：六处调用仍在，且**画布闸在 writeTask 之前**（顺序是这条判据的牙）', () => {
  const src = fs.readFileSync(path.join(REPO, 'src/application/design/dsl_ops/task_ops.ts'), 'utf-8');
  const start = src.indexOf('export async function completeTask');
  const end = src.indexOf('// edit_dsl 路由', start);
  const body = src.slice(start, end > start ? end : src.length);
  assert.ok(body.length > 1000, '取不到 completeTask 的实体（改名前缀/改名会红）');
  for (const call of [
    'constructionVerdict(dsl, node_id)', // L1 建构闸
    'isSatisfied(card, expectationsOf(cardNode)', // L2 可收口性
    "validateProgressEvidence('done', evidence)", // 证据闸
    'validateMergedReading(', // 合并后整册读数
    'reopenGate(card, evidence)', // 重开账本
    'evaluateCompleteCanvasGate(', // ★ 本期新接的画布停止条件
  ]) {
    assert.ok(body.includes(call), `completeTask 里必须仍调用 \`${call}\`（既有闸一处不许放宽）`);
  }
  assert.ok(/没有 owner ⇒ 未领不可能被收口/.test(body), 'owner 闸不许放宽');
  const gateAt = body.indexOf('evaluateCompleteCanvasGate(');
  const writeAt = body.indexOf('writeTask(feature, node_id, withHeartbeat({');
  assert.ok(gateAt > 0 && writeAt > 0, `两个锚点都要在（gateAt=${gateAt} writeAt=${writeAt}）`);
  assert.ok(gateAt < writeAt, '★ 画布闸必须在 writeTask **之前** —— 否则拒的时候状态已经写成 done（D-complete-nonatomic 同族）');
});

test('④-B checkRewriteExit 的 cardId 是可选且默认不变（三个现网调用点一个都不许被改语义）', () => {
  const exitSrc = fs.readFileSync(path.join(REPO, 'src/application/design/db/plan_exit_check.ts'), 'utf-8');
  assert.ok(exitSrc.includes('opts?: { cardId?: string }'), '签名必须有可选 opts.cardId');
  assert.ok(exitSrc.includes('readRewritePlan(root, rel, opts?.cardId)'), '必须把 cardId 透给 readRewritePlan');
  for (const [file, needle] of [
    ['src/application/write_gate.ts', 'checkRewriteExit(root, rel)'],
    ['src/application/design/index.ts', 'checkRewriteExit(projectRoot, rel)'],
    ['src/application/design/db/change_set_view.ts', 'checkRewriteExit(root, file)'],
  ] as const) {
    const s = fs.readFileSync(path.join(REPO, file), 'utf-8');
    assert.ok(s.includes(needle), `${file} 的调用形态必须仍是 \`${needle}\`（不带 cardId ⇒ 默认行为逐字不变）`);
  }
});

test('④-C §7.3 四件输入的自白常量：四条都在、编号逐字、且"未接通"的两条不许被删', () => {
  assert.ok(COMPLETE_CANVAS_GATE_SCOPE.length === 4, `必须是 4 条（§7.3 的四件输入），实得 ${COMPLETE_CANVAS_GATE_SCOPE.length}`);
  const joined = COMPLETE_CANVAS_GATE_SCOPE.join('\n');
  for (const must of ['① 已接通', '② 已接通', '③ 未接通', '④ 未接通', 'checkRewriteExit', 'judgement_ref', '当前事实可信性', '未决决定清单']) {
    assert.ok(joined.includes(must), `自白常量必须点名 \`${must}\` —— 删一条会红（它说明本卡只接通 2/4）`);
  }
  assert.ok(
    joined.includes('L1 / todo 卡没有判据 ⇒ 无闸'),
    '★ 必须写清「陈旧事实」那一支今天只在 L2 卡上间接成立（L1/todo 无闸）—— 否则交付会把它报成"出口第 2 条过了"',
  );
});

test('④-D renderCanvasGate：拒的时候必须点名到判据/文件（P35 回执自足），不许只说"不能 complete"', () => {
  const v = evaluateCompleteCanvasGate([
    row({ judgements: [{ symbol: 'alpha', judgement_ref: 'decision:agent-io:node_a#0', verdict: 'fail', detail: '红' }] }),
  ]);
  const line = renderCanvasGate(v);
  assert.ok(line.includes('拒 1 条'), `回执必须报清拒了几条：${line}`);
  assert.ok(line.includes('src/example.ts#alpha'), `回执必须点名文件#符号：${line}`);
  assert.ok(line.includes('decision:agent-io:node_a#0'), `回执必须点名 judgement_ref：${line}`);

  const ok = renderCanvasGate(evaluateCompleteCanvasGate([row()]));
  assert.ok(ok.includes('无拒'), `全绿时也必须给读数（含分母）：${ok}`);
});
