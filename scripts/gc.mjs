#!/usr/bin/env node
/**
 * scripts/gc.mjs —— **工具使用账本的 GC（保留期 + 聚合压缩）**
 *
 * ## 它删什么、不删什么
 * 删：`usage.jsonl` 里**早于保留期**的**原始行**（逐次明细：哪一次、多慢、为什么失败）。
 * 不删：统计 —— 那些行先折成 `usage-rollup.json` 的
 *       `(日 × 工具 × 来源 × 动作)` 计数桶（次数 / 成功失败 / 下一棒**全部守恒**），
 *       而 `snapshotDogfoodStats` 会把 rollup 一起算进来 ⇒ **读数不缩水**。
 * 也不删：**坏行**（JSON 解析失败的）—— 留在账本里，别借 GC 抹掉证据。
 *
 * ## 用法
 *   npm run gc                       # 默认 dry-run：只报计划与读数，一个字节不改
 *   npm run gc -- --days 60          # 换保留期
 *   npm run gc -- --apply            # 真写：先写 rollup + 回读校验，再原子替换账本
 *
 * ## 判据（写死，别绕）
 *   ① dry-run 是默认值（破坏性动作不许"默认且静默"）；
 *   ② `--apply` 前必过**守恒校验**：`旧桶计数 + 归档行数 == 新桶计数`，不过就抛、一个字节不改；
 *   ③ 落盘走**临时文件 + rename**（半截账本比旧账本更坏）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const D = (rel) => pathToFileURLSafe(path.join(PKG, 'dist/src', rel));

function pathToFileURLSafe(p) {
  return new URL(`file://${p.replace(/\\/g, '/')}`).href;
}

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const daysArg = argv.find((a) => a.startsWith('--days=')) ?? null;
const days = daysArg ? Number(daysArg.split('=')[1]) : 30;

const { compactUsageLog, snapshotDogfoodStats } = await import(D('infrastructure/dogfood_stats.js'));

const before = snapshotDogfoodStats({ includeSweeps: true });
const rep = compactUsageLog({ keepDays: days, apply });

const fmt = (n) => String(n).padStart(6);
console.log('══ 工具使用账本 GC ══');
console.log(`  账本      ${rep.file}`);
console.log(`  聚合桶    ${rep.rollup_file}`);
console.log(`  保留期    ${rep.keep_days} 天（分界 ${rep.cutoff}）`);
console.log(`  行数      ${fmt(rep.lines_before)} 可解析 · 保留 ${rep.lines_keep} · 归档 ${rep.lines_archive} · 坏行 ${rep.lines_broken}（原样留着）`);
console.log(`  桶        ${rep.buckets} 个 · 计数合计 ${rep.bucket_calls}`);
console.log(`  模式      ${apply ? (rep.applied ? '★ 已落盘（--apply）' : '未落盘（没有可归档的行）') : 'dry-run（默认，一个字节没改）'}`);

if (apply && rep.applied) {
  const after = snapshotDogfoodStats({ includeSweeps: true });
  const t = (s) => s.tools.reduce((n, x) => n + x.calls, 0);
  const same = t(before) === t(after) && before.tools.length === after.tools.length;
  console.log(`  读数守恒  GC 前 ${t(before)} 次 / ${before.tools.length} 个工具 ⇒ GC 后 ${t(after)} 次 / ${after.tools.length} 个工具 ⇒ ${same ? '✓ 一致' : '✗ 不一致'}`);
  if (!same) {
    console.error('✗ 读数不守恒 —— 请立刻用账本备份回滚，并把这个读数贴出来');
    process.exit(1);
  }
} else if (!apply) {
  console.log('  ⇒ 真删请加 --apply（会先写 rollup、回读校验守恒，再原子替换账本）');
}
