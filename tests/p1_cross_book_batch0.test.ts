/**
 * P1 · T-#A8A9-CROSS-BOOK **批 0**（前置 6 项，0 数据搬迁）—— 红 → 绿。
 *
 * ## 这批要立的六条（每条都先造出"该红"的输入，再把病灶去掉看它转绿）
 *
 * | # | 判据 | 绿的真身 |
 * |---|---|---|
 * | 0.2 | 仓根 `design-books.json` 是**归属的唯一意图表**（3 册 `owns` + `unowned`） | `ownerOf` 最长/最具体命中；**未命中 ⇒ 判不了**（不兜底） |
 * | 0.3 | `nodeIdOf` 是**派生单点**（4 种派生式收敛到 1） | 源码里 `` `file_${…}` `` 只剩一处；旧 3 式**都不等于**它 |
 * | 0.4 | `saveDSL` 写端**只许属主册写** | 在别册给已有属主的 path 加节点 ⇒ **拒**（前置，不是事后门红） |
 * | 0.4b | 换手要显式 + **claimed 卡先 release** | 带 `ownership{from,why}` 才放行，且代败方册 drop；claimed 且未授权 ⇒ 拒 |
 * | 0.5 | `newFileLedgerWarning` **三态** | 0 册 ⇒ 警告（附应登记册）· 1 册 ⇒ 静默 · ≥2 册 ⇒ 红 |
 * | 0.6 | `structure-gate` ② 跨册归属档 | 存量**指纹挂账**（sha）· 集合一变就红 · 域表不在且有两册 ⇒ **退出码 2** |
 *
 * ## 纪律（本仓 0.14 / R47）
 * · **鉴别力**：每条判据都造两个世界（一册持有 / 两册持有、属主 / 非属主），结论必须**不同**；
 * · **不许只造一个夹具** —— 只造一个，那条判据证明不了任何事；
 * · 全部用临时目录夹具（`%TEMP%`），**绝不动仓里的 `src/` `dist/` `tests/`**；
 *   `AGENT_IO_HOME` 指到临时目录 ⇒ 夹具不会读到本仓那几册（也不会把卡写进真库）。
 * · 真仓读数（`process.cwd()`）只断**不变量**（分区闭合、指纹一致），不断"414"这种会随批下降的数。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import {
  assessWriteEnd,
  crossBookOwnership,
  nodeIdDriftOf,
  ownerOf,
  ownsOf,
  readDesignBooks,
  type BookSheetLike,
  type DesignBooksRead,
  type DesignBooksTable,
} from '../src/infrastructure/design_books.js';
import { fileNodeId, nodeIdOf } from '../src/infrastructure/graph/node_id.js';
import { saveDSL } from '../src/infrastructure/storage.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';
import { crossBookReadingOf } from '../src/application/design/db/gen_design_db.js';
import { newFileLedgerVerdict } from '../src/application/design/ledger_membership.js';

const REPO = process.cwd();
const GATE = path.resolve('scripts', 'structure-gate.mjs');

// ───────────────────────────────────────────────────────────────────────────
// 夹具
// ───────────────────────────────────────────────────────────────────────────

/** 一个"被检查的项目"：`src/a.ts` 在盘上 */
function makeProject(home: string, name = 'proj'): string {
  const proj = path.join(home, name);
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  return proj;
}

/** 落一份设计册（最小面：节点 + 语义文件 + 可选卡） */
function writeSheet(
  proj: string,
  feature: string,
  nodes: Array<{ id: string; path?: string; expectations?: number; card?: string }>,
  files: Array<{ id: string; path: string; responsibility?: string }> = [],
): void {
  const dir = path.join(proj, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  const dsl = {
    feature,
    title: feature,
    source_root: proj,
    geometry: {
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.path ?? n.id,
        type: 'file',
        x: 0,
        y: 0,
        ...(n.path ? { path: n.path } : {}),
        ...(n.expectations
          ? {
              decision: {
                summary: 's',
                expectations: Array.from({ length: n.expectations }, (_, i) => ({
                  kind: 'file-exists',
                  path: n.path,
                  why: `判据 ${i}`,
                })),
              },
            }
          : {}),
        ...(n.card ? { task: { state: n.card } } : {}),
      })),
      edges: [],
    },
    semantic: { files },
    todos: [],
  };
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf8');
}

function readSheet(proj: string, feature: string): { geometry: { nodes: Array<Record<string, unknown>> } } {
  return JSON.parse(fs.readFileSync(path.join(proj, '.agent-io', 'design', `${feature}.dsl.json`), 'utf8'));
}

