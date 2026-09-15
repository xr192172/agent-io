/**
 * 写闸收编（refactor_pipeline / scaffold）验收 —— 「我们自己改的，我们自己登记」延伸到管线与骨架生成
 *
 * 覆盖：
 *   - refactor_pipeline applied ⇒ 索引随盘更新：符号改名后引用方被重开重解析（旧名连不上 = failed，
 *     而不是维持 resolved 假象）；对同一文件再跑一次写穿全 skipped ⇒ 索引已等于磁盘。
 *   - refactor_pipeline rolled_back ⇒ 索引零扰动：引用边维持 resolved，未变文件全 skipped。
 *   - refactor_pipeline 纯移动 ⇒ from 从索引移除、to 进入索引。
 *   - scaffold（同步签名）⇒ 解析器已预热 ⇒ 同步直连 L1a（消息"同步写穿"）；
 *     生成物进索引；根外 / 无 project_dir ⇒ 不登记。
 *   - ⑤ 同步写穿 syncSelfWritesSync（2026-09-15）：未预热 ⇒ 预热闸整批落回 L1b（绝不半同步）；
 *     prewarmKernel 后 ⇒ 与 async 版同口径（改名 → 引用方重开重解析 → 再写穿全 skipped）；
 *     remove_dead_imports 组合：预热后 indexWriteThrough 直连 synced。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { runRefactorPipeline } from '../../src/tools/refactor_pipeline';
import { RefactorLangRegistry, type LanguageRefactorExecutor } from '../../src/tools/refactor_langs';
import { openDb } from '../../src/db/db';
import { syncSelfWrites, syncSelfWritesSync, pendingSelfWrites } from '../../src/tools/write_gate';
import { importProject } from '../../src/tools/import_project';
import { scaffold } from '../../src/tools/scaffold';
import { removeDeadImports } from '../../src/tools/remove_dead_imports';
import { prewarmKernel, _reset as resetKernel } from '../../src/tools/ts_kernel';
import { saveDSL } from '../../src/storage';

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

function tmpRoot(tag: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `wga-${tag}-`));
  roots.push(root);
  return root;
}

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

const AUTH_SRC = `export function login(user: string): boolean {\n  return user === 'admin';\n}\n`;
const SERVICE_SRC = `import { login } from './auth';\nexport function handle(u: string): boolean {\n  return login(u);\n}\n`;

/** 建项目 + 建索引（auth.ts 先入索引；service.ts 由各测试自己补 + 二次导入出跨文件边） */
async function makeIndexed(tag: string): Promise<string> {
  const root = tmpRoot(tag);
  put(root, 'src/auth.ts', AUTH_SRC);
  const db = openDb(path.join(root, '.design-canvas', 'cache.db'));
  await importProject({ project_dir: root, feature: `wga_${tag}`, cache_db: db });
  db.close();
  return root;
}

/** 把 service.ts 补进盘上并重导入，拿到 login 的已解析跨文件边 */
async function resolveServiceRef(root: string, tag: string): Promise<void> {
  put(root, 'src/service.ts', SERVICE_SRC);
  const db = openDb(path.join(root, '.design-canvas', 'cache.db'));
  await importProject({ project_dir: root, feature: `wga_${tag}_2`, cache_db: db });
  db.close();
}

function dbAt(root: string): ReturnType<typeof openDb> {
  return openDb(path.join(root, '.design-canvas', 'cache.db'));
}

function refStatus(db: ReturnType<typeof openDb>, fileRel: string, name: string): string | undefined {
  return (
    db
      .prepare('SELECT status FROM unresolved_refs WHERE from_node_id LIKE $f AND reference_name = $n')
      .get({ f: `${fileRel}#%`, n: name }) as { status: string } | undefined
  )?.status;
}

/** 把 login 改名为 signIn 的单步语言执行器（纯计算；落盘/验证/回滚全归管线） */
function renameExecutor(authAbs: string): RefactorLangRegistry {
  const oldSrc = fs.readFileSync(authAbs, 'utf-8');
  const newSrc = oldSrc.replace('login', 'signIn');
  const ex: LanguageRefactorExecutor = {
    lang: 'wga-test',
    isSourceFile: (rel) => rel.endsWith('.ts'),
    detectVerifyCommands: () => [],
    stages: [
      {
        kind: 'dead_statements',
        label: '[test] login→signIn',
        compute: () => ({
          absToNew: new Map([[authAbs, newSrc]]),
          originals: new Map([[authAbs, oldSrc]]),
        }),
        limitations: ['测试注入：单文件符号改名'],
      },
    ],
  };
  const reg = new RefactorLangRegistry();
  reg.register(ex);
  return reg;
}

const verifyPass = (): { status: 'pass'; at: string } => ({ status: 'pass', at: 't' });

