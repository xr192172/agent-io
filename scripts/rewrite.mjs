#!/usr/bin/env node
/**
 * rewrite.mjs —— ⑥ 重写的【入口壳】（★ 2026-10-19，只读）
 *
 * ## 它做什么
 * 给定一个模块（或一批文件），回答：**"设计 DB 说该有什么" vs "源码里实际有什么"**
 * ```
 * 设计 DB   certs/design-db/<file>.calls.json 的 symbols[]
 * 实际       cache.db 的 nodes（按 file_path）
 *
 * ⇒ missing：设计说有、源码没有  ⇒ ★ 待重写（设计领先）
 * ⇒ extra  ：源码有、设计没有    ⇒ ★ 设计漏了（实现领先）
 * ```
 *
 * ## 为什么先做"只报差异"
 * 真正的"设计 DB → 源码"要【代码生成】。而这一步可以先用最便宜的方式产生价值：
 * **它告诉你哪个模块设计落后于实现、哪个实现落后于设计** —— 那正是"唤起重写"的入口。
 * ★ 零写入：不生成代码、不改任何文件。
 *
 * ## 用法
 *   node scripts/rewrite.mjs --file=src/domain/task_machine.ts
 *   node scripts/rewrite.mjs --prefix=src/domain/            # 整个目录
 *   node scripts/rewrite.mjs --file=... --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const BS = String.fromCharCode(92);
const norm = (s) => String(s ?? '').split(BS).join('/');
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const FEATURE = argOf('feature') ?? 'task-system-plan';
const FILE = argOf('file');
const PREFIX = argOf('prefix');
const JSON_OUT = process.argv.includes('--json');

if (!FILE && !PREFIX) {
  console.error('用法：--file=src/xxx.ts 或 --prefix=src/domain/');
  process.exit(2);
}

/** 设计 DB 的"每文件一份"命名：src/a/b.ts → a-b.calls.json */
const outNameOf = (rel) =>
  rel.replace(/^src\//, '').replace(/[\/\\]/g, '-').replace(/\.ts$/, '') + '.calls.json';

const DDIR = path.join(ROOT, 'certs', 'design-db');
const db = new DatabaseSync(path.join(ROOT, '.agent-io', 'cache.db'), { readOnly: true });
const qNodes = db.prepare(
  "SELECT name, kind, start_line FROM nodes WHERE file_path = ? AND parent IS NULL AND kind != 'file' ORDER BY start_line",
);

/** 目标文件清单 */
let files;
if (FILE) files = [norm(FILE)];
else {
  files = fs
    .readdirSync(path.join(ROOT, PREFIX), { recursive: true })
    .map((f) => norm(path.join(PREFIX, f)))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
}

const rows = [];
for (const rel of files) {
  const ddFile = path.join(DDIR, outNameOf(rel));
  if (!fs.existsSync(ddFile)) {
    rows.push({ file: rel, state: 'no-design-db', design: 0, actual: 0, missing: [], extra: [] });
    continue;
  }
  const dd = JSON.parse(fs.readFileSync(ddFile, 'utf8'));
  const designSyms = new Map((dd.symbols ?? []).map((s) => [s.name, s]));
  const actual = qNodes.all(rel);
  const actualSyms = new Map(actual.map((s) => [s.name, s]));

  const missing = [...designSyms.keys()].filter((n) => !actualSyms.has(n));
  const extra = [...actualSyms.keys()].filter((n) => !designSyms.has(n));
  rows.push({
    file: rel,
    state: 'ok',
    design: designSyms.size,
    actual: actualSyms.size,
    missing,
    extra,
  });
}
db.close();

if (JSON_OUT) {
  console.log(JSON.stringify({ feature: FEATURE, rows }, null, 2));
  process.exit(0);
}

console.log(`════ REWRITE · ${FEATURE} · ${files.length} 个文件 ════`);
let totMissing = 0;
let totExtra = 0;
let totDrift = 0;
for (const r of rows) {
  if (r.state === 'no-design-db') {
    console.log(`\n  ${r.file.replace('src/', '')}`);
    console.log(`     ★ 设计 DB 里没有这一份（未生成 / 不是设计覆盖的文件）`);
    continue;
  }
  totMissing += r.missing.length;
  totExtra += r.extra.length;
  if (!r.missing.length && !r.extra.length) continue;
  totDrift++;
  console.log(`\n  ${r.file.replace('src/', '')}   设计 ${r.design} vs 实际 ${r.actual}`);
  if (r.missing.length) console.log(`     ★ 设计有、源码没有（待重写）: ${r.missing.slice(0, 8).join(', ')}`);
  if (r.extra.length) console.log(`     · 源码有、设计没有（设计漏了）: ${r.extra.slice(0, 8).join(', ')}`);
}

console.log('');
console.log(`  斜差点：${totDrift} 个文件 · 待重写 ${totMissing} 个符号 · 设计漏 ${totExtra} 个符号`);
console.log('  ★ 零写入（不生成代码、不改文件）。真正的重写要接 buildRefactorPlan（它吃 old/new 文本清单）。');
