/**
 * P0 · §9.5.5 第 1 条「纯函数契约编译」的试点验收（`docs/PROJECT-DESIGN.md` §9.5.6）。
 *
 * ## 它挡的事故
 * 「行为契约编译器」最容易变成的两种假象，各有一条断言钉住：
 * ① **拿"跑出来的观察值"当期望**（自证）—— 一个没写期望的契约如果一路放过去，
 *    执行核在 `cases: []` 上会判 **pass**（detail「0/0 case 一致」）⇒「空测试集被判全过」；
 * ② **判据恒红** —— `sameBehaviorRet(ret, expect)` 对非字符串 `expect` **恒 false**
 *    ⇒ 透传一次 `expect: 5` 就造出一条永远红的判据（恒红会被当成"判据坏了"删掉）。
 *
 * ## 六条断言（每条都真的跑被测代码 / 真的改坏再改回）
 * ① 正向 + 反向一：`src/domain/diff_scope.ts#normRelPath` 的契约 ⇒ `pass`；
 *    把**临时副本**里那句 `\`→`/` 删掉 ⇒ 同一契约 `fail`；改回 ⇒ `pass`；
 * ② 反证（比较有没有牙）：同一条契约把 `expect` 换成明显的错值 ⇒ **必须 fail**
 *    （把比较换成"恒等 / 只判没抛"这条立刻红）；
 * ③ 反向二：`cases: []` ⇒ `unsupported@1`，且**产物里不许有 expectation**（不许自动填 expect）；
 * ④ 反向三：`symbol` 不存在 ⇒ 点名「第 2 步」，且分母 `input` **不小于**入参数（一条都不剔）；
 * ⑤ 裁定4：`expect: 5` ⇒ `unsupported@4`（编译期就挡，不许走到核里恒红）；
 * ⑥ §9.5.3 是 **8 步不是 7 步**（报文用「第 N 步」定位失败，少一步就全程指错步）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileBehaviorContracts } from '../src/application/design/intent/behavior_compile.js';
import { attributeRunFailure, COMPILE_STAGES, compileGate, delegationToken, planContractCompile } from '../src/domain/behavior_contract.js';
import { judgeExpectations } from '../src/application/design/intent/expectations.js';
import { ensureProjectIndex } from '../src/infrastructure/index/index_freshness.js';
import { closeProjectCacheDb } from '../src/infrastructure/index/db.js';
import type { Expectation } from '../src/domain/expectation.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 试点契约：**只给 symbol**（§9.5.5 第 1 条要「自动得到 file/symbol」，file 由实际 DB 反查） */
const PILOT = {
  id: 'pilot-normrelpath',
  subject: { symbol: 'normRelPath' },
  intent: '仓库相对路径的同一文件不同写法应归一到同一串（`src\\a.ts` ⇒ `src/a.ts`）',
  cases: [{ given: ['src\\a.ts'], expect: 'src/a.ts' }],
  source: 'design',
  setupRefs: [],
};

/** 纯层用的事实（第 2/3/5 步的输入；与 `behavior_compile.ts` 现取的形状一致） */
const FACTS_OK = {
  subject: { resolution: 'ok', file: 'src/domain/diff_scope.ts', signature: 'normRelPath(p: string | null | undefined): string' },
  capability: { lang: 'node', toolchain_ok: true, bare_count: 0, relative_count: 0, builtin_count: 0, fixture_ok: true },
};

/**
 * 改坏目标函数用的**消融针**（源码里逐字存在的那一段）。
 * ★ 找不到就 assert 红：一次"没改成"的消融会把它下面的 fail 断言变成假绿。
 */
const MUTATION_MARK = ".replace(/\\\\/g, '/')";

/** 建一个只含试点函数的临时工程（**不碰仓库**：消融只发生在临时副本上） */
function makePilotProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-compile-'));
  fs.mkdirSync(path.join(root, 'src', 'domain'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'src', 'domain', 'diff_scope.ts'), path.join(root, 'src', 'domain', 'diff_scope.ts'));
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

