#!/usr/bin/env node
/**
 * ★★★ cert T334 —— **`evidence` 能不能"经工具层"传进来**的出生证（2026-10-15）。
 *
 * ## 这张证要钉住什么（T334 · `docs/replan-2026-10-15.md`）
 * 写端 `updateStatus`（`status_tools.ts:82`）**有闸**：`status==='done'` 且无 `evidence` ⇒ 抛。
 * 但**工具层传不进 `evidence`**：
 *   ① `update_feature.ts` 的 `case 'status'` 只传 `{feature, node_id, status}`，**不传 evidence**；
 *   ② `op_data_spec.ts` 的 `TYPE_KNOWN_KEYS.status` 只有 `['status']` ⇒ 传 `data.evidence` 会被判
 *      「**不被认的键**」（`checkOpSpec`，`op_data_spec.ts:386`）。
 * ⇒ ★★ **净效果**：LLM **无法经 MCP 标记任何"完成"**（传 ⇒ 键不认；不传 ⇒ 闸拒）
 *   ⇒ 整套"完成必须带证据"的闸**在真实路径上是装饰**。
 *
 * ## ★★ 本证最该学的一课（**为什么以前 6 张证全绿却没发现**）
 * `t328` / `t333` 的判据**全部直调 `updateStatus()` 或造夹具** —— ★ **没有一张走工具层**
 * ⇒ 工具层那条"少传一个参数"的断链**从未被任何判据经过**。
 * ⇒ 所以**本证的每一条判据都必须经工具层**（`editDslHandler`，即 `edit_dsl` 的 handler）
 *   —— ★ **不是**直调 `updateStatus`。
 *
 * ## 判据（全部只看**事实**：工具回执原文 + 落盘 JSON 原文）
 *   ① **不带 `evidence` 置 `done`** ⇒ 经工具层**被拒**（贴错误原文）。
 *   ② **带 `evidence`（三档各一）置 `done`** ⇒ **成功**（贴回执 + 落盘 JSON 原文；三档分别用三个节点）。
 *   ③ **非法 `evidence`**（`kind` 不认识 / `attestation` 缺 `why`）⇒ 经工具层**被拒**（贴原文）。
 *   ④ ★ **自证"走的是工具层"**：同一次调用里塞一个**未知键** ⇒ 被 `checkOpSpec` 点名
 *      「不被认的键」且**已知键里出现 `evidence`** —— 若我们绕过了工具层，这一条不可能发生。
 *
 * ## 用法
 *   node certs/t334-mcp-evidence-path-cert.mjs
 * ★ 夹具住 `certs/.work/tmp`（`AGENT_IO_HOME` 也指到那里 ⇒ 不碰真仓的 `.agent-io/`）。
 * ★ 本证**只读** `dist/`：改了 `src/` 请先 `npm run build`。
 * ★★ 全证**只 1 次删除操作**（末尾清理；本仓"宿主删除闸"按**一个回合内的删除【操作】数**累计，
 *   阈值 50，见 `t328`/`t316` 头注释）—— 故清理那处 **catch 住并响亮报告**：
 *   **被闸拦下 ≠ 本证判红**，但**不许静默**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const dump = (label, text) => {
  console.log(`   ── ${label} ──`);
  for (const line of String(text).split('\n')) console.log(`     ${line}`);
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL, getFeaturesDir } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');

const FEAT = 't334';
const AT = '2026-10-15T00:00:00.000Z';
const overlayFile = () => path.join(getFeaturesDir(), `${FEAT}.overlay.json`);

// ── 夹具：五个文件节点（`done` 各自用独立节点，免得 T333 的"expectations⇄attestation 互斥"串味）──
const mkNode = (id) => ({ id, type: 'file', description: `src/${id}.ts` });
const IDS = ['file_gate', 'file_exp', 'file_read', 'file_att', 'file_bad'];
saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  geometry: { layout: 'free', width: 800, height: 600, nodes: IDS.map(mkNode), edges: [] },
  semantic: { files: IDS.map((id) => ({ id, path: `src/${id}.ts`, responsibility: `T334 夹具 ${id}` })) },
});

/**
 * ★★ 唯一入口：**工具层**（`edit_dsl` 的 handler）—— **绝不**直调 `updateStatus`。
 * `wrap()` 把抛出的错**转成** `{ text, isError:true }`（不抛出）⇒ 下面按 `isError` 读。
 * `weight:'routine'` ⇒ 轻量写路径（仍留 L1-L3）；`reason` 里点名节点 id 以过 L3「实体绑定」。
 */
const callEditDsl = (id, data) =>
  editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: `经 edit_dsl 标记节点 ${id} 的完成状态，因为它的实现已由证据核实（T334 走工具层）`,
    operations: [{ type: 'status', op: 'update', id, data }],
  });

const evidenceOf = (id) => loadOverlay(FEAT)?.anchors?.[id]?.progress_evidence;
const progressOf = (id) => loadOverlay(FEAT)?.anchors?.[id]?.progress;

// ════ ① 不带 evidence 置 done ⇒ 经工具层被拒 ════
console.log('════ ① 不带 evidence 置 done（经工具层 edit_dsl）⇒ 被拒 ════');
{
  const res = await callEditDsl('file_gate', { status: 'done' });
  dump('工具回执原文（edit_dsl → editDslHandler）', res.text);
  chk(
    res.isError === true && /拒绝/.test(res.text) && /三档/.test(res.text) && /expectations/.test(res.text) && /attestation/.test(res.text),
    '① 不带 evidence 置 done ⇒ 工具层**被拒**，理由说清三档',
    res.isError ? res.text.split('\n').slice(-1)[0] : '★★ 没被拒（静默接受了 done）',
  );
  chk(
    progressOf('file_gate') === undefined && evidenceOf('file_gate') === undefined,
    '①-b 被拒后**没有偷偷落盘**（overlay 里该节点无 progress / 无 evidence）',
    `progress=${JSON.stringify(progressOf('file_gate'))} · evidence=${JSON.stringify(evidenceOf('file_gate'))}`,
  );
}

