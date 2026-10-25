/**
 * P0 保鲜链 · 第 4 环：**claim 联动 index_integrity untrusted 提醒（不拒领）**。
 *
 * W0 实测的病：索引 untrusted（陈旧断言>0）时 find_references / impact 静默漏报，
 * 领卡人不知情。本证锁定：
 * ① 陈旧断言场景（resolved 行的目标名已不在 nodes）⇒ claim 回执含提醒行 + 机读 `index_trust`；
 * ② 无索引 / 无陈旧断言 ⇒ 无提醒；
 * ③ 判定复用 index_integrity 的三态函数（`integrityVerdict`），计数 SQL 唯一住处。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { claimTask } from '../src/application/design/dsl_ops/task_ops.js';
import {
  countStaleResolvedRefs,
  indexTrustReminderForClaim,
} from '../src/application/meta/integrity/index_integrity.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

function writeSheet(home: string, feature: string, sourceRoot: string): void {
  const dsl: DesignDSL = {
    feature,
    title: feature,
    source_root: sourceRoot,
    geometry: {
      nodes: [
        {
          id: 't1',
          label: '待领卡',
          type: 'service',
          x: 0,
          y: 0,
          task: { state: 'candidate' },
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

/** 构造"陈旧断言"：一条 status=resolved 的引用，其 reference_name 不在任何节点名里 */
function seedStaleAssertion(root: string): void {
  const db = getProjectCacheDb(root);
  db.prepare(
    'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at) VALUES (?,?,?,?,?,?)',
  ).run('src/a.ts', 'h', 'ts', 1, 0, 0);
  db.prepare(
    'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run('src/a.ts', 'file', 'a', 'a', 'src/a.ts', 'ts', 1, 1, 0);
  const fid = (db.prepare('SELECT id FROM files WHERE path = ?').get('src/a.ts') as { id: number }).id;
  db.prepare(
    "INSERT INTO unresolved_refs (from_node_id, reference_name, reference_kind, line, col, file_id, language, status, name_tail) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run('src/a.ts', 'ghost_fn_p0', 'call', 1, 1, fid, 'ts', 'resolved', '');
}

test('P0-4 · helper：无索引 ⇒ 空串；有陈旧断言 ⇒ untrusted 提醒（含条数与 refresh 指路）', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p04-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    // 无索引 ⇒ 查不了 ⇒ 不提醒
    assert.equal(indexTrustReminderForClaim(project), '');

    seedStaleAssertion(project);
    const db = getProjectCacheDb(project);
    assert.equal(countStaleResolvedRefs(db), 1);
    const reminder = indexTrustReminderForClaim(project);
    assert.match(reminder, /索引 untrusted（陈旧断言 1）/);
    assert.match(reminder, /index_integrity/);
    assert.match(reminder, /不拦领/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-4 · claim 回执：陈旧断言场景 ⇒ 回执含提醒（不拒领，领取照常成功）', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p04-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0claim', project);
    seedStaleAssertion(project);

    const r = await claimTask({ feature: 'p0claim', node_id: 't1', owner: 'agent:p0t' });
    // 领取本身成功（提醒不拦领）
    assert.match(r.message, /已领取任务 "t1"/);
    assert.match(r.message, /★ 提醒：索引 untrusted（陈旧断言 1）/);
    const data = r.data as { index_trust?: string };
    assert.match(String(data.index_trust ?? ''), /陈旧断言 1/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-4 · claim 回执：索引可信/无陈旧断言 ⇒ 无提醒行（不加噪声）', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p04-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0claim2', project);
    // 该项目根上没有任何索引 ⇒ helper 空串 ⇒ 回执不含提醒
    assert.equal(indexTrustReminderForClaim(project), '');

    const r = await claimTask({ feature: 'p0claim2', node_id: 't1', owner: 'agent:p0t' });
    assert.match(r.message, /已领取任务 "t1"/);
    assert.doesNotMatch(r.message, /陈旧断言/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
