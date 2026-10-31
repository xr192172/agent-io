/**
 * P0 · **历史不吃当前 schema**（`validateDSL` 只管"现在"）+ 已退役 kind 的残留不许回潮。
 *
 * ## 它挡的事故（2026-10-31 实测，不是假想）
 * 退役 `cert` kind 那一笔，`validateDSL` 报 **152 错** —— 报的不是当前判据，而是
 * `decision_history` 里的**历史条目**（它们按**当时**的 schema 写，含 `kind:'cert'`）。
 * 当时只能**手工摘掉 4 条 history** 才过绿 ⇒ 代价是删掉了"当时为什么这么写"。
 * 若这条不改，**每一次** kind / 字段退役都要重演一遍，而且每次都会顺手删历史。
 *
 * ## 判据（两句话，都可判真假）
 * 1. **当前** `decision.expectations` 里出现未知 kind ⇒ `validateDSL` **必须**报错（这条能力不许修丢）；
 * 2. **同一条判据挪进** `decision_history` ⇒ `validateDSL` **必须不报错**（历史是记录，不受当前 schema 管辖）。
 *
 * ## 消融（本文件必须能红 —— 修前实测读数，2026-10-31）
 * 修 `src/domain/validator.ts` 之前跑本文件：**用例 3/6 通过、3 个红**（③ ⑤ ⑥）· exit 1，
 * ③ 的首错 `[const] /geometry/nodes/0/decision_history/0/decision/expectations/0/kind: must be equal to constant`；
 * 修后 ⇒ **用例 6/6** · exit 0（读数见 commit message）。
 *
 * ## 边界（诚实清单）
 * · 夹具是**最小可过 schema 的 DSL**（`type:'feature_diagram'` + 1 节点 + 1 语义文件），只改
 *   `decision / decision_history` 一处差异 ⇒ 报错只可能来自那一处；
 * · 本文件**不碰** fs 上的真设计册、不建临时数据根（`validateDSL` 是纯函数）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { validateDSL } from '../src/domain/validator.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 一条**当前合法**的判据（`file-exists` 是 11 种里唯一不需要项目的） */
const OK_EXP = { kind: 'file-exists', path: 'src/x.ts', why: '夹具：只为占位' };

/** 已退役的 kind（`cert` 于 2026-10-31 退役）—— 用它当"未知 kind"的样本 */
const RETIRED_EXP = { kind: 'cert', cert: 'certs/x-cert.mjs', why: '历史条目：当年合法' };

/** 最小可过 schema 的 DSL：只把 `nodeExtra` 摊进那唯一一个节点 */
function dslWith(nodeExtra: Record<string, unknown>): unknown {
  return {
    id: 'f',
    type: 'feature_diagram',
    feature: 'f',
    geometry: { nodes: [{ id: 'n1', ...nodeExtra }] },
    semantic: { files: [{ id: 'n1', path: 'src/x.ts', responsibility: '夹具' }] },
  };
}

/** 历史条目（形状 = `DecisionHistoryEntry`：`at` + `decision`） */
function historyOf(expectations: object[]): object[] {
  return [{ at: '2026-10-31T00:00:00.000Z', decision: { summary: '当年那一版', expectations } }];
}

test('① 基线：最小 DSL 本身是合法的（防止后面的红来自夹具写坏）', () => {
  const r = validateDSL(dslWith({ decision: { summary: 's', expectations: [OK_EXP] } }));
  assert.deepEqual(r.errors, [], `夹具自己就不合法 ⇒ 后面的读数无意义：${r.errors.join(' | ')}`);
  assert.equal(r.valid, true);
});

test('② 当前 decision.expectations 里出现未知 kind（cert）⇒ 必须报错', () => {
  const r = validateDSL(dslWith({ decision: { summary: 's', expectations: [RETIRED_EXP] } }));
  assert.equal(r.valid, false, '未知 kind 藏在**当前**判据里却过了校验 ⇒ 写闸与门同时失效');
  assert.ok(
    r.errors.some((e) => e.includes('/decision/expectations/')),
    `报错必须点名**当前**判据那一段（实际：${r.errors.join(' | ')}）`,
  );
});

test('③ 同一条判据挪进 decision_history ⇒ 不许报错（历史不受当前 schema 管辖）', () => {
  const r = validateDSL(
    dslWith({
      decision: { summary: 's', expectations: [OK_EXP] },
      decision_history: historyOf([RETIRED_EXP]),
    }),
  );
  assert.deepEqual(
    r.errors,
    [],
    `历史条目用的是**当时**的 schema ⇒ 当前 schema 判它等于"每次退役都要删历史"（实际报错：${r.errors.join(' | ')}）`,
  );
  assert.equal(r.valid, true);
});

test('④ 历史里混着未知 kind 时，**当前**判据的错照旧要报（不是"有历史就整份放行"）', () => {
  const r = validateDSL(
    dslWith({
      decision: { summary: 's', expectations: [RETIRED_EXP] },
      decision_history: historyOf([OK_EXP]),
    }),
  );
  assert.equal(r.valid, false, '历史里的未知 kind 放行了 ⇒ 不能连**当前**判据的错也一起放行');
  assert.ok(r.errors.some((e) => e.includes('/decision/expectations/')));
});

test('⑤ 历史条目本身的长相也不再被当前 schema 判死（`at` 之外的旧字段不拦）', () => {
  // 历史是记录：字段增减是 schema 的演进，不该让"当年写下的记录"变成今天的红
  const r = validateDSL(
    dslWith({
      decision: { summary: 's', expectations: [OK_EXP] },
      decision_history: [
        { at: '2026-10-31T00:00:00.000Z', decision: { summary: '旧版', expectations: [RETIRED_EXP] }, retired_field: 1 },
      ],
    }),
  );
  assert.deepEqual(r.errors, [], `历史里的旧字段把整份 DSL 判红：${r.errors.join(' | ')}`);
});

test('⑥ 已退役 kind 的残留：src 与判据表不再"教人写 cert"（计划画布的 `cert:` 文法除外）', () => {
  // ② 的三处代码残留 + docs 判据表 —— 每一处都断"旧写法不见了 ∧ 新写法在"
  const gate = read('src/domain/gate_error.ts');
  assert.ok(!gate.includes('run / cert'), 'E-PLAN-013 的 fix 仍在教人写 `run / cert`');
  assert.ok(!gate.includes('cert 可补 judgement_kind'), 'E-PLAN-012 的 fix 仍在教人"cert 可补 judgement_kind"');
  assert.ok(gate.includes('cert:<证>#<检查号>'), '★ 计划画布的 `cert:` 文法（judgement_ref）不该被顺手删掉');

  const rp = read('src/application/design/db/rewrite_plan.ts');
  assert.ok(!/^\s*'cert',/m.test(rp), '`SEMANTIC_KINDS` 里仍有 `\'cert\'`（判据 kind 的分类表不许留已退役的名字）');
  assert.ok(rp.includes("'runtime',"), '`SEMANTIC_KINDS` 被改坏（连 `runtime` 都没了）');

  const jc = read('src/application/design/intent/judge_cache.ts');
  assert.ok(!jc.includes('`cert`'), '`judge_cache` 的缓存策略表仍把 `cert` 当一种 kind');

  const guide = read('docs/GUIDE-GATE.md');
  assert.ok(!guide.includes('| `cert` |'), '`docs/GUIDE-GATE.md` 的判据表仍在列 `cert` 这个 kind');
  assert.ok(guide.includes('判据 11 kind'), '`docs/GUIDE-GATE.md` 的判据表标题仍写着旧种数');
});