/** 域表：`a` 持 `src/`，`b` 什么也不持（要它持就显式给 path） */
function writeBooks(proj: string, table: Partial<DesignBooksTable> & { books: DesignBooksTable['books']; unowned?: DesignBooksTable['unowned'] }): void {
  fs.writeFileSync(
    path.join(proj, 'design-books.json'),
    JSON.stringify({ note: 'fixture', unowned: [], ...table }, null, 2),
    'utf8',
  );
}

const READ = (table: DesignBooksTable): DesignBooksRead => ({ table, file: '<fixture>', error: '' });
const NO_TABLE: DesignBooksRead = { table: null, file: '<fixture>', error: '域表不在' };

// ════════════════════════════════════════════════════════════════════
// 0.2 仓根意图表：3 册 owns 覆盖窄域清单
// ════════════════════════════════════════════════════════════════════
test('0.2 design-books.json 在仓根，3 册 owns 覆盖 lead 签的窄域清单（toolface 6 条精确 · 本仓 src/ + scripts/ · 计划册逐批下降）', () => {
  const file = path.join(REPO, 'design-books.json');
  assert.ok(fs.existsSync(file), '仓根必须有 design-books.json（归属的唯一意图表）');
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须读得出来：${read.error}`);
  const table = read.table;
  assert.deepEqual(
    table.books.map((b) => b.feature).sort(),
    ['agent-io', 'agent-io-toolface', 'task-system-plan'],
    '三册都要在表里（memory / review-hub 等别的项目根的册不参与本仓读数）',
  );
  const ai = ownsOf(table, 'agent-io');
  assert.ok(ai.includes('src/') && ai.includes('scripts/'), `本体册的窄域必须含 src/ 与 scripts/：${ai.join(',')}`);
  const tf = ownsOf(table, 'agent-io-toolface');
  assert.equal(tf.length, 6, `工具面册必须**逐条精确路径** 6 个（写前缀会把 project_actual_fields.ts 也划过去）：${tf.join(',')}`);
  for (const p of tf) {
    assert.ok(!p.endsWith('/'), `工具面册的条目必须是精确路径（不是前缀）：${p}`);
  }
  const tsp = ownsOf(table, 'task-system-plan');
  // ★ 2026-11-18（批 8）：67 → **43** —— B 类 24 个 path 的职责文本搬进本体册，属主随之改判（表里摘掉精确条目）。
  // ★ 2026-11-18（批 9）：43 → **34** —— C 类 9 个 path 的判据搬进本体册，属主同样改判（再摘 9 条精确条目）。
  //   所以这里钉的是**棘轮 + 自洽**，不是"永远 67"：条数只许不增（批 10–13 还会继续降，批 17 计划册退役），
  //   而**每一条留下的条目必须真的由它持有**（这条不随批漂：谁要是把别册的 path 又抄回来，立刻红）。
  assert.ok(tsp.length <= 34, `计划册的窄域只许不增（批 9 收口 34；实测 ${tsp.length}）`);
  for (const p of tsp) assert.ok(!p.endsWith('/'), `计划册的条目必须是精确路径（不是前缀）：${p}`);
  for (const p of tsp) {
    assert.equal(ownerOf(table, p).owner, 'task-system-plan', `计划册 owns[] 里留下的每一条都必须**真的**由它持有：${p}`);
  }
  assert.ok(
    table.unowned.some((u) => String(typeof u === 'string' ? u : u.path).startsWith('tests/fixtures/')),
    'unowned 必须声明夹具目录（那一批不是本仓的设计对象）',
  );
  // 同一 path 打不打架：每条精确属主不得被另一册同时"更具体"地声明
  for (const p of [...tf, ...tsp]) {
    const hit = ownerOf(table, p);
    assert.ok(hit.matched, `精确条目必须命中：${p}`);
  }
});

test('0.2 ownerOf：最具体命中（精确 > 前缀）+ unowned 能剥掉更宽的 owns + 未命中=判不了 + 同具体度=域表打架', () => {
  const table: DesignBooksTable = {
    books: [
      { feature: 'body', owns: ['src/', 'scripts/'] },
      { feature: 'face', owns: ['src/application/meta/registry/tool_faces.ts'] },
      { feature: 'plan', owns: ['src/domain/'] },
      { feature: 'one', owns: ['docs/x.md'] },
      { feature: 'two', owns: ['docs/x.md'] },
    ],
    unowned: [{ path: 'tests/', why: '测试不是设计对象' }, { path: 'tests/fixtures/', why: '夹具' }],
  };
  assert.equal(ownerOf(table, 'src/infrastructure/storage.ts').owner, 'body');
  // 精确条目盖过更宽的 src/ 前缀（★ 这就是窄域方案能成立的原因）
  assert.equal(ownerOf(table, 'src/application/meta/registry/tool_faces.ts').owner, 'face');
  assert.equal(ownerOf(table, 'src/domain/validator.ts').owner, 'plan');
  // unowned 与 owns 同场竞技：更具体的 unowned 命中 ⇒ owner=∅（不是"没命中"）
  const fixtures = ownerOf(table, 'tests/fixtures/java-proj/A.java');
  assert.equal(fixtures.matched, true);
  assert.equal(fixtures.owner, null, 'unowned 条目 ⇒ owner=∅（matched 仍为 true）');
  const tests = ownerOf(table, 'tests/p0_x.test.ts');
  assert.equal(tests.owner, null);
  assert.equal(tests.entry, 'tests/', '更宽的 unowned 前缀也要能命中');
  // 未命中 ⇒ **判不了**（不许兜底成任何一册）
  const miss = ownerOf(table, 'observability/none.ts');
  assert.equal(miss.matched, false, '域表没覆盖 ⇒ matched:false（不兜底）');
  assert.equal(miss.owner, null);
  // 同具体度打到两册 ⇒ 域表自己打架 ⇒ 判不了（报文点名两边）
  const clash = ownerOf(table, 'docs/x.md');
  assert.equal(clash.matched, false);
  assert.deepEqual(clash.ambiguous, ['one', 'two']);
});

// ════════════════════════════════════════════════════════════════════
// 0.3 nodeIdOf 单点
// ════════════════════════════════════════════════════════════════════
test('0.3 nodeIdOf：派生式逐字沿用（`-` 保留），且**旧 3 式都不等于它**（4 种派生式收敛成 1 的判据）', () => {
  assert.equal(nodeIdOf('src/a.ts'), 'file_src_a_ts');
  assert.equal(fileNodeId('observe-lang-go/cmd/instrument/main.go'), 'file_observe-lang-go_cmd_instrument_main_go');
  assert.equal(nodeIdOf('src/domain', 'dir'), 'dir_src_domain');
  assert.equal(nodeIdOf('docs/todo.md', 'doc'), 'doc_docs_todo_md');
  const p = 'src/application/meta/registry/tool_faces.ts';
  const want = nodeIdOf(p);
  assert.equal(want, 'file_src_application_meta_registry_tool_faces_ts');
  // ① 只取 basename（toolface 的手写式）
  assert.notEqual('file_tool_faces_ts', want);
  // ② 旧 sanitize（`-` → `_`）
  assert.notEqual('file_observe_lang_go_cmd_instrument_main_go', nodeIdOf('observe-lang-go/cmd/instrument/main.go'));
  // ③ 去 `src/` 前缀（计划册老扫描根）
  assert.notEqual('file_application_meta_archive_archive_node_ts', nodeIdOf('src/application/meta/archive/archive_node.ts'));
});

test('0.3 单点断言（源码级）：`file_${` / `dir_${` / `doc_${` 只许出现在 graph/node_id.ts', () => {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.endsWith('.ts')) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.trim();
        // 注释里的"引用写法"不算实现（本仓的文档大量引用派生式，那是散文不是代码）
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        if (/`(file|dir|doc)_\$\{/.test(line)) {
          hits.push(`${path.relative(REPO, full).split(path.sep).join('/')}:${i + 1}`);
        }
      });
    }
  };
  walk(path.join(REPO, 'src'));
  const offenders = hits.filter((h) => !h.startsWith('src/infrastructure/graph/node_id.ts:'));
  assert.deepEqual(offenders, [], `节点 id 派生只许住 graph/node_id.ts，实测还有：${offenders.join(' · ')}`);
});

