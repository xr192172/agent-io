/**
 * P0 · `replace_text` 的 **token 边界闸**（命中不许切开标识符）+ **符号作用域闸**
 *
 * ## 它挡的事故（实测）
 * `fuzzy_match#findExactOccurrences` 是裸 `content.indexOf`（L1·exact 那一档自称最可信），
 * 于是 `const fooBar = 1;` + `old_text="foo"` **唯一命中** [6,9) ⇒ 落盘成 `const bazBar = 1;`，
 * 回执还写「匹配 L1·exact」。暴露面：本仓 14,652 个标识符名里 2,846 个（19.4%）是另一个的真子串
 * （`ABS⊂ABSENT` / `AGENT⊂AGENT_IO_ACTOR` / `APPDATA⊂LOCALAPPDATA`）。
 *
 * ## 判据（两个方向都要 —— AGENTS.md 0.14）
 * · **异义必不命中**：`old_text="foo"` 落在 `fooBar` / `myfoo` 内部 ⇒ **必须拒**（改前是照改 + 报 L1）。
 * · **同义必命中**：缩进不同 / 行尾空白 / CRLF / 行内空格加宽 ⇒ 仍必须命中（闸只拦"切开 token"，
 *   不许把排版差异也一起拦掉）。
 * · **消融**：同一份夹具走**不带闸**的那条腿（`locateReplaceText` 单独定位）⇒ 它仍然给出
 *   「唯一命中 [6,9)」——即"删掉边界闸，①就会变红"（① 里同时断言这两点，互为对照）。
 * · **作用域**：给了 `symbol` 而命中在符号外 ⇒ 必须拒；符号找不到 / 不唯一 ⇒ 必须拒（不猜）。
 * · **闸未生效必须看得见**：没有索引时闸会退出，回执必须写「token 边界闸**未生效**（原因）」，
 *   而不是长得跟"验过且干净"一样（0.12）。
 *
 * ## 为什么住 `npm test` 而不是册里的 `behavior-cases`
 * `edit_code.ts` 有值 import（fs / tree-sitter / sqlite）⇒ 不满足 `behavior-cases` 的零值 import 门槛
 * （E-CRIT-006）。形态照 `tests/p0_text_assertions.test.ts`：端到端 + 消融落在这里由 `npm test` 跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★ 临时夹具项目里没有画布（`tasks.db#plans`）—— 本文件验的是边界闸/作用域闸，不是画布闸。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const { editCode } = await import('../src/application/refactor/edit/edit_code.js');
const { locateReplaceText } = await import('../src/infrastructure/parse/fuzzy_match.js');
// ★ 建索引（identifiers 是边界闸的位置权威）+ 关闭句柄（Windows 上不关 ⇒ 删目录 EBUSY）
const { syncFile } = await import('../src/infrastructure/index/symbols.js');
const { getProjectCacheDb, closeAllProjectCacheDbs } = await import('../src/infrastructure/index/db.js');

function cleanup(proj: string): void {
  closeAllProjectCacheDbs();
  fs.rmSync(proj, { recursive: true, force: true });
}

/** 造夹具项目（不建 `.agent-io/` ⇒ 闸按"本项目不用任务系统"放行） */
function mkProject(files: Record<string, string>): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-token-boundary-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(proj, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return proj;
}

/**
 * ★ 给夹具建索引 —— **边界闸的位置权威是 `identifiers`**，没有索引 ⇒ 闸只能报"未生效"。
 * （⑤ 用同一个 helper 的反面——不建索引——来验"未生效必须看得见"。）
 */
function indexFile(proj: string, rel: string): void {
  const abs = path.join(proj, rel);
  syncFile(getProjectCacheDb(proj), proj, abs);
}

async function repl(proj: string, rel: string, oldText: string, newText: string, symbol?: string) {
  return editCode({
    project_dir: proj,
    file: rel,
    op: 'replace_text',
    old_text: oldText,
    new_text: newText,
    ...(symbol ? { symbol } : {}),
    actor: 'subagent:r13-token',
  });
}

