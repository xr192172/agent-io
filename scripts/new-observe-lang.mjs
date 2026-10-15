#!/usr/bin/env node
/**
 * new-observe-lang.mjs —— **加一门 observe 语言 = 生成一份填空题**。
 *
 * ## 它做什么（以及**不**做什么）
 *   ✅ 从模板生成 `src/infrastructure/analysis/observe/instrument_<lang>.ts`
 *      —— 里面已经**装好骨架**（`instrumentFileWithHooks` / `instrumentProjectWithHooks`
 *      / `matchesContract` / `collectSourceFiles`），并且**留好 3 个具名空格**（① 命名 / ② 遍历 / ⑥ 取值）
 *      + 一份语法小抄 + 2 个语句渲染件。
 *   ✅ 印出**填空清单**：还差哪几格、各在哪个文件哪个函数、填什么判据。
 *   ✅ 印出**注册片段**（贴进 `observe_langs.ts` 的那段）。
 *   ❌ **不替你填**。空格没填时**会当场抛错并指名该填哪一格**（ARC-7：不静默产出跑不起来的代码）。
 *
 * ## 用法
 *   node scripts/new-observe-lang.mjs <langId> [选项]
 *   node scripts/new-observe-lang.mjs ruby --ext rb --probe-module camprobe \
 *       --comment hash --root-marker 'observe-lang-ruby/camprobe.rb' \
 *       --return-node return --fn-types method --implicit-return
 *   // Java（braces 体 + 探针类要拷进被测工程）：
 *   node scripts/new-observe-lang.mjs java --ext java --probe-module Camprobe \
 *       --comment slash --root-marker 'observe-lang-java/Camprobe.java' \
 *       --return-node return_statement --fn-types method_declaration,constructor_declaration \
 *       --body-style braces --indent-unit '    ' --probe-file Camprobe.java
 *
 * ★ `--comment` **用助记词** slash / hash / dash，别传字面量：
 *   Git Bash(MSYS) 会把**裸 `//`** 当路径根并掉（实测 `--comment '//'` 拿到的是 `/`）
 *   ⇒ 生成的幂等标记少一根斜杠 ⇒ 宿主编译不过（2026-10-15 实测踩到）。
 *
 * ## 为什么这样切（本仓 "六格" 的落地）
 *   · 骨架里有：③应用模型 / ④sink契约 / ⑤错误传播 / 主流程 / 项目级四件 ⇒ **语言无关**；
 *   · 空格里只有：①命名 / ②遍历 / ⑥取值 + 语法小抄 ⇒ **语言专属**。
 *   ⇒ 这就是"加语言只补小文件"的**可执行版本**：文件是生成的，你只填三个函数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMPL = path.join(HERE, 'templates/observe-lang.instrument.ts.tmpl');

const argv = process.argv.slice(2);
const langId = argv.shift();
if (!langId || langId.startsWith('--')) {
  console.error(
    '用法: node scripts/new-observe-lang.mjs <langId>' +
      ' [--ext e] [--probe-module m] [--comment slash|hash|c] [--root-marker p] [--return-node t]' +
      ' [--fn-types a,b,c] [--implicit-return] [--body-style braces|indent]' +
      " [--indent-unit s] [--probe-file f]",
  );
  process.exit(2);
}
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

/** langId 必须与 feature 名同规矩（`^[a-zA-Z0-9_-]+$`），否则后面注册会卡。 */
if (!/^[a-zA-Z0-9_-]+$/.test(langId)) {
  console.error(`langId "${langId}" 不合法：只允许字母/数字/_/-`);
  process.exit(2);
}

const ext = opt('ext', '');
const probeModule = opt('probe-module', 'camprobe');
// ★ `--comment` 支持助记词：**slash → `//`**、hash → `#`、dash → `--`。
//   为什么不直接传字面量：Git Bash(MSYS) 会把**裸 `//`** 当路径根给并掉（实测 `--comment '//'`
//   拿到的是 `/`）⇒ 生成出 `comment: '/'` ⇒ 幂等标记变成 `/ observe:instrumented` ⇒ 宿主编译不过。
const COMMENT_MNEMONIC = { slash: '//', hash: '#', dash: '--', semi: ';', pct: '%' };
const comment = COMMENT_MNEMONIC[opt('comment', '#')] ?? opt('comment', '#');
const rootMarker = opt('root-marker', `observe-lang-${langId}/${probeModule}.${ext || 'txt'}`);
const returnNode = opt('return-node', 'return');
const implicitReturn = opt('implicit-return', 'false') === 'true';
/** ★★ 函数体形态（加 Java 时踩出来的第 4 个轴）：braces = 有花括号分隔（Java/C/Go/JS）；
 *   indent = 体就是语句列表（Python/Ruby）。两者注入点与语句终止符都不同。 */
const bodyStyle = opt('body-style', 'indent');
const indentUnit = opt('indent-unit', '  ');
const probeFile = opt('probe-file', `${probeModule}.${ext || 'txt'}`);
const fnTypes = opt('fn-types', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!ext) { console.error('缺 --ext（这门语言的源文件扩展名，不含点）。例：--ext rb'); process.exit(2); }
if (bodyStyle !== 'braces' && bodyStyle !== 'indent') {
  console.error(`--body-style 只能是 braces 或 indent（实得 "${bodyStyle}"）`);
  process.exit(2);
}
if (fnTypes.length === 0) {
  console.error('缺 --fn-types（「函数」节点类型，逗号分隔）。例：--fn-types method');
  process.exit(2);
}