test('0.3 存量 id 漂移：真仓读数自洽（每行 id ≠ nodeIdOf(path)），且**不重命名**（只报不改）', () => {
  const read = crossBookReadingOf(REPO);
  const drift = read.id_drift;
  assert.equal(drift.rows.length, drift.nodes);
  // ★ 2026-11-18（批 8）：31 → 24 —— 删掉的 25 个计划册节点里有 7 个是"老一代 sanitize 的存量异 id"，
  //   随节点一并消失（**不是改名**；旧 id 上 judgement_ref 命中 0 条）。所以下界从 27 放到 24，
  //   仍然守住"本卡只报不改"这件事：剩下的 24 个（含 toolface 6 个手写式）一个都没被重命名。
  // ★ 2026-11-18（批 9）：24 → **10** —— 批 9 删掉的 51 个计划册节点里有 14 个是 `observe-lang-{go,java,py}`
  //   上"老一代 sanitize"的存量异 id（`file_observe_lang_go_…` 那一代），随节点一并消失（同样**不是改名**）。
  //   下界跟着降到 10：剩下的 10 个（含 toolface 6 个手写式）仍归批 15 / T-#NODE-ID-DRIFT。
  assert.ok(drift.nodes >= 10, `存量异 id 至少还有 10 个（实测 ${drift.nodes}）—— 本卡只报不改；批 9 删掉了 14 个（不是改名）`);
  for (const r of drift.rows) {
    assert.notEqual(r.id, r.want, `漂移行的 id 必须真的不等于派生：${r.feature}:${r.id}`);
    assert.ok(r.id.startsWith('file_') || r.id.startsWith('dir_') || r.id.startsWith('doc_'), `只判"声称自己是扫描 id"的节点：${r.id}`);
  }
});

