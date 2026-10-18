#!/usr/bin/env node
/**
 * contract-calls —— 设计侧契约（结构级·调用）：**设计 × 实际**的对拍器。
 *
 * ★★★ 2026-10-18 **重写**：此前它读两种格式（手写的 `required` + fork 的 `calls`），
 * 于是"为了兼容旧格式"把自己做成了半吊子 —— 那正是"在旧东西上打补丁"。
 * ⇒ 现在**只认一种格式**，旧的手写契约（`task-ops.calls.json`）已删。
 *
 * ## 唯一的格式（`certs/design-contracts/<file>.calls.json`）
 * ```json
 * {
 *   "calls":   [ { "from":"src/a.ts#f", "to":"src/b.ts#g", "why":"…", "debt":"A1" } ],
 *   "removed": [ { "from":…, "to":…, "why":"设计说不要" } ]
 * }
 * ```
 * - `calls`   = **设计说"必须有"**。实际没有 ⇒ ★ **红**（缺了就是缺了；带 `debt` 的标"已挂账"，但仍红）
 * - `removed` = **设计说"不该有"**。实际还有 ⇒ ★ **红**（该拆没拆）
 *
 * ## ★ 为什么不需要 `expected_missing` 那一块
 * "设计说该有、实际没有" **就是红**。再单开一块"已知会缺"= **给红开豁免**，
 * 而红的意义正是"这里要动"。真要标"这是已知债"，写在 `calls[i].debt` 上即可（仍红，只带编号）。
 *
 * ## 口径从哪来
 * 实际 = `cache.db` 的 `edges(kind='call')`（7528 条，`source/target` 形如 `path#symbol`）。
 * 设计 = `certs/design-contracts/*.calls.json`（全量 fork 自实际 + `dep` 加/删的增量）。
 *
 * 用法：`node scripts/contract-calls.mjs [--json] [--selftest]`
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIR = path.join('certs', 'design-contracts');
const DB = path.join('.agent-io', 'cache.db');

const norm = (s) => String(s).replace(/\\/g, '/');
const short = (s) => String(s).replace(/^src\//, '').replace(/\.ts#/, '#');

function loadDesign() {
  const calls = [];
  const removed = [];
  const runtimeEntries = [];
  for (const f of fs.readdirSync(DIR)) {
    if (!f.endsWith('.calls.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const c of j.calls ?? []) calls.push({ ...c, _file: f });
    for (const c of j.removed ?? []) removed.push({ ...c, _file: f });
    for (const e of j.runtime_entries ?? []) runtimeEntries.push({ ...e, _file: f });
  }
  return { calls, removed, runtimeEntries };
}

function loadActual() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare(`SELECT source, target FROM edges WHERE kind = 'call'`).all();
  db.close();
  const set = new Set();
  for (const r of rows) set.add(`${norm(r.source)}|${norm(r.target)}`);
  return { set, count: rows.length };
}

const has = (set, c) => set.has(`${norm(c.from)}|${norm(c.to)}`);

function main() {
  const argv = process.argv.slice(2);
  const selftest = argv.includes('--selftest');
  const asJson = argv.includes('--json');

  const design = loadDesign();
  const actual = loadActual();

  // ★ 自检：一个不存在的调用必须判"没有"
  if (selftest) {
    const fake = { from: 'src/__nonexistent__.ts#__nope__', to: 'src/__nonexistent__.ts#__nope__' };
    if (has(actual.set, fake)) {
      console.error('★ 自检失败：不存在的调用被判"有" ⇒ 检查器坏了');
      process.exit(2);
    }
    console.log(`★ 自检：伪造调用 ⇒ 正确判定为「没有」✓（实有调用边 ${actual.count} 条）`);
    return;
  }

  const missing = design.calls.filter((c) => !has(actual.set, c)); // 设计说必须有，实际没有
  const unexpected = design.removed.filter((c) => has(actual.set, c)); // 设计说不要，实际还有
  const ok = design.calls.length - missing.length;

  // ── 运行时入口（★ calls 表达不了的那一层）──────────────────────────
  // 判据只有两种，都能机器判：
  //   env    ⇒ src/ 里必须存在 `process.env.<NAME> =`（有人赋值）
  //   script ⇒ package.json 的 scripts 里必须有这个键（有人跑）
  const srcText = (() => {
    const out = [];
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.(ts|mjs|js)$/.test(f.name)) out.push(fs.readFileSync(p, 'utf8'));
      }
    };
    try {
      walk('src');
    } catch {
      /* 没有 src 就当空 */
    }
    return out.join('\n');
  })();
  const pkgScripts = (() => {
    try {
      return JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts ?? {};
    } catch {
      return {};
    }
  })();

  const entriesMissing = [];
  for (const e of design.runtimeEntries) {
    if (e.kind === 'env') {
      // ★ 判【有读】，不判【有赋值】：赋值该由宿主做（本仓自己设身份 = 自报家门）
      const re = new RegExp(`process\\.env\\.${e.target}\\b`);
      if (!re.test(srcText)) entriesMissing.push(e);
    } else if (e.kind === 'script') {
      if (!(e.target in pkgScripts)) entriesMissing.push(e);
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ actual: actual.count, design: design.calls.length, ok, missing, unexpected }, null, 2));
  } else {
    console.log('════ 契约 · 结构级（调用）════');
    console.log(
      `实际调用边 ${actual.count} 条 · 设计声明 ${design.calls.length} 条 · 设计说"不要"的 ${design.removed.length} 条\n`,
    );

    console.log(`✓ 成立 ${ok} / ${design.calls.length}`);
    if (missing.length) {
      console.log(`\n★★ 设计说必须有、实际没有：${missing.length} 条（★ 这就是"该接线"）`);
      for (const c of missing) {
        console.log(`  ✗ ${short(c.from)} → ${short(c.to)}${c.debt ? `  [已挂账: ${c.debt}]` : ''}`);
        if (c.why) console.log(`      为什么：${String(c.why).slice(0, 70)}`);
      }
    }
    if (unexpected.length) {
      console.log(`\n★★ 设计说"不该有"、实际还有：${unexpected.length} 条（★ 这就是"该拆"）`);
      for (const c of unexpected) console.log(`  ✗ ${short(c.from)} → ${short(c.to)}  ← 该拆`);
    }
    if (!missing.length && !unexpected.length) console.log('\n✓ 设计 × 实际：全部对齐');

    // ── 运行时入口 ──────────────────────────────────────────
    if (design.runtimeEntries.length) {
      const okEntries = design.runtimeEntries.length - entriesMissing.length;
      console.log(
        `\n── 运行时入口（calls 表达不了的那层）── ${okEntries} / ${design.runtimeEntries.length}`,
      );
      for (const e of entriesMissing) {
        console.log(`  ✗ ${e.kind}: ${e.target}  ← 入口不存在${e.debt ? `  [已挂账: ${e.debt}]` : ''}`);
        if (e.why) console.log(`      为什么：${String(e.why).slice(0, 80)}`);
        if (e.note) console.log(`      备注：${String(e.note).slice(0, 100)}`);
      }
      for (const e of design.runtimeEntries) {
        if (!entriesMissing.includes(e)) console.log(`  ✓ ${e.kind}: ${e.target}`);
      }
    }
  }

  process.exit(missing.length || unexpected.length ? 1 : 0);
}

main();
