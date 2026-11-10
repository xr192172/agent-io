/**
 * touches: src/application/design/dsl_ops/update_feature.ts · src/application/design/dsl_ops/{file_ops,api_ops,edge_ops,node_ops}.ts · src/infrastructure/storage.ts
 *
 * P0 · **DSL 乐观锁接回主写路径** 的机器回归 —— 2026-11-10（第⑫项）
 *
 * ## 验收标准（lead 三条）
 * ① 两会话：A edit_dsl 写后，B 拿**旧 rev 的全量对象**直接 saveDSL ⇒ 冲突错（不是静默成功）；
 * ② B 重取后重写 ⇒ 成功（冲突不是死锁）+ A 的改动还在（覆盖丢检测）；
 * ③ 单会话连续两次**独立** edit_dsl 调用 ⇒ 不自冲突（每次调用各自 getDSL 拿新 rev；
 *    ★ 并发窗口只在两次独立调用之间——单次调用的多 op 是顺序执行，op 间无窗口，lead 纠偏确认）。
 * ④ 兼容回落：无 rev 的对象（现构造）⇒ 不校验（行为不变）。
 *
 * ## 夹具（p1_opl_goal_entry 同模式：临时项目 + git init + import_project——已验证能跑）
 * 手写 DSL 落 AGENT_IO_DATA_ROOT 的路径不可靠（getDSL 走注册表→项目根解析），importProject 是唯一建档入口。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { importProject } from '../src/infrastructure/graph/import_project.js';
import { getDSL, saveDSL } from '../src/infrastructure/storage.js';
import { runDslWriteScope } from '../src/infrastructure/dsl_write_scope.js';
import { updateFeature } from '../src/application/design/dsl_ops/update_feature.js';
import { closeAllProjectCacheDbs } from '../src/infrastructure/index/db.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// ★★ FEATURE 名**每 test 唯一**：④ 曾与 ①②③ 共名 ⇒ 前面测试的 cleanup（closeAllProjectCacheDbs +
//   rmSync root）让后面重新登记时踩到已关的 db 句柄/已删的根（实测 TypeError）。独立名 = 独立登记，互不踩。
let seq = 0;
const featureName = (): string => `dsl-lock-${++seq}`;

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
}

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-lock-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.agent-io\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dsl-lock', version: '1.0.0', type: 'module' }, null, 2));
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  // 两个"有依赖关系"的文件（缺口 2 的边界声明素材；本测试只考锁）
  fs.writeFileSync(path.join(root, 'src', 'alpha.ts'), 'export function alpha(raw: string): string {\n  return raw.trim();\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'beta.ts'), "import { alpha } from './alpha.js';\n\nexport function beta(raw: string): string {\n  return alpha(raw);\n}\n");
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return root;
}

function cleanup(root: string): void {
  closeAllProjectCacheDbs();
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows 句柄偶发未释放 */
  }
}

test('P0-dsl-lock · ①两会话：A edit_dsl 写后，B 拿旧 rev 全量对象 saveDSL ⇒ 冲突错（不静默吞）', async () => {
  const root = mkProject();
  const FEATURE = featureName();
  try {
    await importProject({ project_dir: root, feature: FEATURE } as never);
    // 会话 A：独立 edit_dsl 调用（内部 getDSL→saveDSL 传 rev）
    await updateFeature({
      feature: FEATURE,
      operations: [{ type: 'decision', op: 'update', id: 'file_src_alpha_ts', data: { summary: 'A 的改动' } }],
      reason: '会话 A 的写入（乐观锁测试①）',
    });
    // 会话 B：拿 **A 写之前的旧 rev** 的全量对象直接 saveDSL（模拟 B 在 A 写前 getDSL 后一直没重取）
    const stale = getDSL(FEATURE);
    assert.ok(stale, '册应存在');
    const cur = getDSL(FEATURE);
    const curRev = cur?._dsl_rev ?? 0;
    // 把 stale 的 rev 拨回 A 写前（curRev - 1）：这正是"B 没重取"的机器形态
    const staleSnapshot = JSON.parse(JSON.stringify({ ...stale, _dsl_rev: curRev - 1 }));
    staleSnapshot.geometry.nodes = staleSnapshot.geometry.nodes.map((n: { id: string; decision?: { summary?: string } }) =>
      n.id === 'file_src_alpha_ts' ? { ...n, decision: { summary: 'B 的旧覆盖' } } : n,
    );
    assert.throws(
      () => saveDSL(staleSnapshot as never, 'mcp', staleSnapshot._dsl_rev),
      /已被他人更新|冲突|rev/i,
      'B 拿旧 rev 写必须被拒（A 的改动不许被静默吞）',
    );
  } finally {
    cleanup(root);
  }
});

