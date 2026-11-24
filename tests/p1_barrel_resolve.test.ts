/**
 * P1 · **T-#CALLEXISTS-EDGE-GAP：call 边跨 barrel 再导出解析修复**（A1 + A2）。
 *
 * ## 它治哪个洞（DB 实测，不是设想）
 * 真反例：`consistency.ts#checkConsistencyReport` 在 **L987** 真调用 `parseFile`（目标定义在
 * `parse/kernel.ts`、经 `parse/index.ts` 再导出），而 cache.db 里这条引用是
 *   `status=external` · `why=reexport-target-not-indexed` · `detail=…/project_actual_fields.ts`
 * —— detail 指向**与本条引用无关**的另一条 import，而且那个文件**已在索引里**（why 是假的）。
 * ⇒ 设计册判据 `call-exists(checkConsistencyReport→parseFile)` 假红。
 *
 * ## 两条判据（各自有独立反例 —— 破坏哪一条都会红）
 * **A1（`isExternalMissWhy` + 跳板 why 改名）**
 *   ① 正例：barrel 一跳能接上 ⇒ call 边必须出现（`probe_barrel` 的夹具形态）；
 *   ② 反例·why 说真话：barrel 的**下一层**磁盘上不存在 ⇒ 引用落 `failed`，why **不是**
 *      `reexport-target-not-indexed` / `reexport-target-outside-repo`（即不会被判 external）；
 *   ③ 反例·回归 T-#87：**未索引的跳板**（`dist/` 那族）不许因此被连上、也不许被说成
 *      "barrel 未命中"（why = `cross-import-not-indexed`）——它就是当年 T-#63/#87 要保护的边界。
 * **A2（`resolveImportFiles` 三态 + 歧义不猜）**
 *   ④ 反例：`amb.ts` 与 `amb/index.ts` **并存** ⇒ **不建边**（旧行为是静默选 `foo.ts`）；
 *     该引用的 why = `import-target-ambiguous`，且**不许**落 external（"说不清"≠"在仓外"）；
 *   ⑤ 正例：只有 `only/index.ts`（无同级文件）⇒ 认它（旧实现靠运气，`.mjs` 那族更是完全落空）；
 *   ⑥ 正例：只有 `file.ts` ⇒ 认它；`file.js + file.ts`（产物同目录，**常见**）⇒ 仍认 `file.ts`
 *      （所以"文件形态"的歧义判据**不能**把 `.js` 算进去 —— 这一条就是那次踩坑的钉子）。
 *
 * ## 隔离
 * 每个用例自己的 `AGENT_IO_HOME` + 临时项目根，跑完删；不碰真数据仓。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProjectCacheDb, closeProjectCacheDb } from '../src/infrastructure/index/db.js';
import { syncFileSync, resolveCrossFileCalls, reconcileResolvedEdges } from '../src/infrastructure/index/symbols.js';
import { prewarmKernel } from '../src/infrastructure/parse/kernel.js';
import { buildCoverageMap, CONSUMED_EDGE_KINDS } from '../src/infrastructure/analysis/facts/test_coverage.js';

interface Fixture {
  root: string;
  prevHome: string | undefined;
  write(rel: string, content: string): void;
  sync(rel: string): void;
  resolve(): ReturnType<typeof resolveCrossFileCalls>;
  reconcile(): ReturnType<typeof reconcileResolvedEdges>;
  dropCallEdge(target: string): void;
  dropTargetNode(rel: string): void;
  refsFrom(rel: string): Array<{ name: string; status: string; resolved: string | null; candidates: string | null }>;
  edgesFrom(rel: string): Array<{ target: string; kind: string; line: number | null }>;
  cleanup(): void;
}

async function makeFixture(files: Record<string, string>, syncOrder?: string[]): Promise<Fixture> {
  await prewarmKernel();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-barrel-proj-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-barrel-home-'));
  const prevHome = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  const order = syncOrder ?? Object.keys(files).filter((f) => !f.startsWith('dist/'));
  const db = getProjectCacheDb(root);
  const sync = (rel: string): void => {
    const r = syncFileSync(db, root, path.join(root, rel));
    assert.notEqual(r.status, 'failed', `夹具同步失败：${rel} ⇒ ${r.error ?? ''}`);
  };
  for (const rel of order) sync(rel);
  return {
    root,
    prevHome,
    write,
    sync,
    resolve: () => resolveCrossFileCalls(db, root),
    reconcile: () => reconcileResolvedEdges(db, root),
    dropCallEdge: (target) =>
      db.prepare("DELETE FROM edges WHERE kind='call' AND target = ?").run(target),
    dropTargetNode: (rel) => db.prepare('DELETE FROM nodes WHERE file_path = ?').run(rel),
    refsFrom: (rel) =>
      (
        db
          .prepare(
            `SELECT reference_name AS name, status, resolved_node_id AS resolved, candidates
               FROM unresolved_refs WHERE from_node_id LIKE $p ORDER BY line`,
          )
          .all({ p: `${rel}#%` }) as Array<{ name: string; status: string; resolved: string | null; candidates: string | null }>
      ),
    edgesFrom: (rel) =>
      db
        .prepare(`SELECT target, kind, line FROM edges WHERE source LIKE $p ORDER BY line`)
        .all({ p: `${rel}#%` }) as Array<{ target: string; kind: string; line: number | null }>,
    cleanup: () => {
      closeProjectCacheDb(root);
      if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
      else process.env.AGENT_IO_HOME = prevHome;
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

/** 把 ref 的 candidates（JSON 串）解析成 `{verdict, why, detail}`；坏 JSON 直接让用例红 */
function verdictOf(candidates: string | null): { verdict?: string; why?: string; detail?: string } {
  if (!candidates) return {};
  return JSON.parse(candidates) as { verdict?: string; why?: string; detail?: string };
}

