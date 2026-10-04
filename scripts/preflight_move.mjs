#!/usr/bin/env node
/**
 * preflight_move —— **动手搬之前**，先算出"这次搬迁会打断哪些引用"。
 *
 * 由来（2026-10-01 实测，一天之内踩了 4 次）：
 *   把 `rename_symbol.ts`(1920 行) / `package_migration.ts` / `contract_gate.ts` 按语言拆成文件夹。
 *   每次 `tsc` 都能抓到"真 import 没改"；但**真正让我返工的是 tsc 抓不到的那一类** ——
 *     ① `tests/server_registry.consistency.test.ts` 的 `importedBy` 硬编码路径 ⇒ 测试红
 *     ② 同一个门的 `resolveToolFile()` 只认"同名 .ts 文件"、认不出文件夹 ⇒ 测试红
 *     ③ `scripts/capability_scan.mjs` 的 `FEATURE_FILES` ⇒ ★ **只在 pre-commit 钩子里 ENOENT，把提交挡下**
 *     ④ `.dependency-cruiser-known-violations.json` 里环的路径 ⇒ `arch` 判"stale" + 新环当"新增"
 *   ④ 例里有 3 例**跑测试时完全不显形**。
 *
 * 判据（本工具的全部价值）：
 *   **把引用按"谁抓得到"分档** —— ①`tsc` 抓得到（改就行）；②**只有提交/运行时才炸**（最容易漏）。
 *
 * 用法：
 *   node scripts/preflight_move.mjs <将被移动的相对路径> [新路径]
 *   node scripts/preflight_move.mjs src/application/refactor/rename_symbol.ts
 *   node scripts/preflight_move.mjs src/application/refactor/foo.ts src/application/refactor/foo
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const oldPath = (process.argv[2] ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
const newPath = (process.argv[3] ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
if (!oldPath) {
  console.error('用法: node scripts/preflight_move.mjs <将被移动的相对路径> [新路径]');
  process.exit(2);
}

const REPO = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
/** 被移动模块的"名字"（不含扩展名）—— 登记表通常按它匹配 */
const stem = path.basename(oldPath).replace(/\.(ts|tsx|js|mjs|cjs|go|py|json)$/, '');

/**
 * ★★ 通用文件名要用**父目录名**当标识（2026-10-01 实测）：
 *   `behavior/index.ts` 的 basename 是 `index` —— 拿它当 key 会命中一堆 `.indexOf(` / `index.js`（纯噪声）。
 *   而登记表引用的**从来不是** `index`，是 **`behavior`**（模块名 = 父目录名）。
 *   ⇒ basename 属通用词时，改用父目录名；通用词的完整清单宁短勿长（宁可多扫，不可漏扫）。
 */
const GENERIC = new Set(['index', 'core', 'parts', 'types', 'type', 'main', 'mod', 'utils', 'util', 'helpers']);
const parent = oldPath.split('/').slice(-2, -1)[0] ?? '';
const key = GENERIC.has(stem) && parent ? parent : stem;
/** 全路径（去扩展名）—— 精确命中用，避免 key 太泛时只看得到噪声 */
const pathKey = oldPath.replace(/\.(ts|tsx|js|mjs|cjs)$/, '');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.agent-io', '.inspect', 'coverage']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs|json|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * ★ 分类：**谁抓得到**
 *  - tsc-import     ：真 import ⇒ `tsc --noEmit` 当场报（改就行，不会漏）
 *  - ★ registry     ：scripts/ / .githooks/ / fixtures/ / known-violations —— **tsc 与测试都抓不到**，
 *                     要么运行时炸（钩子 ENOENT），要么判据静默失效
 *  - test-ref       ：测试里的非 import 引用（多数能被测试抓到，但跑得慢）
 *  - doc            ：散文（可选同步）
 */
