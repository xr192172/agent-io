/**
 * watch_project 文件监听自动同步测试
 *
 * 覆盖（纯逻辑，不依赖真实 fs.watch 异步时序）：
 *   - shouldSyncRel：忽略目录 / 非支持扩展名 / 测试生成物
 *   - handleWatchEvent：新增（changed）/ 修改（hash 变化重解析）/ 删除（cleanup）/ 忽略
 *   - flushBatch：批量去重 + 跨文件调用重解析收尾
 *   - 重复同步未变：syncFile 内部 skipped（node_count=0），不重复解析
 */
import { DATA_DIR_NAME } from '../../src/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { importProject } from '../../src/tools/import_project';
import { openDb } from '../../src/db/db';
import { getIndexStats } from '../../src/db/symbols';
import { handleWatchEvent, flushBatch, shouldSyncRel, reconcileProject, watchProject, decideFlushDelay, MAX_FLUSH_WAIT_MS } from '../../src/tools/watch_project';

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

/** 建一个含符号的项目并建缓存，返回 { root, db } */
async function makeProject(feature: string): Promise<{ root: string; db: ReturnType<typeof openDb> }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  roots.push(root);
  put(root, 'src/auth.ts', `export function login(user: string, pass: string): boolean {\n  return user === 'admin' && pass === 'x';\n}\n`);
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  await importProject({ project_dir: root, feature, cache_db: db });
  return { root, db };
}

describe('shouldSyncRel 过滤', () => {
  it('忽略 .design-canvas / node_modules / 非源码目录', () => {
    expect(shouldSyncRel('.design-canvas/cache.db')).toBe(false);
    expect(shouldSyncRel('node_modules/x/index.js')).toBe(false);
    expect(shouldSyncRel('src/.git/HEAD')).toBe(false);
    expect(shouldSyncRel('dist/out.js')).toBe(false);
    expect(shouldSyncRel('src/auth.ts')).toBe(true);
  });

  it('忽略非支持扩展名 / 测试生成物', () => {
    expect(shouldSyncRel('src/readme.md')).toBe(false);
    expect(shouldSyncRel('src/style.css')).toBe(false);
    expect(shouldSyncRel('src/auth.test.ts')).toBe(false);
    expect(shouldSyncRel('src/auth.ts')).toBe(true);
    expect(shouldSyncRel('src/util.ts')).toBe(true);
  });

  it('忽略编辑器临时存取文件', () => {
    // 通用临时后缀
    expect(shouldSyncRel('src/auth.ts.tmp')).toBe(false);
    expect(shouldSyncRel('src/auth.ts.temp')).toBe(false);
    // Chrome 缓存临时
    expect(shouldSyncRel('src/auth.ts.crswap')).toBe(false);
    expect(shouldSyncRel('src/auth.ts.crdownload')).toBe(false);
    // vim 交换文件
    expect(shouldSyncRel('src/.auth.ts.swp')).toBe(false);
    expect(shouldSyncRel('src/auth.ts.swo')).toBe(false);
    expect(shouldSyncRel('src/auth.ts.swx')).toBe(false);
    // 备份 / 补丁
    expect(shouldSyncRel('src/auth.ts.bak')).toBe(false);
    expect(shouldSyncRel('src/auth.ts.orig')).toBe(false);
    expect(shouldSyncRel('src/auth.ts.rej')).toBe(false);
    // 编辑器 ~ 锁文件（后缀 ~ 开头/结尾）
    expect(shouldSyncRel('src/~$auth.ts')).toBe(false);
    expect(shouldSyncRel('src/auth.ts~')).toBe(false);
    // 正常源码不受影响
    expect(shouldSyncRel('src/auth.ts')).toBe(true);
  });
});

