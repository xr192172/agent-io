/**
 * P0 · **项目库连接生命周期：探测门/收尾显式 close + checkpoint，不留 -wal/-shm 残留**（#188）。
 *
 * ## 病（#188 锁争用归因实证）
 * 探测门（`mcp_scan`）父进程经 handler 只读支开了项目库（`hasLiveIndex → getProjectCacheDb`），
 * 此前收尾直接 `process.exit` **未 close** ⇒ 实测主文件 4096B + `-shm` 163840B + `-wal` ~77MB 残留。
 * 下一轮冷启走 WAL recovery / `-shm` 共享内存映射窗口，撞上持锁者即 `database is locked`（间歇瞬态）。
 *
 * ## 本证守两件事（每条都能证红，见各 case 的消融注释）
 * 1. **close 前 checkpoint**：`closeAllProjectCacheDbs()` 先 `wal_checkpoint(TRUNCATE)` 回写主库再 close，
 *    收尾后 `-wal` / `-shm` 被回收（不残留大 WAL 给下一轮冷启做恢复竞态）。
 * 2. **连接真正释放**：close 后重开新连接能立即 `BEGIN IMMEDIATE`（无残留句柄/事务占锁）。
 *
 * ## 消融（真消融）
 * · 去掉 `db.ts` `checkpointBeforeClose`（close 前不 checkpoint）⇒ 用例 ① 的 `-wal`/`-shm` 残留断言红。
 * · 收尾不调 `closeAllProjectCacheDbs()`（回到直接退出）⇒ 连接/句柄未释放，重开 `BEGIN IMMEDIATE`
 *   在 Windows 上可能撞残留句柄 ⇒ 用例 ② 红。
 * ★ 这是资源清理 wiring 修，**不是 retry 补丁**：治的是确定的"开了不关"，不是"撞锁再等"。
 *
 * ## 诚实边界
 * · 只用临时目录夹具 + 临时 `AGENT_IO_HOME`；不碰真数据仓。
 * · 不证明长事务占锁 5s 后不抛（那是 `busy_timeout` 的职责，见 db.ts 注释）；本证只守"收尾把连接清干净"。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureProjectIndex } from '../src/infrastructure/index/index_freshness.js';
import { closeAllProjectCacheDbs, getProjectCacheDb, projectCacheDbPath } from '../src/infrastructure/index/db.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

function makeProject(name: string): string {
  const proj = path.join(TMP, name);
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(proj, 'src', `l${i}.ts`), `export function l${i}(): number { return ${i}; }\n`);
  }
  return proj;
}

/** 项目库派生文件路径（与 `projectCacheDbPath(root)` 同口径，落项目本地 `.agent-io/cache.db`）。 */
function cacheFiles(proj: string): { db: string; wal: string; shm: string } {
  const db = projectCacheDbPath(proj);
  return { db, wal: `${db}-wal`, shm: `${db}-shm` };
}

test('① 冷启建索引后显式 close+checkpoint ⇒ -wal/-shm 回收，不留大 WAL 残留', async () => {
  const proj = makeProject('life-close');
  await ensureProjectIndex(proj, { bootstrap: true });
  const f = cacheFiles(proj);
  assert.ok(fs.existsSync(f.db), '前置：冷启后主库存在');

  closeAllProjectCacheDbs();

  // ★ 消融：去掉 checkpointBeforeClose ⇒ close 后 -wal/-shm 仍在（大 WAL 残留给下一轮冷启恢复竞态）。
  assert.ok(!fs.existsSync(f.wal), `①-a 收尾后 -wal 必须被 checkpoint 回收：实测存在 ${f.wal}`);
  assert.ok(!fs.existsSync(f.shm), `①-b 收尾后 -shm 必须被回收：实测存在 ${f.shm}`);
});

test('② close 后重开新连接可立即 BEGIN IMMEDIATE（无残留句柄/事务占锁）', async () => {
  const proj = makeProject('life-reopen');
  await ensureProjectIndex(proj, { bootstrap: true });
  closeAllProjectCacheDbs();

  // ★ 消融：不 close（连接/句柄留到进程退出）⇒ Windows 上重开可能撞残留句柄；这里要求新连接立即拿写锁。
  const db2 = getProjectCacheDb(proj);
  db2.exec('BEGIN IMMEDIATE');
  db2.exec('ROLLBACK');
  const tables = Number(
    (db2.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get() as { c: number }).c,
  );
  assert.ok(tables > 0, '重开连接可读 schema（20 张表量级）');
  closeAllProjectCacheDbs();
});
