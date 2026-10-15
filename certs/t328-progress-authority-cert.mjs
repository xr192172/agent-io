#!/usr/bin/env node
/**
 * ★★★ cert T328 —— **进度轴收归的出生证**（2026-10-15）。
 *
 * ## 这张证要钉住什么（`docs/todo.md` T328 · `docs/replan-2026-10-15.md` §19/§20）
 * 进度（`draft | in_progress | done`）的**唯一权威**是 `<feature>.overlay.json` 锚点上的
 * `progress`（`domain/overlay.ts#OverlayAnchor.progress`）—— 因为 base 是**扫描可再生成**的，
 * 只写 base 的话 `import_project` 的 `rebuild_design=true` **一重建就把人写的进度冲掉**
 * （T75/T182 在决策卡 / `lifecycle` 上已各栽过一次，本条是第三次同族）。
 *
 * ## 三条判据（★ 全部只看**事实**：落盘文件与抛没抛，不看回执文案）
 *   **A 首次迁移不漏**：`seedOverlayFromDsl` 必须把"**只有进度、没有决策/参数/标注/lifecycle**"的
 *      节点也收进 overlay（★ 跳过条件漏加一项 ⇒ 首次迁移**静默丢**；T182 在 `lifecycle` 上踩过）。
 *      另加 A2：进度**只在 `semantic.files` 上**（几何层没有）时的兜底路也要收下。
 *   **B `rebuild_design=true` 后人写的 progress 仍在**：
 *      B1 域级（seed → reconcile → apply）· B2 **真跑 `importProject`**（连跑两次 `rebuild_design=true`）
 *      · B3 扫描侧**不再落** doc 级 `status`（且读侧 `resolveDiagramStatus` 仍读作 `done`）
 *      · B4 扫描侧**不再把 `status` 落到文件节点/语义文件**上（T328 摘掉的 `import_project:1338/1351`）。
 *   **C 不带 `evidence` 置 `done` 被拒**（"不许默默勾上"）：
 *      C1 无证据 ⇒ 拒 + 说清三档 + **拒了不许偷偷写**（C1b）· C2 `unsupported>0` ⇒ 拒
 *      （"没判"不是"通过"）· C3 `reading` 缺字段 ⇒ 拒 · C4 带 `attestation` ⇒ 通过且**落进 overlay**
 *      · C5 权威被**投影回 base**（`get_dsl` 当下可读）· C6 `draft/in_progress` 不需要证据，且旧证据不残留。
 *   **D 经工具层置 `done`**（T334 纪律）：D1 无证据经 `edit_dsl` handler ⇒ 拒 · D1b 被拒不落盘 ·
 *      D2 带合法证据 ⇒ 成功且落盘 · D3 未知键自证"确实在工具层之后"。
 *
 * ## ★ 覆盖边界（诚实清单 · [未核] —— 2026-10-15 复核所加）
 *   本证每条判据都到 **`edit_dsl` 的 handler（`editDslHandler`）为止**：
 *   ★ **MCP 传输层 / MCP schema 层 [未核]**：本证**直接 import handler**，**没有**经 MCP server 的协议 /
 *     `tools/list` 那条 JSON Schema 的准入走一遍 ⇒ 传输与 schema 校验**不在本证射程**。
 *   ★ **daemon 转发分支 [未核]**：本证**不起 daemon**，**没有**跑过 daemon 那条转发 / 代理分支。
 *   ⇒ 要覆盖这两层需起 MCP server / daemon —— 本证**刻意不引入**这份脆弱依赖（判据是"handler 层可达"）；
 *     超出即 [未核]，**不写成"已覆盖"**。
 *
 * ## 用法
 *   node certs/t328-progress-authority-cert.mjs
 * ★ 夹具住 `certs/.work/tmp`（`AGENT_IO_HOME` 也指到那里 ⇒ 不碰真仓的 `.agent-io/`）。
 * ★★ **全证只有 1 次删除操作** —— 本仓有"宿主删除闸"前科（见 `t316-observe-pack-cert.mjs` 头注释：
 *   那道闸按**一个回合内的删除【操作】数**累计，阈值 50，全量套件必然越过）
 *   ⇒ 为此**连夹具里那个"删掉 overlay 再重建"的动作也换掉了**（改成"另存成新 feature 名"，
 *     见 B 节注释）—— 宁可多写两行，也不给闸多记一次。★ 清理那一处**catch 住并响亮报告**：
 *     **被闸拦下 ≠ 本证判红**（本证的判据是 A/B/C 三条业务事实）—— 但**不许静默**。
 * ★ 本证**只读** `dist/`：改了 `src/` 请先 `npm run build`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
/** 跑一段"应当抛"的代码，返回错误文案（没抛 ⇒ 返回空串） */
const catchMsg = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return String((e && e.message) || e);
  }
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
//   （`storage.ts:60` 逐字写着"必须在调用时读取 env（不能模块加载时缓存）"，但动态 import 更稳、
//     也顺带让本证**不依赖**"包根自省"那条路）。
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const O = await import('../dist/src/domain/overlay.js');
const { seedOverlayFromDsl, reconcileOverlay, buildCandidates, buildEdgeCandidates, applyOverlay, validateProgressEvidence } = O;
const { resolveDiagramStatus } = await import('../dist/src/domain/geometry.js');
const { importProject } = await import('../dist/src/infrastructure/graph/import_project.js');
const { getDSL, saveDSL } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { updateStatus } = await import('../dist/src/application/design/dsl_ops/status_tools.js');
// ★★ T334 证书纪律：每张证至少一条判据走**工具层**（`edit_dsl` 的 handler），不许只直调内部函数。
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');

