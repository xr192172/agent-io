/**
 * P0 · `source-has` 的**针级鉴别力**（R5）：一条判据的针，能不能被 **import 行单独**满足？
 *
 * ## 它钉的是哪一档假绿（实测：113 条 source-has 里 14 条）
 * 有一类 `must` 只住在 **import 行**也成立（`typeMembersOf` / `rootsOf` / `projectRootOf` …）⇒
 * 把实体行里的接线删干净，判据**仍然绿**：它守的是「这个文件提过这个名字」，不是「这个文件用了它」。
 * 判据不是「出现次数 ≥ 2」（实测反例：`Camprobe` 出现 4 次，删掉类声明 4 处同时消失 ⇒ 会正确变红），
 * 而是**「能否被 import 行单独满足」**：A 档 = 实体 0（针只住 import 行）/ B 档 = import ≥1 且实体 ≥1。
 *
 * ## 五条（缺一条这只证就只剩一半）
 * ① **实仓整册：blind 必须为 0** —— 从 `.agent-io/design/*.dsl.json` **现取**（不写死条数、不写死坐标），
 *    打印分母（扫了几条 / 可测几条 / 判不了几条），分母为 0 就判红（空跑不是检查）；
 * ② A 档合成夹具 ⇒ `blind:true, tier:'A'`；③ B 档 ⇒ `blind:true, tier:'B'`；④ 反向（只在实体行）⇒ `blind:false`；
 * ⑤ **消融**：把行分类注入成恒 false ⇒ ②③ 必须变红（同一夹具在真判据下仍须 `blind:true`，证明红来自消融）；
 * ⑥ 量具必须吃**判据实际匹配的那份文本**（剥过注释）—— 针只住注释时不得被数成实体行。
 *
 * ## 为什么住 `npm test` 而不写进册里
 * ① 判的是「实仓盲针数必须为 0」这一**统计态**（分母由扫册现算），台账层表达不了；
 * ② 消融要**改注入**再比结论差，`decision.expectations` 的一条表达式做不到（`behavior-cases` 也不能改参）。
 * ⇒ 与 `tests/p0_kind_projection.test.ts` 同一处置：执行核是 node:test 里的真实调用。
 *
 * ## 零重复（0.9.1）
 * 行分类只在 `src/domain/needle_power.ts#isImportLine`；「哪份文本」只在
 * `src/application/design/intent/expectations.ts#sourceHasTextOf`。本文件**不重写**任何一条。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { blindNeedlePowersOf, isImportLine, needlePower } from '../src/domain/needle_power.js';
import { sourceHasTextOf } from '../src/application/design/intent/expectations.js';
import { OP_SPECS, requiredKeyIndexGaps, TOOL_FACE_OMITTED_REQUIRED_KEYS } from '../src/application/design/dsl_ops/op_data_spec.js';
import { DESIGN_TOOLS } from '../src/application/design/index.js';

/** 实册目录：本仓的册只有这一处（与 `scripts/judge-all.mjs` 同一口径，钉死不看注册表） */
const DESIGN_DIR = path.join(process.cwd(), '.agent-io', 'design');

interface SheetExpectation {
  kind?: string;
  path?: string;
  must?: string[];
  includeComments?: boolean;
  why?: string;
}

/** 把三册里**每一条** `source-has` 连同它所属的节点一起摊平（数据来源 = 册本身，不写死坐标） */
function sourceHasCriteriaOf(designDir: string): Array<{ sheet: string; nodeId: string; index: number; e: SheetExpectation }> {
  const files = fs.readdirSync(designDir).filter((f) => f.endsWith('.dsl.json'));
  const out: Array<{ sheet: string; nodeId: string; index: number; e: SheetExpectation }> = [];
  for (const file of files) {
    const dsl = JSON.parse(fs.readFileSync(path.join(designDir, file), 'utf-8')) as {
      geometry?: { nodes?: Array<{ id?: string; decision?: { expectations?: SheetExpectation[] } }> };
    };
    for (const node of dsl.geometry?.nodes ?? []) {
      const exs = node.decision?.expectations ?? [];
      exs.forEach((e, index) => {
        if (e?.kind === 'source-has') out.push({ sheet: file, nodeId: String(node.id ?? '?'), index, e });
      });
    }
  }
  return out;
}

