/**
 * card-vue-sfc：`.vue` 单文件组件的组合式解析机器回归。
 *
 * 病史：修前 `.vue` **静默产零** —— `languages.ts` 把 vue 注册成可用 ⇒ 不进 `!lang`/`!parser`
 * 兜底 ⇒ 一路走到 `traverseAndExtract`，而 vue grammar 的 `symbol_nodes` 只有
 * `export_statement` ⇒ symbols/imports/calls/type_refs 全空且 error 为空（fuintAdmin 154 个实测）。
 *
 * 判据有牙（每条都说得出「破坏了它怎么会红」）：
 *   ① 正例（Options API，照 fuintAdmin 真实形状）：`<script>` 里的 `export default` 方法出符号，
 *      且 `start_line` 落在**脚本体内**（不是模板区）⇒ 砍分派 / 砍偏移回填 都红；
 *   ② import 出边且带 SFC 字符偏移 ⇒ 砍偏移回填红；
 *   ③ 同 (caller,callee,line) 的 calls 收成一条（dedup）⇒ 砍去重红；
 *   ④ `<script setup>` + `lang="ts"`（合成夹具：四仓 `lang="ts"`=0，只能拿夹具判 ts 分支）
 *      ⇒ 把 lang 恒映射成 `.js` 会红（interface 在 js grammar 里不是符号）；
 *   ⑤ 反例：`lang="wxs"` / `<script src="…">` 跳过、无 script 文件全零，**但 parser 恒为 `vue-sfc`**
 *      —— 这就是与旧「静默空转」的区别标志（旧路径 parser 为 undefined）；
 *   ⑥ 内核两入口都可达：`parseFileFull`（异步）与 `parseFileFullSync`（同步写穿）各自单独断言
 *      —— 只改异步不改同步时，⑥ 红（现有测试咬不到这一条）；
 *   ⑦ 未注册语言不被本卡改坏：`.xyzzy` 仍静默空且 parser 为 undefined。
 *
 * touches: src/infrastructure/parse/vue_sfc.ts, src/infrastructure/parse/kernel.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFileFull,
  parseFileFullSync,
  prewarmKernel,
  canParseFileSync,
  parserReadyForFile,
} from '../src/infrastructure/parse/kernel.js';
import { VUE_SFC_PARSER } from '../src/infrastructure/parse/vue_sfc.js';
import { getParser, getParserSync, clearLoaderCache } from '../src/infrastructure/parse/loader.js';
import { findLanguageByExt } from '../src/infrastructure/parse/languages.js';

/** 尽力把某个扩展名的 parser 预热进缓存（载不入就保持 null —— 本用例只关心「就绪判定跟谁走」） */
async function getParserForProbe(ext: string): Promise<void> {
  const lang = findLanguageByExt(ext);
  if (!lang) return;
  try {
    await getParser(ext, lang);
  } catch {
    /* 载不入 ⇒ 缓存仍是 null，断言口径不变 */
  }
}

/** Options API 正例（结构照 theme.vue：data:method + methods 里调导入的 api） */
const OPTIONS_VUE = [
  '<template>',
  '  <div class="theme">{{ theme }}</div>',
  '</template>',
  '',
  '<script>',
  "import { getInfo } from '@/api/theme.js'",
  '',
  'export default {',
  '  data() {',
  '    return { theme: null }',
  '  },',
  '  methods: {',
  '    getInfo() {',
  '      return getInfo()',
  '    },',
  '    save() {',
  '      return getInfo() + getInfo()',
  '    }',
  '  }',
  '}',
  '</script>',
  '',
].join('\n');

/** `<script setup lang="ts">` 正例（合成夹具：判 lang→typescript 分派） */
const SETUP_TS_VUE = [
  '<template><button @click="onSave">{{ count }}</button></template>',
  '<script setup lang="ts">',
  "import { ref } from 'vue'",
  "import { apiPost } from '@/api/order'",
  '',
  'interface OrderDraft {',
  '  id: number',
  '  amount: number',
  '}',
  '',
  'const count = ref(0)',
  'function onSave(draft: OrderDraft) {',
  '  apiPost(draft)',
  '}',
  '</script>',
  '',
].join('\n');

test('vue-sfc · ①Options API：<script> 出符号，start_line 落在脚本体内', async () => {
  const r = await parseFileFull('src/views/theme.vue', OPTIONS_VUE);
  assert.equal(r.error, undefined, `不应有解析错误，实得 ${r.error}`);
  assert.equal(r.parser, VUE_SFC_PARSER, 'parser 如实标 vue-sfc');
  const names = r.symbols.map((s) => s.name);
  assert.ok(names.includes('getInfo'), `methods.getInfo 出符号，实得 ${names}`);
  assert.ok(names.includes('data'), `data 出符号（Options API 也覆盖），实得 ${names}`);
  const getInfo = r.symbols.find((s) => s.name === 'getInfo')!;
  // <script> 开标签在第 5 行（1-based），内容首行是第 6 行 ⇒ 方法体必须落在 12 行附近
  assert.ok(getInfo.start_line >= 12, `行号必须回填到 SFC 坐标系（≥12），实得 ${getInfo.start_line}`);
  assert.ok(getInfo.start_line < 20, `行号不许溢出到脚本块之外，实得 ${getInfo.start_line}`);
  assert.ok(getInfo.end_line >= getInfo.start_line, 'end_line 合法');
});

