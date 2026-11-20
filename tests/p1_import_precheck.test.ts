/**
 * card-cashier-gate —— **导入预检闸：区分"解析器坏"与"文件本来就没符号"**（机器回归）。
 *
 * ## 病史（实测原文）
 * fuintCashier（Electron+Vue2，109 个代码文件）导入被拒：
 *   「导入被拒：**解析器出不了符号**（预检 3 个代码文件，合计 0 个符号）
 *     · 预检样例：.eslintrc.js · .postcssrc.js · config\index.js」
 * 真因**不是**解析器坏（同进程同参数导 fuintAdmin/fuintUniapp 都成功）——
 *   那三个是 `module.exports = {…}` 形态的**纯配置**，本来就产不出符号；
 *   而同一项目 `server/index.js` 有 19 个符号。**闸把"样本恰好没符号"当成了"解析器没工作"。**
 *
 * ## 判据（每条都能证红）
 * | # | 断言 | 改坏之后 |
 * |---|---|---|
 * | ① | **正例**：配置文件 + 纯 import 脚本 + 纯 `export default {…}` 组件 + 正常代码混合的项目
 *       ⇒ **导入成功**且 `symbols_found > 0`、`nodes` 表里有那个真函数名 | 闸改回"前 3 个" ⇒ ① 红 |
 * | ② | **反例**：同一个项目、解析器被弄坏（能出树但抽不出符号）
 *       ⇒ **抛"导入被拒"**且 `cache.db` 里**一行节点都没写** | 闸删掉 ⇒ ② 红（空索引静默建成） |
 * | ③ | **结构判据自身的鉴别力**：配置文件判"无结构"、代码文件判"有结构" | 任一方向退化 ⇒ ③ 红 |
 *
 * ## ②的"弄坏"是怎么造的（不是桩，是真的让解析器产不出符号）
 * `tree-sitter` 的 `Parser.prototype.parse` 被换成"保留根节点类型、但一个子节点都不给"。
 * 这正是 ABI 不符/语法包错配时的真实形态：**parse 不抛错、树在、符号面全空**。
 * 于是"有结构的文件抽不出符号"这条判据被触发 —— 而纯配置文件的树本来就只有
 * `program → expression_statement → assignment_expression`，坏与不坏在它身上**看不出区别**，
 * 这正是"不能拿配置文件当证据"的原因。
 *
 * ## 为什么不用 `mock.module`
 * 本机 Node 24.22.3 的 `node:test` **没有** `mock.module`（实测 `typeof mock.module === 'undefined'`），
 * 而 ESM 命名空间是冻结的（`Cannot redefine property: getParser`）。⇒ 只能在
 * `tree-sitter` 那个类上动手 —— 它恰好是所有解析路径的**唯一入口**（`getParser` 动态 import 它）。
 *
 * touches: src/infrastructure/parse/kernel.ts, src/infrastructure/graph/import_project.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { importProject } from '../src/infrastructure/graph/import_project.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { parseFile, parseRootForFile, astHasDeclarativeStructure } from '../src/infrastructure/parse/kernel.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

// ════════════════════════════════════════════════════════════════════
// 夹具：fuintCashier 的**形态**（不是它的字面内容）
//   · 三个"天然 0 符号"的**配置** + 两个"0 符号但有结构"的**代码**（组件/路由表）
//   · 一个正常代码文件（出符号）
// 字典序决定了 walk 顺序 ⇒ 前 3 个恰好是**全 0 符号**的（这正是误拒的触发条件）。
// ════════════════════════════════════════════════════════════════════

/** `.eslintrc.js` 形态：`module.exports = {…}`（纯数据） */
const CONFIG_ESLINT = `module.exports = {
  root: true,
  parser: 'babel-eslint',
  rules: { 'no-console': 'off' },
};
`;

/** `.postcssrc.js` 形态：一行对象字面量 */
const CONFIG_POSTCSS = `module.exports = { plugins: { autoprefixer: {} } };
`;

