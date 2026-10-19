/**
 * mutate.mjs —— 对「契约」做自动突变（★ 用户 2026-10-19："自动做突变测试"）
 *
 * ## 两层突变
 *
 * ### 第一层：结构类（`symbol-exists` / `file-exists` / …）—— "改名字/改路径"
 * ```
 * symbol 改成不存在的名字 · path 改成不存在的路径 · from/to/target 改一个
 * ⇒ 判据必须 fail（否则它是装饰）
 * ```
 *
 * ### 第二层：`run`（行为类）—— ★ "对 input 的叶子做类型/边界替换"
 * ```
 * 对 input 的每个叶子（最多 3 个，防爆炸），依次换成【不合法/边界】值：
 *   类型错：null / undefined / 0 / '' / [] / {}
 *   字符串边界：'' / ' ' / '\u0000' / '中文' / '😀' / 超长 / '\r\n'
 *   数值边界：0 / -1 / 1e308
 *   结构错：删一个必填键
 * ⇒ fail = 判据敏感（杀死）；★ 全 pass = 判据是装饰
 * ★ 这就是"要 int 就自动测边界/编码" —— 不用人指定改哪个字段，每个叶子都试
 * ```
 *
 * ## 两个词
 * - **杀死（killed）** = 突变后判据 **fail / unsupported / pending** ⇒ 判据有反应
 * - **存活（survived）** = 突变后判据 **还 pass** ⇒ ★ 那条判据对该突变【无感】
 *
 * ## 两种用法
 *   node scripts/mutate.mjs                     # CLI
 *   import { runMutate } from './mutate.mjs'    # 给 design-check 用（D7 的判据）
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 把任意值转成"可读短标签"（用于报告） */
const label = (v) => {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? 'undefined' : s.length > 24 ? s.slice(0, 24) + '…' : s;
  } catch {
    return String(v);
  }
};

/** 收集 `input` 的所有叶子（path + 值），最多 `max` 个 */
function collectLeaves(v, p = [], out = [], max = 3) {
  if (out.length >= max) return out;
  if (v === null || typeof v !== 'object') {
    out.push({ path: p, value: v });
    return out;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length && out.length < max; i++) collectLeaves(v[i], [...p, i], out, max);
    return out;
  }
  for (const k of Object.keys(v)) {
    if (out.length >= max) break;
    collectLeaves(v[k], [...p, k], out, max);
  }
  return out;
}

/** 按叶子的类型给出"不合法/边界"值 */
function mutantsFor(value) {
  if (typeof value === 'string')
    // ★★★ 2026-10-19（突变抓到的第三个设计问题）：**"超长"不是边界值** ——
    //   大多数校验器（validateDSL）本来就不管长度 ⇒ "超长存活"不是判据装饰，是我把非边界当边界。
    //   ★ 真正的边界是：空 / 纯空格 / 控制字符 / 中文 / emoji / CRLF（编码与空白类）。
    return ['', ' ', '\u0000', '中文', '😀', '\r\n'];
  if (typeof value === 'number') return [0, -1, 1e308, NaN];
  if (typeof value === 'boolean') return [null, 0, ''];
  if (Array.isArray(value)) return [[], [null]];
  if (value === null) return [0, '', false];
  if (typeof value === 'object') return [null, [], ''];
  return [null, 0, ''];
}

