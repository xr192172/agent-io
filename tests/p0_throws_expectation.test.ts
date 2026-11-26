/**
 * touches: src/application/design/intent/expectations.ts
 *
 * ★ 这一行让**增量验证**能把这支测试归因到被改的文件（没它 ⇒ 只能进"未声明"，永远不会被自动选中）。
 * P0 · `behavior-cases` 的**「预期抛错」口径**（修 `docs/todo.md#T-#BEHAVIOR-CASES-CANT-EXPRESS-THROW`）。
 *
 * ## 为什么需要这组用例
 * 旧口径下 harness 把 `throw` 记成 `{ok:false, error}`，`judgeExpectations` **一遇 `!r.ok` 直接判 bad**
 * ⇒ 「必须在某情形下抛」这类要求**系统性落在判据生态之外**（只能写进单测，而单测不参与 `judge`）。
 * 那意味着：**一张卡可以"后态判据全过"而"该抛的没抛"**。本组用例钉住新口径的四种结局。
 *
 * ## 四条（每条都必须是"错而没有声音"的那一类）
 * ① **预期抛错且命中** ⇒ 该 case 通过（`pass`）—— 这是内核；
 * ② **不抛错** ⇒ 必须红 —— 否则"加到实现里再删掉"不会被发现；
 * ③ **抛了但文本不符** ⇒ 必须红 —— 否则"任意抛错都能过"，判据被放宽成恒绿；
 * ④ **压根没执行**（harness 跑不了 / 符号不存在）⇒ `unsupported`，**不许**伪装成 pass 或 fail。
 *
 * ## 夹具自治
 * 单测部分只调纯函数（不碰文件系统）；端到端部分用**本仓真实函数** `src/domain/rate.ts#rateOf`
 * 走真实 `judgeExpectations`（它是一条 fail-closed 校验函数：非法 n/d 必抛）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const { classifyThrowsExpectation, judgeExpectations } = await import(
  '../src/application/design/intent/expectations.js'
);
const { ensureProjectIndex } = await import('../src/infrastructure/index/index_freshness.js');
const { closeProjectCacheDb } = await import('../src/infrastructure/index/db.js');

/**
 * ★ #188 测试隔离：被测函数 `src/domain/rate.ts#rateOf` 零依赖 ⇒ 临时工程只复制这一份，
 * 不拿主仓根当 project_dir（项目库跟 project_dir 走，避免 worker 与 judge-all 争写主仓 WAL）。
 */
function makePilotProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-throws-'));
  fs.mkdirSync(path.join(root, 'src', 'domain'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'src', 'domain', 'rate.ts'), path.join(root, 'src', 'domain', 'rate.ts'));
  return root;
}

function dropPilotProject(root: string): void {
  try {
    closeProjectCacheDb(root);
  } catch {
    /* 没有库 / 已关 */
  }
  fs.rmSync(root, { recursive: true, force: true });
}

/** 判一条 behavior-cases，返回该条的四态 */
async function verdictOf(expectation, root: string) {
  const rep = await judgeExpectations(root, [{ id: 'throws-probe', expectation }]);
  const it = rep.items[0];
  // ★ 分母必须现算且在场：每次只判一条，checked 必须恰好是 1（不许"什么都没判"也叫过）
  assert.equal(rep.checked, 1, `分母必须是 1，实得 ${rep.checked}`);
  return { verdict: it.verdict, detail: String(it.detail ?? '') };
}

const exp = (cases) => ({
  kind: 'behavior-cases',
  path: 'src/domain/rate.ts',
  symbol: 'rateOf',
  why: 'P0 用例：rateOf 对非法 n/d 必须抛错（fail-closed 校验函数的正确行为）。',
  cases,
});
const Q = 'design-db-covers-source';

test('① 纯函数：throws: 前缀的三态', () => {
  assert.deepEqual(classifyThrowsExpectation('throws:必须是非负整数', 'Error: n/d 必须是非负整数'), {
    kind: 'match',
    includes: '必须是非负整数',
  });
  assert.deepEqual(classifyThrowsExpectation('throws:必须是非负整数', 'Error: 别的问题'), {
    kind: 'mismatch',
    includes: '必须是非负整数',
  });
  assert.deepEqual(classifyThrowsExpectation('{"a":1}', '任意错误'), { kind: 'not-throws' });
  // ★ 空子串不许成为"任意抛错都能过"的后门
  assert.deepEqual(classifyThrowsExpectation('throws:', '任意错误'), { kind: 'mismatch', includes: '' });
  // 非字符串 expect 一律不是抛出口径（走原有精确比较）
  assert.deepEqual(classifyThrowsExpectation(undefined, 'x'), { kind: 'not-throws' });
});

test('② 预期抛错且命中 ⇒ pass（旧口径下这条是 fail）', async () => {
  const root = makePilotProject();
  try {
    await ensureProjectIndex(root);
    const r = await verdictOf(exp([{ given: [{ n: -1, d: 2, question: Q }], expect: 'throws:必须是非负整数' }]), root);
    assert.equal(r.verdict, 'pass', r.detail);
  } finally {
    dropPilotProject(root);
  }
});

test('③ 不抛错 ⇒ fail（错误实现必须被抓住）', async () => {
  const root = makePilotProject();
  try {
    await ensureProjectIndex(root);
    const r = await verdictOf(exp([{ given: [{ n: 1, d: 2, question: Q }], expect: 'throws:必须是非负整数' }]), root);
    assert.equal(r.verdict, 'fail', r.detail);
    assert.match(r.detail, /行为差异/);
  } finally {
    dropPilotProject(root);
  }
});

test('④ 抛了但文本不符 ⇒ fail（不是"只要抛就算过"）', async () => {
  const root = makePilotProject();
  try {
    await ensureProjectIndex(root);
    const r = await verdictOf(exp([{ given: [{ n: -1, d: 2, question: Q }], expect: 'throws:完全不同的错误文本' }]), root);
    assert.equal(r.verdict, 'fail', r.detail);
    assert.match(r.detail, /期望抛错含/);
  } finally {
    dropPilotProject(root);
  }
});

test('⑤ 没执行（符号不存在）⇒ unsupported，不许伪装成 pass/fail', async () => {
  const root = makePilotProject();
  try {
    await ensureProjectIndex(root);
    const r = await verdictOf(
      {
        ...exp([{ given: [], expect: 'throws:x' }]),
        symbol: '__no_such_symbol__',
      },
      root,
    );
    assert.equal(r.verdict, 'unsupported', r.detail);
  } finally {
    dropPilotProject(root);
  }
});