test('P0-dsl-lock · ②重取后重写 ⇒ 成功 + A 的改动还在（覆盖丢检测）', async () => {
  const root = mkProject();
  const FEATURE = featureName();
  try {
    await importProject({ project_dir: root, feature: FEATURE } as never);
    await updateFeature({
      feature: FEATURE,
      operations: [{ type: 'decision', op: 'update', id: 'file_src_alpha_ts', data: { summary: 'A 的改动' } }],
      reason: '会话 A（乐观锁测试②）',
    });
    // B **重取**（拿 A 写后的新 rev）→ 独立 edit_dsl 写别的节点 ⇒ 应成功
    await updateFeature({
      feature: FEATURE,
      operations: [{ type: 'decision', op: 'update', id: 'file_src_beta_ts', data: { summary: 'B 重取后的改动' } }],
      reason: '会话 B 重取后重写（乐观锁测试②）',
    });
    // 且 A 的改动还在（没被 B 覆盖丢）
    const after = getDSL(FEATURE);
    const aNode = after?.geometry.nodes.find((n) => n.id === 'file_src_alpha_ts');
    assert.match(String(aNode?.decision?.summary ?? ''), /A 的改动/, 'A 的改动必须还在');
    const bNode = after?.geometry.nodes.find((n) => n.id === 'file_src_beta_ts');
    assert.match(String(bNode?.decision?.summary ?? ''), /B 重取后的改动/, 'B 的改动也应落上');
  } finally {
    cleanup(root);
  }
});

test('P0-dsl-lock · ③单会话连续两次**独立** edit_dsl 调用 ⇒ 不自冲突（lead 纠偏：窗口在调用之间）', async () => {
  const root = mkProject();
  const FEATURE = featureName();
  try {
    await importProject({ project_dir: root, feature: FEATURE } as never);
    // 两次**独立**调用（不是一次调用里两个 op——单次调用的 op 顺序执行无窗口）：
    // 第二次调用内部会重新 getDSL ⇒ 拿到第一次写后的新 rev ⇒ 不该自冲突
    const r1 = await updateFeature({
      feature: FEATURE,
      operations: [{ type: 'decision', op: 'update', id: 'file_src_alpha_ts', data: { summary: '连续写第一次' } }],
      reason: '单会话连续写 1',
    });
    assert.ok(r1);
    const r2 = await updateFeature({
      feature: FEATURE,
      operations: [{ type: 'decision', op: 'update', id: 'file_src_alpha_ts', data: { summary: '连续写第二次' } }],
      reason: '单会话连续写 2',
    });
    assert.ok(r2, '连续独立调用不应自冲突');
    const final = getDSL(FEATURE);
    assert.match(
      String(final?.geometry.nodes.find((n) => n.id === 'file_src_alpha_ts')?.decision?.summary ?? ''),
      /第二次/,
    );
  } finally {
    cleanup(root);
  }
});

test('P0-dsl-lock · ④兼容回落：无 _dsl_rev 的对象（现构造）⇒ 不校验（行为不变）', async () => {
  const root = mkProject();
  const FEATURE = featureName();
  try {
    await importProject({ project_dir: root, feature: FEATURE } as never);
    // 现构造的对象（非 getDSL 产出）没有 _dsl_rev ⇒ saveDSL(undefined) ⇒ 走旧路径不校验。
    // ★ 授权上下文：saveDSL 内部的 assertDslWriteAllowed 需要 scope（否则"没有写授权"拒——
    //   与乐观锁无关的那道闸）。`via:'import'` 不经 toolWrites 表（只有 via:'tool' 才查）⇒ 干净的授权态。
    const bare = JSON.parse(JSON.stringify(getDSL(FEATURE)));
    delete bare._dsl_rev;
    const r = await runDslWriteScope({ via: 'import', who: 'dsl-lock-test' }, () => {
      try {
        saveDSL(bare as never, 'import', undefined);
        return 'PASS: doesNotThrow（无 rev ⇒ 不校验乐观锁）';
      } catch (e) {
        return 'FAIL: ' + String(e.message).slice(0, 200);
      }
    });
    assert.match(r, /^PASS/, r);
  } finally {
    cleanup(root);
  }
});