// ════════════════════════════════════════════════════════════════════
// 0.4 写端判据（纯核 assessWriteEnd）
// ════════════════════════════════════════════════════════════════════
const TABLE_AB: DesignBooksTable = {
  books: [
    { feature: 'a', owns: ['src/'] },
    { feature: 'b', owns: ['scripts/'] },
  ],
  unowned: [{ path: 'tests/fixtures/', why: '夹具' }],
};

const sheetOf = (
  feature: string,
  nodes: Array<{ id: string; path?: string; expectations?: number; card?: string }>,
): BookSheetLike => ({
  feature,
  geometry: {
    nodes: nodes.map((n) => ({
      id: n.id,
      ...(n.path ? { path: n.path } : {}),
      ...(n.expectations ? { decision: { expectations: Array.from({ length: n.expectations }, () => ({})) } } : {}),
      ...(n.card ? { task: { state: n.card } } : {}),
    })),
  },
});

test('0.4 assessWriteEnd：新增重复 ⇒ 拒（报文点名另一册 + 判据数）；**存量重复 ⇒ 放行**（否则写端第一天就把全仓打死）', () => {
  const rival = sheetOf('a', [{ id: 'file_src_x_ts', path: 'src/x.ts', expectations: 3 }]);
  // 世界一：B 第一次给 src/x.ts 建节点 ⇒ 新增重复 ⇒ 拒
  const fresh = assessWriteEnd({
    feature: 'b',
    before: sheetOf('b', [{ id: 'file_scripts_k_mjs', path: 'scripts/k.mjs' }]),
    after: sheetOf('b', [
      { id: 'file_scripts_k_mjs', path: 'scripts/k.mjs' },
      { id: 'file_src_x_ts', path: 'src/x.ts' },
    ]),
    others: [rival],
    books: READ(TABLE_AB),
  });
  const dup = fresh.issues.find((i) => i.code === 'new_duplicate');
  assert.ok(dup, `必须报 new_duplicate：${JSON.stringify(fresh.issues)}`);
  assert.equal(dup.rival, 'a');
  assert.ok(dup.message.includes('src/x.ts') && dup.message.includes('a(3 条判据)'), `报文必须带另一册与它的判据数：${dup.message}`);
  assert.deepEqual(fresh.transfers, ['src/x.ts']);
  // 世界二：同一重复**写前就有** ⇒ 不是本次新增 ⇒ 放行（存量挂账在门上，不在写端）
  const legacy = assessWriteEnd({
    feature: 'b',
    before: sheetOf('b', [{ id: 'file_src_x_ts', path: 'src/x.ts' }]),
    after: sheetOf('b', [
      { id: 'file_src_x_ts', path: 'src/x.ts', expectations: 1 },
      { id: 'file_scripts_k_mjs', path: 'scripts/k.mjs' },
    ]),
    others: [rival],
    books: READ(TABLE_AB),
  });
  assert.deepEqual(legacy.issues, [], `存量重复放行：${JSON.stringify(legacy.issues)}`);
});

