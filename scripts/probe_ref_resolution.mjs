// 实验：用 tsc 的 checker 重新解析 cache.db 里 failed 的引用 —— 看能救多少
// ★ 修正：cache.db 的 `col` 全是 0（未填）⇒ **不能用列定位**，改用 `name_tail` 在该行里找标识符
// 用法：node scripts/probe_ref_resolution.mjs [相对路径]
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = process.cwd();
const TARGET_REL = process.argv[2] ?? 'src/infrastructure/index/symbols.ts';

const db = new DatabaseSync(path.join(ROOT, '.agent-io', 'cache.db'), { readOnly: true });
const rows = db
  .prepare(
    `SELECT u.id, u.reference_name, u.reference_kind, u.name_tail, u.line, u.col, u.file_id, f.path
     FROM unresolved_refs u JOIN files f ON f.id = u.file_id
     WHERE u.status = 'failed' AND f.path = ?`,
  )
  .all(TARGET_REL);
db.close();
console.log(`目标文件 = ${TARGET_REL} · failed 引用 = ${rows.length}`);
if (!rows.length) process.exit(0);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
};
const t0 = Date.now();
const program = ts.createProgram(walk(path.join(ROOT, 'src')), {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
console.log(`createProgram 耗时 = ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const sf = program.getSourceFiles().find((s) => s.fileName.replace(/\\/g, '/').endsWith(TARGET_REL));
if (!sf) {
  console.log('★ 找不到该源文件');
  process.exit(1);
}

/** 文件里所有 Identifier 按"行号 → 名字 → 节点[]"建索引（一次遍历） */
const byLine = new Map();
const collect = (n) => {
  if (ts.isIdentifier(n)) {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    if (!byLine.has(line)) byLine.set(line, new Map());
    const m = byLine.get(line);
    if (!m.has(n.text)) m.set(n.text, []);
    m.get(n.text).push(n);
  }
  ts.forEachChild(n, collect);
};
collect(sf);

function resolveAt(line, nameTail) {
  const m = byLine.get(line);
  if (!m) return null;
  const cands = m.get(nameTail);
  if (!cands || !cands.length) return null;
  for (const target of cands) {
    const sym = checker.getSymbolAtLocation(target);
    if (!sym) continue;
    const decls = sym.getDeclarations?.() ?? [];
    const d = decls[0];
    if (!d) continue;
    const declFile = d.getSourceFile();
    const inSrc = declFile.fileName.replace(/\\/g, '/').includes('/src/');
    return {
      kind: inSrc ? '本仓' : '外部/内置',
      file: path.relative(ROOT, declFile.fileName).replace(/\\/g, '/'),
      line: declFile.getLineAndCharacterOfPosition(d.getStart()).line + 1,
    };
  }
  return null;
}

let resolved = 0;
let external = 0;
let stillFail = 0;
const okSamples = [];
const failSamples = [];
for (const r of rows) {
  const tail = String(r.name_tail ?? String(r.reference_name).split('.').pop());
  const res = resolveAt(r.line, tail);
  if (!res) {
    stillFail++;
    if (failSamples.length < 8) failSamples.push(`  ✗ ${String(r.reference_name).slice(0, 42)} @L${r.line} (tail=${tail})`);
    continue;
  }
  if (res.kind === '本仓') resolved++;
  else external++;
  if (okSamples.length < 8) okSamples.push(`  ✓ ${res.kind.padEnd(6)} ${String(r.reference_name).slice(0, 34).padEnd(36)} → ${res.file}:${res.line}`);
}

console.log('\n=== checker 重解析结果 ===');
console.log(`  本仓符号（能建边）        = ${resolved}  (${((resolved / rows.length) * 100).toFixed(1)}%)`);
console.log(`  外部/内置（该归 external） = ${external}  (${((external / rows.length) * 100).toFixed(1)}%)`);
console.log(`  仍解析不了                = ${stillFail}  (${((stillFail / rows.length) * 100).toFixed(1)}%)`);
console.log('\n=== 解析成功的样本 ===');
for (const s of okSamples) console.log(s);
console.log('\n=== 仍解析不了的样本 ===');
for (const s of failSamples) console.log(s);