const read = (proj: string, rel: string): string => fs.readFileSync(path.join(proj, rel), 'utf8');

test('① 异义必不命中：old_text 切进标识符中间 ⇒ 拒 + 不写盘（改前会照改并报 L1）', async () => {
  const rel = 'src/a.ts';
  const body = 'export const fooBar = 1;\n';
  const proj = mkProject({ [rel]: body });
  try {
    indexFile(proj, rel);
    // ★ 消融的对照面：**不带闸**的定位腿（fuzzy_match L1）确实会给出"唯一命中 [6,9)"
    //   ⇒ 删掉边界闸，下面那条 reject 就会变红（本用例的另一半证据）。
    const bare = locateReplaceText(body, 'foo');
    assert.equal(bare.level, 1, '不带闸的 L1 会命中（这就是病灶本身）');
    assert.equal(bare.candidates.length, 1, '唯一命中（正是"静默"的前提：没有歧义可报）');
    // 命中区间 = `foo` 在 `fooBar` 里那一段（按实际偏移算，别抄示例里的 6）
    const at = body.indexOf('foo');
    assert.equal(bare.candidates[0].start, at, '命中起点落在 fooBar 内部');
    assert.equal(bare.candidates[0].end, at + 3, '命中终点也落在 fooBar 内部');

    await assert.rejects(
      () => repl(proj, rel, 'foo', 'baz'),
      /切进标识符中间/,
      '★ 命中切开标识符必须拒（改前：落盘成 const bazBar = 1; 且回执写「匹配 L1·exact」）',
    );
    assert.equal(read(proj, rel), body, '一个字节都不许改');
  } finally {
    cleanup(proj);
  }
});

test('①b 异义必不命中（尾部方向）：命中切在标识符尾部（myfoo 里的 foo）⇒ 同样拒', async () => {
  const rel = 'src/b.ts';
  const body = 'const myfoo = 1;\n';
  const proj = mkProject({ [rel]: body });
  try {
    indexFile(proj, rel);
    await assert.rejects(() => repl(proj, rel, 'foo', 'baz'), /切进标识符中间/, '尾部方向也必须拦');
    assert.equal(read(proj, rel), body, '一个字节都不许改');
  } finally {
    cleanup(proj);
  }
});

test('② 同义必命中：整体标识符 / 缩进 / 行尾空白 / CRLF / 行内空格加宽 ⇒ 仍要命中且写盘', async () => {
  // ②-1 整个标识符（边界恰好对齐 ⇒ 允许）
  {
    const rel = 'src/c1.ts';
    const proj = mkProject({ [rel]: 'const foo = 1;\n' });
    try {
      indexFile(proj, rel);
      const r = await repl(proj, rel, 'foo', 'bar');
      assert.equal(r.data.written, true, `整体标识符必须允许改：${r.message}`);
      assert.equal(read(proj, rel), 'const bar = 1;\n');
      assert.equal((r.data.token_gate as { status?: string }).status, 'applied', '闸必须真跑过（applied）');
    } finally {
      cleanup(proj);
    }
  }
  // ②-2 CRLF + 行尾空白（命中的边界落在 token 之外 ⇒ 允许）
  {
    const rel = 'src/c2.ts';
    const body = 'const foo = 1;   \r\nconst bar = 2;\r\n';
    const proj = mkProject({ [rel]: body });
    try {
      indexFile(proj, rel);
      const r = await repl(proj, rel, 'const foo = 1;', 'const foo = 9;');
      assert.equal(r.data.written, true, `行尾空白/CRLF 只是排版差异，必须仍命中：${r.message}`);
      assert.match(read(proj, rel), /const foo = 9; {3}\r\n/, '只有目标片段被换掉，行尾空白原样保留');
    } finally {
      cleanup(proj);
    }
  }
  // ②-3 行内空格加宽（模糊级）+ 缩进层级不同
  {
    const rel = 'src/c3.ts';
    const proj = mkProject({ [rel]: 'function f() {\n  const  x  =  1;\n}\n' });
    try {
      indexFile(proj, rel);
      const r = await repl(proj, rel, 'const x = 1;', 'const x = 2;');
      assert.equal(r.data.written, true, `排版差异必须仍命中（模糊级 + 边界闸不许互相打架）：${r.message}`);
      assert.match(read(proj, rel), /const {1,2}x {1,2}= {1,2}2;/, '那一行的内容必须被换掉');
    } finally {
      cleanup(proj);
    }
  }
});

