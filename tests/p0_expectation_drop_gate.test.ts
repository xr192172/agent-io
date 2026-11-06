/**
 * p0_expectation_drop_gate —— 「判据被整块替换静默吞掉」那道闸的判据（2026-11-06 · T-26 · E-CRIT-007）。
 *
 * ## 它守的是什么（每条都能"该红就红"）
 * 实测事故（不是假设）：子代理去修一处乱码，用 `decision.update` 改 `expectations`（**整块替换**）
 * ⇒ 静默把原有行为判据压掉 ⇒ **没有任何东西说话**，它自己发现后从 `git show HEAD` 逐字还原。
 *
 * ## 触发面**刻意只有两档**（更宽的规则实测命中 41.8% 的历史写 ⇒ 那是通行障碍不是闸）
 * · **清零**：上一版 ≥1 条、本次 0 条；
 * · **面B 净缩**：同一主体的 `cases` / `must|mustNot` / `must_not_import` 变短**且没有任何新增**。
 * · **面A（整条消失但没清零）不拒** ⇒ 改为**回执首行点名**（它命中 41.8%，拒它会被绕）。
 *
 * ## 消融（0.25② 有鉴别力 —— 删掉实现里那一段，哪几条会红）
 * · 删掉 `applyDecisionWrite` 里 `needDeclare` 那个抛 ⇒ 用例 ①②④⑤ 全红；
 * · 把 `expectationLossOf` 的"有新增就不算净缩"那一句删掉（改成任何变短都算）⇒ 用例 ③ 红
 *   （"换针"会被误判成丢）；
 * · 把 `computeKeys` 的集合相等换成"声明是超集即可" ⇒ 用例 ⑤ 红（多报不再被抓）。
 *
 * ★ 全部在临时 `AGENT_IO_HOME` 里跑，**不碰真册**（路径权威 = `getDesignSheetFile`）。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-t26-drop-'));
process.env.AGENT_IO_HOME = HOME; // ★ 必须在 import storage 之前

const { writeMinimalFeature, readFeature, rmRf } = await import('./helpers/i1_fixture.js');
const { updateFeature } = await import('../src/application/design/dsl_ops/update_feature.js');
const { expectationLossOf, expectationSubjectKey } = await import('../src/domain/expectation.js');
const { readHistoryLog } = await import('../src/infrastructure/decision_history.js');

const projRoot = path.join(HOME, 'proj');
fs.mkdirSync(projRoot, { recursive: true });
fs.writeFileSync(path.join(projRoot, 'calc.ts'), 'export function add(a: number, b: number) { return a + b; }\n', 'utf-8');

const FEATURES = [
  't26-shape', // ①② 事故形态（用例 3 → 1）
  't26-strict', // ③ 改严 expect（不许误伤）
  't26-wipe', // ④ 清零
  't26-extra', // ⑤ 多报也拒
  't26-faceA', // ⑥ 条目消失（只点名不拒）
  't26-remove', // ⑦ 元素级删除（自动声明）
  't26-ops', // ⑧ op 记账 + 上一次整块替换
  't26-node', // ⑨ node.update 第二条写路
];

before(() => {
  for (const f of FEATURES) writeMinimalFeature(HOME, f, { source_root: projRoot });
});

after(() => rmRf(HOME));

/** 一条 behavior-cases 判据（同一主体键 = `behavior-cases:calc.ts#add`） */
function bc(cases: Array<{ given: unknown[]; expect: string }>) {
  return {
    kind: 'behavior-cases',
    path: 'calc.ts',
    symbol: 'add',
    cases,
    why: '行为基线：add 的输出不许随重构变化（换实现不改结果）',
  };
}

const CASES3 = [
  { given: [1, 2], expect: '3' },
  { given: [0, 0], expect: '0' },
  { given: [-1, 1], expect: '0' },
];

