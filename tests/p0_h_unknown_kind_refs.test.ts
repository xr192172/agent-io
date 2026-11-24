/**
 * P0 · H 批 D1：未知 kind / 坏行全局分叉点名（边对账 remit 之外的非标准行必须显形，不静默排除）。
 *
 * ## 它钉的是什么
 * 现役写端只发 `call` / `type_ref` 进 `unresolved_refs`；`mapper_statement` 进 `edges` 表。
 * 此前 scoped 与全扫对账都只审 call/type_ref，全局门也不审未知 `reference_kind` 分布 ⇒
 * 落进来的非标准 kind（`weird_kind` / `mapper_statement` 误入 / …）两侧都不点名、不入对账。
 *
 * 本文件对纯函数 `countUnknownKindResolvedRefs` / `listUnknownKindResolvedRefs` 钉住：
 * · 只数 `status='resolved'` 且 kind 不在白名单（call/type_ref）的行；
 * · failed / pending / 已知 kind / 指向存在节点的常规行 ⇒ 不计；
 * · 名单带 `file:line` + 名字 + kind，可行动。
 *
 * 夹具在临时 home + 临时工程内存态，不写真册 DB。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  countUnknownKindResolvedRefs,
  listUnknownKindResolvedRefs,
} from '../src/application/meta/integrity/index_integrity.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 建最小索引：一个 files 行 + 一个 file 节点（供 FK 用）。 */
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

function addNode(root: string, id: string, name: string, qn: string): void {
  getProjectCacheDb(root)
    .prepare(
      'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .run(id, 'method', name, qn, 'src/b.ts', 'ts', 1, 1, 0);
}

/** 插一条引用；status / kind / resolved_node_id 由调用方定。 */
function addRef(
  root: string,
  fileId: number,
  name: string,
  kind: string,
  status: string,
  resolvedNodeId: string | null,
  line = 1,
): void {
  getProjectCacheDb(root)
    .prepare(
      'INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, file_id, language, status, name_tail, resolved_node_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run('src/a.ts', name, kind, line, 1, fileId, 'ts', status, '', resolvedNodeId);
}

test('D1 · 已知 kind（call/type_ref）resolved 指向存在节点 ⇒ unknown_kind=0，名单空', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-h-unk-'));
  try {
    process.env.AGENT_IO_HOME = home;
    const fid = seedIndex(project);
    addNode(project, 'src/b.ts#callee', 'callee', 'callee');
    addRef(project, fid, 'callee', 'call', 'resolved', 'src/b.ts#callee');
    addRef(project, fid, 'Registry', 'type_ref', 'resolved', 'src/b.ts#callee');

    assert.equal(countUnknownKindResolvedRefs(getProjectCacheDb(project)), 0);
    assert.deepEqual(listUnknownKindResolvedRefs(getProjectCacheDb(project)), []);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('D1 · 非标准 kind resolved（weird_kind / mapper_statement 误入）⇒ 计数 + 名单按 kind 点名 file:line', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-h-unk-'));
  try {
    process.env.AGENT_IO_HOME = home;
    const fid = seedIndex(project);
    addNode(project, 'src/b.ts#callee', 'callee', 'callee');
    addRef(project, fid, 'ghostShape', 'weird_kind', 'resolved', 'src/b.ts#callee', 3);
    addRef(project, fid, 'mapperStmt', 'mapper_statement', 'resolved', 'src/b.ts#callee', 7);

    const db = getProjectCacheDb(project);
    assert.equal(countUnknownKindResolvedRefs(db), 2);
    const list = listUnknownKindResolvedRefs(db, 20);
    assert.equal(list.length, 2);
    const kinds = list.map((r) => r.kind).sort();
    assert.deepEqual(kinds, ['mapper_statement', 'weird_kind']);
    for (const r of list) {
      assert.ok(r.file.includes('src/a.ts'), `名单必须带 file：${JSON.stringify(r)}`);
      assert.ok(r.line > 0, '名单必须带 line');
      assert.ok(r.name.length > 0, '名单必须带 reference_name');
    }
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('D1 · 未知 kind 但 failed/pending ⇒ 不计入 unknown_kind（只审 resolved 坏行）', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-h-unk-'));
  try {
    process.env.AGENT_IO_HOME = home;
    const fid = seedIndex(project);
    addRef(project, fid, 'x', 'weird_kind', 'failed', null);
    addRef(project, fid, 'y', 'weird_kind', 'pending', null);

    assert.equal(countUnknownKindResolvedRefs(getProjectCacheDb(project)), 0);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('D1 · NULL-resolved / 幽灵目标归 stale_resolved 口径，不重复计入 unknown_kind', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-h-unk-'));
  try {
    process.env.AGENT_IO_HOME = home;
    const fid = seedIndex(project);
    // ③ resolved 但 resolved_node_id IS NULL；④ resolved → 已删幽灵节点（常规 call kind）
    addRef(project, fid, 'nullRef', 'call', 'resolved', null);
    addRef(project, fid, 'ghostRef', 'call', 'resolved', 'src/gone.ts#nobody');

    // 这两类由 stale_resolved 分叉覆盖；unknown_kind 只审 kind 白名单，常规 call 不计入
    assert.equal(countUnknownKindResolvedRefs(getProjectCacheDb(project)), 0);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