console.log('════ A · 首次迁移不漏（seedOverlayFromDsl）════');
// ── A1：只有 progress、没有 decision/attributes/annotations/lifecycle 的节点 ──────────
{
  const base = {
    feature: 'fx',
    geometry: {
      layout: 'free', width: 10, height: 10,
      nodes: [{ id: 'file_a', type: 'file', description: 'src/a.ts', status: 'in_progress' }],
      edges: [],
    },
  };
  const ov = seedOverlayFromDsl(base);
  const a = ov.anchors['file_a'];
  chk(
    !!a && a.progress === 'in_progress',
    'A1 首次迁移收下"只有 progress、没有决策"的节点',
    `anchors=${JSON.stringify(Object.keys(ov.anchors))} · file_a.progress=${JSON.stringify(a?.progress)}`,
  );
}
// ── A2：进度只在 semantic.files 上（几何层无同名节点的兜底路）──────────────────────
{
  const base = {
    feature: 'fx',
    geometry: { nodes: [{ id: 'file_b', type: 'file', description: 'src/b.ts' }], edges: [] },
    semantic: { files: [{ id: 'file_b', path: 'src/b.ts', status: 'done' }] },
  };
  const ov = seedOverlayFromDsl(base);
  chk(
    ov.anchors['file_b']?.progress === 'done',
    'A2 兜底路：进度只在 semantic.files 上时也收下',
    `file_b=${JSON.stringify(ov.anchors['file_b'])}`,
  );
}