test('① 正向可比：契约 pass；改错目标函数 ⇒ 同一契约 fail；改回 ⇒ pass', async () => {
  const root = makePilotProject();
  try {
    await ensureProjectIndex(root);
    const target = path.join(root, 'src', 'domain', 'diff_scope.ts');
    const original = fs.readFileSync(target, 'utf-8');

    const before = await compileBehaviorContracts([PILOT], { project_dir: root });
    assert.equal(before.items[0].verdict, 'pass', `正向应 pass，实得 ${before.items[0].verdict}：${before.items[0].detail}`);

    // 消融：删掉 `\`→`/` 那一句 ⇒ `src\a.ts` 不再被归一
    assert.ok(original.includes(MUTATION_MARK), `消融针没命中 ⇒ 这次"改坏"根本没改坏（不能算验证）：${MUTATION_MARK}`);
    fs.writeFileSync(target, original.split(MUTATION_MARK).join(''));
    const broken = await compileBehaviorContracts([PILOT], { project_dir: root });
    assert.equal(broken.items[0].verdict, 'fail', `改坏后同一契约应 fail，实得 ${broken.items[0].verdict}：${broken.items[0].detail}`);

    fs.writeFileSync(target, original);
    const restored = await compileBehaviorContracts([PILOT], { project_dir: root });
    assert.equal(restored.items[0].verdict, 'pass', `改回应 pass，实得 ${restored.items[0].verdict}：${restored.items[0].detail}`);
  } finally {
    dropPilotProject(root);
  }
});

test('② 反证：expect 换成错值 ⇒ 必须 fail（比较换成恒等/只判没抛 ⇒ 这条红）', async () => {
  const wrong = { ...PILOT, id: 'pilot-wrong-expect', cases: [{ given: ['src\\a.ts'], expect: 'src\\\\a.ts' }] };
  const rep = await compileBehaviorContracts([wrong], { project_dir: REPO });
  assert.equal(rep.fail, 1, `错期望必须判 fail（否则比较没有牙）：${rep.items[0].detail}`);
  assert.equal(rep.pass, 0);
});

test('③ 反向二：无独立预期 ⇒ unsupported@1，且不许自动填 expect', async () => {
  // 纯层：第 1 步就挡，且**不产出** expectation
  const gate = compileGate({ ...PILOT, cases: [] }, FACTS_OK);
  assert.equal(gate, 'unsupported@1');
  const plan = planContractCompile({ ...PILOT, cases: [] }, FACTS_OK);
  assert.equal(plan.expectation, undefined, '没有独立预期时不许拿运行观察值凑一个期望（§9.5.7 边界）');

  // 端到端：结论只能是 unsupported，且回执里没有填好的 expectation
  const rep = await compileBehaviorContracts([{ ...PILOT, id: 'no-expectation', cases: [] }], { project_dir: REPO });
  assert.equal(rep.pass, 0);
  assert.equal(rep.items[0].verdict, 'unsupported');
  assert.equal(rep.items[0].stage_no, 1);
  assert.equal(rep.items[0].expectation, undefined);
  assert.equal(rep.skipped.length, 1, '编译期挡下的必须**具名**进 skipped');
});

test('④ 反向三：主体缺失点名「第 2 步」，且分母一条都不剔', async () => {
  const ghost = { ...PILOT, id: 'ghost-subject', subject: { symbol: 'noSuchFunctionAtAll_xyz' } };
  const rep = await compileBehaviorContracts([PILOT, ghost], { project_dir: REPO });

  assert.equal(rep.input, 2, '分母恒等于**入参条数**');
  assert.equal(rep.checked + rep.skipped.length, rep.input, 'input === checked + skipped（跳过的都在 skipped 里，不是被剔掉）');

  const item = rep.items.find((x) => x.contract_id === 'ghost-subject');
  assert.ok(item, '缺主体的契约必须**在回执里**，不能被静默丢弃');
  assert.equal(item.verdict, 'unsupported');
  assert.equal(item.stage_no, 2, `要点名第 2 步（解析主体），实得 ${item.stage_no}`);
  assert.match(String(item.stage), /^2 解析主体/);
  assert.ok(rep.skipped.some((s) => s.contract_id === 'ghost-subject'), '跳过要**具名**');

  // 运行期那一半（DB 有定义但导出不可达）也归到第 2 步 —— 归因唯一住处是 attributeRunFailure
  assert.equal(attributeRunFailure('行为基线跑不了 ⇒ 判不了：top-level function not found: x').stage_no, 2);
  assert.equal(attributeRunFailure('目标文件加载失败: Cannot find module x').stage_no, 5);
});

