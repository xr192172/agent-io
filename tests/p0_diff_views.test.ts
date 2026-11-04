/**
 * P0 · **`diff_views` 对拍的三条可比性判据** —— 本文件是该工具**第一份**测试（改前零覆盖）。
 *
 * ## 它测的是哪三格（也是三处实测缺陷）
 * 1. **路径口径（Apples-to-Oranges）**：两侧 `semantic.files[].path` 各自相对**自己那份**
 *    `source_root`。两侧 root 不同时，同一文件会以两个字符串出现 ⇒ 逐文件比对把它算成
 *    「一增一删」。实测（`agent-io-toolface` 册）6 个文件全中招 ⇒ 12 条**全假**差异。
 *    ⇒ 判据必须**双向**（0.14）：同义（只差口径）必判 unchanged；异义（签名不同）必判 modified。
 * 2. **范围与分母（Incremental-vs-Full）**：定向对拍必须打印「本次 N / 全量 M ⇒ 未覆盖 M−N」；
 *    不给范围时读数里也必须有「全量」字样 —— 否则"子集绿"会被读成"全绿"。
 * 3. **保鲜（Stale Read）**：`live` 是 `cache.db` 的一次投影。投影落后于库时，差异里混着
 *    "快照没跟上"的成分 ⇒ 必须显形。权威 = 册自己记的 `_sync.scanRev` vs 当下 `max(files.indexed_at)`。
 *
 * ## 为什么是端到端（走 `diffViews` 而不是只测纯函数）
 * 缺陷的真实形态在**接线**上：schema 声明了 `scope`、handler 没转发、core 没归一 —— 任一环断了，
 * 纯函数照样全绿。所以本文件造一个**真项目 + 真索引 + 真设计册 + 真 live 快照**，直接调工具入口。
 * （纯函数本身另由 `behavior-cases` 判据覆盖，见 `src/domain/diff_scope.ts` 的 4 条。）
 *
 * ## 诚实边界
 * · 只用**临时目录**（`makeTempHome()` + 临时 `AGENT_IO_HOME`），不碰真数据仓；
 * · `card` 那条用一个**手写的真画布**（`writeRewritePlan`）—— 不 mock 库；
 * · 不证明"两侧 root 完全无关时也能对账"：那种情形按设计**拒绝硬比**（判据 ⑨ 锁住这条）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { diffViews } from '../src/application/refactor/diff_views/diff_views.js';
import { writeRewritePlan } from '../src/application/design/db/rewrite_plan.js';
import { ensureProjectIndex } from '../src/infrastructure/index/index_freshness.js';
import { scanRevOf } from '../src/infrastructure/index/scan_rev.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
const HOME = path.join(TMP, 'home');
process.env.AGENT_IO_HOME = HOME;
fs.mkdirSync(path.join(HOME, '.agent-io', 'design'), { recursive: true });
after(() => rmRf(TMP));

const PROJ = path.join(TMP, 'proj');
const FEATURE = 'fx_diff_views';
/** 与 PROJ 无包含关系的另一个根（判据 ⑨ 用） */
const OTHER_ROOT = path.join(TMP, 'elsewhere');

const SIG_OK = 'alpha(): number';

function writeJson(abs: string, v: unknown): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(v, null, 2), 'utf-8');
}

function sym(name: string, signature: string) {
  return { name, kind: 'function', line: 1, end_line: 1, signature };
}

/** 设计册：`source_root = PROJ`，路径是**带目录的**仓库相对路径 */
function designSheet(opts: { excluded?: Array<{ path: string; reason: string }> } = {}) {
  return {
    id: FEATURE,
    type: 'design',
    feature: FEATURE,
    version: 1,
    title: FEATURE,
    source_root: PROJ,
    // ★③ 「已声明排除」的权威 = 设计册的 excluded（`excludedPathsOf` 读全册并集）
    excluded: opts.excluded ?? [],
    geometry: {
      nodes: [
        { id: 'file_src_a_ts', label: 'a.ts', type: 'file', x: 0, y: 0, path: 'src/a.ts' },
        { id: 'file_src_b_ts', label: 'b.ts', type: 'file', x: 0, y: 0, path: 'src/b.ts' },
      ],
      edges: [],
    },
    semantic: {
      files: [
        {
          id: 'file_src_a_ts',
          path: 'src/a.ts',
          lines: 3,
          layer: 'core',
          symbols: [sym('alpha', SIG_OK)],
          expected_apis: [{ name: 'alpha', signature: SIG_OK, line: 1, end_line: 1 }],
        },
        {
          id: 'file_src_b_ts',
          path: 'src/b.ts',
          lines: 3,
          layer: 'core',
          symbols: [sym('beta', 'beta(): number')],
          expected_apis: [{ name: 'beta', signature: 'beta(): number', line: 1, end_line: 1 }],
        },
      ],
    },
    todos: [],
  };
}