const LANG = langId;
const LANG_CC = LANG.replace(/(^|[-_.])(\w)/g, (_, __, c) => c.toUpperCase()).replace(/[-_.]/g, '');
const out = path.join(REPO, `src/infrastructure/analysis/observe/instrument_${langId.replace(/-/g, '_')}.ts`);

if (fs.existsSync(out)) {
  console.error(`已存在，不覆盖：${path.relative(REPO, out)}`);
  process.exit(1);
}

const tmpl = fs.readFileSync(TMPL, 'utf8');
let src = tmpl
  .replaceAll('{{LANG_CC}}', LANG_CC)
  .replaceAll('{{LANG}}', LANG)
  .replaceAll('{{PROBE_MODULE}}', probeModule)
  .replaceAll('{{COMMENT}}', comment)
  .replaceAll('{{ROOT_MARKER}}', rootMarker)
  .replaceAll('{{EXT}}', ext)
  .replaceAll('{{RETURN_NODE}}', returnNode)
  .replaceAll('{{IMPLICIT_RETURN}}', implicitReturn ? 'true' : 'false')
  .replaceAll('{{BODY_STYLE}}', bodyStyle)
  .replaceAll('{{INDENT_UNIT}}', indentUnit)
  .replaceAll('{{PROBE_FILE}}', probeFile)
  .replaceAll('{{FN_TYPES}}', fnTypes.map((t) => `'${t}'`).join(', '));

// 模板里 `{{...}}` 一个都不该剩
const leftover = src.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) {
  console.error(`模板还有未替换的占位符：${[...new Set(leftover)].join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(out, src, 'utf8');

console.log(`✅ 已生成填空题：${path.relative(REPO, out)}`);
console.log('');
console.log('── 还差这几格（每格一个具名函数；**没填就抛错，不会静默**）──');
console.log(`  ① 命名规则   probeNameOf(fn, mod)      —— 探针叫什么（含所属 + 匿名块带 @L行C列）`);
console.log(`  ② 遍历模型   scanFunctions(root)        —— 函数在哪 / body 是哪段（知识点类型建议：${fnTypes.join(', ')}）`);
console.log(`  ⑥ 取值时机   returnValueOf(ret)        —— return 的返回值节点（node 类型经验值：${returnNode}）`);
console.log(`  · 语句渲染   probeCall(name, fields)    —— 一条探针调用语句在你语言里长什么样`);
console.log(`  · 语句渲染   buildImport(spec)          —— 头部 import 怎么写`);
console.log(`  · 语法小抄   ${LANG_CC}_SYNTAX            —— comment / fnTypes / rootMarker`);
console.log('');
console.log('── 还得做（不是填空，是各语言的必然件）──');
console.log(`  1) 写探针运行时：observe-lang-${langId}/（Python 那份是 148 行的量级参照）`);
console.log(`  2) 在 src/infrastructure/analysis/observe/observe_langs.ts 注册一个包，片段：`);
console.log('');
console.log(`  export const ${langId}ObservePack: ObserveLangPack = {`);
console.log(`    lang: '${langId}',`);
console.log(`    label: '${LANG}',`);
console.log(`    isSourceFile: (rel) => isInstrumentable${LANG_CC}File(rel),`);
console.log(`    inProcess: true,`);
console.log(`    manifestFiles: [], // 这门语言的项目根路标`);
console.log(`    sinkHint: [/* ★ 必须自带：缺了会被印上别的语言的接法（T319） */],`);
console.log(`    limitations: [/* ★ 如实写：哪些模式没实现（T312：不许静默） */],`);
console.log(`    async instrument(root, opts) {`);
console.log(`      const scanned = collect${LANG_CC}Files(root).length;`);
console.log(`      const results = await instrument${LANG_CC}Project(root, {`);
console.log(`        projectRoot: opts.projectRoot, write: !opts.dryRun, contractProbes: opts.contractProbes,`);
console.log(`      });`);
console.log(`      const rep: ObserveInstrumentReport = { lang: '${langId}', dryRun: opts.dryRun, scanned,`);
console.log(`        files: results.map((r) => ({ file: r.file, sites: r.sites, error: r.error })), };`);
console.log(`      const total = rep.files.reduce((n, f) => n + (f.error ? 0 : f.sites.length), 0);`);
console.log(`      if (!opts.dryRun && total > 0) {`);
console.log(`        const ledger = buildProbeLedger(results, root, { contractMode: opts.contractProbes !== undefined });`);
console.log(`        rep.ledger = { file: saveProbeLedger(root, ledger), summary: ledgerSummary(ledger), raw: ledger };`);
console.log(`      }`);
console.log(`      return rep;`);
console.log(`    },`);
console.log(`  };`);
console.log('');
console.log('── 验它（★ 这一步才是"框架成立"的判据）──');
console.log(`  node certs/t316-observe-pack-cert.mjs     # 三语言出生证；新语言加一节进去，四条判据全绿才算过`);
console.log('');
console.log(`★ 报告口径：填完之后用 wc -l 量一下 instrument_${langId.replace(/-/g, '_')}.ts —— `);
console.log('  Python（第 3 门）是 319 行 / 去注释 205 行；这个数就是"补一门语言的真实代价"。');
