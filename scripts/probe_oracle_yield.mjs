// 量具：`dotted-unprovable`（成员调用证不出接收者类型）**用 tsc checker 能救多少**
//
// 背景（2026-10-27）：`failed` 已清到 0.4%（125/28785），但 `external` 里有
// `dotted-unprovable` **13953 条（48%）** —— 那是"判不了"，不是"外部"、也不是"债"。
// 它们**正是需要类型推断的那部分**。本探针量出：如果上 TypeOracle（tsc/LSP），
// 其中多少能解析到**本仓符号**（= 能建边 = 覆盖率提升）。
//
// 用法：node scripts/probe_oracle_yield.mjs [相对路径]
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = process.cwd();
const TARGET = process.argv[2] ?? 'src/presentation/http/serve.ts';

const db = new DatabaseSync(path.join(ROOT, '.agent-io', 'cache.db'), { readOnly: true });
const rows = db
  .prepare(
    `SELECT u.reference_name, u.name_tail, u.line
     FROM unresolved_refs u JOIN files f ON f.id = u.file_id
     WHERE f.path = ? AND u.candidates LIKE '%dotted-unprovable%'`,
  )
  .all(TARGET);
db.close();
console.log(`目标 ${TARGET} · dotted-unprovable 引用 = ${rows.length}`);
if (!rows.length) process.exit(0);

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.git|^dist$|\.agent-io/.test(e.name)) walk(p, out);
    } else if (p.endsWith('.ts')) out.push(p);
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
console.log(`createProgram ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const sf = program.getSourceFiles().find((s) => s.fileName.replace(/\\/g, '/').endsWith(TARGET));
if (!sf) {
  console.log('找不到源文件');
  process.exit(0);
}

const byLine = new Map();
const collect = (n) => {
  if (ts.isIdentifier(n)) {
    const ln = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    if (!byLine.has(ln)) byLine.set(ln, new Map());
    const m = byLine.get(ln);
    if (!m.has(n.text)) m.set(n.text, []);
    m.get(n.text).push(n);
  }
  ts.forEachChild(n, collect);
};
collect(sf);

let repo = 0;
let ext = 0;
let unknown = 0;
const samples = [];
for (const r of rows) {
  const m = byLine.get(r.line);
  const cands = m?.get(String(r.name_tail));
  if (!cands || !cands.length) {
    unknown++;
    continue;
  }
  let done = false;
  for (const t of cands) {
    const sym = checker.getSymbolAtLocation(t);
    const d = sym?.getDeclarations?.()?.[0];
    if (!d) continue;
    const f = d.getSourceFile().fileName.replace(/\\/g, '/');
    if (f.includes('/src/')) {
      repo++;
      if (samples.length < 6) {
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');
        const ln = d.getSourceFile().getLineAndCharacterOfPosition(d.getStart()).line + 1;
        samples.push(`  本仓  ${String(r.reference_name).slice(0, 34).padEnd(36)} → ${rel}:${ln}`);
      }
    } else {
      ext++;
    }
    done = true;
    break;
  }
  if (!done) unknown++;
}
console.log('\n=== checker 能解出什么 ===');
console.log(`  本仓符号（能建边） = ${repo}  (${((repo / rows.length) * 100).toFixed(1)}%)`);
console.log(`  外部/内置          = ${ext}  (${((ext / rows.length) * 100).toFixed(1)}%)`);
console.log(`  仍判不了           = ${unknown}  (${((unknown / rows.length) * 100).toFixed(1)}%)`);
console.log('\n=== 本仓样本 ===');
for (const s of samples) console.log(s);
