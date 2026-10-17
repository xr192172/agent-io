#!/usr/bin/env node
/**
 * contract-calls —— 设计侧契约（结构级）：**调用关系**对拍器。
 *
 * ## 它判什么（tsc 判不了的那一层）
 * `tsc` 契约只能判「符号存在 / 签名兼容 / 用法成立」——★ 它**判不了"谁在真实路径上调它"**。
 * 于是 A7 那种死码（`assertSourceWriteRegisteredFor` 零调用）、A1（`patrolDrift` 零调用）、
 * B5（`renderMicro` 零 src 调用）**在 tsc 眼里全是绿的**。
 *
 * ⇒ 本脚本把这层补上：**设计声明的调用 × `cache.db` 的 `edges(kind='call')`**，逐条比。
 *
 * ## 两段语义（★ 债要显式）
 * - `required`：设计说【必须成立】。缺一条 ⇒ **exit 1**。
 * - `expected_missing`：设计说【应该成立但目前没有】—— 显式挂债。
 *   ★ 缺了 = 符合预期（不红）；**如果它突然有了 ⇒ 提醒"该销账了"**（免得债被悄悄还掉而账上还挂着）。
 *
 * ## 为什么这个检查器不会像 plan-assertions 那样出洞
 * 它只做一件事：**集合包含**（`(from,to)` 是否在 `edges.kind='call'` 的集合里）。
 * 没有键名猜、没有正则匹配 JSON、没有"子树排除" ⇒ 它能被反例直接证伪（见 --selftest）。
 *
 * 用法：
 *   node scripts/contract-calls.mjs                # 默认：比 required + expected_missing
 *   node scripts/contract-calls.mjs --selftest      # ★ 自检：故意造一个不存在的调用，必须报红
 *   node scripts/contract-calls.mjs --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const CONTRACT = 'certs/design-contracts/task-ops.calls.json';
const DB = path.join('.agent-io', 'cache.db');

function loadContract() {
  return JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
}

/** 从 cache.db 读全部调用边（source/target 形如 `path#symbol`） */
function loadActualCalls() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare(`SELECT source, target, line FROM edges WHERE kind = 'call'`).all();
  db.close();
  const set = new Set();
  for (const r of rows) set.add(`${r.source}|${r.target}`);
  return { set, count: rows.length };
}

/** 归一：把 `a/b/c.ts#f` 的路径分隔符统一成 / */
const norm = (s) => String(s).replace(/\\/g, '/');

function has(set, from, to) {
  return set.has(`${norm(from)}|${norm(to)}`);
}

function main() {
  const argv = process.argv.slice(2);
  const selftest = argv.includes('--selftest');
  const asJson = argv.includes('--json');

  const c = loadContract();
  const { set, count } = loadActualCalls();

  // ★ 自检：故意造一条【一定不存在】的调用 ⇒ 必须被判定为缺失
  //   这一步是"检查器自己能坏"的证明（D7），不是可选项。
  if (selftest) {
    const fake = 'src/__nonexistent__.ts#__nope__';
    const fakeHit = has(set, fake, fake);
    if (fakeHit) {
      console.error('★ 自检失败：一个不存在的调用竟然被判"存在" ⇒ 检查器坏了');
      process.exit(2);
    }
    console.log(`★ 自检：伪造调用 ${fake} ⇒ 正确判定为「不存在」✓（实有调用边 ${count} 条）`);
    return;
  }

  const missingRequired = [];
  for (const r of c.required || []) if (!has(set, r.from, r.to)) missingRequired.push(r);

  const stillMissing = [];
  const nowPresent = [];
  for (const r of c.expected_missing || []) {
    (has(set, r.from, r.to) ? nowPresent : stillMissing).push(r);
  }

  if (asJson) {
    console.log(JSON.stringify({ total: count, missingRequired, stillMissing, nowPresent }, null, 2));
  } else {
    console.log('════ 契约 · 结构级（调用关系）════');
    console.log(`实际调用边 ${count} 条 · required ${(c.required || []).length} 条 · expected_missing ${(c.expected_missing || []).length} 条\n`);

    if (missingRequired.length) {
      console.log(`★★ required 缺 ${missingRequired.length} 条（设计说必须有，实际没有）：`);
      for (const r of missingRequired) {
        console.log(`  ✗ ${short(r.from)} → ${short(r.to)}`);
        console.log(`      为什么：${r.why}`);
      }
    } else {
      console.log(`✓ required ${(c.required || []).length} 条全部成立`);
    }

    if (stillMissing.length) {
      console.log(`\n★ 已挂债（设计说应该有、目前没有，符合预期）：${stillMissing.length} 条`);
      for (const r of stillMissing) console.log(`  ⋯ ${short(r.from)} → ${short(r.to)}  [debt: ${r.debt}]`);
    }
    if (nowPresent.length) {
      console.log(`\n★★★ 这 ${nowPresent.length} 条债【已经还了】—— 该销账了（从 expected_missing 移进 required）：`);
      for (const r of nowPresent) console.log(`  ✓ ${short(r.from)} → ${short(r.to)}  [debt: ${r.debt}]`);
    }
  }

  if (missingRequired.length) process.exit(1);
  process.exit(0);
}

const short = (s) => String(s).replace(/^src\//, '').replace(/\.ts#/, '#');

main();