describe('refactor_pipeline 写闸（L1a）', () => {
  it('applied ⇒ 索引随盘更新：改名后引用方被重开重解析，再写穿全 skipped', async () => {
    const root = await makeIndexed('apply');
    await resolveServiceRef(root, 'apply');
    const db = dbAt(root);
    expect(refStatus(db, 'src/service.ts', 'login')).toBe('resolved');
    db.close();

    const authAbs = path.join(root, 'src', 'auth.ts');
    const res = await runRefactorPipeline({
      project_dir: root,
      steps: { dead_statements: { enabled: true } },
      langs: renameExecutor(authAbs),
      verify: true,
      verifyImpl: verifyPass,
    });

    const stage = res.stages.find((s) => s.outcome === 'applied');
    expect(stage).toBeDefined();
    expect(stage!.index_note).toContain('索引写穿');

    // ★ 旧名引用被重开 + 重解析：连不上 = failed（而不是维持 resolved 的假象）
    const db2 = dbAt(root);
    expect(refStatus(db2, 'src/service.ts', 'login')).toBe('failed');
    db2.close();

    // ★ 索引已与磁盘一致：对同一文件再跑一次写穿 ⇒ 内容 hash 未变 ⇒ 全 skipped
    const again = await syncSelfWrites(root, [authAbs]);
    expect(again?.mode).toBe('synced');
    expect(again?.skippedFiles).toBe(1);
    expect(again?.synced).toBe(0);
  });

  it('rolled_back ⇒ 索引零扰动：引用边维持 resolved，未变文件全 skipped', async () => {
    const root = await makeIndexed('rollback');
    await resolveServiceRef(root, 'rollback');
    const db = dbAt(root);
    expect(refStatus(db, 'src/service.ts', 'login')).toBe('resolved');
    db.close();

    const authAbs = path.join(root, 'src', 'auth.ts');
    let calls = 0;
    const res = await runRefactorPipeline({
      project_dir: root,
      steps: { dead_statements: { enabled: true } },
      langs: renameExecutor(authAbs),
      verify: true,
      verifyImpl: () => (++calls === 1 ? verifyPass() : { status: 'fail' as const, at: 't', detail: 'boom' }),
    });

    const stage = res.stages.find((s) => s.outcome === 'rolled_back');
    expect(stage).toBeDefined();
    expect(stage!.index_note).toContain('索引写穿');

    // 盘上内容已还原 = 索引本来就是盘上现状：引用边原样保留
    const db2 = dbAt(root);
    expect(refStatus(db2, 'src/service.ts', 'login')).toBe('resolved');
    db2.close();
    const again = await syncSelfWrites(root, [authAbs]);
    expect(again?.skippedFiles).toBe(1);
  });

  it('纯移动 ⇒ from 从索引移除、to 进入索引', async () => {
    const root = await makeIndexed('move');
    const from = path.join(root, 'src', 'auth.ts');
    const to = path.join(root, 'src', 'auth_moved.ts');
    const ex: LanguageRefactorExecutor = {
      lang: 'wga-move',
      isSourceFile: (rel) => rel.endsWith('.ts'),
      detectVerifyCommands: () => [],
      stages: [
        {
          kind: 'dead_statements',
          label: '[test] 纯移动',
          compute: () => ({ absToNew: new Map(), originals: new Map(), moves: [{ from, to }] }),
          limitations: ['测试注入：单文件移动'],
        },
      ],
    };
    const reg = new RefactorLangRegistry();
    reg.register(ex);

    const res = await runRefactorPipeline({
      project_dir: root,
      steps: { dead_statements: { enabled: true } },
      langs: reg,
      verify: true,
      verifyImpl: verifyPass,
    });

    expect(res.stages.find((s) => s.outcome === 'applied')).toBeDefined();
    const db = dbAt(root);
    const count = (p: string): number =>
      (db.prepare('SELECT COUNT(*) AS c FROM files WHERE path = $p').get({ p }) as { c: number }).c;
    expect(count('src/auth.ts')).toBe(0); // 旧路径已从索引移除
    expect(count('src/auth_moved.ts')).toBe(1); // 新路径已入索引
    db.close();
  });
});

