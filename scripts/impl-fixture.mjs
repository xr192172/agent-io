/**
 * impl-fixture.mjs —— `cardStanding` 的**行为夹具**（实现层变异的先决条件）
 *
 * ## 为什么先写夹具再谈变异
 * 变异要问"改坏实现后谁会红"。如果**没有夹具**，改坏了也没人红 ⇒ 变异永远"存活"，
 * 那测的不是"实现有没有被覆盖"，而是"有没有人看"。
 *
 * ## 断言的是**状态名**，不是 reason 文案
 * reason 是给人看的措辞，会改；standing 是判据。★ 夹具只钉 standing。
 *
 * ## 4 个场景（对着 cardStanding 的 4 个分支写的）
 *   F1 后态全过 ∧ 前态无红  ⇒ satisfied
 *   F2 后态有红              ⇒ work（或依赖态，见 ④ 的归属）
 *   F3 后态全过 ∧ 前态红     ⇒ violated（前态判据只有 edge-absent）
 *   F4 零判据               ⇒ unknowable（空集不按全过算，OQ5）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const mod = await import(pathToFileURL(path.join(ROOT, 'dist/src/domain/task_machine.js')).href);
const { cardStanding } = mod;

const dsl = JSON.parse(fs.readFileSync(`${ROOT}/.agent-io/design/task-system-plan.dsl.json`, 'utf8'));
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

const CASES = [
  {
    name: 'F1 后态全过 + 前态无红',
    card: card([{ kind: 'file-exists', path: HANDLERS }]),
    expect: 'satisfied',
  },
  {
    name: 'F2 后态有红（文件不存在）',
    card: card([{ kind: 'file-exists', path: 'src/__fixture_missing__.ts' }]),
    expect: 'work',
  },
  {
    name: 'F3 后态全过 + 前态红（edge-absent 但边存在）',
    card: card([
      { kind: 'file-exists', path: HANDLERS },
      { kind: 'edge-absent', from: HANDLERS, to: realDep },
    ]),
    expect: 'violated',
  },
  {
    name: 'F4 零判据（空集）',
    card: card([]),
    expect: 'unknowable',
  },
];

let pass = 0;
const fails = [];
for (const c of CASES) {
  const v = await cardStanding(c.card, { root: ROOT, nodes });
  const ok = v.standing === c.expect;
  if (ok) pass++;
  else fails.push(`${c.name}: 期望 ${c.expect}，实际 ${v.standing}`);
  console.log(`${ok ? '✓' : '✗'} ${c.name} → ${v.standing}${ok ? '' : `  (期望 ${c.expect})`}`);
}
console.log(`\n夹具：${pass}/${CASES.length} 通过`);
if (fails.length) {
  console.log('失败明细：');
  for (const f of fails) console.log('  ' + f);
  process.exit(1);
}
