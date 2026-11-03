/**
 * P0 · 0.6：`new-text-present`（`old` 已不在、`new` 恰好一处）在**三条路**上必须同结论。
 *
 * ## 它挡的事故（取证见 `docs/todo.md` §0.6）
 * 同一个事实「上一次应用留下的痕迹」原本有**四种**说法：
 *   ① 单条 `replace_text` ⇒ **throw**（`code=ALREADY_APPLIED`，而该 code **不出仓**：错误通道只给 `{text,isError}`）
 *   ② `edit_code targets[]` ⇒ `ok:false` **失败项**
 *   ③ `apply_refactor_plan`(apply) ⇒ 成功，但只回 `{file,status}`（**证据丢失**，0.12）
 *   ④ `apply_refactor_plan`(targets=算清单) ⇒ 抛错、整份不产出
 * 而对照档 `inside-new-text` 是 ①②③ 全成功 ⇒ 同一判据、四条路各翻一遍。
 *
 * ## 裁决（已定）
 * 「new 已在、old 不在」= **成功（已应用过）**，不是错：
 *   · 用户重跑同一条替换、内容已在 ⇒ 期望「没变」，不是「报错」；
 *   · 0.12：成功通道能分三档（`written:true` / `already_applied{line,how}`+`written:false` / `no_op:true`），
 *     而错误通道「已应用过 / 未找到 / 歧义」**三者同形**（都 Error、无 data）⇒ 判成功才满足 0.12；
 *   · 0.16：单条幂等重跑是**正常态**，亮「错」= 永远会亮的告警。
 * ⇒ ①②③ 必须同结论（成功项）**且回执形状一致**（`already_applied{line,how}` + `written:false`）；
 *   ④ 算清单**保留拒**（清单只收可执行项），但**文案按 `how` 分支**。
 *
 * ## 消融（本文件必须能红）
 * 把 `planReplaceText` 的 `&& applied.how === 'inside-new-text'` 加回去、或把 `code=ALREADY_APPLIED` 的 throw
 * 加回来 ⇒ ① 直接 reject、② 变失败项 ⇒ 「三路同结论」必红（③ 因整文件指纹兜底仍绿 —— 那不是漏判，是它本来就不写盘）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★ 临时夹具项目里没有画布（`tasks.db#plans`）—— 本文件验的是三条路的口径，不是画布闸。
process.env.AGENT_IO_REQUIRE_PLAN = '0';

const { editCode } = await import('../src/application/refactor/edit/edit_code.js');
const { buildRefactorPlan, applyRefactorPlan } = await import('../src/application/refactor/pipeline/refactor_plan.js');
// ★ 落盘会按项目根开 `cache.db`（进程级）。Windows 上句柄没关 ⇒ 删目录 EBUSY ⇒ 先关再删。
const { closeAllProjectCacheDbs } = await import('../src/infrastructure/index/db.js');

const ACTOR = 'subagent:batch0-06-write';
const REL = 'src/a.ts';
/** 一次替换：old 在「改前」态存在、new 在「改后」态存在 */
const OLD = 'export const A = 1;';
const NEW = 'export const B = 2;';
/** 夹具（= 同一条替换**上一次应用**留下的痕迹）：old 已不在、new 恰好一处 */
const APPLIED_BODY = `${NEW}\n`;

function cleanup(proj: string): void {
  closeAllProjectCacheDbs();
  fs.rmSync(proj, { recursive: true, force: true });
}