test('0.4 assessWriteEnd：新增节点的 path 必须落在本册 owns（非属主 ⇒ not_owner · 未声明 ⇒ undeclared · unowned ⇒ unowned_declared）', () => {
  const cases: Array<[string, string, string]> = [
    ['src/x.ts', 'not_owner', '的属主是 **a**'],
    ['observability/y.ts', 'undeclared', '没有一条'],
    ['tests/fixtures/proj/z.ts', 'unowned_declared', 'unowned'],
  ];
  for (const [p, code, hint] of cases) {
    const v = assessWriteEnd({
      feature: 'b',
      before: null,
      after: sheetOf('b', [{ id: nodeIdOf(p), path: p }]),
      others: [sheetOf('a', [])],
      books: READ(TABLE_AB),
    });
    const issue = v.issues.find((i) => i.code === code);
    assert.ok(issue, `\`${p}\` 必须报 ${code}：${JSON.stringify(v.issues.map((i) => i.code))}`);
    assert.ok(issue.message.includes(hint), `${code} 的报文必须说清为什么（期望含"${hint}"）：${issue.message}`);
  }
  // 属主册写同一 path ⇒ 没有任何 issue（这是绿的那一侧）
  const ok = assessWriteEnd({
    feature: 'a',
    before: null,
    after: sheetOf('a', [{ id: nodeIdOf('src/x.ts'), path: 'src/x.ts' }]),
    others: [sheetOf('b', [])],
    books: READ(TABLE_AB),
  });
  assert.deepEqual(ok.issues, [], `属主册写自己的域必须放行：${JSON.stringify(ok.issues)}`);
});

test('0.4 assessWriteEnd：新增节点的 id 必须来自单点（手写 `file_<basename>_ts` 当场点名）；**存量异 id 不重判**', () => {
  const bad = assessWriteEnd({
    feature: 'a',
    before: null,
    after: sheetOf('a', [{ id: 'file_x_ts', path: 'src/x.ts' }]),
    others: [],
    books: READ(TABLE_AB),
  });
  const issue = bad.issues.find((i) => i.code === 'bad_id');
  assert.ok(issue, `必须报 bad_id：${JSON.stringify(bad.issues.map((i) => i.code))}`);
  assert.ok(issue.message.includes('file_src_x_ts'), `必须点名单点派生的期望值：${issue.message}`);
  // 存量：节点写前就在 ⇒ 不重判（本卡不重命名那 31 个）
  const legacy = assessWriteEnd({
    feature: 'a',
    before: sheetOf('a', [{ id: 'file_x_ts', path: 'src/x.ts' }]),
    after: sheetOf('a', [{ id: 'file_x_ts', path: 'src/x.ts', expectations: 2 }]),
    others: [],
    books: READ(TABLE_AB),
  });
  assert.deepEqual(legacy.issues, [], `存量异 id 不许在这里红（改名会断既有引用）：${JSON.stringify(legacy.issues)}`);
});

test('0.4b assessWriteEnd：换手时败方挂着 claimed 卡 ⇒ claimed_on_transfer（报文点名要 release 的卡）', () => {
  const v = assessWriteEnd({
    feature: 'b',
    before: null,
    after: sheetOf('b', [{ id: nodeIdOf('src/x.ts'), path: 'src/x.ts' }]),
    others: [sheetOf('a', [{ id: 'file_src_x_ts', path: 'src/x.ts', card: 'claimed', expectations: 14 }])],
    books: READ(TABLE_AB),
  });
  const issue = v.issues.find((i) => i.code === 'claimed_on_transfer');
  assert.ok(issue, `必须报 claimed_on_transfer：${JSON.stringify(v.issues.map((i) => i.code))}`);
  assert.equal(issue.card, 'a/file_src_x_ts');
  assert.ok(issue.message.includes('release'), `报文必须点出 release：${issue.message}`);
  // 世界二：败方是候选卡 ⇒ 不报这一条（判据有鉴别力）
  const cand = assessWriteEnd({
    feature: 'b',
    before: null,
    after: sheetOf('b', [{ id: nodeIdOf('src/x.ts'), path: 'src/x.ts' }]),
    others: [sheetOf('a', [{ id: 'file_src_x_ts', path: 'src/x.ts', card: 'candidate' }])],
    books: READ(TABLE_AB),
  });
  assert.equal(cand.issues.some((i) => i.code === 'claimed_on_transfer'), false);
});

