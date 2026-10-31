/**
 * P1 · **写闸的「按设计侧声明的豁免」** —— 由原证 `certs/t355-gate-exemption-cert.mjs` 整张迁入。
 *
 * ## 它钉的方向（`docs/certs-4-ways.md` 裁决 ③）
 *   ① `Node.gate: 'gated' | 'exempt'` —— 判据**住设计 DSL**，不住闸的代码（路径前缀 = 头号病根）；
 *   ② `collectGateCoverage` 的**唯一读点**（`gateByPath`，与 `byPath` 同键空间）；
 *   ③ `TaskGateBasis` 多一格 `exempt`；回执由 `exemptionLines` **点名**（不许静默）。
 *
 * ## 原证断言 → 本文件用例（一条不删，19 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ①a 收集层读到了设计侧声明（`gateByPath['certs/a.mjs']==='exempt'`） | `① 红`（第 1 条 assert） |
 * | ①b 放行且 basis=**exempt**（不混进 files-not-in-design） | 同上（第 2 条） |
 * | ①c 回执**点名**（逐字「本次写入 <path> 被豁免（节点 …，gate=exempt）」） | 同上（第 3 条） |
 * | ①d 结构化读数 `exempted`（调用方不靠字符串嗅探） | 同上（第 4 条） |
 * | ①e **真写盘**：`editCode` 落盘成功（放行不是嘴上说的） | 同上（第 5 条） |
 * | ①f `editCode` 的人读回执 + 机读 `task_gate` 都点名了豁免 | 同上（第 6 条） |
 * | ②a `src/a.ts`（无 gate、无卡）⇒ 仍抛"未领任务" | `② 绿1`（第 1 条） |
 * | ②b `editCode` 被拒且**一个字节都没写** | 同上（第 2 条） |
 * | ②c **反例**：`certs/b.mjs` **没标** ⇒ 仍拒（路径前缀不是豁免理由） | 同上（第 3 条） |
 * | ③a owner=someone-else、写入者=me ⇒ **A7 拒** | `③ 绿2`（第 1 条） |
 * | ③b 反面对照：owner 本人写 ⇒ 放行（③a 不是"什么都拒"） | 同上（第 2 条） |
 * | ④a 两份 feature 指同一文件、只标一份 ⇒ **仍拒**（AND） | `④ AND`（第 1 条） |
 * | ④b 拒绝信息**点名哪一侧没标** | 同上（第 2 条） |
 * | ④c 两份都标 ⇒ 放行，且回执列出**两条依据** | 同上（第 3 条） |
 * | ⑤a 设计侧写入 `gate=exempt`（经 `edit_dsl` 的唯一写端） | `⑤ 重扫不抹`（第 1 条） |
 * | ⑤b `rebuild_design=true` 之后 `gate` 仍在 | 同上（第 2 条） |
 * | ⑤c 重扫后收集层仍读到豁免（判据仍住设计侧） | 同上（第 3 条） |
 * | ⑥a `exemptionLines` 产出规定句式（唯一渲染处） | `⑥ 渲染器`（第 1 条） |
 * | ⑥b 无豁免 ⇒ 空串（不往回执里塞噪声） | 同上（第 2 条） |
 *
 * ## ★★ 消融（★ 本证**必须用真消融** —— 它的价值就在能抓到真错；2026-10-31 迁移时实测）
 *   **改哪一行**：`src/application/write_gate.ts` 第 1619-1620 行的 `isExempt`（"设计侧声明了豁免"
 *   那条判定）末尾加 `&& false` ⇒ 豁免永远不生效：
 *   `cands.length > 0 && cands.every((c) => c.gate === 'exempt') && false`。
 *   · **红读数**：`用例 2/6 失败` · exit 1 ——
 *     `①` 红：`实测 拒绝落盘（任务闸）：这次要改的 1 个文件**没有挂到任何已领取的任务上**`（basis 不再是 exempt、
 *     回执不再点名、`editCode` 也写不进去）；`④c` 红：同样被闸拒（AND 的正面消失）。
 *   · **还原后**（`git diff` 里该文件消失 = 逐字节相同）⇒ **用例 6/6 · 19 条断言全绿** · exit 0。
 *
 * ## 覆盖边界（诚实清单 · [未核]，与原证一致）
 *   · **不写真仓**：`AGENT_IO_HOME` = 临时 home，代码根 = 临时根；
 *   · **MCP 传输层 [未核]**：直接 import `editCode` / `assertSourceWriteRegistered`；
 *   · **`semantic.files` 兜底那一条 gate 回查 [未核]**：本文件只用几何层路径（真仓实测 0 条只靠
 *     `semantic.files` 的路径 ⇒ 那一路今天不承重）；
 *   · `AGENT_IO_REQUIRE_PLAN=0`（计划闸**解不出 `cert:` 引用**时代的迁移开关）：本文件要观察的是
 *     "放行"这一步，严格档会先把它拦掉 ⇒ 只在本文件内关掉严格档（**只报不拦**），断言一字未改。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ★ 必须在**任何** storage 调用之前（`getDataHome()` 每次调用现读 env）
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { saveDSL, getDSL } from '../src/infrastructure/storage.js';
import { editDslHandler } from '../src/application/design/handlers.js';
import {
  assertSourceWriteRegistered,
  assertSourceWriteRegisteredFor,
  collectGateCoverage,
  exemptionLines,
} from '../src/application/write_gate.js';
import { editCode } from '../src/application/refactor/edit/edit_code.js';
import { importProject } from '../src/infrastructure/graph/import_project.js';

const TMP = makeTempHome();
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
for (const d of ['certs', 'src']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'certs/a.mjs'), 'export const a = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'certs/b.mjs'), 'export const b = 2;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/a.ts'), 'export const sa = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/b.ts'), 'export const sb = 2;\n', 'utf-8');
process.env.AGENT_IO_HOME = HOME;
process.env.AGENT_IO_REQUIRE_PLAN = '0';
after(() => rmRf(TMP));

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRec = Record<string, any>;

const FEAT = 't355gate';
const FEAT2 = 't355gate2';
const seed = (feature: string, nodes: AnyRec[], { root = ROOT }: { root?: string } = {}) =>
  saveDSL({
    id: `feature_${feature}`,
    type: 'feature_diagram',
    feature,
    version: '1.0.0',
    title: feature,
    source_root: root,
    geometry: { layout: 'free', width: 400, height: 300, nodes, edges: [] },
    semantic: { files: [] },
    layers: {},
    annotations: [],
  } as never);

/** 闸的读数（拒 = 抛；放行 = outcome） */
function gate(rel: string): { threw: boolean; out?: AnyRec; msg?: string } {
  try {
    return { threw: false, out: assertSourceWriteRegistered(ROOT, [rel]) as unknown as AnyRec };
  } catch (e) {
    return { threw: true, msg: e instanceof Error ? e.message : String(e) };
  }
}

