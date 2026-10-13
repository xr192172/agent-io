/**
 * T198sub 出生证：**`approval.review` 的 `data.decision` 值域** 从"只住在实现里"收进 MCP 描述。
 *
 * ## 缺口（已确认）
 * `approval.review` 的 `data.decision` **只认【动作词】**（`approve` / `reject` / `request_revision`），
 * 而**值域此前不在任何 MCP 描述里** ⇒ 读者（LLM）只能**试错**：
 *   实测填 `approved` ⇒ `失败原因: 未知决策: approved`。
 *
 * ## 判据（三个方向都自证）
 * ① **真跑**：annotation.add → approval.submit → approval.review(`decision:"approve"`) ⇒ **通**；
 * ② ★ `decision:"approved"`（状态词）⇒ **拒**，且**点名合法值**（旧行为只说"未知决策: approved"，不指路）；
 * ③ ★ **描述里真能看到值域**：打印 `edit_dsl` 的 description ⇒ 断言**出现** `approve` 与 `reject`；
 * ④ **值域唯一住处**：`approval.ts` 的 `APPROVAL_DECISIONS`（描述是它的渲染 ⇒ 改了实现描述自动跟）。
 *
 * ★ 隔离：临时 feature `t198sub`，夹具 `certs/.work/t198sub-ext/`；
 *   ★ 收尾走**工具入口** `manage_feature action=delete`（**不 rm 数据目录**），并断言已清。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t198sub-'));  /* ★ T224：草稿放 os.tmpdir() —— 宿主护栏对 temp 整体绕过（T223 实测），且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）*/
const FEATURE = 't198sub';
let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { out = String((e.stdout ?? '') + (e.stderr ?? '')); }
  const isErr = out.includes('[isError=true]') || /MCP error|失败原因/.test(out);
  return { isErr, text: out };
};
const clean = (s) => s.split('\n').filter((l) =>
  l && !l.startsWith('[agent-io') && !l.startsWith('(node:') &&
  !l.includes('MCP server started') && !l.includes('ExperimentalWarning') &&
  !l.includes('trace-warnings') && !l.includes('[ts_kernel] prewarm') &&
  !l.includes('--- stderr ---')).join('\n');
const head = (s) => clean(s).split('\n')[0].slice(0, 160);