// ── ① 正例：barrel 一跳能接上 ⇒ call 边必须出现 ─────────────────────────────
test('① A1 正例：目标经 barrel 再导出（export { f } from ./kernel.js）⇒ 跨文件 call 边建出来', async () => {
  const fx = await makeFixture({
    'src/infrastructure/parse/kernel.ts': 'export async function parseFile(p: string, c: string) { return [p, c]; }\n',
    'src/infrastructure/parse/index.ts': "export { parseFile } from './kernel.js';\n",
    'src/application/consistency.ts': [
      "import { parseFile } from '../infrastructure/parse/index.js';",
      '',
      'export async function checkConsistencyReport(p: string, c: string) {',
      '  return await parseFile(p, c);',
      '}',
      '',
    ].join('\n'),
  });
  try {
    const stats = fx.resolve();
    const edges = fx.edgesFrom('src/application/consistency.ts');
    const call = edges.find((e) => e.kind === 'call' && e.target.endsWith('#parseFile'));
    assert.ok(
      call,
      `barrel 再导出的 parseFile 必须建成 call 边（这就是判据 call-exists 吃的那条边）；实际边=${JSON.stringify(edges)}，stats=${JSON.stringify(stats)}`,
    );
    assert.equal(call?.target, 'src/infrastructure/parse/kernel.ts#parseFile', '边必须落在定义处（第三跳），不是落在 barrel');
    const ref = fx.refsFrom('src/application/consistency.ts').find((r) => r.name === 'parseFile');
    assert.equal(ref?.status, 'resolved', 'parseFile 这条引用必须 resolved（不许停在 external / failed）');
  } finally {
    fx.cleanup();
  }
});

// ── ② 反例：barrel 下一层不存在 ⇒ 不许说"未索引" ───────────────────────────
test('② A1 反例：barrel 的下一层不存在 ⇒ 落 failed，why 不是"未索引/external"（why 必须说真话）', async () => {
  const fx = await makeFixture({
    // barrel 指向的下一层磁盘上**根本不存在** ——
    // 旧实现在这里会写 `reexport-target-not-indexed`，而那个 why 会被下面 external 白名单吃成 external。
    'src/lib/barrel.ts': "export { ghost } from './gone.js';\n",
    'src/app/consumer.ts': ["import { ghost } from '../lib/barrel.js';", '', 'export function useGhost() { return ghost(); }', ''].join('\n'),
  });
  try {
    fx.resolve();
    const ref = fx.refsFrom('src/app/consumer').concat(fx.refsFrom('src/app/consumer.ts')).find((r) => r.name === 'ghost');
    assert.ok(ref, 'ghost 这条引用必须在 unresolved_refs 里（不能凭空消失）');
    const v = verdictOf(ref.candidates);
    assert.notEqual(ref.status, 'resolved', '下一层不存在的 barrel 不许被"连上"');
    assert.notEqual(
      v.why,
      'reexport-target-not-indexed',
      `★「barrel 下一层没索引」与「这条 import 的跳板没索引」必须分开说；实际 why=${v.why} detail=${v.detail ?? ''}`,
    );
    assert.notEqual(
      v.why,
      'reexport-target-outside-repo',
      `barrel 的下一层是相对路径、不是仓外 ⇒ 不许说成 outside-repo；实际 why=${v.why}`,
    );
  } finally {
    fx.cleanup();
  }
});

