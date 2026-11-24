/**
 * P1 · **G-2 收口把守**：O3 scoped reconcile 根治 + G2 mapper_statement 接链 + G1 不可解析读数显形。
 *
 * ## 判据（各自有独立反例 —— 破坏哪一条都会红）
 *
 * **O3 单文件腿 scoped reconcile（去顺序敏感，非 workaround）**
 *   ① 正例：目标文件被单文件重扫、批量自愈入边被 CASCADE 带走后，**单文件腿收尾的 scoped
 *      reconcile** 自愈重建入边——不再依赖"refresh→批量 reconcile→judge"的顺序 workaround；
 *   ② scoped 口径：只对账 target 落在本轮重扫文件内的入边，scoped=true、targetFiles 点名；
 *      二次解析收窄到被重开引用所在的引用方文件（不全库遍历）。
 *
 * **G2 mapper_statement 接入选择/继承链**
 *   ③ mapper_statement 进消费边型清单（CONSUMED_EDGE_KINDS），不再是"已建未读"；
 *   ④ 正向波及：改 XML 语句 ⇒ 沿 mapper_statement 推到接口方法（diffImpact callees 方向）；
 *   ⑤ 反向观察面：Java 测试到达接口方法后，沿 mapper_statement 反向收集对应 XML（derivedObservesOf）。
 *
 * **G1 不可解析读数显形**
 *   ⑥ 覆盖映射 stats 显形 computed 动态入口计数/清单、dist 排除边计数、failed/pending 反射引用计数；
 *      均为非负读数，读不到给零值，不据此回落全量。
 *
 * ## 隔离
 * 每个用例自己的临时项目根 + AGENT_IO_HOME，跑完删；不碰真数据仓。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectCacheDb, closeProjectCacheDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db.js';
import { syncFileSync, resolveCrossFileCalls, reconcileResolvedEdges } from '../src/infrastructure/index/symbols.js';
import { prewarmKernel } from '../src/infrastructure/parse/kernel.js';
import { buildCoverageMap, CONSUMED_EDGE_KINDS } from '../src/infrastructure/analysis/facts/test_coverage.js';
import { diffImpact } from '../src/infrastructure/analysis/impact/diff_impact.js';
import { derivedObservesOf } from '../src/application/design/verified_snapshot.js';

interface G2Fixture {
  root: string;
  prevHome: string | undefined;
  write(rel: string, content: string): void;
  sync(rel: string): ReturnType<typeof syncFileSync>;
  resolve(): ReturnType<typeof resolveCrossFileCalls>;
  fullReconcile(): ReturnType<typeof reconcileResolvedEdges>;
  dropCallEdge(target: string): void;
  edgesFrom(rel: string): Array<{ target: string; kind: string }>;
  refsFrom(rel: string): Array<{ name: string; status: string; resolved: string | null }>;
  cleanup(): void;
}

async function makeFixture(files: Record<string, string>): Promise<G2Fixture> {
  await prewarmKernel();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-g2-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-g2-home-'));
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  const db = getProjectCacheDb(root);
  const sync = (rel: string): ReturnType<typeof syncFileSync> => {
    const r = syncFileSync(db, root, path.join(root, rel));
    assert.notEqual(r.status, 'failed', `夹具同步失败：${rel} ⇒ ${r.error ?? ''}`);
    return r;
  };
  for (const rel of Object.keys(files)) sync(rel);
  return {
    root,
    prevHome,
    write,
    sync,
    resolve: () => resolveCrossFileCalls(db, root),
    fullReconcile: () => reconcileResolvedEdges(db, root),
    dropCallEdge: (target) => db.prepare("DELETE FROM edges WHERE kind='call' AND target = ?").run(target),
    edgesFrom: (rel) =>
      db
        .prepare(`SELECT target, kind FROM edges WHERE source LIKE $p ORDER BY line`)
        .all({ p: `${rel}#%` }) as Array<{ target: string; kind: string }>,
    refsFrom: (rel) =>
      (
        db
          .prepare(
            `SELECT reference_name AS name, status, resolved_node_id AS resolved FROM unresolved_refs WHERE from_node_id LIKE $p ORDER BY line`,
          )
          .all({ p: `${rel}#%` }) as Array<{ name: string; status: string; resolved: string | null }>
      ),
    cleanup: () => {
      closeProjectCacheDb(root);
      if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
      else process.env.AGENT_IO_HOME = prevHome;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// ── ① O3 正例：单文件重扫后 scoped reconcile 自愈重建批量自愈入边（不靠顺序 workaround）──
test('① O3 根治：目标文件单文件重扫带走入边后，单文件腿 scoped reconcile 重建（非 refresh→批量 reconcile 顺序）', async () => {
  const fx = await makeFixture({
    'src/lib/b.ts': 'export function callee() { return 1; }\n',
    'src/app/a.ts': "import { callee } from '../lib/b.js';\n\nexport function useIt() { return callee(); }\n",
  });
  try {
    fx.resolve();
    fx.fullReconcile();
    const target = 'src/lib/b.ts#callee';
    assert.ok(fx.edgesFrom('src/app/a.ts').some((e) => e.target === target), '建边阶段：A→B call 边必须在');

    // 复现 O3 窗口：目标文件被重扫、删旧节点 CASCADE 带走入边（引用方 ref 仍 resolved）。
    // 这里先删边模拟 CASCADE 结果，再模拟一次真实编辑重扫（内容微调使 hash 变 ⇒ 走 parse
    // 重写节点腿，而不是内容未变的 skipped 短路），走**单文件腿**收尾（不手动调全量 reconcile）。
    fx.dropCallEdge(target);
    assert.equal(fx.edgesFrom('src/app/a.ts').filter((e) => e.kind === 'call').length, 0, '夹具先复现入边缺失');
    fx.write('src/lib/b.ts', 'export function callee() { return 2; }\n');

    const rescan = fx.sync('src/lib/b.ts');
    // 单文件腿收尾必须挂 scoped reconcile，且口径限定到本轮重扫文件
    assert.ok(rescan.reconcile, '单文件腿结果必须带 scoped reconcile 读数');
    assert.equal(rescan.reconcile!.scoped, true, '单文件腿对账必须是 scoped 模式');
    assert.deepEqual(rescan.reconcile!.targetFiles, ['src/lib/b.ts'], 'scoped 目标文件必须点名本轮重扫文件');

    assert.ok(
      fx.edgesFrom('src/app/a.ts').some((e) => e.target === target),
      'scoped reconcile 后入边必须自愈重建回来；实际=' + JSON.stringify(fx.edgesFrom('src/app/a.ts')),
    );
    const ref = fx.refsFrom('src/app/a.ts').find((r) => r.name === 'callee');
    assert.equal(ref?.status, 'resolved', '重建后引用回到 resolved');
  } finally {
    fx.cleanup();
  }
});

// ── ② O3 scoped 口径：只对账目标落在本轮文件内的入边；全库模式 scoped=false ──────
test('② O3 scoped 口径：targetFiles 限定对账范围；不传参的全库对账 scoped=false、targetFiles=[]', async () => {
  const fx = await makeFixture({
    'src/lib/b.ts': 'export function callee() { return 1; }\n',
    'src/app/a.ts': "import { callee } from '../lib/b.js';\n\nexport function useIt() { return callee(); }\n",
  });
  try {
    fx.resolve();
    fx.fullReconcile();
    const full = fx.fullReconcile();
    assert.equal(full.scoped, false, '不传 targetFiles ⇒ 全库对账模式');
    assert.deepEqual(full.targetFiles, [], '全库模式目标文件清单为空');

    const db = getProjectCacheDb(fx.root);
    const scoped = reconcileResolvedEdges(db, fx.root, { targetFiles: ['src/lib/b.ts'] });
    assert.equal(scoped.scoped, true, '传 targetFiles ⇒ scoped 模式');
    assert.deepEqual(scoped.targetFiles, ['src/lib/b.ts'], 'scoped 目标文件透传');
  } finally {
    fx.cleanup();
  }
});

// ── ③ G2：mapper_statement 在消费边型清单内（不再是已建未读）─────────────────────
test('③ G2：CONSUMED_EDGE_KINDS 含 mapper_statement（覆盖映射/继承链消费清单）', () => {
  assert.ok(
    (CONSUMED_EDGE_KINDS as readonly string[]).includes('mapper_statement'),
    'mapper_statement 必须在选材/继承链消费清单内',
  );
});

// ── ④⑤ G2：mapper 边正向波及 + 反向观察面（纯 db 夹具，不碰真仓）─────────────────
test('④⑤ G2：改 XML 语句沿 mapper_statement 推到接口方法；Java 测试反向观察到对应 XML', async () => {
  await prewarmKernel();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-g2-mapper-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-g2-mapper-home-'));
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  try {
    fs.mkdirSync(path.join(root, 'src/main/resources/mapper'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src/main/java/com/example'), { recursive: true });
    fs.mkdirSync(path.join(root, 'src/test/java/com/example'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/main/resources/mapper/GreeterMapper.xml'), '<mapper/>\n');
    fs.writeFileSync(path.join(root, 'src/main/java/com/example/GreeterMapper.java'), 'interface GreeterMapper {}\n');
    fs.writeFileSync(path.join(root, 'src/test/java/com/example/GreeterMapperTest.java'), 'class GreeterMapperTest {}\n');
    const db = getProjectCacheDb(root);
    const now = new Date().toISOString();
    const insNode = db.prepare(
      'INSERT INTO nodes(id,kind,name,qualified_name,file_path,language,start_line,end_line,updated_at,signature) VALUES (?,?,?,?,?,?,?,?,?,?)',
    );
    const XML = 'src/main/resources/mapper/GreeterMapper.xml';
    const JAVA = 'src/main/java/com/example/GreeterMapper.java';
    const TEST = 'src/test/java/com/example/GreeterMapperTest.java';
    insNode.run(`${XML}#com.example.GreeterMapper.findByName`, 'method', 'findByName', 'com.example.GreeterMapper.findByName', XML, 'java', 9, 9, now, '[ts-fallback] select');
    insNode.run(`${JAVA}#GreeterMapper.findByName`, 'method', 'findByName', 'GreeterMapper.findByName', JAVA, 'java', 1, 1, now, null);
    insNode.run(`${TEST}#GreeterMapperTest`, 'class', 'GreeterMapperTest', 'GreeterMapperTest', TEST, 'java', 1, 1, now, null);
    const insEdge = db.prepare('INSERT INTO edges(source,target,kind,line,metadata) VALUES (?,?,?,?,?)');
    // mapper_statement: XML 语句 → Java 接口方法
    insEdge.run(`${XML}#com.example.GreeterMapper.findByName`, `${JAVA}#GreeterMapper.findByName`, 'mapper_statement', 9, JSON.stringify({ namespace: 'com.example.GreeterMapper', statement_id: 'findByName' }));
    // 测试 → 接口方法（call/type_ref 既有链）
    insEdge.run(`${TEST}#GreeterMapperTest`, `${JAVA}#GreeterMapper.findByName`, 'call', 1, null);

    // ④ 正向波及：改 XML 语句 ⇒ callees 方向沿 mapper_statement 推到 Java 方法
    const impact = diffImpact({ project_dir: root, changed: [XML], direction: 'callees', db });
    const impactedJava = impact.impacted_symbols.some((s) => s.file_path === JAVA && s.name === 'findByName');
    assert.ok(impactedJava, `改 XML 语句必须沿 mapper_statement 波及到接口方法；实际符号=${JSON.stringify(impact.impacted_symbols.map((s) => `${s.file_path}#${s.name}`))}`);
    assert.ok(impact.edge_counts.mapper_statement >= 1, 'edge_counts 必须显形 mapper_statement 计数');

    // ⑤ 反向观察面：Java 测试到达方法后，沿 mapper 反向收集对应 XML
    const observes = derivedObservesOf(root, TEST);
    assert.ok(observes.includes(XML), `Java 测试观察面必须含对应 mapper XML；实际=${JSON.stringify(observes)}`);
  } finally {
    closeAllProjectCacheDbs();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
  }
});

// ── ⑥ G1：覆盖映射 stats 显形不可解析读数（非负；读不到给零值）────────────────────
test('⑥ G1：buildCoverageMap.stats 含 computed/dist/unresolved 读数字段且非负', async () => {
  const fx = await makeFixture({
    'src/a.ts': 'export const A = 1;\n',
    'tests/a.test.ts': "import { A } from '../src/a.js';\n",
  });
  try {
    fx.resolve();
    fx.fullReconcile();
    const map = buildCoverageMap(fx.root);
    assert.equal(map.trusted, true, '夹具索引新鲜 ⇒ 可信');
    const s = map.stats;
    assert.ok(typeof s.computedImports === 'number' && s.computedImports >= 0, 'computedImports 非负计数');
    assert.ok(Array.isArray(s.computedFiles), 'computedFiles 必须是清单数组');
    assert.ok(typeof s.excludedDistEdges === 'number' && s.excludedDistEdges >= 0, 'excludedDistEdges 非负计数');
    assert.ok(s.unresolvedUnsafe, 'unresolvedUnsafe 读数对象必须存在');
    assert.ok(s.unresolvedUnsafe.failedCall >= 0 && s.unresolvedUnsafe.failedTypeRef >= 0 && s.unresolvedUnsafe.pending >= 0);
  } finally {
    fx.cleanup();
  }
});