console.log('\n════ B · rebuild_design=true 后人写的 progress 仍在 ════');
// ── B1：域级（seed → reconcile → apply）不丢 ────────────────────────────────────
{
  const base = {
    feature: 'fx', id: 'imported_fx',
    geometry: { nodes: [{ id: 'file_a', type: 'file', description: 'src/a.ts', status: 'in_progress' }], edges: [] },
    semantic: { files: [{ id: 'file_a', path: 'src/a.ts', status: 'in_progress' }] },
  };
  const ov = seedOverlayFromDsl(base);
  const fresh = {
    feature: 'fx', id: 'imported_fx',
    geometry: { nodes: [{ id: 'file_a', type: 'file', description: 'src/a.ts' }], edges: [] },
    semantic: { files: [{ id: 'file_a', path: 'src/a.ts' }] },
  };
  const { overlay } = reconcileOverlay(ov, buildCandidates(fresh), buildEdgeCandidates(fresh));
  const rebuilt = applyOverlay(fresh, overlay);
  chk(
    overlay.anchors['file_a']?.progress === 'in_progress' &&
      rebuilt.geometry.nodes[0].status === 'in_progress' &&
      rebuilt.semantic.files[0].status === 'in_progress',
    'B1 域级重建：overlay 仍在 + 投影回 base（geometry 与 semantic 两层）',
    `overlay.progress=${JSON.stringify(overlay.anchors['file_a']?.progress)} · node.status=${JSON.stringify(rebuilt.geometry.nodes[0].status)} · file.status=${JSON.stringify(rebuilt.semantic.files[0].status)}`,
  );
}
// ── B2/B3/B4：真跑 import_project({rebuild_design:true}) ────────────────────────
{
  const projDir = fs.mkdtempSync(path.join(TMP, 'proj-'));
  fs.mkdirSync(path.join(projDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projDir, 'src', 'a.ts'), 'export function alpha(){ return 1; }\n');
  fs.writeFileSync(path.join(projDir, 'src', 'b.ts'), "import { alpha } from './a';\nexport const beta = alpha();\n");

  // ① 首次导入（真扫描 → 建 base）
  await importProject({ project_dir: projDir, feature: 'fx1', source_root: projDir });

  // ② 造出「**一个带人类进度、且还没有 overlay**」的 base —— 下一次 rebuild 会走"首次迁移（seed）"分支。
  //   ★ 原始临时夹具（`tmp_fixture_progress.mjs`）是"改 base 后 `unlinkSync(overlay)`"来达成这个前提；
  //     本证**换成一个删除都不做**的做法：**另存成新 feature 名**（`fx2`）——
  //     因为本仓有"宿主删除闸"（按**一个回合内的删除【操作】数**累计，阈值 50，见 t316 头注释）
  //     ⇒ 本证**总共只许 1 次删除操作**（末尾清理）⇒ **证里其余地方一个 `rm/unlink` 都不许有**。
  const srcDsl = getDSL('fx1');
  const target = srcDsl.geometry.nodes.find((n) => n.type === 'file');
  const targetId = target.id;
  target.status = 'in_progress';
  srcDsl.feature = 'fx2';
  srcDsl.id = 'imported_fx2';
  saveDSL(srcDsl); // fx2 的 base 已带人类进度；而 `fx2.overlay.json` **不存在**
  const feat = 'fx2';

  // ③ 第一次重建：seed 收进度 → 投影回 base
  await importProject({ project_dir: projDir, feature: feat, source_root: projDir, rebuild_design: true });
  // ④ 第二次重建：**已有 overlay** ⇒ 人写的进度必须还在（核心判据）
  await importProject({ project_dir: projDir, feature: feat, source_root: projDir, rebuild_design: true });
  const after2 = getDSL(feat);
  const ov2 = loadOverlay(feat);
  const n2 = after2.geometry.nodes.find((n) => n.id === targetId);
  chk(
    n2?.status === 'in_progress' && ov2?.anchors?.[targetId]?.progress === 'in_progress',
    'B2 真跑两次 rebuild_design=true：人写的 progress 仍在（base 投影 + overlay 权威）',
    `node.status=${JSON.stringify(n2?.status)} · overlay.progress=${JSON.stringify(ov2?.anchors?.[targetId]?.progress)}`,
  );
  chk(
    after2.status === undefined && resolveDiagramStatus(after2) === 'done',
    'B3 扫描侧不再落 doc 级 status；读侧仍读作 done',
    `dsl.status=${JSON.stringify(after2.status)} · resolveDiagramStatus=${resolveDiagramStatus(after2)}`,
  );
  const other = after2.geometry.nodes.find((n) => n.type === 'file' && n.id !== targetId);
  const otherFile = after2.semantic?.files?.find((f) => f.id !== targetId);
  chk(
    other !== undefined && other.status === undefined && (!otherFile || otherFile.status === undefined),
    'B4 扫描侧不再把 status 落到文件节点/语义文件（import_project:1338/1351 已摘）',
    `另一个文件节点 ${other?.id} 的 status=${JSON.stringify(other?.status)} · 另一个语义文件 status=${JSON.stringify(otherFile?.status)}`,
  );
}

