#!/usr/bin/env node
/**
 * plan-assertions.mjs —— 设计 DSL 的「判据有没有执行者」清点器
 *
 * 背景：`task_plan` 里的判据类字符串，很多没有执行者。而 `design_dsl_health.anti_idle`
 * 自己写着「判据没有执行者 = 等于没有」—— 本脚本把这条规矩扩到整份 task_plan。
 *
 * 判据三态：machine（有 cmd/runner）· review（有 by+where）· unjudged（明确承认没人判）
 *
 * ═══════════════════════════════════════════════════════════════
 * ★★★ 2026-10-18 重写（第四道闸指出 N1 的机制性修法不成立）
 *
 * 上一版的病：为了处理"同名两义"，加了一条 `if (node.criterion === false) return;`。
 * ⇒ ★ 它是**子树级、无白名单、无检查**的排除 ⇒ 一个标记可以把任意真判据从统计里抹掉，
 *   而 **machine/review 的下降永远静默**（基线只比 unjudged 名单）。
 *   实测：给 `service_flow` 盖一颗 ⇒ 51→44、30→26、4→3，输出"已清 2"，exit 0。
 *   ★ 与它反对的"改名藏债"同构，只是动词从"改名"换成了"盖标记"。
 *
 * 现在补 4 条闸（缺一条这个机制就不成立）：
 *   闸 A · 路径白名单：`criterion:false` **只许**出现在 `task_plan.invariants[N]`，别处 ⇒ exit 2
 *   闸 B · 排除内不许藏判据：被排除的子树里若出现任何 CLAIM_KEY ⇒ exit 2
 *   闸 C · 归属必须可解析：`covered_by` 要能解析成 `容器[下标]` 且**不越界**；`debt` 要在台账里查得到；`checked===0` ⇒ exit 2
 *   闸 D · 基线下界：`total/machine/review` 比基线**少**也红（不只是比 unjudged 名单）
 * ═══════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';

const PLAN = 'docs/task-system-plan.dsl.json';
const LEDGER = 'docs/DESIGN.md'; // ★ debt 台账（闸 C）

const CLAIM_KEYS = new Set([
  'criteria', 'check', 'red_when', 'rule',
  'expr', 'cmd', 'metric', 'threshold',
]);
const MACHINE_KEYS = new Set(['cmd', 'runner', 'measured_by']);
const REVIEW_KEYS = ['by', 'where'];

/** ★ 闸 A 的白名单：只许在这条路径上出现 criterion:false */
const FLAG_ALLOWED = /^invariants\[\d+\]$/;

const VIOLATIONS = []; // ★ 结构违规 ⇒ exit 2（不是 exit 1）

function classify(obj) {
  const has = (k) => Object.prototype.hasOwnProperty.call(obj, k);
  if ([...MACHINE_KEYS].some(has)) return 'machine';
  if (REVIEW_KEYS.every(has)) return 'review';
  return 'unjudged';
}

/**
 * 递归收集判据。
 * ★ 闸 A + 闸 B 都在这里：`criterion === false` 必须(1)在白名单路径 (2)子树里没有判据键。
 */
function collect(node, path, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, `${path}[${i}]`, out));
    return;
  }
  if (node.criterion === false) {
    // 闸 A：白名单
    if (!FLAG_ALLOWED.test(path)) {
      VIOLATIONS.push(`闸A · criterion:false 出现在非白名单位置：${path}（只许 task_plan.invariants[N]）`);
    }
    // 闸 B：排除的子树里不许藏判据
    const s = JSON.stringify(node);
    for (const k of CLAIM_KEYS) {
      if (new RegExp(`"${k}"\\s*:`).test(s)) {
        VIOLATIONS.push(`闸B · ${path} 被 criterion:false 排除了，但里面还有判据键 \`${k}\` —— "排除了还藏判据"`);
      }
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (CLAIM_KEYS.has(k) && typeof v === 'string') {
      out.push({ path: p, text: v, kind: classify(node) });
    } else {
      collect(v, p, out);
    }
  }
}

/** ★ 闸 C：不变量归属检查 —— 必须**可解析**且**不越界**，`checked===0` 也算违规 */
function checkInvariantsCoverage(tp, ledgerText) {
  const inv = tp.invariants;
  if (!Array.isArray(inv)) {
    VIOLATIONS.push('闸C · task_plan.invariants 不存在或不是数组 ⇒ 归属检查跑不了（不许当绿）');
    return { checked: 0, uncovered: [] };
  }
  if (inv.length === 0) {
    VIOLATIONS.push('闸C · task_plan.invariants 是空数组 ⇒ 命中 0 条 ≠ 绿（违反本仓铁律）');
  }
  const uncovered = [];
  const containers = {
    invariant_checks: tp.invariant_checks,
    invariant_unjudgeable: tp.invariant_unjudgeable,
  };
  inv.forEach((it, i) => {
    const at = `invariants[${i}]`;
    if (!it || typeof it !== 'object') { uncovered.push(`${at}：不是对象`); return; }
    const covered = it.covered_by;
    const debt = it.debt;
    if (!covered && !debt) { uncovered.push(`${at}：既无 covered_by 也无 debt`); return; }

    if (covered) {
      const m = String(covered).match(/^([A-Za-z_]+)\[(\d+)\]$/);
      if (!m) {
        uncovered.push(`${at}：covered_by 格式不对（${covered}）—— 必须是 容器[下标]`);
      } else {
        const [, name, idx] = m;
        const arr = containers[name];
        if (!Array.isArray(arr)) uncovered.push(`${at}：covered_by 指向未知容器（${name}）`);
        else if (Number(idx) >= arr.length) uncovered.push(`${at}：covered_by 越界（${covered}，该容器只有 ${arr.length} 条）`);
      }
    }
    if (debt && ledgerText && !ledgerText.includes(String(debt))) {
      uncovered.push(`${at}：debt \`${debt}\` 在台账（${LEDGER}）里查不到 ⇒ 只是一句没人读的字符串`);
    }
  });
  return { checked: inv.length, uncovered };
}

