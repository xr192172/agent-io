/**
 * 钉住**两处「手抄权威」不再长回来**（2026-11-02 · `subagent:kill-handcopy`）。
 *
 * ## 为什么需要（两处都是「同一事实两处，改一处不改另一处仍看起来正常」）
 * **A) index 跳过判据**：权威 `source_exts.ts#NOISE_FILE_RE` 认 `.d.[cm]?ts`，而
 *   `watch_project.ts` 曾**自己**持有一条 `SKIP_FILE_RE`（只认 `.d.ts`）⇒ 实测
 *   `src/a.d.mts` / `src/a.d.cts`：`import_project`（走权威）**不收**、`shouldSyncRel`（走副本）**收** ——
 *   全量建索引与增量同步对同一批文件结论相反。本测试用**双侧同值**把它钉死：
 *   只要有人再往 watch 侧长一份自己的清单，第一条就会红。
 * **B) shape 值域**：权威 `geometry.ts` 是 8 值，`node_ops.ts` 两个入参类型手抄 5 值、
 *   `op_data_spec.ts` 的 `note` 再抄 5 值 ⇒ `parallelogram` / `hexagon` / `triangle` 在 TS 层进不来。
 *   本测试钉三条：8 值只在 `geometry.ts` 声明、两个副本文件**一个形状字面量都没有**、描述从权威渲染。
 *
 * ## 口径
 * · A 的判据是**行为**（现跑两侧函数比结论），不是"文件里有没有某个串"；
 * · B 的字面量扫描是**文本形状即答案**的场合（判的就是"还有没有第二份清单"），故用 grep 式断言。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldSyncRel } from '../src/infrastructure/index/watch_project.js';
import { isIndexSkippedFileName, isNoiseFileName, isTestFileName } from '../src/infrastructure/parse/source_exts.js';
import { NODE_SHAPES, isNodeShape, nodeShapeError } from '../src/domain/geometry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 源码目录下所有 `.ts`（框架目录 / 构建产物不在其中） */
function srcFiles(dir = path.join(ROOT, 'src')): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...srcFiles(p));
    else if (e.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * 语料：**都是代码扩展名**（判据只在这个域里成立 —— `shouldSyncRel` 还多一道"是不是源码扩展名"，
 * 那一道与"该不该跳过"是两个问题，混进来会把两侧本不必相等的情形当成缺陷）。
 */
const CORPUS = [
  'a.d.ts',
  'a.d.cts',
  'a.d.mts',
  'a.ts',
  'a.mts',
  'a.cts',
  'a_test.go',
  'x.test.ts',
  'x.spec.ts',
  'test_x.py',
  'x_test.py',
  '~tmp.ts',
  'a.min.js',
  'a.gen.ts',
  'a.tmp',
  'a.bak',
  'ns~',
  'a.swp',
];

test('A1 · 索引侧与 watch 侧对同一文件名的结论必须相同（双侧同值）', () => {
  const diff = CORPUS.filter((n) => shouldSyncRel(`src/${n}`) !== !isIndexSkippedFileName(n, false));
  assert.deepEqual(
    diff,
    [],
    `两侧结论相反的文件名：${diff.join(', ')} —— 「什么文件该跳过」只许有一处判据（source_exts.ts#isIndexSkippedFileName）`,
  );
});

test('A1b · 声明产物 .d.ts / .d.cts / .d.mts 三种两侧都判「不进」（缺陷 A 的原始症状）', () => {
  for (const n of ['a.d.ts', 'a.d.cts', 'a.d.mts']) {
    assert.equal(shouldSyncRel(`src/${n}`), false, `shouldSyncRel(src/${n}) 应为 false`);
    assert.equal(isIndexSkippedFileName(n, false), true, `isIndexSkippedFileName(${n}) 应为 true`);
  }
});

test('A2 · watch 特有行为不变：测试物仍被跳过（_test.go / *.test.ts / *.spec.ts / test_*.py / ~ 前缀）', () => {
  const stillSkipped = ['a_test.go', 'x.test.ts', 'x.spec.ts', 'test_x.py', 'x_test.py', '~tmp.ts'];
  const leaked = stillSkipped.filter((n) => shouldSyncRel(`src/${n}`));
  assert.deepEqual(leaked, [], `这些测试物/临时件漏进了索引同步：${leaked.join(', ')}`);
  // 测试物那一半必须是**测试判据**命中（不是靠噪音判据蒙对）—— 否则将来改 NOISE 会静默改变语义
  for (const n of ['a_test.go', 'x.test.ts', 'x.spec.ts', 'test_x.py', 'x_test.py']) {
    assert.equal(isTestFileName(n), true, `${n} 应由 TEST_FILE_RE 判成测试物`);
  }
});

test('A3 · 权威没被削：.d.ts / .d.cts / .d.mts 仍都判「噪音」', () => {
  for (const n of ['a.d.ts', 'a.d.cts', 'a.d.mts']) assert.equal(isNoiseFileName(n), true, `${n} 应判噪音`);
  // `^~`（Office/编辑器写盘中间件）收归后仍在判据里 —— 删副本不许把这条一起丢掉
  assert.equal(isNoiseFileName('~$report.docx'), true, '~ 前缀应仍判噪音');
});

test('A4 · 第二份清单不许长回来：watch_project.ts 不再持有任何 skip 正则', () => {
  const src = read('src/infrastructure/index/watch_project.ts');
  assert.match(src, /isIndexSkippedFileName\(/, 'shouldSyncRel 必须调权威 isIndexSkippedFileName');
  // ★ 判的是**定义**（`const SKIP_FILE_RE = …`），不是"文件里出现了这个词"：墓碑注释里留着名字是
  //   有意的（写清"这里曾经有过第二份、为什么删"）—— 把注释一并禁掉等于禁止记录病史。
  assert.equal(/const\s+SKIP_FILE_RE\s*=/.test(src), false, 'watch_project.ts 里又定义了 SKIP_FILE_RE（第二份清单）');
  assert.equal(src.includes('_test\\.go$'), false, 'watch_project.ts 里又出现了测试物正则片段');
  // 全仓：**整条测试物清单**（同一条正则里既有 `_test\.go$` 又有 `.spec\.`）只许在权威里出现一次。
  // ★ 口径为什么这么定：`derive_split.ts` / `detect_dead_imports.ts` 里各有一处 `/_test\.go$/`
  //   ——它们问的是**另一件事**（"这个 go 包有没有测试文件" / 死 import 过滤），不是"该不该进索引"
  //   ⇒ 不并进来（并了会改它们各自的口径）；而**整条清单**一旦复制出去，就是同一件事的第二个住处。
  const owners = srcFiles()
    .filter((p) => {
      const t = fs.readFileSync(p, 'utf8');
      return t.includes('_test\\.go$') && t.includes('.spec\\.');
    })
    .map((p) => path.relative(ROOT, p).split(path.sep).join('/'));
  assert.deepEqual(owners, ['src/infrastructure/parse/source_exts.ts'], `测试物清单出现在多处：${owners.join(', ')}`);
});

test('B1 · 8 种 shape 全在权威里且逐个判合法（改前 3 个在 TS 层进不来）', () => {
  assert.equal(NODE_SHAPES.length, 8, `NODE_SHAPES 应有 8 个值，实际 ${NODE_SHAPES.length}`);
  for (const s of NODE_SHAPES) {
    assert.equal(isNodeShape(s), true, `${s} 应判合法`);
    assert.equal(nodeShapeError(s), null, `${s} 不该有错报文`);
  }
  assert.deepEqual(
    [...NODE_SHAPES],
    ['rect', 'rounded', 'circle', 'diamond', 'freeform', 'parallelogram', 'hexagon', 'triangle'],
    '值域内容变了 ⇒ 同步更新这条断言（它守的是"8 个一个不少"）',
  );
});

test('B2 · 非法值仍拒，且报文里说得出**全部**合法值', () => {
  assert.equal(isNodeShape('hexagons'), false, 'hexagons（多一个 s）必须判非法');
  const err = nodeShapeError('hexagons');
  assert.ok(typeof err === 'string' && err.length > 0, '非法值必须产出报文');
  for (const s of NODE_SHAPES) assert.ok(err.includes(s), `报文里缺合法值 ${s}：${err}`);
  assert.ok(err.includes('hexagons'), '报文必须点名收到的非法值（否则读端不知道改哪个键）');
});

test('B3 · 值域只有一处：两个副本文件零形状字面量，描述从权威渲染', () => {
  const shapeLiteral = new RegExp(`'(${NODE_SHAPES.join('|')})'`);
  for (const rel of ['src/application/design/dsl_ops/node_ops.ts', 'src/application/design/dsl_ops/op_data_spec.ts']) {
    const src = read(rel);
    const hit = shapeLiteral.exec(src);
    assert.equal(hit, null, `${rel} 里又手抄了形状字面量 ${hit?.[0]}（值域唯一住处 = geometry.ts#NODE_SHAPES）`);
  }
  // 描述侧必须是**派生**（渲染 NODE_SHAPES），不是另一份清单
  assert.match(read('src/application/design/dsl_ops/op_data_spec.ts'), /NODE_SHAPES\.join\('\|'\)/, 'op_data_spec 的 note 必须从 NODE_SHAPES 渲染');
  // 全仓守卫：parallelogram / hexagon / triangle 三个同时出现在某个非权威文件 ⇒ 那又是一份全值域副本
  const trio = ['parallelogram', 'hexagon', 'triangle'];
  const copies = srcFiles()
    .map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
    .filter((rel) => rel !== 'src/domain/geometry.ts')
    .filter((rel) => {
      const src = read(rel);
      return trio.every((t) => src.includes(`'${t}'`));
    });
  assert.deepEqual(copies, [], `这些文件里有完整的 shape 值域副本：${copies.join(', ')}`);
});
