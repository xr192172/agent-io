// touches: src/infrastructure/index/symbols.ts, src/infrastructure/index/index_freshness.ts, src/infrastructure/index/watch_project.ts, scripts/verify-changed.mjs
/**
 * P0 · 「什么变了」必须是**可信且唯一**的（AGENTS-RULES 0.12）。
 *
 * ## 病（改前实测，行号是改前的）
 * 变更集的**读端**把「读失败」折成了「没有」：
 *   · `symbols.ts:1340-1342`（坏列 `catch {}`）+ `:1345-1347`（整读失败 `catch { return [] }`）
 *     ⇒ `changedSymbolNames` 读失败返回 `[]`；
 *   · 消费方 `index_freshness.ts:694` / `watch_project.ts:215` 拿到空集
 *     ⇒ `refsReopened = 0` ⇒ **引用方永不重解析 ⇒ 静默缺边**。
 * ⇒ 同一个 `[]` 既可能是"这次没人改名"，也可能是"我根本没读出来" —— 两者必须能分开读。
 *
 * ## 六条用例（每条都是"改前红 / 改后绿"的鉴别器）
 *   ① 坏列 JSON ⇒ 抛且**点名**表/列/文件（改前：`[]`）
 *   ② 表读不到 ⇒ 抛且点名表（改前：`[]`）
 *   ③ **正体**：真·没有（无 diff 行）⇒ `[]` 且不抛；健康行 ⇒ 真名字
 *      ★ 这一条是**消融 ①**的鉴别器：修复点若被改成"恒返回有变化"，本用例红。
 *   ④ `watch_project.flushBatch`：读不出 ⇒ `summary.error` 点名（改前：`undefined` = 静默）
 *   ⑤ `index_freshness.ensureFreshIndex`：读不出 ⇒ `report.error` 点名（改前：`undefined` = 静默）
 *      ★ ①②④⑤ 四条是**消融 ②**（改回 `[]`）的鉴别器。
 *   ⑥ `verify-changed.mjs` 的改动集来源必须**自报**：「权威是谁 / 我用的是什么 / 为什么」
 *      —— 不许"两套并存而无人知道"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changedSymbolNames, syncFile } from '../src/infrastructure/index/symbols.js';
import { getProjectCacheDb, type Database } from '../src/infrastructure/index/db.js';
import { flushBatch } from '../src/infrastructure/index/watch_project.js';
import { ensureFreshIndex } from '../src/infrastructure/index/index_freshness.js';
import { indexIntegrity, renderIntegrity } from '../src/application/meta/integrity/index_integrity.js';
import { clearAlertInbox, peekAlerts } from '../src/infrastructure/alert_inbox.js';
// ★ 场景 B 用：把 a.ts 登记成「我们自己刚写过」⇒ 保鲜会把它并进本轮 pending
//   （保鲜只按 stat 找 pending，不登记就永远读不到那条坏 diff 行）
import { recordSelfWrite } from '../src/application/write_gate.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 建临时项目根（与 home 分开：cache.db 住 home，源码住 project） */
function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-changeset-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

/** 落一条 `files` 行（`symbol_diffs` 要 file_id 外键） */
function seedFile(db: Database, rel: string): number {
  db.prepare('INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at) VALUES (?,?,?,?,?,?)').run(
    rel,
    'h1',
    'ts',
    1,
    0,
    0,
  );
  return (db.prepare('SELECT id FROM files WHERE path = ?').get(rel) as { id: number }).id;
}

/** 落一条 `symbol_diffs` 行；三列原样写入（坏 JSON 由调用方自己造） */
function seedDiff(db: Database, fileId: number, added: string, removed: string, changed: string): void {
  db.prepare(
    'INSERT INTO symbol_diffs (file_id, from_hash, to_hash, added, removed, changed, norm_from, norm_to, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(fileId, 'a', 'b', added, removed, changed, '', '', 0);
}

/**
 * 只让**变更集读取**这一条 SQL 失败（其余一切照旧）。
 *
 * ★ 为什么必须"只打断这一条"：真造一个坏库会让 `syncFile` 也挂 ⇒ 测到的就不是
 *   「消费方拿不到变更集时说了什么」，而是「syncFile 挂了」。判据要打在**被测那一格**上。
 */
const DIFF_READ_SQL = /SELECT added, removed, changed FROM v_symbol_diffs/;
function dbWithBrokenDiffRead(db: Database): Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (DIFF_READ_SQL.test(sql)) throw new Error('database disk image is malformed（注入：变更集读表失败）');
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as Database;
}

