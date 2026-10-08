/**
 * extract_quality —— 验「已有功能」的另一半账：**那 33 门能用语言，提得对不对？**
 *
 * 判据（可证伪）：我们**自己写**的样本，函数名 / import 模块 / 被调函数名**是已知的**
 *   ⇒ 看 `parseFileFullSync()` 回的结果里，
 *     ① `symbols` 有没有那个函数名   ② `imports` 有没有那个模块   ③ `calls` 有没有那个被调名。
 *
 * ★ 分三类报，不混为一谈：
 *   · **适用**   代码语言 —— 三项都该有
 *   · **不适用** 数据/标记语言（json toml css scss html vue）—— "符号/import/调用"本就没有对应物，
 *                报 `n/a` 而不是 `❌`（把不适用当失败是最常见的假账）
 *   · **部分**   有函数但没有 import 概念（如 vhdl / r 的 library() 语义不同）⇒ 只验它有的那项
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const req = createRequire(import.meta.url);
const kernel = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/index.js').replace(/\\/g, '/'));
const { LANGUAGES } = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/languages.js').replace(/\\/g, '/'));

const TMP = path.join(REPO, '.inspect', 'extract-samples');
fs.mkdirSync(TMP, { recursive: true });

// kind: 'code' 三项都验 | 'data' 不适用 | 'partial' 只验列出的项
const S = {
  typescript: { ext: '.ts', code: 'import { a } from "./m";\nexport function foo() { bar(); }\n', sym: 'foo', imp: './m', call: 'bar' },
  tsx: { ext: '.tsx', code: 'import React from "react";\nexport function foo() { bar(); }\n', sym: 'foo', imp: 'react', call: 'bar' },
  javascript: { ext: '.js', code: 'import { a } from "./m";\nfunction foo() { bar(); }\n', sym: 'foo', imp: './m', call: 'bar' },
  jsx: { ext: '.jsx', code: 'import React from "react";\nfunction foo() { bar(); }\n', sym: 'foo', imp: 'react', call: 'bar' },
  go: { ext: '.go', code: 'package main\n\nimport "fmt"\n\nfunc foo() {\n\tbar()\n}\n', sym: 'foo', imp: 'fmt', call: 'bar' },
  python: { ext: '.py', code: 'import os\nfrom a import b\n\ndef foo():\n    bar()\n', sym: 'foo', imp: 'os', call: 'bar' },
  java: { ext: '.java', code: 'import a.b.C;\n\nclass T {\n  void foo() { bar(); }\n}\n', sym: 'foo', imp: 'a.b.C', call: 'bar' },
  c: { ext: '.c', code: '#include "a.h"\n\nvoid foo(void) { bar(); }\n', sym: 'foo', imp: 'a.h', call: 'bar' },
  cpp: { ext: '.cpp', code: '#include "a.h"\n\nvoid foo() { bar(); }\n', sym: 'foo', imp: 'a.h', call: 'bar' },
  c_sharp: { ext: '.cs', code: 'using A.B;\n\nclass T {\n  void Foo() { Bar(); }\n}\n', sym: 'Foo', imp: 'A.B', call: 'Bar' },
  rust: { ext: '.rs', code: 'use a::b;\n\nfn foo() { bar(); }\n', sym: 'foo', imp: 'a::b', call: 'bar' },
  kotlin: { ext: '.kt', code: 'import a.b\n\nfun foo() { bar() }\n', sym: 'foo', imp: 'a.b', call: 'bar' },
  ruby: { ext: '.rb', code: 'require "a"\n\ndef foo\n  bar\nend\n', sym: 'foo', imp: 'a', call: 'bar' },
  php: { ext: '.php', code: '<?php\nuse A\\B;\n\nfunction foo() { bar(); }\n', sym: 'foo', imp: 'A\\B', call: 'bar' },
  scala: { ext: '.scala', code: 'import a.b\n\nobject T {\n  def foo() = { bar() }\n}\n', sym: 'foo', imp: 'a.b', call: 'bar' },
  groovy: { ext: '.groovy', code: 'import a.b\n\ndef foo() { bar() }\n', sym: 'foo', imp: 'a.b', call: 'bar' },
  elixir: { ext: '.ex', code: 'import Foo\n\ndef foo do\n  bar()\nend\n', sym: 'foo', imp: 'Foo', call: 'bar' },
  haskell: { ext: '.hs', code: 'import Data.List\n\nfoo = bar\n', sym: 'foo', imp: 'Data.List', call: 'bar' },
  bash: { ext: '.sh', code: 'source ./a.sh\n\nfoo() { bar; }\n', sym: 'foo', imp: './a.sh', call: 'bar' },
  julia: { ext: '.jl', code: 'using A\n\nfunction foo()\n  bar()\nend\n', sym: 'foo', imp: 'A', call: 'bar' },
  r: { ext: '.r', code: 'library(a)\n\nfoo <- function() { bar() }\n', sym: 'foo', imp: 'a', call: 'bar' },
  fish: { ext: '.fish', code: 'source ./a.fish\n\nfunction foo\n  bar\nend\n', sym: 'foo', imp: './a.fish', call: 'bar' },
  crystal: { ext: '.cr', code: 'require "a"\n\ndef foo\n  bar\nend\n', sym: 'foo', imp: 'a', call: 'bar' },
  swift: { ext: '.swift', code: 'import Foundation\n\nfunc foo() { bar() }\n', sym: 'foo', imp: 'Foundation', call: 'bar' },
  ocaml: { ext: '.ml', code: 'open A\n\nlet foo () = bar ()\n', sym: 'foo', imp: 'A', call: 'bar' },
  solidity: { ext: '.sol', code: 'import "./a.sol";\n\ncontract C {\n  function foo() public { bar(); }\n}\n', sym: 'foo', imp: './a.sol', call: 'bar' },
  vhdl: { ext: '.vhd', kind: 'partial', only: ['sym'], code: 'entity e is\nend entity;\n\narchitecture a of e is\nbegin\nend architecture;\n', sym: 'e' },
  // —— 数据/标记语言：符号/import/调用**本就没有对应物** ⇒ 报 n/a，不当失败
  json: { ext: '.json', kind: 'data', code: '{"a": 1}\n' },
  toml: { ext: '.toml', kind: 'data', code: 'a = 1\n' },
  css: { ext: '.css', kind: 'data', code: '.a { color: red }\n' },
  scss: { ext: '.scss', kind: 'data', code: '.a { .b { color: red } }\n' },
  html: { ext: '.html', kind: 'data', code: '<html><body><p>x</p></body></html>\n' },
  vue: { ext: '.vue', kind: 'data', code: '<template><div/></template>\n' },
};

const rows = [];
for (const [lang, s] of Object.entries(S)) {
  const entry = LANGUAGES.find((l) => l.name === lang);
  if (!entry) { rows.push({ lang, verdict: '✗ 不在注册表里' }); continue; }
  const f = path.join(TMP, 'sample' + s.ext);
  fs.writeFileSync(f, s.code);
  let r;
  try { r = await kernel.parseFileFull(f, s.code); }
  catch (e) { rows.push({ lang, kind: s.kind ?? 'code', verdict: '✗ 抛错: ' + (e.message || '').slice(0, 60) }); continue; }
  const syms = (r.symbols || []).map((x) => x.name);
  const imps = (r.imports || []).map((x) => x.module ?? x.source ?? x.path ?? JSON.stringify(x).slice(0, 24));
  const calls = (r.calls || []).map((x) => x.callee ?? x.name ?? '');
  if (s.kind === 'data') { rows.push({ lang, kind: 'data', verdict: 'n/a（数据/标记语言，无符号/import/调用概念）', syms, imps, calls, err: r.error }); continue; }
  const want = s.only ?? ['sym', 'imp', 'call'];
  const hit = [];
  if (want.includes('sym')) hit.push(['符号', syms.includes(s.sym), s.sym]);
  if (want.includes('imp')) hit.push(['import', imps.some((x) => String(x).includes(s.imp)), s.imp]);
  if (want.includes('call')) hit.push(['调用', calls.some((x) => String(x).includes(s.call)), s.call]);
  const bad = hit.filter(([, ok]) => !ok);
  rows.push({ lang, kind: s.kind ?? 'code', verdict: bad.length ? `⚠ ${bad.map(([w]) => w).join('/')}未提` : '✅ 三项都对', syms, imps, calls, err: r.error });
}

fs.writeFileSync(path.join(REPO, '.inspect', 'extract-quality.json'), JSON.stringify(rows, null, 1));

const ok = rows.filter((r) => r.verdict.startsWith('✅')).length;
const part = rows.filter((r) => r.verdict.startsWith('⚠')).length;
const na = rows.filter((r) => r.verdict.startsWith('n/a')).length;
const bad = rows.filter((r) => r.verdict.startsWith('✗')).length;
console.log(`注册表 33 门可用语言，逐门喂**真实最小样本**：`);
console.log(`  ✅ 三项都对 ${ok} · ⚠ 部分未提 ${part} · n/a 不适用 ${na} · ✗ 出错 ${bad}\n`);
for (const r of rows) {
  const errTag = r.err ? `  ★ error=${String(r.err).slice(0,60)}` : '';
  const detail = r.kind === 'data' ? errTag : `  symbols=[${(r.syms || []).join(',')}] imports=[${(r.imps || []).join(',')}] calls=[${(r.calls || []).join(',')}]`;
  console.log(`  ${r.lang.padEnd(12)} ${r.verdict}${detail}`);
}