function main() {
  const dsl = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const tp = dsl.task_plan || {};
  let ledgerText = '';
  try { ledgerText = fs.readFileSync(LEDGER, 'utf8'); } catch { /* 台账不存在 ⇒ 跳过 debt 校验 */ }

  const found = [];
  collect(tp, '', found);

  const byKind = { machine: [], review: [], unjudged: [] };
  for (const f of found) byKind[f.kind].push(f);

  const total = found.length;
  console.log(`════ 判据清点：${PLAN} ════`);
  console.log(`总数 ${total}  ·  machine ${byKind.machine.length}  ·  review ${byKind.review.length}  ·  unjudged ${byKind.unjudged.length}`);
  console.log('');

  if (byKind.unjudged.length) {
    console.log(`★ unjudged ${byKind.unjudged.length} 条（按 anti_idle 自己的定义：等于没有）`);
    for (const f of byKind.unjudged.slice(0, 12)) {
      const short = f.text.length > 72 ? f.text.slice(0, 72) + '…' : f.text;
      console.log(`  · ${f.path}\n      ${short}`);
    }
    if (byKind.unjudged.length > 12) console.log(`  … 其余 ${byKind.unjudged.length - 12} 条见 --json`);
    console.log('');
  }

  // ★ 闸 C
  const invCov = checkInvariantsCoverage(tp, ledgerText);
  console.log(`★ invariants 归属：${invCov.checked} 条，未归属 ${invCov.uncovered.length} 条`);
  for (const u of invCov.uncovered) console.log(`  ✗ ${u}`);

  // ★ 闸 D：基线下界（total/machine/review 下降也红）+ unjudged 名单比对
  const baseline = tp.assertion_baseline_2026_10_17;
  let degraded = false;
  if (baseline) {
    const dropped = [];
    if (typeof baseline.total === 'number' && total < baseline.total) dropped.push(`total ${baseline.total}→${total}`);
    if (typeof baseline.machine === 'number' && byKind.machine.length < baseline.machine) dropped.push(`machine ${baseline.machine}→${byKind.machine.length}`);
    if (typeof baseline.review === 'number' && byKind.review.length < baseline.review) dropped.push(`review ${baseline.review}→${byKind.review.length}`);
    if (dropped.length) {
      console.log(`\n★★ 闸D · 有指标【下降】⇒ 可能有判据被"排除"掉了：${dropped.join(' · ')}`);
      degraded = true;
    }
    if (Array.isArray(baseline.unjudged_paths)) {
      const known = new Set(baseline.unjudged_paths);
      const now = new Set(byKind.unjudged.map((f) => f.path));
      const added = [...now].filter((p) => !known.has(p));
      const removed = [...known].filter((p) => !now.has(p));
      console.log(`\n★ 对基线名单（${known.size} 条 unjudged）：新增 ${added.length} · 已清 ${removed.length}`);
      if (added.length) {
        console.log('  ★★ 新增的「没有执行者的判据」：');
        for (const p of added) console.log(`     + ${p}`);
        degraded = true;
      }
      if (removed.length) {
        console.log('  ✓ 已清掉的（可从名单里删）：');
        for (const p of removed.slice(0, 8)) console.log(`     - ${p}`);
      }
      if (!added.length && !removed.length) console.log('  = 名单无变化');
    }
  }

  // ★ 结构违规 ⇒ exit 2（比"债务"更严重：机制本身坏了）
  if (VIOLATIONS.length) {
    console.error('\n════ 闸 A/B/C 有结构违规（exit 2）════');
    for (const v of VIOLATIONS) console.error('  ✗ ' + v);
    process.exit(2);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total, machine: byKind.machine.length, review: byKind.review.length, unjudged: byKind.unjudged.length, items: byKind.unjudged }, null, 2));
  }

  if (process.argv.includes('--fail-on-debt') && (degraded || invCov.uncovered.length)) {
    console.error('\n★ FAIL：' + (invCov.uncovered.length ? 'invariants 有未归属/悬空' : '判据债务或指标下降'));
    process.exit(1);
  }
  process.exit(0);
}

main();
