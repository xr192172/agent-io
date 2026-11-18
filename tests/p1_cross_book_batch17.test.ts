/**
 * T-#A8A9-CROSS-BOOK · **批 17（终局）**：`task-system-plan` 计划册**退役**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ## 这一批做了什么（一句话）
 * 把「计划册」从**活册**里拿走：册文件归档进 `.agent-io/design/archived/`（**逐字节不动**）、
 * 同名 feature 从项目注册表**注销**、域表 `books[]` 由 **3 → 2**（退役记录另起 `retired[]`）；
 * 并把**所有运行时消费者**的指向改到"它真正需要的那一处"（归档件 / 全部活册 / 活册名）。
 *
 * ## 判据（★ 每条都写清"什么情形下会红"）
 * | # | 判据 | 它红在哪 |
 * |---|---|---|
 * | 17.1 | 活册**恰 2 本**：`agent-io` + `agent-io-toolface`，且不含 `task-system-plan` | 有人把册搬回顶层 / 新开第三本 |
 * | 17.2 | 归档件在，且 **sha256 = 退役时那一版**（`7567f4a3…`） | 归档件被改过一个字节（"记忆"被改写） |
 * | 17.3 | 退役前的位置 `.agent-io/design/task-system-plan.dsl.json` **不存在** | 有人为了"让某条旧断言变绿"又复制一份回去（活册会变回 3） |
 * | 17.4 | `archived/README.md` 首段就是 **RETIRED** 标记，且点名 reason / HEAD | 归档件旁边没有"为什么退役"的话（下一个人只能靠考古） |
 * | 17.5 | 域表：`books[]` 2 条 · `retired[]` 恰 1 条 · 退役册 `owns` 为空 · 记录指到真归档件 | 把退役册塞回 `books[]`（"owns 空的第三册"）/ 清空 `retired[]` |
 * | 17.6 | 注册表（**按文件直读**）里没有 `task-system-plan`，且注销审计行留了 `feature` + 理由 | 登记没注销 / 注销没留审计（"为什么没登记"查不到） |
 * | 17.7 | `scripts/**` 的**运行时代码**里没有一处还指着退役前路径；4 个归档消费者逐个点名归档件 | 有脚本改回旧路径（= 读一个不存在的文件，且"读不到"会装成"没有"） |
 * | 17.8 | `COGNITION.txt` 里**没有**计划册那一段，两本活册的段都在 | 快照没跟上（读的人会以为它还活着） |
 * | 17.9 | `decision-history-baseline.json` 里没有计划册那一行 | 棘轮还挂着一本不存在的册（首次 `gen-db:check` 就红，且理由错） |
 * | 17.10 | ② 跨册归属**三读数全零**（多册持有 / 属主错位 / id 漂移）+ `books = 2` + `paths ≥ 567` | 退役顺手删掉了活册的节点（分母掉）/ 有人又造双持 |
 * | 17.11 | 卡账**没被本批动过**：`task-system-plan` 分区活卡仍 60 张、历史仍 18 行 | 有人用"退役"当借口批量删卡（那不是退册，是销毁任务板） |
 * | 17.12 | 归档件里 `task_plan` 的资产**一件不少**（4 `invariant_checks` / 10 `design_completeness.criteria` / 7 `invariants` / 3 `patrols`） | 归档时"顺手清理"了真资产 |
 *
 * ## 边界（诚实标注）
 * - **`src/` 一个字节没改**：退役只动"册在哪、登记在哪、谁读它"，不动实现；设计面的判据一条没碰。
 * - **60 张 `todo_*` 活卡仍在库里**（17.11 钉住）：注销登记让它们**按 feature 写不可达**（`todo.*`
 *   需要 `projectRootOf(feature)`），**按项目根读仍可**。这是本批**故意不越界**的一笔：卡账怎么随册销/
 *   是否改判到 `agent-io` 分区，是另一张卡（交付书 §3.2 点名）。
 * - **`src/` 里约 120 行「设计出处：`.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.xxx`」
 *   不改写**：那是**过往出处引用**（说"这条实现当初按哪句话写的"），不是运行时依赖；redirect 由
 *   `archived/README.md` + `design-books.json#retired[]` 承接。17.7 只判 `scripts/` 的**运行时**字面量。
 * - **`structure-gate` 里没有"册数是 3"的断言**（它只**打印** `册 N`）；"3 → 2"的棘轮住在 13 个
 *   批证（`p1_cross_book_batch{1,2,3,4,5,6,8,9,10,11,12,13,14}`）与 `p1_cross_book_batch0` 的域表断言里，
 *   本批已逐条改成 2（并保留"活册名单"这一半，见 17.1）——**没有一条改成恒真**。
 * ════════════════════════════════════════════════════════════════════════════
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { crossBookOwnership, ownsOf, readDesignBooks, type BookSheetLike } from '../src/infrastructure/design_books.js';
import { readDesignSheetsForGate } from '../src/infrastructure/storage.js';
import { listLiveCards } from '../src/infrastructure/task_history.js';

const REPO = process.cwd();
const AI = 'agent-io';
const TOOLFACE = 'agent-io-toolface';
const TSP = 'task-system-plan';
const DESIGN_DIR = path.join(REPO, '.agent-io', 'design');
const ARCHIVE_DIR = path.join(DESIGN_DIR, 'archived');
const ARCHIVED_BOOK = path.join(ARCHIVE_DIR, `${TSP}.dsl.json`);
/** 退役那一刻的归档件 sha256（★ 本批交付书上印的就是它） */
const BOOK_SHA = '7567f4a37af74a3d8abb292366200a9ec47415d504087e9319f2e9dff22a6491';

