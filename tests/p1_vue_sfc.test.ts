/**
 * card-vue-sfc（执行席 B）：`.vue` 组合式解析器机器回归。
 *
 * 判据有牙（每条都能说出"砍了它什么输入会红"）：
 *   ① 正例：裸 `<script>` 的 Options API —— 方法名出符号，start_line 落在 SFC 绝对行号；
 *      砍 kernel 分派 / 砍偏移回填 ⇒ 红。
 *   ② import `@/api/` 出边 + SFC 字符偏移：砍偏移 ⇒ 红。
 *   ③ calls 按 (caller,callee,line) 三元组去重（dedup）：三次同调用 ⇒ 恰一条；砍去重 ⇒ 红。
 *   ④ `<script lang="ts">` 走 TS 子解析（interface 出符号）：lang 误映射成 .js ⇒ 红。
 *   ⑤ 反例：`<script lang="wxs">` / `<script src>` 跳过；无 script 全零 + parser='vue-sfc'（旧空转标志）。
 *   ⑥ 两入口：parseFileFull（async）与 parseFileFullSync（sync）各自断言；只接异步 ⇒ sync 红。
 *   ⑦ A4 就绪闸：canParseFileSync('x.vue') === canParseFileSync('x.js')（组合式不依赖 vue 包）。
 *   ⑧ 未注册语言 `x.xyzzy` 不被本卡误伤（静默空、parser 缺省）。
 *
 * touches: src/infrastructure/parse/vue_sfc.ts, src/infrastructure/parse/kernel.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileFull, parseFileFullSync, canParseFileSync, parserReadyForFile, prewarmKernel } from '../src/infrastructure/parse/kernel.js';

/** 裸 <script>（fuintAdmin 154 个 .vue 的真实形态）；script 正文从 SFC 第 3 行开始 */
const OPTIONS_SFC = `<template><div @click="go">{{ msg }}</div></template>
<script>
import { getList } from '@/api/user';
export default {
  methods: {
    go() { getList(); getList(); return getList(); }
  }
};
</script>
<style>.x{color:red}</style>`;
// 行号（1-based）：1 template / 2 <script> / 3 import / 4 export default / 5 methods / 6 go
// import 在 script 内 row=0 ⇒ SFC line=3；go 在 script 内 row=3 ⇒ SFC line=6
const OPTIONS_IMPORT_LINE = 3;
const OPTIONS_GO_LINE = 6;

const TS_SFC = `<template/>\n<script lang="ts">\nimport type { ApiResult } from '@/api/types';\ninterface Row { id: number }\nexport default { setup() { const n: Row = { id: 1 }; return n; } };\n</script>`;

const SKIPPED_SFC = `<template><div/></template>\n<script lang="wxs">var x = function(){ return 1; };</script>\n<script src="./external.js"></script>\n<style>.a{}</style>`;

/** 从 SFC 正文算出 `@/api/user` 这段源码的绝对字符偏移（自算，不依赖实现） */
function absoluteIndexOf(sfc: string, needle: string): number {
  const i = sfc.indexOf(needle);
  assert.ok(i >= 0, `夹具里应有 ${needle}`);
  return i;
}

test('vue-sfc · ①裸 script Options API：方法出符号，start_line 为 SFC 绝对行号', async () => {
  const r = await parseFileFull('Widget.vue', OPTIONS_SFC);
  assert.equal(r.parser, 'vue-sfc', 'parser 如实标 vue-sfc（旧空转为 undefined）');
  assert.equal(r.error, undefined, '成功路径不报错');
  const go = r.symbols.find((s) => s.name === 'go');
  assert.ok(go, `methods.go 应出符号，实得 ${r.symbols.map((s) => s.name)}`);
  assert.equal(go!.kind, 'method');
  assert.equal(go!.start_line, OPTIONS_GO_LINE, 'start_line 是 SFC 绝对行（砍回填 ⇒ 得脚本内相对行 ⇒ 红）');
  assert.equal(go!.end_line, OPTIONS_GO_LINE);
});

