/**
 * P1 · **S-A / S-4 · R4 根治把守**：增量刷新不得把可连的跨文件边刷回 pending。
 *
 * ## 判据（破坏哪一条都会红）
 *
 * ① **索引完整兜底捞回滞留 pending**：一轮全量解析后，把引用方行重置为滞留 pending（复现阶段 1
 *    实证：增量重扫置 pending、未变文件旧 pending 不被 scope 解析捞回）；随后批量增量收尾只把无关
 *    文件放进 scope，索引完整（keepPending=false）时第二趟全库兜底必须把这条可连边捞回 resolved。
 * ② **索引不完整保持 pending**：keepPending=true（局部/拼图索引）时不补全库、不判 failed，留 pending。
 * ③ **无滞留不跑第二趟**：干净全量后无 pending，兜底不触发（stranded=null），避免无谓全库遍历。
 *
 * ## 隔离
 * 每个用例自己的临时项目根 + AGENT_IO_HOME，跑完删；不碰真数据仓。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectCacheDb, closeProjectCacheDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db.js';
import { syncFileSync, resolveCrossFileCalls, resolveIncrementalBatch } from '../src/infrastructure/index/symbols.js';
import { prewarmKernel } from '../src/infrastructure/parse/kernel.js';

interface R4Fixture {
  root: string;
  db: ReturnType<typeof getProjectCacheDb>;
  refsFrom(rel: string): Array<{ name: string; status: string; resolved: string | null }>;
  strand(rel: string): void;
  cleanup(): void;
}

async function makeFixture(): Promise<R4Fixture> {
  await prewarmKernel();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-r4-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-r4-home-'));
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  write('src/b.ts', 'export function callee() { return 1; }\n');
  write('src/a.ts', "import { callee } from './b';\nexport function useIt() { return callee(); }\n");
  write('src/u.ts', 'export const u = 1;\n');
  const db = getProjectCacheDb(root);
  for (const rel of ['src/b.ts', 'src/a.ts', 'src/u.ts']) {
    const r = syncFileSync(db, root, path.join(root, rel));
    assert.notEqual(r.status, 'failed', `夹具同步失败：${rel} ⇒ ${r.error ?? ''}`);
  }
  resolveCrossFileCalls(db, root);
  return {
    root,
    db,
    refsFrom: (rel) =>
      (
        db
          .prepare(
            `SELECT reference_name AS name, status, resolved_node_id AS resolved FROM unresolved_refs WHERE from_node_id LIKE $p ORDER BY line`,
          )
          .all({ p: `${rel}#%` }) as Array<{ name: string; status: string; resolved: string | null }>
      ),
    // 复现滞留：把引用方行重置 pending（模拟增量重扫置 pending、旧 pending 未被捞回）。
    strand: (rel) =>
      db
        .prepare("UPDATE unresolved_refs SET status='pending', resolved_node_id=NULL, candidates=NULL WHERE from_node_id LIKE $p")
        .run({ p: `${rel}#%` }),
    cleanup: () => {
      closeProjectCacheDb(root);
      if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
      else process.env.AGENT_IO_HOME = prevHome;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// ① 索引完整：scope 外滞留 pending 被第二趟全库兜底捞回 resolved。
test('① R4 根治：索引完整时增量收尾兜底捞回 scope 外滞留 pending（边不回退）', async () => {
  const fx = await makeFixture();
  try {
    fx.strand('src/a.ts');
    const before = fx.refsFrom('src/a.ts');
    assert.equal(before.length, 1);
    assert.equal(before[0].status, 'pending', '夹具先复现滞留 pending');

    // 增量收尾：scope 只含无关文件 u.ts；索引完整 ⇒ 第二趟兜底。
    const batch = resolveIncrementalBatch(fx.db, fx.root, {
      scopeFiles: ['src/u.ts'],
      keepUnresolvedPending: false,
    });
    assert.ok(batch.stranded, '索引完整且有滞留 ⇒ 第二趟兜底必须跑（stranded 非 null）');
    const after = fx.refsFrom('src/a.ts');
    assert.equal(after.length, 1);
    assert.equal(after[0].status, 'resolved', '滞留跨文件边必须被兜底捞回 resolved，不得滞留 pending');
    assert.equal(after[0].resolved, 'src/b.ts#callee');
  } finally {
    fx.cleanup();
  }
});

// ② 索引不完整：滞留留 pending，不判 failed，也不跑全库兜底。
test('② R4 口径：索引不完整（keepPending）时滞留留 pending、不判 failed、不补全库', async () => {
  const fx = await makeFixture();
  try {
    fx.strand('src/a.ts');
    const batch = resolveIncrementalBatch(fx.db, fx.root, {
      scopeFiles: ['src/u.ts'],
      keepUnresolvedPending: true,
    });
    assert.equal(batch.stranded, null, '索引不完整 ⇒ 不跑全库兜底');
    const after = fx.refsFrom('src/a.ts');
    assert.equal(after[0].status, 'pending', '不完整阶段留 pending，不得误判 failed');
  } finally {
    fx.cleanup();
  }
});

// ③ 无滞留：兜底不触发（stranded=null），避免无谓全库遍历。
test('③ R4 口径：无滞留 pending 时第二趟不跑', async () => {
  const fx = await makeFixture();
  try {
    const pending = fx.db
      .prepare("SELECT COUNT(*) AS n FROM unresolved_refs WHERE status='pending' AND reference_kind IN ('call','type_ref')")
      .get() as { n: number };
    assert.equal(pending.n, 0, '干净全量后应无 pending');
    const batch = resolveIncrementalBatch(fx.db, fx.root, {
      scopeFiles: ['src/u.ts'],
      keepUnresolvedPending: false,
    });
    assert.equal(batch.stranded, null, '无滞留 ⇒ 不跑第二趟全库兜底');
  } finally {
    fx.cleanup();
  }
});

closeAllProjectCacheDbs();
