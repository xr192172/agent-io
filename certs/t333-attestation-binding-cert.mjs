#!/usr/bin/env node
/**
 * ★★★ cert T333 —— **`attestation` 两处小加固的出生证**（2026-10-15）。
 *
 * ## 背景（`evidence` 的第三档 `attestation` 是"自证"的入口）
 * 三档证据里，`attestation`（`{ kind:'attestation', by:'human'|'llm', at, why }`）是**最后一档**，
 * 它能表达**判据表达不了**的那部分（"完成"里必有一块永不可判）。★ 但它也是**自证**的入口 ——
 * **执行者能自己给自己签"我完成了"**。本证钉住两条**只堵自证、不打断任何合法流程**的机制：
 *
 *   **① 落盘自动绑定来源节点（调用方零改动）**：写端 `updateStatus` 在落盘前**自动**把
 *      `source_node_id` 填成它正在写的那条锚点键（`ov.anchors[node_id]`），调用方**不多传任何参数**。
 *      理由（与 T118「事实要能追溯到来源」同族）：一条没署名的口供说不清它在给**谁**作证。
 *   **② 与已有 `expectations` 互斥**：同一锚点**已存在** `progress_evidence.kind==='expectations'`
 *      ⇒ 再想用 `attestation` **拒绝**（"有机器可跑的判据就别用口供"）。
 *
 * ## ★★ 本证最重要的一条（防误伤 —— 本次的成败在此）
 * ② **只在"已经存在 expectations"时禁** ⇒ **没有机器判据的节点用 attestation 必须照常成功**
 *   （那是 attestation 的**本职**，见 §5/§6 of `docs/_design/D-anti-cheat.md`）。
 *   这一点由 **②** 单独钉住：造一个**没有** expectations 的节点，正常用 attestation 置 done ⇒ **必须成功**。
 *
 * ## ★ 明确不做（用户明令，见需求 §"第三条明确不做"）
 * **不加配额/限流**（"每 feature 每会话 ≤N 条" / "相邻 ≥30s"）—— 它们会**误伤合法的批量登记**
 *   （例：一次登记 10 个完成），且额度**没有实证依据**。★ 本证**不覆盖**配额（本来就没有）。
 *
 * ## 判据（全部只看**事实**：落盘 JSON 原文 + 抛没抛，不看回执文案的措辞）
 *   ① `attestation` 落盘后，**落盘 JSON 里能看到**自动带的节点 id；且**调用参数与以前完全一样**（零改动）。
 *   ② ★ **误伤检查**：**没有** expectations 的节点，正常用 `attestation` 置 done ⇒ **成功**。
 *   ③ 同一节点先给 `expectations`、再想用 `attestation` ⇒ **被拒**（说清"有机器可跑的判据就别用口供"）；
 *      且被拒后**不许偷偷写**（原 expectations 证据不被覆盖）。
 *   ④ **经工具层**（`edit_dsl` 的 handler）：自动绑来源节点 + 不误伤 + ★ **互斥拒绝也可达**
 *      （④-d 经工具层先给 expectations ⇒ 成功 · ④-e 再经工具层写 attestation ⇒ **被拒** · ④-f 原证据不被覆盖）。
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
 *   node certs/t333-attestation-binding-cert.mjs
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
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL, getFeaturesDir } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { updateStatus } = await import('../dist/src/application/design/dsl_ops/status_tools.js');
// ★★ T334 证书纪律：每张证至少一条判据走**工具层**（`edit_dsl` 的 handler），不许只直调内部函数。
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');

const FEAT = 't333';
const AT = '2026-10-15T00:00:00.000Z';
const overlayFile = () => path.join(getFeaturesDir(), `${FEAT}.overlay.json`);

// ── 夹具：三个文件节点（都没有 decision.expectations）─────────────────────────────
const mkNode = (id) => ({ id, type: 'file', description: `src/${id}.ts` });
saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    nodes: [mkNode('file_bind'), mkNode('file_no_exp'), mkNode('file_has_exp')],
    edges: [],
  },
  semantic: {
    files: [
      { id: 'file_bind', path: 'src/file_bind.ts', responsibility: '① 自动绑定来源节点' },
      { id: 'file_no_exp', path: 'src/file_no_exp.ts', responsibility: '② 误伤检查：无机器判据' },
      { id: 'file_has_exp', path: 'src/file_has_exp.ts', responsibility: '③ 已有机器判据' },
    ],
  },
});

// ════ ① attestation 落盘自动绑定来源节点（★ 调用参数与以前完全一样）════
console.log('════ ① attestation 落盘**自动绑定来源节点**（调用方零改动）════');
{
  // ★ "调用参数与以前完全一样"：这就是 t328 C4 用过的那个形状 —— 只有 { kind, by, at, why }。
  const evidenceArgs = {
    kind: 'attestation',
    by: 'human',
    at: AT,
    why: '我亲手核过（T333 证书夹具）',
  };
  chk(
    !('source_node_id' in evidenceArgs),
    '①-a 调用方传的参数**与以前完全一样**（只有 kind/by/at/why，没有 source_node_id）',
    `调用实参 = ${JSON.stringify(evidenceArgs)}`,
  );

  const err = catchMsg(() =>
    updateStatus({ feature: FEAT, node_id: 'file_bind', status: 'done', evidence: evidenceArgs }),
  );
  chk(err === '', '①-b 同形状调用 ⇒ 通过（写端不要求调用方多传参数）', err === '' ? '通过' : `★ 抛了：${err.split('\n')[0]}`);

  // 落盘 JSON **原文**（直读磁盘，不经 loadOverlay）
  const raw = fs.readFileSync(overlayFile(), 'utf-8');
  const parsed = JSON.parse(raw);
  const anchorRaw = JSON.stringify(parsed.anchors['file_bind'], null, 2);
  console.log('   ── 落盘 JSON 原文（<feature>.overlay.json 的 anchors.file_bind）──');
  for (const line of anchorRaw.split('\n')) console.log(`     ${line}`);

  const ev = parsed.anchors['file_bind']?.progress_evidence;
  chk(
    ev?.kind === 'attestation' && ev?.source_node_id === 'file_bind',
    '①-c 落盘 JSON 里 evidence 自动带了来源节点 id（source_node_id === 节点 id "file_bind"）',
    `progress_evidence = ${JSON.stringify(ev)}`,
  );
  chk(
    parsed.anchors['file_bind']?.progress === 'done',
    '①-d 进度仍落盘（progress === "done"）—— 绑定不影响进度本身',
    `progress = ${JSON.stringify(parsed.anchors['file_bind']?.progress)}`,
  );
  // ★ 调用方传进去的那个对象**不许被就地改**（"调用了同一个对象"与"返回值不同"是两回事）
  chk(
    !('source_node_id' in evidenceArgs),
    '①-e 写端**没有就地改调用方的对象**（复制后填，零副作用）',
    `调用方实参事后 = ${JSON.stringify(evidenceArgs)}`,
  );
  // 权威口径（loadOverlay）里也带同一 id
  chk(
    loadOverlay(FEAT)?.anchors?.['file_bind']?.progress_evidence?.source_node_id === 'file_bind',
    '①-f 权威读（loadOverlay）里同样带来源节点 id（读侧与落盘一致）',
    `loadOverlay().anchors.file_bind.progress_evidence = ${JSON.stringify(loadOverlay(FEAT)?.anchors?.['file_bind']?.progress_evidence)}`,
  );
}

// ════ ② ★★ 误伤检查（最重要）：**没有** expectations 的节点 ⇒ attestation 必须成功 ════
console.log('\n════ ② ★★ 误伤检查：没有机器判据的节点，attestation 必须**成功** ════');
{
  const err = catchMsg(() =>
    updateStatus({
      feature: FEAT,
      node_id: 'file_no_exp',
      status: 'done',
      evidence: { kind: 'attestation', by: 'human', at: AT, why: '这个节点没有机器判据，只能靠口供（本职）' },
    }),
  );
  const a = loadOverlay(FEAT)?.anchors?.['file_no_exp'];
  chk(
    err === '' && a?.progress === 'done' && a?.progress_evidence?.kind === 'attestation',
    '② 没有 expectations 的节点用 attestation 置 done ⇒ **成功**（互斥规则**不误伤**本职场景）',
    err === ''
      ? `progress=${JSON.stringify(a?.progress)} · evidence=${JSON.stringify(a?.progress_evidence)}`
      : `★ 被误伤拒了：${err.split('\n')[0]}`,
  );
}

// ════ ③ 已有 expectations ⇒ 再想用 attestation **被拒** ════
console.log('\n════ ③ 同一节点先给 expectations、再想用 attestation ⇒ **被拒** ════');
{
  // 先给一条**机器判据**（all_green:true / unsupported:0 —— 形状合法，写端接受）
  const ok = catchMsg(() =>
    updateStatus({
      feature: FEAT,
      node_id: 'file_has_exp',
      status: 'done',
      evidence: { kind: 'expectations', all_green: true, unsupported: 0 },
    }),
  );
  const pre = loadOverlay(FEAT)?.anchors?.['file_has_exp']?.progress_evidence;
  chk(
    ok === '' && pre?.kind === 'expectations',
    '③-a 前置：该节点已被机器判据（progress_evidence.kind === "expectations"）',
    ok === '' ? `progress_evidence = ${JSON.stringify(pre)}` : `★ 前置就抛了：${ok.split('\n')[0]}`,
  );

  // 再想用口供盖掉机器判据 ⇒ 拒
  const msg = catchMsg(() =>
    updateStatus({
      feature: FEAT,
      node_id: 'file_has_exp',
      status: 'done',
      evidence: { kind: 'attestation', by: 'llm', at: AT, why: '我自己说做完了' },
    }),
  );
  console.log('   ── 拒绝原文 ──');
  for (const line of String(msg).split('\n')) console.log(`     ${line}`);
  chk(
    msg !== '' && /口供/.test(msg) && /机器/.test(msg),
    '③-b 已有 expectations 时再写 attestation ⇒ **被拒**（说清"有机器可跑的判据就别用口供"）',
    msg === '' ? '★ 没抛（静默接受了口供）' : msg.split('\n')[0],
  );
  const post = loadOverlay(FEAT)?.anchors?.['file_has_exp']?.progress_evidence;
  chk(
    post?.kind === 'expectations',
    '③-c 被拒后**不许偷偷写**：原机器判据仍在（没被口供覆盖）',
    `progress_evidence = ${JSON.stringify(post)}`,
  );
}

// ════ ④ ★ 工具层路径（T334 证书纪律 · 2026-10-15）：经 `edit_dsl` 的 handler 落 attestation ════
//   为什么补这一节：①②③ **全部直调 `updateStatus`** —— 而工具层那条链
//   （`edit_dsl` → `editDslHandler` → `dispatchDslEdit` → `updateFeature` 的 `case 'status'`）
//   **可能少收/少传参数**（T334 实测 `evidence` 曾经传不进去）⇒ 直调全绿**证明不了**工具层可达。
//   ⇒ 本节每条判据**只经工具层**（`editDslHandler`，即 `edit_dsl` 的 handler），**绝不直调**。
console.log('\n════ ④ ★ 经工具层（edit_dsl → editDslHandler）落 attestation ════');
{
  const FEAT2 = 't333m';
  const overlayFile2 = () => path.join(getFeaturesDir(), `${FEAT2}.overlay.json`);
  saveDSL({
    id: `feature_${FEAT2}`, type: 'feature_diagram', feature: FEAT2, version: '1.0.0', title: FEAT2,
    geometry: {
      layout: 'free', width: 800, height: 600,
      nodes: [mkNode('file_t_bind'), mkNode('file_t_noexp'), mkNode('file_t_hasexp')],
      edges: [],
    },
    semantic: {
      files: [
        { id: 'file_t_bind', path: 'src/file_t_bind.ts', responsibility: '④ 工具层自动绑定来源节点' },
        { id: 'file_t_noexp', path: 'src/file_t_noexp.ts', responsibility: '④ 误伤检查：无机器判据' },
        { id: 'file_t_hasexp', path: 'src/file_t_hasexp.ts', responsibility: '④ 互斥拒绝（工具层）：已有机器判据' },
      ],
    },
  });
  // ★★ 唯一入口：**工具层**（`edit_dsl` 的 handler）。`wrap()` 把抛出的错转成 `{text,isError:true}`（不抛）。
  //   `weight:'routine'` ⇒ 轻量写路径（仍留 L1-L3）；`reason` 里点名节点 id 以过 L3「实体绑定」。
  const callEditDsl = (id, data) =>
    editDslHandler({
      feature: FEAT2,
      weight: 'routine',
      reason: `经 edit_dsl 标记节点 ${id} 的完成状态，因为它的实现已由证据核实（T333 走工具层）`,
      operations: [{ type: 'status', op: 'update', id, data }],
    });

  // ④-a/④-b：经工具层落 attestation ⇒ 落盘 JSON **自动带** source_node_id
  const rA = await callEditDsl('file_t_bind', {
    status: 'done',
    evidence: { kind: 'attestation', by: 'human', at: AT, why: '我亲手核过（T333 工具层夹具）' },
  });
  chk(rA.isError !== true, '④-a **经工具层**同形状调用 ⇒ 通过（写端不要求调用方多传参数）', rA.isError ? `★ 被拒：${rA.text.split('\n').slice(-1)[0]}` : '通过');
  // 落盘 JSON **原文**（直读磁盘，不经 loadOverlay）
  const rawA = JSON.parse(fs.readFileSync(overlayFile2(), 'utf-8'));
  const evA = rawA.anchors['file_t_bind']?.progress_evidence;
  console.log('   ── 落盘 JSON 原文（t333m.overlay.json 的 anchors.file_t_bind）──');
  for (const line of JSON.stringify(rawA.anchors['file_t_bind'], null, 2).split('\n')) console.log(`     ${line}`);
  chk(
    evA?.kind === 'attestation' && evA?.source_node_id === 'file_t_bind' && rawA.anchors['file_t_bind']?.progress === 'done',
    '④-b **经工具层**落盘的 JSON 里 evidence **自动带了** source_node_id（=== 节点 id "file_t_bind"）',
    `progress_evidence = ${JSON.stringify(evA)} · progress = ${JSON.stringify(rawA.anchors['file_t_bind']?.progress)}`,
  );

  // ④-c：★★ 误伤检查（经工具层）—— **没有** expectations 的节点，用 attestation 必须**成功**
  const rC = await callEditDsl('file_t_noexp', {
    status: 'done',
    evidence: { kind: 'attestation', by: 'human', at: AT, why: '这个节点没有机器判据，只能靠口供（本职）' },
  });
  const aC = loadOverlay(FEAT2)?.anchors?.['file_t_noexp'];
  chk(
    rC.isError !== true && aC?.progress === 'done' && aC?.progress_evidence?.kind === 'attestation',
    '④-c **经工具层**：没有 expectations 的节点用 attestation 置 done ⇒ **成功**（互斥规则**不误伤**本职场景，工具层路径也照常）',
    rC.isError
      ? `★ 被误伤拒了：${rC.text.split('\n').slice(-1)[0]}`
      : `progress=${JSON.stringify(aC?.progress)} · evidence.kind=${JSON.stringify(aC?.progress_evidence?.kind)} · source_node_id=${JSON.stringify(aC?.progress_evidence?.source_node_id)}`,
  );

  // ★★ ④-d/④-e/④-f：**互斥拒绝在工具层也可达** —— 补 ③-b 的缺口。
  //   ★ 验收者指出：③-b 是**直调 `updateStatus`** ⇒ 只证了互斥**判据存在**，
  //     没证它**经工具层（`edit_dsl` → handler → dispatch → update_feature 'status'）可达**。
  //   ⇒ 先经工具层给一条机器判据（expectations）⇒ **必须成功**；再经工具层写 attestation ⇒ **必须被拒**。
  const rD = await callEditDsl('file_t_hasexp', {
    status: 'done',
    evidence: { kind: 'expectations', all_green: true, unsupported: 0 },
  });
  const dExp = loadOverlay(FEAT2)?.anchors?.['file_t_hasexp']?.progress_evidence;
  chk(
    rD.isError !== true && dExp?.kind === 'expectations',
    '④-d **经工具层**先给机器判据（expectations）⇒ 成功（前置：该锚点已有 progress_evidence.kind==="expectations"）',
    rD.isError ? `★ 被拒：${rD.text.split('\n').slice(-1)[0]}` : `progress_evidence = ${JSON.stringify(dExp)}`,
  );

  const rE = await callEditDsl('file_t_hasexp', {
    status: 'done',
    evidence: { kind: 'attestation', by: 'llm', at: AT, why: '我自己说做完了' },
  });
  console.log('   ── 互斥拒绝原文（**经工具层**）──');
  for (const line of String(rE.text).split('\n')) console.log(`     ${line}`);
  chk(
    rE.isError === true && /口供/.test(rE.text) && /机器/.test(rE.text),
    '④-e ★★ **经工具层**：已有 expectations 时再写 attestation ⇒ **被拒**（互斥判据**在工具层也可达**，补 ③-b 的直调缺口）',
    rE.isError ? rE.text.split('\n').slice(-1)[0] : '★★ 没被拒（工具层静默接受了口供）',
  );

  const dPost = loadOverlay(FEAT2)?.anchors?.['file_t_hasexp']?.progress_evidence;
  chk(
    dPost?.kind === 'expectations',
    '④-f **经工具层**被拒后**不许偷偷写**：原机器判据仍在（没被口供覆盖）',
    `progress_evidence = ${JSON.stringify(dPost)}`,
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
