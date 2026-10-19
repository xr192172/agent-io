#!/usr/bin/env node
/**
 * merge.mjs —— 三方合并【判定版】（★ 2026-10-19 第五次修正：从「存在性」升级到「内容」）
 *
 * ## 它做什么
 * ```
 * base   = .agent-io/baseline/<f>.dsl.json   （fork 时的共同祖先，★ 永不移动）
 * ours   = .agent-io/design/<f>.dsl.json     （人写的意图）
 * theirs = .agent-io/live/<f>.dsl.json       （源码改动后的扫描）
 * ```
 * 对**每个文件节点**做真正的三方判定，产出**待裁清单**。**零写入。**
 *
 * ## ★★★ 为什么必须改（前四版的病）
 * ① 只比「有没有这个文件」⇒ **37 个内容被改过的节点，一个都没报出来**（看起来在工作，实际什么都没判）
 * ② `startsWith('src/')` 把 `certs/` `scripts/` `third_party/` 的 **178 个文件（35%）直接排除**
 *    ⇒ 实测 `scripts/merge.mjs` 在 live 里、design 里没有，而 merge 报「0 差异」
 * ③ 「都有 = 未变」的写法把**内容变化**吞掉了
 *
 * ## 判据（一条，别加第二个口径）
 * 每一侧相对 base 只有三种状态：`absent` / `same` / `changed`。
 * 两边互相比较 ⇒ 9 种组合，归成 5 类（见 `judge()`）。
 * **内容** = 节点上「两边本来就该有」的字段；`decision` / `task` **不参与**
 * （它们天然只住设计侧，参与比较的话 38 个节点全会假"设计改过"）。
 *
 * ## ★ 它为什么不做「合并」
 * 用户 2026-10-19 裁定：*静默合并 = 既没协作、也没理由、还绕过任务系统*。
 * ⇒ 本脚本**只判、只列**，把每条差异变成一条**待裁项**（带"谁动的/动了几处/建议怎么办"）。
 *   真正落地必须走：决策卡（理由）→ 任务（谁做）→ ⑥ 回写。
 *
 * ## 用法
 *   node scripts/merge.mjs                  # 全量三方判定 + 待裁清单
 *   node scripts/merge.mjs --json           # 机器可读（给后续提案/任务用）
 *   node scripts/merge.mjs --dir=src        # 只看某目录（默认全量，不再默认 src/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const FEATURE = argOf('feature') ?? 'task-system-plan';
const DIR = argOf('dir'); // 可选：只看某前缀
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

/**
 * ★ 参与比较的字段：**两边本来就该有**的结构事实。
 * 不含 `decision` / `task`（只住设计侧）、不含 `x/y/width/height`（布局不是内容）。
 */
const CONTENT_FIELDS = ['label', 'type', 'status', 'description', 'content', 'attributes', 'sub_dsl'];

/**
 * ★★★ `label` 是**混合量**，比之前必须剥掉派生部分。
 *
 * 实测形态：`"node_ops.ts · 2 APIs"` / `"节点的写入端"` / `"漂移巡检（live 每次重算后跑）"`。
 * 前者的 `· 2 APIs` 是**派生**的（符号数变了它就变），后者才是**人写的**。
 * ⇒ 不剥就把「实际侧新增了一个函数」误报成「设计侧改过」——
 *   而"符号数变了"是 `rewrite` / `design-diff` 的职责，不是 merge 的。
 */
const humanLabel = (n) => String(n?.label ?? '').replace(/\s*·\s*\d+\s*APIs?\s*$/i, '').trim();

const fp = (n) =>
  n ? JSON.stringify(CONTENT_FIELDS.map((k) => (k === 'label' ? humanLabel(n) : (n[k] ?? null)))) : null;
const changedFields = (a, b) =>
  CONTENT_FIELDS.filter(
    (k) => JSON.stringify(k === 'label' ? humanLabel(a) : (a?.[k] ?? null)) !== JSON.stringify(k === 'label' ? humanLabel(b) : (b?.[k] ?? null)),
  );
function fileNodes(dsl) {
  const m = new Map();
  for (const n of dsl.geometry?.nodes ?? []) {
    if (n.type !== 'file') continue;
    const p = norm(n.description);
    if (p) m.set(p, n);
  }
  return m;
}

const B = fileNodes(base);
const O = fileNodes(ours);
const T = fileNodes(theirs);

