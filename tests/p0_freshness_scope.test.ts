// touches: src/infrastructure/index/index_freshness.ts, src/application/meta/integrity/index_integrity.ts, src/presentation/mcp/server_registry.ts
/**
 * P0 · 「索引落后于磁盘」必须按**保鲜重解析范围**判 —— 否则那条警告永远亮（AGENTS.md 0.16）。
 *
 * ## 病（改前实测，本仓真读数）
 * `index_integrity`（不传 refresh）报 `verdict=untrusted · not_fresh=20`，那 20 项的真实构成：
 * 6 个 `.md` · 3 个 `.json` · 11 个 `tests/*.test.ts` · **0 个 `src/`** —— 而这条判据把它们
 * 全算成「索引落后」。更狠的是 `detectStaleIndex`：挂在**每个工具响应**上的 STALE_INDEX，
 * 抽样 627 条里的 314 条判出 9 条陈旧，**9/9 全在范围外、0 条 `src/`** ⇒ 灯常亮。
 * 后果不是"多一条告警"，而是**把 agent 从结构工具上赶回 grep**。
 *
 * ## 四条用例（T1/T2 **必须成对**：只测 T1 会把病治成"永远绿"）
 *   T1 只动 `.md`/`.json`/`tests`（= 索引器永不重解析的那类）⇒ `verdict=trusted` **且** STALE_INDEX 不亮
 *   T2 再动**范围内**的 `src/*.ts` ⇒ `verdict=untrusted` **且** STALE_INDEX 非空（真信号不许被削弱）
 *   T3 分母：诊断与告警里必须同时出现「抽样 N / 全量 M」（0.12③）+ 范围外条数
 *   T4 消融（**可执行**：T1 就是它的鉴别器）：把 `index_integrity` 里的 scope 过滤摘掉
 *      （`notFreshInScope = notFreshAll`）⇒ 本文件的 T1 必红。实测读数见卡上的 evidence。
 *
 * ★ fail-closed（0.9.4 第 1 行：读不到 ≠ 没有）：保鲜范围**算不出来**时不许静默成空集
 *   （空集 ⇒ 每个已索引文件都"在范围外" ⇒ 集体判绿）⇒ 必须 `scopeFallback:true` / `not_fresh_scope_unknown`
 *   且**仍然 untrusted**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getProjectCacheDb, type Database } from '../src/infrastructure/index/db.js';
import { detectStaleIndex, ensureFreshIndex, freshnessScope } from '../src/infrastructure/index/index_freshness.js';
import { indexIntegrity } from '../src/application/meta/integrity/index_integrity.js';
import { resetStaleIndexWarningCache, staleIndexWarning } from '../src/presentation/mcp/server_registry.js';
// ★ D2：夹具必须造出 `selfWritesPending > 0` —— 真实场景下**每个写工具都会登记**，
//   不造它就等于"夹具里没有那个变量，那条腿从没被测过"（测试给假绿）。
import { recordSelfWrite } from '../src/application/write_gate.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 临时项目根：`src/a.ts` 是**范围内**源码；`README.md` / `docs/note.md` / `tests/t.test.ts` 是范围外那类 */
function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-freshscope-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function a() { return 1; }\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'docs', 'note.md'), '# note\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'tests', 't.test.ts'), 'export const t = 1;\n', 'utf8');
  return dir;
}

/**
 * 把某个文件登记成「**已索引**但不会被保鲜重解析」—— 复现真实条件：
 * `.md` 靠 `include_docs` 进索引、`tests/**` 靠写路径 `syncFile` 进索引（`syncFile` 不看
 * `include_tests`）⇒ 它们都在 `files` 表里，却**永远**不在保鲜范围里。
 * ★ 直接落行而不是走 `syncFile`：本用例要钉的是"已索引 + 范围外"这个**状态**，
 *   不是某条写路径（写路径变了会让用例变成在测别的东西）。
 */
function seedIndexedFile(db: Database, root: string, rel: string): void {
  const abs = path.join(root, rel);
  const st = fs.statSync(abs);
  db.prepare(
    'INSERT OR REPLACE INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count) VALUES (?,?,?,?,?,?,?)',
  ).run(rel, `seed-${rel}`, path.extname(rel).slice(1) || 'md', st.size, Math.round(st.mtimeMs), Date.now(), 0);
}

/** 让文件与库里那行不一致（**改 size** ⇒ 与 mtime 粒度无关，不会 flake） */
function dirty(root: string, rel: string): void {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8') + '\n// p0_freshness_scope: touched\n', 'utf8');
}

