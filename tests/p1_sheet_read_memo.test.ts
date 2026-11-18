/**
 * P1 · **设计册读取链记忆化**（性能病灶 Top 1 / #2 / #3 / #7 的判据）
 *
 * ## 它挡的是什么（实测读数，不是设想）
 * 一次 `edit_code` 落盘，光"读设计册"就烧 **295.84 ms**，其中 **220.52 ms 是纯重复**：
 * 同一批未变册被写闸 / 快照 / 契约反馈各解析一遍；一次 `readDesignSheetsForGate` 自己还要把
 * **全部 7 册**再解析一遍（9 次读盘 / 8.23 MB parse，只用到 2 册）。
 * 另有一条语义错：`root → feature` 拿"解析全部设计册再线性 `.find()`"回答，而**注册表直接答得出来**
 * （65.60 ms × 每次写 2 次）。
 *
 * ## 判据（每条都写清"什么情形下会红"）
 * | # | 判据 | 它红在哪 |
 * |---|---|---|
 * | ① | 5 次 `readDesignSheetsForGate` 只读**一遍**册（= 册数，不是 5 倍） | 缓存没了 / 每次调用都重解析 |
 * | ② | **册一变就失效**（等长改写 + mtime 前移 ⇒ 必须重读并拿到新内容） | 缓存键掉了 mtime/size 成分 ⇒ 旧缓存命中 = 假绿 |
 * | ③ | **写端写过的册**下一次读拿到新内容（tmp+rename 形态，= `saveDSL` 的写法） | 写端没失效 / 只认 inode 不认内容 |
 * | ④ | `root → feature` **一个册字节都不读**（走注册表），且答案与"未登记 ⇒ 空串"的旧语义一致 | 又退回"解析全部册再 `.find()`" |
 * | ⑤ | `design_line` 一次调用只读**一遍**册（改前读两遍） | `silentGapsOf` 又自己读一遍 |
 * | ⑥ | `design-db` 读 `_index.json` 时**一份 `.calls.json` 都不解析**；汇总缺失 ⇒ 返回**全扫等值读数**且**响亮**标注 | 汇总当摆设（读数还能对）/ 读不到静默当 0 |
 * | ⑦ | `gen-design-db` **同一趟**落 `_index.json`，读数与逐份全扫**逐项相等**，重跑**逐字节不变** | 汇总与副本人为漂移 / 每次生成都改字节 |
 *
 * ## 隔离
 * 临时 `AGENT_IO_HOME` + 临时夹具项目（本文件**不写仓内任何文件**）。
 * 读盘计数方式：**hook `fs.readFileSync`**（唯一读原语；本仓所有读册 / 读副本的代码都经它）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 临时数据家（★ 必须在**任何** storage 调用之前设：`getDataHome()` 每次现读 env） */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-sheet-memo-'));
const HOME = path.join(TMP, 'home');
process.env.AGENT_IO_HOME = HOME;
// ★ 夹具项目里没有画布（`tasks.db#plans`）—— 本文件验的是读册成本，不是画布闸
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(HOME, { recursive: true });

const { readDesignSheetsForGate, saveDSL } = await import('../src/infrastructure/storage.js');
const { closeAllProjectCacheDbs } = await import('../src/infrastructure/index/db.js');
const { registerFeature } = await import('../src/infrastructure/project_registry.js');
const { getFeatureBySourceRoot } = await import('../src/application/refactor/edit/edit_code.js');
const { lineReport } = await import('../src/application/design/line/design_line.js');
const { genDesignDb, designDbDir, readDesignDbIndex, DESIGN_DB_INDEX_NAME } = await import(
  '../src/application/design/db/gen_design_db.js'
);
const { importProject } = await import('../src/infrastructure/graph/import_project.js');