// ════════════════════════════════════════════════════════════════════
// 0.4 写端（真 saveDSL）：前置拒 + 显式换手 + claimed 先 release
// ════════════════════════════════════════════════════════════════════
test('0.4 saveDSL：在别册给已有属主的 path 加节点 ⇒ **拒**（且盘上一个字节都没动）；显式换手 ⇒ 过，并代败方册 drop', () => {
  const home = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = makeProject(home);
    // ★ 换手的正确次序：**意图表先走**（`src/x.ts` 归 b），数据滞后（a 还持着那个节点）
    const TABLE_XFER: DesignBooksTable = {
      books: [
        { feature: 'a', owns: ['scripts/'] },
        { feature: 'b', owns: ['src/', 'scripts/'] },
      ],
      unowned: [],
    };
    writeBooks(proj, TABLE_XFER);
    writeSheet(proj, 'a', [{ id: 'file_src_x_ts', path: 'src/x.ts', expectations: 3 }]);
    writeSheet(proj, 'b', [{ id: 'file_scripts_k_mjs', path: 'scripts/k.mjs' }], [{ id: 'file_scripts_k_mjs', path: 'scripts/k.mjs' }]);

    // ── 世界一：偷偷在 b 里再造一个 src/x.ts 的节点 ──
    const dslB = JSON.parse(fs.readFileSync(path.join(proj, '.agent-io', 'design', 'b.dsl.json'), 'utf8'));
    dslB.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    const beforeBytes = fs.readFileSync(path.join(proj, '.agent-io', 'design', 'b.dsl.json'), 'utf8');
    assert.throws(
      () => saveDSL(dslB, 'mcp', undefined, { baseDir: proj }),
      /归属判据|new_duplicate|已由/,
      '写端必须**前置**拒（不是事后门红）',
    );
    assert.equal(
      fs.readFileSync(path.join(proj, '.agent-io', 'design', 'b.dsl.json'), 'utf8'),
      beforeBytes,
      '被拒的写不许留下任何痕迹（连 _dsl_rev 都不许动）',
    );
    // ── 世界二：显式换手（with why）⇒ 过，且 a 侧那个节点被 drop ──
    saveDSL(dslB, 'mcp', undefined, { baseDir: proj, ownership: { from: ['a'], why: '批 0 测试：换手' } });
    const aAfter = readSheet(proj, 'a');
    const bAfter = readSheet(proj, 'b');
    assert.equal(aAfter.geometry.nodes.filter((n) => n.path === 'src/x.ts').length, 0, '败方册的那个节点必须被 drop（不留 h=2 的中间态）');
    assert.equal(bAfter.geometry.nodes.filter((n) => n.path === 'src/x.ts').length, 1, '新属主册必须持有它');
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    rmRf(home);
  }
});

