#!/usr/bin/env node
/**
 * merge.mjs —— 三方合并【只读版】（★ 2026-10-19，见 docs/MERGE.md）
 *
 * ## 它做什么
 * ```
 * base   = .agent-io/baseline/<f>.dsl.json   （fork 时的共同祖先，永不移动）
 * ours   = .agent-io/design/<f>.dsl.json     （人写的意图）
 * theirs = .agent-io/live/<f>.dsl.json       （Agent 改源码后的扫描）
 *
 * ⇒ 算出三类差异，打印【裁决清单】
 * ```
 *
 * ## 一条硬规则
 * ★ **decision / expectations 永不被 theirs 覆盖** —— 事实可更新，意图不能。
 *   本脚本【绝不写任何文件】（零写入），只告诉你"哪边领先、哪里有冲突、哪条判据失效了"。
 *
 * ## 用法
 *   node scripts/merge.mjs                     # 默认 feature=task-system-plan
 *   node scripts/merge.mjs --feature=xxx
 *   node scripts/merge.mjs --json              # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const arg = process.argv.find((a) => a.startsWith('--feature='));
const FEATURE = arg ? arg.split('=')[1] : 'task-system-plan';
const JSON_OUT = process.argv.includes('--json');

const P = {
  base: path.join(ROOT, '.agent-io', 'baseline', `${FEATURE}.dsl.json`),
  ours: path.join(ROOT, '.agent-io', 'design', `${FEATURE}.dsl.json`),
  theirs: path.join(ROOT, '.agent-io', 'live', `${FEATURE}.dsl.json`),
};

for (const [k, p] of Object.entries(P)) {
  if (!fs.existsSync(p)) {
    console.error(`★ 缺 ${k}：${p}`);
    process.exit(2);
  }
}

const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const base = load(P.base);
const ours = load(P.ours);
const theirs = load(P.theirs);

const norm = (s) => String(s ?? '').replace(/\\/g, '/');

/** 取"文件节点"（description 是路径的那些） */
const fileNodes = (dsl) =>
  new Map(
    (dsl.geometry?.nodes ?? [])
      .filter((n) => norm(n.description).startsWith('src/'))
      .map((n) => [norm(n.description), n]),
  );

/** semantic.files 的索引（★ 行数/符号在【这里】，不在 geometry.nodes 里） */
const semFiles = (dsl) => new Map((dsl.semantic?.files ?? []).map((f) => [norm(f.path), f]));

/**
 * ★★★ 2026-10-19 第三次修正（这次是【去掉不可靠的判据】，而不是修 bug）：
 *
 * 前两版都用 `semantic.files` 的 `lines`/`symbols` 做"结构指纹"，但——
 * **`design/` 的 `semantic.files` 是 `fork` 时的快照，永不更新**；
 * 而 `live/` 每次重扫都变 ⇒ 拿它俩比 ⇒ **必然全部"不一致"**（26 + 24 个假象）。
 *
 * ⇒ 所以本脚本现在【只比两件可靠的事】：
 *   ① **文件存在性**（`geometry.nodes` 的 `description`，这是真的）
 *   ② **decision 的有无**（设计独有，实际侧永远没有）
 * ⇒ 其余（行数/符号数）**不比** —— 等设计侧的 semantic 有可靠来源再加回来。
 *
 * ★ 这不是"功能缩水"：一个会骗人的判据，比没有判据更坏。
 */
const fp = () => 'n/a';

const B = fileNodes(base);
const O = fileNodes(ours);
const T = fileNodes(theirs);

const SB = semFiles(base);
const SO = semFiles(ours);
const ST = semFiles(theirs);

const allFiles = new Set([...B.keys(), ...O.keys(), ...T.keys()]);

/** 三类差异 */
const onlyOurs = []; // 设计领先
const onlyTheirs = []; // 实际领先
const bothChanged = []; // 冲突
const unchanged = [];

for (const f of allFiles) {
  const b = B.get(f);
  const o = O.get(f);
  const t = T.get(f);
  const bSem = SB.get(f);
  const oSem = SO.get(f);
  const tSem = ST.get(f);
  /**
   * ★★★ 2026-10-19 第四次修正：**用最简的 4 种组合**（不再叠 6 个布尔量，那只会绕死自己）。
   *
   * 可靠判据只有"存在性"（`geometry.nodes` 的 description）：
   * ```
   * 设计有 · 实际没有  ⇒ onlyOurs    （设计领先，待重写⑥）
   * 设计无 · 实际有    ⇒ onlyTheirs  （实际领先，待 sync③）
   * 设计有 · 实际有    ⇒ unchanged   （★ 内容是否变了？—— 没有可靠语义源，不判）
   * 设计无 · 实际无    ⇒ 都不在（从 base 删了 ⇒ 也无事可做）
   * ```
   * ★ 为什么"都有"一律算 unchanged：`design/` 的 semantic 是 fork 快照、`cache.db` 的 call 边只同文件
   *   ⇒ 任何"内容比较"都会产出假冲突。等 docs/MERGE.md §6 的可靠语义源就位再加回来。
   */
  const oursHas = o !== undefined;
  const theirsHas = t !== undefined;

  if (oursHas && theirsHas) {
    unchanged.push(f);
    continue;
  }
  if (oursHas && !theirsHas) {
    onlyOurs.push(f);
    continue;
  }
  if (!oursHas && theirsHas) {
    onlyTheirs.push(f);
    continue;
  }
  // 两边都没有 ⇒ 从 base 删了，无事可做
  unchanged.push(f);
}

