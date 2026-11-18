/**
 * touches: src/domain/semantic_model/{types,serialize,registry,validate}.ts
 *
 * P0 · **通用语义建模核**的机器回归 —— 2026-11-18
 *
 * ## 本文件钉的四件事
 * ① **方向**：核不知道领域包存在。源码里出现 `tailoring`、或 import 指到 `../tailoring/` ⇒ 红。
 *   ★ 带正对照（扫领域包必须**命中** `../semantic_model/`）—— 否则"0 命中"可能只是正则写坏了
 *     （同 `tests/p0_domain_purity.test.ts:121-126` 的做法）。
 * ② **往返无损**：`roundTrip` 后逐字段相等；`undefined` / `NaN` 值**当场抛**（JSON 会静默删键/变 null）。
 * ③ **形状闸**：非法形状拒绝（不是"尽力修一下"），且带 `at` 路径能定位。
 * ④ **G1–G6** 各有一条反例 —— 每条都先断言"正例绿"，再断言"反例红"，避免判据本身恒红。
 *
 * ## ★ 玩具域（`toy()`）是刻意内联的
 * 核的用例**不许** import 制衣包：一个不自带数据的核，只能在"有人喂它"的时候才证明得了自洽。
 * 玩具域 = 2 个实体（`Widget` / `Gadget`）+ 1 个算子（`toy.fuse`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  criteriaTally,
  fromJSON,
  g1EntityIdentity,
  g3CriteriaPresent,
  g4VersionChain,
  g5InputKinds,
  g6CriterionVerdict,
  isModelConsistent,
  operatorKey,
  roundTrip,
  SemanticRegistry,
  SemanticShapeError,
  toJSON,
  validateModel,
  type OperatorDef,
  type SemanticModel,
} from '../src/domain/semantic_model/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = path.join(REPO, 'src/domain/semantic_model');
const PACK_DIR = path.join(REPO, 'src/domain/tailoring');

/** 玩具域：2 实体 + 1 算子（**不含任何领域词**） */
function toy(): SemanticModel {
  return {
    profile: 'toy',
    entities: [
      { id: 'w1', semanticName: 'widget', kind: 'widget', attrs: { partner: { ref: 'g1' } } },
      { id: 'g1', semanticName: 'gadget', kind: 'gadget' },
    ],
    operators: [
      {
        name: 'toy.fuse',
        version: 1,
        intent: '把 widget 接到 gadget 上',
        inputs: [
          { ref: 'a', entityKind: 'widget' },
          { ref: 'b', entityKind: 'gadget' },
        ],
        outputs: [{ produces: 'Fusion', mutates: 'declare' }],
        criteria: [{ id: 'fuse.mutual', tier: 'declarative', why: '两端必须互指', check: 'a.partner === b && b.partner === a' }],
      },
    ],
    calls: [],
  };
}

function readTs(dir: string): Array<{ rel: string; src: string }> {
  const out: Array<{ rel: string; src: string }> = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...readTs(p));
    else if (e.name.endsWith('.ts')) out.push({ rel: path.relative(REPO, p).replace(/\\/g, '/'), src: fs.readFileSync(p, 'utf-8') });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// ① 方向：核不知道领域包存在（删掉制衣包，核仍自洽 —— 这是**结构事实**，不是承诺）