/**
 * 实际侧快照：`source_root` 是 **PROJ/src**（嵌套）且路径是**裸文件名**
 * —— 这正是实测里那个"全假差异"的形状。
 */
function liveSheet(opts: { scanRev: number; aSignature?: string; root?: string; extraSymbol?: boolean }) {
  const aSig = opts.aSignature ?? SIG_OK;
  const aSymbols = [sym('alpha', aSig)];
  const aApis: Array<{ name: string; signature: string; line: number; end_line: number }> = [
    { name: 'alpha', signature: aSig, line: 1, end_line: 1 },
  ];
  if (opts.extraSymbol) {
    // ★ 只在实际侧有的符号（设计册没写全）—— 待填充清单的夹具
    aSymbols.push(sym('gamma', 'gamma(): number'));
    aApis.push({ name: 'gamma', signature: 'gamma(): number', line: 5, end_line: 5 });
  }
  return {
    id: FEATURE,
    type: 'design',
    feature: FEATURE,
    version: 1,
    title: FEATURE,
    source_root: opts.root ?? path.join(PROJ, 'src'),
    geometry: {
      nodes: [
        { id: 'file_a_ts', label: 'a.ts', type: 'file', x: 0, y: 0, path: 'a.ts' },
        { id: 'file_b_ts', label: 'b.ts', type: 'file', x: 0, y: 0, path: 'b.ts' },
      ],
      edges: [],
    },
    semantic: {
      files: [
        {
          id: 'file_a_ts',
          path: 'a.ts',
          lines: 3,
          layer: 'core',
          symbols: aSymbols,
          expected_apis: aApis,
        },
        {
          id: 'file_b_ts',
          path: 'b.ts',
          lines: 3,
          layer: 'core',
          symbols: [sym('beta', 'beta(): number')],
          expected_apis: [{ name: 'beta', signature: 'beta(): number', line: 1, end_line: 1 }],
        },
      ],
    },
    // ★ 保鲜判据的输入：这份快照基于哪一代索引（`max(files.indexed_at)`）
    _sync: { saved_at: '2026-01-01T00:00:00.000Z', source: 'live', feature: FEATURE, scanRev: opts.scanRev },
    todos: [],
  };
}

/**
 * 写设计册。★ **两处同文**（夹具需要，生产里只有项目根那一份）：
 * · `HOME/.agent-io/design/` —— `getDSL` 在 feature 未注册时回落到数据家（本夹具不建注册表）；
 * · `PROJ/.agent-io/design/` —— `loadDesignSheetsForGate(PROJ)` 只读项目根（「已声明排除」就靠它）。
 */
function setDesign(opts: { excluded?: Array<{ path: string; reason: string }> } = {}): void {
  const sheet = designSheet(opts);
  writeJson(path.join(HOME, '.agent-io', 'design', `${FEATURE}.dsl.json`), sheet);
  writeJson(path.join(PROJ, '.agent-io', 'design', `${FEATURE}.dsl.json`), sheet);
}

/** 当前索引扫描代（`null` = 读不到 —— 那时保鲜只能判 unknown） */
function currentRev(): number {
  const r = scanRevOf({ feature: FEATURE, sourceRoot: PROJ }).rev;
  assert.notEqual(r, null, '夹具没建出索引 ⇒ 后面的保鲜判据全都判不了');
  return r as number;
}

function setLive(opts: { scanRev: number; aSignature?: string; root?: string }): void {
  writeJson(path.join(PROJ, '.agent-io', 'live', `${FEATURE}.dsl.json`), liveSheet(opts));
}