test('vue-sfc · ②import 出边，且字符偏移落在 SFC 全文坐标系', async () => {
  const r = await parseFileFull('src/views/theme.vue', OPTIONS_VUE);
  const imp = r.imports.find((i) => i.source === '@/api/theme.js');
  assert.ok(imp, `imports 出边，实得 ${r.imports.map((i) => i.source)}`);
  // import 语句在 SFC 第 6 行
  assert.equal(imp!.line, 6, `import 行号回填正确，实得 ${imp!.line}`);
  assert.ok(typeof imp!.start_index === 'number' && typeof imp!.end_index === 'number', 'import 带 span');
  // SFC 全文里这两个偏移必须切出那条 import 语句（回填前会指向模板区）
  const sliced = OPTIONS_VUE.slice(imp!.start_index!, imp!.end_index!);
  assert.match(sliced, /import\s*\{\s*getInfo\s*\}/, `偏移切出的必须是 import 语句本身，实得 ${JSON.stringify(sliced)}`);
  assert.ok(imp!.start_index! > OPTIONS_VUE.indexOf('<script>'), '偏移在脚本体之后（不是模板区）');
});

test('vue-sfc · ③calls dedup：按 (caller,callee,line) 三元组去重', async () => {
  const r = await parseFileFull('src/views/theme.vue', OPTIONS_VUE);
  // save() 里同一行写了两次 getInfo() ⇒ 解析层给 2 条，vue-sfc 层的 dedup 收成 1 条
  const keys = r.calls.map((c) => `${c.caller}/${c.callee}/${c.line}`);
  const uniq = new Set(keys);
  assert.equal(uniq.size, keys.length, `dedup 后 (caller,callee,line) 不得重复，实得 ${JSON.stringify(keys)}`);
  // 去重的**前提**要钉住：解析层确实产出了重复（否则"去重"是空跑，判据没牙）
  assert.ok(keys.length >= 2, `calls 至少两条（证明真去重过而不是本来就一条），实得 ${keys.length}`);
  const saveCall = r.calls.find((c) => c.callee === 'getInfo' && c.caller.endsWith('save'));
  assert.ok(saveCall, `save 里的调用要抓到，实得 ${JSON.stringify(keys)}`);
  assert.equal(r.calls.filter((c) => c.callee === 'getInfo' && c.caller.endsWith('save')).length, 1, 'save 内同三元组经 dedup 只留一条');
});

test('vue-sfc · ④<script setup lang="ts"> 走 typescript 分派（interface 出符号）', async () => {
  const r = await parseFileFull('src/views/order/index.vue', SETUP_TS_VUE);
  assert.equal(r.error, undefined, `不应有解析错误，实得 ${r.error}`);
  assert.equal(r.parser, VUE_SFC_PARSER);
  const names = r.symbols.map((s) => s.name);
  assert.ok(names.includes('OrderDraft'), `interface 出符号（证明走的是 ts 而非 js 语法树），实得 ${names}`);
  assert.ok(names.includes('onSave'), `function 出符号，实得 ${names}`);
  assert.ok(r.imports.some((i) => i.source === '@/api/order'), 'import 出边');
  assert.ok(r.calls.some((c) => c.callee === 'apiPost'), '调用边出');
  // 行号回填：interface 在第 6 行起
  const iface = r.symbols.find((s) => s.name === 'OrderDraft')!;
  assert.equal(iface.start_line, 6, `interface 行号，实得 ${iface.start_line}`);
});

test('vue-sfc · ⑤反例：非 JS lang / script src 跳过；无 script 全零但 parser 如实', async () => {
  // 无 <script>：全零 + parser='vue-sfc'（★ 与旧「静默空转 parser=undefined」的区别标志）
  const bare = await parseFileFull('src/views/empty.vue', '<template><div>hi</div></template>\n');
  assert.deepEqual(bare.symbols, [], '无 script ⇒ 无符号');
  assert.equal(bare.parser, VUE_SFC_PARSER, '但 parser 如实标 vue-sfc（旧路径是 undefined）');

  // wxs / renderjs 不是 JS ⇒ 整块跳过，不许造伪符号
  const wxssVue = [
    '<template><div>x</div></template>',
    '<script lang="wxs" module="m">',
    'function math() { return 1 }',
    '</script>',
    '<script module="r" lang="renderjs">',
    'export default { mounted() {} }',
    '</script>',
    '<script>',
    'export default { methods: { real() {} } }',
    '</script>',
    '',
  ].join('\n');
  const rw = await parseFileFull('src/views/wx.vue', wxssVue);
  const names = rw.symbols.map((s) => s.name);
  assert.ok(names.includes('real'), `JS 块照常出符号，实得 ${names}`);
  assert.ok(!names.includes('math'), `wxs 块必须跳过，实得 ${names}`);
  assert.ok(!names.some((n) => n === 'mounted'), `renderjs 块必须跳过，实得 ${names}`);

  // <script src> 外部引用 ⇒ 跳过（内容在别的文件）
  const srcVue = '<template><div>x</div></template>\n<script src="./shared.js"></script>\n';
  const rs = await parseFileFull('src/views/ext.vue', srcVue);
  assert.deepEqual(rs.symbols, [], '<script src> 不产符号');
  assert.equal(rs.parser, VUE_SFC_PARSER, '仍标 vue-sfc');
});

