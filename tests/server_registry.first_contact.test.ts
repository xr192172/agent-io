/**
 * 首次接触 ⇒ 后台建索引 测试
 *
 * 背景（2026-09-15，用户拍板）："白跑一轮索引实际上对于 LLM 来说是免费的，
 * 只是机器后台跑一轮任务。" 此前索引只能从"第一次读"开始建（explore_code 拼图 +
 * 后台续建）——"工作区创建"没有钩子。现在 registerAllTools 唯一入口：
 * 任何带 project_root 的调用，若该项目还没有索引 ⇒ 顺手 scheduleBackfill
 * （后台分小批、可中断、不阻塞本次调用），并**诚实标注**"本轮结果可能不全"
 * （空缺型不全 —— staleIndexWarning 只覆盖"有索引但落后于磁盘"，覆盖不了"还没建完"）。
 *
 * 覆盖：
 *   - 无索引项目 + 普通读工具 ⇒ 响应带"后台建索引进行中"标注，cache.db 已建
 *   - 后台真的把索引补完（对 LLM 免费的那部分要**真的发生**）
 *   - 建索引进行中，后续调用持续标注（不静默）
 *   - `AGENT_IO_AUTO_BACKFILL=0` ⇒ 不起后台、不建库、不标注（kill-switch）
 *   - 幻觉路径（不存在的目录）⇒ 不建库、不崩
 *   - `noAutoFresh` 工具不触发 ⇒ 由 tests/server_registry.auto_fresh.test.ts
 *     第 3 项覆盖（index_integrity 于无索引项目不建库），此处不重复。
 */
import { DATA_DIR_NAME } from '../src/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { registerAllTools, firstContactBackfill } from '../src/server_registry';
import { openDb, closeAllProjectCacheDbs } from '../src/db/db';
import { stopBackfill, backfillState } from '../src/tools/index_backfill';

type Cb = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

function makeRegistry(): Map<string, Cb> {
  const captured = new Map<string, Cb>();
  registerAllTools({
    registerTool: (name: string, _cfg: unknown, cb: Cb) => {
      captured.set(name, cb);
    },
  } as never);
  return captured;
}

const roots: string[] = [];

afterAll(cleanup);
/** Windows：连接池持有 cache.db 句柄 ⇒ 清理前先停后台循环、再关池，否则 rmSync 报 EBUSY */
function cleanup(): void {
  for (const r of roots) stopBackfill(r);
  closeAllProjectCacheDbs();
  for (const r of roots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {
      /* 句柄未释放留给 OS */
    }
  }
}

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function makeRepo(prefix: string, fileCount: number): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  for (let i = 0; i < fileCount; i++) {
    put(root, `src/m${i}.ts`, `export function fn${i}(): number {\n  return ${i};\n}\n`);
  }
  return root;
}

async function until(cond: () => boolean, timeoutMs = 15000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('等待后台续建完成超时');
    await new Promise((r) => setTimeout(r, 100));
  }
}

function indexedCount(root: string): number {
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  const row = db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number };
  db.close();
  return row.c;
}

describe('首次接触 ⇒ 后台建索引（registerAllTools 唯一入口）', () => {
  it('无索引项目 + 普通读工具 ⇒ 响应带"后台建索引进行中"标注，且不阻塞本次调用', async () => {
    const tools = makeRegistry();
    const root = makeRepo('fc-entry-', 2);
    const r = await tools.get('find_references')!({ project_dir: root, file: 'src/m0.ts', symbol: 'fn0' });
    expect(r.isError).toBeFalsy();
    // 诚实标注：建索引进行中（首次接触刚起后台 ⇒ "刚启动"）
    expect(r.content[0].text).toContain('后台建索引进行中');
    expect(r.content[0].text).toContain('可能不全');
    // 库已被后台首接触建出来
    expect(fs.existsSync(path.join(root, DATA_DIR_NAME, 'cache.db'))).toBe(true);
  });

  it('后台真的把索引补完（"对 LLM 免费"的那部分要真的发生）', async () => {
    const root = makeRepo('fc-done-', 30); // 30 文件 = batch 20 × 2 批
    const note = firstContactBackfill(root);
    expect(note).toContain('后台建索引进行中');

    // 不阻塞：scheduleBackfill 同步返回（此刻还没同步任何文件，total 尚未统计）
    expect(backfillState(root)?.running).toBe(true);

    await until(() => backfillState(root)?.running === false);
    expect(indexedCount(root)).toBe(30);
  });

  it('建索引进行中，后续调用持续标注（不静默；同一 tick 内两次调用必都在建中）', () => {
    const root = makeRepo('fc-note-', 3);
    const n1 = firstContactBackfill(root);
    expect(n1).toContain('后台建索引进行中');
    const n2 = firstContactBackfill(root);
    expect(n2).toContain('后台建索引进行中');
  });

  it('AGENT_IO_AUTO_BACKFILL=0 ⇒ 不起后台、不建库、不标注（kill-switch）', () => {
    const prev = process.env.AGENT_IO_AUTO_BACKFILL;
    process.env.AGENT_IO_AUTO_BACKFILL = '0';
    try {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-off-'));
      roots.push(root);
      put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
      const note = firstContactBackfill(root);
      expect(note).toBe('');
      expect(fs.existsSync(path.join(root, DATA_DIR_NAME, 'cache.db'))).toBe(false);
      expect(backfillState(root)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.AGENT_IO_AUTO_BACKFILL;
      else process.env.AGENT_IO_AUTO_BACKFILL = prev;
    }
  });

  it('幻觉路径（不存在的目录）⇒ 不建库、不崩、返回空串', () => {
    const ghost = path.join(os.tmpdir(), 'fc-ghost-' + Date.now());
    roots.push(ghost); // 不会被创建；stopBackfill 幂等无害
    expect(firstContactBackfill(ghost)).toBe('');
    expect(fs.existsSync(path.join(ghost, DATA_DIR_NAME, 'cache.db'))).toBe(false);
  });
});