/** 写一次 decision（同一 feature 内第二次写 = 有 prev ⇒ 可能触发闸） */
async function write(feature: string, data: Record<string, unknown>) {
  return updateFeature({
    feature,
    reason: 'T-26 判据：构造一次 decision 写入',
    operations: [{ op: 'update', type: 'decision', id: 'svc_1', data: { summary: 'add 的行为基线', ...data } }],
  } as never);
}

/**
 * 取「op 自己的首行」—— 批处理汇总时它前面还有一行表头，
 * 而 `updateFeatureCore` 对这**首行**有硬口径：「破坏性操作必须把"删了几条"写进首行，并带 ⚠」。
 * ⇒ 断言必须打在这一行上，不是打在整段 message 上。
 */
function opHead(msg: string): string {
  const line = msg.split('\n').find((l) => l.includes('[decision] 已写入节点'));
  assert.ok(line, '回执里找不到 decision 操作的首行');
  return line!;
}

// ── ①② 事故形态 ──────────────────────────────────────────────

test('① 正半：把 3 个用例压成 1 个（条目数不变）⇒ 必须拒（E-CRIT-007）', async () => {
  await write('t26-shape', { expectations: [bc(CASES3)] });
  await assert.rejects(
    () => write('t26-shape', { expectations: [bc([CASES3[0]])] }),
    (e: Error) => {
      // ★ 报文要"有牙"：带码 + 点名哪一条变短 + 给出可粘的 drop_ok
      assert.match(e.message, /E-CRIT-007/);
      assert.match(e.message, /变短/);
      assert.match(e.message, /用例 3 → 1/);
      assert.match(e.message, /behavior-cases:calc\.ts#add/);
      return true;
    },
  );
  // ★ 拒 = 一个字节都没落盘
  const dsl = readFeature(HOME, 't26-shape') as unknown as {
    geometry: { nodes: Array<{ id: string; decision?: { expectations?: Array<{ cases?: unknown[] }> } }> };
  };
  const node = dsl.geometry.nodes.find((n) => n.id === 'svc_1')!;
  assert.equal(node.decision?.expectations?.[0]?.cases?.length, 3, '被拒的写入不许留下半套判据');
});

test('② 负半①：同一笔带 drop_ok 逐条枚举 ⇒ 必须放行，且首行点名"少了 1 条"', async () => {
  const r = await write('t26-shape', {
    expectations: [bc([CASES3[0]])],
    drop_ok: ['behavior-cases:calc.ts#add'],
  });
  assert.match(r.message, /已写入节点/);
  // ★ 首行（批处理唯一保证被看见的那一行）必须说"少了"，且**点名到条**（明细行会蒸发，首行不会）
  assert.match(opHead(r.message), /⚠ 判据少了 1 条/);
  assert.match(opHead(r.message), /behavior-cases:calc\.ts#add 用例 3→1/);
  const data = r.data as { expectations_loss: { eroded: unknown[]; now: number } };
  assert.equal(data.expectations_loss.eroded.length, 1);
  assert.equal(data.expectations_loss.now, 1);
});

// ── ③ 改内容 ≠ 丢东西 ────────────────────────────────────────

test('③ 负半②：只改内容（条目数与各集合长度都不减）⇒ 必须放行，且 loss 为空', async () => {
  await write('t26-strict', { expectations: [bc(CASES3)] });
  // ★ 同一条判据、用例逐字相同 ⇒ 零丢失
  const r = await write('t26-strict', { expectations: [bc(CASES3)] });
  const data = r.data as { expectations_loss: { lost: unknown[]; eroded: unknown[] } };
  assert.equal(data.expectations_loss.lost.length, 0);
  assert.equal(data.expectations_loss.eroded.length, 0);
  assert.match(r.message, /已写入节点/);

  // ★ "改严"的可判形态 = 加一条新 case（变长，不是变短）⇒ 同样不算丢
  const r2 = await write('t26-strict', {
    expectations: [bc([...CASES3, { given: [2, 2], expect: '4' }])],
  });
  const d2 = r2.data as { expectations_loss: { lost: unknown[]; eroded: unknown[]; added: unknown[] } };
  assert.equal(d2.expectations_loss.lost.length, 0);
  assert.equal(d2.expectations_loss.eroded.length, 0, '变长不算丢');
  assert.equal(d2.expectations_loss.added.length, 0, '同一主体加 case 不算"新增条目"（主体没变）');
});

test('③b 换针（删一个 must 同时加一个新 must，总数不减）⇒ 不算净缩', async () => {
  const sh = (must: string[], mustNot?: string[]) => ({
    kind: 'source-has',
    path: 'calc.ts',
    must,
    ...(mustNot ? { mustNot } : {}),
    why: '文本不变量：add 的实现必须真的做加法',
  });
  await write('t26-strict', { expectations: [sh(['a + b', 'export function add'])] });
  const r = await write('t26-strict', { expectations: [sh(['a + b', 'export function add', 'return'])] });
  const d = r.data as { expectations_loss: { eroded: unknown[] } };
  assert.equal(d.expectations_loss.eroded.length, 0, '变长/换针不是净缩');

  // ★★ 实测打回来的那一次误伤（按"单集合"判会红）：删一条 must 同时加一条 mustNot = **收紧**，不是丢。
  //   判据按**条目合计**（见 `expectationLossOf` 里那段"按条目合计判，不按单个集合判"）。
  const r2 = await write('t26-strict', {
    expectations: [sh(['a + b'], ['return a + b'])],
  });
  const d2 = r2.data as { expectations_loss: { eroded: unknown[] } };
  assert.equal(d2.expectations_loss.eroded.length, 0, 'must 减一 + mustNot 加一 = 收紧，必须放行');
});

// ── ④⑤ 清零 与 多报 ─────────────────────────────────────────

test('④ 清零（2 条 → 0 条）⇒ 拒；带 drop_ok 全枚举 ⇒ 放行', async () => {
  const two = [
    bc(CASES3),
    { kind: 'source-has', path: 'calc.ts', must: ['export function add'], why: '符号字面还在' },
  ];
  await write('t26-wipe', { expectations: two });
  await assert.rejects(() => write('t26-wipe', { expectations: [] }), /E-CRIT-007[\s\S]*清零/);

  const r = await write('t26-wipe', {
    expectations: [],
    drop_ok: ['behavior-cases:calc.ts#add', 'source-has:calc.ts'],
  });
  assert.match(opHead(r.message), /⚠ 判据少了 2 条/);
});

test('⑤ 多报也拒：drop_ok 里混进一个"根本没丢"的键 ⇒ 拒（声明不许当橡皮章）', async () => {
  await write('t26-extra', { expectations: [bc(CASES3)] });
  await assert.rejects(
    () =>
      write('t26-extra', {
        expectations: [bc([CASES3[0]])],
        drop_ok: ['behavior-cases:calc.ts#add', 'source-has:calc.ts'], // 后者没丢
      }),
    (e: Error) => {
      assert.match(e.message, /E-CRIT-007/);
      assert.match(e.message, /多报/);
      return true;
    },
  );
  // 少报同理：只丢不声明（或不声明全）⇒ 拒
  await assert.rejects(
    () => write('t26-extra', { expectations: [bc([CASES3[0]])], drop_ok: [] }),
    /E-CRIT-007[\s\S]*漏报/,
  );
});

// ── ⑥ 面A：整条消失但没清零 ⇒ 只点名，不拒 ──────────────────

test('⑥ 面A（4 条 → 2 条，条目消失且没清零）⇒ **不拒**，但首行必须点名"少了 2 条"', async () => {
  const four = [
    bc(CASES3),
    { kind: 'source-has', path: 'calc.ts', must: ['export function add'], why: '符号字面还在' },
    { kind: 'symbol-exists', path: 'calc.ts', symbol: 'add', why: '导出存在' },
    { kind: 'file-exists', path: 'calc.ts', why: '文件存在' },
  ];
  await write('t26-faceA', { expectations: four });
  const r = await write('t26-faceA', { expectations: [four[0], four[1]] });
  assert.match(opHead(r.message), /⚠ 判据少了 2 条/, '面A 不拒，但**必须说话**（今晚缺的就是这句）');
  const d = r.data as { expectations_loss: { lost: Array<{ desc: string }>; was: number; now: number } };
  assert.equal(d.expectations_loss.was, 4);
  assert.equal(d.expectations_loss.now, 2);
  assert.equal(d.expectations_loss.lost.length, 2);
  assert.match(d.expectations_loss.lost.map((x) => x.desc).join('\n'), /calc\.ts/);
});

// ── ⑦ 元素级删除 = 自带声明 ──────────────────────────────────

test('⑦ `expectation.remove` 删掉唯一一条（成形上是清零）⇒ 放行（删除动作本身就是声明）', async () => {
  await write('t26-remove', { expectations: [bc(CASES3)] });
  const r = await updateFeature({
    feature: 't26-remove',
    reason: 'T-26：用元素级 op 退役唯一一条判据（合法丢弃的主路）',
    operations: [{ op: 'expectation.remove', type: 'decision', id: 'svc_1', data: { index: 0 } }],
  } as never);
  assert.match(r.message, /已写入节点/);
  const dsl = readFeature(HOME, 't26-remove') as unknown as {
    geometry: { nodes: Array<{ id: string; decision?: { expectations?: unknown[] } }> };
  };
  assert.equal(dsl.geometry.nodes.find((n) => n.id === 'svc_1')!.decision?.expectations?.length, 0);
});

// ── ⑧ op 记账（"能不能从盘上说清上一次整块替换丢了几条"） ────

test('⑧ op 记账：侧车 entry 带 op，且回执能从盘上算出"上一次整块替换丢了几条"', async () => {
  // 第 1 次：首版（无 prev ⇒ 不压栈，因此没有历史）
  await write('t26-ops', { expectations: [bc(CASES3)] });
  // 第 2 次：整块替换，压 1 条（op=update）
  await write('t26-ops', {
    expectations: [bc([CASES3[0]])],
    drop_ok: ['behavior-cases:calc.ts#add'],
  });
  // 第 3 次：只改 summary，再压 1 条
  const r = await write('t26-ops', { summary: 'add 的行为基线（结论措辞改了）' });

  const idx = readHistoryLog('t26-ops');
  const entries = idx.byNode.get('svc_1') ?? [];
  assert.equal(entries.length, 2, '两次"有旧版"的写入 ⇒ 两条历史（首版不压栈）');
  assert.deepEqual(
    entries.map((e) => (e as { op?: string }).op),
    ['update', 'update'],
    '★ 记账上线后，每一条历史都必须写明是哪一种写操作（否则"整块替换 vs 元素级删除"永远分不清）',
  );

  // ★ 回执必须能从**盘上**说清上一次整块替换丢了几条
  const d = r.data as {
    history_ops: { last_whole_block_replacement: { lost: number; eroded: number } | null; op_unknown_entries: number };
  };
  assert.ok(d.history_ops.last_whole_block_replacement, '必须从盘上读得出"上一次整块替换"');
  assert.equal(d.history_ops.last_whole_block_replacement!.eroded, 1, '上一次整块替换让 1 条判据变短');
  assert.equal(d.history_ops.op_unknown_entries, 0, '本册的条目都有 op（新写的）');
  // ★ 明细行（"上一次「整块替换」…"）在**批处理汇总时会蒸发**（只留首行）⇒ 这句话不许当判据；
  //   能一直读到的是 `data.history_ops`（上面已断言）与侧车本身。这条注释留着，免得下一个人再写一遍假断言。
});

test('⑧b 没有 op 的老条目必须报「未知」，不许猜成 update', async () => {
  // 手工造一条**没有 op** 的老历史（模拟记账上线前的数据）
  const f = 't26-shape';
  const file = path.join(HOME, '.agent-io', 'design', f + '.history.jsonl');
  const before = fs.readFileSync(file, 'utf-8');
  const lines = before.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  for (const l of lines) {
    const entry = l.entry as Record<string, unknown>;
    delete entry.op;
  }
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  const r = await write(f, { summary: 'add 的行为基线（再改一次结论措辞）' });
  const d = r.data as { history_ops: { op_unknown_entries: number; last_whole_block_replacement: unknown } };
  assert.equal(d.history_ops.op_unknown_entries, lines.length, '没 op 的条目必须被数出来（＝未知，不许当 update）');
  assert.equal(d.history_ops.last_whole_block_replacement, null, '不知道就别报——猜出来的"上一次"比没有更坏');
});

// ── ⑨ 第二条写路（node.update 的 decision）同一把闸 ──────────

test('⑨ `node.update` 的 data.decision 也要过同一道闸（否则换个 type 就绕过了）', async () => {
  await write('t26-node', { expectations: [bc(CASES3)] });
  await assert.rejects(
    () =>
      updateFeature({
        feature: 't26-node',
        reason: 'T-26：第二条写路（node.update 的 decision）也要被拦',
        operations: [
          {
            op: 'update',
            type: 'node',
            id: 'svc_1',
            data: { decision: { summary: 'add 的行为基线', expectations: [bc([CASES3[0]])] } },
          },
        ],
      } as never),
    /E-CRIT-007/,
  );
  // ★ 同一笔带上声明 ⇒ 放行（否则这条路是"能拒不能声明"的死路）
  const r = await updateFeature({
    feature: 't26-node',
    reason: 'T-26：第二条写路带上声明 ⇒ 放行',
    operations: [
      {
        op: 'update',
        type: 'node',
        id: 'svc_1',
        data: {
          decision: { summary: 'add 的行为基线', expectations: [bc([CASES3[0]])] },
          decision_drop_ok: ['behavior-cases:calc.ts#add'],
        },
      },
    ],
  } as never);
  // ★ node 操作的文案与 decision 不同（这是 node.update 那条路）⇒ 断言打回"真的落盘了"，不打文案
  assert.match(r.message, /全部成功/);
  const dsl = readFeature(HOME, 't26-node') as unknown as {
    geometry: { nodes: Array<{ id: string; decision?: { expectations?: Array<{ cases?: unknown[] }> } }> };
  };
  assert.equal(
    dsl.geometry.nodes.find((n) => n.id === 'svc_1')!.decision?.expectations?.[0]?.cases?.length,
    1,
    '带声明 ⇒ 必须真的写进去（这条路不许变成"能拒不能声明"的死路）',
  );
});

// ── ⑩ 纯函数层：主体键与"认不出 run"的诚实边界 ──────────────

test('⑩ 纯函数：主体键剔除内容字段；`run` 无主体 ⇒ 只数条数、认不出是哪条', () => {
  const a = expectationSubjectKey({ ...bc(CASES3) } as never);
  const b = expectationSubjectKey({ ...bc([CASES3[0]]) } as never);
  assert.equal(a, b, '用例数变了，主体键不变（否则"改内容"会被误判成"换了一条"）');

  const run = { kind: 'run', expect: 'input.x === 1', why: 'x 必须等于 1' };
  assert.equal(expectationSubjectKey(run as never), null, 'run 没有主体 ⇒ null（不许编一个）');

  const loss = expectationLossOf(
    [run, { kind: 'file-exists', path: 'calc.ts', why: 'w' }] as never,
    [] as never,
  );
  assert.equal(loss.keyless_lost, 1, 'run 的消失只能按条数报');
  assert.ok(loss.lost.some((x) => x.key === 'run#0'), 'run 的键是"旧数组下标"，报文里说明它认不出是哪条');
  assert.ok(loss.lost.some((x) => x.key === 'file-exists:calc.ts'));
});
