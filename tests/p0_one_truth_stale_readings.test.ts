/**
 * ★ 鉴别力判据（2026-11-01）：**同一份 cache.db 上，两处「陈旧断言」读数必须相等**。
 *
 * 病（外审实测，同一次会话里两个工具互相打架）：
 *   `index_integrity` 报「陈旧断言 0」，`find_references` 的 ⚠️ TRUST 报「18 条」
 *   —— 同一件事两个读数互斥 = `ONE-AUTHORITY` 在「读数」这一层自己破了。
 * 根因是两把尺：
 *   · 唯一实现 `countStaleResolvedRefs`（schema v17）：判 `resolved_node_id` **是否还在 nodes**；
 *   · `trustNoteFor` 自己拼了老 SQL：拿 `reference_name` 比 `nodes.name`。
 *   老口径对**import 别名**（`import { applyMatch as applyOneMatch }`）与**成员调用**
 *   （`reference_name = 'recv.method'`）必然假阳性 —— `nodes.name` 存的永远只是裸名。
 *
 * ★ 为什么必须新开一条判据：既有的 `p0_claim_index_trust.test.ts` 只插 `resolved_node_id IS NULL`
 *   的行，**两种口径都会算成陈旧** ⇒ **不具鉴别力**，挡不住「以后有人把口径改回名字」。
 *   本文件两个用例构造「两口径读数不同」的夹具，并在**同一次构造里断言两处读数相等**：
 *     · 正例（真陈旧）：目标节点已不在 ⇒ 两处都 = 1；
 *     · 反例（假阳性，关键）：别名行 + 成员调用行，目标节点都在 ⇒ 两处都 = 0
 *       （名字口径会报 2 ⇒ 反例红 ⇒ 这就是本判据的鉴别力）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { countStaleResolvedRefs } from '../src/application/meta/integrity/index_integrity.js';
import { trustNoteFor } from '../src/presentation/mcp/server_registry.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 建最小索引：一个 files 行（`hasLiveIndex` 要求 files>0）+ 一个 file 节点（供 FK 用） */
function seedIndex(root: string): number {
  const db = getProjectCacheDb(root);
  db.prepare(
    'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at) VALUES (?,?,?,?,?,?)',
  ).run('src/a.ts', 'h', 'ts', 1, 0, 0);
  const fid = (db.prepare('SELECT id FROM files WHERE path = ?').get('src/a.ts') as { id: number }).id;
  db.prepare(
    'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run('src/a.ts', 'file', 'a', 'a', 'src/a.ts', 'ts', 1, 1, 0);
  return fid;
}

/** 加一个**真实存在**的节点（供 resolved_node_id 指向） */
function addNode(root: string, id: string, name: string, qn: string): void {
  const db = getProjectCacheDb(root);
  db.prepare(
    'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(id, 'method', name, qn, 'src/b.ts', 'ts', 1, 1, 0);
}

/** 插一条 `status='resolved'` 的引用（resolved_node_id 由调用方决定：真 id / 已删 id / NULL） */
function addResolvedRef(
  root: string,
  fileId: number,
  name: string,
  kind: string,
  resolvedNodeId: string | null,
): void {
  const db = getProjectCacheDb(root);
  db.prepare(
    'INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, file_id, language, status, name_tail, resolved_node_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run('src/a.ts', name, kind, 1, 1, fileId, 'ts', 'resolved', '', resolvedNodeId);
}

/** 读数①：`index_integrity` 的尺（唯一实现） */
function staleFromIntegrity(root: string): number {
  return countStaleResolvedRefs(getProjectCacheDb(root));
}

/** 读数②：`find_references` 的 ⚠️ TRUST 附注（只从**文案**里取数，不另算） */
function staleFromFindReferences(root: string): number {
  const note = trustNoteFor(root);
  if (!note) return 0;
  const m = note.match(/符号索引内有 (\d+) 条/);
  assert.ok(
    m,
    '⚠️ TRUST 附注的文案变了：本判据（以及下游按这句匹配的通道）靠「符号索引内有 N 条」取数，' +
      `实测文案 = ${JSON.stringify(note)}`,
  );
  return Number(m[1]);
}

/** 夹具前提自检：**只按名字**数会得几 —— 保证「本用例确实能区分两种口径」 */
function nameOnlyCount(root: string): number {
  const db = getProjectCacheDb(root);
  const row = db
    .prepare(
      `SELECT COUNT(*) c FROM unresolved_refs u
       WHERE u.status = 'resolved'
         AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)`,
    )
    .get() as { c: number } | undefined;
  return row?.c ?? 0;
}

test('★ 陈旧读数一致 · 正例（真陈旧）：resolved 但目标节点已不在 ⇒ 两处都 = 1', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-onetruth-'));
  try {
    process.env.AGENT_IO_HOME = home;
    const fid = seedIndex(project);
    // 真陈旧：resolved_node_id 指向一个**已不存在**的节点 id（节点被删 / 文件下线后残留的断言）
    addResolvedRef(project, fid, 'ghost_fn', 'call', 'src/gone.ts#ghost_fn');

    const fromIntegrity = staleFromIntegrity(project);
    const fromFindRefs = staleFromFindReferences(project);

    assert.equal(fromIntegrity, 1, 'index_integrity 这把尺必须报 1');
    assert.equal(fromFindRefs, 1, 'find_references 附注必须报 1（同一件事同一个数）');
    assert.equal(fromFindRefs, fromIntegrity, '同一 cache.db 上两处读数必须相等');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('★ 陈旧读数一致 · 反例（假阳性）：import 别名 + 成员调用，目标节点都在 ⇒ 两处都必须 = 0', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-onetruth-'));
  try {
    process.env.AGENT_IO_HOME = home;
    const fid = seedIndex(project);
    // 目标节点**真实存在** ⇒ 这两条引用一条都不陈旧
    addNode(project, 'src/b.ts#applyMatch', 'applyMatch', 'applyMatch');
    addNode(project, 'src/b.ts#Registry.register', 'register', 'Registry.register');
    // ① import 别名：`import { applyMatch as applyOneMatch }` —— reference_name 是**别名**，
    //    而 nodes.name 里存的是原名的裸名 ⇒ 按名字比必然「找不到」
    addResolvedRef(project, fid, 'applyOneMatch', 'call', 'src/b.ts#applyMatch');
    // ② 成员调用：reference_name = 「接收者变量名.方法」，nodes.name 只有裸方法名 ⇒ 同样必然「找不到」
    addResolvedRef(project, fid, 'reg.register', 'call', 'src/b.ts#Registry.register');

    // ★ 夹具前提：老口径（只按名字比）在这份数据上**必须**报 2 —— 否则本用例不具鉴别力（形同虚设）
    assert.equal(nameOnlyCount(project), 2, '夹具前提：名字口径必须报 2，本用例才真的能挡住「口径改回名字」');

    const fromIntegrity = staleFromIntegrity(project);
    const fromFindRefs = staleFromFindReferences(project);

    assert.equal(fromIntegrity, 0, 'id 口径：resolved_node_id 都指向存在的节点 ⇒ 不陈旧');
    assert.equal(fromFindRefs, 0, '★ 附注必须是 0（回到名字口径 ⇒ 这里会变成 2 ⇒ 本判据红）');
    assert.equal(fromFindRefs, fromIntegrity, '同一 cache.db 上两处读数必须相等');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