test('0.4b saveDSL：换手撞上败方的 claimed 卡 ⇒ 拒（点名卡与 release）；显式 releaseClaimed ⇒ 过（先放再摘）', () => {
  const home = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = makeProject(home);
    const TABLE_XFER: DesignBooksTable = {
      books: [
        { feature: 'a', owns: ['scripts/'] },
        { feature: 'b', owns: ['src/', 'scripts/'] },
      ],
      unowned: [],
    };
    writeBooks(proj, TABLE_XFER);
    writeSheet(proj, 'a', [{ id: 'file_src_x_ts', path: 'src/x.ts', expectations: 14, card: 'claimed' }]);
    writeSheet(proj, 'b', [{ id: 'file_scripts_k_mjs', path: 'scripts/k.mjs' }]);
    const dslB = JSON.parse(fs.readFileSync(path.join(proj, '.agent-io', 'design', 'b.dsl.json'), 'utf8'));
    dslB.geometry.nodes.push({ id: nodeIdOf('src/x.ts'), label: 'x.ts', type: 'file', x: 0, y: 0, path: 'src/x.ts' });
    assert.throws(
      () => saveDSL(dslB, 'mcp', undefined, { baseDir: proj, ownership: { from: ['a'], why: '换手但不放卡' } }),
      /claimed|release/,
      'claimed 卡必须先 release —— 否则换手会造孤儿卡',
    );
    saveDSL(dslB, 'mcp', undefined, { baseDir: proj, ownership: { from: ['a'], why: '换手并放卡', releaseClaimed: true } });
    assert.equal(readSheet(proj, 'a').geometry.nodes.filter((n) => n.path === 'src/x.ts').length, 0);
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 0.5 三态提示
// ════════════════════════════════════════════════════════════════════
test('0.5 newFileLedgerVerdict：0 册 ⇒ 警告（附域表推出的应登记册）· 1 册 ⇒ 静默 · ≥2 册 ⇒ 红 · 1 册但属主是别册 ⇒ 红', () => {
  const home = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = path.join(home, 'datahome');
  try {
    const proj = makeProject(home);
    writeBooks(proj, TABLE_AB);
    registerFeature('a', proj, 'test');
    registerFeature('b', proj, 'test');
    const target = 'src/x.ts';

    // 世界一：谁都没登记 ⇒ 警告 + 点名应登记册 a
    writeSheet(proj, 'a', []);
    writeSheet(proj, 'b', []);
    const none = newFileLedgerVerdict(proj, target);
    assert.equal(none.state, 'none', `0 册在册 ⇒ none：${none.state}`);
    assert.ok(none.message && none.message.includes('未入册'), '警告必须说"未入册"');
    assert.ok(none.message.includes('a'), `警告必须点名域表推出的应登记册（a）：${none.message}`);
    assert.ok(none.holders.length === 0 && none.covering === 2, `读数要带分母（本项目 2 册）：${JSON.stringify(none)}`);

    // 世界二：只在属主册 a 里 ⇒ 静默
    writeSheet(proj, 'a', [{ id: 'file_src_x_ts', path: target }], [{ id: 'file_src_x_ts', path: target }]);
    const owned = newFileLedgerVerdict(proj, target);
    assert.equal(owned.state, 'owned');
    assert.equal(owned.message, null, '恰一册且在属主册 ⇒ 静默（不许加噪声）');

    // 世界三：两册都在册 ⇒ **红**（这正是 414 的形态，不是"还差一个人登记"）
    writeSheet(proj, 'b', [{ id: 'file_src_x_ts', path: target }], [{ id: 'file_src_x_ts', path: target }]);
    const multi = newFileLedgerVerdict(proj, target);
    assert.equal(multi.state, 'multi', `≥2 册在册 ⇒ multi：${multi.state}`);
    assert.deepEqual(multi.holders, ['a', 'b']);
    assert.ok(multi.message && multi.message.includes('多册在册') && multi.message.includes('`a`') && multi.message.includes('`b`'), `红报文必须点名两册：${multi.message}`);

    // 世界四：只在**非属主**册 b 里 ⇒ 红（位置与意图表矛盾）
    writeSheet(proj, 'a', []);
    const mismatch = newFileLedgerVerdict(proj, target);
    assert.equal(mismatch.state, 'owner_mismatch', `1 册但属主是 a ⇒ owner_mismatch：${mismatch.state}`);
    assert.ok(mismatch.message && mismatch.message.includes('矛盾'), `报文必须说清矛盾：${mismatch.message}`);
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    rmRf(home);
  }
});

// ════════════════════════════════════════════════════════════════════
// 0.6 门：② 跨册归属档（三态 + 指纹棘轮）
// ════════════════════════════════════════════════════════════════════
function runGate(proj: string, home: string, extra: string[] = []): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, AGENT_IO_HOME: path.join(home, 'datahome') };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [GATE, '--project', proj, '--baseline', path.join(home, 'none.json'), ...extra], {
    cwd: proj,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    env,
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('0.6 gate ②：真仓读数 —— 分区闭合（六档相加 = path 总数），且存量指纹与基线**逐字一致**（挂账，不是红）', () => {
  const read = crossBookReadingOf(REPO);
  assert.equal(read.applied, true, `真仓必须有域表：${read.table.error}`);
  const c = read.counts;
  assert.equal(c.owner_ambiguous, 0, '域表不许自己打架（同具体度命中两册）');
  assert.equal(c.unjudged, 0, `域表在 ⇒ 不该有 unjudged 行：${read.table.error}`);
  assert.equal(
    c.owned + c.multi_owned + c.owner_mismatch + c.unowned_but_held + c.undeclared,
    read.paths,
    `六档必须分区闭合（有属主 + 多册持有 + 属主错位 + unowned 却有节点 + 未声明 = path 总数）：${JSON.stringify(c)} / ${read.paths}`,
  );
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'design-books-baseline.json'), 'utf8'));
  // ★ 与 gate 同一算法（sha256 over 排序后 join('\n')）—— 测试只断"同源"，不重写判据
  const sha = (list: string[]): string => createHash('sha256').update([...list].sort().join('\n'), 'utf-8').digest('hex');
  assert.equal(
    sha(read.rows.filter((r) => r.klass === 'multi_owned').map((r) => r.path)),
    baseline.multi_owned.sha256,
    '多册持有的**存量指纹**必须与基线一致（变了就要人看一眼：新增要处理、变少说明有人动了册）',
  );
});