describe('scaffold 写闸（L1b 自写登记）', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'wga-home-'));
    process.env.DESIGN_CANVAS_HOME = home;
  });
  afterEach(() => {
    delete process.env.DESIGN_CANVAS_HOME;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {
      // 忽略
    }
  });

  function saveScaffoldDsl(feature: string): void {
    saveDSL({
      feature,
      geometry: {
        nodes: [{ id: 'a', label: 'A', x: 0, y: 0, width: 100, height: 40 }],
        edges: [],
      },
      semantic: {
        files: [
          {
            id: 'a',
            path: 'src/gen/auth.ts',
            responsibility: '登录',
            expected_apis: [{ signature: 'login(user: string): boolean' }],
          },
        ],
      },
    } as never);
  }

  it('有索引 + 生成物在根内 ⇒ 预热态下同步写穿（消息升级），生成物直接进索引', async () => {
    const root = await makeIndexed('scaf'); // importProject 解析过 auth.ts ⇒ '.ts' Parser 已入缓存
    saveScaffoldDsl('scaf_f');

    const r = scaffold({ feature: 'scaf_f', output_dir: path.join(root, 'out'), project_dir: root });
    expect(r.files.length).toBeGreaterThanOrEqual(2); // 骨架 + INVARIANTS.md
    const pend = pendingSelfWrites(root); // 写前登记仍存在（幂等兜底，消费方按 hash 去重）
    expect(pend).toContain('out/src/gen/auth.ts');
    expect(pend).toContain('out/INVARIANTS.md');
    // ⑤ 同步写穿：'.ts' 已预热 ⇒ 不再是"已登记"，而是当场同步进索引
    expect(r.message).toContain('同步写穿');
    const db = dbAt(root);
    const inIndex = db
      .prepare('SELECT COUNT(*) AS c FROM files WHERE path = $p')
      .get({ p: 'out/src/gen/auth.ts' }) as { c: number };
    expect(inIndex.c).toBe(1);
    db.close();
  });

  it('生成物在项目根外 ⇒ 不登记（诚实标注）；无 project_dir ⇒ 不登记', async () => {
    const root = await makeIndexed('scafout');
    saveScaffoldDsl('scaf_out');

    const outside = tmpRoot('scaf-outside');
    const r = scaffold({ feature: 'scaf_out', output_dir: path.join(outside, 'gen'), project_dir: root });
    expect(r.message).toContain('项目根之外');
    expect(pendingSelfWrites(root)).toEqual([]);

    const r2 = scaffold({ feature: 'scaf_out', output_dir: path.join(outside, 'gen2') });
    expect(r2.message).not.toContain('索引：');
    expect(pendingSelfWrites(root)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// ⑤ 同步写穿（syncSelfWritesSync，2026-09-15）：同步签名工具直连 L1a
// ─────────────────────────────────────────────────────────────

describe('⑤ 同步写穿 syncSelfWritesSync（预热闸 + 直连 L1a）', () => {
  /** 只建"活索引"（files 表非空），**不走 importProject**——避免它顺带预热解析器 */
  function liveIndexOnly(tag: string, withFile: string): string {
    const root = tmpRoot(tag);
    const db = dbAt(root);
    db.prepare(
      `INSERT INTO files(path, content_hash, language, size, modified_at, indexed_at, node_count, errors, norm_hash)
       VALUES ($p, 'h0', 'ts', 1, 0, 0, 1, NULL, NULL)`,
    ).run({ p: withFile });
    db.close();
    return root;
  }

  it('⑦ 未预热 ⇒ 预热闸整批落回 L1b（deferred + 登记），绝不半同步', () => {
    resetKernel(); // 清掉模块级 parserCache（同文件前面的测试可能已预热）
    const root = liveIndexOnly('sync-defer', 'src/auth.ts');
    const abs = path.join(root, 'src', 'auth.ts');
    put(root, 'src/auth.ts', AUTH_SRC);

    const out = syncSelfWritesSync(root, [abs]);
    expect(out?.mode).toBe('deferred');
    expect(out?.note).toContain('未预热');
    expect(pendingSelfWrites(root)).toContain('src/auth.ts');
  });

  it('⑥ prewarmKernel 后 ⇒ 同步直连 L1a：改名 → 引用方重开重解析 → 再写穿全 skipped', async () => {
    const pw = await prewarmKernel();
    expect(pw.warmed).toBeGreaterThan(0);

    const root = await makeIndexed('syncwarm');
    await resolveServiceRef(root, 'syncwarm');
    const db = dbAt(root);
    expect(refStatus(db, 'src/service.ts', 'login')).toBe('resolved');
    db.close();

    const authAbs = path.join(root, 'src', 'auth.ts');
    fs.writeFileSync(authAbs, AUTH_SRC.replace('login', 'signIn'), 'utf-8');

    const out = syncSelfWritesSync(root, [authAbs]);
    expect(out?.mode).toBe('synced');
    expect(out?.synced).toBe(1);
    expect(out?.refsReopened).toBeGreaterThan(0);

    const db2 = dbAt(root);
    expect(refStatus(db2, 'src/service.ts', 'login')).toBe('failed'); // 旧名连不上，不维持 resolved 假象
    const again = syncSelfWritesSync(root, [authAbs]); // 索引已等于磁盘 ⇒ 全 skipped
    expect(again?.mode).toBe('synced');
    expect(again?.skippedFiles).toBe(1);
    expect(again?.synced).toBe(0);
    db2.close();
  });

  it('remove_dead_imports 组合：预热后 indexWriteThrough 优先取同步结果（synced）', () => {
    const root = liveIndexOnly('sync-rdi', 'src/b.ts');
    const rel = 'src/b.ts';
    put(root, rel, "import { dead } from './deadmod';\nexport const y = 1;\n");

    const r = removeDeadImports({
      project_dir: root,
      dead: [{ source: './deadmod', files: [rel], reason: 'no_reference' }],
    });
    expect(r.files_changed).toBe(1);
    expect(r.indexWriteThrough?.mode).toBe('synced');
    const db = dbAt(root);
    const filesRow = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: rel }) as
      | { content_hash: string }
      | undefined;
    db.close();
    // 索引里的 hash 已被同步写穿更新（不再是 liveIndexOnly 塞的占位 'h0'）
    expect(filesRow?.content_hash).toBeDefined();
    expect(filesRow?.content_hash).not.toBe('h0');
  });
});