/**
 * `config/index.js` 形态：**纯对象字面量配置**（0 符号）。
 * ★ 实测取材质：真实 fuintCashier 的 `config/index.js` 就是这样（175 字节，只有 `module.exports = {…}`）。
 *   **不能**写成 `const path = require('path'); module.exports = {…}` —— 那样 `const path` 会出 1 个符号，
 *   夹具就复刻不出"前 3 个合计 0 符号"这个触发条件（第一版就栽在这，被 ④ 当场抓住）。
 */
const CONFIG_INDEX = `module.exports = {
  dev: { port: 9080, assetsSubDirectory: 'static' },
  build: { port: 9080, index: '../dist/index.html' },
};
`;

/** `App.vue` 形态：`<script setup>` 里**只有 import**（0 符号，但确实是代码） */
const APP_VUE = `<template>
  <div id="app"><router-view></router-view></div>
</template>

<script setup>
import CHeader from "./components/title";
</script>

<style>
#app { color: #333; }
</style>
`;

/** `constantRouterMap.js` 形态：`import` + `export default [ … ]`（0 符号，但确实是代码） */
const ROUTER_JS = `import Layout from '@/layout';

export default [
  { path: '/', component: Layout, children: [{ path: 'index', name: 'index' }] },
  { path: '/login', component: () => import('@/views/login') },
];
`;

/** 正常代码：**必须**出符号（这是"解析器在工作"的唯一硬证据） */
const SERVER_INDEX = `const path = require('path');
const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({ width: 1200, height: 800 });
  return win;
}

function registerIpc() {
  return app;
}

module.exports = { createWindow, registerIpc };
`;

function makeProj(name: string): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'renderer'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'router'), { recursive: true });
  // 字典序：'.eslintrc.js' < '.postcssrc.js' < 'config' < 'package.json' < 'server' < 'src'
  fs.writeFileSync(path.join(dir, '.eslintrc.js'), CONFIG_ESLINT, 'utf-8');
  fs.writeFileSync(path.join(dir, '.postcssrc.js'), CONFIG_POSTCSS, 'utf-8');
  fs.writeFileSync(path.join(dir, 'config', 'index.js'), CONFIG_INDEX, 'utf-8');
  fs.writeFileSync(path.join(dir, 'server', 'index.js'), SERVER_INDEX, 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'renderer', 'App.vue'), APP_VUE, 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'router', 'constantRouterMap.js'), ROUTER_JS, 'utf-8');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }, null, 2), 'utf-8');
  return dir;
}

/** Vue-only 反例：没有普通 JS 文件可以替坏掉的 Vue 子解析器触发拒绝。 */
function makeVueOnlyProj(name: string): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
  for (const component of ['Alpha', 'Beta']) {
    const fn = `load${component}`;
    fs.writeFileSync(
      path.join(dir, 'src', 'components', `${component}.vue`),
      `<template><div>${component}</div></template>\n<script>\nexport function ${fn}(id) {\n  return { component: '${component}', id };\n}\n</script>\n`,
      'utf-8',
    );
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'vue-only', version: '1.0.0' }), 'utf-8');
  return dir;
}

let seq = 0;
function featureOf(): string {
  seq += 1;
  return `p1_import_precheck_${process.pid}_${seq}`;
}

