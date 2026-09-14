/**
 * write_gate 测试 —— 「我们自己改的，我们自己登记」
 *
 * 覆盖：
 *   - `hasLiveIndex`：没有 cache.db / 空库 ⇒ false（**不因为一次编辑就凭空建索引**）
 *   - `recordSelfWrite` / `pendingSelfWrites`：登记、去重、TTL 过滤、多条目
 *   - `writeSourceFiles`：无索引 ⇒ `mode='skipped'` 且**不建库**；有索引 ⇒ 写穿 + 重开引用方 + 快照
 *   - `snapshotAndRecordSelfWrite`：同步工具路径 ⇒ `mode='deferred'` + 登记可见
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { importProject } from '../../src/tools/import_project';
import { openDb } from '../../src/db/db';
import {
  hasLiveIndex,
  projectCacheDbPath,
  recordSelfWrite,
  pendingSelfWrites,
  writeSourceFiles,
  snapshotAndRecordSelfWrite,
  writeThroughLine,
  toRelPosix,
} from '../../src/tools/write_gate';

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

function tmpRoot(tag: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wgate-${tag}-`));
  roots.push(root);
  return root;
}

/** 建项目 + 建索引（无索引 → 返回 null） */
async function makeIndexed(tag: string, authBody = `export function login(user: string): boolean {\n  return user === 'admin';\n}\n`) {
  const root = tmpRoot(tag);
  put(root, 'src/auth.ts', authBody);
  const db = openDb(path.join(root, '.design-canvas', 'cache.db'));
  await importProject({ project_dir: root, feature: `wgate_${tag}`, cache_db: db });
  db.close();
  return root;
}

/** 某文件里某引用名的状态 */
function refStatus(db: ReturnType<typeof openDb>, fileRel: string, name: string): string | undefined {
  return (
    db
      .prepare('SELECT status FROM unresolved_refs WHERE from_node_id LIKE $f AND reference_name = $n')
      .get({ f: `${fileRel}#%`, n: name }) as { status: string } | undefined
  )?.status;
}

