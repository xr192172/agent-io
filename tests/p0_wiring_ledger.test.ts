/**
 * touches: src/infrastructure/analysis/health/wiring_ledger.ts, src/infrastructure/analysis/health/wiring_facts.ts
 *
 * ★ 这一行让**增量验证**能把这支测试归因到被改的文件（没它 ⇒ 只能进"未声明"，永远不会被自动选中）。
 * P0 · **能力接线账**（`docs/PROJECT-DESIGN.md` §13.4 的最小落地）。
 *
 * ## 它钉的四件事
 * ① **七态各都能到**：`connected / static-only / missing-input / missing-consumer /
 *    missing-handoff / reserved-experiment / unverifiable` —— 少一态就说明判定被短路了；
 * ② **真实仓的四个已知答案**：`includeComments` ⇒ connected；`deriveJudgements` ⇒ missing-handoff（第⑧项写口接上后 input 已通，断在 handoff）；
 *    `runtime` ⇒ missing-handoff；`BrickContract`（显式预留）⇒ reserved-experiment（**不是 dead**）；
 * ③ **有牙**：把 `includeComments` 的消费处从源码副本里删掉 ⇒ 状态必须从 `connected` 变成 `missing-consumer`
 *    （不变量：**静态调用 ≠ 真实执行**，**零 import ≠ 死**）；
 * ④ **探针失败 ⇒ `unverifiable`**（证据不足不下结论，更不冒领 connected）。
 *
 * ## 为什么不把"扫描到多少能力"当判据
 * 这张账本轮只喂四个对象。判据是"这四个各自的状态对不对、打断会不会变"，
 * 不是"扫了多少" —— 数量不是判据（AGENTS.md §二）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assessWiring, buildWiringLedger, type WiringFacts } from '../src/infrastructure/analysis/health/wiring_ledger.ts';
import { collectWiringProbes } from '../src/infrastructure/analysis/health/wiring_facts.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** 造一组"全绿"的事实，再按需打掉一格 */
const facts = (over: Partial<WiringFacts> = {}): WiringFacts => ({
  declared: true,
  input_present: true,
  handoff_connected: true,
  consumed: true,
  executed: true,
  notes: {},
  ...over,
});
const decl = (over: Record<string, string> = {}) => ({ subject: 'probe#x', claimed_capability: 'c', ...over });

test('① 七态各都能到达（少一态 = 判定被短路）', () => {
  const cases: Array<[string, ReturnType<typeof assessWiring>['status']]> = [
    ['connected', assessWiring(decl(), facts()).status],
    ['static-only', assessWiring(decl(), facts({ executed: false })).status],
    ['missing-input', assessWiring(decl(), facts({ input_present: false })).status],
    ['missing-consumer', assessWiring(decl(), facts({ consumed: false })).status],
    ['missing-handoff', assessWiring(decl(), facts({ handoff_connected: false })).status],
    ['reserved-experiment', assessWiring(decl({ reserved: '实验' }), facts({ consumed: false, executed: false })).status],
    ['unverifiable', assessWiring(decl(), facts({ declared: false })).status],
  ];
  for (const [want, got] of cases) assert.equal(got, want, `期望 ${want}，实得 ${got}`);
});

test('② 链的顺序是物理顺序：输入断时不再问消费者', () => {
  const e = assessWiring(decl(), facts({ input_present: false, consumed: false, executed: false }));
  assert.equal(e.status, 'missing-input');
  assert.equal(e.broken_at, 'input');
  // 输入断 ⇒ 证据里不该出现 consumer/execution 的结论（后面几环没意义）
  assert.ok(!e.evidence.some((x) => x.startsWith('✗ consumer')), e.evidence.join(' | '));
});

test('③ 零 import 不判死：missing-consumer 不给"删除"建议', () => {
  const e = assessWiring(decl(), facts({ consumed: false }));
  assert.equal(e.status, 'missing-consumer');
  assert.match(String(e.next_action), /不要因为没人用就删/);
});

