#!/usr/bin/env node
/**
 * cert T331 —— **入口文档的体量**（"唯一的入口"必须真的能被读完）。
 *
 * ## 为什么需要它（2026-10-15 的现场教训）
 * 盲测（只读入口 + 一条命令）的结论是「**不能开工**」，其中一条硬理由：
 * 入口 **实际 77,359 字节**，而它自述"约 8K"、自己定的目标是"≤20K 字符"。
 * ⇒ ★★ **我给它定了目标，却从未量过它** —— 一整天往它后面追加 §7–§27，它从 8K 长到 77K，
 *    **"重规划"本身变成了它要治的那个病**（要素总量过大、掌握力崩）。
 * ⇒ 修法两条：① 与流水账分家（本步）；② **给体量立一条会自动跑的判据**（本证）。
 *
 * ## 判据
 * ① **入口 ≤ 20,000 字符**（超了就是"该切分了"）；
 * ② **流水账存在**（分家成立 ⇒ 过程记录有地方去，不必挤进入口）；
 * ③ 入口**第一屏**（前 2,000 字符内）必须出现"现在在哪"的裁决段落（否则新会话仍要翻）。
 *
 * ★ 自测用：`--limit 9000`（人为压低阈值 ⇒ 应当红且 exit 1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ENTRY = path.join(REPO, 'docs/replan-2026-10-15.md');
const LOG = path.join(REPO, 'docs/replan-log-2026-10-15.md');
const argv = process.argv.slice(2);
const li = argv.indexOf('--limit');
const LIMIT = li >= 0 && argv[li + 1] ? Number(argv[li + 1]) : 20000;

let P = 0;
let F = 0;
const check = (name, ok, detail) => {
  if (ok) P++;
  else F++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  —— ${detail}` : ''}`);
};

if (!fs.existsSync(ENTRY)) {
  console.log(`✗ 入口不存在：${path.relative(REPO, ENTRY)}`);
  console.log('\n════ 汇总：PASS=0  FAIL=1');
  process.exit(1);
}
const text = fs.readFileSync(ENTRY, 'utf8');
const size = Buffer.byteLength(text, 'utf8');

console.log('=== T331 · 入口文档体量 ===');
console.log(`  读入口 = ${size} 字符（阈值 ${LIMIT}）· 流水账 = ${fs.existsSync(LOG) ? Buffer.byteLength(fs.readFileSync(LOG, 'utf8'), 'utf8') + ' 字符' : '（不存在）'}`);

check('① 入口 ≤ 阈值（超了就该切分）', size <= LIMIT, `当前 ${size} / 阈值 ${LIMIT}`);
check('② 流水账存在（过程记录有地方去）', fs.existsSync(LOG), fs.existsSync(LOG) ? '在' : '缺 → 新建 docs/replan-log-2026-10-15.md');
check('③ 第一屏有"现在在哪"的裁决段落', text.slice(0, 2000).includes('现在在哪'), '前 2000 字符内找"现在在哪"');

if (size > LIMIT) {
  console.log('\n  ★★ 入口超了阈值 —— 两条路（二选一，都要有意识）：');
  console.log('     ① 把**过程记录**搬去 `docs/replan-log-*.md`（入口只留"现在在哪 + 判据 + 文档角色"）；');
  console.log('     ② 若确有必要加大 ⇒ 改本证阈值，并在提交信息里写清理由。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
console.log('★ 入口仍然是"能被读完的" —— 掌握力的物理前提还在。');
