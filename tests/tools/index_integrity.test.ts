/**
 * index_integrity 测试 —— 索引可信度自检（"现在读到的能不能当真"）
 *
 * 覆盖：
 *   - 没有索引 ⇒ state='empty' / trustworthy=false / issues 有 no_index
 *   - 健康索引 ⇒ trustworthy=true、stale_resolved=0
 *   - ★ **陈旧断言**（resolved 但目标符号已不在索引）⇒ blocker 级问题被查出
 *   - ★ `refresh:true` 顺手**修复**陈旧引用（重开 → 重解析 → 连不上明确标 failed）
 *   - 文件被外部改过 ⇒ not_fresh > 0（保鲜路径能看见的那类）
 *   - 待消费自写登记被计入报告
 */
import { DATA_DIR_NAME } from '../../src/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { importProject } from '../../src/infrastructure/graph/import_project.js';
import { openDb } from '../../src/infrastructure/index/db';
import { indexIntegrity, renderIntegrity, repairStaleResolvedRefs } from '../../src/application/meta/index_integrity.js';
import { recordSelfWrite } from '../../src/tools/write_gate';

const roots: string[] = [];

afterAll(() => {
  for (const r of roots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {
      // Windows 文件占用，留给 OS 清理
    }
  }
});

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/** 建项目 + 索引：service.ts 调 auth.login（形成一条 resolved 的跨文件引用） */
async function makeProject(tag: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `integrity-${tag}-`));
  roots.push(root);
  put(root, 'src/auth.ts', `export function login(user: string): boolean {\n  return user === 'admin';\n}\n`);
  put(root, 'src/service.ts', `import { login } from './auth';\nexport function handle(u: string): boolean {\n  return login(u);\n}\n`);
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  await importProject({ project_dir: root, feature: `integrity_${tag}`, cache_db: db });
  db.close();
  return root;
}

/** 把索引里 auth.login 的节点直接删掉（模拟"索引自身与磁盘脱节"）：
 *  FK ON DELETE CASCADE 会顺手删掉 service→login 的边，但 service 的 unresolved_refs 行仍是 resolved。 */
function corruptByDroppingNode(root: string, nodeId = 'src/auth.ts#login'): number {
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  const r = db.prepare('DELETE FROM nodes WHERE id = $id').run({ id: nodeId });
  db.close();
  return Number(r.changes ?? 0);
}

describe('index_integrity · 基本形态', () => {
  it('没有索引 ⇒ state=empty / 不可信 / 给出 no_index 建议', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-none-'));
    roots.push(root);
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const r = await indexIntegrity({ project_dir: root });
    expect(r.state).toBe('empty');
    expect(r.trustworthy).toBe(false);
    expect(r.issues.some((i) => i.code === 'no_index')).toBe(true);
    expect(r.summary).toContain('不可用');
  });

  it('健康索引 ⇒ trustworthy=true、陈旧断言 0', async () => {
    const root = await makeProject('ok');
    const r = await indexIntegrity({ project_dir: root });
    expect(r.refs.stale_resolved).toBe(0);
    expect(r.trustworthy).toBe(true);
    expect(r.counts.indexed_files).toBeGreaterThanOrEqual(2);
    expect(r.counts.nodes).toBeGreaterThan(0);
    expect(r.summary).toContain('索引可信');
    expect(renderIntegrity(r)).toContain('陈旧断言');
  });

  it('文件被外部改过（未保鲜）⇒ not_fresh 报出，且不可信', async () => {
    const root = await makeProject('stale');
    put(root, 'src/auth.ts', `export function login(user: string, level: number): boolean {\n  return user === 'admin' && level > 0;\n}\n`);
    const r = await indexIntegrity({ project_dir: root });
    expect(r.freshness.not_fresh).toBeGreaterThanOrEqual(1);
    expect(r.trustworthy).toBe(false);
    expect(r.issues.some((i) => i.code === 'files_not_fresh')).toBe(true);
    expect(r.freshness.not_fresh_sample).toContain('src/auth.ts');
  });

  it('待消费的自写登记被计入报告', async () => {
    const root = await makeProject('selfw');
    recordSelfWrite(root, ['src/auth.ts'], 'test');
    const r = await indexIntegrity({ project_dir: root });
    expect(r.freshness.self_writes_pending).toBeGreaterThanOrEqual(1);
    expect(r.issues.some((i) => i.code === 'self_writes_pending')).toBe(true);
  });
});

describe('★ 陈旧断言：最危险的静默漏报', () => {
  it('resolved 但目标符号已不在索引 ⇒ blocker 级问题 + 不可信', async () => {
    const root = await makeProject('stale-resolved');
    // 先确认基线：这条引用是 resolved 的
    const db0 = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    const before = db0
      .prepare("SELECT status FROM unresolved_refs WHERE from_node_id LIKE 'src/service.ts#%' AND reference_name = 'login'")
      .get() as { status: string } | undefined;
    expect(before?.status).toBe('resolved');
    db0.close();

    expect(corruptByDroppingNode(root)).toBe(1);

    const r = await indexIntegrity({ project_dir: root });
    expect(r.refs.stale_resolved).toBe(1);
    expect(r.trustworthy).toBe(false);
    const issue = r.issues.find((i) => i.code === 'stale_resolved_refs');
    expect(issue?.severity).toBe('blocker');
    expect(issue?.message).toContain('静默漏报');
    expect(r.summary).toContain('陈旧断言 1 条');
  });

  it('refresh:true 顺手修复：重开 → 重解析 → 明确标 failed（不再假装 resolved）', async () => {
    const root = await makeProject('repair');
    corruptByDroppingNode(root);

    const before = await indexIntegrity({ project_dir: root });
    expect(before.refs.stale_resolved).toBe(1);

    const after = await indexIntegrity({ project_dir: root, refresh: true });
    expect(after.refreshed).toBe(true);
    expect(after.refs.stale_resolved).toBe(0);
    expect(after.repair).toContain('重开');
    expect(after.issues.some((i) => i.code === 'stale_refs_repaired')).toBe(true);
    // 修完可信度恢复（此项目内容未变 ⇒ 新鲜度也是干净的）
    expect(after.trustworthy).toBe(true);

    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    const row = db
      .prepare("SELECT status FROM unresolved_refs WHERE from_node_id LIKE 'src/service.ts#%' AND reference_name = 'login'")
      .get() as { status: string } | undefined;
    expect(row?.status).toBe('failed'); // 连不上就明确判死
    db.close();
  });

  it('repairStaleResolvedRefs 无陈旧行时是空操作（幂等）', async () => {
    const root = await makeProject('noop');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    const r = repairStaleResolvedRefs(db, root);
    expect(r.names).toBe(0);
    expect(r.reopened).toBe(0);
    db.close();
  });
});