test('vue-sfc · ⑥内核可达：同步入口 parseFileFullSync 同样出符号（M4）', async () => {
  // 同步路径要 parser 预热（绝不动态 import）；测前显式预热，只测本卡的分派与回填
  await prewarmKernel();

  // ★★ A4 特例的鉴别力（M7 抓这条）：就绪判定必须**跟随子语言**，不跟 vue 包。
  //   为什么本机默认抓不到：`prewarmKernel` 会遍历全部语言；若 vue 包能载入，`.vue` 与 `.js`
  //   同时就绪 ⇒ 砍特例后判定不变 ⇒ 判据没牙。所以这里**显式把两条缓存打回未预热**，
  //   自己控制前提，不依赖本机 vue 包是否可载入。
  clearLoaderCache();
  assert.equal(canParseFileSync('src/views/theme.vue'), false, '全未预热时 .vue 不就绪（如实）');

  await getParserForProbe('.js'); // 只预热子语言 .js
  assert.notEqual(getParserSync('.js'), null, '.js 已预热（本机 javascript 包可用）');
  assert.equal(getParserSync('.vue'), null, '前提：vue 包此刻**未**预热');

  // ⇒ 旧判据（要求 vue 包预热）此刻返回 false；正确判据（子语言就绪）返回 true
  assert.equal(
    parserReadyForFile('src/views/theme.vue'),
    true,
    'parserReadyForFile(.vue) 跟子语言 .js 走 = true（不跟 vue 包走；砍 A4 特例 ⇒ 此条红）',
  );
  assert.equal(canParseFileSync('src/views/theme.vue'), true, 'canParseFileSync(.vue) 同理 = true（M7 咬这条）');
  assert.equal(
    canParseFileSync('src/views/theme.vue'),
    canParseFileSync('src/views/theme.js'),
    '.vue 与 .js 就绪同值（组合式共用子语言）',
  );

  // 之后补预热其余语言，让下面的同步解析在完整预热下进行
  await prewarmKernel();

  const rs = parseFileFullSync('src/views/theme.vue', OPTIONS_VUE);
  assert.equal(rs.error, undefined, `同步路径不应报错，实得 ${rs.error}`);
  assert.equal(rs.parser, VUE_SFC_PARSER, '同步路径同样标 vue-sfc');
  const names = rs.symbols.map((s) => s.name);
  assert.ok(names.includes('getInfo'), `同步入口出符号，实得 ${names}`);
  const imp = rs.imports.find((i) => i.source === '@/api/theme.js');
  assert.ok(imp && imp.line === 6, `同步入口 import 行号回填，实得 ${JSON.stringify(imp)}`);
  const keys = rs.calls.map((c) => `${c.caller}/${c.callee}/${c.line}`);
  assert.equal(new Set(keys).size, keys.length, '同步入口 calls 同样去重');
});

test('vue-sfc · ⑦不误伤：未注册语言仍静默空；多 script 块各自回填基准', async () => {
  const other = await parseFileFull('x.xyzzy', 'whatever');
  assert.deepEqual(other.symbols, [], '未注册语言仍静默空');
  assert.equal(other.parser, undefined, '未注册语言不标 vue-sfc');

  // 多 script 块：第二块的 lineBase 必须从**它自己的**内容首行起算（不许沿用第一块）
  const multi = [
    '<template><div>x</div></template>',
    '<script>',
    'export default { methods: { first() {} } }',
    '</script>',
    '<script setup>',
    '',
    'const second = 1',
    'function secondFn() { return second }',
    '</script>',
    '',
  ].join('\n');
  const r = await parseFileFull('src/views/multi.vue', multi);
  assert.equal(r.parser, VUE_SFC_PARSER);
  const names = r.symbols.map((s) => s.name);
  assert.ok(names.includes('first'), `首块出符号，实得 ${names}`);
  assert.ok(names.includes('secondFn'), `次块出符号，实得 ${names}`);
  const secondFn = r.symbols.find((s) => s.name === 'secondFn')!;
  // secondFn 在 SFC 第 8 行（1-based）；若沿用首块基准会算成第 3 行
  assert.equal(secondFn.start_line, 8, `次块行号独立回填，实得 ${secondFn.start_line}`);
  const first = r.symbols.find((s) => s.name === 'first')!;
  assert.equal(first.start_line, 3, `首块行号，实得 ${first.start_line}`);
});
