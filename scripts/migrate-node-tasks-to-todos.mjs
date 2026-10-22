#!/usr/bin/env node
/**
 * migrate-node-tasks-to-todos.mjs —— 把 `geometry.nodes[].task` 的卡**逐字**并进 `todos[]`
 * （2026-10-22 · 卡 `todo_决策卡应该记节点-而不是节点记决策卡-node-task-是单数-历史被原地覆盖` 的第 ① 步）。
 *
 * ## 为什么搬、搬成什么样
 * `nodes[].task` 是**单数** ⇒ 一个节点只能一张卡 ⇒ 同一节点的下一张卡把上一张**原地覆盖**（历史没了）。
 * 用户裁定：卡独立住 `todos[]`，用 `node_id` 指向**入口节点**（游戏任务的触发点）。
 * ⇒ 本脚本只做一件事：给每张已有的节点卡在 `todos[]` 里**加一份**（补 `node_id` = 该节点 id），
 *   ★ **`nodes[].task` 一个字节都不动**（这一步是"加一份"，不是"搬走"；读端仍读节点卡）。
 *
 * ## 硬约束（都来自实证，不是风格）
 * · 写 DSL **只走 `edit_dsl`**（`todo op=import`）—— 本脚本**不 import dist、不碰 saveDSL**。
 *   理由：直写就绕过了键闸 / 结构校验 / rev 乐观锁（`scripts/stat-raw-writes.mjs` 在查的就是这个）。
 *   ★ `todo op=import` 是本次一并补进写端的搬家用 op：`add` 只能造 candidate 卡，会把
 *     state / owner / claimed_at / evidence 全部抹平（那是丢历史，不是迁移）。
 * · id **不另造一套**：`id` = 原 `node.task.id`（缺省才用节点 id）；`node_id` = 节点 id。
 * · **幂等**：`(id, node_id)` 已在册 ⇒ 跳过（`todo.import` 自己判，脚本只统计）。
 *
 * ## 用法
 * ```bash
 * node scripts/migrate-node-tasks-to-todos.mjs                 # 默认 dry-run：只出报告，不写
 * node scripts/migrate-node-tasks-to-todos.mjs --dry-run       # 同上
 * node scripts/migrate-node-tasks-to-todos.mjs --apply         # 真写（走 edit_dsl）
 * node scripts/migrate-node-tasks-to-todos.mjs --verify        # 只做逐字比对（不写）
 * node scripts/migrate-node-tasks-to-todos.mjs --apply --verify
 * ```
 *
 * ## 报告（对照判据 A/B/C）
 * · A = 新增条目数 vs `nodes[].task` 条数
 * · B = 每张卡 `(state, owner, claimed_at, evidence 条数, summary 长度)` 与节点卡**逐字相等**，不等逐条列差异
 * · C = 再跑一次 ⇒ 新增 0 · `todos[]` 总数不变（脚本自己会报；也可对比两次 --apply 的读数）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const AGENT = 'subagent:deepseek-card-migrate';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify') || APPLY; // apply 之后默认就比对（不做无证的写）
const featureArg = args.find((a) => a.startsWith('--feature='));
const FEATURE = featureArg ? featureArg.split('=')[1] : 'task-system-plan';
const DSL_PATH = path.join(ROOT, '.agent-io', 'design', `${FEATURE}.dsl.json`);

/** B 判据的比对面（★ 只比这几个 —— 它们是被 `add` 抹平的那几个，也就是"逐字不变"的证） */
const COMPARED = ['state', 'owner', 'claimed_at'];

const readDsl = () => JSON.parse(fs.readFileSync(DSL_PATH, 'utf-8'));

/** 逐字比对：state / owner / claimed_at 全等 + evidence 条数相等 + summary 长度相等 */
function diffCard(nodeTask, todo) {
  const diffs = [];
  for (const k of COMPARED) {
    if ((nodeTask[k] ?? null) !== (todo[k] ?? null)) {
      diffs.push(`${k}: node=${JSON.stringify(nodeTask[k] ?? null)} todo=${JSON.stringify(todo[k] ?? null)}`);
    }
  }
  const ne = Array.isArray(nodeTask.evidence) ? nodeTask.evidence.length : 0;
  const te = Array.isArray(todo.evidence) ? todo.evidence.length : 0;
  if (ne !== te) diffs.push(`evidence 条数: node=${ne} todo=${te}`);
  const ns = typeof nodeTask.summary === 'string' ? nodeTask.summary.length : -1;
  const ts = typeof todo.summary === 'string' ? todo.summary.length : -1;
  if (ns !== ts) diffs.push(`summary 长度: node=${ns} todo=${ts}`);
  return diffs;
}

const dsl0 = readDsl();
const nodesWithTask = (dsl0.geometry?.nodes ?? []).filter((n) => n.task);
const todos0 = dsl0.todos ?? [];
const keyOf = (id, nodeId) => `${id}||${nodeId}`;
const existing = new Set(todos0.map((t) => keyOf(String(t.id), String(t.node_id ?? ''))));