test('④ 显式预留不冒充已接入，也不判死', () => {
  const reserved = assessWiring(decl({ reserved: '公共库，等消费者' }), facts({ consumed: false, executed: false }));
  assert.equal(reserved.status, 'reserved-experiment');
  assert.equal(reserved.broken_at, null);
  assert.match(String(reserved.next_action), /不判死/);
  // 真接上了就按实况报 connected（预留声明不能压过事实）
  assert.equal(assessWiring(decl({ reserved: 'x' }), facts()).status, 'connected');
});

test('⑤ 探针抛错 ⇒ unverifiable（证据不足不猜）', () => {
  const out = buildWiringLedger([
    {
      declaration: decl(),
      probe: () => {
        throw new Error('读不到事实');
      },
    },
  ]);
  assert.equal(out[0].status, 'unverifiable');
  assert.match(out[0].evidence.join(' '), /探针失败/);
});

test('⑥ 真实仓：四个已知对象的接线状态', async () => {
  const got = new Map(buildWiringLedger(collectWiringProbes(ROOT)).map((w) => [w.subject, w]));
  const pick = (k: string) => got.get(k);

  const inc = [...got.values()].find((w) => w.subject.includes('#includeComments'));
  assert.ok(inc, 'includeComments 那条必须在账上');
  assert.equal(inc.status, 'connected', `includeComments 应 connected，实得 ${inc.status} / ${inc.evidence.join(' | ')}`);

  const dj = [...got.values()].find((w) => w.subject.includes('#deriveJudgements'));
  assert.ok(dj);
  assert.notEqual(dj.status, 'connected', 'deriveJudgements 不得 connected');
  // ★★ 2026-11-10（第⑧项）：写口已接（edit_dsl file op 认 contract，text_strip.ts 已有首条
  //   effects.writes=[] 契约落册）⇒ input_present=true ⇒ 状态从 missing-input 走到 missing-handoff
  //   （还差的格子 = 判定器消费 deriveJudgements，下张卡）。broken_at 加严：钉住"input 已通、断在 handoff"
  //   这个中间态——input 格退回去它红、handoff 接上后它红着提醒推进断言（检测点带牙，不是改期望值）。
  assert.equal(dj.status, 'missing-handoff', `实得 ${dj.status}`);
  assert.equal(dj.broken_at, 'handoff', `应断在 handoff 格（input 已通），实得 ${dj.broken_at}`);
  assert.ok(!JSON.stringify(dj).includes('"dead"'), '不许输出 dead');

  const rt = got.get('judgement-kind:runtime');
  assert.ok(rt);
  // ★ 第三阶段已把「交接」接到**可入库样例事件流**上 ⇒ 现在 connected（且真跑：by_kind.runtime.checked>0）
  assert.equal(rt.status, 'connected', `实得 ${rt.status} / ${rt.evidence.join(' | ')}`);
  // 但不得因此宣称「生产链路已观测」：证据里必须点明输入是可入库样例
  assert.match(rt.evidence.join(' '), /可入库样例/, 'evidence 必须区分「样例」与「生产事件」');

  const bc = got.get('src/domain/contract.ts#BrickContract');
  assert.ok(bc);
  assert.equal(bc.status, 'reserved-experiment', '有明确预留声明 ⇒ reserved-experiment，不是 dead');
  assert.equal(pick('不存在'), undefined);
});

