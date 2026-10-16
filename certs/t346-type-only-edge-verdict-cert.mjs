#!/usr/bin/env node
/**
 * ★★★ cert T346 —— **`edge-exists` 对 type-only 导入的判定** 的出生证（2026-10-16，T3 / G2）。
 *
 * ## 这一笔要钉住什么（`docs/board.md` T3 · `docs/replan-log-2026-10-15.md` §83.3）
 *   `src/application/design/intent/expectations.ts` 的 `edge-exists` 分支里，有一句
 *   **"type-only 冤案排解"**：当"期望存在该依赖边、但依赖边表里没有"时，回头查原始 import 记录，
 *   若命中一条 `type_only` 的导入 ⇒ 判 **unsupported**（"按设计不建边 ⇒ 判不了"），而不是 fail。
 *   ★ 原实现拿 **带扩展名的** 串硬比（`to.split('/').pop()` = `b.ts` vs raw import `'./b.js'`）
 *     ⇒ **永不命中 = 死代码** ⇒ 把合法的 `import type` 读成"不存在" ⇒ **假红**。
 *   ★ 本仓约定（ESM/NodeNext）：**源码写 `.js`、真实文件是 `.ts`** ⇒ 这个不命中是**系统性的**，不是偶发。
 *
 * ## 判据（★ 每条都亲手跑、贴读数）★ 两个**必须都有**的对照
 *   (a) **真的 type-only import** ⇒ 必须判 **`unsupported`**（★ 不是 `fail`＝假红，也不是 `pass`＝假绿）；
 *   (b) **真的存在该边（值导入）**   ⇒ 必须判 **`pass`**；
 *   ★ 两者用**同一台天平**（`judgeExpectations`，= 生产里那个对拍器）在同一份夹具上并排跑 ⇒
 *     若 (a) 也变 `pass`（说明排解把"判不了"当成了"存在"= 改错方向）或 (a) 仍 `fail`（没修）⇒ 本证红。
 *   ③ ★★ **前提自证**：把"死代码为什么死"直接量出来 —— `'./b.js'.includes('b.ts') === false`（旧子句的形态）。
 *   ④ ★ **走工具层**：判据用的就是 `judgeExpectations`（生产对拍器）；底下的事实另用
 *      `getRawImportsOfFile`（原始 import 记录）+ `fileFacts`（依赖事实）**当场读数**，证明"判不了"有据。
 *
 * ## 用法
 *   node certs/t346-type-only-edge-verdict-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 * ★ 夹具住 `certs/.work/tmp346`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓 `.agent-io/`**；
 * ★ 真仓 `cache.db` **本证根本不打开**（只开夹具自己的 `code/.agent-io/cache.db`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp346');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { judgeExpectations } = await import('../dist/src/application/design/intent/expectations.js');
const { getProjectCacheDb } = await import('../dist/src/infrastructure/index/db.js');
const { syncFile } = await import('../dist/src/infrastructure/index/symbols.js');
const { getRawImportsOfFile } = await import('../dist/src/infrastructure/index/symbols.js');
const { fileFacts } = await import('../dist/src/infrastructure/index/file_facts.js');

// ── 夹具源码树（★ 3 个文件：一个被依赖的 `b.ts`，一个**type-only** 引它的 `a.ts`，一个**值**引它的 `c.ts`）──
const CODE = path.join(TMP, 'code');
const SRC = {
  'src/b.ts': `export interface B {
  n: number;
}

export const mkB = (n: number): B => ({ n });
`,
  // ★ (a) 真的 type-only：`import type` ⇒ 运行时擦除 ⇒ 按设计**不建依赖边**
  'src/a.ts': `import type { B } from './b.js';

export function readB(x: B): number {
  return x.n;
}
`,
  // ★ (b) 真的值导入：`import { mkB }` ⇒ 建依赖边（\`kind='import'\`）
  'src/c.ts': `import { mkB } from './b.js';

export const value = mkB(1);
`,
};
for (const [rel, code] of Object.entries(SRC)) {
  const abs = path.join(CODE, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, code, 'utf-8');
}
const db = getProjectCacheDb(CODE);
// ★ 依赖先在（b.ts 被 a/c 引）⇒ 按依赖顺序 sync
for (const rel of ['src/b.ts', 'src/a.ts', 'src/c.ts']) await syncFile(db, CODE, path.join(CODE, rel));

console.log('════ 0. 夹具就位（临时根 + 独立 AGENT_IO_HOME）════');
console.log(`   临时根   = ${CODE}\n   临时 home = ${HOME}`);

// ── 0-b ★★ "死代码为什么死"：把旧子句的形态直接量出来（前提自证）──
{
  const to = 'src/b.ts';
  const rawSource = './b.js';
  const oldClause = rawSource.includes(to.split('/').pop() ?? '');
  const oldStartsWith = to.startsWith(rawSource.replace(/^\.\//, ''));
  chk(
    oldClause === false && oldStartsWith === false,
    '0-b ★ 前提自证：**旧的 type-only 匹配子句对本仓 `.js` 说明符永不命中**（⇒ 修前是死代码）',
    `'./b.js'.includes('${to.split('/').pop()}') = ${oldClause} · '${to}'.startsWith('./b.js'.replace(/^\\.\\//,'')) = ${oldStartsWith}`,
  );
}

// ── 0-c ★★ 底下的事实（工具层读数）：raw import 的 type_only 与依赖边表 ──
let factsA;
let factsC;
{
  const rawA = getRawImportsOfFile(db, 'src/a.ts');
  const rawC = getRawImportsOfFile(db, 'src/c.ts');
  factsA = fileFacts(CODE, 'src/a.ts');
  factsC = fileFacts(CODE, 'src/c.ts');
  console.log('\n════ 0-c 事实层读数（getRawImportsOfFile + fileFacts）════');
  console.log(`   a.ts raw imports = ${JSON.stringify(rawA)}`);
  console.log(`   c.ts raw imports = ${JSON.stringify(rawC)}`);
  console.log(`   a.ts deps        = ${JSON.stringify(factsA.deps)}`);
  console.log(`   c.ts deps        = ${JSON.stringify(factsC.deps)}`);

  chk(
    rawA.length === 1 && rawA[0].source === './b.js' && rawA[0].type_only === true,
    '0-c① ★ (a) 夹具确凿：`a.ts` 对 `./b.js` 的导入是 **type_only=true**',
    `rawA=${JSON.stringify(rawA)}`,
  );
  chk(
    factsA.deps.length === 0,
    '0-c② ★ (a) 按设计**不建边**：`a.ts` 的依赖事实里**没有** `src/b.ts`（所以只能判"判不了"）',
    `a.ts deps=${JSON.stringify(factsA.deps)}`,
  );
  chk(
    rawC.length === 1 && rawC[0].source === './b.js' && rawC[0].type_only === false,
    '0-c③ ★ (b) 夹具确凿：`c.ts` 对 `./b.js` 的导入**不是** type-only',
    `rawC=${JSON.stringify(rawC)}`,
  );
  chk(
    factsC.deps.includes('src/b.ts'),
    '0-c④ ★ (b) **真的存在该边**：`c.ts` 的依赖事实里有 `src/b.ts`',
    `c.ts deps=${JSON.stringify(factsC.deps)}`,
  );
}

// ── ① ★★ 两个对照并排跑同一台天平（= 生产对拍器 judgeExpectations）──
const items = [
  {
    node_id: 'n_a',
    node_label: 'a.ts（type-only）',
    expectation: { kind: 'edge-exists', from: 'src/a.ts', to: 'src/b.ts', why: '(a) type-only ⇒ 应判 unsupported' },
  },
  {
    node_id: 'n_c',
    node_label: 'c.ts（值导入）',
    expectation: { kind: 'edge-exists', from: 'src/c.ts', to: 'src/b.ts', why: '(b) 真的存在该边 ⇒ 应判 pass' },
  },
];
const r = await judgeExpectations(CODE, items);
const byNode = new Map(r.items.map((x) => [x.node_id, x]));
const a = byNode.get('n_a');
const b = byNode.get('n_c');

console.log('\n════ ① 两个对照（同一台天平 = judgeExpectations）════');
console.log(`   汇总: ${JSON.stringify({ checked: r.checked, passed: r.passed, failed: r.failed, unsupported: r.unsupported })}`);
console.log(`   (a) type-only      → [${a?.verdict}] ${a?.detail}`);
console.log(`   (b) 真的存在该边  → [${b?.verdict}] ${b?.detail}`);

chk(
  a?.verdict === 'unsupported',
  '①-a ★★ (a) **真的 type-only import ⇒ 判 `unsupported`**（既不是 fail＝假红，也不是 pass＝假绿）',
  `verdict=${a?.verdict}`,
);
chk(
  a?.verdict !== 'pass' && a?.verdict !== 'fail',
  '①-a\' ★ 反向守门：(a) **没有**被读成 pass（假绿）或 fail（假红）—— 三态里只剩它该在的那一态',
  `verdict=${a?.verdict}`,
);
chk(
  b?.verdict === 'pass',
  '①-b ★★ (b) **真的存在该边 ⇒ 判 `pass`**（排解**不许**把"存在"也吞成"判不了"）',
  `verdict=${b?.verdict}`,
);
chk(
  r.unsupported === 1 && r.passed === 1 && r.failed === 0,
  '①-c ★ 计数自洽：(a)(b) 两条 ⇒ `unsupported=1 · passed=1 · failed=0`（★ 若 (a) 仍 fail 则 failed=1；若 (a) 变 pass 则 unsupported=0）',
  `checked=${r.checked} · passed=${r.passed} · failed=${r.failed} · unsupported=${r.unsupported}`,
);

// ── ② 反向对照：**同一条 type-only 事实**下，`edge-absent` 不该被判成 unsupported 的同类错误 ──
//   ★ 说明：`edge-absent` 不走 type-only 排解（排解只服务 `edge-exists`）⇒ 它按"事实里没有该边"判 **pass**。
//     这条不是本笔的判据对象，但它是**同夹具上的对照读数**，证明"排解只挑 edge-exists 那一支、没有外溢"。
{
  const items2 = [
    { node_id: 'n_a2', node_label: 'a.ts', expectation: { kind: 'edge-absent', from: 'src/a.ts', to: 'src/b.ts', why: '对照' } },
    { node_id: 'n_c2', node_label: 'c.ts', expectation: { kind: 'edge-absent', from: 'src/c.ts', to: 'src/b.ts', why: '对照' } },
  ];
  const r2 = await judgeExpectations(CODE, items2);
  const m = new Map(r2.items.map((x) => [x.node_id, x]));
  console.log('\n════ ② 同夹具对照：`edge-absent` 不受这条排解影响（外溢检查）════');
  console.log(`   a.ts edge-absent → [${m.get('n_a2')?.verdict}] ${m.get('n_a2')?.detail}`);
  console.log(`   c.ts edge-absent → [${m.get('n_c2')?.verdict}] ${m.get('n_c2')?.detail}`);
  chk(
    m.get('n_a2')?.verdict === 'pass' && m.get('n_c2')?.verdict === 'fail',
    '② ★ 对照：`edge-absent` 按**事实里的边**判（a.ts 无该边 ⇒ pass；c.ts 有该边 ⇒ fail）—— 排解**没有外溢**到 edge-absent',
    `a=${m.get('n_a2')?.verdict} · c=${m.get('n_c2')?.verdict}`,
  );
}

// ★★ 清理：本证只此 1 次删除；失败响亮报告（宿主删除闸 ≠ 本证判红）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