console.log('\n════ C · 不带 evidence 置 done 被拒（"不许默默勾上"）════');
{
  const feat = 'c328';
  saveDSL({
    id: `feature_${feat}`, type: 'feature_diagram', feature: feat, version: '1.0.0', title: feat,
    geometry: {
      layout: 'free', width: 800, height: 600,
      nodes: [{ id: 'file_c', type: 'file', description: 'src/c.ts' }],
      edges: [],
    },
    semantic: { files: [{ id: 'file_c', path: 'src/c.ts', responsibility: '夹具文件' }] },
  });
  const progressOf = () => loadOverlay(feat)?.anchors?.['file_c']?.progress;

  // C1：done 且无 evidence ⇒ 拒，且理由要说清（含三档）
  const msg1 = catchMsg(() => updateStatus({ feature: feat, node_id: 'file_c', status: 'done' }));
  chk(
    msg1 !== '' && /拒绝/.test(msg1) && /三档/.test(msg1) && /expectations/.test(msg1) && /attestation/.test(msg1),
    'C1 progress=done 且没有 evidence ⇒ 被拒，理由说清三档',
    msg1 === '' ? '★ 没抛（静默接受了 done）' : msg1.split('\n')[0],
  );
  // C1b：被拒之后**不许偷偷写**（不静默、不自动补）
  chk(progressOf() === undefined, 'C1b 被拒后没有偷偷写入 progress（不静默、不自动补）', `overlay.progress=${JSON.stringify(progressOf())}`);

  // C2：假证据 —— unsupported>0（"还有些没判"）⇒ 拒；"没判"不是"通过"
  const msg2 = catchMsg(() =>
    updateStatus({ feature: feat, node_id: 'file_c', status: 'done', evidence: { kind: 'expectations', all_green: true, unsupported: 1 } }),
  );
  chk(msg2 !== '' && /unsupported/.test(msg2), 'C2 unsupported>0 的 expectations ⇒ 被拒（"没判"≠"通过"）', msg2 === '' ? '★ 没抛' : msg2.split('\n')[0]);

  // C3：假证据 —— reading 缺字段 ⇒ 拒
  const msg3 = catchMsg(() =>
    updateStatus({ feature: feat, node_id: 'file_c', status: 'done', evidence: { kind: 'reading', command: '', observed: 'x', at: '2026-10-15' } }),
  );
  chk(msg3 !== '' && /command/.test(msg3), 'C3 残缺 evidence（reading 缺 command）⇒ 被拒', msg3 === '' ? '★ 没抛' : msg3.split('\n')[0]);

  // C4：带 attestation ⇒ 通过，且**落进 overlay 权威**
  const ok1 = catchMsg(() =>
    updateStatus({
      feature: feat, node_id: 'file_c', status: 'done',
      evidence: { kind: 'attestation', by: 'human', at: '2026-10-15T00:00:00.000Z', why: '我亲手核过（T328 证书夹具）' },
    }),
  );
  const a4 = loadOverlay(feat)?.anchors?.['file_c'];
  chk(
    ok1 === '' && a4?.progress === 'done' && a4?.progress_evidence?.kind === 'attestation' && a4?.progress_evidence?.by === 'human',
    'C4 带 attestation 证据 ⇒ 通过，且 progress + progress_evidence 一起落进 overlay',
    ok1 === '' ? `progress=${JSON.stringify(a4?.progress)} · evidence=${JSON.stringify(a4?.progress_evidence)}` : `★ 抛了：${ok1.split('\n')[0]}`,
  );

  // C5：权威被投影回 base（get_dsl 当下可读）
  const n5 = getDSL(feat)?.geometry?.nodes?.find((n) => n.id === 'file_c');
  const f5 = getDSL(feat)?.semantic?.files?.find((f) => f.id === 'file_c');
  chk(n5?.status === 'done' && f5?.status === 'done', 'C5 权威被投影回 base（Node.status / SemanticFile.status）', `node=${JSON.stringify(n5?.status)} · file=${JSON.stringify(f5?.status)}`);

  // C6：draft / in_progress 不需要证据；且旧的 evidence 不许残留
  const ok6 = catchMsg(() => updateStatus({ feature: feat, node_id: 'file_c', status: 'in_progress' }));
  const a6 = loadOverlay(feat)?.anchors?.['file_c'];
  chk(
    ok6 === '' && a6?.progress === 'in_progress' && a6?.progress_evidence === undefined,
    'C6 in_progress 不需要证据；且旧的 evidence 不残留（不许拿着上一轮的证据冒充）',
    ok6 === '' ? `progress=${JSON.stringify(a6?.progress)} · evidence=${JSON.stringify(a6?.progress_evidence)}` : `★ 抛了：${ok6.split('\n')[0]}`,
  );

  // C7：校验器是**纯函数**、可单独调（判据只住一处 —— 与 C1~C3 同一把尺）
  const v = validateProgressEvidence('done', undefined);
  chk(v.ok === false && validateProgressEvidence('in_progress', undefined).ok === true, 'C7 校验器可单独调用且同一判据（done⇒拒 / in_progress⇒放行）', `done=${JSON.stringify(v.ok)} · in_progress=${JSON.stringify(validateProgressEvidence('in_progress', undefined).ok)}`);
}

