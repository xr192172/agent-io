#!/usr/bin/env node
/**
 * design-diff —— **设计侧 × 实际侧的 diff**（像 `git diff`，只报不一致）。
 *
 * ## 语义（用户 2026-10-18 明确）
 * > "所谓的对拍其实就像 Git 的 diff 啊，你把两份文件进行一个 diff，看看 diff 出来的问题在哪里。"
 *
 * ★★★ 所以：
 * - **设计侧 = fork(实际侧)** ⇒ 两边**本来就该完全一样**；
 * - **"没动过"不是 diff** —— 它两边一样，`git diff` 不会显示它；
 * - **diff 只显示三类**：
 *     `+` 只在设计侧（★ 设计了但还没有）
 *         ├─ 扫描遗漏：live 未收录、但源码里确实有 ⇒ **不是要建**（import_project 抓不全）
 *         └─ 真要建：源码里也查不到         ⇒ 这才是"要建"
 *     `-` 只在实际侧（★ 实际有但设计没收录 ⇒ 要补设计）
 *     `~` 两边都有但【内容不同】（★ 我改过的地方 = 决策卡 + label + 边）
 *
 * ## 为什么这比"缺陷检测"健康
 * 它不是判"你错没错"，是告诉你**"这份图纸和现状差在哪"** —— 差在哪儿，下一步就改哪儿。
 *
 * 用法：
 *   node scripts/design-diff.mjs              # 摘要
 *   node scripts/design-diff.mjs --detail     # 逐条列
 */
import fs from 'node:fs';
import path from 'node:path';

const DESIGN = '.agent-io/design/task-system-plan.dsl.json'; // ★ 唯一位置（2026-10-18 统一）
const LIVE = '.agent-io/live/task-system-plan.dsl.json';

const argv = process.argv.slice(2);
const detail = argv.includes('--detail');

const design = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
const live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));

const dNodes = new Map((design.geometry?.nodes || []).map((n) => [n.id, n]));
const lNodes = new Map((live.geometry?.nodes || []).map((n) => [n.id, n]));

const onlyDesign = [...dNodes.keys()].filter((id) => !lNodes.has(id));
const onlyLive = [...lNodes.keys()].filter((id) => !dNodes.has(id));

/** 内容比较：只比"有意义的字段"（跳过坐标/尺寸/颜色这些渲染噪声） */
const MEANINGFUL = ['decision', 'task', 'label', 'type', 'arch_layer', 'description'];
const changed = [];
for (const [id, d] of dNodes) {
  const l = lNodes.get(id);
  if (!l) continue;
  const diffFields = MEANINGFUL.filter((k) => JSON.stringify(d[k] ?? null) !== JSON.stringify(l[k] ?? null));
  if (diffFields.length) changed.push({ id, fields: diffFields, design: d, live: l });
}

// 边：按 (from,to) 比
const key = (e) => `${e.from}|${e.to}`;
const dEdges = new Map((design.geometry?.edges || []).map((e) => [key(e), e]));
const lEdges = new Map((live.geometry?.edges || []).map((e) => [key(e), e]));
const eOnlyDesign = [...dEdges.keys()].filter((k) => !lEdges.has(k));
const eOnlyLive = [...lEdges.keys()].filter((k) => !dEdges.has(k));

const short = (s) => String(s).replace(/^file_src_/, '').replace(/\.ts$/, '');

/**
 * ★ 2026-10-18：`+ 只在设计侧` 的边**不能一律算"要建"**。
 *
 * 根因：`import_project` 的 import 边是**部分抓取**（已知限制）—— 它会给一条边记
 * `imports ×N` 这种聚合计数，但**会漏**（例：`task_ops → task_machine` 在
 * `src/application/design/dsl_ops/task_ops.ts:46` 明明 import 了，
 * live 侧就是没有这条边）。所以在 `live/` 里没有，不等于"设计说错了"。
 *
 * 判据（浅判，**不做完整 AST**）：读 `from` 文件的源码，看它有没有引用 `to` 的
 * 模块名 / 相对路径。三种结论：
 *   - `verified` 源码里确有引用        ⇒ **扫描遗漏**（live 漏抓）
 *   - `weak`     只有裸词命中          ⇒ **扫描遗漏（未核实）**
 *   - `none`     源码里完全找不到      ⇒ 才可能是**真要建**
 *   - `unknown`  读不到文件/判不了     ⇒ **扫描遗漏（未核实）**（★ 宁可少报）
 *
 * ★ 铁律：**宁可少报，不许把"可能要建"说成"必须建"** —— 所以 `unknown` 一律
 *   归到"扫描遗漏"，不进"真要建"。
 */
const stripExt = (p) => String(p).replace(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '');
const normPath = (p) => stripExt(path.resolve(p)).replace(/[\\/]index$/, '').toLowerCase();

/** 节点 id → 源码相对路径（优先用 description，那里存的是真路径） */
function nodePath(node) {
  const d = node?.description;
  if (typeof d === 'string' && d.includes('/') && !/\s/.test(d)) return d;
  return null;
}

