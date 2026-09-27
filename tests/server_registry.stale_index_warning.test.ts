/**
 * 索引陈旧告警（响应注入层）测试
 *
 * 为什么单测它：这是"不撒谎"不变量的**结构性兜底** —— 一次覆盖全部 60 个工具。
 * 但"注入型"逻辑最容易**静默失效**（永远返回空串也没人发现），所以必须被测试看见。
 *
 * 覆盖：
 *   - 无 `project_dir` 参数 ⇒ 静默（不误报）
 *   - 没有索引 ⇒ 静默
 *   - 索引与磁盘一致 ⇒ 静默
 *   - 索引落后于磁盘 ⇒ **报一次**，之后持续 stale 期间静默（防刷屏）
 *   - 恢复一致后再变旧 ⇒ 能**重新报**一次（状态机不能卡死）
 *   - 待消费自写登记 ⇒ 也算"陈旧"（同步工具那条链路的可见性）
 */
import { DATA_DIR_NAME } from '../src/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { importProject } from '../src/tools/import_project';
import { openDb } from '../src/db/db';
import { detectStaleIndex } from '../src/tools/index_freshness';
import { recordSelfWrite } from '../src/tools/write_gate';
import { staleIndexWarning, resetStaleIndexWarningCache } from '../src/server_registry';

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

async function makeIndexed(tag: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `staleidx-${tag}-`));
  roots.push(root);
  put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
  put(root, 'src/b.ts', 'export function beta(): number {\n  return 2;\n}\n');
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  await importProject({ project_dir: root, feature: `staleidx_${tag}`, cache_db: db });
  db.close();
  return root;
}

beforeEach(() => {
  resetStaleIndexWarningCache();
});

describe('detectStaleIndex（同步、只 stat）', () => {
  it('与磁盘一致 ⇒ stale=0；改一个文件 ⇒ stale≥1 且列出样例', async () => {
    const root = await makeIndexed('probe');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    const clean = detectStaleIndex(db, root);
    expect(clean.stale).toBe(0);
    expect(clean.total).toBeGreaterThanOrEqual(2);
    expect(clean.sampled).toBe(false);

    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 42;\n}\n');
    const dirty = detectStaleIndex(db, root);
    expect(dirty.stale).toBeGreaterThanOrEqual(1);
    expect(dirty.sample).toContain('src/a.ts');
    db.close();
  });

  it('待消费的自写登记被计入 selfWritesPending', async () => {
    const root = await makeIndexed('selfw');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    expect(detectStaleIndex(db, root).selfWritesPending).toBe(0);
    recordSelfWrite(root, ['src/a.ts'], 'test');
    expect(detectStaleIndex(db, root).selfWritesPending).toBe(1);
    db.close();
  });

  it('大仓保护：文件多时抽样（sampled=true），不是取前缀', async () => {
    const root = await makeIndexed('sample');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    const p = detectStaleIndex(db, root, { maxScan: 1 });
    expect(p.sampled).toBe(true);
    expect(p.total).toBeGreaterThanOrEqual(2);
    db.close();
  });
});

describe('staleIndexWarning（响应注入层）', () => {
  it('无 project_dir 参数 / 没有索引 ⇒ 静默（不误报）', async () => {
    expect(staleIndexWarning({})).toBe('');
    expect(staleIndexWarning({ query: 'x' })).toBe('');
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'staleidx-none-'));
    roots.push(bare);
    put(bare, 'src/a.ts', 'export const a = 1;\n');
    expect(staleIndexWarning({ project_dir: bare })).toBe('');
  });

  it('一致 ⇒ 静默；落后 ⇒ 报一次且含可执行建议；持续 stale 期间静默', async () => {
    const root = await makeIndexed('warn');
    expect(staleIndexWarning({ project_dir: root })).toBe('');

    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 9900;\n}\n');
    // ★ 必须清缓存：探测有 5s TTL（与 staleSourceWarning 同一约定），
    //   否则刚才那次"一致"的结果会被缓存复用到窗口之外 —— 这是**已知盲窗**，不是 bug。
    resetStaleIndexWarningCache();
    const w = staleIndexWarning({ project_dir: root });
    expect(w).toContain('STALE INDEX');
    expect(w).toContain('落后于磁盘');
    expect(w).toContain('refresh:true'); // 必须给可执行下一步
    // 防刷屏：持续 stale 期间不再重复
    expect(staleIndexWarning({ project_dir: root })).toBe('');
  });

  it('恢复一致后再变旧 ⇒ 能重新报一次（状态机不卡死）', async () => {
    const root = await makeIndexed('recover');
    // 首次：改旧 + 报一次（★ 改动要**改变文件大小**：本探测只比 size+mtime，
    //   等长改写落在同一毫秒时探测不到 —— 那是已知局限，内容 hash 归异步的 syncFile 管）
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 700;\n}\n');
    expect(staleIndexWarning({ project_dir: root })).toContain('STALE INDEX');
    // 用保鲜修好（importProject 全量重同步）
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    await importProject({ project_dir: root, feature: 'staleidx_recover2', cache_db: db });
    db.close();
    // 5s 缓存会挡住 → 清掉缓存模拟"下一轮"
    resetStaleIndexWarningCache();
    expect(staleIndexWarning({ project_dir: root })).toBe(''); // 已恢复一致 ⇒ 静默（并把状态置回 ok）
    // 再改旧一次，应该能重新报
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 8000;\n}\n');
    resetStaleIndexWarningCache();
    expect(staleIndexWarning({ project_dir: root })).toContain('STALE INDEX');
  });

  it('待消费自写登记也算陈旧（同步工具链路的可见性）', async () => {
    const root = await makeIndexed('warnselfw');
    recordSelfWrite(root, ['src/a.ts'], 'test');
    const w = staleIndexWarning({ project_dir: root });
    expect(w).toContain('STALE INDEX');
    expect(w).toContain('自写登记待同步');
  });
});