test('③ 作用域闸：给了 symbol 而命中在符号外 ⇒ 拒；在符号内 ⇒ 放行；符号找不到 ⇒ 拒（不猜）', async () => {
  const rel = 'src/d.ts';
  const body = 'function a() {\n  const target = 1;\n}\nfunction b() {\n  const other = 2;\n}\n';
  const proj = mkProject({ [rel]: body });
  try {
    indexFile(proj, rel);
    // 命中在 a() 里，却声明 symbol=b ⇒ 必须拒（改前：symbol 被静默忽略，照改 a() 里的那行）
    await assert.rejects(
      () => repl(proj, rel, 'const target = 1;', 'const target = 9;', 'b'),
      /作用域闸/,
      '★ 命中落在 symbol 之外必须拒（改前 symbol 参数被静默忽略）',
    );
    assert.equal(read(proj, rel), body, '一个字节都不许改');

    // 同一处改成 symbol=a ⇒ 命中在 a() 内 ⇒ 放行
    const ok = await repl(proj, rel, 'const target = 1;', 'const target = 9;', 'a');
    assert.equal(ok.data.written, true, `命中在符号内必须放行：${ok.message}`);
    assert.match(read(proj, rel), /const target = 9;/);

    // 符号不存在 ⇒ 拒（不许"找不到就当没给"）
    await assert.rejects(() => repl(proj, rel, 'const other = 2;', 'const other = 8;', 'nope'), /作用域闸/);
  } finally {
    cleanup(proj);
  }
});

test('④ 不许误拒：`const foo = 1;` 这种跨 token 的命中必须放行（相交但不等 ≠ 切开）', async () => {
  const rel = 'src/e.ts';
  const proj = mkProject({ [rel]: 'const foo = 1;\nconst baz = 2;\n' });
  try {
    indexFile(proj, rel);
    // 命中区间内部**包着** foo / 1 两个 token，但两条边界都落在 token 之外 ⇒ 必须放行。
    // 这条钉的是判据最容易写歪的地方：写成"与任一标识符相交但不相等 ⇒ 拒"会把这类常改动全拦死。
    const r = await repl(proj, rel, 'const foo = 1;', 'const foo = 7;');
    assert.equal(r.data.written, true, `跨 token 的正常替换不许被误拒：${r.message}`);
    assert.equal(read(proj, rel), 'const foo = 7;\nconst baz = 2;\n');
  } finally {
    cleanup(proj);
  }
});

test('⑤ 闸未生效必须看得见：没有索引 ⇒ 回执照实说「未生效（原因）」，不当通过也不静默', async () => {
  const rel = 'src/f.ts';
  const body = 'export const fooBar = 1;\n';
  const proj = mkProject({ [rel]: body });
  try {
    // ★ 故意**不建索引**：闸拿不到 identifiers ⇒ 只能退出
    const r = await repl(proj, rel, 'foo', 'baz');
    assert.equal((r.data.token_gate as { status?: string }).status, 'skipped', '没索引时闸必须报 skipped（不是 applied）');
    assert.match(r.message, /token 边界闸\*\*未生效\*\*/, '★ 回执必须明说未生效（0.12：未执行 ≠ 通过）');
    assert.match(r.message, /索引/, '未生效的原因必须点名"索引"这一层（可诊断）');
    // 退回现行为：真的写盘了（这是"已声明边界"，不是 bug —— 边界闸依赖索引）
    assert.equal(r.data.written, true, '闸未生效 ⇒ 退回现行为（写盘），但回执已明说');
  } finally {
    cleanup(proj);
  }
});