// ════════════════════════════════════════════════════════════════════
// ⓐ 结构判据自身（有牙的最底层：两个方向都要对）
// ════════════════════════════════════════════════════════════════════
test('③ 结构判据：纯配置判"无结构"，代码文件判"有结构"', async () => {
  const dir = path.join(TMP, 'structure');
  fs.mkdirSync(path.join(dir, 'src', 'router'), { recursive: true });
  const files: Array<[string, string, boolean, string]> = [
    ['config.js', CONFIG_ESLINT, false, '`module.exports = {…}` 是纯数据，不是声明'],
    ['postcss.js', CONFIG_POSTCSS, false, '一行对象字面量'],
    ['index.js', CONFIG_INDEX, false, '嵌套对象配置'],
    [path.join('src', 'router', 'routes.js'), ROUTER_JS, false, 'import + export default [数组] 不产生符号，也不算声明'],
    [path.join('src', 'App.vue'), APP_VUE, false, '`<script setup>` 里只有 import'],
    ['server.js', SERVER_INDEX, true, '有 function 声明 ⇒ 有结构'],
  ];
  for (const [rel, text, want, why] of files) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf-8');
    const ast = await parseRootForFile(p, text);
    assert.ok(ast, `${rel}: 必须拿到树（拿不到 ⇒ 判据没证据，而不是"没结构"）`);
    const got = astHasDeclarativeStructure(ast.root, ast.langName);
    assert.equal(got, want, `${rel}: ${why}（判据给 ${got}）`);
  }

  // ★ 反向：同一份"配置文件"若被解析器弄坏，**看不出区别** —— 所以它不能当证据。
  const ts = (await import('tree-sitter')).default as { prototype: { parse: unknown } };
  const orig = ts.prototype.parse;
  let brokenSyms = 0;
  let brokenStructured: boolean | null = null;
  try {
    ts.prototype.parse = function degenerateParse(this: unknown) {
      // 保留根节点类型、一个子节点都不给 —— ABI 不符时的真实形态（parse 不抛错，树"在"但空）
      return {
        rootNode: {
          type: 'program',
          childCount: 0,
          child: () => null,
          childForFieldName: () => null,
          text: '',
          startPosition: { row: 0 },
          endPosition: { row: 0 },
          children: [],
        },
      };
    };
    const codeFile = path.join(dir, 'server.js');
    brokenSyms = (await parseFile(codeFile, SERVER_INDEX)).length;
    const ast = await parseRootForFile(codeFile, SERVER_INDEX);
    brokenStructured = ast ? astHasDeclarativeStructure(ast.root, ast.langName) : null;
  } finally {
    ts.prototype.parse = orig;
  }
  assert.equal(brokenSyms, 0, '把解析器弄坏后，正常代码文件必须抽不出符号（否则"坏"没造出来）');
  assert.equal(
    brokenStructured,
    false,
    '★ 坏的时候"结构"也没了 —— 这就是为什么**必须同时看符号数与结构**：' +
      '单看结构会放过"解析器全挂"，单看结构也分不开配置与坏代码',
  );
});

// ════════════════════════════════════════════════════════════════════
// ① 正例：fuintCashier 形态 ⇒ **必须导入成功**
// ════════════════════════════════════════════════════════════════════
test('① 正例：配置+空脚本+正常代码混合 ⇒ 导入成功且出符号（旧闸在此误拒）', async () => {
  const proj = makeProj('positive');
  const feature = featureOf();
  const r = (await importProject({ project_dir: proj, feature } as never)) as Record<string, unknown>;

  assert.ok((r.files_parsed as number) > 0, `必须真的导入文件，实得 ${r.files_parsed}`);
  assert.ok(
    (r.symbols_found as number) > 0,
    `★ 必须出符号（旧闸在这一步之前就拒了）：files=${r.files_parsed} symbols=${r.symbols_found}`,
  );

  // 索引里真的查得到那个函数（不只是回执里的数）
  const db = getProjectCacheDb(proj);
  const hit = db
    .prepare("SELECT name FROM nodes WHERE name IN ('createWindow','registerIpc') ORDER BY name")
    .all() as unknown as Array<{ name: string }>;
  assert.deepEqual(hit.map((h) => h.name), ['createWindow', 'registerIpc'], `nodes 表必须真有这两个函数，实得 ${JSON.stringify(hit)}`);

  // "无结构"那条如实报出来（不静默、也不当故障）
  const skipped: string[] = (r.skipped as string[]) ?? [];
  assert.ok(
    skipped.some((s) => s.includes('没有声明结构')) || (r.symbols_found as number) > 0,
    '要么如实报出"无结构"的文件，要么根本不需要（有符号证据就够）',
  );
});

