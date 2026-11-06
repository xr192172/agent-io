/**
 * P0 · **静态候选不得冒充实测**（PROJECT-DESIGN §4.2「语法与语义是两层，不相互冒充」）
 *
 * ## 它守的那句话（原文）
 * 「能力声明至少区分 `syntax-only / semantic / runtime-observed`。**没有语义证据时返回"不足"**，
 *  **不能把静态候选写成实测**。」
 *
 * ## 病（这一层此前没有任何检测点）
 * `reconcile_effects` 是全仓**唯一**把「静态候选」升格成「实测」的地方
 * （`origin: 'ast' → 'runtime'`）。它写错的方向恰恰是**最不容易被发现的那个方向**：
 * 升格条件松一格 ⇒ 每个 ast 候选都被标成"观测到了" ⇒ 所有下游（`contract_page` 的时效性判定、
 * 拔积木时的"这个写我确认过"）都读到一份**看起来有运行证据、实际没有**的契约。
 * 而 `tsc` 对"值"一声不响；`judge-all` 只证明既有判据成立 —— 这一条**当时不在任何判据视野里**。
 *
 * ## 四条用例（每条都说得出"什么输入让它红"）
 * | # | 输入 | 期望 | 它会红的条件 |
 * |---|---|---|---|
 * | ① | 事件文件里**只有非 effect 事件**（span），且 `write_dsl:true` | 契约**逐字节不变**：`origin` 仍 `'ast'`、`runtime` 不存在、`effect_events===0` | 谁把升格写成无条件（不比对 observed target）⇒ 红 |
 * | ② | **同义必命中**：一条 `fields.level='effect'` 且 target 等于候选的事件 | `origin` 变 `'runtime'`、`runtime.call_count===1`、`observed_targets` 含它 | 有人把升格改坏成"永不升格"（那样①会变成永绿的假灯）⇒ 红 |
 * | ③ | **异义必不命中**：事件 target 是候选**外**的 | 绝不把**别的**候选升格；候选外 target 以 `origin:'runtime'` 追加 + 进 `newly_observed` | 谁把"整份契约升格"当地实现（一条命中全变 runtime）⇒ 红 |
 * | ④ | ① 之后的每一条 effect target | 都必须**显式**带 `origin`（不许留 `undefined` —— "没标来源"是一种冒充） | 静态提取漏标来源 ⇒ 红 |
 *
 * ## 消融（2026-11-07 实测，改 `src` 一行、跑完逐字节还原）
 * ① 把 `reconcile_effects.ts` 里升格那三处 `hit.origin = 'runtime'` 的**判定条件**去掉
 *    （改成无条件升格同 kind 的第一条候选）⇒ **用例①红**（零事件也升格）、③ 红。
 * ② 把它改成永不升格 ⇒ **用例②红**（同义不命中 = 机制死掉）。
 *
 * ## 边界（诚实清单）
 * · 只造**仓外**临时 home + 临时项目根（`makeTempHome` + `mkdtemp`），不碰 `.agent-io/` 真册；
 * · 事件格式取自 `reconcile_effects.ts#readEffectEvents` 的实际判定条件
 *   （`fields.level==='effect'` ∧ file ∧ target ∧ kind ∧ probe ∧ time），不是猜的；
 * · **不证明**「TS Checker / go/types 的语义层」那半（§4.2 的前两句）：那要求编译器在场，
 *   由 `semantic_facts.ts` 的 `syntax-only` 回执承载，属另一条判据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { reconcileEffects } from '../src/application/observe/reconcile/reconcile_effects.js';
import { getDSL, saveDSL } from '../src/infrastructure/storage.js';
import type { DesignDSL } from '../src/domain/types.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const REL = 'src/fixture_a.ts';
const CAND = '/tmp/candidate.log';
const OTHER = '/tmp/not-a-candidate.log';

interface Fixture {
  root: string;
  eventsFile: string;
  feature: string;
}

const homes: string[] = [];
const roots: string[] = [];

/** 造一套自治夹具：临时 home（册）+ 临时项目根（事件流 + source_root）。★ 事件权威位置 = `<root>/.agent-io/observe/` */
function makeFixture(name: string): Fixture {
  const home = makeTempHome();
  homes.push(home);
  process.env.AGENT_IO_HOME = home; // ★ storage 每次调用都读它 ⇒ 运行期隔离
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `t39-origin-${name}-`));
  roots.push(root);
  const feature = `t39origin${name}`;
  const contract = {
    schema_version: 1 as const,
    role: { class: 'functional' as const, basis: 'graph' as const, confidence: 0.5 },
    shapes: { exposes: [], consumes: [] },
    effects: {
      writes: [{ target: CAND, op: 'write' as const, origin: 'ast' as const }],
      holds: [],
      emits: [],
      reads_config: [],
    },
  };
  saveDSL({
    id: `feature_${feature}`,
    type: 'feature_diagram',
    feature,
    version: '1.0.0',
    title: feature,
    source_root: root,
    geometry: {
      layout: 'free',
      width: 400,
      height: 300,
      nodes: [{ id: 'n_a', type: 'file', label: 'a', path: REL }],
      edges: [],
    },
    semantic: { files: [{ id: 'n_a', path: REL, responsibility: '夹具：静态契约候选', contract }] },
  } as unknown as DesignDSL);
  const dir = path.join(root, '.agent-io', 'observe');
  fs.mkdirSync(dir, { recursive: true });
  return { root, eventsFile: path.join(dir, 'events-1.jsonl'), feature };
}