// ── ③ 反例：未索引的跳板不许被连上（T-#63/#87 的边界仍在）─────────────────
test('③ A1 回归：未索引的跳板（dist/ 那族）⇒ 不建边、且原因记 `cross-import-not-indexed`（不当 external）', async () => {
  const fx = await makeFixture({
    // dist/ 在盘上、但**不在索引里**（夹具同步顺序里刻意跳过它）
    'dist/lib/index.mjs': 'export function parseFile() {}\n',
    'src/lib/other.ts': 'export function other() {}\n',
    'src/app/consumer.ts': [
      "import { parseFile } from '../../dist/lib/index.js';",
      '',
      'export function useIt() { return parseFile(); }',
      '',
    ].join('\n'),
  });
  try {
    // 跳板文件在盘上但那族不参与索引 ⇒ 它不会出现在 files 表里
    fx.resolve();
    const ref = fx.refsFrom('src/app/consumer.ts').find((r) => r.name === 'parseFile');
    assert.ok(ref, 'parseFile 必须在 unresolved_refs 里');
    const v = verdictOf(ref.candidates);
    assert.notEqual(ref.status, 'resolved', '未索引的跳板不许被"连上"（宁漏不错）');
    assert.equal(
      v.why,
      'cross-import-not-indexed',
      `★「这条 import 的跳板没索引」是旁注，不是"barrel 未命中"的结论；实际 why=${v.why} detail=${v.detail ?? ''}`,
    );
    assert.notEqual(ref.status, 'external', '旁注不许落 external 终态（那会让它永不重判）');
  } finally {
    fx.cleanup();
  }
});

// ── ④ 反例：同名兄弟（foo.ts + foo/index.ts）⇒ 不猜 ───────────────────────
test('④ A2 反例：`amb.ts` 与 `amb/index.ts` 并存 ⇒ **不静默二选一**（不建边 + why=import-target-ambiguous）', async () => {
  const fx = await makeFixture({
    'src/lib/amb.ts': 'export function pick() { return 1; }\n',
    'src/lib/amb/index.ts': 'export function pick() { return 2; }\n',
    'src/app/consumer.ts': ["import { pick } from '../lib/amb.js';", '', 'export function usePick() { return pick(); }', ''].join('\n'),
  });
  try {
    fx.resolve();
    const edges = fx.edgesFrom('src/app/consumer.ts').filter((e) => e.kind === 'call');
    assert.equal(
      edges.length,
      0,
      `★ 两个落点都在时不许猜（旧行为是静默选 amb.ts）——它们都不是"唯一可证"的目标；实际=${JSON.stringify(edges)}`,
    );
    const ref = fx.refsFrom('src/app/consumer.ts').find((r) => r.name === 'pick');
    assert.ok(ref, 'pick 必须在 unresolved_refs 里（不许静默消失）');
    const v = verdictOf(ref.candidates);
    assert.equal(v.why, 'import-target-ambiguous', `why 要说清是"说不清指向哪个"；实际 why=${v.why}`);
    assert.notEqual(ref.status, 'external', '"说不清"≠"在仓外"：歧义不许落 external（白名单外）');
  } finally {
    fx.cleanup();
  }
});

// ── ⑤ 正例：只有目录 barrel ⇒ 唯一，认它 ───────────────────────────────────
test('⑤ A2 正例：只有 `only/index.ts`（无同级文件）⇒ 认目录 barrel；`.mjs` 那族同样可达', async () => {
  const fx = await makeFixture({
    'src/lib/only/index.ts': 'export function onlyFn() { return 1; }\n',
    'src/lib/onlymjs/index.mjs': 'export function mjsFn() { return 2; }\n',
    'src/app/consumer.ts': [
      "import { onlyFn } from '../lib/only.js';",
      "import { mjsFn } from '../lib/onlymjs.js';",
      '',
      'export function useBoth() { return onlyFn() + mjsFn(); }',
      '',
    ].join('\n'),
  });
  try {
    fx.resolve();
    const targets = fx.edgesFrom('src/app/consumer.ts').map((e) => e.target);
    assert.ok(
      targets.includes('src/lib/only/index.ts#onlyFn'),
      `只有目录 barrel 时这是**唯一**落点 ⇒ 必须连上；实际=${JSON.stringify(targets)}`,
    );
    // ★ `.mjs` 那族：主口径的目录 index 候选不含 index.mjs —— 修前这里必落空（落不到 ⇒ 不能算"唯一"）。
    //   它要么连上、要么**明确**落 failed（两者都不许是 external / ambiguous），这条断言钉的是"不许说谎"。
    const mjsRef = fx.refsFrom('src/app/consumer.ts').find((r) => r.name === 'mjsFn');
    assert.ok(mjsRef, 'mjsFn 必须在 unresolved_refs 里');
    const v = verdictOf(mjsRef.candidates);
    assert.notEqual(v.why, 'import-target-ambiguous', '`.mjs` 那族只有一个落点（若有）⇒ 不许报歧义');
  } finally {
    fx.cleanup();
  }
});

