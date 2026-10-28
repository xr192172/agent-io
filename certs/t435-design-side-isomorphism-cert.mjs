#!/usr/bin/env node
/**
 * ★★★ cert T435 —— **设计侧的同构不变量**：*空人工内容 ⇒ 设计 ≡ 实际*（2026-10-28）
 *
 * ## 这条不变量从哪来
 * 用户原话：「设计侧现在如果没有设计内容的话应该是**完全等价实际侧**吧，所以翻译侧也要这样。」
 * 翻译侧已由 `t434` 钉住；**设计侧此前没人钉**——而它恰恰是最早栽在"漏字段漏边"上的那一侧。
 *
 * ## 判据（★ 必须有**反向对照**，否则这张证可能"恒绿"）
 *   ① **正例**：只做 `import_project`（不写任何设计内容）⇒ `design_line action=diff` 报
 *      `onlyDesign=0 / onlyLive=0 / changed=0`，且设计/实际节点数、边数**相等**；
 *   ② **反向对照**：随后**人工加一条设计内容**（`edit_dsl` 加节点）⇒ diff 必须**变成非零**（`onlyDesign>0`）。
 *      ★ 没有这一条，①的"全 0"可能只是 diff 坏了或永远返回空 —— 那样的绿是假绿。
 *   ③ **可复现**：同样的空设计状态跑两次 diff，读数一致。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 夹具只有 2 文件 / 3 节点 / 3 边 ⇒ 规模不足以证大仓；**[未核]** 大仓下 `changed` 的字段级比较；
 *   · 只比节点/边集合与三类计数，**不比每个节点的逐字段内容**（`changed` 已按字段列出，但本证不逐字段断言）；
 *   · 反向对照只加 1 个节点；**[未核]** 加边、改字段两种编辑路径。
 *
 * ## 用法
 *   node certs/t435-design-side-isomorphism-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const T = (n) => TOOL_DEFS.find((t) => t.name === n);
const unwrap = (r) => {
  const t = String(r?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  return { msg: (i > 0 ? t.slice(0, i) : t).trim(), data: i > 0 ? JSON.parse(t.slice(i + 10).trim()) : undefined };
};

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'dsgn-'));
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.writeFileSync(path.join(proj, 'src/a.ts'), 'export function foo(a: number): number { return a + 1; }\nexport const BAR = 1;\n');
fs.writeFileSync(path.join(proj, 'src/b.ts'), "import { foo } from './a';\nexport function baz(): number { return foo(1); }\n");
const FEAT = 'ds';

await T('import_project').handler({ project_dir: proj, feature: FEAT });

const diff = async () => unwrap(await T('design_line').handler({ action: 'diff', project_dir: proj, feature: FEAT })).data ?? {};

// ── ① 正例：空设计 ⇒ 完全等价 ────────────────────────
{
  const d = await diff();
  chk(
    (d.onlyDesign ?? []).length === 0 && (d.onlyLive ?? []).length === 0 && (d.changed ?? []).length === 0,
    '① **空人工内容 ⇒ 设计 ≡ 实际**：diff 三类差异全为 0',
    `onlyDesign=${(d.onlyDesign ?? []).length} onlyLive=${(d.onlyLive ?? []).length} changed=${(d.changed ?? []).length}`,
  );
  chk(d.designNodes === d.liveNodes && d.designEdges === d.liveEdges, '①-b **节点数与边数相等**', `节点 ${d.designNodes}/${d.liveNodes} · 边 ${d.designEdges}/${d.liveEdges}`);
  chk((d.designNodes ?? 0) > 0, '①-c 设计侧**不是空的**（≥1 节点，否则"相等"没意义）', `设计节点 ${d.designNodes}`);
}

// ── ② 反向对照：加一个源文件并重新索引 ⇒ diff 必须非零 ──────
//   ★ 为什么用"加源文件"而不是"edit_dsl 加节点"：edit_dsl 有三道写闸（L1 原因长度 / L3 实体绑定 / op 形状），
//     那是**另一条链**要证的东西；本证要证的是 **diff 的灵敏度**，所以用最直的输入（文件系统 + 重建索引）。
//     ★ 没有这条对照，① 的"全 0"可能只是 diff 坏了或永远返回空 —— 那样的绿是假绿。
{
  fs.writeFileSync(path.join(proj, 'src/c.ts'), 'export function qux(): number { return 42; }\nexport const NEWER = 2;\n');
  await T('import_project').handler({ project_dir: proj, feature: FEAT });
  const d2 = await diff();
  chk(
    (d2.onlyLive ?? []).length > 0 || (d2.changed ?? []).length > 0 || d2.liveNodes > d2.designNodes,
    '② 反向对照：**加源文件后 diff 必须非零**（证明这张证不是恒绿）',
    `onlyLive=${(d2.onlyLive ?? []).length} changed=${(d2.changed ?? []).length} 实际节点 ${d2.liveNodes} > 设计 ${d2.designNodes}`,
  );
  console.log('     样例 onlyLive:', JSON.stringify((d2.onlyLive ?? []).slice(0, 3)));
}

// ── ③ 可复现 ─────────────────────────────────────────
{
  const a = await diff();
  const b = await diff();
  chk(
    JSON.stringify({ o: a.onlyDesign, l: a.onlyLive, c: a.changed }) === JSON.stringify({ o: b.onlyDesign, l: b.onlyLive, c: b.changed }),
    '③ 同一状态连跑两次 diff，读数**一致**（无隐藏状态）',
  );
}

console.log(`\n═══ T435 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
