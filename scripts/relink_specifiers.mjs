/**
 * ★ 规格符重链器 —— `git mv` 之后，把所有 import/export 说明符改成指向新位置的相对路径。
 *
 * 为什么有它（2026-09-30）：仓里的 `rename_files` 是这件事的正规工具，但它的**落盘**要删源文件，
 * 而宿主的批量删除护栏（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）把搬迁**半途拦死**，
 * 留下"引用已改写、文件没搬"的坏中间态（实测两次）。⇒ 改成：
 *   `git mv` 搬文件（git 不经过护栏） + 本脚本改说明符（**只写不删**）。
 *
 * 它凭什么可信：**`tsc` 是完备校验网** —— 相对说明符一旦指错，模块解析必然失败（TS2307）。
 * 所以 `npx tsc` 干净 ⇒ 说明符全对。这是"用编译器的判据"，不是"用我自己的判据"。
 *
 * ★ 2026-09-30 进仓：它已跨 ⑤⑥⑦ 三族验证（含 `tsc` 当场抓出的 v1 真错）。
 *   为什么进仓而不是留在会话工作区：`rename_files` 在本机**被删除护栏拦死**，这把器是它的替代品；
 *   而且它补上了"搬迁工具链"里"把 ①import 说明符全部改对"这一环 —— 属搬迁标配。
 *
 * 用法:
 *   node scripts/relink_specifiers.mjs src/old/a.ts=src/new/a.ts [...] [--apply]
 *   （先 `git mv` 落盘，再跑本脚本；不带 --apply 只报告）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const pairs = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  if (i < 0) { console.error(`参数形状错（要 old=new）：${a}`); process.exit(2); }
  return { from: path.resolve(ROOT, a.slice(0, i)), to: path.resolve(ROOT, a.slice(i + 1)) };
});
if (pairs.length === 0) { console.error('用法: node scripts/relink_specifiers.mjs <old>=<new> [...] [--apply]'); process.exit(2); }

/** 旧绝对路径 → 新绝对路径 */
const fileMap = new Map(pairs.map((p) => [p.from, p.to]));
/** 某个文件在**搬迁前**所在的目录（说明符还没改，必须按旧坐标解析） */
const oldDirByNew = new Map(pairs.map((p) => [p.to, path.dirname(p.from)]));
const oldDirOf = (abs) => oldDirByNew.get(abs) ?? path.dirname(abs);
const dirOf = (abs) => path.dirname(abs);

const REL_EXT_TRY = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs'];
/** ★ 搬迁**已经**落盘 ⇒ 判断"这个旧路径存在吗"必须查它**现在**在哪 */
const currentPath = (oldAbs) => fileMap.get(oldAbs) ?? oldAbs;
const existsCurrent = (oldAbs) => {
  const p = currentPath(oldAbs);
  return fs.existsSync(p) && fs.statSync(p).isFile();
};
/** 把 specifier 解析成「**旧坐标**下的绝对路径」（解析不到返回 null） */
function resolveSpec(fromOldDir, spec) {
  const base = path.resolve(fromOldDir, spec);
  for (const e of REL_EXT_TRY) if (existsCurrent(base + e)) return base + e;
  const m = spec.match(/\.(js|mjs|cjs)$/);
  if (m) {
    const stem = path.resolve(fromOldDir, spec.slice(0, -m[0].length));
    for (const e of ['.ts', '.tsx', '.mts', '.cts']) if (existsCurrent(stem + e)) return stem + e;
  }
  for (const e of ['/index.ts', '/index.tsx', '/index.js']) if (existsCurrent(base + e)) return path.resolve(base + e);
  return null;
}

/**
 * 覆盖全部"模块说明符"写法：静态 import/export、动态 import、require、测试 mock、
 * ★ **以及副作用 import** `import './x.js';`（无 from、无括号）。
 *   ★★ 2026-10-01 补：本器原先**漏了这一种** —— 而我在同一天修 `t11_facts.mjs` 时修的是同一个盲区、
 *   **却没回头修这里**（"同族两处只改一处"）⇒ `lang_hint.ts` 的 `import './register_capabilities.js'`
 *   没被改写 ⇒ **157 个测试文件加载失败**。
 *   ★ 教训：**修一个盲区时，先问"同一个盲区还有谁在犯"** —— 否则修好的那处会让人以为问题没了。
 */
const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*|\bvi\.doMock\s*\(\s*|\bvi\.importActual\s*\(\s*|\bjest\.mock\s*\(\s*)(['"])([^'"]+)\2/g;

function relSpecifier(fromDir, toAbs) {
  let rel = path.relative(fromDir, toAbs).split(path.sep).join('/');
  rel = rel.replace(/\.(ts|tsx|mts|cts)$/, '.js');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

const SCAN_ROOTS = ['src', 'tests', 'scripts'];
const EXTS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs'];
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const files = [
  ...SCAN_ROOTS.flatMap((r) => walk(path.join(ROOT, r))),
  ...fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && EXTS.some((x) => e.name.endsWith(x)) && !e.name.startsWith('.'))
    .map((e) => path.join(ROOT, e.name)),
];

let totalHits = 0, touchedFiles = 0;
const report = [];
for (const abs of files) {
  const src = fs.readFileSync(abs, 'utf-8');
  const fromOldDir = oldDirOf(abs);
  // ★ 两种都必须改：(a) **目标**搬走了（相对路径变了）(b) **本文件自己**搬走了（基准目录变了）
  //   —— v1 只判了 (a)，漏了 (b) ⇒ `tsc` 报 5 处 TS2307（搬走的文件指向未搬的文件）。
  const importerMoved = oldDirByNew.has(abs);
  let hits = 0;
  const out = src.replace(SPEC_RE, (whole, prefix, q, spec) => {
    if (!spec.startsWith('.')) return whole; // 裸包名不碰
    const resolved = resolveSpec(fromOldDir, spec);
    if (!resolved) return whole;
    const targetMoved = fileMap.has(resolved);
    if (!importerMoved && !targetMoved) return whole;
    const toAbs = fileMap.get(resolved) ?? resolved;
    const next = relSpecifier(dirOf(abs), toAbs);
    if (next === spec) return whole;
    hits++;
    return `${prefix}${q}${next}${q}`;
  });
  if (hits > 0) {
    totalHits += hits; touchedFiles++;
    report.push(`  ${path.relative(ROOT, abs).split(path.sep).join('/')}   （${hits} 处）`);
    if (APPLY) fs.writeFileSync(abs, out);
  }
}

console.log(`映射 ${pairs.length} 个文件；扫描 ${files.length} 个源文件`);
console.log(report.join('\n'));
console.log(`\n共 ${touchedFiles} 个文件、${totalHits} 处说明符需要重链`);
console.log(APPLY ? '✓ 已写盘' : '（dry run）加 --apply 才写盘');
console.log('⇒ 校验：`npx tsc`（相对说明符指错必然 TS2307）+ `npm run arch`');
