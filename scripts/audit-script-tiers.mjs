#!/usr/bin/env node
/**
 * audit:script-tiers —— **读数脚本的分层清单**（会判真假的那一批，谁在跑它、谁没在跑）。
 *
 * ## 它回答什么（一份读数，**不是新门**）
 * `scripts/*.mjs` 里有**会判真假**的脚本，而"它被谁跑"分散在四条边里（见 `scripts/lib/script_tiers.mjs`）。
 * 本脚本把四边读完，按三档显形：
 *   A 自动门（有边保证会被跑到）· B 有人会跑但**没有东西保证它跑过**（靠自觉）· C 连 npm script 都没有。
 * ★ **本脚本的产出不是"把它们都变成自动门"** —— 那会让总门跑一小时以上。产出是**让 B 档显形**。
 *
 * ## ★ 为什么 A 档也要逐条给五列（不是一句"自动门"带过）
 * 危险排序是 **A 里的假绿 > B 的假 assure > C 的纯孤儿**：
 *   假绿给人**最强**的 assuredness（"已经在自动跑了"），而本仓实测的三例全在 A 里。
 * ⇒ 所以 A 档每条必须有：谁在跑 / 它跑到的到底是什么 / 读数锚点有没有 / SKIP 条件 / 已知假绿形态。
 *   判据（可判）：输出里**不许出现只有门名的行** —— 缺列由 `lint-prose-as-structure.mjs` 规则 G 判红。
 *
 * ## 分母（0.12③）
 * 输出**必须同时**给几个数：`scripts/*.mjs` 总数 · 读数脚本数 · 三个 tier 的数 · 已声明数；
 * 且打印闭合等式（A+B+C = 总数）。只给"A 有几个"而不给总数 ⇒ 违反 0.12③，本脚本自己判红（CLOSURE）。
 *
 * ## 「最后一次被人调用」拿不到就是拿不到（0.9.4 第 1 行）
 * 仓里**没有「脚本被调用」的账本**：`usage.jsonl` 记的是**工具**调用（`gc.mjs` 的保留期对象），
 * `write_log` 记的是**文件写**。⇒ 一律打「拿不到」并写明原因，绝不回落到某个 mtime 去冒充（0.12② 不许拿 mtime 当判据）。
 *
 * ## 用法
 * ```
 * node scripts/audit-script-tiers.mjs            # 人读
 * node scripts/audit-script-tiers.mjs --json     # 机器读（给测试与后续处理）
 * ```
 * 退出码：0 = 问题清单为空；1 = 有问题（`TIER_C_READING` / `GATE_FIELD_MISSING` / `GATE_NOTES_MISSING` /
 * `STALE_DECLARATION` / `CLOSURE`）；2 = 读不到输入（GATES / package.json）—— **判不了 ≠ 通过**。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, REGISTRY_REL } from './lib/script_tiers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

/** 「最后一次被调用」的**唯一口径**：没有账本 ⇒ 拿不到。原因逐字打出来，读的人不用猜。 */
const LAST_INVOKED_WHY = '拿不到：仓里没有「脚本被调用」的账本（`usage.jsonl` 记的是工具调用、`write_log` 记的是文件写）';

const pad = (s, n) => String(s).padEnd(n);

