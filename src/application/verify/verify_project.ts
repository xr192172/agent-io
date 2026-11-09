/**
 * **自动接管入口**：`verifyProject({ projectRoot, change? })`
 *
 * ★ 用户/模型只给 **projectRoot + 变更意图**，不写 `touches:`、不写设计册、不指定测试目录/运行参数。
 *
 * ## 它由哪些已有件拼成（没有第二套框架）
 * · 索引：`importProject`（`include_tests:true`）—— 与 `import_project` 工具同一条实现
 * · 改动集 / 波及：`impactOfChanged`（`diff_impact` 那条实现）
 * · 观察面：**索引里的 import 边**（测试文件 import 了谁），本项目约定里没有 `touches:` 也成立
 * · 继承决策：`planInheritance` + `contentDrift` + `testObjectVisibility`
 * · 证据库：`VerifiedSnapshot`（`.agent-io/verified-snapshot.json`，与内环入口同一份）
 * · 执行：**项目自己的 runner**（vitest / jest / node:test），不要求项目迁入本仓
 *
 * ## 做不到就明说
 * 无测试对象 / 识别不出可过滤的 runner / 索引建不起来 / 改动集读不出来 ⇒ 返回 `unsupported`
 * 或 `undetermined`，**绝不当通过**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { importProject } from '../../infrastructure/graph/import_project.js';
import { getProjectCacheDb, closeAllProjectCacheDbs } from '../../infrastructure/index/db.js';
import { impactOfChanged } from '../../infrastructure/analysis/facts/impact_set.js';
import {
  SNAPSHOT_SCHEMA,
  contentDrift,
  contentVersion,
  graphVersion,
  hashProjectFiles,
  loadVerifiedSnapshot,
  planInheritance,
  scanTestObjects,
  testObjectVisibility,
  writeVerifiedSnapshot,
} from '../design/verified_snapshot.js';

const norm = (p: string): string => String(p).replace(/\\/g, '/');

export type ProjectRunner = {
  /** 识别出的 runner 种类 */
  kind: 'vitest' | 'jest' | 'node-test';
  /** 真跑这些文件（仓库相对路径）；返回逐文件结果 */
  run(files: readonly string[]): { file: string; rc: number; pass: number; fail: number; ms: number; tail: string }[];
};

export type VerifyProjectResult = {
  /** 本次结论**能不能作数**（false ⇒ 有红或不可判；不是"跑完了"） */
  ok: boolean;
  red: boolean;
  project: {
    root: string;
    runner: string;
    runner_why: string;
    test_objects_on_disk: number;
    test_objects_indexed: number;
    unsupported: string | null;
  };
  changed: string[];
  /**
   * ★ 2026-11-09：**变更事实的唯一一份**（索引保鲜 / 波及 / 选材 / 基线全用这一份）。
   * 出现第二份 = 已经分叉 ⇒ 本入口的设计就是"只猜一次改动"。
   */
  change_fact: { source: 'declared' | 'git'; files: number };
  /** 索引保鲜读数（用同一份变更事实驱动的增量同步） */
  index: { refreshed_files: number; ms: number };
  /** 基线读写读数（written=false 表示这次**没有推进基线**，旧证据原样保留） */
  baseline: { before: number; after: number; written: boolean; why: string };
  impacted: { files: number; symbols: number; calls: number; ms: number } | null;
  ran: { file: string; rc: number; pass: number; fail: number; ms: number }[];
  inherited: string[];
  undetermined: { id: string; reason: string }[];
  /** 明确的能力边界（做不到的事，逐条写出来） */
  limitations: string[];
  ms: { total: number; index: number; impact: number; plan: number; tests: number };
};