describe('handleWatchEvent', () => {
  it('新增文件 → changed，缓存新增符号', async () => {
    const { root, db } = await makeProject('w1');
    put(root, 'src/render.ts', `export function renderHTML(dsl: unknown): string {\n  return '<svg>';\n}\n`);
    const before = getIndexStats(db).nodes;
    const res = await handleWatchEvent(db, root, path.join(root, 'src/render.ts'));
    expect(res.type).toBe('changed');
    expect(res.node_count).toBeGreaterThan(0);
    expect(getIndexStats(db).nodes).toBeGreaterThan(before);
    db.close();
  });

  it('修改文件 → 重解析，node_count 为符号数', async () => {
    const { root, db } = await makeProject('w2');
    put(root, 'src/auth.ts', `export function login(user: string, pass: string): boolean {\n  return user === 'admin' && pass === 'x';\n}\nexport function logout(): void {\n  return;\n}\n`);
    const res = await handleWatchEvent(db, root, path.join(root, 'src/auth.ts'));
    expect(res.type).toBe('changed');
    expect(res.node_count).toBe(2); // login + logout
    db.close();
  });

  it('重复同步未变 → 仍 changed 但 node_count=0（syncFile 内部 skipped）', async () => {
    const { root, db } = await makeProject('w3');
    const res = await handleWatchEvent(db, root, path.join(root, 'src/auth.ts'));
    expect(res.type).toBe('changed');
    expect(res.node_count).toBe(0);
    db.close();
  });

  it('删除文件 → deleted，缓存行被清理', async () => {
    const { root, db } = await makeProject('w4');
    const before = getIndexStats(db).files;
    fs.unlinkSync(path.join(root, 'src/auth.ts'));
    const res = await handleWatchEvent(db, root, path.join(root, 'src/auth.ts'));
    expect(res.type).toBe('deleted');
    expect(getIndexStats(db).files).toBe(before - 1);
    db.close();
  });

  it('非支持扩展名 → ignored', async () => {
    const { root, db } = await makeProject('w5');
    put(root, 'src/notes.md', '# note');
    const res = await handleWatchEvent(db, root, path.join(root, 'src/notes.md'));
    expect(res.type).toBe('ignored');
    db.close();
  });
});

describe('flushBatch', () => {
  it('批量去重 + 跨文件调用重解析收尾', async () => {
    const { root, db } = await makeProject('w6');
    // 新增一个调用方 + 一个被调用方，触发跨文件调用解析
    put(root, 'src/service.ts', `export function handle(u: string): string {\n  return login(u, 'x');\n}\n`);
    put(root, 'src/auth.ts', `export function login(user: string, pass: string): boolean {\n  return user === 'admin' && pass === 'x';\n}\n`);
    const summary = await flushBatch(db, root, ['src/service.ts', 'src/service.ts', '.design-canvas/cache.db', 'src/notes.md']);
    expect(summary.changed).toBe(1); // 重复的 service.ts 去重为 1
    expect(summary.ignored).toBeGreaterThan(0); // cache.db + notes.md
    expect(summary.files).toContain('src/service.ts');
    db.close();
  });
});

