/**
 * ④-b：`Touched`（链的接口）**真行为验证** —— 不是"字段存在"，而是"落盘/未落盘时它长什么样"。
 *
 * 守的是 `src/domain/b_terms.ts` 里那条**统一口径**：
 *   · **作用域类**（`feature` / `project_dir`）—— 任何时候都可给；
 *   · **对象类**（`written_files` / `read_files` / `symbols` / `nodes`）—— 描述「本次调用**确立下来的对象**」：
 *     写类 [B] **只有真的落盘了才给**；`dry_run` / 被阻断 / `ok:false` ⇒ **整项省略**（不是空数组）。
 *
 * ★ 为什么这几条断言值钱：`touched` 是**可选**字段 —— 它缺席时**什么都不会红**，
 *   下游只是"接不上链"（静默失败）。所以口径必须由测试钉住，不能靠代码审查。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renameFiles } from '../../src/application/refactor/rename_files.js';
import { renameFile } from '../../src/application/refactor/rename_file.js';
import { closeProjectCacheDb } from '../../src/infrastructure/index/db';

const dirs: string[] = [];

function mkProj(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'touched-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    // ★ 必须先关该项目根的池化缓存连接，否则 Windows 上删目录会撞句柄占用
    try {
      closeProjectCacheDb(d);
    } catch {
      /* 该项目可能压根没建过连接 */
    }
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(d, { recursive: true, force: true });
        break;
      } catch {
        /* Windows 句柄未释放，重试 */
      }
    }
  }
});

describe('④-b Touched —— rename_files', () => {
  it('真落盘 ⇒ 给 project_dir + written_files（仓库相对，且**含被改写的 importer**）', async () => {
    const dir = mkProj({
      'src/foo.ts': "import { b } from './bar';\nexport function a() { return b(); }\n",
      'src/bar.ts': 'export function b() { return 2; }\n',
    });
    const r = await renameFiles({
      project_dir: dir,
      renames: [{ from: 'src/bar.ts', to: 'src/br.ts' }],
    });
    expect(r.ok).toBe(true);
    // 作用域类：入参给了就给（解析成绝对根）
    expect(r.touched.project_dir).toBe(path.resolve(dir));
    // 对象类：真落盘 ⇒ 给，且**都是仓库相对**路径
    expect(r.touched.written_files).toBeDefined();
    expect(r.touched.written_files).toContain('src/br.ts');
    // ★ 被改写的 importer 也算"本次动过的文件" —— 少了它就漏了一半影响面
    expect(r.touched.written_files).toContain('src/foo.ts');
    for (const f of r.touched.written_files!) {
      expect(path.isAbsolute(f), `written_files 必须是仓库相对路径，得到 ${f}`).toBe(false);
    }
    // ★ 被搬走的旧路径**不列**（下游读不到它）
    expect(r.touched.written_files).not.toContain('src/bar.ts');
  });

  it('dry_run ⇒ 作用域类照给，对象类**整项省略**（不是空数组）', async () => {
    const dir = mkProj({ 'src/bar.ts': 'export function b() { return 2; }\n' });
    const r = await renameFiles({
      project_dir: dir,
      renames: [{ from: 'src/bar.ts', to: 'src/br.ts' }],
      dry_run: true,
    });
    expect(r.dryRun).toBe(true);
    expect(r.touched.project_dir).toBe(path.resolve(dir));
    expect(r.touched.written_files).toBeUndefined();
  });

  it('被阻断（ok=false）⇒ 同样不给对象类字段', async () => {
    const dir = mkProj({ 'src/bar.ts': 'export function b() { return 2; }\n' });
    const r = await renameFiles({ project_dir: dir, renames: [] });
    expect(r.ok).toBe(false);
    expect(r.touched.written_files).toBeUndefined();
    // ★ 作用域类仍给：它描述"作用在哪"，与成败无关
    expect(r.touched.project_dir).toBe(path.resolve(dir));
  });

  it('★ 入参没给 project_dir ⇒ 省略（**不复刻** Core 的根解析、更不用 cwd 兜底）', async () => {
    const dir = mkProj({ 'src/bar.ts': 'export function b() { return 2; }\n' });
    const r = await renameFiles({ renames: [{ from: path.join(dir, 'src/bar.ts'), to: path.join(dir, 'src/br.ts') }] });
    // 不给就是不给 —— 拿"进程当前目录"冒充"本次调用确立的项目根"是错的
    expect(r.touched.project_dir).toBeUndefined();
  });
});

describe('④-b Touched —— rename_file', () => {
  it('真落盘 ⇒ written_files 含新文件与被改写的 importer', async () => {
    const dir = mkProj({
      'src/foo.ts': "import { b } from './bar';\nexport function a() { return b(); }\n",
      'src/bar.ts': 'export function b() { return 2; }\n',
    });
    const r = await renameFile({ project_dir: dir, from: 'src/bar.ts', to: 'src/br.ts' });
    expect(r.ok).toBe(true);
    expect(r.moved).toBe(true);
    expect(r.touched.written_files).toContain('src/br.ts');
    expect(r.touched.written_files).toContain('src/foo.ts');
  });

  it('dry_run ⇒ 不给 written_files', async () => {
    const dir = mkProj({ 'src/bar.ts': 'export function b() { return 2; }\n' });
    const r = await renameFile({ project_dir: dir, from: 'src/bar.ts', to: 'src/br.ts', dry_run: true });
    expect(r.dryRun).toBe(true);
    expect(r.touched.written_files).toBeUndefined();
  });
});
