#!/usr/bin/env node
/**
 * cert T364 —— **`setNodeSemantic` 不再是哑写**（2026-10-22 · 卡 `api_setNodeSemantic-dumbwrite`）
 *
 * ## 这张证存在的理由（实测）
 * `api_ops.ts#setNodeSemantic`（`edit_dsl {type:'binding'}` 的唯一实现）在 T328 之后**什么都不改**，
 * 却仍然 `saveDSL(dsl)` 并回执「已绑定节点 X 与文件 Y」：
 *   · 调用方以为它在写 ⇒ 一个"看起来成功、其实没写"的假动作；
 *   · 而且**白写一遍盘**：`saveDSL` 会刷新 `_sync` 元数据 ⇒ 字节变了、语义没变（"改了但没改"）。
 * ★ 根因是**结构**：`SemanticFile.id` 的定义就是「与 `geometry.nodes.id` 对应」⇒ 绑定 = 两者共用同一个 id，
 *   没有第三个字段可写。所以正确形状只有两种：**无话可说就别写盘** / **不同 id 就当场拒**。
 *
 * ## 判据（★ 关键手段：**文件字节哈希**——`saveDSL` 会刷新 `_sync` 时间戳 ⇒ 只要写盘，哈希必变）
 *   ① 同 id 调用 `setNodeSemantic` ⇒ 回执说"无字段可改 / 没有写盘"，且**册子字节一个都没变**
 *   ② 同 id 走**真实公开入口** `updateFeature({type:'binding'})`（= `edit_dsl type=binding`）⇒ 同样**不写盘**
 *   ③ 不同 id ⇒ **抛**（"拒绝绑定"），且**不写盘**（旧实现会静默写一遍然后回"已绑定"）
 *   ④ ★ **正对照**：同一份夹具上 `file op=update` 改一个字段 ⇒ 字节**必须改变**
 *      （否则"哈希不变"是恒真的假判据 —— 本仓最忌的那种）
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不碰真册**：设计册整片 copy 到临时 `AGENT_IO_HOME`；
 *   · **没验 `sync_status`**：T328 起它只是回执里的读数开关，与"写不写"无关；
 *   · **没删这个 op**：它仍是一条合法的"查询式绑定"（回执说明现状）——要不要退役是另一张卡的判断。
 *
 * ## 用法
 *   node certs/t364-set-node-semantic-cert.mjs      # 只写 `certs/.work/tmp364-*`
 *
 * touches: src/application/design/dsl_ops/api_ops.ts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work', 'tmp364-'));
const HOME = path.join(TMP, 'home');
fs.cpSync(path.join(REPO, '.agent-io/design'), path.join(HOME, '.agent-io/design'), { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前设好

const base = pathToFileURL(path.join(REPO, 'dist/src')).href;
const { setNodeSemantic } = await import(`${base}/application/design/dsl_ops/api_ops.js`);
const { updateFeature } = await import(`${base}/application/design/dsl_ops/update_feature.js`);
const { getDesignSheetFile } = await import(`${base}/infrastructure/storage.js`);

const FEATURE = 'task-system-plan';
const NODE = 'file_src_application_design_dsl_ops_api_ops_ts'; // 真实节点（同 id 的语义文件也在）
const OTHER = 'file_src_application_write_gate_ts';
const SHEET = getDesignSheetFile(FEATURE);

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
/** ★ 写盘的判据：`saveDSL` 每次都会刷新 `_sync`（含时间戳）⇒ 只要落盘，哈希必变 */
const hash = () => crypto.createHash('sha1').update(fs.readFileSync(SHEET)).digest('hex').slice(0, 12);
const firstLine = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 150);

console.log(`══ T364 · setNodeSemantic 不再是哑写（fixture=${NODE}，home=${HOME}）══`);

// ── ① 同 id：回执说实话 + 不写盘
{
  const h0 = hash();
  const r = setNodeSemantic({ feature: FEATURE, node_id: NODE, file_id: NODE });
  const h1 = hash();
  chk(/无字段可改|没有写盘/.test(r.message), '① 同 id 调用 ⇒ 回执说"**无字段可改 / 没有写盘**"（不再说"已绑定"）', firstLine(r.message));
  chk(h0 === h1, '①\' ★ 册子**字节一个都没变**（旧实现每次 `saveDSL` ⇒ `_sync` 时间戳会前进）', `hash ${h0} → ${h1}`);
}

// ── ② 真实公开入口（edit_dsl type=binding 的实现）也不写盘
{
  const h0 = hash();
  let ok = true;
  let msg = '';
  try {
    const r = await updateFeature({ feature: FEATURE, reason: `T364：binding op 同 id（${NODE}）`, operations: [{ type: 'binding', op: 'update', id: NODE, data: { file_id: NODE } }] });
    msg = String(r.message ?? '');
  } catch (e) {
    ok = false;
    msg = firstLine(e);
  }
  const h1 = hash();
  chk(ok, '② 走 `updateFeature({type:binding})`（= `edit_dsl` 的 binding 路由）⇒ **不抛**（同 id 是合法调用）', msg);
  chk(h0 === h1, '②\' ★ 走公开入口也**一个字节没写**（唯一的写盘处已被摘掉）', `hash ${h0} → ${h1}`);
}

// ── ③ 不同 id：当场拒 + 不写盘
{
  const h0 = hash();
  let threw = null;
  try {
    setNodeSemantic({ feature: FEATURE, node_id: NODE, file_id: OTHER });
  } catch (e) {
    threw = e;
  }
  const h1 = hash();
  chk(Boolean(threw) && /拒绝绑定/.test(String(threw?.message)), '③ ★ 不同 id ⇒ **当场拒**（旧实现静默写一遍再回"已绑定"）', firstLine(threw));
  chk(h0 === h1, '③\' 被拒时也**不写盘**（拒之前不落任何字节）', `hash ${h0} → ${h1}`);
}

// ── ④ 正对照：真写一次必须**改变**字节（否则"哈希不变"是恒真判据）
{
  const h0 = hash();
  let msg = '';
  try {
    const r = await updateFeature({
      feature: FEATURE,
      reason: `T364 正对照：改 ${NODE} 的 responsibility 一个字段`,
      operations: [{ type: 'file', op: 'update', id: NODE, data: { responsibility: 'T364 正对照：这条 responsibility 是新写的' } }],
    });
    msg = String(r.message ?? '');
  } catch (e) {
    msg = firstLine(e);
  }
  const h1 = hash();
  chk(h0 !== h1, '④ ★ **正对照**：`file op=update` 改一个字段 ⇒ 字节**必须改变**（证明前面三条的"哈希不变"不是恒真）', `hash ${h0} → ${h1} | ${msg.split('\n')[0]}`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