const eventLine = (fields: Record<string, unknown>): string =>
  JSON.stringify({ probe: 'fixture.probe', time: '2026-11-07T00:00:00.000Z', fields }) + '\n';

/** 现读册里那份契约（★ 用 storage 的同一读端，不自己拼 JSON 路径） */
const contractOf = (feature: string): any => (getDSL(feature)?.semantic?.files ?? [])[0]?.contract;

test('① 零 effect 事件 ⇒ 静态候选**不得**升格（origin 仍 ast、runtime 不生成、契约逐字节不变）', async () => {
  const fx = makeFixture('a');
  // 只有非 effect 事件：这正是"项目没插桩 / 没跑"的真实形态
  fs.writeFileSync(fx.eventsFile, eventLine({ level: 'span', file: REL }), 'utf8');
  const before = JSON.stringify(contractOf(fx.feature));

  const res = await reconcileEffects({ project_dir: fx.root, feature: fx.feature, events_files: [fx.eventsFile], write_dsl: true });
  const data = res as any; // ★ 回执是**扁平**的（result 字段与 touched 同层），不是 {data:…} 信封
  assert.equal(data.effect_events, 0, `①a) 一条 effect 事件都没有（实得 ${data.effect_events}）`);

  const after = contractOf(fx.feature);
  assert.equal(after.effects.writes[0].origin, 'ast', '①b) ★ 静态候选**仍是 ast** —— 没有观测证据就不许标成实测');
  assert.equal(after.runtime ?? null, null, '①c) ★ `contract.runtime` 不许被凭空造出来（它是"运行证据"的住处）');
  assert.equal(JSON.stringify(after), before, '①d) 零证据 ⇒ 契约**逐字节不变**（不是"只增了几个字段"）');
});

test('①b 只有 hold 事件的同一文件 ⇒ write 候选**仍是 ast**（没观测到这个 kind，就不许升格这个 kind）', async () => {
  const fx = makeFixture('ab');
  // ★ 关键：这条事件**让文件真的被访问到**（`byFile` 命中）⇒ 上面 ①a"整份文件没被访问"那条捷径不再生效，
  //   于是「按 kind 逐条比对」这件事**变成承重的**；否则本组只是"什么都没发生"的假绿。
  fs.writeFileSync(fx.eventsFile, eventLine({ level: 'effect', file: REL, kind: 'hold', target: 'goroutine', op: 'acquire' }), 'utf8');
  const res = await reconcileEffects({ project_dir: fx.root, feature: fx.feature, events_files: [fx.eventsFile], write_dsl: true });
  assert.equal((res as any).effect_events, 1, '①b) 文件被真访问到（1 条 effect 事件）');

  const after = contractOf(fx.feature);
  assert.equal(after.effects.writes[0].origin, 'ast', '①b′) ★ 观测到的是 hold，不是 write ⇒ write 候选**不许**跟着升格');
  assert.ok(
    (after.effects.holds ?? []).some((h: any) => h.origin === 'runtime'),
    '①b″) 而 hold 那侧该升格（同一文件、同一个循环里 —— 证明这一轮**真的跑了**）',
  );
});

