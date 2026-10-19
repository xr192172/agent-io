#!/usr/bin/env node
/**
 * fork-design —— ★ **从实际侧 fork 出设计侧**（像 `git checkout -b`）。
 *
 * ## 语义（用户 2026-10-18 明确）
 * > "直接像 Git 那样创建一个新分支不行吗？你也创建一个一模一样的 DB 加设计 DSL，然后一模一样。"
 *
 * ⇒ **fork 三份，都从实际侧来**：
 * | 设计侧 | 从哪 fork | 怎么 fork |
 * |---|---|---|
 * | `design/<f>.dsl.json` | `live/<f>.dsl.json` | 结构复制（★ 已有则**不覆盖**，除非 --force） |
 * | `<node>.contract.ts`（符号） | `cache.db.nodes` | 调 `gen-contracts.mjs` |
 * | `<node>.calls.json`（调用） | `cache.db.edges(kind='call')` | ★ 本脚本生成（**全量**） |
 *
 * ## ★★★ 为什么 calls 要【全量】（与 §8 的"只写在意的"相反）
 * "只写在意的"是**手写**时的省事做法 —— 而手写一定漏。
 * **fork 的做法是"全量复制，然后改"**：
 *   · fork 时：**实际有什么调用，设计就有什么**（一模一样）；
 *   · 改的时候：**删掉不该有的 / 加上该有的** ⇒ ★ **"删了哪些"本身也成为可表达的差异**。
 * ⇒ 所以本脚本生成的 `calls.json` 带 `calls`（全量）+ `removed`（空，等人删）。
 *
 * 用法：
 *   node scripts/fork-design.mjs            # 已有 design 则不覆盖，只补契约/调用
 *   node scripts/fork-design.mjs --force    # 连 design 结构也重 fork（★ 会丢手写 decision，慎用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const FEATURE = 'task-system-plan';
const DESIGN = path.join('.agent-io', 'design', `${FEATURE}.dsl.json`);
const LIVE = path.join('.agent-io', 'live', `${FEATURE}.dsl.json`);
const OUT_DIR = path.join('certs', 'design-db');
const DB = path.join('.agent-io', 'cache.db');
const force = process.argv.includes('--force');
const log = [];

// ═══ ① 结构 fork：live → design ═══
if (!fs.existsSync(DESIGN) || force) {
  if (!fs.existsSync(LIVE)) {
    console.error(`★ 没有实际侧：${LIVE} 不存在 ⇒ 先跑 import_project`);
    process.exit(2);
  }
  const live = JSON.parse(fs.readFileSync(LIVE, 'utf8'));
  const dsl = {
    ...live,
    _forked_from: { source: LIVE, at: new Date().toISOString(), note: '★ 设计侧 = 实际侧的完整副本（图纸）' },
  };
  fs.mkdirSync(path.dirname(DESIGN), { recursive: true });
  fs.writeFileSync(DESIGN, JSON.stringify(dsl, null, 2) + '\n');
  log.push(`结构 fork：${LIVE} → ${DESIGN}（${(live.geometry?.nodes ?? []).length} 节点）`);
} else {
  log.push(`结构 fork：跳过（design 已存在；--force 可重 fork，但会丢手写 decision）`);
}

// ═══ ② 符号 fork：cache.db.nodes → contract.ts（复用生成器）═══
try {
  const out = execFileSync(process.execPath, ['scripts/gen-contracts.mjs'], { encoding: 'utf8' });
  log.push('符号 fork：' + out.trim().split('\n').filter(Boolean).pop());
} catch (e) {
  log.push('★ 符号 fork 失败：' + String(e.message).split('\n')[0]);
}

// ═══ ③ 调用 fork：cache.db.edges(kind='call') → <node>.calls.json（全量）═══
const design = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
/**
 * ★★★ **全量**（用户 2026-10-18 纠正）：**每个 file 节点都生成一份 calls.json**，不是只给"有 decision 的"。
 *
 * ## 为什么必须全量
 * > "你写设计的时候也要和实际相结合呀，不然的话你设计出来的东西万一依赖什么的对不上呢？"
 * ⇒ 只 fork 8 个文件 ⇒ **另外 633 个文件的依赖在设计侧是空白** ⇒
 *   改那 8 个的时候，**根本不知道它们依赖谁、被谁依赖** ⇒ 设计出来的东西会对不上。
 * ★ **"份数多"不是问题，"漏"才是问题。**
 */
