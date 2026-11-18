#!/usr/bin/env node
/**
 * coverage —— **设计覆盖度**：拿 `cache.db` 的实际导出，比 `decision.expectations` 声明了什么。
 *
 * ## 它回答什么（`impact_analysis` 给的是"变更影响"，这个是"设计漏了什么"）
 * 对每个**有 decision 的设计节点**：
 *   · 实际该文件导出哪些 top-level 符号（`nodes.parent IS NULL`）
 *   · 设计里声明了哪些 `symbol-exists`
 *   ⇒ ★ 差集 = **设计漏掉的**
 *
 * ## 为什么要比"导出"而不是比"所有符号"
 * 设计管的是**对外契约**（谁导出什么），不是"文件里有什么"（私有函数不该进设计）。
 * ★ 所以只比 top-level 导出。
 *
 * 用法：node scripts/coverage.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// ★★★ 2026-11-18（T-#A8A9-CROSS-BOOK 批 17 · **计划册退役**）：这里原来硬编码读
//   `.agent-io/design/task-system-plan.dsl.json`。批 17 把那份册归档进 `design/archived/` 并注销 feature
//   ⇒ 那个路径**不再存在**；而它的判据早就在批 13/14 逐字搬进 `agent-io` ⇒ 继续指它 = 读一份 **0 判据**的归档件
//   （覆盖率恒 0，看起来"设计什么都没漏"，其实是**没有东西可判**）。
//   口径改为**全部活册**（与 `verify-changed.mjs` 批 15 的 `readContractNodes` 同一件事）：设计面有几册就扫几册；
//   单册读不了**当场抛**，不静默跳过（0.12：读失败 ≠ 没有）。
const DESIGN_DIR = path.join('.agent-io', 'design');
const DESIGN_FILES = fs.existsSync(DESIGN_DIR)
  ? fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.dsl.json')).sort()
  : [];
const DB = path.join('.agent-io', 'cache.db');

const designed = DESIGN_FILES.flatMap((f) => {
  const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
  return (dsl.geometry?.nodes ?? []).filter((n) => n.decision);
});

const db = new DatabaseSync(DB, { readOnly: true });
const q = db.prepare(
  `SELECT name, kind FROM nodes WHERE file_path = ? AND parent IS NULL AND kind IN ('function','interface','type','class','const','enum') ORDER BY name`,
);

let totalExp = 0;
let totalExport = 0;
let totalMissing = 0;
const rows = [];

for (const n of designed) {
  const file = String(n.description ?? '').replace(/\\/g, '/');
  if (!file) continue;
  const exports = q.all(file);
  const designedSyms = new Set((n.decision.expectations ?? []).filter((e) => e.symbol).map((e) => e.symbol));
  const missing = exports.filter((e) => !designedSyms.has(e.name));

  totalExp += designedSyms.size;
  totalExport += exports.length;
  totalMissing += missing.length;
  rows.push({ file, exports: exports.length, designed: designedSyms.size, missing });
}

console.log('════ 设计覆盖度（导出 vs 设计声明）════\n');
for (const r of rows) {
  const pct = r.exports ? Math.round(((r.exports - r.missing.length) / r.exports) * 100) : 100;
  console.log(`${r.file.replace(/^src\//, '')}`);
  console.log(`  导出 ${r.exports} · 设计 ${r.designed} · ★漏 ${r.missing.length}（覆盖 ${pct}%）`);
  if (r.missing.length) {
    const names = r.missing.map((m) => `${m.name}(${m.kind[0]})`).join(' ');
    console.log(`  漏：${names.length > 140 ? names.slice(0, 140) + '…' : names}`);
  }
  console.log('');
}

console.log('──── 合计 ────');
console.log(`  11 个设计文件 · 实际导出 ${totalExport} · 设计声明 ${totalExp} · ★漏 ${totalMissing}`);
console.log(`  ★ 覆盖度 ${totalExport ? Math.round(((totalExport - totalMissing) / totalExport) * 100) : 0}%`);