/** ① 生成（★ 只补 id / node_id，其余 `{...task}` 逐字带过去 —— 不挑字段、不重排、不补默认值） */
const cards = [];
const noId = [];
for (const n of nodesWithTask) {
  const t = n.task;
  const id = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : n.id;
  if (!t.id) noId.push(n.id);
  cards.push({ ...t, id, node_id: n.id });
}
const wouldImport = cards.filter((c) => !existing.has(keyOf(c.id, c.node_id)));
const wouldSkip = cards.filter((c) => existing.has(keyOf(c.id, c.node_id)));

const lines = [];
lines.push(`── 迁移报告 · feature=${FEATURE} · ${APPLY ? 'APPLY（走 edit_dsl）' : 'DRY-RUN（不写）'} ──`);
lines.push(`  节点总数            ${(dsl0.geometry?.nodes ?? []).length}`);
lines.push(`  带 task 的节点      ${nodesWithTask.length}`);
lines.push(`  生成卡片            ${cards.length}（id 缺省回落到节点 id 的有 ${noId.length} 张${noId.length ? `：${noId.slice(0, 3).join(' / ')}` : ''}）`);
lines.push(`  已在册（幂等跳过）  ${wouldSkip.length}`);
lines.push(`  待并入              ${wouldImport.length}`);
lines.push(`  todos[] 迁移前      ${todos0.length}`);
lines.push(`  todos[] 迁移后(预期) ${todos0.length + wouldImport.length}`);
const byState = {};
for (const c of cards) byState[c.state] = (byState[c.state] ?? 0) + 1;
lines.push(`  卡片状态分布        ${Object.entries(byState).map(([k, v]) => `${k}=${v}`).join(' · ')}`);

if (wouldImport.length && !APPLY) {
  lines.push('');
  lines.push(`  ★ DRY-RUN：什么都没写。要落盘 ⇒ 加 --apply。`);
}

let opResult = null;
if (APPLY && wouldImport.length) {
  const payload = {
    feature: FEATURE,
    agent: AGENT,
    weight: 'routine',
    reason:
      `卡迁移第①步：把 .agent-io/design/${FEATURE}.dsl.json 里 ${cards.length} 张 nodes[].task 卡逐字并入 todos[]` +
      `（node_id 指向入口节点，nodes[].task 保留不动）—— 写端 op=todo.import，幂等键 (id, node_id)`,
    operations: [{ type: 'todo', op: 'import', data: { cards: wouldImport } }],
  };
  const tmp = path.join(os.tmpdir(), `card-migrate-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
  // ★ 走 CLI 投影（同一个 invokeTool 入口，带 zod + 写闸 + rev）
  const cli = path.join(ROOT, 'dist', 'src', 'presentation', 'cli', 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'edit_dsl', '--input', tmp], { cwd: ROOT, encoding: 'utf-8' });
  fs.rmSync(tmp, { force: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const dataLine = out.split('\n').find((l) => l.startsWith('{"imported"')) ?? '';
  const opLine = out.match(/\[1\/1\] (.*)/)?.[1] ?? out.match(/失败原因: (.*)/)?.[1] ?? '';
  opResult = { status: r.status, dataLine, opLine };
  lines.push('');
  lines.push(`  edit_dsl 退出码     ${r.status}`);
  if (dataLine) lines.push(`  edit_dsl 回执       ${dataLine}`);
  if (opLine) lines.push(`  回执首行            ${opLine.slice(0, 160)}`);
  if (r.status !== 0) {
    lines.push(`  ★ 写入失败（整体回滚，DSL 未变）—— 上面是原样回执尾部：`);
    for (const l of out.split('\n').slice(-8)) lines.push(`    ${l}`);
  }
}

// ── ② B 判据：逐字比对（迁移后从盘上重读，不信内存/回执） ──────────────────
if (VERIFY) {
  const dsl1 = readDsl();
  const todos1 = dsl1.todos ?? [];
  const idx = new Map(todos1.map((t) => [keyOf(String(t.id), String(t.node_id ?? '')), t]));
  let compared = 0;
  let missing = 0;
  const mismatches = [];
  for (const n of (dsl1.geometry?.nodes ?? []).filter((x) => x.task)) {
    const t = n.task;
    const id = typeof t.id === 'string' && t.id.trim() ? t.id.trim() : n.id;
    const todo = idx.get(keyOf(id, n.id));
    if (!todo) {
      missing++;
      continue;
    }
    compared++;
    const d = diffCard(t, todo);
    if (d.length) mismatches.push(`${id}: ${d.join(' | ')}`);
  }
  lines.push('');
  lines.push(`  ── B 判据（逐字比对：${COMPARED.join(' / ')} + evidence 条数 + summary 长度）──`);
  lines.push(`  比对了              ${compared} 张（节点卡 ↔ todos[] 同 (id,node_id) 条目）`);
  lines.push(`  找不到对应条目       ${missing}`);
  lines.push(`  不一致              ${mismatches.length}`);
  for (const m of mismatches.slice(0, 20)) lines.push(`    ✗ ${m}`);
  if (mismatches.length > 20) lines.push(`    …还有 ${mismatches.length - 20} 条（已截断）`);
  lines.push(`  todos[] 迁移后实测   ${todos1.length}`);
}

console.log(lines.join('\n'));