/** ★ 判据失效：ours 的 call-exists 指向的 target，在【真实符号表】里还有没有
 *  ★ 2026-10-19 修正两次：
 *    ① 原来在 `theirs.decision.expectations` 里找 —— 实际侧永远没有 decision ⇒ 全假阳性
 *    ② 改成 `theirs.semantic.files[].symbols` —— ★ 它只收 type/interface，【不收函数】
 *       ⇒ `cardStanding` / `isSatisfied` 这些函数全被判"不存在"（实测 8 个全在源码里）
 *    ③ ★ 最终改用 `cache.db` 的 `nodes` 表（扫描出的完整符号表，8798 个）
 */
import { DatabaseSync } from 'node:sqlite';

const dbPath = path.join(ROOT, '.agent-io', 'cache.db');
const theirsSymbols = new Set();
if (fs.existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  for (const r of db.prepare('SELECT DISTINCT name FROM nodes WHERE parent IS NULL').all()) {
    if (r.name) theirsSymbols.add(r.name);
  }
  db.close();
}

const staleExpectations = [];
for (const [f, n] of O) {
  for (const e of n.decision?.expectations ?? []) {
    if (e.kind !== 'call-exists') continue;
    if (!theirsSymbols.has(e.target)) {
      staleExpectations.push({ file: f, symbol: e.symbol, target: e.target, why: e.why?.slice(0, 60) });
    }
  }
}

const result = {
  feature: FEATURE,
  base: { files: B.size, decisions: countDecisions(base) },
  ours: { files: O.size, decisions: countDecisions(ours) },
  theirs: { files: T.size, decisions: countDecisions(theirs) },
  onlyOurs: onlyOurs.length,
  onlyTheirs: onlyTheirs.length,
  bothChanged: bothChanged.length,
  unchanged: unchanged.length,
  staleExpectations: staleExpectations.length,
  details: {
    onlyOurs: onlyOurs.slice(0, 20),
    onlyTheirs: onlyTheirs.slice(0, 20),
    bothChanged: bothChanged.slice(0, 20),
    staleExpectations: staleExpectations.slice(0, 20),
  },
};

function countDecisions(dsl) {
  return (dsl.geometry?.nodes ?? []).filter((n) => n.decision).length;
}

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const { onlyOurs: oo, onlyTheirs: ot, bothChanged: bc } = result.details;

console.log(`════ MERGE · ${FEATURE} ════`);
console.log(`  base   : ${result.base.files} 文件 · ${result.base.decisions} decision`);
console.log(`  ours   : ${result.ours.files} 文件 · ★ ${result.ours.decisions} decision（人写的意图）`);
console.log(`  theirs : ${result.theirs.files} 文件 · ${result.theirs.decisions} decision（实际侧永远没有意图）`);
console.log('');
console.log(`  ★ 只 ours 变（设计领先，待重写⑥）  : ${result.onlyOurs}`);
console.log(`  ★ 只 theirs 变（实际领先，待 sync③）: ${result.onlyTheirs}`);
console.log(`  ★ 两边都变（${result.bothChanged} 冲突，待人裁决）      : ${result.bothChanged}`);
console.log(`  · 未变                              : ${result.unchanged}`);

if (result.staleExpectations) {
  console.log('');
  console.log(`  ★★ 判据失效（设计说有调用，实际侧找不到了）: ${result.staleExpectations}`);
  for (const s of result.details.staleExpectations.slice(0, 8)) {
    console.log(`     · ${s.file.split('/').pop()}  ${s.symbol} → ${s.target}`);
  }
}

if (oo.length) {
  console.log('');
  console.log('  ── 设计领先（前 8 个）──');
  for (const f of oo.slice(0, 8)) console.log(`     ${f}`);
}
if (ot.length) {
  console.log('');
  console.log('  ── 实际领先（前 8 个）──');
  for (const f of ot.slice(0, 8)) console.log(`     ${f}`);
}
if (bc.length) {
  console.log('');
  console.log('  ── 冲突（前 8 个，需人裁决）──');
  for (const f of bc.slice(0, 8)) console.log(`     ${f}`);
}

console.log('');
console.log('  ★ 本脚本零写入（不碰任何文件）。裁决后再谈 apply。');