// ════════════════════════════════════════════════════════════════════
// ① 坏列 JSON ⇒ 抛且点名（改前 catch{} 跳过该列 ⇒ 返回 []）
// ════════════════════════════════════════════════════════════════════
test('① changedSymbolNames · 坏列 JSON ⇒ 抛出并点名 表/列/文件（改前返回 [] = 读失败冒充"没变"）', () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    const fid = seedFile(db, 'src/bad.ts');
    // `added` 是好的、`removed` 是坏的 —— 改前正是"坏列跳过、好列照收"（静默少报一半）
    seedDiff(db, fid, '["a.kept"]', '{"not":"an array"', '[]');

    let err: Error | null = null;
    let ret: unknown = null;
    try {
      ret = changedSymbolNames(db, 'src/bad.ts');
    } catch (e) {
      err = e as Error;
    }
    assert.ok(
      err,
      `坏列必须抛出（改前：坏列被 catch 掉 ⇒ 返回 ${JSON.stringify(ret)} ⇒ "读失败"与"没变"同形）`,
    );
    assert.match(err.message, /v_symbol_diffs/, `诊断必须点名**哪张表**：${err.message}`);
    assert.match(err.message, /removed/, `诊断必须点名**哪一列**：${err.message}`);
    assert.match(err.message, /src\/bad\.ts/, `诊断必须点名**哪个文件**：${err.message}`);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

// ════════════════════════════════════════════════════════════════════
// ② 整读失败（视图缺失）⇒ 抛且点名（改前 catch{return []}）
// ════════════════════════════════════════════════════════════════════
test('② changedSymbolNames · 变更集读表失败 ⇒ 抛出并点名 v_symbol_diffs（改前 catch{return []}）', () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    seedFile(db, 'src/a.ts');
    db.exec('DROP VIEW v_symbol_diffs'); // 真·读失败（不是"没有记录"）

    let err: Error | null = null;
    let ret: unknown = null;
    try {
      ret = changedSymbolNames(db, 'src/a.ts');
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err, `读表失败必须抛出（改前：返回 ${JSON.stringify(ret)} ⇒ refsReopened=0 ⇒ 静默缺边）`);
    assert.match(err.message, /v_symbol_diffs/, `诊断必须点名表：${err.message}`);
    assert.match(err.message, /src\/a\.ts/, `诊断必须点名文件：${err.message}`);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ 正体：真·没有 ⇒ [] 且不抛；健康行 ⇒ 真名字（★ 消融①的鉴别器）
// ════════════════════════════════════════════════════════════════════
test('③ changedSymbolNames · 无 diff 行 ⇒ [] 且不抛；健康行 ⇒ 真名字（修复点被改成"恒有变化"⇒ 本用例红）', () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    const fid = seedFile(db, 'src/ok.ts');
    seedFile(db, 'src/nodiff.ts');
    seedDiff(db, fid, '["mod.added"]', '["mod.gone"]', '["mod.changed"]');

    // 真·有变化：三条列都收到，qualified_name 取尾段
    assert.deepEqual(
      [...changedSymbolNames(db, 'src/ok.ts')].sort(),
      ['added', 'changed', 'gone'],
      '健康数据必须原样读出（added/removed/changed 三列都收，取 qualified_name 尾段）',
    );

    // 真·没有：这个文件压根没有 diff 记录（首次导入 / 未同步）= **合法空集**，不许抛
    assert.deepEqual(changedSymbolNames(db, 'src/nodiff.ts'), [], '没有 diff 行是合法空集（与读失败必须分得开）');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

// ════════════════════════════════════════════════════════════════════
// ④ 消费方 1：flushBatch（改前拿不到变更集也一声不响）
// ════════════════════════════════════════════════════════════════════
test('④ flushBatch · 变更集读不出 ⇒ summary.error 点名（改前 undefined ⇒ 读成"没人改名"）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    const abs = path.join(project, 'src', 'a.ts');
    fs.writeFileSync(abs, 'export function a() { return 1; }\n', 'utf8');
    await syncFile(db, project, abs);
    // 改成"有变动"，让 flushBatch 真的走到"取变更集 → 重开引用"那一格
    fs.writeFileSync(abs, 'export function a() { return 2; }\nexport function b() { return 3; }\n', 'utf8');

    const summary = await flushBatch(dbWithBrokenDiffRead(db), project, ['src/a.ts']);
    assert.ok(summary.files.length > 0, '夹具无效：flushBatch 没把 a.ts 算进本批');
    assert.ok(
      typeof summary.error === 'string' && summary.error.length > 0,
      `拿不到变更集**不许**静默（改前 error=undefined、refsReopened=0 ⇒ 读端以为"没人改名"）：${JSON.stringify(summary)}`,
    );
    assert.match(summary.error, /v_symbol_diffs/, `诊断要点名表：${summary.error}`);
    assert.match(summary.error, /src\/a\.ts/, `诊断要点名文件：${summary.error}`);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 消费方 2：ensureFreshIndex（改前整段 try/catch 吞掉）
// ════════════════════════════════════════════════════════════════════
test('⑤ ensureFreshIndex · 变更集读不出 ⇒ report.error 点名（改前 catch{/* 不阻断 */} ⇒ 静默）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    const abs = path.join(project, 'src', 'a.ts');
    fs.writeFileSync(abs, 'export function a() { return 1; }\n', 'utf8');
    await ensureFreshIndex(db, project); // 建索引（这轮不该有 error）
    // ★ R17 racy-git：**等长**改写 + 把 mtime 钉回索引记录的那个格（`Math.round` 与库内两侧同一把尺）
    //   ⇒ **确定性**复现「同一时间戳格内的等长改写」，不再靠"机器有多快"。
    //   旧夹具靠时序：进程一热（模块缓存已焐热）两次写就落进同一格 ⇒ 漏检 ⇒ fail/pass/fail 的 flake。
    const pinned = new Date(Math.round(fs.statSync(abs).mtimeMs));
    fs.writeFileSync(abs, 'export function a() { return 9; }\n', 'utf8'); // 造"重同步"（与上面**等长**）
    fs.utimesSync(abs, pinned, pinned);

    const report = await ensureFreshIndex(dbWithBrokenDiffRead(db), project);
    assert.ok(
      report.resynced > 0,
      `同一时间戳格内的等长改写必须被检出（stat 闸漏检）⇒ 索引会留旧内容 —— 实测 resynced=${report.resynced}`,
    );
    assert.ok(
      typeof report.error === 'string' && report.error.length > 0,
      `拿不到变更集**不许**静默（改前整段 catch 吞掉 ⇒ refsReopened=0 读起来像"没变化"）：${JSON.stringify(report)}`,
    );
    assert.match(report.error, /v_symbol_diffs/, `诊断要点名表：${report.error}`);
    assert.match(report.error, /src\/a\.ts/, `诊断要点名文件：${report.error}`);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 一处权威：verify-changed 必须自报"权威是谁 / 我用的是什么 / 为什么"
// ════════════════════════════════════════════════════════════════════
test('⑥ verify-changed.mjs · 改动集来源自报（权威 = scan_changes ∪ symbol_diffs；本次用 git，理由必须写出）', () => {
  const r = spawnSync(
    process.execPath,
    [path.resolve('scripts/verify-changed.mjs'), '--json', '--no-run', 'scripts/verify-changed.mjs'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  let j: { change_source?: { authority: string; used: string; why: string } } | null = null;
  try {
    j = JSON.parse(out);
  } catch {
    j = null;
  }
  assert.ok(j, `--json 必须可解析：\n${out.slice(-2000)}`);
  const cs = j.change_source;
  assert.ok(
    cs,
    '改动集来源必须**机读自报**（`change_source`= {authority, used, why}）—— 否则就是"两套并存而无人知道"',
  );
  assert.match(cs.authority, /scan_changes/, `权威必须点名 scan_changes：${cs.authority}`);
  assert.match(cs.authority, /symbol_diffs/, `权威必须点名 symbol_diffs：${cs.authority}`);
  assert.equal(cs.used, 'git', `本次用的是 git（必须与权威分开写清）：${cs.used}`);
  assert.ok(cs.why.trim().length > 0, '为什么用 git（而不是直接吃权威）必须写出来 —— 空理由 = 没人知道');
});

// ════════════════════════════════════════════════════════════════════
// ⑦ 读端 1：`index_integrity` 的回执必须**搬运** error（改前 receiptOf 逐字段搬 7 项、漏掉它）
// ════════════════════════════════════════════════════════════════════
/**
 * 让真实 DB 上**某一行的变更集读不出来**，但不动 schema：
 * 把 a.ts 的 `symbol_diffs.added` 写成**坏 JSON**。
 * ★ 为什么这样不会先被覆盖掉：a.ts 只「mtime 变、内容不变」⇒ `syncFile` 判 `skipped`（零变更早退，
 *   不重写 diff 行）；而它仍在 `pending` 里（`kind==='resync'`）⇒ 保鲜的"取变更集"那一格会读到这一行。
 * ★ 为什么另造 b.ts 变更：`dirty` 由**本轮真的更新过**的文件置位；取变更集那段在 `if (dirty)` 内。
 */
function corruptDiffColumn(db: Database, rel: string, column: 'added' | 'removed' | 'changed', raw: string): void {
  const fid = (db.prepare('SELECT id FROM files WHERE path = ?').get(rel) as { id: number }).id;
  // ★ 用 INSERT OR REPLACE 而不是 UPDATE：首次索引时**不一定**有 symbol_diffs 行（那次没有"上一份"可比），
  //   而 `UPDATE` 命中 0 行是**静默 no-op** ⇒ 夹具会假绿（0.4：脚本 replace 式静默 no-op 的同族坑）。
  db.prepare(
    `INSERT OR REPLACE INTO symbol_diffs (file_id, from_hash, to_hash, added, removed, changed, norm_from, norm_to, updated_at)
     VALUES (?, 'h-before', 'h-after', ?, '[]', '[]', '', '', 0)`,
  ).run(fid, column === 'added' ? raw : '[]');
  if (column !== 'added') {
    db.prepare(`UPDATE symbol_diffs SET ${column} = ? WHERE file_id = ?`).run(raw, fid);
  }
}

test('⑦ index_integrity · 变更集读不出 ⇒ 回执带 error + 人读输出点名 + blocker 档可鉴别（含「只有它时」的 summary）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  // 场景 B 另建一套 home/project（T-#SUMMARY-EMPTY-REASON）；统一在 finally 里清掉
  const homeB = makeTempHome();
  const projectB = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    const a = path.join(project, 'src', 'a.ts');
    const b = path.join(project, 'src', 'b.ts');
    fs.writeFileSync(a, 'export function a() { return 1; }\n', 'utf8');
    fs.writeFileSync(b, 'export function b() { return 1; }\n', 'utf8');
    await ensureFreshIndex(db, project);
    corruptDiffColumn(db, 'src/a.ts', 'added', '{"not":"an array"');
    // a.ts：只动 mtime（内容不变 ⇒ syncFile 判 skipped，不重写 diff 行），但它进了 pending
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(a, future, future);
    // b.ts：真变更（**等长**）⇒ 本轮 dirty=true。mtime 同样钉回索引记录值
    //   ⇒ 确定性落在同一时间戳格（去掉这行，本用例就退回"看机器快慢"的 flake）
    const pinnedB = new Date(Math.round(fs.statSync(b).mtimeMs));
    fs.writeFileSync(b, 'export function b() { return 2; }\n', 'utf8');
    fs.utimesSync(b, pinnedB, pinnedB);

    const r = await indexIntegrity({ project_dir: project, refresh: true });
    const receipt = r.refresh_receipt as { error?: string | null; resynced?: number } | undefined;
    assert.ok(receipt, '夹具无效：refresh:true 必须带回 refresh_receipt');
    assert.ok(
      (receipt.resynced ?? 0) > 0,
      `同一时间戳格内的等长改写必须被检出（stat 闸漏检）⇒ 索引会留旧内容 —— 实测 resynced=${receipt.resynced}`,
    );
    assert.ok(
      typeof receipt.error === 'string' && receipt.error.length > 0,
      `回执必须**搬运** error（改前 receiptOf 逐字段搬 checked/resynced/… 7 项、恰好漏掉 error ⇒ 读端拿不到）：${JSON.stringify(receipt)}`,
    );
    assert.match(String(receipt.error), /v_symbol_diffs/, `诊断要点名表：${receipt.error}`);
    assert.match(String(receipt.error), /src\/a\.ts/, `诊断要点名文件：${receipt.error}`);

    // ★ 0.12"有人看见"：人读输出里必须看得见，并且判定必须降级（blocking），而不是只在内部对象里
    const text = renderIntegrity(r);
    assert.match(text, /变更集读不出/, `人读输出必须点名「变更集读不出」：\n${text}`);
    // ★★ 0.14 鉴别力（T-#BLOCKER-NO-DISCRIMINATOR · 0.14 的自查问句：把这条腿打断，有没有用例会红？）
    //   这条断言**只认**「blocker 这一档」：`code` 与 `severity` 两件一起断 ⇒
    //   · 删掉 index_integrity.ts 里 push `changeset_unreadable` 那几行 ⇒ 无 issue ⇒ 红；
    //   · 把 severity 从 'blocker' 改成 'warn' ⇒ 这条 issue 仍在、但降了一档 ⇒ 也红（证明断的不是「存在」）；
    //   ★ 两条消融都真跑过（2026-11-03，读数见卡上 complete 的 evidence）。
    assert.ok(
      r.issues.some((i) => i.code === 'changeset_unreadable' && i.severity === 'blocker'),
      `必须是 **blocker 档**的 changeset_unreadable（删 push 段 / 把 severity 改成 warn ⇒ 这里红）：${JSON.stringify(r.issues)}`,
    );

    // ★ 端到端那一格：判定必须降级成 untrusted（0.12「有人看见」）。
    //   ★ 但它**是弱判据**：任何别的 blocker（`files_not_fresh` / `stale_resolved`…）也会让它红 ⇒
    //     它断的是「总判降级了」，不断「降级的原因是上面这条 push」—— 所以上面那条 code+severity 的断言才是鉴别器。
    //   ★ 实测更正（2026-11-03）：任务卡原推断「删掉 push 段后这条仍绿」**不成立** —— 因为本夹具这一轮 refresh
    //     收敛了（a.ts 内容没变 ⇒ `syncFile` 把 stat 写回库 ⇒ `files_not_fresh=0`），删 push 段后 verdict 反而变 trusted。
    assert.equal(r.verdict, 'untrusted', '读不出变更集 ⇒ 索引此刻不可信（不许照旧报 ✅ 可信）');

    // ── 场景 B（T-#SUMMARY-EMPTY-REASON）：**只有** `changeset_unreadable` 一条 blocker 时，
    //    summary 必须**说出原因**。改前它退化成「索引**不可信**：」—— 冒号后面是空的：
    //    原因清单只有 陈旧断言 / 未保鲜 / 幽灵行 三个值分支，而这条 blocker 不属任一分支。
    //    夹具要点：
    //      · a.ts **不碰**（stat 与库一致 ⇒ 不算「未保鲜」），它的坏 diff 行靠 `recordSelfWrite`
    //        塞进本轮 pending（不登记 ⇒ 保鲜按 stat 根本看不到它，读不到那行坏 JSON）；
    //      · b.ts 真变更 ⇒ 本轮 `dirty=true`（取变更集那段就在 `if (dirty)` 内）。
    //    ⇒ blocker 只剩 changeset_unreadable，summary 里「别的原因」全为 0 —— 这正是空冒号那一格。
    process.env.AGENT_IO_HOME = homeB;
    const dbB = getProjectCacheDb(projectB);
    const aB = path.join(projectB, 'src', 'a.ts');
    const bB = path.join(projectB, 'src', 'b.ts');
    fs.writeFileSync(aB, 'export function a() { return 1; }\n', 'utf8');
    fs.writeFileSync(bB, 'export function b() { return 1; }\n', 'utf8');
    await ensureFreshIndex(dbB, projectB);
    corruptDiffColumn(dbB, 'src/a.ts', 'added', '{"not":"an array"');
    recordSelfWrite(projectB, ['src/a.ts'], 'p0_change_set_truth ⑦·场景B：把它塞进本轮 pending，才能读到坏 diff 行');
    // ★ R17 racy-git：等长改写 + mtime 钉回索引记录值 ⇒ 确定性（否则「bB 有没有被检出」取决于机器快慢，
    //   而 bB 不被检出 ⇒ dirty=false ⇒ 走不到取变更集那一格 ⇒ 场景 B 也退化成 flake）
    const pinnedBB = new Date(Math.round(fs.statSync(bB).mtimeMs));
    fs.writeFileSync(bB, 'export function b() { return 2; }\n', 'utf8');
    fs.utimesSync(bB, pinnedBB, pinnedBB);

    const rB = await indexIntegrity({ project_dir: projectB, refresh: true });
    assert.deepEqual(
      rB.issues.filter((i) => i.severity === 'blocker').map((i) => i.code),
      ['changeset_unreadable'],
      `夹具无效：本场景必须**只有** changeset_unreadable 一条 blocker（否则测不到「空冒号」那一格）：${JSON.stringify(rB.issues)}`,
    );
    assert.match(
      rB.summary,
      /变更集读不出/,
      `只有这一条 blocker 时 summary 必须**点名原因**（改前实测 =「索引**不可信**：」冒号后空白）：${rB.summary}`,
    );
    assert.doesNotMatch(rB.summary, /不可信\*\*：\s*$/, `summary 不许以空冒号收尾：${rB.summary}`);
    // ★ 反重复断句（验收席实测的瑕疵）：`FreshnessReport.error` **自带**「变更集读不出（<文件>）：…」前缀，
    //   外层若再加一次 label ⇒ **同一句话说了两遍**。⇒ 文本口径统一走 `changesetDiagText`（一处）。
    assert.doesNotMatch(
      rB.summary,
      /变更集读不出：变更集读不出/,
      `同一个意思说了两遍（外层又加了 label）：${rB.summary}`,
    );
  } finally {
    rmRf(home);
    rmRf(project);
    rmRf(homeB);
    rmRf(projectB);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑧ 读端 2：`flushBatch` 的 `summary.error` 必须落到**人读出口**
//    （改前：`entry.error` 只由 `onError` 填，而 flushBatch 现在恰好不抛 ⇒ 0 出口）
// ════════════════════════════════════════════════════════════════════
test('⑧ flushBatch · 变更集读不出 ⇒ 诊断进 alert 收件箱（随下一次工具响应附带，改前无人读）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    clearAlertInbox();
    const db = getProjectCacheDb(project);
    const abs = path.join(project, 'src', 'a.ts');
    fs.writeFileSync(abs, 'export function a() { return 1; }\n', 'utf8');
    await syncFile(db, project, abs);
    fs.writeFileSync(abs, 'export function a() { return 2; }\nexport function b() { return 3; }\n', 'utf8');

    const summary = await flushBatch(dbWithBrokenDiffRead(db), project, ['src/a.ts']);
    assert.ok(summary.error, '夹具无效：本批必须拿到诊断（见用例④）');
    const lines = peekAlerts().map((a) => a.line).join(' | ');
    assert.match(
      lines,
      /变更集读不出（src\/a\.ts）/,
      `summary.error 必须有一条**人读出口**（改前 entry.error 只由 onError 填、flushBatch 又不抛 ⇒ 0 出口）：实测收件箱 = ${lines || '（空）'}`,
    );

    // ★ 0.16：同一条告警**不许重复推**（否则收件箱变噪音，下一次真事故也会被忽略）
    await flushBatch(dbWithBrokenDiffRead(db), project, ['src/a.ts']);
    const after = peekAlerts().filter((a) => a.line.startsWith('变更集读不出（src/a.ts）'));
    assert.equal(after.length, 1, `同一失败重复推了 ${after.length} 条（0.16：一条永远会亮的告警 = 一条被关掉的告警）：${JSON.stringify(after.map((a) => a.line))}`);
  } finally {
    clearAlertInbox();
    rmRf(home);
    rmRf(project);
  }
});

// ════════════════════════════════════════════════════════════════════
// ⑨ 0.16 反向守卫：**正常路径必须留绿** —— 健康的保鲜不许把 error 点亮
//    （否则 `index_integrity` 会永远 untrusted ⇒ 告警退化成背景噪音）
// ════════════════════════════════════════════════════════════════════
test('⑨ 0.16 · 健康保鲜 ⇒ 回执 error=null、无 changeset_unreadable、verdict 不因此降级', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    const a = path.join(project, 'src', 'a.ts');
    fs.writeFileSync(a, 'export function a() { return 1; }\n', 'utf8');
    await ensureFreshIndex(db, project);
    // 正常重同步（内容真变了、库是好的）
    fs.writeFileSync(a, 'export function a() { return 2; }\nexport function b() { return 3; }\n', 'utf8');

    const r = await indexIntegrity({ project_dir: project, refresh: true });
    const receipt = r.refresh_receipt as { error?: string | null; resynced?: number } | undefined;
    assert.ok(receipt, '夹具无效：refresh:true 必须带回 refresh_receipt');
    assert.ok((receipt.resynced ?? 0) > 0, `夹具无效：本轮没重同步过任何文件（resynced=${receipt.resynced}）`);
    assert.equal(receipt.error ?? null, null, `健康的保鲜必须留 error=null（否则这条灯一装上就常亮）：${JSON.stringify(receipt)}`);
    assert.equal(
      r.issues.filter((i) => i.code === 'changeset_unreadable').length,
      0,
      `正常路径不许点亮 blocker：${JSON.stringify(r.issues.filter((i) => i.code === 'changeset_unreadable'))}`,
    );
    assert.doesNotMatch(renderIntegrity(r), /变更集读不出/, '正常路径的人读输出里不许出现「变更集读不出」');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