const allFiles = [...new Set([...B.keys(), ...O.keys(), ...T.keys()])]
  .filter((f) => !DIR || f.startsWith(DIR))
  .sort();

/**
 * 三方判定 —— 每一侧相对 base 的三种状态，组合成 5 类。
 *
 * ```
 *               ours absent | ours same | ours changed
 * theirs absent    gone         oursOnly     oursOnly     ← 设计侧要删（⑥ 落地）
 * theirs same      onlyTheirs   unchanged    designAhead
 * theirs changed   onlyTheirs   actualAhead  CONFLICT     ← 都动了
 * ```
 * ★ `ours changed && theirs changed && fp(ours)===fp(theirs)` ⇒ `converged`（两边各自改成了同一个结果）
 */
function judge(f) {
  const b = B.get(f) ?? null;
  const o = O.get(f) ?? null;
  const t = T.get(f) ?? null;
  const fb = fp(b);
  const fo = fp(o);
  const ft = fp(t);

  /**
   * ★★★ 先判「有没有共同祖先」—— fork 之后才出现的文件，**谈不上"谁改的"**。
   * 实测踩到：`board/pool.ts` 在 baseline 里不存在，design 和 live 都有 ⇒
   * 前四版逻辑判成「两边都改且不同 = 冲突」，实际是「两边各自新增」。
   * ⇒ `base` 缺位时只判"新增"，判不了"改动"。
   */
  if (!b) {
    if (o && !t) return { kind: 'onlyOurs', os: 'changed', ts: 'absent' };
    if (!o && t) return { kind: 'onlyTheirs', os: 'absent', ts: 'changed' };
    if (o && t) return { kind: fo === ft ? 'converged' : 'bothAdded', os: 'changed', ts: 'changed' };
    return { kind: 'gone', os: 'absent', ts: 'absent' };
  }

  const os = o ? (fo === fb ? 'same' : 'changed') : 'absent';
  const ts = t ? (ft === fb ? 'same' : 'changed') : 'absent';

  if (!o && !t) return { kind: 'gone', os, ts };
  // 设计侧没有这个文件
  //   base 有、实际有 ⇒ 设计删了（sync 清的孤儿）⇒ designDeleted
  //   base 没有、实际有 ⇒ 实际新增 ⇒ onlyTheirs
  if (!o) return { kind: b ? 'designDeleted' : 'onlyTheirs', os, ts };
  // 实际侧没有这个文件
  //   base 有、设计有 ⇒ 实际删了 ⇒ actualDeleted
  //   base 没有、设计有 ⇒ 设计新增 ⇒ onlyOurs
  if (!t) return { kind: b ? 'actualDeleted' : 'onlyOurs', os, ts };

  if (os === 'same' && ts === 'same') return { kind: 'unchanged', os, ts };
  if (os === 'changed' && ts === 'same') return { kind: 'designAhead', os, ts };
  if (os === 'same' && ts === 'changed') return { kind: 'actualAhead', os, ts };
  // 两边都 changed
  if (fo === ft) return { kind: 'converged', os, ts };
  return { kind: 'conflict', os, ts };
}

const buckets = {
  designAhead: [],
  actualAhead: [],
  conflict: [],
  onlyOurs: [],
  onlyTheirs: [],
  designDeleted: [],
  actualDeleted: [],
  converged: [],
  bothAdded: [],
  unchanged: [],
  gone: [],
};

for (const f of allFiles) {
  const v = judge(f);
  const b = B.get(f);
  const o = O.get(f);
  const t = T.get(f);
  const rec = {
    file: f,
    kind: v.kind,
    hasIntent: Boolean(o?.decision),
    oursChangedFields: changedFields(o, b),
    theirsChangedFields: changedFields(t, b),
  };
  (buckets[v.kind] ?? buckets.unchanged).push(rec);
}

/** 判据失效：设计说 call-exists 的 target，在真实符号表里还有没有 */
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
  if (DIR && !f.startsWith(DIR)) continue;
  for (const e of n.decision?.expectations ?? []) {
    if (e.kind !== 'call-exists') continue;
    if (!theirsSymbols.has(e.target)) {
      staleExpectations.push({ file: f, symbol: e.symbol, target: e.target, why: String(e.why ?? '').slice(0, 60) });
    }
  }
}