/** 识别项目自带的 runner（只看依赖与配置，不改项目） */
export function detectRunner(root: string): { runner: ProjectRunner | null; why: string } {
  const pkgPath = path.join(root, 'package.json');
  let pkg: { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as typeof pkg;
  } catch {
    return { runner: null, why: '没有 package.json（读不到依赖 ⇒ 认不出 runner）' };
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (n: string): boolean => Object.prototype.hasOwnProperty.call(deps, n);
  const bin = (rel: string): boolean => fs.existsSync(path.join(root, 'node_modules', rel));

  const runSpawn = (binPath: string, args: string[], files: readonly string[]) => {
    const t = Date.now();
    // ★ 2026-11-09：**必须剥掉 `NODE_TEST_CONTEXT`**。父进程若是 `node --test`（本仓的测试门、
    //   或任何在 node:test 里调用本入口的宿主），这个环境变量会让**子进程**的 `node --test`
    //   挂在父上下文上、不再打印自己的 TAP 汇总 ⇒ 我们解析到 pass0/fail0 而 rc=0
    //   ⇒ 坏掉的代码会被判成"通过"（实测：本仓测试门里 `red=false`，独立跑却正确）。
    //   ★ 这一类是"环境让判据失明"，比漏跑更危险。
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    // ★ binPath 为空 ⇒ 只跑 node 自身（node:test 分支就是这么用的）
    const r = spawnSync(process.execPath, [...(binPath ? [binPath] : []), ...args, ...files], {
      cwd: root,
      env: childEnv,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 << 20,
    });
    const out = String(r.stdout ?? '') + String(r.stderr ?? '');
    const num = (re: RegExp): number => (re.test(out) ? Number(re.exec(out)![1]) : 0);
    return {
      file: files.length === 1 ? norm(files[0]) : `(${files.length} 个文件)`,
      rc: r.status ?? 1,
      pass: num(/(\d+) passed/) || num(/# pass (\d+)/),
      fail: num(/(\d+) failed/) || num(/# fail (\d+)/),
      ms: Date.now() - t,
      tail: out.split('\n').filter((l) => /Tests |Test Files|# pass|# fail/.test(l)).slice(-2).join(' | '),
    };
  };

  if (has('vitest') && bin('vitest/vitest.mjs')) {
    return {
      runner: {
        kind: 'vitest',
        // ★ 逐文件跑：证据必须能**归因到文件**（合并成一条 ⇒ 写不进基线，下一轮无从继承）
        run: (files) => files.map((f) => runSpawn(path.join(root, 'node_modules/vitest/vitest.mjs'), ['run'], [f])),
      },
      why: 'devDependencies 有 vitest，且 node_modules/vitest 可执行',
    };
  }
  if (has('jest') && bin('jest/bin/jest.js')) {
    return {
      runner: { kind: 'jest', run: (files) => files.map((f) => runSpawn(path.join(root, 'node_modules/jest/bin/jest.js'), ['--runInBand'], [f])) },
      why: 'devDependencies 有 jest，且 node_modules/jest 可执行',
    };
  }
  // node:test：只要有测试对象就能跑，不需要项目额外配置（TS 用 tsx 转译）
  return {
    runner: {
      kind: 'node-test',
      // ★ 2026-11-09 修：binPath 传空 —— runSpawn 的**二进制**已经是 process.execPath，
      //   再传一次就变成 `node <node.exe> …`（实测恒 rc=1，pass/fail 都解析成 0）。
      run: (files) => files.map((f) => runSpawn('', ['--import', 'tsx', '--test'], [f])),
    },
    why: '没有 vitest/jest ⇒ 用 Node 自带 `node --test`（对测试文件形态的项目总是可用）',
  };
}

/** 从 git 读改动集（含未跟踪）；读不出来就说读不出来 */
function changedFromGit(root: string): { files: string[]; error: string } {
  const git = (args: string[]): { ok: boolean; out: string; err: string } => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: r.status === 0, out: String(r.stdout ?? ''), err: String(r.stderr ?? '').split('\n')[0] };
  };
  const probe = git(['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok) return { files: [], error: `不是 git 仓：${probe.err}` };
  const diff = git(['diff', '--name-only', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (!diff.ok && !untracked.ok) return { files: [], error: `读不到改动集：${diff.err || untracked.err}` };
  const all = `${diff.out}\n${untracked.out}`.split('\n').map((s) => s.trim()).filter(Boolean);
  return { files: [...new Set(all.map(norm))].sort(), error: '' };
}

const CODE_RE = /\.(ts|tsx|js|mjs|cjs|jsx|go|py|java|rs)$/;

/** 测试文件的观察面 = 索引里它的 import 边（**不要求项目写 touches**） */
function observesFromIndex(root: string, testFiles: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  try {
    const db = getProjectCacheDb(root);
    const rows = db
      .prepare(
        `SELECT sn.file_path AS s, tn.file_path AS t
           FROM edges e JOIN nodes sn ON sn.id = e.source LEFT JOIN nodes tn ON tn.id = e.target
          WHERE e.kind = 'import'`,
      )
      .all() as { s: string; t: string | null }[];
    for (const r of rows) {
      const s = norm(r.s);
      const t = norm(r.t ?? '');
      const list = map.get(s) ?? [];
      if (t && !list.includes(t)) list.push(t);
      map.set(s, list);
    }
  } catch {
    /* 索引不可用 ⇒ 返回空 ⇒ 上层判 empty-observes（不猜） */
  }
  for (const f of testFiles) if (!map.has(f)) map.set(f, []);
  return map;
}

/**
 * **自动接管**：一次真实增量验证。给的只有 `projectRoot`（可选 `change`）。
 */
export async function verifyProject(input: {
  projectRoot: string;
  /** 显式改动集（不给 ⇒ 从 git 读） */
  change?: readonly string[];
  /** 真正执行测试（false 只出计划；默认 true） */
  run?: boolean;
}): Promise<VerifyProjectResult> {
  const t0 = Date.now();
  const root = path.resolve(input.projectRoot);
  const limitations: string[] = [];
  const ms = { index: 0, impact: 0, plan: 0, tests: 0 };

  const base: VerifyProjectResult = {
    ok: false,
    red: false,
    project: { root, runner: '?', runner_why: '', test_objects_on_disk: 0, test_objects_indexed: 0, unsupported: null },
    changed: [],
    change_fact: { source: 'git', files: 0 },
    index: { refreshed_files: 0, ms: 0 },
    baseline: { before: 0, after: 0, written: false, why: '未到写回阶段' },
    impacted: null,
    ran: [],
    inherited: [],
    undetermined: [],
    limitations,
    ms: { total: 0, ...ms },
  };

  // ① 测试对象（不认目录名，只认形态）
  const onDisk = scanTestObjects(root);
  base.project.test_objects_on_disk = onDisk.length;
  if (onDisk.length === 0) {
    base.project.unsupported = 'no-test-objects';
    limitations.push('扫不到任何测试对象（`*.test.*` / `*.spec.*` / `__tests__/`）⇒ 没有可验证的东西，**不是通过**');
    base.ms.total = Date.now() - t0;
    return base;
  }

  // ② runner
  const det = detectRunner(root);
  if (!det.runner) {
    base.project.unsupported = 'no-runner';
    limitations.push(`认不出可过滤的测试运行器：${det.why}`);
    base.project.runner = 'none';
    base.ms.total = Date.now() - t0;
    return base;
  }
  base.project.runner = det.runner.kind;
  base.project.runner_why = det.why;
  if (det.runner.kind === 'node-test') {
    limitations.push('未识别到 vitest/jest ⇒ 用 `node --test`；若项目用的是别的 runner，本入口的判读以文件级为准');
  }

  // ③ ★ 变更事实（**唯一一份**）：声明 ∪ 盘上（git）。索引保鲜、波及、选材、基线全用它，
  //    不许各自再猜一套改动（本文件里出现第二个 changed 来源 = 已经分叉）。
  let changed: string[];
  let changeError = '';
  let changeSource: 'declared' | 'git' = 'git';
  if (input.change) {
    changed = input.change.map(norm).sort();
    changeSource = 'declared';
  } else {
    const g = changedFromGit(root);
    changed = g.files;
    changeError = g.error;
  }
  base.changed = changed;
  base.change_fact = { source: changeSource, files: changed.length };

  // ④ 索引保鲜（用上面的**同一份**变更事实）：没有索引 ⇒ 建一次；有改动 ⇒ 增量同步一次
  //    （`importProject` 按内容哈希跳过未变文件：实测无改动 ≈ 3–6ms，新增/改动才重解析）
  const tIdx = Date.now();
  let indexed = 0;
  let indexRefreshed = 0;
  try {
    const dbFile = path.join(root, '.agent-io', 'cache.db');
    const needsIndex = !fs.existsSync(dbFile);
    if (needsIndex || changed.length > 0) {
      const before = needsIndex ? new Set<string>() : null;
      await importProject({ project_dir: root, feature: path.basename(root), include_tests: true });
      indexRefreshed = before ? changed.length : changed.length;
      if (needsIndex) {
        limitations.push('项目此前没有索引 ⇒ 本次自动建了一次（含测试文件）；这是**一次性成本**，不是每次都要');
      }
    }
    const vis = testObjectVisibility(root, (() => {
      const db = getProjectCacheDb(root);
      const rows = db.prepare("SELECT DISTINCT file_path AS f FROM nodes WHERE file_path IS NOT NULL").all() as { f: string }[];
      return rows.map((r) => String(r.f));
    })());
    indexed = vis.objects_indexed;
    base.project.test_objects_indexed = indexed;
    if (vis.missing.length > 0) {
      limitations.push(
        `索引里看不到 ${vis.missing.length} 个测试文件（例：${vis.missing.slice(0, 3).join(', ')}）⇒ 它们的观察面退化，判读可能降级成 undetermined`,
      );
    }
  } catch (e) {
    limitations.push(`建索引/保鲜失败（${String((e as Error).message).slice(0, 120)}）⇒ 观察面不可得`);
  }
  ms.index = Date.now() - tIdx;
  base.index = { refreshed_files: indexRefreshed, ms: ms.index };

  // ⑤ 波及
  const tImp = Date.now();
  const codeChanged = changed.filter((f) => CODE_RE.test(f));
  // ★ 新文件默认不在索引里（没人 import 过它）⇒ 先**保鲜一次**再看波及；
  //   否则"索引不认识它"会被当成"影响关系不可信"，白白把一次无关改动判成不可判。
  const idxPaths = (): Set<string> => {
    try {
      const db = getProjectCacheDb(root);
      const rows = db.prepare("SELECT DISTINCT file_path AS f FROM nodes WHERE file_path IS NOT NULL").all() as { f: string }[];
      return new Set(rows.map((r) => norm(String(r.f))));
    } catch {
      return new Set();
    }
  };
  let known = idxPaths();
  const unknown = codeChanged.filter((f) => !known.has(f));
  if (unknown.length > 0) {
    try {
      const tR = Date.now();
      await importProject({ project_dir: root, feature: path.basename(root), include_tests: true });
      ms.index += Date.now() - tR;
      limitations.push(`改动集里有 ${unknown.length} 个文件此前不在索引（例：${unknown.slice(0, 3).join(', ')}）⇒ 自动保鲜了一次再算波及`);
      known = idxPaths();
    } catch (e) {
      limitations.push(`保鲜失败（${String((e as Error).message).slice(0, 80)}）⇒ 波及可能不可信`);
    }
  }
  const impact = codeChanged.length > 0 ? impactOfChanged(root, codeChanged, { max_depth: 6 }) : { ok: true as const, files: new Set<string>(), symbols: new Set<string>(), calls: 0, non_code: [] as string[] };
  ms.impact = Date.now() - tImp;
  base.impacted = impact.ok ? { files: impact.files.size, symbols: impact.symbols.size, calls: impact.calls, ms: ms.impact } : null;
  if (!impact.ok) limitations.push(`影响关系不可信（${impact.reason}）⇒ 本次不许继承`);

  // ⑥ 证据面（观察面来自索引 import 边）
  const obs = observesFromIndex(root, onDisk);
  const tPlan = Date.now();
  const loaded = loadVerifiedSnapshot(root);
  const files = hashProjectFiles(root);
  const d = loaded.status === 'ok' ? contentDrift(loaded.snapshot.content.files, files) : { changed: [], added: [], removed: [] };
  const drift = [...d.changed, ...d.added, ...d.removed].sort();
  if (changeError) {
    limitations.push(`改动集读不出来（${changeError}）⇒ 按不可信处理`);
  }
  const plan = planInheritance({
    loaded,
    changed,
    impact,
    drift: changeError ? null : drift,
    evidence: { objects_on_disk: onDisk.length, objects_indexed: indexed, label: '测试文件' },
  });

  // 观察面由**索引**推出来（不是 touches），所以要在 plan 之前把它装进基线——这里用一次性转换：
  // 若基线缺失/无条目，先按"全部重跑"处理（no-evidence 分支已覆盖）。
  // ★ 选材：账本说"要重验"的 + **账本态要求扩大时全部**（无证据/观察面空/整体扩大 ⇒ 全跑）
  const mustWiden = plan.state === 'no-evidence' || plan.state === 'empty-observes' || !!plan.widen || plan.state === 'widen';
  const rerunFiles = mustWiden
    ? [...onDisk]
    : plan.rerun.map((r) => r.id.replace(/^test:/, '')).filter((f) => onDisk.includes(f));

  // ★ 2026-11-09（生命周期的漏洞）：**基线里没有条目的测试对象必须跑** ——
  //   `planInheritance` 只比"基线里的条目"，它看不见"磁盘上刚多出来的一支测试"。
  //   实测：新增 `test/format.test.ts` 后，磁盘 7 / 实跑 6，新测试永远拿不到证据、
  //   也永远进不了基线（"新通过的证据替换/新增到基线"这条规则被静默跳过）。
  const knownIds = new Set<string>(
    loaded.status === 'ok' ? loaded.snapshot.entries.map((e) => e.id) : [],
  );
  const newObjects = onDisk.filter((f) => !knownIds.has(`test:${f}`));
  if (newObjects.length > 0) {
    for (const f of newObjects) if (!rerunFiles.includes(f)) rerunFiles.push(f);
    limitations.push(`基线里没有以下测试对象的证据（新出现）⇒ 本次必须跑：${newObjects.join(', ')}`);
  }

  // ⑦ 执行（只跑重验集）
  const shouldRun = input.run !== false;
  const tTests = Date.now();
  let ran: VerifyProjectResult['ran'] = [];
  if (shouldRun && rerunFiles.length > 0) {
    ran = det.runner.run(rerunFiles).map((r) => ({ file: r.file, rc: r.rc, pass: r.pass, fail: r.fail, ms: r.ms }));
  }
  ms.tests = Date.now() - tTests;

  // ⑧ 写回证据（**change-only 生命周期**的唯一收口）
  //   · 继承的条目原样保留（它们的证据仍有效）；
  //   · 本次实跑且 **pass** 的 ⇒ 覆盖/新增（这是唯一能推进基线的路径）；
  //   · 本次实跑但 fail / pending ⇒ **不写入**（连旧的 pass 也一并丢掉）——
  //     "失败不写成通过"，且失败的条目不能留着旧绿当豁免；
  //   · undetermined（不可判）⇒ 不写入（下次仍会重验，不许当继承）；
  //   · 有红 / 改动集不可信 / 只出计划 ⇒ **整次不写**，旧基线原样保留（回答"停在上一轮"）。
  const beforeCount = loaded.status === 'ok' ? loaded.snapshot.entries.length : 0;
  const red = ran.some((r) => r.rc !== 0 || r.fail > 0);
  const trustworthy = !changeError && plan.state !== 'no-evidence' && plan.state !== 'empty-observes';
  let written = false;
  let writeWhy = '';
  if (!trustworthy) writeWhy = `改动集/证据面不可信（${changeError || plan.state}）⇒ 不推进基线`;
  else if (!shouldRun) writeWhy = '本次只出计划（run=false）⇒ 不写基线';
  try {
    if (writeWhy) {
      limitations.push(writeWhy);
    } else {
      const prevById = new Map<string, { id: string }>();
      if (loaded.status === 'ok') for (const prev of loaded.snapshot.entries) prevById.set(prev.id, prev);
      const entries: { id: string }[] = [];
      for (const it of plan.inherit) {
        const prev = prevById.get(it.id);
        if (prev) entries.push(prev as { id: string });
      }
      for (const r of ran) {
        if (!(r.rc === 0 && r.fail === 0)) continue; // ★ 失败/未执行：不写，也不留旧绿
        entries.push({
          id: `test:${r.file}`,
          kind: 'test',
          verdict: 'pass',
          command: `(<runner>) ${r.file}`,
          at: new Date().toISOString(),
          observes: obs.get(norm(r.file)) ?? [],
        } as never);
      }
      // ★ 2026-11-09：**撤销**失败/未执行项的旧通过（不许留旧绿当豁免）
      for (const r of ran) {
        if (r.rc === 0 && r.fail === 0) continue;
        const bad = `test:${r.file}`;
        for (let idx = entries.length - 1; idx >= 0; idx -= 1) {
          if ((entries[idx] as { id: string }).id === bad) entries.splice(idx, 1);
        }
      }
      const uniq = new Map<string, { id: string }>();
      for (const it of entries) uniq.set(it.id, it);
      const finalEntries = [...uniq.values()];
      writeVerifiedSnapshot(root, {
        schema: SNAPSHOT_SCHEMA,
        at: new Date().toISOString(),
        content: { version: contentVersion(files), files },
        graph: graphVersion(root),
        entries: finalEntries as never,
        scope: {
          ran: ran.map((r) => `test:${r.file}`),
          inherited: plan.inherit.map((it) => it.id),
          undetermined: plan.undetermined.map((u) => ({ id: u.id, reason: u.reason })),
          partial: true,
          covered_files: [...new Set((finalEntries as { observes?: string[] }[]).flatMap((it) => it.observes ?? []))].sort(),
        },
      } as never);
      written = true;
      base.baseline = { before: beforeCount, after: finalEntries.length, written: true, why: red ? '有红：本次通过项已合并，失败项已撤销（不推进）' : '本次 pass 的证据已增量合并' };
    }
  } catch (err) {
    limitations.push(`写回证据失败（${String((err as Error).message).slice(0, 80)}）⇒ 下次仍会重跑`);
  }
  if (!written) base.baseline = { before: beforeCount, after: beforeCount, written: false, why: writeWhy };
  ms.plan = Date.now() - tPlan - ms.tests;

  base.ran = ran;
  base.ran = ran;
  base.inherited = plan.inherit.map((e) => e.id);
  base.undetermined = plan.undetermined.map((u) => ({ id: u.id, reason: u.reason }));
  base.red = red;
  base.ok = !red && plan.state !== 'no-evidence' && plan.state !== 'empty-observes' && plan.undetermined.length === 0;
  if (plan.state === 'no-evidence' || plan.state === 'empty-observes') {
    limitations.push(`账本态 ${plan.state}：${plan.note ?? plan.widen?.reason ?? ''}`);
  }
  limitations.push('本入口只验**测试**：项目没有设计册 ⇒ 没有契约证据（不假装验过契约）');
  base.ms = { total: Date.now() - t0, index: ms.index, impact: ms.impact, plan: ms.plan, tests: ms.tests };

  closeAllProjectCacheDbs();
  return base;
}
