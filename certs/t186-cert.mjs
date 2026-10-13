/**
 * T186 出生证：**PR 的确认人是【下一个接手的 Agent】**，不是人（2026-10-12 用户裁定）。
 *
 * 用户原话：
 *   *"PR 现在不应该待在人的代码审批页面，而是应该由**下一个接手的 Agent** 去进行确认。
 *    如果**他一个人确认不了，可以召开会议**进行确认……下一个接手的 AI 发现自己这里
 *    除了原有的设计以外，还有新的 PR，它根据 PR 去做新的决策。"*
 *
 * ## 落地后的判据（每条都可判定）
 *  1. ★ **提议者身份真的落盘**（此前 `submitter` 收下就扔）
 *  2. ★ **MCP 面上能"看见"**：`review_changes action=list` 列出待确认的 PR，含提交人
 *  3. ★★ **不许自批**：确认人 == 提议人 ⇒ **拒**
 *  4. ★ **开会**：别的会话 `action=comment` 留意见 ⇒ `reviews[]` 累积；最后某人拍板
 *  5. ★★ **判不了必须说出来**：历史提案没记 submitter ⇒ 放行但**明标"守卫判不了"**（不许假绿灯）
 *  6. ★ **approve 真的落盘**（goals 进 DSL）；**reject 不落盘**
 *  7. ★ 回执不再说"**人**将在工作台 approve"
 *
 * ★★ 隔离：台账按 `project_dir` 分片（`storeFile` = `workbench/<safeName(project_dir)>.json`）
 *   ⇒ 用**独立的 tenant 目录**当 project_dir ⇒ **完全不碰用户那份台账**。
 *   ★ 但 `dsl_intent` 的 approve 会写**真的 DSL**（`executeDslIntent`）⇒ 那部分用整份还原兜。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDSL } from '../dist/src/infrastructure/storage.js';
import { loadOverlay } from '../dist/src/infrastructure/storage_overlay.js';

const TENANT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t186-'));  /* ★ T224：草稿放 os.tmpdir() —— 宿主护栏对 temp 整体绕过（T223 实测），且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）*/
const FEATURE = 'run82';
const A = 'agent-A';   // 提议人
const B = 'agent-B';   // 下一个接手的 Agent

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) =>
  execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
