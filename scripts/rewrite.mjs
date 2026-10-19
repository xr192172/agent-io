#!/usr/bin/env node
/**
 * rewrite.mjs —— ⑥「设计 DB → 源码」的**执行器**（★ 2026-10-19 起能真落盘）
 *
 * ## 它做什么
 * ```
 * 设计 DB（certs/design-db/<file>.calls.json 的 symbols[].signature）
 *       ↕  diff（判据住在 scripts/lib/symbol-diff.mjs，全仓唯一一份）
 * 源码（现场 parseFileFull）
 * ⇒ 同一份 diff 出【三种】结论，各有各的处置：
 *    ① 签名不同        ⇒ ★ 可重写（⑥ 的职责）→ buildRefactorPlan → applyRefactorPlan
 *    ② 设计有·源码没有  ⇒ ✗ 不可生成（DSL 只有结构+意图，没有实现 ⇒ 人写）
 *    ③ 源码有·设计没有  ⇒ ✗ 设计漏了（③ sync 的职责，不是 ⑥）
 * ```
 *
 * ## 为什么不自己算 diff
 * 它**曾经**自己算过：按 `name` 配对 + 只比存在性。那踩了两个已知坑——
 * 同名多义（`server.ts` 两处 `const resources`）被并成一个；不可比的 kind 被当成"一致"。
 * ⇒ 现在判据只有 `scripts/lib/symbol-diff.mjs` 一处，本脚本只做**编排 + 落盘**。
 *
 * ## 零写入是默认
 * 不加 `--apply` 一律只读：不写源码、不写清单、不改任何文件。
 *
 * ## 用法
 *   node scripts/rewrite.mjs                          # 全仓读数
 *   node scripts/rewrite.mjs --prefix=src/domain/      # 限定前缀
 *   node scripts/rewrite.mjs --file=src/x.ts           # 单文件
 *   node scripts/rewrite.mjs --apply                   # ★ 真落盘（幂等；重复跑第二次全是 already_applied）
 *   node scripts/rewrite.mjs --json
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { diffSymbols, uncomparedTotal } from './lib/symbol-diff.mjs';

const ROOT = process.cwd();
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const FEATURE = argOf('feature') ?? 'task-system-plan';
const FILE = argOf('file');
const PREFIX = argOf('prefix');
const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');

const r = await diffSymbols({ projectDir: ROOT, onlyFile: FILE, prefix: PREFIX });
const uncompared = uncomparedTotal(r.uncompared);

// ── --apply：把"签名不同"变成清单，走现成的两段（语法门 + 幂等 + 篡改检出）──
let applied = null;
if (APPLY) {
  const targets = r.differ.map((t) => ({ file: t.file, old_text: t.old_text, new_text: t.new_text }));
  if (targets.length === 0) {
    // ★ 显式空，不是静默跳过：0 条是结论，要说出来
    console.log('\n  ✓ 清单为空（0 条签名差异）⇒ 无需重写。');
  } else {
    const mod = await import(
      pathToFileURL(path.join(ROOT, 'dist/src/application/refactor/pipeline/refactor_plan.js')).href
    );
    const plan = await mod.buildRefactorPlan({ project_dir: ROOT, targets });
    const res = await mod.applyRefactorPlan({ project_dir: ROOT, plan, atomic: true });
    // ★★★ 落盘后【重算】一次：报告必须反映"现在"，不能拿 apply 前的读数冒充结果。
    //   否则一旦 apply 没生效，屏幕会说"0 条"而源码其实没动（或反过来）——那种谎最难查。
    const after = await diffSymbols({ projectDir: ROOT, onlyFile: FILE, prefix: PREFIX });
    applied = { plan, res, after };
  }
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        feature: FEATURE,
        scanned: r.scanned,
        same: r.same.length,
        differ: r.differ,
        uncompared,
        uncomparedByKind: Object.fromEntries(r.uncompared),
        unpaired: r.unpaired,
        designOnly: r.designOnly,
        sourceOnly: r.sourceOnly,
        applied: applied ? { plan: applied.plan, res: applied.res, afterDiffer: applied.after.differ.length } : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ── 读数 ──
console.log(`════ REWRITE · ${FEATURE} · ${r.scanned} 份设计 DB ════`);
if (FILE) console.log(`  范围：${FILE}`);
if (PREFIX) console.log(`  范围：${PREFIX}`);
console.log('');
console.log(`  ✅ 签名相同          ${r.same.length}`);
console.log(`  ★★ 签名不同（可重写） ${r.differ.length}`);
console.log(`  ⚠️  不可比（不算一致）  ${uncompared}`);
for (const [k, n] of [...r.uncompared.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`       · ${k.padEnd(12)} ${n} 条 —— 两侧都没有可比内容`);
}
if (r.unpaired.length) console.log(`  ⚠️  未配对（同名处数不一致） ${r.unpaired.length}`);
console.log(`  ✗ 设计有·源码没有    ${r.designOnly.length}   ← 不可生成（DSL 没有实现，人写）`);
console.log(`  ✗ 源码有·设计没有    ${r.sourceOnly.length}   ← 设计漏了（③ sync 的职责）`);

if (r.differ.length) {
  console.log('\n  ── 待重写（前 12）──');
  for (const t of r.differ.slice(0, 12)) {
    console.log(`\n  ${t.file}  ${t.name}（${t.kind}）`);
    console.log(`    - ${t.old_text.slice(0, 110)}`);
    console.log(`    + ${t.new_text.slice(0, 110)}`);
  }
  if (r.differ.length > 12) console.log(`\n  … 另 ${r.differ.length - 12} 条`);
}

if (applied) {
  const { plan, res, after } = applied;
  console.log('\n  ── 落盘 ──');
  console.log(`  plan_id ${plan.plan_id} · ${plan.summary.items} 项 / ${plan.summary.files} 文件`);
  console.log(
    `  applied ${res.applied} · already_applied ${res.already_applied} · failed ${res.failed} · written=${res.written} · ok=${res.ok}`,
  );
  for (const it of res.items.filter((x) => x.status !== 'applied')) {
    console.log(`    · ${it.status}  ${it.file}  ${it.error ?? ''}`);
  }
  console.log(`  ★ 复核（落盘后重算）：签名不同 ${after.differ.length}  ← 落盘前 ${r.differ.length}`);
  if (after.differ.length > 0) {
    for (const t of after.differ.slice(0, 5)) console.log(`    · 仍未一致  ${t.file}  ${t.name}`);
  }
  if (!res.ok) process.exit(1);
  if (after.differ.length > 0) process.exit(1); // 落盘了但没变一致 ⇒ 也不能算成功
} else if (r.differ.length > 0 && !APPLY) {
  console.log('\n  ★ 零写入。加 --apply 真落盘（走 buildRefactorPlan 的语法门 + 幂等 apply）。');
} else if (r.differ.length === 0) {
  console.log('\n  ✓ 没有可重写的签名差异（⑥ 的输入为空）。');
}
