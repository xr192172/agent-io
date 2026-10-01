#!/usr/bin/env node
/**
 * lang_density —— 「语言知识密度」量具：找出**把 N 个语言的实现挤在一个文件里**的地方。
 *
 * 用途（2026-10-01 定型）：决定"下一刀拆哪个文件"。
 * 参考形状见 `src/infrastructure/analysis/version_upgrade/adapters/`（契约 + 注册表 + 每语言一个文件）
 * 与 `src/application/refactor/rename_symbol/`（2026-10-01 按同一形状拆完的第一处）。
 *
 * 判据（不是"文件大不大"，而是"语言知识密不密"）：
 *   密度 = getParser/findLanguageByExt 调用数 × 3    （按扩展名分派 = 最硬的语言知识）
 *        + 语言名字面量数 × 1                        （'go' / 'python' / 'c_sharp' …）
 *        + 语言专属 AST 节点类型数 × 2                （function_declaration / type_spec …）
 *   ★ 只算非注释行。
 *   ★ 阈值 score ≥ 8 且行数 ≥ 200 才报 —— 小文件里出现几个语言名很正常（如语言注册表本身）。
 *
 * 用法：node scripts/lang_density.mjs [srcDir=src] [--all]
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src';

const NODE_TYPES =
  /'(function_declaration|type_spec|const_spec|var_spec|method_declaration|package_clause|class_declaration|import_statement|from_import_statement|type_alias_declaration|namespace_declaration|preproc_include|function_definition|interface_declaration)'/g;
const DISPATCH = /\b(getParser|findLanguageByExt)\(/g;
const LANG_LIT =
  /'(typescript|tsx|javascript|jsx|python|java|c_sharp|golang|ruby|kotlin|scala|cpp|rust|php|swift|elixir|haskell)'/g;

/** 逐行去掉注释后的正文（★ 注释里出现语言名不算"语言知识"） */
function codeOnly(text) {
  let inBlock = false;
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (inBlock) {
        if (t.includes('*/')) inBlock = false;
        return false;
      }
      if (t.startsWith('/*')) {
        if (!t.includes('*/')) inBlock = true;
        return false;
      }
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

const count = (s, re) => (s.match(re) ?? []).length;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const rows = [];
for (const f of walk(SRC)) {
  const raw = fs.readFileSync(f, 'utf8');
  const src = codeOnly(raw);
  const lines = raw.split('\n').length;
  const d = count(src, DISPATCH);
  const l = count(src, LANG_LIT);
  const n = count(src, NODE_TYPES);
  const score = d * 3 + l + n * 2;
  if (score >= 8 && (process.argv.includes('--all') || lines >= 200)) {
    rows.push({ score, d, l, n, lines, f: f.split(path.sep).join('/') });
  }
}
rows.sort((a, b) => b.score - a.score);

console.log('score  disp  lit  node  lines  file');
for (const r of rows) {
  // ★ 已经在「目标形状」里的叶子包**不是待拆对象** —— 它们本来就该只懂一门语言。
  //   判据：路径里含 `/languages/` 或 `/adapters/`（每语言一个文件的那一层）。
  const leaf = /\/languages\/|\/adapters\//.test(r.f) ? '  ← 已是目标形状（叶子包）' : '';
  console.log(
    `${String(r.score).padStart(5)} ${String(r.d).padStart(5)} ${String(r.l).padStart(4)} ${String(r.n).padStart(5)} ${String(r.lines).padStart(6)}  ${r.f}${leaf}`,
  );
}
console.log(`\n命中 ${rows.length} 个文件。★ 目标形状：<功能>/languages/<lang>.ts + registry.ts`);
console.log('★ 带「已是目标形状」标记的行**不要拆** —— 它们就是拆完的样子。');
console.log('★ 拆完必须跑 `npm run arch`（0 违规）——"大家都要用的零件"放错位置会成环。');