// ════════════════════════════════════════════════════════════════════
// ② 反例：解析器真坏 ⇒ **必须拒**、且一个字节都不写
// ════════════════════════════════════════════════════════════════════
test('② 反例：解析器抽不出符号 ⇒ 拒导入，且 cache.db 零写入', async () => {
  const proj = makeProj('negative');
  const feature = featureOf();
  const db = getProjectCacheDb(proj);

  const ts = (await import('tree-sitter')).default as { prototype: { parse: unknown } };
  const orig = ts.prototype.parse;
  let err: Error | null = null;
  try {
    ts.prototype.parse = function degenerateParse(this: unknown) {
      return {
        rootNode: {
          type: 'program',
          childCount: 0,
          child: () => null,
          childForFieldName: () => null,
          text: '',
          startPosition: { row: 0 },
          endPosition: { row: 0 },
          children: [],
        },
      };
    };
    try {
      await importProject({ project_dir: proj, feature } as never);
    } catch (e) {
      err = e as Error;
    }
  } finally {
    ts.prototype.parse = orig;
  }

  assert.ok(err, '★ 解析器抽不出符号时必须抛错（闸删掉 ⇒ 这里拿到的是"导入成功"⇒ 空索引静默建成）');
  assert.match(err!.message, /导入被拒|解析器/, `拒绝文案必须点名"解析器/导入被拒"，实得：${err!.message.slice(0, 200)}`);

  // ★ "一个字节都没写"：索引表必须还是空的（闸在写索引之前）
  const nodeCount = (db.prepare('SELECT count(1) AS n FROM nodes').get() as { n: number }).n;
  assert.equal(nodeCount, 0, `★ 被拒时 nodes 表必须一行都没有（实得 ${nodeCount} 行）—— 否则就是"空索引已经落库"`);

  // ★ 恢复解析器后**同一个项目**必须能导进来（证明拒的是"坏",不是"这项目不行"）
  const r = (await importProject({ project_dir: proj, feature }) as never) as Record<string, unknown>;
  assert.ok((r.symbols_found as number) > 0, '恢复解析器后同一项目必须导入成功并出符号');
});

// ════════════════════════════════════════════════════════════════════
// ②b Vue-only：合成根不得掩盖每个 script 子树的空根故障
// ════════════════════════════════════════════════════════════════════
test('②b Vue-only 空子树 ⇒ 拒绝且不写节点；恢复后可导入', async () => {
  const proj = makeVueOnlyProj('vue-only-degenerate');
  const feature = featureOf();
  const ts = (await import('tree-sitter')).default as { prototype: { parse: unknown } };
  const orig = ts.prototype.parse;
  try {
    ts.prototype.parse = function degenerateVueParse() {
      return {
        rootNode: {
          type: 'program', childCount: 0, child: () => null, childForFieldName: () => null,
          text: '', startPosition: { row: 0 }, endPosition: { row: 0 }, children: [],
        },
      };
    };
    await assert.rejects(
      importProject({ project_dir: proj, feature }),
      /导入被拒/,
      'Vue-only 项目没有 JS 救场：两个空 script 子树也必须触发预检拒绝',
    );
    const n = getProjectCacheDb(proj).prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number };
    assert.equal(n.n, 0, '预检拒绝必须发生在任何 nodes 写入之前');
  } finally {
    ts.prototype.parse = orig;
  }
  const recovered = await importProject({ project_dir: proj, feature: `${feature}_recovered` });
  assert.ok((recovered.symbols_found as number) > 0, '恢复解析器后，同一 Vue-only 项目必须能出符号');
});

// ════════════════════════════════════════════════════════════════════
// ③ 对照：旧闸（前 3 个代码文件、合计 0 符号就拒）在本夹具上**会误拒**
//    —— 这条用例本身不变红，它是给上面 ① 提供"为什么必须改"的对照读数
// ════════════════════════════════════════════════════════════════════
test('④ 对照：夹具的前 3 个代码文件确实全是 0 符号（复刻误拒的触发条件）', async () => {
  const proj = makeProj('control');
  const order = ['.eslintrc.js', '.postcssrc.js', path.join('config', 'index.js')];
  let total = 0;
  for (const rel of order) {
    const p = path.join(proj, rel);
    assert.ok(fs.existsSync(p), `夹具必须包含 ${rel}（旧闸取的就是前 3 个代码文件）`);
    total += (await parseFile(p, fs.readFileSync(p, 'utf-8'))).length;
  }
  assert.equal(
    total,
    0,
    `★ 这 3 个文件合计必须 0 符号 —— 否则本夹具复刻不出 fuintCashier 的触发条件` +
      `（前 3 个代码文件按 walk 字典序：.eslintrc.js / .postcssrc.js / config/index.js）`,
  );
});