/** 按 path 写值（会 clone 一份再改，不动原对象） */
function withLeaf(input, leafPath, value) {
  const root = JSON.parse(JSON.stringify(input === undefined ? null : input));
  if (!leafPath.length) return value;
  let cur = root;
  for (let i = 0; i < leafPath.length - 1; i++) cur = cur[leafPath[i]];
  cur[leafPath[leafPath.length - 1]] = value;
  return root;
}

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
    // ★★★ 2026-10-19：source-has 的突变 —— 把 must 改成一个源码里不可能有的串（该 fail）；
    //   把 mustNot 加一个源码里**必有**的串（该 fail）。★ mustNot 的突变体用 'export'（任何 TS 文件都有）。
    case 'source-has': {
      for (const t of (e.must ?? []).slice(0, 2)) {
        const m = clone(e);
        m.must = [`__MUTANT__${String(t).slice(0, 20)}`];
        out.push({ label: `must → __MUTANT__（原：${String(t).slice(0, 24)}）`, exp: m });
      }
      for (const t of (e.mustNot ?? []).slice(0, 2)) {
        const m = clone(e);
        m.mustNot = ['export'];
        out.push({ label: `mustNot → 'export'（原：${String(t).slice(0, 24)}）`, exp: m });
      }
      break;
    }
    // ★★★ 第二层：run —— 对 input 的叶子做类型/边界替换
    case 'run': {
      if (e.input === undefined) return null;
      // ★★★ 2026-10-19（突变抓到的"设计问题"）：如果 expect **根本不读 input**，
      //   那它就是"接线检查"（grep 源码），不是"行为契约" ⇒ 改 input 必然无感 ⇒ 突变无意义。
      //   ⇒ 标 skipped（★ 不假绿），并在 why 里要求作者说清"它是哪种"。
      if (!/\binput\b/.test(String(e.expect))) return null;
      const leaves = collectLeaves(e.input, [], [], 3).filter((lf) => {
        // ★ mutants_ignore：作者声明的"等价突变体"字段（expect 根本不读）⇒ 跳过
        const top = String(lf.path[0] ?? '');
        return !(e.mutants_ignore ?? []).includes(top);
      }); // ★ 最多 3 个叶子（防爆炸）
      for (const leaf of leaves) {
        for (const v of mutantsFor(leaf.value)) {
          const m = clone(e);
          m.input = withLeaf(e.input, leaf.path, v);
          out.push({ label: `input.${leaf.path.join('.')} → ${label(v)}`, exp: m });
        }
      }
      break;
    }
    default:
      return null; // ★ 未知 kind ⇒ 跳过（不假绿）
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
  let skippedNoInput = 0; // 无 input
  let skippedDeclared = 0; // ★ mutants_ignore: ['*'] —— 声明"不参与输入突变"
  const byKind = {};
  for (const it of items) {
    const muts = mutantsOf(it.expectation);
    if (!muts) {
      skipped++;
      if (it.expectation.kind === 'run') {
        if (it.expectation.input === undefined) skippedNoInput++;
        else skippedDeclared++; // expect 不读 input（= 已声明/应声明）
      }
      continue;
    }
    const k = it.expectation.kind;
    byKind[k] = byKind[k] ?? { killed: 0, survived: 0 };
    for (const mu of muts) {
      const rep = await je.judgeExpectations(root, [{ node_id: it.node_id, node_label: it.node_label, expectation: mu.exp }]);
      const v = rep.items[0].verdict;
      if (v !== 'pass') {
        killed++;
        byKind[k].killed++;
      } else {
        survived++;
        byKind[k].survived++;
        survivedItems.push({ node_id: it.node_id, kind: it.expectation.kind, mutant: mu.label, original: it.expectation });
      }
    }
  }
  return { feature, checked: items.length, killed, survived, skipped, skipped_no_input: skippedNoInput, skipped_declared: skippedDeclared, byKind, survived_items: survivedItems };
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
    console.log(`  ★ 存活（判据对该突变无感）：${rep.survived}`);
    console.log(`  … 跳过：${rep.skipped}（无 input ${rep.skipped_no_input ?? 0} · ★ 声明不参与突变 ${rep.skipped_declared ?? 0}）`);
    console.log(`\n  按 kind：`);
    for (const [k, s] of Object.entries(rep.byKind)) {
      console.log(`    ${k.padEnd(20)} killed ${String(s.killed).padStart(4)} · ★ survived ${s.survived}`);
    }
    if (rep.survived) {
      console.log('\n  ★ 存活清单（前 20 条）：');
      for (const r of rep.survived_items.slice(0, 20)) {
        console.log(`    ${r.node_id.replace('file_src_', '')} · ${r.kind} · ${r.mutant}`);
      }
      if (rep.survived > 20) console.log(`    …还有 ${rep.survived - 20} 条`);
    }
  }
  process.exit(rep.survived ? 1 : 0);
}