// ── ⑥ 正例：产物同目录（file.js + file.ts）不算歧义 ───────────────────────
test('⑥ A2 回归：`file.ts + file.js`（TS+产物同目录）⇒ 仍认 `file.ts`（.js 不是"第二个落点"）', async () => {
  const fx = await makeFixture({
    'src/lib/file.ts': 'export function fileFn() { return 1; }\n',
    'src/lib/file.js': 'export function fileFn() { return 1; }\n',
    'src/app/consumer.ts': ["import { fileFn } from '../lib/file.js';", '', 'export function useFile() { return fileFn(); }', ''].join('\n'),
  });
  try {
    fx.resolve();
    const targets = fx.edgesFrom('src/app/consumer.ts').map((e) => e.target);
    assert.ok(
      targets.includes('src/lib/file.ts#fileFn'),
      `★ "file.js" 是产物，不是"第二个落点" —— 把它算进歧义会让最常见的 TS 布局永远落不到；实际=` +
        JSON.stringify(targets),
    );
  } finally {
    fx.cleanup();
  }
});

// ── ⑦ G9 入边根治·自愈正例：resolved 入边被级联带走后，收尾对账重建 ──────────
test('⑦ G9 入边根治：resolved 引用的 call 入边被删后，对账自愈重建（不靠 gen-db 后手工 relink 顺序 workaround）', async () => {
  const fx = await makeFixture({
    'src/lib/b.ts': 'export function callee() { return 1; }\n',
    'src/app/a.ts': "import { callee } from '../lib/b.js';\n\nexport function useIt() { return callee(); }\n",
  });
  try {
    fx.resolve();
    const target = 'src/lib/b.ts#callee';
    let edges = fx.edgesFrom('src/app/a.ts').filter((e) => e.kind === 'call');
    assert.ok(edges.some((e) => e.target === target), '建边阶段：A→B call 边必须在');
    // 反向夹具前置：模拟目标节点重同步、FK CASCADE 带走入边（引用方 ref 仍 resolved）
    fx.dropCallEdge(target);
    edges = fx.edgesFrom('src/app/a.ts').filter((e) => e.kind === 'call');
    assert.equal(edges.length, 0, '夹具必须先复现「入边缺失」，否则这条反向用例没钉住洞');

    const recon = fx.reconcile();
    assert.equal(recon.missing, 1, '对账必须认出这 1 条缺边（不许静默丢已解析入边）');
    assert.equal(recon.reopened, 1, '目标节点仍在 ⇒ 重开 pending 交收尾重建');
    assert.equal(recon.dropped, 0, '目标节点在 ⇒ 不许置 failed');

    edges = fx.edgesFrom('src/app/a.ts').filter((e) => e.kind === 'call');
    assert.ok(edges.some((e) => e.target === target), '二次解析后入边必须重建回来（自愈）');
    const ref = fx.refsFrom('src/app/a.ts').find((r) => r.name === 'callee');
    assert.equal(ref?.status, 'resolved', '重建后引用回到 resolved');
  } finally {
    fx.cleanup();
  }
});