describe('reconcileProject 兜底', () => {
  it('目录整树删除 → 库中被清理（deleted>0）', async () => {
    const { root, db } = await makeProject('r1');
    // 新增第二个文件，确保目录树有多个文件
    put(root, 'src/util.ts', `export function helper(): string {\n  return 'x';\n}\n`);
    await flushBatch(db, root, ['src/util.ts']);
    const before = getIndexStats(db).files;
    // 整树删除 src/ 目录（fs.watch 可能只发一次事件或漏发，reconcile 必须兜底）
    fs.rmSync(path.join(root, 'src'), { recursive: true, force: true });
    const summary = await reconcileProject(db, root);
    expect(summary.deleted).toBeGreaterThan(0);
    expect(getIndexStats(db).files).toBe(before - summary.deleted);
    db.close();
  });

  it('事件丢失导致的增改 → reconcile 补齐', async () => {
    const { root, db } = await makeProject('r2');
    // 绕过 fs.watch：直接改文件 + 新增文件，然后 reconcile（模拟事件完全丢失）
    put(root, 'src/auth.ts', `export function login(u: string, p: string): boolean {\n  return true;\n}\nexport function logout(): void {\n  return;\n}\n`);
    put(root, 'src/render.ts', `export function renderHTML(): string {\n  return '<svg>';\n}\n`);
    const beforeNodes = getIndexStats(db).nodes;
    const summary = await reconcileProject(db, root);
    expect(summary.changed).toBeGreaterThan(0);
    expect(getIndexStats(db).nodes).toBeGreaterThan(beforeNodes);
    // 幂等：再次 reconcile 无变更
    const again = await reconcileProject(db, root);
    expect(again.changed).toBe(0);
    expect(again.deleted).toBe(0);
    db.close();
  });

  it('忽略目录不入扫描（scanned 不含缓存/依赖）', async () => {
    const { root, db } = await makeProject('r3');
    put(root, 'node_modules/pkg/index.js', `export const x = 1;\n`);
    put(root, '.design-canvas/live/none.dsl.json', '{}');
    const summary = await reconcileProject(db, root);
    // scanned 只含可同步源码（本项目仅 src/auth.ts）
    expect(summary.scanned).toBe(1);
    expect(summary.changed).toBe(0);
    db.close();
  });

  it('reconcile 透出本次实际变更文件集（changed_files 含增改与删除，供 drift 精确作用域）', async () => {
    const { root, db } = await makeProject('r4');
    // 新增一个文件 + 删除原 auth.ts → reconcile 应同时捕获增改与删除
    put(root, 'src/new.ts', `export const n = 1;\n`);
    fs.rmSync(path.join(root, 'src/auth.ts'));
    const summary = await reconcileProject(db, root);
    expect(summary.changed_files).toContain('src/new.ts'); // 新增在集内
    expect(summary.changed_files).toContain('src/auth.ts'); // 被删文件也在集内（供 drift 判 missing_impl）
    db.close();
  });
});

describe('watchProject stop 清理', () => {
  it('stop 后 status 不再 watching', async () => {
    const { root, db } = await makeProject('stop1');
    const handle = watchProject({ project_root: root, db, debounce_ms: 50 });
    expect(handle.status().watching).toBe(true);
    handle.stop();
    expect(handle.status().watching).toBe(false);
    db.close();
  });
});

describe('decideFlushDelay（max-wait 拦风暴积压）', () => {
  const W = 150; // 窗口
  const M = 2000; // 最大等待
  it('窗口内合并（距上次冲刷 < maxWait → 尾随窗口）', () => {
    expect(decideFlushDelay(1000, W, M, 1100)).toBe(W);
  });
  it('距上次冲刷超过 maxWait → 立即冲刷（防尾随 debounce 永不触发）', () => {
    expect(decideFlushDelay(1000, W, M, 1000 + 2001) < W).toBe(true);
  });
  it('lastFlushAt 未初始化（0）→ 走窗口（首个事件不用立即）', () => {
    expect(decideFlushDelay(0, W, M, Date.now())).toBe(W);
  });
  it('MAX_FLUSH_WAIT_MS 为正，可触发立即分支', () => {
    expect(MAX_FLUSH_WAIT_MS).toBeGreaterThan(0);
  });
});

/**
 * ★★ 2026-09-14 加的：watch 收尾"只重算**引用**部分"。
 * 用户原话：「这个文件动了哪些就重新算这一部分就可以了，毕竟它只是引用，
 * 我们只要重算引用部分即可。但是 AST 这部分是怎么算的？」
 *
 * 答案落在两处：
 *   ① 被改文件自己的 AST：只有它**内容变了**才重新解析（syncFile 的 hash 闸）；
 *   ② 引用**方**文件的 AST **不重解析**（文本没变），只重跑"引用名 → 符号"这一步 ——
 *      而这一步必须先把"指向已消失符号"的边**重开**，否则引用方的边被 FK 级联删掉后
 *      **永不重建**，find_references / impact 会静默漏报。
 */
