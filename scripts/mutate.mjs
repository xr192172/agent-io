/**
 * mutate.mjs —— 对「契约」做自动突变（★ 用户 2026-10-19："能不能自动做突变测试"）
 *
 * ## 它验的是什么（D7 的正解）
 * **判据必须会失败** —— 但**不靠人写反例**，靠系统自动把输入改坏：
 * ```
 * symbol-exists / signature-matches : symbol 改成不存在的名字  ⇒ 必须 fail
 * file-exists                       : path 改成不存在的路径    ⇒ 必须 fail
 * edge-exists / edge-absent          : from 或 to 改一个        ⇒ 必须 fail
 * call-exists                       : target 改成不存在的符号  ⇒ 必须 fail
 * run                               : ★ 跳过（expect 是任意表达式，"改哪个字段会 fail"不可知）
 * ```
 *
 * ## 两个词
 * - **杀死（killed）** = 突变后判据 **fail / unsupported / pending** ⇒ 判据有反应
 * - **存活（survived）** = 突变后判据 **还 pass** ⇒ ★ 那条判据是【装饰】（永远绿）
 *
 * ## 两种用法
 *   node scripts/mutate.mjs              # CLI
 *   import { runMutate } from './mutate.mjs'  # 给 design-check 用（D7 的判据）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 每条 expectation 的**突变体**（返回 null = 该 kind 不支持突变） */
function mutantsOf(e) {
  const out = [];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  switch (e.kind) {
    case 'symbol-exists':
    case 'signature-matches': {
      const m = clone(e);
      m.symbol = `${e.symbol}__MUTANT__`;
      out.push({ label: `symbol → ${m.symbol}`, exp: m });
      break;
    }
    case 'file-exists': {
      const m = clone(e);
      m.path = `__MUTANT__/${path.basename(String(e.path))}`;
      out.push({ label: `path → ${m.path}`, exp: m });
      break;
    }
    case 'edge-exists':
    case 'edge-absent': {
      const m = clone(e);
      m.from = `${e.from}__MUTANT__`;
      out.push({ label: `from → ${m.from}`, exp: m });
      const m2 = clone(e);
      m2.to = `${e.to}__MUTANT__`;
      out.push({ label: `to → ${m2.to}`, exp: m2 });
      break;
    }
    case 'call-exists': {
      const m = clone(e);
      m.target = `${e.target}__MUTANT__`;
      out.push({ label: `target → ${m.target}`, exp: m });
      break;
    }
    default:
      return null; // ★ run / 未知 kind ⇒ 跳过（不假绿）
  }
  return out;
}

/**
 * 跑一遍突变，返回结构化报告（★ design:check 的 D7 用它）。
 * @param {string} feature
 * @param {string} [root] 默认 cwd
 */
export async function runMutate(feature, root = process.cwd()) {
  const file = path.join(root, '.agent-io', 'design', `${feature}.dsl.json`);
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  const dsl = JSON.parse(fs.readFileSync(file, 'utf8'));
  const je = await import(pathToFileURL(path.join(root, 'dist/src/application/design/intent/expectations.js')).href);

  const items = [];
  for (const n of dsl.geometry.nodes ?? []) {
    for (const e of n.decision?.expectations ?? []) {
      items.push({ node_id: n.id, node_label: String(n.description ?? n.id), expectation: e });
    }
  }

  const survivedItems = [];
  let killed = 0;
  let survived = 0;
  let skipped = 0;
  for (const it of items) {
    const muts = mutantsOf(it.expectation);
    if (!muts) {
      skipped++;
      continue;
    }
    for (const mu of muts) {
      const rep = await je.judgeExpectations(root, [{ node_id: it.node_id, node_label: it.node_label, expectation: mu.exp }]);
      const v = rep.items[0].verdict;
      if (v !== 'pass') killed++;
      else {
        survived++;
        survivedItems.push({ node_id: it.node_id, kind: it.expectation.kind, mutant: mu.label, original: it.expectation });
      }
    }
  }
  return { feature, checked: items.length, killed, survived, skipped, survived_items: survivedItems };
}

// ── CLI ──────────────────────────────────────────────────────────────
const isCli = (() => {
  try {
    return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isCli) {
  const args = process.argv.slice(2);
  const argOf = (n) => {
    const i = args.indexOf(n);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const FEATURE = argOf('--feature') ?? 'task-system-plan';
  const JSON_OUT = args.includes('--json');
  const rep = await runMutate(FEATURE);

  if (JSON_OUT) {
    console.log(JSON.stringify(rep, null, 2));
  } else {
    console.log(`══ mutate · ${rep.feature} ══`);
    console.log(`  expectation ${rep.checked} 条 · 突变 ${rep.killed + rep.survived} 次`);
    console.log(`  ✓ 被杀死（判据有反应）：${rep.killed}`);
    console.log(`  ★ 存活（判据没反应 = 装饰）：${rep.survived}`);
    console.log(`  … 跳过（run 类，不支持突变）：${rep.skipped}`);
    if (rep.survived) {
      console.log('\n  ★ 存活清单（这些判据"改坏了也不报"）：');
      for (const r of rep.survived_items.slice(0, 20)) {
        console.log(`    ${r.node_id.replace('file_src_', '')} · ${r.kind} · ${r.mutant}`);
      }
      if (rep.survived > 20) console.log(`    …还有 ${rep.survived - 20} 条`);
    }
  }
  process.exit(rep.survived ? 1 : 0);
}