function mkProject(files: Record<string, string>): string {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-ntp-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(proj, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
  return proj;
}

/** 三路回执的**共同形状**（只有这三样能对齐 —— 其余字段是三路各自的账） */
interface Evidence {
  written: boolean;
  line?: number;
  how?: string;
}

test('① 三路同结论：old 不在、new 恰一处 ⇒ 单条 / targets[] / apply_refactor_plan 都判「已应用过」且证据一致', async () => {
  // ── 路 ①：单条 replace_text（改前这里是 throw，code=ALREADY_APPLIED）──
  const proj1 = mkProject({ [REL]: APPLIED_BODY });
  let single: Evidence;
  try {
    const r = await editCode({ project_dir: proj1, file: REL, op: 'replace_text', old_text: OLD, new_text: NEW, actor: ACTOR });
    assert.equal(r.data.written, false, `★ 单条：必须不写盘（改前是抛错）\n${r.message}`);
    assert.deepEqual(
      r.data.already_applied,
      { line: 1, how: 'new-text-present' },
      `★ 单条：必须给出 already_applied 判据（行号 + 依据）\n${r.message}`,
    );
    assert.equal(r.data.no_op, undefined, '"已应用过"与"空操作"是两件事');
    assert.equal(fs.readFileSync(path.join(proj1, REL), 'utf8'), APPLIED_BODY, '文件必须逐字节不变');
    const ev = r.data.already_applied as { line?: number; how?: string };
    single = { written: r.data.written === true, line: ev.line, how: ev.how };
  } finally {
    cleanup(proj1);
  }

  // ── 路 ②：edit_code targets[]（改前这里是 ok:false 的失败项）──
  const proj2 = mkProject({ [REL]: APPLIED_BODY });
  let batch: Evidence;
  try {
    const r = await editCode({
      project_dir: proj2,
      file: REL,
      op: 'replace_text',
      targets: [{ file: REL, old_text: OLD, new_text: NEW }],
      actor: ACTOR,
    });
    const item = r.data.items?.[0];
    assert.equal(item?.ok, true, `★ 批量：必须是成功项（改前是失败项：${item?.error ?? ''}）`);
    assert.equal(item?.written, false, '★ 批量：不许写盘');
    assert.deepEqual(item?.already_applied, { line: 1, how: 'new-text-present' }, `★ 批量：证据必须逐项点名\n${r.message}`);
    assert.equal(r.data.written, false, '整批未写盘');
    assert.equal(r.data.already_applied, 1, '已应用过的项数 = 1');
    assert.deepEqual(r.data.applied ?? [], [], 'applied 必须为空');
    assert.equal(fs.readFileSync(path.join(proj2, REL), 'utf8'), APPLIED_BODY, '文件必须逐字节不变');
    batch = { written: r.data.written === true, line: item?.already_applied?.line, how: item?.already_applied?.how };
  } finally {
    cleanup(proj2);
  }

  // ── 路 ③：apply_refactor_plan（先真应用一次，再用**同一份清单**重放 ⇒ 落到「已应用过」）──
  //    ★ 为什么这样造夹具：算清单形态对「old 不在、new 恰一处」是**保留拒**（清单只收可执行项）⇒
  //      第三条路的「已应用过」只能由「重放一份真清单」产生，而那时的盘上状态与 ①② 的夹具**逐字相同**。
  const proj3 = mkProject({ [REL]: `${OLD}\n` });
  let plan: Evidence;
  try {
    const p = await buildRefactorPlan({ project_dir: proj3, targets: [{ file: REL, old_text: OLD, new_text: NEW }] });
    const first = await applyRefactorPlan({ project_dir: proj3, plan: p, actor: ACTOR });
    assert.equal(first.written, true, '第一次必须真写盘');
    assert.equal(first.items[0]?.status, 'applied', first.items[0]?.error ?? '');
    assert.equal(fs.readFileSync(path.join(proj3, REL), 'utf8'), APPLIED_BODY, '★ 重放前的盘上状态必须与 ①② 的夹具逐字相同');

    const second = await applyRefactorPlan({ project_dir: proj3, plan: p, actor: ACTOR });
    assert.equal(second.ok, true, '重放必须 ok');
    assert.equal(second.written, false, '★ 重放必须不写盘');
    assert.equal(second.items[0]?.status, 'already_applied', '★ 重放必须判「已应用过」');
    assert.equal(second.items[0]?.line, 1, '★ 0.6：证据不许丢 —— 必须带行号');
    assert.equal(second.items[0]?.how, 'new-text-present', '★ 0.6：证据不许丢 —— 必须带依据');
    assert.equal(second.already_applied, 1, '已应用过的项数 = 1');
    assert.equal(fs.readFileSync(path.join(proj3, REL), 'utf8'), APPLIED_BODY, '文件必须逐字节不变');
    plan = { written: second.written === true, line: second.items[0]?.line, how: second.items[0]?.how };
  } finally {
    cleanup(proj3);
  }

  // ── 三路**同结论 + 同形状**（这一条是 0.6 的全部判据）──
  assert.deepEqual(single, { written: false, line: 1, how: 'new-text-present' }, '单条路的证据');
  assert.deepEqual(batch, single, '★ targets[] 与单条必须同形同值');
  assert.deepEqual(plan, single, '★ apply_refactor_plan 与单条必须同形同值');
});

test('② 算清单保留拒，但**文案按 how 分支**（不许再说成「严格覆盖」）', async () => {
  const proj = mkProject({ [REL]: APPLIED_BODY });
  try {
    await assert.rejects(
      () => buildRefactorPlan({ project_dir: proj, targets: [{ file: REL, old_text: OLD, new_text: NEW }] }),
      (err: Error) => {
        assert.match(err.message, /已经应用过/, '仍要拒（清单只收可执行项）');
        assert.match(err.message, /new_text \*\*已在文件里恰好一处\*\*/, `★ 文案必须按 how 分支（new-text-present）\n${err.message}`);
        assert.doesNotMatch(err.message, /严格覆盖/, '★ 不许把 new-text-present 说成 inside-new-text 的那句话');
        return true;
      },
    );
    assert.equal(fs.readFileSync(path.join(proj, REL), 'utf8'), APPLIED_BODY, '拒 ⇒ 一个字节都不改');
  } finally {
    cleanup(proj);
  }
});
