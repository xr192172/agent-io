/**
 * impl-fixture —— `cardStanding` 等**判据实现**的行为夹具（实现层变异的先决条件）
 *
 * ## 为什么先写夹具再谈变异
 * 变异要问"改坏实现后谁会红"。没有夹具 ⇒ 改坏了也没人红 ⇒ 变异永远"存活"，
 * 那测的不是"实现有没有被覆盖"，而是"有没有人看"。
 *
 * ## 断言的是**状态名**，不是 reason 文案
 * reason 是给人看的措辞，会改；standing 是判据。★ 夹具只钉 standing。
 *
 * ## 场景（对着 cardStanding 的分支 + 相邻判据写的）
 *   F1 后态全过 ∧ 前态无红   ⇒ satisfied
 *   F2 后态有红（自己）      ⇒ work
 *   F3 后态全过 ∧ 前态红     ⇒ violated
 *   F4 零判据                ⇒ unknowable
 *   F5a 后态红 · 归属 own         ⇒ work
 *   F5b 后态红 · 归属 orphan      ⇒ work
 *   F5c 后态红 · 归属 dep-done    ⇒ blocked
 *   F5d 后态红 · 归属 dep-pending ⇒ blocked
 *   F6 isClaimable 五值穷尽      ⇒ work/violated true；其余 false
 *   F7 applicableTransitions     ⇒ from=done 含 t_reopen；from=void 为空
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const mod = await import(pathToFileURL(path.join(ROOT, 'dist/src/domain/task_machine.js')).href);
const { cardStanding, isClaimable, applicableTransitions } = mod;

const dsl = JSON.parse(fs.readFileSync(path.join(ROOT, '.agent-io/design/task-system-plan.dsl.json'), 'utf8'));
const nodes = dsl.geometry.nodes;
const HANDLERS = 'src/application/design/handlers.ts';

/**
 * ★ 第一版夹具的错（记下来）：拿 DSL 的一条边（`from`/`to` 是**节点 id**）去造 `edge-absent`。
 *   而 `edge-absent` 比的是 `fileFacts(from).deps`（**解析后的文件路径**）⇒ 节点 id 永远不在 deps 里
 *   ⇒ 判据"通过" ⇒ 拿到 satisfied 而不是 violated。
 *   ⇒ 改用 `fileFacts(HANDLERS).deps[0]`（真实依赖路径）。
 */
const { fileFacts } = await import(pathToFileURL(path.join(ROOT, 'dist/src/infrastructure/index/file_facts.js')).href);
const realDep = fileFacts(ROOT, HANDLERS).deps[0];

const card = (exps, id = 'file_src_application_design_handlers_ts') => ({
  id,
  summary: '夹具',
  expectations: exps,
  state: 'candidate',
});

/** F5 的舞台：一个"自己"节点 + 一个 done 节点 + 一个 pending 节点 */
const SELF = 'src/self_probe.ts';
const DEP_DONE = 'src/dep_done_probe.ts';
const DEP_PENDING = 'src/dep_pending_probe.ts';
const stageNodes = [
  { id: 'file_self_probe', path: SELF, task: { state: 'claimed' } },
  { id: 'file_dep_done', path: DEP_DONE, task: { state: 'done' } },
  { id: 'file_dep_pending', path: DEP_PENDING, task: { state: 'claimed' } },
];
const redCard = (targetPath) => card([{ kind: 'file-exists', path: targetPath }], 'file_self_probe');

const CASES = [
  { name: 'F1 后态全过 + 前态无红', card: card([{ kind: 'file-exists', path: HANDLERS }]), expect: 'satisfied' },
  { name: 'F2 后态有红（文件不存在）', card: card([{ kind: 'file-exists', path: 'src/__fixture_missing__.ts' }]), expect: 'work' },
  {
    name: 'F3 后态全过 + 前态红（edge-absent 但边存在）',
    card: card([
      { kind: 'file-exists', path: HANDLERS },
      { kind: 'edge-absent', from: HANDLERS, to: realDep },
    ]),
    expect: 'violated',
  },
  { name: 'F4 零判据（空集）', card: card([]), expect: 'unknowable' },

  // ── F5：红归属的四种（own / orphan 可领；dep-* 等别人）──
  { name: 'F5a 后态红 · own（本节点自己）', card: redCard(SELF), nodes: stageNodes, expect: 'work' },
  { name: 'F5b 后态红 · orphan（不对应任何节点）', card: redCard('src/__nobody_owns_me__.ts'), nodes: stageNodes, expect: 'work' },
  { name: 'F5c 后态红 · dep-done（依赖已 done）', card: redCard(DEP_DONE), nodes: stageNodes, expect: 'blocked' },
  { name: 'F5d 后态红 · dep-pending（依赖未完成）', card: redCard(DEP_PENDING), nodes: stageNodes, expect: 'blocked' },
];

let pass = 0;
const fails = [];
for (const c of CASES) {
  const v = await cardStanding(c.card, { root: ROOT, nodes: c.nodes ?? nodes });
  const ok = v.standing === c.expect;
  if (ok) pass++;
  else fails.push(`${c.name}: 期望 ${c.expect}，实际 ${v.standing}`);
  console.log(`${ok ? '✓' : '✗'} ${c.name} → ${v.standing}${ok ? '' : `  (期望 ${c.expect})`}`);
}

// ── F6：isClaimable 五值穷尽（★ 只允许 work/violated 为真）──
const claimableCases = [
  ['work', true],
  ['violated', true],
  ['satisfied', false],
  ['blocked', false],
  ['unknowable', false],
];
for (const [standing, expect] of claimableCases) {
  const got = isClaimable(standing);
  const ok = got === expect;
  if (ok) pass++;
  else fails.push(`F6 isClaimable(${standing}): 期望 ${expect}，实际 ${got}`);
  console.log(`${ok ? '✓' : '✗'} F6 isClaimable(${standing}) → ${got}`);
}

// ── F7：applicableTransitions 按 from + ready 过滤 ──
const transCases = [
  ['done', ['t_reopen']],
  ['void', []],
  ['candidate', ['t_claim', 't_void', 't_done_from_candidate']],
];
for (const [from, expectIds] of transCases) {
  const got = applicableTransitions(from).map((t) => t.id).sort();
  const ok = JSON.stringify(got) === JSON.stringify([...expectIds].sort());
  if (ok) pass++;
  else fails.push(`F7 applicableTransitions(${from}): 期望 ${expectIds}，实际 ${got}`);
  console.log(`${ok ? '✓' : '✗'} F7 applicableTransitions(${from}) → [${got}]`);
}

const total = CASES.length + claimableCases.length + transCases.length;
console.log(`\n夹具：${pass}/${total} 通过`);
if (fails.length) {
  console.log('失败明细：');
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