const isErr = (out) => out.includes('isError=true');
// ★★ 分片名 = `basename(project_dir)` 清洗后（见 `code_workbench.ts` 的 `safeName`）
//   ★ 我第一版拿**整条路径**去清洗 ⇒ 算出的文件名根本不存在 ⇒ `ledger()` 一直返回空数组
//     ⇒ ★ **9 条断言假红**，而产品其实**全对**（真台账里 `submitter`/`reviewed_by`/`reviews` 一应俱全）。
//   ⇒ 又一次"量具错、差点去改产品"。
const storeFile = () => {
  const base = TENANT.split(/[\\/]/).filter(Boolean).pop() || 'root';
  return `.agent-io/workbench/${base.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
};
const ledger = () => (fs.existsSync(storeFile()) ? JSON.parse(fs.readFileSync(storeFile(), 'utf8')) : []);
const tenantReset = () => { for (const f of [storeFile()]) if (fs.existsSync(f)) fs.unlinkSync(f); };
const dslReset = () => execFileSync('node', ['certs/t185-reset.mjs'], { encoding: 'utf8' });

/** 造一条 PR（走**真** propose 路径） */
const propose = (agent) =>
  call('design_intent', {
    action: 'propose', feature: FEATURE,
    ...(agent ? { agent } : {}),
    project_dir: TENANT,
    goals: [{ title: `T186 出生证目标 ${Date.now()}`, status: 'active' }],
  });
const idOf = (out) => (out.match(/"(id)":"(cw_[a-z0-9_]+)"/) ?? [])[2];
const review = (action, agent, extra = {}) =>
  call('review_changes', { action, project_dir: TENANT, ...(agent ? { agent } : {}), ...extra });

console.log('════ ⓪ 起点：隔离台账是空的');
tenantReset(); dslReset();
chk(ledger().length === 0, '隔离台账无任何 PR（起点已知）');
chk(!fs.existsSync('.agent-io/workbench/design-canvas.json') === false, '（用户那份台账仍在，且我们不会碰它）');

console.log('\n════ ① 提议者身份【真的落盘】（此前收下就扔）');
const pOut = propose(A);
const id = idOf(pOut);
chk(!!id, 'propose 成功，拿到 id', id ?? '(没拿到)');
const rec = ledger().find((c) => c.id === id);
chk(rec?.submitter === A, '★ `submitter` 落盘了', `submitter=${JSON.stringify(rec?.submitter)}`);
chk((rec?.reviews ?? []).length === 0, '新 PR 还没有任何评审意见');

console.log('\n════ ② 下一个接手的 Agent 能【看见】它（MCP 面）');
const lOut = review('list', undefined);
chk(!isErr(lOut), 'action=list 可用');
chk(lOut.includes(id), '★ 列表里出现了这条 PR', id);
chk(lOut.includes(A), '★ 且列出**提交人**（接手方要据此判断"是不是我自己提的"）');

console.log('\n════ ③ ★★ 不许自批：提议人自己来确认 ⇒ 必须被拒');
const selfOut = review('approve', A, { id });
chk(isErr(selfOut), '★ 自批被拒');
chk(selfOut.includes('不许自批'), '★ 且理由说清"为什么"（不是笼统拒绝）', (selfOut.split('\n')[1] ?? '').slice(0, 100));
chk((ledger().find((c) => c.id === id)?.status) === 'pending', '★ 状态仍是 pending（拒了就不该改状态）');

console.log('\n════ ④ 开会：别的会话各留意见 ⇒ reviews[] 累积（★ 状态不动）');
const c1 = review('comment', B, { id, note: '我看过，改动方向对，但目标措辞建议再明确' });
chk(!isErr(c1), 'action=comment 可用');
chk((ledger().find((c) => c.id === id)?.reviews ?? []).length === 1, '意见数 = 1');
const c2 = review('comment', 'agent-C', { id, note: '同意 B' });
chk(!isErr(c2), '第三个人也能留意见');
const rv = ledger().find((c) => c.id === id)?.reviews ?? [];
chk(rv.length === 2, '★ 意见数 = 2（会议记录在累积）', rv.map((r) => `${r.verdict}:${r.agent}`).join(' | '));
chk((ledger().find((c) => c.id === id)?.status) === 'pending', '★ 留意见**不改状态**（定不定由 approve/reject 说）');

console.log('\n════ ⑤ 拍板：接手方 approve ⇒ 真的落盘');
const dslBefore = JSON.stringify(loadOverlay(FEATURE)?.global?.goals ?? null);
const aOut = review('approve', B, { id });
chk(!isErr(aOut), 'action=approve 成功', aOut.split('\n')[0]);
const after = ledger().find((c) => c.id === id);
chk(after?.reviewed_by === B, '★ 记下了确认人 `reviewed_by`', String(after?.reviewed_by));
chk(after?.status === 'executed', '★ 状态 → executed', String(after?.status));
chk((after?.reviews ?? []).length === 3, '★ 意见栈 = 3 条（2 条 comment + 1 条 approve）', `len=${after?.reviews?.length}`);
const dslAfter = JSON.stringify(loadOverlay(FEATURE)?.global?.goals ?? null);
chk(dslBefore !== dslAfter && dslAfter.includes('T186 出生证目标'), '★★ goals 真的写进 DSL 了（approve 不是空动作）');

console.log('\n════ ⑥ reject：另一条 PR 被驳回 ⇒ **不落盘**');
dslReset();
const pOut2 = propose(A);
const id2 = idOf(pOut2);
const goalsBeforeReject = JSON.stringify(loadOverlay(FEATURE)?.global?.goals ?? null);
const rOut = review('reject', B, { id: id2, note: '这条先不做' });
chk(!isErr(rOut), 'action=reject 成功');
const rec2 = ledger().find((c) => c.id === id2);
chk(rec2?.status === 'rejected' && rec2?.reviewed_by === B, '★ 状态 rejected 且记下确认人', `${rec2?.status}/${rec2?.reviewed_by}`);
chk(JSON.stringify(loadOverlay(FEATURE)?.global?.goals ?? null) === goalsBeforeReject, '★★ DSL **没有被改动**（reject 不落盘）');

console.log('\n════ ⑦ ★★ 判不了必须说出来（历史提案没记 submitter ⇒ 不许假绿灯）');
tenantReset();
const pOut3 = propose(undefined);           // 不给 agent ⇒ 未署名
const id3 = idOf(pOut3);
chk(ledger().find((c) => c.id === id3)?.submitter === undefined, '（前置）这条 PR 未署名', 'submitter=undefined');
const l3 = review('list', undefined);
chk(l3.includes('未署名'), '★ list 里**明标**"未署名"（不静默）');
const a3 = review('approve', B, { id: id3 });
chk(!isErr(a3), '★ 放行（判不了 ≠ 拒）');
chk(a3.includes('判不了'), '★★ 但回执**明写**"这条守卫判不了"（不是"判过且通过"）', (a3.split('\n').find((l) => l.includes('判不了')) ?? '').trim().slice(0, 110));

console.log('\n════ ⑧ 身份必填');
tenantReset();
const pOut4 = propose(A); const id4 = idOf(pOut4);
const noAgent = review('approve', undefined, { id: id4 });
chk(isErr(noAgent), '★ 不署名 ⇒ 拒');
chk(noAgent.includes('需要 agent'), '★ 且点名缺的是 agent');
const rNoAgent = review('reject', undefined, { id: id4 });
chk(isErr(rNoAgent), '★ reject 同样要署名（判据一处，两条路一致）');

console.log('\n════ ⑨ 回执不再说"人将在工作台 approve"');
chk(!pOut.includes('人将在工作台'), '★ propose 回执里那句**已消失**');
chk(pOut.includes('下一个接手的 Agent'), '★ 改为"等下一个接手的 Agent 确认"');

tenantReset(); dslReset();
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('（已还原：隔离台账已删 · DSL 整份还原）');
