#!/usr/bin/env node
/**
 * ★★★ cert T427 —— **`consistency_check` 的能力搬进 `design_line action=judge`**（2026-10-28）
 *
 * ## 这不是"合并"，是"结构化重写"（用户问的正是这一种）
 * `consistency_check` 原来干两件事：
 *   ① `expected_apis vs 代码` 的对账报表 —— **已被判据体系覆盖**
 *      （`symbol-exists` / `signature-matches` 覆盖逐 API；`edge-exists` / `call-exists` 覆盖跨文件不变式）；
 *   ② **决策卡 `expectations` 整批判定** —— ★ 这是**唯一入口**，删了就真丢能力。
 * ⇒ 处置：② **搬进 `design_line`（设计链第 ⑤ 步：设计 vs 实际）**，① 交给判据；工具外壳删掉。
 * ⇒ **执行核 `checkConsistencyReport` 必须留着**：`detect_drift` 与 HTTP `serve.ts` 都在用它。
 *
 * ## 判据（每条亲手跑）
 *   ① `consistency_check` **不在注册表**；工具面 **52 → 51**；
 *   ② `design_line action=judge` **能跑出整册四态**（`pass/fail/unsupported/pending` 计数）；
 *   ③ 它对 `unsupported` **不伪装成通过**（回执里明确写"判不了 ≠ 通过"）；
 *   ④ `fail` 条目**逐条列出**（有红就说，不吞）；
 *   ⑤ 执行核仍在：`detect_drift` 仍注册且仍 import `checkConsistencyReport`（静态检查）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **没有**造 `fail` 样本来验"红真的会出来"——那要改真册（`feature=agent-io`），本证不碰；
 *     只证"若 tally.fail>0 则逐条列出"的**结构**成立；
 *   · **[未核]** `design_line action=judge` 的 `data.items` 与旧 `consistency_check` 的 `data` 形状不同
 *     （旧的是对账报表 + 判据），**这是有意的**：对账已被判据覆盖，不需要再复刻一遍。
 *
 * ## 用法
 *   node certs/t427-consistency-into-design-line-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
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

// ── ① 旧工具已不在 ────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('consistency_check'), '① `consistency_check` **不在注册表**');
  chk(names.length <= 51, '①-b 工具面 **≤ 51**（只降不升；后续还并了 detect_drift / tool_usage）', `实际 ${names.length}`);
}

// ── ② design_line action=judge 能跑出四态 ──────────────
{
  const dl = TOOL_DEFS.find((t) => t.name === 'design_line');
  const t = String((await dl.handler({ action: 'judge', feature: 'agent-io', project_dir: ROOT }))?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  const msg = (i > 0 ? t.slice(0, i) : t).trim();
  let data;
  try {
    data = i > 0 ? JSON.parse(t.slice(i + 10).trim()) : undefined;
  } catch {
    data = undefined;
  }
  chk(!!data?.tally, '② `design_line action=judge` **跑出了整册判据批**（有四态计数）', msg.split('\n')[0]?.slice(0, 120));
  const total = Object.values(data?.tally ?? {}).reduce((a, b) => a + Number(b), 0);
  chk(total > 0, '②-b 判据条数 > 0（真的判了东西，不是空跑）', `total=${total} · ${JSON.stringify(data?.tally ?? {})}`);
  chk(/判不了/.test(msg), '③ 回执**明确写了"unsupported = 判不了 ≠ 通过"**（不伪装成绿）', msg.split('\n')[0]?.slice(0, 120));
  const fails = Number(data?.tally?.fail ?? 0);
  const failLines = msg.split('\n').filter((l) => l.includes('✗')).length;
  chk(fails === 0 ? failLines === 0 : failLines > 0, '④ `fail` 条目**逐条列出**（有红就说，不吞）', `fail=${fails} · 列出 ${failLines} 行`);
}

// ── ⑤ 执行核仍在（detect_drift / serve 还在用）─────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  // ★ 2026-10-28 更新前提：`detect_drift` 后来自己也被并进 `design_line action=drift`（证 t428）
  //   ⇒ 这里要证的**不是"旧工具还在"**，而是**执行核仍有消费方**（`detect_drift.ts` 仍在，且仍调 `checkConsistencyReport`）。
  chk(
    fs.existsSync(path.join(ROOT, 'src/application/design/intent/detect_drift.ts')) || names.includes('detect_drift'),
    '⑤ 执行核仍有消费方（`detect_drift.ts` 仍在，或旧工具仍注册）',
  );
  const driftSrc = fs.readFileSync(path.join(ROOT, 'src/application/design/intent/detect_drift.ts'), 'utf8');
  chk(/checkConsistencyReport/.test(driftSrc), '⑤-b 执行核 `checkConsistencyReport` **仍被 detect_drift 引用**（只删了报表外壳，没删能力）');
  chk(fs.existsSync(path.join(ROOT, 'src/application/design/intent/consistency.ts')), '⑤-c 执行核文件 `intent/consistency.ts` **仍在**');
}

console.log(`\n═══ T427 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
