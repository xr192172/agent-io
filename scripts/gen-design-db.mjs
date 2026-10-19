#!/usr/bin/env node
/**
 * gen-design-db.mjs —— 设计 DB 生成器（★ 2026-10-19 重写，用户裁定"全删重写"）
 *
 * ## 它做什么
 * ```
 * design/<f>.dsl.json  ──生成──→  certs/design-contracts/<file>.calls.json
 * ```
 *
 * ## 为什么重写
 * 旧的 `certs/design-contracts/*` 是 **从 `live/`（实际侧）fork** 的（339 份，2026-10-18 生成后就没再动）。
 * ⇒ 它携带的是"实际侧的事实"，而**设计侧的意图（`decision` / `expectations`）根本没进去** ⇒
 * 所以 `contract:calls` 判的其实是"实际侧 × 实际侧"（必然全绿），而不是"设计 × 实际"。
 * ⇒ ★ 用户裁定：全删重写 —— **设计 DB 必须从【设计 DSL】生成**，不是从实际侧 fork。
 *
 * ## 唯一数据源（不存在第二份）
 * ```
 * design/<f>.dsl.json 的 geometry.nodes[].decision.expectations
 *   · kind='call-exists'  ⇒ calls[]   （设计说"必须有这条调用"）
 *   · kind='edge-absent'  ⇒ removed[] （设计说"不该有这条依赖"）
 * ```
 *
 * ## 边界
 * ★ **不生成 `contract.ts`** —— 那是 `tsc` 用的符号级契约，现在由 `tsconfig.contract.json` 直接读 `src/`。
 * ★ **不写"实际全量"** —— 实际侧的全量调用在 `cache.db` 里（`contract:calls` 自己去读），
 *   设计 DB 只装"设计说了什么"。两条线各管一件事。
 *
 * ## 用法
 *   node scripts/gen-design-db.mjs           # 生成全部 feature
 *   node scripts/gen-design-db.mjs --check   # 只检查是否与当前设计一致（不写）
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const DESIGN_DIR = path.join(ROOT, '.agent-io', 'design');
const OUT_DIR = path.join(ROOT, 'certs', 'design-contracts');
const CHECK = process.argv.includes('--check');

const norm = (s) => String(s ?? '').replace(/\\/g, '/');

/** 符号 → 所在文件（从 cache.db 的 nodes 表反查；查不到就返回 null） */
function symbolHome(db, symbol, hintFile) {
  const row = db.prepare("SELECT file_path FROM nodes WHERE name = ? AND parent IS NULL ORDER BY (file_path = ?) DESC LIMIT 1").get(symbol, norm(hintFile));
  return row ? norm(row.file_path) : null;
}

if (!fs.existsSync(DESIGN_DIR)) {
  console.error(`★ 找不到 ${DESIGN_DIR}`);
  process.exit(2);
}
const files = fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.dsl.json'));
if (!files.length) {
  console.error('★ design/ 里没有 .dsl.json');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new DatabaseSync(path.join(ROOT, '.agent-io', 'cache.db'), { readOnly: true });
let written = 0;
let unchanged = 0;
const problems = [];

for (const f of files) {
  const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
  const feature = dsl.feature ?? f.replace(/\.dsl\.json$/, '');

  /** 每文件产出一份 calls.json（键 = 该文件里的"调用方"所在文件） */
  const byFile = new Map();
  for (const n of dsl.geometry?.nodes ?? []) {
    const owner = norm(n.description);
    if (!owner.startsWith('src/')) continue;
    for (const e of n.decision?.expectations ?? []) {
      if (e.kind !== 'call-exists') continue;
      const fromFile = norm(e.path ?? owner);
      const from = `${fromFile}#${e.symbol}`;
      const toFile = symbolHome(db, e.target, fromFile);
      if (!toFile) {
        problems.push(`${feature}: ${from} → ${e.target}（★ cache.db 里查不到这个符号 ⇒ 生成不了 to）`);
        continue;
      }
      const to = `${toFile}#${e.target}`;
      if (!byFile.has(fromFile)) byFile.set(fromFile, { calls: [], removed: [] });
      byFile.get(fromFile).calls.push({ from, to, ...(e.why ? { why: e.why } : {}) });
    }
  }

  for (const [file, data] of byFile) {
    const outName = file.replace(/^src\//, '').replace(/[\/\\]/g, '-').replace(/\.ts$/, '') + '.calls.json';
    const outPath = path.join(OUT_DIR, outName);
    const payload = {
      '//': `★★★ 设计 DB（结构级·调用）—— ${file}（★ 从 design/*.dsl.json 生成，只含【设计说了的】）`,
      '//generated_by': 'scripts/gen-design-db.mjs（★ 不许手改：改了下次生成就冲掉）',
      '//source': `design/${f}`,
      '//how': '对拍用 scripts/contract-calls.mjs；calls 里"实际没有"的会红（= 该接线）',
      calls: data.calls,
      ...(data.removed.length ? { removed: data.removed } : {}),
    };
    const text = JSON.stringify(payload, null, 2) + '\n';
    const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (old === text) {
      unchanged++;
      continue;
    }
    if (CHECK) {
      problems.push(`${outName}: 与当前设计不一致（该重跑生成器）`);
      continue;
    }
    fs.writeFileSync(outPath, text);
    written++;
  }
}
db.close();

console.log(`══ gen-design-db · ${files.length} 个 feature ══`);
console.log(`  生成 ${written} 份 · 未变 ${unchanged} 份`);
if (problems.length) {
  console.log(`\n  ★ ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 12)) console.log('    ' + p);
  process.exit(1);
}