/** 人读渲染（纯函数：吃 collect() 的结果，**不读盘** —— 测试可直喂合成结果）。 */
function render(r) {
  const out = [];
  out.push('');
  out.push('══ 读数脚本分层（scripts/*.mjs 顶层）══');
  out.push('');
  out.push('★ 分母（一个都不许省 —— 只给分子等于没验，0.12③）：');
  out.push(`   scripts/*.mjs 总数        ${r.total}`);
  out.push(`   其中「读数脚本」          ${r.readingCount}   （① 判定语汇 ∧ ② 字面量 exit(1) ∧ ③ 非构建类 ⇒ 三条同时成立）`);
  out.push(`   读数脚本三档            A ${r.readingTiers.A} · B ${r.readingTiers.B} · C ${r.readingTiers.C}`);
  out.push(`   全部条目三档            A ${r.tiers.A} · B ${r.tiers.B} · C ${r.tiers.C}`);
  out.push(`   已声明（informational / manual-only）  ${r.declared}`);
  const sum = r.tiers.A + r.tiers.B + r.tiers.C;
  out.push(`   闭合：A + B + C = ${r.tiers.A} + ${r.tiers.B} + ${r.tiers.C} = ${sum} ${sum === r.total ? '= 总数 ✓' : `≠ 总数 ${r.total} ✗`}`);
  out.push('');

  // ── A 档：逐门逐列（这一档最危险，不许一句带过）──
  out.push('── tier A · 自动门（有边保证会被跑到）—— ★ 假绿全在这一档，所以逐门给列 ──');
  for (const g of r.gateRows) {
    out.push(`  ▸ ${g.name}`);
    out.push(`      谁在跑            ${g.consumer || '⚠ 未声明'}`);
    out.push(`      它跑到的到底是什么 ${g.runs || '（构造期门，无 cmd）'}`);
    out.push(`      读数锚点          ${g.anchorable ? '有（通过时印可核的数）' : '没有 ⇒ 通过时只印「用例 未识别」'}`);
    out.push(`      SKIP 条件         ${g.skip || '无（跑不了就是 FAIL）'}`);
    out.push(`      几算通过          ${g.passCode}（退出码 2 = 判不了，不折成 0）`);
    out.push(`      已知假绿形态      ${g.falseGreen ? g.falseGreen : '—'}`);
  }
  out.push('');

  // ── B 档：靠自觉 ──
  const bs = r.rows.filter((x) => x.tier === 'B');
  out.push(`── tier B · 有人会跑，但 **没有东西保证它跑过**（靠自觉）—— ${bs.length} 条 ──`);
  out.push('   ★ 这一批的共同点：`npm run <名字>` 能跑 ⇒ 看起来有消费者；实际是**跑了没人看、不跑没人知**。');
  for (const x of bs) {
    out.push(`  ▸ ${pad(x.file, 32)} ${x.reading ? '[读数脚本]' : '[          ]'} npm: ${x.npm.length ? x.npm.join(',') : `（无 —— 由别的脚本 spawn：${x.other.join(',')}）`}`);
    out.push(`      最后调用          ${LAST_INVOKED_WHY}`);
    out.push(`      reason            ${x.declared ? x.declared.reason : '⚠ 未声明理由'}`);
  }
  out.push('');

  // ── C 档：纯装饰 ──
  const cs = r.rows.filter((x) => x.tier === 'C');
  out.push(`── tier C · 纯装饰（无 GATES / 无 npm script / 没人 spawn）—— ${cs.length} 条 ──`);
  for (const x of cs) {
    out.push(`  ▸ ${pad(x.file, 32)} ${x.reading ? '[读数脚本]' : '[          ]'} ${x.declared ? `已声明：${x.declared.status}` : '⚠ 未声明'}`);
    out.push(`      最后调用          ${LAST_INVOKED_WHY}`);
    if (x.declared) out.push(`      reason            ${x.declared.reason}`);
  }
  out.push('');

  out.push('── 结论 ──');
  const unreasonedB = bs.filter((x) => !x.declared).length;
  out.push(`   tier B 里未声明理由：${unreasonedB} / ${bs.length}（**不判红** —— 这个数只该降；它今天就是"没人知道有多少东西在靠自觉"的那个数）`);
  if (r.problems.length === 0) {
    out.push('   ✓ 问题清单为空（没有未登记的 tier C 读数脚本 · 每道门都带 consumer/tier 与五列 · 分母闭合）');
  } else {
    out.push(`   ✗ ${r.problems.length} 条：`);
    for (const p of r.problems) out.push(`     [${p.code}] ${p.file} —— ${p.msg}`);
  }
  for (const w of r.warnings ?? []) out.push(`   ⚠ ${w}`);
  out.push('');
  return out.join('\n');
}

async function main() {
  let r;
  try {
    r = await collect(ROOT);
  } catch (e) {
    console.error(`✗ 读不到输入：${e instanceof Error ? e.message : String(e)}`);
    console.error('  ⇒ 这是「判不了」，不是「没有问题」（退出码 2）。');
    return 2;
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ ...r, last_invoked_why: LAST_INVOKED_WHY }, null, 2));
    return r.problems.length ? 1 : 0;
  }
  console.log(render(r));
  if (r.gatesError) return 2;
  if (r.npmError) return 2;
  return r.problems.length ? 1 : 0;
}

// ★ 被 import 时不跑（测试要拿 collect/analyze 做合成输入，不能一 import 就扫盘 + 退出）
const samePath = (a, b) => path.resolve(String(a)).replace(/\\/g, '/').toLowerCase() === path.resolve(String(b)).replace(/\\/g, '/').toLowerCase();
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) process.exit(await main());

export { render, LAST_INVOKED_WHY, REGISTRY_REL };