test('① 实仓整册：没有一条 source-has 的 must 能被 import 行单独满足（blind = 0，分母现算）', async () => {
  const criteria = sourceHasCriteriaOf(DESIGN_DIR);
  assert.ok(criteria.length > 0, `实册里一条 source-has 都没扫到（${DESIGN_DIR}）⇒ 分母为 0 的检查不是检查`);

  let measurable = 0;
  const noMust: string[] = [];
  const unjudgeable: string[] = [];
  const blind: string[] = [];

  for (const c of criteria) {
    const rel = String(c.e.path ?? '');
    const where = `${c.sheet} :: ${c.nodeId}#${c.index}`;
    if (!rel || !fs.existsSync(rel)) {
      unjudgeable.push(`${where} —— path 缺失或文件不存在（${rel || '(空)'}）`);
      continue;
    }
    if (!(c.e.must ?? []).length) {
      noMust.push(where); // 只有 mustNot 的判据没有针可量（不是缺陷，但要进分母）
      continue;
    }
    const got = await sourceHasTextOf(rel, fs.readFileSync(rel, 'utf-8'), c.e.includeComments);
    if (!got.ok) {
      unjudgeable.push(`${where} —— ${got.detail}`);
      continue;
    }
    measurable++;
    for (const p of blindNeedlePowersOf({ must: c.e.must }, got.text)) {
      blind.push(`${where} —— 针 ${JSON.stringify(p.needle)} 落在 import 行 ${JSON.stringify(p.importLines)}（实体行 ${JSON.stringify(p.bodyLines)}）⇒ ${p.tier} 档：删掉实体行里的接线它仍然绿`);
    }
  }

  // 分母三件都必须出现在失败信息里（0.12 第 3 条）：只给分子等于没验
  const denom = `扫到 source-has ${criteria.length} 条 · 可测 ${measurable} 条 · 只有 mustNot ${noMust.length} 条 · 判不了 ${unjudgeable.length} 条`;
  assert.equal(unjudgeable.length, 0, `有判据的文本取不到 ⇒ 那不是「没有盲针」，是「没量成」：\n  ${unjudgeable.join('\n  ')}\n（${denom}）`);
  assert.deepEqual(blind, [], `发现 ${blind.length} 条 source-has 的针**能被 import 行单独满足**（把实体行的接线删掉它仍然是绿的）：\n  ${blind.join('\n  ')}\n（${denom}）`);
  assert.equal(criteria.length, measurable + noMust.length, `分母对不上：${denom}`);
});

test('② A 档：针只住在 import 行 ⇒ blind:true / tier:A', () => {
  // 真实形态：`import { designDiff } from './line/design_diff.js';` —— 实体里一次都没用
  const text = ["import { value } from './impl.js';", 'const other = 1;'].join('\n');
  const p = needlePower('value', text);
  assert.deepEqual(p.importLines, [1]);
  assert.deepEqual(p.bodyLines, []);
  assert.equal(p.blind, true);
  assert.equal(p.tier, 'A');
});

test('③ B 档：import 行 + 实体行都命中 ⇒ blind:true / tier:B（删掉实体仍绿）', () => {
  const text = ["import { value } from './impl.js';", 'export const v = value(1);'].join('\n');
  const p = needlePower('value', text);
  assert.deepEqual(p.importLines, [1]);
  assert.deepEqual(p.bodyLines, [2]);
  assert.equal(p.blind, true);
  assert.equal(p.tier, 'B');
  // ★ 关键语义：把实体行删掉，import 行仍能单独满足它
  const cut = needlePower('value', "import { value } from './impl.js';");
  assert.equal(cut.blind, true, '删掉实体行后必须仍然盲 —— 这就是「判据靠 import 行白送绿」');
  assert.equal(cut.tier, 'A');
});