test('⑦ 有牙：删掉 includeComments 的消费处 ⇒ connected 必须变化', async () => {
  const real = buildWiringLedger(collectWiringProbes(ROOT)).find((w) => w.subject.includes('#includeComments'));
  assert.equal(real?.status, 'connected', '前置：真实仓里它是 connected');

  // 造一个"只差消费处"的项目副本（只拷探针真正读的那几个文件）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-probe-'));
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), text, 'utf-8');
  };
  const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

  put('src/domain/expectation.ts', src('src/domain/expectation.ts'));
  put('src/domain/expectation_kinds.ts', src('src/domain/expectation_kinds.ts'));
  put(
    'src/application/design/intent/expectations.ts',
    // ★ 唯一改动：把消费处那一行剥掉（其余逐字保留）
    src('src/application/design/intent/expectations.ts').replace('e.includeComments', 'undefined'),
  );
  // 设计与运行读数照抄（让"输入/交接/执行"三格保持绿，只剩消费者这一格被动过）
  put('.agent-io/design/agent-io.dsl.json', '{"geometry":{"nodes":[]},"x":["includeComments","includeComments"]}');
  put('.agent-io/judge-readings.json', JSON.stringify({ by_kind: { 'source-has': { checked: 120 } } }));

  const broken = buildWiringLedger(collectWiringProbes(tmp)).find((w) => w.subject.includes('#includeComments'));
  fs.rmSync(tmp, { recursive: true, force: true });

  assert.notEqual(broken?.status, 'connected', '打断消费处后不得仍是 connected');
  assert.equal(broken?.status, 'missing-consumer', `实得 ${broken?.status} / ${broken?.evidence.join(' | ')}`);
});

test('⑧ 有牙：抽掉册里那条 runtime 判据 ⇒ 必须退回 missing-handoff', async () => {
  const real = buildWiringLedger(collectWiringProbes(ROOT)).find((w) => w.subject === 'judgement-kind:runtime');
  assert.equal(real?.status, 'connected', `前置：真实仓里 runtime 应 connected，实得 ${real?.status} / ${real?.evidence.join(' | ')}`);

  // 造一个"其余都照旧、只少了那条 runtime 判据"的项目副本
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-rt-'));
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), text, 'utf-8');
  };
  const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

  put('src/domain/expectation.ts', src('src/domain/expectation.ts'));
  put('src/domain/expectation_kinds.ts', src('src/domain/expectation_kinds.ts'));
  put('src/application/design/intent/expectations.ts', src('src/application/design/intent/expectations.ts'));
  put('src/domain/contract.ts', src('src/domain/contract.ts'));
  // 样例事件流照抄（输入那一格保持绿 ⇒ 变量只有"交接"）
  put('tests/fixtures/observe/events-sample.jsonl', src('tests/fixtures/observe/events-sample.jsonl'));
  // 设计册里**没有** runtime 判据；运行读数照抄
  put('.agent-io/design/agent-io.dsl.json', '{"geometry":{"nodes":[]}}');
  put('.agent-io/judge-readings.json', JSON.stringify({ by_kind: { runtime: { checked: 1 } } }));

  const broken = buildWiringLedger(collectWiringProbes(tmp)).find((w) => w.subject === 'judgement-kind:runtime');
  fs.rmSync(tmp, { recursive: true, force: true });

  assert.equal(broken?.status, 'missing-handoff', `实得 ${broken?.status} / ${broken?.evidence.join(' | ')}`);
  assert.equal(broken?.broken_at, 'handoff');
});

test('⑨ 删掉可入库样例 ⇒ runtime 必须退回 missing-input（输入格也要有牙）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-rt2-'));
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), text, 'utf-8');
  };
  const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
  put('src/domain/expectation.ts', src('src/domain/expectation.ts'));
  put('src/domain/expectation_kinds.ts', src('src/domain/expectation_kinds.ts'));
  put('src/application/design/intent/expectations.ts', src('src/application/design/intent/expectations.ts'));
  put('.agent-io/design/agent-io.dsl.json', src('.agent-io/design/agent-io.dsl.json'));
  put('.agent-io/judge-readings.json', JSON.stringify({ by_kind: { runtime: { checked: 1 } } }));
  // 故意不写 tests/fixtures/observe/events-sample.jsonl

  const broken = buildWiringLedger(collectWiringProbes(tmp)).find((w) => w.subject === 'judgement-kind:runtime');
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(broken?.status, 'missing-input', `实得 ${broken?.status}`);
});