// ════ ② 带 evidence（三档各一）置 done ⇒ 成功 ════
console.log('\n════ ② 带 evidence（三档各一）置 done ⇒ 经工具层**成功** ════');
const KINDS = [
  ['file_exp', 'expectations', { kind: 'expectations', all_green: true, unsupported: 0, ref: 'consistency_check' }],
  ['file_read', 'reading', { kind: 'reading', command: 'npm run verify', observed: '4/4 PASS', at: AT }],
  ['file_att', 'attestation', { kind: 'attestation', by: 'human', at: AT, why: '我亲手核过（T334 证书夹具）' }],
];
for (const [id, kind, evidence] of KINDS) {
  const res = await callEditDsl(id, { status: 'done', evidence });
  chk(res.isError !== true && progressOf(id) === 'done' && evidenceOf(id)?.kind === kind,
    `②-${kind} 带 ${kind} 证据置 done ⇒ 工具层成功，且 progress + evidence 落进 overlay`,
    res.isError ? `★ 被拒：${res.text.split('\n').slice(-1)[0]}`
      : `回执首行 = ${res.text.split('\n')[0]} · progress=${JSON.stringify(progressOf(id))} · evidence.kind=${JSON.stringify(evidenceOf(id)?.kind)}`);
}
// 落盘 JSON **原文**（直读磁盘，不经 loadOverlay）
{
  const raw = fs.readFileSync(overlayFile(), 'utf-8');
  const parsed = JSON.parse(raw);
  for (const [id] of KINDS) {
    dump(`落盘 JSON 原文 <feature>.overlay.json · anchors.${id}`,
      JSON.stringify(parsed.anchors[id], null, 2));
  }
  chk(
    KINDS.every(([id, kind]) => parsed.anchors[id]?.progress === 'done' && parsed.anchors[id]?.progress_evidence?.kind === kind),
    '②-d 三档的 progress + progress_evidence 都在**磁盘原文**里（不只在内存读侧）',
    `anchors=${KINDS.map(([id]) => `${id}=${JSON.stringify(parsed.anchors[id]?.progress_evidence?.kind)}`).join(' · ')}`,
  );
}
// 回执首行自足 + 机器段（走的是同一工具层通道）
{
  const res = await callEditDsl('file_exp', { status: 'in_progress' }); // 复位，顺便看 in_progress 不需证据
  chk(res.isError !== true && progressOf('file_exp') === 'in_progress' && evidenceOf('file_exp') === undefined,
    '②-e `in_progress` 经工具层不需要证据，且旧 evidence 不残留',
    res.isError ? `★ 被拒：${res.text.split('\n').slice(-1)[0]}` : `progress=${JSON.stringify(progressOf('file_exp'))} · evidence=${JSON.stringify(evidenceOf('file_exp'))}`);
}

// ════ ③ 非法 evidence ⇒ 经工具层被拒 ════
console.log('\n════ ③ 非法 evidence（经工具层）⇒ 被拒 ════');
{
  const res1 = await callEditDsl('file_bad', { status: 'done', evidence: { kind: 'vibes', all_green: true } });
  dump('拒绝原文 · kind 不认识', res1.text);
  chk(res1.isError === true && /kind 必须是/.test(res1.text),
    '③-a `kind` 不认识 ⇒ 工具层被拒（点名合法三档）',
    res1.isError ? res1.text.split('\n').slice(-1)[0] : '★★ 没被拒');

  const res2 = await callEditDsl('file_bad', { status: 'done', evidence: { kind: 'attestation', by: 'human', at: AT } });
  dump('拒绝原文 · attestation 缺 why', res2.text);
  chk(res2.isError === true && /why 非空/.test(res2.text),
    '③-b `attestation` 缺 `why` ⇒ 工具层被拒（点名缺哪个字段）',
    res2.isError ? res2.text.split('\n').slice(-1)[0] : '★★ 没被拒');

  chk(progressOf('file_bad') === undefined, '③-c 两次被拒后**都没偷偷落盘**', `progress=${JSON.stringify(progressOf('file_bad'))}`);
}

// ════ ④ 自证"确实走了工具层"：未知键被 `checkOpSpec` 点名，且已知键里出现 evidence ════
console.log('\n════ ④ 自证走的是工具层（未知键被 checkOpSpec 点名，已知键含 evidence）════');
{
  const res = await callEditDsl('file_gate', {
    status: 'done',
    evidence: { kind: 'attestation', by: 'human', at: AT, why: 'x' },
    definitely_bogus_key: 1,
  });
  dump('拒绝原文 · 未知键', res.text);
  chk(
    res.isError === true && /不被认的键/.test(res.text) && /definitely_bogus_key/.test(res.text) && /evidence/.test(res.text),
    '④ 未知键 ⇒ 被 `checkOpSpec` 点名「不被认的键」，且**已知键清单里出现 `evidence`**（⇒ 本证确实在工具层之后）',
    res.isError ? res.text.split('\n')[0] : '★★ 没被拒（说明根本没走 checkOpSpec）',
  );
}

// ★★ 清理：**全证只此 1 次删除操作**（宿主删除闸按删除【操作】数累计，见头注释）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