// ── 夹具（可 rm：它是我自己造的）──────────────────────────────
fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'src'), { recursive: true });
fs.writeFileSync(path.join(EXT, 'src/a.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
fs.writeFileSync(path.join(EXT, 'package.json'), JSON.stringify({ name: 't198sub-ext', version: '1.0.0' }, null, 2));

call('manage_feature', { action: 'delete', feature: FEATURE });
call('import_project', { project_dir: EXT, feature: FEATURE });

console.log('══ ① annotation.add → approval.submit（前置）');
const ann = call('edit_dsl', {
  feature: FEATURE, agent: 't198sub', reason: '给 src/a.ts 加批注（T198 审批值域探针）',
  operations: [{ type: 'annotation', op: 'add', data: { text: 'T198 审批值域探针批注 A' } }],
});
const annId = (ann.text.match(/anno_[A-Za-z0-9_]+/) ?? [])[0] ?? '';
chk(!ann.isErr && !!annId, '①-a annotation.add ⇒ 通（拿到 id）', `id=${annId}`);
const sub = call('edit_dsl', {
  feature: FEATURE, agent: 't198sub', reason: `把 src/a.ts 上的批注 ${annId} 提交审批`,
  operations: [{ type: 'approval', op: 'submit', data: { annotation_id: annId } }],
});
chk(!sub.isErr && /已提交审批/.test(sub.text), '①-b approval.submit ⇒ 通（回执「已提交审批」）', head(sub.text));
// ★ submit 的回执首行是「已提交审批：<id>」——**状态在读回里**（不塞进首行，见 update_feature 的"首行自足"口径）
chk(/pending_review/.test(call('get_dsl', { feature: FEATURE, query: 'approvals' }).text),
  '①-c 读回 ⇒ 状态 pending_review', '');

console.log('\n══ ② ★ decision="approved"（状态词）⇒ 拒，且点名合法值');
const bad = call('edit_dsl', {
  feature: FEATURE, agent: 't198sub', reason: `对 src/a.ts 上批注 ${annId} 做裁定（试状态词）`,
  operations: [{ type: 'approval', op: 'review', data: { annotation_id: annId, decision: 'approved', reviewer: 't198sub' } }],
});
chk(bad.isErr, '②-a `decision:"approved"` ⇒ **拒**', head(bad.text));
chk(/未知决策/.test(bad.text) && bad.text.includes('approved'), '②-b 报错**点名**了那个非法值', head(bad.text));
chk(bad.text.includes('approve') && bad.text.includes('reject') && bad.text.includes('request_revision'),
  '②-c ★ 报错**列出了合法值**（approve / reject / request_revision）', head(bad.text));

console.log('\n══ ③ ★ decision="approve"（动作词）⇒ 通');
const good = call('edit_dsl', {
  feature: FEATURE, agent: 't198sub', reason: `对 src/a.ts 上批注 ${annId} 做裁定（动作词）`,
  operations: [{ type: 'approval', op: 'review', data: { annotation_id: annId, decision: 'approve', reviewer: 't198sub' } }],
});
chk(!good.isErr && /已通过/.test(good.text), '③-a `decision:"approve"` ⇒ **通**（回执「已通过」）', head(good.text));
const back = call('get_dsl', { feature: FEATURE, query: 'approvals' });
chk(/approved/.test(back.text), '③-b 读回 ⇒ 落地状态 approved', head(back.text));

console.log('\n══ ④ 值域第三个值 request_revision 也真在（用第二条批注）');
const ann2 = call('edit_dsl', {
  feature: FEATURE, agent: 't198sub', reason: '给 src/a.ts 加第二条批注（T198 值域第三值）',
  operations: [{ type: 'annotation', op: 'add', data: { text: 'T198 审批值域探针批注 B' } }],
});
const annId2 = (ann2.text.match(/anno_[A-Za-z0-9_]+/) ?? [])[0] ?? '';
call('edit_dsl', {
  feature: FEATURE, agent: 't198sub', reason: `把 src/a.ts 上的批注 ${annId2} 提交审批`,
  operations: [{ type: 'approval', op: 'submit', data: { annotation_id: annId2 } }],
});
const rev = call('edit_dsl', {
  feature: FEATURE, agent: 't198sub', reason: `对 src/a.ts 上批注 ${annId2} 要求修改`,
  operations: [{ type: 'approval', op: 'review', data: { annotation_id: annId2, decision: 'request_revision', reviewer: 't198sub' } }],
});
chk(!rev.isErr && /要求修改/.test(rev.text), '④ `decision:"request_revision"` ⇒ 通（证明值域确有第三个）', head(rev.text));

console.log('\n══ ⑤ ★★ 描述里真能看到值域（打印 edit_dsl 描述）');
let desc = '';
try {
  desc = execFileSync('node', ['scripts/mcp/mcp_call.mjs', '--describe', 'edit_dsl'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { desc = String((e.stdout ?? '') + (e.stderr ?? '')); }
const approvalLine = desc.split('\n').filter((l) => /approval/.test(l)).join('\n');
console.log('  ── 描述里含 "approval" 的行（原样）──');
console.log(approvalLine.split('\n').map((l) => '    ' + l).join('\n'));
chk(/· approval:/.test(desc), '⑤-a 描述里有 `· approval:` 契约行');
chk(desc.includes('approve') && desc.includes('reject'), '⑤-b ★★ 描述里**出现了** `approve` 与 `reject`');
chk(desc.includes('request_revision') && desc.includes('动作词'), '⑤-c ★ 描述说明了值域含 `request_revision` 且点明是【动作词】');
chk(desc.includes('APPROVAL_DECISIONS'), '⑤-d ★ 描述点名了值域唯一住处 `APPROVAL_DECISIONS`');

console.log('\n══ ⑥ 收尾：用工具入口清掉（★ 不 rm 数据目录）');
const del = call('manage_feature', { action: 'delete', feature: FEATURE });
chk(!del.isErr, '⑥-a manage_feature action=delete ⇒ 通', head(del.text));
const listAfter = call('manage_feature', { action: 'list' });
chk(!listAfter.text.includes(FEATURE + '"') && !new RegExp(`${FEATURE}\\b`).test(clean(listAfter.text)),
  '⑥-b ★ 临时 feature 已清干净', head(listAfter.text));
fs.rmSync(EXT, { recursive: true, force: true });

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
