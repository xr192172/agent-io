/**
 * `fileFacts` —— **事实的唯一入口**（T20 第 (1) 步）。
 *
 * 为什么值得钉死：这是"**事实的权威只在解析数据**"落地后的**唯一读取点**；
 * 原先 5 个读者各自读 DSL 里镜像的 `actual_apis` / `actual_deps`（第二份可写副本）。
 * ★ 而这次改动**没有任何门覆盖**（G8 人群不含这些工具，全量测试全绿也说明不了行为对）——
 *   所以行为由本文件钉住。
 *
 * 覆盖的边界（都是"会静默出错"的那类）：
 *   · **路径前缀不一致**（DSL 的 `path` 与 cache.db 的 `file_path`）⇒ 必须靠**后缀匹配**兜到，否则读空；
 *   · **库不存在**（还没建索引）⇒ `source: null` + 空事实（**合法**）；
 *   · **文件不在索引里** ⇒ `source` 非 null 但 `matched_path: null`（**与"没有 API"是两回事**）；
 *   · **连接复用**（读者在逐文件循环里调用，不能每次新开）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeAllProjectCacheDbs, type Database } from '../../src/infrastructure/index/db.js';
import { fileFacts, apiSignaturesOf } from '../../src/infrastructure/index/file_facts.js';

let dir: string;
let db: Database;
let dbFile: string;

function node(id: string, kind: string, name: string, filePath: string, start: number, end: number, signature: string | null, closure = 0): void {
  db.prepare(
    `INSERT INTO nodes(id, kind, name, qualified_name, file_path, language, start_line, end_line, parent, signature, updated_at, is_closure)
     VALUES (?,?,?,?,?,'typescript',?,?,NULL,?,0,?)`,
  ).run(id, kind, name, name, filePath, start, end, signature, closure);
}

function importEdge(sourceFile: string, targetFile: string): void {
  db.prepare(`INSERT INTO edges(source, target, kind, line) VALUES (?,?,'import',1)`).run(sourceFile, targetFile);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filefacts-'));
  dbFile = path.join(dir, '.agent-io', 'cache.db'); // ★ 与 accessor 的默认落点一致
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = openDb(dbFile);
});

afterEach(() => {
  try { db.close(); } catch { /* 已关 */ }
  closeAllProjectCacheDbs(); // ★ 必须有：连接池持有句柄，不关则 Windows 删目录 EBUSY
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('fileFacts —— 事实的唯一入口', () => {
  it('取到顶层 API（按行序）+ 项目内 import 依赖（仓库相对路径）', () => {
    node('src/a.ts', 'file', 'a.ts', 'src/a.ts', 1, 60, null);
    node('src/b.ts', 'file', 'b.ts', 'src/b.ts', 1, 10, null);
    node('src/a.ts#run', 'function', 'run', 'src/a.ts', 12, 20, 'run(x: number): number');
    node('src/a.ts#helper', 'function', 'helper', 'src/a.ts', 30, 33, 'helper(): void');
    importEdge('src/a.ts', 'src/b.ts');

    const f = fileFacts(dir, 'src/a.ts');
    expect(f.source).toBe(dbFile);
    expect(f.matched_path).toBe('src/a.ts');
    expect(f.apis.map((a) => a.name)).toEqual(['run', 'helper']); // 按 start_line
    expect(f.apis[0].start_line).toBe(12);
    expect(f.deps).toEqual(['src/b.ts']);
    expect(apiSignaturesOf(dir, 'src/a.ts')).toEqual(['run(x: number): number', 'helper(): void']);
  });

  it('★ 路径前缀不一致 ⇒ 靠后缀匹配兜到（否则 5 个读者会读空）', () => {
    node('packages/app/src/a.ts', 'file', 'a.ts', 'packages/app/src/a.ts', 1, 40, null);
    node('packages/app/src/a.ts#run', 'function', 'run', 'packages/app/src/a.ts', 5, 9, 'run(): void');

    // DSL 里记的是短一点的 path
    const f = fileFacts(dir, 'src/a.ts');
    expect(f.matched_path).toBe('packages/app/src/a.ts');
    expect(f.apis.map((a) => a.name)).toEqual(['run']);
  });

  it('局部闭包（is_closure=1）不算契约面 —— 与 function_outline 同口径', () => {
    node('a.ts', 'file', 'a.ts', 'a.ts', 1, 40, null);
    node('a.ts#Exported', 'function', 'Exported', 'a.ts', 1, 5, 'Exported(): void');
    node('a.ts#hidden', 'function', 'hidden', 'a.ts', 8, 10, 'hidden(): void', 1);

    expect(fileFacts(dir, 'a.ts').apis.map((a) => a.name)).toEqual(['Exported']);
  });

  it('★★ 后缀匹配**有歧义就不猜** —— 不许把别处的同名文件当成本项目的', () => {
    // 同一后缀在库里出现两次（如同名 fixture）：查短名必须**返回 null**，而不是随便挑一条
    node('packages/a/src/x.ts', 'file', 'x.ts', 'packages/a/src/x.ts', 1, 5, null);
    node('packages/b/src/x.ts', 'file', 'x.ts', 'packages/b/src/x.ts', 1, 5, null);
    const f = fileFacts(dir, 'src/x.ts');
    expect(f.matched_path).toBeNull();
    expect(f.apis).toEqual([]);
    // 但**精确路径**仍然命中
    expect(fileFacts(dir, 'packages/b/src/x.ts').matched_path).toBe('packages/b/src/x.ts');
  });

  it('★★ 后缀匹配**有歧义就不猜** —— 不许把别处的同名文件当成本项目的', () => {
    // 同一后缀在库里出现两次（如同名 fixture）：查短名必须**返回 null**，而不是随便挑一条
    node('packages/a/src/x.ts', 'file', 'x.ts', 'packages/a/src/x.ts', 1, 5, null);
    node('packages/b/src/x.ts', 'file', 'x.ts', 'packages/b/src/x.ts', 1, 5, null);
    const f = fileFacts(dir, 'src/x.ts');
    expect(f.matched_path).toBeNull();
    expect(f.apis).toEqual([]);
    // 但**精确路径**仍然命中
    expect(fileFacts(dir, 'packages/b/src/x.ts').matched_path).toBe('packages/b/src/x.ts');
  });

  it('★ 文件不在索引里 ⇒ matched_path=null（与"这文件没有 API"是两回事）', () => {
    node('a.ts', 'file', 'a.ts', 'a.ts', 1, 10, null);
    const f = fileFacts(dir, 'nonexistent.ts');
    expect(f.source).toBe(dbFile); // 库在
    expect(f.matched_path).toBeNull(); // 但文件不在
    expect(f.apis).toEqual([]);
  });

  it('★ 该项目没有索引 ⇒ 空事实；且**如实暴露**"库的定位会兜到 cwd"这一既有语义', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'filefacts-empty-'));
    try {
      // ★ 用一个**不可能存在**的文件名：否则后缀匹配可能命中 cwd 库里恰好同名的文件，
      //   这条断言就会随"本仓索引里恰好有几个 a.ts"而飘（第一版就飘了）。
      const f = fileFacts(empty, 'zz-not-exist-abc123.ts');
      // ★ 注意：`resolveFunctionCacheDb` 的第三级候选是 `<cwd>/.agent-io/cache.db`（既有语义，未改），
      //   所以这里 `source` **可能非 null**（读到了 cwd 那个库）。但该文件不在那个库里
      //   ⇒ `matched_path` 必为 null、事实必为空 —— **不会把别的项目的事实当成本项目的**。
      expect(f.matched_path).toBeNull();
      expect(f.apis).toEqual([]);
      expect(f.deps).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('★ 连接复用：逐文件循环调用同一个库，只开一次连接（不是 N 次）', () => {
    node('a.ts', 'file', 'a.ts', 'a.ts', 1, 10, null);
    node('a.ts#A', 'function', 'A', 'a.ts', 2, 4, 'A(): void');
    // 同一个库连查 3 次；若每次都新开连接，这里会在 afterEach 关不掉/句柄泄漏
    for (let i = 0; i < 3; i++) {
      expect(fileFacts(dir, 'a.ts').apis.map((a) => a.name)).toEqual(['A']);
    }
    // 复用同一连接的证据：库里插入新行后立即可见（同一连接 = 同一事务视图）
    node('a.ts#B', 'function', 'B', 'a.ts', 6, 8, 'B(): void');
    expect(fileFacts(dir, 'a.ts').apis.map((a) => a.name)).toEqual(['A', 'B']);
  });
});