test('④ 反向：针只在实体行 ⇒ blind:false / tier:null（这条针有鉴别力，别动它）', () => {
  const called = needlePower('value(', ["import { value } from './impl.js';", 'export const v = value(1);'].join('\n'));
  assert.deepEqual(called.importLines, []);
  assert.deepEqual(called.bodyLines, [2]);
  assert.equal(called.blind, false);
  assert.equal(called.tier, null);
});

test('⑤ 消融：把 import 行判定改坏（恒 false）⇒ ②③ 必须变红（同一夹具在真判据下仍须盲）', () => {
  const aText = ["import { value } from './impl.js';", 'const other = 1;'].join('\n');
  const bText = ["import { value } from './impl.js';", 'export const v = value(1);'].join('\n');
  const broken = (): boolean => false;
  // 真判据：A / B 两档都盲（= ②③ 的断言成立）
  assert.equal(needlePower('value', aText).blind, true);
  assert.equal(needlePower('value', bText).blind, true);
  // 消融后：两档都不盲 ⇒ ②③ 那两条断言（blind === true）必然变红
  assert.equal(needlePower('value', aText, { isImportLine: broken }).blind, false, '消融没生效：import 行判定恒 false 却仍报盲 ⇒ ② 没被这条腿保护');
  assert.equal(needlePower('value', bText, { isImportLine: broken }).blind, false, '消融没生效：import 行判定恒 false 却仍报盲 ⇒ ③ 没被这条腿保护');
  // 消融只该打掉"import 行"这一半：实体行的行号仍须算出来（否则说明改坏的是别的东西）
  assert.deepEqual(needlePower('value', bText, { isImportLine: broken }).bodyLines, [1, 2]);
});

test('⑥ 量具必须吃「判据实际匹配的那份文本」：注释里的针不算实体行（includeComments 反向可判）', async () => {
  const src = ['// value 只在这里出现一句病史', 'export const other = 1;'].join('\n');
  const stripped = await sourceHasTextOf('src/domain/needle_power_fixture.ts', src, false);
  assert.equal(stripped.ok, true);
  if (!stripped.ok) return;
  assert.equal(stripped.mode, '剥注释');
  const p = needlePower('value', stripped.text);
  assert.deepEqual([p.importLines, p.bodyLines], [[], []], '注释里的针被数成了命中 ⇒ 拿原文量会造出假「有实体行」');
  assert.equal(p.blind, false);
  // 反向：includeComments:true 时必须命中（证明分档真的分开了，不是恒剥）
  const raw = await sourceHasTextOf('src/domain/needle_power_fixture.ts', src, true);
  assert.equal(raw.ok, true);
  if (!raw.ok) return;
  assert.deepEqual(needlePower('value', raw.text).bodyLines, [1]);
  // 非代码扩展名同样按原文（`//source` 不是注释）
  const md = await sourceHasTextOf('docs/FIXTURE.md', 'a //source b', false);
  assert.equal(md.ok, true);
  if (!md.ok) return;
  assert.equal(md.mode, '原文（非代码扩展名）');
});

test('⑦ 行分类：三种形态都算 import 行；`= await import` 是 `import(` 的真子集（不单列）', () => {
  for (const line of [
    "import { a } from './x.js';",
    "export { b } from './y.js';",
    "const m = await import('./z.js');",
    "const r = require('./w.js');",
  ]) {
    assert.equal(isImportLine(line), true, `这条应按 import 行算：${line}`);
  }
  for (const line of ['const a = 1;', 'export const b = 2;', 'const value = 1;']) {
    assert.equal(isImportLine(line), false, `这条不该按 import 行算：${line}`);
  }
  // ★ 边界（0.17① 如实声明）：行分类**只看行形状、不看语义** —— 一行被 `//` 注释掉的 import 在**原文**里仍算 import 行。
  //   这不是漏洞，是口径：量具吃的是**判据实际匹配的那份文本**（代码文件已剥注释 ⇒ 那一行变空 ⇒ 不再是 import 行，见 ⑥）。
  assert.equal(isImportLine("// import { a } from './x.js';"), true, '按原文它是 import 形状 —— 靠「吃剥过的文本」消除，不靠正则猜注释');
});

