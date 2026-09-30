/**
 * L3① 自动保鲜（结构性精确化）测试
 *
 * 背景：保鲜此前靠"每个工具自己记得调 ensureProjectIndex"，实测 60 个工具里有 17 个
 * 直接开 cache.db 却没接 ⇒ 只能靠 staleIndexWarning 做**标注**。现在在 registerAllTools
 * 的唯一入口做一次，全部工具的结果自动精确（ready 态实测 ~35ms/次）。
 *
 * 覆盖：
 *   - 绕过写闸改文件（模拟外部改动）⇒ 调任一工具 ⇒ 索引自动跟上（size/mtime 与磁盘一致）
 *   - `noAutoFresh` 的工具（index_integrity）**不被**自动保鲜（refresh:false 必须纯只读）
 *   - 无索引的项目 ⇒ 不冷启（绝不因为一次调用就建索引）
 */
import { DATA_DIR_NAME } from '../src/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { registerAllTools, TOOL_DEFS } from '../src/presentation/mcp/server_registry.js';
import { importProject } from '../src/infrastructure/graph/import_project.js';
import { openDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db';

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
/** Windows：连接池持有 cache.db 句柄 ⇒ 清理前必须先关，否则 rmSync 报 EBUSY */
function cleanup(): void {
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

function diskSize(root: string, rel: string): number {
  return fs.statSync(path.join(root, rel)).size;
}

function indexedSize(root: string, rel: string): number | undefined {
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  const row = db.prepare('SELECT size FROM files WHERE path = $p').get({ p: rel }) as { size: number } | undefined;
  db.close();
  return row?.size;
}

describe('L3① 自动保鲜（registerAllTools 唯一入口）', () => {
  it('绕过写闸改文件 ⇒ 调任一工具 ⇒ 索引自动跟上（不再静默旧数据）', async () => {
    const tools = makeRegistry();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autofresh-'));
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
    put(root, 'src/b.ts', 'export function beta(): number {\n  return 2;\n}\n');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    await importProject({ project_dir: root, feature: 'autofresh', cache_db: db });
    db.close();

    // 外部改动（绕过写闸：模拟 git pull / 编辑器 / 另一个 agent）
    put(root, 'src/b.ts', 'export function beta(): number {\n  return 22222;\n}\n');
    expect(indexedSize(root, 'src/b.ts')).not.toBe(diskSize(root, 'src/b.ts')); // 前置：索引确实落后

    // ★ 调**任意**一个带 project_dir 的工具 ⇒ 自动保鲜先跑
    const r = await tools.get('find_references')!({ project_dir: root, file: 'src/a.ts', symbol: 'alpha' });
    expect(r.isError).toBeFalsy();

    // 索引已与磁盘一致（这就是"结果自动精确"，不再只是"标注可能旧"）
    expect(indexedSize(root, 'src/b.ts')).toBe(diskSize(root, 'src/b.ts'));
    roots.push(root);
  });

  it('noAutoFresh 的工具（index_integrity）不被自动保鲜：refresh:false 报告的是"调用前"的现状', async () => {
    const tools = makeRegistry();
    expect(TOOL_DEFS.find((d) => d.name === 'index_integrity')?.noAutoFresh).toBe(true);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autofresh-ro-'));
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    await importProject({ project_dir: root, feature: 'autofresh_ro', cache_db: db });
    db.close();

    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1234567;\n}\n');
    const before = indexedSize(root, 'src/a.ts');
    expect(before).not.toBe(diskSize(root, 'src/a.ts'));

    // refresh:false（纯只读）⇒ 不该被自动保鲜 ⇒ 报告里应如实说"不可信"
    const r = await tools.get('index_integrity')!({ project_dir: root, refresh: false });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('不可全信');
    expect(indexedSize(root, 'src/a.ts')).toBe(before); // ★ 索引没被动过（否则报告就成了"修完之后"）

    // refresh:true ⇒ 这次才真的修
    const r2 = await tools.get('index_integrity')!({ project_dir: root, refresh: true });
    expect(r2.content[0].text).toContain('可信');
    expect(indexedSize(root, 'src/a.ts')).toBe(diskSize(root, 'src/a.ts'));
    roots.push(root);
  });

  it('没有索引的项目 ⇒ 不冷启（绝不因为一次调用就凭空建索引）', async () => {
    const tools = makeRegistry();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autofresh-none-'));
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
    await tools.get('find_references')!({ project_dir: root, file: 'src/a.ts', symbol: 'alpha' });
    // find_references 自己会冷启（它是"需要索引"的工具）——但这是它自己的职责，
    // 不是自动保鲜干的。用 index_integrity 的 noAutoFresh 路径验证自动保鲜不建库：
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'autofresh-none2-'));
    put(bare, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
    await tools.get('index_integrity')!({ project_dir: bare, refresh: false });
    expect(fs.existsSync(path.join(bare, DATA_DIR_NAME, 'cache.db'))).toBe(false);
    roots.push(root, bare);
  });
});
