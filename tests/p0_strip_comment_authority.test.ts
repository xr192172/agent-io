/**
 * P0 · **剥注释只有两个权威**（R6 · 0.9.1 方向 B 四问）。
 *
 * ## 它钉的五件事
 * ① **实现点读数**（0.9.1②「按能力数」）：分母由 `surveyStripCommentSites()` **现数**，本用例只钉
 *    「权威数 = 2」「`undeclared` 为空」「`missingAuthorities` 为空」与扫描分母。
 *    ★★ 2026-11-06（R6）：**这里原来钉的是 `assert.equal(s.total, 3)`**，而那个 3 是**假绿的产物** ——
 *    扫描腿当时只认 `.replace(` 形态，看不见**手写跨行块状态机**（`contract_gate#cleanSource/cleanLine`
 *    就是这样一份），真值是 8、读数是 3，而这条断言把错的数保护住了（0.25② 的反面：一个把病焊死的断言）。
 *    ⇒ 现在钉**结构**不钉绝对值：绝对值会随仓库演化（今天 src 上是 权威 2 + 已声明 1），
 *    而「未声明必须为空」才是这条检测点真正要防的事。
 * ② **`http://` 不被吃掉**（这是 R6 的**真缺陷**，不是假想）：旧私版 book.ts:354 / symbol_params.ts:118
 *    对 `const u = 'http://x'; // c` 输出 `const u = 'http: `（吃掉半行），权威输出 `const u = 'http://x'; `。
 *    本题同时钉「那个旧正则**已从源码里消失**」（否则行为绿了、第二份实现又长回来）。
 * ③ **异义必不命中**（0.14）：除法后的注释、字符串里的 `//`、字符类里的 `/` 都不许被误吃。
 * ④ **消融**：往一个**夹具项目**里塞一份旧式私有实现 ⇒ `undeclared` 必须变红；清掉 ⇒ 必须回绿。
 *    只测"现在绿"测不出扫描腿有没有在起作用。
 *
 * ## 为什么住 `npm test` 而不是册里的 `behavior-cases`
 * `surveyStripCommentSites` 要读盘（fs）⇒ 不满足 E-CRIT-006 的零值 import；而 ② 的**行为**那一半
 * 已挂在 `src/domain/text_strip.ts#stripComments` 的 `behavior-cases`（那文件零 import，可被 harness 单转译）。
 * ⇒ 分工：**纯谓词/行为**住册，**读数 + 源码形态 + 消融**落在这里。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../src/domain/text_strip.js';
import { surveyStripCommentSites } from '../src/application/meta/integrity/strip_comment_sites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 读仓库相对路径的源文件（剥注释实现点都是**源码形态**的事实，不读 dist） */
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('① 全仓剥注释实现点 = 权威 2 + 已声明保留 1 = 3（现数，不写死）', () => {
  const s = surveyStripCommentSites(ROOT);
  // 分母（0.12③：只给分子等于没验）
  assert.ok(s.scanned > 300, `扫描面太小：scanned=${s.scanned}（应覆盖 src 全量，实测约 390）`);
  // 该有的那两份，且**符号真的还在盘上**
  assert.equal(s.authorities.length, 2, `权威数应为 2，实测 ${s.authorities.length}：${JSON.stringify(s.authorities)}`);
  assert.deepEqual(s.missingAuthorities, [], '声明的权威在磁盘上找不到符号 ⇒ 声明表已与代码脱钩');
  assert.deepEqual(
    s.authorities.map((a) => `${a.file}#${a.kind}`).sort(),
    ['src/domain/text_strip.ts#authority-fragment', 'src/infrastructure/parse/comments.ts#authority-file'],
    '0.9.1④ 的分工：整文件权威 + 片段权威',
  );
  // 乙类：**只许一处**，且必须是那处「两个权威都不覆盖 Python #」的
  assert.deepEqual(s.declared.map((d) => d.file), ['src/application/design/db/gen_design_db.ts', 'src/infrastructure/analysis/health/index.ts'], '乙类（已声明保留）：gen_design_db 剥 //inputs 自述（T-#INC-GENDB）+ health/index 剥 #（Python）');
  // ★ 核心断言：不许有未声明的私有实现
  assert.deepEqual(
    s.undeclared.map((u) => `${u.file}:${u.line} ${u.text}`),
    [],
    '★ 又长出了未声明的私有剥注释实现（0.9.1② 违规）',
  );
  // 读数（分子分母同源）
  assert.equal(s.total, s.authorities.length + s.declared.length);
  // ★★ 2026-11-06（R6）：原来这里是 `assert.equal(s.total, 3, …)` —— **删掉绝对值，原因写在文件头 ①**。
  //   读数仍打印（下面的 console.log 带分母），但**不再拿它当期望值**：它随仓库演化，
  //   而把它钉死过一次就正好掩盖了「扫描腿漏了一整类实现」这件事（真值 8 / 读数 3）。
  assert.ok(s.total >= 2, `权威 2 条必须在分母里，实测 total=${s.total}`);
  for (const d of s.declared) assert.ok(String(d.why ?? '').trim().length > 10, `${d.file}：已声明保留必须写清为什么`);
  console.log(
    `[R6-①] 实现点 ${s.total} = 权威 ${s.authorities.length} + 已声明保留 ${s.declared.length} · ` +
      `未声明 ${s.undeclared.length} · 误检已排除 ${s.excluded.length} · 扫描 ${s.scanned} 个文件`,
  );
});