/** 端到端调工具入口（`{ message, data, touched }`） */
function run(input: Parameters<typeof diffViews>[0]) {
  return diffViews(input);
}

/** 文件级读数按 path 索引（断言更可读） */
function byPath(files: Array<{ path: string; change: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) out[f.path] = f.change;
  return out;
}

test('⓪ 夹具：真项目（2 个源文件）+ 真索引 + 真设计册 + 一份**裸名口径**的 live 快照', async () => {
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src', 'a.ts'), 'export function alpha(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(PROJ, 'src', 'b.ts'), 'export function beta(): number {\n  return 2;\n}\n');
  await ensureProjectIndex(PROJ, { bootstrap: true });
  setDesign();
  setLive({ scanRev: currentRev() });
  assert.ok(currentRev() > 0, '索引代必须是一个真时间戳');
});

test('① 口径归一（同义必命中）：两侧 root 嵌套 + 实际侧裸名 ⇒ 判 unchanged，**不是**一增一删', () => {
  setLive({ scanRev: currentRev() });
  const r = run({ feature: FEATURE, live_dir: PROJ });
  const m = byPath(r.data.files);
  assert.equal(
    r.data.summary.added_files,
    0,
    `①-a 假"新增"必须为 0（改前是 2：裸名 a.ts/b.ts 与 src/a.ts 被当成两个文件）：${JSON.stringify(m)}`,
  );
  assert.equal(r.data.summary.removed_files, 0, `①-b 假"删除"必须为 0：${JSON.stringify(m)}`);
  assert.equal(m['src/a.ts'], 'unchanged', `①-c src/a.ts 必须判 unchanged（口径只差前缀）：${JSON.stringify(m)}`);
  assert.equal(m['src/b.ts'], 'unchanged', `①-d src/b.ts 必须判 unchanged：${JSON.stringify(m)}`);
  assert.equal(r.data.comparable, true, '①-e 嵌套 root 是**可归一**的，不该被判不可比');
  assert.equal(r.data.path_basis.basis, 'live-under-design', `①-f 判定必须是 live-under-design，实得 ${r.data.path_basis.basis}`);
  assert.equal(r.data.path_basis.live_prefix, 'src', `①-g 重定基前缀必须是 src，实得 ${r.data.path_basis.live_prefix}`);
});

test('① 双向·异义必不命中：同一口径下签名不同 ⇒ 必须判 modified（归一不能把差异吃掉）', () => {
  setLive({ scanRev: currentRev(), aSignature: 'alpha(x: number): number' });
  const r = run({ feature: FEATURE, live_dir: PROJ });
  const m = byPath(r.data.files);
  assert.equal(
    m['src/a.ts'],
    'modified',
    `②-a 签名不同必须判 modified（否则归一化把真差异吞了 —— 这正是 0.14 的第二向）：${JSON.stringify(m)}`,
  );
  assert.equal(m['src/b.ts'], 'unchanged', `②-b 未改的那个文件仍须 unchanged：${JSON.stringify(m)}`);
  assert.equal(r.data.summary.modified_files, 1, `②-c 修改数必须恰为 1，实得 ${r.data.summary.modified_files}`);
});

test('③ 分母（0.19③）：不给范围 ⇒ 读数含「全量」且「未覆盖 0」', () => {
  setLive({ scanRev: currentRev() });
  const r = run({ feature: FEATURE, live_dir: PROJ });
  assert.match(r.data.scope.label, /全量/, `③-a 不圈定时范围标签必须含「全量」，实得「${r.data.scope.label}」`);
  assert.match(r.message, /未覆盖 0/, '③-b 读数必须打印「未覆盖 0」（只给分子等于没验）');
  assert.equal(r.data.scope.universe_files, 2, `③-c 全量 M 必须 = 2，实得 ${r.data.scope.universe_files}`);
  assert.equal(r.data.scope.scoped_files, 2, `③-d 本次 N 必须 = 2，实得 ${r.data.scope.scoped_files}`);
  assert.equal(r.data.summary.uncovered_files, 0, '③-e summary 里也要有未覆盖数（机器可读）');
});