test('② 同义必命中：一条 target 对得上的 effect 事件 ⇒ 升格为 runtime（证明①不是永绿的假灯）', async () => {
  const fx = makeFixture('b');
  fs.writeFileSync(fx.eventsFile, eventLine({ level: 'effect', file: REL, kind: 'write', target: CAND, op: 'write' }), 'utf8');

  const res = await reconcileEffects({ project_dir: fx.root, feature: fx.feature, events_files: [fx.eventsFile], write_dsl: true });
  const data = res as any; // ★ 回执是**扁平**的（result 字段与 touched 同层），不是 {data:…} 信封
  assert.equal(data.effect_events, 1, `②a) 读到 1 条 effect 事件（实得 ${data.effect_events}）`);

  const after = contractOf(fx.feature);
  assert.equal(after.effects.writes[0].origin, 'runtime', '②b) ★ 观测命中的候选**必须**升格（否则①就变成永绿的假灯）');
  assert.equal(after.runtime?.call_count, 1, '②c) runtime.call_count 记下真实次数');
  assert.deepEqual(after.runtime?.observed_targets, [CAND], '②d) runtime.observed_targets 只含真正观测到的 target');
});

test('③ 异义必不命中：候选外的 target ⇒ 只追加/newly_observed，绝不把候选本身升格', async () => {
  const fx = makeFixture('c');
  fs.writeFileSync(fx.eventsFile, eventLine({ level: 'effect', file: REL, kind: 'write', target: OTHER, op: 'write' }), 'utf8');

  const res = await reconcileEffects({ project_dir: fx.root, feature: fx.feature, events_files: [fx.eventsFile], write_dsl: true });
  const data = res as any; // ★ 回执是**扁平**的（result 字段与 touched 同层），不是 {data:…} 信封
  const report = (data.reconcile_reports ?? [])[0] ?? {};
  assert.equal(report.confirmed?.writes ?? 0, 0, '③a) 候选**没有被确认**（观测的是别的 target）');
  assert.ok(
    (report.newly_observed ?? []).some((x: any) => x.target === OTHER),
    `③b) 候选外观测必须进 newly_observed（实得 ${JSON.stringify(report.newly_observed ?? [])}）`,
  );

  const after = contractOf(fx.feature);
  assert.equal(after.effects.writes[0].origin, 'ast', '③c) ★ 候选**仍是 ast** —— 一条"别的"事件不许把整份契约升格');
  const added = (after.effects.writes ?? []).filter((w: any) => w.target === OTHER);
  assert.equal(added.length, 1, '③d) 新观测到的 target 以独立条目追加（不覆盖、不合并成一条）');
  assert.equal(added[0].origin, 'runtime', '③e) 追加的那条**必须**标 runtime（它才是实测）');
});

test('④ 每条 effect target 都必须显式带 origin（"没标来源"也是一种冒充）', async () => {
  const fx = makeFixture('d');
  fs.writeFileSync(fx.eventsFile, eventLine({ level: 'span', file: REL }), 'utf8');
  await reconcileEffects({ project_dir: fx.root, feature: fx.feature, events_files: [fx.eventsFile], write_dsl: true });

  const c = contractOf(fx.feature);
  const all = [...(c.effects.writes ?? []), ...(c.effects.holds ?? [])];
  assert.ok(all.length > 0, '④a) 夹具里本来就该有候选（0 条 ⇒ 本用例在空集上恒真）');
  for (const t of all) {
    assert.ok(
      t.origin === 'ast' || t.origin === 'runtime',
      `④b) ★ target ${JSON.stringify(t.target)} 的 origin=${JSON.stringify(t.origin)} —— 每条 effect 都必须说清它是静态候选还是实测，不许留空`,
    );
  }
});

test.after(() => {
  for (const r of roots) rmRf(r);
  for (const h of homes) rmRf(h);
});