const designFileSet = new Set(
  (design.geometry?.nodes ?? [])
    .filter((n) => n.type === 'file' && n.description)
    .map((n) => String(n.description).replace(/\\/g, '/')),
);

const db = new DatabaseSync(DB, { readOnly: true });
const callRows = db.prepare(`SELECT source, target FROM edges WHERE kind = 'call'`).all();
db.close();

/** 按"源文件"分组：只收设计侧收录的文件 */
const byFile = new Map();
let total = 0;
for (const r of callRows) {
  const [srcFile] = String(r.source).split('#');
  const f = srcFile.replace(/\\/g, '/');
  if (!designFileSet.has(f)) continue;
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push({ from: String(r.source).replace(/\\/g, '/'), to: String(r.target).replace(/\\/g, '/') });
  total++;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const slug = (p) => p.replace(/^src\//, '').replace(/\.ts$/, '').replace(/\//g, '-');
let written = 0;
let keptIntents = 0;
for (const [file, calls] of byFile) {
  const outFile = path.join(OUT_DIR, `${slug(file)}.calls.json`);

  // ★★★ 2026-10-18（用户指出）：**fork 不许覆盖 `dep` 的增量**。
  //   否则"重写"就失效了 —— 重写要反复跑 fork（代码变了就得重算实际），
  //   而一跑就把"设计说必须有 / 不该有"全冲掉。
  //
  //   区分口径：**fork 复制的不带 `why`；`dep` 加/删的带 `why`**（那是人的意图）。
  //   ⇒ 新 `calls` = 实际全量 ∪ 旧文件里带 `why` 的（去重）
  //   ⇒ 新 `removed` = 旧文件的 `removed` 原样保留（"设计说不要"也是意图）
  let oldCalls = [];
  let oldRemoved = [];
  if (fs.existsSync(outFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      oldCalls = (old.calls ?? []).filter((c) => c.why); // ★ 只留"人的意图"
      oldRemoved = old.removed ?? [];
      keptIntents += oldCalls.length;
    } catch {
      /* 旧文件坏了 ⇒ 当没有（fork 会重建它） */
    }
  }

  const seen = new Set(calls.map((c) => `${c.from}|${c.to}`));
  const merged = [...calls];
  for (const c of oldCalls) {
    const k = `${c.from}|${c.to}`;
    if (!seen.has(k)) {
      merged.push(c); // ★ 设计说"必须有"、实际没有 ⇒ 保留（它会红，这才是"该接线"）
      seen.add(k);
    }
  }

  const out = {
    '//': `★★★ 设计侧契约（结构级·调用）—— ${file}（**实际全量 + 设计意图增量**）`,
    '//forked_from': {
      db: DB,
      at: new Date().toISOString(),
      note: '★ calls = 实际全量 ∪ 带 why 的（dep 加的）· removed = 原样保留（dep 删的）',
    },
    '//how': '对拍用 scripts/contract-calls.mjs；calls 里"实际没有"的会红（= 该接线）',
    calls: merged.sort((a, b) => (a.to < b.to ? -1 : 1)),
    removed: oldRemoved,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  written++;
}
log.push(`调用 fork：${written} 个文件 · ${total} 条实际边 + ${keptIntents} 条设计意图（保留）`);

console.log('════ fork 设计侧 ════');
for (const l of log) console.log('  · ' + l);
console.log('\n★ 三份都在 certs/design-db/ 与 .agent-io/design/ 下 —— 已"一模一样"，可以开始改。');