const shaFile = (abs: string): string => createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
const readJson = <T>(abs: string): T => JSON.parse(fs.readFileSync(abs, 'utf8')) as T;

/** 真仓的两本活册（★ 唯一读端：`readDesignSheetsForGate`，不自己 readdir） */
function liveSheets(): Array<BookSheetLike & { feature: string }> {
  return readDesignSheetsForGate(REPO).sheets as unknown as Array<BookSheetLike & { feature: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 17.1 活册恰 2 本
// ═══════════════════════════════════════════════════════════════════════════
test('17.1 活册**恰 2 本**：agent-io + agent-io-toolface；`task-system-plan` 不在活册集合里', () => {
  const read = readDesignSheetsForGate(REPO);
  assert.deepEqual([...read.features].sort(), [AI, TOOLFACE].sort(), `活册集合必须恰是这两本（实测 ${read.features.join(', ')}）`);
  assert.ok(!read.features.includes(TSP), `退役册不许再出现在活册集合里（实测 ${read.features.join(', ')}）`);
  assert.equal(read.missingDir, false, '设计目录必须在（否则"活册 0 本"也能让上一行成立 —— 那是空转）');
  // ★ 反向：上一行不是"什么都读不到所以没它"——两本活册都必须真读出内容与节点。
  const byFeature = new Map(liveSheets().map((s) => [s.feature, s]));
  assert.ok((byFeature.get(AI)?.geometry?.nodes ?? []).length > 0, `agent-io 册必须**真读出来**（节点数 > 0）：${(byFeature.get(AI)?.geometry?.nodes ?? []).length}`);
  assert.ok((byFeature.get(TOOLFACE)?.geometry?.nodes ?? []).length > 0, '工具面册必须**真读出来**（节点数 > 0）');
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.2 / 17.3 / 17.4 归档件：在、没被改、老位置不在、标记在
// ═══════════════════════════════════════════════════════════════════════════
test('17.2 归档件在 `.agent-io/design/archived/`，且 sha256 = 退役那一刻（**逐字节未改**）', () => {
  assert.ok(fs.existsSync(ARCHIVED_BOOK), `归档件必须存在：${ARCHIVED_BOOK}`);
  assert.equal(shaFile(ARCHIVED_BOOK), BOOK_SHA, '归档件的字节变了 ⇒"归档"就不再是归档（历史记忆被改写）');
  // ★ 它不是空壳：退役时它是 106 个节点 / 437,624 B 的历史工作区（钉住"归档的是真东西"）。
  assert.equal(fs.statSync(ARCHIVED_BOOK).size, 437624, `归档件大小变了（实测 ${fs.statSync(ARCHIVED_BOOK).size}）`);
  const book = readJson<{ feature?: string; geometry?: { nodes?: unknown[] } }>(ARCHIVED_BOOK);
  assert.equal(book.feature, TSP, `归档件里声明的 feature 必须还是 ${TSP}（改名会让"谁被退役了"说不清）`);
  assert.equal((book.geometry?.nodes ?? []).length, 106, '归档件的节点数变了（实测应为 106）');
});

test('17.3 退役前的路径 `.agent-io/design/task-system-plan.dsl.json` **不存在**（不许"复制一份回去"）', () => {
  const retiredPath = path.join(DESIGN_DIR, `${TSP}.dsl.json`);
  assert.ok(!fs.existsSync(retiredPath), `退役前的位置不许还有册：${retiredPath} —— 搬回去的当刻"册数"就变回 3，而它 owns 0 条 path（空壳复活）`);
  // ★ 且顶层 `*.dsl.json` 的枚举结果里不许出现它（防"换个名字的同一本册"）。
  const names = fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.dsl.json')).sort();
  assert.deepEqual(names, [`${AI}.dsl.json`, `${TOOLFACE}.dsl.json`].sort(), `设计目录顶层的册必须恰是这两份（实测 ${names.join(', ')}）`);
});

test('17.4 `archived/README.md` 首段就是 **RETIRED** 标记，且点名理由与退役起点 HEAD', () => {
  const readme = path.join(ARCHIVE_DIR, 'README.md');
  assert.ok(fs.existsSync(readme), `归档件旁边必须有 RETIRED 标记：${readme}`);
  const text = fs.readFileSync(readme, 'utf8');
  assert.match(text.slice(0, 200), /RETIRED/, '文件**开头**就必须是 RETIRED（"读到第二屏才知道已退役"等于没有标记）');
  assert.match(text, /63c9bcc1/, '必须点名退役起点 HEAD（否则"哪一版退役的"只能靠猜）');
  assert.match(text, /archived\/task-system-plan\.dsl\.json/, '必须给出归档件路径');
  assert.match(text, new RegExp(BOOK_SHA.slice(0, 16)), '必须给出归档件的 sha256 前缀（可复算）');
  // ★ 三个仍读归档件的消费者必须逐个点名（它们是"为什么不能删"的证据）
  for (const c of ['scripts/run-invariant-checks.mjs', 'scripts/design-check.mjs', 'scripts/plan-assertions.mjs', 'scripts/vocabulary.mjs']) {
    assert.ok(text.includes(c), `RETIRED 标记里必须点名仍在读归档件的消费者：${c}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.5 域表
// ═══════════════════════════════════════════════════════════════════════════
test('17.5 域表：`books[]` **2 条** · `retired[]` 恰 1 条 · 退役册 `owns` 为空 · 记录指到真归档件', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须读得出来：${read.error}`);
  const table = read.table!;
  assert.deepEqual(table.books.map((b) => b.feature).sort(), [AI, TOOLFACE].sort(), `books[] 必须恰 2 条（实测 ${table.books.map((b) => b.feature).join(', ')}）`);
  assert.equal(ownsOf(table, TSP).length, 0, '退役册不许在 books[] 里 owns 任何东西（"owns 空的第三册"是被明确否决的形态）');

  const raw = readJson<{ retired?: Array<{ feature?: string; book?: string; book_sha256?: string; reason?: string; retired_at?: string }> }>(
    path.join(REPO, 'design-books.json'),
  );
  const retired = raw.retired ?? [];
  assert.equal(retired.length, 1, `retired[] 必须恰 1 条（实测 ${retired.length}）`);
  const r = retired[0]!;
  assert.equal(r.feature, TSP, `retired[] 里记的必须是计划册（实测 ${r.feature}）`);
  assert.equal(r.book, '.agent-io/design/archived/task-system-plan.dsl.json', `退役记录必须指到归档件（实测 ${r.book}）`);
  assert.equal(r.book_sha256, BOOK_SHA, '退役记录里的 sha 与盘上那份必须逐字相同（两处各自钉，任一处改都红）');
  assert.match(String(r.reason ?? ''), /owns/, '退役理由必须写出判据（第一条就是它不再 owns 任何 path）');
  assert.equal(r.retired_at, '2026-11-18', `退役日期（实测 ${r.retired_at}）`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.6 注册表（★ 按文件直读：`AGENT_IO_HOME` 注入会让 `readRegistry()` 变成空表）
// ═══════════════════════════════════════════════════════════════════════════
test('17.6 注册表里**没有** `task-system-plan`，且注销审计行留了 feature + 理由（按文件直读）', (t) => {
  const regFile = path.join(REPO, '.agentio-data', 'projects.json');
  if (!fs.existsSync(regFile)) {
    t.skip(`本机没有注册表文件（${regFile}）—— 干净克隆下它不进 git（.gitignore 忽略整个 .agentio-data/ 目录）⇒ 这一条要在真仓上跑`);
    return;
  }
  const reg = readJson<{ features?: Record<string, unknown> }>(regFile);
  const features = Object.keys(reg.features ?? {}).sort();
  assert.ok(!features.includes(TSP), `注册表里不许还有计划册（实测 ${features.join(', ')}）`);
  // ★ 反向：注销不是"把整个注册表删了"——两本活册必须仍登记着（否则 17.6 会被一个空表骗过）。
  for (const f of [AI, TOOLFACE]) assert.ok(features.includes(f), `活册 ${f} 必须仍在注册表里（实测 ${features.join(', ')}）`);

  const logFile = path.join(REPO, '.agentio-data', 'projects.unregister.jsonl');
  assert.ok(fs.existsSync(logFile), `注销必须留审计行：${logFile}`);
  const rows = fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { feature?: string; reason?: string; by?: string; at?: string });
  const mine = rows.filter((r) => r.feature === TSP);
  assert.equal(mine.length, 1, `计划册的注销审计行必须恰 1 条（实测 ${mine.length}）`);
  assert.ok(String(mine[0]!.reason ?? '').length >= 10, '注销理由不许空着（"为什么删"要能回答）');
  assert.ok(String(mine[0]!.by ?? '').length > 0, '注销必须留 by（谁注销的）');
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.7 消费端不悬挂
// ═══════════════════════════════════════════════════════════════════════════
// 把块注释与整行 `//` 注释剥掉（本判据只判**运行时代码**；出处引用住在注释里，见文件头"边界"）
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') ? '' : l))
    .join('\n');
}

test('17.7 `scripts/**` 的**运行时代码**里没有一处还指着退役前路径；4 个归档消费者逐个点名归档件', () => {
  const retiredLiteral = '.agent-io/design/task-system-plan.dsl.json';
  const SHORT = 'design/task-system-plan.dsl.json';
  const offenders: string[] = [];
  for (const f of fs.readdirSync(path.join(REPO, 'scripts')).filter((x) => x.endsWith('.mjs')).sort()) {
    const code = codeOnly(fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8'));
    if (code.includes(retiredLiteral) || code.includes(SHORT)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `这些脚本的**运行时代码**还指着退役前路径 ⇒ 读一个不存在的文件（"读不到"会装成"没有"）：${offenders.join(', ')}`);

  // ★ 另一侧：仍需要 `task_plan` 那几段的消费者必须**点名归档件**（否则它们是尸体，不是消费者）。
  const archiveLiteral = 'design/archived/task-system-plan.dsl.json';
  for (const f of ['run-invariant-checks.mjs', 'design-check.mjs', 'plan-assertions.mjs', 'vocabulary.mjs']) {
    const code = codeOnly(fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8'));
    assert.ok(code.includes(archiveLiteral), `${f} 必须点名归档件（它读的 \`task_plan\` 那几段只住那里）：${archiveLiteral}`);
  }
  // ★ 反例钉：`coverage` / `gen-contracts` 读的是**判据**（计划册 0 条）⇒ 它们的来源必须是**全部活册**，
  //   不许"改成读归档件"（那会读 0 条判据 = 覆盖率恒 0 的假绿）。
  for (const f of ['coverage.mjs', 'gen-contracts.mjs']) {
    const code = codeOnly(fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8'));
    assert.ok(code.includes("readdirSync(designDir") || code.includes("readdirSync(DESIGN_DIR") || code.includes('readdirSync(DESIGN_DIR') || /readdirSync\([^)]*design/i.test(code), `${f} 必须走"枚举活册"（不是单册硬编码，也不是归档件）`);
    assert.ok(!code.includes('archived'), `${f} 不许指向归档件：它要的是**判据**（归档件里 0 条）⇒ 会变成"覆盖率恒 0"的假绿`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.8 COGNITION 快照
// ═══════════════════════════════════════════════════════════════════════════
test('17.8 `COGNITION.txt` 里没有计划册那一段，两本活册的段都在', () => {
  const snap = path.join(REPO, '.agent-io', 'COGNITION.txt');
  assert.ok(fs.existsSync(snap), `派生快照必须在：${snap}`);
  const text = fs.readFileSync(snap, 'utf8');
  assert.ok(!text.includes(`===feature ${TSP}===`), '快照里还留着计划册那一段 ⇒ 读的人会以为它还活着（`npm run cognition` 没重跑）');
  for (const f of [AI, TOOLFACE]) {
    assert.ok(text.includes(`===feature ${f}===`), `活册 ${f} 的段必须在（否则"没那段"可能只是整份快照坏了）`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.9 历史棘轮
// ═══════════════════════════════════════════════════════════════════════════
test('17.9 `decision-history-baseline.json` 里没有计划册那一行（棘轮不许挂一本不存在的册）', () => {
  const file = path.join(REPO, 'scripts', 'decision-history-baseline.json');
  assert.ok(fs.existsSync(file), `棘轮文件必须在：${file}`);
  const j = readJson<{ total?: number; per_book?: Record<string, number> }>(file);
  const per = j.per_book ?? {};
  assert.ok(!(TSP in per), `per_book 里不许还有 ${TSP}（实测 ${JSON.stringify(per)}）—— 留着它，\`gen-db:check\` 首次就报"历史掉了 1146 条"，而那 1146 条**一条没删**（只是不再进审计面）`);
  for (const f of [AI, TOOLFACE]) assert.ok(typeof per[f] === 'number' && per[f]! > 0, `活册 ${f} 的棘轮必须在（实测 ${per[f]}）`);
  assert.equal(j.total, (per[AI] ?? 0) + (per[TOOLFACE] ?? 0), `total 必须等于 per_book 之和（实测 total=${j.total}，和=${(per[AI] ?? 0) + (per[TOOLFACE] ?? 0)}）`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.10 ② 档三读数全零
// ═══════════════════════════════════════════════════════════════════════════
test('17.10 ② 跨册归属：**三读数全零** + `books = 2` + `paths ≥ 567`（退役没顺手删活册的节点）', () => {
  const read = readDesignBooks(REPO);
  assert.ok(read.table, `域表必须读得出来：${read.error}`);
  const r = crossBookOwnership(liveSheets(), read);
  assert.equal(r.applied, true, `② 档必须"适用"（域表在）：${r.table_error}`);
  assert.equal(r.books, 2, `② 档的册数分母必须是 2（实测 ${r.books}）`);
  assert.equal(r.counts.multi_owned, 0, `多册持有必须为 0（实测 ${r.counts.multi_owned}）`);
  assert.equal(r.counts.owner_mismatch, 0, `属主错位必须为 0（实测 ${r.counts.owner_mismatch}）`);
  assert.equal(r.id_drift.nodes, 0, `id 漂移必须为 0（实测 ${r.id_drift.nodes}）`);
  // ★ 分母：退役**不许**把活册的 path 面一起带走（计划册当年贡献 0 个 path ⇒ 分母一点不该动）。
  assert.ok(r.paths >= 567, `持有 path 的分母只许不降（floor 567 = 批 15 收口；实测 ${r.paths}）—— 掉了 = 有人删了活册的节点`);
  // ★ 反向：三读数全零不是"表一片空"（owned 必须仍是绝大多数）。
  assert.ok(r.counts.owned > 500, `有属主的 path 必须仍在（实测 ${r.counts.owned}）—— 否则"三读数零"只是没东西可判`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.11 卡账没被动过（★ 按库文件直读：注册表那条链在注入的临时家里是空的）
// ═══════════════════════════════════════════════════════════════════════════
test('17.11 卡账**没被本批动过**：计划册分区活卡仍 60 张、历史仍 18 行（退役 ≠ 销毁任务板）', (t) => {
  const dbFile = path.join(REPO, '.agent-io', 'tasks.db');
  if (!fs.existsSync(dbFile)) {
    t.skip(`本机没有 tasks.db（${dbFile}）—— 它不进 git（.gitignore 把 .agent-io 下的 db 文件全忽略）⇒ 这一条要在真仓上跑`);
    return;
  }
  const cards = listLiveCards(REPO) as unknown as Array<{ id: string; feature: string }>;
  const liveTsp = cards.filter((c) => c.feature === TSP);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  let hist = 0;
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_history'").get() as { name?: string } | undefined;
    if (has?.name) {
      hist = Number((db.prepare('SELECT COUNT(*) AS n FROM task_history WHERE feature = ?').get(TSP) as { n?: number })?.n ?? 0);
    }
  } finally {
    db.close();
  }
  assert.equal(liveTsp.length, 60, `计划册分区的活卡必须仍是 60 张（实测 ${liveTsp.length}）—— 退役不是删卡；要收卡另开卡（交付书 §3.2）`);
  assert.equal(hist, 18, `计划册分区的历史必须仍是 18 行（实测 ${hist}）—— 批 16 收口的那 18 行一条不该少`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 17.12 归档件里的真资产一件不少
// ═══════════════════════════════════════════════════════════════════════════
test('17.12 归档件里 `task_plan` 的资产**一件不少**（4 invariant_checks / 10 design_completeness.criteria / 7 invariants / 3 patrols）', () => {
  const book = readJson<{
    task_plan?: {
      invariant_checks?: unknown[];
      design_completeness?: { criteria?: unknown[] };
      invariants?: unknown[];
      patrols?: unknown[];
      state_machine?: unknown;
      task_home?: unknown;
    };
    feature_tree?: unknown;
    annotations?: unknown;
  }>(ARCHIVED_BOOK);
  const tp = book.task_plan;
  assert.ok(tp, '归档件必须有 `task_plan`（那是本册真正的资产，recon §4 明说一个字不动）');
  assert.equal((tp!.invariant_checks ?? []).length, 4, `不变量判据（带 cmd 的那 4 条）一条不许少（实测 ${(tp!.invariant_checks ?? []).length}）`);
  assert.equal((tp!.design_completeness?.criteria ?? []).length, 10, `D1–D10 十条设计完整性判据一条不许少（实测 ${(tp!.design_completeness?.criteria ?? []).length}）`);
  assert.equal((tp!.invariants ?? []).length, 7, `\`task_plan.invariants\` 七条一条不许少（实测 ${(tp!.invariants ?? []).length}）`);
  assert.equal((tp!.patrols ?? []).length, 3, `\`task_plan.patrols\` 三条一条不许少（实测 ${(tp!.patrols ?? []).length}）`);
  assert.ok(tp!.state_machine, '`task_plan.state_machine` 必须在（五态的权威之一）');
  assert.ok(tp!.task_home, '`task_plan.task_home` 必须在（卡的家那句话）');
  assert.ok(book.feature_tree, '`feature_tree` 必须在');
  // ★ 反向：这份册作为"活册"的那一面**确实是空的**（0 条判据）—— 这才是退役的判据，不是"觉得没用了"。
  const nodes = (readJson<{ geometry?: { nodes?: Array<{ decision?: { expectations?: unknown[] } }> } }>(ARCHIVED_BOOK).geometry?.nodes ?? []);
  const crit = nodes.reduce((n, x) => n + (x.decision?.expectations ?? []).length, 0);
  assert.equal(crit, 0, `归档件里的判据必须仍是 0 条（实测 ${crit}）—— 若不为 0，说明"判据已全部搬走"这个退役前提不成立`);
});
