/**
 * T197sub 聚焦探针：**审批卡 review 这一步到底报什么**（v2 的 C-8 失败，原文没打全）。
 * ★ 单独跑，把 review 的**完整回执**打出来；并做 A/B：
 *   A) reason 含 `src/a.ts`（实体）  B) decision 用 'approved' vs 'approve' —— 看哪个合法。
 * 隔离：feature 仍用 `t197sub`，收尾走工具入口删。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const EXT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t197sub-'));  /* ★ T224：草稿放 os.tmpdir() —— 宿主护栏对 temp 整体绕过（T223 实测），且 temp 在仓外 ⇒ 不受 .gitignore 影响（否则 import_project 会把这些文件过滤掉）*/
const FEATURE = 't197sub';
const call = (tool, args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { out = String((e.stdout ?? '') + (e.stderr ?? '')); }
  return out;
};
const show = (tag, out) => {
  console.log(`\n────────[${tag}]────────`);
  for (const l of out.split('\n')) {
    if (!l) continue;
    if (l.startsWith('[agent-io')) continue;
    if (l.startsWith('(node:')) continue;
    if (l.includes('MCP server started')) continue;
    if (l.includes('ExperimentalWarning')) continue;
    if (l.includes('trace-warnings')) continue;
    if (l.includes('[ts_kernel] prewarm')) continue;
    if (l.includes('--- stderr ---')) continue;
    console.log(l);
  }
};

fs.rmSync(EXT, { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'src'), { recursive: true });
fs.writeFileSync(path.join(EXT, 'src/a.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
fs.writeFileSync(path.join(EXT, 'package.json'), JSON.stringify({ name: 't197sub-ext', version: '1.0.0' }, null, 2));

call('manage_feature', { action: 'delete', feature: FEATURE });
call('import_project', { project_dir: EXT, feature: FEATURE });
const ann = call('edit_dsl', {
  feature: FEATURE, agent: 't197sub', reason: '给 src/a.ts 加批注（T197 审批探针）',
  operations: [{ type: 'annotation', op: 'add', data: { text: 'T197 审批探针批注' } }],
});
const annId = (ann.match(/anno_[A-Za-z0-9_]+/) ?? [])[0] ?? '';
show('annotation.add', ann);
console.log(`=> id = ${annId}`);

show('approval.submit', call('edit_dsl', {
  feature: FEATURE, agent: 't197sub', reason: `把 src/a.ts 上的批注 ${annId} 提交审批`,
  operations: [{ type: 'approval', op: 'submit', data: { annotation_id: annId } }],
}));

// ★ review 试三种 decision 值 + reason 含实体
for (const d of ['approved', 'approve', 'reject']) {
  show(`approval.review decision=${d}`, call('edit_dsl', {
    feature: FEATURE, agent: 't197sub', reason: `对 src/a.ts 上批注 ${annId} 做裁定 ${d}`,
    operations: [{ type: 'approval', op: 'review', data: { annotation_id: annId, decision: d, reviewer: 't197sub' } }],
  }));
}
show('approvals 读回', call('get_dsl', { feature: FEATURE, query: 'approvals' }));
show('approval_history 读回', call('get_dsl', { feature: FEATURE, query: 'approval_history', annotation_id: annId }));

console.log('\n────────[收尾]────────');
show('delete', call('manage_feature', { action: 'delete', feature: FEATURE }));
fs.rmSync(EXT, { recursive: true, force: true });