test('0.6 gate ②：域表不在而项目有**两册** ⇒ 判不了（退出码 2，不折成 0/1）；只有一册 ⇒ 该档不适用（合法状态）', () => {
  const home = makeTempHome();
  try {
    const proj = makeProject(home);
    writeSheet(proj, 'a', [{ id: 'file_src_a_ts', path: 'src/a.ts' }]);
    // 只有一册 + 没有域表 ⇒ ② 不适用，门照常绿
    const one = runGate(proj, home);
    assert.equal(one.status, 0, `单册项目 ② 不适用 ⇒ 仍应按 ① 放行：\n${one.out.slice(-1200)}`);
    assert.ok(one.out.includes('不适用'), `读数必须说清"不适用"（不是"通过"）：\n${one.out.slice(-1200)}`);
    // 加第二册 ⇒ 域表不在 ⇒ **判不了（2）**
    writeSheet(proj, 'b', [{ id: 'file_src_a_ts', path: 'src/a.ts' }]);
    const two = runGate(proj, home);
    assert.equal(two.status, 2, `两册项目没有域表 ⇒ 判不了（退出码 2）：\n${two.out.slice(-1500)}`);
    assert.ok(two.out.includes('判不了'), `必须说"判不了"：\n${two.out.slice(-1500)}`);
  } finally {
    rmRf(home);
  }
});

test('0.6 gate ②：域表在 ⇒ 存量指纹进基线后转绿；**再多一个跨册重复** ⇒ 立刻红并点名（消融）', () => {
  const home = makeTempHome();
  try {
    const proj = makeProject(home);
    writeBooks(proj, TABLE_AB);
    writeSheet(proj, 'a', [{ id: 'file_src_a_ts', path: 'src/a.ts' }]);
    writeSheet(proj, 'b', [{ id: 'file_src_a_ts', path: 'src/a.ts' }]); // 存量：两册都持 src/a.ts
    const base = path.join(home, 'books-baseline.json');

    // 先跑一次拿到计数（baseline 缺 ⇒ 红），再把它写成基线 ⇒ 转绿（这是"存量挂账"的正身）
    const first = runGate(proj, home, ['--books-baseline', base, '--json']);
    assert.equal(first.status, 1, `基线不在 ⇒ 红（存量没登记）：\n${first.out.slice(-1500)}`);
    const j1 = JSON.parse(first.out);
    assert.equal(j1.books.verdict, 'red', '基线缺失 ⇒ 红（不是"没有存量"）');
    fs.writeFileSync(base, JSON.stringify(j1.books.fingerprint, null, 2), 'utf8');
    const second = runGate(proj, home, ['--books-baseline', base, '--json']);
    const j2 = JSON.parse(second.out);
    assert.equal(second.status, 0, `指纹一致 ⇒ 挂账转绿：\n${second.out.slice(-1500)}`);
    assert.equal(j2.books.verdict, 'ledgered', `必须打印"挂账"这个态（不是"干净"）：${j2.books.verdict}`);
    assert.equal(j2.ok, true);

    // 消融：再加一个跨册重复 ⇒ 集合变 ⇒ 立刻红，并点名
    writeSheet(proj, 'b', [
      { id: 'file_src_a_ts', path: 'src/a.ts' },
      { id: 'file_src_b_ts', path: 'src/b.ts' },
    ]);
    fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
    writeSheet(proj, 'a', [
      { id: 'file_src_a_ts', path: 'src/a.ts' },
      { id: 'file_src_b_ts', path: 'src/b.ts' },
    ]);
    const third = runGate(proj, home, ['--books-baseline', base, '--json']);
    const j3 = JSON.parse(third.out);
    assert.equal(third.status, 1, `新增跨册重复必须立刻红：\n${third.out.slice(-1500)}`);
    assert.equal(j3.books.verdict, 'red');
    assert.deepEqual(j3.books.changed.includes('multi_owned'), true, `变的必须是多册持有这一组：${JSON.stringify(j3.books.changed)}`);
    assert.ok(
      j3.books.rows.some((r: { path: string }) => r.path === 'src/b.ts'),
      `读数必须点名新重复的 path（src/b.ts）：${JSON.stringify(j3.books.rows.map((r: { path: string }) => r.path))}`,
    );
  } finally {
    rmRf(home);
  }
});
