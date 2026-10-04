/**
 * rename_file —— 文件级智能重命名（防文件悬空）
 *
 * 目标：把"改一个文件的名字（或移动/重命名路径）"做成全仓一致的安全操作。
 * 三步走：算影响面 → 迁移文件 → 自动改写全项目 import/require 引用表并重索引。
 *
 * 复用规范基建（不自己造轮子）：
 *   - resolveImportTarget（db/symbols）判定 import 规范字是否真正解析到被移动文件
 *   - removeFile / syncFile（db/symbols）完成被移动文件及改写文件的索引重建
 *   - parseAstRoot（ts_kernel/kernel）定位 import 源字面量的字节偏移，避免正则误改注释/字符串
 *
 * 保守边界（宁漏不误，与 rename_symbol 同源）：
 *   - 只改写"被移动文件的相对导入"；包名引用 / 解析不到旧文件的引用不碰。
 *   - 一旦目标路径已存在 → 原子阻断，什么都不落盘。
 *   - dry_run 只出影响面报告，不迁移、不改写、不重索引。
 */

import fs from 'node:fs';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { parseAstRoot, type SyntaxNodeLike } from '../../../infrastructure/parse/kernel.js';
import { TS_JS_EXTS } from '../../../infrastructure/parse/index.js';
import { resolveImportTarget, syncFile, removeFile } from '../../../infrastructure/index/symbols.js';
import { getProjectCacheDb, closeProjectCacheDb } from '../../../infrastructure/index/db.js';
import { createProtectGuard } from '../rf-snapshot/protect.js';
import { reopenAndResolveAfterWrite } from '../../observe/runtime/write_gate.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

// 扫描范围内源码扩展名：TS 系全量 + Python（相对导入语义与 TS 同构，复用同一相对路径重算逻辑）。
// Go 的 import 是模块包路径（非相对文件路径），移动单文件不改变途径名 → 不纳入扫描。
// ★ 清单来自内核唯一权威（`ts_kernel/source_exts.ts`）—— 不再就地手写。
const SOURCE_EXTS = new Set<string>([...TS_JS_EXTS, '.py']);

function walkProjectFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build' || e.name === '.git' || e.name.startsWith('.')) continue;
      walkProjectFiles(p, out);
    } else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) {
      out.push(p);
    }
  }
}

interface RefEdit {
  importerRel: string;
  importerAbs: string;
  source: string;      // 旧规范字（不带引号）
  toSource: string;    // 新规范字（不带引号）
  pos: number;         // 该字面量在文件内的字节偏移
  len: number;         // 整个 string 节点长度（含引号）
  quote: string;       // 原引用用的引号字符
}

export interface RenameFileInput {
  project_dir: string;
  /** 源文件：相对 project_dir 或绝对路径 */
  from: string;
  /** 目标文件：相对 project_dir 或绝对路径 */
  to: string;
  /** true = 只算影响面，不迁移/不改写/不重索引 */
  dry_run?: boolean;
}

export interface RenameFileResult {
  ok: boolean;
  dryRun: boolean;
  fromRel: string;
  toRel: string;
  moved: boolean;
  /** 逐引用更新明细 */
  references: Array<{ file: string; fromSource: string; toSource: string }>;
  editCount: number;
  /** 无法自动处理、需人工确认的事项（语义变化等） */
  pending: string[];
  blocked?: string[];
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/').split('\\').join('/');
}

/** 被移动文件 → 对某个 importer 的新规范字（保留老引用的扩展名风格） */
function newSpecifier(importerRel: string, oldSource: string, newRelNoExt: string): string {
  const dir = path.posix.dirname(importerRel);
  let rel = path.posix.relative(dir, newRelNoExt);
  if (!rel || rel === '.') rel = '';
  rel = rel.split('\\').join('/');
  if (rel && !rel.startsWith('.')) rel = './' + rel;
  // 保留扩展名风格：老写法带扩展名 → 新写法也带扩展名（如 NodeNext 的 .js 引 .ts）
  const m = oldSource.match(/\.([A-Za-z0-9]+)$/);
  if (m && !rel.endsWith('.' + m[1])) rel += '.' + m[1];
  return rel || '.';
}