describe('路径与索引存在性', () => {
  it('toRelPosix 归一化 + 根外返回 null', () => {
    const root = tmpRoot('relp');
    expect(toRelPosix(root, path.join(root, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(toRelPosix(root, 'src\\a.ts')).toBe('src/a.ts');
    expect(toRelPosix(root, path.join(root, '..', 'outside.ts'))).toBeNull();
  });

  it('没有 cache.db ⇒ hasLiveIndex 为 false（不因为一次编辑就凭空建索引）', () => {
    const root = tmpRoot('noindex');
    put(root, 'src/a.ts', 'export const a = 1;\n');
    expect(hasLiveIndex(root)).toBe(false);
  });
});

describe('recordSelfWrite / pendingSelfWrites（L1b）', () => {
  it('登记可读出、去重、跨多条累积', () => {
    const root = tmpRoot('selfw');
    expect(pendingSelfWrites(root)).toEqual([]);
    expect(recordSelfWrite(root, ['src/a.ts', 'src/a.ts'], 'note-1')).toBe(1);
    recordSelfWrite(root, ['src/b.ts'], 'note-2');
    expect(pendingSelfWrites(root).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    const raw = JSON.parse(fs.readFileSync(path.join(root, '.design-canvas', 'self-writes.json'), 'utf-8'));
    expect(raw.writes.length).toBe(2);
    expect(raw.writes[0].note).toBe('note-1');
  });

  it('超过 TTL 的条目不再返回（maxAgeMs 可调，便于测试）', () => {
    const root = tmpRoot('selfttl');
    recordSelfWrite(root, ['src/a.ts']);
    expect(pendingSelfWrites(root).length).toBe(1);
    // 用 maxAgeMs=-1 强制"所有条目都过期"，避免测试里 sleep
    expect(pendingSelfWrites(root, { maxAgeMs: -1 }).length).toBe(0);
  });

  it('空列表 / 根外路径 ⇒ 不登记（不写空文件）', () => {
    const root = tmpRoot('selfempty');
    expect(recordSelfWrite(root, [])).toBe(0);
    expect(recordSelfWrite(root, [path.join(root, '..', 'x.ts')])).toBe(0);
    expect(fs.existsSync(path.join(root, '.design-canvas', 'self-writes.json'))).toBe(false);
  });
});

describe('writeSourceFiles（L1a 统一写入闸）', () => {
  it('没有索引 ⇒ 只真写、mode=skipped，且**不创建** cache.db', async () => {
    const root = tmpRoot('wgnoindex');
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const r = await writeSourceFiles(root, ['src/a.ts'], () => {
      put(root, 'src/a.ts', 'export const a = 2;\n');
    });
    expect(r.value).toBeUndefined();
    expect(r.report.index?.mode).toBe('skipped');
    expect(fs.readFileSync(path.join(root, 'src/a.ts'), 'utf-8')).toContain('a = 2');
    // ★ 关键：一次编辑不该凭空造出索引
    expect(fs.existsSync(projectCacheDbPath(root))).toBe(false);
  });

  it('有索引 ⇒ 写穿 + 重开引用方（被改符号的引用方边不再静默消失）+ 写前快照', async () => {
    const root = await makeIndexed('wgsync');
    put(root, 'src/service.ts', `import { login } from './auth';\nexport function handle(u: string): boolean {\n  return login(u);\n}\n`);
    // 先把 service 引用 auth.login 解析成跨文件边
    const db = openDb(path.join(root, '.design-canvas', 'cache.db'));
    await db.prepare('SELECT 1 AS x').get();
    await importProject({ project_dir: root, feature: 'wgsync2', cache_db: db });
    expect(refStatus(db, 'src/service.ts', 'login')).toBe('resolved');
    db.close();

    // 经写入闸把 login 改名（模拟"我们自己的工具改的"）
    const r = await writeSourceFiles(root, ['src/auth.ts'], () => {
      put(root, 'src/auth.ts', `export function signIn(user: string): boolean {\n  return user === 'admin';\n}\n`);
    }, { label: 'test: rename login→signIn' });

    expect(r.report.index?.mode).toBe('synced');
    expect(r.report.index?.synced).toBeGreaterThanOrEqual(1);
    // ★ 引用方被重开并重解析（否则旧边被 FK 级联删掉后不会重建 ⇒ 静默漏报）
    expect(r.report.index?.refsReopened).toBeGreaterThanOrEqual(1);
    expect(r.report.index?.ms).toBeGreaterThanOrEqual(0);
    expect(r.report.snapshot?.id).toBeTruthy();
    expect(r.report.touched).toEqual(['src/auth.ts']);

    // 连不上就明确标 failed（而不是维持"已解析"的假象）
    const db2 = openDb(path.join(root, '.design-canvas', 'cache.db'));
    expect(refStatus(db2, 'src/service.ts', 'login')).toBe('failed');
    db2.close();
  });

  it('mutate 里 push 的文件也算进写穿范围（写前不可知的情况）', async () => {
    const root = await makeIndexed('wgpush');
    const extra = path.join(root, 'src', 'late.ts');
    const files: string[] = ['src/auth.ts'];
    const r = await writeSourceFiles(root, files, () => {
      put(root, 'src/late.ts', 'export const late = 1;\n');
      files.push(extra); // 写的时候才发现
    });
    expect(r.report.touched).toContain('src/late.ts');
    expect(r.report.index?.synced).toBeGreaterThanOrEqual(1);
  });
});

describe('snapshotAndRecordSelfWrite（同步工具路径）', () => {
  it('有索引 ⇒ mode=deferred 且登记可见（读路径会优先消费）；无索引 ⇒ skipped', async () => {
    const root = await makeIndexed('wgsyncapi');
    const r = snapshotAndRecordSelfWrite(root, ['src/auth.ts'], { label: 'test: deferred' });
    expect(r.mode).toBe('deferred');
    expect(pendingSelfWrites(root)).toContain('src/auth.ts');
    // 快照已建
    const snaps = fs.readdirSync(path.join(root, '.design-canvas', 'code-snapshots'));
    expect(snaps.length).toBeGreaterThan(0);
    expect(writeThroughLine(r)).toContain('已登记待同步');

    const bare = tmpRoot('wgdefernoindex');
    put(bare, 'src/a.ts', 'export const a = 1;\n');
    expect(snapshotAndRecordSelfWrite(bare, ['src/a.ts']).mode).toBe('skipped');
  });
});