// ════════════════════════════════════════════════════════════════════
test('① 红：certs/ 下节点 gate=exempt ⇒ 放行 + 回执点名 + 真写盘', async () => {
  seed(FEAT, [{ id: 'file_certs_a_mjs', type: 'file', label: 'a.mjs', path: 'certs/a.mjs', gate: 'exempt' }]);
  const cov = collectGateCoverage(ROOT) as AnyRec;
  const r = gate('certs/a.mjs');

  assert.ok(
    (cov.features as AnyRec[]).some((f) => (f.gateByPath as Map<string, string>).get('certs/a.mjs') === 'exempt'),
    `①a 收集层必须读到设计侧声明：gateByPath=${JSON.stringify((cov.features as AnyRec[]).map((f) => [...(f.gateByPath as Map<string, string>)]))}`,
  );
  assert.ok(
    !r.threw && r.out?.applicable === true && r.out?.basis === 'exempt',
    `①b 必须放行且 basis=**exempt**（既不混进 files-not-in-design，也不 applicable:false）：实测 ${
      r.threw ? String(r.msg).split('\n')[0] : JSON.stringify({ applicable: r.out?.applicable, basis: r.out?.basis })
    }`,
  );
  assert.match(
    r.threw ? '' : String(r.out?.note),
    /本次写入 certs\/a\.mjs 被豁免（节点 file_certs_a_mjs，feature=t355gate，gate=exempt）/,
    `①c 回执必须**点名**（逐字「本次写入 <path> 被豁免（节点 …，gate=exempt）」）：实测 ${
      r.threw ? '（抛了）' : String(r.out?.note).split('\n').filter((l) => l.includes('被豁免'))[0] ?? '（没点名）'
    }`,
  );
  assert.ok(
    !r.threw && (r.out?.exempted as AnyRec[])?.length === 1 && (r.out?.exempted as AnyRec[])[0].path === 'certs/a.mjs',
    `①d 必须有结构化读数 exempted（调用方不靠字符串嗅探决定"要不要点名"）：实测 ${r.threw ? '（抛了）' : JSON.stringify(r.out?.exempted)}`,
  );

  // ★ 真写盘：不只看闸的返回值，看 editCode 的回执与磁盘
  const before = fs.readFileSync(path.join(ROOT, 'certs/a.mjs'), 'utf-8');
  const w = await editCode({
    project_dir: ROOT,
    file: 'certs/a.mjs',
    op: 'replace_text',
    old_text: 'export const a = 1;',
    new_text: 'export const a = 11; // t355 红',
  } as never);
  const afterTxt = fs.readFileSync(path.join(ROOT, 'certs/a.mjs'), 'utf-8');
  const wd = w.data as AnyRec;
  assert.ok(
    wd?.written === true && before !== afterTxt && afterTxt.includes('t355 红'),
    `①e **真写盘**：editCode 必须落盘成功（放行不是嘴上说的）：written=${String(wd?.written)}`,
  );
  assert.ok(
    String(w.message).includes('本次写入 certs/a.mjs 被豁免') && String(wd?.task_gate ?? '').includes("gate='exempt'"),
    `①f editCode 的**人读回执 + 机读 task_gate** 都必须点名豁免：实测 ${
      String(w.message).split('\n').filter((l) => l.includes('被豁免'))[0] ?? '（没点名）'
    }`,
  );
});