/**
 * Python 相对导入解析：
 *   `from .foo import x` → 当前文件目录下的 foo.py
 *   `from ..src.foo import x` → 上一级目录下的 src/foo.py（前导点数量 = 向上爬的层数）
 *   `from . import x` → 当前文件目录这个包本身（__init__.py）
 * 返回值是项目内相对文件路径（含 .py 尾缀），解析不到返回 null。
 */
function resolvePythonTarget(projectRoot: string, fromRel: string, source: string): string | null {
  let dots = 0;
  while (dots < source.length && source[dots] === '.') dots++;
  const rest = source.slice(dots); // ''（纯包）或 'a.b.c'
  let baseDir = path.posix.dirname(fromRel);
  // 前导点数：`from .x` 停在当前包目录；`from ..x` 上溯 1 层 → 爬升 = dots - 1
  for (let i = 1; i < dots; i++) {
    const up = path.posix.dirname(baseDir);
    if (up === baseDir) return null; // 已到项目根仍要上溯 → 逃逸，拒绝
    baseDir = up;
  }
  let base: string;
  if (rest) base = path.posix.join(baseDir, rest.split('.').join('/'));
  else base = baseDir; // from . / from .. → 目录（包）本身
  const candidates = rest
    ? [base + '.py', `${base}/__init__.py`, `${base}/index.py`]
    : [`${base}/__init__.py`, `${base}/index.py`];
  for (const c of candidates) {
    if (c.startsWith('..')) continue; // 不允许逃逸项目根
    if (fs.existsSync(path.join(projectRoot, c))) return c;
  }
  return null;
}

/**
 * Python 相对导入新规范字：把移动后的文件相对位置转成前导点形式。
 *   同目录（src→src/bar.py 引 foo）    ：  .bar
 *   上一级目录（src/entry 引 sub/bar）  ：  ..sub.bar
 *   再上一级（sub/bar 引 src/helper）   ：  ..src.helper
 * 规律：从引者所在目录到目标路径的相对跳数 up 决定前导点 = up + 1。
 */
function newPySpecifier(importerRel: string, newRelNoExt: string): string {
  const dir = path.posix.dirname(importerRel);
  let rel = path.posix.relative(dir, newRelNoExt).split('\\').join('/');
  // 拆出向上跳数（..）
  let up = 0;
  while (rel.startsWith('../')) {
    up++;
    rel = rel.slice(3);
  }
  if (rel === '.' || rel === '') return '.'; // 引者自身目录这种退化情况
  const dots = '.'.repeat(up + 1);
  const modulePart = rel.split('/').join('.');
  return dots + modulePart;
}

/**
 * 「**这个 API 的第 1 个参数是模块说明符**」—— 一份**显式的表**（取代原先散在正则里的白名单）。
 *
 * ★★ 为什么**只能**这样枚举（两次实测换来的，别再想着"放宽成按参数像不像路径判"）：
 *   `expect('./a.js')` 与 `vi.mock('./a.js')` **字面完全一样** —— 一个是**数据**、一个是**引用**。
 *   全仓实测：把判据放宽成"任何函数调用的第 1 实参是相对路径"⇒ 命中 44 处，
 *   其中 **8 处 `expect(`（测试断言里的字符串）+ 2 处 `URL(` + 1 处注释里的例子** ⇒ **误伤**。
 *   ⇒ **唯一的区分依据就是"被谁调用"**。所以"枚举 API 名"是这个问题**绕不开的形态**，不是偷懒。
 *
 * ★ 为什么"模块引用"这个属性**在世界里就是关系、不是值**：
 *   同一个字符串 `'./a.js'` 可以是模块说明符（`from` / `require` / `vi.mock`）、
 *   也可以是 fs 路径实参（`path.resolve(x, './a.js')`）、命令行参数（`spawnSync('go', ['./...'])`）、
 *   断言数据（`expect('./a.js')`）。**光看值判不出来**。
 *
 * ★ 换测试框架 / 换语言包时，**在这里加一行**即可（不是"注册框架"——是"登记一个约定"）。
 */