// ══════════════════════════════════════════════════════════════════════════
// ⑧⑨ 同一档假绿的**第二个面**：工具面描述里「这个键可见吗」被"子串"数出来
// ══════════════════════════════════════════════════════════════════════════
/**
 * 病（T-33 实测，**两条独立测量都栽在这里**）：`edit_dsl` 的描述里**看不见 12/20** 个
 * distinct 必填键，而用 `includes` 数会报成「只缺 8 个」—— 因为 `to` 被 `todo` 里的 "to"
 * 凑出来了（子串口径 9/20 vs 词边界口径 8/20）。
 * ⇒ 与 ①②③ 是**同一个病**：**针被别的东西凑出来**（那边是 import 行，这边是词内子串）。
 * ⇒ 所以量具（`op_data_spec.ts#requiredKeyIndexGaps`）必须**词边界**；判据必须**跨源双向**。
 * ★ 为什么住这里而不写进册里：⑨ 要**跨源**（描述 vs `OP_SPECS`）+ **双向**（少报/多报都拒），
 *   `source-has` 只能单向「出现即通过」，表达不了；执行核仍是 node:test 里的真实调用。
 */

/** 把一份工具面描述过一遍量具：返回「描述里看不见」的必填键（依据 = 唯一判据表 `OP_SPECS`） */
function keyGapsOfDescription(description: string): string[] {
  return requiredKeyIndexGaps(description, OP_SPECS);
}

test('⑧ 可见度不能用子串数：`todo` 里的 to 不算 `to` 可见（错口径会恒绿）', () => {
  const specs = [{ type: 'task', ops: ['claim'], idRequired: false, required: { claim: ['to'] } }];
  const onlyTodo = '这里只写了 `todo`，没有独立写出那个键';
  // 对照（消融）：子串口径会说"可见" —— 这正是 T-33 那份「可见 12/20」读数的来源
  assert.equal(onlyTodo.includes('to'), true, '子串口径下 `todo` 会凑出 to（假绿的来源）');
  assert.deepEqual(requiredKeyIndexGaps(onlyTodo, specs), ['to'], '词边界口径下必须判「看不见」');
  // 反向（单向断言没有鉴别力）：真写出来才算可见
  assert.deepEqual(requiredKeyIndexGaps('`to`', specs), []);
});

test('⑨ 工具面↔判据表**跨源双向**比对：看不见的键必须恰好等于声明过的低频集', () => {
  const editDsl = DESIGN_TOOLS.find((d) => d.name === 'edit_dsl');
  assert.ok(editDsl?.description, 'edit_dsl 必须在 DESIGN_TOOLS 里且有描述');
  const gaps = keyGapsOfDescription(String(editDsl?.description ?? ''));
  const omitted = TOOL_FACE_OMITTED_REQUIRED_KEYS.map((o) => o.key).sort();
  assert.ok(omitted.length > 0, '低频集为空 ⇒ 这条判据退化成「描述必须列全部键」，请同步改判据与描述');
  assert.deepEqual(
    gaps,
    omitted,
    '描述里看不见的必填键必须**恰好等于** TOOL_FACE_OMITTED_REQUIRED_KEYS：\n' +
      '  少报 = 该列的没列（去补描述）；多报 = 列了却没写进描述（描述或低频表过时）。\n' +
      '  ★ 往 `OP_SPECS` 加一个必填键而不改描述 ⇒ 这里必然多出一个 ⇒ 红（这就是这条判据的牙）。',
  );
});
