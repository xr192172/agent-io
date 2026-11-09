/**
 * P1 · `verifyProject` 的 **change-only 生命周期**（引擎托管，无人手工维护基线）
 *
 * touches: src/application/verify/verify_project.ts, src/application/design/verified_snapshot.ts
 *
 * 钉住四步（2026-11-09 用户验收原文）：
 *   ① 连续两次小改动，第二次**自动使用**第一次更新后的基线；
 *   ② 只有**受影响**测试重跑，其余有效证据自动**继承**；
 *   ③ 第三次**改坏**相关行为 ⇒ 失败，且基线**不推进**（失败项的旧通过被撤销）；
 *   ④ 第四次修复后**只用必要重验**恢复证据。
 *
 * 还钉两条不变量：
 *   ⑤ 索引保鲜与验证用**同一份**变更事实（`change_fact.files` 与 `change_fact.source` 反映同一批文件，
 *      且索引保鲜的同步数量来自这份事实，而不是另算一遍）；
 *   ⑥ **不需要任何"更新基线"命令**：本测试从头到尾只调 `verifyProject`，基线自动前进/回退。
 *
 * 为什么用真 runner（vitest）而不是桩：本入口的价值就在"用项目自己的 runner 只跑必要项"，
 * 桩掉它就等于把被测对象换成我自己写的假货。代价是慢（每步 1–2 次 spawn），可接受。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { verifyProject } from '../src/application/verify/verify_project.js';
import { loadVerifiedSnapshot } from '../src/application/design/verified_snapshot.js';

const REPO = process.cwd();

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, stdio: 'ignore' });
}

/** 一个真实可跑的小项目：两个源文件 + 两个测试文件（**两支**是为了让"继承"可观测） */
function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-life-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  // ★ 必须先忽略 node_modules / .agent-io：否则 `git add -A` 会把 68MB 依赖和索引塞进改动集
  //   （实测：不忽略时整支测试 28s，且 change_fact 里混进一堆依赖文件）
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n.agent-io\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'vp-life', version: '1.0.0', type: 'module' }, null, 2),
  );
  // 用仓里的 node_modules（junction）——与 `p1_incremental_cli` 同一手法，不装新依赖
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function a(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export function b(): number {\n  return 2;\n}\n');
  fs.writeFileSync(
    path.join(root, 'test', 'a.test.ts'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { a } from '../src/a';\ntest('a', () => {\n  assert.equal(a(), 1);\n});\n",
  );
  fs.writeFileSync(
    path.join(root, 'test', 'b.test.ts'),
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { b } from '../src/b';\ntest('b', () => {\n  assert.equal(b(), 2);\n});\n",
  );
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return root;
}

const verdicts = (root: string): string[] =>
  (loadVerifiedSnapshot(root).status === 'ok'
    ? (loadVerifiedSnapshot(root) as { snapshot: { entries: Array<{ id: string; verdict: string }> } }).snapshot.entries.map(
        (e) => `${e.id}=${e.verdict}`,
      )
    : []
  ).sort();

const log = (tag: string, r: Awaited<ReturnType<typeof verifyProject>>): void => {
  console.log(
    `[${tag}] changed=${JSON.stringify(r.changed)} ran=${JSON.stringify(r.ran.map((x) => `${x.file}:rc${x.rc}/p${x.pass}/f${x.fail}`))} inherited=${r.inherited.length} red=${r.red} ok=${r.ok} baseline=${r.baseline.before}=>${r.baseline.after} written=${r.baseline.written} reason=${r.baseline.why} runner=${r.project.runner} lim=${JSON.stringify(r.limitations.slice(0, 2))}`,
  );
};

test('P1-lifecycle · 建账 → 无改动继承 → 两次小改 → 改坏不推进 → 修复恢复（全程无人手工维护基线）', async () => {
  const root = mkProject();
  try {
    // ── 第 0 步：首次无基线 ⇒ 必须全跑并建账（这是唯一允许"全跑"的入口情形之一）
    const s0 = await verifyProject({ projectRoot: root });
    log('s0', s0);
    assert.equal(s0.ok, true, `建账这次必须作数：${JSON.stringify({ red: s0.red, und: s0.undetermined })}`);
    assert.equal(s0.ran.length, 2, `首次无基线 ⇒ 两支都要跑（实测 ${s0.ran.length}）`);
    assert.equal(s0.baseline.written, true, '首次必须写基线');
    assert.equal(s0.baseline.after, 2, `建账后基线应有 2 条（实测 ${s0.baseline.after}）`);
    assert.equal(
      s0.change_fact.files,
      s0.changed.length,
      '★ 变更事实只有一份：change_fact.files 必须等于 changed.length（无基线时也可以是 0）',
    );
    assert.deepEqual(verdicts(root), ['test:test/a.test.ts=pass', 'test:test/b.test.ts=pass']);

    // ── 第 1 步：无真实改动 ⇒ 直接继承，不跑任何测试
    const s1 = await verifyProject({ projectRoot: root });
    log('s1', s1);
    assert.equal(s1.changed.length, 0, `干净树上不该有改动（实测 ${JSON.stringify(s1.changed)}）`);
    assert.equal(s1.ran.length, 0, `无改动 ⇒ 一条都不该跑（实测 ${s1.ran.length}）`);
    assert.equal(s1.inherited.length, 2, `无改动 ⇒ 两条都继承（实测 ${s1.inherited.length}）`);
    assert.equal(s1.baseline.written, true, '无改动也要把基线钉住（written=true，但条数不变）');
    assert.equal(s1.baseline.after, s1.baseline.before, '无改动时基线条数不得变化');

    // ── 第 2 步：改动 1（只动 src/a.ts）⇒ 只重跑 a 那支，b 继承；基线更新
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function a(): number {\n  return 1 + 0;\n}\n');
    // ★ 改动**不提交**：git 改动集 = 相对 HEAD 的差异，是内环/本入口的变更事实来源
    const s2 = await verifyProject({ projectRoot: root });
    log('s2', s2);
    assert.ok(s2.changed.includes('src/a.ts'), `改动集必须含 src/a.ts（实测 ${JSON.stringify(s2.changed)}）`);
    assert.equal(s2.change_fact.source, 'git', '声明式变更没给 ⇒ 事实来源是 git');
    assert.equal(s2.change_fact.files, s2.changed.length, '★ 变更事实只有一份：change_fact.files 必须等于 changed.length');
    assert.equal(s2.ran.length, 1, `★ 只有受影响的 a 那支该跑（实测 ${s2.ran.length}）`);
    assert.equal(normFile(s2.ran[0].file), 'test/a.test.ts', `跑的是 a：${s2.ran[0].file}`);
    assert.deepEqual(
      s2.inherited.sort(),
      ['test:test/b.test.ts'],
      `★ b 必须继承、不给重跑（实测 ${JSON.stringify(s2.inherited)}）`,
    );
    assert.equal(s2.baseline.after, 2, '基线仍是 2 条（a 被覆盖，不是新增）');

    // ── 第 3 步：改动 2（还是只动 src/a.ts）⇒ 必须**用第 1 次更新后的基线**，即 b 仍继承
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function a(): number {\n  return 1 * 1;\n}\n');
    // ★ 改动**不提交**：git 改动集 = 相对 HEAD 的差异，是内环/本入口的变更事实来源
    const s3 = await verifyProject({ projectRoot: root });
    log('s3', s3);
    assert.equal(s3.ran.length, 1, `第二次小改仍只跑 a（实测 ${s3.ran.length}）`);
    assert.deepEqual(s3.inherited.sort(), ['test:test/b.test.ts'], `★ b 由**第一次更新后的基线**提供继承：${JSON.stringify(s3.inherited)}`);
    assert.equal(s3.baseline.after, 2, '基线仍 2 条');

    // ── 第 4 步：改坏相关行为 ⇒ 必须红，且**基线不推进**（该条的旧通过被撤销）
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function a(): number {\n  return 99;\n}\n');
    // ★ 改动**不提交**：git 改动集 = 相对 HEAD 的差异，是内环/本入口的变更事实来源
    const s4 = await verifyProject({ projectRoot: root });
    log('s4', s4);
    assert.equal(s4.red, true, '★ 改坏必须红');
    assert.equal(s4.ok, false, '★ 有红 ⇒ 本次不可作数');
    assert.equal(s4.ran.length, 1, '仍然只跑 a');
    assert.equal(s4.baseline.after < s4.baseline.before, true, `★ 失败项必须撤销：${s4.baseline.before} ⇒ ${s4.baseline.after}`);
    assert.deepEqual(verdicts(root), ['test:test/b.test.ts=pass'], '★ 基线里不许留下 a 的旧通过（失败不写成通过）');

    // ── 第 5 步：修复 ⇒ 只用必要重验恢复证据
    // ★ 修复必须**仍然是工作区改动**（不能恢复成 HEAD 里的内容）：HEAD 是 `return 1`，
    //   若原样写回 ⇒ git 改动集为空、而基线记的是坏版本 ⇒ 入口会判"改动集不完整"并扩大（那是正确口径，但不是本步要验的）
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function a(): number {\n  return 0 + 1;\n}\n');
    // ★ 改动**不提交**：git 改动集 = 相对 HEAD 的差异，是内环/本入口的变更事实来源
    const s5 = await verifyProject({ projectRoot: root });
    log('s5', s5);
    assert.equal(s5.red, false, '修复后不该再有红');
    assert.equal(s5.ran.length, 1, '只重验被撤销的那一支');
    assert.equal(s5.baseline.after, 2, `★ 证据恢复为 2 条（实测 ${s5.baseline.after}）`);
    assert.deepEqual(verdicts(root), ['test:test/a.test.ts=pass', 'test:test/b.test.ts=pass']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function normFile(p: string): string {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}