// ════════════════════════════════════════════════════════════════════
test('② 绿1：src/ 下没标 ⇒ 仍拒（豁免没扩大）· 反例：certs/ 下的没标也拒', async () => {
  seed(FEAT, [
    { id: 'file_certs_a_mjs', type: 'file', path: 'certs/a.mjs', gate: 'exempt' },
    { id: 'file_src_a_ts', type: 'file', path: 'src/a.ts' }, // ★ 没写 gate = 缺省 gated
  ]);
  const r = gate('src/a.ts');
  assert.ok(
    r.threw && /没有挂到任何已领取的任务上/.test(String(r.msg)),
    `②a src/a.ts（无 gate、无卡）⇒ 必须仍抛"未领任务"：实测 ${r.threw ? String(r.msg).split('\n')[0] : JSON.stringify(r.out)}`,
  );

  // ★ 真写盘那条路也拒，且**文件字节没动**
  const before = fs.readFileSync(path.join(ROOT, 'src/a.ts'), 'utf-8');
  let threw = false;
  try {
    await editCode({
      project_dir: ROOT,
      file: 'src/a.ts',
      op: 'replace_text',
      old_text: 'export const sa = 1;',
      new_text: 'export const sa = 99;',
    } as never);
  } catch {
    threw = true;
  }
  assert.ok(
    threw && fs.readFileSync(path.join(ROOT, 'src/a.ts'), 'utf-8') === before,
    `②b editCode 必须被拒且**一个字节都没写**（闸在快照/写盘之前）：threw=${threw}`,
  );

  // ★ 反面对照：同一目录里"在 certs/ 下但没标"也必须拒 —— 证明**没有**任何路径前缀规则
  seed(FEAT, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs' }]);
  const rb = gate('certs/b.mjs');
  assert.ok(
    rb.threw,
    `②c **反例**：certs/b.mjs **没标** ⇒ 必须仍拒（"在 certs/ 目录里"本身不是豁免理由）：实测 ${rb.threw ? String(rb.msg).split('\n')[0] : JSON.stringify(rb.out)}`,
  );
});

// ════════════════════════════════════════════════════════════════════
test('③ 绿2：A7「谁在写」没坏（他人卡仍拒、本人写放行）', async () => {
  const claimedByOther = {
    id: 'file_src_b_ts',
    summary: 't355 夹具：别人领着的卡',
    expectations: [],
    state: 'claimed',
    owner: 'someone-else',
    claimed_at: '2026-10-20T00:00:00.000Z',
  };
  seed(FEAT, [{ id: 'file_src_b_ts', type: 'file', path: 'src/b.ts', task: claimedByOther }]);
  let msg = '';
  try {
    assertSourceWriteRegisteredFor(ROOT, ['src/b.ts'], 'me');
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  assert.match(msg, /A7/, `③a owner=someone-else、写入者=me ⇒ 必须 **A7 拒**（会覆盖别人的工作）：实测 ${msg.split('\n')[0]}`);
  assert.match(msg, /someone-else/, `③a 拒绝信息必须点名 owner：实测 ${msg.split('\n')[0]}`);

  let okSelf: { threw: boolean; out?: AnyRec; msg?: string };
  try {
    okSelf = { threw: false, out: assertSourceWriteRegisteredFor(ROOT, ['src/b.ts'], 'someone-else') as unknown as AnyRec };
  } catch (e) {
    okSelf = { threw: true, msg: e instanceof Error ? e.message : String(e) };
  }
  assert.ok(
    !okSelf.threw && okSelf.out?.basis === 'covered',
    `③b 反面对照：owner 本人写 ⇒ 必须放行（③a 不是"什么都拒"）：实测 ${okSelf.threw ? String(okSelf.msg).split('\n')[0] : String(okSelf.out?.basis)}`,
  );
});

// ════════════════════════════════════════════════════════════════════
test('④ AND：两份 feature 指同一文件 ⇒ 只标一份仍受闸、点名哪一侧没标', async () => {
  seed(FEAT, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs', gate: 'exempt' }]);
  seed(FEAT2, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs' }]); // ★ 另一份没标
  const r = gate('certs/b.mjs');
  assert.ok(
    r.threw,
    `④a 只标一份 ⇒ 必须**仍拒**（AND；OR 会让"任标一处"静默打开另一份 feature 的地盘）：实测 ${r.threw ? String(r.msg).split('\n')[0] : JSON.stringify(r.out)}`,
  );
  const m = r.threw ? String(r.msg) : '';
  assert.ok(
    /只标了一半/.test(m) && /file_certs_b_mjs（t355gate2，gate=未声明）/.test(m),
    `④b 拒绝信息必须**点名哪一侧没标**（"我标了呀"不许变成没头冤案）：实测 ${m.split('\n').find((l) => l.includes('只标了一半')) ?? '（没点名）'}`,
  );

  seed(FEAT2, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs', gate: 'exempt' }]);
  const r2 = gate('certs/b.mjs');
  assert.ok(
    !r2.threw && r2.out?.basis === 'exempt' && (r2.out?.exempted as AnyRec[])[0].by.length === 2,
    `④c 两份都标 ⇒ 必须放行，且回执列出**两条依据**（AND 的正面）：实测 ${
      r2.threw ? String(r2.msg).split('\n')[0] : JSON.stringify(r2.out?.exempted)
    }`,
  );
  // ★ 清理第二份，免得影响后面的夹具读数（设计文件仍在 HOME 里）
  fs.unlinkSync(path.join(HOME, '.agent-io/design/', `${FEAT2}.dsl.json`));
});

// ════════════════════════════════════════════════════════════════════
test('⑤ 重扫不抹：rebuild_design=true 之后 gate 仍在（判据仍住设计侧）', async () => {
  const PROJ = path.join(TMP, 'proj');
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src/x.ts'), 'export const x = 1;\n', 'utf-8');
  fs.writeFileSync(path.join(PROJ, 'src/y.ts'), 'export const y = 2;\n', 'utf-8');
  const F3 = 't355rebuild';
  await importProject({ project_dir: PROJ, feature: F3, source_root: PROJ } as never);
  const fileNode = ((getDSL(F3) as AnyRec)?.geometry?.nodes as AnyRec[]).find((n) => n.type === 'file');
  assert.ok(fileNode, '夹具异常：import_project 之后必须至少有一个文件节点');

  await editDslHandler({
    feature: F3,
    weight: 'routine',
    agent: 'agent-t355',
    reason: `T355 夹具：把 ${fileNode.id}（src/x.ts）标为量具（豁免写闸）`,
    operations: [{ type: 'node', op: 'update', id: fileNode.id, data: { gate: 'exempt' } }],
  } as never);
  const marked = ((getDSL(F3) as AnyRec)?.geometry?.nodes as AnyRec[]).find((n) => n.id === fileNode.id)?.gate;
  assert.equal(marked, 'exempt', `⑤a 设计侧必须写入 gate=exempt（经 \`edit_dsl\` 的唯一写端）：实测 gate=${JSON.stringify(marked)}`);

  await importProject({ project_dir: PROJ, feature: F3, source_root: PROJ, rebuild_design: true } as never);
  const kept = ((getDSL(F3) as AnyRec)?.geometry?.nodes as AnyRec[]).find((n) => n.id === fileNode.id)?.gate;
  assert.equal(
    kept,
    'exempt',
    `⑤b **rebuild_design=true 之后 gate 必须仍在**（\`carryOverNodeGates\`；不住这一步，一次重扫就静默清零）：实测 gate=${JSON.stringify(kept)}`,
  );
  const c = collectGateCoverage(PROJ) as AnyRec;
  assert.ok(
    (c.features as AnyRec[]).some((f) => (f.gateByPath as Map<string, string>).get('src/x.ts') === 'exempt'),
    `⑤c 重扫后收集层必须仍读到豁免（判据仍住设计侧，没被搬进代码）：实测 gateByPath=${JSON.stringify(
      (c.features as AnyRec[]).map((f) => [...(f.gateByPath as Map<string, string>)]),
    )}`,
  );
});

// ════════════════════════════════════════════════════════════════════
test('⑥ 渲染器：豁免行只出自一处（`exemptionLines`）', () => {
  const lines = exemptionLines([{ path: 'certs/z.mjs', by: [{ feature: 'f1', nodeId: 'n1' }] } as never]);
  assert.ok(
    lines.includes('本次写入 certs/z.mjs 被豁免（节点 n1，feature=f1，gate=exempt）'),
    `⑥a 唯一渲染处必须产出规定句式（单文件/批量/拒绝三条路都调它）：实测 ${lines.split('\n')[1] ?? ''}`,
  );
  assert.equal(exemptionLines([]), '', '⑥b 无豁免 ⇒ 空串（不往回执里塞噪声）');
});