const SPECIFIER_APIS: ReadonlySet<string> = new Set<string>([
  // ── 语言级：CommonJS / dynamic import（`import()` 也覆盖"类型位置的内联 import"）──
  'require',
  'require.resolve',
  'import',
  // ── vitest 的模块 mock 族（本仓用 vitest）──
  'vi.mock',
  'vi.doMock',
  'vi.unmock',
  'vi.importActual',
  'vi.importMock',
  // 用 jest 之类就再加：'jest.mock' / 'jest.unmock' / 'jest.doMock' …
]);

/**
 * 取"被调函数"的**结构化名字**：`vi.mock` / `require.resolve` / `import` / `myMock`。
 *
 * ★★ **必须走 AST 结构，不能拿 `fn.text` 去正则匹配** —— 实测（2026-10-04，探针四例）：
 *
 *   | 源码                        | `fn.text`（节点文本） | AST 取到的名字 | 旧正则判定 |
 *   |---|---|---|---|
 *   | `vi.mock('./a.js')`         | `vi.mock`              | `vi.mock`      | ✅ |
 *   | `vi . mock('./b.js')`       | `vi . mock`            | `vi.mock`      | ❌ **漏** |
 *   | `require.resolve('./c.js')` | `require.resolve`      | `require.resolve` | ✅ |
 *   | `vi .mock("./d.js")`（含换行+tab） | `vi\n\t.mock`  | `vi.mock`      | ❌ **漏** |
 *
 *   ⇒ **AST 4/4 对，正则 2/4 错**，而且错的时候**静默**（那处引用**不会被改写**，没有任何提示）。
 *   `vi . mock(...)` 是**合法 JS**（格式化工具、手写、跨行都会产生）。
 *
 * ★ 本仓内核早就表过这个态（`SyntaxNodeLike.isNamed` 的注释）：
 *   「关键字 type 也是纯字母，**`\w` 正则无法区分**」—— 凡是**有语法结构**的地方，就该读结构。
 */
function calleeName(fn: SyntaxNodeLike | null): string | null {
  if (!fn) return null;
  if (fn.type === 'identifier') return fn.text; // 如 require / myMock
  if (fn.type === 'member_expression') {
    const obj = fn.childForFieldName('object')?.text ?? '';
    const prop = fn.childForFieldName('property')?.text ?? '';
    return obj && prop ? `${obj}.${prop}` : null;
  }
  // ★★ `import(...)` 的函数节点 **`type === 'import'`**（tree-sitter 的**关键字节点**），
  //   **不是 `identifier`** —— 实测（2026-10-04，探针三例）：
  //     `import('./a.js')`        ⇒ fnType=`import`,      fnText=`import`
  //     `import('./b.js').T`（类型位置内联）⇒ 同上
  //     `require('./c.js')`       ⇒ fnType=`identifier`,  fnText=`require`
  //   ⇒ 只认 identifier/member_expression 会**静默漏掉所有 `import()`**（2026-10-04 那笔改造就踩了，
  //     靠 `tests/tools/rename_file.test.ts` 的 T12 用例抓回来 —— **那一版是我把文本兜底改成结构时弄丢的**）。
  //   兜底：**单个词**才接受（防 `a . b` 这类混合形态混进来）；★ 结果只用于查 `SPECIFIER_APIS` 表
  //   （表里只有约定名）⇒ 即便放宽也不会误判。
  return /^[A-Za-z_$][\w$]*$/.test(fn.text) ? fn.text : null;
}