test('T1+T2 · 只动范围外(.md/.json/tests) ⇒ trusted；再动范围内(.ts) ⇒ untrusted（成对，防"永远绿"）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    await ensureFreshIndex(db, project); // 只索引 src/a.ts（walkFiles(include_tests=false) ∩ 代码语言）
    seedIndexedFile(db, project, 'README.md');
    seedIndexedFile(db, project, 'docs/note.md');
    seedIndexedFile(db, project, 'tests/t.test.ts');
    // ★ D2：造出「自写登记待消费」—— 这是真实场景的常态（每个写工具都会 recordSelfWrite），
    //   而它**不是**「你这次结果可能不准」的信号（D1：它不许单独点亮 STALE_INDEX）。
    recordSelfWrite(project, ['src/a.ts'], 'p0_freshness_scope T1：造出 selfWritesPending>0');

    // ── 前提：范围本身必须先对（否则下面两条断的就是别的东西）──
    const sc = freshnessScope(project);
    assert.equal(sc.ok, true, `范围必须算得出来：${JSON.stringify(sc.error)}`);
    assert.ok(sc.scope.has('src/a.ts'), `范围内应含 src/a.ts：${[...sc.scope].join(', ')}`);
    assert.ok(!sc.scope.has('README.md'), '`.md` 不在保鲜范围（索引器不走查它）');
    assert.ok(!sc.scope.has('tests/t.test.ts'), '`tests/**` 不在保鲜范围（include_tests=false）');

    // ── T1：只动范围外那三个 ──
    dirty(project, 'README.md');
    dirty(project, 'docs/note.md');
    dirty(project, 'tests/t.test.ts');

    const r1 = await indexIntegrity({ project_dir: project });
    // ★ D3/C6（一致性）：两个出口不许一个说可信、一个说可能旧 ——
    //   `index_integrity.verdict==='trusted'` 时 `staleIndexWarning` **必须** null。
    //   （D2 已确保此处的 selfWritesPending > 0：这条断言改前必红 —— 那时灯会被自写登记点亮）
    assert.ok(
      r1.freshness.self_writes_pending > 0,
      `夹具无效：必须造出「自写登记待消费」才能测这条腿：${JSON.stringify(r1.freshness)}`,
    );
    assert.equal(r1.freshness.not_fresh, 3, `三处改动都应被 stat 看见（全量口径）：${JSON.stringify(r1.freshness)}`);
    assert.equal(
      r1.freshness.not_fresh_out_of_scope.length,
      3,
      `三处都该被分成"范围外"：${JSON.stringify(r1.freshness.not_fresh_out_of_scope)}`,
    );
    const outIssue = r1.issues.find((i) => i.code === 'files_not_fresh_out_of_scope');
    assert.ok(outIssue, `范围外陈旧**不许消失**（改了 .md 必须说一句）：${JSON.stringify(r1.issues)}`);
    assert.equal(outIssue?.severity, 'info', '范围外那批只能是 info 档（blocker 留给「索引器会重解析」的）');
    assert.ok(
      !r1.issues.some((i) => i.code === 'files_not_fresh' && i.severity === 'blocker'),
      `**只动范围外文件**不许报 blocker（本卡要钉死的那个病）：${JSON.stringify(r1.issues)}`,
    );
    // 只动 .md/.json/tests ⇒ 符号图没有落后 ⇒ verdict 必须 trusted（改前这里是 untrusted）
    assert.equal(r1.verdict, 'trusted');

    // 同一件事在**告警层**也必须一致：那一行挂在每个工具响应上，只动 .md 时不许亮（0.16）。
    resetStaleIndexWarningCache();
    const w1 = staleIndexWarning(project);
    assert.equal(
      w1,
      null,
      `只动范围外文件 ⇒ STALE_INDEX 不许亮（改前它 100% 常亮）：${JSON.stringify(w1)}`,
    );
    // ★ B3 补（错的指令比没有指令更坏）：即使将来它因别的原因重新亮，也**不许**给出
    //   「调 refresh:true 就能消」这个无效药方 —— 范围外陈旧 refresh 消不掉。
    if (w1) {
      assert.doesNotMatch(String(w1.fix), /refresh:true/, `只脏范围外文件时 fix 不许提 refresh:true：${w1.fix}`);
    }

    // ── T2：再动范围内的 src/a.ts ──
    dirty(project, 'src/a.ts');
    const r2 = await indexIntegrity({ project_dir: project });
    assert.ok(
      r2.issues.some((i) => i.code === 'files_not_fresh' && i.severity === 'blocker'),
      `**范围内**陈旧必须仍是 blocker（真信号不许被削弱）：${JSON.stringify(r2.issues)}`,
    );
    // 范围内 .ts 变了 ⇒ 索引确实落后 ⇒ untrusted（真信号不许被削弱）
    assert.equal(r2.verdict, 'untrusted');

    resetStaleIndexWarningCache();
    const w = staleIndexWarning(project);
    assert.ok(w, '范围内的改动 ⇒ STALE_INDEX 必须亮（T1 的"不亮"不是靠把灯拧坏换来的）');
    assert.equal(w?.code, 'STALE_INDEX');
  } finally {
    resetStaleIndexWarningCache();
    rmRf(home);
    rmRf(project);
  }
});

