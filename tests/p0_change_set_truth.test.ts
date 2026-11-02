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
    fs.writeFileSync(abs, 'export function a() { return 9; }\n', 'utf8'); // 造"重同步"

    const report = await ensureFreshIndex(dbWithBrokenDiffRead(db), project);
    assert.ok(report.resynced > 0, `夹具无效：本轮没有重同步（resynced=${report.resynced}）⇒ 走不到变更集那一格`);
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