/**
 * 取"某个实参里的模块说明符字面量"，并能**穿透 `import(...)` 这层包装**。
 *
 * ★★ 为什么需要穿透（2026-10-04 查证）：**vitest 官方文档明确推荐写 `vi.mock(import('./x'))`**。
 *
 *   **出处 1（官方文档，硬）**：vitest.dev《Mocking Modules》的 WARNING 逐字：
 *     「**Always pass `import('./db.js')` rather than a plain string `'./db.js'`.**
 *       When you use `import()`, TypeScript can infer the module's types…
 *       **As a bonus, if you rename or move the file in your IDE, the import path will be
 *       updated automatically. If you use a string, you lose both the type safety and the
 *       automatic refactoring.**」
 *     ⇒ ★ 官方**明文说"用字符串会失去自动重构"** —— 等于承认这是生态盲区，并把 `import()` 当逃生舱。
 *
 *   **出处 2（由来，issue）**：vitest-dev/vitest **#5671**「Mock module with import(path) to be
 *     resistant to file renaming」(zirkelc, 2024-05-05) 逐字：
 *     「the import statements are updated **but the mocks are not**. That means **suddenly, the
 *       tests fail and it may not be obvious why**.」
 *     —— ★ 这正是本仓 2026-10-03 实测撞到的同一件事（`vi.mocked(...).mockImplementation is not
 *     a function`，跑全量才暴露）。该 issue 的 **"Suggested solution" 是提议者提的**（不是官方定论）。
 *
 *   ⇒ 两种写法都要认：`vi.mock(import('./x'))` / `vi.mock(await import('./x'))`。
 */
function literalOfSpecifierArg(
  node: SyntaxNodeLike | null,
  depth = 0,
): { startIndex: number; text: string; inner: string } | null {
  if (!node || depth > 3) return null;
  const direct = stringLiteral(node);
  if (direct) return direct;
  // 剥一层包装（`await import(...)` / `(import(...))` / `import(...) as X`）—— 都只有一个"被包住的表达式"
  const unwrapField = node.childForFieldName('argument');
  const inner = unwrapField ?? node.child(1) ?? node.child(0);
  if (node.type !== 'call_expression' && inner) return literalOfSpecifierArg(inner, depth + 1);
  // `import('./x')` 本身：取它自己的实参，再进一层
  if (node.type === 'call_expression' && calleeName(node.childForFieldName('function')) === 'import') {
    const args = node.childForFieldName('arguments');
    if (args) {
      for (let i = 0; i < args.childCount; i += 1) {
        const got = literalOfSpecifierArg(args.child(i), depth + 1);
        if (got) return got;
      }
    }
  }
  return null;
}