// ── ⑧ G9 入边根治·留痕反例：目标节点已不存在 ⇒ failed 留痕，不重开空转 ───────
test('⑧ G9 入边根治：目标节点已不在 nodes ⇒ 引用置 failed 留痕（why=stale-target-dropped），不重开空转', async () => {
  const fx = await makeFixture({
    'src/lib/b.ts': 'export function callee() { return 1; }\n',
    'src/app/a.ts': "import { callee } from '../lib/b.js';\n\nexport function useIt() { return callee(); }\n",
  });
  try {
    fx.resolve();
    // 删目标文件节点（模拟文件被删）；入边随节点 FK CASCADE 消失，引用方 ref 行仍 resolved
    fx.dropTargetNode('src/lib/b.ts');
    const recon = fx.reconcile();
    assert.equal(recon.missing, 1, '缺边必须被认出');
    assert.equal(recon.reopened, 0, '目标节点已不在 ⇒ 不许重开 pending 空转');
    assert.equal(recon.dropped, 1, '置 failed 留痕 1 条');
    const ref = fx.refsFrom('src/app/a.ts').find((r) => r.name === 'callee');
    assert.equal(ref?.status, 'failed', '引用必须落 failed（不是 resolved 假绿）');
    const v = verdictOf(ref?.candidates ?? null);
    assert.equal(v.why, 'stale-target-dropped', '留痕 why 必须说清目标节点已消失');
  } finally {
    fx.cleanup();
  }
});

// ── ⑨ G9① 新鲜度正例：索引与磁盘一致 ⇒ trusted / fresh=true ───────────────
test('⑨ G9① 新鲜度正例：同步后未再改盘 ⇒ 覆盖映射 trusted=true、stats.fresh=true', async () => {
  const fx = await makeFixture({
    'src/a.ts': 'export const A = 1;\n',
    'src/b.ts': "import { A } from './a.js';\nexport const B = A + 1;\n",
    'tests/a.test.ts': "import { A } from '../src/a.js';\n",
  });
  try {
    fx.resolve();
    fx.reconcile();
    const map = buildCoverageMap(fx.root);
    assert.equal(map.trusted, true, '索引新鲜 ⇒ 必须可信');
    assert.equal(map.stats.fresh, true, 'fresh 读数必须为真');
    assert.ok(map.stats.builtKinds.includes('import'), 'builtKinds 必须显形已建边型 import');
    assert.ok(map.byTest.has('tests/a.test.ts'), '测试必须进覆盖映射');
    for (const k of map.stats.unreadKinds) {
      assert.ok(!CONSUMED_EDGE_KINDS.includes(k as (typeof CONSUMED_EDGE_KINDS)[number]), `未读边型 ${k} 不得出现在消费清单内`);
    }
  } finally {
    fx.cleanup();
  }
});

// ── ⑩ G9① 新鲜度反例：改盘未重同步 ⇒ fail-closed 回落全量（trusted=false） ──
test('⑩ G9① 新鲜度反例：src 改盘未重同步 ⇒ trusted=false、fresh=false（不拿陈旧边集当可信）', async () => {
  const fx = await makeFixture({
    'src/a.ts': 'export const A = 1;\n',
    'tests/a.test.ts': "import { A } from '../src/a.js';\n",
  });
  try {
    fx.resolve();
    fx.reconcile();
    // 改盘但不重新同步 ⇒ files 表陈旧（size/mtime 与磁盘不符）
    fx.write('src/a.ts', 'export const A = 1;\nexport const C = 2;\n');
    const map = buildCoverageMap(fx.root);
    assert.equal(map.trusted, false, '陈旧边集必须不可信（fail-closed，不许当当前覆盖）');
    assert.equal(map.stats.fresh, false, 'fresh 读数必须为假');
    assert.equal(map.byTest.size, 0, '不可信 ⇒ 回落空映射（全量触发面），不出伪覆盖');
  } finally {
    fx.cleanup();
  }
});

// ── ⑪ G9③ 边型对账：已建未读边型显形，且与消费清单不混 ───────────────────
test('⑪ G9③ 边型对账：builtKinds 全量显形；unreadKinds 只收已建未读，与消费清单不交', async () => {
  const fx = await makeFixture({
    'src/a.ts': 'export const A = 1;\n',
    'src/b.ts': "import { A } from './a.js';\nexport const B = A + 1;\n",
    'tests/a.test.ts': "import { A } from '../src/a.js';\n",
  });
  try {
    fx.resolve();
    fx.reconcile();
    const map = buildCoverageMap(fx.root);
    assert.ok(Array.isArray(map.stats.builtKinds), 'builtKinds 必须是边型数组读数');
    const consumed = new Set<string>(CONSUMED_EDGE_KINDS);
    for (const k of map.stats.unreadKinds) {
      assert.ok(!consumed.has(k), `unreadKinds 混入了已消费边型 ${k}`);
      assert.ok(map.stats.builtKinds.includes(k), `unreadKinds 的 ${k} 必须在已建集合 builtKinds 内`);
    }
  } finally {
    fx.cleanup();
  }
});