test('T3 · 分母：诊断/告警必须同时给「抽样 N / 全量 M」+ 范围外条数（0.12③）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    await ensureFreshIndex(db, project);
    // 再加两个范围内源码，凑出"全量 > 抽样"的形态（maxScan=1 ⇒ stride>1）
    fs.writeFileSync(path.join(project, 'src', 'b.ts'), 'export function b() { return 1; }\n', 'utf8');
    fs.writeFileSync(path.join(project, 'src', 'c.ts'), 'export function c() { return 1; }\n', 'utf8');
    await ensureFreshIndex(db, project);
    seedIndexedFile(db, project, 'README.md');
    seedIndexedFile(db, project, 'tests/t.test.ts');
    dirty(project, 'src/b.ts');

    const p = detectStaleIndex(db, project, { maxScan: 1 });
    assert.equal(typeof p.scanned, 'number', '回执必须带「本次抽样了几条」');
    assert.equal(typeof p.total, 'number', '回执必须带「口径全量几条」');
    assert.equal(p.indexedTotal, 5, `files 表 5 条（src×3 + README + tests）：${p.indexedTotal}`);
    assert.equal(p.total, 3, `口径全量 = 范围内 3 条（src×3）：${p.total}`);
    assert.equal(p.outOfScope, 2, `范围外 = README + tests：${p.outOfScope}`);
    assert.ok(p.sampled && p.scanned < p.total, `maxScan=1 时必须真的抽样：scanned=${p.scanned} / total=${p.total}`);
    assert.equal(p.scopeFallback, false, '正常项目不该走 fail-closed 分支');

    // 告警那一行：两个数都必须出现（只给分子 = 没验）
    resetStaleIndexWarningCache();
    const w = staleIndexWarning(project);
    assert.ok(w, 'b.ts 是范围内改动 ⇒ 必须亮');
    assert.match(
      String(w?.summary),
      /抽样 \d+\/\d+ 个「索引器会重解析」的文件/,
      `summary 必须写清「抽样 N/全量 M」+ 口径：${w?.summary}`,
    );
    assert.match(String(w?.detail), /范围外/, `detail 必须交代范围外那批：${w?.detail}`);
    // ★ 反之：**有范围内陈旧**时 refresh 确实是有效药方，fix 必须指它（否则把药也一起删了）
    assert.match(String(w?.fix), /refresh:true/, `有范围内陈旧时 fix 必须指向 refresh:true：${w?.fix}`);
  } finally {
    resetStaleIndexWarningCache();
    rmRf(home);
    rmRf(project);
  }
});

test('fail-closed · 保鲜范围算不出来 ⇒ 不许变绿（scopeFallback + 仍然 untrusted）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  /** 一个**没有可解析源码**的项目根：走查为空 ⇒ 范围算不出来（空集是最危险的假绿来源） */
  const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-freshscope-empty-'));
  fs.mkdirSync(path.join(emptyProject, 'src'), { recursive: true });
  try {
    process.env.AGENT_IO_HOME = home;
    const db = getProjectCacheDb(project);
    await ensureFreshIndex(db, project);
    seedIndexedFile(db, project, 'README.md');

    // ① 直接问范围：空项目 ⇒ ok:false（不是"空集"）
    const sc = freshnessScope(emptyProject);
    assert.equal(sc.ok, false, '走查为空时 `ok` 必须 false —— 空集会让每个已索引文件都"在范围外" ⇒ 集体判绿');
    assert.ok(sc.error && sc.error.length > 0, `要给出原因（0.12 拒绝必须可定位）：${sc.error}`);

    // ② 探测层：退回全体口径，且**如实标注**
    const p = detectStaleIndex(db, project, { maxScan: 1 });
    assert.equal(p.scopeFallback, false, '基线：正常项目不该 fallback');
    dirty(project, 'README.md');
    const dbEmpty = getProjectCacheDb(emptyProject);
    fs.writeFileSync(path.join(emptyProject, 'src', 'x.json'), '{"a":1}\n', 'utf8');
    seedIndexedFile(dbEmpty, emptyProject, 'src/x.json');
    dirty(emptyProject, 'src/x.json');
    const pEmpty = detectStaleIndex(dbEmpty, emptyProject, { maxScan: 1 });
    assert.equal(pEmpty.scopeFallback, true, '范围算不出来 ⇒ 必须标 scopeFallback（不许静默）');
    assert.equal(pEmpty.total, pEmpty.indexedTotal, 'fallback 时口径退回全体（宁可多报）');

    // ③ 判定层：算不出范围 ⇒ **仍然 untrusted**（只改 .md 也判落后 —— 这是 fail-closed 的代价，
    //    比"算不出来就判绿"安全：假绿会让 agent 拿着旧图去删代码）
    const r = await indexIntegrity({ project_dir: emptyProject });
    assert.ok(
      r.freshness.not_fresh_scope_unknown,
      `回执必须带原因（not_fresh_scope_unknown）：${JSON.stringify(r.freshness)}`,
    );
    assert.ok(
      r.issues.some((i) => i.code === 'freshness_scope_unknown'),
      `问题清单要点名 freshness_scope_unknown：${JSON.stringify(r.issues)}`,
    );
    assert.equal(r.freshness.not_fresh_out_of_scope.length, 0, 'fallback 时不许把文件判成"范围外"（那就是变绿）');
  } finally {
    resetStaleIndexWarningCache();
    rmRf(home);
    rmRf(project);
    rmRf(emptyProject);
  }
});
