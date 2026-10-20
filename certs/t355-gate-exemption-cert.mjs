#!/usr/bin/env node
/**
 * ★★★ cert T355 —— **写闸的「按设计侧声明的豁免」**（2026-10-20 · `docs/certs-4-ways.md` 裁决 ③）
 *
 * ## 本笔新增的方向（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   ① `Node.gate: 'gated' | 'exempt'` —— 判据**住设计 DSL**，不住闸的代码（路径前缀 = 头号病根）；
 *   ② `collectGateCoverage` 的**唯一读点**（`gateByPath`，与 `byPath` 同键空间）；
 *   ③ `TaskGateBasis` 多一格 `exempt`；回执由 `exemptionLines` **点名**（不许静默）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **红**：`certs/` 下的文件节点 `gate='exempt'` ⇒ 放行（basis=exempt），且回执点名
 *      `本次写入 <path> 被豁免（… gate=exempt）`；★ 经 `editCode` **真写盘**验证（不只是闸的返回值）。
 *   ② **绿1（豁免没扩大）**：`src/` 下的文件节点**没标** ⇒ 仍拒 —— "在 certs/ 目录里"本身不是豁免理由。
 *   ③ **绿2（A7 没坏）**：`src/` 节点的卡 owner 是别人 ⇒ 仍拒。
 *   ④ **AND**：两份 feature 指同一文件 ⇒ 只标一份 = 仍受闸，且拒绝信息**点名哪一侧没标**；两份都标 ⇒ 放行。
 *   ⑤ **重扫不抹**：`import_project rebuild_design=true` 之后 `gate` 仍在（否则"住 DSL"等于没住）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不写真仓**：`AGENT_IO_HOME` = 临时 home，代码根 = 临时根；
 *   · **MCP 传输层 [未核]**：直接 import `editCode` / `assertSourceWriteRegistered`；
 *   · **`semantic.files` 兜底那一条 gate 回查 [未核]**：本证只用几何层路径（真仓实测 0 条只靠
 *     `semantic.files` 的路径 ⇒ 那一路今天不承重）。
 *
 * ## 用法
 *   node certs/t355-gate-exemption-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ★ 夹具用 `mkdtempSync`（每次新目录、不删旧目录）：宿主有"每回合 50 次删除"的闸
//   （`SAFE_DELETE_BULK_REQUIRED`），`rmSync` 会让本证在批量跑里崩成假红。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp355gate-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
for (const d of ['certs', 'src']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'certs/a.mjs'), 'export const a = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'certs/b.mjs'), 'export const b = 2;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/a.ts'), 'export const sa = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/b.ts'), 'export const sb = 2;\n', 'utf-8');
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const dump = (label, text) => console.log(`   · ${label}: ${text}`);

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { assertSourceWriteRegistered, assertSourceWriteRegisteredFor, collectGateCoverage, exemptionLines } =
  await import('../dist/src/application/write_gate.js');
const { editCode } = await import('../dist/src/application/refactor/edit/edit_code.js');
const { importProject } = await import('../dist/src/infrastructure/graph/import_project.js');

const FEAT = 't355gate';
const FEAT2 = 't355gate2';
const seed = (feature, nodes, { root = ROOT } = {}) =>
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
  });

/** 闸的读数（拒 = 抛；放行 = outcome） */
const gate = (rel) => {
  try {
    return { threw: false, out: assertSourceWriteRegistered(ROOT, [rel]) };
  } catch (e) {
    return { threw: true, msg: e.message };
  }
};

