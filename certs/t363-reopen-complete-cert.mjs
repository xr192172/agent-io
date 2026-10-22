#!/usr/bin/env node
/**
 * cert T363 —— **重开后的收口死锁已拆**（2026-10-22 · 卡 `reopen-evidence-deadlock`）
 *
 * ## 这张证存在的理由（两条闸各自都对，合起来把人钉死）
 * 正常流程 `done → claim(intent:'modify')`（内部 = `t_reopen`，落 `reopened_at`）→ 改完 → `complete`：
 *   · 用 `expectations` ⇒ `task_ops#reopenGate` 拒：「重开未结清时 expectations 没有时间戳，就是旧判据再跑一遍」（白洞，拒得对）；
 *   · 用 `attestation`  ⇒ `status_tools#updateStatus` 拒：「已有机器判据的锚点不许用口供覆盖」（防"点一下 done"，也拒得对）；
 *   ⇒ 只有 `reading` 能同时过两闸，而两处报错的"二选一"**都没提这条路** ⇒ 这一类卡被两条闸夹死。
 *
 * ## 修法（不是拆闸，是把两句不同的问话分开）
 * `status_tools` 新增 `evidenceClearedBy:'task-complete'`，只有 `completeTask` 在**过完 `reopenGate` 之后**才传。
 * 那一刻"机器判据刚跑过且全过"，口供不是替代判据，而是**给这次收口署名**。
 * ★ 锚点上原有的 `expectations` 证据**保留**（它比口供强）—— 口供只进 `task.evidence`。
 *
 * ## 判据（★ 三条正的 + 四条"必须仍被拒"的）
 *   ① 锚点上的机器判据是真的（先走一遍自然流程：publish → claim → complete(expectations)）
 *   ② `claim(modify)` 把 done 卡重开（`reopened_at` 有值）
 *   ③ ★ `complete(attestation at=now)` ⇒ **能收口**（改之前这里必抛）；且
 *      · `task.evidence` 末尾是 attestation（署名进账）· **锚点仍是 expectations**（不被覆盖）· 回执明说"被保留"
 *   ④ ★ **零动作仍被拒**：再重开 → `complete(expectations)` ⇒ 抛（reopenGate 一个字没松）
 *   ⑤ ★ **旧时间戳仍被拒**：同样重开状态 → `complete(attestation at = reopened_at − 1h)` ⇒ 抛
 *   ⑥ ★★ **公开入口没松**：`updateStatus`（`edit_dsl {type:'status'}` 的唯一写端）用 attestation 盖机器判据 ⇒ 仍抛
 *   ⑦ ★★ **标记传不进公开入口**：① 带 `evidenceClearedBy` 发 ⇒ 被"不被认的键"拒（`TYPE_KNOWN_KEYS.status` 只有 status/evidence）；
 *      ② 只带合法键发 ⇒ 仍被"已有机器判据"拒（路由**不替**调用方补那个标记）
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不碰真册**：设计册整片 copy 到临时 `AGENT_IO_HOME`，夹具节点只加在**副本**里（与 t360 同款）；
 *   · **夹具判据用 `file-exists`**（一条必过的后态判据）—— 本证验的是**闸之间的夹缝**，不是判据强度；
 *   · **没验 todo 卡**：todo 不走 `updateStatus`（Q5 跳过），与本死锁无关。
 *
 * ## 用法
 *   node certs/t363-reopen-complete-cert.mjs      # 只写 `certs/.work/tmp363-*`
 *
 * touches: src/application/design/dsl_ops/status_tools.ts, src/application/design/dsl_ops/task_ops.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work', 'tmp363-'));
const HOME = path.join(TMP, 'home');
fs.cpSync(path.join(REPO, '.agent-io/design'), path.join(HOME, '.agent-io/design'), { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前设好

const base = pathToFileURL(path.join(REPO, 'dist/src')).href;
const { applyTaskOp } = await import(`${base}/application/design/dsl_ops/task_ops.js`);
const { updateStatus } = await import(`${base}/application/design/dsl_ops/status_tools.js`);
const { updateFeature } = await import(`${base}/application/design/dsl_ops/update_feature.js`);
const { getDesignSheetFile } = await import(`${base}/infrastructure/storage.js`);
const { loadOverlay } = await import(`${base}/infrastructure/storage_overlay.js`);

const FEATURE = 'task-system-plan';
const NODE = 'file_t363_fixture';
const ME = 'subagent:deepseek-fix5';
const SHEET = getDesignSheetFile(FEATURE);

// ── 夹具节点：一条一定过的后态判据（判据打在真仓里存在的文件上）
{
  const d = JSON.parse(fs.readFileSync(SHEET, 'utf8'));
  d.geometry.nodes.push({
    id: NODE,
    type: 'file',
    path: 'src/application/write_gate.ts',
    label: 'T363 夹具节点',
    decision: {
      summary: 'T363 夹具：一条必过的后态判据（file-exists），用来验"重开后的收口"这条闸缝',
      expectations: [{ kind: 'file-exists', path: 'src/application/write_gate.ts', why: '夹具判据：这个文件一定在' }],
    },
  });
  fs.writeFileSync(SHEET, JSON.stringify(d, null, 2));
}

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const cardOf = () => (JSON.parse(fs.readFileSync(SHEET, 'utf8')).geometry.nodes.find((n) => n.id === NODE) ?? {}).task;
const anchorEv = () => loadOverlay(FEATURE)?.anchors?.[NODE]?.progress_evidence;
const firstLine = (e) => String(e?.message ?? e).split('\n')[0].slice(0, 150);
async function op(o, data) {
  try {
    return { ok: true, r: await applyTaskOp(FEATURE, { op: o, id: NODE, data }, ME) };
  } catch (e) {
    return { ok: false, err: e };
  }
}
const claimModify = (why) => op('claim', { owner: ME, intent: 'modify', reason: why });
const complete = (evidence) => op('complete', { evidence });

console.log(`══ T363 · 重开后的收口死锁（fixture=${NODE}，home=${HOME}）══`);

// ── ① 自然流程把"机器判据"做出来：publish → claim → complete(expectations)
{
  const pub = await op('publish', undefined);
  const c1 = await claimModify('T363 夹具：先正常收口一次，让锚点上真的有一条 expectations 证据');
  const done1 = await complete({ kind: 'expectations', all_green: true, unsupported: 0 });
  chk(pub.ok && c1.ok && done1.ok, '① 夹具走完 publish → claim(modify) → complete(expectations)（判据全过）', firstLine(done1.err ?? c1.err ?? pub.err));
  chk(cardOf()?.state === 'done', '①\' 卡 state=done', `state=${cardOf()?.state}`);
  chk(anchorEv()?.kind === 'expectations', '①\'\' ★ **锚点** progress_evidence.kind = expectations（死锁的前置条件成立）', `anchor.kind=${anchorEv()?.kind}`);
}

// ── ② 重开
{
  const r = await claimModify('T363：重开一次，验证"重开后的收口"');
  const card = cardOf();
  chk(r.ok && Boolean(card?.reopened_at) && card.state === 'claimed', '② claim(modify) 把 done 卡重开（reopened_at 有值、state=claimed）', `state=${card?.state} reopened_at=${card?.reopened_at}`);
}

// ── ③ ★ 核心：attestation 能收口，且机器判据不被覆盖
{
  const at = new Date().toISOString();
  const r = await complete({ kind: 'attestation', by: 'llm', at, why: 'T363：重开后只改了注释，判据未变；这次收口由 attestation 署名' });
  chk(r.ok, '③ ★★ **complete(attestation at=now) 能收口**（改之前：status_tools 抛"已有机器判据不许用口供覆盖"）', firstLine(r.err));
  const card = cardOf();
  const last = (card?.evidence ?? []).at(-1);
  chk(card?.state === 'done' && last?.kind === 'attestation', "③' 卡的 evidence **追加了一条 attestation**（署名进账）", `state=${card?.state} last=${JSON.stringify({ kind: last?.kind, agent: last?.agent })}`);
  chk(anchorEv()?.kind === 'expectations', "③'' ★ **锚点仍是 expectations**（机器判据比口供强 ⇒ 不被覆盖）", `anchor.kind=${anchorEv()?.kind}`);
  chk(String(r.r?.message ?? '').includes('被保留'), "③''' 回执**明说**机器判据被保留（不静默）", firstLine(r.r?.message));
}

// ── ④ 零动作仍必须被拒（reopenGate 一个字没松）
{
  const re = await claimModify('T363：再重开，测"零动作不许收口"');
  const r = await complete({ kind: 'expectations', all_green: true, unsupported: 0 });
  chk(re.ok && !r.ok && /重开于/.test(String(r.err?.message)), '④ ★ **零动作仍被拒**：重开后拿 expectations 收口 ⇒ 抛（reopenGate 未松）', firstLine(r.err));
}

// ── ⑤ 旧时间戳仍必须被拒
{
  const reopenedAt = cardOf()?.reopened_at;
  const early = new Date(Date.parse(reopenedAt) - 3600_000).toISOString();
  const r = await complete({ kind: 'attestation', by: 'llm', at: early, why: 'T363：故意给一条早于重开时刻的证据' });
  chk(!r.ok && /重开于/.test(String(r.err?.message)), '⑤ ★ **旧时间戳仍被拒**：attestation.at < reopened_at ⇒ 抛', `at=${early} reopened_at=${reopenedAt} | ${firstLine(r.err)}`);
}

// ── ⑥ 公开入口没松：updateStatus（edit_dsl type=status 的写端）仍拒
{
  const before = anchorEv()?.kind;
  let threw = null;
  try {
    updateStatus({ feature: FEATURE, node_id: NODE, status: 'done', evidence: { kind: 'attestation', by: 'human', at: new Date().toISOString(), why: 'T363：手工点 done' } });
  } catch (e) {
    threw = e;
  }
  chk(Boolean(threw) && /已有机器判据/.test(String(threw?.message)), '⑥ ★★ **公开入口没松**：`updateStatus` 用 attestation 盖机器判据 ⇒ **仍抛**', firstLine(threw));
  chk(before === 'expectations' && anchorEv()?.kind === 'expectations', "⑥' 抛了之后锚点没被写坏（还是 expectations）", `before=${before} after=${anchorEv()?.kind}`);
}

// ── ⑦ 标记传不进公开入口（两条：不认的键 / 不替调用方补）
{
  const ev = { kind: 'attestation', by: 'human', at: new Date().toISOString(), why: 'T363：试图从 edit_dsl 夹带标记' };
  const a = await updateFeature({
    feature: FEATURE,
    reason: `T363：验证 edit_dsl 的 status 路由传不进 evidenceClearedBy（${NODE}）`,
    operations: [{ type: 'status', op: 'update', id: NODE, data: { status: 'done', evidence: ev, evidenceClearedBy: 'task-complete' } }],
  }).then(() => ({ ok: true })).catch((e) => ({ ok: false, err: e }));
  chk(!a.ok && /不被认的键|不认识|未知/.test(String(a.err?.message)), '⑦ ★ `edit_dsl {type:status}` 夹带 `evidenceClearedBy` ⇒ 被"**不被认的键**"拒（键集只有 status / evidence）', firstLine(a.err));

  const b = await updateFeature({
    feature: FEATURE,
    reason: `T363：只带合法键，验证路由不替调用方补标记（${NODE}）`,
    operations: [{ type: 'status', op: 'update', id: NODE, data: { status: 'done', evidence: ev } }],
  }).then(() => ({ ok: true })).catch((e) => ({ ok: false, err: e }));
  chk(!b.ok && /已有机器判据/.test(String(b.err?.message)), '⑦\' 只带**合法键** ⇒ 走到 `updateStatus` 且**仍被"已有机器判据"拒**（路由不替调用方补那个标记）', firstLine(b.err));
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
