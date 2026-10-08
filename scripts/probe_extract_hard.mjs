/**
 * extract_hard —— 把样本从"最小"升到"有难度"，判据也从"名字在不在"升到**结构性**的：
 *
 *   · **符号**：两个顶层函数**都要**找到（只找到第一个 = 只对了玩具样本）
 *   · ★ **同文件调用边**：`foo` 调 `bar`（两个都在本文件）⇒ `calls` 里必须有
 *     `callee==='bar'` **且 `resolved===true`**（`resolved` 是调用图的地基；
 *     上一轮只看了"名字在不在"，那**不能**证明调用图能用）
 *   · **caller 归属**：那条边的 `caller` 应该指向 `foo`（谁调的）
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const k = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/index.js').replace(/\\/g, '/'));
const { LANGUAGES } = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/languages.js').replace(/\\/g, '/'));
const TMP = path.join(REPO, '.inspect', 'extract-samples');
fs.mkdirSync(TMP, { recursive: true });

// 每门：两个函数（foo 调 bar），两个都在同文件 ⇒ 期望 symbols 有两者、且 bar 的边 resolved
const S = {
  typescript: ['.ts', 'export function foo() { bar(); }\nexport function bar() {}\n', ['foo', 'bar'], 'bar'],
  tsx: ['.tsx', 'export function foo() { bar(); }\nexport function bar() {}\n', ['foo', 'bar'], 'bar'],
  javascript: ['.js', 'export function foo() { bar(); }\nfunction bar() {}\n', ['foo', 'bar'], 'bar'],
  jsx: ['.jsx', 'export function foo() { bar(); }\nfunction bar() {}\n', ['foo', 'bar'], 'bar'],
  go: ['.go', 'package main\n\nfunc foo() { bar() }\n\nfunc bar() {}\n', ['foo', 'bar'], 'bar'],
  python: ['.py', 'def foo():\n    bar()\n\ndef bar():\n    pass\n', ['foo', 'bar'], 'bar'],
  java: ['.java', 'class T {\n  void foo() { bar(); }\n  void bar() {}\n}\n', ['foo', 'bar'], 'bar'],
  c: ['.c', 'void bar(void);\nvoid foo(void) { bar(); }\nvoid bar(void) {}\n', ['foo', 'bar'], 'bar'],
  cpp: ['.cpp', 'void bar();\nvoid foo() { bar(); }\nvoid bar() {}\n', ['foo', 'bar'], 'bar'],
  c_sharp: ['.cs', 'class T {\n  void Foo() { Bar(); }\n  void Bar() {}\n}\n', ['Foo', 'Bar'], 'Bar'],
  rust: ['.rs', 'fn foo() { bar(); }\nfn bar() {}\n', ['foo', 'bar'], 'bar'],
  kotlin: ['.kt', 'fun foo() { bar() }\nfun bar() {}\n', ['foo', 'bar'], 'bar'],
  ruby: ['.rb', 'def foo\n  bar()\nend\n\ndef bar\nend\n', ['foo', 'bar'], 'bar'],
  php: ['.php', '<?php\nfunction foo() { bar(); }\nfunction bar() {}\n', ['foo', 'bar'], 'bar'],
  scala: ['.scala', 'object T {\n  def foo() = { bar() }\n  def bar() = {}\n}\n', ['foo', 'bar'], 'bar'],
  groovy: ['.groovy', 'def foo() { bar() }\ndef bar() {}\n', ['foo', 'bar'], 'bar'],
  elixir: ['.ex', 'defmodule M do\n  def foo do\n    bar()\n  end\n\n  def bar do\n  end\nend\n', ['foo', 'bar'], 'bar'],
  // ★ 2026-10-08 更正样本：haskell 的调用是**函数应用**（`apply` 节点），而 adapter 声明的正是
  //   `callNode: 'apply'`。上一版我写的 `foo = bar` 是个 `bind`（**根本不是应用**）⇒ ✗ 假红是我样本的错。
  haskell: ['.hs', 'bar x = x\nfoo = bar 1\n', ['foo', 'bar'], 'bar'],
  bash: ['.sh', 'bar() { :; }\nfoo() { bar; }\n', ['foo', 'bar'], 'bar'],
  julia: ['.jl', 'function foo()\n  bar()\nend\n\nfunction bar()\nend\n', ['foo', 'bar'], 'bar'],
  r: ['.r', 'bar <- function() {}\nfoo <- function() { bar() }\n', ['foo', 'bar'], 'bar'],
  fish: ['.fish', 'function bar\nend\n\nfunction foo\n  bar\nend\n', ['foo', 'bar'], 'bar'],
  // ★ 2026-10-08 更正样本：crystal 的**裸调用不产调用节点**（实测 `bar`→local_variable、`bar()`→ERROR），
  //   只有带 receiver 的 `self.bar` 才成 `method_call`（上游 grammar 固有限制：`alias($.property,'')` 是必需项）。
  crystal: ['.cr', 'class Foo\n  def bar\n  end\n\n  def foo\n    self.bar\n  end\nend\n', ['foo', 'bar'], 'bar'],
  swift: ['.swift', 'func bar() {}\nfunc foo() { bar() }\n', ['foo', 'bar'], 'bar'],
  ocaml: ['.ml', 'let bar () = ()\nlet foo () = bar ()\n', ['foo', 'bar'], 'bar'],
  solidity: ['.sol', 'contract C {\n  function bar() public {}\n  function foo() public { bar(); }\n}\n', ['foo', 'bar'], 'bar'],
};

const rows = [];
for (const [lang, [ext, code, wantSyms, wantCall]] of Object.entries(S)) {
  const entry = LANGUAGES.find((l) => l.name === lang);
  if (!entry) { rows.push({ lang, verdict: '✗ 不在注册表' }); continue; }
  const f = path.join(TMP, 'hard' + ext);
  fs.writeFileSync(f, code);
  let r;
  try { r = await k.parseFileFull(f, code); } catch (e) { rows.push({ lang, verdict: '✗ 抛错 ' + (e.message || '').slice(0, 50) }); continue; }
  const syms = (r.symbols || []).map((s) => s.name);
  const missSyms = wantSyms.filter((x) => !syms.includes(x));
  const edge = (r.calls || []).find((c) => c.callee === wantCall);
  rows.push({
    lang,
    symsFound: syms,
    missSyms,
    callFound: !!edge,
    callResolved: edge?.resolved === true,
    caller: edge?.caller ?? null,
    calleeQn: edge?.callee_qn ?? null,
    verdict: missSyms.length ? `✗ 漏符号 ${missSyms.join(',')}` : !edge ? '✗ 无调用边' : edge.resolved ? '✅ 边已解析' : '⚠ 边未解析(resolved=false)',
  });
}
fs.writeFileSync(path.join(REPO, '.inspect', 'extract-hard.json'), JSON.stringify(rows, null, 1));

const g = (p) => rows.filter(p).length;
console.log('27 门代码语言 · 难度样本（两个函数 + 同文件调用）：\n');
console.log(`  ✅ 边已解析(resolved=true)   ${g((r) => r.verdict.startsWith('✅'))}`);
console.log(`  ⚠ 边未解析(resolved=false)  ${g((r) => r.verdict.startsWith('⚠'))}`);
console.log(`  ✗ 漏符号 / 无调用边          ${g((r) => r.verdict.startsWith('✗'))}\n`);
for (const r of rows) {
  const d = r.symsFound ? ` symbols=[${r.symsFound.join(',')}]` + (r.callFound ? ` caller=${r.caller} callee_qn=${r.calleeQn}` : '') : '';
  console.log(`  ${r.lang.padEnd(12)} ${r.verdict}${d}`);
}