test('② http:// 不被吃 —— 且产出这条缺陷的旧正则已从源码消失', () => {
  const input = "const u = 'http://x'; // c";
  // 改前（book.ts:354 / symbol_params.ts:118 的旧实现，逐字复制）：
  const before = input.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  // 改后（片段权威）：
  const after = stripComments(input);
  assert.equal(before, "const u = 'http: ", '改前对照必须可复现（否则这条「改完更好」是空话）');
  assert.equal(after, "const u = 'http://x'; ", 'http:// 必须原样保留（否则是「吃掉代码」）');
  assert.notEqual(before, after, '改前改后必须不同 —— 这是 R6 把私有实现收归的直接理由');

  // ★ 源码形态：产生该缺陷的那条正则不许长回来（行为绿但实现长回去 = 第二份权威复活）
  const OLD_PRIV = /\.replace\(\s*\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/g/;
  const mustNotHave = [
    'src/infrastructure/authoring/translate/book.ts',
    'src/infrastructure/parse/symbol_params.ts',
    'src/infrastructure/authoring/translate/verify.ts',
    'src/infrastructure/graph/dead_deps.ts',
    'src/infrastructure/analysis/deadcode/detect_dead_imports.ts',
    'src/infrastructure/index/symbols.ts',
    'src/application/refactor/edit/remove_dead_imports.ts',
  ];
  for (const rel of mustNotHave) {
    assert.ok(!OLD_PRIV.test(read(rel)), `${rel}：私有块注释剥离正则又出现了（应改调权威）`);
  }
  // 调用点必须指向权威（片段档）
  assert.match(
    read('src/infrastructure/authoring/translate/book.ts'),
    /import \{ stripComments \} from '\.\.\/\.\.\/\.\.\/domain\/text_strip\.js'/,
    'book.ts 未改调片段权威',
  );
  assert.match(read('src/infrastructure/authoring/translate/book.ts'), /const s2 = stripComments\(expr\);/, 'book.ts:tokenizeGoType 的内联复制未收归');
});

test('③ 异义必不命中：除法 / 字符串 / 模板 / 正则里的 // 都不许被吃', () => {
  const cases: Array<[string, string, string]> = [
    ['a / b // c', 'a / b ', '除法后跟注释：注释剥掉、除号不动'],
    ["const s = 'a//b'; // c", "const s = 'a//b'; ", '单引号字符串里的 // 必须保留'],
    ['const t = `x//y`; // c', 'const t = `x//y`; ', '模板串里的 // 必须保留'],
    ['const re = /[/]/; // c', 'const re = /[/]/; ', '正则字符类里的 / 不许当注释开头'],
    ['const u = "https://a/b"; /* c */ const v = 1;', 'const u = "https://a/b";  const v = 1;', '双引号 URL + 块注释'],
    ['f(a, /* c */ b)', 'f(a,  b)', '形参片段里的块注释（真注释要剥）'],
  ];
  for (const [input, want, why] of cases) {
    assert.equal(stripComments(input), want, why);
  }
});

test('④ 消融：塞一份旧式私有实现 ⇒ undeclared 变红；清掉 ⇒ 回绿', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-strip-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    // 基线：一个干净文件 ⇒ 扫不到实现点
    fs.writeFileSync(path.join(dir, 'src/clean.ts'), ['// 只有注释，没有实现', 'const x = 1;', 'export const y = x;', ''].join('\n'), 'utf8');
    const clean = surveyStripCommentSites(dir);
    assert.equal(clean.undeclared.length, 0, `干净夹具不该有未声明实现，实测 ${JSON.stringify(clean.undeclared)}`);
    assert.equal(clean.total, 0, '夹具里没有那两个权威文件 ⇒ 分母必须是 0（不是硬编码的 3）');
    assert.equal(clean.missingAuthorities.length, 2, '夹具里读不到两份权威 ⇒ 必须如实报缺（0.9.4 第 1 行：读不到 ≠ 没有）');

    // 消融：把 R6 删掉的那份私有实现原样写回去
    fs.writeFileSync(
      path.join(dir, 'src/private_strip.ts'),
      [
        'export function stripComments(text: string): string {',
        "  return text.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ').replace(/(?<!:)\\/\\/[^\\n]*/g, '');",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const ablated = surveyStripCommentSites(dir);
    assert.equal(ablated.undeclared.length, 1, '★ 消融未生效：私有实现被写回去了，扫描腿却没红');
    assert.equal(ablated.undeclared[0].file, 'src/private_strip.ts');
    console.log(`[R6-④] 消融命中：${ablated.undeclared[0].file}:${ablated.undeclared[0].line} ⇒ undeclared=1（该红）`);

    // 还原：删掉 ⇒ 必须回绿（0.16 的反向要求：不是「永远会亮」）
    fs.rmSync(path.join(dir, 'src/private_strip.ts'));
    const restored = surveyStripCommentSites(dir);
    assert.equal(restored.undeclared.length, 0, '还原后必须回绿（否则这条不是检测点，是噪音）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * ★★★ ⑤ 消融：**手写跨行块注释状态机**必须被形态腿③ 抓到。
 *
 * ## 为什么必须有这一条（0.25②：检测点要有鉴别力）
 * 2026-11-06 实测事故：只有前两条形态腿（`.replace(` + 转义斜杠序列）时，本仓报「实现点 3 / 未声明 0」，
 * 而真值是 **8** —— `src/infrastructure/analysis/contract_gate/core.ts#cleanSource/cleanLine`
 * 是一份**手写字符状态机**（`inBlock` 跨行标志位 + `indexOf` 找注释开闭），既不以 `stripComments` 命名、
 * 也不含 `.replace(` 形态 ⇒ 前两条腿**结构上看不见它**。而 `total===3` 那条断言正把这个假绿焊死。
 *
 * ⇒ 这条用例把「跨行块状态机」这一**类**实现做成夹具：腿③ 在，它就是红的；腿③ 被摘掉，它变绿 ⇒ 消融有牙。
 */
test('⑤ 消融：手写跨行块注释状态机必须被形态腿③ 抓到（否则又回到「真值 8 / 读数 3」）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-strip-sm-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    // 一份**不叫 stripComments、也没有 .replace( 形态**的剥注释实现：跨行块状态机
    fs.writeFileSync(
      path.join(dir, 'src/scan_stateful.ts'),
      [
        'export function scanStateful(src: string): string {',
        '  const out: string[] = [];',
        '  let inBlock = false;',
        "  for (const line of src.split('\\n')) {",
        "    const open = line.indexOf('/*');",
        "    const close = line.indexOf('*/');",
        '    if (inBlock) {',
        '      if (close >= 0) inBlock = false;',
        '      continue;',
        '    }',
        '    if (open >= 0) {',
        '      inBlock = true;',
        '      continue;',
        '    }',
        '    out.push(line);',
        '  }',
        "  return out.join('\\n');",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const s = surveyStripCommentSites(dir);
    assert.equal(
      s.undeclared.length,
      1,
      `★ 消融未生效：手写跨行块状态机没被抓到 ⇒ 形态腿③ 这一条腿不在（实测 undeclared=${JSON.stringify(s.undeclared)}）`,
    );
    assert.equal(s.undeclared[0].file, 'src/scan_stateful.ts');
    console.log(`[R6-⑤] 消融命中：${s.undeclared[0].file}:${s.undeclared[0].line} ⇒ undeclared=1（该红）`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
