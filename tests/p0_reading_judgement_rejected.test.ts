/**
 * P0 · **读数型判据闸**（`FieldSpec.carriesNumberThreshold` + `readingThresholdHit` / `hasAllQuantifier`）
 *
 * 由来（用户 2026-11-06 裁定，逐字）：
 * 「整个框架里面就有很多这种判据，读数判据。而实际上**我需要的是能力判据**…所有的读数判据必须要以
 *  **通过不通过**为导向，而不是说测得有多少、需要把某个读数提到多少。**你这个读数有什么意义呢？**
 *  它既不能指代功能是否正确，也不能指代实际问题出现在哪。」
 * 「**你应该在这个闸里面去控制 —— 写计划的时候就要写这种判据的时候就控制，不能写这种判据。**」
 *
 * ★★ 判据只落在 **`return` 那一行的字面量阈值**（`return n >= 45;`）。
 *   首版只看全局正则（`>= N` 出现在哪都算），当场**误伤 2 条现有用例**并漏掉真靶子，
 *   所以这条边界是**被实测逼出来的**，不是设计时想到的 —— 三种写法的分界：
 *     · `return n >= 45;`                     ⇒ 判据的**结论本身**就是"数量达标" ⇒ **读数，拒**
 *     · `input.n === 2`（非 return）          ⇒ 对**显式输入**的断言 ⇒ **合法（0.12 第 2 条），放行**
 *     · `return Number(total) === all && …`   ⇒ 右边不是字面量、是两个值相比 ⇒ **守恒，放行**
 *
 * 本证六向（缺一不算，0.14）：
 *   ① 异义必不命中：`return n >= 45` 且 why 无全称量词 ⇒ **拒**
 *   ② 同义必命中：同样的数，但 why 说了「全部 / 每一条」⇒ **许**（覆盖率/守恒，是能力判据）
 *   ③ 边界放行：`=== 0` / `!== 1` 表达「有 / 没有」⇒ **许**
 *   ④ 显式豁免：why 里写「读数豁免」⇒ **许**
 *   ⑤ 反向不会过度拒绝：`input.*` / 非 return 的比较 / 两个值相比 ⇒ **一步都不许拒**
 *   ⑥ 消融：未标 `carriesNumberThreshold` 的字段（如 `source-has.must`）⇒ 不受本闸管辖（已声明边界）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readingThresholdHit,
  hasAllQuantifier,
  validateExpectation,
} from '../src/domain/expectation_kinds.js';

const runExp = (expect: string, why: string) => ({ kind: 'run', expect, why });
/** 判据的**结论**就是"数量达标"（这是要拒的形状） */
const BARE = '(() => {\n  const n = 45;\n  return n >= 45;\n})()';

test('① 异义必不命中：`return n >= 45` ∧ why 无全称量词 ⇒ 拒写', () => {
  const bad = validateExpectation(runExp(BARE, '一个拍的数字下限'), 'expectations[0]');
  assert.ok(bad, '`return n >= 45` 且 why 没说"全部" ⇒ 必须拒');
  assert.match(bad, /拍的数阈值/, '报文必须点名"拍的数阈值"');
  assert.match(bad, /读数不是判据/, '报文必须说清"读数不是判据"');
  assert.match(bad, /读数豁免/, '报文必须给出路：显式豁免要写理由');
});

test('② 同义必命中：同样的数，但 why 说了「全部 / 每一条」⇒ 许（覆盖率是能力判据）', () => {
  for (const why of [
    '66 条码里**带前缀的必须全部**覆盖（缺一条就红）',
    '每一条 ToolDef 都必须显式声明 writes',
    '逐条核对，一条都不许漏',
    '投入的每一份都能逐条找到同一份（守恒）',
  ]) {
    assert.equal(validateExpectation(runExp(BARE, why)), null, `why=「${why}」应放行`);
  }
});

test('③ 边界放行：`=== 0` / `!== 1` 表达「有 / 没有」⇒ 许（0/1 不是读数）', () => {
  for (const ex of [
    '(() => { return 0 === 0; })()',
    '(() => { return 1 !== 1; })()',
    '(() => { const d = 0; return d === 0; })()',
  ]) {
    assert.equal(validateExpectation(runExp(ex, '没有理由')), null, `expect=「${ex}」应放行（0/1 是有没有）`);
  }
});

test('④ 显式豁免：why 里写「读数豁免」⇒ 许（外部给定的阈值必须能表达，但必须留理由）', () => {
  const why = '读数豁免：这个 45 是外部协议规定的下限，不是拍脑袋定的';
  assert.equal(validateExpectation(runExp(BARE, why)), null);
});

test('⑤ 反向不许过度拒绝（★ 这条是首版误伤后补的回归）', () => {
  // (a) 对**显式输入**的断言：`input.n === 2` —— 现有用例 p0_run_env_rejected ②c 就在这么写
  assert.equal(
    validateExpectation(
      { kind: 'run', expect: 'input.n === 2', why: '原断言（扫 process.env 的赋值行）已作废' },
      'expectations[0]',
    ),
    null,
    '对显式输入的断言必须放行（0.12 第 2 条：input 是合法输入）',
  );
  // (b) **两个值相比 = 守恒**，不是拍数
  assert.equal(
    validateExpectation(
      runExp('(() => {\n  const a = f();\n  const b = g();\n  return a === b;\n})()', '投入与产出一一对应'),
      'expectations[0]',
    ),
    null,
    '右边不是字面量 ⇒ 守恒 ⇒ 放行',
  );
  // (c) 裸 `<` / `>` 也要能被识别成阈值（首版漏了裸 > <）
  assert.equal(readingThresholdHit('const n = 9;\nreturn n > 1;'), true, '`return n > 1` 就是"至少 2" ⇒ 读数');
  assert.equal(readingThresholdHit('const n = 9;\nreturn n >= 100;'), true, '以 1 开头的多位数也是读数');
});

test('⑥ 消融 + 已声明边界：未标 carriesNumberThreshold 的字段不受本闸管辖', () => {
  // source-has 的 must 没标 carriesNumberThreshold ⇒ 现在不拦（这是**已声明边界**，不是漏）
  const viaSourceHas = validateExpectation({
    kind: 'source-has',
    path: 'src/domain/gate_error.ts',
    must: ['n >= 45'],
    why: 'source-has 没标 carriesNumberThreshold ⇒ 不拦（边界已写进 FieldSpec 注释）',
  });
  assert.equal(viaSourceHas, null, '未标标记的字段 ⇒ 不受管辖（已声明边界）');
  // 判定核本身
  assert.equal(hasAllQuantifier('全部覆盖'), true);
  assert.equal(hasAllQuantifier('每一条都要'), true);
  assert.equal(hasAllQuantifier('至少要 45 条'), false, '「至少 ≥N」是拍的数，不是全称');
});