test('④ scope 生效：只对拍圈定那一片，且分母显形（未覆盖 M−N）', () => {
  setLive({ scanRev: currentRev() });
  const r = run({ feature: FEATURE, live_dir: PROJ, scope: 'files:src/a.ts' });
  assert.deepEqual(r.data.scope.files, ['src/a.ts'], `④-a 作用面必须恰为 src/a.ts，实得 ${JSON.stringify(r.data.scope.files)}`);
  assert.equal(r.data.scope.universe_files, 2, `④-b 全量 M 仍须 = 2，实得 ${r.data.scope.universe_files}`);
  assert.equal(r.data.scope.scoped_files, 1, `④-c 本次 N 必须 = 1，实得 ${r.data.scope.scoped_files}`);
  assert.equal(r.data.summary.uncovered_files, 1, '④-d 未覆盖必须 = 1');
  assert.match(r.message, /本次 1 条 · 全量 2 条 ⇒ 未覆盖 1/, `④-e 读数必须打印完整分母行：${r.data.scope.label}`);
  assert.equal(r.data.files.length, 1, `④-f 明细只能有 1 个文件，实得 ${r.data.files.length}`);
});

test('⑤ card 生效：按任务卡画布的**坍缩集**圈定（不自己查 plans 表，复用唯一权威）', () => {
  writeRewritePlan(PROJ, {
    path: 'src/b.ts',
    card: 'card_probe',
    entries: [
      {
        anchor: { symbol: 'beta' },
        kind: 'rewrite',
        detail: '夹具：只为了造一张真画布',
        judgement_ref: 'cert:probe#1',
        status: 'open',
      },
    ],
  } as never);
  setLive({ scanRev: currentRev() });
  const r = run({ feature: FEATURE, live_dir: PROJ, card: 'card_probe' });
  assert.deepEqual(r.data.scope.files, ['src/b.ts'], `⑤-a 坍缩集必须恰为 src/b.ts，实得 ${JSON.stringify(r.data.scope.files)}`);
  assert.equal(r.data.scope.label, 'card:card_probe', `⑤-b 范围标签必须点名卡号，实得 ${r.data.scope.label}`);
  assert.equal(r.data.summary.uncovered_files, 1, '⑤-c 分母仍须显形（未覆盖 1）');
});

test('⑥ scope 与 card 同给 ⇒ 当场拒绝并点名两者（拒绝必须可定位，0.12 补充）', () => {
  let msg = '';
  try {
    run({ feature: FEATURE, live_dir: PROJ, scope: 'files:src/a.ts', card: 'card_probe' });
  } catch (e) {
    msg = (e as Error).message;
  }
  assert.match(msg, /只能给一个/, msg ? `⑥-a 报错文案没点名"只能给一个"：${msg.slice(0, 120)}` : '⑥-a 同给 scope+card 必须抛错（两种口径打架）');
  assert.match(msg, /scope=/, '⑥-b 报错必须把收到的两个值都带出来');
  assert.match(msg, /card=/, '⑥-b 报错必须把收到的两个值都带出来');
});

test('⑦ 陈旧护栏：live 落后索引 ⇒ verdict=stale 且读数显式警告（不许把陈旧当事实）', () => {
  const rev = currentRev();
  setLive({ scanRev: rev - 37 * 3600 * 1000 }); // 落后 37 小时
  const r = run({ feature: FEATURE, live_dir: PROJ });
  assert.equal(r.data.freshness?.verdict, 'stale', `⑦-a 必须判 stale，实得 ${JSON.stringify(r.data.freshness?.verdict)}`);
  assert.match(String(r.data.freshness?.line), /陈旧 37\.0 小时/, `⑦-b 警告必须给出落后小时数：${r.data.freshness?.line}`);
  assert.match(r.message, /live 视图陈旧/, '⑦-c 读数里必须真的出现这句警告（不许只藏在 data 里）');
});

test('⑦ 双向·同代不许误报：scanRev 与当前索引一致 ⇒ verdict=fresh（否则这条护栏就是"永远亮"）', () => {
  setLive({ scanRev: currentRev() });
  const r = run({ feature: FEATURE, live_dir: PROJ });
  assert.equal(r.data.freshness?.verdict, 'fresh', `⑧-a 同代必须判 fresh，实得 ${JSON.stringify(r.data.freshness?.verdict)}`);
  assert.doesNotMatch(r.message, /live 视图陈旧/, '⑧-b 同代时**不许**出现"陈旧"警告（0.16：永远亮的告警 = 被关掉的告警）');
});