/** 提取一个 import 语句源字面量（TS/JS）：返回 { text(含引号), inner, startIndex } 或 null */function importSourceLiteral(node: SyntaxNodeLike): { startIndex: number; text: string; inner: string } | null {
  const lit = stringLiteral(node.childForFieldName('source'));
  if (lit) return lit;
  // require('../x') / require.resolve('../x') / **import('../x')**：call_expression 没有 source 字段，
  // 需从 arguments 取。
  //
  // ★★ 2026-09-30（T12）：原先正则只有 `require(\.resolve)?` ⇒ **不认 `import(...)`**。
  //   后果（实测）：搬 `src/dsl/` → `src/domain/` 时，`src/renderer/html_renderer.ts:89` 的
  //   `function renderContentBlocks(blocks: import('../../dsl/types.js').ContentBlock[])`
  //   **没被改写** ⇒ `tsc` 报 `TS2307: Cannot find module '../dsl/types.js'`。
  //   ★ 实测该写法在 tree-sitter（typescript）下的节点形状：
  //     `member_expression > call_expression(function=`import` 关键字节点, arguments=(string))`
  //   —— 与动态 `import('../x')` **同一个形状**，所以这一条同时覆盖"类型位置的内联 import"与"动态 import"。
  //   ★ 这是个**定时炸弹**：全仓 5 处这种写法，另 4 处只是恰好还没搬到 ⇒ 不修的话每族搬迁都会踩。
  //
  // ★★ 2026-10-03（**第二次同类**）：白名单又漏了 **`vi.mock(...)`**（vitest 的模块 mock）。
  //   实测：搬 `application/observe/memory_observe.ts` 进 `observe/capture/` 后，
  //   `tests/daemon/memory_watch.test.ts` 的 `vi.mock('.../observe/memory_observe.js')` **没被改**
  //   ⇒ mock 指向已不存在的文件 ⇒ **mock 静默失效** ⇒ 被测的是**真函数**
  //   ⇒ 报 `vi.mocked(sampleRemote).mockImplementation is not a function`（**跑全量才暴露**）。
  //   ★ 根因与 T12 同一条：**本函数按「AST 形态 + 被调函数名」认路径**，名字不在白名单里就够不到。
  //   ⇒ 白名单扩到"**语法/框架规定『这个参数就是模块说明符』**"的一族（可枚举、零误判）：
  //      `require(.resolve)` · `import()` · `vi.mock/doMock/unmock/importActual/importMock`。
  //   ★ **不**扩到"业务代码里自己写的路径字符串"（如 `FEATURE_FILES = ['src/…']`）——
  //     那类无法判断"这个字符串是不是路径"，泛化会引入误改；它们的正解是**别把路径存成数据**
  //     （见 `sync_contracts.resolveImplPath()`：按 basename 现算，天然不会因搬迁过期）。
  if (node.type === 'call_expression') {
    // ★★ 2026-10-04：原来是 `fn.text.trim()` + 一条正则 —— **那是把已有语法结构降级成文本再匹配**，
    //   实测会**静默漏**（`vi . mock('./x')` / 跨行的 `vi .mock(...)`，见 `calleeName` 的注释）。
    //   改成读 AST 结构 + 查 `SPECIFIER_APIS` 表 ⇒ 与空白、书写风格、跨行都无关。
    if (SPECIFIER_APIS.has(calleeName(node.childForFieldName('function')) ?? '')) {
      const args = node.childForFieldName('arguments');
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          // ★ 用 `literalOfSpecifierArg` 而不是 `stringLiteral`：穿透 `vi.mock(import('./x'))`
          //   —— 那是 **vitest 官方推荐的写法**（见该函数的注释与 issue #5671）。
          const lit2 = literalOfSpecifierArg(args.child(i));
          if (lit2) return lit2;
        }
      }
    }
  }
  return null;
}

/** string/string_fragment 节点 → { text(含引号), inner, startIndex }，非字符串返回 null */
function stringLiteral(s: SyntaxNodeLike | null): { startIndex: number; text: string; inner: string } | null {
  if (!s || !['string', 'string_fragment'].includes(s.type)) return null;
  const text = s.text;
  if (text.length < 2 || s.startIndex == null) return null;
  const q = text[0];
  if ((q === "'" || q === '"' || q === '`') && text.endsWith(q)) {
    return { startIndex: s.startIndex, text, inner: text.slice(1, -1) };
  }
  return null;
}

/** 深度优先收集所有 import 源字面量（含 require / import()，AST 语言无关地按 import 节点收集） */
function collectImportLiterals(node: SyntaxNodeLike, out: Array<{ node: SyntaxNodeLike; lit: { startIndex: number; text: string; inner: string } | null }>, depth = 0): void {
  if (depth > 300) return;
  if (
    node.type === 'import_statement' ||
    node.type === 'export_statement' ||
    node.type === 'import_expression' ||
    node.type === 'call_expression'
  ) {
    const lit = importSourceLiteral(node);
    if (lit) {
      out.push({ node, lit });
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) collectImportLiterals(c, out, depth + 1);
  }
}