test('vue-sfc · ②import @/api/ 出边 + SFC 字符偏移回填', async () => {
  const r = await parseFileFull('Widget.vue', OPTIONS_SFC);
  const im = r.imports.find((i) => i.source === '@/api/user');
  assert.ok(im, '@/api/ import 应出边');
  assert.equal(im!.line, OPTIONS_IMPORT_LINE, 'import.line 是 SFC 绝对行');
  const abs = absoluteIndexOf(OPTIONS_SFC, 'import { getList }');
  assert.equal(im!.start_index, abs, 'start_index 是 SFC 绝对偏移（砍回填 ⇒ 脚本内 0 ⇒ 红）');
  assert.equal(im!.end_index, abs + `import { getList } from '@/api/user';`.length);
});

test('vue-sfc · ③calls 按 (caller,callee,line) 三元组 dedup', async () => {
  const r = await parseFileFull('Widget.vue', OPTIONS_SFC);
  const hits = r.calls.filter((c) => c.caller === 'go' && c.callee === 'getList' && c.line === OPTIONS_GO_LINE);
  assert.equal(hits.length, 1, `同一 (go,getList,6) 三次调用应 dedup 成 1 条，实得 ${hits.length}`);
  assert.equal(r.calls.length, 1, '本夹具所有 calls 都应 dedup 到 1 条');
});

test('vue-sfc · ④lang="ts" 走 TS 子解析（interface 出符号）', async () => {
  const r = await parseFileFull('Ts.vue', TS_SFC);
  assert.equal(r.parser, 'vue-sfc');
  const row = r.symbols.find((s) => s.name === 'Row');
  assert.ok(row, `interface Row 应出符号，实得 ${r.symbols.map((s) => s.name)}`);
  assert.equal(row!.kind, 'interface', 'TS 分支不能被误映射成 .js（js grammar 不产 interface）');
  assert.equal(row!.start_line, 4, 'interface 在 SFC 第 4 行（0-based baseRow 公式）');
});

test('vue-sfc · ⑤反例：非 JS lang / <script src> 跳过；无 script 全零但标 vue-sfc', async () => {
  const r = await parseFileFull('Skip.vue', SKIPPED_SFC);
  assert.equal(r.parser, 'vue-sfc');
  assert.deepEqual(r.symbols, [], 'wxs / src 脚本不产符号');
  assert.deepEqual(r.imports, []);
  assert.deepEqual(r.calls, []);
  const empty = await parseFileFull('Empty.vue', '<template><div/></template>\n<style>.a{}</style>');
  assert.equal(empty.parser, 'vue-sfc', '无 script 也标 vue-sfc —— 区别旧空转');
  assert.deepEqual(empty.symbols, []);
  assert.deepEqual(empty.imports, []);
  assert.deepEqual(empty.calls, []);
});

test('vue-sfc · ⑥同步入口 parseFileFullSync 与 async 同构（只接 async ⇒ 本条红）', async () => {
  const a = await parseFileFull('Widget.vue', OPTIONS_SFC);
  const s = parseFileFullSync('Widget.vue', OPTIONS_SFC);
  assert.equal(s.parser, 'vue-sfc');
  assert.deepEqual(s.symbols.map((x) => [x.name, x.start_line]), a.symbols.map((x) => [x.name, x.start_line]));
  assert.deepEqual(s.imports, a.imports);
  assert.deepEqual(s.calls, a.calls, 'sync 也要 dedup');
  const go = s.symbols.find((x) => x.name === 'go');
  assert.equal(go?.start_line, OPTIONS_GO_LINE);
});

test('vue-sfc · ⑦A4 就绪闸：.vue 就绪 = 子语言 .js 就绪（组合式不依赖 vue 包）', async () => {
  await prewarmKernel();
  const vueReady = parserReadyForFile('Widget.vue');
  const jsReady = canParseFileSync('Widget.js');
  assert.equal(vueReady, jsReady, 'parserReadyForFile(.vue) 应等于 .js 就绪');
  assert.equal(canParseFileSync('Widget.vue'), jsReady, 'canParseFileSync(.vue) 应等于 .js 就绪');
});

test('vue-sfc · ⑧未注册语言不被误伤（.xyzzy 仍静默空、parser 缺省）', async () => {
  const r = await parseFileFull('x.xyzzy', 'whatever');
  assert.deepEqual(r.symbols, []);
  assert.deepEqual(r.imports, []);
  assert.equal(r.parser, undefined);
  assert.equal(r.error, undefined);
});
