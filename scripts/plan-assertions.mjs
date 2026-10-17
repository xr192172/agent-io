#!/usr/bin/env node
/**
 * plan-assertions.mjs —— 设计 DSL 的「判据有没有执行者」清点器
 *
 * 背景（2026-10-17）：
 *   docs/task-system-plan.dsl.json 的 task_plan 里有 48 条判据类字符串，
 *   但只有 invariant_checks 那 6 条带 cmd。
 *   而 design_dsl_health.anti_idle 自己写着：
 *     「存在判据但无 runner ⇒ 判据没有执行者 = 等于没有」
 *   —— 这条规矩一直只施加在 invariant_checks 上，没用在整份 task_plan 上。
 *
 * 本脚本把那条规矩扩到整份 task_plan：每条判据必须有归属，归属三态：
 *   machine  : 有 cmd / runner / measured_by ⇒ 机器判真假
 *   review   : 有 by + where ⇒ 指名的判者 + 留痕点
 *   unjudged : 都没有 ⇒ 明确承认没人判（不许当成"已经保证了"）
 *
 * 用法：
 *   node scripts/plan-assertions.mjs              # 打印读数 + unjudged 清单
 *   node scripts/plan-assertions.mjs --fail-on-debt   # unjudged 比基线多 ⇒ exit 1
 */
import fs from 'node:fs';

const PLAN = 'docs/task-system-plan.dsl.json';

/** 判据类字段名（值必须是字符串） */
const CLAIM_KEYS = new Set([
  // ★★★ 2026-10-17（第 6 次校准）：只留【能执行/能判真假】的键。
  //   ★ 删掉的：answer / proves / core / now / corrected / verdict ——
  //     它们是【语义说明】（"这证明什么""当前状态""纠正了什么"），不是判据。
  //     ★ 靠键名猜判据的代价实测：42 条 unjudged 里 32 条是这类误判（假红）。
  "criteria", "check", "red_when", "rule",
  "expr", "cmd", "metric", "threshold",
]);

/** 同一对象里出现这些键，说明这条判据有机器执行者 */
const MACHINE_KEYS = new Set(['cmd', 'runner', 'measured_by']);
/** 同一对象里同时出现这两个键，说明这条判据有指名的判者与留痕点 */
const REVIEW_KEYS = ['by', 'where'];

function classify(obj) {
  const has = (k) => Object.prototype.hasOwnProperty.call(obj, k);
  if ([...MACHINE_KEYS].some(has)) return 'machine';
  if (REVIEW_KEYS.every(has)) return 'review';
  return 'unjudged';
}

/** 递归收集：每条判据记 { path, text, kind } */
function collect(node, path, out) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, `${path}[${i}]`, out));
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

function main() {
  const dsl = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const tp = dsl.task_plan || {};

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
    if (byKind.unjudged.length > 12) {
      console.log(`  … 其余 ${byKind.unjudged.length - 12} 条见 --json`);
    }
    console.log('');
  }

  // 与图里写下的基线对比。
  // ★★★ 第一版只比总数 —— 自测实测：加一条 unjudged 后总数 41 < 基线 42，仍判「改善」不报红。
  //     那是个假闸。改为【比对名单】：出现基线名单之外的 path ⇒ 新增债务 ⇒ 红。
  const baseline = tp.assertion_baseline_2026_10_17;
  let degraded = false;
  if (baseline && Array.isArray(baseline.unjudged_paths)) {
    const known = new Set(baseline.unjudged_paths);
    const now = new Set(byKind.unjudged.map((f) => f.path));
    const added = [...now].filter((p) => !known.has(p));
    const removed = [...known].filter((p) => !now.has(p));

    console.log(`★ 对基线名单（${known.size} 条 unjudged）：新增 ${added.length} · 已清 ${removed.length}`);
    if (added.length) {
      console.log('  ★★ 新增的「没有执行者的判据」（不许出现 —— 等于拿文字冒充保证）：');
      for (const p of added) console.log(`     + ${p}`);
      degraded = true;
    }
    if (removed.length) {
      console.log('  ✓ 已清掉的（可从上榜名单里删）：');
      for (const p of removed.slice(0, 8)) console.log(`     - ${p}`);
    }
    if (!added.length && !removed.length) console.log('  = 名单无变化');
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ total, machine: byKind.machine.length, review: byKind.review.length, unjudged: byKind.unjudged.length, items: byKind.unjudged }, null, 2));
  }

  if (process.argv.includes('--fail-on-debt') && degraded) {
    console.error('\n★ FAIL：出现了基线名单之外的 unjudged 判据 ⇒ 新增了「没有执行者」的断言。');
    process.exit(1);
  }
  process.exit(0);
}

main();
