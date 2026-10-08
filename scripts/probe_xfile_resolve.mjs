/**
 * xfile_resolve —— 验「跨文件 import 解析」：**从我们自己的 import 提取结果出发**，
 * 看能不能解析到项目内的那个文件（`resolveProjectImport`）。
 *
 * ★ 为什么这是"另一笔账"：前面几轮只验了"**边提出来了**"（`imports=[./a.sol]`），
 *   没验"**它指向项目内哪个文件**"。而后者才是 replace/影响面/引用查找的地基。
 *
 * 判据：造一个**真的小项目目录**（目标文件 + 引用它的文件），
 *   `parseFileFull(main)` 拿到 `imports[].source` → `resolveProjectImport(fromRel, source, rels)`
 *   ⇒ 期望 `rel` 命中目标文件、`layer` 说得清是哪条约定。
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const k = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/index.js').replace(/\\/g, '/'));
const { codeSourceExts } = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/source_exts.js').replace(/\\/g, '/'));
// ★★ 必须与**生产同一条调用**：`health/index.ts:776` 与 `impact/index.ts:138` 都是
//   `codeSourceExts(listSupportedExtensions())` 传给 `resolveProjectImport` 的 `exts`。
//   `IMPORT_EXTS` 只含 TS/JS 系 8 个后缀 ⇒ **不传 exts 时 `.cr`/`.sol`/`.py` 根本不会成为候选**。
//   ★ 我第一版没传 ⇒ python/crystal/solidity 全 null —— **是探针的错，不是解析器的错**（今天第三次同款）。
const EXTS = codeSourceExts(k.listSupportedExtensions());
console.log(`（候选后缀取生产口径 codeSourceExts：${EXTS.length} 个，含 .cr=${EXTS.includes('.cr')} .sol=${EXTS.includes('.sol')} .py=${EXTS.includes('.py')}）\n`);
const TMP = path.join(REPO, '.inspect', 'xfile');
fs.rmSync(TMP, { recursive: true, force: true });

/** 每个用例：目标文件 + 引用它的文件。`want` = 期望解析到的项目内文件（null = 期望解析不到）。 */
const CASES = {
  typescript: { target: 'a.ts', main: 'main.ts', targetCode: 'export const a = 1\n', mainCode: 'import { a } from "./a"\nexport const m = a\n', want: 'a.ts' },
  javascript: { target: 'a.js', main: 'main.js', targetCode: 'export const a = 1\n', mainCode: 'import { a } from "./a"\n', want: 'a.js' },
  tsx: { target: 'a.tsx', main: 'main.tsx', targetCode: 'export const a = 1\n', mainCode: 'import { a } from "./a"\n', want: 'a.tsx' },
  python: { target: 'a.py', main: 'main.py', targetCode: 'a = 1\n', mainCode: 'from .a import b\n', want: 'a.py' },
  crystal: { target: 'a.cr', main: 'main.cr', targetCode: 'A = 1\n', mainCode: 'require "./a"\n', want: 'a.cr' },
  solidity: { target: 'a.sol', main: 'main.sol', targetCode: 'contract A {}\n', mainCode: 'import "./a.sol";\ncontract M {}\n', want: 'a.sol' },
  c: { target: 'a.h', main: 'main.c', targetCode: 'int a;\n', mainCode: '#include "a.h"\nint m;\n', want: 'a.h' },
  cpp: { target: 'a.h', main: 'main.cpp', targetCode: 'int a;\n', mainCode: '#include "a.h"\nint m;\n', want: 'a.h' },
  ocaml: { target: 'a.ml', main: 'main.ml', targetCode: 'let a = 1\n', mainCode: 'open A\nlet m = 1\n', want: null },
};

const rows = [];
for (const [lang, c] of Object.entries(CASES)) {
  const dir = path.join(TMP, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, c.target), c.targetCode);
  const mainAbs = path.join(dir, c.main);
  fs.writeFileSync(mainAbs, c.mainCode);
  const rels = new Set([c.target, c.main]);
  let r;
  try { r = await k.parseFileFull(mainAbs, c.mainCode); }
  catch (e) { rows.push({ lang, verdict: '✗ parseFileFull 抛错: ' + (e.message || '').slice(0, 50) }); continue; }
  const srcs = (r.imports || []).map((i) => i.source);
  if (srcs.length === 0) { rows.push({ lang, verdict: '✗ 没提到 import 边', srcs }); continue; }
  const hits = srcs.map((s) => {
    const h = k.resolveProjectImport(c.main, s, rels, { exts: EXTS });
    // ★ 另试带 bareBaseFirst（else 分支里已有的口子）：看是不是**缺能力**还是**调用方没开**
    const h2 = k.resolveProjectImport(c.main, s, rels, { exts: EXTS, bareBaseFirst: true });
    if (!h.rel && h2.rel) h.rel = h2.rel, h.layer = h2.layer + "+bareBaseFirst", h.viaBareBase = true;
    return { src: s, rel: h.rel, layer: h.layer };
  });
  const got = hits.find((h) => h.rel === c.want) ?? null;
  const wrong = c.want === null ? hits.every((h) => h.rel === null) : false;
  rows.push({
    lang, srcs, hits, want: c.want,
    verdict: wrong || got ? '✅ 解析正确' : `✗ 期望 ${c.want ?? 'null'}，得到 ${JSON.stringify(hits.map((h) => h.rel))}`,
  });
}

// ★ `--json`：只吐可比较的 JSON（供快照观测）；`hits` 里的路径都是**项目内相对路径** ⇒ 与机器无关
if (process.argv.includes('--json')) { console.log(JSON.stringify(rows)); process.exit(0); }
fs.writeFileSync(path.join(REPO, '.inspect', 'xfile-resolve.json'), JSON.stringify(rows, null, 1));
const ok = rows.filter((r) => r.verdict.startsWith('✅')).length;
console.log('跨文件 import 解析（从我们自己的 import 提取结果出发）：\n');
console.log(`  ✅ 解析正确 ${ok} · ✗ 其它 ${rows.length - ok} / ${rows.length}\n`);
for (const r of rows) {
  const detail = r.hits ? `源=${JSON.stringify(r.srcs)} ⇒ ${r.hits.map((h) => `${h.src}→${h.rel ?? 'null'}(${h.layer ?? '-'})`).join(' ')}` : '';
  console.log(`  ${r.lang.padEnd(11)} ${r.verdict}  ${detail}`);
}