// ════════════════════════════════════════════════════════════════════
test('① 方向：核源码里 0 处提到领域包，且 import 从不指向 ../tailoring/（带正对照）', () => {
  const core = readTs(CORE_DIR);
  // ①a 扫描器本身必须读到东西（否则"0 命中"可能只是"一个没扫到"）
  assert.ok(core.length >= 4, `①a 扫描器必须读到核的 5 个文件：实测 ${String(core.length)} 个`);

  const mentions = core.filter((f) => /tailoring/i.test(f.src)).map((f) => f.rel);
  assert.deepEqual(mentions, [], `①b 核里不许出现领域包的名字（那是"通用"的反面）：实测 ${mentions.join(' / ')}`);

  const badImport = core.filter((f) => /from\s+['"][^'"]*tailoring\//.test(f.src)).map((f) => f.rel);
  assert.deepEqual(badImport, [], `①c 核不许 import 领域包（否则"删掉领域包核仍自洽"就不成立了）：实测 ${badImport.join(' / ')}`);

  // ★ 正对照：同一套正则扫领域包必须**命中** → 证明 ①②③ 的 0 不是正则写坏
  const packHits = readTs(PACK_DIR).filter((f) => /from\s+['"][^'"]*semantic_model\//.test(f.src));
  assert.ok(packHits.length > 0, `①d 正对照：领域包必须 import 核（证明上面的 0 命中不是恒 0）：实测 ${String(packHits.length)} 处`);
});

// ════════════════════════════════════════════════════════════════════
// ② 往返无损（含两个"会被 JSON 静默改掉"的值）
// ════════════════════════════════════════════════════════════════════
test('② 往返无损：roundTrip 后逐字段相等；undefined / NaN 值当场抛（不静默丢）', () => {
  const m = toy();
  const { json, back } = roundTrip(m);
  assert.deepEqual(back, m, '②a 往返后必须与原件逐字段相等（含 calls 的缺席态）');
  assert.ok(json.includes('"profile":"toy"'), `②b JSON 里应有 profile：实测 ${json.slice(0, 60)}`);

  // ②c undefined 值：JSON.stringify 会**静默删掉这个键** ⇒ 必须在这里抛
  const withUndef = { ...toy(), entities: [{ ...toy().entities[0], attrs: { keep: 1, drop: undefined } }] };
  assert.throws(() => toJSON(withUndef as SemanticModel), (e: unknown) => {
    assert.ok(e instanceof SemanticShapeError, '②c 必须是 SemanticShapeError');
    assert.match((e as SemanticShapeError).at, /entities\[0\]\.attrs\.drop/, `②c 报文必须点名是哪一格的 undefined：实测 ${(e as SemanticShapeError).at}`);
    return true;
  });

  // ②d NaN：JSON.stringify 把它变成 null（一个数变成"没有"）⇒ 必须抛
  const withNaN = { ...toy(), entities: [{ ...toy().entities[0], attrs: { n: Number.NaN } }] };
  assert.throws(() => toJSON(withNaN as SemanticModel), /非有限数/, '②d NaN 必须抛');
});

// ════════════════════════════════════════════════════════════════════
// ③ 形状闸：非法形状拒绝（带 at 路径）
// ════════════════════════════════════════════════════════════════════
test('③ 形状闸：非法形状拒绝并点名路径（不尽力修）', () => {
  // ③a 缺 profile
  assert.throws(() => fromJSON({ entities: [], operators: [] }), /profile/, '③a 缺 profile 必须拒');
  // ③b 实体缺 id
  assert.throws(() => fromJSON({ profile: 'p', entities: [{}], operators: [] }), /entities\[0\]\.id/, '③b 缺 id 必须拒且点名 entities[0].id');
  // ③c 算子 version 必须是正整数
  const badVer = { profile: 'p', entities: [], operators: [{ ...toy().operators[0], version: 0 }] };
  assert.throws(() => fromJSON(badVer), /operators\[0\]\.version/, '③c version=0 必须拒');
  // ③d mutates 是闭集
  const badMut = { profile: 'p', entities: [], operators: [{ ...toy().operators[0], outputs: [{ produces: 'X', mutates: 'bake' }] }] };
  assert.throws(() => fromJSON(badMut), /mutates/, '③d mutates 不在闭集必须拒');
  // ③e 正对照：合法的能读进来
  const ok = fromJSON(toy());
  assert.equal(ok.entities.length, 2, '③e 合法的玩具域必须读得进来（否则上面四条可能只是"什么都拒"）');
});

// ════════════════════════════════════════════════════════════════════
// ④ G1–G6 各一条反例（每条先证正例绿，再证反例红）
// ════════════════════════════════════════════════════════════════════
test('④ G1–G6：正例绿、反例红（逐条点名）', () => {
  // ── 正例先绿：否则下面的"红"可能来自别处
  assert.deepEqual(validateModel(toy()), [], '④0 玩具域本身必须自洽（否则后面每条反例都不可归因）');

  // G1 实体 id 重复
  const dup = toy();
  const g1 = g1EntityIdentity([...dup.entities, { ...dup.entities[0] }]);
  assert.equal(g1.length, 1, `④1 G1 必须恰好报一次（报两次会让"重复了几个"读成"重复了两次"）：实测 ${String(g1.length)}`);
  assert.match(g1[0].key, /duplicate_entity:w1/);

  // G2 悬空引用（attrs 里的 ref 指向不存在的 id）
  const dangling = toy();
  dangling.entities[0].attrs = { partner: { ref: 'nope' } };
  assert.ok(validateModel(dangling).some((g) => g.rule === 'G2' && /dangling_entity_ref:w1:partner/.test(g.key)), '④2 G2 悬空引用必须点名 w1 的 partner 那一格');

  // G3 算子没有判据
  const noCrit = toy();
  (noCrit.operators[0] as OperatorDef & { criteria: unknown[] }).criteria = [];
  assert.ok(g3CriteriaPresent(noCrit.operators).some((g) => /no_criteria:/.test(g.key)), '④3 G3 criteria 空必须红');

  // G4 版本链断了（supersedes 指向不存在的旧版）
  const brokenChain = toy();
  brokenChain.operators = [{ ...brokenChain.operators[0], version: 2, supersedes: { name: 'toy.fuse', version: 1 } }];
  assert.ok(g4VersionChain(brokenChain.operators).some((g) => /broken_chain:/.test(g.key)), '④4 G4 断链必须红（旧版不删才有回溯）');

  // G5 输入种类没登记
  const unknownKind = toy();
  unknownKind.operators = [{ ...unknownKind.operators[0], inputs: [{ ref: 'a', entityKind: 'sprocket' }] }];
  assert.ok(g5InputKinds(unknownKind.entities, unknownKind.operators).some((g) => /unknown_kind:/.test(g.key)), '④5 G5 没登记的种类必须红');

  // G6 几何判据出口必须是 unsupported（**不是 pass**）
  assert.equal(g6CriterionVerdict({ id: 'x', tier: 'geometry', why: 'w' }), 'unsupported', '④6 G6 几何判据不许判 pass');
  assert.equal(g6CriterionVerdict({ id: 'x', tier: 'declarative', why: 'w', check: 'c' }), 'pass', '④7 G6 声明完整才算 pass');
  assert.equal(g6CriterionVerdict({ id: 'x', tier: 'declarative', why: 'w', blocked_by: '等 v2' }), 'unsupported', '④8 G6 有 blocked_by 一律 unsupported');
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 注册表：重名即拒（不覆盖）+ 调用记录当场点名 + 往返经注册表仍无损
// ════════════════════════════════════════════════════════════════════
test('⑤ 注册表：重名即拒、坏调用当场点名、快照字符串往返无损', () => {
  const reg = new SemanticRegistry('toy');
  const e = toy().entities[0];
  const op = toy().operators[0];

  assert.equal(reg.registerEntity(e).ok, true, '⑤a 第一次注册必须成功');
  const again = reg.registerEntity(e);
  assert.equal(again.ok, false, '⑤b 重名必须拒（覆盖 = 静默丢一个已注册的东西）');
  if (!again.ok) assert.equal(again.reason, 'duplicate', `⑤b 拒因必须是 duplicate：实测 ${again.reason}`);

  // ⑤c 形状坏 ⇒ reason=shape（不是 duplicate）
  const bad = reg.registerEntity({ semanticName: 'x', kind: 'widget' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'shape', `⑤c 缺 id 的拒因必须是 shape：实测 ${bad.reason}`);

  assert.equal(reg.registerOperator(op).ok, true, '⑤d 算子注册必须成功');
  assert.ok(reg.operatorOf('toy.fuse', 1), '⑤e 必须能按 name@version 取回');
  assert.equal(reg.operatorOf('toy.fuse', 2), undefined, '⑤f 没注册过的版本取不到（不许"最近的那一版"兜底）');

  // ⑤g 调用记录：算子不存在 ⇒ unknown，且点名
  const noOp = reg.recordCall({ op: 'toy.none', version: 1, args: ['w1'], at: '2026-11-18T00:00:00Z' });
  assert.equal(noOp.ok, false);
  if (!noOp.ok) {
    assert.equal(noOp.reason, 'unknown');
    assert.match(noOp.message, /toy\.none@1/, `⑤g 报文必须点名那个算子：实测 ${noOp.message}`);
  }

  // ⑤h 实参个数必须与输入位一致
  const wrongArity = reg.recordCall({ op: 'toy.fuse', version: 1, args: ['w1'], at: '2026-11-18T00:00:00Z' });
  assert.equal(wrongArity.ok, false, '⑤h 实参 1 个而输入位 2 个 ⇒ 必须拒');
  if (!wrongArity.ok) assert.match(wrongArity.message, /2 个输入位/, `⑤h 报文必须给两个数：实测 ${wrongArity.message}`);

  // ⑤i 合法的调用记录能进，且快照往返无损
  assert.equal(reg.registerEntity(toy().entities[1]).ok, true);
  assert.equal(reg.recordCall({ op: 'toy.fuse', version: 1, args: ['w1', 'g1'], at: '2026-11-18T00:00:00Z' }).ok, true);
  const before = reg.snapshot();
  const rebuilt = SemanticRegistry.fromJSONString(reg.toJSONString());
  assert.deepEqual(rebuilt.snapshot(), before, '⑤i 经注册表的字符串往返必须无损（实体/算子/调用三样都要）');
  assert.equal(criteriaTally(before.operators)[operatorKey('toy.fuse', 1)].total, 1, '⑤j 判据总账必须数到那一条');
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 全模型体检的入口只有一把尺（isModelConsistent ⇔ validateModel 为空）
// ════════════════════════════════════════════════════════════════════
test('⑥ isModelConsistent 与 validateModel 同源（不许两把尺）', () => {
  assert.equal(isModelConsistent(toy()), true, '⑥a 玩具域自洽');
  const broken = toy();
  (broken.operators[0] as OperatorDef & { criteria: unknown[] }).criteria = [];
  assert.equal(isModelConsistent(broken), false, '⑥b 破了 G3 ⇒ 必须不自洽');
  assert.ok(validateModel(broken).length > 0, '⑥c 两把尺必须同时变（同一个判据源）');
});
