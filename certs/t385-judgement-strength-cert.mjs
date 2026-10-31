#!/usr/bin/env node
/**
 * ★★★ cert T385 —— **判据强不强**：`judgement_ref` 收敛成可解析引用（2026-10-28 · 迭代 ④）
 *
 * ## 为什么有这张证（用户目标："这套流程还能发现逻辑 bug"）
 * 能不能发现**逻辑错**取决于判据**种类**：
 * · **语义类**（能发现）：`behavior-cases` / `call-exists` / `edge-absent` / `edge-exists` / `run`
 * · **存在/结构类**（**永远发现不了逻辑错**）：`file-exists` / `source-has` / `symbol-exists` / `signature-matches`
 * 而 `judgement_ref` 原来是自由文本（`cert:t383/②`）⇒ **机器读不出种类** ⇒ 强度判不了。
 * ⇒ 收敛成 `decision:<node_id>#<index>`（判据住册，首选）或 `cert:<证>#<检查号>`（种类不登记 ⇒ 不假装强）。
 *
 * ## 判据（每条亲手跑）
 *   ① `decision:n#0` 指向 `behavior-cases` ⇒ **不报**（语义类，能发现逻辑错）；
 *   ② 指向 `file-exists` ⇒ **报"永远发现不了逻辑错"**（并给出换法）；
 *   ③ 自由文本 ⇒ 报"不是规范引用"（**不猜**，也不当通过）；
 *   ④ 节点/索引不存在 ⇒ 报"判不出来"（★ **判不出 ≠ 合格**）；
 *   ⑤ `cert:` 形态 ⇒ 报"种类不登记"（不假装强）；
 *   ⑥ 写闸的 `warnings` 里真的出现这些点名。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只按 `decision.expectations[index].kind` 取种类；`phase`（前态/后态）不参与强度判定；
 *   · **[未核] 语义判据的**内容**质量**：`behavior-cases` 写了但期望值抄错，本证判不出来（只判种类）。
 *
 * ## 用法
 *   node certs/t385-judgement-strength-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/db/rewrite_plan.ts, src/application/write_gate.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ★★★ 2026-10-31（迁移开关，见 `AGENTS-RULES.md` 0.3）：本证用**证判**（`cert:`）而不是画布判据，
//   而计划闸**解不出 `cert:` 引用** ⇒ 严格档会把它要观察的那一步（"放行"）先拦掉，证就观察不到自己该验的东西。
//   ⇒ 只在本证内把严格档关掉（**只报不拦**）：闸本身照旧跑、warnings 照旧出，本证断言一字未改。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp385pow-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const REL = 'src/a.ts';
const SEM = 'src/a_sem.ts';
fs.writeFileSync(path.join(PROJ, REL), 'export function f(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, SEM), 'export function h(): number {\n  return 1;\n}\n');
fs.writeFileSync(path.join(PROJ, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));

const { importProject } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/graph/import_project.js');
const { parseJudgementRef, strengthOfKind, planJudgementGaps, writeRewritePlan } = await import(
  'file:///D:/agentio/dev/agent-io/dist/src/application/design/db/rewrite_plan.js'
);
const { assertSourceWriteRegistered } = await import('file:///D:/agentio/dev/agent-io/dist/src/application/write_gate.js');
const { getDSL, saveDSL } = await import('file:///D:/agentio/dev/agent-io/dist/src/infrastructure/storage.js');

await importProject({ project_dir: PROJ, feature: 't385' });
// 给两个文件节点挂判据：n_weak 挂 file-exists（存在性），n_sem 挂 behavior-cases（语义）
{
  const dsl = getDSL('t385');
  for (const n of dsl.geometry.nodes ?? []) {
    if (n.path === REL || n.description === REL) {
      n.id = 'n_weak';
      n.gate = 'exempt';
      n.decision = {
        summary: 't385 弱判据节点',
        expectations: [{ kind: 'file-exists', path: 'src/never_here.ts', why: '存在性判据（发现不了逻辑错）' }],
      };
    }
    if (n.path === SEM || n.description === SEM) {
      n.id = 'n_sem';
      n.gate = 'exempt';
      n.decision = {
        summary: 't385 语义判据节点',
        expectations: [
          { kind: 'behavior-cases', path: SEM, symbol: 'h', cases: [{ given: [], expect: 'h()' }], why: '行为判据' },
        ],
      };
    }
  }
  saveDSL(dsl, PROJ);
}

// ── 纯函数部分（判据分类 + 解析）──────────────────────────
{
  chk(strengthOfKind('behavior-cases') === 'semantic' && strengthOfKind('call-exists') === 'semantic', '① 语义类判据 ⇒ `semantic`（能发现逻辑错）');
  chk(strengthOfKind('file-exists') === 'existence' && strengthOfKind('source-has') === 'existence', '② 存在/结构类 ⇒ `existence`（发现不了逻辑错）');
  chk(strengthOfKind('whatever-unknown') === 'unknown', '④ 不认识的种类 ⇒ `unknown`（★ 判不出 ≠ 合格）');
  chk(parseJudgementRef('cert:t383/②') === null, '③ 自由文本（`cert:t383/②` 不是规范形态）⇒ 解析成 `null`，不猜');
  chk(
    JSON.stringify(parseJudgementRef('decision:n_sem#0')) === JSON.stringify({ kind: 'decision', nodeId: 'n_sem', index: 0 }),
    '⑤ `decision:<node>#<index>` 解析正确（首选形态）',
  );
}

// ── 强度缺口（注入 resolver，纯函数）─────────────────────
{
  const plan = {
    path: REL,
    entries: [
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'decision:n_weak#0', status: 'open' },
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'y', judgement_ref: 'decision:n_sem#0', status: 'open' },
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'z', judgement_ref: 'cert:t385/⑤', status: 'open' },
      { anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'w', judgement_ref: '随便写的', status: 'open' },
    ],
  };
  const gaps = planJudgementGaps(plan, (e) => {
    const r = parseJudgementRef(e.judgement_ref);
    if (!r) return { why_not: '引用不是规范形态' };
    if (r.kind === 'cert') return { why_not: 'cert 不登记种类' };
    return { kind: r.nodeId === 'n_sem' ? 'behavior-cases' : 'file-exists' };
  });
  chk(gaps.length === 3, '⑥ 四条里 3 条被点名（弱/证/自由文本），语义类那条不点', `gaps=${gaps.length}`);
  chk(gaps.some((g) => /永远发现不了逻辑错/.test(g)), '② 弱判据被点名"永远发现不了逻辑错"', gaps.find((g) => /永远/.test(g))?.split('\n')[0]?.slice(0, 110) ?? '');
}

// ── 写闸真的用了这条判据 ─────────────────────────────────
{
  writeRewritePlan(PROJ, {
    path: REL,
    entries: [{ anchor: { symbol: 'f' }, kind: 'rewrite', detail: 'x', judgement_ref: 'decision:n_weak#0', status: 'open' }],
  });
  const out = assertSourceWriteRegistered(PROJ, [path.join(PROJ, REL)]);
  const hit = (out.warnings ?? []).find((w) => /永远发现不了逻辑错/.test(w));
  chk(!!hit, '⑥-b 写闸 `warnings` 里出现"发现不了逻辑错"（判据真的接上了）', (hit ?? '').split('\n').find((l) => /永远/.test(l))?.trim().slice(0, 120) ?? '(没接上)');
}

console.log(`\n═══ T385 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