describe('★ watch 收尾：引用方重算（只重算引用部分）', () => {
  it('被引用方改名 → 引用方的引用被重开并重解析（不再静默漏报）', async () => {
    const { root, db } = await makeProject('ref1');
    put(root, 'src/service.ts', `import { login } from './auth';\nexport function handle(u: string): boolean {\n  return login(u, 'x');\n}\n`);
    // 首次：service 引用 auth.login → 解析成跨文件边
    await flushBatch(db, root, ['src/service.ts']);
    const statusOf = (nm: string): string | undefined =>
      (db
        .prepare("SELECT status FROM unresolved_refs WHERE from_node_id LIKE 'src/service.ts#%' AND reference_name = $nm")
        .get({ nm }) as { status: string } | undefined)?.status;
    expect(statusOf('login')).toBe('resolved');

    // 在编辑器里把 auth.login 改名（不经 rename_symbols）→ auth.ts 变、service.ts 没变
    put(root, 'src/auth.ts', `export function signIn(user: string, pass: string): boolean {\n  return user === 'admin' && pass === 'x';\n}\n`);
    const summary = await flushBatch(db, root, ['src/auth.ts']);

    // ① 引用被重开（这个数历史上曾因异常被吞而长期为 0 ⇒ 必须显式断言）
    expect(summary.refsReopened).toBeGreaterThan(0);
    // ② 重开的引用**真的被解析了** —— 引用方文件必须并进 resolve scope，否则"开了却不解析"
    expect(summary.cross.total).toBeGreaterThan(0);
    // ③ 结论诚实：连不上就标 failed（不假装还连着旧符号）
    expect(statusOf('login')).toBe('failed');
    db.close();
  });

  it('未变文件不重解析（AST 只在内容变时才算）', async () => {
    const { root, db } = await makeProject('ref2');
    put(root, 'src/service.ts', `import { login } from './auth';\nexport function handle(u: string): boolean {\n  return login(u, 'x');\n}\n`);
    await flushBatch(db, root, ['src/service.ts']);
    // 原样再冲刷一次：hash 未变 ⇒ syncFile skipped ⇒ 不新建节点、不重开引用
    const again = await flushBatch(db, root, ['src/auth.ts']);
    expect(again.refsReopened).toBe(0);
    expect(again.cross.total).toBe(0);
    db.close();
  });
});

/**
 * ★★ 拼图边界闸（scopeToIndex）。
 * 默认**不设界**（保持 serve 重建 DSL 的"新文件必须追进来"语义）；
 * 大仓 + 只要保鲜时显式打开，界外事件如实计入 outOfScope（**不静默丢弃**）。
 */
describe('★ 拼图边界闸 scopeToIndex', () => {
  it('默认不设界：新文件照常同步（serve/重建 DSL 的语义不受影响）', async () => {
    const { root, db } = await makeProject('scope1');
    put(root, 'src/fresh.ts', `export const n = 1;\n`);
    const s = await flushBatch(db, root, ['src/fresh.ts']);
    expect(s.changed).toBe(1);
    expect(s.outOfScope).toBe(0);
    db.close();
  });

  it('开启后：界外文件不处理，但计入 outOfScope；界内文件照常保鲜', async () => {
    const { root, db } = await makeProject('scope2');
    put(root, 'src/fresh.ts', `export const n = 1;\n`);
    const s = await flushBatch(db, root, ['src/fresh.ts', 'src/auth.ts'], { scopeToIndex: true });
    expect(s.outOfScope).toBe(1); // fresh.ts 未入索引 → 界外
    expect(s.files).toEqual(['src/auth.ts']); // 已索引的照常处理
    db.close();
  });

  it('索引为空时自动退回全处理（零前置 + watch 不能什么都不做）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-empty-'));
    roots.push(root);
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    put(root, 'src/a.ts', `export const a = 1;\n`);
    const s = await flushBatch(db, root, ['src/a.ts'], { scopeToIndex: true });
    expect(s.changed).toBe(1);
    expect(s.outOfScope).toBe(0);
    db.close();
  });
});