// ════ D · ★ 工具层路径（T334 证书纪律 · 2026-10-15）：经 `edit_dsl` 的 handler 置 done ════
//   为什么补这一节：C 节（C1~C7）**全部直调 `updateStatus`** —— 而工具层那条链
//   （`edit_dsl` → `editDslHandler` → `dispatchDslEdit` → `updateFeature` 的 `case 'status'`）
//   **可能少收/少传参数**（T334 实测 `evidence` 曾经传不进去）⇒ 直调全绿**证明不了**工具层可达。
//   ⇒ 本节的每条判据**只经工具层**（`editDslHandler`，即 `edit_dsl` 的 handler），**绝不直调**。
console.log('\n════ D · ★ 经工具层（edit_dsl → editDslHandler）置 done ════');
{
  const feat = 'd328';
  saveDSL({
    id: `feature_${feat}`, type: 'feature_diagram', feature: feat, version: '1.0.0', title: feat,
    geometry: {
      layout: 'free', width: 800, height: 600,
      nodes: [{ id: 'file_d', type: 'file', description: 'src/d.ts' }],
      edges: [],
    },
    semantic: { files: [{ id: 'file_d', path: 'src/d.ts', responsibility: 'T328 工具层夹具' }] },
  });
  const progressOf = () => loadOverlay(feat)?.anchors?.['file_d']?.progress;
  const evidenceOf = () => loadOverlay(feat)?.anchors?.['file_d']?.progress_evidence;
  // ★★ 唯一入口：**工具层**（`edit_dsl` 的 handler）。`wrap()` 把抛出的错转成 `{text,isError:true}`（不抛）。
  //   `weight:'routine'` ⇒ 轻量写路径（仍留 L1-L3）；`reason` 里点名节点 id 以过 L3「实体绑定」。
  const callEditDsl = (id, data) =>
    editDslHandler({
      feature: feat,
      weight: 'routine',
      reason: `经 edit_dsl 标记节点 ${id} 的完成状态，因为它的实现已由证据核实（T328 走工具层）`,
      operations: [{ type: 'status', op: 'update', id, data }],
    });

  // D1：不带 evidence 置 done ⇒ 经工具层被拒
  const r1 = await callEditDsl('file_d', { status: 'done' });
  chk(
    r1.isError === true && /拒绝/.test(r1.text) && /三档/.test(r1.text),
    'D1 **经工具层**不带 evidence 置 done ⇒ 被拒（理由说清三档）',
    r1.isError ? r1.text.split('\n').slice(-1)[0] : '★ 没被拒（静默接受了 done）',
  );
  chk(progressOf() === undefined, 'D1b 经工具层被拒后**没有偷偷落盘**（overlay 里该节点无 progress）', `overlay.progress=${JSON.stringify(progressOf())}`);

  // D2：带合法 evidence（attestation）置 done ⇒ 经工具层**成功**，且落盘有 progress
  const r2 = await callEditDsl('file_d', {
    status: 'done',
    evidence: { kind: 'attestation', by: 'human', at: '2026-10-15T00:00:00.000Z', why: '我亲手核过（T328 工具层夹具）' },
  });
  chk(
    r2.isError !== true && progressOf() === 'done' && evidenceOf()?.kind === 'attestation',
    'D2 **经工具层**带合法 evidence 置 done ⇒ 成功，且 progress + evidence 落进 overlay（落盘有 progress）',
    r2.isError ? `★ 被拒：${r2.text.split('\n').slice(-1)[0]}`
      : `progress=${JSON.stringify(progressOf())} · evidence.kind=${JSON.stringify(evidenceOf()?.kind)}`,
  );

  // D3：★ 自证"真的走了工具层"：同一调用里塞未知键 ⇒ 被 `checkOpSpec` 点名「不被认的键」，
  //   且**已知键那一段里出现 `evidence`** —— 若我们绕过了工具层，这一条不可能发生（与 t334 ④ 同一把尺）。
  //   ★★ 2026-10-15 复核（验收者指出的"**假满足**"）：**只看整段回执里有没有 `/evidence/` 不够硬** ——
  //     `checkOpSpec` 的回执有**两段**：**第一段**列"不被认的键"、**第二段**列"已知键"。
  //     `evidence` 若**不被认**，它会落到**第一段**里 ⇒ 整段 `/evidence/` 照样命中，断言为真却什么都没证。
  //     ★ 实测反例（本证复核时亲跑）：把 `TYPE_KNOWN_KEYS.status` 拿掉 `evidence` 后走真实工具层，
  //       回执 = `… 不被认的键：evidence / definitely_bogus_key` + `★ status 的已知键（1 个）：status`
  //       ⇒ 旧断言 `/evidence/` = **true**（假绿）。
  //     ⇒ 现在**只认第二段（已知键）**，并要求**第一段（未知键）不含 `evidence`**（fail-closed：
  //       若回执格式变了、两段分不出来，`unknownSeg` 取到整段 ⇒ 含 evidence ⇒ 断言**判红**而非假绿）。
  const r3 = await callEditDsl('file_d', {
    status: 'done',
    evidence: { kind: 'attestation', by: 'human', at: '2026-10-15T00:00:00.000Z', why: 'x' },
    definitely_bogus_key: 1,
  });
  const unknownSeg3 = r3.text.split('\n').find((l) => /不被认的键/.test(l)) ?? '';
  const knownSeg3 = r3.text.split('\n').find((l) => /已知键/.test(l)) ?? '';
  chk(
    r3.isError === true &&
      /definitely_bogus_key/.test(unknownSeg3) && !/evidence/.test(unknownSeg3) &&
      /evidence/.test(knownSeg3),
    'D3 未知键被 `checkOpSpec` 点名「不被认的键」，且**已知键那一段含 `evidence`**（未知键那段**不含**） ⇒ 自证本证确实在工具层之后',
    r3.isError
      ? `未知键段=${JSON.stringify(unknownSeg3)} · 已知键段=${JSON.stringify(knownSeg3)}`
      : '★ 没被拒（说明根本没走 checkOpSpec）',
  );
}

// ★★ 清理：**全证只此 1 次删除操作**（本仓"宿主删除闸"按删除【操作】数累计，阈值 50，见 t316 头注释）
//   ★★ 而"全量套件（39 张）× 那道闸"的组合会让**最后跑的那张**在删时被拦（t316 2026-10-15 实测 count=56；
//     本证同日实测被拦在 count=50 —— ★ 两次都不是产品缺陷，是"闸 × 套件"的组合）。
//   ⇒ 所以这里 **catch 住**：**拦下 ≠ 本证判红**（判据是 A/B/C 三条业务事实，见头注释），
//     但**必须响亮说出来**（不许静默 —— 否则就是 §2.3「不报错的错」）。
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