const CLASS = [
  [/^scripts\//, '★ registry(钩子/脚本)'],
  [/^\.githooks\//, '★ registry(钩子/脚本)'],
  [/^tests\/fixtures\//, '★ registry(夹具)'],
  // ★ 2026-10-03 删除 `[/^\.dependency-cruiser-known-violations\.json$/, '★ registry(架构基线)']`：
  //   那份"已批准的违规清单"**已整体删除**（见 .dependency-cruiser.cjs 与台账 §44.37）——
  //   它 18 条里 8 条已过期（44%），而 `arch` 一直拿它把 2 条**真环**盖成了"✔ 无违规"。
  [/^tests\//, 'test-ref'],
  [/^docs\//, 'doc'],
];

/**
 * ★★ 这一步是 2026-10-02 做 `deadcode/` 小样时被实测逼出来的（工具自己的缺陷）：
 *   本工具按**名字**扫，于是把"**同名标识符**"也当成了"引用这个文件"。实测反例：
 *     · `refactor_langs.ts:61`  `export type RefactorStageKind = 'dead_imports' | 'dead_statements' | …`
 *       —— 那是**联合类型成员**，不是 import；
 *     · `tests/fixtures/tool_set_snapshot.json` `"dead_statements": {`
 *       —— 那是 `refactor_pipeline` 的**步骤名**，不是路径。
 *   ⇒ 判据：**这一行里，名字是不是"贴着路径写"的**（前面有 `/`、或后面跟着 `.ts`/`.js`/`/index`）。
 *     不是 ⇒ 单列一档 `同名标识符`，**标出来让人判，不混进"必改清单"**。
 */
function looksLikePath(line, k) {
  return (
    line.includes('/' + k) ||
    line.includes(k + '/index') ||
    ['.ts', '.tsx', '.js', '.mjs', '.cjs'].some((e) => line.includes(k + e))
  );
}

/**
 * ★★★ 2026-10-03 新增一档：**漏网 —— 工具改不到的、指向被搬文件的模块说明符**。
 *
 * 为什么必须有（实测两次同源事故）：
 *   `rename_file` 按「**AST 形态 + 被调函数名**」认路径，只认
 *   `import … from` / `export … from` / `require()` / `import()` / `vi.mock()` 这些**语法或框架规定的位置**。
 *   实测撞过两次：T12（白名单漏 `import(...)`，`tsc` 报 TS2307）与 2026-10-03（漏 `vi.mock`，
 *   mock 静默失效 ⇒ 被测的是真函数 ⇒ **跑全量才暴露**）。
 *   ⇒ 与其"每撞一次补一个名字"，不如**搬迁前先把这类位置扫出来**。
 *
 * ★ 判据（刻意做到**与项目无关**，工具要能放到任何项目用）：
 *   1. 只认**相对路径**形态的字符串字面量（`'./x'` / `'../x'`）；
 *   2. **剥掉扩展名后**，把它按"该文件所在目录"解析 —— 结果等于被搬文件（也剥扩展名）
 *      ⇒ 它**就是**一个指向被搬文件的模块引用；
 *      ★ 剥扩展名 ⇒ **不假定任何扩展名清单**（别的项目的自定义后缀同样认）。
 *   3. ★ 再排除"**明显不是模块引用**"的位置：`path.` / `spawn` / `exec` / `readFile` / `writeFile` /
 *      `cwd` 这类**文件系统或命令行**的实参 —— 它们也长成 `'../x'`，但改了是错的
 *      （实测那 55 处"像路径却不在 import 里"的字符串，**全是**这类）。
 *
 * ★ 它落在**输出的一片独立区**里，且标注为「必须手改」—— 与"tsc 抓得到"的那档分开，
 *   因为这一档**没有任何自动化会替你发现**（这正是它存在的理由）。
 */
function specsTargetingOld(oldRel, repoRoot) {
  const oldNoExt = oldRel.replace(/\.[^./]+$/, '');
  const NOT_A_SPEC = /(path\.(resolve|join|dirname|relative|normalize|isAbsolute)|spawn|exec|readFile|writeFile|existsSync|mkdir|cwd\()/;
  // ★★ 与 `src/application/refactor/rf-rename/rename_file.ts` 的 `SPECIFIER_APIS` **同源**（那是权威）：
  //   本脚本是**文本级**扫描（不做 AST），所以这里只能用正则近似 —— 故**刻意写宽**（容忍 `vi . mock(` 这类空白）：
  //   宽了只会把"其实已覆盖"的报成"漏网"（人是看得到的假阳性，无害）；
  //   窄了会把"真漏网"咽掉（那是静默失效，正是本档要消灭的东西）。**宁可假阳性。**
  const COVERED = /(\bfrom\s*['"]|\brequire\s*(?:\.\s*resolve\s*)?\(|\bimport\s*\(|\bvi\s*\.\s*(?:mock|doMock|unmock|importActual|importMock)\s*\()/;
  const out = [];
  for (const abs of walk(repoRoot)) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (/\.(json|md)$/.test(rel)) continue; // 只扫代码；JSON/文档由别的档管
    const src = fs.readFileSync(abs, 'utf-8');
    if (!src.includes('/')) continue;
    src.split('\n').forEach((line, i) => {
      if (COVERED.test(line)) return; // 工具能改的形态，不在这里报
      if (NOT_A_SPEC.test(line)) return; // fs / CLI 实参，改了是错的
      for (const m of line.matchAll(/['"](\.\.?\/[^'"]*)['"]/g)) {
        const spec = m[1];
        if (!/\.[A-Za-z]/.test(spec)) continue; // 没有扩展名 ⇒ 不敢判（宁漏不误报）
        const resolved = path.posix
          .normalize(path.posix.join(path.posix.dirname(rel), spec))
          .replace(/\.[^./]+$/, '');
        if (resolved !== oldNoExt) continue;
        out.push({ rel, line: i + 1, text: line.trim().slice(0, 150) });
      }
    });
  }
  return out;
}

const hits = [];
for (const abs of walk(REPO)) {
  const rel = path.relative(REPO, abs).split(path.sep).join('/');
  if (rel === oldPath) continue; // 文件自己不算
  if (rel === 'scripts/preflight_move.mjs') continue; // ★ 本工具的说明文字里必然出现这些名字，别自己命中自己
  const text = fs.readFileSync(abs, 'utf-8');
  if (!text.includes(key)) continue;
  text.split('\n').forEach((line, i) => {
    if (!line.includes(key)) return;
    const isImport = /^\s*(import|export)[\s{*]/.test(line) || /^\s*\}?\s*from\s*['"]/.test(line);
    let kind = CLASS.find(([re]) => re.test(rel))?.[1] ?? (rel.startsWith('src/') ? 'src-other' : 'other');
    if (!looksLikePath(line, key)) {
      // ★ 名字出现了，但**不是贴着路径写的** ⇒ 多半是运行时标识符（步骤名 / 联合类型成员 / 标题文案）
      kind = '同名标识符(多半不是路径 · 需人判)';
    } else if (isImport && (rel.startsWith('src/') || rel.startsWith('tests/'))) {
      kind = 'tsc-import';
    }
    hits.push({ rel, line: i + 1, kind, text: line.trim().slice(0, 150) });
  });
}

const ORDER = ['★ registry(钩子/脚本)', '★ registry(夹具)', '★ registry(架构基线)', 'tsc-import', 'test-ref', 'src-other', 'other', 'doc', '同名标识符(多半不是路径 · 需人判)'];
const groups = new Map(ORDER.map((k) => [k, []]));
for (const h of hits) (groups.get(h.kind) ?? groups.set(h.kind, []).get(h.kind)).push(h);

console.log(`\n=== preflight: 搬 ${oldPath}${newPath ? ' -> ' + newPath : ''} ===`);
console.log(`（标识 = "${key}"${key !== stem ? `（basename 是通用名 "${stem}"，已改用父目录名）` : ''}；按**谁抓得到**分档）\n`);
for (const k of [...ORDER, ...[...groups.keys()].filter((x) => !ORDER.includes(x))]) {
  const g = groups.get(k);
  if (!g?.length) continue;
  const star = k.startsWith('★');
  console.log(`${star ? '★★★' : '   '} [${k}] ${g.length} 处`);
  for (const h of g.slice(0, 25)) console.log(`      ${h.rel}:${h.line}  ${h.text}`);
  if (g.length > 25) console.log(`      …还有 ${g.length - 25} 处`);
  console.log();
}
const danger = hits.filter((h) => h.kind.startsWith('★'));
const sameName = groups.get('同名标识符(多半不是路径 · 需人判)') ?? [];
console.log(
  `小结：${hits.length} 处出现；其中 ★ **tsc 与测试都抓不到** 的 ${danger.length} 处` +
    (sameName.length ? `，另有 ${sameName.length} 处是**同名标识符**（多半不是路径，需人判）` : '') +
    ' ——',
);
console.log(
  danger.length
    ? '⇒ 这些必须在动手前逐个确认：钩子里的会**挡下提交**；基线里的会让 `arch` 判 stale；夹具里的会让门红。'
    : '⇒ 没有"抓不到"的引用（但请仍确认 tests/ 与 docs/）。',
);
// ── ★★★ 新档：**漏网**（工具改不到的、指向被搬文件的模块说明符）──────────────────
//   它与上面所有档都不同：上面那些是"工具/门**能**抓到、只是抓它的地方不同"，
//   而这一档是"**没有任何自动化会告诉你**"—— 所以它单列、且标 `★★★`。
const uncovered = specsTargetingOld(oldPath, REPO);
if (uncovered.length) {
  console.log(`\n★★★ [漏网] ${uncovered.length} 处 —— **工具改不到，必须手改**（搬迁后没有任何自动化会提示你）：`);
  for (const h of uncovered.slice(0, 20)) console.log(`      ${h.rel}:${h.line}  ${h.text}`);
  if (uncovered.length > 20) console.log(`      …还有 ${uncovered.length - 20} 处`);
} else {
  console.log('\n✅ [漏网] 0 处 —— 没有"工具覆盖不到、却指向被搬文件的引用"。');
}

console.log('\n★ 另两件本工具**不覆盖**、但同样会在搬迁时炸的事（今天都遇到了）：');
console.log('   1. 门的**判据**可能认不出"文件夹形式的模块"（只认 `<name>.ts`）⇒ 要泛化成 文件 or `<name>/index.ts`。');
console.log('   2. 新增/移动文件会让**依赖环变化** ⇒ 搬完必须跑 `npm run arch`（0 违规）。');