/** Python 相对导入字面量：收集 `from .mod import a` / `from . import b` 的模块路径部分（.mod / .） */
function collectPythonImportLiterals(node: SyntaxNodeLike, out: Array<{ node: SyntaxNodeLike; lit: { startIndex: number; text: string; inner: string } | null }>, depth = 0): void {
  if (depth > 300) return;
  if (node.type === 'import_from_statement') {
    // 从文本定位 `from X` 的模块路径（relative_import = .mod / .；非相对则 dotted_name）
    const m = node.text.match(/^\s*from\s+([\w.]+)/);
    const modText = m ? m[1] : null;
    if (modText && modText.startsWith('.')) {
      // 模块路径字节偏移 = 节点起始 + "from " 长度
      const relIdx = 5; // "from " 长度
      const inner = modText;
      if (node.startIndex != null) {
        out.push({
          node,
          lit: { startIndex: node.startIndex + relIdx, text: inner, inner },
        });
      }
      // 后续仍有子节点（import 名），但不再往下找
      return;
    }
    // 非相对 from（from pkg import）→ 包路径，移动单文件不改变 → 忽略
    return;
  }
  if (node.type === 'import_statement') {
    return; // import pkg / import a.b → 包路径，忽略
  }
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) collectPythonImportLiterals(c, out, depth + 1);
  }
}