const count = (k) => buckets[k].length;
const result = {
  feature: FEATURE,
  dir: DIR ?? null,
  files: { base: B.size, ours: O.size, theirs: T.size, union: allFiles.length },
  counts: {
    designAhead: count('designAhead'),
    actualAhead: count('actualAhead'),
    conflict: count('conflict'),
    onlyOurs: count('onlyOurs'),
    onlyTheirs: count('onlyTheirs'),
    designDeleted: count('designDeleted'),
    actualDeleted: count('actualDeleted'),
    converged: count('converged'),
    bothAdded: count('bothAdded'),
    unchanged: count('unchanged'),
    gone: count('gone'),
    staleExpectations: staleExpectations.length,
  },
  /** ★ 待裁项：需要人/Agent 决定「跟不跟、删不删」的那些 */
  pending: [...buckets.conflict, ...buckets.actualAhead, ...buckets.actualDeleted, ...buckets.onlyTheirs].slice(0, 200),
  details: {
    designAhead: buckets.designAhead.slice(0, 20),
    staleExpectations: staleExpectations.slice(0, 20),
  },
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const c = result.counts;
console.log(`════ MERGE · ${FEATURE}${DIR ? ` · ${DIR}` : ''} ════`);
console.log(`  base ${result.files.base} · ours ${result.files.ours} · theirs ${result.files.theirs} · 并集 ${result.files.union} 个文件节点`);
console.log('');
console.log('  ── 设计侧要落地（⑥ 待重写，可直接做）──');
console.log(`  设计改了内容          ${c.designAhead}`);
console.log(`  设计新增（实际没有）  ${c.onlyOurs}`);
console.log(`  设计删了（实际还在）  ${c.designDeleted}`);
console.log('');
console.log('  ── ★ 待裁（不能自动合并：要么缺理由，要么两边冲突）──');
console.log(`  ★★ 两边都改了且不同  ${c.conflict}   ← 真冲突，必须人裁`);
console.log(`  ★  实际改了（设计没动）${c.actualAhead}   ← 要不要回流进设计？`);
console.log(`  ★  实际新增（设计没有）${c.onlyTheirs}   ← 要不要进设计？`);
console.log(`  ★  实际删了（设计还有）${c.actualDeleted}   ← 设计该不该跟着删？`);
console.log('');
console.log(`  · 两边改成同一结果      ${c.converged}`);
console.log(`  · fork 后新增（两边都有）${c.bothAdded}   ← 无共同祖先，谈不上冲突`);
console.log(`  · 未变                 ${c.unchanged}`);
console.log('');

if (c.staleExpectations) {
  console.log(`  ★★ 判据失效（设计说有调用，实际侧找不到了）：${c.staleExpectations}`);
  for (const s of result.details.staleExpectations.slice(0, 8)) {
    console.log(`     · ${s.file.split('/').pop()}  ${s.symbol} → ${s.target}`);
  }
  console.log('');
}

const show = (label, arr, note) => {
  if (!arr.length) return;
  console.log(`  ── ${label}（前 ${Math.min(8, arr.length)} / ${arr.length}）──`);
  for (const r of arr.slice(0, 8)) {
    const f = r.oursChangedFields?.length ? ` [设计动:${r.oursChangedFields.join(',')}]` : '';
    const t = r.theirsChangedFields?.length ? ` [实际动:${r.theirsChangedFields.join(',')}]` : '';
    console.log(`     ${r.file}${f}${t}${r.hasIntent ? ' ★有意图' : ''}`);
  }
  if (note) console.log(`     ${note}`);
  console.log('');
};

show('真冲突（两边都改）', buckets.conflict, '★ 每条都要人裁：留设计？跟实际？还是各改一半？');
show('实际领先（设计没动）', buckets.actualAhead, '★ 回流要理由：为什么设计该跟着变？');
show('实际新增（设计没有）', buckets.onlyTheirs, '★ 是新功能漏设计，还是本来就不该进设计？');
show('实际删了（设计还有）', buckets.actualDeleted, '★ 设计该不该跟着删？删要走 archive，不是直接抹。');
show('设计领先（可直接 ⑥ 落地）', buckets.designAhead);

console.log('  ★ 本脚本零写入。');
console.log('  ★ 待裁项不是"合并结果"，是"要办的事"——每一条落地都要：决策卡（理由）→ 任务（谁做）。');
