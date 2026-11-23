/**
 * P0 · **增量纪律收紧**（第⑬项第四刀，用户拍板）——白名单外的 no-evidence 不再自动扩大全跑。
 *
 * ## 验收标准（lead 三条）
 * ① 改动集全是白名单外文件 + 账本态 no-evidence ⇒ 不注入 no-evidence-full（不全跑）；
 * ② 改动集含白名单文件 + no-evidence ⇒ 仍强制全跑（noEvidenceWiden = true）；
 * ③ no-work 态不受影响（0 对象本来就没活干，恒为说明性）。
 *
 * ## 测法（脚本层逻辑，直跑 verify-changed 的判定表达式）
 * 判定住 `scripts/verify-changed.mjs`（脚本非模块）⇒ 本测试用**同一把尺**（WIDEN_PATTERNS 从 dist 导入）
 * 重放判定表达式，并**逐字校验脚本源码里的分支存在**（防有人改脚本把分支删了——字面量锚定）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WIDEN_PATTERNS } = await import('../src/application/design/verified_snapshot.js');

/** 与 verify-changed.mjs :523 同一表达式（改脚本必须同步这里——字面量锚定） */
function decideNoEvidenceWiden(state: string, changed: readonly string[]): boolean {
  const changedHitsWiden = WIDEN_PATTERNS.some((re) => changed.some((c) => re.test(c)));
  return (state === 'no-evidence' || state === 'empty-observes') && changedHitsWiden;
}

test('P0-widen-whitelist · ①白名单文件变更 + no-evidence ⇒ 扩大（保守正确）', () => {
  assert.equal(decideNoEvidenceWiden('no-evidence', ['scripts/verify.mjs']), true, '判定器变更 ⇒ 扩大');
  assert.equal(decideNoEvidenceWiden('no-evidence', ['src/domain/expectation_kinds.ts']), true, 'expectation_kinds ⇒ 扩大');
  assert.equal(decideNoEvidenceWiden('empty-observes', ['package.json']), true, 'package.json ⇒ 扩大');
});

test('P0-widen-whitelist · ②白名单外文件变更 + no-evidence ⇒ 不扩大（收紧的核心）', () => {
  assert.equal(decideNoEvidenceWiden('no-evidence', ['src/application/some_tool_impl.ts']), false, '普通实现文件 ⇒ 不扩大');
  assert.equal(decideNoEvidenceWiden('empty-observes', ['src/application/refactor/edit/new_helper.ts']), false, '新 helper ⇒ 不扩大');
});

test('P0-widen-whitelist · ②b 第二企划补全：verify_project.ts / verifier_proof_pack.ts 在名单内 ⇒ 扩大', () => {
  assert.equal(decideNoEvidenceWiden('no-evidence', ['src/application/verify/verify_project.ts']), true, '验证器检测/归因文件 ⇒ 扩大');
  assert.equal(decideNoEvidenceWiden('empty-observes', ['src/application/design/verifier_proof_pack.ts']), true, '自证包本体 ⇒ 扩大（自指回路双保险）');
  // 新正则只匹配各自文件，不误伤同目录其它实现
  assert.equal(decideNoEvidenceWiden('no-evidence', ['src/application/verify/other_helper.ts']), false, 'verify 目录其它文件不在名单');
  assert.equal(decideNoEvidenceWiden('no-evidence', ['src/application/design/other.ts']), false, 'design 目录其它文件不在名单');
});

test('P0-widen-whitelist · ③混合改动（白名单+非白名单）⇒ 扩大（保守正确）', () => {
  assert.equal(
    decideNoEvidenceWiden('no-evidence', ['src/application/impl.ts', 'scripts/judge-all.mjs']),
    true,
    '混合 ⇒ 任一白名单命中即扩大',
  );
});

test('P0-widen-whitelist · ④脚本源码里的分支锚定（防删分支的假绿）', () => {
  const s = fs.readFileSync(path.join(REPO, 'scripts', 'verify-changed.mjs'), 'utf8');
  // 三个字面量锚：判定表达式 / 继承分支 / 节省读数——少一个 = 分支被删
  assert.ok(s.includes("const noEvidenceWiden = snapPlan && (snapPlan.state === 'no-evidence' || snapPlan.state === 'empty-observes') && changedHitsWiden;"), '判定表达式必须在');
  assert.ok(s.includes("kind: 'no-evidence-inherit'"), '说明性继承分支必须在');
  assert.ok(s.includes('该文件的契约覆盖待建'), '继承读数必须在（0.12：决定要可见）');
  // 第二企划：两条新正则在名单源码里（防名单补全被回滚）
  const vs = fs.readFileSync(path.join(REPO, 'src', 'application', 'design', 'verified_snapshot.ts'), 'utf8');
  assert.ok(vs.includes('/^src\\/application\\/verify\\/verify_project\\.ts$/'), 'verify_project.ts 正则必须在名单源码');
  assert.ok(vs.includes('/^src\\/application\\/design\\/verifier_proof_pack\\.ts$/'), 'verifier_proof_pack.ts 正则必须在名单源码');
});
