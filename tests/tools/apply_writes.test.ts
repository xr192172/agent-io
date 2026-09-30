/**
 * apply_writes 测试 —— 落盘内核（`applyWrites`）与它的第一个消费者
 *
 * 覆盖本笔（内化落盘内核）的**量化收益**，逐条对应：
 *   - `dryRun: true` ⇒ **完全不碰盘**，但回执结构不变（`written: []`）
 *   - 真写 ⇒ 有**写前快照**（撤回通道真的可用：`rollbackFileSnapshot` 能还原）
 *   - 有索引 ⇒ 逐文件**索引写穿**（`index_synced[].updated === true`）
 *   - 无索引 ⇒ `index.mode='skipped'` + `index_synced` 空，且**不凭空建库**
 *   - 根外文件 ⇒ `blocked` + `ok=false` + **不落盘**（不可撤回的东西不写）
 *   - 同文件多项 ⇒ 后者胜、只写一次
 *   - `renameLocals`（`scope='local'` 的 [B] 分支）：局部改名的落盘现在走内核 ⇒ 快照/索引同步**从无到有**
 */
import { DATA_DIR_NAME } from '../../src/infrastructure/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { importProject } from '../../src/infrastructure/graph/import_project.js';
import { openDb } from '../../src/infrastructure/index/db';
import { applyWrites } from '../../src/application/refactor/apply_writes.js';
import { rollbackFileSnapshot, listFileSnapshots } from '../../src/application/refactor/file_snapshot.js';
import { renameLocals } from '../../src/tools/rename_local';
import { hasLiveIndex } from '../../src/tools/write_gate';

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
function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}
function tmpRoot(tag: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aw-${tag}-`));
  roots.push(root);
  return root;
}

/** 建项目 + 建索引（必须建索引，才能验证"索引写穿"这一半） */
async function makeIndexed(tag: string, body: string): Promise<string> {
  const root = tmpRoot(tag);
  put(root, 'src/a.ts', body);
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  await importProject({ project_dir: root, feature: `aw_${tag}`, cache_db: db });
  db.close();
  return root;
}

const BODY = `export function f(): number {\n  const a = 1;\n  return a + a;\n}\n`;

describe('applyWrites · 干跑与真写', () => {
  it('dryRun=true ⇒ 完全不碰盘（内容不变、无快照目录），且回执结构不变', async () => {
    const root = tmpRoot('dry');
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const r = await applyWrites(root, [{ file: 'src/a.ts', content: 'export const a = 2;\n' }], { dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.written).toEqual([]);
    expect(r.snapshot_id).toBeUndefined();
    expect(r.index_synced).toEqual([]);
    expect(read(root, 'src/a.ts')).toBe('export const a = 1;\n');
    expect(listFileSnapshots(root)).toEqual([]); // 连快照都没建
  });

  it('真写 ⇒ 内容落盘 + 有快照 id；且该快照**真能撤回**（撤回通道可用）', async () => {
    const root = tmpRoot('write');
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const r = await applyWrites(root, [{ file: 'src/a.ts', content: 'export const a = 2;\n' }], {
      note: 'test:write',
    });
    expect(r.ok).toBe(true);
    expect(r.written).toEqual(['src/a.ts']);
    expect(r.snapshot_id).toBeTruthy();
    expect(read(root, 'src/a.ts')).toBe('export const a = 2;\n');

    const rb = rollbackFileSnapshot(root, r.snapshot_id);
    expect(rb.ok, rb.message).toBe(true);
    expect(read(root, 'src/a.ts')).toBe('export const a = 1;\n');
  });

  it('同一文件给两项 ⇒ 后者胜，且只写一次（written 只有一项）', async () => {
    const root = tmpRoot('dup');
    put(root, 'src/a.ts', 'export const a = 0;\n');
    const r = await applyWrites(
      root,
      [
        { file: 'src/a.ts', content: 'export const a = 1;\n' },
        { file: path.join(root, 'src', 'a.ts'), content: 'export const a = 2;\n' },
      ],
      { note: 'test:dup' },
    );
    expect(r.written).toEqual(['src/a.ts']);
    expect(read(root, 'src/a.ts')).toBe('export const a = 2;\n');
  });

  it('根外文件 ⇒ blocked + ok=false + **不落盘**（不可撤回的东西不写）', async () => {
    const root = tmpRoot('outside');
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const outside = path.join(root, '..', `aw-outside-${path.basename(root)}.ts`);
    const r = await applyWrites(root, [{ file: outside, content: 'export const evil = 1;\n' }], { note: 'test:outside' });
    expect(r.ok).toBe(false);
    expect(r.blocked).toEqual([outside]);
    expect(r.written).toEqual([]);
    expect(fs.existsSync(outside), '根外文件不该被写').toBe(false);
    expect(read(root, 'src/a.ts')).toBe('export const a = 1;\n');
  });
});

describe('applyWrites · 索引写穿（本笔补上的那一半）', () => {
  it('有索引 ⇒ 逐文件 updated=true（索引写穿真的跑了）', async () => {
    const root = await makeIndexed('idx', BODY);
    expect(hasLiveIndex(root)).toBe(true);
    const r = await applyWrites(root, [{ file: 'src/a.ts', content: BODY.replace('a + a', 'a + a + 0') }], {
      note: 'test:idx',
    });
    expect(r.index?.mode).toBe('synced');
    expect(r.index_synced).toEqual([{ file: 'src/a.ts', updated: true }]);
  });

  it('没有索引 ⇒ mode=skipped、index_synced 为空，且**不凭空建 cache.db**', async () => {
    const root = tmpRoot('noindex');
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const r = await applyWrites(root, [{ file: 'src/a.ts', content: 'export const a = 2;\n' }], { note: 'test:noindex' });
    expect(r.written).toEqual(['src/a.ts']);
    expect(r.index?.mode).toBe('skipped');
    expect(r.index_synced).toEqual([]);
    expect(hasLiveIndex(root)).toBe(false);
  });
});

describe("renameLocals · scope='local' 的落盘现在走内核", () => {
  it('真改：落盘 + 有快照（撤回通道）+ 索引已同步（此前这一支一样都没有）', async () => {
    const root = await makeIndexed('rm', BODY);

    const r = await renameLocals({ root, renames: [{ file: 'src/a.ts', symbol: 'a', to: 'count' }] });
    expect(r.ok).toBe(true);
    expect(r.items[0].ok, '该项应当改名成功').toBe(true);
    expect(r.items[0].changed, '声明 1 处 + 引用 2 处').toBe(3);
    expect(r.filesWritten).toBe(1);
    expect(r.snapshotId, 'scope=local 现在必须有写前快照（撤回通道）').toBeTruthy();
    expect(r.index?.mode, 'scope=local 现在必须做索引写穿').toBe('synced');
    expect(read(root, 'src/a.ts')).toContain('const count = 1;');
    expect(listFileSnapshots(root).length, '落盘前应恰好留下一份快照').toBe(1);
  });

  it('dry_run=true：算出结果但不落盘（工具面这次真的暴露了它）', async () => {
    const root = tmpRoot('rmdry');
    put(root, 'src/a.ts', BODY);

    const r = await renameLocals({ root, renames: [{ file: 'src/a.ts', symbol: 'a', to: 'count' }], dry_run: true });
    expect(r.dryRun).toBe(true);
    expect(r.filesWritten).toBe(0);
    expect(r.items[0].changed, '干跑仍应算出将改的替换点数').toBe(3);
    expect(r.changedFiles).toEqual([path.join(root, 'src/a.ts')]);
    expect(read(root, 'src/a.ts')).toBe(BODY);
    expect(listFileSnapshots(root), '干跑不该碰盘（连快照都不该有）').toEqual([]);
  });

  it('文件在 root 之外 ⇒ 整批拒绝落盘 + 逐项 ok 改口为 false（绝不静默"成功"）', async () => {
    const root = tmpRoot('rmoutside');
    const outside = path.join(root, '..', `aw-rm-outside-${path.basename(root)}.ts`);
    fs.writeFileSync(outside, BODY, 'utf-8');
    // 注意：不能把 outside 的父目录（那是系统临时目录）塞进 roots —— afterAll 会去删它。
    // 这个根外文件的清理在下面的 finally 里单独做。
    try {
      const r = await renameLocals({ root, renames: [{ file: outside, symbol: 'a', to: 'count' }] });
      expect(r.ok).toBe(false);
      expect(r.filesWritten).toBe(0);
      expect(r.blocked?.length, '根外文件必须报 blocked，否则调用方会误报"成功 N 项"').toBe(1);
      expect(r.blocked?.[0]).toContain(outside);
      expect(r.blocked?.[0]).toContain('在项目根之外');
      expect(r.items[0].ok, '整批未落盘 ⇒ 逐项必须改口（否则逐项的 ok 在撒谎）').toBe(false);
      expect((r.items[0].blocked ?? []).join(' ')).toContain('整批未落盘');
      expect(fs.readFileSync(outside, 'utf-8')).toBe(BODY); // 一个字节都没写
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