/** 抓文件里出现过的模块说明符（浅正则，不建 AST） */
function importSpecs(text) {
  const specs = [];
  const re = /(?:\bfrom|\brequire|\bimport|\bexport)\s*\(?\s*(['"])([^'"\n]+)\1/g;
  for (const m of text.matchAll(re)) specs.push(m[2]);
  return specs;
}

const fileCache = new Map();
function readSrc(rel) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  let text = null;
  try {
    text = fs.readFileSync(rel, 'utf8');
  } catch {
    text = null;
  }
  fileCache.set(rel, text);
  return text;
}

/**
 * 判定一条"只在设计侧"的边：源码里 from 是否真的 import 了 to。
 * 返回 { verdict, evidence }
 */
function checkEdgeInSource(edge) {
  const label = String(edge.label || '');
  if (!label.startsWith('imports')) return { verdict: 'unknown', evidence: `非 imports 边（${label}）` };

  const fromRel = nodePath(dNodes.get(edge.from));
  const toRel = nodePath(dNodes.get(edge.to));
  if (!fromRel || !toRel) return { verdict: 'unknown', evidence: '节点无路径' };

  const text = readSrc(fromRel);
  if (text == null) return { verdict: 'unknown', evidence: '读不到源文件' };

  const toAbs = normPath(toRel);
  const toBase = path.basename(stripExt(toRel));
  const dir = path.dirname(path.resolve(fromRel));

  for (const spec of importSpecs(text)) {
    if (spec.startsWith('.')) {
      if (normPath(path.resolve(dir, spec)) === toAbs) return { verdict: 'verified', evidence: `'${spec}'` };
    } else {
      // 裸说明符（包名/别名）：比对尾段
      const tail = stripExt(spec).split('/').slice(0, 2).join('/');
      if (spec === toBase || tail.endsWith(toBase)) return { verdict: 'verified', evidence: `'${spec}'` };
    }
  }

  // 兜底：全文出现目标模块名（弱证据）
  if (new RegExp(`\\b${toBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
    return { verdict: 'weak', evidence: `裸词 ${toBase}` };
  }
  return { verdict: 'none', evidence: '' };
}

const edgeRows = eOnlyDesign.map((k) => {
  const e = dEdges.get(k);
  const { verdict, evidence } = checkEdgeInSource(e);
  return { k, e, verdict, evidence };
});
const missedEdges = edgeRows.filter((r) => r.verdict !== 'none'); // 扫描遗漏（含 unknown/weak）
const realMissing = edgeRows.filter((r) => r.verdict === 'none'); // 真要建

console.log('════ 设计侧 × 实际侧 diff ════');
console.log(`设计 ${dNodes.size} 节点 · ${dEdges.size} 边    实际 ${lNodes.size} 节点 · ${lEdges.size} 边\n`);

console.log(`+ 只在设计侧（设计了、实际还没有 ⇒ ★ 要建）：${onlyDesign.length} 个`);
for (const id of detail ? onlyDesign : onlyDesign.slice(0, 10)) console.log(`    + ${short(id)}`);

console.log(`\n- 只在实际侧（实际有、设计没收录 ⇒ ★ 要补设计）：${onlyLive.length} 个`);
for (const id of detail ? onlyLive : onlyLive.slice(0, 10)) console.log(`    - ${short(id)}`);

console.log(`\n~ 两边都有但内容不同（★ 我改过的地方 = 决策卡/标签）：${changed.length} 个`);
for (const c of detail ? changed : changed.slice(0, 12)) {
  console.log(`    ~ ${short(c.id)}   [${c.fields.join(', ')}]`);
  if (detail && c.fields.includes('decision')) {
    const ex = c.design.decision?.expectations?.length ?? 0;
    console.log(`        decision: summary ${c.design.decision?.summary ? '有' : '空'} · expectations ${ex} 条`);
  }
}

console.log(`\n边：+ ${eOnlyDesign.length} 条只在设计侧 · - ${eOnlyLive.length} 条只在实际侧`);

/** ★ 两组分开：先"扫描遗漏"（不是要建），再"真要建" */
const fmtEdge = (r) => r.k.split('|').map(short).join(' → ');
console.log(`\n  ★ + 扫描遗漏（live 未收录，但源码里确实有）：${missedEdges.length} 条   ← 不是要建`);
if (!missedEdges.length) console.log('      （无）');
for (const r of detail ? missedEdges : missedEdges.slice(0, 12)) {
  const tag = r.verdict === 'verified' ? '' : '（未核实）';
  const why = r.evidence ? `   ← ${r.evidence}` : '';
  console.log(`      + ${fmtEdge(r)}${tag}${why}`);
}
if (!detail && missedEdges.length > 12) console.log(`      … 另 ${missedEdges.length - 12} 条（--detail 看全）`);

console.log(`\n  ★ + 真要建（源码里也没有）：${realMissing.length} 条`);
if (!realMissing.length) console.log('      （无）');
for (const r of detail ? realMissing : realMissing.slice(0, 12)) console.log(`      + ${fmtEdge(r)}`);
if (!detail && realMissing.length > 12) console.log(`      … 另 ${realMissing.length - 12} 条（--detail 看全）`);

if (detail) {
  for (const k of eOnlyLive) console.log(`    - ${k.split('|').map(short).join(' → ')}`);
}

const total = dNodes.size;
const designed = [...dNodes.values()].filter((n) => n.decision).length;
console.log(`\n────────────────────────────────────`);
console.log(`进度：已设计 ${designed}/${total}（${((designed / total) * 100).toFixed(1)}%）`);
console.log(`★ 要动的地方：+ 才能建（只看"真要建"）· - 要补设计 · ~ 是我已经改过的`);
console.log(`  边里的"扫描遗漏"是 live 扫漏，**不需要动**`);

// ═══════════════════════════════════════════════════════════════
// ★★★★★ 符号级 diff（2026-10-19 结构性重写；⑥ 的唯一可靠判据）
// ═══════════════════════════════════════════════════════════════
//
// ## 第一版错在哪（都是"判据不可靠"，不是 bug）
// ① 配对键用 `name` ⇒ `server.ts` 里两处 `const resources` 被当成一个（配错对象）
// ② `type`/`interface` 比 `signature` ⇒ 两边都是 `Name()`（实测 `StandingNode()`）
//    ⇒ **永远相等** ⇒ 1,170 条被算成"一致"（★ 那是最坏的一种谎）
// ③ `const` 比 `signature` ⇒ 实际侧被截断到 60 字符（`const resources = listFeatures`）
//    ⇒ 长声明永远"不一致"（假阳性）
//
// ## 结构性的做法
// **一个符号是否"可比"，由它的 `kind` 决定**（而不是"一律比 signature"）：
// ```
// kind       可比字段            依据
// function   signature          两边都完整（AST 抽的是原文片段）
// class      signature          —— 但实测也是 Name() ⇒ 归 uncompared
// type       ✗ 不可比           两边都没有成员列表（实测 members=null）
// interface  ✗ 不可比           同上
// const      ✗ 不可比           实际侧 signature 被截断（60 字符）
// ```
// ⇒ **输出三态**：`same` / `differ` / `uncompared`，而 `uncompared` **必须显式报数**
//    （把它算进"一致"就是撒谎 —— 这是本脚本最重要的纪律）
//
// ## 配对键
// `(file, name, line)`：**同名不同 line = 两个符号**（`server.ts` 的 L99 / L129 就是实例）。
// ⇒ 若一边有 2 处、另一边 1 处，配不上的那些进 `unpaired`（不判 same/differ）。
if (argv.includes('--signature') || argv.includes('--all')) {
  // ★★ 判据只住一处：`scripts/lib/symbol-diff.mjs`。这里**只负责打印**，不重算。
  const { diffSymbols, uncomparedTotal } = await import('./lib/symbol-diff.mjs');
  const ROOT = process.cwd();
  const r = await diffSymbols({ projectDir: ROOT });
  const { scanned, same, differ, uncompared, unpaired } = r;

  const totalUncompared = uncomparedTotal(uncompared);
  console.log(`\n════ 符号级 diff ════`);
  console.log(`  扫了 ${scanned} 份设计 DB`);
  console.log(`  ✅ 可比且相同: ${same.length}`);
  console.log(`  ★★ 可比且不同: ${differ.length}   ← 这是 ⑥ 要重写的`);
  console.log(`  ⚠️  不可比（不算"一致"，也不算"不同"）: ${totalUncompared}`);
  for (const [k, n] of [...uncompared.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`       · ${k.padEnd(14)} ${n} 条 —— 两侧都没有可比内容`);
  }
  if (unpaired.length) {
    console.log(`  ⚠️  未配对（同名处数不一致）: ${unpaired.length}`);
    for (const u of unpaired.slice(0, 6)) console.log(`       · ${u.file.split('/').pop()}  ${u.name}  ← ${u.why}`);
  }
  console.log(`  · 设计有·源码没有: ${r.designOnly.length}   · 源码有·设计没有: ${r.sourceOnly.length}`);

  if (differ.length) {
    console.log('\n  ── 可比且不同（前 12）──');
    for (const t of differ.slice(0, 12)) {
      console.log(`\n  ${t.file.split('/').pop()}  ${t.name}（${t.kind}）`);
      console.log(`    - ${t.old_text.slice(0, 110)}`);
      console.log(`    + ${t.new_text.slice(0, 110)}`);
    }
    if (differ.length > 12) console.log(`\n  … 另 ${differ.length - 12} 条`);
  }

  if (process.argv.includes('--write-plan') && differ.length) {
    const out = path.join(ROOT, '.agent-io', 'refactor-plan.json');
    const targets = differ.map((t) => ({ file: t.file, old_text: t.old_text, new_text: t.new_text }));
    fs.writeFileSync(out, JSON.stringify({ feature: 'task-system-plan', targets }, null, 2));
    console.log(`\n  ✓ 已写 ${out}（${targets.length} 条）→ 落盘走：node scripts/rewrite.mjs --apply`);
  } else if (differ.length) {
    console.log('\n  ★ 零写入。加 --write-plan 写清单，或直接 node scripts/rewrite.mjs --apply');
  }
}