async function renameFileCore(input: RenameFileInput): Promise<RenameFileResult> {
  const projectRoot = path.resolve(input.project_dir);
  const toAbs = path.isAbsolute(input.to) ? path.resolve(input.to) : path.resolve(projectRoot, input.to);
  const fromAbs = path.isAbsolute(input.from) ? path.resolve(input.from) : path.resolve(projectRoot, input.from);
  const fromRel = toPosix(path.relative(projectRoot, fromAbs));
  const toRel = toPosix(path.relative(projectRoot, toAbs));
  const dryRun = !!input.dry_run;
  const blocked: string[] = [];

  if (fromRel === toRel) {
    blocked.push('源与目标路径相同，无需改名');
    return { ok: false, dryRun, fromRel, toRel, moved: false, references: [], editCount: 0, pending: [], blocked };
  }
  if (!fs.existsSync(fromAbs)) {
    blocked.push(`源文件不存在：${fromRel}`);
  }
  if (fs.existsSync(toAbs)) {
    blocked.push(`目标已存在，拒绝覆盖：${toRel}`);
  }
  if (blocked.length > 0) {
    return { ok: false, dryRun, fromRel, toRel, moved: false, references: [], editCount: 0, pending: [], blocked };
  }

  const toNoExt = toRel.replace(/\.[^.]+$/, '');

  // 1) 枚举项目源码文件
  const files: string[] = [];
  walkProjectFiles(projectRoot, files);

  // 2) 逐个文件扫描：import 源字面量 → 解析到 fromRel 即为一处待改写引用
  const pending: string[] = [];
  const byImporter = new Map<string, { importerAbs: string; items: RefEdit[] }>();
  const guard = createProtectGuard(projectRoot);
  // 被移动文件自身的相对导入需按新位置重锚定（指向同样的绝对目标，否则移入新目录会悬空）
  const ownEdits: Array<{ pos: number; len: number; quote: string; toSource: string }> = [];

  for (const importerAbs of files) {
    const importerRel = toPosix(path.relative(projectRoot, importerAbs));
    const isMoved = importerAbs === fromAbs;
    let content: string;
    try {
      content = fs.readFileSync(importerAbs, 'utf-8');
    } catch {
      continue;
    }
    const parsed = await parseAstRoot(importerAbs, content);
    if (!parsed) continue;
    const isPy = parsed.langName === 'python';
    const lits: Array<{ node: SyntaxNodeLike; lit: { startIndex: number; text: string; inner: string } | null }> = [];
    if (isPy) collectPythonImportLiterals(parsed.root, lits);
    else collectImportLiterals(parsed.root, lits);
    for (const { lit } of lits) {
      if (!lit) continue;
      if (isMoved) {
        // 被移动文件：只重锚定相对导入到原解析目标（新位置→同一文件）
        if (!lit.inner.startsWith('.')) continue;
        const targetRel = isPy ? resolvePythonTarget(projectRoot, importerRel, lit.inner) : resolveImportTarget(projectRoot, importerRel, lit.inner);
        if (!targetRel || targetRel === fromRel) continue;
        const targetNoExt = targetRel.replace(/\.[^.]+$/, '');
        const toSource = isPy ? newPySpecifier(toRel, targetNoExt) : newSpecifier(toRel, lit.inner, targetNoExt);
        if (lit.inner === toSource) continue;
        ownEdits.push({ pos: lit.startIndex, len: lit.text.length, quote: isPy ? '' : lit.text[0], toSource });
        continue;
      }
      const targetRel = isPy ? resolvePythonTarget(projectRoot, importerRel, lit.inner) : resolveImportTarget(projectRoot, importerRel, lit.inner);
      if (targetRel !== fromRel) continue; // 不是指向被移动文件 → 不碰
      // 生成新规范字，保留老引用扩展名风格
      const toSource = isPy ? newPySpecifier(importerRel, toNoExt) : newSpecifier(importerRel, lit.inner, toNoExt);
      if (lit.inner === toSource) continue; // 改完没变化（如原地同目录同核）→ 跳过
      const rec: RefEdit = { importerRel, importerAbs, source: lit.inner, toSource, pos: lit.startIndex, len: lit.text.length, quote: isPy ? '' : lit.text[0] };
      if (!byImporter.has(importerRel)) byImporter.set(importerRel, { importerAbs, items: [] });
      byImporter.get(importerRel)!.items.push(rec);
    }
  }

  const filteredEdits = [...byImporter.values()].flatMap((im) => im.items);
  const editCount = filteredEdits.length;
  const references = filteredEdits.map((e) => ({ file: e.importerRel, fromSource: e.source, toSource: e.toSource }));

  // 目录桶（index/mod）的引用 → 注明语义变化风险
  if (/\/index\.(ts|tsx|js|jsx)$/.test(fromRel)) {
    pending.push(`被移动文件是目录桶 ${fromRel}——原引用可能用 ./dirname 形式，语义已变，请重点复核`);
  }

  // 冻结行保护（原子）：若某 importer 的引用改写会落在保护文件的标记行 → 整笔软阻断，
  // 不产生"跳过某个引用仍让它处移动"的半成状态。主体文件（被移动文件）不套。
  for (const importer of byImporter.values()) {
    if (importer.items.length === 0) continue;
    let src = '';
    try {
      src = fs.readFileSync(importer.importerAbs, 'utf-8');
    } catch {
      continue;
    }
    const g = guard.scan(importer.importerAbs, src, importer.items.map((r) => ({ pos: r.pos, len: r.len, text: r.toSource })));
    if (g.blocked) {
      blocked.push(`质疑：${importer.items[0].importerRel} 的引用命中保护标记行，需解除保护或人工处理后再移动：${g.protectedLines.join(' | ')}`);
    }
  }
  if (blocked.length > 0) {
    return { ok: false, dryRun, fromRel, toRel, moved: false, references, editCount, pending, blocked };
  }

  if (dryRun) {
    return { ok: true, dryRun, fromRel, toRel, moved: false, references, editCount, pending };
  }

  // 3) 原子化执行——先复制，再改写引用，最后删除原文件。
  //    原实现是先 renameSync 再改引用，中途任何一步（文件改写/索引写入）失败
  //    都会导致「文件已走、引用仍指向旧路径、索引悬空」的半完成状态，用户无从回退。
  //    新顺序：复制 → 改引用（原文件仍在，失败零损失）→ 删原文件 + 重索引。
  const toDir = path.dirname(toAbs);
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(fromAbs, toAbs);
  const db = getProjectCacheDb(projectRoot);
  let copySucceeded = true;

  try {
    // 4) 改写各引用文件（字节级，逆序防偏移互相影响）
    for (const importer of byImporter.values()) {
      const items = importer.items;
      const content = fs.readFileSync(importer.importerAbs, 'utf-8');
      const sorted = [...items].sort((a, b) => b.pos - a.pos);
      let out = content;
      for (const it of sorted) out = out.slice(0, it.pos) + it.quote + it.toSource + it.quote + out.slice(it.pos + it.len);
      fs.writeFileSync(importer.importerAbs, out, 'utf8');
      await syncFile(db, projectRoot, importer.importerAbs);
    }

    // 5) 被移动文件自身的相对导入按新位置重锚定（对拷贝体做改写）
    if (ownEdits.length > 0) {
      const content = fs.readFileSync(toAbs, 'utf-8');
      const sorted = [...ownEdits].sort((a, b) => b.pos - a.pos);
      let out = content;
      for (const it of sorted) out = out.slice(0, it.pos) + it.quote + it.toSource + it.quote + out.slice(it.pos + it.len);
      fs.writeFileSync(toAbs, out, 'utf8');
    }

    // 6) 全部改写成功后才删除原文件 + 重索引
    fs.unlinkSync(fromAbs);
    removeFile(db, projectRoot, fromAbs);
    await syncFile(db, projectRoot, toAbs);
    // ★ 写闸收尾（2026-09-15）：被移动/被改写的文件里可能有符号"消失/改名"，
    //   它们的引用方边会被 FK 级联删掉且不会自己重建 ⇒ 必须重开再解析（否则静默漏报）。
    //   失败不吞 —— 带进结果让调用方看见。
    const _rw = await reopenAndResolveAfterWrite(projectRoot, [toAbs, ...[...byImporter.values()].map((i) => i.importerAbs)]);
    if (_rw.error) blocked.push(`索引引用方重算失败：${_rw.error}`);
  } catch (e) {
    // 中途失败回滚：删除第 3 步留下的拷贝，让调用方看到「没挪动」
    try {
      if (fs.existsSync(toAbs)) fs.unlinkSync(toAbs);
    } catch {
      /* 清理失败不影响主错误返回 */
    }
    copySucceeded = false;
    return {
      ok: false, dryRun, fromRel, toRel, moved: false, references, editCount, pending,
      blocked: [`rename_file 中途失败（已回滚拷贝）：${(e as Error).message}`],
    };
  } finally {
    // 保险：如果失败回滚路径上有任何遗留，务必清掉 toAbs
    if (!copySucceeded && fs.existsSync(toAbs)) {
      try { fs.unlinkSync(toAbs); } catch { /* noop */ }
    }
    // 释放本项目缓存连接（Windows 上文件句柄不释放会导致后续删目录 EBUSY；
    // close 幂等，后续需要会重新 openDb）——成功/失败路径都释放
    closeProjectCacheDb(projectRoot);
  }

  return { ok: true, dryRun, fromRel, toRel, moved: true, references, editCount, pending };
}

/** ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去 */
function touchedOf(input: RenameFileInput, r: RenameFileResult): Touched {
  const touched: Touched = { project_dir: path.resolve(input.project_dir) };
  // ★ 只有真落盘了才给 written_files（dry_run / 被阻断 / ok:false 一律省略）：
  //   落盘路径下写过的文件 = 移动后的新文件（r.toRel）+ 每个被改写引用的 importer（r.references 的 file 字段）。
  if (r.ok && !r.dryRun && r.moved) {
    touched.written_files = [...new Set([r.toRel, ...r.references.map((e) => e.file)])];
  }
  return touched;
}

export async function renameFile(input: RenameFileInput): Promise<TouchedProduct<RenameFileResult>> {
  const r = await renameFileCore(input);
  return withTouched(r, touchedOf(input, r));
}