// ════════════════════════════════════════════════════════════════════
console.log('════ ① 红：certs/ 下节点 gate=exempt ⇒ 放行 + 回执点名 ════');
{
  seed(FEAT, [{ id: 'file_certs_a_mjs', type: 'file', label: 'a.mjs', path: 'certs/a.mjs', gate: 'exempt' }]);
  const cov = collectGateCoverage(ROOT);
  const r = gate('certs/a.mjs');
  chk(
    cov.features.some((f) => f.gateByPath.get('certs/a.mjs') === 'exempt'),
    '①a 收集层读到了设计侧声明（gateByPath[ certs/a.mjs ] === "exempt"）',
    `gateByPath=${JSON.stringify(cov.features.map((f) => [...f.gateByPath]))}`,
  );
  chk(
    !r.threw && r.out.basis === 'exempt' && r.out.applicable === true,
    '①b 放行且 basis=**exempt**（既不混进 files-not-in-design，也不 applicable:false）',
    r.threw ? r.msg.split('\n')[0] : JSON.stringify({ applicable: r.out.applicable, basis: r.out.basis }),
  );
  chk(
    !r.threw && /本次写入 certs\/a\.mjs 被豁免（节点 file_certs_a_mjs，feature=t355gate，gate=exempt）/.test(r.out.note),
    '①c 回执**点名**（逐字：“本次写入 <path> 被豁免（节点 …，gate=exempt）”）',
    r.threw ? '' : r.out.note.split('\n').filter((l) => l.includes('被豁免'))[0],
  );
  chk(
    !r.threw && r.out.exempted.length === 1 && r.out.exempted[0].path === 'certs/a.mjs',
    '①d 结构化读数 `exempted`（调用方不靠字符串嗅探决定"要不要点名"）',
    r.threw ? '' : JSON.stringify(r.out.exempted),
  );

  // ★ 真写盘：不只看闸的返回值，看 editCode 的回执与磁盘
  const before = fs.readFileSync(path.join(ROOT, 'certs/a.mjs'), 'utf-8');
  const w = await editCode({
    project_dir: ROOT,
    file: 'certs/a.mjs',
    op: 'replace_text',
    old_text: 'export const a = 1;',
    new_text: 'export const a = 11; // t355 红',
  });
  const after = fs.readFileSync(path.join(ROOT, 'certs/a.mjs'), 'utf-8');
  chk(
    w.data?.written === true && before !== after && after.includes('t355 红'),
    '①e **真写盘**：editCode 落盘成功（放行不是嘴上说的）',
    `written=${w.data?.written}`,
  );
  chk(
    String(w.message).includes('本次写入 certs/a.mjs 被豁免') && String(w.data?.task_gate ?? '').includes("gate='exempt'"),
    '①f editCode 的**人读回执 + 机读 task_gate** 都点名了豁免（此前闸的 note 被调用方直接丢掉）',
    String(w.message).split('\n').filter((l) => l.includes('被豁免'))[0] ?? '（没点名）',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② 绿1：src/ 下没标 ⇒ 仍拒（豁免没扩大）════');
{
  seed(FEAT, [
    { id: 'file_certs_a_mjs', type: 'file', path: 'certs/a.mjs', gate: 'exempt' },
    { id: 'file_src_a_ts', type: 'file', path: 'src/a.ts' }, // ★ 没写 gate = 缺省 gated
  ]);
  const r = gate('src/a.ts');
  chk(
    r.threw && /没有挂到任何已领取的任务上/.test(r.msg),
    '②a src/a.ts（无 gate、无卡）⇒ 仍抛"未领任务"',
    r.threw ? r.msg.split('\n')[0] : JSON.stringify(r.out),
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
    });
  } catch {
    threw = true;
  }
  chk(
    threw && fs.readFileSync(path.join(ROOT, 'src/a.ts'), 'utf-8') === before,
    '②b editCode 被拒且**一个字节都没写**（闸在快照/写盘之前）',
    `threw=${threw}`,
  );
  // ★ 反面对照：同一目录里"在 certs/ 下但没标"也必须拒 —— 证明**没有**任何路径前缀规则
  seed(FEAT, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs' }]);
  const rb = gate('certs/b.mjs');
  chk(
    rb.threw,
    '②c **反例**：certs/b.mjs **没标** ⇒ 仍拒（"在 certs/ 目录里"本身不是豁免理由）',
    rb.threw ? rb.msg.split('\n')[0] : JSON.stringify(rb.out),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ③ 绿2：A7「谁在写」没坏（他人卡仍拒）════');
{
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
    msg = e.message;
  }
  chk(/A7/.test(msg) && /someone-else/.test(msg), '③a owner=someone-else、写入者=me ⇒ **A7 拒**（会覆盖别人的工作）', msg.split('\n')[0]);
  const okSelf = (() => {
    try {
      return { threw: false, out: assertSourceWriteRegisteredFor(ROOT, ['src/b.ts'], 'someone-else') };
    } catch (e) {
      return { threw: true, msg: e.message };
    }
  })();
  chk(!okSelf.threw && okSelf.out.basis === 'covered', '③b 反面对照：owner 本人写 ⇒ 放行（③a 不是"什么都拒"）', okSelf.threw ? okSelf.msg.split('\n')[0] : okSelf.out.basis);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ AND：两份 feature 指同一文件 ⇒ 只标一份仍受闸 ════');
{
  seed(FEAT, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs', gate: 'exempt' }]);
  seed(FEAT2, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs' }]); // ★ 另一份没标
  const r = gate('certs/b.mjs');
  chk(r.threw, '④a 只标一份 ⇒ **仍拒**（AND；OR 会让"任标一处"静默打开另一份 feature 的地盘）', r.threw ? r.msg.split('\n')[0] : JSON.stringify(r.out));
  chk(
    r.threw && /只标了一半/.test(r.msg) && /file_certs_b_mjs（t355gate2，gate=未声明）/.test(r.msg),
    '④b 拒绝信息**点名哪一侧没标**（"我标了呀"不许变成没头冤案）',
    r.threw ? (r.msg.split('\n').find((l) => l.includes('只标了一半')) ?? '') : '',
  );
  seed(FEAT2, [{ id: 'file_certs_b_mjs', type: 'file', path: 'certs/b.mjs', gate: 'exempt' }]);
  const r2 = gate('certs/b.mjs');
  chk(
    !r2.threw && r2.out.basis === 'exempt' && r2.out.exempted[0].by.length === 2,
    '④c 两份都标 ⇒ 放行，且回执列出**两条依据**（AND 的正面）',
    r2.threw ? r2.msg.split('\n')[0] : JSON.stringify(r2.out.exempted),
  );
  // ★ 清理第二份，免得影响后面的夹具读数（设计文件仍在 HOME 里）
  fs.unlinkSync(path.join(HOME, '.agent-io/design/', `${FEAT2}.dsl.json`));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ 重扫不抹：rebuild_design=true 之后 gate 仍在 ════');
{
  const PROJ = path.join(TMP, 'proj');
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src/x.ts'), 'export const x = 1;\n', 'utf-8');
  fs.writeFileSync(path.join(PROJ, 'src/y.ts'), 'export const y = 2;\n', 'utf-8');
  const F3 = 't355rebuild';
  await importProject({ project_dir: PROJ, feature: F3, source_root: PROJ });
  const d0 = getDSL(F3);
  const fileNode = (d0?.geometry?.nodes ?? []).find((n) => n.type === 'file');
  if (!fileNode) throw new Error('夹具异常：import_project 之后没有文件节点');
  await editDslHandler({
    feature: F3,
    weight: 'routine',
    agent: 'agent-t355',
    reason: `T355 夹具：把 ${fileNode.id}（src/x.ts）标为量具（豁免写闸）`,
    operations: [{ type: 'node', op: 'update', id: fileNode.id, data: { gate: 'exempt' } }],
  });
  const marked = (getDSL(F3)?.geometry?.nodes ?? []).find((n) => n.id === fileNode.id)?.gate;
  chk(marked === 'exempt', '⑤a 设计侧写入 gate=exempt（经 edit_dsl 的唯一写端）', `gate=${JSON.stringify(marked)}`);

  await importProject({ project_dir: PROJ, feature: F3, source_root: PROJ, rebuild_design: true });
  const kept = (getDSL(F3)?.geometry?.nodes ?? []).find((n) => n.id === fileNode.id)?.gate;
  chk(
    kept === 'exempt',
    '⑤b **rebuild_design=true 之后 gate 仍在**（`carryOverNodeGates`；不住这一步，一次重扫就静默清零）',
    `gate=${JSON.stringify(kept)}`,
  );
  const c = collectGateCoverage(PROJ);
  chk(
    c.features.some((f) => f.gateByPath.get('src/x.ts') === 'exempt'),
    '⑤c 重扫后收集层仍读到豁免（判据仍住设计侧，没被搬进代码）',
    `gateByPath=${JSON.stringify(c.features.map((f) => [...f.gateByPath]))}`,
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑥ 渲染器：豁免行只出自一处（`exemptionLines`）════');
{
  const lines = exemptionLines([{ path: 'certs/z.mjs', by: [{ feature: 'f1', nodeId: 'n1' }] }]);
  chk(
    lines.includes('本次写入 certs/z.mjs 被豁免（节点 n1，feature=f1，gate=exempt）'),
    '⑥a 唯一渲染处产出规定句式（单文件/批量/拒绝三条路都调它）',
    lines.split('\n')[1] ?? '',
  );
  chk(exemptionLines([]) === '', '⑥b 无豁免 ⇒ 空串（不往回执里塞噪声）', JSON.stringify(exemptionLines([])));
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