after(() => {
  closeAllProjectCacheDbs();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// 读盘计数器（hook 唯一读原语）
// ═══════════════════════════════════════════════════════════════════════════
const realReadFileSync = fs.readFileSync;
let reads: string[] = [];
/** ★ 只记"读的是册 / 读的是设计 DB 副本"这两类 —— 别的读盘与本文件判据无关 */
(fs as unknown as { readFileSync: typeof fs.readFileSync }).readFileSync = function hookedReadFileSync(
  file: Parameters<typeof fs.readFileSync>[0],
  ...rest: unknown[]
): unknown {
  try {
    reads.push(String(file).replace(/\\/g, '/'));
  } catch {
    /* 计数失败不许影响被 hook 的调用 */
  }
  return (realReadFileSync as (...a: unknown[]) => unknown).call(fs, file, ...rest);
} as typeof fs.readFileSync;
const resetReads = (): void => {
  reads = [];
};
const countReads = (suffix: string): number => reads.filter((r) => r.endsWith(suffix)).length;

// ═══════════════════════════════════════════════════════════════════════════
// 夹具
// ═══════════════════════════════════════════════════════════════════════════
let seq = 0;
/** 造一本最小的合法册（能被 `readDesignSheetsForGate` / `genDesignDb` 同时吃） */
function bookOf(feature: string, root: string, opts: { nodes: number; tag: string }): string {
  const nodes = Array.from({ length: opts.nodes }, (_, i) => ({
    id: `${opts.tag}-${i + 1}`,
    type: 'file',
    path: `src/f${i + 1}.ts`,
    description: `夹具节点 ${i + 1}`,
  }));
  return JSON.stringify({ feature, source_root: root, geometry: { nodes, edges: [] } }, null, 2) + '\n';
}

/** 造一个夹具项目：`<root>/.agent-io/design/` 下放 N 本册 */
function mkProject(bookCount: number, tag: string): { root: string; books: string[]; features: string[] } {
  const root = path.join(TMP, `proj-${tag}-${++seq}`);
  const designDir = path.join(root, '.agent-io', 'design');
  fs.mkdirSync(designDir, { recursive: true });
  const features: string[] = [];
  for (let i = 0; i < bookCount; i++) {
    const feature = `${tag}-${i + 1}`;
    features.push(feature);
    fs.writeFileSync(path.join(designDir, `${feature}.dsl.json`), bookOf(feature, root, { nodes: 3, tag: `${tag}${i + 1}` }), 'utf8');
  }
  return { root, books: features.map((f) => path.join(designDir, `${f}.dsl.json`)), features };
}

// ═══════════════════════════════════════════════════════════════════════════
// ① 一次解析、五次复用
// ═══════════════════════════════════════════════════════════════════════════
test('① 5 次 readDesignSheetsForGate 只读**一遍**册（= 册数；改前是 5 倍）', () => {
  const { root, features } = mkProject(2, 'memo1');
  resetReads();
  const first = readDesignSheetsForGate(root);
  assert.deepEqual(first.features, features, '读端必须如实列出本项目的册');
  assert.equal(countReads('.dsl.json'), 2, `第一次必须读满 2 册（实测 ${countReads('.dsl.json')}）`);
  for (let i = 0; i < 4; i++) {
    const again = readDesignSheetsForGate(root);
    // ★ 逐次必须与第一次**读数相同**（缓存不许改变答案：册名、节点、missingDir 都要一致）
    assert.deepEqual(again.features, first.features, `第 ${i + 2} 次的特征集必须一致`);
    assert.deepEqual(
      again.sheets.map((s) => (s.geometry?.nodes ?? []).length),
      first.sheets.map((s) => (s.geometry?.nodes ?? []).length),
      `第 ${i + 2} 次的节点读数必须一致`,
    );
    assert.equal(again.missingDir, first.missingDir, 'missingDir 不许被缓存改写');
  }
  assert.equal(
    countReads('.dsl.json'),
    2,
    `★ 5 次调用只许读一遍册（应 2 次，实测 ${countReads('.dsl.json')}）—— 多了就是"同一批未变册被重复解析"`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ② 失效机制有牙：册一变，缓存立刻不作数
// ═══════════════════════════════════════════════════════════════════════════
test('② 册**等长改写**后必须重读（键里的 mtime/size 成分就是"牙"）', () => {
  const { root, books, features } = mkProject(1, 'memo2');
  const file = books[0]!;
  const before = readDesignSheetsForGate(root);
  assert.deepEqual(before.features, features);
  const firstId = (before.sheets[0]?.geometry?.nodes?.[0] as { id?: string } | undefined)?.id;
  assert.ok(firstId, '夹具册必须有节点（否则本用例的空转就判不出来）');

  // ★ 关键：**等长**改写（size 不变）+ 明确前移 mtime —— 只靠"文件大小"或"目录 mtime"都不够
  //   （就地改写不改目录 mtime；等长改写不改 size）⇒ 键里必须有**文件 mtime**。
  const text = fs.readFileSync(file, 'utf8');
  const firstIdStr = String(firstId);
  const nextId = `${firstIdStr.slice(0, -1)}9`; // ★ 只改末位 ⇒ 长度与字节数都不变（本用例专考"size 不变"）
  assert.notEqual(nextId, firstIdStr, '构造要求：改写必须真的改了内容');
  assert.equal(nextId.length, firstIdStr.length, '构造要求：新旧 id 等长（本用例专门考"size 不变"）');
  const mutated = text.replace(firstIdStr, nextId);
  assert.notEqual(mutated, text, '夹具必须真的被改写');
  assert.equal(Buffer.byteLength(mutated), Buffer.byteLength(text), '构造要求：改写前后**字节数相等**');
  fs.writeFileSync(file, mutated, 'utf8');
  const bumped = new Date(Date.now() + 5000);
  fs.utimesSync(file, bumped, bumped); // 同毫秒内两次等长改写只靠 mtime 会撞 ⇒ 测试显式前移（不改代码的判据）

  resetReads();
  const after1 = readDesignSheetsForGate(root);
  const gotId = (after1.sheets[0]?.geometry?.nodes?.[0] as { id?: string } | undefined)?.id;
  assert.equal(
    gotId,
    nextId,
    `★ 册变了就必须重读：仍拿到旧 id ${JSON.stringify(gotId)} ⇒ 缓存键里没有"册变"的成分（消融：摘掉 mtime 即红）`,
  );
  assert.equal(countReads('.dsl.json'), 1, `必须真的重读那一册（实测 ${countReads('.dsl.json')} 次）`);
});

// ═══════════════════════════════════════════════════════════════════════════
// ③ 写端写过的册：下一次读必须是新的（tmp + rename = `saveDSL` 的落盘形态）
// ═══════════════════════════════════════════════════════════════════════════
test('③ 经 **tmp+rename** 落盘（= saveDSL 的写法）后，读端拿到新内容', () => {
  const { root, books, features } = mkProject(1, 'memo3');
  readDesignSheetsForGate(root); // 先把缓存热起来
  const file = books[0]!;
  const next = bookOf(features[0]!, root, { nodes: 2, tag: 'memo3b' });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, next, 'utf8');
  fs.renameSync(tmp, file);
  resetReads();
  const r = readDesignSheetsForGate(root);
  assert.equal(
    (r.sheets[0]?.geometry?.nodes ?? []).length,
    2,
    '★ 换名落盘（改前 saveDSL 的写法）之后仍读到 3 个节点 ⇒ 缓存没跟上写端',
  );
  assert.equal(countReads('.dsl.json'), 1, '换名后必须重读一次');
});

// ═══════════════════════════════════════════════════════════════════════════
// ④ root → feature：注册表答得出来，就不许解析册（病灶 #7）
// ═══════════════════════════════════════════════════════════════════════════
test('④ root → feature **零册解析**（注册表），未登记 ⇒ 空串（旧语义不变）', () => {
  const { root, features } = mkProject(1, 'memo4');
  const feature = features[0]!;
  const reg = registerFeature(feature, root, 'test:p1-sheet-memo');
  assert.equal(reg.changed, true, '夹具必须真的登记上（否则本用例退回"册自己声明 source_root"那一支，判不出本事）');

  resetReads();
  assert.equal(getFeatureBySourceRoot(root), feature, 'root → feature 必须答得出');
  assert.equal(
    countReads('.dsl.json'),
    0,
    `★ 注册表答得出来的问题不许解析册（实测读了 ${countReads('.dsl.json')} 次）—— 改前是"解析全部册再线性 .find()"`,
  );

  // 反方向：**未登记**的根 ⇒ 空串（不崩、不猜），且同样零册解析
  const stranger = path.join(TMP, 'not-a-project');
  fs.mkdirSync(stranger, { recursive: true });
  resetReads();
  assert.equal(getFeatureBySourceRoot(stranger), '', '未登记 ⇒ 空串（与改前同一句语义）');
  assert.equal(countReads('.dsl.json'), 0, '不存在的项目不许为了"查 feature"去读别处的册');
});

// ═══════════════════════════════════════════════════════════════════════════
// ⑤ design_line：一次调用只读一遍册（病灶 #3：改前 ×2）
// ═══════════════════════════════════════════════════════════════════════════
test('⑤ design_line 一次调用只读**一遍**册（改前 loadDesignSheetsForGate ×2）', () => {
  const { root, features } = mkProject(2, 'memo5');
  // ③/④ 那一步是**本册**的一次直读（`design/<feature>.dsl.json`）—— 与"读一遍册"是两件事，计入基线
  const directReads = 1;
  fs.writeFileSync(
    path.join(root, '.agent-io', 'design', `${features[0]!}.dsl.json`),
    bookOf(features[0]!, root, { nodes: 3, tag: 'memo5' }),
    'utf8',
  );
  resetReads();
  const rep = lineReport(root, features[0]!);
  const n = countReads('.dsl.json');
  assert.equal(
    reads.filter((r) => r.includes('/design-db/')).length,
    0,
    '本夹具没有 design-db ⇒ 不许去读它',
  );
  assert.ok(
    n <= 2 + directReads,
    `★ 一次 design_line 只许读一遍册（册 2 + 本册直读 ${directReads} = ${2 + directReads}，实测 ${n}）—— 多了就是"同一次调用把同一批册读两遍"`,
  );
  assert.ok(rep.steps.length >= 6, '六步读数必须都在（本用例不改读数形状）');
});

// ═══════════════════════════════════════════════════════════════════════════
// ⑥ design-db：读汇总（1 份）而不是逐份 parse；缺失 ⇒ 全扫等值 + 响亮
// ═══════════════════════════════════════════════════════════════════════════
test('⑥ design_line ⑤ 读 `_index.json`：**零份** `.calls.json` 解析；汇总缺失 ⇒ 全扫等值且响亮', () => {
  const { root, features } = mkProject(1, 'memo6');
  const dbDir = designDbDir(root);
  fs.mkdirSync(dbDir, { recursive: true });
  const copies = [
    { path: 'src/a.ts', symbols: 3, calls: 5, requirements_calls: 1 },
    { path: 'src/b.ts', symbols: 2, calls: 4, requirements_calls: 0 },
  ];
  for (const c of copies) {
    fs.writeFileSync(
      path.join(dbDir, `${c.path.replace(/^src\//, '').replace(/\.ts$/, '')}.calls.json`),
      JSON.stringify(
        {
          path: c.path,
          symbols: new Array(c.symbols).fill({}),
          calls: new Array(c.calls).fill({}),
          requirements_calls: new Array(c.requirements_calls).fill({}),
        },
        null,
        2,
      ),
      'utf8',
    );
  }
  const totals = {
    count: copies.length,
    symbols: copies.reduce((s, c) => s + c.symbols, 0),
    calls: copies.reduce((s, c) => s + c.calls, 0),
    requirements_calls: copies.reduce((s, c) => s + c.requirements_calls, 0),
  };
  const indexFile = path.join(dbDir, DESIGN_DB_INDEX_NAME);
  fs.writeFileSync(
    indexFile,
    JSON.stringify({ '//': '测试夹具', totals, files: copies }, null, 2) + '\n',
    'utf8',
  );

  resetReads();
  const withIndex = lineReport(root, features[0]!);
  assert.equal(
    countReads('.calls.json'),
    0,
    `★ 有汇总时一份 \`.calls.json\` 都不许解析（实测 ${countReads('.calls.json')}）—— 改前是 583 份逐份解析`,
  );
  assert.equal(withIndex.design_db_index.source, 'index', '读法必须如实报 index');
  const step5 = withIndex.steps.find((s) => s.id === '⑤')!;
  assert.match(step5.reading, new RegExp(`${totals.count} 份`), `⑤ 的份数必须来自汇总：${step5.reading}`);

  // ── 消融方向：**删掉汇总** ⇒ 退回逐份全扫（读数**等值**），且必须**响亮** ──
  fs.unlinkSync(indexFile);
  resetReads();
  const legacy = lineReport(root, features[0]!);
  assert.equal(
    countReads('.calls.json'),
    copies.length,
    `汇总缺失 ⇒ 必须真的走全扫（实测 ${countReads('.calls.json')} 份，应 ${copies.length}）`,
  );
  assert.equal(legacy.design_db_index.source, 'legacy_scan', '★ 读不到汇总不许静默当"没有"');
  assert.match(String(legacy.design_db_index.why), /汇总/, '回落必须点名原因（"读不到 ≠ 没有"）');
  assert.equal(
    (legacy.steps.find((s) => s.id === '⑤')!.reading.match(/(\d+) 份/) ?? [])[1],
    String(totals.count),
    '全扫读数必须与汇总**等值**（否则回落就是第二个口径）',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ⑦ gen-design-db：同一趟落汇总，读数与全扫逐项相等，重跑逐字节不变
// ═══════════════════════════════════════════════════════════════════════════
test('⑦ gen-design-db **同一趟**落 `_index.json`；与逐份全扫读数逐项相等；重跑不变', async () => {
  const feature = `memo7-${++seq}`;
  const proj = path.join(TMP, 'proj-gen-db');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export function fa(): number {\n  return 1;\n}\n', 'utf8');
  fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export function fb(): number {\n  return 2;\n}\n', 'utf8');
  await importProject({ project_dir: proj, feature });

  const r1 = genDesignDb(proj);
  assert.deepEqual(r1.problems, [], `第一次生成不许有问题：${r1.problems.join(' / ')}`);
  const dbDir = designDbDir(proj);
  const indexFile = path.join(dbDir, DESIGN_DB_INDEX_NAME);
  assert.ok(fs.existsSync(indexFile), `★ 生成器必须落汇总：${indexFile}（否则 ⑤ 永远退回全扫）`);

  const idx = readDesignDbIndex(dbDir);
  assert.equal(idx.ok, true, `汇总必须读得出来：${idx.why ?? ''}`);
  // 全扫对照（判据不许"用同一份汇总验自己"）
  let count = 0;
  let symbols = 0;
  let calls = 0;
  let reqs = 0;
  for (const f of fs.readdirSync(dbDir).filter((x) => x.endsWith('.calls.json'))) {
    count += 1;
    const j = JSON.parse(fs.readFileSync(path.join(dbDir, f), 'utf8')) as {
      symbols?: unknown[];
      calls?: unknown[];
      requirements_calls?: unknown[];
    };
    symbols += j.symbols?.length ?? 0;
    calls += j.calls?.length ?? 0;
    reqs += j.requirements_calls?.length ?? 0;
  }
  assert.deepEqual(
    idx.totals,
    { count, symbols, calls, requirements_calls: reqs },
    '汇总的总计必须与逐份全扫**逐项相等**（不等 = 两份事实）',
  );
  assert.deepEqual(
    [...idx.files.map((f) => f.path)].sort(),
    [...new Set(idx.files.map((f) => f.path))].sort(),
    '`files[]` 的 path 不许自相重复（重复 = 汇总把同一份副本记了两行）',
  );

  const bytes = fs.readFileSync(indexFile, 'utf8');
  const r2 = genDesignDb(proj);
  assert.equal(r2.written, 0, '输入没变 ⇒ 副本一个都不重写（既有幂等语义不许破）');
  assert.equal(
    fs.readFileSync(indexFile, 'utf8'),
    bytes,
    '★ 同一批输入重跑 ⇒ 汇总**逐字节不变**（否则每次生成都在 churn）',
  );

  // ★ 汇总不是副本：它不许被"陈旧副本清理"顺手删掉
  assert.ok(fs.existsSync(indexFile), '生成器不许把 `_index.json` 当陈旧副本删掉');
});