test('⑤ 裁定4：expect 非字符串 ⇒ unsupported@4（不许走到核里恒红）', async () => {
  const numExpect = { ...PILOT, id: 'num-expect', cases: [{ given: ['src\\a.ts'], expect: 5 }] };
  assert.equal(compileGate(numExpect, FACTS_OK), 'unsupported@4');

  const rep = await compileBehaviorContracts([numExpect], { project_dir: REPO });
  assert.equal(rep.items[0].verdict, 'unsupported');
  assert.equal(rep.items[0].stage_no, 4);
  assert.match(rep.items[0].detail, /不是字符串/);
});

test('⑥ ④不新建测试体系：编译器结论与现有 behavior-cases 执行核逐条一致', async () => {
  const rep = await compileBehaviorContracts([PILOT], { project_dir: REPO });
  const item = rep.items[0];
  assert.equal(item.verdict, 'pass');
  assert.ok(item.expectation, '产物必须回带 —— 它才是"现有 behavior-cases 输入"');
  const direct = await judgeExpectations(REPO, [
    { node_id: 'pilot', node_label: 'pilot', expectation: item.expectation as unknown as Expectation },
  ]);
  assert.equal(direct.items[0].verdict, item.verdict, '同一个产物的结论必须与直接喂核一致（否则就是另造了一个 runner）');
});

test('⑥b §9.5.3 是 8 步不是 7 步（报文用「第 N 步」定位失败）', () => {
  assert.equal(COMPILE_STAGES.length, 8);
  assert.match(COMPILE_STAGES[7], /^8 结果交给 ChangeSet/);
  const plan = planContractCompile(PILOT, FACTS_OK);
  assert.equal(plan.stages.length, 8);
  assert.deepEqual(
    plan.stages.map((s) => s.ok),
    [true, true, true, true, true, true, null, null],
    '第 7/8 步必须显式标 null（本函数不判）——不许写成 true 冒充"已验"',
  );

  // ★★★ 2026-11-17（T-#N4）：第 7/8 步**移交给了谁**——短值接口 + `delegated` 的真话。
  //   改前第 8 步写的是 `未实现：§9.5.5 第 2 条「接入计划与核销」`，而那一半早就在跑
  //   （plan 侧 = `judgement_ref`；核销侧 = `runPlanJudgements` → `complete_canvas_gate`），
  //   唯一真缺的**编译面入口**现在就是 `design_line action=compile`。
  assert.equal(delegationToken(7), 'judgeExpectations', '第 7 步移交给现有 behavior-cases 执行核');
  assert.equal(delegationToken(8), 'plan+complete', '第 8 步移交给 plan 与核销');
  assert.equal(delegationToken(6), 'in-process', '第 1..6 步由本函数自己判（不交给任何人）');
  assert.equal(delegationToken(9), 'out-of-range@9', '超出八步要**明说**，不静默落回第一步');

  const d7 = String(plan.stages[6].delegated ?? '');
  const d8 = String(plan.stages[7].delegated ?? '');
  assert.ok(d7.startsWith(delegationToken(7)), `第 7 步 delegated 要以短值开头（判据判它，长文给人读）：${d7}`);
  assert.ok(d8.startsWith(delegationToken(8)), `第 8 步 delegated 要以短值开头：${d8}`);
  // ★ G3：两个消费者都必须**在场**（只点名一侧 = 另一半仍然"没人负责"）
  assert.match(d8, /runPlanJudgements/, '核销侧消费者必须点名');
  assert.match(d8, /complete_canvas_gate/, '核销侧的判定核必须点名');
  assert.match(d8, /design_line action=compile/, '编译面入口必须点名（否则"缺哪一半"说不清）');
  // ★ 反向针：把第 8 步改回「未实现」⇒ 这条当场红
  assert.doesNotMatch(d8, /未实现/, '`未实现` 不许再出现在第 8 步的 delegated 里（§9.5.5 第 2 条的生成侧已接线）');
});
