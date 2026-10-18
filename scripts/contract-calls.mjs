#!/usr/bin/env node
/**
 * contract-calls —— 设计侧契约（结构级）：**调用关系**对拍器。
 *
 * ## 它判什么（tsc 判不了的那一层）
 * `tsc` 契约只能判「符号存在 / 签名兼容 / 用法成立」——★ 它**判不了"谁在真实路径上调它"**。
 * 于是 A7 那种死码（`assertSourceWriteRegisteredFor` 建好但生产写链不调）、A1（`patrolDrift` 零调用方）、
 * B5（`renderMicro` 零 src 调用）**在 tsc 眼里全是绿的**。
 *
 * ## 三个方向都判（★ 缺一个方向就会漏一半）
 * | 段 | 问什么 | 缺了怎么办 |
 * |---|---|---|
 * | `required` | 设计说【这条调用必须成立】 | **exit 1** |
 * | `expected_missing` | 设计说【该有但目前没有】（正向） | 符合预期（挂债）；★ 有了 ⇒ 提醒销账 |
 * | `expected_callers` | 设计说【这个函数必须有人调】（**反向**） | 符合预期（挂债）；★ 有了 ⇒ 提醒销账 |
 *
 * ★★ 第三个方向是必需的：**"零调用方"这件事，正向的 (from,to) 根本写不出来** ——
 *   因为 `from` 不存在。这正是 D8 的另一半。
 *
 * ## 为什么这个检查器不容易出洞
 * 它只做两件事：① 集合包含 ② 计数。没有键名猜、没有正则匹配 JSON、没有子树排除。
 * ⇒ `--selftest` 能直接证伪它（伪造一个不存在的调用 ⇒ 必须判"不存在"）。
 *
 * 用法：
 *   node scripts/contract-calls.mjs                 # 全跑
 *   node scripts/contract-calls.mjs --selftest      # ★ 自检：检查器能坏
 *   node scripts/contract-calls.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const CONTRACT = 'certs/design-contracts/task-ops.calls.json';
const DB = path.join('.agent-io', 'cache.db');

const norm = (s) => String(s).replace(/\\/g, '/');
const short = (s) => String(s).replace(/^src\//, '').replace(/\.ts#/, '#');

/** 从 cache.db 读全部调用边（source/target 形如 `path#symbol`），并算出每个 target 的入度 */
function loadActual() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare(`SELECT source, target FROM edges WHERE kind = 'call'`).all();
  db.close();
  const set = new Set();
  const inDeg = new Map();
  for (const r of rows) {
    const from = norm(r.source);
    const to = norm(r.target);
    set.add(`${from}|${to}`);
    inDeg.set(to, (inDeg.get(to) || 0) + 1);
  }
  return { set, inDeg, count: rows.length };
}

const has = (set, from, to) => set.has(`${norm(from)}|${norm(to)}`);
const callersOf = (inDeg, target) => inDeg.get(norm(target)) || 0;

function main() {
  const argv = process.argv.slice(2);
  const selftest = argv.includes('--selftest');
  const asJson = argv.includes('--json');

  const c = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
  const { set, inDeg, count } = loadActual();

  // ★ 自检：伪造的调用必须判"不存在"；伪造的 target 入度必须为 0
  if (selftest) {
    const fake = 'src/__nonexistent__.ts#__nope__';
    if (has(set, fake, fake) || callersOf(inDeg, fake) !== 0) {
      console.error('★ 自检失败：不存在的调用/入度被判成"有" ⇒ 检查器坏了');
      process.exit(2);
    }
    console.log(`★ 自检：伪造调用 ${fake} ⇒ 正确判定为「不存在 · 入度 0」✓（实有调用边 ${count} 条）`);
    return;
  }

  const missingRequired = (c.required || []).filter((r) => !has(set, r.from, r.to));

  const stillMissing = [];
  const nowPresent = [];
  for (const r of c.expected_missing || []) (has(set, r.from, r.to) ? nowPresent : stillMissing).push(r);

  const stillNoCaller = [];
  const nowHasCaller = [];
  for (const r of c.expected_callers || []) {
    const n = callersOf(inDeg, r.target);
    (n === 0 ? stillNoCaller : nowHasCaller).push({ ...r, n });
  }

  if (asJson) {
    console.log(
      JSON.stringify({ total: count, missingRequired, stillMissing, nowPresent, stillNoCaller, nowHasCaller }, null, 2),
    );
  } else {
    console.log('════ 契约 · 结构级（调用关系）════');
    console.log(
      `实际调用边 ${count} 条 · required ${(c.required || []).length} · ` +
        `expected_missing ${(c.expected_missing || []).length} · expected_callers ${(c.expected_callers || []).length}\n`,
    );

    if (missingRequired.length) {
      console.log(`★★ required 缺 ${missingRequired.length} 条（设计说必须有，实际没有）：`);
      for (const r of missingRequired) console.log(`  ✗ ${short(r.from)} → ${short(r.to)}\n      为什么：${r.why}`);
    } else {
      console.log(`✓ required ${(c.required || []).length} 条全部成立`);
    }

    if (stillMissing.length) {
      console.log(`\n★ 正向挂债（该有这条调用、目前没有）：${stillMissing.length} 条`);
      for (const r of stillMissing) console.log(`  ⋯ ${short(r.from)} → ${short(r.to)}  [${r.debt}]`);
    }
    if (stillNoCaller.length) {
      console.log(`\n★ 反向挂债（这个函数必须有人调、目前零调用方）：${stillNoCaller.length} 条`);
      for (const r of stillNoCaller) console.log(`  ⋯ ${short(r.target)}  ← 入度 0  [${r.debt}]`);
    }

    if (nowPresent.length || nowHasCaller.length) {
      console.log(`\n★★★ 这些债【已经还了】—— 该销账了：`);
      for (const r of nowPresent) console.log(`  ✓ ${short(r.from)} → ${short(r.to)}  [${r.debt}]`);
      for (const r of nowHasCaller) console.log(`  ✓ ${short(r.target)}  ← 入度 ${r.n}  [${r.debt}]`);
    }
  }

  if (missingRequired.length) process.exit(1);
  process.exit(0);
}

main();
