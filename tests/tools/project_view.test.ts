/**
 * ProjectView 的判据（规划书 §19.5 ①）：**同一进程内重复取同一个 root，只算一次**。
 *
 * ★ 为什么这条判据必须存在：本层的全部价值就是"一处算出来、多处取用"。
 *   如果它每次取都 walk 一遍，那就只是**多包了一层**，比没有更糟（多一层还要维护）。
 *   所以门要钉的不是"有没有这个模块"，而是"**它真的只算了一次**"——这靠 `projectViewStats()` 计数。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getProjectView,
  invalidateProjectView,
  projectViewStats,
  resetProjectViewForTest,
  PROJECT_VIEW_TTL_MS,
} from '../../src/infrastructure/parse/project_view.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');

describe('ProjectView：一处算、多处取', () => {
  it('★ 同进程内连续取 3 次 ⇒ 只 walk 1 次（本层存在的全部意义）', () => {
    resetProjectViewForTest();
    const a = getProjectView(REPO);
    const b = getProjectView(REPO);
    const c = getProjectView(REPO);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(c.fromCache).toBe(true);
    const st = projectViewStats();
    expect(st.walks[REPO], 'TTL 内重复取不该重新 walk').toBe(1);
    expect(st.hits).toBe(2);
    // 三份视图是**同一批文件**（不能因为走了缓存就给出不同的集合）
    expect(b.sourceFiles).toEqual(a.sourceFiles);
    expect(c.sourceFiles).toEqual(a.sourceFiles);
    expect(a.sourceFiles.length, '视图里一个文件都没有 ⇒ 检测口径失效').toBeGreaterThan(100);
  });

  it('显式失效 ⇒ 下次重算（写工具落盘后靠它拿新视图）', () => {
    resetProjectViewForTest();
    getProjectView(REPO);
    invalidateProjectView(REPO);
    const v = getProjectView(REPO);
    expect(v.fromCache).toBe(false);
    expect(projectViewStats().walks[REPO]).toBe(2);
  });

  it('TTL 过期 ⇒ 重算（把 TTL 设 0 等价于"不过期判断永不命中"）', () => {
    resetProjectViewForTest();
    getProjectView(REPO, { ttlMs: 0 });
    const v2 = getProjectView(REPO, { ttlMs: 0 });
    expect(v2.fromCache).toBe(false);
    expect(projectViewStats().walks[REPO]).toBe(2);
  });

  it('默认 TTL 与仓内既有 5s 约定一致（不引入第二套时间约定）', () => {
    expect(PROJECT_VIEW_TTL_MS).toBe(5000);
  });

  it('两个 root 各自计数（不会互相命中）', () => {
    resetProjectViewForTest();
    getProjectView(REPO);
    getProjectView(REPO + '/src');
    const w = projectViewStats().walks;
    expect(w[REPO]).toBe(1);
    expect(w[REPO + '/src']).toBe(1);
  });

  it('★ 接线：失效必须挂在「写路径」与「watcher 事件」两个**唯一入口**上', () => {
    // ★ 为什么这里用文本断言（这是我刚批过的做法）：本层要验的是**接线**（"挂没挂上"），
    //   而不是"逻辑对不对"（那由本文件上面的行为断言管）。接线是**静态事实** —— 文本在这里是对的尺。
    //   ⚠️ 边界：它只证明"那两处调了 invalidateProjectView"，不证明调用点真的会执行。
    const symbols = fs.readFileSync(path.join(REPO, 'src', 'infrastructure', 'index', 'symbols.ts'), 'utf8');
    const watch = fs.readFileSync(path.join(REPO, 'src', 'infrastructure', 'index', 'watch_project.ts'), 'utf8');
    // 写路径：syncFile / syncFileSync 是全部写工具的公共落点 ⇒ 必须各挂一次
    expect(symbols, 'syncFile 没挂失效（写工具落盘后视图会读到旧的）').toContain(
      'export async function syncFile(db: Database, projectRoot: string, absPath: string): Promise<SyncFileResult> {\n  invalidateProjectView(projectRoot);',
    );
    expect(symbols, 'syncFileSync 没挂失效').toContain(
      'export function syncFileSync(db: Database, projectRoot: string, absPath: string): SyncFileResult {\n  invalidateProjectView(projectRoot);',
    );
    // watcher：enqueue 是 fs.watch 事件归一后的唯一入口
    expect(watch, 'watcher 的 enqueue 没挂失效 ⇒ 有 watcher 时仍在等 TTL').toMatch(
      /invalidateProjectView\(root\);\s*\n\s*pending\.add\(rel\);/,
    );
  });
});