test('⑨ 口径不可归一 ⇒ 拒绝硬比并给诊断（不是"全部新增"）', () => {
  setLive({ scanRev: currentRev(), root: OTHER_ROOT });
  const r = run({ feature: FEATURE, live_dir: PROJ });
  assert.equal(r.data.comparable, false, '⑨-a 两个无关 root 必须判不可比');
  assert.equal(r.data.path_basis.basis, 'incomparable', `⑨-b 判定必须是 incomparable，实得 ${r.data.path_basis.basis}`);
  assert.equal(r.data.summary.added_files, 0, '⑨-c 不可比时**不许**把文件全算成新增');
  assert.equal(r.data.summary.removed_files, 0, '⑨-c 不可比时**不许**把文件全算成删除');
  assert.match(r.message, /无法对账/, `⑨-d 读数必须明说"无法对账"：${r.message.slice(0, 200)}`);
  assert.doesNotMatch(r.message, /完全一致/, '⑨-e 拒绝硬比**不许**被印成"完全一致"（那正是 0.12 禁的静默失败）');
});

test('⑩ 待填充清单（0.29②）：只在实际侧的条目必须进「待填充」，**不许**标成正常/预期', () => {
  setDesign();
  setLive({ scanRev: currentRev(), extraSymbol: true });
  const r = run({ feature: FEATURE, live_dir: PROJ });
  const b = r.data.backfill;
  assert.equal(b.direction, 'live_only_means_design_gap', '⑩-a 方向必须写进读数（只在实际侧 ⇒ 设计册缺）');
  assert.equal(b.files.count, 0, `⑩-b 文件层应为 0，实得 ${b.files.count}`);
  assert.equal(
    b.symbols_apis.count,
    1,
    `⑩-c 符号/API 层应恰为 1 条（live 多出的 gamma），实得 ${b.symbols_apis.count}：${JSON.stringify(b.symbols_apis.by_file)}`,
  );
  assert.equal(
    b.symbols_apis.by_file[0]?.file,
    'src/a.ts',
    `⑩-d 必须分文件点名 src/a.ts，实得 ${JSON.stringify(b.symbols_apis.by_file)}`,
  );
  assert.equal(
    b.total,
    b.files.count + b.symbols_apis.count + b.edges.count,
    '⑩-e total 必须 = 三层之和（分母闭合）',
  );
  assert.equal(b.excluded.count, 0, '⑩-f 未声明排除时不许出现「已排除」');
  assert.match(r.message, /待填充（设计册缺）/, '⑩-g 读数必须打印「待填充（设计册缺）」');
  assert.doesNotMatch(r.message, /正常差异|预期边界/, '⑩-h 不许把差异标成"正常/预期"（0.29②）');
});

test('⑪ 已声明排除（0.29 唯一例外）：落进设计册 excluded 的条目**不算缺口**，但必须逐条可追', () => {
  setDesign({ excluded: [{ path: 'src/a.ts', reason: '夹具：这个文件声明不管' }] });
  setLive({ scanRev: currentRev(), extraSymbol: true });
  const r = run({ feature: FEATURE, live_dir: PROJ });
  const b = r.data.backfill;
  assert.equal(b.symbols_apis.count, 0, `⑪-a 已声明排除的符号不许再算缺口，实得 ${b.symbols_apis.count}`);
  assert.equal(b.total, 0, `⑪-b 待填充总数应回到 0，实得 ${b.total}`);
  assert.equal(b.excluded.count, 1, `⑪-c 已声明排除必须计数（逐条可追），实得 ${b.excluded.count}`);
  assert.equal(b.excluded.items[0]?.path, 'src/a.ts', `⑪-d 排除条目必须点名路径，实得 ${JSON.stringify(b.excluded.items)}`);
  assert.match(String(b.excluded.items[0]?.reason), /声明不管/, '⑪-e 排除理由必须带出（来自设计册 excluded.reason）');
  setDesign();
});
